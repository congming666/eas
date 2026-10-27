/* ============================================================
   远征 3D 地形层（v5.9.26）
   手绘立体绘本风格 · 纯俯视正交相机（世界坐标与 2D 完全一致）
   - 高度场网格（顶点色：地形类型 + 海拔明暗 + 坡度岩壁）
   - 水面 shader（水深渐变 / 岸线泡沫 / 波纹 / 雨雪联动）
   - 低模树/岩石/残墙实例 + 方向光软阴影
   - 昼夜光色 / 天气（雨湿反光、雪覆盖、雾）
   失败时自动降级回 2D（返回 false，不改任何战斗/输入逻辑）
   ============================================================ */
(function () {
  'use strict';
  if (typeof THREE === 'undefined') { console.warn('[Terrain3D] three.js 未加载，保持 2D 地形'); return; }
  const T = THREE;
  window.TERRAIN_ELEV_WORLD = 150; // 高度场 1.0 = 150 世界像素（突出高低差）

  const TYPE = { grass: 0, water: 1, mud: 2, forest: 3, ruins: 4, highland: 5 };

  const Terrain3D = {
    _mode: null,
    enabled: null,
    ready: false,
    canvas: null,
    renderer: null,
    scene: null,
    camera: null,
    _exp: null,
    _mapId: null,
    _time: 0,
    _sun: null,
    _hemi: null,
    _terrainMesh: null,
    _terrainMat: null,
    _detailTex: null,
    _water: null,
    _waterU: null,
    _propMeshes: [],
    _fallbackWarned: false,

    setMode(mode) {
      this._mode = mode;
      try { localStorage.setItem('farmTerrain3D', mode); } catch (e) {}
      if (mode === 'off') { this.clear(); this.enabled = false; }
      else this.enabled = null;
      return this.enabled;
    },

    _modeSetting() {
      if (this._mode) return this._mode;
      try { return localStorage.getItem('farmTerrain3D') || 'auto'; } catch (e) { return 'auto'; }
    },

    _canUse() {
      const mode = this._modeSetting();
      if (mode === 'off') return false;
      if (mode === 'on') return true;
      // auto：桌面 + WebGL 可用；移动端/低内存回退 2D
      if (navigator.maxTouchPoints > 0 && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) return false;
      try {
        const c = document.createElement('canvas');
        return !!(c.getContext('webgl2') || c.getContext('webgl'));
      } catch (e) { return false; }
    },

    _insertCanvas() {
      const gc = document.getElementById('gameCanvas');
      if (!gc || !gc.parentNode) return false;
      const cv = document.createElement('canvas');
      cv.id = 'expeditionTerrain3DCanvas';
      cv.width = (window.CONFIG && CONFIG.canvas && CONFIG.canvas.width) || 1280;
      cv.height = (window.CONFIG && CONFIG.canvas && CONFIG.canvas.height) || 720;
      cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;';
      gc.parentNode.insertBefore(cv, gc);
      this.canvas = cv;
      return true;
    },

    _ensureRenderer() {
      if (this.renderer) return true;
      if (!this._canUse()) { this.enabled = false; return false; }
      if (!this._insertCanvas()) { this.enabled = false; return false; }
      try {
        const r = new T.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
        this._gcfg = window.GraphicsQuality ? window.GraphicsQuality.config() : null;
        r.setPixelRatio(Math.min(window.devicePixelRatio || 1, this._gcfg ? this._gcfg.dpr : 1.5));
        r.setSize(this.canvas.width, this.canvas.height, false);
        r.setClearColor(0x000000, 0);
        r.shadowMap.enabled = true;
        r.shadowMap.type = T.PCFSoftShadowMap;
        if (T.sRGBEncoding) r.outputEncoding = T.sRGBEncoding;
        this.renderer = r;
        this.scene = new T.Scene();
        this.scene.fog = new T.FogExp2(0x2a3428, 0.00016);
        this.camera = new T.OrthographicCamera(-640, 640, 360, -360, -400, 900);
        this.camera.up.set(0, 0, -1);
        this._hemi = new T.HemisphereLight(0xd6e4cc, 0x3a3220, 1.12);
        this.scene.add(this._hemi);
        this._sun = new T.DirectionalLight(0xffe6b8, 2.45);
        this._sun.castShadow = true;
        this._sun.shadow.mapSize.set(this._gcfg ? this._gcfg.shadowMap : 2048, this._gcfg ? this._gcfg.shadowMap : 2048);
        this._sun.shadow.camera.left = -1500;
        this._sun.shadow.camera.right = 1500;
        this._sun.shadow.camera.top = 1500;
        this._sun.shadow.camera.bottom = -1500;
        this._sun.shadow.camera.near = 1;
        this._sun.shadow.camera.far = 4200;
        this._sun.shadow.bias = -0.0007;
        this._sun.shadow.normalBias = 0.6;
        this.scene.add(this._sun);
        this.scene.add(this._sun.target);
        this.ready = true;
        this.enabled = true;
        // 预热实时 3D 实体层（异步加载 GLB/PBR；失败内部自回退，不影响地形）
        if (window.ThreeEntities && ThreeEntities.init) { try { ThreeEntities.init(); } catch (e) {} }
        // 方案 C P4：影视级后处理（ACES/四主题/Bloom）；失败内部自回退直渲，不影响地形
        if (window.ThreePostFX && ThreePostFX.init) {
          try { ThreePostFX.init(r, this.scene, this.camera, this.canvas.width, this.canvas.height); } catch (e) {}
        }
        return true;
      } catch (e) {
        console.warn('[Terrain3D] WebGL 初始化失败，回退 2D 地形：', e);
        if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
        this.canvas = null;
        this.enabled = false;
        return false;
      }
    },

    /* ---------------- 贴图：手绘纸感细节（中性灰，乘到顶点色上） ---------------- */
    _makeDetailTexture() {
      if (this._detailTex) return this._detailTex;
      const S = 256;
      const cv = document.createElement('canvas'); cv.width = cv.height = S;
      const c = cv.getContext('2d');
      c.fillStyle = '#f2eddd'; c.fillRect(0, 0, S, S);
      // 纸纹 + 笔触颗粒
      for (let i = 0; i < 2600; i++) {
        const x = Math.random() * S, y = Math.random() * S;
        const l = 226 + Math.random() * 28;
        c.fillStyle = 'rgba(' + l + ',' + (l - 8) + ',' + (l - 26) + ',' + (0.08 + Math.random() * 0.16) + ')';
        c.fillRect(x, y, 1 + Math.random() * 3, 1 + Math.random() * 2);
      }
      for (let i = 0; i < 70; i++) {
        const x = Math.random() * S, y = Math.random() * S, r = 6 + Math.random() * 26;
        c.strokeStyle = 'rgba(120,104,78,' + (0.03 + Math.random() * 0.05) + ')';
        c.lineWidth = 1 + Math.random() * 2;
        c.beginPath(); c.arc(x, y, r, Math.random() * 6.28, Math.random() * 6.28 + 1.6); c.stroke();
      }
      const tex = new T.CanvasTexture(cv);
      tex.wrapS = tex.wrapT = T.RepeatWrapping;
      tex.encoding = T.sRGBEncoding;
      tex.anisotropy = Math.min(4, this.renderer && this.renderer.capabilities.getMaxAnisotropy ? this.renderer.capabilities.getMaxAnisotropy() : 1);
      this._detailTex = tex;
      return tex;
    },

    /* ---------------- 地表网格：分块高度场 + 2D 手绘贴图（保留原有手绘细节） ---------------- */
    _buildTerrain(exp) {
      const hf = exp.terrainHeight;
      if (!hf) return null;
      const cs = 512;
      const size = hf.size;
      const nx = Math.ceil(size / cs), nz = Math.ceil(size / cs);
      const ELEV = window.TERRAIN_ELEV_WORLD;
      const seg = 40;
      const theme = (exp.map && exp.map.terrain) || {};
      const fallbackCol = new T.Color(theme.ground || '#466038').offsetHSL(0, 0, -0.02);
      const group = new T.Group();
      this._terrainChunks = [];
      for (let cy = 0; cy < nz; cy++) {
        for (let cx = 0; cx < nx; cx++) {
          const w = Math.min(cs, size - cx * cs);
          const h = Math.min(cs, size - cy * cs);
          if (w <= 0 || h <= 0) continue;
          const ox = cx * cs, oy = cy * cs;
          const geo = new T.PlaneGeometry(w, h, seg, seg);
          geo.rotateX(-Math.PI / 2);
          const pos = geo.attributes.position;
          const normals = geo.attributes.normal;
          const eps = 8;
          for (let i = 0; i < pos.count; i++) {
            const wx = pos.getX(i) + ox + w / 2;
            const wz = pos.getZ(i) + oy + h / 2;
            const hC = (exp.getElevation ? exp.getElevation(wx, wz) : 0) * ELEV;
            pos.setY(i, hC);
            // 用高度场解析法线，保证跨 chunk 边界光照连续（消除方块接缝）
            const hR = (exp.getElevation ? exp.getElevation(wx + eps, wz) : 0) * ELEV;
            const hL = (exp.getElevation ? exp.getElevation(wx - eps, wz) : 0) * ELEV;
            const hD = (exp.getElevation ? exp.getElevation(wx, wz + eps) : 0) * ELEV;
            const hU = (exp.getElevation ? exp.getElevation(wx, wz - eps) : 0) * ELEV;
            const dx = (hR - hL) / (2 * eps), dz = (hD - hU) / (2 * eps);
            let nx = -dx, ny = 1, nz = -dz;
            const nl = Math.hypot(nx, ny, nz) || 1;
            normals.setXYZ(i, nx / nl, ny / nl, nz / nl);
          }
          geo.computeBoundingSphere();
          const mat = new T.MeshStandardMaterial({
            color: fallbackCol.clone(),
            roughness: 0.95,
            metalness: 0.0
          });
          // P12-a 地面法线颗粒：正俯视下靠法线明暗读出地表凹凸，不再是塑料平片
          if (typeof GroundDetail !== 'undefined' && GroundDetail.enabled()) {
            try {
              const ntex = GroundDetail.groundNormalTexture(T);
              if (ntex) {
                ntex.repeat.set(cs / 128, cs / 128); // 约 128 世界单位一个法线 tile
                mat.normalMap = ntex;
                mat.normalScale = new T.Vector2(0.65, 0.65);
              }
            } catch (e) {}
          }
          const mesh = new T.Mesh(geo, mat);
          mesh.position.set(ox + w / 2, 0, oy + h / 2);
          mesh.castShadow = false;      // 地形不自投影（避免大范围硬阴影带），靠法线明暗
          mesh.receiveShadow = true;
          group.add(mesh);
          this._terrainChunks.push({ mesh, mat, cx, cy, ox, oy, w, h, textured: false });
        }
      }
      this._terrainGroup = group;
      return group;
    },

    // 按可见范围把 2D 手绘 chunk 烘焙成贴图（保留原版草丛/裂纹/道路细节，零额外美术）
    _syncChunkTextures(exp, cam) {
      if (!this._terrainChunks || !this._terrainChunks.length) return;
      if (!exp.terrainChunkCache) return;
      const W = (window.CONFIG && CONFIG.canvas && CONFIG.canvas.width) || 1280;
      const H = (window.CONFIG && CONFIG.canvas && CONFIG.canvas.height) || 720;
      const rz = cam.zoom || 1;
      const vw = W / rz, vh = H / rz;
      const minX = cam.x - 300, maxX = cam.x + vw + 300;
      const minY = cam.y - 300, maxY = cam.y + vh + 300;
      for (const ch of this._terrainChunks) {
        if (ch.textured) continue;
        if (ch.ox + ch.w < minX || ch.ox > maxX || ch.oy + ch.h < minY || ch.oy > maxY) continue;
        const canvas = exp.terrainChunkCache.get(ch.cx, ch.cy, (cctx, wx, wy) => {
          exp.renderTerrainDirect(cctx, { x: wx, y: wy });
        });
        if (!canvas) continue;
        const tex = new T.CanvasTexture(canvas);
        if (T.sRGBEncoding) tex.encoding = T.sRGBEncoding;
        tex.anisotropy = (typeof GroundDetail !== 'undefined' && GroundDetail.enabled()) ? 8 : 4;
        ch.mat.map = tex;
        ch.mat.color.set(0xffffff);
        ch.mat.needsUpdate = true;
        ch.textured = true;
      }
    },

    /* ---------------- 水面 shader ---------------- */
    _buildWater(exp) {
      const hf = exp.terrainHeight;
      if (!hf) return null;
      const size = hf.size, ELEV = window.TERRAIN_ELEV_WORLD;
      const depthData = new Uint8Array(hf.n * hf.n * 4);
      for (let i = 0; i < hf.n * hf.n; i++) {
        const d = hf.waterLevel - hf.data[i];
        const v = Math.max(0, Math.min(255, Math.round((d / 0.45) * 255)));
        depthData[i * 4] = v; depthData[i * 4 + 1] = v; depthData[i * 4 + 2] = v; depthData[i * 4 + 3] = 255;
      }
      const depthTex = new T.DataTexture(depthData, hf.n, hf.n, T.RGBAFormat);
      depthTex.magFilter = T.LinearFilter;
      depthTex.minFilter = T.LinearFilter;
      depthTex.wrapS = depthTex.wrapT = T.ClampToEdgeWrapping;
      depthTex.needsUpdate = true;

      const geo = new T.PlaneGeometry(size, size);
      geo.rotateX(-Math.PI / 2);
      const u = {
        uDepth: { value: depthTex },
        uTime: { value: 0 },
        uWaterLevel: { value: hf.waterLevel * ELEV },
        uWet: { value: 0.2 },
        uSnow: { value: 0 },
        uSunColor: { value: new T.Color(0xfff0d0) }
      };
      const mat = new T.ShaderMaterial({
        uniforms: u,
        transparent: true,
        depthWrite: false,
        vertexShader: `
          varying vec2 vWorld;
          varying vec2 vUv;
          void main() {
            vUv = uv;
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorld = wp.xz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: `
          uniform sampler2D uDepth;
          uniform float uTime;
          uniform float uWet;
          uniform float uSnow;
          uniform vec3 uSunColor;
          varying vec2 vWorld;
          varying vec2 vUv;
          void main() {
            float depth = texture2D(uDepth, vUv).r;
            if (depth <= 0.004) discard;
            vec3 shallow = vec3(0.42, 0.70, 0.62);
            vec3 deep = vec3(0.10, 0.26, 0.36);
            vec3 col = mix(shallow, deep, smoothstep(0.03, 0.85, depth));
            // 波纹（世界坐标，手绘水波）
            float w1 = sin(vWorld.x * 0.08 + uTime * 1.6) * sin(vWorld.y * 0.11 - uTime * 1.2);
            float w2 = sin(vWorld.x * 0.21 - uTime * 2.1 + vWorld.y * 0.13);
            float ripple = w1 * 0.6 + w2 * 0.4;
            col += vec3(0.05, 0.07, 0.06) * ripple;
            // 太阳反光
            float spec = pow(max(0.0, ripple), 6.0);
            col += uSunColor * spec * 0.16;
            // 岸线泡沫
            float foam = smoothstep(0.10, 0.015, depth);
            col = mix(col, vec3(0.82, 0.90, 0.82), foam * 0.5);
            // 雨/雪
            col += vec3(0.04, 0.05, 0.05) * uWet * ripple;
            col = mix(col, vec3(0.72, 0.80, 0.84), uSnow * 0.55);
            float alpha = mix(0.42, 0.86, smoothstep(0.02, 0.6, depth));
            alpha = mix(alpha, 0.95, uSnow * 0.4);
            gl_FragColor = vec4(col, alpha);
          }
        `
      });
      this._waterU = u;
      const mesh = new T.Mesh(geo, mat);
      mesh.position.set(size / 2, hf.waterLevel * ELEV + 0.6, size / 2);
      mesh.renderOrder = 2;
      this._water = mesh;
      return mesh;
    },

    /* ---------------- 低模道具（树/岩/残墙/灌木） ---------------- */
    _buildProps(exp) {
      const objs = (exp.obstacles || []).filter(o => o && !o.fxOnly && Number.isFinite(o.x));
      const ELEV = window.TERRAIN_ELEV_WORLD;
      const groups = { tree: [], rock: [], bush: [], ruin: [] };
      objs.forEach((o) => { if (groups[o.type]) groups[o.type].push(o); });
      const dummy = new T.Object3D();
      const meshes = [];
      const hash = (i, s) => {
        let x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453;
        return x - Math.floor(x);
      };

      const makeInstanced = (geo, mat, list, place) => {
        if (!list.length) return null;
        const m = new T.InstancedMesh(geo, mat, list.length);
        m.castShadow = true;
        m.receiveShadow = true;
        list.forEach((o, i) => {
          const h = exp.getElevation ? exp.getElevation(o.x, o.y) : 0;
          place(dummy, o, i, h);
          dummy.updateMatrix();
          m.setMatrixAt(i, dummy.matrix);
          if (m.setColorAt) {
            const col = new T.Color(0xffffff);
            if (o.type === 'tree' || o.type === 'bush') {
              col.setHSL(0.24 + hash(i, 1) * 0.06, 0.32 + hash(i, 2) * 0.18, 0.34 + hash(i, 3) * 0.12);
            } else if (o.type === 'ruin') {
              col.setHSL(0.10, 0.08, 0.44 + hash(i, 4) * 0.1);
            } else {
              col.setHSL(0.09, 0.06, 0.36 + hash(i, 5) * 0.1);
            }
            col.convertSRGBToLinear();
            m.setColorAt(i, col);
          }
        });
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        this.scene.add(m);
        meshes.push(m);
        return m;
      };

      // 树干
      const trunkGeo = new T.CylinderGeometry(2.6, 3.6, 42, 5);
      const trunkMat = new T.MeshStandardMaterial({ color: 0x5a4028, roughness: 1 });
      makeInstanced(trunkGeo, trunkMat, groups.tree, (d, o, i, h) => {
        const s = 0.85 + hash(i, 11) * 0.55;
        d.position.set(o.x, h * ELEV + 21 * s, o.y);
        d.rotation.set(0, hash(i, 12) * 6.28, 0);
        d.scale.set(s, s, s);
      });
      // 树冠（两层，手绘团块）
      const canopyMat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
      const canopyGeo = new T.IcosahedronGeometry(17, 1);
      makeInstanced(canopyGeo, canopyMat, groups.tree, (d, o, i, h) => {
        const s = 0.9 + hash(i, 21) * 0.6;
        d.position.set(o.x, h * ELEV + 52 * s, o.y);
        d.rotation.set(hash(i, 22) * 1.2, hash(i, 23) * 6.28, hash(i, 24) * 0.6);
        d.scale.set(s * 1.15, s * 0.86, s);
      });
      const canopy2Mat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
      makeInstanced(new T.IcosahedronGeometry(11, 1), canopy2Mat, groups.tree, (d, o, i, h) => {
        const s = 0.7 + hash(i, 31) * 0.45;
        d.position.set(o.x + (hash(i, 32) - 0.5) * 16, h * ELEV + 66 * s, o.y + (hash(i, 33) - 0.5) * 16);
        d.rotation.set(hash(i, 34) * 1.2, hash(i, 35) * 6.28, 0);
        d.scale.set(s * 1.2, s * 0.8, s);
      });
      // 岩石
      makeInstanced(new T.DodecahedronGeometry(15, 0), new T.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
        groups.rock, (d, o, i, h) => {
          const s = 0.8 + hash(i, 41) * 0.9;
          d.position.set(o.x, h * ELEV + 7 * s, o.y);
          d.rotation.set(hash(i, 42) * 0.5, hash(i, 43) * 6.28, hash(i, 44) * 0.5);
          d.scale.set(s * 1.2, s * 0.7, s);
        });
      // 灌木
      makeInstanced(new T.SphereGeometry(12, 6, 4), new T.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
        groups.bush, (d, o, i, h) => {
          const s = 0.7 + hash(i, 51) * 0.5;
          d.position.set(o.x, h * ELEV + 8 * s, o.y);
          d.rotation.set(0, hash(i, 52) * 6.28, 0);
          d.scale.set(s, s * 0.7, s);
        });
      // 残墙
      makeInstanced(new T.BoxGeometry(30, 24, 12), new T.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
        groups.ruin, (d, o, i, h) => {
          const s = 0.8 + hash(i, 61) * 0.6;
          d.position.set(o.x, h * ELEV + 8 * s, o.y);
          d.rotation.set(0, hash(i, 62) * 6.28, 0);
          d.scale.set(s, s, s);
        });
      this._propMeshes = meshes;
      return meshes;
    },

    /* P11-7 写实草丛几何：若干片绕轴交叉、带自然弯曲的细长草叶合并为单一 BufferGeometry，
       一个 InstancedMesh = 一丛草，仍是单 draw call；替代旧版俯视可见的绿色三棱锥。 */
    _makeGrassTuftGeometry(blades) {
      const positions = [], normals = [], uvs = [], indices = [];
      const H = 20, w0 = 1.9, w1 = 1.05, hm = H * 0.55, bend = 3.2;
      const rotY = (x, y, z, ang) => {
        const c = Math.cos(ang), s = Math.sin(ang);
        return [x * c + z * s, y, -x * s + z * c];
      };
      for (let j = 0; j < blades; j++) {
        const base = positions.length / 3;
        const ang = (j / blades) * Math.PI * 2 + (j * 0.73);
        const curve = bend * (0.8 + (j % 3) * 0.18);
        // 单片叶 5 顶点：根左右 / 腰左右 / 尖
        const leaf = [
          [-w0, 0, 0], [w0, 0, 0],
          [-w1, hm, curve * 0.7], [w1, hm, curve * 0.7],
          [0, H, curve * 1.55],
        ];
        for (let k = 0; k < leaf.length; k++) {
          const p = rotY(leaf[k][0], leaf[k][1], leaf[k][2], ang);
          positions.push(p[0], p[1], p[2]);
          const n = rotY(0, 0.85, 0.4, ang);
          const nl = Math.hypot(n[0], n[1], n[2]) || 1;
          normals.push(n[0] / nl, n[1] / nl, n[2] / nl);
          uvs.push(k === 1 || k === 3 ? 1 : 0, k < 2 ? 0 : (k === 4 ? 1 : 0.55));
        }
        // 根部四边形（两三角）+ 腰部到尖的三角
        indices.push(base, base + 1, base + 3, base, base + 3, base + 2,
                     base + 2, base + 3, base + 4);
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
      geo.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
      geo.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.computeBoundingSphere();
      return geo;
    },

    /* ---------------- P11 写实风动草丛（按地图主题变色/变密度/荧光） ---------------- */
    _buildGrass(exp) {
      const hf = exp.terrainHeight;
      if (!hf) return null;
      const ELEV = window.TERRAIN_ELEV_WORLD;
      const theme = (window.MapThemes && MapThemes.get(exp.map)) || null;
      const g = theme ? theme.grass : { density: 1, hMin: 12, hMax: 22, blades: 5, glow: 0 };
      const N_MAX = 1900;
      const N = Math.max(0, Math.min(N_MAX, Math.round(1300 * (g.density != null ? g.density : 1))));
      if (N <= 0) { this._grassMesh = null; return null; }
      const blades = Math.max(3, Math.min(7, g.blades || 5));
      const p12Grass = (typeof SceneryP12 !== 'undefined' && SceneryP12.enabled());
      const geo = p12Grass ? SceneryP12.makeGrassTuftGeometry(T, blades) : this._makeGrassTuftGeometry(blades);
      this._windU = { value: 0 };
      const mat = new T.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.92, metalness: 0, side: T.DoubleSide,
      });
      // 高危/绝境图的草丛带与地图同调的微弱自发光（荧光草），亮图 glow=0 完全不发光
      if (theme && g.glow > 0) {
        mat.emissive = new T.Color(theme.tint);
        mat.emissiveIntensity = g.glow;
      }
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = this._windU;
        shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n' +
          'float _wx = instanceMatrix[3].x; float _wz = instanceMatrix[3].z;\n' +
          'float _hgt = max(0.0, transformed.y) / 20.0;\n' +
          'float _sway = (sin(uTime * 1.5 + _wx * 0.04 + _wz * 0.028) * 0.22 + sin(uTime * 3.0 + _wx * 0.11) * 0.08) * _hgt * _hgt;\n' +
          'transformed.x += _sway * 14.0;\n' +
          'transformed.z += _sway * 6.0;'
        );
      };
      const mesh = new T.InstancedMesh(geo, mat, N);
      const dummy = new T.Object3D();
      const col = new T.Color();
      const hash = (i, s) => { const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };
      let placed = 0;
      const size = hf.size;
      const yMin = (g.hMin != null ? g.hMin : 12) / 20, yMax = (g.hMax != null ? g.hMax : 22) / 20;
      const maxAttempts = p12Grass ? N * 14 : N * 6;
      for (let i = 0; i < maxAttempts && placed < N; i++) {
        const x = hash(i, 1) * size, y = hash(i, 2) * size;
        const type = exp.getTerrainTypeId ? exp.getTerrainTypeId(x, y) : 0;
        if (type !== 0 && type !== 3) continue;   // 只长在草甸/密林
        if (p12Grass && !SceneryP12.grassDensityAt(x, y, 555, 0.5)) continue; // P12-b 波噪声成簇
        const e = exp.getElevation ? exp.getElevation(x, y) : 0;
        dummy.position.set(x, e * ELEV - 0.5, y);
        dummy.rotation.set(0, hash(i, 3) * 6.28, 0);
        const sy = yMin + hash(i, 5) * (yMax - yMin);
        const sx = 0.8 + hash(i, 4) * 0.5;
        dummy.scale.set(sx, sy, sx * (0.9 + hash(i, 9) * 0.25));
        dummy.updateMatrix();
        mesh.setMatrixAt(placed, dummy.matrix);
        if (window.MapThemes && theme) MapThemes.grassColor(theme, hash(i, 6), hash(i, 7), hash(i, 8), col);
        else col.setHSL(0.25, 0.4, 0.32);
        col.convertSRGBToLinear();
        mesh.setColorAt(placed, col);
        placed++;
      }
      mesh.count = placed;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      this._grassMesh = mesh;
      return mesh;
    },

    /* ---------------- 构建某一局远征 ---------------- */
    build(exp) {
      if (!this._ensureRenderer()) return false;
      try {
        this.clear(true);
        exp._terrain3DShadeOff = true;   // 3D 用真实光照，2D 山体假光影不再烘焙
        this._terrainChunks = [];
        this._exp = exp;
        this._expTierApplied = -1;   // 新远征首帧强制重设后期主题（确保 P12-e 调色覆盖落在 T1）
        this._mapId = (exp.map && exp.map.id) || 'map';
        this._theme = (window.MapThemes && exp.map) ? MapThemes.get(exp.map) : null;
        this._themeTint = this._theme ? new T.Color(this._theme.tint) : null;
        this._time = 0;
        if (this._themeTint && this.scene.fog) {   // 进图首帧雾色即贴合主题，避免闪一下默认绿雾
          this.scene.fog.color.copy(this._themeTint).lerp(new T.Color(0x2a3428), 0.55);
        }
        const terr = this._buildTerrain(exp);
        if (terr) this.scene.add(terr);
        const water = this._buildWater(exp);
        if (water) this.scene.add(water);
        // GLB 实体层就绪后，tree/rock/bush/ruin 由真实模型承担，跳过程序化 InstancedMesh 避免重复
        const glbObstaclesOn = window.ThreeEntities && ThreeEntities.ready && ThreeEntities.enabled;
        if (!glbObstaclesOn) this._buildProps(exp); else this._propMeshes = [];
        const grass = this._buildGrass(exp);
        if (grass) this.scene.add(grass);
        // P12-b 纯视觉装饰地标（贴地树冠团/岩石群/枯树/废墟，不参与碰撞与战斗）
        if (typeof SceneryP12 !== 'undefined' && SceneryP12.enabled()) {
          try {
            let qt = 1;
            if (window.GraphicsQuality && typeof GraphicsQuality.tier === 'function') qt = GraphicsQuality.tier();
            const sc = SceneryP12.build(T, exp, this.scene, qt);
            if (sc) { this.scene.add(sc); this._sceneryP12 = sc; }
          } catch (e) { console.warn('[Terrain3D] P12 装饰层失败：', e); }
        }
        return true;
      } catch (e) {
        console.warn('[Terrain3D] 构建失败，回退 2D 地形：', e);
        this.clear();
        this.enabled = false;
        return false;
      }
    },

    // GLB 实体层就绪后调用：移除程序化 tree/rock/bush/ruin 实例（由真实 GLB 障碍接管）
    suspendProps() {
      const dispose = (obj) => {
        if (!obj || !this.scene) return;
        this.scene.remove(obj);
        if (obj.geometry && obj.geometry.dispose) obj.geometry.dispose();
        if (obj.material) { const mats = Array.isArray(obj.material) ? obj.material : [obj.material]; mats.forEach(m => m && m.dispose && m.dispose()); }
      };
      this._propMeshes.forEach(dispose);
      this._propMeshes = [];
    },

    _shadeHex(hex, amt) {
      const c = new T.Color(hex);
      c.offsetHSL(0, 0, amt);
      return '#' + c.getHexString();
    },

    /* ---------------- 每帧渲染 ---------------- */
    render(exp, cam) {
      if (this.enabled === false) return false;
      if (!exp || !exp.terrainHeight) return false;
      if (!this.ready && !this._ensureRenderer()) return false;
      if (this._exp !== exp) {
        if (!this.build(exp)) return false;
      }
      if (!this.scene || !this.camera) return false;
      try {
        const W = (window.CONFIG && CONFIG.canvas && CONFIG.canvas.width) || 1280;
        const H = (window.CONFIG && CONFIG.canvas && CONFIG.canvas.height) || 720;
        const rz = cam.zoom || 1;
        const halfW = W / (2 * rz), halfH = H / (2 * rz);
        const c = this.camera;
        if (c.right !== halfW || c.top !== halfH) {
          c.left = -halfW; c.right = halfW; c.top = halfH; c.bottom = -halfH;
          c.updateProjectionMatrix();
        }
        c.position.set(cam.x + halfW, 260, cam.y + halfH);
        c.lookAt(cam.x + halfW, 0, cam.y + halfH);
        this.camera.updateMatrixWorld();

        this._time += 1 / 60;
        if (this._windU) this._windU.value = this._time;
        this._syncChunkTextures(exp, cam);
        if (this._waterU) this._waterU.uTime.value = this._time;
        this._updateEnv(exp);
        // 方案 C：实时 3D 实体层在同一 Three 场景内同步（失败/未就绪时静默跳过，实体留 Pixi/2D）
        if (window.ThreeEntities) { try { ThreeEntities.sync(exp); } catch (e) {} }
        // 方案 C P4：后处理可用时走 composer（含 ACES/Bloom/主题调色），否则直渲
        const fx = window.ThreePostFX;
        if (fx && fx.ready && fx.enabled) {
          try {
            const tier = (exp.map && exp.map.tier) || 1;
            if (fx._targetTier !== tier || this._expTierApplied !== tier) { fx.setTier(tier, true); this._expTierApplied = tier; }
            if (this._fxW !== W || this._fxH !== H) { fx.setSize(W, H); this._fxW = W; this._fxH = H; }
            if (!fx.render(1 / 60)) this.renderer.render(this.scene, this.camera);
          } catch (e) { this.renderer.render(this.scene, this.camera); }
        } else {
          this.renderer.render(this.scene, this.camera);
        }
        // P6：真实墙钟帧时采样 + 档位热更新（DPR 即时生效；阴影/池容量下次进图生效）。
        // 整段独立保护：画质监控任何异常都不得拖垮渲染主路径触发 2D 回退。
        try {
          if (window.GraphicsQuality) {
            const gq = window.GraphicsQuality;
            if (!this._gqBound) {
              this._gqBound = true;
              gq.onTierChange((t, cfg) => {
                try {
                  this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cfg.dpr));
                  this.renderer.setSize(this.canvas.width, this.canvas.height, false);
                  if (window.ThreePostFX && ThreePostFX.setSize) ThreePostFX.setSize(this.canvas.width, this.canvas.height);
                } catch (e) { gq.markFail('hotDpr', e); }
              });
            }
            const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
            if (this._gqLast) gq.recordFrame(now - this._gqLast);
            this._gqLast = now;
          }
        } catch (gqErr) { try { window.GraphicsQuality && window.GraphicsQuality.markFail('monitor', gqErr); } catch (e) {} }
        return true;
      } catch (e) {
        if (!this._fallbackWarned) { this._fallbackWarned = true; console.warn('[Terrain3D] 渲染异常，回退 2D：', e); }
        this.enabled = false;
        return false;
      }
    },

    _updateEnv(exp) {
      const phase = exp.dayNightPhase || 'day';
      const w = (exp.weather && exp.weather.state) || 'clear';
      const wet = /rain|storm/.test(w) ? 1 : (w === 'cloud' ? 0.35 : 0.12);
      const snow = w === 'snow' ? 1 : 0;
      const fog = w === 'fog' ? 1 : (/rain|storm/.test(w) ? 0.45 : w === 'cloud' ? 0.2 : 0);
      const sunEl = (phase === 'night') ? 500 : 620;
      const sunAz = (phase === 'dusk' || phase === 'dawn') ? 1.2 : 2.4;
      const cx = exp.terrainHeight ? exp.terrainHeight.size / 2 : 1200;

      // 方案 C P4：后处理就绪时，光照/雾走「四主题基线 × 昼夜/天气调制」；否则用原硬编码色表（回退）
      const fxE = (window.ThreePostFX && ThreePostFX.ready && ThreePostFX.enabled) ? ThreePostFX.env() : null;
      if (fxE) {
        if (!this._fxTmp) { this._fxTmp = { sun: new T.Color(), hemi: new T.Color(), hg: new T.Color(), dusk: new T.Color(0xff9a55), night: new T.Color(0x9fb6ff), dawn: new T.Color(0xffb987), nfog: new T.Color(0x141c2c) }; }
        const K = this._fxTmp;
        // 相位强度/染色权重
        const pK = phase === 'night' ? 0.68 : (phase === 'dusk' ? 0.8 : phase === 'dawn' ? 0.82 : 1);
        const SUN_SCALE = 1.55; // Unity 主题光强（~1.5）标定到网页既有日光量级（~2.45）
        if (this._sun) {
          K.sun.setRGB(fxE.key.x, fxE.key.y, fxE.key.z);
          if (phase === 'dusk') K.sun.lerp(K.dusk, 0.35);
          else if (phase === 'dawn') K.sun.lerp(K.dawn, 0.3);
          else if (phase === 'night') K.sun.lerp(K.night, 0.45).multiplyScalar(0.85);
          this._sun.color.copy(K.sun);
          this._sun.intensity = fxE.intensity * SUN_SCALE * pK;
          this._sun.position.set(cx + Math.cos(sunAz) * 1500, sunEl, cx + Math.sin(sunAz) * 1200);
          this._sun.target.position.set(cx, 0, cx);
          this._sun.target.updateMatrixWorld();
        }
        if (this._hemi) {
          K.hemi.setRGB(fxE.ambient.x, fxE.ambient.y, fxE.ambient.z);
          if (phase === 'night') K.hemi.lerp(new T.Color(0x50607a), 0.4);
          else if (phase === 'dusk' || phase === 'dawn') K.hemi.lerp(new T.Color(0xd8b48c), 0.3);
          K.hg.setRGB(Math.min(fxE.ground.x, 1) * 0.38, Math.min(fxE.ground.y, 1) * 0.38, Math.min(fxE.ground.z, 1) * 0.38);
          this._hemi.color.copy(K.hemi);
          this._hemi.groundColor.copy(K.hg);
          this._hemi.intensity = 1.12 * pK * (1 + fog * 0.15);
        }
        // 材质湿滑/雪、水 uniform 与原逻辑一致
        const _fxMats = (this._terrainChunks || []).map(c => c.mat);
        if (this._terrainMat) _fxMats.push(this._terrainMat);
        _fxMats.forEach((m) => {
          if (!m) return;
          m.roughness = 0.95 - wet * 0.38;
          m.metalness = wet * 0.05;
          if (m.map) m.color.setRGB(1, 1, 1);
        });
        if (this._waterU) {
          this._waterU.uWet.value = wet; this._waterU.uSnow.value = snow;
          if (this._sun) this._waterU.uSunColor.value.copy(this._sun.color);
        }
        if (this.scene.fog) {
          const base = ThreePostFX.fogBase();
          this.scene.fog.color.setRGB(fxE.fog.x, fxE.fog.y, fxE.fog.z);
          if (phase === 'night') { K.nfog.setRGB(0.078, 0.11, 0.17); this.scene.fog.color.lerp(K.nfog, 0.6); }
          // Unity 米密度按相对比例映射到网页像素基准，再叠加既有天气/夜晚加权
          this.scene.fog.density = base * fxE.fogScale + fog * 0.00045 + wet * 0.00008 + (phase === 'night' ? 0.00006 : 0);
        }
        this._applyMapTheme(phase);
        return;
      }

      let sunColor = 0xffe6b8, sunInt = 2.45, hemiInt = 1.12;
      if (phase === 'dusk') { sunColor = 0xff9a55; sunInt = 1.75; hemiInt = 0.75; }
      else if (phase === 'night') { sunColor = 0x9fb6ff; sunInt = 1.75; hemiInt = 0.95; }
      else if (phase === 'dawn') { sunColor = 0xffb987; sunInt = 1.6; hemiInt = 0.72; }
      if (this._sun) {
        this._sun.color.setHex(sunColor);
        this._sun.intensity = sunInt;
        this._sun.position.set(cx + Math.cos(sunAz) * 1500, sunEl, cx + Math.sin(sunAz) * 1200);
        this._sun.target.position.set(cx, 0, cx);
        this._sun.target.updateMatrixWorld();
      }
      if (this._hemi) {
        this._hemi.intensity = hemiInt * (1 + fog * 0.15);
        if (phase === 'night') this._hemi.color.setHex(0x50607a);
        else if (phase === 'dusk' || phase === 'dawn') this._hemi.color.setHex(0xd8b48c);
        else this._hemi.color.setHex(0xd6e4cc);
      }
      const _mats = (this._terrainChunks || []).map(c => c.mat);
      if (this._terrainMat) _mats.push(this._terrainMat);
      _mats.forEach((m) => {
        if (!m) return;
        m.roughness = 0.95 - wet * 0.38;
        m.metalness = wet * 0.05;
        if (m.map) m.color.setRGB(1, 1, 1);
      });
      if (this._waterU) {
        this._waterU.uWet.value = wet;
        this._waterU.uSnow.value = snow;
        if (this._sun) this._waterU.uSunColor.value.copy(this._sun.color);
      }
      if (this.scene.fog) {
        const nightK = phase === 'night' ? 1 : (phase === 'dusk' || phase === 'dawn' ? 0.5 : 0);
        this.scene.fog.color.setHex(nightK ? 0x141c2c : 0x2a3428);
        this.scene.fog.density = 0.0001 + fog * 0.00045 + wet * 0.00008 + nightK * 0.00006;
      }
      this._applyMapTheme(phase);
    },

    /* P11-5 逐图氛围：在 tier 光照/雾基线（PostFX 或硬编码）算出当帧最终色之后，再按本图主题
       轻微染色并调整光强/雾密度。每帧从基线重新 lerp，权重恒定，不会逐帧累积漂移。 */
    _applyMapTheme(phase) {
      const th = this._theme, tint = this._themeTint;
      if (!th || !tint) return;
      const pk = phase === 'night' ? 0.5 : (phase === 'dusk' || phase === 'dawn' ? 0.75 : 1);
      const w = (th.tintWeight || 0) * pk;
      if (this._sun) {
        this._sun.color.lerp(tint, w * 0.55);
        this._sun.intensity *= (th.sunMul != null ? th.sunMul : 1);
      }
      if (this._hemi) {
        this._hemi.color.lerp(tint, w * 0.4);
        this._hemi.groundColor.lerp(tint, w * 0.25);
        this._hemi.intensity *= (th.hemiMul != null ? th.hemiMul : 1);
      }
      if (this.scene.fog) {
        this.scene.fog.color.lerp(tint, w * 0.7);
        this.scene.fog.density *= (th.fogMul != null ? th.fogMul : 1);
      }
    },

    /* ---------------- 清理 ---------------- */
    clear(keepRenderer) {
      const remove = (obj) => {
        if (!obj || !this.scene) return;
        this.scene.remove(obj);
        if (obj.geometry && obj.geometry.dispose) obj.geometry.dispose();
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => { if (m.map && m.map !== this._detailTex) m.map.dispose(); if (m.dispose) m.dispose(); });
        }
      };
      if (this._grassMesh) { remove(this._grassMesh); this._grassMesh = null; }
      if (this._sceneryP12) {
        this._sceneryP12.traverse((o) => {
          if (o.isMesh) { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); }
        });
        if (this.scene) this.scene.remove(this._sceneryP12);
        this._sceneryP12 = null;
      }
      if (this._terrainChunks) this._terrainChunks.forEach((ch) => remove(ch.mesh));
      if (this._terrainGroup) { this.scene.remove(this._terrainGroup); this._terrainGroup = null; }
      this._terrainChunks = [];
      remove(this._terrainMesh);
      remove(this._water);
      this._propMeshes.forEach(remove);
      this._terrainMesh = null; this._water = null; this._propMeshes = [];
      this._waterU = null; this._terrainMat = null;
      this._exp = null;
      // 通知 3D 实体层回收本局实体（模板/材质保留）
      if (window.ThreeEntities && ThreeEntities.onExpClear) { try { ThreeEntities.onExpClear(); } catch (e) {} }
      if (!keepRenderer) {
        this.ready = false;
        if (this.renderer) { try { this.renderer.dispose(); } catch (e) {} this.renderer = null; }
        if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
        this.canvas = null;
        this.scene = null;
        this.camera = null;
      }
    }
  };

  // 工具：hex 明暗自增（局部副本，避免依赖全局 shadeHex）
  function shade(hex, amt) {
    const c = new T.Color(hex);
    c.offsetHSL(0, 0, amt);
    return '#' + c.getHexString();
  }

  window.Terrain3D = Terrain3D;
})();
