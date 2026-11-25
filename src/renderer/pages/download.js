// 下载中心：左侧子页（原版游戏 / 社区资源）+ 双源搜索
import { $, esc, fmtNumber, fmtSize, fmtTime, debounce } from '../lib/dom.js';
import { call } from '../lib/ipc.js';
import { icon } from '../lib/icons.js';
import { pageHead, toast, toastOk, toastErr, modal, closeModal, empty, loading, busy, setStatus, confirm } from '../lib/ui.js';
import { state, reportError, refreshVersions, selectVersion, loadRecommendRuntime } from '../store.js';
import { rerender, navigate } from '../router.js';

// source 是各子页的默认下载源；single 表示该来源只有一家收录
const SECTIONS = [
  { key: 'game', label: '原版游戏', icon: 'layers', group: 'main' },
  { key: 'mod', label: 'Mod', icon: 'box', type: 'mod', group: 'community', desc: '模组 · 需加载器', source: 'modrinth' },
  { key: 'modpack', label: '整合包', icon: 'layers', type: 'modpack', group: 'community', desc: '一键安装的模组合集', source: 'modrinth' },
  { key: 'datapack', label: '数据包', icon: 'tag', type: 'datapack', group: 'community', desc: '原版即可使用的数据包', source: 'curseforge' },
  { key: 'resourcepack', label: '资源包', icon: 'image', type: 'resourcepack', group: 'community', desc: '材质与音效', source: 'modrinth' },
  { key: 'shader', label: '光影包', icon: 'palette', type: 'shader', group: 'community', desc: '需要 Iris / OptiFine', source: 'modrinth' },
  { key: 'world', label: '地图', icon: 'globe', type: 'world', group: 'community', desc: '存档与地图世界', source: 'curseforge', single: true },
  { key: 'plugin', label: '插件', icon: 'cloud', type: 'plugin', group: 'community', desc: '服务端插件', source: 'curseforge' },
];

const LOADER_ROWS = [
  { kind: 'vanilla', label: '原版' },
  { kind: 'fabric', label: 'Fabric' },
  { kind: 'forge', label: 'Forge' },
  { kind: 'neoforge', label: 'NeoForge' },
  { kind: 'quilt', label: 'Quilt' },
  { kind: 'optifine', label: 'OptiFine' },
];

const LOADERS = [
  ['all', '全部加载器'], ['fabric', 'Fabric'], ['forge', 'Forge'], ['neoforge', 'NeoForge'], ['quilt', 'Quilt'],
];
const SORTS = [
  ['downloads', '最多下载'], ['relevance', '相关度'], ['follows', '最多关注'], ['newest', '最新发布'], ['updated', '最近更新'],
];
// 愚人节版本混在 snapshot / old 里，单独归一类
const FOOL_RE = /^(2\.0|15w14a|1\.RV-Pre1|3D Shareware|20w14|22w13oneblockatatime|23w13a_or_b|24w14potato|25w14craftmine|26w14|1\.14(?=$))/i;

const dl = () => state.download;
const sectionOf = key => SECTIONS.find(item => item.key === key) || SECTIONS[0];

/** 每个子页自己的一份状态：筛选、结果、类型标签、推荐互不影响 */
function viewOf(section = sectionOf(dl().section)) {
  const views = dl().views;
  if (!views[section.key]) {
    views[section.key] = {
      source: section.source || 'modrinth',
      query: '',
      gameVersion: '',
      loader: 'all',
      sort: 'downloads',
      category: '',
      results: [],
      total: 0,
      loading: false,
      searched: false,
      installed: {},
      categories: null,     // null=还没拉过
      categoriesLoading: false,
      categoriesError: '',
      catOpen: false,
      recommend: [],
      recommendSig: '',
      recommendLoading: false,
      recommendError: '',
      recommendPage: 0,
    };
  }
  return views[section.key];
}

// ---------- 片段 ----------
function cubeIcon(size = 26) {
  return `<svg class="mc-block" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">
    <polygon points="16,2 30,10 16,18 2,10" fill="#7fbe52"/>
    <polygon points="2,10 16,18 16,30 2,22" fill="#8a5a3b"/>
    <polygon points="30,10 16,18 16,30 30,22" fill="#6e472d"/>
    <polygon points="2,10 16,18 16,22 2,14" fill="#5f9a3c"/>
    <polygon points="30,10 16,18 16,22 30,14" fill="#548a34"/>
  </svg>`;
}

const chevron = `<svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>`;

function groupVersions(list) {
  const groups = { release: [], snapshot: [], old: [], fool: [] };
  for (const version of list || []) {
    if (FOOL_RE.test(version.id)) groups.fool.push(version);
    else if (version.type === 'release') groups.release.push(version);
    else if (version.type === 'snapshot') groups.snapshot.push(version);
    else groups.old.push(version);
  }
  return groups;
}

