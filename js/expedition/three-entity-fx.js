/* ============================================================
   远征实体动态特效层 EntityFX（P9 方案 B）
   - 与 three-entities.js 协作：装饰 GLB 负责静态高模（甲胄/尖刺/晶核），
     本模块只做“动态层”：发光晶体脉冲、脚下法阵环、环绕能量粒子、飞行拖尾。
   - 全部对象建在实体 e.model 下的独立 fxGroup（单位归一化空间），随实体天然
     缩放/朝向/死亡倾倒；生物回池时整组移除并 dispose，杜绝泄漏。
   - 纯 THREE r128 原生（Points/Ring/MeshStandardMaterial），无额外 addon。
   - 用户要求特效全档位恒开、不做画质削减；仅按实体类型配置粒子密度。
   ============================================================ */
(function () {
  'use strict';
  if (typeof THREE === 'undefined') { console.warn('[EntityFX] three.js 未加载，特效层不启动'); return; }
  const T = THREE;

  const ELITE_TYPES = { swift_wolf: 1, gargoyle: 1, brood_queen: 1, armored_boar: 1 };
  const COL = {
    purple: 0xb69cff, green: 0x7dffb0, red: 0xff5a4d,
    amber: 0xffb05a, gold: 0xffd36b,
  };

  /* 每类实体的特效配方：ring=法阵环；particles=粒子（orbit 环绕 / trail 拖尾 / mist 毒雾） */
  function configFor(modelId, o) {
    const elite = !!(o && ELITE_TYPES[o.type]);
    const c = { glow: 0.7, ring: null, particles: null };
    switch (modelId) {
      case 'mob_boss':
        c.glow = 1.5;
        c.ring = { color: COL.purple, radius: 0.62, double: true, spin: 0.9 };
        c.particles = { mode: 'orbit', n: 24, color: COL.purple, radius: 0.58, depth: 0.85,
          yBase: 0.18, speed: 0.9, rise: 0.16, size: 0.09 };
        break;
      case 'mob_wolf':
        c.glow = 0.5;
        if (elite) c.ring = { color: COL.gold, radius: 0.5, double: false, spin: 1.3 };
        c.particles = { mode: 'orbit', n: elite ? 16 : 10, color: COL.red, radius: 0.36, depth: 0.5,
          yBase: 0.3, speed: 1.5, rise: 0.1, size: 0.075 };
        break;
      case 'mob_bat':
        c.glow = 0.8;
        if (elite) c.ring = { color: COL.gold, radius: 0.5, double: false, spin: 1.3 };
        c.particles = { mode: 'trail', n: 14, color: COL.purple, length: 0.9, speed: 1.6, size: 0.085 };
        break;
      case 'mob_locust':
        c.glow = 0.8;
        c.particles = { mode: 'trail', n: 14, color: COL.green, length: 0.85, speed: 1.7, size: 0.08 };
        break;
      case 'mob_spider':
        c.glow = 1.0;
        if (elite) c.ring = { color: COL.gold, radius: 0.52, double: false, spin: 1.2 };
        c.particles = { mode: 'mist', n: 14, color: COL.green, radius: 0.4, depth: 0.4,
          yBase: 0.28, speed: 0.55, rise: 0.22, size: 0.09 };
        break;
      case 'mob_boar':
        c.glow = 0.4;
        if (elite) c.ring = { color: COL.gold, radius: 0.55, double: false, spin: 1.1 };
        c.particles = { mode: 'mist', n: 12, color: COL.amber, radius: 0.42, depth: 0.3,
          yBase: 0.1, speed: 0.8, rise: 0.12, size: 0.085 };
        break;
      case 'char_farmer':
        // 玩家：仅手持武器水晶脉冲，无粒子/环
        c.glow = 0.55; c.particles = null;
        break;
      default:
        return null;
    }
    return c;
  }

  function hexRGB(hex) { return [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255]; }

  const EntityFX = {
    /* 实体获得模板（生物 _setTemplate 后、武器挂载后）调用一次 */
    onSpawn(e, modelId, kind) {
      this.onDespawn(e);   // 防御性清理旧组
      e.__fx = { modelId, kind, cfg: null, group: null, glow: [], rings: [], points: null, built: false };
      this._buildGlow(e);
    },

    /* 武器在实体创建后动态挂载，挂上后重扫发光件（先还原旧的独立材质） */
    refreshGlow(e) {
      if (!e.__fx) return;
      for (const rec of e.__fx.glow) {
        if (rec.mesh) rec.mesh.material = rec.original;
        const arr = Array.isArray(rec.replacement) ? rec.replacement : [rec.replacement];
        for (const m of arr) {
          if (m && m.userData && m.userData.glow && m !== rec.original) { try { m.dispose(); } catch (err) {} }
        }
      }
      e.__fx.glow = [];
      this._buildGlow(e);
    },

    /* 找到装饰/主体里标记为发光晶体的 mesh，替换为每实体独立材质以便脉冲（共享纹理） */
    _buildGlow(e) {
      const fx = e.__fx;
      e.model.traverse((o) => {
        if (!o.isMesh) return;
        const isGlow = (m) => m && m.userData && m.userData.glow;
        const src = o.material;
        if (Array.isArray(src)) {
          if (!src.some(isGlow)) return;
          const rep = src.map((m) => {
            if (!isGlow(m)) return m;
            const c = m.clone();
            c.userData.glow = true; c.userData.baseEmit = m.emissiveIntensity || 2.3;
            return c;
          });
          fx.glow.push({ mesh: o, original: src, replacement: rep });
          o.material = rep;
        } else if (isGlow(src)) {
          const c = src.clone();
          c.userData.glow = true; c.userData.baseEmit = src.emissiveIntensity || 2.3;
          fx.glow.push({ mesh: o, original: src, replacement: c });
          o.material = c;
        }
      });
    },

    /* 惰性创建动态组（环+粒子）。首次 update 时需要 o（含精英 type），故分开 */
    _ensureDynamics(e, o) {
      const fx = e.__fx;
      if (fx.built) return;
      fx.built = true;
      const cfg = configFor(fx.modelId, o);
      if (!cfg) return;
      fx.cfg = cfg;
      const group = new T.Group();
      group.name = 'EntityFX';
      e.model.add(group);
      fx.group = group;

      if (cfg.ring) this._buildRings(fx, cfg.ring);
      if (cfg.particles) this._buildPoints(fx, cfg.particles);
    },

    _buildRings(fx, rc) {
      const make = (r, dir) => {
        const geo = new T.RingGeometry(r * 0.82, r, 48).rotateX(-Math.PI / 2);
        const mat = new T.MeshBasicMaterial({
          color: rc.color, transparent: true, opacity: 0.0, side: T.DoubleSide,
          blending: T.AdditiveBlending, depthWrite: false,
        });
        const ring = new T.Mesh(geo, mat);
        ring.position.y = 0.03; ring.userData.spin = dir * rc.spin; ring.userData.r0 = r;
        fx.group.add(ring); fx.rings.push(ring);
      };
      make(rc.radius, 1);
      if (rc.double) make(rc.radius * 0.72, -1.4);
    },

    _buildPoints(fx, pc) {
      const n = pc.n;
      const pos = new Float32Array(n * 3);
      const col = new Float32Array(n * 3);
      const [r, g, b] = hexRGB(pc.color);
      const seeds = [];
      for (let i = 0; i < n; i++) {
        const seed = { a: Math.random() * Math.PI * 2, p: Math.random(), s: 0.7 + Math.random() * 0.6 };
        seeds.push(seed);
        col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(pos, 3));
      geo.setAttribute('color', new T.BufferAttribute(col, 3));
      const mat = new T.PointsMaterial({
        size: pc.size, vertexColors: true, transparent: true, opacity: 0.9,
        blending: T.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
      });
      const points = new T.Points(geo, mat);
      points.frustumCulled = false;
      fx.group.add(points);
      fx.points = { obj: points, geo, mat, n, pc, seeds };
    },

    /* 每帧驱动（three-entities._updateCreature 末尾） */
    onUpdate(e, o, kind, modelId, at) {
      const fx = e.__fx;
      if (!fx) return;
      this._ensureDynamics(e, o);
      const moving = kind === 'player' ? false
        : (o.state === 'move' || o.state === 'chase' || o.state === 'patrol');
      const dead = o.state === 'death';
      const t = at || 0;

      // 发光晶体脉冲
      const pulseAmp = (fx.cfg && fx.cfg.glow) || 0.6;
      for (const rec of fx.glow) {
        const arr = Array.isArray(rec.replacement) ? rec.replacement : [rec.replacement];
        for (const m of arr) {
          if (!m.userData.glow) continue;
          const base = m.userData.baseEmit || 2.3;
          m.emissiveIntensity = base + Math.sin(t * 3.2 + (rec.mesh.uuid.length % 7)) * pulseAmp;
        }
      }

      if (!fx.group) return;
      // 死亡渐隐动态层（静态高模随 model 倾倒，动态环/粒子淡出）
      let fade = 1;
      if (dead) {
        const prog = Math.min(1, Math.max(0, 1 - (o.deathTimer || 0) / 0.42));
        fade = 1 - prog;
      }
      for (const ring of fx.rings) {
        ring.rotation.y = t * ring.userData.spin;
        ring.material.opacity = (0.22 + 0.12 * Math.sin(t * 2.4)) * fade;
        const breathe = 1 + 0.05 * Math.sin(t * 2.0);
        ring.scale.set(breathe, 1, breathe);
      }
      if (fx.points) this._updatePoints(fx.points, t, moving, fade);
    },

    _updatePoints(pp, t, moving, fade) {
      const { geo, n, pc, seeds, mat } = pp;
      const arr = geo.attributes.position.array;
      const ca = geo.attributes.color.array;
      const [br, bg, bb] = hexRGB(pc.color);
      for (let i = 0; i < n; i++) {
        const sd = seeds[i];
        let x, y, z, lum;
        if (pc.mode === 'trail') {
          // 身后流动尾迹（局部 -z 为门内前进方向的反向）
          const flow = (sd.p + t * pc.speed * 0.35) % 1;
          z = -flow * pc.length;
          x = Math.sin(sd.a + t * 4) * 0.06 * flow;
          y = 0.45 + Math.sin(sd.a + t * 5) * 0.05 - flow * 0.12;
          lum = (1 - flow) * 0.9;
        } else if (pc.mode === 'mist') {
          const ph = sd.a + t * pc.speed * sd.s;
          const lift = (sd.p + t * pc.speed * 0.18) % 1;
          x = Math.cos(ph) * pc.radius * (0.5 + 0.5 * sd.p);
          z = Math.sin(ph) * pc.radius * 0.8;
          y = pc.yBase + lift * pc.rise;
          lum = (1 - lift) * 0.7;
        } else { // orbit 环绕能量
          const ph = sd.a + t * pc.speed * sd.s;
          const lift = (sd.p + t * pc.speed * 0.12) % 1;
          x = Math.cos(ph) * pc.radius;
          z = Math.sin(ph) * pc.radius * 0.82;
          y = pc.yBase + lift * pc.depth;
          lum = 0.55 + 0.45 * Math.sin(t * 3 + sd.a);
        }
        arr[i * 3] = x; arr[i * 3 + 1] = y; arr[i * 3 + 2] = z;
        const k = Math.max(0, lum) * fade;
        ca[i * 3] = br * k; ca[i * 3 + 1] = bg * k; ca[i * 3 + 2] = bb * k;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
      mat.opacity = 0.95 * fade;
    },

    /* 生物回池/换模板：还原共享发光材质，移除并销毁动态组 */
    onDespawn(e) {
      const fx = e.__fx;
      if (!fx) return;
      for (const rec of fx.glow) {
        if (rec.mesh) rec.mesh.material = rec.original;
        const arr = Array.isArray(rec.replacement) ? rec.replacement : [rec.replacement];
        for (const m of arr) {
          if (m && m.userData && m.userData.glow && m !== rec.original) { try { m.dispose(); } catch (err) {} }
        }
      }
      if (fx.group) {
        fx.group.traverse((o) => {
          if (o.geometry) { try { o.geometry.dispose(); } catch (err) {} }
          if (o.material) {
            const ms = Array.isArray(o.material) ? o.material : [o.material];
            ms.forEach((m) => { try { m.dispose(); } catch (err) {} });
          }
        });
        if (fx.group.parent) fx.group.parent.remove(fx.group);
      }
      e.__fx = null;
    },
  };

  window.EntityFX = EntityFX;
})();
