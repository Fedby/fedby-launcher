'use strict';
// Modrinth 下载源（公开 API，无需密钥）
const net = require('../net');
const settings = require('../settings');
const i18n = require('../i18n');

const API = 'https://api.modrinth.com/v2';
const SITE = 'https://modrinth.com';

// 类型 → facet 分组：外层 AND，内层 OR。
// 数据包 / 插件在 Modrinth 里本质是带特定 loader 标签的 mod，得额外收一道。
const TYPE_FACETS = {
  mod: [['project_type:mod']],
  modpack: [['project_type:modpack']],
  resourcepack: [['project_type:resourcepack']],
  shader: [['project_type:shader']],
  datapack: [['project_type:mod'], ['categories:datapack']],
  plugin: [['project_type:mod'], [
    'categories:paper', 'categories:bukkit', 'categories:spigot', 'categories:purpur',
    'categories:folia', 'categories:velocity', 'categories:waterfall', 'categories:bungeecord', 'categories:sponge',
  ]],
};

const RECOMMEND_SLUGS = [
  'sodium', 'iris', 'lithium', 'fabric-api', 'jei', 'jade',
  'appleskin', 'shulboxtooltip', 'sodium-extra', 'no-chat-reports',
  'ferritecore', 'indium', 'entityculling', 'modernfix',
];

function normalizeVersion(raw) {
  return {
    id: raw.id,
    name: raw.name || raw.version_number,
    versionNumber: raw.version_number,
    type: raw.version_type || 'release',
    datePublished: raw.date_published || '',
    gameVersions: raw.game_versions || [],
    loaders: raw.loaders || [],
    changelog: String(raw.changelog || '').slice(0, 400),
    files: (raw.files || []).map(file => ({
      name: file.filename,
      size: file.size || 0,
      url: file.url,
      sha1: file.sha1 || null,
      primary: !!file.primary,
    })),
    dependencies: (raw.dependencies || [])
      .filter(dep => dep.dependency_type === 'required')
      .map(dep => ({ projectId: dep.project_id, versionId: dep.version_id || null })),
  };
}

async function search(options = {}) {
  const { query = '', type = 'mod', gameVersion = '', loader = '', category = '', sort = 'downloads', limit = 24, offset = 0 } = options;
  const facets = (TYPE_FACETS[type] || [[`project_type:${type}`]]).map(group => group.slice());
  if (gameVersion) facets.push([`versions:${gameVersion}`]);
  if (loader && loader !== 'all') facets.push([`categories:${loader}`]);
  if (category) facets.push([`categories:${category}`]);

  const params = new URLSearchParams({
    limit: String(Math.min(Math.max(limit, 1), 60)),
    offset: String(Math.max(offset, 0)),
    index: ['relevance', 'downloads', 'follows', 'newest', 'updated'].includes(sort) ? sort : 'relevance',
    facets: JSON.stringify(facets),
  });
  if (query) params.set('query', query);

  const data = await net.requestJson(`${API}/search?${params.toString()}`);
  const hits = (data.hits || []).map(hit => ({
    id: hit.project_id,
    slug: hit.slug,
    title: hit.title,
    description: hit.description || '',
    author: hit.author || '',
    icon: hit.icon_url || '',
    type: hit.project_type,
    downloads: hit.downloads || 0,
    follows: hit.follows || 0,
    categories: hit.categories || [],
    url: `${SITE}/${hit.project_type}/${hit.slug}`,
  }));
  if (settings.get().translateDescriptions !== false) {
    try { await i18n.translateHits(hits, 'modrinth', type); } catch (_) {}
  }
  return { total: data.total_hits || 0, hits };
}

async function versions(projectId, gameVersion = '', loader = '') {
  const raw = await net.requestJson(`${API}/project/${encodeURIComponent(projectId)}/version`);
  let list = (Array.isArray(raw) ? raw : []).map(normalizeVersion);
  if (gameVersion) list = list.filter(version => version.gameVersions.includes(gameVersion));
  if (loader && loader !== 'all') list = list.filter(version => version.loaders.includes(loader));
  return list;
}

async function versionById(versionId) {
  const raw = await net.requestJson(`${API}/version/${encodeURIComponent(versionId)}`);
  return normalizeVersion(raw);
}

/** 人工挑选的一批常用模组，作为默认「推荐」 */
async function curated() {
  const ids = encodeURIComponent(JSON.stringify(RECOMMEND_SLUGS));
  const list = await net.requestJson(`${API}/projects?ids=${ids}`);
  const hits = (Array.isArray(list) ? list : []).map(project => ({
    id: project.id,
    slug: project.slug,
    title: project.title,
    description: project.description || '',
    author: '',
    icon: project.icon_url || '',
    type: project.project_type,
    downloads: project.downloads || 0,
    follows: project.followers || 0,
    categories: (project.categories || []).slice(0, 3),
    url: `${SITE}/${project.project_type}/${project.slug}`,
    featured: true,
  })).sort((a, b) => RECOMMEND_SLUGS.indexOf(a.slug) - RECOMMEND_SLUGS.indexOf(b.slug));
  if (settings.get().translateDescriptions !== false) {
    try { await i18n.translateHits(hits, 'modrinth', 'mod'); } catch (_) {}
  }
  return hits;
}

module.exports = { name: 'modrinth', label: 'Modrinth', search, versions, versionById, curated };
