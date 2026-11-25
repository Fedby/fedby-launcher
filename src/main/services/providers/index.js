'use strict';
// 下载源注册表：对外只暴露统一的 search / versions / install 接口。
const modrinth = require('./modrinth');
const curseforge = require('./curseforge');
const installer = require('./installer');
const taxonomy = require('./taxonomy');

const PROVIDERS = { modrinth, curseforge };

function get(source) {
  const provider = PROVIDERS[source];
  if (!provider) throw new Error('未知下载源: ' + source);
  return provider;
}

const search = (source, options) => get(source).search(options);
const versions = (source, projectId, gameVersion, loader) => get(source).versions(projectId, gameVersion, loader);
/** 推荐：优先用人工精选（仅 Modrinth 模组无筛选时），否则按当前筛选拉热门 */
async function recommend(source, options = {}) {
  const { type = 'mod', gameVersion = '', loader = 'all', category = '', offset = 0 } = options;
  const provider = get(source);
  if (source === 'modrinth' && type === 'mod' && !gameVersion && !category && !offset) {
    try {
      const list = await modrinth.curated();
      if (list.length) return list;
    } catch (_) { /* 精选接口挂了就退回热门搜索 */ }
  }
  const result = await provider.search({ query: '', type, gameVersion, loader, category, sort: 'downloads', limit: 12, offset });
  return result.hits;
}

const categories = (source, type) => taxonomy.list(source, type);
const installed = targetType => installer.installedIndex(targetType);

function install(source, options) {
  return installer.install({ ...options, provider: get(source) });
}

module.exports = { PROVIDERS, get, search, versions, install, recommend, categories, installed };
