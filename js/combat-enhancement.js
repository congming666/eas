// ================= v0.6.0 战斗系统大升级：连击/完美闪避/血条分段/AI多样化/精英词缀/环境互动/怒气超杀/Boss多阶段/Roguelike岔路/生存压力/处决重做 =================
(function () {
  'use strict';

  const CombatEnhancement = {
    // ===== 全局状态 =====
    combo: 0,
    comboTimer: 0,
    comboMax: 999,
    rage: 0,
    rageMax: 100,
    dodgeCd: 0,
    perfectDodgeWindow: 0, // >0 时处于完美闪避判定帧
    slowMotion: 0,
    nextAttackCrit: false,
    hitStop: 0,
    torchFuel: 100,
    torchMax: 100,
    bossPhase: 1,
    bossPhaseTriggered: {},
    executing: false,
    execTarget: null,
    execTimer: 0,
    branchActive: false,
    branchUsed: false,
    branchOptions: [],
    destructibles: [],
    elapsed: 0,

    // ===== 初始化（远征开始时调用） =====
    init(exp) {
      this.exp = exp;
      this.combo = 0; this.comboTimer = 0;
      this.rage = 0; this.dodgeCd = 0;
      this.perfectDodgeWindow = 0; this.slowMotion = 0;
      this.nextAttackCrit = false; this.hitStop = 0;
      this.torchMax = 60; {
        // v5.5 火把：进图自动点燃第一支（从携带数中扣除），无携带则开局视野极小
        const _tc = (exp.consumables && exp.consumables.torch) ? exp.consumables.torch : 0;
        if (_tc > 0) { exp.consumables.torch = _tc - 1; this.torchFuel = 60; } else { this.torchFuel = 0; }
      }
      this.bossPhase = 1;
      this.bossPhaseTriggered = {};
      this.executing = false; this.execTarget = null; this.execTimer = 0;
      this.branchActive = false; this.branchUsed = false; this.branchOptions = [];
      this.destructibles = []; this.elapsed = 0;
      this.spawnDestructibles();
    },

    // ===== 系统1：连击计数 =====
    onEnemyHit() {
      this.combo++;
      this.comboTimer = 3.0; // 3秒内不命中则清零
      this.addRage(2);
      // v4.2 记录本局最高连击（MVP 高光）
      if (this.exp && this.exp.runStats && this.combo > (this.exp.runStats.maxCombo || 0)) {
        this.exp.runStats.maxCombo = this.combo;
      }
    },
    onPlayerHit() {
      if (this.combo > 5) showToast(`连击中断！${this.combo} 连击`, 'warning');
      this.combo = 0;
      this.comboTimer = 0;
      this.addRage(8); // 受击也回怒气
    },
    getComboMul() {
      // 每层+5%伤害，上限+100%
      const _cap = (typeof DifficultySystem !== 'undefined') ? DifficultySystem.get().comboCap : 1.0; return 1 + Math.min(this.combo * 0.05, _cap);
    },

    // ===== 系统2：完美闪避 =====
    tryDodge() {
      if (this.dodgeCd > 0) return false;
      const p = this.exp.player;
      // 向移动方向闪避，无移动则向面朝方向
      let dx = 0, dy = 0;
      const k = this.exp.keys;
      if (k['w'] || k['arrowup']) dy -= 1;
      if (k['s'] || k['arrowdown']) dy += 1;
      if (k['a'] || k['arrowleft']) dx -= 1;
      if (k['d'] || k['arrowright']) dx += 1;
      if (dx === 0 && dy === 0) { dx = Math.cos(p.angle); dy = Math.sin(p.angle); }
      const len = Math.sqrt(dx*dx + dy*dy) || 1;
      const dodgeDist = 120;
      p.x = clamp(p.x + dx/len * dodgeDist, 30, CONFIG.expedition.mapSize - 30);
      p.y = clamp(p.y + dy/len * dodgeDist, 30, CONFIG.expedition.mapSize - 30);
      p.invuln = Math.max(p.invuln, 0.35);
      this.perfectDodgeWindow = (typeof DifficultySystem !== 'undefined') ? DifficultySystem.get().dodgeWindow / 1000 : 0.2;
      this.dodgeCd = 1.2;
      this.exp.spawnAoeEffect(p.x, p.y, 30, '#88ddff');
      // v3.3 闪避过程中碰到自爆怪 → 提前引爆（玩家在无敌帧内）
      if (this.exp.monsters) {
        for (const m of this.exp.monsters) {
          if (m.hp <= 0) continue;
          if ((m.aiType === 'bomber' || m.aiType === 'self_destruct' || m.type === 'bomber') && m.windupT > 0) {
            const d = Math.hypot(m.x - p.x, m.y - p.y);
            if (d < 60 && typeof this.exp.explodeBomber === 'function') this.exp.explodeBomber(m);
          }
        }
      }
      return true;
    },
    // 玩家受伤前调用，返回true表示完美闪避成功（免伤）
    checkPerfectDodge() {
      if (this.perfectDodgeWindow > 0) {
        this.perfectDodgeWindow = 0;
        this.slowMotion = 0.3; // 慢动作0.3秒
        const _diff = (typeof DifficultySystem !== 'undefined') ? DifficultySystem.get() : {dodgeCrit:true, dodgeCritDmg:2.0}; this.nextAttackCrit = _diff.dodgeCrit; this.nextAttackCritMul = _diff.dodgeCrit ? 2.0 : _diff.dodgeCritDmg;
        this.addRage(15);
        showToast('完美闪避！下次攻击必暴击', 'gold');
        this.exp.spawnRadialBurst(this.exp.player.x, this.exp.player.y, '#88ffff', 16);
        return true;
      }
      return false;
    },

    // ===== 系统3：敌人血条分段 =====
    getSegments(m) {
      if (m.type === 'boss') return 3;
      if (m.elite) return 2;
      return 1;
    },
    getCurrentSegment(m) {
      const seg = this.getSegments(m);
      const hpPct = m.hp / m.maxHp;
      return Math.min(seg, Math.ceil(hpPct * seg));
    },
    onSegmentBreak(m) {
      // 分段打破时短暂硬直 + 掉落补给
      m.stunned = Math.max(m.stunned || 0, 0.6);
      m.hitFlash = 0.3;
      this.exp.spawnAoeEffect(m.x, m.y, 50, '#ffdd44');
      if (Math.random() < 0.5) {
        this.exp.spawnGroundLoot({ type: 'heal', name: '急救包', amount: 1, icon: '💊', heal: 30 }, m.x + rand(-20,20), m.y + rand(-20,20));
      }
      showToast('击破护甲！敌人硬直', 'success');
    },

    // ===== 系统4：敌人AI多样化 =====
    updateMonsterAI(m, dt) {
      const p = this.exp.player;
      const d = Math.sqrt((m.x-p.x)**2 + (m.y-p.y)**2);
      m.aiState = m.aiState || 'chase';
      m.aiTimer = (m.aiTimer || 0) - dt;

      switch (m.aiType || 'chaser') {
        case 'charger': // 冲锋型：蓄力后直线冲撞
          if (m.aiState === 'chase') {
            if (d > 100 && d < 300 && m.aiTimer <= 0) {
              m.aiState = 'charge_windup';
              m.aiTimer = 0.8;
              m.chargeAngle = Math.atan2(p.y - m.y, p.x - m.x);
              this.exp.spawnAoeEffect(m.x, m.y, 25, '#ff6644');
            } else {
              const a = Math.atan2(p.y - m.y, p.x - m.x);
              m.x += Math.cos(a) * m.speed * 0.6 * dt;
              m.y += Math.sin(a) * m.speed * 0.6 * dt;
            }
          } else if (m.aiState === 'charge_windup') {
            if (m.aiTimer <= 0) {
              m.aiState = 'charging';
              m.aiTimer = 0.4;
            }
          } else if (m.aiState === 'charging') {
            m.x += Math.cos(m.chargeAngle) * 400 * dt;
            m.y += Math.sin(m.chargeAngle) * 400 * dt;
            if (d < 35) this.exp.damagePlayer(m.damage * 1.2);
            if (m.aiTimer <= 0) { m.aiState = 'chase'; m.aiTimer = 3; }
          }
          break;

        case 'ranged': // 远程型：保持距离扔投射物
          if (d < 180) { // 太近就后退
            const a = Math.atan2(m.y - p.y, m.x - p.x);
            m.x += Math.cos(a) * m.speed * dt;
            m.y += Math.sin(a) * m.speed * dt;
          } else if (d > 350) { // 太远就靠近
            const a = Math.atan2(p.y - m.y, p.x - m.x);
            m.x += Math.cos(a) * m.speed * 0.7 * dt;
            m.y += Math.sin(a) * m.speed * 0.7 * dt;
          }
          if (m.aiTimer <= 0 && d < 400) {
            m.aiTimer = 2.0;
            const a = Math.atan2(p.y - m.y, p.x - m.x);
            const proj = this.exp.allocProjectile();
            Object.assign(proj, {
              x: m.x, y: m.y, vx: Math.cos(a)*250, vy: Math.sin(a)*250,
              damage: m.damage * 0.7, life: 2, radius: 6, fromMonster: true,
              color: '#aa66ff', pierce: 1
            });
            this.exp.projectiles.push(proj);
          }
          break;

        case 'bomber': // 自爆型：靠近后倒计时爆炸
          if (d > 50) {
            const a = Math.atan2(p.y - m.y, p.x - m.x);
            m.x += Math.cos(a) * m.speed * 1.3 * dt;
            m.y += Math.sin(a) * m.speed * 1.3 * dt;
          } else if (!m.exploding) {
            m.exploding = true;
            m.aiTimer = 1.2;
            m.explodeFlash = 0;
          }
          if (m.exploding) {
            m.explodeFlash = (m.explodeFlash || 0) + dt * 10;
            if (m.aiTimer <= 0) {
              // 爆炸
              this.exp.spawnAoeEffect(m.x, m.y, 80, '#ff8800');
              this.exp.spawnRadialBurst(m.x, m.y, '#ffaa00', 20);
              if (d < 80) this.exp.damagePlayer(m.damage * 1.5);
              m.hp = 0;
            }
          }
          break;

        case 'healer': // 治疗型：优先给其他怪回血
          // 找最近的受伤友军
          let target = null, minD = 300;
          this.exp.monsters.forEach(other => {
            if (other === m || other.hp <= 0) return;
            if (other.hp < other.maxHp * 0.8) {
              const od = Math.sqrt((other.x-m.x)**2 + (other.y-m.y)**2);
              if (od < minD) { minD = od; target = other; }
            }
          });
          if (target) {
            const a = Math.atan2(target.y - m.y, target.x - m.x);
            if (minD > 150) { m.x += Math.cos(a)*m.speed*0.8*dt; m.y += Math.sin(a)*m.speed*0.8*dt; }
            if (m.aiTimer <= 0) {
              m.aiTimer = 3;
              target.hp = Math.min(target.maxHp, target.hp + target.maxHp * 0.15);
              this.exp.spawnAoeEffect(target.x, target.y, 30, '#66ff88');
              this.exp.spawnRadialBurst(target.x, target.y, '#88ffaa', 8);
            }
          } else {
            // 没目标就游荡
            if (m.aiTimer <= 0) { m.wanderX = m.x + rand(-100,100); m.wanderY = m.y + rand(-100,100); m.aiTimer = 3; }
            const a = Math.atan2((m.wanderY||m.y)-m.y, (m.wanderX||m.x)-m.x);
            m.x += Math.cos(a)*m.speed*0.4*dt; m.y += Math.sin(a)*m.speed*0.4*dt;
          }
          break;

        default: // chaser：普通追击
          const a = Math.atan2(p.y - m.y, p.x - m.x);
          m.facing = a;
          if (d > 35) { m.x += Math.cos(a)*m.speed*dt; m.y += Math.sin(a)*m.speed*dt; }
          else if (m.aiTimer <= 0) { m.aiTimer = 1.0; this.exp.damagePlayer(m.damage); }
          break;
      }
    },

    // 给新生成的怪物分配AI类型
    assignAIType(m) {
      if (m.type === 'boss') { m.aiType = 'boss'; return; }
      if (m.type === 'boar') { m.aiType = 'charger'; return; }
      // v5.0：新精英/怪物按 CONFIG 行为标志分配 AI
      const mdef = (typeof CONFIG !== 'undefined' && CONFIG.monsters && CONFIG.monsters[m.type]) || {};
      if (mdef.ai) { m.aiType = mdef.ai; m.aiState = 'chase'; m.aiTimer = 1 + Math.random() * 2; return; }
      if (mdef.charger) { m.aiType = 'charger'; m.aiState = 'chase'; m.aiTimer = 1.5; return; }
      if (mdef.healer) { m.aiType = 'healer'; return; }
      if (mdef.flying || mdef.ranged) { m.aiType = 'ranged'; m.aiState = 'chase'; m.aiTimer = 1 + Math.random(); return; }
      // 按波次/地图等级混合AI类型
      const roll = Math.random();
      const tier = this.exp.map.tier;
      if (roll < 0.15 + tier * 0.05) m.aiType = 'ranged';
      else if (roll < 0.25 + tier * 0.05) m.aiType = 'bomber';
      else if (roll < 0.32 + tier * 0.03 && tier >= 2) m.aiType = 'healer';
      else m.aiType = 'chaser';
    },

    // ===== 系统5：精英怪词缀 =====
    AFFIXES: [
      { id: 'berserk', name: '狂暴', desc: '血量<30%时攻速翻倍' },
      { id: 'swift', name: '迅捷', desc: '移速+50%' },
      { id: 'vampiric', name: '吸血', desc: '命中玩家回血' },
      { id: 'splitting', name: '分裂', desc: '死亡分裂成2只小怪' },
      { id: 'shield', name: '护盾', desc: '开场带30%护盾，不破不硬直', minTier: 3 },
      { id: 'thorns', name: '反弹', desc: '受击反弹15%伤害', minTier: 3 },
      { id: 'summoner', name: '召唤', desc: '每10秒召唤2只小怪', minTier: 4 },
      { id: 'immune', name: '免疫', desc: '免疫一种伤害类型', minTier: 4 }
    ],
    makeElite(m) {
      m.elite = true;
      m.maxHp *= 2.5; m.hp = m.maxHp;
      m.damage *= 1.3;
      m.radius = (m.radius || 20) * 1.2;
      // v0.7.0 词缀数量由难度决定，高层词缀按层级解锁
      const _maxA = (typeof DifficultySystem !== 'undefined') ? DifficultySystem.get().maxAffixes : 2;
      const _tier = this.exp ? this.exp.map.tier : 1;
      const count = Math.max(1, Math.min(_maxA, 1 + Math.floor(Math.random() * _maxA)));
      m.affixes = [];
      const pool = this.AFFIXES.filter(a => !a.minTier || a.minTier <= _tier);
      for (let i = 0; i < count && pool.length > 0; i++) {
        const idx = Math.floor(Math.random() * pool.length);
        m.affixes.push(pool.splice(idx, 1)[0].id);
      }
      // 护盾词缀：加护盾值
      if (m.affixes.includes('shield')) { m.shield = m.maxHp * 0.3; m.maxHpWithShield = m.maxHp + m.shield; }
      // 免疫词缀：随机免疫类型
      if (m.affixes.includes('immune')) { m.immuneType = ['physical', 'magic', 'element'][Math.floor(Math.random()*3)]; }
      // 应用迅捷词缀
      if (m.affixes.includes('swift')) m.speed *= 1.5;
      m.eliteGlow = 0;
    },
    applyEliteEffects(m, dt) {
      if (!m.elite || !m.affixes) return;
      // 召唤词缀：每10秒召唤小怪
      if (m.affixes.includes('summoner')) {
        m.summonTimer = (m.summonTimer || 10) - dt;
        if (m.summonTimer <= 0 && this.exp) {
          m.summonTimer = 10;
          for (let i = 0; i < 2; i++) {
            this.exp.monsters.push({ type: m.type, x: m.x + (Math.random()-0.5)*40, y: m.y + (Math.random()-0.5)*40, hp: m.maxHp*0.2, maxHp: m.maxHp*0.2, damage: m.damage*0.5, speed: m.speed*1.2, radius: m.radius*0.7, elite: false, aiType: 'chaser', facing: 0, state: 'idle', stateTimer: 0, stunned: 0, hitFlash: 0 });
          }
        }
      }
      m.eliteGlow = (m.eliteGlow || 0) + dt * 3;
      // 狂暴：血量<30%攻速翻倍（通过减少attackCd实现）
      if (m.affixes.includes('berserk') && m.hp < m.maxHp * 0.3) {
        m.aiTimer = Math.max(0, (m.aiTimer || 0) - dt); // 更快
      }
    },
    onEliteDeath(m) {
      if (!m.elite || !m.affixes) return;
      if (m.affixes.includes('splitting')) {
        // 分裂成2只小怪
        for (let i = 0; i < 2; i++) {
          const mini = {
            type: m.type, x: m.x + rand(-20,20), y: m.y + rand(-20,20),
            hp: m.maxHp * 0.25, maxHp: m.maxHp * 0.25,
            damage: m.damage * 0.5, speed: m.speed * 1.2,
            radius: (m.radius || 20) * 0.7, elite: false, aiType: 'chaser',
            facing: 0, state: 'idle', stateTimer: 0, stunned: 0, hitFlash: 0
          };
          this.exp.monsters.push(mini);
        }
        showToast('精英分裂！', 'warning');
      }
    },
    // 吸血词缀：怪物命中玩家时调用
    onEliteHitPlayer(m) {
      if (m.elite && m.affixes && m.affixes.includes('vampiric')) {
        m.hp = Math.min(m.maxHp, m.hp + m.damage * 0.3);
        this.exp.spawnAoeEffect(m.x, m.y, 20, '#ff4466');
      }
    },

    // ===== 系统6：战场环境互动 =====
    DESTRUCTIBLE_TYPES: [
      { type: 'barrel', name: '油桶', icon: '🛢️', hp: 15, radius: 18, explodeRadius: 90, explodeDamage: 40, color: '#cc6633' },
      { type: 'rock', name: '落石', icon: '🪨', hp: 25, radius: 22, explodeRadius: 60, explodeDamage: 25, color: '#888888' },
      { type: 'poison', name: '毒气瓶', icon: '☣️', hp: 10, radius: 16, explodeRadius: 100, explodeDamage: 15, color: '#66cc44' }
    ],
    spawnDestructibles() {
      this.destructibles = [];
      const count = 4 + Math.floor(Math.random() * 4);
      for (let i = 0; i < count; i++) {
        const t = this.DESTRUCTIBLE_TYPES[Math.floor(Math.random() * this.DESTRUCTIBLE_TYPES.length)];
        this.destructibles.push({
          ...t,
          x: rand(150, CONFIG.expedition.mapSize - 150),
          y: rand(150, CONFIG.expedition.mapSize - 150),
          currentHp: t.hp,
          destroyed: false
        });
      }
    },
    damageDestructible(x, y, damage) {
      this.destructibles.forEach(d => {
        if (d.destroyed) return;
        const dd = Math.sqrt((d.x-x)**2 + (d.y-y)**2);
        if (dd < d.radius + 20) {
          d.currentHp -= damage;
          this.exp.spawnHitParticles(d.x, d.y, d.color);
          if (d.currentHp <= 0) this.explodeDestructible(d);
        }
      });
    },
    explodeDestructible(d) {
      d.destroyed = true;
      this.exp.spawnAoeEffect(d.x, d.y, d.explodeRadius, d.color);
      this.exp.spawnRadialBurst(d.x, d.y, d.color, 18);
      this.hitStop = Math.max(this.hitStop, 0.05);
      // 伤害范围内的怪物
      this.exp.monsters.forEach(m => {
        if (m.hp <= 0) return;
        const md = Math.sqrt((m.x-d.x)**2 + (m.y-d.y)**2);
        if (md < d.explodeRadius) {
          this.exp.damageEnemy(m, d.explodeDamage, d.color, true, { x:m.x, y:m.y, angle:0, weaponId:'env', fromPlayer:true });
        }
      });
      // 伤害玩家（如果在范围内）
      const pd = Math.sqrt((this.exp.player.x-d.x)**2 + (this.exp.player.y-d.y)**2);
      const _em = (typeof DifficultySystem !== 'undefined') ? DifficultySystem.get().envPlayerMul : 0.5; if (pd < d.explodeRadius) this.exp.damagePlayer(d.explodeDamage * _em);
      showToast(`${d.name}爆炸！`, 'warning');
    },

    // ===== 系统7：怒气/超杀槽 =====
    addRage(amount) {
      // 低血量时怒气积累更快
      const hpPct = this.exp.player.hp / this.exp.player.maxHp;
      const mul = hpPct < 0.3 ? 2.0 : (hpPct < 0.6 ? 1.5 : 1.0);
      this.rage = Math.min(this.rageMax, this.rage + amount * mul);
    },
    tryUltimate() {
      if (this.rage < this.rageMax) { showToast('怒气不足', 'warning'); return false; }
      this.rage = 0;
      const p = this.exp.player;
      // 全屏大招：清场 + 无敌
      p.invuln = Math.max(p.invuln, 2.0);
      this.slowMotion = 0.5;
      this.hitStop = 0.15;
      this.exp.spawnAoeEffect(p.x, p.y, 300, '#ffdd44');
      this.exp.spawnRadialBurst(p.x, p.y, '#ffffff', 40);
      this.exp.monsters.forEach(m => {
        if (m.hp <= 0) return;
        const d = Math.sqrt((m.x-p.x)**2 + (m.y-p.y)**2);
        if (d < 400) {
          const _ud = (typeof DifficultySystem !== 'undefined') ? DifficultySystem.get() : {ultBossDmg:0.25, ultEliteDmg:0.99, ultDisabled:false}; if(_ud.ultDisabled){showToast('无头修改器：超杀已禁用','warning');return false;} const dmg = m.type === 'boss' ? m.maxHp * _ud.ultBossDmg : (m.elite ? m.maxHp * _ud.ultEliteDmg : 999);
          this.exp.damageEnemy(m, dmg, '#ffdd44', true, { x:m.x, y:m.y, angle:0, weaponId:'ult', fromPlayer:true });
        }
      });
      showToast('⚡ 超杀释放！全屏震荡', 'gold');
      return true;
    },

    // ===== 系统8：Boss多阶段转换 =====
    updateBossPhase(boss) {
      if (boss.type !== 'boss') return;
      const hpPct = boss.hp / boss.maxHp;
      // 阶段2：60%血量
      if (hpPct <= 0.6 && !this.bossPhaseTriggered[2]) {
        this.bossPhaseTriggered[2] = true;
        this.bossPhase = 2;
        boss.damage *= 1.2;
        boss.speed *= 1.1;
        this.exp.spawnAoeEffect(boss.x, boss.y, 100, '#ff4444');
        this.exp.spawnRadialBurst(boss.x, boss.y, '#ff6666', 30);
        showToast('Boss进入阶段2：狂暴化！', 'warning');
      }
      // 阶段3：30%血量
      if (hpPct <= 0.3 && !this.bossPhaseTriggered[3]) {
        this.bossPhaseTriggered[3] = true;
        this.bossPhase = 3;
        boss.damage *= 1.3;
        boss.abilityCd = 1.5; // 更快放技能
        this.exp.spawnAoeEffect(boss.x, boss.y, 120, '#aa00ff');
        this.exp.spawnRadialBurst(boss.x, boss.y, '#cc44ff', 40);
        showToast('Boss进入阶段3：终极狂暴！', 'warning');
      }
    },

    // ===== 系统9：Roguelike岔路选择 =====
    BRANCH_TYPES: [
      { type: 'treasure', name: '宝箱', icon: '📦', desc: '高奖励，但可能有陷阱' },
      { type: 'combat', name: '精英战', icon: '⚔️', desc: '击败精英获得好掉落' },
      { type: 'shop', name: '商店', icon: '🏪', desc: '用金币买临时buff/补给' },
      { type: 'campfire', name: '篝火', icon: '🔥', desc: '回血+升级技能' }
    ],
    triggerBranch() {
      if (this.branchActive) return;
      this.branchActive = true;
      this.exp.paused = true;
      // 随机3个选项
      const pool = [...this.BRANCH_TYPES];
      this.branchOptions = [];
      for (let i = 0; i < 3 && pool.length > 0; i++) {
        const idx = Math.floor(Math.random() * pool.length);
        this.branchOptions.push(pool.splice(idx, 1)[0]);
      }
    },
    chooseBranch(idx) {
      if (!this.branchActive || !this.branchOptions[idx]) return;
      const choice = this.branchOptions[idx];
      this.branchActive = false;
      this.exp.paused = false;
      const p = this.exp.player;
      switch (choice.type) {
        case 'treasure':
          if (Math.random() < 0.3) {
            this.exp.damagePlayer(20);
            showToast('宝箱是陷阱！受到20伤害', 'warning');
          } else {
            GameState.gold += 50 + randInt(0, 50);
            this.exp.spawnGroundLoot({ type:'gold', name:'金币', amount:50, icon:'💰' }, p.x, p.y);
            showToast('宝箱开启！获得金币', 'gold');
          }
          break;
        case 'combat':
          // 生成一只精英
          const m = this.exp.monsters.find(x => x.hp > 0);
          if (m) this.makeElite(m);
          showToast('精英怪出现！击败获得好掉落', 'warning');
          break;
        case 'shop':
          GameState.gold = Math.max(0, GameState.gold - 30);
          p.hp = Math.min(p.maxHp, p.hp + 40);
          this.addRage(30);
          showToast('购买补给：回血40+怒气30（-30金）', 'success');
          break;
        case 'campfire':
          p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.4);
          showToast('篝火休息：恢复40%生命', 'success');
          break;
      }
    },

    // ===== 系统10：生存压力（火把燃料） =====
    updateTorch(dt) {
      const exp = this.exp; if (!exp) return;
      const _ds = (typeof DifficultySystem !== 'undefined' && DifficultySystem.get) ? DifficultySystem.get() : { torchMul: 1, vision: 1 };
      const _drain = (_ds.torchMul || 1); // 难度越高火把烧得越快
      const _dv = _ds.vision || 1;
      const _vm = (window.V5 && V5.visionMul) ? V5.visionMul(exp) : 1;
      if (this.torchFuel > 0) {
        this.torchFuel = Math.max(0, this.torchFuel - dt * _drain);
        if (this.torchFuel <= 0) this._tryAutoRelight();
      } else { this._tryAutoRelight(); }
      if (this.torchFuel <= 0) {
        exp.visionRadius = 105 * _dv * _vm; // 无火把：视野极小
      } else {
        exp.visionRadius = (330 + this.torchFuel * 0.4) * _dv * _vm; // 有火把：正常照明
      }
    },
    _tryAutoRelight() {
      const exp = this.exp; if (!exp || !exp.consumables) return;
      const spare = exp.consumables.torch || 0;
      if (spare > 0 && this.torchFuel <= 0) {
        exp.consumables.torch = spare - 1;
        this.torchFuel = this.torchMax || 60;
        if (exp.updateHUD) exp.updateHUD();
        showToast('自动点燃新火把（剩余 ' + (spare - 1) + ' 支）', 'success');
      }
    },
    useTorchItem() {
      if (this.torchFuel > (this.torchMax || 60) * 0.5) { showToast('火把仍在燃烧中', 'warning'); return; }
      this._tryAutoRelight();
    },

    // ===== 系统11：处决系统重做 =====
    canExecute(m) {
      if (!m) return false;
      const isEliteOrBoss = m.elite || m.type === 'boss';
      return isEliteOrBoss && m.hp > 0 && m.hp / m.maxHp < 0.15 && !this.executing;
    },
    tryExecute(m) {
      if (!this.canExecute(m)) return false;
      this.executing = true;
      this.execTarget = m;
      this.execTimer = 1.2; // 1.2秒处决动画
      this.exp.player.invuln = Math.max(this.exp.player.invuln, 1.5);
      this.slowMotion = 0.3;
      this.hitStop = 0.1;
      showToast('⚔️ 处决！', 'gold');
      return true;
    },
    updateExecute(dt) {
      if (!this.executing) return;
      this.execTimer -= dt;
      if (this.execTimer <= 0 && this.execTarget) {
        // 处决完成
        const _ed = (typeof DifficultySystem !== 'undefined') ? DifficultySystem.get() : {executeKill:true, executeDmg:1.0}; if(_ed.executeKill) this.execTarget.hp = 0; else this.execTarget.hp = Math.max(1, this.execTarget.hp * (1 - _ed.executeDmg));
        this.addRage(40);
        GameState.gold += 30;
        this.exp.spawnAoeEffect(this.execTarget.x, this.execTarget.y, 60, '#ff2222');
        this.exp.spawnRadialBurst(this.execTarget.x, this.execTarget.y, '#ff4444', 25);
        showToast('处决成功！+30金 +40怒气', 'gold');
        this.executing = false;
        this.execTarget = null;
      }
    },

    // ===== 主tick =====
    update(dt) {
      this.elapsed += dt;
      // 命中停顿
      if (this.hitStop > 0) { this.hitStop -= dt; return; }
      // 慢动作
      const timeScale = this.slowMotion > 0 ? 0.3 : 1.0;
      if (this.slowMotion > 0) this.slowMotion -= dt;
      const sdt = dt * timeScale;

      // 连击计时
      if (this.comboTimer > 0) {
        this.comboTimer -= sdt;
        if (this.comboTimer <= 0) this.combo = 0;
      }
      // 闪避冷却
      if (this.dodgeCd > 0) this.dodgeCd -= sdt;
      if (this.perfectDodgeWindow > 0) this.perfectDodgeWindow -= sdt;
      // 火把
      this.updateTorch(sdt);
      // 处决
      this.updateExecute(sdt);
      // 精英词缀效果
      this.exp.monsters.forEach(m => { if (m.hp > 0) this.applyEliteEffects(m, sdt); });
      // Boss阶段
      const boss = this.exp.monsters.find(m => m.type === 'boss' && m.hp > 0);
      if (boss) this.updateBossPhase(boss);
      // 每2分钟触发一次岔路选择
      if (this.elapsed > 120 && !this.branchActive && !this.branchUsed) {
        this.branchUsed = true;
        this.triggerBranch();
      }
    },

    // ===== 渲染HUD（连击/怒气/火把/岔路） =====
    renderHUD(ctx, cam) {
      const W = ctx.canvas.width, H = ctx.canvas.height;
      // 连击数（右上角）
      if (this.combo > 1) {
        ctx.save();
        ctx.font = `bold ${24 + Math.min(this.combo, 20)}px sans-serif`;
        ctx.textAlign = 'right';
        ctx.fillStyle = this.combo > 10 ? '#ffdd44' : '#ffffff';
        ctx.globalAlpha = Math.min(1, this.comboTimer / 3 + 0.3);
        ctx.fillText(`${this.combo} 连击`, W - 20, 50);
        ctx.font = '12px sans-serif';
        ctx.fillStyle = '#aaa';
        ctx.fillText(`伤害 +${Math.floor((this.getComboMul()-1)*100)}%`, W - 20, 70);
        ctx.restore();
      }
      // 怒气槽（左下角，血条上方）
      ctx.save();
      const rageX = 20, rageY = H - 100, rageW = 180, rageH = 12;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(rageX, rageY, rageW, rageH);
      const ragePct = this.rage / this.rageMax;
      const rageGrad = ctx.createLinearGradient(rageX, 0, rageX + rageW, 0);
      rageGrad.addColorStop(0, '#ff4400'); rageGrad.addColorStop(1, '#ffaa00');
      ctx.fillStyle = rageGrad;
      ctx.fillRect(rageX, rageY, rageW * ragePct, rageH);
      ctx.strokeStyle = '#666'; ctx.lineWidth = 1; ctx.strokeRect(rageX, rageY, rageW, rageH);
      ctx.font = '11px sans-serif'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
      ctx.fillText(`怒气 ${Math.floor(this.rage)}/${this.rageMax} ${this.rage >= this.rageMax ? '[F释放]' : ''}`, rageX + rageW/2, rageY + 9);
      ctx.restore();
      // 火把燃料
      ctx.save();
      ctx.font = '12px sans-serif'; ctx.fillStyle = this.torchFuel < 20 ? '#ff4444' : '#ffaa44';
      ctx.textAlign = 'left';
      const _spare = (this.exp && this.exp.consumables) ? (this.exp.consumables.torch || 0) : 0;
      const _dm = (typeof DifficultySystem !== 'undefined' && DifficultySystem.get) ? (DifficultySystem.get().torchMul || 1) : 1;
      if (this.torchFuel > 0) { ctx.fillStyle = '#ffaa44'; ctx.fillText('🔥 火把 ' + Math.ceil(this.torchFuel / _dm) + '秒（备用' + _spare + '支）', 20, H - 110); }
      else { ctx.fillStyle = '#ff5555'; ctx.fillText('☠️ 无火把·视野极小（备用' + _spare + '支，背包点击点燃）', 20, H - 110); }
      ctx.restore();
      // 完美闪避提示
      if (this.perfectDodgeWindow > 0) {
        ctx.save();
        ctx.font = 'bold 28px sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = '#88ffff'; ctx.globalAlpha = this.perfectDodgeWindow / 0.2;
        ctx.fillText('完美闪避！', W/2, H/2 - 60);
        ctx.restore();
      }
      // 处决提示
      this.exp.monsters.forEach(m => {
        if (this.canExecute(m)) {
          const sx = m.x - cam.x, sy = m.y - cam.y - (m.radius||20) - 20;
          if (sx > 0 && sx < W && sy > 0 && sy < H) {
            ctx.save();
            ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
            ctx.fillStyle = '#ff2222';
            ctx.fillText('[E] 处决', sx, sy);
            ctx.restore();
          }
        }
      });
      // 岔路选择面板
      if (this.branchActive) {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillRect(0, 0, W, H);
        ctx.font = 'bold 28px sans-serif'; ctx.fillStyle = '#ffd700'; ctx.textAlign = 'center';
        ctx.fillText('选择你的道路', W/2, H/2 - 100);
        this.branchOptions.forEach((opt, i) => {
          const bx = W/2 - 200 + i * 200, by = H/2 - 40;
          ctx.fillStyle = 'rgba(30,40,30,0.9)';
          ctx.fillRect(bx - 80, by, 160, 120);
          ctx.strokeStyle = '#4a6a4a'; ctx.lineWidth = 2; ctx.strokeRect(bx - 80, by, 160, 120);
          ctx.font = '36px sans-serif'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
          ctx.fillText(opt.icon, bx, by + 40);
          ctx.font = 'bold 16px sans-serif'; ctx.fillStyle = '#aaffaa';
          ctx.fillText(opt.name, bx, by + 65);
          ctx.font = '11px sans-serif'; ctx.fillStyle = '#aaa';
          ctx.fillText(opt.desc, bx, by + 85);
          ctx.font = '12px sans-serif'; ctx.fillStyle = '#ffd700';
          ctx.fillText(`[${i+1}] 选择`, bx, by + 108);
        });
        ctx.restore();
      }
    },

    // 渲染可破坏物
    renderDestructibles(ctx, cam) {
      this.destructibles.forEach(d => {
        if (d.destroyed) return;
        const sx = d.x - cam.x, sy = d.y - cam.y;
        if (sx < -50 || sx > ctx.canvas.width + 50 || sy < -50 || sy > ctx.canvas.height + 50) return;
        ctx.save();
        ctx.font = '24px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(d.icon, sx, sy + 8);
        // 血条
        if (d.currentHp < d.hp) {
          ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(sx - 15, sy - 20, 30, 4);
          ctx.fillStyle = '#cc6633'; ctx.fillRect(sx - 15, sy - 20, 30 * (d.currentHp/d.hp), 4);
        }
        ctx.restore();
      });
    }
  };

  window.CombatEnhancement = CombatEnhancement;
})();
