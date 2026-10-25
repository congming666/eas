const RewardSystem = {
  dailyRewards: [
    { gold: 80, seeds: 2 },
    { gold: 100, seeds: 2 },
    { gold: 120, seeds: 3 },
    { gold: 150, seeds: 3 },
    { gold: 180, seeds: 4 },
    { gold: 220, seeds: 4, materials: 1 },
    { gold: 300, seeds: 5, materials: 2 },
  ],

  dateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  dayGap(fromKey, toKey = this.dateKey()) {
    if (!fromKey) return Infinity;
    const from = new Date(`${fromKey}T12:00:00`);
    const to = new Date(`${toKey}T12:00:00`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return Infinity;
    return Math.round((to - from) / 86400000);
  },

  getNextDailyDay() {
    if (GameState.lastDailyClaim === this.dateKey()) return ((GameState.dailyStreak - 1) % 7) + 1;
    return this.dayGap(GameState.lastDailyClaim) === 1 ? (GameState.dailyStreak % 7) + 1 : 1;
  },

  isReliefEligible() {
    return GameState.lastReliefClaim !== this.dateKey() && (GameState.gold < 60 || Warehouse.getCount('seeds') <= 0);
  },

  claimDaily() {
    const today = this.dateKey();
    if (GameState.lastDailyClaim === today) {
      showToast('今天的家园补给已经领取', 'warning');
      return;
    }
    const consecutive = this.dayGap(GameState.lastDailyClaim) === 1;
    GameState.dailyStreak = consecutive ? GameState.dailyStreak + 1 : 1;
    const day = ((GameState.dailyStreak - 1) % 7) + 1;
    const reward = this.dailyRewards[day - 1];
    GameState.gold += reward.gold;
    Warehouse.addItem('seeds', reward.seeds);
    GameState.materials += reward.materials || 0;
    GameState.lastDailyClaim = today;
    SaveSystem.save();
    Farm.render();
    const materialText = reward.materials ? `、${reward.materials}材料` : '';
    showToast(`第${day}天补给：${reward.gold}金币、${reward.seeds}种子${materialText}`, 'gold');
  },

  claimRelief() {
    if (GameState.lastReliefClaim === this.dateKey()) {
      showToast('今天已经领取过开荒保障', 'warning');
      return;
    }
    if (!this.isReliefEligible()) {
      showToast('金币低于60或种子耗尽时才能申请保障', 'warning');
      return;
    }
    const goldAdded = Math.max(0, 120 - GameState.gold);
    const seedsAdded = Math.max(0, 3 - Warehouse.getCount('seeds'));
    GameState.gold += goldAdded;
    Warehouse.addItem('seeds', seedsAdded);
    GameState.lastReliefClaim = this.dateKey();
    SaveSystem.save();
    Farm.render();
    showToast(`保障已送达：补充${goldAdded}金币、${seedsAdded}种子`, 'success');
  },

  render() {
    const strip = document.getElementById('dailyRewardStrip');
    const dailyTitle = document.getElementById('dailyRewardTitle');
    const dailyDesc = document.getElementById('dailyRewardDesc');
    const dailyButton = document.getElementById('dailyRewardButton');
    const reliefDesc = document.getElementById('reliefRewardDesc');
    const reliefButton = document.getElementById('reliefRewardButton');
    if (!strip || !dailyTitle || !dailyDesc || !dailyButton || !reliefDesc || !reliefButton) return;

    const today = this.dateKey();
    const claimedToday = GameState.lastDailyClaim === today;
    const nextDay = this.getNextDailyDay();
    const completedInCycle = GameState.dailyStreak ? ((GameState.dailyStreak - 1) % 7) + 1 : 0;
    strip.innerHTML = this.dailyRewards.map((reward, index) => {
      const day = index + 1;
      const claimed = claimedToday && day <= completedInCycle;
      const next = day === nextDay;
      return `<div class="daily-day${claimed ? ' claimed' : ''}${!claimedToday && next ? ' next' : ''}"><strong>${claimed ? '✓' : `D${day}`}</strong>${reward.gold}</div>`;
    }).join('');

    const reward = this.dailyRewards[nextDay - 1];
    dailyTitle.textContent = claimedToday ? `连续签到 ${GameState.dailyStreak} 天` : `第${nextDay}天补给`;
    dailyDesc.textContent = claimedToday
      ? '今日已领取，明天继续签到'
      : `💰${reward.gold} · 🌱${reward.seeds}${reward.materials ? ` · 📦${reward.materials}` : ''}`;
    dailyButton.disabled = claimedToday;
    dailyButton.textContent = claimedToday ? '今日已领取' : '领取今日补给';

    const reliefClaimed = GameState.lastReliefClaim === today;
    const eligible = this.isReliefEligible();
    reliefDesc.textContent = reliefClaimed
      ? '今日已使用，明日恢复申请'
      : (eligible ? '资源不足，可补至💰120 / 🌱3' : '金币＜60或种子为0时开放');
    reliefButton.disabled = reliefClaimed || !eligible;
    reliefButton.textContent = reliefClaimed ? '今日已领取' : (eligible ? '领取开荒保障' : '暂不符合条件');
  }
};

// ==================== 工具函数 ====================
function rand(min, max) { return Math.random() * (max - min) + min; }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
function dist(a, b) { return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

function showToast(msg, type = '') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = msg;
  if (!container) return;
  while (container.children.length >= 2) container.firstElementChild.remove();
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

// ==================== 程序化背景音乐 ====================
const AudioManager = {
  ctx: null,
  master: null,
  timer: null,
  enabled: true,
  volume: 0.24,
  scene: 'menu',
  step: 0,
  lastHitSfxAt: 0,

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      this.enabled = false;
      this.updateControl();
      return false;
    }
    try {
      this.ctx = new AudioContextClass();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? this.volume : 0;
      // v3.8 压缩器防爆音
      this.comp = this.ctx.createDynamicsCompressor();
      this.comp.threshold.value = -18;
      this.comp.knee.value = 24;
      this.comp.ratio.value = 4;
      this.comp.attack.value = 0.003;
      this.comp.release.value = 0.25;
      // v3.8 简单混响（延迟反馈）
      this.reverb = this.ctx.createGain();
      this.reverbGain = this.ctx.createGain();
      this.reverbGain.gain.value = 0.18;
      this.delay = this.ctx.createDelay(0.5);
      this.delay.delayTime.value = 0.18;
      this.feedback = this.ctx.createGain();
      this.feedback.gain.value = 0.35;
      this.reverb.connect(this.delay);
      this.delay.connect(this.feedback);
      this.feedback.connect(this.delay);
      this.delay.connect(this.reverbGain);
      this.reverbGain.connect(this.comp);
      this.master.connect(this.comp);
      this.comp.connect(this.ctx.destination);
      this.restartScheduler();
      return true;
    } catch (error) {
      console.warn('背景音乐初始化失败。', error);
      this.enabled = false;
      this.updateControl();
      return false;
    }
  },

  startAmbient(scene) {
    if (!this.ctx) return;
    if (this._ambientNodes) {
      try { this._ambientNodes.forEach(n => { try{n.stop()}catch(e){} try{n.disconnect()}catch(e){} }); } catch(e){}
      this._ambientNodes = null;
    }
    if (this._ambientTimer) { clearInterval(this._ambientTimer); this._ambientTimer = null; }
    const nodes = [];
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = scene === 't3' ? 280 : (scene === 'night' ? 400 : 600);
    const g = this.ctx.createGain();
    g.gain.value = scene === 't3' ? 0.06 : 0.035;
    src.connect(lp); lp.connect(g); g.connect(this.master);
    src.start();
    nodes.push(src);
    const chirp = () => {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const og = this.ctx.createGain();
      o.type = 'sine';
      if (scene === 'night') {
        o.frequency.value = 4200 + Math.random()*400;
        og.gain.setValueAtTime(0, now);
        og.gain.linearRampToValueAtTime(0.04, now+0.02);
        og.gain.linearRampToValueAtTime(0, now+0.15);
      } else if (scene === 't1') {
        o.frequency.value = 1800 + Math.random()*600;
        og.gain.setValueAtTime(0, now);
        og.gain.linearRampToValueAtTime(0.05, now+0.03);
        og.gain.exponentialRampToValueAtTime(0.001, now+0.25);
      } else {
        o.frequency.value = 2500 + Math.random()*300;
        og.gain.setValueAtTime(0, now);
        og.gain.linearRampToValueAtTime(0.03, now+0.02);
        og.gain.linearRampToValueAtTime(0, now+0.2);
      }
      o.connect(og); og.connect(this.master);
      o.start(now); o.stop(now+0.3);
    };
    this._ambientTimer = setInterval(chirp, scene === 'night' ? 900 : 2200);
    this._ambientNodes = nodes;
  },

  start(scene = 'menu') {
    this.scene = scene;
    if (this.init() && this.ctx.state === 'suspended') this.ctx.resume();
    this.startAmbient(scene);
  },

  setScene(scene) {
    this.scene = scene;
    this.step = 0;
    if (this.ctx) this.restartScheduler();
  },

  restartScheduler() {
    clearInterval(this.timer);
    const interval = this.scene === 'expedition' ? 430 : (this.scene === 'hunt' ? 300 : (this.scene === 'result' ? 760 : 620));
    this.timer = setInterval(() => this.tick(), interval);
    this.tick();
  },

  // P0-3 每 key 并发计数守卫：同 key 同时发声 ≤max，超出直接丢弃（VS 同款 max 3 防糊）
  _voiceGuard(key, max, dur) {
    if (!this.ctx) return false;
    const now = this.ctx.currentTime;
    const v = this._voices || (this._voices = {});
    const a = v[key] || (v[key] = []);
    for (let i = a.length - 1; i >= 0; i--) if (a[i] <= now) a.splice(i, 1);
    if (a.length >= max) return false;
    a.push(now + Math.max(0.05, dur));
    return true;
  },

  playTone(freq, duration, type = 'sine', gain = 0.06, detune = 0) {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    filter.type = 'lowpass';
    filter.frequency.value = this.scene === 'expedition' ? 1250 : 900;
    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.exponentialRampToValueAtTime(gain, now + 0.035);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(filter);
    filter.connect(amp);
    amp.connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.08);
  },

  playMonsterHit(kind = 'normal', weaponId = '') {
    if (!this.ctx || !this.enabled || !this.master) return;
    const now = this.ctx.currentTime;
    const minGap = kind === 'kill' ? 0 : 0.025;
    if (now - this.lastHitSfxAt < minGap) return;
    this.lastHitSfxAt = now;

    const presets = {
      normal: { start: 185, end: 105, duration: .075, gain: .085, noise: .045 },
      heavy: { start: 132, end: 62, duration: .12, gain: .12, noise: .072 },
      kill: { start: 96, end: 38, duration: .19, gain: .15, noise: .095 },
    };
    const preset = presets[kind] || presets.normal;
    // P0-3 每 key 并发上限（命中/重击/击杀各 ≤3 同时）
    if (!this._voiceGuard(kind === 'crit' ? 'crit' : kind, 3, preset.duration + 0.12)) return;
    // P0-3 pitch 抖动 ±6% → ±15%（对齐 VS detune±250 的感知强度）
    const pitch = 1 + (Math.random() - .5) * .30;
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    osc.type = kind === 'normal' ? 'square' : 'sawtooth';
    osc.frequency.setValueAtTime(preset.start * pitch, now);
    osc.frequency.exponentialRampToValueAtTime(preset.end * pitch, now + preset.duration);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(kind === 'kill' ? 720 : 1050, now);
    oscGain.gain.setValueAtTime(preset.gain, now);
    oscGain.gain.exponentialRampToValueAtTime(.0001, now + preset.duration);
    osc.connect(filter); filter.connect(oscGain); oscGain.connect(this.master);

    const frameCount = Math.max(1, Math.floor(this.ctx.sampleRate * preset.duration));
    const noiseBuffer = this.ctx.createBuffer(1, frameCount, this.ctx.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < frameCount; i++) {
      const envelope = 1 - i / frameCount;
      noiseData[i] = (Math.random() * 2 - 1) * envelope;
    }
    const noise = this.ctx.createBufferSource();
    const noiseFilter = this.ctx.createBiquadFilter();
    const noiseGain = this.ctx.createGain();
    noise.buffer = noiseBuffer;
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = kind === 'kill' ? 420 : 760;
    noiseFilter.Q.value = .75;
    noiseGain.gain.setValueAtTime(preset.noise, now);
    noiseGain.gain.exponentialRampToValueAtTime(.0001, now + preset.duration);
    noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(this.master);
    // 武器专属命中音色：镰刃金属 / 豌豆闷响 / 藤杖电击 / 飞刃切金 / 焰弓爆燃（v1.8 补齐后两把）
    const flavors = {
      harvest_sickle: { type: 'square', start: 380, end: 170, dur: .05, gain: .045 },
      pea_repeater: { type: 'triangle', start: 320, end: 130, dur: .05, gain: .05 },
      vine_staff: { type: 'sawtooth', start: 1500, end: 520, dur: .055, gain: .04 },
      throwing_knife: { type: 'square', start: 920, end: 310, dur: .05, gain: .04 },
      flame_bow: { type: 'sawtooth', start: 240, end: 78, dur: .08, gain: .05 },
    };
    const fl = flavors[weaponId];
    if (fl) {
      const fo = this.ctx.createOscillator();
      const fg = this.ctx.createGain();
      fo.type = fl.type;
      fo.frequency.setValueAtTime(fl.start * pitch, now);
      fo.frequency.exponentialRampToValueAtTime(fl.end * pitch, now + fl.dur);
      fg.gain.setValueAtTime(fl.gain, now);
      fg.gain.exponentialRampToValueAtTime(.0001, now + fl.dur);
      fo.connect(fg); fg.connect(this.master);
      fo.start(now); fo.stop(now + fl.dur + .02);
    }
    // 暴击高音铃
    if (kind === 'crit') {
      const bell = this.ctx.createOscillator();
      const bg = this.ctx.createGain();
      bell.type = 'triangle';
      bell.frequency.setValueAtTime(1240, now);
      bell.frequency.exponentialRampToValueAtTime(880, now + .11);
      bg.gain.setValueAtTime(.04, now);
      bg.gain.exponentialRampToValueAtTime(.0001, now + .11);
      bell.connect(bg); bg.connect(this.master);
      bell.start(now); bell.stop(now + .13);
    }
    osc.start(now); noise.start(now);
    osc.stop(now + preset.duration + .02); noise.stop(now + preset.duration + .02);
  },

  // 攻击起始音：近战挥砍风声 / 豌豆发射 / 藤杖施放
  playAttack(kind = 'melee', combo = 0) {
    if (!this.ctx || !this.enabled || !this.master) return;
    const now = this.ctx.currentTime;
    const pitch = combo === 0 ? 1 : combo === 1 ? 1.18 : 0.82;
    if (kind === 'melee') {
      const duration = .09;
      const frames = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
      const buf = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < frames; i++) { const t = i / frames; data[i] = (Math.random() * 2 - 1) * Math.sin(t * Math.PI) * (0.5 + t * .5); }
      const src = this.ctx.createBufferSource(); src.buffer = buf;
      const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.1;
      bp.frequency.setValueAtTime(420 * pitch, now);
      bp.frequency.exponentialRampToValueAtTime(2100 * pitch, now + duration);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(.052, now);
      g.gain.exponentialRampToValueAtTime(.0001, now + duration);
      src.connect(bp); bp.connect(g); g.connect(this.master);
      src.start(now); src.stop(now + duration + .02);
      // v1.8 镰刃金属余韵：挥击噪声扫频上叠一记高频短铃（"唰-叮"的镰刀辨识度）
      this.playTone(1880 * pitch, .07, 'triangle', .018, 7);
      this.playTone(2840 * pitch, .045, 'sine', .012, -6);
    } else if (kind === 'pea') {
      this.playTone(560 * pitch, .055, 'square', .045);
      this.playTone(240 * pitch, .04, 'sine', .03);
      this.playNoise(.03, .02, 2400, 'highpass');
    } else if (kind === 'knife') {
      // v1.8 飞刃：双高频快削 + 气流嗖声（"嗖-嚓"的轻快金属感）
      const kv = 1 + (Math.random() - .5) * .12;
      this.playTone(1180 * pitch * kv, .04, 'square', .038);
      this.playTone(1760 * pitch * kv, .03, 'sine', .028, 9);
      this.playNoise(.05, .03, 4200, 'highpass');
    } else if (kind === 'bow') {
      // v1.8 焰弓：弓弦低鸣 + 箭羽呼啸 + 一撮火星噼啪
      const bv = 1 + (Math.random() - .5) * .10;
      this.playTone(150 * pitch * bv, .09, 'sine', .05);
      this.playTone(242 * pitch * bv, .06, 'triangle', .03);
      this.playNoise(.09, .032, 1500, 'highpass');
      this.playTone(860 * pitch * bv, .035, 'square', .016, 14);
    } else { // vine
      this.playTone(720 * pitch, .08, 'sine', .05, 6);
      this.playTone(1180 * pitch, .05, 'triangle', .035, -8);
      this.playNoise(.04, .018, 3600, 'highpass');
    }
  },

  playCritHit() {
    if (!this.ctx || !this.enabled || !this.master) return;
    const now = this.ctx.currentTime;
    this.playTone(1568, .09, 'triangle', .05);
    this.playTone(784, .12, 'sine', .04);
    this.playNoise(.05, .02, 5200, 'highpass');
  },

  playBossHit() {
    if (!this.ctx || !this.enabled || !this.master) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(88, now);
    osc.frequency.exponentialRampToValueAtTime(36, now + .26);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(.15, now);
    g.gain.exponentialRampToValueAtTime(.0001, now + .26);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
    osc.connect(lp); lp.connect(g); g.connect(this.master);
    osc.start(now); osc.stop(now + .3);
    this.playNoise(.16, .05, 260, 'lowpass');
  },

  // 电击链：高频锯齿放电 + 高切噪声
  playZap() {
    if (!this.ctx || !this.enabled || !this.master) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1900 + Math.random() * 300, now);
    osc.frequency.exponentialRampToValueAtTime(420, now + 0.09);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.05, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 0.8;
    osc.connect(bp); bp.connect(g); g.connect(this.master);
    osc.start(now); osc.stop(now + 0.12);
    this.playNoise(0.06, 0.025, 6000, 'highpass');
  },

  // 冻结碎裂：三音高频冰晶 + 高频噪声
  playFrostShatter() {
    if (!this.ctx || !this.enabled || !this.master) return;
    const now = this.ctx.currentTime;
    if (now - (this._lastFrostAt || 0) < 0.05) return;
    this._lastFrostAt = now;
    [1760, 2340, 3120].forEach((f, i) => {
      const o = this.ctx.createOscillator(); o.type = 'triangle';
      const startAt = now + i * 0.012;
      o.frequency.setValueAtTime(f, startAt);
      o.frequency.exponentialRampToValueAtTime(f * 0.6, startAt + 0.08);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.028, startAt);
      g.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.09);
      o.connect(g); g.connect(this.master);
      o.start(startAt); o.stop(startAt + 0.11);
    });
    this.playNoise(0.08, 0.03, 7200, 'highpass');
  },

  // 点燃：低切噪声呼响 + 低锯齿
  playIgnite() {
    if (!this.ctx || !this.enabled || !this.master) return;
    this.playNoise(0.18, 0.05, 900, 'lowpass');
    this.playTone(220, 0.14, 'sawtooth', 0.03);
  },

  // 灼烧跳伤：极轻噼啪声（节流）
  playBurnTick() {
    if (!this.ctx || !this.enabled || !this.master) return;
    const now = this.ctx.currentTime;
    if (now - (this._lastBurnAt || 0) < 0.12) return;
    this._lastBurnAt = now;
    this.playNoise(0.03, 0.014, 1800 + Math.random() * 1400, 'highpass');
  },

  tick() {
    if (!this.enabled || !this.ctx) return;
    const patterns = {
      menu: [196, 246.94, 293.66, 246.94, 220, 261.63, 329.63, 261.63],
      farm: [174.61, 220, 261.63, 329.63, 293.66, 246.94, 220, 196],
      prep: [164.81, 196, 246.94, 293.66, 220, 261.63, 329.63, 293.66],
      expedition: [146.83, 174.61, 196, 233.08, 164.81, 196, 220, 261.63],
      // G6 猎杀段：低音小二度摩擦的紧逼脉冲（300ms 一步）
      hunt: [110, 110, 130.81, 110, 116.54, 110, 146.83, 130.81],
      result: [196, 246.94, 293.66, 392, 329.63, 293.66, 246.94, 196],
    };
    const pattern = patterns[this.scene] || patterns.menu;
    const note = pattern[this.step % pattern.length];
    const duration = this.scene === 'expedition' ? 0.52 : (this.scene === 'hunt' ? 0.3 : 1.25);
    this.playTone(note, duration, this.scene === 'expedition' ? 'triangle' : 'sine', 0.045);
    if (this.step % 2 === 0) this.playTone(note / 2, duration * 1.7, 'sine', 0.025, -4);
    if (this.scene === 'farm' && this.step % 4 === 2) this.playTone(note * 2, 0.3, 'triangle', 0.018, 5);
    // G6 猎杀段：每 4 步叠一记失谐小二度（紧绷感）+ 低鼓点
    if (this.scene === 'hunt' && this.step % 4 === 2) {
      this.playTone(note * 1.06, 0.26, 'sawtooth', 0.022, 30);
      this.playTone(55, 0.22, 'sine', 0.05);
    }
    this.step++;
  },

  toggle() {
    if (!this.ctx) this.init();
    this.enabled = !this.enabled;
    if (this.master && this.ctx) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime + 0.12);
    }
    this.updateControl();
  },

  setVolume(value) {
    this.volume = clamp(Number(value) / 100, 0, 1);
    if (this.master && this.ctx && this.enabled) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.04);
    }
  },

  updateControl() {
    const button = document.getElementById('musicToggle');
    if (button) button.textContent = this.enabled ? '♫ 音乐：开' : '♫ 音乐：关';
  },

  // ==================== 游戏音效 ====================

  playNoise(duration = 0.1, gain = 0.05, filterFreq = 1000, filterType = 'lowpass') {
    if (!this.ctx || !this.enabled || !this.master) return;
    const now = this.ctx.currentTime;
    const frameCount = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buffer = this.ctx.createBuffer(1, frameCount, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frameCount; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frameCount);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter); filter.connect(g); g.connect(this.master);
    source.start(now);
  },

  playChestOpen() {
    if (!this.ctx || !this.enabled) return;
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((f, i) => setTimeout(() => {
      this.playTone(f, 0.2, 'triangle', 0.08);
      this.playTone(f * 2, 0.1, 'sine', 0.03);
    }, i * 60));
    this.playNoise(0.08, 0.04, 4000, 'highpass');
  },

  playSkill(skillId = '') {
    if (!this.ctx || !this.enabled) return;
    if (skillId === 'straw_smash') {
      this.playTone(200, 0.2, 'sawtooth', 0.1);
      this.playTone(80, 0.25, 'sine', 0.12);
      this.playNoise(0.15, 0.06, 800);
    } else if (skillId === 'vine_bind') {
      this.playTone(300, 0.25, 'sine', 0.08);
      setTimeout(() => this.playTone(600, 0.15, 'triangle', 0.06), 100);
    } else if (skillId === 'earth_dash') {
      this.playTone(600, 0.15, 'sawtooth', 0.08);
      this.playNoise(0.1, 0.05, 2000);
    } else if (skillId === 'smoke_screen') {
      this.playNoise(0.3, 0.06, 400);
      this.playTone(150, 0.3, 'sine', 0.06);
    } else {
      this.playTone(400, 0.15, 'square', 0.07);
      this.playNoise(0.1, 0.05, 3000);
    }
  },

  playPlayerHurt() {
    if (!this.ctx || !this.enabled) return;
    // P0-3 受伤音并发上限 ≤3 + pitch 抖动 ±15%
    if (!this._voiceGuard('hurt', 3, 0.3)) return;
    const p = 1 + (Math.random() - .5) * .30;
    this.playTone(180 * p, 0.2, 'sawtooth', 0.1);
    this.playTone(90 * p, 0.25, 'sine', 0.12);
    this.playNoise(0.12, 0.08, 600);
  },

  // ===== P0 农场手感层三音效（连收/连播场景均内置节流，避免糊成一团）=====
  // 播种"噗"：低频下滑 + 轻土噪
  playPlantSfx() {
    if (!this.ctx || !this.enabled || !this.master) return;
    const now = this.ctx.currentTime;
    if (now - (this._lastPlantSfxAt || 0) < 0.07) return;
    this._lastPlantSfxAt = now;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(300, now);
    o.frequency.exponentialRampToValueAtTime(140, now + 0.09);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.06, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    o.connect(g); g.connect(this.master);
    o.start(now); o.stop(now + 0.12);
    this.playNoise(0.05, 0.018, 900, 'lowpass');
  },

  // 收获"唰"：带通噪声扫叶 + 双音"叮咚"
  playHarvestSfx() {
    if (!this.ctx || !this.enabled || !this.master) return;
    const now = this.ctx.currentTime;
    if (now - (this._lastHarvestSfxAt || 0) < 0.06) return;
    this._lastHarvestSfxAt = now;
    this.playNoise(0.09, 0.05, 1600, 'bandpass');
    this.playTone(660, 0.06, 'triangle', 0.05);
    setTimeout(() => this.playTone(880, 0.07, 'triangle', 0.04), 55);
  },

  // 资源到账"叮"：双音上行（飞行图标抵达资源栏时）

  // ===== 农事环境音 / 额外交互音（v5.9.15）=====
  playWaterSfx() {
    if (!this.ctx || !this.enabled || !this.master) return;
    const now = this.ctx.currentTime;
    if (now - (this._lastWaterSfxAt || 0) < 0.08) return;
    this._lastWaterSfxAt = now;
    this.playNoise(0.18, 0.05, 1200, 'bandpass');
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(520, now);
    o.frequency.exponentialRampToValueAtTime(220, now + 0.16);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.05, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    o.connect(g); g.connect(this.master);
    o.start(now); o.stop(now + 0.2);
  },
  playFertilizeSfx() {
    if (!this.ctx || !this.enabled || !this.master) return;
    const now = this.ctx.currentTime;
    if (now - (this._lastFertSfxAt || 0) < 0.08) return;
    this._lastFertSfxAt = now;
    this.playNoise(0.12, 0.05, 500, 'lowpass');
    this.playTone(140, 0.12, 'sine', 0.05);
  },
  playOrderSfx() {
    if (!this.ctx || !this.enabled || !this.master) return;
    const now = this.ctx.currentTime;
    [660, 880, 1320].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, now + i * 0.07);
      g.gain.exponentialRampToValueAtTime(0.055, now + i * 0.07 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.07 + 0.16);
      o.connect(g); g.connect(this.master);
      o.start(now + i * 0.07); o.stop(now + i * 0.07 + 0.18);
    });
  },
  playUpgradeSfx() {
    if (!this.ctx || !this.enabled || !this.master) return;
    const now = this.ctx.currentTime;
    this.playNoise(0.06, 0.06, 900, 'lowpass');
    this.playTone(180, 0.1, 'square', 0.04);
    setTimeout(() => { this.playNoise(0.05, 0.05, 700, 'lowpass'); }, 120);
    setTimeout(() => {
      this.playTone(523, 0.12, 'triangle', 0.05);
      this.playTone(784, 0.18, 'triangle', 0.045);
    }, 260);
  },
  playReadySfx() {
    if (!this.ctx || !this.enabled || !this.master) return;
    this.playTone(880, 0.08, 'sine', 0.04);
    setTimeout(() => { this.playTone(1175, 0.12, 'sine', 0.035); }, 90);
  },
  startFarmAmbient() {
    if (!this.ctx || !this.enabled || !this.master) return;
    if (this._farmAmbient) return;
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 420; filt.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.value = 0.018;
    src.connect(filt); filt.connect(g); g.connect(this.master);
    src.start();
    const self = this;
    const crow = () => {
      if (!self._farmAmbient) return;
      try {
        const now = ctx.currentTime;
        const o = ctx.createOscillator(); const og = ctx.createGain();
        o.type = 'triangle';
        o.frequency.setValueAtTime(520, now);
        o.frequency.exponentialRampToValueAtTime(300, now + 0.12);
        og.gain.setValueAtTime(0.0001, now);
        og.gain.exponentialRampToValueAtTime(0.035, now + 0.02);
        og.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
        o.connect(og); og.connect(self.master);
        o.start(now); o.stop(now + 0.18);
      } catch (e) {}
      self._farmCrowTimer = setTimeout(crow, 9000 + Math.random() * 16000);
    };
    this._farmCrowTimer = setTimeout(crow, 6000 + Math.random() * 8000);
    this._farmAmbient = { src, filt, g };
  },
  stopFarmAmbient() {
    try {
      if (this._farmCrowTimer) clearTimeout(this._farmCrowTimer);
      this._farmCrowTimer = null;
      if (this._farmAmbient) {
        this._farmAmbient.src.stop();
        this._farmAmbient.src.disconnect();
        this._farmAmbient = null;
      }
    } catch (e) { this._farmAmbient = null; }
  },
  playCoinSfx() {
    if (!this.ctx || !this.enabled || !this.master) return;
    const now = this.ctx.currentTime;
    if (now - (this._lastCoinSfxAt || 0) < 0.07) return;
    this._lastCoinSfxAt = now;
    this.playTone(988, 0.05, 'triangle', 0.05);
    setTimeout(() => this.playTone(1319, 0.08, 'sine', 0.04), 45);
  },

  playEvacuateSuccess() {
    if (!this.ctx || !this.enabled) return;
    const notes = [523.25, 659.25, 783.99, 1046.50, 1318.51];
    notes.forEach((f, i) => setTimeout(() => {
      this.playTone(f, 0.3, 'triangle', 0.1);
      this.playTone(f * 1.5, 0.2, 'sine', 0.04);
    }, i * 100));
    setTimeout(() => {
      this.playTone(1046.50, 0.5, 'sine', 0.08);
      this.playTone(1318.51, 0.5, 'sine', 0.06);
      this.playTone(1567.98, 0.5, 'sine', 0.05);
    }, 500);
  },

  playDeath() {
    if (!this.ctx || !this.enabled) return;
    this.playTone(400, 0.5, 'sawtooth', 0.1);
    setTimeout(() => this.playTone(200, 0.5, 'sawtooth', 0.1), 200);
    setTimeout(() => this.playTone(100, 0.8, 'sine', 0.12), 400);
    this.playNoise(0.3, 0.08, 300);
  },

  playConsumable(id = '') {
    if (!this.ctx || !this.enabled) return;
    if (id === 'herb_kit') {
      this.playTone(400, 0.2, 'sine', 0.08);
      setTimeout(() => this.playTone(800, 0.15, 'sine', 0.06), 100);
    } else if (id === 'thorn_storm') {
      this.playNoise(0.2, 0.1, 5000, 'highpass');
      this.playTone(800, 0.2, 'sawtooth', 0.08);
    } else if (id === 'signal_flare') {
      this.playTone(600, 0.3, 'square', 0.08);
      setTimeout(() => this.playTone(1200, 0.3, 'square', 0.08), 300);
    }
  },

  // v3.8 新音效：拾取
  playPickup(kind) {
    kind = kind || 'gold';
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    if (now - (this._lastPickupAt || 0) < 0.05) return;
    this._lastPickupAt = now;
    if (kind === 'gold') {
      this.playTone(880, 0.08, 'triangle', 0.06);
      this.playTone(1320, 0.1, 'sine', 0.04);
    } else if (kind === 'item') {
      this.playTone(660, 0.08, 'triangle', 0.06);
      const self = this;
      setTimeout(() => self.playTone(990, 0.1, 'sine', 0.05), 50);
    } else if (kind === 'rare') {
      const self = this;
      [880, 1108, 1318, 1760].forEach((f, i) => setTimeout(() => self.playTone(f, 0.15, 'triangle', 0.06), i * 40));
    }
  },

  // v1.7 任务完成：上行三音（C5-E5-G5）+ 高八度收尾闪光——胜利感但不抢 Boss 现身低鸣的风头
  playMissionComplete() {
    if (!this.ctx || !this.enabled) return;
    const seq = [[523.25, 0], [659.25, 110], [783.99, 220]];
    seq.forEach(([f, t]) => setTimeout(() => this.playTone(f, 0.22, 'triangle', 0.08), t));
    setTimeout(() => { this.playTone(1046.5, 0.3, 'sine', 0.05); this.playTone(1567.98, 0.25, 'sine', 0.03); }, 380);
  },

  // v3.8 UI 点击
  playUIClick() {
    if (!this.ctx || !this.enabled) return;
    this.playTone(1200, 0.04, 'square', 0.03);
  },

  // v3.8 完美闪避
  playPerfectDodge() {
    if (!this.ctx || !this.enabled) return;
    this.playTone(1568, 0.12, 'triangle', 0.08);
    this.playTone(2093, 0.18, 'sine', 0.06);
    this.playNoise(0.06, 0.03, 6000, 'highpass');
  },

  // v3.8 兽潮警告
  playWaveWarning() {
    if (!this.ctx || !this.enabled) return;
    const self = this;
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        self.playTone(140, 0.25, 'sawtooth', 0.12);
        self.playTone(70, 0.3, 'sine', 0.10);
      }, i * 280);
    }
  },

  // P0-1 兽潮临期低鸣（T-20s 横幅伴随音）：锯齿下滑 52→30Hz + 低切噪声轰鸣
  playBeastRumble() {
    if (!this.ctx || !this.enabled || !this.master) return;
    const now = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(52, now);
    o.frequency.exponentialRampToValueAtTime(30, now + 1.1);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.16, now + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.15);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 200;
    o.connect(lp); lp.connect(g); g.connect(this.master);
    o.start(now); o.stop(now + 1.2);
    this.playNoise(1.0, 0.05, 160, 'lowpass');
  },

  // P0-1 兽潮临期心跳（T-5s vignette 伴随音）：lub-dub ×2（低频双击，模拟心搏）
  playHeartbeat() {
    if (!this.ctx || !this.enabled || !this.master) return;
    const thump = (at, gain) => {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(64, at);
      o.frequency.exponentialRampToValueAtTime(38, at + 0.14);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(gain, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      o.connect(g); g.connect(this.master);
      o.start(at); o.stop(at + 0.2);
    };
    const now = this.ctx.currentTime;
    thump(now, 0.2); thump(now + 0.22, 0.13);
    thump(now + 0.95, 0.2); thump(now + 1.17, 0.13);
  },

  // v3.8 撤离开始
  playExtractStart() {
    if (!this.ctx || !this.enabled) return;
    const self = this;
    this.playTone(520, 0.15, 'square', 0.08);
    setTimeout(() => self.playTone(520, 0.15, 'square', 0.08), 200);
    setTimeout(() => self.playTone(780, 0.25, 'square', 0.08), 400);
  },

  // v3.8 脚步
  playStep() {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    if (now - (this._lastStepAt || 0) < 0.22) return;
    this._lastStepAt = now;
    this.playNoise(0.05, 0.025, 300 + Math.random() * 100, 'lowpass');
  },

  // v3.8 怪物前摇低吼
  playWindup() {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    if (now - (this._lastWindupAt || 0) < 0.3) return;
    this._lastWindupAt = now;
    this.playTone(180 + Math.random() * 40, 0.18, 'sawtooth', 0.05);
  }
};

