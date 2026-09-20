// ================= v1.0 背包/安全箱/入场费系统 =================
const LoadoutSystem = {
  BAG_SIZE: 16,          // 背包格位
  GOLD_PER_SLOT: 100,    // 100金币占1格

  init() {
    if (!GameState.safeSlots) GameState.safeSlots = 1;
    if (!GameState.safeBox) GameState.safeBox = [];
    if (!GameState.forgedWeapons) GameState.forgedWeapons = [];
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
    if (cost === null) { showToast('安全箱已满级', 'warning'); return false; }
    if (GameState.gold < cost) { showToast('金币不足', 'warning'); return false; }
    GameState.gold -= cost;
    GameState.safeSlots++;
    if (window.Telemetry) Telemetry.track('safe_upgrade', { slots: GameState.safeSlots });
    showToast(`安全箱升级！现在 ${GameState.safeSlots} 格`, 'gold');
    if (typeof SaveSystem !== 'undefined') SaveSystem.save();
    return true;
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

  // v5.4 修为只用于角色修行台升级；武器锻造/升级仅消耗作物产出材料（修为抵扣已移除）
  // v5.1 打造费用（唯一数据源，game.js 铁匠铺 UI 与测试/数据表均引用此处）
  CRAFT_COSTS: {
    harvest_sickle: { gold: 100, materials: { wood: 3, iron: 2 } },
    pea_repeater: { gold: 150, materials: { wood: 5, iron: 3 } },
    vine_staff: { gold: 200, materials: { wood: 8, crystal: 2 } },
    throwing_knife: { gold: 500, materials: { iron: 10, crystal: 3 } },
    flame_bow: { gold: 1000, materials: { wood: 15, iron: 8, crystal: 5 } }
  },
  // v5.1 武器 1→10 级升级费用（索引 = 当前等级）
  UPGRADE_COSTS: [
    { gold: 150, materials: { iron: 2, fiber: 4 } },
    { gold: 300, materials: { iron: 4, wood: 6 } },
    { gold: 500, materials: { iron: 6, crystal: 1, stone: 6 } },
    { gold: 800, materials: { iron: 8, crystal: 2, venom: 2 } },
    { gold: 1200, materials: { iron: 12, crystal: 3, carapace: 4 } },
    { gold: 1700, materials: { iron: 17, crystal: 5, venom: 4, refined_iron: 1 } },
    { gold: 2300, materials: { iron: 26, crystal: 7, soul_ash: 2, bossFang: 1 } },
    { gold: 3000, materials: { iron: 30, crystal: 10, refined_iron: 2, bossFang: 1 } },
    { gold: 4000, materials: { iron: 40, crystal: 14, soul_ash: 5, refined_iron: 3, bossFang: 2 } },
    { gold: 5200, materials: { iron: 48, crystal: 20, soul_ash: 8, refined_iron: 5, bossFang: 3 } }
  ],
  matName(mat) {
    const r = (typeof CONFIG !== 'undefined' && CONFIG.resources && CONFIG.resources[mat]) || (typeof CONFIG !== 'undefined' && CONFIG.materials && CONFIG.materials[mat]);
    return r ? r.name : mat;
  },
  // v5.4 反查每种锻造材料由哪些作物产出（供铁匠铺 UI 标注来源）
  matSources(mat) {
    const out = [];
    const cm = (typeof CONFIG !== 'undefined' && CONFIG.cropMaterials) || {};
    Object.entries(cm).forEach(([cropId, arr]) => {
      (arr || []).forEach(tuple => {
        if (tuple && tuple[0] === mat) {
          const crop = CONFIG.crops.find(c => c.id === cropId);
          const name = crop ? crop.name : cropId;
          if (!out.includes(name)) out.push(name);
        }
      });
    });
    return out;
  },
  materialSourceText(mat) {
    const src = this.matSources(mat);
    return src.length ? ('来源作物：' + src.join('、')) : '来源：远征掉落/工坊精炼';
  },
  getCultivationCost() { return 0; }, // v5.4 已废除，保留空壳避免旧调用报错

  craftWeapon(weaponId) {
    const wpn = CONFIG.weapons.find(w => w.id === weaponId);
    if (!wpn) return;
    if (wpn.blueprint && !(GameState.blueprints && GameState.blueprints.includes(weaponId))) {
      showToast('未解锁蓝图！', 'warning'); return;
    }
    const cost = this.CRAFT_COSTS[weaponId];
    if (!cost) { showToast('无法打造', 'warning'); return; }
    if (GameState.gold < cost.gold) { showToast('金币不足', 'warning'); return; }
    for (const [mat, need] of Object.entries(cost.materials)) {
      const have = (GameState.warehouse.materials && GameState.warehouse.materials[mat]) || 0;
      if (have < need) { showToast('材料不足：' + this.matName(mat) + '×' + need, 'warning'); return; }
    }
    for (const [mat, need] of Object.entries(cost.materials)) {
      GameState.warehouse.materials[mat] -= need;
    }
    GameState.gold -= cost.gold;
    const inst = { uid: this._nextUid(), weaponId, level: 0 };
    GameState.weaponInstances.push(inst);
    if (window.Telemetry) Telemetry.track('weapon_craft', { weaponId });
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
    return this.UPGRADE_COSTS[inst.level];
  },

  upgradeWeapon(uid) {
    const inst = this.getWeaponInstance(uid);
    if (!inst) { showToast('武器不存在', 'warning'); return; }
    const cost = this.getUpgradeCost(uid);
    if (!cost) { showToast('已满级(10级)', 'warning'); return; }
    if (GameState.gold < cost.gold) { showToast('金币不足', 'warning'); return; }
    for (const [mat, need] of Object.entries(cost.materials)) {
      const have = (GameState.warehouse.materials && GameState.warehouse.materials[mat]) || 0;
      if (have < need) { showToast('材料不足：' + this.matName(mat) + '×' + need, 'warning'); return; }
    }
    for (const [mat, need] of Object.entries(cost.materials)) {
      GameState.warehouse.materials[mat] -= need;
    }
    GameState.gold -= cost.gold;
    inst.level++;
    if (window.Telemetry) Telemetry.track('weapon_upgrade', { weaponId: inst.weaponId, level: inst.level });
    const wpn = CONFIG.weapons.find(w => w.id === inst.weaponId);
    if (!GameState.forgedWeapons.includes(inst.weaponId)) GameState.forgedWeapons.push(inst.weaponId);
    showToast(`🔨 ${wpn ? wpn.name : inst.weaponId} 升至 Lv.${inst.level}`, 'gold');
    if (typeof AchievementSystem !== 'undefined') AchievementSystem.checkAll();
    if (typeof SaveSystem !== 'undefined') SaveSystem.save();
  },

  // 获取武器实例实际属性（含等级加成）
  getWeaponStats(baseWeapon, level) {
    const lv = level || 0;
    let stats = { ...baseWeapon };
    if (lv > 0) {
      const mult = 1 + lv * 0.1; // 每级+10%伤害
      stats.damage = Math.round(baseWeapon.damage * mult);
    }
    // v2.0 每级专属词条
    const b = this.getWeaponBonuses(baseWeapon.id, lv);
    Object.assign(stats, b);
    stats.level = lv;
    return stats;
  },

  // v2.0 武器等级成长表：每级除了+10%伤害，还解锁专属词条
  // 返回 flags/numbers，由 expedition.js 在 playerAttack 中读
  getWeaponBonuses(weaponId, level) {
    const lv = level || 0;
    const b = { level: lv,
      rangeBonus: 0, cdBonus: 0, speedBonus: 0, pierceBonus: 0,
      critChanceBonus: 0, critDmgBonus: 0, lifesteal: 0,
      knockback3: false, whirlwind: false, whirlwindDmg: 0, bleed: false,
      multiShot: 0, ricochet: 0, instantKillLow: 0,
      aoeBonus: 0, slowOnHit: 0, slowDur: 0, explosionOnKill: 0, rootChance: 0, rootDur: 0, plague: 0,
      explode: 0, burnDps: 0, burnStack: 0, rainArrows: 0, nuke: false, autoAim: false
    };
    switch (weaponId) {
      case 'harvest_sickle':
        if (lv >= 4) b.rangeBonus = 0.15;
        if (lv >= 5) b.knockback3 = true;
        if (lv >= 6) b.critChanceBonus = 0.10;
        if (lv >= 7) b.lifesteal = 2;
        if (lv >= 8) b.whirlwind = true;
        if (lv >= 9) b.whirlwindDmg = 0.30;
        if (lv >= 10) b.bleed = true;
        break;
      case 'pea_repeater':
        if (lv >= 4) b.cdBonus = -0.08;       // 攻速+8%
        if (lv >= 5) b.speedBonus = 0.20;
        if (lv >= 6) b.pierceBonus = 1;
        if (lv >= 7) b.critChanceBonus = 0.05; // 暴击后0.5s攻速+20%（代码侧处理）
        if (lv >= 8) b.multiShot = 3;
        if (lv >= 9) b.multiShot = 4;
        if (lv >= 10) b.instantKillLow = 0.30;
        break;
      case 'vine_staff':
        if (lv >= 4) b.aoeBonus = 0.20;
        if (lv >= 5) b.pierceBonus = 2;
        if (lv >= 6) { b.slowOnHit = 0.30; b.slowDur = 1.5; }
        if (lv >= 7) b.explosionOnKill = 60;
        if (lv >= 8) b.rootChance = 0.25, b.rootDur = 1.0;
        if (lv >= 9) b.rootDur = 2.0;
        if (lv >= 10) b.plague = 0.6;
        break;
      case 'throwing_knife':
        if (lv >= 4) b.cdBonus = -0.12;
        if (lv >= 5) b.ricochet = 1;
        if (lv >= 6) b.critChanceBonus = 0.15;
        if (lv >= 7) b.moveShoot = true;
        if (lv >= 8) b.multiShot = 2;
        if (lv >= 9) b.multiShot = 3;
        if (lv >= 10) b.autoAim = true;
        break;
      case 'flame_bow':
        if (lv >= 4) b.critDmgBonus = 0.50;
        if (lv >= 5) b.explode = 50;
        if (lv >= 6) b.burnDps = 8;
        if (lv >= 7) b.burnStack = 3;
        if (lv >= 8) b.rainArrows = 3;
        if (lv >= 9) b.burnDps *= 1.5;
        if (lv >= 10) b.nuke = true;
        break;
    }
    return b;
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
