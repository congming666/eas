/* ================= 玩家骨骼动画（真实立绘切件，两段腿） =================
 * 立绘切成「身体 + 大腿/小腿 ×2」，腿绕髋旋转、小腿再绕膝弯曲，
 * 比整块腿更接近真实步态，同时保留原始画风。
 */
const PlayerSkel = {
  ready: false,
  parts: {},
  meta: {
    down:  { hipY: 160, crotchX: 126, knee0: [119, 206], knee1: [138, 206] },
    right: { hipY: 159, crotchX: 126, knee0: [97, 206],  knee1: [150, 206], n0: -0.229, n1: 0.236 },
    up:    { hipY: 160, crotchX: 124, knee0: [118, 206], knee1: [136, 206] },
    left:  { hipY: 159, crotchX: 127, knee0: [102, 206], knee1: [161, 206], n0: -0.237, n1: 0.279 },
  },
  STRIDE: 170,   // 一步一周期≈0.77s（220px/s），接近真人步行节奏（原100太快，像小碎步）
  SWING: 0.34,
  KNEE: 0.55,
  HIP_GAP: 12,

  init() {
    if (this.ready || this._loading) return;
    this._loading = true;
    const dirs = ['down', 'right', 'up', 'left'];
    const kinds = ['body', 'leg0_up', 'leg0_lo', 'leg1_up', 'leg1_lo'];
    let left = dirs.length * kinds.length;
    const done = () => { if (--left === 0) this.ready = true; };
    for (const d of dirs) {
      this.parts[d] = {};
      for (const k of kinds) {
        const im = new Image();
        im.onload = done;
        im.onerror = done;
        im.src = 'assets/player/parts/' + d + '_' + k + '.png';
        this.parts[d][k] = im;
      }
    }
  },

  dirOf(a) {
    const horizontal = Math.abs(Math.cos(a)) >= Math.abs(Math.sin(a));
    return horizontal ? (Math.cos(a) >= 0 ? 'right' : 'left') : (Math.sin(a) < 0 ? 'up' : 'down');
  },

  angleOf(dir) {
    return { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[dir] || Math.PI / 2;
  },

  pose(player, dirOverride) {
    this.init();
    const a = player.facing !== undefined ? player.facing : Math.PI / 2;
    const dir = dirOverride || this.dirOf(a);
    const p = this.parts[dir];
    if (!this.ready || !p || !p.body.naturalWidth) return null;
    const moving = (player.moveSpeed || 0) > 10;
    const phase = ((player.walkDistance || 0) / this.STRIDE) % 1;
    // 步态幅度随实际速度平滑起落：起步/停步时腿不会从中间姿势硬切到并拢
    const motion = Math.min(1, Math.max(0, (player.moveSpeed || 0) / 90));
    const s = Math.sin(phase * Math.PI * 2) * motion;
    // 朝向决定步态：侧身走路腿前后摆；正/背面走路腿主要上下抬，
    // 横向摆幅必须收窄，否则会像钟摆一样左右扫。
    const lat = Math.abs(Math.cos(a));
    const vertical = lat < 0.5;
    // 正/背面（上下移动）改用美术绘制的四帧走路表（PlayerArt）：
    // 骨骼切件在正面视角下两腿会互相穿模成"交叉步"，而走图表是画师按前后视角画的，直接播放最稳。
    if (vertical) return null;
    const bob = -Math.abs(s) * (vertical ? 3.5 : 3);
    // ===== 正/背面（上下移动）专用步态 =====
    // 正面/背面视角下：髋关节不旋转（旋转=两腿左右剪刀扫，正是"上下很怪"的原因），
    // 改为两条腿交替「整腿上提 + 小腿微屈」，身体轻微上下起伏与左右换重心。
    if (vertical) {
      // 相位塑形：脚落地后先「踩住」一小段（触地/下压），再快速抬摆，
      // 避免正弦曲线那种「刚碰到地就弹起来」的漂浮感（经典 walk cycle 的 contact/down/up/passing 四段）。
      const mag = Math.abs(s);
      const HOLD = 0.18;                       // 触地保持区
      const swingEase = mag <= HOLD ? 0 : (mag - HOLD) / (1 - HOLD);
      const lift = swingEase * swingEase * (3 - 2 * swingEase);   // smoothstep，抬起更柔
      const up0 = s < 0 ? lift : 0;
      const up1 = s > 0 ? lift : 0;
      // 抬腿时向「外侧」偏移并外摆小腿：正面视角下两张腿图会重叠，
      // 同向内摆会让抬起的脚横跨到另一条腿上，看起来就是交叉步。
      const lifted = up0 > 0 ? 0 : (up1 > 0 ? 1 : 0);
      return {
        dir, parts: p, meta: this.meta[dir], phase, bob, moving, vertical: true,
        swing0: 0,
        swing1: 0,
        bend0: -up0 * 0.08,     // 左腿小腿向外（-x）摆
        bend1: up1 * 0.08,      // 右腿小腿向外（+x）摆
        order: lifted === 0 ? 0 : 1,   // 抬起的腿先画（在支撑腿后面），避免抬起的鞋横跨到另一条腿上
        sway: s * 2.2,          // 重心左右换脚
        bodyShiftX: -s * 2.4,   // 上半身随支撑腿微移（比旋转更稳，不会把脚带偏）
        liftY0: up0 * 10,       // 抬脚高度（整腿沿 -y 上提，被支撑腿挡住）
        liftY1: up1 * 10,
        liftX0: -up0 * 3,       // 抬起时向外错开，避免与支撑腿重叠成 X
        liftX1: up1 * 3,
        sink0: up1 * 1.8,       // 支撑腿轻微下沉，卖出重量
        sink1: up0 * 1.8,
        squash0: 1 - up0 * 0.06,   // 抬腿时轻微缩短，配合遮挡更像提膝
        squash1: 1 - up1 * 0.06,
      };
    }
    const swingAmp = 0.10 + 0.26 * lat;
    const kneeAmp = 0.22 + 0.42 * (1 - lat);
    // 迈步抬脚：正/背面靠屈膝把脚抬起来，侧身靠前后摆
    const lift = (1 - lat);
    // 腿 0 = 图左半（侧身时是后腿），腿 1 = 图右半（前腿）。
    // 旋转正方向让脚往后摆，所以「向前迈」对应 s<0（腿0）/ s>0（腿1）；
    // 屈膝和抬脚必须跟着「前摆的那条腿」，之前写反了，导致迈步像顺拐。
    const fwd0 = Math.max(0, -s);   // 腿0 前摆量
    const fwd1 = Math.max(0, s);    // 腿1 前摆量
    return {
      dir, parts: p, meta: this.meta[dir], phase, bob, moving,
      // 叠加「把立绘里已经画好的步幅拉回垂直」的中性偏移，腿才会真正前后交替
      swing0: (this.meta[dir].n0 || 0) + s * swingAmp,
      swing1: (this.meta[dir].n1 || 0) - s * swingAmp,
      bend0: fwd0 * kneeAmp + Math.max(0, s) * kneeAmp * 0.12,
      bend1: fwd1 * kneeAmp + Math.max(0, -s) * kneeAmp * 0.12,
      order: s >= 0 ? 0 : 1,   // 先画哪条腿：后摆的那条在下面
      sway: s * 1.2 * lift,   // 正/背面轻微左右换重心
      lift0: fwd0 * 2.6 * lift,   // 抬脚高度（正/背面靠整体上提）
      lift1: fwd1 * 2.6 * lift,
    };
  },

  /* 单腿：大腿绕髋、小腿绕膝 */
  _leg(ctx, up, lo, hx, hy, kx, ky, hipAng, bend, dy, dx, squash) {
    ctx.save();
    // 正/背面步态：整条腿沿 -y 上提（顶端藏进身体里），模拟抬脚落步
    if (dx) ctx.translate(dx, 0);
    if (dy) ctx.translate(0, dy);
    ctx.translate(hx, hy);
    if (squash && squash !== 1) ctx.scale(1, squash);
    ctx.rotate(hipAng);
    ctx.drawImage(up, -hx, -hy);
    ctx.translate(kx - hx, ky - hy);
    ctx.rotate(bend);
    ctx.drawImage(lo, -kx, -ky);
    ctx.restore();
  },

  drawCanvas(ctx, pose, x, y, scale) {
    const m = pose.meta;
    ctx.save();
    ctx.translate(x + (pose.sway || 0), y);
    ctx.scale(scale, scale);
    ctx.translate(-128, -250);
    const hx0 = m.crotchX - this.HIP_GAP, hx1 = m.crotchX + this.HIP_GAP;
    // 迈步交叉时交换绘制顺序：后摆的腿压在下面，前摆的腿盖在上面
    const legs = [
      () => this._leg(ctx, pose.parts.leg0_up, pose.parts.leg0_lo, hx0, m.hipY, m.knee0[0], m.knee0[1], pose.swing0, pose.bend0, (pose.sink0 || 0) - (pose.liftY0 || 0), pose.liftX0 || 0, pose.squash0 || 1),
      () => this._leg(ctx, pose.parts.leg1_up, pose.parts.leg1_lo, hx1, m.hipY, m.knee1[0], m.knee1[1], pose.swing1, pose.bend1, (pose.sink1 || 0) - (pose.liftY1 || 0), pose.liftX1 || 0, pose.squash1 || 1),
    ];
    const first = pose.order || 0;
    legs[first]();
    legs[1 - first]();
    ctx.save();
    ctx.translate(0, pose.bob);
    if (pose.bodyShiftX) ctx.translate(pose.bodyShiftX, 0);
    ctx.drawImage(pose.parts.body, 0, 0);
    ctx.restore();
    ctx.restore();
  },

  /* Pixi：legs[2] = {cont, up, lo}，body 单张 */
  applyPixi(sprites, pose) {
    const m = pose.meta;
    const setTex = (sp, key) => {
      const img = pose.parts[key];
      if (sp.__src !== img) { sp.texture = PIXI.Texture.from(img); sp.__src = img; }
    };
    setTex(sprites.body, 'body');
    sprites.body.rotation = 0;
    sprites.body.position.set(pose.bodyShiftX || 0, pose.bob);
    const hx = [m.crotchX - this.HIP_GAP, m.crotchX + this.HIP_GAP];
    const swing = [pose.swing0, pose.swing1];
    const lift = [(pose.liftY0 || 0) - (pose.sink0 || 0), (pose.liftY1 || 0) - (pose.sink1 || 0)];
    const bend = [pose.bend0, pose.bend1];
    const knee = [m.knee0, m.knee1];
    for (let i = 0; i < 2; i++) {
      const leg = sprites.legs[i];
      setTex(leg.up, 'leg' + i + '_up');
      setTex(leg.lo, 'leg' + i + '_lo');
      leg.cont.visible = true;
      leg.cont.position.set(hx[i] + (pose['liftX' + i] || 0), m.hipY - lift[i]);
      leg.cont.rotation = swing[i];
      leg.cont.scale.set(1, pose['squash' + i] || 1);
      leg.cont.zIndex = (i === (pose.order || 0)) ? 0 : 1;
      leg.up.pivot.set(hx[i], m.hipY);
      leg.up.position.set(0, 0);
      leg.lo.pivot.set(knee[i][0], knee[i][1]);
      leg.lo.position.set(knee[i][0] - hx[i], knee[i][1] - m.hipY);
      leg.lo.rotation = bend[i];
    }
  },
};
if (typeof window !== 'undefined') window.PlayerSkel = PlayerSkel;







