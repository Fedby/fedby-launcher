'use strict';
// 端到端启动测试：创建临时离线账户 → 启动 26.3 → 读取日志判断是否进入主菜单 → 停止并清理账户
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PORT = 9228;
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
  };
  const send = (method, params = {}) => new Promise(resolve => { const current = ++id; pending.set(current, resolve); ws.send(JSON.stringify({ id: current, method, params })); });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.result?.exceptionDetails) throw new Error(result.result.exceptionDetails.text + ' ' + (result.result.exceptionDetails.exception?.description || ''));
    return result.result?.result?.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(3200);

  // 清理上次测试可能残留的账户，再创建新的
  await evaluate(`(async () => {
    const listed = await window.fedby.accounts.list();
    const list = listed.ok ? listed.data : [];
    for (const account of list) if (account.name === 'SmokeTest') await window.fedby.accounts.remove(account.id);
    const created = await window.fedby.accounts.createOffline('SmokeTest');
    return created.ok ? created.data.name : created.error;
  })()`);
  await evaluate(`location.reload()`);
  await sleep(4500);

  const ready = await evaluate(`(() => ({
    account: document.querySelector('.account-chip-name')?.textContent,
    version: document.querySelector('.hero-title')?.textContent,
    launchText: document.querySelector('#btn-launch')?.textContent.trim(),
  }))()`);
  console.log('准备状态:', JSON.stringify(ready));

  await evaluate(`document.querySelector('#btn-launch').click()`);
  console.log('已点击启动，等待 45 秒…');
  await sleep(45000);

  const state = await evaluate(`(() => {
    const lines = [...document.querySelectorAll('.log-line')].map(n => n.textContent);
    return {
      count: lines.length,
      head: lines.slice(0, 6),
      tail: lines.slice(-8),
      hasMainMenu: lines.some(line => /Backend library|OpenAL initialized|Sound engine started|Created:\\s*.*minecraft:textures|Stopping!/i.test(line)),
      status: document.querySelector('#status-text')?.textContent,
    };
  })()`);
  console.log('日志行数:', state.count);
  console.log('日志开头:', JSON.stringify(state.head));
  console.log('日志结尾:', JSON.stringify(state.tail));
  console.log('进主菜单标志:', state.hasMainMenu, '| 状态:', state.status);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('new-launch-running.png', Buffer.from(shot.result.data, 'base64'));

  // 停止游戏 + 清理账户
  await evaluate(`(async () => { await window.fedby.game.stop(); })()`);
  await sleep(1500);
  await evaluate(`(async () => {
    const listed = await window.fedby.accounts.list();
    const list = listed.ok ? listed.data : [];
    for (const account of list) if (account.name === 'SmokeTest') await window.fedby.accounts.remove(account.id);
  })()`);
  console.log('控制台错误:', errors.length ? errors : '无');

  ws.close(); try { require('child_process').execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: 'ignore' }); } catch (_) {} setTimeout(() => process.exit(0), 500);
})().catch(error => { console.error('测试异常', error); process.exit(1); });
