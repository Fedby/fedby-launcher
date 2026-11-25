'use strict';
// 版本服务：本地版本索引、Mojang 版本清单、安装与 classpath 解析。
const fs = require('fs');
const path = require('path');
const { dirs, ASSET_ENDPOINTS } = require('./paths');
const settings = require('./settings');
const net = require('./net');
const mirror = require('./mirror');

const PLATFORM = { os: 'windows', arch: 'x64' };

function paths(versionId) {
  const dir = path.join(dirs.versions, versionId);
  return { dir, json: path.join(dir, versionId + '.json'), jar: path.join(dir, versionId + '.jar') };
}

/** 原样读取版本 JSON（不含 inheritsFrom 合并） */
function readRaw(versionId) {
  const { json } = paths(versionId);
  if (!fs.existsSync(json)) return null;
  try { return JSON.parse(fs.readFileSync(json, 'utf-8')); } catch (_) { return null; }
}

function dedupeArgs(parentArgs, childArgs) {
  const out = [];
  const seen = new Set();
  for (const arg of [...(parentArgs || []), ...(childArgs || [])]) {
    const key = typeof arg === 'string' ? arg : JSON.stringify(arg);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(arg);
  }
  return out;
}

function mergeLibraries(parentLibs, childLibs) {
  const out = [];
  const index = new Map();
  for (const lib of [...(parentLibs || []), ...(childLibs || [])]) {
    const key = lib.name || JSON.stringify(lib.downloads || lib);
    if (index.has(key)) out[index.get(key)] = lib;
    else { index.set(key, out.length); out.push(lib); }
  }
  return out;
}

/**
 * 合并 inheritsFrom 父版本：Forge / NeoForge / Fabric / OptiFine 的版本 JSON 都是「增量」，
 * 自己只有 mainClass + 额外库，args/assets 必须从原版继承。
 */
function mergeVersion(parent, child) {
  const merged = { ...parent, ...child };
  merged.id = child.id || parent.id;
  merged.libraries = mergeLibraries(parent.libraries, child.libraries);
  if (parent.arguments || child.arguments) {
    merged.arguments = {
      game: dedupeArgs(parent.arguments?.game, child.arguments?.game),
      jvm: dedupeArgs(parent.arguments?.jvm, child.arguments?.jvm),
    };
    if (!merged.arguments.game.length) delete merged.arguments.game;
    if (!merged.arguments.jvm.length) delete merged.arguments.jvm;
  }
  merged.minecraftArguments = child.minecraftArguments || parent.minecraftArguments;
  merged.downloads = { ...(parent.downloads || {}), ...(child.downloads || {}) };
  merged.assetIndex = child.assetIndex || parent.assetIndex;
  merged.assets = child.assets || parent.assets;
  merged.javaVersion = child.javaVersion || parent.javaVersion;
  merged.type = child.type || parent.type || 'release';
  merged.releaseTime = child.releaseTime || parent.releaseTime;
  merged.time = child.time || parent.time;
  return merged;
}

/** 读取并沿 inheritsFrom 链合并后的版本 JSON */
function read(versionId, depth = 0) {
  const raw = readRaw(versionId);
  if (!raw) return null;
  if (!raw.inheritsFrom || depth > 5) return raw;
  const parent = read(raw.inheritsFrom, depth + 1);
  if (!parent) {
    console.warn(`[versions] ${versionId} 的父版本 ${raw.inheritsFrom} 缺失，按原样使用`);
    return raw;
  }
  return mergeVersion(parent, raw);
}

/** 客户端 jar：模组版本自身没有 jar，向上找到原版那一份 */
function clientJar(versionId, depth = 0) {
  if (!versionId || depth > 5) return '';
  const { jar } = paths(versionId);
  if (fs.existsSync(jar)) return jar;
  const raw = readRaw(versionId);
  if (raw?.inheritsFrom) return clientJar(raw.inheritsFrom, depth + 1);
  return jar;
}

function list() {
  if (!fs.existsSync(dirs.versions)) return [];
  const out = [];
  for (const id of fs.readdirSync(dirs.versions)) {
    const raw = readRaw(id);
    if (!raw) continue;
    const json = raw.inheritsFrom ? (read(id) || raw) : raw;
    const jar = clientJar(id);
    const hasJar = !!jar && fs.existsSync(jar);
    out.push({
      id,
      type: json.type || 'release',
      mainClass: json.mainClass || '',
      javaMajor: json.javaVersion?.majorVersion || 8,
      releaseTime: json.releaseTime || '',
      assetIndex: json.assetIndex?.id || '',
      inheritsFrom: raw.inheritsFrom || '',
      hasJar,
      jarSize: hasJar ? fs.statSync(jar).size : 0,
      modded: /forge|fabric|neoforge|quilt|optifine/i.test(id) || /forge|fabric|neoforge|quilt|optifine/i.test(json.mainClass || ''),
    });
  }
  return out.sort((a, b) => String(b.releaseTime).localeCompare(String(a.releaseTime)) || b.id.localeCompare(a.id));
}

