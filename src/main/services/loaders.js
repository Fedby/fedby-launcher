'use strict';
// 加载器安装：原版 + Fabric / Quilt / Forge / NeoForge / OptiFine
// Fabric 系直接拿官方 profile JSON 落盘；Forge 系跑官方 installer；OptiFine 以模组形式装进 Forge。
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { dirs, ASSET_ENDPOINTS } = require('./paths');
const net = require('./net');
const settings = require('./settings');
const versions = require('./versions');
const mirror = require('./mirror');
const java = require('./java');
const javadl = require('./javadl');

const FABRIC_META = ['https://meta.fabricmc.net', 'https://bmclapi2.bangbang93.com/fabric-meta'];
const QUILT_META = ['https://meta.quiltmc.org', 'https://bmclapi2.bangbang93.com/quilt-meta'];
const FORGE_MAVEN = ['https://maven.minecraftforge.net', 'https://bmclapi2.bangbang93.com/maven'];
const NEO_MAVEN = ['https://maven.neoforged.net/releases', 'https://bmclapi2.bangbang93.com/maven'];
const OPTIFINE_API = ['https://bmclapi2.bangbang93.com'];
const FABRIC_MAVEN = 'https://maven.fabricmc.net/';
const QUILT_MAVEN = 'https://maven.quiltmc.org/repository/release/';
const MODRINTH = 'https://api.modrinth.com/v2';

const CATALOG = [
  { key: 'vanilla', label: '原版', desc: '纯净原版，不装任何加载器' },
  { key: 'fabric', label: 'Fabric', desc: '轻量、更新最快的模组加载器' },
  { key: 'forge', label: 'Forge', desc: '老牌模组平台，生态最全' },
  { key: 'neoforge', label: 'NeoForge', desc: 'Forge 社区分支，支持 1.20.2+' },
  { key: 'quilt', label: 'Quilt', desc: 'Fabric 衍生加载器，兼容 Fabric 模组' },
  { key: 'optifine', label: 'OptiFine', desc: '光影与性能优化，以模组方式装进 Forge' },
];

const msg = (onProgress, stage, message, extra = {}) => onProgress({ stage, message, ...extra });

// 元数据缓存：同一 MC 版本的加载器列表 10 分钟内只拉一次（安装流程会重复用到）
const cache = new Map();
function memo(key, ttl, factory) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = Promise.resolve().then(factory);
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return value;
}

/**
 * 取第一个成功的响应。自动模式下两边同时发（谁快用谁），
 * 固定源模式下按顺序试，超时类错误重试一次。
 */
async function requestFirst(urls, options = {}) {
  const list = (urls || []).filter(Boolean);
  if (mirror.mode() === 'auto' && list.length > 1) {
    try { return await net.requestTextRace(list, { timeout: 15000, ...options }); }
    catch (_) { /* 竞速全挂就走下面的顺序重试 */ }
  }
  let lastError = null;
  for (const url of list) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { return await net.requestText(url, { timeout: 15000, ...options }); }
      catch (err) {
        lastError = err;
        if (!/超时|ETIMEDOUT|ECONNRESET|socket|EAI_AGAIN/i.test(err.message)) break;
      }
    }
  }
  throw lastError || new Error('请求失败');
}

async function jsonFirst(urls) {
  const text = await requestFirst(urls);
  try { return JSON.parse(text); } catch (_) { throw new Error('响应不是合法 JSON'); }
}

// ---------- 版本列表 ----------
async function listFabricLike(kind, mc) {
  return memo(`${kind}:${mc}`, 10 * 60 * 1000, () => fetchFabricLike(kind, mc));
}

