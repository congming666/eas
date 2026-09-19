/* Expedition 原型混合：粒子对象池与武器/命中特效工厂（由 expedition.js 拆分） */
Object.assign(Expedition.prototype, {
  allocParticle() { return this.particlePool.length ? this.particlePool.pop() : {}; },

  allocProjectile() { return this.projectilePool.length ? this.projectilePool.pop() : {}; },

  spawnHitParticles(x, y, color) {
    for (let i = 0; i < 11; i++) {
      const p = this.allocParticle();
      Object.assign(p, { x, y, vx: rand(-175, 175), vy: rand(-175, 175),
        life: 0.46, maxLife: 0.46, color, size: rand(2, 6), type: undefined, angle: undefined });
      this.particles.push(p);
    }
  },

  // 命中点光爆：亮斑 + 十字星芒
  spawnImpact(x, y, color, scale = 1) {
    const p = this.allocParticle();
    Object.assign(p, { x, y, vx: 0, vy: 0, life: 0.22, maxLife: 0.22, color, size: 10 * scale, type: 'impact' });
    this.particles.push(p);
    const r = this.allocParticle();
    Object.assign(r, { x, y, vx: 0, vy: 0, life: 0.28, maxLife: 0.28, color, size: 18 * scale, type: 'shock' });
    this.particles.push(r);
  },

  // 定向火花：沿攻击反方向喷射、带阻力与重力
  spawnDirectionalSparks(x, y, angle, color, count = 6, power = 1) {
    for (let i = 0; i < count; i++) {
      const spread = angle + Math.PI + rand(-0.7, 0.7);
      const speed = rand(120, 300) * power;
      const p = this.allocParticle();
      Object.assign(p, {
        x, y,
        vx: Math.cos(spread) * speed, vy: Math.sin(spread) * speed,
        life: rand(0.22, 0.42), maxLife: 0.42, color,
        size: rand(1.5, 3.5), type: 'splat', drag: 5, grav: 60,
        rot: rand(0, Math.PI * 2), spin: rand(-9, 9)
      });
      this.particles.push(p);
    }
  },

  // 冲击环：重击/暴击/Boss 受击时的扩散圆环
  spawnShockRing(x, y, color, size = 46) {
    const p = this.allocParticle();
    Object.assign(p, { x, y, vx: 0, vy: 0, life: 0.3, maxLife: 0.3, color, size, type: 'shock' });
    this.particles.push(p);
    const r = this.allocParticle();
    Object.assign(r, { x, y, vx: 0, vy: 0, life: 0.2, maxLife: 0.2, color: '#ffffff', size: size * 0.55, type: 'shock' });
    this.particles.push(r);
  },

  // 拖尾刀光：三层错开的残留弧光，主层带白色亮芯
  spawnSwingTrail(x, y, angle, color, dir = 1, scale = 1) {
    for (let k = 0; k < 3; k++) {
      const p = this.allocParticle();
      Object.assign(p, { x, y, vx: 0, vy: 0, life: 0.2 + k * 0.05, maxLife: 0.3, color,
        size: (48 - k * 9) * scale, angle: angle + dir * k * 0.14, dir, layer: k, type: 'trail' });
      this.particles.push(p);
    }
  },

  // 冻结碎裂：冰晶碎片向四周飞溅（big 为死亡大碎裂）
  spawnFrostShatter(x, y, big = false) {
    const count = big ? 22 : 9;
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(70, big ? 320 : 210);
      const p = this.allocParticle();
      Object.assign(p, { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
        life: rand(0.35, 0.65), maxLife: 0.65,
        color: ['#d8f6ff', '#a8e4ff', '#ffffff'][i % 3],
        size: rand(3, big ? 9 : 6), type: 'ice', drag: 3.2, grav: 260,
        rot: rand(0, Math.PI * 2), spin: rand(-12, 12) });
      this.particles.push(p);
    }
    this.spawnShockRing(x, y, '#bfeeff', big ? 70 : 40);
    if (big) this.spawnImpact(x, y, '#d8f6ff', 1.4);
    AudioManager.playFrostShatter();
  },

  // 火焰粒子：向上飘升、带阻力的暖色火球
  spawnFlame(x, y) {
    const p = this.allocParticle();
    Object.assign(p, { x: x + rand(-8, 8), y, vx: rand(-26, 26), vy: rand(-115, -60),
      life: rand(0.3, 0.48), maxLife: 0.48, color: '#ff8a2c', size: rand(4, 8),
      type: 'flame', drag: 1.6, grav: -40 });
    this.particles.push(p);
  },

  spawnKillFeedback(target) {
    this.killFlash = 0;
    // 击杀不触发时间停顿/重抖屏，避免"卡顿感"
    this.screenShake = Math.max(this.screenShake, target.type === 'boss' ? 0.16 : 0.10);
    this.spawnRadialBurst(target.x, target.y, target.type === 'boss' ? '#ffe8a0' : '#ff7868', target.type === 'boss' ? 12 : 9);
    if (target.slow > 0) this.spawnFrostShatter(target.x, target.y, true);
    if (target.burn) this.spawnRadialBurst(target.x, target.y, '#ff9a3c', 8);
    this.spawnShockRing(target.x, target.y, target.type === 'boss' ? '#ffca7a' : '#ff9a6a', target.type === 'boss' ? 64 : 40);
    this.spawnShockRing(target.x, target.y, target.type === 'boss' ? '#ffca7a' : '#ff9a6a', target.type === 'boss' ? 64 : 40);
    AudioManager.playMonsterHit('kill');
  },

  spawnAoeEffect(x, y, radius, color) {
    const p = this.allocParticle();
    Object.assign(p, { x, y, vx: 0, vy: 0, life: 0.5, maxLife: 0.5, color, size: radius, type: 'aoe' });
    this.particles.push(p);
    const r = this.allocParticle();
    Object.assign(r, { x, y, vx: 0, vy: 0, life: 0.35, maxLife: 0.35, color: '#ffffff', size: radius * 0.6, type: 'aoe' });
    this.particles.push(r);
  },

  spawnSlashEffect(x, y, angle, color = '#ffffff', size = 50, combo = 0) {
    const p = this.allocParticle();
    Object.assign(p, { x, y, vx: 0, vy: 0, life: 0.2, maxLife: 0.2,
      color, size, angle, dir: combo === 1 ? -1 : 1, type: 'slash' });
    this.particles.push(p);
    const inner = this.allocParticle();
    Object.assign(inner, { x, y, vx: 0, vy: 0, life: 0.14, maxLife: 0.14,
      color: '#ffffff', size: size * 0.7, angle, dir: combo === 1 ? -1 : 1, type: 'slash' });
    this.particles.push(inner);
  },

  spawnMuzzleEffect(x, y, angle, color) {
    for (let i = 0; i < 6; i++) {
      const spread = angle + rand(-0.32, 0.32);
      const p = this.allocParticle();
      Object.assign(p, { x: x + Math.cos(angle) * 22, y: y + Math.sin(angle) * 22,
        vx: Math.cos(spread) * rand(65, 150), vy: Math.sin(spread) * rand(65, 150),
        life: 0.22, maxLife: 0.22, color, size: rand(2, 5), type: 'spark', angle: undefined });
      this.particles.push(p);
    }
  },

  spawnWeaponSwitchEffect() {
    const colors = ['#f2c45b', '#75dc68', '#7be5c4'];
    colors.forEach((color, ring) => {
      const p = this.allocParticle();
      Object.assign(p, { x: this.player.x, y: this.player.y,
        vx: 0, vy: 0, life: 0.38 + ring * 0.08, maxLife: 0.38 + ring * 0.08,
        color, size: 34 + ring * 10, type: 'weaponRing' });
      this.particles.push(p);
    });
  },

  spawnRadialBurst(x, y, color, count = 10) {
    for (let i = 0; i < count; i++) {
      const angle = Math.PI * 2 * i / count + rand(-0.1, 0.1);
      const p = this.allocParticle();
      Object.assign(p, { x, y, vx: Math.cos(angle) * rand(100, 230), vy: Math.sin(angle) * rand(100, 230),
        life: 0.48, maxLife: 0.48, color, size: rand(3, 7), type: 'chaff', angle: undefined });
      this.particles.push(p);
    }
  },

  spawnVineEffect(x, y, radius) {
    for (let i = 0; i < 9; i++) {
      const angle = Math.PI * 2 * i / 9;
      const p = this.allocParticle();
      Object.assign(p, { x, y, vx: 0, vy: 0, life: 0.75, maxLife: 0.75,
        color: i % 2 ? '#89db67' : '#3f9d56', size: radius * rand(0.62, 1), angle, type: 'vine' });
      this.particles.push(p);
    }
  },

  spawnDashTrail(x, y, angle, color) {
    for (let i = 0; i < 7; i++) {
      const p = this.allocParticle();
      Object.assign(p, { x: x - Math.cos(angle) * i * 22, y: y - Math.sin(angle) * i * 22,
        vx: 0, vy: 0, life: 0.38 - i * 0.025, maxLife: 0.38,
        color, size: 18 - i, angle, type: 'earthTrail' });
      this.particles.push(p);
    }
  },

  spawnSmokeEffect(x, y) {
    for (let i = 0; i < 18; i++) {
      const angle = rand(0, Math.PI * 2), speed = rand(22, 85);
      const p = this.allocParticle();
      Object.assign(p, { x: x + rand(-20, 20), y: y + rand(-20, 20),
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: rand(0.7, 1.15), maxLife: 1.15, color: i % 3 ? '#808c88' : '#b5c3ba',
        size: rand(12, 28), type: 'smoke', angle: undefined });
      this.particles.push(p);
    }
  },

  spawnDashParticles(x, y, angle) {
    for (let i = 0; i < 8; i++) {
      const p = this.allocParticle();
      Object.assign(p, {
        x: x - Math.cos(angle) * i * 15,
        y: y - Math.sin(angle) * i * 15,
        vx: rand(-30, 30), vy: rand(-30, 30),
        life: 0.3, maxLife: 0.3, color: '#88ccff', size: rand(3, 6), type: undefined, angle: undefined
      });
      this.particles.push(p);
    }
  },

  updateVisualTimers(dt) {
    this.player.slow = Math.max(0, this.player.slow - dt);
    if (this.player.root > 0) this.player.root = Math.max(0, this.player.root - dt);
    this.weaponPulse = Math.max(0, this.weaponPulse - dt);
    this.attackAnim = Math.max(0, this.attackAnim - dt);
    this.weaponRecoil = Math.max(0, this.weaponRecoil - dt * 9);
    this.playerDamageFlash = Math.max(0, this.playerDamageFlash - dt * 3.2);
    this.critFlash = Math.max(0, this.critFlash - dt * 6);
    this.screenShake = Math.max(0, this.screenShake - dt * 4.5);
    this.player.visualZ = Math.max(0, this.player.visualZ + this.player.visualVz * dt);
    this.player.visualVz -= 360 * dt;
    if (this.player.visualZ <= 0) { this.player.visualZ = 0; this.player.visualVz = 0; }
    this.monsters.forEach(monster => {
      monster.deathTimer = Math.max(0, (monster.deathTimer || 0) - dt);
      monster.visualZ = Math.max(0, (monster.visualZ || 0) + (monster.visualVz || 0) * dt);
      monster.visualVz = (monster.visualVz || 0) - 330 * dt;
      if (monster.visualZ <= 0) { monster.visualZ = 0; monster.visualVz = 0; }
      // 受击击退：位移 + 衰减
      if (monster.knockX || monster.knockY) {
        monster.x += (monster.knockX || 0) * dt;
        monster.y += (monster.knockY || 0) * dt;
        const kd = Math.max(0, 1 - 9 * dt);
        monster.knockX *= kd; monster.knockY *= kd;
        if (Math.abs(monster.knockX) < 1 && Math.abs(monster.knockY) < 1) { monster.knockX = 0; monster.knockY = 0; }
      }
    });
    for (let i = 0; i < 4; i++) {
      this.skillCooldowns[i] = Math.max(0, this.skillCooldowns[i] - dt * (1 + this._getCropBuffMult('cooldown_reduction')));
      this.skillFlashes[i] = Math.max(0, this.skillFlashes[i] - dt);
    }
    Object.keys(this.consumableFlashes).forEach(id => {
      this.consumableFlashes[id] = Math.max(0, this.consumableFlashes[id] - dt);
    });
  },
  updateParticles(dt) {
    // 粒子：原地紧凑，死亡粒子回收到对象池（消灭每帧 filter 新数组）
    {
      const arr = this.particles;
      let w = 0;
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i];
        p.life -= dt;
        if (p.life <= 0) { this.particlePool.push(p); continue; }
        if (!STATIC_SHAPE_TYPES.has(p.type)) { p.x += p.vx * dt; p.y += p.vy * dt; }
        if (p.grav) p.vy += p.grav * dt;
        if (p.drag) { const d = Math.max(0, 1 - p.drag * dt); p.vx *= d; p.vy *= d; }
        if (p.spin) p.rot = (p.rot || 0) + p.spin * dt;
        arr[w++] = p;
      }
      arr.length = w;
      if (this.fxParticles) for (const p of this.fxParticles) p.life -= dt;
    }
  },
  updateDamageNumbers(dt) {
    // 伤害跳字：原地紧凑
    {
      const arr = this.damageNumbers;
      let w = 0;
      for (let i = 0; i < arr.length; i++) {
        const n = arr[i];
        n.life -= dt;
        if (n.life <= 0) continue;
        n.x += n.vx * dt;
        n.y += n.vy * dt;
        n.vy += 72 * dt;
        arr[w++] = n;
      }
      arr.length = w;
    }
  },
});
