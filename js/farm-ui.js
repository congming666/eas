/* 农场弹窗 UI（加工工坊/作物图鉴/装饰商店）+ Farm.render 天气季节扩展
 * 从 index.html 内联脚本抽离；必须在 farm.js / farm-expansion.js / game.js 之后加载。 */
  const FarmUI = {
    openProcessing(){ document.getElementById('processingModal').classList.remove('hidden'); this.renderProcessing(); },
    openCollection(){ document.getElementById('collectionModal').classList.remove('hidden'); this.renderCollection(); },
    openDecoration(){ document.getElementById('decorationModal').classList.remove('hidden'); this.renderDecoration(); },
    closeModal(id){ document.getElementById(id).classList.add('hidden'); },

    renderProcessing(){
      document.getElementById('processingLevel').textContent = 'Lv.' + GameState.workshopLevel;
      document.getElementById('workshopUpgradeCost').textContent = GameState.workshopLevel * 100;
      // 队列
      const q = document.getElementById('processingQueue');
      if (GameState.processingQueue.length === 0) q.textContent = '加工队列：空闲';
      else q.innerHTML = '加工队列：' + GameState.processingQueue.map(j => {
        const r = FarmRecipes.find(x => x.id === j.recipeId);
        return r ? `${r.icon}${r.name} ${j.remaining.toFixed(0)}s` : '';
      }).join(' · ');
      // 配方
      const list = document.getElementById('recipeList');
      list.innerHTML = '';
      FarmRecipes.forEach(r => {
        const locked = r.workshopLevel > GameState.workshopLevel;
        const have = Warehouse.getCount(r.inputCrop);
        const can = !locked && have >= r.inputQty;
        const row = document.createElement('div');
        row.className = 'recipe-row' + (locked ? ' locked' : '');
        row.innerHTML = `<div class="recipe-info">${r.icon} ${r.name} — ${r.inputQty} ${r.inputCrop} → ${r.outputQty} ${r.outputName} (${r.time}s) ${locked?'🔒需Lv.'+r.workshopLevel:''} <span style="color:#888;">[库存${have}]</span></div>`;
        if (!locked) {
          const btn = document.createElement('button');
          btn.className = 'recipe-btn';
          btn.textContent = can ? '加工' : '原料不足';
          btn.disabled = !can;
          btn.style.opacity = can ? 1 : 0.5;
          btn.onclick = () => { FarmProcessingSystem.startProcessing(r.id); this.renderProcessing(); };
          row.appendChild(btn);
        }
        list.appendChild(row);
      });
    },

    renderCollection(){
      const total = CONFIG.crops.length;
      const got = Object.keys(GameState.cropCollection).length;
      const bonus = ((FarmCollectionSystem.collectionBonus() - 1) * 100).toFixed(0);
      document.getElementById('collectionProgress').textContent = `收集进度：${got}/${total}  ·  全局生长 +${bonus}%`;
      const grid = document.getElementById('collectionGrid');
      grid.innerHTML = '';
      CONFIG.crops.forEach(c => {
        const found = GameState.cropCollection[c.id];
        const card = document.createElement('div');
        card.className = 'collection-card' + (found ? '' : ' locked');
        if (found) {
          const qColor = FarmCollectionSystem.qualityColor(found);
          card.innerHTML = `<div style="font-size:16px;color:${qColor}">${c.icon} ${c.name}</div><div style="color:${qColor};margin-top:2px;">品质：${FarmCollectionSystem.qualityName(found)}</div><div style="color:#888;margin-top:2px;font-size:11px;">${FarmTraitSystem.traitDesc(c.trait)}</div>`;
        } else {
          card.innerHTML = `<div style="font-size:16px;">❓ ???</div><div style="color:#666;margin-top:2px;">未发现</div>`;
        }
        grid.appendChild(card);
      });
    },

    renderDecoration(){
      const bonus = ((FarmDecorationSystem.beautyGoldBonus() - 1) * 100).toFixed(0);
      document.getElementById('decorationBeauty').textContent = `✨ 当前美观度：${GameState.farmBeauty}  ·  金币加成 +${bonus}%`;
      const grid = document.getElementById('decorationGrid');
      grid.innerHTML = '';
      DecoShopItems.forEach(d => {
        const card = document.createElement('div');
        card.className = 'deco-card';
        card.innerHTML = `<div style="font-size:20px;">${d.icon}</div><div style="font-weight:600;margin:2px 0;">${d.name}</div><div style="color:#888;font-size:11px;">${d.desc}</div><button onclick="FarmDecorationSystem.buyDecoration('${d.id}');FarmUI.renderDecoration();">购买 (${d.cost}金)</button>`;
        grid.appendChild(card);
      });
    }
  };

  // 扩展 Farm.render 更新天气/季节/美观/访客显示
  const _origFarmRender = Farm.render.bind(Farm);
  Farm.render = function() {
    _origFarmRender();
    if (typeof FarmCareSystem !== 'undefined') {
      const wEl = document.getElementById('weatherText');
      if (wEl) wEl.textContent = FarmCareSystem.weatherName(GameState.weather);
      const wIcon = document.querySelector('#weatherDisplay .resource-icon');
      if (wIcon) wIcon.textContent = FarmCareSystem.weatherIcon(GameState.weather);
      const sEl = document.getElementById('seasonText');
      if (sEl) sEl.textContent = FarmCareSystem.seasonName(GameState.season) + ' D' + GameState.seasonDay;
      const sIcon = document.querySelector('#seasonDisplay .resource-icon');
      if (sIcon) sIcon.textContent = FarmCareSystem.seasonIcon(GameState.season);
    }
    const bEl = document.getElementById('beautyText');
    if (bEl) bEl.textContent = GameState.farmBeauty || 0;
    const ws = document.getElementById('workshopLevelState');
    if (ws) ws.textContent = 'Lv.' + (GameState.workshopLevel || 1) + ' · 作物加工';
    const vf = document.getElementById('visitorFacility');
    if (vf) {
      if (GameState.visitorState === 'visiting') {
        vf.style.display = '';
        const vn = document.getElementById('visitorName');
        if (vn) vn.textContent = GameState.visitorName || '访客';
      } else vf.style.display = 'none';
    }
  };
  
