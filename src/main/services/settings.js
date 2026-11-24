'use strict';
// 配置读写：原子写入 + 默认值兜底，任何模块都通过 settings.get() 取最新配置。
const fs = require('fs');
const path = require('path');
const { dirs } = require('./paths');

const DEFAULTS = {
  themeColor: '#4f6ef7',
  memoryMB: 4096,
  autoJava: true,
  autoMemory: true,
  fullscreen: false,
  resolution: { width: 1280, height: 720 },
  javaPath: '',
  lastVersionId: '',
  lastAccountId: '',
  jvmArgExtra: '',
  launchArgExtra: '',
  downloadConcurrency: 8,
  autoDownloadAssets: true,
  translateDescriptions: true,
  curseforgeKey: '',
  skinSite: 'https://littleskin.cn',
  injectorJar: '',
};

let cache = null;

function readFile() {
  try {
    if (!fs.existsSync(dirs.config)) return {};
    const raw = JSON.parse(fs.readFileSync(dirs.config, 'utf-8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch (err) {
    console.error('[settings] 读取配置失败:', err.message);
    return {};
  }
}

function get() {
  if (!cache) cache = { ...DEFAULTS, ...readFile() };
  return cache;
}

function write(next) {
  fs.mkdirSync(path.dirname(dirs.config), { recursive: true });
  const tmp = `${dirs.config}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf-8');
  fs.renameSync(tmp, dirs.config);
  cache = next;
  return next;
}

// 只接受已知字段，避免渲染层塞进任意键
function patch(payload = {}) {
  const next = { ...get() };
  for (const key of Object.keys(payload)) {
    if (key in DEFAULTS) next[key] = payload[key];
  }
  if (!/^#[0-9a-f]{6}$/i.test(String(next.themeColor))) next.themeColor = DEFAULTS.themeColor;
  next.memoryMB = clampInt(next.memoryMB, 1024, 32768, DEFAULTS.memoryMB);
  next.downloadConcurrency = clampInt(next.downloadConcurrency, 1, 32, DEFAULTS.downloadConcurrency);
  const w = clampInt(next.resolution?.width, 640, 7680, 1280);
  const h = clampInt(next.resolution?.height, 480, 4320, 720);
  next.resolution = { width: w, height: h };
  return write(next);
}

// 只写内存不落盘（例如登录后记住当前账户，随下一次保存一起写入）
function remember(payload = {}) {
  const next = { ...get() };
  for (const key of Object.keys(payload)) if (key in DEFAULTS) next[key] = payload[key];
  return write(next);
}

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

module.exports = { DEFAULTS, get, patch, remember };
