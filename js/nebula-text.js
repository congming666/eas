/* =========================================================================
 * 星云序章 · 文字粒子特效
 * 对主菜单核心文字（品牌 / eyebrow / 标题 / 副标题）做字形采样，
 * 生成环绕字形漂浮的发光粒子：缓慢归位 + 漂浮 + 呼吸闪烁。
 * 主菜单隐藏（进入游戏）或页面不可见时自动暂停并清空。
 * ========================================================================= */
(function () {
  'use strict';

  var SELECTORS = ['.nebula-brand', '.nebula-eyebrow', '.nebula-title', '.nebula-sub'];
  var MAX_TOTAL = 1600;            // 总粒子上限（性能保护）
  var PALETTE = ['#7fe0dc', '#c4adf7', '#9fd4ff', '#e8f6ff'];
  var canvas = null, ctx = null;
  var particles = [];
  var raf = 0;

  function rand(a, b) { return a + Math.random() * (b - a); }

  function menuHidden() {
    var menu = document.getElementById('mainMenu');
    return !menu || menu.classList.contains('hidden');
  }

  function resizeCanvas() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // 对文字元素做字形采样，生成粒子
  function sampleElements() {
    particles = [];
    var budget = MAX_TOTAL;
    document.querySelectorAll(SELECTORS.join(',')).forEach(function (el) {
      if (budget <= 0) return;
      var rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) return;
      var style = getComputedStyle(el);
      var fs = parseFloat(style.fontSize) || rect.height * 0.7;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var off = document.createElement('canvas');
      off.width = Math.max(1, Math.round(rect.width * dpr));
      off.height = Math.max(1, Math.round(rect.height * dpr));
      var octx = off.getContext('2d', { willReadFrequently: true });
      octx.font = (style.fontWeight === 'normal' ? '' : style.fontWeight) + ' ' + (fs * dpr) + 'px ' + style.fontFamily;
      octx.textAlign = 'center';
      octx.textBaseline = 'middle';
      octx.fillStyle = '#fff';
      octx.fillText(el.textContent.trim(), off.width / 2, off.height / 2);
      var img;
      try { img = octx.getImageData(0, 0, off.width, off.height).data; } catch (e) { return; }
      var area = rect.width * rect.height;
      var step = area > 80000 ? 4 : (area > 30000 ? 3 : 2);
      var cap = Math.max(60, Math.min(700, Math.round(budget * Math.min(1, area / 50000))));
      var count = 0;
      for (var y = 0; y < off.height && count < cap; y += step) {
        for (var x = 0; x < off.width && count < cap; x += step) {
          if (img[(y * off.width + x) * 4 + 3] > 110) {
            var px = rect.left + x / dpr;
            var py = rect.top + y / dpr;
            particles.push({
              tx: px, ty: py,
              x: px + rand(-15, 15), y: py + rand(-15, 15),
              size: rand(0.7, 2.3),
              color: PALETTE[(Math.random() * PALETTE.length) | 0],
              phase: Math.random() * 6.283,
              speed: rand(0.4, 1.3),
              pull: rand(0.012, 0.032),
            });
            count++;
          }
        }
      }
      budget -= count;
    });
  }

  function tick() {
    raf = requestAnimationFrame(tick);
    if (menuHidden() || document.hidden) {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      return;
    }
    var w = window.innerWidth, h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    var t = performance.now() / 1000;
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      // 缓慢归位 + 漂浮扰动（星云涌动感）
      p.x += (p.tx - p.x) * p.pull + Math.sin(t * p.speed + p.phase) * 0.13;
      p.y += (p.ty - p.y) * p.pull + Math.cos(t * p.speed * 0.8 + p.phase * 1.7) * 0.13;
      // 呼吸闪烁
      var flick = 0.30 + 0.42 * (0.5 + 0.5 * Math.sin(t * 0.9 + p.phase * 3.1));
      ctx.globalAlpha = flick;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, 6.283);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function init() {
    if (document.getElementById('nebulaTextFx')) return;
    canvas = document.createElement('canvas');
    canvas.id = 'nebulaTextFx';
    canvas.style.cssText = 'position:fixed;top:0;left:0;z-index:12;pointer-events:none;';
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    if (!ctx) return;
    resizeCanvas();
    sampleElements();
    // 字体就绪后重采样，避免字形采样为空
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { sampleElements(); });
    }
    var resizeTimer = 0;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { resizeCanvas(); sampleElements(); }, 250);
    });
    tick();
    console.info('[NebulaText] 文字粒子特效就绪：' + particles.length + ' 粒子');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
