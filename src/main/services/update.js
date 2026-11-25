'use strict';
// 自更新：查 GitHub Releases 判断有没有新版本，下载新安装包，并可一键拉起安装程序。
// 只信任本仓库的 release 资源，下载地址必须来自 api.github.com 返回的 assets。
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { shell } = require('electron');

const net = require('./net');
const { dirs } = require('./paths');

const OWNER = 'Fedby';
const REPO = 'fedby-launcher';
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const RELEASE_PAGE = `https://github.com/${OWNER}/${REPO}/releases`;
const OK_TTL = 5 * 60 * 1000;      // 成功结果缓存 5 分钟，避免反复请求（GitHub 匿名限 60 次/小时）
const FAIL_TTL = 60 * 1000;

let cache = null;      // { at, ttl, data }
let downloading = null;

/** 1.4.0 / v1.3 / 1.4.0-beta.2 → { nums:[1,4,0], pre:'beta.2' }；缺的位按 0 补 */
function parseVersion(text) {
  const raw = String(text || '').trim().replace(/^v/i, '');
  const match = raw.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9a-z.\-]+))?$/i);
  if (!match) return null;
  return {
    nums: [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)],
    pre: match[4] || '',
  };
}

/** 返回值 >0 表示 a 比 b 新 */
function compareVersion(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a.nums[i] !== b.nums[i]) return a.nums[i] - b.nums[i];
  }
  if (a.pre === b.pre) return 0;
  if (!a.pre) return 1;      // 正式版比同号预发布版新
  if (!b.pre) return -1;
  return a.pre > b.pre ? 1 : -1;
}

const currentVersion = () => require('../../../package.json').version;

/** 安装包优先选 Setup（可覆盖安装），没有再退到 Portable */
function pickAsset(release) {
  const list = (release.assets || []).filter(asset => /\.exe$/i.test(asset.name || '') && asset.browser_download_url);
  const rank = name => (/setup/i.test(name) ? 0 : /portable/i.test(name) ? 1 : 2);
  list.sort((a, b) => rank(a.name) - rank(b.name) || (b.size || 0) - (a.size || 0));
  return list[0] || null;
}

function normalize(release) {
  const asset = pickAsset(release);
  return {
    tag: release.tag_name || '',
    version: String(release.tag_name || release.name || '').replace(/^v/i, '').trim(),
    name: release.name || release.tag_name || '',
    notes: String(release.body || '').slice(0, 6000),
    publishedAt: release.published_at || '',
    page: release.html_url || RELEASE_PAGE,
    asset: asset ? {
      name: asset.name,
      size: asset.size || 0,
      url: asset.browser_download_url,
      digest: asset.digest || '',        // 形如 sha256:xxxx
    } : null,
  };
}

async function fetchLatest() {
  // 开发/测试用：FEDBY_UPDATE_MOCK 指向一个 release JSON，就不走网络
  if (process.env.FEDBY_UPDATE_MOCK) {
    return JSON.parse(fs.readFileSync(process.env.FEDBY_UPDATE_MOCK, 'utf-8'));
  }
  return net.requestJson(`${API}/releases/latest`, {
    headers: { 'User-Agent': 'FedbyLauncher-Updater', Accept: 'application/vnd.github+json' },
    timeout: 12000,
  });
}

/**
 * 检查更新。任何网络/解析失败都不抛错，而是返回 {error}，让调用方安静降级。
 * @param {{force?: boolean}} options
 */
async function check(options = {}) {
  const force = !!options.force;
  if (!force && cache && Date.now() - cache.at < cache.ttl) return cache.data;

  const current = currentVersion();
  try {
    const release = normalize(await fetchLatest());
    const a = parseVersion(current);
    const b = parseVersion(release.version);
    if (!b) throw new Error('版本号无法解析：' + release.version);
    const data = {
      current,
      ...release,
      newer: !!(a && compareVersion(b, a) > 0),
      checkedAt: Date.now(),
    };
    cache = { at: Date.now(), ttl: OK_TTL, data };
    return data;
  } catch (error) {
    const data = {
      current,
      newer: false,
      error: error.message || String(error),
      checkedAt: Date.now(),
      page: RELEASE_PAGE,
    };
    cache = { at: Date.now(), ttl: FAIL_TTL, data };
    return data;
  }
}

const updatesDir = () => path.join(dirs.data, 'updates');

function clearOld(dir, keep) {
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!/\.exe$/i.test(name) || name === keep) continue;
      fs.rmSync(path.join(dir, name), { force: true });
    }
  } catch (error) {
    console.warn('[update] 清理旧安装包失败:', error.message);
  }
}

/** 下载新版本安装包；同一时刻只允许一个下载任务 */
async function download({ onProgress } = {}) {
  if (downloading) return downloading;

  downloading = (async () => {
    const info = await check({ force: true });
    if (info.error) throw new Error('检查更新失败：' + info.error);
    if (!info.newer) throw new Error('当前已是最新版本');
    if (!info.asset) throw new Error('该版本没有提供 Windows 安装包，请到发布页手动下载');

    const dir = updatesDir();
    fs.mkdirSync(dir, { recursive: true });
    clearOld(dir, info.asset.name);
    const dest = path.join(dir, info.asset.name);

    // 已经下过完整的一份就直接用
    if (info.asset.size && fs.existsSync(dest) && fs.statSync(dest).size === info.asset.size) {
      onProgress?.({ phase: 'done', percent: 100, received: info.asset.size, total: info.asset.size, message: '安装包已就绪' });
      return { file: dest, name: info.asset.name, size: info.asset.size, version: info.version };
    }

    const started = Date.now();
    let lastEmit = 0;
    onProgress?.({ phase: 'start', percent: 0, received: 0, total: info.asset.size, message: `正在下载 v${info.version}` });

    await net.download(info.asset.url, dest, {
      timeout: 180000,
      onProgress: (received, total) => {
        const now = Date.now();
        if (received < total && now - lastEmit < 150) return;
        lastEmit = now;
        onProgress?.({
          phase: 'downloading',
          received,
          total,
          percent: total ? Math.min(99, Math.round((received / total) * 100)) : 0,
          speed: received / Math.max(1, (now - started) / 1000),
          message: `正在下载 v${info.version}`,
        });
      },
    });

    const size = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
    onProgress?.({ phase: 'done', percent: 100, received: size, total: size, message: '下载完成，正在启动安装程序' });
    return { file: dest, name: info.asset.name, size, version: info.version };
  })();

  try {
    return await downloading;
  } finally {
    downloading = null;
  }
}

/** 拉起安装程序（只允许更新目录下自己下载的 exe） */
async function install(file) {
  const target = path.resolve(String(file || ''));
  const root = path.resolve(updatesDir());
  if (!target.startsWith(root + path.sep) || !/\.exe$/i.test(target)) throw new Error('安装包路径非法');
  if (!fs.existsSync(target)) throw new Error('安装包不存在，请重新下载');

  // detached 让安装程序独立于启动器存活，启动器随后退出
  spawn(target, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
  return { file: target };
}

async function openRelease(page) {
  const url = String(page || RELEASE_PAGE);
  if (!/^https:\/\/github\.com\/Fedby\/fedby-launcher\//i.test(url)) throw new Error('只允许打开本项目的发布页');
  await shell.openExternal(url);
  return url;
}

module.exports = { check, download, install, openRelease, compareVersion, parseVersion, currentVersion, RELEASE_PAGE };
