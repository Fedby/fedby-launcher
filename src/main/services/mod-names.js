'use strict';
// 常见模组 / 光影 / 整合包中文名（按中文社区通用叫法人工校对）
// 值为空字符串 = 明确保留英文原名，不要副标题（专有名词硬译反而更难认）
// 条目格式：[slug, 中文名, ...英文别名]
const ENTRIES = [
  // —— 优化 / 性能 ——
  ['sodium', '', 'Sodium'],
  ['lithium', '', 'Lithium'],
  ['iris', 'Iris 光影', 'Iris Shaders'],
  ['fabric-api', '', 'Fabric API'],
  ['sodium-extra', '', 'Sodium Extra'],
  ['ferritecore', '', 'FerriteCore'],
  ['indium', '', 'Indium'],
  ['nvidium', '', 'Nvidium'],
  ['krypton', '', 'Krypton'],
  ['starlight', '', 'Starlight'],
  ['optifine', '', 'OptiFine'],
  ['modernfix', '', 'ModernFix'],
  ['immediatelyfast', '', 'ImmediatelyFast'],
  ['memoryleakfix', '', 'Memory Leak Fix'],
  ['badoptimizations', '', 'BadOptimizations'],
  ['entityculling', '实体剔除', 'Entity Culling'],
  ['dynamic-fps', '', 'Dynamic FPS'],
  ['fps-reducer', '', 'FPS Reducer'],
  ['cull-less-leaves', '', 'Cull Less Leaves'],
  ['reeses-sodium-options', "Reese's Sodium Options"],

  // —— 前置 / API ——
  ['architectury-api', '', 'Architectury API'],
  ['cloth-config', '', 'Cloth Config API'],
  ['yacl', '', 'YetAnotherConfigLib'],
  ['geckolib', '', 'GeckoLib'],
  ['azurelib', '', 'AzureLib'],
  ['patchouli', '帕秋莉手册', 'Patchouli'],
  ['curios', '', 'Curios API'],
  ['trinkets', '', 'Trinkets'],
  ['balm', '', 'Balm'],
  ['collective', '', 'Collective'],
  ['puzzles-lib', '', 'Puzzles Lib'],
  ['iceberg', '', 'Iceberg'],
  ['prism-lib', 'Prism', 'Prism Library'],
  ['midnightlib', '', 'MidnightLib'],
  ['kotlin-for-forge', '', 'Kotlin for Forge'],

  // —— 物品 / 信息 / 界面 ——
  ['jei', 'JEI 物品管理器', 'Just Enough Items', 'Just Enough Items (JEI)'],
  ['rei', 'REI 物品管理器', 'Roughly Enough Items'],
  ['emi', 'EMI 物品管理器', 'EMI'],
  ['jade', '', 'Jade'],
  ['wthit', '', 'WTHIT'],
  ['hwyla', '', 'HWYLA'],
  ['appleskin', '苹果皮', 'AppleSkin'],
  ['shulkerboxtooltip', '潜影盒提示', 'Shulker Box Tooltip'],
  ['no-chat-reports', '禁用聊天举报', 'No Chat Reports'],
  ['inventory-hud-forge', '物品栏 HUD+', 'Inventory HUD+'],
  ['xaeros-minimap', 'Xaero 的小地图', "Xaero's Minimap"],
  ['xaeros-world-map', 'Xaero 的世界地图', "Xaero's World Map"],
  ['journeymap', '旅行地图', 'JourneyMap'],
  ['waystones', '传送石碑', 'Waystones'],
  ['sophisticated-backpacks', '精妙背包', 'Sophisticated Backpacks'],
  ['iron-chests', '铁箱子', 'Iron Chests'],
  ['storagedrawers', '抽屉', 'Storage Drawers'],
  ['sophisticated-storage', '精妙存储', 'Sophisticated Storage'],
  ['toms-storage', '汤姆的简易存储', "Tom's Simple Storage Mod"],
  ['storage-labels', '存储标签', 'Storage Labels'],
  ['xp-storage', '经验存储', 'XP Storage'],
  ['refined-storage-addons', '精炼存储：附加', 'Refined Storage Addons'],

  // —— 大型内容模组 ——
  ['create', '机械动力', 'Create'],
  ['create-steam-n-rails', '机械动力：蒸汽轨道', "Create: Steam 'n' Rails"],
  ['createaddition', '机械动力：合成与附加', 'Create Crafts & Additions', 'Create Crafts and Additions'],
  ['create-fabric', '机械动力：Fabric', 'Create Fabric'],
  ['create-connected', '机械动力：连接', 'Create: Connected'],
  ['create-slice-and-dice', '机械动力：切片与骰子', 'Create: Slice & Dice'],
  ['create-copycats', '机械动力：复制猫', 'Create: Copycats+'],
  ['create-aeronautics', '机械动力：航空学', 'Create Aeronautics'],
  ['create-big-cannons', '机械动力：大炮', 'Create Big Cannons'],
  ['create-deco', '机械动力：装饰', 'Create Deco'],
  ['create-enchantment-industry', '机械动力：附魔工业', 'Create Enchantment Industry'],
  ['create-jetpack', '机械动力：喷气背包', 'Create Jetpack'],
  ['create-central-kitchen', '机械动力：中央厨房', 'Create Central Kitchen'],
  ['create-confectionery', '机械动力：糖果工坊', 'Create Confectionery'],
  ['create-diesel-generators', '机械动力：柴油发电机', 'Create Diesel Generators'],
  ['create-new-age', '机械动力：新时代', 'Create: New Age'],
  ['create-liquid-fuel', '机械动力：液体燃料', 'Create Liquid Fuel'],
  ['create-ore-excavation', '机械动力：矿物开采', 'Create Ore Excavation'],
  ['create-clockwork', '机械动力：发条', 'Create Clockwork'],
  ['create-encased', '机械动力：封装', 'Create Encased'],
  ['create-more-automation', '机械动力：更多自动化', 'Create More Automation'],
  ['mekanism', '通用机械', 'Mekanism'],
  ['thermal-expansion', '热力膨胀', 'Thermal Expansion'],
  ['immersive-engineering', '沉浸工程', 'Immersive Engineering'],
  ['applied-energistics-2', '应用能源2', 'Applied Energistics 2', 'AE2'],
  ['refined-storage', '精炼存储', 'Refined Storage'],
  ['botania', '植物魔法', 'Botania'],
  ['blood-magic', '血魔法', 'Blood Magic'],
  ['ars-nouveau', '新生魔艺', 'Ars Nouveau'],
  ['twilight-forest', '暮色森林', 'Twilight Forest'],
  ['biomes-o-plenty', '超多生物群系', "Biomes O' Plenty"],
  ['alexs-mobs', '亚历克斯的生物', "Alex's Mobs"],
  ['ice-and-fire', '冰火传说', 'Ice and Fire'],
  ['farmers-delight', '农夫乐事', "Farmer's Delight"],
  ['tinkers-construct', "匠魂", "Tinkers' Construct"],
  ['apotheosis', '神化', 'Apotheosis'],
  ['origins', '起源', 'Origins'],
  ['quark', '夸克', 'Quark'],
  ['supplementaries', '增补', 'Supplementaries'],
  ['corail-tombstone', '科莱墓碑', 'Corail Tombstone'],
  ['cooking-for-blockheads', '懒人厨房', 'Cooking for Blockheads'],
  ['farming-for-blockheads', '懒人农业', 'Farming for Blockheads'],
  ['serene-seasons', '静谧四季', 'Serene Seasons'],
  ['dynamic-trees', '动态树木', 'Dynamic Trees'],
  ['distant-horizons', '远处的地平线', 'Distant Horizons'],
  ['epic-fight', '史诗战斗', 'Epic Fight'],
  ['paraglider', '滑翔伞', 'Paraglider'],
  ['valkyrien-skies', '瓦尔基里天空', 'Valkyrien Skies'],
  ['immersive-aircraft', '沉浸式飞行器', 'Immersive Aircraft'],
  ['small-ships', '小船', 'Small Ships'],

  // —— 光影 ——
  ['complementary-reimagined', '互补光影', 'Complementary Shaders - Reimagined', 'Complementary Shaders'],
  ['bsl-shaders', 'BSL 光影', 'BSL Shaders'],
  ['photon', 'Photon 光影', 'Photon Shader'],
  ['makeup-ultra-fast-shaders', 'MakeUp 光影', 'MakeUp Ultra Fast Shaders'],
  ['solas-shader', 'Solas 光影', 'Solas Shader'],
  ['noble', 'Noble 光影', 'Noble Shaders'],
];

function normalize(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ''); }

const bySlug = new Map();
const byTitle = new Map();
for (const [slug, zh, ...aliases] of ENTRIES) {
  bySlug.set(slug, zh);
  byTitle.set(normalize(slug), zh);
  for (const a of aliases) byTitle.set(normalize(a), zh);
}

// 返回 undefined 表示未收录；返回 '' 表示保留英文原名；返回字符串表示中文名
function lookupModName(slug, title) {
  const s = String(slug || '').toLowerCase().trim();
  if (s && bySlug.has(s)) return bySlug.get(s);
  const t = normalize(title);
  if (t && byTitle.has(t)) return byTitle.get(t);
  return undefined;
}

module.exports = { lookupModName, normalize, count: ENTRIES.length };
