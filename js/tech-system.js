// ================= v0.8.0 建筑升级 + 科技树（网页版） =================
(function () {
  'use strict';

  // ===== 建筑定义 =====
  // W4：L2+ 升级掺入远征材料（matCost：wood 硬木 / iron 铁块 / crystal 灵晶 / bossFang Boss獠牙，走仓库）
  // W4：requires 跨建筑 AND 依赖（'building:level' 格式），建筑树有形状而不只是列表
  // W2：升级费用统一乘全局 markup（econLoop.globalMarkup = 1 + 0.1×总级数），单池通胀
  const BUILDINGS = {
    workshop: {
      id: 'workshop', name: '加工研究所', icon: '🔨',
      description: '每级提升加工速度10%；配方等级在加工工坊升级',
      maxLevel: 5,
      baseCost: { gold: 200, materials: 10 },
      costMultiplier: 1.65,
      matCost: { 2: { wood: 6 }, 3: { wood: 10, iron: 4 }, 4: { iron: 8, crystal: 2 }, 5: { crystal: 4 } },
      requires: [],
      effects: [
        { level: 1, desc: '加工速度 +10%' },
        { level: 2, desc: '加工速度 +20%' },
        { level: 3, desc: '加工速度 +30%' },
        { level: 4, desc: '加工速度 +40%' },
        { level: 5, desc: '加工速度 +50%' }
      ]
    },
    greenhouse: {
      id: 'greenhouse', name: '温室', icon: '🏠',
      description: '反季节作物，不受天气影响',
      maxLevel: 3,
      baseCost: { gold: 500, materials: 20 },
      costMultiplier: 2.5,
      matCost: { 2: { wood: 8 }, 3: { wood: 12, crystal: 2 } },
      requires: [],
      effects: [
        { level: 1, desc: '解锁 4 格温室农田' },
        { level: 2, desc: '温室作物生长+30%' },
        { level: 3, desc: '温室作物变异率+20%' }
      ]
    },
    barn: {
      id: 'barn', name: '畜舍', icon: '🐔',
      description: '养鸡养蜂，产出远征消耗品',
      maxLevel: 4,
      baseCost: { gold: 300, materials: 15 },
      costMultiplier: 1.9,
      matCost: { 2: { wood: 5 }, 3: { iron: 5 }, 4: { iron: 8, bossFang: 1 } },
      requires: [],
      effects: [
        { level: 1, desc: '解锁养鸡（每天产蛋，远征回血食物）' },
        { level: 2, desc: '鸡数量+2，产蛋速度+50%' },
        { level: 3, desc: '解锁养蜂（产蜂蜜，远征能量+）' },
        { level: 4, desc: '畜舍产品品质提升，可加工高级食物' }
      ]
    },
    lab: {
      id: 'lab', name: '研究所', icon: '🔬',
      description: '解锁科技树，研究新能力',
      maxLevel: 3,
      baseCost: { gold: 800, materials: 30 },
      costMultiplier: 2.6,
      matCost: { 2: { iron: 6, crystal: 2 }, 3: { crystal: 5, bossFang: 2 } },
      requires: ['workshop:1'], // W4 AND 依赖：先建加工研究所
      effects: [
        { level: 1, desc: '解锁科技树（农业线）' },
        { level: 2, desc: '解锁战斗科技线' },
        { level: 3, desc: '解锁生存科技线，科技点+50%' }
      ]
    }
  };

  // ===== 科技树定义 =====
  const TECH_TREES = {
    agriculture: {
      id: 'agriculture', name: '农业', icon: '🌾', color: '#66cc44',
      nodes: [
        { id: 'agri_1', name: '精耕细作', desc: '所有作物产量+10%', cost: 1, requires: [] },
        { id: 'agri_2', name: '优质肥料', desc: '作物品质+15%', cost: 2, requires: ['agri_1'] },
        { id: 'agri_3', name: '杂交育种', desc: '变异率+20%', cost: 3, requires: ['agri_2'] },
        { id: 'agri_4', name: '温室栽培', desc: '反季节作物解锁', cost: 2, requires: ['agri_1'] },
        { id: 'agri_5', name: '基因优化', desc: '传说作物掉率+10%', cost: 5, requires: ['agri_3', 'agri_4'] },
        // W5 农场压力防御：暴雨/野猪/蝗灾受灾地块数减半
        { id: 'agri_6', name: '结界栅栏', desc: '农场天灾（暴雨/野猪/蝗灾）受灾数量减半', cost: 3, requires: ['agri_2'] },
        // W7 投资型科技（VS Greed 式复利支线）：先投资经济 vs 先投资战力的路线分岔
        { id: 'market_1', name: '市场嗅觉 I', desc: '远征结算金币 +8%', cost: 1, requires: ['agri_1'] },
        { id: 'market_2', name: '市场嗅觉 II', desc: '远征结算金币 +8%（累计+16%）', cost: 2, requires: ['market_1'] },
        { id: 'market_3', name: '市场嗅觉 III', desc: '远征结算金币 +8%（累计+24%）', cost: 3, requires: ['market_2'] },
        { id: 'market_4', name: '市场嗅觉 IV', desc: '远征结算金币 +8%（累计+32%）', cost: 4, requires: ['market_3'] },
        { id: 'market_5', name: '市场嗅觉 V', desc: '远征结算金币 +8%（累计+40%）', cost: 5, requires: ['market_4'] }
      ]
    },
    combat: {
      id: 'combat', name: '战斗', icon: '⚔️', color: '#cc4444',
      nodes: [
        { id: 'combat_1', name: '武器打磨', desc: '所有武器伤害+10%', cost: 1, requires: [] },
        { id: 'combat_2', name: '连击精通', desc: '连击伤害加成+2%/层', cost: 2, requires: ['combat_1'] },
        { id: 'combat_3', name: '闪避训练', desc: '完美闪避窗口+20ms', cost: 2, requires: ['combat_1'] },
        { id: 'combat_4', name: '怒气掌控', desc: '怒气积累+20%', cost: 3, requires: ['combat_2', 'combat_3'] },
        { id: 'combat_5', name: '战神血脉', desc: '低血量时伤害+30%', cost: 5, requires: ['combat_4'] }
      ]
    },
    survival: {
      id: 'survival', name: '生存', icon: '🔥', color: '#cc8844',
      nodes: [
        { id: 'surv_1', name: '火把改良', desc: '火把消耗-20%', cost: 1, requires: [] },
        { id: 'surv_2', name: '急救术', desc: '草药包回复+30%', cost: 2, requires: ['surv_1'] },
        { id: 'surv_3', name: '视野拓展', desc: '基础视野+15%', cost: 2, requires: ['surv_1'] },
        { id: 'surv_4', name: '野外求生', desc: '补给掉落+25%', cost: 3, requires: ['surv_2', 'surv_3'] },
        { id: 'surv_5', name: '不屈意志', desc: '血量低于20%时无敌1秒（冷却30s）', cost: 5, requires: ['surv_4'] }
      ]
    }
  };

  // ===== 运行时状态 =====
  function init() {
    if (!GameState.buildings) {
      GameState.buildings = {};
      Object.keys(BUILDINGS).forEach(id => { GameState.buildings[id] = { level: 0 }; });
    }
    if (!GameState.techPoints) GameState.techPoints = 0;
    if (!GameState.unlockedTech) GameState.unlockedTech = [];
    if (!GameState.labUnlocked) GameState.labUnlocked = false;
  }

  function getBuilding(id) { return BUILDINGS[id]; }
  function getBuildingLevel(id) { return GameState.buildings[id] ? GameState.buildings[id].level : 0; }
  function getAllBuildings() { return Object.values(BUILDINGS); }

  // ===== 成本曲线（对标 Kittens Game）=====
  // 金币：baseCost × costMultiplier^(level-1)；材料：baseCost.materials × 2.5^(level-2)
  // overrides[level] 可做人工 ±10% 微调（goldMul / matMul），默认不启用。
  function computeCost(b, level) {
    const ov = (b.overrides || {})[level] || {};
    const mul = Math.pow(b.costMultiplier, level - 1);
    return {
      gold: Math.floor(b.baseCost.gold * mul * (ov.goldMul || 1)),
      materials: Math.floor(b.baseCost.materials * mul * (ov.matMul || 1))
    };
  }

  function computeMaterials(b, level) {
    if (level < 2) return 0;
    return Math.floor(b.baseCost.materials * Math.pow(2.5, level - 2));
  }

  // 把材料总量按该等级原有的材料种类均分（种类沿用 matCost，数量走公式）
  function distributeMatItems(b, level, qty) {
    const types = Object.keys((b.matCost || {})[level] || {});
    if (!types.length || qty <= 0) return null;
    const per = Math.floor(qty / types.length);
    const rest = qty - per * types.length;
    const out = {};
    types.forEach((k, i) => { out[k] = per + (i < rest ? 1 : 0); });
    return out;
  }

  function getUpgradeCost(id) {
    const b = BUILDINGS[id];
    const level = getBuildingLevel(id);
    if (level >= b.maxLevel) return null;
    // W2 全局 markup：1 + 0.1×总级数（建筑+科技+土地升级），单池通胀
    const markup = (window.EconLoop && EconLoop.globalMarkup) ? EconLoop.globalMarkup() : 1;
    const base = computeCost(b, level + 1);
    const cost = {
      gold: Math.floor(base.gold * markup),
      materials: base.materials
    };
    // W4：L2+ 掺入远征材料（硬木/铁块/灵晶/Boss獠牙，走仓库）
    const matItems = distributeMatItems(b, level + 1, computeMaterials(b, level + 1));
    if (matItems) {
      cost.matItems = matItems;
      // 材料总量与材料清单对齐，避免显示 27 而条目只有 25
      cost.materials = Object.values(matItems).reduce((a, n) => a + n, 0);
    }
    return cost;
  }

  // W4 AND 依赖检查：'workshop:1' = 加工研究所至少 Lv1
  function buildingRequiresMet(id) {
    const b = BUILDINGS[id];
    if (!b.requires || !b.requires.length) return true;
    return b.requires.every(r => {
      const m = /^(\w+):(\d+)$/.exec(r);
      if (!m) return true;
      return getBuildingLevel(m[1]) >= +m[2];
    });
  }

  function missingMatItems(cost) {
    if (!cost.matItems || typeof Warehouse === 'undefined') return [];
    return Object.keys(cost.matItems).filter(k => Warehouse.getCount(k) < cost.matItems[k]);
  }

  function upgradeBuilding(id) {
    const b = BUILDINGS[id];
    const level = getBuildingLevel(id);
    if (level >= b.maxLevel) return false;
    if (!buildingRequiresMet(id)) {
      if (typeof showToast === 'function') showToast(`需要先满足前置建筑：${_requiresText(b)}`, 'warning');
      return false;
    }
    const cost = getUpgradeCost(id);
    if (GameState.gold < cost.gold || (GameState.materials || 0) < cost.materials) {
      if (typeof showToast === 'function') showToast('资源不足', 'warning');
      return false;
    }
    const missing = missingMatItems(cost);
    if (missing.length) {
      const need = missing.map(k => {
        const def = cost.matItems[k] - (window.Warehouse ? Warehouse.getCount(k) : 0);
        return `${_matName(k)}×${def}`;
      }).join('、');
      if (typeof showToast === 'function') showToast(`缺少材料：${need}`, 'warning');
      return false;
    }
    GameState.gold -= cost.gold;
    GameState.materials = (GameState.materials || 0) - cost.materials;
    if (cost.matItems && typeof Warehouse !== 'undefined') Object.keys(cost.matItems).forEach(k => Warehouse.removeItem(k, cost.matItems[k]));
    GameState.buildings[id].level = level + 1;
    // W2 实付记账（RefundAll 全额退还的依据）
    GameState.buildings[id].spentGold = (GameState.buildings[id].spentGold || 0) + cost.gold;
    if (id === 'lab' && level + 1 >= 1) GameState.labUnlocked = true;
    if (typeof showToast === 'function') showToast(`🎉 ${b.name} 升级到 Lv.${level + 1}！`, 'gold');
    applyBuildingEffects();
    return true;
  }

  function _requiresText(b) {
    const names = { workshop: '加工研究所', greenhouse: '温室', barn: '畜舍', lab: '研究所' };
    return b.requires.map(r => { const m = /^(\w+):(\d+)$/.exec(r); return m ? `${names[m[1]] || m[1]} Lv${m[2]}` : r; }).join(' + ');
  }

  function _matName(k) {
    const names = { wood: '硬木', iron: '铁块', crystal: '灵晶', bossFang: 'Boss獠牙' };
    return names[k] || k;
  }

  function applyBuildingEffects() {
    // 建筑效果在对应系统中读取
  }

  // ===== 科技树 =====
  function getTechTree(id) { return TECH_TREES[id]; }
  function getAllTechTrees() { return Object.values(TECH_TREES); }
  function isTechUnlocked(techId) { return GameState.unlockedTech.includes(techId); }
  function canUnlockTech(techId) {
    const tree = Object.values(TECH_TREES).find(t => t.nodes.find(n => n.id === techId));
    if (!tree) return false;
    const node = tree.nodes.find(n => n.id === techId);
    if (!node || isTechUnlocked(techId)) return false;
    if (GameState.techPoints < node.cost) return false;
    return node.requires.every(r => isTechUnlocked(r));
  }

  function unlockTech(techId) {
    if (!canUnlockTech(techId)) return false;
    const tree = Object.values(TECH_TREES).find(t => t.nodes.find(n => n.id === techId));
    const node = tree.nodes.find(n => n.id === techId);
    GameState.techPoints -= node.cost;
    GameState.unlockedTech.push(techId);
    if (typeof showToast === 'function') showToast(`🔬 解锁科技：${node.name}`, 'gold');
    applyTechEffects();
    return true;
  }

  function addTechPoints(amount) {
    GameState.techPoints += amount;
    if (typeof showToast === 'function') showToast(`获得 ${amount} 科技点`, 'info');
  }

  function applyTechEffects() {
    // 科技效果在对应系统中读取
    // 示例：combat_1 武器伤害+10% 在武器伤害计算时读取
  }

  // 获取科技加成（供其他系统调用）
  function getTechBonus(techId) {
    if (!isTechUnlocked(techId)) return 0;
    const bonuses = {
      agri_1: 0.10, agri_2: 0.15, agri_3: 0.20, agri_5: 0.10,
      combat_1: 0.10, combat_2: 0.02, combat_3: 0.02, combat_4: 0.20, combat_5: 0.30,
      surv_1: 0.20, surv_2: 0.30, surv_3: 0.15, surv_4: 0.25
    };
    return bonuses[techId] || 0;
  }

  // 远征通关给科技点
  function onExpeditionComplete(tier, difficulty) {
    const base = tier * 2;
    const diffMul = difficulty === 'hard' ? 1.5 : difficulty === 'nightmare' ? 2.0 : 1.0;
    // W8 建筑配装：星象仪/灵晶蒸馏器插入研究所 → 科技点加成
    const slotMul = (window.EconLoop && EconLoop.slotBonus) ? (1 + EconLoop.slotBonus('lab', 'tech')) : 1;
    const points = Math.max(1, Math.floor(base * diffMul * slotMul));
    addTechPoints(points);
    return points;
  }

  // 暴露全局
  window.TechSystem = {
    BUILDINGS, TECH_TREES,
    init, getBuilding, getBuildingLevel, getAllBuildings,
    getUpgradeCost, computeCost, computeMaterials, distributeMatItems, upgradeBuilding, applyBuildingEffects,
    buildingRequiresMet, missingMatItems, _requiresText,
    getTechTree, getAllTechTrees, isTechUnlocked, canUnlockTech,
    unlockTech, addTechPoints, applyTechEffects, getTechBonus,
    onExpeditionComplete
  };
})();