function detail(versionId) {
  const json = read(versionId);
  if (!json) return null;
  const raw = readRaw(versionId) || {};
  return {
    id: json.id || versionId,
    type: json.type,
    mainClass: json.mainClass,
    javaVersion: json.javaVersion,
    assetIndex: json.assetIndex,
    libraries: (json.libraries || []).length,
    releaseTime: json.releaseTime,
    inheritsFrom: raw.inheritsFrom || '',
    hasJar: fs.existsSync(clientJar(versionId)),
  };
}

let manifestCache = null;
let manifestAt = 0;

async function manifest(force = false) {
  if (!force && manifestCache && Date.now() - manifestAt < 10 * 60 * 1000) return manifestCache;
  // 官方 / 镜像按当前源排序，失败自动换另一边
  manifestCache = await net.requestJsonAny(mirror.manifestUrls(), { timeout: 25000 });
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
  // url 可能为空：Forge 安装器在本地生成的 client / shim jar 只给 path + sha1
  if (downloads.artifact?.path) {
    files.push({ kind: 'artifact', ...downloads.artifact });
  }
  // 老式结构：natives 走 classifiers；26.x 的 natives 已作为独立 artifact 条目，会命中上面的分支
  const classifierKey = lib.natives?.[platform.os] || lib.natives?.[`${platform.os}-${platform.arch}`];
  const classifier = classifierKey ? downloads.classifiers?.[classifierKey] : null;
  if (classifier?.path) files.push({ kind: 'native', ...classifier });
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
        // 没有下载地址说明是安装器本地生成的（如 Forge 的 client jar），缺了只能重装
        if (file.url) missing.push({ url: file.url, dest, sha1: file.sha1, size: file.size, label: file.path });
      } else if (file.url && file.sha1) {
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
  const versionJson = await net.requestJsonAny(mirror.versionJsonUrls(versionId, jsonUrl), { timeout: 25000 });
  const id = versionJson.id;
  const target = paths(id);
  fs.mkdirSync(target.dir, { recursive: true });
  fs.writeFileSync(target.json, JSON.stringify(versionJson, null, 2), 'utf-8');

  const tasks = [];
  if (versionJson.downloads?.client?.url) {
    tasks.push({
      urls: mirror.urlsFor(versionJson.downloads.client.url, id),
      dest: target.jar,
      sha1: versionJson.downloads.client.sha1,
      size: versionJson.downloads.client.size,
      label: '客户端 jar',
    });
  }
  const { missing } = classpath(versionJson);
  tasks.push(...missing.map(task => ({ ...task, urls: mirror.urlsFor(task.url, id) })));

  onProgress({ stage: '下载依赖库', current: 0, total: tasks.length });
  let done = 0;
  await net.pool(tasks, settings.get().downloadConcurrency, async task => {
    const exists = fs.existsSync(task.dest);
    const sameSize = exists && (!task.size || fs.statSync(task.dest).size === task.size);
    if (!exists || (!sameSize && task.sha1)) {
      // 单个文件超时压短些：镜像节点抽风时能尽快换另一边，而不是干等 60 秒
      const timeout = task.label === '客户端 jar' ? 180000 : 25000;
      try {
        await net.downloadAny(task.urls || [task.url], task.dest, {
          sha1: task.sha1, timeout, onFail: mirror.noteFailure, onSuccess: mirror.noteSuccess,
        });
      }
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
    await net.downloadAny(mirror.urlsFor(assetIndex.url), indexFile, { sha1: assetIndex.sha1, timeout: 30000 });
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
      const objectUrl = ASSET_ENDPOINTS.resources + obj.hash.slice(0, 2) + '/' + obj.hash;
      await net.downloadAny(mirror.urlsFor(objectUrl), dest, {
        sha1: obj.hash, timeout: 12000, onFail: mirror.noteFailure, onSuccess: mirror.noteSuccess,
      });
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

/** 写入一个版本 JSON（供加载器安装使用），返回版本目录 */
function writeVersionJson(versionId, json) {
  const target = paths(versionId);
  fs.mkdirSync(target.dir, { recursive: true });
  fs.writeFileSync(target.json, JSON.stringify({ ...json, id: versionId }, null, 2), 'utf-8');
  return target.dir;
}

/** Forge / OptiFine 的官方安装器要求游戏目录里存在 launcher_profiles.json */
function ensureLauncherProfiles() {
  const file = path.join(dirs.game, 'launcher_profiles.json');
  if (fs.existsSync(file)) return file;
  fs.mkdirSync(dirs.game, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ profiles: {}, settings: {}, version: 3 }, null, 2), 'utf-8');
  return file;
}

module.exports = {
  paths, read, readRaw, clientJar, list, detail, remote, manifest, classpath, ruleAllows, libraryFiles,
  install, remove, writeVersionJson, ensureLauncherProfiles, PLATFORM,
};
