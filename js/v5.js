/* ============================================================
 * v5.0「荒野觉醒」
 * 角色修行台 / 16 技能 / 远征档案 / 全量图鉴 / 具体资源体系
 * 12 Boss / 24 地图独立怪物池 / 新消耗品 / 新战场植物 / 温室扩充
 * 本文件在 config、save、expedition/*、loadout 之后、game 之前加载，
 * 可安全读取 CONFIG、覆写 Expedition.prototype、包装旧系统方法。
 * ============================================================ */
(function () {
  'use strict';
  if (typeof CONFIG === 'undefined') { console.error('[v5] CONFIG 未就绪'); return; }
  window.CONFIG = CONFIG;
  const V5 = window.V5 = {};

  /* ----------------------------------------------------------
   * 一、具体资源体系（取代抽象“材料”）
   * -------------------------------------------------------- */
  const RESOURCES = {
    wood:      { name: '木材',   icon: '🪵', kind: 'farm',  from: '作物：豌豆射手50%、九叶灵芝80%×2', to: '武器打造、建筑、火把' },
    soil:      { name: '泥土',   icon: '🟫', kind: 'farm',  from: '远征：树精掉落、宝箱', to: '修行升级、种植、堆肥' },
    water:     { name: '清水',   icon: '💧', kind: 'farm',  from: '远征：河湾/水洼采集',   to: '升级、烹饪、温室' },
    compost:   { name: '堆肥',   icon: '🍂', kind: 'farm',  from: '作物：胡萝卜30%；工坊残料×2', to: '升级、高级种植' },
    stone:     { name: '石料',   icon: '🪨', kind: 'farm',  from: '作物：仙人掌50%',   to: '建筑、捕兽夹' },
    fiber:     { name: '植物纤维', icon: '🌾', kind: 'farm', from: '作物：向日葵/白菜/小麦/蒜/薄荷/水稻/番茄/迷迭香', to: '农田扩建、急救包、绳索' },
    iron:      { name: '铁矿',   icon: '⛓️', kind: 'ore',   from: '作物：仙人掌22%、雷鸣藤40%', to: '武器打造升级、提炼精铁锭' },
    refined_iron: { name: '精铁锭', icon: '🔩', kind: 'ore', from: '作物：雷鸣藤8%；工坊：铁矿×3', to: '高级武器锻造（Lv6+）' },
    crystal:   { name: '晶核',   icon: '💎', kind: 'mob',   from: '作物：西瓜/冰心莲/雷鸣藤/幽魂兰', to: '武器打造升级、高级技能' },
    venom:     { name: '毒腺',   icon: '🧪', kind: 'mob',   from: '作物：辣椒30%、幽冥毒伞70%', to: '毒雾弹' },
    carapace:  { name: '甲壳',   icon: '🐚', kind: 'mob',   from: '作物：仙人掌40%', to: '护盾类工坊制品' },
    soul_ash:  { name: '魂烬',   icon: '🌫️', kind: 'mob',  from: '作物：幽魂兰45%、幽冥毒伞50%', to: '高级锻造、修为丹' },
    bossFang:  { name: '巨兽獠牙', icon: '🦷', kind: 'mob', from: '作物：九叶灵芝25%、幽冥毒伞12%', to: '武器 7 级以上升级（温室/稀有作物产出）' },
    herb:      { name: '药草',   icon: '🌿', kind: 'raw',   from: '远征野外采摘、宝箱',   to: '急救包、药剂' },
  };
  CONFIG.resources = RESOURCES;

  /* ----------------------------------------------------------
   * 一·补、农作物 -> 打造材料映射（v5.1：武器打造材料只能由农作物产出）
   * 每条 [材料id, 单株概率, 命中数量]；高品质收获有数量加成
   * -------------------------------------------------------- */
  const CROP_MATERIALS = {
    pea_shooter:    [['wood', 0.5, 1]],
    sunflower:      [['fiber', 0.4, 1]],
    watermelon:     [['crystal', 0.25, 1]],
    cabbage:        [['fiber', 0.5, 1]],
    wheat:          [['fiber', 0.7, 1]],
    carrot:         [['compost', 0.3, 1]],
    chili:          [['venom', 0.3, 1]],
    garlic:         [['fiber', 0.45, 1]],
    mint:           [['fiber', 0.4, 1]],
    cactus:         [['stone', 0.5, 1], ['carapace', 0.4, 1], ['iron', 0.28, 1]],
    rice:           [['fiber', 0.8, 1]],
    ginseng:        [['wood', 0.8, 2], ['bossFang', 0.25, 1]],
    tomato:         [['fiber', 0.35, 1]],
    rosemary:       [['fiber', 0.45, 1]],
    frost_flower:   [['crystal', 0.45, 1]],
    lightning_vine: [['iron', 0.55, 1], ['crystal', 0.2, 1], ['refined_iron', 0.12, 1]],
    shadow_flower:  [['crystal', 0.5, 1], ['soul_ash', 0.45, 1]],
    deathcap:       [['venom', 0.7, 1], ['soul_ash', 0.5, 1], ['bossFang', 0.12, 1]],
  };
  CONFIG.cropMaterials = CROP_MATERIALS;

  /* ----------------------------------------------------------
   * 二、16 技能（旧 4 个排最前，保证旧索引兼容）
   * kind 决定 useSkill 分发；base 为 1 级数值，每级成长见 scaleSkill
   * -------------------------------------------------------- */
  const SKILLS = [
    { id: 'straw_smash', name: '稻草猛击', icon: '🌾', color: '#f2c45b', key: '1', kind: 'aoe',
      energy: 20, cd: 3.0, range: 95, dmg: 35, stun: 0.5, desc: '横扫周围敌人造成伤害并短暂眩晕。' },
    { id: 'vine_bind', name: '藤蔓缠绕', icon: '🌿', color: '#55aa55', key: '2', kind: 'root',
      energy: 26, cd: 6.0, range: 150, dmg: 12, stun: 2.5, desc: '藤蔓缠绕周围敌人，定身并造成少量伤害。' },
    { id: 'earth_dash', name: '泥土遁走', icon: '💨', color: '#a6e7ff', key: '3', kind: 'dash',
      energy: 22, cd: 4.5, range: 0, dmg: 0, dash: 200, invuln: 0.8, desc: '向鼠标方向突进，过程无敌。' },
    { id: 'smoke_screen', name: '烟幕诀', icon: '💨', color: '#9aa0a6', key: '4', kind: 'stealth',
      energy: 30, cd: 9.0, range: 0, dmg: 0, stealth: 3.0, desc: '释放烟幕进入隐身，怪物丢失目标。' },
    { id: 'chili_breath', name: '辣椒火息', icon: '🌶️', color: '#ff5a3c', key: '?', kind: 'cone',
      energy: 34, cd: 7.0, range: 170, dmg: 22, burn: 14, burnDur: 3, cone: 0.9, desc: '锥形火焰持续灼烧，附加燃烧。' },
    { id: 'pea_storm', name: '豌豆风暴', icon: '🌀', color: '#7ed957', key: '?', kind: 'channel_peas',
      energy: 40, cd: 12.0, range: 520, dmg: 10, duration: 3.0, desc: '3 秒内连续发射速射弹幕。' },
    { id: 'frost_barrier', name: '寒冰屏障', icon: '🧊', color: '#7fd4ff', key: '?', kind: 'frost',
      energy: 38, cd: 13.0, range: 110, dmg: 8, shield: 90, slow: 0.4, duration: 6, desc: '获得护盾，近身敌人被减速。' },
    { id: 'thorn_burst', name: '荆棘爆发', icon: '🌵', color: '#8fd14f', key: '?', kind: 'thorns',
      energy: 36, cd: 14.0, range: 95, dmg: 0, reflect: 0.5, thornsDps: 16, duration: 8, desc: '8 秒反伤光环，近身敌人持续受创。' },
    { id: 'earth_slam', name: '裂地猛击', icon: '💥', color: '#d9a066', key: '?', kind: 'slam',
      energy: 42, cd: 10.0, range: 360, radius: 95, dmg: 60, stun: 1.2, desc: '猛砸鼠标指定点，范围伤害并眩晕。' },
    { id: 'gale_slash', name: '疾风斩', icon: '🗡️', color: '#bfe9ff', key: '?', kind: 'gale',
      energy: 30, cd: 6.5, range: 300, dmg: 30, dash: 120, blades: 2, desc: '突进并留下穿透风刃。' },
    { id: 'healing_rain', name: '治愈甘霖', icon: '🌦️', color: '#8be9a0', key: '?', kind: 'heal',
      energy: 44, cd: 16.0, range: 120, dmg: 0, hot: 14, duration: 5, desc: '5 秒范围持续回血。' },
    { id: 'sun_drum', name: '骄阳战鼓', icon: '🥁', color: '#ffcf5a', key: '?', kind: 'drum',
      energy: 40, cd: 18.0, range: 0, dmg: 0, atkSpd: 0.3, moveSpd: 0.2, duration: 10, desc: '10 秒攻速/移速提升。' },
    { id: 'poison_mist', name: '毒雾蔓延', icon: '☠️', color: '#9be86b', key: '?', kind: 'poison',
      energy: 46, cd: 15.0, range: 380, radius: 120, dmg: 16, dot: 10, duration: 4, blind: true, desc: '指定点毒云，持续伤害并致盲。' },
    { id: 'iron_armor', name: '金刚藤甲', icon: '🛡️', color: '#c8b089', key: '?', kind: 'armor',
      energy: 48, cd: 20.0, range: 0, dmg: 0, reduce: 0.5, duration: 6, desc: '6 秒减伤 50% 且霸体（不受硬直）。' },
    { id: 'thunder_chain', name: '雷霆链', icon: '⚡', color: '#ffe46b', key: '?', kind: 'chain',
      energy: 42, cd: 9.0, range: 420, dmg: 34, jumps: 5, jumpRange: 190, desc: '闪电在最多 5 个敌人间跳跃。' },
    { id: 'death_scythe', name: '死神镰舞', icon: '🌀', color: '#c16bff', key: '?', kind: 'channel_scythe',
      energy: 70, cd: 24.0, range: 120, dmg: 48, duration: 3.0, desc: '3 秒旋转斩，持续绞杀周围敌人。' },
  ];
  // 解锁条件（在 CharacterSystem.checkUnlocks 中求值）
  const SKILL_UNLOCK = {
    straw_smash: { type: 'default' },
    vine_bind: { type: 'level', value: 10 },
    earth_dash: { type: 'extractTier', value: 1 },
    smoke_screen: { type: 'perfectDodge', value: 20 },
    chili_breath: { type: 'harvest', crop: 'chili', value: 50 },
    pea_storm: { type: 'weaponLevel', weapon: 'pea_repeater', value: 5 },
    frost_barrier: { type: 'consecTier', tier: 1, value: 3 },
    thorn_burst: { type: 'killElite', value: 'boar_king' },
    earth_slam: { type: 'level', value: 25 },
    gale_slash: { type: 'signalExtract', value: 3 },
    healing_rain: { type: 'greenhouse', value: 4 },
    sun_drum: { type: 'tech', value: 10 },
    poison_mist: { type: 'killBoss', value: 't2_ruin_golem' },
    iron_armor: { type: 'level', value: 45 },
    thunder_chain: { type: 'extractTier', value: 3 },
    death_scythe: { type: 'archives', value: 12 },
  };
  CONFIG.skills = SKILLS;
  CONFIG.skillUnlock = SKILL_UNLOCK;

  // 技能每级成长（1 级为基准）
  function scaleSkill(base, level) {
    const L = level - 1;
    const out = Object.assign({}, base);
    out.level = level;
    if (base.dmg) out.dmg = Math.round(base.dmg * (1 + 0.18 * L));
    if (base.burn) out.burn = Math.round(base.burn * (1 + 0.15 * L));
    if (base.dot) out.dot = Math.round(base.dot * (1 + 0.18 * L));
    if (base.hot) out.hot = Math.round(base.hot * (1 + 0.15 * L));
    if (base.shield) out.shield = Math.round(base.shield * (1 + 0.12 * L));
    if (base.stun) out.stun = +(base.stun + 0.15 * L).toFixed(2);
    out.cooldown = +(base.cd * (1 - 0.05 * L)).toFixed(2);
    out.energyCost = Math.round(base.energy * (1 - 0.03 * L));
    out.range = base.range;
    return out;
  }
  // 覆写全局 getSkillStats（ui.js 定义），支持 16 技能、1-5 级 + 卡牌临时等级
  window.getSkillStats = function (skill, extraLevels = 0) {
    if (!skill) return skill;
    const base = (typeof GameState !== 'undefined' && GameState.skillLevels) ? (GameState.skillLevels[skill.id] || 1) : 1;
    const lvl = Math.max(1, Math.min(8, base + (extraLevels || 0)));
    const s = scaleSkill(skill, Math.min(5, Math.max(1, base)));
    s.level = lvl;
    s.extraLevels = extraLevels;
    if (extraLevels > 0) { // 卡牌临时等级也加成数值
      const e = scaleSkill(skill, Math.min(8, lvl));
      s.damage = e.dmg; s.dmg = e.dmg; s.cooldown = e.cooldown; s.energyCost = e.energyCost;
    }
    s.damage = s.dmg || 0;
    s.energyCost = s.energyCost;
    s.dashDistance = s.dash; s.invulnDuration = s.invuln; s.stealthDuration = s.stealth;
    s.stunDuration = s.stun;
    return s;
  };

  /* ----------------------------------------------------------
   * 三、新消耗品（合并进 CONFIG.consumables）
   * -------------------------------------------------------- */
  const NEW_CONSUMABLES = [
    { id: 'beartrap_item', name: '捕兽夹', icon: '🪤', key: '', value: 45, desc: '在鼠标位置放置，定身踩中的敌人 3 秒。' },
    { id: 'war_horn', name: '战吼号角', icon: '📯', key: '', value: 70, desc: '放置图腾，12 秒内周围攻速 +40%。' },
    { id: 'scout_eagle', name: '侦察鹰', icon: '🦅', key: '', value: 55, desc: '8 秒内视野大幅扩大并驱散迷雾。' },
    { id: 'purify_tonic', name: '净化药剂', icon: '🧴', key: '', value: 40, desc: '清除自身减速/中毒等负面状态。' },
    { id: 'rage_tonic', name: '狂暴药剂', icon: '💉', key: '', value: 65, desc: '8 秒伤害 +50%，但受伤 +15%。' },
    { id: 'shield_gen', name: '护盾发生器', icon: '🛡️', key: '', value: 80, desc: '获得 120 点护盾，持续 10 秒。' },
    { id: 'rotting_bait', name: '腐肉诱饵', icon: '🍖', key: '', value: 45, desc: '扔向鼠标点，吸引怪物聚集 8 秒。' },
    { id: 'med_shot', name: '急救针', icon: '💊', key: '', value: 90, desc: '瞬间回复 50% 最大生命。' },
    { id: 'death_pardon', name: '免死令', icon: '📜', key: '', value: 300, desc: '阵亡时自动消耗，免除一次降级。' },
    { id: 'shield_elixir', name: '冰心护盾药', icon: '🧊', key: '', value: 120, desc: '获得 150 点护盾，直到被击破。' },
    { id: 'flame_elixir', name: '赤炎药剂', icon: '🔥', key: '', value: 120, desc: '12 秒攻击 +20%，并清除中毒。' },
    { id: 'wraith_draft', name: '幽魂秘药', icon: '🪻', key: '', value: 180, desc: '隐身 5 秒，怪物丢失目标。' },
    { id: 'energy_cell', name: '能量电池', icon: '🔋', key: '', value: 140, desc: '瞬间回满能量。' },
    { id: 'grape_juice', name: '葡萄能量饮', icon: '🍇', key: '', value: 100, desc: '15 秒内能量回复翻倍。' },
    // —— 工坊加工品（闭环：食品/药品均可带入远征） ——
    { id: 'bread', name: '面包', icon: '🍞', key: '', value: 60, desc: '立刻回复 80 点生命。' },
    { id: 'medkit', name: '急救包', icon: '🩹', key: '', value: 130, desc: '立刻回复 200 点生命。' },
    { id: 'ketchup', name: '番茄酱', icon: '🥫', key: '', value: 90, desc: '立刻回复 150 点生命。' },
    { id: 'juice', name: '西瓜汁', icon: '🧃', key: '', value: 70, desc: '本局能量上限 +40 并回满。' },
    { id: 'egg', name: '荒野鸡蛋', icon: '🥚', key: '', value: 80, desc: '120 秒内攻击 +15%。' },
    { id: 'mint_tea', name: '薄荷茶', icon: '🍵', key: '', value: 70, desc: '60 秒内移速 +15%。' },
    { id: 'ginseng_soup', name: '人参汤', icon: '🍲', key: '', value: 260, desc: '回满生命，60 秒攻击 +20%。' },
    { id: 'torch', name: '火把', icon: '🔥', key: '', value: 50, desc: '每支照明60秒（休闲120/普通60/困难40/噩梦30秒），耗尽自动续下一支；无火把视野极小，务必携带。' },
    { id: 'poison_bomb', name: '毒雾弹', icon: '☠️', key: '', value: 110, desc: '投掷后范围 60 伤害并减速 3 秒。' },
    { id: 'insecticide', name: '驱虫剂', icon: '🧪', key: '', value: 35, desc: '使用后 6 秒内身边怪物丢失目标（驱虫脱身），也可在农场治疗病虫害。' },
  ];
  const oldConsumableIds = new Set((CONFIG.consumables || []).map(c => c.id));
  NEW_CONSUMABLES.forEach(c => { if (!oldConsumableIds.has(c.id)) CONFIG.consumables.push(c); });
  // 全部消耗品注册进仓库白名单（否则撤离入库会被丢弃）
  if (CONFIG.warehouseItems) {
    CONFIG.consumables.forEach(c => { if (!CONFIG.warehouseItems[c.id]) CONFIG.warehouseItems[c.id] = { name: c.name, icon: c.icon, category: 'consumable' }; });
    [['pumpkin_lantern','南瓜灯','🎃']].forEach(x => {
      if (!CONFIG.warehouseItems[x[0]]) CONFIG.warehouseItems[x[0]] = { name: x[1], icon: x[2], category: 'resource' };
    });
  }
  // 工坊新配方（输入→输出→被远征消耗，闭环）
  if (window.FarmRecipes) {
    const NEW_RECIPES = [
      { id:'ketchup', name:'番茄酱', icon:'🥫', inputCrop:'tomato', inputQty:2, outputId:'ketchup', outputName:'番茄酱', outputIcon:'🥫', outputQty:1, time:25, workshopLevel:1, desc:'番茄→番茄酱，远征回血150' },
      { id:'mint_tea', name:'薄荷茶', icon:'🍵', inputCrop:'mint', inputQty:2, outputId:'mint_tea', outputName:'薄荷茶', outputIcon:'🍵', outputQty:1, time:20, workshopLevel:1, desc:'薄荷→薄荷茶，远征移速buff' },
      { id:'compost2', name:'堆肥', icon:'🍂', inputCrop:'wheat', inputQty:2, outputId:'compost', outputName:'堆肥', outputIcon:'🍂', outputQty:1, time:15, workshopLevel:1, desc:'残料→堆肥，角色升级材料' },
      { id:'refined_iron', name:'精铁锭', icon:'🔩', inputs:{iron:3}, outputId:'refined_iron', outputName:'精铁锭', outputIcon:'🔩', outputQty:1, time:20, workshopLevel:2, desc:'铁矿×3→精铁锭，高级锻造' },
      { id:'medkit', name:'急救包', icon:'🩹', inputs:{herb:2,fiber:1}, outputId:'medkit', outputName:'急救包', outputIcon:'🩹', outputQty:1, time:25, workshopLevel:1, desc:'药草×2+纤维→急救包，回血200' },
      { id:'poison_bomb', name:'毒雾弹', icon:'☠️', inputs:{venom:2,fiber:1}, outputId:'poison_bomb', outputName:'毒雾弹', outputIcon:'☠️', outputQty:1, time:30, workshopLevel:2, desc:'毒腺×2+纤维→毒雾弹' },
      { id:'ginseng_soup', name:'人参汤', icon:'🍲', inputs:{ginseng:1,herb:2}, outputId:'ginseng_soup', outputName:'人参汤', outputIcon:'🍲', outputQty:1, time:40, workshopLevel:3, desc:'人参+药草→人参汤，满血红蓝药' },
    ];
    NEW_RECIPES.forEach(r => { if (!window.FarmRecipes.find(x => x.id === r.id)) window.FarmRecipes.push(r); });
  }

  /* ----------------------------------------------------------
   * 四、新战场植物（6 种，战场植物总数 20）
   * -------------------------------------------------------- */
  const NEW_DEPLOY = [
    { id: 'spike_root', name: '地刺根茎', icon: '🌵', hp: 110, radius: 46, cooldown: 0, dps: 8, color: '#b0894f', desc: '经过的敌人持续流血。' },
    { id: 'poison_spore', name: '毒孢菇', icon: '🍄', hp: 70, radius: 95, cooldown: 3, dot: 12, color: '#9be86b', desc: '周期释放毒云，致盲并持续伤害。' },
    { id: 'ice_cactus', name: '冰棘仙人掌', icon: '🌵', hp: 140, radius: 60, reflect: 0.2, color: '#7fd4ff', desc: '反伤近身敌人并概率冰冻。' },
    { id: 'thunder_vine', name: '雷鸣藤', icon: '⚡', hp: 90, radius: 150, cooldown: 2.5, strike: 40, color: '#ffe46b', desc: '周期落雷打击范围内随机敌人。' },
    { id: 'purify_flower', name: '净化花', icon: '🌸', hp: 80, radius: 110, cooldown: 3, color: '#ffd6ec', desc: '周期清除玩家负面状态。' },
    { id: 'mirror_grass', name: '镜草', icon: '🌿', hp: 100, radius: 70, reflect: 0.35, color: '#bfefff', desc: '光环内反弹敌方投射物/伤害。' },
  ];
  NEW_DEPLOY.forEach(p => { if (!CONFIG.deployPlants[p.id]) CONFIG.deployPlants[p.id] = p; });
  // v5.0 新战场植物接入「远征采摘 → 仓库种子 → 携带部署」闭环
  (function(){
    const seedDefs = [
      { id: 'spike_root',    name: '地刺根茎种子', tier: 1, rarity: 'common', sell: 25 },
      { id: 'poison_spore',  name: '毒孢菇种子',   tier: 2, rarity: 'rare',   sell: 45 },
      { id: 'ice_cactus',    name: '冰棘仙人掌种子', tier: 2, rarity: 'rare', sell: 45 },
      { id: 'purify_flower', name: '净化花种子',   tier: 2, rarity: 'rare',   sell: 50 },
      { id: 'thunder_vine',  name: '雷鸣藤种子',   tier: 3, rarity: 'epic',   sell: 80 },
      { id: 'mirror_grass',  name: '镜草种子',     tier: 3, rarity: 'epic',   sell: 80 }
    ];
    seedDefs.forEach(d => {
      CONFIG.cropToDeploy[d.id] = d.id;
      const dp = CONFIG.deployPlants[d.id];
      if (dp && !CONFIG.wildPlants.some(w => w.givesSeed === d.id)) {
        CONFIG.wildPlants.push({ id: 'wild_' + d.id, icon: dp.icon, name: '野生' + dp.name, givesSeed: d.id, tier: d.tier });
      }
      if (CONFIG.warehouseItems && !CONFIG.warehouseItems[d.id]) {
        CONFIG.warehouseItems[d.id] = { name: d.name, icon: dp ? dp.icon : '🌱', category: 'crop', sellPrice: d.sell, rarity: d.rarity };
      }
    });
  })();

  /* ----------------------------------------------------------
   * 五、温室扩充 6 → 12（含 3 种修为作物）
   * -------------------------------------------------------- */
  const NEW_GREENHOUSE = [
    { id: 'ice_lotus', name: '冰心莲', icon: '🪷', rarity: 'rare', seedPrice: 260, growTime: 600,
      drops: [{ id: 'shield_elixir', chance: 0.8, min: 1, max: 2 }], desc: '炼制护盾药剂。' },
    { id: 'flame_fruit', name: '赤炎果', icon: '🔥', rarity: 'rare', seedPrice: 280, growTime: 640,
      drops: [{ id: 'flame_elixir', chance: 0.8, min: 1, max: 2 }], desc: '火抗/火伤药剂。' },
    { id: 'wraith_orchid', name: '幽魂兰', icon: '🪻', rarity: 'epic', seedPrice: 420, growTime: 900,
      drops: [{ id: 'wraith_draft', chance: 0.7, min: 1, max: 1 }], desc: '延长隐身时间的秘药。' },
    { id: 'thunder_fruit', name: '雷霆果', icon: '⚡', rarity: 'epic', seedPrice: 460, growTime: 960,
      drops: [{ id: 'energy_cell', chance: 0.8, min: 1, max: 2 }], desc: '瞬间满能量的能量药。' },
    { id: 'crystal_grape', name: '水晶葡萄', icon: '🍇', rarity: 'rare', seedPrice: 300, growTime: 700,
      drops: [{ id: 'grape_juice', chance: 0.85, min: 1, max: 2 }], desc: '能量回复增益饮品。' },
    { id: 'wudao_fruit', name: '悟道果', icon: '🍑', rarity: 'epic', seedPrice: 520, growTime: 720,
      drops: [{ id: 'cult_pill_s', chance: 1, min: 1, max: 1 }], desc: '修为作物：收获修为丹(+75)。' },
    { id: 'jiuye_lingzhi', name: '九叶灵芝', icon: '🍄', rarity: 'legendary', seedPrice: 900, growTime: 14400,
      drops: [{ id: 'cult_pill_m', chance: 1, min: 1, max: 2 }], desc: '修为作物：修为丹(+260)。' },
    { id: 'jiuzhuan_ginseng', name: '九转人参', icon: '🥕', rarity: 'legendary', seedPrice: 2000, growTime: 43200,
      drops: [{ id: 'cult_pill_l', chance: 1, min: 1, max: 1 }], desc: '修为作物：巨额修为(+900)。' },
  ];
  CONFIG.greenhousePlants = CONFIG.greenhousePlants || [];
  const ghIds = new Set(CONFIG.greenhousePlants.map(p => p.id));
  NEW_GREENHOUSE.forEach(p => { if (!ghIds.has(p.id)) CONFIG.greenhousePlants.push(p); });
  CONFIG.greenhouseDrops = CONFIG.greenhouseDrops || {};
  Object.assign(CONFIG.greenhouseDrops, {
    shield_elixir: { name: '冰心护盾药', icon: '🧊', type: 'consumable', effect: '远征获得150护盾', value: 120 },
    flame_elixir: { name: '赤炎药剂', icon: '🔥', type: 'consumable', effect: '火抗+火伤', value: 120 },
    wraith_draft: { name: '幽魂秘药', icon: '🪻', type: 'consumable', effect: '隐身时间+2秒', value: 180 },
    energy_cell: { name: '能量电池', icon: '🔋', type: 'consumable', effect: '瞬间回满能量', value: 140 },
    grape_juice: { name: '葡萄能量饮', icon: '🍇', type: 'consumable', effect: '能量回复提升', value: 100 },
    cult_pill_s: { name: '小修为丹', icon: '🟠', type: 'cultivation', value: 75 },
    cult_pill_m: { name: '灵芝修为丹', icon: '🔴', type: 'cultivation', value: 260 },
    cult_pill_l: { name: '九转修为丹', icon: '🟣', type: 'cultivation', value: 900 },
  });

  /* ----------------------------------------------------------
   * 六、修为作物（农场）+ 成长常量
   * -------------------------------------------------------- */
  CONFIG.cultivationCrops = [
    { id: 'ningqi_grass', name: '凝气草', icon: '🌱', growTime: 20, exp: 10, unlock: '初始解锁' },
    { id: 'lingsui_wheat', name: '灵穗麦', icon: '🌾', growTime: 60, exp: 28, unlock: '角色 Lv15' },
  ];
  // 两种可在普通农田种植的修为作物
  const cultCropIds = new Set((CONFIG.crops || []).map(c => c.id));
  [
    { id: 'ningqi_grass', name: '凝气草', icon: '🌱', growTime: 20, sellPrice: 12, price: 20, rarity: 1, cultivation: 10, rewardType: 'cultivation', desc: '修为作物，收获转化为修为；新手首次收获额外 +30 修为。' },
    { id: 'lingsui_wheat', name: '灵穗麦', icon: '🌾', growTime: 60, sellPrice: 30, price: 60, rarity: 1, cultivation: 28, rewardType: 'cultivation', desc: '修为作物，Lv15 解锁。' },
  ].forEach(c => { if (!cultCropIds.has(c.id)) CONFIG.crops.push(c); });

  const GROWTH = {
    expBase: 60, expPow: 1.4,
    goldBase: 30, goldPow: 1.25,
    slotLevels: [20, 40, 60, 80],
    maxLevel: 100,
  };
  CONFIG.growth = GROWTH;

  /* ----------------------------------------------------------
   * 七、12 Boss + 新精英怪 + 24 地图怪物池
   * -------------------------------------------------------- */
  const BOSSES = {
    t1_boar_king:   { id: 't1_boar_king', name: '狂暴野猪王', tier: 1, hp: 3800, dmg: 22, speed: 96, radius: 46, emoji: '🐗', color: '#c98a4b', skill: '震荡波 + 锁定冲锋（半血狂暴）', loot: ['bossFang', 'iron', 'stone'] },
    t1_withered:    { id: 't1_withered', name: '枯木精', tier: 1, hp: 4000, dmg: 20, speed: 70, radius: 48, emoji: '🌳', color: '#6f8f4e', skill: '树根缠绕定身 + 回血光环', loot: ['bossFang', 'wood', 'fiber'] },
    t1_quarry:      { id: 't1_quarry', name: '采石巨魔', tier: 1, hp: 3600, dmg: 26, speed: 64, radius: 50, emoji: '🗿', color: '#9b8b78', skill: '范围投石 + 岩石护甲减伤', loot: ['bossFang', 'stone', 'iron'] },
    t2_gargoyle_lord: { id: 't2_gargoyle_lord', name: '石像鬼王', tier: 2, hp: 8400, dmg: 28, speed: 104, radius: 46, emoji: '🦇', color: '#7d8a99', flying: true, skill: '石化凝视 + 俯冲 + 弹幕散射', loot: ['bossFang', 'carapace', 'stone'] },
    t2_ruin_golem:  { id: 't2_ruin_golem', name: '废墟魔像', tier: 2, hp: 8600, dmg: 30, speed: 60, radius: 52, emoji: '🗿', color: '#8d8578', skill: '血量分裂 + 反伤岩石护盾 + 碎石弹', loot: ['bossFang', 'refined_iron', 'crystal'] },
    t3_swamp_hag:   { id: 't3_swamp_hag', name: '沼泽巫妪', tier: 3, hp: 9800, dmg: 32, speed: 82, radius: 46, emoji: '🧙‍♀️', color: '#7fae5a', ranged: true, skill: '毒沼陷阱 + 召唤雾天 + 诅咒毒弹（远程风筝）', loot: ['bossFang', 'venom', 'soul_ash'] },
    t3_brood_mother:{ id: 't3_brood_mother', name: '虫母', tier: 3, hp: 21000, dmg: 28, speed: 72, radius: 52, emoji: '🕷️', color: '#a06bb0', summoner: true, skill: '产卵虫潮 + 蛛网陷阱', loot: ['bossFang', 'carapace', 'venom'] },
    t3_scorch_demon:{ id: 't3_scorch_demon', name: '焦林炎魔', tier: 3, hp: 23000, dmg: 36, speed: 88, radius: 48, emoji: '🔥', color: '#ff6a3c', skill: '火雨陷阱 + 召唤雷暴 + 火焰连射', loot: ['bossFang', 'crystal', 'soul_ash'] },
    t4_abyss_lord:  { id: 't4_abyss_lord', name: '深渊领主', tier: 4, hp: 170000, dmg: 40, speed: 80, radius: 56, emoji: '👹', color: '#8a3bd8', skill: '复活尸体 + 深渊领域（雾天召唤）', loot: ['bossFang', 'soul_ash', 'crystal'] },
    t4_time_warden: { id: 't4_time_warden', name: '时空守望', tier: 4, hp: 160000, dmg: 38, speed: 92, radius: 48, emoji: '⏳', color: '#5ad1c8', skill: '传送凝滞 + 环形弹幕齐射', loot: ['bossFang', 'soul_ash', 'refined_iron'] },
    t4_moon_priestess: { id: 't4_moon_priestess', name: '月之祭司', tier: 4, hp: 155000, dmg: 36, speed: 86, radius: 46, emoji: '🌙', color: '#9bb8ff', healer: true, skill: '月光治疗 + 夜魇雾天召唤 + 月光弹', loot: ['bossFang', 'soul_ash', 'crystal'] },
    t4_arena_champion: { id: 't4_arena_champion', name: '竞技场冠军', tier: 4, hp: 180000, dmg: 44, speed: 112, radius: 48, emoji: '⚔️', color: '#d8b25a', charger: true, skill: '突刺/横扫/跳劈三段连招 + 半血狂暴', loot: ['bossFang', 'refined_iron', 'crystal'] },
  };
  CONFIG.bosses = BOSSES;

  // 新精英怪（并入 CONFIG.monsters）
  const NEW_ELITES = {
    withered_treant: { name: '枯木守卫', hp: 260, damage: 22, speed: 70, radius: 20, gold: 26, elite: true, color: '#6f8f4e', regen: 6, ai: 'chaser' },
    quarry_troll: { name: '采石巨魔', hp: 320, damage: 26, speed: 64, radius: 22, gold: 30, elite: true, armor: 0.3, ranged: true, color: '#9b8b78' },
    mill_wraith: { name: '磨坊怨灵', hp: 220, damage: 20, speed: 122, radius: 18, gold: 28, elite: true, flying: true, color: '#9fb6c9' },
    shadow_assassin: { name: '暗影刺客', hp: 210, damage: 30, speed: 152, radius: 16, gold: 34, elite: true, color: '#5a4d7a', ai: 'chaser' },
    brood_queen: { name: '育母蛛', hp: 360, damage: 18, speed: 70, radius: 22, gold: 32, elite: true, summoner: true, color: '#a06bb0', ai: 'chaser' },
    swamp_hag_elite: { name: '沼泽女巫', hp: 300, damage: 24, speed: 82, radius: 20, gold: 32, elite: true, ranged: true, color: '#7fae5a' },
    void_warden: { name: '虚空守卫', hp: 440, damage: 30, speed: 76, radius: 24, gold: 40, elite: true, armor: 0.35, color: '#6d4d99', ai: 'chaser' },
    moon_priestess_elite: { name: '月光祭司', hp: 320, damage: 26, speed: 86, radius: 20, gold: 38, elite: true, healer: true, color: '#9bb8ff' },
    arena_elite: { name: '决斗精英', hp: 400, damage: 34, speed: 112, radius: 21, gold: 42, elite: true, charger: true, color: '#d8b25a' },
  };
  CONFIG.monsters = CONFIG.monsters || {};
  Object.keys(NEW_ELITES).forEach(k => { if (!CONFIG.monsters[k]) CONFIG.monsters[k] = NEW_ELITES[k]; });

  // 每张地图：怪物池权重 + 专属精英 + Boss + 天气倾向
  const MAP_CFG = {
    t1_1: { boss: 't1_boar_king', elite: 'boar_king', weather: '晴', pool: [['boar', 6], ['bat', 2], ['spider', 2], ['treant', 2]] },
    t1_2: { boss: 't1_boar_king', elite: 'boar_king', weather: '晴', pool: [['boar', 5], ['bat', 4], ['spider', 1], ['treant', 1]] },
    t1_3: { boss: 't1_withered', elite: 'withered_treant', weather: '多云', pool: [['boar', 3], ['bat', 2], ['treant', 5], ['spider', 2]] },
    t1_4: { boss: 't1_withered', elite: 'withered_treant', weather: '多云', pool: [['boar', 3], ['treant', 4], ['spider', 3], ['bat', 2]] },
    t1_5: { boss: 't1_quarry', elite: 'quarry_troll', weather: '晴', pool: [['boar', 3], ['treant', 3], ['spider', 2], ['bat', 2]] },
    t1_6: { boss: 't1_quarry', elite: 'quarry_troll', weather: '晴', pool: [['boar', 4], ['spider', 3], ['bat', 3], ['treant', 2]] },
    t2_1: { boss: 't2_gargoyle_lord', elite: 'stone_golem', weather: '雾', pool: [['boar', 2], ['bat', 4], ['spider', 3], ['locust', 2], ['gargoyle', 3], ['wolf', 2], ['treant', 1]] },
    t2_2: { boss: 't2_gargoyle_lord', elite: 'stone_golem', weather: '雾', pool: [['boar', 2], ['bat', 3], ['spider', 4], ['gargoyle', 3], ['locust', 2], ['wolf', 2]] },
    t2_3: { boss: 't2_gargoyle_lord', elite: 'mill_wraith', weather: '阴', pool: [['spider', 5], ['gargoyle', 4], ['bat', 3], ['locust', 2], ['wolf', 1]] },
    t2_4: { boss: 't2_ruin_golem', elite: 'mill_wraith', weather: '阴', pool: [['spider', 5], ['locust', 4], ['bat', 3], ['gargoyle', 2], ['wolf', 2]] },
    t2_5: { boss: 't2_ruin_golem', elite: 'stone_golem', weather: '雨', pool: [['boar', 2], ['gargoyle', 3], ['stone_golem', 1], ['spider', 2], ['wolf', 3], ['locust', 2]] },
    t2_6: { boss: 't2_ruin_golem', elite: 'stone_golem', weather: '晴', pool: [['gargoyle', 3], ['wolf', 3], ['spider', 2], ['stone_golem', 1], ['bat', 3], ['locust', 2]] },
    t3_1: { boss: 't3_swamp_hag', elite: 'swamp_hag_elite', weather: '雨', pool: [['spider', 4], ['wolf', 3], ['gargoyle', 2], ['shadow_demon', 3], ['locust', 3], ['bat', 2], ['treant', 1]] },
    t3_2: { boss: 't3_swamp_hag', elite: 'swamp_hag_elite', weather: '雾', pool: [['spider', 5], ['locust', 3], ['shadow_demon', 3], ['wolf', 2], ['bat', 2]] },
    t3_3: { boss: 't3_brood_mother', elite: 'brood_queen', weather: '阴', pool: [['locust', 6], ['spider', 4], ['bat', 3], ['shadow_demon', 2], ['wolf', 2]] },
    t3_4: { boss: 't3_brood_mother', elite: 'brood_queen', weather: '阴', pool: [['locust', 7], ['spider', 3], ['gargoyle', 2], ['wolf', 2], ['shadow_demon', 2]] },
    t3_5: { boss: 't3_scorch_demon', elite: 'shadow_assassin', weather: '雷暴', pool: [['wolf', 5], ['shadow_demon', 4], ['bat', 2], ['gargoyle', 2], ['spider', 2]] },
    t3_6: { boss: 't3_scorch_demon', elite: 'shadow_assassin', weather: '雷暴', pool: [['shadow_demon', 5], ['wolf', 4], ['gargoyle', 3], ['locust', 2], ['spider', 2]] },
    t4_1: { boss: 't4_abyss_lord', elite: 'void_warden', weather: '雾', pool: [['shadow_demon', 5], ['gargoyle', 4], ['wolf', 4], ['locust', 3], ['spider', 2], ['bat', 2]] },
    t4_2: { boss: 't4_abyss_lord', elite: 'void_warden', weather: '毒雾', pool: [['shadow_demon', 5], ['spider', 4], ['locust', 3], ['gargoyle', 3], ['wolf', 3]] },
    t4_3: { boss: 't4_time_warden', elite: 'void_warden', weather: '异常', pool: [['shadow_demon', 6], ['gargoyle', 3], ['wolf', 3], ['bat', 3], ['locust', 2]] },
    t4_4: { boss: 't4_time_warden', elite: 'void_warden', weather: '异常', pool: [['shadow_demon', 5], ['wolf', 4], ['gargoyle', 4], ['spider', 3]] },
    t4_5: { boss: 't4_moon_priestess', elite: 'moon_priestess_elite', weather: '永夜', pool: [['bat', 6], ['shadow_demon', 4], ['gargoyle', 3], ['wolf', 3], ['spider', 2]] },
    t4_6: { boss: 't4_arena_champion', elite: 'arena_elite', weather: '晴', pool: [['wolf', 6], ['boar', 4], ['shadow_demon', 3], ['gargoyle', 2], ['locust', 2]] },
  };
  (CONFIG.maps || []).forEach(m => {
    const c = MAP_CFG[m.id];
    if (c) { m.monsterPool = c.pool; m.eliteId = c.elite; m.bossId = c.boss; m.weatherTendency = c.weather; }
  });

  /* ----------------------------------------------------------
   * 八、远征档案定义（5 突破 + 20 普通）
   * -------------------------------------------------------- */
  const ARCHIVES = [
    { id: 'brk20', breakthrough: 20, name: '突破·初露锋芒', desc: 'T1 连续撤离 3 次', reward: { cult: 200, pardon: 1 } },
    { id: 'brk40', breakthrough: 40, name: '突破·废墟行者', desc: 'T2 单局存活 10 分钟并撤离', reward: { cult: 600, safe: 1 } },
    { id: 'brk60', breakthrough: 60, name: '突破·深渊凝视', desc: 'T3 连续撤离 2 次', reward: { cult: 1500, legendarySeed: 1 } },
    { id: 'brk80', breakthrough: 80, name: '突破·灾变克星', desc: '击杀任意 T3 Boss', reward: { cult: 3000, blueprint: 1 } },
    { id: 'brk100', breakthrough: 100, name: '突破·荒野传说', desc: '击杀全部 12 个 Boss', reward: { cult: 8000, pardon: 2 } },
    { id: 'signal5', name: '信号弹专家', desc: '使用信号弹撤离 5 次', reward: { cult: 300 } },
    { id: 'extract10', name: '老练撤离者', desc: '累计成功撤离 10 次', reward: { rareSeed: 1 } },
    { id: 'extract30', name: '荒野常客', desc: '累计成功撤离 30 次', reward: { cult: 800, safe: 1 } },
    { id: 'extract100', name: '传奇拾荒者', desc: '累计成功撤离 100 次', reward: { legendarySeed: 1, pardon: 1 } },
    { id: 'perfect10', name: '毫厘之间', desc: '单局完美闪避 10 次', reward: { cult: 200 } },
    { id: 'combo50', name: '连击大师', desc: '单局达成 50 连击', reward: { cult: 250 } },
    { id: 'chest6', name: '开箱能手', desc: '单局开启 6 个宝箱', reward: { rareSeed: 1 } },
    { id: 'plant5', name: '战地农夫', desc: '单局部署 5 株战场植物并存活', reward: { rareSeed: 1 } },
    { id: 'speedT3', name: '闪击战', desc: '5 分钟内通关 T3 及以上', reward: { cult: 500 } },
    { id: 'kill60', name: '屠戮者', desc: '单局击杀 60 个敌人', reward: { cult: 400 } },
    { id: 'lowHpT4', name: '险胜', desc: '血量低于 10% 通关 T4', reward: { legendarySeed: 1 } },
    { id: 'loot5000', name: '满载而归', desc: '单局带出价值 5000 金币战利品', reward: { cult: 600 } },
    { id: 'noHitT2', name: '毫发无损', desc: '零受伤通关 T2 及以上', reward: { blueprint: 1 } },
    { id: 'nightmare', name: '噩梦征服者', desc: '通关噩梦难度', reward: { legendarySeed: 1, pardon: 1 } },
    { id: 'bossHunter', name: 'Boss 猎手', desc: '击杀 6 种不同 Boss', reward: { cult: 1200 } },
    { id: 'explorer', name: '地图测绘师', desc: '探索全部 24 张地图', reward: { cult: 700, safe: 1 } },
    { id: 'scythe12', name: '档案收藏家', desc: '点亮 12 份档案', reward: { unlockSkill: 'death_scythe' } },
  ];
  CONFIG.archives = ARCHIVES;

  // ============================================================
  //  CharacterSystem（角色修行台）
  // ============================================================
  const CharacterSystem = window.CharacterSystem = {
    init() {
      const gs = GameState;
      gs.level = gs.level || 1;
      gs.cultivation = gs.cultivation || 0;
      gs.unlockedSkills = gs.unlockedSkills || ['straw_smash'];
      gs.skillLevels = gs.skillLevels || { straw_smash: 1 };
      if (gs.equippedSkills == null) gs.equippedSkills = ['straw_smash'];
      if (!Array.isArray(gs.equippedSkills)) gs.equippedSkills = [];
      gs.harvestCount = gs.harvestCount || {};
      gs.archive = gs.archive || {
        maps: {}, bosses: {}, elites: {}, claimed: {}, stats: {
          totalExtracts: 0, signalExtracts: 0, perfectDodgeTotal: 0,
          tierExtracts: { 1: 0, 2: 0, 3: 0, 4: 0 }, tierConsec: { 1: 0, 2: 0, 3: 0, 4: 0 },
          bossTypes: 0, mapsCleared: 0,
        },
      };
      if (!Array.isArray(gs.processingQueue)) gs.processingQueue = [];
      // 装备技能数不得超过卡槽
      const slots = this.slotCount();
      gs.equippedSkills = gs.equippedSkills.filter(id => gs.unlockedSkills.includes(id)).slice(0, slots);
      // v5.1 仅首次初始化自动补满技能槽；之后尊重玩家主动卸下的空槽（修复“技能卸不掉”）
      if (!gs._slotsInitialized) {
        gs._slotsInitialized = true;
        while (gs.equippedSkills.length < Math.min(slots, gs.unlockedSkills.length)) {
          const next = gs.unlockedSkills.find(id => !gs.equippedSkills.includes(id));
          if (!next) break;
          gs.equippedSkills.push(next);
        }
      }
    },
    slotCount(level) {
      const lv = level || GameState.level || 1;
      let n = 1;
      GROWTH.slotLevels.forEach(s => { if (lv >= s) n++; });
      return n; // 1..5
    },
    derived(level) {
      const lv = level || GameState.level || 1;
      const t = lv - 1;
      return {
        hp: 100 + Math.round(t * 800 / 99),
        atk: +(12 + Math.round(t * 80 / 99 * 10) / 10).toFixed(1),
        def: +(Math.round(t * 60 / 99 * 10) / 10).toFixed(1),
        energyMax: 100 + 2 * Math.floor(lv / 2),
        energyRegen: 15 + Math.floor(lv / 5) * 0.3,
        ocRegen: Math.floor(lv / 10) * 0.4,
        slots: this.slotCount(lv),
      };
    },
    expNeeded(lv) { return Math.round(GROWTH.expBase * Math.pow(lv, GROWTH.expPow)); },
    goldNeeded(lv) { return Math.round(GROWTH.goldBase * Math.pow(lv, GROWTH.goldPow)); },
    soilNeeded(lv) { return 2 + Math.floor(lv / 10); },
    waterNeeded(lv) { return 1 + Math.floor(lv / 15); },
    compostNeeded(lv) { return Math.floor(lv / 20); },
    breakthroughMet(lv) {
      const a = GameState.archive;
      switch (lv) {
        case 20: return (a.stats.tierConsec[1] || 0) >= 3;
        case 40: return !!a.stats.t2Survive10;
        case 60: return (a.stats.tierConsec[3] || 0) >= 2;
        case 80: return (a.stats.t3BossKilled || 0) >= 1;
        case 100: return a.stats.bossTypes >= 12;
        default: return true;
      }
    },
    breakthroughText(lv) {
      return ({ 20: 'T1 连续撤离 3 次', 40: 'T2 单局存活 10 分钟并撤离', 60: 'T3 连续撤离 2 次', 80: '击杀 T3 Boss', 100: '击杀全部 12 个 Boss' })[lv] || '突破';
    },
    // 打坐/收获/丹药获得修为，自动连升（突破等级未满足则卡在本级）
    addExp(n, silent) {
      let gained = 0;
      GameState.cultivation += n; gained += n;
      let leveled = false;
      while (GameState.level < GROWTH.maxLevel) {
        const lv = GameState.level;
        const need = this.expNeeded(lv);
        if (GameState.cultivation < need) break;
        const nextLv = lv + 1;
        if (GROWTH.slotLevels.includes(nextLv) || nextLv === 100) {
          if (!this.breakthroughMet(nextLv)) {
            GameState.cultivation = need; // 卡在突破门槛
            if (!silent) showToast(`已达 Lv${lv} 突破门槛，请完成远征档案：${this.breakthroughHint(nextLv)}`, 'warning');
            break;
          }
        }
        GameState.cultivation -= need;
        GameState.level = nextLv;
        leveled = true;
        this.onLevelUp(nextLv);
      }
      this.checkUnlocks();
      try { SaveSystem.save(); } catch (e) {}
      return { gained, leveled };
    },
    breakthroughHint(lv) {
      const arc = ARCHIVES.find(a => a.breakthrough === lv);
      return arc ? arc.desc : '';
    },
    onLevelUp(lv) {
      if (window.Telemetry) {
        Telemetry.track('character_levelup', { level: lv });
        if (GROWTH.slotLevels.includes(lv) || lv === 100) Telemetry.track('character_breakthrough', { level: lv });
      }
      showToast(`境界提升！角色达到 Lv${lv}${GROWTH.slotLevels.includes(lv) ? '，技能卡槽 +1' : ''}`, 'gold');
    },
    // 修行台手动升级（消耗金币 + 泥土/清水/堆肥 + 修为）
    tryCultivate() {
      this.init();
      const lv = GameState.level;
      if (lv >= GROWTH.maxLevel) { showToast('已达满级 Lv100', 'warning'); return false; }
      const nextLv = lv + 1;
      if ((nextLv % 20 === 0 || nextLv === 100) && !this.breakthroughMet(nextLv)) {
        showToast('需要先完成突破档案：' + this.breakthroughText(nextLv), 'warning'); return false;
      }
      const need = this.expNeeded(lv);
      const gold = this.goldNeeded(lv), soil = this.soilNeeded(lv), water = this.waterNeeded(lv), compost = this.compostNeeded(lv);
      const miss = [];
      if (GameState.cultivation < need) miss.push(`修为 ${Math.floor(GameState.cultivation)}/${need}（去种凝气草）`);
      if (GameState.gold < gold) miss.push(`金币 ${GameState.gold}/${gold}`);
      const have = { soil: ResourceSystem.count('soil'), water: ResourceSystem.count('water'), compost: ResourceSystem.count('compost') };
      if (have.soil < soil) miss.push(`泥土 ${have.soil}/${soil}`);
      if (have.water < water) miss.push(`清水 ${have.water}/${water}`);
      if (have.compost < compost) miss.push(`堆肥 ${have.compost}/${compost}`);
      if (miss.length) { showToast('升级条件不足：' + miss.join('；'), 'warning'); return false; }
      ResourceSystem.pay({ soil, water, compost });
      GameState.gold -= gold;
      this.addExp(0); // 触发结算（修为已够）
      showToast(`修炼成功，达到 Lv${GameState.level}！`, 'gold');
      return true;
    },
    onCropHarvested(cropId, qty, quality) {
      this.init();
      if (window.Telemetry) {
        Telemetry.track('crop_harvest', { cropId, qty: qty || 1, quality: quality || 'normal' });
        if (window.CodexSystem && CodexSystem.mark) CodexSystem.mark('crop', cropId);
      }
      GameState.harvestCount[cropId] = (GameState.harvestCount[cropId] || 0) + (qty || 1);
      const crop = (CONFIG.crops || []).find(c => c.id === cropId);
      if (crop && crop.cultivation) {
        const qmult = quality === 'legendary' ? 2 : quality === 'rare' ? 1.6 : quality === 'fine' ? 1.3 : 1;
        let _gain = Math.round(crop.cultivation * (qty || 1) * qmult);
        if (cropId === 'ningqi_grass' && !GameState._firstNingqi) { GameState._firstNingqi = true; _gain += 30; }
        this.addExp(_gain, true);
      }
      const hq = qty || 1;
      ResourceSystem.add('soil', hq);
      if (Math.random() < Math.min(1, 0.6 * hq)) ResourceSystem.add('water', 1);
      if (Math.random() < Math.min(1, 0.25 * hq)) ResourceSystem.add('compost', 1);
      // v5.1 打造材料按作物映射产出（武器材料的唯一来源）
      const yields = CROP_MATERIALS[cropId];
      const gained = [];
      if (yields) {
        const qMult = quality === 'legendary' ? 1.5 : quality === 'rare' ? 1.2 : 1;
        for (let k = 0; k < hq; k++) {
          yields.forEach(([mid, prob, baseQty]) => {
            if (Math.random() < prob) {
              const n = Math.max(1, Math.round(baseQty * qMult));
              ResourceSystem.add(mid, n);
              const ex = gained.find(g => g.id === mid);
              if (ex) ex.n += n; else gained.push({ id: mid, n });
            }
          });
        }
      }
      this.checkUnlocks();
      return gained.map(g => `${(RESOURCES[g.id] || {}).icon || ''}${(RESOURCES[g.id] || {}).name || g.id}×${g.n}`);
    },
    getEquipped() { this.init(); return GameState.equippedSkills.slice(); },
    skillLevelOf(id) { return GameState.skillLevels[id] || 1; },
    equip(id) {
      this.init();
      if (!GameState.unlockedSkills.includes(id)) { showToast('技能尚未解锁', 'warning'); return; }
      const slots = this.slotCount();
      if (GameState.equippedSkills.includes(id)) {
        GameState.equippedSkills = GameState.equippedSkills.filter(x => x !== id);
      } else {
        if (GameState.equippedSkills.length >= slots) { showToast(`技能卡槽已满（${slots} 个）`, 'warning'); return; }
        GameState.equippedSkills.push(id);
      }
      if (window.Telemetry) Telemetry.track('skill_equip', { skillId: id, equipped: GameState.equippedSkills.includes(id) });
      SaveSystem.save();
    },
    // 技能解锁判定
    unlockMet(cond) {
      const gs = GameState, a = gs.archive, st = a.stats;
      const ach = (window.AchievementSystem && gs.achievements && gs.achievements.stats) ? gs.achievements.stats : {};
      switch (cond.type) {
        case 'default': return true;
        case 'level': return gs.level >= cond.value;
        case 'extractTier': return (st.tierExtracts[cond.value] || 0) >= 1;
        case 'perfectDodge': return (st.perfectDodgeTotal || ach.perfectDodges || 0) >= cond.value;
        case 'harvest': return (gs.harvestCount[cond.crop] || 0) >= cond.value;
        case 'weaponLevel': {
          const w = (gs.weaponInstances || []).find(x => x.weaponId === cond.weapon);
          return w && w.level >= cond.value;
        }
        case 'consecTier': return (st.tierConsec[cond.tier] || 0) >= cond.value;
        case 'killElite': return !!(a.elites[cond.value]);
        case 'signalExtract': return (st.signalExtracts || 0) >= cond.value;
        case 'greenhouse': return (gs.greenhouse && gs.greenhouse.unlockedPlants || []).length >= cond.value;
        case 'tech': {
          const pts = gs.techPoints != null ? gs.techPoints : (window.TechSystem && TechSystem.getUsedPoints ? TechSystem.getUsedPoints() : 0);
          return pts >= cond.value;
        }
        case 'killBoss': return !!a.bosses[cond.value];
        case 'archives': return Object.keys(a.claimed || {}).length >= cond.value;
        default: return false;
      }
    },
    checkUnlocks() {
      this.init();
      SKILLS.forEach(s => {
        const cond = SKILL_UNLOCK[s.id];
        if (!GameState.unlockedSkills.includes(s.id) && cond && this.unlockMet(cond)) {
          GameState.unlockedSkills.push(s.id);
          GameState.skillLevels[s.id] = 1;
          if (window.Telemetry) Telemetry.track('skill_unlock', { skillId: s.id });
          showToast(`解锁新技能：${s.name}！可在修行台装备`, 'gold');
        }
      });
    },
    unlockHint(id) {
      const cond = SKILL_UNLOCK[id];
      if (!cond) return '';
      const map = {
        default: '初始解锁', level: `角色 Lv${cond.value}`, extractTier: `首次撤离 T${cond.value}`,
        perfectDodge: `完美闪避 ${cond.value} 次`, harvest: `收获辣椒 ${cond.value} 株`,
        weaponLevel: '豌豆连弩锻造 +5', consecTier: `T${cond.tier} 连续撤离 ${cond.value} 次`,
        killElite: '击杀狂暴野猪王', signalExtract: `信号弹撤离 ${cond.value} 次`,
        greenhouse: `温室解锁 ${cond.value} 种植物`, tech: `农业科技投入 ${cond.value} 点`,
        killBoss: '击杀废墟魔像', archives: `点亮 ${cond.value} 份档案`,
      };
      return map[cond.type] || '未知条件';
    },
    demote() {
      // 免死令优先
      if (typeof Warehouse !== 'undefined' && Warehouse.getCount('death_pardon') >= 1) {
        Warehouse.removeItem('death_pardon', 1);
        showToast('免死令生效，境界得以保全！', 'gold');
        return 'pardoned';
      }
      if (Math.random() < 0.5 && GameState.level > 1) {
        GameState.level -= 1;
        GameState.cultivation = 0;
        showToast('阵亡反噬，境界跌落 1 级！', 'warning');
        return 'demoted';
      }
      return 'safe';
    },
  };

  // ============================================================
  //  ResourceSystem（资源查询/支付，仓库即权威存储）
  // ============================================================
  const ResourceSystem = window.ResourceSystem = {
    key(id) {
      // 新资源统一存在 warehouse.materials（具体资源背包），消耗品/道具走 Warehouse 通用计数
      if (RESOURCES[id]) return { bucket: 'materials', id };
      return { bucket: 'items', id };
    },
    count(id) {
      const gs = GameState;
      if (id === 'gold') return gs.gold || 0;
      const wh = gs.warehouse || {};
      if (RESOURCES[id]) return (wh.materials && wh.materials[id]) || 0;
      return Warehouse.getCount ? Warehouse.getCount(id) : ((wh.items && wh.items[id]) || 0);
    },
    has(id, n) { return this.count(id) >= n; },
    add(id, n) {
      if (RESOURCES[id]) {
        GameState.warehouse.materials = GameState.warehouse.materials || {};
        GameState.warehouse.materials[id] = (GameState.warehouse.materials[id] || 0) + n;
      } else if (typeof Warehouse !== 'undefined') Warehouse.addItem(id, n);
    },
    pay(cost) {
      for (const k in cost) {
        if (k === 'gold') { if ((GameState.gold || 0) < cost[k]) return false; }
        else if (this.count(k) < cost[k]) return false;
      }
      for (const k in cost) {
        if (k === 'gold') GameState.gold -= cost[k];
        else if (RESOURCES[k]) GameState.warehouse.materials[k] -= cost[k];
        else if (typeof Warehouse !== 'undefined') Warehouse.removeItem(k, cost[k]);
      }
      return true;
    },
    seedStarting() {
      const gs = GameState;
      gs.warehouse = gs.warehouse || {};
      gs.warehouse.materials = gs.warehouse.materials || {};
      const m = gs.warehouse.materials;
      ['soil', 'water', 'compost', 'stone', 'fiber', 'venom', 'carapace', 'soul_ash', 'refined_iron'].forEach(k => { if (m[k] == null) m[k] = 0; });
      if (!gs._v5starter) {
        gs._v5starter = true;
        m.soil += 40; m.water += 30; m.compost += 15;
      }
    },
  };

  // ============================================================
  //  ArchiveSystem（远征档案）
  // ============================================================
  const ArchiveSystem = window.ArchiveSystem = {
    isMet(a) {
      const st = GameState.archive.stats, b = GameState.archive.bosses, maps = GameState.archive.maps, claimed = GameState.archive.claimed;
      switch (a.id) {
        case 'brk20': return (st.tierConsec[1] || 0) >= 3;
        case 'brk40': return !!st.t2Survive10;
        case 'brk60': return (st.tierConsec[3] || 0) >= 2;
        case 'brk80': return (st.t3BossKilled || 0) >= 1;
        case 'brk100': return st.bossTypes >= 12;
        case 'signal5': return (st.signalExtracts || 0) >= 5;
        case 'extract10': return (st.totalExtracts || 0) >= 10;
        case 'extract30': return (st.totalExtracts || 0) >= 30;
        case 'extract100': return (st.totalExtracts || 0) >= 100;
        case 'perfect10': return (st.bestPerfectDodge || 0) >= 10;
        case 'combo50': return (st.bestCombo || 0) >= 50;
        case 'chest6': return (st.bestChests || 0) >= 6;
        case 'plant5': return (st.bestPlants || 0) >= 5;
        case 'speedT3': return !!st.speedT3;
        case 'kill60': return (st.bestKills || 0) >= 60;
        case 'lowHpT4': return !!st.lowHpT4;
        case 'loot5000': return (st.bestLootValue || 0) >= 5000;
        case 'noHitT2': return !!st.noHitT2;
        case 'nightmare': return !!st.nightmareClear;
        case 'bossHunter': return st.bossTypes >= 6;
        case 'explorer': return st.mapsCleared >= 24;
        case 'scythe12': return Object.keys(claimed).length >= 12;
        default: return false;
      }
    },
    claimable() { try { return ARCHIVES.some(a => this.isMet(a) && !GameState.archive.claimed[a.id]); } catch (e) { return false; } },
    claim(id) {
      CharacterSystem.init();
      const a = ARCHIVES.find(x => x.id === id);
      if (!a) return;
      const rec = GameState.archive;
      if (rec.claimed[id]) { showToast('该档案已领取奖励', 'warning'); return; }
      if (!this.isMet(a)) { showToast('档案条件尚未达成', 'warning'); return; }
      rec.claimed[id] = true;
      if (window.Telemetry) Telemetry.track('archive_claim', { archiveId: id });
      const r = a.reward || {};
      if (r.cult) CharacterSystem.addExp(r.cult, true);
      if (r.pardon) Warehouse.addItem('death_pardon', r.pardon);
      if (r.safe) { GameState.safeSlots = Math.min(3, (GameState.safeSlots || 1) + r.safe); }
      if (r.rareSeed) Warehouse.addItem('seeds', 3 * r.rareSeed);
      if (r.legendarySeed) { GameState.legendarySeeds = (GameState.legendarySeeds || 0) + r.legendarySeed; }
      if (r.blueprint) { GameState.blueprints = (GameState.blueprints || 0) + r.blueprint; }
      if (r.unlockSkill && !GameState.unlockedSkills.includes(r.unlockSkill)) {
        GameState.unlockedSkills.push(r.unlockSkill); GameState.skillLevels[r.unlockSkill] = 1;
      }
      CharacterSystem.checkUnlocks();
      SaveSystem.save();
      showToast(`档案「${a.name}」奖励已领取`, 'gold');
    },
  };

  // ============================================================
  //  CodexSystem（全量图鉴，6 分页）
  // ============================================================
  const CodexSystem = window.CodexSystem = {
    mark(kind, id) {
      const gs = GameState;
      gs.codexSeen = gs.codexSeen || {};
      const bucket = gs.codexSeen[kind] || (gs.codexSeen[kind] = {});
      if (!bucket[id]) {
        bucket[id] = true;
        if (window.Telemetry) Telemetry.track('codex_discover', { kind, id: String(id) });
      }
    },
    discovered(kind, id) {
      const gs = GameState;
      if (kind === 'crop') return (gs.unlockedCrops || []).includes(id) || (gs.harvestCount && gs.harvestCount[id]);
      if (kind === 'boss') return !!(gs.archive && gs.archive.bosses[id]);
      if (kind === 'monster') return true; // 怪物基础全可见，精英/Boss 另算
      return true;
    },
  };

  // ============================================================
  //  远征内：技能/伤害/状态 引擎
  // ============================================================
  const E = Expedition.prototype;

  // 武器伤害（含角色基础攻击力、作物/临时增益）
  E.rollWeaponDamage = function (w) {
    const b = this.player.baseAtk != null ? this.player.baseAtk : 12;
    let raw = w.damage * (1 + b / 50) + b * 0.2;
    raw *= (1 + this.attackBuffMult);
    raw *= (this.v5 ? this.v5.tempAtkMul : 1) || 1;
    return raw;
  };
  // 技能伤害（技能威力 + 基础攻击加成 + 临时增益）
  E.rollSkillDamage = function (skillDmg) {
    const b = this.player.baseAtk != null ? this.player.baseAtk : 12;
    let raw = skillDmg * (1 + b / 70) + b * 0.3;
    raw *= (this.v5 ? this.v5.tempAtkMul : 1) || 1;
    return raw;
  };
  E.playerDefMitigation = function () {
    const def = this.player.def != null ? this.player.def : 0;
    return def / (def + 150);
  };

  function aim(exp) {
    const wmx = exp.mouse.x + exp.camera.x, wmy = exp.mouse.y + exp.camera.y;
    return { x: wmx, y: wmy, angle: Math.atan2(wmy - exp.player.y, wmx - exp.player.x) };
  }
  function enemies(exp) { return [...exp.monsters, ...exp.raiders]; }
  function fireProjectile(exp, x, y, angle, speed, damage, opt) {
    const p = exp.allocProjectile ? exp.allocProjectile() : {};
    Object.assign(p, {
      x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      damage, life: (opt && opt.life) || 1.2, radius: (opt && opt.radius) || 7,
      fromPlayer: true, pierce: (opt && opt.pierce) || 1, color: (opt && opt.color) || '#bfe9ff',
    }, opt || {});
    p.hit = p.hit || []; p.hit.length = 0;
    exp.projectiles.push(p);
    return p;
  }

  // 覆写 useSkill —— 16 技能数据驱动
  E.useSkill = function (idx) {
    CharacterSystem.init();
    const equipped = this.equippedSkills || CharacterSystem.getEquipped();
    const id = equipped[idx];
    if (!id) return;
    if ((this.skillCooldowns[idx] || 0) > 0) return;
    const base = SKILLS.find(s => s.id === id);
    if (!base) return;
    const extra = this.skillBoosts[id] || 0;
    const skill = window.getSkillStats(base, extra);
    if (this.player.energy < skill.energyCost) { showToast('能量不足', 'warning'); return; }
    this.player.energy -= skill.energyCost;
    this.skillCooldowns[idx] = skill.cooldown;
    this.skillFlashes[idx] = 0.28;
    if (window.AudioManager) AudioManager.playSkill(id);
    const p = this.player, a = aim(this), dmg = this.rollSkillDamage(skill.dmg || 0);
    this.v5 = this.v5 || { zones: [], channels: [], traps: [], totems: [], tempAtkMul: 1, tempMoveMul: 1, shield: 0, iron: 0, rage: 0, drum: 0 };

    switch (base.kind) {
      case 'aoe':
        enemies(this).forEach(m => { if (dist(m, p) < skill.range) { this.damageEnemy(m, dmg, base.color, true, { x: m.x, y: m.y, angle: a.angle, weaponId: '', fromPlayer: true }); m.stunned = Math.max(m.stunned || 0, skill.stunDuration); } });
        this.spawnAoeEffect(p.x, p.y, skill.range, base.color, 'ring'); this.spawnRadialBurst(p.x, p.y, '#fff0a6', 12); this.spawnShockRing(p.x, p.y, '#ffe9a0', skill.range * 0.8);
        break;
      case 'root':
        enemies(this).forEach(m => { if (dist(m, p) < skill.range) { m.stunned = skill.stunDuration; this.damageEnemy(m, dmg, base.color, false, { x: m.x, y: m.y, fromPlayer: true, quiet: true }); this.spawnHitParticles(m.x, m.y, '#55aa55'); } });
        this.spawnVineEffect(p.x, p.y, skill.range);
        break;
      case 'dash':
        p.x += Math.cos(a.angle) * skill.dashDistance; p.y += Math.sin(a.angle) * skill.dashDistance;
        p.invuln = skill.invulnDuration; p.visualVz = 125; this.spawnDashParticles(p.x, p.y, a.angle); this.spawnDashTrail(p.x, p.y, a.angle, '#a6e7ff');
        break;
      case 'stealth':
        p.stealth = skill.stealthDuration; this.spawnSmokeEffect(p.x, p.y); showToast('进入隐身状态', 'success');
        break;
      case 'cone': {
        enemies(this).forEach(m => {
          const ang = Math.atan2(m.y - p.y, m.x - p.x);
          let diff = Math.abs(((ang - a.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          if (diff < skill.cone && dist(m, p) < skill.range) { this.damageEnemy(m, dmg, base.color, true, { x: m.x, y: m.y, angle: ang, fromPlayer: true }); this.applyBurn(m, skill.burn, skill.burnDur); }
        });
        this.spawnRadialBurst(p.x + Math.cos(a.angle) * 40, p.y + Math.sin(a.angle) * 40, '#ff8a4a', 18);
        this.spawnShockRing(p.x, p.y, '#ff6a3c', skill.range * 0.6);
        break;
      }
      case 'channel_peas':
        this.v5.channels.push({ kind: 'peas', t: skill.duration, fire: 0, color: base.color, dmg });
        showToast('豌豆风暴！', 'success');
        break;
      case 'frost':
        this.v5.shield = Math.max(this.v5.shield, skill.shield); this.v5.frost = skill.duration; this.v5.frostRange = skill.range; this.v5.frostSlow = skill.slow;
        this.spawnAoeEffect(p.x, p.y, 70, '#7fd4ff', 'ring'); showToast('寒冰屏障展开', 'success');
        break;
      case 'thorns':
        this.v5.thorns = skill.duration; this.v5.thornsRange = skill.range; this.v5.thornsDps = this.rollSkillDamage(skill.thornsDps); this.v5.reflect = skill.reflect;
        this.spawnAoeEffect(p.x, p.y, skill.range, '#8fd14f', 'ring'); showToast('荆棘反伤展开', 'success');
        break;
      case 'slam': {
        const z = { kind: 'slam', x: a.x, y: a.y, t: 0.12, radius: skill.radius, dmg, stun: skill.stun, color: base.color };
        this.v5.zones.push(z);
        this.spawnAoeEffect(a.x, a.y, skill.radius, base.color, 'ring'); this.screenShake = Math.min(1, this.screenShake + 0.5);
        break;
      }
      case 'gale':
        p.x += Math.cos(a.angle) * skill.dash; p.y += Math.sin(a.angle) * skill.dash; p.invuln = 0.4;
        for (let i = 0; i < skill.blades; i++) { const ba = a.angle + (i - (skill.blades - 1) / 2) * 0.35; fireProjectile(this, p.x, p.y, ba, 520, dmg, { pierce: 3, color: base.color, radius: 9, life: 0.8 }); }
        this.spawnDashTrail(p.x, p.y, a.angle, '#bfe9ff');
        break;
      case 'heal':
        this.v5.zones.push({ kind: 'heal', x: p.x, y: p.y, follow: true, t: skill.duration, tick: 0.5, range: skill.range, hot: this.rollSkillDamage(skill.hot), color: base.color });
        this.spawnAoeEffect(p.x, p.y, skill.range, '#8be9a0', 'ring');
        break;
      case 'drum':
        this.v5.drum = skill.duration; this.v5.tempAtkMul = 1 + skill.atkSpd; this.v5.tempMoveMul = 1 + skill.moveSpd;
        this.spawnRadialBurst(p.x, p.y, '#ffcf5a', 16); showToast('骄阳战鼓：攻速/移速提升！', 'success');
        break;
      case 'poison':
        this.v5.zones.push({ kind: 'poison', x: a.x, y: a.y, t: skill.duration, tick: 0.5, radius: skill.radius, dot: this.rollSkillDamage(skill.dot), color: base.color, blind: true });
        this.spawnAoeEffect(a.x, a.y, skill.radius, '#9be86b', 'ring');
        break;
      case 'armor':
        this.v5.iron = skill.duration; this.v5.ironReduce = skill.reduce; p.ironBody = skill.duration;
        this.spawnAoeEffect(p.x, p.y, 60, '#c8b089', 'ring'); showToast('金刚藤甲：减伤 50%，霸体！', 'success');
        break;
      case 'chain': {
        let from = p, hit = new Set(), range = skill.jumpRange;
        for (let j = 0; j < skill.jumps; j++) {
          const cand = enemies(this).filter(m => !hit.has(m) && m.hp > 0 && dist(m, from) < (j === 0 ? skill.range : range));
          if (!cand.length) break;
          cand.sort((u, v) => dist(u, from) - dist(v, from));
          const tgt = cand[0]; hit.add(tgt);
          this.spawnChainLightning ? this.spawnChainLightning(from.x, from.y, tgt.x, tgt.y) : this.spawnRadialBurst(tgt.x, tgt.y, '#ffe46b', 8);
          this.damageEnemy(tgt, dmg, '#ffe46b', true, { x: tgt.x, y: tgt.y, angle: 0, fromPlayer: true, quiet: true });
          tgt.stunned = Math.max(tgt.stunned || 0, 0.3);
          from = tgt;
        }
        break;
      }
      case 'channel_scythe':
        this.v5.channels.push({ kind: 'scythe', t: skill.duration, tick: 0, range: skill.range, dmg, color: base.color });
        p.invuln = 0.5; showToast('死神镰舞！', 'gold');
        break;
    }
  };

  // 包装 useConsumable，扩展新道具
  const _useConsumable = E.useConsumable;
  E.useConsumable = function (id) {
    const newIds = new Set(NEW_CONSUMABLES.map(c => c.id));
    if (!newIds.has(id)) return _useConsumable.call(this, id);
    if ((this.consumables[id] || 0) <= 0) { showToast('没有该道具', 'warning'); return; }
    const item = CONFIG.consumables.find(c => c.id === id);
    const p = this.player, a = aim(this);
    this.v5 = this.v5 || { zones: [], channels: [], traps: [], totems: [], tempAtkMul: 1, tempMoveMul: 1, shield: 0, iron: 0, rage: 0, drum: 0 };
    let used = true;
    switch (id) {
      case 'beartrap_item':
        this.v5.traps.push({ x: a.x, y: a.y, radius: 30, t: 30, armed: true, color: '#b0894f' });
        this.spawnAoeEffect(a.x, a.y, 26, '#b0894f', 'ring'); break;
      case 'war_horn':
        this.v5.totems.push({ x: p.x, y: p.y, radius: 130, t: 12, color: '#ffcf5a' }); break;
      case 'scout_eagle':
        this.v5.scout = 8; this._visionBase = this._visionBase || this.visionRadius; this.visionRadius = this._visionBase * 1.9; this.fogDirty = true;
        showToast('侦察鹰展开视野！', 'success'); break;
      case 'purify_tonic':
        p.slow = 0; p.stunned = 0; p.poisoned = 0; this.spawnAoeEffect(p.x, p.y, 60, '#bfefff', 'ring'); break;
      case 'rage_tonic':
        this.v5.rage = 8; this.v5.tempAtkMul = 1.5; showToast('狂暴：伤害 +50%！', 'warning'); break;
      case 'shield_gen':
        this.v5.shield = Math.max(this.v5.shield, 120); this.v5.shieldT = 10; this.spawnAoeEffect(p.x, p.y, 70, '#7fd4ff', 'ring'); break;
      case 'rotting_bait':
        this.v5.zones.push({ kind: 'bait', x: a.x, y: a.y, t: 8, radius: 220, color: '#c98a4b' });
        enemies(this).forEach(m => { m.target = { x: a.x, y: a.y, isBait: true }; m.luredUntil = performance.now() + 8000; });
        break;
      case 'med_shot':
        p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.5); this.spawnAoeEffect(p.x, p.y, 70, '#ff66aa', 'ring'); break;
      case 'shield_elixir':
        this.v5.shield = Math.max(this.v5.shield, 150); this.spawnAoeEffect(p.x, p.y, 70, '#9fe8ff', 'ring'); showToast('冰心护盾 +150', 'success'); break;
      case 'flame_elixir':
        this.v5.flame = 12; this.v5.tempAtkMul = Math.max(this.v5.tempAtkMul, 1.2); p.poisoned = 0; showToast('赤炎之力：12 秒攻击 +20%', 'success'); break;
      case 'wraith_draft':
        p.stealth = Math.max(p.stealth || 0, 5); this.spawnAoeEffect(p.x, p.y, 60, '#b18cff', 'ring'); showToast('幽魂附身，隐身 5 秒', 'success'); break;
      case 'energy_cell':
        p.energy = p.maxEnergy; this.spawnAoeEffect(p.x, p.y, 60, '#7fd0ff', 'ring'); break;
      case 'grape_juice':
        this.v5.grape = 15; showToast('葡萄能量饮：15 秒能量回复翻倍', 'success'); break;
      case 'bread':
        p.hp = Math.min(p.maxHp, p.hp + 80); this.spawnAoeEffect(p.x, p.y, 55, '#ffd98a', 'ring'); break;
      case 'medkit':
        p.hp = Math.min(p.maxHp, p.hp + 200); this.spawnAoeEffect(p.x, p.y, 80, '#ff8a8a', 'ring'); break;
      case 'ketchup':
        p.hp = Math.min(p.maxHp, p.hp + 150); this.spawnAoeEffect(p.x, p.y, 65, '#ff6b4a', 'ring'); break;
      case 'juice':
        if (!this.v5.juice) { this.v5.juice = true; p.maxHp = p.maxHp; p.maxEnergy = (p.maxEnergy || 100) + 40; }
        p.energy = p.maxEnergy; this.spawnAoeEffect(p.x, p.y, 60, '#8affd0', 'ring'); break;
      case 'egg':
        this.v5.egg = 120; this.v5.tempAtkMul = Math.max(this.v5.tempAtkMul, 1.15); showToast('荒野鸡蛋：攻击 +15%', 'success'); break;
      case 'mint_tea':
        this.v5.mint = 60; this.v5.tempMoveMul = 1.15; showToast('薄荷茶：移速 +15%', 'success'); break;
      case 'ginseng_soup':
        p.hp = p.maxHp; this.v5.ginseng = 60; this.v5.tempAtkMul = Math.max(this.v5.tempAtkMul, 1.2); this.spawnAoeEffect(p.x, p.y, 90, '#ffe28a', 'ring'); break;
      case 'torch':
        // v5.5 火把统一为燃料照明系统：消耗一支、续燃 60 秒（难度越高越短），无火把视野极小
        if (typeof CombatEnhancement !== 'undefined' && CombatEnhancement.useTorchItem) { CombatEnhancement.useTorchItem(); used = false; }
        else { this.v5.torch = 60; showToast('火把点亮：视野 +25%', 'success'); }
        break;
      case 'poison_bomb': {
        enemies(this).forEach(m => { const d = Math.hypot(m.x - a.x, m.y - a.y); if (d < 130) { this_damage(this, m, 60, '#9b59ff', true); m.slow = Math.max(m.slow || 0, 3); } });
        this.spawnAoeEffect(a.x, a.y, 130, '#9b59ff', 'ring'); break; }
      case 'insecticide':
        this.v5.repel = 6;
        enemies(this).forEach(m => { m.target = null; if (m.luredUntil) m.luredUntil = 0; });
        this.spawnAoeEffect(p.x, p.y, 120, '#9be86b', 'ring'); showToast('驱虫剂：怪物丢失目标 6 秒', 'success'); break;
      case 'death_pardon':
        showToast('免死令为被动道具，阵亡时自动生效', 'warning'); used = false; break;
    }
    if (used) {
      this.consumables[id]--;
      this.consumableFlashes[id] = 0.3;
      if (window.AudioManager) AudioManager.playConsumable(id);
    }
    this.updateHUD();
  };

  // 受伤结算（护盾/防御/藤甲/狂暴）
  V5.visionMul = function (exp) {
    const v = exp && exp.v5;
    if (!v) return 1;
    if ((v.scout || 0) > 0) return 1.9;
    if ((v.torch || 0) > 0) return 1.25;
    return 1;
  };

  V5.modifyIncomingDamage = function (exp, amount) {
    const v = exp.v5 || {};
    if (v.shield > 0) { const absorbed = Math.min(v.shield, amount); v.shield -= absorbed; amount -= absorbed; }
    amount *= (1 - exp.playerDefMitigation());
    if (v.iron > 0) amount *= (1 - (v.ironReduce || 0.5));
    if (v.rage > 0) amount *= 1.15;
    return amount;
  };

  // 每帧玩家侧 v5 状态（从 updateRunSystems 调用）
  V5.tick = function (exp, dt) {
    if (!exp.player) return;
    CharacterSystem.init();
    const p = exp.player;
    if (!exp.v5) exp.v5 = { zones: [], channels: [], traps: [], totems: [], tempAtkMul: 1, tempMoveMul: 1, shield: 0, iron: 0, rage: 0, drum: 0 };
    const v = exp.v5;

    // 脱战回血（脱战 5 秒）
    exp._lastCombat = exp._lastCombat || 0;
    const oc = (p.ocRegen || 0);
    if (oc > 0 && performance.now() / 1000 - exp._lastCombat > 5 && p.hp < p.maxHp) {
      p.hp = Math.min(p.maxHp, p.hp + oc * dt);
    }
    // 能量回复（角色成长）
    if (p.energy < p.maxEnergy) p.energy = Math.min(p.maxEnergy, p.energy + (p.energyRegen || 15) * dt * ((v.grape || 0) > 0 ? 2 : 1));

    // 计时状态
    ['iron', 'rage', 'drum', 'scout', 'frost', 'thorns', 'shieldT', 'flame', 'grape', 'torch', 'egg', 'mint', 'ginseng', 'repel'].forEach(k => { if (v[k] > 0) v[k] -= dt; });
    if ((v.repel || 0) > 0) { enemies(exp).forEach(m => { if (dist(m, p) < 320) { m.target = null; if (m.luredUntil) m.luredUntil = 0; } }); }
    if (v.drum <= 0) {
      v.tempAtkMul = Math.max((v.rage || 0) > 0 ? 1.5 : 1, (v.flame || 0) > 0 ? 1.2 : 1, (v.egg || 0) > 0 ? 1.15 : 1, (v.ginseng || 0) > 0 ? 1.2 : 1);
      v.tempMoveMul = (v.mint || 0) > 0 ? 1.15 : 1;
    }
    // 视野倍率由 world-fx / combat-enhancement 每帧合成（V5.visionMul），此处不直接写
    this.tickBoss(exp, dt);
    if (v.shieldT !== undefined && v.shieldT <= 0) v.shield = 0;

    // 引导技能
    for (let i = v.channels.length - 1; i >= 0; i--) {
      const ch = v.channels[i];
      ch.t -= dt;
      if (ch.kind === 'peas') {
        ch.fire = (ch.fire || 0) - dt;
        if (ch.fire <= 0) {
          ch.fire = 0.16;
          const tgt = enemies(exp).filter(m => m.hp > 0).sort((u, w) => dist(u, p) - dist(w, p))[0];
          const ang = tgt ? Math.atan2(tgt.y - p.y, tgt.x - p.x) : (exp.mouse ? aim(exp).angle : p.angle);
          fireProjectile(exp, p.x, p.y, ang + rand(-0.12, 0.12), 640, ch.dmg, { pierce: 1, color: ch.color, radius: 6, life: 1.0 });
        }
      } else if (ch.kind === 'scythe') {
        ch.tick -= dt;
        if (ch.tick <= 0) {
          ch.tick = 0.22;
          enemies(exp).forEach(m => { if (dist(m, p) < ch.range) this_damage(exp, m, ch.dmg * 0.35, ch.color); });
          exp.spawnRadialBurst(p.x, p.y, ch.color, 6);
        }
      }
      if (ch.t <= 0) v.channels.splice(i, 1);
    }

    // 区域效果
    for (let i = v.zones.length - 1; i >= 0; i--) {
      const z = v.zones[i];
      z.t -= dt;
      if (z.follow) { z.x = p.x; z.y = p.y; }
      z.tick = (z.tick || 0) - dt;
      if (z.kind === 'slam' && !z.done) {
        z.done = true;
        enemies(exp).forEach(m => { if (dist(m, z) < z.radius) { this_damage(exp, m, z.dmg, z.color, true); m.stunned = Math.max(m.stunned || 0, z.stun); } });
        exp.spawnRadialBurst(z.x, z.y, z.color, 22); exp.screenShake = Math.min(1, exp.screenShake + 0.4);
      } else if ((z.kind === 'poison') && z.tick <= 0) {
        z.tick = 0.5;
        enemies(exp).forEach(m => { if (dist(m, z) < z.radius) { this_damage(exp, m, z.dot, z.color, false, true); exp.applyBurn(m, z.dot, 1); if (z.blind) m.blindUntil = performance.now() + 600; } });
      } else if (z.kind === 'heal' && z.tick <= 0) {
        z.tick = 0.5;
        if (dist(p, z) < z.range) p.hp = Math.min(p.maxHp, p.hp + z.hot * 0.5);
        if (Math.random() < 0.5) exp.spawnRadialBurst(p.x, p.y, z.color, 3);
      } else if (z.kind === 'bait') {
        enemies(exp).forEach(m => { if (dist(m, z) < z.radius + 60) { m.target = { x: z.x, y: z.y, isBait: true }; } });
      }
      if (z.t <= 0) v.zones.splice(i, 1);
    }

    // 捕兽夹
    for (let i = v.traps.length - 1; i >= 0; i--) {
      const tr = v.traps[i];
      tr.t -= dt;
      if (tr.armed) {
        const m = enemies(exp).find(e => e.hp > 0 && dist(e, tr) < tr.radius + (e.radius || 16));
        if (m) { tr.armed = false; m.stunned = Math.max(m.stunned || 0, 3); exp.spawnRadialBurst(tr.x, tr.y, '#d9a066', 10); showToast('捕兽夹命中！', 'success'); }
      }
      if (tr.t <= 0) v.traps.splice(i, 1);
    }
    // 战吼图腾
    for (let i = v.totems.length - 1; i >= 0; i--) {
      const tt = v.totems[i]; tt.t -= dt;
      if (dist(p, tt) < tt.radius) v.tempAtkMul = Math.max(v.tempAtkMul, 1.4);
      if (tt.t <= 0) v.totems.splice(i, 1);
    }
    // 寒冰屏障光环
    if (v.frost > 0) enemies(exp).forEach(m => { if (dist(m, p) < v.frostRange) m.slow = Math.max(m.slow || 0, v.frostSlow); });
    // 荆棘光环
    if (v.thorns > 0) {
      enemies(exp).forEach(m => { if (dist(m, p) < v.thornsRange && m.hp > 0) { m._thornTick = (m._thornTick || 0) - dt; if (m._thornTick <= 0) { m._thornTick = 0.5; this_damage(exp, m, v.thornsDps * 0.5, '#8fd14f', false, true); } } });
    }

    // 新战场植物行为
    V5.tickPlants(exp, dt);
  };

  function this_damage(exp, m, amount, color, heavy, quiet) {
    exp.damageEnemy(m, amount, color || '#ffffff', !!heavy, { x: m.x, y: m.y, angle: 0, weaponId: '', fromPlayer: true, quiet: !!quiet });
  }

  V5.tickPlants = function (exp, dt) {
    (exp.plants || []).forEach(pl => {
      if (!pl || pl.hp <= 0 || pl.growTimer > 0) return;
      const def = CONFIG.deployPlants[pl.type];
      if (!def) return;
      pl._cd = (pl._cd || 0) - dt;
      const near = enemies(exp).filter(m => m.hp > 0 && dist(m, pl) < (def.radius || def.range || 60) + (m.radius || 16));
      switch (pl.type) {
        case 'spike_root':
          near.forEach(m => { m.bleedStack = (m.bleedStack || 0) + dt; this_damage(exp, m, (def.bleed || 6) * dt * 4, '#c0453a', false, true); });
          break;
        case 'poison_spore':
          if (pl._cd <= 0 && near.length) { pl._cd = def.cooldown; near.forEach(m => { exp.applyBurn(m, def.dot, 2); m.blindUntil = performance.now() + 1200; }); exp.spawnRadialBurst(pl.x, pl.y, def.color, 10); }
          break;
        case 'ice_cactus':
          near.forEach(m => { m.slow = Math.max(m.slow || 0, 0.3); if (Math.random() < dt * 0.25) m.stunned = Math.max(m.stunned || 0, 0.6); });
          break;
        case 'thunder_vine':
          if (pl._cd <= 0 && near.length) { pl._cd = def.cooldown; const t = near[Math.floor(Math.random() * near.length)]; exp.spawnRadialBurst(t.x, t.y, '#ffe46b', 12); this_damage(exp, t, def.dmg, '#ffe46b', true); }
          break;
        case 'purify_flower':
          if (pl._cd <= 0 && dist(exp.player, pl) < def.radius) { pl._cd = def.cooldown; exp.player.slow = 0; exp.player.poisoned = 0; exp.spawnRadialBurst(pl.x, pl.y, '#ffd6ec', 6); }
          break;
        case 'mirror_grass':
          near.forEach(m => { if (m.attackCd > 1.2 && Math.random() < dt) this_damage(exp, m, 4, '#bfefff', false, true); });
          break;
      }
    });
  };

  /* ----------------------------------------------------------
   *  怪物死亡 / 撤离 / 阵亡 钩子
   * -------------------------------------------------------- */
  // v5.1 武器打造材料改由农作物产出，远征只保留庄园资源（泥土/堆肥）
  const TYPE_RES = {
    treant: [['soil', 0.4]], withered_treant: [['soil', 0.5]],
    wolf: [['compost', 0.12]], boar: [['compost', 0.12]],
  };
  V5.onMonsterKilled = function (exp, m) {
    CharacterSystem.init();
    const rec = GameState.archive, st = rec.stats;
    // v5.1 记录尸体（供深渊领主复活），最多保留 8 具、60 秒内
    if (m.type !== 'boss') {
      exp._corpses = exp._corpses || [];
      exp._corpses.push({ x: m.x, y: m.y, type: m.type, t: performance.now() });
      if (exp._corpses.length > 8) exp._corpses.shift();
    }
    // Boss
    if (m.type === 'boss' && m.bossId) {
      if (!rec.bosses[m.bossId]) {
        rec.bosses[m.bossId] = true; st.bossTypes = Object.keys(rec.bosses).length;
        if (window.CodexSystem && CodexSystem.mark) CodexSystem.mark('boss', m.bossId);
      }
      if ((CONFIG.bosses[m.bossId] || {}).tier === 3) st.t3BossKilled = (st.t3BossKilled || 0) + 1;
      const cfg = CONFIG.bosses[m.bossId];
      // v5.1 Boss 不再掉落打造材料（材料改由农作物产出），改为金币秘藏
      exp.spawnGroundLoot({ type: 'gold', name: '首领秘藏', amount: randInt(40, 90) * (cfg.tier || 1), icon: '💰' }, m.x, m.y - 12);
      if (Math.random() < 0.35) exp.spawnGroundLoot({ type: 'consumable', name: '免死令', id: 'death_pardon', icon: '📜' }, m.x, m.y - 26);
    } else if (m.elite) {
      rec.elites[m.type] = (rec.elites[m.type] || 0) + 1;
    }
    // 具体资源掉落
    const table = TYPE_RES[m.type] || (m.type === 'boss' ? null : null);
    if (table) table.forEach(([rid, prob]) => {
      if (Math.random() < prob) exp.spawnGroundLoot({ type: 'material', name: RESOURCES[rid].name, icon: RESOURCES[rid].icon, matId: rid, amount: randInt(1, 2) }, m.x + rand(-14, 14), m.y + rand(-14, 14));
    });
    // 完美闪避总数
    if (exp.runStats) st.perfectDodgeTotal = Math.max(st.perfectDodgeTotal || 0, exp.runStats.perfectDodgeCount || 0);
    CharacterSystem.checkUnlocks();
  };

  V5.onExtractSuccess = function (exp) {
    CharacterSystem.init();
    const rec = GameState.archive, st = rec.stats, map = exp.map, tier = map.tier;
    const first = !rec.maps[map.id];
    if (first) { rec.maps[map.id] = true; st.mapsCleared = Object.keys(rec.maps).length; }
    st.totalExtracts = (st.totalExtracts || 0) + 1;
    st.tierExtracts[tier] = (st.tierExtracts[tier] || 0) + 1;
    st.tierConsec[tier] = (st.tierConsec[tier] || 0) + 1;
    if (exp.extractType === 'signal') st.signalExtracts = (st.signalExtracts || 0) + 1;
    if (tier === 2 && exp.elapsed >= 600) st.t2Survive10 = true;
    if (exp.damageTaken <= 0 && tier >= 2) st.noHitT2 = true;
    if (tier >= 3 && exp.elapsed <= 300) st.speedT3 = true;
    if (tier >= 4 && exp.runStats && exp.runStats.minHpSeen < 10) st.lowHpT4 = true; // 最低血量低于10%通关
    if ((GameState.difficulty || 'normal') === 'nightmare') st.nightmareClear = true;
    st.bestKills = Math.max(st.bestKills || 0, exp.killCount || 0);
    st.bestChests = Math.max(st.bestChests || 0, exp.chestOpened || 0);
    st.bestCombo = Math.max(st.bestCombo || 0, (exp.runStats && exp.runStats.maxCombo) || 0);
    st.bestPerfectDodge = Math.max(st.bestPerfectDodge || 0, (exp.runStats && exp.runStats.perfectDodgeCount) || 0);
    st.bestPlants = Math.max(st.bestPlants || 0, (exp.runStats && exp.runStats.plantsDeployed) || 0);
    const lootVal = exp.bag.reduce((s, it) => s + (exp.getLootValue ? exp.getLootValue(it) : 0), 0);
    st.bestLootValue = Math.max(st.bestLootValue || 0, Math.round(lootVal));
    // 修为：首通丰厚，重复少量（约占总修为 10%）
    const cult = first ? 120 * tier : 30 * tier;
    CharacterSystem.addExp(cult, true);
    if (first) showToast(`首次撤离 ${map.name}！修为 +${cult}`, 'gold');
    CharacterSystem.checkUnlocks();
    try { SaveSystem.save(); } catch (e) {}
  };

  V5.onPlayerDeath = function (exp) {
    CharacterSystem.init();
    const tier = exp.map ? exp.map.tier : 1;
    GameState.archive.stats.tierConsec[tier] = 0;
    CharacterSystem.demote();
    try { SaveSystem.save(); } catch (e) {}
  };

  /* ----------------------------------------------------------
   *  地图怪物池 / Boss 生成（供 terrain 调用）
   * -------------------------------------------------------- */
  V5.pickMonsterType = function (map) {
    const pool = [];
    (map.monsterPool || []).forEach(([id, w]) => { for (let i = 0; i < Math.round(w * 4); i++) pool.push(id); });
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  };
  /* ============================================================
   * v5.1 Boss 差异化战斗：12 只 Boss 各有独立技能状态机
   * 状态：idle（通用AI近战/风筝）→ windup_*（前摇预警）→ cast/charge → stagger → idle
   * ============================================================ */
  const BOSS_TRAPS = {
    root:   { type: 'root',      name: '缠绕树根', icon: '🌿', color: '#6f8f4e', radius: 42, damage: 8,  cooldown: 2.2, slow: 1.4, root: 1.4, life: 12 },
    poison: { type: 'poison',    name: '剧毒沼泽', icon: '☠️', color: '#8bd34a', radius: 54, damage: 10, cooldown: 1.6, slow: 0.5, life: 14 },
    web:    { type: 'bear',      name: '蛛网',     icon: '🕸️', color: '#e8e2f5', radius: 48, damage: 0,  cooldown: 3,   slow: 3,   life: 10 },
    fire:   { type: 'lightning', name: '火雨',     icon: '🔥', color: '#ff7a2e', radius: 50, damage: 26, cooldown: 5,  slow: 0.3, life: 6 },
  };

  const bFace = (exp, b) => { b.facing = Math.atan2(exp.player.y - b.y, exp.player.x - b.x); };
  const bRage = b => b.hp / b.maxHp < 0.5;
  function bToIdle(exp, b, min, max) { b.castState = 'idle'; b.ai.cd = rand(min, max); }
  function bBegin(b, state, dur) { b.castState = state; b.castTimer = dur; }
  function bToast(exp, b, msg) { showToast(`「${b.name}」${msg}`, 'warning'); }
  function bSetWeather(exp, state, dur) {
    if (!exp.fxWeather) return;
    exp.fxWeather.state = state;
    exp.fxWeather.timer = dur;
    const name = { rain: '下起了雨', storm: '雷暴来袭', fog: '雾气弥漫', clear: '天气放晴' }[state];
    if (name) showToast(name, 'warning');
  }
  // 延迟范围打击（预警圈 → 爆炸）
  function bHazard(exp, h) {
    exp.bossHazards = exp.bossHazards || [];
    const full = Object.assign({ x: exp.player.x, y: exp.player.y, r: 70, delay: 1.0, dmg: 20, color: '#ff6a3c', icon: '💥', slow: 0, root: 0 }, h);
    full.t = full.delay;
    exp.bossHazards.push(full);
  }
  V5.updateBossHazards = function (exp, dt) {
    if (!exp.bossHazards) return;
    for (let i = exp.bossHazards.length - 1; i >= 0; i--) {
      const h = exp.bossHazards[i];
      h.t -= dt;
      if (h.t <= 0) {
        exp.spawnAoeEffect(h.x, h.y, h.r, h.color);
        exp.spawnShockRing(h.x, h.y, h.color, h.r);
        if (dist(exp.player, { x: h.x, y: h.y }) < h.r + (exp.player.collisionRadius || 11)) {
          if (exp.player.invuln <= 0) {
            exp.damagePlayer(h.dmg);
            if (h.slow) exp.player.slow = Math.max(exp.player.slow, h.slow);
            if (h.root) exp.player.root = Math.max(exp.player.root || 0, h.root);
          }
        }
        exp.bossHazards.splice(i, 1);
      }
    }
  };
  // Boss 投放限时陷阱
  function bTrap(exp, key, x, y, delay) {
    const tpl = BOSS_TRAPS[key];
    const size = CONFIG.expedition.mapSize;
    x = clamp(x, 40, size - 40); y = clamp(y, 40, size - 40);
    exp.traps.push(Object.assign({}, tpl, { x, y, phase: rand(0, 6), triggerCd: delay == null ? 0.9 : delay }));
    exp.spawnAoeEffect(x, y, tpl.radius, tpl.color);
  }
  // Boss 召唤小怪
  function bAdd(exp, type, x, y, hpScale, color, opts) {
    const data = CONFIG.monsters[type];
    if (!data) return;
    const size = CONFIG.expedition.mapSize;
    x = clamp(x, 50, size - 50); y = clamp(y, 50, size - 50);
    exp.monsters.push({
      type, ...data, x, y,
      hp: Math.round(data.hp * exp.balance.enemyHp * hpScale), maxHp: Math.round(data.hp * exp.balance.enemyHp * hpScale),
      damage: Math.max(2, Math.round(data.damage * exp.balance.enemyDamage * 0.8)),
      speed: data.speed * exp.balance.enemySpeed,
      attackCd: rand(0.5, 2), stunned: 0, facing: 0, animTime: 0, hitFlash: 0,
      elite: false, abilityCd: rand(1, 3), packOffset: 0, state: 'idle', stateTimer: 0,
      v5add: true, risen: !!(opts && opts.risen),
    });
    exp.spawnAoeEffect(x, y, 40, color || '#c08aff');
    exp.spawnRadialBurst(x, y, color || '#c08aff', 12);
  }
  const bAddCount = exp => exp.monsters.filter(m => m.v5add).length;
  // v5.1 Boss 发射敌方弹幕（allocProjectile 只做对象池取用，必须 assign 后 push 才会真正生成）
  function bShot(exp, b, a, speed, dmgMul, color, opt) {
    const p = exp.allocProjectile();
    Object.assign(p, {
      x: b.x, y: b.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      damage: b.damage * dmgMul,
      life: (opt && opt.life) || 4.5, radius: (opt && opt.radius) || 7,
      fromPlayer: false, pierce: 1, color,
    }, opt || {});
    p.hit = p.hit || []; p.hit.length = 0;
    exp.projectiles.push(p);
    return p;
  }
  function bRing(exp, b, color, n, speed, dmgMul) {
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + rand(-0.05, 0.05);
      bShot(exp, b, a, speed, dmgMul, color, { life: 4.5, radius: 7 });
    }
  }
  // 冲锋推进（windup_charge → charge → stagger），返回 true 表示仍在冲锋流程
  function bChargeFlow(exp, b, dt, opt) {
    b.castTimer -= dt;
    if (b.castState === 'windup_charge') {
      bFace(exp, b);
      if (Math.floor(b.castTimer * 6) !== b.ai._tick) { b.ai._tick = Math.floor(b.castTimer * 6); exp.spawnAoeEffect(b.x + Math.cos(b.facing) * 46, b.y + Math.sin(b.facing) * 46, 34, opt.color); }
      if (b.castTimer <= 0) { bBegin(b, 'charge', opt.dur); b.ai.hit = false; b.ai.chargeCx = Math.cos(b.facing); b.ai.chargeCy = Math.sin(b.facing); exp.spawnShockRing(b.x, b.y, opt.color, 56); }
    } else if (b.castState === 'charge') {
      const sp = opt.speed;
      const ox = b.x, oy = b.y;
      exp.moveEntityWithCollisions(b, b.ai.chargeCx * sp * dt, b.ai.chargeCy * sp * dt);
      const moved = Math.hypot(b.x - ox, b.y - oy);
      b.facing = Math.atan2(b.ai.chargeCy, b.ai.chargeCx);
      if (moved < sp * dt * 0.35) { exp.spawnImpact(b.x, b.y, opt.color, 1.3); bBegin(b, 'stagger', opt.stagger || 0.9); }
      else if (!b.ai.hit && dist(exp.player, b) < b.radius + (exp.player.collisionRadius || 11) + 8) {
        b.ai.hit = true;
        exp.damagePlayer(b.damage * opt.dmgMul);
        exp.player.hitStun = Math.max(exp.player.hitStun || 0, 0.3);
        exp.player.slow = Math.max(exp.player.slow, 0.8);
        exp.spawnImpact(exp.player.x, exp.player.y, opt.color, 1.3);
      }
      if (b.castTimer <= 0) bBegin(b, 'stagger', opt.stagger || 0.9);
    } else if (b.castState === 'stagger') {
      if (b.castTimer <= 0) { if (!opt.keepStagger) bToIdle(exp, b, opt.cdMin, opt.cdMax); }
    }
    return b.castState !== 'idle';
  }

  // ---------- T1-1 狂暴野猪王：震荡波 + 锁定冲锋 ----------
  function h_boar(exp, b, dt) {
    const rg = bRage(b);
    if (b.castState === 'idle') {
      b.ai.cd -= dt;
      if (b.ai.cd <= 0) {
        b.ai.skill = ((b.ai.skill || 0) + 1) % 2;
        bFace(exp, b);
        if (b.ai.skill === 0) { bBegin(b, 'h_shock', 0.65); exp.spawnAoeEffect(exp.player.x, exp.player.y, rg ? 108 : 90, '#d59aff'); }
        else { bBegin(b, 'windup_charge', rg ? 0.55 : 0.7); bToast(exp, b, '蓄力冲锋！'); }
      }
      return;
    }
    if (b.castState === 'h_shock') {
      b.castTimer -= dt;
      if (b.castTimer <= 0) {
        bHazard(exp, { x: exp.player.x, y: exp.player.y, r: rg ? 110 : 92, delay: 0.06, dmg: b.damage * 0.75, color: '#d59aff', icon: '💜' });
        bBegin(b, 'cast', 0.3);
      }
    } else if (b.castState === 'cast') { b.castTimer -= dt; if (b.castTimer <= 0) bToIdle(exp, b, rg ? 3 : 4, rg ? 4.5 : 6); }
    else bChargeFlow(exp, b, dt, { color: '#ff7a4a', speed: rg ? 560 : 480, dur: rg ? 0.7 : 0.6, dmgMul: rg ? 1.2 : 1.05, stagger: 1.0, cdMin: rg ? 3 : 4, cdMax: rg ? 4.5 : 6 });
  }

  // ---------- T1-2 枯木精：树根缠绕（定身陷阱）+ 回血光环 ----------
  function h_withered(exp, b, dt) {
    const rg = bRage(b);
    if (b.castState === 'idle') {
      b.ai.cd -= dt;
      if (b.ai.cd <= 0) {
        b.ai.skill = ((b.ai.skill || 0) + 1) % 2;
        bFace(exp, b);
        if (b.ai.skill === 0) { bBegin(b, 'h_root', 0.8); exp.spawnAoeEffect(exp.player.x, exp.player.y, 44, '#6f8f4e'); bToast(exp, b, '树根缠绕！'); }
        else { bBegin(b, 'h_heal', 2.0); bToast(exp, b, '汲取大地生机'); }
      }
      return;
    }
    b.castTimer -= dt;
    if (b.castState === 'h_root') {
      if (b.castTimer <= 0) { bTrap(exp, 'root', exp.player.x, exp.player.y, 0.8); bToIdle(exp, b, 4.5, 6.5); }
    } else if (b.castState === 'h_heal') {
      if (Math.floor(b.castTimer * 2) !== b.ai._tick) {
        b.ai._tick = Math.floor(b.castTimer * 2);
        b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.025);
        exp.monsters.forEach(m => { if (m.hp > 0 && m !== b && dist(m, b) < 200) m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.05); });
        exp.spawnRadialBurst(b.x, b.y, '#8fd36a', 10);
      }
      if (b.castTimer <= 0) bToIdle(exp, b, rg ? 4 : 5.5, rg ? 6 : 8);
    }
  }

  // ---------- T1-3 采石巨魔：抛物线投石 + 岩石护甲 ----------
  function h_quarry(exp, b, dt) {
    const rg = bRage(b);
    if (b.castState === 'idle') {
      b.ai.cd -= dt;
      if (b.ai.cd <= 0) {
        b.ai.skill = ((b.ai.skill || 0) + 1) % 2;
        bFace(exp, b);
        if (b.ai.skill === 0) {
          bBegin(b, 'h_boulder', rg ? 0.6 : 0.75);
          bHazard(exp, { x: exp.player.x, y: exp.player.y, r: 74, delay: rg ? 0.9 : 1.1, dmg: b.damage * 1.2, color: '#b8a888', icon: '🪨', slow: 0.6 });
          bToast(exp, b, '投石！');
        } else { bBegin(b, 'h_armor', 0.8); bToast(exp, b, '岩石护甲'); }
      }
      return;
    }
    b.castTimer -= dt;
    if (b.castState === 'h_boulder') { if (b.castTimer <= 0) { exp.spawnImpact(b.x, b.y, '#b8a888', 0.9); bToIdle(exp, b, 3.5, 5); } }
    else if (b.castState === 'h_armor') {
      if (b.castTimer <= 0) { b.armorUntil = performance.now() + 6000; b.armorReduce = 0.35; exp.spawnShockRing(b.x, b.y, '#9b8b78', 90); bToIdle(exp, b, 4, 6); }
    }
  }

  // ---------- T2-1 石像鬼王：石化凝视 + 俯冲 + 散射（飞行、高速）----------
  function h_gargoyle(exp, b, dt) {
    const rg = bRage(b);
    if (b.castState === 'idle') {
      b.ai.cd -= dt;
      if (b.ai.cd <= 0) {
        b.ai.skill = ((b.ai.skill || 0) + 1) % 3;
        bFace(exp, b);
        if (b.ai.skill === 0) { bBegin(b, 'h_gaze', 0.55); bToast(exp, b, '石化凝视！'); }
        else if (b.ai.skill === 1) { bBegin(b, 'windup_charge', 0.45); }
        else { bBegin(b, 'h_volley', 0.5); }
      }
      return;
    }
    if (b.castState === 'h_gaze') {
      b.castTimer -= dt;
      exp.spawnAoeEffect(b.x + Math.cos(b.facing) * 50, b.y + Math.sin(b.facing) * 50, 30, '#b9c6d9');
      if (b.castTimer <= 0) {
        const d = dist(exp.player, b);
        const a = Math.atan2(exp.player.y - b.y, exp.player.x - b.x);
        let da = a - b.facing; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
        if (d < 240 && Math.abs(da) < 0.6) {
          exp.player.slow = Math.max(exp.player.slow, 2);
          exp.player.root = Math.max(exp.player.root || 0, 0.9);
          exp.spawnAoeEffect(exp.player.x, exp.player.y, 50, '#b9c6d9');
          showToast('被石化了！', 'warning');
        }
        bToIdle(exp, b, rg ? 2.8 : 3.5, rg ? 4 : 5);
      }
    } else if (b.castState === 'h_volley') {
      b.castTimer -= dt;
      if (b.castTimer <= 0) {
        const base = Math.atan2(exp.player.y - b.y, exp.player.x - b.x);
        for (let i = 0; i < 5; i++) {
          const a = base + (i - 2) * 0.22;
          bShot(exp, b, a, 360, 0.6, '#b9c6d9', { life: 4, radius: 7 });
        }
        exp.spawnRadialBurst(b.x, b.y, '#b9c6d9', 10);
        bToIdle(exp, b, rg ? 2.8 : 3.5, rg ? 4 : 5);
      }
    } else bChargeFlow(exp, b, dt, { color: '#9fb2c9', speed: 560, dur: 0.42, dmgMul: 0.95, stagger: 0.55, cdMin: rg ? 2.8 : 3.5, cdMax: rg ? 4 : 5 });
  }

  // ---------- T2-2 废墟魔像：血量分裂 + 反伤岩石护盾 + 碎石弹 ----------
  function h_golem(exp, b, dt) {
    const rg = bRage(b);
    if (!b.ai.flags.split1 && b.hp / b.maxHp < 0.7) {
      b.ai.flags.split1 = true;
      for (let i = 0; i < 2; i++) bAdd(exp, 'stone_golem', b.x + rand(-60, 60), b.y + rand(-60, 60), 0.42, '#a89888');
      bToast(exp, b, '崩裂分裂！');
      exp.spawnImpact(b.x, b.y, '#a89888', 1.6);
    }
    if (!b.ai.flags.split2 && b.hp / b.maxHp < 0.35) {
      b.ai.flags.split2 = true;
      for (let i = 0; i < 2; i++) bAdd(exp, 'stone_golem', b.x + rand(-60, 60), b.y + rand(-60, 60), 0.5, '#a89888');
      bToast(exp, b, '再次崩裂！');
      exp.spawnImpact(b.x, b.y, '#a89888', 1.8);
    }
    if (b.castState === 'idle') {
      b.ai.cd -= dt;
      if (b.ai.cd <= 0) {
        b.ai.skill = ((b.ai.skill || 0) + 1) % 2;
        bFace(exp, b);
        if (b.ai.skill === 0) { bBegin(b, 'h_armor', 0.8); bToast(exp, b, '反伤岩石护盾'); }
        else bBegin(b, 'h_volley', 0.5);
      }
      return;
    }
    b.castTimer -= dt;
    if (b.castState === 'h_armor' && b.castTimer <= 0) {
      b.armorUntil = performance.now() + 7000; b.armorReduce = 0.4;
      exp.spawnShockRing(b.x, b.y, '#8d8578', 100);
      bToIdle(exp, b, 4, 6);
    } else if (b.castState === 'h_volley' && b.castTimer <= 0) {
      const base = Math.atan2(exp.player.y - b.y, exp.player.x - b.x);
      for (let i = 0; i < 3; i++) { const a = base + (i - 1) * 0.3; bShot(exp, b, a, 320, 0.7, '#a89888', { life: 4.5, radius: 8 }); }
      bToIdle(exp, b, 3.5, 5);
    }
  }

  // ---------- T3-1 沼泽巫妪：毒沼陷阱 + 改雾天 + 诅咒毒弹（纯远程风筝）----------
  function h_hag(exp, b, dt) {
    const rg = bRage(b);
    if (b.castState === 'idle') {
      b.ai.cd -= dt;
      if (b.ai.cd <= 0) {
        b.ai.skill = ((b.ai.skill || 0) + 1) % 2;
        bFace(exp, b);
        if (b.ai.skill === 0) { bBegin(b, 'h_bog', 0.9); bToast(exp, b, '毒沼蔓延！'); }
        else bBegin(b, 'h_volley', 0.6);
      }
      return;
    }
    b.castTimer -= dt;
    if (b.castState === 'h_bog' && b.castTimer <= 0) {
      for (let i = 0; i < 2; i++) bTrap(exp, 'poison', exp.player.x + rand(-110, 110), exp.player.y + rand(-110, 110), 1.0);
      bSetWeather(exp, 'fog', 18);
      bToIdle(exp, b, rg ? 4 : 5.5, rg ? 6 : 8);
    } else if (b.castState === 'h_volley' && b.castTimer <= 0) {
      const base = Math.atan2(exp.player.y - b.y, exp.player.x - b.x);
      for (let i = 0; i < 3; i++) { const a = base + (i - 1) * 0.25; bShot(exp, b, a, 340, 0.7, '#8bd34a', { life: 4.5, radius: 7, burn: { dps: 4, dur: 2 } }); }
      exp.spawnRadialBurst(b.x, b.y, '#8bd34a', 10);
      bToIdle(exp, b, rg ? 3.5 : 4.5, rg ? 5.5 : 7);
    }
  }

  // ---------- T3-2 虫母：产卵虫潮 + 吐丝网（陷阱）----------
  function h_brood(exp, b, dt) {
    const rg = bRage(b);
    if (b.castState === 'idle') {
      b.ai.cd -= dt;
      if (b.ai.cd <= 0) {
        b.ai.skill = ((b.ai.skill || 0) + 1) % 2;
        bFace(exp, b);
        if (b.ai.skill === 0) { bBegin(b, 'h_spawn', 0.9); bToast(exp, b, '产卵！虫潮来袭'); }
        else { bBegin(b, 'h_web', 0.8); exp.spawnAoeEffect(exp.player.x, exp.player.y, 48, '#e8e2f5'); bToast(exp, b, '吐丝网！'); }
      }
      return;
    }
    b.castTimer -= dt;
    if (b.castState === 'h_spawn' && b.castTimer <= 0) {
      const n = rg ? 4 : 3;
      for (let i = 0; i < n && bAddCount(exp) < 10; i++) bAdd(exp, 'spider', b.x + rand(-80, 80), b.y + rand(-80, 80), 0.7, '#c08aff');
      bToIdle(exp, b, rg ? 4 : 5.5, rg ? 6.5 : 8);
    } else if (b.castState === 'h_web' && b.castTimer <= 0) {
      bTrap(exp, 'web', exp.player.x, exp.player.y, 0.8);
      bToIdle(exp, b, rg ? 3.5 : 4.5, rg ? 5.5 : 7);
    }
  }

  // ---------- T3-3 焦林炎魔：火雨 + 改雷暴天 + 火焰连射 ----------
  function h_scorch(exp, b, dt) {
    const rg = bRage(b);
    if (b.castState === 'idle') {
      b.ai.cd -= dt;
      if (b.ai.cd <= 0) {
        b.ai.skill = ((b.ai.skill || 0) + 1) % 2;
        bFace(exp, b);
        if (b.ai.skill === 0) { bBegin(b, 'h_firestorm', 1.0); bToast(exp, b, '烈焰风暴！'); }
        else bBegin(b, 'h_volley', 0.7);
      }
      return;
    }
    b.castTimer -= dt;
    if (b.castState === 'h_firestorm' && b.castTimer <= 0) {
      bSetWeather(exp, 'storm', 20);
      for (let i = 0; i < 5; i++) bTrap(exp, 'fire', exp.player.x + rand(-150, 150), exp.player.y + rand(-150, 150), rand(0.9, 1.7));
      bToIdle(exp, b, rg ? 4 : 5.5, rg ? 7 : 9);
    } else if (b.castState === 'h_volley' && b.castTimer <= 0) {
      const base = Math.atan2(exp.player.y - b.y, exp.player.x - b.x);
      for (let k = 0; k < 3; k++) setTimeout(() => {
        if (b.hp <= 0 || !exp.running) return;
        for (let i = 0; i < 3; i++) { const a = base + (i - 1) * 0.18 + rand(-0.05, 0.05); bShot(exp, b, a, 380, 0.55, '#ff6a3c', { life: 4, radius: 7, burn: { dps: 6, dur: 2.5 } }); }
        exp.spawnRadialBurst(b.x, b.y, '#ff6a3c', 8);
      }, k * 180);
      bToIdle(exp, b, rg ? 3.5 : 4.5, rg ? 5.5 : 7);
    }
  }

  // ---------- T4-1 深渊领主：复活尸体 + 深渊领域（雾+召唤）----------
  function bRevive(exp, b) {
    exp._corpses = exp._corpses || [];
    const now = performance.now();
    exp._corpses = exp._corpses.filter(c => now - c.t < 60000);
    let n = 0;
    while (n < 2 && exp._corpses.length && bAddCount(exp) < 9) {
      const c = exp._corpses.pop();
      bAdd(exp, c.type, c.x, c.y, 0.75, '#b06bff', { risen: true });
      n++;
    }
    for (; n < 2 && bAddCount(exp) < 9; n++) bAdd(exp, Math.random() < 0.5 ? 'shadow_demon' : 'bat', b.x + rand(-80, 80), b.y + rand(-80, 80), 0.8, '#b06bff');
  }
  function h_abyss(exp, b, dt) {
    const rg = bRage(b);
    if (b.castState === 'idle') {
      b.ai.cd -= dt;
      if (b.ai.cd <= 0) {
        b.ai.skill = ((b.ai.skill || 0) + 1) % 2;
        bFace(exp, b);
        if (b.ai.skill === 0) { bBegin(b, 'h_revive', 1.0); bToast(exp, b, '苏醒吧，我的仆从！'); }
        else { bBegin(b, 'h_domain', 1.0); bToast(exp, b, '深渊领域展开！'); }
      }
      return;
    }
    b.castTimer -= dt;
    if (b.castState === 'h_revive' && b.castTimer <= 0) { bRevive(exp, b); exp.spawnImpact(b.x, b.y, '#8a3bd8', 1.6); bToIdle(exp, b, rg ? 4 : 5.5, rg ? 7 : 9); }
    else if (b.castState === 'h_domain' && b.castTimer <= 0) {
      bSetWeather(exp, 'fog', 22);
      const types = ['bat', 'shadow_demon', 'spider'];
      for (let i = 0; i < 3 && bAddCount(exp) < 9; i++) bAdd(exp, types[i], b.x + rand(-100, 100), b.y + rand(-100, 100), 0.85, '#8a3bd8');
      bToIdle(exp, b, rg ? 4 : 5.5, rg ? 7 : 9);
    }
  }

  // ---------- T4-2 时空守望：传送凝滞 + 环形弹幕齐射 ----------
  function h_warden(exp, b, dt) {
    const rg = bRage(b);
    if (b.castState === 'idle') {
      b.ai.cd -= dt;
      if (b.ai.cd <= 0) {
        b.ai.skill = ((b.ai.skill || 0) + 1) % 2;
        bFace(exp, b);
        if (b.ai.skill === 0) { bBegin(b, 'h_tp', 0.6); bToast(exp, b, '时间凝滞！'); }
        else bBegin(b, 'h_volley', 0.6);
      }
      return;
    }
    b.castTimer -= dt;
    if (b.castState === 'h_tp' && b.castTimer <= 0) {
      const a = rand(0, Math.PI * 2);
      const size = CONFIG.expedition.mapSize;
      b.x = clamp(exp.player.x + Math.cos(a) * 95, 50, size - 50);
      b.y = clamp(exp.player.y + Math.sin(a) * 95, 50, size - 50);
      exp.spawnRadialBurst(b.x, b.y, '#7fd8ff', 26);
      exp.spawnImpact(b.x, b.y, '#7fd8ff', 1.4);
      exp.player.slow = Math.max(exp.player.slow, 2.2);
      bRing(exp, b, '#7fd8ff', rg ? 14 : 12, 260, 0.55);
      bToIdle(exp, b, rg ? 3.5 : 4.5, rg ? 5.5 : 7);
    } else if (b.castState === 'h_volley' && b.castTimer <= 0) {
      const base = Math.atan2(exp.player.y - b.y, exp.player.x - b.x);
      for (let i = 0; i < 5; i++) { const aa = base + (i - 2) * 0.2; bShot(exp, b, aa, 340, 0.7, '#9fe8ff', { life: 4.5, radius: 7 }); }
      bToIdle(exp, b, rg ? 3 : 4, rg ? 5 : 6);
    }
  }

  // ---------- T4-3 月之祭司：月光治疗 + 夜魇（雾+召唤怨灵）+ 月光弹 ----------
  function h_priestess(exp, b, dt) {
    const rg = bRage(b);
    if (b.castState === 'idle') {
      b.ai.cd -= dt;
      if (b.ai.cd <= 0) {
        b.ai.skill = ((b.ai.skill || 0) + 1) % 3;
        bFace(exp, b);
        if (b.ai.skill === 0) { bBegin(b, 'h_heal', 1.2); bToast(exp, b, '月光治愈'); }
        else if (b.ai.skill === 1) { bBegin(b, 'h_night', 0.9); bToast(exp, b, '夜魇降临！'); }
        else bBegin(b, 'h_volley', 0.6);
      }
      return;
    }
    b.castTimer -= dt;
    if (b.castState === 'h_heal' && b.castTimer <= 0) {
      exp.monsters.forEach(m => { if (m.hp > 0 && dist(m, b) < 260) m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.12); });
      b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.04);
      exp.spawnRadialBurst(b.x, b.y, '#d9e6ff', 24);
      bToIdle(exp, b, rg ? 4 : 5.5, rg ? 7 : 9);
    } else if (b.castState === 'h_night' && b.castTimer <= 0) {
      bSetWeather(exp, 'fog', 16);
      for (let i = 0; i < 2 && bAddCount(exp) < 8; i++) bAdd(exp, 'bat', b.x + rand(-80, 80), b.y + rand(-80, 80), 0.9, '#d9e6ff');
      bToIdle(exp, b, rg ? 4 : 5.5, rg ? 7 : 9);
    } else if (b.castState === 'h_volley' && b.castTimer <= 0) {
      const base = Math.atan2(exp.player.y - b.y, exp.player.x - b.x);
      for (let i = 0; i < 4; i++) { const aa = base + (i - 1.5) * 0.2; bShot(exp, b, aa, 330, 0.65, '#d9e6ff', { life: 4.5, radius: 7 }); }
      bToIdle(exp, b, rg ? 3.5 : 4.5, rg ? 6 : 8);
    }
  }

  // ---------- T4-4 竞技场冠军：三段连招 + 50%血狂暴二阶段（纯近战）----------
  function h_champion(exp, b, dt) {
    if (!b.ai.flags.rage && b.hp / b.maxHp < 0.5) {
      b.ai.flags.rage = true;
      b.speed *= 1.25; b.damage *= 1.2;
      b.ai.cd = 2.5;
      exp.screenShake = Math.max(exp.screenShake || 0, 0.8);
      exp.spawnImpact(b.x, b.y, '#ff4a4a', 2);
      bToast(exp, b, '狂暴决斗姿态！');
    }
    const rg = b.ai.flags.rage;
    if (b.castState === 'idle') {
      b.ai.cd -= dt;
      if (b.ai.cd <= 0) { bFace(exp, b); b.ai.combo = 1; bBegin(b, 'windup_charge', 0.4); bToast(exp, b, '决斗连招！'); }
      return;
    }
    // 第1段：突刺
    if (b.ai.combo === 1) {
      if (b.castState === 'windup_charge' || b.castState === 'charge' || b.castState === 'stagger') {
        bChargeFlow(exp, b, dt, { color: '#ffb04a', speed: 520, dur: 0.3, dmgMul: 0.9, stagger: 0.02, keepStagger: true, cdMin: 1, cdMax: 1 });
        if (b.castState === 'stagger' && b.castTimer <= 0) { b.ai.combo = 2; bBegin(b, 'h_sweep', 0.45); exp.spawnAoeEffect(b.x, b.y, 108, '#ffd96a'); }
        return;
      }
    }
    // 第2段：横扫
    if (b.ai.combo === 2) {
      b.castTimer -= dt;
      if (b.castTimer <= 0) {
        bHazard(exp, { x: b.x, y: b.y, r: 112, delay: 0.06, dmg: b.damage * 1.1, color: '#ffd96a', icon: '🌀' });
        exp.spawnShockRing(b.x, b.y, '#ffd96a', 112);
        b.ai.combo = 3;
        bBegin(b, 'h_slam', 0.6);
        exp.spawnAoeEffect(exp.player.x, exp.player.y, 100, '#ff5a4a');
      }
      return;
    }
    // 第3段：跳劈
    if (b.ai.combo === 3) {
      b.castTimer -= dt;
      if (b.castTimer <= 0) {
        const size = CONFIG.expedition.mapSize;
        bHazard(exp, { x: exp.player.x, y: exp.player.y, r: 100, delay: 0.4, dmg: b.damage * 1.4, color: '#ff5a4a', icon: '💥', slow: 1.2 });
        b.x = clamp(exp.player.x + rand(-40, 40), 50, size - 50);
        b.y = clamp(exp.player.y + rand(-40, 40), 50, size - 50);
        exp.spawnImpact(b.x, b.y, '#ff5a4a', 2);
        exp.screenShake = Math.max(exp.screenShake || 0, 0.6);
        bBegin(b, 'stagger', 1.0);
        b.ai.combo = 0;
        return;
      }
    }
    if (b.castState === 'stagger' && b.castTimer <= 0) bToIdle(exp, b, rg ? 3.2 : 5, rg ? 4.5 : 7);
  }

  const BOSS_HANDLERS = {
    t1_boar_king: h_boar, t1_withered: h_withered, t1_quarry: h_quarry,
    t2_gargoyle_lord: h_gargoyle, t2_ruin_golem: h_golem,
    t3_swamp_hag: h_hag, t3_brood_mother: h_brood, t3_scorch_demon: h_scorch,
    t4_abyss_lord: h_abyss, t4_time_warden: h_warden, t4_moon_priestess: h_priestess,
    t4_arena_champion: h_champion,
  };

  V5.tickBoss = function (exp, dt) {
    if (!exp.bossHazards) exp.bossHazards = [];
    V5.updateBossHazards(exp, dt);
    if (!exp.boss || exp.boss.hp <= 0) return;
    const b = exp.boss;
    if (!b.ai) b.ai = { cd: rand(2.5, 4), skill: 0, combo: 0, flags: {} };
    b.ai.flags = b.ai.flags || {};
    if (b.ai.skill == null) b.ai.skill = 0;
    // v5.4 软狂暴：与玩家交战（650px 内）累计时间，50s 后阶梯加压（50/72/94/116s），双向收束长尾
    if (b.baseDamage == null) { b.baseDamage = b.damage; b.baseSpeed = b.speed; b.baseAttackCd = b.attackCooldown || 1.6; b.enrageT = 0; b.enrageStage = 0; }
    const engaged = dist(exp.player, b) < 650;
    if (engaged) { b.enrageEngaged = true; b.enrageT += dt; }
    if (b.enrageEngaged) {
      const stage = b.enrageT > 50 ? (1 + Math.floor((b.enrageT - 50) / 22)) : 0; // r5 阶段不封顶，保证消耗战必然收束
      if (stage > b.enrageStage) {
        b.enrageStage = stage;
        b.damage = Math.round(b.baseDamage * (1 + 0.20 * Math.min(4, stage)));
        if (typeof showToast === 'function') showToast('「' + b.name + '」进入狂暴·第' + stage + '阶！', 'warning');
        if (exp.spawnShockRing) exp.spawnShockRing(b.x, b.y, stage >= 3 ? '#ff3b30' : '#ff7a45', 90);
        if (exp.spawnRadialBurst) exp.spawnRadialBurst(b.x, b.y, '#ff5a3c', 22);
        exp.screenShake = Math.max(exp.screenShake || 0, 8);
      }
      if (b.enrageStage > 0) {
        b.damage = Math.round(b.baseDamage * (1 + 0.20 * Math.min(4, b.enrageStage)));
        b.speed = b.baseSpeed * (1 + 0.06 * Math.min(4, b.enrageStage));
        b.attackCooldown = Math.max(0.7, b.baseAttackCd * (1 - 0.09 * Math.min(4, b.enrageStage)));
        if (b.castState === 'idle' && b.ai.cd > 0) b.ai.cd = Math.max(0.25, b.ai.cd - dt * 0.15 * b.enrageStage);
        b.enrageTick -= dt;
        if (b.enrageTick <= 0) { b.enrageTick = 1.2; if (exp.spawnRadialBurst) exp.spawnRadialBurst(b.x, b.y, 'rgba(255,60,40,0.6)', 6); }
      }
    }
    // 岩石护盾反伤光环
    if (b.armorUntil && b.armorUntil > performance.now()) {
      b.ai.armorTick = (b.ai.armorTick || 0) - dt;
      if (b.ai.armorTick <= 0 && dist(exp.player, b) < 95) {
        b.ai.armorTick = 0.5;
        exp.damagePlayer(b.damage * 0.1);
        exp.spawnRadialBurst(b.x, b.y, '#9b8b78', 5);
      }
    }
    const handler = BOSS_HANDLERS[b.bossId];
    if (handler) handler(exp, b, dt);
  };

  V5.makeBoss = function (exp) {
    const map = exp.map;
    const cfg = CONFIG.bosses[map.bossId] || BOSSES.t1_boar_king;
    let hpMul = 1, dmgMul = 1;
    if (window.DifficultySystem && DifficultySystem.getMultipliers) {
      try { const mm = DifficultySystem.getMultipliers(); hpMul = mm.hpMul != null ? mm.hpMul : 1; dmgMul = mm.dmgMul != null ? mm.dmgMul : 1; } catch (e) {}
    }
    const position = exp.findSafeSpawn(650, CONFIG.expedition.mapSize - 350, cfg.radius);
    const boss = {
      type: 'boss', bossId: cfg.id, name: cfg.name,
      x: position.x, y: position.y, radius: cfg.radius,
      hp: Math.round(cfg.hp * hpMul), maxHp: Math.round(cfg.hp * hpMul),
      damage: Math.round(cfg.dmg * dmgMul), speed: cfg.speed,
      attackRange: 70, attackCd: 1.6, attackCooldown: 1.6, baseAttackCd: 1.6, abilityCd: 4, abilityIndex: 0, phase: 1, stunned: 0,
      baseDamage: Math.round(cfg.dmg * dmgMul), baseSpeed: cfg.speed,
      enrageT: 0, enrageStage: 0, enrageEngaged: false, enrageTick: 0,
      facing: 0, animTime: 0, hitFlash: 0, elite: true, boss: true,
      gold: 100 * cfg.tier, color: cfg.color, emoji: cfg.emoji,
      castState: 'idle', castTimer: 0, castIndex: 0, attackAnim: 0,
      flying: !!cfg.flying, ranged: !!cfg.ranged, summoner: !!cfg.summoner, healer: !!cfg.healer, charger: !!cfg.charger,
    };
    return boss;
  };

  /* ----------------------------------------------------------
   *  农场 UI：修行台 / 远征档案 / 图鉴（自建浮层，不依赖静态 HTML）
   * -------------------------------------------------------- */
  const UI = V5.ui = {
    cssInjected: false,
    injectCSS() {
      if (this.cssInjected) return;
      this.cssInjected = true;
      const st = document.createElement('style');
      st.textContent = `
      .v5-overlay{position:fixed;inset:0;background:rgba(10,12,10,.78);backdrop-filter:blur(3px);z-index:9000;display:none;align-items:center;justify-content:center;font-family:"Microsoft YaHei",sans-serif;}
      .v5-overlay.open{display:flex;}
      .v5-modal{width:min(920px,92vw);max-height:88vh;overflow:auto;background:linear-gradient(160deg,#22261f,#171a15);border:1px solid #5a5138;border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.6);color:#e8e6da;padding:18px 20px;}
      .v5-modal h2{margin:0 0 4px;font-size:22px;color:#e8c87a;letter-spacing:2px;}
      .v5-modal .sub{color:#9aa08c;font-size:13px;margin-bottom:14px;}
      .v5-close{float:right;cursor:pointer;color:#c9b98a;font-size:20px;border:1px solid #5a5138;border-radius:8px;padding:2px 10px;background:#2c2f26;}
      .v5-close:hover{background:#3a3e30;}
      .v5-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;}
      .v5-card{background:#262a21;border:1px solid #3c4033;border-radius:10px;padding:10px 12px;}
      .v5-card.locked{opacity:.62;}
      .v5-card.ready{border-color:#caa64e;box-shadow:0 0 0 1px rgba(202,166,78,.35);}
      .v5-card h3{margin:0 0 4px;font-size:15px;color:#f0e6c8;}
      .v5-card .d{font-size:12px;color:#aeb4a0;line-height:1.5;}
      .v5-btn{cursor:pointer;border:1px solid #6b6142;border-radius:8px;background:linear-gradient(180deg,#4a442c,#34301f);color:#ffe9b0;font-size:13px;padding:6px 12px;margin-top:8px;}
      .v5-btn:hover{filter:brightness(1.15);}
      .v5-btn:disabled{opacity:.45;cursor:not-allowed;}
      .v5-bar{height:10px;background:#14160f;border-radius:6px;overflow:hidden;margin:4px 0;}
      .v5-bar>i{display:block;height:100%;background:linear-gradient(90deg,#8fb84e,#d8c14e);}
      .v5-tabs{display:flex;gap:6px;margin:10px 0;flex-wrap:wrap;}
      .v5-tab{cursor:pointer;padding:6px 14px;border-radius:8px;background:#2c2f26;border:1px solid #3c4033;color:#bfc4b4;font-size:13px;}
      .v5-tab.on{background:#4a442c;color:#ffe9b0;border-color:#caa64e;}
      .v5-statrow{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0;}
      .v5-pill{background:#2c2f26;border:1px solid #3c4033;border-radius:20px;padding:4px 12px;font-size:12px;color:#dfe2d2;}

      /* ===== v5.0 农场暗色废土主题 ===== */
      #farmScreen{background:radial-gradient(1200px 700px at 70% -10%, #3a3526 0%, #22201a 45%, #15140f 100%) !important;}
      #farmScreen .farm-top-bar{background:linear-gradient(180deg,rgba(28,27,20,.96),rgba(22,21,16,.92));border-bottom:1px solid #6b5d33;box-shadow:0 4px 18px rgba(0,0,0,.5);}
      #farmScreen .farm-title{color:#e8c87a !important;text-shadow:0 2px 6px rgba(0,0,0,.6);letter-spacing:3px;}
      #farmScreen .resource-item{background:#262419;border:1px solid #4a432c;border-radius:8px;}
      #farmScreen .panel,#farmScreen .farm-grid-container,#farmScreen .facility,#farmScreen .supply-card,#farmScreen .expedition-gate{backdrop-filter:none !important;-webkit-backdrop-filter:none !important;}
      #farmScreen .daily-strip{backdrop-filter:none !important;-webkit-backdrop-filter:none !important;}
      #farmScreen .farm-content{overflow:visible !important;z-index:auto !important;}
      #farmScreen .panel{background:linear-gradient(165deg,rgba(38,36,27,.96),rgba(24,23,17,.96)) !important;border:1px solid #4a432c !important;border-radius:12px !important;box-shadow:0 8px 24px rgba(0,0,0,.35);}
      #farmScreen .panel-title{color:#e8c87a !important;border-bottom:1px solid #4a432c;letter-spacing:2px;}
      #farmScreen .facility{background:linear-gradient(160deg,#33301f,#211f15) !important;border:1px solid #43402c;border-radius:10px;transition:transform .12s,border-color .12s,box-shadow .12s;cursor:pointer;}
      #farmScreen .facility:hover{transform:translateY(-3px);border-color:#caa64e;box-shadow:0 8px 18px rgba(0,0,0,.5),0 0 0 1px rgba(202,166,78,.35);}
      #farmScreen .facility-icon{filter:drop-shadow(0 3px 4px rgba(0,0,0,.6));}
      #farmScreen .facility-name{color:#f0e6c8 !important;}
      #farmScreen .facility-state{color:#a8a084 !important;}
      #farmScreen .farm-grid-container{background:linear-gradient(165deg,rgba(34,32,23,.96),rgba(22,21,16,.96));border:1px solid #4a432c;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.35);}
      #farmScreen .farm-grid-title{color:#e8c87a !important;letter-spacing:1px;}
      #farmScreen .farm-cell{border-radius:8px !important;border:1px solid #3c3826 !important;box-shadow:inset 0 0 12px rgba(0,0,0,.35);transition:transform .1s,border-color .1s;}
      #farmScreen .farm-cell.ready{border-color:#caa64e !important;box-shadow:0 0 12px rgba(202,166,78,.45),inset 0 0 12px rgba(0,0,0,.3);animation:v5pulse 1.6s ease-in-out infinite;}
      @keyframes v5pulse{0%,100%{filter:brightness(1)}50%{filter:brightness(1.18)}}
      #farmScreen .crop-selector{background:#211f17;border:1px solid #4a432c;border-radius:10px;}
      #farmScreen .crop-selector>div{background:#2b281c;border:1px solid #43402c;border-radius:8px;}
      #farmScreen .crop-selector>div:hover{border-color:#caa64e;}
      #farmScreen .expedition-gate{background:linear-gradient(160deg,#33301d,#211f14);border:1px solid #7a6a38;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.4);}
      #farmScreen .expedition-gate-title{color:#f0d488 !important;letter-spacing:3px;}
      #farmScreen .start-expedition-btn{background:linear-gradient(180deg,#c9a24e,#8a6c2c);border:1px solid #e8c87a;color:#1c1a12;font-weight:700;letter-spacing:2px;border-radius:10px;box-shadow:0 4px 14px rgba(202,166,78,.35);}
      #farmScreen .start-expedition-btn:hover{filter:brightness(1.12);}
      #farmScreen .supply-btn,#farmScreen button.menu-btn{background:linear-gradient(180deg,#4a442c,#34301f);border:1px solid #6b6142;color:#ffe9b0;border-radius:8px;}
      #farmScreen .supply-btn:hover{filter:brightness(1.15);}
      #v5FarmBar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;background:linear-gradient(90deg,rgba(40,37,24,.95),rgba(28,27,20,.95));border-bottom:1px solid #5a5138;padding:8px 18px;font-size:13px;color:#dfe2d2;}
      #v5FarmBar .v5lv{background:linear-gradient(180deg,#caa64e,#8a6c2c);color:#1c1a12;font-weight:700;border-radius:8px;padding:4px 12px;font-size:14px;letter-spacing:1px;}
      #v5FarmBar .v5expwrap{flex:1;min-width:180px;max-width:340px;}
      #v5FarmBar .v5expbar{height:9px;background:#14160f;border:1px solid #3c4033;border-radius:6px;overflow:hidden;}
      #v5FarmBar .v5expbar>i{display:block;height:100%;background:linear-gradient(90deg,#8fb84e,#d8c14e);}
      #v5FarmBar .v5hint{color:#e0a84e;font-size:12px;}
      #v5FarmBar .v5res{display:flex;gap:10px;flex-wrap:wrap;}
      #v5FarmBar .v5res span{background:#262419;border:1px solid #4a432c;border-radius:14px;padding:3px 10px;font-size:12px;}

      .v5-sil{filter:brightness(0) opacity(.35);}
      `;
      document.head.appendChild(st);
    },
    ensure() {
      this.injectCSS();
      if (!document.getElementById('v5Overlay')) {
        const o = document.createElement('div');
        o.id = 'v5Overlay'; o.className = 'v5-overlay';
        o.innerHTML = '<div class="v5-modal" id="v5Modal"></div>';
        o.addEventListener('click', e => { if (e.target === o) this.close(); });
        document.body.appendChild(o);
      }
    },
    open(html) { this.ensure(); document.getElementById('v5Modal').innerHTML = html + '<span class="v5-close" onclick="V5.ui.close()">✕ 关闭</span>'; document.getElementById('v5Overlay').classList.add('open'); },
    close() { document.getElementById('v5Overlay').classList.remove('open'); },

    openCultivation() {
      CharacterSystem.init();
      const lv = GameState.level, d = CharacterSystem.derived();
      const need = lv >= 100 ? 0 : CharacterSystem.expNeeded(lv);
      const prog = lv >= 100 ? 100 : Math.min(100, Math.round(GameState.cultivation / need * 100));
      const gold = CharacterSystem.goldNeeded(lv), soil = CharacterSystem.soilNeeded(lv), water = CharacterSystem.waterNeeded(lv), compost = CharacterSystem.compostNeeded(lv);
      const isBrk = [20, 40, 60, 80, 100].includes(lv + 1);
      const brkOk = isBrk ? CharacterSystem.breakthroughMet(lv + 1) : true;
      let skills = SKILLS.map(s => {
        const unlocked = GameState.unlockedSkills.includes(s.id);
        const equipped = GameState.equippedSkills.includes(s.id);
        const lvl = GameState.skillLevels[s.id] || 1;
        return `<div class="v5-card ${unlocked ? '' : 'locked'} ${equipped ? 'ready' : ''}">
          <h3>${(typeof CropArt!=="undefined"&&CropArt.ready(s.id))?CropArt.dom(s.id,s.icon,28):s.icon} ${s.name} ${unlocked ? `Lv.${lvl}` : ''}</h3>
          <div class="d">${s.desc}</div>
          <div class="d" style="color:#c9b98a;margin-top:4px">${unlocked ? `能耗 ${s.energy} · CD ${s.cd}s` : '解锁：' + CharacterSystem.unlockHint(s.id)}</div>
          ${unlocked ? `<button class="v5-btn" onclick="V5.ui.toggleEquip('${s.id}')">${equipped ? '卸下' : '装备'}</button>` : ''}
        </div>`;
      }).join('');
      this.open(`
        <h2>🧘 修行台 · Lv.${lv} ${lv >= 100 ? '（已圆满）' : ''}</h2>
        <div class="sub">技能卡槽 ${d.slots} 个（Lv20/40/60/80 各 +1，上限 5）· 修为 90% 来自种地、10% 来自远征</div>
        <div class="v5-statrow">
          <span class="v5-pill">生命 ${d.hp}</span><span class="v5-pill">基础攻击 ${d.atk}</span>
          <span class="v5-pill">防御 ${d.def}（减伤 ${Math.round(d.def / (d.def + 150) * 100)}%）</span>
          <span class="v5-pill">能量 ${d.energyMax} · 回复 ${d.energyRegen}/s</span>
          <span class="v5-pill">脱战回血 ${d.ocRegen}/s</span>
        </div>
        <div class="v5-card" style="margin:8px 0">
          <h3>修为：${Math.floor(GameState.cultivation)} / ${need} <span style="font-size:11px;color:#9aa08c;font-weight:normal">（修为怎么来：种凝气草🌱等修为作物，收获自动转化；远征首通/档案给少量）</span></h3>
          <div class="v5-bar"><i style="width:${prog}%"></i></div>
          ${lv >= 100 ? '<div class="d">已达 Lv100 满级。</div>' :
            `<div class="d">突破/升级消耗：金币 ${gold} · 泥土 ${soil} · 清水 ${water} · 堆肥 ${compost}</div>
             ${isBrk && !brkOk ? `<div class="d" style="color:#e89a6b">突破门槛未达成：${CharacterSystem.breakthroughHint(lv + 1)}（见远征档案）</div>` : ''}
             ${GameState.cultivation < need
                ? '<button class="v5-btn" style="background:#3a5a3a" onclick="V5.ui.goPlantNingqi()">去种凝气草（每株 +10 修为，约 ' + Math.max(1, Math.ceil((need - GameState.cultivation) / 10)) + ' 株可升级）</button>'
                : `<button class="v5-btn" onclick="V5.ui.cultivate()">${isBrk ? '尝试突破 → Lv' + (lv + 1) : '修炼升级 → Lv' + (lv + 1)}</button>`}
        </div>`}
        <h2 style="font-size:17px;margin-top:14px">技能（点击装备/卸下，最多 ${d.slots} 个） <button class="v5-btn" style="font-size:12px;padding:3px 10px;margin-left:8px" onclick="V5.ui.unequipAll()">一键卸下</button></h2>
        <div class="v5-grid">${skills}</div>
      `);
    },
    cultivate() { CharacterSystem.tryCultivate(); this.openCultivation(); },
    toggleEquip(id) { CharacterSystem.equip(id); this.openCultivation(); },
    unequipAll() { CharacterSystem.init(); GameState.equippedSkills = []; try { SaveSystem.save(); } catch (e) {} showToast('已卸下全部技能', 'success'); this.openCultivation(); },
    goPlantNingqi() {
      this.close();
      try { GameState.selectedCrop = 'ningqi_grass'; SaveSystem.save(); } catch (e) {}
      try { if (typeof Farm !== 'undefined') { Farm.renderCropSelector(); Farm.renderCropDetail(); } } catch (e) {}
      showToast('已选中凝气草🌱，点击任意空地块种植（约20秒成熟，收获转化为修为）', 'gold');
    },

    openArchive() {
      CharacterSystem.init();
      const cards = ARCHIVES.map(a => {
        const met = ArchiveSystem.isMet(a), claimed = !!GameState.archive.claimed[a.id];
        return `<div class="v5-card ${claimed ? '' : met ? 'ready' : 'locked'}">
          <h3>${a.breakthrough ? '🔶 ' : '📜 '}${a.name}</h3>
          <div class="d">${a.desc}</div>
          <div class="d" style="color:#d8c14e;margin-top:4px">${V5.ui.rewardText(a.reward)}</div>
          <button class="v5-btn" ${(!met || claimed) ? 'disabled' : ''} onclick="V5.ui.claim('${a.id}')">${claimed ? '已领取' : met ? '领取奖励' : '未达成'}</button>
        </div>`;
      }).join('');
      this.open(`<h2>📜 远征档案</h2><div class="sub">突破档案卡等级上限；普通档案给战略物资。已点亮 ${Object.keys(GameState.archive.claimed).length} 份</div><div class="v5-grid">${cards}</div>`);
    },
    claim(id) { ArchiveSystem.claim(id); this.openArchive(); },
    rewardText(r) {
      if (!r) return '';
      const t = [];
      if (r.cult) t.push(`修为+${r.cult}`); if (r.pardon) t.push(`免死令×${r.pardon}`);
      if (r.safe) t.push(`安全箱+${r.safe}格`); if (r.rareSeed) t.push('稀有种子');
      if (r.legendarySeed) t.push('传说种子'); if (r.blueprint) t.push('武器蓝图');
      if (r.unlockSkill) t.push('解锁技能');
      return '奖励：' + t.join(' · ');
    },

    tab: 'crop',
    openCodex(tab) {
      this.tab = tab || this.tab || 'crop';
      const tabs = [['crop', '作物'], ['monster', '怪物'], ['boss', 'Boss'], ['weapon', '武器'], ['item', '道具'], ['resource', '资源']];
      const tabBar = tabs.map(([k, n]) => `<div class="v5-tab ${this.tab === k ? 'on' : ''}" onclick="V5.ui.openCodex('${k}')">${n}</div>`).join('');
      let body = '';
      if (this.tab === 'crop') {
        const all = [...(CONFIG.crops || []), ...(CONFIG.greenhousePlants || [])];
        body = `<div class="v5-grid">${all.map(c => {
          const seen = (GameState.unlockedCrops || []).includes(c.id) || (GameState.harvestCount && GameState.harvestCount[c.id]);
          return `<div class="v5-card ${seen ? '' : 'locked'}"><h3>${seen ? (c.icon || '🌱') + ' ' + c.name : '？？？'}</h3><div class="d">${seen ? (c.desc || (c.cultivation ? `修为作物，收获 +${c.cultivation} 修为` : '农场作物')) : '尚未发现'}</div><div class="d" style="color:#9aa08c">来源：${seen ? (c.growTime ? '农场/温室种植' : '温室') : '—'}</div></div>`;
        }).join('')}</div>`;
      } else if (this.tab === 'monster') {
        body = `<div class="v5-grid">${Object.keys(CONFIG.monsters).map(k => { const m = CONFIG.monsters[k]; return `<div class="v5-card"><h3>${m.name}</h3><div class="d">生命 ${m.hp} · 攻击 ${m.damage}${m.armor ? ' · 护甲 ' + Math.round(m.armor * 100) + '%' : ''}${m.elite ? ' · 精英' : ''}</div><div class="d" style="color:#9aa08c">来源：远征各地图怪物池</div></div>`; }).join('')}</div>`;
      } else if (this.tab === 'boss') {
        body = `<div class="v5-grid">${Object.keys(CONFIG.bosses).map(k => { const b = CONFIG.bosses[k]; const seen = !!GameState.archive.bosses[k]; return `<div class="v5-card ${seen ? '' : 'locked'}"><h3>${seen ? b.emoji + ' ' + b.name : '？？？'}</h3><div class="d">${seen ? b.skill : '尚未发现'} </div><div class="d" style="color:#9aa08c">T${b.tier} · 生命 ${seen ? b.hp : '??'}</div></div>`; }).join('')}</div>`;
      } else if (this.tab === 'weapon') {
        body = `<div class="v5-grid">${CONFIG.weapons.map(w => `<div class="v5-card"><h3>${w.icon || '⚔️'} ${w.name}</h3><div class="d">基础伤害 ${w.damage} · ${w.mode === 'melee' ? '近战' : '远程'} · CD ${w.cooldown}s</div><div class="d" style="color:#9aa08c">来源：初始/蓝图/锻造台升级</div></div>`).join('')}</div>`;
      } else if (this.tab === 'item') {
        // 用途/来源映射：加工配方反查（字段 outputId/inputs/inputCrop/inputQty/workshopLevel）
        const __recipeOf = {};
        try {
          const __nm = id => { try { if (RESOURCES && RESOURCES[id]) return RESOURCES[id].name; const c=(CONFIG.crops||[]).find(x=>x.id===id); if (c) return c.name; const wi=CONFIG.warehouseItems; if (wi){ const w=Array.isArray(wi)?wi.find(x=>x.id===id):wi[id]; if (w) return w.name; } } catch(e){} return id; };
          (typeof FarmRecipes !== 'undefined' ? FarmRecipes : []).forEach(r => {
            if (!r || !r.outputId) return;
            let ins = '';
            if (r.inputs) ins = Object.entries(r.inputs).map(([k,n]) => __nm(k)+'×'+n).join('+');
            else if (r.inputCrop) ins = __nm(r.inputCrop)+'×'+(r.inputQty||1);
            __recipeOf[r.outputId] = '加工工坊（'+ins+'）'+(r.workshopLevel?'，需工坊Lv.'+r.workshopLevel:'');
          });
        } catch (e) {}
        const cons = (CONFIG.consumables || []).map(c => {
          const src = __recipeOf[c.id] || (c.key ? '初始补给/怪物掉落' : '怪物掉落/档案奖励/温室');
          const use = c.key ? ('战术消耗品（快捷键 '+c.key+'）') : '背包补给（准备大厅携带，局内 Tab 背包点击使用，死亡随背包损失）';
          return '<div class="v5-card"><h3>'+c.icon+' '+c.name+'</h3><div class="d">'+(c.desc||'')+'</div><div class="d" style="color:#8fd0a0">用途：'+use+'</div><div class="d" style="color:#9aa08c">来源：'+src+'</div></div>';
        });
        const plants = Object.values(CONFIG.deployPlants || {}).map(c =>
          '<div class="v5-card"><h3>'+(c.icon||'🌱')+' '+c.name+'</h3><div class="d">'+(c.desc||'')+'</div><div class="d" style="color:#8fd0a0">用途：战场植物（准备大厅携带种子，局内 F1-F5 种在地上协助作战，撤离/死亡均消失）</div><div class="d" style="color:#9aa08c">来源：农场种植对应作物，收获后作为种子带入</div></div>'
        );
        body = '<div class="v5-grid">'+cons.join('')+plants.join('')+'</div>';
      } else {
        body = `<div class="v5-grid">${Object.keys(RESOURCES).map(k => { const r = RESOURCES[k]; return `<div class="v5-card"><h3>${r.icon} ${r.name}</h3><div class="d">来源：${r.from}</div><div class="d" style="color:#9aa08c">去向：${r.to} · 持有 ${ResourceSystem.count(k)}</div></div>`; }).join('')}</div>`;
      }
      this.open(`<h2>📖 荒野图鉴</h2><div class="sub">未发现的条目显示为剪影</div><div class="v5-tabs">${tabBar}</div>${body}`);
    },

    mountFarm() {
      const grids = document.querySelectorAll('.facility-grid');
      if (!grids.length || document.getElementById('v5CultFacility')) return;
      const mk = (id, icon, name, state, fn) => {
        const d = document.createElement('div');
        d.className = 'facility'; d.id = id;
        d.innerHTML = `<div class="facility-icon">${icon}</div><div class="facility-name">${name}</div><div class="facility-state">${state}</div>`;
        d.onclick = fn;
        return d;
      };
      grids[0].appendChild(mk('v5CultFacility', (function(){try{if(typeof CropArt!=='undefined'&&CropArt.map['cult_altar'])return '<img src="assets/'+CropArt.map['cult_altar']+'" alt="🧘" style="width:40px;height:40px;object-fit:contain;vertical-align:middle;" />';}catch(e){}return '🧘';})(), '修行台', '角色升级 · 技能装备', () => this.openCultivation()));
      grids[0].appendChild(mk('v5ArchFacility', (function(){try{if(typeof CropArt!=='undefined'&&CropArt.map['archive_book'])return '<img src="assets/'+CropArt.map['archive_book']+'" alt="📜" style="width:40px;height:40px;object-fit:contain;vertical-align:middle;" />';}catch(e){}return '📜';})(), '远征档案', '突破 · 战略物资', () => this.openArchive()));
      grids[1].appendChild(mk('v5CodexFacility', (function(){try{if(typeof CropArt!=='undefined'&&CropArt.map['codex_book'])return '<img src="assets/'+CropArt.map['codex_book']+'" alt="📖" style="width:40px;height:40px;object-fit:contain;vertical-align:middle;" />';}catch(e){}return '📖';})(), '荒野图鉴', '作物/怪物/Boss/武器/道具/资源', () => this.openCodex('crop')));
      // 替换原“远征档案”占位按钮
      const ph = Array.from(document.querySelectorAll('.facility')).find(f => f.getAttribute('onclick') && f.getAttribute('onclick').includes("showToast('远征档案"));
      if (ph) { ph.setAttribute('onclick', ''); ph.onclick = () => this.openArchive(); ph.querySelector('.facility-state').textContent = '突破 · 战略物资'; }
      // 建筑入口统一真实图标（按设施名映射，直接写 img，无需等图片解码）
      try {
        const FAC_ICON = {
          '远征档案': ['archive_book','📜'], '作物图鉴': ['codex_book','📖'],
          '加工工坊': ['workshop','🏭'], '育种温室': ['greenhouse_b','🏡']
        };
        document.querySelectorAll('.facility').forEach(d => {
          const nm = d.querySelector('.facility-name'), ic = d.querySelector('.facility-icon');
          if (!nm || !ic || typeof CropArt === 'undefined') return;
          const m = FAC_ICON[nm.textContent.trim()];
          if (m && CropArt.map[m[0]]) ic.innerHTML = '<img src="assets/'+CropArt.map[m[0]]+'" style="width:40px;height:40px;object-fit:contain;vertical-align:middle;" />';
        });
      } catch (e) {}
      // v5.4 家园全景面板（填充左列底部空白）
      const leftCol = document.querySelector('.farm-left');
      if (leftCol && !document.getElementById('farmHomestead')) {
        const hs = document.createElement('div');
        hs.id = 'farmHomestead';
        hs.style.cssText = 'margin-top:12px;border-radius:12px;overflow:hidden;border:1px solid #4a5a3a;background:#141a12;box-shadow:0 4px 14px rgba(0,0,0,.35);';
        hs.innerHTML =
          '<div style="padding:8px 12px 4px;color:#b9d18a;font-weight:bold;font-size:13px;">🏞️ 家园全景</div>' +
          '<div style="position:relative;height:118px;margin:6px 10px 0;border-radius:10px;background:linear-gradient(180deg,#273044 0%,#33405a 45%,#6b5640 56%,#3c4a2c 57%,#2b3a22 100%);overflow:hidden;">' +
          '<span style="position:absolute;top:8px;right:14px;font-size:24px;filter:drop-shadow(0 0 6px rgba(255,220,140,.7));">🌙</span>' +
          '<span style="position:absolute;left:8%;bottom:34px;font-size:30px;">🛖</span>' +
          '<span style="position:absolute;left:27%;bottom:32px;font-size:28px;">🏭</span>' +
          '<span style="position:absolute;left:45%;bottom:35px;font-size:28px;">🏡</span>' +
          '<span style="position:absolute;left:63%;bottom:30px;font-size:32px;">🌳</span>' +
          '<span style="position:absolute;left:78%;bottom:33px;font-size:24px;">🌾</span>' +
          '<span id="fhCrops" style="position:absolute;left:0;right:0;bottom:4px;font-size:17px;letter-spacing:3px;text-align:center;white-space:nowrap;overflow:hidden;"></span>' +
          '</div>' +
          '<div id="farmHomesteadChips" style="display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px 12px;"></div>';
        leftCol.appendChild(hs);
      }
    },
    farmThemed: false,
    injectFarmTheme() {
      this.injectCSS();
      if (this.farmThemed) { this.updateFarmBar(); return; }
      const screen = document.getElementById('farmScreen');
      if (!screen) return;
      this.farmThemed = true;
      const bar = document.createElement('div');
      bar.id = 'v5FarmBar';
      const topBar = screen.querySelector('.farm-top-bar');
      topBar.parentNode.insertBefore(bar, topBar.nextSibling);
      this.updateFarmBar();
      setInterval(() => this.updateFarmBar(), 700);
    },
    updateFarmBar() {
      const bar = document.getElementById('v5FarmBar');
      const screen = document.getElementById('farmScreen');
      if (!bar || !screen || screen.classList.contains('hidden')) return;
      CharacterSystem.init();
      const lv = GameState.level;
      const need = CharacterSystem.expNeeded(lv);
      const cult = Math.floor(GameState.cultivation || 0);
      const pct = Math.max(0, Math.min(100, Math.round(cult / need * 100)));
      const slots = CharacterSystem.slotCount();
      let hint = '';
      const nextLv = lv + 1;
      if (lv >= 100) hint = '已达满级';
      else if (nextLv % 20 === 0 || nextLv === 100) hint = CharacterSystem.breakthroughMet(nextLv) ? '突破条件已达成，可立即突破！' : '突破：' + CharacterSystem.breakthroughText(nextLv);
      else hint = '下一级：' + CharacterSystem.goldNeeded(lv) + ' 金 · 泥土×' + CharacterSystem.soilNeeded(lv) + ' 清水×' + CharacterSystem.waterNeeded(lv) + (CharacterSystem.compostNeeded(lv) > 0 ? ' 堆肥×' + CharacterSystem.compostNeeded(lv) : '');
      const res = id => (typeof ResourceSystem !== 'undefined') ? ResourceSystem.count(id) : 0;
      bar.innerHTML =
        '<span class="v5lv">Lv.' + lv + '</span>' +
        '<div class="v5expwrap"><div style="display:flex;justify-content:space-between;font-size:11px;color:#a8a084;"><span>修为 ' + cult + ' / ' + need + '</span><span>' + pct + '%</span></div>' +
        '<div class="v5expbar"><i style="width:' + pct + '%"></i></div></div>' +
        '<span style="font-size:12px;color:#a8a084;">技能卡槽 ' + slots + '/5</span>' +
        '<span class="v5hint">' + hint + '</span>' +
        '<span class="v5res">' +
        '<span>' + ((typeof CropArt!=='undefined')?CropArt.dom('soil','🟫',16):'🟫') + ' 泥土 ' + res('soil') + '</span><span>' + ((typeof CropArt!=='undefined')?CropArt.dom('water','💧',16):'💧') + ' 清水 ' + res('water') + '</span><span>' + ((typeof CropArt!=='undefined')?CropArt.dom('compost','🍂',16):'🍂') + ' 堆肥 ' + res('compost') + '</span>' +
        '<span>' + ((typeof CropArt!=='undefined')?CropArt.dom('wood','🪵',16):'🪵') + ' 木材 ' + res('wood') + '</span><span>' + ((typeof CropArt!=='undefined')?CropArt.dom('iron','⛏️',16):'⛏️') + ' 铁矿 ' + res('iron') + '</span><span>' + ((typeof CropArt!=='undefined')?CropArt.dom('crystal','💠',16):'💠') + ' 晶核 ' + res('crystal') + '</span>' +
        '</span>';
      // v5.4 家园全景实时数据
      const hsChips = document.getElementById('farmHomesteadChips');
      if (hsChips) {
        const plots = GameState.farmPlots || [];
        const total = plots.length || 48;
        let planted = 0, ready = 0;
        const cropIcons = [];
        plots.forEach(pl => {
          if (pl && pl.crop) {
            planted++;
            const cdef = (CONFIG.crops || []).find(c => c.id === pl.crop) || (CONFIG.greenhousePlants || []).find(c => c.id === pl.crop);
            if (pl.ready) { ready++; if (cdef) cropIcons.push(cdef.icon || '🌱'); }
            else if (cdef) cropIcons.push('🌱');
          }
        });
        const astats = (typeof AchievementSystem !== 'undefined' && AchievementSystem.getStats) ? AchievementSystem.getStats() : (GameState.achievements && GameState.achievements.stats) || {};
        const harvests = astats.harvests || 0;
        const streak = astats.consecutiveExtracts || 0;
        const beauty = GameState.farmBeauty || 0;
        const chip = (t, c) => '<span style="background:rgba(255,255,255,.06);border:1px solid rgba(185,209,138,.25);color:' + c + ';border-radius:999px;padding:3px 10px;font-size:11px;">' + t + '</span>';
        hsChips.innerHTML =
          chip('农田 ' + planted + '/' + total, '#cfe6a0') +
          chip('成熟 ' + ready, ready > 0 ? '#ffd76a' : '#9aa08c') +
          chip('累计收获 ' + harvests, '#b9d18a') +
          chip('美观度 ' + beauty + ' · ' + ((typeof FarmDecorationSystem!=='undefined')?FarmDecorationSystem.tier():0) + '档', '#e6bd54') +
          chip('连续撤离 ' + streak, '#9fd8ff');
        const fhCrops = document.getElementById('fhCrops');
        if (fhCrops) fhCrops.textContent = cropIcons.slice(-16).join(' ');
        let fhDeco = document.getElementById('fhDeco');
        const sceneEl = fhCrops ? fhCrops.parentElement : null;
        if (sceneEl && !fhDeco) { fhDeco = document.createElement('span'); fhDeco.id = 'fhDeco'; fhDeco.style.cssText = 'position:absolute;left:0;right:0;bottom:22px;text-align:center;font-size:16px;letter-spacing:6px;white-space:nowrap;overflow:hidden;'; sceneEl.appendChild(fhDeco); }
        if (fhDeco) fhDeco.textContent = (GameState.decorations || []).slice(0, 14).map(d => d.icon || '🌷').join(' ');
      }
    },
  };
  V5.openCultivation = () => V5.ui.openCultivation();
  V5.openArchive = () => V5.ui.openArchive();
  V5.openCodex = (t) => V5.ui.openCodex(t);

  /* ----------------------------------------------------------
   *  启动初始化
   * -------------------------------------------------------- */
  function boot() {
    try {
      CharacterSystem.init();
      ResourceSystem.seedStarting();
      CharacterSystem.checkUnlocks();
      V5.ui.mountFarm();
      V5.ui.injectFarmTheme();
    } catch (e) { console.error('[v5] boot error', e); }
  }
  // 农场每次渲染后重新挂载（facility-grid 是动态渲染的）
  document.addEventListener('click', () => setTimeout(() => { try { V5.ui.mountFarm(); } catch (e) {} }, 60), true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  // 暴露给控制台调试
  V5.CharacterSystem = CharacterSystem; V5.ResourceSystem = ResourceSystem; V5.ArchiveSystem = ArchiveSystem; V5.SKILLS = SKILLS;
})();
