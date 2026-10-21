/* ===================== v5.8.2 · 主菜单「血月」粒子系统 =====================
 * key art 里的月亮 → 动态粒子化（v5.8.4 修正：替换原月亮，位置零偏移）：
 *   1) 月亮位置 = 连通域圆拟合精确值（PNG: 54.71%/13.99% r26.1；SVG: 74.69%/16.44% r40）。
 *      旧版"最亮像素聚类"会把月光照亮的树冠亮叶(lum 248)误认为月核 → 偏右下 76px，已废弃；
 *      运行时仅在精确值 ±6% ROI 内做质心微调（树冠亮核被窗口排除），污染/偏差大回落精确值。
 *   2) 替换式渲染：天空色羽化贴片盖住烘焙月盘 → 程序化月盘（呼吸脉动+环形山暗斑，rage 转血月）
 *      → additive 光晕 → 轨道星尘/月尘/火花。原图月亮真正被动态粒子月亮取代。
 *   3) 悬停反馈：鼠标靠近月亮 → rage 渐进 1 → 月盘染红、粒子转猩红、轨道加速、火花迸射；
 *      #mainMenu.moon-rage → CSS 血色暗角 + 标题呼吸转红 + 「血月当空」耳语。
 *   4) key art 为不透明整图，旧 #titleStarfield（z:0 在图下层）已不可见 → 隐藏省电。
 * 性能：dpr≤1.5，粒子总量 ~230；菜单隐藏/标签页后台/减少动效全部停摆； MutationObserver 同步。
 * ========================================================================= */
