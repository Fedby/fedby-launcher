// 下载中心：Modrinth / CurseForge 双源
import { $, esc, fmtNumber, fmtSize, fmtTime, compareMcVersion, debounce } from '../lib/dom.js';
import { call } from '../lib/ipc.js';
import { icon } from '../lib/icons.js';
import { pageHead, toast, toastOk, toastErr, modal, closeModal, empty, loading, busy, setStatus, confirm } from '../lib/ui.js';
import { state, reportError } from '../store.js';
import { rerender } from '../router.js';

const COMMON_VERSIONS = ['1.21.8', '1.21.4', '1.21.1', '1.20.6', '1.20.1', '1.19.4', '1.18.2', '1.16.5', '1.12.2'];
const LOADERS = [
  ['all', '全部加载器'], ['fabric', 'Fabric'], ['forge', 'Forge'], ['neoforge', 'NeoForge'], ['quilt', 'Quilt'],
];
const SORTS = [
  ['downloads', '最多下载'], ['relevance', '相关度'], ['follows', '最多关注'], ['newest', '最新发布'], ['updated', '最近更新'],
];

const dl = () => state.download;

function render() {
  const view = dl();
  const installedIds = [...new Set(state.versions.map(version => version.id).filter(Boolean))];
  const isCustom = view.gameVersion && !installedIds.includes(view.gameVersion) && !COMMON_VERSIONS.includes(view.gameVersion);
  const option = value => `<option value="${esc(value)}"${value === view.gameVersion ? ' selected' : ''}>${esc(value)}</option>`;
  const commonLeft = COMMON_VERSIONS.filter(version => !installedIds.includes(version));
  const isCf = view.source === 'curseforge';

  return `
    ${pageHead('下载中心', `双源搜索 · 当前 ${isCf ? 'CurseForge' : 'Modrinth'} · ${view.gameVersion ? '筛选 ' + esc(view.gameVersion) : '全部版本'}`, `
      <button class="btn" id="dl-key">${icon('key', 14)} CF 密钥</button>
      <button class="btn" id="dl-clear">清空</button>`)}

    <div class="card search-card">
      <div class="source-tabs">
        <button class="source-tab${isCf ? '' : ' active'}" data-source="modrinth">Modrinth</button>
        <button class="source-tab${isCf ? ' active' : ''}" data-source="curseforge">CurseForge</button>
        <span class="source-note">${isCf ? (view.cfKey?.configured ? '已使用自定义密钥' : '使用内置公开密钥') : '无需密钥'}</span>
      </div>
      <div class="search-bar">
        <div class="search-input">${icon('search', 15)}<input id="dl-q" placeholder="搜索模组 / 整合包 / 光影…" value="${esc(view.query)}"></div>
        <button class="btn primary" id="dl-search">搜索</button>
      </div>
      <div class="filter-grid">
        <label class="filter"><span>类型</span><select class="select" id="dl-type">
          ${[['mod', '模组'], ['modpack', '整合包'], ['resourcepack', '资源包'], ['shader', '光影'], ['world', '地图世界'], ['plugin', '插件'], ['datapack', '数据包']]
      .map(([key, label]) => `<option value="${key}"${view.type === key ? ' selected' : ''}>${label}</option>`).join('')}
        </select></label>
        <label class="filter"><span>MC 版本</span><select class="select" id="dl-gv">
          <option value=""${view.gameVersion ? '' : ' selected'}>全版本（不限）</option>
          ${installedIds.length ? `<optgroup label="已安装">${installedIds.map(option).join('')}</optgroup>` : ''}
          <optgroup label="常用版本">${commonLeft.map(option).join('')}</optgroup>
          ${isCustom ? `<optgroup label="自定义">${option(view.gameVersion)}</optgroup>` : ''}
          <option value="__custom">自定义版本…</option>
        </select></label>
        <label class="filter"><span>加载器</span><select class="select" id="dl-loader">
          ${LOADERS.map(([key, label]) => `<option value="${key}"${view.loader === key ? ' selected' : ''}>${label}</option>`).join('')}
        </select></label>
        <label class="filter"><span>排序</span><select class="select" id="dl-sort">
          ${SORTS.map(([key, label]) => `<option value="${key}"${view.sort === key ? ' selected' : ''}>${label}</option>`).join('')}
        </select></label>
      </div>
      <div class="hint-box">默认「全版本」不限制游戏版本；安装时可再按游戏版本 / 加载器精确挑文件。中文名与简介来自 MC 百科与社区数据（设置里可关闭）。</div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="card-head">${icon('star', 15)} 模组推荐 <span class="hint">Modrinth 精选 · 点击直接选版本安装</span>
        <span class="spacer"></span>
        <button class="btn sm ghost" id="rec-refresh">${icon('refresh', 13)} 换一批</button>
      </div>
      <div id="recommend">${renderRecommend()}</div>
    </div>

    <div id="results" style="margin-top:14px">${renderResults()}</div>

    <div class="card" style="margin-top:14px">
      <div class="card-head">${icon('download', 15)} 下载队列 <span class="hint">实时进度</span></div>
      <div id="dl-queue">${renderQueue()}</div>
    </div>`;
}

