// 渲染层入口：注册页面、装载数据、绑定全局事件
import { $ } from './lib/dom.js';
import { listen } from './lib/ipc.js';
import { toastErr, setStatus } from './lib/ui.js';
import { state, bootstrapCore, bootstrapLazy, refreshJava } from './store.js';
import { registerPage, navigate, rerender } from './router.js';
import { mountChrome, syncChrome } from './shell.js';
import { initSelects } from './components/select.js';
import { scheduleUpdateCheck } from './components/updater.js';

import launchPage from './pages/launch.js';
import versionsPage from './pages/versions.js';
import downloadPage, { refreshQueue, paintLoaderProgress } from './pages/download.js';
import settingsPage from './pages/settings.js';

registerPage(launchPage);
registerPage(versionsPage);
registerPage(downloadPage);
registerPage(settingsPage);

// 所有 <select class="select"> 自动升级成自绘下拉（含之后动态插入的）
initSelects();

function appendLog(entry) {
  state.logs.push(entry);
  if (state.logs.length > 600) state.logs.splice(0, state.logs.length - 600);
  const terminal = $('#log-terminal');
  if (!terminal) return;
  const line = document.createElement('div');
  line.className = `log-line ${entry.stream === 'error' ? 'err' : entry.stream === 'system' ? 'sys' : ''}`;
  line.textContent = entry.text;
  terminal.appendChild(line);
  while (terminal.childElementCount > 400) terminal.firstElementChild.remove();
  terminal.scrollTop = terminal.scrollHeight;
}

/** 只改进度条节点，避免每个进度回调都整页重渲染 */
function paintJavaProgress() {
  const wrap = document.querySelector('#java-dl');
  if (!wrap) return;
  const dl = state.javaDl;
  wrap.style.display = dl.active ? '' : 'none';
  const fill = document.querySelector('#java-dl-fill');
  if (fill) fill.style.width = (dl.percent || 0) + '%';
  const text = document.querySelector('#java-dl-text');
  if (text) text.textContent = dl.message || '';
  const percent = document.querySelector('#java-dl-percent');
  if (percent) percent.textContent = (dl.percent || 0) + '%';
}

function wireGlobalEvents() {
  listen('gameLog', entry => {
    appendLog(entry);
    if (entry.stream === 'system' && /游戏已退出/.test(entry.text)) {
      state.launching = false;
      const button = $('#btn-launch');
      if (button) { button.disabled = false; button.innerHTML = '启动游戏'; }
      const stop = $('#btn-stop');
      if (stop) stop.style.display = 'none';
    }
  });

  listen('installProgress', progress => {
    state.install = {
      running: true,
      stage: `${progress.stage || ''}${progress.item ? ' · ' + progress.item : ''}`,
      percent: progress.total ? Math.round((progress.current / progress.total) * 100) : 0,
    };
    const fill = $('#install-fill');
    const label = $('#install-stage');
    const percent = $('#install-percent');
    if (fill) fill.style.width = state.install.percent + '%';
    if (label) label.textContent = state.install.stage;
    if (percent) percent.textContent = state.install.percent + '%';
  });

  listen('downloadProgress', progress => {
    const page = document.querySelector('#dl-queue');
    const entry = { ...progress, name: progress.item || '下载', at: Date.now() };
    const key = entry.name;
    const queue = state.download.queue;
    const existing = queue.find(item => item.name === key);
    if (existing) Object.assign(existing, entry);
    else queue.unshift(entry);
    if (queue.length > 12) queue.pop();
    if (state.page === 'download') refreshQueue();
  });

  // 加载器安装进度（原版 / Fabric / Forge / NeoForge / OptiFine）
  listen('loadersProgress', progress => {
    if (state.page === 'download') paintLoaderProgress(progress);
  });

  // Java 运行时下载：进度只刷新进度条，结束时才重渲染并重新扫描
  listen('javaProgress', progress => {
    const done = progress.phase === 'done';
    const failed = progress.phase === 'error';
    state.javaDl = {
      active: !done && !failed,
      feature: progress.feature || 0,
      phase: progress.phase || '',
      percent: progress.percent || 0,
      message: progress.message || '',
    };
    paintJavaProgress();
    if (progress.message) setStatus(progress.message, state.javaDl.active);
    if (done) {
      setStatus('就绪');
      refreshJava()
        .then(() => { if (state.page === 'launch' || state.page === 'settings') rerender(); })
        .catch(error => console.warn('刷新 Java 列表失败', error.message));
    }
    if (failed) setStatus('就绪');
  });
}

async function boot() {
  try {
    // 先把首屏要用的东西装好就立刻渲染，Java 扫描等重活放到后面补
    await bootstrapCore();
    mountChrome();
    syncChrome();
    wireGlobalEvents();
    await navigate('launch');
    window.__fedbyBootMs = Math.round(performance.now());

    bootstrapLazy()
      .then(() => {
        if (state.page === 'launch' || state.page === 'settings') rerender();
      })
      .catch(error => console.warn('后台数据装载失败', error.message));

    // 首屏稳定后再查 GitHub 有没有新版本，别和启动数据抢时间
    scheduleUpdateCheck();
  } catch (error) {
    console.error('启动失败', error);
    document.getElementById('view').innerHTML = `
      <div class="card" style="margin:40px auto;max-width:520px">
        <div class="card-head">启动器初始化失败</div>
        <div class="muted" style="font-size:12px;line-height:1.8">${error.message}</div>
      </div>`;
    toastErr('初始化失败：' + error.message);
  }
}

// 每次导航后刷新顶部账户信息
document.addEventListener('fedby:page', syncChrome);

boot();
