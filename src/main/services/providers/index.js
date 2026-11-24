'use strict';
// 下载源注册表：对外只暴露统一的 search / versions / install 接口。
const modrinth = require('./modrinth');
const curseforge = require('./curseforge');
const installer = require('./installer');

const PROVIDERS = { modrinth, curseforge };

function get(source) {
  const provider = PROVIDERS[source];
  if (!provider) throw new Error('未知下载源: ' + source);
  return provider;
}

const search = (source, options) => get(source).search(options);
const versions = (source, projectId, gameVersion, loader) => get(source).versions(projectId, gameVersion, loader);
const recommend = () => modrinth.recommend();
const installed = targetType => installer.installedIndex(targetType);

function install(source, options) {
  return installer.install({ ...options, provider: get(source) });
}

module.exports = { PROVIDERS, get, search, versions, install, recommend, installed };
