/* ============================================================
   Juice FX（v5.9.28）
   收获 / 暴击 / 撤离成功的顿帧、粒子、屏幕反馈与音效编排。
   设计原则：不重写原逻辑，用 hook 包一层；音效复用 AudioManager 现有合成器，
   额外叠低频/金币/庆祝层，避免重复造轮子。
   ============================================================ */
(function () {
  'use strict';

  const JuiceFX = {
    _flashTimer: null,
    _lastCoinAt: 0,
    _pendingExtract: false,
    _confettiDone: false,

    /* ---------------- 基础屏幕反馈 ---------------- */
    _ensureFlash() {
      let el = document.getElementById('juiceFlash');
      if (!el) {
        el = document.createElement('div');
        el.id = 'juiceFlash';
        document.body.appendChild(el);
      }
      return el;
    },

    flash(kind) {
      const el = this._ensureFlash();
      el.className = kind === 'crit' ? 'crit on' : 'on';
      clearTimeout(this._flashTimer);
      this._flashTimer = setTimeout(() => { el.className = ''; }, kind === 'crit' ? 90 : 140);
    },

    shakeFarm() {
      const screen = document.getElementById('farmScreen');
      if (!screen) return;
      screen.classList.remove('juice-shake');
      void screen.offsetWidth;
      screen.classList.add('juice-shake');
      setTimeout(() => screen.classList.remove('juice-shake'), 320);
    },

    popGold() {
      ['goldDisplay', 'prepGoldDisplay'].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.remove('juice-pop');
        void el.offsetWidth;
        el.classList.add('juice-pop');
        setTimeout(() => el.classList.remove('juice-pop'), 340);
      });
    },

    particle(emoji, x, y, opts) {
      const o = opts || {};
      const el = document.createElement('div');
      el.className = 'juice-particle';
      el.textContent = emoji;
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      el.style.fontSize = (o.size || 15) + 'px';
      document.body.appendChild(el);
      const dx = o.dx !== undefined ? o.dx : (Math.random() - 0.5) * 80;
      const dy = o.dy !== undefined ? o.dy : -40 - Math.random() * 40;
      const rot = (Math.random() - 0.5) * 180;
      const dur = o.dur || 650;
      try {
        const anim = el.animate([
          { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
          { transform: `translate(${dx}px,${dy}px) rotate(${rot}deg)`, opacity: 0 }
        ], { duration: dur, easing: o.ease || 'cubic-bezier(.2,.7,.3,1)' });
        anim.onfinish = () => el.remove();
      } catch (e) {
        setTimeout(() => el.remove(), dur);
      }
      return el;
    },

    banner(text, ms) {
      const el = document.createElement('div');
      el.className = 'juice-banner';
      el.textContent = text;
      document.body.appendChild(el);
      setTimeout(() => {
        el.style.transition = 'opacity .3s ease, transform .3s ease';
        el.style.opacity = '0';
        el.style.transform = 'translate(-50%,-50%) rotate(-2deg) scale(.9)';
        setTimeout(() => el.remove(), 320);
      }, ms || 1100);
    },

    /* ---------------- 收获 ---------------- */
    harvest(idx, cropOverride) {
      const now = performance.now();
      const plot = (typeof GameState !== 'undefined' && GameState.farmPlots) ? GameState.farmPlots[idx] : null;
      const crop = cropOverride || (plot && plot.crop);
      const cells = document.querySelectorAll('#farmGrid .farm-cell');
      const cell = cells[idx];
      let cx = window.innerWidth / 2, cy = window.innerHeight / 2;
      if (cell) {
        const r = cell.getBoundingClientRect();
        cx = r.left + r.width / 2;
        cy = r.top + r.height / 2;
      }
      const icon = (crop && crop.rewardType === 'oil') ? '🛢️' : (crop && crop.icon) || '🌾';
      // 叶片 + 作物飞出
      for (let i = 0; i < 2; i++) {
        this.particle(i ? '🍃' : icon, cx + (Math.random() - .5) * 18, cy, { size: i ? 13 : 17, dx: (Math.random() - .5) * 70, dy: -45 - Math.random() * 30, dur: 620 });
      }
      // 金币类作物：金币弹跳 + 叮（节流）
      if (crop && crop.rewardType === 'gold' && now - this._lastCoinAt > 180) {
        this._lastCoinAt = now;
        this.particle('🪙', cx, cy - 8, { size: 16, dx: (Math.random() - .5) * 60, dy: -58, dur: 700 });
        if (typeof AudioManager !== 'undefined' && AudioManager.playCoinSfx) AudioManager.playCoinSfx();
        this.popGold();
      }
      // 连收：轻微震屏，不超过 3 次/秒
      if (this._harvestShakeAt === undefined || now - this._harvestShakeAt > 320) {
        this._harvestShakeAt = now;
        this.shakeFarm();
      }
    },

    /* ---------------- 暴击 ---------------- */
    onCrit(exp, target, info) {
      if (!exp || !target) return;
      this.flash('crit');
      // 额外低频轰击 + 金属高频（叠加在 AudioManager.playCritHit 之上）
      try {
        AudioManager.playTone(96, 0.09, 'sine', 0.06);
        AudioManager.playNoise(0.05, 0.022, 5200, 'highpass');
      } catch (e) {}
      exp.hitStop = Math.max(exp.hitStop || 0, 0.055);
      exp.screenShake = Math.max(exp.screenShake || 0, 0.55);
      // 世界坐标 → 屏幕坐标的星屑粒子
      try {
        const canvas = document.getElementById('gameCanvas');
        const rect = canvas.getBoundingClientRect();
        const cam = exp.camera;
        const zoom = cam.zoom || 0.86;
        const sx = rect.left + ((target.x - cam.x) * zoom) * (rect.width / canvas.width);
        const sy = rect.top + ((target.y - cam.y) * zoom) * (rect.height / canvas.height);
        for (let i = 0; i < 3; i++) {
          this.particle('✦', sx + (Math.random() - .5) * 24, sy - 18 - Math.random() * 10, {
            size: 13 + Math.random() * 7, dx: (Math.random() - .5) * 90, dy: -30 - Math.random() * 50, dur: 480
          });
        }
      } catch (e) {}
    },

    /* ---------------- 撤离成功 ---------------- */
    extractSuccess(exp) {
      this.flash();
      this.popGold();
      // 金色雨（结果页出现后会立刻停止并清理）
      this._extractAlive = true;
      for (let i = 0; i < 22; i++) {
        setTimeout(() => {
          if (!this._extractAlive) return;
          this.particle(i % 3 === 0 ? '✨' : '🪙', Math.random() * window.innerWidth, -20, {
            size: 14 + Math.random() * 8,
            dx: (Math.random() - .5) * 24,
            dy: window.innerHeight * (0.7 + Math.random() * 0.35),
            dur: 1400 + Math.random() * 700,
            ease: 'cubic-bezier(.15,.55,.4,1)'
          });
        }, i * 45);
      }
      // 上行琶音（叠在 playEvacuateSuccess 之上，不替代）
      try {
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((f, i) => setTimeout(() => AudioManager.playTone(f, 0.16, 'triangle', 0.035), i * 90));
      } catch (e) {}
      if (exp) exp.hitStop = Math.max(exp.hitStop || 0, 0.12);
      this._extractParticles = true;
    },

    /* 结算页出现后撒纸屑 */
    confetti() {
      const colors = ['#e8dbbb', '#c9a25a', '#b5563f', '#6f8f4e', '#4f7f8a'];
      for (let i = 0; i < 46; i++) {
        const el = document.createElement('div');
        el.className = 'juice-particle';
        el.style.width = (5 + Math.random() * 6) + 'px';
        el.style.height = (3 + Math.random() * 4) + 'px';
        el.style.background = colors[i % colors.length];
        el.style.border = i % 4 === 0 ? '1px solid rgba(74,58,34,.5)' : 'none';
        el.style.left = (Math.random() * window.innerWidth) + 'px';
        el.style.top = '-12px';
        document.body.appendChild(el);
        try {
          const anim = el.animate([
            { transform: 'translateY(0) rotate(0deg)', opacity: 1 },
            { transform: `translateY(${window.innerHeight * (0.8 + Math.random() * 0.35)}px) rotate(${360 + Math.random() * 540}deg)`, opacity: 0 }
          ], { duration: 1300 + Math.random() * 900, easing: 'cubic-bezier(.2,.6,.5,1)', delay: Math.random() * 260 });
          anim.onfinish = () => el.remove();
        } catch (e) { setTimeout(() => el.remove(), 1800); }
      }
    },

    tick(exp) {
      // 结算页不再叠加横幅/纸屑/金色雨：撤离反馈只留在战斗内
      if (this._extractParticles) {
        const rs = document.getElementById('resultScreen');
        if (rs && !rs.classList.contains('hidden')) {
          this._extractParticles = false;
          this._extractAlive = false;
          document.querySelectorAll('.juice-particle').forEach((el) => el.remove());
        }
      }
    },

    init() {
      if (window.__juiceInit) return;
      window.__juiceInit = true;

      /* 收获 hook：成功收获后触发 */
      if (typeof Farm !== 'undefined' && Farm && typeof Farm.harvest === 'function' && !Farm.__juiceHarvest) {
        Farm.__juiceHarvest = true;
        const orig = Farm.harvest;
        Farm.harvest = function (idx, opts) {
          const plot = (GameState && GameState.farmPlots) ? GameState.farmPlots[idx] : null;
          const crop = plot && plot.crop;
          const result = orig.call(this, idx, opts);
          if (result) {
            try { JuiceFX.harvest(idx, crop); } catch (e) {}
            JuiceFX._harvestCount = (JuiceFX._harvestCount || 0) + 1;
            if (JuiceFX._harvestCount % 6 === 0) {
              JuiceFX.banner('连 收 ×' + JuiceFX._harvestCount, 700);
            }
          }
          return result;
        };
      }

      /* 撤离成功 hook：原逻辑先跑（结算/成就），再叠庆祝 */
      if (typeof Expedition !== 'undefined' && Expedition.prototype.completeExtract && !Expedition.prototype.__juiceExtract) {
        Expedition.prototype.__juiceExtract = true;
        const origComplete = Expedition.prototype.completeExtract;
        Expedition.prototype.completeExtract = function () {
          const r = origComplete.apply(this, arguments);
          try { JuiceFX.extractSuccess(this); } catch (e) {}
          return r;
        };
      }

      /* 每帧 tick：结算页冒纸屑 + 生态氛围音/主色更新 */
      if (typeof Expedition !== 'undefined' && Expedition.prototype.update && !Expedition.prototype.__juiceTick) {
        Expedition.prototype.__juiceTick = true;
        const origUpdate = Expedition.prototype.update;
        Expedition.prototype.update = function (dt) {
          const r = origUpdate.call(this, dt);
          try { JuiceFX.tick(this); } catch (e) {}
          try { if (window.BiomeAmbience) BiomeAmbience.update(this, dt); } catch (e) {}
          return r;
        };
      }
    }
  };

  window.JuiceFX = JuiceFX;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => JuiceFX.init());
  } else {
    JuiceFX.init();
  }
  console.log('[JuiceFX] 收获/暴击/撤离成功特效层已加载');
})();
