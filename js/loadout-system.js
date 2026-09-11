// ================= v1.0 背包/安全箱/入场费系统 =================
const LoadoutSystem = {
  BAG_SIZE: 16,          // 背包格位
  GOLD_PER_SLOT: 50,     // 50金币占1格

  init() {
    if (!GameState.safeSlots) GameState.safeSlots = 1;
    if (!GameState.safeBox) GameState.safeBox = []; // 安全箱物品 [{type,id,name,icon,amount}]
    if (!GameState.weaponUpgrades) GameState.weaponUpgrades = {}; // 武器升级等级
    if (!GameState.forgedWeapons) GameState.forgedWeapons = [];
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

  // 局外武器升级
  getWeaponLevel(weaponId) { return GameState.weaponUpgrades[weaponId] || 0; },

  getUpgradeCost(weaponId) {
    const lv = this.getWeaponLevel(weaponId);
    if (lv >= 3) return null;
    const costs = [
      { gold: 200, materials: { iron: 5 } },
      { gold: 800, materials: { iron: 15, crystal: 3 } },
      { gold: 2000, materials: { iron: 30, crystal: 10, bossFang: 1 } }
    ];
    return costs[lv];
  },

  upgradeWeapon(weaponId) {
    const cost = this.getUpgradeCost(weaponId);
    if (!cost) { showToast('已满级', 'warning'); return; }
    if (GameState.gold < cost.gold) { showToast('金币不足', 'warning'); return; }
    // 检查材料
    for (const [mat, need] of Object.entries(cost.materials)) {
      const have = (GameState.warehouse.materials && GameState.warehouse.materials[mat]) || 0;
      if (have < need) { showToast(`材料不足：需要 ${mat}×${need}`, 'warning'); return; }
    }
    // 扣除
    GameState.gold -= cost.gold;
    for (const [mat, need] of Object.entries(cost.materials)) {
      GameState.warehouse.materials[mat] -= need;
    }
    GameState.weaponUpgrades[weaponId] = (GameState.weaponUpgrades[weaponId] || 0) + 1;
    const lv = GameState.weaponUpgrades[weaponId];
    if (!GameState.forgedWeapons.includes(weaponId)) GameState.forgedWeapons.push(weaponId);
    showToast(`🔨 武器升级！等级 ${lv}`, 'gold');
    if (typeof AchievementSystem !== 'undefined') AchievementSystem.trackEvent('kill', 0); // trigger check
    if (typeof SaveSystem !== 'undefined') SaveSystem.save();
  },

  // 获取武器实际属性（含升级加成）
  getWeaponStats(baseWeapon) {
    const lv = this.getWeaponLevel(baseWeapon.id);
    if (lv === 0) return { ...baseWeapon };
    const mult = 1 + lv * 0.15; // 每级+15%伤害
    return {
      ...baseWeapon,
      damage: Math.round(baseWeapon.damage * mult),
      level: lv,
      desc: baseWeapon.description + `（+${lv}）`
    };
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
