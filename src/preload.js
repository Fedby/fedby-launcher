'use strict';
// 安全桥接：只暴露明确列出的能力，渲染层拿不到 ipcRenderer 本体。
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const subscribe = channel => listener => {
  const wrapped = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
};

contextBridge.exposeInMainWorld('fedby', {
  app: {
    info: () => invoke('app:info'),
    openDir: kind => invoke('app:openDir', kind),
    pickFile: filters => invoke('app:pickFile', filters),
    openExternal: url => invoke('app:openExternal', url),
  },
  win: {
    minimize: () => invoke('window:minimize'),
    toggleMaximize: () => invoke('window:toggleMaximize'),
    close: () => invoke('window:close'),
  },
  settings: {
    get: () => invoke('settings:get'),
    patch: payload => invoke('settings:patch', payload),
    reset: () => invoke('settings:reset'),
  },
  update: {
    check: force => invoke('update:check', { force: !!force }),
    download: () => invoke('update:download'),
    install: file => invoke('update:install', file),
    open: page => invoke('update:open', page),
    skip: version => invoke('update:skip', version),
    version: () => invoke('update:version'),
  },
  versions: {
    list: () => invoke('versions:list'),
    remote: type => invoke('versions:remote', type),
    detail: id => invoke('versions:detail', id),
    remove: id => invoke('versions:remove', id),
    openDir: id => invoke('versions:openDir', id),
    install: id => invoke('versions:install', id),
  },
  java: {
    list: force => invoke('java:list', force),
    probe: exePath => invoke('java:probe', exePath),
    ensure: feature => invoke('java:ensure', feature),
    runtimes: () => invoke('java:runtimes'),
    removeRuntime: feature => invoke('java:removeRuntime', feature),
  },
  runtime: {
    recommend: versionId => invoke('runtime:recommend', versionId),
  },
  source: {
    status: () => invoke('source:status'),
    probe: () => invoke('source:probe'),
  },
  loaders: {
    catalog: () => invoke('loaders:catalog'),
    info: (kind, mc) => invoke('loaders:info', kind, mc),
    install: options => invoke('loaders:install', options),
  },
  accounts: {
    list: () => invoke('accounts:list'),
    createOffline: name => invoke('accounts:createOffline', name),
    remove: id => invoke('accounts:remove', id),
    skinImage: uuid => invoke('accounts:skinImage', uuid),
    msLogin: () => invoke('accounts:msLogin'),
    siteInfo: site => invoke('accounts:siteInfo', site),
    siteLogin: payload => invoke('accounts:siteLogin', payload),
    refreshSkins: () => invoke('accounts:refreshSkins'),
  },
  game: {
    launch: options => invoke('game:launch', options),
    stop: () => invoke('game:stop'),
    status: () => invoke('game:status'),
  },
  content: {
    mods: () => invoke('content:mods'),
    toggleMod: (file, enabled) => invoke('content:toggleMod', file, enabled),
    deleteMod: file => invoke('content:deleteMod', file),
    packs: kind => invoke('content:packs', kind),
    saves: () => invoke('content:saves'),
    backupSave: id => invoke('content:backupSave', id),
    backups: () => invoke('content:backups'),
    restoreBackup: (name, saveId) => invoke('content:restoreBackup', name, saveId),
    deleteSave: id => invoke('content:deleteSave', id),
  },
  download: {
    types: () => invoke('download:types'),
    search: (source, options) => invoke('download:search', source, options),
    versions: (source, projectId, gameVersion, loader) => invoke('download:versions', source, projectId, gameVersion, loader),
    installed: targetType => invoke('download:installed', targetType),
    recommend: (source, options) => invoke('download:recommend', source, options),
    categories: (source, type) => invoke('download:categories', source, type),
    install: (source, options) => invoke('download:install', source, options),
    cfKey: () => invoke('download:cfKey'),
  },
  on: {
    gameLog: subscribe('game:log'),
    installProgress: subscribe('versions:installProgress'),
    downloadProgress: subscribe('download:progress'),
    javaProgress: subscribe('java:progress'),
    loadersProgress: subscribe('loaders:progress'),
    updateProgress: subscribe('update:progress'),
  },
});