// ---------- 主渲染 ----------
function render() {
  const view = dl();
  const section = sectionOf(view.section);
  return `
    ${pageHead('下载中心', '原版游戏与社区资源分栏管理 · Modrinth / CurseForge 双源', `
      ${sourceChip()}
      <button class="btn" id="dl-key">${icon('key', 14)} CF 密钥</button>`)}
    <div class="dl-layout">
      <aside class="dl-rail">
        <div class="dl-rail-group" style="padding-top:6px">游戏</div>
        ${SECTIONS.filter(item => item.group === 'main').map(item => railItem(item, view)).join('')}
        <div class="dl-rail-group">社区资源</div>
        ${SECTIONS.filter(item => item.group === 'community').map(item => railItem(item, view)).join('')}
      </aside>
      <div class="dl-main">
        ${section.key === 'game' ? renderGame() : renderResource(section)}
      </div>
    </div>`;
}

/** 顶部展示当前下载源，点一下去设置页改 */
function sourceChip() {
  const source = state.source;
  const mode = state.settings.sourceMode || 'auto';
  if (!source) return `<span class="badge" title="正在读取下载源">源：检测中</span>`;
  const name = mode === 'official' ? '官方源' : mode === 'mirror' ? '镜像源'
    : (source.chosen === 'mirror' ? '自动 · 镜像' : '自动 · 官方');
  const detail = `官方 ${source.officialMs > 0 ? source.officialMs + ' ms' : '不可达'} · 镜像 ${source.mirrorMs > 0 ? source.mirrorMs + ' ms' : '不可达'}`;
  return `<button class="btn" id="dl-source" title="${esc(detail)}，点击去设置切换">${icon('cloud', 14)} ${esc(name)}</button>`;
}

function railItem(item, view) {
  const active = view.section === item.key;
  const count = item.key === 'game' && view.mc.loaded ? `<span class="count">${view.mc.versions.length}</span>` : '';
  return `<button class="dl-nav${active ? ' active' : ''}" data-section="${item.key}">
    ${icon(item.icon, 15)}<span>${esc(item.label)}</span>${count}</button>`;
}

// ---------- 原版游戏 ----------
function renderGame() {
  const view = dl();
  if (view.install) return renderInstall();
  if (!view.mc.loaded) {
    if (view.mc.error) {
      return `<div class="card">${empty({
        iconName: 'cloud',
        title: '版本清单获取失败',
        desc: esc(view.mc.error),
        action: '<button class="btn primary" data-retry-mc>重试</button>',
      })}</div>`;
    }
    return `<div class="card">${loading(view.mc.loading ? '正在获取 Mojang 版本清单…' : '准备中…')}</div>`;
  }
  const groups = groupVersions(view.mc.versions);
  const latestRelease = groups.release[0];
  const latestSnapshot = groups.snapshot[0];
  const latest = [
    latestRelease ? latestRow(latestRelease, '最新正式版') : '',
    latestSnapshot ? latestRow(latestSnapshot, '最新预览版') : '',
  ].join('');

  const defs = [
    ['release', '正式版', groups.release],
    ['snapshot', '预览版', groups.snapshot],
    ['old', '远古版', groups.old],
    ['fool', '愚人节版', groups.fool],
  ];

  return `
    <div class="card">
      <div class="card-head">${icon('star', 15)} 最新版本 <span class="hint">点「安装」可自由搭配加载器</span></div>
      ${latest || '<div class="muted" style="font-size:11.5px">暂无版本</div>'}
    </div>
    ${defs.map(([key, label, list]) => `
      <div class="card mc-group${view.mc.open[key] ? ' open' : ''}" data-group="${key}">
        <button class="mc-group-head" data-toggle="${key}">
          ${esc(label)}<span class="count">${list.length}</span>${chevron}
        </button>
        <div class="mc-group-body">
          ${view.mc.open[key] ? `<div class="mc-version-scroll">${list.slice(0, 200).map(version => versionRow(version)).join('') || '<div class="muted" style="font-size:11.5px;padding:6px 0">这一类暂时没有版本</div>'}</div>${list.length > 200 ? '<div class="muted" style="font-size:11px;padding-top:6px">仅显示前 200 个版本</div>' : ''}` : ''}
        </div>
      </div>`).join('')}`;
}

function latestRow(version, tag) {
  return `<div class="mc-latest-row">
    ${cubeIcon(30)}
    <div class="mc-latest-main">
      <div class="mc-latest-id">${esc(version.id)}<span class="badge blue">${esc(tag)}</span></div>
      <div class="mc-latest-sub">发布于 ${fmtTime(version.releaseTime)}</div>
    </div>
    <button class="btn sm primary" data-mc="${esc(version.id)}">${icon('download', 13)} 安装</button>
  </div>`;
}

