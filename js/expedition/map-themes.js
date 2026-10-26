/* ============================================================
   远征逐图视觉主题包（P11-5）
   24 张地图各自的氛围光/雾 + 植被色族/密度 + 世界尺寸。
   - 光照/雾在 ThreePostFX 的 tier 四主题基线之上做“逐图微调”，同 tier 六图亦可一眼区分；
   - 植被色族按地图世界观设定（绿野/枯废墟/焦土/毒沼/血色/荧光超自然），驱动写实草丛；
   - worldSize 为分档扩图后的本局边长，统一由远征初始化单点覆写 CONFIG.expedition.mapSize。
   纯数据 + 查询函数，无外部依赖；失败/缺记录时回退 tier 默认，绝不阻断渲染。
   ============================================================ */
(function () {
  'use strict';

  // tier 默认（兜底）：tint 染色、雾/光倍率、植被基准
  const TIER_BASE = {
    1: { tint: '#9fc083', tintWeight: 0.16, fogMul: 0.95, sunMul: 1.05, hemiMul: 1.0,
         grass: { hue: 0.25, hueVar: 0.05, sat: 0.42, satVar: 0.14, light: 0.34, lightVar: 0.08, density: 1.0, hMin: 12, hMax: 22, blades: 5, glow: 0.0 } },
    2: { tint: '#c9a86a', tintWeight: 0.18, fogMul: 1.05, sunMul: 0.98, hemiMul: 0.98,
         grass: { hue: 0.15, hueVar: 0.05, sat: 0.36, satVar: 0.12, light: 0.30, lightVar: 0.07, density: 0.8, hMin: 11, hMax: 19, blades: 5, glow: 0.0 } },
    3: { tint: '#b0715f', tintWeight: 0.22, fogMul: 1.18, sunMul: 0.9, hemiMul: 0.92,
         grass: { hue: 0.08, hueVar: 0.06, sat: 0.4, satVar: 0.16, light: 0.24, lightVar: 0.07, density: 0.7, hMin: 10, hMax: 18, blades: 4, glow: 0.06 } },
    4: { tint: '#8a86c8', tintWeight: 0.26, fogMul: 1.2, sunMul: 0.82, hemiMul: 0.9,
         grass: { hue: 0.55, hueVar: 0.1, sat: 0.42, satVar: 0.18, light: 0.26, lightVar: 0.09, density: 0.65, hMin: 11, hMax: 20, blades: 5, glow: 0.14 } },
  };

  // 24 图逐图覆盖（只写与 tier 默认不同的部分；grass 内字段浅合并）
  const MAPS = {
    // ===== T1 荒野 =====
    t1_1: { worldSize: 2600, tint: '#a7c07a', grass: { hue: 0.22, sat: 0.44, light: 0.33, density: 1.1 } },
    t1_2: { worldSize: 2800, tint: '#b6d87f', tintWeight: 0.14, fogMul: 0.78, sunMul: 1.1, grass: { hue: 0.27, sat: 0.48, light: 0.38, density: 1.0, hMax: 23 } }, // 开阔
    t1_3: { worldSize: 2650, tint: '#a6d878', grass: { hue: 0.30, sat: 0.52, light: 0.36, density: 1.45, hMin: 14, hMax: 26, blades: 6 } }, // 多草
    t1_4: { worldSize: 2600, tint: '#b0aca0', tintWeight: 0.14, fogMul: 1.0, grass: { hue: 0.18, sat: 0.22, light: 0.30, density: 0.45, hMin: 9, hMax: 16 } }, // 多石
    t1_5: { worldSize: 2650, tint: '#86c8c2', fogMul: 1.18, grass: { hue: 0.34, sat: 0.4, light: 0.32, density: 0.9 } }, // 多水
    t1_6: { worldSize: 2600, tint: '#d2b066', grass: { hue: 0.13, sat: 0.42, light: 0.34, density: 0.8 } },
    // ===== T2 废墟 =====
    t2_1: { worldSize: 2850, tint: '#cbb274', grass: { hue: 0.16, sat: 0.38, light: 0.30, density: 0.8 } },
    t2_2: { worldSize: 2750, tint: '#b0aca2', tintWeight: 0.2, fogMul: 1.55, sunMul: 0.9, grass: { hue: 0.16, sat: 0.24, light: 0.28, density: 0.7 } }, // 多雾
    t2_3: { worldSize: 2650, tint: '#b08a60', fogMul: 1.12, grass: { hue: 0.12, sat: 0.3, light: 0.26, density: 0.6, hMin: 9, hMax: 16 } }, // 狭窄
    t2_4: { worldSize: 2850, tint: '#8a9a60', sunMul: 0.85, fogMul: 1.1, grass: { hue: 0.22, sat: 0.3, light: 0.26, density: 0.9 } }, // 烟熏
    t2_5: { worldSize: 2850, tint: '#a0988a', grass: { hue: 0.30, sat: 0.2, light: 0.28, density: 0.55 } },
    t2_6: { worldSize: 2900, tint: '#dcb068', tintWeight: 0.16, fogMul: 0.88, grass: { hue: 0.12, sat: 0.44, light: 0.34, density: 0.7 } },
    // ===== T3 灾变 =====
    t3_1: { worldSize: 3100, tint: '#c07a68', grass: { hue: 0.06, sat: 0.42, light: 0.24, density: 0.7 } },
    t3_2: { worldSize: 3000, tint: '#7aa05e', tintWeight: 0.24, fogMul: 1.5, sunMul: 0.82, grass: { hue: 0.22, sat: 0.5, light: 0.22, density: 1.2, glow: 0.12, blades: 6 } }, // 沼泽毒雾
    t3_3: { worldSize: 3100, tint: '#8a7a6a', tintWeight: 0.2, fogMul: 1.1, sunMul: 0.78, grass: { hue: 0.06, sat: 0.26, light: 0.15, density: 0.35, hMin: 8, hMax: 14, glow: 0.04 } }, // 焦林
    t3_4: { worldSize: 3150, tint: '#b06858', fogMul: 1.22, grass: { hue: 0.02, sat: 0.46, light: 0.22, density: 0.5, glow: 0.08 } }, // 虫穴
    t3_5: { worldSize: 3100, tint: '#d06060', tintWeight: 0.26, fogMul: 1.12, grass: { hue: 0.99, sat: 0.56, light: 0.24, density: 0.6, glow: 0.1 } }, // 血色
    t3_6: { worldSize: 2800, tint: '#72d092', tintWeight: 0.22, fogMul: 1.42, sunMul: 0.8, grass: { hue: 0.33, sat: 0.5, light: 0.26, density: 1.25, glow: 0.16, blades: 6 } }, // 室内温室
    // ===== T4 绝境 =====
    t4_1: { worldSize: 3300, tint: '#9a92b8', fogMul: 1.12, grass: { hue: 0.26, sat: 0.24, light: 0.26, density: 0.7 } },
    t4_2: { worldSize: 3300, tint: '#a872d0', tintWeight: 0.3, fogMul: 1.62, sunMul: 0.78, grass: { hue: 0.76, sat: 0.5, light: 0.26, density: 0.6, glow: 0.22 } }, // 毒雾祭坛
    t4_3: { worldSize: 3450, tint: '#bcb49c', tintWeight: 0.18, fogMul: 0.8, sunMul: 1.0, grass: { hue: 0.12, sat: 0.16, light: 0.32, density: 0.45, hMin: 10, hMax: 18 } }, // 开阔骨原
    t4_4: { worldSize: 3300, tint: '#8292ee', tintWeight: 0.3, fogMul: 1.22, sunMul: 0.84, grass: { hue: 0.62, sat: 0.58, light: 0.3, density: 0.55, glow: 0.26 } }, // 裂隙
    t4_5: { worldSize: 3350, tint: '#6aa0e0', tintWeight: 0.3, fogMul: 1.18, sunMul: 0.68, grass: { hue: 0.46, sat: 0.52, light: 0.28, density: 1.3, hMin: 13, hMax: 24, glow: 0.3, blades: 6 } }, // 夜荧光林
    t4_6: { worldSize: 2550, tint: '#e09860', tintWeight: 0.2, fogMul: 1.0, grass: { hue: 0.09, sat: 0.4, light: 0.26, density: 0.4, hMin: 9, hMax: 16 } }, // 封闭竞技场
  };

  function mergeGrass(base, over) {
    const g = Object.assign({}, base);
    if (over) for (const k in over) g[k] = over[k];
    return g;
  }

  const MapThemes = {
    // 返回某图完整主题（tier 默认 + 逐图覆盖），map 可为地图配置对象或 id
    get(map) {
      const id = (map && map.id) || map || '';
      const tier = (map && map.tier) || (id[0] === 't' ? parseInt(id.slice(1, 2), 10) : 1) || 1;
      const base = TIER_BASE[tier] || TIER_BASE[1];
      const over = MAPS[id] || {};
      const out = {
        id, tier,
        tint: over.tint || base.tint,
        tintWeight: over.tintWeight != null ? over.tintWeight : base.tintWeight,
        fogMul: over.fogMul != null ? over.fogMul : base.fogMul,
        sunMul: over.sunMul != null ? over.sunMul : base.sunMul,
        hemiMul: over.hemiMul != null ? over.hemiMul : base.hemiMul,
        worldSize: over.worldSize || 2400,
        grass: mergeGrass(base.grass, over.grass),
      };
      return out;
    },

    worldSizeFor(map) {
      const id = (map && map.id) || map || '';
      const tier = (map && map.tier) || (id[0] === 't' ? parseInt(id.slice(1, 2), 10) : 1) || 1;
      if (MAPS[id] && MAPS[id].worldSize) return MAPS[id].worldSize;
      return { 1: 2600, 2: 2850, 3: 3100, 4: 3300 }[tier] || 2400;
    },

    // 供 InstancedMesh 逐实例取色：i 实例随机值 r01 在 HSL 盒内抖动，返回 THREE.Color（线性空间由调用方转）
    grassColor(theme, r01, r02, r03, outColor) {
      const g = theme.grass;
      let hue = g.hue + (r01 - 0.5) * 2 * g.hueVar;
      hue = ((hue % 1) + 1) % 1;
      const sat = Math.max(0, Math.min(1, g.sat + (r02 - 0.5) * 2 * g.satVar));
      const lig = Math.max(0.05, Math.min(0.6, g.light + (r03 - 0.5) * 2 * g.lightVar));
      return outColor.setHSL(hue, sat, lig);
    },
  };

  window.MapThemes = MapThemes;
})();
