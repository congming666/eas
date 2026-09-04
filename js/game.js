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
    ['nebulaCanvas', 'nebulaTextFx'].forEach(id => {
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
  },

  _startFarmTimer() {
    if (this.farmInterval) return;
    this.farmInterval = setInterval(() => {
      try { Farm.render(); } catch (error) { console.error('[Farm] 定时渲染失败:', error); }
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
    SaveSystem.save();
    AudioManager.setScene('expedition');
    clearInterval(this.farmInterval);
    document.getElementById('farmScreen').classList.add('hidden');
    document.getElementById('expeditionPrepScreen').classList.add('hidden');
    document.getElementById('expeditionHUD').classList.remove('hidden');
    GameState.screen = 'expedition';

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
