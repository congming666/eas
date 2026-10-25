/* ============================================================
   夺卡队列 + 充能进度条（2026-10-23 玩家反馈）
   原问题：精英/宝箱/Boss 击杀瞬间弹出三选一夺卡，战斗中强行挡屏。
   现方案：夺卡先进入队列 → 屏幕下方显示「夺卡准备」进度条（3 秒）
           进度条满 → 才弹出三选一弹窗；期间战斗照常进行。
           多张卡排队，选完后下一张重新充能，不再连续硬弹。
   ============================================================ */
(function () {
  'use strict';
  if (typeof Expedition === 'undefined' || !Expedition.prototype) return;
  const P = Expedition.prototype;
  const CHARGE_SEC = 3.0;
  const BAR_ID = 'captureChargeHud';

  window.CaptureQueue = { enabled: true, SEC: CHARGE_SEC };

  const _origOffer = P.offerCapture;
  const _origChoose = P._chooseCapture;

  P.offerCapture = function (reason) {
    if (!window.CaptureQueue.enabled) return _origOffer.call(this, reason);
    if (this.gameOver || this.result) return;
    // 与原 offerCapture 保持一致：开局 40 秒内的来源不进入队列（否则充能完成也会被原函数拒绝）
    if (this.elapsed < 40) return;
    this._captureQueue = this._captureQueue || [];
    // 同原因的重复来源（例如连续精英击杀）也各自排队，但不无限堆叠
    if (this._captureQueue.length >= 4) return;
    this._captureQueue.push(reason);
    if (!this._captureCharging && !this.choiceOpen) this._startCaptureCharge();
  };

  P._startCaptureCharge = function () {
    if (!this._captureQueue || !this._captureQueue.length) return;
    this._captureCharging = true;
    this._captureChargeT = 0;
    this._captureChargeDur = CHARGE_SEC;
    this._renderCaptureCharge();
  };

  P._cancelCaptureCharge = function () {
    this._captureCharging = false;
    this._captureChargeT = 0;
    this._hideCaptureCharge();
  };

  P.updateCaptureCharge = function (dt) {
    if (!this._captureCharging) return;
    if (this.gameOver || this.result || this.dying) { this._cancelCaptureCharge(); return; }
    if (this.choiceOpen) return;                    // 弹窗已打开，等待选择
    if (!this._captureQueue || !this._captureQueue.length) { this._cancelCaptureCharge(); return; }
    this._captureChargeT += dt;
    this._renderCaptureCharge();
    if (this._captureChargeT >= this._captureChargeDur) {
      this._captureCharging = false;
      this._hideCaptureCharge();
      this._openQueuedCapture();
    }
  };

  P._openQueuedCapture = function () {
    const q = this._captureQueue || [];
    if (!q.length) return;
    const reason = q.shift();
    this._captureRetry = this._captureRetry || 0;
    try { _origOffer.call(this, reason); } catch (e) { console.warn('[CaptureQueue] 弹窗失败', e); }
    if (this.choiceOpen) {
      this._captureRetry = 0;
      return;
    }
    // 原函数拒绝打开（例如状态条件不满足）：把卡片放回队首重试，绝不静默丢失
    if (!this.gameOver && !this.result && this._captureRetry < 3) {
      this._captureRetry++;
      console.warn('[CaptureQueue] 夺卡弹窗未打开，重试 ' + this._captureRetry + '/3（reason=' + reason + ', elapsed=' + this.elapsed.toFixed(1) + '）');
      q.unshift(reason);
      this._captureCharging = true;
      this._captureChargeT = 0;
      this._captureChargeDur = CHARGE_SEC;
      this._renderCaptureCharge();
      return;
    }
    this._captureRetry = 0;
    this._hideCaptureCharge();
  };

  P._chooseCapture = function (idx) {
    const hadNext = !!(this._captureQueue && this._captureQueue.length);
    _origChoose.call(this, idx);
    // 选择完成且弹窗已关闭、还有排队卡 → 下一张重新充能
    if (hadNext && !this.choiceOpen) this._startCaptureCharge();
  };

  /* ---------------- 进度条 UI ---------------- */
  P._ensureCaptureBar = function () {
    let el = document.getElementById(BAR_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = BAR_ID;
    el.style.cssText = [
      'position:absolute', 'left:50%', 'bottom:192px', 'transform:translateX(-50%)',
      'width:min(280px,46vw)', 'padding:7px 11px 8px', 'z-index:70', 'pointer-events:none',
      'background:rgba(14,18,10,.88)', 'border:1px solid #c9a25a', 'border-radius:3px',
      'box-shadow:2px 2px 0 rgba(0,0,0,.55)',
      'font-family:"KaiTi","Microsoft YaHei",serif', 'color:#e8dfc8', 'display:none'
    ].join(';');
    el.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:baseline;font-size:12px;letter-spacing:1px;">'
      + '<span>🎴 夺卡准备</span><span id="captureChargeLeft" style="color:#c9a25a;font-size:11px;"></span></div>'
      + '<div style="height:7px;margin-top:5px;background:#241c12;border:1px solid #3a2f1c;">'
      + '<div id="captureChargeFill" style="height:100%;width:0%;background:#d9b45c;transition:width .08s linear;"></div></div>';
    const host = document.getElementById('expeditionHUD') || document.body;
    host.appendChild(el);
    return el;
  };

  P._renderCaptureCharge = function () {
    const el = this._ensureCaptureBar();
    if (!el) return;
    el.style.display = 'block';
    const pct = Math.max(0, Math.min(1, (this._captureChargeT || 0) / (this._captureChargeDur || CHARGE_SEC)));
    const fill = el.querySelector('#captureChargeFill');
    if (fill) fill.style.width = (pct * 100).toFixed(1) + '%';
    const left = el.querySelector('#captureChargeLeft');
    if (left) left.textContent = Math.max(0, (this._captureChargeDur - this._captureChargeT)).toFixed(1) + 's';
  };

  P._hideCaptureCharge = function () {
    const el = document.getElementById(BAR_ID);
    if (el) el.style.display = 'none';
  };

  console.log('[CaptureQueue] 夺卡充能队列已启用（' + CHARGE_SEC + 's 进度条）');
})();
