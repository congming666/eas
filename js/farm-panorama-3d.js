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
  if (!window.THREE) { window.FarmPanorama3D = { active: false, attach() { return false; } }; return; }

  const T = THREE;
  const CROP_KINDS = ['wheat', 'corn', 'watermelon', 'pumpkin', 'sunflower', 'cabbage', 'carrot', 'moon_rice'];
  const WEATHER_FOG = { clear: 0.012, cloud: 0.016, rain: 0.022, heavy_rain: 0.030, storm: 0.034, fog: 0.055, snow: 0.026 };

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
  function clampedTexMat(name, color, repeat, rough, metal) {
    const base = { wood: woodTex, rust: rustTex, shingle: shingleTex }[name];
    const src = base();
    const tex = src.clone();
    tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
    return new T.MeshStandardMaterial({ map: tex, color: color, roughness: rough == null ? 1 : rough, metalness: metal || 0 });
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
    _stateKey: '', _plots: [], _cropMeshes: [], _buildings: {},
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
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
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
      this._composer = null; this._bloom = null;
      try {
        if (T.EffectComposer && T.RenderPass && T.UnrealBloomPass) {
          const comp = new T.EffectComposer(r);
          comp.addPass(new T.RenderPass(scene, cam));
          const bloom = new T.UnrealBloomPass(new T.Vector2(w, h), .5, .65, .82);
          comp.addPass(bloom);
          this._composer = comp; this._bloom = bloom;
        }
      } catch (e) { console.warn('[Pano3D] bloom disabled', e); }

      // 雾/天空
      scene.fog = new T.FogExp2(0x6a7280, 0.016);
      this._buildSky(scene);
      // 灯光
      this._hemi = new T.HemisphereLight(0x9fb4d0, 0x3a3226, .30);
      scene.add(this._hemi);
      const sun = new T.DirectionalLight(0xffd2a0, 2.2);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.camera.left = -16; sun.shadow.camera.right = 16;
      sun.shadow.camera.top = 16; sun.shadow.camera.bottom = -16;
      sun.shadow.camera.far = 60;
      sun.shadow.bias = -0.0004;
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
      const fieldBed = new T.Mesh(new T.PlaneGeometry(21, 14), new T.MeshStandardMaterial({ map: fieldTex, roughness: 1, color: 0xb09068 }));
      fieldBed.rotation.x = -Math.PI / 2; fieldBed.position.set(-3.0, .02, 6.2); fieldBed.receiveShadow = true;

      this._field.add(fieldBed);
      // 田埂边
      for (const [x, z, w, d] of [[-11.2, 5.2, .3, 12], [6.8, 5.2, .3, 12]]) {
        const edge = new T.Mesh(new T.BoxGeometry(w, .18, d), new T.MeshStandardMaterial({ color: '#3a2d1e', roughness: 1 }));
        edge.position.set(x, .09, z); this._field.add(edge);
      }

      // 建筑
      this._buildings.house = houseModel(0); this._buildings.house.position.set(4.2, 0, -8.5); scene.add(this._buildings.house);
      this._buildings.barn = barnModel(); this._buildings.barn.position.set(-7.5, 0, -5.5); scene.add(this._buildings.barn);
      this._buildings.greenhouse = greenhouseModel(0); this._buildings.greenhouse.position.set(8.6, 0, -1.0); this._buildings.greenhouse.rotation.y = -.25; scene.add(this._buildings.greenhouse);
      this._buildings.workshop = workshopModel(0); this._buildings.workshop.position.set(.2, 0, -10.5); scene.add(this._buildings.workshop);
      this._buildings.lab = labModel(0); this._buildings.lab.position.set(11.5, 0, -9.0); scene.add(this._buildings.lab);

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
      // 远景：废都剪影
      this._ruins = new T.Group();
      const ruinMat = new T.MeshStandardMaterial({ color: '#1c2228', roughness: 1 });
      for (let i = 0; i < 70; i++) {
        const bx = -48 + i * 1.5 + hash(i) * 1.6;
        const bh = 3 + hash(i * 3.3) * 13;
        const bw = 1.2 + hash(i * 5.1) * 2.6;
        const b = new T.Mesh(new T.BoxGeometry(bw, bh, 1.4), ruinMat);
        b.position.set(bx * 1.6, bh / 2, -72 - hash(i * 7.7) * 26);
        b.rotation.y = (hash(i) - .5) * .3;
        // 破损：顶部再叠一截偏移小方块
        if (hash(i * 9.1) > .5) {
          const top = new T.Mesh(new T.BoxGeometry(bw * .55, bh * .25, 1.0), ruinMat);
          top.position.set(b.position.x + (hash(i) - .5) * bw * .5, bh + bh * .1, b.position.z);
          top.rotation.y = b.rotation.y; this._ruins.add(top);
        }
        this._ruins.add(b);
      }
      scene.add(this._ruins);

      // 远山（压住地平线）
      const hillMat = new T.MeshStandardMaterial({ color: '#3a3e38', roughness: 1 });
      for (let i = 0; i < 8; i++) {
        const hill = new T.Mesh(new T.SphereGeometry(14 + hash(i) * 10, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), hillMat);
        hill.position.set(-55 + i * 16, -.5, -78 - hash(i * 3) * 12);
        hill.scale.set(1, .16 + hash(i) * .1, .6);
        this._scene.add(hill);
      }
      // 枯树 / 石头 / 栅栏
      for (let i = 0; i < 10; i++) {
        const t = deadTree(.8 + hash(i) * 1.3);
        const side = i % 2 ? 1 : -1;
        t.position.set(side * (8 + hash(i * 3.1) * 9), 0, -6 + hash(i * 5.3) * 16);
        t.rotation.y = hash(i) * 6.28;
        scene.add(t);
      }
      for (let i = 0; i < 26; i++) {
        const rk = rock(.2 + hash(i) * .5);
        rk.position.set(-14 + hash(i * 2.1) * 28, 0, -8 + hash(i * 4.7) * 18);
        rk.rotation.y = hash(i) * 6.28;
        scene.add(rk);
      }
      // 草丛（散布，增加细节）
      const grassMat = new T.MeshStandardMaterial({ color: '#6a7440', roughness: 1 });
      for (let i = 0; i < 140; i++) {
        const tuft = new T.Group();
        for (let k = 0; k < 3; k++) {
          const blade = new T.Mesh(new T.ConeGeometry(.035, .22 + hash(i + k) * .16, 3), grassMat);
          blade.position.set((hash(i * 3 + k) - .5) * .18, .12, (hash(i * 5 + k) - .5) * .18);
          blade.rotation.z = (hash(i + k) - .5) * .5;
          tuft.add(blade);
        }
        tuft.position.set(-24 + hash(i * 2.3) * 46, 0, -12 + hash(i * 6.1) * 24);
        this._scene.add(tuft);
      }
      // 栅栏沿田边
      const fenceMat = clampedTexMat('wood', '#7a6244', [3, 1], 1);
      for (let i = 0; i < 26; i++) {
        const post = new T.Mesh(new T.BoxGeometry(.09, .9, .09), fenceMat);
        post.position.set(-11 + i * .9, .45, 11.4); scene.add(post);
      }
      const rail = new T.Mesh(new T.BoxGeometry(23, .08, .08), fenceMat); rail.position.set(.7, .72, 11.4); scene.add(rail);
      const rail2 = new T.Mesh(new T.BoxGeometry(23, .07, .07), fenceMat); rail2.position.set(.7, .4, 11.4); scene.add(rail2);

      // 河流（右侧）
      const water = new T.Mesh(new T.PlaneGeometry(16, 26), new T.MeshStandardMaterial({ color: 0x2a4a52, roughness: .18, metalness: .65 }));
      water.rotation.x = -Math.PI / 2; water.position.set(14, .03, 3); water.receiveShadow = true;
      this._water = water; scene.add(water);

      // 粒子系统
      this._rain = this._makeRain(scene);
      this._snow = this._makeSnow(scene);
      this._ash = this._makeAsh(scene);
      this._fogPts = this._makeFog(scene);

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
      const n = Math.min(G.unlockedPlots || 16, plots.length || 16);
      const key = [
        G.season, wk, lv('workshop'), lv('greenhouse'), lv('barn'), lv('lab'),
        n, plots.slice(0, 16).map(p => (p && p.crop ? p.crop.id + (p.ready ? 'R' : '') : '-')).join('.')
      ].join('|');
      if (!force && key === this._lastState) return;
      this._lastState = key;
      const night = this._isNight();
      // 建筑等级
      const h = new T.Group();
      // 主屋等级 = 四建筑总级
      const total = lv('workshop') + lv('greenhouse') + lv('barn') + lv('lab');
      this._swapBuilding('house', houseModel(total));
      if (lv('barn') > 0) this._swapBuilding('barn', barnModel());
      if (lv('greenhouse') > 0) this._swapBuilding('greenhouse', greenhouseModel(lv('greenhouse')));
      if (lv('workshop') > 0) this._swapBuilding('workshop', workshopModel(lv('workshop')));
      if (lv('lab') > 0) this._swapBuilding('lab', labModel(lv('lab')));
      // 作物重建
      this._rebuildCrops(plots, n);
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
      model.position.copy(pos); model.rotation.y = rot;
      model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this._scene.add(model);
      this._buildings[name] = model;
    },

    _rebuildCrops(plots, n) {
      // 清掉旧作物
      if (this._cropMeshes) { this._cropMeshes.forEach(m => this._scene.remove(m)); }
      this._cropMeshes = [];
      const COLS = 4, ROWS = 4;
      for (let i = 0; i < 16; i++) {
        const c = i % COLS, r = Math.floor(i / COLS);
        const x = -10.2 + c * 2.85;
        const z = 2.0 + r * 2.55;
        // 地块：薄土面（垄沟贴图），避免厚板感
        const plotSoil = new T.Mesh(new T.PlaneGeometry(2.5, 2.3), new T.MeshStandardMaterial({ map: this._texCache.field, color: 0xb08c60, roughness: 1 }));
        plotSoil.rotation.x = -Math.PI / 2; plotSoil.position.set(x, .035, z); plotSoil.receiveShadow = true;
        this._scene.add(plotSoil); this._cropMeshes.push(plotSoil);
        const plot = plots[i];
        const has = i < n && plot && plot.crop;
        if (!has) {
          // 空地块：野草
          for (let k = 0; k < 5; k++) {
            const gw = new T.Mesh(new T.ConeGeometry(.03, .25 + hash(i + k) * .2, 4), new T.MeshStandardMaterial({ color: '#7a8448' }));
            gw.position.set(x - .8 + hash(i * 3 + k) * 1.6, .25, z - .8 + hash(i * 5 + k) * 1.6);
            this._scene.add(gw); this._cropMeshes.push(gw);
          }
          continue;
        }
        const prog = plot.ready ? 1 : clamp((Date.now() - (plot.plantedAt || 0)) / Math.max(1, plot.crop.growTime * 1000), 0, 1);
        const row = new T.Group();
        for (let k = 0; k < 6; k++) {
          const crop = cropGroup(plot.crop.id);
          crop.scale.setScalar((1.15 + prog * .75) * (.9 + hash(i * 3 + k) * .25));
          crop.position.set((k - 2.5) * .38, .09, (hash(i + k) - .5) * .7);
          crop.rotation.y = hash(i * 7.7 + k) * 6.28;
          row.add(crop);
        }
        row.position.set(x, 0, z);
        row.scale.setScalar(1.0);
        row.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        const cs = new T.Mesh(new T.PlaneGeometry(2.4, 2.1), new T.MeshBasicMaterial({ map: this._shadowTex, transparent: true, depthWrite: false }));
        cs.rotation.x = -Math.PI / 2; cs.position.set(x, .04, z);
        this._scene.add(cs); this._cropMeshes.push(cs);
        this._scene.add(row); this._cropMeshes.push(row);
        // 成熟金光
        if (plot.ready) {
          const l = new T.PointLight(0xffd27a, .7, 3.2); l.position.set(x, .9, z); this._scene.add(l); this._cropMeshes.push(l);
          const halo = new T.Mesh(new T.SphereGeometry(.05, 6, 4), new T.MeshBasicMaterial({ color: 0xffe6a0 }));
          halo.position.set(x, 1.1, z); this._scene.add(halo); this._cropMeshes.push(halo);
        }
      }
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
          if (this._bloom) this._bloom.setSize(cw, ch);
        }
      }
      const G = (typeof GameState !== 'undefined' && GameState) ? GameState : (window.GameState || {});
      const dt = Math.min(.05, this._clock.getDelta());
      const t = now / 1000;
      this._syncState(false);
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
      this._sun.intensity = .2 + dayLight * 1.85;
      this._sun.color.setHex(ph.dusk ? 0xffb070 : ph.dawn ? 0xffc0a0 : 0xffd8a8);
      this._moon.intensity = nightF * .5;
      this._hemi.intensity = .18 + dayLight * .55;
      this._hemi.color.setHex(ph.night ? 0x55688f : ph.dusk ? 0xc09070 : 0x9fb4d0);
      this._hemi.groundColor.setHex(ph.night ? 0x24242c : 0x3a3226);
      // 天空 uniform
      const skyTop = ph.night ? 0x0c1424 : ph.dusk ? 0x3a3a5e : ph.dawn ? 0x4a5a78 : 0x3f5d7a;
      const skyMid = ph.night ? 0x1d2740 : ph.dusk ? 0xa06a5a : ph.dawn ? 0xb08a86 : 0x8fa0a8;
      const skyBot = ph.night ? 0x2a2f3e : ph.dusk ? 0xe09050 : ph.dawn ? 0xe8c0a0 : 0xd9b48a;
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
      // 雾
      this._scene.fog.density = lerp(this._scene.fog.density, WEATHER_FOG[wk] || .016, .06);
      const fogCol = ph.night ? 0x1c2434 : ph.dusk ? 0x8a5a44 : 0x8a8a80;
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
      if (gh) gh.emissiveIntensity = (lv('greenhouse') >= 2 ? .9 : .15) * (nightF > 0 ? 1.2 : .6);
      const lab = this._buildings.lab.userData.blink;
      if (lab) lab.material.emissiveIntensity = (Math.sin(t * 3.2) > .5 ? 2.4 : .2);
      // 火焰/灰烬轻飘
      this._animateParticles(dt, t, wk, ph, dayLight);

      // 相机轨道：自动环绕 + 鼠标视差 + 拖拽偏移
      this._mouse.x = lerp(this._mouse.x, this._mouse.tx, .04);
      this._mouse.y = lerp(this._mouse.y, this._mouse.ty, .04);
      const o = this._orbit || { yaw: 0, pitch: 0, idle: 99 };
      o.idle = (o.idle || 0) + dt;
      const autoYaw = -0.10 + Math.sin(t * .05) * .20 + Math.sin(t * .019) * .08;
      const yaw = autoYaw + o.yaw;
      const pitch = Math.max(-.35, Math.min(.35, o.pitch + Math.sin(t * .03) * .015));
      const center = new T.Vector3(0.8, 1.05, -2.5);
      const R = 22.5;
      const targetX = center.x + Math.sin(yaw) * R * Math.cos(pitch * .6) + this._mouse.x * 1.0;
      const targetZ = center.z + Math.cos(yaw) * R * Math.cos(pitch * .6);
      const targetY = center.y + 3.3 + Math.sin(pitch) * 9 - this._mouse.y * .7;
      this._camera.position.x = lerp(this._camera.position.x, targetX, .06);
      this._camera.position.y = lerp(this._camera.position.y, targetY, .06);
      this._camera.position.z = lerp(this._camera.position.z, targetZ, .06);
      this._camera.lookAt(center);
      // 水面微波
      if (this._water) { this._water.material.roughness = .16 + Math.sin(t * .8) * .04; }
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
