/* One character and one distance-driven walk cycle for Canvas and Pixi.
 * 节奏参考《星露谷物语》农夫行走表：A-B-A-C 三张关键帧循环（接触→过渡→接触→过渡），
 * 这里按移动距离换算，帧距 25px ≈ 一个步长的一半，速度变化时步频同步变化。 */
const PlayerArt = {
  sheet: null,
  portrait: null,
  frames: [],
  FRAME_COUNT: 8,      // 光流插值后的 8 帧步态（原 4 帧 + 4 中间帧）
  FRAME_DIST: 21.25,   // 每前进多少世界像素换一帧（8 帧 = 170px 一个周期，与侧身步幅对齐）
  SEQ: [0, 1, 2, 3, 4, 5, 6, 7],   // 8 帧完整循环：0/2/4/6 是原始关键帧，1/3/5/7 是光流插值的中间帧
  init() {
    if (this.sheet) return;
    this.portrait = new Image();
    this.portrait.src = 'docs/art/v3/player3d_keyed.png';
    this.sheet = new Image();
    this.sheet.onload = () => {
      this.frames = Array.from({ length: 32 }, (_, i) => {
        const c = document.createElement('canvas'); c.width = c.height = 256;
        c.getContext('2d').drawImage(this.sheet, (i % 8) * 256, Math.floor(i / 8) * 256, 256, 256, 0, 0, 256, 256);
        return c;
      });
    };
    this.sheet.src = 'assets/player/farmer-walk-v8.png';
  },
  resolve(player) {
    this.init();
    const a = player.facing !== undefined ? player.facing : Math.PI / 2;
    const horizontal = Math.abs(Math.cos(a)) >= Math.abs(Math.sin(a));
    const row = horizontal ? (Math.cos(a) >= 0 ? 1 : 3) : (Math.sin(a) < 0 ? 2 : 0);
    const moving = (player.moveSpeed || 0) > 10;
    const stepF = (player.walkDistance || 0) / this.FRAME_DIST;
    const seqIdx = Math.floor(stepF) % this.SEQ.length;
    const frac = stepF - Math.floor(stepF);
    const frame = moving ? this.SEQ[seqIdx] : 0;
    const nextFrame = moving ? this.SEQ[(seqIdx + 1) % this.SEQ.length] : 0;
    // 帧尾 28% 做交叉淡入下一帧：4 帧循环在 60fps 下也会显得连续，不再"一顿一顿"
    const rawBlend = moving ? Math.max(0, (frac - 0.78) / 0.22) : 0;
    const blend = rawBlend * rawBlend * (3 - 2 * rawBlend);
    const img = this.frames[row * 8 + frame];
    const nextImg = this.frames[row * 8 + nextFrame];
    // 步伐相位（0..1，接触帧为 0/0.5），供渲染层做上下起伏与轻微侧摆
    const phase = ((player.walkDistance || 0) / (this.FRAME_DIST * this.FRAME_COUNT)) % 1;
    if (img) {
      return { img, nextImg, blend, aspect: 1, baseH: 124, texKey: 'farmer-v5:' + row + ':' + frame,
               nextTexKey: 'farmer-v5:' + row + ':' + nextFrame,
               flip: 1, animated: true, phase, moving };
    }
    if (this.portrait?.naturalWidth) {
      return { img: this.portrait, aspect: this.portrait.naturalWidth / this.portrait.naturalHeight,
               baseH: 126, texKey: 'farmer-v3', flip: Math.cos(a) > 0 ? -1 : 1, phase: 0, moving: false };
    }
    return null;
  },
};
PlayerArt.init();
