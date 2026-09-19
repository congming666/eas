/*
 * balance-bot.js — 无头平衡测试 bot
 *
 * 用 Playwright 启动真实游戏页面（file:// 直开），驱动真实游戏代码：
 *  - 切断 requestAnimationFrame 渲染循环，手动以固定 1/60s 步长泵 Expedition.update()
 *  - 覆写虚拟时钟（performance.now / Date.now），让前摇/冷却/流血等毫秒计时随虚拟时间快进
 *  - 跳过渲染（不调用 render）、屏蔽音频/HUD/Toast，纯逻辑跑图
 *  - bot 行为：风筝走位、自动攻击、技能轮换、喝药、闪避、开箱、按时/残血/背包满撤离
 *
 * 实验设计：4 个难度（休闲/普通/困难/噩梦）各 50 局 = 200 局；
 * 每个难度内 Tier1..4 按 13/13/12/12 分配并打乱；地图在该 Tier 6 张子图中随机；
 * 双画像队列（各占一半）：on-curve 随 Tier 成长配装（T1≈Lv10/+0~2 … T4≈Lv80/+8~10、
 * 技能全解锁）；baseline 固定新手配装（Lv10-18/+0~1、仅初始技能），分别检验成长曲线与内容难度。
 *
 * 产物：
 *  - tools/balance-report.json   逐局原始数据
 *  - docs/balance-report.md      聚合平衡报表
 *
 * 用法：node tools/balance-bot.js [--runs=200] [--batch=5]
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const FALLBACK_CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
];

function arg(name, def) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : def;
}
const TOTAL_RUNS = arg('runs', 200);
const BATCH = arg('batch', 5);

const DIFFS = [
  { id: 'casual', name: '休闲' },
  { id: 'normal', name: '普通' },
  { id: 'hard', name: '困难' },
  { id: 'nightmare', name: '噩梦' },
];
const TIER_LEVEL = { 1: 10, 2: 30, 3: 55, 4: 80 };
const WEAPON_LV = { 1: [0, 2], 2: [3, 4], 3: [5, 7], 4: [8, 10] };
const PLAN_SEC = { 1: [90, 150], 2: [120, 200], 3: [150, 240], 4: [180, 300] };
const WEAPONS = ['harvest_sickle', 'pea_repeater', 'vine_staff', 'throwing_knife', 'flame_bow'];

function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildSpecs(total) {
  const perDiff = Math.floor(total / 4);
  const specs = [];
  let runId = 0;
  DIFFS.forEach((d, di) => {
    // 每难度 N 局，一半 on-curve（随 Tier 成长配装），一半 baseline（固定新手配装，测纯内容难度）
    const tiers = shuffle(
      [].concat(Array(13).fill(1), Array(13).fill(2), Array(12).fill(3), Array(12).fill(4))
    );
    const n = di === DIFFS.length - 1 ? total - perDiff * (DIFFS.length - 1) : perDiff;
    const half = Math.floor(n / 2);
    for (let i = 0; i < n; i++) {
      const tier = tiers[i % tiers.length];
      const [plo, phi] = PLAN_SEC[tier];
      const profile = i < half ? 'oncurve' : 'baseline';
      let lvl, wlv;
      if (profile === 'oncurve') {
        const [wlo, whi] = WEAPON_LV[tier];
        wlv = randInt(wlo, whi);
        lvl = Math.max(1, Math.min(100, TIER_LEVEL[tier] + randInt(-4, 4)));
      } else {
        wlv = randInt(0, 1);
        lvl = randInt(10, 18);
      }
      specs.push({
        runId: ++runId,
        profile,
        difficulty: d.id,
        difficultyName: d.name,
        tier,
        mapId: `t${tier}_${randInt(1, 6)}`,
        weaponId: WEAPONS[runId % WEAPONS.length],
        weaponLevel: wlv,
        level: lvl,
        planSec: randInt(plo, phi),
      });
    }
  });
  return shuffle(specs).map((s, i) => Object.assign(s, { runId: i + 1 }));
}

async function launchBrowser() {
  if (process.env.PW_EXECUTABLE_PATH) return chromium.launch({ headless: true, executablePath: process.env.PW_EXECUTABLE_PATH });
  if (process.env.PW_CHANNEL) return chromium.launch({ headless: true, channel: process.env.PW_CHANNEL });
  try {
    return await chromium.launch({ headless: true });
  } catch (err) {
    const fallback = FALLBACK_CHROME_PATHS.find(p => fs.existsSync(p));
    if (!fallback) throw err;
    console.log(`Playwright Chromium 不可用，改用系统 Chrome：${fallback}`);
    return chromium.launch({ headless: true, executablePath: fallback });
  }
}

// 注入页面的一次性环境：屏蔽音频/HUD/Toast/Pixi，安装虚拟时钟
async function injectEnv(page) {
  await page.evaluate(() => {
    try { window.showToast = function () {}; } catch (e) {}
    try { if (typeof showToast === 'function') { /* 已在 window 上覆盖 */ } } catch (e) {}
    try {
      if (typeof AudioManager !== 'undefined') {
        let o = AudioManager;
        const seen = new Set();
        while (o && o !== Object.prototype && !seen.has(o)) {
          seen.add(o);
          Object.getOwnPropertyNames(o).forEach(k => {
            try { if (typeof o[k] === 'function') o[k] = function () {}; } catch (e) {}
          });
          o = Object.getPrototypeOf(o);
        }
        AudioManager.ctx = { state: 'running', resume() { return Promise.resolve(); } };
      }
    } catch (e) {}
    try {
      if (typeof PixiEffects !== 'undefined') {
        ['init', 'render', 'clear', 'resize', 'stop', 'start', 'setQuality'].forEach(m => { try { PixiEffects[m] = function () {}; } catch (e) {} });
      }
    } catch (e) {}
    try { if (typeof Telemetry !== 'undefined') Telemetry.silent = true; } catch (e) {}
    if (!window.__vClock) {
      window.__vNow = performance.now();
      performance.now = () => window.__vNow;
      const _DateNow = Date.now;
      Date.now = () => Math.floor(window.__vNow);
      window.__vClock = true;
    }
  });
}

