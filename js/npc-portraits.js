// ================= NPC 3D 形象注册表（v1.11 技美资产管线产物） =================
// 资产：assets/npc/portraits/portrait-*.png（512px 透明底，底部对齐）
// 由 tools/npc-portrait-key.py 抠像管线产出（HSV 品红家族判定 + 孤立域分流 + 受限雾生长）
// 世界精灵/UI 双端消费；加载失败自动回退 ArtTextures 程序化贴图（v1.10）→ emoji
// META 为各贴图内容框纵横比（meta.json 静态化，file:// 下不可 fetch）
const NpcPortraits = (() => {
  'use strict';

  const IDS = ['guide', 'merchant', 'farmer', 'veteran', 'traveler', 'kael', 'lore', 'chen', 'miao'];
  const PATH = id => 'assets/npc/portraits/portrait-' + id + '.png';
  const META = {
    guide:    { w: 352, h: 501 },
    merchant: { w: 406, h: 500 },
    farmer:   { w: 323, h: 502 },
    veteran:  { w: 399, h: 500 },
    traveler: { w: 278, h: 501 },
    kael:     { w: 387, h: 500 },
    lore:     { w: 284, h: 507 },
    chen:     { w: 287, h: 502 },
    miao:     { w: 365, h: 501 }
  };

  const IMG = {};      // id -> Image
  const FAIL = {};     // id -> true（加载失败，走兜底）
  let _kicked = false;

  function init() {
    if (_kicked) return;
    _kicked = true;
    IDS.forEach(id => {
      const im = new Image();
      im.onload = () => { IMG[id] = im; };
      im.onerror = () => { FAIL[id] = true; };
      im.src = PATH(id);
    });
  }

  // 可用性：预加载成功且解码完成
  function get(id) {
    return (IMG[id] && IMG[id].naturalWidth > 0) ? IMG[id] : null;
  }
  function failed(id) { return !!FAIL[id]; }

  // 世界精灵绘制：内容纵横比定宽、底部对齐（贴地）；成功返回 true
  function drawWorld(ctx, id, sx, sy, h) {
    const im = get(id);
    if (!im) return false;
    const m = META[id] || { w: 380, h: 500 };
    const w = Math.max(8, h * (m.w / m.h));
    ctx.drawImage(im, sx - w / 2, sy - h, w, h);
    return true;
  }

  // UI 引用（<img src> 路径即可，浏览器自行异步加载）
  function url(id) { return PATH(id); }

  return { init, get, failed, drawWorld, url, IDS, META };
})();
window.NpcPortraits = NpcPortraits;
NpcPortraits.init();
