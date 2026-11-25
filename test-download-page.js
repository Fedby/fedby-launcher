'use strict';
// 下载页改版验证：子页布局、版本分组、加载器安装视图 + 截图
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PORT = 9231;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const getJson = url => new Promise((resolve, reject) => {
  http.get(url, res => { let body = ''; res.on('data', d => body += d); res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } }); }).on('error', reject);
});

(async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe'),
    [__dirname, `--remote-debugging-port=${PORT}`,
      ...(process.env.FEDBY_TEST_PROFILE ? [`--user-data-dir=${process.env.FEDBY_TEST_PROFILE}`] : [])],
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
    else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      errors.push(message.params.args.map(arg => arg.value ?? arg.description).join(' '));
    }
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
  await sleep(2500);
  await evaluate("document.querySelector('[data-page=\"download\"]').click()");
  await sleep(2500);
  console.log('子页:', await evaluate("[...document.querySelectorAll('.dl-nav')].map(b=>b.textContent.trim()).join(' | ')"));
  console.log('版本总数:', await evaluate("window.__t = document.querySelectorAll('.mc-group').length"));
  console.log('分组:', await evaluate("[...document.querySelectorAll('.mc-group-head')].map(b=>b.textContent.replace(/\\s+/g,' ').trim()).join(' | ')"));
  await shot('shot-dl-v1-game.png');

  // 展开正式版
  await evaluate("document.querySelector('[data-toggle=\"release\"]').click()");
  await sleep(600);
  console.log('正式版前五行:', await evaluate("[...document.querySelectorAll('.mc-group[data-group=\"release\"] .mc-row-id')].slice(0,5).map(n=>n.textContent.trim()).join(' | ')"));
  await shot('shot-dl-v2-release.png');

  // 进入安装视图
  const first = await evaluate("(()=>{const b=document.querySelector('.mc-group[data-group=\"release\"] [data-mc]'); if(!b) return ''; const id=b.dataset.mc; b.click(); return id;})()");
  console.log('打开安装视图:', first);
  await sleep(4000);
  console.log('加载器行:', await evaluate("[...document.querySelectorAll('.dl-loader')].map(b=>b.querySelector('.dl-loader-name').textContent+':'+b.querySelector('.dl-loader-state').textContent).join(' | ')"));
  await shot('shot-dl-v3-install.png');

  // 选中 Fabric 和 Fabric API
  await evaluate("(()=>{const rows=[...document.querySelectorAll('.dl-loader')]; const fab=rows.find(r=>r.textContent.includes('Fabric')&&!r.textContent.includes('API')); fab && fab.click();})()");
  await sleep(700);
  console.log('Fabric 版本选项:', await evaluate("(()=>{const s=document.querySelector('#lv-select'); return s? s.options.length+' 个，首个 '+s.options[0].textContent : '无';})()"));
  await shot('shot-dl-v4-fabric.png');

  // 社区资源子页
  await evaluate("document.querySelector('[data-section=\"shader\"]').click()");
  await sleep(700);
  await shot('shot-dl-v5-shader.png');
  console.log('资源页按钮:', await evaluate("document.querySelector('#dl-search') ? '搜索按钮 OK' : '缺失'"));

  await evaluate("document.querySelector('[data-section=\"game\"]').click(); ");
  await sleep(500);
  console.log('错误数:', errors.length);
  errors.slice(0, 6).forEach(e => console.log('  错误:', String(e).slice(0, 200)));

  ws.close();
  try { execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' }); } catch (_) {}
  process.exit(errors.length ? 2 : 0);
})().catch(error => { console.error('FAIL', error); process.exit(1); });