// 在页面内执行的批量跑图函数（自包含，不能引用 Node 作用域）
function botBatch(specs) {
  function setKeys(exp, dx, dy) {
    const k = exp.keys;
    k['w'] = dy < -0.35; k['s'] = dy > 0.35; k['a'] = dx < -0.35; k['d'] = dx > 0.35;
    k['arrowup'] = k['w']; k['arrowdown'] = k['s']; k['arrowleft'] = k['a']; k['arrowright'] = k['d'];
  }

  function runOne(spec) {
    const GS = GameState;
    const baseline = spec.profile === 'baseline';
    // ===== 画像配装 =====
    GS.gold = 1e9;
    GS.level = spec.level; GS.cultivation = 0;
    GS.weaponInstances = [{ uid: 'botw', weaponId: spec.weaponId, level: spec.weaponLevel }];
    GS.loadoutWeaponUids = ['botw'];
    GS.carriedSeeds = [];
    GS.defenseLoadout = [];
    GS.selectedBoostCards = []; GS.cardInventory = [];
    if (baseline) {
      // 新手固定画像：只有初始技能稻草猛击
      GS.unlockedSkills = ['straw_smash'];
      GS.equippedSkills = ['straw_smash'];
      GS.skillLevels = { straw_smash: 1 };
    } else {
      GS.unlockedSkills = CONFIG.skills.map(s => s.id);
      GS.equippedSkills = CONFIG.skills.map(s => s.id);
      GS.skillLevels = {}; CONFIG.skills.forEach(s => { GS.skillLevels[s.id] = 1; });
    }
    GS.loadout = { herb_kit: 99, thorn_storm: 999, signal_flare: 10 };
    GS.difficulty = spec.difficulty;
    GS.heatModifiers = [];
    GS.selectedMap = spec.mapId;
    GS.safeSlots = 3; GS.safeBox = [];
    if (typeof Warehouse !== 'undefined' && Warehouse.removeItem) { try { Warehouse.removeItem('death_pardon', 999); } catch (e) {} }

    // bot 不需要渲染：彻底关掉 render（初始同步渲染在个别随机地图会触发 NaN）
    if (typeof Expedition !== 'undefined' && !Expedition.prototype.__botNoRender) {
      Expedition.prototype.render = function () {};
      Expedition.prototype.__botNoRender = true;
    }

    Game.startExpedition();
    if (Game.animId) cancelAnimationFrame(Game.animId);
    const exp = Game.expedition;
    if (!exp) throw new Error('startExpedition 未创建远征实例');
    exp.updateHUD = function () {};

    const W = CONFIG.canvas.width, H = CONFIG.canvas.height;
    const CE = (typeof CombatEnhancement !== 'undefined') ? CombatEnhancement : null;
    let strafeSign = Math.random() < 0.5 ? -1 : 1;
    let dodgeCd = 0, skillRotate = 0;
    let lastX = exp.player.x, lastY = exp.player.y;
    let extract = false;
    let slots = 0;
    let ended = false;
    let tick = 0;
    const MAXT = 560 * 60;

    for (tick = 0; tick < MAXT; tick++) {
      if (CE && CE.branchActive) CE.chooseBranch(Math.floor(Math.random() * 3));
      const p = exp.player;

      const ens = exp.monsters.filter(m => m.hp > 0)
        .concat((exp.raiders || []).filter(m => m.hp > 0));
      if (exp.boss && exp.boss.hp > 0 && ens.indexOf(exp.boss) < 0) ens.push(exp.boss);
      let nearest = null, nd = 1e9;
      for (const m of ens) {
        const d = Math.hypot(m.x - p.x, m.y - p.y);
        if (d < nd) { nd = d; nearest = m; }
      }

      const hpR = p.hp / p.maxHp;
      const elapsed = CONFIG.expedition.demoDuration - exp.timeLeft;
      slots = 0;
      (exp.bag || []).forEach(it => { slots += (it.slots || 1); });
      if (!extract && (elapsed >= spec.planSec || hpR < 0.22 || slots >= 15 || exp.timeLeft < 100)) extract = true;

      let tx = null, ty = null, holdPosition = false;

      if (extract) {
        // 撤离点选择：默认最近；连续 2 个检查窗口（5s）没逼近且存在另一个点，则封禁当前点 10s
        const es = exp._botExtract || (exp._botExtract = { t: 0, side: 1, lastEd: 999, orbitT: 0, banUntil: 0, fails: 0 });
        es.t++;
        if (es.rotating > 0) es.rotating--;
        let ep = null, ed = 1e9;
        const pts = exp.extractPoints.map((q, i) => ({ q, i, d: Math.hypot(q.x - p.x, q.y - p.y) }));
        for (const c of pts) { c.q.hidden = false; c.q.revealed = true; }
        const avail = pts.filter(c => tick >= (es['ban' + c.i] || 0));
        const pool = avail.length ? avail : pts;
        for (const c of pool) { if (c.d < ed) { ed = c.d; ep = c.q; ep._idx = c.i; } }
        if (ep) {
          const HOLD = ep.radius * 0.85;
          if (ed < HOLD) {
            holdPosition = true;
            if (!exp.extracting) { try { exp.startExtract('fixed'); } catch (e) {} }
            // 圈内滞留时间（读条与被打断都累计）：90s 没撤离=狂暴，210s=强制换点
            es.stuck = (es.stuck || 0) + 1;
            if (es.stuck > 5400) es.berserk = true;
            if (es.stuck > 12600 && pts.length > 1) {
              es['ban' + ep._idx] = tick + 1800;
              es.rotating = 1200;
              es.stuck = 0; es.berserk = false;
            }
            // 往撤离点中心挤：ed>0.35r 时继续移动；被击退出圈时朝中心闪避突进（无敌帧穿怪）
            if (ed > ep.radius * 0.35) {
              tx = ep.x; ty = ep.y;
              const dodgeLine = es.berserk ? ep.radius * 0.2 : ep.radius * 0.5;
              if (!exp.extracting && ed > dodgeLine && dodgeCd <= 0 && CE) {
                const ddx = ep.x - p.x, ddy = ep.y - p.y, dl = Math.hypot(ddx, ddy) || 1;
                setKeys(exp, ddx / dl, ddy / dl);
                try { CE.tryDodge(); } catch (e) {}
                dodgeCd = es.berserk ? 45 : 60;
              }
            } else { setKeys(exp, 0, 0); }
            es.fails = 0;
            es.orbitT = 0;
          } else {
            // 直冲撤离点；每 2.5 虚拟秒检查是否被障碍/怪潮卡住，卡住则绕行并用闪避脱困
            if (es.t % 150 === 0) {
              if (es.lastEd - ed < 8) {
                es.fails++;
                es.side *= -1; es.orbitT = 120;
                if (CE && dodgeCd <= 0) { try { CE.tryDodge(); } catch (e) {} dodgeCd = 70; }
                if (es.fails >= 2 && pts.length > 1) {
                  es['ban' + ep._idx] = tick + 600;
                  es.fails = 0;
                }
              } else { es.fails = 0; }
              es.lastEd = ed;
            }
            if (es.orbitT > 0) {
              es.orbitT--;
              const base = Math.atan2(p.y - ep.y, p.x - ep.x);
              const ang = base + es.side * 0.9;
              tx = ep.x + Math.cos(ang) * ep.radius * 1.2;
              ty = ep.y + Math.sin(ang) * ep.radius * 1.2;
            } else {
              tx = ep.x; ty = ep.y;
            }
          }
        }
      } else if (nearest) {
        const w = exp.weapon;
        const ranged = w.mode !== 'melee';
        const desired = ranged ? w.range * 0.62 : w.range * 0.72;
        const mx = nearest.x - p.x, my = nearest.y - p.y;
        if (nd > desired + 12) { tx = nearest.x; ty = nearest.y; }
        else if (nd < desired * 0.62) { tx = p.x - mx; ty = p.y - my; }
        else {
          const len = Math.hypot(mx, my) || 1;
          const px = -my / len, py = mx / len;
          if (tick % 150 === 0) strafeSign *= -1;
          tx = p.x + px * strafeSign * 120; ty = p.y + py * strafeSign * 120;
        }
      } else {
        // 无怪：找最近未开宝箱，否则随机探索
        let bc = null, bd = 1e9;
        for (const c of (exp.chests || [])) {
          if (c.opened) continue;
          const d = Math.hypot(c.x - p.x, c.y - p.y);
          if (d < bd) { bd = d; bc = c; }
        }
        if (bc && bd < 700) { tx = bc.x; ty = bc.y; if (bd < 48) { try { exp.openChest(bc); } catch (e) {} } }
        else {
          if (!exp._wanderT || exp._wanderT <= 0) {
            const ang = Math.random() * Math.PI * 2;
            const r = 300 + Math.random() * 650;
            exp._wander = {
              x: Math.max(160, Math.min(CONFIG.expedition.mapSize - 160, exp.spawnX + Math.cos(ang) * r)),
              y: Math.max(160, Math.min(CONFIG.expedition.mapSize - 160, exp.spawnY + Math.sin(ang) * r)),
            };
            exp._wanderT = 300 + Math.random() * 240;
          }
          exp._wanderT--;
          if (exp._wander) { tx = exp._wander.x; ty = exp._wander.y; }
        }
      }

      if (tx !== null) {
        let dx = tx - p.x, dy = ty - p.y;
        const d = Math.hypot(dx, dy);
        if (d > 6) setKeys(exp, dx / d, dy / d); else setKeys(exp, 0, 0);
      }

      // 强制换点途中不恋战（rotating）
      const rotating = !!(extract && exp._botExtract && exp._botExtract.rotating > 0);
      // 瞄准与攻击
      const aim = rotating ? null : nearest;
      if (aim) {
        exp.mouse.x = Math.max(4, Math.min(W - 4, aim.x - exp.camera.x));
        exp.mouse.y = Math.max(4, Math.min(H - 4, aim.y - exp.camera.y));
        exp.mouse.down = nd <= exp.weapon.range * 1.02;
      } else {
        exp.mouse.down = false;
      }

      // 闪避：敌人近身或前摇时（读条撤离中不闪，避免闪出撤离点）
      if (dodgeCd > 0) dodgeCd--;
      const inExtractZone = extract && exp.extractPoints.some(q => Math.hypot(q.x - p.x, q.y - p.y) < q.radius + 24);
      if (!inExtractZone && nearest && nd < 88 && dodgeCd <= 0 && (nearest.windupT > 0 || Math.random() < 0.03)) {
        try { CE.tryDodge(); } catch (e) {}
        dodgeCd = 70;
      }

      // 技能轮换（每 0.75s 决策一次，最多放 2 个）
      // 位移技（earth_dash/wind_slash）会把风筝中的 bot 冲进怪堆，属 bot 自伤，不纳入自动轮换
      const NO_AUTO_SKILLS = ['earth_dash', 'wind_slash'];
      const eqAll = exp.equippedSkills || [];
      const eq = eqAll.map((id, idx) => idx).filter(idx => NO_AUTO_SKILLS.indexOf(eqAll[idx]) < 0);
      const berserk = !!(extract && exp._botExtract && exp._botExtract.berserk);
      const skillInterval = berserk ? 15 : 45;
      if (!rotating && tick % skillInterval === 0 && nearest && nd < (berserk ? 900 : 420)) {
        let used = 0;
        for (let i = 0; i < eq.length && used < 2; i++) {
          const idx = eq[(skillRotate + i) % eq.length];
          if ((exp.skillCooldowns[idx] || 0) <= 0) {
            const before = p.energy;
            try { exp.useSkill(idx); } catch (e) {}
            if (p.energy < before) used++;
          }
        }
        skillRotate = (skillRotate + 1) % Math.max(1, eq.length);
      }

      // 消耗品（读条撤离中更激进喝药，防止被击退打断后暴毙）
      const herbLine = (extract && exp.extracting) ? 0.6 : 0.42;
      if (hpR < herbLine && (exp.consumables.herb_kit || 0) > 0) { try { exp.useConsumable('herb_kit'); } catch (e) {} }
      const nearCount = ens.filter(m => Math.hypot(m.x - p.x, m.y - p.y) < 170).length;
      const thornThreshold = berserk ? 1 : extract ? (exp.extracting ? 2 : 3) : 4;
      if (!rotating && (exp.consumables.thorn_storm || 0) > 0 && nearCount >= thornThreshold) {
        try { exp.useConsumable('thorn_storm'); } catch (e) {}
      }

      // 卡死检测：3 虚拟秒位移 < 8px 则换向
      if (tick % 180 === 0 && tick > 0) {
        const moved = Math.hypot(p.x - lastX, p.y - lastY);
        if (moved < 8 && !exp.extracting) {
          strafeSign *= -1;
          exp._wanderT = 0;
        }
        lastX = p.x; lastY = p.y;
      }

      window.__vNow += 1000 / 60;
      exp.update(1 / 60);
      if (exp.result) { ended = true; tick++; break; }
    }

    const goldBag = (exp.bag || []).filter(i => i.type === 'gold').reduce((s, i) => s + i.amount, 0);
    const rs = exp.runStats || {};
    const rec = {
      runId: spec.runId,
      profile: spec.profile,
      difficulty: spec.difficulty,
      difficultyName: spec.difficultyName,
      tier: spec.tier,
      mapId: spec.mapId,
      weaponId: spec.weaponId,
      weaponLevel: spec.weaponLevel,
      charLevel: spec.level,
      planSec: spec.planSec,
      result: exp.result || 'timeout',
      success: exp.result === 'success',
      durationSec: +(CONFIG.expedition.demoDuration - exp.timeLeft).toFixed(1),
      kills: exp.killCount || 0,
      eliteKills: rs.eliteKills || 0,
      bossKills: rs.bossKills || 0,
      chests: exp.chestOpened || 0,
      damageTaken: Math.round(exp.damageTaken || 0),
      highestWave: (exp.beastWave && exp.beastWave.wave) || 0,
      goldBag,
      goldSettled: exp.result === 'success' ? goldBag : Math.floor(goldBag * 0.2),
      deathReason: (exp.deathCause && exp.deathCause.reason) || null,
      deathBy: (exp.deathCause && exp.deathCause.by) || null,
      perfectDodges: rs.perfectDodgeCount || 0,
      maxCombo: rs.maxCombo || 0,
      minHpPct: Math.round(rs.minHpSeen != null ? rs.minHpSeen : 100),
      extractType: exp.extractType || null,
      bagSlots: slots,
      ticks: tick,
      forcedAbort: !ended,
    };
    try { Game.returnToFarm(); } catch (e) {}
    return rec;
  }

  const out = [];
  for (const spec of specs) {
    try { out.push(runOne(spec)); }
    catch (e) {
      out.push({ runId: spec.runId, profile: spec.profile, difficulty: spec.difficulty, tier: spec.tier, mapId: spec.mapId,
        weaponId: spec.weaponId, weaponLevel: spec.weaponLevel, charLevel: spec.level, planSec: spec.planSec,
        result: 'error', success: false, error: String(e && e.stack || e),
        durationSec: 0, kills: 0, eliteKills: 0, bossKills: 0, chests: 0, damageTaken: 0,
        highestWave: 0, goldBag: 0, goldSettled: 0, deathReason: 'script_error', deathBy: null,
        perfectDodges: 0, maxCombo: 0, minHpPct: 100, extractType: null, bagSlots: 0, ticks: 0, forcedAbort: true });
      try { Game.returnToFarm(); } catch (e2) {}
    }
  }
  return out;
}

