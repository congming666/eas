/* ================= v5.9 今日订单（对标 Big Farm 任务链） =================
 * 每日 3 条订单，按玩家等级分层：1-10 只出作物，11-30 加加工品，31+ 出远征材料。
 * 奖励：金币 200 + 12×等级；材料 1-3；稀有种子 15%；蓝图 5%。
 * 每日 0 点随 RewardSystem.dateKey() 刷新，可花 200 金币手动刷新 1 次。
 */
(function () {
  'use strict';

  const REFRESH_COST = 200;
  const RARE_SEED_CHANCE = 0.15;
  const BLUEPRINT_CHANCE = 0.05;
  const QUALITY_RANK = { common: 0, fine: 1, excellent: 2, legendary: 3 };
  const QUALITY_NAME = { fine: '优良', excellent: '极品', legendary: '传说' };

  // 加工品（来自 farm-expansion 的配方输出）
  const CRAFTED = {
    flour: { name: '面粉', icon: '🌾' },
    bread: { name: '面包', icon: '🍞' },
    oil: { name: '植物油', icon: '🫒' },
    torch: { name: '火把', icon: '🔥' },
    juice: { name: '西瓜汁', icon: '🍉' },
    feed: { name: '饲料', icon: '🌽' },
    egg: { name: '鸡蛋', icon: '🥚' },
    pumpkin_lantern: { name: '南瓜灯', icon: '🎃' },
    insecticide: { name: '驱虫剂', icon: '🐛' }
  };

  // 远征材料（取自建筑升级用的仓库材料）
  const EXPEDITION_MATS = {
    wood: { name: '硬木', icon: '🪵' },
    iron: { name: '铁块', icon: '⚙️' },
    crystal: { name: '灵晶', icon: '💎' },
    bossFang: { name: 'Boss 獠牙', icon: '🦷' }
  };

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function todayKey() {
    if (window.RewardSystem && RewardSystem.dateKey) return RewardSystem.dateKey();
    return new Date().toISOString().slice(0, 10);
  }

  function crops() {
    return (window.CONFIG && Array.isArray(CONFIG.crops)) ? CONFIG.crops : [];
  }

  function init() {
    if (!GameState.orders) GameState.orders = { dateKey: '', list: [], refreshed: false };
    if (!GameState.orderStats) GameState.orderStats = { dateKey: '', harvested: {}, crafted: {} };
    ensureToday();
  }

  function ensureToday() {
    const key = todayKey();
    if (GameState.orders.dateKey === key) return;
    GameState.orderStats.dateKey = key;
    const list = generate(key);
    GameState.orders = { dateKey: key, list, refreshed: false };
    // 注意：这里不能调 SaveSystem.save()。boot 阶段存档还没加载，
    // 提前保存会把默认 GameState 写回，覆盖玩家真实存档。
  }

  function generate() {
    initStatsIfNeeded();
    const level = GameState.level || 1;
    const pool = crops().filter((c) => c.rewardType !== 'cultivation');
    const list = [];

    const addDeliver = (crop) => {
      const count = Math.min(40, 6 + Math.floor(level * 0.8));
      list.push({
        id: 'o' + (list.length + 1), kind: 'deliver',
        item: crop.id, name: crop.name, icon: crop.icon || '🌱', count, done: false
      });
    };
    const addCraft = (id) => {
      const def = CRAFTED[id];
      const count = Math.min(6, 2 + Math.floor(level / 15));
      list.push({
        id: 'o' + (list.length + 1), kind: 'craft',
        item: id, name: def.name, icon: def.icon, count, done: false
      });
    };
    const addHarvest = (crop) => {
      const count = Math.min(20, 4 + Math.floor(level * 0.3));
      list.push({
        id: 'o' + (list.length + 1), kind: 'harvest',
        item: crop.id, name: crop.name, icon: crop.icon || '🌱',
        quality: level >= 20 ? 'excellent' : 'fine', count, done: false
      });
    };
    const addResource = (id) => {
      const def = EXPEDITION_MATS[id];
      list.push({
        id: 'o' + (list.length + 1), kind: 'deliver',
        item: id, name: def.name, icon: def.icon,
        count: Math.min(12, 3 + Math.floor(level / 12)), done: false
      });
    };

    if (pool.length) {
      addDeliver(pick(pool));
      if (level >= 11) addCraft(pick(Object.keys(CRAFTED)));
      else addDeliver(pick(pool));
      if (level >= 31) addResource(pick(Object.keys(EXPEDITION_MATS)));
      else addHarvest(pick(pool));
    }

    return list.map((o) => Object.assign(o, { reward: makeReward(level) }));
  }

  function makeReward(level) {
    const gold = 200 + 12 * level;
    const matCount = 1 + Math.floor(Math.random() * 3);
    const reward = { gold, materials: matCount };
    if (Math.random() < RARE_SEED_CHANCE) reward.seeds = 2;
    if (Math.random() < BLUEPRINT_CHANCE) reward.blueprint = true;
    return reward;
  }

  function initStatsIfNeeded() {
    if (!GameState.orderStats || GameState.orderStats.dateKey !== todayKey()) {
      GameState.orderStats = { dateKey: todayKey(), harvested: {}, crafted: {} };
    }
    if (!GameState.orderStats.harvested) GameState.orderStats.harvested = {};
    if (!GameState.orderStats.crafted) GameState.orderStats.crafted = {};
  }

  /* ---------------- 进度 ---------------- */

  function progress(order) {
    initStatsIfNeeded();
    if (order.kind === 'deliver') {
      const n = (typeof Warehouse !== 'undefined') ? Warehouse.getCount(order.item) : 0;
      return { current: Math.min(n, order.count), target: order.count };
    }
    if (order.kind === 'craft') {
      const n = GameState.orderStats.crafted[order.item] || 0;
      return { current: Math.min(n, order.count), target: order.count };
    }
    // harvest：按品质阈值累计
    const need = QUALITY_RANK[order.quality] || 1;
    let n = 0;
    Object.keys(GameState.orderStats.harvested).forEach((k) => {
      const [cropId, q] = k.split('|');
      if (cropId !== order.item) return;
      if ((QUALITY_RANK[q] || 0) >= need) n += GameState.orderStats.harvested[k];
    });
    return { current: Math.min(n, order.count), target: order.count };
  }

  function isComplete(order) {
    const p = progress(order);
    return p.current >= p.target;
  }

  /* ---------------- 事件钩子 ---------------- */

  function onHarvest(cropId, quality) {
    initStatsIfNeeded();
    const key = cropId + '|' + (quality || 'common');
    GameState.orderStats.harvested[key] = (GameState.orderStats.harvested[key] || 0) + 1;
    refreshPanel();
  }

  function onCraft(itemId, qty) {
    initStatsIfNeeded();
    GameState.orderStats.crafted[itemId] = (GameState.orderStats.crafted[itemId] || 0) + (qty || 1);
    refreshPanel();
  }

  /* ---------------- 领取与刷新 ---------------- */

  function claim(id) {
    ensureToday();
    const order = GameState.orders.list.find((o) => o.id === id);
    if (!order || order.done) return false;
    if (!isComplete(order)) { showToast('订单还没完成', 'warning'); return false; }
    if (order.kind === 'deliver' && typeof Warehouse !== 'undefined') {
      if (!Warehouse.removeItem(order.item, order.count)) { showToast('仓库数量不足', 'warning'); return false; }
    }
    const r = order.reward || makeReward(GameState.level || 1);
    GameState.gold += r.gold;
    if (r.materials) GameState.materials = (GameState.materials || 0) + r.materials;
    if (r.seeds && typeof Warehouse !== 'undefined') Warehouse.addItem('seeds', r.seeds);
    if (r.blueprint) {
      GameState.blueprints = GameState.blueprints || [];
      const bp = (window.CONFIG && Array.isArray(CONFIG.blueprints)) ? pick(CONFIG.blueprints) : null;
      if (bp) GameState.blueprints.push(bp.id);
    }
    order.done = true;
    const parts = [`💰${r.gold}`];
    if (r.materials) parts.push(`材料×${r.materials}`);
    if (r.seeds) parts.push(`种子×${r.seeds}`);
    if (r.blueprint) parts.push('蓝图');
    showToast(`订单完成：${order.name} ×${order.count} → ${parts.join(' ')}`, 'gold');
    if (window.Telemetry && Telemetry.track) Telemetry.track('order_completed', { kind: order.kind, item: order.item });
    if (typeof SaveSystem !== 'undefined' && SaveSystem.save) SaveSystem.save();
    refreshPanel();
    return true;
  }

  function refresh() {
    ensureToday();
    if (GameState.orders.refreshed) { showToast('今天已经刷新过了', 'warning'); return false; }
    if ((GameState.gold || 0) < REFRESH_COST) { showToast('金币不足 200', 'warning'); return false; }
    GameState.gold -= REFRESH_COST;
    GameState.orders.list = generate();
    GameState.orders.refreshed = true;
    showToast('订单已刷新', 'info');
    if (typeof SaveSystem !== 'undefined' && SaveSystem.save) SaveSystem.save();
    refreshPanel();
    return true;
  }

  /* ---------------- UI ---------------- */

  let panelEl = null;

  function mount() {
    if (panelEl && document.body.contains(panelEl)) return;
    const right = document.querySelector('#farmScreen .farm-right');
    if (!right) return;
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.id = 'orderPanel';
    // 放在右栏最上方，进农场第一眼就能看到
    right.insertBefore(panel, right.firstChild);
    panelEl = panel;
  }

  function refreshPanel() {
    if (typeof document === 'undefined') return;
    mount();
    if (!panelEl) return;
    ensureToday();
    const list = GameState.orders.list || [];
    const rows = list.map((o) => {
      const p = progress(o);
      const pct = Math.round(p.current / p.target * 100);
      const color = o.done ? '#7fd96a' : (p.current >= p.target ? '#f2d28a' : '#8fb8a0');
      const q = o.quality ? `（${QUALITY_NAME[o.quality] || o.quality}以上）` : '';
      return `<div style="margin:6px 0;padding:8px;border:1px solid rgba(255,255,255,.08);border-radius:8px;${o.done ? 'opacity:.55;' : ''}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <span style="font-size:13px;">${o.icon} ${o.name}${q} ×${o.count}</span>
          <span style="font-size:12px;color:${color};">${o.done ? '已完成' : p.current + '/' + p.target}</span>
        </div>
        <div style="height:5px;background:rgba(255,255,255,.08);border-radius:3px;margin:6px 0 4px;">
          <div style="height:5px;width:${Math.min(100, pct)}%;background:${color};border-radius:3px;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:11px;color:#9fb3a4;">奖励 💰${(o.reward || {}).gold || 0}${(o.reward && o.reward.materials) ? ' · 材料×' + o.reward.materials : ''}</span>
          <button ${o.done || !isComplete(o) ? 'disabled' : ''} onclick="OrderSystem.claim('${o.id}')"
            style="padding:3px 10px;border-radius:6px;border:1px solid rgba(242,210,138,.5);background:${o.done || !isComplete(o) ? 'transparent' : 'rgba(242,210,138,.18)'};color:#f2d28a;cursor:pointer;font-size:12px;">
            ${o.done ? '已领取' : '领取'}
          </button>
        </div>
      </div>`;
    }).join('');
    panelEl.innerHTML = `
      <div class="panel-title" style="display:flex;justify-content:space-between;align-items:center;">
        <span>📋 今日订单</span>
        <button onclick="OrderSystem.refresh()" ${GameState.orders.refreshed ? 'disabled' : ''}
          style="font-size:11px;padding:2px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.18);background:transparent;color:#b9c8bd;cursor:pointer;">
          ${GameState.orders.refreshed ? '已刷新' : '刷新 200💰'}
        </button>
      </div>
      <div style="max-height:260px;overflow:auto;">${rows || '<div style="font-size:12px;color:#9fb3a4;">今日无订单</div>'}</div>`;
  }

  // 农场界面可见时每秒轻量刷新一次（不复刻 Farm.render 的调用链）
  function tick() {
    if (typeof document === 'undefined') return;
    const screen = document.getElementById('farmScreen');
    if (!screen || screen.classList.contains('hidden')) return;
    ensureToday();
    refreshPanel();
  }

  window.OrderSystem = {
    init, ensureToday, generate, claim, refresh, refreshPanel,
    onHarvest, onCraft, progress, isComplete,
    REFRESH_COST
  };

  if (typeof window !== 'undefined') {
    const boot = () => { init(); refreshPanel(); setInterval(tick, 1000); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})();

