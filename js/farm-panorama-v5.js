/* ================= 家园全景 v6（重制，2026-10-21） =================
 * 目标：作物实况 / 天气联动 / 末世氛围 / 细节丰富 / 建筑升级同步。
 * 900×300 逻辑画布，7 层绘制：
 *   1 天空（时段+天气） 2 废都剪影 3 远山层雾 4 中景建筑（按等级长细节）
 *   5 农田（16 地块逐格对应作物） 6 河流木桥与前景残骸 7 天气粒子 + 调色 + 电影感
 * 接口与旧版兼容：draw / drawDynamic / bakeStatic / phaseOf / decoPosOf / baseReady / baseKey
 */
(function () {
  'use strict';
  const W = 900, H = 300, HZ = 158;
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  const WEATHER = {
    clear: { sky: [['#5b86b0', 0], ['#8fb3c6', .35], ['#d9c49a', .68], ['#f0d9ae', 1]], sun: 1, dark: 0, rain: 0, fog: 0, clouds: 5, cloudCol: 'rgba(255,248,235,.55)' },
    cloud: { sky: [['#5f7b93', 0], ['#8a9aa2', .35], ['#bdb39e', .7], ['#d6c8ac', 1]], sun: .55, dark: .10, rain: 0, fog: 0, clouds: 9, cloudCol: 'rgba(235,238,235,.62)' },
    rain: { sky: [['#46596b', 0], ['#66757c', .35], ['#8a8c80', .72], ['#9c9c8c', 1]], sun: .18, dark: .22, rain: .7, fog: 0, clouds: 10, cloudCol: 'rgba(180,190,195,.6)' },
    heavy_rain: { sky: [['#36485a', 0], ['#51626a', .35], ['#71756c', .72], ['#83847a', 1]], sun: .08, dark: .34, rain: 1, fog: 0, clouds: 11, cloudCol: 'rgba(150,162,170,.62)' },
    storm: { sky: [['#1f2c3c', 0], ['#334654', .35], ['#4c5450', .72], ['#5c5c50', 1]], sun: 0, dark: .52, rain: .9, fog: 0, clouds: 12, cloudCol: 'rgba(96,110,120,.7)' },
    fog: { sky: [['#9aa5a3', 0], ['#b6bcb4', .35], ['#d3d2c6', .72], ['#e6e2d6', 1]], sun: .35, dark: 0, rain: 0, fog: 1, clouds: 3, cloudCol: 'rgba(230,230,222,.5)' }
  };

  const FarmPanorama = {
    _nightLights: [],
    _baseImg: null, _baseOk: false, _baseSalt: 0,
    _initBase() {
      if (this._baseImg) return;
      const im = new Image();
      im.onload = () => { this._baseOk = true; this._baseSalt++; };
      im.onerror = () => { this._baseOk = false; };
      im.src = 'assets/panorama/pano-base-v6.png';
      this._baseImg = im;
    },
    baseReady() { this._initBase(); return this._baseOk; },
    baseKey() { this._initBase(); return this._baseOk ? 'v6.' + this._baseSalt : 'fallback'; },
    _drawBase(c) {
      this._initBase();
      if (this._baseOk && this._baseImg && this._baseImg.naturalWidth) {
        c.drawImage(this._baseImg, 0, 0, W, H);
        return true;
      }
      return false;
    },
    phaseOf() {
      const hr = (typeof window !== 'undefined' && window.PANO_HOUR != null) ? window.PANO_HOUR : (new Date().getHours() + new Date().getMinutes() / 60);
      return { hr, night: hr >= 20 || hr < 5, dusk: hr >= 17 && hr < 20, dawn: hr >= 5 && hr < 7 };
    },
    decoPosOf(d) { return { x: 320 + d.x * 26, y: 232 + d.y * 8 }; },
    _weatherOf(G) { const s = (G.farmWeather && G.farmWeather.state) || G.weather; return WEATHER[s] ? s : 'clear'; },
    _light(c, night, x, y, r, col) {
      this._nightLights.push([x, y, r]);
      if (!night) {
        // 白天也有轻微窗光溢出，避免死板
        const g = c.createRadialGradient(x, y, 1, x, y, r * .6);
        g.addColorStop(0, 'rgba(255,220,160,.12)'); g.addColorStop(1, 'rgba(255,210,140,0)');
        c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
        return;
      }
      c.save(); c.globalCompositeOperation = 'lighter';
      const g = c.createRadialGradient(x, y, 1, x, y, r);
      g.addColorStop(0, col || 'rgba(255,198,110,.42)'); g.addColorStop(.5, 'rgba(255,180,90,.12)'); g.addColorStop(1, 'rgba(255,170,80,0)');
      c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
      c.restore();
    },

    /* ---------- 1. 天空 ---------- */
    _sky(c, G, t, ph, wk) {
      const pal = WEATHER[wk], night = ph.night, dusk = ph.dusk, dawn = ph.dawn;
      const g = c.createLinearGradient(0, 0, 0, HZ + 30);
      if (night) {
        g.addColorStop(0, '#141d33'); g.addColorStop(.45, '#25304a'); g.addColorStop(.78, '#3c4055'); g.addColorStop(1, '#565064');
      } else if (dusk) {
        g.addColorStop(0, '#3f5678'); g.addColorStop(.3, '#7c6b86'); g.addColorStop(.6, '#c98a62'); g.addColorStop(.85, '#e8a868'); g.addColorStop(1, '#d99a58');
      } else if (dawn) {
        g.addColorStop(0, '#5c7290'); g.addColorStop(.35, '#a08a94'); g.addColorStop(.7, '#e0b090'); g.addColorStop(1, '#e8c8a0');
      } else {
        pal.sky.forEach(([col, p]) => g.addColorStop(p, col));
      }
      c.fillStyle = g; c.fillRect(0, 0, W, HZ + 30);

      // 星空
      if (night) {
        for (let i = 0; i < 90; i++) {
          const x = hash(i * 3.7) * W, y = hash(i * 7.1) * (HZ - 34);
          const a = .25 + .55 * Math.abs(Math.sin(t * .7 + i * 1.3));
          c.fillStyle = `rgba(226,234,255,${a.toFixed(2)})`;
          c.fillRect(x, y, i % 5 === 0 ? 1.8 : 1.2, i % 5 === 0 ? 1.8 : 1.2);
        }
        // 银河薄带
        const mg2 = c.createLinearGradient(0, 20, W, 90);
        mg2.addColorStop(0, 'rgba(120,140,200,0)'); mg2.addColorStop(.5, 'rgba(140,160,220,.10)'); mg2.addColorStop(1, 'rgba(120,140,200,0)');
        c.fillStyle = mg2; c.fillRect(0, 0, W, HZ - 30);
      }

      // 天体
      const sx = 736, sy = night ? 58 : dusk ? 104 : dawn ? 96 : 62;
      if (night) {
        c.save();
        const mg = c.createRadialGradient(sx, sy, 5, sx, sy, 90);
        mg.addColorStop(0, 'rgba(214,224,255,.50)'); mg.addColorStop(.22, 'rgba(170,190,240,.16)'); mg.addColorStop(1, 'rgba(150,175,230,0)');
        c.fillStyle = mg; c.fillRect(sx - 90, sy - 90, 180, 180);
        c.fillStyle = '#e6ecff'; c.beginPath(); c.arc(sx, sy, 17, 0, 7); c.fill();
        c.fillStyle = '#cdd8f2'; c.beginPath(); c.arc(sx - 6, sy + 5, 3.4, 0, 7); c.arc(sx + 6, sy - 4, 2.4, 0, 7); c.fill();
        c.restore();
      } else {
        c.save();
        const sunR = dusk ? 150 : 120;
        const sg = c.createRadialGradient(sx, sy, 6, sx, sy, sunR);
        sg.addColorStop(0, 'rgba(255,250,225,.95)'); sg.addColorStop(.10, 'rgba(255,240,190,.55)');
        sg.addColorStop(.38, 'rgba(255,214,140,.18)'); sg.addColorStop(1, 'rgba(255,200,120,0)');
        c.fillStyle = sg; c.fillRect(sx - sunR, sy - sunR, sunR * 2, sunR * 2);
        c.fillStyle = dusk ? '#ffe0ae' : '#fff8e2';
        c.beginPath(); c.arc(sx, sy, dusk ? 17 : 14, 0, 7); c.fill();
        c.restore();
      }

      // 云：多层软椭圆 + 边缘亮
      const n = pal.clouds;
      for (let i = 0; i < n; i++) {
        const sp = 4 + (i % 4) * 3;
        const cx = ((hash(i * 5.3) * W + t * sp) % (W + 340)) - 170;
        const cy = 24 + hash(i * 9.7) * (HZ - 78);
        const s = .8 + hash(i * 3.1) * 1.4;
        const w = (70 + hash(i * 6.9) * 90) * s, h = (12 + hash(i * 2.3) * 10) * s;
        c.save();
        c.fillStyle = pal.cloudCol;
        c.beginPath();
        for (let k = 0; k < 7; k++) {
          const ox = (k - 3) * 0.24 * w;
          const oy = Math.sin(k * 1.3 + i) * h * .35;
          c.ellipse(cx + ox, cy + oy, w * .30 * (1 - Math.abs(k - 3) * .14), h * (.9 - Math.abs(k - 3) * .13), 0, 0, 7);
        }
        c.fill();
        // 云顶高光
        c.fillStyle = 'rgba(255,250,240,.18)';
        c.beginPath(); c.ellipse(cx - w * .12, cy - h * .45, w * .34, h * .4, 0, 0, 7); c.fill();
        c.restore();
      }

      // 雾天整层纱（画在天空，地面雾在角色层）
      if (pal.fog) {
        const fg = c.createLinearGradient(0, 40, 0, HZ);
        fg.addColorStop(0, 'rgba(222,224,216,.04)'); fg.addColorStop(1, 'rgba(226,226,218,.22)');
        c.fillStyle = fg; c.fillRect(0, 0, W, HZ + 20);
      }
    },

    /* ---------- 2. 废都剪影 ---------- */
    _city(c, t, ph, wk) {
      const glow = ph.night || ph.dusk;
      const city = (baseY, col, seed, scale, alpha) => {
        c.save(); c.globalAlpha = alpha; c.fillStyle = col;
        let x = -30;
        for (let i = 0; i < 70 && x < W + 40; i++) {
          const hh = (16 + hash(seed + i * 2.3) * 46) * scale;
          const ww = (11 + hash(seed + i * 5.1) * 26) * scale;
          const broken = hash(seed + i * 7.7) < .32;
          if (broken) {
            c.fillRect(x, baseY - hh * .5, ww, hh * .5);
            if (hash(seed + i * 3.3) > .45) c.fillRect(x + ww * .25, baseY - hh * .78, ww * .34, hh * .3);
          } else {
            c.fillRect(x, baseY - hh, ww, hh);
            if (hash(seed + i * 9.9) > .72) c.fillRect(x + ww * .18, baseY - hh - 9 * scale, ww * .22, 9 * scale);
            // 破窗
            c.save(); c.fillStyle = 'rgba(10,12,14,.5)';
            for (let wy = 0; wy < 3; wy++) for (let wx = 0; wx < 2; wx++) {
              if (hash(seed + i * 13 + wy * 3 + wx) > .45) c.fillRect(x + ww * (.2 + wx * .32), baseY - hh + 6 + wy * 8, ww * .16, 3.2);
            }
            c.restore();
          }
          x += ww + 4 + hash(seed + i) * 10;
        }
        c.restore();
      };
      city(HZ - 8, '#7a8488', 11, 0.75, .38);
      city(HZ + 1, '#5a6466', 31, 1.0, .55);
      city(HZ + 9, '#414a4c', 71, 1.25, .78);
      // 地平线湿气：把城市压进远景
      const hzm = c.createLinearGradient(0, HZ - 30, 0, HZ + 26);
      hzm.addColorStop(0, 'rgba(226,222,206,0)'); hzm.addColorStop(.6, 'rgba(226,222,206,.30)'); hzm.addColorStop(1, 'rgba(226,222,206,0)');
      c.fillStyle = hzm; c.fillRect(0, HZ - 30, W, 56);

      // 断桥/塔吊剪影
      c.strokeStyle = 'rgba(40,46,48,.85)'; c.lineWidth = 2.4;
      c.beginPath(); c.moveTo(150, HZ + 8); c.lineTo(150, HZ - 60); c.lineTo(210, HZ - 42); c.stroke();
      c.beginPath(); c.moveTo(150, HZ - 60); c.lineTo(120, HZ - 52); c.stroke();
      c.lineWidth = 1.2;
      for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(150, HZ - 58 + i * 7); c.lineTo(196 - i * 4, HZ - 44 + i * 5); c.stroke(); }

      if (glow) {
        for (let i = 0; i < 7; i++) {
          const fx = 40 + hash(i * 13.7) * 780, fy = HZ - 10 + hash(i * 4.9) * 12;
          const a = .10 + .12 * Math.abs(Math.sin(t * 2.0 + i * 1.7));
          const fg = c.createRadialGradient(fx, fy, 1, fx, fy, 34);
          fg.addColorStop(0, `rgba(255,150,70,${(a + .14).toFixed(2)})`);
          fg.addColorStop(1, 'rgba(255,120,50,0)');
          c.fillStyle = fg; c.fillRect(fx - 34, fy - 34, 68, 68);
        }
      }
    },

    /* ---------- 3. 远山与层雾 ---------- */
    _hills(c, ph, wk) {
      const night = ph.night;
      const layers = night
        ? [['#2b3446', .85], ['#232c3c', .9], ['#1c242f', .95]]
        : [['#7d8a86', .8], ['#5f6f68', .85], ['#48584e', .9]];
      layers.forEach(([col, a], li) => {
        c.save(); c.globalAlpha = a; c.fillStyle = col;
        c.beginPath(); c.moveTo(0, HZ + 4);
        for (let x = 0; x <= W; x += 10) {
          const y = HZ - li * 4 + Math.sin(x * .009 + li * 2.3) * (16 - li * 4) + Math.sin(x * .023 + li * 1.7) * (7 - li);
          c.lineTo(x, y);
        }
        c.lineTo(W, HZ + 40); c.lineTo(0, HZ + 40); c.closePath(); c.fill();
        c.restore();
      });
      // 层雾（地平线附近的湿气）
      const hz = c.createLinearGradient(0, HZ - 26, 0, HZ + 20);
      hz.addColorStop(0, night ? 'rgba(90,110,150,0)' : 'rgba(226,220,200,0)');
      hz.addColorStop(.55, night ? 'rgba(100,120,160,.16)' : 'rgba(228,220,198,.26)');
      hz.addColorStop(1, night ? 'rgba(90,110,150,0)' : 'rgba(226,220,200,0)');
      c.fillStyle = hz; c.fillRect(0, HZ - 26, W, 46);
    },

    /* ---------- 4. 建筑（等级驱动） ---------- */
    _buildings(c, G, t, ph) {
      const bl = G.buildings || {};
      const lv = id => (bl[id] && bl[id].level) || 0;
      const night = ph.night;
      this._nightLights = [];
      const smoke = (x, y, s) => {
        for (let k = 0; k < 4; k++) {
          const p = ((t * .28 + k * .25) % 1);
          const a = (1 - p) * .16;
          c.fillStyle = `rgba(196,192,184,${a.toFixed(3)})`;
          c.beginPath(); c.arc(x + Math.sin(t * .7 + k) * 5 + p * 8, y - p * 40 * s, (2.4 + p * 7) * s, 0, 7); c.fill();
        }
      };
      const groundShadow = (x, y, r) => { c.fillStyle = 'rgba(24,20,16,.30)'; c.beginPath(); c.ellipse(x + 3, y + 2, r, r * .22, 0, 0, 7); c.fill(); };

      /* 主屋（中央） */
      {
        const hx = 306, hy = 228, S = 1.25;
        groundShadow(hx, hy, 76);
        c.save(); c.translate(hx, hy); c.scale(S, S);
        // 主体
        c.fillStyle = '#7a6350'; c.fillRect(-46, -48, 84, 48);
        c.fillStyle = '#65503c'; c.fillRect(-46, -20, 84, 6);
        c.fillStyle = '#5e4a38'; c.fillRect(36, -48, 16, 48);
        // 屋顶
        c.fillStyle = '#8f6f50'; c.beginPath();
        c.moveTo(-54, -46); c.lineTo(-8, -82); c.lineTo(62, -44); c.closePath(); c.fill();
        c.fillStyle = '#77593e'; c.beginPath();
        c.moveTo(-54, -46); c.lineTo(-8, -82); c.lineTo(4, -46); c.closePath(); c.fill();
        c.fillStyle = 'rgba(255,220,160,.10)'; c.beginPath();
        c.moveTo(-8, -82); c.lineTo(62, -44); c.lineTo(30, -44); c.closePath(); c.fill();
        // 屋顶补丁铁皮
        c.fillStyle = '#9a8a72'; c.fillRect(-26, -62, 16, 6);
        c.fillStyle = 'rgba(60,48,36,.4)'; c.fillRect(-26, -62, 16, 1.4);
        // 窗
        const glowWin = night ? '#ffd07a' : '#efc98e';
        c.fillStyle = 'rgba(255,214,140,.28)'; c.fillRect(-34, -38, 20, 22);
        c.fillStyle = glowWin; c.fillRect(-32, -36, 16, 18);
        c.fillStyle = night ? '#ffe4a8' : '#d8b884'; c.fillRect(8, -36, 14, 16);
        c.strokeStyle = '#3a2c20'; c.lineWidth = 1.6;
        c.strokeRect(-32, -36, 16, 18); c.strokeRect(8, -36, 14, 16);
        c.beginPath(); c.moveTo(-24, -36); c.lineTo(-24, -18); c.moveTo(15, -36); c.lineTo(15, -20); c.stroke();
        // 门与台阶
        c.fillStyle = '#43301f'; c.fillRect(-8, -24, 16, 24);
        c.fillStyle = '#c8a878'; c.fillRect(5, -12, 2.4, 2.4);
        c.fillStyle = '#6a5a48'; c.fillRect(-12, -2, 24, 3);
        // 烟囱
        c.fillStyle = '#5a5044'; c.fillRect(26, -92, 11, 22);
        c.fillStyle = '#494138'; c.fillRect(24, -94, 15, 4);
        // 外挂雨水桶/无线电
        c.strokeStyle = '#6a6050'; c.lineWidth = 1.6;
        c.beginPath(); c.moveTo(-40, -10); c.lineTo(-40, -34); c.stroke();
        c.beginPath(); c.arc(-40, -36, 4, 0, 7); c.stroke();
        // 等级：建筑总等级高 → 卫星锅 + 风灯
        const total = lv('workshop') + lv('greenhouse') + lv('barn') + lv('lab');
        if (total >= 9) {
          c.strokeStyle = '#9a9080'; c.lineWidth = 2;
          c.beginPath(); c.moveTo(31, -92); c.lineTo(36, -108); c.stroke();
          c.fillStyle = '#b0a898'; c.beginPath(); c.ellipse(39, -110, 7, 4.2, -.5, 0, 7); c.fill();
        }
        c.restore();
        smoke(hx + 32, hy - 116, 1.15);
        this._light(c, night, hx - 24 * S, hy - 26 * S, 30);
        this._light(c, night, hx + 15 * S, hy - 26 * S, 24);
      }

      /* 畜舍（左） */
      if (lv('barn') > 0) {
        const bx = 128, by = 232, S = 1.1, L = lv('barn');
        groundShadow(bx, by, 56);
        c.save(); c.translate(bx, by); c.scale(S, S);
        c.fillStyle = '#6e5038'; c.fillRect(-44, -36, 76, 36);
        c.fillStyle = '#8f4432'; c.beginPath(); c.moveTo(-50, -34); c.lineTo(-6, -64); c.lineTo(40, -32); c.closePath(); c.fill();
        c.fillStyle = '#3f2e22'; c.fillRect(-14, -26, 20, 26);
        c.strokeStyle = '#cbb492'; c.lineWidth = 1.3;
        c.beginPath(); c.moveTo(-14, -26); c.lineTo(6, 0); c.moveTo(6, -26); c.lineTo(-14, 0); c.stroke();
        c.fillStyle = night ? '#ffcf80' : '#c8a878'; c.fillRect(20, -28, 12, 12);
        c.restore();
        if (L >= 2) {
          c.strokeStyle = 'rgba(128,102,74,.95)'; c.lineWidth = 1.8;
          for (let i = 0; i < 8; i++) { const fx = bx - 70 + i * 17; c.beginPath(); c.moveTo(fx, by); c.lineTo(fx, by - 13); c.stroke(); }
          c.beginPath(); c.moveTo(bx - 72, by - 9); c.lineTo(bx + 50, by - 9); c.stroke();
        }
        if (L >= 3) {
          const wx = bx + 62, wy = by - 52;
          c.strokeStyle = '#5c4a38'; c.lineWidth = 2.6; c.beginPath(); c.moveTo(wx, by); c.lineTo(wx, wy); c.stroke();
          for (let i = 0; i < 4; i++) {
            const a = t * 1.5 + i * Math.PI / 2;
            c.strokeStyle = '#8a7a60'; c.lineWidth = 2;
            c.beginPath(); c.moveTo(wx, wy); c.lineTo(wx + Math.cos(a) * 14, wy + Math.sin(a) * 14); c.stroke();
          }
        }
        this._light(c, night, bx - 20, by - 26, 18);
        // 鸡
        if (L >= 2) for (let i = 0; i < 3; i++) {
          const cx = bx - 40 + i * 18 + Math.sin(t * .8 + i * 2) * 3, cy = by - 4;
          c.fillStyle = '#a08a6a'; c.beginPath(); c.ellipse(cx, cy, 4.2, 3.2, 0, 0, 7); c.fill();
          c.fillStyle = '#8a7452'; c.beginPath(); c.arc(cx + 4, cy - 3, 2, 0, 7); c.fill();
        }
      }

      /* 温室（右中） */
      if (lv('greenhouse') > 0) {
        const gx = 618, gy = 232, L = lv('greenhouse');
        groundShadow(gx, gy, 50);
        c.save(); c.translate(gx, gy);
        c.fillStyle = 'rgba(74,116,100,.55)'; c.fillRect(-46, -6, 92, 6);
        // 玻璃穹顶
        const dg = c.createLinearGradient(0, -48, 0, -6);
        dg.addColorStop(0, 'rgba(198,236,226,.64)'); dg.addColorStop(1, 'rgba(126,186,170,.42)');
        c.fillStyle = dg; c.beginPath(); c.ellipse(0, -6, 47, 34, 0, Math.PI, 0); c.closePath(); c.fill();
        c.strokeStyle = 'rgba(212,244,236,.72)'; c.lineWidth = 1.5;
        c.beginPath(); c.ellipse(0, -6, 47, 34, 0, Math.PI, 0); c.stroke();
        for (let i = -3; i <= 3; i++) { c.beginPath(); c.moveTo(i * 13, -6); c.lineTo(i * 7, -38 + Math.abs(i) * 2.6); c.stroke(); }
        c.beginPath(); c.moveTo(-47, -6); c.lineTo(47, -6); c.stroke();
        c.restore();
        this._light(c, night, gx, gy - 26, 30, 'rgba(150,255,205,.30)');
        if (L >= 3) { c.fillStyle = 'rgba(190,255,220,.6)'; for (let i = 0; i < 5; i++) c.fillRect(gx - 34 + i * 17, gy - 16, 3, 4); }
      }

      /* 加工研究所（中） */
      if (lv('workshop') > 0) {
        const wx = 470, wy = 232, L = lv('workshop');
        groundShadow(wx, wy, 44);
        c.save(); c.translate(wx, wy);
        c.fillStyle = '#675a48'; c.fillRect(-34, -42, 60, 42);
        c.fillStyle = '#544a3c'; c.fillRect(-38, -46, 68, 6);
        c.fillStyle = '#7a6a54'; c.fillRect(-26, -64, 12, 20);
        c.fillStyle = '#8a7a62'; c.fillRect(-30, -68, 20, 5);
        c.fillStyle = night ? '#ffc078' : '#c8a878'; c.fillRect(-16, -30, 14, 14);
        c.strokeStyle = '#3a2c20'; c.lineWidth = 1.4; c.strokeRect(-16, -30, 14, 14);
        c.restore();
        if (L >= 2) smoke(wx - 20, wy - 82, 1);
        if (L >= 3) {
          c.save(); c.translate(wx, wy);
          c.strokeStyle = '#8a8070'; c.lineWidth = 2;
          c.beginPath(); c.arc(22, -22, 7, 0, 7); c.stroke();
          for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; c.beginPath(); c.moveTo(22 + Math.cos(a) * 7, -22 + Math.sin(a) * 7); c.lineTo(22 + Math.cos(a) * 10, -22 + Math.sin(a) * 10); c.stroke(); }
          c.restore();
        }
        if (L >= 4) {
          c.strokeStyle = '#5a5044'; c.lineWidth = 1.8;
          c.beginPath(); c.moveTo(wx + 36, wy); c.lineTo(wx + 32, wy - 50); c.moveTo(wx + 48, wy); c.lineTo(wx + 44, wy - 50); c.stroke();
          c.beginPath(); c.moveTo(wx + 33, wy - 24); c.lineTo(wx + 43, wy - 32); c.stroke();
        }
        this._light(c, night, wx - 9, wy - 24, 22);
      }

      /* 研究所（远右） */
      if (lv('lab') > 0) {
        const lx = 796, ly = 232, L = lv('lab');
        groundShadow(lx, ly, 30);
        c.fillStyle = '#57544a'; c.fillRect(lx - 20, ly - 34, 34, 34);
        c.fillStyle = '#46443c'; c.fillRect(lx - 23, ly - 38, 40, 5);
        c.strokeStyle = '#8a8478'; c.lineWidth = 1.8;
        c.beginPath(); c.moveTo(lx - 3, ly - 38); c.lineTo(lx - 3, ly - 66); c.stroke();
        const blink = Math.sin(t * 3.2) > .55 ? .95 : .18;
        c.fillStyle = `rgba(190,244,255,${blink})`; c.beginPath(); c.arc(lx - 3, ly - 68, 2.4, 0, 7); c.fill();
        c.fillStyle = night ? 'rgba(150,220,255,.55)' : 'rgba(160,210,230,.4)';
        c.fillRect(lx - 14, ly - 28, 9, 9);
        c.restore && 0;
        if (L >= 3) { c.strokeStyle = '#8a8478'; c.lineWidth = 1.6; c.beginPath(); c.arc(lx + 20, ly - 52, 9, 0, 7); c.stroke(); c.beginPath(); c.moveTo(lx + 20, ly - 43); c.lineTo(lx + 20, ly - 34); c.stroke(); }
        this._light(c, night, lx - 6, ly - 24, 22, 'rgba(150,220,255,.26)');
      }
      return this._nightLights;
    },

    /* ---------- 5. 农田（16 地块 × 作物） ---------- */
    _farmland(c, G, t, ph, wk) {
      const winter = G.season === 'winter';
      const plots = G.farmPlots || [];
      const n = Math.min(G.unlockedPlots || 16, plots.length || 16);
      // 田块垫层（透视梯形，右侧让给河）
      const bg = c.createLinearGradient(0, 198, 0, H);
      bg.addColorStop(0, winter ? '#6a6152' : '#7a5c3a');
      bg.addColorStop(.4, winter ? '#544c40' : '#63482c');
      bg.addColorStop(1, winter ? '#403a32' : '#4a3220');
      c.fillStyle = bg;
      c.beginPath(); c.moveTo(20, 198); c.lineTo(620, 198); c.lineTo(664, H); c.lineTo(-24, H); c.closePath(); c.fill();
      // 田埂亮边
      c.strokeStyle = 'rgba(255,240,205,.12)'; c.lineWidth = 3;
      c.beginPath(); c.moveTo(20, 198); c.lineTo(620, 198); c.stroke();
      // 垄沟：越近越宽，交替明暗
      for (let i = 0; i <= 12; i++) {
        const p = i / 12, y = 198 + Math.pow(p, 1.5) * 102;
        const x0 = 20 - p * 64, x1 = 620 + p * 88;
        c.strokeStyle = i % 2 ? 'rgba(38,26,12,.32)' : 'rgba(160,128,80,.13)';
        c.lineWidth = 2.2 + p * 3.4;
        c.beginPath(); c.moveTo(x0, y); c.quadraticCurveTo((x0 + x1) / 2, y - 3 - p * 5, x1, y); c.stroke();
      }
      // 土粒质感
      for (let i = 0; i < 140; i++) {
        const px = 30 + hash(i * 2.1) * 600, py = 204 + hash(i * 5.7) * 94;
        c.fillStyle = i % 3 ? 'rgba(40,28,14,.22)' : 'rgba(190,160,110,.16)';
        c.fillRect(px, py, 1.6, 1.2);
      }
      // 16 块地：前 8 后 8，近大远小
      const cols = 8;
      for (let i = 0; i < 16; i++) {
        const r = i < 8 ? 0 : 1, col = i % 8;
        const far = r === 0;
        const px = 86 + col * 66 + (far ? 6 : 20) + (hash(i * 3.3) - .5) * 4;
        const py = far ? 216 : 258;
        const s = far ? 1.0 : 1.35;
        const plot = plots[i];
        const has = i < n && plot && plot.crop;
        // 地垄（小块凸起）
        c.fillStyle = has ? (plot.ready ? 'rgba(118,94,52,.98)' : 'rgba(96,74,42,.98)') : 'rgba(74,58,36,.7)';
        c.beginPath(); c.ellipse(px, py + 8 * s, 31 * s, 9.5 * s, 0, 0, 7); c.fill();
        c.fillStyle = 'rgba(160,128,80,.18)';
        c.beginPath(); c.ellipse(px, py + 5 * s, 28 * s, 7 * s, 0, 0, 7); c.fill();
        c.strokeStyle = 'rgba(30,22,10,.4)'; c.lineWidth = 1.3;
        c.beginPath(); c.ellipse(px, py + 8 * s, 31 * s, 9.5 * s, 0, 0, 7); c.stroke();
        if (has) this._crop(c, plot, px, py, s, t, winter);
        else {
          c.strokeStyle = 'rgba(128,138,84,.55)'; c.lineWidth = 1.2;
          for (let k = 0; k < 5; k++) {
            const gx = px - 14 + k * 7;
            c.beginPath(); c.moveTo(gx, py + 6); c.quadraticCurveTo(gx + 2, py - 2, gx + (k % 2 ? 5 : -3), py - 8); c.stroke();
          }
        }
      }
      // 稻草人
      const scare = (G.decorations || []).find(d => d.id === 'scarecrow');
      if (scare) {
        const sp = this.decoPosOf(scare);
        c.strokeStyle = '#6a5a44'; c.lineWidth = 2.6;
        c.beginPath(); c.moveTo(sp.x, sp.y + 12); c.lineTo(sp.x, sp.y - 26); c.stroke();
        c.beginPath(); c.moveTo(sp.x - 14, sp.y - 15); c.lineTo(sp.x + 14, sp.y - 15); c.stroke();
        c.fillStyle = '#8a7a58'; c.beginPath(); c.arc(sp.x, sp.y - 31, 5, 0, 7); c.fill();
        c.fillStyle = '#a8a070'; c.beginPath(); c.ellipse(sp.x, sp.y - 34, 8, 2.4, 0, 0, 7); c.fill();
        c.strokeStyle = 'rgba(90,74,50,.8)'; c.lineWidth = 1.4;
        c.beginPath(); c.moveTo(sp.x - 9, sp.y - 14); c.lineTo(sp.x - 15, sp.y - 4); c.moveTo(sp.x + 9, sp.y - 14); c.lineTo(sp.x + 16, sp.y - 6); c.stroke();
      }
    },

    /* 作物立绘：直接复用 assets/crops 里现成的 512×512 透明底作物图 */
    _cropImgs: {},
    _cropImg(id) {
      const known = ['wheat', 'corn', 'watermelon', 'pumpkin', 'sunflower', 'cabbage', 'carrot', 'moon_rice'];
      if (known.indexOf(id) < 0) return null;
      const hit = this._cropImgs[id];
      if (hit !== undefined) return hit;
      const im = new Image();
      im.__ok = false;
      // 新生成的俯视种植立绘优先；失败回落到原有商品视角立绘
      im.onload = () => { im.__ok = true; };
      im.onerror = () => {
        if (im.__triedFallback) { im.__ok = false; return; }
        im.__triedFallback = true;
        im.src = 'assets/crops/' + id + '_t.png';
      };
      im.src = 'assets/panorama/crop_' + id + '.png';
      this._cropImgs[id] = im;
      return im;
    },

    /* 底图风格作物：小簇笔触，颜色压暗降饱和，融入写实底图 */
    _cropPatch(cc, plot, px, py, s, t, winter) {
      const id = plot.crop.id;
      const prog = plot.ready ? 1 : clamp01((Date.now() - (plot.plantedAt || 0)) / Math.max(1, plot.crop.growTime * 1000));
      const h = (5 + prog * 15) * s;
      const sway = Math.sin(t * 1.6 + px * .07) * 1.1 * prog;
      const C = {
        wheat: ['#e2c064', '#b09640', '#f0d88a'], corn: ['#a4bc54', '#7a9638', '#c0d478'],
        watermelon: ['#6f9a4a', '#4c7234', '#8fbc64'], pumpkin: ['#d08a3a', '#9a5a26', '#e8a854'],
        sunflower: ['#e8cc4c', '#b89c34', '#8a7430'], cabbage: ['#8cb45e', '#669044', '#a8cc7a'],
        carrot: ['#a4bc54', '#7a9638', '#d0762e'], moon_rice: ['#d0d6c0', '#a4aa94', '#e8ecd8']
      }[id] || ['#a4bc54', '#7a9638', '#c0d478'];
      const grp = id === 'pumpkin' || id === 'watermelon' || id === 'cabbage';
      if (grp) {
        const rr = (4 + prog * 5) * s;
        cc.fillStyle = C[0];
        cc.beginPath(); cc.ellipse(px + sway * .2, py + 2, rr, rr * .8, 0, 0, 7); cc.fill();
        cc.fillStyle = C[2];
        cc.beginPath(); cc.ellipse(px + sway * .2 - rr * .25, py - rr * .15, rr * .5, rr * .32, -.3, 0, 7); cc.fill();
        cc.strokeStyle = C[1]; cc.lineWidth = 1 * s;
        cc.beginPath(); cc.moveTo(px + sway * .2, py - rr * .7); cc.lineTo(px + sway * .2 + 1.4 * s, py - rr * 1.05); cc.stroke();
        for (let k = -1; k <= 1; k++) {
          cc.beginPath(); cc.moveTo(px + sway * .2 + k * rr * .4, py); cc.quadraticCurveTo(px + sway * .2 + k * rr * .55, py + rr * .5, px + sway * .2 + k * rr * .5, py + rr * .8); cc.stroke();
        }
      } else if (id === 'sunflower') {
        const hy = py - h;
        cc.strokeStyle = C[1]; cc.lineWidth = 1.6 * s;
        cc.beginPath(); cc.moveTo(px, py + 3); cc.quadraticCurveTo(px + sway * .5, py - h * .5, px + sway, hy); cc.stroke();
        cc.fillStyle = C[0];
        for (let p = 0; p < 6; p++) { const a = p / 6 * Math.PI * 2; cc.beginPath(); cc.ellipse(px + sway + Math.cos(a) * 3.4 * s, hy + Math.sin(a) * 3.4 * s, 2.2 * s, 1.5 * s, a, 0, 7); cc.fill(); }
        cc.fillStyle = '#5a4a22'; cc.beginPath(); cc.arc(px + sway, hy, 2.2 * s, 0, 7); cc.fill();
      } else if (id === 'corn') {
        cc.strokeStyle = C[1]; cc.lineWidth = 1.8 * s;
        cc.beginPath(); cc.moveTo(px + sway * .3, py + 3); cc.quadraticCurveTo(px + sway * .6, py - h * .6, px + sway, py - h); cc.stroke();
        for (let k = 0; k < 3; k++) {
          cc.fillStyle = C[k % 3];
          cc.beginPath(); cc.ellipse(px + sway * .5 + (k - 1) * 2.4 * s, py - h * (.35 + k * .2), 2.6 * s, 1.4 * s, (k - 1) * .5, 0, 7); cc.fill();
        }
        cc.fillStyle = C[2]; cc.beginPath(); cc.ellipse(px + sway, py - h * .85, 1.6 * s, 4 * s, .1, 0, 7); cc.fill();
      } else {
        // 麦类/胡萝卜：细茎簇 + 穗
        const blades = id === 'carrot' ? 4 : 5;
        for (let k = 0; k < blades; k++) {
          const ox = (k - (blades - 1) / 2) * 2.6 * s;
          cc.strokeStyle = C[1]; cc.lineWidth = 1.2 * s;
          cc.beginPath(); cc.moveTo(px + ox, py + 3);
          cc.quadraticCurveTo(px + ox + sway * .3, py - h * .5, px + ox + sway, py - h * (.8 + (k % 2) * .12)); cc.stroke();
          if (prog > .4) {
            cc.fillStyle = C[0];
            const ty = py - h * (.8 + (k % 2) * .12);
            cc.beginPath(); cc.ellipse(px + ox + sway, ty, 1.1 * s, 2.6 * s, .1, 0, 7); cc.fill();
          }
        }
      }
    },

    _crop(c, plot, px, py, s, t, winter) {
      const id = plot.crop.id;
      const prog = plot.ready ? 1 : clamp01((Date.now() - (plot.plantedAt || 0)) / Math.max(1, plot.crop.growTime * 1000));
      const h = (10 + prog * 30) * s;
      const sway = Math.sin(t * 2 + px * .08) * 1.8 * prog;
      const P = {
        wheat: ['#e8c968', '#b8953c', '#8a7a3a'], corn: ['#b4cc58', '#7c9a3a', '#5e7a2c'],
        watermelon: ['#7cbc5c', '#3e7a36', '#2e5a2a'], pumpkin: ['#ec9036', '#a8541e', '#6a3a18'],
        sunflower: ['#f6dc56', '#c8a83a', '#6a4a24'], cabbage: ['#96c86c', '#5c9444', '#3c6a30'],
        carrot: ['#a8c858', '#6a9438', '#c87a3a'], moon_rice: ['#dcdcc0', '#a8b09a', '#8a968a']
      }[id] || ['#9ac060', '#6a9438', '#4a6a2c'];
      if (plot.ready) {
        const g = c.createRadialGradient(px, py - h * .4, 2, px, py - h * .4, 40 * s);
        g.addColorStop(0, 'rgba(255,240,160,.36)'); g.addColorStop(.5, 'rgba(255,226,130,.14)'); g.addColorStop(1, 'rgba(255,220,120,0)');
        c.fillStyle = g; c.fillRect(px - 40 * s, py - h * .4 - 40 * s, 80 * s, 80 * s);
      }
      const leaf = (x, y, len, ang, w) => {
        c.save(); c.translate(x, y); c.rotate(ang);
        c.fillStyle = P[1]; c.beginPath();
        c.moveTo(0, 0); c.quadraticCurveTo(len * .45, -w, len, 0); c.quadraticCurveTo(len * .45, w, 0, 0); c.fill();
        c.restore();
      };
      if (id === 'corn') {
        // 玉米：高秆 + 斜叶 + 穗
        c.strokeStyle = P[1]; c.lineWidth = 2.6 * s; c.lineCap = 'round';
        c.beginPath(); c.moveTo(px + sway * .3, py + 6); c.quadraticCurveTo(px + sway * .6, py - h * .5, px + sway, py - h); c.stroke();
        for (let k = 0; k < 4; k++) leaf(px + sway * .5, py - h * (.3 + k * .16), (12 - k) * s, (k % 2 ? .8 : -.8), 2.6 * s);
        c.fillStyle = P[0]; c.beginPath(); c.ellipse(px + sway, py - h * .78, 3.2 * s, 7 * s, .15, 0, 7); c.fill();
      } else if (id === 'moon_rice') {
        for (let k = -2; k <= 2; k++) {
          c.strokeStyle = P[1]; c.lineWidth = 1.8 * s;
          c.beginPath(); c.moveTo(px + k * 4 * s, py + 6); c.quadraticCurveTo(px + k * 4 * s + sway * .5, py - h * .6, px + k * 5 * s + sway, py - h * (.8 + Math.abs(k) * .04)); c.stroke();
          c.fillStyle = P[0]; c.beginPath(); c.ellipse(px + k * 5 * s + sway, py - h * (.8 + Math.abs(k) * .04), 1.7 * s, 4.2 * s, 0, 0, 7); c.fill();
        }
      } else if (id === 'wheat') {
        for (let k = -3; k <= 3; k++) {
          const ox = k * 3.4 * s;
          c.strokeStyle = P[1]; c.lineWidth = 1.6 * s;
          c.beginPath(); c.moveTo(px + ox, py + 7); c.quadraticCurveTo(px + ox + sway * .4, py - h * .55, px + ox + sway, py - h * (.82 + (Math.abs(k) % 2) * .1)); c.stroke();
          if (prog > .45) {
            c.fillStyle = P[0];
            const top = py - h * (.82 + (Math.abs(k) % 2) * .1);
            for (let e = 0; e < 3; e++) { c.beginPath(); c.ellipse(px + ox + sway + (e - 1) * 1.4 * s, top + e * 2.2 * s, 1.5 * s, 2.4 * s, .2, 0, 7); c.fill(); }
          }
        }
      } else if (id === 'sunflower') {
        c.strokeStyle = P[1]; c.lineWidth = 3 * s;
        c.beginPath(); c.moveTo(px, py + 7); c.quadraticCurveTo(px + sway * .5, py - h * .5, px + sway, py - h); c.stroke();
        leaf(px + sway * .4, py - h * .45, 13 * s, -1.0, 3.4 * s);
        leaf(px + sway * .4, py - h * .55, 13 * s, 3.3, 3.4 * s);
        const fx = px + sway, fy = py - h;
        c.fillStyle = P[0];
        for (let p = 0; p < 10; p++) { const a = p / 10 * Math.PI * 2; c.beginPath(); c.ellipse(fx + Math.cos(a) * 7 * s * (.6 + prog * .4), fy + Math.sin(a) * 7 * s * (.6 + prog * .4), 3.4 * s, 2.2 * s, a, 0, 7); c.fill(); }
        c.fillStyle = P[2]; c.beginPath(); c.arc(fx, fy, 4.2 * s, 0, 7); c.fill();
      } else if (id === 'pumpkin' || id === 'watermelon') {
        const rr = (9 + prog * 9) * s;
        c.fillStyle = P[0]; c.beginPath(); c.ellipse(px + sway * .2, py + 2, rr, rr * .82, 0, 0, 7); c.fill();
        c.strokeStyle = P[1]; c.lineWidth = 1.4 * s;
        for (let k = -2; k <= 2; k++) { c.beginPath(); c.ellipse(px + sway * .2, py + 2, rr * (.25 + Math.abs(k) * .3), rr * .82, 0, -Math.PI / 2, Math.PI / 2); c.stroke(); }
        c.fillStyle = P[2]; c.beginPath(); c.ellipse(px + sway * .2, py + 3, rr * .9, rr * .8, 0, .2, Math.PI - .2); c.fill();
        c.strokeStyle = P[1]; c.lineWidth = 1.6 * s; c.beginPath(); c.moveTo(px + sway * .2, py - rr * .8); c.lineTo(px + sway * .2 + 2 * s, py - rr * 1.1); c.stroke();
      } else if (id === 'cabbage') {
        const rr = (8 + prog * 8) * s;
        for (let k = 2; k >= 0; k--) {
          c.fillStyle = k === 0 ? P[0] : P[1];
          c.beginPath(); c.arc(px + sway * .2, py - k * 2 * s, rr * (1 - k * .22), Math.PI * (.1 + k * .1), Math.PI * (1 - k * .1)); c.fill();
        }
        c.strokeStyle = P[2]; c.lineWidth = 1.1 * s;
        c.beginPath(); c.moveTo(px + sway * .2, py - rr); c.lineTo(px + sway * .2, py); c.stroke();
      } else {
        // 胡萝卜/其他：叶丛
        for (let k = -2; k <= 2; k++) {
          const ox = k * 4 * s;
          c.strokeStyle = P[1]; c.lineWidth = 1.6 * s;
          c.beginPath(); c.moveTo(px + ox, py + 7); c.quadraticCurveTo(px + ox + sway * .4, py - h * .5, px + ox + sway * 1.2, py - h * (.7 + Math.abs(k) * .08)); c.stroke();
          c.fillStyle = P[0]; c.beginPath(); c.ellipse(px + ox + sway * 1.2, py - h * (.7 + Math.abs(k) * .08), 1.6 * s, 3.2 * s, k * .3, 0, 7); c.fill();
        }
      }
    },

    /* ---------- 6. 河流 / 桥 / 前景 ---------- */
    _water(c, G, t, ph) {
      const winter = G.season === 'winter', night = ph.night;
      const rg = c.createLinearGradient(600, 200, 900, H);
      if (night) { rg.addColorStop(0, '#2a3a4e'); rg.addColorStop(.5, '#33465a'); rg.addColorStop(1, '#26384a'); }
      else if (winter) { rg.addColorStop(0, '#7d96a2'); rg.addColorStop(.5, '#8ea8b0'); rg.addColorStop(1, '#6a848e'); }
      else { rg.addColorStop(0, '#4f7c86'); rg.addColorStop(.5, '#5d8e94'); rg.addColorStop(1, '#436c78'); }
      c.fillStyle = rg;
      c.beginPath(); c.moveTo(668, 208); c.quadraticCurveTo(790, 224, 900, 250); c.lineTo(900, H); c.lineTo(640, H); c.quadraticCurveTo(700, 268, 668, 208); c.closePath(); c.fill();
      // 河岸线
      c.strokeStyle = 'rgba(232,238,220,.26)'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(668, 208); c.quadraticCurveTo(790, 224, 900, 250); c.stroke();
      c.strokeStyle = 'rgba(22,32,30,.25)'; c.lineWidth = 3;
      c.beginPath(); c.moveTo(640, H); c.quadraticCurveTo(704, 266, 668, 208); c.stroke();
      // 波光
      c.strokeStyle = night ? 'rgba(170,195,240,.22)' : 'rgba(230,244,236,.24)'; c.lineWidth = 1.2;
      for (let i = 0; i < 16; i++) {
        const y = 216 + i * 5.2, base = 640 + (y - 216) * .9;
        const x = base + Math.sin(t * .9 + i * 1.7) * 8;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + 16 + i, y); c.stroke();
      }
      if (night) {
        c.save(); c.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 14; i++) {
          const y = 220 + i * 5, x = 700 + i * 12 + Math.sin(t + i) * 6;
          c.fillStyle = `rgba(190,210,255,${(0.05 + 0.07 * Math.abs(Math.sin(t * 1.4 + i))).toFixed(3)})`;
          c.beginPath(); c.ellipse(x, y, 7, 1.4, 0, 0, 7); c.fill();
        }
        c.restore();
      }
      // 木桥
      c.strokeStyle = '#5f4a30'; c.lineWidth = 5;
      c.beginPath(); c.moveTo(700, 214); c.quadraticCurveTo(772, 232, 848, 238); c.stroke();
      c.strokeStyle = '#7a6040'; c.lineWidth = 2.2;
      for (let i = 0; i < 8; i++) { const bx = 708 + i * 18, by = 218 + i * 3.2; c.beginPath(); c.moveTo(bx, by); c.lineTo(bx, by - 11); c.stroke(); }
      c.beginPath(); c.moveTo(706, 210); c.quadraticCurveTo(772, 226, 848, 232); c.stroke();
    },

    _fore(c, G, t, ph, wk) {
      const winter = G.season === 'winter';
      // 栅栏
      c.strokeStyle = 'rgba(88,70,50,.95)'; c.lineWidth = 2.2;
      for (let i = 0; i < 10; i++) {
        const x = 4 + i * 21, y = 246 + (i % 3) * 3;
        c.beginPath(); c.moveTo(x, y + 12); c.lineTo(x - (i % 4 === 0 ? 4 : 0), y - 12); c.stroke();
      }
      c.strokeStyle = 'rgba(96,76,54,.95)'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(0, 240); c.lineTo(200, 249); c.stroke();
      c.beginPath(); c.moveTo(0, 254); c.lineTo(200, 262); c.stroke();
      // 前景草丛
      for (let i = 0; i < 46; i++) {
        const x = hash(i * 2.7) * W, y = 268 + hash(i * 5.1) * 32;
        c.strokeStyle = winter ? 'rgba(220,228,232,.55)' : `rgba(${70 + (i % 26)},${96 + (i % 34)},${46 + (i % 18)},.6)`;
        c.lineWidth = 1.2;
        for (let k = -1; k <= 1; k++) { c.beginPath(); c.moveTo(x + k * 2.2, y); c.quadraticCurveTo(x + k * 3 + 1, y - 6, x + k * 4.4, y - 11); c.stroke(); }
      }
      // 碎石 / 残骸
      for (let i = 0; i < 20; i++) {
        const x = hash(i * 9.3) * 600, y = 258 + hash(i * 4.7) * 40;
        c.fillStyle = `rgba(${76 + i},${72 + i},${62 + i},.8)`;
        c.beginPath(); c.ellipse(x, y, 2 + (i % 5), 1.3 + (i % 3), hash(i) * 3, 0, 7); c.fill();
      }
      // 破警示牌
      c.save(); c.translate(556, 258); c.rotate(-.1);
      c.fillStyle = '#5a5044'; c.fillRect(-2, 0, 4.5, 18);
      c.fillStyle = '#a08a3c'; c.fillRect(-11, -9, 22, 13);
      c.fillStyle = '#332e20'; c.font = 'bold 8px sans-serif'; c.fillText('!', -2, 1);
      c.restore();
      // 废车残骸（右下角）
      c.save(); c.translate(760, 286);
      c.fillStyle = '#4a4a44'; c.beginPath(); c.ellipse(0, 0, 34, 8, 0, 0, 7); c.fill();
      c.fillStyle = '#3c3c36'; c.fillRect(-24, -10, 44, 8);
      c.fillStyle = '#2e2e2a'; c.beginPath(); c.arc(-14, -2, 6, 0, 7); c.fill(); c.beginPath(); c.arc(14, -2, 6, 0, 7); c.fill();
      c.strokeStyle = 'rgba(150,140,120,.5)'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(-24, -6); c.lineTo(-30, -12); c.stroke();
      c.restore();
      // 雨天水洼
      if (wk === 'rain' || wk === 'heavy_rain' || wk === 'storm') {
        for (let i = 0; i < 7; i++) {
          const x = 60 + hash(i * 6.7) * 520, y = 256 + hash(i * 3.1) * 40;
          c.fillStyle = 'rgba(170,195,200,.20)'; c.beginPath(); c.ellipse(x, y, 12 + i * 2, 3.4, 0, 0, 7); c.fill();
        }
      }
    },


    /* 底图版：作物按底图前景垄沟排布（两排 × 8），真正跟 farmPlots 对应 */
    _cropsOnBase(c, G, t, live) {
      const plots = G.farmPlots || [];
      const n = Math.min(G.unlockedPlots || 16, plots.length || 16);
      const winter = G.season === 'winter';
      // 作物画在离屏层，再整体压暗/降饱和后贴回底图——避免"贴纸感"
      if (!this._cropC) { this._cropC = document.createElement('canvas'); this._cropC.width = W; this._cropC.height = H; }
      const oc = this._cropC.getContext('2d');
      oc.setTransform(1, 0, 0, 1, 0, 0);
      oc.clearRect(0, 0, W, H);
      const cc = oc;
      // 两排沿底图垄沟的透视线（近大远小、左右收窄）
      // 两排严格落在底图的耕地垄沟上（左侧开垦区，避开右侧河滩乱石）
      const ROWS = [
        { x0: 104, x1: 396, y0: 212, y1: 226, s: 1.02 },
        { x0: 92, x1: 412, y0: 250, y1: 264, s: 1.24 }
      ];
      cc.save();
      // 压低饱和度与亮度，让作物融进底图的画风
      try { cc.filter = 'saturate(0.78) brightness(0.92)'; } catch (e) {}
      for (let i = 0; i < 16; i++) {
        const row = i < 8 ? 0 : 1, col = i % 8;
        const R = ROWS[row];
        const k = col / 7;
        const px = R.x0 + (R.x1 - R.x0) * k + (hash(i * 3.3) - .5) * 4;
        const py = R.y0 + (R.y1 - R.y0) * k + (row ? 0 : (hash(i * 5.1) - .5) * 3);
        const s = R.s * (0.92 + k * 0.16);
        const plot = plots[i];
        const has = i < n && plot && plot.crop;
        if (!has) continue;
        // 接地阴影（立绘自带土堆，不再额外画土垄）
        cc.fillStyle = 'rgba(14,10,6,.38)';
        cc.beginPath(); cc.ellipse(px, py + 7 * s, 18 * s, 5 * s, 0, 0, 7); cc.fill();
        const prog = plot.ready ? 1 : Math.max(0, Math.min(1, (Date.now() - (plot.plantedAt || 0)) / Math.max(1, plot.crop.growTime * 1000)));
        const img = this._cropImg(plot.crop.id);
        if (img && img.__ok) {
          const asp = (img.naturalWidth / img.naturalHeight) || 1;
          const hh = (20 + prog * 34) * s / Math.sqrt(Math.max(0.55, asp));
          const ww = hh * asp;
          if (plot.ready) {
            const g = cc.createRadialGradient(px, py - hh * .4, 2, px, py - hh * .4, 30 * s);
            g.addColorStop(0, 'rgba(255,238,150,.24)'); g.addColorStop(1, 'rgba(255,224,120,0)');
            cc.fillStyle = g; cc.fillRect(px - 30 * s, py - hh * .4 - 30 * s, 60 * s, 60 * s);
          }
          cc.save();
          cc.globalAlpha = 0.96;
          // 轻微透视压扁 + 随机倾角：让立绘"种"在地面上而不是贴纸
          cc.translate(px, py + 6 * s);
          cc.rotate((hash(i * 7.7) - .5) * .08);
          cc.scale(1, (row ? 1.0 : 0.94) + (hash(i * 2.3) - .5) * .04);
          cc.drawImage(img, -ww / 2, -hh, ww, hh);
          cc.restore();
        } else {
          this._cropPatch(cc, plot, px, py, s, live ? t : 0, winter);
        }
      }
      try { cc.filter = 'none'; } catch (e) {}
      cc.restore();
      // 整体压暗 + 降饱和，让作物融进底图画风
      oc.save();
      oc.globalCompositeOperation = 'source-atop';
      const _ph0 = this.phaseOf();
      oc.fillStyle = _ph0.night ? 'rgba(10,14,22,.40)' : _ph0.dusk ? 'rgba(34,18,10,.14)' : 'rgba(14,11,8,.10)';
      oc.fillRect(0, 0, W, H);
      oc.restore();
      c.save();
      c.globalAlpha = 0.97;
      c.drawImage(this._cropC, 0, 0);
      c.restore();
    },

    /* 建筑等级小特效：烟囱冒烟 / 温室补光 / 研究所闪灯（位置对齐底图建筑） */
    _buildingFX(c, G, t, ph) {
      const bl = G.buildings || {};
      const lv = id => (bl[id] && bl[id].level) || 0;
      const night = ph.night;
      this._nightLights = [[416, 126, 34], [446, 122, 26], [600, 150, 30]];
      // 温室补光（底图温室 ≈ x 574, y 150）
      if (lv('greenhouse') >= 2) {
        const a = night ? .35 : .16;
        const g = c.createRadialGradient(574, 148, 2, 574, 148, 34);
        g.addColorStop(0, `rgba(150,255,205,${a})`); g.addColorStop(1, 'rgba(120,230,180,0)');
        c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = g; c.fillRect(540, 114, 68, 68); c.restore();
      }
      // 加工研究所烟囱烟（底图谷仓左侧风车附近）
      if (lv('workshop') >= 2) {
        for (let k = 0; k < 4; k++) {
          const p = ((t * .22 + k * .25) % 1);
          c.fillStyle = `rgba(200,196,186,${((1 - p) * .14).toFixed(3)})`;
          c.beginPath(); c.arc(300 + Math.sin(t * .6 + k) * 6 + p * 16, 112 - p * 46, 3 + p * 9, 0, 7); c.fill();
        }
      }
      // 研究所天线闪灯（底图主屋屋顶）
      if (lv('lab') >= 2) {
        const blink = Math.sin(t * 3.1) > .5 ? .95 : .12;
        c.fillStyle = `rgba(190,244,255,${blink})`;
        c.beginPath(); c.arc(432, 78, 2.6, 0, 7); c.fill();
        if (night) { c.save(); c.globalCompositeOperation = 'lighter'; const g = c.createRadialGradient(432, 78, 1, 432, 78, 20); g.addColorStop(0, 'rgba(150,230,255,.4)'); g.addColorStop(1, 'rgba(120,200,255,0)'); c.fillStyle = g; c.fillRect(412, 58, 40, 40); c.restore(); }
      }
      // 夜间窗户呼吸光（对齐底图房子窗）
      if (night) {
        for (const [lx, ly, lr] of [[416, 126, 26], [446, 122, 20]]) {
          c.save(); c.globalCompositeOperation = 'lighter';
          const g = c.createRadialGradient(lx, ly, 1, lx, ly, lr);
          g.addColorStop(0, 'rgba(255,198,110,.30)'); g.addColorStop(1, 'rgba(255,180,90,0)');
          c.fillStyle = g; c.fillRect(lx - lr, ly - lr, lr * 2, lr * 2); c.restore();
        }
      }
    },
    /* ---------- 7. 天气粒子 / 调色 / 电影感 ---------- */
    _weatherFX(c, G, t, ph) {
      const wk = this._weatherOf(G), pal = WEATHER[wk];
      const winter = G.season === 'winter';
      if (pal.rain > 0) {
        const n = Math.round(120 * pal.rain);
        c.strokeStyle = `rgba(198,214,216,${(0.18 + pal.rain * 0.24).toFixed(2)})`; c.lineWidth = 1;
        for (let i = 0; i < n; i++) {
          const x = ((i * 97 + t * 300) % (W + 80)) - 40;
          const y = ((i * 53 + t * 480) % (H + 80)) - 40;
          const len = 9 + pal.rain * 10;
          c.beginPath(); c.moveTo(x, y); c.lineTo(x - 2.6, y + len); c.stroke();
        }
        for (let i = 0; i < 20; i++) {
          const x = hash(i * 3.9) * W, y = 224 + hash(i * 5.3) * 72;
          const a = (Math.sin(t * 8 + i * 2.1) + 1) / 2;
          if (a < .62) continue;
          c.fillStyle = `rgba(210,224,224,${((a - .62) * .8).toFixed(2)})`;
          c.beginPath(); c.arc(x, y, 1.3, 0, 7); c.fill();
        }
      }
      if (winter) {
        for (let i = 0; i < 90; i++) {
          const x = (hash(i * 4.1) * W + Math.sin(t * .45 + i) * 16 + t * 10) % W;
          const y = (hash(i * 7.3) * H + t * (14 + (i % 5) * 7)) % H;
          c.fillStyle = `rgba(242,248,252,${(.5 + (i % 4) * .12).toFixed(2)})`;
          c.beginPath(); c.arc(x, y, 1.1 + (i % 3) * .7, 0, 7); c.fill();
        }
      }
      if (pal.fog) {
        for (let i = 0; i < 6; i++) {
          const y = 140 + i * 24 + Math.sin(t * .25 + i) * 5;
          const g = c.createLinearGradient(0, y - 22, 0, y + 22);
          g.addColorStop(0, 'rgba(214,216,206,0)');
          g.addColorStop(.5, `rgba(214,216,206,${(.14 + i * .035).toFixed(2)})`);
          g.addColorStop(1, 'rgba(214,216,206,0)');
          c.fillStyle = g; c.fillRect(0, y - 22, W, 44);
        }
      }
      if (wk === 'storm') {
        const flash = Math.sin(t * 11.3) > .97 || Math.sin(t * 6.7) > .985;
        if (flash) {
          c.fillStyle = 'rgba(220,232,255,.16)'; c.fillRect(0, 0, W, H);
          c.strokeStyle = 'rgba(230,240,255,.65)'; c.lineWidth = 2;
          const bx = 180 + hash(Math.floor(t)) * 500;
          c.beginPath(); c.moveTo(bx, 20); c.lineTo(bx - 12, 60); c.lineTo(bx + 6, 66); c.lineTo(bx - 10, 108); c.stroke();
        }
      }
      // 灰烬/浮尘（末世感）
      for (let i = 0; i < 30; i++) {
        const x = (hash(i * 8.1) * W + t * (5 + i % 6)) % W;
        const y = (60 + (hash(i * 3.7) * 220 + Math.sin(t * .5 + i) * 7)) % 280;
        c.fillStyle = wk === 'fog' ? 'rgba(200,200,190,.10)' : 'rgba(222,204,166,.16)';
        c.fillRect(x, y, 1.7, 1.7);
      }
      if (pal.dark > 0) { c.fillStyle = `rgba(22,28,32,${(pal.dark * .38).toFixed(2)})`; c.fillRect(0, 0, W, H); }
    },

    _grade(c, G, t, ph, wk) {
      const night = ph.night, dusk = ph.dusk, dawn = ph.dawn;
      if (night) {
        c.save(); c.globalCompositeOperation = 'multiply';
        const g = c.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#7a86ac'); g.addColorStop(.55, '#74809e'); g.addColorStop(1, '#6a6472');
        c.fillStyle = g; c.fillRect(0, 0, W, H); c.restore();
        c.save(); c.globalCompositeOperation = 'soft-light';
        c.fillStyle = 'rgba(110,150,220,.20)'; c.fillRect(0, 0, W, H); c.restore();
      } else if (dusk) {
        c.save(); c.globalCompositeOperation = 'multiply';
        c.fillStyle = 'rgba(255,206,168,.34)'; c.fillRect(0, 0, W, H); c.restore();
        c.save(); c.globalCompositeOperation = 'overlay';
        const g = c.createLinearGradient(0, 60, 0, 220);
        g.addColorStop(0, 'rgba(255,150,70,0)'); g.addColorStop(.6, 'rgba(255,150,70,.20)'); g.addColorStop(1, 'rgba(255,120,50,0)');
        c.fillStyle = g; c.fillRect(0, 60, W, 160); c.restore();
      } else if (dawn) {
        c.save(); c.globalCompositeOperation = 'multiply';
        c.fillStyle = 'rgba(246,224,212,.26)'; c.fillRect(0, 0, W, H); c.restore();
      }
      // 季节
      if (G.season === 'autumn') { c.save(); c.globalCompositeOperation = 'soft-light'; c.fillStyle = 'rgba(226,150,66,.18)'; c.fillRect(0, 0, W, H); c.restore(); }
      if (G.season === 'winter') { c.save(); c.globalCompositeOperation = 'soft-light'; c.fillStyle = 'rgba(196,214,232,.26)'; c.fillRect(0, 0, W, H); c.restore(); }
      // 末世青橙
      c.save(); c.globalCompositeOperation = 'soft-light';
      const tg = c.createLinearGradient(0, 0, 0, H);
      tg.addColorStop(0, 'rgba(110,150,175,.12)'); tg.addColorStop(.6, 'rgba(170,150,130,.08)'); tg.addColorStop(1, 'rgba(130,112,86,.12)');
      c.fillStyle = tg; c.fillRect(0, 0, W, H); c.restore();
    },

    _filmic(c) {
      const vg = c.createRadialGradient(W / 2, H * .5, H * .38, W / 2, H * .5, H * 1.05);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(.72, 'rgba(0,0,0,.10)'); vg.addColorStop(1, 'rgba(0,0,0,.38)');
      c.fillStyle = vg; c.fillRect(0, 0, W, H);
      c.save(); c.globalAlpha = .04;
      for (let i = 0; i < 240; i++) {
        const x = hash(i * 1.9) * W, y = hash(i * 3.1) * H;
        c.fillStyle = i % 2 ? '#ffffff' : '#000000';
        c.fillRect(x, y, 1, 1);
      }
      c.restore();
    },

    _scene(c, G, t, live, withCrops) {
      const ph = this.phaseOf(), wk = this._weatherOf(G);
      const pal = WEATHER[wk] || WEATHER.clear;
      // ===== 主路径：AI 全景底图 + 数据驱动叠加 =====
      if (this._drawBase(c)) {
        this._gradeBase(c, G, t, ph, wk);
        this._buildingFX(c, G, t, ph);
        if (withCrops) this._cropsOnBase(c, G, t, live);
        if (pal.fog) {
          // 雾天：地平线湿雾，不盖前景
          const fg = c.createLinearGradient(0, 90, 0, 250);
          fg.addColorStop(0, 'rgba(228,230,222,.06)');
          fg.addColorStop(.5, 'rgba(228,230,222,.26)');
          fg.addColorStop(1, 'rgba(228,230,222,0)');
          c.fillStyle = fg; c.fillRect(0, 90, W, 160);
        }
        if (pal.dark > 0) { c.fillStyle = `rgba(20,26,30,${(pal.dark * .30).toFixed(2)})`; c.fillRect(0, 0, W, H); }
        this._filmic(c);
        return;
      }
      this._sky(c, G, t, ph, wk);
      if (pal.sun > 0 && !ph.night) {
        // 日冕光束
        c.save(); c.globalCompositeOperation = 'lighter';
        const sx = 736, sy = ph.dusk ? 104 : 62;
        for (let i = 0; i < 5; i++) {
          const a = .05 + .03 * Math.sin(t * .6 + i);
          c.fillStyle = `rgba(255,238,190,${a.toFixed(3)})`;
          c.beginPath(); c.moveTo(sx, sy); c.lineTo(sx - 160 + i * 70, HZ + 10); c.lineTo(sx - 120 + i * 70, HZ + 10); c.closePath(); c.fill();
        }
        c.restore();
      }
      this._city(c, t, ph, wk);
      this._hills(c, ph, wk);
      this._buildings(c, G, t, ph);
      this._farmland(c, G, t, ph, wk);
      this._water(c, G, t, ph);
      this._fore(c, G, t, ph, wk);
      this._grade(c, G, t, ph, wk);
      this._filmic(c);
    },


    /* 底图调色：时段/天气/季节统一色温，和程序化路径同一套语言 */
    _gradeBase(c, G, t, ph, wk) {
      const night = ph.night, dusk = ph.dusk, dawn = ph.dawn;
      if (night) {
        c.save(); c.globalCompositeOperation = 'multiply';
        const g = c.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#5c6a92'); g.addColorStop(.55, '#5a6280'); g.addColorStop(1, '#4e4a58');
        c.fillStyle = g; c.fillRect(0, 0, W, H); c.restore();
        c.save(); c.globalCompositeOperation = 'soft-light';
        c.fillStyle = 'rgba(110,150,220,.22)'; c.fillRect(0, 0, W, H); c.restore();
      } else if (dusk) {
        c.save(); c.globalCompositeOperation = 'multiply';
        c.fillStyle = 'rgba(255,204,164,.30)'; c.fillRect(0, 0, W, H); c.restore();
        c.save(); c.globalCompositeOperation = 'overlay';
        const g = c.createLinearGradient(0, 40, 0, 260);
        g.addColorStop(0, 'rgba(255,150,70,0)'); g.addColorStop(.55, 'rgba(255,150,70,.18)'); g.addColorStop(1, 'rgba(255,120,50,0)');
        c.fillStyle = g; c.fillRect(0, 40, W, 220); c.restore();
      } else if (dawn) {
        c.save(); c.globalCompositeOperation = 'multiply';
        c.fillStyle = 'rgba(246,226,214,.22)'; c.fillRect(0, 0, W, H); c.restore();
      }
      if (G.season === 'autumn') { c.save(); c.globalCompositeOperation = 'soft-light'; c.fillStyle = 'rgba(226,156,70,.16)'; c.fillRect(0, 0, W, H); c.restore(); }
      if (G.season === 'winter') { c.save(); c.globalCompositeOperation = 'soft-light'; c.fillStyle = 'rgba(196,214,232,.26)'; c.fillRect(0, 0, W, H); c.restore(); }
      if (wk === 'fog') { c.fillStyle = 'rgba(222,224,216,.10)'; c.fillRect(0, 0, W, H); }
    },
    /* ---------- 入口 ---------- */
    /* 等比铺满（cover）：面板变高时裁边而不是拉伸 */
    _fit(c, Wc, Hc) {
      const s = Math.max(Wc / W, Hc / H);
      c.translate((Wc - W * s) / 2, (Hc - H * s) / 2);
      c.scale(s, s);
    },
    draw(c, Wc, Hc, t) {
      c.save(); this._fit(c, Wc, Hc);
      const G = GameState;
      this._scene(c, G, t, true, true);
      this._weatherFX(c, G, t, this.phaseOf());
      c.restore();
    },
    bakeStatic() {
      if (!this._bakeC) { this._bakeC = document.createElement('canvas'); this._bakeC.width = W; this._bakeC.height = H; }
      const c = this._bakeC.getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H);
      this._scene(c, GameState, 0, false, false);
      return { canvas: this._bakeC, lights: this._nightLights, night: this.phaseOf().night };
    },
    drawDynamic(c, Wc, Hc, t) {
      c.save(); this._fit(c, Wc, Hc);
      const G = GameState;
      // 作物实况（Pixi 烘焙层不含作物，这里每帧补上，成长/成熟立即反映）
      if (this._drawBase(c)) this._cropsOnBase(c, G, t, true);
      this._weatherFX(c, G, t, this.phaseOf());
      c.restore();
    }
  };
  window.FarmPanorama = FarmPanorama;
})();
