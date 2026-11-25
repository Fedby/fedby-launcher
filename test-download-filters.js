'use strict';
// 各资源子页验证：类型筛选标签、点标签直接搜索、每页推荐、版本切换自动重搜、安装弹窗
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PORT = 9234;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const getJson = url => new Promise((resolve, reject) => {
  http.get(url, res => { let body = ''; res.on('data', d => body += d); res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } }); }).on('error', reject);
});

(async () => {
  const env = { ...process.env };
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
  const chips = () => evaluate("[...document.querySelectorAll('.chip')].map(c=>c.textContent.trim()).join(' | ')");
  const recCount = () => evaluate("document.querySelectorAll('.recommend-card').length");
  const summary = () => evaluate("document.querySelector('.result-summary')?.textContent.trim() || '(无结果)'");

  await send('Runtime.enable');
  await sleep(2500);
  await evaluate("document.querySelector('[data-page=\"download\"]').click()");
  await sleep(2500);

  // ---- 光影包 ----
  await evaluate("document.querySelector('[data-section=\"shader\"]').click()");
  await sleep(5000);
  console.log('光影 · 类型标签:', await chips());
  console.log('光影 · 推荐数量:', await recCount());
  await shot('shot-filter-shader.png');

  const picked = await evaluate("(()=>{const c=[...document.querySelectorAll('.chip')].find(x=>x.textContent.trim()==='奇幻'); if(!c) return ''; c.click(); return c.textContent.trim();})()");
  await sleep(6000);
  console.log('光影 · 点了标签:', picked, '→', await summary());
  console.log('光影 · 结果首项:', await evaluate("document.querySelector('.result-title')?.textContent.trim() || '-'"));
  console.log('光影 · 副标题:', await evaluate("document.querySelector('.dl-section-desc')?.textContent.trim()"));
  await shot('shot-filter-shader-cat.png');

  // ---- 整合包 ----
  await evaluate("document.querySelector('[data-section=\"modpack\"]').click()");
  await sleep(5000);
  console.log('整合包 · 类型标签:', (await chips()).slice(0, 160));
  console.log('整合包 · 推荐数量:', await recCount());
  await shot('shot-filter-modpack.png');

  // ---- 地图（只有 CurseForge）----
  await evaluate("document.querySelector('[data-section=\"world\"]').click()");
  await sleep(5000);
  console.log('地图 · 来源标签:', await evaluate("[...document.querySelectorAll('.source-tab')].map(t=>t.textContent.trim()).join(' | ')"));
  console.log('地图 · 类型标签:', await chips());
  console.log('地图 · 推荐数量:', await recCount());
  await shot('shot-filter-world.png');

  // ---- 插件 ----
  await evaluate("document.querySelector('[data-section=\"plugin\"]').click()");
  await sleep(5000);
  console.log('插件 · 类型标签前 8:', (await chips()).split(' | ').slice(0, 8).join(' | '));
  console.log('插件 · 推荐数量:', await recCount());

  // ---- 数据包 ----
  await evaluate("document.querySelector('[data-section=\"datapack\"]').click()");
  await sleep(5000);
  console.log('数据包 · 类型标签前 6:', (await chips()).split(' | ').slice(0, 6).join(' | '));
  console.log('数据包 · 推荐数量:', await recCount());

  // ---- 资源包 ----
  await evaluate("document.querySelector('[data-section=\"resourcepack\"]').click()");
  await sleep(5000);
  console.log('资源包 · 类型标签数量:', await evaluate("document.querySelectorAll('.chip').length"), '更多按钮:', await evaluate("document.querySelector('[data-cat-more]')?.textContent.trim() || '无'"));
  console.log('资源包 · 推荐数量:', await recCount());
  await shot('shot-filter-rp.png');

  // ---- 版本选择：切换到其它版本应自动重搜 ----
  await evaluate("document.querySelector('[data-section=\"mod\"]').click()");
  await sleep(5000);
  console.log('Mod · 推荐数量:', await recCount());
  const gvOptions = await evaluate("(()=>{const s=document.querySelector('#dl-gv'); return s.options.length+' 个选项，前 5: '+[...s.options].slice(0,5).map(o=>o.textContent).join('/');})()");
  console.log('Mod · 版本选择:', gvOptions);
  await evaluate("(()=>{const s=document.querySelector('#dl-gv'); const opt=[...s.options].find(o=>/^1\\.21/.test(o.value)); if(opt){ s.value=opt.value; s.dispatchEvent(new Event('change')); return opt.value; } return '';})()");
  await sleep(6000);
  console.log('Mod · 切版本后结果:', await summary());
  console.log('Mod · 推荐随筛选刷新:', await recCount());
  await shot('shot-filter-mod.png');

  // ---- 结果卡「安装」弹窗仍可用 ----
  await evaluate("document.querySelector('.result-card [data-install]')?.click()");
  await sleep(7000);
  console.log('安装弹窗:', await evaluate("document.querySelector('.modal') ? '已打开' : '未打开'"));
  console.log('弹窗文件数:', await evaluate("document.querySelector('#file-count')?.textContent.trim() || '(无)'"));
  await shot('shot-filter-install.png');
  await evaluate("(()=>{const b=document.querySelector('.modal [data-close]'); if(b) b.click();})()");
  await sleep(600);
  console.log('弹窗已关闭:', await evaluate("document.querySelector('.modal') ? '仍在' : '已关闭'"));

  console.log('错误数:', errors.length);
  errors.slice(0, 8).forEach(e => console.log('  错误:', String(e).slice(0, 200)));

  ws.close();
  try { execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' }); } catch (_) {}
  process.exit(errors.length ? 2 : 0);
})().catch(error => { console.error('FAIL', error); process.exit(1); });
