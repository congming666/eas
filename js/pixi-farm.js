/* ================= 农场全景 Pixi 合成层（路线 A 第三步 v1.0 2026-10-16） =================
 * 架构同 pixi-terrain.js（静态烘焙上 GPU + 2D 透明叠加），并把全景动画从 10fps 提到 60fps：
 *   DOM 层序：.hs-pano-wrap 内 → #v58PanoramaPixi（下，本层）< #v58Panorama（上，2D 透明叠加）
 *   - 静态场景（天相/废墟/山丘/河流/道路/树木/全建筑/地块土垄/装饰/前景/夜幕光晕）
 *     由 FarmPanorama.bakeStatic() 烘焙到 900×300 画布 → 单 quad 纹理；
 *     stateKey（时段|季节|建筑|地块|装饰）变化才重烘，texture.source.update() 复用零重建
 *   - 动态细节（波光/乌鸦/炊烟/鸡/蜂/风车/作物摇摆/事件/雾）留在 2D 叠加层，60fps 驱动
 *   - GPU 粒子：飘尘×160 / 雨幕×90（暴雨·风暴提速加浓）/ 落雪×90 —— 批渲染
 *   - 夜间光源：LIGHTS → 加色混合辉光精灵（预模糊光晕纹理 + 双频微闪烁 = 回家的感觉）
 * 手动渲染模式（app.ticker 不启动）：farm-ui 主循环在农场可见时逐帧调 frame(now)。
 * 失败安全：init 抛错（无 WebGL 等）→ enabled=false 永远走 FarmPanorama.draw 2D 旧路径。
 * ====================================================================================== */
