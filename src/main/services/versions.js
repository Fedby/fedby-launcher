'use strict';
// 版本服务：本地版本索引、Mojang 版本清单、安装与 classpath 解析。
const fs = require('fs');
const path = require('path');
const { dirs, ASSET_ENDPOINTS } = require('./paths');
const settings = require('./settings');
const net = require('./net');

const PLATFORM = { os: 'windows', arch: 'x64' };

function paths(versionId) {
  const dir = path.join(dirs.versions, versionId);
  return { dir, json: path.join(dir, versionId + '.json'), jar: path.join(dir, versionId + '.jar') };
}

function read(versionId) {
  const { json } = paths(versionId);
  if (!fs.existsSync(json)) return null;
  try { return JSON.parse(fs.readFileSync(json, 'utf-8')); } catch (_) { return null; }
}

function list() {
  if (!fs.existsSync(dirs.versions)) return [];
  const out = [];
  for (const id of fs.readdirSync(dirs.versions)) {
    const json = read(id);
    if (!json) continue;
    const { jar } = paths(id);
    const hasJar = fs.existsSync(jar);
    out.push({
      id,
      type: json.type || 'release',
      mainClass: json.mainClass || '',
      javaMajor: json.javaVersion?.majorVersion || 8,
      releaseTime: json.releaseTime || '',
      assetIndex: json.assetIndex?.id || '',
      hasJar,
      jarSize: hasJar ? fs.statSync(jar).size : 0,
      modded: /forge|fabric|neoforge|quilt/i.test(id) || /forge|fabric|neoforge|quilt/i.test(json.mainClass || ''),
    });
  }
  return out.sort((a, b) => String(b.releaseTime).localeCompare(String(a.releaseTime)) || b.id.localeCompare(a.id));
}

function detail(versionId) {
  const json = read(versionId);
  if (!json) return null;
  return {
    id: json.id || versionId,
    type: json.type,
    mainClass: json.mainClass,
    javaVersion: json.javaVersion,
    assetIndex: json.assetIndex,
    libraries: (json.libraries || []).length,
    releaseTime: json.releaseTime,
    hasJar: fs.existsSync(paths(versionId).jar),
  };
}

let manifestCache = null;
let manifestAt = 0;

async function manifest(force = false) {
  if (!force && manifestCache && Date.now() - manifestAt < 10 * 60 * 1000) return manifestCache;
  manifestCache = await net.requestJson(ASSET_ENDPOINTS.manifest);
  manifestAt = Date.now();
  return manifestCache;
}

async function remote(type = 'release') {
  const data = await manifest();
  const list = (data.versions || []).filter(v => type === 'all' || v.type === 'release');
  return list.map(v => ({ id: v.id, type: v.type, releaseTime: v.releaseTime, sha1: v.sha1, url: v.url }));
}

// ---------- library 解析 ----------
function ruleAllows(rules, platform = PLATFORM) {
  if (!rules || !rules.length) return true;
  let allowed = false;
  for (const rule of rules) {
    const osName = rule.os?.name;
    const osArch = rule.os?.arch;
    let match = true;
    if (osName && osName !== platform.os) match = false;
    if (osArch && osArch !== platform.arch) match = false;
    for (const key of Object.keys(rule.features || {})) {
      if ((platform.features || {})[key] !== rule.features[key]) match = false;
    }
    if (match) allowed = (rule.action || 'allow') === 'allow';
  }
  return allowed;
}

function libraryFiles(lib, platform = PLATFORM) {
  const files = [];
  const downloads = lib.downloads || {};
  if (downloads.artifact?.path && downloads.artifact?.url) {
    files.push({ kind: 'artifact', ...downloads.artifact });
  }
  // 老式结构：natives 走 classifiers；26.x 的 natives 已作为独立 artifact 条目，会命中上面的分支
  const classifierKey = lib.natives?.[platform.os] || lib.natives?.[`${platform.os}-${platform.arch}`];
  const classifier = classifierKey ? downloads.classifiers?.[classifierKey] : null;
  if (classifier?.path && classifier?.url) files.push({ kind: 'native', ...classifier });
  return files;
}

/**
 * 解析 classpath 与缺失文件。26.x 的 natives 是普通条目，全部进 classpath。
 * @returns {{entries:string[], missing:Array<{url:string,path:string,sha1?:string,size?:number}>}}
 */
