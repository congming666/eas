// ==================== 版本号（唯一数据源） ====================
// 发版流程：node tools/bump-version.js [x.y.z]
//   带版本号参数：先更新此处，再同步 index.html 的标题、meta 与所有本地 js/css 的 ?v= 缓存戳；
//   不带参数：按当前版本刷新 index.html。
const GAME_NAME = '农庄牌：荒野远征';
const GAME_VERSION = '5.4.0';

const CONFIG = {
  version: GAME_VERSION,
  ruleset_id: 'farm-cards-expedition-v' + GAME_VERSION,
  canvas: { width: 1280, height: 720 },
  player: {
    maxHp: 100, maxEnergy: 100, speed: 220,
    sprintSpeed: 380, sprintCost: 30,
    radius: 16, collisionRadius: 11, attackDamage: 12, attackRange: 60, attackCooldown: 0.5,
    energyRegen: 15
  },
  weapons: [
    { id: 'harvest_sickle', name: '丰收镰刃', shortName: '镰刃', icon: '镰', img: 'docs/art/weapons/harvest_sickle.png', mode: 'melee',
      damage: 18, range: 82, cooldown: 0.46, color: '#f2c45b', description: '宽幅近战，可短暂打断敌人' },
    { id: 'pea_repeater', name: '豌豆连弩', shortName: '连弩', icon: '弩', img: 'docs/art/weapons/pea_repeater.png', mode: 'ranged',
      damage: 11, range: 470, cooldown: 0.28, projectileSpeed: 620, color: '#75dc68', description: '快速远射，适合持续压制' },
    { id: 'vine_staff', name: '藤芯法杖', shortName: '法杖', icon: '杖', img: 'docs/art/weapons/vine_staff.png', mode: 'pierce',
      damage: 24, range: 390, cooldown: 0.72, projectileSpeed: 440, pierce: 2, color: '#7be5c4', description: '灵藤波可贯穿多个目标' },
    // v1.0 蓝图武器（成就/Boss解锁）
    { id: 'throwing_knife', name: '飞刃', shortName: '飞刃', icon: '刃', img: 'docs/art/weapons/throwing_knife.png', mode: 'ranged', blueprint: true,
      damage: 16, range: 520, cooldown: 0.35, projectileSpeed: 800, color: '#c0c0e0', description: '高初速远程，攻速极快' },
    { id: 'flame_bow', name: '烈焰长弓', shortName: '火弓', icon: '弓', img: 'docs/art/weapons/flame_bow.png', mode: 'ranged', blueprint: true,
      damage: 32, range: 600, cooldown: 0.85, projectileSpeed: 550, color: '#ff6b35', description: '火焰箭矢，命中爆炸AOE' }
  ],
  materials: {
    iron: { name: '铁块', icon: '⛓️', desc: '武器锻造基础材料' },
    crystal: { name: '灵晶', icon: '💎', desc: '高级材料，法杖附魔用' },
    bossFang: { name: 'Boss獠牙', icon: '🦷', desc: 'Boss掉落，顶级升级用' },
    wood: { name: '硬木', icon: '🪵', desc: '基础材料' },
    herb: { name: '草药', icon: '🌿', desc: '消耗品材料' }
  },
  expedition: {
    duration: 720,
    demoDuration: 720, // v1.3 统一对局时限：12分钟
    mapSize: 2400,
    extractTime: 15,
    signalExtractTime: 20
  },
  maps: [
    // ===== T1 荒野（50金） =====
    { id: 't1_1', name: '荒废野田', tier: 1, entryFee: 50, danger: '低危', modifier: '标准',
      monsterCount: 12, chestCount: 5, raiderCount: 0,
      rareSeedChance: 0.02, legendarySeedChance: 0,
      bgImage: 'assets/maps/t1_1_wild_field.jpg',
      bgColor: '#4d6848', accentColor: '#8eae70',
      gridSize: 48, gridColor: '#526d55', majorGridColor: '#6f8d70',
      terrain: { ground: '#384a35', soil: '#5b4934', path: '#807459', water: '#385a5c', glow: '#6f875b', decor: ['🌾','🌿','🪨','🌳','🪵'] } },
    { id: 't1_2', name: '风车平原', tier: 1, entryFee: 50, danger: '低危', modifier: '开阔：视野+20%',
      monsterCount: 10, chestCount: 5, raiderCount: 0,
      rareSeedChance: 0.02, legendarySeedChance: 0,
      bgImage: 'assets/maps/t1_2_windmill.jpg',
      bgColor: '#5a7a48', accentColor: '#a8cf7a', visibilityBonus: 0.2,
      gridSize: 48, gridColor: '#5d7a55', majorGridColor: '#7e9a6c',
      terrain: { ground: '#466038', soil: '#6b5538', path: '#8a7d5e', water: '#3f6668', glow: '#7c9a66', decor: ['🌾','🌿','🪨','🌼','🪵'] } },
    { id: 't1_3', name: '青草坡', tier: 1, entryFee: 50, danger: '低危', modifier: '多草：怪少2只',
      monsterCount: 10, chestCount: 5, raiderCount: 0,
      rareSeedChance: 0.02, legendarySeedChance: 0,
      bgImage: 'assets/maps/t1_3_grassland.jpg',
      bgColor: '#4e7040', accentColor: '#9ecf6e',
      gridSize: 48, gridColor: '#557048', majorGridColor: '#769660',
      terrain: { ground: '#3f5a32', soil: '#645033', path: '#7e7350', water: '#3a6062', glow: '#7a9a5a', decor: ['🌿','🌱','🌼','🦋','🌾'] } },
    { id: 't1_4', name: '旧采石场', tier: 1, entryFee: 50, danger: '低危', modifier: '多石：障碍多',
      monsterCount: 14, chestCount: 6, raiderCount: 0,
      rareSeedChance: 0.03, legendarySeedChance: 0,
      bgImage: 'assets/maps/t1_4_quarry.jpg',
      bgColor: '#5c5a55', accentColor: '#a8a49a',
      gridSize: 48, gridColor: '#605e58', majorGridColor: '#828078',
      terrain: { ground: '#4a4842', soil: '#6a5e4c', path: '#8a8070', water: '#3d5558', glow: '#8a847a', decor: ['🪨','⛰️','🪵','🦴','⚙️'] } },
    { id: 't1_5', name: '河湾浅滩', tier: 1, entryFee: 50, danger: '低危', modifier: '多水：减速区多',
      monsterCount: 12, chestCount: 5, raiderCount: 0,
      rareSeedChance: 0.02, legendarySeedChance: 0,
      bgImage: 'assets/maps/t1_5_river.jpg',
      bgColor: '#4a7a78', accentColor: '#7ec8c4', waterHeavy: true,
      gridSize: 48, gridColor: '#4e7573', majorGridColor: '#709a96',
      terrain: { ground: '#3a5a58', soil: '#5b5540', path: '#7a7a60', water: '#2e6a80', glow: '#6ab0ac', decor: ['🌿','💧','🐸','🪨','🌾'] } },
    { id: 't1_6', name: '牧道交叉口', tier: 1, entryFee: 50, danger: '低危', modifier: '三岔路：撤离点随机',
      monsterCount: 12, chestCount: 6, raiderCount: 0,
      rareSeedChance: 0.02, legendarySeedChance: 0,
      bgImage: 'assets/maps/t1_6_crossroad.jpg',
      bgColor: '#6b6040', accentColor: '#c9a860',
      gridSize: 48, gridColor: '#6e6348', majorGridColor: '#8f8058',
      terrain: { ground: '#55482e', soil: '#6e5a38', path: '#9a8658', water: '#3d5a5a', glow: '#a08850', decor: ['🌾','🚧','🪵','🏺','🌻'] } },
    // ===== T2 废墟（250金） =====
    { id: 't2_1', name: '废弃小农庄', tier: 2, entryFee: 250, danger: '中危', modifier: '标准',
      monsterCount: 18, chestCount: 7, raiderCount: 1,
      rareSeedChance: 0.10, legendarySeedChance: 0.01,
      bgImage: 'assets/maps/t2_1_farmstead.jpg',
      bgColor: '#625d49', accentColor: '#c1a76b',
      gridSize: 48, gridColor: '#655e49', majorGridColor: '#887b59',
      terrain: { ground: '#4b4737', soil: '#6a5036', path: '#8c8065', water: '#425a57', glow: '#8e7950', decor: ['🌻','🪨','🛖','🪵','🌳'] } },
    { id: 't2_2', name: '枯井村落', tier: 2, entryFee: 250, danger: '中危', modifier: '多雾：视野-10%',
      monsterCount: 18, chestCount: 7, raiderCount: 1,
      rareSeedChance: 0.10, legendarySeedChance: 0.01,
      bgImage: 'assets/maps/t2_2_wells.jpg',
      bgColor: '#5a5855', accentColor: '#a8a49a', visionPenalty: 0.1,
      gridSize: 48, gridColor: '#5d5a55', majorGridColor: '#807c72',
      terrain: { ground: '#48453f', soil: '#60503e', path: '#807868', water: '#3e4e50', glow: '#8a8272', decor: ['🏚️','🕳️','🪨','🌫️','🦴'] } },
    { id: 't2_3', name: '旧磨坊', tier: 2, entryFee: 250, danger: '中危', modifier: '狭窄：建筑多',
      monsterCount: 20, chestCount: 8, raiderCount: 1,
      rareSeedChance: 0.10, legendarySeedChance: 0.01,
      bgImage: 'assets/maps/t2_3_mill.jpg',
      bgColor: '#4e4438', accentColor: '#a88860',
      gridSize: 48, gridColor: '#52463a', majorGridColor: '#7a6850',
      terrain: { ground: '#3f382e', soil: '#5e4e38', path: '#7e7058', water: '#3a504e', glow: '#8a7448', decor: ['🏚️','🪵','🛞','📦','🪨'] } },
    { id: 't2_4', name: '烟熏果园', tier: 2, entryFee: 250, danger: '中危', modifier: '密集：埋伏多',
      monsterCount: 20, chestCount: 7, raiderCount: 1,
      rareSeedChance: 0.12, legendarySeedChance: 0.01,
      bgImage: 'assets/maps/t2_4_orchard.jpg',
      bgColor: '#3e4a38', accentColor: '#7a9660',
      gridSize: 48, gridColor: '#424d3c', majorGridColor: '#667a55',
      terrain: { ground: '#303a2c', soil: '#50402e', path: '#6e6048', water: '#364a46', glow: '#6a8850', decor: ['🌳','🍎','🔥','🪵','🍂'] } },
    { id: 't2_5', name: '断桥废墟', tier: 2, entryFee: 250, danger: '中危', modifier: '多坑：坠落掉血',
      monsterCount: 16, chestCount: 8, raiderCount: 1,
      rareSeedChance: 0.10, legendarySeedChance: 0.01,
      bgImage: 'assets/maps/t2_5_bridge.jpg',
      bgColor: '#5a5248', accentColor: '#9a8a78',
      gridSize: 48, gridColor: '#5e5548', majorGridColor: '#847868',
      terrain: { ground: '#484038', soil: '#5e4e3e', path: '#7e7060', water: '#3a4a4e', glow: '#847868', decor: ['🌉','🪨','🦴','🌊','🏛️'] } },
    { id: 't2_6', name: '瞭望塔', tier: 2, entryFee: 250, danger: '中危', modifier: '高资源：宝箱+2',
      monsterCount: 18, chestCount: 9, raiderCount: 2,
      rareSeedChance: 0.14, legendarySeedChance: 0.02,
      bgImage: 'assets/maps/t2_6_watchtower.jpg',
      bgColor: '#6b5a3e', accentColor: '#d8a860',
      gridSize: 48, gridColor: '#6e5d42', majorGridColor: '#94805a',
      terrain: { ground: '#554630', soil: '#6e5638', path: '#9a8258', water: '#3e5658', glow: '#b88848', decor: ['🗼','💰','📦','🔥','🪵'] } },
    // ===== T3 灾变（800金） =====
    { id: 't3_1', name: '灾变农田', tier: 3, entryFee: 800, danger: '高危', modifier: '标准',
      monsterCount: 26, chestCount: 9, raiderCount: 2,
      rareSeedChance: 0.25, legendarySeedChance: 0.06,
      bgImage: 'assets/maps/t3_1_blighted.jpg',
      bgColor: '#514541', accentColor: '#bd7567',
      gridSize: 48, gridColor: '#5b6265', majorGridColor: '#7b8588',
      terrain: { ground: '#463b35', soil: '#5a342e', path: '#78634e', water: '#3d4a45', glow: '#9a695b', decor: ['🍄','🦴','🪨','🌵','☣️'] } },
    { id: 't3_2', name: '腐殖沼泽', tier: 3, entryFee: 800, danger: '高危', modifier: '泥地减速广',
      monsterCount: 26, chestCount: 9, raiderCount: 2,
      rareSeedChance: 0.25, legendarySeedChance: 0.06,
      bgImage: 'assets/maps/t3_2_marsh.jpg',
      bgColor: '#3e4a3a', accentColor: '#6a8a5a',
      gridSize: 48, gridColor: '#424d3e', majorGridColor: '#6a7a5e',
      terrain: { ground: '#323e2e', soil: '#4e4430', path: '#5e5840', water: '#2e4a3e', glow: '#6a8a4e', decor: ['🌫️','🍄','🌿','🦠','💀'] } },
    { id: 't3_3', name: '雷击焦林', tier: 3, entryFee: 800, danger: '高危', modifier: '雷暴更频繁',
      monsterCount: 28, chestCount: 9, raiderCount: 2,
      rareSeedChance: 0.28, legendarySeedChance: 0.06,
      bgImage: 'assets/maps/t3_3_scorched.jpg',
      bgColor: '#2e2a28', accentColor: '#8a7a6a',
      gridSize: 48, gridColor: '#302c2a', majorGridColor: '#5a5048',
      terrain: { ground: '#262220', soil: '#3e3228', path: '#5a4a3e', water: '#2a3638', glow: '#7a6a58', decor: ['🔥','⚡','🌑','🦴','🪵'] } },
    { id: 't3_4', name: '虫穴坑道', tier: 3, entryFee: 800, danger: '高危', modifier: '小怪密度+30%',
      monsterCount: 32, chestCount: 10, raiderCount: 2,
      rareSeedChance: 0.25, legendarySeedChance: 0.06,
      bgImage: 'assets/maps/t3_4_burrow.jpg',
      bgColor: '#4e3832', accentColor: '#a86858',
      gridSize: 48, gridColor: '#523b35', majorGridColor: '#7a5a4e',
      terrain: { ground: '#3e2e28', soil: '#5a4030', path: '#6e5040', water: '#363e3e', glow: '#a85848', decor: ['🕷️','🥚','🕸️','🦗','🪱'] } },
    { id: 't3_5', name: '血色谷地', tier: 3, entryFee: 800, danger: '高危', modifier: '精英率+5%',
      monsterCount: 26, chestCount: 9, raiderCount: 3,
      rareSeedChance: 0.30, legendarySeedChance: 0.08, eliteBonus: 0.05,
      bgImage: 'assets/maps/t3_5_bloodvalley.jpg',
      bgColor: '#5a2e2e', accentColor: '#c85858',
      gridSize: 48, gridColor: '#5e3230', majorGridColor: '#8a4848',
      terrain: { ground: '#462826', soil: '#5e3028', path: '#784038', water: '#3e3038', glow: '#b85848', decor: ['🩸','🦴','💀','🌑','⚔️'] } },
    { id: 't3_6', name: '废弃温室', tier: 3, entryFee: 800, danger: '高危', modifier: '室内：视野-20%',
      monsterCount: 24, chestCount: 11, raiderCount: 2,
      rareSeedChance: 0.32, legendarySeedChance: 0.10,
      bgImage: 'assets/maps/t3_6_greenhouse.jpg',
      bgColor: '#2e4a3e', accentColor: '#6ac888', visionPenalty: 0.2,
      gridSize: 48, gridColor: '#324d40', majorGridColor: '#5a7a66',
      terrain: { ground: '#263e32', soil: '#40482e', path: '#5e6048', water: '#2a4a48', glow: '#6ac888', decor: ['🌿','🌱','🏠','💧','✨'] } },
    // ===== T4 绝境（2000金） =====
    { id: 't4_1', name: '古老谷场', tier: 4, entryFee: 2000, danger: '绝境', modifier: '标准',
      monsterCount: 36, chestCount: 12, raiderCount: 3,
      rareSeedChance: 0.45, legendarySeedChance: 0.15,
      bgImage: 'assets/maps/t4_1_ancient.jpg',
      bgColor: '#3b414a', accentColor: '#938ba9',
      gridSize: 48, gridColor: '#414249', majorGridColor: '#62616d',
      terrain: { ground: '#2f3134', soil: '#3d3940', path: '#625f58', water: '#263842', glow: '#77708c', decor: ['🗿','🔮','🪨','🌲','✨'] } },
    { id: 't4_2', name: '深渊祭坛', tier: 4, entryFee: 2000, danger: '绝境', modifier: '多毒雾区',
      monsterCount: 36, chestCount: 12, raiderCount: 3,
      rareSeedChance: 0.45, legendarySeedChance: 0.15,
      bgImage: 'assets/maps/t4_2_altar.jpg',
      bgColor: '#2e2438', accentColor: '#9a6ac8',
      gridSize: 48, gridColor: '#322840', majorGridColor: '#5a4870',
      terrain: { ground: '#262030', soil: '#3a2e42', path: '#584868', water: '#2a3648', glow: '#8a58b8', decor: ['🔮','☠️','🕯️','🌑','⚗️'] } },
    { id: 't4_3', name: '龙骨荒原', tier: 4, entryFee: 2000, danger: '绝境', modifier: '开阔：远程怪多',
      monsterCount: 34, chestCount: 12, raiderCount: 3,
      rareSeedChance: 0.45, legendarySeedChance: 0.15,
      bgImage: 'assets/maps/t4_3_bones.jpg',
      bgColor: '#4e4840', accentColor: '#b0a890',
      gridSize: 48, gridColor: '#524c42', majorGridColor: '#78705e',
      terrain: { ground: '#3e382e', soil: '#524838', path: '#706858', water: '#2e3e42', glow: '#a89878', decor: ['🦴','🐉','🪨','🦴','💨'] } },
    { id: 't4_4', name: '时空裂隙', tier: 4, entryFee: 2000, danger: '绝境', modifier: '随机传送门',
      monsterCount: 36, chestCount: 13, raiderCount: 3,
      rareSeedChance: 0.50, legendarySeedChance: 0.18,
      bgImage: 'assets/maps/t4_4_rift.jpg',
      bgColor: '#2e2e5a', accentColor: '#7a8ae8',
      gridSize: 48, gridColor: '#32325e', majorGridColor: '#5e5e94',
      terrain: { ground: '#262648', soil: '#363660', path: '#585890', water: '#2a3660', glow: '#7a8ae8', decor: ['🌀','✨','🔮','🌌','⚡'] } },
    { id: 't4_5', name: '月见森林', tier: 4, entryFee: 2000, danger: '绝境', modifier: '夜间：荧光怪',
      monsterCount: 38, chestCount: 12, raiderCount: 4,
      rareSeedChance: 0.48, legendarySeedChance: 0.18,
      bgImage: 'assets/maps/t4_5_moonforest.jpg',
      bgColor: '#1e2a3e', accentColor: '#5a88c8',
      gridSize: 48, gridColor: '#222e42', majorGridColor: '#48608a',
      terrain: { ground: '#182438', soil: '#2e3648', path: '#485878', water: '#1e3848', glow: '#5a9ae8', decor: ['🌙','🍄','🌲','✨','🦇'] } },
    { id: 't4_6', name: '远古竞技场', tier: 4, entryFee: 2000, danger: '绝境', modifier: '圆形封闭：纯战斗',
      monsterCount: 40, chestCount: 11, raiderCount: 4,
      rareSeedChance: 0.45, legendarySeedChance: 0.15,
      bgImage: 'assets/maps/t4_6_arena.jpg',
      bgColor: '#5a4438', accentColor: '#d88858',
      gridSize: 48, gridColor: '#5e483c', majorGridColor: '#8a6a4e',
      terrain: { ground: '#483628', soil: '#5e4836', path: '#82684a', water: '#3a4048', glow: '#d88858', decor: ['⚔️','🏛️','🪨','🔥','🛡️'] } }
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
  // ========== 植物防线（远征可部署植物） ==========
  plants: [
    { id: 'pea_plant', name: '豌豆射手', icon: '🫛', type: 'attack', rarity: 'common',
      deployCost: 8, sustain: 0.2, life: 60, hp: 60, maxPerRun: 3,
      damage: 8, cooldown: 0.5, range: 260, projectileSpeed: 380,
      desc: '持续远程输出，被厚甲猪克制' },
    { id: 'frost_vine', name: '寒冰藤', icon: '🧊', type: 'slow', rarity: 'common',
      deployCost: 10, sustain: 0.25, life: 50, hp: 50, maxPerRun: 3,
      slowRadius: 120, slowFactor: 0.4,
      desc: '对周围敌人减速40%，被疾风狼克制（免疫减速）' },
    { id: 'bind_flower', name: '缠绕花', icon: '🌷', type: 'control', rarity: 'rare',
      deployCost: 14, sustain: 0.3, life: 45, hp: 45, maxPerRun: 2,
      controlRadius: 110, stunDuration: 1.5, cooldown: 4,
      desc: '周期性定身范围内敌人（精英减半），专克快攻' },
    { id: 'sun_flower', name: '阳光花', icon: '🌻', type: 'produce', rarity: 'rare',
      deployCost: 6, sustain: 0, life: 80, hp: 40, maxPerRun: 2,
      produceAmount: 2, produceInterval: 8,
      desc: '周期性产出养分结晶，食草兽优先啃食' },
    { id: 'sacred_tree', name: '圣树', icon: '🌳', type: 'ultimate', rarity: 'legendary',
      deployCost: 30, sustain: 0.6, life: 90, hp: 150, maxPerRun: 1,
      damage: 5, cooldown: 0.8, range: 180, slowRadius: 90, slowFactor: 0.3,
      stunDuration: 0.8, controlRadius: 80, controlCooldown: 5, produceAmount: 2, produceInterval: 10,
      desc: '全能植物：弱化输出+减速+控制+产养分，单局限1株' }
  ],
  // 养分资源线
  nutrients: { start: 30, max: 200, crystalAmount: 5, crystalInterval: 20, normalKill: 2, eliteKill: 8 },
  // 宝箱按T级掉落植物种子概率（common/rare/legendary）
  plantDrops: [
    { common: 0.35, rare: 0.08, legendary: 0 },
    { common: 0.30, rare: 0.15, legendary: 0.01 },
    { common: 0.25, rare: 0.20, legendary: 0.03 },
    { common: 0.20, rare: 0.25, legendary: 0.06 }
  ],
  // 培育进度阈值
  plantGrowth: { seedling: 30, mature: 70, deployable: 100,
    basePerRun: 10, surviveBonus: 40, destroyPenalty: 30, firstDestroyPenalty: 15,
    plantDestroyRecover: 3, firstDestroyGrace: 3 },
  // 反制兵种按T级混入（T2起）
  counterMixes: [
    { swift_wolf: 0, herbivore: 0, armored_boar: 0 },       // T1 无
    { swift_wolf: 0.16, herbivore: 0.14, armored_boar: 0 }, // T2 疾风狼+食草兽
    { swift_wolf: 0.14, herbivore: 0.13, armored_boar: 0.12 }, // T3 +厚甲猪
    { swift_wolf: 0.15, herbivore: 0.14, armored_boar: 0.13 }  // T4 全+精英
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
      attackRange: 35, attackCooldown: 1.0, xp: 12, gold: 10 },
    armored_boar: { name: '厚甲猪', icon: '🐗', hp: 95, damage: 18, speed: 105, radius: 21, collisionRadius: 17,
      attackRange: 40, attackCooldown: 1.35, xp: 18, gold: 16, armor: 0.5, counter: 'armor',
      desc: '披甲重装怪：减伤50%，专克输出植物' },
    swift_wolf: { name: '疾风狼', icon: '🐺', hp: 46, damage: 12, speed: 240, radius: 15, collisionRadius: 11,
      attackRange: 36, attackCooldown: 0.85, xp: 13, gold: 11, slowImmune: true, counter: 'slow',
      desc: '速度极快且免疫减速，专克减速植物' },
    herbivore: { name: '食草兽', icon: '🦌', hp: 62, damage: 11, speed: 118, radius: 18, collisionRadius: 14,
      attackRange: 34, attackCooldown: 1.15, xp: 15, gold: 12, plantHate: true, counter: 'plant',
      desc: '专啃植物防线，优先攻击植物' },
    // v1.4 新怪
    treant: { name: '树精', icon: '🌳', img: 'docs/art/enemies/treant.png', hp: 140, damage: 22, speed: 80, radius: 24, collisionRadius: 18,
      attackRange: 45, attackCooldown: 1.4, xp: 25, gold: 20, auraHeal: 8,
      desc: '近战肉盾，周围友军每秒回血8' },
    gargoyle: { name: '石像鬼', icon: '👿', img: 'docs/art/enemies/gargoyle.png', hp: 80, damage: 18, speed: 170, radius: 18, collisionRadius: 12,
      attackRange: 40, attackCooldown: 0.9, xp: 28, gold: 22, aerial: true, diveAttack: true,
      desc: '飞行怪，周期性俯冲造成双倍伤害' },
    shadow_demon: { name: '影魔', icon: '👤', img: 'docs/art/enemies/shadow_demon.png', hp: 65, damage: 25, speed: 190, radius: 16, collisionRadius: 12,
      attackRange: 38, attackCooldown: 0.8, xp: 35, gold: 30, blink: true, invis: true,
      desc: '周期性隐身瞬移到玩家身边' },
    boar_king: { name: '狂暴野猪王', icon: '🐗', img: 'docs/art/enemies/boar_king.png', hp: 350, damage: 35, speed: 150, radius: 28, collisionRadius: 22,
      attackRange: 50, attackCooldown: 1.1, xp: 100, gold: 120, elite: true, charge: true,
      desc: '精英：蓄力冲锋+震荡波' },
    stone_golem: { name: '远古魔像', icon: '🗿', img: 'docs/art/enemies/golem.png', hp: 600, damage: 28, speed: 70, radius: 32, collisionRadius: 26,
      attackRange: 55, attackCooldown: 1.8, xp: 150, gold: 180, elite: true, armor: 0.6, reflect: 0.15,
      desc: '精英：60%减伤+反弹15%伤害' },
    treant_elder: { name: '树精长老', icon: '🌲', img: 'docs/art/enemies/treant_elder.png', hp: 2500, damage: 40, speed: 60, radius: 45, collisionRadius: 35,
      attackRange: 80, attackCooldown: 1.5, xp: 800, gold: 1000, boss: true, summonRoot: true,
      desc: 'T1 Boss：召唤树根缠绕+范围毒雾' }
  },
  crops: [
    { id: 'pea_shooter', name: '豌豆射手', icon: '🫛', growTime: 24, sellPrice: 12, seedPrice: 8, rarity: 'rare', cardChance: 1, upgradeSkill: 'straw_smash', rewardType: 'attack_card', rewardLabel: '必得攻击卡', trait: 'reharvest' },
    { id: 'sunflower', name: '向日葵', icon: '🌻', growTime: 18, sellPrice: 45, seedPrice: 6, rarity: 'common', cardChance: 1, upgradeSkill: 'all', rewardType: 'skill_card', rewardLabel: '永久技能强化卡', trait: 'aura' },
    { id: 'watermelon', name: '西瓜', icon: '🍉', growTime: 36, sellPrice: 20, seedPrice: 15, rarity: 'rare', cardChance: 1, upgradeSkill: 'all', rewardType: 'consumable_skill_card', rewardLabel: '一次性技能卡', trait: 'giant' },
    { id: 'cabbage', name: '卷心菜', icon: '🥬', growTime: 28, sellPrice: 18, seedPrice: 10, rarity: 'common', cardChance: 0, upgradeSkill: 'earth_dash', rewardType: 'healing', rewardLabel: '草药包扎包', trait: 'hardy' },
    { id: 'wheat', name: '小麦', icon: '🌾', growTime: 15, sellPrice: 15, seedPrice: 5, rarity: 'common', cardChance: 0, upgradeSkill: null, rewardType: 'gold', rewardLabel: '金币', trait: 'monoculture' },
    { id: 'carrot', name: '胡萝卜', icon: '🥕', growTime: 20, sellPrice: 25, seedPrice: 10, rarity: 'common', cardChance: 0.14, upgradeSkill: 'earth_dash', trait: 'mutate' },
    { id: 'corn', name: '玉米', icon: '🌽', growTime: 30, sellPrice: 45, seedPrice: 15, rarity: 'rare', cardChance: 0.20, upgradeSkill: 'vine_bind', trait: 'beast' },
    { id: 'pumpkin', name: '南瓜', icon: '🎃', growTime: 45, sellPrice: 80, seedPrice: 25, rarity: 'rare', cardChance: 0.30, upgradeSkill: 'smoke_screen', trait: 'carve' },
    { id: 'moon_rice', name: '月光稻', icon: '✨', growTime: 60, sellPrice: 200, seedPrice: 0, rarity: 'legendary', cardChance: 0.58, upgradeSkill: 'all', rare: true, trait: 'legendary' }
  ],
  // v1.6 战场种植：可带进远征种下去的植物
  deployPlants: {
    chili:     { icon: '🌶️', name: '辣椒',     hp: 60,  range: 40,  effect: 'fire',      desc: '火焰陷阱：每秒烧经过怪8血' },
    sunflower: { icon: '🌻', name: '向日葵',   hp: 40,  range: 120, effect: 'light',     desc: '视野灯：照亮半径120' },
    vine:      { icon: '🌿', name: '藤蔓',     hp: 100, range: 30,  effect: 'slow',      desc: '减速墙：经过怪移速-50%' },
    watermelon:{ icon: '🍉', name: '西瓜',     hp: 0,   range: 80,  effect: 'boom',      desc: '定时爆炸：3秒后AOE30' },
    wheat:     { icon: '🌾', name: '小麦稻草人', hp: 80, range: 150, effect: 'taunt',     desc: '嘲讽：怪优先打它' },
    mushroom:  { icon: '🍄', name: '月光菇',   hp: 50,  range: 60,  effect: 'heal',      desc: '治疗站：每秒回2血' },
    garlic:    { icon: '🧄', name: '大蒜',     hp: 40,  range: 50,  effect: 'repel',     desc: '驱虫：怪不靠近' },
    cactus:    { icon: '🌵', name: '仙人掌',   hp: 120, range: 25,  effect: 'thorns',    desc: '尖刺：碰它的怪受5反伤' },
    firegrass: { icon: '🔥', name: '火龙草',   hp: 80,  range: 150, effect: 'firebreath',desc: '喷火墙：直线每秒烧15' },
    frost:     { icon: '❄️', name: '寒霜花',   hp: 60,  range: 80,  effect: 'freeze',    desc: '冰冻：半径内定身1.5s' },
    electric:  { icon: '⚡', name: '电藤',     hp: 70,  range: 200, effect: 'tesla',    desc: '特斯拉：链电打3个怪' },
    shadow:    { icon: '🌑', name: '暗影花',   hp: 50,  range: 80,  effect: 'stealth',   desc: '隐身力场：玩家隐身3s' },
    rainbow:   { icon: '🌈', name: '虹光花',   hp: 80,  range: 100, effect: 'buff',      desc: '攻击塔：半径内攻击+20%' },
    deathcap:  { icon: '💀', name: '亡语菇',   hp: 0,   range: 20,  effect: 'deathboom',desc: '自爆：怪靠近爆50血' }
  },
  // 作物id → 战场植物id映射（收获的作物可以当种子带进远征）
  cropToDeploy: {
    chili: 'chili', pepper: 'chili',
    sunflower: 'sunflower',
    vine_plant: 'vine', vine: 'vine',
    watermelon: 'watermelon',
    wheat: 'wheat',
    mushroom: 'mushroom', moon_mushroom: 'mushroom',
    garlic: 'garlic',
    cactus: 'cactus',
    fire_grass: 'firegrass',
    frost_flower: 'frost',
    electric_vine: 'electric',
    shadow_flower: 'shadow',
    rainbow_flower: 'rainbow',
    death_cap: 'deathcap'
  },
  // 远征地图野生植物（采摘带回种子）
  wildPlants: [
    { id: 'wild_chili', icon: '🌶️', name: '野生辣椒', givesSeed: 'chili', tier: 1 },
    { id: 'wild_mint', icon: '🌿', name: '野生薄荷', givesSeed: 'mint', tier: 1 },
    { id: 'wild_sun', icon: '🌻', name: '野生向日葵', givesSeed: 'sunflower', tier: 1 },
    { id: 'wild_frost', icon: '❄️', name: '寒霜花', givesSeed: 'frost_flower', tier: 2 },
    { id: 'wild_electric', icon: '⚡', name: '电藤', givesSeed: 'lightning_vine', tier: 2 },
    { id: 'wild_shadow', icon: '🌑', name: '暗影花', givesSeed: 'shadow_flower', tier: 3 },
    { id: 'wild_death', icon: '💀', name: '亡语菇', givesSeed: 'deathcap', tier: 3 }
  ],
  // v0.9.0 新作物在crop-expansion.js中动态注册
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
    chili: { name: '辣椒', icon: '🌶️', category: 'crop', sellPrice: 20, rarity: 'common' },
    garlic: { name: '大蒜', icon: '🧄', category: 'crop', sellPrice: 30, rarity: 'common' },
    mint: { name: '薄荷', icon: '🌿', category: 'crop', sellPrice: 18, rarity: 'common' },
    cactus: { name: '仙人掌', icon: '🌵', category: 'crop', sellPrice: 40, rarity: 'uncommon' },
    ginseng: { name: '人参', icon: '🫚', category: 'crop', sellPrice: 150, rarity: 'legendary' },
    tomato: { name: '番茄', icon: '🍅', category: 'crop', sellPrice: 28, rarity: 'common' },
    rosemary: { name: '迷迭香', icon: '🌱', category: 'crop', sellPrice: 35, rarity: 'uncommon' },
    fire_grass: { name: '火龙草', icon: '🔥', category: 'crop', sellPrice: 60, rarity: 'rare' },
    frost_flower: { name: '寒霜花', icon: '❄️', category: 'crop', sellPrice: 55, rarity: 'rare' },
    lightning_vine: { name: '电藤', icon: '⚡', category: 'crop', sellPrice: 80, rarity: 'rare' },
    shadow_flower: { name: '暗影花', icon: '🌑', category: 'crop', sellPrice: 100, rarity: 'epic' },
    rainbow_flower: { name: '虹光花', icon: '🌈', category: 'crop', sellPrice: 150, rarity: 'legendary' },
    // 资源类
    seeds: { name: '种子', icon: '🌱', category: 'resource' },
    materials: { name: '材料', icon: '🔧', category: 'resource' },
    wood: { name: '硬木', icon: '🪵', category: 'resource', sellPrice: 8 },
    iron: { name: '铁块', icon: '⛓️', category: 'resource', sellPrice: 15 },
    crystal: { name: '灵晶', icon: '💎', category: 'resource', sellPrice: 60 },
    bossFang: { name: 'Boss獠牙', icon: '🦷', category: 'resource', sellPrice: 200 },
    ancientSeeds: { name: '天外晶屑', icon: '◆', category: 'resource', sellPrice: 120 },
    herb: { name: '草药', icon: '🌿', category: 'resource', sellPrice: 10 },
    // 工坊加工品（中间原料）
    flour: { name: '面粉', icon: '🌾', category: 'resource', sellPrice: 50 },
    oil: { name: '植物油', icon: '🫒', category: 'resource', sellPrice: 150 },
    feed: { name: '饲料', icon: '🥣', category: 'resource', sellPrice: 150 },
    // 消耗品类
    herb_kit: { name: '草药包扎包', icon: '💊', category: 'consumable' },
    thorn_storm: { name: '荆棘狂潮', icon: '🌵', category: 'consumable' },
    signal_flare: { name: '撤离信号弹', icon: '🔥', category: 'consumable' },
    growth_catalyst: { name: '生长催化剂', icon: '⏳', category: 'consumable' },
    poison_bomb: { name: '毒雾弹', icon: '☠️', category: 'consumable', sellPrice: 80 },
    night_mushroom: { name: '夜视菇', icon: '🍄', category: 'consumable', sellPrice: 100 },
    iron_pumpkin: { name: '铁皮南瓜', icon: '🎃', category: 'consumable', sellPrice: 150 },
    // 温室掉落道具
    gold_card: { name: '金币卡', icon: '💰', category: 'consumable', sellPrice: 200 },
    big_gold_card: { name: '大金币卡', icon: '💎', category: 'consumable', sellPrice: 800 },
    transform_card: { name: '作物转化卡', icon: '🔄', category: 'consumable', sellPrice: 150 },
    rare_seed_pack: { name: '稀有种子包', icon: '🌱', category: 'consumable', sellPrice: 100 },
    exp_boost_card: { name: '经验加成卡', icon: '📈', category: 'consumable', sellPrice: 120 },
    weapon_upgrade_stone: { name: '武器强化石', icon: '⚔️', category: 'consumable', sellPrice: 300 },
    // 工坊加工品（成品食物/道具）
    bread: { name: '面包', icon: '🍞', category: 'consumable', sellPrice: 120 },
    juice: { name: '西瓜汁', icon: '🧃', category: 'consumable', sellPrice: 60 },
    egg: { name: '鸡蛋', icon: '🥚', category: 'consumable', sellPrice: 170 },
    torch: { name: '火把', icon: '🔥', category: 'consumable', sellPrice: 300 },
    insecticide: { name: '驱虫剂', icon: '🧪', category: 'consumable', sellPrice: 50 },
    // 装饰/其他
    pumpkin_lantern: { name: '南瓜灯', icon: '🎃', category: 'other', sellPrice: 100 }
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
  gold: 100000,
  volume: 0.8, // v1.4 全局音量
  seeds: 3,
  materials: 0,
  farmPlots: [], // 6x6 = 36格
  unlockedPlots: 8,
  selectedCrop: 'wheat',
  unlockedCrops: ['pea_shooter', 'sunflower', 'watermelon', 'cabbage', 'wheat', 'ningqi_grass'],
  skillLevels: { straw_smash: 1, vine_bind: 1, earth_dash: 1, smoke_screen: 1 },
  cardInventory: [],
  selectedBoostCards: [],
  selectedMap: 't1',
  selectedWeapon: 'harvest_sickle',
  loadoutWeaponUids: [], // v1.4 本次出征带入的武器uid数组（最多2把）
  carriedSeeds: [], // v1.6 携带的战场植物种子 [{type, count}]
  weaponInstances: [ // v1.1 每把武器独立实例
    { uid: 'w_001', weaponId: 'harvest_sickle', level: 0 },
    { uid: 'w_002', weaponId: 'pea_repeater', level: 0 },
    { uid: 'w_003', weaponId: 'vine_staff', level: 0 }
  ],
  difficulty: 'normal',
  heatModifiers: [],
  // v0.8.0 NPC+建筑+科技
  npcData: null, diaryPages: [], npcRewards: {}, npcEvents: {},
  buildings: null, techPoints: 0, unlockedTech: [], labUnlocked: false,
  // v0.9.0 作物系统
  cropBuffs: [],
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
  lastTime: 0,
  // 植物防线（远征带回的可部署植物种子与培育进度）
  // key=植物id, value={ progress: 0~100, count: 持有种子数 }
  // 初始赠送2株可部署植物便于体验布防
  defensePlants: {
    pea_plant: { progress: 100, count: 1 },
    frost_vine: { progress: 100, count: 1 }
  },
  // 本次远征携带的可部署防线（植物id数组）
  defenseLoadout: ['pea_plant', 'frost_vine']
};

// ==================== 运行时版本同步（双保险：静态值由 tools/bump-version.js 维护） ====================
if (typeof document !== 'undefined') {
  document.title = GAME_NAME + ' v' + GAME_VERSION;
  const _versionMeta = document.querySelector('meta[name="game-version"]');
  if (_versionMeta) _versionMeta.setAttribute('content', GAME_VERSION);
}
