/* Expedition 原型混合：地形/迷雾/碰撞/地图生成与空间查询（由 expedition.js 拆分） */
Object.assign(Expedition.prototype, {
  getVisionKey(x, y) {
    const cell = this.visionCellSize;
    return `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  },

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
  },

  isWorldVisible(x, y) {
    const radius = this.visionRadius * (this.eventModifiers?.vision || 1);
    // 实时视野：离开当前视野后，所有地图实体都隐藏。
    return dist({ x, y }, this.player) <= radius;
  },

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
  },

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
  },

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
  },

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
  },

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
  },

  getDepthScale(worldY) {
    const screenY = worldY - this.camera.y;
    return clamp(0.82 + screenY / CONFIG.canvas.height * 0.24, 0.78, 1.1);
  },

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
  },

  isBehindHero(obstacle) {
    const closeX = Math.abs(obstacle.x - this.player.x) < obstacle.radius + 34;
    const inOcclusionBand = obstacle.y > this.player.y - 92 && obstacle.y < this.player.y + 18;
    return closeX && inOcclusionBand && ['tree', 'deadTree', 'ruin', 'monolith', 'crystal', 'toxicCrystal'].includes(obstacle.type);
  },

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
  },

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
  },

  moveEntityWithCollisions(entity, dx, dy, radius = entity.collisionRadius || entity.radius * .72) {
    if (!dx && !dy) return;
    const oldX = entity.x, oldY = entity.y;
    entity.x += dx;
    if (this.collidesWithObstacle(entity.x, entity.y, radius)) entity.x = oldX;
    entity.y += dy;
    if (this.collidesWithObstacle(entity.x, entity.y, radius)) entity.y = oldY;
    entity.x = clamp(entity.x, radius, CONFIG.expedition.mapSize - radius);
    entity.y = clamp(entity.y, radius, CONFIG.expedition.mapSize - radius);
  },

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
  },

  findSafeSpawn(minEdge, maxEdge, radius = 20, minPlayerDist = 140) {
    let position = { x: rand(minEdge, maxEdge), y: rand(minEdge, maxEdge) };
    for (let attempt = 0; attempt < 24; attempt++) {
      if (!this.collidesWithObstacle(position.x, position.y, radius + 12) && dist(position, this.player) > minPlayerDist) {
        return position;
      }
      position = { x: rand(minEdge, maxEdge), y: rand(minEdge, maxEdge) };
    }
    // 兜底：至少保证离玩家足够远（避免怪刷脸上）
    for (let attempt = 0; attempt < 12; attempt++) {
      position = { x: rand(minEdge, maxEdge), y: rand(minEdge, maxEdge) };
      if (dist(position, this.player) > minPlayerDist) return position;
    }
    return position;
  },

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
  },

  // 查询某点所在的高度区
  getHeightAt(x, y) {
    if (!this.heightZones) return 'normal';
    for (const z of this.heightZones) {
      const d = Math.hypot(x - z.x, y - z.y);
      if (d < z.r) return z.type;
    }
    return 'normal';
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
      let type;
      if (window.V5 && this.map.monsterPool) type = V5.pickMonsterType(this.map);
      if (!type) type = pool[randInt(0, pool.length - 1)];
      const data = CONFIG.monsters[type];
      const position = this.findSafeSpawn(300, size - 300, data.radius || 18, 380);
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
    // v5.0 每张地图专属精英
    if (window.V5 && this.map.eliteId && CONFIG.monsters[this.map.eliteId]) {
      const _ed = CONFIG.monsters[this.map.eliteId];
      const _ep = this.findSafeSpawn(420, size - 420, _ed.radius || 20, 480);
      const _ehp = Math.round(_ed.hp * this.balance.enemyHp * 1.4);
      const _em = {
        type: this.map.eliteId, ..._ed, x: _ep.x, y: _ep.y,
        hp: _ehp, maxHp: _ehp,
        damage: Math.round(_ed.damage * this.balance.enemyDamage * 1.25),
        speed: _ed.speed * this.balance.enemySpeed,
        attackCd: 0, stunned: 0, target: null, vx: 0, vy: 0,
        facing: rand(0, Math.PI * 2), animTime: rand(0, 10), hitFlash: 0,
        elite: true, abilityCd: rand(1, 4), packOffset: 0, state: 'idle', stateTimer: 0
      };
      this.monsters.push(_em);
      if (typeof CombatEnhancement !== 'undefined') { CombatEnhancement.assignAIType(_em); CombatEnhancement.makeElite(_em); }
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
      const position = this.findSafeSpawn(400, size - 400, 16, 460);
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
  },

  spawnBoss() {
    if (this.bossSpawned) return;
    this.bossSpawned = true;
    if (window.V5 && this.map.bossId) {
      this.boss = V5.makeBoss(this);
    } else {
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
    }
    this.monsters.push(this.boss);
    this.screenShake = 1;
    showToast(`区域首领「${this.boss.name}」已现身`, 'warning');
  },

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
  },

  canDeployHere(wx, wy, radius) {
    const size = CONFIG.expedition.mapSize;
    if (wx < radius || wx > size - radius || wy < radius || wy > size - radius) return false;
    if (this.collidesWithObstacle(wx, wy, radius)) return false;
    if (this.isInWater(wx, wy, radius)) return false;
    if (this.towers.some(t => dist({ x: wx, y: wy }, t) < t.radius + radius)) return false;
    if (this.plants.some(p => dist({ x: wx, y: wy }, p) < radius + 16)) return false;
    return true;
  },

  // v3.8 脚印：玩家走过留下逐渐淡出的印记
  addFootprint(x, y) {
    if (!this.footprints) this.footprints = [];
    this.footprints.push({ x, y, life: 5 });
    if (this.footprints.length > 40) this.footprints.shift();
  },

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
  },

  updatePlayer(dt) {
    // 玩家移动
    let dx = 0, dy = 0;
    if (this.keys['w']) dy -= 1;
    if (this.keys['s']) dy += 1;
    if (this.keys['a']) dx -= 1;
    if (this.keys['d']) dx += 1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0) { dx /= len; dy /= len; }
    // v5.1 被树根/蛛网定身时无法移动
    if (this.player.root > 0) { dx = 0; dy = 0; }

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
  },
  updateWorldProps(dt) {
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
            this.spawnGroundLoot({ type: 'gold', name: '矿脉赏金', amount: randInt(15,40), icon: '💰' }, pr.x, pr.y);
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
  },
  updateTraps(dt) {
    // 环境陷阱（v5.1：支持定身 root、Boss 投放陷阱限时存在）
    for (let ti = this.traps.length - 1; ti >= 0; ti--) {
      const trap = this.traps[ti];
      trap.triggerCd = Math.max(0, trap.triggerCd - dt);
      trap.phase += dt;
      if (trap.life != null) { trap.life -= dt; if (trap.life <= 0) { this.traps.splice(ti, 1); continue; } }
      if (trap.triggerCd <= 0 && dist(this.player, trap) < trap.radius) {
        trap.triggerCd = trap.cooldown;
        if (this.player.invuln <= 0) {
          this.player.slow = Math.max(this.player.slow, trap.slow);
          if (trap.root) this.player.root = Math.max(this.player.root || 0, trap.root);
        }
        if (trap.damage > 0) this.damagePlayer(trap.damage + Math.max(0, this.map.tier - 1) * 2);
        this.spawnAoeEffect(trap.x, trap.y, trap.radius, trap.color);
        showToast(`触发陷阱：${trap.name}！`, 'warning');
      }
    }
  },
  updateCamera() {
    const size = CONFIG.expedition.mapSize;
    // 摄像机跟随
    const lookX = clamp(this.mouse.x - CONFIG.canvas.width / 2, -260, 260) * 0.16;
    const lookY = clamp(this.mouse.y - CONFIG.canvas.height / 2, -180, 180) * 0.11;
    const shakeX = this.screenShake > 0 ? rand(-1, 1) * this.screenShake * 8 : 0;
    const shakeY = this.screenShake > 0 ? rand(-1, 1) * this.screenShake * 5 : 0;
    const cameraTargetX = clamp(this.player.x - CONFIG.canvas.width / 2 + lookX + shakeX, 0, size - CONFIG.canvas.width);
    const cameraTargetY = clamp(this.player.y - CONFIG.canvas.height / 2 + lookY + shakeY, 0, size - CONFIG.canvas.height);
    this.camera.x = lerp(this.camera.x, cameraTargetX, 0.07);
    this.camera.y = lerp(this.camera.y, cameraTargetY, 0.07);
  },
});
