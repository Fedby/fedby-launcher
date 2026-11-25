'use strict';
// 资源分类（类型筛选）：
// Modrinth 用 /tag/category 的 name 当 facet；CurseForge 用 categoryId。
// 两边名字不同，统一在这里翻成中文标签，界面只认 { key, label }。
const net = require('../net');
const curseforge = require('./curseforge');

const MR_TAGS = 'https://api.modrinth.com/v2/tag/category';
const TTL = 6 * 60 * 60 * 1000;

// 中文标签：按「小写去符号」匹配，两个源共用一张表
const ZH = {
  // ---- 通用 / 模组 ----
  adventure: '冒险', cursed: '搞怪', decoration: '装饰', economy: '经济',
  equipment: '装备', food: '食物', gamemechanics: '游戏机制', library: '前置库',
  magic: '魔法', management: '管理', minigame: '小游戏', mobs: '生物',
  optimization: '优化', social: '社交', storage: '存储', technology: '科技',
  transportation: '交通', utility: '实用工具', worldgen: '世界生成',
  // CurseForge 模组分类
  worldgeneration: '世界生成', biomes: '生物群系', oresandresources: '矿物与资源',
  structures: '建筑结构', dimensions: '维度', processing: '加工处理',
  playertransport: '玩家交通', energyfluidanditemtransport: '能源 / 流体运输',
  farming: '农业', energy: '能源', genetics: '基因', adventureandrpg: '冒险 / RPG',
  mapandinformation: '地图与信息', cosmetic: '外观装饰', armortoolsandweapons: '盔甲武器',
  serverutility: '服务端工具', redstone: '红石', automation: '自动化',
  utilityqol: '实用 / 体验优化', education: '教育', skyblock: '空岛',
  performance: '性能优化',
  // ---- 整合包 ----
  challenging: '高难度', combat: '战斗', kitchensink: '大杂烩', lightweight: '轻量',
  multiplayer: '多人', quests: '任务', tech: '科技', scifi: '科幻',
  exploration: '探索', hardcore: '硬核', mapbased: '基于地图', smalllight: '小型轻量',
  extralarge: '超大整合', combatpvp: '战斗 / PvP', ftbofficialpack: 'FTB 官方包',
  vanilla: '原版增强', horror: '恐怖', expert: '专家', rlcraft: 'RLCraft',
  // ---- 资源包 ----
  audio: '音效', blocks: '方块', coreshaders: '核心着色器', entities: '实体',
  environment: '环境', fonts: '字体', gui: '界面', items: '物品', locale: '语言',
  modded: '模组支持', models: '模型', realistic: '写实', simplistic: '简约',
  themed: '主题', tweaks: '微调', vanillalike: '原版风',
  photorealistic: '照片级写实', modern: '现代',
  medieval: '中世纪', traditional: '传统', animated: '动态', modsupport: '模组兼容',
  datapacks: '数据包', fontpacks: '字体包', miscellaneous: '其他',
  // ---- 光影 ----
  atmosphere: '大气', bloom: '泛光', cartoon: '卡通', coloredlighting: '彩色光照',
  fantasy: '奇幻', foliage: '植被', high: '高配', low: '低配', medium: '中配',
  pathtracing: '光追', pbr: 'PBR', potato: '低配（土豆）', reflections: '反射',
  semirealistic: '半写实', shadows: '阴影', screenshot: '截图用', creation: '创造',
  gamemap: '地图闯关', parkour: '跑酷', puzzle: '解谜', survival: '生存',
  moddedworld: '模组世界', worlds: '世界', scenarios: '剧本', resourcepacks: '资源包',
  // ---- 插件 ----
  admintools: '管理工具', antigriefingtools: '防破坏', chatrelated: '聊天',
  developertools: '开发者工具', worldeditingandmanagement: '世界编辑', fixes: '修复',
  fun: '娱乐', general: '综合', informational: '信息显示', mechanics: '机制',
  websiteadministration: '网站管理', worldgenerators: '世界生成器',
  roleplaying: '角色扮演', teleportation: '传送',
};

// CurseForge 里那些「某个模组专属」的分类，别混进类型筛选
const EXCLUDE = new Set([
  'addons', 'thermalexpansion', 'tinkersconstruct', 'industrialcraft', 'thaumcraft',
  'buildcraft', 'forestry', 'bloodmagic', 'appliedenergistics2', 'mcreator',
  'galacticraft', 'kubejs', 'twitchintegration', 'modjam2025',
]);

// Modrinth 没有给数据包 / 插件单独打分类，用模组标签的常见子集兜底
const STATIC = {
  datapack: ['adventure', 'technology', 'magic', 'utility', 'library', 'worldgen', 'mobs', 'food', 'equipment', 'gamemechanics', 'cursed'],
  plugin: ['management', 'economy', 'utility', 'minigame', 'social', 'adventure', 'worldgen', 'gamemechanics', 'storage', 'technology', 'optimization', 'decoration', 'fixes', 'cursed'],
};

const memory = new Map();

function keyOf(label) {
  return String(label || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function zh(label) {
  return ZH[keyOf(label)] || String(label || '');
}

async function cached(key, worker) {
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = await worker();
  memory.set(key, { at: Date.now(), value });
  return value;
}

async function modrinthCategories(type) {
  if (type === 'world') return [];
  if (STATIC[type]) return STATIC[type].map(slug => ({ key: slug, label: zh(slug) }));
  try {
    const all = await cached('mr:tag:category', () => net.requestJson(MR_TAGS, { timeout: 15000 }));
    return (Array.isArray(all) ? all : [])
      .filter(item => item.project_type === type && !EXCLUDE.has(keyOf(item.name)))
      .map(item => ({ key: item.name, label: zh(item.name), group: item.header || '' }));
  } catch (_) {
    return [];
  }
}

async function curseforgeCategories(type) {
  const classId = curseforge.CLASS_IDS[type] || curseforge.CLASS_IDS.mod;
  try {
    const data = await cached(`cf:cat:${classId}`, () => net.requestJson(
      `${curseforge.API}/categories?gameId=${curseforge.GAME_ID}&classId=${classId}`,
      { headers: curseforge.headers(), timeout: 15000 },
    ));
    return (data.data || [])
      .filter(item => item.classId === classId && !EXCLUDE.has(keyOf(item.name)))
      .map(item => ({ key: String(item.id), label: zh(item.name), en: item.name }));
  } catch (_) {
    return [];
  }
}

function list(source, type) {
  if (!type || type === 'game') return Promise.resolve([]);
  return source === 'curseforge' ? curseforgeCategories(type) : modrinthCategories(type);
}

module.exports = { list, zh, keyOf };
