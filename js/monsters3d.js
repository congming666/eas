/* ================= 怪物 3D 立绘注册表（v1.12 远征视觉重塑） =================
 * assets/monsters3d/keyed/mob-<id>.png（AI 生成 → HSV 品红家族抠像 → 内容紧裁剪）
 * renderMonster 代码剪影 fallback 之前接入；死亡/受击/攻击等状态变换由外层统一处理。
 * 立绘默认面朝左；facing 向右（cos>0）时由调用方翻转。
 * ================================================================================ */
const Monsters3D = (() => {
  'use strict';

  // 抠像管线输出的内容纵横比（w/h）——等高绘制时按此算宽
  const META = {
    boar:         { aspect: 1.1294, h: 66 },  // 目标绘制高 px（radius 18 基准）
    wolf:         { aspect: 1.2879, h: 60 },
    bat:          { aspect: 1.0426, h: 62 },  // 悬浮怪
    spider:       { aspect: 1.3290, h: 60 },
    locust:       { aspect: 0.9480, h: 54 },
    herbivore:    { aspect: 0.7703, h: 64 },
    armored_boar: { aspect: 1.1997, h: 72 },
  };

  // 变体别名：共用立绘（渲染时可叠加代码层装饰）
  const ALIAS = {
    swift_wolf: 'wolf',   // 疾风狼：wolf 立绘 + 速度线装饰
    charger: 'boar',      // 兜底：未单独立绘的冲撞怪
  };

  const imgs = {};
  function init() {
    if (typeof window === 'undefined') return;
    for (const id of Object.keys(META)) {
      const im = new Image();
      im.onload = () => { im.__ok = true; };
      im.onerror = () => { im.__ok = false; };
      im.src = `assets/monsters3d/keyed/mob-${id}.png`;
      imgs[id] = im;
    }
  }

  function resolve(type) {
    const id = ALIAS[type] || type;
    const im = imgs[id];
    if (!im || !im.__ok || !im.naturalWidth) return null;
    return { id, im, meta: META[id] };
  }

  // 在当前变换坐标系以 (0,0) 为脚底中心绘制（等高、按纵横比定宽）
  // 返回 { w, h } 供调用方画血条等
  function draw(ctx, type, opts = {}) {
    const r = resolve(type);
    if (!r) return null;
    const h = (opts.h || r.meta.h) * (opts.scale || 1);
    const w = h * r.meta.aspect;
    if (opts.shadow !== false) {
      // 立绘自带贴地暗部不足，补一层软接触影（在脚底）
      ctx.save();
      ctx.scale(1, .42);
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, w * .42);
      g.addColorStop(0, 'rgba(0,0,0,.42)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, w * .42, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    if (opts.flash > 0) {          // 受击白闪：外围白光晕（与现有 sprite 分支一致）
      ctx.shadowColor = '#fff4cf';
      ctx.shadowBlur = 18 * Math.min(1, opts.flash / .14);
      ctx.globalAlpha *= .92;
    }
    ctx.drawImage(r.im, -w * .5, -h, w, h);
    ctx.shadowBlur = 0;
    return { w, h, id: r.id };
  }

  init();
  return { META, ALIAS, imgs, resolve, draw };
})();
if (typeof window !== 'undefined') window.Monsters3D = Monsters3D;
