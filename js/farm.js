const Farm = {
  PLOT_COUNT: 48,
  init() {
    // v5.1 农田扩至 48 格（旧档 36 格自动补齐，不重置已有作物）
    const FARM_PLOT_COUNT = this.PLOT_COUNT;
    while (GameState.farmPlots.length < FARM_PLOT_COUNT) {
      GameState.farmPlots.push({ crop: null, plantedAt: 0, ready: false, status: null, moisture: 80, quality: 'common', harvestCount: 0, fertilized: false });
    }
    if (GameState.farmPlots.length > FARM_PLOT_COUNT) GameState.farmPlots.length = FARM_PLOT_COUNT;
    if (!GameState.unlockedPlots || GameState.unlockedPlots > FARM_PLOT_COUNT) GameState.unlockedPlots = Math.min(GameState.unlockedPlots || 8, FARM_PLOT_COUNT);
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
    if (!grid) return; // 农场屏不在 DOM 时（准备大厅/远征）定时渲染直接跳过
    grid.innerHTML = '';
    const now = Date.now();
    const title = document.querySelector('.farm-grid-title');
    if (title) title.textContent = `农田 ${GameState.unlockedPlots}/${this.PLOT_COUNT}（点击状态图标照料作物，点击锁定格扩建）`;
    GameState.farmPlots.forEach((plot, idx) => {
      const cell = document.createElement('div');
      cell.className = 'farm-cell';
      if (idx >= GameState.unlockedPlots) {
        const cost = this.getUnlockCost(idx);
        cell.classList.add('locked');
        if (idx === GameState.unlockedPlots) cell.classList.add('next-unlock');
        cell.innerHTML = `<div class="plot-lock">🔒<div class="plot-cost">${idx === GameState.unlockedPlots ? `💰${cost.gold}${cost.fiber ? ` · 🌾纤维×${cost.fiber}` : ''}` : '依次扩建'}</div></div>`;
        cell.onclick = () => this.unlockPlot(idx);
        grid.appendChild(cell);
        return;
      }
      if (plot.crop) {
        const elapsed = (now - plot.plantedAt) / 1000;
        const traitMul = (typeof FarmTraitSystem !== 'undefined') ? FarmTraitSystem.growSpeedMultiplier(idx) : 1;
        const statusFactor = plot.status === 'drought' ? 0.55 : (plot.status === 'pest' ? 0.72 : (plot.status === 'weeds' ? 0.82 : (plot.status === 'burn' ? 0.4 : 1)));
        const beautyMul = (typeof FarmDecorationSystem !== 'undefined') ? FarmDecorationSystem.growthMul() : 1;
        const progress = clamp((elapsed * statusFactor * traitMul * beautyMul) / plot.crop.growTime, 0, 1);
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
    let _matTotal = 0;
    if (window.ResourceSystem && CONFIG.resources) { Object.keys(CONFIG.resources).forEach(id => { _matTotal += ResourceSystem.count(id); }); }
    document.getElementById('materialDisplay').textContent = _matTotal;
    const catalystCount = document.getElementById('growthCatalystCount');
    if (catalystCount) catalystCount.textContent = Warehouse.getCount('growth_catalyst');
    this.renderCropSelector();
    this.renderCropDetail();
    RewardSystem.render();
  },

  plantAllPicker() {
    const old = document.getElementById('cropPickerOverlay');
    if (old) old.remove();
    const unlocked = CONFIG.crops.filter(c => GameState.unlockedCrops.includes(c.id));
    const emptyCount = GameState.farmPlots.filter((p,i) => i < GameState.unlockedPlots && !p.crop).length;
    const seedCount = Warehouse.getCount('seeds');
    const overlay = document.createElement('div');
    overlay.id = 'cropPickerOverlay';
    overlay.className = 'crop-picker-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    let cards = '';
    unlocked.forEach(crop => {
      const art = (typeof CropArt !== 'undefined' && CropArt.ready(crop.id)) ? CropArt.dom(crop.id, crop.icon, 34) : crop.icon;
      cards += '<div class="crop-picker-item" onclick="Farm.plantAll(\''+crop.id+'\')">'
        + '<div style="height:36px;display:flex;align-items:center;justify-content:center;">'+art+'</div>'
        + '<div style="font-weight:800;font-size:12px;">'+crop.name+'</div>'
        + '<div style="font-size:10px;color:#9fb3a5;">'+(crop.rewardLabel || ('卖 '+crop.sellPrice+' 金'))+'</div>'
        + '<div style="font-size:10px;color:#d8c27a;">生长 '+crop.growTime+'s</div></div>';
    });
    overlay.innerHTML = '<div class="crop-picker-panel">'
      + '<div class="crop-picker-title">🌱 一键种植 · 种满全部空地</div>'
      + '<div style="font-size:12px;color:#b9c8bd;margin:6px 0 10px;">空闲地块 <b style="color:#cfe6a0">'+emptyCount+'</b> 块 · 通用种子 <b style="color:#e0c878">'+seedCount+'</b>（每格耗 1 种子，自动跳过已种地块）</div>'
      + '<div class="crop-picker-grid">'+cards+'</div>'
      + '<button class="secondary-btn" style="margin-top:12px;" onclick="this.closest(\'#cropPickerOverlay\').remove()">取消</button>'
      + '</div>';
    document.body.appendChild(overlay);
  },
  plantAll(cropId) {
    const crop = CONFIG.crops.find(c => c.id === cropId);
    if (!crop) return;
    GameState.selectedCrop = cropId;
    let planted = 0;
    let lackSeed = false;
    for (let i = 0; i < GameState.unlockedPlots; i++) {
      const plot = GameState.farmPlots[i];
      if (plot.crop) continue;
      if (Warehouse.getCount('seeds') <= 0) { lackSeed = true; break; }
      if (!Warehouse.removeItem('seeds', 1)) { lackSeed = true; break; }
      plot.crop = crop;
      plot.plantedAt = Date.now();
      plot.ready = false;
      plot.moisture = 80;
      plot.harvestCount = 0;
      plot.fertilized = false;
      plot.quality = (typeof FarmCollectionSystem !== 'undefined') ? FarmCollectionSystem.rollQuality(crop) : 'common';
      const r = Math.random();
      plot.status = r < 0.08 ? 'drought' : (r < 0.14 ? 'pest' : (r < 0.21 ? 'weeds' : null));
      planted++;
    }
    const ov = document.getElementById('cropPickerOverlay');
    if (ov) ov.remove();
    if (planted <= 0) { showToast(lackSeed ? '通用种子不足，无法一键种植' : '没有空闲地块', 'warning'); return; }
    showToast('已在 '+planted+' 块空地种满'+crop.name+(lackSeed?'（种子用完了）':''), 'success');
    SaveSystem.save();
    this.render();
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
          <span style="color:#9fd8ff;font-size:11px;" title="${this.yieldDetail(crop).replace(/\n/g,'&#10;')}">${this.yieldSummary(crop)}</span>
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

  // ===== v5.1 作物产出说明（材料数据来自 CONFIG.cropMaterials，由 v5.js 注册）=====
  materialYield(cropId) {
    const list = (CONFIG.cropMaterials && CONFIG.cropMaterials[cropId]) || [];
    return list.map(([mid, prob, qty]) => {
      const r = (CONFIG.resources && CONFIG.resources[mid]) || (CONFIG.materials && CONFIG.materials[mid]) || { icon: '📦', name: mid };
      const pTxt = prob >= 1 ? '必出' : `${Math.round(prob * 100)}%`;
      return `${r.icon}${r.name} ${pTxt}×${qty}`;
    });
  },

  yieldSummary(crop) {
    const parts = [`💰${crop.sellPrice}`];
    if (crop.cultivation) parts.push(`🧘${crop.cultivation}`);
    const mats = this.materialYield(crop.id);
    mats.slice(0, 2).forEach(m => { const a = m.split(' '); parts.push(a[0] + ' ' + a[1]); });
    return `${crop.growTime}秒 · ` + parts.join(' · ');
  },

  yieldDetail(crop) {
    const lines = [`${crop.growTime}秒成熟 · 售价 ${crop.sellPrice} 金币`];
    if (crop.rewardLabel) lines.push(`产出：${crop.rewardLabel}`);
    if (crop.cultivation) lines.push(`修为：${crop.cultivation} 点/株（高品质加成）`);
    const mats = this.materialYield(crop.id);
    if (mats.length) lines.push(`打造材料：${mats.join('、')}`);
    if (crop.description) lines.push(crop.description);
    if (crop.desc) lines.push(crop.desc);
    return lines.join('\n');
  },

  renderCropDetail() {
    const box = document.getElementById('cropDetailPanel');
    if (!box) return;
    const crop = CONFIG.crops.find(c => c.id === GameState.selectedCrop);
    if (!crop) { box.innerHTML = ''; return; }
    const mats = this.materialYield(crop.id);
    const buffTxt = crop.description || crop.desc || '';
    box.innerHTML = `
      <div class="crop-detail-title">${crop.icon} ${crop.name} <span style="color:#888;font-size:12px;font-weight:normal;">${crop.growTime}秒成熟 · 种子价 ${crop.seedPrice || crop.price || '-'} · 售价 💰${crop.sellPrice}</span></div>
      <div class="crop-detail-row"><span class="cdl-label">产出：</span><span class="cdl-value">${crop.rewardLabel || '金币（收获出售）'}</span></div>
      ${crop.cultivation ? (() => { let _tip = '🧘 ' + crop.cultivation + ' 点/株（高品质有加成）'; try { const CS = window.CharacterSystem; if (CS && GameState.level < 100) { const _need = CS.expNeeded(GameState.level), _have = GameState.cultivation || 0, _n = Math.max(1, Math.ceil((_need - _have) / crop.cultivation)); _tip += '；再种约 ' + _n + ' 株可升 Lv' + (GameState.level + 1); } } catch (e) {} return `<div class="crop-detail-row"><span class="cdl-label">修为：</span><span class="cdl-value">${_tip}</span></div>`; })() : ''}
      ${mats.length ? `<div class="crop-detail-row"><span class="cdl-label">打造材料：</span><span class="cdl-value mat">${mats.join('　')}</span></div>` : '<div class="crop-detail-row"><span class="cdl-label">打造材料：</span><span class="cdl-value" style="color:#777;">无（该作物不出产武器材料）</span></div>'}
      ${buffTxt ? `<div class="crop-detail-row"><span class="cdl-label">特性：</span><span class="cdl-value" style="color:#9fc78f;">${buffTxt}</span></div>` : ''}
    `;
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
        button.innerHTML = `<span>${crop.icon} ${crop.name}</span><small>${this.yieldSummary(crop)}</small>`;
        button.title = this.yieldDetail(crop);
        button.onclick = () => {
          GameState.selectedCrop = crop.id;
          SaveSystem.save();
          this.renderCropSelector();
          this.renderCropDetail();
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
    // 修为作物（凝气草等）不进仓库、不掉种子/卡牌，只转化修为
    const isCult = crop.rewardType === 'cultivation';
    const added = isCult ? 0 : Warehouse.addItem(crop.id, yieldQty);
    let matGained = [];
    if (window.CharacterSystem) matGained = CharacterSystem.onCropHarvested(crop.id, yieldQty, plot.quality) || [];
    let rewardText = isCult ? `${crop.name} 已转化为修为` : `${crop.name} ×${added} 已入仓`;
    if (!isCult && matGained.length) rewardText += '，' + matGained.join('、') + ' 已入材料库';
    // 30% 概率额外获得种子，存入仓库（修为作物除外）
    if (!isCult && Math.random() < 0.3) {
      Warehouse.addItem('seeds', 1);
      rewardText += '，种子 ×1 已入仓';
    }
    // v5.1 打造材料统一由 CharacterSystem.onCropHarvested 按作物映射发放（CONFIG.cropMaterials）
    if (crop.rewardType === 'gold') {
      const bonusGold = randInt(25, 45);
      GameState.gold += bonusGold;
      rewardText += `，额外金币 +${bonusGold}`;
    } else if (crop.rewardType === 'healing') {
      Warehouse.addItem('herb_kit', 1);
      rewardText += '，草药包扎包 ×1 已入仓';
    } else if (crop.rewardType === 'torch') {
      const torchQty = (crop.torchQty || 2) * yieldQty;
      Warehouse.addItem('torch', torchQty);
      rewardText += '，火把 ×' + torchQty + ' 已入仓';
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
    } else if (!isCult) {
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
    // v5.1 第 13 块地起额外需要植物纤维（收获农作物获得）
    const step = Math.max(0, idx - 8);
    return { gold: 90 + step * 35, fiber: step < 4 ? 0 : Math.floor((step - 4) / 5) + 1 };
  },

  unlockPlot(idx) {
    if (idx !== GameState.unlockedPlots) {
      showToast('请按顺序扩建相邻农田', 'warning');
      return;
    }
    const cost = this.getUnlockCost(idx);
    if (GameState.gold < cost.gold) {
      showToast(`扩建需要 ${cost.gold} 金币`, 'warning');
      return;
    }
    if (cost.fiber > 0) {
      const have = (window.ResourceSystem && ResourceSystem.count('fiber')) || 0;
      if (have < cost.fiber) {
        showToast(`扩建还需要 🌾植物纤维 ×${cost.fiber}（收获农作物获得）`, 'warning');
        return;
      }
      ResourceSystem.pay({ fiber: cost.fiber });
    }
    GameState.gold -= cost.gold;
    GameState.unlockedPlots++;
    SaveSystem.save();
    showToast(`新农田已解锁：${GameState.unlockedPlots}/${this.PLOT_COUNT}`, 'gold');
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
    const boosts = {}; // v5.6 强化卡改为卡牌工坊永久升级，准备大厅不再临选
    // v5.1 只显示修行台已装备的技能
    let equippedIds = [];
    if (typeof CharacterSystem !== 'undefined') {
      CharacterSystem.init();
      equippedIds = CharacterSystem.getEquipped(); // v5.1 返回值即为技能 id 数组
    } else {
      equippedIds = CONFIG.skills.slice(0, 4).map(s => s.id);
    }
    if (!equippedIds.length) {
      container.innerHTML = '<div style="grid-column:1/-1;color:#c9a06a;font-size:12px;text-align:center;padding:12px;">尚未在「修行台」装备技能，请先回农场装备</div>';
      return;
    }
    equippedIds.forEach(sid => {
      const baseSkill = CONFIG.skills.find(s => s.id === sid) || (typeof SKILLS !== 'undefined' ? SKILLS[sid] : null);
      if (!baseSkill) return;
      const extra = boosts[baseSkill.id] || 0;
      const skill = getSkillStats(baseSkill, extra);
      const pct100 = v => Math.round(v * 100) + '%';
      let power = skill.damage || skill.stunDuration || skill.dashDistance || skill.stealthDuration ||
        skill.shield || skill.hot || skill.dot || skill.thornsDps || skill.jumps;
      if (!power) {
        if (skill.reflect) power = '反弹' + pct100(skill.reflect);
        else if (skill.reduce) power = '减伤' + pct100(skill.reduce);
        else if (skill.atkSpd || skill.moveSpd) power = '攻速' + pct100(skill.atkSpd || 0) + '/移速' + pct100(skill.moveSpd || 0);
        else if (skill.slow) power = '减速' + pct100(skill.slow);
        else if (skill.duration) power = skill.duration + '秒';
        else power = '—';
      }
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
    // v5.5 准备大厅：战术消耗品(Q/R/E) + 背包补给(食品/药品/火把，局内 Tab 背包使用)
    const mkLoadoutSlot = (item, hot) => {
      const equipped = GameState.loadout[item.id] || 0;
      const inWarehouse = Warehouse.getCount(item.id);
      const div = document.createElement('div');
      div.className = 'loadout-slot' + (equipped > 0 ? ' filled' : '') + (equipped <= 0 && inWarehouse <= 0 ? ' muted' : '');
      const ciArt = (typeof CropArt!=='undefined' && CropArt.ready(item.id)) ? CropArt.dom(item.id, item.icon, 34) : item.icon;
      div.innerHTML = `
        <div class="item-icon" style="display:flex;align-items:center;justify-content:center;">${ciArt}</div>
        <div>${item.name}</div>
        <div class="loadout-effect">${item.desc}</div>
        <div class="loadout-value">仓库 ${inWarehouse} · 已携带 ${equipped}/5</div>
        <div class="loadout-hint" style="font-size:10px;color:${equipped>0?'#9fc78f':(inWarehouse>0?'#c9b98a':'#d98a6a')};">${equipped > 0 ? '点击再带1个 · 右键卸下1个' : (inWarehouse > 0 ? '点击从仓库取出携带' : '仓库中没有，无法携带')}</div>
      `;
      div.onclick = () => {
        const cur = GameState.loadout[item.id] || 0;
        const typeCount = Object.keys(GameState.loadout).filter(k => (GameState.loadout[k] || 0) > 0).length;
        if (cur === 0 && typeCount >= 6) { showToast('最多携带 6 种消耗品（含火把），请先卸下其他种类', 'warning'); return; }
        if (cur >= 5) { showToast('每种消耗品最多携带 5 个', 'warning'); return; }
        if (Warehouse.getCount(item.id) <= 0) { showToast(`仓库中没有 ${item.name}，无法携带`, 'warning'); return; }
        if (!Warehouse.removeItem(item.id, 1)) { showToast(`仓库中没有 ${item.name}，无法携带`, 'warning'); return; }
        GameState.loadout[item.id] = cur + 1;
        showToast(`携带 ${item.name} ×${cur + 1}（从仓库取出）`, 'success');
        SaveSystem.save();
        this.renderLoadout();
      };
      div.oncontextmenu = (e) => {
        e.preventDefault();
        const cur = GameState.loadout[item.id] || 0;
        if (cur <= 0) return;
        GameState.loadout[item.id] = cur - 1;
        if (GameState.loadout[item.id] <= 0) delete GameState.loadout[item.id];
        Warehouse.addItem(item.id, 1);
        showToast(`卸下1个${item.name}，放回仓库`);
        SaveSystem.save();
        this.renderLoadout();
      };
      container.appendChild(div);
      return div;
    };
    const grpHdr = (txt) => { const h = document.createElement('div'); h.style.cssText='width:100%;color:#cfe6a0;font-weight:bold;font-size:13px;margin:10px 0 2px;'; h.textContent=txt; container.appendChild(h); };
    const carriedTypes = Object.keys(GameState.loadout).filter(k => (GameState.loadout[k] || 0) > 0).length;
    grpHdr('携带消耗品（最多 6 种，每种最多 5 个，火把计入种类；Q 草药 · E 信号弹 · R 道具转盘，当前 ' + carriedTypes + '/6 种）');
    CONFIG.consumables.forEach(i => container.appendChild(mkLoadoutSlot(i, !!i.key)));
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
