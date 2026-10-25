/* ============================================================
 * GraphicsQuality —— 3D 渲染画质分级 / 统一开关 / 运行时自适应（方案C P6）
 *
 * 职责：
 *  1) 集中解析所有 farm* 渲染开关（localStorage：on/off/auto），auto 时按画质档给默认；
 *  2) 三档配置 high/mid/low（DPR、阴影分辨率、AO、FXAA、Bloom、光柱、生物池容量）；
 *  3) 启动硬件/环境探测定初始档，运行时连续 30 帧 <45fps 自动降一档（只降不升，防抖动）；
 *  4) 档位持久化 localStorage.farmGfxTier，降档 toast + Telemetry 埋点 + DOM dataset 标记；
 *  5) 能力失败统一 markFail() 记录 dataset/console.warn，供三级回退与自动化断言；
 *  6) ?debug=1 挂载轻量画质控件（实时 fps / 手动切档 / 开关切换）。
 *
 * 纯原生 JS，不依赖 THREE；消费方（Terrain3D/ThreeEntities/ThreePostFX）在初始化与
 * onTierChange 回调中读取 config()。DPR 与后处理 pass 可热切换；阴影分辨率/池容量下次进图生效。
 * ============================================================ */
(function () {
  'use strict';

  var TIER_KEY = 'farmGfxTier';
  var SLOW_FRAME_MS = 1000 / 45;      // 45fps 阈值
  var SLOW_TRIGGER = 30;              // 连续 30 帧不达标即降档
  var WARMUP_FRAMES = 120;            // 启动预热帧，避免加载抖动误判
  var LOWEST = 2;

  // 三档静态参数表
  var TIERS = [
    { name: 'high', label: '高', dpr: 1.5, shadowMap: 2048, ao: true, fxaa: true, bloom: true, shaft: true, pool: 80 },
    { name: 'mid', label: '中', dpr: 1.25, shadowMap: 1024, ao: false, fxaa: true, bloom: true, shaft: true, pool: 50 },
    { name: 'low', label: '低', dpr: 1.0, shadowMap: 1024, ao: false, fxaa: false, bloom: true, shaft: false, pool: 30 }
  ];

  var GQ = {
    TIER_HIGH: 0, TIER_MID: 1, TIER_LOW: 2,
    _tier: 0,
    _userLocked: false,      // 手动选档后不再自动降档之外的干预
    _frame: 0,
    _slow: 0,
    _fps: 60,
    _fpsHist: [],
    _changeCbs: [],
    _entityCountFns: [],
    _failed: Object.create(null),
    _uiReady: false,

    /* ---------- 初始档位探测 ---------- */
    detect: function () {
      var saved = null;
      try { saved = localStorage.getItem(TIER_KEY); } catch (e) {}
      if (saved === '0' || saved === '1' || saved === '2') {
        this._tier = parseInt(saved, 10);
        this._userLocked = true;
        return this._tier;
      }
      var t = 0;
      try {
        var nav = navigator || {};
        var mobile = /android|iphone|ipad|ipod|mobile/i.test(nav.userAgent || '') ||
          (nav.maxTouchPoints && nav.maxTouchPoints > 1);
        var cores = nav.hardwareConcurrency || 4;
        var mem = nav.deviceMemory || 4;
        var renderer = this._glRenderer();
        var software = /swiftshader|llvmpipe|softpipe|mesa offscreen|basic render/i.test(renderer);
        if (software) t = 2;                       // 软件渲染 / 无独显
        else if (mobile || cores <= 4 || mem <= 2) t = 1;
        else t = 0;
      } catch (e) { t = 0; }
      this._tier = t;
      try {
        var root = document.documentElement;
        if (root) root.setAttribute('data-gfx-tier', TIERS[t].name);
      } catch (e) {}
      return t;
    },

    _glRenderer: function () {
      try {
        var c = document.createElement('canvas');
        var gl = c.getContext('webgl2') || c.getContext('webgl');
        if (!gl) return '';
        var dbg = gl.getExtension('WEBGL_debug_renderer_info');
        return dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '') : '';
      } catch (e) { return ''; }
    },

    /* ---------- 读取 ---------- */
    tier: function () { return this._tier; },
    tierName: function () { return TIERS[this._tier].name; },
    config: function () { return TIERS[this._tier]; },
    fps: function () { return Math.round(this._fps * 10) / 10; },
    failed: function () { return Object.assign({}, this._failed); },

    /* ---------- 统一 farm* 开关解析：on/off/auto ----------
     * key: localStorage 键；autoOn: 当前档下 auto 的默认布尔。 */
    enabled: function (key, autoOn) {
      var v = null;
      try { v = localStorage.getItem(key); } catch (e) {}
      if (v === 'on') return true;
      if (v === 'off') return false;
      return !!autoOn;
    },

    /* ---------- 档位切换（手动/自动） ---------- */
    setTier: function (t, reason) {
      t = Math.max(0, Math.min(LOWEST, t | 0));
      var prev = this._tier;
      if (t === prev && reason !== 'manual') return false;
      this._tier = t;
      this._slow = 0;
      try { localStorage.setItem(TIER_KEY, String(t)); } catch (e) {}
      try {
        var root = document.documentElement;
        if (root) root.setAttribute('data-gfx-tier', TIERS[t].name);
      } catch (e) {}
      try { if (window.Telemetry && Telemetry.track) Telemetry.track('graphics_tier', { from: prev, to: t, reason: reason || 'unknown', fps: Math.round(this._fps * 10) / 10 }); } catch (e) {}
      for (var i = 0; i < this._changeCbs.length; i++) {
        try { this._changeCbs[i](t, TIERS[t], prev); } catch (e) { console.warn('[GQ] tier change callback failed', e); }
      }
      if (reason === 'manual') this._userLocked = true;
      return true;
    },

    onTierChange: function (fn) { if (typeof fn === 'function') this._changeCbs.push(fn); },
    registerEntityCount: function (fn) { if (typeof fn === 'function') this._entityCountFns.push(fn); },

    /* ---------- 能力失败标记（三级回退） ---------- */
    markFail: function (capability, err) {
      this._failed[capability] = (err && err.message) ? String(err.message).slice(0, 160) : 'failed';
      try {
        var root = document.documentElement;
        if (root) root.setAttribute('data-gq-fail-' + capability, '1');
      } catch (e) {}
      console.warn('[GQ] 能力已降级关闭：' + capability, err || '');
      try { if (window.Telemetry && Telemetry.track) Telemetry.track('graphics_fail', { capability: capability, error: this._failed[capability] }); } catch (e) {}
    },

    /* ---------- 每帧采样（由主渲染循环调用，dt 单位 ms） ---------- */
    recordFrame: function (dtMs) {
      if (!(dtMs > 0) || !isFinite(dtMs)) return;
      this._frame++;
      this._fpsHist.push(dtMs);
      if (this._fpsHist.length > 60) this._fpsHist.shift();
      var sum = 0;
      for (var i = 0; i < this._fpsHist.length; i++) sum += this._fpsHist[i];
      this._fps = 1000 / (sum / this._fpsHist.length);

      if (this._frame <= WARMUP_FRAMES || this._tier >= LOWEST) return;
      if (dtMs > SLOW_FRAME_MS) {
        this._slow++;
        if (this._slow >= SLOW_TRIGGER) {
          var from = this._tier;
          this.setTier(this._tier + 1, 'autodown');
          this._slow = 0;
          this._notifyDowngrade(from, this._tier);
        }
      } else if (this._slow > 0) {
        this._slow--;   // 达标帧逐步抵消，容忍偶发卡顿
      }
    },

    _notifyDowngrade: function (from, to) {
      var msg = '检测到画面卡顿，画质已自动调至「' + TIERS[to].label + '」档以保证流畅（部分设置下次进图生效）';
      try { if (typeof showToast === 'function') showToast(msg, 'gold'); } catch (e) {}
      console.warn('[GQ] ' + msg);
      try { if (this._dbgLabel) this._renderDebug(); } catch (e) {}
    },

    /* ---------- 调试控件（仅 ?debug=1） ---------- */
    mountDebug: function () {
      if (this._uiReady || typeof document === 'undefined') return;
      if (new URLSearchParams((location.search || '')).get('debug') !== '1') return;
      this._uiReady = true;
      var self = this;
      var box = document.createElement('div');
      box.id = 'gqDebug';
      box.style.cssText = 'position:fixed;right:10px;top:10px;z-index:9500;padding:8px 10px;border-radius:10px;' +
        'background:rgba(20,24,20,.88);color:#cfe8cf;border:1px solid #5a8a5a;font:12px/1.5 monospace;min-width:150px;';
      this._dbgBox = box;
      document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(box); self._renderDebug(); });
      if (document.body) { document.body.appendChild(box); this._renderDebug(); }
      setInterval(function () { self._renderDebug(); }, 500);
    },

    _renderDebug: function () {
      if (!this._dbgBox) return;
      var self = this;
      var ent = 0;
      try { this._entityCountFns.forEach(function (f) { ent += f() || 0; }); } catch (e) {}
      var btns = TIERS.map(function (tt, i) {
        var on = i === self._tier;
        return '<button data-gqt="' + i + '" style="margin:2px;padding:2px 8px;cursor:pointer;border-radius:5px;' +
          (on ? 'background:#3a6a3a;color:#fff;' : 'background:#2a2f2a;color:#bbb;') + 'border:1px solid #5a8a5a">' + tt.label + '</button>';
      }).join('');
      this._dbgBox.innerHTML =
        '<div style="color:#9fd; font-weight:bold;margin-bottom:4px;">画质调试</div>' +
        '<div>档位：<b>' + TIERS[this._tier].label + '</b> ' + this.tierName() + '</div>' +
        '<div>fps：<b>' + this.fps() + '</b> 慢帧:' + this._slow + '/' + SLOW_TRIGGER + '</div>' +
        '<div>DPR ' + this.config().dpr + ' / 阴影 ' + this.config().shadowMap + ' / 池 ' + this.config().pool + '</div>' +
        '<div>AO ' + this.config().ao + ' FXAA ' + this.config().fxaa + ' 光柱 ' + this.config().shaft + '</div>' +
        '<div>实体 ' + ent + '</div>' +
        '<div style="margin-top:4px;">' + btns + '</div>';
      var btns2 = this._dbgBox.querySelectorAll('[data-gqt]');
      for (var i = 0; i < btns2.length; i++) {
        btns2[i].onclick = function () { self.setTier(parseInt(this.getAttribute('data-gqt'), 10), 'manual'); self._renderDebug(); };
      }
    }
  };

  GQ.detect();
  GQ.mountDebug();
  window.GraphicsQuality = GQ;
})();
