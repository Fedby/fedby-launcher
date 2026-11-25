'use strict';
// 自定义下拉框验证：增强、弹层定位、搜索过滤、键盘操作、程序赋值同步、弹窗内层级
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PORT = 9236;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const getJson = url => new Promise((resolve, reject) => {
  http.get(url, res => { let body = ''; res.on('data', d => body += d); res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } }); }).on('error', reject);
});

(async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe'),
    [__dirname, `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(process.env.TEMP || '/tmp', 'fedby-select-probe')}`],
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
  if (!page) { console.log('FAIL 窗口未加载'); child.kill(); process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
    else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(arg => arg.value ?? arg.description).join(' '));
  };
  const send = (method, params = {}) => new Promise(resolve => { const current = ++id; pending.set(current, resolve); ws.send(JSON.stringify({ id: current, method, params })); });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.result?.exceptionDetails) return { __error: result.result.exceptionDetails.text + ' ' + (result.result.exceptionDetails.exception?.description || '') };
    return result.result?.result?.value;
  };
  const shot = async name => {
    const result = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, name), Buffer.from(result.result.data, 'base64'));
    console.log('截图', name);
  };
  const log = (...parts) => console.log(parts.map(part => (typeof part === 'object' ? JSON.stringify(part) : part)).join(' '));
  const clickBtn = target => evaluate(`(()=>{const b=document.querySelector('#${target}')?.parentElement.querySelector('.cs-btn'); if(!b) return 'no-btn'; b.click(); return 'clicked';})()`);

  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(2600);

  // ---- 启动页 ----
  log('启动页 · 原生 select:', await evaluate("document.querySelectorAll('select.select').length"),
    '→ 增强:', await evaluate("document.querySelectorAll('.cs').length"));
  log('启动页 · 按钮文字:', await evaluate("document.querySelector('#version-select')?.parentElement.querySelector('.cs-label')?.textContent.trim()"));
  log('启动页 · 原生已隐藏:', await evaluate("(()=>{const s=document.querySelector('#version-select'); if(!s) return 'none'; const st=getComputedStyle(s); return st.opacity+'/'+st.pointerEvents;})()"));

  await clickBtn('version-select');
  await sleep(320);
  log('启动页 · 弹层:', await evaluate("(()=>{const p=document.querySelector('.cs-pop.cs-open'); if(!p) return 'none'; const r=p.getBoundingClientRect(); const s=getComputedStyle(p); return Math.round(r.width)+'x'+Math.round(r.height)+' r='+s.borderRadius+' shadow='+(s.boxShadow!=='none')+' outline='+s.outlineStyle;})()"));
  log('启动页 · 项数 / 高亮:', await evaluate("document.querySelectorAll('.cs-pop.cs-open .cs-item').length + ' / ' + document.querySelectorAll('.cs-pop.cs-open .cs-item.active').length"));
  await shot('shot-select-launch.png');

  const picked = await evaluate(`(()=>{
    const items=[...document.querySelectorAll('.cs-pop.cs-open .cs-item')];
    if(items.length<2) return '';
    const text=items[1].querySelector('.cs-item-text').textContent.trim();
    items[1].click();
    return text;
  })()`);
  await sleep(350);
  log('启动页 · 选中', picked, '→ value:', await evaluate("document.querySelector('#version-select')?.value"),
    '按钮:', await evaluate("document.querySelector('#version-select')?.parentElement.querySelector('.cs-label')?.textContent.trim()"),
    '弹层关闭:', await evaluate("!document.querySelector('.cs-pop.cs-open')"));
  log('程序赋值同步:', await evaluate(`(()=>{
    const s=document.querySelector('#version-select');
    if(!s) return 'none';
    s.value=s.options[0].value;
    return s.parentElement.querySelector('.cs-label').textContent.trim()===s.options[0].textContent.trim();
  })()`));

  // ---- 下载页社区资源 ----
  await evaluate("document.querySelector('[data-page=\\\"download\\\"]')?.click()");
  await sleep(1800);
  await evaluate("document.querySelector('[data-section=\\\"mod\\\"]')?.click()");
  await sleep(5200);
  log('下载页 · 筛选区下拉:', await evaluate("[...document.querySelectorAll('.filter .cs-btn')].map(b=>b.textContent.trim()).join(' | ')"));
  await shot('shot-select-download.png');

  await clickBtn('dl-gv');
  await sleep(420);
  log('长列表 · 搜索框:', await evaluate("!!document.querySelector('.cs-pop.cs-open .cs-search input')"),
    '项数:', await evaluate("document.querySelectorAll('.cs-pop.cs-open .cs-item').length"));
  log('长列表 · 不越界:', await evaluate("(()=>{const r=document.querySelector('.cs-pop.cs-open').getBoundingClientRect(); return r.top>=0 && r.bottom<=window.innerHeight+1 && r.left>=0 && r.right<=window.innerWidth+1;})()"));
  await shot('shot-select-long.png');

  const before = await evaluate("document.querySelectorAll('.cs-pop.cs-open .cs-item').length");
  await evaluate(`(()=>{
    const input=document.querySelector('.cs-pop.cs-open .cs-search input');
    input.value='${process.argv[2] || '1.21'}';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(260);
  log('搜索过滤:', `${before} → ${await evaluate("document.querySelectorAll('.cs-pop.cs-open .cs-item').length")}`,
    '首项:', await evaluate("document.querySelector('.cs-pop.cs-open .cs-item')?.textContent.trim()"));
  await shot('shot-select-search.png');

  log('键盘选中:', await evaluate(`(()=>{
    const input=document.querySelector('.cs-pop.cs-open .cs-search input');
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
    const t=document.querySelector('.cs-pop.cs-open .cs-item.cursor .cs-item-text')?.textContent.trim()||'';
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    return t;
  })()`));
  await sleep(1200);
  log('选中后 dl-gv:', await evaluate("(()=>{const s=document.querySelector('#dl-gv'); return s.value+' / '+s.parentElement.querySelector('.cs-label').textContent.trim();})()"),
    '副标题:', await evaluate("document.querySelector('.dl-section-desc')?.textContent.trim()"));
  await shot('shot-select-applied.png');

  // Esc 关闭
  await clickBtn('dl-sort');
  await sleep(200);
  const opened = await evaluate("!!document.querySelector('.cs-pop.cs-open')");
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  await sleep(200);
  log('Esc 关闭:', `${opened} → ${await evaluate("!document.querySelector('.cs-pop.cs-open')")}`);

  // 点外部关闭
  const clickRet = await clickBtn('dl-gv');
  await sleep(250);
  log('点外部关闭 · 点击结果:', clickRet, '→ 打开:', await evaluate("!!document.querySelector('.cs-pop.cs-open')"));
  await evaluate("document.querySelector('.search-card')?.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))");
  await sleep(200);
  log('点外部关闭:', await evaluate("!document.querySelector('.cs-pop.cs-open')"));

  // ---- 安装视图（整页重渲染）里的「加载器版本」下拉 ----
  await evaluate("document.querySelector('[data-section=\\\"game\\\"]')?.click()");
  await sleep(1600);
  await evaluate("(()=>{const b=[...document.querySelectorAll('[data-mc]')]; b[b.length-1]?.click();})()");
  await sleep(7000);
  log('安装视图 · 加载器行:', await evaluate("[...document.querySelectorAll('[data-kind]')].map(b=>b.dataset.kind).join(',')"));
  await evaluate("document.querySelector('[data-kind=\\\"fabric\\\"]')?.click()");
  await sleep(2500);
  log('安装视图 · lv-select:', await evaluate("!!document.querySelector('#lv-select')"),
    '项数:', await evaluate("document.querySelector('#lv-select')?.options.length"));
  await clickBtn('lv-select');
  await sleep(400);
  log('安装视图 · 弹层:', await evaluate("document.querySelectorAll('.cs-pop.cs-open .cs-item').length"),
    '搜索框:', await evaluate("!!document.querySelector('.cs-pop.cs-open .cs-search input')"),
    '在最上层:', await evaluate(`(()=>{
      const p=document.querySelector('.cs-pop.cs-open');
      if(!p) return 'none';
      const r=p.getBoundingClientRect();
      const top=document.elementFromPoint(r.left+r.width/2, r.top+Math.min(18, r.height/2));
      return p.contains(top) ? 'yes' : 'blocked by ' + (top?.className || top?.tagName);
    })()`));
  await shot('shot-select-install.png');
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))");

  log('控制台错误:', errors.length ? errors.slice(0, 5) : '无');
  console.log('完成');
  ws.close();
  await sleep(300);
  child.kill();
  process.exit(0);
})().catch(error => { console.log('FAIL', error.message); process.exit(1); });