function versionRow(version) {
  const installed = state.versions.some(item => item.id === version.id);
  return `<div class="mc-row">
    ${cubeIcon(24)}
    <div class="mc-row-main">
      <div class="mc-row-id">${esc(version.id)}${installed ? '<span class="badge green">已安装</span>' : ''}</div>
      <div class="mc-row-sub">${fmtTime(version.releaseTime)}</div>
    </div>
    <button class="btn sm${installed ? '' : ' primary'}" data-mc="${esc(version.id)}">${installed ? '重装 / 加装' : '安装'}</button>
  </div>`;
}

// ---------- 安装视图 ----------
function renderInstall() {
  const ins = dl().install;
  const rows = LOADER_ROWS.map(row => {
    const info = ins.info[row.kind];
    const active = ins.kind === row.kind;
    return `<div class="dl-loader-item${active ? ' active' : ''}">
      <button class="dl-loader${active ? ' active' : ''}" data-kind="${row.kind}">
        <span class="dl-loader-name">${esc(row.label)}</span>
        <span class="dl-loader-state ${stateClass(row.kind, info)}">${esc(stateText(row.kind, info))}</span>
        ${chevron}
      </button>
      ${active ? renderLoaderExtra(row.kind) : ''}
    </div>`;
  }).join('');

  const apiRow = `<div class="dl-loader-item${ins.fabricApi ? ' active' : ''}">
    <button class="dl-loader${ins.fabricApi ? ' active' : ''}" data-kind="fabricapi">
      <span class="dl-loader-name">Fabric API</span>
      <span class="dl-loader-state ${ins.fabricApi ? 'ok' : ''}">${ins.fabricApi ? '已选择 · 会下载匹配版本的前置模组' : (ins.kind === 'fabric' || ins.kind === 'quilt' ? '可选 · 点一下加上' : '可选 · 需先选 Fabric / Quilt')}</span>
      ${icon(ins.fabricApi ? 'check' : 'plus', 14)}
    </button>
  </div>`;

  const running = ins.running;
  return `
    <div class="card" style="padding:0">
      <div class="dl-install-head">
        <button class="dl-back" id="dl-install-back" title="返回版本列表">${icon('arrowRight', 15)}</button>
        ${cubeIcon(28)}
        <div class="dl-install-title">${esc(ins.mc)} <span>选择加载器后开始下载</span></div>
        ${state.versions.some(item => item.id === ins.mc) ? '<span class="badge green">原版已安装</span>' : ''}
      </div>
    </div>
    <div class="dl-loader-list">${rows}${apiRow}</div>
    <div class="dl-install-foot">
      <div class="grow">
        ${running ? `
          <div class="progress${ins.indeterminate ? ' indeterminate' : ''}" id="dl-go-bar"><span id="dl-go-fill" style="width:${ins.percent || 0}%"></span></div>
          <div class="dl-install-log" id="dl-go-text">${esc(ins.message || '准备中…')}</div>` : `
          <div class="dl-install-log">${ins.error ? `<span style="color:var(--red)">上次失败：${esc(ins.error)}</span>` : (ins.kind ? `将安装：${esc(ins.mc)}${ins.kind === 'vanilla' ? ' · 原版' : ' · ' + (LOADER_ROWS.find(item => item.kind === ins.kind)?.label || '')}${ins.kind !== 'vanilla' && ins.version ? ' ' + esc(ins.version) : ''}${ins.fabricApi ? ' + Fabric API' : ''}` : '先选择一个加载器（也可以只装原版）')}</div>`}
      </div>
      <button class="btn primary lg" id="dl-go" ${!ins.kind || running ? 'disabled' : ''}>
        ${running ? '<span class="spinner"></span>下载中…' : `${icon('download', 15)} 开始下载`}
      </button>
    </div>`;
}

function renderLoaderExtra(kind) {
  const ins = dl().install;
  const info = ins.info[kind] || {};
  if (kind === 'vanilla') {
    return `<div class="dl-loader-extra"><div class="hint" style="font-size:11px">只下载 Mojang 官方 ${esc(ins.mc)}，不附带任何加载器。</div></div>`;
  }
  if (kind === 'optifine') {
    return `<div class="dl-loader-extra">
      <label class="filter"><span>OptiFine 版本</span>
        <select class="select" id="lv-select">${(info.versions || []).map(item => `<option value="${esc(item.version)}"${item.version === ins.version ? ' selected' : ''}>${esc(item.label || item.version)}${item.forge ? ` · ${esc(item.forge)}` : ''}</option>`).join('')}</select>
      </label>
      <div class="hint" style="font-size:11px">OptiFine 会作为模组装进 mods，同时自动安装 Forge。</div>
    </div>`;
  }
  const list = info.versions || [];
  return `<div class="dl-loader-extra">
    <label class="filter"><span>加载器版本</span>
      <select class="select" id="lv-select">
        ${list.map(item => `<option value="${esc(item.version)}"${item.version === ins.version ? ' selected' : ''}>${esc(item.version)}${item.version === info.recommended ? '（推荐）' : ''}${item.stable === false ? ' · beta' : ''}</option>`).join('')}
      </select>
    </label>
    <div class="hint" style="font-size:11px">共 ${list.length} 个版本 · 需先装好原版 ${esc(ins.mc)}（会自动补上）${kind === 'neoforge' ? ' · 安装器需访问 neoforged.net' : ''}</div>
  </div>`;
}

