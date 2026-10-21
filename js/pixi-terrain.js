/* ================= Pixi 地形合成层（v1.0 2026-10-16） =================
 * 路线 A 第一步：远征地「地形」由 PixiJS（WebGL）合成，实体/特效/
 * 迷雾仍走 2D gameCanvas（透明叠加）。架构：
 *   DOM 层序：nebulaCanvas < pixiTerrainCanvas < gameCanvas < HUD
 *   - chunk 烘焙画布 → PIXI.Texture（复用 TerrainChunkCache，零重烘焙，
 *     Pixi 未就绪时自动走 2D 路径，就绪后无缝接管）
 *   - 水域：平铺水面纹理 + DisplacementFilter 位移着色器（折射扭动）
 *     + 与 2D pathFor 同公式的波形边界 mask + 岸沫环
 * 失败安全：init 抛错（无 WebGL 等）→ ready 永远 false → 永走 2D 路径。
 * ===================================================================== */
const PixiTerrain = {
  app: null,
  ready: false,
  enabled: true,          // 手动开关（调试/降级用）：PixiTerrain.enabled=false 强制回 2D
  root: null,
  _chunks: new Map(),     // "cx,cy" → Sprite
  _cacheRef: null,        // terrainChunkCache 身份标记（新远征自动重建）
  _waterKey: null,
  _waterRoot: null, _waterTiling: null, _dispSprite: null, _dispFilter: null, _dispBaseX: 0,
  _initPromise: null,

  async init() {
    if (!window.PIXI || this.app) return;
    if (typeof CONFIG === 'undefined') return;
    const host = document.getElementById('gameContainer');
    const gc = document.getElementById('gameCanvas');
    if (!host || !gc) return;
    this.app = new PIXI.Application();
    await this.app.init({
      width: CONFIG.canvas.width, height: CONFIG.canvas.height,
      backgroundAlpha: 0, antialias: false, resolution: 1,
    });
    const cv = this.app.canvas;
    cv.id = 'pixiTerrainCanvas';
    cv.setAttribute('aria-hidden', 'true');
    // 与 gameCanvas 同层同位（DOM 顺序在其前 → 画在其下）；同步它的 CSS 滤镜避免两层饱和度不一致
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:0;filter:saturate(1.06) contrast(1.04);';
    host.insertBefore(cv, gc);
    this.root = new PIXI.Container();
    this.app.stage.addChild(this.root);
    this.app.ticker.add(() => this._tick());
    this.ready = true;
  },

  _lazyInit() {
    if (!this._initPromise) {
      this._initPromise = this.init().catch(err => {
        console.warn('[PixiTerrain] WebGL 初始化失败，保持 2D 渲染：', err);
        this._initPromise = null;
      });
    }
  },

  // 主入口：由 renderGroundLayer 每帧调用；返回 true = Pixi 已接管地形
  render(exp, cam) {
    if (!this.ready) { this._lazyInit(); return false; }
    if (!this.enabled || !exp || !exp.terrainChunkCache) return false;
    try {
      // 新远征检测（每局 terrainChunkCache 为新实例）→ 全量重建
      if (exp.terrainChunkCache !== this._cacheRef) {
        this._reset();
        this._cacheRef = exp.terrainChunkCache;
      }
      this._syncChunks(exp, cam);
      this._syncWater(exp);
      // v1.8 视角拉远：root 整体缩放（chunk 精灵/水面均为世界坐标子节点，一处缩放全局生效）。
      // 与 2D 层 ctx.scale(zoom) 严格同式：屏幕 = (世界 - cam) * zoom —— 双层零漂移。
      const rz = cam.zoom || 1;
      this.root.scale.set(rz);
      this.root.position.set(-Math.round(cam.x * rz), -Math.round(cam.y * rz));
      this.root.visible = true;
      return true;
    } catch (err) {
      console.warn('[PixiTerrain] 渲染异常，本帧回退 2D：', err);
      return false;
    }
  },

  _syncChunks(exp, cam) {
    const cs = exp.terrainChunkCache.chunkSize;
    const mapSize = CONFIG.expedition.mapSize;
    // v1.8 视角拉远：可见世界宽高 = 画布 / zoom
    const vz = cam.zoom || 1;
    const W = CONFIG.canvas.width / vz, H = CONFIG.canvas.height / vz;
    const minX = Math.max(0, Math.floor(cam.x / cs));
    const maxX = Math.min(Math.ceil(mapSize / cs) - 1, Math.floor((cam.x + W) / cs));
    const minY = Math.max(0, Math.floor(cam.y / cs));
    const maxY = Math.min(Math.ceil(mapSize / cs) - 1, Math.floor((cam.y + H) / cs));
    for (let cy = minY; cy <= maxY; cy++) for (let cx = minX; cx <= maxX; cx++) {
      const key = cx + ',' + cy;
      if (this._chunks.has(key)) continue;
      // 与 2D renderTerrain 完全相同的烘焙回调（chunk 静态：烘焙一次，永久复用）
      const chunkCanvas = exp.terrainChunkCache.get(cx, cy, (cctx, wx, wy) => {
        exp.renderTerrainDirect(cctx, { x: wx, y: wy });
      });
      const sp = new PIXI.Sprite(PIXI.Texture.from(chunkCanvas));
      sp.position.set(cx * cs, cy * cs);
      this.root.addChild(sp);
      this._chunks.set(key, sp);
    }
  },

  _syncWater(exp) {
    const r = (exp.terrainRegions || []).find(x => x.type === 'water');
    const key = r ? (r.x + ':' + r.y + ':' + r.seed) : 'none';
    if (this._waterKey === key) return;
    this._waterKey = key;
    if (this._waterRoot) { this._waterRoot.destroy({ children: true }); this._waterRoot = null; }
    if (!r || typeof ArtTextures === 'undefined') return;

    const pad = 26;
    const w = Math.ceil(r.rx * 2 + pad * 2), h = Math.ceil(r.ry * 2 + pad * 2);
    const root = new PIXI.Container();
    root.position.set(r.x, r.y);

    // 水面平铺纹理（screen 混合：暗底隐去、波光做加法——避免「暗叠暗」）
    const wt = PIXI.Texture.from(ArtTextures.waterTile());
    wt.source.style.addressMode = 'repeat';
    const water = new PIXI.TilingSprite({ texture: wt, width: w, height: h });
    water.position.set(-w / 2, -h / 2);
    water.alpha = 0.5;
    water.blendMode = 'screen';
    root.addChild(water);

    // 位移噪声 sprite（构造时自动 renderable=false，仅供着色器采样）
    const dt = PIXI.Texture.from(ArtTextures.dispMap());
    dt.source.style.addressMode = 'repeat';
    const disp = new PIXI.Sprite(dt);
    disp.position.set(-w / 2 - 24, -h / 2 - 24);
    disp.width = w + 48; disp.height = h + 48;
    root.addChild(disp);
    const filter = new PIXI.DisplacementFilter({ sprite: disp, scale: 15 });

    // 波形边界（与 2D pathFor 完全同公式，seed 驱动 → 形状严格重合）
    const TAU = Math.PI * 2;
    const wavePts = [], foamOuter = [], foamInner = [];
    for (let i = 0; i <= 128; i++) {
      const a = i / 128 * TAU;
      const wave = 1 + .055 * Math.sin(a * 3 + r.seed) + .035 * Math.cos(a * 7 - r.seed) + .018 * Math.sin(a * 11 + r.seed * 2);
      wavePts.push(Math.cos(a) * r.rx * wave, Math.sin(a) * r.ry * wave);
      foamOuter.push(Math.cos(a) * r.rx * wave * 1.035, Math.sin(a) * r.ry * wave * 1.035);
      foamInner.push(Math.cos(a) * r.rx * wave * .965, Math.sin(a) * r.ry * wave * .965);
    }
    const mask = new PIXI.Graphics();
    mask.poly(wavePts).fill(0xffffff);
    root.addChild(mask);
    root.mask = mask;

    // 岸沫双环（随波界起伏）
    const foam = new PIXI.Graphics();
    foam.poly(foamOuter).stroke({ width: 3, color: 0x9fc4b2, alpha: .34 });
    foam.poly(foamInner).stroke({ width: 1.5, color: 0x7fa898, alpha: .22 });
    root.addChild(foam);

    root.filters = [filter];
    this.root.addChild(root);
    this._waterRoot = root; this._waterTiling = water;
    this._dispSprite = disp; this._dispFilter = filter;
    this._dispBaseX = disp.position.x;
  },

  // 着色器动画（Pixi ticker 独立驱动，与游戏逻辑解耦）
  _tick() {
    if (!this._waterTiling || !this._dispFilter) return;
    const t = performance.now() / 1000;
    this._waterTiling.tilePosition.x = t * 7;
    this._waterTiling.tilePosition.y = Math.sin(t * .35) * 5;
    this._dispSprite.position.x = this._dispBaseX + (t * 11) % 64;
    this._dispFilter.scale.set(13 + Math.sin(t * 1.2) * 5);
  },

  // v1.4 昼夜 GPU 分级：nightK/duskK ∈ [0,1]，对 root 容器挂 ColorMatrixFilter。
  // 夜=去饱和.52×压暗.76×蓝偏移；暮=微去饱和.88×暖偏移。与 2D 层 CSS filter 同曲线。
  // k 归零时摘除滤镜（零 GPU 开销），有值时仅上传 20 元矩阵。
  // ⚠ Pixi 8.22 语义（源码已核）：行序 [rR,rG,rB,rA,rOff,...]；着色器把偏移列
  //   「原样」加在 0..1 色彩空间（result.r += uColorMatrix[4]，无 /255 缩放）——
  //   偏移必须用 0..1 刻度；RGB 行的 alpha 系数必须为 0（否则 +color.a 直接冲爆通道）。
  setGrade(nightK, duskK) {
    if (!this.ready || !this.enabled || !this.root) return;
    const nk = Math.max(0, Math.min(1, nightK || 0)), dk = Math.max(0, Math.min(1, duskK || 0));
    if (nk < .01 && dk < .01) {
      if (this._graded) { this.root.filters = []; this._graded = false; }
      return;
    }
    // c' = d*((1-s)*luma + s*c) + off（luma = .3r+.59g+.11b），偏移为 0..1 刻度
    const N = [.52, .76, .0078, .0196, .0549];   // 夜：sat, dark, rOff, gOff, bOff
    const D = [.88, .96, .0392, .0078, -.0235];  // 暮：暖偏移
    const mk = (s, d, or, og, ob) => [
      d * ((1 - s) * .3 + s), d * (1 - s) * .59, d * (1 - s) * .11, 0, or,
      d * (1 - s) * .3, d * ((1 - s) * .59 + s), d * (1 - s) * .11, 0, og,
      d * (1 - s) * .3, d * (1 - s) * .59, d * ((1 - s) * .11 + s), 0, ob,
      0, 0, 0, 1, 0,
    ];
    const nM = mk(...N), dM = mk(...D);
    const I = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
    const mat = new Array(20);
    for (let i = 0; i < 20; i++) mat[i] = I[i] + (nM[i] - I[i]) * nk + (dM[i] - I[i]) * dk;
    if (!this._gradeFilter) this._gradeFilter = new PIXI.ColorMatrixFilter();
    // matrix setter 不触发 uniform 上传，走 _loadMatrix（内部 update）保GPU同步
    if (typeof this._gradeFilter._loadMatrix === 'function') this._gradeFilter._loadMatrix(mat);
    else this._gradeFilter.matrix = mat;
    if (!this._graded) { this.root.filters = [this._gradeFilter]; this._graded = true; }
  },

  _reset() {
    for (const sp of this._chunks.values()) sp.destroy({ children: true });
    this._chunks.clear();
    if (this._waterRoot) { this._waterRoot.destroy({ children: true }); this._waterRoot = null; }
    this._waterTiling = null; this._dispSprite = null; this._dispFilter = null;
    this._waterKey = null;
  },

  // 远征结束/离开时清空（由 Game.showResult 调用，避免残影留在别的屏幕后面）
  clear() {
    if (!this.root) return;
    this._reset();
    this._cacheRef = null;
    this.setGrade(0, 0);          // 摘除昼夜分级滤镜（避免下场远征带夜色启动）
    this.root.visible = false;
  },

  resize(w, h) {
    if (this.app?.renderer) this.app.renderer.resize(w, h);
  },

  debugInfo() {
    return {
      ready: this.ready, enabled: this.enabled,
      chunks: this._chunks.size,
      water: !!this._waterRoot,
      webgl: !!(this.app?.renderer?.gl),
    };
  },
};
window.PixiTerrain = PixiTerrain;
