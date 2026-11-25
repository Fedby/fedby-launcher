// 启动页
import { $, esc, fmtTime } from '../lib/dom.js';
import { call } from '../lib/ipc.js';
import { icon } from '../lib/icons.js';
import { pageHead, toast, toastErr, toastOk, setStatus, empty } from '../lib/ui.js';
import { state, currentAccount, currentVersion, accountTypeLabel, saveSettings, selectVersion, loadRecommendRuntime, reportError } from '../store.js';
import { navigate, rerender } from '../router.js';
import { accountStripHtml, bindAccountStrip, openAccountManager } from '../components/accounts.js';

function memoryValue() {
  if (state.settings.autoMemory !== false) return state.auto.memoryMB || state.settings.memoryMB || 4096;
  return state.settings.memoryMB || 4096;
}

function render(state) {
  const account = currentAccount();
  const version = currentVersion();
  const autoJava = state.settings.autoJava !== false;
  const autoMemory = state.settings.autoMemory !== false;
  const memory = memoryValue();
  // Java 扫描挪到首屏之后了：没扫完就不要吓用户说「缺少 Java」
  const runtimeReady = state.runtimeReady !== false;
  const missingJava = runtimeReady && autoJava && state.auto.satisfied === false;
  const javaLabel = !runtimeReady
    ? '自动 · 正在扫描 Java…'
    : missingJava
      ? `自动 · 缺少 Java ${state.auto.requiredJava}，启动时自动下载`
      : autoJava
        ? `自动 · ${state.auto.javaDisplay || '扫描中…'}`
        : (state.java.find(item => item.path === state.selection.javaPath)?.display || '未选择 Java');

  return `
    ${pageHead('启动游戏', '选择版本与账户，然后出发', `
      <button class="btn" id="open-game-dir">${icon('folder', 14)} 游戏目录</button>`)}

    <div class="split">
      <div class="stack">
        <div class="hero">
          <div class="hero-glow"></div>
          <div class="hero-body">
            <div class="hero-kicker">${version ? esc(version.type === 'release' ? '正式版' : version.type) : '未选择版本'}</div>
            <div class="hero-title">${version ? esc(version.id) : 'Minecraft Java 版'}</div>
            <div class="hero-meta">
              <span>${version ? `Java ${version.javaMajor}+` : '等待选择版本'}</span>
              <span class="dot"></span>
              <span>${account ? esc(account.name) : '未登录'}</span>
              <span class="dot"></span>
              <span>${memory} MB</span>
            </div>
          </div>
          <div class="hero-art">${icon('box', 74)}</div>
        </div>

        <div class="card">
          <div class="card-head">${icon('sliders', 15)} 启动配置</div>
          <div class="field">
            <label>游戏版本</label>
            <select class="select" id="version-select">
              ${state.versions.length ? '' : '<option value="">还没有安装版本</option>'}
              ${state.versions.map(item => `<option value="${esc(item.id)}"${item.id === state.selection.versionId ? ' selected' : ''}>${esc(item.id)} · ${esc(item.type)}${item.modded ? ' · 模组' : ''}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Java 运行时 <span class="muted">· ${autoJava ? `自动选择（需要 Java ${state.auto.requiredJava || 17}${missingJava ? '，缺失时自动下载' : ''}）` : '手动指定'}</span></label>
            <div class="row">
              <input class="input grow" readonly value="${esc(javaLabel)}">
              <button class="btn" id="java-settings" style="flex:0 0 auto">设置 ${icon('arrowRight', 13)}</button>
            </div>
            <div class="install-progress" id="java-dl" style="${state.javaDl.active ? '' : 'display:none'}">
              <div class="progress"><span id="java-dl-fill" style="width:${state.javaDl.percent || 0}%"></span></div>
              <div class="install-progress-text"><span id="java-dl-text">${esc(state.javaDl.message || '')}</span><b id="java-dl-percent">${state.javaDl.percent || 0}%</b></div>
            </div>
          </div>
          <div class="field">
            <label>分配内存 <span class="muted" id="memory-label">${autoMemory ? '自动 · ' : ''}${memory} MB</span></label>
            <input type="range" id="memory-range" min="1024" max="16384" step="512" value="${memory}">
          </div>
          <div class="row" style="gap:18px">
            <label class="checkbox"><input type="checkbox" id="auto-java"${autoJava ? ' checked' : ''}> 自动选择 Java</label>
            <label class="checkbox"><input type="checkbox" id="auto-memory"${autoMemory ? ' checked' : ''}> 自动分配内存</label>
          </div>
        </div>

        <div class="launch-actions">
          <button class="launch-btn" id="btn-launch"${state.launching ? ' disabled' : ''}>
            ${state.launching ? '<span class="spinner"></span>启动中…' : `${icon('play', 18)} 启动游戏`}
          </button>
          <button class="btn danger" id="btn-stop" style="${state.launching ? '' : 'display:none'}">停止</button>
        </div>
        ${state.versions.length ? '' : `<div class="hint-box" style="margin-top:10px">还没有任何版本，去「下载」页装一个：原版、Fabric、Forge、NeoForge、Quilt、OptiFine 都能直接选。</div>`}
      </div>

      <div class="stack">
        <div class="card">
          <div class="card-head">${icon('user', 15)} 账户 <span class="hint">点击头像切换</span>
            <span class="spacer"></span>
            <button class="btn sm ghost" id="manage-accounts">管理</button>
          </div>
          ${accountStripHtml()}
          <div class="account-current">
            当前：<b>${esc(account?.name || '未选择')}</b>
            <span class="muted">· ${accountTypeLabel(account)}</span>
          </div>
        </div>

        <div class="card">
          <div class="card-head">${icon('info', 15)} 当前状态</div>
          <div class="kv"><span>版本</span><b>${esc(version?.id || '-')}</b></div>
          <div class="kv"><span>Java</span><b>${autoJava ? '自动 · ' : ''}${state.auto.javaMajor ? 'Java ' + state.auto.javaMajor : (state.java[0] ? 'Java ' + state.java[0].major : '-')}</b></div>
          <div class="kv"><span>内存</span><b>${autoMemory ? '自动 · ' : ''}${memory} MB</b></div>
          <div class="kv"><span>账户</span><b>${esc(account?.name || '-')}</b></div>
        </div>

        <div class="card log-card">
          <div class="card-head">${icon('tag', 15)} 游戏日志 <span class="hint">实时输出</span>
            <span class="spacer"></span>
            <button class="btn sm ghost" id="clear-log">清空</button>
          </div>
          <div class="log-terminal" id="log-terminal">${state.logs.map(entry => `<div class="log-line ${entry.stream === 'error' ? 'err' : entry.stream === 'system' ? 'sys' : ''}">${esc(entry.text)}</div>`).join('') || '<div class="log-empty">启动游戏后，日志会在这里滚动</div>'}</div>
        </div>
      </div>
    </div>`;
}

async function mount(root) {
  const terminal = $('#log-terminal');
  if (terminal) terminal.scrollTop = terminal.scrollHeight;

  bindAccountStrip(root);
  $('#manage-accounts').addEventListener('click', openAccountManager);
  $('#open-game-dir').addEventListener('click', () => call('app.openDir', 'game').catch(error => reportError('打开目录失败', error)));
  $('#java-settings').addEventListener('click', () => navigate('settings'));

  $('#version-select').addEventListener('change', async event => {
    await selectVersion(event.target.value);
    rerender();
  });

  $('#auto-java').addEventListener('change', async event => {
    await saveSettings({ autoJava: event.target.checked });
    await loadRecommendRuntime();
    rerender();
    toast(event.target.checked ? '已开启 Java 自动选择' : '已改为手动选择 Java');
  });

  $('#auto-memory').addEventListener('change', async event => {
    await saveSettings({ autoMemory: event.target.checked, memoryMB: parseInt($('#memory-range').value, 10) || 4096 });
    rerender();
    toast(event.target.checked ? '已开启内存自动分配' : '已改为手动分配内存');
  });

  const range = $('#memory-range');
  range.addEventListener('input', event => {
    const label = $('#memory-label');
    if (label) label.textContent = `${state.settings.autoMemory !== false ? '自动 · ' : ''}${event.target.value} MB`;
  });
  range.addEventListener('change', async event => {
    await saveSettings({ memoryMB: parseInt(event.target.value, 10) || 4096, autoMemory: false });
    rerender();
  });

  $('#clear-log').addEventListener('click', () => {
    state.logs = [];
    if (terminal) terminal.innerHTML = '<div class="log-empty">启动游戏后，日志会在这里滚动</div>';
  });

  $('#btn-launch').addEventListener('click', doLaunch);
  const stop = $('#btn-stop');
  if (stop) stop.addEventListener('click', async () => {
    await call('game.stop').catch(error => reportError('停止失败', error));
    toast('已请求停止游戏');
  });

  if (state.launching) {
    const status = await call('game.status').catch(() => ({ running: false }));
    if (!status.running) {
      state.launching = false;
      rerender();
    }
  }
}

async function doLaunch() {
  if (!state.selection.versionId) return toastErr('请先选择游戏版本');
  if (!state.selection.accountId) return toastErr('请先在右侧添加并选择账户');
  // 自动模式允许没有现成 Java：主进程会按版本要求下载对应运行时
  if (!state.selection.javaPath && state.settings.autoJava === false) {
    return toastErr('没有可用的 Java，请在设置中指定，或开启「自动选择 Java」');
  }

  state.launching = true;
  setStatus('启动中…', true);
  const button = $('#btn-launch');
  button.disabled = true;
  button.innerHTML = '<span class="spinner"></span>启动中…';
  const stopButton = $('#btn-stop');
  if (stopButton) stopButton.style.display = '';

  try {
    const result = await call('game.launch', {
      versionId: state.selection.versionId,
      accountId: state.selection.accountId,
      javaPath: state.selection.javaPath,
      memoryMB: parseInt($('#memory-range')?.value || state.settings.memoryMB || 4096, 10),
      autoJava: $('#auto-java')?.checked !== false,
      autoMemory: $('#auto-memory')?.checked !== false,
    });
    toastOk(`游戏已启动（PID ${result.pid}）`);
    setStatus('游戏运行中', false);
  } catch (error) {
    state.launching = false;
    setStatus('就绪');
    toastErr('启动失败：' + error.message);
    if (button) { button.disabled = false; button.innerHTML = `${icon('play', 18)} 启动游戏`; }
    if (stopButton) stopButton.style.display = 'none';
  }
}

export default { id: 'launch', label: '启动', icon: 'play', render, mount };
