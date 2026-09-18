// 静止形状粒子类型（不参与位移积分，仅缩放/旋转呈现）
const STATIC_SHAPE_TYPES = new Set(['aoe', 'slash', 'weaponRing', 'vine', 'earthTrail', 'impact', 'shock', 'trail', 'chain']);
// 武器专属打击反馈：命中主色、火花色、碎片色与命中音色
const WEAPON_FX = {
  harvest_sickle: { impact: '#fff3c4', spark: '#ffe9a8', debris: '#d9a94e', sound: 'sickle' },
  pea_repeater:   { impact: '#eaffd0', spark: '#d8ff9e', debris: '#6fae3f', sound: 'pea' },
  vine_staff:     { impact: '#e2fff5', spark: '#d5fff1', debris: '#3fae8a', sound: 'vine' }
};

class Expedition {
  constructor(mapId) {
    this.map = CONFIG.maps.find(m => m.id === mapId);
    // v3.5 加载地图背景图
    this.mapBgImg = new Image();
    this.mapBgLoaded = false;
    if (this.map && this.map.bgImage) {
      this.mapBgImg.onload = () => { this.mapBgLoaded = true; };
      this.mapBgImg.src = this.map.bgImage;
    }
    this.timeLeft = CONFIG.expedition.demoDuration;
    this.player = {
      x: 640, y: 360,
      hp: CONFIG.player.maxHp,
      maxHp: CONFIG.player.maxHp,
      energy: CONFIG.player.maxEnergy,
      maxEnergy: CONFIG.player.maxEnergy,
      speed: CONFIG.player.speed,
      radius: CONFIG.player.radius,
      collisionRadius: CONFIG.player.collisionRadius || 11,
      angle: 0,
      attackCd: 0,
      invuln: 0,
      stealth: 0,
      slow: 0,
      vx: 0, vy: 0,
      visualZ: 0,
      visualVz: 0
    };
    this.skillCooldowns = [0, 0, 0, 0];
    this.skillFlashes = [0, 0, 0, 0];
    this.attackAnim = 0;
    // v1.4 从武器实例加载（支持多把）
    const broughtUids = (GameState.loadoutWeaponUids && GameState.loadoutWeaponUids.length > 0) ? GameState.loadoutWeaponUids : [];
    this.loadoutUid = broughtUids[0] || null;
    let inst = null;
    if (typeof LoadoutSystem !== 'undefined' && this.loadoutUid) inst = LoadoutSystem.getWeaponInstance(this.loadoutUid);
    const wid = inst ? inst.weaponId : 'harvest_sickle';
    this.weaponIndex = Math.max(0, CONFIG.weapons.findIndex(w => w.id === wid));
    if (this.weaponIndex < 0) this.weaponIndex = 0;
    this.weapon = CONFIG.weapons[this.weaponIndex];
    if (inst && typeof LoadoutSystem !== 'undefined') this.weapon = LoadoutSystem.getWeaponStats(this.weapon, inst.level);
    // v1.4 带入武器列表（最多2把）
    this.broughtUids = broughtUids;
    this.broughtStats = this.broughtUids.map(uid => {
      const i = LoadoutSystem.getWeaponInstance(uid);
      if (!i) return null;
      const b = CONFIG.weapons.find(w => w.id === i.weaponId);
      return { uid, weaponId: i.weaponId, level: i.level, stats: LoadoutSystem.getWeaponStats(b, i.level) };
    }).filter(Boolean);
    this.currentBroughtIdx = Math.max(0, this.broughtUids.indexOf(this.loadoutUid));
    this.weaponPulse = 0;
    // v0.9.0 作物buff缓存
    this.cropBuffs = (typeof CropExpansion !== 'undefined') ? CropExpansion.CropBuffSystem.getAllBuffs() : [];
    this.attackBuffMult = this._getCropBuffMult('attack');
    this.cdrBuffMult = 1 - this._getCropBuffMult('cooldown_reduction');
    this.consumableFlashes = {};
    this.skillBoosts = CardSystem.getSelectedBoosts();
    this.consumables = { ...GameState.loadout };
    // ===== 植物防线系统（养分/部署/培育） =====
    this.nutrient = CONFIG.nutrients.start;
    this.nutrientMax = CONFIG.nutrients.max;
    this.nutrientTimer = 0;          // 养分结晶刷新计时
    this.nutrientCrystals = [];      // 地图上的养分结晶 {x,y,bob,amount}
    this.plants = [];                // 已部署植物
    this.plantSeeds = {};            // 本局可部署防线种子 id -> { maxPerRun, deployed }
    this.selectedPlantId = null;     // 当前选中的防线种子
    this.plantRecords = [];          // 本局部署记录 { seedId, survived, recovered, destroyIdx }
    this.plantDestroyCount = {};     // 种子被摧毁次数（首杀-15 判定）
    this.growthSummary = [];         // 本局培育结算摘要 { id, name, icon, delta }
    // 从准备大厅携带已培育到可部署的植物
    CONFIG.plants.forEach(p => {
      if (GameState.defenseLoadout.includes(p.id)) {
        this.plantSeeds[p.id] = { maxPerRun: p.maxPerRun, deployed: 0 };
      }
    });
    this.monsters = [];
    this.chests = [];
    this.towers = [];
    this.plants = [];
    this.wildPlants = [];
    this.selectedSeed = -1;
    this.seedBar = (GameState.carriedSeeds || []).map(x => ({ ...x }));
    this.raiders = [];
    this.terrainPatches = [];
    this.terrainFields = [];
    this.terrainRoads = [];
    this.terrainDecor = [];
    this.obstacles = [];
    this.traps = [];
    this.groundLoot = [];
    this.projectiles = [];
    this.aoeTimers = [];
    this.particles = [];
    this.damageNumbers = [];
    this.particlePool = [];       // 粒子对象池（消灭每帧 filter 分配）
    this.projectilePool = [];     // 弹道对象池
    this.hudTimer = 0;            // HUD 重量更新节流计时
    this.plantsSorted = null;     // 植物按 y 预排序缓存（渲染层排序用）
    this.plantsDirty = true;
    this.obstaclesByY = null;     // 障碍物按 y 预排序缓存（遮挡分层用）
    this.hitStop = 0;
    this.killFlash = 0;
    this.attackCombo = 0;         // 近战连击序号：0 横扫 / 1 反手 / 2 突刺
    this.weaponRecoil = 0;        // 武器后坐动画
    this.playerDamageFlash = 0;   // 玩家受击红屏
    this.critFlash = 0;           // 暴击金色闪屏
    this.extractPoints = [];
    this.bag = []; // 背包物资
    this.safeBox = []; // 安全箱（阵亡保留）
    this.extracting = false;
    this.extractProgress = 0;
    this.extractType = null; // 'fixed' or 'signal'
    this.killCount = 0;
    this.chestOpened = 0;
    this.damageTaken = 0;
    // v3.8 本局高光统计
    this.runStats = {
      startTime: performance.now(),
      maxDistFromSpawn: 0,       // 最远探索距离
      minHpSeen: 100,            // 最低血量百分比（险象环生）
      maxCombo: 0,               // 最高连击
      eliteKills: 0,             // 精英击杀
      bossKills: 0,              // Boss 击杀
      nearDeathCount: 0,         // 血量低于 25% 的次数
      perfectDodgeCount: 0,      // 完美闪避次数
      barrelsDetonated: 0,       // 油桶引爆数
      propsDestroyed: 0,         // 破坏物数
      plantsDeployed: 0,         // 战场种植数
      highestWave: 0,            // 最高兽潮波次
      clutchKills: 0,            // v4.2 丝血反杀（血量<25%时击杀）
      topLoot: null,             // v4.2 最值钱战利品 {name,icon,value}
    };
    this.spawnX = CONFIG.expedition.mapSize / 2;
    this.spawnY = CONFIG.expedition.mapSize / 2;
    this.balance = this.getBalanceProfile();
    this.objective = null;
    this.boss = null;
    this.bossSpawned = false;
    this.mapEvents = [];
    this.activeEvent = null;
    this.nextEventAt = 45;
    this.elapsed = 0;
    this.eventModifiers = { enemySpeed: 1, enemyDamage: 1, loot: 1, vision: 1 };
    this.beastWave = {
      wave: 0,
      nextIn: 20,          // 首波固定 20 秒
      interval: 40,        // 之后每 40 秒一波（固定节奏）
      active: false,
      remaining: 0,
      duration: 0,
      rewarded: {}         // 每波守塔奖励是否已发（按波次号记录）
    };
    this.camera = { x: 0, y: 0 };
    this.visionCellSize = 96;
    this.visionRadius = 360;
    this.exploredCells = new Set();
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = CONFIG.canvas.width;
    this.fogCanvas.height = CONFIG.canvas.height;
    this.fogUpdateInterval = 0.12;
    this.fogUpdateTimer = this.fogUpdateInterval;
    this.fogDirty = true;
    this.entitySpatialHash = new SpatialHash(176);
    this.obstacleSpatialHash = new SpatialHash(176);
    this.terrainChunkCache = new TerrainChunkCache(CONFIG.expedition.mapSize, 512);
    this.bossSprites = {};
    this.monsterSprites = {};
    this.obstacleSprites = {};
    ['tree', 'bush', 'rock'].forEach(type => {
      const sprite = new Image();
      sprite.src = `assets/obstacles/${type}.webp`;
      this.obstacleSprites[type] = sprite;
    });
    // v2.6 Seedream 5.0 真实怪物贴图（已去背景）
    const v3mobs = {
      bat: 'docs/art/enemies/bat_v3.png',
      spider: 'docs/art/enemies/spider_v3.png',
      boar: 'docs/art/enemies/boar_king_v3.png',
      wolf: 'docs/art/enemies/wolf_v3.png',
      locust: 'docs/art/enemies/locust_v3.png',
      treant: 'docs/art/enemies/treant_v3.png',
      gargoyle: 'docs/art/enemies/gargoyle_v3.png',
      shadow_demon: 'docs/art/enemies/shadow_demon_v3.png',
      boar_king: 'docs/art/enemies/boar_king_v3.png',
      stone_golem: 'docs/art/enemies/stone_golem_v3.png',
      't1-stone-maw': 'docs/art/enemies/boss_t1.png',
      't2-storm-drake': 'docs/art/enemies/boss_t2.png'
    };
    for (const [type, src] of Object.entries(v3mobs)) {
      this.monsterSprites[type] = {};
      const img = new Image();
      img.src = src;
      this.monsterSprites[type].idle = img;
      this.monsterSprites[type].attack = img;
      this.monsterSprites[type].hit = img;
      this.monsterSprites[type].death = img;
    }
    this.fxSprites = { slash: new Image(), hit: new Image(), treant: new Image(), gargoyle: new Image(), shadow: new Image(), boar: new Image() };
    this.fxSprites.slash.src = 'docs/art/effects/fire_slash.png';
    this.fxSprites.hit.src = 'docs/art/effects/hit_spark.png';
    this.fxSprites.treant.src = 'docs/art/mobfx/treant_swipe.png';
    this.fxSprites.gargoyle.src = 'docs/art/mobfx/gargoyle_dive.png';
    this.fxSprites.shadow.src = 'docs/art/mobfx/shadow_blink.png';
    this.fxSprites.boar.src = 'docs/art/mobfx/boar_charge.png';
    this.fxSprites.hitBlood = new Image(); this.fxSprites.hitBlood.src = 'docs/art/effects/hit_blood.png';
    this.fxSprites.playerHit = new Image(); this.fxSprites.playerHit.src = 'docs/art/effects/player_hit.png';
    this.playerSprite = new Image(); this.playerSprite.src = 'docs/art/v2/player.png';
    this.weaponSheet = new Image(); this.weaponSheet.src = 'assets/weapons/weapon_sheet_t.png'; this.weaponSheetPrekeyed = true;
    const t1BossSprite = new Image();
    t1BossSprite.src = 'assets/bosses/t1-stone-maw.webp';
    this.bossSprites.t1 = t1BossSprite;
    const t2BossSprite = new Image();
    t2BossSprite.src = 'assets/bosses/t2-storm-drake.webp';
    this.bossSprites.t2 = t2BossSprite;
    this.screenShake = 0;
    this.sunVector = [
      { x: 0.72, y: 0.38 }, { x: 0.82, y: 0.28 },
      { x: 0.58, y: 0.48 }, { x: -0.55, y: 0.34 }
    ][this.map.tier - 1];
    this.keys = {};
    this.mouse = { x: 0, y: 0, down: false };
    this.paused = false;
    this.gameOver = false;
    this.result = null;

    // v0.7.0 难度系统初始化
    if (typeof DifficultySystem !== 'undefined') {
      DifficultySystem.applyDifficulty(GameState.difficulty || 'normal', GameState.heatModifiers || [], this.map.tier);
      const _ds = DifficultySystem.get();
      this.visionRadius = 360 * _ds.visionMul;
      // v3.4 地图词条：视野修正
      if (this.map.visibilityBonus) this.visionRadius *= (1 + this.map.visibilityBonus);
      if (this.map.visionPenalty) this.visionRadius *= (1 - this.map.visionPenalty);
      this.beastWave.nextIn = 20; // v4.1 首波固定 20 秒，之后固定 40 秒节奏
    }
    this.generateTerrain();
    if (typeof CombatEnhancement !== 'undefined') CombatEnhancement.init(this);
    this.spawnEntities();
    this.spawnWildPlants();
    this.applyMapModifiers();
    this.generateHeightZones();
    this.generateLandmarks();
    this.generateProps();
    this.generatePatrols();
    if (typeof WorldFX !== 'undefined') WorldFX.generate(this);
    this.obstacleSpatialHash.rebuild(this.obstacles);
    this.obstaclesByY = [...this.obstacles].sort((a, b) => a.y - b.y);
    this.entitySpatialHash.rebuild([...this.monsters, ...this.raiders]);
    this.setupMission();
    this.setupInput();
    this.updateVision();
  }

