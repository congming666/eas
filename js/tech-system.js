// ================= v0.8.0 建筑升级 + 科技树（网页版） =================
(function () {
  'use strict';

  // ===== 建筑定义 =====
  const BUILDINGS = {
    workshop: {
      id: 'workshop', name: '工坊', icon: '🔨',
      description: '加工作物为高价值产品',
      maxLevel: 5,
      baseCost: { gold: 200, materials: 10 },
      costMultiplier: 1.8,
      effects: [
        { level: 1, desc: '解锁基础加工（小麦→面粉）' },
        { level: 2, desc: '加工速度+20%' },
        { level: 3, desc: '解锁高级加工（向日葵→油）' },
        { level: 4, desc: '加工产量+30%' },
        { level: 5, desc: '解锁终极加工（传说产品）' }
      ]
    },
    greenhouse: {
      id: 'greenhouse', name: '温室', icon: '🏠',
      description: '反季节作物，不受天气影响',
      maxLevel: 3,
      baseCost: { gold: 500, materials: 20 },
      costMultiplier: 2.0,
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
      costMultiplier: 1.8,
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
      costMultiplier: 2.5,
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
        { id: 'agri_5', name: '基因优化', desc: '传说作物掉率+10%', cost: 5, requires: ['agri_3', 'agri_4'] }
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

  function getUpgradeCost(id) {
    const b = BUILDINGS[id];
    const level = getBuildingLevel(id);
    if (level >= b.maxLevel) return null;
    const mul = Math.pow(b.costMultiplier, level);
    return {
      gold: Math.floor(b.baseCost.gold * mul),
      materials: Math.floor(b.baseCost.materials * mul)
    };
  }

  function upgradeBuilding(id) {
    const b = BUILDINGS[id];
    const level = getBuildingLevel(id);
    if (level >= b.maxLevel) return false;
    const cost = getUpgradeCost(id);
    if (GameState.gold < cost.gold || (GameState.materials || 0) < cost.materials) {
      if (typeof showToast === 'function') showToast('资源不足', 'warning');
      return false;
    }
    GameState.gold -= cost.gold;
    GameState.materials = (GameState.materials || 0) - cost.materials;
    GameState.buildings[id].level = level + 1;
    if (id === 'lab' && level + 1 >= 1) GameState.labUnlocked = true;
    if (typeof showToast === 'function') showToast(`🎉 ${b.name} 升级到 Lv.${level + 1}！`, 'gold');
    applyBuildingEffects();
    return true;
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
    const points = Math.floor(base * diffMul);
    addTechPoints(points);
    return points;
  }

  // 暴露全局
  window.TechSystem = {
    BUILDINGS, TECH_TREES,
    init, getBuilding, getBuildingLevel, getAllBuildings,
    getUpgradeCost, upgradeBuilding, applyBuildingEffects,
    getTechTree, getAllTechTrees, isTechUnlocked, canUnlockTech,
    unlockTech, addTechPoints, applyTechEffects, getTechBonus,
    onExpeditionComplete
  };
})();
