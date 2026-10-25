/* ============================================================
   地形 × 战斗深化层（2026-10-22）
   统一修正：攻方地形输出 / 守方地形承伤 / 元素 / 掩体 / 高低差 / 天气 / 难度 / 地形势
   状态：wet 潮湿 / rooted 陷足 / 暴露（高地实时）/ 地形势 momentum
   依赖：Expedition.prototype（expedition-core/terrain/world/combat/render 之后加载）
   ============================================================ */
(function () {
  'use strict';
  if (typeof Expedition === 'undefined' || !Expedition.prototype) return;
  const P = Expedition.prototype;
  const num = (v, d) => (Number.isFinite(v) ? v : d);

  function nowSec() { return performance.now() / 1000; }

  // 地形专精：角色/武器元素在对应地形获得额外加成（P2 卡牌/角色词条）
  const TERRAIN_AFFINITIES = [
    { element: 'fire', terrain: 'forest', name: '林地火势', icon: '🔥', mul: 1.15, hint: '火系在密林 +15% 伤害，并可点燃森林' },
    { element: 'fire', terrain: 'mud', name: '泥沼灼烧', icon: '🔥', mul: 1.08, hint: '火系在泥地 +8% 伤害' },
    { element: 'lightning', terrain: 'water', name: '水域导电', icon: '⚡', mul: 1.15, hint: '雷系在浅水 +15% 伤害' },
    { element: 'lightning', terrain: 'highland', name: '高地引雷', icon: '⚡', mul: 1.10, hint: '雷系在高地 +10% 伤害' },
    { element: 'poison', terrain: 'water', name: '水域淬毒', icon: '☠', mul: 1.08, hint: '毒系在浅水 +8% 伤害' },
    { element: 'poison', terrain: 'forest', name: '密林瘴气', icon: '☠', mul: 1.12, hint: '毒系在密林 +12% 伤害' },
    { mode: 'ranged', terrain: 'highland', name: '高地狙击', icon: '🎯', mul: 1.10, hint: '远程武器在高地 +10% 伤害' },
    { mode: 'melee', terrain: 'forest', name: '林间伏击', icon: '🗡', mul: 1.10, hint: '近战武器在密林 +10% 伤害' }
  ];

  Object.assign(P, {
    /* ---------------- 基础工具 ---------------- */
    _terrainNow() { return nowSec(); },

    terrainWeatherId() {
      const w = (this.weather && this.weather.state)
        || (typeof GameState !== 'undefined' && GameState.farmWeather && GameState.farmWeather.state)
        || (typeof GameState !== 'undefined' && GameState.weather) || 'clear';
      return w;
    },

    playerWeaponElement() {
      const id = this.weapon && this.weapon.id;
      if (id === 'flame_bow') return 'fire';
      if (id === 'vine_staff') return 'poison';
      return null;
    },

    playerAttackIsRanged() {
      const mode = this.weapon && this.weapon.mode;
      return mode === 'ranged' || mode === 'pierce';
    },

    playerTerrainAffinity(element, isRanged, terrainId) {
      const mode = isRanged ? 'ranged' : 'melee';
      return TERRAIN_AFFINITIES.find(a => a.terrain === terrainId
        && ((a.element && a.element === element) || (!a.element && a.mode === mode))) || null;
    },

    playerAffinityForCurrentTerrain() {
      const terr = this.getTerrainAt(this.player.x, this.player.y);
      return this.playerTerrainAffinity(this.playerWeaponElement(), this.playerAttackIsRanged(), terr.id);
    },

    terrainHeightNum(x, y) {
      const h = this.getHeightAt(x, y);
      return h === 'high' ? 1 : h === 'low' ? -1 : 0;
    },

    terrainDifficultyMul() {
      const id = (typeof GameState !== 'undefined' && GameState.difficulty) || 'normal';
      return { casual: 0.6, normal: 1, hard: 1.25, nightmare: 1.4 }[id] || 1;
    },

    terrainScale(v) {
      const m = this.terrainDifficultyMul();
      return 1 + (v - 1) * m;
    },

    terrainCoverBetween(a, b) {
      if (!a || !b || !this.terrainBlocksProjectile) return false;
      if (!Number.isFinite(a.x) || !Number.isFinite(b.x)) return false;
      return !!this.terrainBlocksProjectile(a.x, a.y, b.x, b.y, 0);
    },

    /* ---------------- 状态 ---------------- */
    applyTerrainStatus(ent, key, dur, meta) {
      if (!ent) return;
      const t = nowSec();
      ent._tStatus = ent._tStatus || {};
      const cur = ent._tStatus[key];
      if (!cur || cur.until < t) ent._tStatus[key] = { until: t + dur, start: t, meta: meta || null };
      else cur.until = Math.max(cur.until, t + dur);
    },

    hasTerrainStatus(ent, key) {
      return !!(ent && ent._tStatus && ent._tStatus[key] && ent._tStatus[key].until > nowSec());
    },

    clearTerrainStatus(ent, key) {
      if (ent && ent._tStatus) delete ent._tStatus[key];
    },

    terrainStatusList(ent) {
      const out = [];
      if (!ent || !ent._tStatus) return out;
      const t = nowSec();
      Object.keys(ent._tStatus).forEach((k) => {
        const st = ent._tStatus[k];
        if (!st || st.until <= t) return;
        const meta = { wet: { icon: '💧', label: '潮湿', color: '#7cc7e8' }, rooted: { icon: '🌀', label: '陷足', color: '#b99a5a' } }[k]
          || { icon: '•', label: k, color: '#c8c1a8' };
        out.push({ key: k, left: Math.max(0, st.until - t), ...meta });
      });
      return out;
    },

    /* ---------------- 统一战斗修正 ---------------- */
    terrainCombatContext(attacker, defender, hitInfo) {
      const info = hitInfo || {};
      const atk = attacker && Number.isFinite(attacker.x) ? this.getTerrainAt(attacker.x, attacker.y) : null;
      const def = defender && Number.isFinite(defender.x) ? this.getTerrainAt(defender.x, defender.y) : null;
      let element = info.element || (info.weaponId === 'flame_bow' ? 'fire' : null);
      if (!element && info.fromPlayer) element = this.playerWeaponElement ? this.playerWeaponElement() : null;
      const isRanged = !!(info.ranged || info.fromProjectile || info.fromTower
        || (info.fromPlayer && this.weapon && (this.weapon.mode === 'ranged' || this.weapon.mode === 'pierce'))
        || (info.weaponId && this.weapon && this.weapon.mode === 'ranged' && info.fromPlayer));

      let outMul = atk ? num(atk.dmgOutMul, 1) * (isRanged ? num(atk.rangedOut, 1) : num(atk.meleeOut, 1)) : 1;
      let inMul = def ? num(def.dmgInMul, 1) : 1;

      if (atk && element && atk.elementOut && num(atk.elementOut[element], 0) > 0) outMul *= atk.elementOut[element];
      if (def && element && def.elementIn && num(def.elementIn[element], 0) > 0) inMul *= def.elementIn[element];

      // 潮湿状态：受雷 +10% / 受火 -10%
      if (defender && this.hasTerrainStatus(defender, 'wet')) {
        if (element === 'lightning') inMul *= 1.10;
        else if (element === 'fire') inMul *= 0.90;
      }

      // 方向性掩体：远程攻击被残墙/树/岩石挡住 → 守方减伤 35%
      let cover = false;
      if (isRanged && attacker && defender && this.terrainCoverBetween(attacker, defender)) {
        cover = true;
        inMul *= 0.65;
      }
      // AOE 在废墟减伤 15%
      if (info.aoe && def && def.id === 'ruins') inMul *= 0.85;

      // 高低差：高打低 +10%，低打高 -10%
      let heightDiff = 0;
      if (attacker && defender) {
        heightDiff = this.terrainHeightNum(attacker.x, attacker.y) - this.terrainHeightNum(defender.x, defender.y);
        if (heightDiff > 0) outMul *= 1.10;
        else if (heightDiff < 0) outMul *= 0.90;
      }

      // 天气 × 地形
      const w = this.terrainWeatherId();
      if (w === 'rain' || w === 'heavy_rain' || w === 'storm') {
        if (def && def.id === 'water' && element === 'lightning') inMul *= 1.10;
        if (def && def.id === 'mud') inMul *= 0.95;
      } else if (w === 'clear' || w === 'sunny') {
        if (element === 'fire') outMul *= 1.08;
      } else if (w === 'fog' && isRanged) {
        outMul *= 0.95;
      }

      // 地形势（玩家在有利地形站桩积累）
      if (info.fromPlayer && this.terrainMomentum > 0) outMul *= (1 + 0.03 * Math.min(3, this.terrainMomentum));

      // 地形专精（仅按玩家武器/攻击方式的专精，不因技能元素临时获得）
      let affinity = null;
      if (info.fromPlayer && atk) {
        const _specElement = this.playerWeaponElement ? this.playerWeaponElement() : null;
        const _specRanged = this.playerAttackIsRanged ? this.playerAttackIsRanged() : isRanged;
        affinity = this.playerTerrainAffinity(_specElement, _specRanged, atk.id);
        if (affinity) {
          outMul *= this.terrainScale(affinity.mul);
          this._lastAffinity = affinity;
        } else this._lastAffinity = null;
      }

      // 难度缩放 + 封顶
      outMul = Math.max(0.55, Math.min(1.45, this.terrainScale(outMul)));
      inMul = Math.max(0.55, Math.min(1.45, this.terrainScale(inMul)));

      return {
        atkTerrain: atk ? atk.id : null,
        defTerrain: def ? def.id : null,
        outMul: outMul,
        inMul: inMul,
        critAdd: (atk ? num(atk.critAdd, 0) : 0) + (def ? num(def.critTakenAdd, 0) : 0),
        cover: cover,
        heightDiff: heightDiff,
        element: element,
        isRanged: isRanged,
        weather: w,
        affinity: affinity
      };
    },

    /* ---------------- 障碍破坏 ---------------- */
    damageObstacle(obstacle, amount, info) {
      if (!obstacle || !obstacle.destructible || obstacle.destroyed) return;
      obstacle.hp = (obstacle.hp || 0) - Math.max(0, amount);
      if (obstacle.hp > 0) {
        this.spawnHitParticles(obstacle.x, obstacle.y, obstacle.type === 'tree' ? '#8a6a3a' : obstacle.type === 'ruin' ? '#a89a80' : '#9a9a90');
        return;
      }
      obstacle.hp = 0;
      obstacle.destroyed = true;
      this.obstacles = (this.obstacles || []).filter(o => o !== obstacle);
      this.obstaclesByY = (this.obstaclesByY || []).filter(o => o !== obstacle);
      if (this.obstacleSpatialHash) this.obstacleSpatialHash.rebuild(this.obstacles);
      this.spawnAoeEffect(obstacle.x, obstacle.y, 40, obstacle.type === 'tree' ? '#a8863f' : '#bbb2a0');
      this.spawnShockRing(obstacle.x, obstacle.y, '#e8dfc8', 34);
      this.pushCombatFeedback('掩体破坏', '#ffd9a0', obstacle.x, obstacle.y - 30, 0.8);
      this._terrainCoverDirty = true;
    },

    _damageObstaclesNear(x, y, radius, amount, info) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      (this.obstacles || []).forEach((o) => {
        if (!o || !o.destructible || o.destroyed) return;
        const d = Math.hypot(o.x - x, o.y - y);
        if (d > radius) return;
        const isFire = info && info.element === 'fire';
        this.damageObstacle(o, amount * (isFire ? 1.0 : 0.6), info);
      });
    },

    /* ---------------- 地形状态 tick ---------------- */
    tickPlayerTerrain(dt) {
      const pl = this.player;
      if (!pl) return;
      const terr = this.getTerrainAt(pl.x, pl.y);
      const t = nowSec();

      // 状态过期
      if (pl._tStatus) {
        Object.keys(pl._tStatus).forEach((k) => { if (!pl._tStatus[k] || pl._tStatus[k].until <= t) delete pl._tStatus[k]; });
      }

      // 进入新地形：提示 + 进入状态
      if (this._lastPlayerTerrain !== terr.id) {
        this._lastPlayerTerrain = terr.id;
        this.pushCombatFeedback(terr.name, this._terrainHintColor(terr.id), pl.x, pl.y - 42, 0.9);
        if (terr.statusOnEnter) this.applyTerrainStatus(pl, terr.statusOnEnter.key, terr.statusOnEnter.dur);
      }
      if (terr.id === 'water') this.applyTerrainStatus(pl, 'wet', 1.5);
      if (terr.id === 'mud' && this._lastPlayerTerrain !== 'mud') this.applyTerrainStatus(pl, 'rooted', 1.0);

      // 地形势：在战术地形上站桩积累（高地/废墟/密林）
      const tactical = terr.id === 'highland' || terr.id === 'ruins' || terr.id === 'forest';
      const speed = Math.hypot(pl.vx || 0, pl.vy || 0);
      if (tactical && speed < 45) this.terrainMomentum = Math.min(3, (this.terrainMomentum || 0) + dt / 1.5);
      else this.terrainMomentum = Math.max(0, (this.terrainMomentum || 0) - dt * 1.2);
    },

    _terrainHintColor(id) {
      return { grass: '#cfe6a0', water: '#7cc7e8', mud: '#b99a5a', forest: '#8ec47a', ruins: '#c8c1a8', highland: '#ffd9a0' }[id] || '#e8dfc8';
    },

    tickMonsterTerrain(dt) {
      const t = nowSec();
      (this.monsters || []).forEach((m) => {
        if (!m || m.hp <= 0) return;
        if (m._tStatus) Object.keys(m._tStatus).forEach((k) => { if (!m._tStatus[k] || m._tStatus[k].until <= t) delete m._tStatus[k]; });
        const terr = this.getTerrainAt(m.x, m.y);
        if (terr.id === 'water') this.applyTerrainStatus(m, 'wet', 1.2);
        if (terr.id === 'mud' && m._lastTerr !== 'mud') this.applyTerrainStatus(m, 'rooted', 0.8);
        m._lastTerr = terr.id;
        // 野兽在密林回血（地形生物亲和）
        if (terr.id === 'forest' && (m.type === 'wolf' || m.type === 'spider' || m.type === 'bat' || m.type === 'boar')) {
          m.hp = Math.min(m.maxHp, m.hp + 1.2 * dt);
        }
        // 重甲单位在泥地额外减速
        if (terr.id === 'mud' && (m.armor || m.type === 'boar' || m.type === 'boss')) {
          m._terrainSlow = 0.85;
        } else m._terrainSlow = 1;
      });
    },

    /* ---------------- 怪物地形走位 ---------------- */
    terrainSteerMonsters(dt) {
      const highlands = (this.terrainRegions || []).filter(r => r.type === 'highland');
      const regions = this.terrainRegions || [];
      (this.monsters || []).forEach((m) => {
        if (!m || m.hp <= 0 || m.stunned > 0) return;
        const d = dist(m, this.player);
        const terr = this.getTerrainAt(m.x, m.y);
        // 远程怪：优先占据高地（射程/视野优势）
        if (m.ranged && terr.id !== 'highland' && d > 230 && d < 520 && highlands.length) {
          let best = null, bd = 1e9;
          highlands.forEach((r) => { const dd = Math.hypot(r.x - m.x, r.y - m.y); if (dd < bd) { bd = dd; best = r; } });
          if (best && bd < 520) {
            const a = Math.atan2(best.y - m.y, best.x - m.x);
            this.moveEntityWithCollisions(m, Math.cos(a) * m.speed * 0.35 * dt, Math.sin(a) * m.speed * 0.35 * dt);
          }
        }
        // 重甲单位：尝试离开泥地
        if ((m.armor || m.type === 'boar') && terr.id === 'mud') {
          let bestA = null, bestScore = -1;
          for (let i = 0; i < 8; i++) {
            const a = i * Math.PI / 4;
            const nx = m.x + Math.cos(a) * 70, ny = m.y + Math.sin(a) * 70;
            const nt = this.getTerrainAt(nx, ny);
            const score = nt.id === 'mud' ? 0 : (nt.id === 'grass' ? 2 : 1);
            if (score > bestScore) { bestScore = score; bestA = a; }
          }
          if (bestA !== null && bestScore > 0) {
            this.moveEntityWithCollisions(m, Math.cos(bestA) * m.speed * 0.4 * dt, Math.sin(bestA) * m.speed * 0.4 * dt);
          }
        }
      });
    },

    /* ---------------- HUD：地形条 ---------------- */
    terrainHudMarkup() {
      const terr = this.getTerrainAt(this.player.x, this.player.y);
      const r = terr;
      const pct = (v) => (v >= 1 ? '+' : '') + Math.round((v - 1) * 100) + '%';
      const chips = [];
      if (num(r.moveMul, 1) < 1) chips.push('<span class="tc-chip tc-move">位移 ' + pct(r.moveMul) + '</span>');
      if (num(r.visionMul, 1) !== 1) chips.push('<span class="tc-chip">视野 ' + pct(r.visionMul) + '</span>');
      if (num(r.rangeMul, 1) !== 1) chips.push('<span class="tc-chip">射程 ' + pct(r.rangeMul) + '</span>');
      if (num(r.meleeOut, 1) !== 1 || num(r.rangedOut, 1) !== 1) {
        const parts = [];
        if (num(r.meleeOut, 1) !== 1) parts.push('近战 ' + pct(r.meleeOut));
        if (num(r.rangedOut, 1) !== 1) parts.push('远程 ' + pct(r.rangedOut));
        chips.push('<span class="tc-chip tc-out">输出 ' + parts.join(' / ') + '</span>');
      }
      if (num(r.dmgInMul, 1) !== 1 || num(r.critTakenAdd, 0)) {
        const parts = [];
        if (num(r.dmgInMul, 1) !== 1) parts.push(pct(r.dmgInMul));
        if (r.critTakenAdd) parts.push('被暴击 +' + Math.round(r.critTakenAdd * 100) + '%');
        chips.push('<span class="tc-chip tc-in">承伤 ' + parts.join(' · ') + '</span>');
      }
      if (num(r.critAdd, 0)) chips.push('<span class="tc-chip tc-out">暴击 +' + Math.round(r.critAdd * 100) + '%</span>');
      if (terr.id === 'ruins') chips.push('<span class="tc-chip">贴残墙：远程减伤 35%</span>');
      const aff = this.playerAffinityForCurrentTerrain();
      if (aff) chips.push('<span class="tc-chip tc-affinity" title="' + aff.hint + '">' + aff.icon + ' ' + aff.name + ' ' + pct(aff.mul) + '</span>');
      const statuses = this.terrainStatusList(this.player).map(s => '<span class="tc-status" style="--c:' + s.color + '">' + s.icon + ' ' + s.label + '</span>');
      const momentum = (this.terrainMomentum || 0) >= 0.5 ? '<span class="tc-momentum">⚡ 地形势 ×' + Math.min(3, Math.floor(this.terrainMomentum)) + '</span>' : '';
      const w = this.terrainWeatherId();
      const wName = { clear: '', cloud: '阴', rain: '雨', heavy_rain: '暴雨', storm: '雷暴', fog: '雾', snow: '雪' }[w] || '';
      return '<div id="terrainCombatHud" class="terrain-combat-hud" title="' + r.hint + '">'
        + '<span class="tc-chip tc-terrain" style="--c:' + this._terrainHintColor(terr.id) + '">📍 ' + r.name + '</span>'
        + chips.join('') + statuses.join('') + momentum
        + (wName ? '<span class="tc-chip">🌦 ' + wName + '</span>' : '')
        + '</div>';
    },

    appendTerrainHud() {
      const panel = document.getElementById('missionHud');
      if (!panel) return;
      const old = document.getElementById('terrainCombatHud');
      if (old) old.remove();
      const wrap = document.createElement('div');
      wrap.innerHTML = this.terrainHudMarkup();
      if (!wrap.firstChild) return;
      // 插到地形名（mission-label）之后，保证在 112px 高度内优先可见
      const label = panel.querySelector('.mission-label');
      if (label && label.nextSibling) panel.insertBefore(wrap.firstChild, label.nextSibling);
      else if (label) panel.appendChild(wrap.firstChild);
      else panel.insertBefore(wrap.firstChild, panel.firstChild);
    },

    /* ---------------- 命中预览 ---------------- */
    terrainAimTarget() {
      if (!this.weapon) return null;
      const range = (this.weapon.range || 90) * 1.2;
      const facing = this.player.facing || 0;
      let best = null, bd = 1e9;
      [...(this.monsters || []), ...(this.raiders || [])].forEach((m) => {
        if (!m || m.hp <= 0) return;
        const d = dist(this.player, m);
        if (d > range || d > bd) return;
        const a = Math.atan2(m.y - this.player.y, m.x - this.player.x);
        let diff = Math.abs(a - facing);
        while (diff > Math.PI) diff = Math.abs(diff - Math.PI * 2);
        if (diff > 0.45) return;
        best = m; bd = d;
      });
      return best;
    },

    terrainPreviewDamage(target) {
      if (!target || !this.weapon) return null;
      const ctx = this.terrainCombatContext(this.player, target, {
        fromPlayer: true,
        ranged: this.weapon.mode === 'ranged',
        weaponId: this.weapon.id
      });
      const base = this.weapon.damage || 10;
      const critChance = 0.20 + (this.weapon.critChanceBonus || 0);
      const expected = base * ctx.outMul * ctx.inMul * (1 + critChance * 0.8);
      return { value: Math.round(expected), base: Math.round(base), ctx: ctx };
    },

    drawTerrainPreview(ctx, cam) {
      const target = this.terrainAimTarget();
      if (!target) { this._terrainPreview = null; return; }
      const pv = this.terrainPreviewDamage(target);
      if (!pv) return;
      const sx = target.x - cam.x, sy = target.y - cam.y - (target.radius || 20) - 34;
      const up = pv.value > pv.base;
      const down = pv.value < pv.base;
      const color = up ? '#ffd76a' : down ? '#9fb3c8' : '#e8dfc8';
      ctx.save();
      ctx.font = 'bold 13px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      const label = '≈' + pv.value;
      const w = ctx.measureText(label).width;
      ctx.fillRect(sx - w / 2 - 5, sy - 13, w + 10, 17);
      ctx.fillStyle = color;
      ctx.fillText(label, sx, sy);
      const mark = (up ? '▲' : down ? '▼' : '·') + (pv.ctx.defTerrain ? ' ' + (this.getTerrainAt(target.x, target.y).name) : '');
      ctx.font = '10px "Microsoft YaHei", sans-serif';
      ctx.fillStyle = 'rgba(232,223,200,.75)';
      ctx.fillText(mark, sx, sy + 12);
      ctx.restore();
      this._terrainPreview = pv;
    }
  });

  /* ================= 包装现有战斗函数（不重写原逻辑） ================= */
  const _origDamageEnemy = P.damageEnemy;
  if (_origDamageEnemy) {
    P.damageEnemy = function (target, amount, color, heavy, hitInfo) {
      if (target && target.hp > 0 && Number.isFinite(amount) && amount > 0) {
        const info = hitInfo || {};
        let atkPos = null;
        if (info.fromPlayer) atkPos = this.player;
        else if (info.fromPlant) atkPos = this._activePlant || (Number.isFinite(info.x) ? { x: info.x, y: info.y } : null);
        else if (Number.isFinite(info.x) && Number.isFinite(info.y)) atkPos = { x: info.x, y: info.y };
        const tctx = this.terrainCombatContext(atkPos, target, info);
        amount *= tctx.outMul * tctx.inMul;
        this._terrainCritBonus = tctx.critAdd;
        this._lastTerrainCtx = tctx;
        // 火攻点燃森林（敌我同伤风险）
        if (tctx.element === 'fire' && this.getTerrainAt(target.x, target.y).id === 'forest' && !info.quiet && Math.random() < 0.15) {
          this.applyBurn(target, Math.max(12, amount * 0.25), 2.5);
        }
        // AOE / 火焰摧毁掩体
        if ((info.aoe || tctx.element === 'fire') && Number.isFinite(info.x || target.x)) {
          this._damageObstaclesNear(Number.isFinite(info.x) ? info.x : target.x, Number.isFinite(info.y) ? info.y : target.y, info.aoe ? 90 : 42, amount, info);
        }
      } else {
        this._terrainCritBonus = 0;
      }
      return _origDamageEnemy.call(this, target, amount, color, heavy, hitInfo);
    };
  }

  const _origDamagePlayer = P.damagePlayer;
  if (_origDamagePlayer) {
    P.damagePlayer = function (amount, source) {
      if (Number.isFinite(amount) && amount > 0 && this.player && this.player.hp > 0) {
        const src = (source && Number.isFinite(source.x)) ? source : null;
        const isRanged = !!(source && (source.fromProjectile || source.ranged || source.type === 'tower' || source.monsterType === 'projectile' || source.name === '防御塔'));
        const tctx = this.terrainCombatContext(src, this.player, { ranged: isRanged, element: source && source.element, aoe: !!(source && source.aoe) });
        amount *= tctx.inMul;
        if (src) amount *= tctx.outMul;
        this._lastDefTerrainCtx = tctx;
        this.terrainMomentum = 0;
      }
      return _origDamagePlayer.call(this, amount, source);
    };
  }

  const _origUpdatePlayer = P.updatePlayer;
  if (_origUpdatePlayer) {
    P.updatePlayer = function (dt) {
      this.tickPlayerTerrain(dt);
      return _origUpdatePlayer.call(this, dt);
    };
  }

  const _origUpdateMonsters = P.updateMonsters;
  if (_origUpdateMonsters) {
    P.updateMonsters = function (dt) {
      this.tickMonsterTerrain(dt);
      const r = _origUpdateMonsters.call(this, dt);
      try { this.terrainSteerMonsters(dt); } catch (e) {}
      return r;
    };
  }

  const _origRenderMissionHUD = P.renderMissionHUD;
  if (_origRenderMissionHUD) {
    P.renderMissionHUD = function () {
      _origRenderMissionHUD.call(this);
      try { this.appendTerrainHud(); } catch (e) {}
    };
  }

  const _origRenderDamageNumbers = P.renderDamageNumbers;
  if (_origRenderDamageNumbers) {
    P.renderDamageNumbers = function (ctx, cam) {
      _origRenderDamageNumbers.call(this, ctx, cam);
      try { this.drawTerrainPreview(ctx, cam); } catch (e) {}
    };
  }

  /* ================= 对外调试接口（自动化测试用） ================= */
  window.TerrainCombat = {
    context(exp, a, b, info) { return exp.terrainCombatContext(a, b, info || {}); },
    rules() { return Expedition.prototype.terrainRules; },
    hasStatus(exp, ent, key) { return exp.hasTerrainStatus(ent, key); },
    applyStatus(exp, ent, key, dur) { return exp.applyTerrainStatus(ent, key, dur); },
    affinity(exp) { return exp.playerAffinityForCurrentTerrain ? exp.playerAffinityForCurrentTerrain() : null; }
  };
  console.log('[TerrainCombat] 地形战斗层已加载');
})();
