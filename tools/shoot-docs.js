'use strict';
// 生成 README 配图：用打包产物跑一遍界面，截四个页面，结束后删除临时账户。
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PORT = 9233;
const EXE = path.join(__dirname, '..', 'dist', 'win-unpacked', 'FedbyLauncher.exe');
const OUT = path.join(__dirname, '..', 'docs');
const ACCOUNT = 'Steve';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const getJson = url => new Promise((resolve, reject) => {
  http.get(url, res => { let body = ''; res.on('data', d => body += d); res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } }); }).on('error', reject);
});

(async () => {
  if (!fs.existsSync(EXE)) throw new Error('请先打包：npm run dist');
  fs.mkdirSync(OUT, { recursive: true });

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(EXE, [`--remote-debugging-port=${PORT}`], { env, stdio: 'ignore' });

  let targets = [];
  for (let i = 0; i < 90; i += 1) {
    try {
      targets = await getJson(`http://127.0.0.1:${PORT}/json/list`);
      if (targets.some(t => /index\.html/.test(t.url))) break;
    } catch (_) {}
    await sleep(500);
  }
  const page = targets.find(t => /index\.html/.test(t.url));
  if (!page) throw new Error('窗口未加载');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  };
  const send = (method, params = {}) => new Promise(resolve => { const current = ++id; pending.set(current, resolve); ws.send(JSON.stringify({ id: current, method, params })); });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    return result.result?.result?.value;
  };
  const shot = async name => {
    const result = await send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(OUT, name);
    fs.writeFileSync(file, Buffer.from(result.result.data, 'base64'));
    console.log('已保存', path.relative(process.cwd(), file), (fs.statSync(file).size / 1024).toFixed(0) + 'KB');
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(4000);

  // 建一个干净的演示账户
  await evaluate(`(async () => {
    const listed = await window.fedby.accounts.list();
    for (const item of (listed.ok ? listed.data : [])) if (item.name === '${ACCOUNT}') await window.fedby.accounts.remove(item.id);
    await window.fedby.accounts.createOffline('${ACCOUNT}');
  })()`);
  await evaluate(`location.reload()`);
  await sleep(4500);
  await shot('screenshot-launch.png');

  for (const [pageId, file, wait] of [['download', 'screenshot-download.png', 6000], ['versions', 'screenshot-versions.png', 1800], ['settings', 'screenshot-settings.png', 1800]]) {
    await evaluate(`document.querySelector('.nav-item[data-page="${pageId}"]').click()`);
    await sleep(wait);
    await shot(file);
  }

  // 清理演示账户
  await evaluate(`(async () => {
    const listed = await window.fedby.accounts.list();
    for (const item of (listed.ok ? listed.data : [])) if (item.name === '${ACCOUNT}') await window.fedby.accounts.remove(item.id);
  })()`);

  ws.close();
  child.kill();
  setTimeout(() => process.exit(0), 400);
})().catch(error => { console.error('截图失败:', error.message); process.exit(1); });
