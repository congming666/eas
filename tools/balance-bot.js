/**
 * balance-bot.js v5.3 — 数据驱动平衡机器人
 *
 * 能力：
 *  - 5 个画像：oncurve（满级配装）/ baseline（新手）/ bosshunter（寻 Boss）/
 *    frugal（有限补给：3 草药）/ greedy（贪财：满包/残血才撤）
 *  - 每画像 × Tier × 难度 n≥25，Wilson 95% 置信区间，相邻难度两比例 z 检验（p≥0.05 标噪声）
 *  - bot 决策纳入：信号弹撤离、怒气大招、处决、岔路选择、任务目标（hunt/scavenge/tower）
 *  - 单杠杆 A/B：--lever-speed / --lever-melee（注入侧覆盖，不改游戏文件）
 *  - 经济闭环专项：--economy=N，新号 200 金连跑 N 档（局间继承仓库），产出 +10 所需撤离局数/材料缺口
 *  - 每次跑批按版本归档 tools/balance-history/，报表含"与上版本对比"
 *
 * 用法（PowerShell 下参数必须用等号）：
 *   node tools/balance-bot.js --plan=full
 *   node tools/balance-bot.js --plan=nightly
 *   node tools/balance-bot.js --profiles=oncurve,baseline --diffs=nightmare --cell=25 --lever-speed=1.15 --lever-melee=0.35 --lever-diffs=nightmare --label=lever-nm
 *   node tools/balance-bot.js --economy=30
 */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INDEX = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');
const HISTORY_DIR = path.join(ROOT, 'tools', 'balance-history');
const REPORT_JSON = path.join(ROOT, 'tools', 'balance-report.json');
const REPORT_MD = path.join(ROOT, 'docs', 'balance-report.md');
const ECON_JSON = path.join(ROOT, 'tools', 'balance-economy.json');
const ECON_MD = path.join(ROOT, 'docs', 'balance-economy.md');

const FALLBACK_CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

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
const PROFILES = ['oncurve', 'baseline', 'bosshunter', 'frugal', 'greedy'];

// ---------- CLI ----------
function arg(name, def) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  if (!hit) return def;
  const v = hit.split('=').slice(1).join('=');
  return v;
}
function argList(name) {
  const v = arg(name, null);
  return v ? v.split(',').map(s => s.trim()).filter(Boolean) : null;
}
function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function pad2(n) { return String(n).padStart(2, '0'); }
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}

// ---------- 统计 ----------
function wilson(k, n, z) {
  z = z || 1.96;
  if (!n) return { rate: 0, lo: 0, hi: 0 };
  const p = k / n;
  const den = 1 + z * z / n;
  const cen = p + z * z / (2 * n);
  const adj = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n);
  return { rate: p, lo: (cen - adj) / den, hi: (cen + adj) / den };
}
function normalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}
function twoProp(k1, n1, k2, n2) {
  if (n1 < 10 || n2 < 10) return { p: null, delta: null, sig: null };
  const p1 = k1 / n1, p2 = k2 / n2;
  const pp = (k1 + k2) / (n1 + n2);
  const se = Math.sqrt(pp * (1 - pp) * (1 / n1 + 1 / n2));
  if (se === 0) return { p: 1, delta: 0, sig: false };
  const z = (p2 - p1) / se;
  const p = 2 * (1 - normalCdf(Math.abs(z)));
  return { z, p, delta: p2 - p1, sig: p < 0.05 };
}
function rateOf(runs, pred) {
  const n = runs.filter(r => r.result !== 'timeout' && r.result !== 'error').length;
  const k = runs.filter(r => r.result !== 'timeout' && r.result !== 'error' && pred(r)).length;
  return { k, n, ...wilson(k, n) };
}
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function pct(x) { return (x * 100).toFixed(1) + '%'; }
function ciStr(w) { return `${pct(w.rate)} [${pct(w.lo)}, ${pct(w.hi)}]`; }

// ---------- 规格 ----------
function buildSpecs() {
  const plan = arg('plan', null);
  const profFilter = argList('profiles');
  const diffFilter = argList('diffs');
  const tierFilter = argList('tiers')?.map(Number);
  const label = arg('label', plan === 'full' ? 'core-full' : plan === 'nightly' ? 'nightly' : 'custom');
  const leverSpeed = parseFloat(arg('lever-speed', '1')) || 1;
  const leverMelee = arg('lever-melee', null) ? parseFloat(arg('lever-melee')) : null;
  const leverDiffs = argList('lever-diffs');

  let specs = [];
  let runId = 0;
  const push = (o) => specs.push(Object.assign({ runId: ++runId }, o));

  if (plan === 'full' || plan === 'nightly') {
    const cell = plan === 'full' ? 25 : 13;
    const bossCell = plan === 'full' ? 4 : 1;
    const fgCell = plan === 'full' ? 12 : 4;
    // 核心两画像 × 4 Tier × 4 难度
    for (const prof of ['oncurve', 'baseline']) {
      for (const d of DIFFS) {
        for (let tier = 1; tier <= 4; tier++) {
          for (let i = 0; i < cell; i++) {
            push(mkSpec(prof, d.id, tier, 1 + ((runId + i) % 6), i));
          }
        }
      }
    }
    // 寻 Boss：24 张图，普通难度
    for (let tier = 1; tier <= 4; tier++) {
      for (let m = 1; m <= 6; m++) {
        for (let i = 0; i < bossCell; i++) push(mkSpec('bosshunter', 'normal', tier, m, i));
      }
    }
    // 有限补给 / 贪财：普通+噩梦 × 4 Tier
    for (const prof of ['frugal', 'greedy']) {
      for (const d of ['normal', 'nightmare']) {
        for (let tier = 1; tier <= 4; tier++) {
          for (let i = 0; i < fgCell; i++) push(mkSpec(prof, d, tier, 1 + ((runId + i) % 6), i));
        }
      }
    }
  } else if (profFilter || diffFilter || tierFilter || arg('cell', null)) {
    const cell = parseInt(arg('cell', '5'), 10);
    const profs = profFilter || ['oncurve', 'baseline'];
    const diffs = (diffFilter || DIFFS.map(d => d.id)).map(id => DIFFS.find(d => d.id === id)).filter(Boolean);
    const tiers = tierFilter || [1, 2, 3, 4];
    for (const prof of profs) {
      for (const d of diffs) {
        for (const tier of tiers) {
          for (let i = 0; i < cell; i++) push(mkSpec(prof, d.id, tier, 1 + ((runId + i) % 6), i));
        }
      }
    }
  } else {
    // 兼容旧版：--runs=N 混合队列（一半 oncurve 一半 baseline）
    const total = parseInt(arg('runs', '200'), 10);
    const perDiff = Math.floor(total / 4);
    DIFFS.forEach((d, di) => {
      const tiers = shuffle([].concat(Array(13).fill(1), Array(13).fill(2), Array(12).fill(3), Array(12).fill(4)));
      const n = di === 3 ? total - perDiff * 3 : perDiff;
      const half = Math.floor(n / 2);
      for (let i = 0; i < n; i++) {
        const tier = tiers[i % tiers.length];
        const prof = i < half ? 'oncurve' : 'baseline';
        push(mkSpec(prof, d.id, tier, 1 + (runId % 6), i));
      }
    });
  }

  // 杠杆只作用于指定难度
  if (leverSpeed !== 1 || leverMelee != null) {
    specs.forEach(s => {
      const apply = !leverDiffs || leverDiffs.includes(s.difficulty);
      s.leverSpeed = apply ? leverSpeed : 1;
      s.leverMelee = apply ? leverMelee : null;
    });
  } else {
    specs.forEach(s => { s.leverSpeed = 1; s.leverMelee = null; });
  }
  specs = shuffle(specs).map((s, i) => Object.assign(s, { runId: i + 1 }));
  return { specs, label };
}

function mkSpec(profile, difficulty, tier, mapIdx, salt) {
  const [plo, phi] = PLAN_SEC[tier];
  let lvl, wlv, weaponId = WEAPONS[(salt + tier) % WEAPONS.length];
  if (profile === 'baseline' || profile === 'frugal') {
    wlv = 0; lvl = randInt(10, 18);
    weaponId = 'harvest_sickle';
  } else {
    const [wlo, whi] = WEAPON_LV[tier];
    wlv = randInt(wlo, whi);
    lvl = Math.max(1, Math.min(100, TIER_LEVEL[tier] + randInt(-4, 4)));
  }
  return {
    profile, difficulty, tier,
    mapId: `t${tier}_${mapIdx}`,
    weaponId, weaponLevel: wlv, level: lvl,
    planSec: randInt(plo, phi),
  };
}

