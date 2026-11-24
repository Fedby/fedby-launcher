'use strict';
// CurseForge 下载源（公开社区密钥，可在设置中替换为自有密钥）
const net = require('../net');
const settings = require('../settings');
const i18n = require('../i18n');

const API = 'https://api.curseforge.com/v1';
const SITE = 'https://www.curseforge.com/minecraft';
const PUBLIC_KEY = '$2a$10$bL4bIL5pUWqfcO7KQtnMReakwtfHbNKh6v1uTpKlzhwoueEJQnPnm';
const GAME_ID = 432;
const PAGE_SIZE = 50;
const MAX_PAGES = 4; // 最多 200 个文件，「全版本」才覆盖得到旧文件

const CLASS_IDS = { mod: 6, modpack: 4471, resourcepack: 12, shader: 17, world: 4559, plugin: 5, datapack: 6945 };
const PATH_SLUGS = {
  mod: 'mc-mods', modpack: 'modpacks', resourcepack: 'texture-packs',
  shader: 'shaders', world: 'worlds', plugin: 'bukkit-plugins', datapack: 'mc-mods',
};
const LOADER_IDS = { fabric: 4, forge: 1, neoforge: 6, quilt: 5 };

function apiKey() { return settings.get().curseforgeKey || PUBLIC_KEY; }
function headers() { return { 'x-api-key': apiKey(), Accept: 'application/json' }; }

function cleanName(name) {
  return String(name || '').replace(/\s*\[(?:Fabric|Forge|NeoForge|Quilt|Fabric\/Forge)[^\]]*\]/gi, '').trim();
}

function isMcVersion(value) { return /^\d+\.\d+/.test(String(value || '')); }

function toVersion(file) {
  return {
    id: String(file.id),
    name: cleanName(file.displayName || file.fileName),
    versionNumber: file.displayName || file.fileName,
    type: file.releaseType === 1 ? 'release' : file.releaseType === 2 ? 'beta' : 'alpha',
    datePublished: file.fileDate || '',
    gameVersions: (file.gameVersions || []).filter(isMcVersion),
    loaders: (file.gameVersions || []).filter(value => /fabric|forge|quilt/i.test(value)),
    changelog: '',
    files: [{
      name: file.fileName,
      size: file.fileLength || 0,
      url: file.downloadUrl || '',
      sha1: (file.hashes || []).find(hash => hash.algo === 1)?.value || null,
      primary: true,
    }],
    dependencies: (file.dependencies || [])
      .filter(dep => dep.relationType === 3)
      .map(dep => ({ projectId: String(dep.modId), versionId: null })),
    downloadable: !!file.downloadUrl,
  };
}

async function search(options = {}) {
  const { query = '', type = 'mod', gameVersion = '', loader = '', sort = 'downloads', limit = 24, offset = 0 } = options;
  const sortField = { downloads: 6, relevance: 1, follows: 2, newest: 11, updated: 3 }[sort] || 6;
  const params = new URLSearchParams({
    gameId: String(GAME_ID),
    classId: String(CLASS_IDS[type] || CLASS_IDS.mod),
    pageSize: String(Math.min(Math.max(limit, 1), 50)),
    index: String(Math.min(Math.max(offset, 0), 9000)),
    sortField: String(sortField),
    sortOrder: 'desc',
  });
  if (query) params.set('searchFilter', query);
  if (gameVersion) params.set('gameVersion', gameVersion);
  const loaderId = LOADER_IDS[String(loader).toLowerCase()];
  if (loaderId) params.set('modLoaderType', String(loaderId));

  const data = await net.requestJson(`${API}/mods/search?${params.toString()}`, { headers: headers() });
  if (data.error) throw new Error(data.error.message || 'CurseForge 请求失败');

  const hits = (data.data || []).map(mod => ({
    id: String(mod.id),
    slug: mod.slug || String(mod.id),
    title: cleanName(mod.name),
    description: String(mod.summary || ''),
    author: (mod.authors || []).map(author => author.name).join(', '),
    icon: mod.logo?.thumbnailUrl || mod.thumbnailUrl || '',
    type,
    downloads: mod.downloadCount || 0,
    follows: mod.thumbsUpCount || 0,
    categories: (mod.categories || []).slice(0, 6).map(category => category.name),
    url: `${SITE}/${PATH_SLUGS[type] || 'mc-mods'}/${mod.slug || mod.id}`,
  }));
  if (settings.get().translateDescriptions !== false) {
    try { await i18n.translateHits(hits, 'curseforge', type); } catch (_) {}
  }
  return { total: Math.min(data.pagination?.totalCount || 0, 10000), hits };
}

async function versions(projectId, gameVersion = '', loader = '') {
  const files = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      pageSize: String(PAGE_SIZE),
      index: String(page * PAGE_SIZE),
      sortField: '11',
      sortOrder: 'desc',
    });
    if (gameVersion) params.set('gameVersion', gameVersion);
    const data = await net.requestJson(
      `${API}/mods/${encodeURIComponent(projectId)}/files?${params.toString()}`,
      { headers: headers() },
    );
    if (data.error) throw new Error(data.error.message || '获取文件列表失败');
    const batch = data.data || [];
    files.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }

  let list = files.map(toVersion);
  if (loader && loader !== 'all') {
    const label = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt' }[loader];
    if (label) list = list.filter(version => version.loaders.some(value => value.toLowerCase() === label.toLowerCase()));
  }
  return list;
}

async function versionById(fileId, projectId) {
  const data = await net.requestJson(
    `${API}/mods/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`,
    { headers: headers() },
  );
  if (data.error) throw new Error(data.error.message || '获取文件信息失败');
  return toVersion(data.data);
}

module.exports = {
  name: 'curseforge',
  label: 'CurseForge',
  search,
  versions,
  versionById,
  downloadHeaders: headers,
  keyInfo: () => ({ configured: !!settings.get().curseforgeKey, using: apiKey() }),
  PUBLIC_KEY,
};
