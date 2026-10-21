// ==================== P0 农场手感层 ====================
// 滑动连收 / 拖拽播种 / 资源图标飞行 + 数字回弹弹跳
// 所有显示层参数统一在 CONFIG.fx（js/config.js）：本模块直接读字段，
// 并通过 applyCssVars() 注入 --fx-* CSS 变量供 v58-farm.css 消费。
// 设计约束：
//  - Farm.render() 每 CONFIG.fx.renderInterval 全量重建 DOM：手势按坐标走 elementFromPoint，不依赖旧节点
//  - 成熟摇摆/泛光等循环动画周期 = renderInterval 且首尾姿态一致（重建时无缝续播）；
//    改 renderInterval 后需重启农场屏（离开再进入）让定时器按新周期重建
//  - 单击行为完全保留（收获即时化、空地仍弹选种器），拖拽超过 dragThreshold 才进入批量模式
//  - 批量模式：跳过逐格 toast（结束时汇总一条）、延迟存档（结束统一 save）
(function () {
  'use strict';

  // 显示层参数快捷引用（CONFIG 在本文件之前加载，见 index.html）
  const FX = () => CONFIG.fx;

  const FarmFX = {
    get DRAG_THRESHOLD() { return FX().gesture.dragThreshold; }, // 兼容旧引用，始终读最新配置
    _inited: false,
    _session: null,    // {act:'harvest'|'plant', mode:'press'|'sweep'|'sow'|'done', startX, startY, lastIdx, swept}
    _clickSuppress: false,
    _csT: null,

    init() {
      if (this._inited) return;
      this.applyCssVars(); // 先注入变量，动画/keyframes 随后渲染即取到
      const grid = document.getElementById('farmGrid');
      if (!grid) { // 农场屏尚未进 DOM：幂等重试
        setTimeout(() => this.init(), 400);
        return;
      }
      this._inited = true;
      grid.addEventListener('pointerdown', e => this._onDown(e));
      document.addEventListener('pointermove', e => { if (this._session) this._onMove(e); });
      document.addEventListener('pointerup', e => this._onUp(e));
      document.addEventListener('pointercancel', e => this._onUp(e));
    },

    // 把 CONFIG.fx 同步为 --fx-* CSS 变量（v58-farm.css 消费）。
    // 运行时热调手感：改 CONFIG.fx 字段后重新调用本方法即可（循环动画周期除外，见文件头注释）。
    applyCssVars() {
      const fx = FX(); if (!fx) return;
      const s = document.documentElement.style;
      const px = n => n + 'px', ms = n => n + 'ms';
      const g = fx.grid;
      // 网格模板：cols>0 固定列数；cols=0 自适应（按 cellMin auto-fill）
      const tmpl = g.cols > 0
        ? 'repeat(' + g.cols + ', minmax(0, 1fr))'
        : 'repeat(auto-fill, minmax(' + g.cellMin + 'px, 1fr))';
      s.setProperty('--fx-grid-template', tmpl);
      s.setProperty('--fx-cell-h', px(g.cellH));
      s.setProperty('--fx-loop-period', ms(fx.renderInterval || 1000));
      s.setProperty('--fx-cell-min', px(g.cellMin));
      s.setProperty('--fx-grid-gap', px(g.gap));
      s.setProperty('--fx-cell-radius', px(g.radius));
      s.setProperty('--fx-sway-deg', fx.ready.swayDeg + 'deg');
      s.setProperty('--fx-sway-lift', px(fx.ready.swayLift));
      s.setProperty('--fx-glow-color', fx.ready.glowColor);
      s.setProperty('--fx-glow-core', fx.ready.glowCore);
      s.setProperty('--fx-glow-low', '' + fx.ready.glowLow);
      s.setProperty('--fx-glow-high', '' + fx.ready.glowHigh);
      s.setProperty('--fx-sow-dur', ms(fx.bounce.sowDur));
      s.setProperty('--fx-sow-squash', '' + fx.bounce.sowSquash);
      s.setProperty('--fx-sow-overshoot', '' + fx.bounce.sowOvershoot);
      s.setProperty('--fx-spring', fx.bounce.spring);
      s.setProperty('--fx-bump-dur', ms(fx.bounce.bumpDur));
      s.setProperty('--fx-bump-peak', '' + fx.bounce.bumpPeak);
      s.setProperty('--fx-icon-size', px(fx.fly.iconSize));
    },

    /* ---------- 手势状态机 ---------- */
    _onDown(e) {
      if (e.button !== undefined && e.button !== 0) return; // 仅主键
      const cell = e.target && e.target.closest ? e.target.closest('#farmGrid .farm-cell') : null;
      if (!cell) return;
      const idx = Number(cell.dataset.idx);
      if (!Number.isInteger(idx) || idx < 0) return;
      const act = cell.dataset.act;
      if (act === 'harvest') {
        // 即时收获首格（比等 click 更快），并抑制后续 click 的二次触发
        this._suppressClick();
        this._session = { act: 'harvest', mode: 'press', startX: e.clientX, startY: e.clientY, lastIdx: idx, swept: 0 };
        if (typeof Farm !== 'undefined') Farm.harvest(idx);
      } else if (act === 'plant') {
        // 先按住不动：超过阈值才升级为拖拽播种（保留单击弹选种器）
        this._session = { act: 'plant', mode: 'press', startX: e.clientX, startY: e.clientY, lastIdx: idx, swept: 0 };
      }
    },

    _onMove(e) {
      const s = this._session;
      if (!s || s.mode === 'done') return;
      if (s.mode === 'press') {
        const moved = Math.hypot(e.clientX - s.startX, e.clientY - s.startY);
        if (moved < this.DRAG_THRESHOLD) return;
        this._suppressClick();
        if (typeof Farm !== 'undefined' && Farm._beginBatch) Farm._beginBatch();
        if (s.act === 'plant') {
          s.mode = 'sow';
          this._sow(s.lastIdx); // 起点格补种
        } else {
          s.mode = 'sweep'; // 首格已在 pointerdown 收获
        }
      }
      const cell = this._cellAt(e.clientX, e.clientY);
      if (!cell) return;
      const idx = Number(cell.dataset.idx);
      if (!Number.isInteger(idx) || idx === s.lastIdx) return;
      s.lastIdx = idx;
      if (s.mode === 'sow' && cell.dataset.act === 'plant') {
        if (!this._sow(idx)) s.mode = 'done'; // 种子耗尽：停止跟随
      } else if (s.mode === 'sweep' && cell.dataset.act === 'harvest') {
        this._sweep(idx);
      }
    },

    _onUp() {
      const s = this._session;
      this._session = null;
      if (!s || s.mode === 'press') return; // 纯单击：交还原有 onclick 流程
      if (typeof Farm !== 'undefined' && Farm._endBatch) Farm._endBatch();
    },

    _sweep(idx) {
      if (typeof Farm === 'undefined') return false;
      const ok = Farm.harvest(idx, { quiet: true, deferSave: true });
      if (ok) this._session.swept++;
      return ok;
    },

    _sow(idx) {
      if (typeof Farm === 'undefined') return false;
      return !!Farm.plant(idx, { quiet: true, deferSave: true });
    },

    _cellAt(x, y) {
      const el = document.elementFromPoint(x, y);
      return el && el.closest ? el.closest('#farmGrid .farm-cell') : null;
    },

    _suppressClick() {
      this._clickSuppress = true;
      clearTimeout(this._csT);
      this._csT = setTimeout(() => { this._clickSuppress = false; }, FX().gesture.clickSuppressMs);
    },

    // ---------- 资源飞行 + 数字弹跳 ----------
    // gains: [{icon, artId?, kind:'gold'|'seed'|'material', n}]
    // 收获音效由 Farm.harvest() 播放（修为作物无 gains 也要有反馈），此处只管飞行
    flyGains(fromRect, gains) {
      if (!fromRect || !gains || !gains.length) return;
      const fly = FX().fly;
      let delay = 0;
      gains.forEach(g => {
        const flyN = Math.min(g.n || 1, fly.maxIconsPerGain); // 每种资源限量，避免糊屏
        for (let i = 0; i < flyN; i++) {
          this._flyOne(g, fromRect, delay);
          delay += fly.stagger;
        }
      });
    },

    _flyOne(g, fromRect, delay) {
      const fly = FX().fly;
      const half = fly.iconSize / 2;
      const target = this._targetEl(g.kind);
      if (!target) return;
      const el = document.createElement('div');
      el.className = 'farm-fly-icon';
      el.innerHTML = this._iconHtml(g);
      const sx = fromRect.left + fromRect.width / 2 - half;
      const sy = fromRect.top + fromRect.height / 2 - half;
      el.style.left = sx + 'px';
      el.style.top = sy + 'px';
      document.body.appendChild(el);
      const tr = target.getBoundingClientRect();
      const tx = tr.left + tr.width / 2 - half;
      const ty = tr.top + tr.height / 2 - half;
      // 上抛弧线 → 飞向资源栏（时长/缓动/弧度均由 CONFIG.fx.fly 驱动）
      const midX = sx + (tx - sx) * fly.arcBias;
      const midY = Math.min(sy, ty) - fly.arcLift;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        el.remove();
        this._bump(target);
        if (typeof AudioManager !== 'undefined' && AudioManager.playCoinSfx) AudioManager.playCoinSfx();
      };
      const anim = el.animate([
        { transform: 'translate(0px,0px) scale(1)' },
        { transform: `translate(${midX - sx}px,${midY - sy}px) scale(${fly.scalePeak})`, offset: 0.42 },
        { transform: `translate(${tx - sx}px,${ty - sy}px) scale(${fly.scaleEnd})` }
      ], { duration: fly.duration, delay, easing: fly.easing, fill: 'forwards' });
      anim.onfinish = finish;
      setTimeout(finish, fly.duration + delay + fly.cleanupPad); // 兜底清理
    },

    _bump(target) {
      target.classList.remove('bump');
      void target.offsetWidth; // 重启动画
      target.classList.add('bump');
      setTimeout(() => target.classList.remove('bump'), FX().bounce.bumpDur + 50);
    },

    _targetEl(kind) {
      const id = kind === 'gold' ? 'goldDisplay' : kind === 'seed' ? 'seedDisplay' : 'materialDisplay';
      const el = document.getElementById(id);
      return el ? (el.closest('.resource-item') || el) : null;
    },

    _iconHtml(g) {
      const size = FX().fly.iconSize;
      if (window.CropArt && g.artId && CropArt.ready(g.artId)) return CropArt.dom(g.artId, g.icon || '📦', size);
      return '<span style="font-size:' + size + 'px;line-height:1;">' + (g.icon || '📦') + '</span>';
    }
  };

  window.FarmFX = FarmFX;
  FarmFX.init();
})();
