'use strict';
// 账户存储：账户列表持久化、离线账户、皮肤文件读写。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dirs } = require('./paths');

function readAll() {
  try {
    if (!fs.existsSync(dirs.accounts)) return [];
    const data = JSON.parse(fs.readFileSync(dirs.accounts, 'utf-8'));
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('[accounts] 读取账户失败:', err.message);
    return [];
  }
}

function writeAll(list) {
  fs.mkdirSync(path.dirname(dirs.accounts), { recursive: true });
  const tmp = `${dirs.accounts}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf-8');
  fs.renameSync(tmp, dirs.accounts);
  return list;
}

function list() { return readAll(); }

function find(id) { return readAll().find(account => account.id === id) || null; }

function upsert(account) {
  const all = readAll();
  const index = all.findIndex(item => item.id === account.id);
  if (index >= 0) all[index] = { ...all[index], ...account };
  else all.push(account);
  writeAll(all);
  return account;
}

function remove(id) {
  writeAll(readAll().filter(account => account.id !== id));
  return readAll();
}

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// 离线 UUID：与常见启动器一致，由 OfflinePlayer:名字 的 MD5 生成 v3 UUID
function offlineUUID(name) {
  const hash = crypto.createHash('md5').update('OfflinePlayer:' + name.toLowerCase()).digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function createOffline(name) {
  const trimmed = String(name || '').trim();
  if (!/^[A-Za-z0-9_]{1,16}$/.test(trimmed)) throw new Error('昵称需为 1-16 位字母、数字或下划线');
  if (readAll().some(account => account.type === 'offline' && account.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error('已存在同名离线账户');
  }
  const account = {
    id: newId(),
    type: 'offline',
    name: trimmed,
    uuid: offlineUUID(trimmed),
    accessToken: '0',
    createdAt: new Date().toISOString(),
  };
  upsert(account);
  return account;
}

// ---------- 皮肤文件 ----------
function skinPath(uuid) {
  const clean = String(uuid || '').replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(clean)) return null;
  return path.join(dirs.skins, clean + '.png');
}

function writeSkin(uuid, buffer) {
  const target = skinPath(uuid);
  if (!target) return null;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buffer);
  return target;
}

function skinDataUrl(uuid) {
  const target = skinPath(uuid);
  if (!target || !fs.existsSync(target)) return '';
  try { return 'data:image/png;base64,' + fs.readFileSync(target).toString('base64'); } catch (_) { return ''; }
}

module.exports = {
  list, find, upsert, remove, newId, createOffline, offlineUUID,
  skinPath, writeSkin, skinDataUrl,
};
