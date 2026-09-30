#!/usr/bin/env node
/* v5.8 卡牌系统 node 单测：纯逻辑，不依赖浏览器/DOM。
 * 运行：node tools/v58-card-test.js  （退出码非 0 = 失败）
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');

// 干净的内存 GameState（CardV58 在无全局 GameState 时用 MEM；这里显式注入以便断言）
global.GameState = {
  collection: { skill: {}, item: {}, seed: {} },
  ownedBlueprints: [],
  safeBoxSlots: 1,
  hardcoreFullLoss: false,
  deckPresets: [],
  captureLog: [],
  gold: 10000,
  warehouse: { materials: {} }
};

const CARD_DATA = require(path.join(ROOT, 'js/v58/card-data.js'));
const CardV58 = require(path.join(ROOT, 'js/v58/card-system.js'));

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ok  ' + msg); }
  else { failed++; console.error('  FAIL ' + msg); }
}
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + ' (got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b) + ')'); }

const FACTION_IDS = Object.keys(CARD_DATA.factions);
const RARITY_IDS = Object.keys(CARD_DATA.rarities);

/* ---------- 1. 遍历全部卡定义：无坏引用、标签合法 ---------- */
console.log('\n[1] 卡定义完整性 / 标签合法');
let totalDefs = 0;
function walkGroup(group, type) {
  for (const defId of Object.keys(group)) {
    totalDefs++;
    const d = group[defId];
    eq(d.defId, defId, type + '/' + defId + ' defId 自洽');
    ok(d.type === type, type + '/' + defId + ' type 正确');
    ok(FACTION_IDS.includes(d.element), type + '/' + defId + ' element 合法(' + d.element + ')');
    ok(Array.isArray(d.tags) && d.tags.length > 0, type + '/' + defId + ' tags 非空');
    ok(d.tags[0] === d.element, type + '/' + defId + ' tags[0]==element');
    ok(RARITY_IDS.includes(d.rarity), type + '/' + defId + ' rarity 合法');
    ok(d.effect && typeof d.effect === 'object', type + '/' + defId + ' effect 结构化(非字符串)');
    ok(typeof d.niche === 'string' && d.niche.length > 0, type + '/' + defId + ' 有 niche');
    ok(typeof d.source === 'string' && d.source.length > 0, type + '/' + defId + ' 有 source');
    // 坏引用：makeCard 必须能生成
    ok(CardV58.makeCard(type, defId) !== null, type + '/' + defId + ' makeCard 无坏引用');
  }
}
walkGroup(CARD_DATA.skills, 'skill');
walkGroup(CARD_DATA.items, 'item');
walkGroup(CARD_DATA.seeds, 'seed');
walkGroup(CARD_DATA.signatures, 'signature');

// 12 boss 每个一张签名卡
const bossIds = ['t1_boar_king','t1_withered','t1_quarry','t2_gargoyle_lord','t2_ruin_golem','t3_swamp_hag','t3_brood_mother','t3_scorch_demon','t4_abyss_lord','t4_time_warden','t4_moon_priestess','t4_arena_champion'];
for (const b of bossIds) {
  const sig = Object.values(CARD_DATA.signatures).find(s => s.bossId === b);
  ok(sig && sig.blueprint === true && sig.rarity === 'legendary', 'boss ' + b + ' 有传说签名蓝图');
}
// affix 池必含
ok(CARD_DATA.affixes.affix_dmg5 && CARD_DATA.affixes.affix_dmg5.mods.dmgMult === 0.05, '含 affix_dmg5 伤害+5%');
ok(CARD_DATA.affixes.affix_recast5 && CARD_DATA.affixes.affix_recast5.mods.recastChance === 0.05, '含 affix_recast5 5%再次触发');

