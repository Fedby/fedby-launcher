'use strict';
/**
 * 下载源选择：官方源（Mojang / Adoptium / Forge）或镜像源（BMCLAPI / 清华 TUNA）。
 * 自动模式会用小文件实测两边的响应时间，把更快的一边排在前面；实测结果落盘，
 * 之后 6 小时内直接用缓存，避免每次启动都测速。
 */
const fs = require('fs');
const path = require('path');
const { dirs } = require('./paths');
const settings = require('./settings');
const net = require('./net');

const MIRROR_BASE = 'https://bmclapi2.bangbang93.com';
const CACHE_FILE = path.join(dirs.data, 'source-cache.json');
const CACHE_TTL = 6 * 60 * 60 * 1000;

// 测速样本：十几 KB 的小 pom，既快又能同时验证 maven 链路是否通
const PROBE = {
  official: 'https://libraries.minecraft.net/com/google/guava/guava/32.1.2-jre/guava-32.1.2-jre.pom',
  mirror: `${MIRROR_BASE}/maven/com/google/guava/guava/32.1.2-jre/guava-32.1.2-jre.pom`,
};

let state = null;
let probing = null;

function load() {
  if (state) return state;
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      if (raw && typeof raw === 'object' && raw.chosen) state = raw;
    }
  } catch (_) { /* 缓存坏了就当没有 */ }
  if (!state) state = { chosen: 'official', officialMs: -1, mirrorMs: -1, at: 0, reason: '尚未测速' };
  return state;
}

function save(next) {
  state = next;
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(next, null, 2), 'utf-8'); } catch (_) { /* 写不了就算了 */ }
  return next;
}

function mode() {
  const value = String(settings.get().sourceMode || 'auto');
  return value === 'official' || value === 'mirror' ? value : 'auto';
}

/** 同步取当前该用哪边：用户手动指定优先，否则用测速缓存 */
function resolve() {
  const fixed = mode();
  if (fixed !== 'auto') return fixed;
  const cached = load();
  if (!cached.at || Date.now() - cached.at > CACHE_TTL) probe().catch(() => {});
  return cached.chosen === 'mirror' ? 'mirror' : 'official';
}

function measure(url, timeout = 6000) {
  const started = Date.now();
  return net.requestText(url, { timeout, headers: { Range: 'bytes=0-2047' } })
    .then(() => Date.now() - started)
    .catch(() => -1);
}

/** 实测两边延迟并落盘；force 用于设置页「重新测速」 */
async function probe(force = false) {
  if (probing) return probing;
  const cached = load();
  const fresh = cached.at && Date.now() - cached.at < CACHE_TTL;
  if (!force && fresh && cached.officialMs > 0 && cached.mirrorMs > 0) return cached;

  probing = (async () => {
    const [officialMs, mirrorMs] = await Promise.all([measure(PROBE.official), measure(PROBE.mirror)]);
    let chosen = 'official';
    let reason = '';
    if (officialMs < 0 && mirrorMs >= 0) { chosen = 'mirror'; reason = '官方源不可达'; }
    else if (mirrorMs < 0 && officialMs >= 0) { chosen = 'official'; reason = '镜像源不可达'; }
    else if (officialMs >= 0 && mirrorMs >= 0) {
      // 只有镜像明显更快才切过去，避免两边抖动时来回跳源
      chosen = mirrorMs * 1.25 < officialMs ? 'mirror' : 'official';
      reason = chosen === 'mirror' ? '镜像更快' : '官方更快';
    } else {
      reason = '两边都不可达，先按官方源';
    }
    return save({ chosen, officialMs, mirrorMs, at: Date.now(), reason });
  })();

  try { return await probing; } finally { probing = null; }
}

/** 当前状态（给设置页展示） */
function status() {
  const cached = load();
  return {
    mode: mode(),
    chosen: resolve(),
    officialMs: cached.officialMs ?? -1,
    mirrorMs: cached.mirrorMs ?? -1,
    at: cached.at || 0,
    reason: cached.reason || '',
    probing: !!probing,
  };
}

/** 官方源 → 镜像源地址；不认识的地址返回空串（不折腾） */
function mirrorUrl(url, versionId) {
  let parsed;
  try { parsed = new URL(String(url)); } catch (_) { return ''; }
  const host = parsed.hostname;
  if (host === 'libraries.minecraft.net') return MIRROR_BASE + '/maven' + parsed.pathname;
  if (host === 'resources.download.minecraft.net') return MIRROR_BASE + '/assets' + parsed.pathname;
  if (host === 'piston-meta.mojang.com' || host === 'launchermeta.mojang.com') return MIRROR_BASE + parsed.pathname;
  // 客户端 jar 在镜像上只有 /version/{id}/client 这一条路径
  if (host === 'piston-data.mojang.com' && versionId
      && /^\/v1\/objects\/[0-9a-f]{40}\/client\.jar$/i.test(parsed.pathname)) {
    return `${MIRROR_BASE}/version/${encodeURIComponent(versionId)}/client`;
  }
  return '';
}

// ---- 源健康度：连续失败就临时降级，避免镜像节点抽风时整批下载干等 ----
const SUSPECT_AFTER = 4;
const SUSPECT_MS = 2 * 60 * 1000;
const health = { official: { fails: 0, suspectUntil: 0 }, mirror: { fails: 0, suspectUntil: 0 } };

const sideOf = url => (/bmclapi/i.test(String(url)) ? 'mirror' : 'official');
const suspect = side => health[side] && Date.now() < health[side].suspectUntil;

function noteFailure(url) {
  const side = sideOf(url);
  const row = health[side];
  if (!row) return;
  row.fails += 1;
  if (row.fails >= SUSPECT_AFTER) row.suspectUntil = Date.now() + SUSPECT_MS;
}

function noteSuccess(url) {
  const row = health[sideOf(url)];
  if (row) { row.fails = 0; row.suspectUntil = 0; }
}

function healthState() {
  return {
    official: { fails: health.official.fails, suspect: suspect('official') },
    mirror: { fails: health.mirror.fails, suspect: suspect('mirror') },
  };
}

/** 一个地址按当前源展开成「首选 + 回退」列表；某边刚连续失败就把它排后面 */
function urlsFor(url, versionId) {
  const mirrorTarget = mirrorUrl(url, versionId);
  if (!mirrorTarget) return [url];
  let preferMirror = resolve() === 'mirror';
  if (preferMirror && suspect('mirror') && !suspect('official')) preferMirror = false;
  else if (!preferMirror && suspect('official') && !suspect('mirror')) preferMirror = true;
  return preferMirror ? [mirrorTarget, url] : [url, mirrorTarget];
}

/** 把 [官方, 镜像] 这种静态列表按当前源重新排序 */
function prefer(list) {
  const items = (list || []).filter(Boolean);
  return resolve() === 'mirror' ? items.slice().reverse() : items.slice();
}

const manifestUrls = () => urlsFor('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
const versionJsonUrls = (versionId, officialUrl) => {
  const official = officialUrl || `https://piston-meta.mojang.com/mc/game/version_manifest_v2.json`;
  const mirror = `${MIRROR_BASE}/version/${encodeURIComponent(versionId)}/json`;
  return resolve() === 'mirror' ? [mirror, official] : [official, mirror];
};

module.exports = {
  MIRROR_BASE, probe, status, resolve, mode, prefer, urlsFor, mirrorUrl,
  manifestUrls, versionJsonUrls, noteFailure, noteSuccess, healthState,
};
