const Game = {
  expedition: null,
  animId: null,

  startGame() {
    AudioManager.start('farm');
    document.getElementById('mainMenu').classList.add('hidden');
    document.getElementById('farmScreen').classList.remove('hidden');
    GameState.screen = 'farm';
    SaveSystem.load();
    Farm.init();
    Farm.render();
    if (GameState.lastDailyClaim !== RewardSystem.dateKey()) {
      setTimeout(() => showToast('家园补给站有今日奖励可以领取', 'gold'), 450);
    }
    // 农场生长定时器
    this.farmInterval = setInterval(() => Farm.render(), 1000);
  },

  backToMenu() {
    AudioManager.setScene('menu');
    SaveSystem.save();
    clearInterval(this.farmInterval);
    document.getElementById('farmScreen').classList.add('hidden');
    document.getElementById('expeditionPrepScreen').classList.add('hidden');
    document.getElementById('mainMenu').classList.remove('hidden');
    GameState.screen = 'menu';
  },

  showHelp() {
    AudioManager.start('menu');
    showToast('WASD移动，左键攻击/交互，右键拾取，1-4技能', 'success');
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
    document.getElementById('farmScreen').classList.add('hidden');
    document.getElementById('expeditionPrepScreen').classList.remove('hidden');
    GameState.screen = 'prep';
    Farm.renderMapSelect();
    Farm.renderLoadout();
    Farm.renderSkillPreview();
    CardSystem.renderBoostSelection();
  },

  closeExpeditionPrep() {
    AudioManager.setScene('farm');
    document.getElementById('expeditionPrepScreen').classList.add('hidden');
    document.getElementById('farmScreen').classList.remove('hidden');
    GameState.screen = 'farm';
    Farm.render();
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
    lootList.innerHTML = '<div style="font-size:14px;color:#888;margin-bottom:8px;">战利品清单</div>';
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

console.log('农庄牌：荒野远征 v1.5 已加载');
console.log('Ruleset ID:', CONFIG.ruleset_id);
