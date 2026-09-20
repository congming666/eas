/* Expedition 原型混合：怪物AI/Boss/技能/植物防线/拾取/撤离/结算（由 expedition.js 拆分） */
Object.assign(Expedition.prototype, {
  castBossAbility(boss, d, angle) {
    const phase2 = boss.phase === 2;
    const idx = boss.castIndex || 0;
    boss.castIndex++;
    const dmgMul = phase2 ? 1.3 : 1;
    if (idx === 0) {
      // 地裂震荡：玩家脚下AOE + 冲击环
      this.spawnAoeEffect(this.player.x, this.player.y, phase2 ? 110 : 88, '#d59aff');
      this.spawnShockRing(this.player.x, this.player.y, '#d59aff', phase2 ? 110 : 88);
      if (d < (phase2 ? 175 : 155)) this.damagePlayer(boss.damage * .72 * dmgMul, boss);
    } else if (idx === 1) {
      // 狂暴冲锋：向玩家突进，路径拖尾 + 终点冲击
      const dashDist = phase2 ? 170 : 140;
      boss.x = clamp(boss.x + Math.cos(angle) * dashDist, 60, CONFIG.expedition.mapSize - 60);
      boss.y = clamp(boss.y + Math.sin(angle) * dashDist, 60, CONFIG.expedition.mapSize - 60);
      for (let i = 0; i < 10; i++) {
        this.spawnDirectionalSparks(boss.x - Math.cos(angle) * i * 14, boss.y - Math.sin(angle) * i * 14, angle + Math.PI, '#ff9a3c', 1, 1);
      }
      this.spawnShockRing(boss.x, boss.y, '#ff9a3c', 72);
      if (d < 115) this.damagePlayer(boss.damage * .9 * dmgMul, boss);
    } else if (idx === 2) {
      // 召唤兽群
      const count = phase2 ? 3 : 2;
      const types = ['wolf', 'spider', 'bat'];
      for (let i = 0; i < count; i++) {
        const a = angle + (i - (count - 1) / 2) * 0.6;
        const sx = clamp(boss.x + Math.cos(a) * 95, 60, CONFIG.expedition.mapSize - 60);
        const sy = clamp(boss.y + Math.sin(a) * 95, 60, CONFIG.expedition.mapSize - 60);
        this.spawnAoeEffect(sx, sy, 38, '#9affd5');
        const type = types[randInt(0, types.length - 1)];
        const data = CONFIG.monsters[type];
        this.monsters.push({
          type, ...data, x: sx, y: sy,
          hp: Math.round(data.hp * this.balance.enemyHp * 0.6), maxHp: Math.round(data.hp * this.balance.enemyHp * 0.6),
          damage: Math.max(2, Math.round(data.damage * this.balance.enemyDamage * 0.7)),
          speed: data.speed * this.balance.enemySpeed,
          attackCd: 0, stunned: 0, facing: a, animTime: 0, hitFlash: 0,
          elite: false, abilityCd: rand(1, 3), packOffset: 0, beastWave: false, state: 'idle', stateTimer: 0
        });
      }
    } else {
      // 暗影弹幕：扇形投射物
      const count = phase2 ? 8 : 6;
      const color = phase2 ? '#ff6b9d' : '#d59aff';
      for (let i = 0; i < count; i++) {
        const a = angle + (i - (count - 1) / 2) * 0.18;
        const p = this.allocProjectile();
        Object.assign(p, {
          x: boss.x + Math.cos(a) * 40, y: boss.y + Math.sin(a) * 40,
          vx: Math.cos(a) * 260, vy: Math.sin(a) * 260,
          damage: boss.damage * 0.45 * dmgMul, life: 2.2, radius: 9,
          fromPlayer: false, color, pierce: 1
        });
        p.hit = p.hit || []; p.hit.length = 0;
        this.projectiles.push(p);
      }
      this.spawnMuzzleEffect(boss.x, boss.y, angle, color);
    }
  },

  // Boss 技能前摇预警：脚下蓄力圈（颜色随技能）+ 头顶警示脉冲由 renderMonster 表现
  spawnBossTelegraph(boss) {
    const colors = ['#d59aff', '#ff9a3c', '#9affd5', '#d59aff'];
    const color = colors[boss.castIndex % 4];
    const p = this.allocParticle();
    Object.assign(p, { x: boss.x, y: boss.y, vx: 0, vy: 0, life: 0.55, maxLife: 0.55, color, size: 74, type: 'aoe' });
    this.particles.push(p);
    const w = this.allocParticle();
    Object.assign(w, { x: boss.x, y: boss.y - 40, vx: 0, vy: -6, life: 0.5, maxLife: 0.5, color: '#fff6d8', size: 14, type: 'warn' });
    this.particles.push(w);
  },

  spawnBeastWave() {
    this.beastWave.wave++;
    this.beastWave.active = true;
    if (window.Telemetry) Telemetry.onBeastWave(this);
    this.beastWave.duration = 32 + this.map.tier * 3;
    if (typeof AudioManager !== 'undefined' && AudioManager.playWaveWarning) AudioManager.playWaveWarning();
    // v5.4 指数兽潮：数量 1.18^(波次-1)，密度上限 26+Tier*8，后期压力指数抬升而非线性
    const _wn = this.beastWave.wave;
    const _cap = 32 + this.map.tier * 10;
    const count = Math.min(_cap, Math.round((12 + this.map.tier * 4) * Math.pow(1.34, _wn - 1)));
    const types = ['boar', 'bat', 'spider', 'locust', 'wolf'];
    for (let i = 0; i < count; i++) {
      const type = types[randInt(0, types.length - 1)];
      const data = CONFIG.monsters[type];
      const angle = Math.PI * 2 * i / count + rand(-0.22, 0.22);
      const distance = rand(430, 620);
      const x = clamp(this.player.x + Math.cos(angle) * distance, 80, CONFIG.expedition.mapSize - 80);
      const y = clamp(this.player.y + Math.sin(angle) * distance, 80, CONFIG.expedition.mapSize - 80);
      const hpScale = this.balance.enemyHp * (0.72 + Math.min(0.18, this.beastWave.wave * 0.035));
      this.monsters.push({
        type, ...data, x, y,
        hp: Math.round(data.hp * hpScale), maxHp: Math.round(data.hp * hpScale),
        damage: Math.max(3, Math.round(data.damage * this.balance.enemyDamage * (0.68 + Math.min(0.16, this.beastWave.wave * 0.03)))),
        speed: data.speed * this.balance.enemySpeed * 0.88,
        attackCd: 0, stunned: 0, target: null, vx: 0, vy: 0,
        facing: angle + Math.PI, animTime: rand(0, 10), hitFlash: 0,
        elite: false, abilityCd: rand(1, 4), packOffset: rand(-1, 1), beastWave: true, waveNo: this.beastWave.wave, state: 'idle', stateTimer: 0
      });
    }
    this.beastWave.remaining = count;
    // v5.4 波间隔随波次缩短：40s × 0.94^(波次-1)，下限 18s（本波刷出即开始下一波倒计时）
    this.beastWave.nextIn = Math.max(12, Math.round(40 * Math.pow(0.88, _wn - 1)));
    this.screenShake = 1;
    showToast(`第 ${this.beastWave.wave} 波兽潮来袭！立即进入已占领防御塔射程`, 'warning');
  },

  startMapEvent() {
    const event = { ...this.mapEvents[randInt(0, this.mapEvents.length - 1)] };
    event.timeLeft = event.duration;
    this.activeEvent = event;
    this.eventModifiers = { enemySpeed:1, enemyDamage:1, loot:1, vision:1 };
    if (event.id === 'blood_moon') this.eventModifiers = { enemySpeed:1.18, enemyDamage:1.22, loot:2, vision:1 };
    if (event.id === 'mist') this.eventModifiers = { enemySpeed:.78, enemyDamage:1, loot:1, vision:.62 };
    if (event.id === 'meteor') {
      for (let i=0;i<4;i++) this.spawnGroundLoot({type:'material',name:'天外晶屑',amount:1,icon:'◆'}, rand(350,2050), rand(350,2050));
    }
    showToast(`地图事件：${event.name} - ${event.text}`, 'warning');
  },

  updateMission() {
    if (!this.objective || this.objective.complete) return;
    if (this.objective.type === 'hunt') this.objective.progress = this.killCount;
    if (this.objective.type === 'scavenge') this.objective.progress = this.chestOpened;
    if (this.objective.type === 'tower') this.objective.progress = this.towers.filter(t => t.state === 'player').length;
    if (this.objective.progress >= this.objective.target) {
      this.objective.complete = true;
      GameState.gold += 35 * this.map.tier;
      this.consumables.herb_kit = (this.consumables.herb_kit || 0) + 1;
      showToast(`任务完成：${this.objective.title}，获得金币与补给`, 'success');
      this.spawnBoss();
    }
  },

  toggleInventory() {
    const existing = document.getElementById('inventoryOverlay');
    if (existing) { existing.remove(); return; }
    const inv = this.bag || [];
    const safe = this.safeBox || [];
    const safeCap = (typeof LoadoutSystem !== 'undefined') ? LoadoutSystem.getSafeCapacity() : 1;
    const usedSlots = inv.reduce((s, i) => s + (i.slots || 1), 0);
    const totalSlots = (typeof LoadoutSystem !== 'undefined') ? LoadoutSystem.BAG_SIZE : 16;
    let html = `<div style="width:520px;max-height:85vh;overflow-y:auto;background:#1a1f1a;border:1px solid #6a4a2a;border-radius:12px;padding:16px;color:#ddd;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="color:#ffd700;margin:0;">背包</h3>
        <span style="color:#888;font-size:12px;">背包 ${usedSlots}/${totalSlots} 格 · 安全箱 ${safe.length}/${safeCap} 格</span>
      </div>`;
    if (inv.length === 0) html += '<div style="color:#666;text-align:center;padding:16px;">背包空空如也，打怪捡东西吧</div>';
    const invIcon = (it) => (typeof CropArt !== 'undefined') ? CropArt.domFor(it, 22) : (it.icon || '📦');
    inv.forEach((item, i) => {
      const slots = item.slots || 1;
      const canUse = item.type === 'consumable';
      const canStore = safe.length < safeCap;
      html += `<div style="padding:8px;margin:4px 0;background:rgba(0,0,0,0.3);border-radius:6px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;">
        <span style="display:inline-flex;align-items:center;gap:6px;">${invIcon(item)} <b>${item.name}</b> ${item.amount>1?'×'+item.amount:''} <span style="color:#888;font-size:10px;">占${slots}格</span></span>
        <span style="display:flex;gap:4px;flex-wrap:wrap;">
          ${canUse ? `<button class="secondary-btn" style="font-size:11px;" onclick="Game.expedition.useInventoryItem(${i})">使用</button>` : ''}
          ${canStore ? `<button class="secondary-btn" style="font-size:11px;color:#ffd700;" onclick="Game.expedition.storeInSafe(${i})">🔒存安全箱</button>` : ''}
          <button class="secondary-btn" style="font-size:11px;color:#ff8888;" onclick="Game.expedition.dropInventoryItem(${i})">丢弃</button>
        </span>
      </div>`;
    });
    if (safe.length > 0) {
      html += `<div style="margin-top:14px;color:#ffd700;font-size:13px;border-top:1px solid #444;padding-top:8px;">🔒 安全箱（死亡保留，不占背包）</div>`;
      safe.forEach((item, i) => {
        html += `<div style="padding:6px;margin:4px 0;background:rgba(255,215,0,0.08);border-radius:6px;display:flex;justify-content:space-between;align-items:center;">
          <span style="display:inline-flex;align-items:center;gap:6px;">${invIcon(item)} ${item.name} ${item.amount>1?'×'+item.amount:''}</span>
          <button class="secondary-btn" style="font-size:11px;" onclick="Game.expedition.retrieveFromSafe(${i})">取回</button>
        </div>`;
      });
    }
    html += '<div style="margin-top:12px;text-align:center;font-size:11px;color:#666;">按 Tab 关闭 · 存入安全箱的物品死亡时保留，且不占背包格位</div></div>';
    const overlay = document.createElement('div');
    overlay.id = 'inventoryOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = html;
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
  },

  // 存入安全箱（从背包移到安全箱，不占背包格）
  storeInSafe(bagIdx) {
    const item = this.bag[bagIdx];
    if (!item) return;
    const safeCap = (typeof LoadoutSystem !== 'undefined') ? LoadoutSystem.getSafeCapacity() : 1;
    if (this.safeBox.length >= safeCap) {
      showToast('安全箱已满！', 'warning');
      return;
    }
    this.bag.splice(bagIdx, 1);
    this.safeBox.push(item);
    showToast(`🔒 ${item.name} 已存入安全箱`, 'gold');
    this.toggleInventory(); // 刷新面板
    this.updateHUD();
  },

  // 从安全箱取回背包
  retrieveFromSafe(safeIdx) {
    const item = this.safeBox[safeIdx];
    if (!item) return;
    // 检查背包是否有空间
    if (typeof LoadoutSystem !== 'undefined' && !LoadoutSystem.canAdd(this.bag, item)) {
      showToast('背包空间不足！', 'warning');
      return;
    }
    this.safeBox.splice(safeIdx, 1);
    this.bag.push(item);
    showToast(`📦 ${item.name} 已取回背包`, 'success');
    this.toggleInventory();
    this.updateHUD();
  },

  useInventoryItem(idx) {
    const item = (this.bag || [])[idx];
    if (!item) return;
    if (item.type === 'consumable' && item.id) {
      // 直接从背包物品使用，不依赖 this.consumables 计数
      const def = (CONFIG.consumables||[]).find(c => c.id === item.id);
      if (item.id === 'herb_kit') {
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + (def?.heal || 30));
        this.spawnAoeEffect(this.player.x, this.player.y, 60, '#ff66aa');
        showToast(`使用${item.name}，回复${def?.heal||30}生命`, 'success');
      } else if (item.id === 'thorn_storm') {
        const range = def?.range || 200, dmg = def?.damage || 40;
        [...this.monsters, ...(this.raiders||[])].forEach(m => {
          if (dist(m, this.player) < range) {
            this.damageEnemy(m, dmg, '#ff9a55', true, { x: m.x, y: m.y, angle: Math.atan2(m.y-this.player.y, m.x-this.player.x), fromPlayer: true });
            this.applyBurn(m, 22, 3);
          }
        });
        this.spawnAoeEffect(this.player.x, this.player.y, range, '#aa5500');
        showToast(`释放${item.name}！`, 'success');
      } else if (item.id === 'signal_flare') {
        // 直接触发信号弹撤离，不查 consumables 计数（背包里的就是信号弹本身）
        this.startExtract('signal');
        const flash = document.getElementById('signalFlash');
        if (flash) {
          flash.classList.remove('active');
          void flash.offsetWidth;
          flash.classList.add('active');
        }
        showToast('释放撤离信号弹！全地图敌人正在逼近！', 'warning');
      } else {
        // 其他消耗品走通用逻辑（草药/荆棘风暴已在上面处理，这里兜底）
        if (def) {
          if (def.heal) { this.player.hp = Math.min(this.player.maxHp, this.player.hp + def.heal); }
          showToast(`使用${item.name}`, 'success');
        }
      }
      this.bag.splice(idx, 1);
    } else if (item.type === 'gold') {
      GameState.gold += item.amount;
      showToast(`💰 +${item.amount} 金币`, 'gold');
      this.bag.splice(idx, 1);
    } else if (item.type === 'material') {
      if (!GameState.warehouse.materials) GameState.warehouse.materials = {};
      const mid = item.matId || 'misc';
      GameState.warehouse.materials[mid] = (GameState.warehouse.materials[mid]||0) + item.amount;
      showToast(`📦 收材料：${item.name} ×${item.amount}`, 'success');
      this.bag.splice(idx, 1);
    }
    this.toggleInventory();
  },

  dropInventoryItem(idx) {
    const item = (this.bag || [])[idx];
    if (!item) return;
    // 扔到脚下
    this.groundLoot.push({ ...item, x: this.player.x + rand(-20,20), y: this.player.y + rand(-20,20), bob: 0 });
    this.bag.splice(idx, 1);
    showToast(`🗑️ 丢弃了 ${item.name}`, 'warning');
    this.toggleInventory();
  },

  showSeedBar() {
    // 简单提示当前选中
    if (!this.seedBar || this.seedBar.length === 0) { showToast('没有携带种子', 'warning'); return; }
    if (this.selectedSeed < 0 || this.selectedSeed >= this.seedBar.length) return;
    const s = this.seedBar[this.selectedSeed];
    const def = CONFIG.deployPlants[s.type];
    if (def) showToast(`已选种子：${def.icon}${def.name}（${s.count}个），点地面种植`, 'success');
  },

  tryPlacePlant(gx, gy) {
    if (this.selectedSeed < 0 || !this.seedBar) return;
    const slot = this.seedBar[this.selectedSeed];
    if (!slot || slot.count <= 0) return;
    const def = CONFIG.deployPlants[slot.type];
    if (!def) return;
    // 不能种在出生点/撤离点/障碍物上
    for (const o of this.obstacles) {
      const dx = gx - o.x, dy = gy - o.y;
      if (Math.hypot(dx, dy) < (o.radius || 20) + 15) { showToast('这里不能种', 'warning'); return; }
    }
    const plant = {
      type: slot.type, ...def,
      x: gx, y: gy,
      hp: def.hp, maxHp: def.hp,
      age: 0,
      growTimer: 2, // 2秒长成
      cd: 0,
      exploded: false
    };
    this.plants.push(plant);
    slot.count--;
    if (slot.count <= 0) {
      this.seedBar.splice(this.selectedSeed, 1);
      this.selectedSeed = -1;
    }
    this.updateHUD();
  },

  updatePlants(dt) {
    if (!this.plants) return;
    for (let i = this.plants.length - 1; i >= 0; i--) {
      const p = this.plants[i];
      p.age += dt;
      if (p.growTimer > 0) { p.growTimer -= dt; continue; }
      p.cd -= dt;
      // 各种效果
      switch (p.effect) {
        case 'fire': {
          // 每秒烧经过的怪
          for (const m of this.monsters) {
            if (m.hp <= 0) continue;
            const d = Math.hypot(m.x - p.x, m.y - p.y);
            if (d < p.range) this.damageEnemy(m, 8 * dt * 10, '#ff6633', false, { noKnockback: true });
          }
          break;
        }
        case 'slow': {
          for (const m of this.monsters) {
            if (m.hp <= 0) continue;
            const d = Math.hypot(m.x - p.x, m.y - p.y);
            if (d < p.range) m.slowTimer = 0.5;
          }
          break;
        }
        case 'taunt': {
          for (const m of this.monsters) {
            if (m.hp <= 0) continue;
            const d = Math.hypot(m.x - p.x, m.y - p.y);
            if (d < p.range) m.target = p;
          }
          break;
        }
        case 'heal': {
          const d = Math.hypot(this.player.x - p.x, this.player.y - p.y);
          if (d < p.range && this.player.hp > 0) this.player.hp = Math.min(this.player.maxHp, this.player.hp + 2 * dt * 10);
          break;
        }
        case 'repel': {
          for (const m of this.monsters) {
            if (m.hp <= 0) continue;
            const d = Math.hypot(m.x - p.x, m.y - p.y);
            if (d < p.range) {
              // 怪远离
              const ang = Math.atan2(m.y - p.y, m.x - p.x);
              m.x += Math.cos(ang) * 30 * dt;
              m.y += Math.sin(ang) * 30 * dt;
            }
          }
          break;
        }
        case 'thorns': {
          // 怪碰到自动受伤（在怪物更新里处理）
          break;
        }
        case 'watermelon':
        case 'boom': {
          if (!p.exploded && p.age > 3) {
            p.exploded = true;
            for (const m of this.monsters) {
              if (m.hp <= 0) continue;
              const d = Math.hypot(m.x - p.x, m.y - p.y);
              if (d < p.range) this.damageEnemy(m, 30, '#ffaa00', false);
            }
            this.plants.splice(i, 1);
          }
          break;
        }
        case 'firebreath': {
          if (p.cd <= 0) {
            // 直线喷火：找玩家朝向方向
            const ang = Math.atan2(this.player.y - p.y, this.player.x - p.x);
            for (const m of this.monsters) {
              if (m.hp <= 0) continue;
              const mx = m.x - p.x, my = m.y - p.y;
              const proj = mx * Math.cos(ang) + my * Math.sin(ang);
              if (proj > 0 && proj < p.range) {
                const perp = Math.abs(-mx * Math.sin(ang) + my * Math.cos(ang));
                if (perp < 40) this.damageEnemy(m, 15, '#ff4400', false);
              }
            }
            p.cd = 0.5;
          }
          break;
        }
        case 'freeze': {
          if (p.cd <= 0) {
            for (const m of this.monsters) {
              if (m.hp <= 0) continue;
              const d = Math.hypot(m.x - p.x, m.y - p.y);
              if (d < p.range) m.freezeTimer = 1.5;
            }
            p.cd = 5;
          }
          break;
        }
        case 'tesla': {
          if (p.cd <= 0) {
            const near = this.monsters.filter(m => m.hp > 0).sort((a,b) =>
              Math.hypot(a.x-p.x,a.y-p.y) - Math.hypot(b.x-p.x,b.y-p.y)).slice(0,3);
            for (const m of near) this.damageEnemy(m, 10, '#ffff66', false);
            p.cd = 0.8;
          }
          break;
        }
        case 'stealth': {
          const d = Math.hypot(this.player.x - p.x, this.player.y - p.y);
          if (d < p.range) this.player.stealth = Math.max(this.player.stealth || 0, 3);
          break;
        }
        case 'buff': {
          const d = Math.hypot(this.player.x - p.x, this.player.y - p.y);
          if (d < p.range) this.player.atkBuff = 0.2;
          break;
        }
        case 'deathboom': {
          for (const m of this.monsters) {
            if (m.hp <= 0) continue;
            const d = Math.hypot(m.x - p.x, m.y - p.y);
            if (d < p.range) {
              for (const mm of this.monsters) {
                if (mm.hp <= 0) continue;
                const dd = Math.hypot(mm.x - p.x, mm.y - p.y);
                if (dd < p.range + 30) this.damageEnemy(mm, 50, '#aa44ff', false);
              }
              this.plants.splice(i, 1);
              break;
            }
          }
          break;
        }
      }
      // 植物血量
      if (p.hp <= 0) this.plants.splice(i, 1);
    }
  },

  renderPlants(ctx, cam) {
    if (!this.plants) return;
    for (const p of this.plants) {
      const sx = p.x - cam.x, sy = p.y - cam.y;
      // 成长进度
      const scale = p.growTimer > 0 ? 0.5 + (1 - p.growTimer/2) * 0.5 : 1;
      ctx.globalAlpha = p.growTimer > 0 ? 0.7 : 1;
      ctx.font = (28 * scale) + 'px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.icon, sx, sy);
      ctx.globalAlpha = 1;
      // 血条
      if (p.maxHp > 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(sx - 16, sy - 22, 32, 4);
        ctx.fillStyle = '#4f4';
        ctx.fillRect(sx - 16, sy - 22, 32 * (p.hp / p.maxHp), 4);
      }
    }
    // 选中种子预览
    if (this.selectedSeed >= 0 && this.mouse.x) {
      const def = CONFIG.deployPlants[this.seedBar[this.selectedSeed].type];
      if (def) {
        ctx.globalAlpha = 0.5;
        ctx.font = '28px serif';
        ctx.textAlign = 'center';
        ctx.fillText(def.icon, this.mouse.x - cam.x, this.mouse.y - cam.y);
        ctx.globalAlpha = 1;
      }
    }
  },

  spawnWildPlants() {
    if (!CONFIG.wildPlants) return;
    const size = CONFIG.expedition.mapSize;
    const tier = this.map.tier;
    const pool = CONFIG.wildPlants.filter(w => w.tier <= tier);
    for (let i = 0; i < 5; i++) {
      const w = pool[Math.floor(Math.random() * pool.length)];
      const x = rand(200, size - 200), y = rand(200, size - 200);
      this.wildPlants.push({ ...w, x, y, picked: false });
    }
  },

  tryPickWildPlant() {
    for (const w of this.wildPlants) {
      if (w.picked) continue;
      const d = Math.hypot(w.x - this.player.x, w.y - this.player.y);
      if (d < 40) {
        w.picked = true;
        if (!GameState.warehouse.crops) GameState.warehouse.crops = {};
        GameState.warehouse.crops[w.givesSeed] = (GameState.warehouse.crops[w.givesSeed] || 0) + 1;
        showToast(`🌿 采摘到种子：${w.name}！`, 'success');
        return true;
      }
    }
    return false;
  },

  cycleWeapon(direction = 1) {
    // v1.4 只在带入武器间切换
    if (!this.broughtStats || this.broughtStats.length <= 1) return;
    this.currentBroughtIdx = (this.currentBroughtIdx + direction + this.broughtStats.length) % this.broughtStats.length;
    const b = this.broughtStats[this.currentBroughtIdx];
    this.loadoutUid = b.uid;
    this.weaponIndex = Math.max(0, CONFIG.weapons.findIndex(w => w.id === b.weaponId));
    this.weapon = b.stats;
    GameState.selectedWeapon = b.weaponId;
    this.weaponPulse = 0.35;
    this.spawnWeaponSwitchEffect();
    showToast(`切换武器：${this.weapon.name}`, 'success');
    this.updateHUD();
    SaveSystem.save();
  },

  useSkill(idx) {
    if (this.skillCooldowns[idx] > 0) return;
    const skill = getSkillStats(CONFIG.skills[idx], this.skillBoosts[CONFIG.skills[idx].id] || 0);
    if (this.player.energy < skill.energyCost) {
      showToast('能量不足', 'warning');
      return;
    }
    this.player.energy -= skill.energyCost;
    this.skillCooldowns[idx] = skill.cooldown;
    this.skillFlashes[idx] = 0.28;
    AudioManager.playSkill(skill.id);
    // v5.1 立即刷新技能栏（HUD 有 0.25s 节流，先归零强制重绘），冷却环/能量实时显示
    this.hudTimer = 0;
    this.updateHUD();

    const px = this.player.x, py = this.player.y;
    // 鼠标方向
    const worldMouseX = this.mouse.x + this.camera.x;
    const worldMouseY = this.mouse.y + this.camera.y;
    const angle = Math.atan2(worldMouseY - py, worldMouseX - px);

    if (skill.id === 'straw_smash') {
      [...this.monsters, ...this.raiders].forEach(m => {
        if (dist(m, this.player) < skill.range) {
          this.damageEnemy(m, skill.damage, '#f2c45b', true, {
            x: m.x, y: m.y, angle: Math.atan2(m.y - this.player.y, m.x - this.player.x),
            weaponId: '', fromPlayer: true
          });
          m.stunned = 0.5;
        }
      });
      this.spawnAoeEffect(px, py, skill.range, '#f2c45b', 'ring');
      this.spawnRadialBurst(px, py, '#fff0a6', 12);
      this.spawnShockRing(px, py, '#ffe9a0', skill.range * 0.8);
    } else if (skill.id === 'vine_bind') {
      [...this.monsters, ...this.raiders].forEach(m => {
        if (dist(m, this.player) < skill.range) {
          m.stunned = skill.stunDuration;
          this.spawnHitParticles(m.x, m.y, '#55aa55');
        }
      });
      this.spawnVineEffect(px, py, skill.range);
    } else if (skill.id === 'earth_dash') {
      this.player.x += Math.cos(angle) * skill.dashDistance;
      this.player.y += Math.sin(angle) * skill.dashDistance;
      this.player.invuln = skill.invulnDuration;
      this.player.visualVz = 125;
      this.spawnDashParticles(px, py, angle);
      this.spawnDashTrail(px, py, angle, '#a6e7ff');
    } else if (skill.id === 'smoke_screen') {
      this.player.stealth = skill.stealthDuration;
      this.spawnSmokeEffect(px, py);
      showToast('进入隐身状态', 'success');
    }
  },

  useConsumable(id) {
    if ((this.consumables[id] || 0) <= 0) {
      showToast('没有该消耗品', 'warning');
      return;
    }
    const item = CONFIG.consumables.find(c => c.id === id);
    this.consumableFlashes[id] = 0.3;
    if (window.Telemetry) Telemetry.track('consumable_use', { id });
    AudioManager.playConsumable(id);
    if (id === 'herb_kit') {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + item.heal);
      this.consumables[id]--;
      showToast(`使用${item.name}，回复${item.heal}生命`, 'success');
      this.spawnAoeEffect(this.player.x, this.player.y, 60, '#ff66aa');
    } else if (id === 'thorn_storm') {
      [...this.monsters, ...this.raiders].forEach(m => {
        if (dist(m, this.player) < item.range) {
          this.damageEnemy(m, item.damage, '#ff9a55', true, {
            x: m.x, y: m.y, angle: Math.atan2(m.y - this.player.y, m.x - this.player.x),
            weaponId: '', fromPlayer: true
          });
          this.applyBurn(m, 22, 3);
        }
      });
      this.consumables[id]--;
      this.spawnAoeEffect(this.player.x, this.player.y, item.range, '#aa5500');
      showToast(`释放${item.name}！`, 'success');
    } else if (id === 'signal_flare') {
      this.consumables[id]--;
      this.startExtract('signal');
      const flash = document.getElementById('signalFlash');
      flash.classList.remove('active');
      void flash.offsetWidth;
      flash.classList.add('active');
      showToast('释放撤离信号弹！全地图敌人正在逼近！', 'warning');
    }
    this.updateHUD();
  },

  // v4.2 估算单件战利品价值（MVP 最值钱战利品）
  getLootValue(item) {
    if (!item) return 0;
    const amt = item.amount || 1;
    if (item.type === 'gold') return amt;
    const wi = (CONFIG.warehouseItems || {})[item.id];
    if (wi && wi.sellPrice) return wi.sellPrice * amt;
    if (item.type === 'consumable') {
      const cd = (CONFIG.consumables || []).find(c => c.id === item.id);
      return (cd && cd.value ? cd.value : 40) * amt;
    }
    if (item.type === 'material') {
      const mid = item.matId || item.id;
      const m = (CONFIG.warehouseItems || {})[mid];
      return (m && m.sellPrice ? m.sellPrice : 10) * amt;
    }
    if (item.type === 'seed_item' || item.type === 'seed_pickup') {
      const crop = (CONFIG.crops || []).find(c => c.id === item.seedId);
      return ((crop && (crop.sellPrice || crop.price)) || 30) * amt;
    }
    if (item.type === 'farm_item') return (wi && wi.sellPrice) || 50;
    return 0;
  },

  spawnGroundLoot(item, x, y) {
    this.groundLoot.push({
      ...item,
      x: x + rand(-28, 28),
      y: y + rand(-28, 28),
      bob: rand(0, Math.PI * 2),
    });
  },

  pickupLoot() {
    if (this.groundLoot.length === 0) return false;
    const pickupRange = CONFIG.weapons.find(weapon => weapon.mode === 'melee')?.range || CONFIG.player.attackRange;
    const candidates = this.groundLoot
      .map((item, index) => ({ item, index, playerDist: dist(this.player, item) }))
      .filter(entry => entry.playerDist <= pickupRange && this.isWorldVisible(entry.item.x, entry.item.y))
      .sort((a, b) => a.playerDist - b.playerDist);
    if (candidates.length === 0) return false;
    const target = candidates[0];
    this.groundLoot.splice(target.index, 1);
    const { x, y, bob, ...item } = target.item;
    if (item.type === 'invincible') {
      this.player.invuln = Math.max(this.player.invuln, item.duration || 5);
      this.player.slow = 0;
      this.spawnAoeEffect(x, y, 70, '#7de7ff');
      this.spawnRadialBurst(x, y, '#e6fbff', 22);
      showToast('无敌核心生效：5 秒内免疫一切伤害和控制！', 'success');
    } else if (item.type === 'plant_seed') {
      const plant = CONFIG.plants.find(p => p.id === item.plantId);
      if (plant) {
        if (!this.plantSeeds[plant.id]) this.plantSeeds[plant.id] = { maxPerRun: plant.maxPerRun, deployed: 0 };
        const rec = GameState.defensePlants[plant.id] || { progress: 0, count: 0 };
        rec.count = (rec.count || 0) + 1;
        GameState.defensePlants[plant.id] = rec;
        this.spawnAoeEffect(x, y, 34, '#7dff9a');
        showToast(`拾取防线种子：${plant.name}（本局可部署，培育中）`, 'gold');
      }
    } else if (item.type === 'plant_remains') {
      const record = this.plantRecords.find(r => r.seedId === item.seedId && r.destroyed && !r.recovered);
      if (record) record.recovered = true;
      this.spawnAoeEffect(x, y, 30, '#a5e675');
      showToast('回收植物残骸，培育损失减半', 'gold');
    } else if (item.type === 'seed_pickup') {
      // v3.2 种子进背包，撤离才入库
      const seedItem = { type: 'seed_item', id: 'seed_'+item.seedId, seedId: item.seedId, name: item.name, icon: item.icon, amount: 1, slots: 1 };
      const existing = this.bag.find(b => b.id === seedItem.id);
      if (existing) existing.amount += 1;
      else this.bag.push(seedItem);
      this.spawnAoeEffect(x, y, 40, '#ffd968');
      showToast(`拾取种子：${item.name}（需撤离保留）`, 'gold');
    } else if (item.type === 'weapon_drop') {
      // v1.0 临时武器拾取（自动切换）
      this.tempWeapons = this.tempWeapons || [];
      this.tempWeapons.push(item.weapon);
      this.spawnAoeEffect(x, y, 50, '#ffd700');
      showToast(`🔨 获得临时武器：${item.weapon.name}！按Q滚轮切换`, 'gold');
    } else if (item.type === 'consumable' && item.id) {
      // v5.4 修复：局内拾取的消耗品直接进快捷栏（与带入消耗品同口径），撤离时未用完的由 endExpedition 归还仓库
      this.consumables = this.consumables || {};
      this.consumables[item.id] = (this.consumables[item.id] || 0) + (item.amount || 1);
      this.spawnAoeEffect(x, y, 34, '#f6c75b');
      showToast('拾取 ' + (item.icon || '🎒') + ' ' + item.name + ' ×' + (item.amount || 1) + '（已加入快捷栏）', 'gold');
    } else {
      // v2.9 同类物品无限叠加（金币/材料等堆叠进已有格）
      // v3.7 金币无论从哪捡都合并到同一堆
      let existing;
      if (item.type === 'gold') {
        existing = this.bag.find(b => b.type === 'gold');
      } else {
        existing = this.bag.find(b => b.id === item.id && b.type === item.type);
      }
      if (existing) {
        existing.amount = (existing.amount || 1) + (item.amount || 1);
        if (item.type === 'gold') existing.name = '金币';
      } else if (typeof LoadoutSystem !== 'undefined' && !LoadoutSystem.canAdd(this.bag, item)) {
        showToast('背包已满！', 'warning');
        this.groundLoot.push({ ...item, x, y, bob: 0 });
        return false;
      } else {
        this.bag.push(item);
      }
      if (this.runStats) {
        const v = this.getLootValue(item);
        if (v > (this.runStats.topLoot ? this.runStats.topLoot.value : 0)) {
          this.runStats.topLoot = { name: item.name, icon: item.icon || '', artId: (typeof CropArt !== 'undefined' && CropArt.resolveArtId) ? CropArt.resolveArtId(item) : null, value: Math.round(v) };
        }
      }
      this.spawnAoeEffect(x, y, 34, '#f6c75b');
      showToast(`拾取 ${item.icon} ${item.name} ×${item.amount}`, 'gold');
    }
    this.updateHUD();
    return true;
  },

  // ==================== 植物防线系统 ====================
  getPlantSeedList() {
    return Object.keys(this.plantSeeds).map(id => {
      const plant = CONFIG.plants.find(p => p.id === id);
      if (!plant) return null;
      const seed = this.plantSeeds[id];
      return { ...plant, deployed: seed.deployed, maxPerRun: seed.maxPerRun };
    }).filter(Boolean);
  },

  selectPlantByKey(idx) {
    const list = this.getPlantSeedList();
    if (idx >= list.length) { this.selectedPlantId = null; this.updateHUD(); return; }
    const id = list[idx].id;
    this.selectedPlantId = this.selectedPlantId === id ? null : id;
    showToast(this.selectedPlantId ? `已选择防线：${CONFIG.plants.find(p => p.id === id).name}，点击空地部署` : '已取消选择防线', this.selectedPlantId ? 'success' : '');
    this.updateHUD();
  },

  cyclePlantSelection(dir) {
    const list = this.getPlantSeedList();
    if (list.length === 0) { this.selectedPlantId = null; this.updateHUD(); return; }
    const currentIdx = list.findIndex(p => p.id === this.selectedPlantId);
    const next = (currentIdx + dir + list.length) % list.length;
    this.selectedPlantId = list[next].id;
    showToast(`已选择防线：${list[next].name}`, 'success');
    this.updateHUD();
  },

  tryDeployPlant() {
    if (!this.selectedPlantId) return false;
    const seed = this.plantSeeds[this.selectedPlantId];
    const plant = CONFIG.plants.find(p => p.id === this.selectedPlantId);
    if (!seed || !plant) { this.selectedPlantId = null; this.updateHUD(); return false; }
    if (seed.deployed >= seed.maxPerRun) {
      showToast(`${plant.name}本局已达部署上限（${seed.maxPerRun}株）`, 'warning');
      return true;
    }
    const wx = this.mouse.x + this.camera.x;
    const wy = this.mouse.y + this.camera.y;
    if (dist(this.player, { x: wx, y: wy }) > 240) {
      showToast('部署距离过远（最远240）', 'warning');
      return true;
    }
    const cost = plant.deployCost;
    if (this.nutrient < cost) {
      showToast(`养分不足（需要${cost}，当前${Math.floor(this.nutrient)}）`, 'warning');
      return true;
    }
    if (!this.canDeployHere(wx, wy, 18)) {
      showToast('此处不能部署（障碍物/水域/塔/植物占位）', 'warning');
      return true;
    }
    this.deployPlant(plant, wx, wy);
    return true;
  },

  deployPlant(plant, wx, wy) {
    this.nutrient -= plant.deployCost;
    const seed = this.plantSeeds[plant.id];
    seed.deployed++;
    this.plants.push({
      id: plant.id, type: plant.type, name: plant.name, icon: plant.icon,
      x: wx, y: wy,
      hp: plant.hp, maxHp: plant.hp,
      life: plant.life, maxLife: plant.life,
      sustain: plant.sustain, deployCost: plant.deployCost,
      cooldown: plant.cooldown || 0.8, range: plant.range || 180,
      damage: plant.damage || 5, projectileSpeed: plant.projectileSpeed || 380,
      slowRadius: plant.slowRadius || 90, slowFactor: plant.slowFactor || 0.3,
      controlRadius: plant.controlRadius || 80, stunDuration: plant.stunDuration || 0.8,
      controlCooldown: plant.controlCooldown || 4, produceAmount: plant.produceAmount || 2,
      produceInterval: plant.produceInterval || 8,
      timer: 0, controlTimer: 0, produceTimer: 0, hitFlash: 0, attackAnim: 0, starving: false,
      seedId: plant.id,
    });
    this.plantsDirty = true;
    this.plantRecords.push({ seedId: plant.id, survived: false, recovered: false, destroyed: false });
    showToast(`部署${plant.name}，预扣养分${plant.deployCost}`, 'success');
    this.spawnAoeEffect(wx, wy, 34, '#7dff9a');
    this.spawnRadialBurst(wx, wy, '#b9ffd1', 12);
    this.updateHUD();
  },

  damagePlant(plant, amount) {
    if (!plant || plant.hp <= 0) return;
    plant.hp -= amount;
    plant.hitFlash = 0.15;
    this.damageNumbers.push({
      x: plant.x + rand(-8, 8), y: plant.y - 22,
      value: Math.round(amount), color: '#ff9a55', life: .5, maxLife: .5,
      vx: rand(-8, 8), vy: -40, heavy: false
    });
    if (plant.hp <= 0) this.destroyPlant(plant);
  },

  destroyPlant(plant) {
    plant.hp = 0;
    const record = this.plantRecords.find(r => r.seedId === plant.seedId && !r.destroyed);
    if (record) record.destroyed = true;
    this.plantDestroyCount[plant.seedId] = (this.plantDestroyCount[plant.seedId] || 0) + 1;
    const idx = this.plants.indexOf(plant);
    if (idx >= 0) this.plants.splice(idx, 1);
    this.plantsDirty = true;
    showToast(`${plant.name}被摧毁！培育进度损失，3秒内可回收残骸`, 'warning');
    this.spawnAoeEffect(plant.x, plant.y, 40, '#ff6644');
    this.spawnHitParticles(plant.x, plant.y, '#ff7744');
    this.spawnGroundLoot({
      type: 'plant_remains', name: '植物残骸', amount: 1, icon: '🌿',
      seedId: plant.seedId, expiresAt: performance.now() / 1000 + 3
    }, plant.x, plant.y);
    this.updateHUD();
  },

  updatePlants(dt) {
    const toRemove = [];
    for (const plant of this.plants) {
      // 养分维持
      if (plant.sustain > 0) {
        this.nutrient -= plant.sustain * dt;
        if (this.nutrient < 0) { this.nutrient = 0; plant.hp -= dt * 3; plant.starving = true; }
        else plant.starving = false;
      }
      // 寿命
      plant.life -= dt;
      if (plant.life <= 0) { toRemove.push(plant); continue; }
      // 输出
      if (plant.type === 'attack' || plant.type === 'ultimate') {
        plant.timer -= dt;
        if (plant.timer <= 0) {
          plant.timer = plant.cooldown;
          let nearest = null, minD = plant.range;
          this.monsters.forEach(m => { if (m.hp > 0) { const d = dist(plant, m); if (d < minD) { minD = d; nearest = m; } } });
          this.raiders.forEach(r => { const d = dist(plant, r); if (d < minD) { minD = d; nearest = r; } });
          if (nearest) {
            const p = this.allocProjectile();
            Object.assign(p, {
              x: plant.x, y: plant.y - 8,
              vx: (nearest.x - plant.x) / minD * plant.projectileSpeed,
              vy: (nearest.y - plant.y) / minD * plant.projectileSpeed,
              damage: plant.damage, life: plant.range / plant.projectileSpeed,
              fromPlant: true, radius: 6, color: plant.type === 'ultimate' ? '#d9ffb0' : '#7dff9a'
            });
            p.hit = p.hit || []; p.hit.length = 0;
            this.projectiles.push(p);
            plant.attackAnim = 0.2;
          }
        }
      }
      // 减速
      if (plant.type === 'slow' || plant.type === 'ultimate') {
        this.monsters.forEach(m => {
          if (m.hp > 0 && !m.slowImmune && dist(plant, m) < plant.slowRadius) {
            m.slow = Math.max(m.slow || 0, plant.slowFactor);
          }
        });
      }
      // 控制
      if (plant.type === 'control' || plant.type === 'ultimate') {
        plant.controlTimer -= dt;
        if (plant.controlTimer <= 0) {
          plant.controlTimer = plant.controlCooldown;
          this.monsters.forEach(m => {
            if (m.hp > 0 && dist(plant, m) < plant.controlRadius) {
              const stun = plant.stunDuration * (m.elite ? 0.5 : 1);
              m.stunned = Math.max(m.stunned || 0, stun);
            }
          });
          this.spawnVineEffect(plant.x, plant.y, plant.controlRadius);
        }
      }
      // 产资
      if (plant.type === 'produce' || plant.type === 'ultimate') {
        plant.produceTimer -= dt;
        if (plant.produceTimer <= 0) {
          plant.produceTimer = plant.produceInterval;
          this.nutrient = Math.min(this.nutrientMax, this.nutrient + plant.produceAmount);
          this.spawnAoeEffect(plant.x, plant.y, 26, '#ffe28a');
          this.damageNumbers.push({ x: plant.x + rand(-6, 6), y: plant.y - 30, value: `+${plant.produceAmount}`, color: '#ffe28a', life: .6, maxLife: .6, vx: 0, vy: -46, heavy: false });
        }
      }
      plant.hitFlash = Math.max(0, (plant.hitFlash || 0) - dt);
      plant.attackAnim = Math.max(0, (plant.attackAnim || 0) - dt);
    }
    for (const p of toRemove) {
      const idx = this.plants.indexOf(p);
      if (idx >= 0) this.plants.splice(idx, 1);
    }
    if (toRemove.length) this.plantsDirty = true;
  },

  // ============ 养分结晶 ============
  spawnNutrientCrystal(x, y, amount) {
    this.nutrientCrystals.push({ x, y, bob: rand(0, Math.PI * 2), amount, expiresAt: performance.now() / 1000 + 30 });
  },

  refreshNutrientCrystals(dt) {
    this.nutrientTimer -= dt;
    if (this.nutrientTimer <= 0) {
      this.nutrientTimer = CONFIG.nutrients.crystalInterval;
      const size = CONFIG.expedition.mapSize;
      const pos = this.findSafeSpawn(150, size - 150, 16);
      this.spawnNutrientCrystal(pos.x, pos.y, CONFIG.nutrients.crystalAmount);
    }
    const now = performance.now() / 1000;
    this.nutrientCrystals = this.nutrientCrystals.filter(c => now < c.expiresAt);
    this.pickupNutrientCrystals();
  },

  pickupNutrientCrystals() {
    for (let i = this.nutrientCrystals.length - 1; i >= 0; i--) {
      const c = this.nutrientCrystals[i];
      if (dist(this.player, c) < 46) {
        this.nutrient = Math.min(this.nutrientMax, this.nutrient + c.amount);
        this.nutrientCrystals.splice(i, 1);
        this.spawnAoeEffect(c.x, c.y, 30, '#ffe28a');
        this.damageNumbers.push({ x: c.x, y: c.y - 16, value: `+${c.amount}`, color: '#ffe28a', life: .6, maxLife: .6, vx: 0, vy: -44, heavy: false });
      }
    }
  },

  // ============ 培育结算（每局结束调用） ============
  applyPlantGrowthSettlement() {
    const g = CONFIG.plantGrowth;
    const record = (id, delta) => {
      if (delta === 0) return;
      const existing = this.growthSummary.find(s => s.id === id);
      if (existing) { existing.delta += delta; return; }
      const cfg = CONFIG.plants.find(p => p.id === id);
      if (cfg) this.growthSummary.push({ id, name: cfg.name, icon: cfg.icon, delta });
    };
    Object.keys(GameState.defensePlants).forEach(id => {
      const rec = GameState.defensePlants[id];
      if (!rec || rec.count <= 0) return;
      const before = rec.progress;
      rec.progress = clamp(rec.progress + g.basePerRun, 0, g.deployable);
      if (rec.progress !== before) record(id, rec.progress - before);
    });
    this.plantRecords.forEach(r => {
      const rec = GameState.defensePlants[r.seedId];
      if (!rec) return;
      if (r.survived) {
        const before = rec.progress;
        rec.progress = clamp(rec.progress + g.surviveBonus, 0, g.deployable);
        record(r.seedId, rec.progress - before);
        showToast(`${CONFIG.plants.find(p => p.id === r.seedId)?.name || r.seedId}存活撤离，培育 +${g.surviveBonus}`, 'success');
      } else if (r.destroyed) {
        const first = (this.plantDestroyCount[r.seedId] || 0) === 1;
        const penalty = (first ? g.firstDestroyPenalty : g.destroyPenalty) * (r.recovered ? 0.5 : 1);
        const before = rec.progress;
        rec.progress = clamp(rec.progress - penalty, 0, g.deployable);
        record(r.seedId, rec.progress - before);
        showToast(`${CONFIG.plants.find(p => p.id === r.seedId)?.name || r.seedId}被摧毁，培育 -${Math.round(penalty)}`, 'warning');
      }
    });
  },

  tryInteract() {
    const worldMouseX = this.mouse.x + this.camera.x;
    const worldMouseY = this.mouse.y + this.camera.y;
    // 检查宝箱
    for (const chest of this.chests) {
      if (!chest.opened && dist(this.player, chest) < 50 && dist({x:worldMouseX,y:worldMouseY}, chest) < 40) {
        this.openChest(chest);
        return;
      }
    }
    // 检查防御塔
    for (const tower of this.towers) {
      if (tower.state !== 'player' && dist(this.player, tower) < 50 && dist({x:worldMouseX,y:worldMouseY}, tower) < 40) {
        tower.state = 'player';
        tower.hp = tower.maxHp;
        showToast('防御塔已占领：进入射程可获得护盾减伤！', 'success');
        this.spawnAoeEffect(tower.x, tower.y, 50, '#7fff7f');
        return;
      }
    }
    // 检查撤离点
    for (const ep of this.extractPoints) {
      if (dist(this.player, ep) < ep.radius) {
        this.startExtract('fixed');
        return;
      }
    }
    // 普通攻击
    this.playerAttack();
  },

  playerAttack() {
    if (this.player.attackCd > 0) return;
    const w = this.weapon;
    // v2.0 等级词条：攻速/射程/速度修正
    const cdMult = 1 + (w.cdBonus || 0);
    this.player.attackCd = Math.max(0.08, w.cooldown * cdMult);
    const effRange = w.range * (1 + (w.rangeBonus || 0));
    const effSpeed = w.projectileSpeed * (1 + (w.speedBonus || 0));
    const worldMouseX = this.mouse.x + this.camera.x;
    const worldMouseY = this.mouse.y + this.camera.y;
    const angle = Math.atan2(worldMouseY - this.player.y, worldMouseX - this.player.x);
    this.player.angle = angle;
    this.weaponPulse = 0.18;
    this.attackAnim = 0.28;
    this.attackCombo = (this.attackCombo + 1) % 3;
    const combo = this.attackCombo;
    if (w.mode === 'melee') {
      const lungePower = [10, 13, 17][combo];
      this.player.lungeX = Math.cos(angle) * lungePower;
      this.player.lungeY = Math.sin(angle) * lungePower;
      // v2.0 镰刀Lv8 旋风斩：长按（mouse.down持续）360°扫
      const whirlwind = !!w.whirlwind && this.mouse.down;
      const arc = whirlwind ? Math.PI * 2 : Math.PI / 2;
      const reach = whirlwind ? effRange * 1.15 : effRange;
      [...this.monsters, ...this.raiders].forEach(m => {
        const d = dist(m, this.player);
        if (d < reach) {
          const mAngle = Math.atan2(m.y - this.player.y, m.x - this.player.x);
          const angleDiff = Math.abs(((mAngle - angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          if (whirlwind || angleDiff < arc) {
            let dmg = this.rollWeaponDamage(w);
            if (whirlwind) dmg *= (1 + (w.whirlwindDmg || 0));
            this.damageEnemy(m, dmg, w.color, combo === 2, {
              x: m.x, y: m.y, angle, weaponId: w.id, fromPlayer: true
            });
            // Lv10 割裂：叠流血
            if (w.bleed) { m.bleedStack = (m.bleedStack || 0) + 1; m.bleedUntil = performance.now() + 3000; }
            m.stunned = Math.max(m.stunned || 0, combo === 2 ? 0.45 : 0.25);
            m.visualVz = Math.max(m.visualVz || 0, combo === 2 ? 120 : 95);
          }
        }
      });
      this.spawnSlashEffect(this.player.x, this.player.y, angle, w.color, combo === 2 ? 70 : 58, combo);
      this.spawnSwingTrail(this.player.x + Math.cos(angle) * 30, this.player.y + Math.sin(angle) * 30, angle, w.color, combo === 1 ? -1 : 1, combo === 2 ? 1.05 : 1);
      this.weaponRecoil = combo === 2 ? 0.75 : 0.5;
      AudioManager.playAttack('melee', combo);
      // v3.7 近战也能打道具（油桶/木箱）
      if (this.props) {
        this.props.forEach(pr => {
          if ((pr.kind === 'barrel' || pr.kind === 'crate') && pr.hp > 0) {
            const d = dist(pr, this.player);
            if (d < reach) {
              this.damageProp(pr, this.rollWeaponDamage(w));
            }
          }
        });
      }
    } else {
      // v2.0 多弹道（豌豆Lv8/飞刃Lv8）
      const shots = w.multiShot || 1;
      const fanSpread = 0.18; // 扇面
      for (let s = 0; s < shots; s++) {
        const offset = shots === 1 ? 0 : (s - (shots - 1) / 2) * fanSpread;
        const a = angle + offset;
        const p = this.allocProjectile();
        Object.assign(p, { x: this.player.x + Math.cos(a) * 24, y: this.player.y + Math.sin(a) * 24,
          vx: Math.cos(a) * effSpeed, vy: Math.sin(a) * effSpeed,
          damage: this.rollWeaponDamage(w), life: effRange / effSpeed, radius: 7,
          fromPlayer: true, weaponId: w.id, pierce: (w.pierce || 1) + (w.pierceBonus || 0),
          color: w.color,
          explode: w.explode || 0, burnDps: w.burnDps || 0, burnStack: w.burnStack || 1,
          slowOnHit: w.slowOnHit || 0, slowDur: w.slowDur || 0,
          rootChance: w.rootChance || 0, rootDur: w.rootDur || 0,
          instantKillLow: w.instantKillLow || 0, autoAim: !!w.autoAim,
          ricochet: w.ricochet || 0, plague: !!w.plague,
          rainArrows: w.rainArrows || 0, nuke: !!w.nuke
        });
        p.hit = p.hit || []; p.hit.length = 0;
        this.projectiles.push(p);
      }
      this.spawnMuzzleEffect(this.player.x, this.player.y, angle, w.color);
      this.weaponRecoil = 1;
      AudioManager.playAttack(w.id === 'vine_staff' ? 'vine' : 'pea');
    }
  },

  openChest(chest) {
    chest.opened = true;
    this.chestOpened++;
    AudioManager.playChestOpen();
    const loot = [];
    // 金币
    const gold = randInt(20, 80) * this.map.tier;
    loot.push({ type: 'gold', name: '金币', amount: gold, icon: '💰' });
    // 种子
    if (Math.random() < 0.6) {
      const crop = CONFIG.crops[randInt(0, 3)];
      loot.push({ type: 'seed', name: crop.name + '种子', amount: randInt(1, 2), icon: crop.icon, cropId: crop.id });
    }
    // 稀有种子
    if (Math.random() < this.map.rareSeedChance) {
      loot.push({ type: 'seed', name: '稀有种子', amount: 1, icon: '✨', rare: true });
    }
    // 传说种子
    if (Math.random() < this.map.legendarySeedChance) {
      loot.push({ type: 'seed', name: '月光稻种子', amount: 1, icon: '🌟', legendary: true, cropId: 'moon_rice' });
    }
    // 植物防线种子（按T级概率掉落）
    const drops = CONFIG.plantDrops[this.map.tier - 1] || { common: 0, rare: 0, legendary: 0 };
    const plantRoll = Math.random();
    let plant = null;
    if (plantRoll < drops.legendary) {
      plant = CONFIG.plants.find(p => p.rarity === 'legendary');
    } else if (plantRoll < drops.legendary + drops.rare) {
      plant = CONFIG.plants.find(p => p.rarity === 'rare');
    } else if (plantRoll < drops.legendary + drops.rare + drops.common) {
      plant = CONFIG.plants.find(p => p.rarity === 'common');
    }
    if (plant) {
      loot.push({ type: 'plant_seed', name: plant.name + '防线种子', amount: 1, icon: plant.icon, plantId: plant.id });
    }
    // 泥土（庄园资源）
    if (Math.random() < 0.4) {
      loot.push({ type: 'material', name: '泥土', amount: randInt(1, 3), icon: '🟫', matId: 'soil' });
    }
    // 消耗品（v5.4：草药包掉率接难度补给系数，frugal 画像 30-40% 撤离率反推）
    const _chestSupply = (typeof DifficultySystem !== 'undefined' && DifficultySystem.get) ? (DifficultySystem.get().supplyMul || 1) : 1;
    if (Math.random() < Math.min(0.95, 0.65 * _chestSupply)) {
      loot.push({ type: 'consumable', name: '草药包扎包', amount: 1, icon: '💊', id: 'herb_kit' });
    }
    if (chest.hasSignal) {
      loot.push({ type: 'consumable', name: '撤离信号弹', amount: 1, icon: '🔥', id: 'signal_flare' });
    }
    if (Math.random() < 0.24) {
      loot.push({ type: 'farm_item', name: '生长催化剂', amount: 1, icon: '⏳', id: 'growth_catalyst' });
    }

    loot.forEach(item => this.spawnGroundLoot(item, chest.x, chest.y));
    showToast(`宝箱打开，掉落${loot.length}件物品，进入攻击范围后自动拾取`, 'gold');
    this.spawnAoeEffect(chest.x, chest.y, 50, '#ffd700');
    this.updateHUD();
  },

  startExtract(type) {
    if (this.extracting) return;
    this.extracting = true;
    if (window.Telemetry) Telemetry.onExtractBegin(type);
    this.extractType = type;
    this.extractProgress = 0;
    this.signalReinforced = false;
    if (type === 'signal') this.spawnSignalAmbush(0);
    showToast(type === 'signal' ? '信号弹撤离启动！坚持20秒，伏击正在逼近！' : '开始撤离读条，坚持15秒！', 'warning');
  },

  // v4.2 信号弹伏击：信号弹把全图怪物引来，读条开始第一波，中段增援第二波
  spawnSignalAmbush(wave) {
    const tier = (this.map && this.map.tier) || 1;
    const count = (wave === 0 ? 8 : 6) + tier * 2;
    const types = tier >= 3 ? ['wolf', 'spider', 'bat', 'locust'] : ['boar', 'bat', 'spider', 'locust', 'wolf'];
    for (let i = 0; i < count; i++) {
      const type = types[randInt(0, types.length - 1)];
      const data = CONFIG.monsters[type];
      if (!data) continue;
      const angle = Math.PI * 2 * i / count + rand(-0.25, 0.25);
      const distance = rand(380, 560);
      const x = clamp(this.player.x + Math.cos(angle) * distance, 80, CONFIG.expedition.mapSize - 80);
      const y = clamp(this.player.y + Math.sin(angle) * distance, 80, CONFIG.expedition.mapSize - 80);
      const hpScale = this.balance.enemyHp * 0.85;
      this.monsters.push({
        type, ...data, x, y,
        hp: Math.round(data.hp * hpScale), maxHp: Math.round(data.hp * hpScale),
        damage: Math.max(3, Math.round(data.damage * this.balance.enemyDamage * 0.85)),
        speed: data.speed * this.balance.enemySpeed * 1.12,
        attackCd: 0, stunned: 0, target: this.player, vx: 0, vy: 0,
        facing: angle + Math.PI, animTime: rand(0, 10), hitFlash: 0,
        elite: false, abilityCd: rand(1, 4), packOffset: rand(-1, 1), signalAmbush: true,
        state: 'idle', stateTimer: 0
      });
    }
    this.screenShake = Math.min(1, this.screenShake + 0.6);
    this.spawnRadialBurst(this.player.x, this.player.y, '#ff5a3c', 26);
    showToast(wave === 0 ? '信号弹引来伏击怪，守住撤离点！' : '第二波伏击怪增援！', 'warning');
  },

  cancelExtract() {
    if (!this.extracting) return;
    this.extracting = false;
    this.extractProgress = 0;
    showToast('撤离被打断！', 'warning');
  },

  completeExtract() {
    this.gameOver = true;
    this.result = 'success';
    AudioManager.playEvacuateSuccess();
    // v1.0 成就追踪
    if (typeof AchievementSystem !== 'undefined') {
      AchievementSystem.trackEvent('extract');
      const s = AchievementSystem && GameState.achievements.stats;
      s.consecutiveExtracts = (s.consecutiveExtracts || 0) + 1;
      s.lastRunKills = this.killCount || 0;
      s.lastRunGold = this.bag.filter(i=>i.type==='gold').reduce((a,i)=>a+i.amount,0);
      AchievementSystem.checkAll();
    }
    if (window.V5) V5.onExtractSuccess(this);
    this.endExpedition();
  },

  playerDeath() {
    this.gameOver = true;
    this.result = 'failed';
    if (!this.deathCause) {
      this.deathCause = {
        reason: this._timeoutDeath ? 'timeout' : 'killed',
        by: this.lastHitBy || 'unknown',
        wave: this.beastWave ? this.beastWave.wave : 0,
        elapsed: Math.round(this.elapsed || 0),
      };
    }
    if (window.Telemetry) Telemetry.onPlayerDeath(this);
    AudioManager.playDeath();
    if (GameState.achievements) GameState.achievements.stats.consecutiveExtracts = 0;
    // v1.0 死亡永久损失带入武器
    if (typeof LoadoutSystem !== 'undefined') LoadoutSystem.loseBroughtWeapon();
    if (window.V5) V5.onPlayerDeath(this);
    this.endExpedition();
  },

  endExpedition() {
    // 标记存活植物（撤离时仍在场）
    this.plants.forEach(p => {
      if (p.hp > 0) {
        const record = this.plantRecords.find(r => r.seedId === p.seedId && !r.destroyed);
        if (record) record.survived = true;
      }
    });
    this.cleanup();
    // v5.1 携带消耗品结算：未使用的归还仓库（含远征中拾取的同类消耗品），并清空本次携带配置
    if (GameState.loadout) {
      CONFIG.consumables.forEach(c => {
        const left = this.consumables ? (this.consumables[c.id] || 0) : 0;
        if (left > 0) Warehouse.addItem(c.id, left);
        GameState.loadout[c.id] = 0;
        delete GameState.loadout[c.id];
      });
    }
    // 培育结算（基础+10 / 存活+40 / 被毁-30，首杀-15）
    this.applyPlantGrowthSettlement();
    // 计算结算
    const totalGold = this.bag.filter(i => i.type === 'gold').reduce((s, i) => s + i.amount, 0);
    const keptItems = [];
    const lostItems = [];

    if (this.result === 'success') {
      Warehouse.beginBatch();
      // 成功：全部保留（含安全箱里的）
      this.bag.forEach(i => keptItems.push({ ...i, kept: true }));
      (this.safeBox || []).forEach(i => keptItems.push({ ...i, kept: true }));
      GameState.gold += totalGold;
      // 安全箱里的物品也一并入库
      (this.safeBox || []).forEach(i => {
        if (i.type === 'gold') GameState.gold += i.amount;
        else if (i.type === 'seed') Warehouse.addItem('seeds', i.amount);
        else if (i.type === 'material') {
          const matId = i.matId || (i.id && CONFIG.warehouseItems[i.id] ? i.id : null);
          if (matId && window.CONFIG.resources && CONFIG.resources[matId] && window.ResourceSystem) ResourceSystem.add(matId, i.amount);
          else if (matId && CONFIG.warehouseItems[matId]) Warehouse.addItem(matId, i.amount);
          else Warehouse.addItem('materials', i.amount);
        }
        else if (i.type === 'consumable') Warehouse.addItem(i.id, i.amount);
        else if (i.type === 'farm_item') Warehouse.addItem(i.id, i.amount);
      });
      this.bag.filter(i => i.type === 'seed').forEach(i => {
        Warehouse.addItem('seeds', i.amount);
        if (i.cropId && !GameState.unlockedCrops.includes(i.cropId)) {
          GameState.unlockedCrops.push(i.cropId);
          showToast(`解锁新作物：${CONFIG.crops.find(crop => crop.id === i.cropId)?.name || i.name}`, 'gold');
        }
      });
      this.bag.filter(i => i.type === 'material').forEach(i => {
        // v5.0 具体资源进 materials 背包，其余按仓库物品/通用材料
        const matId = i.matId || (i.id && CONFIG.warehouseItems[i.id] ? i.id : null);
        if (matId && window.CONFIG.resources && CONFIG.resources[matId] && window.ResourceSystem) ResourceSystem.add(matId, i.amount);
        else if (matId && CONFIG.warehouseItems[matId]) Warehouse.addItem(matId, i.amount);
        else Warehouse.addItem('materials', i.amount);
      });
      this.bag.filter(i => i.type === 'consumable').forEach(i => {
        Warehouse.addItem(i.id, i.amount);
      });
      this.bag.filter(i => i.type === 'farm_item').forEach(i => {
        Warehouse.addItem(i.id, i.amount);
      });
      // v3.2 野生作物种子：解锁对应作物 + 通用种子入仓（仓库可见、可种植）
      this.bag.filter(i => i.type === 'seed_item').forEach(i => {
        const qty = i.amount || 1;
        const cropDef = CONFIG.crops.find(c => c.id === i.seedId);
        if (cropDef && !GameState.unlockedCrops.includes(i.seedId)) {
          GameState.unlockedCrops.push(i.seedId);
          showToast(`🌟 解锁新作物：${cropDef.name}！`, 'gold');
        }
        Warehouse.addItem('seeds', qty);
        showToast(`🌱 收获种子：${i.name} ×${qty}`, 'success');
      });
      Warehouse.endBatch();
    } else {
      // v3.6 失败：玩家主动存入 this.safeBox 的物品必保留，其余全掉
      const safeItems = this.safeBox || [];
      safeItems.forEach(i => keptItems.push({ ...i, kept: true }));
      this.bag.forEach(i => {
        // 安全箱里的物品已经算 kept 过了，这里只处理 bag 里的（非安全箱物品）
        lostItems.push({ ...i, kept: false });
      });
      // 把安全箱物品也入账（金币/材料/消耗品）
      Warehouse.beginBatch();
      safeItems.forEach(i => {
        if (i.type === 'gold') GameState.gold += i.amount;
        else if (i.type === 'seed') Warehouse.addItem('seeds', i.amount);
        else if (i.type === 'material') {
          const matId = i.matId || (i.id && CONFIG.warehouseItems[i.id] ? i.id : null);
          if (matId && window.CONFIG.resources && CONFIG.resources[matId] && window.ResourceSystem) ResourceSystem.add(matId, i.amount);
          else if (matId && CONFIG.warehouseItems[matId]) Warehouse.addItem(matId, i.amount);
          else Warehouse.addItem('materials', i.amount);
        }
        else if (i.type === 'consumable') Warehouse.addItem(i.id, i.amount);
      });
      Warehouse.endBatch();
    }

    // v0.8.0 远征通关给科技点（仅成功时）
    if (this.result === 'success' && typeof TechSystem !== 'undefined') {
      TechSystem.onExpeditionComplete(this.map.tier, GameState.difficulty);
    }

    SaveSystem.save();

    // v3.8 生成本局高光卡片
    const rs = this.runStats || {};
    const highlights = [];
    if (this.killCount >= 50) highlights.push({ icon: '⚔️', title: '杀戮机器', desc: `单局击杀 ${this.killCount} 只怪` });
    else if (this.killCount >= 30) highlights.push({ icon: '⚔️', title: '老练猎手', desc: `击杀 ${this.killCount} 只怪` });
    if ((rs.maxDistFromSpawn || 0) > 800) highlights.push({ icon: '🗺️', title: '深度探索', desc: `最远深入 ${Math.round(rs.maxDistFromSpawn)}m` });
    if ((rs.minHpSeen || 100) < 15) highlights.push({ icon: '❤️‍🩹', title: '丝血逃生', desc: `血量一度低至 ${rs.minHpSeen.toFixed(0)}%` });
    else if ((rs.minHpSeen || 100) < 30 && this.result === 'success') highlights.push({ icon: '❤️', title: '险象环生', desc: `残血通关（最低 ${rs.minHpSeen.toFixed(0)}%）` });
    if ((rs.eliteKills || 0) >= 3) highlights.push({ icon: '👑', title: '精英猎人', desc: `击杀 ${rs.eliteKills} 只精英` });
    if ((rs.bossKills || 0) >= 1) highlights.push({ icon: '💀', title: 'Boss 终结者', desc: `击杀 Boss ${rs.bossKills} 次` });
    if ((rs.perfectDodgeCount || 0) >= 5) highlights.push({ icon: '💫', title: '风之舞者', desc: `${rs.perfectDodgeCount} 次完美闪避` });
    if ((rs.barrelsDetonated || 0) >= 3) highlights.push({ icon: '💥', title: '爆炸专家', desc: `引爆 ${rs.barrelsDetonated} 个油桶` });
    if ((rs.plantsDeployed || 0) >= 5) highlights.push({ icon: '🌱', title: '农场指挥官', desc: `部署 ${rs.plantsDeployed} 株战场植物` });
    if (this.chestOpened >= 5) highlights.push({ icon: '🎁', title: '宝箱收藏家', desc: `开启 ${this.chestOpened} 个宝箱` });
    if (this.result === 'success' && (rs.nearDeathCount || 0) >= 3) highlights.push({ icon: '🔥', title: '命悬一线', desc: `3 次以上濒临死亡仍成功撤离` });
    // 保底：如果一个高光都没有，给个安慰
    if (highlights.length === 0) {
      highlights.push({ icon: '🌾', title: '安稳远征', desc: `平安度过，击杀 ${this.killCount} 只怪` });
    }

    // 显示结算
    Game.showResult({
      success: this.result === 'success',
      mapName: this.map.name,
      timeUsed: (CONFIG.expedition.demoDuration - this.timeLeft).toFixed(1),
      kills: this.killCount,
      chests: this.chestOpened,
      damageTaken: this.damageTaken,
      goldEarned: this.result === 'success' ? totalGold : Math.floor(totalGold * 0.2),
      keptItems, lostItems,
      plantGrowth: this.growthSummary || [],
      highlights: highlights.slice(0, 4),
      runStats: rs,
    });
  },

  // v0.9.0 获取作物buff倍率
  _getCropBuffMult(type) {
    const buff = this.cropBuffs.find(b => b.type === type);
    return buff ? buff.value : 0;
  },

  // 施加灼烧：刷新持续时间，取更高 dps
  applyBurn(target, dps = 14, duration = 2.5) {
    if (!target || target.hp <= 0) return;
    const cur = target.burn;
    target.burn = { time: duration, dps: Math.max(cur ? cur.dps : 0, dps),
      tick: cur ? Math.min(cur.tick, 0.2) : 0.1, fx: 0 };
    this.spawnImpact(target.x, target.y, '#ff9a3c', 1.1);
    AudioManager.playIgnite();
  },

  // 灼烧状态推进：火焰视觉 + 每 0.4s 一跳伤害（quiet，不击退不顿帧）
  updateBurn(m, dt) {
    if (!m.burn) return;
    m.burn.time -= dt;
    m.burn.fx -= dt;
    if (m.burn.fx <= 0) { m.burn.fx = 0.06; this.spawnFlame(m.x + rand(-m.radius * 0.6, m.radius * 0.6), m.y - m.radius * 0.4); }
    m.burn.tick -= dt;
    if (m.burn.tick <= 0 && m.hp > 0) {
      m.burn.tick = 0.4;
      this.damageEnemy(m, m.burn.dps * 0.4, '#ff8a3c', false,
        { x: m.x, y: m.y, angle: 0, weaponId: 'burn', fromPlayer: true, quiet: true, crit: false });
      AudioManager.playBurnTick();
    }
    if (m.burn.time <= 0 || m.hp <= 0) m.burn = null;
  },

  // 闪电折线（世界坐标点列，静态粒子）
  spawnLightningBolt(x1, y1, x2, y2, color = '#a9f5ff') {
    const segments = 6;
    const points = [{ x: x1, y: y1 }];
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    for (let i = 1; i < segments; i++) {
      const t = i / segments;
      const jitter = rand(-14, 14) * (i === 1 || i === segments - 1 ? 0.4 : 1);
      points.push({ x: x1 + dx * t + nx * jitter, y: y1 + dy * t + ny * jitter });
    }
    points.push({ x: x2, y: y2 });
    const p = this.allocParticle();
    Object.assign(p, { x: (x1 + x2) / 2, y: (y1 + y2) / 2, vx: 0, vy: 0,
      life: 0.2, maxLife: 0.2, color, size: 1, type: 'chain', points });
    this.particles.push(p);
  },

  // 电击链：从命中目标向最近敌人跳跃，最多 jumps 次，每跳伤害衰减
  lightningChainFrom(source, proj, hitSet, jumpsLeft, dmgRatio) {
    if (jumpsLeft <= 0) return;
    let nearest = null, bestD = 150 * 150;
    for (const m of this.monsters) {
      if (m.hp <= 0 || hitSet.includes(m)) continue;
      const dd = (m.x - source.x) ** 2 + (m.y - source.y) ** 2;
      if (dd < bestD) { bestD = dd; nearest = m; }
    }
    if (!nearest) return;
    hitSet.push(nearest);
    this.spawnLightningBolt(source.x, source.y, nearest.x, nearest.y);
    this.spawnImpact(nearest.x, nearest.y, '#bff7ff', 1.1);
    this.spawnDirectionalSparks(nearest.x, nearest.y,
      Math.atan2(nearest.y - source.y, nearest.x - source.x), '#cdf9ff', 5, 0.9);
    this.damageEnemy(nearest, (proj.damage || 10) * dmgRatio, '#a9f5ff', false, {
      x: nearest.x, y: nearest.y,
      angle: Math.atan2(nearest.y - source.y, nearest.x - source.x),
      weaponId: 'vine_staff', fromPlayer: true, quiet: true, crit: false
    });
    nearest.visualVz = Math.max(nearest.visualVz || 0, 60);
    AudioManager.playZap();
    this.lightningChainFrom(nearest, proj, hitSet, jumpsLeft - 1, dmgRatio * 0.8);
  },

  explodeBomber(m) {
    if (!m || m.hp <= 0) return;
    const R = 80;
    this.spawnShockRing(m.x, m.y, '#ff5533', R);
    this.spawnImpact(m.x, m.y, '#ffaa33', 1.6);
    const d = dist(m, this.player);
    if (d < R) this.damagePlayer(m.damage || 20, m);
    this.monsters.forEach(o => { if (o !== m && o.hp > 0 && dist(o, m) < R) this.damageEnemy(o, (m.damage || 20) * 0.6, '#ff6644', false, { quiet: true }); });
    m.hp = 0;
  },

  nearestMonster(x, y, maxDist = 600) {
    let best = null, bd = maxDist * maxDist;
    for (const m of this.monsters) {
      if (m.hp <= 0) continue;
      const dx = m.x - x, dy = m.y - y, d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = m; }
    }
    return best;
  },

  damageEnemy(target, amount, color = '#ffffff', heavy = false, hitInfo = null) {
    if (!target || target.hp <= 0) return;
    if (target.armor) amount *= (1 - target.armor); // 厚甲猪减伤
    if (target.armorUntil && target.armorUntil > performance.now()) amount *= (1 - (target.armorReduce || 0.35)); // v5.1 Boss 岩石护甲
    const isBoss = target.type === 'boss';
    if (isBoss && target.enrageStage > 0) amount *= (1 + 0.12 * target.enrageStage); // v5.4 r4 狂暴阶防御崩坏：每阶受伤+12%，长尾双向收束
    const fromPlayer = hitInfo ? hitInfo.fromPlayer === true : false;
    if (fromPlayer && typeof CombatEnhancement !== 'undefined') {
      amount *= CombatEnhancement.getComboMul();
      if (CombatEnhancement.nextAttackCrit) { CombatEnhancement.nextAttackCrit = false; amount *= 2.0; if (hitInfo) hitInfo.crit = true; }
      CombatEnhancement.onEnemyHit();
      if (hitInfo && hitInfo.x !== undefined) CombatEnhancement.damageDestructible(hitInfo.x, hitInfo.y, amount);
    }
    // quiet：持续伤害/电击链不产生击退顿帧，避免抖动刷屏
    const quiet = !!(hitInfo && hitInfo.quiet);
    // v2.0 武器等级：暴击率加成（镰刀Lv6 +10%、飞刃Lv6 +15%）
    const critBonus = (fromPlayer && this.weapon && this.weapon.critChanceBonus) ? this.weapon.critChanceBonus : 0;
    const critBase = (fromPlayer && hitInfo && hitInfo.crit !== false) ? (0.20 + critBonus) : 0;
    const isCrit = critBase > 0 && Math.random() < critBase;
    if (isCrit) {
      let critMult = 1.8;
      if (fromPlayer && this.weapon && this.weapon.critDmgBonus) critMult += this.weapon.critDmgBonus;
      amount *= critMult;
      this.applyBurn(target, Math.max(10, amount * 0.35), 2.5);
    }
    const _prevSeg = typeof CombatEnhancement !== 'undefined' && target.maxHp > 0 ? Math.min(CombatEnhancement.getSegments(target), Math.ceil((target.hp/target.maxHp)*CombatEnhancement.getSegments(target))) : 0;
    target.hp -= amount;
    if (typeof CombatEnhancement !== 'undefined' && target.maxHp > 0 && target.hp > 0) {
      const seg = CombatEnhancement.getSegments(target);
      const curSeg = Math.min(seg, Math.ceil((target.hp/target.maxHp)*seg));
      if (curSeg < _prevSeg) CombatEnhancement.onSegmentBreak(target);
    }
    target.hitFlash = heavy ? 0.22 : 0.14;
    // v3.3 攻击打断：命中正在前摇的非精英/Boss 怪，20% 概率打断
    if (target.windupT > 0 && !target.elite && target.type !== 'boss' && fromPlayer && Math.random() < 0.20) {
      target.windupT = 0; target.windupKind = null;
      target.stunned = Math.max(target.stunned || 0, 0.6);
      this.spawnImpact(target.x, target.y, '#aaffcc', 1.2);
      showToast('打断！', 'success');
    }
    target.state = target.hp <= 0 ? 'death' : 'hit';
    target.stateTimer = target.hp <= 0 ? .4 : .18;
    // v2.0 镰刀Lv7 击杀回血
    if (target.hp <= 0 && fromPlayer && this.weapon && this.weapon.lifesteal) {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.weapon.lifesteal);
    }
    const dmgColor = isCrit ? '#ffd968' : color;
    this.damageNumbers.push({
      x: target.x + rand(-8, 8), y: target.y - target.radius - 8,
      value: Math.round(amount), color: dmgColor, life: isCrit ? 0.9 : 0.72, maxLife: isCrit ? 0.9 : 0.72,
      vx: rand(-10, 10), vy: heavy ? -64 : -48, heavy: heavy || isCrit, crit: isCrit
    });
    // 命中点光爆 + 沿攻击方向的定向火花 + 冲击环（重击/暴击/Boss）
    const hitX = hitInfo ? hitInfo.x : target.x;
    const hitY = hitInfo ? hitInfo.y : target.y;
    const hitAngle = hitInfo ? hitInfo.angle : Math.atan2(target.y - this.player.y, target.x - this.player.x);
    const weaponId = hitInfo ? hitInfo.weaponId : '';
    // 武器专属配色：命中光爆与定向火花颜色随武器变化
    const fx = WEAPON_FX[weaponId];
    const impactColor = isCrit ? '#fff3b0' : (fx ? fx.impact : color);
    const sparkColor = isCrit ? '#fff0a0' : (fx ? fx.spark : color);
    this.spawnImpact(hitX, hitY, impactColor, isCrit ? 1.6 : 1);
    this.spawnDirectionalSparks(hitX, hitY, hitAngle, sparkColor, heavy ? 12 : 8, isBoss ? 1.25 : 1);
    const hp = this.allocParticle();
    Object.assign(hp, { x: hitX, y: hitY, vx: 0, vy: 0, life: 0.22, maxLife: 0.22, type: 'hitImg', size: isCrit ? 90 : 60 });
    this.particles.push(hp);
    if (heavy || isCrit || isBoss) this.spawnShockRing(hitX, hitY, isBoss ? '#ffd9a0' : impactColor, isBoss ? 84 : 52);
    // 冻结碎裂：被寒冰藤减速（冰冻状态）的敌人受击时碎冰飞溅，死亡时大碎裂
    if (target.slow > 0 && fromPlayer) this.spawnFrostShatter(hitX, hitY, target.hp <= 0);
    if (!quiet) {
      // 方向击退：Boss 只受轻微击退；暴击额外 ×1.7
      const knockPower = (heavy ? 215 : 130) * (isBoss ? 0.3 : 1) * (isCrit ? 1.7 : 1);
      target.knockX = (target.knockX || 0) + Math.cos(hitAngle) * knockPower;
      target.knockY = (target.knockY || 0) + Math.sin(hitAngle) * knockPower;
      if (target.hp > 0) this.hitStop = Math.max(this.hitStop, isCrit ? 0.14 : heavy ? 0.09 : 0.05);
      if (target.hp > 0 && (isCrit || heavy)) this.screenShake = Math.max(this.screenShake, isCrit ? 0.5 : 0.32);
    }
    if (isCrit) {
      this.critFlash = Math.max(this.critFlash, 0.2);
      AudioManager.playCritHit();
    }
    AudioManager.playMonsterHit(isBoss ? 'heavy' : (isCrit ? 'crit' : heavy ? 'heavy' : 'normal'), weaponId);
    if (isBoss) AudioManager.playBossHit();
    if (this.fxSprites && this.fxSprites.hitBlood) {
      this.fxParticles = this.fxParticles || [];
      this.fxParticles.push({ img: this.fxSprites.hitBlood, x: hitX, y: hitY, life: 0.35, maxLife: 0.35, size: 32 });
    }
  },

  damagePlayer(amount, source) {
    if (this.player.invuln > 0) return;
    if (typeof CombatEnhancement !== 'undefined' && CombatEnhancement.checkPerfectDodge()) return;
    // 记录最后伤害来源（死亡原因埋点/平衡报表用）
    if (source) {
      this.lastHitBy = (typeof source === 'string') ? source : (source.boss ? 'boss' : source.elite ? 'elite:' + source.type : (source.type || source.name || source.id || 'unknown'));
    } else {
      const px = this.player.x, py = this.player.y;
      const near = this.monsters.find(m => m.hp > 0 && (m.x - px) ** 2 + (m.y - py) ** 2 < 70 * 70)
        || (this.raiders || []).find(m => m.hp > 0 && (m.x - px) ** 2 + (m.y - py) ** 2 < 70 * 70);
      if (near) this.lastHitBy = near.boss ? 'boss' : (near.elite ? 'elite:' + near.type : near.type);
      else if (this.boss && this.boss.hp > 0 && (this.boss.x - px) ** 2 + (this.boss.y - py) ** 2 < 110 * 110) this.lastHitBy = 'boss';
    }
    const defendingTower = this.towers.find(t => t.state === 'player' && dist(t, this.player) <= t.range);
    if (this.beastWave.active) {
      amount *= defendingTower ? 0.38 : 1.45;
    } else if (defendingTower) {
      amount *= 0.76;
    }
    if (window.V5) amount = V5.modifyIncomingDamage(this, amount);
    this.player.hp -= amount;
    this._lastCombat = performance.now() / 1000;
    this.player.hitStun = (this.v5 && this.v5.iron > 0) ? 0 : 0.15; // 金刚藤甲霸体
    AudioManager.playPlayerHurt();
    this.damageTaken += amount;
    this.screenShake = Math.min(1, this.screenShake + 0.48);
    this.playerDamageFlash = 0.38;
    this.spawnHitParticles(this.player.x, this.player.y, '#ff4444');
    this.spawnShockRing(this.player.x, this.player.y, '#ff5544', 42);
    if (typeof CombatEnhancement !== 'undefined') {
      CombatEnhancement.onPlayerHit();
      const attacker = this.monsters.find(m => m.hp > 0 && Math.sqrt((m.x-this.player.x)**2+(m.y-this.player.y)**2) < 60);
      if (attacker) CombatEnhancement.onEliteHitPlayer(attacker);
    }
    if (this.extracting) this.cancelExtract();
    if (this.player.hp <= 0) {
      this.player.hp = 0;
      this.playerDeath();
    }
  },

  updateRunSystems(dt) {
    if (window.V5) V5.tick(this, dt);
    this.updatePlants(dt);
    if (typeof CombatEnhancement !== 'undefined') CombatEnhancement.update(dt);
    if (typeof DifficultySystem !== 'undefined') { DifficultySystem.tick(dt, this); DifficultySystem.tickPoison(dt, this); }
    this.updateWorldSystems(dt);
    if (typeof WorldFX !== 'undefined') WorldFX.update(this, dt);
    this.fogUpdateTimer -= dt;
    if (this.fogUpdateTimer <= 0) {
      this.fogUpdateTimer += this.fogUpdateInterval;
      this.fogDirty = true;
    }
    this.entitySpatialHash.rebuild([...this.monsters, ...this.raiders]);
    this.pickupLoot();
    // 植物防线：养分结晶刷新/拾取 + 植物行为
    this.refreshNutrientCrystals(dt);
    this.updatePlants(dt);
  },
  updateMonsters(dt) {
    // 怪物AI
    this.monsters.forEach(m => {
      if (m.hp <= 0) return;
      m.attackCd = Math.max(0, m.attackCd - dt);
      m.attackAnim = Math.max(0, (m.attackAnim || 0) - dt);
      m.stunned = Math.max(0, m.stunned - dt);
      m.hitFlash = Math.max(0, (m.hitFlash || 0) - dt);
      m.slow = Math.max(0, (m.slow || 0) - dt * 0.8);
      m.stateTimer = Math.max(0, (m.stateTimer || 0) - dt);
      m.animTime = (m.animTime || 0) + dt * (1.8 + m.speed / 120);
      this.updateBurn(m, dt);
      // v2.0 镰刀Lv10 割裂：流血DOT
      if (m.bleedUntil && performance.now() < m.bleedUntil && m.hp > 0) {
        m.bleedTick = (m.bleedTick || 0) - dt;
        if (m.bleedTick <= 0) {
          m.bleedTick = 0.5;
          const stacks = Math.min(m.bleedStack || 1, 5);
          this.damageEnemy(m, 3 * stacks, '#cc3344', false, { quiet: true, crit: false });
        }
      } else if (m.bleedUntil) { m.bleedUntil = 0; m.bleedStack = 0; }
      // v3.3 攻击前摇（telegraph）
      if (m.windupT > 0) {
        m.windupT -= dt;
        m.animTime += dt * 0.6;
        if (m.windupT <= 0) {
          // 前摇结束，真正出手
          const wa = m.windupAngle || 0;
          if (m.windupKind === 'ranged') {
            const p = this.allocProjectile();
            Object.assign(p, { x: m.x, y: m.y, vx: Math.cos(wa) * 320, vy: Math.sin(wa) * 320, damage: m.damage, life: 2, fromMonster: true, radius: 6, monsterType: m.type, color: m.type === 'spider' ? '#9bea55' : '#ff6644' });
            p.hit = p.hit || []; p.hit.length = 0;
            this.projectiles.push(p);
            m.attackAnim = 0.3;
          } else if (m.windupKind === 'bomb') {
            this.explodeBomber(m);
          } else {
            if (m.type === 'boss') { m.attackAnim = 0.34; this.spawnSlashEffect(m.x + Math.cos(wa) * 46, m.y, wa, '#ffd9a0', 62); }
            if (m.windupTarget === 'plant' && m.windupPlant && m.windupPlant.hp > 0) {
              this.damagePlant(m.windupPlant, m.damage);
            } else {
              this.damagePlayer(m.damage, m);
              if (typeof DifficultySystem !== 'undefined') DifficultySystem.applyPoison(m, this);
            }
          }
          m.windupT = 0; m.windupKind = null; m.windupPlant = null;
        }
        return; // 前摇期间不移动
      }
      // v2.0 减速到期
      if (m.slowUntil && performance.now() > m.slowUntil) { m.slow = 0; m.slowUntil = 0; }
      const slowMul = m.slow > 0 ? clamp(1 - m.slow, 0.35, 1) : 1;
      if (m.stunned > 0) return;

      const d = dist(m, this.player);
      const canSee = this.beastWave.active || (this.player.stealth <= 0 && d < 400);

      // v3.7 巡逻队 AI：玩家不在视野内时沿路线走
      if (m.patrolRoute && !this.beastWave.active) {
        const aggroRange = 250;
        if (d < aggroRange && this.player.stealth <= 0) {
          // 发现玩家，进入追击
          m.state = 'chase';
          m.lostPlayerTimer = 0;
        } else if (m.state === 'chase') {
          // 追了一阵但玩家跑远了
          m.lostPlayerTimer = (m.lostPlayerTimer || 0) + dt;
          if (m.lostPlayerTimer > 3) {
            m.state = 'patrol';
            // 回到最近的巡逻点
            let nearest = 0, nd = 1e9;
            m.patrolRoute.forEach((wp, i) => {
              const dd = Math.hypot(wp.x - m.x, wp.y - m.y);
              if (dd < nd) { nd = dd; nearest = i; }
            });
            m.patrolWpIndex = nearest;
          }
        }
        if (m.state === 'patrol') {
          // 沿巡逻路线走
          const wp = m.patrolRoute[m.patrolWpIndex];
          const dx = wp.x + (m.patrolOffset || 0) - m.x;
          const dy = wp.y + (m.patrolOffset || 0) - m.y;
          const dd = Math.hypot(dx, dy);
          if (dd < 20) {
            // 到达当前点，去下一个
            m.patrolWpIndex = (m.patrolWpIndex + 1) % m.patrolRoute.length;
            m.state = 'idle';
            m.stateTimer = 0.5 + Math.random() * 0.5;
          } else {
            const ang = Math.atan2(dy, dx);
            m.facing = ang;
            // 巡逻速度 60%
            const spd = m.speed * slowMul * 0.6;
            this.moveEntityWithCollisions(m, Math.cos(ang) * spd * dt, Math.sin(ang) * spd * dt);
          }
          return; // 巡逻时不触发普通追击 AI
        }
      }

      // 反制兵种（食草兽/厚甲猪）优先攻击植物防线
      let plantTarget = null, plantDist = 0;
      if (m.plantHate) {
        plantDist = 280;
        this.plants.forEach(p => {
          const dd = dist(m, p);
          if (dd < plantDist) { plantDist = dd; plantTarget = p; }
        });
      }

      if (canSee && !plantTarget && m.aiType && m.aiType !== 'chaser' && m.type !== 'boss') {
        if (typeof CombatEnhancement !== 'undefined') CombatEnhancement.updateMonsterAI(m, dt);
        return;
      }
      if (canSee && plantTarget) {
        // 攻击植物
        const pa = Math.atan2(plantTarget.y - m.y, plantTarget.x - m.x);
        m.facing = pa;
        if (plantDist > m.attackRange) {
          m.state = 'move';
          this.moveEntityWithCollisions(m, Math.cos(pa) * m.speed * slowMul * dt, Math.sin(pa) * m.speed * slowMul * dt);
        } else if (m.attackCd <= 0) {
          m.attackCd = m.attackCooldown;
          m.windupT = 0.35; m.windupDur = 0.35; m.windupAngle = pa; m.windupKind = 'melee'; m.windupTarget = 'plant'; m.windupPlant = plantTarget;
          m.state = 'windup';
        } else {
          m.state = 'idle';
        }
      } else if (canSee && m.type === 'boss' && m.castState && m.castState !== 'idle') {
        // v5.1 Boss 施法/冲锋/连招期间由 V5 Boss 状态机接管，通用 AI 停手
        m.state = 'idle';
        return;
      } else if (canSee && m.type === 'boss' && m.ranged) {
        // v5.1 纯远程 Boss 保持距离（风筝）
        const angle = Math.atan2(this.player.y - m.y, this.player.x - m.x);
        m.facing = angle;
        if (d < 250) {
          m.state = 'move';
          this.moveEntityWithCollisions(m, -Math.cos(angle) * m.speed * slowMul * dt, -Math.sin(angle) * m.speed * slowMul * dt);
        } else if (d > 460) {
          m.state = 'move';
          this.moveEntityWithCollisions(m, Math.cos(angle) * m.speed * slowMul * dt, Math.sin(angle) * m.speed * slowMul * dt);
        } else m.state = 'idle';
      } else if (canSee) {
        // 追击
        const angle = Math.atan2(this.player.y - m.y, this.player.x - m.x);
        m.facing = angle;
        if (d > m.attackRange) {
          m.state = 'move';
          this.moveEntityWithCollisions(m, Math.cos(angle) * m.speed * slowMul * dt, Math.sin(angle) * m.speed * slowMul * dt);
        } else if (m.attackCd <= 0) {
          m.attackCd = m.attackCooldown;
          let wdur = 0.35, wkind = 'melee';
          if (m.ranged) { wdur = 0.5; wkind = 'ranged'; }
          else if (m.aiType === 'bomber' || m.aiType === 'self_destruct' || m.type === 'bomber') { wdur = 1.2; wkind = 'bomb'; }
          else if (m.aiType === 'charger' || m.aiType === 'charge') { wdur = 0.6; wkind = 'melee'; }
          else if (m.type === 'boss') { wdur = 0.8; wkind = 'melee'; }
          m.windupT = wdur; m.windupDur = wdur; m.windupAngle = angle; m.windupKind = wkind; m.windupTarget = 'player';
          m.state = 'windup';
        } else {
          m.state = 'idle';
        }
      } else {
        // 游荡
        if (!m.wanderTarget || dist(m, m.wanderTarget) < 30) {
          m.wanderTarget = { x: m.x + rand(-200, 200), y: m.y + rand(-200, 200) };
        }
        const angle = Math.atan2(m.wanderTarget.y - m.y, m.wanderTarget.x - m.x);
        m.facing = angle;
        this.moveEntityWithCollisions(m, Math.cos(angle) * m.speed * 0.3 * slowMul * dt, Math.sin(angle) * m.speed * 0.3 * slowMul * dt);
      }
    });
  },
  processDeadMonsters() {
    // 移除死亡怪物
    this.monsters = this.monsters.filter(m => {
      if (m.hp <= 0) {
        if (m.deathProcessed) return m.deathTimer > 0;
        m.deathProcessed = true;
        m.deathTimer = .42;
        m.state = 'death';
        this.killCount++;
        if (this.runStats) {
          if (m.elite) this.runStats.eliteKills++;
          if (m.boss) this.runStats.bossKills++;
          if (this.player.hp / (this.player.maxHp || 100) < 0.25) this.runStats.clutchKills++;
        }
        this.spawnKillFeedback(m);
        this.spawnHitParticles(m.x, m.y, '#ff8868');
        if (typeof CombatEnhancement !== 'undefined') CombatEnhancement.onEliteDeath(m);
        if (window.V5) V5.onMonsterKilled(this, m);
        // 击杀掉落养分（普通+2 / 精英+8）
        const nutrientGain = m.elite ? CONFIG.nutrients.eliteKill : CONFIG.nutrients.normalKill;
        this.nutrient = Math.min(this.nutrientMax, this.nutrient + nutrientGain);
        this.damageNumbers.push({ x: m.x, y: m.y - 22, value: `+${nutrientGain}`, color: '#ffe28a', life: .6, maxLife: .6, vx: 0, vy: -42, heavy: false });
        if (m.type === 'boss') {
          this.spawnGroundLoot({ type: 'material', name: '首领核心', amount: 2 + this.map.tier, icon: '◆' }, m.x + 18, m.y);
          this.spawnGroundLoot({ type: 'gold', name: '首领赏金', amount: 150 * this.map.tier, icon: '💰' }, m.x - 18, m.y);
          showToast(`首领「${m.name}」已击败，撤离奖励提升`, 'success');
          if (typeof AchievementSystem !== 'undefined') AchievementSystem.trackEvent('boss', 't'+this.map.tier);
          // v5.1 Boss 不再掉落打造材料（材料改由农作物产出），改为稳定补给
          this.spawnGroundLoot({ type: 'consumable', name: '草药包扎包', amount: randInt(1, 2), icon: '💊', id: 'herb_kit' }, m.x, m.y+15);
          this.boss = null;
        }
        // v2.0 法杖Lv7 击杀小爆炸
        if (this.weapon && this.weapon.explosionOnKill) {
          [...this.monsters, ...this.raiders].forEach(o => {
            if (o === m || o.hp <= 0) return;
            if (dist(o, m) < 60) this.damageEnemy(o, this.weapon.damage * 0.8, '#c9a7e8', false, { quiet: true });
          });
          this.spawnImpact(m.x, m.y, '#c9a7e8', 1.3);
        }
        // v2.0 法杖Lv10 瘟疫：带毒标记的怪死亡释放毒雾
        if (m.plagueMark) {
          [...this.monsters, ...this.raiders].forEach(o => {
            if (o === m || o.hp <= 0) return;
            if (dist(o, m) < 80) {
              this.applyBurn(o, 12, 2.5);
              o.slow = Math.max(o.slow || 0, 0.4);
            }
          });
          this.spawnImpact(m.x, m.y, '#8a4ad8', 1.8);
        }
        // v1.0 击杀计数成就
        if (typeof AchievementSystem !== 'undefined') AchievementSystem.trackEvent('kill');
        // 掉落 v1.6 丰富
        if (Math.random() < 0.5) {
          this.spawnGroundLoot({ type: 'gold', name: '金币', amount: (m.gold || 5) + randInt(0, 5), icon: '💰' }, m.x, m.y);
        }
        // v5.1 打造材料只能从农作物获得，怪物只掉消耗品与金币
        const _mobSupply = (typeof DifficultySystem !== 'undefined' && DifficultySystem.get) ? (DifficultySystem.get().supplyMul || 1) : 1;
        const dropTable = [
          { type: 'consumable', name: '草药包', id: 'herb_kit', icon: '💊', weight: Math.min(0.9, 0.40 * _mobSupply) },
          { type: 'consumable', name: '信号弹', id: 'signal_flare', icon: '🔥', weight: 0.1 },
          { type: 'consumable', name: '荆棘狂潮', id: 'thorn_storm', icon: '🌵', weight: 0.08 }
        ];
        for (const d of dropTable) {
          if (Math.random() < d.weight) {
            this.spawnGroundLoot({ type: d.type, name: d.name, icon: d.icon, id: d.id, matId: d.matId, amount: d.amount||1 }, m.x + rand(-15,15), m.y + rand(-15,15));
          }
        }
        if (m.elite) {
          if (Math.random() < 0.5) this.spawnGroundLoot({ type: 'gold', name: '精英赏金', amount: randInt(30,80), icon: '💰' }, m.x, m.y-10);
          if (Math.random() < 0.5) this.spawnGroundLoot({ type: 'gold', name: '精英赏金', amount: randInt(20,50), icon: '💰' }, m.x+10, m.y+10);
        }
        // v1.0 精英/Boss 掉临时武器
        if (m.elite && Math.random() < 0.5 && typeof LoadoutSystem !== 'undefined') {
          const _base = CONFIG.weapons[Math.floor(Math.random() * 3)];
          const _tw = LoadoutSystem.rollTempWeapon(_base, this.map.tier);
          this.spawnGroundLoot({ type: 'weapon_drop', name: _tw.name, icon: '🔨', weapon: _tw }, m.x, m.y-15);
        }
        if (m.type !== 'boss' && Math.random() < 0.055) {
          this.spawnGroundLoot({ type: 'invincible', name: '无敌核心', amount: 1, icon: '🛡️', duration: 5 }, m.x, m.y);
        }
        // v3.1 极低概率掉特殊作物种子（精英/Boss 更高）
        const seedChance = m.elite ? 0.08 : (m.type === 'boss' ? 0.5 : 0.012);
        if (Math.random() < seedChance && CONFIG.wildPlants) {
          const pool = CONFIG.wildPlants.filter(w => w.tier <= this.map.tier);
          const wp = pool[Math.floor(Math.random() * pool.length)];
          if (wp) {
            this.spawnGroundLoot({ type: 'seed_pickup', name: wp.name + '种子', icon: wp.icon, seedId: wp.givesSeed, amount: 1 }, m.x, m.y);
            showToast(`🌟 稀有掉落：${wp.name}种子！拾取并撤离后解锁作物`, 'gold');
          }
        }
        return true;
      }
      return true;
    });
  },
  updateRaiders(dt) {
    const size = CONFIG.expedition.mapSize;
    // AI掠夺者
    this.raiders.forEach(r => {
      if (r.hp <= 0) return;
      r.attackCd = Math.max(0, r.attackCd - dt);
      r.stunned = Math.max(0, (r.stunned || 0) - dt);
      if (r.knockX || r.knockY) {
        r.x += (r.knockX || 0) * dt;
        r.y += (r.knockY || 0) * dt;
        const kd = Math.max(0, 1 - 9 * dt);
        r.knockX *= kd; r.knockY *= kd;
      }
      if (r.stunned > 0) return;
      const d = dist(r, this.player);

      if (d < 300 && this.player.stealth <= 0) {
        // 攻击玩家
        const angle = Math.atan2(this.player.y - r.y, this.player.x - r.x);
        if (d > 150) {
          r.x += Math.cos(angle) * r.speed * dt;
          r.y += Math.sin(angle) * r.speed * dt;
        } else if (r.attackCd <= 0) {
          r.attackCd = 1.5;
          const p = this.allocProjectile();
          Object.assign(p, {
            x: r.x, y: r.y,
            vx: Math.cos(angle) * 250, vy: Math.sin(angle) * 250,
            damage: r.damage, life: 2, fromMonster: true, radius: 6
          });
          p.hit = p.hit || []; p.hit.length = 0;
          this.projectiles.push(p);
        }
      } else {
        // 巡逻
        if (dist(r, r.patrolTarget) < 30) {
          r.patrolTarget = { x: rand(200, size-200), y: rand(200, size-200) };
        }
        const angle = Math.atan2(r.patrolTarget.y - r.y, r.patrolTarget.x - r.x);
        r.x += Math.cos(angle) * r.speed * 0.5 * dt;
        r.y += Math.sin(angle) * r.speed * 0.5 * dt;
      }
    });
    this.raiders = this.raiders.filter(r => {
      if (r.hp <= 0) {
        this.killCount++;
        showToast('击败掠夺者！战利品已掉落', 'gold');
        for (let i = 0; i < r.loot; i++) {
          this.spawnGroundLoot({ type: 'gold', name: '金币', amount: randInt(20, 50), icon: '💰' }, r.x, r.y);
        }
        return false;
      }
      return true;
    });
  },
  updateTowers(dt) {
    // 防御塔
    this.towers.forEach(t => {
      if (t.state === 'broken') return;
      t.attackCd = Math.max(0, t.attackCd - dt);
      if (t.attackCd > 0) return;

      if (t.state === 'player') {
        // 攻击怪物
        let nearest = null, minD = t.range;
        this.entitySpatialHash.queryCircle(t.x, t.y, t.range).forEach(m => {
          if (!this.monsters.includes(m)) return;
          const d = dist(t, m);
          if (d < minD) { minD = d; nearest = m; }
        });
        this.raiders.forEach(r => {
          const d = dist(t, r);
          if (d < minD) { minD = d; nearest = r; }
        });
        if (nearest) {
          this.damageEnemy(nearest, t.damage * (this.beastWave.active ? 2.15 : 1), '#8affb5', false, {
            x: t.x, y: t.y, angle: Math.atan2(nearest.y - t.y, nearest.x - t.x),
            weaponId: '', fromPlayer: false
          });
          t.attackCd = this.beastWave.active ? 0.42 : 0.72;
          const p = this.allocProjectile();
          Object.assign(p, {
            x: t.x, y: t.y,
            vx: (nearest.x - t.x) / minD * 400,
            vy: (nearest.y - t.y) / minD * 400,
            damage: 0, life: 0.3, fromTower: true, radius: 4, target: nearest
          });
          p.hit = p.hit || []; p.hit.length = 0;
          this.projectiles.push(p);
        }
      } else if (t.state === 'enemy') {
        // 攻击玩家
        if (dist(t, this.player) < t.range) {
          this.damagePlayer(t.damage, t.monsterType ? t : { monsterType: 'tower', name: '防御塔' });
          t.attackCd = 1.0;
        }
      }
    });
  },
  updateProjectiles(dt) {
    // 子弹：原地更新 + 空间哈希邻近命中（消灭全量遍历与每帧 filter 数组）
    {
      const arr = this.projectiles;
      const hash = this.entitySpatialHash;
      for (let i = arr.length - 1; i >= 0; i--) {
        const p = arr[i];
        // v2.0 飞刃Lv10 自动追踪
        if (p.autoAim && p.fromPlayer && !p._aimInit) {
          const near = this.nearestMonster(p.x, p.y, 600);
          if (near) {
            const a = Math.atan2(near.y - p.y, near.x - p.x);
            const sp = Math.hypot(p.vx, p.vy);
            p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp;
          }
          p._aimInit = true;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
        let dead = p.life <= 0;
        // v3.7 弹道打道具（油桶/木箱）
        if (!dead && p.fromPlayer && this.props) {
          for (const pr of this.props) {
            if ((pr.kind === 'barrel' || pr.kind === 'crate') && pr.hp > 0) {
              const dx = pr.x - p.x, dy = pr.y - p.y;
              const rr = pr.size/2 + p.radius;
              if (dx*dx + dy*dy <= rr*rr) {
                this.damageProp(pr, p.damage);
                dead = true;
                break;
              }
            }
          }
        }
        if (!dead && (p.fromPlayer || p.fromPlant)) {
          const candidates = hash.queryCircle(p.x, p.y, 56);
          for (let c = 0; c < candidates.length; c++) {
            const target = candidates[c];
            if (target.hp <= 0 || p.hit.includes(target)) continue;
            const ddx = target.x - p.x, ddy = target.y - p.y;
            const rr = target.radius + p.radius;
            if (ddx * ddx + ddy * ddy <= rr * rr) {
              // v2.0 豌豆Lv10 夺命豆：直接斩杀30%血以下小怪
              if (p.instantKillLow && !target.elite && target.type !== 'boss' && target.hp < target.maxHp * p.instantKillLow) {
                target.hp = 0; target.state = 'death'; target.stateTimer = 0.4;
              } else {
                this.damageEnemy(target, p.damage, p.color, p.weaponId === 'vine_staff', {
                  x: p.x, y: p.y,
                  angle: Math.atan2(p.vy, p.vx),
                  weaponId: p.weaponId || '',
                  fromPlayer: !!p.fromPlayer
                });
              }
              target.visualVz = Math.max(target.visualVz || 0, p.weaponId === 'vine_staff' ? 82 : 52);
              // v2.0 等级词条：燃烧/减速/定身
              if (p.burnDps) {
                const stack = Math.min(p.burnStack || 1, 3);
                this.applyBurn(target, p.burnDps * stack, 3);
              }
              if (p.slowOnHit) { target.slow = Math.max(target.slow || 0, p.slowOnHit); target.slowUntil = performance.now() + p.slowDur * 1000; }
              if (p.rootChance && Math.random() < p.rootChance) { target.stunned = Math.max(target.stunned || 0, p.rootDur); }
              // v2.0 法杖Lv10 瘟疫：怪死后毒雾
              if (p.plague) target.plagueMark = true;
              // v2.0 烈焰长弓Lv5 爆炸
              if (p.explode) {
                [...this.monsters, ...this.raiders].forEach(o => {
                  if (o === target || o.hp <= 0) return;
                  if (dist(o, target) < p.explode) this.damageEnemy(o, p.damage * 0.6, '#ffaa55', false, { quiet: true });
                });
                this.spawnImpact(target.x, target.y, '#ff8833', 1.6);
              }
              // v2.0 长弓Lv8 火箭雨：命中召3支落箭
              if (p.rainArrows) {
                for (let k = 0; k < p.rainArrows; k++) {
                  const rx = target.x + rand(-40, 40), ry = target.y + rand(-40, 40);
                  this.aoeTimers.push({ x: rx, y: ry, r: 55, delay: 0.35 + k * 0.12, dmg: p.damage * 0.5, color: '#ffcc55' });
                }
              }
              // v2.0 长弓Lv10 核爆
              if (p.nuke) {
                [...this.monsters, ...this.raiders].forEach(o => {
                  if (o.hp <= 0) return;
                  if (dist(o, target) < 120) this.damageEnemy(o, p.damage * 1.5, '#ff5522', false, { quiet: true });
                });
                this.spawnImpact(target.x, target.y, '#ff3300', 2.5);
              }
              p.hit.push(target);
              p.pierce--;
              if (p.weaponId === 'vine_staff') {
                target.stunned = Math.max(target.stunned || 0, 0.18);
                this.lightningChainFrom(target, p, p.hit, 2, 0.55);
              }
              if (p.pierce <= 0) { dead = true; break; }
              if (p.fromPlant) { dead = true; break; }
            }
          }
        }
        if (!dead && p.fromMonster) {
          const ddx = this.player.x - p.x, ddy = this.player.y - p.y;
          const rr = this.player.collisionRadius + p.radius;
          if (ddx * ddx + ddy * ddy <= rr * rr) {
            this.damagePlayer(p.damage, p.monsterType ? p : { monsterType: 'projectile', name: '敌方弹道' });
            dead = true;
          }
        }
        if (dead) {
          // v2.0 飞刃Lv5 弹道回旋：死前弹向最近敌人
          if (p.ricochet > 0 && p.fromPlayer) {
            const near = this.nearestMonster(p.x, p.y, 400);
            if (near) {
              const a = Math.atan2(near.y - p.y, near.x - p.x);
              const sp = Math.hypot(p.vx, p.vy);
              p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp;
              p.life = 0.35; p.ricochet--; p.hit.length = 0;
              dead = false;
            }
          }
        }
        if (dead) {
          arr[i] = arr[arr.length - 1];
          arr.pop();
          this.projectilePool.push(p);
        }
      }
    }
  },
  updateAoeTimers(dt) {
    // v2.0 长弓Lv8 延迟落箭（aoeTimers）
    if (this.aoeTimers) {
      for (let i = this.aoeTimers.length - 1; i >= 0; i--) {
        const t = this.aoeTimers[i];
        t.delay -= dt;
        if (t.delay <= 0) {
          [...this.monsters, ...this.raiders].forEach(o => {
            if (o.hp <= 0) return;
            if (dist(o, t) < t.r) this.damageEnemy(o, t.dmg, t.color, false, { quiet: true });
          });
          this.spawnImpact(t.x, t.y, t.color, 1.2);
          this.aoeTimers.splice(i, 1);
        }
      }
    }
  },
  updateExtraction(dt) {
    // 撤离读条
    if (this.extracting) {
      // v5.4 撤离点清怪半径 40px：读条期间持续肃清圈内普通怪（Boss 不受影响）
      this._extractClearT = (this._extractClearT || 0) - dt;
      if (this._extractClearT <= 0) {
        this._extractClearT = 0.5;
        let _cx = this.player.x, _cy = this.player.y;
        if (this.extractType === 'fixed') {
          const _ep = this.extractPoints.find(ep => dist(this.player, ep) < ep.radius);
          if (_ep) { _cx = _ep.x; _cy = _ep.y; }
        }
        this.monsters.forEach(m => {
          if (m.hp > 0 && !m.boss && Math.hypot(m.x - _cx, m.y - _cy) < 40 + (m.radius || 14) * 0.5) {
            if (this.damageEnemy) this.damageEnemy(m, 200, '#9fe6ff', true);
            const _a = Math.atan2(m.y - _cy, m.x - _cx);
            if (this.moveEntityWithCollisions) this.moveEntityWithCollisions(m, Math.cos(_a) * 30, Math.sin(_a) * 30);
          }
        });
      }
      if (this.extractType === 'fixed') {
        const inPoint = this.extractPoints.some(ep => dist(this.player, ep) < ep.radius);
        if (!inPoint) { this.cancelExtract(); showToast('离开了撤离点，撤离取消', 'warning'); }
      }
      const extractTime = this.extractType === 'signal' ? CONFIG.expedition.signalExtractTime : CONFIG.expedition.extractTime;
      if (this.extractType === 'signal' && !this.signalReinforced && this.extractProgress >= extractTime * 0.5) {
        this.signalReinforced = true;
        this.spawnSignalAmbush(1);
      }
      this.extractProgress += dt;
      if (this.extractProgress >= extractTime) {
        this.completeExtract();
      }
    }
  },
});
