/* 农事音效增强（v5.9.15）
 * - 给现有 AudioManager 补：浇水/施肥/订单完成/建筑升级/成熟提示音
 * - 农场环境音：低频风声循环 + 偶尔乌鸦叫
 * - 通过包装 Farm / OrderSystem / TechSystem 的公开方法自动触发，不改原逻辑
 */
(function () {
  'use strict';
  function ready() {
    return typeof AudioManager !== 'undefined' && typeof Farm !== 'undefined';
  }
  function after(obj, name, fn) {
    if (!obj || typeof obj[name] !== 'function' || obj[name].__sfxWrapped) return false;
    const orig = obj[name];
    const wrapped = function () {
      const r = orig.apply(this, arguments);
      try { fn(r, arguments); } catch (e) {}
      return r;
    };
    wrapped.__sfxWrapped = true;
    obj[name] = wrapped;
    return true;
  }
  function play(name) {
    try {
      if (typeof AudioManager === 'undefined' || !AudioManager.enabled) return;
      if (AudioManager[name]) AudioManager[name]();
    } catch (e) {}
  }
  function init() {
    if (!ready()) { setTimeout(init, 300); return; }
    const F = (typeof Farm !== 'undefined') ? Farm : window.Farm;
    const OS = (typeof OrderSystem !== 'undefined') ? OrderSystem : window.OrderSystem;
    const TS = (typeof TechSystem !== 'undefined') ? TechSystem : window.TechSystem;
    // 浇水 / 施肥
    if (F) {
      after(F, 'water', () => play('playWaterSfx'));
      after(F, 'fertilize', () => play('playFertilizeSfx'));
      after(F, 'harvest', () => { setTimeout(() => play('playCoinSfx'), 90); });
    }
    if (OS) after(OS, 'claim', (ok) => { if (ok) play('playOrderSfx'); });
    if (TS) after(TS, 'upgradeBuilding', (ok) => { if (ok) play('playUpgradeSfx'); });
    // 环境音：首次交互后在农场界面开启
    const startAmbient = () => {
      try {
        if (typeof AudioManager === 'undefined') return;
        if (!AudioManager.ctx) { AudioManager.init(); }
        AudioManager.startFarmAmbient();
        document.removeEventListener('pointerdown', startAmbient, true);
      } catch (e) {}
    };
    document.addEventListener('pointerdown', startAmbient, true);
    // 农场界面可见性：进入开始，离开停止（每 2s 检查）
    setInterval(() => {
      try {
        const farm = document.getElementById('farmScreen');
        const visible = farm && !farm.classList.contains('hidden');
        if (visible && AudioManager.ctx && AudioManager.enabled) AudioManager.startFarmAmbient();
        else if (!visible) AudioManager.stopFarmAmbient();
      } catch (e) {}
    }, 2000);
    console.log('[FarmSfx] hooks ready');
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
