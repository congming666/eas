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

  // 仓库界面筛选状态（v5.8 独立全屏界面）
  _search: '',
  _tab: 'all',

  // 打开仓库界面（v5.8：独占全屏，隐藏农场，带返回）
  open() {
    this.init();
    const screen = document.getElementById('farmScreen');
    if (screen) screen.classList.add('hidden');
    const modal = document.getElementById('warehouseModal');
    if (modal) {
      modal.classList.remove('hidden');
      this.render();
    }
  },

  // 关闭仓库界面（返回农场）
  close() {
    const modal = document.getElementById('warehouseModal');
    if (modal) modal.classList.add('hidden');
    const screen = document.getElementById('farmScreen');
    if (screen) {
      screen.classList.remove('hidden');
      try { Farm.render(); } catch (e) {}
    }
  },

  // 渲染仓库内容（v5.8 独立全屏：搜索 + 分类筛选 + 堆叠 + 容量 + 来源提示）
  render() {
    this.init();
    // 确保头部注入 返回按钮 / 搜索框 / 分类标签（仅一次）
    const header = document.querySelector('#warehouseModal .warehouse-modal-header');
    if (header && !document.getElementById('whBackBtn')) {
      const back = document.createElement('button');
      back.id = 'whBackBtn'; back.textContent = '← 返回家园农场';
      back.onclick = () => this.close();
      header.insertBefore(back, header.firstChild);
      const search = document.createElement('input');
      search.id = 'whSearch'; search.type = 'text';
      search.placeholder = '🔍 搜索物品名称…';
      search.oninput = () => { this._search = search.value.trim().toLowerCase(); this.render(); };
      header.appendChild(search);
      const tabs = document.createElement('div');
      tabs.id = 'whTabs';
      header.appendChild(tabs);
    }

    const container = document.getElementById('warehouseContent');
    if (!container) return;

    const used = this.getUsedCapacity();
    const capacity = GameState.warehouse.capacity;
    const percent = Math.min(100, (used / capacity) * 100);
    const upgradeCost = this.getUpgradeCost();
    const q = this._search || '';
    const tab = this._tab || 'all';

    // 渲染分类标签
    const tabsEl = document.getElementById('whTabs');
    if (tabsEl) {
      const tabs = [['all','全部'],['crop','🌾作物'],['resource','📦资源'],['consumable','🧪消耗品'],['material','⚒️制卡材料'],['weapon','⚔️武器'],['other','📋其他']];
      tabsEl.innerHTML = tabs.map(([id,label]) =>
        `<button class="${tab===id?'on':''}" onclick="Warehouse._setTab('${id}')">${label}</button>`).join('');
    }

    // 来源提示（按物品 id 反查）
    const sourceOf = (id) => {
      const res = (CONFIG.resources && CONFIG.resources[id]) || (CONFIG.materials && CONFIG.materials[id]);
      if (res && res.from) return '来源：' + res.from;
      if (res && res.to) return '用途：' + res.to;
      if (CONFIG.greenhouseDrops && CONFIG.greenhouseDrops[id]) return '温室掉落道具';
      return '';
    };
    const match = (name) => !q || (name || '').toLowerCase().includes(q);

    let html = `
      <div class="wh-cap-row">
        <div style="color:#cfe0f0;font-size:13px;">容量 ${used} / ${capacity}</div>
        <div class="wh-cap-bar"><i style="width:${percent}%"></i></div>
        <button class="warehouse-btn" onclick="Warehouse.upgradeCapacity()">扩建 +${WAREHOUSE_EXPAND_STEP}（💰${upgradeCost}）</button>
        <button class="warehouse-btn" onclick="Warehouse.sellAllByCategory('crop')">一键出售作物</button>
      </div>
    `;

    let hasAny = false;

    // 武器区
    const insts = GameState.weaponInstances || [];
    if (tab === 'all' || tab === 'weapon') {
      const vis = insts.length;
      if (vis > 0) {
        hasAny = true;
        html += `<div class="wh-cat">⚔️ 武器（死亡永久损失）</div><div class="wh-grid">`;
        insts.forEach(inst => {
          const wpn = CONFIG.weapons.find(w => w.id === inst.weaponId);
          if (!wpn || !match(wpn.name)) return;
          const stats = (typeof LoadoutSystem !== 'undefined') ? LoadoutSystem.getInstanceStats(inst.uid) : wpn;
          html += `
            <div class="wh-cell">
              <div class="wh-ic">${wpn.icon || '⚔️'}</div>
              <div class="wh-nm">${wpn.name}${inst.level>0?' +'+inst.level:''}</div>
              <div class="wh-src">伤害 ${stats?stats.damage:wpn.damage}</div>
              <div class="wh-src">去锻造台升级</div>
            </div>`;
        });
        html += `</div>`;
      }
    }

    // 制卡材料 / 庄园资源区（materials 不占容量）
    const matBag = (GameState.warehouse.materials) || {};
    const matGroups = [
      { title: '⚒️ 制卡材料（温室/远征产出，不占容量）', ids: ['enchant_essence','pigment','ink','paper_fiber'], cat: 'material' },
      { title: '⛏️ 打造材料', ids: ['wood','stone','fiber','iron','refined_iron','crystal','venom','carapace','soul_ash','bossFang'], cat: 'material' },
      { title: '🟫 庄园资源', ids: ['soil','water','compost','herb'], cat: 'resource' },
    ];
    matGroups.forEach(grp => {
      const rows = grp.ids.filter(id => (matBag[id] || 0) > 0 && match(((CONFIG.resources&&CONFIG.resources[id])||{}).name || id));
      if (!rows.length || (tab !== 'all' && tab !== grp.cat && !(grp.cat==='material'&&tab==='resource'))) return;
      hasAny = true;
      html += `<div class="wh-cat">${grp.title}</div><div class="wh-grid">`;
      rows.forEach(id => {
        const def = (CONFIG.resources && CONFIG.resources[id]) || (CONFIG.materials && CONFIG.materials[id]) || { icon:'📦', name:id, to:'打造材料·不可出售' };
        html += `
          <div class="wh-cell">
            <div class="wh-ct">×${matBag[id]}</div>
            <div class="wh-ic">${(typeof CropArt!=="undefined"&&CropArt.ready(id))?CropArt.dom(id,def.icon,36):def.icon}</div>
            <div class="wh-nm">${def.name}</div>
            <div class="wh-src">${def.to ? ('用途：'+def.to) : '打造材料·不可出售'}</div>
          </div>`;
      });
      html += `</div>`;
    });

    // 普通仓库物品（作物/资源/消耗品/其他）
    const categories = this.getAllItems();
    const catNames = { crop:'🌾 作物', resource:'📦 资源', consumable:'🧪 消耗品', other:'📋 其他' };
    Object.keys(categories).forEach(cat => {
      if (tab !== 'all' && tab !== cat) return;
      const items = categories[cat].filter(it => match(it.name));
      if (items.length === 0) return;
      hasAny = true;
      html += `<div class="wh-cat">${catNames[cat] || cat}</div><div class="wh-grid">`;
      items.forEach(item => {
        const sell = item.sellPrice ? `
          <div class="wh-sell">
            <button onclick="Warehouse.sellItem('${item.id}',1)">售+${item.sellPrice}</button>
            <button onclick="Warehouse.sellItem('${item.id}',${item.count})">全售</button>
          </div>` : '<div class="wh-src">不可出售</div>';
        html += `
          <div class="wh-cell ${item.rarity||''}">
            <div class="wh-ct">×${item.count}</div>
            <div class="wh-ic">${(typeof CropArt!=="undefined"&&CropArt.ready(item.id))?CropArt.dom(item.id,item.icon,36):item.icon}</div>
            <div class="wh-nm">${item.name}</div>
            <div class="wh-src">${sourceOf(item.id)}</div>
            ${sell}
          </div>`;
      });
      html += `</div>`;
    });

    if (!hasAny) {
      html += `<div class="wh-empty">
        <div style="font-size:48px;margin-bottom:12px;">📦</div>
        <div>仓库空空如也</div>
        <div style="font-size:13px;margin-top:6px;">收获作物和远征战利品会自动存入这里</div>
      </div>`;
    }

    container.innerHTML = html;
  },

  _setTab(t){ this._tab = t; this.render(); },
};