// ---------- 页面内脚本（自包含，不能引用 Node 作用域） ----------
function botSource(specsJson) {
  return `(async function(specs){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const TICK = 1000 / 60;
  const MAXT = 560 * 1000; // 560 虚拟秒（毫秒）

  function setKeys(exp, dx, dy) {
    const k = exp.keys;
    k['w'] = dy < -0.35; k['s'] = dy > 0.35; k['a'] = dx < -0.35; k['d'] = dx > 0.35;
    k['arrowup'] = k['w']; k['arrowdown'] = k['s']; k['arrowleft'] = k['a']; k['arrowright'] = k['d'];
  }
  function D(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  // 近战判定：无 ranged/aerial 且攻击距离 <100
  function isMeleeType(id) {
    const m = CONFIG.monsters[id];
    if (!m) return true;
    return !m.ranged && !m.aerial && (m.attackRange || 50) < 100;
  }
  // 近战比例杠杆：重写该图怪物池权重（局后恢复）
  function applyMeleeLever(mapId, meleeShare) {
    const map = CONFIG.maps.find(m => m.id === mapId);
    if (!map || !map.__poolSnap) {
      map.__poolSnap = JSON.parse(JSON.stringify(map.monsterPool));
      const pool = map.monsterPool;
      let M = 0, R = 0;
      pool.forEach(e => { const w = e[1]; if (isMeleeType(e[0])) M += w; else R += w; });
      const tot = M + R; if (!tot) return;
      const mFrac = M / tot;
      pool.forEach(e => {
        e[1] = e[1] * (isMeleeType(e[0]) ? (meleeShare / mFrac) : ((1 - meleeShare) / (1 - mFrac)));
      });
    }
  }
  function restoreMap(mapId) {
    const map = CONFIG.maps.find(m => m.id === mapId);
    if (map && map.__poolSnap) { map.monsterPool = map.__poolSnap; delete map.__poolSnap; }
  }

  function setupState(spec) {
    const GS = GameState;
    GS.gold = 1e9;
    GS.level = spec.level; GS.cultivation = 0;
    GS.weaponInstances = [{ uid: 'botw', weaponId: spec.weaponId, level: spec.weaponLevel }];
    GS.loadoutWeaponUids = ['botw'];
    GS.carriedSeeds = []; GS.defenseLoadout = [];
    GS.selectedBoostCards = []; GS.cardInventory = [];
    const limited = spec.profile === 'frugal';
    const oneSkill = (spec.profile === 'baseline' || spec.profile === 'frugal');
    if (oneSkill) {
      GS.unlockedSkills = ['straw_smash'];
      GS.equippedSkills = ['straw_smash'];
      GS.skillLevels = { straw_smash: 1 };
    } else {
      // 与 v5.2 母本一致：满级画像装备全部技能（槽位限制只在真实 UI 生效，bot 测的是配装上限）
      GS.unlockedSkills = CONFIG.skills.map(s => s.id);
      GS.equippedSkills = CONFIG.skills.map(s => s.id);
      GS.skillLevels = {}; CONFIG.skills.forEach(s => { GS.skillLevels[s.id] = 1; });
    }
    GS.loadout = limited ? { herb_kit: 3, thorn_storm: 0, signal_flare: 1 }
                         : { herb_kit: 99, thorn_storm: 999, signal_flare: 10 };
    GS.difficulty = spec.difficulty;
    GS.heatModifiers = [];
    GS.selectedMap = spec.mapId;
    GS.safeSlots = 3; GS.safeBox = [];
    if (typeof Warehouse !== 'undefined' && Warehouse.removeItem) {
      try { Warehouse.removeItem('death_pardon', 999); } catch (e) {}
    }
    if (spec.leverMelee != null) applyMeleeLever(spec.mapId, spec.leverMelee);
  }

  function runOne(spec) {
    setupState(spec);
    if (typeof Expedition !== 'undefined' && !Expedition.prototype.__botNoRender) {
      Expedition.prototype.render = function () {};
      Expedition.prototype.__botNoRender = true;
    }
    Game.startExpedition();
    if (Game.animId) cancelAnimationFrame(Game.animId);
    const exp = Game.expedition;
    if (!exp) throw new Error('startExpedition 未创建远征实例');
    exp.updateHUD = function () {};
    const w0 = exp.weapon;
    if (!w0 || w0.id !== spec.weaponId) {
      // 兜底：手动配装
      const base = CONFIG.weapons.find(w => w.id === spec.weaponId);
      exp.weapon = Object.assign({}, base, LoadoutSystem.getWeaponStats(base, spec.weaponLevel));
      exp.weapon.level = spec.weaponLevel; exp.weapon.weaponUid = 'botw';
    }

    const W = CONFIG.canvas.width, H = CONFIG.canvas.height;
    const CE = (typeof CombatEnhancement !== 'undefined') ? CombatEnhancement : null;
    const p = exp.player;
    let strafeSign = Math.random() < 0.5 ? -1 : 1;
    let dodgeCd = 0, skillRotate = 0;
    let lastX = p.x, lastY = p.y;
    let extract = false, signalHold = false, signalStarted = false, signalRestarts = 0;
    let ticks = 0, ended = false;
    let signalUsed = 0, ultUsed = 0, execUsed = 0, branchCount = 0;
    let noHerbDeath = false, herbAttemptsMissed = 0;
    let bossEngaged = false, bossEngageAt = null, bossTtkSec = null, bossKilled = false, bossSeenHp = null;
    let ultRageBefore = 0;

    // 位移技不自动放：会把 bot 带出撤离圈（疾风斩真实 id 为 gale_slash）
    const NO_AUTO = ['earth_dash', 'gale_slash'];
    let obj = exp.objective || {};

    function entities() {
      const ens = exp.monsters.filter(m => m.hp > 0)
        .concat((exp.raiders || []).filter(m => m.hp > 0));
      if (exp.boss && exp.boss.hp > 0 && ens.indexOf(exp.boss) < 0) ens.push(exp.boss);
      return ens;
    }
    function nearestOf(list, from) {
      let best = null, bd = 1e9;
      for (const m of list) { const d = D(m, from); if (d < bd) { bd = d; best = m; } }
      return { best, bd };
    }
    // 任务目标（scavenge=全局最近未开宝箱；tower=未占领塔）
    function objectiveGoal() {
      const o = exp.objective || {};
      if (o.complete) return null;
      if (o.type === 'scavenge') {
        let bc = null, bd2 = 1e9;
        for (const c of (exp.chests || [])) {
          if (c.opened) continue;
          const d = D(c, p); if (d < bd2) { bd2 = d; bc = c; }
        }
        return bc ? { x: bc.x, y: bc.y, r: 30, act: () => exp.openChest(bc) } : null;
      }
      if (o.type === 'tower') {
        let tc = null, bd2 = 1e9;
        for (const tw of (exp.towers || [])) {
          if (tw.state === 'player') continue;
          const d = D(tw, p); if (d < bd2) { bd2 = d; tc = tw; }
        }
        return tc ? { x: tc.x, y: tc.y, r: 30, act: () => {
          try {
            exp.mouse.x = Math.max(0, Math.min(1280, tc.x - (exp.camera ? exp.camera.x : 0)));
            exp.mouse.y = Math.max(0, Math.min(720, tc.y - (exp.camera ? exp.camera.y : 0)));
            exp.tryInteract();
          } catch (e) {}
        } } : null;
      }
      return null;
    }

    for (ticks = 0; ticks < MAXT / TICK; ticks++) {
      if (CE && CE.branchActive) { CE.chooseBranch(Math.floor(Math.random() * 3)); branchCount++; }
      const ens = entities();
      const { best: nearest, bd: nd } = nearestOf(ens, p);
      const hpR = p.hp / p.maxHp;
      const elapsed = (CONFIG.expedition.demoDuration - exp.timeLeft) || (ticks / 60);

      // 速度杠杆（注入侧，不改文件）
      if (spec.leverSpeed && spec.leverSpeed !== 1) {
        if (!exp.__leverSped) {
          exp.balance.enemySpeed = (exp.balance.enemySpeed || 1) * spec.leverSpeed;
          exp.__leverSped = true;
        }
        ens.forEach(m => { if (!m.__leverSped) { m.speed = (m.speed || 0) * spec.leverSpeed; m.__leverSped = true; } });
      }

      // Boss 交战 / TTK
      if (exp.boss && exp.boss.hp > 0) {
        bossSeenHp = exp.boss.hp;
        if (!bossEngaged && D(exp.boss, p) < 520) { bossEngaged = true; bossEngageAt = elapsed; }
      } else if (bossSeenHp != null && !bossKilled) {
        bossKilled = true;
        if (bossEngageAt != null) bossTtkSec = +(elapsed - bossEngageAt).toFixed(1);
      }

      // 背包格数：与游戏一致（金币 100/格），优先走 LoadoutSystem.usedSlots
      let slots = 0;
      try { slots = LoadoutSystem.usedSlots(exp.bag); }
      catch (e) { (exp.bag || []).forEach(it => { slots += it.type === 'gold' ? Math.max(1, Math.ceil((it.amount || 0) / 100)) : (it.slots || 1); }); }

      // ===== 撤离决策（画像差异）=====
      obj = exp.objective || {};
      if (!extract) {
        if (spec.profile === 'bosshunter') {
          const bossFallback = spec.tier >= 4 ? 300 : spec.tier === 3 ? 270 : 240;
          if (bossKilled || (exp.boss && exp.boss.hp > 0 && exp.boss.hp / exp.boss.maxHp < 0.12) || exp.timeLeft < bossFallback) extract = true;
        } else if (spec.profile === 'greedy') {
          const greedyFallback = spec.tier >= 4 ? 320 : spec.tier === 3 ? 270 : 220;
          if (slots >= 16 || hpR < 0.15 || exp.timeLeft < greedyFallback) extract = true;
        } else {
          if (elapsed >= spec.planSec || hpR < 0.22 || slots >= 15 || exp.timeLeft < 100) extract = true;
        }
      }

      // 信号弹：决定撤、残血、离固定点 >700、有库存
      const pts0 = exp.extractPoints || [];
      const nearestEpD = pts0.length ? Math.min.apply(null, pts0.map(q => D(q, p))) : 0;
      const signalPanic = exp.timeLeft < 150 && nearestEpD > 450;
      // v12：撤离状态机提前初始化，记录决定撤离的时刻
      const esPre = extract ? (exp._botExtract || (exp._botExtract = { t: 0, side: 1, lastEd: 999, orbitT: 0, fails: 0, stuck: 0 })) : null;
      if (esPre) esPre.decidedAt = esPre.decidedAt || ticks;
      // v12：硬兜底——剩余<120s，或决定撤离已 180s 但读条进度从未过半，原地打信号弹
      const hardPanic = !!esPre && !signalHold && (exp.timeLeft < 170 || (ticks - esPre.decidedAt > 3600 && (exp.extractProgress || 0) < 0.5));
      if (extract && !signalStarted && (exp.consumables.signal_flare || 0) > 0 && !exp.extracting && ((hpR < 0.45 && nearestEpD > 700) || signalPanic || hardPanic)) {
        try { exp.useConsumable('signal_flare'); signalUsed++; signalStarted = true; signalHold = true; } catch (e) {}
      }
      if (signalHold && exp.extractType === 'signal' && !exp.extracting && (exp.extractProgress || 0) === 0 && ticks > 30) {
        // v13：信号读条被打断 → 原地重启最多 2 次（会再引一波伏击，但读条保护技能全开）；仍失败再回退固定点
        if (signalRestarts < 1) {
          signalRestarts++;
          try { exp.startExtract('signal'); } catch (e) { signalHold = false; }
        } else {
          signalHold = false;
        }
      }

      let tx = null, ty = null, holdPosition = false;

      if (extract && !signalHold) {
        // ===== 固定点撤离（移植 v5.2 验证过的寻路：封禁卡点/绕点/狂暴）=====
        const es = exp._botExtract || (exp._botExtract = { t: 0, side: 1, lastEd: 999, orbitT: 0, fails: 0, stuck: 0 });
        es.t++;
        if (es.rotating > 0) es.rotating--;
        let ep = null, ed = 1e9;
        pts0.forEach(q => { q.hidden = false; q.revealed = true; });
        const pts = pts0.map((q, i) => ({ q, i, d: D(q, p) }));
        const avail = pts.filter(c => ticks >= (es['ban' + c.i] || 0));
        const pool = avail.length ? avail : pts;
        for (const c of pool) { if (c.d < ed) { ed = c.d; ep = c.q; ep._idx = c.i; } }
        if (ep) {
          const HOLD = ep.radius * 0.85;
          // 圈内 60s 读不上条：拉怪远离撤离点清场 15s，再回点重试
          if (ed < HOLD && es.stuck > 1800 && (es.lureUntil || 0) < ticks) { es.lureUntil = ticks + 720; es.stuck = 0; es.berserk = false; es.lureCount = (es.lureCount || 0) + 1; }
          const luring = (es.lureUntil || 0) > ticks;
          if (luring) {
            // 以撤离点外 300px 为锚点风筝清怪，把怪潮拉走
            const ux = (p.x - ep.x) / (ed || 1), uy = (p.y - ep.y) / (ed || 1);
            let cx = ep.x + ux * 300, cy = ep.y + uy * 300;
            cx = Math.max(120, Math.min(CONFIG.expedition.mapSize - 120, cx));
            cy = Math.max(120, Math.min(CONFIG.expedition.mapSize - 120, cy));
            const w0 = exp.weapon;
            const desired0 = w0.mode !== 'melee' ? w0.range * 0.62 : w0.range * 0.72;
            if (nearest) {
              const mxx = nearest.x - p.x, myy = nearest.y - p.y;
              if (nd > desired0 + 12) { tx = nearest.x; ty = nearest.y; }
              else if (nd < desired0 * 0.62) { tx = p.x - mxx; ty = p.y - myy; }
              else { tx = cx; ty = cy; }
            } else { tx = cx; ty = cy; }
          } else if (ed < HOLD) {
            holdPosition = true;
            if (!exp.extracting) {
              if ((es.lureCount || 0) >= 2 && !signalStarted && (exp.consumables.signal_flare || 0) > 0) {
                try { exp.useConsumable('signal_flare'); signalUsed++; signalStarted = true; signalHold = true; } catch (e) { try { exp.startExtract('fixed'); } catch (e2) {} }
              } else { try { exp.startExtract('fixed'); } catch (e) {} }
            }
            // 读条打断计数：进度曾超过 5% 又归零 = 被怪潮打断；累计 3 次主动拉怪清场
            const progNow = exp.extractProgress || 0;
            if (exp.extracting) { es.stuck = Math.max(0, (es.stuck || 0) - 2); es.everProgress = Math.max(es.everProgress || 0, progNow); }
            else {
              if ((es.everProgress || 0) > 0.05) { es.interrupts = (es.interrupts || 0) + 1; es.everProgress = 0; }
              es.stuck = (es.stuck || 0) + 1;
            }
            if ((es.interrupts || 0) >= 3 && (es.lureUntil || 0) < ticks) {
              es.lureUntil = ticks + 720; es.stuck = 0; es.interrupts = 0; es.berserk = false;
              es.lureCount = (es.lureCount || 0) + 1;
            }
            if (es.stuck > 5400) es.berserk = true;
            if (es.stuck > 12600 && pts.length > 1) {
              es['ban' + ep._idx] = ticks + 1800; es.rotating = 1200; es.stuck = 0; es.berserk = false;
            }
            if (ed > ep.radius * 0.35) {
              tx = ep.x; ty = ep.y;
              const dodgeLine = es.berserk ? ep.radius * 0.2 : ep.radius * 0.5;
              if (!exp.extracting && ed > dodgeLine && dodgeCd <= 0 && CE) {
                const ddx = ep.x - p.x, ddy = ep.y - p.y, dl = Math.hypot(ddx, ddy) || 1;
                setKeys(exp, ddx / dl, ddy / dl);
                try { CE.tryDodge(); } catch (e) {}
                dodgeCd = es.berserk ? 45 : 60;
              }
            } else setKeys(exp, 0, 0);
            // 圈内静止读条不是卡死：必须清绕行计数（否则会被误判拉出圈外）
            es.fails = 0; es.orbitT = 0;
          } else if ((es.lureUntil || 0) > ticks) {
            // 拉怪清场中：前往撤离点外 300px 锚点，不做回点卡死判定
            const ux2 = (p.x - ep.x) / (ed || 1), uy2 = (p.y - ep.y) / (ed || 1);
            let cx2 = ep.x + ux2 * 300, cy2 = ep.y + uy2 * 300;
            cx2 = Math.max(120, Math.min(CONFIG.expedition.mapSize - 120, cx2));
            cy2 = Math.max(120, Math.min(CONFIG.expedition.mapSize - 120, cy2));
            if (nearest && nd < 120) { tx = p.x - (nearest.x - p.x) * 0.6; ty = p.y - (nearest.y - p.y) * 0.6; }
            else { tx = cx2; ty = cy2; }
          } else {
            // 圈外直冲；每 2.5 虚拟秒检查是否被障碍/怪潮卡住，卡住则绕行+闪避
            if (es.t % 150 === 0) {
              if (es.lastEd - ed < 8) {
                es.fails++; es.side *= -1; es.orbitT = 120;
                if (dodgeCd <= 0 && CE) { try { CE.tryDodge(); } catch (e) {} dodgeCd = 70; }
                if (es.fails >= 2 && pts.length > 1) { es['ban' + ep._idx] = ticks + 600; es.fails = 0; }
              } else es.fails = 0;
              es.lastEd = ed;
            }
            if (es.orbitT > 0) {
              es.orbitT--;
              const base = Math.atan2(p.y - ep.y, p.x - ep.x);
              const ang = base + es.side * 0.9;
              tx = ep.x + Math.cos(ang) * ep.radius * 1.2; ty = ep.y + Math.sin(ang) * ep.radius * 1.2;
            } else { tx = ep.x; ty = ep.y; }
          }
        }
      } else if (signalHold && nearest) {
        // v15：信号弹读条无站位要求，保持读条并按战斗风筝走位/输出（仅受击会打断）
        const wSig = exp.weapon;
        const rangedSig = wSig.mode !== 'melee';
        const desiredSig = rangedSig ? wSig.range * 0.62 : wSig.range * 0.72;
        const mxSig = nearest.x - p.x, mySig = nearest.y - p.y;
        if (nd > desiredSig + 12) { tx = nearest.x; ty = nearest.y; }
        else if (nd < desiredSig * 0.62) { tx = p.x - mxSig; ty = p.y - mySig; }
        else {
          const lenSig = Math.hypot(mxSig, mySig) || 1;
          const pxSig = -mySig / lenSig, pySig = mxSig / lenSig;
          if (ticks % 150 === 0) strafeSign *= -1;
          tx = p.x + pxSig * strafeSign * 120; ty = p.y + pySig * strafeSign * 120;
        }
      } else if (nearest && !extract && !(spec.profile === 'bosshunter' && objectiveGoal() && nd > 350)) {
        // bosshunter 贴近任务目标时即使身边有怪也先交互（占塔）
        if (spec.profile === 'bosshunter') { const og0 = objectiveGoal(); if (og0 && og0.act && D(og0, p) < 55) { try { og0.act(); } catch (e) {} } }
        // ===== 战斗风筝 =====
        const w = exp.weapon;
        const ranged = w.mode !== 'melee';
        const desired = ranged ? w.range * 0.62 : w.range * 0.72;
        const mx = nearest.x - p.x, my = nearest.y - p.y;
        if (nd > desired + 12) { tx = nearest.x; ty = nearest.y; }
        else if (nd < desired * 0.62) { tx = p.x - mx; ty = p.y - my; }
        else {
          const len = Math.hypot(mx, my) || 1;
          const px = -my / len, py = mx / len;
          if (ticks % 150 === 0) strafeSign *= -1;
          tx = p.x + px * strafeSign * 120; ty = p.y + py * strafeSign * 120;
        }
      } else if (extract && nearest) {
        // 撤离途中仍清近身怪
        const w = exp.weapon;
        if (nd < (w.mode === 'melee' ? w.range : w.range * 0.7)) {
          const mx = nearest.x - p.x, my = nearest.y - p.y;
          tx = p.x - mx * 0.5, ty = p.y - my * 0.5;
        }
      } else {
        // ===== 无近身怪：画像行为 =====
        let goal = null;
        if (spec.profile === 'bosshunter') {
          const og = objectiveGoal();
          if (og) goal = { o: og, d: D(og, p), r: og.r, act: og.act };
        }
        if (!goal && spec.profile === 'greedy') {
          let bc = null, bd2 = 1e9;
          for (const c of (exp.chests || [])) {
            if (c.opened) continue;
            const d = D(c, p); if (d < bd2) { bd2 = d; bc = c; }
          }
          if (bc && bd2 < 1400) goal = { o: bc, d: bd2, r: 30, act: () => exp.openChest(bc) };
        }
        if (!goal) {
          // 其他画像：附近宝箱或漫游
          let bc = null, bd2 = 1e9;
          for (const c of (exp.chests || [])) {
            if (c.opened) continue;
            const d = D(c, p); if (d < bd2) { bd2 = d; bc = c; }
          }
          if (bc && bd2 < 700) goal = { o: bc, d: bd2, r: 30, act: () => exp.openChest(bc) };
        }
        if (goal) {
          tx = goal.o.x; ty = goal.o.y;
          if (goal.d < (goal.r || 30) + 18 && goal.act) { try { goal.act(); } catch (e) {} }
        } else {
          if (!exp._wanderT || exp._wanderT <= 0) {
            const ang = Math.random() * Math.PI * 2;
            const r = 300 + Math.random() * 650;
            exp._wander = {
              x: Math.max(160, Math.min(CONFIG.expedition.mapSize - 160, (exp.spawnX || p.x) + Math.cos(ang) * r)),
              y: Math.max(160, Math.min(CONFIG.expedition.mapSize - 160, (exp.spawnY || p.y) + Math.sin(ang) * r)),
            };
            exp._wanderT = 300 + Math.random() * 240;
          }
          exp._wanderT--;
          if (exp._wander) { tx = exp._wander.x; ty = exp._wander.y; }
        }
      }

      // 移动指令（与 v5.2 母本一致：holdPosition 不屏蔽朝点中心的挤位移动）
      if (tx !== null) {
        const dx = tx - p.x, dy = ty - p.y;
        const d = Math.hypot(dx, dy);
        if (d > 6) setKeys(exp, dx / d, dy / d); else setKeys(exp, 0, 0);
      }

      // 瞄准与攻击
      const rotating = !!(extract && exp._botExtract && exp._botExtract.rotating > 0);
      const aim = (!rotating && nearest) ? nearest : null;
      if (aim) {
        exp.mouse.x = Math.max(4, Math.min(W - 4, aim.x - exp.camera.x));
        exp.mouse.y = Math.max(4, Math.min(H - 4, aim.y - exp.camera.y));
        const inRange = aim === exp.boss ? nd < exp.weapon.range * 1.4 : nd <= exp.weapon.range * 1.02;
        exp.mouse.down = inRange;
      } else exp.mouse.down = false;

      // 大招：满怒且 220px 内 ≥3 怪 或 Boss 380px 内；撤离圈内满怒必开（无敌帧保护读条）
      const inZoneNow = extract && !signalHold && (exp.extractPoints || []).some(q => D(q, p) < q.radius + 24);
      if (CE && typeof CE.tryUltimate === 'function') {
        const closeN = ens.filter(m => D(m, p) < 220).length;
        const bossNear = exp.boss && exp.boss.hp > 0 && D(exp.boss, p) < 380;
        if ((CE.rage >= CE.rageMax && (closeN >= 3 || bossNear || (inZoneNow && closeN >= 1)))) {
          ultRageBefore = CE.rage;
          try { CE.tryUltimate(); if (CE.rage < ultRageBefore - 50) ultUsed++; } catch (e) {}
        }
      }
      // 处决：130px 内精英/Boss 且可执行
      if (CE && typeof CE.tryExecute === 'function' && nearest) {
        if ((nearest.elite || nearest.boss) && nd < 130 && CE.canExecute && CE.canExecute(nearest)) {
          try { CE.tryExecute(nearest); execUsed++; } catch (e) {}
        }
      }

      // 撤离读条保护（固定点圈内 或 信号弹原地读条）：CC/防御技能 CD 一好就按优先级交，拼出读条窗口
      const channelingNow = inZoneNow || (signalHold && exp.extracting && exp.extractType === 'signal');
      if (channelingNow && Array.isArray(exp.equippedSkills)) {
        const cast0 = (id) => {
          const i = exp.equippedSkills.indexOf(id);
          if (i < 0 || (exp.skillCooldowns[i] || 0) > 0) return false;
          const sk = (CONFIG.skills || []).find(s => s.id === id);
          if (sk && p.energy < (sk.energy || 0)) return false;
          const before = p.energy;
          try { exp.useSkill(i); } catch (e) {}
          return p.energy < before;
        };
        if (ens.filter(m => D(m, p) < 170).length >= 1) cast0('smoke_screen');
        if (ens.filter(m => D(m, p) < 150).length >= 2) cast0('vine_bind');
        cast0('frost_barrier');
        cast0('iron_armor');
        if (hpR < 0.6) cast0('healing_rain');
      }

      // 闪避
      if (dodgeCd > 0) dodgeCd--;
      const inZone = extract && !signalHold && (exp.extractPoints || []).some(q => D(q, p) < q.radius + 24);
      const threat = nearest && (nearest.state === 'windup' || nearest.windupT > 0 || nearest.charging || (nearest.attackTimer != null && nearest.attackTimer < 0.25));
      if (!inZone && nearest && nd < 95 && dodgeCd <= 0 && (threat || hpR < 0.3 || (signalHold && Math.random() < 0.08) || Math.random() < 0.03)) {
        try { CE.tryDodge(); } catch (e) {}
        dodgeCd = 70;
      }

      // 技能轮换（位移技排除）
      const eqAll = exp.equippedSkills || [];
      const eq = eqAll.map((id, idx) => idx).filter(idx => NO_AUTO.indexOf(eqAll[idx]) < 0);
      const berserk = !!(extract && exp._botExtract && exp._botExtract.berserk);
      const skillInterval = berserk ? 15 : ((extract || signalHold) && exp.extracting ? 20 : 45);
      if (!rotating && !inZoneNow && ticks % skillInterval === 0 && nearest && nd < (berserk ? 900 : 420)) {
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

      // 消耗品
      const herbLine = (extract && exp.extracting) || signalHold ? 0.6 : 0.42;
      if (hpR < herbLine) {
        if ((exp.consumables.herb_kit || 0) > 0) { try { exp.useConsumable('herb_kit'); } catch (e) {} }
        else herbAttemptsMissed++;
      }
      const nearCount = ens.filter(m => D(m, p) < 170).length;
      const thornTh = berserk ? 1 : ((extract || signalHold) ? (exp.extracting ? 1 : 3) : 4);
      if (!rotating && (exp.consumables.thorn_storm || 0) > 0 && nearCount >= thornTh) {
        try { exp.useConsumable('thorn_storm'); } catch (e) {}
      }

      // 卡死检测
      if (ticks % 180 === 0 && ticks > 0) {
        const moved = Math.hypot(p.x - lastX, p.y - lastY);
        if (moved < 8 && !exp.extracting && !signalHold) { strafeSign *= -1; exp._wanderT = 0; }
        lastX = p.x; lastY = p.y;
      }

      window.__vNow += TICK;
      exp.update(1 / 60);
      if (exp.result) { ended = true; ticks++; break; }
    }

    const rs = exp.runStats || {};
    if (exp.result === 'failed' && herbAttemptsMissed > 0 && p.hp / p.maxHp < 0.42) noHerbDeath = true;
    const goldBag = (exp.bag || []).filter(i => i.type === 'gold').reduce((s, i) => s + i.amount, 0);
    const rec = {
      runId: spec.runId, profile: spec.profile, difficulty: spec.difficulty,
      difficultyName: ({ casual: '休闲', normal: '普通', hard: '困难', nightmare: '噩梦' })[spec.difficulty] || spec.difficulty,
      tier: spec.tier, mapId: spec.mapId,
      weaponId: spec.weaponId, weaponLevel: spec.weaponLevel, charLevel: spec.level,
      planSec: spec.planSec,
      result: exp.result || 'timeout', success: exp.result === 'success',
      durationSec: +((CONFIG.expedition.demoDuration || 720) - (exp.timeLeft || 0)).toFixed(1),
      kills: exp.killCount || 0,
      eliteKills: rs.eliteKills || 0, bossKills: rs.bossKills || 0,
      chests: exp.chestOpened || 0,
      damageTaken: Math.round(exp.damageTaken || 0),
      highestWave: (exp.beastWave && exp.beastWave.wave) || 0,
      goldBag, goldSettled: exp.result === 'success' ? goldBag : Math.floor(goldBag * 0.2),
      deathReason: (exp.deathCause && exp.deathCause.reason) || null,
      deathBy: (exp.deathCause && exp.deathCause.by) || null,
      perfectDodges: rs.perfectDodgeCount || 0, maxCombo: rs.maxCombo || 0,
      minHpPct: Math.round(rs.minHpSeen != null ? rs.minHpSeen : 100),
      extractType: exp.extractType || null,
      signalUsed, ultUsed, execUsed, branchCount,
      bossEngaged, bossTtkSec, bossKilled,
      bossId: (function(){ const mc=(CONFIG.maps||[]).find(m=>m.id===spec.mapId); return (mc&&mc.bossId)||null; })(),
      mapName: (function(){ const mc=(CONFIG.maps||[]).find(m=>m.id===spec.mapId); return mc ? (mc.name||null) : null; })(),
      herbsLeft: exp.consumables ? (exp.consumables.herb_kit || 0) : 0, noHerbDeath,
      objectiveType: obj.type || null, objectiveComplete: !!obj.complete,
      leverSpeed: spec.leverSpeed || 1, leverMelee: spec.leverMelee || null,
      ticks, forcedAbort: !ended,
    };
    try { Game.returnToFarm(); } catch (e) {}
    restoreMap(spec.mapId);
    return rec;
  }

  const out = [];
  for (const spec of specs) {
    try { out.push(runOne(spec)); }
    catch (e) {
      out.push({
        runId: spec.runId, profile: spec.profile, difficulty: spec.difficulty, tier: spec.tier, mapId: spec.mapId,
        weaponId: spec.weaponId, weaponLevel: spec.weaponLevel, charLevel: spec.level, planSec: spec.planSec,
        result: 'error', success: false, error: String(e && e.message || e),
        durationSec: 0, kills: 0, eliteKills: 0, bossKills: 0, chests: 0, damageTaken: 0,
        highestWave: 0, goldBag: 0, goldSettled: 0, deathReason: 'script_error', deathBy: null,
        perfectDodges: 0, maxCombo: 0, minHpPct: 100, extractType: null,
        signalUsed: 0, ultUsed: 0, execUsed: 0, branchCount: 0,
        bossEngaged: false, bossTtkSec: null, bossKilled: false, herbsLeft: 0, noHerbDeath: false,
        objectiveType: null, objectiveComplete: false, ticks: 0, forcedAbort: true,
      });
      try { Game.returnToFarm(); } catch (e2) {}
      try { restoreMap(spec.mapId); } catch (e2) {}
    }
  }
  return out;
})(${specsJson})`;
}

