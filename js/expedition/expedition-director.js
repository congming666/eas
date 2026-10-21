/* ==================== 战斗手感导演（CombatDirector） ====================
 * P0 打击感层的统一编排：全部参数读 CONFIG.fx.combat（热调统一入口）。
 * 职责（只做表现与临期压力，不碰数值平衡）：
 *  1. 兽潮临期预警（P0-1/G1）：T-20s 顶部横幅+低鸣（zombs.io 公告样式）/ T-5s 红色 vignette 脉冲+心跳音
 *  2. 飘字两段动画 + 相对伤害配色（P0-2/G2）：前 40% 上浮加速+放大，后 60% 减速淡出；伤害分档配色
 *  3. 死亡呼吸窗口（P0-4/G4）：红闪+压缩 800ms（Bounce.Out）→ 静默 400ms → 死因浮现 → 结算
 *  4. 撤离终局收割者（G6）：最后 60s 不可杀「荒野猎手」（全免疫+高速+负击退拉近），BGM 切猎杀段
 * 接入点（均带 typeof 守卫，删除本文件游戏仍可运行）：
 *  - expedition-render.js updateWorldSystems：nextIn 递减后调 tick()
 *  - expedition-render.js render：调 render()
 *  - expedition-render.js renderHero：调 deathSquash()
 *  - expedition-render.js renderMonster：hunter 类型委托 renderHunter()
 *  - expedition-combat.js playerDeath：beginDeathSeq()；spawnBeastWave：onWaveSpawn()
 *  - expedition-core.js update：dying 时 updateDeathSeq()
 */