function stateClass(kind, info) {
  if (!info || info.loading) return '';
  if (!info.versions || !info.versions.length) return 'bad';
  return 'ok';
}

function stateText(kind, info) {
  if (kind === 'vanilla') return state.versions.some(item => item.id === dl().install.mc) ? '已安装 · 可重装' : '可以添加 · 纯原版';
  if (!info || info.loading) return '获取中…';
  if (info.error) return '获取失败 · ' + info.error;
  if (!info.versions || !info.versions.length) return '无 · 该版本没有对应构建';
  if (kind === 'optifine') return `可以添加 · ${info.versions[0]?.label || info.versions[0]?.version || ''}`;
  return `可以添加 · 推荐 ${info.recommended || info.versions[0].version}`;
}

// ---------- 社区资源子页 ----------
const MAX_CHIPS = 24;

function renderResource(section) {
  const view = viewOf(section);
  const isCf = view.source === 'curseforge';
  const showLoader = ['mod', 'modpack'].includes(section.key);
  const activeCat = (view.categories || []).find(item => item.key === view.category);
  const filters = [activeCat?.label, view.gameVersion, view.loader !== 'all' ? LOADERS.find(row => row[0] === view.loader)?.[1] : '']
    .filter(Boolean);
  return `
    <div class="card search-card">
      <div class="dl-section-head">
        <div>
          <div class="dl-section-title">${icon(section.icon, 15)} ${esc(section.label)}</div>
          <div class="dl-section-desc">${esc(section.desc)}${filters.length ? ' · ' + esc(filters.join(' / ')) : ' · 全部类型 / 全部版本'}</div>
        </div>
        <div class="dl-source-row">
          <div class="source-tabs" style="margin-bottom:0">
            ${section.single ? '<button class="source-tab active" data-source="curseforge">CurseForge</button>' : `
            <button class="source-tab${isCf ? '' : ' active'}" data-source="modrinth">Modrinth</button>
            <button class="source-tab${isCf ? ' active' : ''}" data-source="curseforge">CurseForge</button>`}
          </div>
          <span class="source-note">${isCf ? (dl().cfKey?.configured ? '自定义密钥' : '内置密钥') : '无需密钥'}</span>
        </div>
      </div>
      <div class="search-bar" style="margin-top:12px">
        <div class="search-input">${icon('search', 15)}<input id="dl-q" placeholder="搜索${esc(section.label)}…" value="${esc(view.query)}"></div>
        <button class="btn primary" id="dl-search">搜索</button>
      </div>
      ${renderChips(view)}
      <div class="filter-grid" style="grid-template-columns:repeat(${showLoader ? 3 : 2},minmax(0,1fr))">
        <label class="filter"><span>MC 版本</span><select class="select" id="dl-gv">${versionOptions(view)}</select></label>
        ${showLoader ? `<label class="filter"><span>加载器</span><select class="select" id="dl-loader">
          ${LOADERS.map(([key, label]) => `<option value="${key}"${view.loader === key ? ' selected' : ''}>${label}</option>`).join('')}
        </select></label>` : ''}
        <label class="filter"><span>排序</span><select class="select" id="dl-sort">
          ${SORTS.map(([key, label]) => `<option value="${key}"${view.sort === key ? ' selected' : ''}>${label}</option>`).join('')}
        </select></label>
      </div>
      <div class="filter-foot">
        <span class="hint">点类型直接筛选搜索；改版本 / 加载器 / 排序会立刻重搜</span>
        ${hasFilter(view) ? `<button class="btn sm ghost" id="dl-reset">${icon('refresh', 13)} 清除筛选</button>` : ''}
      </div>
    </div>

    <div class="card">
      <div class="card-head">${icon('star', 15)} ${esc(section.label)}推荐 <span class="hint">${isCf ? 'CurseForge' : 'Modrinth'} · 跟随当前筛选 · 点击直接选版本安装</span>
        <span class="spacer"></span>
        <button class="btn sm ghost" id="rec-refresh">${icon('refresh', 13)} 换一批</button>
      </div>
      <div id="recommend">${renderRecommend(section, view)}</div>
    </div>

    <div id="results">${renderResults(section, view)}</div>

    <div class="card">
      <div class="card-head">${icon('download', 15)} 下载队列 <span class="hint">实时进度</span></div>
      <div id="dl-queue">${renderQueue()}</div>
    </div>`;
}

