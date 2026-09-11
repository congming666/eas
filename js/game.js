const Game = {
  expedition: null,
  animId: null,

  startGame() {
    // 1) 立即切换界面：隐藏菜单、显示农场（保证点击后第一时间有画面反馈）
    document.getElementById('mainMenu').classList.add('hidden');
    document.getElementById('farmScreen').classList.remove('hidden');
    GameState.screen = 'farm';
    // 隐藏星云/文字粒子合成层，释放 GPU 合成开销（返回菜单时恢复）
    this.hideNebulaFX(true);
    AudioManager.start('farm');

    // 2) 分帧执行：存档加载 + 农场渲染延后到下一帧，
    //    避免与界面切换/音频启动挤在同一帧造成低配机帧突刺（表现为"卡住"）
    clearTimeout(this._farmTimer);
    this._farmTimer = setTimeout(() => {
      try {
        SaveSystem.load();
        Farm.init();
        Farm.render();
        // v0.8.0 初始化NPC和科技系统
        if (typeof NpcSystem !== 'undefined') NpcSystem.init();
        if (typeof TechSystem !== 'undefined') TechSystem.init();
        if (typeof CropExpansion !== 'undefined') { CropExpansion.registerCrops(); CropExpansion.CropBuffSystem.init(); }
        if (typeof AchievementSystem !== 'undefined') AchievementSystem.init();
        if (typeof LoadoutSystem !== 'undefined') LoadoutSystem.init();
        if (GameState.lastDailyClaim !== RewardSystem.dateKey()) {
          showToast('家园补给站有今日奖励可以领取', 'gold');
        }
      } catch (error) {
        console.error('[Farm] 农场初始化失败（已兜底，不影响主流程）:', error);
      }
      // 农场生长定时器（渲染异常不中断游戏）
      this._startFarmTimer();
    }, 80);
  },

  hideNebulaFX(hidden) {
    // nebulaBg（z-index:1 的深色星空背景层）必须与粒子层同进退，
    // 否则它会盖在 gameCanvas（z-index:0）上方，导致远征画面被整块遮住（玩家/地形不可见）。
    ['nebulaBg', 'nebulaCanvas', 'nebulaTextFx'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.visibility = hidden ? 'hidden' : 'visible';
    });
  },

  backToMenu() {
    AudioManager.setScene('menu');
    SaveSystem.save();
    clearInterval(this.farmInterval);
    document.getElementById('farmScreen').classList.add('hidden');
    document.getElementById('expeditionPrepScreen').classList.add('hidden');
    document.getElementById('mainMenu').classList.remove('hidden');
    GameState.screen = 'menu';
    // 恢复星云/文字粒子显示
    this.hideNebulaFX(false);
  },

  showHelp() {
    AudioManager.start('menu');
    showToast('WASD移动，左键攻击/交互，战利品会在近战范围内自动拾取，1-4技能', 'success');
    setTimeout(() => showToast('搜物资、打怪物、找撤离点，活着回来！', 'gold'), 1000);
  },

  openCardWorkshop() {
    CardSystem.renderWorkshop();
    document.getElementById('cardWorkshopModal').classList.remove('hidden');
  },

  closeCardWorkshop() {
    document.getElementById('cardWorkshopModal').classList.add('hidden');
  },

  openExpeditionPrep() {
    AudioManager.setScene('prep');
    SaveSystem.save();
    clearInterval(this.farmInterval);
    document.getElementById('farmScreen').classList.add('hidden');
    document.getElementById('expeditionPrepScreen').classList.remove('hidden');
    GameState.screen = 'prep';
    Farm.renderMapSelect();
    Farm.renderLoadout();
    Farm.renderDefenseLoadout();
    Farm.renderSkillPreview();
    CardSystem.renderBoostSelection();
    if (typeof DifficultySystem !== 'undefined') { DifficultySystem.renderDifficultySelect(); DifficultySystem.renderHeatSelect(); }
    // v0.9.0 渲染作物buff
    if (typeof CropExpansion !== 'undefined') {
      const buffs = CropExpansion.CropBuffSystem.getAllBuffs();
      const el = document.getElementById('cropBuffsDisplay');
      if (el) {
        if (buffs.length === 0) el.innerHTML = '暂无作物buff，去农场收获辣椒/薄荷/大蒜等获得';
        else el.innerHTML = buffs.map(b => `<div style="padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.1);">🌿 ${CropExpansion.CropBuffSystem._buffName(b.type)}：+${Math.round(b.value*100)}%（剩余${b.duration}场）</div>`).join('');
      }
    }
    // v1.0 渲染带入武器选择
    this.renderWeaponLoadout();
    this.renderSeedLoadout();
  },

  renderSeedLoadout() {
    const el = document.getElementById('seedLoadoutSelect');
    if (!el) return;
    el.innerHTML = '';
    const carried = GameState.carriedSeeds || (GameState.carriedSeeds = []);
    const crops = GameState.warehouse.crops || {};
    const deployMap = CONFIG.cropToDeploy;
    Object.keys(deployMap).forEach(cropId => {
      const count = crops[cropId] || 0;
      if (count <= 0) return;
      const deployId = deployMap[cropId];
      const plantDef = CONFIG.deployPlants[deployId];
      if (!plantDef) return;
      const carriedEntry = carried.find(c => c.type === deployId);
      const inBag = carriedEntry ? carriedEntry.count : 0;
      const div = document.createElement('div');
      div.style.cssText = 'padding:6px;border:2px solid ' + (inBag>0?'#7fff7f':'#444') + ';border-radius:6px;cursor:pointer;text-align:center;width:80px;background:rgba(0,0,0,0.3);';
      div.innerHTML = '<div style="font-size:20px;">' + plantDef.icon + '</div>' +
        '<div style="font-size:10px;color:#ccc;">' + plantDef.name + '</div>' +
        '<div style="font-size:9px;color:#888;">仓库x' + count + '</div>' +
        '<div style="font-size:9px;color:' + (inBag>0?'#7fff7f':'#666') + ';">带x' + inBag + '</div>';
      div.onclick = () => {
        const total = carried.reduce((sum,c)=>sum+c.count,0);
        if (inBag > 0) {
          carriedEntry.count--;
          if (carriedEntry.count <= 0) GameState.carriedSeeds = carried.filter(c => c !== carriedEntry);
        } else {
          if (total >= 5) { showToast('最多带5个种子', 'warning'); return; }
          let e = carried.find(c => c.type === deployId);
          if (!e) { e = { type: deployId, count: 0 }; carried.push(e); }
          e.count++;
        }
        SaveSystem.save();
        this.renderSeedLoadout();
      };
      el.appendChild(div);
    });
    if (el.children.length === 0) {
      el.innerHTML = '<div style="color:#888;font-size:11px;">仓库没有可种的作物，去农场种点辣椒/向日葵等</div>';
    }
  },

  renderWeaponLoadout() {
    const el = document.getElementById('weaponLoadoutSelect');
    if (!el) return;
    el.innerHTML = '';
    const insts = GameState.weaponInstances || [];
    if (insts.length === 0) {
      el.innerHTML = '<div style="color:#f66;font-size:12px;">仓库没有武器！去锻造台打造</div>';
      return;
    }
    const brought = GameState.loadoutWeaponUids || [];
    insts.forEach(inst => {
      const wpn = CONFIG.weapons.find(w => w.id === inst.weaponId);
      if (!wpn) return;
      const stats = LoadoutSystem.getInstanceStats(inst.uid);
      const isSelected = brought.includes(inst.uid);
      const div = document.createElement('div');
      div.style.cssText = `padding:8px;border:2px solid ${isSelected?'#ffd700':'#4a6a4a'};border-radius:8px;cursor:pointer;width:120px;text-align:center;background:${isSelected?'rgba(255,215,0,0.1)':'rgba(0,0,0,0.3)'};`;
      div.innerHTML = `<img src="${wpn.img}" style="width:80px;height:80px;object-fit:contain;border-radius:6px;" onerror="this.style.display='none'">
        <div style="font-size:12px;color:#e6bd54;font-weight:bold;margin-top:4px;">${wpn.name}${inst.level>0?' +'+inst.level:''}</div>
        <div style="font-size:10px;color:#999;">伤害${stats?stats.damage:wpn.damage}</div>
        <div style="font-size:9px;color:#666;">${inst.uid}</div>
        <div style="font-size:9px;color:${isSelected?'#ffd700':'#888'};">${isSelected?'✓ 已带入':'点击带入'}</div>`;
      div.onclick = () => {
        const arr = GameState.loadoutWeaponUids || (GameState.loadoutWeaponUids = []);
        const idx = arr.indexOf(inst.uid);
        if (idx >= 0) {
          arr.splice(idx, 1);
        } else {
          if (arr.length >= 2) { showToast('最多带2把武器', 'warning'); return; }
          arr.push(inst.uid);
        }
        SaveSystem.save();
        this.renderWeaponLoadout();
      };
      el.appendChild(div);
    });
  },

  _startFarmTimer() {
    if (this.farmInterval) return;
    this.farmInterval = setInterval(() => {
      try {
        if (typeof FarmCareSystem !== 'undefined') FarmCareSystem.tick(1);
        if (typeof FarmProcessingSystem !== 'undefined') FarmProcessingSystem.tick(1);
        if (typeof FarmDecorationSystem !== 'undefined') FarmDecorationSystem.tick(1);
        Farm.render();
      } catch (error) { console.error('[Farm] 定时渲染失败:', error); }
    }, 1000);
  },

  closeExpeditionPrep() {
    AudioManager.setScene('farm');
    document.getElementById('expeditionPrepScreen').classList.add('hidden');
    document.getElementById('farmScreen').classList.remove('hidden');
    GameState.screen = 'farm';
    Farm.render();
    this._startFarmTimer();
  },

  startExpedition() {
    const map = CONFIG.maps.find(m => m.id === GameState.selectedMap);
    if (GameState.gold < map.entryFee) {
      showToast('金币不足，无法支付入场费', 'warning');
      return;
    }
    GameState.gold -= map.entryFee;
    // v1.4 校验带入武器（至少1把）
    const uids = GameState.loadoutWeaponUids || [];
    const validUids = uids.filter(uid => LoadoutSystem.getWeaponInstance(uid));
    if (validUids.length === 0) {
      showToast('请至少选择一把带入的武器（最多2把）！', 'warning');
      GameState.gold += map.entryFee;
      return;
    }
    GameState.loadoutWeaponUids = validUids;
    // v1.6 扣仓库作物（带的种子）
    if (GameState.carriedSeeds) {
      for (const s of GameState.carriedSeeds) {
        // 找到对应作物id
        const cropId = Object.keys(CONFIG.cropToDeploy).find(k => CONFIG.cropToDeploy[k] === s.type);
        if (cropId && GameState.warehouse.crops) {
          GameState.warehouse.crops[cropId] = Math.max(0, (GameState.warehouse.crops[cropId]||0) - s.count);
        }
      }
    }
    SaveSystem.save();
    AudioManager.setScene('expedition');
    clearInterval(this.farmInterval);
    document.getElementById('farmScreen').classList.add('hidden');
    document.getElementById('expeditionPrepScreen').classList.add('hidden');
    document.getElementById('expeditionHUD').classList.remove('hidden');
    GameState.screen = 'expedition';
    // 隐藏星云背景层，避免遮住远征画面（玩家/地形不可见）
    this.hideNebulaFX(true);
    // v0.9.0 作物buff持续时间-1
    if (typeof CropExpansion !== 'undefined') CropExpansion.CropBuffSystem.onExpeditionStart();

    this.expedition = new Expedition(GameState.selectedMap);
    PixiEffects.init();
    GameState.expedition = this.expedition;
    const consumedCards = GameState.selectedBoostCards
      .map(id => GameState.cardInventory.find(card => card.id === id))
      .filter(card => card?.singleUse);
    if (consumedCards.length) {
      const consumedIds = new Set(consumedCards.map(card => card.id));
      GameState.cardInventory = GameState.cardInventory.filter(card => !consumedIds.has(card.id));
      GameState.selectedBoostCards = GameState.selectedBoostCards.filter(id => !consumedIds.has(id));
      showToast(`已消耗 ${consumedCards.length} 张一次性技能卡，本次远征生效`, 'gold');
      SaveSystem.save();
    }
    this.expedition.updateHUD();
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.gameLoop();
  },

  gameLoop() {
    const now = performance.now();
    const frameTime = Math.min((now - this.lastTime) / 1000, 0.25);
    this.lastTime = now;

    if (this.expedition && !this.expedition.gameOver) {
      if (this.expedition.hitStop > 0) {
        this.expedition.hitStop = Math.max(0, this.expedition.hitStop - frameTime);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        this.expedition.render(ctx, 0);
        PixiEffects.render(this.expedition);
        this.animId = requestAnimationFrame(() => this.gameLoop());
        return;
      }
      // Fixed 60 Hz simulation; rendering remains synchronized to the display refresh rate.
      const fixedStep = 1 / 60;
      this.accumulator = Math.min((this.accumulator || 0) + frameTime, fixedStep * 8);
      let steps = 0;
      while (this.accumulator >= fixedStep && steps < 8) {
        this.expedition.update(fixedStep);
        this.accumulator -= fixedStep;
        steps++;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      this.expedition.render(ctx, this.accumulator / fixedStep);
      PixiEffects.render(this.expedition);
    }

    if (GameState.screen === 'expedition') {
      this.animId = requestAnimationFrame(() => this.gameLoop());
    }
  },

  showResult(data) {
    AudioManager.setScene('result');
    document.getElementById('lowHealthVignette').classList.remove('active');
    cancelAnimationFrame(this.animId);
    PixiEffects.clear();
    document.getElementById('expeditionHUD').classList.add('hidden');
    document.getElementById('resultScreen').classList.remove('hidden');

    const card = document.getElementById('resultCard');
    card.className = 'result-card' + (data.success ? '' : ' failed');
    document.getElementById('resultTitle').className = 'result-title ' + (data.success ? 'success' : 'failed');
    document.getElementById('resultTitle').textContent = data.success ? '远征成功！' : '远征失败...';
    document.getElementById('resultSubtitle').textContent = data.success
      ? `你成功从${data.mapName}撤离，战利品已存入仓库`
      : `你在${data.mapName}倒下了，大部分物资丢失`;

    document.getElementById('resultStats').innerHTML = `
      <div class="result-stat"><div class="result-stat-label">用时</div><div class="result-stat-value">${data.timeUsed}秒</div></div>
      <div class="result-stat"><div class="result-stat-label">击杀数</div><div class="result-stat-value">${data.kills}</div></div>
      <div class="result-stat"><div class="result-stat-label">开启宝箱</div><div class="result-stat-value">${data.chests}</div></div>
      <div class="result-stat"><div class="result-stat-label">受到伤害</div><div class="result-stat-value">${data.damageTaken}</div></div>
      <div class="result-stat"><div class="result-stat-label">获得金币</div><div class="result-stat-value" style="color:#ffd700;">+${data.goldEarned}</div></div>
      <div class="result-stat"><div class="result-stat-label">地图</div><div class="result-stat-value">${data.mapName}</div></div>
    `;

    const lootList = document.getElementById('lootList');
    const plantGrowth = Array.isArray(data.plantGrowth) ? data.plantGrowth : [];
    let plantHtml = '';
    if (plantGrowth.length > 0) {
      plantHtml = '<div style="font-size:14px;color:#7dff9a;margin:10px 0 6px;">🌿 植物培育</div>';
      plantGrowth.forEach(p => {
        const sign = p.delta > 0 ? '+' : '';
        const color = p.delta > 0 ? '#7dff9a' : '#ff9a55';
        plantHtml += `<div class="loot-item kept" style="margin-bottom:4px;"><span>${p.icon} ${p.name}</span><span style="color:${color};">${sign}${p.delta} 培育进度</span></div>`;
      });
    }
    lootList.innerHTML = '<div style="font-size:14px;color:#888;margin-bottom:8px;">战利品清单</div>' + plantHtml;
    data.keptItems.forEach(i => {
      lootList.innerHTML += `<div class="loot-item kept"><span>${i.icon} ${i.name} ×${i.amount}</span><span>✓ 保留</span></div>`;
    });
    data.lostItems.forEach(i => {
      lootList.innerHTML += `<div class="loot-item lost"><span>${i.icon} ${i.name} ×${i.amount}</span><span>✗ 丢失</span></div>`;
    });
    if (data.keptItems.length === 0 && data.lostItems.length === 0) {
      lootList.innerHTML += '<div style="color:#666;text-align:center;padding:20px;">本次远征没有获得物资</div>';
    }
  },

  returnToFarm() {
    AudioManager.setScene('farm');
    SaveSystem.save();
    document.getElementById('resultScreen').classList.add('hidden');
    document.getElementById('farmScreen').classList.remove('hidden');
    GameState.screen = 'farm';
    Farm.render();
    Farm.renderMapSelect();
    Farm.renderLoadout();
    Farm.renderDefenseLoadout();
    this._startFarmTimer();
    this.expedition = null;
  },

  // v1.0 成就板
  openAchievements() {
    if (typeof AchievementSystem === 'undefined') return;
    const overlay = document.createElement('div');
    overlay.className = 'overlay modal-overlay';
    overlay.style.cssText = 'background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = '<div style="width:600px;max-height:80vh;overflow-y:auto;background:#1a1f1a;border-radius:12px;border:1px solid #4a6a4a;"><div id="achvContent"></div><div style="padding:12px;text-align:center;"><button class="secondary-btn" onclick="this.closest(\'.overlay\').remove()">关闭</button></div></div>';
    document.body.appendChild(overlay);
    AchievementSystem.renderPanel(overlay.querySelector('#achvContent'));
  },

  // v1.0 武器锻造台
  openBlacksmith() {
    if (typeof LoadoutSystem === 'undefined') return;
    const overlay = document.createElement('div');
    overlay.className = 'overlay modal-overlay';
    overlay.style.cssText = 'background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;';
    let html = '<div style="width:620px;max-height:80vh;overflow-y:auto;background:#1a1f1a;border-radius:12px;border:1px solid #6a4a2a;padding:20px;">';
    html += '<h3 style="color:#ffd700;margin:0 0 8px;">🔨 武器锻造台</h3>';
    html += '<p style="color:#aaa;font-size:12px;margin-bottom:12px;">每把武器独立等级，死亡永久损失。升级单个实例，打造补充新武器。</p>';

    // 现有武器实例列表
    html += '<div style="margin-bottom:12px;"><div style="color:#8ecf9a;font-weight:bold;margin-bottom:6px;">仓库中的武器</div>';
    const insts = GameState.weaponInstances || [];
    if (insts.length === 0) html += '<div style="color:#f66;font-size:12px;">没有武器，打造一把吧！</div>';
    insts.forEach(inst => {
      const wpn = CONFIG.weapons.find(w => w.id === inst.weaponId);
      if (!wpn) return;
      const stats = LoadoutSystem.getInstanceStats(inst.uid);
      const cost = LoadoutSystem.getUpgradeCost(inst.uid);
      html += `<div style="padding:8px;margin:6px 0;background:rgba(0,0,0,0.3);border-radius:8px;display:flex;justify-content:space-between;align-items:center;">
        <div style="display:flex;align-items:center;gap:10px;"><img src="${wpn.img}" style="width:40px;height:40px;object-fit:contain;border-radius:4px;" onerror="this.style.display='none'">
        <div><span style="color:#e6bd54;font-weight:bold;">${wpn.name}</span>
        <span style="color:${inst.level>=10?'#ffd700':'#7fff7f'};"> Lv.${inst.level}</span>
        <span style="color:#888;font-size:11px;"> 伤害${stats?stats.damage:wpn.damage}</span>
        <span style="color:#555;font-size:10px;margin-left:8px;">${inst.uid}</span></div></div>`;
      if (cost) {
        const matStr = Object.entries(cost.materials).map(([m,n]) => {
          const mat = CONFIG.materials[m];
          const have = (GameState.warehouse.materials && GameState.warehouse.materials[m]) || 0;
          return `${mat?mat.name:m} ${have}/${n}`;
        }).join(' · ');
        html += `<button class="secondary-btn" style="font-size:11px;" onclick="LoadoutSystem.upgradeWeapon('${inst.uid}');Game.openBlacksmith()">升级 (${cost.gold}金 · ${matStr})</button>`;
      } else {
        html += '<span style="color:#ffd700;font-size:11px;">已满级</span>';
      }
      html += '</div>';
    });
    html += '</div>';

    // 打造新武器
    html += '<div style="margin-top:12px;"><div style="color:#e6a; font-weight:bold;margin-bottom:6px;">打造新武器</div>';
    CONFIG.weapons.forEach(w => {
      const owned = !w.blueprint || (GameState.blueprints && GameState.blueprints.includes(w.id));
      if (!owned) return;
      const count = LoadoutSystem.getWeaponCount(w.id);
      html += `<div style="padding:6px;margin:4px 0;display:flex;justify-content:space-between;align-items:center;">
        <span style="display:flex;align-items:center;gap:8px;"><img src="${w.img}" style="width:32px;height:32px;object-fit:contain;border-radius:4px;" onerror="this.style.display='none'"> ${w.name} <span style="color:#888;font-size:11px;">(现有×${count})</span></span>
        <button class="secondary-btn" style="font-size:11px;" onclick="LoadoutSystem.craftWeapon('${w.id}');Game.openBlacksmith()">打造</button>
      </div>`;
    });
    html += '</div>';

    html += '<div style="padding:12px;text-align:center;"><button class="secondary-btn" onclick="this.closest(\'.overlay\').remove()">关闭</button></div></div>';
    overlay.innerHTML = html;
    document.body.appendChild(overlay);
  },

  // v1.0 安全箱
  openSafeBox() {
    if (typeof LoadoutSystem === 'undefined') return;
    const overlay = document.createElement('div');
    overlay.className = 'overlay modal-overlay';
    overlay.style.cssText = 'background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;';
    const slots = LoadoutSystem.getSafeCapacity();
    const cost = LoadoutSystem.upgradeSafeCost();
    let html = '<div style="width:420px;background:#1a1f1a;border-radius:12px;border:1px solid #4a6a8a;padding:20px;">';
    html += '<h3 style="color:#7ec8ff;margin:0 0 12px;">🔐 安全箱</h3>';
    html += `<p style="color:#aaa;font-size:13px;">安全箱内的物品在远征失败时<b style="color:#7fff7f;">必定保留</b>。<br>当前：${slots}格 | 背包：16格（金币50个占1格）</p>`;
    html += '<div style="margin:12px 0;padding:10px;background:rgba(0,0,0,0.3);border-radius:8px;">';
    if (GameState.safeBox && GameState.safeBox.length) {
      GameState.safeBox.forEach((item,i) => {
        html += `<div style="padding:4px;">${item.icon||'📦'} ${item.name} ×${item.amount||1}</div>`;
      });
    } else {
      html += '<p style="color:#666;font-size:12px;">安全箱为空。远征中按拾取顺序前'+slots+'个物品视为安全箱物品。</p>';
    }
    html += '</div>';
    if (cost) {
      html += `<button class="secondary-btn" onclick="LoadoutSystem.upgradeSafe();Game.openSafeBox();location.reload()">升级到${slots+1}格（${cost}金币）</button>`;
    } else {
      html += '<p style="color:#ffd700;">安全箱已满级（3格）</p>';
    }
    html += '<div style="margin-top:12px;"><button class="secondary-btn" onclick="this.closest(\'.overlay\').remove()">关闭</button></div></div>';
    overlay.innerHTML = html;
    document.body.appendChild(overlay);
  }
};

// ==================== 初始化 ====================
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// 初始渲染菜单背景
function renderMenuBg() {
  ctx.fillStyle = '#0f0f1a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // 装饰性粒子
  for (let i = 0; i < 30; i++) {
    ctx.fillStyle = `rgba(127,255,127,${Math.random() * 0.3})`;
    ctx.beginPath();
    ctx.arc(Math.random() * canvas.width, Math.random() * canvas.height, Math.random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
}
renderMenuBg();

console.log('农庄牌：荒野远征 v1.9 已加载');
console.log('Ruleset ID:', CONFIG.ruleset_id);