const CombatDirector = {
  FX() {
    return (typeof CONFIG !== 'undefined' && CONFIG.fx && CONFIG.fx.combat) ? CONFIG.fx.combat : null;
  },

  // ---------- P0-1 兽潮临期预警 ----------
  tick(exp, dt) {
    const fx = this.FX(); if (!fx) return;
    const w = exp.beastWave;
    if (w && !w.active) {
      // T-20s：顶部横幅 + 低鸣（每波一次）
      if (!w._warnT20 && w.nextIn > 0 && w.nextIn <= fx.waveWarn.tBanner) {
        w._warnT20 = true;
        this.showBanner(`⚠ 兽潮将至 ${Math.ceil(w.nextIn)}s —— 进入防御塔射程`, fx.waveWarn.bannerDur);
        if (typeof AudioManager !== 'undefined' && AudioManager.playBeastRumble) AudioManager.playBeastRumble();
      }
      // T-5s：红色 vignette 脉冲 + 心跳音
      if (!w._warnT5 && w.nextIn > 0 && w.nextIn <= fx.waveWarn.tVignette) {
        w._warnT5 = true;
        this.showVignette();
        if (typeof AudioManager !== 'undefined' && AudioManager.playHeartbeat) AudioManager.playHeartbeat();
      }
    }
    // G6 终局收割者：最后 60s 且尚未入场
    if (!exp._hunter && !exp.gameOver && !exp.dying && exp.timeLeft > 0 && exp.timeLeft <= fx.hunter.spawnAt) {
      this.spawnHunter(exp);
    }
  },

  onWaveSpawn(exp) {
    const w = exp.beastWave; if (!w) return;
    w._warnT20 = false;
    w._warnT5 = false;
    this.hideVignette();
  },

  showBanner(text, dur = 4200) {
    const old = document.getElementById('beastWaveBanner');
    if (old) old.remove();
    const el = document.createElement('div');
    el.id = 'beastWaveBanner';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.remove(); }, dur);
  },

  showVignette() {
    let el = document.getElementById('beastWaveVignette');
    if (!el) {
      el = document.createElement('div');
      el.id = 'beastWaveVignette';
      document.body.appendChild(el);
    }
    el.classList.add('active');
  },

  hideVignette() {
    const el = document.getElementById('beastWaveVignette');
    if (el) el.remove();
  },

  clearDom() {
    this.hideVignette();
    const b = document.getElementById('beastWaveBanner');
    if (b) b.remove();
  },

  // ---------- G6 荒野猎手（终局收割者，参照 VS Reaper：全免疫/高速/负击退） ----------
  spawnHunter(exp) {
    const c = this.FX().hunter;
    const mapSize = CONFIG.expedition.mapSize;
    const a = rand(0, Math.PI * 2);
    const hx = clamp(exp.player.x + Math.cos(a) * 560, 60, mapSize - 60);
    const hy = clamp(exp.player.y + Math.sin(a) * 560, 60, mapSize - 60);
    exp._hunter = {
      x: hx, y: hy, type: 'hunter', name: '荒野猎手',
      hp: 65535, maxHp: 65535,               // 展示用：实际全免疫（damageEnemy 早退）
      speed: c.speed, damage: c.damage,
      radius: c.radius, collisionRadius: c.radius * 0.72,
      attackRange: c.attackRange, attackCooldown: c.attackCooldown,
      invulnerable: true,                     // 全免疫：不掉血、无命中反馈链
      knockInverse: true,                     // 负击退：受击反而被拉向玩家（打它=喂它）
      slowImmune: true, stunImmune: true,
      pullOnHit: true,                        // 命中玩家：把玩家拽近（负击退）
      elite: true,                            // 免疫打断（打断逻辑只作用非精英）
      beastWave: false,
      facing: a + Math.PI, animTime: 0, attackCd: 0, attackAnim: 0,
      stunned: 0, hitFlash: 0, slow: 0, state: 'idle', stateTimer: 0,
      windupT: 0, windupDur: 0, windupKind: null, knockX: 0, knockY: 0,
    };
    exp.monsters.push(exp._hunter);
    this.showBanner('🏹 终局猎杀 —— 「荒野猎手」已入场，立即撤离！', 5200);
    if (typeof AudioManager !== 'undefined') {
      if (AudioManager.playBeastRumble) AudioManager.playBeastRumble();
      AudioManager.setScene('hunt');   // BGM 切猎杀段
    }
    if (typeof showToast === 'function') showToast('最后 60 秒：荒野猎手开始追猎，立即撤离！', 'warning');
  },

  renderHunter(ctx, m, sx, sy) {
    const t = m.animTime || 0;
    const pulse = 0.5 + Math.sin(t * 6) * 0.5;
    ctx.save();
    // 血红呼吸光环（在场内永远可见的威胁标记）
    const aura = ctx.createRadialGradient(sx, sy - 10, 4, sx, sy - 10, 48);
    aura.addColorStop(0, `rgba(255,60,30,${0.26 + pulse * 0.18})`);
    aura.addColorStop(1, 'rgba(255,40,20,0)');
    ctx.fillStyle = aura;
    ctx.beginPath(); ctx.arc(sx, sy - 10, 48, 0, Math.PI * 2); ctx.fill();
    // 地面接触阴影
    ctx.save();
    ctx.scale(1, 0.42);
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.beginPath(); ctx.arc(sx, sy + 40, 20, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // 斗篷躯体（近黑紫，行走颠簸）
    const bob = Math.sin(t * 9) * 2;
    ctx.translate(sx, sy - bob);
    const body = ctx.createLinearGradient(0, -48, 0, 8);
    body.addColorStop(0, '#241528'); body.addColorStop(0.6, '#160c1c'); body.addColorStop(1, '#0a060e');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(0, -48);
    ctx.bezierCurveTo(17, -42, 21, -14, 14, 6);
    ctx.quadraticCurveTo(0, 12, -14, 6);
    ctx.bezierCurveTo(-21, -14, -17, -42, 0, -48);
    ctx.fill();
    // 兜帽
    ctx.fillStyle = '#0d0712';
    ctx.beginPath(); ctx.ellipse(0, -40, 11, 12, 0, 0, Math.PI * 2); ctx.fill();
    // 红眼（发光）
    ctx.shadowColor = '#ff2a18'; ctx.shadowBlur = 12;
    ctx.fillStyle = '#ff4426';
    ctx.beginPath();
    ctx.arc(-4, -40, 2.6, 0, Math.PI * 2);
    ctx.arc(4, -40, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    // 前摇爪光（攻击预警）
    if (m.windupT > 0) {
      ctx.globalAlpha = 0.5 + Math.sin(t * 24) * 0.3;
      ctx.strokeStyle = '#ff5a3c'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, -14, 26, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    // 名牌（不随身体颠簸）
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillStyle = '#ff8a6a';
    ctx.fillText('荒野猎手', sx, sy - 62);
    ctx.font = '9px sans-serif';
    ctx.fillStyle = 'rgba(255,160,140,.78)';
    ctx.fillText('不可击杀 · 立即撤离', sx, sy - 50);
    ctx.restore();
  },

  // ---------- P0-2 飘字两段动画 + 相对伤害配色 ----------
  // elapsed: 0→1（生命周期进度），返回该时刻的 {vy, scale, alpha}
  dmgNumProfile(elapsed) {
    const c = this.FX().dmgNum;
    const pop = clamp(c.popFrac, 0.05, 0.95);
    if (elapsed < pop) {
      const t = elapsed / pop;
      const et = t * t;                                    // easeIn：上浮加速
      return {
        vy: c.vyStart + (c.vyPeak - c.vyStart) * et,
        scale: c.scaleStart + (c.scalePeak - c.scaleStart) * t,
        alpha: 1,
      };
    }
    const t = (elapsed - pop) / (1 - pop);
    const et = 1 - (1 - t) * (1 - t);                      // easeOut：减速淡出
    return {
      vy: c.vyPeak + (c.vyEnd - c.vyPeak) * et,
      scale: c.scalePeak,
      alpha: 1 - et,
    };
  },

  // 相对伤害分档配色：≥25% maxHp 橙红 / ≥10% 亮黄 / 其余白（暴击金色由调用方覆盖）
  dmgColor(amount, maxHp) {
    const c = this.FX().dmgNum;
    if (maxHp > 0) {
      const r = amount / maxHp;
      if (r >= c.tierHigh) return c.colorHigh;
      if (r >= c.tierMid) return c.colorMid;
    }
    return c.colorLow;
  },

  // ---------- P0-4 死亡呼吸窗口 ----------
  beginDeathSeq(exp) {
    const c = this.FX().death;
    const dc = exp.deathCause || {};
    const line = dc.reason === 'timeout'
      ? '远征时间耗尽，你迷失在荒野深处'
      : (dc.name ? `你被「${dc.name}${dc.level ? ' Lv.' + dc.level : ''}」击杀` : '你在荒野中倒下了');
    exp.dying = true;                       // update() 早退（gameOver 保持 false 以维持渲染循环）
    exp._deathSeq = {
      t: 0,
      crushDur: c.crushDur / 1000,
      silenceDur: c.silenceDur / 1000,
      textDur: c.textDur / 1000,
      line, done: false,
    };
    exp.playerDamageFlash = 1;              // 红闪（renderScreenFlashes 渐晕 + 本模块全屏红）
    exp.screenShake = 1;
    if (typeof AudioManager !== 'undefined') AudioManager.playDeath();
  },

  // 由 update() 在 dying 状态下每帧驱动（expedition-core.js 接线）
  updateDeathSeq(exp, dt) {
    const s = exp._deathSeq;
    if (!s || s.done) return;
    s.t += dt;
    // 红闪/震屏随压缩段衰减（静默后归零）
    if (s.t < s.crushDur) {
      exp.playerDamageFlash = 1 - s.t / s.crushDur;
      exp.screenShake = Math.max(0, 1 - s.t / s.crushDur) * 0.8;
    } else {
      exp.playerDamageFlash = 0;
      exp.screenShake = 0;
    }
    const total = s.crushDur + s.silenceDur + s.textDur;
    if (s.t >= total) {
      s.done = true;
      exp._deathSeq = null;
      exp.dying = false;
      exp.gameOver = true;                  // 结束呼吸窗口：正式进入结算
      exp.endExpedition();
    }
  },

  // ---------- Boss 死亡电影序列（参照 Hades：慢镜头 + 聚焦 + 收尾爆发） ----------
  beginBossDeathSeq(exp, boss) {
    const c = this.FX()?.bossDeath;
    exp._bossDeathSeq = {
      t: 0, x: boss.x, y: boss.y,
      slowDur: c ? c.slowDur : 1.0,
      recoverDur: c ? c.recoverDur : .35,
      burst: false,
    };
  },

  // 用真实 dt 推进；返回本帧全局 timeScale（慢镜头 0.26，恢复 1）
  updateBossDeathSeq(exp, dt) {
    const s = exp._bossDeathSeq;
    if (!s) return 1;
    s.t += dt;
    if (s.t < s.slowDur) {
      exp._bossFocus = { x: s.x, y: s.y, k: .42 };
      return .26;
    }
    if (!s.burst) { s.burst = true; this._bossDeathBurst(exp, s); }
    if (s.t < s.slowDur + s.recoverDur) {
      exp._bossFocus = { x: s.x, y: s.y, k: .2 };
      return 1;
    }
    exp._bossDeathSeq = null;
    exp._bossFocus = null;
    return 1;
  },

  // 慢镜头收尾：尸体处大爆发（冲击波 + 径向碎片 + 光爆 + 血雾）
  _bossDeathBurst(exp, s) {
    exp.spawnShockRing(s.x, s.y, '#ffd9a0', 120);
    exp.spawnRadialBurst(s.x, s.y, '#ffb066', 18);
    exp.spawnImpact(s.x, s.y, '#fff3c0', 2.0);
    exp.spawnBloodMist(s.x, s.y, true);
    exp.screenShake = Math.max(exp.screenShake, .5);
    if (typeof AudioManager !== 'undefined') {
      if (AudioManager.playExplosion) AudioManager.playExplosion();
      else AudioManager.playMonsterHit('heavy', '');
    }
  },

  // Bounce.Out 缓动（Phaser 同款）
  bounceOut(t) {
    if (t < 1 / 2.75) return 7.5625 * t * t;
    if (t < 2 / 2.75) { t -= 1.5 / 2.75; return 7.5625 * t * t + 0.75; }
    if (t < 2.5 / 2.75) { t -= 2.25 / 2.75; return 7.5625 * t * t + 0.9375; }
    t -= 2.625 / 2.75;
    return 7.5625 * t * t + 0.984375;
  },

  // renderHero 压缩变形：死亡动画期间返回 {sx, sy}，平时返回 null
  deathSquash(exp) {
    const s = exp._deathSeq;
    if (!s) return null;
    const c = this.FX().death;
    let k = 1;
    if (s.t < s.crushDur) k = this.bounceOut(s.t / s.crushDur);   // 1→0.55 带弹跳（中途回弹=压缩脉动）
    const sy = 1 - (1 - c.crushScale) * k;
    const sx = 1 + (1 - sy) * 0.55;                               // X 向外扩补偿（压扁感）
    return { sx, sy };
  },

  // ---------- 渲染入口（render() 末段调用） ----------
  render(exp, ctx) {
    if (exp._deathSeq) this._renderDeathSeq(exp, ctx, exp._deathSeq);
  },

  _renderDeathSeq(exp, ctx, s) {
    const W = CONFIG.canvas.width, H = CONFIG.canvas.height;
    const crushEnd = s.crushDur;
    const silenceEnd = crushEnd + s.silenceDur;
    ctx.save();
    if (s.t < crushEnd) {
      // 压缩段：全屏红闪（随时间衰减）
      const a = (1 - s.t / crushEnd) * 0.38;
      ctx.fillStyle = `rgba(255,30,25,${a})`;
      ctx.fillRect(0, 0, W, H);
    } else {
      // 静默段：黑幕渐入 → 文案段：死因一行浮现（先淡入上浮，尾段淡出）
      const k = s.t < silenceEnd ? (s.t - crushEnd) / s.silenceDur : 1;
      ctx.fillStyle = `rgba(6,8,10,${0.92 * Math.min(1, k)})`;
      ctx.fillRect(0, 0, W, H);
      if (s.t >= silenceEnd) {
        const tt = (s.t - silenceEnd) / s.textDur;
        const fadeIn = Math.min(1, tt * 2.5);
        const fadeOut = tt > 0.82 ? 1 - (tt - 0.82) / 0.18 : 1;
        const alpha = Math.max(0, Math.min(fadeIn, fadeOut));
        const lift = (1 - Math.pow(1 - Math.min(1, tt), 2)) * 14;  // 上浮 14px
        ctx.globalAlpha = alpha;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#f4d58a';
        ctx.font = '600 26px sans-serif';
        ctx.fillText(s.line, W / 2, H / 2 - 40 - lift);
        ctx.globalAlpha = alpha * 0.6;
        ctx.fillStyle = '#8a8f98';
        ctx.font = '14px sans-serif';
        ctx.fillText('正在整理行囊……', W / 2, H / 2 - 6);
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  },
};
