// ============================================================
// 统一素材加载器 v3.5
// 所有作物/道具/陷阱/建筑图片集中加载，提供 DOM <img> 和 Canvas drawImage 两种用法
// 图片路径：assets/crops/, assets/items/, assets/traps/, assets/buildings/
// 图片背景为白色（生图默认），Canvas 绘制时自动做圆角裁切
// ============================================================

const CropArt = {
  // id -> 相对路径
  map: {
    // 农场作物
    wheat: 'crops/wheat_t.png',
    sunflower: 'crops/sunflower_t.png',
    watermelon: 'crops/watermelon_t.png',
    pea: 'crops/pea_t.png',
    cabbage: 'crops/cabbage_t.png',
    carrot: 'crops/carrot_t.png',
    corn: 'crops/corn_t.png',
    pumpkin: 'crops/pumpkin_t.png',
    chili: 'crops/chili_t.png',
    garlic: 'crops/garlic_t.png',
    mint: 'crops/mint_t.png',
    cactus: 'crops/cactus_t.png',
    ginseng: 'crops/ginseng_t.png',
    tomato: 'crops/tomato_t.png',
    rosemary: 'crops/rosemary_t.png',
    fire_grass: 'crops/fire_grass_t.png',
    frost_flower: 'crops/frost_flower_t.png',
    lightning_vine: 'crops/lightning_vine_t.png',
    shadow_flower: 'crops/shadow_flower_t.png',
    rainbow_flower: 'crops/rainbow_flower_t.png',
    // 道具
    herb_potion: 'items/herb_potion_t.png',
    bread: 'items/bread_t.png',
    torch: 'items/torch_t.png',
    coin: 'items/coin_t.png',
    iron: 'items/iron_t.png',
    crystal: 'items/crystal_t.png',
    fang: 'items/fang_t.png',
    poison_bomb: 'items/poison_bomb_t.png',
    night_mushroom: 'items/night_mushroom_t.png',
    iron_pumpkin: 'items/iron_pumpkin_t.png',
    // 陷阱
    oil_barrel: 'traps/oil_barrel_t.png',
    spike_trap: 'traps/spike_trap_t.png',
    gas_tank: 'traps/gas_tank_t.png',
    // 建筑
    workshop: 'buildings/workshop_t.png',
    greenhouse: 'buildings/greenhouse_t.png',
    barn: 'buildings/barn_t.png',
    lab: 'buildings/lab_t.png',
    anvil: 'buildings/anvil_t.png',
    fence_gate: 'buildings/fence_gate_t.png',
    well: 'buildings/well_t.png',
  },
  imgs: {},
  loaded: {},

  init() {
    const base = 'assets/';
    for (const [id, path] of Object.entries(this.map)) {
      const img = new Image();
      img.onload = () => { this.loaded[id] = true; };
      img.onerror = () => { this.loaded[id] = false; };
      img.src = base + path;
      this.imgs[id] = img;
    }
  },

  // 返回 HTMLImageElement（可能未加载完，调用方判 naturalWidth）
  img(id) {
    return this.imgs[id] || null;
  },

  // 是否就绪
  ready(id) {
    const im = this.imgs[id];
    return im && im.complete && im.naturalWidth > 0;
  },

  // 生成 DOM <img> 标签，失败回退 emoji
  // v3.8 用 mix-blend-mode: lighten 去黑底（HTML 标签直接生效）
  dom(id, emoji, size = 24) {
    if (this.ready(id)) {
      const pk = (this.map[id]||'').endsWith('.png');
      const style = pk
        ? `width:${size}px;height:${size}px;object-fit:contain;vertical-align:middle;display:inline-block;background:transparent;`
        : `width:${size}px;height:${size}px;object-fit:cover;border-radius:6px;vertical-align:middle;display:inline-block;mix-blend-mode:lighten;background:transparent;`;
      return `<img src="assets/${this.map[id]}" alt="${emoji}" style="${style}" />`;
    }
    return `<span style="font-size:${size}px;vertical-align:middle;">${emoji}</span>`;
  },

  // Canvas 绘制：在 (x,y) 居中画 size×size，带圆角裁切去白边
  // x,y 是中心坐标
  draw(ctx, id, x, y, size) {
    const im = this.imgs[id];
    if (!im || !im.complete || !im.naturalWidth) return false;
    const half = size / 2;
    ctx.save();
    const preKeyed = (im.src||'').includes('_t.png');
    // 圆角裁切（仅旧底图需要；透明底图直接绘制避免削掉主体边缘）
    const r = size * 0.22;
    if (preKeyed) {
      const p0 = this._getProcessed(im);
      const s0 = Math.max(size / p0.width, size / p0.height);
      ctx.drawImage(p0, x - p0.width*s0/2, y - p0.height*s0/2, p0.width*s0, p0.height*s0);
      ctx.restore();
      return true;
    }
    ctx.beginPath();
    ctx.moveTo(x - half + r, y - half);
    ctx.lineTo(x + half - r, y - half);
    ctx.quadraticCurveTo(x + half, y - half, x + half, y - half + r);
    ctx.lineTo(x + half, y + half - r);
    ctx.quadraticCurveTo(x + half, y + half, x + half - r, y + half);
    ctx.lineTo(x - half + r, y + half);
    ctx.quadraticCurveTo(x - half, y + half, x - half, y + half - r);
    ctx.lineTo(x - half, y - half + r);
    ctx.quadraticCurveTo(x - half, y - half, x - half + r, y - half);
    ctx.closePath();
    ctx.clip();
    // cover 裁切填满（v3.8 用去黑/白底处理后的图）
    const proc = this._getProcessed(im);
    const iw = proc.width, ih = proc.height;
    const scale = Math.max(size / iw, size / ih);
    const dw = iw * scale, dh = ih * scale;
    ctx.drawImage(proc, x - dw / 2, y - dh / 2, dw, dh);
    ctx.restore();
    return true;
  },

  // 无裁切直接画（适合已经透明的图）
  // v3.8 自动去黑底/白底
  _processed: null,
  _getProcessed(im) {
    if (!this._processed) this._processed = new Map();
    let c = this._processed.get(im);
    if (c) return c;
    if ((im.src||'').includes('_t.png')) { this._processed.set(im, im); return im; }
    c = document.createElement('canvas');
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    const cctx = c.getContext('2d');
    cctx.drawImage(im, 0, 0);
    try {
      const data = cctx.getImageData(0, 0, c.width, c.height);
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i], g = px[i+1], b = px[i+2];
        // 去黑底
        if (r < 30 && g < 30 && b < 30) { px[i+3] = 0; }
        // 去白底
        else if (r > 235 && g > 235 && b > 235) { px[i+3] = 0; }
      }
      cctx.putImageData(data, 0, 0);
    } catch(e) {}
    this._processed.set(im, c);
    return c;
  },
  drawRaw(ctx, id, x, y, w, h) {
    const im = this.imgs[id];
    if (!im || !im.complete || !im.naturalWidth) return false;
    const proc = this._getProcessed(im);
    ctx.drawImage(proc, x - w / 2, y - h / 2, w, h);
    return true;
  },
};

// 启动加载
if (typeof window !== 'undefined') {
  CropArt.init();
  window.CropArt = CropArt;
}
