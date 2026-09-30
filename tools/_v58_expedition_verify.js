// v5.8 EXPEDITION headless 验收
const { chromium } = require('playwright');
const path = require('path');
const ROOT = 'C:/Users/29401/Desktop/u/farm-cards-expedition';
const SHOT_DIR = path.join(ROOT, 'tools', 'v58-shots');
const fs = require('fs');
if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message + '\n' + (e.stack||'')));

  await page.goto('file:///' + ROOT.replace(/\\/g, '/') + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof GameState !== 'undefined' && typeof CardV58 !== 'undefined' && typeof Expedition !== 'undefined', { timeout: 15000 });
  await page.waitForTimeout(600);

  const results = [];
  function check(name, cond, extra) { results.push({ name, ok: !!cond, extra: String(extra || '') }); }

  await page.evaluate(() => {
    GameState.gold = 99999;
    // 关闭任何自动弹出的外来浮层（含他代理未完成的 warehouse）
    document.querySelectorAll('.overlay,.modal-overlay,.v5-overlay').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('[id$="Modal"]').forEach(el => el.classList.add('hidden'));
    GameState.selectedMap = 't1_1';
    if (typeof LoadoutSystem !== 'undefined' && LoadoutSystem.init) { try { LoadoutSystem.init(); } catch(e){} }
    GameState.weaponInstances = GameState.weaponInstances || [];
    if (!GameState.weaponInstances.find(w => w.uid === 'w_test')) GameState.weaponInstances.push({ uid: 'w_test', weaponId: 'harvest_sickle', level: 0 });
    GameState.loadoutWeaponUids = ['w_test'];
    GameState.equippedSkills = GameState.equippedSkills || ['straw_smash'];
    GameState.collection = GameState.collection || { skill: {}, item: {}, seed: {} };
    GameState.ownedBlueprints = GameState.ownedBlueprints || [];
  });
  await page.evaluate(() => Game.startExpedition());
  await page.waitForTimeout(800);

  const expReady = await page.evaluate(() => !!Game.expedition && !Game.expedition.gameOver);
  check('进入远征成功', expReady);
  await page.screenshot({ path: path.join(SHOT_DIR, 'e01-enter.png') });

  // ① 夺卡三选一
  await page.evaluate(() => { const e = Game.expedition; e.tempCards = []; e.offerCapture('road'); });
  await page.waitForTimeout(200);
  const cap = await page.evaluate(() => {
    const ov = document.getElementById('v58CaptureOverlay');
    if (!ov) return null;
    return { cards: ov.querySelectorAll('.v58-cap-card').length, kinds: Array.from(ov.querySelectorAll('.v58-cap-kind')).map(el => el.textContent), grey: ov.querySelectorAll('.v58-cap-grey').length };
  });
  check('① 夺卡浮层3卡', cap && cap.cards === 3, JSON.stringify(cap));
  check('① 类型=精通/道具/种子', cap && cap.kinds.some(k=>k.indexOf('精通')>=0) && cap.kinds.some(k=>k.indexOf('道具')>=0) && cap.kinds.some(k=>k.indexOf('种子')>=0), JSON.stringify(cap && cap.kinds));
  await page.screenshot({ path: path.join(SHOT_DIR, 'e02-capture.png') });
  await page.evaluate(() => { const el = document.querySelector('#v58CaptureOverlay .v58-cap-card:not(.v58-cap-grey)'); if(el) el.click(); });
  await page.waitForTimeout(200);
  const afterPick = await page.evaluate(() => { const e = Game.expedition; return { closed: !document.getElementById('v58CaptureOverlay'), choiceOpen: e.choiceOpen, temp: e.tempCards.length }; });
  check('① 选择后关闭/恢复', afterPick.closed && !afterPick.choiceOpen, JSON.stringify(afterPick));

  // ①b 道具 6×5 满置灰
  await page.evaluate(() => {
    const e = Game.expedition; e.tempCards = [];
    const ids = Object.keys(CARD_DATA.items);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 5; j++) e.tempCards.push(CardV58.makeCard('item', ids[i], {}));
    e.offerCapture('road');
  });
  await page.waitForTimeout(200);
  const fullCap = await page.evaluate(() => {
    const ov = document.getElementById('v58CaptureOverlay');
    if (!ov) return null;
    const items = Array.from(ov.querySelectorAll('.v58-cap-card')).filter(c => c.querySelector('.v58-cap-kind').textContent.indexOf('道具') >= 0);
    return { itemGrey: items.length>0 && items.every(c => c.classList.contains('v58-cap-grey')), reason: (ov.querySelector('.v58-cap-reason')||{}).textContent || '' };
  });
  check('①b 道具6×5满→置灰说明', fullCap && fullCap.itemGrey, JSON.stringify(fullCap));
  await page.screenshot({ path: path.join(SHOT_DIR, 'e03-item-full-grey.png') });
  await page.evaluate(() => { const ov=document.getElementById('v58CaptureOverlay'); if(ov)ov.remove(); Game.expedition.choiceOpen=false; });

  // ② 篝火
  await page.evaluate(() => Game.expedition.openCampfire());
  await page.waitForTimeout(200);
  const cf = await page.evaluate(() => { const ov = document.getElementById('v58CampfireOverlay'); return ov ? { cards: ov.querySelectorAll('.v58-cap-card').length } : null; });
  check('② 篝火三选一', cf && cf.cards === 3, JSON.stringify(cf));
  await page.screenshot({ path: path.join(SHOT_DIR, 'e04-campfire.png') });
  await page.evaluate(() => { Game.expedition.player.hp = 10; document.querySelectorAll('#v58CampfireOverlay .v58-cap-card')[2].click(); });
  await page.waitForTimeout(150);
  const rested = await page.evaluate(() => Game.expedition.player.hp >= Game.expedition.player.maxHp);
  check('② 休息回血满', rested);

  // ②b 商人
  await page.evaluate(() => Game.expedition.openMerchant());
  await page.waitForTimeout(200);
  const mc = await page.evaluate(() => { const ov = document.getElementById('v58MerchantOverlay'); return ov ? { btns: ov.querySelectorAll('.v58-cap-card').length, stock: ov.querySelectorAll('.v58-mrow').length } : null; });
  check('②b 商人四功能', mc && mc.btns === 4, JSON.stringify(mc));
  await page.screenshot({ path: path.join(SHOT_DIR, 'e05-merchant.png') });
  await page.evaluate(() => { const ov=document.getElementById('v58MerchantOverlay'); if(ov)ov.remove(); Game.expedition.choiceOpen=false; });

  // ③ Boss 签名 + 蓝图
  await page.evaluate(() => { const e = Game.expedition; e.tempCards = []; e._bossSignatureDrop({ bossId: 't1_boar_king' }); });
  const bossDrop = await page.evaluate(() => {
    const e = Game.expedition; const sig = e.tempCards.find(c => c.type === 'signature');
    return { hasSig: !!sig, sigDef: sig && sig.defId, blueprint: (GameState.ownedBlueprints||[]).indexOf('t1_boar_king') >= 0 };
  });
  check('③ Boss掉签名卡', bossDrop.hasSig, JSON.stringify(bossDrop));
  check('③ Boss必给蓝图', bossDrop.blueprint);
  const allSig = await page.evaluate(() => {
    const ids = ['t1_boar_king','t1_withered','t1_quarry','t2_gargoyle_lord','t2_ruin_golem','t3_swamp_hag','t3_brood_mother','t3_scorch_demon','t4_abyss_lord','t4_time_warden','t4_moon_priestess','t4_arena_champion'];
    return ids.filter(id => !Object.values(CARD_DATA.signatures).find(s => s.bossId === id));
  });
  check('③ 12 Boss均有签名', allSig.length === 0, 'missing=' + JSON.stringify(allSig));

  // ④ 撤离铭记
  await page.evaluate(() => {
    const e = Game.expedition; e.tempCards = [];
    e.tempCards.push(CardV58.makeCard('item','bread',{}));
    e.tempCards.push(CardV58.makeCard('seed','straw_seed',{}));
    e._extractReport = null; e._runExtractSettlement();
  });
  const ext = await page.evaluate(() => {
    const e = Game.expedition;
    return { report: e._extractReport, blueprint: (GameState.ownedBlueprints||[]).indexOf('t1_boar_king') >= 0 };
  });
  check('④ 撤离结算报告', !!ext.report && Array.isArray(ext.report.inscribed), JSON.stringify(ext.report));
  check('④ 蓝图保留', ext.blueprint);

  // ⑤ 死亡
  const death = await page.evaluate(() => {
    const e = Game.expedition;
    e.tempCards = [CardV58.makeCard('item','bread',{}), CardV58.makeCard('seed','straw_seed',{})];
    e.safeBox = [{ type:'material', name:'x', amount:1 }];
    e.consumables = e.consumables || {}; e.consumables['death_pardon'] = 1;
    const before = JSON.stringify(GameState.collection.skill);
    // 强制 onDeath 的 50% 降级掷骰命中（rng 返回 0），确定性验证免死令
    const origRandom = Math.random; Math.random = () => 0;
    e._runDeathSettlement();
    Math.random = origRandom;
    return { tempCleared: e.tempCards.length===0, safeKept: e.safeBox.length===1, pardonUsed: !!(e._deathReport&&e._deathReport.pardonUsed), pardonLeft: e.consumables.death_pardon||0, skillKept: JSON.stringify(GameState.collection.skill)===before };
  });
  check('⑤ 死亡战利品全丢', death.tempCleared);
  check('⑤ 安全箱保留', death.safeKept);
  check('⑤ 免死令自动用', death.pardonUsed && death.pardonLeft===0, JSON.stringify(death));
  check('⑤ 技能收藏不丢', death.skillKept);

  // ⑦ 图鉴固定网格
  await page.evaluate(() => { if (typeof V5!=='undefined' && V5.ui && V5.ui.openCodex) V5.ui.openCodex(); });
  await page.waitForTimeout(300);
  const codex = await page.evaluate(() => {
    const grid = document.querySelector('.v5-modal .v5-grid');
    if (!grid) return null; const cs = getComputedStyle(grid);
    return { cols: cs.gridTemplateColumns.split(' ').length, minH: cs.minHeight, align: cs.alignContent };
  });
  check('⑦ 图鉴固定4列', codex && codex.cols === 4, JSON.stringify(codex));
  check('⑦ 图鉴保留区域不塌陷', codex && codex.minH!=='0px' && parseInt(codex.minH)>=400, JSON.stringify(codex));
  await page.evaluate(() => { const w = document.getElementById('warehouseModal'); if (w) w.remove(); document.querySelectorAll('.v5-overlay').forEach(o=>o.classList.remove('hidden')); });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOT_DIR, 'e06-codex-grid.png') });

  // ⑥ 战斗层：协同 + 词条
  // ⑥a 3火 → onHit 燃烧 mod
  const syn = await page.evaluate(() => {
    const e = Game.expedition;
    e.equippedSkills = ['chili_breath','chili_breath','chili_breath'];
    e.buildCardSynergy();
    return { onHit: e.syn.onHit, buffs: e.synBuffs.map(b=>b.id) };
  });
  check('⑥a 3火→燃烧叠层mod', syn && syn.onHit && syn.onHit.burnChance >= 0.40, JSON.stringify(syn));

  // ⑥b 命中实际附加燃烧（强制rng=0必触发，crit=false避免暴击自带燃烧干扰）
  const burn = await page.evaluate(() => {
    const e = Game.expedition;
    const m = { x:0, y:0, radius:10, maxHp:1000, hp:1000 };
    const origR = Math.random; Math.random = () => 0;
    e.damageEnemy(m, 10, '#f00', false, { fromPlayer:true, crit:false, skillId:'chili_breath', quiet:true });
    Math.random = origR;
    return { hasBurn: !!m.burn };
  });
  check('⑥b 命中附加燃烧', burn && burn.hasBurn, JSON.stringify(burn));

  // ⑥c armor3 → 开战叠甲 + 减伤
  const armor = await page.evaluate(() => {
    const e = Game.expedition;
    e.equippedSkills = ['iron_armor','iron_armor','iron_armor'];
    e.buildCardSynergy();
    return { shield: e.cardShield, dmgTaken: e.syn.damageTaken, reflect: e.syn.reflect };
  });
  check('⑥c armor开战叠甲', armor && armor.shield >= 60, JSON.stringify(armor));
  check('⑥c armor减伤', armor && armor.dmgTaken <= -0.09, JSON.stringify(armor));

  // ⑥d 低血处决
  const exec = await page.evaluate(() => {
    const e = Game.expedition;
    e.syn = Object.assign({}, e.syn, { execute: true });
    const m = { x:0, y:0, radius:10, maxHp:100, hp:15 };
    e.damageEnemy(m, 5, '#f00', false, { fromPlayer:true, crit:false, quiet:true });
    return { dead: m.hp <= 0 };
  });
  check('⑥d 低血处决', exec && exec.dead, JSON.stringify(exec));

  // ⑥e 词条伤害+5%
  const affix = await page.evaluate(() => {
    const e = Game.expedition;
    GameState.collection.skill['straw_smash'] = { affixes:['affix_dmg5'], masteryLv:0 };
    const cs = e._skillCardStats('straw_smash');
    e.syn = {};
    const origR = Math.random; Math.random = () => 0.99;
    const m1 = { x:0, y:0, radius:10, maxHp:5000, hp:5000 };
    e.damageEnemy(m1, 100, '#fff', false, { fromPlayer:true, crit:false, quiet:true });
    const dmgNo = 5000 - m1.hp;
    const m2 = { x:0, y:0, radius:10, maxHp:5000, hp:5000 };
    e.damageEnemy(m2, 100, '#fff', false, { fromPlayer:true, crit:false, skillId:'straw_smash', quiet:true });
    Math.random = origR;
    return { csDmg: cs.dmgMult, no: dmgNo, yes: 5000 - m2.hp };
  });
  check('⑥e 词条伤害+5%', affix && affix.csDmg>=0.049 && Math.abs((affix.yes/affix.no)-1.05)<0.15, JSON.stringify(affix));

  // ⑥f 克制 +25/-25
  const counter = await page.evaluate(() => ({
    up: Game.expedition._counterMultFor({ faction:'fire' }, { faction:'summon' }),
    down: Game.expedition._counterMultFor({ faction:'fire' }, { faction:'ice' })
  }));
  check('⑥f 克制+25%', counter && Math.abs(counter.up-1.25)<0.01, JSON.stringify(counter));
  check('⑥f 被克-25%', counter && Math.abs(counter.down-0.75)<0.01, JSON.stringify(counter));

  // ⑥g recast 再触发一次（强制rng=0必命中；数底层技能施放次数）
  const recast = await page.evaluate(() => {
    const e = Game.expedition;
    const sid = CONFIG.skills[0].id;
    GameState.collection.skill[sid] = { affixes:['affix_recast5'], masteryLv:0 };
    e.player.energy = 999; e.skillCooldowns = [0,0,0,0]; e._recastGuard = false;
    // 数 prototype 上当前 useSkill（=v5.8 wrapper）内部重入：用 _recastGuard 副作用不好数，
    // 改为数 wrapper 内 origUse 调用——直接包 proto.useSkill 再计数。
    let casts = 0;
    const proto = Object.getPrototypeOf(e);
    const origProto = proto.useSkill;
    proto.useSkill = function(i){ casts++; return origProto.call(this, i); };
    const origR = Math.random; Math.random = () => 0;
    let err = null;
    try { e.useSkill(0); } catch(ex){ err = ex.message; }
    Math.random = origR;
    proto.useSkill = origProto;
    return { casts, fired: e._recastFired||0, dbg: e._dbgRecast2, err, wrapped: !!proto._v58RecastWrapped, rc: e._skillCardStats(sid).recastChance };
  });
  check('⑥g recast再触发一次', recast && recast.fired >= 1, JSON.stringify(recast));

  // ⑧ 12 技能真实效果断言（v5.js useSkill 读 equippedSkills[idx]，效果落 this.v5.*，由 V5.tick 驱动）
  await page.evaluate(() => { window.mkM = (x,y,hp=2000)=>({x,y,radius:12,maxHp:hp,hp,speed:60,attackCd:0,attackAnim:0,stun:0,slow:0}); });
  async function prepSkill(sid) {
    return await page.evaluate((sid) => {
      const e = Game.expedition;
      e.monsters = []; e.raiders = []; e.projectiles = [];
      e.equippedSkills = [sid];
      e.v5 = { zones:[], channels:[], traps:[], totems:[], tempAtkMul:1, tempMoveMul:1, shield:0, iron:0, rage:0, drum:0 };
      e.player.x = 500; e.player.y = 500;
      e.player.energy = 999; e.skillCooldowns = [0,0,0,0,0,0];
      e.camera.x = 0; e.camera.y = 0; e.mouse.x = 800; e.mouse.y = 500; // 世界(800,500) 朝东
      e._recastGuard = false; e.syn = {}; e.cardShield = 0;
      return true;
    }, sid);
  }
  const tick = async (dt) => page.evaluate((dt) => { const e=Game.expedition; if(window.V5) V5.tick(e, dt); }, dt);

  // 1 chili_breath：锥形伤害 + 燃烧
  await prepSkill('chili_breath');
  const t1 = await page.evaluate(() => {
    const e = Game.expedition;
    const m = window.mkM(650, 500, 2000); e.monsters.push(m);
    e.useSkill(0);
    return { dmg: 2000 - m.hp, burn: !!m.burn };
  });
  check('⑧1 辣椒火息 锥形伤害+燃烧', t1.dmg>0 && t1.burn, JSON.stringify(t1));

  // 2 frost_barrier：护盾 + 近身减速
  await prepSkill('frost_barrier');
  const t2 = await page.evaluate(async () => {
    const e = Game.expedition;
    const m = window.mkM(560, 500); e.monsters.push(m);
    e.useSkill(0);
    const shield = e.v5.shield;
    if (window.V5) V5.tick(e, 0.2);
    return { shield, slowed: (m.slow||0)>0 };
  });
  check('⑧2 寒霜屏障 护盾+近身减速', t2.shield>=50 && t2.slowed, JSON.stringify(t2));

  // 3 thunder_chain：连锁
  await prepSkill('thunder_chain');
  const t3 = await page.evaluate(() => {
    const e = Game.expedition;
    const ms = []; for (let k=0;k<5;k++) ms.push(window.mkM(800 + k*120, 500));
    e.monsters = ms;
    e.useSkill(0);
    return { hit: ms.filter(m=>m.hp<m.maxHp).length };
  });
  check('⑧3 雷霆链 多敌连锁', t3.hit>=2, JSON.stringify(t3));

  // 4 poison_mist：毒云 + tick 伤害
  await prepSkill('poison_mist');
  const t4 = await page.evaluate(async () => {
    const e = Game.expedition;
    const m = window.mkM(800, 500); e.monsters.push(m);
    e.useSkill(0);
    const has = e.v5.zones.some(z=>z.kind==='poison');
    if (window.V5){ V5.tick(e,0.5); V5.tick(e,0.5); }
    return { hasMist: has, dmg: 2000 - m.hp };
  });
  check('⑧4 毒雾蔓延 铺场+DOT', t4.hasMist && t4.dmg>0, JSON.stringify(t4));

  // 5 pea_storm：弹幕数
  await prepSkill('pea_storm');
  const t5 = await page.evaluate(async () => {
    const e = Game.expedition;
    e.useSkill(0);
    const has = e.v5.channels.some(c=>c.kind==='peas');
    if (window.V5){ V5.tick(e,0.6); V5.tick(e,0.6); }
    return { has, shots: e.projectiles.length };
  });
  check('⑧5 豌豆风暴 持续弹幕', t5.has && t5.shots>=2, JSON.stringify(t5));

  // 6 healing_rain：HoT
  await prepSkill('healing_rain');
  const t6 = await page.evaluate(async () => {
    const e = Game.expedition;
    e.player.hp = e.player.maxHp * 0.5;
    const before = e.player.hp;
    e.useSkill(0);
    if (window.V5){ V5.tick(e,1.0); V5.tick(e,1.0); }
    return { healed: e.player.hp > before };
  });
  check('⑧6 治愈之雨 HoT回血', t6.healed, JSON.stringify(t6));

  // 7 sun_drum：buff
  await prepSkill('sun_drum');
  const t7 = await page.evaluate(() => {
    const e = Game.expedition;
    e.useSkill(0);
    return { drum: e.v5.drum>0, atkMul: e.v5.tempAtkMul, moveMul: e.v5.tempMoveMul };
  });
  check('⑧7 太阳战鼓 攻速移速buff', t7.drum && t7.atkMul>1 && t7.moveMul>1, JSON.stringify(t7));

  // 8 death_scythe：旋转斩
  await prepSkill('death_scythe');
  const t8 = await page.evaluate(async () => {
    const e = Game.expedition;
    const m = window.mkM(580, 500); e.monsters.push(m);
    e.useSkill(0);
    const has = e.v5.channels.some(c=>c.kind==='scythe');
    if (window.V5){ V5.tick(e,0.5); V5.tick(e,0.5); }
    return { has, dmg: 2000-m.hp };
  });
  check('⑧8 死亡镰刃 旋斩伤害', t8.has && t8.dmg>0, JSON.stringify(t8));

  // 9 iron_armor：减伤
  await prepSkill('iron_armor');
  const t9 = await page.evaluate(() => {
    const e = Game.expedition;
    e.useSkill(0);
    e.player.invuln = 0; e.player.hp = 1000;
    e.damagePlayer(100, { x:0,y:0,hp:9999 });
    return { iron: e.v5.iron>0, hpLost: 1000 - e.player.hp };
  });
  check('⑧9 金刚藤甲 减伤50%', t9.iron && t9.hpLost<=60, JSON.stringify(t9));

  // 10 thorn_burst：反伤光环
  await prepSkill('thorn_burst');
  const t10 = await page.evaluate(async () => {
    const e = Game.expedition;
    const src = window.mkM(560,500); e.monsters.push(src);
    e.useSkill(0);
    if (window.V5){ V5.tick(e,0.6); V5.tick(e,0.6); }
    return { thorns: e.v5.thorns>0, srcDmg: 1000-src.hp };
  });
  check('⑧10 荆棘爆发 反伤光环', t10.thorns, JSON.stringify(t10));

  // 11 earth_slam：定点范围伤害+眩晕
  await prepSkill('earth_slam');
  const t11 = await page.evaluate(async () => {
    const e = Game.expedition;
    const m = window.mkM(800, 500); e.monsters.push(m);
    e.useSkill(0);
    if (window.V5){ V5.tick(e,0.3); }
    return { dmg: 2000-m.hp, stun: (m.stunned||0)>0 };
  });
  check('⑧11 大地震击 范围伤害+眩晕', t11.dmg>0 && t11.stun, JSON.stringify(t11));

  // 12 gale_slash：突进 + 穿透风刃
  await prepSkill('gale_slash');
  const t12 = await page.evaluate(() => {
    const e = Game.expedition;
    const sx = e.player.x;
    e.useSkill(0);
    return { moved: e.player.x > sx, blades: e.projectiles.length };
  });
  check('⑧12 疾风斩 突进+风刃', t12.moved && t12.blades>=1, JSON.stringify(t12));

  console.log('\n===== v5.8 EXPEDITION 验收结果 =====');
  results.forEach(r => console.log((r.ok?'PASS':'FAIL')+'  '+r.name+(r.extra?'  ['+r.extra+']':'')));
  console.log('\n控制台错误数: '+errors.length);
  errors.slice(0,12).forEach(e => console.log('  ERR: '+e));

  await browser.close();
  process.exit(results.filter(r=>!r.ok).length ? 1 : 0);
})();

