'use strict';
// 服务层自检（无界面）：版本 / Java / 命令构建 / 下载源 / 中文数据，全部走新 src/main/services。
const fs = require('fs');
const path = require('path');

const services = path.join(__dirname, 'src', 'main', 'services');
const paths = require(path.join(services, 'paths'));
const settings = require(path.join(services, 'settings'));
const versions = require(path.join(services, 'versions'));
const java = require(path.join(services, 'java'));
const runtime = require(path.join(services, 'runtime'));
const launch = require(path.join(services, 'launch'));
const i18n = require(path.join(services, 'i18n'));
const providers = require(path.join(services, 'providers'));

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  —  ' + extra : ''}`);
};

(async () => {
  paths.ensureDirs();
  console.log('数据目录:', paths.dirs.data, '\n');

  // 1. 本地版本
  const localList = versions.list();
  check('版本列表非空', localList.length > 0, `${localList.length} 个：${localList.map(v => v.id).join(', ')}`);

  const target = localList.find(v => /^26\./.test(v.id)) || localList[0];
  const detail = target ? versions.detail(target.id) : null;
  check('版本详情可读', !!detail && detail.mainClass === 'net.minecraft.client.main.Main',
    detail ? `${detail.id} · ${detail.libraries} 个库 · java ${detail.javaVersion?.majorVersion}` : '无');

  // 2. classpath 完整性
  if (target) {
    const json = versions.read(target.id);
    const classpath = versions.classpath(json);
    check('classpath 无缺失', classpath.missing.length === 0,
      `${classpath.entries.length} 项${classpath.missing.length ? '，缺失 ' + classpath.missing.length : ''}`);
    check('客户端 jar 存在', versions.paths(target.id).jar && fs.existsSync(versions.paths(target.id).jar));
  }

  // 3. Java 扫描与推荐
  const javaList = await java.scanCached();
  check('Java 扫描命中', javaList.length > 0, `${javaList.length} 个：${javaList.map(j => 'Java ' + j.major).join(' / ')}`);

  if (target) {
    const rec = await runtime.recommend(target.id);
    check('运行时推荐', !!rec.javaPath, `需要 Java ${rec.requiredJava} · 使用 ${rec.javaDisplay} · 分配 ${rec.memoryMB} MB`);
  }

  // 4. 启动命令构建（不真正启动）
  if (target && javaList.length) {
    const account = { name: 'CmdCheck', uuid: '00000000000040008000000000000000', type: 'offline', accessToken: '0' };
    const command = launch.buildCommand({
      versionId: target.id,
      javaPath: java.pickJava(javaList, detail?.javaVersion?.majorVersion)?.path || javaList[0].path,
      account,
      memoryMB: 4096,
      settings: { ...settings.get(), fullscreen: false },
    });
    const joined = command.args.join(' ');
    check('启动命令无残留占位符', !/\$\{/.test(joined), `${command.args.length} 个参数`);
    check('命令行含主类与 classpath', command.args.includes('-cp') && command.args.includes('net.minecraft.client.main.Main'));
    check('命令行含账户与内存', /-Xmx4096M/.test(joined) && joined.includes('CmdCheck'));
    check('未启动真实进程', !launch.isRunning());
  }

  // 5. 下载源
  try {
    const found = await providers.search('modrinth', { query: 'sodium', limit: 5, gameVersion: target?.id, loader: '' });
    check('Modrinth 搜索', (found?.hits || []).length > 0, `找到 ${found?.total || 0} 个项目`);
  } catch (error) {
    check('Modrinth 搜索', false, error.message);
  }

  try {
    const fromCf = await providers.search('curseforge', { query: 'jei', limit: 5, gameVersion: target?.id });
    check('CurseForge 搜索', (fromCf?.hits || []).length > 0, `找到 ${fromCf?.total || 0} 个项目`);
  } catch (error) {
    check('CurseForge 搜索', false, error.message);
  }

  try {
    const list = await providers.versions('modrinth', 'sodium', target?.id || '', 'fabric');
    check('Modrinth 版本列表', list.length > 0, `${list.length} 个文件`);
  } catch (error) {
    check('Modrinth 版本列表', false, error.message);
  }

  const installed = providers.installed('mod');
  check('已安装索引可读', Array.isArray(installed) || typeof installed === 'object', `模组 ${fs.existsSync(paths.dirs.mods) ? '目录存在' : '目录缺失'}`);

  // 6. 中文数据
  try {
    const hits = [{ id: '', slug: 'create', title: 'Create', description: 'A tech mod.' }, { id: '', slug: 'jei', title: 'Just Enough Items' }];
    const enriched = await i18n.translateHits(hits, 'modrinth', 'mod');
    const names = enriched.map(h => h.titleZh || h.title).join(' / ');
    check('中文名解析', /机械动力/.test(names), names);
  } catch (error) {
    check('中文名解析', false, error.message);
  }

  // 7. 配置读写
  const before = settings.get();
  const patched = settings.patch({ downloadConcurrency: 5 });
  check('配置 patch 生效', patched.downloadConcurrency === 5);
  const clamped = settings.patch({ downloadConcurrency: 9999 });
  check('配置数值收敛', clamped.downloadConcurrency <= 32, String(clamped.downloadConcurrency));
  settings.patch({ downloadConcurrency: before.downloadConcurrency });

  const failed = results.filter(r => !r.ok);
  console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length} 项${failed.length ? '，失败：' + failed.map(f => f.name).join('、') : ''}`);
  process.exit(failed.length ? 1 : 0);
})().catch(error => { console.error('自检异常', error); process.exit(1); });
