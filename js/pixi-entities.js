/* ================= Pixi 实体 Sprite 池层（v1.0 2026-10-19） =================
 * 路线 A 第二步：远征「实体/战斗」由 PixiJS（WebGL）Sprite 池统一渲染：
 *   DOM 层序：pixiTerrainCanvas < pixiEntitiesCanvas < gameCanvas
 *   - 生物（玩家/怪物/掠夺者/盟友）：立绘 Sprite（玩家新 3D / Monsters3D /
 *     CropArt / Boss / 代码捕获兜底），受击白闪(ColorMatrixFilter)、朝向
 *     翻转、程序化移动颠簸/攻击前倾/死亡、独立软阴影、血条
 *   - 装饰（植物/障碍/地标/道具/墙）：离屏 canvas 捕获原 render 方法 →
 *     Texture（静态复用，状态变化时重绘），纳入同一 Y-sort
 *   - 弹道：椭圆拖尾 Sprite（共享纹理 + tint），独立顶层
 *   - 统一 Y-sort：entityLayer.sortableChildren（zIndex = 世界 y）
 * 失败安全：init 异常 → ready 永远 false → 实体永走 2D；enabled 手动降级。
 * =========================================================================== */
const PixiEntities = {
  app: null,
  ready: false,
  enabled: true,
  world: null,
  entityLayer: null,
  projectileLayer: null,
  _initPromise: null,
  _cacheRef: null,

  _wrappers: new Map(),         // key → wrapper
  _freeCreature: [],
  _freeDecor: [],
  _freeProjectile: [],
  _tex: {},
  _whiteFilter: null,
  _idSeq: 0,
  player3dImg: null,
  _player3dReady: false,

  /* ------------------------------ 初始化 ------------------------------ */
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
      preserveDrawingBuffer: true,
    });
    const cv = this.app.canvas;
    cv.id = 'pixiEntitiesCanvas';
    cv.setAttribute('aria-hidden', 'true');
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:0;';
    cv.dataset.stage = 'app';
    // 正确层序：地形 < 实体 < gameCanvas。优先插在地形 canvas 之后，
    // 若地形尚未初始化则先插在 gameCanvas 前（render 中 _ensureDomOrder 会校正）。
    const terrainCv = document.getElementById('pixiTerrainCanvas');
    if (terrainCv) terrainCv.after(cv);
    else host.insertBefore(cv, gc);

    this.world = new PIXI.Container();
    this.entityLayer = new PIXI.Container();
    this.entityLayer.sortableChildren = true;
    this.projectileLayer = new PIXI.Container();
    this.world.addChild(this.entityLayer);
    this.world.addChild(this.projectileLayer);
    this.app.stage.addChild(this.world);
    cv.dataset.stage = 'containers';

    this._buildSharedTextures();
    cv.dataset.stage = 'textures';
    this._loadPlayer3d();
    this.ready = true;
    cv.dataset.stage = 'ready';
  },

  _lazyInit() {
    if (!this._initPromise) {
      this._initPromise = this.init().catch(err => {
        console.warn('[PixiEntities] WebGL 初始化失败，实体保持 2D 渲染：', err);
        const cv = this.app?.canvas;
        if (cv) cv.dataset.error = String(err && err.message || err).slice(0, 200);
        this._initPromise = null;
      });
    }
  },

  _loadPlayer3d() {
    const im = new Image();
    im.onload = () => { this._player3dReady = true; this.player3dImg = im; };
    im.onerror = () => { this._player3dReady = false; };
    im.src = 'docs/art/v3/player3d_keyed.png';
  },

  /* -------------------------- 共享纹理/滤镜 --------------------------- */
  _buildSharedTextures() {
    const g = (w, h) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      return { c, ctx: c.getContext('2d') };
    };
    // 软阴影（椭圆径向渐变，脚底中心）
    {
      const { c, ctx } = g(128, 64);
      const gr = ctx.createRadialGradient(64, 32, 4, 64, 32, 60);
      gr.addColorStop(0, 'rgba(0,0,0,.55)');
      gr.addColorStop(.6, 'rgba(0,0,0,.28)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, 128, 64);
      this._tex.shadow = PIXI.Texture.from(c);
    }
    // 弹道椭圆拖尾（亮核 → 透明，沿速度方向拉伸）
    {
      const { c, ctx } = g(128, 48);
      const gr = ctx.createLinearGradient(0, 0, 128, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0)');
      gr.addColorStop(.55, 'rgba(255,255,255,.85)');
      gr.addColorStop(1, 'rgba(255,255,255,1)');
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.ellipse(64, 24, 62, 16, 0, 0, Math.PI * 2);
      ctx.fill();
      this._tex.projectile = PIXI.Texture.from(c);
    }
    // 血条底（深色圆角条）
    {
      const { c, ctx } = g(64, 12);
      ctx.fillStyle = 'rgba(6,9,11,.92)';
      ctx.beginPath(); roundRectPath(ctx, 2, 2, 60, 8, 3); ctx.fill();
      this._tex.barBg = PIXI.Texture.from(c);
    }
    // 血条前景（纯色圆角条，用 tint 上色 + scale.x 表示比例）
    {
      const { c, ctx } = g(64, 12);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); roundRectPath(ctx, 2, 2, 60, 8, 3); ctx.fill();
      this._tex.barFill = PIXI.Texture.from(c);
    }
    // 受击白闪：把所有像素压成纯白、保留 alpha
    if (!this._whiteFilter) {
      const f = new PIXI.ColorMatrixFilter();
      f._loadMatrix([
        0,0,0,0,1,
        0,0,0,0,1,
        0,0,0,0,1,
        0,0,0,1,0,
      ]);
      this._whiteFilter = f;
    }
  },

  /* ------------------------------- 主入口 ------------------------------ */
  render(exp) {
    if (!this.ready) { this._lazyInit(); return false; }
    if (!this.enabled || !exp || !exp._terrainOnPixi || !PlayerArt.resolve(exp.player)) {
      if (this.world) this.world.visible = false;  // 降级：隐藏残留实体，交由 2D 渲染
      return false;
    }
    try {
      if (exp.terrainChunkCache !== this._cacheRef) {
        this._resetAll();
        this._cacheRef = exp.terrainChunkCache;
      }
      this._syncEntities(exp);
      this._syncProjectiles(exp);
      const cam = exp.camera, rz = cam.zoom || 1;
      this.world.scale.set(rz);
      this.world.position.set(-Math.round(cam.x * rz), -Math.round(cam.y * rz));
      this.world.visible = true;
      this._ensureDomOrder();
      this._mirrorDom();
      return true;
    } catch (err) {
      if (this.world) this.world.visible = false;
      console.warn('[PixiEntities] 渲染异常，本帧实体回退 2D：', err);
      return false;
    }
  },

  /* --------------------------- 生物实体同步 ---------------------------- */
  _syncEntities(exp) {
    const seen = new Set();
    const consider = (kind, obj, keyExtra) => {
      if (!obj) return;
      const key = kind + ':' + (keyExtra !== undefined ? keyExtra : this._id(obj));
      seen.add(key);
      let w = this._wrappers.get(key);
      if (!w) { w = this._makeCreature(key, kind, obj, exp); this._wrappers.set(key, w); }
      this._updateCreature(w, obj, kind, exp);
    };

    consider('player', exp.player, 'player');
    exp.monsters.forEach(m => consider('monster', m));
    (exp.raiders || []).forEach(r => consider('raider', r));
    (exp.allies || []).forEach(a => consider('ally', a));

    // 装饰（植物/障碍/地标/道具/墙）：canvas 捕获
    exp.plants.forEach(p => {
      const key = 'plant:' + this._id(p); seen.add(key);
      this._syncDecor(key, exp, 'plant', p);
    });
    (exp.obstaclesByY || []).forEach(o => {
      if (o.fxOnly) return;
      const key = 'obstacle:' + this._id(o); seen.add(key);
      this._syncDecor(key, exp, 'obstacle', o);
    });
    if (exp.fxWalls) exp.fxWalls.forEach(o => {
      const key = 'wallfx:' + this._id(o); seen.add(key);
      this._syncDecor(key, exp, 'wallfx', o);
    });
    if (exp.fxProps) exp.fxProps.forEach(o => {
      const key = 'fxprop:' + this._id(o); seen.add(key);
      this._syncDecor(key, exp, 'fxprop', o);
    });
    if (exp.landmarks) exp.landmarks.forEach(lm => {
      const key = 'landmark:' + this._id(lm); seen.add(key);
      this._syncDecor(key, exp, 'landmark', lm);
    });
    if (exp.props) exp.props.forEach(pr => {
      const key = 'prop:' + this._id(pr); seen.add(key);
      this._syncDecor(key, exp, 'prop', pr);
    });

    // 回收离场 wrapper
    for (const [key, w] of this._wrappers) {
      if (!seen.has(key)) this._release(key, w);
    }
  },

  _id(obj) {
    if (!obj.__pid) obj.__pid = ++this._idSeq;
    return obj.__pid;
  },

  /* ---------------------------- 生物 wrapper --------------------------- */
  _makeCreature(key, kind, obj, exp) {
    let w = this._freeCreature.pop();
    if (!w) {
      const cont = new PIXI.Container();
      const shadow = new PIXI.Sprite(this._tex.shadow);
      shadow.anchor.set(.5);
      const inner = new PIXI.Container();
      const body = new PIXI.Sprite();
      body.anchor.set(.5, 1);
      const body2 = new PIXI.Sprite();      // 帧间交叉淡化用的叠层
      body2.anchor.set(.5, 1);
      body2.alpha = 0;
      const weapon = new PIXI.Sprite();
      weapon.anchor.set(.5);
      const barBg = new PIXI.Sprite(this._tex.barBg);
      barBg.anchor.set(.5, .5);
      const barFill = new PIXI.Sprite(this._tex.barFill);
      barFill.anchor.set(0, .5);
      const glow = new PIXI.Graphics();
      inner.addChild(body);
      inner.addChild(body2);
      inner.addChild(weapon);
      // 玩家骨骼：身体 + 左右腿（大腿/小腿各两段），默认隐藏
      const makeSkelSet = () => {
        const set = { cont: new PIXI.Container(), body: new PIXI.Sprite(), legs: [] };
        set.body.anchor.set(0, 0);
        set.legs = [0, 1].map(() => {
          const legCont = new PIXI.Container();
          const up = new PIXI.Sprite();
          const lo = new PIXI.Sprite();
          up.anchor.set(0, 0); lo.anchor.set(0, 0);
          legCont.addChild(up); legCont.addChild(lo);
          set.cont.addChild(legCont);
          return { cont: legCont, up, lo };
        });
        set.cont.addChild(set.body);
        set.cont.sortableChildren = true;   // 双腿按 zIndex 决定谁在前
        set.cont.visible = false;
        inner.addChild(set.cont);
        return set;
      };
      const ghost = makeSkelSet();     // 转向过渡用：上一层方向的残影
      const skelSet = makeSkelSet();
      cont.addChild(shadow);
      cont.addChild(inner);
      cont.addChild(glow);
      cont.addChild(barBg);
      cont.addChild(barFill);
      this.entityLayer.addChild(cont);
      w = { cont, shadow, inner, body, body2, weapon, glow, barBg, barFill,
            skel: skelSet.cont, skelBody: skelSet.body, skelLegs: skelSet.legs,
            ghost, key, kind, texKey: '', h: 60, flashing: false };
    }
    w.kind = kind;
    w.cont.visible = true;
    w.cont.alpha = 1;
    return w;
  },

  // 解析生物的立绘纹理/源（img + 目标高度）
  _resolveCreatureArt(obj, kind, exp) {
    const depth = exp.getDepthScale ? exp.getDepthScale(obj.y) : 1;
    // 玩家：新 3D 立绘
    if (kind === 'player') {
      return PlayerArt.resolve(obj);
    }
    // 怪物：Boss（CropArt / boss sprite）→ 普通（monsterSprites / CropArt / Monsters3D）
    if (kind === 'monster' || kind === 'raider') {
      if (obj.type === 'boss') {
        if (typeof CropArt !== 'undefined' && obj.bossId && CropArt.ready(obj.bossId)) {
          const im = CropArt.img(obj.bossId);
          return { img: im, aspect: im.naturalWidth / im.naturalHeight, baseH: 200, texKey: 'boss:' + obj.bossId };
        }
        const bs = obj.type === 'boss' && this._bossSprite(exp, obj);
        if (bs) return { img: bs, aspect: bs.naturalWidth / bs.naturalHeight, baseH: 200, texKey: 'bosssprite' };
      }
      // 怪物 sprite 表（treant/gargoyle 等）
      const stateName = obj.state === 'death' ? 'death' : obj.hitFlash > 0 ? 'hit' : obj.state === 'attack' ? 'attack' : 'idle';
      const cs = exp.monsterSprites && exp.monsterSprites[obj.type] && exp.monsterSprites[obj.type][stateName];
      if (cs && cs.complete && cs.naturalWidth) {
        return { img: cs, aspect: 1, baseH: 82, texKey: 'ms:' + obj.type + ':' + stateName };
      }
      // CropArt 精英/写实
      const V5 = {
        withered_treant: 't1_withered', quarry_troll: 't1_quarry',
        brood_queen: 't3_brood_mother', swamp_hag_elite: 't3_swamp_hag',
        moon_priestess_elite: 't4_moon_priestess', arena_elite: 't4_arena_champion',
      };
      const v5Id = V5[obj.type] || obj.type;
      if (typeof CropArt !== 'undefined' && CropArt.ready(v5Id)) {
        const im = CropArt.img(v5Id);
        return { img: im, aspect: im.naturalWidth / im.naturalHeight, baseH: obj.radius > 26 ? 118 : 88, texKey: 'ca:' + v5Id };
      }
      // Monsters3D 基础怪
      if (typeof Monsters3D !== 'undefined') {
        const r = Monsters3D.resolve(obj.type);
        if (r) {
          return { img: r.im, aspect: r.meta.aspect, baseH: r.meta.h, texKey: 'm3d:' + r.id };
        }
      }
      if (kind === 'raider' && typeof ArtTextures !== 'undefined') {
        const im = ArtTextures.raiderArt();
        return { img: im, aspect: 1, baseH: 52, texKey: 'raider' };
      }
    }
    if (kind === 'ally') {
      const im = exp.allyArt || (ArtTextures && ArtTextures.raiderArt());
      if (im) return { img: im, aspect: 1, baseH: 56, texKey: 'ally' };
    }
    if (kind === 'raider' && typeof ArtTextures !== 'undefined') {
      const im = ArtTextures.raiderArt();
      return { img: im, aspect: 1, baseH: 52, texKey: 'raider' };
    }
    return null;
  },

  _bossSprite(exp, obj) {
    if (!exp.map || !exp.bossSprites) return null;
    const sp = exp.bossSprites['t' + exp.map.tier];
    return sp && sp.complete && sp.naturalWidth ? sp : null;
  },

  _updateCreature(w, obj, kind, exp) {
    if (kind === 'player' && typeof PlayerSkel !== 'undefined') {
      const sp = PlayerSkel.pose(obj);
      if (sp) { this._updatePlayerSkel(w, obj, exp, sp); return; }
    }
    if (w.skel) w.skel.visible = false;
    w.body.visible = true;
    const art = this._resolveCreatureArt(obj, kind, exp);
    if (!art) { w.cont.visible = false; return; }
    w.cont.visible = true;
    // 纹理切换
    if (w.texKey !== art.texKey) {
      w.texKey = art.texKey;
      w.body.texture = PIXI.Texture.from(art.img);
    }
    const depth = exp.getDepthScale ? exp.getDepthScale(obj.y) : 1;
    const elite = obj.elite ? 1.15 : 1;
    const radiusScale = (kind === 'monster' && obj.type !== 'boss') ? (obj.radius / 18) : 1;
    let h = art.baseH * depth * elite * (kind === 'monster' ? radiusScale : 1);
    w.h = h;

    // 基础位置（含 visualZ 腾空、击退）
    const lift = obj.visualZ || 0;
    const kx = obj.knockX || 0, ky = obj.knockY || 0;
    w.cont.position.set(obj.x + kx, obj.y + ky * .45 - lift);
    w.cont.zIndex = obj.y;

    // 阴影（独立、不随动作；扁平、随腾空淡出）
    const shR = kind === 'player' ? 40 : (obj.type === 'boss' ? 70 : 30);
    w.shadow.width = shR * 2.2 * elite * depth;
    w.shadow.height = shR * 1.1 * elite * depth;
    w.shadow.position.set(0, 2);
    w.shadow.alpha = Math.max(.08, .4 - lift * .004);

    // 朝向翻转（立绘面朝左：cos(facing)>0 向右 → flip）
    const at = obj.animTime || (exp.elapsed || 0);
    let facing;
    if (kind === 'player') {
      const moveAngle = obj.facing !== undefined ? obj.facing : (obj.angle || 0);
      const horiz = Math.abs(Math.cos(moveAngle)) >= Math.abs(Math.sin(moveAngle));
      facing = horiz ? Math.cos(moveAngle) : 0;
    } else {
      facing = Math.cos(obj.facing || 0);
    }
    const flip = kind === 'player' ? art.flip : (facing > 0 ? -1 : 1);

    // 重置 inner 变换后按状态叠加
    const inner = w.inner;
    inner.scale.set(flip, 1);
    inner.position.set(0, 0);
    inner.rotation = 0;

    let moving = false, alpha = 1;
    if (kind === 'player') moving = (obj.moveSpeed || 0) > 10;
    else moving = obj.state === 'move' || obj.state === 'chase' || obj.state === 'patrol';

    // body 尺寸（锚点脚底）
    const bw = h * art.aspect;
    w.body.width = bw; w.body.height = h;
    w.body.position.set(0, 0);
    if (w.body2) {
      const useBlend = kind === 'player' && art.nextImg && art.blend > 0.001;
      w.body2.visible = !!useBlend;
      if (useBlend) {
        if (w.texKey2 !== art.nextTexKey) {
          w.texKey2 = art.nextTexKey;
          w.body2.texture = PIXI.Texture.from(art.nextImg);
        }
        w.body2.width = bw; w.body2.height = h;
        w.body2.position.set(0, 0);
        w.body2.alpha = art.blend;
      } else {
        w.body2.alpha = 0;
      }
    }

    if (obj.state === 'death' || (kind === 'monster' && obj.deathTimer > 0 && obj.state === 'death')) {
      const prog = Math.min(1, Math.max(0, 1 - (obj.deathTimer || 0) / .42));
      w.cont.alpha = Math.max(0, (obj.deathTimer || 0) / .42);
      if (prog < .12) {
        // 受击瞬间：轻微拉伸（被重击的张力）
        const k = prog / .12;
        inner.scale.y = 1 + .12 * k;
        inner.scale.x = flip * (1 - .06 * k);
      } else {
        // 倒下：向一侧倾倒 + 压扁 + 下沉（Hades 式重击死亡）
        const k = (prog - .12) / .88;
        inner.rotation = k * .9;
        inner.scale.y = 1.12 - .42 * k;
        inner.scale.x = flip * (.94 + .08 * k);
        inner.position.y = k * 10;
      }
    } else if (obj.hitFlash > 0) {
      const hk = Math.min(1, obj.hitFlash / .14);
      inner.position.x = -4 * hk * flip;
      inner.position.y = Math.sin(at * 40) * 1.5 * hk;
      this._applyWhiteFlash(w, true);
    } else if (obj.attackAnim > 0 || obj.state === 'attack') {
      const ak = Math.sin(Math.min(1, (obj.attackAnim || .15) / .3) * Math.PI);
      inner.position.x = 6 * ak * flip;
      inner.scale.y = 1 - .04 * ak;
      inner.rotation = .06 * ak * flip;
      this._applyWhiteFlash(w, false);
    } else if (obj.state === 'windup') {
      inner.scale.set(flip * .94, 1.06);
      inner.position.x = Math.sin(at * 30) * 1.2 * flip;
      this._applyWhiteFlash(w, false);
    } else if (moving) {
      const step = kind === 'player' ? (obj.walkDistance || 0) / 25 * Math.PI * 2 : at * 10;
      inner.position.y = kind === 'player' ? -Math.abs(Math.sin(step)) * 2.6 : Math.sin(step) * 2;
      if (kind !== 'player') inner.scale.set(flip * (1 + Math.sin(step) * .02), 1 - Math.sin(step) * .01);
      this._applyWhiteFlash(w, false);
    } else {
      inner.position.y = Math.sin(at * 2.5) * 1.2;
      inner.scale.set(flip, 1 + Math.sin(at * 2.5) * .01);
      this._applyWhiteFlash(w, false);
    }

    // 玩家武器（Pixi 版 renderHeroWeapon：weaponSheet 按行）
    this._syncPlayerWeapon(w, exp, kind === 'player');

    // 玩家隐身/无敌（invuln：奇偶帧闪烁 + 青色保护光环，复刻 renderHero 420）
    w.glow.clear();
    if (kind === 'player') {
      w.cont.alpha = (obj.stealth > 0 ? .4 : 1);
      if (obj.invuln > 0) {
        if (Math.floor(obj.invuln * 10) % 2 === 0) w.cont.alpha *= .5;
        const a = .5 + Math.sin((exp.elapsed || 0) * 10) * .2;
        w.glow.circle(0, -h * .45, 34 * depth).stroke({ color: 0x7de7ff, width: 3, alpha: a });
      }
    }

    // 血条
    const hpPct = Math.max(0, Math.min(1, obj.hp / obj.maxHp));
    const barW = (kind === 'monster' && obj.elite) || (kind === 'player') ? 52 : (obj.type === 'boss' ? 110 : 44);
    const barY = -h - 8;
    w.barBg.width = barW; w.barBg.height = 11;
    w.barBg.position.set(0, barY);
    w.barFill.width = barW; w.barFill.height = 7;
    w.barFill.position.set(-barW / 2 + 2, barY);
    w.barFill.scale.x = hpPct;
    w.barFill.tint = hpPct > .35 ? (obj.type === 'boss' ? 0xff9a52 : 0x6fdd6a) : 0xe8483f;
    const showBar = (kind === 'player') || hpPct < 1 || obj.type === 'boss';
    w.barBg.visible = showBar; w.barFill.visible = showBar;
    if (!obj.hp && kind !== 'player') { w.barBg.visible = false; w.barFill.visible = false; }
  },

  _applyWhiteFlash(w, on) {
    if (on && !w.flashing) { w.body.filters = [this._whiteFilter]; w.flashing = true; }
    else if (!on && w.flashing) { w.body.filters = null; w.flashing = false; }
  },

  /* ---------------- 玩家骨骼（Pixi 后端） ---------------- */
  _updatePlayerSkel(w, obj, exp, pose) {
    w.body.visible = false;
    w.skel.visible = true;

    const depth = exp.getDepthScale ? exp.getDepthScale(obj.y) : 1;
    const lift = obj.visualZ || 0;
    const kx = obj.knockX || 0, ky = obj.knockY || 0;
    w.cont.position.set(obj.x + kx, obj.y + ky * .45 - lift);
    w.cont.zIndex = obj.y;

    // 影子随步伐呼吸：支撑瞬间最大、抬脚时收小
    const shPulse = 0.88 + 0.12 * Math.abs(Math.sin(Math.PI * 2 * (pose.phase || 0)));
    const shR = 40;
    w.shadow.width = shR * 2.2 * depth * shPulse;
    w.shadow.height = shR * 1.1 * depth * shPulse;
    w.shadow.position.set(0, 2);
    w.shadow.alpha = Math.max(.08, .4 * shPulse - lift * .004);

    const scale = (124 / 256) * depth;
    w.skel.scale.set(scale);
    w.skel.position.set(-128 * scale + (pose.sway || 0) * scale, -250 * scale);
    PlayerSkel.applyPixi({ body: w.skelBody, legs: w.skelLegs }, pose);

    // 转向过渡：上一层方向的残影 0.07s 交叉淡出
    const turnT = obj._skelTurnT || 0;
    if (turnT > 0 && obj._skelFromDir && w.ghost) {
      const gp = PlayerSkel.pose(obj, obj._skelFromDir);
      if (gp) {
        w.ghost.cont.visible = true;
        w.ghost.cont.alpha = Math.min(1, turnT / 0.07);
        w.ghost.cont.scale.set(scale);
        w.ghost.cont.position.copyFrom(w.skel.position);
        PlayerSkel.applyPixi({ body: w.ghost.body, legs: w.ghost.legs }, gp);
      }
    } else if (w.ghost) {
      w.ghost.cont.visible = false;
    }

    // 受击不再整身闪白（玩家反馈去掉），只保留后仰姿态
    if (w.skel.filters) { w.skel.filters = null; w.flashing = false; }

    w.cont.alpha = (obj.stealth > 0 ? .4 : 1);
    w.glow.clear();
    if (obj.invuln > 0) {
      if (Math.floor(obj.invuln * 10) % 2 === 0) w.cont.alpha *= .5;
      const a = .5 + Math.sin((exp.elapsed || 0) * 10) * .2;
      w.glow.circle(0, -50 * depth, 34 * depth).stroke({ color: 0x7de7ff, width: 3, alpha: a });
    }

    this._syncPlayerWeapon(w, exp, true);

    const hpPct = Math.max(0, Math.min(1, obj.hp / obj.maxHp));
    const barW = 58, barY = -105 * depth - 10;
    w.barBg.width = barW; w.barBg.height = 11;
    w.barBg.position.set(0, barY);
    w.barFill.width = barW; w.barFill.height = 7;
    w.barFill.position.set(-barW / 2 + 2, barY);
    w.barFill.scale.x = hpPct;
    w.barFill.tint = hpPct > .35 ? 0x6fdd6a : 0xe8483f;
    w.barBg.visible = true; w.barFill.visible = true;
  },

  // 玩家手持武器（Pixi 版 renderHeroWeapon：weaponSheet 按行）
  _syncPlayerWeapon(w, exp, isPlayer) {
    if (!isPlayer || !exp.weapon || !exp.weaponSheet || !exp.weaponSheet.naturalWidth) {
      w.weapon.visible = false;
      return;
    }
    const rowMap = { harvest_sickle: 0, pea_repeater: 1, vine_staff: 2, throwing_knife: 3, flame_bow: 4 };
    const row = rowMap[exp.weapon.id] || 0;
    const sw = exp.weaponSheet.naturalWidth, sh = exp.weaponSheet.naturalHeight / 5;
    let proc = exp._weaponCache && exp._weaponCache[exp.weapon.id];
    if (!proc) {
      proc = document.createElement('canvas');
      proc.width = sw; proc.height = sh;
      const pctx = proc.getContext('2d');
      pctx.drawImage(exp.weaponSheet, 0, row * sh, sw, sh, 0, 0, sw, sh);
      if (!exp.weaponSheetPrekeyed) {
        try {
          const data = pctx.getImageData(0, 0, sw, sh), px = data.data;
          for (let i = 0; i < px.length; i += 4) {
            const lum = .299 * px[i] + .587 * px[i + 1] + .114 * px[i + 2];
            if (lum > 200) px[i + 3] = 0;
            else if (lum > 170) px[i + 3] = Math.min(px[i + 3], (200 - lum) / 30 * 255);
          }
          pctx.putImageData(data, 0, 0);
        } catch (e) {}
      }
      if (!exp._weaponCache) exp._weaponCache = {};
      exp._weaponCache[exp.weapon.id] = proc;
    }
    if (w.weapon.texture?.__weaponId !== exp.weapon.id) {
      w.weapon.texture = PIXI.Texture.from(proc);
      w.weapon.texture.__weaponId = exp.weapon.id;
    }
    const dw = 85, dh = dw * sh / sw;
    w.weapon.width = dw; w.weapon.height = dh;
    const swing = exp.attackAnim > 0 ? Math.sin((1 - exp.attackAnim / .24) * Math.PI) : 0;
    const ang = exp.player.angle || 0;
    w.weapon.position.set(22, -64 - (exp.weaponRecoil || 0) * 3);
    w.weapon.rotation = ang + swing * .3 * (exp.attackCombo === 1 ? -1 : 1);
    w.weapon.visible = true;
  },

  /* --------------------------- 装饰 canvas 捕获 ------------------------- */
  _syncDecor(key, exp, kind, obj) {
    let w = this._wrappers.get(key);
    if (!w) {
      let cv = document.createElement('canvas');
      const sp = new PIXI.Sprite();
      sp.anchor.set(.5);
      this.entityLayer.addChild(sp);
      w = { sp, cv, kind, key, signature: '', size: 0 };
      this._wrappers.set(key, w);
    }
    // 尺寸
    const size = this._decorSize(kind, obj, exp);
    const signature = this._decorSignature(kind, obj);
    if (w.size !== size) { w.size = size; w.cv.width = size; w.cv.height = size; w.signature = ''; }
    if (w.signature !== signature) {
      w.signature = signature;
      this._captureDecor(w, exp, kind, obj);
    }
    w.sp.position.set(obj.x, obj.y);
    w.sp.zIndex = obj.y;
    w.sp.visible = true;
  },

  _decorSize(kind, obj, exp) {
    if (kind === 'obstacle') {
      const t = obj.type;
      if (t === 'tree' || t === 'monolith') return 220;
      if (t === 'fence' || t === 'ruin' || t === 'deadTree') return 200;
      return 180;
    }
    if (kind === 'landmark') return Math.ceil(obj.size) + 80;
    if (kind === 'prop') return Math.ceil(obj.size) + 60;
    if (kind === 'plant') return 120;
    return 200; // wallfx / fxprop
  },

  _decorSignature(kind, obj) {
    if (kind === 'plant') return [obj.stage, obj.type, Math.round(obj.hp / obj.maxHp * 4), obj.attackAnim > 0 ? 1 : 0].join('|');
    if (kind === 'prop') return [obj.kind, obj.used || obj.looted || obj.hp <= 0 ? 0 : 1].join('|');
    if (kind === 'landmark') return [obj.type, obj.used ? 1 : 0].join('|');
    if (kind === 'obstacle') return obj.type + '|' + (obj.scale || 1);
    return kind + '|' + (obj.stage || 0);
  },

  _captureDecor(w, exp, kind, obj) {
    const cctx = w.cv.getContext('2d');
    cctx.clearRect(0, 0, w.cv.width, w.cv.height);
    const half = w.cv.width / 2;
    const fakeCam = { x: obj.x - half, y: obj.y - half, zoom: 1 };
    const realCam = exp.camera;
    exp.camera = fakeCam;
    try {
      if (kind === 'obstacle') exp.renderObstacle(cctx, obj, fakeCam);
      else if (kind === 'plant') exp.renderPlants(cctx, fakeCam, [obj]);
      else if (kind === 'wallfx' && typeof WorldFX !== 'undefined') WorldFX.renderWall(cctx, exp, obj);
      else if (kind === 'fxprop' && typeof WorldFX !== 'undefined') WorldFX.renderSetProp(cctx, exp, obj);
      else if (kind === 'landmark') this._captureLandmark(cctx, exp, obj, half);
      else if (kind === 'prop') this._captureProp(cctx, exp, obj, half);
    } finally {
      exp.camera = realCam;
    }
    if (w.sp.texture) w.sp.texture.destroy(true);
    w.sp.texture = PIXI.Texture.from(w.cv);
  },

  _captureLandmark(cctx, exp, lm, half) {
    const img = exp.landmarkImgs && exp.landmarkImgs[lm.type];
    const s = lm.size;
    if (img && img.complete && img.naturalWidth) {
      exp.drawNoBlack(cctx, img, half - s / 2, half - s, s, s);
    } else {
      cctx.fillStyle = '#4a3a2a';
      cctx.beginPath(); cctx.arc(half, half, 30, 0, Math.PI * 2); cctx.fill();
    }
  },

  _captureProp(cctx, exp, pr, half) {
    const imgs = exp.propImgs || {};
    const s = pr.size;
    const pick = (k) => {
      const img = imgs[k];
      if (img && img.complete && img.naturalWidth) {
        exp.drawNoBlack(cctx, img, half - s / 2, half - s / 2, s, (k === 'grass' || k === 'cart') ? s * .7 : s);
        return true;
      }
      return false;
    };
    if (pr.kind === 'grass' && !pr.used) { if (!pick('grass')) { cctx.fillStyle = '#4a7a3a'; cctx.beginPath(); cctx.arc(half, half, s / 2, 0, Math.PI * 2); cctx.fill(); } }
    else if (pr.kind === 'skeleton' && !pr.looted) { if (!pick('skeleton')) { cctx.font = '24px sans-serif'; cctx.textAlign = 'center'; cctx.fillText('💀', half, half + 8); } }
    else if (pr.kind === 'cart' && !pr.looted) { if (!pick('cart')) { cctx.font = '24px sans-serif'; cctx.textAlign = 'center'; cctx.fillText('🛒', half, half + 8); } }
    else if (pr.kind === 'barrel' && pr.hp > 0) { if (!pick('barrel')) { cctx.font = '24px sans-serif'; cctx.textAlign = 'center'; cctx.fillText('🛢️', half, half + 8); } }
    else if (pr.kind === 'crate' && pr.hp > 0) { if (!pick('crate')) { cctx.font = '24px sans-serif'; cctx.textAlign = 'center'; cctx.fillText('📦', half, half + 8); } }
  },

  /* ----------------------------- 弹道同步 ------------------------------ */
  _syncProjectiles(exp) {
    const seen = new Set();
    exp.projectiles.forEach(p => {
      if (p.fromMonster && !exp.isWorldVisible(p.x, p.y)) return;
      const key = this._id(p);
      seen.add(key);
      let w = this._wrappers.get('proj:' + key);
      if (!w) {
        let free = this._freeProjectile.pop();
        if (!free) {
          const sp = new PIXI.Sprite(this._tex.projectile);
          sp.anchor.set(.5);
          this.projectileLayer.addChild(sp);
          free = { sp, key };
        }
        w = free; w.sp.visible = true;
        this._wrappers.set('proj:' + key, w);
      }
      const sp = w.sp;
      sp.position.set(p.x, p.y);
      const ang = Math.atan2(p.vy, p.vx);
      sp.rotation = ang;
      const color = p.fromMonster ? (p.color || '#ff6644') : (p.weaponId === 'pea_repeater' ? '#9fff8a' : p.weaponId === 'vine_staff' ? '#7be5c4' : '#7fff7f');
      sp.tint = Number('0x' + color.replace('#', '').slice(0, 6));
      const speed = Math.hypot(p.vx, p.vy);
      const stretch = .5 + Math.min(1.6, speed / 500);
      sp.scale.set(stretch, .9);
      sp.alpha = .95;
    });
    for (const [key, w] of this._wrappers) {
      if (key.indexOf('proj:') === 0 && !seen.has(Number(key.slice(5)))) this._release(key, w);
    }
  },

  /* ------------------------------- 回收 -------------------------------- */
  _release(key, w) {
    this._wrappers.delete(key);
    if (key.indexOf('proj:') === 0) {
      w.sp.visible = false;
      this._freeProjectile.push(w);
    } else if (w.sp) {
      w.sp.visible = false;
      this._freeDecor.push(w);
    } else {
      w.cont.visible = false;
      w.cont.alpha = 1;
      if (w.flashing) { w.body.filters = null; w.flashing = false; }
      this._freeCreature.push(w);
    }
  },

  _resetAll() {
    for (const [key, w] of Array.from(this._wrappers)) this._release(key, w);
  },

  clear() {
    this._resetAll();
    this._cacheRef = null;
    if (this.world) this.world.visible = false;
  },

  resize(w, h) {
    if (this.app?.renderer) this.app.renderer.resize(w, h);
  },

  debugInfo() {
    return {
      ready: this.ready, enabled: this.enabled,
      wrappers: this._wrappers.size,
      player3d: this._player3dReady,
      webgl: !!(this.app?.renderer?.gl),
    };
  },

  // 校正 DOM 层序：地形 < 实体 < gameCanvas（init 顺序不保证，每帧 no-op 校正）
  _ensureDomOrder() {
    const cv = this.app?.canvas;
    if (!cv) return;
    const terrain = document.getElementById('pixiTerrainCanvas');
    if (terrain) {
      if (terrain.nextElementSibling !== cv) terrain.after(cv);
    } else {
      const gc = document.getElementById('gameCanvas');
      if (gc && gc.previousElementSibling !== cv) gc.before(cv);
    }
  },

  // 把运行时状态镜像到 canvas DOM（隔离世界 / 外部探测可读）
  _mirrorDom() {
    const cv = this.app?.canvas;
    if (!cv) return;
    let creatures = 0, decor = 0, proj = 0, flashing = 0;
    for (const k of this._wrappers.keys()) {
      const w = this._wrappers.get(k);
      if (k.indexOf('proj:') === 0) proj++;
      else if (w.sp) decor++;
      else { creatures++; if (w.flashing) flashing++; }
    }
    cv.dataset.ready = '1';
    cv.dataset.creatures = creatures;
    cv.dataset.decor = decor;
    cv.dataset.flashing = flashing;
    cv.dataset.projectiles = proj;
    cv.dataset.player3d = this._player3dReady ? '1' : '0';
  },
};
window.PixiEntities = PixiEntities;

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
}