/* ---------- 2. 协同里程碑计数 ---------- */
console.log('\n[2] 协同里程碑计数');
// 6 火 → 激活 fire2/3/4/5
const loadout6fire = {
  weapons: ['flame_bow'],
  skills: ['chili_breath'],
  items: ['torch', 'flame_elixir'],
  seeds: ['chili', 'tomato']
};
const st = CardV58.synergyState(loadout6fire);
eq(st.tags.fire.count, 6, '火标签计数=6');
eq(st.tags.fire.active, ['fire2','fire3','fire4','fire5'], '6火激活全部4档');
// 恰好 3 毒 → 只到 poison3（不含 poison4/5）
const loadout3poison = { skills: ['poison_mist'], items: ['poison_bomb'], seeds: ['deathcap'] };
const st3 = CardV58.synergyState(loadout3poison);
eq(st3.tags.poison.count, 3, '毒标签计数=3');
ok(!st3.tags.poison.active.includes('poison4'), '3毒不触发poison4');
ok(st3.tags.poison.active.includes('poison3'), '3毒触发poison3');
// 2 召唤 → summon2
const st2 = CardV58.synergyState({ skills: ['vine_bind','healing_rain'] });
eq(st2.tags.summon.count, 2, '召唤计数=2');
ok(st2.tags.summon.active.includes('summon2'), '2召唤触发summon2藤甲');
// synergyMods 扁平数值存在
const mods = CardV58.synergyMods(loadout6fire);
ok(mods.onHit && typeof mods.onHit.burnChance === 'number', 'synergyMods 扁平合并 onHit.burnChance');

/* ---------- 3. 铭记概率（25/15/8，Boss 蓝图必成） ---------- */
console.log('\n[3] 铭记概率');
eq(CARD_DATA.rarities.common.inscribe, 0.25, '普通铭记=25%');
eq(CARD_DATA.rarities.rare.inscribe, 0.15, '稀有铭记=15%');
eq(CARD_DATA.rarities.epic.inscribe, 0.08, '史诗铭记=8%');
function inscribeAt(rarity, r) { return CardV58.inscribeRoll({ type:'item', defId:'bread', rarity:rarity }, () => r); }
eq(inscribeAt('common', 0.249), true, '普通 24.9% 成功');
eq(inscribeAt('common', 0.251), false, '普通 25.1% 失败');
eq(inscribeAt('rare', 0.149), true, '稀有 14.9% 成功');
eq(inscribeAt('rare', 0.151), false, '稀有 15.1% 失败');
eq(inscribeAt('epic', 0.079), true, '史诗 7.9% 成功');
eq(inscribeAt('epic', 0.081), false, '史诗 8.1% 失败');
eq(CardV58.inscribeRoll({ type:'signature', defId:'sig_boar_king', rarity:'legendary' }, () => 0.99), true, 'Boss 蓝图必成');

/* ---------- 4. 死亡：安全箱保留 + 技能收藏/精通不丢 ---------- */
console.log('\n[4] 死亡保留规则');
global.GameState = { collection: { skill: { chili_breath: { count: 5, masteryLv: 3, masteryProgress: 0.2 } }, item: {}, seed: {} }, safeBoxSlots: 1, captureLog: [], hardcoreFullLoss: false };
const d = CardV58.onDeath({
  carriedItems: ['bread'], broughtWeapons: ['w_001'], tempLoot: [{ defId: 'x' }],
  safeBox: ['safe_material_a', 'safe_material_b'], rng: () => 0.99, hasDeathPardon: false
});
eq(d.safeBoxKept.length, 1, '安全箱仅保留 safeBoxSlots(=1) 格');
eq(d.safeBoxKept[0], 'safe_material_a', '保留最先放入的安全箱物');
eq(d.lost.items.length, 1, '带入消耗品丢失');
eq(d.lost.weapons.length, 1, '带入武器实例丢失');
eq(CardV58.getMastery('skill:chili_breath'), 3, '死亡后技能精通不丢');
eq(global.GameState.collection.skill.chili_breath.count, 5, '死亡后技能收藏不丢');

/* ---------- 5. 免死令自动免降级 ---------- */
console.log('\n[5] 免死令自动免降级');
const dPardon = CardV58.onDeath({ rng: () => 0.10, hasDeathPardon: true }); // 0.1<0.5 本应降级
eq(dPardon.downgrade, false, '免死令存在时不降级');
eq(dPardon.pardonUsed, true, '免死令已消耗');
const dNoPardon = CardV58.onDeath({ rng: () => 0.10, hasDeathPardon: false });
eq(dNoPardon.downgrade, true, '无免死令时按 50% 降级');

