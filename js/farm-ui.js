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
      const RES = (id) => (CONFIG.resources && CONFIG.resources[id]) || (CONFIG.warehouseItems && CONFIG.warehouseItems[id]) || { name: id, icon: "•" };
      const USAGE = {
        bread:['远征','战斗中回血 80',1], medkit:['远征','战斗中回血 200',1], ketchup:['远征','战斗中回血 150',1],
        juice:['远征','本局能量上限 +40 并回满',1], egg:['远征','120 秒攻击 +15%',1], mint_tea:['远征','60 秒移速 +15%',1],
        ginseng_soup:['远征','回满血，60 秒攻击 +20%',1], torch:['远征','每支照明约 60 秒（难度越高越短），无火把视野极小',1],
        poison_bomb:['远征','投掷 AOE 60 伤并减速 3 秒',1], insecticide:['远征','驱虫：6 秒内身边怪物丢失目标',1],
        flour:['再加工','制作面包的原料',0], oil:['再加工','制作火把的原料',0], feed:['再加工','制作鸡蛋的原料',0],
        compost:['农场','修行台角色升级材料',0], refined_iron:['锻造','高级武器锻造/升级材料',0],
        pumpkin_lantern:['装饰','加工即得，美观度 +5',0]
      };
      FarmRecipes.forEach(r => {
        const locked = r.workshopLevel > GameState.workshopLevel;
        let ingText = "", can = !locked;
        if (r.inputs) {
          ingText = Object.entries(r.inputs).map(([k,n]) => {
            const have = window.ResourceSystem ? ResourceSystem.count(k) : Warehouse.getCount(k);
            if (have < n) can = false;
            const rd = RES(k); return (rd.icon||"") + rd.name + "×" + n + "(有" + have + ")";
          }).join(' + ');
        } else {
          const have = Warehouse.getCount(r.inputCrop);
          if (have < r.inputQty) can = false;
          const cd = RES(r.inputCrop);
          ingText = (cd.icon||"") + cd.name + "×" + r.inputQty + "(有" + have + ")";
        }
        const u = USAGE[r.outputId] || ['其它','加工产物',0];
        const tagColor = u[0]==='远征' ? '#7fce8a' : (u[0]==='再加工' ? '#c9b98a' : '#8ab4ce');
        const row = document.createElement('div');
        row.className = 'recipe-row' + (locked ? ' locked' : '');
        row.innerHTML = '<div class="recipe-info">'
          + '<div style="font-weight:600">' + (r.outputIcon||r.icon) + ' ' + r.outputName
          + ' <span style="font-size:10px;color:' + tagColor + ';border:1px solid ' + tagColor + ';border-radius:6px;padding:0 5px;margin-left:4px;">' + u[0] + '</span></div>'
          + '<div style="color:#b9c0aa;font-size:11px;margin-top:2px;">' + ingText + ' → ' + (r.outputIcon||'') + r.outputName + '×' + r.outputQty + ' · 耗时' + r.time + 's ' + (locked?'🔒需工坊Lv.'+r.workshopLevel:'') + '</div>'
          + '<div style="color:#8fa07e;font-size:11px;">用途：' + u[1] + '</div></div>';
        if (!locked) {
          const btn = document.createElement('button');
          btn.className = 'recipe-btn';
          btn.textContent = can ? '加工' : '原料不足';
          btn.disabled = !can;
          btn.style.opacity = can ? 1 : 0.5;
          btn.onclick = () => { FarmProcessingSystem.startProcessing(r.id); this.renderProcessing(); };
          row.appendChild(btn);
          if (u[2]) {
            const go = document.createElement('button');
            go.className = 'recipe-btn'; go.textContent = '去准备大厅';
            go.style.marginLeft = '6px'; go.style.background = '#3a5a3a';
            go.onclick = () => { this.closeModal('processingModal'); if (typeof Game !== 'undefined' && Game.openExpeditionPrep) Game.openExpeditionPrep(); };
            row.appendChild(go);
          }
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
      const b = GameState.farmBeauty || 0;
      const tier = FarmDecorationSystem.tier();
      const goldB = ((FarmDecorationSystem.beautyGoldBonus() - 1) * 100).toFixed(1);
      const owned = (GameState.decorations || []).length;
      document.getElementById('decorationBeauty').innerHTML =
        '✨ 当前美观度 <b style="color:#e6bd54">' + b + '</b>（' + tier + ' 档，每 50 点一档）· 已摆放装饰 ' + owned + ' 件<br>'
        + '💰 售价/金币收益 +' + goldB + '%　🐾 访客来访率 ' + Math.round(FarmDecorationSystem.visitorChance() * 100) + '%　访客赏金 ' + FarmDecorationSystem.visitorReward() + ' 金<br>'
        + '🌱 当前档位：作物生长 +' + (Math.min(tier, 5) * 3) + '%（每档 +3%，上限 15%）　⭐ 稀有访客率 ' + Math.round(FarmDecorationSystem.rareVisitorChance() * 100) + '%（赏金翻倍）';
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
  

/* ===================== v5.5 家园指挥台 + 农场天气特效 ===================== */
(function () {
  window.__farmCmdInit = true;

  /* ---------- 一键操作 ---------- */
  Farm.harvestAllRipe = function () {
    let n = 0;
    for (let i = 0; i < GameState.unlockedPlots; i++) {
      const p = GameState.farmPlots[i];
      if (p && p.ready) { try { Farm.harvest(i); n++; } catch (e) {} }
    }
    showToast(n > 0 ? '一键收获 ' + n + ' 块成熟作物' : '当前没有成熟作物', n > 0 ? 'gold' : 'warning');
  };
  Farm.tendAll = function () {
    let n = 0;
    for (let i = 0; i < GameState.unlockedPlots; i++) {
      const p = GameState.farmPlots[i];
      if (p && p.status) { try { Farm.tend(i); n++; } catch (e) {} }
    }
    showToast(n > 0 ? '一键照料 ' + n + ' 块作物（除虫/除草/浇水）' : '作物状态良好，无需照料', n > 0 ? 'success' : 'warning');
  };

  /* ---------- 天气特效覆盖层（DOM/CSS，柔和不闪眼） ---------- */
  const CSS = [
    '#farmWeatherFx{position:absolute;inset:0;pointer-events:none;z-index:5;overflow:hidden;border-radius:inherit;}',
    '.fwx-rain::before,.fwx-storm::before{content:"";position:absolute;inset:-40%;background:repeating-linear-gradient(105deg,rgba(170,195,230,0) 0 6px,rgba(170,195,230,.28) 6px 7px);animation:fwxRain .55s linear infinite;}',
    '.fwx-storm::before{background:repeating-linear-gradient(105deg,rgba(190,205,240,0) 0 4px,rgba(200,215,250,.42) 4px 5px);animation-duration:.38s;}',
    '@keyframes fwxRain{from{transform:translateY(-3%)}to{transform:translateY(3%)}}',
    '.fwx-fog::after{content:"";position:absolute;inset:0;background:radial-gradient(ellipse at 50% 45%,rgba(210,215,220,.12),rgba(190,195,205,.34));animation:fwxFog 9s ease-in-out infinite alternate;}',
    '@keyframes fwxFog{from{opacity:.55}to{opacity:.9}}',
    '.fwx-sun::after{content:"";position:absolute;top:-6%;right:-4%;width:340px;height:340px;border-radius:50%;background:radial-gradient(circle,rgba(255,225,150,.34) 0%,rgba(255,210,120,.16) 32%,rgba(255,210,120,0) 68%);animation:fwxSun 5s ease-in-out infinite alternate;}',
    '@keyframes fwxSun{from{opacity:.6;transform:scale(.97)}to{opacity:1;transform:scale(1.04)}}',
    '#fwxFlash{position:absolute;inset:0;background:#e8eeff;opacity:0;pointer-events:none;}',
    '.fcmd{margin-top:12px;border-radius:12px;border:1px solid #4a5a3a;background:#141a12;box-shadow:0 4px 14px rgba(0,0,0,.35);padding:10px 12px 12px;}',
    '.fcmd h4{margin:0 0 8px;color:#b9d18a;font-size:13px;font-weight:bold;}',
    '.fcmd-mini{display:grid;grid-template-columns:repeat(8,1fr);gap:3px;margin-bottom:8px;}',
    '.fcmd-cell{aspect-ratio:1;border-radius:4px;background:#1b2218;border:1px solid #2f3a26;font-size:9px;display:flex;align-items:center;justify-content:center;}',
    '.fcmd-cell.grow{background:linear-gradient(135deg,#3c5a2e,#466934);}',
    '.fcmd-cell.ready{background:radial-gradient(circle,#ffd76a,#e8a93c);cursor:pointer;animation:fcmdPulse 1.2s ease-in-out infinite;}',
    '.fcmd-cell.bad{background:radial-gradient(circle,#e0715a,#a83f30);cursor:pointer;}',
    '@keyframes fcmdPulse{0%,100%{box-shadow:0 0 0 rgba(255,215,106,0)}50%{box-shadow:0 0 8px rgba(255,215,106,.8)}}',
    '.fcmd-blds{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:6px;margin-bottom:8px;}',
    '.fcmd-b{background:rgba(255,255,255,.05);border:1px solid rgba(185,209,138,.22);border-radius:8px;padding:6px 8px;cursor:pointer;position:relative;font-size:11px;color:#cfe0b0;}',
    '.fcmd-b:hover{background:rgba(185,209,138,.12);}',
    '.fcmd-b .bn{font-weight:bold;font-size:12px;color:#dceab8;}',
    '.fcmd-b .bs{color:#9aa08c;font-size:10px;margin-top:2px;line-height:1.3;}',
    '.fcmd-dot{position:absolute;top:5px;right:6px;width:8px;height:8px;border-radius:50%;background:#ff5252;box-shadow:0 0 6px #ff5252;}',
    '.fcmd-acts{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;}',
    '.fcmd-acts button{flex:1 1 auto;min-width:96px;background:#2e4426;border:1px solid #4d6b3c;color:#dceab8;border-radius:8px;padding:6px 8px;font-size:12px;cursor:pointer;}',
    '.fcmd-acts button:hover{background:#3a5730;}',
    '.fcmd-intel{display:flex;flex-wrap:wrap;gap:6px;}',
    '.fcmd-intel span{background:rgba(255,255,255,.06);border:1px solid rgba(159,216,255,.25);color:#9fd8ff;border-radius:999px;padding:3px 10px;font-size:11px;}'
  ].join('\n');
  function ensureCss(){ if (document.getElementById('fcmdStyle')) return; const st=document.createElement('style'); st.id='fcmdStyle'; st.textContent=CSS; document.head.appendChild(st); }

  function ensureFx() {
    const screen = document.getElementById('farmScreen');
    if (!screen) return null;
    let fx = document.getElementById('farmWeatherFx');
    if (!fx) {
      if (getComputedStyle(screen).position === 'static') screen.style.position = 'relative';
      fx = document.createElement('div'); fx.id = 'farmWeatherFx';
      const flash = document.createElement('div'); flash.id = 'fwxFlash';
      fx.appendChild(flash); screen.appendChild(fx);
    }
    return fx;
  }
  function updateWeatherFx() {
    const fx = ensureFx(); if (!fx) return;
    const w = GameState.weather || 'sunny';
    fx.className = ({ rain: 'fwx-rain', storm: 'fwx-storm', fog: 'fwx-fog', sunny: 'fwx-sun' }[w]) || '';
  }
  // 雷暴随机轻闪光（柔和、短促）
  setInterval(function () {
    const screen = document.getElementById('farmScreen');
    if (!screen || screen.classList.contains('hidden')) return;
    if ((GameState.weather || 'sunny') !== 'storm') return;
    const flash = document.getElementById('fwxFlash'); if (!flash) return;
    flash.style.transition = 'none'; flash.style.opacity = '0.24';
    setTimeout(function () { flash.style.transition = 'opacity .18s'; flash.style.opacity = '0'; }, 110);
  }, 5200);

  /* ---------- 家园指挥台 ---------- */
  function canCultivate() {
    try {
      const CS = window.CharacterSystem; if (!CS) return false;
      const lv = GameState.level; if (lv >= 100) return false;
      const next = lv + 1;
      if ((next % 20 === 0 || next === 100) && !CS.breakthroughMet(next)) return false;
      if ((GameState.cultivation || 0) < CS.expNeeded(lv)) return false;
      if (GameState.gold < CS.goldNeeded(lv)) return false;
      if (window.ResourceSystem) {
        if (ResourceSystem.count('soil') < CS.soilNeeded(lv)) return false;
        if (ResourceSystem.count('water') < CS.waterNeeded(lv)) return false;
        if (ResourceSystem.count('compost') < CS.compostNeeded(lv)) return false;
      }
      return true;
    } catch (e) { return false; }
  }
  function claimableArchive() {
    try { return !!(window.ArchiveSystem && ArchiveSystem.claimable && ArchiveSystem.claimable()); } catch (e) { return false; }
  }
  function mapName() {
    try {
      const id = GameState.selectedMap || 't1_1';
      const m = CONFIG.expedition.maps.find(function (x) { return x.id === id; });
      return m ? ('T' + m.tier + ' · ' + m.name) : '未选择';
    } catch (e) { return '未选择'; }
  }

  function renderCommand() {
    const left = document.querySelector('.farm-left');
    if (!left) return;
    let box = document.getElementById('farmCommandCenter');
    if (!box) {
      ensureCss();
      box = document.createElement('div');
      box.id = 'farmCommandCenter'; box.className = 'fcmd';
      left.appendChild(box);
    }
    const plots = GameState.farmPlots || [];
    const total = GameState.unlockedPlots || plots.length || 48;
    const statusName = { drought: '干旱', pest: '虫害', weeds: '杂草', burn: '烧苗', beast: '野兽' };
    let cells = '';
    for (let i = 0; i < total; i++) {
      const p = plots[i]; let cls = 'empty', tip = '空地', act = '';
      if (p && p.crop) {
        const cname = p.crop.name || '作物';
        if (p.ready) { cls = 'ready'; tip = cname + ' 已成熟，点击收获'; act = 'Farm.harvest(' + i + ')'; }
        else if (p.status) { cls = 'bad'; tip = cname + ' 需要照料（' + (statusName[p.status] || p.status) + '）'; act = 'Farm.tend(' + i + ')'; }
        else { cls = 'grow'; tip = cname + ' 生长中'; }
      }
      cells += '<div class="fcmd-cell ' + cls + '"' + (act ? ' onclick="' + act + '"' : '') + ' title="' + tip + '"></div>';
    }
    const CS = window.CharacterSystem;
    const lv = GameState.level || 1;
    const cultPct = CS && lv < 100 ? Math.min(100, Math.round((GameState.cultivation || 0) / CS.expNeeded(lv) * 100)) : 100;
    const qLen = (GameState.processingQueue || []).length;
    const safeCap = GameState.safeSlots || 1;
    const safeUsed = (GameState.safeBox || []).length;
    const astats = (window.AchievementSystem && AchievementSystem.getStats) ? AchievementSystem.getStats() : {};
    const streak = astats.consecutiveExtracts || (GameState.archive && GameState.archive.stats && GameState.archive.stats.consecutiveExtracts) || 0;
    const totalEx = (GameState.archive && GameState.archive.stats && GameState.archive.stats.totalExtracts) || 0;
    const b = function (icon, name, state, fn, dot) {
      return '<div class="fcmd-b" onclick="' + fn + '">' + (dot ? '<span class="fcmd-dot"></span>' : '') +
        '<div class="bn">' + icon + ' ' + name + '</div><div class="bs">' + state + '</div></div>';
    };
    box.innerHTML =
      '<h4>🏞️ 家园指挥台</h4>' +
      '<div class="fcmd-mini">' + cells + '</div>' +
      '<div class="fcmd-acts">' +
        '<button onclick="Farm.harvestAllRipe()">🌾 一键收成熟</button>' +
        '<button onclick="Farm.tendAll()">🧹 一键除害照料</button>' +
        '<button onclick="FarmUI.openProcessing()">🏭 打开工坊</button>' +
      '</div>' +
      '<div class="fcmd-blds">' +
        b('🧘', '修行台', 'Lv.' + lv + ' · 修为' + cultPct + '%', 'V5.openCultivation()', canCultivate()) +
        b('🏭', '加工工坊', qLen > 0 ? ('加工中 ' + qLen + ' 件') : '空闲', 'FarmUI.openProcessing()', qLen > 0) +
        b('🏡', '育种温室', '稀有/修为作物', 'Greenhouse.open()') +
        b('🔨', '锻造台', '武器锻造/升级', 'Game.openBlacksmith()') +
        b('🔐', '安全箱', safeUsed + '/' + safeCap + ' 格', 'Game.openSafeBox()') +
        b('📜', '远征档案', '突破/战略物资', 'V5.openArchive()', claimableArchive()) +
      '</div>' +
      '<div class="fcmd-intel"><span>🗺️ ' + mapName() + '</span><span>累计撤离 ' + totalEx + '</span><span>连续撤离 ' + streak + '</span><span>✨ 美观度 ' + (GameState.farmBeauty || 0) + '</span></div>';
  }

  /* ---------- 挂钩 Farm.render，刷新指挥台与天气 ---------- */
  const _farmUiRender = Farm.render;
  Farm.render = function () {
    const r = _farmUiRender.apply(this, arguments);
    try { updateWeatherFx(); } catch (e) {}
    try { renderCommand(); } catch (e) {}
    return r;
  };
  setInterval(function () {
    const screen = document.getElementById('farmScreen');
    if (!screen || screen.classList.contains('hidden')) return;
    try { updateWeatherFx(); } catch (e) {}
  }, 2000);
})();