async function fetchFabricLike(kind, mc) {
  const bases = mirror.prefer(kind === 'quilt' ? QUILT_META : FABRIC_META);
  const api = kind === 'quilt' ? `/v3/versions/loader/${encodeURIComponent(mc)}` : `/v2/versions/loader/${encodeURIComponent(mc)}`;
  let raw = null;
  try { raw = await jsonFirst(bases.map(base => base + api)); }
  catch (_) { return []; }
  const list = (Array.isArray(raw) ? raw : []).map(item => ({
    version: item.loader?.version || '',
    stable: item.loader?.stable !== false,
    build: item.loader?.build || 0,
  })).filter(item => item.version);
  return list;
}

function parseMavenVersions(xml) {
  const out = [];
  const re = /<version>([^<]+)<\/version>/g;
  let match;
  while ((match = re.exec(xml))) out.push(match[1].trim());
  return out;
}

async function listForge(mc) {
  return memo(`forge:${mc}`, 10 * 60 * 1000, () => fetchForgeList(mc));
}

async function fetchForgeList(mc) {
  // BMCLAPI 有按 MC 版本聚合的列表，官方 maven 作为回退
  try {
    const raw = await jsonFirst([`https://bmclapi2.bangbang93.com/forge/minecraft/${encodeURIComponent(mc)}`]);
    const list = (Array.isArray(raw) ? raw : []).map(item => ({ version: String(item.version || '') })).filter(item => item.version);
    if (list.length) return list;
  } catch (_) { /* 走回退 */ }
  const xml = await requestFirst(mirror.prefer(FORGE_MAVEN).map(base => `${base}/net/minecraftforge/forge/maven-metadata.xml`));
  return parseMavenVersions(xml)
    .filter(version => version.startsWith(mc + '-'))
    .map(version => ({ version: version.slice(mc.length + 1) }));
}

function neoForgeStream(mc) {
  // NeoForge 版本号 = <次版本>.<补丁>.<构建>，对应 1.<次版本>.<补丁>
  const match = /^1\.(\d+)(?:\.(\d+))?$/.exec(mc);
  if (!match) return null;
  const minor = parseInt(match[1], 10);
  const patch = parseInt(match[2] || '0', 10);
  if (minor < 20) return null;
  if (minor === 20) return { artifact: 'net/neoforged/forge', prefix: `1.20.${patch}-`, mcPrefix: true };
  return { artifact: 'net/neoforged/neoforge', prefix: `${minor}.${patch}.`, mcPrefix: false };
}

async function listNeoForge(mc) {
  return memo(`neoforge:${mc}`, 10 * 60 * 1000, () => fetchNeoForgeList(mc));
}

async function fetchNeoForgeList(mc) {
  const stream = neoForgeStream(mc);
  if (!stream) return [];
  const xml = await requestFirst(mirror.prefer(NEO_MAVEN).map(base => `${base}/${stream.artifact}/maven-metadata.xml`));
  return parseMavenVersions(xml)
    .filter(version => version.startsWith(stream.prefix))
    .map(version => ({ version: stream.mcPrefix ? version.slice(version.indexOf('-') + 1) : version }))
    .map(item => ({ ...item, artifactVersion: stream.mcPrefix ? `1.20.${/\.(\d+)$/.exec(mc)?.[1] || '1'}-${item.version}` : item.version }));
}

async function listOptiFine(mc) {
  return memo(`optifine:${mc}`, 10 * 60 * 1000, () => fetchOptiFineList(mc));
}

async function fetchOptiFineList(mc) {
  let raw = null;
  try { raw = await jsonFirst(OPTIFINE_API.map(base => `${base}/optifine/${encodeURIComponent(mc)}`)); }
  catch (_) { return []; }
  return (Array.isArray(raw) ? raw : [])
    .filter(item => item.filename && !/^preview_/i.test(item.filename))
    .map(item => ({
      version: `${item.type}_${item.patch}`,
      type: item.type,
      patch: item.patch,
      filename: item.filename,
      forge: item.forge || '',
      label: `OptiFine ${String(item.type || '').replace(/_/g, ' ')} ${item.patch || ''}`.trim(),
    }));
}

