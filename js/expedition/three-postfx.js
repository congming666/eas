/*
 * ThreePostFX —— 方案 C P4：影视级后处理 + 四主题光照（对齐 Unity CinematicLook.cs / MapTheme.cs）
 *
 * 渲染链：RenderPass → UnrealBloomPass(主题参数) → CinematicShaderPass(自写合一) → 屏幕
 *   CinematicShader 片元顺序（线性 HDR 输入）：
 *   白平衡(temp/tint) → 冷暖分离(split toning) → 线性曝光(postExposure) → ACES 色调映射
 *   → 对比度 → 饱和度 → 暗角(vignette) → 手动 sRGB 编码输出（r128 无 OutputPass）。
 *
 * 设计要点：
 *  - r128 EffectComposer 默认 RenderTarget 为 UnsignedByte，会截断 HDR 高光；这里显式用 HalfFloat
 *    渲染目标，保证 Bloom threshold 与 ACES 高光滚动正确。
 *  - 开启后处理时 renderer.toneMapping 保持 NoToneMapping（Terrain3D 未设置，默认即是），ACES 只在
 *    本模块 CinematicPass 内做一次，杜绝双重色调映射；自定义 ShaderPass 不注入 output encoding，
 *    故片元末尾手动 linear→sRGB，正好一次，不与 renderer.outputEncoding 叠加。
 *  - Unity 的 FogExp2 density(.0075~.01) 是「米」空间；网页世界单位是 CSS 像素、尺度大一个数量级，
 *    不能逐值照搬，否则全屏被雾填满。这里只取四主题之间的【相对比例】，乘到网页既有像素空间基准密度。
 *  - 任何初始化/编译失败都 _fail 回退到 renderer.render 直渲路径，不阻断游戏。
 */
