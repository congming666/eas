// ============================================================
// world-fx.js  v3.9  远征地图真实感系统
// 分层地形（密林/废墟墙）、空间叙事（营地/战场/祭坛/路标）、
// 三层前景遮挡、天气循环、环境粒子、Boss 光环、全局后处理。
// 纯 Canvas 代码绘制，不依赖外部图片；通过 Expedition 的渲染挂载点调用。
// ============================================================
const WorldFX = (() => {
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  let noiseTile = null;
  let rainAudio = null;

  // ---------- 生成 ----------
  function farFromImportant(g, x, y, d) {
    if (Math.hypot(x - g.player.x, y - g.player.y) < d) return false;
    if (g.extractPoints) for (const ep of g.extractPoints) {
      if (Math.hypot(x - ep.x, y - ep.y) < d * 0.55) return false;
    }
    return true;
  }
  function safePoint(g, size, minFromPlayer) {
    let x = 0, y = 0, ok = false, tries = 0;
    while (!ok && tries++ < 40) {
      x = rand(200, size - 200); y = rand(200, size - 200);
      ok = farFromImportant(g, x, y, minFromPlayer || 280);
    }
    return { x, y };
  }
  function pushWall(g, cx, cy, rot, len) {
    const gaps = [];
    // 预留 1 个门洞缺口（视觉 + 碰撞都断开）
    if (Math.random() < 0.7) gaps.push({ t: rand(0.25, 0.75), w: rand(0.12, 0.2) });
    // 视觉墙体（进 fxWalls，不参与碰撞）
    const w = {
      type: 'wall', fxVisual: true, x: cx, y: cy, rotation: rot, len,
      collisionRx: 0, collisionRy: 0, radius: 0, gaps, h: 46
    };
    g.fxWalls.push(w);
    // 碰撞分段（绕开门洞）
    const hx = Math.cos(rot), hy = Math.sin(rot);
    const segs = [];
    if (!gaps.length) segs.push([-1, 1]);
    else {
      let cur = -1;
      for (const gp of gaps) { segs.push([cur, gp.t - gp.w / 2]); cur = gp.t + gp.w / 2; }
      segs.push([cur, 1]);
    }
    for (const sg of segs) {
      const l0 = sg[0] * len / 2, l1 = sg[1] * len / 2, sl = l1 - l0;
      if (sl < 14) continue;
      g.obstacles.push({
        type: 'wallseg', fxOnly: true,
        x: cx + hx * (l0 + l1) / 2, y: cy + hy * (l0 + l1) / 2,
        rotation: rot, len: sl, collisionRx: sl / 2, collisionRy: 10, radius: 10
      });
    }
    return w;
  }

  function generate(g) {
    const size = CONFIG.expedition.mapSize;
    const tier = g.map.tier;
    g.fxWalls = []; g.fxProps = []; g.fxDecals = []; g.fxForest = [];
    g.fxWeather = { state: 'clear', timer: rand(90, 160), flash: 0, nextFlash: 4, wet: 0 };
    g.fxHowlTimer = rand(30, 60);

    // ---- 密林带 2-3 片 ----
    const treeType = tier <= 1 ? 'tree' : (tier === 2 ? 'tree' : 'deadTree');
    const zoneN = 2 + (Math.random() < 0.5 ? 1 : 0);
    for (let z = 0; z < zoneN; z++) {
      const c = safePoint(g, size, 360);
      const rx = rand(230, 360), ry = rand(190, 310);
      g.fxForest.push({ x: c.x, y: c.y, rx, ry });
      const n = randInt(30, 44);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, rr = Math.sqrt(Math.random());
        const x = c.x + Math.cos(a) * rx * rr, y = c.y + Math.sin(a) * ry * rr;
        if (!farFromImportant(g, x, y, 96)) continue;
        const sc = rand(0.85, 1.32);
        g.obstacles.push({
          type: treeType, x, y, scale: sc, radius: 30 * sc,
          collisionRx: (treeType === 'tree' ? 52 : 38) * sc,
          collisionRy: (treeType === 'tree' ? 32 : 26) * sc,
          collisionOffsetY: 4 * sc, rotation: rand(-0.16, 0.16), fxForest: true
        });
      }
    }

    // ---- 废墟墙（L 形院子）3+tier 组 ----
    const groups = 3 + tier;
    for (let gi = 0; gi < groups; gi++) {
      const c = safePoint(g, size, 300);
      const baseRot = Math.random() * TAU;
      const lenA = rand(150, 250), lenB = rand(120, 200);
      pushWall(g, c.x, c.y, baseRot, lenA);
      // L 的第二段，接在 A 的一端
      const ex = c.x + Math.cos(baseRot) * lenA / 2, ey = c.y + Math.sin(baseRot) * lenA / 2;
      pushWall(g, ex, ey, baseRot + Math.PI / 2, lenB);
      g.fxDecals.push({ kind: 'scorch', x: c.x + rand(-34, 34), y: c.y + rand(-34, 34), r: rand(42, 72) });
      if (Math.random() < 0.6) g.fxProps.push({ type: 'crate', x: c.x + rand(-40, 40), y: c.y + rand(-30, 40) });
    }

    // ---- 营地废墟：篝火 ----
    {
      const p = safePoint(g, size, 320);
      g.fxProps.push({ type: 'campfire', x: p.x, y: p.y });
      g.fxDecals.push({ kind: 'scorch', x: p.x, y: p.y + 6, r: 30 });
    }

    // ---- 战场遗迹：插地断剑 + 焦痕 ----
    const bf = 2 + tier;
    for (let i = 0; i < bf; i++) {
      const p = safePoint(g, size);
      g.fxProps.push({ type: 'brokensword', x: p.x, y: p.y, rot: rand(-0.4, 0.4) });
      g.fxDecals.push({ kind: 'scorch', x: p.x + rand(-20, 20), y: p.y + rand(-8, 18), r: rand(32, 54) });
    }

    // ---- 神秘祭坛（T3 完整，低 Tier 小水晶）----
    if (tier >= 3) {
      const p = safePoint(g, size, 520);
      g.fxDecals.push({ kind: 'rune', x: p.x, y: p.y, r: 124 });
      g.fxProps.push({ type: 'crystal', x: p.x, y: p.y });
    } else if (Math.random() < 0.6) {
      const p = safePoint(g, size);
      g.fxProps.push({ type: 'crystal', x: p.x, y: p.y, small: true });
    }

    // ---- 路边歪掉的木路标 ----
    for (let i = 0; i < 3; i++) {
      const road = g.terrainRoads[randInt(0, g.terrainRoads.length - 1)];
      if (!road) break;
      const t = rand(0.2, 0.8);
      const mt = 1 - t;
      const bx = mt * mt * road.x1 + 2 * mt * t * road.cx + t * t * road.x2;
      const by = mt * mt * road.y1 + 2 * mt * t * road.cy + t * t * road.y2;
      let nx = -(road.y2 - road.y1), ny = (road.x2 - road.x1);
      const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
      const side = Math.random() < 0.5 ? -1 : 1;
      g.fxProps.push({
        type: 'signpost', x: bx + nx * 42 * side, y: by + ny * 42 * side,
        rot: rand(-0.22, 0.22)
      });
    }
  }

  // ---------- 更新（天气循环 / 狼嚎）----------
  function update(g, dt) {
    const w = g.fxWeather;
    if (!w) return;
    w.timer -= dt;
    if (w.flash > 0) w.flash = Math.max(0, w.flash - dt * 3.2);
    // 湿地表随天气
    const wetTarget = (w.state === 'rain' || w.state === 'storm') ? 1 : 0;
    w.wet += (wetTarget - w.wet) * Math.min(1, dt * 0.5);
    // 雾天压缩战争迷雾视野到约 200px
    if (g._baseVision == null) g._baseVision = g.visionRadius;
    const _vm = (window.V5 && V5.visionMul) ? V5.visionMul(g) : 1;
    if (w.state === 'fog') g.visionRadius = g._baseVision * 0.55 * _vm;
    else if (Math.abs(g.visionRadius - g._baseVision * _vm) > 0.5) g.visionRadius = g._baseVision * _vm;
    if (w.timer <= 0) {
      const order = ['clear', 'cloud', 'rain', 'storm', 'fog'];
      const idx = order.indexOf(w.state);
      w.state = order[(idx + 1) % order.length];
      w.timer = rand(55, 100);
      w.nextFlash = rand(1.5, 5);
      if (typeof showToast === 'function') {
        const name = { clear: '天气放晴', cloud: '云层渐厚', rain: '下起了雨', storm: '雷暴来袭', fog: '雾气弥漫' }[w.state];
        showToast(name, 'info');
      }
    }
    if (w.state === 'storm') {
      w.nextFlash -= dt;
      if (w.nextFlash <= 0) { w.flash = 1; w.nextFlash = rand(3, 8); }
    }
    // 雨声音效
    updateRainAudio(g);
    // 远处狼嚎
    g.fxHowlTimer -= dt;
    if (g.fxHowlTimer <= 0) {
      g.fxHowlTimer = rand(40, 85);
      playHowl();
    }
  }

  function updateRainAudio(g) {
    const w = g.fxWeather;
    const want = (w.state === 'rain' || w.state === 'storm') ? 1 : 0;
    try {
      const AM = (typeof AudioManager !== 'undefined') ? AudioManager : null;
      if (!AM || !AM.ctx) return;
      if (want && !rainAudio) {
        const ctx = AM.ctx;
        const len = ctx.sampleRate * 2;
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
        const gn = ctx.createGain(); gn.gain.value = 0;
        src.connect(hp); hp.connect(gn);
        if (AM.master) gn.connect(AM.master);
        src.start();
        rainAudio = { src, gn };
      }
      if (rainAudio) {
        const target = want ? (w.state === 'storm' ? 0.09 : 0.05) : 0;
        rainAudio.gn.gain.setTargetAtTime(target, AM.ctx.currentTime, 0.6);
      }
    } catch (e) { /* 音频不可用时静默 */ }
  }

  function playHowl() {
    try {
      const AM = (typeof AudioManager !== 'undefined') ? AudioManager : null;
      if (!AM || !AM.ctx || !AM.enabled) return;
      const ctx = AM.ctx, now = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
      const gn = ctx.createGain();
      o.frequency.setValueAtTime(210, now);
      o.frequency.linearRampToValueAtTime(150, now + 0.7);
      o.frequency.linearRampToValueAtTime(95, now + 1.5);
      gn.gain.setValueAtTime(0, now);
      gn.gain.linearRampToValueAtTime(0.05, now + 0.25);
      gn.gain.linearRampToValueAtTime(0, now + 1.6);
      o.connect(lp); lp.connect(gn);
      if (AM.master) gn.connect(AM.master);
      o.start(now); o.stop(now + 1.7);
    } catch (e) { /* ignore */ }
  }

  // ---------- 地面贴花（世界空间，实体之前）----------
  function renderGround(ctx, g) {
    const cam = g.camera;
    const W = CONFIG.canvas.width, H = CONFIG.canvas.height;
    const t = performance.now() / 1000;
    // 焦痕 / 符文圈
    for (const d of g.fxDecals || []) {
      const sx = d.x - cam.x, sy = d.y - cam.y;
      if (sx < -200 || sx > W + 200 || sy < -200 || sy > H + 200) continue;
      if (d.kind === 'scorch') {
        const grd = ctx.createRadialGradient(sx, sy, 2, sx, sy, d.r);
        grd.addColorStop(0, 'rgba(20,16,12,0.55)');
        grd.addColorStop(0.6, 'rgba(30,24,18,0.3)');
        grd.addColorStop(1, 'rgba(30,24,18,0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.ellipse(sx, sy, d.r, d.r * 0.62, 0, 0, TAU); ctx.fill();
      } else if (d.kind === 'rune') {
        ctx.save();
        ctx.translate(sx, sy);
        const grd = ctx.createRadialGradient(0, 0, 10, 0, 0, d.r);
        grd.addColorStop(0, 'rgba(150,80,220,0.18)');
        grd.addColorStop(1, 'rgba(150,80,220,0)');
        ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(0, 0, d.r, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(190,120,255,0.55)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, d.r * 0.8, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, d.r * 0.5, 0, TAU); ctx.stroke();
        ctx.rotate(t * 0.15);
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * TAU;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * d.r * 0.5, Math.sin(a) * d.r * 0.5);
          ctx.lineTo(Math.cos(a) * d.r * 0.72, Math.sin(a) * d.r * 0.72);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    // Boss 红色脉冲光环（压在地面）
    if (g.boss && g.boss.hp > 0) {
      const b = g.boss, bsx = b.x - cam.x, bsy = b.y - cam.y;
      if (bsx > -200 && bsx < W + 200 && bsy > -200 && bsy < H + 200) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 3);
        const R = b.radius * (2.4 + pulse * 0.5);
        const grd = ctx.createRadialGradient(bsx, bsy, 8, bsx, bsy, R);
        grd.addColorStop(0, `rgba(220,40,40,${0.28 + pulse * 0.14})`);
        grd.addColorStop(0.6, 'rgba(180,30,30,0.12)');
        grd.addColorStop(1, 'rgba(180,30,30,0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.ellipse(bsx, bsy, R, R * 0.55, 0, 0, TAU); ctx.fill();
      }
    }
    // 雨天湿地反光
    if (g.fxWeather && g.fxWeather.wet > 0.05) {
      ctx.save();
      ctx.globalAlpha = 0.05 * g.fxWeather.wet;
      ctx.fillStyle = '#9fb6cc';
      for (let i = 0; i < 18; i++) {
        const wx = ((i * 211 + cam.x * 0.3) % W + W) % W;
        const wy = ((i * 137 + cam.y * 0.3) % H + H) % H;
        ctx.beginPath(); ctx.ellipse(wx, wy, 46, 14, 0, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
  }

  // ---------- 废墟墙 ----------
  function renderWall(ctx, g, w) {
    const sx = w.x - g.camera.x, sy = w.y - g.camera.y;
    ctx.save();
    ctx.translate(sx, sy);
    // 落地投影（右下偏移，左上光源）
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(4, 10, w.len / 2, 12, 0, 0, TAU); ctx.fill();
    ctx.rotate(w.rotation);
    const half = w.len / 2;
    const drawSeg = (a0, a1) => {
      const x0 = half * a0, x1 = half * a1, sw = x1 - x0;
      if (sw <= 4) return;
      // 顶面（亮）
      ctx.fillStyle = '#8f8c83';
      ctx.fillRect(x0, -30, sw, 13);
      // 正面（暗）
      ctx.fillStyle = '#6d6a62';
      ctx.fillRect(x0, -17, sw, 26);
      // 砖缝
      ctx.strokeStyle = 'rgba(40,38,34,0.6)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x0, -4); ctx.lineTo(x1, -4); ctx.stroke();
      const blocks = Math.max(2, Math.floor(sw / 26));
      for (let i = 1; i < blocks; i++) {
        const bx = x0 + (sw / blocks) * i;
        ctx.beginPath(); ctx.moveTo(bx, -17); ctx.lineTo(bx, 9); ctx.stroke();
      }
      // 顶部高光
      ctx.fillStyle = 'rgba(200,196,184,0.5)';
      ctx.fillRect(x0, -30, sw, 3);
    };
    const gaps = w.gaps || [];
    if (!gaps.length) drawSeg(-1, 1);
    else {
      let cur = -1;
      for (const gp of gaps) { drawSeg(cur, gp.t - gp.w / 2); cur = gp.t + gp.w / 2; }
      drawSeg(cur, 1);
    }
    ctx.restore();
  }

  // ---------- 叙事竖物（篝火/断剑/水晶/路标/木箱）----------
  function renderSetProp(ctx, g, p) {
    const sx = p.x - g.camera.x, sy = p.y - g.camera.y;
    const t = performance.now() / 1000;
    ctx.save();
    ctx.translate(sx, sy);
    if (p.type === 'crate') {
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath(); ctx.ellipse(3, 8, 16, 6, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#7a5a34'; ctx.fillRect(-13, -22, 26, 26);
      ctx.strokeStyle = '#5a4022'; ctx.lineWidth = 2;
      ctx.strokeRect(-13, -22, 26, 26);
      ctx.beginPath(); ctx.moveTo(-13, -9); ctx.lineTo(13, -9); ctx.moveTo(-13, 1); ctx.lineTo(13, 1); ctx.stroke();
    } else if (p.type === 'brokensword') {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(2, 6, 12, 4, 0, 0, TAU); ctx.fill();
      ctx.rotate(p.rot || 0);
      ctx.rotate(-0.5);
      // 半截剑插在地里
      ctx.fillStyle = '#9aa3ad';
      ctx.beginPath();
      ctx.moveTo(0, -34); ctx.lineTo(4, -28); ctx.lineTo(3, 4); ctx.lineTo(-3, 4); ctx.lineTo(-4, -28);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#6b4a28'; ctx.fillRect(-4, 4, 8, 5);
    } else if (p.type === 'signpost') {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(2, 6, 10, 4, 0, 0, TAU); ctx.fill();
      ctx.rotate(p.rot || 0);
      // 指向最近撤离点
      let ang = 0;
      if (g.extractPoints && g.extractPoints.length) {
        let best = g.extractPoints[0], bd = Infinity;
        for (const ep of g.extractPoints) {
          const dd = Math.hypot(ep.x - p.x, ep.y - p.y);
          if (dd < bd) { bd = dd; best = ep; }
        }
        ang = Math.atan2(best.y - p.y, best.x - p.x) - p.rot;
      }
      ctx.fillStyle = '#6b4a28';
      ctx.fillRect(-3, -34, 6, 40);
      ctx.save();
      ctx.rotate(clamp(ang, -0.6, 0.6) * 0.3);
      ctx.fillStyle = '#8a6438';
      ctx.fillRect(-22, -36, 44, 14);
      ctx.strokeStyle = '#5a3e1e'; ctx.lineWidth = 1.5;
      ctx.strokeRect(-22, -36, 44, 14);
      ctx.fillStyle = '#e8d8b0'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('撤离', 0, -26);
      ctx.restore();
    } else if (p.type === 'crystal') {
      const small = p.small;
      const R = small ? 26 : 60;
      const pulse = 0.6 + 0.4 * Math.sin(t * 2.2);
      const grd = ctx.createRadialGradient(0, -10, 2, 0, -10, R);
      grd.addColorStop(0, `rgba(190,110,255,${0.5 * pulse})`);
      grd.addColorStop(1, 'rgba(150,80,220,0)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(0, -10, R, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.ellipse(2, 6, 14, 5, 0, 0, TAU); ctx.fill();
      const h = small ? 26 : 48;
      ctx.fillStyle = '#b06ef0';
      ctx.beginPath();
      ctx.moveTo(0, -h); ctx.lineTo(10, -h * 0.4); ctx.lineTo(6, 2); ctx.lineTo(-6, 2); ctx.lineTo(-10, -h * 0.4);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(240,210,255,0.7)';
      ctx.beginPath();
      ctx.moveTo(0, -h); ctx.lineTo(4, -h * 0.4); ctx.lineTo(0, 0); ctx.lineTo(-4, -h * 0.4);
      ctx.closePath(); ctx.fill();
    } else if (p.type === 'campfire') {
      // 石圈
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.ellipse(2, 8, 20, 8, 0, 0, TAU); ctx.fill();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        ctx.fillStyle = '#7d7a72';
        ctx.beginPath(); ctx.arc(Math.cos(a) * 15, Math.sin(a) * 7 + 4, 4, 0, TAU); ctx.fill();
      }
      // 交叉木柴
      ctx.strokeStyle = '#5a3c20'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-12, 2); ctx.lineTo(12, -4); ctx.moveTo(-12, -4); ctx.lineTo(12, 2); ctx.stroke();
      // 火焰（闪烁）
      const fl = 1 + Math.sin(t * 11) * 0.12 + Math.sin(t * 23) * 0.08;
      const night = g.dayNightPhase === 'night';
      const glowR = (night ? 70 : 40) * fl;
      const gg = ctx.createRadialGradient(0, -12, 2, 0, -12, glowR);
      gg.addColorStop(0, `rgba(255,170,60,${night ? 0.55 : 0.3})`);
      gg.addColorStop(1, 'rgba(255,140,40,0)');
      ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(0, -12, glowR, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ff7b1c';
      ctx.beginPath();
      ctx.moveTo(0, -34 * fl); ctx.quadraticCurveTo(9, -18, 5, -4); ctx.quadraticCurveTo(0, 2, -5, -4);
      ctx.quadraticCurveTo(-9, -18, 0, -34 * fl); ctx.fill();
      ctx.fillStyle = '#ffd35a';
      ctx.beginPath();
      ctx.moveTo(0, -22 * fl); ctx.quadraticCurveTo(5, -12, 3, -4); ctx.quadraticCurveTo(-3, -4, -3, -4);
      ctx.quadraticCurveTo(-5, -12, 0, -22 * fl); ctx.fill();
    }
    ctx.restore();
  }

  // ---------- 前景遮挡草（屏幕空间底部）----------
  function renderForeground(ctx, g) {
    const W = CONFIG.canvas.width, H = CONFIG.canvas.height;
    const t = performance.now() / 1000;
    const tier = g.map.tier;
    const baseColor = tier >= 3 ? '26,30,20' : (tier === 2 ? '42,46,28' : '46,64,32');
    ctx.save();
    // 底部高草剪影带，越靠下越密越高，轻微风摆
    const blades = 46;
    for (let i = 0; i < blades; i++) {
      const seed = i * 97.13;
      const fx = (seed % 1280);
      const norm = ((i * 53) % 100) / 100; // 0..1 分布
      const bandY = H - 10 - Math.pow(norm, 1.6) * 96;
      const h = 26 + ((i * 29) % 48);
      const sway = Math.sin(t * 1.3 + i) * 5;
      const alpha = 0.55 + norm * 0.35;
      ctx.strokeStyle = `rgba(${baseColor},${alpha})`;
      ctx.lineWidth = 2 + (i % 3);
      ctx.beginPath();
      ctx.moveTo(fx, bandY + h);
      ctx.quadraticCurveTo(fx + sway * 0.5, bandY + h * 0.5, fx + sway, bandY);
      ctx.stroke();
      // 叶尖小分叉
      if (i % 3 === 0) {
        ctx.beginPath();
        ctx.moveTo(fx + sway, bandY + 6);
        ctx.lineTo(fx + sway - 7, bandY - 2);
        ctx.moveTo(fx + sway, bandY + 6);
        ctx.lineTo(fx + sway + 7, bandY - 1);
        ctx.stroke();
      }
    }
    // 底部整体深色渐变，把草根"种"进地里
    const grd = ctx.createLinearGradient(0, H - 70, 0, H);
    grd.addColorStop(0, `rgba(${baseColor},0)`);
    grd.addColorStop(1, `rgba(${baseColor},0.5)`);
    ctx.fillStyle = grd;
    ctx.fillRect(0, H - 70, W, 70);
    ctx.restore();
  }

  // ---------- 环境粒子（屏幕空间）----------
  function renderAmbient(ctx, g) {
    const W = CONFIG.canvas.width, H = CONFIG.canvas.height;
    const t = performance.now() / 1000;
    const night = g.dayNightPhase === 'night' || g.dayNightPhase === 'dusk';
    ctx.save();
    if (night) {
      // 萤火虫
      for (let i = 0; i < 26; i++) {
        const x = (i * 173 + Math.sin(t * 0.5 + i) * 60 + t * 8) % W;
        const y = (i * 97 + Math.cos(t * 0.4 + i * 1.7) * 40 + 200) % H;
        const glow = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.6 + i));
        const grd = ctx.createRadialGradient(x, y, 0, x, y, 5);
        grd.addColorStop(0, `rgba(200,255,130,${0.8 * glow})`);
        grd.addColorStop(1, 'rgba(200,255,130,0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(x, y, 5, 0, TAU); ctx.fill();
      }
    } else if (g.map.tier <= 2) {
      // 落叶 / 花瓣
      for (let i = 0; i < 22; i++) {
        const x = ((i * 211 + t * (18 + (i % 5) * 6)) % (W + 40)) - 20;
        const y = ((i * 137 + t * 26 + Math.sin(t + i) * 24) % (H + 40)) - 20;
        ctx.save();
        ctx.translate(x, y); ctx.rotate(Math.sin(t + i) + i);
        ctx.fillStyle = i % 3 === 0 ? 'rgba(214,150,70,0.6)' : 'rgba(190,170,80,0.55)';
        ctx.beginPath();
        ctx.moveTo(0, -4); ctx.lineTo(3, 0); ctx.lineTo(0, 4); ctx.lineTo(-3, 0);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    } else {
      // T3 黑雾余烬
      for (let i = 0; i < 16; i++) {
        const x = ((i * 167 + Math.sin(t * 0.3 + i) * 80) % W + W) % W;
        const y = ((i * 109 - t * 16) % H + H) % H;
        const r = 40 + (i % 4) * 18;
        const grd = ctx.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, 'rgba(90,60,120,0.1)');
        grd.addColorStop(1, 'rgba(90,60,120,0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  }

  // ---------- 雨丝 / 雾（屏幕空间）----------
  function renderWeatherFX(ctx, g) {
    const w = g.fxWeather;
    if (!w) return;
    const W = CONFIG.canvas.width, H = CONFIG.canvas.height;
    const t = performance.now() / 1000;
    ctx.save();
    if (w.state === 'rain' || w.state === 'storm') {
      const n = w.state === 'storm' ? 110 : 70;
      const len = w.state === 'storm' ? 24 : 18;
      ctx.strokeStyle = w.state === 'storm' ? 'rgba(190,200,230,0.55)' : 'rgba(160,185,220,0.4)';
      ctx.lineWidth = 1.3;
      for (let i = 0; i < n; i++) {
        const spd = w.state === 'storm' ? 1100 : 820;
        const x = ((i * 61 + t * spd * 0.35) % (W + 60)) - 30;
        const y = ((i * 97 + t * spd) % (H + 60)) - 30;
        ctx.globalAlpha = 0.4 + (i % 4) * 0.08;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 4, y + len); ctx.stroke();
      }
    } else if (w.state === 'fog') {
      for (let i = 0; i < 6; i++) {
        const x = W / 2 + Math.sin(t * 0.15 + i) * 300;
        const y = H / 2 + Math.cos(t * 0.12 + i * 2) * 200;
        const r = 260 + (i % 3) * 80;
        const grd = ctx.createRadialGradient(x, y, 40, x, y, r);
        grd.addColorStop(0, 'rgba(200,210,215,0.16)');
        grd.addColorStop(1, 'rgba(200,210,215,0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  }

  // ---------- 胶片颗粒（预生成平铺）----------
  function getNoiseTile() {
    if (noiseTile) return noiseTile;
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const cc = c.getContext('2d');
    const img = cc.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = Math.random() * 14; // 极低透明度颗粒
    }
    cc.putImageData(img, 0, 0);
    noiseTile = c;
    return c;
  }

  // ---------- 全局后处理 ----------
  function postProcess(ctx, g) {
    const W = CONFIG.canvas.width, H = CONFIG.canvas.height;
    const t = performance.now() / 1000;
    const w = g.fxWeather;

    // 天气压暗
    if (w) {
      if (w.state === 'cloud') { ctx.fillStyle = 'rgba(70,76,90,0.08)'; ctx.fillRect(0, 0, W, H); }
      else if (w.state === 'rain') { ctx.fillStyle = 'rgba(40,52,72,0.16)'; ctx.fillRect(0, 0, W, H); }
      else if (w.state === 'storm') { ctx.fillStyle = 'rgba(30,38,58,0.22)'; ctx.fillRect(0, 0, W, H); }
      else if (w.state === 'fog') { ctx.fillStyle = 'rgba(180,195,200,0.12)'; ctx.fillRect(0, 0, W, H); }
    }

    // 夜晚火把暖光（叠加，提亮玩家周围）
    if (g.dayNightPhase === 'night') {
      const px = g.player.x - g.camera.x, py = g.player.y - g.camera.y;
      const torchBonus = (g.player.torchTime && g.player.torchTime > 0) ? 80 : 0;
      const R = 180 + torchBonus;
      const grd = ctx.createRadialGradient(px, py, R * 0.2, px, py, R);
      grd.addColorStop(0, 'rgba(255,170,80,0.16)');
      grd.addColorStop(0.7, 'rgba(255,150,60,0.05)');
      grd.addColorStop(1, 'rgba(255,150,60,0)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(px, py, R, 0, TAU); ctx.fill();
    }

    // 环境粒子 + 雨雾
    renderAmbient(ctx, g);
    renderWeatherFX(ctx, g);

    // 全局暖褐色调（统一美术语言）
    ctx.fillStyle = 'rgba(180,130,80,0.13)';
    ctx.fillRect(0, 0, W, H);

    // 边缘色差（极轻）
    ctx.fillStyle = 'rgba(255,60,40,0.03)';
    ctx.fillRect(0, 0, 3, H);
    ctx.fillStyle = 'rgba(60,140,255,0.03)';
    ctx.fillRect(W - 3, 0, 3, H);

    // 暗角 0.4
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.72);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(10,8,6,0.4)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    // 胶片颗粒（随机偏移平铺）
    const tile = getNoiseTile();
    const ox = Math.floor(Math.random() * 256), oy = Math.floor(Math.random() * 256);
    ctx.save();
    ctx.globalAlpha = 0.5;
    for (let x = -ox; x < W; x += 256) for (let y = -oy; y < H; y += 256) ctx.drawImage(tile, x, y);
    ctx.restore();

    // 雷暴白闪
    if (w && w.flash > 0) {
      ctx.fillStyle = `rgba(235,240,255,${w.flash * 0.55})`;
      ctx.fillRect(0, 0, W, H);
    }

    // 死亡渐黑（0.9s）
    if (g.gameOver && g.result === 'failed') {
      if (!g._deathFadeAt) g._deathFadeAt = t;
      const k = clamp((t - g._deathFadeAt) / 0.9, 0, 1);
      ctx.fillStyle = `rgba(5,4,3,${k * 0.92})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  return { generate, update, renderGround, renderWall, renderSetProp, renderForeground, postProcess };
})();