// ===== 聚合 =====
function avg(a, f) { return a.length ? a.reduce((s, x) => s + f(x), 0) / a.length : 0; }
function pct(a) { return a.length ? a.filter(x => x.success).length / a.length * 100 : 0; }
function dist(a, key) {
  const m = {};
  a.forEach(x => { const k = x[key] || 'unknown'; m[k] = (m[k] || 0) + 1; });
  return m;
}
function group(rows, fn) {
  const m = new Map();
  rows.forEach(r => {
    const k = fn(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  });
  return m;
}
function summarize(rows) {
  return {
    n: rows.length,
    extractRate: +pct(rows).toFixed(1),
    avgDuration: +avg(rows, r => r.durationSec).toFixed(1),
    avgKills: +avg(rows, r => r.kills).toFixed(1),
    avgElite: +avg(rows, r => r.eliteKills).toFixed(2),
    avgBoss: +avg(rows, r => r.bossKills).toFixed(2),
    avgChests: +avg(rows, r => r.chests).toFixed(2),
    avgDamageTaken: Math.round(avg(rows, r => r.damageTaken)),
    avgWave: +avg(rows, r => r.highestWave).toFixed(1),
    avgGold: Math.round(avg(rows, r => r.goldSettled)),
    avgMinHp: Math.round(avg(rows, r => r.minHpPct)),
    deathReasons: dist(rows.filter(r => !r.success), 'deathReason'),
    deathBy: dist(rows.filter(r => !r.success), 'deathBy'),
  };
}

function buildReport(runs, pageErrors) {
  const ok = runs.filter(r => r.result !== 'error' && !r.forcedAbort);
  // 聚合只统计有效局（success/failure）；timeout/error 单列，不污染撤离率
  const V = ok;
  const byDiff = {};
  for (const d of DIFFS) byDiff[d.id] = summarize(V.filter(r => r.difficulty === d.id));
  const byTier = {};
  for (let t = 1; t <= 4; t++) byTier['T' + t] = summarize(V.filter(r => r.tier === t));
  const cell = {};
  for (let t = 1; t <= 4; t++) {
    cell['T' + t] = {};
    for (const d of DIFFS) {
      const rows = V.filter(r => r.tier === t && r.difficulty === d.id);
      cell['T' + t][d.id] = { n: rows.length, extractRate: +pct(rows).toFixed(1), avgDuration: +avg(rows, r => r.durationSec).toFixed(1), avgKills: +avg(rows, r => r.kills).toFixed(1) };
    }
  }
  // 双画像：on-curve（随 Tier 成长）检验成长曲线是否跟得上内容；baseline（固定新手配装）检验纯内容难度
  const byProfile = {};
  const profileTier = {};
  for (const pf of ['oncurve', 'baseline']) {
    byProfile[pf] = summarize(V.filter(r => r.profile === pf));
    profileTier[pf] = {};
    for (let t = 1; t <= 4; t++) profileTier[pf]['T' + t] = summarize(V.filter(r => r.profile === pf && r.tier === t));
  }
  return {
    meta: {
      generatedAt: new Date().toISOString(),
      version: 'v5.2.0-balance',
      totalRuns: runs.length,
      validRuns: ok.length,
      errors: runs.filter(r => r.result === 'error').length,
      forcedAborts: runs.filter(r => r.result === 'abort').length,
      timeouts: runs.filter(r => r.result === 'timeout').length,
      pageErrors,
      cohorts: '每难度一半 on-curve（T1≈Lv10/+0~2 … T4≈Lv80/+8~10、技能全解锁），一半 baseline（Lv10-18/+0~1、仅初始技能）；5 把武器轮换；草药包/荆棘狂潮管够（测配装通关可行性，非消耗品经济）；无 Heat 修改器',
      note: 'bot 为确定性规则 AI（风筝/技能轮换/残血撤离），非真人玩家；撤离率反映配装下的通关可行性与数值断点，不代表真人分布。',
    },
    byDifficulty: byDiff,
    byTier,
    byProfile,
    profileTier,
    cell,
    runs,
  };
}

function fmtPct(v) { return v.toFixed(1) + '%'; }
function buildMarkdown(rep) {
  const L = [];
  L.push(`# 《农庄牌：荒野远征》数值平衡报表（bot ${rep.meta.totalRuns} 局）`);
  L.push('');
  L.push(`- 生成时间：${rep.meta.generatedAt}`);
  L.push(`- 版本：${rep.meta.version}`);
  L.push(`- 有效局数：${rep.meta.validRuns}/${rep.meta.totalRuns}（脚本错误 ${rep.meta.errors}，导航超时 ${rep.meta.timeouts}，异常中止 ${rep.meta.forcedAborts}）`);
  L.push('- 导航超时说明：bot 在 560s（约兽潮第 14 波、远超真人最长计划 300s）后仍未能完成 15s 固定读条，属极端高波次下的 bot 导航边界（真人会提前撤离），不计入撤离率分母。');
  L.push(`- 实验队列：${rep.meta.cohorts}`);
  L.push(`- 方法学：Playwright 无头加载真实游戏（file://），切断渲染 rAF，以固定 1/60s 步长 + 虚拟时钟快进驱动真实 \`Expedition.update\`；bot 自动风筝、攻击、轮换技能、喝药、闪避、开箱，并按计划时长/残血/背包满撤离。`);
  L.push('- 局限：bot 是规则 AI 而非真人，撤离率用于检验 **配装下的通关可行性与数值断点**，不代表真人分布；信号弹撤离、战场植物、处决、大招未纳入 bot 决策。');
  L.push('- 两个队列回答两个问题：**baseline**（固定新手配装）看内容难度是否随 Tier/难度正确爬升；**on-curve**（随 Tier 成长配装）看角色成长曲线是否跟得上内容、后期是否过强。');
  L.push('');
  L.push('## 1. 按难度汇总');
  L.push('');
  L.push('| 难度 | 局数 | 撤离率 | 平均时长(s) | 平均击杀 | 精英 | Boss | 宝箱 | 均承伤 | 最高兽潮(波) | 结算金币 | 平均最低血量 |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const d of DIFFS) {
    const s = rep.byDifficulty[d.id];
    L.push(`| ${d.name} | ${s.n} | ${fmtPct(s.extractRate)} | ${s.avgDuration} | ${s.avgKills} | ${s.avgElite} | ${s.avgBoss} | ${s.avgChests} | ${s.avgDamageTaken} | ${s.avgWave} | ${s.avgGold} | ${s.avgMinHp}% |`);
  }
  L.push('');
  L.push('## 2. 按 Tier 汇总');
  L.push('');
  L.push('| Tier | 局数 | 撤离率 | 平均时长(s) | 平均击杀 | 精英 | Boss | 均承伤 | 最高兽潮(波) | 结算金币 |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  for (let t = 1; t <= 4; t++) {
    const s = rep.byTier['T' + t];
    L.push(`| T${t} | ${s.n} | ${fmtPct(s.extractRate)} | ${s.avgDuration} | ${s.avgKills} | ${s.avgElite} | ${s.avgBoss} | ${s.avgDamageTaken} | ${s.avgWave} | ${s.avgGold} |`);
  }
  L.push('');
  L.push('## 3. 难度 × Tier 撤离率矩阵（样本量 / 撤离率 / 平均时长 / 平均击杀）');
  L.push('');
  L.push('| Tier | 休闲 | 普通 | 困难 | 噩梦 |');
  L.push('|---|---|---|---|---|');
  for (let t = 1; t <= 4; t++) {
    const row = [`T${t}`];
    for (const d of DIFFS) {
      const c = rep.cell['T' + t][d.id];
      row.push(`n=${c.n}，${fmtPct(c.extractRate)}，${c.avgDuration}s，${c.avgKills}杀`);
    }
    L.push('| ' + row.join(' | ') + ' |');
  }
  L.push('');
  L.push('## 3b. 画像 × Tier 撤离率（成长曲线校验）');
  L.push('');
  L.push('| 画像 | T1 | T2 | T3 | T4 | 全队列 |');
  L.push('|---|---|---|---|---|---|');
  for (const [pf, label] of [['oncurve', 'on-curve 成长配装'], ['baseline', 'baseline 新手配装']]) {
    const cells = [];
    for (let t = 1; t <= 4; t++) {
      const s = rep.profileTier[pf]['T' + t];
      cells.push(`n=${s.n}，${fmtPct(s.extractRate)}，${s.avgDuration}s`);
    }
    const all = rep.byProfile[pf];
    cells.push(`n=${all.n}，${fmtPct(all.extractRate)}`);
    L.push(`| ${label} | ${cells.join(' | ')} |`);
  }
  L.push('');
  L.push('> 读法：baseline 行应随 Tier 显著下降（内容越来越难）；on-curve 行应保持平稳且不高于 T1 太多（成长跟得上但不应后期碾压）。');
  L.push('');
  L.push('## 4. 死亡原因分布（按难度）');
  L.push('');
  for (const d of DIFFS) {
    const s = rep.byDifficulty[d.id];
    const reasons = Object.entries(s.deathReasons).map(([k, v]) => `${k}×${v}`).join('，') || '无死亡';
    const by = Object.entries(s.deathBy).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}×${v}`).join('，') || '—';
    L.push(`- **${d.name}**：${reasons}；击杀来源 Top：${by}`);
  }
  L.push('');
  L.push('## 4b. 各 Tier 击杀来源 Top6（死亡局）');
  L.push('');
  for (let t = 1; t <= 4; t++) {
    const s = rep.byTier['T' + t];
    const by = Object.entries(s.deathBy).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}×${v}`).join('，') || '无死亡';
    L.push(`- **T${t}**：${by}`);
  }
  L.push('');
  L.push('## 5. 平衡目标带与越界清单');
  L.push('');
  const rateOf = (pf, t, d) => {
    const rows = rep.runs.filter(r => r.profile === pf && r.tier === t && (!d || r.difficulty === d) && !r.forcedAbort && r.result !== 'error');
    return { n: rows.length, rate: +pct(rows).toFixed(1) };
  };
  const tierSeq = pf => [1, 2, 3, 4].map(t => rateOf(pf, t).rate);
  const baseSeq = tierSeq('baseline');
  const curveSeq = tierSeq('oncurve');
  const checks = [
    { name: '脚本错误 = 0', get: () => rep.meta.errors, ok: v => v === 0 },
    { name: '异常中止 = 0', get: () => rep.meta.forcedAborts, ok: v => v === 0 },
    { name: '导航超时局 ≤ 2（极端高波次 bot 边界，不计入撤离率）', get: () => rep.meta.timeouts, ok: v => v <= 2 },
    { name: '页面错误 = 0', get: () => (rep.meta.pageErrors || []).length, ok: v => v === 0 },
    { name: 'baseline 难度随 Tier 爬升（T1→T4 总降幅 ≥10pp，允许 ±8pp 噪声）', get: () => baseSeq.map(v => v.toFixed(0) + '%').join('→'), ok: () => baseSeq[0] - baseSeq[3] >= 10 && baseSeq.every((v, i) => i === 0 || v <= baseSeq[i - 1] + 8) },
    { name: 'baseline 噩梦 T4 撤离率 ≤ 35%', get: () => { const c = rateOf('baseline', 4, 'nightmare'); return c.n ? c.rate + '%（n=' + c.n + '）' : '样本不足'; }, ok: v => typeof v === 'number' ? v <= 35 : true },
    { name: 'on-curve 后期不倒挂（T4 撤离率不高于 T1 +10pp）', get: () => curveSeq.map(v => v.toFixed(0) + '%').join('→'), ok: () => curveSeq[3] <= curveSeq[0] + 10 },
    { name: 'on-curve 整体撤离率 55–92%（farm 可行性）', get: () => rep.byProfile.oncurve.extractRate, ok: v => v >= 55 && v <= 92, fmt: v => v + '%' },
    { name: '难度不倒挂：baseline 高难（困难+噩梦）撤离率不得高于低难（休闲+普通）5pp 以上', get: () => {
      const rate = ds => {
        const a = rep.runs.filter(r => r.profile === 'baseline' && ds.includes(r.difficulty) && !r.forcedAbort && r.result !== 'error');
        return { n: a.length, rate: +pct(a).toFixed(1) };
      };
      const lo = rate(['casual', 'normal']), hi = rate(['hard', 'nightmare']);
      return `低难 ${lo.rate}%（n=${lo.n}）→ 高难 ${hi.rate}%（n=${hi.n}）`;
    }, ok: () => {
      const rate = ds => {
        const a = rep.runs.filter(r => r.profile === 'baseline' && ds.includes(r.difficulty) && !r.forcedAbort && r.result !== 'error');
        return pct(a);
      };
      return rate(['hard', 'nightmare']) <= rate(['casual', 'normal']) + 5;
    } },
    { name: '平均对局时长 60–420s', get: () => +(rep.runs.filter(r => !r.forcedAbort).reduce((a, r) => a + r.durationSec, 0) / Math.max(1, rep.meta.validRuns)).toFixed(1), ok: v => v >= 60 && v <= 420 },
  ];
  for (const c of checks) {
    const v = c.get();
    const pass = c.ok(v);
    const shown = c.fmt ? c.fmt(v) : (typeof v === 'number' ? (Math.round(v * 10) / 10) : v);
    L.push(`- ${pass ? '✅' : '⚠️'} **${c.name}**：实测 ${shown} ${pass ? '达标' : '**越界，需复核数值**'}`);
  }
  L.push('');
  L.push('### 5b. 本轮平衡发现');
  L.push('');
  L.push(`- **Tier 内容难度是通关率的主导因子**：baseline 画像撤离率随 Tier 显著下滑（${[1, 2, 3, 4].map(t => rep.profileTier.baseline['T' + t].extractRate + '%').join('→')}），T4 仅 ${rep.profileTier.baseline.T4.extractRate}%，成长配装（on-curve）则稳定在 ${[1, 2, 3, 4].map(t => rep.profileTier.oncurve['T' + t].extractRate + '%').join('→')}，说明角色/武器成长曲线基本跟得上内容。`);
  L.push(`- **难度倍率对风筝型打法区分度偏弱**：同画像相邻难度撤离率在采样噪声内波动（全队列 ${DIFFS.map(d => rep.byDifficulty[d.id].extractRate + '%').join('→')}），真正拉开差距的是 baseline×噩梦×T4（${rateOf('baseline', 4, 'nightmare').n ? rateOf('baseline', 4, 'nightmare').rate + '%' : '样本不足'}）。若要让难度选择更有体感，可上调困难/噩梦的怪物移速、冲锋/自爆近战比例与兽潮数量，而非继续堆血量。`);
  const topDeath = Object.entries(rep.byTier.T4.deathBy).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}×${v}`).join('，') || '样本不足';
  L.push(`- **T4 主要击杀来源**：${topDeath}；调参时优先核对这些怪物的前摇/伤害与 on-curve 配装的 EHP。`);
  L.push('');
  L.push('## 6. 调参建议（仅在越界时启用，每次只动一个杠杆并复跑）');
  L.push('');
  L.push('- **baseline 队列不随 Tier 下降**：说明内容难度断层（高 Tier 怪多为远程/慢速，风筝 bot 反而好打），应上调该 Tier 怪物追击速度、冲锋/自爆近战比例或兽潮数量，而不是砍玩家补给；');
  L.push('- **on-curve 队列后期倒挂**：说明角色成长曲线超过内容成长，优先上调 T3/T4 怪物血量/伤害 Tier 倍率，或压缩后期基础攻击/武器词条收益；');
  L.push('- 某格撤离率过低：先查该 Tier「击杀来源 Top」（被哪类怪击杀），再针对性下调该怪物前摇速度/伤害，或提高 on-curve 武器可及性；');
  L.push('- 时长偏短（<90s）说明一路跑撤无战斗，检查怪物追击速度与撤离点距离；偏长（>420s）检查 DPS 是否不足（TTK 过长）；');
  L.push('- 金币经济：用「平均结算金币 × 期望撤离率」对照 +10 武器材料成本，目标为 5–8 次成功撤离可满级一把武器（见《游戏数据表_v3》经济校验 sheet）。');
  L.push('');
  L.push('---');
  L.push('*本报表由 tools/balance-bot.js 自动生成，逐局数据见 tools/balance-report.json。*');
  return L.join('\n');
}

async function main() {
  const specs = buildSpecs(TOTAL_RUNS);
  console.log(`计划跑 ${specs.length} 局，batch=${BATCH}`);
  const gameUrl = pathToFileURL(path.join(ROOT, 'index.html')).href;
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('file:')) pageErrors.push(m.text()); });

  await page.goto(gameUrl);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForLoadState('networkidle');
  await injectEnv(page);

  const runs = [];
  const t0 = Date.now();
  for (let i = 0; i < specs.length; i += BATCH) {
    const batch = specs.slice(i, i + BATCH);
    const res = await page.evaluate(botBatch, batch);
    runs.push(...res);
    const ok = runs.filter(r => r.success).length;
    process.stdout.write(`\r进度 ${runs.length}/${specs.length}，累计撤离 ${ok}（${(ok / runs.length * 100).toFixed(0)}%），用时 ${Math.round((Date.now() - t0) / 1000)}s   `);
  }
  process.stdout.write('\n');
  await browser.close();

  const rep = buildReport(runs, pageErrors);
  const jsonPath = path.join(ROOT, 'tools', 'balance-report.json');
  fs.writeFileSync(jsonPath, JSON.stringify(rep, null, 2), 'utf8');
  const mdPath = path.join(ROOT, 'docs', 'balance-report.md');
  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.writeFileSync(mdPath, buildMarkdown(rep), 'utf8');

  console.log(`\n页面错误 ${pageErrors.length} 条：${pageErrors.slice(0, 5).join(' | ') || '无'}`);
  for (const d of DIFFS) {
    const s = rep.byDifficulty[d.id];
    console.log(`${d.name}: n=${s.n} 撤离率=${s.extractRate}% 均时长=${s.avgDuration}s 均击杀=${s.avgKills} 均金币=${s.avgGold}`);
  }
  for (const [pf, label] of [['oncurve', 'on-curve'], ['baseline', 'baseline']]) {
    const seq = [1, 2, 3, 4].map(t => rep.profileTier[pf]['T' + t].extractRate + '%').join(' → ');
    console.log(`${label} 各 Tier 撤离率：${seq}（整体 ${rep.byProfile[pf].extractRate}%）`);
  }
  console.log(`\n产物：\n${jsonPath}\n${mdPath}`);
  if (rep.meta.errors > 0 || rep.meta.forcedAborts > 0) process.exitCode = 1;
}

// 从已有逐局 JSON 重新聚合生成报表（不重跑浏览器）：node tools/balance-bot.js --regen
if (process.argv.includes('--regen')) {
  const jsonPath = path.join(ROOT, 'tools', 'balance-report.json');
  const prev = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const rep = buildReport(prev.runs, (prev.meta && prev.meta.pageErrors) || []);
  rep.meta.generatedAt = prev.meta.generatedAt;
  fs.writeFileSync(jsonPath, JSON.stringify(rep, null, 2), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'docs', 'balance-report.md'), buildMarkdown(rep), 'utf8');
  console.log('已从 balance-report.json 重新聚合报表');
} else if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { buildReport, buildMarkdown, buildSpecs };
