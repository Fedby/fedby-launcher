'use strict';
// 统一路径解析：所有模块只从这里取目录，避免各处硬编码。
const path = require('path');
const os = require('os');
const fs = require('fs');

const ROAMING = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const LEGACY_ROOT = path.join(ROAMING, 'NebulaLauncher');

// 数据目录沿用 FedbyLauncher，老版本（NebulaLauncher）首次运行自动迁移，账户与已下载版本不丢
function resolveDataRoot() {
  const target = path.join(ROAMING, 'FedbyLauncher');
  if (fs.existsSync(target) || !fs.existsSync(LEGACY_ROOT)) return target;
  try {
    fs.renameSync(LEGACY_ROOT, target);
    return target;
  } catch (err) {
    console.error('[paths] 旧数据目录迁移失败，继续使用旧目录:', err.message);
    return LEGACY_ROOT;
  }
}

const DATA_ROOT = resolveDataRoot();
const GAME_ROOT = path.join(DATA_ROOT, 'minecraft');

const dirs = {
  data: DATA_ROOT,
  game: GAME_ROOT,
  versions: path.join(GAME_ROOT, 'versions'),
  libraries: path.join(GAME_ROOT, 'libraries'),
  assets: path.join(GAME_ROOT, 'assets'),
  natives: path.join(GAME_ROOT, 'natives'),
  mods: path.join(GAME_ROOT, 'mods'),
  resourcepacks: path.join(GAME_ROOT, 'resourcepacks'),
  shaderpacks: path.join(GAME_ROOT, 'shaderpacks'),
  saves: path.join(GAME_ROOT, 'saves'),
  skins: path.join(DATA_ROOT, 'skins'),
  backups: path.join(DATA_ROOT, 'backups'),
  logs: path.join(DATA_ROOT, 'logs'),
  runtimes: path.join(DATA_ROOT, 'runtimes'),   // 启动器自己下载的 Java
  temp: path.join(DATA_ROOT, 'temp'),
  config: path.join(DATA_ROOT, 'config.json'),
  accounts: path.join(DATA_ROOT, 'accounts.json'),
  translationCache: path.join(DATA_ROOT, 'translate-cache.json'),
};

const ASSET_ENDPOINTS = {
  manifest: 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
  libraries: 'https://libraries.minecraft.net/',
  resources: 'https://resources.download.minecraft.net/',
};

function ensureDirs() {
  const targets = [
    dirs.data, dirs.game, dirs.versions, dirs.libraries,
    path.join(dirs.assets, 'indexes'), path.join(dirs.assets, 'objects'),
    dirs.natives, dirs.skins, dirs.backups, dirs.logs, dirs.runtimes, dirs.temp,
    dirs.mods, dirs.resourcepacks, dirs.shaderpacks, dirs.saves,
  ];
  for (const dir of targets) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (err) { console.error('[paths] 创建目录失败', dir, err.message); }
  }
}

module.exports = { dirs, ensureDirs, ASSET_ENDPOINTS, DATA_ROOT, GAME_ROOT };
