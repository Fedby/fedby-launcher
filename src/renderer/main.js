// 渲染层入口：注册页面、装载数据、绑定全局事件
import { $ } from './lib/dom.js';
import { listen } from './lib/ipc.js';
import { toastErr } from './lib/ui.js';
import { state, bootstrap } from './store.js';
import { registerPage, navigate, rerender } from './router.js';
import { mountChrome, syncChrome } from './shell.js';

import launchPage from './pages/launch.js';
import versionsPage from './pages/versions.js';
import downloadPage, { refreshQueue } from './pages/download.js';
import settingsPage from './pages/settings.js';

registerPage(launchPage);
registerPage(versionsPage);
registerPage(downloadPage);
registerPage(settingsPage);

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
}

async function boot() {
  try {
    await bootstrap();
    mountChrome();
    syncChrome();
    wireGlobalEvents();
    await navigate('launch');
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
