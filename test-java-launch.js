'use strict';
// 用「启动器自己下载的 Java」真实启动 26.3，验证下载的运行时能跑游戏
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PORT = 9243;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const getJson = url => new Promise((resolve, reject) => {
  http.get(url, res => { let body = ''; res.on('data', d => body += d); res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } }); }).on('error', reject);
});

(async () => {
  const runtimes = require('./src/main/services/javadl').list();
  const target = runtimes.find(item => item.feature === 25);
  if (!target) { console.log('FAIL: 没有已下载的 Java 25，先跑 node test-javadl.js'); process.exit(1); }
  console.log('使用运行时:', target.path);

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe'),
    [__dirname, `--remote-debugging-port=${PORT}`], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => process.stdout.write('[主进程] ' + chunk));

  let targets = [];
  for (let i = 0; i < 80; i += 1) {
    try {
      targets = await getJson(`http://127.0.0.1:${PORT}/json/list`);
      if (targets.some(t => /index\.html/.test(t.url))) break;
    } catch (_) {}
    await sleep(500);
  }
  const page = targets.find(t => /index\.html/.test(t.url));
  if (!page) { console.log('FAIL: 窗口未加载'); try { require('child_process').execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: 'ignore' }); } catch (_) {}; process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
    else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  };
  const send = (method, params = {}) => new Promise(resolve => { const current = ++id; pending.set(current, resolve); ws.send(JSON.stringify({ id: current, method, params })); });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.result?.exceptionDetails) return { error: result.result.exceptionDetails.text };
    return result.result?.result?.value;
  };

  await send('Runtime.enable');
  await sleep(3500);

  const prepared = await evaluate(`(async () => {
    const list = await window.fedby.accounts.list();
    for (const account of (list.data || [])) if (account.name === 'JavaSmoke') await window.fedby.accounts.remove(account.id);
    const created = await window.fedby.accounts.createOffline('JavaSmoke');
    if (!created.ok) return created.error;
    const res = await window.fedby.game.launch({
      versionId: '26.3', accountId: created.data.id,
      javaPath: ${JSON.stringify(target.path)}, autoJava: false, autoMemory: false, memoryMB: 4096,
    });
    return res.ok ? res.data.pid : res.error;
  })()`);
  console.log('启动结果:', prepared);

  await sleep(45000);
  const state = await evaluate(`(() => {
    const lines = [...document.querySelectorAll('.log-line')].map(node => node.textContent);
    return {
      count: lines.length,
      head: lines.slice(0, 4),
      hasMenu: lines.some(line => /Backend library|OpenAL initialized|Sound engine started|Created:\\s*.*minecraft:textures|Stopping!/i.test(line)),
      crashed: lines.some(line => /Error:|Exception in thread|Could not find or load main class/i.test(line)),
      status: document.querySelector('#status-text')?.textContent,
    };
  })()`);
  console.log('日志行数:', state.count, '| 进主菜单:', state.hasMenu, '| 状态:', state.status);
  console.log('日志开头:', JSON.stringify(state.head, null, 1));
  console.log('使用下载的 Java:', (state.head[0] || '').includes('runtimes'));

  await evaluate(`window.fedby.game.stop()`);
  await sleep(2500);
  await evaluate(`(async () => {
    const list = await window.fedby.accounts.list();
    for (const account of (list.data || [])) if (account.name === 'JavaSmoke') await window.fedby.accounts.remove(account.id);
    return true;
  })()`);
  console.log('控制台错误:', errors.length ? errors : '无');

  ws.close();
  try { require('child_process').execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: 'ignore' }); } catch (_) {}
  setTimeout(() => process.exit(0), 300);
})().catch(error => { console.error('测试异常', error); process.exit(1); });
