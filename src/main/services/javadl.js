'use strict';
// Java 运行时自动下载：按版本要求的主版本号，从 Adoptium 取 Temurin JRE。
// 优先走清华镜像（国内快），失败回落 GitHub 官方 release，全部走 SHA256 校验。
// 安装位置：%APPDATA%\FedbyLauncher\runtimes\temurin-<主版本>\
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { dirs } = require('./paths');
const net = require('./net');
const java = require('./java');
const unzip = require('./unzip');

const ADOPTIUM_API = 'https://api.adoptium.net/v3/assets/latest';
const INDEX_FILE = path.join(dirs.runtimes, 'index.json');
const ARCH = process.arch === 'arm64' ? 'aarch64' : 'x64';

// 国内镜像按 Adoptium 官方目录结构组织，文件名与 API 返回一致
const MIRRORS = [
  asset => `https://mirrors.tuna.tsinghua.edu.cn/Adoptium/${asset.major}/${asset.imageType}/${asset.arch}/windows/${asset.name}`,
];

const installing = new Map();

function readIndex() {
  try {
    const parsed = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function writeIndex(entries) {
  fs.mkdirSync(dirs.runtimes, { recursive: true });
  fs.writeFileSync(INDEX_FILE, JSON.stringify(entries, null, 2), 'utf-8');
}

/** 已下载且文件仍在的运行时；索引丢了会按目录名（temurin-<主版本>）自愈重建 */
function list() {
  const stored = readIndex();
  const alive = stored.filter(entry => entry.path && fs.existsSync(entry.path));
  let changed = alive.length !== stored.length;

  let dirsOnDisk = [];
  try { dirsOnDisk = fs.readdirSync(dirs.runtimes, { withFileTypes: true }); } catch (_) { /* 目录还没建 */ }
  for (const entry of dirsOnDisk) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const matched = /^temurin-(\d+)$/.exec(entry.name);
    if (!matched) continue;
    const feature = Number(matched[1]);
    if (alive.some(item => item.feature === feature)) continue;
    const found = locate(path.join(dirs.runtimes, entry.name));
    if (!found) continue;
    alive.push({
      feature,
      vendor: 'Eclipse Temurin',
      version: '',
      home: found.home,
      path: found.path,
      installedAt: 0,
      sizeMB: 0,
    });
    changed = true;
  }

  if (changed) writeIndex(alive); // 手动删过目录、或索引丢失时顺手修正
  return alive.map(entry => ({ ...entry }));
}

function find(feature) {
  return list().find(entry => entry.feature === Number(feature)) || null;
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/** 解压目录里找出 java.exe / javaw.exe（压缩包通常还套一层 jdk-xxx 目录） */
function locate(home) {
  const candidates = [home];
  try {
    for (const entry of fs.readdirSync(home, { withFileTypes: true })) {
      if (entry.isDirectory()) candidates.push(path.join(home, entry.name));
    }
  } catch (_) { /* 目录读不到就走空 */ }
  for (const root of candidates) {
    const consoleExe = path.join(root, 'bin', 'java.exe');
    if (!fs.existsSync(consoleExe)) continue;
    const javaw = path.join(root, 'bin', 'javaw.exe');
    return { home: root, path: fs.existsSync(javaw) ? javaw : consoleExe, consolePath: consoleExe };
  }
  return null;
}

async function resolveAsset(major) {
  const queries = [
    `?architecture=${ARCH}&image_type=jre&os=windows&vendor=eclipse&heap_size=normal`,
    `?architecture=${ARCH}&image_type=jre&os=windows&vendor=eclipse`,
    `?architecture=${ARCH}&image_type=jdk&os=windows&vendor=eclipse`,
  ];
  let lastError = null;
  for (const query of queries) {
    try {
      const list_ = await net.requestJson(`${ADOPTIUM_API}/${major}/hotspot${query}`, { timeout: 25000 });
      const item = Array.isArray(list_) ? list_[0] : null;
      const pkg = item?.binary?.package;
      if (!pkg?.link || !pkg?.name) continue;
      return {
        major,
        arch: ARCH,
        imageType: item.binary?.image_type || (pkg.name.includes('-jdk_') ? 'jdk' : 'jre'),
        name: pkg.name,
        link: pkg.link,
        size: pkg.size || 0,
        sha256: String(pkg.checksum || '').toLowerCase(),
        version: item.version?.semver || String(item.version?.major || major),
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error('无法获取 Java ' + major + ' 的下载地址' + (lastError ? '：' + lastError.message : '，请检查网络'));
}

async function downloadAsset(asset, zipPath, emit) {
  const urls = [...MIRRORS.map(build => build(asset)), asset.link]
    .filter((url, index, all) => url && all.indexOf(url) === index);
  let lastError = null;

  for (const url of urls) {
    try {
      const host = new URL(url).host;
      emit({ phase: 'download', percent: 0, message: `正在下载 Java ${asset.major}（${Math.round(asset.size / 1048576)} MB · ${host}）…` });
      await net.download(url, zipPath, {
        timeout: 120000,
        onProgress: (received, total) => {
          const size = total || asset.size || 0;
          emit({
            phase: 'download',
            percent: size ? Math.min(94, Math.round((received / size) * 94)) : 0,
            received,
            total: size,
            message: `正在下载 Java ${asset.major} · ${(received / 1048576).toFixed(1)} / ${(size / 1048576).toFixed(1)} MB`,
          });
        },
      });
      if (asset.sha256) {
        const actual = await sha256File(zipPath);
        if (actual !== asset.sha256) {
          fs.rmSync(zipPath, { force: true });
          throw new Error(`SHA256 校验不通过（${host}）`);
        }
      }
      return;
    } catch (error) {
      lastError = error;
      try { fs.rmSync(zipPath, { force: true }); } catch (_) { /* 忽略 */ }
      try { fs.rmSync(`${zipPath}.part`, { force: true }); } catch (_) { /* 忽略 */ }
    }
  }
  throw new Error('Java 下载失败：' + (lastError?.message || '所有下载源均不可用'));
}

/** 清掉上次中断留下的临时解压目录，避免被 Java 扫描当成独立运行时 */
function cleanStaging() {
  let entries = [];
  try { entries = fs.readdirSync(dirs.runtimes); } catch (_) { return; }
  for (const name of entries) {
    if (!name.startsWith('.staging-')) continue;
    try { fs.rmSync(path.join(dirs.runtimes, name), { recursive: true, force: true }); } catch (_) { /* 占用时忽略 */ }
  }
}

async function install(major, onProgress) {
  const emit = payload => {
    if (typeof onProgress !== 'function') return;
    try { onProgress({ feature: major, percent: 0, ...payload }); } catch (_) { /* 回调异常不影响安装 */ }
  };

  cleanStaging();
  console.log(`[javadl] 开始安装 Java ${major}`);
  emit({ phase: 'resolve', message: `正在获取 Java ${major} 下载信息…` });
  const asset = await resolveAsset(major);

  const zipPath = path.join(dirs.temp, asset.name);
  const cached = fs.existsSync(zipPath) && asset.sha256 && (await sha256File(zipPath)) === asset.sha256;
  if (!cached) await downloadAsset(asset, zipPath, emit);

  emit({ phase: 'extract', percent: 96, message: `正在解压 Java ${major}…` });
  const staging = path.join(dirs.runtimes, `.staging-${major}-${Date.now()}`);
  const target = path.join(dirs.runtimes, `temurin-${major}`);
  try {
    try { fs.rmSync(staging, { recursive: true, force: true }); } catch (_) { /* 忽略 */ }
    const stats = unzip.extract(zipPath, staging, info => {
      emit({ phase: 'extract', percent: 96, message: `正在解压 Java ${major}（${info.done}/${info.total}）…` });
    });
    if (!stats.files) throw new Error('压缩包是空的');

    const found = locate(staging);
    if (!found) throw new Error('解压后没有找到 java.exe');

    const probed = await java.probe(found.consolePath);
    if (!probed) throw new Error('下载的 Java 无法运行（可能是文件损坏）');
    if (probed.major !== major) throw new Error(`下载的 Java 版本不符：期望 ${major}，实际 ${probed.major}`);

    const relative = path.relative(staging, found.path);
    try { fs.rmSync(target, { recursive: true, force: true }); } catch (_) { /* 忽略 */ }
    fs.renameSync(staging, target);

    const entry = {
      feature: major,
      vendor: 'Eclipse Temurin',
      version: asset.version,
      home: path.join(target, path.relative(staging, found.home)),
      path: path.join(target, relative),
      installedAt: Date.now(),
      sizeMB: Math.round(stats.bytes / 1048576),
    };
    const entries = readIndex().filter(item => item.feature !== major);
    entries.push(entry);
    writeIndex(entries);

    try { fs.rmSync(zipPath, { force: true }); } catch (_) { /* 忽略 */ }
    emit({ phase: 'done', percent: 100, message: `Java ${major} 已就绪`, entry });
    return entry;
  } catch (error) {
    try { fs.rmSync(staging, { recursive: true, force: true }); } catch (_) { /* 忽略 */ }
    emit({ phase: 'error', percent: 0, message: error.message });
    throw error;
  }
}

/** 已有就返回，没有就下载；同版本并发调用只会真正下一次 */
function ensure(feature, onProgress) {
  const major = Number(feature);
  if (!Number.isFinite(major) || major < 8) return Promise.reject(new Error('Java 主版本非法: ' + feature));
  const existing = find(major);
  if (existing) return Promise.resolve(existing);
  if (installing.has(major)) return installing.get(major);
  const task = install(major, onProgress).finally(() => installing.delete(major));
  installing.set(major, task);
  return task;
}

function remove(feature) {
  const major = Number(feature);
  const entry = find(major);
  const target = entry?.home ? path.dirname(entry.home) : path.join(dirs.runtimes, `temurin-${major}`);
  try { fs.rmSync(target, { recursive: true, force: true }); } catch (_) { /* 文件被占用，下面复核 */ }
  writeIndex(readIndex().filter(item => item.feature !== major));
  const remaining = list();
  if (remaining.some(item => item.feature === major)) {
    throw new Error(`Java ${major} 删除失败：文件可能正被占用，关掉正在用它的程序后重试`);
  }
  return remaining;
}

// 启动时先清一遍上次中断留下的临时目录
cleanStaging();

module.exports = { ensure, list, find, remove, INDEX_FILE };
