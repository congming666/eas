// ==================== 物资仓库系统 ====================
const WAREHOUSE_BASE_CAPACITY = 120;   // 基础容量（件）
const WAREHOUSE_EXPAND_STEP = 50;      // 每次扩建增加（件）
const Warehouse = {
  // 批量入库上下文（远征结算时抑制逐条 toast，统一汇总）
  _batch: null,

  // 初始化仓库
  init() {
    if (!GameState.warehouse) {
      GameState.warehouse = { capacity: WAREHOUSE_BASE_CAPACITY, items: {}, capVersion: 2 };
    }
    if (!GameState.warehouse.items) GameState.warehouse.items = {};
    if (!GameState.warehouse.capacity) GameState.warehouse.capacity = WAREHOUSE_BASE_CAPACITY;
    // v4.2 旧档容量迁移（仅一次）：旧档 50 起步、+25/级，提升到新基础容量
    if (GameState.warehouse.capVersion !== 2) {
      if (GameState.warehouse.capacity < WAREHOUSE_BASE_CAPACITY) {
        GameState.warehouse.capacity = WAREHOUSE_BASE_CAPACITY;
      }
      GameState.warehouse.capVersion = 2;
    }
  },

  // 开始批量入库（远征结算）
  beginBatch() {
    this.init();
    this._batch = { requested: 0, added: 0, unknown: 0 };
  },

  // 结束批量入库，汇总爆仓/未注册物品并一次性提示
  endBatch() {
    const b = this._batch;
    this._batch = null;
    if (!b) return null;
    const lost = b.requested - b.added;
    if (lost > 0) {
      showToast(`仓库已满，${lost} 件物品未能存入，请出售或扩建仓库`, 'warning');
    }
    if (b.unknown > 0) {
      console.warn(`批量入库中有 ${b.unknown} 件未注册物品未入仓`);
    }
    return b;
  },

  // 获取物品定义
  getItemDef(itemId) {
    return CONFIG.warehouseItems[itemId] || null;
  },

  // 获取物品数量
  getCount(itemId) {
    this.init();
    return GameState.warehouse.items[itemId] || 0;
  },

  // 获取已用容量
  getUsedCapacity() {
    this.init();
    return Object.values(GameState.warehouse.items).reduce((s, n) => s + n, 0);
  },

  // 获取剩余容量
  getFreeCapacity() {
    return GameState.warehouse.capacity - this.getUsedCapacity();
  },

  // 添加物品（返回实际添加数量）
  addItem(itemId, count = 1) {
    this.init();
    const def = this.getItemDef(itemId);
    if (!def) {
      console.warn('未知物品:', itemId);
      if (this._batch) this._batch.unknown += count;
      return 0;
    }
    const free = this.getFreeCapacity();
    const actual = Math.min(count, free);
    if (this._batch) {
      this._batch.requested += count;
      this._batch.added += actual;
    }
    if (actual <= 0) {
      if (!this._batch) showToast('仓库已满！请出售或扩建仓库', 'warning');
      return 0;
    }
    GameState.warehouse.items[itemId] = (GameState.warehouse.items[itemId] || 0) + actual;
    if (actual < count && !this._batch) {
      showToast(`仓库空间不足，只存入${actual}个${def.name}`, 'warning');
    }
    return actual;
  },

  // 移除物品
  removeItem(itemId, count = 1) {
    this.init();
    const current = this.getCount(itemId);
    if (current < count) return false;
    GameState.warehouse.items[itemId] = current - count;
    if (GameState.warehouse.items[itemId] <= 0) {
      delete GameState.warehouse.items[itemId];
    }
    return true;
  },

  // 出售物品换金币
  sellItem(itemId, count = 1) {
    this.init();
    const def = this.getItemDef(itemId);
    if (!def || !def.sellPrice) {
      showToast('该物品无法出售', 'warning');
      return false;
    }
    const current = this.getCount(itemId);
    const actual = Math.min(count, current);
    if (actual <= 0) return false;
    const gold = def.sellPrice * actual;
    this.removeItem(itemId, actual);
    GameState.gold += gold;
    showToast(`出售${def.name} ×${actual}，获得${gold}金币`, 'gold');
    SaveSystem.save();
    this.render();
    Farm.render();
    return true;
  },

  // 全部出售某类物品
  sellAllByCategory(category) {
    this.init();
    let totalGold = 0;
    let totalCount = 0;
    Object.keys(GameState.warehouse.items).forEach(itemId => {
      const def = this.getItemDef(itemId);
      if (def && def.category === category && def.sellPrice) {
        const count = this.getCount(itemId);
        totalGold += def.sellPrice * count;
        totalCount += count;
        delete GameState.warehouse.items[itemId];
      }
    });
    if (totalCount > 0) {
      GameState.gold += totalGold;
      showToast(`出售${totalCount}个${category === 'crop' ? '作物' : category}，获得${totalGold}金币`, 'gold');
      SaveSystem.save();
      this.render();
      Farm.render();
    }
    return totalGold;
  },

  // 扩建仓库
  upgradeCapacity() {
    this.init();
    const cost = this.getUpgradeCost();
    if (GameState.gold < cost) {
      showToast(`扩建需要${cost}金币`, 'warning');
      return false;
    }
    GameState.gold -= cost;
    GameState.warehouse.capacity += WAREHOUSE_EXPAND_STEP;
    showToast(`仓库扩建成功！容量提升至${GameState.warehouse.capacity}`, 'success');
    SaveSystem.save();
    this.render();
    Farm.render();
    return true;
  },

  // 获取扩建费用
  getUpgradeCost() {
    this.init();
    const level = Math.floor((GameState.warehouse.capacity - WAREHOUSE_BASE_CAPACITY) / WAREHOUSE_EXPAND_STEP) + 1;
    return 100 * level;
  },

  // 从仓库取出种子用于播种
  takeSeed() {
    if (this.getCount('seeds') > 0) {
      this.removeItem('seeds', 1);
      return true;
    }
    return false;
  },

  // 从仓库取出消耗品
  takeConsumable(itemId) {
    if (this.getCount(itemId) > 0) {
      this.removeItem(itemId, 1);
      return true;
    }
    return false;
  },

  // 获取所有物品（按分类排序）
  getAllItems() {
    this.init();
    const categories = { crop: [], resource: [], consumable: [], other: [] };
    Object.keys(GameState.warehouse.items).forEach(itemId => {
      const def = this.getItemDef(itemId);
      const count = GameState.warehouse.items[itemId];
      if (def && count > 0) {
        const cat = categories[def.category] || categories.other;
        cat.push({ id: itemId, ...def, count });
      }
    });
    return categories;
  },

  // 打开仓库界面
  open() {
    this.init();
    const modal = document.getElementById('warehouseModal');
    if (modal) {
      modal.classList.remove('hidden');
      this.render();
    }
  },

  // 关闭仓库界面
  close() {
    const modal = document.getElementById('warehouseModal');
    if (modal) modal.classList.add('hidden');
  },

  // 渲染仓库内容
  render() {
    this.init();
    const container = document.getElementById('warehouseContent');
    if (!container) return;

    const used = this.getUsedCapacity();
    const capacity = GameState.warehouse.capacity;
    const percent = Math.min(100, (used / capacity) * 100);
    const upgradeCost = this.getUpgradeCost();
    const categories = this.getAllItems();

    const categoryNames = {
      crop: '🌾 作物',
      resource: '📦 资源',
      consumable: '🧪 消耗品',
      other: '📋 其他'
    };

    let html = `
      <div class="warehouse-header">
        <div class="warehouse-capacity">
          <div class="capacity-label">仓库容量：${used} / ${capacity}</div>
          <div class="capacity-bar"><div class="capacity-fill" style="width:${percent}%"></div></div>
        </div>
        <div class="warehouse-actions">
          <button class="warehouse-btn sell-all-btn" onclick="Warehouse.sellAllByCategory('crop')">一键出售作物</button>
          <button class="warehouse-btn upgrade-btn" onclick="Warehouse.upgradeCapacity()">
            扩建仓库 (+${WAREHOUSE_EXPAND_STEP})<br><span style="font-size:11px;">💰${upgradeCost}</span>
          </button>
        </div>
      </div>
    `;

    let hasItems = false;
    // v1.1 武器区
    const insts = GameState.weaponInstances || [];
    if (insts.length > 0) {
      hasItems = true;
      html += `<div class="warehouse-category"><div class="category-title">⚔️ 武器（死亡永久损失）</div><div class="warehouse-grid">`;
      insts.forEach(inst => {
        const wpn = CONFIG.weapons.find(w => w.id === inst.weaponId);
        if (!wpn) return;
        const stats = (typeof LoadoutSystem !== 'undefined') ? LoadoutSystem.getInstanceStats(inst.uid) : wpn;
        html += `
          <div class="warehouse-item ${inst.level>=5?'rare':''}">
            <img src="${wpn.img}" style="width:48px;height:48px;object-fit:contain;border-radius:4px;" onerror="this.style.display='none'">
            <div class="item-name">${wpn.name}${inst.level>0?' +'+inst.level:''}</div>
            <div class="item-count">伤害 ${stats?stats.damage:wpn.damage}</div>
            <div style="font-size:10px;color:#888;">${inst.uid}</div>
            <div class="item-not-sellable">去锻造台升级</div>
          </div>`;
      });
      html += `</div></div>`;
    }
    Object.keys(categories).forEach(cat => {
      const items = categories[cat];
      if (items.length === 0) return;
      hasItems = true;
      html += `<div class="warehouse-category"><div class="category-title">${categoryNames[cat] || cat}</div><div class="warehouse-grid">`;
      items.forEach(item => {
        const sellable = item.sellPrice ? `
          <button class="item-sell-btn" onclick="Warehouse.sellItem('${item.id}', 1)">出售 💰${item.sellPrice}</button>
          <button class="item-sell-all-btn" onclick="Warehouse.sellItem('${item.id}', ${item.count})">全部出售</button>
        ` : '<div class="item-not-sellable">不可出售</div>';
        html += `
          <div class="warehouse-item ${item.rarity || ''}">
            <div class="item-icon">${(typeof CropArt!=="undefined")?CropArt.dom(item.id,item.icon,36):item.icon}</div>
            <div class="item-name">${item.name}</div>
            <div class="item-count">×${item.count}</div>
            ${sellable}
          </div>
        `;
      });
      html += `</div></div>`;
    });

    if (!hasItems) {
      html += `<div class="warehouse-empty">
        <div style="font-size:48px;margin-bottom:12px;">📦</div>
        <div>仓库空空如也</div>
        <div style="font-size:13px;color:#888;margin-top:6px;">收获作物和远征战利品会自动存入这里</div>
      </div>`;
    }

    container.innerHTML = html;
  }
};
