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
    return GameState.lastReliefClaim !== this.dateKey() && (GameState.gold < 60 || GameState.seeds <= 0);
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
    GameState.seeds += reward.seeds;
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
    const seedsAdded = Math.max(0, 3 - GameState.seeds);
    GameState.gold += goldAdded;
    GameState.seeds += seedsAdded;
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
      this.master.connect(this.ctx.destination);
      this.restartScheduler();
      return true;
    } catch (error) {
      console.warn('背景音乐初始化失败。', error);
      this.enabled = false;
      this.updateControl();
      return false;
    }
  },

  start(scene = 'menu') {
    this.scene = scene;
    if (this.init() && this.ctx.state === 'suspended') this.ctx.resume();
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

  playMonsterHit(kind = 'normal') {
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
    osc.start(now); noise.start(now);
    osc.stop(now + preset.duration + .02); noise.stop(now + preset.duration + .02);
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