// 经济闭环专项（页面内）
function economySource(nRuns, farmJson) {
  return `(async function(N, FARM){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const TICK = 1000/60, MAXT = 560*1000;
  function setKeys(exp, dx, dy){const k=exp.keys;k['w']=dy<-0.35;k['s']=dy>0.35;k['a']=dx<-0.35;k['d']=dx>0.35;}
  function D(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}

  const GS = GameState;
  if (typeof Expedition !== 'undefined' && !Expedition.prototype.__botNoRender) { Expedition.prototype.render=function(){}; Expedition.prototype.__botNoRender=true; }

  function resetAccount(cfg){
    GS.gold = 200; GS.level = cfg.charLv; GS.cultivation = 0;
    GS.weaponInstances = [{ uid:cfg.uid, weaponId:'harvest_sickle', level:0 }];
    GS.loadoutWeaponUids = [cfg.uid];
    GS.carriedSeeds=[]; GS.defenseLoadout=[]; GS.selectedBoostCards=[]; GS.cardInventory=[];
    if(cfg.skillsAll){
      GS.unlockedSkills=CONFIG.skills.map(s=>s.id); GS.equippedSkills=CONFIG.skills.map(s=>s.id);
      GS.skillLevels={}; CONFIG.skills.forEach(s=>GS.skillLevels[s.id]=1);
    } else {
      GS.unlockedSkills=['straw_smash']; GS.equippedSkills=['straw_smash']; GS.skillLevels={straw_smash:1};
    }
    GS.safeSlots=1; GS.safeBox=[]; GS.heatModifiers=[]; GS.difficulty='normal';
    GS.warehouse = { capacity: 50, items: {}, materials: {}, crops: {} };
    GS.forgedWeapons = ['harvest_sickle']; GS.blueprints = [];
    GS.loadout = { herb_kit: cfg.herbs, thorn_storm: cfg.thorn, signal_flare: cfg.flares };
  }

  function tierForLevel(lv){ if (lv>=8) return 4; if (lv>=5) return 3; if (lv>=2) return 2; return 1; }

  function costSnapshot(uid){
    try {
      const lv = LoadoutSystem.getWeaponInstance(uid).level;
      const c = LoadoutSystem.getUpgradeCost(uid);
      return { level: lv, cost: c };
    } catch(e){ return null; }
  }

  // 局后连点升级直到资源不足（材料键在 cost.materials 内）
  function tryUpgrades(uid){
    let ups=0, blocker=null;
    for(let g=0;g<12;g++){
      const inst=LoadoutSystem.getWeaponInstance(uid);
      if(!inst){ blocker=blocker||'no-inst'; break; }
      const cost=LoadoutSystem.getUpgradeCost(uid);
      if(!cost) break;
      if(GS.gold<cost.gold){ blocker=blocker||('gold:'+Math.floor(GS.gold)+'/'+cost.gold); break; }
      const need=[];
      for(const [mat,n] of Object.entries(cost.materials||{})){
        const have=(GS.warehouse.materials&&GS.warehouse.materials[mat])||0;
        if(have<n) need.push(mat+':'+have+'/'+n);
      }
      if(need.length){ blocker=blocker||need.join(','); break; }
      const lv0=inst.level;
      try{ LoadoutSystem.upgradeWeapon(uid); }catch(e){ blocker='err:'+e.message; break; }
      if(LoadoutSystem.getWeaponInstance(uid).level===lv0){ blocker=blocker||'upgrade-noop'; break; }
      ups++;
    }
    return { ups, blocker };
  }

  async function runOnce(tier, cfg){
    const inst0=LoadoutSystem.getWeaponInstance(cfg.uid);
    const wlv=inst0?inst0.level:0;
    GS.level = cfg.skillsAll ? Math.min(100, 10 + wlv*7) : 10;
    if(cfg.skillsAll){
      GS.unlockedSkills=CONFIG.skills.map(s=>s.id); GS.equippedSkills=CONFIG.skills.map(s=>s.id);
      GS.skillLevels={}; CONFIG.skills.forEach(s=>GS.skillLevels[s.id]=1);
    }
    GS.selectedMap = 't'+tier+'_'+(1+Math.floor(Math.random()*6));
    GS.loadout = { herb_kit: cfg.herbs, thorn_storm: cfg.thorn, signal_flare: cfg.flares };
    GS.loadoutWeaponUids = [cfg.uid];
    Game.startExpedition();
    if (Game.animId) cancelAnimationFrame(Game.animId);
    let exp = Game.expedition;
    if (!exp) {
      const __map = CONFIG.maps.find(m=>m.id===GS.selectedMap);
      throw new Error('no expedition: map='+GS.selectedMap+' mapExists='+!!__map+' fee='+(__map&&__map.entryFee)+' gold='+GS.gold+' uids='+JSON.stringify(GS.loadoutWeaponUids)+' instFound='+!!(GS.loadoutWeaponUids||[]).find(u=>LoadoutSystem.getWeaponInstance(u))+' screen='+GS.screen);
    }
    exp.updateHUD=function(){};
    const p=exp.player, CE=(typeof CombatEnhancement!=='undefined')?CombatEnhancement:null;
    let extract=false, dodgeCd=0, lastX=p.x,lastY=p.y, sign=1, ticks=0;
    const planLo = [0,90,120,150,180][tier]*1000;
    for (ticks=0; ticks<MAXT/TICK; ticks++){
      if (CE && CE.branchActive) CE.chooseBranch(Math.floor(Math.random()*3));
      const ens=exp.monsters.filter(m=>m.hp>0).concat((exp.raiders||[]).filter(m=>m.hp>0));
      if (exp.boss && exp.boss.hp>0 && ens.indexOf(exp.boss)<0) ens.push(exp.boss);
      let nearest=null,nd=1e9; for(const m of ens){const d=D(m,p); if(d<nd){nd=d;nearest=m;}}
      const hpR=p.hp/p.maxHp;
      const elapsed=(CONFIG.expedition.demoDuration-exp.timeLeft)||(ticks/60);
      let slots=0; try{slots=LoadoutSystem.usedSlots(exp.bag);}catch(e){(exp.bag||[]).forEach(it=>slots+=(it.slots||1));}
      if(!extract && (elapsed*1000>=planLo || hpR<0.25 || slots>=15 || exp.timeLeft<100)) extract=true;
      let tx=null,ty=null,hold=false;
      if(extract){
        let ep=null,ed=1e9;
        for(const q of (exp.extractPoints||[])){const d=D(q,p); if(d<ed){ed=d;ep=q;}}
        if(ep){
          if(ed<ep.radius*0.85){
            hold=true;
            if(!exp.extracting){try{exp.startExtract('fixed');}catch(e){}}
            if(ed>ep.radius*0.35){
              tx=ep.x;ty=ep.y;
              if(!exp.extracting && ed>ep.radius*0.5 && dodgeCd<=0 && CE){
                const ddx=ep.x-p.x,ddy=ep.y-p.y,dl=Math.hypot(ddx,ddy)||1;
                setKeys(exp,ddx/dl,ddy/dl); try{CE.tryDodge();}catch(e){} dodgeCd=60;
              }
            }
          } else { tx=ep.x;ty=ep.y; }
        }
      } else if(nearest){
        const w=exp.weapon, desired=w.range*0.72;
        if(nd>desired+12){tx=nearest.x;ty=nearest.y;} else if(nd<desired*0.62){tx=p.x-(nearest.x-p.x);ty=p.y-(nearest.y-p.y);} else {
          const len=Math.hypot(nearest.x-p.x,nearest.y-p.y)||1;
          if(ticks%150===0) sign*=-1;
          tx=p.x+(-(nearest.y-p.y)/len)*sign*120; ty=p.y+((nearest.x-p.x)/len)*sign*120;
        }
      } else {
        let bc=null,bd2=1e9;
        for(const c of (exp.chests||[])){ if(c.opened)continue; const d=D(c,p); if(d<bd2){bd2=d;bc=c;} }
        if(bc&&bd2<900){tx=bc.x;ty=bc.y; if(bd2<48){try{exp.openChest(bc);}catch(e){}}}
      }
      if(tx!==null){const dx=tx-p.x,dy=ty-p.y,d=Math.hypot(dx,dy); if(d>6)setKeys(exp,dx/d,dy/d);else setKeys(exp,0,0);} else setKeys(exp,0,0);
      if(nearest){ exp.mouse.x=nearest.x-exp.camera.x; exp.mouse.y=nearest.y-exp.camera.y; exp.mouse.down=nd<=exp.weapon.range; } else exp.mouse.down=false;
      if(dodgeCd>0)dodgeCd--;
      if(nearest&&nd<95&&dodgeCd<=0&&(nearest.state==='windup'||nearest.windupT>0||hpR<0.3)){try{CE.tryDodge();}catch(e){}dodgeCd=70;}
      if(hpR<0.45&&(exp.consumables.herb_kit||0)>0){try{exp.useConsumable('herb_kit');}catch(e){}}
      if(CE && CE.rage>=CE.rageMax && ens.filter(m=>D(m,p)<220).length>=2){try{CE.tryUltimate();}catch(e){}}
      if(ticks%180===0&&ticks>0){if(Math.hypot(p.x-lastX,p.y-lastY)<8&&!exp.extracting)sign*=-1; lastX=p.x;lastY=p.y;}
      window.__vNow+=TICK; exp.update(1/60);
      if(exp.result){ticks++;break;}
      if(ticks%30===0) await sleep(0);
    }
    const rec={ result:exp.result||'timeout', duration:+(CONFIG.expedition.demoDuration-exp.timeLeft).toFixed(1),
      kills:exp.killCount||0, goldBag:(exp.bag||[]).filter(i=>i.type==='gold').reduce((s,i)=>s+i.amount,0),
      herbsLeft:exp.consumables?exp.consumables.herb_kit||0:0 };
    try{Game.returnToFarm();}catch(e){}
    return rec;
  }

  // ========== 账号 A：纯远征零农场（弱配装，死亡免费补发武器=宽松口径） ==========
  const CFG_A={uid:'eco',herbs:2,thorn:1,flares:0,skillsAll:false,charLv:10};
  resetAccount(CFG_A);
  const log = [];
  let recraftCount = 0;

  for(let i=1;i<=N;i++){
    let inst=LoadoutSystem.getWeaponInstance('eco');
    if(!inst){
      const goldBefore=GS.gold;
      try{ LoadoutSystem.craftWeapon('harvest_sickle'); }catch(e){}
      inst=LoadoutSystem.getWeaponInstance('eco');
      if(!inst){
        GS.weaponInstances.push({uid:'eco',weaponId:'harvest_sickle',level:0});
        GS.forgedWeapons.push('harvest_sickle');
      }
      GS.loadoutWeaponUids=['eco'];
      recraftCount++;
    }
    const beforeLv=LoadoutSystem.getWeaponInstance('eco').level;
    const tier=tierForLevel(beforeLv);
    const run=await runOnce(tier, CFG_A);
    const upr=tryUpgrades('eco');
    const after=LoadoutSystem.getWeaponInstance('eco');
    const mats=GS.warehouse.materials||{};
    log.push({ run:i, tier, result:run.result, duration:run.duration, kills:run.kills,
      goldRun:run.goldBag, goldAfter:Math.floor(GS.gold),
      weaponLv:beforeLv, upgrades:upr.ups, lvAfter:after?after.level:beforeLv,
      recrafted:recraftCount, herbsLeft:run.herbsLeft,
      iron:mats.iron||0, crystal:mats.crystal||0, bossFang:mats.bossFang||0,
      wood:mats.wood||0,
      blocker:upr.blocker });
    if(after && after.level>=10) break;
  }
  const finalA=LoadoutSystem.getWeaponInstance('eco');
  const A={ runs:log, finalLevel:finalA?finalA.level:0, recraftCount,
    successRuns:log.filter(l=>l.result==='success').length,
    gold:Math.floor(GS.gold), materials:GS.warehouse.materials||{} };

  // ========== 账号 B：双线（每局间结算一个农场周期；死亡按真实费用重铸；配装随武器等级成长，隔离战斗变量） ==========
  const CFG_B={uid:'dual',herbs:99,thorn:999,flares:10,skillsAll:true,charLv:10};
  resetAccount(CFG_B);
  const logB=[]; let resetsB=0; let stuckB=null;
  const farmAcc={gold:0,goldGranted:0,mats:{},cycles:0};
  function farmCycle(lv){
    const stage=lv<=2?'early':(lv<=5?'mid':'late');
    const pkg=FARM[stage];
    farmAcc.gold+=pkg.gold;
    const g=Math.floor(farmAcc.gold);
    if(g>farmAcc.goldGranted){ GS.gold+=g-farmAcc.goldGranted; farmAcc.goldGranted=g; }
    for(const [m,v] of Object.entries(pkg.materials)){
      farmAcc.mats[m]=(farmAcc.mats[m]||0)+v;
      GS.warehouse.materials[m]=Math.floor(farmAcc.mats[m]);
    }
    farmAcc.cycles++;
  }
  for(let i=1;i<=N;i++){
    let inst=LoadoutSystem.getWeaponInstance('dual');
    if(!inst){
      // 死亡后武器被回收：按真实费用重铸（100 金 + 3 木 + 2 铁）
      try{ LoadoutSystem.craftWeapon('harvest_sickle'); }catch(e){}
      const any=(GS.weaponInstances||[]).filter(w=>w.weaponId==='harvest_sickle').pop();
      if(any){ any.uid='dual'; GS.loadoutWeaponUids=['dual']; resetsB++; }
      else { stuckB='重铸失败（金币/木材/铁不足），成长中断'; break; }
    }
    const beforeLv=LoadoutSystem.getWeaponInstance('dual').level;
    const tier=tierForLevel(beforeLv);
    farmCycle(beforeLv);
    let run;
    try{ run=await runOnce(tier, CFG_B); }catch(e){ stuckB='run-error:'+e.message; break; }
    const upr=tryUpgrades('dual');
    const after=LoadoutSystem.getWeaponInstance('dual');
    logB.push({ run:i, tier, result:run.result, duration:run.duration, kills:run.kills,
      goldRun:run.goldBag, lvBefore:beforeLv, upgrades:upr.ups,
      lvAfter:after?after.level:null, blocker:upr.blocker });
    if(after&&after.level>=10) break;
  }
  const finalB=LoadoutSystem.getWeaponInstance('dual');
  const B={ runs:logB, finalLevel:finalB?finalB.level:0, resets:resetsB, farmCycles:farmAcc.cycles,
    successRuns:logB.filter(l=>l.result==='success').length,
    totalRuns:logB.length,
    gold:Math.floor(GS.gold), materials:GS.warehouse.materials||{}, stuck:stuckB };

  return { A, B };
})(${nRuns}, ${farmJson})`;
}

