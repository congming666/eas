/* ============================================================
   生态氛围层（v5.9.28）
   1) 每个生态一套主色：写入 CSS 变量 --biome-accent，HUD 纸雕边框随之变化
   2) 每个生态一套程序化氛围音：WebAudio 合成（风/水/虫鸣/废墟回声/高地风啸）
      - 首次用户手势后启动（浏览器自动播放策略）
      - 切换生态 1.6s 交叉淡化
      - 暂停/结算/离开远征/切后台自动压低
      - 设置面板可开关（localStorage farmAmbience）
   ============================================================ */
(function () {
  'use strict';

  const PALETTES = {
    grass:    { name: '草甸', accent: '#9fb45e', paper: '#efe4c8' },
    water:    { name: '浅水', accent: '#5aa9b8', paper: '#e7eff0' },
    mud:      { name: '泥地', accent: '#a9855a', paper: '#ece0c6' },
    forest:   { name: '密林', accent: '#6f8f4e', paper: '#e8ecd8' },
    ruins:    { name: '废墟', accent: '#a89a80', paper: '#ece6d8' },
    highland: { name: '高地', accent: '#d9b45c', paper: '#f2ecd6' }
  };

  const HA = {
    ctx: null,
    master: null,
    noise: null,
    current: null,
    currentName: null,
    layer: null,
    enabled: true,
    volume: 0.16,
    _gestureBound: false,
    _ducked: false,
    _lastT: 0,

    _readSetting() {
      try { return localStorage.getItem('farmAmbience') !== '0'; } catch (e) { return true; }
    },
    _saveSetting(v) {
      try { localStorage.setItem('farmAmbience', v ? '1' : '0'); } catch (e) {}
    },

    setEnabled(v) {
      this.enabled = !!v;
      this._saveSetting(this.enabled);
      if (this.master) {
        this.master.gain.setTargetAtTime(this.enabled && !this._ducked ? this.volume : 0, this.ctx.currentTime, 0.25);
      }
      if (this.enabled) this._ensureContext();
      this._syncToggleUI();
      return this.enabled;
    },

    toggle() { return this.setEnabled(!this.enabled); },

    _ensureContext() {
      if (!this.enabled) return false;
      if (this.ctx) return this.ctx.state !== 'closed';
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0;
        this.master.connect(this.ctx.destination);
        // 2 秒白噪声缓冲（所有风声/水声/噪声床复用）
        const len = this.ctx.sampleRate * 2;
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.noise = buf;
        return true;
      } catch (e) {
        console.warn('[BiomeAmbience] 音频初始化失败，静默降级：', e);
        return false;
      }
    },

    _bindGesture() {
      if (this._gestureBound) return;
      this._gestureBound = true;
      const unlock = () => {
        if (this._unlocked) return;
        this._unlocked = true;
        try {
          if (this._ensureContext() && this.ctx.state === 'suspended') this.ctx.resume();
          if (this.ctx && this.current) this._startLayer(this.current, true);
          if (this.ctx && this._ducked === false) {
            this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.6);
          }
        } catch (e) {}
      };
      ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, unlock, { once: false, passive: true }));
    },

    _makeNoiseSource() {
      if (!this.ctx || !this.noise) return null;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      return src;
    },

    _tone(freq, dur, gain, type, targetGain) {
      if (!this.ctx) return null;
      try {
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = type || 'sine';
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(g).connect(targetGain || this.master);
        osc.start(t);
        osc.stop(t + dur + 0.05);
        return osc;
      } catch (e) { return null; }
    },

    _noiseBurst(dur, gain, filterType, freq) {
      if (!this.ctx) return;
      try {
        const t = this.ctx.currentTime;
        const src = this._makeNoiseSource();
        if (!src) return;
        const f = this.ctx.createBiquadFilter();
        f.type = filterType || 'lowpass';
        f.frequency.value = freq || 800;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(gain, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(f).connect(g).connect(this.master);
        src.start(t);
        src.stop(t + dur + 0.05);
      } catch (e) {}
    },

    /* ---------------- 各生态层 ---------------- */
    _profile(name) {
      const self = this;
      const ctx = this.ctx;
      const out = ctx.createGain();
      out.gain.value = 0;
      out.connect(this.master);
      const nodes = [];
      const stopAll = () => {
        nodes.forEach((n) => { try { if (n.stop) n.stop(); else if (n.disconnect) n.disconnect(); } catch (e) {} });
        try { out.disconnect(); } catch (e) {}
      };
      const bed = (filterType, freq, q, level, lfoRate, lfoAmp) => {
        const src = self._makeNoiseSource();
        if (!src) return;
        const f = ctx.createBiquadFilter();
        f.type = filterType; f.frequency.value = freq; f.Q.value = q || 0.7;
        const g = ctx.createGain(); g.gain.value = level;
        src.connect(f).connect(g).connect(out);
        src.start();
        nodes.push(src, f, g);
        if (lfoRate && lfoAmp) {
          const lfo = ctx.createOscillator();
          const lg = ctx.createGain();
          lfo.frequency.value = lfoRate; lg.gain.value = lfoAmp;
          lfo.connect(lg).connect(g.gain);
          lfo.start();
          nodes.push(lfo, lg);
        }
      };

      if (name === 'grass') {
        bed('lowpass', 480, 0.6, 0.05, 0.07, 0.018);
        bed('highpass', 2600, 0.5, 0.006, 0, 0);
        return {
          out, stopAll,
          tick(t, dt) {
            // 鸟鸣：随机 1-2 声短促上滑
            if (Math.random() < dt * 0.55) {
              const f = 1700 + Math.random() * 1200;
              self._tone(f, 0.06, 0.012, 'sine', out);
              setTimeout(() => self._tone(f * 1.25, 0.05, 0.009, 'sine', out), 85);
            }
          }
        };
      }
      if (name === 'forest') {
        bed('lowpass', 640, 0.7, 0.045, 0.05, 0.02);
        bed('highpass', 3400, 0.5, 0.008, 0, 0);
        return {
          out, stopAll,
          tick(t, dt) {
            // 虫鸣：高频短脉冲成串
            if (Math.random() < dt * 2.2) {
              for (let i = 0; i < 3; i++) setTimeout(() => self._tone(4200 + Math.random() * 600, 0.025, 0.006, 'square', out), i * 42);
            }
          }
        };
      }
      if (name === 'water') {
        bed('bandpass', 760, 1.1, 0.05, 0.12, 0.022);
        bed('lowpass', 240, 0.6, 0.03, 0.04, 0.012);
        return {
          out, stopAll,
          tick(t, dt) {
            // 气泡咕嘟
            if (Math.random() < dt * 0.9) {
              const osc = ctx.createOscillator();
              const g = ctx.createGain();
              const f0 = 260 + Math.random() * 220;
              osc.type = 'sine';
              osc.frequency.setValueAtTime(f0, ctx.currentTime);
              osc.frequency.exponentialRampToValueAtTime(f0 * 2.1, ctx.currentTime + 0.12);
              g.gain.setValueAtTime(0.0001, ctx.currentTime);
              g.gain.exponentialRampToValueAtTime(0.012, ctx.currentTime + 0.02);
              g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
              osc.connect(g).connect(out);
              osc.start(); osc.stop(ctx.currentTime + 0.22);
            }
          }
        };
      }
      if (name === 'mud') {
        bed('lowpass', 180, 0.8, 0.05, 0.06, 0.018);
        return {
          out, stopAll,
          tick(t, dt) {
            if (Math.random() < dt * 0.7) self._noiseBurst(0.16, 0.012, 'lowpass', 220);
            if (Math.random() < dt * 0.6) self._tone(520 + Math.random() * 300, 0.03, 0.004, 'triangle', out);
          }
        };
      }
      if (name === 'ruins') {
        bed('lowpass', 300, 0.6, 0.028, 0.03, 0.01);
        // 低频空洞共振
        try {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.value = 54;
          g.gain.value = 0.012;
          osc.connect(g).connect(out);
          osc.start();
          nodes.push(osc, g);
        } catch (e) {}
        return {
          out, stopAll,
          tick(t, dt) {
            // 滴水回声
            if (Math.random() < dt * 0.5) {
              const f = 1300 + Math.random() * 900;
              self._tone(f, 0.09, 0.007, 'sine', out);
              setTimeout(() => self._tone(f * 0.98, 0.16, 0.0035, 'sine', out), 170);
            }
            if (Math.random() < dt * 0.35) self._noiseBurst(0.1, 0.008, 'bandpass', 900);
          }
        };
      }
      if (name === 'highland') {
        bed('lowpass', 860, 0.6, 0.05, 0.09, 0.02);
        bed('bandpass', 1500, 1.4, 0.012, 0.13, 0.008);
        return {
          out, stopAll,
          tick(t, dt) {
            if (Math.random() < dt * 0.35) self._tone(2200 + Math.random() * 600, 0.18, 0.004, 'sine', out);
          }
        };
      }
      // 兜底：草甸
      return this._profile('grass');
    },

    _startLayer(name, force) {
      if (!this.ctx) return;
      if (this.current === name && this.layer && !force) return;
      const now = this.ctx.currentTime;
      // 旧层淡出
      if (this.layer) {
        const old = this.layer;
        try {
          old.out.gain.cancelScheduledValues(now);
          old.out.gain.setTargetAtTime(0, now, 0.35);
        } catch (e) {}
        setTimeout(() => { try { old.stopAll(); } catch (e) {} }, 2000);
      }
      this.currentName = name;
      this.layer = this._profile(name);
      try {
        this.layer.out.gain.setValueAtTime(0, now);
        this.layer.out.gain.setTargetAtTime(0.9, now, 0.45);
      } catch (e) {}
    },

    /* ---------------- 每帧更新 ---------------- */
    update(exp, dt) {
      if (!exp || !exp.player) return;
      this._lastT += dt || 0.016;
      this._bindGesture();
      if (!this.enabled) return;
      if (!this._ensureContext()) return;
      if (this.ctx.state === 'suspended') { try { this.ctx.resume(); } catch (e) {} }

      let terrId = 'grass';
      try {
        const t = exp.getTerrainAt ? exp.getTerrainAt(exp.player.x, exp.player.y) : null;
        terrId = (t && t.id) || 'grass';
      } catch (e) {}
      const pal = PALETTES[terrId] || PALETTES.grass;
      if (this.current !== terrId) {
        this.current = terrId;
        this._startLayer(terrId);
        const hud = document.getElementById('expeditionHUD');
        if (hud) {
          hud.style.setProperty('--biome-accent', pal.accent);
          hud.dataset.biome = terrId;
        }
        document.documentElement.style.setProperty('--biome-accent', pal.accent);
      }
      // 压低条件：暂停/结算/死亡/后台/不在远征
      const hudHidden = (() => { const h = document.getElementById('expeditionHUD'); return !h || h.classList.contains('hidden'); })();
      const resultVisible = (() => { const r = document.getElementById('resultScreen'); return r && !r.classList.contains('hidden'); })();
      const duck = !!(exp.paused || exp.gameOver || exp.dying || document.hidden || hudHidden || resultVisible);
      if (duck !== this._ducked) {
        this._ducked = duck;
        try {
          this.master.gain.setTargetAtTime(duck ? 0 : this.volume, this.ctx.currentTime, duck ? 0.12 : 0.5);
        } catch (e) {}
      }
      if (!duck && this.layer && this.layer.tick) {
        try { this.layer.tick(this._lastT, dt || 0.016); } catch (e) {}
      }
    },

    /* 离开远征时（update 不再被调用）也需要复位 HUD 主色 */
    resetAccent() {
      const hud = document.getElementById('expeditionHUD');
      if (hud) hud.style.setProperty('--biome-accent', '#c9a25a');
      document.documentElement.style.setProperty('--biome-accent', '#c9a25a');
      this.current = null;
      if (this.layer) { try { this.layer.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3); } catch (e) {} }
    },

    /* ---------------- 设置入口 ---------------- */
    _syncToggleUI() {
      const cb = document.getElementById('ambienceToggle');
      if (cb) cb.checked = this.enabled;
    },

    _mountSettings() {
      const panel = document.querySelector('.title-settings-panel');
      if (!panel || document.getElementById('ambienceToggle')) return;
      const label = document.createElement('label');
      label.className = 'ambience-option';
      label.innerHTML = '<input id="ambienceToggle" type="checkbox" checked> 生态环境音（风声/水声/虫鸣）';
      panel.appendChild(label);
      const cb = label.querySelector('#ambienceToggle');
      cb.checked = this.enabled;
      cb.addEventListener('change', () => this.setEnabled(cb.checked));
    },

    init() {
      this.enabled = this._readSetting();
      this._bindGesture();
      this._syncToggleUI();
      this._mountSettings();
      // 离开远征/回农场：停氛围音并复位主色（update 不再被调用，用低成本轮询兜底）
      setInterval(() => {
        const hud = document.getElementById('expeditionHUD');
        const hidden = !hud || hud.classList.contains('hidden');
        if (hidden) {
          if (this.layer && this.master) {
            try { this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3); } catch (e) {}
          }
          if (this.current) this.resetAccent();
        } else if (this.ctx && !this._ducked) {
          try { this.master.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime, 0.5); } catch (e) {}
        }
      }, 600);
      console.log('[BiomeAmbience] 生态色板 + 程序化氛围音已加载（enabled=' + this.enabled + '）');
    }
  };

  window.BiomeAmbience = HA;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => HA.init());
  } else {
    HA.init();
  }
})();
