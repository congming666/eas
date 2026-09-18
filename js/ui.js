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
    const interval = this.scene === 'expedition' ? 430 : (this.scene === 'result' ? 760 : 620);
    this.timer = setInterval(() => this.tick(), interval);
    this.tick();
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
    const pitch = 1 + (Math.random() - .5) * .12;
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
    // 武器专属命中音色：镰刃金属 / 豌豆闷响 / 藤杖电击
    const flavors = {
      harvest_sickle: { type: 'square', start: 380, end: 170, dur: .05, gain: .045 },
      pea_repeater: { type: 'triangle', start: 320, end: 130, dur: .05, gain: .05 },
      vine_staff: { type: 'sawtooth', start: 1500, end: 520, dur: .055, gain: .04 },
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
    } else if (kind === 'pea') {
      this.playTone(560 * pitch, .055, 'square', .045);
      this.playTone(240 * pitch, .04, 'sine', .03);
      this.playNoise(.03, .02, 2400, 'highpass');
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
      result: [196, 246.94, 293.66, 392, 329.63, 293.66, 246.94, 196],
    };
    const pattern = patterns[this.scene] || patterns.menu;
    const note = pattern[this.step % pattern.length];
    const duration = this.scene === 'expedition' ? 0.52 : 1.25;
    this.playTone(note, duration, this.scene === 'expedition' ? 'triangle' : 'sine', 0.045);
    if (this.step % 2 === 0) this.playTone(note / 2, duration * 1.7, 'sine', 0.025, -4);
    if (this.scene === 'farm' && this.step % 4 === 2) this.playTone(note * 2, 0.3, 'triangle', 0.018, 5);
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
    this.playTone(180, 0.2, 'sawtooth', 0.1);
    this.playTone(90, 0.25, 'sine', 0.12);
    this.playNoise(0.12, 0.08, 600);
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

function getSkillStats(skill, extraLevels = 0) {
  const baseLevel = clamp(GameState.skillLevels[skill.id] || 1, 1, 8);
  const level = clamp(baseLevel + extraLevels, 1, 12);
  const bonus = level - 1;
  return {
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
}
