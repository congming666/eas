// ================= v1.0 背包/安全箱/入场费系统 =================
const LoadoutSystem = {
  BAG_SIZE: 16,          // 背包格位
  GOLD_PER_SLOT: 50,     // 50金币占1格

  init() {
    if (!GameState.safeSlots) GameState.safeSlots = 1;
    if (!GameState.safeBox) GameState.safeBox = [];
    if (!GameState.forgedWeapons) GameState.forgedWeapons = [];
    // v1.2 强制金币10万
    GameState.gold = 100000;
    // v1.1 旧存档迁移：weaponInventory → weaponInstances
    if (!GameState.weaponInstances) {
      GameState.weaponInstances = [];
      const inv = GameState.weaponInventory || {};
      let n = 1;
      for (const [wid, cnt] of Object.entries(inv)) {
        for (let i = 0; i < cnt; i++) {
          const oldLv = (GameState.weaponUpgrades && GameState.weaponUpgrades[wid]) || 0;
          GameState.weaponInstances.push({ uid: 'w_' + String(n++).padStart(3,'0'), weaponId: wid, level: oldLv });
        }
      }
      if (GameState.weaponInstances.length === 0) {
        GameState.weaponInstances = [
          { uid: 'w_001', weaponId: 'harvest_sickle', level: 0 },
          { uid: 'w_002', weaponId: 'pea_repeater', level: 0 },
          { uid: 'w_003', weaponId: 'vine_staff', level: 0 }
        ];
      }
    }
    if (!GameState.loadoutWeaponUids) GameState.loadoutWeaponUids = [];
  },

  // 计算物品占几格
  getSlotSize(item) {
    if (item.type === 'gold') return Math.max(1, Math.ceil(item.amount / this.GOLD_PER_SLOT));
    if (item.rarity === 'legendary' || item.type === 'blueprint') return 3;
    if (item.rarity === 'rare' || item.type === 'weapon' || item.type === 'weapon_part') return 2;
    return 1;
  },

  // 计算背包已用格位
  usedSlots(bag) {
    return bag.reduce((sum, item) => sum + this.getSlotSize(item), 0);
  },

  // 尝试添加物品（返回是否成功）
  canAdd(bag, item) {
    const slots = this.getSlotSize(item);
    return this.usedSlots(bag) + slots <= this.BAG_SIZE;
  },

  addToBag(bag, item) {
    if (!this.canAdd(bag, item)) {
      if (typeof showToast === 'function') showToast('背包已满！', 'warning');
      return false;
    }
    // 同类金币堆叠
    if (item.type === 'gold') {
      const existing = bag.find(i => i.type === 'gold');
      if (existing) { existing.amount += item.amount; return true; }
    }
    bag.push(item);
    return true;
  },

  // 安全箱操作
  getSafeCapacity() { return GameState.safeSlots || 1; },

  upgradeSafeCost() {
    const cur = GameState.safeSlots || 1;
    return [0, 2000, 5000][cur] || null; // 1->2: 2000, 2->3: 5000
  },

  upgradeSafe() {
    const cost = this.upgradeSafeCost();
    if (cost === null) { showToast('安全箱已满级', 'warning'); return; }
    if (GameState.gold < cost) { showToast('金币不足', 'warning'); return; }
    GameState.gold -= cost;
    GameState.safeSlots++;
    showToast(`安全箱升级！现在 ${GameState.safeSlots} 格`, 'gold');
    if (typeof SaveSystem !== 'undefined') SaveSystem.save();
  },

  // v1.1 武器实例管理
  _nextUid() {
    const used = (GameState.weaponInstances || []).map(w => parseInt(w.uid.split('_')[1]) || 0);
    return 'w_' + (Math.max(0, ...used) + 1).toString().padStart(3, '0');
  },

  getWeaponInstance(uid) {
    return (GameState.weaponInstances || []).find(w => w.uid === uid);
  },

  getWeaponCount(weaponId) {
    return (GameState.weaponInstances || []).filter(w => w.weaponId === weaponId).length;
  },

  craftWeapon(weaponId) {
    const wpn = CONFIG.weapons.find(w => w.id === weaponId);
    if (!wpn) return;
    if (wpn.blueprint && !(GameState.blueprints && GameState.blueprints.includes(weaponId))) {
      showToast('未解锁蓝图！', 'warning'); return;
    }
    const costs = {
      harvest_sickle: { gold: 100, materials: { wood: 3, iron: 2 } },
      pea_repeater: { gold: 150, materials: { wood: 5, iron: 3 } },
      vine_staff: { gold: 200, materials: { wood: 8, crystal: 2 } },
      throwing_knife: { gold: 500, materials: { iron: 10, crystal: 3 } },
      flame_bow: { gold: 1000, materials: { wood: 15, iron: 8, crystal: 5 } }
    };
    const cost = costs[weaponId];
    if (!cost) { showToast('无法打造', 'warning'); return; }
    if (GameState.gold < cost.gold) { showToast('金币不足', 'warning'); return; }
    for (const [mat, need] of Object.entries(cost.materials)) {
      const have = (GameState.warehouse.materials && GameState.warehouse.materials[mat]) || 0;
      if (have < need) { showToast(`材料不足：需要 ${mat}×${need}`, 'warning'); return; }
    }
    GameState.gold -= cost.gold;
    for (const [mat, need] of Object.entries(cost.materials)) {
      GameState.warehouse.materials[mat] -= need;
    }
    const inst = { uid: this._nextUid(), weaponId, level: 0 };
    GameState.weaponInstances.push(inst);
    showToast(`🔨 打造完成：${wpn.name}！已入库`, 'gold');
    if (typeof AchievementSystem !== 'undefined') AchievementSystem.checkAll();
    if (typeof SaveSystem !== 'undefined') SaveSystem.save();
  },

  // 死亡时损失所有带入的武器实例
  loseBroughtWeapon() {
    const uids = GameState.loadoutWeaponUids || [];
    uids.forEach(uid => {
      const idx = (GameState.weaponInstances || []).findIndex(w => w.uid === uid);
      if (idx >= 0) {
        const inst = GameState.weaponInstances[idx];
        const wpn = CONFIG.weapons.find(w => w.id === inst.weaponId);
        GameState.weaponInstances.splice(idx, 1);
        showToast(`💀 永久失去武器：${wpn ? wpn.name : inst.weaponId}`, 'warning');
      }
    });
    GameState.loadoutWeaponUids = [];
  },

  // 升级单个武器实例
  getUpgradeCost(uid) {
    const inst = this.getWeaponInstance(uid);
    if (!inst || inst.level >= 10) return null; // v1.1 每把武器可升10级
    const costs = [
      { gold: 200, materials: { iron: 3 } },
      { gold: 400, materials: { iron: 5 } },
      { gold: 700, materials: { iron: 8, crystal: 1 } },
      { gold: 1000, materials: { iron: 12, crystal: 2 } },
      { gold: 1500, materials: { iron: 20, crystal: 4 } },
      { gold: 2200, materials: { iron: 30, crystal: 6 } },
      { gold: 3000, materials: { iron: 40, crystal: 8, bossFang: 1 } },
      { gold: 4000, materials: { iron: 50, crystal: 12, bossFang: 1 } },
      { gold: 5500, materials: { iron: 70, crystal: 18, bossFang: 2 } },
      { gold: 8000, materials: { iron: 100, crystal: 25, bossFang: 3 } }
    ];
    return costs[inst.level];
  },

  upgradeWeapon(uid) {
    const inst = this.getWeaponInstance(uid);
    if (!inst) { showToast('武器不存在', 'warning'); return; }
    const cost = this.getUpgradeCost(uid);
    if (!cost) { showToast('已满级(10级)', 'warning'); return; }
    if (GameState.gold < cost.gold) { showToast('金币不足', 'warning'); return; }
    for (const [mat, need] of Object.entries(cost.materials)) {
      const have = (GameState.warehouse.materials && GameState.warehouse.materials[mat]) || 0;
      if (have < need) { showToast(`材料不足：需要 ${mat}×${need}`, 'warning'); return; }
    }
    GameState.gold -= cost.gold;
    for (const [mat, need] of Object.entries(cost.materials)) {
      GameState.warehouse.materials[mat] -= need;
    }
    inst.level++;
    const wpn = CONFIG.weapons.find(w => w.id === inst.weaponId);
    if (!GameState.forgedWeapons.includes(inst.weaponId)) GameState.forgedWeapons.push(inst.weaponId);
    showToast(`🔨 ${wpn ? wpn.name : inst.weaponId} 升至 Lv.${inst.level}`, 'gold');
    if (typeof AchievementSystem !== 'undefined') AchievementSystem.checkAll();
    if (typeof SaveSystem !== 'undefined') SaveSystem.save();
  },

  // 获取武器实例实际属性（含等级加成）
  getWeaponStats(baseWeapon, level) {
    const lv = level || 0;
    if (lv === 0) return { ...baseWeapon };
    const mult = 1 + lv * 0.1; // 每级+10%伤害
    return {
      ...baseWeapon,
      damage: Math.round(baseWeapon.damage * mult),
      level: lv
    };
  },

  // 按uid获取实际属性
  getInstanceStats(uid) {
    const inst = this.getWeaponInstance(uid);
    if (!inst) return null;
    const base = CONFIG.weapons.find(w => w.id === inst.weaponId);
    if (!base) return null;
    return this.getWeaponStats(base, inst.level);
  },

  // 局内临时武器配件
  rollTempWeapon(baseWeapon, tier) {
    const bonus = 1 + (tier - 1) * 0.3;
    const parts = [
      { id: 'scope', name: '瞄准镜', desc: '射程+15%', apply: w => ({ ...w, range: w.range * 1.15 }) },
      { id: 'toxic', name: '毒弹头', desc: '攻击带毒', apply: w => ({ ...w, toxic: true }) },
      { id: 'rapid', name: '扩容弹夹', desc: '射速+12%', apply: w => ({ ...w, cooldown: w.cooldown * 0.88 }) },
      { id: 'sharp', name: '锋锐', desc: '伤害+25%', apply: w => ({ ...w, damage: w.damage * 1.25 }) }
    ];
    const part = parts[Math.floor(Math.random() * parts.length)];
    const w = { ...baseWeapon, damage: Math.round(baseWeapon.damage * bonus) };
    return part.apply(w);
  }
};

if (typeof window !== 'undefined') window.LoadoutSystem = LoadoutSystem;
