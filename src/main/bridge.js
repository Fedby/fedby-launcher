'use strict';
// IPC 桥：渲染进程唯一入口。所有通道集中注册，统一错误包装与日志。
const path = require('path');
const fs = require('fs');
const { ipcMain, shell, dialog, BrowserWindow } = require('electron');

const { dirs } = require('./services/paths');
const settings = require('./services/settings');
const versions = require('./services/versions');
const java = require('./services/java');
const runtime = require('./services/runtime');
const accounts = require('./services/accounts');
const microsoft = require('./services/microsoft');
const yggdrasil = require('./services/yggdrasil');
const content = require('./services/content');
const launchService = require('./services/launch');
const providers = require('./services/providers');
const types = require('./services/providers/types');

let mainWindow = null;
let loginInFlight = false;
let registered = false;

const ok = data => ({ ok: true, data });
const fail = error => ({ ok: false, error: (error && error.message) || String(error) });

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

// ipcMain.handle 首参是 event，必须剔除；异常统一转成 {ok:false,error}
function register(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return ok(await handler(...args));
    } catch (error) {
      console.error(`[ipc] ${channel} 失败:`, error.message);
      return fail(error);
    }
  });
}

function dirTarget(kind, versionId) {
  if (kind === 'version') {
    if (!versionId || !/^[\w.\-+]+$/.test(String(versionId))) throw new Error('版本 ID 非法');
    const target = versions.paths(versionId).dir;
    if (!fs.existsSync(target)) throw new Error('版本目录不存在');
    return target;
  }
  const map = {
    data: dirs.data, game: dirs.game, versions: dirs.versions, mods: dirs.mods,
    resourcepacks: dirs.resourcepacks, shaderpacks: dirs.shaderpacks, saves: dirs.saves,
    backups: dirs.backups, logs: dirs.logs,
  };
  const target = map[kind];
  if (!target) throw new Error('未知目录: ' + kind);
  return target;
}