// ---------- 浏览器 ----------
async function launchBrowser() {
  if (process.env.PW_EXECUTABLE_PATH) return chromium.launch({ headless: true, executablePath: process.env.PW_EXECUTABLE_PATH });
  try { return await chromium.launch({ headless: true }); }
  catch (e) {
    const fb = FALLBACK_CHROME.find(p => fs.existsSync(p));
    if (!fb) throw e;
    console.log(`Playwright Chromium 不可用，改用系统 Chrome：${fb}`);
    return chromium.launch({ headless: true, executablePath: fb });
  }
}

async function withPage(fn) {
  const browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.setDefaultTimeout(600000);
  const pageErrors = [];
  page.on('pageerror', e => {
    const msg = String(e.message || e);
    if (/favicon|getImageData|SecurityError|file:/i.test(msg)) return; // file:// 噪声
    pageErrors.push(msg);
  });
  // 虚拟时钟 + 屏蔽渲染/音频（注入在页面脚本之前，时钟从真实 now 起步）
  await page.addInitScript(`
    window.__vNow = performance.now();
    performance.now = () => window.__vNow;
    Date.now = () => Math.floor(window.__vNow);
    window.__vClock = true;
    let __r=0; window.requestAnimationFrame=cb=>{__r++;return __r;}; window.cancelAnimationFrame=()=>{};
    try { window.showToast=function(){}; } catch(e){}
  `);
  await page.goto(INDEX);
  await page.waitForFunction(() => typeof Game !== 'undefined' && typeof Expedition !== 'undefined' && typeof CONFIG !== 'undefined' && window.V5, { timeout: 30000 });
  // 屏蔽音频/粒子/HUD
  await page.evaluate(() => {
    try {
      let o = AudioManager, seen = new Set();
      while (o && o !== Object.prototype && !seen.has(o)) {
        seen.add(o);
        Object.getOwnPropertyNames(o).forEach(k => { try { if (typeof o[k] === 'function') o[k] = function () {}; } catch (e) {} });
        o = Object.getPrototypeOf(o);
      }
      AudioManager.ctx = { state: 'running', resume() { return Promise.resolve(); } };
    } catch (e) {}
    try { ['init','render','clear','resize','stop','start','setQuality'].forEach(m => { try { PixiEffects[m] = function () {}; } catch (e) {} }); } catch (e) {}
    try { Telemetry.silent = true; } catch (e) {}
  });
  try {
    const r = await fn(page);
    await context.close(); await browser.close();
    return { result: r, pageErrors };
  } catch (e) {
    await context.close(); await browser.close();
    throw e;
  }
}

