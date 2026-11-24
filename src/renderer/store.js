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
  runtimes: [],       // 启动器自己下载的 Java
  javaDl: { active: false, feature: 0, phase: '', percent: 0, message: '' },
  skins: {},          // uuid -> dataURL
  selection: { accountId: '', versionId: '', javaPath: '' },
  auto: { requiredJava: 17, satisfied: false, javaPath: '', javaDisplay: '', javaMajor: 0, memoryMB: 4096, totalMemMB: 0 },
  logs: [],
  launching: false,
  remoteVersions: [],
  recommend: [],
  recommendLoading: false,
  download: {
    source: 'modrinth',
    query: '',
    type: 'mod',
    gameVersion: '',
    loader: 'all',
    sort: 'downloads',
    results: [],
    total: 0,
    loading: false,
    searched: false,
    installed: {},
    queue: [],
    cfKey: null,
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

/** 启动时一次性把需要的全局数据装进来 */
export async function bootstrap() {
  const [settings, appInfo, accounts, versions, javaList, runtimes] = await Promise.all([
    call('settings.get'),
    call('app.info'),
    call('accounts.list'),
    call('versions.list'),
    call('java.list', false),
    call('java.runtimes'),
  ]);
  state.settings = settings;
  state.appInfo = appInfo;
  state.accounts = accounts;
  state.versions = versions;
  state.java = javaList;
  state.runtimes = runtimes;
  applyTheme(settings.themeColor);

  state.selection.accountId = accounts.some(a => a.id === settings.lastAccountId)
    ? settings.lastAccountId
    : (accounts[0]?.id || '');
  state.selection.versionId = versions.some(v => v.id === settings.lastVersionId)
    ? settings.lastVersionId
    : (versions[0]?.id || '');
  state.selection.javaPath = settings.javaPath || '';

  await Promise.all([loadRecommendRuntime(), loadSkins()]);
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
  await loadRecommendRuntime();
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
