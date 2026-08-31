class Expedition {
  constructor(mapId) {
    this.map = CONFIG.maps.find(m => m.id === mapId);
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
    this.weaponIndex = Math.max(0, CONFIG.weapons.findIndex(weapon => weapon.id === GameState.selectedWeapon));
    if (this.weaponIndex < 0) this.weaponIndex = 0;
    this.weapon = CONFIG.weapons[this.weaponIndex];
    this.weaponPulse = 0;
    this.consumableFlashes = {};
    this.skillBoosts = CardSystem.getSelectedBoosts();
    this.consumables = { ...GameState.loadout };
    this.monsters = [];
    this.chests = [];
    this.towers = [];
    this.raiders = [];
    this.terrainPatches = [];
    this.terrainFields = [];
    this.terrainRoads = [];
    this.terrainDecor = [];
    this.obstacles = [];
    this.traps = [];
    this.groundLoot = [];
    this.projectiles = [];
    this.particles = [];
    this.damageNumbers = [];
    this.hitStop = 0;
    this.killFlash = 0;
    this.extractPoints = [];
    this.bag = []; // 背包物资
    this.safeBox = []; // 安全箱（阵亡保留）
    this.extracting = false;
    this.extractProgress = 0;
    this.extractType = null; // 'fixed' or 'signal'
    this.killCount = 0;
    this.chestOpened = 0;
    this.damageTaken = 0;
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
      nextIn: 48,
      active: false,
      remaining: 0,
      duration: 0
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
    ['bat', 'spider', 'boar'].forEach(type => {
      this.monsterSprites[type] = {};
      ['idle', 'attack', 'hit', 'death'].forEach(state => {
        const sprite = new Image();
        sprite.src = `assets/monsters/${type}-${state}.webp`;
        this.monsterSprites[type][state] = sprite;
      });
    });
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

    this.generateTerrain();
    this.spawnEntities();
    this.obstacleSpatialHash.rebuild(this.obstacles);
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
      fogCtx.fillStyle = 'rgba(10,16,24,.78)';
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
    return {
      enemyHp: 1 + (tier - 1) * 0.32,
      enemyDamage: 1 + (tier - 1) * 0.22,
      enemySpeed: 1 + (tier - 1) * 0.055,
      reward: 1 + (tier - 1) * 0.48,
      eliteChance: tier < 3 ? 0 : 0.08 + tier * 0.025,
      bossHp: 520 + tier * 260,
      bossDamage: 14 + tier * 5,
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
      const waterChance = 0.14 + this.map.tier * 0.015;
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
      const footprint = { tree:24, bush:24, rock:19, hay:20, fence:26, ruin:25, deadTree:20, toxicCrystal:16, voidCrystal:16, monolith:19 };
      const footprintShape = {
        tree: { rx: 29, ry: 17, offsetY: 4 },
        bush: { rx: 31, ry: 17, offsetY: 4 },
        rock: { rx: 23, ry: 15, offsetY: 3 },
        deadTree: { rx: 24, ry: 15, offsetY: 3 },
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
    ctx.fillStyle = this.map.bgColor;
    ctx.fillRect(0, 0, viewW, viewH);

    // Continuous grass field: no square tile boundaries or visible grid lines.
    ctx.save();
    ctx.globalAlpha = 0.11;
    ctx.strokeStyle = theme.glow;
    ctx.lineWidth = 1;
    const seed = Math.floor(cam.x / 38) * 17 + Math.floor(cam.y / 38) * 31;
    for (let i = 0; i < 160; i++) {
      const x = ((i * 83 + seed * 7) % (viewW + 80)) - 40;
      const y = ((i * 137 + seed * 11) % (viewH + 80)) - 40;
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
      ctx.drawImage(chunk, cx * chunkSize - cam.x, cy * chunkSize - cam.y);
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
    const scale = (monster.elite ? 1.18 : 1) * (monster.radius / 18) * this.getDepthScale(monster.y);
    const stride = Math.sin(monster.animTime || 0);
    const hpPct = clamp(monster.hp / monster.maxHp, 0, 1);
    ctx.save();
    const lift = monster.visualZ || 0;
    this.renderCastShadow(ctx, monster.x, monster.y, 28 * scale, 28 * scale, 0.38, lift);
    ctx.translate(sx, sy - lift);
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
    // 撤离点（地图边缘2个）
    this.extractPoints = [
      { x: rand(100, 300), y: rand(100, size-100), radius: 50 },
      { x: rand(size-300, size-100), y: rand(100, size-100), radius: 50 }
    ];
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
      attackRange:70, attackCd:1.5, abilityCd:4, phase:1, stunned:0,
      facing:0, animTime:0, hitFlash:0, elite:true, gold:100 * this.map.tier,
    };
    this.monsters.push(this.boss);
    showToast(`区域首领「${this.boss.name}」已现身`, 'warning');
  }

  spawnBeastWave() {
    this.beastWave.wave++;
    this.beastWave.active = true;
    this.beastWave.duration = 32 + this.map.tier * 3;
    const count = Math.min(42, 10 + this.map.tier * 4 + this.beastWave.wave * 4);
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
        elite: false, abilityCd: rand(1, 4), packOffset: rand(-1, 1), beastWave: true, state: 'idle', stateTimer: 0
      });
    }
    this.beastWave.remaining = count;
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
    this.keydownHandler = (e) => {
      this.keys[e.key.toLowerCase()] = true;
      if (e.key === 'Escape') this.paused = !this.paused;
      if (e.key === '1') this.useSkill(0);
      if (e.key === '2') this.useSkill(1);
      if (e.key === '3') this.useSkill(2);
      if (e.key === '4') this.useSkill(3);
      if (e.key === 'Tab' || e.key.toLowerCase() === 'v') { e.preventDefault(); this.cycleWeapon(1); }
      if (e.key === 'q' && e.shiftKey) { e.preventDefault(); this.cycleWeapon(-1); }
      if (e.key.toLowerCase() === 'q' && !e.shiftKey) this.useConsumable('herb_kit');
      if (e.key.toLowerCase() === 'r') this.useConsumable('thorn_storm');
      if (e.key.toLowerCase() === 'e') this.useConsumable('signal_flare');
    };
    this.keyupHandler = (e) => { this.keys[e.key.toLowerCase()] = false; };
    this.mousemoveHandler = (e) => {
      const rect = canvas.getBoundingClientRect();
      this.mouse.x = (e.clientX - rect.left) * (canvas.width / rect.width);
      this.mouse.y = (e.clientY - rect.top) * (canvas.height / rect.height);
    };
    this.mousedownHandler = (e) => {
      if (e.button === 0) {
        this.mouse.down = true;
        this.tryInteract();
      }
    };
    this.mouseupHandler = (e) => { if (e.button === 0) this.mouse.down = false; };
    this.contextmenuHandler = (e) => e.preventDefault();
    this.wheelHandler = (e) => { if (e.deltaY !== 0) { e.preventDefault(); this.cycleWeapon(e.deltaY > 0 ? 1 : -1); } };

    window.addEventListener('keydown', this.keydownHandler);
    window.addEventListener('keyup', this.keyupHandler);
    canvas.addEventListener('mousemove', this.mousemoveHandler);
    canvas.addEventListener('mousedown', this.mousedownHandler);
    canvas.addEventListener('mouseup', this.mouseupHandler);
    canvas.addEventListener('contextmenu', this.contextmenuHandler);
    canvas.addEventListener('wheel', this.wheelHandler, { passive: false });
  }

  cleanup() {
    window.removeEventListener('keydown', this.keydownHandler);
    window.removeEventListener('keyup', this.keyupHandler);
    canvas.removeEventListener('mousemove', this.mousemoveHandler);
    canvas.removeEventListener('mousedown', this.mousedownHandler);
    canvas.removeEventListener('mouseup', this.mouseupHandler);
    canvas.removeEventListener('contextmenu', this.contextmenuHandler);
    canvas.removeEventListener('wheel', this.wheelHandler);
  }

  cycleWeapon(direction = 1) {
    this.weaponIndex = (this.weaponIndex + direction + CONFIG.weapons.length) % CONFIG.weapons.length;
    this.weapon = CONFIG.weapons[this.weaponIndex];
    GameState.selectedWeapon = this.weapon.id;
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
          this.damageEnemy(m, skill.damage, '#f2c45b', true);
          m.stunned = 0.5;
        }
      });
      this.spawnAoeEffect(px, py, skill.range, '#f2c45b', 'ring');
      this.spawnRadialBurst(px, py, '#fff0a6', 12);
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
          this.damageEnemy(m, item.damage, '#ff9a55', true);
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
    } else {
      this.bag.push(item);
      this.spawnAoeEffect(x, y, 34, '#f6c75b');
      showToast(`拾取 ${item.icon} ${item.name} ×${item.amount}`, 'gold');
    }
    this.updateHUD();
    return true;
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
    this.player.attackCd = this.weapon.cooldown;
    const worldMouseX = this.mouse.x + this.camera.x;
    const worldMouseY = this.mouse.y + this.camera.y;
    const angle = Math.atan2(worldMouseY - this.player.y, worldMouseX - this.player.x);
    this.player.angle = angle;
    this.weaponPulse = 0.18;
    this.attackAnim = 0.24;
    if (this.weapon.mode === 'melee') {
      [...this.monsters, ...this.raiders].forEach(m => {
        const d = dist(m, this.player);
        if (d < this.weapon.range) {
          const mAngle = Math.atan2(m.y - this.player.y, m.x - this.player.x);
          const angleDiff = Math.abs(((mAngle - angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          if (angleDiff < Math.PI / 2) {
            this.damageEnemy(m, this.weapon.damage, this.weapon.color, true); m.stunned = 0.2;
            m.visualVz = Math.max(m.visualVz || 0, 105);
          }
        }
      });
      this.spawnSlashEffect(this.player.x, this.player.y, angle, this.weapon.color, 64);
    } else {
      this.projectiles.push({ x: this.player.x + Math.cos(angle) * 24, y: this.player.y + Math.sin(angle) * 24,
        vx: Math.cos(angle) * this.weapon.projectileSpeed, vy: Math.sin(angle) * this.weapon.projectileSpeed,
        damage: this.weapon.damage, life: this.weapon.range / this.weapon.projectileSpeed, radius: 7,
        fromPlayer: true, weaponId: this.weapon.id, pierce: this.weapon.pierce || 1, color: this.weapon.color, hit: [] });
      this.spawnMuzzleEffect(this.player.x, this.player.y, angle, this.weapon.color);
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
    showToast(type === 'signal' ? '信号弹撤离启动！坚持20秒！' : '开始撤离读条，坚持15秒！', 'warning');
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
    this.endExpedition();
  }

  playerDeath() {
    this.gameOver = true;
    this.result = 'failed';
    AudioManager.playDeath();
    this.endExpedition();
  }

  endExpedition() {
    this.cleanup();
    // 计算结算
    const totalGold = this.bag.filter(i => i.type === 'gold').reduce((s, i) => s + i.amount, 0);
    const keptItems = [];
    const lostItems = [];

    if (this.result === 'success') {
      // 成功：全部保留
      this.bag.forEach(i => keptItems.push({ ...i, kept: true }));
      GameState.gold += totalGold;
      this.bag.filter(i => i.type === 'seed').forEach(i => {
        Warehouse.addItem('seeds', i.amount);
        if (i.cropId && !GameState.unlockedCrops.includes(i.cropId)) {
          GameState.unlockedCrops.push(i.cropId);
          showToast(`解锁新作物：${CONFIG.crops.find(crop => crop.id === i.cropId)?.name || i.name}`, 'gold');
        }
      });
      this.bag.filter(i => i.type === 'material').forEach(i => {
        Warehouse.addItem('materials', i.amount);
      });
      this.bag.filter(i => i.type === 'consumable').forEach(i => {
        Warehouse.addItem(i.id, i.amount);
      });
      this.bag.filter(i => i.type === 'farm_item').forEach(i => {
        Warehouse.addItem(i.id, i.amount);
      });
    } else {
      // 失败：只有安全箱保留（简化：随机保留20%）
      this.bag.forEach(i => {
        if (Math.random() < 0.2) {
          keptItems.push({ ...i, kept: true });
          if (i.type === 'gold') GameState.gold += Math.floor(i.amount * 0.2);
          if (i.type === 'seed') Warehouse.addItem('seeds', Math.floor(i.amount * 0.5));
          if (i.type === 'material') Warehouse.addItem('materials', Math.floor(i.amount * 0.5));
          if (i.type === 'consumable') Warehouse.addItem(i.id, Math.max(1, Math.floor(i.amount * 0.5)));
        } else {
          lostItems.push({ ...i, kept: false });
        }
      });
    }

    SaveSystem.save();

    // 显示结算
    Game.showResult({
      success: this.result === 'success',
      mapName: this.map.name,
      timeUsed: (CONFIG.expedition.demoDuration - this.timeLeft).toFixed(1),
      kills: this.killCount,
      chests: this.chestOpened,
      damageTaken: this.damageTaken,
      goldEarned: this.result === 'success' ? totalGold : Math.floor(totalGold * 0.2),
      keptItems, lostItems
    });
  }

  spawnHitParticles(x, y, color) {
    for (let i = 0; i < 11; i++) {
      this.particles.push({
        x, y, vx: rand(-175, 175), vy: rand(-175, 175),
        life: 0.46, maxLife: 0.46, color, size: rand(2, 6)
      });
    }
  }

  damageEnemy(target, amount, color = '#ffffff', heavy = false) {
    if (!target || target.hp <= 0) return;
    target.hp -= amount;
    target.hitFlash = heavy ? 0.22 : 0.14;
    target.state = target.hp <= 0 ? 'death' : 'hit';
    target.stateTimer = target.hp <= 0 ? .4 : .18;
    this.damageNumbers.push({
      x: target.x + rand(-8, 8), y: target.y - target.radius - 8,
      value: Math.round(amount), color, life: 0.72, maxLife: 0.72,
      vx: rand(-10, 10), vy: heavy ? -64 : -48, heavy
    });
    this.spawnHitParticles(target.x, target.y, color);
    this.hitStop = Math.max(this.hitStop, heavy ? 0.065 : 0.032);
    AudioManager.playMonsterHit(heavy ? 'heavy' : 'normal');
  }

  spawnKillFeedback(target) {
    this.killFlash = Math.max(this.killFlash, target.type === 'boss' ? 0.22 : 0.11);
    this.hitStop = Math.max(this.hitStop, target.type === 'boss' ? 0.13 : 0.07);
    this.screenShake = Math.max(this.screenShake, target.type === 'boss' ? 1 : 0.65);
    this.spawnRadialBurst(target.x, target.y, target.type === 'boss' ? '#ffe8a0' : '#ff7868', target.type === 'boss' ? 30 : 18);
    AudioManager.playMonsterHit('kill');
  }

  spawnAoeEffect(x, y, radius, color) {
    this.particles.push({
      x, y, vx: 0, vy: 0, life: 0.5, maxLife: 0.5,
      color, size: radius, type: 'aoe'
    });
  }

  spawnSlashEffect(x, y, angle, color = '#ffffff', size = 50) {
    this.particles.push({
      x, y, vx: 0, vy: 0, life: 0.2, maxLife: 0.2,
      color, size, angle, type: 'slash'
    });
  }

  spawnMuzzleEffect(x, y, angle, color) {
    for (let i = 0; i < 6; i++) {
      const spread = angle + rand(-0.32, 0.32);
      this.particles.push({ x: x + Math.cos(angle) * 22, y: y + Math.sin(angle) * 22,
        vx: Math.cos(spread) * rand(65, 150), vy: Math.sin(spread) * rand(65, 150),
        life: 0.22, maxLife: 0.22, color, size: rand(2, 5), type: 'spark' });
    }
  }

  spawnWeaponSwitchEffect() {
    const colors = ['#f2c45b', '#75dc68', '#7be5c4'];
    colors.forEach((color, ring) => this.particles.push({ x: this.player.x, y: this.player.y,
      vx: 0, vy: 0, life: 0.38 + ring * 0.08, maxLife: 0.38 + ring * 0.08,
      color, size: 34 + ring * 10, type: 'weaponRing' }));
  }

  spawnRadialBurst(x, y, color, count = 10) {
    for (let i = 0; i < count; i++) {
      const angle = Math.PI * 2 * i / count + rand(-0.1, 0.1);
      this.particles.push({ x, y, vx: Math.cos(angle) * rand(100, 230), vy: Math.sin(angle) * rand(100, 230),
        life: 0.48, maxLife: 0.48, color, size: rand(3, 7), type: 'chaff' });
    }
  }

  spawnVineEffect(x, y, radius) {
    for (let i = 0; i < 9; i++) {
      const angle = Math.PI * 2 * i / 9;
      this.particles.push({ x, y, vx: 0, vy: 0, life: 0.75, maxLife: 0.75,
        color: i % 2 ? '#89db67' : '#3f9d56', size: radius * rand(0.62, 1), angle, type: 'vine' });
    }
  }

  spawnDashTrail(x, y, angle, color) {
    for (let i = 0; i < 7; i++) this.particles.push({
      x: x - Math.cos(angle) * i * 22, y: y - Math.sin(angle) * i * 22,
      vx: 0, vy: 0, life: 0.38 - i * 0.025, maxLife: 0.38,
      color, size: 18 - i, angle, type: 'earthTrail'
    });
  }

  spawnSmokeEffect(x, y) {
    for (let i = 0; i < 18; i++) {
      const angle = rand(0, Math.PI * 2), speed = rand(22, 85);
      this.particles.push({ x: x + rand(-20, 20), y: y + rand(-20, 20),
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: rand(0.7, 1.15), maxLife: 1.15, color: i % 3 ? '#808c88' : '#b5c3ba',
        size: rand(12, 28), type: 'smoke' });
    }
  }

  spawnDashParticles(x, y, angle) {
    for (let i = 0; i < 8; i++) {
      this.particles.push({
        x: x - Math.cos(angle) * i * 15,
        y: y - Math.sin(angle) * i * 15,
        vx: rand(-30, 30), vy: rand(-30, 30),
        life: 0.3, maxLife: 0.3, color: '#88ccff', size: rand(3, 6)
      });
    }
  }

  update(dt) {
    if (this.paused || this.gameOver) return;
    this.updateWorldSystems(dt);
    this.fogUpdateTimer -= dt;
    if (this.fogUpdateTimer <= 0) {
      this.fogUpdateTimer += this.fogUpdateInterval;
      this.fogDirty = true;
    }
    this.entitySpatialHash.rebuild([...this.monsters, ...this.raiders]);
    this.pickupLoot();

    // 倒计时
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.playerDeath();
      return;
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
    speed *= terrainModifier;
    const previousX = this.player.x;
    const previousY = this.player.y;
    this.player.x += dx * speed * dt;
    this.player.y += dy * speed * dt;
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

    // 能量恢复
    this.player.energy = Math.min(this.player.maxEnergy, this.player.energy + CONFIG.player.energyRegen * dt);

    // 计时器
    this.player.attackCd = Math.max(0, this.player.attackCd - dt);
    this.player.invuln = Math.max(0, this.player.invuln - dt);
    this.player.stealth = Math.max(0, this.player.stealth - dt);
    this.player.slow = Math.max(0, this.player.slow - dt);
    this.weaponPulse = Math.max(0, this.weaponPulse - dt);
    this.attackAnim = Math.max(0, this.attackAnim - dt);
    this.screenShake = Math.max(0, this.screenShake - dt * 4.5);
    this.player.visualZ = Math.max(0, this.player.visualZ + this.player.visualVz * dt);
    this.player.visualVz -= 360 * dt;
    if (this.player.visualZ <= 0) { this.player.visualZ = 0; this.player.visualVz = 0; }
    this.monsters.forEach(monster => {
      monster.deathTimer = Math.max(0, (monster.deathTimer || 0) - dt);
      monster.visualZ = Math.max(0, (monster.visualZ || 0) + (monster.visualVz || 0) * dt);
      monster.visualVz = (monster.visualVz || 0) - 330 * dt;
      if (monster.visualZ <= 0) { monster.visualZ = 0; monster.visualVz = 0; }
    });
    for (let i = 0; i < 4; i++) {
      this.skillCooldowns[i] = Math.max(0, this.skillCooldowns[i] - dt);
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
    this.camera.x = lerp(this.camera.x, cameraTargetX, 0.085);
    this.camera.y = lerp(this.camera.y, cameraTargetY, 0.085);

    // 怪物AI
    this.monsters.forEach(m => {
      if (m.hp <= 0) return;
      m.attackCd = Math.max(0, m.attackCd - dt);
      m.stunned = Math.max(0, m.stunned - dt);
      m.hitFlash = Math.max(0, (m.hitFlash || 0) - dt);
      m.stateTimer = Math.max(0, (m.stateTimer || 0) - dt);
      m.animTime = (m.animTime || 0) + dt * (1.8 + m.speed / 120);
      if (m.stunned > 0) return;

      const d = dist(m, this.player);
      const canSee = this.beastWave.active || (this.player.stealth <= 0 && d < 400);

      if (canSee) {
        // 追击
        const angle = Math.atan2(this.player.y - m.y, this.player.x - m.x);
        m.facing = angle;
        if (d > m.attackRange) {
          m.state = 'move';
          this.moveEntityWithCollisions(m, Math.cos(angle) * m.speed * dt, Math.sin(angle) * m.speed * dt);
        } else if (m.attackCd <= 0) {
          // 攻击
          m.state = 'attack'; m.stateTimer = .28;
          m.attackCd = m.attackCooldown;
          if (m.ranged) {
            this.projectiles.push({
              x: m.x, y: m.y,
              vx: Math.cos(angle) * 300, vy: Math.sin(angle) * 300,
              damage: m.damage, life: 2, fromMonster: true, radius: 6,
              monsterType: m.type, color: m.type === 'spider' ? '#9bea55' : '#ff6644'
            });
          } else {
            this.damagePlayer(m.damage);
          }
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
        this.moveEntityWithCollisions(m, Math.cos(angle) * m.speed * 0.3 * dt, Math.sin(angle) * m.speed * 0.3 * dt);
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
        this.spawnKillFeedback(m);
        this.spawnHitParticles(m.x, m.y, '#ff4444');
        if (m.type === 'boss') {
          this.spawnGroundLoot({ type: 'material', name: '首领核心', amount: 2 + this.map.tier, icon: '◆' }, m.x + 18, m.y);
          this.spawnGroundLoot({ type: 'gold', name: '首领赏金', amount: 150 * this.map.tier, icon: '💰' }, m.x - 18, m.y);
          showToast(`首领「${m.name}」已击败，撤离奖励提升`, 'success');
          this.boss = null;
        }
        // 掉落
        if (Math.random() < 0.3) {
          this.spawnGroundLoot({ type: 'gold', name: '金币', amount: m.gold || 5, icon: '💰' }, m.x, m.y);
        }
        if (m.type !== 'boss' && Math.random() < 0.055) {
          this.spawnGroundLoot({ type: 'invincible', name: '无敌核心', amount: 1, icon: '🛡️', duration: 5 }, m.x, m.y);
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
          this.projectiles.push({
            x: r.x, y: r.y,
            vx: Math.cos(angle) * 250, vy: Math.sin(angle) * 250,
            damage: r.damage, life: 2, fromMonster: true, radius: 6
          });
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
          this.damageEnemy(nearest, t.damage * (this.beastWave.active ? 2.15 : 1), '#8affb5');
          t.attackCd = this.beastWave.active ? 0.42 : 0.72;
          this.projectiles.push({
            x: t.x, y: t.y,
            vx: (nearest.x - t.x) / minD * 400,
            vy: (nearest.y - t.y) / minD * 400,
            damage: 0, life: 0.3, fromTower: true, radius: 4, target: nearest
          });
        }
      } else if (t.state === 'enemy') {
        // 攻击玩家
        if (dist(t, this.player) < t.range) {
          this.damagePlayer(t.damage);
          t.attackCd = 1.0;
        }
      }
    });

    // 子弹
    this.projectiles = this.projectiles.filter(p => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) return false;
      if (p.fromPlayer) {
        for (const target of [...this.monsters, ...this.raiders]) {
          if (target.hp <= 0 || p.hit.includes(target)) continue;
          if (dist(p, target) < target.radius + p.radius) {
            this.damageEnemy(target, p.damage, p.color, p.weaponId === 'vine_staff');
            target.visualVz = Math.max(target.visualVz || 0, p.weaponId === 'vine_staff' ? 82 : 52);
            p.hit.push(target);
            p.pierce--;
            if (p.weaponId === 'vine_staff') target.stunned = Math.max(target.stunned || 0, 0.18);
            if (p.pierce <= 0) return false;
          }
        }
      }
      if (p.fromMonster && dist(p, this.player) < this.player.collisionRadius + p.radius) {
        this.damagePlayer(p.damage);
        return false;
      }
      return true;
    });

    // 粒子
    this.particles = this.particles.filter(p => {
      p.life -= dt;
      if (!['aoe', 'slash', 'weaponRing', 'vine', 'earthTrail'].includes(p.type)) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      return p.life > 0;
    });
    this.damageNumbers = this.damageNumbers.filter(number => {
      number.life -= dt;
      number.x += number.vx * dt;
      number.y += number.vy * dt;
      number.vy += 72 * dt;
      return number.life > 0;
    });
    this.killFlash = Math.max(0, this.killFlash - dt);

    // 撤离读条
    if (this.extracting) {
      const extractTime = this.extractType === 'signal' ? CONFIG.expedition.signalExtractTime : CONFIG.expedition.extractTime;
      // 检查是否被攻击打断（受到伤害时打断）
      this.extractProgress += dt;
      if (this.extractProgress >= extractTime) {
        this.completeExtract();
      }
    }

    this.updateHUD();
  }

  damagePlayer(amount) {
    if (this.player.invuln > 0) return;
    const defendingTower = this.towers.find(t => t.state === 'player' && dist(t, this.player) <= t.range);
    if (this.beastWave.active) {
      amount *= defendingTower ? 0.38 : 1.45;
    } else if (defendingTower) {
      amount *= 0.76;
    }
    this.player.hp -= amount;
    AudioManager.playPlayerHurt();
    this.damageTaken += amount;
    this.screenShake = Math.min(1, this.screenShake + 0.48);
    this.spawnHitParticles(this.player.x, this.player.y, '#ff4444');
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

    // Contact shadow and backpack establish the top-down silhouette.
    ctx.save(); ctx.scale(1, 0.34); ctx.fillStyle = 'rgba(0,0,0,.42)';
    ctx.beginPath(); ctx.ellipse(0, 82, 43, 17, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.fillStyle = '#553625'; ctx.strokeStyle = '#281b17'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(-29, -10, 30, 52, 8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#9a6337'; ctx.beginPath(); ctx.roundRect(-32, -5, 27, 32, 5); ctx.fill();
    ctx.strokeStyle = '#d39a4c'; ctx.beginPath(); ctx.moveTo(-28, 4); ctx.lineTo(-9, 4); ctx.stroke();
    ctx.fillStyle = '#e6bd54'; [-24, -18, -12].forEach((x, i) => { ctx.save(); ctx.translate(x, -7 - i * 3); ctx.rotate(-0.35); ctx.fillRect(-1, -14, 2, 18); ctx.restore(); });

    // Boots, patched trousers, belt, broad torso and straw collar.
    ctx.fillStyle = '#4a3026';
    [-14, 14].forEach(x => { ctx.beginPath(); ctx.roundRect(x - 11, 48, 22, 25, 7); ctx.fill(); });
    ctx.fillStyle = '#777553'; ctx.beginPath(); ctx.roundRect(-27, 25, 54, 38, 11); ctx.fill();
    ctx.fillStyle = '#a99a68'; ctx.fillRect(-23, 44, 14, 10); ctx.fillStyle = '#5a4f3b'; ctx.fillRect(8, 31, 11, 9);
    ctx.fillStyle = '#71502d'; ctx.fillRect(-30, 20, 60, 8); ctx.fillStyle = '#d2a34b'; ctx.strokeStyle = '#382619';
    ctx.beginPath(); ctx.roundRect(-7, 18, 14, 12, 2); ctx.fill(); ctx.stroke();
    const shirt = ctx.createLinearGradient(-30, -24, 30, 38); shirt.addColorStop(0, '#b7945e'); shirt.addColorStop(1, '#70553c');
    ctx.fillStyle = shirt; ctx.beginPath(); ctx.roundRect(-34, -26, 68, 55, 17); ctx.fill();
    ctx.fillStyle = '#4f4035'; ctx.beginPath(); ctx.roundRect(13, -4, 15, 12, 2); ctx.fill();
    ctx.fillStyle = '#d8b85d'; ctx.beginPath(); ctx.moveTo(-35, -27); ctx.lineTo(-22, -39); ctx.lineTo(0, -31); ctx.lineTo(22, -39); ctx.lineTo(36, -25); ctx.lineTo(26, -14); ctx.lineTo(-25, -14); ctx.closePath(); ctx.fill();

    // Arms and hands stay readable at game scale.
    ctx.strokeStyle = '#d98f6f'; ctx.lineWidth = 13; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-28, -8); ctx.lineTo(-39, 23); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(27, -7); ctx.lineTo(39, 19); ctx.stroke();
    ctx.fillStyle = '#e6a07e'; [-40, 40].forEach((x, i) => { ctx.beginPath(); ctx.arc(x, 25 - i * 5, 7, 0, Math.PI * 2); ctx.fill(); });

    // Head, red beard, large nose and expressive eyes from the turn-around reference.
    ctx.fillStyle = '#c84e2f'; ctx.beginPath(); ctx.arc(0, -47, 30, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-27, -42); ctx.quadraticCurveTo(-24, -15, 0, -10); ctx.quadraticCurveTo(24, -15, 28, -43); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#efb092'; ctx.beginPath(); ctx.ellipse(0, -51, 23, 21, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d76547'; ctx.beginPath(); ctx.ellipse(0, -44, 11, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff8de'; [-8, 8].forEach(x => { ctx.beginPath(); ctx.ellipse(x, -57, 6, 8, 0, 0, Math.PI * 2); ctx.fill(); });
    ctx.fillStyle = '#2a211d'; [-8, 8].forEach(x => { ctx.beginPath(); ctx.arc(x + 1, -57, 2.2, 0, Math.PI * 2); ctx.fill(); });
    ctx.strokeStyle = '#7c251c'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, -34, 13, 0.2, Math.PI - 0.2); ctx.stroke();

    // Weathered metal hat, wheat decoration and side hook.
    ctx.fillStyle = '#505654'; ctx.strokeStyle = '#271f1d'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(0, -70, 37, 8, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.roundRect(-24, -92, 48, 23, 9); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#e0a841'; ctx.lineWidth = 2;
    [-6, 1, 8].forEach((x, i) => { ctx.beginPath(); ctx.moveTo(x, -75); ctx.lineTo(x + 7 + i * 2, -104); ctx.stroke();
      for (let j = 0; j < 4; j++) { const yy = -84 - j * 5; ctx.beginPath(); ctx.ellipse(x + 5 + i + j, yy, 3, 1.5, -0.6, 0, Math.PI * 2); ctx.fillStyle = '#e0a841'; ctx.fill(); } });
    ctx.strokeStyle = '#303534'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(24, -82); ctx.quadraticCurveTo(42, -82, 38, -66); ctx.lineTo(44, -63); ctx.stroke();

    this.renderHeroWeapon(ctx, angle, swing);
    ctx.restore();
  }

  renderHeroWeapon(ctx, angle, swing) {
    const localAngle = Math.atan2(Math.sin(angle), Math.abs(Math.cos(angle))) + swing * 0.8;
    ctx.save(); ctx.translate(28, 6); ctx.rotate(localAngle * 0.45 - 0.25);
    if (this.weapon.id === 'harvest_sickle') {
      ctx.strokeStyle = '#684328'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(-5, 17); ctx.lineTo(30, -31); ctx.stroke();
      const blade = ctx.createLinearGradient(22, -38, 51, -22); blade.addColorStop(0, '#fff2bd'); blade.addColorStop(1, '#8c9c99');
      ctx.strokeStyle = blade; ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(25, -22, 22, -1.25, 0.4); ctx.stroke();
    } else if (this.weapon.id === 'pea_repeater') {
      ctx.fillStyle = '#496b32'; ctx.strokeStyle = '#22331f'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(-3, -12, 41, 18, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#82bd48'; ctx.beginPath(); ctx.arc(35, -3, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#d2ae52'; ctx.fillRect(7, 5, 8, 19);
    } else {
      ctx.strokeStyle = '#67462d'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(0, 17); ctx.lineTo(34, -30); ctx.stroke();
      ctx.strokeStyle = '#4f9b64'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(31, -33, 13, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#86f0c9'; ctx.shadowColor = '#86f0c9'; ctx.shadowBlur = 12; ctx.beginPath(); ctx.arc(31, -33, 6, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    }
    ctx.restore();
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
      ? `<div class="wave-status active"><b>⚠ 第 ${this.beastWave.wave} 波兽潮</b><span>剩余 ${this.beastWave.remaining} 只 · ${protectedByTower ? '防御塔护盾生效' : '未受保护，伤害提升'}</span></div>`
      : `<div class="wave-status"><b>兽潮预警 ${Math.ceil(this.beastWave.nextIn)}s</b><span>已占塔 ${ownedTowers} · 提前进入绿色射程</span></div>`;
    panel.innerHTML = `<div class="mission-label">远征任务</div><strong>${objective.title}${objective.complete ? ' · 已完成' : ''}</strong><span>${objective.description}</span><div class="mission-progress"><i style="width:${progress/objective.target*100}%"></i></div><small>${progress}/${objective.target}</small>${waveMarkup}${eventMarkup}${this.boss && this.boss.hp > 0 ? `<div class="boss-hud"><b>${this.boss.name}</b><span>阶段 ${this.boss.phase}</span><i style="width:${this.boss.hp/this.boss.maxHp*100}%"></i></div>` : ''}`;
  }

  updateHUD() {
    this.renderMissionHUD();
    // 血条能量条
    document.getElementById('hpBar').style.width = (this.player.hp / this.player.maxHp * 100) + '%';
    document.getElementById('hpText').textContent = `${Math.ceil(this.player.hp)}/${this.player.maxHp}`;
    document.getElementById('energyBar').style.width = (this.player.energy / this.player.maxEnergy * 100) + '%';
    document.getElementById('energyText').textContent = `${Math.ceil(this.player.energy)}/${this.player.maxEnergy}`;

    // 计时器
    const mins = Math.floor(this.timeLeft / 60);
    const secs = Math.floor(this.timeLeft % 60);
    const timerEl = document.getElementById('timerDisplay');
    timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    timerEl.className = 'timer-display' + (this.timeLeft < 30 ? ' critical' : (this.timeLeft < 180 ? ' pressure' : ''));
    document.getElementById('mapNameDisplay').textContent = `T${this.map.tier} · ${this.map.name} · ${this.map.danger}`;
    document.getElementById('lowHealthVignette').classList.toggle('active', this.player.hp / this.player.maxHp <= 0.3);
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
      div.innerHTML = `
        <span class="skill-key">${skill.key}</span>
        <span class="skill-icon">${skill.icon}</span>
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
      div.innerHTML = `
        <span class="skill-key">${item.key}</span>
        <span class="skill-icon">${item.icon}</span>
        <span class="skill-name">${item.name}</span>
        <div class="skill-meta"><span>${effectText}</span><span>一次性</span></div>
        <span class="skill-count">×${count}</span>
      `;
      consumableBar.appendChild(div);
    });

    // 背包显示
    const bagDisplay = document.getElementById('bagDisplay');
    const gold = this.bag.filter(i => i.type === 'gold').reduce((s, i) => s + i.amount, 0);
    const seeds = this.bag.filter(i => i.type === 'seed').length;
    bagDisplay.innerHTML = `
      <div class="bag-item">💰 ${gold}</div>
      <div class="bag-item">🌱 ${seeds}</div>
      <div class="bag-item">📦 ${this.bag.length}件</div>
      <div class="bag-item" style="border-color:#d7a83d;color:#f2d078;">🔐 安全箱 2格</div>
    `;
  }

  render(ctx) {
    const cam = this.camera;
    const size = CONFIG.expedition.mapSize;
    if (this.activeEvent?.id === 'mist') {
      const fog = ctx.createRadialGradient(CONFIG.canvas.width/2, CONFIG.canvas.height/2, 150, CONFIG.canvas.width/2, CONFIG.canvas.height/2, 650);
      fog.addColorStop(0, 'rgba(190,215,220,.02)'); fog.addColorStop(.55, 'rgba(150,180,185,.18)'); fog.addColorStop(1, 'rgba(12,23,28,.72)');
      ctx.fillStyle=fog; ctx.fillRect(0,0,CONFIG.canvas.width,CONFIG.canvas.height);
    }

    // 分层地形：道路、水域、田块、树林和地图专属地标。
    this.renderTerrain(ctx, cam);

    // 地图边界
    ctx.strokeStyle = this.map.accentColor;
    ctx.lineWidth = 4;
    ctx.globalAlpha = 0.82;
    ctx.strokeRect(-cam.x, -cam.y, size, size);
    ctx.globalAlpha = 1;

    // 障碍物按 Y 轴分为玩家身后与身前两层，形成遮挡关系和俯视伪 3D 深度。
    this.obstacles.filter(obstacle => obstacle.y <= this.player.y).sort((a, b) => a.y - b.y)
      .forEach(obstacle => this.renderObstacle(ctx, obstacle, cam));

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
      ctx.font = '25px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(item.icon, sx, sy + 7);
      if (near) {
        ctx.fillStyle = '#f6d77e';
        ctx.font = '10px sans-serif';
        ctx.fillText(`自动拾取 ${item.name}`, sx, sy - 22);
      }
    });

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

    // 怪物
    this.monsters.forEach(m => {
      if (!this.isWorldVisible(m.x, m.y)) return;
      const sx = m.x - cam.x, sy = m.y - cam.y;
      if (sx < -50 || sx > CONFIG.canvas.width + 50 || sy < -50 || sy > CONFIG.canvas.height + 50) return;
      // 血条
      /* health is rendered as part of the dimensional creature model */
      // 图标
      this.renderMonster(ctx, m, cam);
      if (m.stunned > 0) {
        ctx.fillStyle = '#ffff00';
        ctx.font = '14px sans-serif';
        ctx.fillText('💫', sx, sy - m.radius - 18);
      }
    });

    // AI掠夺者
    this.raiders.forEach(r => {
      if (!this.isWorldVisible(r.x, r.y)) return;
      const sx = r.x - cam.x, sy = r.y - cam.y;
      const hpPct = r.hp / r.maxHp;
      ctx.fillStyle = '#333';
      ctx.fillRect(sx - 20, sy - r.radius - 12, 40, 5);
      ctx.fillStyle = '#ff6644';
      ctx.fillRect(sx - 20, sy - r.radius - 12, 40 * hpPct, 5);
      ctx.font = '24px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🥷', sx, sy + 8);
    });

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

    // 玩家
    const psx = this.player.x - cam.x, psy = this.player.y - cam.y;
    // 隐身效果
    ctx.globalAlpha = this.player.stealth > 0 ? 0.4 : 1;
    // 无敌闪烁
    if (this.player.invuln > 0 && Math.floor(this.player.invuln * 10) % 2 === 0) {
      ctx.globalAlpha *= 0.5;
    }
    this.renderHero(ctx, psx, psy);
    ctx.globalAlpha = 1;

    // Active weapon range and aim line.
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
    this.obstacles.filter(obstacle => obstacle.y > this.player.y).sort((a, b) => a.y - b.y)
      .forEach(obstacle => this.renderObstacle(ctx, obstacle, cam));

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
      } else if (p.type === 'slash') {
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(p.angle);
        ctx.strokeStyle = p.color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, 0, p.size, -Math.PI / 3, Math.PI / 3);
        ctx.stroke();
        ctx.restore();
        ctx.globalAlpha = 1;
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

    // 伤害跳字：上浮、渐隐，重击字号更大。
    this.damageNumbers.forEach(number => {
      const sx = number.x - cam.x, sy = number.y - cam.y;
      const alpha = clamp(number.life / number.maxLife, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `${number.heavy ? 'bold 20px' : 'bold 15px'} sans-serif`;
      ctx.textAlign = 'center'; ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(18,12,12,.85)';
      ctx.strokeText(`-${number.value}`, sx, sy);
      ctx.fillStyle = number.color;
      ctx.fillText(`-${number.value}`, sx, sy);
      ctx.restore();
    });

    if (this.killFlash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = clamp(this.killFlash * 4.2, 0, .42);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, CONFIG.canvas.width, CONFIG.canvas.height);
      ctx.restore();
    }

    // 战争迷雾：只保留已探索格与当前视野，未到达区域不显示实体信息。
    this.renderFogOfWar(ctx);

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

    // 小地图
    this.renderMinimap();

    // 交互提示
    this.renderInteractPrompt();
  }

  updateWorldSystems(dt) {
    this.elapsed += dt;
    const waveMonsters = this.monsters.filter(monster => monster.beastWave && monster.hp > 0);
    this.beastWave.remaining = waveMonsters.length;
    if (this.beastWave.active) {
      if (waveMonsters.length === 0) {
        this.beastWave.active = false;
        this.beastWave.nextIn = Math.max(58, 92 - this.map.tier * 4);
        GameState.gold += 20 * this.beastWave.wave * this.map.tier;
        showToast(`第 ${this.beastWave.wave} 波兽潮已击退，获得守塔奖励`, 'success');
      }
    } else {
      this.beastWave.nextIn -= dt;
      if (this.beastWave.nextIn <= 0) this.spawnBeastWave();
    }
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
      if (this.player.stealth > 0 || d > 430 || monster.stunned > 0) return;
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
      } else if (monster.type === 'boss' && monster.abilityCd <= 0) {
        monster.phase = monster.hp / monster.maxHp < .5 ? 2 : 1;
        monster.abilityCd = monster.phase === 2 ? 2.7 : 4.2;
        this.spawnAoeEffect(this.player.x, this.player.y, 88, '#d59aff');
        if (d < 155) this.damagePlayer(monster.damage * .72);
      }
    });
  }

  renderWeather(ctx) {
    const tier = this.map.tier;
    const t = performance.now() / 1000;
    ctx.save();
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

  renderMinimap() {
    const mm = document.getElementById('minimapCanvas');
    const mctx = mm.getContext('2d');
    const size = CONFIG.expedition.mapSize;
    const scale = 160 / size;

    mctx.fillStyle = 'rgba(0,0,0,0.8)';
    mctx.fillRect(0, 0, 160, 160);

    this.terrainPatches.forEach(patch => {
      mctx.globalAlpha = patch.type === 'water' ? 0.7 : 0.18;
      mctx.fillStyle = patch.color;
      mctx.beginPath();
      mctx.ellipse(patch.x * scale, patch.y * scale, Math.max(1, patch.rx * scale), Math.max(1, patch.ry * scale), patch.rotation, 0, Math.PI * 2);
      mctx.fill();
    });
    mctx.globalAlpha = 0.35;
    mctx.strokeStyle = this.map.terrain.path;
    mctx.lineWidth = 2;
    this.terrainRoads.forEach(road => {
      mctx.beginPath();
      mctx.moveTo(road.x1 * scale, road.y1 * scale);
      mctx.lineTo(road.x2 * scale, road.y2 * scale);
      mctx.stroke();
    });
    mctx.globalAlpha = 1;

    // 撤离点
    this.extractPoints.forEach(ep => {
      if (!this.isWorldVisible(ep.x, ep.y)) return;
      mctx.fillStyle = '#7fff7f';
      mctx.beginPath();
      mctx.arc(ep.x * scale, ep.y * scale, 4, 0, Math.PI * 2);
      mctx.fill();
    });
    // 宝箱
    this.chests.forEach(c => {
      if (!this.isWorldVisible(c.x, c.y)) return;
      if (!c.opened) {
        mctx.fillStyle = '#ffd700';
        mctx.fillRect(c.x * scale - 2, c.y * scale - 2, 4, 4);
      }
    });
    // 怪物
    this.monsters.forEach(m => {
      if (!this.isWorldVisible(m.x, m.y)) return;
      mctx.fillStyle = '#ff4444';
      mctx.fillRect(m.x * scale - 1, m.y * scale - 1, 3, 3);
    });
    // 掠夺者
    this.raiders.forEach(r => {
      if (!this.isWorldVisible(r.x, r.y)) return;
      mctx.fillStyle = '#ff8800';
      mctx.fillRect(r.x * scale - 2, r.y * scale - 2, 4, 4);
    });
    // 防御塔
    this.towers.forEach(t => {
      if (!this.isWorldVisible(t.x, t.y)) return;
      if (t.state === 'player') mctx.fillStyle = '#7fff7f';
      else if (t.state === 'enemy') mctx.fillStyle = '#ff4444';
      else mctx.fillStyle = '#666';
      mctx.fillRect(t.x * scale - 2, t.y * scale - 2, 4, 4);
    });
    // 陷阱与地面战利品
    this.traps.forEach(trap => {
      if (!this.isWorldVisible(trap.x, trap.y)) return;
      mctx.globalAlpha = 0.65;
      mctx.fillStyle = trap.color;
      mctx.fillRect(trap.x * scale - 1, trap.y * scale - 1, 3, 3);
    });
    this.groundLoot.forEach(item => {
      if (!this.isWorldVisible(item.x, item.y)) return;
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