async function runBatches(specs, batch) {
  const all = [];
  let pageErrors = [];
  for (let i = 0; i < specs.length; i += batch) {
    const chunk = specs.slice(i, i + batch);
    const { result, pageErrors: pe } = await withPage(page => page.evaluate(new Function('return ' + botSource(JSON.stringify(chunk)))));
    all.push(...result);
    pageErrors = pageErrors.concat(pe);
    process.stdout.write(`\r进度 ${Math.min(i + batch, specs.length)}/${specs.length}　`);
  }
  process.stdout.write('\n');
  return { runs: all, pageErrors };
}

function buildFarmPackages() {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'game_data.json'), 'utf8'));
  const crops = {}; (data.crops || []).forEach(c => crops[c.id] = c);
  const cm = data.cropMaterials || {};
  const mixes = {
    early: { cactus: 28, watermelon: 12, pea_shooter: 8 },
    mid: { lightning_vine: 24, frost_flower: 24 },
    late: { ginseng: 12, lightning_vine: 18, frost_flower: 18 },
  };
  const out = {};
  for (const [stage, mix] of Object.entries(mixes)) {
    const mats = {}; let gold = 0, grow = 0, plots = 0;
    for (const [id, n] of Object.entries(mix)) {
      const c = crops[id]; if (!c) continue;
      plots += n; grow = Math.max(grow, c.growTime || 0);
      gold += n * ((c.sellPrice || 0) - (c.seedPrice || 0));
      for (const row of (cm[id] || [])) { const [mat, prob, qty] = row; mats[mat] = +(mats[mat] || 0) + n * prob * (qty || 1); }
    }
    out[stage] = { plots, growSec: grow, gold: +gold.toFixed(1), mix,
      materials: Object.fromEntries(Object.entries(mats).map(([k, v]) => [k, +v.toFixed(2)])) };
  }
  return out;
}

