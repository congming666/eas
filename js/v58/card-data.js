/* =============================================================================
 * v5.8 卡牌数据（纯数据，纯逻辑）
 * 严格遵守 docs/v58-card-spec.md §2/§3/§4/§6/§7。
 * 浏览器挂 window.CARD_DATA；node 下 module.exports。不操作 DOM。
 * ========================================================================== */
(function (global) {
  'use strict';

  /* ---------------- 8 流派（冻结） ---------------- */
  // counter[x] = x 克制的流派（伤害 +25%）。环：fire→summon→poison→armor→bleed→wind→lightning→ice→fire
  var FACTIONS = {
    fire:      { id: 'fire',      name: '烈焰燃烧', counterTo: 'summon'   },
    ice:       { id: 'ice',       name: '寒冰控制', counterTo: 'fire'     },
    lightning: { id: 'lightning', name: '雷鸣连锁', counterTo: 'ice'      },
    poison:    { id: 'poison',    name: '剧毒蔓延', counterTo: 'armor'    },
    summon:    { id: 'summon',    name: '召唤园艺', counterTo: 'poison'   },
    bleed:     { id: 'bleed',     name: '流血处决', counterTo: 'wind'     },
    armor:     { id: 'armor',     name: '铁甲坚守', counterTo: 'bleed'    },
    wind:      { id: 'wind',      name: '疾风机动', counterTo: 'lightning' }
  };

  // 攻击方 element 对 防御方 element 的伤害倍率：克制 +25%，被克 -25%
  var COUNTER = (function () {
    var m = {};
    var order = ['fire', 'summon', 'poison', 'armor', 'bleed', 'wind', 'lightning', 'ice'];
    order.forEach(function (atk, i) {
      var def = order[(i + 1) % order.length]; // atk 克 def
      m[atk] = m[atk] || {};
      m[atk][def] = 1.25;
      m[def] = m[def] || {};
      m[def][atk] = 0.75; // def 被 atk 克 → def 打 atk 是 -25%
    });
    return m;
  })();

  /* ---------------- 4 稀有度（冻结） ---------------- */
  // inscribe: 撤离铭记概率（§8 普通25/稀有15/史诗8；传说=Boss蓝图必成=1.0）
  var RARITIES = {
    common:    { id: 'common',    name: '普通', power: 1, inscribe: 0.25 },
    rare:      { id: 'rare',      name: '稀有', power: 2, inscribe: 0.15 },
    epic:      { id: 'epic',      name: '史诗', power: 3, inscribe: 0.08 },
    legendary: { id: 'legendary', name: '传说', power: 4, inscribe: 1.0  }
  };
  var RARITY_ORDER = ['common', 'rare', 'epic', 'legendary'];

  /* ---------------- 武器流派标签（§3 提示） ---------------- */
  var WEAPON_TAGS = {
    harvest_sickle: 'bleed',
    pea_repeater: 'summon',
    vine_staff: 'summon',
    throwing_knife: 'bleed',
    flame_bow: 'fire'
  };

  /* ---------------- 工具标签（非流派，仅作卡面描述） ---------------- */
  // tags[0] 永远是流派 element；后续为下列工具标签之一（单测校验合法）
  var UTILITY_TAGS = ['aoe', 'heal', 'shield', 'dash', 'stealth', 'control', 'buff', 'vision', 'throw', 'dot', 'summon_unit', 'special'];

  /* ================= 16 技能卡（§3 流派归属冻结） ================= */
  var skills = {
    chili_breath: { defId: 'chili_breath', type: 'skill', name: '辣椒火息', icon: '🌶️', rarity: 'rare',
      tags: ['fire', 'cone', 'dot'], element: 'fire',
      desc: '锥形火焰持续灼烧，附加燃烧。',
      effect: { energy: 34, cd: 7, range: 170, dmg: 22, burn: 14, burnDur: 3, cone: 0.9, kind: 'cone' },
      niche: '近距离扇形持续灼烧，火起手叠燃烧层数。', source: 'farm:chili' },
    frost_barrier: { defId: 'frost_barrier', type: 'skill', name: '寒冰屏障', icon: '🧊', rarity: 'rare',
      tags: ['ice', 'shield', 'control'], element: 'ice',
      desc: '获得护盾，近身敌人被减速。',
      effect: { energy: 38, cd: 13, range: 110, dmg: 8, shield: 90, slow: 0.4, duration: 6, kind: 'frost' },
      niche: '冰系保命护盾+近身减速，为冰控流核心。', source: 'farm:frost_flower' },
    thunder_chain: { defId: 'thunder_chain', type: 'skill', name: '雷霆链', icon: '⚡', rarity: 'epic',
      tags: ['lightning', 'aoe'], element: 'lightning',
      desc: '闪电在最多 5 个敌人间跳跃。',
      effect: { energy: 42, cd: 9, range: 420, dmg: 34, jumps: 5, jumpRange: 190, kind: 'chain' },
      niche: '群居怪群伤连锁，潮湿/冰目标额外增强。', source: 'farm:lightning_vine' },
    poison_mist: { defId: 'poison_mist', type: 'skill', name: '毒雾蔓延', icon: '☠️', rarity: 'epic',
      tags: ['poison', 'aoe', 'dot'], element: 'poison',
      desc: '指定点毒云，持续伤害并致盲。',
      effect: { energy: 46, cd: 15, range: 380, radius: 120, dmg: 16, dot: 10, duration: 4, blind: true, kind: 'poison' },
      niche: '区域持续毒伤+致盲，毒蔓延流的铺场核心。', source: 'farm:deathcap' },
    pea_storm: { defId: 'pea_storm', type: 'skill', name: '豌豆风暴', icon: '🌀', rarity: 'epic',
      tags: ['summon', 'aoe'], element: 'summon',
      desc: '3 秒内连续发射速射弹幕。',
      effect: { energy: 40, cd: 12, range: 520, dmg: 10, duration: 3, kind: 'channel_peas' },
      niche: '站桩持续弹幕压血，召唤园艺系输出。', source: 'farm:pea_shooter' },
    vine_bind: { defId: 'vine_bind', type: 'skill', name: '藤蔓缠绕', icon: '🌿', rarity: 'common',
      tags: ['summon', 'control'], element: 'summon',
      desc: '藤蔓缠绕周围敌人，定身并造成少量伤害。',
      effect: { energy: 26, cd: 6, range: 150, dmg: 12, stun: 2.5, kind: 'root' },
      niche: '新手群体定身，召唤系起手控制。', source: 'start' },
    healing_rain: { defId: 'healing_rain', type: 'skill', name: '治愈甘霖', icon: '🌦️', rarity: 'epic',
      tags: ['summon', 'heal'], element: 'summon',
      desc: '5 秒范围持续回血。',
      effect: { energy: 44, cd: 16, range: 120, hot: 14, duration: 5, kind: 'heal' },
      niche: '群体持续回血，长线远征续航。', source: 'farm:ginseng' },
    sun_drum: { defId: 'sun_drum', type: 'skill', name: '骄阳战鼓', icon: '🥁', rarity: 'legendary',
      tags: ['summon', 'buff'], element: 'summon',
      desc: '10 秒攻速/移速提升。',
      effect: { energy: 40, cd: 18, atkSpd: 0.3, moveSpd: 0.2, duration: 10, kind: 'drum' },
      niche: '团队/自身爆发窗口 buff，召唤流增益核心。', source: 'boss:t4_moon_priestess' },
    death_scythe: { defId: 'death_scythe', type: 'skill', name: '死神镰舞', icon: '🌀', rarity: 'legendary',
      tags: ['bleed', 'aoe'], element: 'bleed',
      desc: '3 秒旋转斩，持续绞杀周围敌人。',
      effect: { energy: 70, cd: 24, range: 120, dmg: 48, duration: 3, kind: 'channel_scythe' },
      niche: '近身高耗能绞杀，流血处决流大招。', source: 'boss:t4_abyss_lord' },
    straw_smash: { defId: 'straw_smash', type: 'skill', name: '稻草猛击', icon: '🌾', rarity: 'common',
      tags: ['bleed', 'aoe', 'control'], element: 'bleed',
      desc: '横扫周围敌人造成伤害并短暂眩晕。',
      effect: { energy: 20, cd: 3, range: 95, dmg: 35, stun: 0.5, kind: 'aoe' },
      niche: '低能量短CD近身横扫，开荒起手技。', source: 'start' },
    iron_armor: { defId: 'iron_armor', type: 'skill', name: '金刚藤甲', icon: '🛡️', rarity: 'legendary',
      tags: ['armor', 'shield'], element: 'armor',
      desc: '6 秒减伤 50% 且霸体（不受硬直）。',
      effect: { energy: 48, cd: 20, reduce: 0.5, duration: 6, kind: 'armor' },
      niche: '高压波次硬扛，铁甲坚守流主动防御。', source: 'boss:t2_ruin_golem' },
    thorn_burst: { defId: 'thorn_burst', type: 'skill', name: '荆棘爆发', icon: '🌵', rarity: 'rare',
      tags: ['armor', 'aoe'], element: 'armor',
      desc: '8 秒反伤光环，近身敌人持续受创。',
      effect: { energy: 36, cd: 14, range: 95, reflect: 0.5, thornsDps: 16, duration: 8, kind: 'thorns' },
      niche: '反伤光环反制贴脸怪。', source: 'farm:cactus' },
    earth_slam: { defId: 'earth_slam', type: 'skill', name: '裂地猛击', icon: '💥', rarity: 'epic',
      tags: ['armor', 'aoe', 'control'], element: 'armor',
      desc: '猛砸鼠标指定点，范围伤害并眩晕。',
      effect: { energy: 42, cd: 10, range: 360, radius: 95, dmg: 60, stun: 1.2, kind: 'slam' },
      niche: '定点范围爆发+眩晕，铁甲流开团。', source: 'boss:t1_quarry' },
    earth_dash: { defId: 'earth_dash', type: 'skill', name: '泥土遁走', icon: '💨', rarity: 'common',
      tags: ['wind', 'dash'], element: 'wind',
      desc: '向鼠标方向突进，过程无敌。',
      effect: { energy: 22, cd: 4.5, dash: 200, invuln: 0.8, kind: 'dash' },
      niche: '短CD无敌位移，疾风机动脱战核心。', source: 'start' },
    smoke_screen: { defId: 'smoke_screen', type: 'skill', name: '烟幕诀', icon: '💨', rarity: 'common',
      tags: ['wind', 'stealth'], element: 'wind',
      desc: '释放烟幕进入隐身，怪物丢失目标。',
      effect: { energy: 30, cd: 9, stealth: 3, kind: 'stealth' },
      niche: '隐身脱战/重置仇恨，风筝拉扯。', source: 'start' },
    gale_slash: { defId: 'gale_slash', type: 'skill', name: '疾风斩', icon: '🗡️', rarity: 'rare',
      tags: ['wind', 'dash'], element: 'wind',
      desc: '突进并留下穿透风刃。',
      effect: { energy: 30, cd: 6.5, range: 300, dmg: 30, dash: 120, blades: 2, kind: 'gale' },
      niche: '位移穿插+穿透风刃，机动输出。', source: 'boss:t4_arena_champion' }
  };

  /* ================= 27 道具卡（§5，niche 审计，不删卡） ================= */
  var items = {
    herb_kit: { defId: 'herb_kit', type: 'item', name: '草药包扎包', icon: '💊', rarity: 'common',
      tags: ['summon', 'heal'], element: 'summon', desc: '回复50点生命值。',
      effect: { heal: 50 }, niche: '前期廉价小血包，起手续航。', source: 'shop' },
    bread: { defId: 'bread', type: 'item', name: '面包', icon: '🍞', rarity: 'common',
      tags: ['summon', 'heal'], element: 'summon', desc: '立刻回复 80 点生命。',
      effect: { heal: 80 }, niche: '廉价中等回血，过渡用。', source: 'shop' },
    ketchup: { defId: 'ketchup', type: 'item', name: '番茄酱', icon: '🥫', rarity: 'common',
      tags: ['summon', 'heal'], element: 'summon', desc: '立刻回复 150 点生命。',
      effect: { heal: 150 }, niche: '中期稳定回血。', source: 'shop' },
    medkit: { defId: 'medkit', type: 'item', name: '急救包', icon: '🩹', rarity: 'rare',
      tags: ['summon', 'heal'], element: 'summon', desc: '立刻回复 200 点生命。',
      effect: { heal: 200 }, niche: '高额固定回血，硬仗兜底。', source: 'shop' },
    med_shot: { defId: 'med_shot', type: 'item', name: '急救针', icon: '💊', rarity: 'epic',
      tags: ['summon', 'heal'], element: 'summon', desc: '瞬间回复 50% 最大生命。',
      effect: { healPct: 0.5 }, niche: '后期高血量按比例回血，不随数值贬值。', source: 'shop' },
    ginseng_soup: { defId: 'ginseng_soup', type: 'item', name: '人参汤', icon: '🍲', rarity: 'epic',
      tags: ['summon', 'heal', 'buff'], element: 'summon', desc: '回满生命，60 秒攻击 +20%。',
      effect: { healFull: true, atkBuff: 0.2, duration: 60 }, niche: '反攻一体：满血+攻击窗口，boss 战前开。', source: 'farm:ginseng' },
    shield_gen: { defId: 'shield_gen', type: 'item', name: '护盾发生器', icon: '🛡️', rarity: 'rare',
      tags: ['armor', 'shield'], element: 'armor', desc: '获得 120 点护盾，持续 10 秒。',
      effect: { shield: 120, duration: 10 }, niche: '兽潮短时爆发前的窗口盾。', source: 'shop' },
    shield_elixir: { defId: 'shield_elixir', type: 'item', name: '冰心护盾药', icon: '🧊', rarity: 'epic',
      tags: ['armor', 'shield'], element: 'armor', desc: '获得 150 点护盾，直到被击破。',
      effect: { shield: 150, untilBreak: true }, niche: '长线持久盾，不被时间浪费。', source: 'shop' },
    war_horn: { defId: 'war_horn', type: 'item', name: '战吼号角', icon: '📯', rarity: 'rare',
      tags: ['summon', 'buff'], element: 'summon', desc: '放置图腾，12 秒内周围攻速 +40%。',
      effect: { atkSpd: 0.4, duration: 12, totem: true }, niche: '固定区域站桩输出阵。', source: 'shop' },
    rage_tonic: { defId: 'rage_tonic', type: 'item', name: '狂暴药剂', icon: '💉', rarity: 'rare',
      tags: ['bleed', 'buff'], element: 'bleed', desc: '8 秒伤害 +50%，但受伤 +15%。',
      effect: { dmgBuff: 0.5, takenBuff: 0.15, duration: 8 }, niche: '高风险换输出，有奶/盾兜底时用。', source: 'shop' },
    flame_elixir: { defId: 'flame_elixir', type: 'item', name: '赤炎药剂', icon: '🔥', rarity: 'rare',
      tags: ['fire', 'buff'], element: 'fire', desc: '12 秒攻击 +20%，并清除中毒。',
      effect: { atkBuff: 0.2, duration: 12, cleanse: 'poison' }, niche: '安全攻击增益+清毒净化。', source: 'shop' },
    egg: { defId: 'egg', type: 'item', name: '荒野鸡蛋', icon: '🥚', rarity: 'common',
      tags: ['fire', 'buff'], element: 'fire', desc: '120 秒内攻击 +15%。',
      effect: { atkBuff: 0.15, duration: 120 }, niche: '长效弱增益，进图常开。', source: 'farm' },
    mint_tea: { defId: 'mint_tea', type: 'item', name: '薄荷茶', icon: '🍵', rarity: 'common',
      tags: ['wind', 'buff'], element: 'wind', desc: '60 秒内移速 +15%。',
      effect: { moveSpd: 0.15, duration: 60 }, niche: '长距离赶路/拉扯机动。', source: 'farm:mint' },
    wraith_draft: { defId: 'wraith_draft', type: 'item', name: '幽魂秘药', icon: '🪻', rarity: 'epic',
      tags: ['wind', 'stealth'], element: 'wind', desc: '隐身 5 秒，怪物丢失目标。',
      effect: { stealth: 5 }, niche: '完整隐身脱战，穿怪群/救场。', source: 'shop' },
    insecticide: { defId: 'insecticide', type: 'item', name: '驱虫剂', icon: '🧪', rarity: 'common',
      tags: ['wind', 'stealth'], element: 'wind', desc: '6 秒内身边怪物丢失目标（驱虫脱身），也可在农场治疗病虫害。',
      effect: { loseTarget: 6, farmPest: true }, niche: '双用途：局内脱身+农场治虫。', source: 'farm' },
    beartrap_item: { defId: 'beartrap_item', type: 'item', name: '捕兽夹', icon: '🪤', rarity: 'common',
      tags: ['armor', 'control'], element: 'armor', desc: '在鼠标位置放置，定身踩中的敌人 3 秒。',
      effect: { root: 3, place: true }, niche: '定点定身，保护阵型/boss 阶段。', source: 'shop' },
    rotting_bait: { defId: 'rotting_bait', type: 'item', name: '腐肉诱饵', icon: '🍖', rarity: 'common',
      tags: ['poison', 'control'], element: 'poison', desc: '扔向鼠标点，吸引怪物聚集 8 秒。',
      effect: { gather: 8 }, niche: '聚怪配合 AOE 一波清。', source: 'shop' },
    scout_eagle: { defId: 'scout_eagle', type: 'item', name: '侦察鹰', icon: '🦅', rarity: 'common',
      tags: ['wind', 'vision'], element: 'wind', desc: '8 秒内视野大幅扩大并驱散迷雾。',
      effect: { reveal: 8 }, niche: '开雾探路，避免踩怪。', source: 'shop' },
    torch: { defId: 'torch', type: 'item', name: '火把', icon: '🔥', rarity: 'common',
      tags: ['fire', 'vision'], element: 'fire', desc: '限时照明，无火把视野极小。',
      effect: { light: true, durationByDifficulty: true }, niche: '黑暗图刚需视野。', source: 'shop' },
    energy_cell: { defId: 'energy_cell', type: 'item', name: '能量电池', icon: '🔋', rarity: 'rare',
      tags: ['lightning'], element: 'lightning', desc: '瞬间回满能量。',
      effect: { energyFull: true }, niche: '空能量救急立刻甩大。', source: 'shop' },
    grape_juice: { defId: 'grape_juice', type: 'item', name: '葡萄能量饮', icon: '🍇', rarity: 'rare',
      tags: ['lightning', 'buff'], element: 'lightning', desc: '15 秒内能量回复翻倍。',
      effect: { energyRegenMult: 2, duration: 15 }, niche: '短窗口高频甩技能。', source: 'farm' },
    juice: { defId: 'juice', type: 'item', name: '西瓜汁', icon: '🧃', rarity: 'common',
      tags: ['lightning', 'buff'], element: 'lightning', desc: '本局能量上限 +40 并回满。',
      effect: { energyCap: 40, energyFull: true }, niche: '抬能量上限，配合高耗能大招。', source: 'farm' },
    thorn_storm: { defId: 'thorn_storm', type: 'item', name: '荆棘狂潮', icon: '🌵', rarity: 'rare',
      tags: ['armor', 'aoe', 'throw'], element: 'armor', desc: '大范围 80 点 AOE 伤害。',
      effect: { aoe: true, dmg: 80, range: 180 }, niche: '即时纯 AOE 清群。', source: 'shop' },
    poison_bomb: { defId: 'poison_bomb', type: 'item', name: '毒雾弹', icon: '☠️', rarity: 'rare',
      tags: ['poison', 'aoe', 'throw', 'control'], element: 'poison', desc: '投掷后范围 60 伤害并减速 3 秒。',
      effect: { aoe: true, dmg: 60, slow: 3 }, niche: 'AOE+减速，毒流铺伤。', source: 'shop' },
    signal_flare: { defId: 'signal_flare', type: 'item', name: '撤离信号弹', icon: '🔥', rarity: 'rare',
      tags: ['wind', 'special'], element: 'wind', desc: '就地召唤撤离点（需宝箱获取）。',
      effect: { extractPoint: true }, niche: '提前开撤，保命撤退。', source: 'chest' },
    death_pardon: { defId: 'death_pardon', type: 'item', name: '免死令', icon: '📜', rarity: 'legendary',
      tags: ['armor', 'special'], element: 'armor', desc: '阵亡时自动消耗，免除一次降级。',
      effect: { autoSaveDowngrade: true }, niche: '高风险局兜底，自动免降级不占操作。', source: 'boss' },
    purify_tonic: { defId: 'purify_tonic', type: 'item', name: '净化药剂', icon: '🧴', rarity: 'common',
      tags: ['poison', 'special'], element: 'poison', desc: '清除自身减速/中毒等负面状态。',
      effect: { cleanse: ['slow', 'poison'] }, niche: '被毒/减速黏住时解控。', source: 'shop' }
  };

  /* ================= 24 种子卡（F1–F5 直接种植） ================= */
  function seed(defId, name, icon, element, grow, niche, source) {
    return { defId: defId, type: 'seed', name: name, icon: icon, rarity: 'common',
      tags: [element], element: element, desc: niche,
      effect: { growTime: grow, cropId: defId }, niche: niche, source: source || 'farm' };
  }
  var seeds = {
    wheat:          seed('wheat', '小麦', '🌾', 'summon', 15, '基础口粮，纤维/清水来源。', 'start'),
    rice:           seed('rice', '水稻', '🌾', 'summon', 28, '水田作物，资源中庸。'),
    moon_rice:      seed('moon_rice', '月光稻', '✨', 'summon', 60, '稀有修为/材料作物。'),
    ningqi_grass:   seed('ningqi_grass', '凝气草', '🌱', 'summon', 20, '新手修为作物。', 'start'),
    lingsui_wheat:  seed('lingsui_wheat', '灵穗麦', '🌾', 'summon', 60, 'Lv15 解锁修为作物。'),
    pea_shooter:    seed('pea_shooter', '豌豆射手', '🫛', 'summon', 24, '豌豆系召唤园艺原料。', 'start'),
    sunflower:      seed('sunflower', '向日葵', '🌻', 'summon', 18, '阳光/能量系原料。', 'start'),
    cabbage:        seed('cabbage', '卷心菜', '🥬', 'summon', 28, '基础蔬菜食材。', 'start'),
    carrot:         seed('carrot', '胡萝卜', '🥕', 'summon', 20, '早熟经济型。'),
    corn:           seed('corn', '玉米', '🌽', 'summon', 30, '中期口粮。'),
    pumpkin:        seed('pumpkin', '南瓜', '🎃', 'summon', 45, '高价值作物。'),
    watermelon:     seed('watermelon', '西瓜', '🍉', 'summon', 36, '高价值作物。', 'start'),
    ginseng:        seed('ginseng', '人参', '🫚', 'summon', 72, '人参汤原料，回血/反攻。'),
    tomato:         seed('tomato', '番茄', '🍅', 'fire', 22, '火系食材/颜料原料。'),
    chili:          seed('chili', '辣椒', '🌶️', 'fire', 12, '辣椒火息原料，火系起手。'),
    tinder_grass:   seed('tinder_grass', '火绒草', '🔥', 'fire', 22, '火系墨汁/火种原料。', 'start'),
    garlic:         seed('garlic', '大蒜', '🧄', 'poison', 25, '毒系/驱虫原料。'),
    deathcap:       seed('deathcap', '亡语菇', '🍄', 'poison', 48, '毒系高价值，毒雾蔓延原料。'),
    mint:           seed('mint', '薄荷', '🌿', 'wind', 14, '薄荷茶/疾风系原料。'),
    rosemary:       seed('rosemary', '迷迭香', '🌱', 'wind', 30, '疾风系香草。'),
    shadow_flower:  seed('shadow_flower', '暗影花', '🌑', 'wind', 45, '暗影/隐身系原料。'),
    cactus:         seed('cactus', '仙人掌', '🌵', 'armor', 35, '荆棘/铁甲系原料。'),
    frost_flower:   seed('frost_flower', '寒霜花', '❄️', 'ice', 30, '冰系原料，冰控流来源。'),
    lightning_vine: seed('lightning_vine', '电藤', '⚡', 'lightning', 36, '雷系原料，连锁闪电来源。')
  };

  /* ================= 12 Boss 签名卡（每个 boss 一张，必给蓝图） ================= */
  function sig(defId, bossId, name, icon, element, desc, effect, niche) {
    return { defId: defId, type: 'signature', bossId: bossId, name: name, icon: icon,
      rarity: 'legendary', tags: [element, 'special'], element: element, desc: desc,
      effect: effect, niche: niche, source: 'boss:' + bossId, signature: true, blueprint: true };
  }
  var signatures = {
    sig_boar_king:      sig('sig_boar_king', 't1_boar_king', '野猪王之冲撞', '🐗', 'bleed',
      '狂暴冲锋，路径敌人流血并被撞退。', { charge: 220, bleedOnHit: 3, stun: 0.5 }, '前期 boss 开荒签名，位移+流血。'),
    sig_withered:       sig('sig_withered', 't1_withered', '枯木缠魂', '🌳', 'summon',
      '召唤枯藤缠绕周围敌人并持续造成伤害。', { root: 2, dot: 12, duration: 4 }, '召唤系群体定身+毒藤。'),
    sig_quarry:         sig('sig_quarry', 't1_quarry', '投石巨力', '🪨', 'armor',
      '投掷巨石，落点范围伤害并眩晕。', { aoe: true, dmg: 90, radius: 100, stun: 1.0 }, '定点范围砸击。'),
    sig_gargoyle_lord:  sig('sig_gargoyle_lord', 't2_gargoyle_lord', '石像守护', '🗿', 'armor',
      '石化皮肤 5 秒，大幅减伤并反弹近身伤害。', { reduce: 0.6, reflect: 0.3, duration: 5 }, '高压减伤+反伤。'),
    sig_ruin_golem:     sig('sig_ruin_golem', 't2_ruin_golem', '魔像粉碎', '🗿', 'armor',
      '重拳粉碎前方扇形，破甲并附带碎裂 AOE。', { cone: 1.0, dmg: 120, armorBreak: 0.3 }, '破甲爆发。'),
    sig_swamp_hag:      sig('sig_swamp_hag', 't3_swamp_hag', '沼泽诅咒', '🐸', 'poison',
      '诅咒区域：敌人减速并持续中毒。', { slow: 0.5, dot: 18, duration: 5, radius: 130 }, '区域诅咒铺场。'),
    sig_brood_mother:   sig('sig_brood_mother', 't3_brood_mother', '虫群召唤', '🐛', 'summon',
      '召唤虫群撕咬前方敌人，数量随召唤协同提升。', { summonUnits: 6, dmg: 14, duration: 4 }, '召唤物数量爆发。'),
    sig_scorch_demon:   sig('sig_scorch_demon', 't3_scorch_demon', '焦林烈焰', '🔥', 'fire',
      '释放环形火浪，点燃范围内所有敌人。', { nova: true, dmg: 70, burn: 20, burnDur: 4 }, '群体点燃火浪。'),
    sig_abyss_lord:     sig('sig_abyss_lord', 't4_abyss_lord', '深渊吞噬', '🌑', 'poison',
      '牵引周围敌人至中心并造成暗影吞噬伤害。', { pull: 150, dmg: 150, dot: 25, duration: 3 }, '聚怪+高额持续吞噬。'),
    sig_time_warden:    sig('sig_time_warden', 't4_time_warden', '时缓领域', '⏳', 'ice',
      '展开时缓领域，领域内敌人攻速/移速大幅降低。', { slowField: 0.6, radius: 160, duration: 5 }, '强控领域减速。'),
    sig_moon_priestess: sig('sig_moon_priestess', 't4_moon_priestess', '月光甘霖', '🌙', 'summon',
      '月光笼罩：持续回血并提升攻速。', { hot: 30, atkSpd: 0.2, duration: 6 }, '群体回血+攻速 buff。'),
    sig_arena_champion: sig('sig_arena_champion', 't4_arena_champion', '冠军战姿', '🏆', 'wind',
      '冠军姿态：短 CD 连击突进，命中叠加移速。', { dash: 160, dmg: 55, stacks: 3, duration: 5 }, '机动连击叠层。')
  };

  /* ================= 词条池 affix（§6，含 affix_dmg5 / affix_recast5） ================= */
  // mods 为结构化数值；minRarity 为可出现的最低稀有度
  var affixes = {
    affix_dmg5:        { affixId: 'affix_dmg5', name: '伤害+5%', minRarity: 'common',    mods: { dmgMult: 0.05 } },
    affix_recast5:     { affixId: 'affix_recast5', name: '5%概率再次触发', minRarity: 'rare',  mods: { recastChance: 0.05 } },
    affix_movespeed:   { affixId: 'affix_movespeed', name: '移速+8%', minRarity: 'common',    mods: { moveSpeed: 0.08 } },
    affix_pickup:      { affixId: 'affix_pickup', name: '拾取范围+30%', minRarity: 'common', mods: { pickupRange: 0.30 } },
    affix_gold:        { affixId: 'affix_gold', name: '金币+10%', minRarity: 'common',        mods: { gold: 0.10 } },
    affix_exp:         { affixId: 'affix_exp', name: '经验+10%', minRarity: 'common',         mods: { exp: 0.10 } },
    affix_cdr8:        { affixId: 'affix_cdr8', name: '冷却-8%', minRarity: 'rare',          mods: { cdr: 0.08 } },
    affix_crit10:      { affixId: 'affix_crit10', name: '暴击率+10%', minRarity: 'rare',      mods: { critChance: 0.10 } },
    affix_lifesteal:   { affixId: 'affix_lifesteal', name: '击杀回血+8', minRarity: 'rare',   mods: { healOnKill: 8 } },
    affix_duration:    { affixId: 'affix_duration', name: '持续时间+20%', minRarity: 'rare', mods: { durationMult: 0.20 } },
    affix_range:       { affixId: 'affix_range', name: '范围+15%', minRarity: 'rare',         mods: { rangeMult: 0.15 } },
    affix_shieldheal:  { affixId: 'affix_shieldheal', name: '护盾/治疗+15%', minRarity: 'rare', mods: { shieldHealMult: 0.15 } },
    affix_burn:        { affixId: 'affix_burn', name: '附加燃烧', minRarity: 'epic',          mods: { onHit: { burnChance: 0.30, burnStack: 1 } } },
    affix_freeze:      { affixId: 'affix_freeze', name: '附加冰冻', minRarity: 'epic',        mods: { onHit: { freezeChance: 0.20 } } },
    affix_shock:       { affixId: 'affix_shock', name: '附加感电', minRarity: 'epic',         mods: { onHit: { shockChance: 0.25 } } },
    affix_bleed:       { affixId: 'affix_bleed', name: '附加流血', minRarity: 'epic',        mods: { onHit: { bleedChance: 0.30 } } },
    affix_costdown:    { affixId: 'affix_costdown', name: '能量消耗-10%', minRarity: 'epic',   mods: { costDown: 0.10 } },
    affix_aspd:        { affixId: 'affix_aspd', name: '攻速+12%', minRarity: 'epic',         mods: { aspd: 0.12 } },
    affix_execute:     { affixId: 'affix_execute', name: '处决阈值+10%', minRarity: 'legendary', mods: { executeThreshold: 0.10 } },
    affix_recast10:    { affixId: 'affix_recast10', name: '10%概率再次触发', minRarity: 'legendary', mods: { recastChance: 0.10 } },
    affix_dual_element:{ affixId: 'affix_dual_element', name: '双元素穿透', minRarity: 'legendary', mods: { secondElement: true } }
  };

  /* ================= 协同里程碑（§4，2/3/4/5 张触发） ================= */
  // at: 触发张数；count>=at 即激活该档（取满足条件的最高档）
  var synergy = {
    thresholds: [2, 3, 4, 5],
    factions: {
      fire: [
        { at: 2, id: 'fire2', name: '燃火', desc: '攻击 25% 概率点燃 1 层。', mods: { onHit: { burnChance: 0.25, burnStack: 1 } } },
        { at: 3, id: 'fire3', name: '烈焰燃烧', desc: '攻击附加燃烧并可叠层（40%/2层）。', mods: { onHit: { burnChance: 0.40, burnStack: 2 } } },
        { at: 4, id: 'fire4', name: '燎原', desc: '燃烧期间目标受到伤害 +10%。', mods: { burningTaken: 0.10 } },
        { at: 5, id: 'fire5', name: '暴击点燃', desc: '暴击必定点燃目标。', mods: { critIgnite: true } }
      ],
      ice: [
        { at: 2, id: 'ice2', name: '寒霜', desc: '攻击 15% 概率减速 20%。', mods: { onHit: { slowChance: 0.15, slowAmt: 0.20 } } },
        { at: 3, id: 'ice3', name: '寒冰控制', desc: '冻结时长 +0.5s，碎冰伤害 +50%。', mods: { freezeDur: 0.5, shatterDmg: 0.50 } },
        { at: 4, id: 'ice4', name: '深寒', desc: '被冻结目标受到伤害 +15%。', mods: { frozenTaken: 0.15 } },
        { at: 5, id: 'ice5', name: '绝对零度', desc: '冻结结束时爆发一次冰霜 AOE。', mods: { shatterNova: true } }
      ],
      lightning: [
        { at: 2, id: 'lightning2', name: '静电', desc: '攻击 15% 概率感电。', mods: { onHit: { shockChance: 0.15 } } },
        { at: 3, id: 'lightning3', name: '感电', desc: '附加感电并削减敌方能量/攻击 10%。', mods: { onHit: { shockChance: 0.30 }, enemyEnergyDrain: 0.10 } },
        { at: 4, id: 'lightning4', name: '连锁增强', desc: '对潮湿/水中目标跳跃 +2。', mods: { wetJumps: 2 } },
        { at: 5, id: 'lightning5', name: '雷暴', desc: '感电目标死亡时连锁放电。', mods: { shockDeathChain: true } }
      ],
      poison: [
        { at: 2, id: 'poison2', name: '淬毒', desc: '攻击 20% 概率中毒。', mods: { onHit: { poisonChance: 0.20 } } },
        { at: 3, id: 'poison3', name: '剧毒', desc: '毒伤 +25%。', mods: { dotMult: 0.25 } },
        { at: 4, id: 'poison4', name: '剧毒蔓延', desc: '敌人死亡时毒雾扩散。', mods: { deathNova: true } },
        { at: 5, id: 'poison5', name: '瘟疫', desc: '中毒目标每秒额外扩散给周围。', mods: { poisonSpread: true } }
      ],
      summon: [
        { at: 2, id: 'summon2', name: '藤甲', desc: '受到伤害 -15%。', mods: { damageTaken: -0.15 } },
        { at: 3, id: 'summon3', name: '繁茂', desc: '召唤物生命 +20%。', mods: { summonHp: 0.20 } },
        { at: 4, id: 'summon4', name: '召唤园艺', desc: '召唤物/攻速 +20%。', mods: { summonAspd: 0.20 } },
        { at: 5, id: 'summon5', name: '自然之怒', desc: '召唤物死亡时自爆。', mods: { summonBoom: true } }
      ],
      bleed: [
        { at: 2, id: 'bleed2', name: '见血', desc: '攻击 20% 概率流血。', mods: { onHit: { bleedChance: 0.20 } } },
        { at: 3, id: 'bleed3', name: '放血', desc: '流血伤害 +30%。', mods: { bleedMult: 0.30 } },
        { at: 4, id: 'bleed4', name: '失血', desc: '流血目标移速 -20%。', mods: { bleedSlow: 0.20 } },
        { at: 5, id: 'bleed5', name: '流血处决', desc: '流血爆伤 +50%；对低血量敌人触发处决。', mods: { bleedCrit: 0.50, execute: true } }
      ],
      armor: [
        { at: 2, id: 'armor2', name: '重甲', desc: '开战获得 30 点护盾。', mods: { startShield: 30 } },
        { at: 3, id: 'armor3', name: '铁甲坚守', desc: '开战叠甲 60，反伤 15%、减伤 10%。', mods: { startShield: 60, reflect: 0.15, damageTaken: -0.10 } },
        { at: 4, id: 'armor4', name: '不动', desc: '护盾存在时受治疗 +20%。', mods: { shieldedHeal: 0.20 } },
        { at: 5, id: 'armor5', name: '山崩', desc: '受击时 10% 概率反击 AOE。', mods: { thornsNova: true } }
      ],
      wind: [
        { at: 2, id: 'wind2', name: '轻盈', desc: '移速 +8%。', mods: { moveSpeed: 0.08 } },
        { at: 3, id: 'wind3', name: '疾风机动', desc: '冷却 -10%，移速 +10%。', mods: { cdr: 0.10, moveSpeed: 0.10 } },
        { at: 4, id: 'wind4', name: '残影', desc: '闪避 +10%。', mods: { dodge: 0.10 } },
        { at: 5, id: 'wind5', name: '无影', desc: '脱战后 2 秒内短暂隐身。', mods: { outOfCombatStealth: 2 } }
      ]
    }
  };

  var CARD_DATA = {
    factions: FACTIONS,
    counter: COUNTER,
    rarities: RARITIES,
    rarityOrder: RARITY_ORDER,
    weapons: WEAPON_TAGS,
    utilityTags: UTILITY_TAGS,
    skills: skills,
    items: items,
    seeds: seeds,
    signatures: signatures,
    affixes: affixes,
    synergy: synergy
  };

  /* ---------------- 双挂载：浏览器 window + node module.exports ---------------- */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CARD_DATA;
  }
  if (typeof global !== 'undefined') global.CARD_DATA = CARD_DATA;
  if (typeof window !== 'undefined') window.CARD_DATA = CARD_DATA;
})(typeof globalThis !== 'undefined' ? globalThis : this);