function classpath(versionJson, platform = PLATFORM) {
  const entries = [];
  const missing = [];
  for (const lib of versionJson.libraries || []) {
    if (!ruleAllows(lib.rules, platform)) continue;
    for (const file of libraryFiles(lib, platform)) {
      const dest = path.join(dirs.libraries, file.path.split('/').join(path.sep));
      entries.push(dest);
      if (!fs.existsSync(dest)) {
        missing.push({ url: file.url, dest, sha1: file.sha1, size: file.size, label: file.path });
      } else if (file.sha1) {
        // 只在体积不符时才校验哈希，避免每次启动都读几百个 jar
        const sizeOk = !file.size || fs.statSync(dest).size === file.size;
        if (!sizeOk) missing.push({ url: file.url, dest, sha1: file.sha1, size: file.size, label: file.path });
      }
    }
  }
  return { entries, missing };
}

// ---------- 安装 ----------
async function install(versionId, onProgress = () => {}) {
  const data = await manifest();
  const meta = (data.versions || []).find(v => v.id === versionId);
  const jsonUrl = meta?.url || (String(versionId).startsWith('http') ? versionId : null);
  if (!jsonUrl) throw new Error('未找到版本: ' + versionId);

  onProgress({ stage: '读取版本信息', current: 0, total: 1 });
  const versionJson = await net.requestJson(jsonUrl);
  const id = versionJson.id;
  const target = paths(id);
  fs.mkdirSync(target.dir, { recursive: true });
  fs.writeFileSync(target.json, JSON.stringify(versionJson, null, 2), 'utf-8');

  const tasks = [];
  if (versionJson.downloads?.client?.url) {
    tasks.push({
      url: versionJson.downloads.client.url,
      dest: target.jar,
      sha1: versionJson.downloads.client.sha1,
      size: versionJson.downloads.client.size,
      label: '客户端 jar',
    });
  }
  const { missing } = classpath(versionJson);
  tasks.push(...missing);

  onProgress({ stage: '下载依赖库', current: 0, total: tasks.length });
  let done = 0;
  await net.pool(tasks, settings.get().downloadConcurrency, async task => {
    const exists = fs.existsSync(task.dest);
    const sameSize = exists && (!task.size || fs.statSync(task.dest).size === task.size);
    if (!exists || (!sameSize && task.sha1)) {
      try { await net.download(task.url, task.dest, { sha1: task.sha1 }); }
      catch (err) { if (!exists) throw err; }
    }
    done += 1;
    onProgress({ stage: '下载依赖库', current: done, total: tasks.length, item: task.label });
  });

  if (versionJson.assetIndex) await installAssets(versionJson.assetIndex, onProgress);

  onProgress({ stage: '安装完成', current: 1, total: 1 });
  return { id, versionJson };
}

async function installAssets(assetIndex, onProgress) {
  const indexFile = path.join(dirs.assets, 'indexes', assetIndex.id + '.json');
  if (!fs.existsSync(indexFile)) {
    onProgress({ stage: '下载资源索引', current: 0, total: 1 });
    await net.download(assetIndex.url, indexFile, { sha1: assetIndex.sha1 });
  }
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf-8'));
  const objects = Object.entries(index.objects || {});
  const pending = objects.filter(([, obj]) => {
    const dest = path.join(dirs.assets, 'objects', obj.hash.slice(0, 2), obj.hash);
    return !fs.existsSync(dest) || (obj.size && fs.statSync(dest).size !== obj.size);
  });
  if (!pending.length) return;

  const concurrency = Math.max(4, settings.get().downloadConcurrency);
  onProgress({ stage: '下载游戏资源', current: 0, total: pending.length });
  let done = 0;
  await net.pool(pending, concurrency, async ([name, obj]) => {
    const dest = path.join(dirs.assets, 'objects', obj.hash.slice(0, 2), obj.hash);
    try {
      await net.download(ASSET_ENDPOINTS.resources + obj.hash.slice(0, 2) + '/' + obj.hash, dest, { sha1: obj.hash });
    } catch (err) {
      console.error('[versions] 资源下载失败', name, err.message);
    }
    done += 1;
    if (done % 10 === 0 || done === pending.length) {
      onProgress({ stage: '下载游戏资源', current: done, total: pending.length, item: name });
    }
  });
}

function remove(versionId) {
  if (!versionId || /[\\/]/.test(versionId)) throw new Error('版本 ID 非法');
  const { dir } = paths(versionId);
  if (!dir.startsWith(dirs.versions)) throw new Error('路径越界');
  fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = { paths, read, list, detail, remote, manifest, classpath, ruleAllows, libraryFiles, install, remove, PLATFORM };