function renderRecommend() {
  if (state.recommendLoading && !state.recommend.length) return loading('正在加载推荐…');
  if (!state.recommend.length) return '<div class="muted" style="font-size:11.5px;padding:4px 0">暂无推荐，点「换一批」重试</div>';
  const useZh = state.settings.translateDescriptions !== false;
  return `<div class="recommend-strip">${state.recommend.slice(0, 12).map((hit, index) => {
    const name = useZh && hit.titleZh ? hit.titleZh : hit.title;
    return `<button class="recommend-card" data-recommend="${esc(hit.id)}" style="animation-delay:${index * 22}ms">
      ${hit.icon ? `<img src="${esc(hit.icon)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span class="ph">${icon('box', 16)}</span>`}
      <span class="recommend-main">
        <span class="recommend-name" title="${esc(name)}">${esc(name)}</span>
        <span class="recommend-meta">↓ ${fmtNumber(hit.downloads)}</span>
      </span>
    </button>`;
  }).join('')}</div>`;
}

function renderQueue() {
  const queue = dl().queue;
  if (!queue.length) return '<div class="muted" style="font-size:11.5px">还没有下载任务</div>';
  return queue.slice(0, 8).map(item => {
    const downloading = String(item.stage || '').includes('download');
    const percent = item.percent || 0;
    return `<div class="queue-item">
      <div class="queue-head">
        <span class="queue-name">${item.label ? `<span class="badge blue">${esc(item.label)}</span>` : ''}${esc(item.name)}</span>
        <span class="queue-stage">${downloading ? `${percent}%` : esc(item.stage || '')}</span>
      </div>
      ${downloading ? `<div class="progress"><span style="width:${percent}%"></span></div>` : ''}
    </div>`;
  }).join('');
}

