const CONFIG = {
  ruleset_id: 'farm-cards-expedition-v1.9',
  canvas: { width: 1280, height: 720 },
  player: {
    maxHp: 100, maxEnergy: 100, speed: 220,
    sprintSpeed: 380, sprintCost: 30,
    radius: 16, collisionRadius: 11, attackDamage: 12, attackRange: 60, attackCooldown: 0.5,
    energyRegen: 15
  },
  weapons: [
    { id: 'harvest_sickle', name: '丰收镰刃', shortName: '镰刃', icon: '镰', mode: 'melee',
      damage: 18, range: 82, cooldown: 0.46, color: '#f2c45b', description: '宽幅近战，可短暂打断敌人' },
    { id: 'pea_repeater', name: '豌豆连弩', shortName: '连弩', icon: '弩', mode: 'ranged',
      damage: 11, range: 470, cooldown: 0.28, projectileSpeed: 620, color: '#75dc68', description: '快速远射，适合持续压制' },
    { id: 'vine_staff', name: '藤芯法杖', shortName: '法杖', icon: '杖', mode: 'pierce',
      damage: 24, range: 390, cooldown: 0.72, projectileSpeed: 440, pierce: 2, color: '#7be5c4', description: '灵藤波可贯穿多个目标' }
  ],
  expedition: {
    duration: 720,
    demoDuration: 720, // v1.3 统一对局时限：12分钟
    mapSize: 2400,
    extractTime: 15,
    signalExtractTime: 20
  },
  maps: [
    { id: 't1', name: '荒废野田', tier: 1, entryFee: 50, danger: '低危',
      monsterCount: 6, chestCount: 5, raiderCount: 0,
      rareSeedChance: 0.02, legendarySeedChance: 0,
      bgColor: '#4d6848', accentColor: '#8eae70',
       background: null, gridSize: 48, gridColor: '#526d55', majorGridColor: '#6f8d70',
      terrain: { ground: '#384a35', soil: '#5b4934', path: '#807459', water: '#385a5c', glow: '#6f875b', decor: ['🌾','🌿','🪨','🌳','🪵'] } },
    { id: 't2', name: '废弃小农庄', tier: 2, entryFee: 250, danger: '中危',
      monsterCount: 10, chestCount: 7, raiderCount: 1,
      rareSeedChance: 0.10, legendarySeedChance: 0.01,
      bgColor: '#625d49', accentColor: '#c1a76b',
       background: null, gridSize: 48, gridColor: '#655e49', majorGridColor: '#887b59',
      terrain: { ground: '#4b4737', soil: '#6a5036', path: '#8c8065', water: '#425a57', glow: '#8e7950', decor: ['🌻','🪨','🛖','🪵','🌳'] } },
    { id: 't3', name: '灾变农田', tier: 3, entryFee: 800, danger: '高危',
      monsterCount: 15, chestCount: 9, raiderCount: 2,
      rareSeedChance: 0.25, legendarySeedChance: 0.06,
      bgColor: '#514541', accentColor: '#bd7567',
       background: null, gridSize: 48, gridColor: '#5b6265', majorGridColor: '#7b8588',
      terrain: { ground: '#463b35', soil: '#5a342e', path: '#78634e', water: '#3d4a45', glow: '#9a695b', decor: ['🍄','🦴','🪨','🌵','☣️'] } },
    { id: 't4', name: '古老谷场', tier: 4, entryFee: 2000, danger: '绝境',
      monsterCount: 20, chestCount: 12, raiderCount: 3,
      rareSeedChance: 0.45, legendarySeedChance: 0.15,
      bgColor: '#3b414a', accentColor: '#938ba9',
       background: null, gridSize: 48, gridColor: '#414249', majorGridColor: '#62616d',
      terrain: { ground: '#2f3134', soil: '#3d3940', path: '#625f58', water: '#263842', glow: '#77708c', decor: ['🗿','🔮','🪨','🌲','✨'] } }
  ],
  skills: [
    { id: 'straw_smash', name: '稻草猛击', icon: '🌾', key: '1', type: 'active',
      color: '#e0b94d',
      cooldown: 3, energyCost: 20, damage: 35, range: 100, aoe: true,
      desc: '对周围敌人造成35点伤害' },
    { id: 'vine_bind', name: '藤蔓缠绕', icon: '🌿', key: '2', type: 'active',
      color: '#69ce78',
      cooldown: 8, energyCost: 30, damage: 0, range: 150, stunDuration: 2.5,
      desc: '定身范围内敌人2.5秒' },
    { id: 'earth_dash', name: '泥土遁走', icon: '💨', key: '3', type: 'active',
      color: '#64aee8',
      cooldown: 6, energyCost: 25, dashDistance: 200, invulnDuration: 0.8,
      desc: '短距离位移，短暂无敌' },
    { id: 'smoke_screen', name: '烟雾迷障', icon: '💨', key: '4', type: 'active',
      color: '#a184d8',
      cooldown: 15, energyCost: 40, stealthDuration: 3,
      desc: '隐身3秒，敌人失去目标' }
  ],
  consumables: [
    { id: 'herb_kit', name: '草药包扎包', icon: '💊', key: 'Q', value: 40,
      heal: 50, desc: '回复50点生命值' },
    { id: 'thorn_storm', name: '荆棘狂潮', icon: '🌵', key: 'R',
      value: 120, damage: 80, range: 180, aoe: true, desc: '大范围80点AOE伤害' },
    { id: 'signal_flare', name: '撤离信号弹', icon: '🔥', key: 'E', value: 280,
      desc: '就地召唤撤离点（需宝箱获取）' }
  ],
  monsters: {
    boar: { name: '野猪', icon: '🐗', hp: 60, damage: 15, speed: 140, radius: 18, collisionRadius: 15,
      attackRange: 40, attackCooldown: 1.2, xp: 10, gold: 8 },
    bat: { name: '腐翼蝙蝠', icon: '🦇', hp: 32, damage: 10, speed: 205, radius: 15, collisionRadius: 9,
      attackRange: 42, attackCooldown: 0.9, xp: 9, gold: 6, aerial: true },
    spider: { name: '毒雾蛛', icon: '🕷️', hp: 44, damage: 13, speed: 108, radius: 17, collisionRadius: 13,
      attackRange: 260, attackCooldown: 1.65, ranged: true, xp: 11, gold: 8 },
    locust: { name: '巨型蝗虫', icon: '🦗', hp: 35, damage: 8, speed: 160, radius: 14,
      attackRange: 200, attackCooldown: 1.8, ranged: true, xp: 8, gold: 5 },
    wolf: { name: '野狼', icon: '🐺', hp: 50, damage: 12, speed: 180, radius: 16,
      attackRange: 35, attackCooldown: 1.0, xp: 12, gold: 10 }
  },
  crops: [
    { id: 'pea_shooter', name: '豌豆射手', icon: '🫛', growTime: 24, sellPrice: 12, seedPrice: 8, rarity: 'rare', cardChance: 1, upgradeSkill: 'straw_smash', rewardType: 'attack_card', rewardLabel: '必得攻击卡' },
    { id: 'sunflower', name: '向日葵', icon: '🌻', growTime: 18, sellPrice: 45, seedPrice: 6, rarity: 'common', cardChance: 1, upgradeSkill: 'all', rewardType: 'skill_card', rewardLabel: '永久技能强化卡' },
    { id: 'watermelon', name: '西瓜', icon: '🍉', growTime: 36, sellPrice: 20, seedPrice: 15, rarity: 'rare', cardChance: 1, upgradeSkill: 'all', rewardType: 'consumable_skill_card', rewardLabel: '一次性技能卡' },
    { id: 'cabbage', name: '卷心菜', icon: '🥬', growTime: 28, sellPrice: 18, seedPrice: 10, rarity: 'common', cardChance: 0, upgradeSkill: 'earth_dash', rewardType: 'healing', rewardLabel: '草药包扎包' },
    { id: 'wheat', name: '小麦', icon: '🌾', growTime: 15, sellPrice: 15, seedPrice: 5, rarity: 'common', cardChance: 0, upgradeSkill: null, rewardType: 'gold', rewardLabel: '金币' },
    { id: 'carrot', name: '胡萝卜', icon: '🥕', growTime: 20, sellPrice: 25, seedPrice: 10, rarity: 'common', cardChance: 0.14, upgradeSkill: 'earth_dash' },
    { id: 'corn', name: '玉米', icon: '🌽', growTime: 30, sellPrice: 45, seedPrice: 15, rarity: 'rare', cardChance: 0.20, upgradeSkill: 'vine_bind' },
    { id: 'pumpkin', name: '南瓜', icon: '🎃', growTime: 45, sellPrice: 80, seedPrice: 25, rarity: 'rare', cardChance: 0.30, upgradeSkill: 'smoke_screen' },
    { id: 'moon_rice', name: '月光稻', icon: '✨', growTime: 60, sellPrice: 200, seedPrice: 0, rarity: 'legendary', cardChance: 0.58, upgradeSkill: 'all', rare: true }
  ],
  // 仓库物品定义
  warehouseItems: {
    // 作物类
    wheat: { name: '小麦', icon: '🌾', category: 'crop', sellPrice: 15, rarity: 'common' },
    pea_shooter: { name: '豌豆射手', icon: '🫛', category: 'crop', sellPrice: 12, rarity: 'rare' },
    sunflower: { name: '向日葵', icon: '🌻', category: 'crop', sellPrice: 45, rarity: 'common' },
    watermelon: { name: '西瓜', icon: '🍉', category: 'crop', sellPrice: 20, rarity: 'rare' },
    cabbage: { name: '卷心菜', icon: '🥬', category: 'crop', sellPrice: 18, rarity: 'common' },
    carrot: { name: '胡萝卜', icon: '🥕', category: 'crop', sellPrice: 25, rarity: 'common' },
    corn: { name: '玉米', icon: '🌽', category: 'crop', sellPrice: 45, rarity: 'rare' },
    pumpkin: { name: '南瓜', icon: '🎃', category: 'crop', sellPrice: 80, rarity: 'rare' },
    moon_rice: { name: '月光稻', icon: '✨', category: 'crop', sellPrice: 200, rarity: 'legendary' },
    // 资源类
    seeds: { name: '种子', icon: '🌱', category: 'resource' },
    materials: { name: '材料', icon: '🔧', category: 'resource' },
    // 消耗品类
    herb_kit: { name: '草药包扎包', icon: '💊', category: 'consumable' },
    thorn_storm: { name: '荆棘狂潮', icon: '🌵', category: 'consumable' },
    signal_flare: { name: '撤离信号弹', icon: '🔥', category: 'consumable' },
    growth_catalyst: { name: '生长催化剂', icon: '⏳', category: 'consumable' },
    // 温室掉落道具
    gold_card: { name: '金币卡', icon: '💰', category: 'consumable', sellPrice: 200 },
    big_gold_card: { name: '大金币卡', icon: '💎', category: 'consumable', sellPrice: 800 },
    transform_card: { name: '作物转化卡', icon: '🔄', category: 'consumable', sellPrice: 150 },
    rare_seed_pack: { name: '稀有种子包', icon: '🌱', category: 'consumable', sellPrice: 100 },
    exp_boost_card: { name: '经验加成卡', icon: '📈', category: 'consumable', sellPrice: 120 },
    weapon_upgrade_stone: { name: '武器强化石', icon: '⚔️', category: 'consumable', sellPrice: 300 }
  },
  // 育种温室 - 稀有植物
  greenhousePlants: [
    { id: 'golden_wheat', name: '黄金小麦', icon: '🌟', growTime: 90, rarity: 'rare', seedPrice: 50,
      desc: '闪耀着金光的小麦，成熟后有概率产出金币卡和催化剂',
      drops: [
        { id: 'gold_card', chance: 0.6, amount: 1 },
        { id: 'growth_catalyst', chance: 0.4, amount: 1 },
        { id: 'gold', chance: 0.8, amount: [80, 150] }
      ]},
    { id: 'crystal_corn', name: '水晶玉米', icon: '💎', growTime: 150, rarity: 'epic', seedPrice: 120,
      desc: '晶莹剔透的玉米，能产出作物转化卡和大量金币',
      drops: [
        { id: 'gold_card', chance: 0.5, amount: 1 },
        { id: 'transform_card', chance: 0.5, amount: 1 },
        { id: 'growth_catalyst', chance: 0.3, amount: 1 },
        { id: 'gold', chance: 0.9, amount: [150, 300] }
      ]},
    { id: 'rainbow_pumpkin', name: '彩虹南瓜', icon: '🎃', growTime: 200, rarity: 'epic', seedPrice: 200,
      desc: '七彩斑斓的南瓜，蕴含着转化的魔力',
      drops: [
        { id: 'big_gold_card', chance: 0.4, amount: 1 },
        { id: 'transform_card', chance: 0.6, amount: 1 },
        { id: 'growth_catalyst', chance: 0.5, amount: [1, 2] },
        { id: 'gold', chance: 1, amount: [200, 400] }
      ]},
    { id: 'moonlight_rice', name: '月光稻', icon: '🌙', growTime: 280, rarity: 'legendary', seedPrice: 400,
      desc: '只在月光下生长的神秘稻子，产出传说级奖励',
      drops: [
        { id: 'big_gold_card', chance: 0.6, amount: 1 },
        { id: 'transform_card', chance: 0.5, amount: 1 },
        { id: 'growth_catalyst', chance: 0.7, amount: [1, 3] },
        { id: 'rare_seed_pack', chance: 0.3, amount: 1 },
        { id: 'gold', chance: 1, amount: [400, 800] }
      ]},
    { id: 'void_mushroom', name: '虚空蘑菇', icon: '🍄', growTime: 180, rarity: 'rare', seedPrice: 80,
      desc: '来自虚空的蘑菇，能产出经验加成和神秘道具',
      drops: [
        { id: 'gold_card', chance: 0.4, amount: 1 },
        { id: 'exp_boost_card', chance: 0.5, amount: 1 },
        { id: 'growth_catalyst', chance: 0.3, amount: 1 },
        { id: 'gold', chance: 0.7, amount: [100, 200] }
      ]},
    { id: 'thunder_dragon_fruit', name: '雷龙果', icon: '⚡', growTime: 350, rarity: 'legendary', seedPrice: 600,
      desc: '蕴含雷龙之力的果实，能强化武器和产出巨额奖励',
      drops: [
        { id: 'big_gold_card', chance: 0.7, amount: 1 },
        { id: 'transform_card', chance: 0.4, amount: 1 },
        { id: 'weapon_upgrade_stone', chance: 0.4, amount: 1 },
        { id: 'growth_catalyst', chance: 0.5, amount: [2, 4] },
        { id: 'gold', chance: 1, amount: [600, 1200] }
      ]}
  ],
  // 温室掉落道具
  greenhouseDrops: {
    gold_card: { name: '金币卡', icon: '💰', desc: '使用获得500金币', value: 500, category: 'consumable', sellPrice: 200 },
    big_gold_card: { name: '大金币卡', icon: '💎', desc: '使用获得2000金币', value: 2000, category: 'consumable', sellPrice: 800 },
    transform_card: { name: '作物转化卡', icon: '🔄', desc: '将一块普通作物转化为随机稀有作物', category: 'consumable', sellPrice: 150 },
    rare_seed_pack: { name: '稀有种子包', icon: '🌱', desc: '随机获得一种稀有植物种子', category: 'consumable', sellPrice: 100 },
    exp_boost_card: { name: '经验加成卡', icon: '📈', desc: '下次远征击杀经验+50%', category: 'consumable', sellPrice: 120 },
    weapon_upgrade_stone: { name: '武器强化石', icon: '⚔️', desc: '永久提升当前武器伤害10%', category: 'consumable', sellPrice: 300 }
  }
};

// ==================== 游戏状态 ====================
const GameState = {
  screen: 'menu', // menu, farm, expedition, result
  gold: 500,
  seeds: 3,
  materials: 0,
  farmPlots: [], // 6x6 = 36格
  unlockedPlots: 8,
  selectedCrop: 'wheat',
  unlockedCrops: ['pea_shooter', 'sunflower', 'watermelon', 'cabbage', 'wheat'],
  skillLevels: { straw_smash: 1, vine_bind: 1, earth_dash: 1, smoke_screen: 1 },
  cardInventory: [],
  selectedBoostCards: [],
  selectedMap: 't1',
  selectedWeapon: 'harvest_sickle',
  loadout: { herb_kit: 2, thorn_storm: 1, signal_flare: 0 },
  farmItems: { growth_catalyst: 0 },
  warehouse: { capacity: 50, items: {} },
  greenhouse: {
    plots: [],
    unlockedPlots: 4,
    selectedPlant: 'golden_wheat',
    unlockedPlants: ['golden_wheat', 'void_mushroom'],
    weaponBonus: 0
  },
  lastDailyClaim: '',
  dailyStreak: 0,
  lastReliefClaim: '',
  expedition: null,
  lastTime: 0
};

// ==================== 本地存档 ====================
