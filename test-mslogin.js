'use strict';
// 微软登录 GUI 验证：打开登录弹窗 → 点击按钮 → 检查是否真的打开了微软官方登录窗口 → 关闭窗口检查取消处理
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const PORT = 9223;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = url => new Promise((resolve, reject) => {
  http.get(url, res => {
    let b = ''; res.on('data', d => b += d);
    res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
  }).on('error', reject);
});

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = []; }
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new CDP(ws);
    ws.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.id && c.pending.has(msg.id)) {
        const { resolve, reject } = c.pending.get(msg.id);
        c.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        c.errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        c.errors.push(msg.params.args.map(a => a.value || a.description).join(' '));
      }
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
    return r.result.value;
  }
}

(async () => {
  const electron = path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [path.join(__dirname), `--remote-debugging-port=${PORT}`], {
    env,
    stdio: 'ignore',
  });

  let targets = [];
  for (let i = 0; i < 60; i++) {
    try {
      targets = await getJson(`http://127.0.0.1:${PORT}/json/list`);
      if (targets.some(t => t.type === 'page' && /index\.html/.test(t.url))) break;
    } catch (_) {}
    await sleep(500);
  }
  const page = targets.find(t => t.type === 'page' && /index\.html/.test(t.url));
  if (!page) { console.log('FAIL: 主窗口未启动'); try { require('child_process').execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: 'ignore' }); } catch (_) {} process.exit(1); }

  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await sleep(1200);

  // 1) 打开微软登录弹窗
  await cdp.eval('showMicrosoftLogin()');
  await sleep(400);
  const ui = await cdp.eval(`(() => ({
    hasModal: !!document.querySelector('#modal-root .modal'),
    title: document.querySelector('.modal-title')?.textContent,
    svgCount: document.querySelectorAll('#modal-root svg.ms-logo').length,
    heroColored: [...document.querySelectorAll('#modal-root svg.ms-logo rect')].map(r => r.getAttribute('fill')).join(','),
    btnText: document.querySelector('#ms-login')?.textContent.trim(),
    btnHasSvg: !!document.querySelector('#ms-login svg.ms-logo'),
  }))()`);
  console.log('弹窗 UI:', JSON.stringify(ui, null, 0));

  // 2) 点击「打开微软登录窗口」
  await cdp.eval(`document.querySelector('#ms-login').click()`);
  await sleep(6000);

  let list = await getJson(`http://127.0.0.1:${PORT}/json/list`);
  const msWin = list.find(t => t.type === 'page' && /login\.live\.com|login\.microsoftonline\.com/.test(t.url));
  console.log('登录窗口:', msWin ? JSON.stringify({ title: msWin.title, url: msWin.url.slice(0, 130) }) : '未找到');
  const stateOn = await cdp.eval(`(() => {
    const s = document.querySelector('#ms-state');
    const b = document.querySelector('#ms-login');
    return { stateVisible: !!s && s.classList.contains('on'), btnDisabled: !!b && b.disabled, btnText: b && b.textContent.trim() };
  })()`);
  console.log('等待状态:', JSON.stringify(stateOn));

  // 3) 关掉登录窗口，验证取消后能重新打开
  if (msWin) {
    await new Promise(res => {
      http.get(`http://127.0.0.1:${PORT}/json/close/${msWin.id}`, r => { r.resume(); r.on('end', res); }).on('error', res);
    });
  }
  await sleep(2500);
  const after = await cdp.eval(`(() => {
    const b = document.querySelector('#ms-login');
    return {
      btnDisabled: !!b && b.disabled,
      btnText: b && b.textContent.trim(),
      stateVisible: !!document.querySelector('#ms-state')?.classList.contains('on'),
      toast: [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | '),
    };
  })()`);
  console.log('取消后:', JSON.stringify(after));

  // 4) 再开一次，直接伪造回调地址，验证 code 拦截 + 兑换链路
  await cdp.eval(`document.querySelector('#ms-login').click()`);
  await sleep(6000);
  list = await getJson(`http://127.0.0.1:${PORT}/json/list`);
  const msWin2 = list.find(t => t.type === 'page' && /login\.live\.com/.test(t.url));
  if (msWin2) {
    const w2 = await CDP.connect(msWin2.webSocketDebuggerUrl);
    await w2.send('Runtime.enable');
    const form = await w2.eval(`(() => ({
      hasEmail: !!document.querySelector('input[type=email],input[name=loginfmt]'),
      text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 120),
    }))()`);
    console.log('登录页表单:', JSON.stringify(form));
    await w2.send('Page.navigate', { url: 'https://login.live.com/oauth20_desktop.srf?code=FAKE_TEST_CODE' });
    await sleep(5000);
    const flow = await cdp.eval(`(() => ({
      modalOpen: !!document.querySelector('#modal-root .modal'),
      btnText: document.querySelector('#ms-login')?.textContent.trim(),
      btnDisabled: !!document.querySelector('#ms-login')?.disabled,
      toast: [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | '),
    }))()`);
    console.log('回调拦截后:', JSON.stringify(flow));
    const left = (await getJson(`http://127.0.0.1:${PORT}/json/list`)).filter(t => /login\.live\.com/.test(t.url));
    console.log('登录窗口残留:', left.length);
    w2.ws.close();
  } else {
    console.log('FAIL: 第二次未能打开登录窗口');
  }
  console.log('控制台错误:', cdp.errors.length ? cdp.errors : '无');

  cdp.ws.close();
  try { require('child_process').execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: 'ignore' }); } catch (_) {}
  setTimeout(() => process.exit(0), 300);
})().catch(e => { console.error('测试脚本异常:', e); process.exit(1); });
