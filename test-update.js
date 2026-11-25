'use strict';
// 自更新验证：版本号比对（单元）、真实 GitHub Release 查询、启动时弹窗流程（界面）
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const PORT = 9261;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const getJson = url => new Promise((resolve, reject) => {
  http.get(url, res => { let body = ''; res.on('data', d => body += d); res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } }); }).on('error', reject);
});
const log = (...parts) => console.log(parts.map(part => (typeof part === 'object' ? JSON.stringify(part) : part)).join(' '));

const MOCK = {
  tag_name: 'v9.9.9',
  name: 'Fedby 启动器 9.9.9',
  body: [
    '## 新增',
    '- 启动时自动检查更新，发现新版弹窗询问',
    '- **下载源** 支持自动择优，失败自动回退',
    '',
    '## 修复',
    '- 加载器卡片展开后边框出现台阶',
    '- 下拉框宽度随版本号长短跳动',
    '',
    '> 建议所有用户升级',
  ].join('\n'),
  published_at: '2026-11-25T09:00:00Z',
  html_url: 'https://github.com/Fedby/fedby-launcher/releases/tag/v9.9.9',
  assets: [
    {
      name: 'FedbyLauncher-Setup-9.9.9.exe',
      size: 102400123,
      browser_download_url: 'https://github.com/Fedby/fedby-launcher/releases/download/v9.9.9/FedbyLauncher-Setup-9.9.9.exe',
    },
    {
      name: 'FedbyLauncher-Portable-9.9.9.exe',
      size: 95000123,
      browser_download_url: 'https://github.com/Fedby/fedby-launcher/releases/download/v9.9.9/FedbyLauncher-Portable-9.9.9.exe',
    },
  ],
};