async function runEconomy(n) {
  const farm = buildFarmPackages();
  const { result, pageErrors } = await withPage(page => page.evaluate(new Function('return ' + economySource(n, JSON.stringify(farm)))));
  result.farm = farm;
  result.pageErrors = pageErrors;
  fs.writeFileSync(ECON_JSON, JSON.stringify(result, null, 2), 'utf8');
  fs.writeFileSync(ECON_MD, buildEconomyMarkdown(result), 'utf8');
  return result;
}

// ---------- 聚合 ----------
function summarize(runs) {
  const valid = runs.filter(r => r.result !== 'timeout' && r.result !== 'error');
  const succ = runs.filter(r => r.success);
  const timeouts = runs.filter(r => r.result === 'timeout').length;
  const errors = runs.filter(r => r.result === 'error').length;
  const w = wilson(succ.length, valid.length);
  return {
    total: runs.length, valid: valid.length, success: succ.length, timeouts, errors,
    rate: w,
    avgDuration: +mean(valid.map(r => r.durationSec)).toFixed(1),
    avgKills: +mean(valid.map(r => r.kills)).toFixed(1),
    avgGold: Math.round(mean(succ.map(r => r.goldBag))),
  };
}
function group(runs, key, val) { return runs.filter(r => r[key] === val); }
function rateTable(runs, key, vals) {
  const rows = [];
  for (const v of vals) {
    const g = group(runs, key, v);
    const valid = g.filter(r => r.result !== 'timeout' && r.result !== 'error');
    const k = valid.filter(r => r.success).length;
    rows.push({ key: v, n: valid.length, k, w: wilson(k, valid.length), timeouts: g.filter(r => r.result === 'timeout').length });
  }
  return rows;
}

function buildReport(runs, opts) {
  const { label, lever, previous, pageErrors } = opts;
  const summary = summarize(runs);
  const byDiff = rateTable(runs, 'difficulty', DIFFS.map(d => d.id));
  const byTier = rateTable(runs, 'tier', [1, 2, 3, 4]);
  const byProfile = rateTable(runs, 'profile', PROFILES.filter(pr => runs.some(r => r.profile === pr)));

  // 画像 × Tier 矩阵
  const matrix = {};
  for (const pr of PROFILES) {
    matrix[pr] = {};
    for (let t = 1; t <= 4; t++) {
      const g = runs.filter(r => r.profile === pr && r.tier === t);
      const valid = g.filter(r => r.result !== 'timeout' && r.result !== 'error');
      matrix[pr][t] = wilson(valid.filter(r => r.success).length, valid.length);
      matrix[pr][t].n = valid.length;
    }
  }

  // 相邻难度两比例 z 检验（同画像 × Tier）
  const sigTests = [];
  for (const pr of PROFILES.filter(x => runs.some(r => r.profile === x))) {
    for (let t = 1; t <= 4; t++) {
      for (let di = 0; di < DIFFS.length - 1; di++) {
        const a = runs.filter(r => r.profile === pr && r.tier === t && r.difficulty === DIFFS[di].id && r.result !== 'timeout' && r.result !== 'error');
        const b = runs.filter(r => r.profile === pr && r.tier === t && r.difficulty === DIFFS[di + 1].id && r.result !== 'timeout' && r.result !== 'error');
        const z = twoProp(a.filter(r => r.success).length, a.length, b.filter(r => r.success).length, b.length);
        if (z.p != null) sigTests.push({ profile: pr, tier: t, a: DIFFS[di].id, b: DIFFS[di + 1].id, ...z });
      }
    }
  }

  // 休闲倒挂：baseline 休闲显著低于普通且 Δ<-8pp
  let inversion = null;
  {
    const ca = runs.filter(r => r.profile === 'baseline' && r.difficulty === 'casual' && r.result !== 'timeout' && r.result !== 'error');
    const no = runs.filter(r => r.profile === 'baseline' && r.difficulty === 'normal' && r.result !== 'timeout' && r.result !== 'error');
    const z = twoProp(ca.filter(r => r.success).length, ca.length, no.filter(r => r.success).length, no.length);
    if (z.p != null) inversion = { z: +z.z.toFixed(2), p: +z.p.toFixed(3), delta: +(z.delta * 100).toFixed(1), confirmed: z.sig && z.delta < -0.08 };
  }

  // Boss 统计（bosshunter）
  const bh = runs.filter(r => r.profile === 'bosshunter');
  const bossStats = {};
  for (let t = 1; t <= 4; t++) {
    const g = bh.filter(r => r.tier === t);
    const valid = g.filter(r => r.result !== 'error');
    const engaged = valid.filter(r => r.bossEngaged);
    const killed = valid.filter(r => r.bossKilled);
    const ttks = engaged.filter(r => r.bossTtkSec != null).map(r => r.bossTtkSec);
    bossStats['T' + t] = {
      runs: valid.length,
      engaged: engaged.length, engageRate: wilson(engaged.length, valid.length),
      killed: killed.length, killRate: wilson(killed.length, valid.length),
      ttkAvg: +mean(ttks).toFixed(1), ttkN: ttks.length,
    };
  }

  // 按 Boss 个体聚合（bosshunter，r.bossId）
  const bossById = {};
  for (const r of bh) {
    if (r.result === 'error' || !r.bossId) continue;
    const k = r.bossId;
    if (!bossById[k]) bossById[k] = { bossId: k, runs: 0, engaged: 0, killed: 0, ttk: [], maps: new Set() };
    const b = bossById[k];
    b.runs++;
    if (r.mapName) b.maps.add(r.mapName);
    if (r.bossEngaged) b.engaged++;
    if (r.bossKilled) { b.killed++; if (r.bossTtkSec != null) b.ttk.push(r.bossTtkSec); }
  }
  Object.values(bossById).forEach(b => {
    b.engageRate = wilson(b.engaged, b.runs);
    b.killRate = wilson(b.killed, b.runs);
    b.ttkAvg = b.ttk.length ? +mean(b.ttk).toFixed(1) : null;
    b.maps = [...b.maps];
  });

  // 任务目标完成率（hunt/scavenge/tower）
  const objAgg = {};
  runs.filter(r => r.objectiveType && r.result !== 'error' && r.profile === 'bosshunter').forEach(r => {
    const k = r.objectiveType;
    objAgg[k] = objAgg[k] || { type: k, n: 0, done: 0 };
    objAgg[k].n++; if (r.objectiveComplete) objAgg[k].done++;
  });
  Object.values(objAgg).forEach(o => { o.rate = wilson(o.done, o.n); });

  // frugal：无药而亡
  const frugalRuns = runs.filter(r => r.profile === 'frugal' && r.result !== 'error' && r.result !== 'timeout');
  const frugal = {
    runs: frugalRuns.length,
    noHerbDeaths: frugalRuns.filter(r => r.noHerbDeath).length,
    noHerbRate: wilson(frugalRuns.filter(r => r.noHerbDeath).length, frugalRuns.length),
    successRate: wilson(frugalRuns.filter(r => r.success).length, frugalRuns.length),
  };

  // greedy：贪婪曲线
  const greedyRuns = runs.filter(r => r.profile === 'greedy' && r.result !== 'error' && r.result !== 'timeout');
  const greedySucc = greedyRuns.filter(r => r.success);
  const greedy = {
    runs: greedyRuns.length,
    successRate: wilson(greedySucc.length, greedyRuns.length),
    avgDuration: +mean(greedySucc.map(r => r.durationSec)).toFixed(1),
    avgGold: Math.round(mean(greedySucc.map(r => r.goldBag))),
    avgChests: +mean(greedySucc.map(r => r.chests)).toFixed(1),
  };

  // 死因
  const deathReasons = {};
  runs.filter(r => r.deathReason).forEach(r => {
    const k = (r.deathReason || '?') + '｜' + (r.deathBy || '?');
    deathReasons[k] = (deathReasons[k] || 0) + 1;
  });

  // 系统使用率
  const validRuns = runs.filter(r => r.result !== 'error');
  const systems = {
    signal: { used: validRuns.filter(r => r.signalUsed > 0).length, rate: wilson(validRuns.filter(r => r.signalUsed > 0).length, validRuns.length) },
    ultimate: { perRun: +mean(validRuns.map(r => r.ultUsed || 0)).toFixed(2) },
    execute: { perRun: +mean(validRuns.map(r => r.execUsed || 0)).toFixed(2) },
    branch: { perRun: +mean(validRuns.map(r => r.branchCount || 0)).toFixed(2) },
  };

  return {
    meta: {
      generatedAt: new Date().toISOString(), label, lever: lever || null,
      cohorts: ['oncurve', 'baseline', 'bosshunter', 'frugal', 'greedy'],
      version: require('../package.json').version,
      previous: previous ? { label: previous.meta ? previous.meta.label : null, generatedAt: previous.meta ? previous.meta.generatedAt : null, byDiff: previous.byDiff, byTier: previous.byTier, summary: previous.summary } : null,
    },
    summary, byDiff, byTier, byProfile, matrix, sigTests, inversion,
    bossStats, bossById, objAgg, frugal, greedy, deathReasons, systems,
    pageErrors: pageErrors.slice(0, 20),
    runs,
  };
}

