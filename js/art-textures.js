/* ================= 美术贴图层：程序化可平铺纹理（v1.0 2026-10-16） =================
 * 为远征地提供「美术贴图」质感的基底：
 *  - groundTile(themeColor)：按地图主题色生成 256px 可平铺地表纹理（土斑/草丛/碎石/噪点）
 *  - waterTile()：水面平铺纹理（暗色基底 + 波痕 + 微光点）
 *  - dispMap()：位移着色器噪声图（PixiTerrain 水面折射用）
 * 所有纹理按 256px 无缝平铺设计（边缘环绕绘制）；chunk=512px 恰好容纳 2×2 瓦片，
 * pattern 锚定 chunk 原点 → 跨 chunk 严格对齐无接缝。
 * ================================================================================ */
const ArtTextures = (() => {
  'use strict';

  const cache = new Map();

  // ---- 颜色工具（与 expedition-terrain 同思路的明暗派生） ----
  function shade(hex, f) {
    const n = parseInt(hex.replace('#', ''), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
    else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }
  function hexToRgbStr(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  }

  // 边缘环绕绘制：靠近画布边缘时在 9 个偏移位重复绘制，保证平铺无缝
  function wrapDraw(ctx, S, x, y, r, fn) {
    const offs = [[0, 0]];
    if (x < r) offs.push([S, 0], [S, S], [0, S]);
    else if (x > S - r) offs.push([-S, 0], [-S, S], [0, S]);
    if (y < r) offs.push([0, S], [S, S], [-S, S]);
    else if (y > S - r) offs.push([0, -S], [S, -S], [-S, -S]);
    for (const [ox, oy] of offs) fn(x + ox, y + oy);
  }

  // 确定性伪随机（同一 tile 每次生成一致，便于调试与回归）
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  // ---- 地表纹理：按主题色生成 ----
  function groundTile(baseHex) {
    const key = 'g:' + baseHex;
    if (cache.has(key)) return cache.get(key);
    const S = 256;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    const R = rng(0x9e3779b9 ^ [...baseHex].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7));

    const dark = shade(baseHex, -0.22), darker = shade(baseHex, -0.38);
    const light = shade(baseHex, 0.12), lighter = shade(baseHex, 0.22);
    const warm = shade(baseHex, -0.12);

    // 1) 基底
    g.fillStyle = baseHex; g.fillRect(0, 0, S, S);

    // 2) 大尺度柔和土斑（径向渐变，环绕绘制）×16
    for (let i = 0; i < 16; i++) {
      const x = R() * S, y = R() * S, r = 26 + R() * 44;
      const tone = R();
      wrapDraw(g, S, x, y, r, (px, py) => {
        const grd = g.createRadialGradient(px, py, 0, px, py, r);
        grd.addColorStop(0, `rgba(${tone < .4 ? hexToRgbStr(darker) : tone < .7 ? hexToRgbStr(warm) : hexToRgbStr(light)},${(.05 + R() * .07).toFixed(3)})`);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd;
        g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill();
      });
    }

    // 3) 微观噪点 ×2400（1-2px，明暗交替——「连续表面」的关键）
    for (let i = 0; i < 2400; i++) {
      const l = R();
      g.fillStyle = l < .46 ? `rgba(${hexToRgbStr(darker)},${(.06 + R() * .1).toFixed(3)})`
                 : l < .78 ? `rgba(${hexToRgbStr(light)},${(.05 + R() * .08).toFixed(3)})`
                 : `rgba(0,0,0,${(.05 + R() * .07).toFixed(3)})`;
      g.fillRect(R() * S, R() * S, 1 + R() * 1.4, 1 + R() * 1.2);
    }

    // 4) 草丛笔触 ×72（每丛 2-4 笔弧线，主题色系派生——棕主题读作干草，绿主题读作草叶）
    const bladeCols = [shade(baseHex, 0.18), shade(baseHex, 0.08), shade(baseHex, -0.3), shade(baseHex, 0.26)];
    for (let i = 0; i < 72; i++) {
      const x = R() * S, y = R() * S, h = 3 + R() * 5, n = 2 + (R() * 3 | 0);
      g.strokeStyle = bladeCols[i % 4]; g.lineWidth = 1 + R() * .4;
      g.globalAlpha = .28 + R() * .3;
      wrapDraw(g, S, x, y, h + 4, (px, py) => {
        for (let k = 0; k < n; k++) {
          const dx = (k - (n - 1) / 2) * 2.2;
          g.beginPath(); g.moveTo(px + dx, py);
          g.quadraticCurveTo(px + dx + (R() - .5) * 2, py - h * .6, px + dx + (R() - .5) * 4, py - h - R() * 2);
          g.stroke();
        }
      });
    }
    g.globalAlpha = 1;

    // 5) 碎石 ×26（小椭圆 + 高光点）
    for (let i = 0; i < 26; i++) {
      const x = R() * S, y = R() * S, r = 1.6 + R() * 2.6;
      wrapDraw(g, S, x, y, r + 2, (px, py) => {
        g.fillStyle = R() < .5 ? dark : `rgba(${hexToRgbStr(light)},.8)`;
        g.beginPath(); g.ellipse(px, py, r, r * (.55 + R() * .3), R() * Math.PI, 0, Math.PI * 2); g.fill();
        g.fillStyle = `rgba(${hexToRgbStr(lighter)},${(.3 + R() * .3).toFixed(2)})`;
        g.beginPath(); g.arc(px - r * .25, py - r * .3, r * .3, 0, Math.PI * 2); g.fill();
      });
    }

    // 6) 细土沟 ×10（短弧线，模拟犁痕/冲刷痕）
    for (let i = 0; i < 10; i++) {
      const x = R() * S, y = R() * S, len = 8 + R() * 18;
      g.strokeStyle = `rgba(${hexToRgbStr(darker)},${(.1 + R() * .1).toFixed(2)})`;
      g.lineWidth = 1.2 + R();
      wrapDraw(g, S, x, y, len, (px, py) => {
        g.beginPath(); g.moveTo(px, py);
        g.quadraticCurveTo(px + len * .5, py + (R() - .5) * 6, px + len, py + (R() - .5) * 8);
        g.stroke();
      });
    }

    cache.set(key, c);
    return c;
  }

  // ---- 水面纹理 ----
  function waterTile() {
    const key = 'w';
    if (cache.has(key)) return cache.get(key);
    const S = 256;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    const R = rng(0xC0FFEE);

    const grd = g.createLinearGradient(0, 0, 0, S);
    grd.addColorStop(0, '#1c454e'); grd.addColorStop(.55, '#143741'); grd.addColorStop(1, '#0c2530');
    g.fillStyle = grd; g.fillRect(0, 0, S, S);

    // 波痕（水平缓曲线，环绕绘制）×64 —— 亮度足够让 screen 混合在水面上显形
    for (let i = 0; i < 64; i++) {
      const y = R() * S, x = R() * S, len = 26 + R() * 60;
      g.strokeStyle = `rgba(196,236,226,${(.14 + R() * .2).toFixed(3)})`;
      g.lineWidth = 1 + R() * 1.4;
      wrapDraw(g, S, x, y, len, (px, py) => {
        g.beginPath(); g.moveTo(px, py);
        g.quadraticCurveTo(px + len * .5, py + (R() - .5) * 5, px + len, py + (R() - .5) * 3);
        g.stroke();
      });
    }
    // 暗波 ×22（下层深度感）
    for (let i = 0; i < 22; i++) {
      const y = R() * S, x = R() * S, len = 30 + R() * 50;
      g.strokeStyle = `rgba(6,20,26,${(.1 + R() * .12).toFixed(2)})`;
      g.lineWidth = 1.4 + R();
      wrapDraw(g, S, x, y, len, (px, py) => {
        g.beginPath(); g.moveTo(px, py);
        g.quadraticCurveTo(px + len * .5, py - (R() - .5) * 4, px + len, py);
        g.stroke();
      });
    }
    // 微光点 ×70
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(190,232,222,${(.05 + R() * .12).toFixed(2)})`;
      g.fillRect(R() * S, R() * S, 1 + R(), .8 + R() * .6);
    }
    // 噪点 ×500（消平涂）
    for (let i = 0; i < 500; i++) {
      g.fillStyle = R() < .5 ? 'rgba(0,0,0,.05)' : 'rgba(140,190,185,.04)';
      g.fillRect(R() * S, R() * S, 1.3, 1.3);
    }
    cache.set(key, c);
    return c;
  }

  // ---- 位移噪声图（灰度云） ----
  function dispMap() {
    const key = 'd';
    if (cache.has(key)) return cache.get(key);
    const S = 256;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    const R = rng(0xD15EA5);
    g.fillStyle = '#808080'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 34; i++) {
      const x = R() * S, y = R() * S, r = 22 + R() * 52;
      const tone = R() < .5 ? 255 : 0;
      wrapDraw(g, S, x, y, r, (px, py) => {
        const grd = g.createRadialGradient(px, py, 0, px, py, r);
        grd.addColorStop(0, `rgba(${tone},${tone},${tone},.42)`);
        grd.addColorStop(1, 'rgba(128,128,128,0)');
        g.fillStyle = grd;
        g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill();
      });
    }
    cache.set(key, c);
    return c;
  }

  // ---- 障碍物美术纹理（v1.3 差异化）：季节 × 地图 × 5 变体 ----
  // 画布 256×256（设计坐标系 128 + g.scale(2,2) → 2x 超采样抗锯齿）；
  // 地面接触点 (64,112)（设计系），向上生长；底部留接触暗斑。
  // 显示锚点与现有 drawImage(-size/2,-size*.84,size,size) 对齐。
  const OB_VARIANTS = { tree: 5, bush: 2, rock: 3, deadTree: 2, hay: 2, fence: 1, ruin: 2, monolith: 2, crystal: 2, toxicCrystal: 2 };

  // ---- 树木差异化（v1.3）：季节调色板 × 地图 tier 色偏 ----
  // 四季调色板（暗→亮 8 阶）。summer 为基准；spring 嫩黄绿+花斑；autumn 棕→金；winter 灰绿稀疏+雪。
  const TREE_PAL = {
    spring: ['#183420', '#224a29', '#2c5a32', '#37703c', '#478d49', '#5fa855', '#7fc268', '#a5dd80'],
    summer: ['#15281a', '#1d3822', '#254528', '#2f5730', '#3a6a3a', '#4a7f40', '#699a50', '#8db566'],
    autumn: ['#2a1d10', '#3d2b14', '#5c3d1a', '#7d4e1e', '#a1621f', '#c07a24', '#d89838', '#eec25e'],
    winter: ['#2a3230', '#36423c', '#42514a', '#4f6056', '#5c7062', '#6b8070', '#7d9482', '#93aa97'],
  };
  // tier 色偏：同一季节下不同地图的树整体气质不同（混色实现，简单且稳定）
  function _hex2rgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  function _rgb2hex(r, g, b) { return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join(''); }
  function tintPal(PAL, tier) {
    if (!tier || tier < 2) return PAL.slice();
    const mix = (a, b, t) => { const A = _hex2rgb(a), B = _hex2rgb(b); return _rgb2hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); };
    if (tier === 2) return PAL.map(c => mix(c, '#b8a84e', .16));   // 农庄：偏黄（人工林气息）
    if (tier === 3) return PAL.map(c => mix(c, '#0d2114', .24));   // 深林：更暗邃
    if (tier >= 4) return PAL.map(c => mix(c, '#8a5a28', .24));    // 焦土：枯褐（辐射变异感）
    return PAL.slice();
  }
  // 季节装饰：spring 花斑 / autumn 红叶点缀 / winter 雪覆（画在叶簇云之后）
  function seasonDeco(g, R, TAU, season, cx, cy, rx, ry) {
    if (season === 'spring') {
      for (let i = 0; i < 16; i++) {                                   // 花斑：粉白小簇散在受光面
        const a = R() * TAU, dd = Math.sqrt(R()) * .8;
        g.fillStyle = R() < .5 ? '#e8c8d8' : '#f2e6ea';
        g.beginPath(); g.ellipse(cx + Math.cos(a) * rx * dd - 3, cy + Math.sin(a) * ry * dd - 3, 1.3 + R(), 1 + R() * .7, R() * 3, 0, TAU); g.fill();
      }
    } else if (season === 'autumn') {
      for (let i = 0; i < 20; i++) {                                   // 红叶点缀（秋树黄中带红）
        const a = R() * TAU, dd = Math.sqrt(R()) * .92;
        g.fillStyle = R() < .5 ? '#b5482a' : '#8f3a22';
        g.beginPath(); g.ellipse(cx + Math.cos(a) * rx * dd, cy + Math.sin(a) * ry * dd, 1.6 + R() * 1.2, 1.2 + R() * .8, R() * 3, 0, TAU); g.fill();
      }
    } else if (season === 'winter') {
      for (let i = 0; i < 30; i++) {                                   // 雪覆：冠上半部白色簇（重力沉积感）
        const a = -Math.PI * (.95 + R() * 1.1), dd = .35 + R() * .75;
        g.fillStyle = R() < .6 ? '#e8f0f2' : '#cfdde2';
        g.beginPath(); g.ellipse(cx + Math.cos(a) * rx * dd, cy + Math.sin(a) * ry * dd, 2 + R() * 1.8, 1.4 + R(), R() * .8 - .4, 0, TAU); g.fill();
      }
    }
  }
  const WINTER_THIN = .62;   // 冬季叶幕稀疏系数（簇数乘子）

  // 叶簇云通用绘制器：PAL 调色板（暗→亮），crown 椭圆冠参数。
  // 三波簇（暗全冠/中内部/亮受光）+ 簇间暗缝 + 轮廓 rim 碎簇。
  // 远看成团 · 近看碎叶 · 边缘锯齿 · 方向性光照——去「气球树」感。
  function drawFoliageCloud(g, R, TAU, PAL, cx, cy, rx, ry, opts) {
    const o = Object.assign({ darkN: 84, midN: 64, litN: 38, gapN: 26, rimN: 22, dripN: 10 }, opts);
    // 冠剪影（暗底 + 边缘起伏 → 后续簇越出形成锯齿）
    const nEdge = 16, sil = [];
    for (let i = 0; i <= nEdge; i++) {
      const a = i / nEdge * TAU;
      const wob = 1 + (R() - .5) * .18;
      sil.push([cx + Math.cos(a) * rx * wob, cy + Math.sin(a) * ry * wob * (Math.sin(a) < 0 ? 1.06 : .94)]);
    }
    g.fillStyle = PAL[0];
    g.beginPath(); sil.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fill();
    // 单簇 = 三层椭圆（暗底偏移 / 主体 / 左上亮斑）
    const cluster = (n, rMax, palLo, palHi, light) => {
      for (let i = 0; i < n; i++) {
        const a = R() * TAU, dd = Math.sqrt(R()) * rMax;
        let x = cx + Math.cos(a) * rx * dd;
        let y = cy + Math.sin(a) * ry * dd;
        if (light) { x -= (1 - dd) * 6; y -= (1 - dd) * 5; }   // 亮簇向受光面（左上）收缩
        const pi = palLo + ((R() * (palHi - palLo + 1)) | 0) + (light ? 2 : 0);
        const crx = 2.6 + R() * 2.6, cry = 2 + R() * 2, rot = R() * TAU;
        g.fillStyle = PAL[Math.max(0, pi - 1)];
        g.beginPath(); g.ellipse(x + .8, y + .9, crx, cry, rot, 0, TAU); g.fill();
        g.fillStyle = PAL[Math.min(PAL.length - 1, pi)];
        g.beginPath(); g.ellipse(x, y, crx * .82, cry * .8, rot, 0, TAU); g.fill();
        g.fillStyle = PAL[Math.min(PAL.length - 1, pi + 1)];
        g.beginPath(); g.ellipse(x - crx * .25, y - cry * .3, crx * .38, cry * .36, rot, 0, TAU); g.fill();
      }
    };
    cluster(o.darkN, 1.08, 1, 2, false);   // 暗簇：全冠（越出剪影 → 边缘锯齿）
    cluster(o.midN, .9, 3, 4, false);      // 中簇：内部主体
    cluster(o.litN, .72, 4, 5, true);      // 亮簇：左上受光
    // 簇间暗缝（负空间透气，防「实心面团」）
    for (let i = 0; i < o.gapN; i++) {
      const a = R() * TAU, dd = Math.sqrt(R()) * .95;
      g.fillStyle = 'rgba(10,20,12,.5)';
      g.beginPath(); g.ellipse(cx + Math.cos(a) * rx * dd, cy + Math.sin(a) * ry * dd, 1.6 + R() * 1.6, 1.1 + R(), R() * TAU, 0, TAU); g.fill();
    }
    // 月光 rim：右上轮廓碎簇提亮（替代连续弧线——弧线是矢量感的来源）
    for (let i = 0; i < o.rimN; i++) {
      const a = -1.9 + R() * 1.5;
      const wob = 1.02 + R() * .1;
      g.fillStyle = R() < .5 ? PAL[PAL.length - 1] : PAL[PAL.length - 2];
      g.beginPath(); g.ellipse(cx + Math.cos(a) * rx * wob, cy + Math.sin(a) * ry * wob, 2 + R() * 1.6, 1.6 + R(), R() * TAU, 0, TAU); g.fill();
    }
    // 冠底垂叶（叶幕下缘不齐）
    for (let i = 0; i < o.dripN; i++) {
      g.fillStyle = PAL[1 + ((R() * 2) | 0)];
      g.beginPath(); g.ellipse(cx + (R() - .5) * rx * 1.5, cy + ry * (.82 + R() * .2), 2.2 + R() * 1.4, 2.8 + R() * 1.8, (R() - .5) * .8, 0, TAU); g.fill();
    }
  }

  function obstacleArt(type, variant, world) {
    // v1.3 world：{ season, tier } —— 季节与地图差异化（缺省 summer/t1，向后兼容）
    const season = (world && world.season) || 'summer';
    const tier = (world && world.tier) || 1;
    const key = 'o:' + type + ':' + variant + ':' + season + ':' + tier;
    if (cache.has(key)) return cache.get(key);
    const S = 256;                            // 2x 超采样输出
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    g.scale(2, 2);                            // 设计坐标系仍为 128
    const R = rng(0xF00BA + variant * 7919 + [...type].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 13) + season.length * 131 + tier * 977);
    const GX = 64, GY = 112;                 // 地面接触点（设计系）
    const TAU = Math.PI * 2;
    const thin = season === 'winter' ? WINTER_THIN : 1;   // 冬季叶幕稀疏
    const PAL = tintPal(TREE_PAL[season] || TREE_PAL.summer, tier);

    // 接触暗斑（根部 AO）
    const ao = g.createRadialGradient(GX, GY - 2, 2, GX, GY - 2, 26);
    ao.addColorStop(0, 'rgba(6,12,8,.42)'); ao.addColorStop(1, 'rgba(6,12,8,0)');
    g.fillStyle = ao; g.beginPath(); g.ellipse(GX, GY - 2, 26, 9, 0, 0, TAU); g.fill();

    // ---------- 树 v3：季节 × 地图 × 5 变体（圆冠/高瘦/开张双层/垂枝/双干） ----------
    if (type === 'tree') {
      // 冬季枝色更冷灰
      const bark = season === 'winter' ? ['#26201a', '#5a4a38', '#443628', '#1c1610'] : ['#2a1a0e', '#6d4522', '#54331a', '#20140a'];
      const drawTrunk = (bx, topY, w, rootW) => {
        const tg = g.createLinearGradient(bx - w, 0, bx + w, 0);
        tg.addColorStop(0, bark[0]); tg.addColorStop(.4, bark[1]); tg.addColorStop(.7, bark[2]); tg.addColorStop(1, bark[3]);
        g.fillStyle = tg;
        g.beginPath();
        g.moveTo(bx - rootW, GY + 1);
        g.quadraticCurveTo(bx - w, GY - 14, bx - w * .8, topY);
        g.lineTo(bx + w * .8, topY);
        g.quadraticCurveTo(bx + w, GY - 14, bx + rootW, GY + 1);
        g.closePath(); g.fill();
        // 树皮纹
        g.strokeStyle = 'rgba(18,11,6,.5)'; g.lineWidth = .8;
        for (let i = 0; i < 4; i++) {
          const x = bx - w * .6 + i * w * .4 + (R() - .5);
          g.beginPath(); g.moveTo(x, GY - 2); g.quadraticCurveTo(x + (R() - .5) * 2, GY - 14, x + (R() - .5) * 2.5, topY + 3); g.stroke();
        }
      };
      const crownOf = (v) => v === 1 ? { cx: GX, cy: GY - 66, rx: 25, ry: 33 }        // 高瘦
        : v === 2 ? { cx: GX - 3, cy: GY - 60, rx: 36, ry: 24 }                        // 开张
        : v === 3 ? { cx: GX, cy: GY - 58, rx: 28, ry: 22 }                            // 垂枝（冠窄扁）
        : v === 4 ? { cx: GX - 13, cy: GY - 52, rx: 20, ry: 19 }                       // 双干左冠
        : { cx: GX, cy: GY - 60, rx: 31, ry: 27 };                                     // v0 圆冠
      const cr = crownOf(variant);
      const scaleN = (o) => { const n = {}; for (const k of ['darkN', 'midN', 'litN', 'gapN', 'rimN', 'dripN']) n[k] = Math.max(3, Math.round((o[k] ?? { darkN: 84, midN: 64, litN: 38, gapN: 26, rimN: 22, dripN: 10 }[k]) * thin)); return n; };
      const trunkW = 4 + (variant % 3) * .6;
      // 双干变体：两根干各顶一冠
      if (variant === 4) {
        drawTrunk(GX - 13, GY - 40, trunkW * .85, trunkW * 1.9);
        drawTrunk(GX + 11, GY - 44, trunkW * .8, trunkW * 1.8);
      } else {
        drawTrunk(GX, variant === 1 ? GY - 36 : GY - 32, trunkW, trunkW * 2.4 + variant % 2);
      }
      // 伸进树冠的枝
      g.strokeStyle = season === 'winter' ? '#4a3d2c' : '#4a2f18'; g.lineCap = 'round';
      [[-1, 5], [0, 4], [1, 3.5]].forEach(([dx, w], i) => {
        g.lineWidth = w;
        g.beginPath();
        g.moveTo(GX + dx * 2, GY - 28);
        g.quadraticCurveTo(GX + dx * 10, cr.cy + 8 + i * 2, cr.cx + dx * cr.rx * .55, cr.cy + 5);
        g.stroke();
      });
      // 叶簇云（冬季 ×0.62 稀疏——秃感；垂枝变体 dripN 加倍）
      drawFoliageCloud(g, R, TAU, PAL, cr.cx, cr.cy, cr.rx, cr.ry,
        scaleN(variant === 2 ? { darkN: 96, midN: 72, litN: 44 } : variant === 3 ? { dripN: 26 } : variant === 3 ? {} : {}));
      // 变体专属副冠
      if (variant === 2) drawFoliageCloud(g, R, TAU, PAL, GX - 26, GY - 44, 15, 11, scaleN({ darkN: 22, midN: 16, litN: 8, gapN: 6, rimN: 5, dripN: 4 }));
      if (variant === 4) drawFoliageCloud(g, R, TAU, PAL, GX + 11, GY - 52, 16, 16, scaleN({ darkN: 40, midN: 30, litN: 16, gapN: 8, rimN: 8, dripN: 6 }));
      if (variant === 3) {                                              // 垂枝：柳条垂帘
        g.strokeStyle = PAL[3]; g.lineWidth = 1.6;
        for (let i = 0; i < 16; i++) {
          const x0 = cr.cx + (R() - .5) * cr.rx * 1.8;
          const len = 14 + R() * 16;
          g.beginPath(); g.moveTo(x0, cr.cy + cr.ry * .4);
          g.quadraticCurveTo(x0 + (R() - .5) * 6, cr.cy + cr.ry * .4 + len * .6, x0 + (R() - .5) * 10, cr.cy + cr.ry * .4 + len);
          g.stroke();
        }
      }
      // 季节装饰（花斑/红叶/雪覆）
      seasonDeco(g, R, TAU, season, cr.cx, cr.cy, cr.rx, cr.ry);
      if (variant === 4) seasonDeco(g, R, TAU, season, GX + 11, GY - 52, 16, 16);
      // 冬季：地面落雪圈
      if (season === 'winter') {
        g.fillStyle = 'rgba(232,240,242,.5)';
        g.beginPath(); g.ellipse(GX, GY - 1, 24, 5, 0, 0, TAU); g.fill();
      }
    }

    // ---------- 枯树 v2：递归分枝两层 + 木纹 + 基部草 ----------
    else if (type === 'deadTree') {
      g.lineCap = 'round';
      // 递归分枝：每段干向上分 2-3 根子枝，子枝再细分
      const branch = (x0, y0, x1, y1, w, depth) => {
        const grad = g.createLinearGradient(x0 - w, y0, x0 + w, y0);
        grad.addColorStop(0, '#20160c'); grad.addColorStop(.5, '#6b5138'); grad.addColorStop(1, '#1a120a');
        g.strokeStyle = grad; g.lineWidth = Math.max(.8, w);
        const mx = (x0 + x1) / 2 + (R() - .5) * 8, my = (y0 + y1) / 2 + (R() - .5) * 4;
        g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(mx, my, x1, y1); g.stroke();
        if (depth > 0) {
          const n = 2 + ((R() * 2) | 0);
          for (let i = 0; i < n; i++) {
            const t = .5 + R() * .45;                       // 从父枝中后段分出
            const bx = x0 + (x1 - x0) * t, by = y0 + (y1 - y0) * t;
            const spread = (R() - .5) * 34;
            const len = 10 + R() * 12;
            branch(bx, by, bx + spread, by - len, w * .45, depth - 1);
          }
        }
      };
      // 主干 + 两根一级枝（变体：0 完整枯树 / 1 折断残干）
      const topY = variant === 1 ? GY - 34 : GY - 52;
      branch(GX, GY, GX + (R() - .5) * 4, topY, variant === 1 ? 9 : 7, variant === 1 ? 1 : 2);
      if (variant === 0) {
        branch(GX, GY - 32, GX - 18 - R() * 6, GY - 50 - R() * 8, 4.5, 1);
        branch(GX + 1, GY - 38, GX + 17 + R() * 5, GY - 58 - R() * 6, 3.8, 1);
      } else {
        // 折断口（顶端撕裂面）
        g.fillStyle = '#8a6d4e';
        g.beginPath(); g.ellipse(GX + 1, GY - 34, 4.5, 1.6, .1, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(30,20,10,.7)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(GX - 3, GY - 34); g.lineTo(GX - 1, GY - 31); g.moveTo(GX + 3, GY - 34); g.lineTo(GX + 1.5, GY - 31); g.stroke();
      }
      // 木纹（沿主干）
      g.strokeStyle = 'rgba(16,10,6,.55)'; g.lineWidth = .7;
      for (let i = 0; i < 3; i++) {
        const x = GX - 2 + i * 2;
        g.beginPath(); g.moveTo(x, GY - 4); g.quadraticCurveTo(x + (R() - .5) * 2, GY - 18, x + (R() - .5) * 3, GY - 30); g.stroke();
      }
      // 残叶几簇（末日感：活着的证据）——也用碎簇不用实心圆
      const leafPal = ['#3d5c2a', '#4d7334', '#63893f'];
      for (let i = 0; i < 4; i++) {
        const lx = GX - 16 - variant * 4 + R() * 30, ly = GY - 38 - R() * 14;
        for (let j = 0; j < 5; j++) {
          g.fillStyle = leafPal[(R() * 3) | 0];
          g.beginPath(); g.ellipse(lx + (R() - .5) * 7, ly + (R() - .5) * 6, 1.6 + R(), 1 + R() * .7, R() * 3, 0, TAU); g.fill();
        }
      }
      // 基部枯草
      g.strokeStyle = '#5a5136'; g.lineWidth = .9;
      for (let i = 0; i < 9; i++) {
        const gx = GX - 12 + R() * 24;
        g.beginPath(); g.moveTo(gx, GY); g.quadraticCurveTo(gx + (R() - .5) * 4, GY - 4, gx + (R() - .5) * 7, GY - 7 - R() * 4); g.stroke();
      }
    }

    // ---------- 岩石 v2：多面体 + 表面噪点 + 石英脉 + 裂纹青苔 ----------
    else if (type === 'rock') {
      const pts = [[-30, 2], [-24, -14], [-10, -28], [8, -30], [24, -18], [30, -2], [22, 10], [-14, 11]];
      const jit = pts.map(([x, y]) => [GX + x + (R() - .5) * 5, GY + y + (R() - .5) * 4]);
      const poly = (arr) => { g.beginPath(); arr.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fill(); };
      // 主体暗面
      g.fillStyle = '#3b3f47'; poly(jit);
      // 受光面（左上）
      g.fillStyle = '#667079'; poly([jit[0], jit[1], jit[2], jit[3], [GX + 2, GY - 12], [GX - 10, GY - 6]]);
      // 顶部高光
      g.fillStyle = '#8996a3'; poly([jit[1], jit[2], jit[3], [GX - 2, GY - 16]]);
      // 棱线（亮脊）
      g.strokeStyle = 'rgba(210,226,238,.4)'; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(jit[1][0], jit[1][1]); g.lineTo(jit[2][0], jit[2][1]); g.lineTo(jit[3][0], jit[3][1]); g.stroke();
      // 表面噪点（60 颗明暗矿物斑——去「塑料平涂」）
      for (let i = 0; i < 60; i++) {
        const a = R() * TAU, dd = Math.sqrt(R()) * .92;
        const x = GX + Math.cos(a) * 26 * dd, y = GY - 10 + Math.sin(a) * 20 * dd;
        g.fillStyle = R() < .55 ? `rgba(18,20,26,${.14 + R() * .22})` : `rgba(180,196,212,${.1 + R() * .18})`;
        g.beginPath(); g.arc(x, y, .6 + R() * 1, 0, TAU); g.fill();
      }
      // 石英脉（一道斜穿亮脉）
      g.strokeStyle = 'rgba(200,212,224,.32)'; g.lineWidth = 1.6 + R() * .8;
      const vx = GX - 14 + R() * 10;
      g.beginPath(); g.moveTo(vx, GY - 26 - R() * 4); g.quadraticCurveTo(vx + 8, GY - 12, vx + 3, GY + 4); g.stroke();
      // 裂纹（暗折线）
      g.strokeStyle = 'rgba(12,14,18,.62)'; g.lineWidth = 1.3;
      g.beginPath(); g.moveTo(GX + 8, GY - 24); g.lineTo(GX + 3, GY - 10); g.lineTo(GX + 11, GY + 2); g.stroke();
      // 苔藓：底部沿裂纹蔓延（不只铺底）
      for (let i = 0; i < 18; i++) {
        const t = R();
        const mx = t < .5 ? GX - 24 + R() * 48 : GX + 3 + (R() - .5) * 14;   // 底部带 + 裂纹带
        const my = t < .5 ? GY - 5 + R() * 13 : GY - 12 + (R() - .5) * 12;
        g.fillStyle = `rgba(${86 + R() * 30 | 0},${116 + R() * 26 | 0},${52 + R() * 18 | 0},${.28 + R() * .32})`;
        g.beginPath(); g.ellipse(mx, my, 2 + R() * 2, 1.4 + R() * 1.2, R() * 3, 0, TAU); g.fill();
      }
    }

    // ---------- 灌木 v3：小叶簇云 + 木质骨架 + 浆果（季节调色板） ----------
    else if (type === 'bush') {
      const bPAL = PAL.map((c, i) => i > 0 ? c : c);   // 与树共享季节×tier 调色板
      const bCx = GX, bCy = GY - 12, bRx = 24 + variant * 3, bRy = 13 + variant;
      // 底部枝条（灌木木质骨架——从土里岔出；冬季更秃露）
      g.strokeStyle = season === 'winter' ? '#4a4034' : '#4a3018'; g.lineCap = 'round';
      const nBranch = season === 'winter' ? 7 : 5;
      for (let i = 0; i < nBranch; i++) {
        g.lineWidth = 2.4 - i * .35;
        const bx = GX - 8 + i * 4;
        g.beginPath(); g.moveTo(bx, GY - 1);
        g.quadraticCurveTo(bx + (R() - .5) * 8, bCy + 4, bx + (R() - .5) * 16, bCy - 3 - R() * 5);
        g.stroke();
      }
      // 叶簇云（小规模；冬季稀疏）
      const bScale = { darkN: 40, midN: 30, litN: 16, gapN: 10, rimN: 9, dripN: 6 };
      for (const k in bScale) bScale[k] = Math.max(3, Math.round(bScale[k] * thin));
      drawFoliageCloud(g, R, TAU, bPAL, bCx, bCy, bRx, bRy, bScale);
      // 季节装饰 + 浆果（仅春结果——浆果是春实）
      seasonDeco(g, R, TAU, season, bCx, bCy, bRx, bRy);
      const berryN = season === 'spring' ? 7 + variant * 3 : season === 'autumn' ? 4 : 0;
      for (let i = 0; i < berryN; i++) {
        const a = R() * TAU, dd = Math.sqrt(R()) * .85;
        const x = bCx + Math.cos(a) * bRx * dd, y = bCy + Math.sin(a) * bRy * dd;
        g.fillStyle = R() < .6 ? '#a83a3a' : '#c05a3a';
        g.beginPath(); g.arc(x, y, 1.5, 0, TAU); g.fill();
        g.fillStyle = 'rgba(255,222,204,.75)';
        g.beginPath(); g.arc(x - .5, y - .5, .55, 0, TAU); g.fill();
      }
    }

    // ---------- 干草垛 ----------
    else if (type === 'hay') {
      const hg = g.createLinearGradient(0, GY - 46, 0, GY + 4);
      hg.addColorStop(0, '#d9b455'); hg.addColorStop(.6, '#b0823a'); hg.addColorStop(1, '#6e4a1e');
      g.fillStyle = hg;
      g.beginPath(); g.roundRect(GX - 30, GY - 40, 60, 44, 10); g.fill();
      // 草纹（横向弧线）
      g.strokeStyle = 'rgba(240,214,120,.55)'; g.lineWidth = 1.4;
      for (let y = GY - 34; y < GY + 2; y += 6) {
        g.beginPath(); g.moveTo(GX - 26, y); g.quadraticCurveTo(GX, y + 3, GX + 26, y - 2); g.stroke();
      }
      // 阴影纹 + 捆扎线
      g.strokeStyle = 'rgba(90,58,22,.5)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(GX - 8, GY - 40); g.lineTo(GX - 8, GY + 4); g.stroke();
      g.beginPath(); g.moveTo(GX + 10, GY - 40); g.lineTo(GX + 10, GY + 4); g.stroke();
      // 顶部散草
      g.strokeStyle = '#e6c76a'; g.lineWidth = 1.2;
      for (let i = 0; i < 10; i++) { const x = GX - 22 + R() * 44; g.beginPath(); g.moveTo(x, GY - 38); g.lineTo(x + (R() - .5) * 6, GY - 46 - R() * 6); g.stroke(); }
    }

    // ---------- 栅栏 ----------
    else if (type === 'fence') {
      const post = (x) => {
        const pg = g.createLinearGradient(x - 5, 0, x + 5, 0);
        pg.addColorStop(0, '#3a2612'); pg.addColorStop(.5, '#7c5528'); pg.addColorStop(1, '#2c1d0e');
        g.fillStyle = pg; g.fillRect(x - 5, GY - 44, 10, 48);
        g.fillStyle = '#54381a'; g.fillRect(x - 6, GY - 48, 12, 5);        // 柱顶帽
        g.strokeStyle = 'rgba(24,14,6,.5)'; g.lineWidth = 1;              // 木纹
        g.beginPath(); g.moveTo(x - 1, GY - 40); g.lineTo(x - 1, GY - 6); g.stroke();
        g.beginPath(); g.arc(x + 2, GY - 22, 1.6, 0, TAU); g.fillStyle = '#2c1d0e'; g.fill(); // 节疤
      };
      post(GX - 26); post(GX + 26);
      // 横杆（两根）
      [[GY - 34], [GY - 16]].forEach(([y]) => {
        const rg = g.createLinearGradient(0, y - 5, 0, y + 5);
        rg.addColorStop(0, '#96693a'); rg.addColorStop(1, '#4a2f16');
        g.fillStyle = rg; g.fillRect(GX - 36, y - 5, 72, 10);
        g.fillStyle = 'rgba(255,222,170,.25)'; g.fillRect(GX - 34, y - 4, 68, 2);
      });
    }

    // ---------- 废墟残墙：砖缝 + 断口 + 苔藓 ----------
    else if (type === 'ruin') {
      // 主体（透视两面）
      g.fillStyle = '#5a4636'; g.fillRect(GX - 30, GY - 44, 52, 50);
      const top = g.createLinearGradient(0, GY - 58, 0, GY - 44);
      top.addColorStop(0, '#8a6a52'); top.addColorStop(1, '#6b5240');
      g.fillStyle = top;
      g.beginPath(); g.moveTo(GX - 30, GY - 44); g.lineTo(GX - 20, GY - 56); g.lineTo(GX + 32, GY - 56); g.lineTo(GX + 22, GY - 44); g.closePath(); g.fill();
      g.fillStyle = '#42312a';
      g.beginPath(); g.moveTo(GX + 22, GY - 44); g.lineTo(GX + 32, GY - 56); g.lineTo(GX + 32, GY - 6); g.lineTo(GX + 22, GY + 6); g.closePath(); g.fill();
      // 砖缝
      g.strokeStyle = 'rgba(200,160,120,.32)'; g.lineWidth = 1.4;
      for (let y = GY - 36; y < GY + 4; y += 11) { g.beginPath(); g.moveTo(GX - 27, y); g.lineTo(GX + 19, y); g.stroke(); }
      for (let i = 0; i < 3; i++) { const x = GX - 16 + i * 15; g.beginPath(); g.moveTo(x, GY - 36 + ((i * 5) % 11)); g.lineTo(x, GY - 36 + ((i * 5) % 11) + 11); g.stroke(); }
      // 顶部断口（参差）
      g.fillStyle = '#2f231d';
      g.beginPath(); g.moveTo(GX - 20, GY - 56); g.lineTo(GX - 14, GY - 60); g.lineTo(GX - 6, GY - 55); g.lineTo(GX + 4, GY - 61); g.lineTo(GX + 14, GY - 55); g.lineTo(GX + 22, GY - 58); g.lineTo(GX + 32, GY - 56); g.lineTo(GX + 32, GY - 52); g.lineTo(GX - 20, GY - 52); g.closePath(); g.fill();
      // 苔藓（底部+侧缝）
      for (let i = 0; i < 16; i++) {
        g.fillStyle = `rgba(96,130,62,${.2 + R() * .28})`;
        g.beginPath(); g.ellipse(GX - 26 + R() * 52, GY - 6 + R() * 8, 2.6 + R() * 2, 1.6 + R(), R() * 3, 0, TAU); g.fill();
      }
      if (variant === 1) { g.fillStyle = 'rgba(96,130,62,.35)'; g.beginPath(); g.ellipse(GX + 18, GY - 40, 6, 10, .4, 0, TAU); g.fill(); }
    }

    // ---------- 石碑：符文发光 ----------
    else if (type === 'monolith') {
      const body = g.createLinearGradient(GX - 20, 0, GX + 22, 0);
      body.addColorStop(0, '#232135'); body.addColorStop(.5, '#3d3a5c'); body.addColorStop(1, '#1a1828');
      g.fillStyle = body;
      g.beginPath(); g.moveTo(GX - 18, GY); g.lineTo(GX - 14, GY - 56); g.lineTo(GX + 8, GY - 66 + variant * 4); g.lineTo(GX + 20, GY - 10); g.closePath(); g.fill();
      // 顶面受光
      g.fillStyle = '#5d5884';
      g.beginPath(); g.moveTo(GX - 14, GY - 56); g.lineTo(GX + 8, GY - 66 + variant * 4); g.lineTo(GX + 2, GY - 52); g.lineTo(GX - 10, GY - 45); g.closePath(); g.fill();
      // 符文（紫光刻痕，发光）
      g.strokeStyle = '#b89cff'; g.lineWidth = 2; g.shadowColor = '#b89cff'; g.shadowBlur = 6;
      g.beginPath(); g.moveTo(GX - 2, GY - 48); g.lineTo(GX + 5, GY - 36); g.lineTo(GX - 4, GY - 22); g.lineTo(GX + 3, GY - 10); g.stroke();
      g.shadowBlur = 0;
      g.fillStyle = 'rgba(200,180,255,.9)';
      g.beginPath(); g.arc(GX + 4, GY - 36, 1.6, 0, TAU); g.fill();
      // 裂纹
      g.strokeStyle = 'rgba(10,8,18,.7)'; g.lineWidth = 1.3;
      g.beginPath(); g.moveTo(GX - 10, GY - 30); g.lineTo(GX - 4, GY - 20); g.lineTo(GX - 9, GY - 8); g.stroke();
    }

    // ---------- 水晶簇（普通紫 / 毒绿） ----------
    else {
      const toxic = type === 'toxicCrystal';
      const base = toxic ? '#3d7a30' : '#524191';
      const mid = toxic ? '#6cc24a' : '#8a6fd0';
      const light = toxic ? '#c8f56e' : '#d6c0ff';
      const glow = toxic ? 'rgba(160,240,90,.5)' : 'rgba(190,150,255,.5)';
      // 底岩
      g.fillStyle = '#33363d';
      g.beginPath(); g.ellipse(GX, GY - 2, 26, 8, 0, 0, TAU); g.fill();
      g.fillStyle = '#4a4e57';
      g.beginPath(); g.ellipse(GX - 4, GY - 5, 20, 6, 0, 0, TAU); g.fill();
      // 晶簇（三主晶 + 两小晶），各两面体
      const spikes = [[-15, -36, -8, 2, 0], [2, -50, 9, 5, 1], [14, -30, 22, 4, 2], [-24, -22, -19, 1, 3], [19, -18, 25, 2, 4]];
      spikes.forEach(([x0, y0, x1, y1], i) => {
        const w = 7 - i * .8;
        g.fillStyle = base;
        g.beginPath(); g.moveTo(GX + x0 - w, GY + y1); g.lineTo(GX + x0, GY + y0); g.lineTo(GX + x1, GY + y1 + 4); g.closePath(); g.fill();
        g.fillStyle = mid;
        g.beginPath(); g.moveTo(GX + x0, GY + y0); g.lineTo(GX + x1, GY + y1 + 4); g.lineTo(GX + x1 - w * .4, GY + y1 + 5); g.closePath(); g.fill();
        // 棱线高光
        g.strokeStyle = light; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(GX + x0, GY + y0); g.lineTo(GX + x1 - w * .2, GY + y1 + 4); g.stroke();
      });
      // 内发光（大晶）
      g.fillStyle = glow;
      g.beginPath(); g.moveTo(GX - 6, GY - 30); g.lineTo(GX + 2, GY - 46); g.lineTo(GX + 7, GY - 30); g.closePath(); g.fill();
      // 微粒光点（能量浮尘）
      g.fillStyle = light;
      for (let i = 0; i < 5; i++) { g.globalAlpha = .4 + R() * .5; g.beginPath(); g.arc(GX - 20 + R() * 40, GY - 46 + R() * 40, .9 + R() * .8, 0, TAU); g.fill(); }
      g.globalAlpha = 1;
    }

    cache.set(key, c);
    return c;
  }

  // ---- 世界实体烘焙（v1.3）：替代 emoji 图标，统一末日废土美术语言 ----
  // 设计坐标系 128（g.scale(2,2) → 256px 输出），接触点 (64,112)。
  // 防御塔：石砌哨塔四状态（neutral 旧哨塔 / enemy 红旗 / player 绿旗+水晶 / broken 断塔）
  // 防御塔 v2（v5.8.9 美术重制）：石砌占领哨塔四状态
  // 防御塔 v3（v5.8.16 竞品逆向重制）：AI 生图（LOL 式浮晶石碑塔）+ 洋红抠像管线，tools/gen-tower-art.py
  //   状态信号：塔顶浮晶颜色（琥珀=中立 / 绿=玩家 / 红=敌方 / 碎晶=摧毁）——王者/LOL 的第一状态信号
  //   布局：塔基接触点 (128,224)，与旧版 drawImage(sx-44, sy-44*1.75+16, 88, 88) 完全兼容
  const towerAiImgs = {};
  (function preloadTowerArt() {
    ['neutral', 'player', 'enemy', 'broken'].forEach(s => {
      const im = new Image();
      im.onload = () => { towerAiImgs[s] = im; cache.delete('w:tower:' + s); };
      im.onerror = () => { /* 图片缺失时保持程序化回退 */ };
      im.src = 'assets/towers/tower_' + s + '.png';
    });
  })();

  // ---- P12-d 交互物件 AI 厚涂立绘（AI 优先 + 程序化兜底，开关 farmArt2D_P12，默认开）----
  // 统一暗黑废土厚涂、高角度俯视微斜视、纯色洋红底抠像（tools/gen-prop-art.py），
  // 接触点 226/256，与塔 v3 一致；图片缺失/关开关时自动回退下方程序化绘制。
  const ART2D_P12 = (() => {
    try { return !/^(0|off|false|no)$/i.test(localStorage.getItem('farmArt2D_P12') || '1'); }
    catch (e) { return true; }
  })();
  const propAiImgs = {};
  (function preloadPropArtP12() {
    if (!ART2D_P12) return;
    const P12_PROPS = {
      'w:chest:c': 'assets/art2d/chest_closed.png',
      'w:chest:o': 'assets/art2d/chest_open.png',
      'w:fire': 'assets/art2d/campfire.png',
      'w:merch': 'assets/art2d/merchant.png',
      'w:raider': 'assets/art2d/raider.png',
      'w:portal': 'assets/art2d/portal.png',
      'ally:kael': 'assets/art2d/ally_kael.png',
      'ally:lore': 'assets/art2d/ally_lore.png',
      'ally:chen': 'assets/art2d/ally_chen.png',
      'ally:miao': 'assets/art2d/ally_miao.png'
    };
    Object.keys(P12_PROPS).forEach(k => {
      const im = new Image();
      im.onload = () => { propAiImgs[k] = im; cache.delete(k); };
      im.onerror = () => { /* 图片缺失时保持程序化回退 */ };
      im.src = P12_PROPS[k];
    });
  })();
  // 合成 AI 主体 + 接触 AO（落地感）；返回 null 表示未就绪，调用方走程序化兜底。
  function propAiCanvas(key, aoRx) {
    const im = propAiImgs[key];
    if (!im) return null;
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    const y = 226, rx = aoRx || 50;
    const ao = g.createRadialGradient(128, y, 6, 128, y, rx);
    ao.addColorStop(0, 'rgba(8,12,8,.42)'); ao.addColorStop(1, 'rgba(8,12,8,0)');
    g.fillStyle = ao;
    g.beginPath(); g.ellipse(128, y, rx, rx * .28, 0, 0, Math.PI * 2); g.fill();
    g.drawImage(im, 0, 0);
    return c;
  }

  // 设计目标：状态可读性优先——旗/垛口染色带/窗灯三重状态信号，实战 88px 下一眼分清敌我
  // 受光：左上主光，三值面（亮/中/暗）硬切替代糊渐变；接触 AO 落地
  function towerArt(state) {
    const key = 'w:tower:' + state;
    if (cache.has(key)) return cache.get(key);
    // v3：AI 贴图就绪 → 合成 AI 主体 + 接触 AO（落地感），图片缺失自动走下方程序化旧版
    if (towerAiImgs[state]) {
      const c3 = document.createElement('canvas'); c3.width = c3.height = 256;
      const g3 = c3.getContext('2d');
      const ao3 = g3.createRadialGradient(128, 226, 6, 128, 226, 52);
      ao3.addColorStop(0, 'rgba(8,12,8,.45)'); ao3.addColorStop(1, 'rgba(8,12,8,0)');
      g3.fillStyle = ao3;
      g3.beginPath(); g3.ellipse(128, 226, 52, 15, 0, 0, Math.PI * 2); g3.fill();
      g3.drawImage(towerAiImgs[state], 0, 0);
      cache.set(key, c3);
      return c3;
    }
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'); g.scale(2, 2);
    const R = rng(0x7053 + state.length * 6151);
    const TAU = Math.PI * 2, GX = 64, GY = 112;
    const broken = state === 'broken';
    const topY = broken ? GY - 50 : GY - 72;                 // 断塔矮一截（v2 收 6px 给塔顶旗/水晶留画布空间）
    // 状态色（旗大、垛口带、窗灯三处呼应）
    const ST = {
      neutral: { flag: '#c8b47a', flagLo: '#9a8a58', glow: '#d9a94e', trim: '#8a7c4e' },
      enemy:   { flag: '#e04a38', flagLo: '#a32d24', glow: '#ff6a4a', trim: '#b03a2c' },
      player:  { flag: '#4ecb6e', flagLo: '#2f9448', glow: '#6fe88a', trim: '#37a352' },
      broken:  { flag: null, flagLo: null, glow: null, trim: null }
    }[state];
    const stoneHi = '#83899a', stoneMid = '#5d626f', stoneLo = '#3a3e49', edge = '#23252c';

    // 接触 AO（落地感）
    const ao = g.createRadialGradient(GX, GY + 2, 4, GX, GY + 2, 36);
    ao.addColorStop(0, 'rgba(8,12,8,.42)'); ao.addColorStop(1, 'rgba(8,12,8,0)');
    g.fillStyle = ao; g.beginPath(); g.ellipse(GX, GY + 2, 36, 12, 0, 0, TAU); g.fill();

    // 石砌台基（两级台阶）
    g.fillStyle = '#33363e'; g.beginPath(); g.ellipse(GX, GY, 34, 11, 0, 0, TAU); g.fill();
    g.fillStyle = '#4a4e58'; g.beginPath(); g.ellipse(GX, GY - 4, 28, 8.5, 0, 0, TAU); g.fill();
    g.fillStyle = '#565b66'; g.beginPath(); g.ellipse(GX, GY - 6, 24, 7, 0, 0, TAU); g.fill();
    g.strokeStyle = edge; g.lineWidth = 1; g.beginPath(); g.ellipse(GX, GY - 4, 28, 8.5, 0, 0, TAU); g.stroke();

    // 塔身三值面：正面（中）+ 左受光（亮）+ 右背光（暗），硬切棱面
    const bhwB = 24, bhwT = 16;                               // 底/顶半宽
    g.fillStyle = stoneMid;
    g.beginPath(); g.moveTo(GX - bhwB, GY - 4); g.lineTo(GX - bhwT, topY); g.lineTo(GX + bhwT, topY); g.lineTo(GX + bhwB, GY - 4); g.closePath(); g.fill();
    g.fillStyle = stoneHi;                                     // 左受光窄面
    g.beginPath(); g.moveTo(GX - bhwB, GY - 4); g.lineTo(GX - bhwT, topY); g.lineTo(GX - bhwT + 5, topY); g.lineTo(GX - bhwB + 7, GY - 4); g.closePath(); g.fill();
    g.fillStyle = stoneLo;                                     // 右背光窄面
    g.beginPath(); g.moveTo(GX + bhwT, topY); g.lineTo(GX + bhwB, GY - 4); g.lineTo(GX + bhwB - 6, GY - 4); g.lineTo(GX + bhwT - 2, topY); g.closePath(); g.fill();
    g.strokeStyle = edge; g.lineWidth = 1;
    g.beginPath(); g.moveTo(GX - bhwB, GY - 4); g.lineTo(GX - bhwT, topY); g.lineTo(GX + bhwT, topY); g.lineTo(GX + bhwB, GY - 4); g.closePath(); g.stroke();

    // 砖缝（形状化：暗缝 + 上缘高光，少量竖错缝）
    for (let y = topY + 9; y < GY - 6; y += 9) {
      const k = (GY - 4 - y) / (GY - 4 - topY);               // 0 底 → 1 顶
      const hw = bhwB + (bhwT - bhwB) * k;
      g.strokeStyle = 'rgba(20,22,30,.55)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(GX - hw + 2, y); g.lineTo(GX + hw - 2, y); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.10)';
      g.beginPath(); g.moveTo(GX - hw + 2, y - 1); g.lineTo(GX + hw - 2, y - 1); g.stroke();
    }
    for (let i = 0; i < 3; i++) {
      const y = topY + 12 + i * 20, k = (GY - 4 - y) / (GY - 4 - topY), hw = bhwB + (bhwT - bhwB) * k;
      const x = GX - 10 + i * 11 + (R() * 4 - 2);
      g.strokeStyle = 'rgba(20,22,30,.4)';
      g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 7); g.stroke();
    }

    if (!broken) {
      // 状态色腰带（垛口下沿一圈——第二重状态信号）
      g.fillStyle = ST.trim;
      g.fillRect(GX - bhwT - 2, topY + 2, (bhwT + 2) * 2, 4);
      g.fillStyle = 'rgba(255,255,255,.16)';
      g.fillRect(GX - bhwT - 2, topY + 2, (bhwT + 2) * 2, 1);

      // 瞭望垛口（内侧面染状态色）
      g.fillStyle = stoneMid; g.fillRect(GX - 21, topY - 10, 42, 9);
      g.fillStyle = stoneHi; g.fillRect(GX - 21, topY - 10, 42, 2);
      g.fillStyle = stoneLo; g.fillRect(GX + 15, topY - 10, 6, 9);
      g.strokeStyle = edge; g.strokeRect(GX - 21, topY - 10, 42, 9);
      for (let i = 0; i < 5; i++) {
        g.fillStyle = i === 4 ? stoneLo : stoneMid;
        g.fillRect(GX - 21 + i * 9, topY - 17, 6, 7);
        g.fillStyle = ST.trim; g.fillRect(GX - 21 + i * 9, topY - 12, 6, 2);   // 垛口顶状态染色
        g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(GX - 21 + i * 9, topY - 17, 6, 1);
      }

      // 箭窗（发光灯——第三重状态信号，实战尺寸可见）
      g.fillStyle = edge; g.fillRect(GX - 5, topY + 12, 10, 15);
      g.fillStyle = ST.glow; g.shadowColor = ST.glow; g.shadowBlur = 7;
      g.fillRect(GX - 3, topY + 14, 6, 11); g.shadowBlur = 0;
      g.fillStyle = 'rgba(16,12,8,.55)'; g.fillRect(GX - 3, topY + 21, 6, 1.6);

      // 旗杆 + 大旗（主状态信号：面积≈旧版 2.5 倍，带缺口燕尾）
      g.strokeStyle = '#2a2620'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(GX - 8, topY - 17); g.lineTo(GX - 8, topY - 34); g.stroke();
      g.fillStyle = ST.flag;
      g.beginPath();
      g.moveTo(GX - 8, topY - 34);
      g.quadraticCurveTo(GX + 4, topY - 36, GX + 18, topY - 32);   // 上缘风飘
      g.lineTo(GX + 12, topY - 28);                                 // 燕尾缺口
      g.lineTo(GX + 18, topY - 24);
      g.quadraticCurveTo(GX + 4, topY - 21, GX - 8, topY - 22);
      g.closePath(); g.fill();
      g.fillStyle = ST.flagLo;                                      // 旗下缘折面
      g.beginPath(); g.moveTo(GX - 8, topY - 22); g.quadraticCurveTo(GX + 4, topY - 21, GX + 18, topY - 24); g.lineTo(GX + 16, topY - 22); g.quadraticCurveTo(GX + 4, topY - 19, GX - 8, topY - 20); g.closePath(); g.fill();

      if (state === 'player') {
        // 玩家塔：悬浮水晶（旗杆右侧对称位，错高构图避让旗帜）+ 能运光晕
        const cx = GX + 12, cy = topY - 22;
        g.fillStyle = 'rgba(159,242,180,.30)';
        g.beginPath(); g.ellipse(cx, cy, 10, 3.5, 0, 0, TAU); g.fill();
        g.fillStyle = '#9df2b4'; g.shadowColor = ST.glow; g.shadowBlur = 9;
        g.beginPath(); g.moveTo(cx - 4.5, cy); g.lineTo(cx, cy - 8); g.lineTo(cx + 4.5, cy); g.lineTo(cx, cy + 8); g.closePath(); g.fill();
        g.shadowBlur = 0;
        g.fillStyle = 'rgba(255,255,255,.5)';
        g.beginPath(); g.moveTo(cx - 2, cy - 1); g.lineTo(cx, cy - 5); g.lineTo(cx + 1.5, cy - 2); g.closePath(); g.fill();
      } else if (state === 'enemy') {
        // 敌塔：正面警示符文（双 Chevron）
        g.strokeStyle = 'rgba(255,106,74,.85)'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(GX - 9, topY + 34); g.lineTo(GX, topY + 40); g.lineTo(GX + 9, topY + 34); g.stroke();
        g.beginPath(); g.moveTo(GX - 9, topY + 42); g.lineTo(GX, topY + 48); g.lineTo(GX + 9, topY + 42); g.stroke();
      }
    } else {
      // 断塔：撕裂豁口 + 焦黑内壁 + 塌落碎石
      g.fillStyle = '#17181c';
      g.beginPath(); g.moveTo(GX - bhwT, topY); g.lineTo(GX - 6, topY - 7); g.lineTo(GX + 2, topY - 2); g.lineTo(GX + 9, topY - 8); g.lineTo(GX + bhwT, topY); g.closePath(); g.fill();
      g.strokeStyle = edge; g.lineWidth = 1;
      g.beginPath(); g.moveTo(GX - bhwB, GY - 4); g.lineTo(GX - bhwT, topY); g.moveTo(GX + bhwT, topY); g.lineTo(GX + bhwB, GY - 4); g.stroke();
      g.strokeStyle = 'rgba(20,22,30,.5)';
      g.beginPath(); g.moveTo(GX - 10, topY + 6); g.lineTo(GX - 6, topY + 22); g.moveTo(GX + 7, topY + 10); g.lineTo(GX + 11, topY + 30); g.stroke();
      for (let i = 0; i < 9; i++) {
        const rx = GX - 24 + R() * 48, ry = GY - 4 - R() * 11;
        g.fillStyle = R() < .5 ? '#4a4e58' : '#5d626f';
        g.beginPath(); g.ellipse(rx, ry, 3 + R() * 3.5, 2 + R() * 2, R() * 3, 0, TAU); g.fill();
        g.fillStyle = 'rgba(255,255,255,.10)';
        g.beginPath(); g.ellipse(rx - 1, ry - 1.5, 1.6, .8, 0, 0, TAU); g.fill();
      }
      g.fillStyle = edge; g.fillRect(GX - 4, topY + 14, 8, 12);    // 熄灭的窗
    }

    // 藤蔓（形状化两株，替代旧苔藓噪点）
    for (let v = 0; v < 2; v++) {
      const vx = v === 0 ? GX - bhwB + 6 : GX + bhwB - 9;
      g.strokeStyle = 'rgba(88,118,58,.75)'; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(vx, GY - 8); g.quadraticCurveTo(vx + (v ? 7 : -7), GY - 26, vx + (v ? 3 : -3), GY - 44); g.stroke();
      for (let l = 0; l < 3; l++) {
        g.fillStyle = `rgba(96,132,66,${.55 + l * .1})`;
        g.beginPath(); g.ellipse(vx + (v ? 4 : -4), GY - 16 - l * 11, 3.2, 1.8, v ? -.6 : .6, 0, TAU); g.fill();
      }
    }
    cache.set(key, c); return c;
  }

  // 宝箱（未开/已开）
  function chestArt(opened) {
    const key = 'w:chest:' + (opened ? 'o' : 'c');
    if (cache.has(key)) return cache.get(key);
    const _aiC = propAiCanvas(key, 46);
    if (_aiC) { cache.set(key, _aiC); return _aiC; }
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'); g.scale(2, 2);
    const R = rng(0x2A3F5);
    const TAU = Math.PI * 2, GX = 64, GY = 108;
    // 接触 AO
    const ao = g.createRadialGradient(GX, GY, 2, GX, GY, 24);
    ao.addColorStop(0, 'rgba(5,10,6,.4)'); ao.addColorStop(1, 'rgba(5,10,6,0)');
    g.fillStyle = ao; g.beginPath(); g.ellipse(GX, GY, 24, 8, 0, 0, TAU); g.fill();
    // 箱体（木板 + 金属包边）
    const wood = g.createLinearGradient(0, GY - 26, 0, GY);
    wood.addColorStop(0, '#8a6136'); wood.addColorStop(1, '#5d3f20');
    g.fillStyle = wood; g.fillRect(GX - 20, GY - 24, 40, 24);
    // 木板纹
    g.strokeStyle = 'rgba(30,18,8,.55)'; g.lineWidth = 1;
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(GX - 20, GY - 24 + i * 6); g.lineTo(GX + 20, GY - 24 + i * 6); g.stroke(); }
    // 金属包边 + 锁扣
    g.fillStyle = '#7a7368';
    g.fillRect(GX - 21, GY - 26, 4, 26); g.fillRect(GX + 17, GY - 26, 4, 26);
    if (!opened) {
      // 盖（拱形）
      const lid = g.createLinearGradient(0, GY - 40, 0, GY - 22);
      lid.addColorStop(0, '#9c6f3e'); lid.addColorStop(1, '#6d4a24');
      g.fillStyle = lid;
      g.beginPath(); g.moveTo(GX - 21, GY - 24); g.quadraticCurveTo(GX, GY - 42, GX + 21, GY - 24); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(30,18,8,.4)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(GX - 21, GY - 24); g.quadraticCurveTo(GX, GY - 42, GX + 21, GY - 24); g.stroke();
      // 锁扣（黄铜）
      g.fillStyle = '#c8a24e'; g.fillRect(GX - 3, GY - 27, 7, 8);
      g.fillStyle = '#8a6c26'; g.fillRect(GX - 1.5, GY - 24, 4, 4);
      // 微光缝隙（里面有东西）
      g.strokeStyle = 'rgba(255,224,150,.85)'; g.lineWidth = 1.2; g.shadowColor = '#ffe096'; g.shadowBlur = 4;
      g.beginPath(); g.moveTo(GX - 19, GY - 24); g.lineTo(GX + 19, GY - 24); g.stroke(); g.shadowBlur = 0;
    } else {
      // 开盖（向后掀开）+ 空腔
      g.fillStyle = '#3a2713'; g.fillRect(GX - 18, GY - 24, 36, 22);
      g.fillStyle = '#57492c'; g.fillRect(GX - 18, GY - 24, 36, 3);
      const lid = g.createLinearGradient(0, GY - 52, 0, GY - 34);
      lid.addColorStop(0, '#9c6f3e'); lid.addColorStop(1, '#6d4a24');
      g.fillStyle = lid;
      g.beginPath(); g.moveTo(GX - 4, GY - 30); g.lineTo(GX - 26, GY - 46); g.lineTo(GX - 4, GY - 50); g.lineTo(GX + 16, GY - 36); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(30,18,8,.4)';
      g.beginPath(); g.moveTo(GX - 4, GY - 30); g.lineTo(GX - 26, GY - 46); g.lineTo(GX - 4, GY - 50); g.lineTo(GX + 16, GY - 36); g.closePath(); g.stroke();
    }
    cache.set(key, c); return c;
  }

  // 篝火（石圈 + 柴堆 + 焰心；运行时叠加闪烁光晕）
  function campfireArt() {
    const key = 'w:fire';
    if (cache.has(key)) return cache.get(key);
    const _aiF = propAiCanvas(key, 56);
    if (_aiF) { cache.set(key, _aiF); return _aiF; }
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'); g.scale(2, 2);
    const R = rng(0xF1E7); const TAU = Math.PI * 2, GX = 64, GY = 106;
    // 光池（暖色地面光溢）
    const glow = g.createRadialGradient(GX, GY - 8, 2, GX, GY - 8, 34);
    glow.addColorStop(0, 'rgba(255,168,70,.5)'); glow.addColorStop(1, 'rgba(255,168,70,0)');
    g.fillStyle = glow; g.beginPath(); g.ellipse(GX, GY - 6, 34, 13, 0, 0, TAU); g.fill();
    // 石圈
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * TAU;
      g.fillStyle = i % 2 ? '#565b62' : '#43474e';
      g.beginPath(); g.ellipse(GX + Math.cos(a) * 16, GY + Math.sin(a) * 7, 4.5, 3, a, 0, TAU); g.fill();
    }
    // 交叉柴堆
    g.strokeStyle = '#4a3018'; g.lineCap = 'round'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(GX - 9, GY + 2); g.lineTo(GX + 7, GY - 12); g.stroke();
    g.beginPath(); g.moveTo(GX + 9, GY + 2); g.lineTo(GX - 7, GY - 12); g.stroke();
    g.strokeStyle = '#5d3f22'; g.lineWidth = 2.4;
    g.beginPath(); g.moveTo(GX - 6, GY - 2); g.lineTo(GX + 5, GY - 11); g.stroke();
    // 焰心（三层：暗橙/亮橙/黄心）
    const flame = (h, w, col) => {
      g.fillStyle = col;
      g.beginPath(); g.moveTo(GX - w, GY - 10);
      g.quadraticCurveTo(GX - w * .7, GY - 10 - h * .55, GX, GY - 10 - h);
      g.quadraticCurveTo(GX + w * .7, GY - 10 - h * .55, GX + w, GY - 10);
      g.quadraticCurveTo(GX, GY - 4, GX - w, GY - 10);
      g.closePath(); g.fill();
    };
    flame(26, 9, 'rgba(226,88,32,.92)');
    flame(19, 6, 'rgba(252,148,54,.95)');
    flame(11, 3.5, '#ffe08a');
    // 火星
    g.fillStyle = '#ffce7a';
    for (let i = 0; i < 6; i++) { g.globalAlpha = .5 + R() * .5; g.beginPath(); g.arc(GX - 6 + R() * 12, GY - 20 - R() * 18, .8 + R() * .6, 0, TAU); g.fill(); }
    g.globalAlpha = 1;
    cache.set(key, c); return c;
  }

  // 商人（斗篷 + 背包 + 提灯）
  function merchantArt() {
    const key = 'w:merch';
    if (cache.has(key)) return cache.get(key);
    const _aiM = propAiCanvas(key, 44);
    if (_aiM) { cache.set(key, _aiM); return _aiM; }
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'); g.scale(2, 2);
    const TAU = Math.PI * 2, GX = 64, GY = 108;
    // 影
    g.fillStyle = 'rgba(5,10,6,.4)'; g.beginPath(); g.ellipse(GX, GY, 15, 5, 0, 0, TAU); g.fill();
    // 斗篷身体（暗绿褐，末日行商）
    const cloak = g.createLinearGradient(GX - 12, 0, GX + 12, 0);
    cloak.addColorStop(0, '#3d4a34'); cloak.addColorStop(.5, '#5c6e4a'); cloak.addColorStop(1, '#2c3626');
    g.fillStyle = cloak;
    g.beginPath(); g.moveTo(GX - 13, GY); g.quadraticCurveTo(GX - 15, GY - 26, GX - 6, GY - 36);
    g.lineTo(GX + 6, GY - 36); g.quadraticCurveTo(GX + 15, GY - 26, GX + 13, GY); g.closePath(); g.fill();
    // 兜帽头
    g.fillStyle = '#4a5a3c';
    g.beginPath(); g.arc(GX, GY - 40, 7.5, 0, TAU); g.fill();
    g.fillStyle = '#1a2016';
    g.beginPath(); g.arc(GX + 1.5, GY - 39.5, 5, 0, TAU); g.fill();       // 面部阴影
    g.fillStyle = '#c8a24e';                                                // 一只眼（提灯反光）
    g.beginPath(); g.arc(GX + 3.5, GY - 40, 1.1, 0, TAU); g.fill();
    // 大背包
    g.fillStyle = '#6d5230';
    g.beginPath(); g.ellipse(GX - 10, GY - 24, 8, 13, -.25, 0, TAU); g.fill();
    g.strokeStyle = '#4a3418'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(GX - 15, GY - 28); g.lineTo(GX - 5, GY - 28); g.moveTo(GX - 15, GY - 22); g.lineTo(GX - 5, GY - 22); g.stroke();
    // 背包上绑的卷轴/工具
    g.strokeStyle = '#8a8578'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(GX - 12, GY - 34); g.lineTo(GX - 6, GY - 33); g.stroke();
    // 提灯（暖光，右手）
    g.strokeStyle = '#3a2c18'; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(GX + 10, GY - 28); g.lineTo(GX + 13, GY - 20); g.stroke();
    g.fillStyle = '#ffca6e'; g.shadowColor = '#ffb84e'; g.shadowBlur = 6;
    g.fillRect(GX + 10.5, GY - 20, 5, 7); g.shadowBlur = 0;
    g.strokeStyle = '#5c4a28'; g.lineWidth = 1;
    g.strokeRect(GX + 10.5, GY - 20, 5, 7);
    cache.set(key, c); return c;
  }

  // 掠夺者（兜帽刺客剪影 + 匕首）
  function raiderArt() {
    const key = 'w:raider';
    if (cache.has(key)) return cache.get(key);
    const _aiR = propAiCanvas(key, 44);
    if (_aiR) { cache.set(key, _aiR); return _aiR; }
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'); g.scale(2, 2);
    const TAU = Math.PI * 2, GX = 64, GY = 108;
    g.fillStyle = 'rgba(5,10,6,.38)'; g.beginPath(); g.ellipse(GX, GY, 13, 4.5, 0, 0, TAU); g.fill();
    // 身体（深灰斗篷，前倾潜行姿态）
    const cloak = g.createLinearGradient(GX - 10, 0, GX + 10, 0);
    cloak.addColorStop(0, '#23262d'); cloak.addColorStop(.5, '#3b4049'); cloak.addColorStop(1, '#191c22');
    g.fillStyle = cloak;
    g.beginPath(); g.moveTo(GX - 10, GY); g.quadraticCurveTo(GX - 13, GY - 22, GX - 4, GY - 32);
    g.lineTo(GX + 5, GY - 33); g.quadraticCurveTo(GX + 12, GY - 20, GX + 9, GY - 2); g.closePath(); g.fill();
    // 兜帽
    g.fillStyle = '#2c313a';
    g.beginPath(); g.arc(GX + 1, GY - 36, 6.5, 0, TAU); g.fill();
    g.fillStyle = '#0c0e12';
    g.beginPath(); g.arc(GX + 2.5, GY - 35.5, 4.2, 0, TAU); g.fill();
    // 眼（冷红）
    g.fillStyle = '#ff6a4e';
    g.beginPath(); g.arc(GX + 4, GY - 36, 1, 0, TAU); g.fill();
    // 匕首（右手反握，刃光）
    g.strokeStyle = '#33302a'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(GX + 8, GY - 16); g.lineTo(GX + 13, GY - 10); g.stroke();
    const blade = g.createLinearGradient(GX + 12, GY - 12, GX + 17, GY - 6);
    blade.addColorStop(0, '#aab4c0'); blade.addColorStop(1, '#e4ecf4');
    g.fillStyle = blade;
    g.beginPath(); g.moveTo(GX + 12, GY - 11); g.lineTo(GX + 18, GY - 5); g.lineTo(GX + 15.5, GY - 3.5); g.closePath(); g.fill();
    // 腰带
    g.strokeStyle = '#54431f'; g.lineWidth = 2.2;
    g.beginPath(); g.moveTo(GX - 8, GY - 14); g.lineTo(GX + 8, GY - 14); g.stroke();
    cache.set(key, c); return c;
  }

  // 撤离传送门（能量环 + 符文刻痕 + 内部漩涡）
  function portalArt() {
    const key = 'w:portal';
    if (cache.has(key)) return cache.get(key);
    const _aiP = propAiCanvas(key, 64);
    if (_aiP) { cache.set(key, _aiP); return _aiP; }
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'); g.scale(2, 2);
    const R = rng(0xF037); const TAU = Math.PI * 2, GX = 64, GY = 76;
    // 外光晕
    const halo = g.createRadialGradient(GX, GY, 8, GX, GY, 42);
    halo.addColorStop(0, 'rgba(120,190,255,.34)'); halo.addColorStop(1, 'rgba(120,190,255,0)');
    g.fillStyle = halo; g.beginPath(); g.arc(GX, GY, 42, 0, TAU); g.fill();
    // 地面基环
    g.fillStyle = 'rgba(90,140,200,.28)';
    g.beginPath(); g.ellipse(GX, GY + 26, 26, 8, 0, 0, TAU); g.fill();
    // 内部漩涡（青蓝渐变 + 螺旋弧）
    const vor = g.createRadialGradient(GX, GY, 2, GX, GY, 24);
    vor.addColorStop(0, '#dff4ff'); vor.addColorStop(.45, '#79c4f2'); vor.addColorStop(1, '#1d5f8e');
    g.fillStyle = vor; g.beginPath(); g.arc(GX, GY, 24, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(230,248,255,.65)'; g.lineWidth = 1.6;
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      for (let t = 0; t <= 1; t += .1) {
        const a = t * 4.2 + i * TAU / 3, r = 3 + t * 18;
        const x = GX + Math.cos(a) * r, y = GY + Math.sin(a) * r;
        t ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    }
    // 外环（金属镶边 + 符文刻痕）
    g.strokeStyle = '#7c8aa0'; g.lineWidth = 5;
    g.beginPath(); g.arc(GX, GY, 27, 0, TAU); g.stroke();
    g.strokeStyle = '#a8b8cc'; g.lineWidth = 1.6;
    g.beginPath(); g.arc(GX, GY, 29.5, 0, TAU); g.stroke();
    for (let i = 0; i < 8; i++) {                                     // 符文刻痕
      const a = i / 8 * TAU + .3;
      g.strokeStyle = 'rgba(190,225,255,.9)'; g.lineWidth = 1.4;
      g.save(); g.translate(GX + Math.cos(a) * 27, GY + Math.sin(a) * 27); g.rotate(a + Math.PI / 2);
      g.beginPath(); g.moveTo(0, -2.6); g.lineTo(2, 2); g.lineTo(-2, 2); g.closePath(); g.stroke();
      g.restore();
    }
    // 能量浮粒
    for (let i = 0; i < 8; i++) {
      const a = R() * TAU, d = 30 + R() * 10;
      g.fillStyle = 'rgba(200,236,255,.8)';
      g.beginPath(); g.arc(GX + Math.cos(a) * d, GY + Math.sin(a) * d * .8, .9 + R() * .7, 0, TAU); g.fill();
    }
    cache.set(key, c); return c;
  }

  // ===== v1.9 游侠盟友（四变体：断刃近战/双枪远程/军医奶妈/藤语者控场） =====
  function allyArt(variant) {
    const key = 'ally:' + variant;
    if (cache.has(key)) return cache.get(key);
    const _aiA = propAiCanvas(key, 44);
    if (_aiA) { cache.set(key, _aiA); return _aiA; }
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'); g.scale(2, 2);
    const TAU = Math.PI * 2, GX = 64, GY = 108;
    // 影
    g.fillStyle = 'rgba(5,10,6,.38)'; g.beginPath(); g.ellipse(GX, GY, 13, 4.5, 0, 0, TAU); g.fill();

    const paintBody = (c0, c1, c2) => {
      const cloak = g.createLinearGradient(GX - 11, 0, GX + 11, 0);
      cloak.addColorStop(0, c0); cloak.addColorStop(.5, c1); cloak.addColorStop(1, c2);
      g.fillStyle = cloak;
      g.beginPath(); g.moveTo(GX - 11, GY); g.quadraticCurveTo(GX - 13, GY - 24, GX - 4, GY - 34);
      g.lineTo(GX + 5, GY - 34); g.quadraticCurveTo(GX + 12, GY - 22, GX + 10, GY); g.closePath(); g.fill();
    };
    const paintHead = (hood, skin) => {
      g.fillStyle = hood; g.beginPath(); g.arc(GX, GY - 38, 7, 0, TAU); g.fill();
      g.fillStyle = skin; g.beginPath(); g.arc(GX + 1.5, GY - 37.5, 4.6, 0, TAU); g.fill();
    };

    if (variant === 'kael') {
      // 断刃·凯尔：钢灰厚甲 + 红残披风 + 巨刃断刀
      paintBody('#4a4e56', '#6a707a', '#34383e');
      paintHead('#565c66', '#c8a888');
      g.fillStyle = '#a83232';                                          // 残破红披风
      g.beginPath(); g.moveTo(GX - 10, GY - 30); g.lineTo(GX - 17, GY - 4); g.lineTo(GX - 12, GY - 2); g.lineTo(GX - 7, GY - 26); g.closePath(); g.fill();
      g.fillStyle = '#8a2424';
      g.beginPath(); g.moveTo(GX - 10, GY - 30); g.lineTo(GX - 15, GY - 12); g.lineTo(GX - 11, GY - 10); g.closePath(); g.fill();
      const blade = g.createLinearGradient(GX + 10, GY - 26, GX + 24, GY - 2);  // 断刀（宽刃平头）
      blade.addColorStop(0, '#c8d2dc'); blade.addColorStop(1, '#8894a2');
      g.fillStyle = blade;
      g.beginPath(); g.moveTo(GX + 9, GY - 24); g.lineTo(GX + 22, GY - 8); g.lineTo(GX + 22, GY - 2); g.lineTo(GX + 15, GY - 6); g.lineTo(GX + 8, GY - 18); g.closePath(); g.fill();
      g.strokeStyle = '#3a3028'; g.lineWidth = 2.4;                     // 刀柄
      g.beginPath(); g.moveTo(GX + 6, GY - 26); g.lineTo(GX + 10, GY - 22); g.stroke();
      g.strokeStyle = '#7a6a4a'; g.lineWidth = 2;                        // 肩甲皮带
      g.beginPath(); g.moveTo(GX - 8, GY - 28); g.lineTo(GX + 7, GY - 26); g.stroke();
    } else if (variant === 'lore') {
      // 双枪·洛蕾：棕皮夹克 + 宽檐帽 + 双枪
      paintBody('#6a5236', '#8a6c44', '#4c3a26');
      paintHead('#7a5c3c', '#e0bc98');
      g.fillStyle = '#5c4428';                                          // 宽檐帽
      g.beginPath(); g.ellipse(GX, GY - 43, 10.5, 3, 0, 0, TAU); g.fill();
      g.fillStyle = '#6e5230';
      g.beginPath(); g.ellipse(GX, GY - 45, 5.5, 3.4, 0, 0, TAU); g.fill();
      g.strokeStyle = '#3a2e1e'; g.lineWidth = 2;                       // 双枪（左右手）
      g.beginPath(); g.moveTo(GX - 12, GY - 16); g.lineTo(GX - 21, GY - 13); g.stroke();
      g.beginPath(); g.moveTo(GX + 11, GY - 16); g.lineTo(GX + 20, GY - 13); g.stroke();
      g.fillStyle = '#b8c2cc';
      g.fillRect(GX - 21, GY - 14.5, 4, 2.4); g.fillRect(GX + 16.5, GY - 14.5, 4, 2.4);
      g.fillStyle = '#3a2c1a';                                          // 弹药带
      g.fillRect(GX - 8, GY - 24, 16, 3.4);
      g.fillStyle = '#d8b04e';
      for (let i = 0; i < 4; i++) g.fillRect(GX - 7 + i * 4, GY - 23.6, 2, 2.6);
    } else if (variant === 'chen') {
      // 老军医·陈：白褂 + 绿十字袖标 + 背药箱
      paintBody('#8a8e84', '#c0c4ba', '#6e7268');
      paintHead('#8e9488', '#d8b898');
      g.fillStyle = '#3f7a58';                                          // 绿十字袖标
      g.fillRect(GX - 11, GY - 22, 7, 7);
      g.fillStyle = '#dff2e4'; g.fillRect(GX - 8.6, GY - 20.4, 2.2, 4.4); g.fillRect(GX - 10.1, GY - 18.9, 5.2, 2.2);
      g.fillStyle = '#6d5230';                                          // 背药箱（带十字）
      g.beginPath(); g.ellipse(GX - 12, GY - 22, 8, 12, -.2, 0, TAU); g.fill();
      g.fillStyle = '#dff2e4';
      g.fillRect(GX - 13.4, GY - 25, 2.4, 5.4); g.fillRect(GX - 15.4, GY - 23.4, 6.4, 2.4);
      g.strokeStyle = '#4a3418'; g.lineWidth = 1;
      g.strokeRect(GX - 20, GY - 34, 16, 24);
      g.strokeStyle = '#5c8a6a'; g.lineWidth = 2;                       // 手中步枪（细弱）
      g.beginPath(); g.moveTo(GX + 8, GY - 14); g.lineTo(GX + 19, GY - 18); g.stroke();
      g.strokeStyle = '#c8d2cc'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(GX + 12, GY - 12); g.lineTo(GX + 16, GY - 13); g.stroke();
      g.strokeStyle = '#9aa89e'; g.lineWidth = 1.4;                     // 白发胡须
      g.beginPath(); g.moveTo(GX - 1, GY - 35); g.quadraticCurveTo(GX + 1.5, GY - 31, GX - 1, GY - 29); g.stroke();
    } else {
      // 藤语者·苗：藤绿长发 + 植物藤披 + 藤鞭
      paintBody('#3a5a3e', '#5a7a52', '#2a4430');
      paintHead('#4a6a48', '#cfe0c0');
      g.fillStyle = '#5a8a5c';                                          // 长发（垂顺）
      g.beginPath(); g.moveTo(GX - 7, GY - 42); g.quadraticCurveTo(GX - 12, GY - 30, GX - 9, GY - 18);
      g.lineTo(GX - 5, GY - 20); g.quadraticCurveTo(GX - 7, GY - 32, GX - 4, GY - 41); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(GX + 7, GY - 42); g.quadraticCurveTo(GX + 12, GY - 30, GX + 9, GY - 18);
      g.lineTo(GX + 5, GY - 20); g.quadraticCurveTo(GX + 7, GY - 32, GX + 4, GY - 41); g.closePath(); g.fill();
      const whip = g.createLinearGradient(GX + 10, GY - 24, GX + 24, GY - 4);  // 藤鞭（带叶片）
      whip.addColorStop(0, '#6a9a5e'); whip.addColorStop(1, '#8ab87a');
      g.strokeStyle = whip; g.lineWidth = 2.6;
      g.beginPath(); g.moveTo(GX + 9, GY - 22); g.quadraticCurveTo(GX + 20, GY - 16, GX + 23, GY - 4); g.stroke();
      g.fillStyle = '#7ab86a';
      for (let i = 0; i < 3; i++) {
        const lx = GX + 13 + i * 4.5, ly = GY - 19 + i * 4.5;
        g.beginPath(); g.ellipse(lx, ly, 2.6, 1.2, i * 1.1, 0, TAU); g.fill();
      }
      g.fillStyle = '#a8d89a';                                          // 发梢新芽
      g.beginPath(); g.arc(GX - 9, GY - 18, 1.6, 0, TAU); g.arc(GX + 9, GY - 18, 1.6, 0, TAU); g.fill();
    }
    // 通用：暗轮廓（增强剪影可读性）
    g.strokeStyle = 'rgba(8,12,10,.5)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(GX - 11, GY); g.quadraticCurveTo(GX - 13, GY - 24, GX - 4, GY - 34);
    g.lineTo(GX + 5, GY - 34); g.quadraticCurveTo(GX + 12, GY - 22, GX + 10, GY); g.stroke();
    cache.set(key, c); return c;
  }

  // ===== v2.0 农场常驻 NPC 形象（五人各一：小满/阿洛/王伯/铁山/影，均含标志性武器） =====
  // 骨架与 allyArt 同源（256px 剪影 + 椭圆影 + 暗轮廓），但配色走「营地居民」气质
  function npcArt(id) {
    const key = 'npc:' + id;
    if (cache.has(key)) return cache.get(key);
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'); g.scale(2, 2);
    const TAU = Math.PI * 2, GX = 64, GY = 108;
    g.fillStyle = 'rgba(5,10,6,.38)'; g.beginPath(); g.ellipse(GX, GY, 13, 4.5, 0, 0, TAU); g.fill();

    const paintBody = (c0, c1, c2) => {
      const cloak = g.createLinearGradient(GX - 11, 0, GX + 11, 0);
      cloak.addColorStop(0, c0); cloak.addColorStop(.5, c1); cloak.addColorStop(1, c2);
      g.fillStyle = cloak;
      g.beginPath(); g.moveTo(GX - 11, GY); g.quadraticCurveTo(GX - 13, GY - 24, GX - 4, GY - 34);
      g.lineTo(GX + 5, GY - 34); g.quadraticCurveTo(GX + 12, GY - 22, GX + 10, GY); g.closePath(); g.fill();
    };
    const paintHead = (hood, skin) => {
      if (hood) { g.fillStyle = hood; g.beginPath(); g.arc(GX, GY - 38, 7, 0, TAU); g.fill(); }
      if (skin) { g.fillStyle = skin; g.beginPath(); g.arc(GX + 1.5, GY - 37.5, 4.6, 0, TAU); g.fill(); }
    };

    if (id === 'guide') {
      // 邻家向导·小满：草绿连帽衫 + 暖黄围巾 + 露出马尾 + 斜挎包 + 向导杖（顶绑红布条）
      paintBody('#4a7a42', '#6a9a5e', '#365a32');
      paintHead('#5a8a4e', '#e8c8a8');
      g.fillStyle = '#6a4a2e';                                          // 兜帽后垂出的马尾
      g.beginPath(); g.moveTo(GX - 4, GY - 41); g.quadraticCurveTo(GX - 12, GY - 34, GX - 10, GY - 22);
      g.lineTo(GX - 6.5, GY - 23); g.quadraticCurveTo(GX - 8, GY - 33, GX - 3, GY - 40); g.closePath(); g.fill();
      g.fillStyle = '#8a6a46';
      g.beginPath(); g.arc(GX - 9, GY - 22, 1.6, 0, TAU); g.fill();     // 发梢皮筋
      g.fillStyle = '#e8c86a';                                          // 暖黄围巾
      g.beginPath(); g.ellipse(GX + 1, GY - 32, 7.5, 3, 0, 0, TAU); g.fill();
      g.fillStyle = '#c9a44e';
      g.beginPath(); g.moveTo(GX + 5, GY - 30); g.lineTo(GX + 8, GY - 22); g.lineTo(GX + 5, GY - 22); g.closePath(); g.fill();
      g.fillStyle = '#7a5a34';                                          // 斜挎小包（右腰）
      g.beginPath(); g.roundRect(GX + 6, GY - 18, 9, 7, 2); g.fill();
      g.strokeStyle = '#4a3820'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(GX + 7, GY - 18); g.lineTo(GX + 14, GY - 11); g.stroke();
      g.strokeStyle = '#8a6a44'; g.lineWidth = 2.4;                     // 向导杖（右手竖持）
      g.beginPath(); g.moveTo(GX + 13, GY - 30); g.lineTo(GX + 13, GY - 2); g.stroke();
      g.fillStyle = '#d84848';                                          // 顶端红布条（飘）
      g.beginPath(); g.moveTo(GX + 13, GY - 30); g.quadraticCurveTo(GX + 19, GY - 32, GX + 22, GY - 28);
      g.lineTo(GX + 19, GY - 26); g.quadraticCurveTo(GX + 16, GY - 29, GX + 13, GY - 27); g.closePath(); g.fill();
      g.fillStyle = '#c83838';
      g.beginPath(); g.moveTo(GX + 13, GY - 27); g.quadraticCurveTo(GX + 17, GY - 25, GX + 20, GY - 23);
      g.lineTo(GX + 16, GY - 23); g.quadraticCurveTo(GX + 14, GY - 25, GX + 13, GY - 26); g.closePath(); g.fill();
    } else if (id === 'merchant') {
      // 流浪商人·阿洛（营地版）：褐旅装 + 褐头巾络腮胡 + 大背囊 + 腰间弯刀 + 手持账本
      paintBody('#6a5236', '#8a6c44', '#4c3a26');
      paintHead('#7a5c3a', '#d8b090');
      g.fillStyle = '#5c4428';                                          // 褐头巾（头顶包裹一圈）
      g.beginPath(); g.arc(GX, GY - 40.5, 7.4, Math.PI * .95, Math.PI * 2.05); g.fill();
      g.fillRect(GX - 7.2, GY - 41, 14.4, 2.6);
      g.fillStyle = '#4a3418';                                          // 络腮胡
      g.beginPath(); g.ellipse(GX + 1.5, GY - 34, 5, 2.6, 0, 0, TAU); g.fill();
      g.fillStyle = '#6d5230';                                          // 大背囊（左侧，双层捆扎）
      g.beginPath(); g.ellipse(GX - 12, GY - 22, 9, 14, -.22, 0, TAU); g.fill();
      g.strokeStyle = '#4a3418'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(GX - 20, GY - 27); g.lineTo(GX - 4, GY - 26);
      g.moveTo(GX - 19, GY - 20); g.lineTo(GX - 5, GY - 19); g.stroke();
      g.strokeStyle = '#8a8578'; g.lineWidth = 2;                       // 背囊上卷起的账卷
      g.beginPath(); g.moveTo(GX - 14, GY - 35); g.lineTo(GX - 7, GY - 33.5); g.stroke();
      const scimitar = g.createLinearGradient(GX + 16, GY - 18, GX + 23, GY - 4);  // 腰间弯刀（弧刃朝上）
      scimitar.addColorStop(0, '#aab4c0'); scimitar.addColorStop(1, '#e0e8f0');
      g.strokeStyle = scimitar; g.lineWidth = 2.6;
      g.beginPath(); g.moveTo(GX + 15, GY - 5); g.quadraticCurveTo(GX + 22, GY - 12, GX + 17, GY - 19); g.stroke();
      g.strokeStyle = '#3a2c18'; g.lineWidth = 2.2;                     // 刀柄
      g.beginPath(); g.moveTo(GX + 14.5, GY - 6); g.lineTo(GX + 13, GY - 10); g.stroke();
      g.fillStyle = '#d8b04e'; g.beginPath(); g.arc(GX + 12.6, GY - 10.5, 1.2, 0, TAU); g.fill();
      g.fillStyle = '#e8dcc0';                                          // 右手举账本（翻开）
      g.save(); g.translate(GX + 10, GY - 27); g.rotate(-.18);
      g.fillRect(-4, -3, 9, 6);
      g.strokeStyle = '#8a7a5a'; g.lineWidth = .8;
      g.beginPath(); g.moveTo(0, -2.2); g.lineTo(0, 2.2);
      g.moveTo(-3, -1); g.lineTo(-1, -1); g.moveTo(1, -1); g.lineTo(3, -1); g.stroke();
      g.restore();
    } else if (id === 'farmer') {
      // 老农夫·王伯：草帽 + 白发白胡 + 背带裤格子衫 + 肩扛老锄头
      paintBody('#7a5a3a', '#96744e', '#5c4428');
      // 背带裤（胸前两带 + 裤身深蓝）
      g.fillStyle = '#3e4e6e';
      g.beginPath(); g.moveTo(GX - 8, GY - 20); g.lineTo(GX + 7, GY - 20); g.lineTo(GX + 8, GY); g.lineTo(GX - 9, GY); g.closePath(); g.fill();
      g.strokeStyle = '#32405c'; g.lineWidth = 2.6;
      g.beginPath(); g.moveTo(GX - 6, GY - 33); g.lineTo(GX - 5, GY - 20); g.moveTo(GX + 5, GY - 33); g.lineTo(GX + 4, GY - 20); g.stroke();
      g.fillStyle = '#c8a44e';                                          // 背带铜扣
      g.beginPath(); g.arc(GX - 5, GY - 22.5, 1, 0, TAU); g.arc(GX + 4, GY - 22.5, 1, 0, TAU); g.fill();
      paintHead(null, '#d8b090');
      g.fillStyle = '#d8d8d0';                                          // 白发 + 一团白胡
      g.beginPath(); g.arc(GX, GY - 41.5, 5.6, Math.PI, TAU); g.fill();
      g.beginPath(); g.ellipse(GX + 1.5, GY - 33, 5.4, 3.4, 0, 0, TAU); g.fill();
      g.fillStyle = '#d8b86a';                                          // 宽檐草帽
      g.beginPath(); g.ellipse(GX, GY - 44, 13, 3.2, 0, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(GX, GY - 47, 6.4, 3.6, 0, 0, TAU); g.fill();
      g.strokeStyle = '#8a6a3a'; g.lineWidth = 1.2;                     // 帽带
      g.beginPath(); g.moveTo(GX - 6.4, GY - 44.4); g.lineTo(GX + 6.4, GY - 44.4); g.stroke();
      g.strokeStyle = '#7a5c38'; g.lineWidth = 2.6;                     // 老锄头（右肩扛）
      g.beginPath(); g.moveTo(GX + 6, GY - 34); g.lineTo(GX + 19, GY - 4); g.stroke();
      const hoe = g.createLinearGradient(GX + 14, GY - 38, GX + 22, GY - 30);
      hoe.addColorStop(0, '#9aa4ae'); hoe.addColorStop(1, '#6a747e');   // 铁锄刃（梯形）
      g.fillStyle = hoe;
      g.beginPath(); g.moveTo(GX + 8, GY - 35); g.lineTo(GX + 15, GY - 39); g.lineTo(GX + 18, GY - 33); g.lineTo(GX + 11, GY - 30); g.closePath(); g.fill();
      g.strokeStyle = '#54431f'; g.lineWidth = 1.8;                     // 腰间麻绳
      g.beginPath(); g.moveTo(GX - 8, GY - 19); g.quadraticCurveTo(GX, GY - 16.5, GX + 7, GY - 19); g.stroke();
    } else if (id === 'veteran') {
      // 远征老兵·铁山：钢灰重甲 + 双肩甲 + 残红披风 + 脸疤 + 双手巨锤 + 左手铁包指
      paintBody('#4a4e56', '#6a707a', '#34383e');
      g.strokeStyle = '#8a94a2'; g.lineWidth = 1.2;                     // 胸甲高光缝线
      g.beginPath(); g.moveTo(GX - 7, GY - 26); g.lineTo(GX + 6, GY - 26); g.moveTo(GX - 6, GY - 18); g.lineTo(GX + 5, GY - 18); g.stroke();
      g.fillStyle = '#565c66';                                          // 双肩甲（厚块）
      g.beginPath(); g.ellipse(GX - 9, GY - 31, 5.4, 4, -.3, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(GX + 8, GY - 31, 5.4, 4, .3, 0, TAU); g.fill();
      g.strokeStyle = '#7a8490'; g.lineWidth = 1;
      g.beginPath(); g.ellipse(GX - 9, GY - 31.5, 4.4, 3, -.3, 0, TAU); g.stroke();
      g.fillStyle = '#a83232';                                          // 残红披风（锯齿下摆）
      g.beginPath(); g.moveTo(GX - 10, GY - 30); g.lineTo(GX - 18, GY - 6); g.lineTo(GX - 14.5, GY - 8); g.lineTo(GX - 13, GY - 2);
      g.lineTo(GX - 10, GY - 6); g.lineTo(GX - 8, GY - 2); g.lineTo(GX - 6.5, GY - 26); g.closePath(); g.fill();
      paintHead(null, '#c8a888');
      g.fillStyle = '#3a3e44';                                          // 平顶短发
      g.beginPath(); g.arc(GX, GY - 40.5, 7, Math.PI * 1.05, Math.PI * 2 - .05); g.fill();
      g.strokeStyle = '#a86a6a'; g.lineWidth = 1.2;                     // 右脸刀疤
      g.beginPath(); g.moveTo(GX + 3.5, GY - 41); g.lineTo(GX + 5.5, GY - 35.5); g.stroke();
      g.strokeStyle = '#4a3828'; g.lineWidth = 2.6;                     // 巨锤长柄（双手斜持）
      g.beginPath(); g.moveTo(GX + 4, GY - 26); g.lineTo(GX + 20, GY - 12); g.stroke();
      const ham = g.createLinearGradient(GX + 14, GY - 22, GX + 24, GY - 12);  // 锤头（钢块）
      ham.addColorStop(0, '#7a8494'); ham.addColorStop(1, '#a8b4c2');
      g.fillStyle = ham;
      g.beginPath(); g.roundRect(GX + 13, GY - 23, 10, 8, 1.5); g.fill();
      g.strokeStyle = '#565c66'; g.lineWidth = 1;
      g.strokeRect(GX + 14, GY - 22, 8, 6);
      g.fillStyle = '#5c4a2c';                                          // 柄尾包布
      g.beginPath(); g.roundRect(GX + 2.5, GY - 27.5, 4, 5, 1); g.fill();
      g.fillStyle = '#8a94a0';                                          // 左手铁包指（义指手套）
      g.beginPath(); g.ellipse(GX - 8, GY - 16, 3.4, 4.4, .3, 0, TAU); g.fill();
      g.strokeStyle = '#6a747e'; g.lineWidth = .9;
      g.beginPath(); g.moveTo(GX - 10, GY - 14.5); g.lineTo(GX - 6.5, GY - 15.5); g.stroke();
    } else {
      // 神秘旅人·影：暗紫斗篷兜帽（全遮脸）+ 冷月蓝独眼 + 月牙坠 + 双弯月刃 + 下摆渐隐
      const shade2 = g.createLinearGradient(GX - 11, 0, GX + 11, 0);
      shade2.addColorStop(0, '#3a2c50'); shade2.addColorStop(.5, '#524070'); shade2.addColorStop(1, '#281e3c');
      g.fillStyle = shade2;
      g.beginPath(); g.moveTo(GX - 11, GY); g.quadraticCurveTo(GX - 13, GY - 24, GX - 4, GY - 34);
      g.lineTo(GX + 5, GY - 34); g.quadraticCurveTo(GX + 12, GY - 22, GX + 10, GY); g.closePath(); g.fill();
      const fade = g.createLinearGradient(0, GY - 8, 0, GY + 2);        // 下摆渐隐（半透，营造漂浮）
      fade.addColorStop(0, 'rgba(40,30,60,0)'); fade.addColorStop(1, 'rgba(20,14,34,.85)');
      g.fillStyle = fade;
      g.beginPath(); g.ellipse(GX, GY - 3, 11, 4, 0, 0, TAU); g.fill();
      g.fillStyle = '#2c2240';                                          // 兜帽（全遮脸）
      g.beginPath(); g.arc(GX, GY - 38, 7.4, 0, TAU); g.fill();
      g.fillStyle = '#0a0812';                                          // 帽内纯黑
      g.beginPath(); g.arc(GX + 1.8, GY - 37.4, 5, 0, TAU); g.fill();
      g.fillStyle = '#8ad0e8'; g.shadowColor = '#7ac0e0'; g.shadowBlur = 5;  // 冷月蓝独眼（发光）
      g.beginPath(); g.arc(GX + 3.6, GY - 37.8, 1.2, 0, TAU); g.fill(); g.shadowBlur = 0;
      g.fillStyle = '#c8d8e8';                                          // 胸前月牙坠
      g.save(); g.translate(GX - 1, GY - 26); g.rotate(-.5);
      g.strokeStyle = '#c8d8e8'; g.lineWidth = 1.4;
      g.beginPath(); g.arc(0, 0, 3.2, Math.PI * .35, Math.PI * 1.65); g.stroke();
      g.restore();
      const bladeL = g.createLinearGradient(GX - 20, GY - 22, GX - 12, GY - 8);  // 左手弯月短刃
      bladeL.addColorStop(0, '#a8c4dc'); bladeL.addColorStop(1, '#d8ecf8');
      g.strokeStyle = bladeL; g.lineWidth = 2.4;
      g.beginPath(); g.moveTo(GX - 12, GY - 22); g.quadraticCurveTo(GX - 21, GY - 17, GX - 16, GY - 7); g.stroke();
      const bladeR = g.createLinearGradient(GX + 20, GY - 22, GX + 12, GY - 8);  // 右手弯月短刃
      bladeR.addColorStop(0, '#a8c4dc'); bladeR.addColorStop(1, '#d8ecf8');
      g.strokeStyle = bladeR; g.lineWidth = 2.4;
      g.beginPath(); g.moveTo(GX + 12, GY - 22); g.quadraticCurveTo(GX + 21, GY - 17, GX + 16, GY - 7); g.stroke();
      for (let i = 0; i < 3; i++) {                                     // 周身冷蓝浮粒
        const a = [1.9, 2.9, 4.4][i], d = 15 + i * 3;
        g.fillStyle = 'rgba(138,208,232,.75)';
        g.beginPath(); g.arc(GX + Math.cos(a) * d, GY - 24 + Math.sin(a) * d * .55, 1, 0, TAU); g.fill();
      }
    }
    // 通用：暗轮廓（增强剪影可读性，与 allyArt 同款）
    g.strokeStyle = 'rgba(8,12,10,.5)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(GX - 11, GY); g.quadraticCurveTo(GX - 13, GY - 24, GX - 4, GY - 34);
    g.lineTo(GX + 5, GY - 34); g.quadraticCurveTo(GX + 12, GY - 22, GX + 10, GY); g.stroke();
    cache.set(key, c); return c;
  }

  return { groundTile, waterTile, dispMap, obstacleArt, OB_VARIANTS,
           towerArt, chestArt, campfireArt, merchantArt, raiderArt, portalArt, allyArt, npcArt };
})();
window.ArtTextures = ArtTextures;
