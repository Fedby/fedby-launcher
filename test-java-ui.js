'use strict';
// 界面验证：设置页的「下载 Java」按钮、进度条、运行时标记
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PORT = 9229;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const getJson = url => new Promise((resolve, reject) => {
  http.get(url, res => { let body = ''; res.on('data', d => body += d); res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } }); }).on('error', reject);
});

(async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe'),
    [__dirname, `--remote-debugging-port=${PORT}`,
      ...(process.env.FEDBY_TEST_PROFILE ? [`--user-data-dir=${process.env.FEDBY_TEST_PROFILE}`] : [])], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => process.stdout.write('[主进程] ' + chunk));
  child.stderr.on('data', chunk => process.stdout.write('[主进程错误] ' + chunk));

  let targets = [];
  for (let i = 0; i < 80; i += 1) {
    try {
      targets = await getJson(`http://127.0.0.1:${PORT}/json/list`);
      if (targets.some(t => /index\.html/.test(t.url))) break;
    } catch (_) {}
    await sleep(500);
  }
  const page = targets.find(t => /index\.html/.test(t.url));
  if (!page) { console.log('FAIL: 窗口未加载'); try { require('child_process').execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: 'ignore' }); } catch (_) {} process.exit(1); }

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

  // 1. 设置页现状
  await evaluate(`document.querySelector('.nav-item[data-page="settings"]').click()`);
  await sleep(1500);
  const initial = await evaluate(`(async () => ({
    runtimes: (await window.fedby.java.runtimes()).data,
    javaList: (await window.fedby.java.list(false)).data.map(item => item.vendor + ' @ ' + item.path),
    button: document.querySelector('#download-java')?.textContent.trim(),
    ownedBadges: [...document.querySelectorAll('#java-list .badge')].filter(b => b.textContent.includes('启动器下载')).length,
    javaRows: document.querySelectorAll('#java-list .java-item').length,
    hint: document.querySelector('.hint-box')?.textContent.replace(/\\s+/g, ' ').trim().slice(0, 90),
  }))()`);
  console.log('设置页初始:', JSON.stringify(initial));
  await shot('java-settings.png');

  // 2. 删掉已下载的运行时，模拟「本机没有这个 Java」
  const removed = await evaluate(`window.fedby.java.removeRuntime(25).then(r => r.ok ? r.data.runtimes.length : r.error)`);
  console.log('删除后剩余运行时:', removed);
  await evaluate(`document.querySelector('.nav-item[data-page="settings"]').click()`);
  await sleep(1200);

  // 3. 点「下载 Java 25」，页内每 200ms 采样进度条状态
  await evaluate(`(() => {
    window.__samples = [];
    clearInterval(window.__timer);
    window.__timer = setInterval(() => {
      const wrap = document.querySelector('#java-dl');
      window.__samples.push({
        visible: wrap ? wrap.style.display !== 'none' : null,
        text: document.querySelector('#java-dl-text')?.textContent || '',
        percent: document.querySelector('#java-dl-percent')?.textContent || '',
        status: document.querySelector('#status-text')?.textContent || '',
      });
    }, 200);
  })()`);
  await evaluate(`document.querySelector('#download-java').click()`);
  await sleep(1300);
  await shot('java-downloading.png');

  // 4. 等完成
  let runtimes = [];
  for (let i = 0; i < 240; i += 1) {
    const result = await evaluate(`window.fedby.java.runtimes().then(r => r.data)`);
    if (Array.isArray(result) && result.length) { runtimes = result; break; }
    await sleep(500);
  }
  console.log('下载完成，运行时:', runtimes.map(item => `Java ${item.feature} @ ${item.version}`).join(' | ') || '超时');

  const samples = await evaluate(`(() => { clearInterval(window.__timer); return window.__samples.filter(s => s.visible); })()`);
  console.log('进度条可见采样:', samples.length, '条');
  const texts = [...new Set((samples || []).map(item => item.text))].slice(0, 6);
  for (const text of texts) console.log('   ·', text);

  await sleep(2000);
  const final = await evaluate(`(() => ({
    progressHidden: document.querySelector('#java-dl')?.style.display === 'none',
    buttonDisabled: document.querySelector('#download-java')?.disabled,
    ownedBadges: [...document.querySelectorAll('#java-list .badge')].filter(b => b.textContent.includes('启动器下载')).length,
    selected: document.querySelector('.java-item.active .java-path')?.textContent || '',
    status: document.querySelector('#status-text')?.textContent,
  }))()`);
  console.log('完成后:', JSON.stringify(final));
  await shot('java-settings-done.png');

  // 5. 启动页显示
  await evaluate(`document.querySelector('.nav-item[data-page="launch"]').click()`);
  await sleep(1500);
  const launchPage = await evaluate(`(() => ({
    javaLabel: document.querySelector('#java-settings')?.previousElementSibling?.value,
    javaDlVisible: document.querySelector('#java-dl')?.style.display !== 'none',
  }))()`);
  console.log('启动页:', JSON.stringify(launchPage));
  await shot('java-launch.png');

  console.log('控制台错误:', errors.length ? errors : '无');
  ws.close();
  try { require('child_process').execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: 'ignore' }); } catch (_) {}
  setTimeout(() => process.exit(0), 300);
})().catch(error => { console.error('测试异常', error); process.exit(1); });
