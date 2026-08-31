const Farm = {
  init() {
    if (GameState.farmPlots.length === 36) return;
    GameState.farmPlots = [];
    for (let i = 0; i < 36; i++) {
      GameState.farmPlots.push({ crop: null, plantedAt: 0, ready: false, status: null });
    }
    // 初始种一些
    for (let i = 0; i < 3; i++) {
      const idx = randInt(0, GameState.unlockedPlots - 1);
      if (!GameState.farmPlots[idx].crop) {
        GameState.farmPlots[idx].crop = CONFIG.crops[0];
        GameState.farmPlots[idx].plantedAt = Date.now() - rand(5000, 20000);
      }
    }
    SaveSystem.save();
  },

  render() {
    const grid = document.getElementById('farmGrid');
    grid.innerHTML = '';
    const now = Date.now();
    const title = document.querySelector('.farm-grid-title');
    if (title) title.textContent = `农田 ${GameState.unlockedPlots}/36（点击状态图标照料作物，点击锁定格扩建）`;
    GameState.farmPlots.forEach((plot, idx) => {
      const cell = document.createElement('div');
      cell.className = 'farm-cell';
      if (idx >= GameState.unlockedPlots) {
        const cost = this.getUnlockCost(idx);
        cell.classList.add('locked');
        if (idx === GameState.unlockedPlots) cell.classList.add('next-unlock');
        cell.innerHTML = `<div class="plot-lock">🔒<div class="plot-cost">${idx === GameState.unlockedPlots ? `💰${cost.gold}${cost.materials ? ` · 📦${cost.materials}` : ''}` : '依次扩建'}</div></div>`;
        cell.onclick = () => this.unlockPlot(idx);
        grid.appendChild(cell);
        return;
      }
      if (plot.crop) {
        const elapsed = (now - plot.plantedAt) / 1000;
        const statusFactor = plot.status === 'drought' ? 0.55 : (plot.status === 'pest' ? 0.72 : (plot.status === 'weeds' ? 0.82 : 1));
        const progress = clamp((elapsed * statusFactor) / plot.crop.growTime, 0, 1);
        plot.ready = progress >= 1;
        cell.classList.add(plot.ready ? 'ready' : 'planted');
        cell.classList.add(`rarity-${plot.crop.rarity || 'common'}`);
        const statusIcons = { drought: '🍂', pest: '🐛', weeds: '🌿' };
        cell.innerHTML = `${plot.crop.icon}${plot.status ? `<div class="plot-status">${statusIcons[plot.status]}</div>` : ''}<div class="growth-bar"><div class="growth-fill" style="width:${progress*100}%"></div></div>`;
        cell.title = plot.status ? `状态：${{drought:'干旱',pest:'虫害',weeds:'杂草'}[plot.status]}，点击照料` : (plot.ready ? '点击收获' : '生长中');
        cell.onclick = () => plot.status ? Farm.tend(idx) : Farm.harvest(idx);
      } else {
        cell.innerHTML = '';
        cell.onclick = () => Farm.plant(idx);
      }
      grid.appendChild(cell);
    });
    document.getElementById('goldDisplay').textContent = GameState.gold;
    document.getElementById('seedDisplay').textContent = Warehouse.getCount('seeds');
    document.getElementById('materialDisplay').textContent = Warehouse.getCount('materials');
    const catalystCount = document.getElementById('growthCatalystCount');
    if (catalystCount) catalystCount.textContent = Warehouse.getCount('growth_catalyst');
    this.renderCropSelector();
    RewardSystem.render();
  },

  renderCropSelector() {
    const container = document.getElementById('cropSelector');
    container.innerHTML = '';
    CONFIG.crops
      .filter(crop => GameState.unlockedCrops.includes(crop.id))
      .forEach(crop => {
        const button = document.createElement('button');
        button.className = `crop-choice ${crop.rarity || 'common'}` + (GameState.selectedCrop === crop.id ? ' selected' : '');
        button.innerHTML = `<span>${crop.icon} ${crop.name}</span><small>${crop.rewardLabel || `${crop.growTime}秒 · ${crop.sellPrice}金币`}</small>`;
        button.title = `${crop.growTime}秒成熟 · ${crop.rewardLabel || '金币与概率强化卡'}`;
        button.onclick = () => {
          GameState.selectedCrop = crop.id;
          SaveSystem.save();
          this.renderCropSelector();
        };
        container.appendChild(button);
      });
  },

  plant(idx) {
    if (idx >= GameState.unlockedPlots) return;
    if (Warehouse.getCount('seeds') <= 0) {
      showToast('种子不足！去远征获取更多种子', 'warning');
      return;
    }
    const crop = CONFIG.crops.find(item => item.id === GameState.selectedCrop) || CONFIG.crops[0];
    GameState.farmPlots[idx].crop = crop;
    GameState.farmPlots[idx].plantedAt = Date.now();
    GameState.farmPlots[idx].ready = false;
    const ailmentRoll = Math.random();
    GameState.farmPlots[idx].status = ailmentRoll < 0.08 ? 'drought' : (ailmentRoll < 0.14 ? 'pest' : (ailmentRoll < 0.21 ? 'weeds' : null));
    Warehouse.removeItem('seeds', 1);
    showToast(`种下了${crop.name}`, 'success');
    SaveSystem.save();
    this.render();
  },

  harvest(idx) {
    const plot = GameState.farmPlots[idx];
    if (!plot.ready) {
      showToast('还没成熟呢', 'warning');
      return;
    }
    const crop = plot.crop;
    // 作物存入仓库
    const added = Warehouse.addItem(crop.id, 1);
    let rewardText = `${crop.name} ×${added} 已入仓`;
    // 30% 概率额外获得种子，存入仓库
    if (Math.random() < 0.3) {
      Warehouse.addItem('seeds', 1);
      rewardText += '，种子 ×1 已入仓';
    }
    // 稀有作物额外获得材料，存入仓库
    if (crop.rare) {
      const matCount = randInt(1, 3);
      Warehouse.addItem('materials', matCount);
      rewardText += `，材料 ×${matCount} 已入仓`;
    }
    if (crop.rewardType === 'gold') {
      const bonusGold = randInt(25, 45);
      GameState.gold += bonusGold;
      rewardText += `，额外金币 +${bonusGold}`;
    } else if (crop.rewardType === 'healing') {
      Warehouse.addItem('herb_kit', 1);
      rewardText += '，草药包扎包 ×1 已入仓';
    } else if (crop.rewardType === 'attack_card') {
      const card = CardSystem.createCard(crop);
      card.name = `豌豆连射 · ${card.name}`;
      card.desc = '远征攻击强化：提高基础攻击与稻草猛击等级。';
      GameState.cardInventory.push(card);
      CardSystem.showDrop(card);
      rewardText = '豌豆攻击强化卡 x1';
    } else if (crop.rewardType === 'skill_card') {
      const card = CardSystem.createCard(crop);
      GameState.cardInventory.push(card);
      CardSystem.showDrop(card);
      rewardText = `强化技能卡：${card.name} x1`;
    } else if (crop.rewardType === 'consumable_skill_card') {
      const card = CardSystem.createCard(crop);
      card.singleUse = true;
      card.name = `${card.name}（一次性）`;
      card.desc = `本次远征可使用一次：临时提升「${CONFIG.skills.find(skill => skill.id === card.skillId)?.name || '随机技能'}」${card.power}级，撤离后消耗。`;
      GameState.cardInventory.push(card);
      CardSystem.showDrop(card);
      rewardText = `一次性技能卡：${card.name} x1`;
    } else {
      CardSystem.tryDrop(crop);
    }
    showToast(`收获${crop.name}，${rewardText}`, 'gold');
    plot.crop = null;
    plot.ready = false;
    plot.status = null;
    SaveSystem.save();
    this.render();
  },

  tend(idx) {
    const plot = GameState.farmPlots[idx];
    if (!plot?.status) return;
    const names = { drought: '浇水', pest: '除虫', weeds: '除草' };
    if (GameState.gold < 4) {
      showToast('需要4金币购买基础农具', 'warning');
      return;
    }
    GameState.gold -= 4;
    showToast(`${names[plot.status]}完成，作物恢复正常生长`, 'success');
    plot.status = null;
    SaveSystem.save();
    this.render();
  },

  useGrowthCatalyst() {
    const count = Warehouse.getCount('growth_catalyst');
    if (count <= 0) {
      showToast('没有生长催化剂，可从远征宝箱中获取', 'warning');
      return;
    }
    const now = Date.now();
    const candidates = GameState.farmPlots
      .map((plot, idx) => ({ plot, idx }))
      .filter(({ plot, idx }) => idx < GameState.unlockedPlots && plot.crop && !plot.ready)
      .map(entry => ({
        ...entry,
        remaining: entry.plot.crop.growTime - (now - entry.plot.plantedAt) / 1000,
      }))
      .filter(entry => entry.remaining > 0)
      .sort((a, b) => b.remaining - a.remaining);
    if (candidates.length === 0) {
      showToast('当前没有正在生长的作物', 'warning');
      return;
    }
    const { plot } = candidates[0];
    const reductionSeconds = plot.crop.growTime * 0.1;
    plot.plantedAt -= reductionSeconds * 1000;
    Warehouse.removeItem('growth_catalyst', 1);
    SaveSystem.save();
    showToast(`使用生长催化剂：${plot.crop.name}生长时间缩短${reductionSeconds.toFixed(1)}秒（总时长10%）`, 'success');
    this.render();
  },

  getUnlockCost(idx) {
    const step = Math.max(0, idx - 8);
    return { gold: 90 + step * 35, materials: step < 4 ? 0 : Math.floor((step - 4) / 5) + 1 };
  },

  unlockPlot(idx) {
    if (idx !== GameState.unlockedPlots) {
      showToast('请按顺序扩建相邻农田', 'warning');
      return;
    }
    const cost = this.getUnlockCost(idx);
    if (GameState.gold < cost.gold || GameState.materials < cost.materials) {
      showToast(`扩建需要 ${cost.gold}金币${cost.materials ? ` 和 ${cost.materials}材料` : ''}`, 'warning');
      return;
    }
    GameState.gold -= cost.gold;
    GameState.materials -= cost.materials;
    GameState.unlockedPlots++;
    SaveSystem.save();
    showToast(`新农田已解锁：${GameState.unlockedPlots}/36`, 'gold');
    this.render();
  },

  renderMapSelect() {
    const container = document.getElementById('mapSelect');
    container.innerHTML = '';
    const prepGold = document.getElementById('prepGoldDisplay');
    if (prepGold) prepGold.textContent = GameState.gold;
    CONFIG.maps.forEach(map => {
      const div = document.createElement('div');
      const locked = GameState.gold < map.entryFee;
      div.className = 'map-option' + (GameState.selectedMap === map.id ? ' selected' : '') + (locked ? ' locked' : '');
      div.innerHTML = `
        <div class="map-name">T${map.tier} ${map.name} <span style="font-size:12px;color:#ff8866;">[${map.danger}]</span></div>
        <div class="map-info">
          <span>💰 入场: ${map.entryFee}</span>
          <span>👹 怪物: ${map.monsterCount}</span>
          <span>📦 宝箱: ${map.chestCount}</span>
        </div>
      `;
      if (!locked) div.onclick = () => {
        GameState.selectedMap = map.id;
        SaveSystem.save();
        this.renderMapSelect();
      };
      container.appendChild(div);
    });
    this.renderRegionBrief();
  },

  renderRegionBrief() {
    const brief = document.getElementById('regionBrief');
    if (!brief) return;
    const map = CONFIG.maps.find(item => item.id === GameState.selectedMap) || CONFIG.maps[0];
    const environments = [
      '开阔草地、灌溉水塘、旧耕地与碎石小径。天气温和，但草丛会遮挡小型陷阱。',
      '废弃农舍、泥泞道路、干涸沟渠与风沙区。木刺和捕兽夹数量增加。',
      '污染农田、毒沼、焦土和破碎温室。毒雾与孢子陷阱会持续造成伤害。',
      '古代石阵、夜色林地、深水区与能量裂隙。符文陷阱和落雷区最危险。',
    ];
    brief.innerHTML = `
      <div style="color:#f2d28a;font-size:15px;font-weight:700;margin-bottom:7px;">T${map.tier} · ${map.name}</div>
      <div>${environments[map.tier - 1]}</div>
      <div style="margin-top:9px;color:#d7e9df;">环境威胁：${3 + map.tier * 2}–${5 + map.tier * 3} 个陷阱 · 水域/泥地减速 · T${map.tier >= 3 ? map.tier : 3} 起出现持续伤害区域</div>
    `;
  },

  renderSkillPreview() {
    const container = document.getElementById('prepSkillGrid');
    if (!container) return;
    container.innerHTML = '';
    const boosts = CardSystem.getSelectedBoosts();
    CONFIG.skills.forEach(baseSkill => {
      const extra = boosts[baseSkill.id] || 0;
      const skill = getSkillStats(baseSkill, extra);
      const power = skill.damage || skill.stunDuration || skill.dashDistance || skill.stealthDuration;
      const div = document.createElement('div');
      div.className = 'prep-skill';
      div.innerHTML = `<div class="icon">${skill.icon}</div><div class="name">${skill.name} · Lv.${skill.level}${extra ? ` <span style="color:#83f2b2;">(+${extra})</span>` : ''}</div><div class="stats">效果 ${power} · 能量 ${skill.energyCost}<br>冷却 ${skill.cooldown} 秒</div>`;
      container.appendChild(div);
    });
  },

  renderLoadout() {
    const container = document.getElementById('loadoutGrid');
    container.innerHTML = '';
    CONFIG.consumables.forEach(item => {
      const equipped = GameState.loadout[item.id] || 0;
      const inWarehouse = Warehouse.getCount(item.id);
      const div = document.createElement('div');
      div.className = 'loadout-slot' + (equipped > 0 ? ' filled' : '');
      div.innerHTML = `
        <div class="item-icon">${item.icon}</div>
        <div>${item.name}</div>
        <div class="loadout-effect">${item.desc}</div>
        <div class="loadout-value">仓库 ${inWarehouse} · 已携带 ${equipped}</div>
      `;
      div.onclick = () => {
        if (equipped > 0) {
          GameState.loadout[item.id]--;
          Warehouse.addItem(item.id, 1);
          showToast(`卸下1个${item.name}，放回仓库`);
        } else {
          // 从仓库取（简化：可以免费配置，远征后消耗）
          GameState.loadout[item.id] = Math.min(5, (GameState.loadout[item.id] || 0) + 1);
          showToast(`装备1个${item.name}`, 'success');
        }
        SaveSystem.save();
        this.renderLoadout();
      };
      container.appendChild(div);
    });
  }
};

// ==================== 远征系统 ====================
