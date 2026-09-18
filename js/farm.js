const Farm = {
  init() {
    if (GameState.farmPlots.length === 36) return;
    GameState.farmPlots = [];
    for (let i = 0; i < 36; i++) {
      GameState.farmPlots.push({ crop: null, plantedAt: 0, ready: false, status: null, moisture: 80, quality: 'common', harvestCount: 0, fertilized: false });
    }
    if (!GameState.weather) { GameState.weather = 'sunny'; GameState.weatherTimer = 120; }
    if (!GameState.season) { GameState.season = 'spring'; GameState.seasonDay = 1; }
    if (!GameState.workshopLevel) GameState.workshopLevel = 1;
    if (!GameState.processingQueue) GameState.processingQueue = [];
    if (!GameState.cropCollection) GameState.cropCollection = {};
    if (!GameState.decorations) GameState.decorations = [];
    if (!GameState.farmBeauty) GameState.farmBeauty = 0;
    if (!GameState.visitorState) { GameState.visitorState = 'none'; GameState.visitorTimer = 120; GameState.visitorName = ''; }
    if (GameState.waterCooldown === undefined) GameState.waterCooldown = 0;
    // 初始种一些
    for (let i = 0; i < 3; i++) {
      const idx = randInt(0, GameState.unlockedPlots - 1);
      if (!GameState.farmPlots[idx].crop) {
        GameState.farmPlots[idx].crop = CONFIG.crops[0];
        GameState.farmPlots[idx].plantedAt = Date.now() - rand(5000, 20000);
        GameState.farmPlots[idx].moisture = 80;
        GameState.farmPlots[idx].quality = 'common';
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
        const traitMul = (typeof FarmTraitSystem !== 'undefined') ? FarmTraitSystem.growSpeedMultiplier(idx) : 1;
        const statusFactor = plot.status === 'drought' ? 0.55 : (plot.status === 'pest' ? 0.72 : (plot.status === 'weeds' ? 0.82 : (plot.status === 'burn' ? 0.4 : 1)));
        const progress = clamp((elapsed * statusFactor * traitMul) / plot.crop.growTime, 0, 1);
        plot.ready = progress >= 1;
        cell.classList.add(plot.ready ? 'ready' : 'planted');
        cell.classList.add(`rarity-${plot.crop.rarity || 'common'}`);
        const qColor = (typeof FarmCollectionSystem !== 'undefined') ? FarmCollectionSystem.qualityColor(plot.quality) : '#fff';
        const statusIcons = { drought: '🍂', pest: '🐛', weeds: '🌿', burn: '🔥', beast: '🐗' };
        const moistureBar = plot.moisture !== undefined ? `<div class="moisture-bar" style="position:absolute;bottom:2px;left:4px;right:4px;height:3px;background:#1a2a1a;border-radius:2px;"><div style="height:100%;width:${plot.moisture}%;background:${plot.moisture<30?'#ff6644':'#44aaff'};border-radius:2px;"></div></div>` : '';
        cell.innerHTML = `<span style="color:${qColor}">${plot.crop.icon}</span>${plot.status ? `<div class="plot-status">${statusIcons[plot.status]}</div>` : ''}<div class="growth-bar"><div class="growth-fill" style="width:${progress*100}%"></div></div>${moistureBar}`;
        const statusNames = { drought:'干旱', pest:'虫害', weeds:'杂草', burn:'烧苗', beast:'野兽偷食' };
        // v0.9.0 使用扩展渲染（4阶段+品质+组合）
        if (typeof CropRenderExt !== 'undefined' && plot.crop) {
          CropRenderExt.renderPlot(plot, idx, cell);
        }
        cell.title = plot.status ? `状态：${statusNames[plot.status]||plot.status}，点击照料` : (plot.ready ? '点击收获' : `生长中 · 湿度${Math.floor(plot.moisture||0)}%`);
        cell.onclick = () => plot.status ? Farm.tend(idx) : Farm.harvest(idx);
      } else {
        cell.innerHTML = '<div style="color:#5a7a5a;font-size:18px;">+</div>';
        cell.onclick = () => Farm.showCropPicker(idx);
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

  showCropPicker(idx) {
    const existing = document.getElementById('cropPickerOverlay');
    if (existing) { existing.remove(); return; }
    const unlocked = CONFIG.crops.filter(c => GameState.unlockedCrops.includes(c.id));
    let html = `<div style="width:520px;max-height:80vh;overflow-y:auto;background:#1a241a;border:1px solid #6a4a2a;border-radius:12px;padding:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="color:#ffd700;margin:0;">🌱 选择作物</h3>
        <span style="color:#888;font-size:12px;">种子：${Warehouse.getCount('seeds')}</span>
      </div>`;
    unlocked.forEach(crop => {
      html += `<div style="padding:8px;margin:4px 0;background:rgba(0,0,0,0.3);border-radius:6px;display:flex;justify-content:space-between;align-items:center;">
        <span style="color:#${crop.rarity==='legendary'?'ffd700':crop.rarity==='rare'?'bb88ff':'#ddd'}">${crop.icon} ${crop.name}</span>
        <span style="display:flex;align-items:center;gap:8px;">
          <span style="color:#888;font-size:11px;">${crop.growTime}秒 · 卖${crop.sellPrice}金</span>
          <button class="secondary-btn" style="font-size:11px;" onclick="Farm.plantFromPicker(${idx}, '${crop.id}')">种植</button>
        </span>
      </div>`;
    });
    html += '</div>';
    const overlay = document.createElement('div');
    overlay.id = 'cropPickerOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = html;
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
  },

  plantFromPicker(idx, cropId) {
    const existing = document.getElementById('cropPickerOverlay');
    if (existing) existing.remove();
    GameState.selectedCrop = cropId;
    this.plant(idx);
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
    GameState.farmPlots[idx].moisture = 80;
    GameState.farmPlots[idx].harvestCount = 0;
    GameState.farmPlots[idx].fertilized = false;
    GameState.farmPlots[idx].quality = (typeof FarmCollectionSystem !== 'undefined') ? FarmCollectionSystem.rollQuality(crop) : 'common';
    const ailmentRoll = Math.random();
    GameState.farmPlots[idx].status = ailmentRoll < 0.08 ? 'drought' : (ailmentRoll < 0.14 ? 'pest' : (ailmentRoll < 0.21 ? 'weeds' : null));
    Warehouse.removeItem('seeds', 1);
    const qText = GameState.farmPlots[idx].quality !== 'common' ? `（${FarmCollectionSystem.qualityName(GameState.farmPlots[idx].quality)}品质）` : '';
    showToast(`种下了${crop.name}${qText}`, 'success');
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
    // v0.9.0 品质roll（如果还没有）
    if (!plot.quality || plot.quality === 'common') {
      const combo = (typeof CropExpansion !== 'undefined') ? CropExpansion.ComboSystem.getComboBonus(idx) : { qualityBonus: 0 };
      plot.quality = (typeof CropExpansion !== 'undefined') ? CropExpansion.QualitySystem.rollQuality(crop.rarity, combo.qualityBonus) : 'common';
    }
    // v0.9.0 品质收获特效
    if (typeof CropRenderExt !== 'undefined') CropRenderExt.playHarvestEffect(plot, idx);
    // 特性系统：产量倍率
    const yieldQty = (typeof FarmTraitSystem !== 'undefined') ? FarmTraitSystem.harvestYield(idx) : 1;
    // 变异尝试
    if (typeof FarmCollectionSystem !== 'undefined') FarmCollectionSystem.tryMutate(idx);
    // 收集记录
    if (typeof FarmCollectionSystem !== 'undefined') FarmCollectionSystem.recordCollection(crop.id, plot.quality);
    // 作物存入仓库
    const added = Warehouse.addItem(crop.id, yieldQty);
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
    // v0.9.0 作物buff系统
    if (typeof CropExpansion !== 'undefined' && crop.buffType) {
      const qualityMult = CropExpansion.QualitySystem.getQualityMultiplier(plot.quality);
      const buffValue = (crop.buffValue || 0.1) * qualityMult;
      CropExpansion.CropBuffSystem.addBuff(crop.buffType, buffValue, crop.buffDuration || 1, crop.id, plot.quality);
    }
    // v0.9.0 稀有事件（千年人参等）
    if (typeof CropExpansion !== 'undefined') {
      const event = CropExpansion.RareEventSystem.triggerHarvestEvent(crop.id, plot.quality);
      if (event) {
        const bonusGold = Math.floor(crop.sellPrice * (event.priceMultiplier || 1));
        GameState.gold += bonusGold;
        rewardText += `，${event.name}！金币+${bonusGold}`;
        if (event.npcAffectionAll && typeof NpcSystem !== 'undefined') {
          Object.keys(NpcSystem.NPCS).forEach(id => NpcSystem.addAffection(id, event.npcAffectionAll));
          rewardText += '，所有NPC好感+' + event.npcAffectionAll;
        }
        showToast(`🌟 ${event.name}！`, 'gold');
      }
    }
    // 反复收获特性
    const canReharvest = (typeof FarmTraitSystem !== 'undefined') && FarmTraitSystem.shouldRemainAfterHarvest(idx);
    if (canReharvest) {
      plot.harvestCount = (plot.harvestCount || 0) + 1;
      plot.ready = false;
      plot.plantedAt = Date.now() - plot.crop.growTime * 1000 * 0.7;
      showToast(`收获${crop.name}，${rewardText}（可再收${3-plot.harvestCount}次）`, 'gold');
    } else {
      showToast(`收获${crop.name}，${rewardText}`, 'gold');
      plot.crop = null;
      plot.ready = false;
      plot.status = null;
      plot.harvestCount = 0;
      plot.fertilized = false;
    }
    SaveSystem.save();
    this.render();
  },

  tend(idx) {
    const plot = GameState.farmPlots[idx];
    if (!plot?.status) return;
    const names = { drought: '浇水', pest: '除虫', weeds: '除草', burn: '抢救烧苗', beast: '驱赶野兽' };
    if (plot.status === 'beast') {
      if (typeof FarmCareSystem !== 'undefined') FarmCareSystem.chaseBeast(idx);
      else { plot.status = null; showToast('驱赶野兽成功', 'success'); }
      SaveSystem.save();
      this.render();
      return;
    }
    if (GameState.gold < 4) {
      showToast('需要4金币购买基础农具', 'warning');
      return;
    }
    GameState.gold -= 4;
    if (plot.status === 'drought' && typeof FarmCareSystem !== 'undefined') plot.moisture = 100;
    showToast(`${names[plot.status] || '照料'}完成，作物恢复正常生长`, 'success');
    plot.status = null;
    SaveSystem.save();
    this.render();
  },

  water(idx) {
    if (typeof FarmCareSystem !== 'undefined') FarmCareSystem.waterPlot(idx);
    this.render();
  },

  fertilize(idx, premium) {
    if (typeof FarmCareSystem !== 'undefined') FarmCareSystem.fertilizePlot(idx, premium);
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

    // 随机地图按钮
    const randDiv = document.createElement('div');
    randDiv.className = 'map-option map-random';
    randDiv.style.cssText = 'border:2px dashed #f2d28a;background:rgba(242,210,138,0.08);cursor:pointer;min-height:120px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;';
    randDiv.innerHTML = `
      <div style="font-size:32px;">🎲</div>
      <div style="font-weight:700;color:#f2d28a;font-size:14px;">随机地图</div>
      <div style="font-size:11px;color:#aab;">从已解锁层级随机一张</div>
    `;
    randDiv.onclick = () => {
      const affordable = CONFIG.maps.filter(m => GameState.gold >= m.entryFee);
      if (!affordable.length) return;
      GameState.selectedMap = affordable[Math.floor(Math.random() * affordable.length)].id;
      SaveSystem.save();
      this.renderMapSelect();
    };
    container.appendChild(randDiv);

    CONFIG.maps.forEach(map => {
      const div = document.createElement('div');
      const locked = GameState.gold < map.entryFee;
      div.className = 'map-option' + (GameState.selectedMap === map.id ? ' selected' : '') + (locked ? ' locked' : '');
      div.style.cssText += ';position:relative;overflow:hidden;';
      const thumb = map.bgImage ? `<img src="${map.bgImage}" style="position:absolute;top:0;left:0;width:100%;height:60%;object-fit:cover;opacity:0.85;z-index:0;" onerror="this.style.display='none'"/>` : '';
      const modifierTag = map.modifier && map.modifier !== '标准'
        ? `<div style="display:inline-block;margin-top:4px;padding:2px 8px;background:rgba(255,120,80,0.2);border:1px solid #ff8866;border-radius:10px;font-size:11px;color:#ffaa88;">⚡ ${map.modifier}</div>`
        : '';
      div.innerHTML = `
        ${thumb}
        <div style="position:relative;z-index:1;background:linear-gradient(transparent,rgba(0,0,0,0.85) 40%);padding-top:60px;">
          <div class="map-name">T${map.tier} ${map.name} <span style="font-size:12px;color:#ff8866;">[${map.danger}]</span></div>
          ${modifierTag}
          <div class="map-info">
            <span style="display:inline-flex;align-items:center;gap:3px;">${(typeof CropArt!=='undefined')?CropArt.dom('coin','',15):''} ${map.entryFee}</span>
            <span><span style="display:inline-flex;width:15px;height:15px;border-radius:50%;background:radial-gradient(circle,#c0392b,#7b1f15);color:#ffd9d2;font-size:9px;font-weight:700;align-items:center;justify-content:center;vertical-align:-2px;">敌</span> ${map.monsterCount}</span>
            <span><span style="display:inline-flex;width:15px;height:15px;border-radius:3px;background:linear-gradient(135deg,#a9772f,#6e4c18);color:#ffe2ae;font-size:9px;font-weight:700;align-items:center;justify-content:center;vertical-align:-2px;">箱</span> ${map.chestCount}</span>
          </div>
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
      const skArt = (typeof CropArt!=='undefined' && CropArt.ready(baseSkill.id)) ? CropArt.dom(baseSkill.id, skill.icon, 34) : skill.icon;
      div.innerHTML = `<div class="icon" style="display:flex;align-items:center;justify-content:center;">${skArt}</div><div class="name">${skill.name} · Lv.${skill.level}${extra ? ` <span style="color:#83f2b2;">(+${extra})</span>` : ''}</div><div class="stats">效果 ${power} · 能量 ${skill.energyCost}<br>冷却 ${skill.cooldown} 秒</div>`;
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
      const ciArt = (typeof CropArt!=='undefined' && CropArt.ready(item.id)) ? CropArt.dom(item.id, item.icon, 34) : item.icon;
      div.innerHTML = `
        <div class="item-icon" style="display:flex;align-items:center;justify-content:center;">${ciArt}</div>
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
  },

  // 植物防线配置（培育到100可携带部署）
  renderDefenseLoadout() {
    const container = document.getElementById('defenseLoadoutGrid');
    if (!container) return;
    container.innerHTML = '';
    const g = CONFIG.plantGrowth;
    CONFIG.plants.forEach(plant => {
      const rec = GameState.defensePlants[plant.id] || { progress: 0, count: 0 };
      const deployable = rec.progress >= g.deployable && rec.count > 0;
      const equipped = GameState.defenseLoadout.includes(plant.id);
      const div = document.createElement('div');
      div.className = 'loadout-slot' + (equipped ? ' filled' : '') + (rec.count <= 0 ? ' muted' : '');
      const stage = rec.progress >= g.deployable ? '可部署' : (rec.progress >= g.mature ? '成熟' : (rec.progress >= g.seedling ? '幼苗' : '未培育'));
      const plArt = (typeof CropArt!=='undefined' && CropArt.ready(plant.id)) ? CropArt.dom(plant.id, plant.icon, 34) : plant.icon;
      div.innerHTML = `
        <div class="item-icon" style="display:flex;align-items:center;justify-content:center;">${plArt}</div>
        <div>${plant.name} <small style="color:#8fa;font-size:10px;">${stage}</small></div>
        <div class="loadout-effect">${plant.desc}</div>
        <div class="loadout-value">持有 ${rec.count} · 培育 ${Math.floor(rec.progress)}/100</div>
        <div class="growth-bar" style="height:6px;margin-top:4px;background:#1c2a20;border-radius:3px;overflow:hidden;">
          <div class="growth-fill" style="width:${Math.floor(rec.progress)}%;height:100%;background:linear-gradient(90deg,#3f9d56,#7dff9a);"></div>
        </div>
        <div class="loadout-value" style="color:#9fd7b2;">${deployable ? (equipped ? '✔ 已装备' : '点击装备携带') : (rec.count > 0 ? `培育${g.deployable}后携带` : '远征宝箱获取种子')}</div>
      `;
      if (deployable) {
        div.style.cursor = 'pointer';
        div.onclick = () => {
          if (equipped) {
            GameState.defenseLoadout = GameState.defenseLoadout.filter(id => id !== plant.id);
            showToast(`卸下防线：${plant.name}`);
          } else {
            if (GameState.defenseLoadout.length >= 6) {
              showToast('防线携带上限为6种', 'warning');
              return;
            }
            GameState.defenseLoadout.push(plant.id);
            showToast(`装备防线：${plant.name}`, 'success');
          }
          SaveSystem.save();
          this.renderDefenseLoadout();
        };
      } else {
        div.title = rec.count > 0 ? `培育到${g.deployable}后可携带部署` : '未持有种子，远征宝箱有概率掉落';
      }
      container.appendChild(div);
    });
  }
};

// ==================== 远征系统 ====================
