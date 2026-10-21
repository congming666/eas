/* =============================================================================
 * economy-loop.js — 整体循环修正层（第三轮竞品逆向 W1/W5/W8 落地）
 *
 * W1c 土地等级体系：提升农场产量唯二途径 = ①unlockPlot 购新地 ②upgradePlot 升级土地
 *     tier 0-3（贫瘠/普通/肥沃/丰饶），生长倍率 CONFIG.fx.farm.plotTierGrow
 * W1c 收益软上限：GameState.econ.diminishMult 每 600s 在线 ×0.8（下限 0.25）
 *     —— 挂机 2 小时回来收成只剩 1/4，主动玩家前 10 分钟全价
 * W5  农场压力事件：暴雨/野猪/蝗灾（低频高影响，墙上时钟口径，远征中也会发生）
 *     agri_6「结界栅栏」科技：事件伤害减半
 * W8  建筑配装位：CONFIG.buildingItems 道具插入建筑槽位生效
 *
 * 依赖：CONFIG（config.js）、GameState/Warehouse/SaveSystem（由页面注入）
 * 挂载：window.EconLoop（浏览器）；node 校验脚本可直接 require
 * ========================================================================== */
(function (global) {
  'use strict';

  const CFG = () => (typeof CONFIG !== 'undefined' && CONFIG.fx && CONFIG.fx.farm) || {
    plotTierNames: ['贫瘠', '普通', '肥沃', '丰饶'],
    plotTierGrow: [1.0, 0.88, 0.76, 0.62],
    plotTierQuality: [0, 0.04, 0.08, 0.14],
    plotUpCost: [80, 220, 600],
    diminishHalfLife: 600, diminishFactor: 0.8, diminishFloor: 0.25,
    eventInterval: [180, 300], eventChance: 0.55,
  };

  function gs() { return (typeof GameState !== 'undefined') ? GameState : null; }

  /* ---------------- 初始化（存档加载后调用一次） ---------------- */
  function init() {
    const G = gs();
    if (!G) return;
    if (!G.econ) G.econ = { diminishMult: 1, diminishClock: 0, eventNextAt: 0, eventLog: [], plotSpent: {} };
    // 旧档补 tier 字段（默认 0 = 贫瘠；新档与旧档一致，升级是唯一提产途径）
    if (G.farmPlots) G.farmPlots.forEach(p => { if (p.tier === undefined) p.tier = 0; });
    if (!G.econ.eventNextAt) G.econ.eventNextAt = _nextEventAt();
  }

  /* ================= W1c 土地等级 ================= */

  function plotTier(idx) {
    const p = gs().farmPlots[idx];
    return p ? (p.tier || 0) : 0;
  }

  // 生长速度倍率（farm.js progress 计算调用；值越小长得越快）
  function growMul(idx) {
    return CFG().plotTierGrow[plotTier(idx)] || 1;
  }

  // 品质加成（CropExpansion.QualitySystem 可选消费）
  function qualityBonus(idx) {
    return CFG().plotTierQuality[plotTier(idx)] || 0;
  }

  function upgradeCost(idx) {
    const tier = plotTier(idx);
    const base = CFG().plotUpCost[tier];
    if (base === undefined) return null; // 已满级
    const markup = globalMarkup();       // W2：土地升级同吃全局通胀
    return { gold: Math.round(base * markup) };
  }

  function upgradePlot(idx) {
    const G = gs();
    const p = G.farmPlots[idx];
    if (!p || idx >= G.unlockedPlots) { _toast('该地块尚未解锁', 'warning'); return false; }
    const cost = upgradeCost(idx);
    if (!cost) { _toast('该地块已是丰饶等级', 'info'); return false; }
    if (G.gold < cost.gold) { _toast(`需要 ${cost.gold} 金币`, 'warning'); return false; }
    G.gold -= cost.gold;
    G.econ.plotSpent[idx] = (G.econ.plotSpent[idx] || 0) + cost.gold; // RefundAll 记账
    p.tier = plotTier(idx) + 1;
    _toast(`${CFG().plotTierNames[p.tier]}土地：生长速度 ${growMul(idx)}×`, 'gold');
    _save();
    return true;
  }

  /* ================= W1c 收益软上限 ================= */

  // 主循环驱动：不区分农场/远征模式，纯墙上时钟（远征 12 分钟同样计入衰减窗口）
  function tickDiminish(dtSec) {
    const G = gs();
    if (!G || !G.econ) return;
    const c = CFG();
    G.econ.diminishClock += dtSec;
    while (G.econ.diminishClock >= c.diminishHalfLife) {
      G.econ.diminishClock -= c.diminishHalfLife;
      G.econ.diminishMult = Math.max(c.diminishFloor, G.econ.diminishMult * c.diminishFactor);
    }
  }

  // 当前农场收益倍率（挂机衰减）；进新 session 重置（save.js load 时 init 处理）
  function incomeMult() {
    const G = gs();
    return (G && G.econ && G.econ.diminishMult) || 1;
  }

  function resetDiminish() {
    const G = gs();
    if (G && G.econ) { G.econ.diminishMult = 1; G.econ.diminishClock = 0; }
  }

  /* ================= W5 农场压力事件 ================= */

  function _nextEventAt() {
    const c = CFG();
    return Date.now() + (c.eventInterval[0] + Math.random() * (c.eventInterval[1] - c.eventInterval[0])) * 1000;
  }

  // 主循环驱动（与 tickDiminish 同一入口）；远征中也会发生（回来看到损失 = 防囤积张力）
  function tickEvents() {
    const G = gs();
    if (!G || !G.econ) return;
    if (!G.econ.eventNextAt) { G.econ.eventNextAt = _nextEventAt(); return; }
    if (Date.now() < G.econ.eventNextAt) return;
    G.econ.eventNextAt = _nextEventAt();
    if (Math.random() > CFG().eventChance) return;
    triggerEvent();
  }

  function triggerEvent(forceId) {
    const G = gs();
    const table = (typeof CONFIG !== 'undefined' && CONFIG.farmEvents) || [];
    if (!table.length) return null;
    let ev = forceId ? table.find(e => e.id === forceId) : _weightedPick(table);
    if (!ev) return null;
    // 防御科技：agri_6 结界栅栏 → 伤害减半（数量减半）
    const defended = typeof TechSystem !== 'undefined' && TechSystem.isTechUnlocked && TechSystem.isTechUnlocked('agri_6');
    let n = randInt(ev.plots.count[0], ev.plots.count[1]);
    if (defended) n = Math.max(1, Math.ceil(n / 2));
    const plots = _pickPlots(ev.plots.filter, n);
    let hit = 0;
    plots.forEach(p => {
      const plot = G.farmPlots[p];
      if (!plot || !plot.crop) return;
      hit++;
      if (ev.plots.effect === 'progress') {
        const regrow = plot.crop.growTime * ev.plots.factor;
        plot.plantedAt += regrow * 1000; // 进度倒退
      } else if (ev.plots.effect === 'destroy') {
        plot.crop = null; plot.ready = false; plot.status = null; plot.harvestCount = 0; plot.fertilized = false;
      } else if (ev.plots.effect === 'status') {
        plot.status = ev.plots.status || 'pest';
      }
    });
    G.econ.eventLog.unshift({ id: ev.id, at: Date.now(), hit });
    if (G.econ.eventLog.length > 20) G.econ.eventLog.length = 20;
    if (hit > 0) {
      _toast(`${ev.icon} ${ev.name}：${hit} 块农田受灾${defended ? '（结界栅栏已减免半数）' : ''}`, 'warning');
      _save();
    }
    return { event: ev, hit, defended };
  }

  function _pickPlots(filter, n) {
    const G = gs();
    const now = Date.now();
    const cand = [];
    for (let i = 0; i < G.unlockedPlots; i++) {
      const p = G.farmPlots[i];
      if (!p || !p.crop) continue;
      if (filter === 'ready' && !p.ready) continue;
      if (filter === 'growing' && p.ready) continue;
      cand.push(i);
    }
    // 洗牌取 n
    for (let i = cand.length - 1; i > 0; i--) { const j = randInt(0, i); [cand[i], cand[j]] = [cand[j], cand[i]]; }
    return cand.slice(0, n);
  }

  /* ================= W2 全局 markup（经济通胀引擎） ================= */

  // markup = 1 + 0.1 ×（建筑总级数 + 科技总数 + 土地升级次数）——单池通胀
  function globalMarkup() {
    const G = gs();
    if (!G) return 1;
    let levels = 0;
    if (G.buildings) Object.keys(G.buildings).forEach(id => { levels += (G.buildings[id].level || 0); });
    if (G.unlockedTech) levels += G.unlockedTech.length;
    if (G.econ && G.econ.plotSpent) levels += Object.keys(G.econ.plotSpent).length;
    return 1 + 0.1 * levels;
  }

  /* ================= W2 RefundAll（零风险洗点） ================= */

  // 建筑全额退款（实付记账）+ 土地升级全额退款 + 科技点全额退还；markup 随级数回落自然回降
  function refundAll() {
    const G = gs();
    if (!G) return { gold: 0, tech: 0, plots: 0 };
    let gold = 0;
    if (G.buildings) Object.keys(G.buildings).forEach(id => {
      const b = G.buildings[id];
      gold += (b.spentGold || 0); // tech-system.js 升级时记账
      b.level = 0; b.spentGold = 0;
      if (b.slot) delete b.slot;
    });
    if (G.econ && G.econ.plotSpent) {
      Object.keys(G.econ.plotSpent).forEach(idx => { gold += G.econ.plotSpent[idx]; G.farmPlots[+idx].tier = 0; });
      G.econ.plotSpent = {};
    }
    let tech = 0;
    if (G.unlockedTech) {
      G.unlockedTech.forEach(tid => { const node = _findTechNode(tid); if (node) tech += node.cost; });
      G.unlockedTech = [];
    }
    if (tech) G.techPoints = (G.techPoints || 0) + tech;
    G.gold += gold;
    if (G.labUnlocked && !(G.buildings.lab && G.buildings.lab.level > 0)) G.labUnlocked = false;
    _toast(`♻️ 经济重铸：退还 ${gold} 金币 + ${tech} 科技点`, 'gold');
    _save();
    return { gold, tech, plots: 0 };
  }

  function _findTechNode(tid) {
    if (typeof TechSystem === 'undefined' || !TechSystem.getAllTechTrees) return null;
    for (const tree of TechSystem.getAllTechTrees()) {
      const n = tree.nodes.find(x => x.id === tid);
      if (n) return n;
    }
    return null;
  }

  /* ================= W8 建筑配装位 ================= */

  function slotItem(buildingId, itemId) {
    const G = gs();
    if (!G.buildings || !G.buildings[buildingId]) return false;
    const def = (typeof CONFIG !== 'undefined' && CONFIG.buildingItems) ? CONFIG.buildingItems[itemId] : null;
    if (!def || def.target !== buildingId) { _toast('该道具无法安装到此建筑', 'warning'); return false; }
    const b = G.buildings[buildingId];
    if (b.slot) { Warehouse.addItem(b.slot, 1); } // 换装：旧道具退回仓库
    if (typeof Warehouse === 'undefined' || !Warehouse.removeItem(itemId, 1)) { _toast('仓库中没有该道具', 'warning'); return false; }
    b.slot = itemId;
    _toast(`${def.icon} ${def.name} 已安装到${_buildingName(buildingId)}`, 'gold');
    _save();
    return true;
  }

  function unslotItem(buildingId) {
    const G = gs();
    const b = G.buildings && G.buildings[buildingId];
    if (!b || !b.slot) return false;
    Warehouse.addItem(b.slot, 1);
    _toast('已拆除建筑道具', 'info');
    delete b.slot;
    _save();
    return true;
  }

  // 槽位加成查询：econLoop.slotBonus('workshop', 'speed') → 0.15/0.25/0
  function slotBonus(buildingId, key) {
    const G = gs();
    const b = G.buildings && G.buildings[buildingId];
    if (!b || !b.slot) return 0;
    const def = (typeof CONFIG !== 'undefined' && CONFIG.buildingItems) ? CONFIG.buildingItems[b.slot] : null;
    return (def && def.bonus && def.bonus[key]) || 0;
  }

  function _buildingName(id) {
    const names = { workshop: '加工研究所', greenhouse: '温室', barn: '畜舍', lab: '研究所' };
    return names[id] || id;
  }

  /* ================= W7 远征金币加成（market_1..5 科技） ================= */

  // market 节点数 × 8%（每点一个节点，最多 5 点 → +40%）
  function expeditionGoldMult() {
    if (typeof TechSystem === 'undefined' || !TechSystem.isTechUnlocked) return 1;
    let lv = 0;
    for (let i = 1; i <= 5; i++) if (TechSystem.isTechUnlocked('market_' + i)) lv++;
    return 1 + 0.08 * lv;
  }

  /* ================= 工具 ================= */
  function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function _weightedPick(arr) {
    const total = arr.reduce((s, e) => s + (e.weight || 1), 0);
    let r = Math.random() * total;
    for (const e of arr) { r -= (e.weight || 1); if (r <= 0) return e; }
    return arr[arr.length - 1];
  }
  function _toast(msg, kind) { if (typeof showToast !== 'undefined') showToast(msg, kind || 'info'); }
  function _save() { if (typeof SaveSystem !== 'undefined' && SaveSystem.save) SaveSystem.save(); }

  /* ================= 导出 ================= */
  const EconLoop = {
    init, globalMarkup, refundAll,
    plotTier, growMul, qualityBonus, upgradeCost, upgradePlot,
    tickDiminish, incomeMult, resetDiminish,
    tickEvents, triggerEvent,
    slotItem, unslotItem, slotBonus,
    expeditionGoldMult,
  };
  global.EconLoop = EconLoop;
  if (typeof module !== 'undefined' && module.exports) module.exports = EconLoop;
})(typeof window !== 'undefined' ? window : globalThis);
