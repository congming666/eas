// ================= v0.7.0 难度系统（网页版） =================
// 难度分级 + 每层关卡机制 + 高层词缀 + 玩家削弱 + Heat修改器
(function () {
  'use strict';

  // ===== 一、难度分级定义 =====
  const DIFFICULTIES = {
    casual: {
      id: 'casual', name: '休闲', icon: '🌱',
      hpMul: 0.7, dmgMul: 0.7,
      maxAffixes: 1, supplyMul: 1.3, torchMul: 0.5, rewardMul: 0.8,
      comboCap: 1.0, dodgeWindow: 200, dodgeCrit: true,
      ultBossDmg: 0.25, ultEliteDmg: 0.99, executeKill: true, envPlayerMul: 0.5
    },
    normal: {
      id: 'normal', name: '普通', icon: '⚔️',
      hpMul: 1.0, dmgMul: 1.0,
      maxAffixes: 2, supplyMul: 1.0, torchMul: 1.0, rewardMul: 1.0,
      comboCap: 0.6, dodgeWindow: 180, dodgeCrit: true,
      ultBossDmg: 0.25, ultEliteDmg: 0.99, executeKill: true, envPlayerMul: 0.5
    },
    hard: {
      id: 'hard', name: '困难', icon: '🔥',
      hpMul: 1.4, dmgMul: 1.3,
      maxAffixes: 2, supplyMul: 0.7, torchMul: 1.5, rewardMul: 1.5,
      comboCap: 0.4, dodgeWindow: 130, dodgeCrit: false, dodgeCritDmg: 1.5,
      ultBossDmg: 0.15, ultEliteDmg: 0.5, executeKill: false, executeDmg: 0.8, envPlayerMul: 1.0
    },
    nightmare: {
      id: 'nightmare', name: '噩梦', icon: '💀',
      hpMul: 2.0, dmgMul: 1.8,
      maxAffixes: 3, supplyMul: 0.4, torchMul: 2.0, rewardMul: 2.5,
      comboCap: 0.3, dodgeWindow: 100, dodgeCrit: false, dodgeCritDmg: 1.5,
      ultBossDmg: 0.15, ultEliteDmg: 0.5, executeKill: false, executeDmg: 0.8, envPlayerMul: 1.5
    }
  };

  // ===== 二、每层关卡专属机制（T1就有压力） =====
  const TIER_MECHANICS = {
    1: {
      name: '荒废野田', subtitle: '兽潮频发 · 夜间突袭',
      visionMul: 1.0,
      beastWaveInterval: 90, // 每90秒一波兽潮（比默认频繁）
      nightRaid: true, // 随机夜间突袭：视野-40%持续30秒
      nightRaidChance: 0.15, nightRaidDuration: 30,
      chargerUnlocked: true, // 冲锋野猪T1就出现
      eliteChanceBonus: 0,
      poisonDOT: false, rockfall: false, dark: false, miniBoss: false
    },
    2: {
      name: '废弃小农庄', subtitle: '常驻雾天 · 剧毒蔓延',
      visionMul: 0.7, // 常驻雾天视野-30%
      beastWaveInterval: 120,
      nightRaid: false,
      poisonDOT: true, // 毒属性怪攻击带持续伤害
      poisonDPS: 3, poisonDuration: 4,
      rangedUnlocked: true, healerUnlocked: true,
      poisonBarrelDensity: 2.0, // 毒气瓶密集
      eliteChanceBonus: 0.05,
      rockfall: false, dark: false, miniBoss: false
    },
    3: {
      name: '灾变农田', subtitle: '峡谷险地 · 落石无情',
      visionMul: 0.9,
      beastWaveInterval: 100,
      nightRaid: false,
      rockfall: true, // 落石陷阱每30秒随机触发
      rockfallInterval: 30, rockfallDamage: 30, rockfallRadius: 80,
      chargerDominant: true, bomberUnlocked: true,
      obstacleDensity: 1.5, // 障碍物多
      eliteChanceBonus: 0.1,
      poisonDOT: false, dark: false, miniBoss: false
    },
    4: {
      name: '古老谷场', subtitle: '永恒黑暗 · 深渊巡逻',
      visionMul: 0.5, // 黑暗视野-50%
      beastWaveInterval: 80,
      nightRaid: false,
      dark: true, torchMulExtra: 2.0, // 火把消耗×2
      miniBoss: true, // 小Boss巡逻
      miniBossCount: 1,
      allAITypes: true, eliteChanceBonus: 0.15,
      poisonDOT: false, rockfall: false
    }
  };

  // ===== 三、高层专属精英词缀 =====
  const ADVANCED_AFFIXES = {
    shield: { id: 'shield', name: '护盾', desc: '开场带30%最大血量护盾，护盾不破不进硬直', minTier: 3 },
    thorns: { id: 'thorns', name: '反弹', desc: '受到攻击反弹15%伤害给玩家', minTier: 3 },
    summoner: { id: 'summoner', name: '召唤', desc: '每10秒召唤2只小怪', minTier: 4 },
    immune: { id: 'immune', name: '免疫', desc: '免疫一种伤害类型，需切换武器', minTier: 4 }
  };

  // ===== 四、Heat修改器 =====
  const HEAT_MODIFIERS = {
    ironwall: { id: 'ironwall', name: '铁壁', desc: '所有怪物+50%血量', rewardBonus: 0.2, apply: (s) => { s.hpMulExtra = (s.hpMulExtra || 1) * 1.5; } },
    frenzy: { id: 'frenzy', name: '狂乱', desc: '所有怪物+30%攻速', rewardBonus: 0.25, apply: (s) => { s.speedMulExtra = (s.speedMulExtra || 1) * 1.3; } },
    darkness: { id: 'darkness', name: '黑暗', desc: '视野永久-30%', rewardBonus: 0.15, apply: (s) => { s.visionMulExtra = (s.visionMulExtra || 1) * 0.7; } },
    barren: { id: 'barren', name: '贫瘠', desc: '补给掉落-50%', rewardBonus: 0.3, apply: (s) => { s.supplyMulExtra = (s.supplyMulExtra || 1) * 0.5; } },
    headless: { id: 'headless', name: '无头', desc: '禁用怒气超杀', rewardBonus: 0.5, apply: (s) => { s.ultDisabled = true; } }
  };

  // ===== 运行时状态 =====
  let _current = {
    difficulty: 'normal',
    heat: [], // 启用的heat id数组
    tier: 1,
    // 计算后的运行时参数
    hpMul: 1.0, dmgMul: 1.0, speedMulExtra: 1.0,
    maxAffixes: 2, supplyMul: 1.0, torchMul: 1.0, rewardMul: 1.0,
    comboCap: 0.6, dodgeWindow: 200, dodgeCrit: true, dodgeCritDmg: 2.0,
    ultBossDmg: 0.25, ultEliteDmg: 0.99, executeKill: true, executeDmg: 1.0, envPlayerMul: 0.5,
    visionMul: 1.0, ultDisabled: false,
    nightRaidActive: false, nightRaidTimer: 0, nightRaidCooldown: 0,
    rockfallTimer: 30, poisonTickTimer: 0
  };

  function applyDifficulty(diffId, heatIds, tier) {
    const d = DIFFICULTIES[diffId] || DIFFICULTIES.normal;
    const m = TIER_MECHANICS[tier] || TIER_MECHANICS[1];
    const s = _current;
    s.difficulty = diffId; s.heat = heatIds || []; s.tier = tier;
    // 基础难度参数
    s.hpMul = d.hpMul; s.dmgMul = d.dmgMul;
    s.maxAffixes = d.maxAffixes; s.supplyMul = d.supplyMul;
    s.torchMul = d.torchMul * (m.torchMulExtra || 1);
    s.rewardMul = d.rewardMul;
    s.comboCap = d.comboCap; s.dodgeWindow = d.dodgeWindow;
    s.dodgeCrit = d.dodgeCrit; s.dodgeCritDmg = d.dodgeCritDmg || 2.0;
    s.ultBossDmg = d.ultBossDmg; s.ultEliteDmg = d.ultEliteDmg;
    s.executeKill = d.executeKill; s.executeDmg = d.executeDmg || 1.0;
    s.envPlayerMul = d.envPlayerMul;
    s.visionMul = m.visionMul;
    s.ultDisabled = false;
    s.speedMulExtra = 1.0; s.hpMulExtra = 1.0; s.visionMulExtra = 1.0; s.supplyMulExtra = 1.0;
    // Heat叠加
    (heatIds || []).forEach(id => {
      const h = HEAT_MODIFIERS[id];
      if (h && h.apply) h.apply(s);
    });
    // 最终计算
    s.hpMul *= s.hpMulExtra;
    s.supplyMul *= s.supplyMulExtra;
    s.visionMul *= s.visionMulExtra;
    s.nightRaidActive = false; s.nightRaidTimer = 0; s.nightRaidCooldown = 60;
    s.rockfallTimer = m.rockfallInterval || 30; s.poisonTickTimer = 0;
    return s;
  }

  function get() { return _current; }
  function getDifficulty(id) { return DIFFICULTIES[id] || DIFFICULTIES.normal; }
  function getTierMechanic(tier) { return TIER_MECHANICS[tier] || TIER_MECHANICS[1]; }
  function getHeatModifier(id) { return HEAT_MODIFIERS[id]; }
  function getAllDifficulties() { return Object.values(DIFFICULTIES); }
  function getAllHeat() { return Object.values(HEAT_MODIFIERS); }
  function getAdvancedAffixes(tier) { return Object.values(ADVANCED_AFFIXES).filter(a => a.minTier <= tier); }
  function getHeatRewardMultiplier() {
    let mul = 1.0;
    _current.heat.forEach(id => { const h = HEAT_MODIFIERS[id]; if (h) mul += h.rewardBonus; });
    return mul;
  }

  // 每层机制tick（由expedition.update调用）
  function tick(dt, exp) {
    const s = _current; const m = TIER_MECHANICS[s.tier];
    if (!m) return;
    // T1 夜间突袭
    if (m.nightRaid) {
      if (s.nightRaidActive) {
        s.nightRaidTimer -= dt;
        if (s.nightRaidTimer <= 0) { s.nightRaidActive = false; s.nightRaidCooldown = 60; }
      } else {
        s.nightRaidCooldown -= dt;
        if (s.nightRaidCooldown <= 0 && Math.random() < m.nightRaidChance * dt * 10) {
          s.nightRaidActive = true; s.nightRaidTimer = m.nightRaidDuration;
          if (typeof showToast === 'function') showToast('⚠️ 夜间突袭！视野缩小', 'warning');
        }
      }
    }
    // T3 落石
    if (m.rockfall) {
      s.rockfallTimer -= dt;
      if (s.rockfallTimer <= 0) {
        s.rockfallTimer = m.rockfallInterval;
        if (exp && exp.player) {
          const px = exp.player.x + (Math.random() - 0.5) * 300;
          const py = exp.player.y + (Math.random() - 0.5) * 300;
          // 对范围内玩家和怪物造成伤害
          if (typeof exp.damagePlayer === 'function' && Math.hypot(exp.player.x - px, exp.player.y - py) < m.rockfallRadius) {
            exp.damagePlayer(m.rockfallDamage);
          }
          exp.monsters.forEach(mon => {
            if (mon.hp > 0 && Math.hypot(mon.x - px, mon.y - py) < m.rockfallRadius) {
              if (typeof exp.damageEnemy === 'function') exp.damageEnemy(mon, m.rockfallDamage, '#888888', true);
            }
          });
          if (typeof showToast === 'function') showToast('🪨 落石！', 'warning');
        }
      }
    }
  }

  function getEffectiveVision() {
    const s = _current; const m = TIER_MECHANICS[s.tier];
    let v = s.visionMul;
    if (m && m.nightRaid && s.nightRaidActive) v *= 0.6;
    return v;
  }

  // 毒DOT处理
  function applyPoison(mon, exp) {
    const m = TIER_MECHANICS[_current.tier];
    if (!m || !m.poisonDOT || !exp || !exp.player) return;
    exp.player.poisoned = true;
    exp.player.poisonTimer = m.poisonDuration;
    exp.player.poisonDPS = m.poisonDPS;
  }

  function tickPoison(dt, exp) {
    if (!exp || !exp.player || !exp.player.poisoned) return;
    exp.player.poisonTimer -= dt;
    _current.poisonTickTimer -= dt;
    if (_current.poisonTickTimer <= 0) {
      _current.poisonTickTimer = 1;
      if (typeof exp.damagePlayer === 'function') exp.damagePlayer(exp.player.poisonDPS || 3);
    }
    if (exp.player.poisonTimer <= 0) exp.player.poisoned = false;
  }

  // ===== UI 渲染 =====
  function renderDifficultySelect() {
    const el = document.getElementById('difficultySelect');
    if (!el) return;
    el.innerHTML = '';
    Object.values(DIFFICULTIES).forEach(d => {
      const btn = document.createElement('div');
      btn.className = 'diff-btn' + (GameState.difficulty === d.id ? ' active' : '');
      btn.innerHTML = `<span class="diff-icon">${d.icon}</span><span class="diff-name">${d.name}</span><span style="font-size:9px;opacity:0.7;">怪×${d.hpMul} 伤×${d.dmgMul}</span>`;
      btn.onclick = () => { GameState.difficulty = d.id; renderDifficultySelect(); if (typeof SaveSystem !== 'undefined') SaveSystem.save(); };
      el.appendChild(btn);
    });
  }
  function renderHeatSelect() {
    const el = document.getElementById('heatSelect');
    if (!el) return;
    el.innerHTML = '';
    Object.values(HEAT_MODIFIERS).forEach(h => {
      const active = (GameState.heatModifiers || []).includes(h.id);
      const item = document.createElement('label');
      item.className = 'heat-item' + (active ? ' active' : '');
      item.innerHTML = `<input type="checkbox" ${active ? 'checked' : ''}> <span>${h.name}</span> <span style="opacity:0.6;">${h.desc}</span> <span style="margin-left:auto;color:#ffd700;">+${Math.round(h.rewardBonus*100)}%</span>`;
      item.querySelector('input').onchange = (e) => {
        if (!GameState.heatModifiers) GameState.heatModifiers = [];
        if (e.target.checked) { if (!GameState.heatModifiers.includes(h.id)) GameState.heatModifiers.push(h.id); }
        else { GameState.heatModifiers = GameState.heatModifiers.filter(id => id !== h.id); }
        renderHeatSelect();
        if (typeof SaveSystem !== 'undefined') SaveSystem.save();
      };
      el.appendChild(item);
    });
  }

  // 暴露全局
  window.DifficultySystem = {
    DIFFICULTIES, TIER_MECHANICS, ADVANCED_AFFIXES, HEAT_MODIFIERS,
    applyDifficulty, get, getDifficulty, getTierMechanic, getHeatModifier,
    getAllDifficulties, getAllHeat, getAdvancedAffixes, getHeatRewardMultiplier,
    tick, getEffectiveVision, applyPoison, tickPoison,
    renderDifficultySelect, renderHeatSelect
  };
})();