function renderResults() {
  const view = dl();
  const sourceName = view.source === 'curseforge' ? 'CurseForge' : 'Modrinth';
  if (view.loading) {
    return `<div class="card">${loading(`正在搜索 ${sourceName}…`)}</div>`;
  }
  if (!view.searched) {
    return `<div class="card">${empty({ iconName: 'search', title: '输入关键词开始搜索', desc: `关键词留空可浏览 ${sourceName} 的热门资源；版本留空即全版本` })}</div>`;
  }
  if (!view.results.length) {
    return `<div class="card">${empty({ iconName: 'search', title: '没有找到匹配的项目', desc: '试试清空 MC 版本或加载器筛选，或者换个关键词' })}</div>`;
  }

  const installedKeys = Object.values(view.installed || {}).map(file => String(file).toLowerCase().replace(/[^a-z0-9]/g, ''));
  const useZh = state.settings.translateDescriptions !== false;
  const cards = view.results.map(hit => {
    const key = String(hit.slug || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const installed = key.length >= 3 && installedKeys.some(file => file.includes(key));
    const name = useZh && hit.titleZh ? hit.titleZh : hit.title;
    const desc = useZh && hit.descriptionZh ? hit.descriptionZh : hit.description;
    return `<article class="result-card">
      <div class="result-head">
        ${hit.icon ? `<img class="result-icon" src="${esc(hit.icon)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : `<div class="result-icon ph">${icon('box', 18)}</div>`}
        <div class="result-title-wrap">
          <div class="result-title" title="${esc(name)}">${esc(name)}</div>
          ${useZh && hit.titleZh ? `<div class="result-original" title="${esc(hit.title)}">${esc(hit.title)}</div>` : ''}
          <div class="result-author">by ${esc(hit.author || '未知作者')}</div>
        </div>
      </div>
      <div class="result-desc">${esc(desc || '暂无简介')}</div>
      <div class="result-tags">
        ${(hit.categories || []).slice(0, 3).map(category => `<span class="badge">${esc(category)}</span>`).join('')}
        ${installed ? '<span class="badge amber">可能已安装</span>' : ''}
      </div>
      <div class="result-foot">
        <span class="result-stats">↓ ${fmtNumber(hit.downloads)} · ★ ${fmtNumber(hit.follows)}</span>
        <span class="result-actions">
          <button class="btn sm ghost" data-page="${esc(hit.url)}">${icon('link', 13)}</button>
          <button class="btn sm primary" data-install="${esc(hit.id)}">${icon('download', 13)} 安装</button>
        </span>
      </div>
    </article>`;
  }).join('');

  return `<div class="card">
    <div class="result-summary">找到 ${fmtNumber(view.total)} 个项目，已显示 ${view.results.length} 个</div>
    <div class="result-grid">${cards}</div>
    ${view.results.length < view.total ? `<div class="text-right" style="margin-top:12px"><button class="btn" id="dl-more">加载更多</button></div>` : ''}
  </div>`;
}

// ---------- 交互 ----------
function mount(root) {
  const view = dl();
  if (!view.cfKey) {
    call('download.cfKey').then(info => { dl().cfKey = info; }).catch(() => {});
  }
  if (!state.recommend.length && !state.recommendLoading) loadRecommend();

  root.querySelectorAll('.source-tab').forEach(button => {
    button.addEventListener('click', () => {
      const next = button.dataset.source;
      if (next === dl().source) return;
      dl().source = next;
      dl().results = [];
      dl().total = 0;
      dl().searched = false;
      rerender();
    });
  });

  $('#dl-q').addEventListener('input', event => { dl().query = event.target.value; });
  $('#dl-q').addEventListener('keydown', event => { if (event.key === 'Enter') search(); });
  $('#dl-type').addEventListener('change', event => { dl().type = event.target.value; });
  $('#dl-loader').addEventListener('change', event => { dl().loader = event.target.value; });
  $('#dl-sort').addEventListener('change', event => { dl().sort = event.target.value; });
  $('#dl-gv').addEventListener('change', event => {
    if (event.target.value === '__custom') return showCustomVersionDialog();
    dl().gameVersion = event.target.value;
    rerender();
  });
  $('#dl-search').addEventListener('click', () => search());
  $('#dl-clear').addEventListener('click', () => {
    Object.assign(dl(), { query: '', results: [], total: 0, searched: false });
    rerender();
  });
  $('#dl-key').addEventListener('click', showKeyDialog);
  $('#rec-refresh').addEventListener('click', () => loadRecommend(true));

  bindResults(root);
}

function bindResults(root) {
  root.querySelectorAll('[data-page]').forEach(button => {
    button.addEventListener('click', () => call('app.openExternal', button.dataset.page).catch(error => toastErr(error.message)));
  });
  root.querySelectorAll('[data-install]').forEach(button => {
    button.addEventListener('click', () => {
      const hit = dl().results.find(item => item.id === button.dataset.install);
      if (hit) openInstallDialog(hit, dl().source);
    });
  });
  root.querySelectorAll('[data-recommend]').forEach(button => {
    button.addEventListener('click', () => {
      const hit = state.recommend.find(item => item.id === button.dataset.recommend);
      if (hit) openInstallDialog(hit, 'modrinth');
    });
  });
  const more = $('#dl-more');
  if (more) more.addEventListener('click', () => search(dl().results.length));
}

async function loadRecommend(force = false) {
  if (state.recommendLoading) return;
  state.recommendLoading = true;
  const box = $('#recommend');
  if (box) box.innerHTML = loading('正在加载推荐…');
  try {
    const list = await call('download.recommend');
    if (force || !state.recommend.length) state.recommend = list || [];
    const target = $('#recommend');
    if (target) target.innerHTML = renderRecommend();
    const currentRoot = document.getElementById('view');
    if (currentRoot) bindResults(currentRoot);
  } catch (error) {
    reportError('推荐加载失败', error);
  }
  state.recommendLoading = false;
}

async function search(offset = 0) {
  const view = dl();
  const start = Number.isInteger(offset) && offset > 0 ? offset : 0;
  view.loading = true;
  setStatus('搜索资源中…', true);
  const box = $('#results');
  if (box) box.innerHTML = renderResults();
  try {
    const result = await call('download.search', view.source, {
      query: view.query,
      type: view.type,
      gameVersion: view.gameVersion,
      loader: view.loader,
      sort: view.sort,
      limit: 24,
      offset: start,
    });
    view.results = start ? view.results.concat(result.hits) : result.hits;
    view.total = result.total;
    view.searched = true;
    view.installed = await call('download.installed', view.type);
  } catch (error) {
    view.searched = true;
    reportError('搜索失败', error);
  }
  view.loading = false;
  setStatus('就绪');
  rerender();
}

function showCustomVersionDialog() {
  modal({
    title: '自定义 MC 版本',
    body: `<div class="field"><label>版本号</label>
        <input class="input" id="custom-version" placeholder="例如 1.21.8、26.3、24w14a" value="${esc(dl().gameVersion)}"></div>
      <div class="hint-box">仅用于筛选搜索结果，留空表示全版本。</div>`,
    footer: `<button class="btn" data-close>取消</button><button class="btn primary" id="custom-apply">应用</button>`,
    onClose: () => { if ($('#dl-gv')?.value === '__custom') rerender(); },
  });
  const input = $('#custom-version');
  input.focus();
  input.select();
  const apply = () => {
    dl().gameVersion = input.value.trim();
    closeModal();
    toast(dl().gameVersion ? `已筛选版本 ${dl().gameVersion}` : '已切换为全版本');
    rerender();
  };
  $('#custom-apply').onclick = apply;
  input.addEventListener('keydown', event => { if (event.key === 'Enter') apply(); });
}

function showKeyDialog() {
  modal({
    title: 'CurseForge API 密钥',
    subtitle: '留空使用内置公开密钥（社区通用，可能失效）',
    body: `<div class="field"><label>自定义 API Key</label>
        <input class="input mono" id="cf-key" value="${esc(state.settings.curseforgeKey || '')}" placeholder="$2a$10$..."></div>
      <div class="hint-box">可在 console.curseforge.com 免费申请。保存后立即生效。</div>`,
    footer: `<button class="btn" data-close>取消</button><button class="btn primary" id="cf-save">保存</button>`,
  });
  $('#cf-save').onclick = async () => {
    const key = $('#cf-key').value.trim();
    try {
      state.settings = await call('settings.patch', { curseforgeKey: key });
      dl().cfKey = await call('download.cfKey');
      closeModal();
      rerender();
      toastOk(key ? '已保存自定义密钥' : '已恢复内置密钥');
    } catch (error) { toastErr(error.message); }
  };
}

// ---------- 安装弹窗 ----------
async function openInstallDialog(hit, source) {
  setStatus('获取文件列表…', true);
  let files = [];
  try {
    files = await call('download.versions', source, hit.id, '', 'all');
  } catch (error) {
    setStatus('就绪');
    return reportError('获取版本失败', error);
  }
  setStatus('就绪');

  if (!files.length) {
    modal({
      title: esc(hit.title),
      body: empty({ iconName: 'search', title: '没有可用的文件', desc: '该资源在所选来源下暂无下载文件' }),
    });
    return;
  }

  files = files.slice().sort((a, b) => String(b.datePublished || '').localeCompare(String(a.datePublished || '')));
  const mcSet = new Set();
  const loaderSet = new Set();
  for (const file of files) {
    (file.gameVersions || []).forEach(version => mcSet.add(version));
    (file.loaders || []).forEach(loader => loaderSet.add(loader));
  }
  const mcList = [...mcSet].sort(compareMcVersion);
  const loaderList = [...loaderSet].sort();
  const wanted = dl().gameVersion;
  const fallback = state.selection.versionId;
  const defaultMc = wanted && mcSet.has(wanted) ? wanted : (fallback && mcSet.has(fallback) ? fallback : '');
  const defaultLoader = dl().loader !== 'all' && loaderSet.has(dl().loader) ? dl().loader : 'all';
  const warn = wanted && !mcSet.has(wanted) ? `该资源没有 ${wanted} 的文件，已改为列出其他可用版本` : '';
  const targetType = hit.featured ? 'mod' : dl().type;

  let picked = '';

  modal({
    wide: true,
    title: `安装 · ${esc(hit.title)}`,
    subtitle: '可自由切换游戏版本与加载器，安装的是你选中的那个文件',
    body: `
      <div class="install-head">
        ${hit.icon ? `<img src="${esc(hit.icon)}" alt="">` : `<div class="ph">${icon('box', 18)}</div>`}
        <div class="install-head-main">
          <div class="install-head-title">${esc(hit.title)}</div>
          <div class="install-head-sub">${source === 'curseforge' ? 'CurseForge' : 'Modrinth'} · 共 ${files.length} 个文件${hit.downloads ? ` · ↓ ${fmtNumber(hit.downloads)}` : ''}</div>
        </div>
        <button class="btn sm" id="install-home">主页 ${icon('link', 13)}</button>
      </div>
      ${warn ? `<div class="warn-box">${esc(warn)}</div>` : ''}
      <div class="install-filters">
        <label class="filter"><span>游戏版本</span>
          <select class="select" id="pick-mc"><option value="">全版本（不限）</option>${mcList.map(version => `<option value="${esc(version)}">${esc(version)}</option>`).join('')}</select>
        </label>
        <label class="filter"><span>加载器</span>
          <select class="select" id="pick-loader"><option value="all">全部加载器</option>${loaderList.map(loader => `<option value="${esc(loader)}">${esc(loader)}</option>`).join('')}</select>
        </label>
        <label class="filter"><span>关键词</span>
          <input class="input" id="pick-query" placeholder="版本名 / 文件名">
        </label>
      </div>
      <div class="file-bar"><span id="file-count">…</span><span class="muted">按发布时间倒序${defaultMc && !wanted ? ` · 已默认匹配版本 ${esc(defaultMc)}` : ''}</span></div>
      <div class="file-list" id="file-list"></div>
      <label class="checkbox" style="margin-top:12px"><input type="checkbox" id="install-deps" checked> 自动安装所需依赖（推荐）</label>`,
    footer: `<button class="btn" data-close>取消</button><button class="btn primary" id="install-start" disabled>${icon('download', 14)} 下载安装</button>`,
  });

  $('#pick-mc').value = defaultMc;
  $('#pick-loader').value = defaultLoader;
  $('#install-home').onclick = () => call('app.openExternal', hit.url).catch(error => toastErr(error.message));

  const filtered = () => {
    const mc = $('#pick-mc').value;
    const loader = $('#pick-loader').value;
    const query = ($('#pick-query').value || '').trim().toLowerCase();
    return files.filter(file => {
      if (mc && !(file.gameVersions || []).includes(mc)) return false;
      if (loader !== 'all' && !(file.loaders || []).includes(loader)) return false;
      if (query) {
        const haystack = [file.name, file.versionNumber, ...(file.files || []).map(item => item.name)].join(' ').toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  };

  const drawList = () => {
    const list = filtered();
    const shown = list.slice(0, 80);
    if (!picked || !list.some(file => file.id === picked)) picked = shown[0]?.id || '';
    const mc = $('#pick-mc').value;
    const box = $('#file-list');
    box.innerHTML = shown.length ? shown.map(file => {
      const archive = (file.files || [])[0] || {};
      const matched = mc && (file.gameVersions || []).includes(mc);
      const deps = (file.dependencies || []).length;
      return `<button class="file-item${file.id === picked ? ' active' : ''}" data-file="${esc(file.id)}">
        <span class="file-radio"></span>
        <span class="file-main">
          <span class="file-title">
            <b title="${esc(file.name)}">${esc(file.name)}</b>
            <span class="badge ${file.type === 'release' ? 'green' : 'amber'}">${esc(file.type || 'release')}</span>
            ${matched ? `<span class="badge blue">匹配 ${esc(mc)}</span>` : ''}
            ${file.downloadable === false ? '<span class="badge red">需手动下载</span>' : ''}
          </span>
          <span class="file-meta">${esc((file.gameVersions || []).slice(0, 6).join(' / '))}${(file.gameVersions || []).length > 6 ? ' …' : ''}${(file.loaders || []).length ? ' · ' + esc((file.loaders || []).join(' / ')) : ''} · ${fmtTime(file.datePublished)} · ${fmtSize(archive.size || 0)}${deps ? ` · ${deps} 个依赖` : ''}</span>
          ${archive.name ? `<span class="file-name mono" title="${esc(archive.name)}">${esc(archive.name)}</span>` : ''}
        </span>
      </button>`;
    }).join('') : '<div class="file-empty">没有符合筛选条件的文件，把游戏版本或加载器改成「全版本」再试</div>';

    $('#file-count').textContent = `匹配 ${list.length} 个文件${list.length > shown.length ? `（显示前 ${shown.length} 个）` : ''}`;
    const startButton = $('#install-start');
    if (startButton) startButton.disabled = !picked;
    box.querySelectorAll('[data-file]').forEach(item => {
      item.addEventListener('click', () => {
        picked = item.dataset.file;
        box.querySelectorAll('.file-item').forEach(node => node.classList.toggle('active', node.dataset.file === picked));
        $('#install-start').disabled = false;
      });
    });
  };

  $('#pick-mc').addEventListener('change', drawList);
  $('#pick-loader').addEventListener('change', drawList);
  $('#pick-query').addEventListener('input', debounce(drawList, 160));
  drawList();

  $('#install-start').addEventListener('click', async () => {
    if (!picked) return;
    const button = $('#install-start');
    const restore = busy(button, '安装中…');
    setStatus('下载安装中…', true);
    try {
      const result = await call('download.install', source, {
        projectId: hit.id,
        versionId: picked,
        gameVersion: $('#pick-mc').value || '',
        loader: $('#pick-loader').value || 'all',
        targetType,
        installDependencies: $('#install-deps').checked,
      });
      closeModal();
      const failed = result.failed.length;
      const summary = `安装完成：${result.installed.length} 个文件${result.skipped.length ? `，跳过 ${result.skipped.length}` : ''}${failed ? `，失败 ${failed}` : ''}`;
      failed ? toastErr(summary) : toastOk(summary);
      dl().installed = await call('download.installed', dl().type);
      rerender();
    } catch (error) {
      toastErr('安装失败：' + error.message);
      restore();
    }
    setStatus('就绪');
  });
}

export function refreshQueue() {
  const box = $('#dl-queue');
  if (box) box.innerHTML = renderQueue();
}

export default { id: 'download', label: '下载', icon: 'download', render, mount };
