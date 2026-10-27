// ================= v0.9.0 农场渲染扩展（网页版） =================
(function () {
  'use strict';

  // 2026-10-23 作物 3D 阶段立绘：由 tools/crop3d 离线渲染（幼苗→成熟 5 帧），
  // 让每种作物在田里都有独立的 3D 造型与生长过程；图缺失时回退旧 2D 插画。
  // P12 修复（2026-10-27）：① 缓存戳动态跟随 GAME_VERSION，不再写死旧版本导致长期命中历史缓存；
  // ② 图片异步 onload 后立即用 rAF 合并触发一次 Farm.render，冷启动/慢网络/file 协议下
  //   首帧即便先落到旧 2D 兜底，也会在图就绪的同一帧（约一帧内）自动切换为 3D 立绘，
  //   不再只依赖 1s 一次的农场定时器、不再持续停留在旧样子；③ 进入游戏后对当前在田作物后台预热。
  const STAGE3D_SIZE = [30, 38, 46, 56, 66];
  const STAGE3D_VER = (typeof GAME_VERSION !== 'undefined' && GAME_VERSION) ? GAME_VERSION : '5.9.70';
  const STAGE3D_SPRITES = [0, 1, 3, 4]; // 实际会用到的精灵阶段（UI 1..4 → s0/s1/s3/s4）
  const stage3dImgs = {};
  let _redrawQueued = false;

  function scheduleFarmRedraw() {
    if (_redrawQueued) return;
    // 仅在农场屏触发；同一帧内多张图陆续 onload 只合并为一次全量重绘，避免重绘风暴
    try {
      if (typeof GameState !== 'undefined' && GameState && GameState.screen !== 'farm') return;
    } catch (e) { return; }
    _redrawQueued = true;
    const raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
    raf(function () {
      _redrawQueued = false;
      try {
        if (typeof Farm !== 'undefined' && Farm && typeof Farm.render === 'function') Farm.render();
      } catch (e) { /* 忽略：下一帧/1s 定时器仍会兜底重绘 */ }
    });
  }

  function stage3dImg(cropId, stage) {
    const k = cropId + '_s' + stage;
    let im = stage3dImgs[k];
    if (!im) {
      im = new Image();
      im.alt = '';
      im.onload = function () { if (im.naturalWidth > 0) scheduleFarmRedraw(); };
      // onerror 不重绘：naturalWidth 为 0 时渲染侧自然回退旧 2D，且同一 Image 只请求一次，不会反复刷
      im.src = 'assets/crops/stages/' + k + '.png?v=' + STAGE3D_VER;
      stage3dImgs[k] = im;
    }
    return im;
  }

  // 后台预热指定作物（或当前在田作物）会用到的阶段图，只填浏览器缓存、不挂 DOM
  function warmup(cropIds) {
    let ids = cropIds;
    if (!ids) {
      ids = [];
      try {
        if (typeof GameState !== 'undefined' && GameState && GameState.farmPlots) {
          const seen = {};
          GameState.farmPlots.forEach(function (p) {
            if (!p || !p.crop) return;
            const id = (typeof p.crop === 'object') ? p.crop.id : p.crop;
            if (id && !seen[id]) { seen[id] = 1; ids.push(id); }
          });
        }
      } catch (e) { return; }
    }
    (ids || []).forEach(function (id) {
      if (!id) return;
      STAGE3D_SPRITES.forEach(function (sp) { stage3dImg(id, sp); });
    });
  }
  function stage3dHtml(cropId, stage, icon, index) {
    // UI 阶段 1..4 → 精灵阶段：1 发芽=s0，2 幼苗=s1，3 开花=s3，4 结果=s4
    const sp = stage <= 1 ? 0 : stage === 2 ? 1 : stage === 3 ? 3 : 4;
    const im = stage3dImg(cropId, sp);
    if (!im.complete || !im.naturalWidth) return null;
    const sz = STAGE3D_SIZE[sp];
    // 确定性个体差异：同一张精灵按格子索引镜像/缩放/微旋转，整片田不显得克隆
    let h = 0;
    for (let i = 0; i < cropId.length; i++) h = (h * 31 + cropId.charCodeAt(i)) >>> 0;
    const v = (h + (index | 0) * 37) % 9;
    const sc = (0.94 + (v % 4) * 0.028).toFixed(3);
    const rot = ((v - 4) * 1.6).toFixed(1);
    const flip = (v % 2 === 0) ? 1 : -1;
    return '<img class="crop-3d-art" data-stage="' + sp + '" data-variant="' + v + '" src="' + im.src + '" alt="' + icon + '" style="width:' +
      sz + 'px;height:auto;display:inline-block;vertical-align:middle;max-height:' + (sz + 6) +
      'px;object-fit:contain;transform:scaleX(' + flip + ') rotate(' + rot + 'deg) scale(' + sc + ');transform-origin:50% 92%;' +
      'filter:drop-shadow(0 0 4px rgba(255,246,222,.45)) drop-shadow(0 2px 2px rgba(0,0,0,.45));" />';
  }

  const CropRenderExt = {
    // 渲染单个农田格子（支持4阶段+品质+组合效果）
    renderPlot(plot, index, element) {
      if (!plot.crop) {
        element.innerHTML = '<div class="plot-empty">+</div>';
        return;
      }

      // v5.8 修复：farm.js 的 plot.crop 存的是完整 crop 对象，而 CropExpansion 各系统按 id 检索，
      // 导致本扩展（立绘/阶段/品质角标/摇摆）自 v0.9.0 起从未生效。此处统一归一化为 id。
      const cropId = (plot.crop && typeof plot.crop === 'object') ? plot.crop.id : plot.crop;
      const crop = this._getCropDef(cropId);
      if (!crop) return;

      const stage = CropExpansion.GrowthStageSystem.getStage({ crop: cropId, plantedAt: plot.plantedAt });
      const stageIcon = CropExpansion.GrowthStageSystem.getStageIcon(cropId, stage);
      const combo = CropExpansion.ComboSystem.getComboBonus(index);
      const env = CropExpansion.EnvironmentSystem.getEnvironmentBonus(index);

      // 计算生长进度
      const elapsed = (Date.now() - plot.plantedAt) / 1000;
      const progress = Math.min(100, (elapsed / crop.growTime) * 100);
      const ready = progress >= 100;

      // 品质（成熟时roll）
      let quality = plot.quality || 'common';
      if (ready && !plot.quality) {
        let bonusQ = combo.qualityBonus + (env.moistureBoost > 0 ? 1 : 0);
        if (window.WeatherSystem) bonusQ += WeatherSystem.farmQualityBonus(plot) * 6; // v5.7 雾天品质↑
        quality = CropExpansion.QualitySystem.rollQuality(crop.rarity, bonusQ);
        plot.quality = quality;
      }

      const qualityColor = CropExpansion.QualitySystem.QUALITY_COLORS[quality];

      // 缺水状态
      const needsWater = plot.moisture !== undefined && plot.moisture < 30;
      const hasPest = plot.status === 'pest' || plot.status === 'mold';
      // v5.8.1 修复：本扩展用 innerHTML 整格重写，会把 farm.js 已画好的 .plot-status 吞掉——
      // 在此补画全部异常状态图标（drought/weeds/burn/beast），与 farm.js 状态映射一致。
      const STATUS_ICONS = { drought: '🍂', pest: '🐛', weeds: '🌿', burn: '🔥', beast: '🐗', mold: '🦠' };
      const statusBadge = plot.status && STATUS_ICONS[plot.status] ? `<div class="plot-status">${STATUS_ICONS[plot.status]}</div>` : '';

      // v3.5 用真实图片替换 emoji（按阶段缩放大小）
      const stageSizes = [40, 28, 34, 42, 50];
      const imgSize = stageSizes[stage] || 28;
      // 2026-10-23 优先 3D 阶段立绘（每作物独立造型 + 真实生长过程）
      const art3d = stage3dHtml(crop.id, stage, stageIcon, index);
      const cropArt = art3d
        ? art3d
        : ((typeof CropArt !== 'undefined' && CropArt.ready(crop.id))
          ? CropArt.dom(crop.id, stageIcon, imgSize)
          : `<span class="crop-icon stage-${stage}">${stageIcon}</span>`);

      element.innerHTML = `
        <div class="crop-visual ${ready ? 'ready' : ''} ${needsWater ? 'thirsty' : ''} ${hasPest ? 'diseased' : ''}"
             style="color:${ready ? qualityColor : '#88cc88'};">
          ${cropArt}
          ${combo.combos.length > 0 ? '<div class="combo-indicator">✨</div>' : ''}
          ${env.droughtImmune ? '<div class="aura-indicator" title="仙人掌庇护">🛡️</div>' : ''}
          ${needsWater ? '<div class="water-indicator">💧</div>' : ''}
          ${hasPest ? '<div class="pest-indicator">🐛</div>' : ''}
        </div>
        ${statusBadge}
        ${!ready ? `<div class="growth-bar"><div class="growth-fill" style="width:${progress}%"></div></div>` : ''}
        ${ready ? `<div class="quality-badge" style="background:${qualityColor}">${CropExpansion.QualitySystem.QUALITY_NAMES[quality]}</div>` : ''}
      `;

      // 成熟时弹跳动画
      if (ready && !plot._bouncePlayed) {
        plot._bouncePlayed = true;
        element.classList.add('harvest-ready');
        setTimeout(() => element.classList.remove('harvest-ready'), 500);
      }
    },

    // 收获时播放品质特效
    playHarvestEffect(plot, index) {
      const quality = plot.quality || 'common';
      const element = document.querySelectorAll('.farm-cell')[index];
      if (!element) return;

      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;

      CropExpansion.QualitySystem.playHarvestEffect(quality, x, y);

      // 粒子飞向右上角资源栏
      this._spawnHarvestParticles(x, y, quality);
    },

    _spawnHarvestParticles(x, y, quality) {
      const colors = { common: '#ffffff', fine: '#7fff7f', rare: '#cc88ff', legendary: '#ffd700' };
      const color = colors[quality] || '#ffffff';
      const count = quality === 'legendary' ? 15 : quality === 'rare' ? 10 : 5;

      for (let i = 0; i < count; i++) {
        const particle = document.createElement('div');
        particle.className = 'harvest-particle';
        particle.style.cssText = `
          position: fixed; left: ${x}px; top: ${y}px;
          width: 8px; height: 8px; border-radius: 50%;
          background: ${color}; pointer-events: none; z-index: 9999;
          transition: all 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94);
        `;
        document.body.appendChild(particle);

        setTimeout(() => {
          const targetX = window.innerWidth - 100 + Math.random() * 60;
          const targetY = 30 + Math.random() * 30;
          particle.style.left = targetX + 'px';
          particle.style.top = targetY + 'px';
          particle.style.opacity = '0';
          particle.style.transform = `scale(${0.3 + Math.random() * 0.5})`;
        }, 10 + i * 30);

        setTimeout(() => particle.remove(), 1000);
      }
    },

    // 渲染组合连线（在农田上层canvas）
    renderComboLines() {
      // 找到所有有组合的格子对，画虚线连接
      const cells = document.querySelectorAll('.farm-cell');
      cells.forEach((cell, idx) => {
        const combos = CropExpansion.ComboSystem.checkCombos(idx);
        if (combos.length > 0) {
          cell.style.boxShadow = '0 0 8px rgba(127,255,127,0.5)';
        }
      });
    },

    _getCropDef(id) {
      return CONFIG.crops.find(c => c.id === id) || CropExpansion.NEW_CROPS.find(c => c.id === id);
    },

    // P12：主动预热阶段立绘（不传参则预热当前在田作物），供进入农场/选种前提前填缓存
    warmup
  };

  // 注入CSS
  function injectCSS() {
    const css = `
      .crop-visual { position: relative; display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; font-size: 24px; line-height: 1; transition: transform 0.2s; }
      .crop-visual img { filter: drop-shadow(0 2px 2px rgba(0,0,0,.65)) contrast(1.06) saturate(1.04); max-width: 78% !important; max-height: 76% !important; }
      .plot-empty { font-size: 20px; font-weight: 700; color: #34261a; opacity: .5; text-shadow: 0 1px 0 rgba(255,255,255,.06); }
      .crop-visual.ready { animation: cropBounce 1s ease-in-out infinite; }
      .crop-visual.thirsty { filter: brightness(0.6) sepia(0.3); }
      .crop-visual.diseased { filter: hue-rotate(60deg) brightness(0.7); }
      .crop-icon.stage-1 { font-size: 14px; opacity: 0.7; }
      .crop-icon.stage-2 { font-size: 18px; opacity: 0.85; }
      .crop-icon.stage-3 { font-size: 22px; }
      .crop-icon.stage-4 { font-size: 26px; }
      @keyframes cropBounce { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
      .growth-bar { position: absolute; bottom: 2px; left: 4px; right: 4px; height: 4px; background: rgba(0,0,0,0.5); border-radius: 2px; overflow: hidden; }
      .growth-fill { height: 100%; background: linear-gradient(90deg, #4a7c4a, #7fff7f); transition: width 0.3s; }
      .quality-badge { position: absolute; top: 1px; right: 1px; font-size: 8px; padding: 1px 4px; border-radius: 3px; color: #000; font-weight: bold; }
      .combo-indicator { position: absolute; top: -4px; right: -4px; font-size: 12px; animation: sparkle 1.5s ease-in-out infinite; }
      .aura-indicator { position: absolute; bottom: 0; left: 0; font-size: 10px; }
      .water-indicator { position: absolute; top: -2px; left: -2px; font-size: 10px; animation: drip 1s ease-in-out infinite; }
      .pest-indicator { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); font-size: 16px; animation: pestMove 0.5s ease-in-out infinite alternate; }
      @keyframes sparkle { 0%,100% { opacity: 0.5; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.2); } }
      @keyframes drip { 0%,100% { transform: translateY(0); } 50% { transform: translateY(2px); } }
      @keyframes pestMove { from { transform: translate(-60%,-50%); } to { transform: translate(-40%,-50%); } }
      .harvest-ready .crop-visual { animation: harvestPop 0.5s ease-out; }
      @keyframes harvestPop { 0% { transform: scale(1); } 50% { transform: scale(1.3); } 100% { transform: scale(1); } }
      .harvest-particle { box-shadow: 0 0 6px currentColor; }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  // 初始化
  injectCSS();
  window.CropRenderExt = CropRenderExt;
  // P12：分两次延迟预热当前在田作物的阶段图，覆盖存档早/晚加载两种时序；
  // 仅 new Image 填缓存，真正挂载仍由 renderPlot 决定，失败时渲染侧照常回退旧 2D。
  setTimeout(function () { try { warmup(); } catch (e) {} }, 300);
  setTimeout(function () { try { warmup(); } catch (e) {} }, 1500);
})();
