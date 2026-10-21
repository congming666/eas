/* ===================== v5.8.6 · 温室植株程序化绘制 =====================
 * 每种温室稀有植物一套专属形态（与家园全景作物形态系统同一美术语言）：
 *   4 生长阶段（幼苗/成长/近熟/成熟）× 稀有度光色 × 微风摇曳 × 成熟金光。
 * GreenhouseVisual.draw(canvas, plantId, progress, ready, t) —— 纯函数绘制。
 * ========================================================================== */
(function () {
  'use strict';
  const TAU = Math.PI * 2;
  const RAR = {
    rare: { glow: '#7ac8e8', dark: '#3a6a82' },
    epic: { glow: '#b98ae8', dark: '#5a3a78' },
    legendary: { glow: '#e8b45a', dark: '#8a5a2a' },
    common: { glow: '#9adf8a', dark: '#3a5a34' },
  };
  const PLANT_STYLE = {
    golden_wheat: { stem: '#c9a84e', stemD: '#9a7c34', accent: '#f2dc8a', fruit: '#ffe9a0' },
    crystal_corn: { stem: '#6ac8c0', stemD: '#3a8a88', accent: '#bff2ee', fruit: '#a8ecff' },
    rainbow_pumpkin: { stem: '#6a9a4e', stemD: '#4a6e34', accent: '#e8a85a', fruit: '#ff9a4e' },
    moonlight_rice: { stem: '#8a9ac8', stemD: '#5a6a9a', accent: '#d8e2ff', fruit: '#eef2ff' },
    void_mushroom: { stem: '#7a5a9a', stemD: '#4a3462', accent: '#b18ce8', fruit: '#4a3060' },
    thunder_dragon_fruit: { stem: '#4e8a5c', stemD: '#34603e', accent: '#ffe25a', fruit: '#e85a8a' },
    inkbell: { stem: '#4a5a6a', stemD: '#323e4a', accent: '#8ab0d8', fruit: '#2a3448' },
    runevine: { stem: '#5a8a52', stemD: '#3c6038', accent: '#9fe8a0', fruit: '#7ad884' },
    glowshroom: { stem: '#c8c0a8', stemD: '#9a927a', accent: '#8af2e0', fruit: '#5ad8c8' },
    colorfruit: { stem: '#6a8a4a', stemD: '#4a6032', accent: '#e87ab0', fruit: '#e86a9a' },
  };
  function style(id) { return PLANT_STYLE[id] || PLANT_STYLE.golden_wheat; }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); }

  /* ---- 各形态绘制（root 为根部锚点，h 为株高，st 为阶段 0-3，sway 像素） ---- */
  const FORMS = {
    /* 黄金小麦：三株金穗 */
    golden_wheat(c, x, y, s, st, sw, S) {
      for (let k = -1; k <= 1; k++) {
        const px = x + k * 9 * s, h = (26 + st * 8) * s * (1 - Math.abs(k) * .12);
        const tipX = px + sw * (1 + k * .2);
        c.strokeStyle = k === 0 ? S.stem : S.stemD; c.lineWidth = 2 * s;
        c.beginPath(); c.moveTo(px, y); c.quadraticCurveTo(px + sw * .4, y - h * .55, tipX, y - h); c.stroke();
        if (st >= 1) { /* 穗粒 */
          c.fillStyle = S.fruit;
          const grains = 2 + st;
          for (let g = 0; g < grains; g++) {
            const gy = y - h + g * 3.4 * s, gx = tipX + (g % 2 ? 1.8 : -1.8) * s;
            c.beginPath(); c.ellipse(gx, gy, 2.2 * s, 3.6 * s, .4, 0, TAU); c.fill();
          }
          c.strokeStyle = S.accent; c.lineWidth = .8 * s; /* 芒 */
          for (let g = 0; g < 3; g++) { c.beginPath(); c.moveTo(tipX, y - h + g * 3 * s); c.lineTo(tipX + 4.5 * s, y - h - 2 * s + g * 3 * s); c.stroke(); }
        }
      }
    },
    /* 水晶玉米：晶柱主杆 + 晶叶 + 侧棒晶体 */
    crystal_corn(c, x, y, s, st, sw, S) {
      const h = (22 + st * 10) * s;
      c.strokeStyle = S.stem; c.lineWidth = 3 * s;
      c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + sw * .4, y - h * .5, x + sw, y - h); c.stroke();
      c.fillStyle = S.stemD; /* 晶叶 */
      for (let k = 0; k < 2 + st; k++) {
        const ly = y - h * (.25 + k * .2), dir = k % 2 ? 1 : -1;
        c.beginPath(); c.moveTo(x + sw * .3, ly);
        c.lineTo(x + dir * 12 * s + sw * .6, ly - 5 * s); c.lineTo(x + dir * 4 * s, ly + 2.5 * s); c.closePath(); c.fill();
      }
      if (st >= 2) { /* 水晶棒 */
        c.save(); c.translate(x + sw * .8 + 4 * s, y - h * .62); c.rotate(.35);
        c.fillStyle = S.fruit; rr(c, -3 * s, -8 * s, 6 * s, 15 * s, 2.5 * s); c.fill();
        c.fillStyle = S.accent; c.globalAlpha = .75;
        c.beginPath(); c.moveTo(-3 * s, -8 * s); c.lineTo(0, -11 * s); c.lineTo(3 * s, -8 * s); c.closePath(); c.fill();
        c.globalAlpha = 1; c.restore();
      }
      if (st >= 1) { c.fillStyle = S.accent; c.beginPath(); c.arc(x + sw, y - h, 2.4 * s, 0, TAU); c.fill(); }
    },
    /* 彩虹南瓜：藤蔓 + 虹彩瓜 */
    rainbow_pumpkin(c, x, y, s, st, sw, S) {
      c.strokeStyle = S.stem; c.lineWidth = 1.8 * s;
      c.beginPath(); c.moveTo(x - 14 * s, y); c.quadraticCurveTo(x - 4 * s + sw, y - 8 * s, x + 2 * s, y - 4 * s); c.stroke();
      c.fillStyle = S.stemD;
      for (let k = 0; k < 2 + st; k++) { c.beginPath(); c.ellipse(x - 10 * s + k * 7 * s + sw * .5, y - (5 + k * 2.5) * s, 3.4 * s, 2.4 * s, k * .7, 0, TAU); c.fill(); }
      if (st >= 1) {
        const r = (4 + st * 3.2) * s;
        const g = c.createLinearGradient(x - r, y - r * 2, x + r, y);
        g.addColorStop(0, '#e86a6a'); g.addColorStop(.35, '#e8b45a'); g.addColorStop(.65, '#7ac86a'); g.addColorStop(1, '#6a9ae8');
        c.fillStyle = g; c.beginPath(); c.ellipse(x + 4 * s + sw, y - r - 1 * s, r, r * .86, 0, 0, TAU); c.fill();
        c.strokeStyle = 'rgba(60,40,20,.4)'; c.lineWidth = .9 * s;
        for (let k = -1; k <= 1; k++) { c.beginPath(); c.ellipse(x + 4 * s + sw + k * r * .4, y - r - 1 * s, r * .24, r * .84, 0, 0, TAU); c.stroke(); }
        c.fillStyle = S.stem; c.fillRect(x + 3 * s + sw, y - r * 2 - 3 * s, 2.2 * s, 4 * s);
      }
    },
    /* 月光稻：垂穗银稻 + 月辉露珠 */
    moonlight_rice(c, x, y, s, st, sw, S) {
      for (let k = -1; k <= 1; k++) {
        const px = x + k * 8 * s, h = (24 + st * 9) * s * (1 - Math.abs(k) * .15);
        c.strokeStyle = k === 0 ? S.stem : S.stemD; c.lineWidth = 1.8 * s;
        const tipX = px + sw + k * 2 * s, tipY = y - h;
        c.beginPath(); c.moveTo(px, y); c.quadraticCurveTo(px, y - h * .6, tipX, tipY); c.stroke();
        if (st >= 2) { /* 垂穗 */
          c.strokeStyle = S.accent; c.lineWidth = 1.4 * s;
          c.beginPath(); c.moveTo(tipX, tipY); c.quadraticCurveTo(tipX + 4 * s, tipY + 4 * s, tipX + 5.5 * s, tipY + 9 * s); c.stroke();
          c.fillStyle = S.fruit;
          for (let g = 0; g < 3; g++) { c.beginPath(); c.ellipse(tipX + (3 + g * 1.6) * s, tipY + (4 + g * 2.6) * s, 1.6 * s, 2.4 * s, .5, 0, TAU); c.fill(); }
        }
      }
      if (st >= 1) { c.fillStyle = 'rgba(216,226,255,.85)'; c.beginPath(); c.arc(x - 10 * s + sw, y - (20 + st * 6) * s, 1.4 * s, 0, TAU); c.fill(); }
    },
    /* 虚空蘑菇：紫蕈 + 孢子星点 */
    void_mushroom(c, x, y, s, st, sw, S, t) {
      const h = (12 + st * 8) * s;
      c.fillStyle = S.stemD; rr(c, x - 3 * s + sw * .3, y - h, 6 * s, h, 2.5 * s); c.fill();
      c.fillStyle = S.stem; rr(c, x - 2 * s + sw * .3, y - h, 3 * s, h, 1.5 * s); c.fill();
      const capR = (6 + st * 4.4) * s;
      c.fillStyle = S.fruit;
      c.beginPath(); c.ellipse(x + sw * .3, y - h, capR, capR * .62, 0, Math.PI, TAU); c.fill();
      c.beginPath(); c.ellipse(x + sw * .3, y - h, capR, capR * .2, 0, 0, Math.PI); c.fill();
      if (st >= 1) { /* 伞面星斑 */
        c.fillStyle = S.accent;
        const dots = 2 + st;
        for (let k = 0; k < dots; k++) { c.beginPath(); c.arc(x + sw * .3 + (k - dots / 2) * capR * .4, y - h - capR * .3 + (k % 2) * 3 * s, 1.3 * s, 0, TAU); c.fill(); }
      }
      if (st >= 3) { /* 上浮孢子 */
        c.fillStyle = 'rgba(177,140,232,.7)';
        for (let k = 0; k < 3; k++) { const ph = ((t * .5 + k * .33) % 1); c.globalAlpha = .7 * (1 - ph); c.beginPath(); c.arc(x + (k - 1) * 7 * s + Math.sin(t * 2 + k) * 2, y - h - capR - ph * 16 * s, 1.1 * s, 0, TAU); c.fill(); }
        c.globalAlpha = 1;
      }
    },
    /* 雷龙果：仙人掌茎节 + 玫红龙果 + 电弧 */
    thunder_dragon_fruit(c, x, y, s, st, sw, S, t) {
      const h = (18 + st * 9) * s;
      c.fillStyle = S.stem; /* 三节茎 */
      for (let k = 0; k < 3; k++) { rr(c, x - 3.4 * s + sw * .4 * (k % 2), y - h * (k + 1) / 3, 6.8 * s, h / 3 + 2, 3 * s); c.fill(); }
      c.fillStyle = S.stemD;
      rr(c, x - 12 * s, y - h * .55, 9 * s, 4.4 * s, 2 * s); c.fill();
      rr(c, x + 3 * s, y - h * .78, 9 * s, 4.4 * s, 2 * s); c.fill();
      if (st >= 2) { /* 龙果 */
        c.fillStyle = S.fruit;
        c.beginPath(); c.ellipse(x + 7.5 * s, y - h * .78 - 4 * s, 4.6 * s, 5.6 * s, .2, 0, TAU); c.fill();
        c.fillStyle = S.accent;
        for (let k = 0; k < 4; k++) { const a = k * 1.7 + .4; c.beginPath(); c.moveTo(x + 7.5 * s + Math.cos(a) * 4.4 * s, y - h * .78 - 4 * s + Math.sin(a) * 5.4 * s); c.lineTo(x + 7.5 * s + Math.cos(a) * 7.4 * s, y - h * .78 - 4 * s + Math.sin(a) * 8 * s); c.lineWidth = 1.4 * s; c.strokeStyle = S.accent; c.stroke(); }
      }
      if (st >= 3 && Math.sin(t * 6) > .2) { /* 电弧 */
        c.strokeStyle = 'rgba(255,226,90,.9)'; c.lineWidth = 1.2 * s;
        c.beginPath(); c.moveTo(x - 6 * s, y - h - 2 * s); c.lineTo(x - 2 * s, y - h - 6 * s); c.lineTo(x - 5 * s, y - h - 6 * s); c.lineTo(x - 1 * s, y - h - 11 * s); c.stroke();
      }
    },
    /* 墨铃花：倒挂铃朵滴墨 */
    inkbell(c, x, y, s, st, sw, S, t) {
      const h = (20 + st * 9) * s;
      c.strokeStyle = S.stem; c.lineWidth = 2 * s;
      c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + sw * .5, y - h * .6, x + sw, y - h); c.stroke();
      const bells = st >= 2 ? 3 : st;
      for (let k = 0; k < bells; k++) {
        const bx = x + sw + (k - (bells - 1) / 2) * 7 * s, by = y - h + 4 * s + (k % 2) * 3 * s;
        c.strokeStyle = S.stemD; c.lineWidth = 1 * s;
        c.beginPath(); c.moveTo(x + sw, y - h); c.lineTo(bx, by); c.stroke();
        c.fillStyle = S.fruit; /* 铃 */
        c.beginPath(); c.moveTo(bx - 3.4 * s, by); c.quadraticCurveTo(bx - 3.8 * s, by + 6 * s, bx - 2.6 * s, by + 7 * s);
        c.lineTo(bx + 2.6 * s, by + 7 * s); c.quadraticCurveTo(bx + 3.8 * s, by + 6 * s, bx + 3.4 * s, by); c.closePath(); c.fill();
        c.fillStyle = S.accent; c.fillRect(bx - 2.6 * s, by + 6 * s, 5.2 * s, 1.2 * s);
      }
      if (st >= 3) { /* 墨滴 */
        const ph = (t * .4) % 1;
        c.fillStyle = `rgba(42,52,72,${.85 * (1 - ph)})`;
        c.beginPath(); c.ellipse(x + sw, y - h + 12 * s + ph * 14 * s, 1.3 * s, 1.9 * s, 0, 0, TAU); c.fill();
      }
    },
    /* 符文藤：螺旋藤 + 发光符文 */
    runevine(c, x, y, s, st, sw, S, t) {
      c.strokeStyle = S.stem; c.lineWidth = 2.4 * s;
      c.beginPath(); c.moveTo(x, y);
      const h = (22 + st * 10) * s;
      for (let k = 1; k <= 8; k++) { const py = y - h * k / 8; c.lineTo(x + Math.sin(k * 1.1) * 6 * s + sw * (k / 8), py); }
      c.stroke();
      c.fillStyle = S.stemD;
      for (let k = 0; k < 2 + st; k++) { const py = y - h * (.2 + k * .22); c.beginPath(); c.ellipse(x + Math.sin(k * 2.2) * 6 * s, py, 3 * s, 1.8 * s, k, 0, TAU); c.fill(); }
      if (st >= 1) { /* 符文 */
        const glow = .6 + .4 * Math.sin(t * 3);
        c.fillStyle = `rgba(159,232,160,${glow})`; c.font = `${Math.round(7 * s)}px serif`; c.textAlign = 'center';
        const runes = ['ᚱ', 'ᚨ', 'ᛟ'];
        for (let k = 0; k < Math.min(st, 3); k++) c.fillText(runes[k], x + Math.sin(k * 2.2 + 1) * 7 * s, y - h * (.35 + k * .25));
      }
    },
    /* 灵光菇：白杆青伞 + 辉光 */
    glowshroom(c, x, y, s, st, sw, S, t) {
      const h = (11 + st * 7) * s;
      c.fillStyle = S.stem; rr(c, x - 2.6 * s + sw * .3, y - h, 5.2 * s, h, 2.4 * s); c.fill();
      const capR = (5.5 + st * 4) * s;
      const g = c.createRadialGradient(x + sw * .3, y - h, 1, x + sw * .3, y - h, capR * 1.15);
      g.addColorStop(0, '#c0f8ec'); g.addColorStop(.6, S.fruit); g.addColorStop(1, S.stemD);
      c.fillStyle = g;
      c.beginPath(); c.ellipse(x + sw * .3, y - h, capR, capR * .66, 0, Math.PI, TAU); c.fill();
      c.beginPath(); c.ellipse(x + sw * .3, y - h, capR, capR * .2, 0, 0, Math.PI); c.fill();
      if (st >= 1) { c.fillStyle = 'rgba(255,255,255,.85)'; for (let k = 0; k < 1 + st; k++) { c.beginPath(); c.arc(x + sw * .3 + (k - st / 2) * capR * .45, y - h - capR * .32 + (k % 2) * 2.4 * s, 1.1 * s, 0, TAU); c.fill(); } }
      if (st >= 3) { /* 辉光晕 */
        const pulse = .25 + .15 * Math.sin(t * 2.4);
        const gg = c.createRadialGradient(x + sw * .3, y - h, 1, x + sw * .3, y - h, capR * 2.4);
        gg.addColorStop(0, `rgba(138,242,224,${pulse})`); gg.addColorStop(1, 'rgba(138,242,224,0)');
        c.fillStyle = gg; c.beginPath(); c.arc(x + sw * .3, y - h, capR * 2.4, 0, TAU); c.fill();
      }
    },
    /* 彩果：灌木 + 五彩浆果 */
    colorfruit(c, x, y, s, st, sw, S) {
      c.strokeStyle = S.stem; c.lineWidth = 2 * s;
      const h = (14 + st * 8) * s;
      for (let k = -1; k <= 1; k++) { c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + k * 6 * s, y - h * .6, x + k * 9 * s + sw * .5, y - h * (0.8 + Math.abs(k) * .1)); c.stroke(); }
      c.fillStyle = S.stemD;
      for (let k = 0; k < 3 + st; k++) { c.beginPath(); c.ellipse(x + (k - 2) * 6 * s + sw * .4, y - h * (.35 + (k % 3) * .22), 3.2 * s, 2.2 * s, k * .8, 0, TAU); c.fill(); }
      if (st >= 1) {
        const cols = ['#e85a6a', '#e8b45a', '#7ac86a', '#6a9ae8', '#b06ae8'];
        const n = st + 2;
        for (let k = 0; k < n; k++) {
          c.fillStyle = cols[k % cols.length];
          c.beginPath(); c.arc(x + (k - n / 2) * 6.4 * s + sw * .5, y - h * (.5 + (k % 3) * .2) - 3 * s, (2 + st * .5) * s, 0, TAU); c.fill();
          c.fillStyle = 'rgba(255,255,255,.5)'; c.beginPath(); c.arc(x + (k - n / 2) * 6.4 * s + sw * .5 - .8 * s, y - h * (.5 + (k % 3) * .2) - 3.8 * s, .7 * s, 0, TAU); c.fill();
        }
      }
    },
  };

  const GreenhouseVisual = {
    RAR,
    /* 在 canvas 上绘制一株温室植物。progress 0-1，ready 成熟，t 秒（摇曳/动效相位） */
    draw(canvas, plantId, progress, ready, t) {
      const c = canvas.getContext('2d');
      const W = canvas.width, H = canvas.height;
      c.clearRect(0, 0, W, H);
      const def = (CONFIG.greenhousePlants || []).find(p => p.id === plantId);
      const rar = RAR[(def && def.rarity) || 'common'] || RAR.common;
      const S = style(plantId);
      const cx = W / 2, base = H * .86;
      const st = ready ? 3 : progress < .3 ? 0 : progress < .65 ? 1 : progress < 1 ? 2 : 3;
      const sway = Math.sin((t || 0) * 1.6 + cx) * (1.2 + st * .9);
      /* 培养土 */
      c.fillStyle = '#2a2419';
      c.beginPath(); c.ellipse(cx, base + 2, W * .3, H * .075, 0, 0, TAU); c.fill();
      c.fillStyle = '#3a3222';
      c.beginPath(); c.ellipse(cx, base, W * .27, H * .06, 0, 0, TAU); c.fill();
      /* 稀有度微光底座 */
      const rg = c.createRadialGradient(cx, base - 8, 1, cx, base - 8, W * .42);
      rg.addColorStop(0, rar.glow + (ready ? '3a' : '1c'));
      rg.addColorStop(1, rar.glow + '00');
      c.fillStyle = rg; c.fillRect(0, 0, W, H);
      /* 植株 */
      const scale = W / 92;
      (FORMS[plantId] || FORMS.golden_wheat)(c, cx, base, scale * (.55 + st * .15), st, sway, S, t || 0);
      /* 成熟金光 + 萤火 */
      if (ready) {
        const pulse = .3 + .18 * Math.sin((t || 0) * 3);
        const g = c.createRadialGradient(cx, base - 20, 2, cx, base - 20, W * .46);
        g.addColorStop(0, `rgba(255,224,138,${pulse})`);
        g.addColorStop(1, 'rgba(255,224,138,0)');
        c.fillStyle = g; c.fillRect(0, 0, W, H);
        c.fillStyle = 'rgba(255,236,170,.9)';
        for (let k = 0; k < 3; k++) {
          const a = (t || 0) * 1.4 + k * 2.1;
          c.globalAlpha = .5 + .5 * Math.sin((t || 0) * 3 + k * 2);
          c.beginPath(); c.arc(cx + Math.cos(a) * W * .3, base - 18 + Math.sin(a * 1.3) * 14, 1.6, 0, TAU); c.fill();
        }
        c.globalAlpha = 1;
      }
    },
  };
  window.GreenhouseVisual = GreenhouseVisual;
})();