(() => {
  'use strict';
  const menu = document.getElementById('mainMenu');
  if (!menu) return;
  const scene = menu.querySelector('.title-scene');
  const img = menu.querySelector('.title-landscape');
  if (!scene || !img) return;

  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const isReduced = () => reduce.matches || document.body.classList.contains('title-reduced-motion');
  const visible = () => !menu.classList.contains('hidden') && !document.hidden;

  /* 月亮精确测量值（tools/measure-title-moon.py：lum>168 连通域 + 边界圆拟合） */
  const MOON = {
    png: { x: .5471, y: .1399, r: 26.1, sky: [108, 154, 112] },
    svg: { x: .7469, y: .1644, r: 40, sky: [14, 32, 44] },
  };
  const rand = (a, b) => a + Math.random() * (b - a);

  /* ---------- DOM：粒子画布 + 血色暗角 + 耳语 ---------- */
  const canvas = document.createElement('canvas');
  canvas.id = 'titleMoonFx';
  canvas.setAttribute('aria-hidden', 'true');
  const tint = document.createElement('div');
  tint.className = 'title-blood-tint';
  tint.setAttribute('aria-hidden', 'true');
  const whisper = document.createElement('div');
  whisper.className = 'title-moon-whisper';
  whisper.setAttribute('aria-hidden', 'true');
  whisper.textContent = '血月当空 · 荒野在躁动';
  scene.insertBefore(tint, scene.firstChild);
  scene.insertBefore(canvas, tint.nextSibling);
  scene.appendChild(whisper);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  /* ---------- 状态 ---------- */
  let w = 0, h = 0, dpr = 1, raf = 0, last = 0;
  let moon = null;            // {x,y,r} 自然坐标比例
  let screenMoon = { x: -999, y: -999, r: 40 }; // 画布坐标（每帧刷新）
  let pointer = null, rage = 0, rageTarget = 0, hovering = false;
  let flares = [], lastFlare = 0;
  const orbiters = [], motes = [], skyDust = [];

  function buildParticles() {
    orbiters.length = 0; motes.length = 0; skyDust.length = 0;
    const big = w > 900;
    const N = big ? 96 : 64;
    for (let i = 0; i < N; i++) {
      orbiters.push({
        a: rand(0, Math.PI * 2), rf: rand(2.3, 5.2),   /* 轨道半径×月盘 r（视觉≈旧 58px 基准的 1.06~2.4 倍） */
        w: rand(.09, .5) * (Math.random() < .7 ? 1 : -1),
        sz: rand(.6, 2.1), tw: rand(0, 6.28),
        q: rand(.72, 1), tilt: rand(-.4, .4),
      });
    }
    for (let i = 0; i < (big ? 26 : 16); i++) {
      motes.push({ a: rand(0, 6.28), d: rand(1.02, 1.3), v: rand(.05, .22), life: rand(0, 1), sz: rand(.5, 1.5) });
    }
    for (let i = 0; i < (big ? 90 : 56); i++) {
      skyDust.push({
        x: Math.random() * w, y: Math.random() * h * .92,
        vx: rand(-6, 6), vy: rand(-3, 3),
        sz: rand(.5, 1.5), al: rand(.18, .55), tw: rand(0, 6.28),
      });
    }
  }

  /* ---------- 月亮定位：精确测量值 + ROI 限定微调（换图自适应） ----------
   * 教训：全图"最亮低饱和斑块"搜索会被月光照亮的树冠(lum 248 小亮点)抢走种子。
   * 改为：仅在精确值 ±6% 窗口内统计 lum>170 亮域质心（窗口已排除树冠），偏差小才采用。 */
  function detectMoon() {
    const nw = img.naturalWidth, nh = img.naturalHeight;
    const fb = (img.currentSrc || img.src || '').includes('.svg') ? MOON.svg : MOON.png;
    moon = { x: fb.x, y: fb.y, r: fb.r, sky: fb.sky };
    if (!nw || !nh) return;
    try {
      const S = Math.min(nw, 1600), sh = Math.max(2, Math.round(S * nh / nw));
      const k = S / nw; // 采样缩放
      const oc = document.createElement('canvas'); oc.width = S; oc.height = sh;
      const octx = oc.getContext('2d', { willReadFrequently: true });
      octx.drawImage(img, 0, 0, S, sh);
      const data = octx.getImageData(0, 0, S, sh).data;
      // ROI：精确值 ±6%（自然比例）
      const x0 = Math.max(0, Math.floor((fb.x - .06) * S)), x1 = Math.min(S, Math.ceil((fb.x + .06) * S));
      const y0 = Math.max(0, Math.floor((fb.y - .06) * sh)), y1 = Math.min(sh, Math.ceil((fb.y + .06) * sh));
      let n = 0, sx = 0, sy = 0;
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
        const i = (y * S + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
        if ((r + g + b) / 3 > 170) { n++; sx += x; sy += y; }
      }
      if (n > 40) {
        const cx = sx / n / S, cy = sy / n / sh;
        const rEq = Math.sqrt(n * 4 / Math.PI) / k; // 等效圆半径（自然 px）
        const dx = Math.abs(cx - fb.x), dy = Math.abs(cy - fb.y);
        if (dx < .025 && dy < .025 && rEq > fb.r * .7 && rEq < fb.r * 1.35) {
          moon = { x: cx, y: cy, r: rEq, sky: fb.sky };
          // 贴片天空色：月盘外 1.6~2.3r 环带采样
          let sr = 0, sg = 0, sb = 0, sn = 0;
          for (let a = 0; a < 6.283; a += .5) for (const kk of [1.7, 2.1]) {
            const px2 = Math.round((cx + Math.cos(a) * (rEq * kk) / nw) * S);
            const py2 = Math.round((cy + Math.sin(a) * (rEq * kk) / nh) * sh);
            if (px2 >= 0 && px2 < S && py2 >= 0 && py2 < sh) {
              const i = (py2 * S + px2) * 4; sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; sn++;
            }
          }
          if (sn > 8) moon.sky = [sr / sn | 0, sg / sn | 0, sb / sn | 0];
        }
      }
    } catch (e) { /* 跨域/解码失败 → 精确值兜底 */ }
  }

  /* ---------- 自然坐标 → 画布坐标（cover-fit + object-position + 视差变换全兼容） ---------- */
  function refreshScreenMoon() {
    const nw = img.naturalWidth || 1792, nh = img.naturalHeight || 967;
    if (!moon) detectMoon();
    const ir = img.getBoundingClientRect(), sr = scene.getBoundingClientRect();
    if (!ir.width || !ir.height) return;
    let px = .74, py = .40;
    try {
      const op = getComputedStyle(img).objectPosition || '74% 40%';
      const m = op.match(/([\d.]+)%\s+([\d.]+)%/);
      if (m) { px = +m[1] / 100; py = +m[2] / 100; }
    } catch (e) {}
    const s = Math.max(ir.width / nw, ir.height / nh);
    const ox = (ir.width - nw * s) * px, oy = (ir.height - nh * s) * py;
    screenMoon.x = ir.left - sr.left + ox + moon.x * nw * s;
    screenMoon.y = ir.top - sr.top + oy + moon.y * nh * s;
    screenMoon.r = Math.max(12, moon.r * s);
  }

  /* ---------- 调色 ---------- */
  const lerp = (a, b, k) => a + (b - a) * k;
  const paleGold = [232, 221, 186], crimson = [255, 66, 42];
  const colOf = k => [lerp(paleGold[0], crimson[0], k), lerp(paleGold[1], crimson[1], k), lerp(paleGold[2], crimson[2], k)];

  /* ---------- 绘制 ---------- */
  function drawFrame(now, dt) {
    ctx.clearRect(0, 0, w, h);
    refreshScreenMoon();
    const M = screenMoon;
    const t = now / 1000;
    rage += (rageTarget - rage) * Math.min(1, dt * 3.4);
    const [cr, cg, cb] = colOf(rage);
    const speed = 1 + rage * 1.7;

    /* 环境星尘：鼠标引力井（悬停场景的普适反馈） */
    ctx.globalCompositeOperation = 'lighter';
    for (const p of skyDust) {
      if (pointer) {
        const dx = pointer.x - p.x, dy = pointer.y - p.y, d = Math.hypot(dx, dy);
        if (d < 170 && d > 4) {
          const f = (1 - d / 170) * 90 * dt;
          p.vx += (dx / d) * f - (dy / d) * f * .8;   // 引力 + 切向漩涡
          p.vy += (dy / d) * f + (dx / d) * f * .8;
        }
      }
      p.vx *= Math.exp(-dt * 1.1); p.vy *= Math.exp(-dt * 1.1);
      p.vx += rand(-1, 1) * dt * 6; p.vy += rand(-1, 1) * dt * 6;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.x < -6) p.x = w + 6; if (p.x > w + 6) p.x = -6;
      if (p.y < -6) p.y = h * .92; if (p.y > h * .95) p.y = -6;
      const tw = .55 + .45 * Math.sin(t * 1.7 + p.tw);
      const near = pointer ? Math.max(0, 1 - Math.hypot(pointer.x - p.x, pointer.y - p.y) / 170) : 0;
      const a = p.al * tw * (1 + near * 1.6);
      ctx.fillStyle = `rgba(${220 + rage * 35 | 0},${218 - rage * 120 | 0},${196 - rage * 140 | 0},${Math.min(1, a)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.sz * (1 + near * .9), 0, 6.283); ctx.fill();
    }

    /* ① 天空贴片：盖住烘焙月盘（真正"替换"原月亮的前提）。羽化边缘融入夜空。 */
    const sky = moon.sky || [108, 154, 112];
    ctx.globalCompositeOperation = 'source-over';
    const pg = ctx.createRadialGradient(M.x, M.y, M.r * .62, M.x, M.y, M.r * 1.5);
    pg.addColorStop(0, `rgba(${sky[0]},${sky[1]},${sky[2]},1)`);
    pg.addColorStop(.62, `rgba(${sky[0]},${sky[1]},${sky[2]},.96)`);
    pg.addColorStop(1, `rgba(${sky[0]},${sky[1]},${sky[2]},0)`);
    ctx.fillStyle = pg;
    ctx.beginPath(); ctx.arc(M.x, M.y, M.r * 1.5, 0, 6.283); ctx.fill();

    /* ② 程序化月盘：呼吸脉动圆盘 + 环形山暗斑（rage → 血月染色） */
    const pulse = 1 + Math.sin(t * 1.1) * .03;
    const dr = M.r * pulse;
    const dc = [lerp(246, 236, rage), lerp(241, 64, rage), lerp(220, 44, rage)];   // 盘面中心（rage 深血红）
    const de = [lerp(201, 148, rage), lerp(189, 26, rage), lerp(151, 16, rage)];    // 盘面边缘（球面暗边）
    const dg = ctx.createRadialGradient(M.x - dr * .22, M.y - dr * .24, dr * .1, M.x, M.y, dr);
    dg.addColorStop(0, `rgb(${dc[0] | 0},${dc[1] | 0},${dc[2] | 0})`);
    dg.addColorStop(.62, `rgb(${lerp(dc[0], de[0], .45) | 0},${lerp(dc[1], de[1], .45) | 0},${lerp(dc[2], de[2], .45) | 0})`);
    dg.addColorStop(1, `rgb(${de[0] | 0},${de[1] | 0},${de[2] | 0})`);
    ctx.fillStyle = dg;
    ctx.beginPath(); ctx.arc(M.x, M.y, dr, 0, 6.283); ctx.fill();
    /* 环形山暗斑（固定布局，避免逐帧随机跳变） */
    ctx.fillStyle = `rgba(${lerp(120, 90, rage) | 0},${lerp(122, 18, rage) | 0},${lerp(96, 14, rage) | 0},${.13 + rage * .1})`;
    for (const [ox, oy, or_] of [[.3, -.2, .24], [-.35, .15, .18], [.05, .35, .14], [-.1, -.42, .12], [.45, .3, .1]]) {
      ctx.beginPath(); ctx.arc(M.x + ox * dr, M.y + oy * dr, or_ * dr, 0, 6.283); ctx.fill();
    }
    /* 月缘描边（正常淡金 / rage 猩红） */
    ctx.strokeStyle = `rgba(${lerp(240, 255, rage) | 0},${lerp(228, 96, rage) | 0},${lerp(190, 64, rage) | 0},${.5 + rage * .3})`;
    ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.arc(M.x, M.y, dr, 0, 6.283); ctx.stroke();

    /* ③ 光晕（additive，叠于月盘之上） */
    ctx.globalCompositeOperation = 'lighter';
    const haloPulse = 1 + Math.sin(t * 1.1) * .06;
    const gr = ctx.createRadialGradient(M.x, M.y, dr * .8, M.x, M.y, dr * 3.0 * haloPulse);
    gr.addColorStop(0, `rgba(${cr | 0},${cg | 0},${cb | 0},${.26 + rage * .2})`);
    gr.addColorStop(.42, `rgba(${cr | 0},${cg | 0},${cb | 0},${.09 + rage * .12})`);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(M.x - dr * 3.2, M.y - dr * 3.2, dr * 6.4, dr * 6.4);

    /* 轨道星尘：椭圆轨道绕月 */
    for (const o of orbiters) {
      o.a += o.w * speed * dt;
      const ex = Math.cos(o.a) * o.rf * M.r, ey = Math.sin(o.a) * o.rf * M.r * o.q;
      const x = M.x + ex * Math.cos(o.tilt) - ey * Math.sin(o.tilt);
      const y = M.y + ex * Math.sin(o.tilt) + ey * Math.cos(o.tilt);
      const tw = .5 + .5 * Math.sin(t * 2.1 + o.tw);
      const a = (.16 + .5 * tw) * (1 - o.rf / 6.4);
      ctx.fillStyle = `rgba(${cr | 0},${cg | 0},${cb | 0},${a})`;
      ctx.beginPath(); ctx.arc(x, y, o.sz, 0, 6.283); ctx.fill();
      if (o.sz > 1.5) {
        ctx.fillStyle = `rgba(${cr | 0},${cg | 0},${cb | 0},${a * .25})`;
        ctx.beginPath(); ctx.arc(x, y, o.sz * 2.6, 0, 6.283); ctx.fill();
      }
    }

    /* 月尘飘散（rim 逸出 + 上浮） */
    for (const p of motes) {
      p.d += p.v * dt * speed; p.life -= dt * .5;
      if (p.life <= 0) { p.life = rand(.8, 1.6); p.a = rand(0, 6.28); p.d = rand(1.0, 1.18); p.sz = rand(.5, 1.5); }
      const x = M.x + Math.cos(p.a) * p.d * M.r, y = M.y + Math.sin(p.a) * p.d * M.r - (1.6 - p.life) * 8;
      const a = Math.max(0, Math.min(.6, p.life)) * .5;
      ctx.fillStyle = `rgba(${cr | 0},${cg | 0},${cb | 0},${a})`;
      ctx.beginPath(); ctx.arc(x, y, p.sz, 0, 6.283); ctx.fill();
    }

    /* 血月火花迸射 */
    if (rage > .35 && now - lastFlare > 90) {
      lastFlare = now;
      const n = 1 + (Math.random() * 2 | 0);
      for (let i = 0; i < n; i++) {
        const a = rand(0, 6.283), v = rand(46, 150);
        flares.push({ x: M.x + Math.cos(a) * M.r * 1.02, y: M.y + Math.sin(a) * M.r * 1.02, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 24, life: rand(.6, 1.3), max: 1.3, sz: rand(.8, 2.2) });
      }
      if (flares.length > 90) flares.splice(0, flares.length - 90);
    }
    for (const f of flares) {
      f.life -= dt; f.x += f.vx * dt; f.y += f.vy * dt; f.vy -= 26 * dt;
      const a = Math.max(0, f.life / f.max);
      ctx.fillStyle = `rgba(255,${100 + 80 * a | 0},${60 * a | 0},${a * .8})`;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.sz, 0, 6.283); ctx.fill();
    }
    flares = flares.filter(f => f.life > 0);
    ctx.globalCompositeOperation = 'source-over';

    /* 调试/验收钩子：逐帧刷新 */
    canvas.dataset.particles = orbiters.length + motes.length + skyDust.length + flares.length;
    canvas.dataset.rage = rage.toFixed(2);
    canvas.dataset.moonX = screenMoon.x.toFixed(0);
    canvas.dataset.moonY = screenMoon.y.toFixed(0);
    canvas.dataset.moonR = screenMoon.r.toFixed(0);
    canvas.dataset.hover = hovering ? '1' : '0';
    canvas.dataset.pointer = pointer ? Math.round(pointer.x) + ',' + Math.round(pointer.y) : '';
  }

  function frame(now) {
    raf = 0;
    if (!visible()) return;
    const dt = Math.min((now - last) / 1000, .05); last = now;
    drawFrame(now, dt);
    if (!isReduced()) raf = requestAnimationFrame(frame);
  }

  /* ---------- 尺寸 ---------- */
  function resize() {
    const r = menu.getBoundingClientRect();
    if (!r.width || !r.height) return;
    w = r.width; h = r.height;
    dpr = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildParticles();
    refreshScreenMoon();
    canvas.dataset.moonX = screenMoon.x.toFixed(0);
    canvas.dataset.moonY = screenMoon.y.toFixed(0);
    canvas.dataset.moonR = screenMoon.r.toFixed(0);
    drawFrame(performance.now(), 0);
  }

  /* ---------- 悬停交互 ---------- */
  function setHover(on) {
    if (hovering === on) return;
    hovering = on;
    rageTarget = on ? 1 : 0;
    menu.classList.toggle('moon-rage', on);
    if (on) {
      whisper.style.left = Math.max(120, Math.min(w - 120, screenMoon.x)) + 'px';
      whisper.style.top = Math.max(46, screenMoon.y - Math.max(screenMoon.r * 3.0, 52)) + 'px';
    }
    whisper.classList.toggle('on', on);
    if (isReduced()) { rage = on ? 1 : 0; drawFrame(performance.now(), 0); }
  }

  menu.addEventListener('pointermove', e => {
    if (!visible() || e.pointerType === 'touch') return;
    const r = canvas.getBoundingClientRect();
    pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (e.target.closest('button,summary,input,details,.nebula-card,#audioControl')) { setHover(false); return; }
    const d = Math.hypot(pointer.x - screenMoon.x, pointer.y - screenMoon.y);
    setHover(d < Math.max(screenMoon.r * 2.3, 40));
    if (isReduced()) drawFrame(performance.now(), 0);
  }, { passive: true });
  menu.addEventListener('pointerleave', () => { pointer = null; setHover(false); });

  /* ---------- 旧星空画布被不透明 key art 完全遮盖 → 隐藏省电 ----------
   * starfield 在 DOMContentLoaded 才建画布（晚于图片 load）→ 重试直至其出现 */
  function hideDeadStarfield() {
    const sf = document.getElementById('titleStarfield');
    if (sf && img.complete && img.naturalWidth > 0 && !(img.currentSrc || img.src || '').includes('.svg')) sf.style.display = 'none';
  }
  let _sfTries = 0;
  const sfRetry = () => { hideDeadStarfield(); if (++_sfTries < 6 && document.getElementById('titleStarfield') && document.getElementById('titleStarfield').style.display !== 'none') setTimeout(sfRetry, 350); };
  document.addEventListener('DOMContentLoaded', sfRetry);

  /* ---------- 生命周期同步 ----------
   * 噪声过滤：moon-rage 等自身类切换不应触发重置（否则自我打架：加类→观察者→sync→移类→循环）。
   * force=true（resize/图片就绪/标签页切换）总是执行。 */
  let _wasVisible = null, _wasReduced = null;
  function sync(force) {
    const vis = visible(), red = isReduced();
    const visChanged = _wasVisible === null || vis !== _wasVisible;
    const redChanged = _wasReduced === null || red !== _wasReduced;
    _wasVisible = vis; _wasReduced = red;
    if (!force && !visChanged && !redChanged) return;
    if (raf) cancelAnimationFrame(raf); raf = 0;
    pointer = null; flares = []; rage = 0; rageTarget = 0;
    setHover(false);
    if (vis) { resize(); if (!red) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  }

  if (img.complete && img.naturalWidth) { detectMoon(); sfRetry(); }
  else img.addEventListener('load', () => { detectMoon(); sfRetry(); sync(true); }, { once: true });
  img.addEventListener('error', () => { detectMoon(); sync(true); }, { once: true });

  /* 调试/验收暴露 */
  window.__moonFX = {
    get moon() { return moon; }, get screenMoon() { return screenMoon; },
    get pointer() { return pointer; }, get hovering() { return hovering; },
    get rage() { return rage; }, img, canvas, menu,
  };

  new MutationObserver(() => sync(false)).observe(menu, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(() => sync(false)).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', () => sync(true));
  reduce.addEventListener('change', () => sync(true));
  let timer;
  window.addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(() => sync(true), 120); });
  sync(true);
})();
