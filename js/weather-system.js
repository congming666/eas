// ============================================================
// weather-system.js  v1.0  (v5.7「天气重构」)
// 一套数据驱动的“连续天气”：状态 + 连续强度（降水量 precip /
// 风力 wind / 雾浓度 fog / 云量 cloud / 积雪 snow，0→1），平滑过渡。
// 农场与远征共用 id 与逻辑：
//   - 远征：地图生物群系气候（世界空间渲染，相机视差）
//   - 农场：家园小气候（屏幕空间 canvas 覆盖）
// 含：世界空间 3 层雨、地面积水/反光/水花、实体闪电（预警圈+
// 劈落+距离雷声）、移动雾层（与视野融合）、云影、雪与寒冷值、
// 天气玩法修正（火/电/潜行）、集雨桶/避雷针设施、分层音频。
// 纯 Canvas + Web Audio，零构建，file:// 直开。
// ============================================================
(function () {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const reduceMotion = typeof window !== 'undefined' &&
    !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // GameState 若由顶层 let/const 声明则不挂在 window 上，需通过裸标识符解析
  function gameState() {
    try { if (typeof GameState !== 'undefined' && GameState) return GameState; } catch (e) {}
    return window['GameState'] || null;
  }

  // 画质系数（0.5 低 / 1 标准 / 1.5 高）
  function quality() {
    try {
      const g = window.CONFIG && CONFIG.graphics;
      if (g && (g.quality === 'low' || g.quality === 0.5)) return 0.55;
      if (g && (g.quality === 'high' || g.quality === 1.5)) return 1.35;
      if (window.PerfBudget && PerfBudget.quality) {
        const q = PerfBudget.quality();
        if (q === 'low') return 0.55;
        if (q === 'high') return 1.35;
      }
    } catch (e) {}
    return 1;
  }

  // ============================================================
  // 天气目录：目标强度向量 + 名称 + 调色
  // ============================================================
  const CAT = {
    clear:      { name: '晴',     icon: '☀️', v: { cloud: .08, precip: 0,   fog: 0,   wind: .10, snow: 0 }, grade: { r: 255, g: 244, b: 214, a: 0 } },
    cloud:      { name: '多云',   icon: '⛅', v: { cloud: .55, precip: 0,   fog: .12, wind: .20, snow: 0 }, grade: { r: 150, g: 158, b: 170, a: .09 } },
    rain:       { name: '小雨',   icon: '🌦️', v: { cloud: .70, precip: .50, fog: .10, wind: .25, snow: 0 }, grade: { r: 70, g: 92, b: 130, a: .15 } },
    heavy_rain: { name: '大雨',   icon: '🌧️', v: { cloud: .85, precip: .92, fog: .20, wind: .45, snow: 0 }, grade: { r: 48, g: 66, b: 104, a: .22 } },
    storm:      { name: '雷暴',   icon: '⛈️', v: { cloud: .95, precip: .80, fog: .15, wind: .70, snow: 0 }, grade: { r: 40, g: 48, b: 80, a: .28 } },
    fog:        { name: '浓雾',   icon: '🌫️', v: { cloud: .50, precip: .05, fog: .92, wind: .08, snow: 0 }, grade: { r: 170, g: 182, b: 188, a: .13 } },
    snow:       { name: '降雪',   icon: '❄️', v: { cloud: .70, precip: 0,   fog: .25, wind: .30, snow: .85 }, grade: { r: 180, g: 196, b: 214, a: .09 } },
  };
  const IDS = Object.keys(CAT);

  // ============================================================
  // 状态工厂
  // ============================================================
  function make(scope) {
    const s = {
      scope, state: 'clear', next: null,
      timer: 0, duration: 0, trans: scope === 'farm' ? 14 : 12,
      cur: { cloud: .08, precip: 0, fog: 0, wind: .10, snow: 0 },
      wet: 0, cover: 0, flash: 0,
      bolts: [], telegraphs: [], splashes: [], banks: [],
      puddles: [], shadows: [], snowPatches: [], flakes: [],
      boltTimer: 5, rainAcc: 0, barrelAcc: 0, stormAcc: 0, t: 0, cold: 0,
      announced: false,
    };
    return s;
  }

  function season() { return (gameState() && GameState.season) || 'spring'; }

  // ---------- 远征：权重（Tier × 季节 × 地图倾向）----------
  function expeditionWeights(g) {
    const tier = (g.map && g.map.tier) || 0;
    const sea = season();
    const w = {
      clear: 16 - tier * 2,
      cloud: 18,
      rain: 14 + tier * 2,
      heavy_rain: 6 + tier * 4,
      storm: 4 + tier * 7,
      fog: 5 + tier * 5,
      snow: sea === 'winter' ? 10 + tier * 4 : (tier >= 3 ? 6 : 0),
    };
    // 地图词条/天气倾向
    const tend = String((g.map && (g.map.weather || g.map.modifier || g.map.name)) || '');
    if (/雾/.test(tend)) w.fog += 10;
    if (/雷|焦/.test(tend)) w.storm += 10;
    if (/雨|水|湾|沼|湿/.test(tend)) { w.rain += 6; w.heavy_rain += 6; }
    if (/雪|寒|冰/.test(tend)) w.snow += 12;
    if (/晴|开阔/.test(tend)) w.clear += 6;
    return w;
  }

  // ---------- 农场：权重（季节主导，更温和）----------
  function farmWeights() {
    switch (season()) {
      case 'spring': return { clear: 22, cloud: 18, rain: 16, fog: 6, storm: 3, snow: 0, heavy_rain: 4 };
      case 'summer': return { clear: 26, cloud: 14, rain: 10, fog: 3, storm: 6, snow: 0, heavy_rain: 3 };
      case 'autumn': return { clear: 18, cloud: 18, rain: 10, fog: 14, storm: 4, snow: 0, heavy_rain: 4 };
      case 'winter': return { clear: 10, cloud: 14, rain: 0, fog: 8, storm: 0, snow: 26, heavy_rain: 0 };
      default:       return { clear: 20, cloud: 18, rain: 12, fog: 8, storm: 4, snow: 0, heavy_rain: 4 };
    }
  }

  function weightedPick(weights, exclude) {
    let total = 0;
    for (const k in weights) { if (k === exclude) continue; total += Math.max(0, weights[k]); }
    let r = Math.random() * total;
    for (const k in weights) {
      if (k === exclude) continue;
      r -= Math.max(0, weights[k]);
      if (r <= 0) return k;
    }
    return 'clear';
  }

  function schedule(s, weights) {
    s.state = s.next || s.state;
    s.next = null; s.announced = false;
    s.duration = s.scope === 'farm' ? rand(80, 150) : rand(55, 95);
    s.timer = s.duration;
  }

  // ============================================================
  // 附着
  // ============================================================
  function attachExpedition(g) {
    const s = g.weather || make('expedition');
    g.weather = s; g.fxWeather = s; // 兼容 world-fx 旧引用
    const size = (window.CONFIG && CONFIG.expedition.mapSize) || 3600;
    // 水洼（世界坐标，湿时显现）
    if (!s.puddles.length) {
      for (let i = 0; i < 16; i++)
        s.puddles.push({ x: rand(300, size - 300), y: rand(300, size - 300), rx: rand(28, 60), ry: rand(16, 34) });
    }
    // 云影（随风漂移的软斑）
    if (!s.shadows.length) {
      for (let i = 0; i < 7; i++)
        s.shadows.push({ x: rand(0, size), y: rand(0, size), r: rand(160, 280), vx: rand(6, 16) });
    }
    // 雪斑（积雪用）
    if (!s.snowPatches.length) {
      for (let i = 0; i < 26; i++)
        s.snowPatches.push({ x: rand(0, size), y: rand(0, size), r: rand(70, 150) });
    }
    // 雾堤（大团漂移雾）
    if (!s.banks.length) {
      for (let i = 0; i < 6; i++)
        s.banks.push({ x: rand(-400, size + 400), y: rand(-400, size + 400), r: rand(380, 620), vx: rand(-8, 8), vy: rand(-5, 5) });
    }
    if (!s.duration) { s.duration = rand(55, 95); s.timer = s.duration; }
    return s;
  }

  function attachFarm() {
    const gs = gameState();
    if (!gs) return null;
    let s = gs.farmWeather;
    if (!s) { s = make('farm'); gs.farmWeather = s; s.duration = rand(80, 150); s.timer = s.duration; }
    gs.facilities = gs.facilities || { rain_barrel: 0, lightning_rod: 0 };
    return s;
  }

  // ============================================================
  // 闪电
  // ============================================================
  function nearCampfire(g, x, y) {
    if (!g.fxProps) return false;
    return g.fxProps.some(p => p.type === 'campfire' && Math.hypot(p.x - x, p.y - y) < 240);
  }

  function spawnBolt(g, s) {
    const size = (window.CONFIG && CONFIG.expedition.mapSize) || 3600;
    let x, y;
    if (g.player && Math.random() < 0.62) {
      const a = rand(0, TAU), d = rand(200, 540);
      x = clamp(g.player.x + Math.cos(a) * d, 120, size - 120);
      y = clamp(g.player.y + Math.sin(a) * d, 120, size - 120);
    } else {
      x = rand(160, size - 160); y = rand(160, size - 160);
    }
    s.telegraphs.push({ x, y, t: 0, dur: rand(1.2, 1.8), r: rand(48, 72) });
  }

  function strike(g, s, x, y, r) {
    s.bolts.push({ x, y, life: .42, max: .42, jitter: rand(0, 100), top: rand(400, 560), lean: rand(-60, 60) });
    let dpx = 900;
    if (g.player) dpx = Math.hypot(x - g.player.x, y - g.player.y);
    // 很轻、按距离衰减的全屏柔光（不刺眼）
    if (!reduceMotion) s.flash = Math.max(s.flash, clamp(1 - dpx / 950, 0, 1) * 0.4);
    // 雷声按距离延迟
    const delay = clamp(dpx / 340, 0.06, 2.1);
    setTimeout(() => Audio.thunder(clamp(1 - dpx / 1100, 0.08, 1)), delay * 1000);
    // 焦痕
    if (g.fxDecals) g.fxDecals.push({ kind: 'scorch', x, y, r: rand(42, 66) });
    // 范围伤害（环境）
    const mon = (g.monsters || []).concat(g.raiders || []);
    for (const m of mon) {
      if (m && m.hp > 0 && Math.hypot(m.x - x, m.y - y) < r + (m.radius || 20)) {
        if (typeof g.damageEnemy === 'function') g.damageEnemy(m, rand(30, 46), '#cfe6ff', false, { quiet: true, fromPlayer: false });
      }
    }
    if (g.boss && g.boss.hp > 0 && Math.hypot(g.boss.x - x, g.boss.y - y) < r + 60) {
      if (typeof g.damageEnemy === 'function') g.damageEnemy(g.boss, 40, '#cfe6ff', false, { quiet: true, fromPlayer: false });
    }
    // 玩家没离开预警圈 → 受击
    if (g.player && g.player.hp > 0 && Math.hypot(g.player.x - x, g.player.y - y) < r) {
      if (typeof g.damagePlayer === 'function') g.damagePlayer(rand(22, 34), { type: 'lightning' });
    }
    // 点燃附近油桶/可破坏物
    if (g.obstacles) {
      for (const o of g.obstacles) {
        if (o && /barrel|oil|explosive|油/.test(String(o.type)) && Math.hypot(o.x - x, o.y - y) < r + 40) {
          o.hp = 0; o.destroyed = true;
          if (typeof g.damageEnemy === 'function') {
            for (const m of mon) if (m.hp > 0 && Math.hypot(m.x - o.x, m.y - o.y) < 120)
              g.damageEnemy(m, 40, '#ff8a3c', false, { quiet: true, fromPlayer: false });
          }
        }
      }
    }
  }

  // ============================================================
  // 玩法修正
  // ============================================================
  const FIRE_WEAPON = { flame_bow: 1 };
  function classify(weaponId, color) {
    if (FIRE_WEAPON[weaponId]) return 'fire';
    if (color) {
      const h = String(color).replace('#', '');
      if (h.length === 6) {
        const r = parseInt(h.slice(0, 2), 16), gg = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
        if (r > 170 && gg < 150 && b < 100) return 'fire';
        if (b > 165 && gg > 140 && r < 160) return 'electric';
      }
    }
    return 'physical';
  }

  function modifyOutgoing(host, amount, info) {
    const s = host.weather || (gameState() && GameState.farmWeather);
    if (!s) return amount;
    info = info || {};
    const el = info.element || classify(info.weaponId, info.color);
    const p = s.cur.precip;
    if (el === 'fire' && p > 0.08) amount *= (1 - 0.32 * p);
    if (el === 'electric' && s.wet > 0.1) amount *= (1 + 0.28 * s.wet);
    return amount;
  }

  function visionMul(s) {
    let m = 1 - 0.45 * s.cur.fog;
    m -= 0.08 * s.cur.snow;
    return Math.max(0.45, m);
  }
  function moveMul(s) { return clamp(1 - 0.12 * s.wet - 0.16 * s.cur.snow, 0.7, 1); }
  function fireMul(s) { return 1 - 0.32 * s.cur.precip; }
  function stealth(s) { return s.cur.precip > 0.2 ? 0.15 + 0.15 * s.cur.precip : 0; }

  // ============================================================
  // 远征更新
  // ============================================================
  function updateExpedition(g, dt) {
    const s = attachExpedition(g);
    s.t += dt;
    // 预报：进入过渡窗口时宣布下一天气
    s.timer -= dt;
    if (!s.next && s.timer <= s.trans) {
      s.next = weightedPick(expeditionWeights(g), s.state);
      if (typeof window.showToast === 'function') {
        const c = CAT[s.next];
        showToast('天气预报：' + c.icon + c.name + ' 即将来临', 'info');
      }
    }
    // 目标强度向量（过渡时在两种天气间插值）
    let goal = CAT[s.state].v;
    if (s.next) {
      const k = clamp((s.duration - s.timer) / s.trans, 0, 1);
      const a = CAT[s.state].v, b = CAT[s.next].v;
      goal = { cloud: lerp(a.cloud, b.cloud, k), precip: lerp(a.precip, b.precip, k),
        fog: lerp(a.fog, b.fog, k), wind: lerp(a.wind, b.wind, k), snow: lerp(a.snow, b.snow, k) };
    }
    const rate = Math.min(1, dt / (s.trans * 0.55));
    for (const key in goal) s.cur[key] = lerp(s.cur[key], goal[key], rate);
    if (s.timer <= 0) schedule(s, null);

    // 湿 / 积雪
    s.wet = lerp(s.wet, s.cur.precip, Math.min(1, dt * 0.45));
    const coverTarget = s.cur.snow;
    s.cover = lerp(s.cover, coverTarget, Math.min(1, dt * 0.22));
    if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 2.6);

    // 视野（雾/雪）
    if (g._baseVision == null) g._baseVision = g.visionRadius;
    const _vm = (window.V5 && V5.visionMul) ? V5.visionMul(g) : 1;
    g.visionRadius = g._baseVision * visionMul(s) * _vm;

    // 雷暴：调度落雷
    if (s.cur.precip > 0.4 && s.cur.wind > 0.4) {
      s.boltTimer -= dt;
      if (s.boltTimer <= 0) { spawnBolt(g, s); s.boltTimer = rand(2.6, 5.8) / (0.7 + s.cur.precip * 0.5); }
    }
    // 预警 → 落雷
    for (let i = s.telegraphs.length - 1; i >= 0; i--) {
      const tg = s.telegraphs[i]; tg.t += dt;
      if (tg.t >= tg.dur) { strike(g, s, tg.x, tg.y, tg.r); s.telegraphs.splice(i, 1); }
    }
    for (let i = s.bolts.length - 1; i >= 0; i--) { s.bolts[i].life -= dt; if (s.bolts[i].life <= 0) s.bolts.splice(i, 1); }

    // 水花（地面世界坐标）
    if (s.cur.precip > 0.1 && g.player) {
      s.rainAcc += dt * (18 + s.cur.precip * 40) * quality();
      while (s.rainAcc >= 1) {
        s.rainAcc -= 1;
        const a = rand(0, TAU), rr = Math.sqrt(Math.random());
        const half = 560;
        s.splashes.push({ x: g.player.x + Math.cos(a) * half * 2 * rr - half,
          y: g.player.y + Math.sin(a) * half * 2 * rr - half, life: .5, max: .5 });
      }
    }
    for (let i = s.splashes.length - 1; i >= 0; i--) { s.splashes[i].life -= dt; if (s.splashes[i].life <= 0) s.splashes.splice(i, 1); }

    // 雾堤漂移
    const size = (window.CONFIG && CONFIG.expedition.mapSize) || 3600;
    for (const bk of s.banks) {
      bk.x += (bk.vx + s.cur.wind * 14) * dt; bk.y += bk.vy * dt;
      if (bk.x < -700) bk.x = size + 600; if (bk.x > size + 700) bk.x = -600;
      if (bk.y < -700) bk.y = size + 600; if (bk.y > size + 700) bk.y = -600;
    }
    // 云影漂移
    for (const sh of s.shadows) {
      sh.x += (sh.vx + s.cur.wind * 18) * dt;
      if (sh.x > size + 300) sh.x = -300;
    }

    // 寒冷值（雪）
    updateCold(g, s, dt);

    // 音频
    Audio.update(s);
  }

  function updateCold(g, s, dt) {
    const p = g.player;
    if (!p) return;
    const tier = (g.map && g.map.tier) || 0;
    let rate = s.cur.snow * (1.1 + tier * 0.4);
    const warm = (p.warmUntil && p.warmUntil > performance.now()) || nearCampfire(g, p.x, p.y);
    if (warm) rate = -6;
    if (s.cur.snow < 0.05) rate = -3;
    s.cold = clamp(s.cold + rate * dt, 0, 100);
    p.cold = s.cold;
    if (s.cold > 40 && p.energy > 0) p.energy = Math.max(0, p.energy - (s.cold > 70 ? 7 : 2) * dt);
    if (s.cold > 92 && p.hp > 0) p.hp = Math.max(1, p.hp - 2 * dt);
  }

  // ============================================================
  // 农场更新（由 FarmCareSystem.tick 调用）
  // ============================================================
  function updateFarm(dt) {
    const s = attachFarm();
    if (!s) return s;
    s.t += dt;
    s.timer -= dt;
    if (!s.next && s.timer <= s.trans) {
      s.next = weightedPick(farmWeights(), s.state);
      if (typeof window.showToast === 'function') {
        const c = CAT[s.next];
        showToast('天气预报：' + c.icon + c.name + ' 即将来临', 'info');
      }
    }
    let goal = CAT[s.state].v;
    if (s.next) {
      const k = clamp((s.duration - s.timer) / s.trans, 0, 1);
      const a = CAT[s.state].v, b = CAT[s.next].v;
      goal = { cloud: lerp(a.cloud, b.cloud, k), precip: lerp(a.precip, b.precip, k),
        fog: lerp(a.fog, b.fog, k), wind: lerp(a.wind, b.wind, k), snow: lerp(a.snow, b.snow, k) };
    }
    const rrate = Math.min(1, dt / (s.trans * 0.55));
    for (const key in goal) s.cur[key] = lerp(s.cur[key], goal[key], rrate);
    if (s.timer <= 0) schedule(s, null);
    s.wet = lerp(s.wet, s.cur.precip, Math.min(1, dt * 0.45));
    s.cover = lerp(s.cover, s.cur.snow, Math.min(1, dt * 0.22));
    if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 2.6);

    // 雷暴：视觉闪电（农场）+ 作物风险
    if (s.cur.precip > 0.4 && s.cur.wind > 0.4) {
      s.boltTimer -= dt;
      if (s.boltTimer <= 0) {
        const x = rand(60, 1200);
        s.bolts.push({ x, y: 620, life: .4, max: .4, jitter: rand(0, 100), top: rand(420, 560), lean: rand(-50, 50), screen: true });
        if (!reduceMotion) s.flash = Math.max(s.flash, 0.3);
        setTimeout(() => Audio.thunder(rand(0.3, 0.8)), rand(0.2, 1.2) * 1000);
        s.boltTimer = rand(3, 7);
        // 作物风险
        s.stormAcc += dt;
        if (s.stormAcc > 12) {
          s.stormAcc = 0;
          farmStormHit(s);
        }
      }
    }
    for (let i = s.bolts.length - 1; i >= 0; i--) { s.bolts[i].life -= dt; if (s.bolts[i].life <= 0) s.bolts.splice(i, 1); }

    // 集雨桶：雨天产清水
    const gs = gameState();
    if (gs.facilities.rain_barrel && s.cur.precip > 0.08 && window.ResourceSystem) {
      s.barrelAcc += dt * (0.4 + s.cur.precip * 0.8);
      while (s.barrelAcc >= 1) { s.barrelAcc -= 1; ResourceSystem.add('water', 1); }
    }
    Audio.update(s);
    return s;
  }

  function farmStormHit(s) {
    const gs = gameState();
    const plots = gameState().farmPlots || [];
    const rod = gs.facilities.lightning_rod;
    const outdoor = plots.filter(p => p && p.crop && !p.inGreenhouse && !p.quality);
    if (!outdoor.length) return;
    const p = outdoor[randInt(0, outdoor.length - 1)];
    if (rod) {
      if (typeof window.showToast === 'function') showToast('避雷针引导了一次雷击，作物安然无恙', 'success');
      return;
    }
    const crop = (window.CONFIG && CONFIG.crops && CONFIG.crops[p.crop]) || null;
    const gt = crop ? crop.growthTime : 60;
    p.plantedAt = (p.plantedAt || Date.now()) + 22000; // 生长延缓约 22s（crop/gt 变量留作未用）
    if (typeof window.showToast === 'function') showToast('⚡ 雷暴劈伤了一株作物，生长延缓', 'warning');
  }

  // 农场生长倍率（替换旧扁平倍率）
  function farmGrowthMul(plot) {
    const s = gameState() && GameState.farmWeather;
    if (!s) return 1;
    if (plot && plot.inGreenhouse) return 1; // 温室不受天气影响
    let m = 1;
    if (s.cur.precip > 0.05) m *= 1 + 0.12 * s.cur.precip;   // 雨：生长略快（自动浇水）
    if (s.cur.fog > 0.3) m *= 1 - 0.18 * s.cur.fog;           // 雾：生长减速
    if (s.cur.snow > 0.2) m = 0;                              // 雪：露天停长
    return m;
  }
  function farmQualityBonus(plot) {
    const s = gameState() && GameState.farmWeather;
    if (!s || (plot && plot.inGreenhouse)) return 0;
    return 0.12 * s.cur.fog; // 雾：品质/变异率↑
  }
  function farmPrecip() { const s = gameState() && GameState.farmWeather; return s ? s.cur.precip : 0; }

  // ============================================================
  // 设施（集雨桶 / 避雷针）
  // ============================================================
  const FACILITY = {
    rain_barrel: { name: '集雨桶', icon: '🛢️', cost: { gold: 120, wood: 8, stone: 6, fiber: 4 },
      desc: '雨天自动产出清水资源' },
    lightning_rod: { name: '避雷针', icon: '🗼', cost: { gold: 260, stone: 14, refined_iron: 2, fiber: 6 },
      desc: '雷暴时保护作物不被雷击' },
  };
  function hasFacility(id) { return !!(gameState() && GameState.facilities && GameState.facilities[id]); }
  function buildFacility(id) {
    const gs = gameState(), f = FACILITY[id];
    if (!gs || !f) return false;
    gs.facilities = gs.facilities || { rain_barrel: 0, lightning_rod: 0 };
    if (gs.facilities[id]) { if (typeof showToast === 'function') showToast(f.name + '已建造', 'info'); return false; }
    const goldNeed = f.cost.gold || 0;
    if ((gs.gold || 0) < goldNeed) { if (typeof showToast === 'function') showToast('金币不足，无法建造' + f.name, 'warning'); return false; }
    const rest = {};
    for (const k in f.cost) if (k !== 'gold') rest[k] = f.cost[k];
    if (window.ResourceSystem) {
      for (const k in rest) if (ResourceSystem.count(k) < rest[k]) { if (typeof showToast === 'function') showToast('资源不足，无法建造' + f.name, 'warning'); return false; }
    }
    if (goldNeed) gs.gold -= goldNeed;
    if (window.ResourceSystem && Object.keys(rest).length) ResourceSystem.pay(rest);
    gs.facilities[id] = 1;
    if (typeof showToast === 'function') showToast('建成了 ' + f.icon + f.name, 'gold');
    return true;
  }

  // ============================================================
  // 音频（风 / 雨 / 雷），随强度交叉淡入
  // ============================================================
  const Audio = {
    nodes: null,
    ensure() {
      if (this.nodes) return this.nodes;
      const AM = window.AudioManager;
      if (!AM || !AM.ctx) return null;
      const ctx = AM.ctx;
      const mkNoise = (filterType, freq, q) => {
        const len = ctx.sampleRate * 2;
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        const flt = ctx.createBiquadFilter(); flt.type = filterType; flt.frequency.value = freq; if (q) flt.Q.value = q;
        const gn = ctx.createGain(); gn.gain.value = 0;
        src.connect(flt); flt.connect(gn);
        if (AM.master) gn.connect(AM.master);
        src.start();
        return { src, gn };
      };
      const wind = mkNoise('lowpass', 480);
      const rainFar = mkNoise('bandpass', 1400, 0.6);
      const rainNear = mkNoise('highpass', 1800);
      this.nodes = { wind, rainFar, rainNear };
      return this.nodes;
    },
    update(s) {
      const n = this.ensure(); if (!n) return;
      const AM = window.AudioManager, now = AM.ctx.currentTime;
      n.wind.gn.gain.setTargetAtTime(0.02 + s.cur.wind * 0.07, now, 0.8);
      n.rainFar.gn.gain.setTargetAtTime(s.cur.precip * 0.05, now, 0.8);
      n.rainNear.gn.gain.setTargetAtTime(s.cur.precip * 0.04, now, 0.8);
    },
    thunder(strength) {
      const AM = window.AudioManager;
      if (!AM || !AM.ctx || !AM.master) return;
      try {
        const ctx = AM.ctx, now = ctx.currentTime;
        // 爆音：低频正弦快速下扫
        const o = ctx.createOscillator(), og = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(110 + strength * 60, now);
        o.frequency.exponentialRampToValueAtTime(38, now + 0.5);
        og.gain.setValueAtTime(0.0001, now);
        og.gain.exponentialRampToValueAtTime(0.28 * strength + 0.05, now + 0.02);
        og.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);
        o.connect(og); og.connect(AM.master);
        o.start(now); o.stop(now + 1.5);
        // 隆隆尾音：低通噪声
        const len = ctx.sampleRate * 1.6, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
        const src = ctx.createBufferSource(); src.buffer = buf;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 240;
        const gn = ctx.createGain(); gn.gain.value = 0.22 * strength + 0.04;
        src.connect(lp); lp.connect(gn); gn.connect(AM.master);
        src.start(now);
      } catch (e) {}
    },
  };

  // ============================================================
  // 渲染：WeatherFX
  // ============================================================
  function makeNoiseTile() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const x = c.getContext('2d');
    const img = x.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 160 + Math.random() * 95;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = Math.random() * 60;
    }
    x.putImageData(img, 0, 0);
    return c;
  }
  let noiseTile = null;

  function drawRain(ctx, W, H, t, s, cam) {
    const Q = quality();
    const layers = [
      { p: .15, n: 26, len: 11, spd: 520, a: .22, w: 1.0 },
      { p: .40, n: 30, len: 17, spd: 760, a: .34, w: 1.3 },
      { p: .75, n: 24, len: 25, spd: 1060, a: .48, w: 1.7 },
    ];
    const precip = s.cur.precip;
    if (precip <= 0.04) return;
    const slant = 5 + s.cur.wind * 20;
    const windDrift = s.cur.wind * 130;
    ctx.save();
    ctx.lineCap = 'round';
    for (const L of layers) {
      const n = Math.floor(L.n * precip * Q);
      ctx.strokeStyle = 'rgba(176,196,228,1)';
      ctx.lineWidth = L.w;
      for (let i = 0; i < n; i++) {
        const cx = ((i * 53 + t * L.spd * .22 + windDrift - cam.x * L.p * .35) % (W + 90)) - 45;
        const cy = ((i * 89 + t * L.spd - cam.y * L.p * .35) % (H + 90)) - 45;
        ctx.globalAlpha = L.a;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx - slant, cy + L.len); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawSnow(ctx, W, H, t, s, cam) {
    const Q = quality();
    const snow = s.cur.snow;
    if (snow <= 0.05) return;
    const n = Math.floor(70 * snow * Q);
    ctx.save();
    ctx.fillStyle = 'rgba(240,246,255,0.85)';
    for (let i = 0; i < n; i++) {
      const x = ((i * 67 + Math.sin(t * .6 + i) * 26 + t * (16 + s.cur.wind * 40) - cam.x * .2) % (W + 40)) - 20;
      const y = ((i * 101 + t * 52 - cam.y * .2) % (H + 40)) - 20;
      ctx.globalAlpha = .35 + (i % 3) * .12;
      ctx.beginPath(); ctx.arc(x, y, 1.6 + (i % 2), 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  function drawSplashes(ctx, s, cam) {
    if (!s.splashes.length) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(190,210,235,0.8)';
    for (const sp of s.splashes) {
      const k = 1 - sp.life / sp.max;
      const x = sp.x - cam.x, y = sp.y - cam.y;
      ctx.globalAlpha = (1 - k) * .5;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(x, y, 3 + k * 7, 2 + k * 4, 0, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  function drawGroundWet(ctx, g, s, cam, W, H) {
    if (s.wet <= 0.05 && s.cover <= 0.05) return;
    // 湿：整体很轻的暗 + 水洼（暗底 + 天光高光）
    ctx.save();
    if (s.wet > 0.05) {
      ctx.fillStyle = `rgba(28,42,64,${0.10 * s.wet})`;
      ctx.fillRect(0, 0, W, H);
      for (const p of s.puddles) {
        const x = p.x - cam.x, y = p.y - cam.y;
        if (x < -80 || x > W + 80 || y < -80 || y > H + 80) continue;
        ctx.fillStyle = `rgba(30,46,72,${0.5 * s.wet})`;
        ctx.beginPath(); ctx.ellipse(x, y, p.rx, p.ry, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = `rgba(200,220,245,${0.28 * s.wet})`;
        ctx.beginPath(); ctx.ellipse(x - p.rx * .25, y - p.ry * .3, p.rx * .42, p.ry * .34, 0, 0, TAU); ctx.fill();
      }
    }
    // 积雪：白色软斑
    if (s.cover > 0.05) {
      for (const p of s.snowPatches) {
        const x = p.x - cam.x, y = p.y - cam.y;
        if (x < -p.r || x > W + p.r || y < -p.r || y > H + p.r) continue;
        const grd = ctx.createRadialGradient(x, y, 4, x, y, p.r);
        grd.addColorStop(0, `rgba(242,247,252,${0.85 * s.cover})`);
        grd.addColorStop(1, 'rgba(242,247,252,0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(x, y, p.r, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawCloudShadows(ctx, g, s, cam, W, H) {
    const c = s.cur.cloud;
    if (c <= 0.15) return;
    ctx.save();
    for (const sh of s.shadows) {
      const x = sh.x - cam.x, y = sh.y - cam.y;
      if (x < -sh.r || x > W + sh.r || y < -sh.r || y > H + sh.r) continue;
      const grd = ctx.createRadialGradient(x, y, 10, x, y, sh.r);
      grd.addColorStop(0, `rgba(40,48,66,${0.10 * c})`);
      grd.addColorStop(1, 'rgba(40,48,66,0)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(x, y, sh.r, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  function drawFog(ctx, W, H, t, s, cam) {
    const fog = s.cur.fog;
    if (fog <= 0.08) return;
    ctx.save();
    // 颗粒纹理
    if (!noiseTile) noiseTile = makeNoiseTile();
    const tile = noiseTile;
    ctx.globalAlpha = 0.05 * fog;
    const ox = (t * 12) % 256, oy = (t * 7) % 256;
    for (let x = -ox; x < W; x += 256) for (let y = -oy; y < H; y += 256) ctx.drawImage(tile, x, y);
    // 漂移雾堤（世界坐标 → 屏幕）
    for (const bk of s.banks) {
      const x = bk.x - cam.x, y = bk.y - cam.y;
      if (x < -bk.r || x > W + bk.r || y < -bk.r || y > H + bk.r) continue;
      const grd = ctx.createRadialGradient(x, y, bk.r * .2, x, y, bk.r);
      grd.addColorStop(0, `rgba(206,214,220,${0.16 * fog})`);
      grd.addColorStop(1, 'rgba(206,214,220,0)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(x, y, bk.r, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  function drawTelegraphs(ctx, s, cam) {
    if (!s.telegraphs.length) return;
    ctx.save();
    for (const tg of s.telegraphs) {
      const x = tg.x - cam.x, y = tg.y - cam.y;
      const pulse = .5 + .5 * Math.sin(tg.t * 14);
      ctx.strokeStyle = `rgba(255,90,70,${.5 + pulse * .4})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x, y, tg.r, tg.r * .6, 0, 0, TAU); ctx.stroke();
      ctx.fillStyle = `rgba(255,80,60,${.10 + pulse * .10})`;
      ctx.beginPath(); ctx.ellipse(x, y, tg.r, tg.r * .6, 0, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  function drawBolts(ctx, s, cam) {
    if (!s.bolts.length) return;
    ctx.save();
    for (const b of s.bolts) {
      const k = b.life / b.max;
      const gx = b.screen ? b.x : b.x - cam.x;
      const gy = b.screen ? b.y : b.y - cam.y;
      const topX = gx + b.lean, topY = gy - b.top;
      // 局部强光
      const grd = ctx.createRadialGradient(gx, gy, 6, gx, gy, 150);
      grd.addColorStop(0, `rgba(225,235,255,${0.5 * k})`);
      grd.addColorStop(1, 'rgba(225,235,255,0)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(gx, gy, 150, 0, TAU); ctx.fill();
      // 锯齿主干
      const segs = 9;
      let px = topX, py = topY;
      ctx.strokeStyle = `rgba(200,214,255,${0.5 * k})`;
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(px, py);
      const pts = [];
      for (let i = 1; i <= segs; i++) {
        const tt = i / segs;
        const nx = lerp(topX, gx, tt) + (Math.sin(b.jitter + i * 3.1) * 26) * (1 - tt * .4);
        const ny = lerp(topY, gy, tt);
        pts.push([nx, ny]); ctx.lineTo(nx, ny);
      }
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${0.9 * k})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(topX, topY);
      for (const p of pts) ctx.lineTo(p[0], p[1]);
      ctx.stroke();
      // 分叉
      if (pts.length > 3) {
        const f = pts[pts.length - 3];
        ctx.strokeStyle = `rgba(220,230,255,${0.6 * k})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(f[0], f[1]);
        ctx.lineTo(f[0] + b.lean * .8, f[1] + 60); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawGrade(ctx, W, H, s) {
    const c = CAT[s.state].grade;
    const intensity = Math.max(s.cur.cloud, s.cur.precip, s.cur.fog, s.cur.snow);
    const a = c.a * (0.7 + 0.3 * intensity);
    if (a > 0.01) { ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${a})`; ctx.fillRect(0, 0, W, H); }
    if (s.flash > 0) { ctx.fillStyle = `rgba(232,238,255,${s.flash * 0.5})`; ctx.fillRect(0, 0, W, H); }
  }

  function drawHUD(ctx, g, s) {
    const c = CAT[s.state];
    const W = CONFIG.canvas.width;
    ctx.save();
    ctx.textBaseline = 'top';
    let txt = c.icon + ' ' + c.name;
    if (s.next) {
      const n = CAT[s.next];
      txt += '   →   ' + n.icon + n.name + '（' + Math.max(0, Math.ceil(s.timer)) + 's）';
    }
    ctx.textAlign = 'center';
    ctx.font = '13px sans-serif';
    const w = ctx.measureText(txt).width;
    const cx = W / 2, y = 118;
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.fillRect(cx - w / 2 - 10, y, w + 20, 21);
    ctx.fillStyle = '#e8eef6';
    ctx.fillText(txt, cx, y + 4);
    if (s.cold > 35) {
      ctx.fillStyle = s.cold > 80 ? '#9fd4ff' : '#cfe6ff';
      ctx.font = '12px sans-serif';
      ctx.fillText('🥶 寒冷 ' + Math.round(s.cold) + '%（靠近篝火取暖）', cx, y + 24);
    }
    ctx.restore();
  }

  const WeatherFX = window.WeatherFX = {
    // 地面层（在 renderGroundLayer 调用）：积水/反光、积雪、云影
    renderGroundWet(ctx, g, cam) {
      const s = g.weather; if (!s) return;
      const W = CONFIG.canvas.width, H = CONFIG.canvas.height;
      drawCloudShadows(ctx, g, s, cam, W, H);
      drawGroundWet(ctx, g, s, cam, W, H);
    },
    // 世界模式（远征 renderWeather 调用）
    renderWorld(ctx, g, cam) {
      const s = g.weather; if (!s) return;
      const W = CONFIG.canvas.width, H = CONFIG.canvas.height;
      const t = performance.now() / 1000;
      drawTelegraphs(ctx, s, cam);
      drawSplashes(ctx, s, cam);
      drawFog(ctx, W, H, t, s, cam);
      drawRain(ctx, W, H, t, s, cam);
      drawSnow(ctx, W, H, t, s, cam);
      drawBolts(ctx, s, cam);
      drawGrade(ctx, W, H, s);
      drawHUD(ctx, g, s);
    },
    // 屏幕模式（农场 canvas 覆盖）
    renderScreen(ctx, W, H) {
      const s = gameState() && GameState.farmWeather; if (!s) return;
      const t = performance.now() / 1000, zero = { x: 0, y: 0 };
      drawFog(ctx, W, H, t, s, zero);
      drawRain(ctx, W, H, t, s, zero);
      drawSnow(ctx, W, H, t, s, zero);
      drawBolts(ctx, s, zero);
      drawGrade(ctx, W, H, s);
    },
  };

  // ============================================================
  // 导出 WeatherSystem
  // ============================================================
  window.WeatherSystem = {
    CAT, IDS,
    attachExpedition, attachFarm,
    updateExpedition, updateFarm,
    modifyOutgoing, visionMul, moveMul, fireMul, stealth, classify,
    farmGrowthMul, farmQualityBonus, farmPrecip,
    FACILITY, hasFacility, buildFacility,
    Audio,
  };
})();
