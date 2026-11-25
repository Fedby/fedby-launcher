// 设置页
import { $, esc, fmtTime } from '../lib/dom.js';
import { call } from '../lib/ipc.js';
import { icon } from '../lib/icons.js';
import { pageHead, toast, toastOk, toastErr, confirm, busy, setStatus, empty } from '../lib/ui.js';
import { state, saveSettings, loadRecommendRuntime, refreshJava, refreshSource, reportError } from '../store.js';
import { rerender } from '../router.js';
import { PRESET_COLORS, applyTheme } from '../lib/theme.js';
import { checkForUpdate } from '../components/updater.js';

function render(state) {
  const config = state.settings;
  const autoJava = config.autoJava !== false;
  const autoMemory = config.autoMemory !== false;
  const themeColor = /^#[0-9a-f]{6}$/i.test(config.themeColor || '') ? config.themeColor : '#4f6ef7';
  const source = state.source;
  const sourceMode = config.sourceMode || 'auto';
  const ms = value => (value && value > 0 ? `${value} ms` : '不可达');
  const sourceHint = !source
    ? '正在读取下载源状态…'
    : sourceMode === 'auto'
      ? `当前走<b>${source.chosen === 'mirror' ? '镜像源' : '官方源'}</b>（官方 ${ms(source.officialMs)} · 镜像 ${ms(source.mirrorMs)}）${source.reason ? ' · ' + esc(source.reason) : ''}`
      : sourceMode === 'mirror'
        ? `固定使用镜像源（BMCLAPI：版本清单 / 依赖库 / 资源文件 / 加载器）· 官方 ${ms(source.officialMs)} / 镜像 ${ms(source.mirrorMs)}`
        : `固定使用官方源（Mojang / Adoptium / Forge 官方地址）· 官方 ${ms(source.officialMs)} / 镜像 ${ms(source.mirrorMs)}`;

  return `
    ${pageHead('设置', '启动器全局选项，修改后点底部保存', `<button class="btn primary" id="save-settings">${icon('check', 14)} 保存设置</button>`)}

    <div class="grid-2">
      <div class="stack">
        <div class="card">
          <div class="card-head">${icon('shield', 15)} 智能启动</div>
          <label class="checkbox"><input type="checkbox" id="set-auto-java"${autoJava ? ' checked' : ''}> 自动选择 Java（按版本要求挑；本机没有就自动下载）</label>
          <label class="checkbox" style="margin-top:10px"><input type="checkbox" id="set-auto-memory"${autoMemory ? ' checked' : ''}> 自动分配内存（物理内存的 1/4，限制 2~8 GB）</label>
          <div class="hint-box" style="margin-top:10px">
            当前推荐：需要 Java ${esc(state.auto.requiredJava || 17)} ·
            ${state.runtimeReady === false
              ? '正在扫描本机 Java…'
              : state.auto.satisfied
              ? `使用 ${esc(state.auto.javaDisplay || '扫描中…')}`
              : '<b>本机缺少该版本，启动时将自动下载</b>'} ·
            分配 ${state.auto.memoryMB || config.memoryMB || 4096} MB
            （共 ${state.appInfo.totalMemMB || state.auto.totalMemMB || '-'} MB 物理内存）
          </div>
        </div>

        <div class="card">
          <div class="card-head">${icon('sliders', 15)} 游戏设置</div>
          <div class="row" style="gap:10px">
            <div class="field grow"><label>默认内存 (MB)</label><input class="input" type="number" id="set-memory" min="1024" max="16384" step="512" value="${config.memoryMB || 4096}"></div>
            <div class="field grow"><label>窗口宽度</label><input class="input" type="number" id="set-width" value="${config.resolution?.width || 1280}"></div>
            <div class="field grow"><label>窗口高度</label><input class="input" type="number" id="set-height" value="${config.resolution?.height || 720}"></div>
          </div>
          <label class="checkbox"><input type="checkbox" id="set-fullscreen"${config.fullscreen ? ' checked' : ''}> 全屏启动</label>
          <div class="field" style="margin-top:14px"><label>额外 JVM 参数</label><input class="input mono" id="set-jvm" value="${esc(config.jvmArgExtra || '')}" placeholder="-XX:+UseZGC 等，留空即可"></div>
          <div class="field"><label>额外游戏参数</label><input class="input mono" id="set-game-args" value="${esc(config.launchArgExtra || '')}" placeholder="留空即可"></div>
        </div>

        <div class="card">
          <div class="card-head">${icon('coffee', 15)} Java 运行时 <span class="hint">26.x 需要 Java 25</span>
            <span class="spacer"></span>
            <button class="btn sm ghost" id="rescan-java">${icon('refresh', 13)} 重新扫描</button>
          </div>
          <div class="java-list" id="java-list">
            ${state.java.length ? state.java.map(java => {
              const owned = state.runtimes.some(item => item.path === java.path);
              return `
              <div class="java-item${java.path === state.selection.javaPath ? ' active' : ''}" data-java="${esc(java.path)}">
                <span class="java-mark">${icon('coffee', 15)}</span>
                <span class="java-main">
                  <span class="java-title">Java ${java.major} <span class="badge">${esc(java.vendor)}</span>
                    ${java.major >= 25 ? '<span class="badge green">支持 26.x</span>' : ''}
                    ${owned ? '<span class="badge green">启动器下载</span>' : ''}
                  </span>
                  <span class="java-path mono">${esc(java.path)}</span>
                </span>
                ${owned ? `<button class="btn sm ghost" data-remove-runtime="${java.major}" title="删除这个运行时">${icon('trash', 13)}</button>` : ''}
              </div>`;
            }).join('') : `<div class="muted" style="font-size:11.5px">没有扫描到 Java，可手动浏览选择 javaw.exe</div>`}
          </div>
          <div class="row" style="margin-top:12px;gap:8px">
            <button class="btn sm" id="download-java" style="flex:0 0 auto;white-space:nowrap">${icon('download', 13)} 下载 Java ${state.auto.requiredJava || 17}</button>
          </div>
          <div class="muted" style="margin-top:7px;font-size:10.5px;line-height:1.6">
            本机缺这个版本时，启动游戏也会自动下载（Adoptium Temurin，约 60 MB，装到数据目录的 runtimes 下，不动系统环境）
          </div>
          <div class="install-progress" id="java-dl" style="${state.javaDl.active ? '' : 'display:none'}">
            <div class="progress"><span id="java-dl-fill" style="width:${state.javaDl.percent || 0}%"></span></div>
            <div class="install-progress-text"><span id="java-dl-text">${esc(state.javaDl.message || '')}</span><b id="java-dl-percent">${state.javaDl.percent || 0}%</b></div>
          </div>
          <div class="field" style="margin-top:10px">
            <label>Java 可执行文件</label>
            <div class="row">
              <input class="input grow mono" id="set-java-path" value="${esc(state.selection.javaPath)}" placeholder="浏览选择 javaw.exe">
              <button class="btn" id="browse-java" style="flex:0 0 auto">浏览…</button>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head">${icon('globe', 15)} 第三方皮肤站</div>
          <div class="field">
            <label>默认站点（Yggdrasil）</label>
            <div class="row">
              <input class="input grow" id="set-skin-site" value="${esc(config.skinSite || 'https://littleskin.cn')}" placeholder="https://littleskin.cn">
              <button class="btn" id="test-site" style="flex:0 0 auto">测试连接</button>
            </div>
          </div>
          <div class="field">
            <label>authlib-injector.jar（可选，让游戏内也显示皮肤）</label>
            <div class="row">
              <input class="input grow mono" id="set-injector" value="${esc(config.injectorJar || '')}" placeholder="留空则不注入">
              <button class="btn" id="browse-injector" style="flex:0 0 auto">浏览…</button>
            </div>
          </div>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <div class="card-head">${icon('palette', 15)} 外观</div>
          <div class="field-label">主题颜色</div>
          <div class="swatches">
            ${PRESET_COLORS.map(color => `<button class="swatch" data-color="${color}" style="background:${color}" title="${color}"></button>`).join('')}
            <label class="swatch-custom" title="自定义颜色"><input type="color" id="color-picker" value="${themeColor}"></label>
          </div>
          <div class="hint-box" style="margin-top:10px">点击色块即时预览并保存，取色器可自定义任意颜色。</div>
        </div>

        <div class="card">
          <div class="card-head">${icon('download', 15)} 下载</div>
          <div class="field">
            <label>下载源</label>
            <div class="source-tabs" style="margin-bottom:0">
              <button class="source-tab${sourceMode === 'auto' ? ' active' : ''}" data-source-mode="auto">自动择优</button>
              <button class="source-tab${sourceMode === 'official' ? ' active' : ''}" data-source-mode="official">官方源</button>
              <button class="source-tab${sourceMode === 'mirror' ? ' active' : ''}" data-source-mode="mirror">镜像源</button>
            </div>
          </div>
          <div class="hint-box" id="source-hint" style="margin-top:10px">${sourceHint}</div>
          <div class="row" style="margin-top:8px;gap:8px">
            <button class="btn sm ghost" id="source-probe">${icon('refresh', 13)} 重新测速</button>
            <span class="hint">自动模式按响应速度选，失败会自动回退另一边</span>
          </div>
          <div class="field" style="margin-top:14px"><label>并发下载数</label><input class="input" type="number" id="set-concurrency" min="1" max="32" value="${config.downloadConcurrency || 8}"></div>
          <div class="check-col">
            <label class="checkbox"><input type="checkbox" id="set-assets"${config.autoDownloadAssets !== false ? ' checked' : ''}> 自动补全缺失的资源文件</label>
            <label class="checkbox"><input type="checkbox" id="set-translate"${config.translateDescriptions !== false ? ' checked' : ''}> 使用中文社区数据（MC 百科 / MCIM / 麦块）</label>
          </div>
          <div class="field" style="margin-top:12px">
            <label>CurseForge API Key</label>
            <input class="input mono" id="set-cf-key" value="${esc(config.curseforgeKey || '')}" placeholder="留空使用内置公开密钥">
          </div>
        </div>

        <div class="card">
          <div class="card-head">${icon('info', 15)} 关于</div>
          <div class="kv"><span>启动器版本</span><b>v${esc(state.appInfo.version || '2.0.0')}</b></div>
          <div class="kv"><span>Electron / Chrome</span><b>${esc(state.appInfo.electron || '-')} / ${esc(state.appInfo.chrome || '-')}</b></div>
          <div class="kv"><span>数据目录</span><b class="mono" style="max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(state.appInfo.dataDir || '')}">${esc(state.appInfo.dataDir || '-')}</b></div>
          <div class="row" style="margin-top:12px;gap:8px">
            <button class="btn sm" id="check-update">${icon('refresh', 13)} 检查更新</button>
            <button class="btn sm ghost" id="open-release">${icon('globe', 13)} 发布页</button>
            <button class="btn sm ghost" id="open-data">${icon('folder', 13)} 数据目录</button>
            <button class="btn sm ghost" id="open-logs">${icon('tag', 13)} 日志</button>
          </div>
          <label class="checkbox" style="margin-top:12px"><input type="checkbox" id="set-auto-update"${config.autoCheckUpdate !== false ? ' checked' : ''}> 启动时检查新版本（发现后弹窗询问，不会自动安装）</label>
          <div class="hint-box" id="update-hint" style="margin-top:9px">${config.skippedVersion ? `已跳过 v${esc(config.skippedVersion)}，更新到更新版本时会再提醒` : '新版本从 GitHub Releases 获取，可自己选安装版或便携版'}</div>
        </div>

        <div class="card">
          <div class="card-head">${icon('cloud', 15)} 维护</div>
          <button class="btn block" id="reset-settings">${icon('refresh', 14)} 恢复默认设置</button>
          <div class="hint-box" style="margin-top:10px">恢复默认不会删除版本、账户与已下载内容。</div>
        </div>
      </div>
    </div>`;
}