async function listVersions(kind, mc) {
  if (!mc) throw new Error('缺少游戏版本');
  if (kind === 'vanilla') return [];
  let list;
  if (kind === 'fabric' || kind === 'quilt') list = await listFabricLike(kind, mc);
  else if (kind === 'forge') list = await listForge(mc);
  else if (kind === 'neoforge') list = await listNeoForge(mc);
  else if (kind === 'optifine') list = await listOptiFine(mc);
  else throw new Error('未知加载器: ' + kind);

  const seen = new Set();
  return list
    .filter(item => item.version && !seen.has(item.version) && seen.add(item.version))
    .sort((a, b) => compareVersion(b.version, a.version));
}

/** 语义化比较：数字段按数值比，预发布标签低于正式版 */
function compareVersion(a, b) {
  const split = value => String(value).split(/[.\-+_]/).filter(Boolean);
  const left = split(a);
  const right = split(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const x = left[index];
    const y = right[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const diff = parseInt(x, 10) - parseInt(y, 10);
      if (diff) return diff;
    } else if (xNum) return 1;
    else if (yNum) return -1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** 给界面用：顺带标出推荐版本 */
async function loaderInfo(kind, mc) {
  const list = await listVersions(kind, mc);
  let recommended = '';
  if (kind === 'forge') {
    try {
      const promos = await jsonFirst(['https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json']);
      recommended = promos.promos?.[`${mc}-recommended`] || promos.promos?.[`${mc}-latest`] || '';
    } catch (_) { /* 忽略 */ }
  }
  if (!recommended && list.length) recommended = list[0].version;
  return { kind, mc, recommended, versions: list.slice(0, 60) };
}

// ---------- maven 工具 ----------
function mavenPath(name) {
  const parts = String(name).split(':');
  const [group, artifact, version, classifier] = parts;
  if (!group || !artifact || !version) return null;
  const file = `${artifact}-${version}${classifier ? '-' + classifier : ''}.jar`;
  return { path: `${group.split('.').join('/')}/${artifact}/${version}/${file}`, name: `${artifact}-${version}${classifier ? '-' + classifier : ''}.jar` };
}

/** Fabric / Quilt 的 profile JSON 只有 maven 坐标，需要自己拼下载地址 */
function normalizeLibraries(libs, fallbackBase) {
  return (libs || []).map(lib => {
    if (lib.downloads?.artifact?.url) return lib;
    const parsed = mavenPath(lib.name);
    if (!parsed) return lib;
    const base = lib.url || fallbackBase;
    return { ...lib, downloads: { artifact: { path: parsed.path, url: base.replace(/\/+$/, '') + '/' + parsed.path } } };
  });
}

async function downloadLibraries(libs, onProgress) {
  const tasks = [];
  for (const lib of libs || []) {
    const artifact = lib.downloads?.artifact;
    if (!artifact?.path || !artifact?.url) continue;
    const dest = path.join(dirs.libraries, artifact.path.split('/').join(path.sep));
    if (fs.existsSync(dest)) continue;
    tasks.push({ url: artifact.url, dest, label: path.basename(artifact.path) });
  }
  if (!tasks.length) return 0;
  let done = 0;
  await net.pool(tasks, Math.max(4, settings.get().downloadConcurrency), async task => {
    try { await net.download(task.url, task.dest, { timeout: 120000 }); }
    catch (err) { console.warn('[loaders] 库下载失败', task.label, err.message); }
    done += 1;
    onProgress({ stage: '依赖库', message: task.label, current: done, total: tasks.length, percent: Math.round((done / tasks.length) * 100) });
  });
  return tasks.length;
}

// ---------- 原版 ----------
async function ensureBase(mc, onProgress) {
  const raw = versions.readRaw(mc);
  const jar = versions.clientJar(mc);
  if (raw && jar && fs.existsSync(jar)) {
    msg(onProgress, '准备', `原版 ${mc} 已就绪`);
    return;
  }
  msg(onProgress, '原版', `开始下载原版 ${mc}`, { percent: 0 });
  await versions.install(mc, progress => {
    const percent = progress.total ? Math.round((progress.current / Math.max(progress.total, 1)) * 100) : 0;
    onProgress({ stage: '原版', message: `${progress.stage} ${progress.item || ''}`.trim(), percent });
  });
}

// ---------- Fabric / Quilt ----------
async function installFabricLike(kind, mc, loaderVersion, onProgress) {
  const list = await listVersions(kind, mc);
  if (!list.length) throw new Error(`${kind === 'quilt' ? 'Quilt' : 'Fabric'} 没有为 ${mc} 提供加载器版本`);
  const pick = loaderVersion || list[0].version;
  const label = kind === 'quilt' ? 'Quilt' : 'Fabric';
  msg(onProgress, label, `获取 ${label} ${pick} 配置`, { percent: 5 });

  const bases = mirror.prefer(kind === 'quilt' ? QUILT_META : FABRIC_META);
  const api = kind === 'quilt'
    ? `/v3/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(pick)}/profile/json`
    : `/v2/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(pick)}/profile/json`;
  const profile = await jsonFirst(bases.map(base => base + api));

  const fallback = kind === 'quilt' ? QUILT_MAVEN : FABRIC_MAVEN;
  profile.libraries = normalizeLibraries(profile.libraries, fallback);
  const versionId = profile.id || `${kind}-loader-${pick}-${mc}`;
  versions.writeVersionJson(versionId, { ...profile, inheritsFrom: mc });
  msg(onProgress, label, `写入版本 ${versionId}`, { percent: 20 });
  await downloadLibraries(profile.libraries, onProgress);
  msg(onProgress, label, `${label} ${pick} 安装完成`, { percent: 100 });
  return versionId;
}

// ---------- Forge / NeoForge ----------
async function ensureJavaFor(mc, onProgress) {
  const json = versions.read(mc);
  const major = json?.javaVersion?.majorVersion || 17;
  const list = await java.scanCached(false);
  const chosen = java.pickJava(list, major);
  if (chosen && chosen.major >= major) return chosen.path;
  msg(onProgress, 'Java', `缺少 Java ${major}，正在下载运行时`, { percent: 0 });
  const entry = await javadl.ensure(major, progress => onProgress({
    stage: 'Java',
    message: progress.message || `下载 Java ${major}`,
    percent: progress.percent || 0,
  }));
  await java.scanCached(true);
  return entry.path;
}

function runInstaller(javaPath, jarFile, onProgress, label) {
  return new Promise((resolve, reject) => {
    const proc = spawn(javaPath, ['-jar', jarFile, '--installClient', dirs.game], { cwd: dirs.game, windowsHide: true });
    let out = '';
    let lastOutput = Date.now();
    // 安装器会从官方 maven 拉库，网络受限时会长时间静默：3 分钟没输出就判失败，避免无限等待
    const watchdog = setInterval(() => {
      if (Date.now() - lastOutput > 180000) {
        clearInterval(watchdog);
        try { proc.kill(); } catch (_) {}
        reject(new Error(`${label} 安装器长时间无响应（可能是 maven 源不可达），请稍后重试或换网络`));
      }
    }, 10000);
    const feed = chunk => {
      lastOutput = Date.now();
      out += chunk.toString('utf-8');
      const lines = out.split(/\r?\n/);
      out = lines.pop() || '';
      for (const line of lines) {
        const text = line.trim();
        // 官方安装器刷的是日志行，没有可信百分比，交给界面走不确定进度
        if (text) onProgress({ stage: label, message: text.slice(0, 160), indeterminate: true });
      }
    };
    proc.stdout.on('data', feed);
    proc.stderr.on('data', feed);
    proc.on('error', err => { clearInterval(watchdog); reject(err); });
    proc.on('close', code => {
      clearInterval(watchdog);
      if (out.trim()) onProgress({ stage: label, message: out.trim().slice(0, 160) });
      if (code === 0) resolve();
      else reject(new Error(`${label} 安装器退出码 ${code}`));
    });
  });
}

async function installForgeLike(kind, mc, loaderVersion, onProgress) {
  const list = await listVersions(kind, mc);
  if (!list.length) {
    throw new Error(`${kind === 'neoforge' ? 'NeoForge' : 'Forge'} 暂不支持 ${mc}（该版本还没有对应构建）`);
  }
  const pick = loaderVersion || list[0].version;
  const label = kind === 'neoforge' ? 'NeoForge' : 'Forge';
  const stream = kind === 'neoforge' ? neoForgeStream(mc) : null;
  const artifactVersion = kind === 'neoforge'
    ? (list.find(item => item.version === pick)?.artifactVersion || pick)
    : `${mc}-${pick}`;
  const artifactPath = kind === 'neoforge' ? stream.artifact : 'net/minecraftforge/forge';
  const fileName = kind === 'neoforge' ? `neoforge-${pick}-installer.jar` : `forge-${artifactVersion}-installer.jar`;
  const bases = mirror.prefer(kind === 'neoforge' ? NEO_MAVEN : FORGE_MAVEN);
  const installer = path.join(dirs.temp, fileName);

  msg(onProgress, label, `下载 ${label} ${pick} 安装器`, { percent: 8 });
  let lastError = null;
  for (const base of bases) {
    const url = `${base}/${artifactPath}/${artifactVersion}/${fileName}`;
    try {
      await net.download(url, installer, { timeout: 180000 });
      lastError = null;
      break;
    } catch (err) { lastError = err; }
  }
  if (lastError) throw new Error(`下载 ${label} 安装器失败：${lastError.message}`);

  versions.ensureLauncherProfiles();
  const javaPath = await ensureJavaFor(mc, onProgress);
  msg(onProgress, label, '运行官方安装器（首次可能需要 1-3 分钟）', { percent: 25 });

  const before = new Set(fs.existsSync(dirs.versions) ? fs.readdirSync(dirs.versions) : []);
  await runInstaller(javaPath, installer, onProgress, label);
  const after = fs.readdirSync(dirs.versions);
  const created = after.filter(id => !before.has(id));

  let versionId = created.find(id => {
    const raw = versions.readRaw(id);
    return raw && raw.inheritsFrom === mc;
  });
  if (!versionId) {
    // 安装器可能复用已有目录，按命名规则兜底
    const guess = id => versions.readRaw(id)?.inheritsFrom === mc;
    versionId = after.filter(guess).sort((a, b) => b.length - a.length)[0] || '';
  }
  if (!versionId) throw new Error(`${label} 安装器执行完成，但没有找到生成的版本目录`);
  fs.rmSync(installer, { force: true });
  msg(onProgress, label, `${label} ${pick} 安装完成（${versionId}）`, { percent: 100 });
  return versionId;
}

// ---------- OptiFine ----------
async function installOptiFine(mc, loaderVersion, onProgress) {
  const list = await listVersions('optifine', mc);
  if (!list.length) throw new Error(`OptiFine 没有 ${mc} 的版本`);
  const pick = list.find(item => `${item.type}_${item.patch}` === loaderVersion) || list[0];

  // OptiFine 1.13+ 只能以模组形式跑在 Forge 上，这里顺带把 Forge 装好
  msg(onProgress, 'OptiFine', 'OptiFine 需要 Forge，先安装 Forge', { percent: 4 });
  const forgeVersionId = await installForgeLike('forge', mc, '', progress => onProgress({ ...progress, percent: Math.round((progress.percent || 0) * 0.7) }));

  fs.mkdirSync(dirs.mods, { recursive: true });
  const dest = path.join(dirs.mods, pick.filename);
  if (!fs.existsSync(dest)) {
    msg(onProgress, 'OptiFine', `下载 ${pick.filename}`, { percent: 75 });
    let lastError = null;
    for (const base of OPTIFINE_API) {
      const url = `${base}/optifine/${encodeURIComponent(mc)}/${encodeURIComponent(pick.type)}/${encodeURIComponent(pick.patch)}`;
      try { await net.download(url, dest, { timeout: 180000 }); lastError = null; break; }
      catch (err) { lastError = err; }
    }
    if (lastError) throw new Error('下载 OptiFine 失败：' + lastError.message);
  }
  msg(onProgress, 'OptiFine', `已放入 mods：${pick.filename}`, { percent: 100 });
  return { versionId: forgeVersionId, modFile: dest };
}

// ---------- Fabric API ----------
async function installFabricApi(mc, onProgress) {
  msg(onProgress, 'Fabric API', '查找 Fabric API 匹配文件', { percent: 0 });
  const project = await net.requestJson(`${MODRINTH}/project/fabric-api`);
  const all = await net.requestJson(`${MODRINTH}/project/${project.id}/version?game_versions=${encodeURIComponent(JSON.stringify([mc]))}&loaders=${encodeURIComponent(JSON.stringify(['fabric']))}`);
  const list = (Array.isArray(all) ? all : []).filter(version => version.version_type === 'release');
  const version = list[0] || (Array.isArray(all) ? all[0] : null);
  if (!version) throw new Error(`Fabric API 没有 ${mc} 的构建`);
  const file = (version.files || []).find(item => item.primary) || (version.files || [])[0];
  if (!file?.url) throw new Error('Fabric API 没有可下载文件');
  fs.mkdirSync(dirs.mods, { recursive: true });
  const dest = path.join(dirs.mods, file.filename);
  await net.download(file.url, dest, {
    sha1: file.hashes?.sha1,
    timeout: 120000,
    onProgress: (current, total) => onProgress({
      stage: 'Fabric API', message: file.filename,
      percent: total ? Math.round((current / total) * 100) : 0,
    }),
  });
  return dest;
}

/**
 * 安装一个游戏版本 + 可选加载器。
 * @param {{mc:string, kind:string, loaderVersion?:string, fabricApi?:boolean, onProgress?:Function}} options
 */
async function install(options = {}) {
  const { mc, kind = 'vanilla', loaderVersion = '', fabricApi = false } = options;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  if (!mc) throw new Error('缺少游戏版本');

  await ensureBase(mc, onProgress);
  let versionId = mc;
  let modFiles = [];

  if (kind === 'fabric' || kind === 'quilt') {
    versionId = await installFabricLike(kind, mc, loaderVersion, onProgress);
  } else if (kind === 'forge' || kind === 'neoforge') {
    versionId = await installForgeLike(kind, mc, loaderVersion, onProgress);
  } else if (kind === 'optifine') {
    const result = await installOptiFine(mc, loaderVersion, onProgress);
    versionId = result.versionId;
    modFiles.push(result.modFile);
  } else if (kind !== 'vanilla') {
    throw new Error('未知加载器: ' + kind);
  }

  if (fabricApi) {
    // Fabric API 只在 Fabric / Quilt 下有意义
    const supported = kind === 'fabric' || kind === 'quilt';
    if (supported) modFiles.push(await installFabricApi(mc, onProgress));
    else msg(onProgress, 'Fabric API', 'Fabric API 只能装在 Fabric / Quilt 上，已跳过');
  }

  msg(onProgress, '完成', `已安装 ${versionId}`, { percent: 100 });
  return { versionId, modFiles, versions: versions.list() };
}

module.exports = {
  CATALOG, install, listVersions, loaderInfo, ensureBase,
  listOptiFine, installFabricApi, mavenPath,
};