// ---------- Markdown ----------
function mdTable(headers, rows) {
  let s = '| ' + headers.join(' | ') + ' |\n';
  s += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
  for (const r of rows) s += '| ' + r.join(' | ') + ' |\n';
  return s + '\n';
}
function diffName(id) { return (DIFFS.find(d => d.id === id) || {}).name || id; }

function buildMarkdown(rep) {
  const L = [];
  const m = rep.meta;
  L.push(`# 平衡跑批报告（${m.label}）`);
  L.push('');
  L.push(`生成时间：${m.generatedAt}　游戏版本：v${m.version}　样本：${rep.summary.total} 局（有效 ${rep.summary.valid}，超时 ${rep.summary.timeouts}，错误 ${rep.summary.errors}）`);
  if (m.lever) L.push(`**本轮杠杆**：${m.lever}`);
  L.push('');
  L.push('方法学：Playwright 无头加载真实游戏（file://），固定 1/60s 步长 + 虚拟时钟；5 个画像（满级配装 / 新手 / 寻 Boss / 有限补给 / 贪财）；比例区间为 Wilson 95% CI；相邻难度差异用两比例 z 检验，p≥0.05 标"**噪声**"。');
  L.push('');

  // 1 概览
  L.push('## 1. 总览');
  L.push('');
  L.push(`- 全队列撤离率：**${ciStr(rep.summary.rate)}**`);
  L.push(`- 平均单局时长：**${rep.summary.avgDuration}s**（目标带 120–260s）`);
  L.push(`- 场均击杀：${rep.summary.avgKills}；成功局场均带出金币：${rep.summary.avgGold}`);
  L.push(`- 信号弹撤离使用率：${pct(rep.systems.signal.rate.rate)}；场均大招 ${rep.systems.ultimate.perRun} 次、处决 ${rep.systems.execute.perRun} 次、岔路 ${rep.systems.branch.perRun} 次`);
  L.push('');

  // 2 难度
  L.push('## 2. 难度梯度（含 95% CI）');
  L.push('');
  L.push(mdTable(['难度', '样本', '撤离', '撤离率 [95% CI]', '超时'],
    rep.byDiff.map(r => [diffName(r.key), r.n, r.k, ciStr(r.w), r.timeouts])));

  // 3 Tier
  L.push('## 3. Tier 梯度');
  L.push('');
  L.push(mdTable(['Tier', '样本', '撤离', '撤离率 [95% CI]', '超时'],
    rep.byTier.map(r => ['T' + r.key, r.n, r.k, ciStr(r.w), r.timeouts])));

  // 4 画像 × Tier
  L.push('## 4. 画像 × Tier 撤离率');
  L.push('');
  const profNames = { oncurve: '满级配装', baseline: '新手', bosshunter: '寻 Boss', frugal: '有限补给', greedy: '贪财' };
  L.push(mdTable(['画像', 'T1', 'T2', 'T3', 'T4'],
    Object.keys(rep.matrix).map(pr => [profNames[pr] || pr, 1, 2, 3, 4].map((x, i) => i === 0 ? x : `${pct(rep.matrix[pr][x].rate)} (n=${rep.matrix[pr][x].n})`))));

  // 5 显著性
  L.push('## 5. 相邻难度显著性检验（两比例 z）');
  L.push('');
  const sigRows = [];
  for (const t of rep.sigTests) {
    if (t.p == null) continue;
    sigRows.push([profNames[t.profile] || t.profile, 'T' + t.tier, `${diffName(t.a)}→${diffName(t.b)}`,
      (t.delta * 100).toFixed(1) + 'pp', t.p.toFixed(3), t.sig ? '显著' : '**噪声**']);
  }
  L.push(mdTable(['画像', 'Tier', '对比', '撤离率差', 'p 值', '结论'], sigRows));
  if (rep.inversion) {
    L.push(`**休闲倒挂检查（baseline 休闲 vs 普通）**：Δ=${rep.inversion.delta}pp，z=${rep.inversion.z}，p=${rep.inversion.p} → ${rep.inversion.confirmed ? '⚠️ 确认倒挂（显著且差 >8pp），需排查休闲难度奖励/刷怪逻辑' : '未达到倒挂确认标准'}`);
    L.push('');
  }

  // 6 Boss
  L.push('## 6. 寻 Boss 画像：12 Boss 交战 / 击杀 / TTK');
  L.push('');
  L.push(mdTable(['Tier', '局数', '交战率', '击杀率', 'TTK 均值(s)'],
    Object.keys(rep.bossStats).map(k => {
      const b = rep.bossStats[k];
      return [k, b.runs, `${pct(b.engageRate.rate)} (n=${b.engaged})`, `${pct(b.killRate.rate)} (n=${b.killed})`, b.ttkN ? b.ttkAvg : '—'];
    })));

  // 6b 12 Boss 个体
  const bossRows = Object.values(rep.bossById).sort((a, b) => a.bossId.localeCompare(b.bossId)).map(b =>
    [b.bossId, b.maps[0] || '—', b.runs, `${pct(b.engageRate.rate)} [${pct(b.engageRate.lo)}-${pct(b.engageRate.hi)}]`,
     `${pct(b.killRate.rate)} [${pct(b.killRate.lo)}-${pct(b.killRate.hi)}]`, b.ttkAvg != null ? b.ttkAvg : '—']);
  L.push(mdTable(['Boss', '代表地图', '局数', '交战率 [95% CI]', '击杀率 [95% CI]', 'TTK 均值(s)'], bossRows));
  const objRows = Object.values(rep.objAgg).map(o => [o.type, o.n, o.done, pct(o.rate.rate)]);
  if (objRows.length) {
    L.push('### 任务目标完成率（寻 Boss 画像单画像口径；其余画像不执行该目标）');
    L.push('');
    L.push(mdTable(['目标类型', '局数', '完成', '完成率'], objRows));
  }

  // 7 frugal / greedy
  L.push('## 7. 补给压力与贪婪曲线');
  L.push('');
  L.push(`- **有限补给（3 草药）**：${frugalN(rep)}`);
  L.push(`- **贪财画像**：撤离率 ${ciStr(rep.greedy.successRate)}，成功局平均 ${rep.greedy.avgDuration}s 撤离、场均 ${rep.greedy.avgChests} 宝箱、带出 ${rep.greedy.avgGold} 金`);
  L.push('');

  // 8 死因
  L.push('## 8. 死因分布');
  L.push('');
  const dr = Object.keys(rep.deathReasons).sort((a, b) => rep.deathReasons[b] - rep.deathReasons[a]);
  L.push(mdTable(['死因（类型｜来源）', '次数'], dr.map(k => [k, rep.deathReasons[k]])));

  // 9 checks / findings
  L.push('## 9. 自动检查');
  L.push('');
  const checks = [];
  const s = rep.summary;
  checks.push(['超时率 ≤2%', s.timeouts / Math.max(1, s.total) <= 0.02, `${s.timeouts}/${s.total}`]);
  const oc = rateOf(rep.runs.filter(r => r.profile === 'oncurve'), r => r.success);
  checks.push(['on-curve 全队列撤离率 70–95%（>95% 偏简单）', oc.rate >= 0.7 && oc.rate <= 0.95, ciStr(oc)]);
  const bl = rateOf(rep.runs.filter(r => r.profile === 'baseline'), r => r.success);
  checks.push(['baseline 全队列撤离率 40–80%', bl.rate >= 0.4 && bl.rate <= 0.8, ciStr(bl)]);
  checks.push(['平均单局 120–280s', s.avgDuration >= 120 && s.avgDuration <= 280, s.avgDuration + 's']);
  const t1 = rep.matrix.oncurve[1], t4 = rep.matrix.oncurve[4];
  checks.push(['T4 撤离率低于 T1（on-curve）', t4.rate <= t1.rate, `${pct(t1.rate)} → ${pct(t4.rate)}`]);
  const bossEng = Object.values(rep.bossStats).reduce((a, b) => a + b.engaged, 0);
  const bossRuns = Object.values(rep.bossStats).reduce((a, b) => a + b.runs, 0);
  checks.push(['寻 Boss 交战率 ≥60%', bossRuns ? bossEng / bossRuns >= 0.6 : false, `${bossEng}/${bossRuns}`]);
  L.push(mdTable(['检查项', '结果', '实测'], checks.map(c => [c[0], c[1] ? '✅' : '❌', c[2]])));

  // 10 版本对比
  if (m.previous) {
    L.push('## 10. 与上版本对比');
    L.push('');
    const prev = m.previous;
    const rows = [];
    for (const d of DIFFS) {
      const now = rep.byDiff.find(r => r.key === d.id);
      const old = (prev.byDiff || []).find(r => r.key === d.id);
      if (now && old) {
        const delta = +((now.k / Math.max(1, now.n) - old.k / Math.max(1, old.n)) * 100).toFixed(1);
        rows.push([diffName(d.id), pct(old.k / Math.max(1, old.n)), pct(now.k / Math.max(1, now.n)), (delta >= 0 ? '+' : '') + delta + 'pp']);
      }
    }
    L.push(`对比基线：${prev.label || '上版本'}（${(prev.generatedAt || '').slice(0, 16).replace('T', ' ')}）`);
    L.push('');
    L.push(mdTable(['难度', '上版本', '本版本', 'Δ'], rows));
  }

  if (rep.pageErrors && rep.pageErrors.length) {
    L.push('## 页面错误');
    L.push('');
    rep.pageErrors.slice(0, 10).forEach(e => L.push('- ' + e));
  }
  L.push('');
  return L.join('\n');
}
function frugalN(rep) {
  const f = rep.frugal;
  return `${f.runs} 局，撤离率 ${ciStr(f.successRate)}，无药而亡 ${f.noHerbDeaths} 局（${ciStr(f.noHerbRate)}）`;
}

