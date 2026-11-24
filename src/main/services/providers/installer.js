'use strict';
// 通用安装器：主文件 + required 依赖递归下载。下载源只负责「给版本、给下载地址」。
const fs = require('fs');
const path = require('path');
const net = require('../net');
const { dirs } = require('../paths');
const types = require('./types');

const MAX_FILES = 40;

/**
 * @param {{
 *   provider: {name:string, versions:Function, versionById:Function, downloadHeaders?:Function},
 *   projectId: string, versionId?: string, gameVersion?: string, loader?: string,
 *   targetType?: string, installDependencies?: boolean, onProgress?: Function
 * }} options
 */
async function install(options) {
  const {
    provider, projectId, versionId = '', gameVersion = '', loader = '',
    targetType = 'mod', installDependencies = true, onProgress = () => {},
  } = options;

  const mainDir = types.dirOf(targetType);
  const depsDir = dirs.mods; // 依赖统一放 mods
  fs.mkdirSync(mainDir, { recursive: true });
  fs.mkdirSync(depsDir, { recursive: true });

  const headers = provider.downloadHeaders ? provider.downloadHeaders() : {};
  const queue = [{ id: String(projectId), versionId: versionId || null, main: true, role: '主文件' }];
  const seen = new Set();
  const results = [];

  onProgress({ stage: 'prepare', item: '准备安装…', percent: 0 });

  while (queue.length && results.length < MAX_FILES) {
    const task = queue.shift();
    const dedupeKey = `${task.id}:${task.versionId || ''}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    let version = null;
    try {
      version = task.versionId
        ? await provider.versionById(task.versionId, task.id)
        : (await provider.versions(task.id, gameVersion, loader))[0];
    } catch (err) {
      results.push({ name: task.id, status: 'error', reason: err.message });
      continue;
    }
    if (!version) {
      results.push({ name: task.id, status: 'skip', reason: '没有匹配的版本' });
      continue;
    }

    if (installDependencies) {
      for (const dep of version.dependencies || []) {
        if (!dep.projectId) continue;
        const depKey = `${dep.projectId}:${dep.versionId || ''}`;
        if (seen.has(depKey)) continue;
        queue.push({ id: dep.projectId, versionId: dep.versionId, main: false, role: '依赖' });
      }
    }

    const file = (version.files || []).find(item => item.primary) || (version.files || [])[0];
    if (!file?.url) {
      results.push({ name: version.name, status: 'skip', reason: '作者限制直接下载，请到项目主页手动下载' });
      onProgress({ stage: 'skip', item: version.name, percent: 100 });
      continue;
    }

    const dest = path.join(task.main ? mainDir : depsDir, file.name);
    if (fs.existsSync(dest)) {
      results.push({ name: file.name, status: 'skip', reason: '已存在', path: dest });
      onProgress({ stage: 'skip', item: file.name, percent: 100 });
      continue;
    }

    onProgress({ stage: 'download', item: file.name, label: task.role, percent: 0 });
    try {
      await net.download(file.url, dest, {
        sha1: file.sha1 || undefined,
        headers,
        timeout: 120000,
        onProgress: (current, total) => onProgress({
          stage: 'download', item: file.name, label: task.role,
          current, total, percent: total ? Math.round((current / total) * 100) : 0,
        }),
      });
      results.push({ name: file.name, status: 'installed', path: dest, size: file.size });
      onProgress({ stage: 'done', item: file.name, percent: 100 });
    } catch (err) {
      results.push({ name: file.name, status: 'error', reason: err.message });
      onProgress({ stage: 'error', item: file.name, error: err.message });
    }
  }

  return {
    installed: results.filter(item => item.status === 'installed'),
    skipped: results.filter(item => item.status === 'skip'),
    failed: results.filter(item => item.status === 'error'),
    all: results,
  };
}

// 已安装检测：用文件名归一化后比对，提示「可能已安装」
function installedIndex(targetType) {
  const dir = types.dirOf(targetType);
  if (!fs.existsSync(dir)) return {};
  const out = {};
  for (const file of fs.readdirSync(dir)) {
    if (!/\.(jar|zip)(\.disabled)?$/i.test(file)) continue;
    out[file.replace(/\.disabled$/i, '').toLowerCase()] = file;
  }
  return out;
}

module.exports = { install, installedIndex };
