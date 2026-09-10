// ================= v0.9.0 农场渲染扩展（网页版） =================
(function () {
  'use strict';

  const CropRenderExt = {
    // 渲染单个农田格子（支持4阶段+品质+组合效果）
    renderPlot(plot, index, element) {
      if (!plot.crop) {
        element.innerHTML = '<div class="plot-empty">+</div>';
        return;
      }

      const crop = this._getCropDef(plot.crop);
      if (!crop) return;

      const stage = CropExpansion.GrowthStageSystem.getStage(plot);
      const stageIcon = CropExpansion.GrowthStageSystem.getStageIcon(plot.crop, stage);
      const combo = CropExpansion.ComboSystem.getComboBonus(index);
      const env = CropExpansion.EnvironmentSystem.getEnvironmentBonus(index);

      // 计算生长进度
      const elapsed = (Date.now() - plot.plantedAt) / 1000;
      const progress = Math.min(100, (elapsed / crop.growTime) * 100);
      const ready = progress >= 100;

      // 品质（成熟时roll）
      let quality = plot.quality || 'common';
      if (ready && !plot.quality) {
        const bonusQ = combo.qualityBonus + (env.moistureBoost > 0 ? 1 : 0);
        quality = CropExpansion.QualitySystem.rollQuality(crop.rarity, bonusQ);
        plot.quality = quality;
      }

      const qualityColor = CropExpansion.QualitySystem.QUALITY_COLORS[quality];

      // 缺水状态
      const needsWater = plot.moisture !== undefined && plot.moisture < 30;
      const hasPest = plot.status === 'pest' || plot.status === 'mold';

      element.innerHTML = `
        <div class="crop-visual ${ready ? 'ready' : ''} ${needsWater ? 'thirsty' : ''} ${hasPest ? 'diseased' : ''}" 
             style="color:${ready ? qualityColor : '#88cc88'};">
          <span class="crop-icon stage-${stage}">${stageIcon}</span>
          ${combo.combos.length > 0 ? '<div class="combo-indicator">✨</div>' : ''}
          ${env.droughtImmune ? '<div class="aura-indicator" title="仙人掌庇护">🛡️</div>' : ''}
          ${needsWater ? '<div class="water-indicator">💧</div>' : ''}
          ${hasPest ? '<div class="pest-indicator">🐛</div>' : ''}
        </div>
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
    }
  };

  // 注入CSS
  function injectCSS() {
    const css = `
      .crop-visual { position: relative; font-size: 24px; line-height: 1; transition: transform 0.2s; }
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
})();
