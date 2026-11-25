'use strict';
// 启动服务：把版本 JSON 变成真实命令行，管理游戏进程与日志流。
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { dirs } = require('./paths');
const versions = require('./versions');

let child = null;
const logListeners = new Set();

function onLog(listener) {
  logListeners.add(listener);
  return () => logListeners.delete(listener);
}

function emit(stream, text) {
  for (const listener of logListeners) {
    try { listener({ stream, text }); } catch (_) { /* 渲染层已关闭时忽略 */ }
  }
}

function fillTemplate(arg, values) {
  if (typeof arg !== 'string' || !arg.includes('${')) return arg;
  return arg.replace(/\$\{([^}]+)\}/g, (raw, key) => (key in values ? String(values[key]) : raw));
}

// 处理 arguments 里的 {rules, value} 结构
function flatten(rawArgs, features) {
  const out = [];
  for (const arg of rawArgs || []) {
    if (typeof arg === 'string') { out.push(arg); continue; }
    if (!arg || typeof arg !== 'object') continue;
    if (arg.rules && !versions.ruleAllows(arg.rules, { ...versions.PLATFORM, features })) continue;
    const value = arg.value;
    if (Array.isArray(value)) out.push(...flatten(value, features));
    else if (typeof value === 'string') out.push(value);
  }
  return out;
}

function ensureGameDirs(gameDir) {
  for (const name of ['mods', 'saves', 'resourcepacks', 'shaderpacks', 'config', 'logs', 'natives']) {
    fs.mkdirSync(path.join(gameDir, name), { recursive: true });
  }
}

/**
 * @param {{versionId:string, javaPath:string, account:object, memoryMB:number, settings:object}} options
 */
function buildCommand(options) {
  const { versionId, javaPath, account, memoryMB, settings } = options;
  const versionJson = versions.read(versionId);
  if (!versionJson) throw new Error('版本配置不存在: ' + versionId);
  const gameDir = dirs.game;
  ensureGameDirs(gameDir);

  // Forge / NeoForge 会把打过补丁的完整客户端 jar 作为 :client 库给出，此时不能再把原版 jar 塞进 classpath
  // （同一个 Minecraft.class 出现两次会让 ModuleFinder 冲突）；Fabric / Quilt 则依赖原版 jar。
  const ownJar = versions.paths(versionId).jar;
  const patchedClient = (versionJson.libraries || []).some(lib => /:client$/.test(String(lib.name || '')));
  const clientJar = fs.existsSync(ownJar) ? ownJar : (patchedClient ? '' : versions.clientJar(versionId));
  if (clientJar && !fs.existsSync(clientJar)) throw new Error('客户端 jar 缺失，请在版本管理中重新安装该版本');

  const { entries } = versions.classpath(versionJson);
  if (clientJar && !entries.includes(clientJar)) entries.push(clientJar);

  const nativesDir = path.join(dirs.natives, versionId);
  fs.mkdirSync(nativesDir, { recursive: true });

  const values = {
    auth_player_name: account.name,
    auth_uuid: String(account.uuid || '').replace(/-/g, ''),
    auth_access_token: account.accessToken || '0',
    auth_xuid: account.xuid || '0',
    clientid: account.clientId || '00000000000000000000000000000000',
    user_type: account.type === 'microsoft' ? 'msa' : account.type === 'thirdparty' ? 'mojang' : 'legacy',
    version_name: versionId,
    version_type: versionJson.type || 'release',
    game_directory: gameDir,
    assets_root: dirs.assets,
    assets_index_name: versionJson.assetIndex?.id || 'legacy',
    classpath: entries.join(path.delimiter),
    natives_directory: nativesDir,
    launcher_name: 'FedbyLauncher',
    launcher_version: '2.0.0',
    resolution_width: String(settings.resolution?.width || 1280),
    resolution_height: String(settings.resolution?.height || 720),
    quickPlayPath: '',
    quickPlaySingleplayer: '',
    quickPlayMultiplayer: '',
    quickPlayRealms: '',
  };

  const features = {};
  let jvmArgs = flatten(versionJson.arguments?.jvm, features).map(arg => fillTemplate(arg, values));
  let gameArgs = flatten(versionJson.arguments?.game, features).map(arg => fillTemplate(arg, values));

  // 极老版本用 minecraftArguments 单字符串
  if (!versionJson.arguments && versionJson.minecraftArguments) {
    gameArgs = versionJson.minecraftArguments.split(/\s+/).filter(Boolean).map(arg => fillTemplate(arg, values));
  }

  jvmArgs = [`-Xmx${memoryMB}M`, `-Xms${Math.min(512, memoryMB)}M`, ...jvmArgs];

  // 皮肤站：注入 authlib-injector 让游戏内也生效
  if (account.type === 'thirdparty' && account.skinSite && settings.injectorJar && fs.existsSync(settings.injectorJar)) {
    const apiRoot = Buffer.from(account.skinSite, 'utf-8')
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    jvmArgs.push(`-javaagent:${settings.injectorJar}=${apiRoot}`);
    emit('system', `已注入皮肤站认证：${account.skinSite}`);
  }
  if (settings.jvmArgExtra?.trim()) jvmArgs.splice(2, 0, ...settings.jvmArgExtra.trim().split(/\s+/));
  if (settings.fullscreen) gameArgs.push('--fullscreen');
  if (settings.launchArgExtra?.trim()) gameArgs.push(...settings.launchArgExtra.trim().split(/\s+/));

  return {
    javaPath,
    args: [...jvmArgs, versionJson.mainClass || 'net.minecraft.client.main.Main', ...gameArgs],
    cwd: gameDir,
    versionId,
    gameDir,
    memoryMB,
  };
}

function launch(options) {
  if (isRunning()) throw new Error('已有游戏正在运行');
  const command = buildCommand(options);
  emit('system', `版本 ${command.versionId} · Java ${command.javaPath}`);
  emit('system', `游戏目录 ${command.gameDir}`);
  emit('system', `分配内存 ${command.memoryMB} MB · 账户 ${options.account.name}`);

  const proc = spawn(command.javaPath, command.args, { cwd: command.cwd, windowsHide: false });
  child = proc;

  let buffer = '';
  const feed = (stream, chunk) => {
    buffer += chunk.toString('utf-8');
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) if (line.trim()) emit(stream, line);
  };
  proc.stdout.on('data', chunk => feed('stdout', chunk));
  proc.stderr.on('data', chunk => feed('stderr', chunk));
  proc.on('error', err => emit('error', '进程启动失败: ' + err.message));
  proc.on('close', code => {
    if (buffer.trim()) emit('stdout', buffer);
    emit('system', `游戏已退出（退出码 ${code}）`);
    if (child === proc) child = null;
  });

  return { pid: proc.pid, versionId: command.versionId };
}

function stop() {
  if (!child) return false;
  child.kill();
  child = null;
  return true;
}

function isRunning() { return !!(child && child.exitCode === null); }
function status() { return { running: isRunning(), pid: child?.pid || null }; }

module.exports = { buildCommand, launch, stop, status, isRunning, onLog, emit };
