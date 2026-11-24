'use strict';
// 新版启动器冒烟测试：加载界面、检查控制台错误、遍历四个页面并截图
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PORT = 9226;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const getJson = url => new Promise((resolve, reject) => {
  http.get(url, res => { let body = ''; res.on('data', d => body += d); res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } }); }).on('error', reject);
});

(async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe'),
    [__dirname, `--remote-debugging-port=${PORT}`], { env, stdio: 'ignore' });

  let targets = [];
  for (let i = 0; i < 80; i += 1) {
    try {
      targets = await getJson(`http://127.0.0.1:${PORT}/json/list`);
      if (targets.some(t => /index\.html/.test(t.url))) break;
    } catch (_) {}
    await sleep(500);
  }
  const page = targets.find(t => /index\.html/.test(t.url));
  if (!page) { console.log('FAIL: 窗口未加载'); child.kill(); process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  const errors = [];
  const logs = [];
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    } else if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    } else if (message.method === 'Runtime.consoleAPICalled') {
      const text = message.params.args.map(arg => arg.value ?? arg.description).join(' ');
      logs.push(`[${message.params.type}] ${text}`);
      if (message.params.type === 'error') errors.push(text);
    }
  };
  const send = (method, params = {}) => new Promise(resolve => { const current = ++id; pending.set(current, resolve); ws.send(JSON.stringify({ id: current, method, params })); });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.result?.exceptionDetails) return { error: result.result.exceptionDetails.text };
    return result.result?.result?.value;
  };
  const shot = async name => {
    const result = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(name, Buffer.from(result.result.data, 'base64'));
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(3500);

  const overview = await evaluate(`(() => ({
    navItems: [...document.querySelectorAll('.nav-item')].map(n => n.textContent.trim()),
    hasHero: !!document.querySelector('.hero'),
    title: document.querySelector('.page-title')?.textContent,
    versionText: document.querySelector('.hero-title')?.textContent,
    accounts: document.querySelectorAll('.acc-chip').length,
    javaText: document.querySelector('#java-settings')?.previousElementSibling?.value || '',
  }))()`);
  console.log('首屏:', JSON.stringify(overview));
  await shot('new-launch.png');

  for (const pageId of ['versions', 'download', 'settings']) {
    await evaluate(`document.querySelector('.nav-item[data-page="${pageId}"]').click()`);
    await sleep(2200);
    const info = await evaluate(`(() => ({
      page: document.querySelector('.page-title')?.textContent,
      cards: document.querySelectorAll('#view .card').length,
      rows: document.querySelectorAll('#view .list-row').length,
      empty: !!document.querySelector('#view .empty'),
    }))()`);
    console.log(pageId + ':', JSON.stringify(info));
    await shot(`new-${pageId}.png`);
  }

  console.log('控制台错误:', errors.length ? errors : '无');
  const notable = logs.filter(line => /失败|错误|未定义/.test(line));
  if (notable.length) console.log('可疑日志:', notable);

  ws.close();
  child.kill();
  setTimeout(() => process.exit(0), 300);
})().catch(error => { console.error('测试异常', error); process.exit(1); });
