// ==================== 育种温室系统 ====================
const Greenhouse = {
  // 初始化温室格子（4x4 = 16格）
  init() {
    if (GameState.greenhouse.plots.length === 16) return;
    GameState.greenhouse.plots = [];
    for (let i = 0; i < 16; i++) {
      GameState.greenhouse.plots.push({ plant: null, plantedAt: 0, ready: false, status: null });
    }
    // 初始种一些
    for (let i = 0; i < 2; i++) {
      const idx = randInt(0, GameState.greenhouse.unlockedPlots - 1);
      if (!GameState.greenhouse.plots[idx].plant) {
        const plant = CONFIG.greenhousePlants[0];
        GameState.greenhouse.plots[idx].plant = plant;
        GameState.greenhouse.plots[idx].plantedAt = Date.now() - rand(10000, 60000);
      }
    }
    SaveSystem.save();
  },

  // 打开温室
  open() {
    this.init();
    const modal = document.getElementById('greenhouseModal');
    if (modal) {
      modal.classList.remove('hidden');
      this.render();
    }
  },

  // 关闭温室
  close() {
    const modal = document.getElementById('greenhouseModal');
    if (modal) modal.classList.add('hidden');
  },

  // 渲染温室
  render() {
    this.init();
    const grid = document.getElementById('greenhouseGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const now = Date.now();

    // 更新标题
    const title = document.querySelector('.greenhouse-grid-title');
    if (title) title.textContent = `温室 ${GameState.greenhouse.unlockedPlots}/16（点击空地播种，点击成熟植物收获）`;

    GameState.greenhouse.plots.forEach((plot, idx) => {
      const cell = document.createElement('div');
      cell.className = 'greenhouse-cell';

      // 锁定的格子
      if (idx >= GameState.greenhouse.unlockedPlots) {
        const cost = this.getUnlockCost(idx);
        cell.classList.add('locked');
        if (idx === GameState.greenhouse.unlockedPlots) cell.classList.add('next-unlock');
        cell.innerHTML = `<div class="plot-lock">🔒<div class="plot-cost">💰${cost.gold} · 🔧${cost.materials}</div></div>`;
        cell.onclick = () => this.unlockPlot(idx);
        grid.appendChild(cell);
        return;
      }

      // 有植物的格子
      if (plot.plant) {
        const elapsed = (now - plot.plantedAt) / 1000;
        const progress = clamp(elapsed / plot.plant.growTime, 0, 1);
        plot.ready = progress >= 1;
        cell.classList.add(plot.ready ? 'ready' : 'planted');
        cell.classList.add(`rarity-${plot.plant.rarity || 'common'}`);
        const progressPct = Math.floor(progress * 100);
        cell.innerHTML = `
          <div class="gh-plant-icon">${plot.plant.icon}</div>
          <div class="gh-plant-name">${plot.plant.name}</div>
          ${plot.ready ? '<div class="gh-ready-tag">可收获</div>' : `<div class="gh-progress"><div class="gh-progress-fill" style="width:${progressPct}%"></div></div><div class="gh-progress-text">${progressPct}%</div>`}
        `;
        cell.onclick = () => this.harvest(idx);
      } else {
        // 空地
        cell.classList.add('empty');
        cell.innerHTML = `<div class="gh-empty-icon">➕</div><div class="gh-empty-text">播种</div>`;
        cell.onclick = () => this.plant(idx);
      }
      grid.appendChild(cell);
    });

    this.renderPlantSelector();
    this.renderDrops();
  },

  // 渲染植物选择器
  renderPlantSelector() {
    const container = document.getElementById('greenhousePlantSelector');
    if (!container) return;
    container.innerHTML = '';
    CONFIG.greenhousePlants.forEach(plant => {
      const unlocked = GameState.greenhouse.unlockedPlants.includes(plant.id);
      const button = document.createElement('div');
      button.className = `gh-plant-choice ${plant.rarity} ${GameState.greenhouse.selectedPlant === plant.id ? 'selected' : ''} ${!unlocked ? 'locked' : ''}`;
      button.innerHTML = `
        <div class="gh-plant-icon">${unlocked ? plant.icon : '🔒'}</div>
        <div class="gh-plant-name">${plant.name}</div>
        <div class="gh-plant-time">${plant.growTime}秒</div>
      `;
      if (unlocked) {
        button.onclick = () => {
          GameState.greenhouse.selectedPlant = plant.id;
          this.renderPlantSelector();
        };
      } else {
        button.onclick = () => showToast(`${plant.name}尚未解锁，通过远征或掉落获取`, 'warning');
      }
      container.appendChild(button);
    });
  },

  // 渲染掉落道具栏
  renderDrops() {
    const container = document.getElementById('greenhouseDrops');
    if (!container) return;
    container.innerHTML = '<div class="gh-drops-title">🧪 温室道具</div>';

    const dropItems = Object.keys(CONFIG.greenhouseDrops);
    let hasItems = false;
    dropItems.forEach(itemId => {
      const count = Warehouse.getCount(itemId);
      if (count <= 0) return;
      hasItems = true;
      const item = CONFIG.greenhouseDrops[itemId];
      const div = document.createElement('div');
      div.className = 'gh-drop-item';
      div.innerHTML = `
        <div class="gh-drop-icon">${item.icon}</div>
        <div class="gh-drop-info">
          <div class="gh-drop-name">${item.name} ×${count}</div>
          <div class="gh-drop-desc">${item.desc}</div>
        </div>
        <button class="gh-drop-use-btn" onclick="Greenhouse.useDropItem('${itemId}')">使用</button>
      `;
      container.appendChild(div);
    });

    if (!hasItems) {
      container.innerHTML += '<div class="gh-drops-empty">收获稀有植物获取道具</div>';
    }
  },

  // 种植
  plant(idx) {
    if (idx >= GameState.greenhouse.unlockedPlots) return;
    const plant = CONFIG.greenhousePlants.find(p => p.id === GameState.greenhouse.selectedPlant);
    if (!plant) {
      showToast('请选择要种植的稀有植物', 'warning');
      return;
    }
    if (!GameState.greenhouse.unlockedPlants.includes(plant.id)) {
      showToast(`${plant.name}尚未解锁`, 'warning');
      return;
    }
    // 检查种子（用金币代替，温室种子需要金币购买）
    if (GameState.gold < plant.seedPrice) {
      showToast(`金币不足，需要${plant.seedPrice}金币购买种子`, 'warning');
      return;
    }
    GameState.gold -= plant.seedPrice;
    GameState.greenhouse.plots[idx].plant = plant;
    GameState.greenhouse.plots[idx].plantedAt = Date.now();
    GameState.greenhouse.plots[idx].ready = false;
    showToast(`在温室种下了${plant.name}`, 'success');
    SaveSystem.save();
    this.render();
  },

  // 收获
  harvest(idx) {
    const plot = GameState.greenhouse.plots[idx];
    if (!plot.ready) {
      showToast('还没成熟呢', 'warning');
      return;
    }
    const plant = plot.plant;
    let rewardText = `${plant.name}收获！`;
    const rewards = [];

    // 处理掉落
    plant.drops.forEach(drop => {
      if (Math.random() < drop.chance) {
        let amount = 1;
        if (Array.isArray(drop.amount)) {
          amount = randInt(drop.amount[0], drop.amount[1]);
        } else if (typeof drop.amount === 'number') {
          amount = drop.amount;
        }

        if (drop.id === 'gold') {
          GameState.gold += amount;
          rewards.push(`💰+${amount}`);
        } else {
          const added = Warehouse.addItem(drop.id, amount);
          if (added > 0) {
            const itemDef = CONFIG.greenhouseDrops[drop.id] || CONFIG.warehouseItems[drop.id];
            if (itemDef) rewards.push(`${itemDef.icon}×${added}`);
          }
        }
      }
    });

    // 小概率解锁新植物
    if (plant.rarity === 'legendary' && Math.random() < 0.15) {
      const locked = CONFIG.greenhousePlants.filter(p => !GameState.greenhouse.unlockedPlants.includes(p.id));
      if (locked.length > 0) {
        const newPlant = locked[randInt(0, locked.length - 1)];
        GameState.greenhouse.unlockedPlants.push(newPlant.id);
        rewards.push(`🎉解锁${newPlant.name}`);
        showToast(`解锁新稀有植物：${newPlant.name}！`, 'gold');
      }
    }

    rewardText += rewards.length > 0 ? ' 获得：' + rewards.join(' ') : ' 什么都没掉...';
    showToast(rewardText, 'gold');

    plot.plant = null;
    plot.ready = false;
    plot.status = null;
    SaveSystem.save();
    this.render();
  },

  // 解锁格子
  unlockPlot(idx) {
    if (idx !== GameState.greenhouse.unlockedPlots) {
      showToast('请依次解锁温室格子', 'warning');
      return;
    }
    const cost = this.getUnlockCost(idx);
    if (GameState.gold < cost.gold) {
      showToast(`金币不足，需要${cost.gold}金币`, 'warning');
      return;
    }
    if (Warehouse.getCount('materials') < cost.materials) {
      showToast(`材料不足，需要${cost.materials}材料`, 'warning');
      return;
    }
    GameState.gold -= cost.gold;
    Warehouse.removeItem('materials', cost.materials);
    GameState.greenhouse.unlockedPlots++;
    showToast(`温室格子解锁成功！当前${GameState.greenhouse.unlockedPlots}/16`, 'success');
    SaveSystem.save();
    this.render();
  },

  // 获取解锁费用
  getUnlockCost(idx) {
    const level = idx - 3; // 第5个格子开始收费
    return {
      gold: 200 * level,
      materials: 5 * level
    };
  },

  // 使用掉落道具
  useDropItem(itemId) {
    const count = Warehouse.getCount(itemId);
    if (count <= 0) {
      showToast('没有该道具', 'warning');
      return;
    }
    const item = CONFIG.greenhouseDrops[itemId];
    if (!item) return;

    switch (itemId) {
      case 'gold_card':
        Warehouse.removeItem(itemId, 1);
        GameState.gold += item.value;
        showToast(`使用金币卡，获得${item.value}金币`, 'gold');
        break;
      case 'big_gold_card':
        Warehouse.removeItem(itemId, 1);
        GameState.gold += item.value;
        showToast(`使用大金币卡，获得${item.value}金币！`, 'gold');
        break;
      case 'transform_card':
        this.useTransformCard();
        return;
      case 'rare_seed_pack':
        this.useRareSeedPack();
        return;
      case 'exp_boost_card':
        Warehouse.removeItem(itemId, 1);
        GameState.expBoost = true;
        showToast('经验加成已激活，下次远征击杀经验+50%', 'success');
        break;
      case 'weapon_upgrade_stone':
        Warehouse.removeItem(itemId, 1);
        GameState.greenhouse.weaponBonus = (GameState.greenhouse.weaponBonus || 0) + 0.1;
        showToast(`武器已强化！当前伤害+${Math.floor(GameState.greenhouse.weaponBonus * 100)}%`, 'success');
        break;
      default:
        showToast('该道具暂不可用', 'warning');
        return;
    }
    SaveSystem.save();
    this.renderDrops();
    Farm.render();
  },

  // 使用作物转化卡
  useTransformCard() {
    // 找一块普通农场的成熟作物，转化为随机稀有作物
    const readyPlots = GameState.farmPlots
      .map((plot, idx) => ({ plot, idx }))
      .filter(({ plot, idx }) => idx < GameState.unlockedPlots && plot.ready && plot.crop);
    if (readyPlots.length === 0) {
      showToast('需要一块成熟的普通作物才能转化', 'warning');
      return;
    }
    Warehouse.removeItem('transform_card', 1);
    const target = readyPlots[randInt(0, readyPlots.length - 1)];
    const rarePlants = CONFIG.greenhousePlants.filter(p => GameState.greenhouse.unlockedPlants.includes(p.id));
    const newPlant = rarePlants[randInt(0, rarePlants.length - 1)];
    target.plot.crop = newPlant;
    target.plot.plantedAt = Date.now();
    target.plot.ready = false;
    showToast(`${target.plot.crop.name}转化为${newPlant.icon}${newPlant.name}！`, 'gold');
    SaveSystem.save();
    this.renderDrops();
    Farm.render();
  },

  // 使用稀有种子包
  useRareSeedPack() {
    const locked = CONFIG.greenhousePlants.filter(p => !GameState.greenhouse.unlockedPlants.includes(p.id));
    if (locked.length === 0) {
      showToast('所有稀有植物都已解锁', 'warning');
      return;
    }
    Warehouse.removeItem('rare_seed_pack', 1);
    const newPlant = locked[randInt(0, locked.length - 1)];
    GameState.greenhouse.unlockedPlants.push(newPlant.id);
    showToast(`解锁新稀有植物：${newPlant.icon}${newPlant.name}！`, 'gold');
    SaveSystem.save();
    this.render();
  }
};
