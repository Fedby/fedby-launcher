// 全局状态与数据装载
import { call } from './lib/ipc.js';
import { applyTheme } from './lib/theme.js';
import { toastErr } from './lib/ui.js';

export const state = {
  page: 'launch',
  settings: {},
  appInfo: {},
  accounts: [],
  versions: [],
  java: [],
  runtimeReady: false, // Java 扫描完成前先渲染首屏，避免卡在启动
  source: null,        // 下载源状态（自动/官方/镜像 + 测速结果）
  runtimes: [],       // 启动器自己下载的 Java
  javaDl: { active: false, feature: 0, phase: '', percent: 0, message: '' },
  skins: {},          // uuid -> dataURL
  selection: { accountId: '', versionId: '', javaPath: '' },
  auto: { requiredJava: 17, satisfied: false, javaPath: '', javaDisplay: '', javaMajor: 0, memoryMB: 4096, totalMemMB: 0 },
  logs: [],
  launching: false,
  remoteVersions: [],
  download: {
    section: 'game',      // game | mod | modpack | datapack | resourcepack | shader | world | plugin
    views: {},            // 每个子页各自的筛选、结果与推荐（互不干扰）
    queue: [],
    cfKey: null,
    mc: { loaded: false, loading: false, versions: [], open: {} },
    install: null,        // { mc, kind, version, fabricApi, info, running, percent, message }
  },
  install: { running: false, stage: '', percent: 0 },
};

export const currentAccount = () => state.accounts.find(account => account.id === state.selection.accountId) || null;
export const currentVersion = () => state.versions.find(version => version.id === state.selection.versionId) || null;

export function accountTypeLabel(account) {
  if (!account) return '未登录';
  if (account.type === 'microsoft') return '微软正版';
  if (account.type === 'thirdparty') return '皮肤站';
  return '离线';
}

/**
 * 首屏必需的数据：配置、版本号、账户、版本列表。都是本地小文件，几十毫秒。
 * Java 扫描、皮肤下载、运行时推荐都挪到 bootstrapLazy，别挡着窗口显示。
 */
export async function bootstrapCore() {
  const [settings, appInfo, accounts, versions, source] = await Promise.all([
    call('settings.get'),
    call('app.info'),
    call('accounts.list'),
    call('versions.list'),
    call('source.status').catch(() => null),
  ]);
  state.settings = settings;
  state.appInfo = appInfo;
  state.accounts = accounts;
  state.versions = versions;
  state.source = source;
  applyTheme(settings.themeColor);

  state.selection.accountId = accounts.some(a => a.id === settings.lastAccountId)
    ? settings.lastAccountId
    : (accounts[0]?.id || '');
  state.selection.versionId = versions.some(v => v.id === settings.lastVersionId)
    ? settings.lastVersionId
    : (versions[0]?.id || '');
  state.selection.javaPath = settings.javaPath || '';
}

/** 首屏之后再补的数据：Java 列表、自建运行时、皮肤、运行时推荐 */
export async function bootstrapLazy() {
  const [javaList, runtimes] = await Promise.all([
    call('java.list', false).catch(() => []),
    call('java.runtimes').catch(() => []),
  ]);
  state.java = javaList || [];
  state.runtimes = runtimes || [];
  state.runtimeReady = true;
  await Promise.all([loadRecommendRuntime(), loadSkins()]);
}

/** 兼容旧调用：完整装载（测试脚本会用到） */
export async function bootstrap() {
  await bootstrapCore();
  await bootstrapLazy();
}

export async function loadRecommendRuntime() {
  try {
    state.auto = await call('runtime.recommend', state.selection.versionId);
    if (state.settings.autoJava !== false && state.auto.javaPath) state.selection.javaPath = state.auto.javaPath;
    if (!state.selection.javaPath) state.selection.javaPath = state.settings.javaPath || state.auto.javaPath || '';
  } catch (err) {
    console.warn('运行时推荐失败', err.message);
  }
}

/** Java 刚下载完时刷新列表与推荐，并重新指向新运行时 */
export async function refreshJava() {
  state.java = await call('java.list', true);
  state.runtimes = await call('java.runtimes');
  state.runtimeReady = true;
  await loadRecommendRuntime();
}

/** 下载源：读状态 / 重新测速 */
export async function refreshSource(probe = false) {
  state.source = probe ? await call('source.probe') : await call('source.status');
  return state.source;
}

export async function loadSkins() {
  const targets = state.accounts.filter(account => account.uuid);
  const pairs = await Promise.all(targets.map(async account => {
    try { return [account.uuid, await call('accounts.skinImage', account.uuid)]; }
    catch (_) { return [account.uuid, '']; }
  }));
  state.skins = {};
  for (const [uuid, data] of pairs) if (data) state.skins[uuid] = data;
}

export async function refreshAccounts() {
  state.accounts = await call('accounts.list');
  if (!state.accounts.some(account => account.id === state.selection.accountId)) {
    state.selection.accountId = state.accounts[0]?.id || '';
  }
  await loadSkins();
}

export async function refreshVersions() {
  state.versions = await call('versions.list');
  if (!state.versions.some(version => version.id === state.selection.versionId)) {
    state.selection.versionId = state.versions[0]?.id || '';
  }
}

export async function selectAccount(id) {
  state.selection.accountId = id;
  state.settings = await call('settings.patch', { lastAccountId: id });
}

export async function selectVersion(id) {
  state.selection.versionId = id;
  state.settings = await call('settings.patch', { lastVersionId: id });
  await loadRecommendRuntime();
}

export async function saveSettings(patch) {
  state.settings = await call('settings.patch', patch);
  applyTheme(state.settings.themeColor);
  if ('javaPath' in patch) state.selection.javaPath = state.settings.javaPath;
  return state.settings;
}

/** 统一的失败提示，避免每个调用点都写一遍 */
export function reportError(prefix, error) {
  console.error(prefix, error);
  toastErr(`${prefix}：${error?.message || error}`);
}