(async () => {
  // ---------- 1. 版本号比对 ----------
  const update = require('./src/main/services/update');
  const cases = [
    ['1.4.0', '1.3.2', 1],
    ['1.3.2', '1.3.2', 0],
    ['1.3.1', '1.3.2', -1],
    ['1.10.0', '1.9.9', 1],
    ['2.0.0', '1.99.99', 1],
    ['1.4.0', '1.4.0-beta.1', 1],
    ['1.4.0-beta.1', '1.4.0-beta.2', -1],
  ];
  let pass = 0;
  for (const [a, b, expect] of cases) {
    const got = Math.sign(update.compareVersion(update.parseVersion(a), update.parseVersion(b)));
    if (got !== expect) throw new Error(`compareVersion(${a}, ${b}) = ${got}，期望 ${expect}`);
    pass += 1;
  }
  log('版本号比对:', `${pass}/${cases.length} 通过`, '非法输入:', update.parseVersion('abc') === null);

  // ---------- 2. 真实 GitHub Release ----------
  const real = await update.check({ force: true });
  log('GitHub 最新版本:', real.error ? 'FAIL ' + real.error : `v${real.version}（当前 v${real.current}，更新=${real.newer}）`,
    '资源:', real.asset ? real.asset.name : '无');

  // ---------- 3. 启动时弹窗（用假 release，避免真下载 90MB） ----------
  const mockFile = path.join(os.tmpdir(), 'fedby-release-mock.json');
  fs.writeFileSync(mockFile, JSON.stringify(MOCK, null, 2));

  // 上一轮测试可能把 9.9.9 记成「跳过」，先清掉，保证每次都能看到弹窗
  const configFile = path.join(process.env.APPDATA || '', 'FedbyLauncher', 'config.json');
  const resetSkip = () => {
    try {
      const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
      if (config.skippedVersion) {
        config.skippedVersion = '';
        fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf-8');
      }
      config.autoCheckUpdate = true;
      fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf-8');
    } catch (_) {}
  };
  resetSkip();

  const env = { ...process.env, FEDBY_UPDATE_MOCK: mockFile };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe'),
    [__dirname, `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(os.tmpdir(), 'fedby-update-probe')}`],
    { env, stdio: 'ignore' });

  let page = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const targets = await getJson(`http://127.0.0.1:${PORT}/json/list`);
      page = targets.find(t => /index\.html/.test(t.url));
      if (page) break;
    } catch (_) {}
    await sleep(500);
  }
  if (!page) { console.log('FAIL 窗口未加载'); child.kill(); process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
    else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(arg => arg.value ?? arg.description).join(' '));
  };
  const send = (method, params = {}) => new Promise(resolve => { const current = ++id; pending.set(current, resolve); ws.send(JSON.stringify({ id: current, method, params })); });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.result?.exceptionDetails) return { __error: result.result.exceptionDetails.text };
    return result.result?.result?.value;
  };
  const shot = async name => {
    const result = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, name), Buffer.from(result.result.data, 'base64'));
    console.log('截图', name);
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(2600);

  // 启动后约 2.6 秒才检查，等弹窗出现
  let opened = false;
  for (let i = 0; i < 24; i += 1) {
    opened = await evaluate("!!document.querySelector('.modal')");
    if (opened) break;
    await sleep(500);
  }
  log('启动时弹窗:', opened);
  log('弹窗标题:', await evaluate("document.querySelector('.modal-title')?.textContent.trim()"));
  log('弹窗副标题:', await evaluate("document.querySelector('.modal-sub')?.textContent.trim()"));
  log('说明行数:', await evaluate("document.querySelectorAll('.upd-notes > div').length"),
    '要点:', await evaluate("[...document.querySelectorAll('.upd-notes .upd-li')].slice(0,2).map(n=>n.textContent.trim())"));
  log('按钮:', await evaluate("[...document.querySelectorAll('.modal-foot .btn')].map(b=>b.textContent.trim()).join(' | ')"));
  log('弹层挡住操作?:', await evaluate("getComputedStyle(document.querySelector('.modal-mask')).zIndex"));
  await shot('shot-update-modal.png');

  // 跳过此版本
  const skipped = await evaluate("(()=>{const b=document.querySelector('#upd-skip'); if(!b) return 'no-btn'; b.click(); return 'clicked';})()");
  await sleep(900);
  log('跳过:', skipped, '→ 弹窗关闭:', await evaluate("!document.querySelector('.modal')"),
    '已记录:', await evaluate("window.fedby.settings.get().then(r=>r.data?.skippedVersion || r.skippedVersion).catch(()=>'?')"));

  // 设置页：检查更新按钮 + 自动检查开关
  await evaluate("document.querySelector('[data-page=\\\"settings\\\"]')?.click()");
  await sleep(1200);
  log('设置页 · 按钮:', await evaluate("!!document.querySelector('#check-update')"),
    '开关:', await evaluate("document.querySelector('#set-auto-update')?.checked"),
    '发布页按钮:', await evaluate("!!document.querySelector('#open-release')"));

  await evaluate("document.querySelector('#check-update')?.click()");
  await sleep(2000);
  log('设置页 · 检查结果:', await evaluate("document.querySelector('#update-hint')?.textContent.trim()"));
  log('设置页 · 弹窗重现:', await evaluate("!!document.querySelector('.modal')"));

  // 点「下载并安装」→ 假地址必然 404，验证失败能恢复按钮、不会卡死
  const downloading = await evaluate("(()=>{const b=document.querySelector('#upd-go'); if(!b) return 'no-btn'; b.click(); return 'clicked';})()");
  let errText = '';
  for (let i = 0; i < 30; i += 1) {
    errText = await evaluate("document.querySelector('.toast.err')?.textContent.trim() || ''");
    if (errText) break;
    await sleep(300);
  }
  log('下载失败处理:', downloading, '→ 提示:', errText || '无',
    '进度条已收起:', await evaluate("document.querySelector('#upd-progress')?.hidden !== false"),
    '按钮可用:', await evaluate("[...document.querySelectorAll('.modal-foot .btn')].every(b=>!b.disabled)"));

  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))");
  await evaluate("document.querySelector('.modal-x')?.click()");
  await sleep(400);
  log('弹窗关闭:', await evaluate("!document.querySelector('.modal')"));
  await evaluate("document.querySelector('#check-update')?.scrollIntoView({block:'center'})");
  await sleep(500);
  await shot('shot-update-settings.png');

  log('控制台错误:', errors.length ? errors.slice(0, 4) : '无');
  console.log('完成');
  resetSkip();
  ws.close();
  await sleep(200);
  child.kill();
  process.exit(0);
})().catch(error => { console.log('FAIL', error.message); process.exit(1); });
