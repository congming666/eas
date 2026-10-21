/* Expedition 核心：实例状态、输入/清理、暂停菜单、固定步长 update 编排（由 expedition.js 拆分） */
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
    // v5.8.15 每图专属无缝地表贴图（AI 生成），加载成功后战局地面用它替代通用程序纹理
    this.groundTexImg = new Image();
    this.groundTexLoaded = false;
    if (this.map && this.map.groundTexture) {
      this.groundTexImg.onload = () => {
        this.groundTexLoaded = true;
        // 污染前置探测（同 v5.8.12 全景方案）：file:// 下跨域贴图会污染画布，
        // WebGL texImage2D 无法上传 → Pixi 地形层永久禁用，走 2D 路径（2D 画 tainted 图不受限）。
        try {
          const probe = document.createElement('canvas');
          probe.width = probe.height = 4;
          const pctx = probe.getContext('2d');
          pctx.drawImage(this.groundTexImg, 0, 0, 4, 4);
          pctx.getImageData(0, 0, 1, 1);
        } catch (e) {
          this.groundTexTainted = true;
          try { if (window.PixiTerrain) PixiTerrain.enabled = false; } catch (e2) {}
        }
        // 关键：首帧渲染时贴图尚未就绪，chunk 缓存里存的是平涂底色，必须清空重建；
        // Pixi 合成层还持有旧 chunk 画布的 sprite 引用，也要一并重置（clear 会把 _cacheRef 置空触发全量重建）
        try { if (this.terrainChunkCache) this.terrainChunkCache.clear(); } catch (e) {}
        try { if (window.PixiTerrain && PixiTerrain.clear) PixiTerrain.clear(); } catch (e) {}
        try { if (window.PixiEntities && PixiEntities.clear) PixiEntities.clear(); } catch (e) {}
      };
      this.groundTexImg.src = this.map.groundTexture;
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
      root: 0,
      vx: 0, vy: 0,
      visualZ: 0,
      visualVz: 0
    };
    // v5.0 修行台派生属性 + 装备技能
    if (window.CharacterSystem) {
      const _d = CharacterSystem.derived();
      this.player.maxHp = _d.hp; this.player.hp = _d.hp;
      this.player.maxEnergy = _d.energyMax; this.player.energy = _d.energyMax;
      this.player.baseAtk = _d.atk; this.player.def = _d.def;
      this.player.energyRegen = _d.energyRegen; this.player.ocRegen = _d.ocRegen;
      this.player.shield = 0;
      this.equippedSkills = CharacterSystem.getEquipped();
    } else {
      this.player.baseAtk = 12; this.player.def = 0; this.player.energyRegen = 15; this.player.ocRegen = 0;
      this.equippedSkills = CONFIG.skills.slice(0, 4).map(s => s.id);
    }
    // v5.8 接线：科技树 surv 节点（最大生命加成）
    if (window.TechSystem) {
      let hpBonus = 0;
      ['surv_1', 'surv_2', 'surv_3', 'surv_4'].forEach(id => { hpBonus += TechSystem.getTechBonus(id); });
      if (hpBonus) {
        this.player.maxHp = Math.round(this.player.maxHp * (1 + hpBonus));
        this.player.hp = this.player.maxHp;
      }
    }
    this.skillCooldowns = this.equippedSkills.map(() => 0);
    this.skillFlashes = this.equippedSkills.map(() => 0);
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
    this.skillBoosts = {}; // v5.6 强化卡永久升级，不再局前临选
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
    this.allies = [];            // v1.9 游侠盟友
    this.allySignal = null;      // v1.9 待接纳的游侠信号
    this.allyKills = 0;          // v1.9 盟友击杀数（分账用）
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
    // 玩家可读的战斗反馈：短生命周期，不参与战斗逻辑
    this.combatFeedback = [];
    this.safeNode = null;
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
      nextIn: 360, // 占位初值，实际首波由 startExpedition/initializeTerrainJourney 按 Tier 设为 200/240s
      interval: 40,        // 之后每 40 秒一波（固定节奏）
      active: false,
      remaining: 0,
      duration: 0,
      rewarded: {},        // 每波守塔奖励是否已发（按波次号记录）
      streams: null,       // N1 滴流流组：[{waveNo, types, share, spawned, interval, timer, surge}]
      _pending: {},        // N1 各波待刷出份额（守恒记账 + 守塔奖励守卫）
    };
    this.camera = { x: 0, y: 0, zoom: 1 };   // v1.8 zoom<1 = 视角拉远（updateCamera 平滑趋近目标档）
    this.visionCellSize = 96;
    this.visionRadius = 360;
    this.exploredCells = new Set();
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = CONFIG.canvas.width;
    this.fogCanvas.height = CONFIG.canvas.height;
    this.fogUpdateInterval = 0.12;
    this.fogUpdateTimer = this.fogUpdateInterval;
    this.fogDirty = true;
    // v1.4 渲染层拆分：UI 独立画布（战斗 HUD/撤离读条/地标/交互提示/前景草/屏幕后处理）。
    // 世界层（#gameCanvas）承载雾+昼夜分级（CSS filter GPU 合成），UI 层永不被雾罩/分级——
    // 与旧单画布顺序语义一致（连击/怒气条本就画在雾之后）。跨远征复用同一画布防泄漏。
    const gc = document.getElementById('gameCanvas');
    let ui = document.getElementById('expeditionUICanvas');
    if (!ui && gc) {
      ui = document.createElement('canvas');
      ui.id = 'expeditionUICanvas';
      gc.parentNode.insertBefore(ui, gc.nextSibling);
    }
    if (ui) {
      ui.width = CONFIG.canvas.width; ui.height = CONFIG.canvas.height;
      this.uiCanvas = ui;
      this.uiCtx = ui.getContext('2d');
    }
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
      ancient_tree: 'docs/art/enemies/treant_v3.png',   // N3 荒野古树：复用树精贴图
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
    // v5.2 有 4 状态独立贴图的怪物（像素风，与玩家走路序列统一风格）
    // boar 的 attack/hit 是双足野猪人，与 idle 四足野猪形态不一致，attack/hit 用 idle 图 + 程序化变形
    const STATEFUL_MOBS = ['bat', 'boar', 'spider'];
    for (const _t of STATEFUL_MOBS) {
      this.monsterSprites[_t] = this.monsterSprites[_t] || {};
      for (const _st of ['idle', 'attack', 'hit', 'death']) {
        const _use = (_t === 'boar' && (_st === 'attack' || _st === 'hit')) ? 'idle' : _st;
        const _img = new Image();
        _img.src = `assets/monsters/${_t}-${_use}.webp`;
        this.monsterSprites[_t][_st] = _img;
      }
    }
    // v5.8.3：命中反馈全面程序化——hit_spark/hit_blood/player_hit 贴图加载移除（暴击星芒走 spawnStarburst、血雾走 spawnBloodMist）
    this.fxSprites = { slash: new Image(), treant: new Image(), gargoyle: new Image(), shadow: new Image(), boar: new Image() };
    this.fxSprites.slash.src = 'docs/art/effects/fire_slash.png';
    this.fxSprites.treant.src = 'docs/art/mobfx/treant_swipe.png';
    this.fxSprites.gargoyle.src = 'docs/art/mobfx/gargoyle_dive.png';
    this.fxSprites.shadow.src = 'docs/art/mobfx/shadow_blink.png';
    this.fxSprites.boar.src = 'docs/art/mobfx/boar_charge.png';
    this.playerSprite = new Image(); this.playerSprite.src = 'docs/art/v2/player.png';
    this.playerWalkSheet = new Image(); this.playerWalkSheet.src = 'docs/art/v2/player_walk_transparent.png';
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
    this.wheelOpen = false;
    this.gameOver = false;
    this.result = null;
    // ===== v5.8 夺卡/篝火/商人/撤离/死亡 运行时状态 =====
    this.choiceOpen = false;          // 夺卡/篝火/商人浮层打开时暂停世界更新
    this.nextRoadCaptureAt = 120;     // 每 2 分钟道路节点夺卡
    this.tempCards = [];               // 局内夺卡/掉落的物理卡副本（待撤离铭记，死亡全丢）
    this.campfire = null;              // 篝火世界交互物
    this.merchant = null;              // 商人世界交互物
    this.merchantStock = [];           // 商人当前在售道具卡 defId
    this.merchantRestockCost = 60;
    this.blueprintGiven = [];          // 本局已给过蓝图的 bossId（防重）
    this.captureLog = [];              // 本局夺卡记录

    // v0.7.0 难度系统初始化
    if (typeof DifficultySystem !== 'undefined') {
      DifficultySystem.applyDifficulty(GameState.difficulty || 'normal', GameState.heatModifiers || [], this.map.tier);
      const _ds = DifficultySystem.get();
      this.visionRadius = 360 * _ds.visionMul;
      // v3.4 地图词条：视野修正
      if (this.map.visibilityBonus) this.visionRadius *= (1 + this.map.visibilityBonus);
      if (this.map.visionPenalty) this.visionRadius *= (1 - this.map.visionPenalty);
      // v5.8.1 兽潮首波提前到常规游玩窗口内（原 360s：90% 的局在 246s 内撤离，兽潮永远赶不上）
      this.beastWave.nextIn = this.map.tier === 1 ? 240 : 200;
      // v5.4 修复：难度/Heat 在此时才真正应用，必须重算 balance 快照，否则怪血/伤害恒为普通难度
      this.balance = this.getBalanceProfile();
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
    this.spawnCardNodes();   // v5.8 篝火 / 商人世界交互物
    this.initializeTerrainJourney();
    this.buildCardSynergy(); // v5.8 战斗层：按装载缓存协同 mod + 开战叠甲
    this.setupInput();
    this.updateVision();
  }

  getBalanceProfile() {
    const tier = this.map.tier;
    const _ds = (typeof DifficultySystem !== 'undefined') ? DifficultySystem.get() : {hpMul:1, dmgMul:1, rewardMul:1, speedMulExtra:1};
    const _tierM = (typeof DifficultySystem !== 'undefined') ? DifficultySystem.getTierMechanic(tier) : {eliteChanceBonus:0};
    return {
      // Tier 使用 1-based 关卡编号，数组统一用 tier - 1 索引，避免 T1 误读第二项。
      enemyHp: ([1.0, 1.5, 2.4, 3.8, 5.6][tier - 1] || 5.6) * _ds.hpMul,
      enemyDamage: ([1.1, 1.25, 1.95, 2.9, 4.0][tier - 1] || 4.0) * _ds.dmgMul,
      enemySpeed: (1 + (tier - 1) * 0.06) * (_ds.speedMulExtra || 1),
      reward: (1 + (tier - 1) * 0.48) * _ds.rewardMul * ((typeof DifficultySystem !== 'undefined') ? DifficultySystem.getHeatRewardMultiplier() : 1),
      eliteChance: (tier < 3 ? 0 : 0.08 + tier * 0.025) + (_tierM.eliteChanceBonus || 0) + (this.map.eliteBonus || 0),
      // Boss 主数据来自 CONFIG.bosses，由 V5.makeBoss 统一创建；此处仅保留兜底伤害参数。
      bossHp: (520 + tier * 320) * _ds.hpMul,
      bossDamage: (14 + tier * 7) * _ds.dmgMul,
    };
  }

  setupInput() {
    // Losing focus should never leave movement/attack held or let the expedition
    // continue running in the background. This also makes alt-tab/mobile focus
    // changes safe and predictable.
    this.blurHandler = () => {
      Object.keys(this.keys).forEach(k => { this.keys[k] = false; });
      this.mouse.down = false;
      if (!this.gameOver && !this.paused) { this.paused = true; this.showPauseMenu(); }
    };
    this.keydownHandler = (e) => {
      this.keys[e.key.toLowerCase()] = true;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (this.wheelOpen) { this.closeConsumableWheel(); return; }
        if (this.dying) return; // P0-4 死亡呼吸窗口期间不接受暂停
        this.paused = !this.paused;
        if (this.paused) this.showPauseMenu(); else this.hidePauseMenu();
      }
      // v5.6 道具转盘打开时，除 R/ESC 外屏蔽其他玩法键
      if (this.wheelOpen) {
        if (e.key.toLowerCase() === 'r') { e.preventDefault(); this.closeConsumableWheel(); }
        return;
      }
      const _branchActive = (typeof CombatEnhancement !== 'undefined' && CombatEnhancement.branchActive);
      if (!_branchActive) {
        for (let _sk = 0; _sk < (this.equippedSkills || []).length && _sk < 5; _sk++) {
          if (e.key === String(_sk + 1)) this.queueSkill(_sk);
        }
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
      if (e.key.toLowerCase() === 'r') { e.preventDefault(); this.openConsumableWheel(); }
      if (e.key === ' ' || e.key === 'Shift') { e.preventDefault(); this.queueDodge(); }
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
        const wp = this.screenToWorld(this.mouse.x, this.mouse.y);   // v1.8 zoom 换算
        this.tryPlacePlant(wp.x, wp.y);
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
    // P0-1/G6 战斗手感层 DOM 兜底清理（quitToFarm 直走 cleanup 不经过 endExpedition）
    if (typeof CombatDirector !== 'undefined') CombatDirector.clearDom();
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

  // v5.6 R 键道具转盘：最多 6 种携带消耗品圆周均布，鼠标点选使用
  openConsumableWheel() {
    if (this.gameOver || this.dying) return;
    if (document.getElementById('consumableWheel')) { this.closeConsumableWheel(); return; }
    const ids = CONFIG.consumables.filter(c => (this.consumables[c.id] || 0) > 0).map(c => c.id);
    this.wheelOpen = true;
    const overlay = document.createElement('div');
    overlay.id = 'consumableWheel';
    overlay.className = 'cons-wheel-overlay';
    overlay.onclick = (ev) => { if (ev.target === overlay) this.closeConsumableWheel(); };
    const n = ids.length;
    let wedges = '';
    if (!n) {
      wedges = '<div class="cons-wheel-empty">未携带任何消耗品<br><small>在出征准备大厅携带（最多 6 种，火把计入）</small></div>';
    } else {
      ids.forEach((id, i) => {
        const item = CONFIG.consumables.find(c => c.id === id);
        const cnt = this.consumables[id] || 0;
        const ang = n === 1 ? -Math.PI / 2 : (-Math.PI / 2 + i * 2 * Math.PI / n);
        const R = 150;
        const x = Math.cos(ang) * R, y = Math.sin(ang) * R;
        const art = (typeof CropArt !== 'undefined' && CropArt.ready(id)) ? CropArt.dom(id, item.icon, 36) : item.icon;
        wedges += '<button class="cons-wedge" style="left:calc(50% + ' + x.toFixed(1) + 'px);top:calc(50% + ' + y.toFixed(1) + 'px);" onclick="Game.expedition.useWheelItem(\'' + id + '\')">'
          + '<span class="cons-wedge-icon">' + art + '</span>'
          + '<span class="cons-wedge-name">' + item.name + '</span>'
          + '<span class="cons-wedge-count">×' + cnt + '</span></button>';
      });
    }
    overlay.innerHTML = '<div class="cons-wheel">'
      + '<div class="cons-wheel-hub"><div class="cons-wheel-hub-icon">🎡</div><div class="cons-wheel-hub-text">道具转盘</div><div class="cons-wheel-hint">点击使用 · R / ESC 关闭</div></div>'
      + wedges + '</div>';
    document.body.appendChild(overlay);
  }
  closeConsumableWheel() {
    const el = document.getElementById('consumableWheel');
    if (el) el.remove();
    this.wheelOpen = false;
  }
  useWheelItem(id) {
    this.closeConsumableWheel();
    this.useConsumable(id);
  }

  quitToFarm() {
    this.hidePauseMenu();
    // 等同死亡：损失带入武器
    if (typeof LoadoutSystem !== 'undefined') LoadoutSystem.loseBroughtWeapon();
    if (typeof SaveSystem !== 'undefined') SaveSystem.save();
    this.cleanup && this.cleanup();
    Game.returnToFarm();
  }

  update(dt) {
    this.lastDt = dt;   // v1.12 渲染层弹出动画取帧时长用
    // P0-4 死亡呼吸窗口：仅驱动死亡序列（红闪衰减/计时/终局转结算），其余逻辑冻结但渲染继续
    if (this.dying) {
      if (typeof CombatDirector !== 'undefined') CombatDirector.updateDeathSeq(this, dt);
      return;
    }
    // v5.8.13 卡死保险丝：choiceOpen/wheelOpen 挂起超 30s 强制恢复（实测玩家局偶发浮层状态
    // 无人清理 → 世界永久冻结、elapsed 冻结。真实原因未定位，先上兜底保命丝）
    if (this.choiceOpen || this.wheelOpen) {
      this._overlayHoldT = (this._overlayHoldT || 0) + dt;
      if (this._overlayHoldT > 30) {
        console.warn('[远征] 浮层挂起超 30s，保险丝强制恢复（choiceOpen=' + this.choiceOpen + ' wheelOpen=' + this.wheelOpen + '）');
        ['v58CaptureOverlay', 'v58CampfireOverlay', 'v58MerchantOverlay', 'v58WheelOverlay'].forEach(id => {
          try { this._closeModal(id); } catch (e) {}
        });
        this.choiceOpen = false; this.wheelOpen = false; this.safeNode = null;
        this._overlayHoldT = 0;
        if (typeof showToast !== 'undefined') showToast('浮层超时已自动关闭', 'warning');
      }
    } else this._overlayHoldT = 0;
    if (this.paused || this.wheelOpen || this.gameOver || this.choiceOpen) return;
    // 外部子系统 / 植物 / 空间索引 / 自动拾取（保持原有每帧两次 updatePlants 调用）
    this.updateRunSystems(dt);

    // 倒计时
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this._timeoutDeath = true;
      this.playerDeath();
      return;
    }
    // v5.8 每 2 分钟道路节点三选一夺卡
    this.nextRoadCaptureAt -= dt;
    if (this.nextRoadCaptureAt <= 0 && !this.gameOver) {
      this.nextRoadCaptureAt = 120;
      this.offerCapture('road');
      if (this.choiceOpen) return;
    }
    // v3.3 受击硬直期间禁止移动，时间整体减速（缩放后的 dt 作用于后续所有分段）
    if (this.player.hitStun > 0) {
      this.player.hitStun -= dt;
      dt *= 0.25;
    }
    // 输入缓冲：硬直结束后立刻消费缓存的技能/闪避
    this.consumeInputBuffer();
    // Boss 死亡电影序列：真实 dt 推进，返回慢镜头 timeScale（在缩放前调用）
    if (this._bossDeathSeq) {
      const ts = CombatDirector.updateBossDeathSeq(this, dt);
      if (ts < 1) dt *= ts;
    }
    this.updatePlayer(dt);        // 输入移动/地形碰撞/危险区/传送门/能量
    this.updateWorldProps(dt);    // 脚印扬尘/高光统计/骷髅推车
    this.updateVisualTimers(dt);  // 武器与受击视觉计时/技能 CD
    this.updateTraps(dt);
    if (this.gameOver) return;

    // 鼠标持续攻击
    if (this.mouse.down) this.playerAttack();

    this.updateCamera();
    this.updateMonsters(dt);
    this.resolveUnitCollisions();
    this.processDeadMonsters();
    this.updateRaiders(dt);
    this.updateAllies(dt);       // v1.9 游侠盟友 AI（信号/跟随/索敌/开火/气泡）
    if (window.NpcAssist) NpcAssist.tick(this);   // 智能 NPC 危机支援（好感驱动，每局限一次）
    this.updateTowers(dt);
    this.updateProjectiles(dt);
    this.updateAoeTimers(dt);
    this.updateParticles(dt);
    this.updateDamageNumbers(dt);
    this.killFlash = Math.max(0, this.killFlash - dt);
    this.updateExtraction(dt);

    this.updateHUD();
  }

}


