// ============================================================
// 统一素材加载器 v3.5
// 所有作物/道具/陷阱/建筑图片集中加载，提供 DOM <img> 和 Canvas drawImage 两种用法
// 图片路径：assets/crops/, assets/items/, assets/traps/, assets/buildings/
// 图片背景为白色（生图默认），Canvas 绘制时自动做圆角裁切
// ============================================================

const CropArt = {
  // id -> 相对路径
  map: {
    'beartrap_item': 'icons/beartrap_item_t.png',
    'war_horn': 'icons/war_horn_t.png',
    'scout_eagle': 'icons/scout_eagle_t.png',
    'purify_tonic': 'icons/purify_tonic_t.png',
    'rage_tonic': 'icons/rage_tonic_t.png',
    'shield_gen': 'icons/shield_gen_t.png',
    'rotting_bait': 'icons/rotting_bait_t.png',
    'med_shot': 'icons/med_shot_t.png',
    'death_pardon': 'icons/death_pardon_t.png',
    'wraith_orchid': 'icons/wraith_orchid_t.png',
    'soil': 'icons/soil_t.png',
    'water': 'icons/water_t.png',
    'compost': 'icons/compost_t.png',
    'stone': 'icons/stone_t.png',
    'fiber': 'icons/fiber_t.png',
    'refined_iron': 'icons/refined_iron_t.png',
    'venom': 'icons/venom_t.png',
    'carapace': 'icons/carapace_t.png',
    'soul_ash': 'icons/soul_ash_t.png',
    'thunder_fruit': 'icons/thunder_fruit_t.png',
    'crystal_grape': 'icons/crystal_grape_t.png',
    'shield_elixir': 'icons/shield_elixir_t.png',
    'flame_elixir': 'icons/flame_elixir_t.png',
    'wraith_draft': 'icons/wraith_draft_t.png',
    'energy_cell': 'icons/energy_cell_t.png',
    'grape_juice': 'icons/grape_juice_t.png',
    'bread': 'icons/bread_t.png',
    'medkit': 'icons/medkit_t.png',
    'torch': 'icons/torch_t.png',
    'poison_bomb': 'icons/poison_bomb_t.png',
    'ketchup': 'icons/ketchup_t.png',
    'juice': 'icons/juice_t.png',
    'egg': 'icons/egg_t.png',
    'mint_tea': 'icons/mint_tea_t.png',
    'ginseng_soup': 'icons/ginseng_soup_t.png',
    'coin': 'icons/coin_t.png',
    'iron': 'icons/iron_t.png',
    'crystal': 'icons/crystal_t.png',
    'bossFang': 'icons/bossFang_t.png',
    'pumpkin_lantern': 'icons/pumpkin_lantern_t.png',
    'cult_altar': 'icons/cult_altar_t.png',
    'workshop': 'icons/workshop_t.png',
    'greenhouse_b': 'icons/greenhouse_b_t.png',
    'archive_book': 'icons/archive_book_t.png',
    'codex_book': 'icons/codex_book_t.png',

    'thunder_vine': 'icons/thunder_vine_t.png',
    'purify_flower': 'icons/purify_flower_t.png',
    'mirror_grass': 'icons/mirror_grass_t.png',
    'ningqi_grass': 'icons/ningqi_grass_t.png',
    'lingsui_wheat': 'icons/lingsui_wheat_t.png',
    'wudao_fruit': 'icons/wudao_fruit_t.png',
    'jiuye_lingzhi': 'icons/jiuye_lingzhi_t.png',
    'jiuzhuan_ginseng': 'icons/jiuzhuan_ginseng_t.png',
    'ice_lotus': 'icons/ice_lotus_t.png',
    'flame_fruit': 'icons/flame_fruit_t.png',

    'thunder_chain': 'icons/thunder_chain_t.png',
    'death_scythe': 'icons/death_scythe_t.png',
    't1_boar_king': 'icons/t1_boar_king_t.png',
    't1_withered': 'icons/t1_withered_t.png',
    't1_quarry': 'icons/t1_quarry_t.png',
    't2_gargoyle_lord': 'icons/t2_gargoyle_lord_t.png',
    't2_ruin_golem': 'icons/t2_ruin_golem_t.png',
    't3_swamp_hag': 'icons/t3_swamp_hag_t.png',
    't3_brood_mother': 'icons/t3_brood_mother_t.png',
    't3_scorch_demon': 'icons/t3_scorch_demon_t.png',
    't4_abyss_lord': 'icons/t4_abyss_lord_t.png',
    't4_time_warden': 'icons/t4_time_warden_t.png',
    't4_moon_priestess': 'icons/t4_moon_priestess_t.png',
    't4_arena_champion': 'icons/t4_arena_champion_t.png',
    'mill_wraith': 'icons/mill_wraith_t.png',
    'shadow_assassin': 'icons/shadow_assassin_t.png',
    'void_warden': 'icons/void_warden_t.png',
    'spike_root': 'icons/spike_root_t.png',
    'poison_spore': 'icons/poison_spore_t.png',
    'ice_cactus': 'icons/ice_cactus_t.png',

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
    // v4.2 统一 HUD/技能/卡片图标
    herb_kit: 'icons/herb_kit_t.png',
    thorn_storm: 'icons/thorn_storm_t.png',
    signal_flare: 'icons/signal_flare_t.png',
    growth_catalyst: 'icons/growth_catalyst_t.png',
    straw_smash: 'icons/straw_smash_t.png',
    vine_bind: 'icons/vine_bind_t.png',
    earth_dash: 'icons/earth_dash_t.png',
    smoke_screen: 'icons/smoke_screen_t.png',
    chili_breath: 'icons/chili_breath_t.png',
    pea_storm: 'icons/pea_storm_t.png',
    frost_barrier: 'icons/frost_barrier_t.png',
    thorn_burst: 'icons/thorn_burst_t.png',
    earth_slam: 'icons/earth_slam_t.png',
    gale_slash: 'icons/gale_slash_t.png',
    healing_rain: 'icons/healing_rain_t.png',
    sun_drum: 'icons/sun_drum_t.png',
    poison_mist: 'icons/poison_mist_t.png',
    iron_armor: 'icons/iron_armor_t.png',
    invincible_core: 'icons/invincible_core_t.png',
    seed_pouch: 'icons/seed_pouch_t.png',
    wood: 'icons/wood_t.png',
    herb_mat: 'icons/herb_mat_t.png',
    pea_plant: 'icons/pea_plant_t.png',
    frost_vine: 'icons/frost_vine_t.png',
    bind_flower: 'icons/bind_flower_t.png',
    sun_flower: 'crops/sunflower_t.png',
    sacred_tree: 'icons/sacred_tree_t.png',
    mvp_combo: 'icons/mvp_combo_t.png',
    mvp_clutch: 'icons/mvp_clutch_t.png',
    mvp_loot: 'icons/mvp_loot_t.png',
    mvp_dist: 'icons/mvp_dist_t.png',
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

  // v4.2 业务对象 -> 素材 id（无映射返回 null）
  resolveArtId(item) {
    if (!item) return null;
    if (item.type === 'gold') return 'coin';
    if (item.type === 'invincible') return 'invincible_core';
    const direct = {
      herb_kit: 'herb_kit', thorn_storm: 'thorn_storm', signal_flare: 'signal_flare',
      growth_catalyst: 'growth_catalyst', invincible: 'invincible_core',
      iron: 'iron', crystal: 'crystal', bossFang: 'fang', wood: 'wood', herb: 'herb_mat',
      pea_plant: 'pea_plant', frost_vine: 'frost_vine', bind_flower: 'bind_flower',
      sun_flower: 'sun_flower', sacred_tree: 'sacred_tree',
    };
    if (direct[item.id]) return direct[item.id];
    if (item.matId && direct[item.matId]) return direct[item.matId];
    if (item.plantId && direct[item.plantId]) return direct[item.plantId];
    if (this.map[item.id]) return item.id;
    if (item.seedId && this.map[item.seedId]) return item.seedId;
    return null;
  },

  // v4.2 业务对象 -> <img>，无图时用金色圆形字徽兜底（替代 emoji）
  domFor(item, size = 20) {
    const id = this.resolveArtId(item);
    const em = (item && item.icon) || '';
    if (id && this.ready(id)) return this.dom(id, em, size);
    const ch = (item && item.name ? item.name.slice(0, 1) : '物');
    return '<span style="display:inline-flex;align-items:center;justify-content:center;width:' + size + 'px;height:' + size +
      'px;border-radius:50%;background:linear-gradient(135deg,#6a5320,#3a2e12);color:#f2d078;font-size:' +
      Math.round(size * 0.52) + 'px;font-weight:700;vertical-align:middle;">' + ch + '</span>';
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
