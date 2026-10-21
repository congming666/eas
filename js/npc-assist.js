/* ================= 智能 NPC 参战（好感驱动的危机支援） =================
 * 条件：远征中、玩家血量 <35%、开局 >45s、该 NPC 好感 ≥25、本局还没支援过。
 * 满足时任一位好感最高的 NPC 冲进来帮打，本局限一次；不占用游侠（ranger）名额。
 */
(function () {
  'use strict';

  // NPC → 战斗定位（复用游侠 AI 的 melee / gun / healgun 三种行为）
  const STATS = {
    guide:    { kind: 'healgun', hp: 170, damage: 6,  speed: 172, range: 300, atkCd: 1.0, bulletSpeed: 300, healCd: 6, healAmount: 9,  color: '#8fd6a0', role: '支援·治疗' },
    farmer:   { kind: 'melee',   hp: 220, damage: 10, speed: 165, range: 62,  atkCd: 1.2, tauntR: 160, color: '#c8b070', role: '近战·缠斗' },
    merchant: { kind: 'gun',     hp: 180, damage: 9,  speed: 170, range: 360, atkCd: 0.8, bulletSpeed: 340, color: '#e8c86a', role: '远程·骚扰' },
    veteran:  { kind: 'melee',   hp: 360, damage: 20, speed: 158, range: 72,  atkCd: 1.1, tauntR: 240, color: '#d88a6a', role: '近战·坦克' },
    traveler: { kind: 'gun',     hp: 160, damage: 16, speed: 180, range: 400, atkCd: 1.0, bulletSpeed: 400, color: '#b89ae8', role: '远程·爆发' }
  };

  const LINES = {
    join: ['……听到你这边动静不对，我来了。', '别硬撑，我替你顶一会儿。'],
    playerLow: ['撑住！我挡着！', '退后，交给我。'],
    elite: ['精英交给我。', '这东西我来缠。'],
    boss: ['大块头……我来。'],
    death: ['……值了。'],
    downed: ['我倒下了……扶我一把。'],
    revived: ['还能打。'],
    extract: ['撤！我断后。'],
    leave: ['这里没事了，我回去了。']
  };

  function buildDef(npcId) {
    const npc = window.NpcSystem.NPCS[npcId];
    const s = STATS[npcId] || STATS.veteran;
    const short = (npc.name || '').split('·').pop();
    return {
      id: 'npc_' + npcId,
      npcId,
      name: short,
      title: (npc.name || '').split('·')[0],
      role: s.role,
      hp: s.hp, speed: s.speed, kind: s.kind, range: s.range,
      damage: s.damage, atkCd: s.atkCd, bulletSpeed: s.bulletSpeed,
      tauntR: s.tauntR, color: s.color,
      healCd: s.healCd, healAmount: s.healAmount,
      lines: LINES
    };
  }

  function bestNpc() {
    if (!window.NpcSystem || !NpcSystem.getNpcState) return null;
    let best = null;
    Object.keys(NpcSystem.NPCS).forEach((id) => {
      const st = NpcSystem.getNpcState(id);
      if (!st) return;
      if ((st.affection || 0) < 25) return;
      if (!best || st.affection > best.aff) best = { id, aff: st.affection };
    });
    return best;
  }

  function spawn(exp, npcId) {
    const def = buildDef(npcId);
    const hp = Math.round(def.hp * (1 + (exp.map.tier - 1) * 0.25));
    const dmg = def.damage * (1 + (exp.map.tier - 1) * 0.3);
    const a = Math.random() * Math.PI * 2;
    const x = Math.max(60, Math.min(CONFIG.expedition.mapSize - 60, exp.player.x + Math.cos(a) * 90));
    const y = Math.max(60, Math.min(CONFIG.expedition.mapSize - 60, exp.player.y + Math.sin(a) * 90));
    const ally = {
      def, x, y, hp, maxHp: hp, damage: dmg,
      speed: def.speed, radius: 15, state: 'follow',
      attackCd: 0.4, healCd: def.healCd || 0, animT: 0, facing: 0,
      followAng: Math.random() * Math.PI * 2, bubble: null, idleTalkT: 20,
      coKills: 0, hitFlash: 0, deadT: 0, leaveT: 0,
      npcAssist: true
    };
    exp.allies.push(ally);
    if (typeof exp._allyBubble === 'function') exp._allyBubble(ally, LINES.join[Math.floor(Math.random() * LINES.join.length)]);
    if (typeof showToast === 'function') showToast(`${def.title}「${def.name}」冲进来支援你了！`, 'gold');
    if (typeof AudioManager !== 'undefined' && AudioManager.playMissionComplete) AudioManager.playMissionComplete();
    return ally;
  }

  function tick(exp) {
    if (!exp || exp.gameOver || exp.dying || exp.extracting) return;
    if (exp._npcAssistUsed) return;
    if ((exp.elapsed || 0) < 45) return;
    const maxHp = exp.player.maxHp || 100;
    if (exp.player.hp / maxHp > 0.35) return;
    if ((exp.allies || []).some((a) => a.npcAssist && a.hp > 0)) return;
    const pickNpc = bestNpc();
    if (!pickNpc) return;
    exp._npcAssistUsed = true;
    spawn(exp, pickNpc.id);
    if (window.Telemetry && Telemetry.track) Telemetry.track('npc_combat_assist', { npc: pickNpc.id, aff: pickNpc.aff });
  }

  window.NpcAssist = { STATS, tick, spawn, bestNpc, buildDef };
})();