function renderChips(view) {
  if (!view.categories) {
    return `<div class="chip-row"><span class="chip-hint">${view.categoriesError ? '类型列表获取失败，试试切换来源' : '正在加载类型…'}</span></div>`;
  }
  if (!view.categories.length) {
    return `<div class="chip-row"><span class="chip-hint">这个来源没有类型标签，可用关键词搜索</span></div>`;
  }
  const cats = view.categories;
  const collapsed = !view.catOpen && cats.length > MAX_CHIPS;
  const shown = collapsed ? cats.slice(0, MAX_CHIPS) : cats;
  return `<div class="chip-row">
    <button class="chip${view.category ? '' : ' active'}" data-cat="">全部类型</button>
    ${shown.map(item => `<button class="chip${view.category === item.key ? ' active' : ''}" data-cat="${esc(item.key)}"${item.en ? ` title="${esc(item.en)}"` : ''}>${esc(item.label)}</button>`).join('')}
    ${cats.length > MAX_CHIPS ? `<button class="chip more" data-cat-more>${view.catOpen ? '收起' : `更多 ${cats.length - MAX_CHIPS} +`}</button>` : ''}
  </div>`;
}

function hasFilter(view) {
  return !!(view.query || view.category || view.gameVersion || view.loader !== 'all' || view.sort !== 'downloads');
}

function versionOptions(view) {
  const current = view.gameVersion || '';
  const option = version => `<option value="${esc(version.id)}"${version.id === current ? ' selected' : ''}>${esc(version.id)}</option>`;
  const groups = groupVersions(dl().mc.versions);
  const installed = [...new Set(state.versions.map(version => version.id))];
  const installedSet = new Set(installed);
  // 已安装的单独分组，原清单里就不再重复出现
  const strip = list => list.filter(version => !installedSet.has(version.id));
  const commons = ['1.21.8', '1.21.4', '1.21.1', '1.20.6', '1.20.1', '1.19.4', '1.18.2', '1.16.5', '1.12.2']
    .filter(id => !installedSet.has(id) && !groups.release.some(version => version.id === id));
  return `
    <option value=""${current ? '' : ' selected'}>全版本（不限）</option>
    ${installed.length ? `<optgroup label="已安装">${installed.map(id => `<option value="${esc(id)}"${id === current ? ' selected' : ''}>${esc(id)}</option>`).join('')}</optgroup>` : ''}
    ${strip(groups.release).length ? `<optgroup label="正式版">${strip(groups.release).map(option).join('')}</optgroup>` : ''}
    ${strip(groups.snapshot).length ? `<optgroup label="预览版">${strip(groups.snapshot).map(option).join('')}</optgroup>` : ''}
    ${commons.length ? `<optgroup label="常用版本">${commons.map(id => `<option value="${esc(id)}"${id === current ? ' selected' : ''}>${esc(id)}</option>`).join('')}</optgroup>` : ''}
    ${strip(groups.old).length ? `<optgroup label="远古版">${strip(groups.old).map(option).join('')}</optgroup>` : ''}
    ${strip(groups.fool).length ? `<optgroup label="愚人节版">${strip(groups.fool).map(option).join('')}</optgroup>` : ''}
    <option value="__custom"${current && !dl().mc.versions.some(version => version.id === current) && !installed.includes(current) ? ' selected' : ''}>自定义版本…</option>`;
}

