/* 家园全景 v3（2026-10-16）：AI 绘制底图 + 数据驱动精灵层 + 全局调色。
 *   底图：assets/panorama/pano-base.png（1536×512 精确 3:1，AI 生成：废土山谷、右侧浊河、
 *         中央土路、左前田垄、地平线废都剪影；无日月 → 天体由程序按时段绘制）。
 *   架构（入口与 v2 完全兼容）：
 *     draw()        2D 全量路径（Pixi 不可用时的回退，10fps）
 *     bakeStatic()  静态烘焙 900×300（底图+精灵冻结帧+调色+天体+夜灯+颗粒），返回 {canvas,lights,night}
 *     drawDynamic() 60fps 透明叠加（波光/乌鸦/炊烟/鸡/蜂/风车/作物摇摆/事件/雾 + source-atop 夜色)
 *     phaseOf()/decoPosOf() 原样保留（PANO_HOUR 调试钩子不变）。
 *   调色链：底图/旧版环境 → 精灵(建筑×等级/地块/装饰) → multiply/overlay 时段季节调色 →
 *           天体(日月星) → 夜窗暖光(additive) → 颗粒+暗角+地平线霾(电影统一语言)。
 *   底图未就绪/加载失败 → 完整回落到 v2 程序化环境（零回归）。 */