/* ---------- 6. 精通每级 +18% 伤害/治疗/护盾、-5% 冷却 ---------- */
console.log('\n[6] 精通数值');
function statsAt(lv) { return CardV58.cardStats(CardV58.makeCard('skill', 'chili_breath', { masteryLv: lv })); }
eq(statsAt(0).dmgMult, 0, 'Lv0 伤害倍率=0');
const s3 = statsAt(3);
eq(Math.round(s3.dmgMult * 100), 54, 'Lv3 伤害+54% (3*18%)');
eq(Math.round(s3.healMult * 100), 54, 'Lv3 治疗+54%');
eq(Math.round(s3.shieldMult * 100), 54, 'Lv3 护盾+54%');
eq(Math.round(s3.cdr * 100), 15, 'Lv3 冷却-15% (3*5%)');
const s5 = statsAt(5);
eq(Math.round(s5.dmgMult * 100), 90, 'Lv5 伤害+90% (5*18%)');
eq(Math.round(s5.cdr * 100), 25, 'Lv5 冷却-25% (5*5%)');
// 精通进度升级
global.GameState = { collection: { skill: {}, item: {}, seed: {} }, captureLog: [] };
eq(CardV58.addMasteryProgress('skill:chili_breath', 1.0), 1, '1.0 进度升 1 级');
eq(CardV58.addMasteryProgress('skill:chili_breath', 4.0), 5, '4.0 进度一路升到 5 级满级');

/* ---------- 7. 夺卡只给三类；道具 6×5 满置灰 ---------- */
console.log('\n[7] 夺卡三分类与容量置灰');
const roll = CardV58.rollCapture({ existingCards: [{ type:'skill', defId:'chili_breath' }], distinctItemTypes: 3, itemCounts: {}, rng: () => 0.5 });
eq(roll.choices.map(c => c.kind).sort(), ['item','seed','upgrade'], '夺卡只给 upgrade/item/seed 三类');
eq(roll.choices.every(c => !c.grey), true, '背包未满时三项可选');
// 6 种已满 → 道具置灰
const rollFull = CardV58.rollCapture({ existingCards: [{ type:'skill', defId:'chili_breath' }], distinctItemTypes: 6, itemCounts: {}, rng: () => 0.99 });
const itemChoice = rollFull.choices.find(c => c.kind === 'item');
eq(itemChoice.grey, true, '6 种道具满时道具项置灰');
ok(itemChoice.reason.length > 0, '置灰有原因说明');
ok(rollFull.choices.find(c => c.kind==='upgrade') && !rollFull.choices.find(c=>c.kind==='upgrade').grey, '升级项不置灰');
ok(rollFull.choices.find(c => c.kind==='seed') && !rollFull.choices.find(c=>c.kind==='seed').grey, '种子项不置灰');
// applyCapture 升级
global.GameState = { collection: { skill: { chili_breath: { count:1, masteryLv:0, masteryProgress:0 } }, item:{}, seed:{} }, captureLog: [] };
const ap = CardV58.applyCapture({ kind:'upgrade', card:{type:'skill',defId:'chili_breath'}, grey:false }, {});
eq(ap.ok, true, '夺卡升级可执行');
// applyCapture 道具堆叠
const apItem = CardV58.applyCapture({ kind:'item', defId:'bread', grey:false }, {});
eq(apItem.ok && global.GameState.collection.item.bread.count === 1, true, '道具入收藏堆叠');

