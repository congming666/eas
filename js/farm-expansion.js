// ================= v2.0 农场大更新：作物特性 / 照料天气 / 加工产业链 / 收集变异 / 装饰访客 =================
(function () {
  'use strict';

  // ========== 1. 作物特性系统 ==========
  const FarmTraitSystem = {
    growSpeedMultiplier(idx) {
      const plot = GameState.farmPlots[idx];
      if (!plot.crop) return 0;
      let mul = 1;
      if (plot.moisture < 30) mul *= 0.5;
      else if (plot.moisture < 60) mul *= 0.8;
      if (plot.fertilized) mul *= 1.2;
      if (GameState.weather === 'rain') mul *= 1.15;
      else if (GameState.weather === 'fog') mul *= 0.85;
      else if (GameState.weather === 'storm') mul *= 0.7;
      if (GameState.season === 'winter' && plot.crop.trait !== 'hardy') mul *= 0.75;
      if (GameState.season === 'summer' && plot.crop.id === 'watermelon') mul *= 1.2;
      if (this._hasAdjacentMatureSunflower(idx)) mul *= 1.15;
      if (plot.crop.trait === 'monoculture' && this._adjacentCropCount(idx, 'wheat') >= 2) mul *= 1.2;
      if (plot.crop.trait === 'hardy' && GameState.season === 'winter') mul /= 0.75;
      return mul;
    },
    harvestYield(idx) {
      const plot = GameState.farmPlots[idx];
      if (!plot.crop) return 1;
      let base = 1;
      if (plot.quality === 'fine') base += 1;
      else if (plot.quality === 'rare') base += 2;
      else if (plot.quality === 'legendary') base += 4;
      if (plot.crop.trait === 'monoculture' && this._adjacentCropCount(idx, 'wheat') >= 2) base = Math.ceil(base * 1.2);
      if (plot.crop.trait === 'giant') base += 1;
      return Math.max(1, base);
    },
    shouldRemainAfterHarvest(idx) {
      const plot = GameState.farmPlots[idx];
      if (!plot.crop) return false;
      return plot.crop.trait === 'reharvest' && plot.harvestCount < 3;
    },
    shouldSpawnBeast(idx) {
      const plot = GameState.farmPlots[idx];
      if (!plot.crop || plot.crop.trait !== 'beast' || !plot.ready) return false;
      return Math.random() < 0.15;
    },
    _hasAdjacentMatureSunflower(idx) {
      const row = Math.floor(idx / 6), col = idx % 6;
      const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
      for (const [dr,dc] of dirs) {
        const nr=row+dr, nc=col+dc;
        if (nr<0||nr>=6||nc<0||nc>=6) continue;
        const nidx = nr*6+nc;
        if (nidx >= GameState.farmPlots.length) continue;
        const p = GameState.farmPlots[nidx];
        if (p.crop && p.crop.id === 'sunflower' && p.ready) return true;
      }
      return false;
    },
    _adjacentCropCount(idx, cropId) {
      let count = 0;
      const row = Math.floor(idx / 6), col = idx % 6;
      const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
      for (const [dr,dc] of dirs) {
        const nr=row+dr, nc=col+dc;
        if (nr<0||nr>=6||nc<0||nc>=6) continue;
        const nidx = nr*6+nc;
        if (nidx >= GameState.farmPlots.length) continue;
        const p = GameState.farmPlots[nidx];
        if (p.crop && p.crop.id === cropId) count++;
      }
      return count;
    },
    traitDesc(trait) {
      const map = {
        monoculture: '连作：相邻≥2小麦时产量+20%',
        aura: '光环：成熟后周围作物生长+15%',
        giant: '大型：生长慢但产量+1',
        reharvest: '反复：可收获3次后枯萎',
        hardy: '耐寒：冬季不受减速',
        mutate: '变异：收获时有概率获得稀有变异',
        beast: '招兽：成熟后可能吸引野兽偷食',
        carve: '雕刻：可雕刻成南瓜灯装饰',
        legendary: '传说：极高稀有度与奖励'
      };
      return map[trait] || '';
    }
  };

  // ========== 2. 照料与天气系统 ==========
  const Weathers = ['sunny','sunny','sunny','rain','rain','fog','storm'];
  const Seasons = ['spring','summer','autumn','winter'];
  const FarmCareSystem = {
    tick(dt) {
      GameState.weatherTimer -= dt;
      if (GameState.weatherTimer <= 0) {
        GameState.weather = Weathers[Math.floor(Math.random()*Weathers.length)];
        GameState.weatherTimer = 60 + Math.random()*120;
        showToast('天气变化：' + this.weatherName(GameState.weather), 'info');
      }
      GameState.seasonDay++;
      if (GameState.seasonDay > 7) {
        GameState.seasonDay = 1;
        const si = Seasons.indexOf(GameState.season);
        GameState.season = Seasons[(si+1)%4];
        showToast('季节更替：进入' + this.seasonName(GameState.season), 'info');
      }
      for (let i = 0; i < GameState.farmPlots.length; i++) {
        const p = GameState.farmPlots[i];
        if (!p.crop) continue;
        if (GameState.weather === 'rain') p.moisture = Math.min(100, p.moisture + dt*5);
        else p.moisture = Math.max(0, p.moisture - dt*0.15);
        if (p.moisture < 20 && !p.status && Math.random() < 0.005) {
          p.status = 'drought';
          showToast('一块农田干旱了，点击照料', 'warning');
        }
      }
      GameState.waterCooldown = Math.max(0, GameState.waterCooldown - dt);
      for (let i = 0; i < GameState.farmPlots.length; i++) {
        if (FarmTraitSystem.shouldSpawnBeast(i)) {
          GameState.farmPlots[i].status = 'beast';
          showToast('野兽正在偷食玉米！点击驱赶', 'warning');
        }
      }
    },
    waterPlot(idx) {
      if (GameState.waterCooldown > 0) { showToast('浇水冷却中，稍等片刻', 'warning'); return; }
      const p = GameState.farmPlots[idx];
      if (!p.crop) { showToast('这块地没有作物', 'warning'); return; }
      p.moisture = 100;
      if (p.status === 'drought') p.status = null;
      GameState.waterCooldown = 3;
      showToast('浇水完成，作物恢复活力', 'success');
      SaveSystem.save();
    },
    fertilizePlot(idx, premium) {
      const p = GameState.farmPlots[idx];
      if (!p.crop) { showToast('这块地没有作物', 'warning'); return; }
      if (p.fertilized) { showToast('已经施过肥了', 'warning'); return; }
      if (premium) {
        if (GameState.gold < 20) { showToast('高级肥需要20金币', 'warning'); return; }
        GameState.gold -= 20;
        if (Math.random() < 0.2) { p.status = 'burn'; showToast('施肥过量，作物烧苗了！点击照料', 'warning'); }
        else { p.fertilized = true; p.plantedAt -= p.crop.growTime * 0.3 * 1000; showToast('高级肥生效，生长大幅加速', 'success'); }
      } else {
        if (GameState.gold < 8) { showToast('普通肥需要8金币', 'warning'); return; }
        GameState.gold -= 8;
        p.fertilized = true;
        p.plantedAt -= p.crop.growTime * 0.15 * 1000;
        showToast('施肥完成，生长加速', 'success');
      }
      SaveSystem.save();
    },
    chaseBeast(idx) {
      const p = GameState.farmPlots[idx];
      if (p.status !== 'beast') return;
      p.status = null;
      if (Math.random() < 0.4) { Warehouse.addItem('materials', 1); showToast('驱赶野兽成功，捡到材料 ×1', 'success'); }
      else showToast('驱赶野兽成功', 'success');
      SaveSystem.save();
    },
    weatherName(w) { return {sunny:'晴朗',rain:'小雨',storm:'雷暴',fog:'浓雾'}[w] || w; },
    weatherIcon(w) { return {sunny:'☀️',rain:'🌧️',storm:'⛈️',fog:'🌫️'}[w] || '🌤️'; },
    seasonName(s) { return {spring:'春季',summer:'夏季',autumn:'秋季',winter:'冬季'}[s] || s; },
    seasonIcon(s) { return {spring:'🌸',summer:'☀️',autumn:'🍂',winter:'❄️'}[s] || '🌍'; }
  };

  // ========== 3. 加工与产业链系统 ==========
  const Recipes = [
    { id:'flour', name:'面粉', icon:'🌾', inputCrop:'wheat', inputQty:3, outputId:'flour', outputName:'面粉', outputIcon:'🥛', outputQty:1, time:20, workshopLevel:1, desc:'小麦→面粉，可做面包' },
    { id:'bread', name:'面包', icon:'🍞', inputCrop:'flour', inputQty:2, outputId:'bread', outputName:'面包', outputIcon:'🍞', outputQty:1, time:30, workshopLevel:2, desc:'面粉→面包，远征回血+80' },
    { id:'oil', name:'植物油', icon:'🌻', inputCrop:'sunflower', inputQty:3, outputId:'oil', outputName:'植物油', outputIcon:'🫒', outputQty:1, time:25, workshopLevel:1, desc:'向日葵→植物油' },
    { id:'torch', name:'火把', icon:'🔥', inputCrop:'oil', inputQty:2, outputId:'torch', outputName:'火把', outputIcon:'🔥', outputQty:1, time:25, workshopLevel:2, desc:'植物油→火把，远征迷雾视野+' },
    { id:'juice', name:'西瓜汁', icon:'🧃', inputCrop:'watermelon', inputQty:2, outputId:'juice', outputName:'西瓜汁', outputIcon:'🧃', outputQty:1, time:15, workshopLevel:1, desc:'西瓜→果汁，远征能量上限+' },
    { id:'feed', name:'饲料', icon:'🌽', inputCrop:'corn', inputQty:3, outputId:'feed', outputName:'饲料', outputIcon:'🥣', outputQty:1, time:20, workshopLevel:1, desc:'玉米→饲料，养鸡下蛋' },
    { id:'egg', name:'鸡蛋', icon:'🥚', inputCrop:'feed', inputQty:2, outputId:'egg', outputName:'鸡蛋', outputIcon:'🥚', outputQty:2, time:40, workshopLevel:2, desc:'饲料→鸡蛋，远征buff食物' },
    { id:'pumpkin_lantern', name:'南瓜灯', icon:'🎃', inputCrop:'pumpkin', inputQty:1, outputId:'pumpkin_lantern', outputName:'南瓜灯', outputIcon:'🎃', outputQty:1, time:15, workshopLevel:1, desc:'南瓜→南瓜灯装饰，美观+5' },
    { id:'insecticide', name:'驱虫剂', icon:'🧪', inputCrop:'cabbage', inputQty:2, outputId:'insecticide', outputName:'驱虫剂', outputIcon:'🧪', outputQty:1, time:18, workshopLevel:1, desc:'卷心菜→驱虫剂，治病虫害' }
  ];
  const FarmProcessingSystem = {
    getRecipe(id) { return Recipes.find(r => r.id === id); },
    startProcessing(recipeId, qty=1) {
      const recipe = this.getRecipe(recipeId);
      if (!recipe) return false;
      if (recipe.workshopLevel > GameState.workshopLevel) { showToast('需要工坊等级 ' + recipe.workshopLevel, 'warning'); return false; }
      const have = Warehouse.getCount(recipe.inputCrop);
      if (have < recipe.inputQty * qty) { showToast('原料不足：需要 ' + (recipe.inputQty*qty) + ' ' + recipe.inputCrop, 'warning'); return false; }
      Warehouse.removeItem(recipe.inputCrop, recipe.inputQty * qty);
      GameState.processingQueue.push({ recipeId, remaining: recipe.time, total: recipe.time, qty });
      showToast('开始加工：' + recipe.name + ' ×' + qty, 'success');
      SaveSystem.save();
      return true;
    },
    tick(dt) {
      for (let i = GameState.processingQueue.length-1; i >= 0; i--) {
        const job = GameState.processingQueue[i];
        job.remaining -= dt;
        if (job.remaining <= 0) {
          const recipe = this.getRecipe(job.recipeId);
          if (recipe) {
            Warehouse.addItem(recipe.outputId, recipe.outputQty * job.qty);
            if (recipe.outputId === 'pumpkin_lantern') GameState.farmBeauty += 5;
            showToast('加工完成：' + recipe.outputName + ' ×' + (recipe.outputQty*job.qty), 'gold');
          }
          GameState.processingQueue.splice(i, 1);
          SaveSystem.save();
        }
      }
    },
    upgradeWorkshop() {
      const cost = GameState.workshopLevel * 100;
      if (GameState.gold < cost) { showToast('升级工坊需要 ' + cost + ' 金币', 'warning'); return false; }
      if (GameState.workshopLevel >= 3) { showToast('工坊已满级', 'warning'); return false; }
      GameState.gold -= cost;
      GameState.workshopLevel++;
      showToast('工坊升级到 Lv.' + GameState.workshopLevel, 'gold');
      SaveSystem.save();
      return true;
    }
  };

  // ========== 4. 收集与变异系统 ==========
  const Qualities = ['common','fine','rare','legendary'];
  const QualityWeight = [60,25,12,3];
  const FarmCollectionSystem = {
    rollQuality(crop) {
      let total = 0; QualityWeight.forEach(w => total += w);
      const roll = Math.random() * total;
      let acc = 0;
      for (let i = 0; i < Qualities.length; i++) { acc += QualityWeight[i]; if (roll < acc) return Qualities[i]; }
      return 'common';
    },
    recordCollection(cropId, quality) {
      if (!GameState.cropCollection[cropId]) GameState.cropCollection[cropId] = quality;
      else {
        const oldQ = Qualities.indexOf(GameState.cropCollection[cropId]);
        const newQ = Qualities.indexOf(quality);
        if (newQ > oldQ) GameState.cropCollection[cropId] = quality;
      }
    },
    collectionBonus() {
      let fine=0, rare=0, leg=0;
      Object.values(GameState.cropCollection).forEach(q => {
        if (q==='fine') fine++; else if (q==='rare') rare++; else if (q==='legendary') leg++;
      });
      return 1 + fine*0.01 + rare*0.025 + leg*0.1;
    },
    tryMutate(idx) {
      const p = GameState.farmPlots[idx];
      if (!p.crop || p.crop.trait !== 'mutate') return false;
      let chance = 0.08;
      if (GameState.weather === 'fog') chance += 0.1;
      if (p.fertilized) chance += 0.05;
      if (Math.random() < chance) { p.quality = 'rare'; showToast('✨ 胡萝卜变异了！获得稀有品质', 'gold'); return true; }
      return false;
    },
    qualityName(q) { return {fine:'优质',rare:'稀有',legendary:'传说'}[q] || '普通'; },
    qualityColor(q) { return {fine:'#7fff7f',rare:'#7be5c4',legendary:'#ffd700'}[q] || '#ffffff'; }
  };

  // ========== 5. 装饰与访客系统 ==========
  const DecoShopItems = [
    { id:'scarecrow', name:'稻草人', icon:'🎃', beauty:3, cost:50, desc:'驱赶野兽，美观+3' },
    { id:'fence', name:'木栅栏', icon:'🚧', beauty:1, cost:20, desc:'基础装饰，美观+1' },
    { id:'well', name:'水井', icon:'⛲', beauty:5, cost:120, desc:'浇水冷却减半，美观+5' },
    { id:'statue', name:'丰收雕像', icon:'🗿', beauty:8, cost:300, desc:'全局生长+5%，美观+8' },
    { id:'flowerbed', name:'花坛', icon:'🌷', beauty:2, cost:30, desc:'美观+2' },
    { id:'windmill', name:'风车', icon:'🌬️', beauty:6, cost:200, desc:'美观+6' }
  ];
  const VisitorNames = ['旅行商人','农夫老王','园艺大师','远征猎人','神秘旅人'];
  const FarmDecorationSystem = {
    tick(dt) {
      GameState.visitorTimer -= dt;
      if (GameState.visitorTimer <= 0 && GameState.visitorState === 'none') {
        const chance = 0.3 + GameState.farmBeauty * 0.01;
        if (Math.random() < chance) {
          GameState.visitorState = 'visiting';
          GameState.visitorName = VisitorNames[Math.floor(Math.random()*VisitorNames.length)];
          GameState.visitorTimer = 30 + Math.random()*30;
          showToast(GameState.visitorName + '来访了！点击访客互动', 'info');
        } else GameState.visitorTimer = 60 + Math.random()*60;
      } else if (GameState.visitorState === 'visiting' && GameState.visitorTimer <= 0) {
        GameState.visitorState = 'none';
        GameState.visitorTimer = 60 + Math.random()*60;
      }
    },
    buyDecoration(id) {
      const item = DecoShopItems.find(d => d.id === id);
      if (!item) return false;
      if (GameState.gold < item.cost) { showToast('金币不足', 'warning'); return false; }
      GameState.gold -= item.cost;
      GameState.decorations.push({ id:item.id, name:item.name, icon:item.icon, beauty:item.beauty, x:Math.floor(Math.random()*6), y:Math.floor(Math.random()*6) });
      GameState.farmBeauty += item.beauty;
      showToast('购买了' + item.name + '，美观+' + item.beauty, 'success');
      SaveSystem.save();
      return true;
    },
    interactVisitor() {
      if (GameState.visitorState !== 'visiting') return;
      const reward = 20 + GameState.farmBeauty * 2;
      GameState.gold += reward;
      if (Math.random() < 0.3) { Warehouse.addItem('seeds', 2); showToast(GameState.visitorName + '：' + reward + '金币 + 种子×2，再见！', 'gold'); }
      else showToast(GameState.visitorName + '留下了 ' + reward + ' 金币', 'gold');
      GameState.visitorState = 'none';
      GameState.visitorTimer = 60 + Math.random()*60;
      SaveSystem.save();
    },
    beautyGoldBonus() { return 1 + GameState.farmBeauty * 0.005; }
  };

  // 暴露到全局
  window.FarmTraitSystem = FarmTraitSystem;
  window.FarmCareSystem = FarmCareSystem;
  window.FarmProcessingSystem = FarmProcessingSystem;
  window.FarmCollectionSystem = FarmCollectionSystem;
  window.FarmDecorationSystem = FarmDecorationSystem;
  window.FarmRecipes = Recipes;
  window.DecoShopItems = DecoShopItems;
})();
