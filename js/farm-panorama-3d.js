/* ================= 家园全景 · 3D 模块（v1，2026-10-21） =================
 * 用 three.js 把家园全景改成真正的 3D 场景：
 *   地形（耕地垄沟）→ 16 块地 × 3D 作物（按 farmPlots 实况）→ 建筑（按等级长细节）
 *   → 废都远景 → 天空/日月/星空 → 天气（雨/雪/雾/雷暴/灰烬）→ 昼夜调色
 * 与现有 2D 管线共存：
 *   FarmPanorama3D.attach(hs)   在 .hs-pano-wrap 里创建 canvas 并初始化
 *   FarmPanorama3D.frame(now)   每帧渲染；active=false 时完全不介入（回退 2D）
 *   FarmPanorama3D.detach()     销毁
 * 不依赖任何外部图片：全部几何体 + 程序化 Canvas 贴图，file:// 可用（three 走 CDN）。
 */
(function () {
  'use strict';
  if (!window.THREE) {
    window.FarmPanorama3D = {
      active: false, _stub: true,
      attach() { return false; },
      frame() { return false; },
      present() { return false; },
      detach() {},
      setEnabled() { return false; },
      isEnabled() { return false; },
      toggle() { return false; }
    };
    return;
  }

  const T = THREE;
  const CROP_KINDS = ['wheat', 'corn', 'watermelon', 'pumpkin', 'sunflower', 'cabbage', 'carrot', 'moon_rice'];
  // P13-b 25 作物 × 4 阶段（farmCropsP13）：种子堆/苗/成株/成熟按生长进度切换 GLB 内 stage 组，
  // ready 格按品质给成熟模型叠加品质色自发光。关闭即回到单阶段全量模型。
  const FARM_CROPS_P13 = (function () { try { const v = (localStorage.getItem('farmCropsP13') || 'on').toLowerCase(); return !(v === '0' || v === 'off' || v === 'false' || v === 'no'); } catch (e) { return true; } })();
  // P13-c 建筑按等级差异化（farmBuildingsP13）：主屋按四建筑总级分 4 档，畜舍/温室/工坊/实验室按各自等级
  // 叠加 Blender 生成的等级扩展件（farmhouse_l1..l3、barn_l2..l4 等）。关闭即回到单档 GLB 外观。
  const FARM_BUILDINGS_P13 = (function () { try { const v = (localStorage.getItem('farmBuildingsP13') || 'on').toLowerCase(); return !(v === '0' || v === 'off' || v === 'false' || v === 'no'); } catch (e) { return true; } })();
  // P13-d 废土环境（farmEnvP13）：农场外围追加废土氛围——废车残骸/焦土斑块/废油桶/核废料桶/
  // 破损围栏/倾斜电线杆/近地灰雾，只落在外围条带不侵占操作区。关闭即回到现有环境。
  const FARM_ENV_P13 = (function () { try { const v = (localStorage.getItem('farmEnvP13') || 'on').toLowerCase(); return !(v === '0' || v === 'off' || v === 'false' || v === 'no'); } catch (e) { return true; } })();
  // P13-e 全局统一与性能预算（farmGradeP13）：场景静态道具（接触阴影/桶箱/断墙/水塔/路灯/废土件等）
  // 统一打标后按材质合并，draw call 预算目标 ≤120。关闭即回到逐件独立绘制。
  const FARM_GRADE_P13 = (function () { try { const v = (localStorage.getItem('farmGradeP13') || 'on').toLowerCase(); return !(v === '0' || v === 'off' || v === 'false' || v === 'no'); } catch (e) { return true; } })();
  const WEATHER_FOG = { clear: 0.012, cloud: 0.016, rain: 0.022, heavy_rain: 0.030, storm: 0.034, fog: 0.055, snow: 0.026 };
  // P12-e 后期统一（farmGradeP12）：白天去发白（收雾/收天空/提对比饱和/微暖做旧）、黄昏暗部抬黑。关闭即完全回到原值。
  const FARM_GRADE_P12 = (function () { try { const v = (localStorage.getItem('farmGradeP12') || 'on').toLowerCase(); return !(v === '0' || v === 'off' || v === 'false' || v === 'no'); } catch (e) { return true; } })();
  // P13-a 农田重铸（farmFieldP13）：PBR 土壤（bump/roughness 贴图）、田块厚土板几何、湿度/状态材质变体、
  // 品质色成熟环、田埂土垄 + 金属灌溉渠、待扩建围栏 + 公告板。关闭即回到 P12 田块表现。
  const FARM_FIELD_P13 = (function () { try { const v = (localStorage.getItem('farmFieldP13') || 'on').toLowerCase(); return !(v === '0' || v === 'off' || v === 'false' || v === 'no'); } catch (e) { return true; } })();

  function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* ---------- 程序化贴图 ---------- */
  function canvasTex(w, h, draw, repeat) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    draw(cv.getContext('2d'), w, h);
    const tex = new T.CanvasTexture(cv);
    tex.encoding = T.LinearEncoding;
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    if (repeat) tex.repeat.set(repeat[0], repeat[1]);
    tex.anisotropy = 4;
    return tex;
  }

  function dirtTexture() {
    return canvasTex(512, 512, (c, w, h) => {
      c.fillStyle = '#4a3a26'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 14000; i++) {
        const x = Math.random() * w, y = Math.random() * h;
        c.fillStyle = Math.random() > .5 ? 'rgba(126,100,66,.18)' : 'rgba(20,14,8,.20)';
        c.fillRect(x, y, 1 + Math.random() * 3, 1 + Math.random() * 2);
      }
      // 干裂纹 + 碎石
      for (let i = 0; i < 40; i++) {
        c.strokeStyle = 'rgba(18,12,6,.35)'; c.lineWidth = 1;
        const x = Math.random() * w, y = Math.random() * h;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + (Math.random() - .5) * 90, y + (Math.random() - .5) * 90); c.stroke();
      }
      for (let i = 0; i < 260; i++) {
        c.fillStyle = 'rgba(96,88,74,.5)';
        c.beginPath(); c.ellipse(Math.random() * w, Math.random() * h, 1 + Math.random() * 2.6, 1 + Math.random() * 1.6, Math.random() * 3, 0, 7); c.fill();
      }
    });
  }

  function soilTexture() {
    return canvasTex(512, 512, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#4a3a26'); g.addColorStop(.5, '#3f3020'); g.addColorStop(1, '#33271a');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      // 噪声土粒
      for (let i = 0; i < 9000; i++) {
        const x = Math.random() * w, y = Math.random() * h;
        const a = Math.random();
        c.fillStyle = a > .5 ? 'rgba(120,96,64,.20)' : 'rgba(24,18,10,.22)';
        c.fillRect(x, y, 1 + Math.random() * 2.4, 1 + Math.random() * 2);
      }
      // 垄沟（横向，法线感靠明暗条）
      for (let row = 0; row < 9; row++) {
        const y = 30 + row * 55;
        c.fillStyle = 'rgba(18,13,8,.35)'; c.fillRect(0, y, w, 10);
        c.fillStyle = 'rgba(196,164,112,.10)'; c.fillRect(0, y - 4, w, 4);
        for (let i = 0; i < 120; i++) {
          const x = Math.random() * w;
          c.fillStyle = 'rgba(16,12,8,.28)';
          c.fillRect(x, y + Math.random() * 10, 2 + Math.random() * 4, 1.4);
        }
      }
      // 碎石
      for (let i = 0; i < 220; i++) {
        const x = Math.random() * w, y = Math.random() * h;
        c.fillStyle = `rgba(${90 + Math.random() * 40},${80 + Math.random() * 30},${64 + Math.random() * 20},.5)`;
        c.beginPath(); c.ellipse(x, y, 1 + Math.random() * 3, 1 + Math.random() * 2, Math.random() * 3, 0, 7); c.fill();
      }
    }, [3, 3]);
  }

  function furrowTexture() {
    return canvasTex(512, 512, (c, w, h) => {
      c.fillStyle = '#3c2c1a'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 5000; i++) {
        const x = Math.random() * w, y = Math.random() * h;
        c.fillStyle = Math.random() > .5 ? 'rgba(120,96,60,.22)' : 'rgba(18,12,6,.30)';
        c.fillRect(x, y, 1 + Math.random() * 3, 1 + Math.random() * 2);
      }
      // 横向垄沟 + 垄背高光
      for (let row = 0; row < 8; row++) {
        const y = row * 64;
        c.fillStyle = 'rgba(12,8,4,.55)'; c.fillRect(0, y + 40, w, 16);
        c.fillStyle = 'rgba(150,120,78,.22)'; c.fillRect(0, y + 30, w, 8);
        c.fillStyle = 'rgba(90,70,44,.25)';
        for (let k = 0; k < 90; k++) c.fillRect(Math.random() * w, y + 40 + Math.random() * 16, 2 + Math.random() * 5, 1.5);
      }
    });
  }

  function grassTexture() {
    return canvasTex(256, 256, (c, w, h) => {
      c.fillStyle = '#4b4a32'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 4000; i++) {
        const x = Math.random() * w, y = Math.random() * h;
        c.fillStyle = Math.random() > .5 ? 'rgba(112,120,70,.35)' : 'rgba(60,58,36,.4)';
        c.fillRect(x, y, 1, 2 + Math.random() * 3);
      }
    }, [4, 4]);
  }

  /* ---------- P13-a PBR 土壤贴图组（color / bump / roughness）---------- */
  // 颜色：深褐废土基调 + 横向垄沟明暗 + 碎石 + 干裂纹 + 湿度深斑；bump：垄沟顶亮沟暗；rough：碎石高粗、湿区低粗。
  function soilPbrTextures() {
    const cv = document.createElement('canvas'); cv.width = cv.height = 512;
    const c = cv.getContext('2d');
    // ---- color ----
    const g = c.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#4a3826'); g.addColorStop(.5, '#3f3020'); g.addColorStop(1, '#33271a');
    c.fillStyle = g; c.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 9000; i++) {
      const x = Math.random() * 512, y = Math.random() * 512;
      c.fillStyle = Math.random() > .5 ? 'rgba(120,96,64,.20)' : 'rgba(24,18,10,.22)';
      c.fillRect(x, y, 1 + Math.random() * 2.4, 1 + Math.random() * 2);
    }
    for (let row = 0; row < 9; row++) {
      const y = 30 + row * 55;
      c.fillStyle = 'rgba(18,13,8,.35)'; c.fillRect(0, y, 512, 10);
      c.fillStyle = 'rgba(196,164,112,.10)'; c.fillRect(0, y - 4, 512, 4);
      for (let i = 0; i < 120; i++) {
        c.fillStyle = 'rgba(16,12,8,.28)';
        c.fillRect(Math.random() * 512, y + Math.random() * 10, 2 + Math.random() * 4, 1.4);
      }
    }
    for (let i = 0; i < 220; i++) {
      c.fillStyle = `rgba(${90 + Math.random() * 40},${80 + Math.random() * 30},${64 + Math.random() * 20},.5)`;
      c.beginPath(); c.ellipse(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 3, 1 + Math.random() * 2, Math.random() * 3, 0, 7); c.fill();
    }
    for (let i = 0; i < 30; i++) {
      c.strokeStyle = 'rgba(18,12,6,.30)'; c.lineWidth = 1;
      const x = Math.random() * 512, y = Math.random() * 512;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + (Math.random() - .5) * 80, y + (Math.random() - .5) * 80); c.stroke();
    }
    // 湿度深斑（低 moisture 表现用干区，湿润时整体乘深色）
    for (let i = 0; i < 40; i++) {
      c.fillStyle = 'rgba(15,10,6,.28)';
      c.beginPath(); c.ellipse(Math.random() * 512, Math.random() * 512, 6 + Math.random() * 20, 4 + Math.random() * 14, Math.random() * 3, 0, 7); c.fill();
    }
    const colorTex = new T.CanvasTexture(cv);
    colorTex.wrapS = colorTex.wrapT = T.RepeatWrapping;
    colorTex.repeat.set(1.6, 1.6);
    colorTex.anisotropy = 4;
    if (T.sRGBEncoding) colorTex.encoding = T.sRGBEncoding;
    // ---- bump（灰阶：垄沟顶亮、沟内暗，碎石噪点）----
    const bv = document.createElement('canvas'); bv.width = bv.height = 512;
    const bc = bv.getContext('2d');
    bc.fillStyle = '#808080'; bc.fillRect(0, 0, 512, 512);
    for (let row = 0; row < 9; row++) {
      const y = 30 + row * 55;
      const grd = bc.createLinearGradient(0, y - 6, 0, y + 12);
      grd.addColorStop(0, '#c8c8c8'); grd.addColorStop(.45, '#999999'); grd.addColorStop(1, '#505050');
      bc.fillStyle = grd; bc.fillRect(0, y - 6, 512, 18);
      for (let i = 0; i < 110; i++) {
        bc.fillStyle = '#3c3c3c';
        bc.fillRect(Math.random() * 512, y + Math.random() * 14, 2 + Math.random() * 4, 1.4);
      }
    }
    for (let i = 0; i < 240; i++) {
      bc.fillStyle = Math.random() > .5 ? '#a0a0a0' : '#5a5a5a';
      bc.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 2.6, 1 + Math.random() * 1.6);
    }
    const bumpTex = new T.CanvasTexture(bv);
    bumpTex.wrapS = bumpTex.wrapT = T.RepeatWrapping;
    bumpTex.repeat.set(1.6, 1.6);
    bumpTex.anisotropy = 2;
    // ---- roughness（R 通道：碎石/干土 255 高粗，湿润低粗 90）----
    const rv = document.createElement('canvas'); rv.width = rv.height = 512;
    const rc = rv.getContext('2d');
    rc.fillStyle = '#d8d8d8'; rc.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 260; i++) {
      rc.fillStyle = '#f0f0f0';
      rc.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 3, 1 + Math.random() * 2);
    }
    for (let i = 0; i < 46; i++) {
      rc.fillStyle = '#5c5c5c';
      rc.beginPath(); rc.ellipse(Math.random() * 512, Math.random() * 512, 7 + Math.random() * 22, 5 + Math.random() * 16, Math.random() * 3, 0, 7); rc.fill();
    }
    const roughTex = new T.CanvasTexture(rv);
    roughTex.wrapS = roughTex.wrapT = T.RepeatWrapping;
    roughTex.repeat.set(1.6, 1.6);
    return { color: colorTex, bump: bumpTex, rough: roughTex };
  }

  // 品质 → 成熟环 / 对勾主色（与农场 UI 品质配色一致）
  function qualityGlowColor(q) {
    const qc = { common: 0xffd76a, rare: 0x6ee7ff, epic: 0xc792ff, legendary: 0xff5a5a, mythic: 0xffd76a }[(q || 'common').toLowerCase()];
    return qc || 0xffd76a;
  }


  /* ---------- 程序化材质纹理 ---------- */
  const TEXCACHE = {};
  function texCanvas(name, fn, w, h) {
    if (!TEXCACHE[name]) TEXCACHE[name] = canvasTex(w || 256, h || 256, fn);
    return TEXCACHE[name];
  }
  function woodTex() {
    return texCanvas('wood', (c, w, h) => {
      c.fillStyle = '#8a6a4a'; c.fillRect(0, 0, w, h);
      // 木板条
      for (let row = 0; row < 4; row++) {
        const y = row * (h / 4);
        c.fillStyle = row % 2 ? 'rgba(60,40,24,.18)' : 'rgba(230,200,160,.07)';
        c.fillRect(0, y, w, h / 4);
        c.fillStyle = 'rgba(30,20,12,.45)'; c.fillRect(0, y + h / 4 - 2, w, 2);
        // 木纹
        for (let i = 0; i < 40; i++) {
          c.strokeStyle = 'rgba(70,48,28,.20)'; c.lineWidth = 1;
          const yy = y + 4 + Math.random() * (h / 4 - 8);
          c.beginPath(); c.moveTo(Math.random() * w, yy);
          c.bezierCurveTo(w * .3, yy + 2, w * .6, yy - 2, w, yy + 1); c.stroke();
        }
        // 节疤
        if (row % 2 === 0) {
          const bx = Math.random() * w;
          c.fillStyle = 'rgba(40,26,14,.5)'; c.beginPath(); c.ellipse(bx, y + h / 8, 4, 2.4, .2, 0, 7); c.fill();
        }
      }
      // 风化白斑
      for (let i = 0; i < 300; i++) {
        c.fillStyle = Math.random() > .5 ? 'rgba(220,210,190,.05)' : 'rgba(20,14,8,.06)';
        c.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 6, 1);
      }
    });
  }
  function rustTex() {
    return texCanvas('rust', (c, w, h) => {
      c.fillStyle = '#7a6a58'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 2600; i++) {
        const x = Math.random() * w, y = Math.random() * h;
        const r = Math.random();
        c.fillStyle = r > .62 ? 'rgba(150,80,40,.30)' : r > .3 ? 'rgba(90,50,30,.22)' : 'rgba(210,190,160,.08)';
        c.beginPath(); c.arc(x, y, 1 + Math.random() * 7, 0, 7); c.fill();
      }
      // 锈水流痕
      for (let i = 0; i < 16; i++) {
        const x = Math.random() * w;
        c.strokeStyle = 'rgba(130,64,30,.18)'; c.lineWidth = 1 + Math.random() * 3;
        c.beginPath(); c.moveTo(x, Math.random() * h * .4); c.lineTo(x + 2, h); c.stroke();
      }
      // 铆钉
      for (let i = 0; i < 22; i++) {
        const x = (i % 6) * (w / 6) + 8, y = Math.floor(i / 6) * (h / 4) + 10;
        c.fillStyle = 'rgba(40,34,28,.55)'; c.beginPath(); c.arc(x, y, 2.4, 0, 7); c.fill();
        c.fillStyle = 'rgba(220,210,190,.20)'; c.beginPath(); c.arc(x - .7, y - .7, 1.1, 0, 7); c.fill();
      }
    });
  }
  function shingleTex() {
    return texCanvas('shingle', (c, w, h) => {
      c.fillStyle = '#6a4a3a'; c.fillRect(0, 0, w, h);
      const rows = 8, cols = 6;
      for (let r = 0; r < rows; r++) {
        for (let k = 0; k < cols; k++) {
          const x = k * (w / cols) + (r % 2 ? w / cols / 2 : 0);
          const y = r * (h / rows);
          c.fillStyle = 'rgba(' + (120 + Math.random() * 40 | 0) + ',' + (70 + Math.random() * 30 | 0) + ',' + (50 + Math.random() * 25 | 0) + ',.55)';
          c.fillRect(x, y, w / cols - 2, h / rows - 2);
          c.strokeStyle = 'rgba(20,12,8,.5)'; c.lineWidth = 1.5;
          c.strokeRect(x, y, w / cols - 2, h / rows - 2);
        }
      }
      for (let i = 0; i < 120; i++) {
        c.fillStyle = 'rgba(180,160,120,.08)';
        c.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
    });
  }
  function clampedTexMat(name, color, repeat, rough, metal, nrmStrength) {
    const base = { wood: woodTex, rust: rustTex, shingle: shingleTex }[name];
    const src = base();
    const tex = src.clone();
    tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
    const mat = new T.MeshStandardMaterial({ map: tex, color: color, roughness: rough == null ? 1 : rough, metalness: metal || 0 });
    try {
      if (!NORMALCACHE[name]) NORMALCACHE[name] = normalFromHeight(heightCanvas(name), 2.2);
      const nrm = NORMALCACHE[name].clone();
      nrm.needsUpdate = true;
      nrm.wrapS = nrm.wrapT = T.RepeatWrapping;
      nrm.repeat.set(repeat[0], repeat[1]);
      mat.normalMap = nrm;
      const s = nrmStrength == null ? 1 : nrmStrength;
      mat.normalScale = new T.Vector2(s, s);
    } catch (e) { /* 法线贴图失败不影响主流程 */ }
    return mat;
  }

  const NORMALCACHE = {};
  function heightCanvas(name) {
    const hc = document.createElement('canvas'); hc.width = 256; hc.height = 256;
    const c = hc.getContext('2d');
    c.fillStyle = '#808080'; c.fillRect(0, 0, 256, 256);
    if (name === 'wood') {
      for (let row = 0; row < 4; row++) {
        const y = row * 64;
        c.fillStyle = '#383838'; c.fillRect(0, y + 60, 256, 4);           // 板缝凹槽
        c.fillStyle = '#9a9a9a'; c.fillRect(0, y, 256, 2);                // 上缘凸
        for (let i = 0; i < 26; i++) {
          c.strokeStyle = Math.random() > .5 ? 'rgba(60,60,60,.55)' : 'rgba(190,190,190,.35)';
          c.lineWidth = 1;
          const yy = y + 6 + Math.random() * 48;
          c.beginPath(); c.moveTo(0, yy); c.bezierCurveTo(80, yy + 2, 170, yy - 2, 256, yy); c.stroke();
        }
      }
    } else if (name === 'rust') {
      for (let i = 0; i < 900; i++) {
        const x = Math.random() * 256, y = Math.random() * 256, r = 1 + Math.random() * 7;
        const v = Math.random() > .5 ? 150 : 60;
        c.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',.25)';
        c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
      }
      for (let i = 0; i < 22; i++) {   // 铆钉凸起
        const x = (i % 6) * 42 + 10, y = Math.floor(i / 6) * 64 + 12;
        c.fillStyle = '#d8d8d8'; c.beginPath(); c.arc(x, y, 4, 0, 7); c.fill();
      }
    } else {
      const rows = 8, cols = 6;
      for (let r = 0; r < rows; r++) {
        for (let k = 0; k < cols; k++) {
          const x = k * (256 / cols) + (r % 2 ? 256 / cols / 2 : 0), y = r * (256 / rows);
          c.fillStyle = 'rgba(' + (110 + Math.random() * 50 | 0) + ',' + (110 + Math.random() * 50 | 0) + ',' + (110 + Math.random() * 50 | 0) + ',1)';
          c.fillRect(x, y, 256 / cols - 2, 256 / rows - 2);
          c.fillStyle = 'rgba(40,40,40,.9)'; c.fillRect(x, y + 256 / rows - 3, 256 / cols - 2, 2);
        }
      }
    }
    return hc;
  }
  function normalFromHeight(hc, strength) {
    const w = hc.width, h = hc.height;
    const src = hc.getContext('2d').getImageData(0, 0, w, h).data;
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    const oc = out.getContext('2d');
    const img = oc.createImageData(w, h);
    const H = (x, y) => {
      x = (x + w) % w; y = (y + h) % h;
      return src[(y * w + x) * 4] / 255;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
        const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
        const len = Math.sqrt(dx * dx + dy * dy + 1);
        const i = (y * w + x) * 4;
        img.data[i] = ((-dx / len) * .5 + .5) * 255;
        img.data[i + 1] = ((dy / len) * .5 + .5) * 255;   // three 里绿通道朝上
        img.data[i + 2] = ((1 / len) * .5 + .5) * 255;
        img.data[i + 3] = 255;
      }
    }
    oc.putImageData(img, 0, 0);
    const tex = new T.CanvasTexture(out);
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    return tex;
  }


  /* ---------- 几何合并（降低 draw call，软件/核显下帧率关键） ---------- */
  function mergeGeometries(geos) {
    const names = ['position', 'normal', 'uv', 'color'];
    const merged = new T.BufferGeometry();
    for (const name of names) {
      const ok = geos.every(g => g.attributes[name]);
      if (!ok) continue;
      const itemSize = geos[0].attributes[name].itemSize;
      let total = 0;
      geos.forEach(g => total += g.attributes[name].array.length);
      const out = new Float32Array(total);
      let off = 0;
      if (name === 'color') {
        geos.forEach(g => {
          const a = g.attributes.color;
          const src = a.array;
          const max = a.normalized ? ((src instanceof Uint16Array || src instanceof Int16Array) ? 65535 : 255) : 1;
          for (let i = 0; i < src.length; i++) out[off + i] = max === 1 ? src[i] : src[i] / max;
          off += src.length;
        });
      } else {
        geos.forEach(g => { out.set(g.attributes[name].array, off); off += g.attributes[name].array.length; });
      }
      merged.setAttribute(name, new T.BufferAttribute(out, itemSize, false));
    }
    return merged;
  }
  function mergeMeshes(root) {
    root.updateMatrixWorld(true);
    const buckets = new Map();
    root.traverse(o => {
      if (!o.isMesh || o.isSkinnedMesh) return;
      const m = o.material;
      if (!m || Array.isArray(m)) return;
      const sig = [m.type, m.color ? m.color.getHexString() : '', m.roughness, m.metalness, m.map ? m.map.uuid : '', m.emissive ? m.emissive.getHexString() : ''].join('|');
      let g = o.geometry.clone();
      if (g.index) g = g.toNonIndexed();
      g.applyMatrix4(o.matrixWorld);
      for (const name of Object.keys(g.attributes)) if (['position', 'normal', 'uv', 'color'].indexOf(name) < 0) g.deleteAttribute(name);
      if (!buckets.has(sig)) buckets.set(sig, { mat: m, geos: [] });
      buckets.get(sig).geos.push(g);
    });
    const out = new T.Group();
    buckets.forEach(({ mat, geos }) => {
      const mesh = new T.Mesh(mergeGeometries(geos), mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      out.add(mesh);
    });
    return out;
  }

  /* ---------- 作物几何体（v2：细节加强） ---------- */
  function cropGroup(kind) {
    const g = new T.Group();
    const mat = (col, rough = .9, metal = 0) => new T.MeshStandardMaterial({ color: col, roughness: rough, metalness: metal });
    const leafGeo = (w, l) => new T.PlaneGeometry(w, l);
    const addLeaf = (parent, x, y, z, w, l, rz, ry) => {
      const leaf = new T.Mesh(leafGeo(w, l), mat('#7a8442', .95));
      leaf.material.side = T.DoubleSide;
      leaf.position.set(x, y, z);
      leaf.rotation.z = rz; leaf.rotation.y = ry;
      parent.add(leaf);
    };
    if (kind === 'wheat' || kind === 'moon_rice') {
      const isRice = kind === 'moon_rice';
      const stalkMat = mat(isRice ? '#a9b5a2' : '#b89a44');
      const earMat = mat(isRice ? '#c8d0bc' : '#c8a850', .75);
      const awnMat = mat(isRice ? '#d8dcd0' : '#d8c070', .7);
      if (isRice) earMat.emissive = new T.Color('#4a5a80'), earMat.emissiveIntensity = .5;
      const n = 16;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, r = .04 + hash(i) * .14;
        const h = .4 + hash(i + 3) * .24;
        const stalk = new T.Mesh(new T.CylinderGeometry(.012, .018, h, 4), stalkMat);
        stalk.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
        stalk.rotation.z = (hash(i + 5) - .5) * .3;
        g.add(stalk);
        const ex = stalk.position.x, ez = stalk.position.z;
        const ear = new T.Mesh(new T.ConeGeometry(.045, .17, 6), earMat);
        ear.position.set(ex, h + .05, ez);
        g.add(ear);
        // 麦芒
        for (let k = 0; k < 4; k++) {
          const awn = new T.Mesh(new T.CylinderGeometry(.003, .006, .12, 3), awnMat);
          awn.position.set(ex + (hash(i + k) - .5) * .05, h + .13, ez + (hash(i * 2 + k) - .5) * .05);
          awn.rotation.z = (hash(i + k) - .5) * .5;
          g.add(awn);
        }
        addLeaf(g, ex + .07, h * .45, ez, .14, .42, .5, a);
      }
    } else if (kind === 'corn') {
      const stalkMat = mat('#6f8a3a'), leafMat = mat('#7c9a42', .95);
      const stalk = new T.Mesh(new T.CylinderGeometry(.055, .075, 1.35, 7), stalkMat);
      stalk.position.y = .675; g.add(stalk);
      for (let i = 0; i < 9; i++) {
        const y = .25 + i * .13;
        for (let b = 0; b < 2; b++) {
          const leaf = new T.Mesh(leafGeo(.5, .18), leafMat);
          leaf.material.side = T.DoubleSide;
          leaf.position.set(0, y, 0);
          leaf.rotation.y = i * 1.4 + b * 2.2;
          leaf.rotation.z = .5;
          leaf.position.x = Math.cos(i * 1.4 + b * 2.2) * .16;
          leaf.position.z = Math.sin(i * 1.4 + b * 2.2) * .16;
          g.add(leaf);
        }
      }
      // 雄穗
      const tassel = new T.Mesh(new T.ConeGeometry(.05, .28, 6), mat('#c8b060', .8));
      tassel.position.y = 1.45; g.add(tassel);
      for (let i = 0; i < 5; i++) {
        const t2 = new T.Mesh(new T.CylinderGeometry(.006, .012, .18, 3), mat('#d8c070'));
        t2.position.set((hash(i) - .5) * .18, 1.5 + hash(i) * .06, (hash(i + 1) - .5) * .18);
        t2.rotation.z = (hash(i) - .5) * .9; t2.rotation.x = (hash(i + 2) - .5) * .9;
        g.add(t2);
      }
      // 雌穗 + 苞叶 + 玉米须
      for (let i = 0; i < 2; i++) {
        const ex = i ? .13 : -.13, ez = i ? .06 : -.06;
        const ear = new T.Mesh(new T.CylinderGeometry(.05, .03, .32, 6), mat('#d9b84a', .7));
        ear.position.set(ex, .78 + i * .05, ez); ear.rotation.z = i ? -.2 : .2; g.add(ear);
        const husk = new T.Mesh(new T.ConeGeometry(.075, .36, 6), mat('#8a9a4a', .95));
        husk.position.set(ex, .82 + i * .05, ez); husk.rotation.z = i ? -.2 : .2; husk.material.side = T.DoubleSide; g.add(husk);
        for (let k = 0; k < 6; k++) {
          const silk = new T.Mesh(new T.CylinderGeometry(.004, .004, .18, 3), mat('#c87a40', .8));
          silk.position.set(ex + (hash(i + k) - .5) * .06, 1.0 + i * .05, ez + (hash(i + k + 2) - .5) * .06);
          silk.rotation.z = (hash(i + k) - .5) * .8; g.add(silk);
        }
      }
    } else if (kind === 'sunflower') {
      const stalk = new T.Mesh(new T.CylinderGeometry(.035, .05, 1.35, 6), mat('#7c8a42'));
      stalk.position.y = .675; g.add(stalk);
      for (let i = 0; i < 4; i++) {
        addLeaf(g, (i % 2 ? .1 : -.1), .4 + i * .22, (i % 2 ? .06 : -.06), .32, .22, (i % 2 ? .6 : -.6), i * 1.2);
      }
      const head = new T.Group();
      // 花盘（程序化籽粒贴图）
      const discTex = texCanvas('sunflower-disc', (c, w, h) => {
        c.fillStyle = '#4a3218'; c.fillRect(0, 0, w, h);
        for (let i = 0; i < 900; i++) {
          const a = i * 2.399, r = Math.sqrt(i / 900) * (w / 2);
          c.fillStyle = i % 3 ? 'rgba(120,86,40,.9)' : 'rgba(70,50,24,.9)';
          c.beginPath(); c.arc(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r, 1.6, 0, 7); c.fill();
        }
      });
      const disc = new T.Mesh(new T.CircleGeometry(.17, 20), new T.MeshStandardMaterial({ map: discTex, roughness: .8, side: T.DoubleSide }));
      disc.position.z = .02; head.add(disc);
      const petalMat = mat('#e8c83e', .7);
      for (let ring = 0; ring < 2; ring++) {
        const n = ring ? 10 : 16, rr = ring ? .14 : .18;
        for (let i = 0; i < n; i++) {
          const a = i / n * Math.PI * 2 + ring * .2;
          const p = new T.Mesh(new T.BoxGeometry(.14, .035, .02), petalMat);
          p.position.set(Math.cos(a) * rr, Math.sin(a) * rr, 0);
          p.rotation.z = a; p.rotation.y = ring ? .4 : .8;
          head.add(p);
        }
      }
      head.position.set(0, 1.35, .02); head.rotation.y = .35; head.rotation.x = -.4;
      g.add(head);
    } else if (kind === 'pumpkin') {
      const body = new T.Mesh(new T.SphereGeometry(.26, 16, 12), mat('#c8752c', .85));
      body.scale.set(1.1, .72, 1.1); body.position.y = .18; g.add(body);
      for (let i = 0; i < 8; i++) {
        const rib = new T.Mesh(new T.TorusGeometry(.245, .022, 6, 18, Math.PI), mat('#a85a20', .9));
        rib.position.y = .18; rib.rotation.set(Math.PI / 2, 0, i / 8 * Math.PI * 2);
        g.add(rib);
      }
      const stem = new T.Mesh(new T.CylinderGeometry(.025, .045, .16, 5), mat('#4a5a2a'));
      stem.position.y = .42; g.add(stem);
      // 卷须
      for (let i = 0; i < 3; i++) {
        const vine = new T.Mesh(new T.TorusGeometry(.12, .012, 4, 10, Math.PI * .9), mat('#5a6a32'));
        vine.position.set(.32, .05, .1); vine.rotation.x = -Math.PI / 2; vine.rotation.y = i * 1.4; g.add(vine);
      }
      for (let i = 0; i < 3; i++) addLeaf(g, (hash(i) - .5) * .5, .12, -0.3 - hash(i) * .2, .3, .22, .4, i);
    } else if (kind === 'watermelon') {
      const tex = canvasTex(128, 128, (c, w, h) => {
        c.fillStyle = '#4e7a3a'; c.fillRect(0, 0, w, h);
        c.strokeStyle = '#2e5226'; c.lineWidth = 10;
        for (let i = -2; i < 6; i++) { c.beginPath(); c.moveTo(i * 24, 0); c.quadraticCurveTo(i * 24 + 22, h / 2, i * 24, h); c.stroke(); }
      });
      const body = new T.Mesh(new T.SphereGeometry(.28, 16, 12), new T.MeshStandardMaterial({ map: tex, roughness: .75 }));
      body.scale.set(1.2, .85, 1); body.position.y = .2; g.add(body);
      const stem = new T.Mesh(new T.CylinderGeometry(.018, .025, .12, 5), mat('#5a6a32')); stem.position.y = .44; g.add(stem);
      for (let i = 0; i < 4; i++) addLeaf(g, (hash(i) - .5) * .55, .1, (hash(i + 1) - .5) * .5, .3, .2, .3, i);
    } else if (kind === 'cabbage') {
      // 外叶
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2;
        const outer = new T.Mesh(new T.SphereGeometry(.2, 8, 6, 0, Math.PI), mat('#7ca850', .95));
        outer.scale.set(1, .5, 1.2);
        outer.position.set(Math.cos(a) * .14, .1, Math.sin(a) * .14);
        outer.rotation.y = a; outer.rotation.z = .3;
        g.add(outer);
      }
      const mat1 = mat('#7ca850', .9), mat2 = mat('#8fbc5e', .9), mat3 = mat('#a2cc6e', .9);
      [[.2, .06, mat1], [.15, .12, mat2], [.1, .17, mat3]].forEach(([r, y, m]) => {
        const ball = new T.Mesh(new T.SphereGeometry(r, 12, 9), m);
        ball.scale.set(1, .85, 1); ball.position.y = y + r * .7; g.add(ball);
      });
    } else if (kind === 'carrot') {
      const root = new T.Mesh(new T.ConeGeometry(.075, .3, 8), mat('#d07a2e', .8));
      root.position.y = -.06; root.rotation.x = Math.PI; g.add(root);
      const leafMat = mat('#6f8a3a', .95);
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2;
        const leaf = new T.Mesh(new T.ConeGeometry(.018, .42, 4), leafMat);
        leaf.position.set(Math.cos(a) * .05, .24, Math.sin(a) * .05);
        leaf.rotation.z = Math.cos(a) * .35; leaf.rotation.x = Math.sin(a) * .35;
        g.add(leaf);
        // 小叶
        const sub = new T.Mesh(new T.ConeGeometry(.012, .2, 3), leafMat);
        sub.position.set(Math.cos(a) * .11, .3, Math.sin(a) * .11);
        sub.rotation.z = Math.cos(a) * .8; sub.rotation.x = Math.sin(a) * .8;
        g.add(sub);
      }
    }
    return g;
  }

  /* ---------- 建筑 ---------- */

  function houseModel(level) {
    const g = new T.Group();
    const wall = clampedTexMat('wood', '#a08060', [2, 2], .95);
    const wood = clampedTexMat('wood', '#7a5a40', [1, 1], 1);
    const roof = clampedTexMat('shingle', '#8a6050', [2, 2], 1);
    const body = new T.Mesh(new T.BoxGeometry(3.4, 2.0, 2.6), wall); body.position.y = 1.0; g.add(body);
    // 屋顶：三棱柱
    const shape = new T.Shape();
    shape.moveTo(-2.05, 0); shape.lineTo(0, 1.15); shape.lineTo(2.05, 0); shape.lineTo(-2.05, 0);
    const roofGeo = new T.ExtrudeGeometry(shape, { depth: 3.0, bevelEnabled: false });
    const roofMesh = new T.Mesh(roofGeo, roof);
    roofMesh.position.set(0, 2.0, -1.5);
    g.add(roofMesh);
    // 门
    const door = new T.Mesh(new T.BoxGeometry(.5, .95, .08), wood); door.position.set(0, .48, 1.32); g.add(door);
    // 窗（夜间自发光）
    const winMat = new T.MeshStandardMaterial({ color: '#3a2a1a', emissive: new T.Color('#ffb45a'), emissiveIntensity: 0, roughness: .4 });
    for (const [x, y] of [[-1.0, 1.25], [1.0, 1.25], [-1.0, .55], [.85, .55]]) {
      const w = new T.Mesh(new T.BoxGeometry(.42, .45, .06), winMat);
      w.position.set(x, y, 1.32); g.add(w);
    }
    // 烟囱
    const chim = new T.Mesh(new T.BoxGeometry(.28, 1.0, .28), new T.MeshStandardMaterial({ color: '#4b4238', roughness: 1 }));
    chim.position.set(1.1, 2.6, .4); g.add(chim);
    // 门廊
    const porch = new T.Mesh(new T.BoxGeometry(3.0, .12, .8), wood); porch.position.set(0, .06, 1.75); g.add(porch);
    for (const x of [-1.3, 1.3]) { const post = new T.Mesh(new T.BoxGeometry(.1, .9, .1), wood); post.position.set(x, .5, 2.05); g.add(post); }
    // 等级：卫星锅
    if (level >= 8) {
      const dish = new T.Mesh(new T.SphereGeometry(.28, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), new T.MeshStandardMaterial({ color: '#b0a898', roughness: .5, metalness: .3, side: T.DoubleSide }));
      dish.position.set(1.2, 3.3, .6); dish.rotation.x = -.6; g.add(dish);
      const mast = new T.Mesh(new T.CylinderGeometry(.02, .02, .9, 5), wood); mast.position.set(1.2, 2.9, .6); g.add(mast);
    }
    g.userData.winMat = winMat;
    return g;
  }

  function barnModel() {
    const g = new T.Group();
    const wall = clampedTexMat('wood', '#b06a4a', [2, 2], 1);
    const roof = clampedTexMat('rust', '#9a4a34', [2, 2], .9, .2);
    const body = new T.Mesh(new T.BoxGeometry(3.2, 1.7, 2.2), wall); body.position.y = .85; g.add(body);
    const shape = new T.Shape();
    shape.moveTo(-1.9, 0); shape.lineTo(0, .95); shape.lineTo(1.9, 0); shape.lineTo(-1.9, 0);
    const roofMesh = new T.Mesh(new T.ExtrudeGeometry(shape, { depth: 2.6, bevelEnabled: false }), roof);
    roofMesh.position.set(0, 1.7, -1.3);
    g.add(roofMesh);
    const door = new T.Mesh(new T.BoxGeometry(1.0, 1.1, .08), new T.MeshStandardMaterial({ color: '#3a2a1c', roughness: 1 }));
    door.position.set(0, .55, 1.12); g.add(door);
    // 围栏
    const fenceMat = clampedTexMat('wood', '#7a5e40', [2, 1], 1);
    for (let i = 0; i < 7; i++) {
      const p = new T.Mesh(new T.BoxGeometry(.07, .5, .07), fenceMat);
      p.position.set(-2.4 + i * .35, .25, 1.9); g.add(p);
    }
    const rail = new T.Mesh(new T.BoxGeometry(2.3, .06, .06), fenceMat); rail.position.set(-1.35, .4, 1.9); g.add(rail);
    // 风车
    const tower = new T.Mesh(new T.CylinderGeometry(.08, .16, 1.6, 6), fenceMat);
    tower.position.set(2.0, 1.9, .2); g.add(tower);
    const hub = new T.Group(); hub.position.set(2.0, 2.7, .2);
    const bladeMat = new T.MeshStandardMaterial({ color: '#8a7a60', roughness: .9 });
    for (let i = 0; i < 4; i++) {
      const b = new T.Mesh(new T.BoxGeometry(.06, .7, .04), bladeMat);
      b.position.y = .35; b.rotation.z = i * Math.PI / 2;
      const wrap = new T.Group(); wrap.add(b); wrap.rotation.z = i * Math.PI / 2;
      hub.add(wrap);
    }
    g.add(hub); g.userData.hub = hub;
    return g;
  }

  function greenhouseModel(level) {
    const g = new T.Group();
    const glass = new T.MeshPhysicalMaterial({ color: '#9fd8c8', transparent: true, opacity: .32, roughness: .15, metalness: 0, side: T.DoubleSide, depthWrite: false });
    const frame = clampedTexMat('rust', '#8a8478', [2, 1], .8, .2);
    const dome = new T.Mesh(new T.SphereGeometry(1.25, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), glass);
    dome.scale.set(1, .85, 1.6); dome.position.y = 0; g.add(dome);
    // 底框
    const base = new T.Mesh(new T.BoxGeometry(2.4, .12, 3.9), frame); base.position.y = .06; g.add(base);
    // 龙骨架
    for (let i = 0; i < 5; i++) {
      const rib = new T.Mesh(new T.TorusGeometry(1.25, .02, 5, 14, Math.PI), frame);
      rib.position.set(0, 0, -1.5 + i * .75); rib.scale.set(1, .85, 1);
      g.add(rib);
    }
    const glowMat = new T.MeshStandardMaterial({ color: '#9fe8c8', emissive: new T.Color('#6fffc0'), emissiveIntensity: level >= 2 ? .9 : 0, transparent: true, opacity: .8 });
    const glow = new T.Mesh(new T.BoxGeometry(1.8, .12, 3.2), glowMat); glow.position.y = .5; g.add(glow);
    g.userData.glowMat = glowMat;
    return g;
  }

  function workshopModel(level) {
    const g = new T.Group();
    const wall = clampedTexMat('rust', '#8a7a68', [2, 2], .9, .2);
    const body = new T.Mesh(new T.BoxGeometry(2.0, 1.5, 1.8), wall); body.position.y = .75; g.add(body);
    const roof = new T.Mesh(new T.BoxGeometry(2.2, .16, 2.0), clampedTexMat('rust', '#6a6058', [2, 2], .85, .25));
    roof.position.y = 1.58; g.add(roof);
    const chim = new T.Mesh(new T.BoxGeometry(.26, .9, .26), new T.MeshStandardMaterial({ color: '#3e3a34', roughness: 1 }));
    chim.position.set(-.55, 1.95, -.3); g.add(chim);
    const door = new T.Mesh(new T.BoxGeometry(.7, .9, .06), new T.MeshStandardMaterial({ color: '#332c24' })); door.position.set(0, .45, .93); g.add(door);
    // 齿轮
    if (level >= 3) {
      const gear = new T.Mesh(new T.TorusGeometry(.3, .07, 6, 12), new T.MeshStandardMaterial({ color: '#8a8070', metalness: .5, roughness: .5 }));
      gear.position.set(.75, 1.1, .95); g.add(gear); g.userData.gear = gear;
    }
    // 铁塔
    if (level >= 4) {
      const towerMat = new T.MeshStandardMaterial({ color: '#5a5044' });
      for (const x of [.9, 1.3]) {
        const leg = new T.Mesh(new T.CylinderGeometry(.03, .04, 2.2, 4), towerMat);
        leg.position.set(x, 1.2, -1.2); g.add(leg);
      }
      const cross = new T.Mesh(new T.BoxGeometry(.5, .04, .04), towerMat); cross.position.set(1.1, 1.6, -1.2); g.add(cross);
    }
    return g;
  }

  function labModel(level) {
    const g = new T.Group();
    const body = new T.Mesh(new T.BoxGeometry(1.6, 1.8, 1.6), clampedTexMat('rust', '#7a7a72', [2, 2], .8, .3));
    body.position.y = .9; g.add(body);
    const roof = new T.Mesh(new T.BoxGeometry(1.8, .14, 1.8), new T.MeshStandardMaterial({ color: '#46443c' })); roof.position.y = 1.87; g.add(roof);
    const mast = new T.Mesh(new T.CylinderGeometry(.025, .025, 1.2, 5), new T.MeshStandardMaterial({ color: '#8a8478', metalness: .3 }));
    mast.position.y = 2.5; g.add(mast);
    const light = new T.Mesh(new T.SphereGeometry(.07, 8, 6), new T.MeshStandardMaterial({ color: '#bfe8ff', emissive: new T.Color('#bfe8ff'), emissiveIntensity: 2 }));
    light.position.y = 3.1; g.add(light); g.userData.blink = light;
    const dish = new T.Mesh(new T.SphereGeometry(.4, 12, 8, 0, Math.PI * 2, 0, Math.PI / 3), new T.MeshStandardMaterial({ color: '#9a9488', side: T.DoubleSide, metalness: .3, roughness: .5 }));
    dish.position.set(.6, 2.2, 0); dish.rotation.z = -.5; g.add(dish);
    return g;
  }

  function deadTree(scale) {
    const g = new T.Group();
    const mat = new T.MeshStandardMaterial({ color: '#3a3024', roughness: 1 });
    const trunk = new T.Mesh(new T.CylinderGeometry(.10 * scale, .22 * scale, 2.4 * scale, 6), mat);
    trunk.position.y = 1.0 * scale; g.add(trunk);
    const branch = (x, y, z, len, ang, tilt, depth) => {
      const b = new T.Mesh(new T.CylinderGeometry(.012 * scale * depth, .045 * scale * depth, len, 4), mat);
      b.position.set(x, y, z);
      b.rotation.z = ang; b.rotation.x = tilt;
      g.add(b);
      return { x: x + Math.sin(ang) * len * .5, y: y + Math.cos(ang) * len * .5, z: z + Math.sin(tilt) * len * .4 };
    };
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + hash(i) * .8;
      const len = (.7 + hash(i + 2) * .5) * scale;
      const tx = Math.cos(a) * .6 * scale, ty = 1.15 * scale + hash(i) * .4, tz = Math.sin(a) * .6 * scale;
      const dir = { x: tx, y: ty, z: tz };
      const b = new T.Mesh(new T.CylinderGeometry(.012 * scale, .04 * scale, len, 4), mat);
      b.position.set(tx, ty, tz);
      b.rotation.z = (Math.cos(a)) * .9;
      b.rotation.x = (Math.sin(a)) * .7;
      g.add(b);
      // 小枝
      for (let k = 0; k < 3; k++) {
        const tw = new T.Mesh(new T.CylinderGeometry(.006 * scale, .016 * scale, len * .5, 3), mat);
        tw.position.set(tx + (hash(i + k) - .5) * .5, ty + len * .25 * (k + 1) * .3, tz + (hash(i * 2 + k) - .5) * .5);
        tw.rotation.z = b.rotation.z + (hash(k) - .5) * 1.2;
        tw.rotation.x = b.rotation.x + (hash(k + 1) - .5) * 1.2;
        g.add(tw);
      }
    }
    return g;
  }

  function rock(scale) {
    const geo = new T.IcosahedronGeometry(scale, 0);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, pos.getX(i) * (.7 + hash(i) * .6), pos.getY(i) * (.5 + hash(i + 1) * .5), pos.getZ(i) * (.7 + hash(i + 2) * .6));
    }
    geo.computeVertexNormals();
    const m = new T.Mesh(geo, new T.MeshStandardMaterial({ color: '#4a443a', roughness: 1 }));
    m.position.y = scale * .4;
    return m;
  }

  /* ---------- 主模块 ---------- */
  const Patches = {
    _wrap: null, _canvas: null, _renderer: null, _scene: null, _camera: null,
    _clock: null, _raf: null, _ok: false, _ready: false, _pano3d: true,
    _stateKey: '', _plots: [], _cropMeshes: [], _readyGlowMats: [], _readySprites: [], _buildings: {},
    _sun: null, _moon: null, _hemi: null, _sky: null, _stars: null, _clouds: null,
    _rain: null, _snow: null, _ash: null, _fogPts: null, _lightning: 0,
    _mouse: { x: 0, y: 0, tx: 0, ty: 0 }, _sunAngle: 0, _wind: 0,
    _texCache: {},

    attach(hs, opts) {
      if (!(opts && opts.force)) { try { if (localStorage.getItem('pano3d') === '0') { this._enabled = false; return false; } } catch (e) {} }
      if (this._ready) { this._enabled = true; return true; }
      const wrap = hs && hs.querySelector ? hs.querySelector('.hs-pano-wrap') : null;
      if (!wrap) return false;
      if (this._wrap === wrap && this._ready) return true;
      this._wrap = wrap;
      try { this._initScene(wrap); } catch (e) { console.warn('[Pano3D] init failed', e); this._ok = false; return false; }
      this._ready = true; this._ok = true;
      this._canvas.classList.add('pano3d-on');
      wrap.classList.add('pano3d');
      const other = wrap.querySelectorAll('canvas:not(.pano3d-on)');
      other.forEach(cv => { cv.style.display = 'none'; });
      return true;
    },

    present() { return !!(this._ready && this._ok && this._enabled !== false); },
    _enabled: true,
    setEnabled(on) {
      if (on) {
        const ok = this.attach(document.getElementById('farmHomestead'), { force: true });
        this._enabled = ok;
        if (ok && this._wrap) { this._wrap.classList.add('pano3d'); this._canvas.style.display = 'block'; }
      } else {
        this._enabled = false;
        if (this._wrap) {
          this._wrap.classList.remove('pano3d');
          if (this._canvas) this._canvas.style.display = 'none';
          this._wrap.querySelectorAll('canvas:not(.pano3d-on)').forEach(cv => { cv.style.display = ''; });
        }
      }
      try { localStorage.setItem('pano3d', on && this._enabled ? '1' : '0'); } catch (e) {}
      return this._enabled;
    },
    isEnabled() { return this._enabled !== false; },
    toggle() { return this.setEnabled(!this.isEnabled()); },

    _initScene(wrap) {
      const w = Math.max(320, wrap.clientWidth), h = Math.max(200, wrap.clientHeight);
      const r = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      r.setSize(w, h, false);
      r.outputEncoding = T.LinearEncoding;
      r.shadowMap.enabled = true;
      r.shadowMap.type = T.PCFSoftShadowMap;
      r.domElement.id = 'v58Panorama3D';
      r.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;z-index:3;';
      wrap.appendChild(r.domElement);
      this._renderer = r;
      this._canvas = r.domElement;

      const scene = new T.Scene();
      const cam = new T.PerspectiveCamera(35, w / h, .1, 400);
      cam.position.set(-1.0, 4.2, 21.0);
      cam.lookAt(-0.5, 1.2, -1.0);
      this._scene = scene; this._camera = cam;
      // Bloom 后处理（泛光：窗光/灯光/月光溢出）
      // P5 电影链开关 farmPanoCine（auto/on/off）：on=HalfFloat HDR + ACES + 收敛 Bloom + 末尾 sRGB；
      // off 完全保留旧 LDR 插画风链（墨线/纸纹/暖调），零行为回归。默认 auto=on。
      const cineOn = (function () { try { return (localStorage.getItem('farmPanoCine') || 'auto').toLowerCase() !== 'off'; } catch (e) { return true; } })();
      this._cineOn = cineOn;
      this._composer = null; this._bloom = null; this._cine = null; this._srgb = null;
      try {
        if (T.EffectComposer && T.RenderPass && T.UnrealBloomPass) {
          let comp;
          if (cineOn && T.HalfFloatType) {
            // 线性 HDR 目标，避免 LDR 截断高光使 Bloom/ACES 失效
            const rt = new T.WebGLRenderTarget(w, h, { minFilter: T.LinearFilter, magFilter: T.LinearFilter, format: T.RGBAFormat, type: T.HalfFloatType });
            rt.texture.encoding = T.LinearEncoding;
            comp = new T.EffectComposer(r, rt);
          } else {
            comp = new T.EffectComposer(r);
          }
          comp.addPass(new T.RenderPass(scene, cam));
          // 电影链 Bloom 向 strength .32 / radius .62 / threshold .92 收敛；旧链维持 .22/.46/.92
          const bloom = cineOn
            ? new T.UnrealBloomPass(new T.Vector2(Math.round(w / 2), Math.round(h / 2)), .32, .62, .92)
            : new T.UnrealBloomPass(new T.Vector2(Math.round(w / 2), Math.round(h / 2)), .22, .46, .92);
          comp.addPass(bloom);
          this._composer = comp; this._bloom = bloom;
          // God rays：径向模糊的屏幕空间体积光
          try {
            if (T.ShaderPass) {
              const godraysShader = {
                uniforms: {
                  tDiffuse: { value: null },
                  sunPos: { value: new T.Vector2(.72, .7) },
                  weight: { value: 0.0 },
                  decay: { value: 0.94 },
                  density: { value: 0.55 },
                  exposure: { value: 0.5 }
                },
                vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
                fragmentShader: [
                  'uniform sampler2D tDiffuse;',
                  'uniform vec2 sunPos;',
                  'uniform float weight;',
                  'uniform float decay;',
                  'uniform float density;',
                  'uniform float exposure;',
                  'varying vec2 vUv;',
                  'void main(){',
                  '  vec3 base = texture2D(tDiffuse, vUv).rgb;',
                  '  if (weight <= 0.001) { gl_FragColor = vec4(base, 1.0); return; }',
                  '  vec2 delta = (vUv - sunPos) * density / 32.0;',
                  '  vec2 uv = vUv;',
                  '  vec3 acc = vec3(0.0);',
                  '  float illum = 1.0;',
                  '  for (int i = 0; i < 20; i++) {',
                  '    uv -= delta;',
                  '    vec3 s = texture2D(tDiffuse, uv).rgb;',
                  '    float lum = dot(s, vec3(0.299, 0.587, 0.114));',
                  '    acc += s * smoothstep(0.72, 1.0, lum) * illum;',
                  '    illum *= decay;',
                  '  }',
                  '  vec3 col = base + acc * weight * exposure;',
                  '  gl_FragColor = vec4(col, 1.0);',
                  '}'
                ].join('\n')
              };
              // 去 AI 味插画后处理：Sobel 墨线 + 纸纹颗粒 + 高低光压缩 + 轻暗角
              const illusShader = {
                uniforms: {
                  tDiffuse: { value: null },
                  time: { value: 0 },
                  res: { value: new T.Vector2(w, h) },
                  lineStrength: { value: 0.58 },
                  grain: { value: 0.030 }
                },
                vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
                fragmentShader: [
                  'uniform sampler2D tDiffuse;',
                  'uniform float time;',
                  'uniform vec2 res;',
                  'uniform float lineStrength;',
                  'uniform float grain;',
                  'varying vec2 vUv;',
                  'float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }',
                  'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
                  'void main(){',
                  '  vec2 texel = 1.0 / res;',
                  '  vec3 base = texture2D(tDiffuse, vUv).rgb;',
                  '  float l00 = luma(texture2D(tDiffuse, vUv + vec2(-1.0,-1.0)*texel).rgb);',
                  '  float l10 = luma(texture2D(tDiffuse, vUv + vec2( 0.0,-1.0)*texel).rgb);',
                  '  float l20 = luma(texture2D(tDiffuse, vUv + vec2( 1.0,-1.0)*texel).rgb);',
                  '  float l01 = luma(texture2D(tDiffuse, vUv + vec2(-1.0, 0.0)*texel).rgb);',
                  '  float l21 = luma(texture2D(tDiffuse, vUv + vec2( 1.0, 0.0)*texel).rgb);',
                  '  float l02 = luma(texture2D(tDiffuse, vUv + vec2(-1.0, 1.0)*texel).rgb);',
                  '  float l12 = luma(texture2D(tDiffuse, vUv + vec2( 0.0, 1.0)*texel).rgb);',
                  '  float l22 = luma(texture2D(tDiffuse, vUv + vec2( 1.0, 1.0)*texel).rgb);',
                  '  float gx = (l20 + 2.0*l21 + l22) - (l00 + 2.0*l01 + l02);',
                  '  float gy = (l02 + 2.0*l12 + l22) - (l00 + 2.0*l10 + l20);',
                  '  float edge = smoothstep(0.09, 0.46, length(vec2(gx, gy)));',
                  '  vec3 ink = vec3(0.11, 0.09, 0.07);',
                  '  vec3 col = mix(base, ink, edge * lineStrength);',
                  '  float g = luma(col);',
                  '  col = mix(vec3(g), col, 0.94);',
                  '  col = col * vec3(1.022, 1.0, 0.958);',
                  '  col = mix(col, vec3(0.80, 0.76, 0.68), 0.032);',
                  '  col = clamp(col * 1.03 - 0.012, 0.0, 1.0);',
                  '  float n = hash(vUv * res + fract(time * 0.7) * 173.0) - 0.5;',
                  '  float n2 = hash(floor(vUv * res * 0.5) + fract(time) * 51.0) - 0.5;',
                  '  col += (n * 0.7 + n2 * 0.3) * grain;',
                  '  vec2 q = vUv - 0.5;',
                  '  col *= 1.0 - dot(q, q) * 0.22;',
                  '  gl_FragColor = vec4(col, 1.0);',
                  '}'
                ].join('\n')
              };
              const gr = new T.ShaderPass(godraysShader);
              gr.needsSwap = true;
              comp.addPass(gr);
              this._godrays = gr;

              // P5 电影链：线性曝光 → ACES(Narkowicz) → 轻对比。不做主题染色/暗角/白平衡，
              // 风格化（墨线/纸纹/暖调）仍完全交给后续 Illustration，最小扰动既有美术。
              if (cineOn && T.ShaderPass) {
                const cineShader = {
                  // 昼夜自适应：白天通透明快、夜间自动压曝光+强化黑场塑形恢复夜感（uNight 由 frame 按 dayLight 注入）
                  uniforms: {
                    tDiffuse: { value: null }, uNight: { value: 0 },
                    uExpDay: { value: FARM_GRADE_P12 ? 0.94 : 0.98 }, uExpNight: { value: FARM_GRADE_P12 ? 0.76 : 0.70 },
                    uGammaDay: { value: FARM_GRADE_P12 ? 1.08 : 1.12 }, uGammaNight: { value: FARM_GRADE_P12 ? 1.40 : 1.50 },
                    uConDay: { value: FARM_GRADE_P12 ? 1.16 : 1.10 }, uConNight: { value: FARM_GRADE_P12 ? 1.16 : 1.18 },
                    uSatDay: { value: FARM_GRADE_P12 ? 1.14 : 1.0 }, uSatNight: { value: FARM_GRADE_P12 ? 1.06 : 1.0 },
                    uWarmDay: { value: FARM_GRADE_P12 ? 0.10 : 0.0 }, uWarmNight: { value: 0.0 }
                  },
                  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
                  fragmentShader: [
                    'uniform sampler2D tDiffuse; uniform float uNight,uExpDay,uExpNight,uGammaDay,uGammaNight,uConDay,uConNight,uSatDay,uSatNight,uWarmDay,uWarmNight;',
                    'varying vec2 vUv;',
                    'vec3 aces(vec3 x){ const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14;',
                    '  return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0); }',
                    'void main(){',
                    '  float exposure=mix(uExpDay,uExpNight,uNight);',
                    '  float gamma=mix(uGammaDay,uGammaNight,uNight);',
                    '  float contrast=mix(uConDay,uConNight,uNight);',
                    '  float sat=mix(uSatDay,uSatNight,uNight);',
                    '  float warm=mix(uWarmDay,uWarmNight,uNight);',
                    '  vec3 col=texture2D(tDiffuse,vUv).rgb*exposure;',
                    '  col=aces(col);',
                    '  col=pow(max(col,vec3(0.0)),vec3(gamma));',  // 黑场塑形：夜间强力压中暗部、白天轻微
                    '  col=(col-0.18)*contrast+0.18;',
                    '  float lum=dot(col,vec3(0.299,0.587,0.114));',  // P12-e 饱和回升去发白
                    '  col=mix(vec3(lum),col,sat);',
                    '  col*=mix(vec3(1.0),vec3(1.045,1.0,0.92),warm);',  // P12-e 微暖做旧
                    '  gl_FragColor=vec4(clamp(col,0.0,1.0),1.0);',
                    '}'
                  ].join('\n')
                };
                this._cine = new T.ShaderPass(cineShader);
                comp.addPass(this._cine);
              }

              const il = new T.ShaderPass(illusShader);
              il.needsSwap = true;
              if (cineOn) {
                // HDR/ACES 自带胶片质感：减弱纸纹避免暗部噪点被黑场塑形放大，微补墨线维持版画轮廓
                il.uniforms.grain.value = 0.018;
                il.uniforms.lineStrength.value = 0.64;
              }
              comp.addPass(il);
              this._illustration = il;

              // 最末线性→sRGB 编码（r128 无 OutputPass；renderer.outputEncoding 保持 Linear 由此外置，杜绝双重编码）
              if (cineOn && T.ShaderPass) {
                const srgbShader = {
                  uniforms: { tDiffuse: { value: null } },
                  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
                  fragmentShader: [
                    'uniform sampler2D tDiffuse; varying vec2 vUv;',
                    'vec3 enc(vec3 c){ return mix(c*12.92/1.0,1.055*pow(c,vec3(1.0/2.4))-0.055,step(vec3(0.0031308),c)); }',
                    'void main(){ vec3 c=texture2D(tDiffuse,vUv).rgb; gl_FragColor=vec4(enc(clamp(c,0.0,1.0)),1.0); }'
                  ].join('\n')
                };
                this._srgb = new T.ShaderPass(srgbShader);
                comp.addPass(this._srgb);
              }
            }
          } catch (e) { console.warn('[Pano3D] godrays disabled', e); }

        }
      } catch (e) { console.warn('[Pano3D] bloom disabled', e); }

      // 雾/天空
      scene.fog = new T.FogExp2(0x6a7280, 0.011);
      this._buildSky(scene);
      // 灯光
      this._hemi = new T.HemisphereLight(0x9fb4d0, 0x33291e, .24);
      scene.add(this._hemi);
      const sun = new T.DirectionalLight(0xffd2a0, 2.2);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.left = -30; sun.shadow.camera.right = 30;
      sun.shadow.camera.top = 26; sun.shadow.camera.bottom = -26;
      sun.shadow.camera.far = 90;
      sun.shadow.camera.near = 0.5;
      sun.shadow.camera.updateProjectionMatrix();
      sun.shadow.bias = -0.0006;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.radius = 1;
      sun.target.position.set(-2, 0, 2);
      scene.add(sun.target);
      sun.position.set(-10, 16, -14);
      scene.add(sun); this._sun = sun;
      const moon = new T.DirectionalLight(0x8fa8ff, 0);
      moon.position.set(-7, 8, -4);
      scene.add(moon); this._moon = moon;

      // 地面
      const groundTex = this._texCache.soil || (this._texCache.soil = dirtTexture());
      const fieldTex = this._texCache.field || (this._texCache.field = furrowTexture());
      fieldTex.repeat.set(7, 6);
      groundTex.repeat.set(30, 20);
      const ground = new T.Mesh(new T.PlaneGeometry(90, 60), new T.MeshStandardMaterial({ map: groundTex, roughness: 1 }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = 0; ground.receiveShadow = true;
      scene.add(ground);
      // 草地/荒地表层（远景）
      const outer = new T.Mesh(new T.PlaneGeometry(200, 140), new T.MeshStandardMaterial({ map: this._texCache.grass || (this._texCache.grass = grassTexture()), roughness: 1, color: 0x6a6a4e }));
      outer.rotation.x = -Math.PI / 2; outer.position.y = -0.02; scene.add(outer);

      // 耕地（前景，明显抬高的田块）
      this._field = new T.Group(); scene.add(this._field);
      const fieldBed = new T.Mesh(new T.PlaneGeometry(12.8, 10.6), new T.MeshStandardMaterial({ map: fieldTex, roughness: 1, color: 0xb09068 }));
      fieldBed.rotation.x = -Math.PI / 2; fieldBed.position.set(-3.7, .02, 5.3); fieldBed.receiveShadow = true;

      this._field.add(fieldBed);
      // 田埂边
      for (const [x, z, w, d] of [[-10.3, 5.3, .3, 10.6], [2.7, 5.3, .3, 10.6]]) {
        const edge = new T.Mesh(new T.BoxGeometry(w, .18, d), new T.MeshStandardMaterial({ color: '#3a2d1e', roughness: 1 }));
        edge.position.set(x, .09, z); this._field.add(edge);
      }

      // 建筑
      this._buildings.house = houseModel(0); this._buildings.house.position.set(3.8, 0, -7.0); scene.add(this._buildings.house);
      this._buildings.barn = barnModel(); this._buildings.barn.position.set(-6.6, 0, -4.4); scene.add(this._buildings.barn);
      this._buildings.greenhouse = greenhouseModel(0); this._buildings.greenhouse.position.set(8.4, 0, -0.6); this._buildings.greenhouse.rotation.y = -.25; scene.add(this._buildings.greenhouse);
      this._buildings.workshop = workshopModel(0); this._buildings.workshop.position.set(.6, 0, -9.2); scene.add(this._buildings.workshop);
      this._buildings.lab = labModel(0); this._buildings.lab.position.set(11.0, 0, -7.8); scene.add(this._buildings.lab);

      // 接触阴影（弥补实时阴影不足，给建筑落地感）
      const shadowTex = canvasTex(128, 64, (c, w, h) => {
        const g = c.createRadialGradient(w/2, h/2, 2, w/2, h/2, w/2);
        g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g; c.fillRect(0, 0, w, h);
      });
      this._shadowTex = shadowTex;
      const addShadow = (x, z, sx, sz) => {
        const m = new T.Mesh(new T.PlaneGeometry(sx, sz), new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
        m.rotation.x = -Math.PI / 2; m.position.set(x, .04, z); scene.add(m);
      };
      addShadow(4.2, -8.5, 7, 5); addShadow(-7.5, -5.5, 6, 4.5); addShadow(8.6, -1.0, 5, 5);
      addShadow(.2, -10.5, 4, 3.5); addShadow(11.5, -9.0, 3.5, 3.5);
      // ===== 程序化山体（三层山脊，越远越淡）=====
      const ridge = (z, col, amp, seed, baseY) => {
        const N = 140;
        const pos = [];
        const idx = [];
        const height = (x) => {
          const n = Math.sin(x * .021 + seed) * .5 + Math.sin(x * .057 + seed * 2.1) * .26 + Math.sin(x * .131 + seed * 3.7) * .12;
          return baseY + amp * (.52 + .48 * n);
        };
        for (let i = 0; i <= N; i++) {
          const x = -170 + (340 * i / N);
          pos.push(x, height(x), z);
          pos.push(x, -8, z);
        }
        for (let i = 0; i < N; i++) {
          const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
          idx.push(a, b, c, b, d, c);
        }
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
        g.setIndex(idx);
        g.computeVertexNormals();
        const mat = new T.MeshBasicMaterial({ color: col, side: T.DoubleSide, fog: true });
        const mesh = new T.Mesh(g, mat);
        mesh.frustumCulled = false;
        this._scene.add(mesh);
        return mesh;
      };
      this._mountains = new T.Group();
      const m1 = ridge(-76, 0x1b2228, 16, 1.7, -1);
      const m2 = ridge(-104, 0x232b31, 23, 4.3, -1);
      const m3 = ridge(-134, 0x2b3339, 30, 8.1, -2);
      this._mountainMeshes = [m1, m2, m3];
      // 山脚残留工业剪影（少量废都感，不抢山体）
      const ruinMat = new T.MeshStandardMaterial({ color: '#232a30', roughness: 1 });
      this._ruins = new T.Group();
      for (let i = 0; i < 18; i++) {
        const side = i % 2 ? 1 : -1;
        const bx = side * (26 + hash(i * 2.7) * 42);
        const bh = 3 + hash(i * 3.3) * 6;
        const bw = 1.4 + hash(i * 5.1) * 2.4;
        const b = new T.Mesh(new T.BoxGeometry(bw, bh, 1.2), ruinMat);
        b.position.set(bx, bh / 2, -68 - hash(i * 7.7) * 6);
        this._ruins.add(b);
      }
      this._scene.add(mergeMeshes(this._ruins));

      // ===== 雾层（三层横向软雾带，缓慢漂移）=====
      const fogTex = canvasTex(512, 128, (c, w, h) => {
        const g = c.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, 'rgba(210,212,205,0)');
        g.addColorStop(.45, 'rgba(214,216,208,.55)');
        g.addColorStop(.6, 'rgba(218,220,212,.6)');
        g.addColorStop(1, 'rgba(214,216,208,0)');
        c.fillStyle = g; c.fillRect(0, 0, w, h);
        for (let i = 0; i < 90; i++) {
          c.fillStyle = 'rgba(230,232,225,' + (.04 + Math.random() * .08) + ')';
          c.beginPath(); c.ellipse(Math.random() * w, h * (.3 + Math.random() * .4), 30 + Math.random() * 70, 6 + Math.random() * 10, 0, 0, 7); c.fill();
        }
      });
      this._fogLayers = [];
      const fogSpec = [[-46, 7.5, 200, 26, .34], [-70, 10, 240, 34, .30], [-95, 13, 300, 44, .26]];
      fogSpec.forEach(([z, y, w, h, op], i) => {
        const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: fogTex, transparent: true, opacity: op, depthWrite: false, fog: false }));
        m.position.set(0, y, z);
        m.userData = { baseX: 0, speed: .35 + i * .22, op };
        this._fogLayers.push(m);
        this._scene.add(m);
      });
      // 枯树 / 石头 / 栅栏
      {
        const treeRoot = new T.Group();
        for (let i = 0; i < 10; i++) {
          const tr = deadTree(.8 + hash(i) * 1.3);
          const side = i % 2 ? 1 : -1;
          tr.position.set(side * (8 + hash(i * 3.1) * 9), 0, -6 + hash(i * 5.3) * 16);
          tr.rotation.y = hash(i) * 6.28;
          treeRoot.add(tr);
        }
        scene.add(mergeMeshes(treeRoot));
      }
      {
        const rockRoot = new T.Group();
        for (let i = 0; i < 26; i++) {
          const rk = rock(.2 + hash(i) * .5);
          rk.position.set(-14 + hash(i * 2.1) * 28, 0, -8 + hash(i * 4.7) * 18);
          rk.rotation.y = hash(i) * 6.28;
          rockRoot.add(rk);
        }
        scene.add(mergeMeshes(rockRoot));
      }
      // 地面污渍贴片（草皮/泥泞/干草堆）
      try {
        const patchTex = canvasTex(128, 128, (c, w, h) => {
          const g = c.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
          g.addColorStop(0, 'rgba(60,48,28,.55)'); g.addColorStop(.7, 'rgba(60,48,28,.25)'); g.addColorStop(1, 'rgba(60,48,28,0)');
          c.fillStyle = g; c.fillRect(0, 0, w, h);
          for (let i = 0; i < 120; i++) {
            c.fillStyle = 'rgba(110,90,50,.35)';
            c.fillRect(Math.random() * w, Math.random() * h, 2, 1);
          }
        });
        for (let i = 0; i < 14; i++) {
          const m = new T.Mesh(new T.PlaneGeometry(1.5 + hash(i) * 2.2, 1.1 + hash(i + 2) * 1.8), new T.MeshBasicMaterial({ map: patchTex, transparent: true, depthWrite: false }));
          m.rotation.x = -Math.PI / 2;
          m.position.set(-14 + hash(i * 3.1) * 26, .03, -8 + hash(i * 5.7) * 20);
          this._scene.add(m);
        }
      } catch (e) {}
      // 草丛（散布，增加细节）
      const grassMat = new T.MeshStandardMaterial({ color: '#6a7440', roughness: 1 });
      const grassRoot = new T.Group();
      for (let i = 0; i < 140; i++) {
        const tuft = new T.Group();
        for (let k = 0; k < 3; k++) {
          const blade = new T.Mesh(new T.ConeGeometry(.035, .22 + hash(i + k) * .16, 3), grassMat);
          blade.position.set((hash(i * 3 + k) - .5) * .18, .12, (hash(i * 5 + k) - .5) * .18);
          blade.rotation.z = (hash(i + k) - .5) * .5;
          tuft.add(blade);
        }
        tuft.position.set(-24 + hash(i * 2.3) * 46, 0, -12 + hash(i * 6.1) * 24);
        grassRoot.add(tuft);
      }
      // ===== 农场道具与环境细节 =====
      const propWood = clampedTexMat('wood', '#8a6a4a', [1, 1], 1);
      const propRust = clampedTexMat('rust', '#7a6a58', [1, 1], .85, .2);
      const propDark = new T.MeshStandardMaterial({ color: '#3a352c', roughness: 1 });
      const addBarrel = (x, z, s) => {
        const g = new T.Group();
        const b = new T.Mesh(new T.CylinderGeometry(.28 * s, .26 * s, .72 * s, 10), propRust);
        b.position.y = .36 * s; g.add(b);
        for (const y of [.16, .58]) {
          const ring = new T.Mesh(new T.TorusGeometry(.285 * s, .022 * s, 4, 12), propDark);
          ring.rotation.x = Math.PI / 2; ring.position.y = y * s; g.add(ring);
        }
        g.position.set(x, 0, z); g.rotation.y = hash(x + z) * 6.28;
        g.userData.prop = 'barrel';
        g.userData.static = true;
        g.traverse(o => { if (o.isMesh) o.castShadow = true; });
        this._scene.add(g);
      };
      const addCrate = (x, z, s, ry) => {
        const c = new T.Mesh(new T.BoxGeometry(.6 * s, .5 * s, .6 * s), propWood);
        c.position.set(x, .25 * s, z); c.rotation.y = ry; c.castShadow = true;
        c.userData.prop = 'crate';
        c.userData.static = true;
        this._scene.add(c);
      };
      addBarrel(-4.6, -3.2, 1); addBarrel(-4.1, -3.6, .85); addBarrel(5.6, -6.4, 1.1);
      addBarrel(5.1, -6.9, .9); addBarrel(-8.6, 1.8, 1); addBarrel(9.2, -7.4, 1.05);
      addCrate(2.2, -5.6, 1, .2); addCrate(2.7, -5.2, .9, -.3); addCrate(2.4, -5.0, .7, .5);
      addCrate(-6.2, -2.6, 1.1, .1); addCrate(8.4, -3.4, .95, -.2);
      // 断裂石墙
      for (let i = 0; i < 14; i++) {
        if (i % 5 === 4) continue;
        const wall = new T.Mesh(new T.BoxGeometry(1.1, .5 + hash(i) * .25, .45), new T.MeshStandardMaterial({ color: '#4a463c', roughness: 1 }));
        wall.position.set(-12.4 + i * 1.15, .3, 12.1); wall.rotation.y = (hash(i) - .5) * .08;
        wall.castShadow = true; wall.receiveShadow = true;
        wall.userData.static = true;
        this._scene.add(wall);
      }
      // 水塔
      {
        const tower = new T.Group();
        for (const [dx, dz] of [[-.9, -.9], [.9, -.9], [-.9, .9], [.9, .9]]) {
          const leg = new T.Mesh(new T.CylinderGeometry(.07, .1, 3.4, 5), propRust);
          leg.position.set(dx, 1.7, dz); tower.add(leg);
        }
        const tank = new T.Mesh(new T.CylinderGeometry(.95, .95, 1.1, 12), propRust);
        tank.position.y = 3.9; tower.add(tank);
        const cap = new T.Mesh(new T.ConeGeometry(1.0, .45, 12), propDark);
        cap.position.y = 4.55; tower.add(cap);
        tower.position.set(-15.5, 0, -5.5);
        tower.userData.prop = 'watertower';
        tower.userData.static = true;
        tower.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        this._scene.add(tower);
      }
      // 筒仓
      {
        const silo = new T.Mesh(new T.CylinderGeometry(1.1, 1.1, 4.2, 14), clampedTexMat('rust', '#9a8a70', [2, 2], .8, .2));
        silo.position.set(-18.5, 2.1, -9.5); silo.castShadow = true; silo.userData.prop = 'silo'; silo.userData.static = true;
        this._scene.add(silo);
        const dome = new T.Mesh(new T.SphereGeometry(1.12, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), propDark);
        dome.position.set(-18.5, 4.2, -9.5); dome.userData.static = true; this._scene.add(dome);
      }
      // 板车（两轮）
      {
        const cart = new T.Group();
        const bed = new T.Mesh(new T.BoxGeometry(1.5, .12, .9), propWood); bed.position.y = .62; cart.add(bed);
        for (const side of [-1, 1]) {
          const rail = new T.Mesh(new T.BoxGeometry(1.5, .3, .06), propWood);
          rail.position.set(0, .8, side * .45); cart.add(rail);
        }
        for (const side of [-1, 1]) {
          const wheel = new T.Mesh(new T.TorusGeometry(.42, .06, 6, 14), propDark);
          wheel.position.set(-.2, .42, side * .55); wheel.rotation.y = Math.PI / 2; cart.add(wheel);
        }
        cart.position.set(-5.6, 0, 2.6); cart.rotation.y = .35;
        cart.userData.prop = 'cart';
        cart.userData.static = true;
        cart.traverse(o => { if (o.isMesh) o.castShadow = true; });
        this._scene.add(cart);
      }
      // 路灯（夜里两盏暖光）
      this._lampLights = [];
      const addLamp = (x, z) => {
        const post = new T.Mesh(new T.CylinderGeometry(.06, .09, 2.2, 6), propDark);
        post.position.set(x, 1.1, z); post.castShadow = true; post.userData.static = true; this._scene.add(post);
        const arm = new T.Mesh(new T.BoxGeometry(.5, .06, .06), propDark);
        arm.position.set(x + .22, 2.15, z); arm.userData.static = true; this._scene.add(arm);
        const bulbMat = new T.MeshStandardMaterial({ color: '#ffcf8a', emissive: new T.Color('#ffb85a'), emissiveIntensity: 0, roughness: .4 });
        const bulb = new T.Mesh(new T.BoxGeometry(.26, .2, .26), bulbMat);
        bulb.position.set(x + .44, 2.02, z); bulb.userData.static = true; this._scene.add(bulb);
        const pl = new T.PointLight(0xffb85a, 0, 6.5);
        pl.position.set(x + .44, 1.95, z); this._scene.add(pl);
        this._lampLights.push({ mat: bulbMat, light: pl });
      };
      addLamp(1.1, -4.4); addLamp(6.6, -2.2);
      // 土路 + 车辙
      {
        const pathTex = canvasTex(256, 256, (c, w, h) => {
          c.fillStyle = '#6e5638'; c.fillRect(0, 0, w, h);
          for (let i = 0; i < 1800; i++) {
            c.fillStyle = Math.random() > .5 ? 'rgba(150,124,84,.25)' : 'rgba(40,28,16,.30)';
            c.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 3, 1 + Math.random() * 2);
          }
        });
        pathTex.repeat.set(2, 10);
        const road = new T.Mesh(new T.PlaneGeometry(3.0, 17), new T.MeshStandardMaterial({ map: pathTex, roughness: 1, color: 0x9a7a52 }));
        road.rotation.x = -Math.PI / 2; road.position.set(3.4, .03, 3.6); road.receiveShadow = true; road.userData.static = true;
        this._scene.add(road);
        const rutMat = new T.MeshBasicMaterial({ color: 0x4a3a24, transparent: true, opacity: .35, depthWrite: false });
        for (const dx of [-.5, .5]) {
          const rut = new T.Mesh(new T.PlaneGeometry(.16, 16), rutMat);
          rut.rotation.x = -Math.PI / 2; rut.position.set(3.4 + dx, .045, 3.6);
          rut.userData.static = true;
          this._scene.add(rut);
        }
      }
      // 田块木桩边界（让 16 块地更可读）
      for (let i = 0; i < 5; i++) {
        const post = new T.Mesh(new T.BoxGeometry(.1, .5, .1), propWood);
        post.position.set(-11.6 + i * 3.2, .25, 13.0); post.castShadow = true; post.userData.static = true; this._scene.add(post);
      }
      // 道具接触阴影（保底落地感）
      const csPlane = (x, z, sx, sz) => {
        const m = new T.Mesh(new T.PlaneGeometry(sx, sz), new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: .85 }));
        m.rotation.x = -Math.PI / 2; m.position.set(x, .05, z);
        m.userData.static = true;
        this._scene.add(m);
      };
      csPlane(-4.6, -3.2, 1.1, 1.0); csPlane(-4.1, -3.6, .9, .9); csPlane(5.6, -6.4, 1.2, 1.1);
      csPlane(5.1, -6.9, 1.0, .9); csPlane(-8.6, 1.8, 1.1, 1.0); csPlane(9.2, -7.4, 1.2, 1.1);
      csPlane(2.4, -5.3, 2.2, 1.8); csPlane(-6.2, -2.6, 1.4, 1.3); csPlane(8.4, -3.4, 1.2, 1.2);
      csPlane(-5.6, 2.6, 2.4, 1.8);
      csPlane(-15.5, -5.5, 3.2, 3.2); csPlane(-18.5, -9.5, 3.0, 3.0);
      csPlane(1.1, -4.4, .9, .9); csPlane(6.6, -2.2, .9, .9);
      this._scene.add(mergeMeshes(grassRoot));
      // 栅栏沿田边
      const fenceMat = clampedTexMat('wood', '#7a6244', [3, 1], 1);
      {
        const fenceRoot = new T.Group();
        for (let i = 0; i < 26; i++) {
          const post = new T.Mesh(new T.BoxGeometry(.09, .9, .09), fenceMat);
          post.position.set(-11 + i * .9, .45, 11.4); fenceRoot.add(post);
        }
        const rail = new T.Mesh(new T.BoxGeometry(23, .08, .08), fenceMat); rail.position.set(.7, .72, 11.4); fenceRoot.add(rail);
        const rail2 = new T.Mesh(new T.BoxGeometry(23, .07, .07), fenceMat); rail2.position.set(.7, .4, 11.4); fenceRoot.add(rail2);
        scene.add(mergeMeshes(fenceRoot));
      }

      // ===== P13-d 废土环境（外围氛围件，farmEnvP13）=====
      if (FARM_ENV_P13) {
        const envRust = clampedTexMat('rust', '#6a5c48', [2, 1], .9, .25);
        const envDark = new T.MeshStandardMaterial({ color: '#2c2822', roughness: 1 });
        // 焦土斑块（深褐黑径向纹理贴地）
        try {
          const burnTex = canvasTex(128, 128, (c, w, h) => {
            const g = c.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
            g.addColorStop(0, 'rgba(18,14,10,.78)'); g.addColorStop(.55, 'rgba(30,22,14,.45)'); g.addColorStop(1, 'rgba(30,22,14,0)');
            c.fillStyle = g; c.fillRect(0, 0, w, h);
            for (let i = 0; i < 160; i++) {
              c.fillStyle = 'rgba(8,6,4,.5)';
              c.beginPath(); c.arc(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 0, 7); c.fill();
            }
          });
          const burns = [[-6, -14.5, 2.6, 2.0], [2, -15.8, 3.2, 2.4], [8, -14, 2.2, 1.8], [-12, -16.2, 2.8, 2.2], [12.5, -15.6, 2.4, 1.9], [-1.5, -17.4, 2.0, 1.6]];
          burns.forEach(([bx, bz, bw, bd], i) => {
            const b = new T.Mesh(new T.PlaneGeometry(bw, bd), new T.MeshBasicMaterial({ map: burnTex, transparent: true, depthWrite: false, opacity: .9 }));
            b.rotation.x = -Math.PI / 2; b.position.set(bx, .035 + i * .001, bz);
            this._scene.add(b);
          });
        } catch (e) {}
        // 核废料桶（黄黑警示，辐射符号画在侧面纹理）
        try {
          const hazTex = canvasTex(64, 96, (c, w, h) => {
            c.fillStyle = '#d8b23a'; c.fillRect(0, 0, w, h);
            c.fillStyle = '#23201a';
            for (let i = 0; i < 8; i++) { if (i % 2 === 0) c.fillRect(i * 8, 0, 4, h); }
            c.fillStyle = '#1c1a14';
            c.beginPath(); c.moveTo(w / 2, 18); c.lineTo(w / 2 - 9, 44); c.lineTo(w / 2 + 9, 44); c.closePath(); c.fill();
            for (let a = 0; a < 3; a++) {
              const ang = -Math.PI / 2 + a * Math.PI * 2 / 3;
              c.beginPath();
              c.arc(w / 2, 44, 20, ang, ang + Math.PI / 3);
              c.lineTo(w / 2 + Math.cos(ang + Math.PI / 6) * 8, 44 + Math.sin(ang + Math.PI / 6) * 8);
              c.closePath(); c.fill();
            }
            c.beginPath(); c.arc(w / 2, 44, 3.5, 0, 7); c.fill();
          });
          hazTex.repeat.set(1.6, 1);
          const hazMat = new T.MeshStandardMaterial({ map: hazTex, roughness: .85 });
          const hazSpec = [[3, -16.5, 1], [-4, -16.2, .9], [7.5, -17.6, .95], [-10, -16.8, 1.05]];
          hazSpec.forEach(([hx, hz, hs], i) => {
            const hk = new T.Mesh(new T.CylinderGeometry(.42 * hs, .38 * hs, .9 * hs, 12), hazMat);
            hk.position.set(hx, .45 * hs, hz); hk.rotation.y = hash(i * 7.7) * 6.28; hk.castShadow = true;
            hk.userData.prop = 'hazard'; this._scene.add(hk);
            const cap = new T.Mesh(new T.CylinderGeometry(.46 * hs, .46 * hs, .08 * hs, 12), envDark);
            cap.position.set(hx, .9 * hs, hz); this._scene.add(cap);
          });
        } catch (e) {}
        // 废车残骸 ×2（锈车身 + 轮 + 碎玻璃，倾斜翻倒感）
        const addWreck = (x, z, ry, tilt) => {
          const wk = new T.Group();
          const body = new T.Mesh(new T.BoxGeometry(2.3, .55, 1.15), envRust);
          body.position.y = .5; wk.add(body);
          const cabin = new T.Mesh(new T.BoxGeometry(1.6, .5, 1.05), envRust);
          cabin.position.set(-.3, 1.0, 0); wk.add(cabin);
          const hood = new T.Mesh(new T.BoxGeometry(1.0, .14, 1.0), envDark);
          hood.position.set(.9, .82, 0); hood.rotation.x = .25; wk.add(hood);
          for (const side of [-1, 1]) {
            for (const px of [-.55, .55]) {
              const wh = new T.Mesh(new T.TorusGeometry(.3, .09, 6, 12), envDark);
              wh.position.set(px, .32, side * .58); wh.rotation.y = Math.PI / 2; wk.add(wh);
            }
            const glass = new T.Mesh(new T.BoxGeometry(.9, .18, .02), new T.MeshStandardMaterial({ color: '#7a8a92', roughness: .15, metalness: .3, transparent: true, opacity: .55 }));
            glass.position.set(-.3, 1.02, side * .53); wk.add(glass);
          }
          wk.position.set(x, 0, z); wk.rotation.y = ry; wk.rotation.z = tilt;
          wk.userData.prop = 'wreck';
          wk.traverse(o => { if (o.isMesh) o.castShadow = true; });
          this._scene.add(wk);
        };
        addWreck(6.2, -14.6, .5, .06); addWreck(-8.5, -16.4, -.35, -.08);
        // 废油桶堆（倒伏/半埋）
        const oilSpec = [[11.5, -13.6, 1.1, 1], [14.2, -12.6, .9, .3], [-12.5, -14.2, .95, -.4], [9.8, -16.6, .85, 1.4], [-14.6, -15.4, 1.0, 2.2]];
        oilSpec.forEach(([ox, oz, os, orz], i) => {
          const drum = new T.Mesh(new T.CylinderGeometry(.3 * os, .3 * os, .8 * os, 10), envRust);
          drum.position.set(ox, .4 * os, oz); drum.rotation.z = orz; drum.castShadow = true;
          drum.userData.prop = 'oilDrum'; this._scene.add(drum);
        });
        // 破损围栏 ×2 段（倾斜立柱 + 断横杆）
        const addBrokenFence = (x0, z, span, dir) => {
          const fr = new T.Group();
          for (let i = 0; i < 5; i++) {
            const p = new T.Mesh(new T.BoxGeometry(.1, 1.0 + hash(i * 3.1) * .3, .1), envDark);
            p.position.set(x0 + i * span / 4, .5, z);
            p.rotation.z = (hash(i * 5.3) - .5) * .5; p.rotation.x = dir * (hash(i * 7.1) - .5) * .35;
            fr.add(p);
          }
          const rail = new T.Mesh(new T.BoxGeometry(span, .08, .08), envRust);
          rail.position.set(x0 + span / 2, 1.05, z); rail.rotation.z = .18; fr.add(rail);
          fr.traverse(o => { if (o.isMesh) o.castShadow = true; });
          fr.userData.prop = 'brokenFence'; this._scene.add(fr);
        };
        addBrokenFence(-14.5, -13.2, 5.5, 1); addBrokenFence(7.8, -15.2, 4.8, -1);
        // 倾斜电线杆 ×2（杆 + 横担 + 垂落电线）
        const addPole = (x, z, dir) => {
          const pg = new T.Group();
          const pole = new T.Mesh(new T.CylinderGeometry(.06, .1, 3.6, 7), envDark);
          pole.position.y = 1.8; pg.add(pole);
          const arm = new T.Mesh(new T.BoxGeometry(1.4, .07, .07), envDark);
          arm.position.set(0, 3.1, 0); pg.add(arm);
          const curve = new T.CatmullRomCurve3([
            new T.Vector3(-.7, 3.05, 0), new T.Vector3(-.35, 2.35, 0), new T.Vector3(0, 2.55, 0),
            new T.Vector3(.35, 2.0, 0), new T.Vector3(.7, 2.45, 0)
          ]);
          const wire = new T.Mesh(new T.TubeGeometry(curve, 8, .018, 4, false), envDark);
          pg.add(wire);
          pg.position.set(x, 0, z); pg.rotation.z = dir * .14; pg.rotation.y = hash(x) * 6.28;
          pg.userData.prop = 'pole';
          pg.traverse(o => { if (o.isMesh) o.castShadow = true; });
          this._scene.add(pg);
        };
        addPole(-13.2, -15.2, -1); addPole(13.4, -16.8, 1);
        // 近地灰雾带（外围低矮，加深废土氛围）
        try {
          const dustTex = canvasTex(256, 64, (c, w, h) => {
            const g = c.createLinearGradient(0, 0, 0, h);
            g.addColorStop(0, 'rgba(120,116,104,0)'); g.addColorStop(.5, 'rgba(128,124,110,.4)'); g.addColorStop(1, 'rgba(122,118,106,0)');
            c.fillStyle = g; c.fillRect(0, 0, w, h);
            for (let i = 0; i < 60; i++) {
              c.fillStyle = 'rgba(150,146,132,' + (.05 + Math.random() * .08) + ')';
              c.beginPath(); c.ellipse(Math.random() * w, h * (.2 + Math.random() * .6), 20 + Math.random() * 50, 3 + Math.random() * 6, 0, 0, 7); c.fill();
            }
          });
          const dust = new T.Mesh(new T.PlaneGeometry(44, 5), new T.MeshBasicMaterial({ map: dustTex, transparent: true, depthWrite: false, opacity: .5 }));
          dust.rotation.x = -Math.PI / 2; dust.position.set(0, .12, -13.5);
          dust.userData.prop = 'envDust';
          dust.userData.static = true;
          this._scene.add(dust);
        } catch (e) {}
        // P13-e：废土件统一打标进入静态合并
        if (FARM_GRADE_P13) {
          this._scene.traverse(o => {
            if (o.userData && o.userData.prop && /hazard|wreck|oilDrum|brokenFence|pole|envDust/.test(o.userData.prop)) o.userData.static = true;
          });
        }
      }

      // 河流（右侧）
      const water = new T.Mesh(new T.PlaneGeometry(16, 26), new T.MeshStandardMaterial({ color: 0x2a4a52, roughness: .18, metalness: .65 }));
      water.rotation.x = -Math.PI / 2; water.position.set(14, .03, 3); water.receiveShadow = true;
      this._water = water; scene.add(water);

      // 粒子系统
      this._rain = this._makeRain(scene);
      this._snow = this._makeSnow(scene);
      this._ash = this._makeAsh(scene);
      this._fogPts = this._makeFog(scene);
      // P13-e：静态道具统一打标（_addModelDecor/_replacePropsWithModels 的 GLB 也标 static）；
      // 合并统一在 _onModelsReady 末尾执行一次，避免重复几何与替换失效。

      // 事件
      this._onResize = () => this._resize();
      window.addEventListener('resize', this._onResize);
      wrap.addEventListener('mousemove', (e) => {
        const r = wrap.getBoundingClientRect();
        this._mouse.tx = ((e.clientX - r.left) / r.width - .5) * 2;
        this._mouse.ty = ((e.clientY - r.top) / r.height - .5) * 2;
      });
      wrap.addEventListener('mouseleave', () => { this._mouse.tx = 0; this._mouse.ty = 0; });
      // 镜头轨道：自动缓慢环绕 + 拖拽微调
      this._orbit = { yaw: 0, pitch: 0, dragging: false, lastX: 0, lastY: 0, idle: 0 };
      wrap.style.cursor = 'grab';
      wrap.addEventListener('pointerdown', (e) => { this._orbit.dragging = true; this._orbit.lastX = e.clientX; this._orbit.lastY = e.clientY; wrap.style.cursor = 'grabbing'; });
      window.addEventListener('pointerup', () => { this._orbit.dragging = false; wrap.style.cursor = 'grab'; });
      wrap.addEventListener('pointermove', (e) => {
        const o = this._orbit;
        if (!o.dragging) return;
        o.yaw -= (e.clientX - o.lastX) * .003;
        o.pitch = Math.max(-.35, Math.min(.35, o.pitch + (e.clientY - o.lastY) * .002));
        o.lastX = e.clientX; o.lastY = e.clientY; o.idle = 0;
      });
      this._renderer.shadowMap.autoUpdate = false;
      this._renderer.shadowMap.needsUpdate = true;
      this._models = {};
      this._loadModels();
      this._clock = new T.Clock();
      this._lastState = '';
      this._syncState(true);
    },

    _buildSky(scene) {
      const geo = new T.SphereGeometry(120, 24, 16);
      const mat = new T.ShaderMaterial({
        side: T.BackSide, depthWrite: false,
        uniforms: {
          top: { value: new T.Color('#3f5d7a') }, mid: { value: new T.Color('#8fa0a8') }, bot: { value: new T.Color('#d9b48a') },
          sunPos: { value: new T.Vector3(0, .1, -1) }, sunCol: { value: new T.Color('#ffe0a0') }, sunI: { value: 1 }, flash: { value: 0 }
        },
        vertexShader: 'varying vec3 vW; void main(){ vW = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `
          uniform vec3 top; uniform vec3 mid; uniform vec3 bot;
          uniform vec3 sunPos; uniform vec3 sunCol; uniform float sunI; uniform float flash;
          varying vec3 vW;
          void main(){
            float h = clamp(vW.y * .5 + .5, 0., 1.);
            vec3 col = h > .5 ? mix(mid, top, (h - .5) * 2.) : mix(bot, mid, h * 2.);
            float d = max(0., dot(normalize(vW), normalize(sunPos)));
            col += sunCol * pow(d, 180.) * 2.2 * sunI;
            col += sunCol * pow(d, 6.) * .10 * sunI;
            col += vec3(.85,.92,1.) * flash * .8;
            gl_FragColor = vec4(col, 1.0);
          }`
      });
      const sky = new T.Mesh(geo, mat);
      scene.add(sky); this._sky = sky;
      // 星星
      const sg = new T.BufferGeometry();
      const sp = new Float32Array(900 * 3);
      for (let i = 0; i < 900; i++) {
        const u = hash(i * 3.1) * Math.PI * 2, v = hash(i * 7.3) * .78;
        const rr = 90;
        sp[i * 3] = Math.cos(u) * Math.cos(v) * rr;
        sp[i * 3 + 1] = Math.sin(v) * rr * .9 + 6;
        sp[i * 3 + 2] = Math.sin(u) * Math.cos(v) * rr;
      }
      sg.setAttribute('position', new T.BufferAttribute(sp, 3));
      const stars = new T.Points(sg, new T.PointsMaterial({ color: 0xdfe8ff, size: .35, transparent: true, opacity: 0, depthWrite: false }));
      scene.add(stars); this._stars = stars;
      // 太阳/月亮圆盘
      const mkDisc = (col) => new T.Mesh(new T.CircleGeometry(0.85, 24), new T.MeshBasicMaterial({ color: col, transparent: true, opacity: .95, fog: false, depthWrite: false }));
      // 云：程序化软片
      const cloudTex = canvasTex(256, 128, (c, w, h) => {
        const grd = c.createRadialGradient(w/2, h/2, 8, w/2, h/2, w/2);
        grd.addColorStop(0, 'rgba(220,220,214,.75)'); grd.addColorStop(.55, 'rgba(200,202,198,.35)'); grd.addColorStop(1, 'rgba(190,192,188,0)');
        c.fillStyle = grd; c.fillRect(0, 0, w, h);
      });
      this._clouds = new T.Group();
      for (let i = 0; i < 9; i++) {
        const spr = new T.Mesh(new T.PlaneGeometry(22 + hash(i) * 16, 7 + hash(i*2) * 5), new T.MeshBasicMaterial({ map: cloudTex, transparent: true, opacity: .55, depthWrite: false, fog: false }));
        spr.position.set(-40 + hash(i * 3.1) * 80, 22 + hash(i * 5.3) * 12, -55 - hash(i) * 12);
        this._clouds.add(spr);
      }
      scene.add(this._clouds);
      this._sunDisc = mkDisc(0xfff2cc); this._sunDisc.position.set(26, 12, -70); scene.add(this._sunDisc);
      this._moonDisc = mkDisc(0xdfe6ff); this._moonDisc.position.set(-30, 16, -68); this._moonDisc.material.opacity = 0; scene.add(this._moonDisc);
    },

    _makeRain(scene) {
      const N = 1400;
      const g = new T.BufferGeometry();
      const pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        pos[i * 3] = -20 + Math.random() * 40;
        pos[i * 3 + 1] = Math.random() * 24;
        pos[i * 3 + 2] = -12 + Math.random() * 26;
      }
      g.setAttribute('position', new T.BufferAttribute(pos, 3));
      const mat = new T.PointsMaterial({ color: 0xbcd0d4, size: .055, transparent: true, opacity: 0, depthWrite: false });
      const p = new T.Points(g, mat);
      p.visible = false; scene.add(p);
      p.userData = { N, vel: new Float32Array(N).map(() => 14 + Math.random() * 8) };
      return p;
    },
    _makeSnow(scene) {
      const N = 900;
      const g = new T.BufferGeometry();
      const pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        pos[i * 3] = -22 + Math.random() * 44;
        pos[i * 3 + 1] = Math.random() * 22;
        pos[i * 3 + 2] = -14 + Math.random() * 30;
      }
      g.setAttribute('position', new T.BufferAttribute(pos, 3));
      const p = new T.Points(g, new T.PointsMaterial({ color: 0xf0f6fa, size: .10, transparent: true, opacity: 0, depthWrite: false }));
      p.visible = false; scene.add(p);
      p.userData = { N };
      return p;
    },
    _makeAsh(scene) {
      const N = 320;
      const g = new T.BufferGeometry();
      const pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        pos[i * 3] = -22 + Math.random() * 44;
        pos[i * 3 + 1] = .5 + Math.random() * 12;
        pos[i * 3 + 2] = -16 + Math.random() * 30;
      }
      g.setAttribute('position', new T.BufferAttribute(pos, 3));
      const p = new T.Points(g, new T.PointsMaterial({ color: 0xd8c8a8, size: .07, transparent: true, opacity: .5, depthWrite: false }));
      scene.add(p); p.userData = { N };
      return p;
    },
    _makeFog(scene) {
      const N = 26;
      const g = new T.BufferGeometry();
      const pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        pos[i * 3] = -20 + Math.random() * 40;
        pos[i * 3 + 1] = .8 + Math.random() * 2.4;
        pos[i * 3 + 2] = -18 + Math.random() * 26;
      }
      g.setAttribute('position', new T.BufferAttribute(pos, 3));
      const mat = new T.PointsMaterial({ color: 0xd8dcd2, size: 3.2, transparent: true, opacity: 0, depthWrite: false });
      const p = new T.Points(g, mat); p.visible = false;
      scene.add(p); p.userData = { N };
      return p;
    },

    /* ================= Blender GLB 模型 ================= */
    _models: {}, _modelsReady: false, _modelsLoading: false,
    _loadModels() {
      if (this._modelsReady || this._modelsLoading) return;
      if (!T.GLTFLoader || !window.FARM_MODELS) { this._modelsReady = true; return; }
      this._modelsLoading = true;
      const loader = new T.GLTFLoader();
      const names = Object.keys(window.FARM_MODELS);
      const decode = (b64) => {
        const bin = atob(b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return arr.buffer;
      };
      let pending = names.length;
      const finish = () => { if (--pending <= 0) this._onModelsReady(); };
      names.forEach(name => {
        try {
          loader.parse(decode(window.FARM_MODELS[name]), '', (gltf) => {
            try {
              const root = gltf.scene;
              this._applyModelMaterials(root);
              root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
              this._models[name] = root;
              // P13-b：拆出 4 阶段子组（s0 种子堆 / s1 苗 / s2 成株 / s3 成熟），按需单独 clone
              try {
                this._cropStages = this._cropStages || {};
                const stages = {};
                ['s0', 's1', 's2', 's3'].forEach(s => {
                  const g = root.getObjectByName(s);
                  if (g) stages[s] = g;
                });
                if (Object.keys(stages).length) this._cropStages[name] = stages;
              } catch (e) {}
            } catch (e) { console.warn('[Pano3D] model prep fail', name, String(e).slice(0, 120)); }
            finish();
          }, (err) => { console.warn('[Pano3D] glb parse fail', name, String(err).slice(0, 120)); finish(); });
        } catch (e) { finish(); }
      });
    },
    _onModelsReady() {
      this._modelsReady = true; this._modelsLoading = false;
      try { this._replacePropsWithModels(); } catch (e) {}
      try { this._addModelDecor(); } catch (e) {}
      // P13-e：模型就绪后统一执行静态道具合并（GLB 装饰/替换件已在场景内）
      try { this._mergeStaticPass(); } catch (e) { console.warn('[P13-e] static merge failed', e); }
      try { this._syncState(true); } catch (e) {}
    },
    // P13-e：收集 scene 中所有 userData.static 的 mesh 并按材质合并为单个 Group
    _mergeStaticPass() {
      if (!FARM_GRADE_P13) return;
      const statics = [];
      this._scene.traverse(o => { if (o.userData && o.userData.static && o.isMesh) statics.push(o); });
      if (!statics.length) return;
      statics.forEach(o => { if (o.parent) o.parent.remove(o); });
      const bucket = new T.Group();
      statics.forEach(o => bucket.add(o));
      const merged = mergeMeshes(bucket);
      // 静态道具不进实时阴影 pass（落地感由接触阴影 csPlane 承担），否则 draw call 翻倍
      merged.traverse(o => { if (o.isMesh) o.castShadow = false; });
      merged.userData.staticMerged = '1';
      this._scene.add(merged);
    },
    _addModelDecor() {
      const add = (name, x, z, ry, s) => {
        const root = this._models[name];
        if (!root) return null;
        const inst = root.clone(true);
        inst.position.set(x, 0, z);
        inst.rotation.y = ry || 0;
        inst.scale.setScalar(s || 1);
        inst.userData.isModelProp = '1';
        inst.userData.static = true;
        inst.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.static = true; } });
        this._scene.add(inst);
        return inst;
      };
      // 土路两侧栅栏段
      for (let i = 0; i < 5; i++) {
        add('fence', 2.0, 1.2 + i * 2.1, Math.PI / 2, 1.0);
        add('fence', 5.4, 1.2 + i * 2.1, Math.PI / 2, 1.0);
      }
      // 场景边缘枯树模型
      add('deadtree', -14.5, 3.5, .6, 1.15);
      add('deadtree', 13.5, -2.5, 2.1, 1.25);
      add('deadtree', -10.5, 9.5, 1.2, .95);
      // 原有补充
      add('barrel', 7.6, -5.2, .4, 1.0);
      add('crate', 4.8, -4.6, .3, 1.0);

      // ===== 细节道具 =====
      add('well', -4.4, 3.2, .3, 1.0);
      add('wheelbarrow', 2.2, .9, .8, 1.0);
      add('powerpole', -13.5, 6.0, 0, 1.1);
      add('powerpole', 11.6, 4.2, 0, 1.05);
      add('roadsign', 6.0, 7.0, .35, 1.0);
      add('junkcar', -11.5, 2.2, .9, 1.05);
      add('haybale', -6.9, -3.6, .4, 1.0);
      add('haybale', -7.6, -2.9, 1.1, .9);
      add('pallet', 5.0, -6.2, .2, 1.0);
      add('tire', 7.0, -4.2, 0, 1.0);
      add('tire', 7.45, -3.65, .5, .9);
      add('bucket', 2.8, -3.2, 0, 1.0);
      add('bucket', -3.4, -3.0, .3, 1.0);
      add('firewood', -3.4, -6.4, .3, 1.0);
      add('bench', 3.6, -2.0, 2.4, 1.0);
      add('waterpump', -2.6, 4.4, .5, 1.0);
      add('toolshed', -10.4, -2.4, .2, 1.0);
      // 风车（叶片单独旋转）
      this._decor = { blades: [], chickens: [], smoke: [], chickens0: [] };
      const wm = add('windmill', -9.5, -6.0, .6, 1.0);
      if (wm) wm.traverse(o => { if (o.name && o.name.toLowerCase().indexOf('blades') >= 0) this._decor.blades.push(o); });
      // 鸡群
      const chickenSpots = [[-5.9, 1.1, .4], [-5.1, .5, 2.2], [-6.5, .3, 4.0], [-5.5, 1.7, 1.2]];
      chickenSpots.forEach(([cx, cz, ry], i) => {
        const ch = add('chicken', cx, cz, ry, 1.0);
        if (ch) { ch.userData.home = { x: cx, z: cz, phase: i * 1.7 }; this._decor.chickens.push(ch); }
      });
      // 烟囱炊烟
      this._makeSmoke(5.05, 3.6, -7.6, 34);
      this._makeSmoke(-0.2, 2.05, -9.9, 18);
      this._renderer.shadowMap.needsUpdate = true;
    },
    _makeSmoke(x, y, z, n) {
      const N = n || 30;
      const geo = new T.BufferGeometry();
      const pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - .5) * .2; pos[i * 3 + 1] = Math.random() * 2; pos[i * 3 + 2] = (Math.random() - .5) * .2; }
      geo.setAttribute('position', new T.BufferAttribute(pos, 3));
      const mat = new T.PointsMaterial({ color: 0xd8d2c6, size: .16, transparent: true, opacity: .35, depthWrite: false });
      const pts = new T.Points(geo, mat);
      pts.position.set(x, y, z);
      this._scene.add(pts);
      this._decor.smoke.push({ pts: pts, data: Array.from({ length: N }, () => ({ t: Math.random(), dx: (Math.random() - .5) * .2, dz: (Math.random() - .5) * .2 })) });
    },
    _animateDecor(dt, t) {
      const d = this._decor;
      if (!d) return;
      // 风车叶片
      d.blades.forEach(b => { b.rotation.z += dt * 1.4; });
      // 鸡群慢走
      d.chickens.forEach((ch, i) => {
        const h = ch.userData.home;
        h.phase = (h.phase || 0) + dt * .35;
        const r = 1.1;
        ch.position.x = h.x + Math.cos(h.phase) * r;
        ch.position.z = h.z + Math.sin(h.phase * .8) * r * .6;
        ch.rotation.y = -h.phase + Math.PI / 2;
        if (Math.sin(h.phase * 3 + i) > .9) ch.position.y = Math.abs(Math.sin(t * 8 + i)) * .06;
      });
      // 炊烟
      d.smoke.forEach(S => {
        const arr = S.pts.geometry.attributes.position.array;
        S.data.forEach((p, i) => {
          p.t += dt * .1;
          if (p.t > 1) p.t -= 1;
          arr[i * 3] = p.dx + p.t * .6;
          arr[i * 3 + 1] = p.t * 2.2;
          arr[i * 3 + 2] = p.dz + p.t * .3;
        });
        S.pts.geometry.attributes.position.needsUpdate = true;
      });
    },
    _replacePropsWithModels() {
      const marks = [];
      this._scene.traverse(o => { if (o.userData && o.userData.prop) marks.push(o); });
      marks.forEach(old => {
        const name = old.userData.prop;
        const root = this._models[name];
        if (!root) return;
        const inst = root.clone(true);
        inst.position.set(old.position.x, 0, old.position.z);
        inst.rotation.y = old.rotation.y || 0;
        inst.userData.isModelProp = '1';
        inst.userData.static = true;
        inst.traverse(o => { if (o.isMesh) o.userData.static = true; });
        if (old.parent) old.parent.remove(old);
        this._scene.add(inst);
      });
      this._renderer.shadowMap.needsUpdate = true;
    },
    _modelClone(name) {
      const root = this._models && this._models[name];
      if (!root) return null;
      const c = root.clone(true);
      c.scale.setScalar(1.15);
      return c;
    },
    // P13-c：基础建筑 GLB + 按等级叠加扩展件（同一坐标系，同 1.15 缩放）
    _modelCloneWithLevel(name, extCount) {
      const root = this._models && this._models[name];
      if (!root) return null;
      const g = new T.Group();
      const c = root.clone(true);
      c.scale.setScalar(1.15);
      g.add(c);
      const n = Math.max(0, Math.min(8, extCount | 0));
      for (let i = 1; i <= n; i++) {
        const ext = this._models && this._models[name + '_l' + i];
        if (!ext) continue;
        const e = ext.clone(true);
        e.scale.setScalar(1.15);
        g.add(e);
      }
      return g;
    },
    _modelTexture(key) {
      if (this._modelTexCache && this._modelTexCache[key]) return this._modelTexCache[key];
      let src = null;
      try {
        if (key === 'wood') src = woodTex();
        else if (key === 'rust') src = rustTex();
        else if (key === 'shingle') src = shingleTex();
        else if (key === 'stone') src = this._texCache.soil || (this._texCache.soil = dirtTexture());
        else if (key === 'grass') src = this._texCache.grass || (this._texCache.grass = grassTexture());
      } catch (e) { src = null; }
      if (!src) return null;
      // P13-e：按 key 缓存共享实例（原逐 mesh clone 产生独立 uuid，阻断静态合并，draw call 翻倍）
      const t = src.clone();
      t.needsUpdate = true;
      t.wrapS = t.wrapT = T.RepeatWrapping;
      t.repeat.set(3, 3);
      if (!this._modelTexCache) this._modelTexCache = {};
      this._modelTexCache[key] = t;
      return t;
    },
    _modelNormal(key) {
      try {
        if (!NORMALCACHE[key]) return null;
        if (this._modelNrmCache && this._modelNrmCache[key]) return this._modelNrmCache[key];
        const n = NORMALCACHE[key].clone();
        n.needsUpdate = true;
        n.wrapS = n.wrapT = T.RepeatWrapping;
        n.repeat.set(3, 3);
        if (!this._modelNrmCache) this._modelNrmCache = {};
        this._modelNrmCache[key] = n;
        return n;
      } catch (e) { return null; }
    },
    _modelMat(src) {
      const name = (src.name || '').toLowerCase();
      const m = src.clone();
      m.side = T.FrontSide;
      if (name.indexOf('glass') >= 0) {
        m.transparent = true;
        m.opacity = name.indexOf('warm') >= 0 ? .82 : .4;
        m.roughness = .15; m.metalness = 0; m.depthWrite = false;
        if (name.indexOf('warm') >= 0) { m.emissive = new T.Color(0xffb060); m.emissiveIntensity = 0; }
        return m;
      }
      if (name.indexOf('emissive') >= 0) {
        // P13-b：作物自发光（crop_ 前缀）在 HDR+Bloom 下易过曝，收敛到弱光；建筑/道具保持原强度
        const isCrop = name.indexOf('crop_') === 0;
        const cyan = name.indexOf('cyan') >= 0;
        m.emissive = new T.Color(cyan ? 0x7fdcff : 0xffb45a);
        m.emissiveIntensity = isCrop ? (cyan ? .24 : .18) : (cyan ? .7 : .5);
        return m;
      }
      const TABLE = {
        wood_siding: ['wood', 0xc8a878], wood_dark: ['wood', 0x8a6a4c], wood_red: ['wood', 0xb06040],
        wood_light: ['wood', 0xd8b888], roof_shingle: ['shingle', 0xb09080],
        metal_rust: ['rust', 0xb08968], metal_dark: ['rust', 0x9a9a96],
        stone: ['stone', 0xcfc6b4], bark: ['wood', 0x8a6a4c], hay: ['grass', 0xd8c080],
        plaster: [null, 0xd8d0c0],
        crop_stem: [null, 0x9aab5a], crop_leaf: [null, 0x8cc45e], crop_leaf_dark: [null, 0x6f9c48],
        crop_gold: [null, 0xf0d078], crop_green: [null, 0x86c25a], crop_green_dark: [null, 0x5f9440],
        crop_orange: [null, 0xf0a850], crop_root: [null, 0xe09048], crop_flower: [null, 0xffe066],
        crop_disc: [null, 0x9a7438], crop_rice: [null, 0xe6ecdc], crop_rice_glow: [null, 0xf6fff0],
        // P13-b 新增作物材质
        crop_red: [null, 0xe85848], crop_red_dark: [null, 0xb03828],
        crop_white: [null, 0xe8e2d0], crop_pink: [null, 0xec9aa8],
        crop_dark: [null, 0x4a4060], crop_blue: [null, 0x5a8ac8],
        crop_needle: [null, 0x6a8c40], crop_ash: [null, 0x8a9480], crop_sand: [null, 0x94a858]
      };
      const cfg = TABLE[name] || ['wood', 0xbfa080];
      if (cfg[0]) {
        const tex = this._modelTexture(cfg[0]);
        if (tex) { m.map = tex; m.color = new T.Color(cfg[1]); }
        const nrm = this._modelNormal(cfg[0]);
        if (nrm) { m.normalMap = nrm; m.normalScale = new T.Vector2(.8, .8); }
      } else {
        m.color = new T.Color(cfg[1]);
      }
      if (name.indexOf('metal') >= 0) { m.metalness = .35; m.roughness = Math.min(m.roughness == null ? .7 : m.roughness, .7); }
      return m;
    },
    _applyModelMaterials(root) {
      root.traverse(o => {
        if (!o.isMesh) return;
        const mArr = Array.isArray(o.material) ? o.material : [o.material];
        const isCrop = mArr.some(m => m && (m.name || '').toLowerCase().indexOf('crop_') === 0);
        // 作物：AO 顶点色压缩到 0.62~1.0，保持立体感但不发黑
        if (isCrop) {
          const col = o.geometry && o.geometry.attributes && o.geometry.attributes.color;
          if (col) {
            const src = col.array;
            const max = col.normalized ? ((src instanceof Uint16Array || src instanceof Int16Array) ? 65535 : 255) : 1;
            const out = new Float32Array(src.length);
            for (let i = 0; i < src.length; i++) {
              const v = max === 1 ? src[i] : src[i] / max;
              out[i] = 0.62 + 0.38 * v;
            }
            o.geometry.setAttribute('color', new T.BufferAttribute(out, col.itemSize, false));
          }
        }
        if (Array.isArray(o.material)) o.material = o.material.map(x => this._modelMat(x));
        else if (o.material) o.material = this._modelMat(o.material);
      });
    },
    _applyModelNight(night) {
      const keys = ['house', 'barn', 'greenhouse', 'workshop', 'lab'];
      keys.forEach(k => {
        const root = this._buildings[k];
        if (!root) return;
        root.traverse(o => {
          if (!o.isMesh || !o.material) return;
          const n = (o.material.name || '').toLowerCase();
          if (n.indexOf('glass_warm') >= 0) o.material.emissiveIntensity = night ? 1.1 : 0;
          else if (n.indexOf('emissive_cyan') >= 0) o.material.emissiveIntensity = night ? 2.2 : .6;
          else if (n.indexOf('emissive') >= 0) o.material.emissiveIntensity = night ? 2.4 : .35;
        });
      });
    },

    _resize() {
      if (!this._wrap || !this._renderer) return;
      const w = Math.max(320, this._wrap.clientWidth), h = Math.max(200, this._wrap.clientHeight);
      this._renderer.setSize(w, h, false);
      this._camera.aspect = w / h; this._camera.updateProjectionMatrix();
    },

    /* ---------- 数据同步 ---------- */
    _syncState(force) {
      const G = (typeof GameState !== 'undefined' && GameState) ? GameState : (window.GameState || {});
      const bl = G.buildings || {};
      const lv = id => (bl[id] && bl[id].level) || 0;
      const wk = (G.farmWeather && G.farmWeather.state) || G.weather || 'clear';
      const plots = G.farmPlots || [];
      const n = Math.min(G.unlockedPlots || 16, 48, plots.length || 48);
      const nowMs = Date.now();
      const plotSig = [];
      for (let pi = 0; pi < 48; pi++) {
        const p = plots[pi];
        if (!p || !p.crop) { plotSig.push('-'); continue; }
        const prog = p.ready ? 1 : Math.max(0, Math.min(1, (nowMs - (p.plantedAt || 0)) / Math.max(1, (p.crop.growTime || 30) * 1000)));
        const stage = p.ready ? 'R' : String(Math.min(5, Math.floor(prog * 5)));
        plotSig.push(p.crop.id + stage + (p.status || ''));
      }
      const key = [
        G.season, wk, lv('workshop'), lv('greenhouse'), lv('barn'), lv('lab'),
        n, plotSig.join('.')
      ].join('|');
      if (!force && key === this._lastState) return;
      this._lastState = key;
      const night = this._isNight();
      this._renderer.shadowMap.needsUpdate = true;
      // 建筑等级
      const h = new T.Group();
      // 主屋等级 = 四建筑总级
      const total = lv('workshop') + lv('greenhouse') + lv('barn') + lv('lab');
      // P13-c：主屋按总级分 4 档（0-3/4-7/8-11/12-15），建筑按各自等级叠加扩展件
      const houseLvl = FARM_BUILDINGS_P13 ? Math.min(3, Math.floor(total / 4)) : 0;
      const barnLvl = FARM_BUILDINGS_P13 ? lv('barn') - 1 : 0;
      const ghLvl = FARM_BUILDINGS_P13 ? lv('greenhouse') - 1 : 0;
      const wsLvl = FARM_BUILDINGS_P13 ? lv('workshop') - 1 : 0;
      const labLvl = FARM_BUILDINGS_P13 ? lv('lab') - 1 : 0;
      this._swapBuilding('house', this._modelCloneWithLevel('farmhouse', houseLvl) || houseModel(total));
      if (lv('barn') > 0) this._swapBuilding('barn', this._modelCloneWithLevel('barn', barnLvl) || barnModel());
      if (lv('greenhouse') > 0) this._swapBuilding('greenhouse', this._modelCloneWithLevel('greenhouse', ghLvl) || greenhouseModel(lv('greenhouse')));
      if (lv('workshop') > 0) this._swapBuilding('workshop', this._modelCloneWithLevel('workshop', wsLvl) || workshopModel(lv('workshop')));
      if (lv('lab') > 0) this._swapBuilding('lab', this._modelCloneWithLevel('lab', labLvl) || labModel(lv('lab')));
      // 作物重建
      this._rebuildCrops(plots, n);
      try { this._applyModelNight(night); } catch (e) {}
      // 季节地面色
      const seasonCol = { spring: 0xa89272, summer: 0x9a8a62, autumn: 0xb08a5a, winter: 0xc8d0d8 }[G.season] || 0xa89272;
      if (this._field) this._field.children[0].material.color.setHex(seasonCol);
      // 天气粒子
      const isSnow = G.season === 'winter' || wk === 'snow';
      if (this._rain) { this._rain.visible = ['rain', 'heavy_rain', 'storm'].includes(wk); }
      if (this._snow) { this._snow.visible = isSnow; }
      if (this._fogPts) { this._fogPts.visible = wk === 'fog'; }
    },

    _swapBuilding(name, model) {
      const old = this._buildings[name];
      if (!old || !model) return;
      const pos = old.position.clone(), rot = old.rotation.y;
      this._scene.remove(old);
      // P13-e：建筑组内按材质合并（共享纹理缓存后同材质可合并），draw call 从每 mesh 降到每材质
      if (FARM_GRADE_P13) {
        try { model = mergeMeshes(model); } catch (e) { /* 保留未合并版 */ }
      }
      model.position.copy(pos); model.rotation.y = rot;
      model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this._scene.add(model);
      this._buildings[name] = model;
    },

    _rebuildCrops(plots, n) {
      if (this._cropMeshes) { this._cropMeshes.forEach(m => this._scene.remove(m)); }
      this._cropMeshes = [];
      // 与农田网格一致：8 列 × 6 行 = 48 格（索引 i = r*8 + c，和农场 UI 同序）
      const COLS = 8, ROWS = 6, PITCH = 1.34;
      const CX = -3.6, CZ = 4.3;
      const W = COLS * PITCH, H = ROWS * PITCH;
      const now = Date.now();

      // ---- 田块底板：每格一块土面，按状态合并（位置与作物严格一一对应）----
      const TILE = PITCH * 0.90;
      // 程序化土壤贴图（垄沟 + 颗粒），每个 3D 田块都带纹理，避免纯色看不出土
      if (!this._soilTex3D) {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 256;
        const c = cv.getContext('2d');
        c.fillStyle = '#6b4f34'; c.fillRect(0, 0, 256, 256);
        for (let row = 0; row < 256; row += 24) {
          c.fillStyle = 'rgba(40,26,14,.55)'; c.fillRect(0, row, 256, 9);
          c.fillStyle = 'rgba(160,124,84,.35)'; c.fillRect(0, row + 9, 256, 3);
        }
        for (let i = 0; i < 900; i++) {
          const x = Math.random() * 256, y = Math.random() * 256;
          const s2 = Math.random() > .5 ? 1.6 : 2.6;
          c.fillStyle = Math.random() > .5 ? 'rgba(30,20,10,.35)' : 'rgba(190,156,110,.28)';
          c.fillRect(x, y, s2, s2);
        }
        const tex = new T.CanvasTexture(cv);
        tex.wrapS = tex.wrapT = T.RepeatWrapping;
        tex.repeat.set(1.5, 1.5);
        if (T.sRGBEncoding) tex.encoding = T.sRGBEncoding;
        this._soilTex3D = tex;
      }
      const SOIL = this._soilTex3D;
      const FIELD13 = FARM_FIELD_P13;
      // P13-a：PBR 土壤贴图组缓存（color/bump/roughness）
      if (FIELD13 && !this._soilPbr) this._soilPbr = soilPbrTextures();
      const SPBR = FIELD13 ? this._soilPbr : null;
      // P13-a：厚土板几何（顶部垄沟起伏 + 边缘碎石感），共享缓存，48 格复用同一 BufferGeometry
      if (FIELD13 && !this._tileGeoP13) {
        const seg = 6, sz = TILE, dep = .20;
        const geo = new T.BoxGeometry(sz, dep, sz, seg, 1, seg);
        const pos = geo.attributes.position;
        const col = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
          // 只动顶面（y > 0）：沿 z 做两条垄沟起伏 + 随机微扰
          if (y > 0) {
            const nz = z / sz;
            let yy = -Math.abs(Math.sin(nz * Math.PI * 2)) * .045;   // 两条垄沟
            yy += (hash(Math.floor(x * 7) + Math.floor(z * 5) * 13) - .5) * .018;
            pos.setY(i, y + yy);
          }
          // 顶点 AO：沟底暗、边缘与微扰处略暗、顶面亮
          let ao = 1;
          if (y <= 0) ao = .55;
          else {
            const nz = z / sz;
            ao = .82 + Math.abs(Math.sin(nz * Math.PI * 2)) * .16;   // 垄背亮
            ao *= .94 + (hash(Math.floor(x * 7) + Math.floor(z * 5) * 13)) * .06;
            if (Math.abs(x) > sz * .42 || Math.abs(z) > sz * .42) ao *= .9; // 边缘风化
          }
          col[i * 3] = ao; col[i * 3 + 1] = ao; col[i * 3 + 2] = ao;
        }
        geo.setAttribute('color', new T.BufferAttribute(col, 3));
        this._tileGeoP13 = geo;
      }
      // P13-a 品质 → 状态/湿度/异常联动材质（bucket key 由 状态+湿度档+异常 组合，draw call 有界）
      const tileMats = {};
      const tileMats13 = {};
      const moistOf = (p) => { const m = (p && p.moisture != null) ? p.moisture : 80; return m < 35 ? 'dry' : (m > 65 ? 'moist' : ''); };
      const statusOf = (p) => (p && p.status) || '';
      if (FIELD13) {
        const mk13 = (key, o) => { tileMats13[key] = new T.MeshStandardMaterial(o); };
        const baseSoil = { map: SPBR.color, bumpMap: SPBR.bump, bumpScale: .09, roughnessMap: SPBR.rough, vertexColors: true };
        mk13('wild',   { map: grassTexture(), roughness: 1, vertexColors: true, color: 0x9aa05e });
        mk13('wild2',  { map: grassTexture(), roughness: 1, vertexColors: true, color: 0x8a9052 });
        mk13('tilled',   Object.assign({ color: 0xb99a72, roughness: .92 }, baseSoil));
        mk13('tilled2',  Object.assign({ color: 0xa98a64, roughness: .92 }, baseSoil));
        mk13('tilled-dry',   Object.assign({ color: 0xc9a878, roughness: 1 }, baseSoil));
        mk13('tilled2-dry',  Object.assign({ color: 0xb99868, roughness: 1 }, baseSoil));
        mk13('tilled-moist',   Object.assign({ color: 0x6b5038, roughness: .6 }, baseSoil));
        mk13('tilled2-moist',  Object.assign({ color: 0x604a34, roughness: .6 }, baseSoil));
        mk13('planted',   Object.assign({ color: 0x8a6a48, roughness: .9 }, baseSoil));
        mk13('planted2',  Object.assign({ color: 0x7e6042, roughness: .9 }, baseSoil));
        mk13('planted-dry',   Object.assign({ color: 0xa5845c, roughness: 1 }, baseSoil));
        mk13('planted2-dry',  Object.assign({ color: 0x967a52, roughness: 1 }, baseSoil));
        mk13('planted-moist', Object.assign({ color: 0x5d4430, roughness: .55 }, baseSoil));
        mk13('planted2-moist',Object.assign({ color: 0x553e2c, roughness: .55 }, baseSoil));
        mk13('planted-burn', Object.assign({ color: 0x241a10, roughness: 1 }, baseSoil));
        mk13('planted2-burn',Object.assign({ color: 0x20160e, roughness: 1 }, baseSoil));
        mk13('planted-weeds', Object.assign({ color: 0x7a7a4a, roughness: .95 }, baseSoil));
        mk13('planted2-weeds',Object.assign({ color: 0x6e6e42, roughness: .95 }, baseSoil));
        mk13('planted-pest', Object.assign({ color: 0x7a5a3a, roughness: .95 }, baseSoil));
        mk13('planted2-pest',Object.assign({ color: 0x6e5234, roughness: .95 }, baseSoil));
        mk13('next',   Object.assign({ color: 0xd0a860, roughness: .85, emissive: 0x6a4a10, emissiveIntensity: .35 }, baseSoil));
        mk13('ready',  Object.assign({ color: 0xd0a050, roughness: .8, emissive: 0x7a5410, emissiveIntensity: .5 }, baseSoil));
        mk13('ready2', Object.assign({ color: 0xc49648, roughness: .8, emissive: 0x6a4a0c, emissiveIntensity: .45 }, baseSoil));
      } else {
        tileMats['wild']    = new T.MeshStandardMaterial({ color: 0x4e5c34, roughness: 1 });
        tileMats['wild2']   = new T.MeshStandardMaterial({ color: 0x465428, roughness: 1 });
        tileMats['tilled']  = new T.MeshStandardMaterial({ map: SOIL, color: 0xb99a72, roughness: 1 });
        tileMats['tilled2'] = new T.MeshStandardMaterial({ map: SOIL, color: 0xa98a64, roughness: 1 });
        tileMats['planted'] = new T.MeshStandardMaterial({ map: SOIL, color: 0x8a6a48, roughness: 1 });
        tileMats['planted2']= new T.MeshStandardMaterial({ map: SOIL, color: 0x7e6042, roughness: 1 });
        tileMats['next']    = new T.MeshStandardMaterial({ map: SOIL, color: 0xd0a860, roughness: 1, emissive: 0x6a4a10, emissiveIntensity: .35 });
        tileMats['ready']   = new T.MeshStandardMaterial({ map: SOIL, color: 0xd0a050, roughness: 1, emissive: 0x7a5410, emissiveIntensity: .5 });
        tileMats['ready2']  = new T.MeshStandardMaterial({ map: SOIL, color: 0xc49648, roughness: 1, emissive: 0x6a4a0c, emissiveIntensity: .45 });
      }
      const tileBuckets = {};
      for (let i = 0; i < COLS * ROWS; i++) {
        const col = i % COLS, row = Math.floor(i / COLS);
        const px = CX - W / 2 + (col + .5) * PITCH;
        const pz = CZ + H / 2 - (row + .5) * PITCH;
        const plot = plots[i];
        const unlocked = i < n;
        const planted = unlocked && plot && plot.crop;
        let state = !unlocked ? (i === n ? 'next' : 'wild') : (planted ? (plot && plot.ready ? 'ready' : 'planted') : 'tilled');
        if (state !== 'next' && state !== 'ready' && i % 2) state += '2';
        let key = state, mat = null;
        if (FIELD13) {
          // P13-a：湿度/异常联动 key（planted 系叠加；tilled 只吃湿度；next/ready 保持金芒）
          let suf = '';
          if (state.indexOf('planted') === 0 || state.indexOf('tilled') === 0) {
            const st = statusOf(plot);
            if (st) suf = '-' + st;
            else suf = '-' + moistOf(plot);
          }
          key = state + (suf && suf !== '-dry' ? suf : (suf === '-dry' ? suf : ''));
          mat = tileMats13[key] || tileMats13[state + '-dry'] || tileMats13[state] || tileMats13.tilled;
        } else {
          mat = tileMats[state] || tileMats.tilled;
        }
        const tile = new T.Mesh(FIELD13 ? this._tileGeoP13 : new T.PlaneGeometry(TILE, TILE), mat);
        if (FIELD13) { tile.position.set(px, 0, pz); tile.castShadow = true; }
        else { tile.rotation.x = -Math.PI / 2; tile.position.set(px, .04, pz); }
        tile.receiveShadow = true;
        if (!tileBuckets[key]) tileBuckets[key] = new T.Group();
        tileBuckets[key].add(tile);
      }
      Object.keys(tileBuckets).forEach(k => {
        const m = mergeMeshes(tileBuckets[k]);
        this._scene.add(m);
        this._cropMeshes.push(m);
      });

      // ---- 3D：作物 / 野草 / 成熟光环 / 待扩建木桩 ----
      const cropBucket = new T.Group();
      const grassBucket = new T.Group();
      const glowBucket = new T.Group();
      this._readyGlowMats = [];
      this._readySprites = [];
      const markerBucket = new T.Group();
      for (let i = 0; i < COLS * ROWS; i++) {
        const col = i % COLS, row = Math.floor(i / COLS);
        const px = CX - W / 2 + (col + .5) * PITCH;
        const pz = CZ + H / 2 - (row + .5) * PITCH;
        const plot = plots[i];
        const unlocked = i < n;
        const planted = unlocked && plot && plot.crop;
        if (!unlocked) {
          if (i !== n) {
            for (let k = 0; k < 2; k++) {
              const gw = new T.Mesh(new T.ConeGeometry(.035, .22 + hash(i + k) * .18, 4),
                new T.MeshStandardMaterial({ color: '#77844a', roughness: 1 }));
              gw.position.set(px - .35 + hash(i * 3 + k) * .7, .12, pz - .35 + hash(i * 5 + k) * .7);
              gw.rotation.z = (hash(i + k * 2) - .5) * .5;
              grassBucket.add(gw);
            }
          }
          continue;
        }
        if (!planted) continue;
        const prog = plot.ready ? 1 : clamp((now - (plot.plantedAt || 0)) / Math.max(1, plot.crop.growTime * 1000), 0, 1);
        const modelName = 'crop_' + plot.crop.id;
        const cropModel = this._models && this._models[modelName];
        // P13-b：按生长进度选 4 阶段子组（种子堆 → 苗 → 成株 → 成熟）
        const stages = FARM_CROPS_P13 && this._cropStages && this._cropStages[modelName];
        const stageKey = stages ? (plot.ready || prog >= .8 ? 's3' : prog < .12 ? 's0' : prog < .45 ? 's1' : 's2') : null;
        const sc = .86 + prog * .44;
        const offs = [[-.33, -.30], [.33, .20], [-.05, .38]];
        for (let k = 0; k < offs.length; k++) {
          const sx = px + offs[k][0] + (hash(i * 11 + k) - .5) * .16;
          const sz = pz + offs[k][1] + (hash(i * 17 + k) - .5) * .16;
          const rot = hash(i * 7.7 + k) * 6.28;
          if (cropModel) {
            let inst = null;
            if (stages && stageKey && stages[stageKey]) inst = stages[stageKey].clone(true);
            else inst = cropModel.clone(true);
            // 作物本体不加品质光（P13-b 实测：全株 emissive 在 HDR Bloom 下过曝成白斑）；
            // 品质表达由 P13-a 的品质色成熟环 + 对勾徽章承担。
            inst.scale.setScalar(sc * (.9 + hash(i * 3 + k) * .2));
            inst.position.set(sx, .02, sz);
            inst.rotation.y = rot;
            cropBucket.add(inst);
          } else {
            const crop = cropGroup(plot.crop.id);
            crop.scale.setScalar(sc * 1.3);
            crop.position.set(sx, .06, sz);
            crop.rotation.y = rot;
            cropBucket.add(crop);
          }
        }
        if (plot.ready) {
          // P13-a：成熟环按品质着色（common 金 / rare 青 / epic 紫 / legendary 红），对勾徽章同色
          const qc = qualityGlowColor(plot.quality);
          const ringMat = new T.MeshBasicMaterial({ color: qc, transparent: true, opacity: .55, side: T.DoubleSide, depthWrite: false });
          const ring = new T.Mesh(new T.RingGeometry(.34, .46, 24), ringMat);
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(px, .075, pz);
          const ringMat2 = new T.MeshBasicMaterial({ color: qc, transparent: true, opacity: .3, side: T.DoubleSide, depthWrite: false });
          const ring2 = new T.Mesh(new T.RingGeometry(.52, .56, 24), ringMat2);
          ring2.rotation.x = -Math.PI / 2;
          ring2.position.set(px, .08, pz);
          glowBucket.add(ring); glowBucket.add(ring2);
          this._readyGlowMats.push(ringMat, ringMat2);
          // 漂浮品质色对勾（角标）
          const spr = new T.Sprite(this._readyBadgeMat(qc));
          spr.scale.set(.34, .34, 1);
          spr.position.set(px, 1.05, pz);
          spr.userData.baseY = 1.05;
          this._readySprites.push(spr);
          this._scene.add(spr);
          this._cropMeshes.push(spr);
        }
      }
      // 下一块待扩建：四角木桩 + 绳
      if (n < COLS * ROWS) {
        const col = n % COLS, row = Math.floor(n / COLS);
        const px = CX - W / 2 + (col + .5) * PITCH;
        const pz = CZ + H / 2 - (row + .5) * PITCH;
        let canAfford = false;
        try {
          const ucost = (typeof Farm !== 'undefined' && Farm.getUnlockCost) ? Farm.getUnlockCost(n) : null;
          const fiberHave = (typeof Warehouse !== 'undefined' && Warehouse.getCount) ? Warehouse.getCount('fiber') : 0;
          canAfford = !!ucost && GameState.gold >= ucost.gold && fiberHave >= (ucost.fiber || 0);
        } catch (e) {}
        const postMat = new T.MeshStandardMaterial({ color: canAfford ? '#ffd76a' : '#7a5a3a', roughness: 1, emissive: canAfford ? 0x6a4a08 : 0x000000, emissiveIntensity: canAfford ? .6 : 0 });
        if (FARM_FIELD_P13) {
          // P13-a：待扩建 → 围栏（四立柱 + 双横杆）+ 木公告板（桩 + 板 + 未翻耕草斑）
          const woodMat = new T.MeshStandardMaterial({ color: canAfford ? '#c9a05a' : '#7a5a3a', roughness: .9, emissive: canAfford ? 0x6a4a08 : 0x000000, emissiveIntensity: canAfford ? .4 : 0 });
          for (const [dx, dz] of [[-.62, -.62], [.62, -.62], [-.62, .62], [.62, .62]]) {
            const p = new T.Mesh(new T.BoxGeometry(.08, .72, .08), woodMat);
            p.position.set(px + dx, .36, pz + dz);
            markerBucket.add(p);
          }
          for (const [dx, dy, dz] of [[-.62, .62, 0], [.62, .62, 0], [0, .62, -.62], [0, .62, .62]]) {
            const rail = new T.Mesh(new T.BoxGeometry(dx ? .06 : 1.30, .06, dz ? .06 : 1.30), woodMat);
            rail.position.set(px + (dx ? dx : 0), dy, pz + (dz ? dz : 0));
            markerBucket.add(rail);
          }
          // 公告板：两根短桩 + 一块横木板
          for (const dz of [-.2, .2]) {
            const leg = new T.Mesh(new T.BoxGeometry(.05, .5, .05), woodMat);
            leg.position.set(px + .62, .34, pz + dz);
            markerBucket.add(leg);
          }
          const board = new T.Mesh(new T.BoxGeometry(.05, .42, .42), new T.MeshStandardMaterial({ color: canAfford ? '#e0c080' : '#8a6a44', roughness: .85, emissive: canAfford ? 0x8a5a10 : 0x000000, emissiveIntensity: canAfford ? .5 : 0 }));
          board.position.set(px + .62, .55, pz);
          markerBucket.add(board);
          // 未翻耕的草斑（三簇）
          for (let k = 0; k < 3; k++) {
            const gw = new T.Mesh(new T.ConeGeometry(.05, .26 + hash(n * 3 + k) * .16, 5),
              new T.MeshStandardMaterial({ color: '#6b7644', roughness: 1 }));
            gw.position.set(px - .4 + hash(n * 13 + k) * .8, .14, pz - .4 + hash(n * 7 + k) * .8);
            gw.rotation.z = (hash(n + k * 2) - .5) * .5;
            markerBucket.add(gw);
          }
        } else {
          for (const [dx, dz] of [[-.62, -.62], [.62, -.62], [-.62, .62], [.62, .62]]) {
            const p = new T.Mesh(new T.BoxGeometry(.07, .62, .07), postMat);
            p.position.set(px + dx, .31, pz + dz);
            markerBucket.add(p);
          }
          const rope = new T.Mesh(new T.BoxGeometry(1.24, .025, .025), new T.MeshStandardMaterial({ color: canAfford ? '#ffe08a' : '#c8b070', emissive: canAfford ? 0x6a4a08 : 0x000000, emissiveIntensity: canAfford ? .5 : 0 }));
          rope.position.set(px, .5, pz - .62); markerBucket.add(rope);
          const rope2 = rope.clone(); rope2.position.z = pz + .62; markerBucket.add(rope2);
        }
      }
      const addMerged = (g) => {
        if (!g.children.length) return;
        const m = mergeMeshes(g);
        this._scene.add(m);
        this._cropMeshes.push(m);
      };
      // 田埂土垄（沿 x/z 每格边界），让 48 格网格在 3D 里可读；P13-a 升级为宽土垄 + 外圈金属灌溉渠
      if (FARM_FIELD_P13) {
        const ridgeMat = new T.MeshStandardMaterial({ map: SPBR.color, bumpMap: SPBR.bump, bumpScale: .1, roughnessMap: SPBR.rough, color: 0x9a7a52, roughness: .95, vertexColors: true });
        for (let ci = 1; ci < COLS; ci++) {
          const rx = CX - W / 2 + ci * PITCH;
          const ridge = new T.Mesh(new T.BoxGeometry(.14, .22, H), ridgeMat);
          ridge.position.set(rx, .11, CZ);
          markerBucket.add(ridge);
        }
        for (let ri = 1; ri < ROWS; ri++) {
          const rz = CZ - H / 2 + ri * PITCH;
          const ridge = new T.Mesh(new T.BoxGeometry(W, .22, .14), ridgeMat);
          ridge.position.set(CX, .11, rz);
          markerBucket.add(ridge);
        }
        // 外圈围垄（四边）
        const bd = .16, bh = .26;
        for (const [dx, dz, lx, lz] of [[0, -(H / 2 + .08), W + bd, bd], [0, H / 2 + .08, W + bd, bd], [-(W / 2 + .08), 0, bd, H + bd], [W / 2 + .08, 0, bd, H + bd]]) {
          const ridge = new T.Mesh(new T.BoxGeometry(lx, bh, lz), ridgeMat);
          ridge.position.set(CX + dx, bh / 2, CZ + dz);
          markerBucket.add(ridge);
        }
        // 金属灌溉渠（沿田块左右两侧，锈色金属）
        const irrMat = new T.MeshStandardMaterial({ color: 0x8a7a5a, metalness: .75, roughness: .45 });
        for (const dx of [-(W / 2 + .34), W / 2 + .34]) {
          const trough = new T.Mesh(new T.BoxGeometry(.16, .12, H + .3), irrMat);
          trough.position.set(CX + dx, .3, CZ);
          markerBucket.add(trough);
          // 支撑腿
          for (let k = 0; k < 4; k++) {
            const leg = new T.Mesh(new T.BoxGeometry(.05, .3, .05), irrMat);
            leg.position.set(CX + dx, .15, CZ - H / 2 + .1 + k * (H / 3));
            markerBucket.add(leg);
          }
        }
      } else {
        const ridgeMat = new T.MeshStandardMaterial({ color: '#7a5e3e', roughness: 1 });
        for (let ci = 1; ci < COLS; ci++) {
          const rx = CX - W / 2 + ci * PITCH;
          const ridge = new T.Mesh(new T.BoxGeometry(.09, .05, H), ridgeMat);
          ridge.position.set(rx, .035, CZ);
          markerBucket.add(ridge);
        }
        for (let ri = 1; ri < ROWS; ri++) {
          const rz = CZ - H / 2 + ri * PITCH;
          const ridge = new T.Mesh(new T.BoxGeometry(W, .05, .09), ridgeMat);
          ridge.position.set(CX, .035, rz);
          markerBucket.add(ridge);
        }
      }
      addMerged(cropBucket); addMerged(grassBucket); addMerged(glowBucket); addMerged(markerBucket);
    },

    // 成熟角标贴图（品质色圆底 + 深色对勾），按颜色缓存复用
    _readyBadgeTex(color) {
      const key = '#' + (color || 0xffd76a).toString(16);
      if (this._readyTexMap && this._readyTexMap[key]) return this._readyTexMap[key];
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const c = cv.getContext('2d');
      c.beginPath(); c.arc(32, 32, 29, 0, Math.PI * 2);
      c.fillStyle = key; c.fill();
      c.lineWidth = 5; c.strokeStyle = '#4a3008'; c.stroke();
      c.beginPath(); c.moveTo(18, 34); c.lineTo(28, 44); c.lineTo(47, 21);
      c.lineWidth = 8; c.strokeStyle = '#221a06'; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke();
      const tex = new T.CanvasTexture(cv);
      if (T.sRGBEncoding) tex.encoding = T.sRGBEncoding;
      if (!this._readyTexMap) this._readyTexMap = {};
      this._readyTexMap[key] = tex;
      return tex;
    },
    _readyBadgeMat(color) {
      const key = '#' + (color || 0xffd76a).toString(16);
      if (!this._readySpriteMatMap) this._readySpriteMatMap = {};
      if (!this._readySpriteMatMap[key]) this._readySpriteMatMap[key] = new T.SpriteMaterial({ map: this._readyBadgeTex(color), transparent: true, depthWrite: false });
      return this._readySpriteMatMap[key];
    },

    _isNight() {
      const hr = (typeof window !== 'undefined' && window.PANO_HOUR != null) ? window.PANO_HOUR : (new Date().getHours() + new Date().getMinutes() / 60);
      return hr >= 20 || hr < 5;
    },
    _phase() {
      const hr = (typeof window !== 'undefined' && window.PANO_HOUR != null) ? window.PANO_HOUR : (new Date().getHours() + new Date().getMinutes() / 60);
      return { hr, night: hr >= 20 || hr < 5, dusk: hr >= 17 && hr < 20, dawn: hr >= 5 && hr < 7 };
    },

    frame(now) {
      if (!this._ready || !this._renderer) return false;
      if (this._wrap) {
        const cw = this._wrap.clientWidth, ch = this._wrap.clientHeight;
        if (cw > 0 && ch > 0 && (cw !== this._rw || ch !== this._rh)) {
          this._rw = cw; this._rh = ch;
          this._renderer.setSize(cw, ch, false);
          this._camera.aspect = cw / ch; this._camera.updateProjectionMatrix();
          if (this._composer) this._composer.setSize(cw, ch);
          if (this._illustration) this._illustration.uniforms.res.value.set(cw, ch);
          if (this._bloom) this._bloom.setSize(cw, ch);
        }
      }
      const G = (typeof GameState !== 'undefined' && GameState) ? GameState : (window.GameState || {});
      const dt = Math.min(.05, this._clock.getDelta());
      const t = now / 1000;
      this._syncState(false);
      // 成熟光环呼吸 + 对勾上下浮动
      if (this._readyGlowMats && this._readyGlowMats.length) {
        const ga = .42 + Math.sin(t * 3.2) * .2;
        for (let gi = 0; gi < this._readyGlowMats.length; gi++) this._readyGlowMats[gi].opacity = ga * (gi % 2 ? .62 : 1);
      }
      if (this._readySprites && this._readySprites.length) {
        for (let si = 0; si < this._readySprites.length; si++) {
          const spr = this._readySprites[si];
          spr.position.y = (spr.userData.baseY || 1.05) + Math.sin(t * 2.2 + si) * .08;
        }
      }
      const ph = this._phase();
      const wk = (G.farmWeather && G.farmWeather.state) || G.weather || 'clear';
      const hour = ph.hr;

      // 太阳角度：6 点升起 18 点落下
      const dayT = clamp((hour - 6) / 12, 0, 1);
      const sunAngle = dayT * Math.PI;
      this._sunAngle = sunAngle;
      const sunX = Math.cos(Math.PI - sunAngle) * 30;
      const sunY = Math.sin(sunAngle) * 26;
      this._sun.position.set(sunX * 1.6, Math.max(4, sunY * 1.15), -26);
      this._sunDisc.position.set(sunX * 3.2, Math.max(2, sunY * 3.0), -95);
      this._moonDisc.position.set(-sunX * .9, Math.max(2, 26 - sunY * .6), -68);
      const nightF = ph.night ? 1 : ph.dusk ? .45 : ph.dawn ? .3 : 0;
      // 光照强度
      const weatherDim = { clear: 1, cloud: .82, rain: .62, heavy_rain: .5, storm: .38, fog: .72, snow: .85 }[wk] || 1;
      const dayLight = Math.max(0, Math.sin(sunAngle)) * weatherDim;
      this._sun.intensity = .2 + dayLight * 2.3;
      this._sun.color.setHex(ph.dusk ? 0xffb070 : ph.dawn ? 0xffc0a0 : 0xffd8a8);
      this._moon.intensity = nightF * .8;
      this._hemi.intensity = (FARM_GRADE_P12 ? .22 + dayLight * .46 : .26 + dayLight * .55);
      this._hemi.color.setHex(ph.night ? 0x55688f : ph.dusk ? 0xc09070 : 0x9fb4d0);
      this._hemi.groundColor.setHex(ph.night ? 0x24242c : 0x3a3226);
      // 天空 uniform
      const skyTop = ph.night ? 0x0c1424 : ph.dusk ? 0x3a3a5e : ph.dawn ? 0x4a5a78 : 0x3f5d7a;
      // P12-e：白天天空地平（mid/bot）压暗并略带色，避免整片过曝发白
      // 注：setHex 在 r128 被当作线性值，经末级 sRGB pass 会提亮约 25%，故 P12 白天用更低的线性值
      const skyMid = ph.night ? 0x1d2740 : ph.dusk ? 0xa06a5a : ph.dawn ? 0xb08a86 : (FARM_GRADE_P12 ? 0x223759 : 0x8fa0a8);
      const skyBot = ph.night ? 0x2a2f3e : ph.dusk ? 0xe09050 : ph.dawn ? 0xe8c0a0 : (FARM_GRADE_P12 ? 0x7b4b1b : 0xd9b48a);
      this._sky.material.uniforms.top.value.setHex(skyTop);
      this._sky.material.uniforms.mid.value.setHex(skyMid);
      this._sky.material.uniforms.bot.value.setHex(skyBot);
      this._sky.material.uniforms.sunPos.value.copy(this._sunDisc.position).normalize();
      this._sky.material.uniforms.sunI.value = Math.max(0, Math.sin(sunAngle)) * weatherDim;
      this._sky.material.uniforms.flash.value = this._lightning;
      this._sunDisc.material.opacity = Math.max(0, Math.sin(sunAngle)) * .95;
      this._moonDisc.material.opacity = nightF * .9;
      this._stars.material.opacity = nightF * (wk === 'clear' ? .9 : .2);
      this._stars.visible = nightF > .05;
      // 夜间田地补光：让 3D 农田的土壤与作物在夜里也有可读性
      if (!this._fieldNightLight) {
        this._fieldNightLight = new T.PointLight(0xbfd0e8, 0, 22, 1.6);
        this._fieldNightLight.position.set(-3.8, 7.5, 5.6);
        this._scene.add(this._fieldNightLight);
      }
      this._fieldNightLight.intensity = nightF * .55;

      // 雾（P12-e：白天收雾密度 + 雾色由亮灰白压为带青绿的中性灰，去发白）
      const _fogTarget = (WEATHER_FOG[wk] || .016) * (FARM_GRADE_P12 ? 0.70 : 1.0);
      this._scene.fog.density = lerp(this._scene.fog.density, _fogTarget, .06);
      const fogCol = ph.night ? 0x1c2434 : ph.dusk ? 0x8a5a44 : (FARM_GRADE_P12 ? 0x273022 : 0x8a8a80);
      this._scene.fog.color.lerp(new T.Color(fogCol), .04);
      // 阴天/雾天天空再压一点
      if (wk === 'fog' || wk === 'storm' || wk === 'heavy_rain') {
        this._sky.material.uniforms.mid.value.lerp(new T.Color('#6a7070'), .3);
        this._sky.material.uniforms.bot.value.lerp(new T.Color('#8a8a80'), .3);
      }

      // 建筑细节动画
      const lv = id => ((G.buildings && G.buildings[id] && G.buildings[id].level) || 0);
      if (this._buildings.barn && this._buildings.barn.userData.hub) this._buildings.barn.userData.hub.rotation.z += dt * (lv('barn') >= 3 ? 2.2 : .6);
      const winMats = [];
      this._buildings.house.traverse(o => { if (o.material && o.material.emissive && o.material.emissiveIntensity !== undefined && o.material.emissive.r > .8) winMats.push(o.material); });
      winMats.forEach(m => { m.emissiveIntensity = nightF * .9; });
      const gh = this._buildings.greenhouse.userData.glowMat;
      if (gh) gh.emissiveIntensity = (lv('greenhouse') >= 2 ? .5 : .1) * (nightF > 0 ? .7 : .45);
      if (this._lampLights) {
        this._lampLights.forEach((L, i) => {
          const on = nightF > .05 ? 1 : 0;
          L.mat.emissiveIntensity = on * (1.6 + Math.sin(t * 2 + i) * .15);
          L.light.intensity = on * 1.5;
        });
      }
      const lab = this._buildings.lab.userData.blink;
      if (lab) lab.material.emissiveIntensity = (Math.sin(t * 3.2) > .5 ? 2.4 : .2);
      // 火焰/灰烬轻飘
      this._animateParticles(dt, t, wk, ph, dayLight);

      // 相机轨道：自动环绕 + 鼠标视差 + 拖拽偏移
      this._mouse.x = lerp(this._mouse.x, this._mouse.tx, .04);
      this._mouse.y = lerp(this._mouse.y, this._mouse.ty, .04);
      const o = this._orbit || { yaw: 0, pitch: 0, idle: 99 };
      o.idle = (o.idle || 0) + dt;
      const autoYaw = -0.02 + Math.sin(t * .045) * .055 + Math.sin(t * .021) * .022;
      const yaw = autoYaw + o.yaw;
      const pitch = Math.max(-.35, Math.min(.35, o.pitch + Math.sin(t * .03) * .015));
      const center = new T.Vector3(-2.2, 1.1, 0.5);
      const R = 18.4;
      const targetX = center.x + Math.sin(yaw) * R * Math.cos(pitch * .6) + this._mouse.x * 1.0;
      const targetZ = center.z + Math.cos(yaw) * R * Math.cos(pitch * .6);
      const targetY = center.y + 4.35 + Math.sin(pitch) * 8 - this._mouse.y * .6;
      this._camera.position.x = lerp(this._camera.position.x, targetX, .06);
      this._camera.position.y = lerp(this._camera.position.y, targetY, .06);
      this._camera.position.z = lerp(this._camera.position.z, targetZ, .06);
      this._camera.lookAt(center);
      // god rays：把太阳投影到屏幕空间，按视线/天气/时段调权重
      if (this._godrays) {
        const gv = this._sunDisc.position.clone().project(this._camera);
        const inView = gv.z < 1 && Math.abs(gv.x) < 1.25 && Math.abs(gv.y) < 1.25;
        const dayF = Math.max(0, Math.sin(sunAngle));
        const weatherF = wk === 'clear' ? 1 : wk === 'cloud' ? .45 : wk === 'fog' ? .3 : .18;
        const gu = this._godrays.uniforms;
        gu.sunPos.value.set(gv.x * .5 + .5, gv.y * .5 + .5);
        gu.weight.value = (inView && !ph.night) ? (0.30 + 0.45 * dayF) * weatherF : 0;
      }
      // 雾层漂移 / 透明度随天气
      if (this._fogLayers) {
        const fogOp = { clear: .55, cloud: .7, rain: .85, heavy_rain: .95, storm: 1.0, fog: 1.7, snow: .9 }[wk] || .6;
        this._fogLayers.forEach((m, i) => {
          m.position.x = Math.sin(t * .012 + i * 2.0) * 22;
          const nightF2 = ph.night ? .55 : 1;
          m.material.opacity = m.userData.op * fogOp * nightF2;
        });
      }
      try { this._animateDecor(dt, t); } catch (e) {}
      // 水面微波
      if (this._water) { this._water.material.roughness = .16 + Math.sin(t * .8) * .04; }
      if (this._illustration) this._illustration.uniforms.time.value = t;
      if (this._cine) this._cine.uniforms.uNight.value = Math.max(0, Math.min(1, 1 - dayLight));
      if (this._composer) this._composer.render();
      else this._renderer.render(this._scene, this._camera);
      return true;
    },

    _animateParticles(dt, t, wk, ph, dayLight) {
      // 雨
      if (this._rain && this._rain.visible) {
        const arr = this._rain.geometry.attributes.position.array;
        const N = this._rain.userData.N, vel = this._rain.userData.vel;
        const heavy = wk === 'heavy_rain' || wk === 'storm';
        for (let i = 0; i < N; i++) {
          arr[i * 3 + 1] -= vel[i] * dt * (heavy ? 1.4 : 1);
          arr[i * 3] -= dt * 2.2;
          if (arr[i * 3 + 1] < 0) { arr[i * 3 + 1] = 20; arr[i * 3] = -20 + Math.random() * 40; arr[i * 3 + 2] = -12 + Math.random() * 26; }
        }
        this._rain.geometry.attributes.position.needsUpdate = true;
        this._rain.material.opacity = heavy ? .55 : .38;
        // 闪电
        this._lightning = 0;
        if (wk === 'storm') {
          if (Math.random() < dt * 1.6) { this._lightning = .9; this._sun.intensity += 4; this._hemi.intensity += .6; }
        } else this._lightning = 0;
        if (this._lightning > 0) this._lightning = Math.max(0, this._lightning - dt * 4);
      }
      // 雪
      if (this._snow && this._snow.visible) {
        const arr = this._snow.geometry.attributes.position.array;
        const N = this._snow.userData.N;
        for (let i = 0; i < N; i++) {
          arr[i * 3 + 1] -= dt * (1.2 + (i % 5) * .35);
          arr[i * 3] += Math.sin(t * .8 + i) * dt * .5;
          if (arr[i * 3 + 1] < 0) { arr[i * 3 + 1] = 20; arr[i * 3] = -22 + Math.random() * 44; }
        }
        this._snow.geometry.attributes.position.needsUpdate = true;
        this._snow.material.opacity = .85;
      }
      // 灰烬
      if (this._ash) {
        const arr = this._ash.geometry.attributes.position.array;
        const N = this._ash.userData.N;
        for (let i = 0; i < N; i++) {
          arr[i * 3] += dt * (.35 + (i % 7) * .12);
          arr[i * 3 + 1] += Math.sin(t * .6 + i) * dt * .12;
          if (arr[i * 3] > 22) arr[i * 3] = -22;
        }
        this._ash.geometry.attributes.position.needsUpdate = true;
        this._ash.material.opacity = dayLight > .3 ? .5 : .35;
      }
      // 雾团
      if (this._fogPts && this._fogPts.visible) {
        const arr = this._fogPts.geometry.attributes.position.array;
        const N = this._fogPts.userData.N;
        for (let i = 0; i < N; i++) {
          arr[i * 3] += dt * .18;
          if (arr[i * 3] > 22) arr[i * 3] = -22;
        }
        this._fogPts.geometry.attributes.position.needsUpdate = true;
        this._fogPts.material.opacity = .5;
      }
    },

    detach() {
      if (this._renderer) { this._renderer.dispose(); this._renderer.domElement.remove(); }
      this._ready = false; this._ok = false;
    }
  };

  window.FarmPanorama3D = {
    __debug: Patches,
    attach(hs) { return Patches.attach(hs); },
    frame(now) { return Patches.frame(now); },
    present() { return Patches.present(); },
    detach() { Patches.detach(); },
    setEnabled(on) { return Patches.setEnabled(on); },
    isEnabled() { return Patches.isEnabled(); },
    toggle() { return Patches.toggle(); }
  };
})();