/* ---------- 8. 重复卡转精通进度（§8 修复） ---------- */
console.log('\n[8] 重复卡转精通进度');
// 8.1 首次获得入收藏（count=1，无精通进度）
global.GameState = { collection: { skill: {}, item: {}, seed: {} }, captureLog: [] };
let r1 = CardV58.onExtract({ loot: [CardV58.makeCard('item', 'bread', { rarity: 'common' })], rng: () => 0.0 });
eq(r1.firstAcquire, ['bread'], '首入收藏 firstAcquire');
eq(global.GameState.collection.item.bread.count, 1, '首入 count=1');
eq(CardV58.getMastery('item:bread'), 0, '首入精通 Lv0');
// 8.2 重复副本走精通进度，count 不再 +1，duplicateTally 仅统计
let r2 = CardV58.onExtract({ loot: [CardV58.makeCard('item', 'bread', { rarity: 'common' })], rng: () => 0.0 });
eq(r2.duplicates, ['bread'], '重复副本计入 duplicates');
eq(global.GameState.collection.item.bread.count, 1, '重复后 count 仍=1（不再 count+1）');
eq(global.GameState.collection.item.bread.duplicateTally, 1, 'duplicateTally 统计=1');
ok(global.GameState.collection.item.bread.masteryProgress > 0, '重复后 masteryProgress>0（common=0.30）');
// 8.3 按稀有度喂入若干重复副本，精通升到预期等级
// 新进度表 rare=0.60/张 → 1 张=0.60(Lv0)、2 张=1.20(Lv1)；common=0.30/张 → 3 张=0.90(Lv0)、4 张=1.20(Lv1)
global.GameState = { collection: { skill: {}, item: {}, seed: {} }, captureLog: [] };
CardV58.onExtract({ loot: [CardV58.makeCard('item', 'medkit', { rarity: 'rare' })], rng: () => 0.0 }); // 首入
CardV58.onExtract({ loot: [CardV58.makeCard('item', 'medkit', { rarity: 'rare' })], rng: () => 0.0 }); // 1 张=0.60，应仍 Lv0
eq(CardV58.getMastery('item:medkit'), 0, '1 张稀有重复(0.60)未升级');
CardV58.onExtract({ loot: [CardV58.makeCard('item', 'medkit', { rarity: 'rare' })], rng: () => 0.0 }); // 第2张累计1.20→Lv1
eq(CardV58.getMastery('item:medkit'), 1, '2 张稀有重复(1.20)升到 Lv1');
// common: 3 张=0.90(Lv0)，第4张=1.20→Lv1
global.GameState = { collection: { skill: {}, item: {}, seed: {} }, captureLog: [] };
CardV58.onExtract({ loot: [CardV58.makeCard('seed', 'wheat', { rarity: 'common' })], rng: () => 0.0 });
let commonLoot = [];
for (let i = 0; i < 3; i++) commonLoot.push(CardV58.makeCard('seed', 'wheat', { rarity: 'common' }));
CardV58.onExtract({ loot: commonLoot, rng: () => 0.0 }); // 3 张=0.90，应仍 Lv0
eq(CardV58.getMastery('seed:wheat'), 0, '3 张普通重复(0.90)未升级');
CardV58.onExtract({ loot: [CardV58.makeCard('seed', 'wheat', { rarity: 'common' })], rng: () => 0.0 }); // 第4张=1.20→Lv1
eq(CardV58.getMastery('seed:wheat'), 1, '4 张普通重复(1.20)升到 Lv1');
// 8.4 蓝图/首获不回归：签名蓝图必成且首入收藏
global.GameState = { collection: { skill: {}, item: {}, seed: {} }, captureLog: [] };
let rSig = CardV58.onExtract({ loot: [CardV58.makeCard('signature', 'sig_boar_king', { rarity: 'legendary' })], rng: () => 0.99 });
eq(rSig.firstAcquire, ['sig_boar_king'], 'Boss 蓝图首入收藏');
eq(global.GameState.collection.skill.sig_boar_king.count, 1, '蓝图首入 count=1');
// 蓝图重复副本也转精通（legendary=1.50/张 → 直接升 Lv1，余 0.5 进度）
CardV58.onExtract({ loot: [CardV58.makeCard('signature', 'sig_boar_king', { rarity: 'legendary' })], rng: () => 0.99 });
eq(CardV58.getMastery('skill:sig_boar_king'), 1, '蓝图重复副本(1.50)升到 Lv1');
ok(Math.abs(global.GameState.collection.skill.sig_boar_king.masteryProgress - 0.5) < 1e-6, '蓝图重复后余 0.5 进度');

/* ---------- 汇总 ---------- */
console.log('\n================ 结果 ================');
console.log('卡定义总数: skill=' + Object.keys(CARD_DATA.skills).length +
  ' item=' + Object.keys(CARD_DATA.items).length +
  ' seed=' + Object.keys(CARD_DATA.seeds).length +
  ' signature=' + Object.keys(CARD_DATA.signatures).length +
  ' affix=' + Object.keys(CARD_DATA.affixes).length +
  ' (合计 ' + totalDefs + ' 张卡定义)');
console.log('通过 ' + passed + ' / 失败 ' + failed);
if (failed) { console.error('v58-card-test 失败'); process.exit(1); }
console.log('v58-card-test 全部通过');