function renderRecommend(section, view) {
  if (view.recommendLoading && !view.recommend.length) return loading('正在加载推荐…');
  if (!view.recommend.length) {
    return `<div class="muted" style="font-size:11.5px;padding:4px 0">${view.recommendError ? `推荐加载失败：${esc(view.recommendError)}` : '暂无推荐，点「换一批」重试'}</div>`;
  }
  const useZh = state.settings.translateDescriptions !== false;
  return `<div class="recommend-strip">${view.recommend.slice(0, 12).map((hit, index) => {
    const name = useZh && hit.titleZh ? hit.titleZh : hit.title;
    return `<button class="recommend-card" data-recommend="${esc(hit.id)}" title="${esc(name)}" style="animation-delay:${index * 22}ms">
      ${hit.icon ? `<img src="${esc(hit.icon)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span class="ph">${icon(section.icon, 16)}</span>`}
      <span class="recommend-main">
        <span class="recommend-name">${esc(name)}</span>
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

function renderResults(section, view) {
  const sourceName = view.source === 'curseforge' ? 'CurseForge' : 'Modrinth';
  if (view.loading) return `<div class="card">${loading(`正在搜索 ${sourceName}…`)}</div>`;
  if (!view.searched) {
    return `<div class="card">${empty({ iconName: section.icon, title: `搜索${section.label}`, desc: `点上面的类型标签即可按分类浏览 ${sourceName} 热门；关键词留空也行，版本留空即全版本` })}</div>`;
  }
  if (!view.results.length) {
    return `<div class="card">${empty({ iconName: 'search', title: '没有找到匹配的项目', desc: '试试清空类型 / MC 版本 / 加载器，或者换个关键词' })}</div>`;
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
    <div class="result-summary">找到 ${fmtNumber(view.total)} 个${esc(section.label)}，已显示 ${view.results.length} 个</div>
    <div class="result-grid">${cards}</div>
    ${view.results.length < view.total ? `<div class="text-right" style="margin-top:12px"><button class="btn" id="dl-more">加载更多</button></div>` : ''}
  </div>`;
}

// ---------- 数据装配 ----------
async function ensureManifest() {
  const view = dl();
  if (view.mc.loading || view.mc.loaded) return;
  view.mc.loading = true;
  view.mc.error = '';
  try {
    const list = await call('versions.remote', 'all');
    view.mc.versions = list || [];
    view.mc.loaded = true;
  } catch (error) {
    view.mc.error = error.message;
    reportError('获取版本清单失败', error);
  }
  view.mc.loading = false;
  if (state.page === 'download') rerender();
}

/** 拉当前子页 + 来源的类型标签 */
async function ensureCategories(section) {
  const view = viewOf(section);
  if (view.categories || view.categoriesLoading) return;
  view.categoriesLoading = true;
  try {
    const list = await call('download.categories', view.source, section.type);
    view.categories = Array.isArray(list) ? list : [];
    view.categoriesError = '';
  } catch (error) {
    view.categories = [];
    view.categoriesError = error.message;
  }
  view.categoriesLoading = false;
  if (state.page === 'download' && dl().section === section.key) rerender();
}

async function openInstall(mc) {
  dl().install = {
    mc,
    kind: '',
    version: '',
    fabricApi: false,
    info: {},
    running: false,
    percent: 0,
    indeterminate: false,
    message: '',
  };
  for (const row of LOADER_ROWS) dl().install.info[row.kind] = { loading: true, versions: [], recommended: '' };
  rerender();
  await Promise.all(LOADER_ROWS.filter(row => row.kind !== 'vanilla').map(async row => {
    try {
      const info = await call('loaders.info', row.kind, mc);
      if (!dl().install || dl().install.mc !== mc) return;
      dl().install.info[row.kind] = { loading: false, versions: info.versions || [], recommended: info.recommended || '' };
    } catch (error) {
      if (!dl().install || dl().install.mc !== mc) return;
      dl().install.info[row.kind] = { loading: false, versions: [], recommended: '', error: error.message };
    }
    if (state.page === 'download' && dl().install && !dl().install.running) rerender();
  }));
}

// ---------- 交互 ----------
function mount(root) {
  const view = dl();
  if (!view.cfKey) call('download.cfKey').then(info => { dl().cfKey = info; }).catch(() => {});
  if (!view.mc.loaded) ensureManifest();

  // 顶部下载源徽章：点一下去设置里切换
  const sourceButton = root.querySelector('#dl-source');
  if (sourceButton) sourceButton.addEventListener('click', () => navigate('settings'));

  root.querySelectorAll('[data-section]').forEach(button => {
    button.addEventListener('click', () => {
      const next = button.dataset.section;
      if (next === view.section) return;
      view.section = next;
      view.install = null;
      rerender();
    });
  });

  bindGame(root);
  bindInstall(root);
  if (view.section !== 'game') {
    const section = sectionOf(view.section);
    bindResource(root);
    ensureCategories(section);
    loadRecommend();
  }
}

function bindGame(root) {
  root.querySelectorAll('[data-toggle]').forEach(button => {
    button.addEventListener('click', () => {
      const key = button.dataset.toggle;
      dl().mc.open[key] = !dl().mc.open[key];
      rerender();
    });
  });
  root.querySelectorAll('[data-mc]').forEach(button => {
    button.addEventListener('click', () => openInstall(button.dataset.mc));
  });
  const retry = root.querySelector('[data-retry-mc]');
  if (retry) retry.addEventListener('click', () => ensureManifest());
}

function bindInstall(root) {
  const ins = dl().install;
  if (!ins) return;
  const back = $('#dl-install-back');
  if (back) back.addEventListener('click', () => { dl().install = null; rerender(); });

  root.querySelectorAll('[data-kind]').forEach(button => {
    button.addEventListener('click', () => {
      if (ins.running) return;
      const kind = button.dataset.kind;
      if (kind === 'fabricapi') {
        ins.fabricApi = !ins.fabricApi;
        rerender();
        return;
      }
      if (ins.kind === kind) { ins.kind = ''; ins.version = ''; rerender(); return; }
      ins.kind = kind;
      const info = ins.info[kind] || {};
      ins.version = info.recommended || info.versions?.[0]?.version || '';
      rerender();
    });
  });

  const select = $('#lv-select');
  if (select) select.addEventListener('change', event => { ins.version = event.target.value; });

  const go = $('#dl-go');
  if (go) go.addEventListener('click', startInstall);
}

async function startInstall() {
  const ins = dl().install;
  if (!ins || !ins.kind || ins.running) return;
  ins.running = true;
  ins.percent = 0;
  ins.error = '';
  ins.message = '准备中…';
  rerender();
  setStatus(`安装 ${ins.mc}…`, true);
  try {
    const result = await call('loaders.install', {
      mc: ins.mc,
      kind: ins.kind,
      loaderVersion: ins.version,
      fabricApi: ins.fabricApi && (ins.kind === 'fabric' || ins.kind === 'quilt'),
    });
    await refreshVersions();
    await selectVersion(result.versionId);
    await loadRecommendRuntime();
    dl().install = null;
    rerender();
    setStatus('就绪');
    toastOk(`已安装 ${result.versionId}`);
  } catch (error) {
    ins.running = false;
    ins.error = error.message;
    rerender();
    setStatus('就绪');
    reportError('安装失败', error);
  }
}

function bindResource(root) {
  const section = sectionOf(dl().section);
  const view = viewOf(section);

  root.querySelectorAll('.source-tab').forEach(button => {
    button.addEventListener('click', () => {
      const next = button.dataset.source;
      if (next === view.source) return;
      view.source = next;
      view.results = [];
      view.total = 0;
      view.searched = false;
      view.categories = null;
      view.categoriesError = '';
      view.category = '';
      view.catOpen = false;
      view.recommend = [];
      view.recommendSig = '';
      view.recommendPage = 0;
      rerender();
      ensureCategories(section);
      loadRecommend();
    });
  });

  const input = $('#dl-q');
  input.addEventListener('input', event => { view.query = event.target.value; });
  input.addEventListener('keydown', event => { if (event.key === 'Enter') search(); });
  $('#dl-search').addEventListener('click', () => search());

  root.querySelectorAll('[data-cat]').forEach(button => {
    button.addEventListener('click', () => {
      const key = button.dataset.cat;
      view.category = key && key !== view.category ? key : '';
      afterFilterChange();
    });
  });
  const moreCats = root.querySelector('[data-cat-more]');
  if (moreCats) moreCats.addEventListener('click', () => { view.catOpen = !view.catOpen; rerender(); });

  const loaderSelect = $('#dl-loader');
  if (loaderSelect) loaderSelect.addEventListener('change', event => { view.loader = event.target.value; afterFilterChange(); });
  $('#dl-sort').addEventListener('change', event => { view.sort = event.target.value; afterFilterChange(); });
  $('#dl-gv').addEventListener('change', event => {
    if (event.target.value === '__custom') return showCustomVersionDialog();
    view.gameVersion = event.target.value;
    afterFilterChange();
  });

  const reset = $('#dl-reset');
  if (reset) reset.addEventListener('click', () => {
    view.query = '';
    view.category = '';
    view.gameVersion = '';
    view.loader = 'all';
    view.sort = 'downloads';
    afterFilterChange();
  });

  const refresh = $('#rec-refresh');
  if (refresh) refresh.addEventListener('click', () => loadRecommend(true));

  bindResults(root, section, view);
}

/** 筛选变化：立刻按新条件搜一次（点类型就等于搜索） */
function afterFilterChange() {
  search();
}

function bindResults(root, section, view) {
  root.querySelectorAll('[data-page]').forEach(button => {
    button.addEventListener('click', () => call('app.openExternal', button.dataset.page).catch(error => toastErr(error.message)));
  });
  root.querySelectorAll('[data-install]').forEach(button => {
    button.addEventListener('click', () => {
      const hit = view.results.find(item => item.id === button.dataset.install);
      if (hit) openInstallDialog(hit, view.source);
    });
  });
  root.querySelectorAll('[data-recommend]').forEach(button => {
    button.addEventListener('click', () => {
      const hit = view.recommend.find(item => item.id === button.dataset.recommend);
      if (hit) openInstallDialog(hit, view.source);
    });
  });
  // 只在当前结果区里找，避免推荐区重复绑定同一个按钮
  const more = root.querySelector('#dl-more');
  if (more) more.addEventListener('click', () => search(view.results.length));
}

function recommendSignature(section, view) {
  return [view.source, section.type, view.gameVersion, view.loader, view.category].join('|');
}

/** 推荐：跟随当前筛选，换一批就是往后翻一页 */
async function loadRecommend(force = false) {
  const section = sectionOf(dl().section);
  if (section.key === 'game') return;
  const view = viewOf(section);
  if (view.recommendLoading) return;
  const signature = recommendSignature(section, view);
  if (!force && view.recommendSig === signature && view.recommend.length) return;

  view.recommendLoading = true;
  view.recommendPage = force && view.recommendSig === signature ? view.recommendPage + 1 : 0;
  view.recommendSig = signature;
  const box = $('#recommend');
  if (box && !view.recommend.length) box.innerHTML = loading('正在加载推荐…');
  try {
    const list = await call('download.recommend', view.source, {
      type: section.type,
      gameVersion: view.gameVersion,
      loader: view.loader,
      category: view.category,
      offset: view.recommendPage * 12,
    });
    view.recommend = Array.isArray(list) ? list : [];
    view.recommendError = '';
  } catch (error) {
    view.recommendError = error.message;
    if (!view.recommend.length) reportError('推荐加载失败', error);
  }
  view.recommendLoading = false;
  const target = $('#recommend');
  if (target && state.page === 'download' && dl().section === section.key) {
    target.innerHTML = renderRecommend(section, view);
    bindResults(target, section, view);
  }
}

async function search(offset = 0) {
  const section = sectionOf(dl().section);
  const view = viewOf(section);
  const start = Number.isInteger(offset) && offset > 0 ? offset : 0;
  const token = (view.searchToken = (view.searchToken || 0) + 1);
  view.loading = true;
  setStatus('搜索资源中…', true);
  const box = $('#results');
  if (box) box.innerHTML = renderResults(section, view);
  try {
    const result = await call('download.search', view.source, {
      query: view.query,
      type: section.type,
      gameVersion: view.gameVersion,
      loader: view.loader,
      category: view.category,
      sort: view.sort,
      limit: 24,
      offset: start,
    });
    if (view.searchToken !== token) return;
    view.results = start ? view.results.concat(result.hits) : result.hits;
    view.total = result.total;
    view.searched = true;
    view.installed = await call('download.installed', section.type);
  } catch (error) {
    if (view.searchToken !== token) return;
    view.searched = true;
    reportError('搜索失败', error);
  }
  view.loading = false;
  setStatus('就绪');
  rerender();
  loadRecommend();
}

function showCustomVersionDialog() {
  const section = sectionOf(dl().section);
  const view = viewOf(section);
  modal({
    title: '自定义 MC 版本',
    body: `<div class="field"><label>版本号</label>
        <input class="input" id="custom-version" placeholder="例如 1.21.8、26.3、24w14a" value="${esc(view.gameVersion)}"></div>
      <div class="hint-box">仅用于筛选搜索结果，留空表示全版本。</div>`,
    footer: `<button class="btn" data-close>取消</button><button class="btn primary" id="custom-apply">应用</button>`,
    onClose: () => { if ($('#dl-gv')?.value === '__custom') rerender(); },
  });
  const input = $('#custom-version');
  input.focus();
  input.select();
  const apply = () => {
    view.gameVersion = input.value.trim();
    closeModal();
    toast(view.gameVersion ? `已筛选版本 ${view.gameVersion}` : '已切换为全版本');
    afterFilterChange();
  };
  $('#custom-apply').onclick = apply;
  input.addEventListener('keydown', event => { if (event.key === 'Enter') apply(); });
}

// ---------- 资源安装弹窗（沿用原有逻辑） ----------
async function openInstallDialog(hit, source) {
  const section = sectionOf(dl().section);
  const view = viewOf(section);
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
  const mcList = [...mcSet].sort((a, b) => String(b).localeCompare(String(a), undefined, { numeric: true }));
  const loaderList = [...loaderSet].sort();
  const wanted = view.gameVersion;
  const fallback = state.selection.versionId;
  const defaultMc = wanted && mcSet.has(wanted) ? wanted : (fallback && mcSet.has(fallback) ? fallback : '');
  const defaultLoader = view.loader !== 'all' && loaderSet.has(view.loader) ? view.loader : 'all';
  const warn = wanted && !mcSet.has(wanted) ? `该资源没有 ${wanted} 的文件，已改为列出其他可用版本` : '';
  const targetType = section.type;

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
      view.installed = await call('download.installed', section.type);
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

/** 加载器安装进度：只改进度条，避免整页重排 */
export function paintLoaderProgress(progress) {
  const ins = dl().install;
  if (!ins || !ins.running) return;
  ins.percent = progress.percent ?? ins.percent;
  ins.indeterminate = !!progress.indeterminate;
  ins.message = progress.message || ins.message;
  const bar = $('#dl-go-bar');
  if (bar) bar.classList.toggle('indeterminate', ins.indeterminate);
  const fill = $('#dl-go-fill');
  if (fill) fill.style.width = (ins.percent || 0) + '%';
  const text = $('#dl-go-text');
  if (text && ins.message) text.textContent = ins.message;
  if (ins.message) setStatus(ins.message, true);
}

export default { id: 'download', label: '下载', icon: 'download', render, mount };