function registerAll(window) {
  mainWindow = window;
  if (registered) return; // 窗口重建时只更新引用，避免重复注册通道
  registered = true;
  launchService.onLog(entry => send('game:log', entry));

  // ---------- 应用 ----------
  register('app:info', () => ({
    version: require('../../package.json').version,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    dataDir: dirs.data,
    gameDir: dirs.game,
    totalMemMB: java.totalMemMB(),
  }));

  register('app:openDir', async kind => {
    const target = dirTarget(kind);
    fs.mkdirSync(target, { recursive: true });
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
    return target;
  });

  register('app:pickFile', async filters => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: filters || [{ name: '可执行文件', extensions: ['exe'] }],
    });
    return result.canceled ? '' : result.filePaths[0];
  });

  register('app:openExternal', async url => {
    const allowed = /^https:\/\/(www\.)?(modrinth\.com|curseforge\.com|console\.curseforge\.com)\//i.test(String(url))
      || String(url).startsWith(String(settings.get().skinSite || '').replace(/\/+$/, '') + '/');
    if (!allowed) throw new Error('仅允许打开资源站或已配置的皮肤站页面');
    await shell.openExternal(url);
  });

  // ---------- 窗口 ----------
  register('window:minimize', () => window.minimize());
  register('window:toggleMaximize', () => { if (window.isMaximized()) window.unmaximize(); else window.maximize(); });
  register('window:close', () => window.close());

  // ---------- 设置 ----------
  register('settings:get', () => settings.get());
  register('settings:patch', payload => settings.patch(payload));
  register('settings:reset', () => settings.patch(settings.DEFAULTS));

  // ---------- 版本 ----------
  register('versions:list', () => versions.list());
  register('versions:remote', type => versions.remote(type));
  register('versions:detail', id => versions.detail(id));
  register('versions:remove', id => { versions.remove(id); return versions.list(); });
  register('versions:openDir', async id => {
    const target = dirTarget('version', id);
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
    return target;
  });
  register('versions:install', async id => {
    await versions.install(id, progress => send('versions:installProgress', { id, ...progress }));
    return versions.list();
  });

  // ---------- Java / 运行时 ----------
  register('java:list', async (force = false) => java.scanCached(!!force));
  register('java:probe', exePath => java.probe(exePath));
  register('runtime:recommend', versionId => runtime.recommend(versionId));

  // ---------- 账户 ----------
  register('accounts:list', () => accounts.list());
  register('accounts:createOffline', name => accounts.createOffline(name));
  register('accounts:remove', id => accounts.remove(id));
  register('accounts:skinImage', uuid => accounts.skinDataUrl(uuid));
  register('accounts:msLogin', async () => {
    if (loginInFlight) throw new Error('微软登录已在进行中');
    loginInFlight = true;
    try { return await microsoft.login(mainWindow); } finally { loginInFlight = false; }
  });
  register('accounts:siteInfo', site => yggdrasil.siteInfo(site));
  register('accounts:siteLogin', payload => yggdrasil.login(payload));
  register('accounts:refreshSkins', async () => {
    await yggdrasil.refreshAll();
    for (const account of accounts.list()) {
      if (account.type !== 'microsoft') continue;
      try { await microsoft.refreshSkin(account.id); } catch (_) { /* 单个失败忽略 */ }
    }
    return accounts.list();
  });

  // ---------- 启动 ----------
  register('game:launch', async options => {
    const config = settings.get();
    let account = accounts.find(options.accountId);
    if (!account) throw new Error('请先选择或创建账户');

    if (microsoft.needsRefresh(account)) {
      try { account = await microsoft.refresh(account.id) || account; }
      catch (err) { console.warn('[launch] 微软令牌续期失败:', err.message); }
    }

    let javaPath = options.javaPath || config.javaPath;
    let memoryMB = options.memoryMB || config.memoryMB;
    const autoJava = options.autoJava !== false && config.autoJava !== false;
    const autoMemory = options.autoMemory !== false && config.autoMemory !== false;
    if (autoJava || autoMemory) {
      const rec = await runtime.recommend(options.versionId);
      if (autoJava && rec.javaPath) javaPath = rec.javaPath;
      if (autoMemory && rec.memoryMB) memoryMB = rec.memoryMB;
    }
    if (!javaPath || !fs.existsSync(javaPath)) throw new Error('Java 路径无效，请在设置中选择 Java 或开启自动选择');

    return launchService.launch({ versionId: options.versionId, javaPath, account, memoryMB, settings: config });
  });
  register('game:stop', () => launchService.stop());
  register('game:status', () => launchService.status());

  // ---------- 内容 ----------
  register('content:mods', () => content.listMods());
  register('content:toggleMod', (file, enabled) => { content.toggleMod(file, enabled); return content.listMods(); });
  register('content:deleteMod', file => { content.deleteMod(file); return content.listMods(); });
  register('content:packs', kind => (kind === 'shaderpacks' ? content.listShaderPacks() : content.listResourcePacks()));
  register('content:saves', () => content.listSaves());
  register('content:backupSave', id => content.backupSave(id));
  register('content:backups', () => content.listBackups());
  register('content:restoreBackup', (name, saveId) => content.restoreSave(name, saveId));
  register('content:deleteSave', id => { content.deleteSave(id); return content.listSaves(); });

  // ---------- 下载中心 ----------
  register('download:types', () => types.TYPES.map(type => ({ key: type.key, label: type.label })));
  register('download:search', (source, options) => providers.search(source, options));
  register('download:versions', (source, projectId, gameVersion, loader) => providers.versions(source, projectId, gameVersion, loader));
  register('download:installed', targetType => providers.installed(targetType));
  register('download:recommend', () => providers.recommend());
  register('download:install', (source, options) => providers.install(source, {
    ...options,
    onProgress: progress => send('download:progress', progress),
  }));
  register('download:cfKey', () => require('./services/providers/curseforge').keyInfo());
}

module.exports = { registerAll, send, getWindow: () => mainWindow };