function buildEconomyMarkdown(e) {
  const A = e.A, B = e.B, farm = e.farm;
  const L = [];
  L.push('# 经济闭环专项：武器 +10 所需撤离局数');
  L.push('');
  L.push('设计目标（v5.1）：一把武器从 0 升到 +10 应在 **5–8 次成功撤离** 内达成；升级总消耗金币 26100、铁块 338、晶核 76、Boss 獠牙 7（数据来源 LoadoutSystem.UPGRADE_COSTS）。v5.1 起铁/晶/獠牙只由农场作物产出，本专项分别模拟「纯远征零农场」与「农场+远征双线」两条路径。');
  L.push('');
  L.push('## 账号 A：纯远征、零农场（反证口径）');
  L.push('');
  L.push('口径：新号 200 金、0 级镰刃、2 草药/1 荆棘/0 信号弹、仅初始技能、1 格安全箱、空仓库；普通难度；局间继承；死亡后 bot 免费补发一把 0 级镰刃（**比真实规则宽松**——真实重铸需 100 金+3 木+2 铁，纯远征无法获得铁，实际只会更差）。');
  L.push('');
  L.push(`结果：连跑 ${A.runs.length} 档，成功撤离 **${A.successRuns}** 档，重铸 ${A.recraftCount} 次，最终武器 **Lv${A.finalLevel}**，剩余金币 ${A.gold}。`);
  L.push('');
  L.push('结论：纯远征路径下武器等级始终为 0（铁/晶/獠牙缺口无法弥合），且弱配装 T1 撤离率极低，形成"死亡→重铸→再死亡"负循环。');
  L.push('');
  L.push(mdTable(['#', 'Tier', '结果', '时长s', '击杀', '本局金', '升级数', 'Lv后', '重铸', '阻塞点'],
    A.runs.map(r => [r.run, 'T' + r.tier, r.result === 'success' ? '撤离' : r.result, r.duration, r.kills, r.goldRun, r.upgrades, r.lvAfter, r.recrafted ? '是' : '', r.blocker || '—'])));
  L.push('');
  L.push('## 账号 B：农场 + 远征双线（设计目标路径）');
  L.push('');
  L.push('口径：同一新号，**每局远征之间结算一个农场周期**（48 格全部收获一轮，期望产出见下表，按真实作物概率/售价/种子成本计算，不计品质加成）；配装随武器等级成长（角色等级=10+7×武器等级、全技能、充足补给），用于隔离战斗变量、专门测量经济可达性；死亡按真实规则损失武器，下一局前用真实费用重铸（等级归零，计 1 次重置）。');
  L.push('');
  const goalHit = B.finalLevel >= 10;
  L.push(`结果：连跑 ${B.totalRuns} 档，其中**成功撤离 ${B.successRuns} 档**，死亡重置 ${B.resets} 次，农场周期 ${B.farmCycles} 个，最终武器 **Lv${B.finalLevel}**${B.stuck ? '，中断原因：' + B.stuck : ''}。`);
  L.push('');
  if (goalHit) L.push(`判定：**满级当档成功撤离即计入**，达到 +10 时累计成功撤离 ${B.successRuns} 局，${B.successRuns >= 5 && B.successRuns <= 8 ? '落在 5–8 局目标带 ✅' : (B.successRuns < 5 ? '快于目标带（材料给得偏多，需复核农场周期口径）' : '**超出 5–8 局目标带 ❌，需上调远征金币/材料产出或下调升级消耗**')}。`);
  else L.push('判定：**30 档内未达到 +10 ❌**，经济曲线不达标。');
  L.push('');
  L.push(mdTable(['#', 'Tier', '结果', '时长s', '击杀', '本局金', '升级数', 'Lv后', '阻塞点'],
    B.runs.map(r => [r.run, 'T' + r.tier, r.result === 'success' ? '撤离' : r.result, r.duration, r.kills, r.goldRun, r.upgrades, r.lvAfter === null ? '武器丢失' : r.lvAfter, r.blocker || '—'])));
  L.push('');
  L.push('## 农场周期期望产出（每周期 = 48 格一轮收获）');
  L.push('');
  L.push('| 阶段（武器Lv） | 作物组合 | 生长秒数 | 净金币 | 期望材料 |');
  L.push('| --- | --- | --- | --- | --- |');
  const stageName = { early: '早期 Lv0–2', mid: '中期 Lv3–5', late: '后期 Lv6–9' };
  for (const k of ['early', 'mid', 'late']) {
    const p = farm[k];
    const mix = Object.entries(p.mix).map(([id, n]) => id + '×' + n).join('、');
    const mats = Object.entries(p.materials).map(([m, v]) => m + ' ' + v.toFixed(1)).join('、');
    L.push(`| ${stageName[k]} | ${mix} | ${p.growSec}s | ${p.gold} | ${mats} |`);
  }
  L.push('');
  L.push('> 注：材料为概率期望（如后期每周期期望獠牙 3 个，来自 12 株人参 25% 掉率）；人参/死亡帽为传说/史诗作物，默认温室与种子已解锁；未计作物品质加成与反复收获特性，口径偏保守。农场周期按"局间一次完整收获"折算，现实墙钟时间取决于生长秒数与温室等级。');
  L.push('');
  L.push('账号 B 终局材料库存：' + JSON.stringify(B.materials));
  L.push('');
  return L.join('\n');
}
function archive(label, json) {
  if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
  const f = path.join(HISTORY_DIR, `balance-${label}-${stamp()}.json`);
  fs.writeFileSync(f, JSON.stringify(json, null, 2), 'utf8');
  return f;
}
function findPrevious(label) {
  if (!fs.existsSync(HISTORY_DIR)) return null;
  const files = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith('.json')).sort();
  const want = /lever/.test(label) ? 'balance-core' : 'balance-' + label.split('-')[0];
  const matches = files.filter(f => f.startsWith(want) || f.startsWith('balance-core') || f.startsWith('balance-nightly'));
  for (let i = matches.length - 1; i >= 0; i--) {
    try { return JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, matches[i]), 'utf8')); } catch (e) {}
  }
  // 兜底：当前 tools/balance-report.json
  if (fs.existsSync(REPORT_JSON)) { try { return JSON.parse(fs.readFileSync(REPORT_JSON, 'utf8')); } catch (e) {} }
  return null;
}

// ---------- 主入口 ----------
(async function main() {
  // 经济专项
  if (arg('economy', null)) {
    const n = parseInt(arg('economy', '30'), 10);
    console.log(`经济闭环专项：新号连跑 ${n} 档…`);
    const t0 = Date.now();
    const e = await runEconomy(n);
    console.log(`完成，耗时 ${Math.round((Date.now() - t0) / 1000)}s：A 纯远征 Lv${e.A.finalLevel}（撤离 ${e.A.successRuns}/${e.A.runs.length}）｜B 双线 Lv${e.B.finalLevel}（成功撤离 ${e.B.successRuns}/${e.B.totalRuns}，重置 ${e.B.resets}）`);
    console.log(`报表：${ECON_MD}`);
    if (e.pageErrors && e.pageErrors.length) console.log('pageErrors:', e.pageErrors.slice(0, 5));
    process.exit(e.A.runs.length ? 0 : 1);
  }

  const { specs, label } = buildSpecs();
  const leverDesc = (specs.some(s => s.leverSpeed !== 1) || specs.some(s => s.leverMelee != null))
    ? `移速×${specs[0]?.leverSpeed || 1}` + (specs.some(s => s.leverMelee != null) ? `，近战比例 ${specs.find(s => s.leverMelee != null)?.leverMelee}` : '')
    : null;
  console.log(`跑批规格：${specs.length} 局｜标签 ${label}｜画像 ${[...new Set(specs.map(s => s.profile))].join(',')}${leverDesc ? '｜杠杆 ' + leverDesc : ''}`);
  const t0 = Date.now();
  const batch = parseInt(arg('batch', '5'), 10);
  const { runs, pageErrors } = await runBatches(specs, batch);
  const previous = findPrevious(label);
  const rep = buildReport(runs, { label, lever: leverDesc, previous, pageErrors });

  fs.writeFileSync(REPORT_JSON, JSON.stringify(rep, null, 2), 'utf8');
  fs.writeFileSync(REPORT_MD, buildMarkdown(rep), 'utf8');
  const archived = archive(label, rep);

  const s = rep.summary;
  console.log(`耗时 ${Math.round((Date.now() - t0) / 1000)}s，pageErrors=${pageErrors.length}`);
  console.log(`有效 ${s.valid}｜超时 ${s.timeouts}｜错误 ${s.errors}｜撤离率 ${ciStr(s.rate)}｜平均 ${s.avgDuration}s`);

  // 控制台检查
  const fails = [];
  if (pageErrors.length) fails.push(`${pageErrors.length} 局异常`);
  if (s.timeouts / Math.max(1, s.total) > 0.02) fails.push(`超时率超标 ${s.timeouts}/${s.total}`);
  const oc = rateOf(runs.filter(r => r.profile === 'oncurve'), r => r.success);
  if (oc.n && (oc.rate < 0.7 || oc.rate > 0.95)) fails.push(`on-curve 撤离率 ${pct(oc.rate)} 超出 70–95%`);
  const bl = rateOf(runs.filter(r => r.profile === 'baseline'), r => r.success);
  if (bl.n && (bl.rate < 0.4 || bl.rate > 0.8)) fails.push(`baseline 撤离率 ${pct(bl.rate)} 超出 40–80%`);
  if (s.valid && (s.avgDuration < 120 || s.avgDuration > 280)) fails.push(`平均时长 ${s.avgDuration}s 超出 120–280s`);
  if (rep.inversion && rep.inversion.confirmed) fails.push(`休闲倒挂 Δ=${rep.inversion.delta}pp p=${rep.inversion.p}`);
  if (fails.length) {
    console.log('未过检查：');
    fails.forEach(f => console.log('  ❌ ' + f));
  } else console.log('全部检查通过 ✅');
  console.log(`报表：${REPORT_MD}`);
  console.log(`归档：${archived}`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