window.FarmPanorama = {
  /* ---------- 底图 ---------- */
  _baseImg: null, _baseOk: false, _baseSalt: 0,
  _initBase() {
    if (this._baseImg) return;
    const im = new Image();
    im.onload = () => { this._baseOk = true; this._baseSalt++; };
    im.onerror = () => { this._baseOk = false; };
    im.src = 'assets/panorama/pano-base.png?v=panov5';
    this._baseImg = im;
  },
  baseKey() { this._initBase(); return (this._baseOk ? '1.' + this._baseSalt : '0'); },
  /* v5.8.12 底图就绪门控：AI 底图 onload 前 Pixi 不烘焙（防回退帧锁死纹理缓存 + file:// 污染时序坑） */
  baseReady() { this._initBase(); return this._baseOk; },
  _drawBase(c) {
    this._initBase();
    if (this._baseOk && this._baseImg && this._baseImg.naturalWidth) {
      c.drawImage(this._baseImg, 0, 0, 900, 300);
      return true;
    }
    return false;
  },

  /* ---------- 时段 ---------- */
  phaseOf() {
    const hr = (typeof window !== 'undefined' && window.PANO_HOUR != null) ? window.PANO_HOUR : (new Date().getHours() + new Date().getMinutes() / 60);
    return { hr, night: hr >= 20 || hr < 5, dusk: hr >= 17 && hr < 20, dawn: hr >= 5 && hr < 7 };
  },
  decoPosOf(d) { return { x: 512 + d.x * 63, y: 236 + d.y * 7 }; },
  _bakeC: null,
  _grainC: null,

  /* ---------- 共用工具 ---------- */
  _P(c) {
    return (pts, color) => { c.fillStyle = color; c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(...p) : c.moveTo(...p)); c.closePath(); c.fill(); };
  },

  /* ---------- 环境：AI 底图 或 v2 程序化（回退） ---------- */
  _env(c, G, winter, autumn, night, dusk, dawn, t) {
    if (this._drawBase(c)) return true;
    /* ===== v2 程序化环境（底图缺失时的完整回退） ===== */
    const P = this._P(c);
    const sky = c.createLinearGradient(0, 0, 0, 185);
    if (night) { sky.addColorStop(0, '#1d2026'); sky.addColorStop(.55, '#2e2c29'); sky.addColorStop(1, '#3d3830'); }
    else { sky.addColorStop(0, '#54504a'); sky.addColorStop(.55, '#8a7f6a'); sky.addColorStop(1, '#b0a184'); }
    c.fillStyle = sky; c.fillRect(0, 0, 900, 300);
    if (night) {
      c.fillStyle = '#d9d5c4'; c.beginPath(); c.arc(705, 55, 11, 0, 7); c.fill(); c.fillStyle = '#b8b4a4'; c.beginPath(); c.arc(709, 52, 3, 0, 7); c.fill(); c.beginPath(); c.arc(701, 59, 2, 0, 7); c.fill();
      for (let i = 0; i < 40; i++) { const x = (i * 211) % 900, y = (i * 57) % 110; if (Math.sin(t * 1.5 + i * 2.3) > -.6) { c.fillStyle = (i % 3 === 0) ? '#e8e4d4aa' : '#e8e4d444'; c.fillRect(x, y, 1.6, 1.6); } }
    } else {
      const sun = c.createRadialGradient(705, 55, 3, 705, 55, dusk ? 66 : 58); sun.addColorStop(0, dusk ? '#f2c98a' : '#efeadb'); sun.addColorStop(.25, dusk ? '#e0a86699' : '#d9d2be99'); sun.addColorStop(1, '#d9d2be00'); c.fillStyle = sun; c.fillRect(630, 0, 150, 125);
      c.fillStyle = dusk ? '#f2c98a' : '#e9e4d3cc'; c.beginPath(); c.arc(705, dusk ? 68 : 55, 11, 0, 7); c.fill();
    }
    if (dusk) { const dg = c.createLinearGradient(0, 110, 0, 190); dg.addColorStop(0, '#c97a3d00'); dg.addColorStop(.7, '#c97a3d55'); dg.addColorStop(1, '#c97a3d00'); c.fillStyle = dg; c.fillRect(0, 110, 900, 80); }
    if (dawn) { const dg = c.createLinearGradient(0, 110, 0, 190); dg.addColorStop(0, '#c98a8a00'); dg.addColorStop(.7, '#c98a8a44'); dg.addColorStop(1, '#c98a8a00'); c.fillStyle = dg; c.fillRect(0, 110, 900, 80); }
    const ruin = (y, col, seed) => { let x = -20, i = 0; while (x < 920) { const w = 26 + ((seed * i * 7) % 38), h = 12 + ((seed * (i + 3) * 11) % (seed === 7 ? 38 : 28)); const lean = ((seed * (i + 5)) % 7 - 3) * .012;
      if (((seed * (i + 1)) % 5) !== 0) { c.save(); c.translate(x + w / 2, y); c.rotate(lean); c.fillStyle = col; c.fillRect(-w / 2, -h, w, h); if (((seed * (i + 2)) % 4) === 0) { c.fillRect(-w / 2 - 4, -h - 6, w + 8, 4); } c.restore(); }
      else { c.fillStyle = col; c.fillRect(x + 4, y - 5, w - 10, 5); c.fillRect(x + w / 2 - 3, y - 20 - h * .4, 6, 20 + h * .4); c.fillRect(x + w / 2 - 8, y - 24 - h * .4, 16, 4); }
      x += w + 6 + (seed * (i + 4)) % 10; i++; } };
    ruin(168, '#565a54', 7); ruin(175, '#464a44', 13);
    c.strokeStyle = '#464a44'; c.lineWidth = 2; [95, 320, 585].forEach(px => { c.beginPath(); c.moveTo(px, 172); c.lineTo(px + 6, 132 - ((px * 7) % 16)); c.stroke(); c.beginPath(); c.moveTo(px + 6, 134 - ((px * 7) % 16)); c.lineTo(px + 30, 142 - ((px * 7) % 16)); c.stroke(); });
    const haze = c.createLinearGradient(0, 120, 0, 185); haze.addColorStop(0, '#c9a06a00'); haze.addColorStop(.7, '#c9a06a2e'); haze.addColorStop(1, '#c9a06a00'); c.fillStyle = haze; c.fillRect(0, 120, 900, 65);
    for (let layer = 0; layer < 3; layer++) { const pts = [[0, 175]]; for (let x = 0; x <= 900; x += 30) pts.push([x, 98 + layer * 30 + Math.sin(x * .008 + layer * 2) * 20 + Math.sin(x * .021 + layer) * 9]); pts.push([900, 300], [0, 300]); P(pts, [winter ? '#94978c' : '#837a5c', winter ? '#adb0a4' : '#6d6b4e', winter ? '#c8ccc1' : '#616249'][layer]); }
    for (let i = 0; i < 26; i++) { const x = (i * 163) % 880 + 10, y = 215 + (i * 29) % 75; c.strokeStyle = '#4a443444'; c.lineWidth = 1; c.beginPath(); c.moveTo(x, y); c.lineTo(x + 6 + (i % 4) * 3, y + 2 - (i % 3) * 2); c.lineTo(x + 13 + (i % 4) * 4, y + 1); c.stroke(); }
    for (let i = 0; i < 160; i++) { const x = (i * 137.51 + t * 6 * (1 + i % 3)) % 920 - 10, y = 120 + (i * 37.13) % 160; c.fillStyle = ['#c9b98c22', '#3a382e1e', '#8f846a26'][i % 3]; c.fillRect(x, y, 2 + i % 5, 1); }
    P([[640, 142], [671, 143], [701, 181], [735, 214], [783, 245], [800, 300], [702, 300], [726, 251], [695, 212], [667, 180]], '#46585a');
    P([[460, 138], [479, 138], [495, 188], [552, 230], [578, 300], [519, 300], [507, 242], [461, 192]], '#8f7c5c');
    const tree = (x, y, s) => { c.fillStyle = '#2c2a2433'; c.beginPath(); c.ellipse(x + 5, y + 3, s * 18, s * 6, 0, 0, 7); c.fill(); c.strokeStyle = winter ? '#6e6a60' : '#5c5346'; c.lineWidth = 4.5 * s; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 3 * s, y - 16 * s, x - 2 * s, y - 30 * s); c.stroke();
      for (let j = 0; j < 4; j++) { const a = (-.5 - j * .5) * (j % 2 ? 1 : -1), L = (13 - j * 2.4) * s, bx = x - 2 * s, by = y - 12 * s - j * 6 * s; c.lineWidth = 2.2 * s; c.beginPath(); c.moveTo(bx, by); c.quadraticCurveTo(bx + Math.cos(a) * L * .6 * s * 2, by + Math.sin(a) * L, bx + Math.cos(a) * L * 2.1, by + Math.sin(a) * L * 1.5 - 4 * s); c.stroke(); }
      if (!winter && ((x * 7) % 10) < 4) { c.fillStyle = autumn ? '#8a6d34' : '#5d6b46'; for (let j = 0; j < 3; j++) { c.beginPath(); c.ellipse(x + (j - 1) * 9 * s + Math.sin(t + j) * 1, y - 26 * s - j * 5 * s, 7 * s, 4 * s, .4, 0, 7); c.fill(); } } };
    for (let i = 0; i < 16; i++) { const x = i * 56; if ((x > 70 && x < 180) || (x > 795)) continue; tree(x, 148 + Math.sin(i * 2) * 9, .5 + (i % 3) * .1); }
    for (let i = 0; i < 32; i++) { const y = 166 + i * 4, x = 652 + (y - 166) * .77 + (i % 2 ? 43 : -3); c.fillStyle = ['#5c615a', '#8a8672', '#4a5049'][i % 3]; c.beginPath(); c.ellipse(x, y, 3 + i % 3, 2 + i % 2, .3, 0, 7); c.fill(); }
    P([[683, 209], [729, 194], [739, 206], [695, 224]], '#54422e'); c.strokeStyle = '#8f7c5c'; for (let i = 0; i < 8; i++) { c.beginPath(); c.moveTo(684 + i * 6, 209 - i * 2); c.lineTo(696 + i * 6, 222 - i * 2); c.stroke(); }
    for (let i = 0; i < 44; i++) { const x = 310 + (i * 29) % 92, y = 147 + (i * 13) % 22; c.fillStyle = ['#9a8a68', '#7a6a5a', '#8a8a62'][i % 3]; c.beginPath(); c.arc(x, y, 1.2, 0, 7); c.fill(); }
    for (let x = 60; x < 490; x += 31) { const y = 271 + (x - 55) * .042; c.fillStyle = '#6e5b40'; c.fillRect(x, y - 10, 4, 21); P([[x - 1, y - 16], [x + 5, y - 16], [x + 2, y - 23]], '#5c4a34'); }
    c.strokeStyle = '#8a8a8a66'; c.lineWidth = 1; c.beginPath(); c.moveTo(55, 266); c.lineTo(485, 284); c.moveTo(55, 276); c.lineTo(485, 294); c.stroke();
    for (let i = 0; i < 90; i++) { const x = (i * 127) % 900, y = 270 + (i * 17) % 30; c.strokeStyle = [winter ? '#9a9d90' : '#5d5c40', '#7d7a50', '#9a8d5c'][i % 3]; c.lineWidth = 1; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.sin(t + i) * 2, y - 4 - i % 5); c.stroke(); }
    tree(43, 254, 1.35); tree(882, 275, 1.5);
    return false;
  },

  /* ---------- 农田台地垫层（AI 底图模式）：羽化土色台地盖住底图丘陵纹理 ----------
   * 底图负责天空/远景/河流；农田区必须完全受控（数据对应），垫层即"人类开垦的整地"。 */
  _fieldBed(c, winter) {
    c.save();
    const g = c.createLinearGradient(0, 168, 0, 300);
    g.addColorStop(0, winter ? '#5c5348' : '#5a4a34');
    g.addColorStop(.45, winter ? '#524a40' : '#4e3f2c');
    g.addColorStop(1, winter ? '#463e36' : '#413524');
    c.filter = 'blur(7px)';                    /* 边缘羽化融入底图 */
    c.beginPath();
    c.moveTo(58, 178); c.lineTo(512, 170); c.lineTo(556, 300); c.lineTo(30, 300);
    c.closePath(); c.fillStyle = g; c.fill();
    c.filter = 'none';
    c.beginPath();                             /* 内部压实（抵消 blur 中心区变淡） */
    c.moveTo(68, 182); c.lineTo(505, 175); c.lineTo(546, 300); c.lineTo(40, 300);
    c.closePath(); c.fill();
    c.strokeStyle = 'rgba(28,22,14,.15)'; c.lineWidth = 3;   /* 远景耕作条带（极淡） */
    for (let y = 200; y < 296; y += 18) { c.beginPath(); c.moveTo(44, y); c.quadraticCurveTo(300, y - 9, 540, y - 5); c.stroke(); }
    c.restore();
  },

  /* ---------- 精灵层：建筑×等级 / 地块 / 装饰（数据驱动，新旧路径共用） ----------
   * opts: { live:false  传 t 给作物摇摆（draw 全量路径用 true）
   *         softSoil:false  AI 底图模式：土垄画淡一点贴合底图田垄
   *         skipCrops:false 烘焙层跳过作物（作物走 60fps 实时层） } */
  _sprites(c, G, t, opts) {
    const live = !!(opts && opts.live), softSoil = !!(opts && opts.softSoil);
    const P = this._P(c);
    const winter = G.season === 'winter', autumn = G.season === 'autumn';
    const bl = G.buildings || {}, blv = id => (bl[id] && bl[id].level) || 0, slot = id => (bl[id] && bl[id].slot) || null;
    const anyL2 = Object.values(bl).some(b => ((b && b.level) || 0) >= 2);
    const night = this.phaseOf().night;
    const LIGHTS = [];
    const tt = live ? t : 0;
    if (softSoil) this._fieldBed(c, winter);

    /* 主屋：铁皮庇护所（暖窗=希望焦点） */
    const house = (x, y, s) => {
      c.save(); c.translate(x, y); c.scale(s, s); c.fillStyle = '#2c2a243d'; c.beginPath(); c.ellipse(5, 5, 64, 13, 0, 0, 7); c.fill();
      P([[-45, 0], [-45, -50], [35, -50], [35, 0]], '#5a4a3a'); P([[35, -50], [62, -37], [62, -2], [35, 0]], '#4a3c30');
      P([[-55, -48], [-8, -81], [72, -39], [33, -47]], '#75584a'); P([[-55, -48], [-8, -81], [34, -48]], '#5c4438');
      c.fillStyle = '#8a6a50'; c.fillRect(-12, -64, 20, 9); c.fillRect(18, -56, 24, 7); c.strokeStyle = '#3f3229'; c.lineWidth = 1.4; c.strokeRect(-12, -64, 20, 9); c.strokeRect(18, -56, 24, 7);
      c.strokeStyle = '#8f7c5c66'; for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(-36 + i * 12, -52 - i * 3); c.lineTo(39 + i * 4, -44 + i * 2); c.stroke(); }
      c.fillStyle = '#3a2f24'; c.fillRect(-7, -28, 17, 28); c.fillStyle = '#a0522d'; c.fillRect(-4, -26, 3, 7); c.fillRect(2, -26, 3, 7);
      const gr = c.createRadialGradient(-26, -26, 2, -26, -26, night ? 34 : 26); gr.addColorStop(0, '#e8b45a55'); gr.addColorStop(1, '#e8b45a00'); c.fillStyle = gr; c.fillRect(-60, -60, 60, 60);
      c.fillStyle = night ? '#f2c46a' : '#e8b45a'; c.fillRect(-33, -35, 13, 16); c.strokeStyle = '#2c241a'; c.lineWidth = 1.4; c.strokeRect(-33, -35, 13, 16); c.beginPath(); c.moveTo(-26.5, -35); c.lineTo(-26.5, -19); c.stroke();
      c.fillStyle = '#e0d8b822'; c.fillRect(17, -35, 13, 16); c.strokeStyle = '#3f3229'; c.strokeRect(17, -35, 13, 16);
      c.fillStyle = '#5c5346'; c.fillRect(31, -75, 9, 22); c.fillStyle = '#3a2f24'; c.fillRect(29, -77, 14, 4);
      c.strokeStyle = '#6e6a60'; c.lineWidth = 1; c.beginPath(); c.moveTo(31, -77); c.lineTo(31, -88); c.stroke(); c.beginPath(); c.moveTo(31, -84); c.lineTo(38, -87); c.stroke();
      c.strokeStyle = '#8a6a5088'; for (let j = 0; j < 5; j++) { c.beginPath(); c.moveTo(-43, -43 + j * 9); c.lineTo(33, -43 + j * 9); c.stroke(); }
      /* v5.8.5 结构线：屋顶脊高光 + 檐口阴影 + 墙转角 + 基线（摆脱平涂纸片感） */
      c.strokeStyle = '#a8876855'; c.lineWidth = 1.3; c.beginPath(); c.moveTo(-52, -49); c.lineTo(-8, -79); c.lineTo(70, -38); c.stroke();
      c.strokeStyle = 'rgba(24,20,14,.42)'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(-55, -47); c.lineTo(33, -46); c.stroke();
      c.strokeStyle = 'rgba(24,20,14,.5)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(35, -50); c.lineTo(35, -1); c.moveTo(-45, -50); c.lineTo(-45, -1); c.stroke();
      c.strokeStyle = 'rgba(24,20,14,.45)'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(-46, -1); c.lineTo(62, -1); c.stroke();
      c.restore();
      LIGHTS.push([x - 26 * s, y - 27 * s, 20 * s], [x + 23 * s, y - 27 * s, 14 * s]);
    };
    house(445, 151, 1);

    /* 加工研究所（左）：L0 瓦砾 → L1 木棚 → L2 铁皮工坊 → L3+ 烟囱 → L4 天线 */
    const wkLv = blv('workshop');
    (function () {
      const x = 184, y = 173, s = .72;
      if (wkLv <= 0) {
        c.fillStyle = '#4e483c'; for (let i = 0; i < 7; i++) { c.beginPath(); c.ellipse(x - 30 + i * 10, y - 3 - (i % 3) * 4, 7 + (i % 3) * 3, 5 + (i % 2) * 2, .2, 0, 7); c.fill(); }
        c.strokeStyle = '#5c5346'; c.lineWidth = 3; c.beginPath(); c.moveTo(x - 24, y - 2); c.lineTo(x - 8, y - 16); c.moveTo(x - 20, y - 4); c.lineTo(x + 2, y - 9); c.stroke();
      } else {
        c.save(); c.translate(x, y); c.scale(s, s);
        c.fillStyle = '#2c2a2433'; c.beginPath(); c.ellipse(5, 5, 64, 13, 0, 0, 7); c.fill();
        P([[-45, 0], [-45, -50], [35, -50], [35, 0]], wkLv >= 2 ? '#5a4a3a' : '#6e5b46'); P([[35, -50], [62, -37], [62, -2], [35, 0]], '#4a3c30');
        P([[-55, -48], [-8, -81], [72, -39], [33, -47]], wkLv >= 2 ? '#75584a' : '#7a6852'); P([[-55, -48], [-8, -81], [34, -48]], '#5c4438');
        if (wkLv >= 2) { c.fillStyle = '#8a6a50'; c.fillRect(-12, -64, 20, 9); c.strokeStyle = '#3f3229'; c.lineWidth = 1.2; c.strokeRect(-12, -64, 20, 9); c.strokeStyle = '#9a8a7044'; for (let i = 0; i < 6; i++) { c.beginPath(); c.moveTo(-50 + i * 16, -50); c.lineTo(-44 + i * 16, -6); c.stroke(); } }
        c.fillStyle = '#3a2f24'; c.fillRect(-7, -28, 15, 28);
        c.fillStyle = night ? '#e8b45a' : '#e0d8b822'; c.fillRect(15, -38, 12, 13); c.strokeStyle = '#3f3229'; c.strokeRect(15, -38, 12, 13);
        if (wkLv >= 3) { c.fillStyle = '#5c5346'; c.fillRect(31, -75, 8, 20); }
        if (wkLv >= 4) { c.strokeStyle = '#6e6a60'; c.beginPath(); c.moveTo(10, -48); c.lineTo(10, -60); c.moveTo(10, -56); c.lineTo(16, -59); c.stroke(); }
        c.restore();
        LIGHTS.push([x + 21 * s, y - 32 * s, 12 * s]);
        const si = slot('workshop');
        if (si === 'whetstone_wheel') { c.save(); c.translate(x - 58, y - 8); c.strokeStyle = '#5c5346'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -14); c.stroke(); c.fillStyle = '#8a8a8a'; c.beginPath(); c.arc(0, -18, 7, 0, 7); c.fill(); c.strokeStyle = '#4e4234'; c.stroke(); c.restore(); }
        else if (si === 'brass_bellows') { c.save(); c.translate(x - 58, y - 6); P([[-6, 0], [6, 0], [0, -12]], '#a8823c'); c.strokeStyle = '#5c5346'; c.lineWidth = 2; c.beginPath(); c.moveTo(6, -4); c.lineTo(12, -4); c.stroke(); c.restore(); }
      }
    })();

    /* 温室（中）：L0 木架残迹 → L1 塑料布 → L2 玻璃顶 → L3 修补+强绿光 */
    const ghLv = blv('greenhouse');
    (function () {
      const gx = 535;
      if (ghLv <= 0) {
        c.strokeStyle = '#4e4234'; c.lineWidth = 2; [[gx, 168], [gx + 25, 158], [gx + 50, 158], [gx + 73, 168]].forEach((p, i) => { c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(p[0] + (i === 1 || i === 2 ? 2 : -2), p[1] - 8); c.stroke(); });
        c.strokeStyle = '#4e423488'; c.beginPath(); c.moveTo(gx, 168); c.lineTo(gx + 25, 158); c.lineTo(gx + 50, 158); c.lineTo(gx + 73, 168); c.stroke();
      } else if (ghLv === 1) {
        /* v5.8.5 塑料布棚（原纯白三角违和）：半透灰绿膜 + 木肋架 + 褶皱 + 压条 */
        P([[535, 168], [535, 140], [565, 120], [608, 140], [608, 170]], 'rgba(164,178,158,.42)');
        c.strokeStyle = '#6a5a44'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(535, 168); c.lineTo(535, 140); c.lineTo(565, 120); c.lineTo(608, 140); c.lineTo(608, 170); c.stroke();
        c.strokeStyle = '#7a6a50'; c.lineWidth = 1.4;
        c.beginPath(); c.moveTo(555, 166); c.lineTo(555, 132); c.moveTo(580, 166); c.lineTo(580, 132); c.moveTo(565, 120); c.lineTo(565, 168); c.stroke();
        c.strokeStyle = 'rgba(228,232,214,.5)'; c.lineWidth = 1;   /* 膜面褶皱高光 */
        for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(541 + i * 17, 165); c.quadraticCurveTo(544 + i * 17, 148, 541 + i * 17, 134); c.stroke(); }
        c.fillStyle = '#5c4f3a'; c.fillRect(533, 166, 77, 4);        /* 底部压条 */
        c.fillStyle = '#3f3229'; c.fillRect(560, 150, 10, 20);
      } else {
        const ghIn = c.createLinearGradient(0, 116, 0, 170); ghIn.addColorStop(0, ghLv >= 3 ? '#5d6b4644' : '#5d6b4622'); ghIn.addColorStop(1, ghLv >= 3 ? '#5d6b4633' : '#5d6b4611'); c.fillStyle = ghIn; P([[535, 168], [535, 137], [565, 116], [608, 138], [608, 170]], '#5d6b4622');
        P([[535, 168], [535, 137], [565, 116], [608, 138], [608, 170]], '#7a8a8080'); P([[535, 137], [565, 116], [608, 138], [578, 147]], '#aab5a466'); c.strokeStyle = '#6e7266'; for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(538 + i * 21, 168); c.lineTo(538 + i * 21, 138); c.stroke(); }
        c.fillStyle = '#5a4a3a'; c.fillRect(585, 144, 17, 5); if (ghLv >= 3) { c.fillStyle = '#5a4a3a'; c.fillRect(541, 128, 20, 5); }
        if (ghLv >= 3) LIGHTS.push([571, 140, 18]);
      }
      const si = slot('greenhouse');
      if (si === 'sun_lens') { c.save(); c.translate(565, 112); c.fillStyle = '#d9c874'; c.beginPath(); c.arc(0, 0, 5, 0, 7); c.fill(); c.strokeStyle = '#8a7a3c'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(0, 5); c.lineTo(0, 10); c.stroke(); c.restore(); }
      else if (si === 'rain_charm') { c.strokeStyle = '#5c5346'; c.lineWidth = 1; c.beginPath(); c.moveTo(532, 150); c.lineTo(532, 160); c.stroke(); c.fillStyle = '#7a9ab0'; c.fillRect(529, 160, 6, 8); }
    })();

    /* 瞭望塔：任一建筑 Lv≥2 才出现（探照灯仅夜/黄昏点亮——白天亮灯违和） */
    if (anyL2) {
      const duskPh = this.phaseOf().dusk;
      (function () {
        c.save(); c.translate(608, 158); c.fillStyle = '#2c2a2433'; c.beginPath(); c.ellipse(0, 2, 26, 7, 0, 0, 7); c.fill();
        c.strokeStyle = '#4e4234'; c.lineWidth = 3.4; c.beginPath(); c.moveTo(-13, 0); c.lineTo(-6, -42); c.moveTo(13, 0); c.lineTo(6, -42); c.moveTo(-11, -14); c.lineTo(11, -14); c.stroke();
        c.fillStyle = '#5a4a3a'; c.fillRect(-16, -52, 32, 12); P([[-19, -52], [0, -63], [19, -52]], '#75584a');
        if (night || duskPh) {
          const sweep = live ? Math.sin(tt * .5) * .35 : 0; c.save(); c.translate(0, -46); c.rotate(sweep);
          const beam = c.createLinearGradient(0, 0, -46, 34); beam.addColorStop(0, night ? '#e8b45a66' : '#e8b45a40'); beam.addColorStop(1, '#e8b45a00'); c.fillStyle = beam; P([[0, -2], [-46, 34], [-30, 38]], '#e8b45a2e'); c.restore();
          c.fillStyle = night ? '#f2c46a' : '#e8c87a'; c.beginPath(); c.arc(0, -46, 3.6, 0, 7); c.fill();
        } else { c.fillStyle = '#4a3f30'; c.beginPath(); c.arc(0, -46, 3.2, 0, 7); c.fill(); }
        c.fillStyle = '#4e4234'; for (let k = 0; k < 3; k++) c.fillRect(-20 + k * 15, -6, 9, 5); c.restore();
        if (night) LIGHTS.push([608, 112, 26]);
      })();
    }

    /* 畜舍（左中）：L1 空棚 → L2 鸡 → L3 蜂箱+蜂 → L4 高级食槽 */
    const bnLv = blv('barn');
    (function () {
      const x = 118, y = 196;
      if (bnLv <= 0) {
        c.strokeStyle = '#4e423455'; c.lineWidth = 1; c.strokeRect(x - 34, y - 16, 68, 20); c.fillStyle = '#56584333'; c.fillRect(x - 34, y - 16, 68, 20);
      } else {
        c.fillStyle = '#2c2a2433'; c.beginPath(); c.ellipse(x, y + 2, 38, 8, 0, 0, 7); c.fill();
        c.strokeStyle = '#4e4234'; c.lineWidth = 3; c.beginPath(); c.moveTo(x - 30, y); c.lineTo(x - 30, y - 22); c.moveTo(x + 30, y); c.lineTo(x + 30, y - 22); c.stroke();
        P([[x - 38, y - 20], [x, y - 34], [x + 38, y - 20]], '#75584a'); P([[x - 38, y - 20], [x, y - 34], [x, y - 20]], '#5c4438');
        c.strokeStyle = '#8f7c5c55'; for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(x - 28 + i * 17, y - 19); c.lineTo(x - 24 + i * 17, y - 2); c.stroke(); }
        if (bnLv >= 3) { const bx = x + 44, by = y - 4; c.fillStyle = '#8a6d46'; c.fillRect(bx - 5, by - 12, 10, 12); c.fillRect(bx - 6, by - 16, 12, 4); c.fillStyle = '#3a2f24'; c.fillRect(bx - 1, by - 6, 3, 3); }
        if (bnLv >= 4) { c.fillStyle = '#c8a04a'; c.fillRect(x - 12, y + 1, 24, 5); c.fillStyle = '#e2c06a'; c.fillRect(x - 12, y - 1, 24, 3); c.strokeStyle = '#8a6a2c'; c.lineWidth = 1; c.strokeRect(x - 12, y - 1, 24, 7); }
      }
      if (slot('barn') === 'golden_feeder') { c.fillStyle = '#e2c06a'; c.fillRect(x + 20, y + 1, 18, 5); c.strokeStyle = '#8a6a2c'; c.strokeRect(x + 20, y - 1, 18, 7); c.fillStyle = '#f2d88a44'; c.beginPath(); c.ellipse(x + 29, y + 2, 14, 5, 0, 0, 7); c.fill(); }
    })();

    /* 研究所（右）：L0 瓦砾 → L1 帐篷 → L2 木屋 → L3 带烟囱石屋 */
    const lbLv = blv('lab');
    (function () {
      const x = 845, y = 192;
      if (lbLv <= 0) {
        c.fillStyle = '#4e483c'; for (let i = 0; i < 6; i++) { c.beginPath(); c.ellipse(x - 18 + i * 8, y - 3 - (i % 3) * 3, 6 + (i % 2) * 3, 4 + (i % 3) * 2, .2, 0, 7); c.fill(); }
        c.strokeStyle = '#5c5346'; c.lineWidth = 2.4; c.beginPath(); c.moveTo(x - 14, y - 2); c.lineTo(x - 2, y - 13); c.stroke();
      } else {
        if (lbLv === 1) {
          P([[x - 26, y], [x, y - 30], [x + 26, y]], '#8a7a5e'); P([[x - 26, y], [x, y - 30], [x, y]], '#75684e');
          c.strokeStyle = '#5c5346'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(x, y - 30); c.lineTo(x, y); c.stroke(); c.fillStyle = '#3a2f24'; c.beginPath(); c.moveTo(x - 7, y); c.quadraticCurveTo(x, y - 10, x + 7, y); c.fill();
          LIGHTS.push([x, y - 8, 10]);
        } else {
          c.fillStyle = '#2c2a2433'; c.beginPath(); c.ellipse(x, y + 2, 32, 7, 0, 0, 7); c.fill();
          P([[x - 26, y], [x - 26, y - 26], [x + 26, y - 26], [x + 26, y]], lbLv >= 3 ? '#6e6a62' : '#6e5b46');
          P([[x - 32, y - 24], [x, y - 42], [x + 32, y - 24]], lbLv >= 3 ? '#75808a' : '#75584a'); P([[x - 32, y - 24], [x, y - 42], [x, y - 24]], '#5c4438');
          if (lbLv >= 3) { for (let i = 0; i < 5; i++) { c.fillStyle = '#5a564e'; c.fillRect(x - 24 + i * 10, y - 18 + ((i * 7) % 8), 8, 4); } }
          c.fillStyle = '#3a2f24'; c.fillRect(x - 5, y - 16, 10, 16);
          c.fillStyle = night ? '#e8b45a' : '#e0d8b833'; c.fillRect(x - 20, y - 18, 9, 9); c.strokeStyle = '#3f3229'; c.strokeRect(x - 20, y - 18, 9, 9);
          LIGHTS.push([x - 15, y - 13, 10]);
          if (lbLv >= 3) { c.fillStyle = '#5c5346'; c.fillRect(x + 16, y - 38, 7, 16); }
        }
        const si = slot('lab');
        if (si === 'star_chart') { c.save(); c.translate(x - 40, y - 4); c.strokeStyle = '#5c5346'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -14); c.stroke(); c.fillStyle = '#8a8a8a'; c.beginPath(); c.moveTo(0, -14); c.lineTo(10, -19); c.lineTo(10, -15); c.closePath(); c.fill(); c.fillStyle = '#e8e4d4'; c.beginPath(); c.arc(9, -17, 1.4, 0, 7); c.fill(); c.restore(); }
        else if (si === 'crystal_alembic') { c.save(); c.translate(x - 40, y - 2); P([[-4, 0], [4, 0], [3, -6], [1, -6], [1, -14], [-1, -14], [-1, -6], [-3, -6]], '#9ab0a8'); c.fillStyle = '#7ab0a0'; c.beginPath(); c.arc(0, -16, 2.4, 0, 7); c.fill(); c.restore(); }
        else if (si === 'oak_anvil') { c.save(); c.translate(x - 40, y - 2); P([[-7, 0], [7, 0], [5, -5], [2, -5], [9, -9], [-7, -9], [-9, -5], [-5, -5]], '#5a5a5a'); c.restore(); }
      }
    })();

    /* 农田土垄（数据驱动；作物由 _crops 统一绘制，skipCrops 时此处跳过——
     * bakeStatic 烘焙层不画作物：作物由 drawDynamic 60fps 实时层负责，保证与农田数据零延迟对应、无重影） */
    const plots = G.farmPlots || [], n = Math.min(G.unlockedPlots || 16, plots.length), cols = 8;
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / cols), col = i % cols, s = .72 + row * .09, x = 110 + col * 49 + row * 9, y = 183 + row * 26;
      const p = plots[i];
      const dry = p && ((p.moisture || 0) < 30 || p.status === 'drought');
      /* 垄体：受光棱 + 侧阴 + 湿土深浅（垫层即地基，土垄画实） */
      P([[x, y], [x + 37 * s, y - 4], [x + 43 * s, y + 9], [x + 4, y + 13]], p && p.status === 'burn' ? '#3a3026' : dry ? '#6e5a40' : '#4e3c28');
      P([[x, y], [x + 37 * s, y - 4], [x + 38 * s, y - 1], [x + 1, y + 3]], dry ? '#86704e55' : '#6a543855'); // 受光棱
      /* 垄沟 */
      c.strokeStyle = '#3a2c1c44'; c.lineWidth = 1;
      for (let k = 0; k < 4; k++) { c.beginPath(); c.moveTo(x + 6 + k * 7 * s, y + 1); c.lineTo(x + 9 + k * 7 * s, y + 10); c.stroke(); }
      if (dry && !(p && p.status === 'burn')) { /* 干裂 */
        c.strokeStyle = '#8a7a5c66'; c.lineWidth = .8;
        for (let k = 0; k < 3; k++) { const cx0 = x + 8 + k * 11 * s, cy0 = y + 4 + (k % 2) * 3; c.beginPath(); c.moveTo(cx0, cy0); c.lineTo(cx0 + 4, cy0 + 2); c.lineTo(cx0 + 7, cy0); c.stroke(); }
      }
      if (winter) { c.fillStyle = '#d8dcd455'; c.fillRect(x + 4, y - 3, 30, 3); }
      if (p && p.status === 'weeds') { /* 杂草入侵 */
        for (let k = 0; k < 4; k++) { const wx = x + 6 + k * 9 * s, wy = y + 3 + (k % 2) * 4; c.strokeStyle = '#7a8a3c'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(wx, wy + 4); c.lineTo(wx - 2, wy - 3); c.moveTo(wx, wy + 4); c.lineTo(wx + 1, wy - 4); c.moveTo(wx, wy + 4); c.lineTo(wx + 3, wy - 2); c.stroke(); }
      }
    }
    if (!(opts && opts.skipCrops)) this._crops(c, G, live ? t : 0, live, softSoil);

    /* 装饰（真实数据入画） */
    const decoPos = d => this.decoPosOf(d);
    (G.decorations || []).slice(0, 16).forEach(d => {
      const q = decoPos(d);
      if (d.id === 'scarecrow') { c.save(); c.translate(q.x, q.y); c.strokeStyle = '#4e4234'; c.lineWidth = 3; c.beginPath(); c.moveTo(0, 4); c.lineTo(0, -24); c.moveTo(-10, -16); c.lineTo(10, -16); c.stroke(); c.fillStyle = '#5c5346'; P([[-7, -24], [7, -24], [4, -6], [-4, -6]], '#6e5b40'); c.fillStyle = '#4e4234'; c.beginPath(); c.ellipse(0, -27, 9, 3.4, 0, 0, 7); c.fill(); c.restore(); }
      else if (d.id === 'fence') { for (let k = 0; k < 3; k++) { const fx = q.x + k * 14; c.fillStyle = '#6e5b40'; c.fillRect(fx, q.y - 8, 3.4, 15); P([[fx - 1, q.y - 13], [fx + 4.4, q.y - 13], [fx + 1.7, q.y - 18]], '#5c4a34'); } c.strokeStyle = '#8a8a8a55'; c.lineWidth = 1; c.beginPath(); c.moveTo(q.x - 2, q.y - 6); c.lineTo(q.x + 32, q.y - 6); c.stroke(); }
      else if (d.id === 'well') { c.save(); c.translate(q.x, q.y); c.fillStyle = '#6e6a60'; c.beginPath(); c.ellipse(0, 0, 10, 4, 0, 0, 7); c.fill(); c.fillStyle = '#4a463e'; c.beginPath(); c.ellipse(0, -1, 7, 2.6, 0, 0, 7); c.fill(); c.strokeStyle = '#5c5346'; c.lineWidth = 2; c.beginPath(); c.moveTo(-8, -2); c.lineTo(-8, -16); c.moveTo(8, -2); c.lineTo(8, -16); c.stroke(); P([[-11, -16], [11, -16], [11, -13], [-11, -13]], '#75584a'); c.strokeStyle = '#4e4234'; c.beginPath(); c.moveTo(0, -13); c.lineTo(0, -8); c.stroke(); c.fillStyle = '#8a7a5c'; c.fillRect(-2.4, -8, 4.8, 4); c.restore(); }
      else if (d.id === 'statue') { c.save(); c.translate(q.x, q.y); c.fillStyle = '#8a8a80'; P([[-8, 0], [8, 0], [6, -14], [-6, -14]], '#8a8a80'); c.beginPath(); c.arc(0, -18, 5, 0, 7); c.fill(); c.fillStyle = '#9a9a90'; c.fillRect(-3, -14, 6, 3); c.strokeStyle = '#5a5a52'; c.lineWidth = 1; c.beginPath(); c.ellipse(0, 2, 11, 3, 0, 0, 7); c.stroke(); c.restore(); }
      else if (d.id === 'flowerbed') { c.fillStyle = '#4e4436'; c.beginPath(); c.ellipse(q.x, q.y, 14, 5, 0, 0, 7); c.fill(); for (let k = 0; k < 5; k++) { c.fillStyle = ['#9a8a68', '#7a8a5c', '#8a6a5a', '#a89868', '#7a6a8a'][k]; c.beginPath(); c.arc(q.x - 8 + k * 4, q.y - 2 + (k % 2) * 2, 1.6, 0, 7); c.fill(); } }
      else if (d.id === 'windmill') { c.save(); c.translate(q.x, q.y); c.strokeStyle = '#5c5346'; c.lineWidth = 3; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -30); c.stroke(); c.translate(0, -30); c.rotate(live ? tt * .9 : 0); c.strokeStyle = '#8a7a5c'; c.lineWidth = 2; for (let k = 0; k < 4; k++) { c.rotate(Math.PI / 2); c.beginPath(); c.moveTo(0, 0); c.lineTo(14, -3); c.stroke(); } c.restore(); }
      else if (d.id === 'lamp_post') { /* 萤石路灯：木杆 + 灯笼（夜里暖光） */
        c.save(); c.translate(q.x, q.y);
        c.strokeStyle = '#4e4234'; c.lineWidth = 3; c.beginPath(); c.moveTo(0, 2); c.lineTo(0, -26); c.stroke();
        c.beginPath(); c.moveTo(0, -26); c.lineTo(7, -26); c.stroke();
        c.fillStyle = night ? '#ffd98a' : '#c8b088'; c.beginPath(); c.roundRect(3, -25, 8, 10, 2); c.fill();
        c.strokeStyle = '#5c4a34'; c.lineWidth = 1; c.strokeRect(3, -25, 8, 10);
        c.restore();
        if (night) LIGHTS.push([q.x + 7, q.y - 21, 20]);
      }
      else if (d.id === 'bonfire') { /* 篝火堆：石圈 + 原木 + 火焰（夜里大暖光） */
        c.save(); c.translate(q.x, q.y);
        c.fillStyle = '#5a5548'; for (let k = 0; k < 5; k++) { const a = k / 5 * 6.283; c.beginPath(); c.ellipse(Math.cos(a) * 9, Math.sin(a) * 3.4, 2.6, 1.8, 0, 0, 7); c.fill(); }
        c.strokeStyle = '#4a3826'; c.lineWidth = 2.6; c.beginPath(); c.moveTo(-5, 1); c.lineTo(5, -3); c.moveTo(5, 1); c.lineTo(-5, -3); c.stroke();
        const fh = night ? 10 : 6, flick = live ? Math.sin(tt * 9 + q.x) * 1.6 : 0;
        c.fillStyle = '#e8784a'; c.beginPath(); c.moveTo(-3.4, -2); c.quadraticCurveTo(-2, -fh - flick, 0, -fh - 2 - flick); c.quadraticCurveTo(2.4, -fh - flick * .6, 3.4, -2); c.closePath(); c.fill();
        c.fillStyle = '#ffd98a'; c.beginPath(); c.moveTo(-1.6, -2); c.quadraticCurveTo(0, -fh * .62 - flick * .5, 1.6, -2); c.closePath(); c.fill();
        c.restore();
        if (night) LIGHTS.push([q.x, q.y - 5, 26]);
      }
      else if (d.id === 'banner') { /* 庄园战旗：杆 + 三角旗（风里飘） */
        c.save(); c.translate(q.x, q.y);
        c.strokeStyle = '#4e4234'; c.lineWidth = 2.6; c.beginPath(); c.moveTo(0, 2); c.lineTo(0, -30); c.stroke();
        const wob = live ? Math.sin(tt * 2.2 + q.y) * 2.4 : 0;
        P([[0, -30], [18 + wob, -26], [0, -20]], '#a04a3a');
        P([[0, -28], [10 + wob * .6, -26], [0, -23]], '#c06a4a');
        c.fillStyle = '#6a5a3a'; c.beginPath(); c.arc(0, -31, 1.8, 0, 7); c.fill();
        c.restore();
      }
      else if (d.id === 'beehive') { /* 蜂箱：叠层木箱 + 蜂（白天飞舞） */
        c.save(); c.translate(q.x, q.y);
        c.fillStyle = '#8a6e42'; c.beginPath(); c.roundRect(-8, -14, 16, 15, 2); c.fill();
        c.strokeStyle = '#6a5230'; c.lineWidth = 1.2;
        for (let k = 0; k < 3; k++) { c.beginPath(); c.moveTo(-8, -10 + k * 4.6); c.lineTo(8, -10 + k * 4.6); c.stroke(); }
        P([[-10, -14], [10, -14], [6, -19], [-6, -19]], '#75584a');
        c.fillStyle = '#3a2c1a'; c.beginPath(); c.ellipse(0, -2, 2.6, 1.6, 0, 0, 7); c.fill();
        if (!night && live) { c.fillStyle = '#3a3226'; for (let k = 0; k < 2; k++) { const a = tt * 2.4 + k * 3.1; c.beginPath(); c.arc(Math.cos(a) * 12, -12 + Math.sin(a * 1.4) * 5, 1.1, 0, 7); c.fill(); } }
        c.restore();
      }
      else if (d.id === 'pumpkin_lantern') { /* 南瓜灯：刻面南瓜（夜里暖橙光） */
        c.save(); c.translate(q.x, q.y);
        c.fillStyle = '#c97a3a'; c.beginPath(); c.ellipse(0, -6, 8.4, 7, 0, 0, 7); c.fill();
        c.strokeStyle = '#8a4e22'; c.lineWidth = 1; for (let k = -1; k <= 1; k++) { c.beginPath(); c.ellipse(k * 3, -6, 2.2, 6.8, 0, 0, 7); c.stroke(); }
        c.fillStyle = '#5c4a34'; c.fillRect(-1.4, -14.4, 2.8, 3.4);
        const glow = night || (G.farmWeather && G.farmWeather.state === 'storm');
        c.fillStyle = glow ? '#ffe2a0' : '#4a3423';
        P([[-4.4, -8], [-2, -8], [-3.2, -5.6]], glow ? '#ffe2a0' : '#4a3423');
        P([[4.4, -8], [2, -8], [3.2, -5.6]], glow ? '#ffe2a0' : '#4a3423');
        P([[-3, -2.6], [3, -2.6], [0, -.6]], glow ? '#ffd98a' : '#4a3423');
        c.restore();
        if (night) LIGHTS.push([q.x, q.y - 6, 16]);
      }
      else { c.font = '16px serif'; c.fillText(d.icon || '✿', q.x, q.y); }
    });
    return LIGHTS;
  },

  /* ---------- 作物层：7 种作物专属形态 × 4 生长阶段 × 状态（干旱/焦土） ----------
   * 数据驱动核心：每帧（或每次烘焙外）按 farmPlots 实况重画，全景与农田严格对应。
   * stage: 0 幼苗(<35%) 1 成长(<80%) 2 近熟 3 成熟(ready 金色高光)。 */
  _crops(c, G, t, live, soft) {
    const plots = G.farmPlots || [], n = Math.min(G.unlockedPlots || 16, plots.length), cols = 8;
    const autumn = G.season === 'autumn', winter = G.season === 'winter';
    for (let i = 0; i < n; i++) {
      const p = plots[i];
      if (!p || !p.crop) continue;
      const row = Math.floor(i / cols), col = i % cols, s = (.72 + row * .09) * 1.34;
      const x = 110 + col * 49 + row * 9, y = 183 + row * 26;
      const prog = p.ready ? 1 : (p.crop.growTime ? Math.min(1, Math.max(0, (Date.now() - (p.plantedAt || 0)) / 1000 / p.crop.growTime)) : .5);
      const stage = p.ready ? 3 : prog < .35 ? 0 : prog < .8 ? 1 : 2;
      const sway = live ? Math.sin(t * 1.25 + i * 1.7) * (0.8 + stage * .45) : 0;
      const droop = p.status === 'drought', burnt = p.status === 'burn';
      for (let k = 0; k < 3; k++) {
        const px = x + 9 + k * 11 * s, py = y + 5;
        this._cropPlant(c, p.crop.id, px, py, s, stage, p.ready, sway + k * .35, droop, burnt, autumn, winter, i * 3 + k);
      }
    }
  },

  /* 成熟金光（独立发光层：lighter  additive，画在夜染之后——可收获信号夜晚也必须醒目） */
  _readyGlow(c, G, t) {
    const plots = G.farmPlots || [], n = Math.min(G.unlockedPlots || 16, plots.length), cols = 8;
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const p = plots[i];
      if (!p || !p.crop || !p.ready) continue;
      const row = Math.floor(i / cols), col = i % cols;
      const x = 110 + col * 49 + row * 9, y = 183 + row * 26;
      const pulse = .34 + (t ? .16 * Math.sin(t * 2.2 + i) : .1);
      const g = c.createRadialGradient(x + 22, y - 8, 2, x + 22, y - 8, 26);
      g.addColorStop(0, `rgba(240,200,100,${pulse})`);
      g.addColorStop(.55, `rgba(226,178,80,${pulse * .45})`);
      g.addColorStop(1, 'rgba(226,178,80,0)');
      c.fillStyle = g;
      c.beginPath(); c.ellipse(x + 22, y - 7, 27, 15, 0, 0, 7); c.fill();
    }
    c.restore();
  },

  _cropPlant(c, id, px, py, s, stage, ready, sway, droop, burnt, autumn, winter, seed) {
    const leaf = burnt ? '#3a3028' : droop ? '#a8985a' : autumn ? '#a5984a' : winter ? '#6e7a52' : '#67a244';
    const leafD = burnt ? '#2c241c' : droop ? '#8a7a44' : autumn ? '#8a7e3e' : winter ? '#5a6844' : '#4a8438';
    const ink = 'rgba(22,18,12,.68)';
    const gold = ready && !burnt ? '#e2bc5e' : null;
    const H = (stage === 0 ? .45 : stage === 1 ? .72 : 1) * s;   // 阶段高度系数
    const drop = droop ? 2.2 : 0;                                 // 蔫下垂
    const stem = (h, w, col) => { c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round'; c.beginPath(); c.moveTo(px, py); c.quadraticCurveTo(px + sway * .4, py - h * .55, px + sway + (drop * .8), py - h + drop); c.stroke(); };
    const leafBlade = (bx, by, ang, len, wd, col) => { c.save(); c.translate(bx, by); c.rotate(ang); c.fillStyle = col; c.beginPath(); c.ellipse(len / 2, 0, len / 2, wd, 0, 0, 7); c.fill(); c.strokeStyle = ink; c.lineWidth = .7; c.stroke(); c.restore(); };

    switch (id) {
      case 'wheat': { /* 小麦：丛生细杆 + 顶部穗粒 + 芒 */
        const h = (4.5 + stage * 3.6) * H * 2.1;
        for (let b = -1; b <= 1; b++) {
          const bx = px + b * 2.4 * s;
          c.strokeStyle = gold || leaf; c.lineWidth = 1.3 * s; c.lineCap = 'round';
          c.beginPath(); c.moveTo(bx, py); c.quadraticCurveTo(bx + sway * .5, py - h * .5, bx + sway + b * .8 + drop, py - h + drop); c.stroke();
          if (stage >= 1) { /* 穗：3-4 粒叠排 */
            const tx = bx + sway + b * .8 + drop, ty = py - h + drop;
            c.fillStyle = gold || (stage === 1 ? '#9ab86a' : '#c9a44e');
            for (let g = 0; g < (stage === 1 ? 2 : 4); g++) { c.beginPath(); c.ellipse(tx + sway * .12, ty - g * 2.2 * s, 1.15 * s, 1.9 * s, sway * .04, 0, 7); c.fill(); }
            if (stage >= 2) { c.strokeStyle = gold || '#c9b06a'; c.lineWidth = .6; for (let a = -1; a <= 1; a++) { c.beginPath(); c.moveTo(tx, ty - 7 * s); c.lineTo(tx + a * 2.6 + sway * .3, ty - 11 * s); c.stroke(); } }
          }
        }
        break; }
      case 'corn': { /* 玉米：主杆 + 长叶对生 + 侧棒 */
        const h = (6 + stage * 5.4) * H * 2.2;
        stem(h, 1.7 * s, gold || leaf);
        if (stage >= 1) {
          leafBlade(px + sway * .3, py - h * .42, -2.5, 8.5 * s, 1.9 * s, leaf);
          leafBlade(px + sway * .4, py - h * .58, -.6, 8 * s, 1.8 * s, leafD);
          if (stage >= 2) leafBlade(px + sway * .5, py - h * .72, -2.2, 7 * s, 1.6 * s, leaf);
        }
        if (stage >= 2) { /* 玉米棒 */
          const ex = px + sway * .6 + 2.6 * s, ey = py - h * .52;
          c.fillStyle = gold || '#a8bc62'; c.beginPath(); c.ellipse(ex, ey, 1.9 * s, 3.4 * s, .5, 0, 7); c.fill();
          c.strokeStyle = ink; c.lineWidth = .7; c.stroke();
          if (ready) { c.fillStyle = '#f2d06a'; c.beginPath(); c.ellipse(ex, ey, 1.2 * s, 2.4 * s, .5, 0, 7); c.fill(); }
        }
        if (ready) { c.strokeStyle = '#8a6a3c'; c.lineWidth = .8; const tx = px + sway + drop, ty = py - h; for (let a = -1; a <= 1; a++) { c.beginPath(); c.moveTo(tx, ty); c.lineTo(tx + a * 2, ty - 3.4); c.stroke(); } }
        break; }
      case 'carrot': { /* 胡萝卜：羽状叶丛扇展，成熟露橙尖 */
        const h = (4 + stage * 2.6) * H * 2;
        for (let b = -2; b <= 2; b++) {
          const ang = -Math.PI / 2 + b * .34 + sway * .05;
          const len = h * (1 - Math.abs(b) * .14);
          c.strokeStyle = gold || (b % 2 ? leaf : leafD); c.lineWidth = 1.25 * s; c.lineCap = 'round';
          c.beginPath(); c.moveTo(px, py); c.quadraticCurveTo(px + Math.cos(ang) * len * .6, py + Math.sin(ang) * len * .6, px + Math.cos(ang) * len + sway, py + Math.sin(ang) * len + drop); c.stroke();
        }
        if (ready) { c.fillStyle = '#e07f34'; c.beginPath(); c.moveTo(px - 1.6, py + 1); c.lineTo(px + 1.6, py + 1); c.lineTo(px, py - 3.4 * s); c.closePath(); c.fill(); }
        break; }
      case 'pumpkin': { /* 南瓜：匍匐藤 + 掌状叶 + 橙果 */
        c.strokeStyle = leafD; c.lineWidth = 1.2 * s; c.lineCap = 'round';
        c.beginPath(); c.moveTo(px - 6 * s, py + 1); c.quadraticCurveTo(px - 2 * s, py - 2.4, px + 2 * s, py + .6); c.quadraticCurveTo(px + 4 * s, py + 2, px + 7 * s, py); c.stroke();
        leafBlade(px - 2.4 * s, py - 1, -2.2, 5.4 * s, 2.6 * s, leaf);
        if (stage >= 1) leafBlade(px + 3.2 * s, py - 1.4, -.9, 5 * s, 2.4 * s, leaf);
        if (stage >= 2) { /* 果 */
          const fx = px + sway * .3, fy = py - 3.4 * s, fr = (2.6 + (ready ? 1.6 : 0)) * s;
          c.fillStyle = burnt ? '#3a3028' : ready ? '#e07f2e' : '#8aa04e';
          c.beginPath(); c.ellipse(fx, fy, fr, fr * .82, 0, 0, 7); c.fill();
          c.strokeStyle = ink; c.lineWidth = .7; c.stroke();
          c.strokeStyle = 'rgba(26,22,14,.3)'; for (let g2 = -1; g2 <= 1; g2++) { c.beginPath(); c.moveTo(fx + g2 * fr * .5, fy - fr * .7); c.quadraticCurveTo(fx + g2 * fr * .62, fy, fx + g2 * fr * .5, fy + fr * .68); c.stroke(); }
          c.strokeStyle = '#5c4a2c'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(fx, fy - fr * .8); c.lineTo(fx + 1, fy - fr * 1.25); c.stroke();
        }
        break; }
      case 'watermelon': { /* 西瓜：藤 + 纵纹深绿果 */
        c.strokeStyle = leafD; c.lineWidth = 1.1 * s; c.lineCap = 'round';
        c.beginPath(); c.moveTo(px - 5.4 * s, py + 1); c.quadraticCurveTo(px, py - 2.6, px + 5 * s, py + .4); c.stroke();
        leafBlade(px - 2 * s, py - 1.2, -2.3, 5 * s, 2.2 * s, leaf);
        if (stage >= 2) {
          const fx = px + 1.6 * s + sway * .3, fy = py - 3 * s, fr = (2.4 + (ready ? 1.5 : 0)) * s;
          c.fillStyle = burnt ? '#3a3028' : ready ? '#3e7a3a' : '#6a9a52';
          c.beginPath(); c.ellipse(fx, fy, fr, fr * .86, 0, 0, 7); c.fill();
          c.strokeStyle = ink; c.lineWidth = .7; c.stroke();
          c.strokeStyle = ready ? '#7ab55a' : '#8ab068'; c.lineWidth = .9;
          for (let g2 = -1; g2 <= 1; g2++) { c.beginPath(); c.moveTo(fx + g2 * fr * .55, fy - fr * .75); c.quadraticCurveTo(fx + g2 * fr * .7 + 1, fy, fx + g2 * fr * .55, fy + fr * .75); c.stroke(); }
        }
        break; }
      case 'cabbage': { /* 卷心菜：三层叠叶球 */
        const r0 = (2.8 + stage * 1.9) * H * 1.55;
        c.fillStyle = leafD; c.beginPath(); c.ellipse(px, py - r0 * .7, r0 * 1.15, r0 * .78, 0, 0, 7); c.fill();
        c.strokeStyle = ink; c.lineWidth = .7; c.stroke();
        c.fillStyle = leaf; c.beginPath(); c.ellipse(px + sway * .3, py - r0 * .95, r0 * .88, r0 * .62, 0, 0, 7); c.fill(); c.stroke();
        c.fillStyle = burnt ? '#4a4038' : ready ? '#a8cf7e' : '#8fbc68';
        c.beginPath(); c.ellipse(px + sway * .45, py - r0 * 1.14, r0 * .58, r0 * .44, 0, 0, 7); c.fill(); c.stroke();
        c.strokeStyle = 'rgba(26,22,14,.28)'; c.beginPath(); c.moveTo(px - r0 * .8, py - r0 * .9); c.quadraticCurveTo(px, py - r0 * .4, px + r0 * .8, py - r0 * .9); c.stroke();
        break; }
      case 'sunflower': { /* 向日葵：高杆 + 花盘（棕心黄瓣） */
        const h = (6.5 + stage * 6) * H * 2.15;
        stem(h, 1.5 * s, leafD);
        if (stage >= 1) { leafBlade(px + sway * .3, py - h * .4, -2.4, 6.4 * s, 1.8 * s, leaf); leafBlade(px + sway * .45, py - h * .58, -.7, 5.6 * s, 1.6 * s, leaf); }
        if (stage >= 2) {
          const fx = px + sway + drop, fy = py - h + drop, fr = (2.4 + (ready ? 1 : 0)) * s;
          if (ready && !burnt) { c.fillStyle = '#e8b83c'; for (let ptl = 0; ptl < 8; ptl++) { const a = ptl * Math.PI / 4; c.beginPath(); c.ellipse(fx + Math.cos(a) * fr * 1.05, fy + Math.sin(a) * fr * 1.05, fr * .52, fr * .3, a, 0, 7); c.fill(); } }
          c.fillStyle = burnt ? '#3a3028' : ready ? '#7a5226' : '#9aa062';
          c.beginPath(); c.arc(fx, fy, fr, 0, 7); c.fill();
          c.strokeStyle = ink; c.lineWidth = .7; c.stroke();
        }
        break; }
      default: { /* 未知作物：通用三叶苗 */
        const h = (4 + stage * 3) * H * 2;
        stem(h, 1.3 * s, gold || leaf);
        leafBlade(px + sway * .3, py - h * .5, -2.3, 5 * s, 1.7 * s, leaf);
        leafBlade(px + sway * .4, py - h * .6, -.7, 5 * s, 1.7 * s, leafD);
      }
    }
    if (ready && !burnt) { /* 成熟株金边提亮 */
      c.fillStyle = 'rgba(232,196,106,.28)';
      c.beginPath(); c.ellipse(px + sway * .5, py - 6 * s, 4.6 * s, 5.4 * s, 0, 0, 7); c.fill();
    }
  },

  /* ---------- 调色：时段 × 季节 × 天气（画在精灵之上、天体之下） ----------
   * baseOk=false（旧程序化环境）时：环境自带时段色 → 跳过时段调色，仅轻压暗，避免双重染色。 */
  _grade(c, G, night, dusk, dawn, baseOk) {
    const season = G.season || 'spring';
    const ev0 = (G.econ && G.econ.eventLog && G.econ.eventLog[0]) || null;
    const stormEv = !!(ev0 && (Date.now() - ev0.at) / 1000 < 45 && ev0.id === 'storm');
    c.save();
    if (baseOk) {
      if (night) {
        /* v5.8.12 夜色重制（星露谷式）：拒绝抽饱和——改用「蓝紫偏色 multiply 提亮 + soft-light 冷调 + 月光洒地带」
         * 旧 multiply #3d4658 + saturation 0.35 把底图抽成死灰；新曲线保留底图明暗对比与色彩鲜活度 */
        c.globalCompositeOperation = 'multiply';
        const g = c.createLinearGradient(0, 0, 0, 300);
        g.addColorStop(0, '#5a6a8c');            /* 天空：深蓝紫（够亮，保底图对比） */
        g.addColorStop(.45, '#5a5f7e');          /* 中景：蓝灰偏紫 */
        g.addColorStop(1, '#4e4a56');            /* 近地：暖灰紫（暗示地面余温） */
        c.fillStyle = g; c.fillRect(0, 0, 900, 300);
        c.globalCompositeOperation = 'saturation';
        c.fillStyle = 'rgba(128,128,128,.12)'; c.fillRect(0, 0, 900, 300);   /* 只抽 12%（旧 35%） */
        /* 冷调薄纱：soft-light 蓝青，统一色温但不吃对比 */
        c.globalCompositeOperation = 'soft-light';
        const g2 = c.createLinearGradient(0, 0, 0, 300);
        g2.addColorStop(0, '#7f9fd4'); g2.addColorStop(1, '#8a86b8');
        c.fillStyle = g2; c.fillRect(0, 0, 900, 300);
        /* 血月洒地带（红）：从月亮(约 x=690)斜向左下的椭圆径向光斑——边缘自然羽化 */
        c.globalCompositeOperation = 'screen';
        c.save();
        c.translate(660, 110); c.rotate(.30); c.scale(1, 2.1);
        const mg = c.createRadialGradient(0, 0, 20, 0, 0, 190);
        mg.addColorStop(0, 'rgba(240,120,84,.16)'); mg.addColorStop(.55, 'rgba(220,100,80,.08)'); mg.addColorStop(1, 'rgba(200,80,70,0)');
        c.fillStyle = mg; c.fillRect(-200, -110, 400, 220);
        c.restore();
        /* 地平线血月辉（远山与夜空的接缝光） */
        const hz = c.createLinearGradient(0, 128, 0, 186);
        hz.addColorStop(0, 'rgba(216,110,90,0)'); hz.addColorStop(.6, 'rgba(216,110,90,.10)'); hz.addColorStop(1, 'rgba(216,110,90,0)');
        c.fillStyle = hz; c.fillRect(0, 128, 900, 58);
      } else if (dusk) {
        c.globalCompositeOperation = 'multiply';
        const g = c.createLinearGradient(0, 0, 0, 300);
        g.addColorStop(0, '#b08a6a'); g.addColorStop(.5, '#c09a6c'); g.addColorStop(1, '#a88a62');
        c.fillStyle = g; c.fillRect(0, 0, 900, 300);
        c.globalCompositeOperation = 'overlay';
        const g2 = c.createLinearGradient(0, 60, 0, 200);
        g2.addColorStop(0, 'rgba(255,140,60,0)'); g2.addColorStop(.6, 'rgba(255,140,60,.20)'); g2.addColorStop(1, 'rgba(255,120,40,0)');
        c.fillStyle = g2; c.fillRect(0, 60, 900, 140);
      } else if (dawn) {
        c.globalCompositeOperation = 'multiply';
        const g = c.createLinearGradient(0, 0, 0, 300);
        g.addColorStop(0, '#a898a0'); g.addColorStop(.5, '#b8a494'); g.addColorStop(1, '#9a9484');
        c.fillStyle = g; c.fillRect(0, 0, 900, 300);
        c.globalCompositeOperation = 'overlay';
        const g2 = c.createLinearGradient(0, 60, 0, 200);
        g2.addColorStop(0, 'rgba(255,160,150,0)'); g2.addColorStop(.6, 'rgba(255,160,150,.16)'); g2.addColorStop(1, 'rgba(255,140,130,0)');
        c.fillStyle = g2; c.fillRect(0, 60, 900, 140);
      } else {
        /* v5.8.12 白天重制 v2：底图是黄昏光 → screen 分区提亮（天空加蓝、地面暖白）+ 极浅冷化 multiply
         * 教训：重 multiply 会把暖金压灰；白天=黄昏底图提亮，保饱和 */
        c.globalCompositeOperation = 'screen';
        const g = c.createLinearGradient(0, 0, 0, 300);
        g.addColorStop(0, 'rgba(140,175,235,.34)');   /* 天空：加蓝提亮成白日蓝天 */
        g.addColorStop(.42, 'rgba(225,232,242,.16)'); /* 远山：中性提亮 */
        g.addColorStop(1, 'rgba(250,244,228,.26)');   /* 近地：暖白提亮成日光 */
        c.fillStyle = g; c.fillRect(0, 0, 900, 300);
        c.globalCompositeOperation = 'multiply';
        c.fillStyle = 'rgba(238,236,244,1)'; c.fillRect(0, 0, 900, 300);   /* 极浅冷白收色温 */
        c.globalCompositeOperation = 'soft-light';
        c.fillStyle = 'rgba(255,236,196,.12)'; c.fillRect(0, 0, 900, 300);  /* 阳光暖意 */
      }
    } else if (night) {
      /* 旧环境已带夜色 → 仅补一层轻压暗（v2 等效） */
      c.fillStyle = 'rgba(26,29,36,.26)'; c.fillRect(0, 0, 900, 300);
    }
    if (season === 'winter') {
      c.globalCompositeOperation = 'saturation';
      c.fillStyle = 'rgba(128,128,128,.30)'; c.fillRect(0, 0, 900, 300);
      c.globalCompositeOperation = 'screen';
      const g = c.createLinearGradient(0, 130, 0, 300);
      g.addColorStop(0, 'rgba(215,225,238,0)'); g.addColorStop(1, 'rgba(215,225,238,.30)');
      c.fillStyle = g; c.fillRect(0, 130, 900, 170);
    } else if (season === 'autumn') {
      c.globalCompositeOperation = 'overlay';
      c.fillStyle = 'rgba(200,140,60,.14)'; c.fillRect(0, 0, 900, 300);
    } else if (season === 'spring') {
      c.globalCompositeOperation = 'overlay';
      c.fillStyle = 'rgba(120,170,100,.06)'; c.fillRect(0, 0, 900, 300);
    }
    if (stormEv) {
      c.globalCompositeOperation = 'multiply';
      c.fillStyle = 'rgba(120,124,128,.55)'; c.fillRect(0, 0, 900, 300);
    }
    c.globalCompositeOperation = 'source-over';
    c.restore();
  },

  /* ---------- 天体：夜（月+星）/ 白天黄昏（太阳）—— 画在调色之上 ---------- */
  _celestial(c, night, dusk, dawn, t) {
    c.save();
    if (night) {
      const tw = Math.sin((t || 0) * 1.2);
      /* v5.8.12 月亮重制：双层光晕（内亮外散）+ 月光白核 + 陨坑阴影 */
      c.globalCompositeOperation = 'lighter';
      const halo2 = c.createRadialGradient(705, 55, 10, 705, 55, 105);
      /* v5.8.13 血月：废土世界观的红月亮——暗红月晕 + 橙红月核 + 暗斑，星空保持冷白对比 */
      halo2.addColorStop(0, 'rgba(232,110,84,.40)'); halo2.addColorStop(.4, 'rgba(206,84,66,.15)'); halo2.addColorStop(1, 'rgba(190,70,60,0)');
      c.fillStyle = halo2; c.fillRect(705 - 110, 55 - 110, 220, 220);
      c.globalCompositeOperation = 'source-over';
      c.fillStyle = '#e86a4a'; c.beginPath(); c.arc(705, 55, 12 + tw * .4, 0, 7); c.fill();
      c.fillStyle = '#f2986e'; c.beginPath(); c.arc(700, 50, 3.4, 0, 7); c.fill();   /* 左上受光面更亮 */
      c.fillStyle = '#b8442e'; c.beginPath(); c.arc(710, 52, 3.2, 0, 7); c.fill(); c.beginPath(); c.arc(700, 59, 2.2, 0, 7); c.fill(); c.beginPath(); c.arc(706, 62, 1.4, 0, 7); c.fill();
      /* 星空：双层（小星铺底 + 亮星带十字光），避开月亮光晕区 */
      for (let i = 0; i < 110; i++) {
        const x = (i * 173.3 + 41) % 900, y = (i * 97.7 + 13) % 96;
        if (Math.hypot(x - 705, y - 55) < 42) continue;
        c.fillStyle = (i % 4 === 0) ? 'rgba(236,240,250,.9)' : (i % 3 === 0) ? 'rgba(226,232,246,.55)' : 'rgba(216,224,240,.30)';
        const s = (i % 7 === 0) ? 2.1 : 1.4;
        c.fillRect(x, y, s, s);
      }
      for (let i = 0; i < 7; i++) {
        const x = (i * 251 + 133) % 880 + 10, y = (i * 53 + 29) % 80 + 6;
        if (Math.hypot(x - 705, y - 55) < 52) continue;
        c.strokeStyle = 'rgba(226,234,250,.4)'; c.lineWidth = 1;
        c.beginPath(); c.moveTo(x - 4, y); c.lineTo(x + 4, y); c.moveTo(x, y - 4); c.lineTo(x, y + 4); c.stroke();
      }
    } else {
      const sy = dusk ? 68 : 55;
      c.globalCompositeOperation = 'lighter';
      const sun = c.createRadialGradient(705, sy, 3, 705, sy, dusk ? 66 : 58);
      sun.addColorStop(0, dusk ? '#f2c98a' : '#efe8d2'); sun.addColorStop(.25, dusk ? '#e0a86699' : '#d9d2be88'); sun.addColorStop(1, '#d9d2be00');
      c.fillStyle = sun; c.fillRect(630, 0, 150, 125);
      c.globalCompositeOperation = 'source-over';
      c.fillStyle = dusk ? '#f2c98a' : '#e9e4d3cc'; c.beginPath(); c.arc(705, sy, 11, 0, 7); c.fill();
    }
    c.restore();
  },

  /* ---------- 夜窗暖光（additive 辉光 + 灯块） ---------- */
  _nightLights(c, LIGHTS) {
    c.save();
    LIGHTS.forEach(([lx, ly, r]) => {
      c.globalCompositeOperation = 'lighter';
      const gr = c.createRadialGradient(lx, ly, 1, lx, ly, r * 1.6);
      gr.addColorStop(0, 'rgba(232,180,90,.38)'); gr.addColorStop(1, 'rgba(232,180,90,0)');
      c.fillStyle = gr; c.fillRect(lx - r * 1.8, ly - r * 1.8, r * 3.6, r * 3.6);
      c.globalCompositeOperation = 'source-over';
      c.fillStyle = '#f2c46a'; c.fillRect(lx - 5, ly - 5, 10, 9);
    });
    c.restore();
  },

  /* ---------- 电影统一层：颗粒 + 暗角 + 地平线霾（把精灵揉进底图） ---------- */
  _filmic(c) {
    if (!this._grainC) {
      const g = document.createElement('canvas'); g.width = 96; g.height = 96;
      const gc = g.getContext('2d');
      const im = gc.createImageData(96, 96);
      for (let i = 0; i < im.data.length; i += 4) { const v = 108 + (Math.random() * 40 | 0); im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
      gc.putImageData(im, 0, 0);
      this._grainC = g;
    }
    c.save();
    c.globalCompositeOperation = 'overlay';
    c.globalAlpha = .16;
    for (let y = 0; y < 300; y += 96) for (let x = 0; x < 900; x += 96) c.drawImage(this._grainC, x, y);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    const hz = c.createLinearGradient(0, 78, 0, 150);
    hz.addColorStop(0, 'rgba(206,178,132,0)'); hz.addColorStop(.55, 'rgba(206,178,132,.10)'); hz.addColorStop(1, 'rgba(206,178,132,0)');
    c.fillStyle = hz; c.fillRect(0, 78, 900, 72);
    const vg = c.createRadialGradient(450, 150, 160, 450, 150, 520);
    vg.addColorStop(0, 'rgba(8,10,8,0)'); vg.addColorStop(1, 'rgba(8,10,8,.24)');
    c.fillStyle = vg; c.fillRect(0, 0, 900, 300);
    c.restore();
  },

  /* ---------- 动态元素（波光/乌鸦/炊烟/鸡/蜂/风车/作物/事件/雾） ----------
   * opts.skipCrops: draw() 全量路径已画过作物 */
  _dynamic(c, G, t, opts) {
    const skipCrops = !!(opts && opts.skipCrops);
    const P = this._P(c);
    const winter = G.season === 'winter', autumn = G.season === 'autumn';
    const bl = G.buildings || {}, blv = id => (bl[id] && bl[id].level) || 0;
    const crowFly = (cx, cy) => { c.strokeStyle = '#2e2c26'; c.lineWidth = 1.6; const f = Math.sin(t * 7 + cx) * 3; c.beginPath(); c.moveTo(cx - 6, cy - f); c.quadraticCurveTo(cx - 2, cy - 2, cx, cy); c.quadraticCurveTo(cx + 2, cy - 2, cx + 6, cy - f); c.stroke(); };
    /* 水面波光（v5.8.5 适配新底图河流：右下 S 弯） */
    const _ph = this.phaseOf(), _night = _ph.night, _duskP = _ph.dusk;
    c.strokeStyle = _night ? '#aebfe0aa' : '#9fb5ad44'; c.lineWidth = 1;
    for (let i = 0; i < 12; i++) { const y = 218 + i * 6.5, x = 692 + (y - 218) * .58 + Math.sin(t * .5 + i) * 3; c.beginPath(); c.moveTo(x, y); c.lineTo(x + 13 + i * .5, y); c.stroke(); }
    if (_night) {
      /* 血月水面碎片：河面沿月光方向的抖动红亮斑群（lighter 模式） */
      c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 22; i++) {
        const y = 216 + (i * 7.3) % 78;
        const x = 688 + (y - 216) * .58 + Math.sin(t * 1.1 + i * 2.7) * 10 + ((i * 31) % 26) - 13;
        const a = .10 + .14 * Math.max(0, Math.sin(t * 1.7 + i * 1.9));
        c.fillStyle = `rgba(240,130,96,${a.toFixed(3)})`;
        c.beginPath(); c.ellipse(x, y, 4.5 + (i % 3) * 2.2, 1.1, 0, 0, 7); c.fill();
      }
      c.globalCompositeOperation = 'source-over';
      /* 田野萤火虫：8 只黄绿光点在农田上空飘忽（呼吸明灭） */
      for (let i = 0; i < 8; i++) {
        const fx = 90 + (i * 61.7) % 380 + Math.sin(t * .4 + i * 1.7) * 34;
        const fy = 196 + (i * 37.3) % 72 + Math.cos(t * .55 + i * 2.3) * 17;
        const a = Math.max(0, Math.sin(t * 1.1 + i * 2.9));
        if (a < .12) continue;
        c.globalCompositeOperation = 'lighter';
        const fg = c.createRadialGradient(fx, fy, 0, fx, fy, 6);
        fg.addColorStop(0, `rgba(212,255,150,${(a * .8).toFixed(3)})`); fg.addColorStop(1, 'rgba(212,255,150,0)');
        c.fillStyle = fg; c.fillRect(fx - 6, fy - 6, 12, 12);
        c.fillStyle = `rgba(240,255,200,${a.toFixed(3)})`;
        c.beginPath(); c.arc(fx, fy, 1.2, 0, 7); c.fill();
        c.globalCompositeOperation = 'source-over';
      }
    }
    /* 环境乌鸦 */
    for (let i = 0; i < 3; i++) { const cx = (t * 14 + i * 260) % (1050) - 60, cy = 52 + i * 17 + Math.sin(t * .8 + i * 2) * 6; crowFly(cx, cy); }
    /* 炊烟：主屋（3s 节律） */
    { const ph = t % 3; for (let k = 0; k < 3; k++) { const a = Math.max(0, 1 - ph / 2.6 - k * .22); if (a > 0) { c.fillStyle = '#9a917d' + (((a * 52) | 0) < 16 ? '10' : ((a * 52) | 0).toString(16).padStart(2, '0')); c.beginPath(); c.arc(480 + Math.sin(t * .6 + k) * 4 + k * 3, 67 - k * 9, 4 + k * 2, 0, 7); c.fill(); } } }
    /* 炊烟：研究所烟囱（L3+） */
    if (blv('lab') >= 3) { const x = 845, y = 192; const ph = t % 2.8; for (let k = 0; k < 2; k++) { const a = Math.max(0, 1 - ph / 2.4 - k * .3); if (a > 0) { c.fillStyle = '#9a917d' + (((a * 44) | 0) < 16 ? '10' : ((a * 44) | 0).toString(16).padStart(2, '0')); c.beginPath(); c.arc(x + 19 + Math.sin(t * .5 + k) * 3, y - 42 - k * 8, 3 + k * 1.6, 0, 7); c.fill(); } } }
    /* 鸡群（L2+）与蜂群（L3+） */
    const bnLv = blv('barn');
    if (bnLv >= 2) { const x = 118, y = 196;
      for (let i = 0; i < 2; i++) { const cx = x - 16 + Math.sin(t * .3 + i * 2.2) * 16, cy = y - 2 - (i % 2) * 3, peck = Math.sin(t * 2.4 + i * 1.7) > .55;
        c.fillStyle = '#9a8a6e'; c.beginPath(); c.ellipse(cx, cy, 6, 4.4, 0, 0, 7); c.fill();
        c.fillStyle = '#7a6a52'; c.beginPath(); c.arc(cx + (peck ? 7 : 6), cy - (peck ? 2 : 4), 2.6, 0, 7); c.fill();
        c.fillStyle = '#a03c2c'; c.beginPath(); c.arc(cx + (peck ? 9 : 8), cy - (peck ? 1 : 4), 1.2, 0, 7); c.fill();
        c.strokeStyle = '#6a5c46'; c.lineWidth = 1; c.beginPath(); c.moveTo(cx - 2, cy + 4); c.lineTo(cx - 2, cy + 7); c.moveTo(cx + 2, cy + 4); c.lineTo(cx + 2, cy + 7); c.stroke(); } }
    if (bnLv >= 3) { const bx = 118 + 44, by = 196 - 4; for (let i = 0; i < 3; i++) { const ang = t * 2 + i * 2.1; c.fillStyle = '#d9b455'; c.beginPath(); c.arc(bx + Math.cos(ang) * 8, by - 10 + Math.sin(ang) * 6, 1.3, 0, 7); c.fill(); } }
    /* 作物摇摆（skipCrops 时由全量路径负责）—— v5.8.5 统一走 _crops 形态系统 */
    if (!skipCrops) this._crops(c, G, t, true, true);
    /* 乌鸦落稻草人（12s 循环） */
    const scDeco = (G.decorations || []).find(d => d.id === 'scarecrow');
    if (scDeco) { const sc = this.decoPosOf(scDeco), ph = t % 12;
      if (ph < 4) { crowFly(sc.x - 80 + ph * 20, 100 + ph * 14); }
      else if (ph < 9) { const cx = sc.x - 6, cy = sc.y - 16; c.fillStyle = '#2e2c26'; c.beginPath(); c.ellipse(cx, cy, 4.5, 3, 0, 0, 7); c.fill(); c.beginPath(); c.arc(cx + 4, cy - 2, 2, 0, 7); c.fill(); c.strokeStyle = '#2e2c26'; c.lineWidth = 1; c.beginPath(); c.moveTo(cx - 2, cy + 2); c.lineTo(cx - 5, cy + 5); c.stroke(); }
      else { crowFly(sc.x - 6 + (ph - 9) * 16, sc.y - 16 - (ph - 9) * 10); } }
    /* W5 事件入画 */
    const ev0 = (G.econ && G.econ.eventLog && G.econ.eventLog[0]) || null;
    const evAge = ev0 ? (Date.now() - ev0.at) / 1000 : 1e9;
    if (ev0 && evAge < 45) {
      if (ev0.id === 'storm') {
        c.fillStyle = '#2e3236cc'; for (let i = 0; i < 7; i++) { c.beginPath(); c.ellipse(80 + i * 130, 30 + (i % 3) * 14, 66, 20, 0, 0, 7); c.fill(); }
        c.fillStyle = '#26302e30'; c.fillRect(0, 0, 900, 300);
        if (Math.sin(evAge * 7) > .92) { c.fillStyle = '#f2eede30'; c.fillRect(0, 0, 900, 300); }
      } else if (ev0.id === 'boars') {
        for (let b = 0; b < 2; b++) { const bx = -60 + ((evAge * 230 + b * 90) % 700), by = 228 + b * 12; c.fillStyle = '#2c2620';
          c.beginPath(); c.ellipse(bx, by, 17, 9, -.06, 0, 7); c.fill(); c.beginPath(); c.arc(bx + 16, by - 4, 6, 0, 7); c.fill();
          c.strokeStyle = '#2c2620'; c.lineWidth = 2.6; c.beginPath(); c.moveTo(bx - 14, by + 6); c.lineTo(bx - 17, by + 12); c.moveTo(bx + 8, by + 7); c.lineTo(bx + 7, by + 13); c.moveTo(bx + 16, by + 6); c.lineTo(bx + 18, by + 12); c.stroke();
          c.fillStyle = '#4e463c'; c.beginPath(); c.moveTo(bx + 21, by - 7); c.lineTo(bx + 26, by - 10); c.lineTo(bx + 24, by - 4); c.closePath(); c.fill();
          c.fillStyle = '#4e463c44'; for (let k = 0; k < 3; k++) { c.beginPath(); c.arc(bx - 24 - k * 8, by + 8 - k * 3, 3 + k, 0, 7); c.fill(); } }
      } else if (ev0.id === 'locusts') {
        c.fillStyle = '#a8903226'; c.beginPath(); c.ellipse(300, 215, 190, 52, 0, 0, 7); c.fill();
        for (let i = 0; i < 46; i++) { const x = 130 + ((i * 37) % 370) + Math.sin(t * 3 + i) * 9, y = 180 + ((i * 23) % 72) + Math.cos(t * 2.6 + i * 1.3) * 7; c.fillStyle = i % 3 ? '#c8a832' : '#a8882a'; c.fillRect(x, y, 1.8, 1.8); c.strokeStyle = '#c8a83233'; c.lineWidth = 1; c.beginPath(); c.moveTo(x, y); c.lineTo(x + 2, y - 1.4); c.stroke(); } }
    }
    /* 雾带 */
    const weather = (G.farmWeather && G.farmWeather.state) || G.weather;
    if (weather === 'fog') { const fog = c.createLinearGradient(0, 85, 0, 250); fog.addColorStop(0, '#a8a49600'); fog.addColorStop(.55, '#a8a49688'); fog.addColorStop(1, '#a8a49622'); c.fillStyle = fog; c.fillRect(0, 85, 900, 165); }
  },

  /* ---------- 2D 回退雨雪（Pixi 不可用时） ---------- */
  _weather2d(c, G, t) {
    const weather = (G.farmWeather && G.farmWeather.state) || G.weather;
    if (['rain', 'heavy_rain', 'storm'].includes(weather)) { c.fillStyle = '#2a2e2c38'; c.fillRect(0, 0, 900, 300); c.strokeStyle = '#b8c4c24d'; c.lineWidth = .8; for (let i = 0; i < 65; i++) { const x = (i * 113 + t * 95) % 900, y = (i * 57 + t * 160) % 300; c.beginPath(); c.moveTo(x, y); c.lineTo(x - 2, y + 9); c.stroke(); } }
    if (G.season === 'winter') { c.fillStyle = '#d8dcd466'; for (let i = 0; i < 90; i++) { const x = (i * 97 + t * 22) % 920 - 10, y = (i * 53 + t * 40) % 300; c.fillRect(x, y, 2, 2); } }
  },

  /* ==================== 对外入口（v2 兼容） ==================== */

  /* 2D 全量路径（10fps 回退） */
  draw(c, W, H, t) {
    c.save(); c.scale(W / 900, H / 300);
    const G = GameState, winter = G.season === 'winter', autumn = G.season === 'autumn';
    const { night, dusk, dawn } = this.phaseOf();
    const baseOk = this._env(c, G, winter, autumn, night, dusk, dawn, t);
    const LIGHTS = this._sprites(c, G, t, { live: true, softSoil: baseOk });
    this._dynamic(c, G, t, { skipCrops: true });
    this._grade(c, G, night, dusk, dawn, baseOk);
    if (baseOk) this._celestial(c, night, dusk, dawn, t);  /* 天体在调色之后保持亮度 */
    this._readyGlow(c, G, t);   /* 成熟金光 additive，调色之后 */
    if (night) this._nightLights(c, LIGHTS);
    else LIGHTS.forEach(([lx, ly, r]) => { c.globalCompositeOperation = 'lighter'; const gr = c.createRadialGradient(lx, ly, 1, lx, ly, r); gr.addColorStop(0, 'rgba(232,180,90,.16)'); gr.addColorStop(1, 'rgba(232,180,90,0)'); c.fillStyle = gr; c.fillRect(lx - r, ly - r, r * 2, r * 2); c.globalCompositeOperation = 'source-over'; });
    this._weather2d(c, G, t);
    this._filmic(c);
    c.restore();
  },

  /* 静态烘焙（FarmPixi 底纹理） */
  bakeStatic() {
    if (!this._bakeC) { this._bakeC = document.createElement('canvas'); this._bakeC.width = 900; this._bakeC.height = 300; }
    const c = this._bakeC.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, 900, 300);
    const G = GameState, winter = G.season === 'winter', autumn = G.season === 'autumn';
    const { night, dusk, dawn } = this.phaseOf();
    const baseOk = this._env(c, G, winter, autumn, night, dusk, dawn, 0);
    /* 烘焙层不画作物：作物由 drawDynamic 60fps 实时层绘制（农田数据变化立即入画、无静态重影） */
    const LIGHTS = this._sprites(c, G, 0, { live: false, softSoil: baseOk, skipCrops: true });
    this._grade(c, G, night, dusk, dawn, baseOk);
    if (baseOk) this._celestial(c, night, dusk, dawn, 0);
    if (night) this._nightLights(c, LIGHTS);
    this._filmic(c);
    return { canvas: this._bakeC, lights: LIGHTS, night };
  },

  /* 60fps 动态叠加层 */
  drawDynamic(c, W, H, t) {
    c.save(); c.scale(W / 900, H / 300);
    const G = GameState;
    const { night } = this.phaseOf();
    this._dynamic(c, G, t, { skipCrops: false });
    /* 时段/季节轻调色：只染已画出的精灵（source-atop）；夜染压重些——作物夜间不该鲜绿发光 */
    if (night) { c.globalCompositeOperation = 'source-atop'; c.fillStyle = 'rgba(30,34,44,.55)'; c.fillRect(0, 0, 900, 300); }
    else if (G.season === 'winter') { c.globalCompositeOperation = 'source-atop'; c.fillStyle = 'rgba(200,214,228,.14)'; c.fillRect(0, 0, 900, 300); }
    else if (G.season === 'autumn') { c.globalCompositeOperation = 'source-atop'; c.fillStyle = 'rgba(200,150,70,.08)'; c.fillRect(0, 0, 900, 300); }
    c.globalCompositeOperation = 'source-over';
    this._readyGlow(c, G, t);   /* 成熟金光 additive，夜染之后画——可收获信号不被压暗 */
    c.restore();
  }
};
