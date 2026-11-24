'use strict';
// 中文数据服务：名称按「人工词库 → MC百科 → 麦块社区 → 原名」取值，
// 简介按「MC百科中文简介 → MCIM 社区翻译 → 麦块 → 原文」取值。不用通用机翻。
const fs = require('fs');
const net = require('./net');
const { dirs } = require('./paths');
const { lookupModName } = require('./mod-names');

const MCIM_API = 'https://mod.mcimirror.top';
const MINEKUAI_API = 'https://api.minekuai.cn/panel/public';
const MCMOD_SEARCH = 'https://search.mcmod.cn/s?key=';
const MCMOD_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MAX_TRANSLATE = 16;

let cache = null;
let saveTimer = null;

function loadCache() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(dirs.translationCache, 'utf-8'));
    cache = raw && typeof raw === 'object' ? raw : {};
  } catch (_) { cache = {}; }
  return cache;
}

function saveCache() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(require('path').dirname(dirs.translationCache), { recursive: true });
      fs.writeFileSync(dirs.translationCache, JSON.stringify(cache), 'utf-8');
    } catch (_) {}
  }, 400);
}

const CN = /[\u4e00-\u9fff]/;
const isChinese = text => CN.test(String(text || ''));

function clean(text) {
  return String(text || '')
    .replace(/\[(?:h[1-6]=|mark:|img:|url:|color=|list|\*)[^\]]*\]/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
}

function trimToSentence(text, max) {
  const chars = [...String(text || '')];
  if (chars.length <= max) return chars.join('');
  const cut = chars.slice(0, max).join('');
  const index = cut.lastIndexOf('。');
  return index > 40 ? cut.slice(0, index + 1) : cut + '…';
}

// 百科词条开头常是版本公告，不适合当简介
function looksLikeNotice(text) {
  const head = [...String(text || '')].slice(0, 40).join('');
  return /更新[！!]|停止.*支持|公告|通知|后会|即将/.test(head);
}

// 社区译名里明显是意译句子的（如「应有尽有皮肤」），宁可不显示
const BAD_ZH = /应有尽有|一个|可以|支持|用于|这个|你的|我的|能够|通过|让你|帮助/;
function acceptableTitle(text) {
  const value = clean(text);
  if (!isChinese(value)) return '';
  if ([...value].length > 14) return '';
  if (BAD_ZH.test(value)) return '';
  return value;
}

// ---------- MCIM 批量简介 ----------
async function mcimDescriptions(source, ids) {
  const found = new Map();
  let list = [...new Set(ids.map(String).filter(Boolean))].slice(0, 100);
  const isCf = source === 'curseforge';
  if (isCf) list = list.map(Number).filter(Number.isFinite);
  if (!list.length) return found;

  try {
    const url = isCf ? `${MCIM_API}/translate/curseforge` : `${MCIM_API}/translate/modrinth`;
    const body = isCf ? { modids: list } : { project_ids: list };
    const data = await net.postJson(url, body, { timeout: 15000 });
    for (const item of Array.isArray(data) ? data : []) {
      const id = String(item.project_id ?? item.modid ?? item.mod_id ?? '');
      const text = clean(item.translated);
      if (id && isChinese(text)) found.set(id, text);
    }
  } catch (_) { /* 网络失败就回退到其他源 */ }
  return found;
}

// ---------- 麦块：社区中文名 ----------
function minekuaiGroup(source, type) {
  if (source === 'curseforge') return type === 'modpack' ? 'mc-cf-modpacks' : 'mc-cf-mods';
  return {
    mod: 'mc-mods', plugin: 'mc-plugins', shader: 'mc-shaders', modpack: 'mc-modpacks',
    resourcepack: 'mc-resourcepacks', datapack: 'mc-mods', world: 'mc-mods',
  }[type] || 'mc-mods';
}

async function minekuaiLookup(source, type, id, title) {
  const group = minekuaiGroup(source, type);
  const key = `mk:${group}:${id}`;
  const store = loadCache();
  if (store[key]) return store[key];

  const params = new URLSearchParams({ q: String(title || '').slice(0, 80), limit: '20', status: 'translated' });
  try {
    const data = await net.requestJson(`${MINEKUAI_API}/${group}?${params.toString()}`, { headers: { Accept: 'application/json' } });
    const items = Array.isArray(data?.items) ? data.items : [];
    // 麦块的 id 过滤对多数资源组无效，按名称搜索后精确匹配项目 ID，匹配不到就保留原文
    const item = items.find(entry => String(entry.project_id ?? entry.cf_id ?? '') === String(id))
      || items.find(entry => normalize(entry.title) === normalize(title))
      || null;
    const zh = item ? acceptableTitle(item.title_zh) : '';
    const result = {
      titleZh: zh && zh !== clean(title) ? zh : '',
      descriptionZh: item && isChinese(item.description_zh) ? clean(item.description_zh) : '',
    };
    store[key] = result;
    saveCache();
    return result;
  } catch (_) {
    return { titleZh: '', descriptionZh: '' };
  }
}

