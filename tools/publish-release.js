'use strict';
/**
 * 发布 GitHub Release 并上传 dist/ 下的安装包。
 *
 * 用法：GITHUB_TOKEN=xxx node tools/publish-release.js [--tag v1.0] [--notes 文件]
 * Token 也可以放在 %TEMP%/fedby-gh-token 里，避免出现在命令行。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const OWNER = 'Fedby';
const REPO = 'fedby-launcher';
const ROOT = path.join(__dirname, '..');
const API = 'https://api.github.com';
const UPLOADS = 'https://uploads.github.com';

function readToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  const file = path.join(os.tmpdir(), 'fedby-gh-token');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  throw new Error('缺少 Token：设置 GITHUB_TOKEN 环境变量，或写入 ' + file);
}

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const token = readToken();
const pkg = require(path.join(ROOT, 'package.json'));
const tag = flag('--tag', 'v' + pkg.version.replace(/\.0$/, ''));
const notesFile = flag('--notes', '');
const assets = fs.readdirSync(path.join(ROOT, 'dist'))
  .filter(name => /\.exe$/.test(name) && name.includes(pkg.version))
  .map(name => path.join(ROOT, 'dist', name));

async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'FedbyLauncher',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${res.status} ${data.message || text.slice(0, 200)}`);
  return data;
}

(async () => {
  if (!assets.length) throw new Error('dist/ 下没有找到 ' + pkg.version + ' 的安装包，请先 npm run dist');

  const body = notesFile ? fs.readFileSync(notesFile, 'utf8') : [
    `**Fedby 启动器 ${tag}**`,
    '',
    '首次使用三步：加账户 → 装一个版本 → 点启动。',
  ].join('\n');

  let release;
  try {
    release = await api(`${API}/repos/${OWNER}/${REPO}/releases/tags/${tag}`);
    console.log('复用已有 Release:', release.html_url);
  } catch (_) {
    release = await api(`${API}/repos/${OWNER}/${REPO}/releases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: tag,
        name: `Fedby 启动器 ${tag}`,
        body,
        draft: false,
        prerelease: false,
      }),
    });
    console.log('已创建 Release:', release.html_url);
  }

  const existing = new Set((release.assets || []).map(asset => asset.name));
  for (const file of assets) {
    const name = path.basename(file);
    if (existing.has(name)) { console.log('跳过（已存在）:', name); continue; }
    const buffer = fs.readFileSync(file);
    const size = (buffer.length / 1048576).toFixed(1);
    process.stdout.write(`上传 ${name} (${size} MB)... `);
    const asset = await api(`${UPLOADS}/repos/${OWNER}/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buffer,
    });
    console.log('完成', (asset.size / 1048576).toFixed(1) + 'MB', asset.browser_download_url);
  }

  console.log('\nRelease 页面:', release.html_url);
})().catch(error => { console.error('发布失败:', error.message); process.exit(1); });
