'use strict';
// 只做界面核对：把设置页 Java 卡片滚到视野内并截图（含下载中的进度条）
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PORT = 9247;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const getJson = url => new Promise((resolve, reject) => {
  http.get(url, res => { let body = ''; res.on('data', d => body += d); res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } }); }).on('error', reject);
});

(async () => {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const ROOT = path.join(__dirname, '..');
  const child = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    [ROOT, `--remote-debugging-port=${PORT}`], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', d => process.stdout.write('[主进程] ' + d));

  let targets = [];
  for (let i = 0; i < 60; i += 1) {
    try { targets = await getJson(`http://127.0.0.1:${PORT}/json/list`); if (targets.some(t => /index\.html/.test(t.url))) break; } catch (_) {}
    await sleep(500);
  }
  const page = targets.find(t => /index\.html/.test(t.url));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value; };
  const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(name, Buffer.from(r.result.data, 'base64')); };

  await send('Runtime.enable'); await send('Page.enable'); await sleep(3500);
  await ev(`document.querySelector('.nav-item[data-page="settings"]').click()`); await sleep(1500);
  await ev(`document.querySelector('#java-list')?.scrollIntoView({ block: 'center' })`); await sleep(600);
  await shot('shot-java-card.png');

  // 删掉现有运行时后点真实按钮，这样才能走到界面自己的进度链路
  await ev(`window.fedby.java.removeRuntime(25)`);
  await ev(`document.querySelector('.nav-item[data-page="settings"]').click()`);
  await sleep(1200);
  await ev(`document.querySelector('#java-list')?.scrollIntoView({ block: 'center' })`);
  await ev(`document.querySelector('#download-java').click()`);
  let mid = null;
  for (let i = 0; i < 80; i += 1) {
    await sleep(120);
    const sample = await ev(`(() => { const box = document.querySelector('#java-dl'); return box && box.style.display !== 'none' ? { text: document.querySelector('#java-dl-text').textContent, percent: document.querySelector('#java-dl-percent').textContent } : null; })()`);
    if (sample && sample.text && /下载|解压|获取/.test(sample.text)) {
      mid = sample;
      await ev(`document.querySelector('#java-list')?.scrollIntoView({ block: 'center' })`);
      await sleep(200);
      await shot('shot-java-progress.png');
      break;
    }
  }
  console.log('中途状态:', JSON.stringify(mid));

  for (let i = 0; i < 240; i += 1) {
    const list = await ev(`window.fedby.java.runtimes().then(r => r.data.map(x => x.feature))`);
    if (Array.isArray(list) && list.includes(25)) { console.log('Java 25 已重新就绪'); break; }
    await sleep(500);
  }
  await sleep(1500);
  await ev(`document.querySelector('#java-list')?.scrollIntoView({ block: 'center' })`);
  await sleep(400);
  await shot('shot-java-done.png');

  ws.close();
  try { require('child_process').execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: 'ignore' }); } catch (_) {}
  setTimeout(() => process.exit(0), 300);
})().catch(error => { console.error('异常', error); process.exit(1); });
