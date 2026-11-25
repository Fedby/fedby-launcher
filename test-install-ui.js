'use strict';
// 端到端：在沙盒数据目录里用界面安装一个带加载器的版本
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PORT = 9233;
const SANDBOX = 'C:\\Users\\Fedby\\Documents\\MinecraftLauncher\\.tmp-loader-test\\appdata';
const MC = process.argv[2] || '1.21.1';
const KIND = process.argv[3] || 'fabric';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const getJson = url => new Promise((resolve, reject) => {
  http.get(url, res => { let body = ''; res.on('data', d => body += d); res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } }); }).on('error', reject);
});

(async () => {
  const env = { ...process.env, APPDATA: SANDBOX };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe'),
    [__dirname, `--remote-debugging-port=${PORT}`,
      ...(process.env.FEDBY_TEST_PROFILE ? [`--user-data-dir=${process.env.FEDBY_TEST_PROFILE}`] : [])], { env, stdio: 'ignore' });

  let page = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const targets = await getJson(`http://127.0.0.1:${PORT}/json/list`);
      page = targets.find(t => /index\.html/.test(t.url));
      if (page) break;
    } catch (_) {}
    await sleep(500);
  }
  if (!page) { console.log('FAIL 窗口未加载'); process.exit(1); }

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
    if (result.result?.exceptionDetails) return { __error: result.result.exceptionDetails.exception?.description || result.result.exceptionDetails.text };
    return result.result?.result?.value;
  };
  const shot = async name => {
    const result = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, name), Buffer.from(result.result.data, 'base64'));
  };
  const waitFor = async (expression, timeout = 60000, step = 800) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await evaluate(expression)) return true;
      await sleep(step);
    }
    return false;
  };

  await send('Runtime.enable');
  await sleep(2500);
  await evaluate("document.querySelector('[data-page=\"download\"]').click()");
  await sleep(2000);
  console.log('数据目录:', await evaluate("window.fedby.app.info().then(i=>i.dataDir)"));

  // 打开目标版本
  const opened = await evaluate(`(()=>{
    const groups=[...document.querySelectorAll('.mc-group')];
    const head=document.querySelector('[data-toggle="release"]');
    if(head && !document.querySelector('.mc-group[data-group="release"]').classList.contains('open')) head.click();
    return true;
  })()`);
  await sleep(600);
  const clicked = await evaluate(`(()=>{const b=document.querySelector('[data-mc="${MC}"]'); if(!b) return 'no-button'; b.click(); return 'ok';})()`);
  console.log('点击安装', MC, clicked);
  await sleep(1500);
  console.log('加载器状态:', await evaluate("[...document.querySelectorAll('.dl-loader')].map(b=>b.querySelector('.dl-loader-name').textContent+'='+b.querySelector('.dl-loader-state').textContent).join(' | ')"));

  // 选中目标加载器
  const picked = await evaluate(`(()=>{const rows=[...document.querySelectorAll('.dl-loader')]; const row=rows.find(r=>r.dataset.kind==='${KIND}'); if(!row) return 'no-row'; row.click(); return 'ok';})()`);
  await sleep(800);
  console.log('选择加载器', KIND, picked, '| 版本:', await evaluate("document.querySelector('#lv-select')?.value"));
  await shot('shot-dl-install-e2e-before.png');

  const started = await evaluate("(()=>{const b=document.querySelector('#dl-go'); if(!b||b.disabled) return 'disabled'; b.click(); return 'started';})()");
  console.log('开始下载:', started);
  await sleep(1200);
  await shot('shot-dl-install-e2e-running.png');
  console.log('进度:', await evaluate("document.querySelector('#dl-go-text')?.textContent || ''"));
  await sleep(12000);
  await shot('shot-dl-install-e2e-running2.png');
  console.log('进度 13s:', await evaluate("document.querySelector('#dl-go-text')?.textContent || ''"), '| 百分比:', await evaluate("document.querySelector('#dl-go-fill')?.style.width || ''"));

  // 轮询直到安装完成（install 视图关闭）或超时
  const done = await waitFor("!document.querySelector('#dl-go')", 240000, 1500);
  console.log('安装结束:', done);
  await sleep(800);
  await shot('shot-dl-install-e2e-done.png');
  console.log('版本列表:', await evaluate("[...document.querySelectorAll('.mc-row-id')].slice(0,6).map(n=>n.textContent.trim().replace(/\\s+/g,' ')).join(' | ')"));
  console.log('当前选中版本:', await evaluate("window.__fedbyState?.selection?.versionId || (document.querySelector('.badge.green')?.parentElement?.textContent||'').trim()"));

  console.log('错误数:', errors.length);
  errors.slice(0, 5).forEach(e => console.log('  错误:', String(e).slice(0, 200)));

  ws.close();
  try { execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' }); } catch (_) {}
  process.exit(done ? 0 : 2);
})().catch(error => { console.error('FAIL', error); process.exit(1); });
