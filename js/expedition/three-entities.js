/* ============================================================
   远征 实时 3D 实体层 ThreeEntities（方案 C · P3）
   - 消费 exp 运行时数据，在 Terrain3D 的 Three 场景内渲染真实低模 PBR 实体
   - 无贴图 GLB（单位高度/底 y=0/Y-up）+ 按材质名共享的 PBR 纹理库
   - 无骨骼：所有动画用 transform 1:1 复刻 PixiEntities 时序
   - 战斗/数值/UI 零改动；每能力带 localStorage 开关 + try/catch 回退
   - file:// 下不加载（XHR/纹理被拦），ready 恒 false，实体留 Pixi/2D
   ============================================================ */
(function () {
  'use strict';
  if (typeof THREE === 'undefined') { console.warn('[ThreeEntities] three.js 未加载，实体层不启动'); return; }
  const T = THREE;
  const PX_PER_METER = 40;          // Unity S=0.025 的倒数：1 米 = 40 世界像素
  const DEATH_TIME = 0.42;          // 与 Pixi 死亡时序一致
  const HIT_TIME = 0.14;
  const MAX_CREATURES = 80;         // 同屏生物池上限

  /* 业务怪物类型 → GLB 模型 id（规则同 LowPolyArt，未命中的精英留 Pixi） */
  const MONSTER_MODEL = {
    wolf: 'mob_wolf', swift_wolf: 'mob_wolf',
    bat: 'mob_bat', gargoyle: 'mob_bat',
    spider: 'mob_spider', brood_queen: 'mob_spider',
    boar: 'mob_boar', armored_boar: 'mob_boar', herbivore: 'mob_boar',
    locust: 'mob_locust',
    boss: 'mob_boss',
  };
  /* 障碍类型 → GLB 模型 id（旧名 crystal 走紫色虚空水晶） */
  const OB_MODEL = {
    tree: 'obs_tree', deadTree: 'obs_deadTree', rock: 'obs_rock', bush: 'obs_bush',
    ruin: 'obs_ruin', hay: 'obs_hay', fence: 'obs_fence', monolith: 'obs_monolith',
    toxicCrystal: 'obs_toxicCrystal', crystal: 'obs_voidCrystal', voidCrystal: 'obs_voidCrystal',
  };
  const FLYERS = { mob_bat: 1, mob_locust: 1 };   // 飞行/悬浮单位

  const ThreeEntities = {
    ready: false,           // 模型与材质全部就绪
    enabled: null,          // null=未判定；true 接管；false 永久回退
    failed: false,
    _scene: null,
    _root: null,            // 实体总 Group，挂到 Terrain3D.scene
    _loader: null,
    _templates: {},         // modelId → 模板 Object3D（共享 geometry/material）
    _matLib: {},            // 材质基名 → MeshStandardMaterial（全局共享）
    _texLoading: {},        // 纹理加载 Promise
    _creaturePool: [],      // 空闲生物实体
    _creatureActive: new Map(),
    _obstaclePool: [],
    _obstacleActive: new Map(),
    _takenOver: new Set(),  // 供 Pixi 查询的接管 key
    _cacheRef: null,
    _time: 0,
    _k: 1.0,                // 网页尺寸修正系数（标定后微调）
    _shadowTex: null,

    /* ------------------------- 开关 / 协议 ------------------------- */
    _setting() {
      try { return localStorage.getItem('farm3DEntities') || 'auto'; } catch (e) { return 'auto'; }
    },

    /* ------------------------- 启动 ------------------------- */
    init() {
      if (this._initStarted || this.failed) return;
      if (!window.Terrain3D) return;            // 地形层不存在则无从挂载
      if (this._setting() === 'off') { this.enabled = false; return; }
      if (location.protocol === 'file:') { this.enabled = false; return; }
      if (!window.EXP_MODELS) { console.warn('[ThreeEntities] 缺少 EXP_MODELS 清单，回退'); this._fail(); return; }
      if (!T.GLTFLoader) { console.warn('[ThreeEntities] 缺少 r128 GLTFLoader，回退'); this._fail(); return; }
      this._initStarted = true;
      try {
        this._boot().catch((err) => { console.warn('[ThreeEntities] 启动失败，实体回退 Pixi/2D：', err); this._fail(); });
      } catch (e) { this._fail(); }
    },

    _fail() {
      this.failed = true; this.enabled = false; this.ready = false;
      this._takenOver.clear();
      const cv = window.Terrain3D && Terrain3D.canvas;
      if (cv) cv.dataset.entities3d = 'failed';
    },

    async _boot() {
      // 等 Terrain3D renderer/scene 就绪（renderer 在首次 render 时创建）
      let wait = 0;
      while (!Terrain3D.scene || !Terrain3D.renderer) {
        await new Promise(r => setTimeout(r, 60)); wait += 60;
        if (wait > 20000) throw new Error('等待 Terrain3D 场景超时');
      }
      this._scene = Terrain3D.scene;
      this._loader = new T.GLTFLoader();
      this._root = new T.Group();
      this._root.name = 'ThreeEntitiesRoot';
      this._scene.add(this._root);
      if (Terrain3D.canvas) Terrain3D.canvas.dataset.entities3d = 'loading';

      const ids = Object.keys(EXP_MODELS.models);
      const base = this._assetBase();
      // 先加载全部 GLB 几何（材质随后异步替换），关键模型任一失败即整体回退
      await Promise.all(ids.map(id => this._loadModel(id, base)));
      this.ready = true;
      this.enabled = true;
      if (Terrain3D.canvas) Terrain3D.canvas.dataset.entities3d = 'ready';
      // 若本局已建程序化道具，立即移交 GLB 障碍
      if (Terrain3D.suspendProps) { try { Terrain3D.suspendProps(); } catch (e) {} }
      console.info('[ThreeEntities] 3D 实体层就绪：' + ids.length + ' 个模型，共享材质 ' + Object.keys(this._matLib).length + ' 组');
      Terrain3D.canvas.addEventListener('webglcontextlost', this._onContextLost, false);
    },

    _assetBase() {
      // manifest.js 与 GLB 同目录站点相对路径；取当前页面解析后的绝对基址
      const src = document.querySelector('script[src*="exp-models/manifest.js"]');
      let href = src ? src.src : (location.origin + location.pathname.replace(/[^/]*$/, '') + 'assets/exp-models/manifest.js');
      return href.replace(/manifest\.js(\?.*)?$/, '');
    },

    _onContextLost() {
      console.warn('[ThreeEntities] WebGL 上下文丢失，实体回退');
      if (window.GraphicsQuality) { try { window.GraphicsQuality.markFail('contextlost', new Error('webglcontextlost')); } catch (e) {} }
      this._fail();
      if (window.PixiEntities) { try { PixiEntities.enabled = true; } catch (e) {} }
    },

    /* ------------------------- 共享 PBR 材质库 ------------------------- */
    _loadTexture(url, srgb) {
      if (this._texLoading[url]) return this._texLoading[url];
      const p = new Promise((resolve, reject) => {
        new T.TextureLoader().load(url,
          (tex) => {
            tex.flipY = false;                       // glTF UV 约定
            tex.wrapS = tex.wrapT = T.RepeatWrapping;
            tex.encoding = srgb ? T.sRGBEncoding : T.LinearEncoding;
            tex.anisotropy = 4;
            resolve(tex);
          },
          undefined,
          () => reject(new Error('纹理加载失败 ' + url)));
      });
      this._texLoading[url] = p;
      return p;
    },

    _resolveLib(id, slotName) {
      const rw = window.EXP_REWORK;
      if (rw && rw.slotMap && rw.slotMap[id]) {
        const lib = rw.slotMap[id][slotName];
        if (lib) return { lib, rw: true, key: 'rw:' + lib };
      }
      return { lib: slotName, rw: false, key: 'old:' + slotName };
    },

    async _getMaterial(id, slotName, base) {
      const info = this._resolveLib(id, slotName);
      if (this._matLib[info.key]) return this._matLib[info.key];
      let mat;
      if (info.rw) {
        mat = await this._buildReworkMaterial(info.lib, base);
      } else {
        const proc = EXP_MODELS.proceduralSlots[slotName];
        if (proc) {
          mat = new T.MeshStandardMaterial({
            color: 0xffffff, roughness: proc.roughness == null ? 0.85 : proc.roughness, metalness: 0.0,
          });
          if (proc.type === 'emissive') {
            const em = slotName.indexOf('green') >= 0 ? 0x9dffb0 : 0xb69cff;
            mat.color.setHex(slotName.indexOf('green') >= 0 ? 0x2e6b46 : 0x3a2f63);
            mat.emissive = new T.Color(em);
            mat.emissiveIntensity = proc.emissiveStrength || 1.2;
            mat.roughness = proc.roughness == null ? 0.25 : proc.roughness;
          }
        } else {
          const dir = base + 'textures/' + slotName + '/';
          const [map, normalMap, orm] = await Promise.all([
            this._loadTexture(dir + 'albedo.jpg', true),
            this._loadTexture(dir + 'normal.png', false),
            this._loadTexture(dir + 'orm.png', false),
          ]);
          mat = new T.MeshStandardMaterial({
            map, normalMap,
            roughnessMap: orm, metalnessMap: orm, aoMap: orm,
            roughness: 1.0, metalness: 1.0,
            normalScale: new T.Vector2(1, 1),
            envMapIntensity: 0.6,
          });
          mat.aoMapIntensity = 1.0;
        }
      }
      mat.name = 'pbr_' + info.lib;
      this._matLib[info.key] = mat;
      return mat;
    },

    async _buildReworkMaterial(lib, base) {
      const rw = window.EXP_REWORK;
      // 与 GLB/旧纹理一致，基于 _assetBase() 推导，保证任意页面深度（含子目录测试页）可加载
      const dir = base + 'rework-tex/' + lib + '/';
      const em = rw.emissive && rw.emissive[lib];
      const [map, normalMap, orm] = await Promise.all([
        this._loadTexture(dir + 'albedo.jpg', true),
        this._loadTexture(dir + 'normal.png', false),
        this._loadTexture(dir + 'orm.png', false),
      ]);
      const mat = new T.MeshStandardMaterial({
        map, normalMap,
        roughnessMap: orm, metalnessMap: orm, aoMap: orm,
        roughness: 1.0, metalness: 1.0,
        normalScale: new T.Vector2(1, 1),
        envMapIntensity: em ? 0.9 : 0.7,
      });
      mat.aoMapIntensity = 1.0;
      if (em) {
        // 能量晶体/符文：基色压暗，自发光走 Bloom；低粗糙带通透感
        mat.color.setHex(em.baseColor || 0x202020);
        mat.emissive = new T.Color(em.color);
        mat.emissiveIntensity = em.strength || 2.0;
        mat.emissiveMap = map;
        mat.roughness = em.roughness == null ? 0.2 : em.roughness;
        mat.metalness = 0.0;
      }
      return mat;
    },

    async _loadModel(id, base) {
      const meta = EXP_MODELS.models[id];
      const gltf = await new Promise((resolve, reject) => {
        this._loader.load(base + meta.file, resolve, undefined, reject);
      });
      const scene = gltf.scene || gltf.scenes[0];
      // 按 GLB 材质名替换为共享 PBR 材质；并补 uv2 给 aoMap
      const slotSet = meta.materialSlots || [];
      const matByIndex = {};
      await Promise.all(slotSet.map(async (slot) => { matByIndex[slot] = await this._getMaterial(id, slot, base); }));
      scene.traverse((obj) => {
        if (!obj.isMesh) return;
        obj.castShadow = true;
        obj.receiveShadow = true;
        const geo = obj.geometry;
        if (geo && geo.attributes.uv && !geo.attributes.uv2) geo.setAttribute('uv2', geo.attributes.uv);
        const src = obj.material;
        const pick = (m) => {
          if (!m) return m;
          // 以材质名直查（P2 教训：不能用排序后的槽索引）
          const key = (m.name || '').replace(/^pbr_/, '');
          return matByIndex[key] || matByIndex[slotSet[0]] || m;
        };
        if (Array.isArray(src)) obj.material = src.map(pick);
        else obj.material = pick(src);
      });
      this._templates[id] = scene;
    },

    /* ------------------------- 软阴影纹理（共享） ------------------------- */
    _getShadowTexture() {
      if (this._shadowTex) return this._shadowTex;
      const cv = document.createElement('canvas'); cv.width = cv.height = 128;
      const c = cv.getContext('2d');
      const g = c.createRadialGradient(64, 64, 4, 64, 64, 62);
      g.addColorStop(0, 'rgba(0,0,0,.5)');
      g.addColorStop(.6, 'rgba(0,0,0,.24)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(0, 0, 128, 128);
      const tex = new T.CanvasTexture(cv);
      this._shadowTex = tex;
      return tex;
    },

    /* ------------------------- 生命周期 ------------------------- */
    onExpClear() {
      // Terrain3D 切局/清理时回收全部实体（模板与材质保留）
      this._releaseAll();
      this._cacheRef = null;
    },

    _releaseAll() {
      this._creatureActive.forEach(e => this._poolCreature(e));
      this._obstacleActive.forEach(e => this._poolObstacle(e));
      this._creatureActive.clear();
      this._obstacleActive.clear();
      this._takenOver.clear();
    },

    isTakenOver(key) { return this.ready && this.enabled && this._takenOver.has(key); },

    /* 供 Pixi 混合层查询：该生物是否由 3D 实体层画身体（血条仍归 Pixi） */
    takesCreature(kind, obj) {
      if (!this.ready || !this.enabled || !obj) return false;
      const id = this._modelIdFor(kind, obj);
      return !!(id && this._templates[id]);
    },
    /* 供 Pixi/2D 查询：该障碍是否由 GLB 实体层承担 */
    takesObstacle(obj) {
      if (!this.ready || !this.enabled || !obj) return false;
      const id = OB_MODEL[obj.type];
      return !!(id && this._templates[id]);
    },

    /* ======================= 每帧主入口（Terrain3D.render 内调用） ======================= */
    sync(exp) {
      if (!this.ready || !this.enabled || !exp) return;
      try {
        if (exp.terrainChunkCache !== this._cacheRef) {
          this._releaseAll();
          this._cacheRef = exp.terrainChunkCache;
        }
        this._time += 1 / 60;
        this._syncCreatures(exp);
        this._syncObstacles(exp);
      } catch (e) {
        console.warn('[ThreeEntities] 同步异常，本帧交还 Pixi：', e);
        this._fail();
      }
    },

    /* ------------------------- 生物同步 ------------------------- */
    _syncCreatures(exp) {
      const seen = new Set();
      const consider = (kind, obj, keyId) => {
        if (!obj) return;
        const modelId = this._modelIdFor(kind, obj);
        if (!modelId || !this._templates[modelId]) return;   // 无 GLB → 留 Pixi
        const key = 'creature:' + (keyId != null ? keyId : this._pid(obj));
        seen.add(key);
        let e = this._creatureActive.get(key);
        if (!e) {
          e = this._acquireCreature(modelId);
          if (!e) return;
          e.key = key; e.kind = kind; e.modelId = modelId;
          this._creatureActive.set(key, e);
        }
        this._takenOver.add(key);
        this._updateCreature(e, obj, kind, modelId, exp);
      };
      consider('player', exp.player, 'player');
      (exp.monsters || []).forEach(m => consider('monster', m));
      (exp.raiders || []).forEach(r => consider('raider', r));
      (exp.allies || []).forEach(a => consider('ally', a));
      for (const [key, e] of this._creatureActive) {
        if (!seen.has(key)) { this._poolCreature(e); this._creatureActive.delete(key); this._takenOver.delete(key); }
      }
    },

    _modelIdFor(kind, obj) {
      if (kind === 'player') return 'char_farmer';
      if (kind === 'monster' || kind === 'raider') return MONSTER_MODEL[obj.type] || null;
      return null;                                // 盟友/掠夺者无对应 GLB，留 Pixi
    },

    _pid(obj) { if (!obj.__pid3d) obj.__pid3d = ++ThreeEntities._pidSeq; return obj.__pid3d; },

    /* ------------------------- 生物实体构建/池化 ------------------------- */
    _acquireCreature(modelId) {
      const poolCap = window.GraphicsQuality ? Math.min(MAX_CREATURES, window.GraphicsQuality.config().pool) : MAX_CREATURES;
      if (this._creatureActive.size >= poolCap) return null;
      let e = this._creaturePool.pop();
      if (!e) e = this._buildEntity();
      this._setTemplate(e, modelId);
      e.root.visible = true;
      return e;
    },

    _buildEntity() {
      const root = new T.Group();          // 接地位置 + 朝向
      const model = new T.Group();         // 缩放 + 程序化动画
      root.add(model);
      const shadow = new T.Mesh(
        new T.CircleGeometry(0.5, 28).rotateX(-Math.PI / 2),
        new T.MeshBasicMaterial({ map: this._getShadowTexture(), transparent: true, depthWrite: false, opacity: 0.4 })
      );
      shadow.renderOrder = -1;
      root.add(shadow);
      // 玩家金环（默认隐藏，玩家实体启用）
      const ring = new T.Mesh(
        new T.RingGeometry(0.42, 0.5, 40).rotateX(-Math.PI / 2),
        new T.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.0, side: T.DoubleSide, depthWrite: false })
      );
      ring.position.y = 0.4;
      root.add(ring);
      this._root.add(root);
      return { root, model, shadow, ring, modelId: null, flashMats: null, weapon: null, baseMatOpacity: null };
    },

    _setTemplate(e, modelId) {
      // 清掉旧模板克隆
      while (e.model.children.length) e.model.remove(e.model.children[0]);
      const tpl = this._templates[modelId];
      const clone = tpl.clone(true);       // 共享 geometry 与共享材质
      clone.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      e.model.add(clone);
      e.modelId = modelId;
      e.flashMats = null;
      e.weapon = null;
    },

    _poolCreature(e) {
      e.root.visible = false;
      this._restoreMaterials(e);
      if (e.root.parent) e.root.parent.remove(e.root);
      this._creaturePool.push(e);
    },

    /* 受击白闪需要 per-entity 材质（其余实体共享）。惰性克隆，回池还原共享材质。 */
    _ensureFlashMaterials(e) {
      if (e.flashMats) return;
      const pairs = [];
      e.model.traverse((o) => {
        if (!o.isMesh) return;
        const src = o.material;
        const arr = Array.isArray(src) ? src : [src];
        const cloned = arr.map((m) => {
          const c = m.clone();               // 克隆材质但共享纹理
          c.emissive = new T.Color(0x000000);
          c.emissiveIntensity = 0;
          c.userData.baseEmissive = m.emissive ? m.emissive.getHex() : 0x000000;
          c.userData.baseEmissiveIntensity = m.emissiveIntensity || 0;
          return c;
        });
        pairs.push({ mesh: o, original: src, cloned: Array.isArray(src) ? cloned : cloned[0] });
      });
      e.flashMats = pairs;
    },
    _applyFlash(e, strength) {
      this._ensureFlashMaterials(e);
      e.flashMats.forEach((p) => {
        if (p.mesh.material !== p.cloned) p.mesh.material = p.cloned;
        const arr = Array.isArray(p.cloned) ? p.cloned : [p.cloned];
        arr.forEach((m) => {
          const base = m.userData.baseEmissive || 0;
          m.emissive.setHex(base);
          // 白色脉冲叠到自发光上
          if (strength > 0.001) { m.emissive.lerp(new T.Color(0xffffff), Math.min(1, strength)); m.emissiveIntensity = (m.userData.baseEmissiveIntensity || 0) + strength * 1.5; }
          else { m.emissiveIntensity = m.userData.baseEmissiveIntensity || 0; }
        });
      });
    },
    _restoreMaterials(e) {
      if (!e.flashMats) return;
      e.flashMats.forEach((p) => { p.mesh.material = p.original; p.cloned && (Array.isArray(p.cloned) ? p.cloned : [p.cloned]).forEach(c => c.dispose && c.dispose()); });
      e.flashMats = null;
    },

    /* ------------------------- 单生物每帧变换 ------------------------- */
    _updateCreature(e, o, kind, modelId, exp) {
      const meta = EXP_MODELS.models[modelId];
      const depth = exp.getDepthScale ? exp.getDepthScale(o.y) : 1;
      const elite = o.elite ? 1.15 : 1;
      const radiusFactor = (kind === 'monster' && o.type !== 'boss') ? (o.radius / 18) : 1;
      const pxH = meta.heightM * PX_PER_METER * this._k * depth * elite * radiusFactor;
      e.basePxH = pxH;     // 动画前基准像素高（呼吸/死亡会动态改 model.scale）

      const lift = o.visualZ || 0;
      const kx = o.knockX || 0, ky = o.knockY || 0;
      const elev = exp.getElevationPx ? exp.getElevationPx(o.x, o.y) : 0;

      // 根：世界位置（x→three x，y→three z），海拔沿 y
      e.root.position.set(o.x + kx, elev, o.y + ky * 0.45);
      // 朝向：屏幕 facing=atan2(dy,dx)（x 右 y 下）。标定实测本批 OBJ 模型正面在本地 +Z
      // （非 glTF 常规 -Z），把本地 +Z 对准期望方向 (cos f, sin f) → rotation.y = π/2 - f。
      let facing = o.facing;
      if (kind === 'player') facing = (o.facing !== undefined ? o.facing : (o.angle || 0));
      if (facing === undefined || facing === null || !Number.isFinite(facing)) facing = 0;
      e.root.rotation.y = Math.PI / 2 - facing;

      // model：单位 GLB 缩放到像素高
      e.model.scale.set(pxH, pxH, pxH);
      e.model.position.set(0, lift, 0);
      e.model.rotation.set(0, 0, 0);

      // 软阴影：CircleGeometry 半径 0.5 挂在无缩放 root 上，scale 直接把半径换算到目标世界像素。
      // 目标椭圆宽 shR*2.2、深 shR*1.1（对齐 Pixi），故半宽/0.5=shR*2.2，半深/0.5=shR*1.1。
      const shR = (kind === 'player' ? 40 : (o.type === 'boss' ? 70 : 30)) * depth * elite;
      e.shadow.scale.set(shR * 2.2, 1, shR * 1.1);
      e.shadow.position.set(0, 0.6, 0);
      e.shadow.material.opacity = Math.max(0.08, 0.4 - lift * 0.004);
      e.shadow.visible = lift < 90;

      // 战争迷雾：与 Unity 一致按 isWorldVisible 切 visible
      const vis = exp.isWorldVisible ? exp.isWorldVisible(o.x, o.y) : true;
      e.root.visible = vis;

      // 玩家金环
      e.ring.visible = kind === 'player';
      if (kind === 'player') {
        // RingGeometry 外半径 0.5 挂无缩放 root；目标外环世界半径 ≈0.55×像素身高（玩家脚边金环）
        const ringR = 1.1 * pxH * depth;
        e.ring.scale.set(ringR, ringR, ringR);
        e.ring.position.y = 0.4;
        e.ring.material.opacity = 0.85;
      }

      this._animate(e, o, kind, modelId, exp, pxH);
      this._syncWeapon(e, o, kind, exp, pxH);
    },

    /* ------------------------- 程序化动画（复刻 Pixi 时序） ------------------------- */
    _animate(e, o, kind, modelId, exp, pxH) {
      const at = o.animTime || (exp.elapsed || 0);
      const m = e.model;
      let moving = false;
      if (kind === 'player') moving = (o.moveSpeed || 0) > 10;
      else moving = o.state === 'move' || o.state === 'chase' || o.state === 'patrol';

      // 透明度基线（隐身/无敌/死亡）
      let alpha = (kind === 'player' && o.stealth > 0) ? 0.4 : 1;
      if (kind === 'player' && o.invuln > 0 && Math.floor(o.invuln * 10) % 2 === 0) alpha *= 0.5;

      // 飞行单位悬浮
      const flyer = FLYERS[modelId] ? 1 : 0;

      if (o.state === 'death' || (kind === 'monster' && o.deathTimer > 0 && o.state === 'death')) {
        const dt = o.deathTimer || 0;
        const prog = Math.min(1, Math.max(0, 1 - dt / DEATH_TIME));
        alpha *= Math.max(0, dt / DEATH_TIME);
        if (prog < 0.12) {
          const k = prog / 0.12;
          m.scale.y = pxH * (1 + 0.12 * k);
          m.scale.x = pxH * (1 - 0.06 * k);
          m.scale.z = pxH * (1 - 0.06 * k);
        } else {
          const k = (prog - 0.12) / 0.88;
          m.rotation.z = k * 0.9;                       // 倾倒（绕模型侧轴）
          m.scale.y = pxH * (1.12 - 0.42 * k);
          m.scale.x = pxH * (0.94 + 0.08 * k);
          m.scale.z = pxH * (0.94 + 0.08 * k);
          m.position.y = (o.visualZ || 0) + k * 10;    // 下沉
        }
      } else if (o.hitFlash > 0 && kind !== 'player') {
        const hk = Math.min(1, o.hitFlash / HIT_TIME);
        this._applyFlash(e, hk);
        m.position.x = -4 * hk;
        m.position.y = (o.visualZ || 0) + Math.sin(at * 40) * 1.5 * hk;
      } else {
        if (kind !== 'player') this._applyFlash(e, 0);
        if (o.attackAnim > 0 || o.state === 'attack') {
          const ak = Math.sin(Math.min(1, (o.attackAnim || 0.15) / 0.3) * Math.PI);
          m.position.z = 6 * ak;                       // 前冲（朝向为 -Z/局部门内平移）
          m.scale.y = pxH * (1 - 0.04 * ak);
          m.rotation.y = 0.06 * ak;
        } else if (o.state === 'windup') {
          m.scale.set(pxH * 0.94, pxH * 1.06, pxH * 0.94);
          m.position.x = Math.sin(at * 30) * 1.2;
        } else if (moving) {
          const step = kind === 'player' ? (o.walkDistance || 0) / 25 * Math.PI * 2 : at * 10;
          const bob = kind === 'player' ? -Math.abs(Math.sin(step)) * 2.6 : Math.sin(step) * 2;
          m.position.y = (o.visualZ || 0) + bob + (flyer ? Math.sin(at * 2.2) * 3.5 + 6 : 0);
          m.rotation.z = Math.sin(step) * 0.03;
          if (kind !== 'player') {
            const s = Math.sin(step);
            m.scale.set(pxH * (1 + s * 0.02), pxH * (1 - s * 0.01), pxH * (1 + s * 0.02));
          }
        } else {
          const breathe = Math.sin(at * 2.5);
          m.position.y = (o.visualZ || 0) + breathe * 1.2 + (flyer ? Math.sin(at * 2.2) * 3.5 + 6 : 0);
          m.scale.set(pxH, pxH * (1 + breathe * 0.01), pxH);
        }
      }
      this._setEntityAlpha(e, alpha);
    },

    _setEntityAlpha(e, alpha) {
      // 死亡/隐身透明：动态切换 transparent。遍历当前生效材质（含白闪克隆）
      e.model.traverse((o) => {
        if (!o.isMesh) return;
        const arr = Array.isArray(o.material) ? o.material : [o.material];
        arr.forEach((m) => {
          if (!m) return;
          if (alpha < 0.999) { m.transparent = true; m.opacity = alpha; }
          else { m.opacity = 1; }
        });
      });
    },

    /* ------------------------- 武器手持挂载 ------------------------- */
    _syncWeapon(e, o, kind, exp, pxH) {
      // 仅玩家持 GLB 武器；throwing_knife/flame_bow 无模型，留 Pixi/2D
      if (kind !== 'player' || !exp.weapon) { if (e.weapon) e.weapon.visible = false; return; }
      const wid = exp.weapon.id;
      const resName = (EXP_MODELS.weaponRes && EXP_MODELS.weaponRes[wid]) || ('weapon_' + wid);
      const tpl = this._templates[resName];
      if (!tpl) { if (e.weapon) e.weapon.visible = false; return; }
      if (!e.weapon || e.weapon._wpnId !== resName) {
        if (e.weapon) e.model.remove(e.weapon);
        const hold = new T.Group();
        const body = tpl.clone(true);
        hold.add(body);
        e.model.add(hold);
        e.weapon = hold; e.weapon._wpnId = resName; e.weapon._body = body; e.weapon._resName = resName;
        this._poseWeapon(hold, body, resName, exp, pxH);
      }
      e.weapon.visible = true;
      this._poseWeapon(e.weapon, e.weapon._body, resName, exp, pxH);
    },

    _poseWeapon(hold, body, resName, exp, pxH) {
      // 单位归一化空间（GLB 单位高度），数值取自 Unity EquipWeapon；挥砍叠加攻击动画
      const meta = EXP_MODELS.models[resName];
      const wh = meta.heightM;
      const grip = resName === 'weapon_sickle' ? [0.23, 0.15, 0]
        : resName === 'weapon_pea_repeater' ? [0, 0.13, 0] : [0, 0.15, 0];
      // wrapper 在 Hand 挂点附近（Hand 归一化 (0.165,.35,.02)）
      hold.position.set(0.165, 0.35, 0.02);
      let tx = 20, ty = 0, tz = 0, px = 0.02, py = 0, pz = 0.04;
      if (resName === 'weapon_sickle') { tx = -14; ty = -52; tz = 0; px = 0.04; pz = 0.02; }
      else if (resName === 'weapon_pea_repeater') { tx = 90; ty = 0; tz = 0; px = 0.02; pz = 0.18; }
      const swing = exp.attackAnim > 0 ? Math.sin((1 - exp.attackAnim / 0.24) * Math.PI) * 0.3 : 0;
      hold.rotation.set((tx) * Math.PI / 180, ty * Math.PI / 180, (tz + swing * 180 / Math.PI) * Math.PI / 180);
      hold.position.x = 0.165 + px; hold.position.y = 0.35 + py; hold.position.z = 0.02 + pz;
      // wrapper 倒数缩放抵消 model 的 pxH 放大，使 hold 内部回到「1 单位=1 屏幕像素」空间；
      // 武器目标像素高 = 米高 × 40，body 与 grip 偏移都按该像素高布置。
      const inv = 1 / (pxH || 1);
      hold.scale.set(inv, inv, inv);
      const wpnPxH = wh * PX_PER_METER;
      body.position.set(-grip[0] * wpnPxH, -grip[1] * wpnPxH, -grip[2] * wpnPxH);
      body.rotation.set(0, 0, 0);
      body.scale.set(wpnPxH, wpnPxH, wpnPxH);   // 归一化 GLB（高 1）→ 真实像素高
    },

    /* ------------------------- 障碍同步（池化单体） ------------------------- */
    _syncObstacles(exp) {
      const list = exp.obstaclesByY || exp.obstacles || [];
      const seen = new Set();
      list.forEach((o) => {
        if (!o || o.fxOnly || !Number.isFinite(o.x)) return;
        const modelId = OB_MODEL[o.type];
        if (!modelId || !this._templates[modelId]) return;
        const key = 'obstacle:' + this._pid(o);
        seen.add(key);
        let e = this._obstacleActive.get(key);
        if (!e) {
          e = this._obstaclePool.pop() || this._buildObstacleEntity();
          this._setObstacleTemplate(e, modelId);
          e.key = key;
          this._obstacleActive.set(key, e);
        }
        this._takenOver.add(key);
        this._updateObstacle(e, o, modelId, exp);
      });
      for (const [key, e] of this._obstacleActive) {
        if (!seen.has(key)) { this._poolObstacle(e); this._obstacleActive.delete(key); this._takenOver.delete(key); }
      }
    },

    _buildObstacleEntity() {
      const root = new T.Group();
      const model = new T.Group();
      root.add(model);
      this._root.add(root);
      return { root, model, modelId: null };
    },
    _setObstacleTemplate(e, modelId) {
      while (e.model.children.length) e.model.remove(e.model.children[0]);
      const clone = this._templates[modelId].clone(true);
      clone.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      e.model.add(clone);
      e.modelId = modelId;
    },
    _poolObstacle(e) {
      e.root.visible = false;
      if (e.root.parent) e.root.parent.remove(e.root);
      this._obstaclePool.push(e);
    },
    _updateObstacle(e, o, modelId, exp) {
      const meta = EXP_MODELS.models[modelId];
      const depth = exp.getDepthScale ? exp.getDepthScale(o.y) : 1;
      // 艺术抖动规则与 2D 一致（tree/bush/rock/deadTree）
      const artJit = ['tree', 'bush', 'rock', 'deadTree'].includes(o.type)
        ? 0.88 + ((Math.abs((o.x * 1103515245 + o.y * 12345) | 0) >>> 6) % 100) / 100 * 0.27 : 1;
      const s = (o.scale || 1) * artJit;
      const pxH = meta.heightM * PX_PER_METER * this._k * depth * s;
      const elev = exp.getElevationPx ? exp.getElevationPx(o.x, o.y) : 0;
      e.root.position.set(o.x, elev, o.y);
      e.root.rotation.y = -(o.rotation || 0);
      e.model.scale.set(pxH, pxH, pxH);
      e.model.position.set(0, 0, 0);
      const vis = exp.isWorldVisible ? exp.isWorldVisible(o.x, o.y) : true;
      e.root.visible = vis;
    },
  };

  ThreeEntities._pidSeq = 0;
  window.ThreeEntities = ThreeEntities;
  if (window.GraphicsQuality) {
    window.GraphicsQuality.registerEntityCount(function () {
      return (ThreeEntities._creatureActive ? ThreeEntities._creatureActive.size : 0) +
        (ThreeEntities._obstacleActive ? ThreeEntities._obstacleActive.size : 0);
    });
  }
})();