// ---------- MC百科：权威中文名与简介 ----------
let mcmodLastAt = 0;

function parseMcmodResults(html) {
  const out = [];
  const blockRe = /<div class="result-item">([\s\S]*?)<div class="foot">/g;
  let match;
  while ((match = blockRe.exec(html))) {
    const block = match[1];
    const link = /<a[^>]+href="https?:\/\/www\.mcmod\.cn\/class\/(\d+)\.html"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!link) continue;
    const bodyMatch = /<div class="body">([\s\S]*?)<\/div>/.exec(block);
    out.push({
      id: link[1],
      title: clean(link[2].replace(/<[^>]*>/g, ' ')),
      body: bodyMatch ? clean(bodyMatch[1].replace(/<[^>]*>/g, ' ')) : '',
    });
  }
  return out;
}

function chinesePart(title) {
  const value = String(title || '')
    .replace(/[（(][^）)]*[）)]/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[\s:：\-–—]+[A-Za-z][A-Za-z0-9'’&+\-.:!?/\\ ]*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!isChinese(value) || [...value].length > 20) return '';
  return value;
}

function bracketEnglish(title) {
  const match = /[（(]([^）)]*)[）)]/.exec(String(title || ''));
  return match ? normalize(match[1]) : '';
}

async function mcmodLookup(title) {
  const key = `mcm:${normalize(title)}`;
  const store = loadCache();
  if (store[key]) return store[key];

  // 百科对并发敏感，限到约 4 次/秒，避免被限流返回空结果
  const wait = 250 - (Date.now() - mcmodLastAt);
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  mcmodLastAt = Date.now();

  try {
    const html = await net.requestText(MCMOD_SEARCH + encodeURIComponent(String(title || '').slice(0, 80)), {
      headers: { 'User-Agent': MCMOD_UA, 'Accept-Language': 'zh-CN,zh;q=0.9', Accept: 'text/html' },
      timeout: 8000,
    });
    const items = parseMcmodResults(html);
    const needle = normalize(title);
    let titleZh = '';
    let bodyZh = '';
    for (let i = 0; i < Math.min(items.length, 3); i += 1) {
      const zh = chinesePart(items[i].title);
      if (!zh) continue;
      const english = bracketEnglish(items[i].title);
      const matched = english
        ? english === needle || english.includes(needle) || needle.includes(english)
        : i === 0;
      if (!matched) continue;
      titleZh = zh;
      const body = String(items[i].body || '').replace(/支持版本\s*[A-Za-z].*$/g, '').trim();
      bodyZh = isChinese(body) && !looksLikeNotice(body) ? trimToSentence(body, 140) : '';
      break;
    }
    const result = { titleZh, bodyZh, hit: items.length > 0 };
    store[key] = result;
    saveCache();
    return result;
  } catch (_) {
    // 网络失败不写缓存，交给麦块兜底
    return { titleZh: '', bodyZh: '', hit: false };
  }
}

/**
 * 为一批搜索结果补充 titleZh / descriptionZh。
 * @param {Array<object>} hits
 * @param {'modrinth'|'curseforge'} source
 * @param {string} type 资源类型（决定麦块资源组）
 */
async function translateHits(hits, source = 'modrinth', type = 'mod') {
  if (!Array.isArray(hits) || !hits.length) return hits;
  const targets = hits.slice(0, MAX_TRANSLATE);
  const mcim = await mcimDescriptions(source, targets.map(hit => hit.id).filter(Boolean));

  let cursor = 0;
  const worker = async () => {
    while (cursor < targets.length) {
      const hit = targets[cursor++];
      const id = String(hit.id || '');
      const community = mcim.get(id) || '';
      const [minekuai, mcmod] = await Promise.all([
        minekuaiLookup(source, type, id, hit.title),
        mcmodLookup(hit.title),
      ]);

      let titleZh;
      const curated = lookupModName(hit.slug, hit.title);
      if (curated !== undefined) titleZh = curated;
      else if (mcmod.titleZh) titleZh = mcmod.titleZh;
      else if (mcmod.hit) titleZh = ''; // 百科收录但没有中文名 → 保留英文
      else titleZh = minekuai.titleZh || '';

      hit.titleZh = titleZh;
      hit.descriptionZh = mcmod.bodyZh || community || minekuai.descriptionZh || '';
      hit.translationSource = mcmod.bodyZh ? 'MC百科' : community ? 'MCIM' : minekuai.descriptionZh ? '麦块社区' : '';
    }
  };
  // 百科已限速，3 路并发足够，太多会触发限流
  await Promise.all(Array.from({ length: Math.min(3, targets.length) }, worker));
  return hits;
}

module.exports = { translateHits, isChinese, clean };
