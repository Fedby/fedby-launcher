'use strict';
// 资源类型：统一类型名、本地目录与中文标签，两个下载源共用。
const { dirs } = require('../paths');

const TYPES = [
  { key: 'mod', label: '模组', dir: dirs.mods },
  { key: 'modpack', label: '整合包', dir: require('path').join(dirs.game, 'modpacks') },
  { key: 'resourcepack', label: '资源包', dir: dirs.resourcepacks },
  { key: 'shader', label: '光影', dir: dirs.shaderpacks },
  { key: 'world', label: '地图世界', dir: dirs.saves },
  { key: 'plugin', label: '插件', dir: require('path').join(dirs.game, 'plugins') },
  { key: 'datapack', label: '数据包', dir: require('path').join(dirs.game, 'datapacks') },
];

const BY_KEY = Object.fromEntries(TYPES.map(type => [type.key, type]));

function dirOf(key) { return (BY_KEY[key] || BY_KEY.mod).dir; }
function labelOf(key) { return (BY_KEY[key] || BY_KEY.mod).label; }

module.exports = { TYPES, dirOf, labelOf };
