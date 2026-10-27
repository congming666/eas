/* ============================================================
   GroundDetail —— P12-a 地表层次增强
   解决正俯视下地面"平、空、重复、廉价"的问题（2D 手绘 + 3D 烘焙双通道同时受益）：
   1) renderMacro()：大尺度、世界锚定、软边的生态宏观色差斑块（裸土/苔藓/枯草/焦痕/霜盐…），
      打破单张地表 tile 均匀平铺的重复感；
   2) renderDecals()：主题化贴地贴花（落叶/碎石/水洼/苔藓/焦痕/骨屑/车辙/裂缝），
      两级"簇心 + 簇内"成簇分布，世界锚定、确定性、无跨 chunk 接缝；
   3) groundNormalTexture()：无缝多频噪声生成的法线贴图，给 3D 地面正俯视制造颗粒起伏，
      配合粗糙度变化，让光照在顶视角仍能读出地表凹凸。
   开关：localStorage.farmGroundP12  默认开，'0'/'off' 关闭回退原地表。
   纯确定性（同图同位置每次一致），任何异常静默跳过，绝不阻断渲染。
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'farmGroundP12';
  function enabled() {
    try { var v = localStorage.getItem(KEY); return !(v === '0' || v === 'off'); } catch (e) { return true; }
  }

  /* ---------- 确定性 hash（与 terrainHash 风格一致，整数网格 → [0,1)） ---------- */
  function h2(x, y, s) {
    var n = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  function rgb(r, g, b) { return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')'; }
  function rgba(r, g, b, a) { return 'rgba(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ',' + a + ')'; }
  function hexToRgb(hex) {
    var n = parseInt((hex || '#466038').replace('#', ''), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function shade(c, f) { // f>0 提亮，f<0 压暗
    if (f >= 0) return { r: c.r + (255 - c.r) * f, g: c.g + (255 - c.g) * f, b: c.b + (255 - c.b) * f };
    return { r: c.r * (1 + f), g: c.g * (1 + f), b: c.b * (1 + f) };
  }

  /* ---------- 各 tier 的主题色族（宏观斑块 + 贴花） ---------- */
  // 宏观斑块：每族若干 {rgb, 倾向权重}
  function palette(tier, base) {
    var dark = shade(base, -0.26), light = shade(base, 0.16), warm = shade(base, -0.12);
    var P = {
      1: { // 绿野：以亮草/苔藓/深草为主，裸土仅偶尔点缀（去掉独立水洼，水面交给真实水域生态区）
        macro: [shade(base, 0.08), shade(base, -0.15), { r: 96, g: 138, b: 78 }, shade(base, 0.08), { r: 96, g: 138, b: 78 }, { r: 122, g: 104, b: 70 }],
        decal: ['moss', 'grassDark', 'leaf', 'moss', 'pebble']
      },
      2: { // 废墟
        macro: [shade(base, 0.10), shade(base, -0.18), { r: 120, g: 102, b: 74 }, { r: 92, g: 90, b: 82 }, { r: 120, g: 102, b: 74 }],
        decal: ['pebble', 'bareSoil', 'rubble', 'track', 'bone', 'grassDark']
      },
      3: { // 灾变
        macro: [shade(base, -0.20), { r: 96, g: 58, b: 46 }, { r: 96, g: 110, b: 62 }, { r: 120, g: 60, b: 52 }],
        decal: ['scorch', 'ash', 'crack', 'pebble', 'toxicMoss', 'bone']
      },
      4: { // 绝境
        macro: [shade(base, 0.12), shade(base, -0.20), { r: 150, g: 140, b: 170 }, { r: 190, g: 180, b: 160 }],
        decal: ['salt', 'crack', 'bone', 'pebble', 'frost', 'glowMoss']
      }
    };
    return P[tier] || P[1];
  }

  /* ====================================================================
     1) 宏观斑块：大尺度软边色差
     ==================================================================== */
  function renderMacro(ctx, exp, cam, viewW, viewH) {
    if (!enabled()) return;
    try {
      var theme = (exp.map && exp.map.terrain) || {};
      var tier = (exp.map && exp.map.tier) || 1;
      var base = hexToRgb(theme.ground || '#466038');
      var pal = palette(tier, base).macro;
      var cell = 760;                 // 大网格，制造宏观分区
      var gx0 = Math.floor(cam.x / cell) - 1, gy0 = Math.floor(cam.y / cell) - 1;
      var gx1 = Math.floor((cam.x + viewW) / cell) + 1, gy1 = Math.floor((cam.y + viewH) / cell) + 1;
      ctx.save();
      for (var gy = gy0; gy <= gy1; gy++) {
        for (var gx = gx0; gx <= gx1; gx++) {
          // 每格 0~2 个斑块，成簇
          var n = h2(gx, gy, 71) < 0.55 ? 1 : (h2(gx, gy, 72) < 0.5 ? 2 : 0);
          for (var k = 0; k < n; k++) {
            var wx = gx * cell + h2(gx, gy, 80 + k * 7) * cell;
            var wy = gy * cell + h2(gx, gy, 90 + k * 7) * cell;
            var x = wx - cam.x, y = wy - cam.y;
            if (x < -700 || y < -700 || x > viewW + 700 || y > viewH + 700) continue;
            var rx = 260 + h2(gx, gy, 100 + k) * 460;
            var ry = rx * (0.42 + h2(gx, gy, 110 + k) * 0.42);
            var col = pal[Math.floor(h2(gx, gy, 120 + k) * pal.length) % pal.length];
            var alpha = 0.04 + h2(gx, gy, 130 + k) * 0.05;
            var rot = h2(gx, gy, 140 + k) * Math.PI;
            var grd = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
            grd.addColorStop(0, rgba(col.r, col.g, col.b, alpha));
            grd.addColorStop(0.62, rgba(col.r, col.g, col.b, alpha * 0.55));
            grd.addColorStop(1, rgba(col.r, col.g, col.b, 0));
            ctx.save();
            ctx.translate(x, y); ctx.rotate(rot); ctx.scale(1, ry / rx);
            ctx.fillStyle = grd;
            ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
          }
        }
      }
      ctx.restore();
    } catch (e) { /* 静默 */ }
  }

  /* ====================================================================
     2) 主题化贴花：簇心 + 簇内，世界锚定
     ==================================================================== */
  function drawDecal(ctx, kind, x, y, r, rot, tier, base) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot);
    switch (kind) {
      case 'moss': {
        var mg = shade(base, 0.12);
        for (var i = 0; i < 4; i++) {
          var a = i * 1.7 + r; var rr = r * (0.4 + (i % 2) * 0.3);
          var g = ctx.createRadialGradient(0, 0, 0, 0, 0, rr);
          g.addColorStop(0, rgba(mg.r + 18, mg.g + 22, mg.b, 0.22));
          g.addColorStop(1, rgba(mg.r, mg.g, mg.b, 0));
          ctx.fillStyle = g; ctx.beginPath();
          ctx.ellipse(Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.4, rr, rr * 0.7, a, 0, 6.283); ctx.fill();
        }
        break;
      }
      case 'pebble': {
        ctx.fillStyle = rgba(96, 86, 72, 0.32);
        for (var p = 0; p < 5; p++) {
          var px = (h2(p, r * 13, 1) - 0.5) * r * 1.5, py = (h2(p, r * 17, 2) - 0.5) * r * 1.1;
          var pr = r * 0.10 + h2(p, r, 3) * r * 0.10;
          ctx.beginPath(); ctx.ellipse(px, py, pr * 1.4, pr, h2(p, r, 4) * 3, 0, 6.283); ctx.fill();
        }
        ctx.fillStyle = rgba(182, 174, 158, 0.24);
        for (var q = 0; q < 3; q++) { var qx = (h2(q, r * 23, 5) - 0.5) * r * 1.4;
          ctx.beginPath(); ctx.arc(qx, (h2(q, r * 29, 6) - 0.5) * r, r * 0.06, 0, 6.283); ctx.fill(); }
        break;
      }
      case 'leaf': {
        var cols = tier >= 3 ? [rgba(150, 110, 60, .5), rgba(120, 84, 48, .5), rgba(96, 110, 60, .5)]
          : [rgba(150, 150, 80, .42), rgba(120, 140, 70, .42), rgba(160, 120, 70, .4)];
        for (var l = 0; l < 5; l++) {
          var lx = (h2(l, r * 31, 8) - 0.5) * r * 1.6, ly = (h2(l, r * 37, 9) - 0.5) * r * 1.2;
          ctx.fillStyle = cols[l % cols.length];
          ctx.save(); ctx.translate(lx, ly); ctx.rotate(h2(l, r, 10) * 6.28);
          ctx.beginPath(); ctx.ellipse(0, 0, r * 0.16, r * 0.06, 0, 0, 6.283); ctx.fill(); ctx.restore();
        }
        break;
      }
      case 'puddle': {
        var g2 = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
        g2.addColorStop(0, rgba(70, 104, 112, 0.34));
        g2.addColorStop(0.7, rgba(48, 78, 88, 0.22));
        g2.addColorStop(1, rgba(40, 64, 72, 0));
        ctx.fillStyle = g2;
        ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.6, 0, 0, 6.283); ctx.fill();
        ctx.strokeStyle = rgba(190, 214, 210, 0.18); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(0, 0, r * 0.8, r * 0.46, 0, 0, 6.283); ctx.stroke();
        break;
      }
      case 'bareSoil': {
        var bs = shade(base, -0.3);
        var g3 = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
        g3.addColorStop(0, rgba(bs.r + 16, bs.g + 10, bs.b, 0.3));
        g3.addColorStop(1, rgba(bs.r, bs.g, bs.b, 0));
        ctx.fillStyle = g3; ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.283); ctx.fill();
        break;
      }
      case 'rubble': {
        ctx.fillStyle = rgba(96, 92, 84, 0.5);
        for (var rb = 0; rb < 6; rb++) {
          var rx2 = (h2(rb, r * 41, 11) - 0.5) * r * 1.7, ry2 = (h2(rb, r * 43, 12) - 0.5) * r * 1.3;
          var s2 = r * 0.1 + h2(rb, r, 13) * r * 0.18;
          ctx.beginPath(); ctx.rect(rx2, ry2, s2, s2 * (0.6 + h2(rb, r, 14) * 0.5)); ctx.fill();
        }
        break;
      }
      case 'track': {
        ctx.strokeStyle = rgba(60, 52, 40, 0.28); ctx.lineWidth = Math.max(2, r * 0.12);
        ctx.beginPath();
        ctx.moveTo(-r, -r * 0.28); ctx.bezierCurveTo(-r * 0.3, -r * 0.34, r * 0.3, -r * 0.22, r, -r * 0.28);
        ctx.moveTo(-r, r * 0.28); ctx.bezierCurveTo(-r * 0.3, r * 0.34, r * 0.3, r * 0.22, r, r * 0.28);
        ctx.stroke();
        break;
      }
      case 'bone': {
        ctx.strokeStyle = rgba(200, 192, 168, 0.5); ctx.fillStyle = rgba(200, 192, 168, 0.4);
        ctx.lineWidth = Math.max(1.5, r * 0.08);
        for (var b = 0; b < 3; b++) {
          var bx = (h2(b, r * 47, 15) - 0.5) * r * 1.4, by = (h2(b, r * 53, 16) - 0.5) * r;
          ctx.save(); ctx.translate(bx, by); ctx.rotate(h2(b, r, 17) * 6.28);
          ctx.beginPath(); ctx.moveTo(-r * 0.18, 0); ctx.lineTo(r * 0.18, 0); ctx.stroke();
          ctx.beginPath(); ctx.arc(r * 0.2, 0, r * 0.06, 0, 6.283); ctx.fill(); ctx.restore();
        }
        break;
      }
      case 'grassDark': {
        ctx.strokeStyle = rgba(shade(base, -0.32).r, shade(base, -0.32).g, shade(base, -0.32).b, 0.5);
        ctx.lineWidth = 1.2;
        for (var gd = 0; gd < 7; gd++) {
          var gx2 = (h2(gd, r * 59, 18) - 0.5) * r * 1.5, gy2 = (h2(gd, r * 61, 19) - 0.5) * r * 1.1;
          ctx.beginPath(); ctx.moveTo(gx2, gy2 + r * 0.1); ctx.lineTo(gx2 + (h2(gd, r, 20) - 0.5) * 3, gy2 - r * 0.22); ctx.stroke();
        }
        break;
      }
      case 'scorch': {
        var g4 = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
        g4.addColorStop(0, rgba(20, 16, 14, 0.4));
        g4.addColorStop(0.6, rgba(50, 30, 24, 0.2));
        g4.addColorStop(1, rgba(40, 26, 20, 0));
        ctx.fillStyle = g4; ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.283); ctx.fill();
        break;
      }
      case 'ash': {
        ctx.fillStyle = rgba(60, 58, 58, 0.4);
        for (var as2 = 0; as2 < 10; as2++) {
          ctx.beginPath();
          ctx.arc((h2(as2, r * 67, 21) - 0.5) * r * 1.7, (h2(as2, r * 71, 22) - 0.5) * r * 1.2, r * 0.05 + h2(as2, r, 23) * r * 0.06, 0, 6.283);
          ctx.fill();
        }
        break;
      }
      case 'crack': {
        ctx.strokeStyle = rgba(20, 18, 18, 0.4); ctx.lineWidth = 1.4;
        var x0 = -r, y0 = 0;
        ctx.beginPath(); ctx.moveTo(x0, y0);
        for (var c = 1; c <= 4; c++) {
          ctx.lineTo(-r + (c / 4) * 2 * r, (h2(c, r * 73, 24) - 0.5) * r * 0.7);
        }
        ctx.stroke();
        break;
      }
      case 'toxicMoss': {
        var g5 = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
        g5.addColorStop(0, rgba(120, 180, 90, 0.24));
        g5.addColorStop(1, rgba(80, 120, 60, 0));
        ctx.fillStyle = g5; ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.283); ctx.fill();
        break;
      }
      case 'salt': case 'frost': {
        var sc = kind === 'frost' ? rgba(210, 222, 230, 0.26) : rgba(214, 206, 186, 0.24);
        ctx.fillStyle = sc;
        for (var sl = 0; sl < 8; sl++) {
          ctx.beginPath();
          ctx.ellipse((h2(sl, r * 79, 25) - 0.5) * r * 1.6, (h2(sl, r * 83, 26) - 0.5) * r * 1.2,
            r * 0.1 + h2(sl, r, 27) * r * 0.14, r * 0.06, h2(sl, r, 28) * 3, 0, 6.283);
          ctx.fill();
        }
        break;
      }
      case 'glowMoss': {
        var g6 = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
        g6.addColorStop(0, rgba(120, 220, 170, 0.3));
        g6.addColorStop(1, rgba(80, 160, 140, 0));
        ctx.fillStyle = g6; ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.283); ctx.fill();
        break;
      }
      default: break;
    }
    ctx.restore();
  }

  function renderDecals(ctx, exp, cam, viewW, viewH) {
    if (!enabled()) return;
    try {
      var theme = (exp.map && exp.map.terrain) || {};
      var tier = (exp.map && exp.map.tier) || 1;
      var base = hexToRgb(theme.ground || '#466038');
      var kinds = palette(tier, base).decal;
      var cell = 220;                  // 簇心网格
      var gx0 = Math.floor(cam.x / cell) - 1, gy0 = Math.floor(cam.y / cell) - 1;
      var gx1 = Math.floor((cam.x + viewW) / cell) + 1, gy1 = Math.floor((cam.y + viewH) / cell) + 1;
      ctx.save();
      for (var gy = gy0; gy <= gy1; gy++) {
        for (var gx = gx0; gx <= gx1; gx++) {
          if (h2(gx, gy, 201) < 0.32) continue;       // 约 68% 格子有簇
          var cx = gx * cell + h2(gx, gy, 202) * cell;
          var cy = gy * cell + h2(gx, gy, 203) * cell;
          var members = 2 + Math.floor(h2(gx, gy, 204) * 3);  // 2~4 个贴花/簇
          for (var k = 0; k < members; k++) {
            var ang = h2(gx, gy, 210 + k) * 6.283;
            var dist = h2(gx, gy, 220 + k) * cell * 0.42;
            var wx = cx + Math.cos(ang) * dist, wy = cy + Math.sin(ang) * dist;
            var x = wx - cam.x, y = wy - cam.y;
            if (x < -64 || y < -64 || x > viewW + 64 || y > viewH + 64) continue;
            var r = 12 + h2(gx, gy, 230 + k) * 22;
            var kind = kinds[Math.floor(h2(gx, gy, 240 + k) * kinds.length) % kinds.length];
            var rot = h2(gx, gy, 250 + k) * 6.283;
            drawDecal(ctx, kind, x, y, r, rot, tier, base);
          }
        }
      }
      ctx.restore();
    } catch (e) { /* 静默 */ }
  }

  /* ====================================================================
     3) 无缝法线纹理（多频 value noise → Sobel 法线），给 3D 地面颗粒感
     ==================================================================== */
  var _normalCache = {};
  function _smooth(t) { return t * t * (3 - 2 * t); }
  function _vnoise(x, y, N, seed) {
    // 周期化双线性插值噪声（N×N 网格，严格环绕 → 无缝）
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    var x0 = ((xi % N) + N) % N, x1 = (x0 + 1) % N;
    var y0 = ((yi % N) + N) % N, y1 = (y0 + 1) % N;
    function v(ix, iy) { return h2(ix, iy, seed); }
    var a = v(x0, y0), b = v(x1, y0), c = v(x0, y1), d = v(x1, y1);
    var u = _smooth(xf), vv = _smooth(yf);
    return a * (1 - u) * (1 - vv) + b * u * (1 - vv) + c * (1 - u) * vv + d * u * vv;
  }
  function _fbm(u, v, N, seed) {
    var val = 0, amp = 0.55, freq = 1, tot = 0;
    for (var o = 0; o < 4; o++) {
      val += _vnoise(u * freq * N, v * freq * N, N, seed + o * 97) * amp;
      tot += amp; amp *= 0.5; freq *= 2;
    }
    return val / tot;
  }

  function groundNormalTexture(THREE) {
    if (!THREE) return null;
    var N = 256, key = 'n' + N;
    if (_normalCache[key]) return _normalCache[key];
    var cv = document.createElement('canvas'); cv.width = cv.height = N;
    var c = cv.getContext('2d');
    var img = c.createImageData(N, N);
    var height = new Float32Array(N * N);
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        height[y * N + x] = _fbm(x / N, y / N, 8, 1234);
      }
    }
    var strength = 2.4;
    for (var yy = 0; yy < N; yy++) {
      for (var xx = 0; xx < N; xx++) {
        var xl = (xx - 1 + N) % N, xr = (xx + 1) % N;
        var yu = (yy - 1 + N) % N, yd = (yy + 1) % N;
        var dx = (height[yy * N + xr] - height[yy * N + xl]) * strength;
        var dy = (height[yd * N + xx] - height[yu * N + xx]) * strength;
        // 法线 = normalize(-dH/dx, -dH/dy, 1)
        var nx = -dx, ny = 1.0, nz = -dy;
        var len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        var i = (yy * N + xx) * 4;
        img.data[i] = (nx / len * 0.5 + 0.5) * 255;
        img.data[i + 1] = (nz / len * 0.5 + 0.5) * 255; // Three 切线空间：G 存 z
        img.data[i + 2] = (ny / len * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = Math.min(8, (THREE.Capabilities && THREE.Capabilities.getMaxAnisotropy) ? 8 : 8);
    _normalCache[key] = tex;
    return tex;
  }

  window.GroundDetail = {
    enabled: enabled,
    renderMacro: renderMacro,
    renderDecals: renderDecals,
    groundNormalTexture: groundNormalTexture,
    KEY: KEY
  };
})();