// v1.6 UI 点击音：全局捕获阶段事件委托——所有 <button> 点击统一出声。
// AudioContext 未解锁（首次交互前）或音频关闭时静默跳过；捕获阶段保证先于业务 onclick。
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('button') : null;
    if (btn && !btn.disabled && AudioManager.ctx && AudioManager.enabled) AudioManager.playUIClick();
  }, true);
}

function getSkillStats(skill, extraLevels = 0) {
  // v5.8：基础等级改由桥接（CardV58.skillEffectiveLevel）提供；运行时被 v5.js 覆写，
  // 此处仅作回退。无精通时 base=1，与旧公式结果一致。
  const baseLevel = (typeof window !== 'undefined' && window.__v58Bridge && window.__v58Bridge.baseLevel)
    ? window.__v58Bridge.baseLevel(skill.id)
    : clamp(GameState.skillLevels[skill.id] || 1, 1, 8);
  const level = clamp(baseLevel + extraLevels, 1, 12);
  const bonus = level - 1;
  const out = {
    ...skill,
    level,
    baseLevel,
    extraLevels,
    damage: skill.damage ? Math.round(skill.damage * (1 + bonus * 0.18)) : 0,
    range: skill.range ? Math.round(skill.range * (1 + bonus * 0.045)) : skill.range,
    dashDistance: skill.dashDistance ? Math.round(skill.dashDistance * (1 + bonus * 0.08)) : skill.dashDistance,
    stunDuration: skill.stunDuration ? +(skill.stunDuration + bonus * 0.18).toFixed(1) : skill.stunDuration,
    stealthDuration: skill.stealthDuration ? +(skill.stealthDuration + bonus * 0.25).toFixed(1) : skill.stealthDuration,
    cooldown: +Math.max(1, skill.cooldown * (1 - bonus * 0.055)).toFixed(1),
    energyCost: Math.max(8, skill.energyCost - bonus * 2),
  };
  // v5.8 附魔词条（无词条时 mods=null，不改变数值）
  try {
    if (typeof window !== 'undefined' && window.__v58Bridge) {
      const am = window.__v58Bridge.affixModsFor(skill.id);
      window.__v58Bridge.applyAffix(out, am);
      out.damage = out.damage || out.dmg || 0;
    }
  } catch (e) { /* noop */ }
  return out;
}
