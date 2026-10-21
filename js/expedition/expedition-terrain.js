/* Expedition 原型混合：地形/迷雾/碰撞/地图生成与空间查询（由 expedition.js 拆分） */

// ===== 地表细节工具（世界锚定确定性哈希：跨 chunk 接缝连续，烘焙零运行时成本） =====
function terrainHash(x, y, salt) {
  let h = (x * 374761393 + y * 668265263 + (salt || 0) * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function shadeHex(hex, amt) {
  try {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
    else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  } catch (e) { return hex; }
}

Object.assign(Expedition.prototype, {
  getVisionKey(x, y) {
    const cell = this.visionCellSize;
    return `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  },

  updateVision() {
    const cell = this.visionCellSize;
    const radius = this.visionRadius * (this.eventModifiers?.vision || 1) * this.getTerrainAt(this.player.x, this.player.y).visionMul;
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
    const radius = this.visionRadius * (this.eventModifiers?.vision || 1) * this.getTerrainAt(this.player.x, this.player.y).visionMul;
    // 实时视野：离开当前视野后，所有地图实体都隐藏。
    return dist({ x, y }, this.player) <= radius;
  },

  // v1.8 视角拉远：屏幕像素 → 世界坐标（zoom<1 时屏幕 1px 对应更大世界距离）。
  // 所有鼠标→世界换算必须走这里，禁止再手写 mouse + camera。
  screenToWorld(mx, my) {
    const z = this.camera.zoom || 1;
    return { x: mx / z + this.camera.x, y: my / z + this.camera.y };
  },

  // v1.4 探索记忆蒙版：exploredCells(96px 格) → 世界空间小画布（1px/格）。
  // 迷雾烘焙时放大 drawImage——平滑缩放让"已探索/未探索"边界自带柔过渡。
  _exploredFogMask() {
    const cell = this.visionCellSize;
    const size = Math.ceil(CONFIG.expedition.mapSize / cell);
    if (!this._efm || this._efm.width !== size) {
      this._efm = document.createElement('canvas');
      this._efm.width = this._efm.height = size;
      this._efmCount = -1;
    }
    if (this._efmCount !== this.exploredCells.size) {
      const g = this._efm.getContext('2d');
      g.clearRect(0, 0, size, size);
      g.fillStyle = '#fff';
      for (const key of this.exploredCells) {
        const c = key.split(',');
        g.fillRect(+c[0], +c[1], 1, 1);
      }
      this._efmCount = this.exploredCells.size;
    }
    return this._efm;
  },

  renderFogOfWar(ctx) {
    const radius = this.visionRadius * (this.eventModifiers?.vision || 1) * this.getTerrainAt(this.player.x, this.player.y).visionMul;
    const fogCtx = this.fogCanvas.getContext('2d');
    // v1.8 视角拉远：雾是屏幕空间画布，世界→屏幕全部乘 zoom（洞半径/蒙版偏移/裁剪框同步缩放）
    const fz = this.camera.zoom || 1;
    const px = (this.player.x - this.camera.x) * fz;
    const py = (this.player.y - this.camera.y) * fz;
    // v1.4 重烘焙触发：脏标记 / 玩家屏幕位移>10px（消除旧实现视野洞滞后）/ 昼夜相切换
    const nightNow = this.nightMode || this.dayNightPhase === 'night';
    const moved = this._fogPX === undefined || Math.abs(px - this._fogPX) > 10 || Math.abs(py - this._fogPY) > 10;
    if (this.fogDirty || moved || this._fogNight !== nightNow) {
      this._fogPX = px; this._fogPY = py; this._fogNight = nightNow;
      fogCtx.clearRect(0, 0, this.fogCanvas.width, this.fogCanvas.height);
      // ① 未探索区域：全遮
      fogCtx.globalCompositeOperation = 'source-over';
      fogCtx.globalAlpha = 1;
      fogCtx.fillStyle = nightNow ? 'rgba(6,8,20,.93)' : 'rgba(10,16,24,.80)';
      fogCtx.fillRect(0, 0, this.fogCanvas.width, this.fogCanvas.height);
      // ② 已探索（视野外）：半遮——记忆迷雾，去过的地方留下暗淡地形轮廓
      const mask = this._exploredFogMask();
      fogCtx.globalCompositeOperation = 'destination-out';
      fogCtx.globalAlpha = .40;
      fogCtx.drawImage(mask, -this.camera.x * fz, -this.camera.y * fz, CONFIG.expedition.mapSize * fz, CONFIG.expedition.mapSize * fz);
      fogCtx.globalAlpha = 1;
      // ③ 当前视野：完全透明洞（裁剪到地图矩形内，边界外始终保持全雾）
      const _ms = CONFIG.expedition.mapSize;
      fogCtx.save();
      fogCtx.beginPath();
      fogCtx.rect(-this.camera.x * fz, -this.camera.y * fz, _ms * fz, _ms * fz);
      fogCtx.clip();
      const clearVision = fogCtx.createRadialGradient(px, py, radius * .82 * fz, px, py, radius * 1.08 * fz);
      clearVision.addColorStop(0, 'rgba(0,0,0,1)');
      clearVision.addColorStop(.78, 'rgba(0,0,0,1)');
      clearVision.addColorStop(1, 'rgba(0,0,0,0)');
      fogCtx.fillStyle = clearVision;
      fogCtx.beginPath();
      fogCtx.arc(px, py, radius * 1.08 * fz, 0, Math.PI * 2);
      fogCtx.fill();
      // ④ 噪声侵蚀洞缘：专用高对比噪声（团块+颗粒）destination-out 环形裁剪——
      //    视野边界从"规整圆"变为有机破碎边（与叶簇云同一反矢量思路）
      if (!this._fogEdgeNoise) {
        const nt = document.createElement('canvas');
        nt.width = nt.height = 128;
        const nc = nt.getContext('2d');
        for (let i = 0; i < 46; i++) {   // 侵蚀团块：中高 alpha，制造深度缺口
          const x = Math.random() * 128, y = Math.random() * 128;
          nc.fillStyle = `rgba(255,255,255,${(.30 + Math.random() * .55).toFixed(3)})`;
          nc.beginPath();
          nc.ellipse(x, y, 3 + Math.random() * 7, 2 + Math.random() * 5, Math.random() * 3, 0, Math.PI * 2);
          nc.fill();
        }
        for (let i = 0; i < 900; i++) {  // 细颗粒：整体锯齿化
          nc.fillStyle = `rgba(255,255,255,${(.15 + Math.random() * .35).toFixed(3)})`;
          nc.fillRect(Math.random() * 128, Math.random() * 128, 1.6, 1.6);
        }
        this._fogEdgeNoise = nt;
      }
      {
        fogCtx.save();
        fogCtx.beginPath();
        fogCtx.arc(px, py, radius * 1.12 * fz, 0, Math.PI * 2);
        fogCtx.arc(px, py, radius * .80 * fz, 0, Math.PI * 2, true);
        fogCtx.clip('evenodd');
        const pat = fogCtx.createPattern(this._fogEdgeNoise, 'repeat');
        const off = terrainHash(Math.round(this.player.x / 96), Math.round(this.player.y / 96), 7);
        fogCtx.translate(-((off * 128) | 0), -(((1 - off) * 128) | 0));
        fogCtx.globalAlpha = .55;
        fogCtx.fillStyle = pat;
        fogCtx.fillRect(-140, -140, this.fogCanvas.width + 280, this.fogCanvas.height + 280);
        fogCtx.restore();
      }
      fogCtx.restore();

      fogCtx.globalCompositeOperation = 'source-over';
      fogCtx.globalAlpha = 1;
      this.fogDirty = false;
    }
    // 雾是屏幕空间画布：恒等变换合成，杜绝被上游 zoom 变换二次缩放
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.fogCanvas, 0, 0);
    ctx.restore();
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

  // v5.8.17 每局随机出生点：取代写死的 (640,360)。先生成区域、再选安全出生点、
  // 之后障碍/陷阱都按新出生点避让。排除水域泥地（减速区）、危险区，多次采样兜底。
  placePlayerSpawn() {
    const size = CONFIG.expedition.mapSize;
    for (let i = 0; i < 80; i++) {
      const x = rand(240, size - 240), y = rand(240, size - 240);
      const t = this.getTerrainAt(x, y);
      if (t.moveMul < 1) continue;                                   // 水/泥减速区不出
      if ((this.hazardZones || []).some(h => Math.hypot(h.x - x, h.y - y) < (h.r || 60) + 50)) continue;
      this.player.x = x; this.player.y = y;
      // 出生点安全圈：清掉贴脸障碍（障碍生成时避让的还是默认出生点）
      if (this.obstacles && this.obstacles.length) {
        this.obstacles = this.obstacles.filter(o => Math.hypot(o.x - x, o.y - y) > 120);
        if (this.obstacleSpatialHash && this.obstacleSpatialHash.rebuild) {
          try { this.obstacleSpatialHash.rebuild(this.obstacles); } catch (e) {}
        }
      }
      return true;
    }
    return false;                                                     // 兜底：保留默认 (640,360)
  },

  generateTerrain() {
    const size = CONFIG.expedition.mapSize;
    const theme = this.map.terrain;

    this.generateTerrainRegions();
    this.placePlayerSpawn();
    // 相机立即对齐出生点（updateCamera 是平滑趋近，不对齐开局会从旧位置飘过来）
    try {
      const vz = this.camera.zoom || 1;
      this.camera.x = this.player.x - Math.ceil(CONFIG.canvas.width / 2 / vz);
      this.camera.y = this.player.y - Math.ceil(CONFIG.canvas.height / 2 / vz);
    } catch (e) {}
    const trapCatalog = [
      { type: 'thorn', name: '荆棘丛', icon: '🌵', color: '#85c85d', radius: 34, damage: 8, cooldown: 1.4, slow: 1.1 },
      { type: 'bear', name: '捕兽夹', icon: '⚙️', color: '#e5b65a', radius: 26, damage: 18, cooldown: 3.5, slow: 2.2 },
      { type: 'poison', name: '毒孢子', icon: '☣️', color: '#90d354', radius: 58, damage: 7, cooldown: 1.1, slow: 0.7 },
      { type: 'lightning', name: '落雷符文', icon: '⚡', color: '#b999ff', radius: 52, damage: 28, cooldown: 4.5, slow: 0.3 },
    ];
    const availableTrapCount = Math.min(trapCatalog.length, Math.max(2, this.map.tier + 1));
    for (let i = 0; i < 5 + this.map.tier * 3; i++) {
      const base = trapCatalog[randInt(0, availableTrapCount - 1)];
      const tx = rand(380, size - 180), ty = rand(180, size - 180);
      if (Math.hypot(tx - this.player.x, ty - this.player.y) < 110 + base.radius) continue;   // 出生点安全圈
      this.traps.push({
        ...base,
        x: tx, y: ty,
        triggerCd: rand(0, base.cooldown), phase: rand(0, Math.PI * 2),
      });
    }
  },

  renderTerrainDirect(ctx, cam) {
    const theme = this.map.terrain;
    // 使用 chunk canvas 实际尺寸，而非全局画布尺寸（修复全黑问题）
    const viewW = ctx.canvas.width || CONFIG.canvas.width;
    const viewH = ctx.canvas.height || CONFIG.canvas.height;
    // 主题色基底（此前硬编码 '#405638' 使各地图 terrain.ground 主题失效）
    const base = (theme && theme.ground) || '#405638';
    const baseDark = shadeHex(base, -0.24);
    const baseLight = shadeHex(base, 0.13);
    const baseWarm = shadeHex((theme && theme.soil) || '#5b4934', -0.3);
    // v5.8.15 地表质感三层优先级：① 每图专属 AI 无缝贴图（512px，与 chunk 512 严格对齐无缝）
    // → ② 主题色程序纹理（256px 土斑/草丛/碎石）→ ③ 平涂主题色兜底
    let texTile = null;
    if (this.groundTexLoaded && this.groundTexImg && this.groundTexImg.naturalWidth > 0) {
      texTile = this.groundTexImg;
    } else if (typeof ArtTextures !== 'undefined') {
      texTile = ArtTextures.groundTile(base);
    }
    ctx.fillStyle = texTile ? ctx.createPattern(texTile, 'repeat') : base;
    ctx.fillRect(0, 0, viewW, viewH);
    this.renderTerrainRegions(ctx, cam);

    // 大尺度地表色斑（160px 世界锚定网格，跨 chunk 无缝）：干草亮斑/湿土暗斑/裸土暖斑，
    // 打破平涂底色的「贴纸感」，远景看也有地表起伏的错觉
    ctx.save();
    const moteCell = 160;
    const mx0 = Math.floor(cam.x / moteCell) - 1, my0 = Math.floor(cam.y / moteCell) - 1;
    const mx1 = Math.floor((cam.x + viewW) / moteCell) + 1, my1 = Math.floor((cam.y + viewH) / moteCell) + 1;
    for (let my = my0; my <= my1; my++) for (let mx = mx0; mx <= mx1; mx++) {
      const h1 = terrainHash(mx, my, 11);
      if (h1 < 0.42) continue;
      const wx = mx * moteCell + terrainHash(mx, my, 12) * moteCell;
      const wy = my * moteCell + terrainHash(mx, my, 13) * moteCell;
      const x = wx - cam.x, y = wy - cam.y;
      if (x < -180 || y < -120 || x > viewW + 180 || y > viewH + 120) continue;
      const rx = 52 + terrainHash(mx, my, 14) * 66;
      const ry = rx * (0.5 + terrainHash(mx, my, 15) * 0.3);
      ctx.globalAlpha = 0.07 + terrainHash(mx, my, 16) * 0.06;
      ctx.fillStyle = h1 < 0.62 ? baseLight : h1 < 0.86 ? baseDark : baseWarm;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, terrainHash(mx, my, 17) * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 稳定的世界空间地表纹理：不随屏幕重复，提供草地颗粒、泥点和小石块层次。
    ctx.save();
    const cell = 26;
    const sx0 = Math.floor(cam.x / cell) - 1, sy0 = Math.floor(cam.y / cell) - 1;
    for (let gy = sy0; gy < sy0 + Math.ceil(viewH / cell) + 3; gy++) {
      for (let gx = sx0; gx < sx0 + Math.ceil(viewW / cell) + 3; gx++) {
        const seed = Math.abs((gx * 928371 + gy * 689287) | 0);
        const px = gx * cell + (seed % 23), py = gy * cell + ((seed >>> 5) % 19);
        const x = px - cam.x, y = py - cam.y;
        if (x < -14 || y < -14 || x > viewW + 14 || y > viewH + 14) continue;
        const kind = seed % 6;
        ctx.globalAlpha = 0.07 + (seed % 4) * 0.022;
        if (kind < 2) {
          // 草叶三笔
          ctx.strokeStyle = theme.glow; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x - 3, y + 4); ctx.lineTo(x, y - 4); ctx.lineTo(x + 4, y + 2); ctx.stroke();
        } else if (kind === 2) {
          // 泥点
          ctx.fillStyle = '#5f503a'; ctx.beginPath(); ctx.ellipse(x, y, 3 + seed % 3, 1.5, 0.2, 0, Math.PI * 2); ctx.fill();
        } else if (kind === 3) {
          // 浅色地衣
          ctx.fillStyle = baseLight; ctx.beginPath(); ctx.arc(x, y, 1.4 + seed % 2, 0, Math.PI * 2); ctx.fill();
        } else if (kind === 4) {
          // 碎小石
          ctx.fillStyle = baseDark; ctx.beginPath(); ctx.ellipse(x, y, 2.2 + seed % 2, 1.4, 0.4, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.fillStyle = theme.path; ctx.beginPath(); ctx.arc(x, y, 1.6 + seed % 2, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    ctx.restore();

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
    ctx.restore();

    // 微叙事道具（260px 世界锚定网格）：白骨/石堆/老树桩/板条箱碎片/蓟草丛——
    // 荒野里「有人来过」的故事痕迹，烘焙进 chunk 无逐帧成本
    ctx.save();
    const propCell = 260;
    const ppx0 = Math.floor(cam.x / propCell), ppy0 = Math.floor(cam.y / propCell);
    const ppx1 = Math.floor((cam.x + viewW) / propCell), ppy1 = Math.floor((cam.y + viewH) / propCell);
    for (let py = ppy0; py <= ppy1; py++) for (let px = ppx0; px <= ppx1; px++) {
      const h = terrainHash(px, py, 31);
      if (h < 0.28) continue;
      const wx = px * propCell + 40 + terrainHash(px, py, 32) * (propCell - 80);
      const wy = py * propCell + 40 + terrainHash(px, py, 33) * (propCell - 80);
      const x = wx - cam.x, y = wy - cam.y;
      if (x < -30 || y < -30 || x > viewW + 30 || y > viewH + 30) continue;
      const rot = terrainHash(px, py, 34) * Math.PI * 2;
      const kind2 = Math.floor(terrainHash(px, py, 35) * 5);
      ctx.save();
      ctx.translate(x, y); ctx.rotate(rot); ctx.globalAlpha = 0.42;
      if (kind2 === 0) {
        // 白骨（低对比：暗色地面上高亮道具会读成噪点）
        ctx.strokeStyle = '#b3ab94'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(5, -1); ctx.stroke();
        ctx.beginPath(); ctx.arc(7, -1, 2, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 0.38;
        ctx.beginPath(); ctx.moveTo(-4, 3); ctx.lineTo(2, 5); ctx.stroke();
      } else if (kind2 === 1) {
        // 石堆
        ctx.fillStyle = baseDark;
        [[-6, 2, 4], [1, -2, 5], [6, 3, 3.4]].forEach(s => { ctx.beginPath(); ctx.ellipse(s[0], s[1], s[2], s[2] * 0.6, 0, 0, Math.PI * 2); ctx.fill(); });
        ctx.fillStyle = baseLight;
        ctx.beginPath(); ctx.ellipse(0, -4, 3.4, 2, 0, 0, Math.PI * 2); ctx.fill();
      } else if (kind2 === 2) {
        // 老树桩年轮
        ctx.strokeStyle = '#3f2f1d'; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#2b2013'; ctx.beginPath(); ctx.arc(0, 0, 4.4, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#6b5236'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, -4.4); ctx.lineTo(0, -7); ctx.moveTo(3.1, 3.1); ctx.lineTo(5, 5); ctx.moveTo(-3.1, 3.1); ctx.lineTo(-5, 5); ctx.stroke();
      } else if (kind2 === 3) {
        // 板条箱碎片
        ctx.fillStyle = '#5a4630'; ctx.fillRect(-8, -2, 9, 7);
        ctx.fillStyle = '#6d573c'; ctx.fillRect(2, -6, 7, 5);
        ctx.strokeStyle = 'rgba(220,190,140,.4)'; ctx.lineWidth = 1;
        ctx.strokeRect(-8, -2, 9, 7); ctx.strokeRect(2, -6, 7, 5);
      } else {
        // 蓟草丛
        ctx.strokeStyle = '#7d9464'; ctx.lineWidth = 1.3;
        for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(i * 3, 4); ctx.lineTo(i * 5, -7); ctx.stroke(); }
        ctx.fillStyle = '#a8b878';
        [[-5, -8], [0, -11], [5, -9]].forEach(s => { ctx.beginPath(); ctx.arc(s[0], s[1], 1.6, 0, Math.PI * 2); ctx.fill(); });
      }
      ctx.restore();
    }
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

    // 世界对齐连续微噪声（末层统一颗粒）：所有程序化笔触共享同一层连续纹理，
    // 消除"矢量平涂"假感。128px 噪声贴片按世界坐标对齐，跨 chunk 无缝。
    if (!this._noiseTile) {
      const tile = document.createElement('canvas');
      tile.width = tile.height = 128;
      const tc = tile.getContext('2d');
      for (let i = 0; i < 2200; i++) {
        const x = Math.random() * 128, y = Math.random() * 128, l = Math.random();
        if (l < 0.5) tc.fillStyle = `rgba(0,0,0,${(0.05 + Math.random() * 0.09).toFixed(3)})`;
        else tc.fillStyle = `rgba(235,240,215,${(0.03 + Math.random() * 0.06).toFixed(3)})`;
        tc.fillRect(x, y, 1.3, 1.3);
      }
      for (let i = 0; i < 90; i++) {
        const x = Math.random() * 128, y = Math.random() * 128, l = Math.random();
        tc.fillStyle = l < 0.5 ? 'rgba(0,0,0,.05)' : 'rgba(235,240,215,.035)';
        tc.beginPath(); tc.ellipse(x, y, 1.5 + Math.random() * 2.5, 1 + Math.random() * 1.8, Math.random() * 3, 0, Math.PI * 2); tc.fill();
      }
      this._noiseTile = tile;
    }
    ctx.save();
    ctx.globalAlpha = 0.8;
    const t = this._noiseTile;
    const ox = ((-cam.x % 128) + 128) % 128, oy = ((-cam.y % 128) + 128) % 128;
    for (let ty = -1; ty * 128 < viewH + 128; ty++) {
      for (let tx = -1; tx * 128 < viewW + 128; tx++) ctx.drawImage(t, ox + tx * 128, oy + ty * 128);
    }
    ctx.restore();

    // v3.7 绘制高低差区域
  },

  renderTerrain(ctx, cam) {
    const chunkSize = this.terrainChunkCache.chunkSize;
    // v1.8 视角拉远：可见世界宽高 = 画布 / zoom（chunk 覆盖范围随之扩大）
    const vz = cam.zoom || 1;
    const vw = CONFIG.canvas.width / vz, vh = CONFIG.canvas.height / vz;
    const minX = Math.max(0, Math.floor(cam.x / chunkSize));
    const maxX = Math.min(Math.ceil(CONFIG.expedition.mapSize / chunkSize) - 1, Math.floor((cam.x + vw) / chunkSize));
    const minY = Math.max(0, Math.floor(cam.y / chunkSize));
    const maxY = Math.min(Math.ceil(CONFIG.expedition.mapSize / chunkSize) - 1, Math.floor((cam.y + vh) / chunkSize));
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
    // v1.2 尺寸错落：植被/岩石按世界坐标哈希 0.88–1.15 倍抖动——森林不再「复制粘贴」
    const artJit = ['tree', 'bush', 'rock', 'deadTree'].includes(obstacle.type)
      ? .88 + ((Math.abs((obstacle.x * 1103515245 + obstacle.y * 12345) | 0) >>> 6) % 100) / 100 * .27 : 1;
    const heightByType = { tree:76, deadTree:62, rock:34, hay:30, fence:30, ruin:60, monolith:72, crystal:58, toxicCrystal:58 };
    this.renderCastShadow(ctx, obstacle.x, obstacle.y, (obstacle.type === 'fence' ? 40 : 28) * s * artJit, (heightByType[obstacle.type] || 48) * s * artJit, 0.3);
    ctx.save();
    ctx.globalAlpha = this.isBehindHero(obstacle) ? 0.38 : 1;
    const depthScale = this.getDepthScale(obstacle.y);
    ctx.translate(sx, sy);
    ctx.rotate(obstacle.rotation);
    ctx.scale(s * depthScale, s * depthScale);

    // v1.3 美术贴图优先：程序化烘焙纹理（叶簇云，季节 × 地图差异化）。
    // 变体由世界坐标确定性哈希——同一障碍物永远同一变体，跨帧稳定。
    if (typeof ArtTextures !== 'undefined') {
      const variants = ArtTextures.OB_VARIANTS[obstacle.type] || 0;
      if (variants > 0) {
        const v = ((Math.abs((obstacle.x * 7349 + obstacle.y * 9151) | 0) >> 3) % variants);
        const art = ArtTextures.obstacleArt(obstacle.type, v, {
          season: (typeof GameState !== 'undefined' && GameState.season) || 'summer',
          tier: (this.map && this.map.tier) || 1,
        });
        const size = (obstacle.type === 'tree' ? 118 : obstacle.type === 'bush' ? 74 : obstacle.type === 'fence' ? 96 : 88) * artJit;
        ctx.drawImage(art, -size / 2, -size * .84, size, size);
        ctx.restore();
        return;
      }
    }

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
    this.heightZones = this.terrainRegions.filter(r => r.type === 'highland').map(r => ({x:r.x,y:r.y,r:r.rx,type:'high'}));
  },

  getHeightAt(x, y) {
    const id = this.getTerrainAt(x,y).id;
    return id === 'highland' ? 'high' : id === 'mud' ? 'low' : 'normal';
  },

  // v3.7 打道具（油桶爆炸/木箱掉钱）
  damageProp(pr, dmg) {
    if (!pr || pr.destroyed || !Number.isFinite(dmg) || dmg <= 0) return;
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
        if (pd < 100) this.damagePlayer(15, { type: 'barrel', x: pr.x, y: pr.y });
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
    // 无功能的大型贴图已停用，真实节点由 terrainLandmarks 管理。
    this.landmarks = [];
    this.landmarkImgs = {};
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
    const isT1 = this.map.tier === 1;
    // T1 教学图巡逻队更少（1-2 支），高 T 维持 2-3 支
    const numPatrols = (isT1 ? 1 : 2) + Math.floor(Math.random() * 2);
    const monsterTypesByTier = {
      1: ['boar', 'bat', 'spider'],
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
        this.obstacles.push({ x: p.x, y: p.y, radius: 28, collisionRx: 28, collisionRy: 20, scale: 1, rotation: 0, type: 'rock', hp: 999, projectileBlock: true });
      }
    }
    // T2_3 旧磨坊：多建筑障碍
    if (id === 't2_3') {
      for (let i = 0; i < 14; i++) {
        const p = this.findSafeSpawn(200, size - 200, 40);
        this.obstacles.push({ x: p.x, y: p.y, radius: 38, collisionRx: 38, collisionRy: 26, scale: 1.3, rotation: 0, type: 'rock', hp: 999, projectileBlock: true });
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
      if (this.map.tier >= 2) pool.push('treant');          // 树精（T1 教学图不出现）
      if (this.map.tier >= 2) pool.push('gargoyle');       // T2+ 石像鬼
      if (this.map.tier >= 3) pool.push('shadow_demon');   // T3+ 影魔
      // v1.4 精英怪低概率直接生成
      if (this.map.tier >= 2 && Math.random() < 0.08) pool.push('stone_golem');
      if (this.map.tier >= 2 && Math.random() < 0.06) pool.push('boar_king');
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
    if (this.elapsed < 120) { this.bossPending = true; return; }
    if (this.bossSpawned) return;
    this.bossSpawned = true;
    if (window.V5 && this.map.bossId) {
      this.boss = V5.makeBoss(this);
    } else {
    const position = this.findSafeSpawn(650, CONFIG.expedition.mapSize - 350, 46);
    this.boss = {
      type:'boss', name:['苔岩裂颚兽','幽潮骨翼龙','霜脉巨灵','紫月灾兽'][this.map.tier-1],
      x:position.x, y:position.y, radius:46,
      // 仅在 V5 不可用时使用统一 balance 兜底；正常 Boss 由 CONFIG.bosses + V5.makeBoss 创建。
      hp:this.balance.bossHp, maxHp:this.balance.bossHp,
      damage:this.balance.bossDamage, speed:76 + this.map.tier * 5,
      attackRange:70, attackCd:1.5, abilityCd:4, abilityIndex:0, phase:1, stunned:0,
      facing:0, animTime:0, hitFlash:0, elite:true, gold:100 * this.map.tier,
      castState:'idle', castTimer:0, castIndex:0, attackAnim:0,
    };
    }
    this.monsters.push(this.boss);
    this.screenShake = 1;
    // v1.7 Boss 现身演出（Survivor.io/Brotato 惯例）：全屏横幅 + 低鸣 + 震屏，替代单条 toast
    this.showCinematicBanner('⚠ 区域首领苏醒 ⚠', `${this.boss.name} · 全图游荡 · 击败可提升撤离奖励`, 'boss', 2.6);
    if (typeof AudioManager !== 'undefined' && AudioManager.playBeastRumble) AudioManager.playBeastRumble();
    showToast(`区域首领「${this.boss.name}」已现身`, 'warning');
  },

  // v5.8 篝火（升级/移除/回血）与商人（买/删/升级/补货）世界交互物
  spawnCardNodes() {
    const size = CONFIG.expedition.mapSize;
    const cf = this.findSafeSpawn(200, size - 200, 24, 260);
    this.campfire = { x: cf.x + 60, y: cf.y + 40, radius: 26, used: false };
    const mp = this.findSafeSpawn(260, size - 260, 26, 360);
    this.merchant = { x: mp.x, y: mp.y, radius: 26, restocked: 0 };
    // 商人初始在售 3 张道具卡
    if (typeof CardV58 !== 'undefined' && CardV58.getDef) {
      const ids = Object.keys(CARD_DATA.items || {});
      this.merchantStock = [];
      for (let i = 0; i < 3 && ids.length; i++) {
        this.merchantStock.push(ids[Math.floor(Math.random() * ids.length)]);
      }
    }
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
      ctx.fillStyle = f.material === 'water' ? 'rgba(160,225,240,'+a+')' : 'rgba(60,45,30,'+a+')';
      ctx.beginPath();
      ctx.ellipse(sx, sy, 6, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  updatePlayer(dt) {
    // 受击姿态计时衰减（渲染层据此播放后仰）
    if (this.player.hitFlash > 0) this.player.hitFlash = Math.max(0, this.player.hitFlash - dt);
    if (this.player.hurtT > 0) this.player.hurtT = Math.max(0, this.player.hurtT - dt);
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
    const ground = this.getTerrainAt(this.player.x, this.player.y);
    let terrainModifier = ground.moveMul;
    if (this.player.slow > 0) terrainModifier *= 0.56;
    const hz = this.getHeightAt(this.player.x, this.player.y);
    // v5.4 贪婪成本：背包超重（>12 格）小幅降移速，最多 -12%
    let carryModifier = 1;
    if (typeof LoadoutSystem !== 'undefined' && this.bag && LoadoutSystem.usedSlots) {
      const _used = LoadoutSystem.usedSlots(this.bag);
      if (_used > 12) carryModifier = Math.max(0.82, 1 - 0.045 * (_used - 12));
    }
    speed *= terrainModifier * carryModifier;
    const targetVx = dx * speed, targetVy = dy * speed;
    const accel = len > 0 ? 16 : 20;
    this.player.vx = lerp(this.player.vx || 0, targetVx, clamp(accel * dt, 0, 1));
    this.player.vy = lerp(this.player.vy || 0, targetVy, clamp(accel * dt, 0, 1));
    if (len > 0) {
      const nextFacing = Math.atan2(dy, dx);
      // 角度环绕处理，避免从左侧切到右侧时绕远路旋转。
      let delta = nextFacing - (this.player.facing || 0);
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      this.player.facing = (this.player.facing || 0) + delta * clamp(12 * dt, 0, 1);
    }
    const previousX = this.player.x;
    const previousY = this.player.y;
    this.player.x += this.player.vx * dt;
    this.player.y += this.player.vy * dt;
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
    this.player.walkDistance = (this.player.walkDistance || 0) + Math.hypot(this.player.x - previousX, this.player.y - previousY);
    // v1.6 脚步声：每走 34px 一记（playStep 内置 0.22s 时间节流，冲刺/穿不同地形都不会糊）
    if (this.player.walkDistance - (this.player._stepDist || 0) >= 34) {
      this.player._stepDist = this.player.walkDistance;
      if (typeof AudioManager !== 'undefined' && AudioManager.playStep) AudioManager.playStep();
    }
    // 落脚扬尘：按骨架步幅（半周期）触发，和视觉迈步对齐；左右脚交替
    const footLen = (typeof PlayerSkel !== 'undefined' ? PlayerSkel.STRIDE : 100) / 2;
    if ((this.player.moveSpeed || 0) > 30 &&
        this.player.walkDistance - (this.player._dustDist || 0) >= footLen) {
      this.player._dustDist = this.player.walkDistance;
      const side = Math.floor(this.player.walkDistance / footLen) % 2 ? 1 : -1;
      if (typeof this.spawnFootDust === 'function') this.spawnFootDust(side);
    }
    // 转向过渡：记录方向变化，渲染层据此做 0.07s 交叉淡出
    if (typeof PlayerSkel !== 'undefined' && this.player.facing !== undefined) {
      const dirNow = PlayerSkel.dirOf(this.player.facing);
      if (this.player._skelDir !== dirNow) {
        this.player._skelFromDir = this.player._skelDir || dirNow;
        this.player._skelDir = dirNow;
        this.player._skelTurnT = 0.07;
      } else if (this.player._skelTurnT > 0) {
        this.player._skelTurnT = Math.max(0, this.player._skelTurnT - dt);
      }
    }
    this.updateVision();

    // v3.4 地图危险区（坑/泥/毒雾）——v5.8.11 探索期缩短，40s 起生效
    if (this.elapsed >= 40 && this.hazardZones) {
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

    // 能量恢复（W6 tradeoff 卡：雾隐斗篷能量回复 -40%）
    const _econ = (this.syn && this.syn.itemFx && this.syn.itemFx.energyRegenDown) ? (1 - this.syn.itemFx.energyRegenDown) : 1;
    this.player.energy = Math.min(this.player.maxEnergy, this.player.energy + CONFIG.player.energyRegen * _econ * dt);
    // W6 tradeoff 卡：鲜血契约每秒流失 3 HP（持有期持续）
    if (this.syn && this.syn.itemFx && this.syn.itemFx.hpDrain) {
      this.player.hp = Math.max(0, this.player.hp - this.syn.itemFx.hpDrain * dt);
    }
    this.player.moveSpeed = Math.hypot(this.player.vx || 0, this.player.vy || 0);
    if (this.player.moveSpeed > 8 && Math.random() < dt * 5) {
      this.footprints = this.footprints || [];
      const mat = ground.id === 'water' ? 'water' : ground.id === 'mud' ? 'mud' : 'soil';
      this.footprints.push({ x: this.player.x, y: this.player.y + 8, life: 5, material: mat });
      this.particles.push({ x: this.player.x, y: this.player.y + 8, vx: rand(-8,8), vy: rand(-18,-5), life:.28, maxLife:.28, size: mat === 'water' ? 3 : 2, color: mat === 'water' ? '#9ed9e5' : '#92704a', type:'dust' });
    }

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
    if (this.elapsed < 40) return;
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
    // v1.8 视角拉远：常态 0.86 / Boss 战 0.78 平滑过渡（lerp 0.06 ≈ 0.5s 到位）
    const zb = CONFIG.expedition.zoomBase || 1;
    const bossAlive = this.boss && this.boss.hp > 0 && this.boss.state !== 'death';
    const zTarget = bossAlive ? (CONFIG.expedition.zoomBoss || zb) : zb;
    this.camera.zoom = lerp(this.camera.zoom || 1, zTarget, 0.06);
    const z = this.camera.zoom;
    const vw = CONFIG.canvas.width / z, vh = CONFIG.canvas.height / z;
    // 摄像机跟随（look-ahead 按屏幕 px 计算，除以 zoom 折回世界尺度）
    // 相机死区：鼠标偏移 ≤60px 不跟随，避免小幅移动带动画面
    const mdx = this.mouse.x - CONFIG.canvas.width / 2;
    const mdy = this.mouse.y - CONFIG.canvas.height / 2;
    const _dz = (v) => (Math.abs(v) <= 60 ? 0 : v - Math.sign(v) * 60);
    const lookX = clamp(_dz(mdx), -260, 260) * 0.16 / z;
    const lookY = clamp(_dz(mdy), -180, 180) * 0.11 / z;
    const shakeX = this.screenShake > 0 ? rand(-1, 1) * this.screenShake * 8 : 0;
    const shakeY = this.screenShake > 0 ? rand(-1, 1) * this.screenShake * 5 : 0;
    // Boss 死亡电影序列：相机中心在玩家与 Boss 之间插值（偏向 Boss），不再以玩家为唯一中心
    let focusX = this.player.x, focusY = this.player.y;
    if (this._bossFocus) {
      const k = this._bossFocus.k;
      focusX = this.player.x + (this._bossFocus.x - this.player.x) * k;
      focusY = this.player.y + (this._bossFocus.y - this.player.y) * k;
    }
    // MOBA 式速度前瞻：镜头往移动方向多带一点，跑起来提前看到前方
    const leadX = clamp((this.player.vx || 0) * 0.28, -64, 64);
    const leadY = clamp((this.player.vy || 0) * 0.24, -48, 48);
    const cameraTargetX = clamp(focusX - vw / 2 + lookX + leadX + shakeX, 0, Math.max(0, size - vw));
    const cameraTargetY = clamp(focusY - vh / 2 + lookY + leadY + shakeY, 0, Math.max(0, size - vh));
    this.camera.x = lerp(this.camera.x, cameraTargetX, 0.12);
    this.camera.y = lerp(this.camera.y, cameraTargetY, 0.12);
  },
});




