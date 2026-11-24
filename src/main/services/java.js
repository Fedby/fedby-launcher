'use strict';
// Java 服务：扫描已安装的 JDK / JRE，解析主版本，按版本需求推荐运行时与内存。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const SEARCH_ROOTS = [
  process.env.JAVA_HOME,
  'C:\\Program Files\\Java',
  'C:\\Program Files\\Eclipse Adoptium',
  'C:\\Program Files\\Microsoft',
  'C:\\Program Files\\Amazon Corretto',
  'C:\\Program Files\\Zulu',
  'C:\\Program Files\\BellSoft',
  'C:\\Program Files (x86)\\Java',
  path.join(process.env.LOCALAPPDATA || '', 'Programs'),
  path.join(process.env.APPDATA || '', '.minecraft', 'runtime'),
];

function parseMajorVersion(text) {
  const match = /version\s+"?(\d+)(?:\.(\d+))?/i.exec(String(text || ''));
  if (!match) return null;
  const first = parseInt(match[1], 10);
  return first === 1 ? parseInt(match[2], 10) || 8 : first;
}

function detectVendor(text) {
  const raw = String(text || '');
  if (/Microsoft/i.test(raw)) return 'Microsoft';
  if (/OpenLogic/i.test(raw)) return 'OpenLogic';
  if (/Temurin|Eclipse/i.test(raw)) return 'Eclipse Temurin';
  if (/Corretto/i.test(raw)) return 'Amazon Corretto';
  if (/Zulu/i.test(raw)) return 'Zulu';
  if (/Oracle/i.test(raw)) return 'Oracle';
  if (/BellSoft|Liberica/i.test(raw)) return 'BellSoft';
  return 'OpenJDK';
}

async function probe(exePath) {
  if (!exePath || !fs.existsSync(exePath)) return null;
  try {
    const { stdout, stderr } = await execFileAsync(exePath, ['-version'], { timeout: 8000, windowsHide: true });
    const text = `${stderr}\n${stdout}`;
    const major = parseMajorVersion(text);
    if (!major) return null;
    return {
      path: exePath,
      major,
      vendor: detectVendor(text),
      display: `Java ${major} (${detectVendor(text)})`,
      detail: (text.split(/\r?\n/).find(line => line.trim()) || '').trim().slice(0, 160),
    };
  } catch (_) {
    return null;
  }
}

function collectJavaExes(root, depth = 0, out = [], seen = new Set()) {
  if (!root || depth > 4 || out.length > 80) return out;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return out; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(root, entry.name);
    if (seen.has(full)) continue;
    seen.add(full);
    if (fs.existsSync(path.join(full, 'bin', 'javaw.exe'))) { out.push(path.join(full, 'bin', 'javaw.exe')); }
    else if (fs.existsSync(path.join(full, 'bin', 'java.exe'))) { out.push(path.join(full, 'bin', 'java.exe')); }
    collectJavaExes(full, depth + 1, out, seen);
  }
  return out;
}

async function scan() {
  const candidates = new Set();
  try {
    const { stdout } = await execFileAsync('where', ['java'], { timeout: 6000, windowsHide: true });
    for (const line of stdout.split(/\r?\n/)) if (line.trim()) candidates.add(line.trim());
  } catch (_) { /* PATH 里没有 java 就跳过 */ }
  for (const root of SEARCH_ROOTS) {
    for (const exe of collectJavaExes(root)) candidates.add(exe);
  }
  const probed = await Promise.all([...candidates].map(probe));
  const seen = new Set();
  return probed
    .filter(Boolean)
    .filter(java => { const key = `${java.major}|${java.path}`; if (seen.has(key)) return false; seen.add(key); return true; })
    .sort((a, b) => b.major - a.major);
}

let scanCache = [];

// 带缓存的扫描：启动时扫一次，设置页点「重新扫描」时传 force
async function scanCached(force = false) {
  if (!force && scanCache.length) return scanCache;
  scanCache = await scan();
  return scanCache;
}

function cached() { return scanCache; }

function recommendedMemoryMB() {
  const totalMB = os.totalmem() / 1048576;
  return Math.min(8192, Math.max(2048, Math.round((totalMB * 0.25) / 512) * 512));
}

/**
 * 按版本要求挑 Java：满足要求里主版本最低的那个（避免高版本不兼容），都不满足则用最高的。
 */
function pickJava(list, required) {
  const enough = list.filter(java => java.major >= required).sort((a, b) => a.major - b.major);
  if (enough.length) return enough[0];
  return [...list].sort((a, b) => b.major - a.major)[0] || null;
}

module.exports = {
  scan, scanCached, cached, probe, parseMajorVersion,
  recommendedMemoryMB, pickJava,
  totalMemMB: () => Math.round(os.totalmem() / 1048576),
};
