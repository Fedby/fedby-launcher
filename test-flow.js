'use strict';
// 交互测试：推荐、搜索、安装弹窗、版本检查弹窗
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PORT = 9227;
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
    try { targets = await getJson(`http://127.0.0.1:${PORT}/json/list`); if (targets.some(t => /index\.html/.test(t.url))) break; } catch (_) {}
    await sleep(500);
  }
  const page = targets.find(t => /index\.html/.test(t.url));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
    else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      errors.push(message.params.args.map(arg => arg.value ?? arg.description).join(' '));
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

  // 1) 下载页：推荐
  await evaluate(`document.querySelector('.nav-item[data-page="download"]').click()`);
  await sleep(9000);
  console.log('推荐:', JSON.stringify(await evaluate(`(() => ({
    cards: document.querySelectorAll('.recommend-card').length,
    firstName: document.querySelector('.recommend-name')?.textContent,
    loadingText: document.querySelector('#recommend .spinner') ? 'still-loading' : 'done',
  }))()`)));

  // 2) 搜索（中文名验证）
  await evaluate(`(() => { const input = document.querySelector('#dl-q'); input.value='create'; input.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#dl-search').click(); })()`);
  await sleep(9000);
  const search = await evaluate(`(() => ({
    cards: document.querySelectorAll('.result-card').length,
    summary: document.querySelector('.result-summary')?.textContent,
    names: [...document.querySelectorAll('.result-title')].slice(0,5).map(n => n.textContent),
    originals: [...document.querySelectorAll('.result-original')].slice(0,5).map(n => n.textContent),
  }))()`);
  console.log('搜索:', JSON.stringify(search));
  await shot('new-search.png');

  // 3) 安装弹窗
  await evaluate(`document.querySelector('.result-card [data-install]').click()`);
  await sleep(6000);
  const dialog = await evaluate(`(() => ({
    title: document.querySelector('.modal-title')?.textContent,
    files: document.querySelectorAll('.file-item').length,
    count: document.querySelector('#file-count')?.textContent,
    mc: document.querySelector('#pick-mc')?.value,
    options: document.querySelectorAll('#pick-mc option').length,
    startDisabled: document.querySelector('#install-start')?.disabled,
  }))()`);
  console.log('安装弹窗:', JSON.stringify(dialog));
  await shot('new-install-dialog.png');
  await evaluate(`document.querySelector('.modal-x').click()`);
  await sleep(400);

  // 4) 版本检查弹窗
  await evaluate(`document.querySelector('.nav-item[data-page="versions"]').click()`);
  await sleep(1200);
  await evaluate(`document.querySelector('[data-check]').click()`);
  await sleep(1500);
  const check = await evaluate(`(() => ({
    tabs: [...document.querySelectorAll('.tab-bar .tab')].map(t => t.textContent.trim()),
    kv: document.querySelectorAll('.info-grid .kv').length,
    dirs: document.querySelectorAll('.dir-card').length,
    path: document.querySelector('.path-line')?.textContent?.slice(0, 40),
  }))()`);
  console.log('版本检查:', JSON.stringify(check));
  await shot('new-version-check.png');

  // 5) 切换到存档标签，验证空状态
  await evaluate(`document.querySelector('.tab-bar [data-tab="saves"]').click()`);
  await sleep(1200);
  console.log('存档标签:', JSON.stringify(await evaluate(`(() => ({
    barText: document.querySelector('.section-title')?.textContent,
    empty: !!document.querySelector('.empty'),
  }))()`)));

  console.log('控制台错误:', errors.length ? errors : '无');
  ws.close(); try { require('child_process').execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: 'ignore' }); } catch (_) {} setTimeout(() => process.exit(0), 300);
})().catch(error => { console.error('测试异常', error); process.exit(1); });