const FarmPixi = {
  app: null,
  ready: false,
  enabled: true,          // 手动开关（调试/降级用）：FarmPixi.enabled=false 强制回 2D
  worldC: null,
  bakeSprite: null, lightsC: null, dustC: null, rainC: null, snowC: null,
  _bakeTex: null,
  _stateKey: null, _bakeCount: 0, _night: false,
  _dust: [], _rain: [], _snow: [],
  _glowTex: null, _dotTex: null, _streakTex: null,
  _W: 0, _H: 0,
  _initPromise: null,

  lazyInit() {
    if (!this._initPromise) {
      this._initPromise = this.init().catch(err => {
        console.warn('[FarmPixi] WebGL 初始化失败，保持 2D 渲染：', err);
        this.enabled = false;
        this._initPromise = null;
      });
    }
  },

  async init() {
    if (!window.PIXI || this.app) return;
    if (typeof GameState === 'undefined' || !window.FarmPanorama) return;
    const cv = document.getElementById('v58PanoramaPixi') || this._mkCanvas();
    if (!cv) return;
    const host = cv.parentElement;
    const W = host.clientWidth || 900, H = host.clientHeight || 230;
    this.app = new PIXI.Application();
    await this.app.init({
      canvas: cv, width: W, height: H,
      backgroundAlpha: 0, antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      preference: 'webgl', autoDensity: false, autoStart: false,
    });
    cv.setAttribute('aria-hidden', 'true');
    // 2D 叠加画布抬到本层之上（z 序在 CSS 里配套，这里只兜底内联样式）
    cv.style.position = 'absolute'; cv.style.inset = '0';
    cv.style.width = '100%'; cv.style.height = '100%'; cv.style.zIndex = '0';
    cv.style.filter = 'saturate(1.05) contrast(1.03)';   // 与远征 Pixi 层同款轻调色
    const c2d = document.getElementById('v58Panorama');
    if (c2d) { c2d.style.position = 'relative'; c2d.style.zIndex = '1'; }

    // ---- 纹理：光晕（预模糊，免 BlurFilter）/ 白点 / 雨痕 ----
    const mk = (w, h, fn) => { const c = document.createElement('canvas'); c.width = w; c.height = h; fn(c.getContext('2d')); return PIXI.Texture.from(c); };
    this._glowTex = mk(128, 128, g => {
      const r = g.createRadialGradient(64, 64, 2, 64, 64, 62);
      r.addColorStop(0, 'rgba(255,220,150,.95)'); r.addColorStop(.3, 'rgba(255,198,112,.4)');
      r.addColorStop(.65, 'rgba(255,190,100,.12)'); r.addColorStop(1, 'rgba(255,185,95,0)');
      g.fillStyle = r; g.fillRect(0, 0, 128, 128);
    });
    this._dotTex = mk(8, 8, g => { g.fillStyle = '#fff'; g.fillRect(0, 0, 8, 8); });
    this._streakTex = mk(4, 16, g => {
      const gr = g.createLinearGradient(0, 0, 0, 16);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 4, 16);
    });

    // ---- 场景图：世界容器（900×300 设计坐标） bake < 光晕 < 尘 < 雨 < 雪 ----
    this.worldC = new PIXI.Container();
    { const s = Math.max(W / 900, H / 300); this.worldC.scale.set(s, s); this.worldC.position.set((W - 900 * s) / 2, (H - 300 * s) / 2); }
    this.app.stage.addChild(this.worldC);
    this.lightsC = new PIXI.Container(); this.dustC = new PIXI.Container();
    this.rainC = new PIXI.Container(); this.snowC = new PIXI.Container();
    this.worldC.addChild(this.lightsC, this.dustC, this.rainC, this.snowC);

    // ---- GPU 粒子池（位置公式与 2D 原实现逐像素一致） ----
    for (let i = 0; i < 160; i++) { // 飘尘：三色三速漂移
      const s = new PIXI.Sprite(this._dotTex);
      s.tint = [0xc9b98c, 0x3a382e, 0x8f846a][i % 3]; s.alpha = [.13, .12, .15][i % 3];
      s.scale.set((2 + i % 5) / 8, 1 / 8);
      this._dust.push({ s, x0: (i * 137.51) % 920, y: 120 + (i * 37.13) % 160, sp: 6 * (1 + i % 3) });
      this.dustC.addChild(s);
    }
    for (let i = 0; i < 90; i++) { // 雨痕：速度对齐角度，暴雨全量提速
      const s = new PIXI.Sprite(this._streakTex);
      s.anchor.set(.5); s.tint = 0xb8c4c2; s.alpha = .3; s.scale.set(.5, .62);
      this._rain.push({ s, x0: (i * 113) % 900, y0: (i * 57) % 300 });
      this.rainC.addChild(s);
    }
    this.rainC.visible = false;
    for (let i = 0; i < 90; i++) { // 落雪：慢速垂直
      const s = new PIXI.Sprite(this._dotTex);
      s.tint = 0xd8dcd4; s.alpha = .4; s.scale.set(2 / 8, 2 / 8);
      this._snow.push({ s, x0: (i * 97) % 920, y0: (i * 53) % 300 });
      this.snowC.addChild(s);
    }
    this.snowC.visible = false;
    this._W = W; this._H = H;
    this.ready = true;
  },

  // 旧标记兼容：没有双画布包裹时动态建一个
  _mkCanvas() {
    const c2d = document.getElementById('v58Panorama');
    if (!c2d || !c2d.parentElement) return null;
    const wrap = document.createElement('div'); wrap.className = 'hs-pano-wrap';
    c2d.parentElement.insertBefore(wrap, c2d);
    wrap.appendChild(c2d);
    const cv = document.createElement('canvas'); cv.id = 'v58PanoramaPixi';
    wrap.insertBefore(cv, c2d);
    return cv;
  },

  // 主入口：farm-ui 主循环每帧调用（农场可见时）；返回 true = 已接管
  frame(now) {
    if (!this.ready) { this.lazyInit(); return false; }
    if (!this.enabled) return false;
    if (this._taintFailed) return false;   // v5.8.12：纹理曾因 canvas 污染上传失败 → 永久回退 2D 全量路径
    const host = this._host();
    if (!host) return false;
    const W = host.clientWidth, H = host.clientHeight;
    if (!W || !H) return true;
    try {
      if (this._W !== W || this._H !== H) {
        this._W = W; this._H = H;
        this.app.renderer.resize(W, H);
        { const s = Math.max(W / 900, H / 300); this.worldC.scale.set(s, s); this.worldC.position.set((W - 900 * s) / 2, (H - 300 * s) / 2); }
      }
      this._syncBake();
      this._tickParticles(now / 1000);
      this.app.render();
      return true;
    } catch (err) {
      console.warn('[FarmPixi] 渲染异常，本帧回退 2D：', err);
      return false;
    }
  },

  _host() {
    return document.querySelector('#farmHomestead .hs-pano-wrap')
      || (document.getElementById('v58Panorama') || {}).parentElement
      || null;
  },

  _syncBake() {
    // v5.8.12 底图就绪门控：底图未 onload 时**不烘焙**（避免把回退帧锁进纹理缓存——
    // 旧时序：首次烘焙底图未就绪 → onload 后重烘焙遇 file:// canvas 污染 → texSubImage2D
    // SecurityError → stateKey 已更新永不重试 → Pixi 层永久显示"无底图的回退第一帧"）
    if (FarmPanorama.baseReady && !FarmPanorama.baseReady()) return;
    const G = GameState, ph = FarmPanorama.phaseOf();
    const bl = G.buildings || {};
    const lvsl = id => ((bl[id] && bl[id].level) || 0) + ':' + ((bl[id] && bl[id].slot) || '');
    const key = [
      FarmPanorama.baseKey ? FarmPanorama.baseKey() : 'x',   // AI 底图就绪/换图 → 重烘
      ph.night ? 'night' : ph.dusk ? 'dusk' : ph.dawn ? 'dawn' : 'day',
      G.season || 'spring',
      'w' + lvsl('workshop'), 'g' + lvsl('greenhouse'), 'b' + lvsl('barn'), 'l' + lvsl('lab'),
      'L' + (Object.values(bl).some(b => ((b && b.level) || 0) >= 2) ? 1 : 0),
      'p' + (G.unlockedPlots || 16),
      'c' + (G.decorations || []).map(d => d.id + '.' + d.x + '.' + d.y).join('_'),
    ].join('|');
    if (key === this._stateKey) return;
    const r = FarmPanorama.bakeStatic();
    if (!r) return;
    /* v5.8.12 污染前置探测：file:// 下底图污染烘焙画布 → WebGL texSubImage2D 上传时才炸
     * （Pixi 内部吞异常仍返回 true → 黑屏）。这里主动 getImageData 探测，污染则永久回退 2D
     * 全量路径（2D drawImage 不受污染限制，已验证显示完全正常）；https 同源环境零影响 */
    try {
      r.canvas.getContext('2d').getImageData(0, 0, 1, 1);
    } catch (taintErr) {
      console.warn('[FarmPixi] 烘焙画布被本地图片污染（file:// 环境），永久回退 2D 全量路径');
      this._stateKey = null;
      this._taintFailed = true;
      FarmPixi.enabled = false;
      return;
    }
    try {
      if (!this._bakeTex) {
        this._bakeTex = PIXI.Texture.from(r.canvas);       // 烘焙画布身份稳定 → 纹理永续
        this.bakeSprite = new PIXI.Sprite(this._bakeTex);
        this.worldC.addChildAt(this.bakeSprite, 0);
      } else {
        this._bakeTex.source.update();                      // 画布已重绘，通知 GPU 上传
      }
    } catch (err) {
      console.warn('[FarmPixi] 纹理上传失败（canvas 污染），永久回退 2D 路径：', String(err).slice(0, 80));
      this._stateKey = null;
      this._taintFailed = true;
      FarmPixi.enabled = false;
      return;
    }
    this._stateKey = key;   // 纹理更新成功后才提交状态键（失败可重试/回退）
    this._night = r.night;
    this.lightsC.removeChildren().forEach(s => s.destroy());
    r.lights.forEach(([lx, ly, lr], i) => {
      const s = new PIXI.Sprite(this._glowTex);
      s.anchor.set(.5); s.blendMode = 'add';
      s.position.set(lx, ly); s.alpha = 0; s._lr = lr; s._i = i;
      this.lightsC.addChild(s);
    });
    this._bakeCount++;
  },

  _tickParticles(t) {
    const G = GameState;
    const weather = (G.farmWeather && G.farmWeather.state) || G.weather;
    const ev0 = (G.econ && G.econ.eventLog && G.econ.eventLog[0]) || null;
    const storm = !!(ev0 && (Date.now() - ev0.at) / 1000 < 45 && ev0.id === 'storm');
    // 飘尘（恒开）
    for (const d of this._dust) d.s.position.set((d.x0 + t * d.sp) % 920 - 10, d.y);
    // 雨幕（天气或风暴事件；暴雨全量提速加浓）
    const rainOn = storm || weather === 'rain' || weather === 'heavy_rain' || weather === 'storm';
    this.rainC.visible = rainOn;
    if (rainOn) {
      const vx = storm ? 140 : 95, vy = storm ? 220 : 160;
      const heavy = storm || weather === 'heavy_rain' || weather === 'storm';
      const a = storm ? .44 : heavy ? .38 : .3, n = heavy ? 90 : 65;
      const rot = Math.atan2(vy, vx) - Math.PI / 2;
      for (let i = 0; i < this._rain.length; i++) {
        const p = this._rain[i];
        p.s.visible = i < n;
        if (i >= n) continue;
        p.s.alpha = a; p.s.rotation = rot;
        p.s.position.set((p.x0 + t * vx) % 900, (p.y0 + t * vy) % 300);
      }
    }
    // 落雪（冬季）
    const snowOn = G.season === 'winter';
    this.snowC.visible = snowOn;
    if (snowOn) for (const p of this._snow) p.s.position.set((p.x0 + t * 22) % 920 - 10, (p.y0 + t * 40) % 300);
    // 夜间光源辉光：基础光晕已在烘焙层，这里叠加色混合 bloom + 双频微闪烁
    if (this._night) {
      for (const s of this.lightsC.children) {
        s.alpha = .5 + Math.sin(t * 3.1 + s._i * 1.7) * .07;
        s.scale.set((s._lr * 2.6) / 128);
      }
    } else {
      for (const s of this.lightsC.children) s.alpha = 0;
    }
  },

  debugInfo() {
    return {
      ready: this.ready, enabled: this.enabled,
      webgl: !!(this.app && this.app.renderer),
      bakes: this._bakeCount, stateKey: this._stateKey, night: this._night,
      lights: this.lightsC ? this.lightsC.children.length : 0,
      dust: this._dust.length, rain: this.rainC ? this.rainC.visible : false,
      snow: this.snowC ? this.snowC.visible : false,
      size: [this._W, this._H],
    };
  },
};
window.FarmPixi = FarmPixi;
