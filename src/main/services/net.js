'use strict';
// 网络层：统一超时、重定向、JSON 解析、带校验的下载与并发池。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

const UA = 'FedbyLauncher/2.0 (Electron)';
const MAX_REDIRECTS = 5;

function pickModule(url) { return String(url).startsWith('https:') ? https : http; }

/**
 * 请求并返回原始文本。
 * @param {string} url
 * @param {{method?:string, headers?:object, body?:string|Buffer|null, timeout?:number}} [options]
 */
function requestText(url, options = {}) {
  const { method = 'GET', headers = {}, body = null, timeout = 20000, redirects = 0 } = options;
  return new Promise((resolve, reject) => {
    const headersOut = { 'User-Agent': UA, ...headers };
    if (body != null) headersOut['Content-Length'] = Buffer.byteLength(body);
    const req = pickModule(url).request(url, { method, headers: headersOut }, res => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirects >= MAX_REDIRECTS) return reject(new Error('重定向次数过多: ' + url));
        const next = new URL(res.headers.location, url).toString();
        return requestText(next, { ...options, redirects: redirects + 1 }).then(resolve, reject);
      }
      let text = '';
      res.setEncoding('utf-8');
      res.on('data', chunk => { text += chunk; if (text.length > 12e6) req.destroy(new Error('响应体过大')); });
      res.on('end', () => {
        if (status < 200 || status >= 300) {
          const err = new Error(describeStatus(status, url));
          err.status = status;
          err.body = text.slice(0, 500);
          return reject(err);
        }
        resolve(text);
      });
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => req.destroy(new Error('请求超时: ' + url)));
    if (body != null) req.write(body);
    req.end();
  });
}

function describeStatus(status, url) {
  if (status === 401) return `未授权访问 (HTTP 401)`;
  if (status === 403) return `访问被拒绝 (HTTP 403)`;
  if (status === 404) return `资源不存在 (HTTP 404)`;
  if (status >= 500) return `服务端错误 (HTTP ${status})`;
  return `请求失败 (HTTP ${status}) ${url}`;
}

async function requestJson(url, options = {}) {
  const text = await requestText(url, options);
  try { return JSON.parse(text); } catch (_) { throw new Error('响应不是合法 JSON: ' + url); }
}

function postJson(url, payload, options = {}) {
  return requestJson(url, {
    ...options,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(options.headers || {}) },
    body: JSON.stringify(payload),
  });
}

function sha1File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    const stream = fs.createReadStream(file);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function fileMatches(file, sha1) {
  if (!fs.existsSync(file)) return false;
  if (!sha1) return true;
  try { return (await sha1File(file)) === sha1; } catch (_) { return false; }
}

/**
 * 下载到文件：先写 .part，校验 SHA1 后原子改名。
 */
function download(url, dest, options = {}) {
  const { sha1 = null, headers = {}, onProgress = null, timeout = 60000, redirects = 0 } = options;
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.part`;
    const req = pickModule(url).get(url, { headers: { 'User-Agent': UA, ...headers } }, res => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirects >= MAX_REDIRECTS) return reject(new Error('重定向次数过多: ' + url));
        const next = new URL(res.headers.location, url).toString();
        return download(next, dest, { ...options, redirects: redirects + 1 }).then(resolve, reject);
      }
      if (status !== 200) {
        res.resume();
        return reject(new Error(describeStatus(status, url)));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      const out = fs.createWriteStream(tmp);
      res.on('data', chunk => {
        received += chunk.length;
        if (onProgress && total) onProgress(received, total);
      });
      res.pipe(out);
      out.on('error', err => { try { fs.unlinkSync(tmp); } catch (_) {} reject(err); });
      out.on('finish', async () => {
        out.close();
        try {
          if (sha1) {
            const actual = await sha1File(tmp);
            if (actual !== sha1) {
              fs.rmSync(tmp, { force: true });
              return reject(new Error(`文件校验失败（SHA1 不匹配）: ${path.basename(dest)}`));
            }
          }
          fs.rmSync(dest, { force: true });
          fs.renameSync(tmp, dest);
          resolve(dest);
        } catch (err) { reject(err); }
      });
    });
    req.on('error', err => { try { fs.rmSync(tmp, { force: true }); } catch (_) {} reject(err); });
    req.setTimeout(timeout, () => req.destroy(new Error('下载超时: ' + url)));
  });
}

/** 并发池：限制同时运行的任务数，保持输入顺序返回 */
async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

module.exports = { UA, requestText, requestJson, postJson, download, pool, sha1File, fileMatches };
