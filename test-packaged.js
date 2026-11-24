'use strict';
// 打包产物冒烟测试：直接运行 dist/win-unpacked/FedbyLauncher.exe，确认 asar 与 fedby:// 协议正常。
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PORT = 9231;
const EXE = process.env.EXE ? path.resolve(process.env.EXE) : path.join(__dirname, 'dist', 'win-unpacked', 'FedbyLauncher.exe');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const getJson = url => new Promise((resolve, reject) => {
  http.get(url, res => { let body = ''; res.on('data', d => body += d); res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } }); }).on('error', reject);
});

(async () => {
  if (!fs.existsSync(EXE)) { console.log('FAIL: 找不到打包后的 exe'); process.exit(1); }
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
  if (!page) { console.log('FAIL: 打包后窗口未加载界面'); try { require('child_process').execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: 'ignore' }); } catch (_) {} process.exit(1); }
  console.log('页面协议:', page.url.slice(0, 40));

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
    else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(a => a.value ?? a.description).join(' '));
  };
  const send = (method, params = {}) => new Promise(resolve => { const current = ++id; pending.set(current, resolve); ws.send(JSON.stringify({ id: current, method, params })); });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.result?.exceptionDetails) return { error: result.result.exceptionDetails.text };
    return result.result?.result?.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(4000);

  const overview = await evaluate(`(() => ({
    navItems: [...document.querySelectorAll('.nav-item')].map(n => n.textContent.trim()),
    hasHero: !!document.querySelector('.hero'),
    versionText: document.querySelector('.hero-title')?.textContent,
    javaText: document.querySelector('#java-settings')?.previousElementSibling?.value || '',
    appVersion: document.body.dataset.boot || '',
  }))()`);
  console.log('首屏:', JSON.stringify(overview));

  // 关键：打包后 main 进程的路径与服务是否可用
  const services = await evaluate(`(async () => {
    const info = await window.fedby.app.info();
    const list = await window.fedby.versions.list();
    return {
      ok: info.ok && list.ok,
      info: info.ok ? { version: info.data.version, data: info.data.dataDir, electron: info.data.electron } : info.error,
      versions: list.ok ? list.data.map(v => v.id) : list.error,
    };
  })()`);
  console.log('主进程服务:', JSON.stringify(services));

  for (const pageId of ['versions', 'download', 'settings']) {
    await evaluate(`document.querySelector('.nav-item[data-page="${pageId}"]').click()`);
    await sleep(2000);
    const info = await evaluate(`(() => ({
      page: document.querySelector('.page-title')?.textContent,
      cards: document.querySelectorAll('#view .card').length,
      rows: document.querySelectorAll('#view .list-row').length,
    }))()`);
    console.log(pageId + ':', JSON.stringify(info));
  }

  await evaluate(`document.querySelector('.nav-item[data-page="launch"]').click()`);
  await sleep(1200);
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('packaged-running.png', Buffer.from(screenshot.result.data, 'base64'));

  console.log('控制台错误:', errors.length ? errors : '无');
  ws.close();
  try { require('child_process').execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: 'ignore' }); } catch (_) {}
  setTimeout(() => process.exit(0), 400);
})().catch(error => { console.error('测试异常', error); process.exit(1); });