  getVisionKey(x, y) {
    const cell = this.visionCellSize;
    return `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  }

  updateVision() {
    const cell = this.visionCellSize;
    const radius = this.visionRadius * (this.eventModifiers?.vision || 1);
    const minX = Math.max(0, Math.floor((this.player.x - radius) / cell));
    const maxX = Math.min(Math.ceil(CONFIG.expedition.mapSize / cell), Math.ceil((this.player.x + radius) / cell));
    const minY = Math.max(0, Math.floor((this.player.y - radius) / cell));
    const maxY = Math.min(Math.ceil(CONFIG.expedition.mapSize / cell), Math.ceil((this.player.y + radius) / cell));
    let changed = false;
    for (let cy = minY; cy <= maxY; cy++) for (let cx = minX; cx <= maxX; cx++) {
      const centerX = cx * cell + cell / 2, centerY = cy * cell + cell / 2;
      const key = `${cx},${cy}`;
      if (dist({ x: centerX, y: centerY }, this.player) <= radius + cell * .68 && !this.exploredCells.has(key)) {
        this.exploredCells.add(key);
        changed = true;
      }
    }
    if (changed) this.fogDirty = true;
  }

  isWorldVisible(x, y) {
    const radius = this.visionRadius * (this.eventModifiers?.vision || 1);
    // 实时视野：离开当前视野后，所有地图实体都隐藏。
    return dist({ x, y }, this.player) <= radius;
  }

  renderFogOfWar(ctx) {
    const radius = this.visionRadius * (this.eventModifiers?.vision || 1);
    const fogCtx = this.fogCanvas.getContext('2d');
    if (this.fogDirty) {
      fogCtx.clearRect(0, 0, this.fogCanvas.width, this.fogCanvas.height);
      // 单张连续迷雾：当前视野完全透明，视野外统一遮盖，不再按探索格画圆形泡泡。
      fogCtx.globalCompositeOperation = 'source-over';
      fogCtx.globalAlpha = 1;
      fogCtx.fillStyle = this.nightMode ? 'rgba(6,8,20,.92)' : 'rgba(10,16,24,.78)';
      fogCtx.fillRect(0, 0, this.fogCanvas.width, this.fogCanvas.height);
      fogCtx.globalCompositeOperation = 'destination-out';
      const px = this.player.x - this.camera.x;
      const py = this.player.y - this.camera.y;
      const clearVision = fogCtx.createRadialGradient(px, py, radius * .82, px, py, radius * 1.08);
      clearVision.addColorStop(0, 'rgba(0,0,0,1)');
      clearVision.addColorStop(.78, 'rgba(0,0,0,1)');
      clearVision.addColorStop(1, 'rgba(0,0,0,0)');
      fogCtx.fillStyle = clearVision;
      fogCtx.beginPath();
      fogCtx.arc(px, py, radius * 1.08, 0, Math.PI * 2);
      fogCtx.fill();

      fogCtx.globalCompositeOperation = 'source-over';
      fogCtx.globalAlpha = 1;
      this.fogDirty = false;
    }
    ctx.drawImage(this.fogCanvas, 0, 0);
  }

  getBalanceProfile() {
    const tier = this.map.tier;
    const _ds = (typeof DifficultySystem !== 'undefined') ? DifficultySystem.get() : {hpMul:1, dmgMul:1, rewardMul:1, speedMulExtra:1};
    const _tierM = (typeof DifficultySystem !== 'undefined') ? DifficultySystem.getTierMechanic(tier) : {eliteChanceBonus:0};
    return {
      enemyHp: (1 + (tier - 1) * 0.32) * _ds.hpMul,
      enemyDamage: (1 + (tier - 1) * 0.22) * _ds.dmgMul,
      enemySpeed: (1 + (tier - 1) * 0.055) * (_ds.speedMulExtra || 1),
      reward: (1 + (tier - 1) * 0.48) * _ds.rewardMul * ((typeof DifficultySystem !== 'undefined') ? DifficultySystem.getHeatRewardMultiplier() : 1),
      eliteChance: (tier < 3 ? 0 : 0.08 + tier * 0.025) + (_tierM.eliteChanceBonus || 0) + (this.map.eliteBonus || 0),
      bossHp: (520 + tier * 260) * _ds.hpMul,
      bossDamage: (14 + tier * 5) * _ds.dmgMul,
    };
  }

  setupMission() {
    const targetKills = 3 + this.map.tier * 2;
    const missions = [
      { type: 'hunt', title: '清剿威胁', target: targetKills, progress: 0, description: `击败 ${targetKills} 只野怪` },
      { type: 'scavenge', title: '物资回收', target: Math.min(4, 1 + this.map.tier), progress: 0, description: `开启 ${Math.min(4, 1 + this.map.tier)} 个宝箱` },
      { type: 'tower', title: '据点争夺', target: Math.min(3, 1 + Math.floor(this.map.tier / 2)), progress: 0, description: '占领地图防御塔' },
    ];
    this.objective = missions[(this.map.tier + randInt(0, missions.length - 1)) % missions.length];
    this.mapEvents = [
      { id:'spirit_rain', name:'灵雨赐福', duration:18, color:'#72e6bf', text:'持续恢复生命与能量' },
      { id:'blood_moon', name:'血月侵袭', duration:22, color:'#ff6b5b', text:'怪物强化，掉落翻倍' },
      { id:'mist', name:'峡谷迷雾', duration:20, color:'#a8c6d7', text:'视野收缩，怪物移速降低' },
      { id:'meteor', name:'晶石坠落', duration:16, color:'#d6a6ff', text:'地图出现危险落点与额外材料' },
    ];
  }

  generateTerrain() {
    const size = CONFIG.expedition.mapSize;
    const theme = this.map.terrain;

    // 出生区固定地标，确保玩家进入地图就能感知地形差异。
    this.terrainRoads.push(
      { x1: -100, y1: 470, cx: size * .46, cy: 650, x2: size + 100, y2: 560, width: 62 },
    );
    this.terrainPatches.push({
      x: 1030, y: 360, rx: 185, ry: 120, rotation: -0.18, type: 'water',
      color: theme.water, alpha: 0.46, phase: 0.8,
    });
    this.terrainFields.push({ x: 390, y: 250, w: 360, h: 235, rotation: 0.03, ruined: this.map.tier >= 3 });

    for (let i = 0; i < Math.max(1, this.map.tier - 1); i++) {
      const horizontal = i % 2 === 0;
      this.terrainRoads.push(horizontal
        ? { x1: -100, y1: rand(260, size - 260), cx: size * .5, cy: rand(240, size - 240), x2: size + 100, y2: rand(260, size - 260), width: rand(46, 72) }
        : { x1: rand(260, size - 260), y1: -100, cx: rand(240, size - 240), cy: size * .5, x2: rand(260, size - 260), y2: size + 100, width: rand(46, 72) });
    }

    for (let i = 0; i < 12 + this.map.tier * 3; i++) {
      const waterChance = (0.14 + this.map.tier * 0.015) * (this.map.waterHeavy ? 2.2 : 1);
      const type = Math.random() < waterChance ? 'water' : (Math.random() < 0.5 ? 'soil' : 'grass');
      this.terrainPatches.push({
        x: rand(100, size - 100), y: rand(100, size - 100),
        rx: rand(90, 260), ry: rand(65, 190), rotation: rand(0, Math.PI), type,
        color: type === 'water' ? theme.water : (type === 'soil' ? theme.soil : theme.glow),
        alpha: type === 'grass' ? 0.07 : (type === 'water' ? 0.42 : 0.34),
        phase: rand(0, Math.PI * 2),
      });
    }

    for (let i = 0; i < 3 + this.map.tier; i++) {
      this.terrainFields.push({
        x: rand(120, size - 520), y: rand(120, size - 420),
        w: rand(230, 470), h: rand(150, 330), rotation: rand(-0.16, 0.16),
        ruined: Math.random() < this.map.tier * 0.16,
      });
    }

    const groundDetails = this.map.tier <= 2 ? ['grass', 'pebble', 'straw'] : ['crack', 'pebble', 'blight'];
    for (let i = 0; i < 30 + this.map.tier * 8; i++) {
      this.terrainDecor.push({
        x: rand(50, size - 50), y: rand(50, size - 50),
        kind: groundDetails[randInt(0, groundDetails.length - 1)],
        size: randInt(5, 13), alpha: rand(0.18, 0.42), rotation: rand(0, Math.PI * 2),
      });
    }

    const obstacleTypes = [
      ['tree', 'bush', 'rock', 'hay', 'fence'],
      ['tree', 'bush', 'rock', 'hay', 'fence', 'ruin'],
      ['deadTree', 'rock', 'ruin', 'toxicCrystal', 'fence'],
      ['deadTree', 'rock', 'monolith', 'voidCrystal', 'ruin'],
    ][this.map.tier - 1];
    for (let i = 0; i < 22 + this.map.tier * 7; i++) {
      let x = rand(120, size - 120), y = rand(120, size - 120);
      let attempts = 0;
      while (dist({x, y}, this.player) < 260 && attempts++ < 12) {
        x = rand(120, size - 120); y = rand(120, size - 120);
      }
      const type = obstacleTypes[randInt(0, obstacleTypes.length - 1)];
      const scales = { tree:1.1, bush:.88, deadTree:1.05, rock:.9, hay:.9, fence:1.15, ruin:1.25, toxicCrystal:1, voidCrystal:1.05, monolith:1.25 };
      const scale = (scales[type] || 1) * rand(.78, 1.22);
      const footprint = { tree:32, bush:26, rock:19, hay:20, fence:26, ruin:25, deadTree:28, toxicCrystal:16, voidCrystal:16, monolith:19 };
      // 植物类碰撞盒扩大到覆盖视觉树冠/灌木本体，避免玩家角色“钻”进植物里。
      // 数值以精灵图不透明像素包围盒为准：树冠半宽约43、灌木约13、枯树约21（scale=1）。
      const footprintShape = {
        tree: { rx: 52, ry: 32, offsetY: 4 },
        bush: { rx: 34, ry: 24, offsetY: 4 },
        rock: { rx: 23, ry: 15, offsetY: 3 },
        deadTree: { rx: 38, ry: 26, offsetY: 3 },
      }[type];
      this.obstacles.push({
        type, x, y, scale, radius: (footprint[type] || 18) * scale,
        collisionRx: footprintShape?.rx * scale,
        collisionRy: footprintShape?.ry * scale,
        collisionOffsetY: (footprintShape?.offsetY || 0) * scale,
        rotation: rand(-.16, .16)
      });
    }

    const trapCatalog = [
      { type: 'thorn', name: '荆棘丛', icon: '🌵', color: '#85c85d', radius: 34, damage: 8, cooldown: 1.4, slow: 1.1 },
      { type: 'bear', name: '捕兽夹', icon: '⚙️', color: '#e5b65a', radius: 26, damage: 18, cooldown: 3.5, slow: 2.2 },
      { type: 'poison', name: '毒孢子', icon: '☣️', color: '#90d354', radius: 58, damage: 7, cooldown: 1.1, slow: 0.7 },
      { type: 'lightning', name: '落雷符文', icon: '⚡', color: '#b999ff', radius: 52, damage: 28, cooldown: 4.5, slow: 0.3 },
    ];
    const availableTrapCount = Math.min(trapCatalog.length, Math.max(2, this.map.tier + 1));
    for (let i = 0; i < 5 + this.map.tier * 3; i++) {
      const base = trapCatalog[randInt(0, availableTrapCount - 1)];
      this.traps.push({
        ...base,
        x: rand(380, size - 180), y: rand(180, size - 180),
        triggerCd: rand(0, base.cooldown), phase: rand(0, Math.PI * 2),
      });
    }
  }

  renderTerrainDirect(ctx, cam) {
    const theme = this.map.terrain;
    // 使用 chunk canvas 实际尺寸，而非全局画布尺寸（修复全黑问题）
    const viewW = ctx.canvas.width || CONFIG.canvas.width;
    const viewH = ctx.canvas.height || CONFIG.canvas.height;
    // v3.5 优先画地图背景图，没有图才用纯色
    let usedBgImage = false;
    if (this.mapBgLoaded && this.mapBgImg && this.mapBgImg.complete && this.mapBgImg.naturalWidth > 0) {
      const iw = this.mapBgImg.naturalWidth, ih = this.mapBgImg.naturalHeight;
      const scale = Math.max(viewW / iw, viewH / ih);
      const dw = iw * scale, dh = ih * scale;
      const offX = -((cam.x * 0.5) % dw);
      const offY = -((cam.y * 0.5) % dh);
      ctx.globalAlpha = 0.85;
      for (let x = offX - dw; x < viewW + dw; x += dw) {
        for (let y = offY - dh; y < viewH + dh; y += dh) {
          ctx.drawImage(this.mapBgImg, x, y, dw, dh);
        }
      }
      ctx.globalAlpha = 1;
      usedBgImage = true;
    }
    if (!usedBgImage) {
      ctx.fillStyle = this.map.bgColor;
      ctx.fillRect(0, 0, viewW, viewH);
    }

    // Continuous grass field: 用全局坐标算散点，避免 chunk 拼接处出现接缝
    ctx.save();
    ctx.globalAlpha = 0.11;
    ctx.strokeStyle = theme.glow;
    ctx.lineWidth = 1;
    // 全局世界坐标种子，保证相邻 chunk 图案连续
    const gx0 = cam.x, gy0 = cam.y;
    const seed = Math.floor(gx0 / 38) * 17 + Math.floor(gy0 / 38) * 31;
    for (let i = 0; i < 160; i++) {
      // 用全局坐标取模，确保跨 chunk 连续
      const wx = ((i * 83 + seed * 7) % 4096) - 2048;
      const wy = ((i * 137 + seed * 11) % 4096) - 2048;
      // 转到 chunk 局部坐标
      const x = wx - gx0;
      const y = wy - gy0;
      if (x < -20 || x > viewW + 20 || y < -20 || y > viewH + 20) continue;
      ctx.beginPath(); ctx.moveTo(x, y + 4); ctx.lineTo(x + 3, y - 3); ctx.stroke();
    }
    const light = ctx.createLinearGradient(0, 0, 0, viewH);
    light.addColorStop(0, 'rgba(255,255,255,.045)');
    light.addColorStop(0.52, 'rgba(255,255,255,0)');
    light.addColorStop(1, 'rgba(0,0,0,.18)');
    ctx.globalAlpha = 1; ctx.fillStyle = light; ctx.fillRect(0, 0, viewW, viewH);
    ctx.restore();

    this.terrainPatches.forEach(patch => {
      const sx = patch.x - cam.x, sy = patch.y - cam.y;
      if (sx < -patch.rx || sx > viewW + patch.rx || sy < -patch.ry || sy > viewH + patch.ry) return;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(patch.rotation);
      ctx.globalAlpha = patch.alpha;
      ctx.fillStyle = patch.color;
      ctx.beginPath();
      for (let i = 0; i <= 20; i++) {
        const angle = i / 20 * Math.PI * 2;
        const wobble = 1 + Math.sin(angle * 3 + (patch.phase || 0)) * 0.08 + Math.sin(angle * 5 - (patch.phase || 0)) * 0.045;
        const px = Math.cos(angle) * patch.rx * wobble;
        const py = Math.sin(angle) * patch.ry * wobble;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      if (patch.type === 'water') {
        ctx.globalAlpha = 0.24;
        ctx.strokeStyle = '#c1eef0';
        ctx.lineWidth = 3;
        ctx.stroke();
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(-patch.rx * 0.45, i * 18);
          ctx.quadraticCurveTo(0, i * 18 + 8, patch.rx * 0.45, i * 18);
          ctx.stroke();
        }
      }
      ctx.restore();
    });

    this.terrainRoads.forEach(road => {
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(20,18,13,.32)';
      ctx.lineWidth = road.width + 12;
      ctx.beginPath();
      ctx.moveTo(road.x1 - cam.x, road.y1 - cam.y);
      if (Number.isFinite(road.cx)) ctx.quadraticCurveTo(road.cx - cam.x, road.cy - cam.y, road.x2 - cam.x, road.y2 - cam.y);
      else ctx.lineTo(road.x2 - cam.x, road.y2 - cam.y);
      ctx.stroke();
      ctx.strokeStyle = theme.path;
      ctx.globalAlpha = 0.62;
      ctx.lineWidth = road.width;
      ctx.beginPath();
      ctx.moveTo(road.x1 - cam.x, road.y1 - cam.y);
      if (Number.isFinite(road.cx)) ctx.quadraticCurveTo(road.cx - cam.x, road.cy - cam.y, road.x2 - cam.x, road.y2 - cam.y);
      else ctx.lineTo(road.x2 - cam.x, road.y2 - cam.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    });

    // 不再绘制规则田块、边框和横向犁沟；只保留柔和的不规则地表斑块。
    this.terrainFields.forEach(field => {
      const cx = field.x + field.w / 2 - cam.x;
      const cy = field.y + field.h / 2 - cam.y;
      if (cx < -field.w || cx > viewW + field.w || cy < -field.h || cy > viewH + field.h) return;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(field.rotation);
      ctx.fillStyle = field.ruined ? 'rgba(50,35,30,.14)' : 'rgba(101,70,39,.13)';
      ctx.beginPath();
      const points = 18;
      for (let i = 0; i <= points; i++) {
        const a = i / points * Math.PI * 2;
        const wobble = 1 + Math.sin(a * 3 + field.x) * .08 + Math.sin(a * 5 + field.y) * .05;
        const px = Math.cos(a) * field.w * .46 * wobble;
        const py = Math.sin(a) * field.h * .46 * wobble;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    });

    // 道路高光放在田块上层，避免随机田块把主路完全遮住。
    this.terrainRoads.forEach(road => {
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(240,220,170,.16)';
      ctx.lineWidth = Math.max(4, road.width * 0.16);
      ctx.beginPath();
      ctx.moveTo(road.x1 - cam.x, road.y1 - cam.y);
      if (Number.isFinite(road.cx)) ctx.quadraticCurveTo(road.cx - cam.x, road.cy - cam.y, road.x2 - cam.x, road.y2 - cam.y);
      else ctx.lineTo(road.x2 - cam.x, road.y2 - cam.y);
      ctx.stroke();
    });

    this.terrainDecor.forEach(decor => {
      const sx = decor.x - cam.x, sy = decor.y - cam.y;
      if (sx < -40 || sx > viewW + 40 || sy < -40 || sy > viewH + 40) return;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(decor.rotation);
      ctx.globalAlpha = decor.alpha;
      if (decor.kind === 'grass') {
        ctx.strokeStyle = '#92b56c'; ctx.lineWidth = 1.4;
        for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(i * 3, 3); ctx.lineTo(i * 5, -decor.size); ctx.stroke(); }
      } else if (decor.kind === 'pebble') {
        ctx.fillStyle = '#9a9687'; ctx.beginPath(); ctx.ellipse(0, 0, decor.size, decor.size * .45, 0, 0, Math.PI * 2); ctx.fill();
      } else if (decor.kind === 'straw') {
        ctx.strokeStyle = '#c5a75d'; ctx.lineWidth = 1.2;
        for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(-decor.size, i * 2); ctx.lineTo(decor.size, i * 2 - 4); ctx.stroke(); }
      } else if (decor.kind === 'crack') {
        ctx.strokeStyle = '#1d1718'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(-decor.size, -3); ctx.lineTo(0, 0); ctx.lineTo(decor.size, 4); ctx.moveTo(0,0); ctx.lineTo(4,-decor.size); ctx.stroke();
      } else {
        ctx.fillStyle = '#667b3b'; ctx.beginPath(); ctx.arc(0, 0, decor.size, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    });

    // v3.7 绘制高低差区域
    if (this.heightZones) {
      this.heightZones.forEach(z => {
        const sx = z.x - cam.x, sy = z.y - cam.y;
        if (sx < -z.r || sx > viewW + z.r || sy < -z.r || sy > viewH + z.r) return;
        const g = ctx.createRadialGradient(sx, sy, z.r * 0.2, sx, sy, z.r);
        if (z.type === 'high') {
          g.addColorStop(0, 'rgba(255,220,140,0.18)');
          g.addColorStop(1, 'rgba(255,220,140,0)');
        } else {
          g.addColorStop(0, 'rgba(80,60,40,0.22)');
          g.addColorStop(1, 'rgba(80,60,40,0)');
        }
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(sx, sy, z.r, 0, Math.PI * 2);
        ctx.fill();
        // 边框圈
        ctx.strokeStyle = z.type === 'high' ? 'rgba(255,220,140,0.4)' : 'rgba(80,60,40,0.4)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.arc(sx, sy, z.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      });
    }

    const vignette = ctx.createRadialGradient(viewW / 2, viewH / 2, 170, viewW / 2, viewH / 2, 720);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,.12)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, viewW, viewH);
  }

  renderTerrain(ctx, cam) {
    const chunkSize = this.terrainChunkCache.chunkSize;
    const minX = Math.max(0, Math.floor(cam.x / chunkSize));
    const maxX = Math.min(Math.ceil(CONFIG.expedition.mapSize / chunkSize) - 1, Math.floor((cam.x + CONFIG.canvas.width) / chunkSize));
    const minY = Math.max(0, Math.floor(cam.y / chunkSize));
    const maxY = Math.min(Math.ceil(CONFIG.expedition.mapSize / chunkSize) - 1, Math.floor((cam.y + CONFIG.canvas.height) / chunkSize));
    for (let cy = minY; cy <= maxY; cy++) for (let cx = minX; cx <= maxX; cx++) {
      const chunk = this.terrainChunkCache.get(cx, cy, (chunkCtx, worldX, worldY) => {
        this.renderTerrainDirect(chunkCtx, { x: worldX, y: worldY });
      });
      ctx.drawImage(chunk, cx * chunkSize - cam.x - 1, cy * chunkSize - cam.y - 1, chunkSize + 2, chunkSize + 2);
    }
  }

  getDepthScale(worldY) {
    const screenY = worldY - this.camera.y;
    return clamp(0.82 + screenY / CONFIG.canvas.height * 0.24, 0.78, 1.1);
  }

  renderCastShadow(ctx, worldX, worldY, width, height, opacity = 0.32, lift = 0) {
    const sx = worldX - this.camera.x;
    const sy = worldY - this.camera.y;
    const length = 0.7 + Math.min(height, 90) / 100;
    const dx = this.sunVector.x * height * length;
    const dy = this.sunVector.y * height * 0.55;
    ctx.save();
    ctx.translate(sx + dx * 0.45, sy + dy * 0.45);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.scale(1, 0.34);
    const shadow = ctx.createRadialGradient(0, 0, width * 0.08, 0, 0, width * (1 + lift * 0.018));
    shadow.addColorStop(0, `rgba(2,7,6,${opacity})`);
    shadow.addColorStop(0.62, `rgba(2,7,6,${opacity * 0.62})`);
    shadow.addColorStop(1, 'rgba(2,7,6,0)');
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.ellipse(0, 0, width * (1 + lift * 0.02), Math.max(6, height * 0.34), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  isBehindHero(obstacle) {
    const closeX = Math.abs(obstacle.x - this.player.x) < obstacle.radius + 34;
    const inOcclusionBand = obstacle.y > this.player.y - 92 && obstacle.y < this.player.y + 18;
    return closeX && inOcclusionBand && ['tree', 'deadTree', 'ruin', 'monolith', 'crystal', 'toxicCrystal'].includes(obstacle.type);
  }

  renderObstacle(ctx, obstacle, cam) {
    const sx = obstacle.x - cam.x, sy = obstacle.y - cam.y;
    if (sx < -100 || sx > CONFIG.canvas.width + 100 || sy < -130 || sy > CONFIG.canvas.height + 100) return;
    const s = obstacle.scale;
    const heightByType = { tree:76, deadTree:62, rock:34, hay:30, fence:30, ruin:60, monolith:72, crystal:58, toxicCrystal:58 };
    this.renderCastShadow(ctx, obstacle.x, obstacle.y, (obstacle.type === 'fence' ? 40 : 28) * s, (heightByType[obstacle.type] || 48) * s, 0.3);
    ctx.save();
    ctx.globalAlpha = this.isBehindHero(obstacle) ? 0.38 : 1;
    const depthScale = this.getDepthScale(obstacle.y);
    ctx.translate(sx, sy);
    ctx.rotate(obstacle.rotation);
    ctx.scale(s * depthScale, s * depthScale);

    const obstacleSprite = this.obstacleSprites[obstacle.type];
    if (obstacleSprite?.complete && obstacleSprite.naturalWidth) {
      const size = obstacle.type === 'tree' ? 112 : obstacle.type === 'bush' ? 70 : 62;
      ctx.drawImage(obstacleSprite, -size / 2, -size * .84, size, size);
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.rotate(-obstacle.rotation);
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    ctx.filter = 'blur(4px)';
    ctx.beginPath(); ctx.ellipse(8, 8, obstacle.type === 'fence' ? 38 : 28, 11, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.filter = 'none';

    if (obstacle.type === 'tree') {
      const trunk = ctx.createLinearGradient(-7, 0, 8, 0); trunk.addColorStop(0, '#4b2d18'); trunk.addColorStop(.55, '#86512a'); trunk.addColorStop(1, '#2b1b12');
      ctx.fillStyle = trunk; ctx.fillRect(-7, -31, 14, 37);
      ctx.fillStyle = '#2c5a32'; ctx.beginPath(); ctx.arc(-12, -39, 20, 0, Math.PI*2); ctx.arc(11, -43, 23, 0, Math.PI*2); ctx.arc(0, -59, 24, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = 'rgba(160,211,118,.32)'; ctx.beginPath(); ctx.arc(-7, -61, 12, 0, Math.PI*2); ctx.fill();
    } else if (obstacle.type === 'deadTree') {
      ctx.strokeStyle = '#4b3428'; ctx.lineWidth = 9; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 3); ctx.lineTo(0, -49); ctx.moveTo(0,-35); ctx.lineTo(-19,-51); ctx.moveTo(1,-29); ctx.lineTo(20,-44); ctx.stroke();
      ctx.strokeStyle = '#8a6750'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-2,0); ctx.lineTo(-2,-46); ctx.stroke();
    } else if (obstacle.type === 'rock') {
      ctx.fillStyle = '#555960'; ctx.beginPath(); ctx.moveTo(-27,3); ctx.lineTo(-21,-18); ctx.lineTo(-7,-32); ctx.lineTo(18,-25); ctx.lineTo(28,-5); ctx.lineTo(17,10); ctx.lineTo(-12,12); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#818892'; ctx.beginPath(); ctx.moveTo(-20,-18); ctx.lineTo(-7,-32); ctx.lineTo(18,-25); ctx.lineTo(6,-13); ctx.lineTo(-9,-9); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.24)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-17,-18); ctx.lineTo(-6,-29); ctx.lineTo(12,-24); ctx.stroke();
    } else if (obstacle.type === 'hay') {
      const hay = ctx.createLinearGradient(0,-25,0,9); hay.addColorStop(0,'#e1b84c'); hay.addColorStop(1,'#8c5f24');
      ctx.fillStyle = hay; ctx.beginPath(); ctx.roundRect(-27,-25,54,32,9); ctx.fill();
      ctx.strokeStyle = '#f0d06c'; ctx.lineWidth = 2; for(let y=-19;y<5;y+=7){ctx.beginPath();ctx.moveTo(-22,y);ctx.lineTo(22,y-3);ctx.stroke();}
      ctx.strokeStyle='#6e431e'; ctx.beginPath(); ctx.moveTo(0,-24); ctx.lineTo(0,7); ctx.stroke();
    } else if (obstacle.type === 'fence') {
      ctx.fillStyle='#61401f'; ctx.fillRect(-34,-30,8,37); ctx.fillRect(26,-30,8,37);
      const rail=ctx.createLinearGradient(0,-18,0,2);rail.addColorStop(0,'#9b6a34');rail.addColorStop(1,'#4b301c');ctx.fillStyle=rail;ctx.fillRect(-38,-22,76,8);ctx.fillRect(-38,-4,76,8);
      ctx.fillStyle='rgba(255,220,160,.18)';ctx.fillRect(-35,-21,70,2);
    } else if (obstacle.type === 'ruin') {
      ctx.fillStyle='#5e4538'; ctx.fillRect(-29,-42,49,47);
      ctx.fillStyle='#806251'; ctx.beginPath(); ctx.moveTo(-29,-42);ctx.lineTo(-19,-52);ctx.lineTo(30,-52);ctx.lineTo(20,-42);ctx.closePath();ctx.fill();
      ctx.fillStyle='#3c2d29'; ctx.beginPath();ctx.moveTo(20,-42);ctx.lineTo(30,-52);ctx.lineTo(30,-5);ctx.lineTo(20,5);ctx.closePath();ctx.fill();
      ctx.strokeStyle='rgba(202,160,119,.3)';ctx.lineWidth=2;for(let y=-34;y<2;y+=11){ctx.beginPath();ctx.moveTo(-26,y);ctx.lineTo(18,y);ctx.stroke();}
    } else if (obstacle.type === 'monolith') {
      ctx.fillStyle='#29273d';ctx.beginPath();ctx.moveTo(-19,4);ctx.lineTo(-15,-57);ctx.lineTo(10,-67);ctx.lineTo(22,-8);ctx.closePath();ctx.fill();
      ctx.fillStyle='#514a72';ctx.beginPath();ctx.moveTo(-15,-57);ctx.lineTo(10,-67);ctx.lineTo(3,-53);ctx.lineTo(-10,-46);ctx.closePath();ctx.fill();
      ctx.strokeStyle='#b89cff';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-2,-45);ctx.lineTo(5,-34);ctx.lineTo(-4,-20);ctx.stroke();
    } else {
      const toxic = obstacle.type === 'toxicCrystal';
      const base = toxic ? '#4b8d3b' : '#6653a0'; const light = toxic ? '#b4ef67' : '#c1a5ff';
      ctx.shadowColor=light;ctx.shadowBlur=13;ctx.fillStyle=base;
      [[-16,2,-10,-37,0,-5],[0,5,7,-52,13,-2],[11,5,22,-31,25,5]].forEach(p=>{ctx.beginPath();ctx.moveTo(p[0],p[1]);ctx.lineTo(p[2],p[3]);ctx.lineTo(p[4],p[5]);ctx.closePath();ctx.fill();});
      ctx.shadowBlur=0;ctx.strokeStyle=light;ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(7,-48);ctx.lineTo(7,-6);ctx.stroke();
    }
    ctx.restore();
  }

  renderMonster(ctx, monster, cam) {
    const sx = monster.x - cam.x, sy = monster.y - cam.y;
    const cullMargin = monster.type === 'boss' ? 180 : 90;
    if (sx < -cullMargin || sx > CONFIG.canvas.width + cullMargin || sy < -cullMargin || sy > CONFIG.canvas.height + cullMargin) return;
    // v3.3 攻击前摇可视化
    if (monster.windupT > 0) {
      const prog = 1 - monster.windupT / (monster.windupDur || 0.4);
      ctx.save();
      if (monster.windupKind === 'ranged') {
        // 抬手白光
        ctx.globalAlpha = 0.5 + 0.4 * Math.sin(prog * Math.PI * 4);
        ctx.fillStyle = '#ffdd88';
        ctx.beginPath(); ctx.arc(sx + Math.cos(monster.windupAngle || 0) * 22, sy - 14, 8, 0, Math.PI * 2); ctx.fill();
      } else if (monster.windupKind === 'bomb') {
        // 身体变红 + 倒计时
        ctx.globalAlpha = 0.4 + 0.3 * Math.sin(this.elapsed * 18);
        ctx.fillStyle = '#ff3322';
        ctx.beginPath(); ctx.arc(sx, sy, (monster.radius || 20) * (1.2 + prog), 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffffff'; ctx.font = 'bold 14px sans-serif';
        ctx.fillText(Math.ceil(monster.windupT).toString(), sx - 4, sy + 4);
      } else {
        // 近战：武器发光（白）+ 面前半圆预警区
        ctx.globalAlpha = 0.35 + 0.3 * prog;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(sx + Math.cos(monster.windupAngle || 0) * 26, sy + Math.sin(monster.windupAngle || 0) * 26, 7, 0, Math.PI * 2); ctx.fill();
        // 红色扇形
        ctx.globalAlpha = 0.18 + 0.15 * prog;
        ctx.fillStyle = '#ff4433';
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.arc(sx, sy, monster.attackRange || 36, (monster.windupAngle || 0) - 0.6, (monster.windupAngle || 0) + 0.6);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
    const scale = (monster.elite ? 1.18 : 1) * (monster.radius / 18) * this.getDepthScale(monster.y);
    const stride = Math.sin(monster.animTime || 0);
    const hpPct = clamp(monster.hp / monster.maxHp, 0, 1);
    ctx.save();
    const lift = monster.visualZ || 0;
    this.renderCastShadow(ctx, monster.x, monster.y, 28 * scale, 28 * scale, 0.38, lift);
    ctx.translate(sx + (monster.knockX || 0), sy - lift + (monster.knockY || 0) * 0.45);
    if (monster.state === 'death') {
      ctx.globalAlpha = clamp((monster.deathTimer || 0) / .42, 0, 1);
      ctx.rotate((1 - ctx.globalAlpha) * .85);
      ctx.scale(1, .65 + ctx.globalAlpha * .35);
    } else if (monster.state === 'hit') {
      ctx.translate(-3, 0);
    } else if (monster.state === 'attack') {
      ctx.translate(5, 0);
    }

    // T1/T2 Boss 使用三视图定制的伪 3D 透明素材，并保留实时阴影、受击和血条反馈。
    const bossSprite = this.bossSprites[`t${this.map.tier}`];
    if (monster.type === 'boss' && this.map.tier <= 2 && bossSprite?.complete) {
      const bossImage = bossSprite;
      const bossScale = this.getDepthScale(monster.y) * (1 + Math.sin(monster.animTime * 2.2) * .018);
      const drawW = (this.map.tier === 2 ? 205 : 190) * bossScale;
      const drawH = drawW * bossImage.naturalHeight / bossImage.naturalWidth;
      ctx.save();
      ctx.scale(1, .42);
      const bossShadow = ctx.createRadialGradient(8, 18, 8, 8, 18, drawW * .44);
      bossShadow.addColorStop(0, 'rgba(0,0,0,.68)');
      bossShadow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = bossShadow;
      ctx.beginPath(); ctx.arc(8, 18, drawW * .44, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      ctx.save();
      // Boss 攻击动作：挥击前倾 / 技能蓄力下压抖动发光 / 释放瞬间前扑
      if (monster.attackAnim > 0) {
        const k = Math.sin((monster.attackAnim / 0.34) * Math.PI);
        ctx.translate(Math.cos(monster.facing || 0) * 7 * k, 0);
        ctx.rotate(k * 0.14);
      } else if (monster.castState === 'windup') {
        const w = Math.sin(monster.castTimer * 26);
        ctx.translate(w * 2.4, -5 + w * 2);
        ctx.rotate(w * 0.05);
        ctx.shadowColor = '#ff9a4a';
        ctx.shadowBlur = 16 + (Math.sin(monster.castTimer * 30) + 1) * 10;
        ctx.globalAlpha = .93;
      } else if (monster.castState === 'cast') {
        ctx.translate(Math.cos(monster.facing || 0) * 6, 0);
      }
      ctx.translate(0, Math.sin(monster.animTime * 2.2) * 1.5);
      if (monster.hitFlash > 0) {
        ctx.shadowColor = this.map.tier === 2 ? '#8aeaff' : '#fff4cf';
        ctx.shadowBlur = 26;
        ctx.globalAlpha = .9;
      }
      ctx.drawImage(bossImage, -drawW * .5, -drawH + 25 * bossScale, drawW, drawH);
      if (this.map.tier === 2) {
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = .2 + Math.sin(monster.animTime * 4) * .06;
        ctx.shadowColor = '#54dcff';
        ctx.shadowBlur = 20;
        ctx.drawImage(bossImage, -drawW * .5, -drawH + 25 * bossScale, drawW, drawH);
      }
      ctx.restore();
      ctx.restore();

      const bossBarW = 112;
      const bossBarY = sy - drawH + 10;
      ctx.fillStyle = 'rgba(8,10,12,.9)'; ctx.beginPath(); ctx.roundRect(sx - bossBarW/2 - 3, bossBarY - 3, bossBarW + 6, 12, 5); ctx.fill();
      const bossHp = ctx.createLinearGradient(sx-bossBarW/2, 0, sx+bossBarW/2, 0);
      bossHp.addColorStop(0, this.map.tier === 2 ? '#247da0' : '#759c42');
      bossHp.addColorStop(1, this.map.tier === 2 ? '#73e3f2' : '#d6b755');
      ctx.fillStyle = bossHp; ctx.beginPath(); ctx.roundRect(sx - bossBarW/2, bossBarY, bossBarW * hpPct, 6, 3); ctx.fill();
      ctx.fillStyle = '#f1dfaa'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(monster.name || (this.map.tier === 2 ? '幽潮骨翼龙' : '苔岩裂颚兽'), sx, bossBarY - 8);
      return;
    }

    const spriteState = monster.state === 'death' ? 'death' : monster.hitFlash > 0 ? 'hit' : monster.state === 'attack' ? 'attack' : 'idle';
    const creatureSprite = this.monsterSprites[monster.type]?.[spriteState];
    if (creatureSprite?.complete && creatureSprite.naturalWidth) {
      const spriteScale = this.getDepthScale(monster.y) * (monster.elite ? 1.15 : 1);
      const drawSize = (monster.type === 'boar' ? 88 : monster.type === 'spider' ? 82 : 76) * spriteScale;
      ctx.save();
      if (Math.cos(monster.facing || 0) < 0) ctx.scale(-1, 1);
      ctx.drawImage(creatureSprite, -drawSize * .5, -drawSize * .67, drawSize, drawSize);
      ctx.restore();
      if (monster.attackAnim > 0 && this.fxSprites) {
        const fxMap = { treant: 'treant', gargoyle: 'gargoyle', shadow_demon: 'shadow', boar: 'boar', boar_king: 'boar' };
        const fxKey = fxMap[monster.type];
        if (fxKey) {
          const img = this.fxSprites[fxKey];
          if (img && img.naturalWidth) {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = Math.min(1, monster.attackAnim * 5);
            const fw = drawSize * 1.1;
            const fh = fw * img.naturalHeight / img.naturalWidth;
            ctx.drawImage(img, sx - fw/2, sy - fh/2, fw, fh);
            ctx.restore();
          }
        }
      }
      ctx.restore();
      const barW = monster.elite ? 54 : 44, barY = sy - drawSize * .52;
      ctx.fillStyle = 'rgba(8,10,12,.82)'; ctx.beginPath(); ctx.roundRect(sx - barW/2 - 2, barY - 2, barW + 4, 9, 4); ctx.fill();
      const spriteHp = ctx.createLinearGradient(sx-barW/2, 0, sx+barW/2, 0);
      spriteHp.addColorStop(0, hpPct > .35 ? '#57c96b' : '#db4b43'); spriteHp.addColorStop(1, hpPct > .35 ? '#a6e56e' : '#ff8a52');
      ctx.fillStyle = spriteHp; ctx.beginPath(); ctx.roundRect(sx - barW/2, barY, barW * hpPct, 5, 3); ctx.fill();
      return;
    }

    // Soft contact shadow anchors the creature to the terrain.
    ctx.save();
    ctx.scale(1, .42);
    const shadow = ctx.createRadialGradient(5, 12, 2, 5, 12, 33 * scale);
    shadow.addColorStop(0, 'rgba(0,0,0,.5)');
    shadow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shadow;
    ctx.beginPath(); ctx.arc(5, 12, 33 * scale, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    if (monster.elite) {
      ctx.globalAlpha = .28 + Math.sin(monster.animTime * 2) * .08;
      ctx.strokeStyle = '#d8a9ff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(0, 4, 30 * scale, 13 * scale, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.rotate(monster.facing || 0);
    ctx.scale(scale, scale);
    const flash = monster.hitFlash > 0;
    if (monster.type === 'boar') {
      // Layered hide, shoulder plate, legs, tusks and rim light.
      ctx.fillStyle = '#2b1b19';
      [-1, 1].forEach(side => { ctx.beginPath(); ctx.ellipse(-8 + stride * 2, side * 13, 13, 6, side * .12, 0, Math.PI * 2); ctx.fill(); });
      const hide = ctx.createLinearGradient(-24, -18, 25, 18);
      hide.addColorStop(0, flash ? '#fff0e7' : '#9b5a3e'); hide.addColorStop(.5, flash ? '#ffd9cf' : '#62372d'); hide.addColorStop(1, '#281a1b');
      ctx.fillStyle = hide; ctx.beginPath(); ctx.ellipse(-2, 0, 30, 20, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3b2a2a'; ctx.beginPath(); ctx.ellipse(23, 0, 15, 14, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1d1518'; ctx.beginPath(); ctx.ellipse(35, 0, 8, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#d9c49a';
      [-1,1].forEach(side => { ctx.beginPath(); ctx.moveTo(29, side * 7); ctx.quadraticCurveTo(38, side * 14, 43, side * 4); ctx.quadraticCurveTo(36, side * 9, 31, side * 3); ctx.fill(); });
      ctx.strokeStyle = 'rgba(255,205,150,.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(-7, -2, 21, Math.PI * 1.05, Math.PI * 1.7); ctx.stroke();
      ctx.fillStyle = '#f4b64b'; ctx.beginPath(); ctx.arc(27, -6, 2.4, 0, Math.PI * 2); ctx.fill();
    } else if (monster.type === 'bat') {
      // 腐翼蝙蝠：待机悬浮、攻击俯冲，受击闪白。
      const flap = Math.sin(monster.animTime * 5) * .25;
      ctx.fillStyle = flash ? '#fff4f1' : '#31243f';
      [-1, 1].forEach(side => { ctx.save(); ctx.rotate(side * (.55 + flap)); ctx.beginPath(); ctx.moveTo(-2, 0); ctx.quadraticCurveTo(-28, -25, -38, -4); ctx.quadraticCurveTo(-25, 3, -4, 9); ctx.closePath(); ctx.fill(); ctx.restore(); });
      ctx.fillStyle = flash ? '#ffd7d1' : '#6f4a83'; ctx.beginPath(); ctx.ellipse(4, 0, 16, 13, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f34f65'; [-1,1].forEach(side => { ctx.beginPath(); ctx.arc(11, side * 4, 2.4, 0, Math.PI * 2); ctx.fill(); });
      ctx.strokeStyle = '#d8a3d9'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(15, 8); ctx.lineTo(12, 14); ctx.lineTo(18, 12); ctx.stroke();
    } else if (monster.type === 'spider') {
      // 毒雾蛛：八足待机，远程喷吐绿色毒液弹。
      const step = Math.sin(monster.animTime * 3) * 3;
      ctx.strokeStyle = flash ? '#fff' : '#3f342e'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      for (let i = -1; i <= 1; i += 2) for (let j = 0; j < 4; j++) { ctx.beginPath(); ctx.moveTo(-4, i * 5); ctx.lineTo(-22 - j * 4, i * (12 + j * 4) + step * i); ctx.stroke(); }
      const shell = ctx.createRadialGradient(-5, -8, 2, 4, 3, 25); shell.addColorStop(0, flash ? '#efffe4' : '#b1c56c'); shell.addColorStop(.55, '#58633a'); shell.addColorStop(1, '#20251e');
      ctx.fillStyle = shell; ctx.beginPath(); ctx.ellipse(0, 0, 22, 17, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ef5b6d'; [-1, 1].forEach(side => { ctx.beginPath(); ctx.arc(15, side * 5, 2.5, 0, Math.PI * 2); ctx.fill(); });
      if (monster.state === 'attack') { ctx.strokeStyle = 'rgba(167,255,90,.75)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(22, 0, 8 + (monster.stateTimer || 0) * 10, -0.55, 0.55); ctx.stroke(); }
    } else if (monster.type === 'locust') {
      // Translucent wings and segmented chitin catch the environment light.
      ctx.globalAlpha = .55;
      const wing = ctx.createLinearGradient(-23, 0, 10, 0); wing.addColorStop(0, '#d8f2ba'); wing.addColorStop(1, 'rgba(100,180,105,.18)');
      ctx.fillStyle = wing;
      [-1,1].forEach(side => { ctx.save(); ctx.rotate(side * (.36 + stride * .04)); ctx.beginPath(); ctx.ellipse(-13, side * 8, 27, 8, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); });
      ctx.globalAlpha = 1;
      const shell = ctx.createLinearGradient(-22, -12, 22, 12); shell.addColorStop(0, flash ? '#f4ffe9' : '#b5bc42'); shell.addColorStop(.45, '#5d7e35'); shell.addColorStop(1, '#253d25');
      ctx.fillStyle = shell; ctx.beginPath(); ctx.ellipse(0, 0, 25, 10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#cbd66a'; ctx.lineWidth = 1.3; for(let x=-14;x<13;x+=8){ctx.beginPath();ctx.moveTo(x,-8);ctx.lineTo(x+3,8);ctx.stroke();}
      ctx.fillStyle='#31452c';ctx.beginPath();ctx.arc(23,0,9,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='#8ca85b';ctx.lineWidth=2;[-1,1].forEach(side=>{ctx.beginPath();ctx.moveTo(26,side*5);ctx.quadraticCurveTo(37,side*15,42,side*12);ctx.stroke();});
      ctx.fillStyle='#fff06a';[-1,1].forEach(side=>{ctx.beginPath();ctx.arc(27,side*3,1.8,0,Math.PI*2);ctx.fill();});
    } else {
      // Angular wolf silhouette with fur planes, paws, ears and luminous eyes.
      ctx.fillStyle='#20252d';
      [-1,1].forEach(side=>{ctx.beginPath();ctx.ellipse(-7+stride*2,side*14,15,6,side*.16,0,Math.PI*2);ctx.fill();});
      const fur=ctx.createLinearGradient(-26,-20,26,18);fur.addColorStop(0,flash?'#eef7ff':'#8794a3');fur.addColorStop(.5,flash?'#dceaff':'#46515f');fur.addColorStop(1,'#1f2731');
      ctx.fillStyle=fur;ctx.beginPath();ctx.moveTo(-31,0);ctx.lineTo(-18,-18);ctx.lineTo(8,-19);ctx.lineTo(29,-8);ctx.lineTo(33,0);ctx.lineTo(27,10);ctx.lineTo(5,18);ctx.lineTo(-19,15);ctx.closePath();ctx.fill();
      ctx.fillStyle='#394554';ctx.beginPath();ctx.moveTo(16,-11);ctx.lineTo(25,-27);ctx.lineTo(29,-9);ctx.lineTo(38,-20);ctx.lineTo(37,1);ctx.lineTo(26,12);ctx.closePath();ctx.fill();
      ctx.fillStyle='#171e27';ctx.beginPath();ctx.moveTo(-23,-7);ctx.quadraticCurveTo(-42,-20,-47,-11);ctx.quadraticCurveTo(-36,-7,-29,5);ctx.fill();
      ctx.fillStyle='#7ee5ff';[-1,1].forEach(side=>{ctx.beginPath();ctx.arc(30,side*5,2.2,0,Math.PI*2);ctx.fill();});
      ctx.strokeStyle='rgba(210,233,255,.48)';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(-15,-12);ctx.lineTo(5,-15);ctx.lineTo(19,-8);ctx.stroke();
    }
    ctx.restore();

    // Compact framed health bar and elite marker stay screen-aligned.
    const barW = monster.elite ? 54 : 44, barY = sy - monster.radius * scale - 24;
    ctx.fillStyle = 'rgba(8,10,12,.82)'; ctx.beginPath(); ctx.roundRect(sx - barW/2 - 2, barY - 2, barW + 4, 9, 4); ctx.fill();
    const hpGrad = ctx.createLinearGradient(sx-barW/2, 0, sx+barW/2, 0);
    hpGrad.addColorStop(0, hpPct > .35 ? '#57c96b' : '#db4b43'); hpGrad.addColorStop(1, hpPct > .35 ? '#a6e56e' : '#ff8a52');
    ctx.fillStyle = hpGrad; ctx.beginPath(); ctx.roundRect(sx - barW/2, barY, barW * hpPct, 5, 3); ctx.fill();
    if (monster.elite) { ctx.fillStyle='#edc7ff';ctx.font='bold 9px sans-serif';ctx.textAlign='center';ctx.fillText('ELITE',sx,barY-5); }
    if (monster.stunned > 0) { ctx.fillStyle='#ffe56b';ctx.font='15px sans-serif';ctx.textAlign='center';ctx.fillText('✦',sx,barY-12); }
  }

  // 怪物状态光环：冰冻（青色冰环+碎霜）/ 燃烧（暖色辉光）
  renderMonsterStatus(ctx, m, sx, sy) {
    const t = m.animTime || 0;
    if (m.slow > 0) {
      ctx.save();
      ctx.globalAlpha = 0.5 + Math.sin(t * 6) * 0.12;
      ctx.strokeStyle = '#9fe4ff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(sx, sy + 4, m.radius + 6, (m.radius + 6) * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#d8f6ff';
      for (let i = 0; i < 3; i++) {
        const a = t * 1.6 + i * 2.1;
        const px = sx + Math.cos(a) * (m.radius + 4), py = sy + Math.sin(a * 1.3) * (m.radius * 0.5);
        ctx.beginPath(); ctx.arc(px, py, 1.6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    if (m.burn) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35 + Math.sin(t * 14) * 0.1;
      const fg = ctx.createRadialGradient(sx, sy - 4, 2, sx, sy - 4, m.radius + 10);
      fg.addColorStop(0, 'rgba(255,170,60,.5)');
      fg.addColorStop(1, 'rgba(255,90,20,0)');
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.arc(sx, sy - 4, m.radius + 10, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  collidesWithObstacle(x, y, radius = 0) {
    return this.obstacleSpatialHash.queryCircle(x, y, radius + 90).some(obstacle => {
      let dx = x - obstacle.x;
      let dy = y - (obstacle.y + (obstacle.collisionOffsetY || 0));
      if (obstacle.collisionRx && obstacle.collisionRy) {
        const cos = Math.cos(-(obstacle.rotation || 0));
        const sin = Math.sin(-(obstacle.rotation || 0));
        const localX = dx * cos - dy * sin;
        const localY = dx * sin + dy * cos;
        const rx = obstacle.collisionRx + radius;
        const ry = obstacle.collisionRy + radius;
        return localX * localX / (rx * rx) + localY * localY / (ry * ry) < 1;
      }
      const minDistance = radius + obstacle.radius;
      return dx * dx + dy * dy < minDistance * minDistance;
    });
  }

  moveEntityWithCollisions(entity, dx, dy, radius = entity.collisionRadius || entity.radius * .72) {
    if (!dx && !dy) return;
    const oldX = entity.x, oldY = entity.y;
    entity.x += dx;
    if (this.collidesWithObstacle(entity.x, entity.y, radius)) entity.x = oldX;
    entity.y += dy;
    if (this.collidesWithObstacle(entity.x, entity.y, radius)) entity.y = oldY;
    entity.x = clamp(entity.x, radius, CONFIG.expedition.mapSize - radius);
    entity.y = clamp(entity.y, radius, CONFIG.expedition.mapSize - radius);
  }

  resolveUnitCollisions() {
    const living = this.monsters.filter(m => m.hp > 0);
    for (let i = 0; i < living.length; i++) {
      const a = living[i], ar = a.collisionRadius || a.radius * .72;
      const pdx = a.x - this.player.x, pdy = a.y - this.player.y;
      const playerMin = ar + this.player.collisionRadius;
      const playerDist = Math.hypot(pdx, pdy) || .001;
      if (playerDist < playerMin) {
        const push = (playerMin - playerDist) * .7;
        this.moveEntityWithCollisions(a, pdx / playerDist * push, pdy / playerDist * push, ar);
      }
      for (let j = i + 1; j < living.length; j++) {
        const b = living[j], br = b.collisionRadius || b.radius * .72;
        const dx = b.x - a.x, dy = b.y - a.y, minD = ar + br;
        const d = Math.hypot(dx, dy) || .001;
        if (d >= minD) continue;
        const push = (minD - d) * .32, nx = dx / d, ny = dy / d;
        this.moveEntityWithCollisions(a, -nx * push, -ny * push, ar);
        this.moveEntityWithCollisions(b, nx * push, ny * push, br);
      }
    }
  }

  findSafeSpawn(minEdge, maxEdge, radius = 20) {
    let position = { x: rand(minEdge, maxEdge), y: rand(minEdge, maxEdge) };
    for (let attempt = 0; attempt < 24; attempt++) {
      if (!this.collidesWithObstacle(position.x, position.y, radius + 12) && dist(position, this.player) > 140) {
        return position;
      }
      position = { x: rand(minEdge, maxEdge), y: rand(minEdge, maxEdge) };
    }
    return position;
  }

  // v3.4 地图词条实际逻辑
  // v3.7 生成高低差区域（高地/洼地）
  generateHeightZones() {
    const size = CONFIG.expedition.mapSize;
    this.heightZones = [];
    // 2-3 个高地（远程怪占，玩家上去射程+15%）
    const numHigh = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < numHigh; i++) {
      const p = this.findSafeSpawn(200, size - 200, 100);
      this.heightZones.push({ x: p.x, y: p.y, r: 90 + Math.random() * 50, type: 'high' });
    }
    // 2-3 个洼地（减速 30%）
    const numLow = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < numLow; i++) {
      const p = this.findSafeSpawn(200, size - 200, 100);
      this.heightZones.push({ x: p.x, y: p.y, r: 80 + Math.random() * 40, type: 'low' });
    }
  }

  // 查询某点所在的高度区
  getHeightAt(x, y) {
    if (!this.heightZones) return 'normal';
    for (const z of this.heightZones) {
      const d = Math.hypot(x - z.x, y - z.y);
      if (d < z.r) return z.type;
    }
    return 'normal';
  }

  // v3.7 打道具（油桶爆炸/木箱掉钱）
  damageProp(pr, dmg) {
    pr.hp -= dmg;
    this.spawnAoeEffect(pr.x, pr.y, 20, '#aaa');
    if (pr.hp <= 0) {
      if (pr.kind === 'barrel') {
        // 爆炸 AOE
        this.spawnAoeEffect(pr.x, pr.y, 100, '#ff6633');
        this.spawnRadialBurst(pr.x, pr.y, '#ffaa44', 30);
        // 对周围怪 AOE
        [...this.monsters, ...this.raiders].forEach(m => {
          const d = Math.hypot(m.x - pr.x, m.y - pr.y);
          if (d < 100) {
            this.damageEnemy(m, 35, '#ff6633', false, { x: m.x, y: m.y, fromPlayer: true });
          }
        });
        // 对玩家也造成伤害（谨慎用）
        const pd = Math.hypot(this.player.x - pr.x, this.player.y - pr.y);
        if (pd < 100) this.player.hp -= 15;
        showToast('💥 油桶爆炸！', 'gold');
      } else if (pr.kind === 'crate') {
        // 掉钱
        const gold = randInt(15, 40);
        this.spawnGroundLoot({ type: 'gold', name: '金币', amount: gold, icon: '💰' }, pr.x, pr.y);
        this.spawnAoeEffect(pr.x, pr.y, 30, '#ffd700');
        showToast(`📦 木箱掉落 ${gold} 金`, 'success');
      }
      pr.hp = 0;
      pr.destroyed = true;
    }
  }

  // v3.7 生成地标建筑（每张图 1 个独特锚点）
  generateLandmarks() {
    const size = CONFIG.expedition.mapSize;
    const tier = this.map.tier;
    // 按 tier 选地标
    const landmarkPool = {
      1: ['dead_tree', 'windmill'],
      2: ['stone_arch', 'dry_well'],
      3: ['giant_sword', 'stone_circle'],
    };
    const pool = landmarkPool[tier] || landmarkPool[1];
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    const p = this.findSafeSpawn(250, size - 250, 200);
    this.landmarks = [{ type: chosen, x: p.x, y: p.y, size: 180 }];
    // 预加载图片
    this.landmarkImgs = this.landmarkImgs || {};
    if (!this.landmarkImgs[chosen]) {
      const img = new Image();
      img.src = `assets/landmarks/${chosen}_t.png`;
      this.landmarkImgs[chosen] = img;
    }
  }

  // v3.7 生成可交互道具（油桶/木箱/高草/骷髅/推车）
  generateProps() {
    const size = CONFIG.expedition.mapSize;
    this.props = [];
    // 油桶（爆炸 AOE）
    const numBarrels = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < numBarrels; i++) {
      const p = this.findSafeSpawn(150, size - 150, 60);
      this.props.push({ kind: 'barrel', x: p.x, y: p.y, hp: 10, size: 40 });
    }
    // 木箱（打了掉钱）
    const numCrates = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < numCrates; i++) {
      const p = this.findSafeSpawn(150, size - 150, 60);
      this.props.push({ kind: 'crate', x: p.x, y: p.y, hp: 8, size: 36 });
    }
    // 高草（隐身）
    const numGrass = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < numGrass; i++) {
      const p = this.findSafeSpawn(100, size - 100, 80);
      this.props.push({ kind: 'grass', x: p.x, y: p.y, size: 70 });
    }
    // 骷髅（给临时武器/材料）
    const numSkeletons = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < numSkeletons; i++) {
      const p = this.findSafeSpawn(150, size - 150, 50);
      this.props.push({ kind: 'skeleton', x: p.x, y: p.y, size: 50, looted: false });
    }
    // 翻倒推车（掉材料）
    const numCarts = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < numCarts; i++) {
      const p = this.findSafeSpawn(150, size - 150, 50);
      this.props.push({ kind: 'cart', x: p.x, y: p.y, size: 60, looted: false });
    }
    // 预加载图片
    this.propImgs = this.propImgs || {};
    ['barrel','crate','grass','skeleton','cart'].forEach(k => {
      if (!this.propImgs[k]) {
        const img = new Image();
        img.src = `assets/props/${k}_t.png`;
        this.propImgs[k] = img;
      }
    });
  }

  // v3.7 生成巡逻队（2-3 支，每支沿固定路线走，玩家靠近才追）
  generatePatrols() {
    const size = CONFIG.expedition.mapSize;
    this.patrols = [];
    const numPatrols = 2 + Math.floor(Math.random() * 2);
    const monsterTypesByTier = {
      1: ['boar', 'wolf', 'spider'],
      2: ['boar', 'wolf', 'gargoyle', 'brute'],
      3: ['shadow', 'lava', 'brute', 'gargoyle'],
    };
    const types = monsterTypesByTier[this.map.tier] || monsterTypesByTier[1];

    for (let p = 0; p < numPatrols; p++) {
      // 选一个中心区域，生成 4-5 个巡逻点
      const cx = randInt(300, size - 300);
      const cy = randInt(300, size - 300);
      const waypoints = [];
      const numWp = 3 + Math.floor(Math.random() * 2);
      for (let w = 0; w < numWp; w++) {
        const ang = (w / numWp) * Math.PI * 2 + Math.random() * 0.5;
        const r = randInt(150, 300);
        waypoints.push({
          x: clamp(cx + Math.cos(ang) * r, 100, size - 100),
          y: clamp(cy + Math.sin(ang) * r, 100, size - 100),
        });
      }
      // 每支巡逻队 2-3 只怪
      const squadSize = 2 + Math.floor(Math.random() * 2);
      const members = [];
      for (let s = 0; s < squadSize; s++) {
        const type = types[randInt(0, types.length - 1)];
        const data = CONFIG.monsters[type];
        if (!data) continue;
        // 出生在第一个巡逻点附近
        const startWp = waypoints[0];
        const offset = s * 25;
        const m = {
          type, ...data,
          x: startWp.x + Math.cos(s) * offset,
          y: startWp.y + Math.sin(s) * offset,
          hp: data.hp, maxHp: data.hp,
          damage: data.damage * this.balance.enemyDamage,
          speed: data.speed * this.balance.enemySpeed,
          attackCd: 1, vx: 0, vy: 0, facing: 0, animTime: 0, hitFlash: 0,
          elite: false, abilityCd: 2, packOffset: 0,
          state: 'patrol', stateTimer: 0,
          patrolRoute: waypoints,
          patrolWpIndex: 1, // 下一个要去的点
          patrolOffset: s * 30, // 编队偏移
          lostPlayerTimer: 0,
        };
        this.monsters.push(m);
        members.push(m);
      }
      this.patrols.push({ waypoints, members });
    }
  }

  applyMapModifiers() {
    const size = CONFIG.expedition.mapSize;
    const mid = size / 2;
    const id = this.map.id;

    // T1_4 旧采石场：多石障碍
    if (id === 't1_4') {
      for (let i = 0; i < 22; i++) {
        const p = this.findSafeSpawn(150, size - 150, 28);
        this.obstacles.push({ x: p.x, y: p.y, w: rand(36, 70), h: rand(36, 70), type: 'rock', hp: 999 });
      }
    }
    // T2_3 旧磨坊：多建筑障碍
    if (id === 't2_3') {
      for (let i = 0; i < 14; i++) {
        const p = this.findSafeSpawn(200, size - 200, 40);
        this.obstacles.push({ x: p.x, y: p.y, w: rand(50, 90), h: rand(50, 90), type: 'building', hp: 999 });
      }
    }
    // T2_4 烟熏果园：怪物埋伏在玩家附近
    if (id === 't2_4') {
      for (let i = 0; i < 6; i++) {
        const ang = rand(0, Math.PI * 2);
        const dist = rand(180, 320);
        const x = mid + Math.cos(ang) * dist;
        const y = mid + Math.sin(ang) * dist;
        const type = ['boar', 'wolf', 'spider'][randInt(0, 2)];
        const data = CONFIG.monsters[type];
        this.monsters.push({
          type, ...data, x, y,
          hp: data.hp, maxHp: data.hp, damage: data.damage * this.balance.enemyDamage,
          speed: data.speed * this.balance.enemySpeed, attackCd: 1,
          vx: 0, vy: 0, facing: 0, animTime: 0, hitFlash: 0,
          elite: false, abilityCd: 2, packOffset: 0, state: 'idle', stateTimer: 0
        });
      }
    }
    // T2_5 断桥废墟：坑洞（掉血区域）
    if (id === 't2_5') {
      this.hazardZones = this.hazardZones || [];
      for (let i = 0; i < 8; i++) {
        const p = this.findSafeSpawn(200, size - 200, 40);
        this.hazardZones.push({ x: p.x, y: p.y, r: rand(50, 90), damage: 8, type: 'pit', tick: 0 });
      }
    }
    // T3_2 腐殖沼泽：泥地减速区
    if (id === 't3_2') {
      this.hazardZones = this.hazardZones || [];
      for (let i = 0; i < 6; i++) {
        const p = this.findSafeSpawn(200, size - 200, 40);
        this.hazardZones.push({ x: p.x, y: p.y, r: rand(80, 140), type: 'mud', slow: 0.5 });
      }
    }
    // T4_2 深渊祭坛：毒雾区
    if (id === 't4_2') {
      this.hazardZones = this.hazardZones || [];
      for (let i = 0; i < 5; i++) {
        const p = this.findSafeSpawn(200, size - 200, 40);
        this.hazardZones.push({ x: p.x, y: p.y, r: rand(90, 150), damage: 6, type: 'poison', tick: 0 });
      }
    }
    // T4_3 龙骨荒原：远程怪更多
    if (id === 't4_3') {
      const rangedTypes = ['spider', 'locust'];
      for (let i = 0; i < 10; i++) {
        const type = rangedTypes[randInt(0, 1)];
        const data = CONFIG.monsters[type];
        const p = this.findSafeSpawn(300, size - 300, 18);
        this.monsters.push({
          type, ...data, x: p.x, y: p.y,
          hp: Math.round(data.hp * this.balance.enemyHp),
          maxHp: Math.round(data.hp * this.balance.enemyHp),
          damage: Math.round(data.damage * this.balance.enemyDamage),
          speed: data.speed * this.balance.enemySpeed, attackCd: 0,
          vx: 0, vy: 0, facing: 0, animTime: 0, hitFlash: 0,
          elite: false, abilityCd: 2, packOffset: 0, state: 'idle', stateTimer: 0
        });
      }
    }
    // T4_4 时空裂隙：随机传送门
    if (id === 't4_4') {
      this.teleporters = [];
      for (let i = 0; i < 4; i++) {
        const p = this.findSafeSpawn(300, size - 300, 30);
        this.teleporters.push({ x: p.x, y: p.y, r: 28, cd: 0 });
      }
    }
    // T4_5 月见森林：夜间模式
    if (id === 't4_5') {
      this.nightMode = true;
    }
  }

  spawnEntities() {
    const size = CONFIG.expedition.mapSize;
    // 怪物
    const monsterTypes = ['boar', 'bat', 'spider', 'locust', 'wolf'];
    for (let i = 0; i < this.map.monsterCount; i++) {
      // 三种基础小兵在所有难度都会出现，其他种类随难度混入。
      const basicTypes = ['boar', 'bat', 'spider'];
      const extraTypes = this.map.tier >= 2 ? ['locust'] : [];
      if (this.map.tier >= 3) extraTypes.push('wolf');
      const pool = [...basicTypes, ...extraTypes];
      // v1.4 新怪按T级加入
      if (this.map.tier >= 1) pool.push('treant');          // T1+ 树精
      if (this.map.tier >= 2) pool.push('gargoyle');       // T2+ 石像鬼
      if (this.map.tier >= 3) pool.push('shadow_demon');   // T3+ 影魔
      // v1.4 精英怪低概率直接生成
      if (this.map.tier >= 2 && Math.random() < 0.08) pool.push('stone_golem');
      if (this.map.tier >= 1 && Math.random() < 0.06) pool.push('boar_king');
      // 反制兵种按T级固定混入（T2起：疾风狼/食草兽，T3+厚甲猪）
      const mix = CONFIG.counterMixes[this.map.tier - 1] || { swift_wolf: 0, herbivore: 0, armored_boar: 0 };
      ['swift_wolf', 'herbivore', 'armored_boar'].forEach(mt => {
        const weight = mix[mt] || 0;
        for (let k = 0; k < Math.round(weight * (pool.length || 1)); k++) pool.push(mt);
      });
      const type = pool[randInt(0, pool.length - 1)];
      const data = CONFIG.monsters[type];
      const position = this.findSafeSpawn(300, size - 300, data.radius || 18);
      const elite = Math.random() < this.balance.eliteChance;
      const hpScale = this.balance.enemyHp * (elite ? 1.75 : 1);
      this.monsters.push({
        type, ...data,
        x: position.x, y: position.y,
        hp: Math.round(data.hp * hpScale), maxHp: Math.round(data.hp * hpScale),
        damage: Math.round(data.damage * this.balance.enemyDamage * (elite ? 1.25 : 1)),
        speed: data.speed * this.balance.enemySpeed,
        attackCd: 0, stunned: 0, target: null,
        vx: 0, vy: 0,
        facing: rand(0, Math.PI * 2), animTime: rand(0, 10), hitFlash: 0,
        elite, abilityCd: rand(1, 4), packOffset: rand(-1, 1), state: 'idle', stateTimer: 0
      });
      // v0.6.0 分配AI类型 + 精英强化
      const _m = this.monsters[this.monsters.length - 1];
      if (typeof CombatEnhancement !== 'undefined') {
        CombatEnhancement.assignAIType(_m);
        if (elite) CombatEnhancement.makeElite(_m);
      }
    }
    // 宝箱
    for (let i = 0; i < this.map.chestCount; i++) {
      const position = this.findSafeSpawn(200, size - 200, 24);
      this.chests.push({
        x: position.x, y: position.y,
        opened: false, radius: 24,
        hasSignal: Math.random() < 0.15
      });
    }
    // 防御塔
    const towerCount = 3 + this.map.tier;
    for (let i = 0; i < towerCount; i++) {
      const position = this.findSafeSpawn(300, size - 300, 30);
      this.towers.push({
        x: position.x, y: position.y,
        state: i === 0 ? 'neutral' : (Math.random() < 0.55 ? 'neutral' : (Math.random() < 0.72 ? 'enemy' : 'broken')),
        radius: 30, range: 230, damage: 10 + this.map.tier * 2, attackCd: 0,
        hp: 180 + this.map.tier * 55, maxHp: 180 + this.map.tier * 55,
        captureProgress: 0
      });
    }
    // AI掠夺者
    for (let i = 0; i < this.map.raiderCount; i++) {
      const position = this.findSafeSpawn(400, size - 400, 16);
      this.raiders.push({
        x: position.x, y: position.y,
        hp: 80, maxHp: 80, damage: 10, speed: 130, radius: 16,
        attackCd: 0, stunned: 0, target: null, state: 'patrol',
        patrolTarget: { x: rand(200, size-200), y: rand(200, size-200) },
        loot: randInt(1, 3)
      });
    }
    // v1.0 撤离点随机化（每局1-2个，位置随机，小地图仅显示大致区域）
    this.extractPoints = [];
    const _extractCount = Math.random() < 0.4 ? 1 : 2;
    for (let _ei = 0; _ei < _extractCount; _ei++) {
      this.extractPoints.push({
        x: rand(200, size-200), y: rand(200, size-200), radius: 50,
        revealed: false, hidden: true
      });
    }
    // 初始养分结晶
    for (let i = 0; i < 3 + this.map.tier; i++) {
      const pos = this.findSafeSpawn(150, size - 150, 16);
      this.spawnNutrientCrystal(pos.x, pos.y, CONFIG.nutrients.crystalAmount);
    }
  }

  spawnBoss() {
    if (this.bossSpawned) return;
    this.bossSpawned = true;
    const position = this.findSafeSpawn(650, CONFIG.expedition.mapSize - 350, 46);
    this.boss = {
      type:'boss', name:['苔岩裂颚兽','幽潮骨翼龙','霜脉巨灵','紫月灾兽'][this.map.tier-1],
      x:position.x, y:position.y, radius:46,
      hp:this.balance.bossHp, maxHp:this.balance.bossHp,
      damage:this.balance.bossDamage, speed:76 + this.map.tier * 5,
      attackRange:70, attackCd:1.5, abilityCd:4, abilityIndex:0, phase:1, stunned:0,
      facing:0, animTime:0, hitFlash:0, elite:true, gold:100 * this.map.tier,
      castState:'idle', castTimer:0, castIndex:0, attackAnim:0,
    };
    this.monsters.push(this.boss);
    this.screenShake = 1;
    showToast(`区域首领「${this.boss.name}」已现身`, 'warning');
  }

  castBossAbility(boss, d, angle) {
    const phase2 = boss.phase === 2;
    const idx = boss.castIndex || 0;
    boss.castIndex++;
    const dmgMul = phase2 ? 1.3 : 1;
    if (idx === 0) {
      // 地裂震荡：玩家脚下AOE + 冲击环
      this.spawnAoeEffect(this.player.x, this.player.y, phase2 ? 110 : 88, '#d59aff');
      this.spawnShockRing(this.player.x, this.player.y, '#d59aff', phase2 ? 110 : 88);
      if (d < (phase2 ? 175 : 155)) this.damagePlayer(boss.damage * .72 * dmgMul);
    } else if (idx === 1) {
      // 狂暴冲锋：向玩家突进，路径拖尾 + 终点冲击
      const dashDist = phase2 ? 170 : 140;
      boss.x = clamp(boss.x + Math.cos(angle) * dashDist, 60, CONFIG.expedition.mapSize - 60);
      boss.y = clamp(boss.y + Math.sin(angle) * dashDist, 60, CONFIG.expedition.mapSize - 60);
      for (let i = 0; i < 10; i++) {
        this.spawnDirectionalSparks(boss.x - Math.cos(angle) * i * 14, boss.y - Math.sin(angle) * i * 14, angle + Math.PI, '#ff9a3c', 1, 1);
      }
      this.spawnShockRing(boss.x, boss.y, '#ff9a3c', 72);
      if (d < 115) this.damagePlayer(boss.damage * .9 * dmgMul);
    } else if (idx === 2) {
      // 召唤兽群
      const count = phase2 ? 3 : 2;
      const types = ['wolf', 'spider', 'bat'];
      for (let i = 0; i < count; i++) {
        const a = angle + (i - (count - 1) / 2) * 0.6;
        const sx = clamp(boss.x + Math.cos(a) * 95, 60, CONFIG.expedition.mapSize - 60);
        const sy = clamp(boss.y + Math.sin(a) * 95, 60, CONFIG.expedition.mapSize - 60);
        this.spawnAoeEffect(sx, sy, 38, '#9affd5');
        const type = types[randInt(0, types.length - 1)];
        const data = CONFIG.monsters[type];
        this.monsters.push({
          type, ...data, x: sx, y: sy,
          hp: Math.round(data.hp * this.balance.enemyHp * 0.6), maxHp: Math.round(data.hp * this.balance.enemyHp * 0.6),
          damage: Math.max(2, Math.round(data.damage * this.balance.enemyDamage * 0.7)),
          speed: data.speed * this.balance.enemySpeed,
          attackCd: 0, stunned: 0, facing: a, animTime: 0, hitFlash: 0,
          elite: false, abilityCd: rand(1, 3), packOffset: 0, beastWave: false, state: 'idle', stateTimer: 0
        });
      }
    } else {
      // 暗影弹幕：扇形投射物
      const count = phase2 ? 8 : 6;
      const color = phase2 ? '#ff6b9d' : '#d59aff';
      for (let i = 0; i < count; i++) {
        const a = angle + (i - (count - 1) / 2) * 0.18;
        const p = this.allocProjectile();
        Object.assign(p, {
          x: boss.x + Math.cos(a) * 40, y: boss.y + Math.sin(a) * 40,
          vx: Math.cos(a) * 260, vy: Math.sin(a) * 260,
          damage: boss.damage * 0.45 * dmgMul, life: 2.2, radius: 9,
          fromPlayer: false, color, pierce: 1
        });
        p.hit = p.hit || []; p.hit.length = 0;
        this.projectiles.push(p);
      }
      this.spawnMuzzleEffect(boss.x, boss.y, angle, color);
    }
  }

  // Boss 技能前摇预警：脚下蓄力圈（颜色随技能）+ 头顶警示脉冲由 renderMonster 表现
  spawnBossTelegraph(boss) {
    const colors = ['#d59aff', '#ff9a3c', '#9affd5', '#d59aff'];
    const color = colors[boss.castIndex % 4];
    const p = this.allocParticle();
    Object.assign(p, { x: boss.x, y: boss.y, vx: 0, vy: 0, life: 0.55, maxLife: 0.55, color, size: 74, type: 'aoe' });
    this.particles.push(p);
    const w = this.allocParticle();
    Object.assign(w, { x: boss.x, y: boss.y - 40, vx: 0, vy: -6, life: 0.5, maxLife: 0.5, color: '#fff6d8', size: 14, type: 'warn' });
    this.particles.push(w);
  }

  spawnBeastWave() {
    this.beastWave.wave++;
    this.beastWave.active = true;
    this.beastWave.duration = 32 + this.map.tier * 3;
    if (typeof AudioManager !== 'undefined' && AudioManager.playWaveWarning) AudioManager.playWaveWarning();
    const count = Math.min(60, 16 + this.map.tier * 5 + this.beastWave.wave * 5);
    const types = ['boar', 'bat', 'spider', 'locust', 'wolf'];
    for (let i = 0; i < count; i++) {
      const type = types[randInt(0, types.length - 1)];
      const data = CONFIG.monsters[type];
      const angle = Math.PI * 2 * i / count + rand(-0.22, 0.22);
      const distance = rand(430, 620);
      const x = clamp(this.player.x + Math.cos(angle) * distance, 80, CONFIG.expedition.mapSize - 80);
      const y = clamp(this.player.y + Math.sin(angle) * distance, 80, CONFIG.expedition.mapSize - 80);
      const hpScale = this.balance.enemyHp * (0.72 + Math.min(0.18, this.beastWave.wave * 0.035));
      this.monsters.push({
        type, ...data, x, y,
        hp: Math.round(data.hp * hpScale), maxHp: Math.round(data.hp * hpScale),
        damage: Math.max(3, Math.round(data.damage * this.balance.enemyDamage * (0.68 + Math.min(0.16, this.beastWave.wave * 0.03)))),
        speed: data.speed * this.balance.enemySpeed * 0.88,
        attackCd: 0, stunned: 0, target: null, vx: 0, vy: 0,
        facing: angle + Math.PI, animTime: rand(0, 10), hitFlash: 0,
        elite: false, abilityCd: rand(1, 4), packOffset: rand(-1, 1), beastWave: true, waveNo: this.beastWave.wave, state: 'idle', stateTimer: 0
      });
    }
    this.beastWave.remaining = count;
    this.beastWave.nextIn = this.beastWave.interval; // v4.1 下一波倒计时从本波刷出即开始（不清完也照刷）
    this.screenShake = 1;
    showToast(`第 ${this.beastWave.wave} 波兽潮来袭！立即进入已占领防御塔射程`, 'warning');
  }

  startMapEvent() {
    const event = { ...this.mapEvents[randInt(0, this.mapEvents.length - 1)] };
    event.timeLeft = event.duration;
    this.activeEvent = event;
    this.eventModifiers = { enemySpeed:1, enemyDamage:1, loot:1, vision:1 };
    if (event.id === 'blood_moon') this.eventModifiers = { enemySpeed:1.18, enemyDamage:1.22, loot:2, vision:1 };
    if (event.id === 'mist') this.eventModifiers = { enemySpeed:.78, enemyDamage:1, loot:1, vision:.62 };
    if (event.id === 'meteor') {
      for (let i=0;i<4;i++) this.spawnGroundLoot({type:'material',name:'天外晶屑',amount:1,icon:'◆'}, rand(350,2050), rand(350,2050));
    }
    showToast(`地图事件：${event.name} - ${event.text}`, 'warning');
  }

  updateMission() {
    if (!this.objective || this.objective.complete) return;
    if (this.objective.type === 'hunt') this.objective.progress = this.killCount;
    if (this.objective.type === 'scavenge') this.objective.progress = this.chestOpened;
    if (this.objective.type === 'tower') this.objective.progress = this.towers.filter(t => t.state === 'player').length;
    if (this.objective.progress >= this.objective.target) {
      this.objective.complete = true;
      GameState.gold += 35 * this.map.tier;
      this.consumables.herb_kit = (this.consumables.herb_kit || 0) + 1;
      showToast(`任务完成：${this.objective.title}，获得金币与补给`, 'success');
      this.spawnBoss();
    }
  }

  setupInput() {
    // Losing focus should never leave movement/attack held or let the expedition
    // continue running in the background. This also makes alt-tab/mobile focus
    // changes safe and predictable.
    this.blurHandler = () => {
      Object.keys(this.keys).forEach(k => { this.keys[k] = false; });
      this.mouse.down = false;
      if (!this.gameOver) this.paused = true;
    };
    this.keydownHandler = (e) => {
      this.keys[e.key.toLowerCase()] = true;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.paused = !this.paused;
        if (this.paused) this.showPauseMenu(); else this.hidePauseMenu();
      }
      const _branchActive = (typeof CombatEnhancement !== 'undefined' && CombatEnhancement.branchActive);
      if (!_branchActive) {
        if (e.key === '1') this.useSkill(0);
        if (e.key === '2') this.useSkill(1);
        if (e.key === '3') this.useSkill(2);
        if (e.key === '4') this.useSkill(3);
      }
      if (e.key >= '5' && e.key <= '9') this.selectPlantByKey(Number(e.key) - 5);
      if (e.key.toLowerCase() === 'z') this.cyclePlantSelection(1);
      if (e.key === 'Tab') { e.preventDefault(); this.toggleInventory(); }
      if (e.key === 'F1') { e.preventDefault(); this.selectedSeed = 0; this.showSeedBar(); }
      if (e.key === 'F2') { e.preventDefault(); this.selectedSeed = 1; this.showSeedBar(); }
      if (e.key === 'F3') { e.preventDefault(); this.selectedSeed = 2; this.showSeedBar(); }
      if (e.key === 'F4') { e.preventDefault(); this.selectedSeed = 3; this.showSeedBar(); }
      if (e.key === 'F5') { e.preventDefault(); this.selectedSeed = 4; this.showSeedBar(); }
      if (e.key.toLowerCase() === 'e' && !e.shiftKey) {
        const picked = this.tryPickWildPlant();
        if (!picked) this.useConsumable('signal_flare');
      }
      if (e.key.toLowerCase() === 'v') { e.preventDefault(); this.cycleWeapon(1); }
      if (e.key === 'q' && e.shiftKey) { e.preventDefault(); this.cycleWeapon(-1); }
      if (e.key.toLowerCase() === 'q' && !e.shiftKey) this.useConsumable('herb_kit');
      if (e.key.toLowerCase() === 'r') this.useConsumable('thorn_storm');
      if (e.key === ' ' || e.key === 'Shift') { e.preventDefault(); if (typeof CombatEnhancement !== 'undefined') CombatEnhancement.tryDodge(); }
      if (e.key.toLowerCase() === 'f') { if (typeof CombatEnhancement !== 'undefined') CombatEnhancement.tryUltimate(); }
      if (e.key.toLowerCase() === 'g') { if (typeof CombatEnhancement !== 'undefined') { const ex = this.monsters.find(m => CombatEnhancement.canExecute(m)); if (ex) CombatEnhancement.tryExecute(ex); } }
      if (typeof CombatEnhancement !== 'undefined' && CombatEnhancement.branchActive) { if (e.key === '1') CombatEnhancement.chooseBranch(0); if (e.key === '2') CombatEnhancement.chooseBranch(1); if (e.key === '3') CombatEnhancement.chooseBranch(2); }
    };
    this.keyupHandler = (e) => { this.keys[e.key.toLowerCase()] = false; };
    this.mousemoveHandler = (e) => {
      const rect = canvas.getBoundingClientRect();
      this.mouse.x = (e.clientX - rect.left) * (canvas.width / rect.width);
      this.mouse.y = (e.clientY - rect.top) * (canvas.height / rect.height);
    };
    this.mousedownHandler = (e) => {
      if (e.button === 2 && this.selectedSeed >= 0) {
        const wx = this.mouse.x + this.camera.x, wy = this.mouse.y + this.camera.y;
        this.tryPlacePlant(wx, wy);
        return;
      }
      if (e.button === 0) {
        this.mouse.down = true;
        if (typeof CombatEnhancement !== 'undefined' && CombatEnhancement.branchActive) {
          const mx = this.mouse.x, my = this.mouse.y;
          const W = canvas.width, H = canvas.height;
          for (let i = 0; i < 3; i++) {
            const bx = W/2 - 200 + i * 200, by = H/2 - 40;
            if (mx >= bx - 80 && mx <= bx + 80 && my >= by && my <= by + 120) { CombatEnhancement.chooseBranch(i); return; }
          }
          return;
        }
        if (!this.tryDeployPlant()) this.tryInteract();
      }
    };
    this.mouseupHandler = (e) => { if (e.button === 0) this.mouse.down = false; };
    this.contextmenuHandler = (e) => e.preventDefault();
    this.wheelHandler = (e) => { if (e.deltaY !== 0) { e.preventDefault(); this.cycleWeapon(e.deltaY > 0 ? 1 : -1); } };

    window.addEventListener('keydown', this.keydownHandler);
    window.addEventListener('keyup', this.keyupHandler);
    window.addEventListener('blur', this.blurHandler);
    canvas.addEventListener('mousemove', this.mousemoveHandler);
    canvas.addEventListener('mousedown', this.mousedownHandler);
    canvas.addEventListener('mouseup', this.mouseupHandler);
    canvas.addEventListener('contextmenu', this.contextmenuHandler);
    canvas.addEventListener('wheel', this.wheelHandler, { passive: false });
  }

  cleanup() {
    window.removeEventListener('keydown', this.keydownHandler);
    window.removeEventListener('keyup', this.keyupHandler);
    window.removeEventListener('blur', this.blurHandler);
    canvas.removeEventListener('mousemove', this.mousemoveHandler);
    canvas.removeEventListener('mousedown', this.mousedownHandler);
    canvas.removeEventListener('mouseup', this.mouseupHandler);
    canvas.removeEventListener('contextmenu', this.contextmenuHandler);
    canvas.removeEventListener('wheel', this.wheelHandler);
  }

  toggleInventory() {
    const existing = document.getElementById('inventoryOverlay');
    if (existing) { existing.remove(); return; }
    const inv = this.bag || [];
    const safe = this.safeBox || [];
    const safeCap = (typeof LoadoutSystem !== 'undefined') ? LoadoutSystem.getSafeCapacity() : 1;
    const usedSlots = inv.reduce((s, i) => s + (i.slots || 1), 0);
    const totalSlots = (typeof LoadoutSystem !== 'undefined') ? LoadoutSystem.BAG_SIZE : 16;
    let html = `<div style="width:520px;max-height:85vh;overflow-y:auto;background:#1a1f1a;border:1px solid #6a4a2a;border-radius:12px;padding:16px;color:#ddd;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="color:#ffd700;margin:0;">背包</h3>
        <span style="color:#888;font-size:12px;">背包 ${usedSlots}/${totalSlots} 格 · 安全箱 ${safe.length}/${safeCap} 格</span>
      </div>`;
    if (inv.length === 0) html += '<div style="color:#666;text-align:center;padding:16px;">背包空空如也，打怪捡东西吧</div>';
    const invIcon = (it) => (typeof CropArt !== 'undefined') ? CropArt.domFor(it, 22) : (it.icon || '📦');
    inv.forEach((item, i) => {
      const slots = item.slots || 1;
      const canUse = item.type === 'consumable';
      const canStore = safe.length < safeCap;
      html += `<div style="padding:8px;margin:4px 0;background:rgba(0,0,0,0.3);border-radius:6px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;">
        <span style="display:inline-flex;align-items:center;gap:6px;">${invIcon(item)} <b>${item.name}</b> ${item.amount>1?'×'+item.amount:''} <span style="color:#888;font-size:10px;">占${slots}格</span></span>
        <span style="display:flex;gap:4px;flex-wrap:wrap;">
          ${canUse ? `<button class="secondary-btn" style="font-size:11px;" onclick="Game.expedition.useInventoryItem(${i})">使用</button>` : ''}
          ${canStore ? `<button class="secondary-btn" style="font-size:11px;color:#ffd700;" onclick="Game.expedition.storeInSafe(${i})">🔒存安全箱</button>` : ''}
          <button class="secondary-btn" style="font-size:11px;color:#ff8888;" onclick="Game.expedition.dropInventoryItem(${i})">丢弃</button>
        </span>
      </div>`;
    });
    if (safe.length > 0) {
      html += `<div style="margin-top:14px;color:#ffd700;font-size:13px;border-top:1px solid #444;padding-top:8px;">🔒 安全箱（死亡保留，不占背包）</div>`;
      safe.forEach((item, i) => {
        html += `<div style="padding:6px;margin:4px 0;background:rgba(255,215,0,0.08);border-radius:6px;display:flex;justify-content:space-between;align-items:center;">
          <span style="display:inline-flex;align-items:center;gap:6px;">${invIcon(item)} ${item.name} ${item.amount>1?'×'+item.amount:''}</span>
          <button class="secondary-btn" style="font-size:11px;" onclick="Game.expedition.retrieveFromSafe(${i})">取回</button>
        </div>`;
      });
    }
    html += '<div style="margin-top:12px;text-align:center;font-size:11px;color:#666;">按 Tab 关闭 · 存入安全箱的物品死亡时保留，且不占背包格位</div></div>';
    const overlay = document.createElement('div');
    overlay.id = 'inventoryOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = html;
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
  }

  // 存入安全箱（从背包移到安全箱，不占背包格）
  storeInSafe(bagIdx) {
    const item = this.bag[bagIdx];
    if (!item) return;
    const safeCap = (typeof LoadoutSystem !== 'undefined') ? LoadoutSystem.getSafeCapacity() : 1;
    if (this.safeBox.length >= safeCap) {
      showToast('安全箱已满！', 'warning');
      return;
    }
    this.bag.splice(bagIdx, 1);
    this.safeBox.push(item);
    showToast(`🔒 ${item.name} 已存入安全箱`, 'gold');
    this.toggleInventory(); // 刷新面板
    this.updateHUD();
  }

  // 从安全箱取回背包
  retrieveFromSafe(safeIdx) {
    const item = this.safeBox[safeIdx];
    if (!item) return;
    // 检查背包是否有空间
    if (typeof LoadoutSystem !== 'undefined' && !LoadoutSystem.canAdd(this.bag, item)) {
      showToast('背包空间不足！', 'warning');
      return;
    }
    this.safeBox.splice(safeIdx, 1);
    this.bag.push(item);
    showToast(`📦 ${item.name} 已取回背包`, 'success');
    this.toggleInventory();
    this.updateHUD();
  }

  useInventoryItem(idx) {
    const item = (this.bag || [])[idx];
    if (!item) return;
    if (item.type === 'consumable' && item.id) {
      // 直接从背包物品使用，不依赖 this.consumables 计数
      const def = (CONFIG.consumables||[]).find(c => c.id === item.id);
      if (item.id === 'herb_kit') {
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + (def?.heal || 30));
        this.spawnAoeEffect(this.player.x, this.player.y, 60, '#ff66aa');
        showToast(`使用${item.name}，回复${def?.heal||30}生命`, 'success');
      } else if (item.id === 'thorn_storm') {
        const range = def?.range || 200, dmg = def?.damage || 40;
        [...this.monsters, ...(this.raiders||[])].forEach(m => {
          if (dist(m, this.player) < range) {
            this.damageEnemy(m, dmg, '#ff9a55', true, { x: m.x, y: m.y, angle: Math.atan2(m.y-this.player.y, m.x-this.player.x), fromPlayer: true });
            this.applyBurn(m, 22, 3);
          }
        });
        this.spawnAoeEffect(this.player.x, this.player.y, range, '#aa5500');
        showToast(`释放${item.name}！`, 'success');
      } else if (item.id === 'signal_flare') {
        // 直接触发信号弹撤离，不查 consumables 计数（背包里的就是信号弹本身）
        this.startExtract('signal');
        const flash = document.getElementById('signalFlash');
        if (flash) {
          flash.classList.remove('active');
          void flash.offsetWidth;
          flash.classList.add('active');
        }
        showToast('释放撤离信号弹！全地图敌人正在逼近！', 'warning');
      } else {
        // 其他消耗品走通用逻辑（草药/荆棘风暴已在上面处理，这里兜底）
        if (def) {
          if (def.heal) { this.player.hp = Math.min(this.player.maxHp, this.player.hp + def.heal); }
          showToast(`使用${item.name}`, 'success');
        }
      }
      this.bag.splice(idx, 1);
    } else if (item.type === 'gold') {
      GameState.gold += item.amount;
      showToast(`💰 +${item.amount} 金币`, 'gold');
      this.bag.splice(idx, 1);
    } else if (item.type === 'material') {
      if (!GameState.warehouse.materials) GameState.warehouse.materials = {};
      const mid = item.matId || 'misc';
      GameState.warehouse.materials[mid] = (GameState.warehouse.materials[mid]||0) + item.amount;
      showToast(`📦 收材料：${item.name} ×${item.amount}`, 'success');
      this.bag.splice(idx, 1);
    }
    this.toggleInventory();
  }

  dropInventoryItem(idx) {
    const item = (this.bag || [])[idx];
    if (!item) return;
    // 扔到脚下
    this.groundLoot.push({ ...item, x: this.player.x + rand(-20,20), y: this.player.y + rand(-20,20), bob: 0 });
    this.bag.splice(idx, 1);
    showToast(`🗑️ 丢弃了 ${item.name}`, 'warning');
    this.toggleInventory();
  }

  showSeedBar() {
    // 简单提示当前选中
    if (!this.seedBar || this.seedBar.length === 0) { showToast('没有携带种子', 'warning'); return; }
    if (this.selectedSeed < 0 || this.selectedSeed >= this.seedBar.length) return;
    const s = this.seedBar[this.selectedSeed];
    const def = CONFIG.deployPlants[s.type];
    if (def) showToast(`已选种子：${def.icon}${def.name}（${s.count}个），点地面种植`, 'success');
  }

  tryPlacePlant(gx, gy) {
    if (this.selectedSeed < 0 || !this.seedBar) return;
    const slot = this.seedBar[this.selectedSeed];
    if (!slot || slot.count <= 0) return;
    const def = CONFIG.deployPlants[slot.type];
    if (!def) return;
    // 不能种在出生点/撤离点/障碍物上
    for (const o of this.obstacles) {
      const dx = gx - o.x, dy = gy - o.y;
      if (Math.hypot(dx, dy) < (o.radius || 20) + 15) { showToast('这里不能种', 'warning'); return; }
    }
    const plant = {
      type: slot.type, ...def,
      x: gx, y: gy,
      hp: def.hp, maxHp: def.hp,
      age: 0,
      growTimer: 2, // 2秒长成
      cd: 0,
      exploded: false
    };
    this.plants.push(plant);
    slot.count--;
    if (slot.count <= 0) {
      this.seedBar.splice(this.selectedSeed, 1);
      this.selectedSeed = -1;
    }
    this.updateHUD();
  }

  updatePlants(dt) {
    if (!this.plants) return;
    for (let i = this.plants.length - 1; i >= 0; i--) {
      const p = this.plants[i];
      p.age += dt;
      if (p.growTimer > 0) { p.growTimer -= dt; continue; }
      p.cd -= dt;
      // 各种效果
      switch (p.effect) {
        case 'fire': {
          // 每秒烧经过的怪
          for (const m of this.monsters) {
            if (m.hp <= 0) continue;
            const d = Math.hypot(m.x - p.x, m.y - p.y);
            if (d < p.range) this.damageEnemy(m, 8 * dt * 10, '#ff6633', false, { noKnockback: true });
          }
          break;
        }
        case 'slow': {
          for (const m of this.monsters) {
            if (m.hp <= 0) continue;
            const d = Math.hypot(m.x - p.x, m.y - p.y);
            if (d < p.range) m.slowTimer = 0.5;
          }
          break;
        }
        case 'taunt': {
          for (const m of this.monsters) {
            if (m.hp <= 0) continue;
            const d = Math.hypot(m.x - p.x, m.y - p.y);
            if (d < p.range) m.target = p;
          }
          break;
        }
        case 'heal': {
          const d = Math.hypot(this.player.x - p.x, this.player.y - p.y);
          if (d < p.range && this.player.hp > 0) this.player.hp = Math.min(this.player.maxHp, this.player.hp + 2 * dt * 10);
          break;
        }
        case 'repel': {
          for (const m of this.monsters) {
            if (m.hp <= 0) continue;
            const d = Math.hypot(m.x - p.x, m.y - p.y);
            if (d < p.range) {
              // 怪远离
              const ang = Math.atan2(m.y - p.y, m.x - p.x);
              m.x += Math.cos(ang) * 30 * dt;
              m.y += Math.sin(ang) * 30 * dt;
            }
          }
          break;
        }
        case 'thorns': {
          // 怪碰到自动受伤（在怪物更新里处理）
          break;
        }
        case 'watermelon':
        case 'boom': {
          if (!p.exploded && p.age > 3) {
            p.exploded = true;
            for (const m of this.monsters) {
              if (m.hp <= 0) continue;
              const d = Math.hypot(m.x - p.x, m.y - p.y);
              if (d < p.range) this.damageEnemy(m, 30, '#ffaa00', false);
            }
            this.plants.splice(i, 1);
          }
          break;
        }
        case 'firebreath': {
          if (p.cd <= 0) {
            // 直线喷火：找玩家朝向方向
            const ang = Math.atan2(this.player.y - p.y, this.player.x - p.x);
            for (const m of this.monsters) {
              if (m.hp <= 0) continue;
              const mx = m.x - p.x, my = m.y - p.y;
              const proj = mx * Math.cos(ang) + my * Math.sin(ang);
              if (proj > 0 && proj < p.range) {
                const perp = Math.abs(-mx * Math.sin(ang) + my * Math.cos(ang));
                if (perp < 40) this.damageEnemy(m, 15, '#ff4400', false);
              }
            }
            p.cd = 0.5;
          }
          break;
        }
        case 'freeze': {
          if (p.cd <= 0) {
            for (const m of this.monsters) {
              if (m.hp <= 0) continue;
              const d = Math.hypot(m.x - p.x, m.y - p.y);
              if (d < p.range) m.freezeTimer = 1.5;
            }
            p.cd = 5;
          }
          break;
        }
        case 'tesla': {
          if (p.cd <= 0) {
            const near = this.monsters.filter(m => m.hp > 0).sort((a,b) =>
              Math.hypot(a.x-p.x,a.y-p.y) - Math.hypot(b.x-p.x,b.y-p.y)).slice(0,3);
            for (const m of near) this.damageEnemy(m, 10, '#ffff66', false);
            p.cd = 0.8;
          }
          break;
        }
        case 'stealth': {
          const d = Math.hypot(this.player.x - p.x, this.player.y - p.y);
          if (d < p.range) this.player.stealth = Math.max(this.player.stealth || 0, 3);
          break;
        }
        case 'buff': {
          const d = Math.hypot(this.player.x - p.x, this.player.y - p.y);
          if (d < p.range) this.player.atkBuff = 0.2;
          break;
        }
        case 'deathboom': {
          for (const m of this.monsters) {
            if (m.hp <= 0) continue;
            const d = Math.hypot(m.x - p.x, m.y - p.y);
            if (d < p.range) {
              for (const mm of this.monsters) {
                if (mm.hp <= 0) continue;
                const dd = Math.hypot(mm.x - p.x, mm.y - p.y);
                if (dd < p.range + 30) this.damageEnemy(mm, 50, '#aa44ff', false);
              }
              this.plants.splice(i, 1);
              break;
            }
          }
          break;
        }
      }
      // 植物血量
      if (p.hp <= 0) this.plants.splice(i, 1);
    }
  }

  renderPlants(ctx, cam) {
    if (!this.plants) return;
    for (const p of this.plants) {
      const sx = p.x - cam.x, sy = p.y - cam.y;
      // 成长进度
      const scale = p.growTimer > 0 ? 0.5 + (1 - p.growTimer/2) * 0.5 : 1;
      ctx.globalAlpha = p.growTimer > 0 ? 0.7 : 1;
      ctx.font = (28 * scale) + 'px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.icon, sx, sy);
      ctx.globalAlpha = 1;
      // 血条
      if (p.maxHp > 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(sx - 16, sy - 22, 32, 4);
        ctx.fillStyle = '#4f4';
        ctx.fillRect(sx - 16, sy - 22, 32 * (p.hp / p.maxHp), 4);
      }
    }
    // 选中种子预览
    if (this.selectedSeed >= 0 && this.mouse.x) {
      const def = CONFIG.deployPlants[this.seedBar[this.selectedSeed].type];
      if (def) {
        ctx.globalAlpha = 0.5;
        ctx.font = '28px serif';
        ctx.textAlign = 'center';
        ctx.fillText(def.icon, this.mouse.x - cam.x, this.mouse.y - cam.y);
        ctx.globalAlpha = 1;
      }
    }
  }

  spawnWildPlants() {
    if (!CONFIG.wildPlants) return;
    const size = CONFIG.expedition.mapSize;
    const tier = this.map.tier;
    const pool = CONFIG.wildPlants.filter(w => w.tier <= tier);
    for (let i = 0; i < 5; i++) {
      const w = pool[Math.floor(Math.random() * pool.length)];
      const x = rand(200, size - 200), y = rand(200, size - 200);
      this.wildPlants.push({ ...w, x, y, picked: false });
    }
  }

  tryPickWildPlant() {
    for (const w of this.wildPlants) {
      if (w.picked) continue;
      const d = Math.hypot(w.x - this.player.x, w.y - this.player.y);
      if (d < 40) {
        w.picked = true;
        if (!GameState.warehouse.crops) GameState.warehouse.crops = {};
        GameState.warehouse.crops[w.givesSeed] = (GameState.warehouse.crops[w.givesSeed] || 0) + 1;
        showToast(`🌿 采摘到种子：${w.name}！`, 'success');
        return true;
      }
    }
    return false;
  }

  showPauseMenu() {
    if (document.getElementById('pauseMenu')) return;
    const overlay = document.createElement('div');
    overlay.id = 'pauseMenu';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:10000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `<div style="width:320px;background:#1a1f1a;border:1px solid #6a4a2a;border-radius:12px;padding:24px;text-align:center;">
      <h2 style="color:#ffd700;margin:0 0 20px;">⏸ 游戏暂停</h2>
      <button class="secondary-btn" style="width:100%;padding:10px;margin:6px 0;" onclick="Game.expedition.hidePauseMenu();Game.expedition.paused=false;">▶ 继续游戏</button>
      <button class="secondary-btn" style="width:100%;padding:10px;margin:6px 0;" onclick="Game.expedition.toggleSettings()">⚙ 设置</button>
      <div id="pauseSettings" style="display:none;text-align:left;margin:10px 0;padding:10px;background:rgba(0,0,0,0.3);border-radius:8px;">
        <div style="font-size:12px;color:#aaa;margin-bottom:6px;">音量：<span id="volVal">${Math.round((GameState.volume||0.8)*100)}%</span></div>
        <input type="range" min="0" max="100" value="${Math.round((GameState.volume||0.8)*100)}" style="width:100%;" oninput="GameState.volume=this.value/100;document.getElementById('volVal').textContent=this.value+'%';if(typeof AudioManager!=='undefined')AudioManager.setVolume(GameState.volume);">
      </div>
      <button class="secondary-btn" style="width:100%;padding:10px;margin:6px 0;color:#f66;" onclick="Game.expedition.quitToFarm()">🏠 返回主菜单（当前远征进度丢失）</button>
      <div style="font-size:11px;color:#666;margin-top:12px;">ESC 关闭此菜单</div>
    </div>`;
    document.body.appendChild(overlay);
  }

  toggleSettings() {
    const el = document.getElementById('pauseSettings');
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
  }

  hidePauseMenu() {
    const el = document.getElementById('pauseMenu');
    if (el) el.remove();
  }

  quitToFarm() {
    this.hidePauseMenu();
    // 等同死亡：损失带入武器
    if (typeof LoadoutSystem !== 'undefined') LoadoutSystem.loseBroughtWeapon();
    if (typeof SaveSystem !== 'undefined') SaveSystem.save();
    this.cleanup && this.cleanup();
    Game.returnToFarm();
  }

  cycleWeapon(direction = 1) {
    // v1.4 只在带入武器间切换
    if (!this.broughtStats || this.broughtStats.length <= 1) return;
    this.currentBroughtIdx = (this.currentBroughtIdx + direction + this.broughtStats.length) % this.broughtStats.length;
    const b = this.broughtStats[this.currentBroughtIdx];
    this.loadoutUid = b.uid;
    this.weaponIndex = Math.max(0, CONFIG.weapons.findIndex(w => w.id === b.weaponId));
    this.weapon = b.stats;
    GameState.selectedWeapon = b.weaponId;
    this.weaponPulse = 0.35;
    this.spawnWeaponSwitchEffect();
    showToast(`切换武器：${this.weapon.name}`, 'success');
    this.updateHUD();
    SaveSystem.save();
  }

  useSkill(idx) {
    if (this.skillCooldowns[idx] > 0) return;
    const skill = getSkillStats(CONFIG.skills[idx], this.skillBoosts[CONFIG.skills[idx].id] || 0);
    if (this.player.energy < skill.energyCost) {
      showToast('能量不足', 'warning');
      return;
    }
    this.player.energy -= skill.energyCost;
    this.skillCooldowns[idx] = skill.cooldown;
    this.skillFlashes[idx] = 0.28;
    AudioManager.playSkill(skill.id);

    const px = this.player.x, py = this.player.y;
    // 鼠标方向
    const worldMouseX = this.mouse.x + this.camera.x;
    const worldMouseY = this.mouse.y + this.camera.y;
    const angle = Math.atan2(worldMouseY - py, worldMouseX - px);

    if (skill.id === 'straw_smash') {
      [...this.monsters, ...this.raiders].forEach(m => {
        if (dist(m, this.player) < skill.range) {
          this.damageEnemy(m, skill.damage, '#f2c45b', true, {
            x: m.x, y: m.y, angle: Math.atan2(m.y - this.player.y, m.x - this.player.x),
            weaponId: '', fromPlayer: true
          });
          m.stunned = 0.5;
        }
      });
      this.spawnAoeEffect(px, py, skill.range, '#f2c45b', 'ring');
      this.spawnRadialBurst(px, py, '#fff0a6', 12);
      this.spawnShockRing(px, py, '#ffe9a0', skill.range * 0.8);
    } else if (skill.id === 'vine_bind') {
      [...this.monsters, ...this.raiders].forEach(m => {
        if (dist(m, this.player) < skill.range) {
          m.stunned = skill.stunDuration;
          this.spawnHitParticles(m.x, m.y, '#55aa55');
        }
      });
      this.spawnVineEffect(px, py, skill.range);
    } else if (skill.id === 'earth_dash') {
      this.player.x += Math.cos(angle) * skill.dashDistance;
      this.player.y += Math.sin(angle) * skill.dashDistance;
      this.player.invuln = skill.invulnDuration;
      this.player.visualVz = 125;
      this.spawnDashParticles(px, py, angle);
      this.spawnDashTrail(px, py, angle, '#a6e7ff');
    } else if (skill.id === 'smoke_screen') {
      this.player.stealth = skill.stealthDuration;
      this.spawnSmokeEffect(px, py);
      showToast('进入隐身状态', 'success');
    }
  }

  useConsumable(id) {
    if ((this.consumables[id] || 0) <= 0) {
      showToast('没有该消耗品', 'warning');
      return;
    }
    const item = CONFIG.consumables.find(c => c.id === id);
    this.consumableFlashes[id] = 0.3;
    AudioManager.playConsumable(id);
    if (id === 'herb_kit') {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + item.heal);
      this.consumables[id]--;
      showToast(`使用${item.name}，回复${item.heal}生命`, 'success');
      this.spawnAoeEffect(this.player.x, this.player.y, 60, '#ff66aa');
    } else if (id === 'thorn_storm') {
      [...this.monsters, ...this.raiders].forEach(m => {
        if (dist(m, this.player) < item.range) {
          this.damageEnemy(m, item.damage, '#ff9a55', true, {
            x: m.x, y: m.y, angle: Math.atan2(m.y - this.player.y, m.x - this.player.x),
            weaponId: '', fromPlayer: true
          });
          this.applyBurn(m, 22, 3);
        }
      });
      this.consumables[id]--;
      this.spawnAoeEffect(this.player.x, this.player.y, item.range, '#aa5500');
      showToast(`释放${item.name}！`, 'success');
    } else if (id === 'signal_flare') {
      this.consumables[id]--;
      this.startExtract('signal');
      const flash = document.getElementById('signalFlash');
      flash.classList.remove('active');
      void flash.offsetWidth;
      flash.classList.add('active');
      showToast('释放撤离信号弹！全地图敌人正在逼近！', 'warning');
    }
    this.updateHUD();
  }

  // v4.2 估算单件战利品价值（MVP 最值钱战利品）
  getLootValue(item) {
    if (!item) return 0;
    const amt = item.amount || 1;
    if (item.type === 'gold') return amt;
    const wi = (CONFIG.warehouseItems || {})[item.id];
    if (wi && wi.sellPrice) return wi.sellPrice * amt;
    if (item.type === 'consumable') {
      const cd = (CONFIG.consumables || []).find(c => c.id === item.id);
      return (cd && cd.value ? cd.value : 40) * amt;
    }
    if (item.type === 'material') {
      const mid = item.matId || item.id;
      const m = (CONFIG.warehouseItems || {})[mid];
      return (m && m.sellPrice ? m.sellPrice : 10) * amt;
    }
    if (item.type === 'seed_item' || item.type === 'seed_pickup') {
      const crop = (CONFIG.crops || []).find(c => c.id === item.seedId);
      return ((crop && (crop.sellPrice || crop.price)) || 30) * amt;
    }
    if (item.type === 'farm_item') return (wi && wi.sellPrice) || 50;
    return 0;
  }

  spawnGroundLoot(item, x, y) {
    this.groundLoot.push({
      ...item,
      x: x + rand(-28, 28),
      y: y + rand(-28, 28),
      bob: rand(0, Math.PI * 2),
    });
  }

  pickupLoot() {
    if (this.groundLoot.length === 0) return false;
    const pickupRange = CONFIG.weapons.find(weapon => weapon.mode === 'melee')?.range || CONFIG.player.attackRange;
    const candidates = this.groundLoot
      .map((item, index) => ({ item, index, playerDist: dist(this.player, item) }))
      .filter(entry => entry.playerDist <= pickupRange && this.isWorldVisible(entry.item.x, entry.item.y))
      .sort((a, b) => a.playerDist - b.playerDist);
    if (candidates.length === 0) return false;
    const target = candidates[0];
    this.groundLoot.splice(target.index, 1);
    const { x, y, bob, ...item } = target.item;
    if (item.type === 'invincible') {
      this.player.invuln = Math.max(this.player.invuln, item.duration || 5);
      this.player.slow = 0;
      this.spawnAoeEffect(x, y, 70, '#7de7ff');
      this.spawnRadialBurst(x, y, '#e6fbff', 22);
      showToast('无敌核心生效：5 秒内免疫一切伤害和控制！', 'success');
    } else if (item.type === 'plant_seed') {
      const plant = CONFIG.plants.find(p => p.id === item.plantId);
      if (plant) {
        if (!this.plantSeeds[plant.id]) this.plantSeeds[plant.id] = { maxPerRun: plant.maxPerRun, deployed: 0 };
        const rec = GameState.defensePlants[plant.id] || { progress: 0, count: 0 };
        rec.count = (rec.count || 0) + 1;
        GameState.defensePlants[plant.id] = rec;
        this.spawnAoeEffect(x, y, 34, '#7dff9a');
        showToast(`拾取防线种子：${plant.name}（本局可部署，培育中）`, 'gold');
      }
    } else if (item.type === 'plant_remains') {
      const record = this.plantRecords.find(r => r.seedId === item.seedId && r.destroyed && !r.recovered);
      if (record) record.recovered = true;
      this.spawnAoeEffect(x, y, 30, '#a5e675');
      showToast('回收植物残骸，培育损失减半', 'gold');
    } else if (item.type === 'seed_pickup') {
      // v3.2 种子进背包，撤离才入库
      const seedItem = { type: 'seed_item', id: 'seed_'+item.seedId, seedId: item.seedId, name: item.name, icon: item.icon, amount: 1, slots: 1 };
      const existing = this.bag.find(b => b.id === seedItem.id);
      if (existing) existing.amount += 1;
      else this.bag.push(seedItem);
      this.spawnAoeEffect(x, y, 40, '#ffd968');
      showToast(`拾取种子：${item.name}（需撤离保留）`, 'gold');
    } else if (item.type === 'weapon_drop') {
      // v1.0 临时武器拾取（自动切换）
      this.tempWeapons = this.tempWeapons || [];
      this.tempWeapons.push(item.weapon);
      this.spawnAoeEffect(x, y, 50, '#ffd700');
      showToast(`🔨 获得临时武器：${item.weapon.name}！按Q滚轮切换`, 'gold');
    } else {
      // v2.9 同类物品无限叠加（金币/材料等堆叠进已有格）
      // v3.7 金币无论从哪捡都合并到同一堆
      let existing;
      if (item.type === 'gold') {
        existing = this.bag.find(b => b.type === 'gold');
      } else {
        existing = this.bag.find(b => b.id === item.id && b.type === item.type);
      }
      if (existing) {
        existing.amount = (existing.amount || 1) + (item.amount || 1);
        if (item.type === 'gold') existing.name = '金币';
      } else if (typeof LoadoutSystem !== 'undefined' && !LoadoutSystem.canAdd(this.bag, item)) {
        showToast('背包已满！', 'warning');
        this.groundLoot.push({ ...item, x, y, bob: 0 });
        return false;
      } else {
        this.bag.push(item);
      }
      if (this.runStats) {
        const v = this.getLootValue(item);
        if (v > (this.runStats.topLoot ? this.runStats.topLoot.value : 0)) {
          this.runStats.topLoot = { name: item.name, icon: item.icon || '', artId: (typeof CropArt !== 'undefined' && CropArt.resolveArtId) ? CropArt.resolveArtId(item) : null, value: Math.round(v) };
        }
      }
      this.spawnAoeEffect(x, y, 34, '#f6c75b');
      showToast(`拾取 ${item.icon} ${item.name} ×${item.amount}`, 'gold');
    }
    this.updateHUD();
    return true;
  }

  // ==================== 植物防线系统 ====================
  getPlantSeedList() {
    return Object.keys(this.plantSeeds).map(id => {
      const plant = CONFIG.plants.find(p => p.id === id);
      if (!plant) return null;
      const seed = this.plantSeeds[id];
      return { ...plant, deployed: seed.deployed, maxPerRun: seed.maxPerRun };
    }).filter(Boolean);
  }

  selectPlantByKey(idx) {
    const list = this.getPlantSeedList();
    if (idx >= list.length) { this.selectedPlantId = null; this.updateHUD(); return; }
    const id = list[idx].id;
    this.selectedPlantId = this.selectedPlantId === id ? null : id;
    showToast(this.selectedPlantId ? `已选择防线：${CONFIG.plants.find(p => p.id === id).name}，点击空地部署` : '已取消选择防线', this.selectedPlantId ? 'success' : '');
    this.updateHUD();
  }

  cyclePlantSelection(dir) {
    const list = this.getPlantSeedList();
    if (list.length === 0) { this.selectedPlantId = null; this.updateHUD(); return; }
    const currentIdx = list.findIndex(p => p.id === this.selectedPlantId);
    const next = (currentIdx + dir + list.length) % list.length;
    this.selectedPlantId = list[next].id;
    showToast(`已选择防线：${list[next].name}`, 'success');
    this.updateHUD();
  }

  isInWater(wx, wy, radius) {
    for (const patch of this.terrainPatches) {
      if (patch.type !== 'water') continue;
      const dx = wx - patch.x, dy = wy - patch.y;
      const cos = Math.cos(-(patch.rotation || 0)), sin = Math.sin(-(patch.rotation || 0));
      const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;
      const rx = patch.rx + radius, ry = patch.ry + radius;
      if (lx * lx / (rx * rx) + ly * ly / (ry * ry) < 1) return true;
    }
    return false;
  }

  canDeployHere(wx, wy, radius) {
    const size = CONFIG.expedition.mapSize;
    if (wx < radius || wx > size - radius || wy < radius || wy > size - radius) return false;
    if (this.collidesWithObstacle(wx, wy, radius)) return false;
    if (this.isInWater(wx, wy, radius)) return false;
    if (this.towers.some(t => dist({ x: wx, y: wy }, t) < t.radius + radius)) return false;
    if (this.plants.some(p => dist({ x: wx, y: wy }, p) < radius + 16)) return false;
    return true;
  }

  tryDeployPlant() {
    if (!this.selectedPlantId) return false;
    const seed = this.plantSeeds[this.selectedPlantId];
    const plant = CONFIG.plants.find(p => p.id === this.selectedPlantId);
    if (!seed || !plant) { this.selectedPlantId = null; this.updateHUD(); return false; }
    if (seed.deployed >= seed.maxPerRun) {
      showToast(`${plant.name}本局已达部署上限（${seed.maxPerRun}株）`, 'warning');
      return true;
    }
    const wx = this.mouse.x + this.camera.x;
    const wy = this.mouse.y + this.camera.y;
    if (dist(this.player, { x: wx, y: wy }) > 240) {
      showToast('部署距离过远（最远240）', 'warning');
      return true;
    }
    const cost = plant.deployCost;
    if (this.nutrient < cost) {
      showToast(`养分不足（需要${cost}，当前${Math.floor(this.nutrient)}）`, 'warning');
      return true;
    }
    if (!this.canDeployHere(wx, wy, 18)) {
      showToast('此处不能部署（障碍物/水域/塔/植物占位）', 'warning');
      return true;
    }
    this.deployPlant(plant, wx, wy);
    return true;
  }

  deployPlant(plant, wx, wy) {
    this.nutrient -= plant.deployCost;
    const seed = this.plantSeeds[plant.id];
    seed.deployed++;
    this.plants.push({
      id: plant.id, type: plant.type, name: plant.name, icon: plant.icon,
      x: wx, y: wy,
      hp: plant.hp, maxHp: plant.hp,
      life: plant.life, maxLife: plant.life,
      sustain: plant.sustain, deployCost: plant.deployCost,
      cooldown: plant.cooldown || 0.8, range: plant.range || 180,
      damage: plant.damage || 5, projectileSpeed: plant.projectileSpeed || 380,
      slowRadius: plant.slowRadius || 90, slowFactor: plant.slowFactor || 0.3,
      controlRadius: plant.controlRadius || 80, stunDuration: plant.stunDuration || 0.8,
      controlCooldown: plant.controlCooldown || 4, produceAmount: plant.produceAmount || 2,
      produceInterval: plant.produceInterval || 8,
      timer: 0, controlTimer: 0, produceTimer: 0, hitFlash: 0, attackAnim: 0, starving: false,
      seedId: plant.id,
    });
    this.plantsDirty = true;
    this.plantRecords.push({ seedId: plant.id, survived: false, recovered: false, destroyed: false });
    showToast(`部署${plant.name}，预扣养分${plant.deployCost}`, 'success');
    this.spawnAoeEffect(wx, wy, 34, '#7dff9a');
    this.spawnRadialBurst(wx, wy, '#b9ffd1', 12);
    this.updateHUD();
  }

  damagePlant(plant, amount) {
    if (!plant || plant.hp <= 0) return;
    plant.hp -= amount;
    plant.hitFlash = 0.15;
    this.damageNumbers.push({
      x: plant.x + rand(-8, 8), y: plant.y - 22,
      value: Math.round(amount), color: '#ff9a55', life: .5, maxLife: .5,
      vx: rand(-8, 8), vy: -40, heavy: false
    });
    if (plant.hp <= 0) this.destroyPlant(plant);
  }

  destroyPlant(plant) {
    plant.hp = 0;
    const record = this.plantRecords.find(r => r.seedId === plant.seedId && !r.destroyed);
    if (record) record.destroyed = true;
    this.plantDestroyCount[plant.seedId] = (this.plantDestroyCount[plant.seedId] || 0) + 1;
    const idx = this.plants.indexOf(plant);
    if (idx >= 0) this.plants.splice(idx, 1);
    this.plantsDirty = true;
    showToast(`${plant.name}被摧毁！培育进度损失，3秒内可回收残骸`, 'warning');
    this.spawnAoeEffect(plant.x, plant.y, 40, '#ff6644');
    this.spawnHitParticles(plant.x, plant.y, '#ff7744');
    this.spawnGroundLoot({
      type: 'plant_remains', name: '植物残骸', amount: 1, icon: '🌿',
      seedId: plant.seedId, expiresAt: performance.now() / 1000 + 3
    }, plant.x, plant.y);
    this.updateHUD();
  }

  updatePlants(dt) {
    const toRemove = [];
    for (const plant of this.plants) {
      // 养分维持
      if (plant.sustain > 0) {
        this.nutrient -= plant.sustain * dt;
        if (this.nutrient < 0) { this.nutrient = 0; plant.hp -= dt * 3; plant.starving = true; }
        else plant.starving = false;
      }
      // 寿命
      plant.life -= dt;
      if (plant.life <= 0) { toRemove.push(plant); continue; }
      // 输出
      if (plant.type === 'attack' || plant.type === 'ultimate') {
        plant.timer -= dt;
        if (plant.timer <= 0) {
          plant.timer = plant.cooldown;
          let nearest = null, minD = plant.range;
          this.monsters.forEach(m => { if (m.hp > 0) { const d = dist(plant, m); if (d < minD) { minD = d; nearest = m; } } });
          this.raiders.forEach(r => { const d = dist(plant, r); if (d < minD) { minD = d; nearest = r; } });
          if (nearest) {
            const p = this.allocProjectile();
            Object.assign(p, {
              x: plant.x, y: plant.y - 8,
              vx: (nearest.x - plant.x) / minD * plant.projectileSpeed,
              vy: (nearest.y - plant.y) / minD * plant.projectileSpeed,
              damage: plant.damage, life: plant.range / plant.projectileSpeed,
              fromPlant: true, radius: 6, color: plant.type === 'ultimate' ? '#d9ffb0' : '#7dff9a'
            });
            p.hit = p.hit || []; p.hit.length = 0;
            this.projectiles.push(p);
            plant.attackAnim = 0.2;
          }
        }
      }
      // 减速
      if (plant.type === 'slow' || plant.type === 'ultimate') {
        this.monsters.forEach(m => {
          if (m.hp > 0 && !m.slowImmune && dist(plant, m) < plant.slowRadius) {
            m.slow = Math.max(m.slow || 0, plant.slowFactor);
          }
        });
      }
      // 控制
      if (plant.type === 'control' || plant.type === 'ultimate') {
        plant.controlTimer -= dt;
        if (plant.controlTimer <= 0) {
          plant.controlTimer = plant.controlCooldown;
          this.monsters.forEach(m => {
            if (m.hp > 0 && dist(plant, m) < plant.controlRadius) {
              const stun = plant.stunDuration * (m.elite ? 0.5 : 1);
              m.stunned = Math.max(m.stunned || 0, stun);
            }
          });
          this.spawnVineEffect(plant.x, plant.y, plant.controlRadius);
        }
      }
      // 产资
      if (plant.type === 'produce' || plant.type === 'ultimate') {
        plant.produceTimer -= dt;
        if (plant.produceTimer <= 0) {
          plant.produceTimer = plant.produceInterval;
          this.nutrient = Math.min(this.nutrientMax, this.nutrient + plant.produceAmount);
          this.spawnAoeEffect(plant.x, plant.y, 26, '#ffe28a');
          this.damageNumbers.push({ x: plant.x + rand(-6, 6), y: plant.y - 30, value: `+${plant.produceAmount}`, color: '#ffe28a', life: .6, maxLife: .6, vx: 0, vy: -46, heavy: false });
        }
      }
      plant.hitFlash = Math.max(0, (plant.hitFlash || 0) - dt);
      plant.attackAnim = Math.max(0, (plant.attackAnim || 0) - dt);
    }
    for (const p of toRemove) {
      const idx = this.plants.indexOf(p);
      if (idx >= 0) this.plants.splice(idx, 1);
    }
    if (toRemove.length) this.plantsDirty = true;
  }

  // ============ 养分结晶 ============
  spawnNutrientCrystal(x, y, amount) {
    this.nutrientCrystals.push({ x, y, bob: rand(0, Math.PI * 2), amount, expiresAt: performance.now() / 1000 + 30 });
  }

  refreshNutrientCrystals(dt) {
    this.nutrientTimer -= dt;
    if (this.nutrientTimer <= 0) {
      this.nutrientTimer = CONFIG.nutrients.crystalInterval;
      const size = CONFIG.expedition.mapSize;
      const pos = this.findSafeSpawn(150, size - 150, 16);
      this.spawnNutrientCrystal(pos.x, pos.y, CONFIG.nutrients.crystalAmount);
    }
    const now = performance.now() / 1000;
    this.nutrientCrystals = this.nutrientCrystals.filter(c => now < c.expiresAt);
    this.pickupNutrientCrystals();
  }

  pickupNutrientCrystals() {
    for (let i = this.nutrientCrystals.length - 1; i >= 0; i--) {
      const c = this.nutrientCrystals[i];
      if (dist(this.player, c) < 46) {
        this.nutrient = Math.min(this.nutrientMax, this.nutrient + c.amount);
        this.nutrientCrystals.splice(i, 1);
        this.spawnAoeEffect(c.x, c.y, 30, '#ffe28a');
        this.damageNumbers.push({ x: c.x, y: c.y - 16, value: `+${c.amount}`, color: '#ffe28a', life: .6, maxLife: .6, vx: 0, vy: -44, heavy: false });
      }
    }
  }

  // ============ 培育结算（每局结束调用） ============
  applyPlantGrowthSettlement() {
    const g = CONFIG.plantGrowth;
    const record = (id, delta) => {
      if (delta === 0) return;
      const existing = this.growthSummary.find(s => s.id === id);
      if (existing) { existing.delta += delta; return; }
      const cfg = CONFIG.plants.find(p => p.id === id);
      if (cfg) this.growthSummary.push({ id, name: cfg.name, icon: cfg.icon, delta });
    };
    Object.keys(GameState.defensePlants).forEach(id => {
      const rec = GameState.defensePlants[id];
      if (!rec || rec.count <= 0) return;
      const before = rec.progress;
      rec.progress = clamp(rec.progress + g.basePerRun, 0, g.deployable);
      if (rec.progress !== before) record(id, rec.progress - before);
    });
    this.plantRecords.forEach(r => {
      const rec = GameState.defensePlants[r.seedId];
      if (!rec) return;
      if (r.survived) {
        const before = rec.progress;
        rec.progress = clamp(rec.progress + g.surviveBonus, 0, g.deployable);
        record(r.seedId, rec.progress - before);
        showToast(`${CONFIG.plants.find(p => p.id === r.seedId)?.name || r.seedId}存活撤离，培育 +${g.surviveBonus}`, 'success');
      } else if (r.destroyed) {
        const first = (this.plantDestroyCount[r.seedId] || 0) === 1;
        const penalty = (first ? g.firstDestroyPenalty : g.destroyPenalty) * (r.recovered ? 0.5 : 1);
        const before = rec.progress;
        rec.progress = clamp(rec.progress - penalty, 0, g.deployable);
        record(r.seedId, rec.progress - before);
        showToast(`${CONFIG.plants.find(p => p.id === r.seedId)?.name || r.seedId}被摧毁，培育 -${Math.round(penalty)}`, 'warning');
      }
    });
  }

  tryInteract() {
    const worldMouseX = this.mouse.x + this.camera.x;
    const worldMouseY = this.mouse.y + this.camera.y;
    // 检查宝箱
    for (const chest of this.chests) {
      if (!chest.opened && dist(this.player, chest) < 50 && dist({x:worldMouseX,y:worldMouseY}, chest) < 40) {
        this.openChest(chest);
        return;
      }
    }
    // 检查防御塔
    for (const tower of this.towers) {
      if (tower.state !== 'player' && dist(this.player, tower) < 50 && dist({x:worldMouseX,y:worldMouseY}, tower) < 40) {
        tower.state = 'player';
        tower.hp = tower.maxHp;
        showToast('防御塔已占领：进入射程可获得护盾减伤！', 'success');
        this.spawnAoeEffect(tower.x, tower.y, 50, '#7fff7f');
        return;
      }
    }
    // 检查撤离点
    for (const ep of this.extractPoints) {
      if (dist(this.player, ep) < ep.radius) {
        this.startExtract('fixed');
        return;
      }
    }
    // 普通攻击
    this.playerAttack();
  }

  playerAttack() {
    if (this.player.attackCd > 0) return;
    const w = this.weapon;
    // v2.0 等级词条：攻速/射程/速度修正
    const cdMult = 1 + (w.cdBonus || 0);
    this.player.attackCd = Math.max(0.08, w.cooldown * cdMult);
    const effRange = w.range * (1 + (w.rangeBonus || 0));
    const effSpeed = w.projectileSpeed * (1 + (w.speedBonus || 0));
    const worldMouseX = this.mouse.x + this.camera.x;
    const worldMouseY = this.mouse.y + this.camera.y;
    const angle = Math.atan2(worldMouseY - this.player.y, worldMouseX - this.player.x);
    this.player.angle = angle;
    this.weaponPulse = 0.18;
    this.attackAnim = 0.28;
    this.attackCombo = (this.attackCombo + 1) % 3;
    const combo = this.attackCombo;
    if (w.mode === 'melee') {
      const lungePower = [10, 13, 17][combo];
      this.player.lungeX = Math.cos(angle) * lungePower;
      this.player.lungeY = Math.sin(angle) * lungePower;
      // v2.0 镰刀Lv8 旋风斩：长按（mouse.down持续）360°扫
      const whirlwind = !!w.whirlwind && this.mouse.down;
      const arc = whirlwind ? Math.PI * 2 : Math.PI / 2;
      const reach = whirlwind ? effRange * 1.15 : effRange;
      [...this.monsters, ...this.raiders].forEach(m => {
        const d = dist(m, this.player);
        if (d < reach) {
          const mAngle = Math.atan2(m.y - this.player.y, m.x - this.player.x);
          const angleDiff = Math.abs(((mAngle - angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          if (whirlwind || angleDiff < arc) {
            let dmg = w.damage * (1 + this.attackBuffMult);
            if (whirlwind) dmg *= (1 + (w.whirlwindDmg || 0));
            this.damageEnemy(m, dmg, w.color, combo === 2, {
              x: m.x, y: m.y, angle, weaponId: w.id, fromPlayer: true
            });
            // Lv10 割裂：叠流血
            if (w.bleed) { m.bleedStack = (m.bleedStack || 0) + 1; m.bleedUntil = performance.now() + 3000; }
            m.stunned = Math.max(m.stunned || 0, combo === 2 ? 0.45 : 0.25);
            m.visualVz = Math.max(m.visualVz || 0, combo === 2 ? 120 : 95);
          }
        }
      });
      this.spawnSlashEffect(this.player.x, this.player.y, angle, w.color, combo === 2 ? 70 : 58, combo);
      this.spawnSwingTrail(this.player.x + Math.cos(angle) * 30, this.player.y + Math.sin(angle) * 30, angle, w.color, combo === 1 ? -1 : 1, combo === 2 ? 1.05 : 1);
      this.weaponRecoil = combo === 2 ? 0.75 : 0.5;
      AudioManager.playAttack('melee', combo);
      // v3.7 近战也能打道具（油桶/木箱）
      if (this.props) {
        this.props.forEach(pr => {
          if ((pr.kind === 'barrel' || pr.kind === 'crate') && pr.hp > 0) {
            const d = dist(pr, this.player);
            if (d < reach) {
              this.damageProp(pr, w.damage * (1 + this.attackBuffMult));
            }
          }
        });
      }
    } else {
      // v2.0 多弹道（豌豆Lv8/飞刃Lv8）
      const shots = w.multiShot || 1;
      const fanSpread = 0.18; // 扇面
      for (let s = 0; s < shots; s++) {
        const offset = shots === 1 ? 0 : (s - (shots - 1) / 2) * fanSpread;
        const a = angle + offset;
        const p = this.allocProjectile();
        Object.assign(p, { x: this.player.x + Math.cos(a) * 24, y: this.player.y + Math.sin(a) * 24,
          vx: Math.cos(a) * effSpeed, vy: Math.sin(a) * effSpeed,
          damage: w.damage * (1 + this.attackBuffMult), life: effRange / effSpeed, radius: 7,
          fromPlayer: true, weaponId: w.id, pierce: (w.pierce || 1) + (w.pierceBonus || 0),
          color: w.color,
          explode: w.explode || 0, burnDps: w.burnDps || 0, burnStack: w.burnStack || 1,
          slowOnHit: w.slowOnHit || 0, slowDur: w.slowDur || 0,
          rootChance: w.rootChance || 0, rootDur: w.rootDur || 0,
          instantKillLow: w.instantKillLow || 0, autoAim: !!w.autoAim,
          ricochet: w.ricochet || 0, plague: !!w.plague,
          rainArrows: w.rainArrows || 0, nuke: !!w.nuke
        });
        p.hit = p.hit || []; p.hit.length = 0;
        this.projectiles.push(p);
      }
      this.spawnMuzzleEffect(this.player.x, this.player.y, angle, w.color);
      this.weaponRecoil = 1;
      AudioManager.playAttack(w.id === 'vine_staff' ? 'vine' : 'pea');
    }
  }

  openChest(chest) {
    chest.opened = true;
    this.chestOpened++;
    AudioManager.playChestOpen();
    const loot = [];
    // 金币
    const gold = randInt(20, 80) * this.map.tier;
    loot.push({ type: 'gold', name: '金币', amount: gold, icon: '💰' });
    // 种子
    if (Math.random() < 0.6) {
      const crop = CONFIG.crops[randInt(0, 3)];
      loot.push({ type: 'seed', name: crop.name + '种子', amount: randInt(1, 2), icon: crop.icon, cropId: crop.id });
    }
    // 稀有种子
    if (Math.random() < this.map.rareSeedChance) {
      loot.push({ type: 'seed', name: '稀有种子', amount: 1, icon: '✨', rare: true });
    }
    // 传说种子
    if (Math.random() < this.map.legendarySeedChance) {
      loot.push({ type: 'seed', name: '月光稻种子', amount: 1, icon: '🌟', legendary: true, cropId: 'moon_rice' });
    }
    // 植物防线种子（按T级概率掉落）
    const drops = CONFIG.plantDrops[this.map.tier - 1] || { common: 0, rare: 0, legendary: 0 };
    const plantRoll = Math.random();
    let plant = null;
    if (plantRoll < drops.legendary) {
      plant = CONFIG.plants.find(p => p.rarity === 'legendary');
    } else if (plantRoll < drops.legendary + drops.rare) {
      plant = CONFIG.plants.find(p => p.rarity === 'rare');
    } else if (plantRoll < drops.legendary + drops.rare + drops.common) {
      plant = CONFIG.plants.find(p => p.rarity === 'common');
    }
    if (plant) {
      loot.push({ type: 'plant_seed', name: plant.name + '防线种子', amount: 1, icon: plant.icon, plantId: plant.id });
    }
    // 材料
    if (Math.random() < 0.4) {
      loot.push({ type: 'material', name: '建材', amount: randInt(1, 3), icon: '📦' });
    }
    // 消耗品
    if (Math.random() < 0.3) {
      loot.push({ type: 'consumable', name: '草药包扎包', amount: 1, icon: '💊', id: 'herb_kit' });
    }
    if (chest.hasSignal) {
      loot.push({ type: 'consumable', name: '撤离信号弹', amount: 1, icon: '🔥', id: 'signal_flare' });
    }
    if (Math.random() < 0.24) {
      loot.push({ type: 'farm_item', name: '生长催化剂', amount: 1, icon: '⏳', id: 'growth_catalyst' });
    }

    loot.forEach(item => this.spawnGroundLoot(item, chest.x, chest.y));
    showToast(`宝箱打开，掉落${loot.length}件物品，进入攻击范围后自动拾取`, 'gold');
    this.spawnAoeEffect(chest.x, chest.y, 50, '#ffd700');
    this.updateHUD();
  }

  startExtract(type) {
    if (this.extracting) return;
    this.extracting = true;
    this.extractType = type;
    this.extractProgress = 0;
    this.signalReinforced = false;
    if (type === 'signal') this.spawnSignalAmbush(0);
    showToast(type === 'signal' ? '信号弹撤离启动！坚持20秒，伏击正在逼近！' : '开始撤离读条，坚持15秒！', 'warning');
  }

  // v4.2 信号弹伏击：信号弹把全图怪物引来，读条开始第一波，中段增援第二波
  spawnSignalAmbush(wave) {
    const tier = (this.map && this.map.tier) || 1;
    const count = (wave === 0 ? 8 : 6) + tier * 2;
    const types = tier >= 3 ? ['wolf', 'spider', 'bat', 'locust'] : ['boar', 'bat', 'spider', 'locust', 'wolf'];
    for (let i = 0; i < count; i++) {
      const type = types[randInt(0, types.length - 1)];
      const data = CONFIG.monsters[type];
      if (!data) continue;
      const angle = Math.PI * 2 * i / count + rand(-0.25, 0.25);
      const distance = rand(380, 560);
      const x = clamp(this.player.x + Math.cos(angle) * distance, 80, CONFIG.expedition.mapSize - 80);
      const y = clamp(this.player.y + Math.sin(angle) * distance, 80, CONFIG.expedition.mapSize - 80);
      const hpScale = this.balance.enemyHp * 0.85;
      this.monsters.push({
        type, ...data, x, y,
        hp: Math.round(data.hp * hpScale), maxHp: Math.round(data.hp * hpScale),
        damage: Math.max(3, Math.round(data.damage * this.balance.enemyDamage * 0.85)),
        speed: data.speed * this.balance.enemySpeed * 1.12,
        attackCd: 0, stunned: 0, target: this.player, vx: 0, vy: 0,
        facing: angle + Math.PI, animTime: rand(0, 10), hitFlash: 0,
        elite: false, abilityCd: rand(1, 4), packOffset: rand(-1, 1), signalAmbush: true,
        state: 'idle', stateTimer: 0
      });
    }
    this.screenShake = Math.min(1, this.screenShake + 0.6);
    this.spawnRadialBurst(this.player.x, this.player.y, '#ff5a3c', 26);
    showToast(wave === 0 ? '信号弹引来伏击怪，守住撤离点！' : '第二波伏击怪增援！', 'warning');
  }

  cancelExtract() {
    if (!this.extracting) return;
    this.extracting = false;
    this.extractProgress = 0;
    showToast('撤离被打断！', 'warning');
  }

  completeExtract() {
    this.gameOver = true;
    this.result = 'success';
    AudioManager.playEvacuateSuccess();
    // v1.0 成就追踪
    if (typeof AchievementSystem !== 'undefined') {
      AchievementSystem.trackEvent('extract');
      const s = AchievementSystem && GameState.achievements.stats;
      s.consecutiveExtracts = (s.consecutiveExtracts || 0) + 1;
      s.lastRunKills = this.killCount || 0;
      s.lastRunGold = this.bag.filter(i=>i.type==='gold').reduce((a,i)=>a+i.amount,0);
      AchievementSystem.checkAll();
    }
    this.endExpedition();
  }

  playerDeath() {
    this.gameOver = true;
    this.result = 'failed';
    AudioManager.playDeath();
    if (GameState.achievements) GameState.achievements.stats.consecutiveExtracts = 0;
    // v1.0 死亡永久损失带入武器
    if (typeof LoadoutSystem !== 'undefined') LoadoutSystem.loseBroughtWeapon();
    this.endExpedition();
  }

  endExpedition() {
    // 标记存活植物（撤离时仍在场）
    this.plants.forEach(p => {
      if (p.hp > 0) {
        const record = this.plantRecords.find(r => r.seedId === p.seedId && !r.destroyed);
        if (record) record.survived = true;
      }
    });
    this.cleanup();
    // 培育结算（基础+10 / 存活+40 / 被毁-30，首杀-15）
    this.applyPlantGrowthSettlement();
    // 计算结算
    const totalGold = this.bag.filter(i => i.type === 'gold').reduce((s, i) => s + i.amount, 0);
    const keptItems = [];
    const lostItems = [];

    if (this.result === 'success') {
      // 成功：全部保留（含安全箱里的）
      this.bag.forEach(i => keptItems.push({ ...i, kept: true }));
      (this.safeBox || []).forEach(i => keptItems.push({ ...i, kept: true }));
      GameState.gold += totalGold;
      // 安全箱里的物品也一并入库
      (this.safeBox || []).forEach(i => {
        if (i.type === 'gold') GameState.gold += i.amount;
        else if (i.type === 'seed') Warehouse.addItem('seeds', i.amount);
        else if (i.type === 'material') {
          const matId = i.matId || (i.id && CONFIG.warehouseItems[i.id] ? i.id : null);
          if (matId && CONFIG.warehouseItems[matId]) Warehouse.addItem(matId, i.amount);
          else Warehouse.addItem('materials', i.amount);
        }
        else if (i.type === 'consumable') Warehouse.addItem(i.id, i.amount);
        else if (i.type === 'farm_item') Warehouse.addItem(i.id, i.amount);
      });
      this.bag.filter(i => i.type === 'seed').forEach(i => {
        Warehouse.addItem('seeds', i.amount);
        if (i.cropId && !GameState.unlockedCrops.includes(i.cropId)) {
          GameState.unlockedCrops.push(i.cropId);
          showToast(`解锁新作物：${CONFIG.crops.find(crop => crop.id === i.cropId)?.name || i.name}`, 'gold');
        }
      });
      this.bag.filter(i => i.type === 'material').forEach(i => {
        // v3.6 按 matId 分类入库，没有 matId 才归到通用 materials
        const matId = i.matId || (i.id && CONFIG.warehouseItems[i.id] ? i.id : null);
        if (matId && CONFIG.warehouseItems[matId]) {
          Warehouse.addItem(matId, i.amount);
        } else {
          Warehouse.addItem('materials', i.amount);
        }
      });
      this.bag.filter(i => i.type === 'consumable').forEach(i => {
        Warehouse.addItem(i.id, i.amount);
      });
      this.bag.filter(i => i.type === 'farm_item').forEach(i => {
        Warehouse.addItem(i.id, i.amount);
      });
      // v3.2 种子入农场仓库
      this.bag.filter(i => i.type === 'seed_item').forEach(i => {
        if (typeof GameState.seeds !== 'object' || GameState.seeds === null) GameState.seeds = {};
        GameState.seeds[i.seedId] = (GameState.seeds[i.seedId] || 0) + (i.amount || 1);
        showToast(`🌱 收获种子：${i.name} ×${i.amount}`, 'success');
      });
    } else {
      // v3.6 失败：玩家主动存入 this.safeBox 的物品必保留，其余全掉
      const safeItems = this.safeBox || [];
      safeItems.forEach(i => keptItems.push({ ...i, kept: true }));
      this.bag.forEach(i => {
        // 安全箱里的物品已经算 kept 过了，这里只处理 bag 里的（非安全箱物品）
        lostItems.push({ ...i, kept: false });
      });
      // 把安全箱物品也入账（金币/材料/消耗品）
      safeItems.forEach(i => {
        if (i.type === 'gold') GameState.gold += i.amount;
        else if (i.type === 'seed') Warehouse.addItem('seeds', i.amount);
        else if (i.type === 'material') {
          const matId = i.matId || (i.id && CONFIG.warehouseItems[i.id] ? i.id : null);
          if (matId && CONFIG.warehouseItems[matId]) Warehouse.addItem(matId, i.amount);
          else Warehouse.addItem('materials', i.amount);
        }
        else if (i.type === 'consumable') Warehouse.addItem(i.id, i.amount);
      });
    }

    // v0.8.0 远征通关给科技点（仅成功时）
    if (this.result === 'success' && typeof TechSystem !== 'undefined') {
      TechSystem.onExpeditionComplete(this.map.tier, GameState.difficulty);
    }

    SaveSystem.save();

    // v3.8 生成本局高光卡片
    const rs = this.runStats || {};
    const highlights = [];
    if (this.killCount >= 50) highlights.push({ icon: '⚔️', title: '杀戮机器', desc: `单局击杀 ${this.killCount} 只怪` });
    else if (this.killCount >= 30) highlights.push({ icon: '⚔️', title: '老练猎手', desc: `击杀 ${this.killCount} 只怪` });
    if ((rs.maxDistFromSpawn || 0) > 800) highlights.push({ icon: '🗺️', title: '深度探索', desc: `最远深入 ${Math.round(rs.maxDistFromSpawn)}m` });
    if ((rs.minHpSeen || 100) < 15) highlights.push({ icon: '❤️‍🩹', title: '丝血逃生', desc: `血量一度低至 ${rs.minHpSeen.toFixed(0)}%` });
    else if ((rs.minHpSeen || 100) < 30 && this.result === 'success') highlights.push({ icon: '❤️', title: '险象环生', desc: `残血通关（最低 ${rs.minHpSeen.toFixed(0)}%）` });
    if ((rs.eliteKills || 0) >= 3) highlights.push({ icon: '👑', title: '精英猎人', desc: `击杀 ${rs.eliteKills} 只精英` });
    if ((rs.bossKills || 0) >= 1) highlights.push({ icon: '💀', title: 'Boss 终结者', desc: `击杀 Boss ${rs.bossKills} 次` });
    if ((rs.perfectDodgeCount || 0) >= 5) highlights.push({ icon: '💫', title: '风之舞者', desc: `${rs.perfectDodgeCount} 次完美闪避` });
    if ((rs.barrelsDetonated || 0) >= 3) highlights.push({ icon: '💥', title: '爆炸专家', desc: `引爆 ${rs.barrelsDetonated} 个油桶` });
    if ((rs.plantsDeployed || 0) >= 5) highlights.push({ icon: '🌱', title: '农场指挥官', desc: `部署 ${rs.plantsDeployed} 株战场植物` });
    if (this.chestOpened >= 5) highlights.push({ icon: '🎁', title: '宝箱收藏家', desc: `开启 ${this.chestOpened} 个宝箱` });
    if (this.result === 'success' && (rs.nearDeathCount || 0) >= 3) highlights.push({ icon: '🔥', title: '命悬一线', desc: `3 次以上濒临死亡仍成功撤离` });
    // 保底：如果一个高光都没有，给个安慰
    if (highlights.length === 0) {
      highlights.push({ icon: '🌾', title: '安稳远征', desc: `平安度过，击杀 ${this.killCount} 只怪` });
    }

    // 显示结算
    Game.showResult({
      success: this.result === 'success',
      mapName: this.map.name,
      timeUsed: (CONFIG.expedition.demoDuration - this.timeLeft).toFixed(1),
      kills: this.killCount,
      chests: this.chestOpened,
      damageTaken: this.damageTaken,
      goldEarned: this.result === 'success' ? totalGold : Math.floor(totalGold * 0.2),
      keptItems, lostItems,
      plantGrowth: this.growthSummary || [],
      highlights: highlights.slice(0, 4),
      runStats: rs,
    });
  }

  // v0.9.0 获取作物buff倍率
  _getCropBuffMult(type) {
    const buff = this.cropBuffs.find(b => b.type === type);
    return buff ? buff.value : 0;
  }

  allocParticle() { return this.particlePool.length ? this.particlePool.pop() : {}; }

  allocProjectile() { return this.projectilePool.length ? this.projectilePool.pop() : {}; }

  spawnHitParticles(x, y, color) {
    for (let i = 0; i < 11; i++) {
      const p = this.allocParticle();
      Object.assign(p, { x, y, vx: rand(-175, 175), vy: rand(-175, 175),
        life: 0.46, maxLife: 0.46, color, size: rand(2, 6), type: undefined, angle: undefined });
      this.particles.push(p);
    }
  }

  // 命中点光爆：亮斑 + 十字星芒
  spawnImpact(x, y, color, scale = 1) {
    const p = this.allocParticle();
    Object.assign(p, { x, y, vx: 0, vy: 0, life: 0.22, maxLife: 0.22, color, size: 10 * scale, type: 'impact' });
    this.particles.push(p);
    const r = this.allocParticle();
    Object.assign(r, { x, y, vx: 0, vy: 0, life: 0.28, maxLife: 0.28, color, size: 18 * scale, type: 'shock' });
    this.particles.push(r);
  }

  // 定向火花：沿攻击反方向喷射、带阻力与重力
  spawnDirectionalSparks(x, y, angle, color, count = 6, power = 1) {
    for (let i = 0; i < count; i++) {
      const spread = angle + Math.PI + rand(-0.7, 0.7);
      const speed = rand(120, 300) * power;
      const p = this.allocParticle();
      Object.assign(p, {
        x, y,
        vx: Math.cos(spread) * speed, vy: Math.sin(spread) * speed,
        life: rand(0.22, 0.42), maxLife: 0.42, color,
        size: rand(1.5, 3.5), type: 'splat', drag: 5, grav: 60,
        rot: rand(0, Math.PI * 2), spin: rand(-9, 9)
      });
      this.particles.push(p);
    }
  }

  // 冲击环：重击/暴击/Boss 受击时的扩散圆环
  spawnShockRing(x, y, color, size = 46) {
    const p = this.allocParticle();
    Object.assign(p, { x, y, vx: 0, vy: 0, life: 0.3, maxLife: 0.3, color, size, type: 'shock' });
    this.particles.push(p);
    const r = this.allocParticle();
    Object.assign(r, { x, y, vx: 0, vy: 0, life: 0.2, maxLife: 0.2, color: '#ffffff', size: size * 0.55, type: 'shock' });
    this.particles.push(r);
  }

  // 拖尾刀光：三层错开的残留弧光，主层带白色亮芯
  spawnSwingTrail(x, y, angle, color, dir = 1, scale = 1) {
    for (let k = 0; k < 3; k++) {
      const p = this.allocParticle();
      Object.assign(p, { x, y, vx: 0, vy: 0, life: 0.2 + k * 0.05, maxLife: 0.3, color,
        size: (48 - k * 9) * scale, angle: angle + dir * k * 0.14, dir, layer: k, type: 'trail' });
      this.particles.push(p);
    }
  }

  // 冻结碎裂：冰晶碎片向四周飞溅（big 为死亡大碎裂）
  spawnFrostShatter(x, y, big = false) {
    const count = big ? 22 : 9;
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(70, big ? 320 : 210);
      const p = this.allocParticle();
      Object.assign(p, { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
        life: rand(0.35, 0.65), maxLife: 0.65,
        color: ['#d8f6ff', '#a8e4ff', '#ffffff'][i % 3],
        size: rand(3, big ? 9 : 6), type: 'ice', drag: 3.2, grav: 260,
        rot: rand(0, Math.PI * 2), spin: rand(-12, 12) });
      this.particles.push(p);
    }
    this.spawnShockRing(x, y, '#bfeeff', big ? 70 : 40);
    if (big) this.spawnImpact(x, y, '#d8f6ff', 1.4);
    AudioManager.playFrostShatter();
  }

  // 火焰粒子：向上飘升、带阻力的暖色火球
  spawnFlame(x, y) {
    const p = this.allocParticle();
    Object.assign(p, { x: x + rand(-8, 8), y, vx: rand(-26, 26), vy: rand(-115, -60),
      life: rand(0.3, 0.48), maxLife: 0.48, color: '#ff8a2c', size: rand(4, 8),
      type: 'flame', drag: 1.6, grav: -40 });
    this.particles.push(p);
  }

  // 施加灼烧：刷新持续时间，取更高 dps
  applyBurn(target, dps = 14, duration = 2.5) {
    if (!target || target.hp <= 0) return;
    const cur = target.burn;
    target.burn = { time: duration, dps: Math.max(cur ? cur.dps : 0, dps),
      tick: cur ? Math.min(cur.tick, 0.2) : 0.1, fx: 0 };
    this.spawnImpact(target.x, target.y, '#ff9a3c', 1.1);
    AudioManager.playIgnite();
  }

  // 灼烧状态推进：火焰视觉 + 每 0.4s 一跳伤害（quiet，不击退不顿帧）
  updateBurn(m, dt) {
    if (!m.burn) return;
    m.burn.time -= dt;
    m.burn.fx -= dt;
    if (m.burn.fx <= 0) { m.burn.fx = 0.06; this.spawnFlame(m.x + rand(-m.radius * 0.6, m.radius * 0.6), m.y - m.radius * 0.4); }
    m.burn.tick -= dt;
    if (m.burn.tick <= 0 && m.hp > 0) {
      m.burn.tick = 0.4;
      this.damageEnemy(m, m.burn.dps * 0.4, '#ff8a3c', false,
        { x: m.x, y: m.y, angle: 0, weaponId: 'burn', fromPlayer: true, quiet: true, crit: false });
      AudioManager.playBurnTick();
    }
    if (m.burn.time <= 0 || m.hp <= 0) m.burn = null;
  }

  // 闪电折线（世界坐标点列，静态粒子）
  spawnLightningBolt(x1, y1, x2, y2, color = '#a9f5ff') {
    const segments = 6;
    const points = [{ x: x1, y: y1 }];
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    for (let i = 1; i < segments; i++) {
      const t = i / segments;
      const jitter = rand(-14, 14) * (i === 1 || i === segments - 1 ? 0.4 : 1);
      points.push({ x: x1 + dx * t + nx * jitter, y: y1 + dy * t + ny * jitter });
    }
    points.push({ x: x2, y: y2 });
    const p = this.allocParticle();
    Object.assign(p, { x: (x1 + x2) / 2, y: (y1 + y2) / 2, vx: 0, vy: 0,
      life: 0.2, maxLife: 0.2, color, size: 1, type: 'chain', points });
    this.particles.push(p);
  }

  // 电击链：从命中目标向最近敌人跳跃，最多 jumps 次，每跳伤害衰减
  lightningChainFrom(source, proj, hitSet, jumpsLeft, dmgRatio) {
    if (jumpsLeft <= 0) return;
    let nearest = null, bestD = 150 * 150;
    for (const m of this.monsters) {
      if (m.hp <= 0 || hitSet.includes(m)) continue;
      const dd = (m.x - source.x) ** 2 + (m.y - source.y) ** 2;
      if (dd < bestD) { bestD = dd; nearest = m; }
    }
    if (!nearest) return;
    hitSet.push(nearest);
    this.spawnLightningBolt(source.x, source.y, nearest.x, nearest.y);
    this.spawnImpact(nearest.x, nearest.y, '#bff7ff', 1.1);
    this.spawnDirectionalSparks(nearest.x, nearest.y,
      Math.atan2(nearest.y - source.y, nearest.x - source.x), '#cdf9ff', 5, 0.9);
    this.damageEnemy(nearest, (proj.damage || 10) * dmgRatio, '#a9f5ff', false, {
      x: nearest.x, y: nearest.y,
      angle: Math.atan2(nearest.y - source.y, nearest.x - source.x),
      weaponId: 'vine_staff', fromPlayer: true, quiet: true, crit: false
    });
    nearest.visualVz = Math.max(nearest.visualVz || 0, 60);
    AudioManager.playZap();
    this.lightningChainFrom(nearest, proj, hitSet, jumpsLeft - 1, dmgRatio * 0.8);
  }

  explodeBomber(m) {
    if (!m || m.hp <= 0) return;
    const R = 80;
    this.spawnShockRing(m.x, m.y, '#ff5533', R);
    this.spawnImpact(m.x, m.y, '#ffaa33', 1.6);
    const d = dist(m, this.player);
    if (d < R) this.damagePlayer(m.damage || 20);
    this.monsters.forEach(o => { if (o !== m && o.hp > 0 && dist(o, m) < R) this.damageEnemy(o, (m.damage || 20) * 0.6, '#ff6644', false, { quiet: true }); });
    m.hp = 0;
  }

  nearestMonster(x, y, maxDist = 600) {
    let best = null, bd = maxDist * maxDist;
    for (const m of this.monsters) {
      if (m.hp <= 0) continue;
      const dx = m.x - x, dy = m.y - y, d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = m; }
    }
    return best;
  }

  damageEnemy(target, amount, color = '#ffffff', heavy = false, hitInfo = null) {
    if (!target || target.hp <= 0) return;
    if (target.armor) amount *= (1 - target.armor); // 厚甲猪减伤
    const isBoss = target.type === 'boss';
    const fromPlayer = hitInfo ? hitInfo.fromPlayer === true : false;
    if (fromPlayer && typeof CombatEnhancement !== 'undefined') {
      amount *= CombatEnhancement.getComboMul();
      if (CombatEnhancement.nextAttackCrit) { CombatEnhancement.nextAttackCrit = false; amount *= 2.0; if (hitInfo) hitInfo.crit = true; }
      CombatEnhancement.onEnemyHit();
      if (hitInfo && hitInfo.x !== undefined) CombatEnhancement.damageDestructible(hitInfo.x, hitInfo.y, amount);
    }
    // quiet：持续伤害/电击链不产生击退顿帧，避免抖动刷屏
    const quiet = !!(hitInfo && hitInfo.quiet);
    // v2.0 武器等级：暴击率加成（镰刀Lv6 +10%、飞刃Lv6 +15%）
    const critBonus = (fromPlayer && this.weapon && this.weapon.critChanceBonus) ? this.weapon.critChanceBonus : 0;
    const critBase = (fromPlayer && hitInfo && hitInfo.crit !== false) ? (0.20 + critBonus) : 0;
    const isCrit = critBase > 0 && Math.random() < critBase;
    if (isCrit) {
      let critMult = 1.8;
      if (fromPlayer && this.weapon && this.weapon.critDmgBonus) critMult += this.weapon.critDmgBonus;
      amount *= critMult;
      this.applyBurn(target, Math.max(10, amount * 0.35), 2.5);
    }
    const _prevSeg = typeof CombatEnhancement !== 'undefined' && target.maxHp > 0 ? Math.min(CombatEnhancement.getSegments(target), Math.ceil((target.hp/target.maxHp)*CombatEnhancement.getSegments(target))) : 0;
    target.hp -= amount;
    if (typeof CombatEnhancement !== 'undefined' && target.maxHp > 0 && target.hp > 0) {
      const seg = CombatEnhancement.getSegments(target);
      const curSeg = Math.min(seg, Math.ceil((target.hp/target.maxHp)*seg));
      if (curSeg < _prevSeg) CombatEnhancement.onSegmentBreak(target);
    }
    target.hitFlash = heavy ? 0.22 : 0.14;
    // v3.3 攻击打断：命中正在前摇的非精英/Boss 怪，20% 概率打断
    if (target.windupT > 0 && !target.elite && target.type !== 'boss' && fromPlayer && Math.random() < 0.20) {
      target.windupT = 0; target.windupKind = null;
      target.stunned = Math.max(target.stunned || 0, 0.6);
      this.spawnImpact(target.x, target.y, '#aaffcc', 1.2);
      showToast('打断！', 'success');
    }
    target.state = target.hp <= 0 ? 'death' : 'hit';
    target.stateTimer = target.hp <= 0 ? .4 : .18;
    // v2.0 镰刀Lv7 击杀回血
    if (target.hp <= 0 && fromPlayer && this.weapon && this.weapon.lifesteal) {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.weapon.lifesteal);
    }
    const dmgColor = isCrit ? '#ffd968' : color;
    this.damageNumbers.push({
      x: target.x + rand(-8, 8), y: target.y - target.radius - 8,
      value: Math.round(amount), color: dmgColor, life: isCrit ? 0.9 : 0.72, maxLife: isCrit ? 0.9 : 0.72,
      vx: rand(-10, 10), vy: heavy ? -64 : -48, heavy: heavy || isCrit, crit: isCrit
    });
    // 命中点光爆 + 沿攻击方向的定向火花 + 冲击环（重击/暴击/Boss）
    const hitX = hitInfo ? hitInfo.x : target.x;
    const hitY = hitInfo ? hitInfo.y : target.y;
    const hitAngle = hitInfo ? hitInfo.angle : Math.atan2(target.y - this.player.y, target.x - this.player.x);
    const weaponId = hitInfo ? hitInfo.weaponId : '';
    // 武器专属配色：命中光爆与定向火花颜色随武器变化
    const fx = WEAPON_FX[weaponId];
    const impactColor = isCrit ? '#fff3b0' : (fx ? fx.impact : color);
    const sparkColor = isCrit ? '#fff0a0' : (fx ? fx.spark : color);
    this.spawnImpact(hitX, hitY, impactColor, isCrit ? 1.6 : 1);
    this.spawnDirectionalSparks(hitX, hitY, hitAngle, sparkColor, heavy ? 12 : 8, isBoss ? 1.25 : 1);
    const hp = this.allocParticle();
    Object.assign(hp, { x: hitX, y: hitY, vx: 0, vy: 0, life: 0.22, maxLife: 0.22, type: 'hitImg', size: isCrit ? 90 : 60 });
    this.particles.push(hp);
    if (heavy || isCrit || isBoss) this.spawnShockRing(hitX, hitY, isBoss ? '#ffd9a0' : impactColor, isBoss ? 84 : 52);
    // 冻结碎裂：被寒冰藤减速（冰冻状态）的敌人受击时碎冰飞溅，死亡时大碎裂
    if (target.slow > 0 && fromPlayer) this.spawnFrostShatter(hitX, hitY, target.hp <= 0);
    if (!quiet) {
      // 方向击退：Boss 只受轻微击退；暴击额外 ×1.7
      const knockPower = (heavy ? 215 : 130) * (isBoss ? 0.3 : 1) * (isCrit ? 1.7 : 1);
      target.knockX = (target.knockX || 0) + Math.cos(hitAngle) * knockPower;
      target.knockY = (target.knockY || 0) + Math.sin(hitAngle) * knockPower;
      if (target.hp > 0) this.hitStop = Math.max(this.hitStop, isCrit ? 0.14 : heavy ? 0.09 : 0.05);
      if (target.hp > 0 && (isCrit || heavy)) this.screenShake = Math.max(this.screenShake, isCrit ? 0.5 : 0.32);
    }
    if (isCrit) {
      this.critFlash = Math.max(this.critFlash, 0.2);
      AudioManager.playCritHit();
    }
    AudioManager.playMonsterHit(isBoss ? 'heavy' : (isCrit ? 'crit' : heavy ? 'heavy' : 'normal'), weaponId);
    if (isBoss) AudioManager.playBossHit();
    if (this.fxSprites && this.fxSprites.hitBlood) {
      this.fxParticles = this.fxParticles || [];
      this.fxParticles.push({ img: this.fxSprites.hitBlood, x: hitX, y: hitY, life: 0.35, maxLife: 0.35, size: 32 });
    }
  }

  spawnKillFeedback(target) {
    this.killFlash = 0;
    // 击杀不触发时间停顿/重抖屏，避免"卡顿感"
    this.screenShake = Math.max(this.screenShake, target.type === 'boss' ? 0.16 : 0.10);
    this.spawnRadialBurst(target.x, target.y, target.type === 'boss' ? '#ffe8a0' : '#ff7868', target.type === 'boss' ? 12 : 9);
    if (target.slow > 0) this.spawnFrostShatter(target.x, target.y, true);
    if (target.burn) this.spawnRadialBurst(target.x, target.y, '#ff9a3c', 8);
    this.spawnShockRing(target.x, target.y, target.type === 'boss' ? '#ffca7a' : '#ff9a6a', target.type === 'boss' ? 64 : 40);
    this.spawnShockRing(target.x, target.y, target.type === 'boss' ? '#ffca7a' : '#ff9a6a', target.type === 'boss' ? 64 : 40);
    AudioManager.playMonsterHit('kill');
  }

  spawnAoeEffect(x, y, radius, color) {
    const p = this.allocParticle();
    Object.assign(p, { x, y, vx: 0, vy: 0, life: 0.5, maxLife: 0.5, color, size: radius, type: 'aoe' });
    this.particles.push(p);
    const r = this.allocParticle();
    Object.assign(r, { x, y, vx: 0, vy: 0, life: 0.35, maxLife: 0.35, color: '#ffffff', size: radius * 0.6, type: 'aoe' });
    this.particles.push(r);
  }

  spawnSlashEffect(x, y, angle, color = '#ffffff', size = 50, combo = 0) {
    const p = this.allocParticle();
    Object.assign(p, { x, y, vx: 0, vy: 0, life: 0.2, maxLife: 0.2,
      color, size, angle, dir: combo === 1 ? -1 : 1, type: 'slash' });
    this.particles.push(p);
    const inner = this.allocParticle();
    Object.assign(inner, { x, y, vx: 0, vy: 0, life: 0.14, maxLife: 0.14,
      color: '#ffffff', size: size * 0.7, angle, dir: combo === 1 ? -1 : 1, type: 'slash' });
    this.particles.push(inner);
  }

  spawnMuzzleEffect(x, y, angle, color) {
    for (let i = 0; i < 6; i++) {
      const spread = angle + rand(-0.32, 0.32);
      const p = this.allocParticle();
      Object.assign(p, { x: x + Math.cos(angle) * 22, y: y + Math.sin(angle) * 22,
        vx: Math.cos(spread) * rand(65, 150), vy: Math.sin(spread) * rand(65, 150),
        life: 0.22, maxLife: 0.22, color, size: rand(2, 5), type: 'spark', angle: undefined });
      this.particles.push(p);
    }
  }

  spawnWeaponSwitchEffect() {
    const colors = ['#f2c45b', '#75dc68', '#7be5c4'];
    colors.forEach((color, ring) => {
      const p = this.allocParticle();
      Object.assign(p, { x: this.player.x, y: this.player.y,
        vx: 0, vy: 0, life: 0.38 + ring * 0.08, maxLife: 0.38 + ring * 0.08,
        color, size: 34 + ring * 10, type: 'weaponRing' });
      this.particles.push(p);
    });
  }

  spawnRadialBurst(x, y, color, count = 10) {
    for (let i = 0; i < count; i++) {
      const angle = Math.PI * 2 * i / count + rand(-0.1, 0.1);
      const p = this.allocParticle();
      Object.assign(p, { x, y, vx: Math.cos(angle) * rand(100, 230), vy: Math.sin(angle) * rand(100, 230),
        life: 0.48, maxLife: 0.48, color, size: rand(3, 7), type: 'chaff', angle: undefined });
      this.particles.push(p);
    }
  }

  spawnVineEffect(x, y, radius) {
    for (let i = 0; i < 9; i++) {
      const angle = Math.PI * 2 * i / 9;
      const p = this.allocParticle();
      Object.assign(p, { x, y, vx: 0, vy: 0, life: 0.75, maxLife: 0.75,
        color: i % 2 ? '#89db67' : '#3f9d56', size: radius * rand(0.62, 1), angle, type: 'vine' });
      this.particles.push(p);
    }
  }

  spawnDashTrail(x, y, angle, color) {
    for (let i = 0; i < 7; i++) {
      const p = this.allocParticle();
      Object.assign(p, { x: x - Math.cos(angle) * i * 22, y: y - Math.sin(angle) * i * 22,
        vx: 0, vy: 0, life: 0.38 - i * 0.025, maxLife: 0.38,
        color, size: 18 - i, angle, type: 'earthTrail' });
      this.particles.push(p);
    }
  }

  spawnSmokeEffect(x, y) {
    for (let i = 0; i < 18; i++) {
      const angle = rand(0, Math.PI * 2), speed = rand(22, 85);
      const p = this.allocParticle();
      Object.assign(p, { x: x + rand(-20, 20), y: y + rand(-20, 20),
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: rand(0.7, 1.15), maxLife: 1.15, color: i % 3 ? '#808c88' : '#b5c3ba',
        size: rand(12, 28), type: 'smoke', angle: undefined });
      this.particles.push(p);
    }
  }

  spawnDashParticles(x, y, angle) {
    for (let i = 0; i < 8; i++) {
      const p = this.allocParticle();
      Object.assign(p, {
        x: x - Math.cos(angle) * i * 15,
        y: y - Math.sin(angle) * i * 15,
        vx: rand(-30, 30), vy: rand(-30, 30),
        life: 0.3, maxLife: 0.3, color: '#88ccff', size: rand(3, 6), type: undefined, angle: undefined
      });
      this.particles.push(p);
    }
  }

  update(dt) {
    if (this.paused || this.gameOver) return;
    this.updatePlants(dt);
    if (typeof CombatEnhancement !== 'undefined') CombatEnhancement.update(dt);
    if (typeof DifficultySystem !== 'undefined') { DifficultySystem.tick(dt, this); DifficultySystem.tickPoison(dt, this); }
    this.updateWorldSystems(dt);
    if (typeof WorldFX !== 'undefined') WorldFX.update(this, dt);
    this.fogUpdateTimer -= dt;
    if (this.fogUpdateTimer <= 0) {
      this.fogUpdateTimer += this.fogUpdateInterval;
      this.fogDirty = true;
    }
    this.entitySpatialHash.rebuild([...this.monsters, ...this.raiders]);
    this.pickupLoot();
    // 植物防线：养分结晶刷新/拾取 + 植物行为
    this.refreshNutrientCrystals(dt);
    this.updatePlants(dt);

    // 倒计时
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.playerDeath();
      return;
    }

    // v3.3 受击硬直期间禁止移动
    if (this.player.hitStun > 0) {
      this.player.hitStun -= dt;
      dt *= 0.25; // 时间整体减速
    }
    // 玩家移动
    let dx = 0, dy = 0;
    if (this.keys['w']) dy -= 1;
    if (this.keys['s']) dy += 1;
    if (this.keys['a']) dx -= 1;
    if (this.keys['d']) dx += 1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0) { dx /= len; dy /= len; }

    let speed = CONFIG.player.speed;
    if (this.keys['shift'] && this.player.energy > 1) {
      speed = CONFIG.player.sprintSpeed;
      this.player.energy -= CONFIG.player.sprintCost * dt;
    }
    let terrainModifier = 1;
    for (const patch of this.terrainPatches) {
      const nx = (this.player.x - patch.x) / patch.rx;
      const ny = (this.player.y - patch.y) / patch.ry;
      if (nx * nx + ny * ny <= 1) {
        if (patch.type === 'water') terrainModifier = Math.min(terrainModifier, 0.58);
        else if (patch.type === 'soil') terrainModifier = Math.min(terrainModifier, 0.82);
      }
    }
    if (this.player.slow > 0) terrainModifier *= 0.56;
    // v3.7 洼地减速
    const hz = this.getHeightAt(this.player.x, this.player.y);
    if (hz === 'low') terrainModifier *= 0.7;
    speed *= terrainModifier;
    const previousX = this.player.x;
    const previousY = this.player.y;
    this.player.x += dx * speed * dt;
    this.player.y += dy * speed * dt;
    // 挥击突进：惯性位移随时间衰减
    const lungeX = this.player.lungeX || 0, lungeY = this.player.lungeY || 0;
    if (lungeX || lungeY) {
      this.player.x += lungeX * dt;
      this.player.y += lungeY * dt;
      const lungeDecay = Math.max(0, 1 - 9 * dt);
      this.player.lungeX = lungeX * lungeDecay;
      this.player.lungeY = lungeY * lungeDecay;
    }
    const size = CONFIG.expedition.mapSize;
    this.player.x = clamp(this.player.x, 20, size - 20);
    this.player.y = clamp(this.player.y, 20, size - 20);
    if (this.collidesWithObstacle(this.player.x, this.player.y, this.player.collisionRadius)) {
      const movedX = this.player.x;
      const movedY = this.player.y;
      this.player.x = movedX;
      this.player.y = previousY;
      if (this.collidesWithObstacle(this.player.x, this.player.y, this.player.collisionRadius)) this.player.x = previousX;
      this.player.y = movedY;
      if (this.collidesWithObstacle(this.player.x, this.player.y, this.player.collisionRadius)) this.player.y = previousY;
      if (this.collidesWithObstacle(this.player.x, this.player.y, this.player.collisionRadius)) {
        this.player.x = previousX;
        this.player.y = previousY;
      }
    }
    this.updateVision();

    // v3.4 地图危险区（坑/泥/毒雾）
    if (this.hazardZones) {
      for (const hz of this.hazardZones) {
        const d = dist(this.player, hz);
        if (d < hz.r) {
          if (hz.type === 'mud') {
            terrainModifier = Math.min(terrainModifier, hz.slow);
          } else if (hz.type === 'pit' || hz.type === 'poison') {
            hz.tick = (hz.tick || 0) + dt;
            if (hz.tick >= 0.8) {
              hz.tick = 0;
              this.damagePlayer(hz.damage, { cause: hz.type });
            }
          }
        }
      }
    }
    // v3.4 时空裂隙：传送门
    if (this.teleporters && this.teleporters.length >= 2) {
      for (let i = 0; i < this.teleporters.length; i++) {
        const tp = this.teleporters[i];
        tp.cd = Math.max(0, tp.cd - dt);
        if (tp.cd > 0) continue;
        if (dist(this.player, tp) < tp.r) {
          const j = (i + 1 + randInt(0, this.teleporters.length - 2)) % this.teleporters.length;
          this.player.x = this.teleporters[j].x;
          this.player.y = this.teleporters[j].y;
          this.teleporters[j].cd = 2.0;
          tp.cd = 2.0;
          showToast('✨ 时空传送！', 'info');
        }
      }
    }

    // 能量恢复
    this.player.energy = Math.min(this.player.maxEnergy, this.player.energy + CONFIG.player.energyRegen * dt);

    // 计时器
    this.player.attackCd = Math.max(0, this.player.attackCd - dt);
    this.player.invuln = Math.max(0, this.player.invuln - dt);
    this.player.stealth = Math.max(0, this.player.stealth - dt);
    // v3.8 脚印衰减 + 走路留印
    if (this.footprints) {
      for (const f of this.footprints) f.life -= dt;
    }
    if (Math.hypot(this.player.vx || 0, this.player.vy || 0) > 50) {
      this._footTimer = (this._footTimer || 0) - dt;
      if (this._footTimer <= 0) {
        this.addFootprint(this.player.x + (Math.random()-0.5)*8, this.player.y + 6);
        // v3.9 走路扬尘
        this.particles.push({
          x: this.player.x + (Math.random()-0.5)*10,
          y: this.player.y + 6,
          vx: (Math.random()-0.5)*20,
          vy: -20 - Math.random()*15,
          life: 0.5, maxLife: 0.5,
          size: 3 + Math.random()*3,
          color: 'rgba(140,120,90,0.5)',
          grav: 60, drag: 2
        });
        this._footTimer = 0.25;
      }
    }
    // v3.8 本局高光统计
    const rs = this.runStats;
    if (rs) {
      const distFromSpawn = Math.hypot(this.player.x - this.spawnX, this.player.y - this.spawnY);
      if (distFromSpawn > rs.maxDistFromSpawn) rs.maxDistFromSpawn = distFromSpawn;
      const hpPct = this.player.hp / (this.player.maxHp || 100) * 100;
      if (hpPct < rs.minHpSeen) rs.minHpSeen = hpPct;
      if (hpPct < 25) rs.nearDeathCount++;
    }
    // v3.7 高草隐身 + 骷髅/推车拾取
    if (this.props) {
      let inGrass = false;
      this.props.forEach(pr => {
        const d = Math.hypot(pr.x - this.player.x, pr.y - this.player.y);
        if (pr.kind === 'grass' && d < pr.size/2) inGrass = true;
        // 骷髅：走近给临时武器/材料
        if (pr.kind === 'skeleton' && !pr.looted && d < 40) {
          pr.looted = true;
          // 50% 给材料，50% 给临时武器
          if (Math.random() < 0.5) {
            this.spawnGroundLoot({ type: 'material', id: 'iron', matId: 'iron', name: '铁块', amount: randInt(2,5), icon: '⚙️' }, pr.x, pr.y);
          } else {
            this.spawnGroundLoot({ type: 'gold', name: '金币', amount: randInt(20,50), icon: '💰' }, pr.x, pr.y);
          }
          this.spawnAoeEffect(pr.x, pr.y, 40, '#cccccc');
          showToast('💀 搜刮了一具骷髅', 'gold');
        }
        // 推车：走近给材料
        if (pr.kind === 'cart' && !pr.looted && d < 50) {
          pr.looted = true;
          this.spawnGroundLoot({ type: 'material', id: 'herb', matId: 'herb', name: '草药', amount: randInt(1,3), icon: '🌿' }, pr.x, pr.y);
          this.spawnGroundLoot({ type: 'gold', name: '金币', amount: randInt(10,30), icon: '💰' }, pr.x + 20, pr.y);
          this.spawnAoeEffect(pr.x, pr.y, 50, '#c5a75d');
          showToast('🛒 翻倒的推车里有物资', 'success');
        }
      });
      if (inGrass) this.player.stealth = Math.max(this.player.stealth, 0.5);
    }
    this.player.slow = Math.max(0, this.player.slow - dt);
    this.weaponPulse = Math.max(0, this.weaponPulse - dt);
    this.attackAnim = Math.max(0, this.attackAnim - dt);
    this.weaponRecoil = Math.max(0, this.weaponRecoil - dt * 9);
    this.playerDamageFlash = Math.max(0, this.playerDamageFlash - dt * 3.2);
    this.critFlash = Math.max(0, this.critFlash - dt * 6);
    this.screenShake = Math.max(0, this.screenShake - dt * 4.5);
    this.player.visualZ = Math.max(0, this.player.visualZ + this.player.visualVz * dt);
    this.player.visualVz -= 360 * dt;
    if (this.player.visualZ <= 0) { this.player.visualZ = 0; this.player.visualVz = 0; }
    this.monsters.forEach(monster => {
      monster.deathTimer = Math.max(0, (monster.deathTimer || 0) - dt);
      monster.visualZ = Math.max(0, (monster.visualZ || 0) + (monster.visualVz || 0) * dt);
      monster.visualVz = (monster.visualVz || 0) - 330 * dt;
      if (monster.visualZ <= 0) { monster.visualZ = 0; monster.visualVz = 0; }
      // 受击击退：位移 + 衰减
      if (monster.knockX || monster.knockY) {
        monster.x += (monster.knockX || 0) * dt;
        monster.y += (monster.knockY || 0) * dt;
        const kd = Math.max(0, 1 - 9 * dt);
        monster.knockX *= kd; monster.knockY *= kd;
        if (Math.abs(monster.knockX) < 1 && Math.abs(monster.knockY) < 1) { monster.knockX = 0; monster.knockY = 0; }
      }
    });
    for (let i = 0; i < 4; i++) {
      this.skillCooldowns[i] = Math.max(0, this.skillCooldowns[i] - dt * (1 + this._getCropBuffMult('cooldown_reduction')));
      this.skillFlashes[i] = Math.max(0, this.skillFlashes[i] - dt);
    }
    Object.keys(this.consumableFlashes).forEach(id => {
      this.consumableFlashes[id] = Math.max(0, this.consumableFlashes[id] - dt);
    });

    // 环境陷阱
    this.traps.forEach(trap => {
      trap.triggerCd = Math.max(0, trap.triggerCd - dt);
      trap.phase += dt;
      if (trap.triggerCd <= 0 && dist(this.player, trap) < trap.radius) {
        trap.triggerCd = trap.cooldown;
        if (this.player.invuln <= 0) this.player.slow = Math.max(this.player.slow, trap.slow);
        this.damagePlayer(trap.damage + Math.max(0, this.map.tier - 1) * 2);
        this.spawnAoeEffect(trap.x, trap.y, trap.radius, trap.color);
        showToast(`触发陷阱：${trap.name}！`, 'warning');
      }
    });
    if (this.gameOver) return;

    // 鼠标持续攻击
    if (this.mouse.down) this.playerAttack();

    // 摄像机跟随
    const lookX = clamp(this.mouse.x - CONFIG.canvas.width / 2, -260, 260) * 0.16;
    const lookY = clamp(this.mouse.y - CONFIG.canvas.height / 2, -180, 180) * 0.11;
    const shakeX = this.screenShake > 0 ? rand(-1, 1) * this.screenShake * 8 : 0;
    const shakeY = this.screenShake > 0 ? rand(-1, 1) * this.screenShake * 5 : 0;
    const cameraTargetX = clamp(this.player.x - CONFIG.canvas.width / 2 + lookX + shakeX, 0, size - CONFIG.canvas.width);
    const cameraTargetY = clamp(this.player.y - CONFIG.canvas.height / 2 + lookY + shakeY, 0, size - CONFIG.canvas.height);
    this.camera.x = lerp(this.camera.x, cameraTargetX, 0.07);
    this.camera.y = lerp(this.camera.y, cameraTargetY, 0.07);

    // 怪物AI
    this.monsters.forEach(m => {
      if (m.hp <= 0) return;
      m.attackCd = Math.max(0, m.attackCd - dt);
      m.attackAnim = Math.max(0, (m.attackAnim || 0) - dt);
      m.stunned = Math.max(0, m.stunned - dt);
      m.hitFlash = Math.max(0, (m.hitFlash || 0) - dt);
      m.slow = Math.max(0, (m.slow || 0) - dt * 0.8);
      m.stateTimer = Math.max(0, (m.stateTimer || 0) - dt);
      m.animTime = (m.animTime || 0) + dt * (1.8 + m.speed / 120);
      this.updateBurn(m, dt);
      // v2.0 镰刀Lv10 割裂：流血DOT
      if (m.bleedUntil && performance.now() < m.bleedUntil && m.hp > 0) {
        m.bleedTick = (m.bleedTick || 0) - dt;
        if (m.bleedTick <= 0) {
          m.bleedTick = 0.5;
          const stacks = Math.min(m.bleedStack || 1, 5);
          this.damageEnemy(m, 3 * stacks, '#cc3344', false, { quiet: true, crit: false });
        }
      } else if (m.bleedUntil) { m.bleedUntil = 0; m.bleedStack = 0; }
      // v3.3 攻击前摇（telegraph）
      if (m.windupT > 0) {
        m.windupT -= dt;
        m.animTime += dt * 0.6;
        if (m.windupT <= 0) {
          // 前摇结束，真正出手
          const wa = m.windupAngle || 0;
          if (m.windupKind === 'ranged') {
            const p = this.allocProjectile();
            Object.assign(p, { x: m.x, y: m.y, vx: Math.cos(wa) * 320, vy: Math.sin(wa) * 320, damage: m.damage, life: 2, fromMonster: true, radius: 6, monsterType: m.type, color: m.type === 'spider' ? '#9bea55' : '#ff6644' });
            p.hit = p.hit || []; p.hit.length = 0;
            this.projectiles.push(p);
            m.attackAnim = 0.3;
          } else if (m.windupKind === 'bomb') {
            this.explodeBomber(m);
          } else {
            if (m.type === 'boss') { m.attackAnim = 0.34; this.spawnSlashEffect(m.x + Math.cos(wa) * 46, m.y, wa, '#ffd9a0', 62); }
            if (m.windupTarget === 'plant' && m.windupPlant && m.windupPlant.hp > 0) {
              this.damagePlant(m.windupPlant, m.damage);
            } else {
              this.damagePlayer(m.damage);
              if (typeof DifficultySystem !== 'undefined') DifficultySystem.applyPoison(m, this);
            }
          }
          m.windupT = 0; m.windupKind = null; m.windupPlant = null;
        }
        return; // 前摇期间不移动
      }
      // v2.0 减速到期
      if (m.slowUntil && performance.now() > m.slowUntil) { m.slow = 0; m.slowUntil = 0; }
      const slowMul = m.slow > 0 ? clamp(1 - m.slow, 0.35, 1) : 1;
      if (m.stunned > 0) return;

      const d = dist(m, this.player);
      const canSee = this.beastWave.active || (this.player.stealth <= 0 && d < 400);

      // v3.7 巡逻队 AI：玩家不在视野内时沿路线走
      if (m.patrolRoute && !this.beastWave.active) {
        const aggroRange = 250;
        if (d < aggroRange && this.player.stealth <= 0) {
          // 发现玩家，进入追击
          m.state = 'chase';
          m.lostPlayerTimer = 0;
        } else if (m.state === 'chase') {
          // 追了一阵但玩家跑远了
          m.lostPlayerTimer = (m.lostPlayerTimer || 0) + dt;
          if (m.lostPlayerTimer > 3) {
            m.state = 'patrol';
            // 回到最近的巡逻点
            let nearest = 0, nd = 1e9;
            m.patrolRoute.forEach((wp, i) => {
              const dd = Math.hypot(wp.x - m.x, wp.y - m.y);
              if (dd < nd) { nd = dd; nearest = i; }
            });
            m.patrolWpIndex = nearest;
          }
        }
        if (m.state === 'patrol') {
          // 沿巡逻路线走
          const wp = m.patrolRoute[m.patrolWpIndex];
          const dx = wp.x + (m.patrolOffset || 0) - m.x;
          const dy = wp.y + (m.patrolOffset || 0) - m.y;
          const dd = Math.hypot(dx, dy);
          if (dd < 20) {
            // 到达当前点，去下一个
            m.patrolWpIndex = (m.patrolWpIndex + 1) % m.patrolRoute.length;
            m.state = 'idle';
            m.stateTimer = 0.5 + Math.random() * 0.5;
          } else {
            const ang = Math.atan2(dy, dx);
            m.facing = ang;
            // 巡逻速度 60%
            const spd = m.speed * slowMul * 0.6;
            this.moveEntityWithCollisions(m, Math.cos(ang) * spd * dt, Math.sin(ang) * spd * dt);
          }
          return; // 巡逻时不触发普通追击 AI
        }
      }

      // 反制兵种（食草兽/厚甲猪）优先攻击植物防线
      let plantTarget = null, plantDist = 0;
      if (m.plantHate) {
        plantDist = 280;
        this.plants.forEach(p => {
          const dd = dist(m, p);
          if (dd < plantDist) { plantDist = dd; plantTarget = p; }
        });
      }

      if (canSee && !plantTarget && m.aiType && m.aiType !== 'chaser' && m.type !== 'boss') {
        if (typeof CombatEnhancement !== 'undefined') CombatEnhancement.updateMonsterAI(m, dt);
        return;
      }
      if (canSee && plantTarget) {
        // 攻击植物
        const pa = Math.atan2(plantTarget.y - m.y, plantTarget.x - m.x);
        m.facing = pa;
        if (plantDist > m.attackRange) {
          m.state = 'move';
          this.moveEntityWithCollisions(m, Math.cos(pa) * m.speed * slowMul * dt, Math.sin(pa) * m.speed * slowMul * dt);
        } else if (m.attackCd <= 0) {
          m.attackCd = m.attackCooldown;
          m.windupT = 0.35; m.windupDur = 0.35; m.windupAngle = pa; m.windupKind = 'melee'; m.windupTarget = 'plant'; m.windupPlant = plantTarget;
          m.state = 'windup';
        } else {
          m.state = 'idle';
        }
      } else if (canSee) {
        // 追击
        const angle = Math.atan2(this.player.y - m.y, this.player.x - m.x);
        m.facing = angle;
        if (d > m.attackRange) {
          m.state = 'move';
          this.moveEntityWithCollisions(m, Math.cos(angle) * m.speed * slowMul * dt, Math.sin(angle) * m.speed * slowMul * dt);
        } else if (m.attackCd <= 0) {
          m.attackCd = m.attackCooldown;
          let wdur = 0.35, wkind = 'melee';
          if (m.ranged) { wdur = 0.5; wkind = 'ranged'; }
          else if (m.aiType === 'bomber' || m.aiType === 'self_destruct' || m.type === 'bomber') { wdur = 1.2; wkind = 'bomb'; }
          else if (m.aiType === 'charger' || m.aiType === 'charge') { wdur = 0.6; wkind = 'melee'; }
          else if (m.type === 'boss') { wdur = 0.8; wkind = 'melee'; }
          m.windupT = wdur; m.windupDur = wdur; m.windupAngle = angle; m.windupKind = wkind; m.windupTarget = 'player';
          m.state = 'windup';
        } else {
          m.state = 'idle';
        }
      } else {
        // 游荡
        if (!m.wanderTarget || dist(m, m.wanderTarget) < 30) {
          m.wanderTarget = { x: m.x + rand(-200, 200), y: m.y + rand(-200, 200) };
        }
        const angle = Math.atan2(m.wanderTarget.y - m.y, m.wanderTarget.x - m.x);
        m.facing = angle;
        this.moveEntityWithCollisions(m, Math.cos(angle) * m.speed * 0.3 * slowMul * dt, Math.sin(angle) * m.speed * 0.3 * slowMul * dt);
      }
    });

    this.resolveUnitCollisions();

    // 移除死亡怪物
    this.monsters = this.monsters.filter(m => {
      if (m.hp <= 0) {
        if (m.deathProcessed) return m.deathTimer > 0;
        m.deathProcessed = true;
        m.deathTimer = .42;
        m.state = 'death';
        this.killCount++;
        if (this.runStats) {
          if (m.elite) this.runStats.eliteKills++;
          if (m.boss) this.runStats.bossKills++;
          if (this.player.hp / (this.player.maxHp || 100) < 0.25) this.runStats.clutchKills++;
        }
        this.spawnKillFeedback(m);
        this.spawnHitParticles(m.x, m.y, '#ff8868');
        if (typeof CombatEnhancement !== 'undefined') CombatEnhancement.onEliteDeath(m);
        // 击杀掉落养分（普通+2 / 精英+8）
        const nutrientGain = m.elite ? CONFIG.nutrients.eliteKill : CONFIG.nutrients.normalKill;
        this.nutrient = Math.min(this.nutrientMax, this.nutrient + nutrientGain);
        this.damageNumbers.push({ x: m.x, y: m.y - 22, value: `+${nutrientGain}`, color: '#ffe28a', life: .6, maxLife: .6, vx: 0, vy: -42, heavy: false });
        if (m.type === 'boss') {
          this.spawnGroundLoot({ type: 'material', name: '首领核心', amount: 2 + this.map.tier, icon: '◆' }, m.x + 18, m.y);
          this.spawnGroundLoot({ type: 'gold', name: '首领赏金', amount: 150 * this.map.tier, icon: '💰' }, m.x - 18, m.y);
          showToast(`首领「${m.name}」已击败，撤离奖励提升`, 'success');
          if (typeof AchievementSystem !== 'undefined') AchievementSystem.trackEvent('boss', 't'+this.map.tier);
          // v1.0 Boss 掉蓝图/高级材料
          this.spawnGroundLoot({ type: 'material', name: 'Boss獠牙', amount: 1, icon: '🦷', matId: 'bossFang' }, m.x, m.y+15);
          this.boss = null;
        }
        // v2.0 法杖Lv7 击杀小爆炸
        if (this.weapon && this.weapon.explosionOnKill) {
          [...this.monsters, ...this.raiders].forEach(o => {
            if (o === m || o.hp <= 0) return;
            if (dist(o, m) < 60) this.damageEnemy(o, this.weapon.damage * 0.8, '#c9a7e8', false, { quiet: true });
          });
          this.spawnImpact(m.x, m.y, '#c9a7e8', 1.3);
        }
        // v2.0 法杖Lv10 瘟疫：带毒标记的怪死亡释放毒雾
        if (m.plagueMark) {
          [...this.monsters, ...this.raiders].forEach(o => {
            if (o === m || o.hp <= 0) return;
            if (dist(o, m) < 80) {
              this.applyBurn(o, 12, 2.5);
              o.slow = Math.max(o.slow || 0, 0.4);
            }
          });
          this.spawnImpact(m.x, m.y, '#8a4ad8', 1.8);
        }
        // v1.0 击杀计数成就
        if (typeof AchievementSystem !== 'undefined') AchievementSystem.trackEvent('kill');
        // 掉落 v1.6 丰富
        if (Math.random() < 0.5) {
          this.spawnGroundLoot({ type: 'gold', name: '金币', amount: (m.gold || 5) + randInt(0, 5), icon: '💰' }, m.x, m.y);
        }
        const dropTable = [
          { type: 'consumable', name: '草药包', id: 'herb_kit', icon: '💊', weight: 0.15 },
          { type: 'consumable', name: '信号弹', id: 'signal_flare', icon: '🔥', weight: 0.08 },
          { type: 'consumable', name: '荆棘狂潮', id: 'thorn_storm', icon: '🌵', weight: 0.06 },
          { type: 'material', name: '硬木', matId: 'wood', icon: '🪵', amount: randInt(1,2), weight: 0.25 },
          { type: 'material', name: '铁块', matId: 'iron', icon: '⛓️', amount: randInt(1,3), weight: 0.2 },
          { type: 'material', name: '灵晶', matId: 'crystal', icon: '💎', amount: 1, weight: 0.08 }
        ];
        for (const d of dropTable) {
          if (Math.random() < d.weight) {
            this.spawnGroundLoot({ type: d.type, name: d.name, icon: d.icon, id: d.id, matId: d.matId, amount: d.amount||1 }, m.x + rand(-15,15), m.y + rand(-15,15));
          }
        }
        if (m.elite) {
          if (Math.random() < 0.5) this.spawnGroundLoot({ type: 'gold', name: '精英赏金', amount: randInt(30,80), icon: '💰' }, m.x, m.y-10);
          if (Math.random() < 0.3) this.spawnGroundLoot({ type: 'material', name: '灵晶', amount: randInt(1,2), icon: '💎', matId: 'crystal' }, m.x+10, m.y+10);
        }
        // v1.0 精英/Boss 掉临时武器
        if (m.elite && Math.random() < 0.5 && typeof LoadoutSystem !== 'undefined') {
          const _base = CONFIG.weapons[Math.floor(Math.random() * 3)];
          const _tw = LoadoutSystem.rollTempWeapon(_base, this.map.tier);
          this.spawnGroundLoot({ type: 'weapon_drop', name: _tw.name, icon: '🔨', weapon: _tw }, m.x, m.y-15);
        }
        if (m.type !== 'boss' && Math.random() < 0.055) {
          this.spawnGroundLoot({ type: 'invincible', name: '无敌核心', amount: 1, icon: '🛡️', duration: 5 }, m.x, m.y);
        }
        // v3.1 极低概率掉特殊作物种子（精英/Boss 更高）
        const seedChance = m.elite ? 0.08 : (m.type === 'boss' ? 0.5 : 0.012);
        if (Math.random() < seedChance && CONFIG.wildPlants) {
          const pool = CONFIG.wildPlants.filter(w => w.tier <= this.map.tier);
          const wp = pool[Math.floor(Math.random() * pool.length)];
          if (wp) {
            GameState.seeds = GameState.seeds || {};
            if (typeof GameState.seeds !== 'object' || GameState.seeds === null) GameState.seeds = {};
            GameState.seeds[wp.givesSeed] = (GameState.seeds[wp.givesSeed] || 0) + 1;
            this.spawnGroundLoot({ type: 'seed_pickup', name: wp.name + '种子', icon: wp.icon, seedId: wp.givesSeed, amount: 1 }, m.x, m.y);
            showToast(`🌟 稀有掉落：${wp.name}种子！`, 'gold');
          }
        }
        return true;
      }
      return true;
    });

    // AI掠夺者
    this.raiders.forEach(r => {
      if (r.hp <= 0) return;
      r.attackCd = Math.max(0, r.attackCd - dt);
      r.stunned = Math.max(0, (r.stunned || 0) - dt);
      if (r.knockX || r.knockY) {
        r.x += (r.knockX || 0) * dt;
        r.y += (r.knockY || 0) * dt;
        const kd = Math.max(0, 1 - 9 * dt);
        r.knockX *= kd; r.knockY *= kd;
      }
      if (r.stunned > 0) return;
      const d = dist(r, this.player);

      if (d < 300 && this.player.stealth <= 0) {
        // 攻击玩家
        const angle = Math.atan2(this.player.y - r.y, this.player.x - r.x);
        if (d > 150) {
          r.x += Math.cos(angle) * r.speed * dt;
          r.y += Math.sin(angle) * r.speed * dt;
        } else if (r.attackCd <= 0) {
          r.attackCd = 1.5;
          const p = this.allocProjectile();
          Object.assign(p, {
            x: r.x, y: r.y,
            vx: Math.cos(angle) * 250, vy: Math.sin(angle) * 250,
            damage: r.damage, life: 2, fromMonster: true, radius: 6
          });
          p.hit = p.hit || []; p.hit.length = 0;
          this.projectiles.push(p);
        }
      } else {
        // 巡逻
        if (dist(r, r.patrolTarget) < 30) {
          r.patrolTarget = { x: rand(200, size-200), y: rand(200, size-200) };
        }
        const angle = Math.atan2(r.patrolTarget.y - r.y, r.patrolTarget.x - r.x);
        r.x += Math.cos(angle) * r.speed * 0.5 * dt;
        r.y += Math.sin(angle) * r.speed * 0.5 * dt;
      }
    });
    this.raiders = this.raiders.filter(r => {
      if (r.hp <= 0) {
        this.killCount++;
        showToast('击败掠夺者！战利品已掉落', 'gold');
        for (let i = 0; i < r.loot; i++) {
          this.spawnGroundLoot({ type: 'gold', name: '金币', amount: randInt(20, 50), icon: '💰' }, r.x, r.y);
        }
        return false;
      }
      return true;
    });

    // 防御塔
    this.towers.forEach(t => {
      if (t.state === 'broken') return;
      t.attackCd = Math.max(0, t.attackCd - dt);
      if (t.attackCd > 0) return;

      if (t.state === 'player') {
        // 攻击怪物
        let nearest = null, minD = t.range;
        this.entitySpatialHash.queryCircle(t.x, t.y, t.range).forEach(m => {
          if (!this.monsters.includes(m)) return;
          const d = dist(t, m);
          if (d < minD) { minD = d; nearest = m; }
        });
        this.raiders.forEach(r => {
          const d = dist(t, r);
          if (d < minD) { minD = d; nearest = r; }
        });
        if (nearest) {
          this.damageEnemy(nearest, t.damage * (this.beastWave.active ? 2.15 : 1), '#8affb5', false, {
            x: t.x, y: t.y, angle: Math.atan2(nearest.y - t.y, nearest.x - t.x),
            weaponId: '', fromPlayer: false
          });
          t.attackCd = this.beastWave.active ? 0.42 : 0.72;
          const p = this.allocProjectile();
          Object.assign(p, {
            x: t.x, y: t.y,
            vx: (nearest.x - t.x) / minD * 400,
            vy: (nearest.y - t.y) / minD * 400,
            damage: 0, life: 0.3, fromTower: true, radius: 4, target: nearest
          });
          p.hit = p.hit || []; p.hit.length = 0;
          this.projectiles.push(p);
        }
      } else if (t.state === 'enemy') {
        // 攻击玩家
        if (dist(t, this.player) < t.range) {
          this.damagePlayer(t.damage);
          t.attackCd = 1.0;
        }
      }
    });

    // 子弹：原地更新 + 空间哈希邻近命中（消灭全量遍历与每帧 filter 数组）
    {
      const arr = this.projectiles;
      const hash = this.entitySpatialHash;
      for (let i = arr.length - 1; i >= 0; i--) {
        const p = arr[i];
        // v2.0 飞刃Lv10 自动追踪
        if (p.autoAim && p.fromPlayer && !p._aimInit) {
          const near = this.nearestMonster(p.x, p.y, 600);
          if (near) {
            const a = Math.atan2(near.y - p.y, near.x - p.x);
            const sp = Math.hypot(p.vx, p.vy);
            p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp;
          }
          p._aimInit = true;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
        let dead = p.life <= 0;
        // v3.7 弹道打道具（油桶/木箱）
        if (!dead && p.fromPlayer && this.props) {
          for (const pr of this.props) {
            if ((pr.kind === 'barrel' || pr.kind === 'crate') && pr.hp > 0) {
              const dx = pr.x - p.x, dy = pr.y - p.y;
              const rr = pr.size/2 + p.radius;
              if (dx*dx + dy*dy <= rr*rr) {
                this.damageProp(pr, p.damage);
                dead = true;
                break;
              }
            }
          }
        }
        if (!dead && (p.fromPlayer || p.fromPlant)) {
          const candidates = hash.queryCircle(p.x, p.y, 56);
          for (let c = 0; c < candidates.length; c++) {
            const target = candidates[c];
            if (target.hp <= 0 || p.hit.includes(target)) continue;
            const ddx = target.x - p.x, ddy = target.y - p.y;
            const rr = target.radius + p.radius;
            if (ddx * ddx + ddy * ddy <= rr * rr) {
              // v2.0 豌豆Lv10 夺命豆：直接斩杀30%血以下小怪
              if (p.instantKillLow && !target.elite && target.type !== 'boss' && target.hp < target.maxHp * p.instantKillLow) {
                target.hp = 0; target.state = 'death'; target.stateTimer = 0.4;
              } else {
                this.damageEnemy(target, p.damage, p.color, p.weaponId === 'vine_staff', {
                  x: p.x, y: p.y,
                  angle: Math.atan2(p.vy, p.vx),
                  weaponId: p.weaponId || '',
                  fromPlayer: !!p.fromPlayer
                });
              }
              target.visualVz = Math.max(target.visualVz || 0, p.weaponId === 'vine_staff' ? 82 : 52);
              // v2.0 等级词条：燃烧/减速/定身
              if (p.burnDps) {
                const stack = Math.min(p.burnStack || 1, 3);
                this.applyBurn(target, p.burnDps * stack, 3);
              }
              if (p.slowOnHit) { target.slow = Math.max(target.slow || 0, p.slowOnHit); target.slowUntil = performance.now() + p.slowDur * 1000; }
              if (p.rootChance && Math.random() < p.rootChance) { target.stunned = Math.max(target.stunned || 0, p.rootDur); }
              // v2.0 法杖Lv10 瘟疫：怪死后毒雾
              if (p.plague) target.plagueMark = true;
              // v2.0 烈焰长弓Lv5 爆炸
              if (p.explode) {
                [...this.monsters, ...this.raiders].forEach(o => {
                  if (o === target || o.hp <= 0) return;
                  if (dist(o, target) < p.explode) this.damageEnemy(o, p.damage * 0.6, '#ffaa55', false, { quiet: true });
                });
                this.spawnImpact(target.x, target.y, '#ff8833', 1.6);
              }
              // v2.0 长弓Lv8 火箭雨：命中召3支落箭
              if (p.rainArrows) {
                for (let k = 0; k < p.rainArrows; k++) {
                  const rx = target.x + rand(-40, 40), ry = target.y + rand(-40, 40);
                  this.aoeTimers.push({ x: rx, y: ry, r: 55, delay: 0.35 + k * 0.12, dmg: p.damage * 0.5, color: '#ffcc55' });
                }
              }
              // v2.0 长弓Lv10 核爆
              if (p.nuke) {
                [...this.monsters, ...this.raiders].forEach(o => {
                  if (o.hp <= 0) return;
                  if (dist(o, target) < 120) this.damageEnemy(o, p.damage * 1.5, '#ff5522', false, { quiet: true });
                });
                this.spawnImpact(target.x, target.y, '#ff3300', 2.5);
              }
              p.hit.push(target);
              p.pierce--;
              if (p.weaponId === 'vine_staff') {
                target.stunned = Math.max(target.stunned || 0, 0.18);
                this.lightningChainFrom(target, p, p.hit, 2, 0.55);
              }
              if (p.pierce <= 0) { dead = true; break; }
              if (p.fromPlant) { dead = true; break; }
            }
          }
        }
        if (!dead && p.fromMonster) {
          const ddx = this.player.x - p.x, ddy = this.player.y - p.y;
          const rr = this.player.collisionRadius + p.radius;
          if (ddx * ddx + ddy * ddy <= rr * rr) {
            this.damagePlayer(p.damage);
            dead = true;
          }
        }
        if (dead) {
          // v2.0 飞刃Lv5 弹道回旋：死前弹向最近敌人
          if (p.ricochet > 0 && p.fromPlayer) {
            const near = this.nearestMonster(p.x, p.y, 400);
            if (near) {
              const a = Math.atan2(near.y - p.y, near.x - p.x);
              const sp = Math.hypot(p.vx, p.vy);
              p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp;
              p.life = 0.35; p.ricochet--; p.hit.length = 0;
              dead = false;
            }
          }
        }
        if (dead) {
          arr[i] = arr[arr.length - 1];
          arr.pop();
          this.projectilePool.push(p);
        }
      }
    }

    // v2.0 长弓Lv8 延迟落箭（aoeTimers）
    if (this.aoeTimers) {
      for (let i = this.aoeTimers.length - 1; i >= 0; i--) {
        const t = this.aoeTimers[i];
        t.delay -= dt;
        if (t.delay <= 0) {
          [...this.monsters, ...this.raiders].forEach(o => {
            if (o.hp <= 0) return;
            if (dist(o, t) < t.r) this.damageEnemy(o, t.dmg, t.color, false, { quiet: true });
          });
          this.spawnImpact(t.x, t.y, t.color, 1.2);
          this.aoeTimers.splice(i, 1);
        }
      }
    }

    // 粒子：原地紧凑，死亡粒子回收到对象池（消灭每帧 filter 新数组）
    {
      const arr = this.particles;
      let w = 0;
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i];
        p.life -= dt;
        if (p.life <= 0) { this.particlePool.push(p); continue; }
        if (!STATIC_SHAPE_TYPES.has(p.type)) { p.x += p.vx * dt; p.y += p.vy * dt; }
        if (p.grav) p.vy += p.grav * dt;
        if (p.drag) { const d = Math.max(0, 1 - p.drag * dt); p.vx *= d; p.vy *= d; }
        if (p.spin) p.rot = (p.rot || 0) + p.spin * dt;
        arr[w++] = p;
      }
      arr.length = w;
      if (this.fxParticles) for (const p of this.fxParticles) p.life -= dt;
    }
    // 伤害跳字：原地紧凑
    {
      const arr = this.damageNumbers;
      let w = 0;
      for (let i = 0; i < arr.length; i++) {
        const n = arr[i];
        n.life -= dt;
        if (n.life <= 0) continue;
        n.x += n.vx * dt;
        n.y += n.vy * dt;
        n.vy += 72 * dt;
        arr[w++] = n;
      }
      arr.length = w;
    }
    this.killFlash = Math.max(0, this.killFlash - dt);

    // 撤离读条
    if (this.extracting) {
      if (this.extractType === 'fixed') {
        const inPoint = this.extractPoints.some(ep => dist(this.player, ep) < ep.radius);
        if (!inPoint) { this.cancelExtract(); showToast('离开了撤离点，撤离取消', 'warning'); }
      }
      const extractTime = this.extractType === 'signal' ? CONFIG.expedition.signalExtractTime : CONFIG.expedition.extractTime;
      if (this.extractType === 'signal' && !this.signalReinforced && this.extractProgress >= extractTime * 0.5) {
        this.signalReinforced = true;
        this.spawnSignalAmbush(1);
      }
      this.extractProgress += dt;
      if (this.extractProgress >= extractTime) {
        this.completeExtract();
      }
    }

    this.updateHUD();
  }

  damagePlayer(amount) {
    if (this.player.invuln > 0) return;
    if (typeof CombatEnhancement !== 'undefined' && CombatEnhancement.checkPerfectDodge()) return;
    const defendingTower = this.towers.find(t => t.state === 'player' && dist(t, this.player) <= t.range);
    if (this.beastWave.active) {
      amount *= defendingTower ? 0.38 : 1.45;
    } else if (defendingTower) {
      amount *= 0.76;
    }
    this.player.hp -= amount;
    this.player.hitStun = 0.15; // v3.3 受击硬直
    AudioManager.playPlayerHurt();
    this.damageTaken += amount;
    this.screenShake = Math.min(1, this.screenShake + 0.48);
    this.playerDamageFlash = 0.38;
    this.spawnHitParticles(this.player.x, this.player.y, '#ff4444');
    this.spawnShockRing(this.player.x, this.player.y, '#ff5544', 42);
    if (typeof CombatEnhancement !== 'undefined') {
      CombatEnhancement.onPlayerHit();
      const attacker = this.monsters.find(m => m.hp > 0 && Math.sqrt((m.x-this.player.x)**2+(m.y-this.player.y)**2) < 60);
      if (attacker) CombatEnhancement.onEliteHitPlayer(attacker);
    }
    if (this.extracting) this.cancelExtract();
    if (this.player.hp <= 0) {
      this.player.hp = 0;
      this.playerDeath();
    }
  }

  renderHero(ctx, sx, sy) {
    const angle = this.player.angle || 0;
    const moving = this.keys['w'] || this.keys['a'] || this.keys['s'] || this.keys['d'];
    const bob = moving ? Math.sin(this.elapsed * 12) * 2 : Math.sin(this.elapsed * 3) * 0.8;
    const swing = this.attackAnim > 0 ? Math.sin((1 - this.attackAnim / 0.24) * Math.PI) : 0;
    const facingLeft = Math.cos(angle) < 0;
    const lift = this.player.visualZ || 0;
    const depthScale = this.getDepthScale(this.player.y);
    this.renderCastShadow(ctx, this.player.x, this.player.y, 34 * depthScale, 44 * depthScale, 0.42, lift);
    ctx.save();
    ctx.translate(sx, sy + bob - lift);
    if (this.player.invuln > 0) {
      ctx.save();
      ctx.scale(1 / (0.6 * depthScale), 1 / (0.6 * depthScale));
      ctx.strokeStyle = `rgba(125,231,255,${0.55 + Math.sin(this.elapsed * 10) * .2})`;
      ctx.lineWidth = 3;
      ctx.shadowColor = '#7de7ff'; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.arc(0, 20, 34, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    ctx.scale(0.6 * depthScale, 0.6 * depthScale);
    if (facingLeft) ctx.scale(-1, 1);
    // v2.7 Seedream 主角贴图
    if (this.playerSprite && this.playerSprite.naturalWidth) {
      const psz = 150;
      const pdraw = psz * this.playerSprite.naturalHeight / this.playerSprite.naturalWidth;
      ctx.drawImage(this.playerSprite, -psz/2, -pdraw*0.82, psz, pdraw);
    } else {
      ctx.fillStyle = '#c84e2f'; ctx.beginPath(); ctx.arc(0, -47, 30, 0, Math.PI * 2); ctx.fill();
    }
    this.renderHeroWeapon(ctx, angle, swing, this.attackCombo, this.weaponRecoil);
    ctx.restore();
  }

  // v3.8 去黑底：把生成图的黑色背景变透明（缓存处理结果）
  drawNoBlack(ctx, img, dx, dy, dw, dh) {
    if ((img.src||'').includes('_t.png')) { ctx.drawImage(img, dx, dy, dw, dh); return; }
    if (!this._noBlackCache) this._noBlackCache = new Map();
    let processed = this._noBlackCache.get(img);
    if (!processed) {
      // 首次处理：把近黑像素变透明
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const cctx = c.getContext('2d');
      cctx.drawImage(img, 0, 0);
      try {
        const data = cctx.getImageData(0, 0, c.width, c.height);
        const px = data.data;
        for (let i = 0; i < px.length; i += 4) {
          const r = px[i], g = px[i+1], b = px[i+2];
          // 近黑像素（RGB 都 < 30）变透明
          if (r < 30 && g < 30 && b < 30) {
            px[i+3] = 0;
          } else if (r < 50 && g < 50 && b < 50) {
            // 边缘半透明过渡
            px[i+3] = Math.min(px[i+3], (r+g+b) / 150 * 255);
          }
        }
        cctx.putImageData(data, 0, 0);
      } catch(e) { /* 跨域时跳过 */ }
      processed = c;
      this._noBlackCache.set(img, processed);
    }
    ctx.drawImage(processed, dx, dy, dw, dh);
  }

  renderHeroWeapon(ctx, angle, swing, combo = 0, recoil = 0) {
    const dir = combo === 1 ? -1 : 1;
    ctx.save();
    // v3.8 武器放大+放到手上（原来 24,-10 太小太靠下）
    ctx.translate(28, -18 - recoil * 3);
    const targetRot = Math.atan2(Math.sin(angle), Math.cos(angle));
    ctx.rotate(targetRot + swing * 0.3 * dir);
    if (this.weaponSheet && this.weaponSheet.naturalWidth) {
      const sheetH = this.weaponSheet.naturalHeight;
      const slotH = sheetH / 5;
      const rowMap = { harvest_sickle: 0, pea_repeater: 1, vine_staff: 2, throwing_knife: 3, flame_bow: 4 };
      const row = rowMap[this.weapon.id] || 0;
      const sw = this.weaponSheet.naturalWidth, sh = slotH;
      const dw = 150, dh = dw * sh / sw;
      if (!this._weaponCache) this._weaponCache = {};
      let proc = this._weaponCache[this.weapon.id];
      if (!proc) {
        proc = document.createElement('canvas');
        proc.width = sw; proc.height = sh;
        const pctx = proc.getContext('2d');
        pctx.drawImage(this.weaponSheet, 0, row*slotH, sw, sh, 0, 0, sw, sh);
        if (!this.weaponSheetPrekeyed) {
          try {
            const data = pctx.getImageData(0, 0, sw, sh);
            const px = data.data;
            for (let i = 0; i < px.length; i += 4) {
              const r = px[i], g = px[i+1], b = px[i+2];
              const lum = 0.299*r + 0.587*g + 0.114*b;
              // 旧武器图是白底：去掉近白
              if (lum > 200) px[i+3] = 0;
              else if (lum > 170) px[i+3] = Math.min(px[i+3], (200 - lum) / 30 * 255);
            }
            pctx.putImageData(data, 0, 0);
          } catch(e) {}
        }
        this._weaponCache[this.weapon.id] = proc;
      }
      ctx.drawImage(proc, -dw/2, -dh/2, dw, dh);
    }
    ctx.restore();
  }

  renderNutrientCrystals(ctx, cam) {
    const nowSeconds = performance.now() / 1000;
    this.nutrientCrystals.forEach(c => {
      if (!this.isWorldVisible(c.x, c.y)) return;
      const sx = c.x - cam.x, sy = c.y - cam.y + Math.sin(nowSeconds * 3 + c.bob) * 4;
      const glow = ctx.createRadialGradient(sx, sy, 1, sx, sy, 20);
      glow.addColorStop(0, 'rgba(255,226,138,.5)'); glow.addColorStop(1, 'rgba(255,226,138,0)');
      ctx.fillStyle = glow; ctx.fillRect(sx - 22, sy - 22, 44, 44);
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(nowSeconds * 1.6 + c.bob);
      ctx.fillStyle = '#ffe28a'; ctx.strokeStyle = '#b8860b'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(8, 0); ctx.lineTo(0, 10); ctx.lineTo(-8, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    });
  }

  // v3.5 远征植物 id -> CropArt id 映射
  _plantArtId(type) {
    const map = {
      chili: 'chili', garlic: 'garlic', mint: 'mint', cactus: 'cactus',
      sun_flower: 'sunflower', sunflower: 'sunflower',
      vine: 'rosemary', pea_plant: 'pea', frost_vine: 'frost_flower',
      bind_flower: 'shadow_flower', sacred_tree: 'rainbow_flower',
      firegrass: 'fire_grass', frost: 'frost_flower', lightning: 'lightning_vine',
      shadow: 'shadow_flower', rainbow: 'rainbow_flower',
    };
    return map[type] || null;
  }

  renderPlants(ctx, cam, list) {
    const items = list || (this.plantsDirty || !this.plantsSorted
      ? (this.plantsSorted = [...this.plants].sort((a, b) => a.y - b.y), this.plantsDirty = false, this.plantsSorted)
      : this.plantsSorted);
    items.forEach(p => {
      if (!this.isWorldVisible(p.x, p.y)) return;
      const sx = p.x - cam.x, sy = p.y - cam.y;
      // 血条 + 寿命条
      const barW = 30, barY = sy - 30;
      ctx.fillStyle = 'rgba(8,10,12,.7)'; ctx.beginPath(); ctx.roundRect(sx - barW / 2 - 2, barY - 2, barW + 4, 7, 3); ctx.fill();
      ctx.fillStyle = '#7dff9a'; ctx.beginPath(); ctx.roundRect(sx - barW / 2, barY, barW * clamp(p.hp / p.maxHp, 0, 1), 3, 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,226,138,.85)'; ctx.beginPath(); ctx.roundRect(sx - barW / 2, barY + 5, barW * clamp(p.life / p.maxLife, 0, 1), 2, 1); ctx.fill();
      // 图标（受击闪烁）
      const flash = p.hitFlash > 0 ? (Math.floor(p.hitFlash * 20) % 2 ? 0.4 : 1) : 1;
      ctx.globalAlpha = flash;
      const pScale = this.getDepthScale(p.y);
      const drawSize = (p.type === 'ultimate' ? 44 : 34) * pScale;
      // v3.5 优先用真实贴图，失败回退 emoji
      const artId = this._plantArtId(p.type);
      const usedArt = (typeof CropArt !== 'undefined' && artId) ? CropArt.draw(ctx, artId, sx, sy, drawSize) : false;
      if (!usedArt) {
        ctx.font = `${(p.type === 'ultimate' ? 36 : 28) * pScale}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(p.icon, sx, sy + 9 * pScale);
      }
      ctx.globalAlpha = 1;
      // 攻击动画
      if (p.attackAnim > 0) {
        ctx.strokeStyle = '#a6ffc2'; ctx.lineWidth = 2;
        ctx.globalAlpha = (p.attackAnim / .2) * .8;
        ctx.beginPath(); ctx.arc(sx, sy, 20 + (1 - p.attackAnim / .2) * 14, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (p.starving) {
        ctx.fillStyle = '#ffd37a'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('养分枯竭', sx, sy - 36);
      }
    });
  }

  renderMissionHUD() {
    if (!this.objective) return;
    let panel = document.getElementById('missionHud');
    if (!panel) { panel = document.createElement('div'); panel.id = 'missionHud'; document.getElementById('expeditionHUD').appendChild(panel); }
    const objective = this.objective;
    const progress = Math.min(objective.progress, objective.target);
    const eventMarkup = this.activeEvent ? `<div class="mission-event" style="--event-color:${this.activeEvent.color}"><b>${this.activeEvent.name}</b><span>${Math.ceil(this.activeEvent.timeLeft)}s · ${this.activeEvent.text}</span></div>` : '<div class="mission-event dormant"><b>区域平静</b><span>探索可能触发地图事件</span></div>';
    const ownedTowers = this.towers.filter(t => t.state === 'player').length;
    const protectedByTower = this.towers.some(t => t.state === 'player' && dist(t, this.player) <= t.range);
    const waveMarkup = this.beastWave.active
      ? `<div class="wave-status active"><b>⚠ 第 ${this.beastWave.wave} 波兽潮</b><span>剩余 ${this.beastWave.remaining} 只 · 下一波 ${Math.ceil(this.beastWave.nextIn)}s · ${protectedByTower ? '防御塔护盾生效' : '未受保护，伤害提升'}</span></div>`
      : `<div class="wave-status"><b>兽潮预警 ${Math.ceil(this.beastWave.nextIn)}s</b><span>已占塔 ${ownedTowers} · 提前进入绿色射程</span></div>`;
    panel.innerHTML = `<div class="mission-label">远征任务</div><strong>${objective.title}${objective.complete ? ' · 已完成' : ''}</strong><span>${objective.description}</span><div class="mission-progress"><i style="width:${progress/objective.target*100}%"></i></div><small>${progress}/${objective.target}</small>${waveMarkup}${eventMarkup}${this.boss && this.boss.hp > 0 ? `<div class="boss-hud"><b>${this.boss.name}</b><span>阶段 ${this.boss.phase}</span><i style="width:${this.boss.hp/this.boss.maxHp*100}%"></i></div>` : ''}`;
  }

  updateHUD() {
    // 血条能量条
    document.getElementById('hpBar').style.width = (this.player.hp / this.player.maxHp * 100) + '%';
    document.getElementById('hpText').textContent = `${Math.ceil(this.player.hp)}/${this.player.maxHp}`;
    document.getElementById('energyBar').style.width = (this.player.energy / this.player.maxEnergy * 100) + '%';
    document.getElementById('energyText').textContent = `${Math.ceil(this.player.energy)}/${this.player.maxEnergy}`;
    // 养分
    const nb = document.getElementById('nutrientBar');
    const nt = document.getElementById('nutrientText');
    if (nb) nb.style.width = clamp(this.nutrient / this.nutrientMax, 0, 1) * 100 + '%';
    if (nt) nt.textContent = `${Math.floor(this.nutrient)}/${this.nutrientMax}`;

    // 计时器
    const mins = Math.floor(this.timeLeft / 60);
    const secs = Math.floor(this.timeLeft % 60);
    const timerEl = document.getElementById('timerDisplay');
    timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    timerEl.className = 'timer-display' + (this.timeLeft < 30 ? ' critical' : (this.timeLeft < 180 ? ' pressure' : ''));
    document.getElementById('mapNameDisplay').textContent = `T${this.map.tier} · ${this.map.name} · ${this.map.danger}`;
    document.getElementById('lowHealthVignette').classList.toggle('active', this.player.hp / this.player.maxHp <= 0.3);

    // 低频重量更新（250ms 节流）：任务面板/武器/技能/消耗品/背包/防线栏
    // 这些模块每帧 innerHTML 重建会强制布局并产生大量 DOM/GC 开销。
    this.hudTimer -= 1 / 60;
    if (this.hudTimer > 0) return;
    this.hudTimer = 0.25;
    this.renderMissionHUD();
    const weaponDisplay = document.getElementById('weaponDisplay');
    if (weaponDisplay) {
      weaponDisplay.style.setProperty('--weapon-color', this.weapon.color);
      const attackMode = this.weapon.mode === 'melee' ? '近战横扫' : (this.weapon.mode === 'ranged' ? '远程连射' : '贯穿灵波');
      weaponDisplay.innerHTML = `<span class="weapon-glyph">${this.weapon.icon}</span><div><b>${this.weapon.name}</b><small>${attackMode} · 伤害 ${this.weapon.damage}</small></div><kbd>Tab</kbd>`;
    }

    // 技能栏
    const skillBar = document.getElementById('skillBar');
    skillBar.innerHTML = '';
    CONFIG.skills.forEach((baseSkill, i) => {
      const skill = getSkillStats(baseSkill, this.skillBoosts[baseSkill.id] || 0);
      const cd = this.skillCooldowns[i];
      const div = document.createElement('div');
      const quality = skill.level >= 6 ? 'legendary' : (skill.level >= 3 ? 'rare' : 'common');
      div.className = `skill-slot quality-${quality}` + (cd <= 0 ? ' ready' : '') + (this.skillFlashes[i] > 0 ? ' casting' : '');
      div.style.setProperty('--skill-color', skill.color);
      div.title = skill.desc;
      const powerText = skill.damage > 0
        ? `⚔ ${skill.damage}`
        : (skill.stunDuration ? `控 ${skill.stunDuration}s` : (skill.dashDistance ? `移 ${skill.dashDistance}` : `隐 ${skill.stealthDuration}s`));
      const skillArt = (typeof CropArt !== 'undefined' && CropArt.ready(baseSkill.id)) ? CropArt.dom(baseSkill.id, skill.icon, 26) : skill.icon;
      div.innerHTML = `
        <span class="skill-key">${skill.key}</span>
        <span class="skill-icon">${skillArt}</span>
        <span class="skill-name">${skill.name} · Lv.${skill.level}${skill.extraLevels ? ` (+${skill.extraLevels})` : ''}</span>
        <div class="skill-meta"><span>${powerText}</span><span>⚡ ${skill.energyCost}</span><span>CD ${skill.cooldown}s</span></div>
        ${cd > 0 ? `<div class="skill-cd-ring" style="--progress:${clamp(cd / skill.cooldown, 0, 1)}"><span>${cd.toFixed(1)}</span></div>` : ''}
      `;
      skillBar.appendChild(div);
    });
    // 消耗品
    const consumableBar = document.getElementById('consumableBar');
    consumableBar.innerHTML = '';
    CONFIG.consumables.forEach(item => {
      const count = this.consumables[item.id] || 0;
      const div = document.createElement('div');
      div.className = 'skill-slot consumable' + (count > 0 ? ' ready' : '') + ((this.consumableFlashes[item.id] || 0) > 0 ? ' spent' : '');
      div.title = item.desc;
      const effectText = item.heal ? `治疗 ${item.heal}` : (item.damage ? `伤害 ${item.damage}` : '撤离 20s');
      const consArt = (typeof CropArt !== 'undefined' && CropArt.ready(item.id)) ? CropArt.dom(item.id, item.icon, 26) : item.icon;
      div.innerHTML = `
        <span class="skill-key">${item.key}</span>
        <span class="skill-icon">${consArt}</span>
        <span class="skill-name">${item.name}</span>
        <div class="skill-meta"><span>${effectText}</span><span>一次性</span></div>
        <span class="skill-count">×${count}</span>
      `;
      consumableBar.appendChild(div);
    });

    // 背包显示
    const bagDisplay = document.getElementById('bagDisplay');
    const gold = this.bag.filter(i => i.type === 'gold').reduce((s, i) => s + i.amount, 0);
    const seeds = this.bag.filter(i => i.type === 'seed_item' || i.type === 'seed' || i.type === 'plant_seed').reduce((s, i) => s + (i.amount || 1), 0);
    const safeCap = (typeof LoadoutSystem !== 'undefined') ? LoadoutSystem.getSafeCapacity() : 1;
    const coinArt = (typeof CropArt !== 'undefined' && CropArt.ready('coin')) ? CropArt.dom('coin', '💰', 18) : '💰';
    const pouchArt = (typeof CropArt !== 'undefined' && CropArt.ready('seed_pouch')) ? CropArt.dom('seed_pouch', '🌱', 18) : '🌱';
    bagDisplay.innerHTML = `
      <div class="bag-item">${coinArt} ${gold}</div>
      <div class="bag-item">${pouchArt} ${seeds}</div>
      <div class="bag-item">🎒 ${this.bag.length}件</div>
      <div class="bag-item" style="border-color:#d7a83d;color:#f2d078;">🔐 ${this.safeBox.length}/${safeCap}</div>
    `;

    // 防线槽（本局可部署植物）
    const defenseBar = document.getElementById('defenseBar');
    if (defenseBar) {
      const list = this.getPlantSeedList();
      defenseBar.innerHTML = list.length === 0
        ? `<div class="defense-slot empty">无防线种子 · 打开宝箱获取或出发前装备</div>`
        : list.map((p, i) => {
            const selected = this.selectedPlantId === p.id;
            const avail = p.maxPerRun - p.deployed;
            const pArt = (typeof CropArt !== 'undefined' && CropArt.ready(p.id)) ? CropArt.dom(p.id, p.icon, 26) : p.icon;
            return `<div class="defense-slot${selected ? ' selected' : ''}${avail <= 0 ? ' spent' : ''}" title="${p.name}：预扣养分${p.deployCost}，每${p.sustain}维持/s，寿命${p.life}s，本局可再种${avail}株">
              <span class="defense-key">${i + 5}</span><span class="defense-icon">${pArt}</span>
              <span class="defense-name">${p.name}</span><span class="defense-meta">养分${p.deployCost} · 剩余${avail}</span>
            </div>`;
          }).join('');
    }
  }

  render(ctx) {
    const cam = this.camera;
    const size = CONFIG.expedition.mapSize;
    if (this.activeEvent?.id === 'mist') {
      const fog = ctx.createRadialGradient(CONFIG.canvas.width/2, CONFIG.canvas.height/2, 150, CONFIG.canvas.width/2, CONFIG.canvas.height/2, 650);
      fog.addColorStop(0, 'rgba(190,215,220,.02)'); fog.addColorStop(.55, 'rgba(150,180,185,.18)'); fog.addColorStop(1, 'rgba(12,23,28,.72)');
      ctx.fillStyle=fog; ctx.fillRect(0,0,CONFIG.canvas.width,CONFIG.canvas.height);
    }
    // v3.5 植物改由下方 Y-sort 统一绘制（避免双绘）
    // this.renderPlants(ctx, cam);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (this.wildPlants) {
      for (const w of this.wildPlants) {
        if (w.picked) continue;
        const sx = w.x - cam.x, sy = w.y - cam.y;
        const artId = this._plantArtId(w.givesSeed || w.id);
        const used = (typeof CropArt !== 'undefined' && artId) ? CropArt.draw(ctx, artId, sx, sy, 30) : false;
        if (!used) {
          ctx.font = '24px serif';
          ctx.fillText(w.icon, sx, sy);
        }
      }
    }

    // 分层地形：道路、水域、田块、树林和地图专属地标。
    this.renderTerrain(ctx, cam);
    if (typeof WorldFX !== 'undefined') WorldFX.renderGround(ctx, this);
    // v3.8 脚印
    this.renderFootprints(ctx, cam);

    // 地图边界
    ctx.strokeStyle = this.map.accentColor;
    ctx.lineWidth = 4;
    ctx.globalAlpha = 0.82;
    ctx.strokeRect(-cam.x, -cam.y, size, size);
    ctx.globalAlpha = 1;

    if (this.paused) {
      ctx.fillStyle = 'rgba(8, 14, 18, 0.68)';
      ctx.fillRect(0, 0, CONFIG.canvas.width, CONFIG.canvas.height);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f4d58a';
      ctx.font = '700 34px sans-serif';
      ctx.fillText('游戏已暂停', CONFIG.canvas.width / 2, CONFIG.canvas.height / 2 - 8);
      ctx.fillStyle = '#d7e2e5';
      ctx.font = '16px sans-serif';
      ctx.fillText('按 ESC 继续', CONFIG.canvas.width / 2, CONFIG.canvas.height / 2 + 28);
      ctx.textAlign = 'left';
    }

    // 环境陷阱
    this.traps.forEach(trap => {
      if (!this.isWorldVisible(trap.x, trap.y)) return;
      const sx = trap.x - cam.x, sy = trap.y - cam.y;
      if (sx < -80 || sx > CONFIG.canvas.width + 80 || sy < -80 || sy > CONFIG.canvas.height + 80) return;
      const pulse = 0.65 + Math.sin(trap.phase * 3) * 0.18;
      ctx.globalAlpha = trap.type === 'bear' ? 0.72 : 0.88;
      ctx.fillStyle = trap.color + '22';
      ctx.strokeStyle = trap.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, trap.radius * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.font = `${trap.type === 'bear' ? 20 : 24}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(trap.icon, sx, sy + 7);
      ctx.globalAlpha = 1;
    });

    // 地面战利品：进入固定近战攻击范围后自动拾取。
    const nowSeconds = performance.now() / 1000;
    this.groundLoot.forEach(item => {
      if (!this.isWorldVisible(item.x, item.y)) return;
      const sx = item.x - cam.x, sy = item.y - cam.y + Math.sin(nowSeconds * 3 + item.bob) * 4;
      if (sx < -50 || sx > CONFIG.canvas.width + 50 || sy < -50 || sy > CONFIG.canvas.height + 50) return;
      const near = dist(this.player, item) <= (CONFIG.weapons.find(weapon => weapon.mode === 'melee')?.range || CONFIG.player.attackRange);
      const glow = ctx.createRadialGradient(sx, sy, 2, sx, sy, 28);
      const lootGlow = item.type === 'invincible' ? 'rgba(90,225,255,' : 'rgba(246,199,91,';
      glow.addColorStop(0, `${lootGlow}${near ? '.52)' : '.28)'}`);
      glow.addColorStop(1, 'rgba(246,199,91,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(sx - 30, sy - 30, 60, 60);
      ctx.textAlign = 'center';
      const lootArtId = (typeof CropArt !== 'undefined') ? CropArt.resolveArtId(item) : null;
      if (lootArtId && CropArt.ready(lootArtId)) {
        CropArt.draw(ctx, lootArtId, sx, sy - 2, 34);
      } else {
        ctx.font = '25px sans-serif';
        ctx.fillText(item.icon, sx, sy + 7);
      }
      if (near) {
        ctx.fillStyle = '#f6d77e';
        ctx.font = '10px sans-serif';
        ctx.fillText(`自动拾取 ${item.name}`, sx, sy - 22);
      }
    });

    // 养分结晶
    this.renderNutrientCrystals(ctx, cam);

    // v3.3 低血量心跳脉冲 + 受击红边
    if (this.player.hp > 0 && this.player.maxHp > 0 && this.player.hp < this.player.maxHp * 0.25) {
      const beat = (Math.sin(this.elapsed * 6) + 1) / 2;
      ctx.save();
      const grad = ctx.createRadialGradient(CONFIG.canvas.width/2, CONFIG.canvas.height/2, CONFIG.canvas.height*0.3, CONFIG.canvas.width/2, CONFIG.canvas.height/2, CONFIG.canvas.height*0.75);
      grad.addColorStop(0, 'rgba(180,0,0,0)');
      grad.addColorStop(1, 'rgba(180,0,0,' + (0.18 + 0.22 * beat) + ')');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, CONFIG.canvas.width, CONFIG.canvas.height);
      ctx.restore();
    }
    if (this.playerDamageFlash > 0) {
      this.playerDamageFlash -= 0.016;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,40,40,' + Math.min(0.8, this.playerDamageFlash * 2) + ')';
      ctx.lineWidth = 14;
      ctx.strokeRect(0, 0, CONFIG.canvas.width, CONFIG.canvas.height);
      ctx.restore();
    }
    // 撤离点
    this.extractPoints.forEach(ep => {
      if (!this.isWorldVisible(ep.x, ep.y)) return;
      const sx = ep.x - cam.x, sy = ep.y - cam.y;
      ctx.beginPath();
      ctx.arc(sx, sy, ep.radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(127,255,127,0.15)';
      ctx.fill();
      ctx.strokeStyle = '#7fff7f';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '20px sans-serif';
      ctx.fillStyle = '#7fff7f';
      ctx.textAlign = 'center';
      ctx.fillText('🚁 撤离点', sx, sy - ep.radius - 8);
    });

    // v3.4 地图危险区
    if (this.hazardZones) {
      for (const hz of this.hazardZones) {
        const sx = hz.x - cam.x, sy = hz.y - cam.y;
        if (sx < -150 || sx > CONFIG.canvas.width + 150 || sy < -150 || sy > CONFIG.canvas.height + 150) continue;
        ctx.beginPath();
        ctx.arc(sx, sy, hz.r, 0, Math.PI * 2);
        if (hz.type === 'pit') {
          ctx.fillStyle = 'rgba(40,30,25,0.55)';
          ctx.fill();
          ctx.strokeStyle = '#5a4030';
          ctx.lineWidth = 2;
          ctx.stroke();
        } else if (hz.type === 'mud') {
          ctx.fillStyle = 'rgba(90,70,40,0.45)';
          ctx.fill();
        } else if (hz.type === 'poison') {
          const pulse = 0.35 + 0.15 * Math.sin(performance.now() / 300);
          ctx.fillStyle = `rgba(150,80,200,${pulse})`;
          ctx.fill();
        }
      }
    }
    // v3.4 时空传送门
    if (this.teleporters) {
      for (const tp of this.teleporters) {
        const sx = tp.x - cam.x, sy = tp.y - cam.y;
        ctx.beginPath();
        ctx.arc(sx, sy, tp.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(120,160,255,0.35)';
        ctx.fill();
        ctx.strokeStyle = '#7aa8ff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.font = '22px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🌀', sx, sy + 8);
      }
    }

    // 宝箱
    this.chests.forEach(c => {
      if (!this.isWorldVisible(c.x, c.y)) return;
      const sx = c.x - cam.x, sy = c.y - cam.y;
      if (sx < -50 || sx > CONFIG.canvas.width + 50 || sy < -50 || sy > CONFIG.canvas.height + 50) return;
      ctx.font = '28px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(c.opened ? '📭' : '📦', sx, sy + 8);
      if (!c.opened) {
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, 20, 0, Math.PI * 2);
        ctx.stroke();
      }
    });

    // 防御塔
    this.towers.forEach(t => {
      if (!this.isWorldVisible(t.x, t.y)) return;
      const sx = t.x - cam.x, sy = t.y - cam.y;
      if (sx < -50 || sx > CONFIG.canvas.width + 50 || sy < -50 || sy > CONFIG.canvas.height + 50) return;
      let color = '#666', icon = '🗼';
      if (t.state === 'player') { color = '#7fff7f'; icon = '🏰'; }
      else if (t.state === 'enemy') { color = '#ff4444'; icon = '🗼'; }
      else if (t.state === 'broken') { color = '#444'; icon = '💨'; }
      ctx.font = '28px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(icon, sx, sy + 8);
      if (t.state !== 'broken') {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, t.radius, 0, Math.PI * 2);
        ctx.stroke();
        // 攻击范围（淡色）
        ctx.strokeStyle = color + '33';
        ctx.beginPath();
        ctx.arc(sx, sy, t.range, 0, Math.PI * 2);
        ctx.stroke();
      }
    });

    // v3.5 2.5D：所有实体按 y 轴排序绘制（前后遮挡）
    const drawables = [];
    // 植物
    this.plants.forEach(p => drawables.push({ y: p.y, type: 'plant', obj: p }));
    // 怪物
    this.monsters.forEach(m => {
      if (!this.isWorldVisible(m.x, m.y)) return;
      drawables.push({ y: m.y, type: 'monster', obj: m });
    });
    // 掠夺者
    this.raiders.forEach(r => {
      if (!this.isWorldVisible(r.x, r.y)) return;
      drawables.push({ y: r.y, type: 'raider', obj: r });
    });
    // 障碍物
    this.obstaclesByY.forEach(o => {
      if (o.fxOnly) return;
      if (!this.isWorldVisible(o.x, o.y)) return;
      drawables.push({ y: o.y, type: 'obstacle', obj: o });
    });
    if (this.fxWalls) this.fxWalls.forEach(w => { if (this.isWorldVisible(w.x, w.y)) drawables.push({ y: w.y, type: 'wallfx', obj: w }); });
    if (this.fxProps) this.fxProps.forEach(pp => { if (this.isWorldVisible(pp.x, pp.y)) drawables.push({ y: pp.y, type: 'fxprop', obj: pp }); });
    // 地标（大物件，Y-sort 挡在玩家前面）
    if (this.landmarks) this.landmarks.forEach(lm => {
      if (!this.isWorldVisible(lm.x, lm.y)) return;
      drawables.push({ y: lm.y, type: 'landmark', obj: lm });
    });
    // 道具（油桶/木箱/高草/骷髅/推车）
    if (this.props) this.props.forEach(pr => {
      if (!this.isWorldVisible(pr.x, pr.y)) return;
      drawables.push({ y: pr.y, type: 'prop', obj: pr });
    });
    // 玩家（y 位置 + 1，保证站在怪脚下时怪在身后）
    drawables.push({ y: this.player.y + 1, type: 'player' });
    drawables.sort((a, b) => a.y - b.y);

    // v3.8 落地投影
    const self = this;
    this._drawShadow = function(sx, sy, r, alpha) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,' + (alpha || 0.28) + ')';
      ctx.beginPath();
      ctx.ellipse(sx + r * 0.16, sy + r * 0.32, r * 0.9, r * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    for (const d of drawables) {
      if (d.type === 'plant') {
        this.renderPlants(ctx, cam, [d.obj]);
      } else if (d.type === 'monster') {
        const m = d.obj;
        const sx = m.x - cam.x, sy = m.y - cam.y;
        self._drawShadow(sx, sy, m.radius || 18, m.elite ? 0.35 : 0.25);
        this.renderMonster(ctx, m, cam);
        this.renderMonsterStatus(ctx, m, sx, sy);
        if (m.stunned > 0) {
          ctx.fillStyle = '#ffff00';
          ctx.font = '14px sans-serif';
          ctx.fillText('💫', sx, sy - m.radius - 18);
        }
      } else if (d.type === 'raider') {
        const r = d.obj;
        const sx = r.x - cam.x, sy = r.y - cam.y;
        self._drawShadow(sx, sy, r.radius || 16, 0.3);
        const hpPct = r.hp / r.maxHp;
        ctx.fillStyle = '#333';
        ctx.fillRect(sx - 20, sy - r.radius - 12, 40, 5);
        ctx.fillStyle = '#ff6644';
        ctx.fillRect(sx - 20, sy - r.radius - 12, 40 * hpPct, 5);
        ctx.font = '24px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🥷', sx, sy + 8);
      } else if (d.type === 'obstacle') {
        this.renderObstacle(ctx, d.obj, cam);
      } else if (d.type === 'landmark') {
        const lm = d.obj;
        const img = this.landmarkImgs && this.landmarkImgs[lm.type];
        const sx = lm.x - cam.x, sy = lm.y - cam.y;
        self._drawShadow(sx, sy, lm.size * 0.4, 0.35);
        if (img && img.complete && img.naturalWidth > 0) {
          const s = lm.size;
          this.drawNoBlack(ctx, img, sx - s/2, sy - s, s, s);
        } else {
          ctx.fillStyle = '#4a3a2a';
          ctx.beginPath();
          ctx.arc(sx, sy, 30, 0, Math.PI*2);
          ctx.fill();
        }
      } else if (d.type === 'prop') {
        const pr = d.obj;
        const prsx = pr.x - cam.x, prsy = pr.y - cam.y;
        if (pr.kind !== 'grass') self._drawShadow(prsx, prsy, pr.size * 0.4, 0.25);
        if (pr.kind === 'grass' && pr.used === false) {
          const img = this.propImgs && this.propImgs.grass;
          const sx = pr.x - cam.x, sy = pr.y - cam.y;
          if (img && img.complete && img.naturalWidth > 0) {
            this.drawNoBlack(ctx, img, sx - pr.size/2, sy - pr.size/2, pr.size, pr.size*0.7);
          } else {
            ctx.fillStyle = '#4a7a3a';
            ctx.beginPath(); ctx.arc(sx, sy, pr.size/2, 0, Math.PI*2); ctx.fill();
          }
        } else if (pr.kind === 'skeleton' && !pr.looted) {
          const img = this.propImgs && this.propImgs.skeleton;
          const sx = pr.x - cam.x, sy = pr.y - cam.y;
          if (img && img.complete && img.naturalWidth > 0) {
            this.drawNoBlack(ctx, img, sx - pr.size/2, sy - pr.size/2, pr.size, pr.size);
          } else {
            ctx.font = '24px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('💀', sx, sy + 8);
          }
        } else if (pr.kind === 'cart' && !pr.looted) {
          const img = this.propImgs && this.propImgs.cart;
          const sx = pr.x - cam.x, sy = pr.y - cam.y;
          if (img && img.complete && img.naturalWidth > 0) {
            this.drawNoBlack(ctx, img, sx - pr.size/2, sy - pr.size/2, pr.size, pr.size*0.7);
          } else {
            ctx.font = '24px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('🛒', sx, sy + 8);
          }
        } else if (pr.kind === 'barrel' && pr.hp > 0) {
          const img = this.propImgs && this.propImgs.barrel;
          const sx = pr.x - cam.x, sy = pr.y - cam.y;
          if (img && img.complete && img.naturalWidth > 0) {
            this.drawNoBlack(ctx, img, sx - pr.size/2, sy - pr.size/2, pr.size, pr.size);
          } else {
            ctx.font = '24px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('🛢️', sx, sy + 8);
          }
        } else if (pr.kind === 'crate' && pr.hp > 0) {
          const img = this.propImgs && this.propImgs.crate;
          const sx = pr.x - cam.x, sy = pr.y - cam.y;
          if (img && img.complete && img.naturalWidth > 0) {
            this.drawNoBlack(ctx, img, sx - pr.size/2, sy - pr.size/2, pr.size, pr.size);
          } else {
            ctx.font = '24px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('📦', sx, sy + 8);
          }
        }
      } else if (d.type === 'wallfx') {
        WorldFX.renderWall(ctx, this, d.obj);
      } else if (d.type === 'fxprop') {
        WorldFX.renderSetProp(ctx, this, d.obj);
      } else if (d.type === 'player') {
        const psx = this.player.x - cam.x, psy = this.player.y - cam.y;
        self._drawShadow(psx, psy, 18, 0.32);
        ctx.globalAlpha = this.player.stealth > 0 ? 0.4 : 1;
        if (this.player.invuln > 0 && Math.floor(this.player.invuln * 10) % 2 === 0) {
          ctx.globalAlpha *= 0.5;
        }
        // v3.5 玩家也应用深度缩放
        const dScale = this.getDepthScale(this.player.y);
        ctx.save();
        ctx.translate(psx, psy);
        ctx.scale(dScale, dScale);
        ctx.translate(-psx, -psy);
        this.renderHero(ctx, psx, psy);
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    }

    // 子弹
    this.projectiles.forEach(p => {
      if (p.fromMonster && !this.isWorldVisible(p.x, p.y)) return;
      const sx = p.x - cam.x, sy = p.y - cam.y;
      ctx.save();
      const projectileAngle = Math.atan2(p.vy, p.vx);
      if (p.fromPlayer && p.weaponId === 'pea_repeater') {
        ctx.shadowColor = p.color; ctx.shadowBlur = 12; ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(sx, sy, p.radius, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(208,255,169,.7)'; ctx.lineWidth = 3; ctx.beginPath();
        ctx.moveTo(sx - Math.cos(projectileAngle) * 22, sy - Math.sin(projectileAngle) * 22); ctx.lineTo(sx, sy); ctx.stroke();
      } else if (p.fromPlayer && p.weaponId === 'vine_staff') {
        ctx.translate(sx, sy); ctx.rotate(projectileAngle); ctx.shadowColor = p.color; ctx.shadowBlur = 14;
        const beam = ctx.createLinearGradient(-26, 0, 18, 0); beam.addColorStop(0, 'rgba(123,229,196,0)'); beam.addColorStop(1, p.color);
        ctx.fillStyle = beam; ctx.beginPath(); ctx.ellipse(0, 0, 27, 7, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#d5fff1'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-14, 0); ctx.quadraticCurveTo(0, -8, 16, 0); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(sx, sy, p.radius, 0, Math.PI * 2); ctx.fillStyle = p.fromMonster ? (p.color || '#ff6644') : '#7fff7f'; ctx.fill();
      }
      ctx.restore();
    });

    // Active weapon range and aim line.
    const psx = this.player.x - cam.x, psy = this.player.y - cam.y;
    const worldMouseX = this.mouse.x + cam.x;
    const worldMouseY = this.mouse.y + cam.y;
    const angle = Math.atan2(worldMouseY - this.player.y, worldMouseX - this.player.x);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(psx, psy);
    ctx.lineTo(psx + Math.cos(angle) * Math.min(this.weapon.range, 145), psy + Math.sin(angle) * Math.min(this.weapon.range, 145));
    ctx.stroke();

    // Foreground geometry is drawn after the hero so trunks and ruins create real occlusion.
    // Nearby blockers fade through isBehindHero(), keeping the character readable.
    // 防线部署预览（选中植物时鼠标处显示半透明图标 + 可用性）
    if (this.selectedPlantId) {
      const selPlant = CONFIG.plants.find(p => p.id === this.selectedPlantId);
      if (selPlant) {
        const pmx = this.mouse.x, pmy = this.mouse.y;
        const canPlace = this.canDeployHere(this.mouse.x + cam.x, this.mouse.y + cam.y, 18)
          && dist(this.player, { x: this.mouse.x + cam.x, y: this.mouse.y + cam.y }) <= 240
          && this.nutrient >= selPlant.deployCost;
        ctx.globalAlpha = canPlace ? 0.72 : 0.28;
        ctx.font = '30px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(selPlant.icon, pmx, pmy + 9);
        ctx.strokeStyle = canPlace ? '#7dff9a' : '#ff6b6b';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(pmx, pmy, 20, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
        if (!canPlace) {
          ctx.fillStyle = '#ff8a8a'; ctx.font = '12px sans-serif';
          ctx.fillText('不可部署', pmx, pmy + 34);
        }
      }
    }

    // 粒子
    this.particles.forEach(p => {
      if (window.PixiEffects?.graphics && (!p.type || p.type === 'smoke')) return;
      const sx = p.x - cam.x, sy = p.y - cam.y;
      const alpha = p.life / p.maxLife;
      if (p.type === 'aoe') {
        ctx.beginPath();
        ctx.arc(sx, sy, p.size * (1 - alpha * 0.3), 0, Math.PI * 2);
        ctx.strokeStyle = p.color;
        ctx.globalAlpha = alpha * 0.6;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (p.type === 'hitImg') {
        const hitImg = this.fxSprites && this.fxSprites.hit;
        if (hitImg && hitImg.naturalWidth) {
          ctx.save();
          ctx.translate(sx, sy);
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = alpha;
          const dw = p.size;
          const dh = dw * hitImg.naturalHeight / hitImg.naturalWidth;
          ctx.drawImage(hitImg, -dw/2, -dh/2, dw, dh);
          ctx.restore();
        }
        ctx.globalAlpha = 1;
      } else if (p.type === 'slash') {
        const slashImg = this.fxSprites && this.fxSprites.slash;
        if (slashImg && slashImg.naturalWidth) {
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(p.angle);
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = alpha;
          const dw = p.size * 2.4;
          const dh = dw * slashImg.naturalHeight / slashImg.naturalWidth;
          ctx.drawImage(slashImg, -dw/2, -dh/2, dw, dh);
          ctx.restore();
        } else {
          const dir = p.dir || 1;
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(p.angle);
          ctx.globalCompositeOperation = 'lighter';
          ctx.lineCap = 'round';
          ctx.strokeStyle = p.color;
          ctx.globalAlpha = alpha;
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.arc(0, 0, p.size, -Math.PI / 3 * dir, Math.PI / 3 * dir);
          ctx.stroke();
          ctx.restore();
        }
        ctx.globalAlpha = 1;
      } else if (p.type === 'warn') {
        // Boss 蓄力警示：头顶上浮闪烁的感叹号
        ctx.save();
        ctx.translate(sx, sy);
        const blink = 0.55 + Math.sin(p.life * 26) * 0.45;
        ctx.globalAlpha = alpha * blink;
        ctx.fillStyle = p.color;
        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('!', 0, 0);
        ctx.restore();
      } else if (p.type === 'impact') {
        const grow = p.size * (1.25 - alpha * .25);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, grow);
        glow.addColorStop(0, p.color);
        glow.addColorStop(0.45, p.color + 'aa');
        glow.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(sx, sy, grow, 0, Math.PI * 2); ctx.fill();
        // 十字星芒
        ctx.strokeStyle = '#ffffff';
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 2;
        const m = grow * 0.9;
        ctx.beginPath();
        ctx.moveTo(sx - m, sy); ctx.lineTo(sx + m, sy);
        ctx.moveTo(sx, sy - m); ctx.lineTo(sx, sy + m);
        ctx.stroke();
        ctx.restore();
        ctx.globalAlpha = 1;
      } else if (p.type === 'shock') {
        const r = p.size * (1 - alpha * alpha);
        ctx.beginPath(); ctx.arc(sx, sy, Math.max(2, r), 0, Math.PI * 2);
        ctx.strokeStyle = p.color; ctx.globalAlpha = alpha * 0.85;
        ctx.lineWidth = 2 + alpha * 3; ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (p.type === 'trail') {
        const dir = p.dir || 1;
        const layer = p.layer || 0;
        const sweep = (1 - alpha) * 1.9;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(p.angle);
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        ctx.strokeStyle = p.color;
        ctx.globalAlpha = alpha * (layer === 0 ? 0.85 : 0.4);
        ctx.lineWidth = layer === 0 ? 5 : 3;
        ctx.beginPath();
        ctx.arc(0, 0, p.size, -sweep * dir * 0.5, sweep * dir * 0.5);
        ctx.stroke();
        if (layer === 0) {
          ctx.strokeStyle = '#ffffff';
          ctx.globalAlpha = alpha * 0.75;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, p.size * 0.96, -sweep * dir * 0.42, sweep * dir * 0.42);
          ctx.stroke();
        }
        ctx.restore();
        ctx.globalAlpha = 1;
      } else if (p.type === 'splat') {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(sx, sy, Math.max(1, p.size * alpha), 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.globalAlpha = 1;
      } else if (p.type === 'ice') {
        ctx.save();
        ctx.translate(sx, sy); ctx.rotate(p.rot || 0);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        const isz = p.size * (0.5 + alpha * 0.5);
        ctx.beginPath(); ctx.moveTo(0, -isz); ctx.lineTo(isz * 0.5, 0); ctx.lineTo(0, isz); ctx.lineTo(-isz * 0.5, 0); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.restore();
        ctx.globalAlpha = 1;
      } else if (p.type === 'flame') {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const fs = p.size * (0.6 + alpha * 0.7);
        const fg = ctx.createRadialGradient(sx, sy, 0, sx, sy, fs);
        fg.addColorStop(0, '#fff2b0');
        fg.addColorStop(0.45, p.color);
        fg.addColorStop(1, 'rgba(255,90,20,0)');
        ctx.fillStyle = fg; ctx.globalAlpha = alpha;
        ctx.beginPath(); ctx.arc(sx, sy, fs, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.globalAlpha = 1;
      } else if (p.type === 'chain') {
        if (p.points && p.points.length > 1) {
          const trace = (width, color, a) => {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.strokeStyle = color; ctx.globalAlpha = a; ctx.lineWidth = width;
            ctx.lineJoin = 'round'; ctx.lineCap = 'round';
            ctx.beginPath();
            p.points.forEach((pt, i) => { const px = pt.x - cam.x, py = pt.y - cam.y; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
            ctx.stroke();
            ctx.restore();
          };
          trace(8, 'rgba(90,200,255,.55)', alpha * 0.5);
          trace(3.4, '#7fe9ff', alpha * 0.9);
          trace(1.5, '#ffffff', alpha);
          ctx.globalAlpha = 1;
        }
      } else if (p.type === 'weaponRing') {
        ctx.beginPath(); ctx.arc(sx, sy, p.size * (1.25 - alpha * .25), 0, Math.PI * 2);
        ctx.strokeStyle = p.color; ctx.globalAlpha = alpha * .65; ctx.lineWidth = 2; ctx.stroke(); ctx.globalAlpha = 1;
      } else if (p.type === 'vine') {
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(p.angle); ctx.strokeStyle = p.color; ctx.globalAlpha = alpha;
        ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(0, 0);
        for (let i = 1; i <= 5; i++) ctx.quadraticCurveTo(p.size * i / 5 - 12, Math.sin(i * 2.4) * 11, p.size * i / 5, 0);
        ctx.stroke(); ctx.fillStyle = '#a5e675';
        for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.ellipse(p.size * i / 5, Math.sin(i * 2.4) * 7, 7, 3, i % 2 ? .6 : -.6, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore(); ctx.globalAlpha = 1;
      } else if (p.type === 'earthTrail') {
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(p.angle); ctx.globalAlpha = alpha * .7;
        ctx.fillStyle = '#765c3d'; ctx.beginPath(); ctx.ellipse(0, 0, p.size * 1.8, p.size * .55, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = p.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-p.size, 0); ctx.lineTo(p.size, -4); ctx.stroke(); ctx.restore(); ctx.globalAlpha = 1;
      } else if (p.type === 'smoke') {
        ctx.beginPath(); ctx.arc(sx, sy, p.size * (1.35 - alpha * .35), 0, Math.PI * 2);
        ctx.fillStyle = p.color; ctx.globalAlpha = alpha * .32; ctx.fill(); ctx.globalAlpha = 1;
      } else {
        ctx.beginPath();
        ctx.arc(sx, sy, p.size * alpha, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = alpha;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    });

    // v2.6 血雾贴图粒子
    if (this.fxParticles) {
      this.fxParticles = this.fxParticles.filter(p => p.life > 0);
      this.fxParticles.forEach(p => {
        const sx = p.x - cam.x, sy = p.y - cam.y;
        const a = clamp(p.life / p.maxLife, 0, 1);
        ctx.save(); ctx.globalAlpha = a * 0.9;
        const sz = p.size * (1.4 - a * 0.4);
        ctx.drawImage(p.img, sx - sz/2, sy - sz/2, sz, sz);
        ctx.restore();
      });
    }
    // 伤害跳字：上浮、渐隐，重击字号更大。
    this.damageNumbers.forEach(number => {
      const sx = number.x - cam.x, sy = number.y - cam.y;
      const alpha = clamp(number.life / number.maxLife, 0, 1);
      const crit = number.crit;
      const scale = crit ? 1 + (1 - alpha) * 0.15 : 1;
      const label = (crit ? '✧ ' : '') + `-${number.value}`;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(sx, sy);
      ctx.scale(scale, scale);
      ctx.font = `${number.heavy ? 'bold 20px' : 'bold 15px'} sans-serif`;
      ctx.textAlign = 'center'; ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(18,12,12,.85)';
      ctx.strokeText(label, 0, 0);
      ctx.fillStyle = number.color;
      ctx.fillText(label, 0, 0);
      if (crit) { ctx.strokeStyle = 'rgba(255,240,180,.6)'; ctx.lineWidth = 1.5; ctx.strokeText(label, 0, 0); }
      ctx.restore();
    });

    if (false) { // 击杀白闪已移除：避免击杀瞬间"闪一下屏幕"
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = clamp(this.killFlash * 4.2, 0, .42);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, CONFIG.canvas.width, CONFIG.canvas.height);
      ctx.restore();
    }

    // 玩家受击红屏：边缘红色渐晕
    if (this.playerDamageFlash > 0) {
      const da = clamp(this.playerDamageFlash, 0, 1) * 0.5;
      const vg = ctx.createRadialGradient(CONFIG.canvas.width / 2, CONFIG.canvas.height / 2, CONFIG.canvas.height * 0.32, CONFIG.canvas.width / 2, CONFIG.canvas.height / 2, CONFIG.canvas.height * 0.75);
      vg.addColorStop(0, 'rgba(255,40,30,0)');
      vg.addColorStop(1, `rgba(255,45,35,${da})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, CONFIG.canvas.width, CONFIG.canvas.height);
    }
    // 暴击金色闪屏
    if (this.critFlash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(this.critFlash * 3.4, 0, 0.16);
      ctx.fillStyle = '#ffe9a0';
      ctx.fillRect(0, 0, CONFIG.canvas.width, CONFIG.canvas.height);
      ctx.restore();
    }

    // 战争迷雾：只保留已探索格与当前视野，未到达区域不显示实体信息。
    this.renderFogOfWar(ctx);
    if (typeof CombatEnhancement !== 'undefined') {
      CombatEnhancement.renderDestructibles(ctx, this.camera);
      CombatEnhancement.renderHUD(ctx, this.camera);
    }

    // 撤离读条UI
    if (this.extracting) {
      const extractTime = this.extractType === 'signal' ? CONFIG.expedition.signalExtractTime : CONFIG.expedition.extractTime;
      const pct = this.extractProgress / extractTime;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(CONFIG.canvas.width / 2 - 150, 100, 300, 50);
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 2;
      ctx.strokeRect(CONFIG.canvas.width / 2 - 150, 100, 300, 50);
      ctx.fillStyle = '#ffd700';
      ctx.fillRect(CONFIG.canvas.width / 2 - 148, 120, 296 * pct, 28);
      ctx.fillStyle = '#fff';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.extractType === 'signal' ? '🔥 信号弹撤离中...' : '🚁 撤离读条中...', CONFIG.canvas.width / 2, 118);
      ctx.font = '14px sans-serif';
      ctx.fillText(`${(extractTime - this.extractProgress).toFixed(1)}秒`, CONFIG.canvas.width / 2, 142);
    }

    this.renderWeather(ctx);

    // v3.7 昼夜光照循环
    this.renderDayNight(ctx);

    // v3.7 远景雾 + 地平线剪影
    this.renderHorizonSilhouettes(ctx);

    // 小地图
    this.renderMinimap();

    // 交互提示
    this.renderInteractPrompt();
    // v3.9 前景草遮挡 + 全局后处理
    if (typeof WorldFX !== 'undefined') {
      WorldFX.renderForeground(ctx, this);
      WorldFX.postProcess(ctx, this);
    }
  }

  updateWorldSystems(dt) {
    this.elapsed += dt;
    // v4.1 固定节奏兽潮：倒计时始终走，当前波没清完下一波照样刷（波次叠加、强度滚大）
    const aliveByWave = {};
    for (let i = 0; i < this.monsters.length; i++) {
      const mm = this.monsters[i];
      if (mm.beastWave && mm.hp > 0 && mm.waveNo) aliveByWave[mm.waveNo] = (aliveByWave[mm.waveNo] || 0) + 1;
    }
    let waveMonsterCount = 0;
    for (const wk in aliveByWave) waveMonsterCount += aliveByWave[wk];
    this.beastWave.remaining = waveMonsterCount;
    this.beastWave.active = waveMonsterCount > 0;
    // 每波各自清完各发一次奖励（允许晚于下一波刷出才清完）
    for (let wn = 1; wn <= this.beastWave.wave; wn++) {
      if (!this.beastWave.rewarded[wn] && !aliveByWave[wn]) {
        this.beastWave.rewarded[wn] = true;
        GameState.gold += 20 * wn * this.map.tier;
        showToast(`第 ${wn} 波兽潮已击退，获得守塔奖励`, 'success');
      }
    }
    this.beastWave.nextIn -= dt;
    if (this.beastWave.nextIn <= 0) this.spawnBeastWave();
    if (this.elapsed >= this.nextEventAt && !this.activeEvent) {
      this.startMapEvent();
      this.nextEventAt += 90 + rand(0, 35);
    }
    if (this.activeEvent) {
      this.activeEvent.timeLeft -= dt;
      if (this.activeEvent.id === 'spirit_rain') {
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + dt * 1.25);
        this.player.energy = Math.min(this.player.maxEnergy, this.player.energy + dt * 2);
      }
      if (this.activeEvent.timeLeft <= 0) {
        this.activeEvent = null;
        this.eventModifiers = { enemySpeed:1, enemyDamage:1, loot:1, vision:1 };
      }
    }
    this.updateMission();

    this.monsters.forEach(monster => {
      monster.abilityCd = Math.max(0, (monster.abilityCd || 0) - dt);
      const d = dist(monster, this.player);
      if (this.player.stealth > 0 || monster.stunned > 0 || (d > 430 && monster.type !== 'boss')) return;
      const angle = Math.atan2(this.player.y - monster.y, this.player.x - monster.x);
      if (monster.type === 'locust' && d < 115) {
        monster.x -= Math.cos(angle) * monster.speed * .42 * dt;
        monster.y -= Math.sin(angle) * monster.speed * .42 * dt;
      } else if (monster.type === 'wolf' && d > 85) {
        monster.facing = angle + (monster.packOffset || 1) * .42;
      } else if (monster.type === 'boar' && monster.abilityCd <= 0 && d > 120 && d < 275) {
        monster.abilityCd = 5.5;
        monster.x += Math.cos(angle) * 64;
        monster.y += Math.sin(angle) * 64;
        this.spawnAoeEffect(monster.x, monster.y, 42, '#e9a15e');
      } else if (monster.type === 'boss') {
        monster.phase = monster.hp / monster.maxHp < .5 ? 2 : 1;
        if (monster.castState === 'idle') {
          monster.castState = 'windup';
          monster.castTimer = 0.55;
          monster.castIndex = (monster.castIndex || 0) % 4;
          monster.abilityCd = (monster.phase === 2 ? 2.6 : 4.0) + 0.8;
          this.spawnBossTelegraph(monster);
        } else if (monster.castState === 'windup') {
          monster.castTimer -= dt;
          if (monster.castTimer <= 0) {
            monster.castState = 'cast';
            monster.castTimer = 0.3;
            const dd = dist(monster, this.player);
            const aa = Math.atan2(this.player.y - monster.y, this.player.x - monster.x);
            this.castBossAbility(monster, dd, aa);
            this.spawnShockRing(monster.x, monster.y, '#ffd9a0', 96);
            this.spawnImpact(monster.x, monster.y, '#fff2c0', 1.5);
          }
        } else if (monster.castState === 'cast') {
          monster.castTimer -= dt;
          if (monster.castTimer <= 0) monster.castState = 'idle';
        }
      }
    });
  }

  renderWeather(ctx) {
    const tier = this.map.tier;
    const t = performance.now() / 1000;
    ctx.save();
    const w = GameState.weather || 'sunny';
    if (w === 'rain') {
      ctx.strokeStyle = 'rgba(150,180,220,0.45)'; ctx.lineWidth = 1.2;
      for (let i = 0; i < 60; i++) {
        const x = (i * 53 + t * 600) % (CONFIG.canvas.width + 40) - 20;
        const y = (i * 97 + t * 900) % (CONFIG.canvas.height + 40) - 20;
        ctx.globalAlpha = 0.35;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 18); ctx.stroke();
      }
    } else if (w === 'storm') {
      if (Math.random() < 0.008) { ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(0, 0, CONFIG.canvas.width, CONFIG.canvas.height); }
      ctx.strokeStyle = 'rgba(180,180,220,0.5)'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 45; i++) {
        const x = (i * 61 + t * 700) % (CONFIG.canvas.width + 40) - 20;
        const y = (i * 83 + t * 1100) % (CONFIG.canvas.height + 40) - 20;
        ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 4, y + 22); ctx.stroke();
      }
    } else if (w === 'snow' || w === 'winter') {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      for (let i = 0; i < 40; i++) {
        const x = (i * 73 + Math.sin(t + i) * 30 + 40) % CONFIG.canvas.width;
        const y = (i * 101 + t * 40) % CONFIG.canvas.height;
        ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (tier === 1) {
      for (let i = 0; i < 26; i++) {
        const x = (i * 83 + t * (9 + i % 4)) % CONFIG.canvas.width;
        const y = (i * 137 + Math.sin(t + i) * 35 + 720) % CONFIG.canvas.height;
        ctx.globalAlpha = 0.18 + (Math.sin(t * 2 + i) + 1) * 0.12;
        ctx.fillStyle = '#d8ff8a';
        ctx.beginPath(); ctx.arc(x, y, 1.7, 0, Math.PI * 2); ctx.fill();
      }
    } else if (tier === 2) {
      ctx.strokeStyle = '#d5b67a';
      ctx.lineWidth = 2;
      for (let i = 0; i < 32; i++) {
        const x = (i * 71 + t * 90) % (CONFIG.canvas.width + 120) - 60;
        const y = (i * 109 + t * 18) % CONFIG.canvas.height;
        ctx.globalAlpha = 0.12 + (i % 3) * 0.04;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 28, y + 5); ctx.stroke();
      }
    } else if (tier === 3) {
      for (let i = 0; i < 12; i++) {
        const x = (i * 131 + Math.sin(t * .3 + i) * 90 + 1280) % 1280;
        const y = (i * 79 + t * 13) % 760 - 40;
        const radius = 55 + (i % 4) * 24;
        const fog = ctx.createRadialGradient(x, y, 0, x, y, radius);
        fog.addColorStop(0, 'rgba(116,173,74,.1)'); fog.addColorStop(1, 'rgba(70,105,50,0)');
        ctx.fillStyle = fog; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      }
    } else {
      ctx.strokeStyle = '#b9a2ff';
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 38; i++) {
        const x = (i * 97 + t * 44) % CONFIG.canvas.width;
        const y = (i * 61 + t * 145) % (CONFIG.canvas.height + 60) - 30;
        ctx.globalAlpha = 0.12 + (i % 5) * 0.025;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 9, y + 24); ctx.stroke();
      }
    }
    ctx.restore();
  }

  // v3.7 昼夜光照循环
  // 周期 180s：day(0-60) -> dusk(60-90) -> night(90-150) -> dawn(150-180)
  renderDayNight(ctx) {
    const t = (this.elapsed || 0) % 180;
    let phase, overlayAlpha, tint;
    if (t < 60) {
      phase = 'day'; overlayAlpha = 0; tint = null;
    } else if (t < 90) {
      const k = (t - 60) / 30; // 0..1
      overlayAlpha = 0.35 * k;
      tint = { r: 255, g: 140, b: 60, a: 0.18 * k };
    } else if (t < 150) {
      const k = (t - 90) / 60;
      overlayAlpha = 0.55;
      tint = { r: 20, g: 30, b: 70, a: 0.45 };
    } else {
      const k = (t - 150) / 30;
      overlayAlpha = 0.55 * (1 - k);
      tint = { r: 20, g: 30, b: 70, a: 0.45 * (1 - k) };
    }
    this.dayNightPhase = phase;
    this.nightVisionRadius = (t >= 90 && t < 150) ? 180 : 0; // 夜晚视野半径

    // 整体色调叠加
    if (tint && tint.a > 0.01) {
      ctx.fillStyle = `rgba(${tint.r|0},${tint.g|0},${tint.b|0},${tint.a})`;
      ctx.fillRect(0, 0, CONFIG.canvas.width, CONFIG.canvas.height);
    }

    // 夜晚：黑边+火把照明
    if (overlayAlpha > 0.01) {
      const px = this.player.x - this.camera.x;
      const py = this.player.y - this.camera.y;
      // 火把照明半径：有火把道具更大
      const torchBonus = (this.player.torchTime && this.player.torchTime > 0) ? 80 : 0;
      const R = this.nightVisionRadius + torchBonus;
      // 径向渐变挖洞
      const g = ctx.createRadialGradient(px, py, R * 0.3, px, py, R);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.7, `rgba(0,0,0,${overlayAlpha * 0.6})`);
      g.addColorStop(1, `rgba(0,0,0,${overlayAlpha})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, CONFIG.canvas.width, CONFIG.canvas.height);
    }

    // 白天/夜晚 HUD 提示
    if (phase === 'day' && t > 55) {
      ctx.fillStyle = '#ffd700';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('☀️ 白天即将结束…', CONFIG.canvas.width / 2, 28);
    } else if (phase === 'night' && Math.floor(this.elapsed) % 2 === 0) {
      ctx.fillStyle = '#aaccff';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🌙 夜晚：视野缩小，小心黑暗中的怪物', CONFIG.canvas.width / 2, 28);
    }
  }

  // v3.7 远景雾 + 地平线剪影
  renderHorizonSilhouettes(ctx) {
    const W = CONFIG.canvas.width, H = CONFIG.canvas.height;
    // 远景雾（屏幕边缘渐暗，营造深度）
    const fog = ctx.createRadialGradient(W/2, H/2, Math.min(W,H)*0.45, W/2, H/2, Math.max(W,H)*0.75);
    fog.addColorStop(0, 'rgba(0,0,0,0)');
    fog.addColorStop(1, 'rgba(10,15,20,0.35)');
    ctx.fillStyle = fog;
    ctx.fillRect(0, 0, W, H);

    // v3.9 三层视差远景：远山（蓝灰空气透视，0.15x）+ 中景树林团（0.4x）
    const nightSky = this.dayNightPhase === 'night';
    const drawRidge = (parallax, baseY, amp, color, step) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-step, baseY + 80);
      const off = this.camera.x * parallax;
      for (let x = -step; x <= W + step; x += step) {
        const wx = x + off;
        const y = baseY
          - (Math.sin(wx * 0.0042) * 0.5 + 0.5) * amp
          - (Math.sin(wx * 0.011 + 1.7) * 0.5 + 0.5) * amp * 0.55;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W + step, baseY + 80);
      ctx.closePath();
      ctx.fill();
    };
    drawRidge(0.15, 104, 42, nightSky ? 'rgba(28,36,56,0.6)' : 'rgba(74,90,108,0.5)', 22);
    drawRidge(0.24, 116, 30, nightSky ? 'rgba(22,30,40,0.55)' : 'rgba(56,70,80,0.45)', 20);
    // 中景：团状远树剪影（替代三角山）
    ctx.fillStyle = nightSky ? 'rgba(16,24,22,0.62)' : 'rgba(42,56,46,0.5)';
    const treeOff = this.camera.x * 0.4;
    for (let i = -1; i < W / 64 + 2; i++) {
      const wx = i * 64 - (((treeOff % 64) + 64) % 64);
      const h = 18 + ((Math.abs(Math.floor((i * 64 + treeOff) * 7.91)) % 40));
      ctx.beginPath();
      ctx.arc(wx + 32, 108 - h * 0.35, 22 + (h % 12), 0, Math.PI * 2);
      ctx.arc(wx + 10, 112 - h * 0.28, 17, 0, Math.PI * 2);
      ctx.arc(wx + 56, 112 - h * 0.32, 19, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // v3.8 脚印：玩家走过留下逐渐淡出的印记
  addFootprint(x, y) {
    if (!this.footprints) this.footprints = [];
    this.footprints.push({ x, y, life: 5 });
    if (this.footprints.length > 40) this.footprints.shift();
  }
  renderFootprints(ctx, cam) {
    if (!this.footprints) return;
    const W = CONFIG.canvas.width, H = CONFIG.canvas.height;
    this.footprints = this.footprints.filter(f => f.life > 0);
    for (const f of this.footprints) {
      const sx = f.x - cam.x, sy = f.y - cam.y;
      if (sx < 0 || sx > W || sy < 0 || sy > H) continue;
      const a = (f.life / 5) * 0.25;
      ctx.fillStyle = 'rgba(60,45,30,' + a + ')';
      ctx.beginPath();
      ctx.ellipse(sx, sy, 6, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  renderMinimap() {
    const mm = document.getElementById('minimapCanvas');
    const mctx = mm.getContext('2d');
    const size = CONFIG.expedition.mapSize;
    const scale = 160 / size;

    // v3.7 战争迷雾：记录已探索格子（32px 一格）
    if (!this.exploredSet) this.exploredSet = new Set();
    const TILE = 64;
    const viewR = 180; // 视野半径（世界坐标）
    const px = this.player.x, py = this.player.y;
    for (let dy = -viewR; dy <= viewR; dy += TILE) {
      for (let dx = -viewR; dx <= viewR; dx += TILE) {
        if (dx*dx + dy*dy > viewR*viewR) continue;
        const tx = Math.floor((px + dx) / TILE);
        const ty = Math.floor((py + dy) / TILE);
        this.exploredSet.add(tx + ',' + ty);
      }
    }

    mctx.fillStyle = 'rgba(0,0,0,0.9)';
    mctx.fillRect(0, 0, 160, 160);

    // 地形斑块（只画已探索的）
    this.terrainPatches.forEach(patch => {
      const key = Math.floor(patch.x / TILE) + ',' + Math.floor(patch.y / TILE);
      if (!this.exploredSet.has(key)) return;
      mctx.globalAlpha = patch.type === 'water' ? 0.7 : 0.18;
      mctx.fillStyle = patch.color;
      mctx.beginPath();
      mctx.ellipse(patch.x * scale, patch.y * scale, Math.max(1, patch.rx * scale), Math.max(1, patch.ry * scale), patch.rotation, 0, Math.PI * 2);
      mctx.fill();
    });
    // 道路（已探索才画）
    mctx.globalAlpha = 0.35;
    mctx.strokeStyle = this.map.terrain.path;
    mctx.lineWidth = 2;
    this.terrainRoads.forEach(road => {
      const k1 = Math.floor(road.x1 / TILE) + ',' + Math.floor(road.y1 / TILE);
      const k2 = Math.floor(road.x2 / TILE) + ',' + Math.floor(road.y2 / TILE);
      if (!this.exploredSet.has(k1) && !this.exploredSet.has(k2)) return;
      mctx.beginPath();
      mctx.moveTo(road.x1 * scale, road.y1 * scale);
      mctx.lineTo(road.x2 * scale, road.y2 * scale);
      mctx.stroke();
    });
    mctx.globalAlpha = 1;

    // 撤离点（已探索才显示）
    this.extractPoints.forEach(ep => {
      const k = Math.floor(ep.x / TILE) + ',' + Math.floor(ep.y / TILE);
      if (!this.exploredSet.has(k)) return;
      mctx.fillStyle = '#7fff7f';
      mctx.beginPath();
      mctx.arc(ep.x * scale, ep.y * scale, 4, 0, Math.PI * 2);
      mctx.fill();
    });
    // 宝箱（已探索过记住）
    this.chests.forEach(c => {
      if (c.opened) return;
      const k = Math.floor(c.x / TILE) + ',' + Math.floor(c.y / TILE);
      if (!this.exploredSet.has(k)) return;
      mctx.fillStyle = '#ffd700';
      mctx.fillRect(c.x * scale - 2, c.y * scale - 2, 4, 4);
    });
    // 怪物（只显示玩家附近 200px 内的）
    this.monsters.forEach(m => {
      const d = Math.hypot(m.x - px, m.y - py);
      if (d > 200) return;
      mctx.fillStyle = '#ff4444';
      mctx.fillRect(m.x * scale - 1, m.y * scale - 1, 3, 3);
    });
    // 掠夺者
    this.raiders.forEach(r => {
      const d = Math.hypot(r.x - px, r.y - py);
      if (d > 250) return;
      mctx.fillStyle = '#ff8800';
      mctx.fillRect(r.x * scale - 2, r.y * scale - 2, 4, 4);
    });
    // 防御塔（已探索才显示）
    this.towers.forEach(t => {
      const k = Math.floor(t.x / TILE) + ',' + Math.floor(t.y / TILE);
      if (!this.exploredSet.has(k)) return;
      mctx.fillStyle = t.state === 'player' ? '#7fff7f' : t.state === 'enemy' ? '#ff4444' : '#666';
      mctx.fillRect(t.x * scale - 2, t.y * scale - 2, 4, 4);
    });
    // 地面战利品（附近才显示）
    this.groundLoot.forEach(item => {
      const d = Math.hypot(item.x - px, item.y - py);
      if (d > 180) return;
      mctx.globalAlpha = 1;
      mctx.fillStyle = '#f6c75b';
      mctx.beginPath();
      mctx.arc(item.x * scale, item.y * scale, 2.2, 0, Math.PI * 2);
      mctx.fill();
    });
    mctx.globalAlpha = 1;
    // 玩家
    mctx.fillStyle = '#4488ff';
    mctx.beginPath();
    mctx.arc(this.player.x * scale, this.player.y * scale, 4, 0, Math.PI * 2);
    mctx.fill();
    if (this.extracting && this.extractType === 'signal') {
      mctx.strokeStyle = '#ff4d3f';
      mctx.lineWidth = 2;
      mctx.globalAlpha = 0.45 + Math.sin(performance.now() / 130) * 0.3;
      mctx.beginPath();
      mctx.arc(this.player.x * scale, this.player.y * scale, 8, 0, Math.PI * 2);
      mctx.stroke();
      mctx.globalAlpha = 1;
    }
    // 视野框
    mctx.strokeStyle = 'rgba(255,255,255,0.3)';
    mctx.strokeRect(this.camera.x * scale, this.camera.y * scale,
      CONFIG.canvas.width * scale, CONFIG.canvas.height * scale);
  }

  renderInteractPrompt() {
    const cam = this.camera;
    // 检查附近可交互物
    let prompt = null;
    for (const chest of this.chests) {
        if (!chest.opened && this.isWorldVisible(chest.x, chest.y) && dist(this.player, chest) < 60) {
          prompt = { x: chest.x, y: chest.y - 40, text: '左键打开宝箱' };
          break;
        }
      }
    if (!prompt) {
      for (const tower of this.towers) {
        if (tower.state !== 'player' && this.isWorldVisible(tower.x, tower.y) && dist(this.player, tower) < 60) {
          prompt = { x: tower.x, y: tower.y - 40, text: tower.state === 'broken' ? '点击修复并占领防御塔' : '点击占领防御塔' };
          break;
        }
      }
    }
    if (!prompt) {
      for (const ep of this.extractPoints) {
        if (this.isWorldVisible(ep.x, ep.y) && dist(this.player, ep) < ep.radius) {
          prompt = { x: ep.x, y: ep.y - ep.radius - 20, text: '点击开始撤离' };
          break;
        }
      }
    }
    if (prompt) {
      const sx = prompt.x - cam.x, sy = prompt.y - cam.y;
      ctx.fillStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 1;
      const w = ctx.measureText(prompt.text).width + 20;
      ctx.fillRect(sx - w / 2, sy - 14, w, 24);
      ctx.strokeRect(sx - w / 2, sy - 14, w, 24);
      ctx.fillStyle = '#ffd700';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(prompt.text, sx, sy + 3);
    }
  }
}

// ==================== 游戏主控制器 ====================
