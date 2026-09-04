/* =========================================================================
 * 星云序章 —— 主菜单交互式粒子星云（WebGL / three.js）
 * 依赖：three@0.128 (UMD) + examples/js/postprocessing（CDN，普通 script 引入）
 * 特性：数万粒子 · 青/紫/冰蓝柔光 · Z 轴景深透视 · 拖拽旋转 · 悬浮吸附
 *       bloom 泛光 · 分层速度 · 呼吸闪烁 · 自适应降级防卡顿
 * 运行：页面加载后自动初始化；#mainMenu 隐藏（进入游戏）时自动暂停渲染。
 * ========================================================================= */
(function () {
  'use strict';

  function init() {
    // ---- 依赖与能力检测 ----
    if (!window.THREE || !THREE.EffectComposer || !THREE.UnrealBloomPass) {
      console.warn('[Nebula] three.js 或后期处理模块未加载，粒子星云已降级为静态背景');
      return;
    }
    const canvas = document.getElementById('nebulaCanvas');
    if (!canvas) return;
    let gl;
    try {
      gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    } catch (e) { gl = null; }
    if (!gl) {
      console.warn('[Nebula] WebGL 不可用，粒子星云已降级为静态背景');
      canvas.style.display = 'none';
      return;
    }
    // 防止重复 init（热重载等）
    if (canvas.dataset.nebulaReady === '1') return;
    canvas.dataset.nebulaReady = '1';

    // ---- 性能自适应参数 ----
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    const cores = navigator.hardwareConcurrency || 4;
    let particleBudget = isMobile || cores <= 4 ? 18000 : 36000;
    let dprCap = isMobile ? 1.4 : 1.75;
    const FOV = 62, CAM_Z = 5.2;

    // ---- 场景基础 ----
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60);
    camera.position.set(0, 0.25, CAM_Z);
    const renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputEncoding = THREE.sRGBEncoding;

    // ---- 后期：Bloom 泛光（柔和） ----
    const composer = new THREE.EffectComposer(renderer);
    composer.addPass(new THREE.RenderPass(scene, camera));
    const bloomPass = new THREE.UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.5, 0.55, 0.78
    );
    composer.addPass(bloomPass);
    composer.setSize(window.innerWidth, window.innerHeight);

    // ---- 调色板：淡青 / 浅紫 / 冰蓝 ----
    const PALETTE = [
      [0.50, 0.88, 0.86], // 淡青  #7fe0dc
      [0.77, 0.68, 0.97], // 浅紫  #c4adf7
      [0.62, 0.83, 1.00], // 冰蓝  #9fd4ff
      [0.35, 0.72, 0.82], // 深青（暗部）
      [0.55, 0.45, 0.92], // 幽紫（暗部）
    ];

    // ---- 分层配置：近景快 / 远景慢 ----
    const LAYERS = [
      { zMin: -3.2, zMax: -0.9, sizeMin: 1.1, sizeMax: 2.8, speed: 0.42, flicker: 0.55, share: 0.56, bright: 0.75 },
      { zMin: -1.0, zMax:  0.9, sizeMin: 1.8, sizeMax: 4.6, speed: 1.0,  flicker: 0.42, share: 0.32, bright: 1.0 },
      { zMin:  0.7, zMax:  2.4, sizeMin: 3.2, sizeMax: 7.5, speed: 1.85, flicker: 0.32, share: 0.12, bright: 1.25 },
    ];

    const group = new THREE.Group();
    scene.add(group);
    const pointsList = [];

    function rand(a, b) { return a + Math.random() * (b - a); }

    function buildLayer(cfg) {
      const count = Math.max(300, Math.floor(particleBudget * cfg.share));
      const pos = new Float32Array(count * 3);
      const col = new Float32Array(count * 3);
      const size = new Float32Array(count);
      const phase = new Float32Array(count);
      const depth = new Float32Array(count);
      const zSpan = cfg.zMax - cfg.zMin;
      for (let i = 0; i < count; i++) {
        // 星云盘状分布：径向向中心聚拢，y 薄
        const r = Math.sqrt(Math.random()) * 3.3;
        const a = Math.random() * Math.PI * 2;
        const z = rand(cfg.zMin, cfg.zMax);
        pos[i * 3]     = Math.cos(a) * r;
        pos[i * 3 + 1] = (Math.random() - 0.5) * (0.35 + 0.5 * Math.random());
        pos[i * 3 + 2] = Math.sin(a) * r * 0.92 + z * 0.35;
        // 颜色：从调色板随机取两支插值，远处更暗更冷
        const c1 = PALETTE[(Math.random() * PALETTE.length) | 0];
        const c2 = PALETTE[(Math.random() * PALETTE.length) | 0];
        const t = Math.random();
        const depth01 = (z - cfg.zMin) / zSpan;
        const dim = (0.30 + 0.70 * depth01) * cfg.bright;
        col[i * 3]     = (c1[0] * (1 - t) + c2[0] * t) * dim;
        col[i * 3 + 1] = (c1[1] * (1 - t) + c2[1] * t) * dim;
        col[i * 3 + 2] = (c1[2] * (1 - t) + c2[2] * t) * dim;
        size[i] = rand(cfg.sizeMin, cfg.sizeMax);
        phase[i] = Math.random();
        depth[i] = depth01;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
      geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
      geo.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));

      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uPixelRatio: { value: renderer.getPixelRatio() },
          uMouse: { value: new THREE.Vector3(0, 0, 0) },
          uAttract: { value: 0 },
          uSpeed: { value: cfg.speed },
          uFlicker: { value: cfg.flicker },
        },
        vertexShader: `
          uniform float uTime;
          uniform float uPixelRatio;
          uniform vec3  uMouse;
          uniform float uAttract;
          uniform float uSpeed;
          attribute vec3 aColor;
          attribute float aSize;
          attribute float aPhase;
          attribute float aDepth;
          varying vec3 vColor;
          varying float vPhase;
          varying float vFade;
          void main() {
            vec3 pos = position;
            float t = uTime * 0.10;
            // 缓慢涌动：多层正弦叠加形成星云流动感
            pos.x += sin(t * 0.85 + aPhase * 6.283) * 0.20 * uSpeed * (0.35 + aDepth);
            pos.y += cos(t * 0.62 + aPhase * 6.283 * 1.3) * 0.17 * uSpeed * (0.35 + aDepth);
            pos.z += sin(t * 0.47 + aPhase * 3.7) * 0.10 * uSpeed;
            // 鼠标悬浮吸附：近处粒子向吸附点聚集并增亮
            vec3 toM = uMouse - pos;
            float dm = length(toM);
            float att = smoothstep(1.45, 0.0, dm) * uAttract;
            pos += (toM / max(dm, 1e-4)) * att * 0.42 * (0.55 + aDepth);
            float bright = 1.0 + att * 1.55;
            vec4 mv = modelViewMatrix * vec4(pos, 1.0);
            gl_Position = projectionMatrix * mv;
            // 景深：远处缩小变暗（伪虚化）
            float depthFade = smoothstep(-7.2, -0.9, mv.z);
            float ps = aSize * uPixelRatio * (4.0 / -mv.z) * (0.55 + 0.85 * aDepth) * (1.0 + att * 0.75);
            gl_PointSize = clamp(ps, 1.0, 46.0);
            vColor = aColor * bright * (0.32 + 0.9 * depthFade);
            vFade = depthFade;
            vPhase = aPhase;
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uFlicker;
          varying vec3 vColor;
          varying float vPhase;
          varying float vFade;
          void main() {
            vec2 uv = gl_PointCoord - 0.5;
            float d = length(uv);
            // 柔光高斯衰减 + 核心亮斑（光晕边缘平滑 = 抗锯齿）
            float glow = exp(-d * d * 24.0);
            float core = exp(-d * d * 88.0) * 1.45;
            // 部分粒子缓慢呼吸闪烁
            float flick = 1.0 - uFlicker * (0.5 + 0.5 * sin(uTime * 0.75 + vPhase * 6.283));
            float alpha = (glow * 0.88 + core) * vFade * flick;
            alpha = smoothstep(0.012, 0.05, alpha);
            if (alpha < 0.004) discard;
            gl_FragColor = vec4(vColor, alpha);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const points = new THREE.Points(geo, mat);
      group.add(points);
      pointsList.push(points);
      return count;
    }

    let total = 0;
    LAYERS.forEach(cfg => { total += buildLayer(cfg); });

    // ---- 星云云雾大光斑（柔光 sprite） ----
    function makeGlowTexture(r, g, b) {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const ctx = c.getContext('2d');
      const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
      grad.addColorStop(0, `rgba(${r},${g},${b},0.85)`);
      grad.addColorStop(0.35, `rgba(${r},${g},${b},0.30)`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 128, 128);
      const tex = new THREE.CanvasTexture(c);
      return tex;
    }
    const cloudTexs = [makeGlowTexture(120, 225, 220), makeGlowTexture(180, 150, 255), makeGlowTexture(130, 190, 255)];
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.SpriteMaterial({
        map: cloudTexs[i % 3],
        transparent: true,
        opacity: rand(0.05, 0.13),
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        color: new THREE.Color(0.75, 0.85, 1.0),
      });
      const sp = new THREE.Sprite(mat);
      const r = rand(1.6, 3.6);
      sp.position.set(rand(-3.2, 3.2), rand(-1.4, 1.4), rand(-2.6, 1.2));
      sp.scale.set(r, r * rand(0.6, 0.9), 1);
      sp.material.rotation = rand(0, Math.PI);
      group.add(sp);
    }

    // ---- 交互：拖拽旋转（带惯性） + 悬浮吸附 ----
    let dragging = false, lastX = 0, lastY = 0;
    let velY = 0, velX = 0;
    let attractTarget = 0;
    const mouseWorld = new THREE.Vector3(0, 0, 0);
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const hitPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const hitPoint = new THREE.Vector3();

    function updateMouseWorld(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      if (raycaster.ray.intersectPlane(hitPlane, hitPoint)) {
        group.worldToLocal(hitPoint);
        mouseWorld.copy(hitPoint);
      }
    }

    function isInteractiveTarget(el) {
      return el && el.closest && el.closest('button, a, input, .menu-btn, select, [role="button"]');
    }

    window.addEventListener('pointerdown', e => {
      if (isInteractiveTarget(e.target)) return; // 按钮上不触发拖拽
      if (e.button !== 0) return;
      dragging = true;
      lastX = e.clientX; lastY = e.clientY;
      attractTarget = 0;
    }, { passive: true });

    window.addEventListener('pointermove', e => {
      if (dragging) {
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        group.rotation.y -= dx * 0.0042;
        group.rotation.x = Math.max(-0.65, Math.min(0.65, group.rotation.x - dy * 0.0028));
        velY = -dx * 0.0042;
        velX = -dy * 0.0028;
        attractTarget = 0;
      } else {
        updateMouseWorld(e.clientX, e.clientY);
        attractTarget = 1;
      }
    }, { passive: true });

    function endDrag() {
      dragging = false;
      attractTarget = 1;
    }
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    window.addEventListener('blur', endDrag);

    // ---- 暂停控制 ----
    let running = true, pausedByMenu = false;

    function menuHidden() {
      const menu = document.getElementById('mainMenu');
      return !menu || menu.classList.contains('hidden');
    }
    function onVisibility() { if (document.hidden) { running = false; } else { running = true; } }
    document.addEventListener('visibilitychange', onVisibility);

    // ---- 性能监控与降级 ----
    let frameCount = 0, fpsAccum = 0, fpsLowStreak = 0, degraded = false;
    function sampleFps(dt) {
      fpsAccum += dt;
      frameCount++;
      if (fpsAccum >= 1) {
        const fps = frameCount / fpsAccum;
        frameCount = 0; fpsAccum = 0;
        if (fps < 26 && !degraded) {
          degraded = true;
          const cap = renderer.getPixelRatio();
          if (cap > 1.2) {
            renderer.setPixelRatio(1.2);
            bloomPass.resolution.set(window.innerWidth * 1.2, window.innerHeight * 1.2);
          } else if (particleBudget > 7000) {
            particleBudget = Math.floor(particleBudget * 0.55);
            pointsList.forEach(p => { p.visible = p.geometry.attributes.position.count <= particleBudget; });
          }
          console.warn('[Nebula] 帧率偏低，已自动降低渲染开销');
        }
      }
    }

    // ---- 主循环 ----
    const clock = new THREE.Clock();
    let lastT = performance.now();

    function animate() {
      requestAnimationFrame(animate);
      if (!running) return;
      // 进入游戏（主菜单隐藏）→ 暂停粒子渲染，省电
      if (menuHidden()) {
        if (!pausedByMenu) { pausedByMenu = true; }
        return;
      }
      pausedByMenu = false;

      const now = performance.now();
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      const t = clock.getElapsedTime();

      // 自动缓慢旋转 + 拖拽惯性
      group.rotation.y += 0.012 * dt;
      if (!dragging) {
        group.rotation.y += velY;
        group.rotation.x = Math.max(-0.65, Math.min(0.65, group.rotation.x + velX));
        velY *= 0.93; velX *= 0.93;
      }

      // 吸附强度平滑过渡
      const target = dragging ? 0 : attractTarget;
      pointsList.forEach(p => {
        const u = p.material.uniforms;
        u.uTime.value = t;
        u.uAttract.value += (target - u.uAttract.value) * 0.09;
        u.uMouse.value.copy(mouseWorld);
      });

      composer.render();
      sampleFps(dt);
    }

    // ---- 自适应尺寸 ----
    function onResize() {
      const w = window.innerWidth, h = window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
      bloomPass.resolution.set(w, h);
    }
    window.addEventListener('resize', onResize);

    animate();
    onResize();

    // 暴露接口供调试
    window.Nebula = {
      particleCount: total,
      setPause(v) { running = !v; },
      getPaused() { return pausedByMenu || !running; },
    };
    console.info(`[Nebula] 粒子星云就绪：${total} 粒子 / ${LAYERS.length} 层 / bloom 已开启`);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