async function mount(root) {
  document.querySelectorAll('[data-color]').forEach(button => {
    button.addEventListener('click', () => {
      applyTheme(button.dataset.color);
      saveSettings({ themeColor: button.dataset.color }).catch(error => reportError('保存主题失败', error));
    });
  });
  const picker = $('#color-picker');
  if (picker) picker.addEventListener('input', event => {
    applyTheme(event.target.value);
    saveSettings({ themeColor: event.target.value }).catch(() => {});
  });

  root.querySelectorAll('[data-java]').forEach(button => {
    button.addEventListener('click', async () => {
      state.selection.javaPath = button.dataset.java;
      await saveSettings({ javaPath: button.dataset.java, autoJava: false });
      rerender();
      toastOk('已手动选用该 Java（自动选择已关闭）');
    });
  });

  $('#browse-java').addEventListener('click', async () => {
    const file = await call('app.pickFile', [{ name: 'Java 可执行文件', extensions: ['exe'] }]).catch(() => '');
    if (!file) return;
    await saveSettings({ javaPath: file, autoJava: false });
    state.selection.javaPath = file;
    rerender();
    toastOk('已选择 Java');
  });

  $('#browse-injector').addEventListener('click', async () => {
    const file = await call('app.pickFile', [{ name: 'JAR 文件', extensions: ['jar'] }]).catch(() => '');
    if (!file) return;
    $('#set-injector').value = file;
    toastOk('已选择注入器，记得保存设置');
  });

  $('#test-site').addEventListener('click', async () => {
    const button = $('#test-site');
    const restore = busy(button, '测试中…');
    try {
      const info = await call('accounts.siteInfo', $('#set-skin-site').value.trim());
      toastOk(`连接成功：${info.name}`);
    } catch (error) { toastErr('连接失败：' + error.message); }
    restore();
  });

  root.querySelectorAll('[data-source-mode]').forEach(button => {
    button.addEventListener('click', async () => {
      const value = button.dataset.sourceMode;
      if (value === (state.settings.sourceMode || 'auto')) return;
      await saveSettings({ sourceMode: value });
      await refreshSource(false).catch(() => {});
      rerender();
      toastOk(value === 'auto' ? '已切换为自动择优' : value === 'mirror' ? '已固定使用镜像源' : '已固定使用官方源');
    });
  });

  const probeButton = $('#source-probe');
  if (probeButton) probeButton.addEventListener('click', async () => {
    const restore = busy(probeButton, '测速中…');
    setStatus('正在测速下载源…', true);
    try {
      await refreshSource(true);
      rerender();
      const source = state.source;
      toastOk(`官方 ${source.officialMs > 0 ? source.officialMs + ' ms' : '不可达'} · 镜像 ${source.mirrorMs > 0 ? source.mirrorMs + ' ms' : '不可达'}`);
    } catch (error) { reportError('测速失败', error); }
    setStatus('就绪');
    restore();
  });

  $('#rescan-java').addEventListener('click', async () => {
    setStatus('扫描 Java…', true);
    try {
      state.java = await call('java.list', true);
      state.runtimes = await call('java.runtimes');
      await loadRecommendRuntime();
      rerender();
      toastOk(`找到 ${state.java.length} 个 Java`);
    } catch (error) { reportError('扫描失败', error); }
    setStatus('就绪');
  });

  // 主动下载某个主版本的 Java（缺的时候也可以等启动时自动下载）
  $('#download-java').addEventListener('click', async () => {
    const feature = state.auto.requiredJava || 17;
    const button = $('#download-java');
    button.disabled = true;
    state.javaDl = { active: true, feature, phase: 'resolve', percent: 0, message: `正在准备 Java ${feature}…` };
    rerender();
    try {
      await call('java.ensure', feature);
      await refreshJava();
      rerender();
      toastOk(`Java ${feature} 已就绪`);
    } catch (error) {
      state.javaDl = { active: false, feature, phase: 'error', percent: 0, message: '' };
      rerender();
      reportError('下载 Java 失败', error);
    }
  });

  root.querySelectorAll('[data-remove-runtime]').forEach(button => {
    button.addEventListener('click', async event => {
      event.stopPropagation(); // 别触发外层的「选用这个 Java」
      const feature = button.dataset.removeRuntime;
      const yes = await confirm({
        title: `删除 Java ${feature}`,
        message: '会删掉启动器下载的这个运行时目录。系统里安装的 Java 不受影响，之后需要时可以重新下载。',
        confirmText: '删除',
      });
      if (!yes) return;
      try {
        await call('java.removeRuntime', feature);
        await refreshJava();
        rerender();
        toastOk(`已删除 Java ${feature}`);
      } catch (error) { reportError('删除失败', error); }
    });
  });

  const checkButton = $('#check-update');
  if (checkButton) checkButton.addEventListener('click', async () => {
    const restore = busy(checkButton, '检查中…');
    try {
      const info = await checkForUpdate({ manual: true });
      const hint = $('#update-hint');
      if (!info || !hint) return;
      if (info.error) { hint.innerHTML = `检查失败：${esc(info.error)}`; return; }
      hint.innerHTML = info.newer
        ? `发现新版本 <b>v${esc(info.version)}</b>${info.publishedAt ? ' · ' + esc(fmtTime(info.publishedAt)) : ''}，已弹窗询问`
        : `已是最新版本 v${esc(info.current)}${info.publishedAt ? ' · 最近发布 ' + esc(fmtTime(info.publishedAt)) : ''}`;
    } finally { restore(); }
  });

  const releaseButton = $('#open-release');
  if (releaseButton) releaseButton.addEventListener('click', () => call('update.open').catch(error => toastErr(error.message)));

  $('#open-data').addEventListener('click', () => call('app.openDir', 'data').catch(error => toastErr(error.message)));
  $('#open-logs').addEventListener('click', () => call('app.openDir', 'logs').catch(error => toastErr(error.message)));

  $('#reset-settings').addEventListener('click', async () => {
    const yes = await confirm({ title: '恢复默认设置', message: '将把主题、内存、下载等选项恢复为默认值，账户与版本不受影响。', confirmText: '恢复' });
    if (!yes) return;
    await call('settings.reset');
    state.settings = await call('settings.get');
    applyTheme(state.settings.themeColor);
    await loadRecommendRuntime();
    rerender();
    toastOk('已恢复默认设置');
  });

  $('#save-settings').addEventListener('click', async () => {
    const button = $('#save-settings');
    const restore = busy(button, '保存中…');
    try {
      const patch = {
        autoJava: $('#set-auto-java').checked,
        autoMemory: $('#set-auto-memory').checked,
        memoryMB: parseInt($('#set-memory').value, 10) || 4096,
        resolution: {
          width: parseInt($('#set-width').value, 10) || 1280,
          height: parseInt($('#set-height').value, 10) || 720,
        },
        fullscreen: $('#set-fullscreen').checked,
        jvmArgExtra: $('#set-jvm').value,
        launchArgExtra: $('#set-game-args').value,
        skinSite: $('#set-skin-site').value.trim() || 'https://littleskin.cn',
        injectorJar: $('#set-injector').value.trim(),
        downloadConcurrency: parseInt($('#set-concurrency').value, 10) || 8,
        autoDownloadAssets: $('#set-assets').checked,
        translateDescriptions: $('#set-translate').checked,
        curseforgeKey: $('#set-cf-key').value.trim(),
        javaPath: $('#set-java-path').value.trim(),
        themeColor: $('#color-picker').value,
        autoCheckUpdate: $('#set-auto-update') ? $('#set-auto-update').checked : true,
      };
      await saveSettings(patch);
      await loadRecommendRuntime();
      rerender();
      toastOk('设置已保存');
    } catch (error) { reportError('保存失败', error); }
    restore();
  });
}

export default { id: 'settings', label: '设置', icon: 'settings', render, mount };
