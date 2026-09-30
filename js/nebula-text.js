/* =========================================================================
 * 荒野远征 · 标题粒子特效（v5.8）
 * 「荒野远征」四字由粒子汇聚 / 流动构成字形；
 * 鼠标悬停：粒子向鼠标轻微牵引、辉光柔和增强、轻微散开后再聚合。
 * 对象池 + 按需绘制 + rAF 暂停；低饱和辉光，禁止全屏闪白 / 高频闪烁。
 * 主菜单隐藏（进入游戏）或页面不可见时自动暂停并清空。
 * 归属：TITLE 代理（仅本文件 + nebula.js + css/v58-title.css）。
 * ========================================================================= */
(function () {
  'use strict';

  var TITLE_SEL = '.nebula-title';
  var AMBIENT_SELS = ['.nebula-eyebrow', '.nebula-sub'];

  var IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  var DPR = Math.min(window.devicePixelRatio || 1, IS_MOBILE ? 1.5 : 1.75);
  var TITLE_BUDGET = IS_MOBILE ? 700 : 1300;   // 字形粒子上限（性能保护）
  var AMBIENT_BUDGET = IS_MOBILE ? 180 : 300;  // 环境粒子上限

  // 低饱和柔光调色板（青 / 浅紫 / 冰蓝）
  var PALETTE = ['#8fe6e0', '#c9b8f7', '#a9d6ff', '#bff0e6', '#dcd2ff'];

  var canvas = null, ctx = null;
  var raf = 0;
  var W = 0, H = 0;

  var pool = [];          // 对象池
  var titleParts = [];    // 字形粒子
  var ambientParts = [];  // 环境粒子

  var titleRect = null;
  var mouseX = -99999, mouseY = -99999;
  var hoverLevel = 0;     // 0..1 缓动，避免突变
  var HOVER_PAD = 90;     // 标题矩形外扩判定范围
  var ATTRACT_R = 190;    // 牵引半径

  function menuHidden() {
    var m = document.getElementById('mainMenu');
    return !m || m.classList.contains('hidden');
  }

  function rand(a, b) { return a + Math.random() * (b - a); }

  function alloc() { return pool.pop() || {}; }

  function releaseAll(arr) {
    for (var i = 0; i < arr.length; i++) pool.push(arr[i]);
    arr.length = 0;
  }

  function resizeCanvas() {
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  // 对元素文字做字形采样，把可见像素均匀抽取回填到 out
  function sampleElement(el, out, budget, startSpread) {
    if (budget <= 0) return 0;
    var rect = el.getBoundingClientRect();
    if (rect.width < 6 || rect.height < 6) return 0;
    var style = getComputedStyle(el);
    var fs = parseFloat(style.fontSize) || rect.height * 0.8;
    var off = document.createElement('canvas');
    off.width = Math.max(1, Math.round(rect.width * DPR));
    off.height = Math.max(1, Math.round(rect.height * DPR));
    var octx = off.getContext('2d', { willReadFrequently: true });
    octx.clearRect(0, 0, off.width, off.height);
    var weight = (style.fontWeight && style.fontWeight !== 'normal') ? style.fontWeight : '600';
    octx.font = weight + ' ' + (fs * DPR) + 'px ' + (style.fontFamily || 'sans-serif');
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    octx.fillStyle = '#fff';
    octx.fillText(el.textContent.trim(), off.width / 2, off.height / 2);

    var img;
    try { img = octx.getImageData(0, 0, off.width, off.height).data; }
    catch (e) { return 0; }

    // 第一遍：统计字形可见像素总数
    var total = 0;
    for (var y = 0; y < off.height; y++) {
      for (var x = 0; x < off.width; x++) {
        if (img[(y * off.width + x) * 4 + 3] > 120) total++;
      }
    }
    if (total === 0) return 0;

    // 均匀步长抽样，保证粒子铺满整个字形（而非只覆盖顶部几行）
    var stride = Math.max(1, Math.floor(total / budget));
    var count = 0, seen = 0;
    for (var yy = 0; yy < off.height && count < budget; yy++) {
      for (var xx = 0; xx < off.width && count < budget; xx++) {
        if (img[(yy * off.width + xx) * 4 + 3] > 120) {
          if ((seen % stride) === 0) {
            var px = rect.left + xx / DPR;
            var py = rect.top + yy / DPR;
            var p = alloc();
            p.tx = px; p.ty = py;
            p.x = px + rand(-startSpread, startSpread);       // 初始散开 → 汇聚成字
            p.y = py + rand(-startSpread * 0.7, startSpread * 0.7);
            p.size = rand(1.2, 2.4);
            p.color = PALETTE[(Math.random() * PALETTE.length) | 0];
            p.phase = Math.random() * 6.283;
            p.speed = rand(0.5, 1.2);
            p.pull = rand(0.02, 0.04);
            p.grow = rand(0.9, 1.2);
            out.push(p);
            count++;
          }
          seen++;
        }
      }
    }
    return count;
  }

  function resample() {
    releaseAll(titleParts);
    releaseAll(ambientParts);
    var titleEl = document.querySelector(TITLE_SEL);
    if (titleEl) {
      titleRect = titleEl.getBoundingClientRect();
      sampleElement(titleEl, titleParts, TITLE_BUDGET, 150);
    } else {
      titleRect = null;
    }
    AMBIENT_SELS.forEach(function (sel) {
      var el = document.querySelector(sel);
      if (el) sampleElement(el, ambientParts, AMBIENT_BUDGET / AMBIENT_SELS.length, 26);
    });
  }

  function onPointerMove(e) { mouseX = e.clientX; mouseY = e.clientY; }
  function onPointerLeave() { mouseX = -99999; mouseY = -99999; }

  function render() {
    ctx.clearRect(0, 0, W, H);
    if (menuHidden() || document.hidden) return;

    // 悬停判定：鼠标进入标题矩形（含外扩边）
    var hovering = false;
    if (titleRect && mouseX > -9000) {
      var inX = mouseX >= titleRect.left - HOVER_PAD && mouseX <= titleRect.right + HOVER_PAD;
      var inY = mouseY >= titleRect.top - HOVER_PAD && mouseY <= titleRect.bottom + HOVER_PAD;
      hovering = inX && inY;
    }
    hoverLevel += ((hovering ? 1 : 0) - hoverLevel) * 0.07;  // 缓动增辉/散去

    ctx.globalCompositeOperation = 'lighter';
    var t = performance.now() / 1000;
    var i, p, dx, dy, d, infl, effPull, flick, gr, cr;

    // ---- 标题粒子：汇聚字形 + 悬停牵引 / 散开 / 增辉 ----
    for (i = 0; i < titleParts.length; i++) {
      p = titleParts[i];
      dx = mouseX - p.x; dy = mouseY - p.y;
      d = Math.sqrt(dx * dx + dy * dy);
      infl = (d < ATTRACT_R ? (1 - d / ATTRACT_R) : 0) * hoverLevel;

      // 悬停时归位力轻微松脱（轻微散开），离开后恢复归位（再聚合）
      effPull = p.pull * (1 - infl * 0.35);
      p.x += (p.tx - p.x) * effPull + Math.sin(t * p.speed + p.phase) * 0.12;
      p.y += (p.ty - p.y) * effPull + Math.cos(t * p.speed * 0.85 + p.phase * 1.6) * 0.12;
      // 向鼠标轻微牵引
      if (infl > 0.01 && d > 0.001) {
        p.x += (dx / d) * infl * 0.10;
        p.y += (dy / d) * infl * 0.10;
      }

      // 缓慢呼吸（低幅，不闪）
      flick = 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(t * 0.9 + p.phase * 2.7));
      gr = p.size * 2.0 * (1 + infl * 0.4);   // 外层柔光晕
      ctx.globalAlpha = flick * 0.14 * (1 + infl * 0.4);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, gr, 0, 6.283); ctx.fill();
      cr = p.size * p.grow;                    // 内层亮核
      ctx.globalAlpha = flick * (0.58 + infl * 0.20);
      ctx.beginPath(); ctx.arc(p.x, p.y, cr, 0, 6.283); ctx.fill();
    }

    // ---- 环境粒子：eyebrow / sub，安静漂浮 ----
    for (i = 0; i < ambientParts.length; i++) {
      p = ambientParts[i];
      p.x += (p.tx - p.x) * p.pull + Math.sin(t * p.speed + p.phase) * 0.10;
      p.y += (p.ty - p.y) * p.pull + Math.cos(t * p.speed * 0.8 + p.phase) * 0.10;
      flick = 0.45 + 0.30 * (0.5 + 0.5 * Math.sin(t * 0.8 + p.phase * 3.1));
      ctx.globalAlpha = flick * 0.5;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 0.8, 0, 6.283); ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function tick() {
    raf = requestAnimationFrame(tick);
    render();
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
    resample();
    // 字体就绪后重采样，避免字形采样为空
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { resample(); });
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerleave', onPointerLeave);
    document.addEventListener('mouseleave', onPointerLeave);
    var rt = 0;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { resizeCanvas(); resample(); }, 220);
    });
    tick();
    console.info('[NebulaText] 标题粒子就绪：' + titleParts.length + ' 字形粒子 / ' + ambientParts.length + ' 环境粒子');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
