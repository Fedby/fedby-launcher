'use strict';
// 内容服务：模组 / 资源包 / 光影 / 存档 / 备份的本地管理。
const fs = require('fs');
const path = require('path');
const { dirs } = require('./paths');

function ensure(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  return dir;
}

function insideDir(dir, target) {
  const root = path.resolve(dir) + path.sep;
  return path.resolve(target).startsWith(root);
}

// ---------- 模组 ----------
function listMods() {
  ensure(dirs.mods);
  const out = [];
  for (const file of fs.readdirSync(dirs.mods)) {
    if (!/\.(jar|zip)(\.disabled)?$/i.test(file)) continue;
    const full = path.join(dirs.mods, file);
    const stat = fs.statSync(full);
    out.push({
      file,
      name: file.replace(/\.jar(\.disabled)?$|\.zip$/i, ''),
      enabled: !file.endsWith('.disabled'),
      size: stat.size,
      modified: stat.mtime.toISOString(),
      path: full,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function toggleMod(file, enabled) {
  const source = path.join(dirs.mods, file);
  if (!insideDir(dirs.mods, source) || !fs.existsSync(source)) throw new Error('文件不存在: ' + file);
  let target;
  if (enabled && file.endsWith('.disabled')) target = source.slice(0, -'.disabled'.length);
  else if (!enabled && !file.endsWith('.disabled')) target = source + '.disabled';
  else return;
  fs.renameSync(source, target);
}

function deleteMod(file) {
  const target = path.join(dirs.mods, file);
  if (!insideDir(dirs.mods, target)) throw new Error('非法路径');
  fs.rmSync(target, { force: true });
}

// ---------- 资源包 / 光影 ----------
function listFolder(dir) {
  ensure(dir);
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const isDir = fs.statSync(full).isDirectory();
    if (!isDir && !name.toLowerCase().endsWith('.zip')) continue;
    out.push({ file: name, name: name.replace(/\.zip$/i, ''), kind: isDir ? 'folder' : 'zip', path: full });
  }
  return out;
}

// ---------- 存档 ----------
function folderSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (_) { continue; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else { try { total += fs.statSync(full).size; } catch (_) {} }
    }
  }
  return total;
}

function listSaves() {
  ensure(dirs.saves);
  const out = [];
  for (const name of fs.readdirSync(dirs.saves)) {
    const full = path.join(dirs.saves, name);
    if (!fs.statSync(full).isDirectory()) continue;
    let label = name;
    try {
      const nameFile = path.join(full, 'levelname.txt');
      if (fs.existsSync(nameFile)) label = fs.readFileSync(nameFile, 'utf-8').trim() || name;
    } catch (_) {}
    let icon = '';
    const iconFile = path.join(full, 'icon.png');
    if (fs.existsSync(iconFile)) {
      try { icon = 'data:image/png;base64,' + fs.readFileSync(iconFile).toString('base64'); } catch (_) {}
    }
    const stat = fs.statSync(full);
    out.push({ id: name, name: label, path: full, modified: stat.mtime.toISOString(), size: folderSize(full), icon });
  }
  return out.sort((a, b) => b.modified.localeCompare(a.modified));
}

function backupSave(saveId) {
  const source = path.join(dirs.saves, saveId);
  if (!insideDir(dirs.saves, source) || !fs.existsSync(source)) throw new Error('存档不存在');
  ensure(dirs.backups);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = path.join(dirs.backups, `${saveId}_${stamp}`);
  fs.cpSync(source, dest, { recursive: true });
  return { name: path.basename(dest), path: dest };
}

function listBackups() {
  ensure(dirs.backups);
  return fs.readdirSync(dirs.backups).map(name => {
    const full = path.join(dirs.backups, name);
    return { name, path: full, size: folderSize(full), created: fs.statSync(full).mtime.toISOString() };
  }).sort((a, b) => b.created.localeCompare(a.created));
}

function restoreSave(backupName, saveId) {
  const source = path.join(dirs.backups, backupName);
  if (!insideDir(dirs.backups, source) || !fs.existsSync(source)) throw new Error('备份不存在');
  ensure(dirs.saves);
  const dest = path.join(dirs.saves, saveId || backupName.replace(/_\d{4}-.*$/, ''));
  if (fs.existsSync(dest)) fs.renameSync(dest, `${dest}_before_restore_${Date.now()}`);
  fs.cpSync(source, dest, { recursive: true });
  return dest;
}

function deleteSave(saveId) {
  const target = path.join(dirs.saves, saveId);
  if (!insideDir(dirs.saves, target)) throw new Error('非法路径');
  fs.rmSync(target, { recursive: true, force: true });
}

module.exports = {
  listMods, toggleMod, deleteMod,
  listResourcePacks: () => listFolder(dirs.resourcepacks),
  listShaderPacks: () => listFolder(dirs.shaderpacks),
  listSaves, backupSave, listBackups, restoreSave, deleteSave,
  folderSize, ensure,
};
