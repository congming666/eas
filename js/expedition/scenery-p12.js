/* ============================================================
   SceneryP12 —— P12-b 俯视植被 + 立体地标
   解决 90° 正俯视下"竖立草缩成小三角纸片、植被均匀撒点、地表空旷无地标"的问题。
   1) 草丛：在原竖立叶基础上加一圈贴地放射草芒，俯视读作星状草团；
      分布由波噪声（fbm）密度场驱动，成簇生长、簇间留空，而非均匀撒点。
   2) 装饰地标层（纯视觉，不参与碰撞/战斗/数值）：
      · 贴地"树冠俯视团"——扁平树冠投影 + 细树干，玩家在树冠下仍完全可见（不遮挡战斗）；
      · 岩石群、枯树/废墟柱——按生态区/主题成簇，波噪声分布，避开道路/玩家/据点。
   开关：localStorage.farmFoliageP12  默认开，'0'/'off' 关闭回退。
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'farmFoliageP12';
  function enabled() {
    try { var v = localStorage.getItem(KEY); return !(v === '0' || v === 'off'); } catch (e) { return true; }
  }

  /* ---------- 确定性 value noise / fbm（非周期，世界采样用） ---------- */
  function hash2(x, y, s) {
    var n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  function _sm(t) { return t * t * (3 - 2 * t); }
  function vnoise(x, y, seed) {
    var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    var a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
    var u = _sm(xf), v = _sm(yf);
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  }
  function fbm(x, y, seed) {
    var v = 0, amp = 0.55, f = 1, tot = 0;
    for (var o = 0; o < 4; o++) { v += vnoise(x * f, y * f, seed + o * 101) * amp; tot += amp; amp *= 0.5; f *= 2.1; }
    return v / tot;
  }
  // 簇密度：返回 0~1，越大越密；用于成簇（大尺度聚类）
  function clusterField(x, y, seed, cell) {
    return fbm(x / (cell || 150), y / (cell || 150), seed || 555);
  }

  /* ============================================================
     草丛几何：竖立叶（原）+ 贴地放射草芒（P12 俯视可见）
     ============================================================ */
  function makeGrassTuftGeometry(T, blades) {
    var positions = [], normals = [], uvs = [], indices = [];
    var H = 20, w0 = 1.9, w1 = 1.05, hm = H * 0.55, bend = 3.2;
    var rotY = function (x, y, z, ang) {
      var c = Math.cos(ang), s = Math.sin(ang);
      return [x * c + z * s, y, -x * s + z * c];
    };
    // 竖立叶（与原 _makeGrassTuftGeometry 一致）
    for (var j = 0; j < blades; j++) {
      var base = positions.length / 3;
      var ang = (j / blades) * Math.PI * 2 + (j * 0.73);
      var curve = bend * (0.8 + (j % 3) * 0.18);
      var leaf = [
        [-w0, 0, 0], [w0, 0, 0],
        [-w1, hm, curve * 0.7], [w1, hm, curve * 0.7],
        [0, H, curve * 1.55]
      ];
      for (var k = 0; k < leaf.length; k++) {
        var p = rotY(leaf[k][0], leaf[k][1], leaf[k][2], ang);
        positions.push(p[0], p[1], p[2]);
        var n = rotY(0, 0.85, 0.4, ang);
        var nl = Math.hypot(n[0], n[1], n[2]) || 1;
        normals.push(n[0] / nl, n[1] / nl, n[2] / nl);
        uvs.push(k === 1 || k === 3 ? 1 : 0, k < 2 ? 0 : (k === 4 ? 1 : 0.55));
      }
      indices.push(base, base + 1, base + 3, base, base + 3, base + 2, base + 2, base + 3, base + 4);
    }
    // P12 贴地放射草芒：8 片接近水平向外辐射的短叶，俯视呈星芒草团
    var spikes = 8;
    for (var q = 0; q < spikes; q++) {
      var a2 = (q / spikes) * Math.PI * 2 + (q * 0.41);
      var len = 7 + ((q * 37) % 5);
      var dx = Math.cos(a2), dz = Math.sin(a2);
      var px = -dz, pz = dx; // 垂直方向
      var w = 1.4;
      var b2 = positions.length / 3;
      var verts = [
        [-px * w, 0.5, -pz * w],
        [ px * w, 0.5,  pz * w],
        [dx * len * 0.6, 2.0, dz * len * 0.6],
        [dx * len, 2.8, dz * len]
      ];
      verts.forEach(function (vv) { positions.push(vv[0], vv[1], vv[2]); normals.push(0, 1, 0); uvs.push(0, 0); });
      uvs[b2] = 0; uvs[b2 + 1] = 1; uvs[b2 + 2] = 0.5; uvs[b2 + 3] = 1;
      indices.push(b2, b2 + 1, b2 + 2, b2 + 2, b2 + 1, b2 + 3);
    }
    var geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeBoundingSphere();
    return geo;
  }

  /* P12 草丛是否在某点成簇（_buildGrass 用）。阈值越低越密、簇越大。 */
  function grassDensityAt(x, y, seed, threshold) {
    var d = clusterField(x, y, seed, 140);
    return d >= (threshold == null ? 0.5 : threshold);
  }

  /* ============================================================
     装饰地标层（纯视觉 InstancedMesh）
     ============================================================ */
  // 主题配置：每 tier 的地物构成
  function themeCfg(tier) {
    return {
      1: { canopy: 0.5, rock: 0.18, dead: 0.04, ruin: 0.0, trunk: true,  hue: 0.26, sat: 0.36, light: 0.32 },
      2: { canopy: 0.24, rock: 0.5, dead: 0.2, ruin: 0.42, trunk: true, hue: 0.10, sat: 0.20, light: 0.36 },
      3: { canopy: 0.12, rock: 0.52, dead: 0.5, ruin: 0.26, trunk: true, hue: 0.06, sat: 0.30, light: 0.30 },
      4: { canopy: 0.08, rock: 0.46, dead: 0.56, ruin: 0.18, trunk: true, hue: 0.55, sat: 0.18, light: 0.40 }
    }[tier] || { canopy: 0.4, rock: 0.4, dead: 0.1, ruin: 0.1, trunk: true, hue: 0.25, sat: 0.3, light: 0.34 };
  }

  // 点是否被占用：道路/玩家/据点/真实障碍/宝箱，避免穿模与遮挡交互
  function isBlocked(exp, x, y) {
    try {
      if (Math.hypot(x - exp.player.x, y - exp.player.y) < 240) return true;
      if (exp.obstacles) {
        for (var i = 0; i < exp.obstacles.length; i++) {
          var o = exp.obstacles[i];
          if (Math.hypot(o.x - x, o.y - y) < 46) return true;
        }
      }
      if (exp.terrainRoads) {
        for (var r = 0; r < exp.terrainRoads.length; r++) {
          var rd = exp.terrainRoads[r];
          if (distSeg(x, y, rd.x1, rd.y1, rd.x2, rd.y2) < rd.width * 0.7 + 18) return true;
        }
      }
      if (exp.getTerrainTypeId) { var t = exp.getTerrainTypeId(x, y); if (t === 1 || t === 2) return true; } // 水/泥不栽
    } catch (e) {}
    return false;
  }
  function distSeg(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    if (!l2) return Math.hypot(px - x1, py - y1);
    var t = ((px - x1) * dx + (py - y1) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  // 收集一簇纯视觉地物，返回 {canopy:[], rock:[], dead:[], ruin:[]}
  function collect(exp, quality) {
    var tier = (exp.map && exp.map.tier) || 1;
    var cfg = themeCfg(tier);
    var size = exp.terrainHeight ? exp.terrainHeight.size : 2400;
    var ELEV = window.TERRAIN_ELEV_WORLD || 0.4;
    // 高档密、中低档递减
    var qf = quality === 2 ? 0.45 : quality === 1 ? 0.75 : 1.0;
    var budget = Math.round(size * 0.115 * qf);   // 视野规模相关（疏林/簇状，不连片）
    var out = { canopy: [], rock: [], dead: [], ruin: [], ELEV: ELEV };
    var seed = 712 + (exp._mapId ? (exp._mapId.length * 37) : 0);
    var attempts = Math.round(budget * 4);
    for (var i = 0; i < attempts; i++) {
      var x = hash2(i, 3, seed) * size, y = hash2(i, 7, seed) * size;
      // 簇密度：聚成小片林地/石场
      var field = clusterField(x, y, seed, 230);
      var r1 = hash2(i, 11, seed);
      var kind = null;
      if (r1 < cfg.canopy && field > 0.56) kind = 'canopy';
      else if (r1 < cfg.canopy + cfg.rock && field > 0.4) kind = 'rock';
      else if (r1 < cfg.canopy + cfg.rock + cfg.dead && field > 0.42) kind = 'dead';
      else if (r1 < cfg.canopy + cfg.rock + cfg.dead + cfg.ruin && field > 0.45) kind = 'ruin';
      if (!kind) continue;
      if (isBlocked(exp, x, y)) continue;
      // 簇内 1~3 个成团（保持簇状但不连片）
      var members = 1 + Math.floor(hash2(i, 13, seed) * 3);
      for (var m = 0; m < members; m++) {
        var ang = hash2(i, m * 2 + 17, seed) * 6.283, dist = hash2(i, m * 3 + 19, seed) * 46;
        var xx = x + Math.cos(ang) * dist, yy = y + Math.sin(ang) * dist;
        if (isBlocked(exp, xx, yy)) continue;
        var e = exp.getElevation ? exp.getElevation(xx, yy) : 0;
        out[kind].push({
          x: xx, y: yy, e: e,
          s: 0.7 + hash2(i, m * 5 + 23, seed) * 0.7,
          rot: hash2(i, m * 7 + 29, seed) * 6.283
        });
      }
    }
    return out;
  }

  function build(T, exp, scene, quality) {
    if (!enabled() || !T || !scene) return null;
    var data = collect(exp, quality);
    var ELEV = data.ELEV;
    var tier = (exp.map && exp.map.tier) || 1;
    var cfg = themeCfg(tier);
    var group = new T.Group();
    var dummy = new T.Object3D();
    var col = new T.Color();

    function instanced(geo, mat, list, place, colorFn) {
      if (!list.length) return null;
      var m = new T.InstancedMesh(geo, mat, list.length);
      m.castShadow = false; m.receiveShadow = true;
      list.forEach(function (it, i) {
        place(dummy, it, i);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
        if (colorFn && m.setColorAt) { colorFn(col, it, i); m.setColorAt(i, col); }
      });
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      group.add(m);
      return m;
    }

    // 1) 贴地树冠俯视团：压扁的不规则团，俯视读作树冠/灌丛投影，不遮挡实体
    if (data.canopy.length) {
      var canopyGeo = new T.IcosahedronGeometry(1, 2);
      var canopyMat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, flatShading: true });
      instanced(canopyGeo, canopyMat, data.canopy, function (d, it) {
        var r = 16 + it.s * 12;
        d.position.set(it.x, it.e * ELEV + 1.6, it.y);
        d.rotation.set(0, it.rot, 0);
        d.scale.set(r * (1.05 + it.s * 0.2), 2.4 + it.s * 1.6, r * (0.9 + it.s * 0.2));
      }, function (c, it, i) {
        var l = cfg.light + (hash2(i, 1, 99) - 0.5) * 0.12;
        c.setHSL(cfg.hue + (hash2(i, 2, 99) - 0.5) * 0.05, cfg.sat + (hash2(i, 3, 99) - 0.5) * 0.1, l);
        if (c.convertSRGBToLinear) c.convertSRGBToLinear();
      });
      // 细树干（俯视仅小点，斜视/边缘有立体感）
      if (cfg.trunk) {
        var trunkGeo = new T.CylinderGeometry(1.6, 2.4, 34, 5);
        var trunkMat = new T.MeshStandardMaterial({ color: 0x4d3822, roughness: 1 });
        instanced(trunkGeo, trunkMat, data.canopy.filter(function (_, i) { return i % 2 === 0; }), function (d, it) {
          d.position.set(it.x, it.e * ELEV + 16, it.y);
          d.rotation.set(0, it.rot, 0);
          d.scale.setScalar(it.s * 0.85);
        });
      }
    }
    // 2) 岩石群
    if (data.rock.length) {
      var rockGeo = new T.DodecahedronGeometry(1, 0);
      var rockMat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
      instanced(rockGeo, rockMat, data.rock, function (d, it) {
        var r = 7 + it.s * 9;
        d.position.set(it.x, it.e * ELEV + r * 0.5, it.y);
        d.rotation.set(hash2(it.x | 0, 1, 7) * 0.5, it.rot, hash2(it.y | 0, 2, 7) * 0.5);
        d.scale.set(r * 1.25, r * 0.7, r);
      }, function (c, it, i) {
        c.setHSL(0.09, 0.05 + hash2(i, 4, 99) * 0.05, 0.34 + hash2(i, 5, 99) * 0.12);
        if (c.convertSRGBToLinear) c.convertSRGBToLinear();
      });
    }
    // 3) 枯树（细高枝，俯视占地小、不挡主体）
    if (data.dead.length) {
      var deadGeo = new T.CylinderGeometry(1.2, 2.2, 30, 5);
      var deadMat = new T.MeshStandardMaterial({ color: 0x3a2c1e, roughness: 1 });
      instanced(deadGeo, deadMat, data.dead, function (d, it) {
        d.position.set(it.x, it.e * ELEV + 14, it.y);
        d.rotation.set((hash2(it.x | 0, 3, 7) - 0.5) * 0.2, it.rot, (hash2(it.y | 0, 4, 7) - 0.5) * 0.2);
        d.scale.setScalar(it.s * 0.9);
      });
    }
    // 4) 废墟残柱/矮墙
    if (data.ruin.length) {
      var ruinGeo = new T.BoxGeometry(1, 1, 1);
      var ruinMat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
      instanced(ruinGeo, ruinMat, data.ruin, function (d, it) {
        d.position.set(it.x, it.e * ELEV + 6 * it.s, it.y);
        d.rotation.set(0, it.rot, 0);
        d.scale.set(16 * it.s, 12 * it.s, 8 * it.s);
      }, function (c, it, i) {
        c.setHSL(0.10, 0.06, 0.4 + hash2(i, 6, 99) * 0.1);
        if (c.convertSRGBToLinear) c.convertSRGBToLinear();
      });
    }
    return group;
  }

  window.SceneryP12 = {
    KEY: KEY, enabled: enabled,
    fbm: fbm, clusterField: clusterField, grassDensityAt: grassDensityAt,
    makeGrassTuftGeometry: makeGrassTuftGeometry,
    collect: collect, build: build
  };
})();