(function () {
  'use strict';
  const T = window.THREE;
  const PostFX = { ready: false, enabled: false, _failed: false, _composer: null, _cinematic: null, _bloom: null };

  // 开关：localStorage.farmPostFX = auto(默认) | on | off。file:// 下纹理/XHR 受限，保守禁用。
  function _flag() {
    try {
      const v = (localStorage.getItem('farmPostFX') || 'auto').toLowerCase();
      if (v === 'off') return false;
      if (v === 'on') return true;
      if (location.protocol === 'file:') return false;
      return true;
    } catch (e) { return true; }
  }

  /* ---------------- 四主题常量（MapTheme.cs 逐值移植，tier 1..4） ---------------- */
  // c=[r,g,b] 0..1；光照/雾/环境为线性基色，CinematicPass 调色参数另列。
  // grade：CinematicPass 主题颜色分级（俯视下地形固有色主导，单纯光色乘法染不穿绿草，
  // 需在 ACES 前做整体 tint 染色 + lift 曝光乘数，对齐 Unity Volume 调色/夜景压暗观感）。
  const THEMES = [
    { // 1 春林：清晨绿意、暖光、绿雾
      key: [1.00, 0.96, 0.86], intensity: 1.55, rot: [48, -28],
      fog: [0.46, 0.62, 0.48], fogDensityUnity: 0.0075, bg: [0.58, 0.74, 0.58],
      ambient: [0.62, 0.66, 0.62], ground: [1.05, 1.05, 0.98], shaft: [0.9, 1.0, 0.7],
      bloom: 0.30, bloomThresh: 0.92, sat: 12, contrast: 8, vignette: 0.24,
      grade: [1.02, 1.00, 0.95], gradeStr: 0.12, lift: 1.0
    },
    { // 2 黄金城：金色黄昏、琥珀光、金雾
      key: [1.00, 0.85, 0.60], intensity: 1.60, rot: [52, -35],
      fog: [0.58, 0.50, 0.34], fogDensityUnity: 0.0090, bg: [0.58, 0.46, 0.28],
      ambient: [0.62, 0.54, 0.40], ground: [1.05, 1.00, 0.90], shaft: [1.0, 0.82, 0.45],
      bloom: 0.40, bloomThresh: 0.85, sat: 16, contrast: 9, vignette: 0.26,
      grade: [1.10, 0.97, 0.76], gradeStr: 0.30, lift: 1.02
    },
    { // 3 冰雪：冷蓝、冷光、蓝白雾
      key: [0.78, 0.90, 1.00], intensity: 1.45, rot: [50, -20],
      fog: [0.66, 0.76, 0.88], fogDensityUnity: 0.0085, bg: [0.72, 0.82, 0.92],
      ambient: [0.66, 0.72, 0.84], ground: [1.00, 1.00, 1.05], shaft: [0.74, 0.92, 1.0],
      bloom: 0.28, bloomThresh: 0.92, sat: 6, contrast: 8, vignette: 0.22,
      grade: [0.90, 0.98, 1.14], gradeStr: 0.24, lift: 1.06
    },
    { // 4 星空：夜晚紫蓝、冷月光、深蓝雾、整体压暗
      key: [0.68, 0.76, 1.00], intensity: 1.05, rot: [45, -10],
      fog: [0.12, 0.15, 0.28], fogDensityUnity: 0.0100, bg: [0.07, 0.09, 0.18],
      ambient: [0.24, 0.27, 0.42], ground: [1.00, 1.00, 1.10], shaft: [0.74, 0.66, 1.0],
      bloom: 0.50, bloomThresh: 0.72, sat: 10, contrast: 12, vignette: 0.32,
      grade: [0.70, 0.78, 1.22], gradeStr: 0.46, lift: 0.6
    }
  ];

  // CinematicLook.cs 全局 Volume 基础值（主题只覆盖 bloom/饱和/对比/暗角，其余固定）
  const BASE = {
    temperature: 8, tint: 2,
    shadowTint: [0.56, 0.49, 0.43], highlightTint: [0.57, 0.53, 0.46], splitBalance: -8,
    postExposure: 0.05, contrastBase: 9, vignetteSmoothness: 0.55, bloomScatter: 0.62
  };
  // 网页像素空间雾密度基准（对应 Unity t1 的 .0075），主题按相对比例缩放；天气在 Terrain3D 侧再加权。
  const WEB_FOG_BASE = 0.00016;
  const THEME_LERP_SECONDS = 1.5;

  function _v(arr) { return new T.Vector3(arr[0], arr[1], arr[2]); }

  /* ---------------- Cinematic 合一 Shader ---------------- */
  function _buildCinematicShader() {
    return new T.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uResolution: { value: new T.Vector2(1, 1) },
        uExposure: { value: BASE.postExposure },
        uContrast: { value: (BASE.contrastBase + 8) / 100 }, // 主题 contrast 与基础叠加
        uSaturation: { value: 12 / 100 },
        uVignette: { value: 0.24 },
        uVigSmooth: { value: BASE.vignetteSmoothness },
        uTemperature: { value: BASE.temperature / 100 },
        uTint: { value: BASE.tint / 100 },
        uShadowTint: { value: _v(BASE.shadowTint) },
        uHighlightTint: { value: _v(BASE.highlightTint) },
        uSplitBalance: { value: BASE.splitBalance / 100 },
        uGradeTint: { value: _v([1.02, 1.0, 0.95]) },
        uGradeStr: { value: 0.12 },
        uLift: { value: 1.0 }
      },
      vertexShader: [
        'varying vec2 vUv;',
        'void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }'
      ].join('\n'),
      fragmentShader: [
        'precision highp float;',
        'varying vec2 vUv;',
        'uniform sampler2D tDiffuse;',
        'uniform vec2 uResolution;',
        'uniform float uExposure,uContrast,uSaturation,uVignette,uVigSmooth,uTemperature,uTint,uSplitBalance;',
        'uniform float uGradeStr,uLift;',
        'uniform vec3 uShadowTint,uHighlightTint,uGradeTint;',
        // ACES filmic（Narkowicz 近似）
        'vec3 aces(vec3 x){ const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14;',
        '  return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0); }',
        // linear → sRGB 精确分段
        'vec3 toSrgb(vec3 c){ return mix(c*12.92, 1.055*pow(max(c,0.0),vec3(1.0/2.4))-0.055, step(vec3(0.0031308),c)); }',
        'void main(){',
        '  vec3 col = texture2D(tDiffuse, vUv).rgb;',
        // 1) 白平衡：temperature>0 暖（加红减蓝），tint 正向品、负向绿（值很小，弱效果）
        '  col.r *= 1.0 + uTemperature*0.18;',
        '  col.b *= 1.0 - uTemperature*0.18;',
        '  col.g *= 1.0 - uTint*0.12;',
        '  col.r += uTint*0.03; col.b += uTint*0.03;',
        // 1.5) 主题颜色分级：整体曝光 lift（夜景压暗）+ 线性 tint 染色（统一地形固有色氛围）
        '  col *= max(uLift,0.0);',
        '  col = mix(col, col*uGradeTint, uGradeStr);',
        // 2) 冷暖分离：按线性亮度在阴影/高光分别染色，balance 偏向阴影
        '  float l = clamp(dot(col, vec3(0.2126,0.7152,0.0722)),0.0,1.0);',
        '  float shadowW = smoothstep(0.75,0.0,l) * (0.6 + uSplitBalance);',
        '  float highW = smoothstep(0.25,1.0,l) * 0.6;',
        '  col = mix(col, col*uShadowTint*1.6, clamp(shadowW,0.0,0.5));',
        '  col = mix(col, col*uHighlightTint*1.6, clamp(highW,0.0,0.5));',
        // 3) 线性曝光（ACES 前）
        '  col *= exp2(uExposure);',
        // 4) ACES 色调映射
        '  col = aces(col);',
        // 5) 对比度（围绕中性灰 .18 枢轴，避免整体发灰）
        '  col = (col - 0.18) * (1.0 + uContrast) + 0.18;',
        '  col = clamp(col,0.0,1.0);',
        // 6) 饱和度（Rec.709 亮度）
        '  float gray = dot(col, vec3(0.2126,0.7152,0.0722));',
        '  col = mix(vec3(gray), col, 1.0 + uSaturation);',
        // 7) 暗角（aspect 校正椭圆）
        '  vec2 q = vUv - 0.5;',
        '  q.x *= uResolution.x / max(uResolution.y,1.0);',
        '  float dist = length(q)*2.0;',
        '  float vig = smoothstep(0.45, 0.45 + (1.0-uVigSmooth)*0.9, dist);',
        '  col *= 1.0 - clamp(vig*uVignette*1.6,0.0,1.0);',
        // 8) 手动 sRGB 编码输出
        '  gl_FragColor = vec4(toSrgb(clamp(col,0.0,1.0)), 1.0);',
        '}'
      ].join('\n'),
      depthWrite: false, depthTest: false
    });
  }

  /* ---------------- FXAA 3.11 抗锯齿（r128 无 SMAAPass，用成熟单 pass FXAA 近似；开关名沿用 farmPostSMAA） ---------------- */
  function _gq(field, fallback) {
    try { return window.GraphicsQuality ? !!window.GraphicsQuality.config()[field] : fallback; }
    catch (e) { return fallback; }
  }
  function _smaaFlag() {
    try {
      const v = (localStorage.getItem('farmPostSMAA') || 'auto').toLowerCase();
      if (v === 'off') return false;
      if (v === 'on') return true;
      return _gq('fxaa', true); // auto：跟随画质档（低端关 FXAA）
    } catch (e) { return true; }
  }

  function _buildFXAAMaterial() {
    return new T.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, resolution: { value: new T.Vector2(1 / 1024, 1 / 768) } },
      vertexShader: [
        'varying vec2 vUv;',
        'void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }'
      ].join('\n'),
      fragmentShader: [
        'precision highp float;',
        'uniform sampler2D tDiffuse; uniform vec2 resolution; varying vec2 vUv;',
        '#define FXAA_REDUCE_MIN (1.0/128.0)',
        '#define FXAA_REDUCE_MUL (1.0/8.0)',
        '#define FXAA_SPAN_MAX 8.0',
        'void main(){',
        '  vec3 rgbNW=texture2D(tDiffuse,vUv+(vec2(-1.0,-1.0))*resolution).xyz;',
        '  vec3 rgbNE=texture2D(tDiffuse,vUv+(vec2(1.0,-1.0))*resolution).xyz;',
        '  vec3 rgbSW=texture2D(tDiffuse,vUv+(vec2(-1.0,1.0))*resolution).xyz;',
        '  vec3 rgbSE=texture2D(tDiffuse,vUv+(vec2(1.0,1.0))*resolution).xyz;',
        '  vec3 rgbM=texture2D(tDiffuse,vUv).xyz;',
        '  vec3 luma=vec3(0.299,0.587,0.114);',
        '  float lNW=dot(rgbNW,luma), lNE=dot(rgbNE,luma), lSW=dot(rgbSW,luma), lSE=dot(rgbSE,luma), lM=dot(rgbM,luma);',
        '  float lMin=min(lM,min(min(lNW,lNE),min(lSW,lSE)));',
        '  float lMax=max(lM,max(max(lNW,lNE),max(lSW,lSE)));',
        '  vec2 dir; dir.x=-((lNW+lNE)-(lSW+lSE)); dir.y=((lNW+lSW)-(lNE+lSE));',
        '  float dirReduce=max((lNW+lNE+lSW+lSE)*(0.25*FXAA_REDUCE_MUL),FXAA_REDUCE_MIN);',
        '  float rcpDirMin=1.0/(min(abs(dir.x),abs(dir.y))+dirReduce);',
        '  dir=clamp(dir*rcpDirMin,vec2(-FXAA_SPAN_MAX),vec2(FXAA_SPAN_MAX))*resolution;',
        '  vec3 rgbA=0.5*(texture2D(tDiffuse,vUv+dir*(1.0/3.0-0.5)).xyz+',
        '                  texture2D(tDiffuse,vUv-dir*(1.0/3.0-0.5)).xyz);',
        '  vec3 rgbB=rgbA*0.5+0.25*(texture2D(tDiffuse,vUv+dir*(2.0/3.0-0.5)).xyz+',
        '                           texture2D(tDiffuse,vUv-dir*(2.0/3.0-0.5)).xyz);',
        '  float lB=dot(rgbB,luma);',
        '  gl_FragColor=vec4((lB<lMin||lB>lMax)?rgbA:rgbB,1.0);',
        '}'
      ].join('\n'),
      depthWrite: false, depthTest: false
    });
  }

  /* ---------------- LightShaft 丁达尔光柱（对齐 LightShaft.cs + LightShaft.shader） ---------------- */
  function _shaftFlag() {
    try {
      const v = (localStorage.getItem('farmLightShaft') || 'auto').toLowerCase();
      if (v === 'off') return false;
      if (v === 'on') return true;
      return _gq('shaft', true); // auto：跟随画质档（低端关光柱）
    } catch (e) { return true; }
  }
  // 每主题束数（5.5：白天/黄昏 2-4 束，星空仅 1 束冷色）
  const SHAFT_COUNT = [3, 4, 2, 1];
  const SHAFT_W_PX = 2.2 * 40;    // Unity 米 × PX_PER_METER
  const SHAFT_H_PX = 12 * 40;    // 陡俯视下收敛束高，避免光带铺满屏幕（Unity 16m 平视可见全高）

  function _buildShaftMaterial() {
    return new T.ShaderMaterial({
      uniforms: { uColor: { value: _v([0.9, 1.0, 0.7]) }, uIntensity: { value: 0.32 },
        uWidth: { value: 0.5 }, uTipFade: { value: 0.55 } },
      vertexShader: ['varying vec2 vUv;',
        'void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }'].join('\n'),
      fragmentShader: [
        'precision highp float; varying vec2 vUv;',
        'uniform vec3 uColor; uniform float uIntensity,uWidth,uTipFade;',
        'void main(){',
        '  float across=abs(vUv.x-0.5)*2.0;',
        '  float w=1.0-smoothstep(0.0,uWidth,across);',                 // 横向中心柔衰减
        '  float bottomFade=smoothstep(0.0,0.18,vUv.y);',               // 底端淡入，避免硬亮边
        '  float tip=1.0-smoothstep(uTipFade,1.0,vUv.y);',             // 顶端淡出
        '  float a=w*tip*bottomFade*uIntensity;',
        '  gl_FragColor=vec4(uColor*a,a); }'].join('\n'),
      transparent: true, blending: T.AdditiveBlending, depthWrite: false, depthTest: true,
      side: T.DoubleSide
    });
  }

  PostFX._buildShafts = function (scene) {
    try {
      PostFX._shaftGroup = new T.Group();
      PostFX._shaftMat = _buildShaftMaterial();
      PostFX._shafts = [];
      const geo = new T.PlaneGeometry(SHAFT_W_PX, SHAFT_H_PX);
      for (let i = 0; i < 4; i++) {
        const m = new T.Mesh(geo, PostFX._shaftMat);
        m.frustumCulled = false; m.visible = false;
        PostFX._shafts.push(m); PostFX._shaftGroup.add(m);
      }
      scene.add(PostFX._shaftGroup);
      PostFX._shaftOn = true;
      return true;
    } catch (e) { try { console.warn('[ThreePostFX] 光柱初始化失败（跳过）：', e && e.message); } catch (err) {} PostFX._shaftOn = false; return false; }
  };

  // 每帧：主题决定束数/颜色；相对相机 frustrum 布在视野上半部，水平 billboard 朝相机再沿光向倾斜 .35
  PostFX._updateShafts = function (delta) {
    if (!PostFX._shaftOn || !PostFX._camera) return;
    const idx = PostFX._targetTier - 1;
    const th = THEMES[idx];
    const count = SHAFT_COUNT[idx];
    PostFX._shaftMat.uniforms.uColor.value.set(th.shaft[0], th.shaft[1], th.shaft[2]);
    const cam = PostFX._camera;
    // 相机正交 frustum 中心 xz 与半宽（Terrain3D 每帧已更新 projection）
    const cx = cam.position.x, cz = cam.position.z;
    const halfW = cam.right, halfH = cam.top;
    const fwd = new T.Vector3(-0.3, 0, -0.2).normalize(); // 固定太阳水平方位（平行光，各束同向）
    for (let i = 0; i < PostFX._shafts.length; i++) {
      const m = PostFX._shafts[i];
      m.visible = i < count;
      if (!m.visible) continue;
      // 归一布点：沿视野宽度均分、压在上半区，确定性偏移
      const t = count === 1 ? 0.5 : i / (count - 1);
      const px = cx + (t - 0.5) * halfW * 1.5;
      const pz = cz - halfH * 0.55 + (i % 2) * halfH * 0.25;
      m.position.set(px, SHAFT_H_PX * 0.38, pz);
      // 双面材质无需朝相机翻面：统一朝向太阳方位，保证多束平行；再绕横轴倾倒适配陡俯视
      m.lookAt(m.position.x + fwd.x, m.position.y, m.position.z + fwd.z);
      m.rotateX(1.0);
    }
  };

  /* ---------------- 轻量屏幕空间 SSAO（r128 无 GTAOPass；设计 5.4 允许 SSAO 保底，正交相机用逆投影重建） ---------------- */
  function _aoFlag() {
    try {
      const v = (localStorage.getItem('farmPostAO') || 'auto').toLowerCase();
      if (v === 'off') return false;
      if (v === 'on') return true;
      return _gq('ao', true); // auto：跟随画质档（中/低端关 SSAO）
    } catch (e) { return true; }
  }
  const AO_KERNEL = 12;

  function _buildSSAOMaterial(depthTexture) {
    return new T.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null }, tDepth: { value: depthTexture },
        uInvProj: { value: new T.Matrix4() }, uProj: { value: new T.Matrix4() },
        uResolution: { value: new T.Vector2(1, 1) },
        uRadius: { value: 26.0 },       // 屏幕采样半径（像素），约对齐 Unity .5m≈20px
        uMaxDist: { value: 60.0 },      // 视图空间范围判定，超出不视作遮蔽（抑制开阔地误遮蔽）
        uBias: { value: 0.05 }, uStrength: { value: 0.75 }
      },
      vertexShader: ['varying vec2 vUv;',
        'void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }'].join('\n'),
      fragmentShader: [
        'precision highp float; varying vec2 vUv;',
        'uniform sampler2D tDiffuse,tDepth; uniform mat4 uInvProj,uProj; uniform vec2 uResolution;',
        'uniform float uRadius,uMaxDist,uBias,uStrength;',
        'float readD(vec2 uv){ return texture2D(tDepth,clamp(uv,vec2(0.001),vec2(0.999))).x; }',
        'vec3 viewPos(vec2 uv,float d){ vec4 p=uInvProj*vec4(vec3(uv, d)*2.0-1.0,1.0); return p.xyz/p.w; }',
        'float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }',
        'void main(){',
        '  vec3 col=texture2D(tDiffuse,vUv).rgb;',
        '  float d=readD(vUv);',
        '  if(d>=0.9999){ gl_FragColor=vec4(col,1.0); return; }',   // 天空/背景无遮蔽
        '  vec3 P=viewPos(vUv,d);',
        // 邻域深度梯度重建视图法线
        '  vec3 Pr=viewPos(vUv+vec2(uResolution.x,0.0),readD(vUv+vec2(uResolution.x,0.0)));',
        '  vec3 Pu=viewPos(vUv+vec2(0.0,uResolution.y),readD(vUv+vec2(0.0,uResolution.y)));',
        '  vec3 N=normalize(cross(Pr-P,Pu-P));',
        '  float ang=hash(vUv)*6.2831853; float ca=cos(ang),sa=sin(ang);',
        '  float occ=0.0;',
        '  for(int i=0;i<' + AO_KERNEL + ';i++){',
        '    float fi=float(i)+1.0;',
        '    float a=fi*2.399963+ang;',
        '    float rr=uRadius*sqrt(fi/float(' + AO_KERNEL + '));',
        // 屏幕空间螺旋样本（像素→uv），再投影回视图空间取真实几何位置
        '    vec2 off=vec2(cos(a),sin(a))*rr*uResolution;',
        '    off=mat2(ca,-sa,sa,ca)*off;',
        '    vec2 suv=clamp(vUv+off,vec2(0.001),vec2(0.999));',
        '    vec3 S=viewPos(suv,readD(suv));',
        '    vec3 diff=S-P; float len=length(diff);',
        '    float range=smoothstep(1.0,0.0,len/uMaxDist);',
        '    occ+=(max(0.0,dot(normalize(diff),N))-uBias)*range;',
        '  }',
        '  float ao=clamp(1.0-(occ/float(' + AO_KERNEL + '))*uStrength,0.0,1.0);',
        '  gl_FragColor=vec4(col*ao,1.0);',
        '}'
      ].join('\n'),
      depthWrite: false, depthTest: false
    });
  }

  /* ---------------- 生命周期 ---------------- */
  PostFX.init = function (renderer, scene, camera, width, height) {
    if (PostFX.ready) return true;
    if (PostFX._failed || !_flag()) return false;
    if (!T || !T.EffectComposer || !T.RenderPass || !T.ShaderPass || !T.UnrealBloomPass) { PostFX._fail('缺少 r128 后处理组件'); return false; }
    try {
      const w = width || renderer.domElement.width;
      const h = height || renderer.domElement.height;
      // HalfFloat 线性 HDR 渲染目标
      const rtParams = { minFilter: T.LinearFilter, magFilter: T.LinearFilter, format: T.RGBAFormat };
      if (T.HalfFloatType) rtParams.type = T.HalfFloatType;
      const rt = new T.WebGLRenderTarget(w, h, rtParams);
      if (T.HalfFloatType) rt.texture.encoding = T.LinearEncoding;
      // 挂载可采样深度纹理供 SSAO 使用（WebGL2 原生 / WebGL1 需 depth_texture 扩展）
      let aoMat = null, aoPass = null;
      if (_aoFlag() && T.DepthTexture) {
        try {
          rt.depthTexture = new T.DepthTexture(w, h);
          rt.depthTexture.type = T.UnsignedShortType;
        } catch (e) { rt.depthTexture = null; }
      }
      const composer = new T.EffectComposer(renderer, rt);
      // 关键：EffectComposer 双缓冲 RT 经 clone() 会共享同一 DepthTexture，SSAO 采样 readBuffer 深度、
      // 写入 writeBuffer 时若二者深度附件为同一纹理会触发 framebuffer/texture feedback loop（绘制失效）。
      // 给 renderTarget2 配独立 DepthTexture，并每帧让 tDepth 指向 readBuffer 的深度，杜绝反馈环。
      if (rt.depthTexture && composer.renderTarget2) {
        try {
          const dt2 = new T.DepthTexture(w, h);
          dt2.type = T.UnsignedShortType;
          composer.renderTarget2.depthBuffer = true;
          composer.renderTarget2.depthTexture = dt2;
        } catch (e) {}
      }
      composer.addPass(new T.RenderPass(scene, camera));

      // SSAO（独立容错：构建/编译失败仅禁用 AO，不影响其余后处理）
      if (rt.depthTexture) {
        try {
          aoMat = _buildSSAOMaterial(rt.depthTexture);
          aoPass = new T.ShaderPass(aoMat);
          composer.addPass(aoPass);
        } catch (e) { aoMat = null; aoPass = null; try { console.warn('[ThreePostFX] SSAO 初始化失败（跳过）：', e && e.message); } catch (err) {} }
      }

      const bloom = new T.UnrealBloomPass(new T.Vector2(w, h), 0.30, BASE.bloomScatter, 0.92);
      composer.addPass(bloom);

      const mat = _buildCinematicShader();
      mat.uniforms.uResolution.value.set(w, h);
      const cinematic = new T.ShaderPass(mat);
      composer.addPass(cinematic);

      // FXAA 作为最末 pass（启用时由 composer 自动 renderToScreen；关闭时 Cinematic 自动上屏）
      let fxaa = null;
      if (_smaaFlag()) {
        fxaa = new T.ShaderPass(_buildFXAAMaterial());
        fxaa.uniforms.resolution.value.set(1 / w, 1 / h);
        fxaa.enabled = true;
        composer.addPass(fxaa);
      }

      PostFX._composer = composer;
      PostFX._bloom = bloom;
      PostFX._cinematic = cinematic;
      PostFX._fxaa = fxaa;
      PostFX._ao = aoPass;
      PostFX._aoMat = aoMat;
      PostFX._renderer = renderer;
      PostFX._scene = scene;
      PostFX._camera = camera;
      if (_shaftFlag()) PostFX._buildShafts(scene);

      // 主题插值运行态
      const th0 = THEMES[0];
      PostFX._targetTier = 1;
      PostFX._cur = {
        key: _v(th0.key), fog: _v(th0.fog), bg: _v(th0.bg), ambient: _v(th0.ambient), ground: _v(th0.ground),
        grade: _v(th0.grade),
        intensity: th0.intensity, fogScale: th0.fogDensityUnity / THEMES[0].fogDensityUnity,
        bloom: th0.bloom, bloomThresh: th0.bloomThresh, sat: th0.sat, contrast: th0.contrast, vignette: th0.vignette,
        gradeStr: th0.gradeStr, lift: th0.lift
      };
      PostFX._buildEnvironment(renderer, scene);
      PostFX.setSize(w, h);
      PostFX.setTier(1, true);
      PostFX.ready = true;
      PostFX.enabled = true;
      if (renderer.domElement && renderer.domElement.dataset) renderer.domElement.dataset.postfx = 'on';
      if (!PostFX._gqBound && window.GraphicsQuality) {
        PostFX._gqBound = true;
        window.GraphicsQuality.onTierChange(function (t, cfg) {
          try {
            const isAuto = function (k) { return ((localStorage.getItem(k) || 'auto').toLowerCase() === 'auto'); };
            if (isAuto('farmPostAO')) PostFX.setAO(!!cfg.ao);
            if (isAuto('farmPostSMAA')) PostFX.setSMAA(!!cfg.fxaa);
            if (isAuto('farmLightShaft')) PostFX.setLightShaft(!!cfg.shaft);
          } catch (e) { window.GraphicsQuality.markFail('postfxHotTier', e); }
        });
      }
      return true;
    } catch (e) { PostFX._fail('后处理初始化异常: ' + (e && e.message)); return false; }
  };

  PostFX._fail = function (reason) {
    PostFX._failed = true; PostFX.ready = false; PostFX.enabled = false;
    try { console.warn('[ThreePostFX] 禁用并回退直渲：', reason); } catch (e) {}
    try { if (PostFX._renderer && PostFX._renderer.domElement && PostFX._renderer.domElement.dataset) PostFX._renderer.domElement.dataset.postfx = 'failed'; } catch (e) {}
    try { if (window.GraphicsQuality) window.GraphicsQuality.markFail('postfx', new Error(String(reason).slice(0, 120))); } catch (e) {}
  };

  // 程序化暖色反射环境（对齐 CinematicLook.BuildWarmCubemap：sky/hor/ground 三段渐变）。
  // r128 无 environmentIntensity，全强度 IBL 会过亮，故渐变整体压暗；材质侧 envMapIntensity=0.6 再限流。
  // 用等距柱状渐变 + PMREM 生成预滤波环境，赋 scene.environment，保证金属/水晶 PBR 有反射不发黑。
  PostFX._buildEnvironment = function (renderer, scene) {
    try {
      const W = 64, H = 32;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d');
      const sky = [0.98, 0.96, 0.90], hor = [0.86, 0.82, 0.72], grd = [0.64, 0.62, 0.52];
      const DIM = 0.55; // 整体压暗，避免俯视场景 IBL 过曝
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      const rgb = a => 'rgb(' + a.map(v => Math.round(Math.min(1, v * DIM) * 255)).join(',') + ')';
      grad.addColorStop(0, rgb(sky)); grad.addColorStop(0.5, rgb(hor)); grad.addColorStop(1, rgb(grd));
      ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
      const tex = new T.CanvasTexture(cv);
      tex.mapping = T.EquirectangularReflectionMapping;
      if (T.sRGBEncoding) tex.encoding = T.sRGBEncoding;
      const pmrem = new T.PMREMGenerator(renderer);
      const rtEnv = pmrem.fromEquirectangular(tex);
      scene.environment = rtEnv.texture;
      tex.dispose(); pmrem.dispose();
      PostFX._envRT = rtEnv;
      return true;
    } catch (e) { try { console.warn('[ThreePostFX] 暖反射环境生成失败（跳过 IBL）：', e && e.message); } catch (err) {} return false; }
  };

  // contextlost 由 Terrain3D/ThreeEntities 统一处理；这里提供显式停用入口
  PostFX.disable = function () { PostFX.enabled = false; };

  PostFX.setSize = function (w, h) {
    if (!PostFX.ready) return;
    try {
      PostFX._composer.setSize(w, h);
      PostFX._bloom.setSize(w, h);
      PostFX._cinematic.uniforms.uResolution.value.set(w, h);
      if (PostFX._fxaa) PostFX._fxaa.uniforms.resolution.value.set(1 / w, 1 / h);
      if (PostFX._aoMat) PostFX._aoMat.uniforms.uResolution.value.set(1 / w, 1 / h);
    } catch (e) {}
  };

  // 运行时切换 FXAA（farmPostSMAA）；false 时 composer 自动让 Cinematic 上屏
  PostFX.setSMAA = function (on) {
    if (PostFX._fxaa) PostFX._fxaa.enabled = !!on;
  };
  PostFX.smaaActive = function () { return !!(PostFX._fxaa && PostFX._fxaa.enabled); };
  PostFX.setLightShaft = function (on) {
    if (PostFX._shaftGroup) PostFX._shaftGroup.visible = !!on;
  };
  PostFX.lightShaftActive = function () { return !!(PostFX._shaftOn && PostFX._shaftGroup && PostFX._shaftGroup.visible); };
  PostFX.shaftCount = function () { return PostFX._shafts ? PostFX._shafts.filter(m => m.visible).length : 0; };
  PostFX._updateAO = function () {
    if (!PostFX._aoMat || !PostFX._camera || !PostFX._ao || !PostFX._ao.enabled) return;
    const u = PostFX._aoMat.uniforms;
    u.uInvProj.value.copy(PostFX._camera.projectionMatrixInverse);
    u.uProj.value.copy(PostFX._camera.projectionMatrix);
    // 双缓冲：始终采样本帧被 RenderPass 写入的 readBuffer 自身深度（与 writeBuffer 深度附件不同对象）
    const rb = PostFX._composer.readBuffer;
    if (rb && rb.depthTexture) u.tDepth.value = rb.depthTexture;
  };
  PostFX.setAO = function (on) { if (PostFX._ao) PostFX._ao.enabled = !!on; };
  PostFX.aoActive = function () { return !!(PostFX._ao && PostFX._ao.enabled); };

  PostFX.setTier = function (tier, immediate) {
    if (!PostFX.ready) return;
    const idx = Math.max(0, Math.min(3, (tier | 0) - 1));
    PostFX._targetTier = idx + 1;
    const th = THEMES[idx];
    const tgt = PostFX._target = {
      key: _v(th.key), fog: _v(th.fog), bg: _v(th.bg), ambient: _v(th.ambient), ground: _v(th.ground),
      grade: _v(th.grade),
      intensity: th.intensity, fogScale: th.fogDensityUnity / THEMES[0].fogDensityUnity,
      bloom: th.bloom, bloomThresh: th.bloomThresh, sat: th.sat, contrast: th.contrast, vignette: th.vignette,
      gradeStr: th.gradeStr, lift: th.lift
    };
    if (immediate) {
      const c = PostFX._cur;
      c.key.copy(tgt.key); c.fog.copy(tgt.fog); c.bg.copy(tgt.bg); c.ambient.copy(tgt.ambient); c.ground.copy(tgt.ground);
      c.grade.copy(tgt.grade);
      c.intensity = tgt.intensity; c.fogScale = tgt.fogScale; c.bloom = tgt.bloom; c.bloomThresh = tgt.bloomThresh;
      c.sat = tgt.sat; c.contrast = tgt.contrast; c.vignette = tgt.vignette;
      c.gradeStr = tgt.gradeStr; c.lift = tgt.lift;
      PostFX._applyUniforms();
    }
  };

  PostFX._applyUniforms = function () {
    if (!PostFX.ready) return;
    const c = PostFX._cur, u = PostFX._cinematic.uniforms;
    u.uSaturation.value = c.sat / 100;
    u.uContrast.value = (BASE.contrastBase + c.contrast) / 100;
    u.uVignette.value = c.vignette;
    u.uGradeTint.value.copy(c.grade);
    u.uGradeStr.value = c.gradeStr;
    u.uLift.value = c.lift;
    PostFX._bloom.strength = c.bloom;
    PostFX._bloom.threshold = c.bloomThresh;
    PostFX._bloom.radius = BASE.bloomScatter;
  };

  // 每帧：主题 1.5s 平滑插值 + composer 渲染
  PostFX.render = function (delta) {
    if (!PostFX.ready || !PostFX.enabled) return false;
    try {
      const c = PostFX._cur, t = PostFX._target;
      if (t) {
        const k = 1 - Math.exp(-(delta || 1 / 60) / THEME_LERP_SECONDS);
        c.key.lerp(t.key, k); c.fog.lerp(t.fog, k); c.bg.lerp(t.bg, k);
        c.ambient.lerp(t.ambient, k); c.ground.lerp(t.ground, k); c.grade.lerp(t.grade, k);
        c.intensity += (t.intensity - c.intensity) * k;
        c.fogScale += (t.fogScale - c.fogScale) * k;
        c.bloom += (t.bloom - c.bloom) * k; c.bloomThresh += (t.bloomThresh - c.bloomThresh) * k;
        c.sat += (t.sat - c.sat) * k; c.contrast += (t.contrast - c.contrast) * k;
        c.vignette += (t.vignette - c.vignette) * k;
        c.gradeStr += (t.gradeStr - c.gradeStr) * k; c.lift += (t.lift - c.lift) * k;
        PostFX._applyUniforms();
      }
      PostFX._updateAO();
      PostFX._updateShafts(delta);
      PostFX._composer.render(delta);
      return true;
    } catch (e) { PostFX._fail('composer 渲染异常: ' + (e && e.message)); return false; }
  };

  // 当前插值后的主题环境（供 Terrain3D 与昼夜/天气融合）
  PostFX.env = function () { return PostFX.ready ? PostFX._cur : null; };
  PostFX.fogBase = function () { return WEB_FOG_BASE; };
  PostFX.themes = THEMES;

  window.ThreePostFX = PostFX;
})();
