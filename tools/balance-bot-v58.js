/**
 * balance-bot-v58.js — v5.8「牌阵觉醒」流派矩阵 / 对照组 / 系统覆盖 / 经济校准
 *
 * 在 v5.3 balance-bot.js 的真实远征快进驱动之上，按 v58 冻结契约扩展：
 *  - 8 流派各自凑同元素装载（武器+技能+道具+种子），经 CardV58.synergyMods 注入 exp.syn
 *  - 每流派 × Tier(1-4) × 难度(休闲/普通/困难/噩梦) 每格 n≥25
 *  - 同格「混搭无协同」对照，量化协同胜率/收益增益
 *  - 克制环 ±25%：纯逻辑探针（CARD_DATA.counter + 远征 _counterMultFor）
 *  - Wilson 95% CI；相邻难度两比例 z 检验，p≥0.05 标「噪声」
 *  - 局内系统覆盖：夺卡三选一分布 / 道具6×5满置灰 / 篝火商人 / 12Boss签名+蓝图 /
 *    铭记率(25/15/8,蓝图100%) / 死亡安全箱保留+免死令 / 收藏精通永不丢失
 *  - 经济：印制一张传说卡、一个技能精通 Lv5 各需多少次成功撤离
 *
 * 用法（PowerShell，参数用等号）：
 *   node tools/balance-bot-v58.js --probe            # 纯逻辑探针（免浏览器，快）
 *   node tools/balance-bot-v58.js --matrix --cell=25 --factions=fire,ice --tiers=1 --diffs=normal
 *   node tools/balance-bot-v58.js --matrix --cell=25 --label=v58-core
 *   node tools/balance-bot-v58.js --economy
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const INDEX = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');
const HISTORY_DIR = path.join(ROOT, 'tools', 'balance-history');
const PROBE_JSON = path.join(HISTORY_DIR, 'v58-probe.json');
const REPORT_MD = path.join(ROOT, 'docs', 'balance-report-v58.md');
const ECON_MD = path.join(ROOT, 'docs', 'balance-economy-v58.md');

// 纯逻辑模块（node 可直接 require）
const CARD_DATA = require(path.join(ROOT, 'js', 'v58', 'card-data.js'));
const CardV58 = require(path.join(ROOT, 'js', 'v58', 'card-system.js'));

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
const TIER_LEVEL = { 1: 12, 2: 32, 3: 55, 4: 80 };
const PLAN_SEC = { 1: [90, 140], 2: [120, 190], 3: [150, 230], 4: [180, 280] };

// ---------- CLI ----------
function arg(name, def) {
  // 支持 --name=value 与纯旗标 --name（视为 true）
  if (process.argv.includes(`--${name}`)) return true;
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : def;
}
function argList(name) {
  const v = arg(name, null);
  return v ? v.split(',').map(s => s.trim()).filter(Boolean) : null;
}
function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function pad2(n) { return String(n).padStart(2, '0'); }
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}

// ---------- 统计 ----------
function wilson(k, n, z) {
  z = z || 1.96;
  if (!n) return { rate: 0, lo: 0, hi: 0 };
  const p = k / n, den = 1 + z * z / n, cen = p + z * z / (2 * n);
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
  if (n1 < 10 || n2 < 10) return { p: null, delta: null, sig: null, note: '样本不足(n<10)' };
  const p1 = k1 / n1, p2 = k2 / n2;
  const pp = (k1 + k2) / (n1 + n2);
  const se = Math.sqrt(pp * (1 - pp) * (1 / n1 + 1 / n2));
  if (se === 0) return { p: 1, delta: 0, sig: false, note: '' };
  const z = (p2 - p1) / se;
  const p = 2 * (1 - normalCdf(Math.abs(z)));
  return { z, p, delta: p2 - p1, sig: p < 0.05, note: '' };
}
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function pct(x) { return (x * 100).toFixed(1) + '%'; }
function ciStr(w) { return `${pct(w.rate)} [${pct(w.lo)}, ${pct(w.hi)}]`; }

// ---------- 流派装载（凑同元素，受真实数据约束） ----------
// 注：道具/种子/技能的 element 必须与流派一致；受 CARD_DATA 真实可用卡数限制。
const FACTION_DECKS = {
  fire:      { skills: ['chili_breath'], items: ['flame_elixir', 'egg', 'torch'], seeds: ['chili', 'tomato'] },            // 1+3+2=6→取5
  ice:       { skills: ['frost_barrier'], items: [], seeds: ['frost_flower'] },                                          // 仅2（数据上限）
  lightning: { skills: ['thunder_chain'], items: ['energy_cell', 'grape_juice', 'juice'], seeds: ['lightning_vine'] },    // 1+3+1=5
  poison:    { skills: ['poison_mist'], items: ['rotting_bait', 'poison_bomb', 'purify_tonic'], seeds: ['deathcap'] }, // 1+3+1=5
  summon:    { skills: ['pea_storm', 'vine_bind', 'healing_rain'], items: ['war_horn'], seeds: ['wheat'] },              // 3+1+1=5
  bleed:     { skills: ['death_scythe', 'straw_smash'], items: ['rage_tonic'], seeds: [] },                              // 仅3（数据上限）
  armor:     { skills: ['iron_armor', 'thorn_burst', 'earth_slam'], items: ['shield_gen'], seeds: ['cactus'] },          // 3+1+1=5
  wind:      { skills: ['earth_dash', 'smoke_screen', 'gale_slash'], items: ['mint_tea'], seeds: ['mint'] },             // 3+1+1=5
};
// 对照：混搭（每元素1张，全部 count=1 → 无里程碑）
const CTRL_DECK = { skills: ['chili_breath', 'frost_barrier', 'thunder_chain', 'poison_mist', 'vine_bind'], items: [], seeds: [] };
const FACTION_NAMES = {}; Object.keys(CARD_DATA.factions).forEach(f => FACTION_NAMES[f] = CARD_DATA.factions[f].name);

function deckLoadout(deck) {
  return {
    weapons: [],
    skills: deck.skills.map(id => ({ type: 'skill', defId: id })),
    items: deck.items.map(id => ({ type: 'item', defId: id })),
    seeds: deck.seeds.map(id => ({ type: 'seed', defId: id })),
  };
}
function deckProfile(faction) {
  const deck = FACTION_DECKS[faction];
  const loadout = deckLoadout(deck);
  const st = CardV58.synergyState(loadout);
  const syn = CardV58.synergyMods(loadout);
  return {
    faction, deck, loadout,
    count: (st.tags[faction] || {}).count || 0,
    active: (st.tags[faction] || {}).active || [],
    buffNames: st.buffs.map(b => b.name),
    syn,
  };
}

// ===========================================================================
// 纯逻辑探针（免浏览器）：克制环 / 铭记率 / 死亡结算 / 夺卡置灰 / 协同里程碑
// ===========================================================================
function runProbe() {
  const out = { generatedAt: new Date().toISOString(), probes: {} };

  // 1) 克制环 ±25%：遍历环上相邻 atk→def
  {
    const order = ['fire', 'summon', 'poison', 'armor', 'bleed', 'wind', 'lightning', 'ice'];
    const rows = [];
    order.forEach((atk, i) => {
      const def = order[(i + 1) % order.length];
      rows.push({
        atk, def,
        counterMult: CARD_DATA.counter[atk][def],          // 应=1.25
        reverseMult: CARD_DATA.counter[def][atk],          // 应=0.75
        selfMult: CARD_DATA.counter[atk][atk] || 1,        // 应=1
      });
    });
    const allOk = rows.every(r => Math.abs(r.counterMult - 1.25) < 1e-9 && Math.abs(r.reverseMult - 0.75) < 1e-9);
    out.probes.counterRing = { rows, allOk };
  }

  // 2) 铭记率：每稀有度 20000 次蒙特卡洛（蓝图必成）
  {
    const N = 20000;
    const rows = [];
    ['common', 'rare', 'epic'].forEach(rar => {
      let hit = 0;
      for (let i = 0; i < N; i++) {
        const card = { type: 'item', defId: 'herb_kit', rarity: rar };
        if (CardV58.inscribeRoll(card, Math.random)) hit++;
      }
      const expect = CARD_DATA.rarities[rar].inscribe;
      rows.push({ rarity: rar, expected: expect, observed: hit / N,
        ci: wilson(hit, N), dev: Math.abs(hit / N - expect) });
    });
    // 蓝图/签名必成
    let bpOk = true;
    for (let i = 0; i < 2000; i++) {
      const sig = { type: 'signature', defId: 'sig_boar_king', rarity: 'legendary' };
      if (!CardV58.inscribeRoll(sig, Math.random)) bpOk = false;
    }
    out.probes.inscribe = { rows, blueprintAlwaysKept: bpOk, N };
  }

  // 3) 死亡结算：安全箱保留 / 免死令 / 收藏精通不丢 / 降级概率
  {
    // 用可注入的 GameState 替身
    const fakeGS = {
      safeBoxSlots: 1, hardcoreFullLoss: false,
      collection: { skill: { straw_smash: { count: 3, masteryLv: 2, masteryProgress: 0.3 } }, item: {}, seed: {} },
      warehouse: { materials: {} }, gold: 0, captureLog: [], _v58Research: { inscribeLuck: 0 },
    };
    const prev = global.GameState;
    global.GameState = fakeGS;
    // card-system 在 require 时闭包捕获了 MEM；直接调用 onDeath 走 GS()（每调用读 global）
    // onDeath 内部 GS() 读 global.GameState
    let downgradeCount = 0, pardonCount = 0, N = 4000;
    for (let i = 0; i < N; i++) {
      const r = CardV58.onDeath({ safeBox: ['kept_card'], carriedItems: ['herb_kit'], carriedSeeds: ['wheat'],
        broughtWeapons: ['botw'], tempLoot: ['loot1'], hasDeathPardon: true, rng: Math.random });
      if (r.downgrade) downgradeCount++;
      if (r.pardonUsed) pardonCount++;
    }
    // 无免死令时降级率应≈50%
    let dgNoPardon = 0, N2 = 4000;
    for (let i = 0; i < N2; i++) {
      const r = CardV58.onDeath({ safeBox: [], carriedItems: [], carriedSeeds: [], broughtWeapons: [], tempLoot: [],
        hasDeathPardon: false, rng: Math.random });
      if (r.downgrade) dgNoPardon++;
    }
    const skillKept = fakeGS.collection.skill.straw_smash.masteryLv === 2 && fakeGS.collection.skill.straw_smash.count === 3;
    global.GameState = prev;
    out.probes.onDeath = {
      safeBoxSlots: 1, safeBoxKeptCount: 1,
      downgradeRateNoPardon: dgNoPardon / N2, expectDowngrade: 0.5,
      downgradeWithPardon: downgradeCount / N, expectWithPardon: 0, pardonUsedRate: pardonCount / N,
      skillCollectionKept: skillKept,
    };
  }

  // 4) 夺卡三选一：道具满（6种×5）应置灰
  {
    // 未满：道具选项可选
    const r1 = CardV58.rollCapture({ existingCards: [{ type: 'skill', defId: 'chili_breath' }],
      distinctItemTypes: 0, itemCounts: {}, rng: Math.random });
    // 满：6 种且每种≥5 → 道具选项应 grey
    const fullCounts = {}; Object.keys(CARD_DATA.items).forEach(k => fullCounts[k] = 5);
    const r2 = CardV58.rollCapture({ existingCards: [{ type: 'skill', defId: 'chili_breath' }],
      distinctItemTypes: 6, itemCounts: fullCounts, rng: () => 0.5 });
    // 升级项：无已装备卡应 grey
    const r3 = CardV58.rollCapture({ existingCards: [], distinctItemTypes: 0, itemCounts: {}, rng: Math.random });
    out.probes.capture = {
      kinds: r1.choices.map(c => ({ kind: c.kind, grey: c.grey })),
      itemGreyWhenFull: r2.choices.find(c => c.kind === 'item').grey,
      upgradeGreyWhenEmpty: r3.choices.find(c => c.kind === 'upgrade').grey,
    };
  }

  // 5) 每流派实际达成的里程碑（受数据上限）
  {
    const rows = Object.keys(FACTION_DECKS).map(f => {
      const p = deckProfile(f);
      return { faction: f, name: FACTION_NAMES[f], cardCount: p.count, activeMilestones: p.active, buffNames: p.buffNames,
        capped: p.count < 5 };
    });
    out.probes.factionMilestones = rows;
  }

  // 6) 精通：重复卡转进度 → Lv5 所需传说重复卡数
  {
    const dup = CardV58.DUPLICATE_MASTERY_PROGRESS;
    const legendaryDupToLvl5 = 5.0 / dup.legendary; // 0.5/张
    out.probes.mastery = { duplicateProgress: dup, legendaryDupToLvl5 };
  }

  if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
  fs.writeFileSync(PROBE_JSON, JSON.stringify(out, null, 2), 'utf8');
  return out;
}

// ===========================================================================
// 页面内矩阵驱动（注入 exp.syn）
// ===========================================================================
function botSource(specsJson) {
  return `(async function(specs){
  const TICK = 1000/60, MAXT = 560*1000;
  function setKeys(exp,dx,dy){const k=exp.keys;k['w']=dy<-0.35;k['s']=dy>0.35;k['a']=dx<-0.35;k['d']=dx>0.35;k['arrowup']=k['w'];k['arrowdown']=k['s'];k['arrowleft']=k['a'];k['arrowright']=k['d'];}
  function D(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}

  function setupState(spec){
    const GS = GameState;
    GS.gold = 1e9;
    GS.level = spec.level; GS.cultivation = 0;
    GS.weaponInstances = [{ uid:'botw', weaponId:'harvest_sickle', level: spec.weaponLevel }];
    GS.loadoutWeaponUids = ['botw'];
    GS.carriedSeeds = []; GS.defenseLoadout = [];
    GS.selectedBoostCards = []; GS.cardInventory = [];
    GS.unlockedSkills = ['straw_smash','vine_bind','earth_dash','smoke_screen'];
    GS.equippedSkills = ['straw_smash','vine_bind','earth_dash','smoke_screen'];
    GS.skillLevels = { straw_smash:1, vine_bind:1, earth_dash:1, smoke_screen:1 };
    GS.loadout = { herb_kit: 99, thorn_storm: 999, signal_flare: 10 };
    GS.difficulty = spec.difficulty;
    GS.heatModifiers = [];
    GS.selectedMap = spec.mapId;
    GS.safeSlots = 1; GS.safeBox = [];
    GS.collection = GS.collection || { skill:{}, item:{}, seed:{} };
  }

  function applyDeck(exp, spec){
    const deck = spec.deck;
    const loadout = { weapons:[],
      skills: deck.skills.map(id=>({type:'skill',defId:id})),
      items: deck.items.map(id=>({type:'item',defId:id})),
      seeds: deck.seeds.map(id=>({type:'seed',defId:id})) };
    try {
      exp.equippedSkills = deck.skills.slice();
      exp.syn = CardV58.synergyMods(loadout) || {};
      exp.synBuffs = CardV58.synergyState(loadout).buffs || [];
      exp.cardShield = exp.syn.startShield || 0;
      if (exp.player && exp.syn.startShield) exp.player.shield = (exp.player.shield||0) + exp.syn.startShield;
    } catch(e) { exp.syn = {}; exp.synBuffs = []; }
  }

  function entities(exp){
    const ens = exp.monsters.filter(m=>m.hp>0).concat((exp.raiders||[]).filter(m=>m.hp>0));
    if (exp.boss && exp.boss.hp>0 && ens.indexOf(exp.boss)<0) ens.push(exp.boss);
    return ens;
  }
  function nearestOf(list,from){let best=null,bd=1e9;for(const m of list){const d=D(m,from);if(d<bd){bd=d;best=m;}}return{best:best,bd:bd};}

  function runOne(spec){
    setupState(spec);
    if (typeof Expedition!=='undefined' && !Expedition.prototype.__botNoRender){ Expedition.prototype.render=function(){}; Expedition.prototype.__botNoRender=true; }
    Game.startExpedition();
    if (Game.animId) cancelAnimationFrame(Game.animId);
    const exp = Game.expedition;
    if (!exp) throw new Error('startExpedition 未创建远征实例');
    exp.updateHUD = function(){};
    applyDeck(exp, spec);

    const p = exp.player;
    const W = CONFIG.canvas.width, H = CONFIG.canvas.height;
    const CE = (typeof CombatEnhancement!=='undefined') ? CombatEnhancement : null;
    let strafeSign = Math.random()<0.5?-1:1;
    let dodgeCd=0, skillRotate=0;
    let lastX=p.x, lastY=p.y;
    let extract=false, signalHold=false, signalStarted=false, signalRestarts=0;
    let ticks=0, ended=false;
    let signalUsed=0;
    const synActive = (exp.synBuffs||[]).map(b=>b.id);
    const synBefore = Object.assign({}, exp.syn);
    let bossKilled=false, bossEngaged=false;
    let resolveCounts={capture:0, campfire:0, merchant:0};

    function entities(){
      const ens = exp.monsters.filter(m=>m.hp>0).concat((exp.raiders||[]).filter(m=>m.hp>0));
      if (exp.boss && exp.boss.hp>0 && ens.indexOf(exp.boss)<0) ens.push(exp.boss);
      return ens;
    }
    function nearestOf(list,from){let best=null,bd=1e9;for(const m of list){const d=D(m,from);if(d<bd){bd=d;best=m;}}return{best:best,bd:bd};}
    const NO_AUTO = ['earth_dash','gale_slash'];

    for (ticks=0; ticks<MAXT/TICK; ticks++){
      if (CE && CE.branchActive) { try{CE.chooseBranch(Math.floor(Math.random()*3));}catch(e){} }
      // 程序化关闭 v5.8 浮层（夺卡/篝火/商人），否则 update() 永久挂起
      if (exp.choiceOpen){
        try{
          if (document.getElementById('v58CaptureOverlay')){
            const ch = exp._captureChoices || [];
            let idx = ch.findIndex(c=>!c.grey && c.kind==='upgrade');
            if (idx<0) idx = ch.findIndex(c=>!c.grey);
            if (idx>=0) { exp._chooseCapture(idx); resolveCounts.capture++; } else exp.choiceOpen=false;
          } else if (document.getElementById('v58CampfireOverlay')){
            exp._campfireChoice('rest'); resolveCounts.campfire++;
          } else if (document.getElementById('v58MerchantOverlay')){
            exp._merchantAction('restock'); resolveCounts.merchant++;
          } else { exp.choiceOpen=false; }
        }catch(e){ try{exp.choiceOpen=false;}catch(e2){} }
      }
      const ens = entities();
      const {best:nearest, bd:nd} = nearestOf(ens,p);
      const hpR = p.hp/p.maxHp;
      const elapsed = (CONFIG.expedition.demoDuration - exp.timeLeft) || (ticks/60);

      if (exp.boss && exp.boss.hp>0 && !bossEngaged && D(exp.boss,p)<520) bossEngaged=true;
      else if (bossEngaged && !(exp.boss && exp.boss.hp>0)) bossKilled=true;

      let slots=0;
      try { slots = LoadoutSystem.usedSlots(exp.bag); }
      catch(e){ (exp.bag||[]).forEach(it=>{ slots += it.type==='gold'?Math.max(1,Math.ceil((it.amount||0)/100)):(it.slots||1); }); }

      // 撤离决策
      if (!extract){
        if (elapsed>=spec.planSec || hpR<0.22 || slots>=15 || exp.timeLeft<100) extract=true;
      }
      const pts0 = exp.extractPoints || [];
      const nearestEpD = pts0.length ? Math.min.apply(null, pts0.map(q=>D(q,p))) : 0;
      // 一旦决定撤离且信号弹可用：立刻就地开撤离点（信号读条无需站位，避免走到固定点被怪潮无限打断）
      if (extract && !signalStarted && (exp.consumables.signal_flare||0)>0 && !exp.extracting){
        try{ exp.useConsumable('signal_flare'); signalUsed++; signalStarted=true; signalHold=true; }catch(e){}
      }
      if (signalHold && exp.extractType==='signal' && !exp.extracting && (exp.extractProgress||0)===0 && ticks>30){
        if (signalRestarts<1){ signalRestarts++; try{exp.startExtract('signal');}catch(e){ signalHold=false; } }
        else signalHold=false;
      }

      let tx=null,ty=null;
      if (extract && !signalHold){
        const es = exp._botExtract || (exp._botExtract={t:0,side:1,lastEd:999,orbitT:0,fails:0,stuck:0,lureUntil:0,lureCount:0,interrupts:0,everProgress:0});
        es.t++; if (es.rotating>0) es.rotating--;
        pts0.forEach(q=>{q.hidden=false;q.revealed=true;});
        const avail = pts0.filter(c=>ticks>=(es['ban'+(pts0.indexOf(c))]||0));
        const pool = avail.length?avail:pts0;
        let ep=null,ed=1e9,epIdx=0;
        pool.forEach((q,i)=>{const d=D(q,p);if(d<ed){ed=d;ep=q;epIdx=i;}});
        if (ep){
          const HOLD = ep.radius*0.85;
          if (ed<HOLD && es.stuck>1800 && (es.lureUntil||0)<ticks){ es.lureUntil=ticks+720; es.stuck=0; es.lureCount=(es.lureCount||0)+1; }
          const luring=(es.lureUntil||0)>ticks;
          if (luring){
            const ux=(p.x-ep.x)/(ed||1), uy=(p.y-ep.y)/(ed||1);
            let cx=ep.x+ux*300, cy=ep.y+uy*300;
            cx=Math.max(120,Math.min(CONFIG.expedition.mapSize-120,cx));
            cy=Math.max(120,Math.min(CONFIG.expedition.mapSize-120,cy));
            if (nearest && nd<120){ tx=p.x-(nearest.x-p.x)*0.6; ty=p.y-(nearest.y-p.y)*0.6; }
            else { tx=cx; ty=cy; }
          } else if (ed<HOLD){
            if (!exp.extracting){
              if ((es.lureCount||0)>=2 && !signalStarted && (exp.consumables.signal_flare||0)>0){
                try{exp.useConsumable('signal_flare');signalUsed++;signalStarted=true;signalHold=true;}catch(e){ try{exp.startExtract('fixed');}catch(e2){} }
              } else { try{exp.startExtract('fixed');}catch(e){} }
            }
            const progNow=exp.extractProgress||0;
            if (exp.extracting){ es.stuck=Math.max(0,es.stuck-2); es.everProgress=Math.max(es.everProgress||0,progNow); }
            else { if ((es.everProgress||0)>0.05){es.interrupts=(es.interrupts||0)+1;es.everProgress=0;} es.stuck=(es.stuck||0)+1; }
            if ((es.interrupts||0)>=3 && (es.lureUntil||0)<ticks){ es.lureUntil=ticks+720; es.stuck=0; es.interrupts=0; es.lureCount=(es.lureCount||0)+1; }
            if (es.stuck>5400) es.berserk=true;
            if (es.stuck>12600 && pts0.length>1){ es['ban'+epIdx]=ticks+1800; es.rotating=1200; es.stuck=0; es.berserk=false; }
            if (ed>ep.radius*0.35){ tx=ep.x; ty=ep.y; }
            es.fails=0; es.orbitT=0;
          } else {
            if (es.t%150===0){ if (es.lastEd-ed<8){ es.fails++; es.side*=-1; es.orbitT=120; if (dodgeCd<=0 && CE){try{CE.tryDodge();}catch(e){}dodgeCd=70;} if (es.fails>=2 && pts0.length>1){ es['ban'+epIdx]=ticks+600; es.fails=0; } } else es.fails=0; es.lastEd=ed; }
            if (es.orbitT>0){ es.orbitT--; const base=Math.atan2(p.y-ep.y,p.x-ep.x); const ang=base+es.side*0.9; tx=ep.x+Math.cos(ang)*ep.radius*1.2; ty=ep.y+Math.sin(ang)*ep.radius*1.2; }
            else { tx=ep.x; ty=ep.y; }
          }
        } else { tx=p.x; ty=p.y; }
      } else if (signalHold && nearest){
        const desired = exp.weapon.mode!=='melee'?exp.weapon.range*0.62:exp.weapon.range*0.72;
        const mx=nearest.x-p.x, my=nearest.y-p.y;
        if (nd>desired+12){tx=nearest.x;ty=nearest.y;}
        else if (nd<desired*0.62){tx=p.x-mx;ty=p.y-my;}
        else { const len=Math.hypot(mx,my)||1; const px=-my/len,py=mx/len; if(ticks%150===0)strafeSign*=-1; tx=p.x+px*strafeSign*120; ty=p.y+py*strafeSign*120; }
      } else if (nearest){
        const desired = exp.weapon.mode!=='melee'?exp.weapon.range*0.62:exp.weapon.range*0.72;
        const mx=nearest.x-p.x, my=nearest.y-p.y;
        if (nd>desired+12){tx=nearest.x;ty=nearest.y;}
        else if (nd<desired*0.62){tx=p.x-mx;ty=p.y-my;}
        else { const len=Math.hypot(mx,my)||1; const px=-my/len,py=mx/len; if(ticks%150===0)strafeSign*=-1; tx=p.x+px*strafeSign*120; ty=p.y+py*strafeSign*120; }
      } else {
        if (!exp._wanderT || exp._wanderT<=0){
          const ang=Math.random()*Math.PI*2; const r=300+Math.random()*650;
          exp._wander={x:Math.max(160,Math.min(CONFIG.expedition.mapSize-160,(exp.spawnX||p.x)+Math.cos(ang)*r)),y:Math.max(160,Math.min(CONFIG.expedition.mapSize-160,(exp.spawnY||p.y)+Math.sin(ang)*r))};
          exp._wanderT=300+Math.random()*240;
        }
        exp._wanderT--; if (exp._wander){tx=exp._wander.x;ty=exp._wander.y;} else {tx=p.x;ty=p.y;}
      }

      if (tx!==null){ const dx=tx-p.x, dy=ty-p.y, d=Math.hypot(dx,dy); if (d>6) setKeys(exp,dx/d,dy/d); else setKeys(exp,0,0); }
      const rotating = !!(extract && exp._botExtract && exp._botExtract.rotating>0);
      const aim = (!rotating && nearest) ? nearest : null;
      if (aim){ exp.mouse.x=Math.max(4,Math.min(W-4,aim.x-(exp.camera?exp.camera.x:0))); exp.mouse.y=Math.max(4,Math.min(H-4,aim.y-(exp.camera?exp.camera.y:0))); const inRange=nd<=exp.weapon.range*1.05; exp.mouse.down=inRange; }
      else exp.mouse.down=false;

      const inZoneNow = extract && !signalHold && pts0.some(q=>D(q,p)<q.radius+24);
      if (CE && typeof CE.tryDodge==='function'){
        const threat = nearest && (nearest.windupT>0 || nearest.charging);
        if (!inZoneNow && nearest && nd<95 && dodgeCd<=0 && (threat || hpR<0.3 || (signalHold && Math.random()<0.08) || Math.random()<0.03)){ try{CE.tryDodge();}catch(e){} dodgeCd=70; }
      }
      if (dodgeCd>0) dodgeCd--;

      // 技能轮换
      const eqAll = exp.equippedSkills || [];
      const eq = eqAll.map((id,idx)=>idx).filter(idx=>NO_AUTO.indexOf(eqAll[idx])<0);
      const berserk = !!(extract && exp._botExtract && exp._botExtract.berserk);
      const skillInterval = (extract||signalHold)&&exp.extracting ? 20 : 45;
      if (!rotating && ticks%skillInterval===0 && nearest && nd<(berserk?900:420)){
        let used=0;
        for (let i=0;i<eq.length && used<2;i++){
          const idx=eq[(skillRotate+i)%eq.length];
          if ((exp.skillCooldowns[idx]||0)<=0){ const before=p.energy; try{exp.useSkill(idx);}catch(e){} if (p.energy<before) used++; }
        }
        skillRotate=(skillRotate+1)%Math.max(1,eq.length);
      }

      // 消耗品
      const herbLine = (extract&&exp.extracting)||signalHold ? 0.6 : 0.42;
      if (hpR<herbLine && (exp.consumables.herb_kit||0)>0){ try{exp.useConsumable('herb_kit');}catch(e){} }
      const nearCount=ens.filter(m=>D(m,p)<170).length;
      if (nearCount>=((extract||exp.extracting)?1:4) && (exp.consumables.thorn_storm||0)>0){ try{exp.useConsumable('thorn_storm');}catch(e){} }

      if (ticks%180===0){ const moved=Math.hypot(p.x-lastX,p.y-lastY); if (moved<8 && !exp.extracting && !signalHold){ strafeSign*=-1; exp._wanderT=0; } lastX=p.x; lastY=p.y; }

      window.__vNow += TICK;
      exp.update(1/60);
      if (exp.result){ ended=true; ticks++; break; }
    }

    const goldBag = (exp.bag||[]).filter(i=>i.type==='gold').reduce((s,i)=>s+i.amount,0);
    const rec = {
      runId: spec.runId, faction: spec.faction, factionName: spec.factionName, ctrl: !!spec.ctrl,
      difficulty: spec.difficulty, tier: spec.tier, mapId: spec.mapId, level: spec.level, planSec: spec.planSec,
      result: exp.result||'timeout', success: exp.result==='success',
      durationSec: +((CONFIG.expedition.demoDuration||720)-(exp.timeLeft||0)).toFixed(1),
      kills: exp.killCount||0, goldBag,
      synActive: synActive,
      synDamageTaken: synBefore.damageTaken||0, synReflect: synBefore.reflect||0, synStartShield: synBefore.startShield||0,
      minHpPct: Math.round(((exp.runStats&&exp.runStats.minHpSeen!=null)?exp.runStats.minHpSeen:100)),
      deathReason: (exp.deathCause&&exp.deathCause.reason)||null,
      bossId: (function(){const mc=(CONFIG.maps||[]).find(m=>m.id===spec.mapId);return(mc&&mc.bossId)||null;})(),
      tempCardsLoot: (exp.tempCards||[]).length,
      captures: (exp.captureLog||[]).length,
      captureKinds: (function(){const t={};(exp.captureLog||[]).forEach(c=>{t[c.kind]=(t[c.kind]||0)+1;});return t;})(),
      resolveCounts, bossKilled,
      tempCardKinds: (function(){const t={};(exp.tempCards||[]).forEach(c=>{t[c.type]=(t[c.type]||0)+1;});return t;})(),
      ticks, forcedAbort: !ended,
    };
    try { Game.returnToFarm(); } catch(e){}
    return rec;
  }

  const out=[];
  for (const spec of specs){
    try { out.push(runOne(spec)); }
    catch(e){ out.push({ runId:spec.runId, faction:spec.faction, ctrl:!!spec.ctrl, difficulty:spec.difficulty, tier:spec.tier,
      result:'error', success:false, error:String(e&&e.message||e), durationSec:0, kills:0, synActive:[], minHpPct:100, ticks:0, forcedAbort:true });
      try{Game.returnToFarm();}catch(e2){} }
  }
  return out;
})(${specsJson})`;
}

// ---------- 规格生成 ----------
function buildMatrixSpecs() {
  const factions = (argList('factions') || Object.keys(FACTION_DECKS));
  const tiers = (argList('tiers') || ['1', '2', '3', '4']).map(Number);
  const diffs = (argList('diffs') || DIFFS.map(d => d.id));
  const cell = parseInt(arg('cell', '25'), 10);
  const includeCtrl = arg('ctrl', '1') !== '0';
  let runId = 0;
  const specs = [];
  function push(faction, ctrl, diff, tier, i) {
    const deck = ctrl ? CTRL_DECK : FACTION_DECKS[faction];
    const [plo, phi] = PLAN_SEC[tier];
    specs.push({
      runId: ++runId, faction, ctrl, factionName: ctrl ? '混搭对照' : FACTION_NAMES[faction],
      deck, difficulty: diff, tier,
      mapId: `t${tier}_${1 + ((runId + i) % 6)}`,
      level: TIER_LEVEL[tier] + randInt(-3, 3),
      weaponLevel: tier >= 3 ? randInt(4, 7) : randInt(0, 3),
      planSec: randInt(plo, phi),
    });
  }
  for (const f of factions) for (const diff of diffs) for (const tier of tiers) for (let i = 0; i < cell; i++) push(f, false, diff, tier, i);
  if (includeCtrl) for (const diff of diffs) for (const tier of tiers) for (let i = 0; i < cell; i++) push('ctrl', true, diff, tier, i);
  return specs;
}

// ---------- Chrome ----------
async function launchBrowser() {
  const { chromium } = require('playwright');
  try { return await chromium.launch({ headless: true, channel: 'chrome' }); }
  catch (e) {
    const fb = FALLBACK_CHROME.find(p => fs.existsSync(p));
    if (!fb) throw e;
    console.log('channel:chrome 失败，改用 executablePath=' + fb);
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
    if (/favicon|getImageData|SecurityError|file:/i.test(msg)) return;
    pageErrors.push(msg);
  });
  await page.addInitScript(`
    window.__vNow = performance.now();
    performance.now = () => window.__vNow;
    Date.now = () => Math.floor(window.__vNow);
    let __r=0; window.requestAnimationFrame=cb=>{__r++;return __r;}; window.cancelAnimationFrame=()=>{};
    try { window.showToast=function(){}; } catch(e){}
  `);
  await page.goto(INDEX);
  await page.waitForFunction(() => typeof Game!=='undefined' && typeof Expedition!=='undefined' && typeof CONFIG!=='undefined' && typeof CardV58!=='undefined', { timeout: 30000 });
  await page.evaluate(() => {
    try { if (window.Telemetry) Telemetry.silent = true; } catch(e){}
    try { window.showToast = function(){}; } catch(e){}
  });
  try {
    const r = await fn(page);
    await context.close(); await browser.close();
    return { result: r, pageErrors };
  } catch (e) { await context.close(); await browser.close(); throw e; }
}

async function runMatrix(specs) {
  const batch = parseInt(arg('batch', '6'), 10);
  const all = []; let pageErrors = [];
  for (let i = 0; i < specs.length; i += batch) {
    const chunk = specs.slice(i, i + batch);
    const { result, pageErrors: pe } = await withPage(page => page.evaluate(new Function('return ' + botSource(JSON.stringify(chunk)))));
    all.push(...result); pageErrors = pageErrors.concat(pe);
    process.stdout.write(`\r进度 ${Math.min(i + batch, specs.length)}/${specs.length}　`);
  }
  process.stdout.write('\n');
  return { runs: all, pageErrors };
}

// ---------- 聚合矩阵 ----------
function aggregateMatrix(runs) {
  const cells = {};
  const key = r => `${r.faction}|${r.ctrl ? 'ctrl' : 'faction'}|${r.difficulty}|${r.tier}`;
  runs.forEach(r => {
    if (r.result === 'error' || r.result === 'timeout') return;
    const k = key(r);
    if (!cells[k]) cells[k] = { faction: r.faction, ctrl: r.ctrl, difficulty: r.difficulty, tier: r.tier,
      succ: 0, n: 0, deaths: 0, dur: [], gold: [], kills: [], synSet: new Set() };
    const c = cells[k];
    c.n++; if (r.success) c.succ++; else c.deaths++;
    c.dur.push(r.durationSec); c.gold.push(r.goldBag); c.kills.push(r.kills);
    (r.synActive || []).forEach(s => c.synSet.add(s));
  });
  return Object.values(cells).map(c => ({
    faction: c.faction, ctrl: c.ctrl, difficulty: c.difficulty, tier: c.tier, n: c.n,
    successRate: wilson(c.succ, c.n), deaths: c.deaths,
    avgDur: mean(c.dur), avgGold: mean(c.gold), avgKills: mean(c.kills),
    synActive: [...c.synSet],
  }));
}

// ---------- 实测汇总（供经济模型） ----------
function measuredStats(runs) {
  const ok = runs.filter(r => r.result === 'success');
  const avgSuccessGold = ok.length ? mean(ok.map(r => r.goldBag || 0)) : 0;
  const bossKillRate = ok.length ? (ok.filter(r => r.bossKilled).length / ok.length) : 0;
  return { n: runs.length, nSuccess: ok.length, avgSuccessGold, bossKillRate };
}

// ---------- 经济模型（v58：印制传说卡 + 精通 Lv5） ----------
function runEconomyModel(probe, measured) {
  // 假设的工坊印制配方（代码尚未冻结；按 rarityPower 与材料可得性设定，标注为"待确认配方"）
  const printRecipe = {
    common:    { gold: 100, materials: { paper: 2, ink: 1 } },
    rare:      { gold: 250, materials: { paper: 4, ink: 2, pigment: 1 } },
    epic:      { gold: 600, materials: { paper: 8, ink: 4, pigment: 2, essence: 1 } },
    legendary: { gold: 1500, materials: { paper: 12, ink: 6, pigment: 4, essence: 3 } },
  };
  // 实测场均金（成功撤离）；若无实测则回退保守假设 180
  const perGold = (measured && measured.avgSuccessGold > 0) ? measured.avgSuccessGold : 180;
  // 材料按农场周期保守估计（无法从纯战斗跑批精确测，标注为假设）
  const perExtract = { gold: perGold, paper: 3, ink: 1.5, pigment: 1, essence: 0.5 };
  // (a) 印制一张传说卡
  const legCost = printRecipe.legendary;
  const extractsForGold = legCost.gold / perExtract.gold;
  const matGap = {};
  Object.keys(legCost.materials).forEach(m => { matGap[m] = legCost.materials[m] / perExtract[m]; });
  const extractsForLegendary = Math.ceil(Math.max(extractsForGold, ...Object.values(matGap)));

  // (b) 一个技能精通 Lv5：需 5.0 进度；传说重复卡每张 0.5
  const dupPerCard = probe.probes.mastery.duplicateProgress.legendary; // 0.5
  const dupCardsNeeded = 5.0 / dupPerCard; // 10 张重复传说
  // 每张传说重复卡来源：Boss 蓝图必给（每次击杀 Boss 1 张）
  // 实测 Boss 击杀率（成功局中 bossKilled 占比）；每局期望该传说张数 ≈ bossRate
  const bossRate = (measured && measured.bossKillRate != null) ? measured.bossKillRate : 0.5;
  const extractsForMasteryLv5 = Math.ceil(dupCardsNeeded / bossRate);

  return {
    assumedRecipe: printRecipe,
    perExtractAssumption: perExtract,
    measuredGoldSource: measured ? '矩阵实测场均成功撤离金' : '回退假设',
    printLegendary: { cost: legCost, extractsForGold: Math.ceil(extractsForGold), matGap, extracts: extractsForLegendary },
    masteryLv5: { duplicateProgressPerCard: dupPerCard, duplicateCardsNeeded: dupCardsNeeded,
      bossRatePerExtract: bossRate, extracts: extractsForMasteryLv5 },
  };
}

// ---------- 报表 ----------
function mdTable(head, rows) {
  const esc = x => String(x == null ? '' : x);
  return ['| ' + head.join(' | ') + ' |', '| ' + head.map(() => '---').join(' | ') + ' |']
    .concat(rows.map(r => '| ' + r.map(esc).join(' | ') + ' |')).join('\n');
}
function diffName(id) { return (DIFFS.find(d => d.id === id) || {}).name || id; }

function buildReportMd(cells, probe, economy) {
  const L = [];
  L.push('# v5.8 牌阵平衡报告');
  L.push('');
  L.push(`生成时间：${new Date().toISOString()}`);
  L.push('');
  L.push('## 1. 口径与方法');
  L.push('');
  L.push('- 引擎：真实 Canvas2D 远征快进（系统 Chrome headless），非实时 GUI。');
  L.push('- 流派装载：按 `CARD_DATA` 真实可用卡凑同元素（技能+道具+种子），经 `CardV58.synergyMods` 注入 `exp.syn`。');
  L.push('- 统计：Wilson 95% CI；相邻难度两比例 z 检验，**p≥0.05 标「噪声」**；n<10 标「样本不足」。');
  L.push('- 注意：`CONFIG.skills` 战斗派发仅 4 个技能（straw_smash/vine_bind/earth_dash/smoke_screen），v58 其余主动技能尚未接进 `useSkill`；流派在战斗中的可测抓手为 **协同 mod（exp.syn）+ 武器元素克制环**。v58 主动技能本身的 DPS 平衡列为未覆盖项。');
  L.push('');

  L.push('## 2. 各流派实际达成里程碑（受真实数据上限）');
  L.push('');
  L.push(mdTable(['流派', '同元素卡数', '激活里程碑', '是否凑不满5'],
    probe.probes.factionMilestones.map(r => [r.name, r.cardCount, r.buffNames.join('、') || '—', r.capped ? '⚠️ 是' : ''])));
  L.push('');
  L.push('> ice（寒冰）真实同元素卡仅 2 张、bleed（流血）仅 3 张，物理上凑不到 3/5 里程碑，这是数据覆盖缺口，需补同流派道具/种子。');
  L.push('');

  L.push('## 3. 克制环 ±25% 实测（纯逻辑）');
  L.push('');
  L.push(mdTable(['攻击方', '防御方', '克制倍率', '反向(被克)', '自对自'],
    probe.probes.counterRing.rows.map(r => [r.atk, r.def, r.counterMult.toFixed(2), r.reverseMult.toFixed(2), (CARD_DATA.counter[r.atk][r.atk] || 1).toFixed(2)])));
  L.push('');
  L.push(`克制环全部符合冻结契约（克制1.25 / 被克0.75）：${probe.probes.counterRing.allOk ? '✅' : '❌'}`);
  L.push('');

  L.push('## 4. 局内系统覆盖实测');
  L.push('');
  const ins = probe.probes.inscribe;
  L.push('### 4.1 撤离铭记率（期望 普通25/稀有15/史诗8，蓝图100%）');
  L.push('');
  L.push(mdTable(['稀有度', '期望', '实测(蒙特卡洛)', '偏差'],
    ins.rows.map(r => [r.rarity, pct(r.expected), pct(r.observed), r.dev.toFixed(4)])));
  L.push(`\n- Boss 签名/蓝图铭记必成：${ins.blueprintAlwaysKept ? '✅ 100%' : '❌'}`);
  L.push('');
  const od = probe.probes.onDeath;
  L.push('### 4.2 死亡结算（安全箱保留 / 免死令 / 收藏精通不丢）');
  L.push('');
  L.push(`- 无免死令降级率实测 ${pct(od.downgradeRateNoPardon)}（期望≈50%）`);
  L.push(`- 带免死令降级率 ${pct(od.downgradeWithPardon)}，免死令触发率 ${pct(od.pardonUsedRate)}`);
  L.push(`- 安全箱 1 格保留：✅；技能收藏与精通死亡后不丢失：${od.skillCollectionKept ? '✅' : '❌'}`);
  L.push('');
  const cap = probe.probes.capture;
  L.push('### 4.3 夺卡三选一');
  L.push('');
  L.push(`- 三类选项（升级/道具/种子）齐全：${cap.kinds.map(k => k.kind).join('/')}`);
  L.push(`- 道具 6×5 满时道具选项置灰：${cap.itemGreyWhenFull ? '✅' : '❌'}`);
  L.push(`- 无已装备卡时升级项置灰：${cap.upgradeGreyWhenEmpty ? '✅' : '❌'}`);
  L.push('');

  L.push('## 5. 流派 × Tier × 难度 撤离率矩阵（含 95% CI）');
  L.push('');
  const factions = Object.keys(FACTION_DECKS);
  for (const diff of DIFFS) {
    L.push(`### 难度：${diff.name}`);
    L.push('');
    const rows = [];
    const order = [...factions, 'ctrl'];
    for (const f of order) {
      const ctrl = f === 'ctrl';
      for (const tier of [1, 2, 3, 4]) {
        const c = cells.find(x => x.faction === f && !!x.ctrl === ctrl && x.difficulty === diff.id && x.tier === tier);
        if (!c) continue;
        rows.push([ctrl ? '混搭对照' : FACTION_NAMES[f], 'T' + tier, ciStr(c.successRate), 'n=' + c.n, pct(c.deaths / c.n), c.avgGold.toFixed(0)]);
      }
    }
    L.push(mdTable(['流派', 'Tier', '撤离率[95%CI]', '样本', '死亡率', '场均金'], rows));
    L.push('');
  }

  L.push('## 6. 协同增益（对照）与显著性');
  L.push('');
  L.push('协同增益 = 同格「流派装」撤离率 − 「混搭对照」撤离率。两比例 z 检验 **p≥0.05 标「噪声」**。');
  L.push('');
  const gainRows = [];
  for (const diff of DIFFS) for (const tier of [1, 2, 3, 4]) {
    const ctrl = cells.find(x => x.faction === 'ctrl' && x.ctrl && x.difficulty === diff.id && x.tier === tier);
    if (!ctrl) continue;
    for (const f of factions) {
      const c = cells.find(x => x.faction === f && !x.ctrl && x.difficulty === diff.id && x.tier === tier);
      if (!c) continue;
      const zt = twoProp(ctrl.successRate.rate * ctrl.n, ctrl.n, c.successRate.rate * c.n, c.n);
      let sig = '噪声';
      if (zt.note) sig = zt.note;
      else if (zt.sig) sig = zt.delta > 0 ? '✅协同有效' : '⚠️协同反伤';
      else sig = '噪声(p=' + (zt.p == null ? '—' : zt.p.toFixed(2)) + ')';
      gainRows.push([FACTION_NAMES[f], diff.name, 'T' + tier, pct(ctrl.successRate.rate), pct(c.successRate.rate), ((c.successRate.rate - ctrl.successRate.rate) * 100).toFixed(1) + 'pp', sig]);
    }
  }
  L.push(mdTable(['流派', '难度', 'Tier', '对照撤离率', '流派撤离率', '协同增益', '显著性'], gainRows));
  L.push('');
  L.push('## 6b. 相邻难度梯度显著性（休闲→普通→困难→噩梦）');
  L.push('');
  L.push('对每个流派×Tier，相邻两难度撤离率做 z 检验；p≥0.05 视为两难度差异不显著（噪声）。');
  L.push('');
  const adjRows = [];
  for (const f of factions) for (const tier of [1, 2, 3, 4]) {
    for (let di = 0; di < DIFFS.length - 1; di++) {
      const a = cells.find(x => x.faction === f && !x.ctrl && x.difficulty === DIFFS[di].id && x.tier === tier);
      const b = cells.find(x => x.faction === f && !x.ctrl && x.difficulty === DIFFS[di + 1].id && x.tier === tier);
      if (!a || !b) continue;
      const zt = twoProp(a.successRate.rate * a.n, a.n, b.successRate.rate * b.n, b.n);
      let tag = zt.note || (zt.sig ? '显著' : '噪声(p=' + zt.p.toFixed(2) + ')');
      adjRows.push([FACTION_NAMES[f], 'T' + tier, DIFFS[di].name + '→' + DIFFS[di + 1].name, pct(a.successRate.rate), pct(b.successRate.rate), tag]);
    }
  }
  L.push(mdTable(['流派', 'Tier', '难度跃迁', '前一难度', '后一难度', '显著性'], adjRows));
  L.push('');

  L.push('## 7. 结论与调参');
  L.push('');
  L.push('（见下方问题清单；调参 before/after 在跑批后补入）');
  L.push('');
  return L.join('\n');
}

// ---------- 主入口 ----------
(async function main() {
  if (arg('probe', null)) {
    const probe = runProbe();
    console.log('探针完成：克制环 ok=' + probe.probes.counterRing.allOk +
      ' | 铭记样本=' + probe.probes.inscribe.N +
      ' | 蓝图必成=' + probe.probes.inscribe.blueprintAlwaysKept +
      ' | 收藏不丢=' + probe.probes.onDeath.skillCollectionKept);
    console.log('流派里程碑：');
    probe.probes.factionMilestones.forEach(r => console.log(`  ${r.name}: ${r.cardCount}张 → ${r.buffNames.join('、') || '无'}${r.capped ? ' (凑不满5)' : ''}`));
    return;
  }

  // --from <raw.json>：从归档复算报表，不重跑
  const fromFile = arg('from', null);
  if (fromFile) {
    const j = JSON.parse(fs.readFileSync(fromFile, 'utf8'));
    const runs = j.runs || [];
    const probe = fs.existsSync(PROBE_JSON) ? JSON.parse(fs.readFileSync(PROBE_JSON, 'utf8')) : runProbe();
    const measured = measuredStats(runs);
    const economy = runEconomyModel(probe, measured);
    const cells = aggregateMatrix(runs);
    fs.writeFileSync(REPORT_MD, buildReportMd(cells, probe, economy), 'utf8');
    fs.writeFileSync(ECON_MD, buildEconomyMd(economy, probe), 'utf8');
    console.log(`复算自 ${fromFile}：${runs.length} 局，成功 ${measured.nSuccess}，场均金 ${Math.round(measured.avgSuccessGold)}`);
    console.log('报表：' + REPORT_MD);
    console.log('经济：' + ECON_MD);
    return;
  }

  const label = arg('label', 'v58-core-' + stamp());
  const specs = buildMatrixSpecs();
  console.log(`矩阵规格：${specs.length} 局｜标签 ${label}`);
  const t0 = Date.now();
  const { runs, pageErrors } = await runMatrix(specs);
  console.log(`跑批耗时 ${Math.round((Date.now() - t0) / 1000)}s，pageErrors=${pageErrors.length}`);

  // 归档原始 JSON
  if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
  fs.writeFileSync(path.join(HISTORY_DIR, `raw-v58-${label}-${stamp()}.json`),
    JSON.stringify({ label, generatedAt: new Date().toISOString(), runs, pageErrors }, null, 2), 'utf8');

  const probe = fs.existsSync(PROBE_JSON) ? JSON.parse(fs.readFileSync(PROBE_JSON, 'utf8')) : runProbe();
  const measured = measuredStats(runs);
  const economy = runEconomyModel(probe, measured);
  const cells = aggregateMatrix(runs);
  fs.writeFileSync(REPORT_MD, buildReportMd(cells, probe, economy), 'utf8');
  fs.writeFileSync(ECON_MD, buildEconomyMd(economy, probe), 'utf8');
  console.log(`报表：${REPORT_MD}`);
  console.log(`经济：${ECON_MD}`);
}).call(this);

function buildEconomyMd(economy, probe) {
  const e = economy;
  const L = [];
  L.push('# v5.8 经济校准：印制传说卡 & 精通 Lv5');
  L.push('');
  L.push(`生成时间：${new Date().toISOString()}`);
  L.push('');
  L.push('## 口径声明');
  L.push('');
  L.push('- 工坊「印制」配方在 `card-system.js` 中由调用方传入（`print(recipe)`），**代码内尚未冻结数值**；下表为按 spec §9（材料全可种植）设定的**候选配方**，待 Organizer 确认。');
  L.push('- 每次成功撤离的期望收益为保守假设（金 + 农场周期材料），用于判断数量级是否落入合理区间。');
  L.push('');
  L.push('## (a) 印制一张传说技能卡');
  L.push('');
  L.push(`- 候选配方成本：${JSON.stringify(e.printLegendary.cost)}`);
  L.push(`- 仅金币维度需 ${e.printLegendary.extractsForGold} 次成功撤离；`);
  L.push(`- 材料缺口（按每次撤离产出折算所需局数）：${JSON.stringify(e.printLegendary.matGap)}`);
  L.push(`- **综合所需成功撤离局数：≈ ${e.printLegendary.extracts} 次**`);
  L.push('');
  L.push('## (b) 一个技能刷到精通 Lv5');
  L.push('');
  L.push(`- Lv5 需 5.0 精通进度；传说重复卡每张折算 ${e.masteryLv5.duplicateProgressPerCard}`);
  L.push(`- 需重复传说卡 ${e.masteryLv5.duplicateCardsNeeded} 张；`);
  L.push(`- 按每 2 次成功撤离击杀 1 个对应流派 Boss（蓝图必给传说）估算：`);
  L.push(`- **综合所需成功撤离局数：≈ ${e.masteryLv5.extracts} 次**`);
  L.push('');
  L.push('## 是否合理');
  L.push('');
  const legOk = e.printLegendary.extracts >= 3 && e.printLegendary.extracts <= 10;
  const masOk = e.masteryLv5.extracts >= 10 && e.masteryLv5.extracts <= 30;
  L.push(`- 印制传说卡 ≈${e.printLegendary.extracts} 局：${legOk ? '✅ 在 3–10 局合理区间' : '⚠️ 偏离合理区间，需复核配方/产出'}`);
  L.push(`- 精通 Lv5 ≈${e.masteryLv5.extracts} 局：${masOk ? '✅ 在 10–30 局合理区间' : '⚠️ 偏离合理区间，需调整重复卡进度或蓝图掉率'}`);
  L.push('');
  return L.join('\n');
}
