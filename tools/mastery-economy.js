#!/usr/bin/env node
/* v5.8 精通成长经济模型（可重复运行）。
 * 目的：把「一个技能刷到精通 Lv5 所需成功撤离局数」调到 ~15–25 局。
 * 运行：node tools/mastery-economy.js
 *
 * 模型（对一个 Boss 蓝图解锁的传说/高阶技能做精通）：
 *  - 精通每升 1 级需 1.0 进度；Lv0→Lv5 共需 5.0 进度。
 *  - 该技能的重复副本主要来自 Boss 蓝图：Boss 遭遇率 14.8%/局，蓝图必铭记。
 *  - 因此每局有效「传说重复副本数」= bossRate = 0.148。
 *  - 每局精通进度 = copiesPerRun × DUPLICATE_MASTERY_PROGRESS[legendary]。
 *  - 满级局数 = 5.0 / 每局进度。
 *  - 校准：当前 P_legendary=0.50 时，局数 = 5/(0.50×0.148) ≈ 67.6 ≈ 实测 68。
 *  - 工坊印制一张传说卡成本 ≈ 6 局收益（维持不变，仅校验，不计入基准刷取）。
 */
'use strict';

const LEVELS = 5;            // Lv1–5
const PROG_PER_LEVEL = 1.0;  // 每级所需进度
const TOTAL_PROG = LEVELS * PROG_PER_LEVEL; // 5.0

const BOSS_RATE = 0.148;     // Boss 遭遇率/局
const GOLD_PER_RUN = 451;    // 场均金
const LEGENDARY_PRINT_RUNS = 6; // 印制一张传说卡 ≈ 6 局（保持不变）

// 一个 Boss 蓝图技能，每局有效重复副本数（基准刷取=纯 Boss 蓝图）
function legendaryCopiesPerRun() { return BOSS_RATE; }

// before / after 两张表
const BEFORE = { common: 0.10, rare: 0.20, epic: 0.35, legendary: 0.50 };
const AFTER  = { common: 0.30, rare: 0.60, epic: 1.05, legendary: 1.50 };

function runsToMax(P) {
  const copies = legendaryCopiesPerRun();
  const progressPerRun = copies * P.legendary;
  return TOTAL_PROG / progressPerRun;
}

console.log('================ v5.8 精通经济模型 ================');
console.log(`精通需求: Lv0→Lv5 共需 ${TOTAL_PROG} 进度（每级 ${PROG_PER_LEVEL}）`);
console.log(`Boss 遭遇率/局: ${BOSS_RATE}（蓝图必铭记）→ 传说重复副本 ${BOSS_RATE}/局`);
console.log(`场均金 ${GOLD_PER_RUN}；印制传说卡成本 ≈ ${LEGENDARY_PRINT_RUNS} 局（=${LEGENDARY_PRINT_RUNS*GOLD_PER_RUN} 金，保持不变）\n`);

console.log('--- 重复副本每张给的精通进度（DUPLICATE_MASTERY_PROGRESS） ---');
console.log('稀有度        before   after');
['common','rare','epic','legendary'].forEach(r => {
  console.log(`${r.padEnd(12)} ${String(BEFORE[r]).padStart(6)}   ${String(AFTER[r]).padStart(6)}`);
});

const beforeRuns = runsToMax(BEFORE);
const afterRuns = runsToMax(AFTER);
console.log('\n--- 满级（传说/Boss 蓝图技能）所需成功撤离局数 ---');
console.log(`before: ${beforeRuns.toFixed(1)} 局   （实测锚点 ≈68）`);
console.log(`after : ${afterRuns.toFixed(1)} 局   （目标 15–25）`);
console.log(`加速比: ${(beforeRuns/afterRuns).toFixed(2)}×`);

// 印制传说卡仍约 6 局（不变）
console.log(`\n印制传说卡复核: ${LEGENDARY_PRINT_RUNS} 局 × ${GOLD_PER_RUN} 金 = ${LEGENDARY_PRINT_RUNS*GOLD_PER_RUN} 金/张（未改动）`);

// 区分度：相邻稀有度进度比
console.log('\n--- 四档区分度（after 相邻比） ---');
const order = ['common','rare','epic','legendary'];
for (let i=1;i<order.length;i++){
  console.log(`${order[i-1]}→${order[i]}: ${(AFTER[order[i]]/AFTER[order[i-1]]).toFixed(2)}×`);
}

// 自校验
if (Math.abs(beforeRuns - 68) > 3) console.warn(`\n[warn] before=${beforeRuns.toFixed(1)} 偏离锚点 68 超过 3 局`);
if (afterRuns < 15 || afterRuns > 25) console.warn(`\n[warn] after=${afterRuns.toFixed(1)} 不在 15–25 区间`);
else console.log(`\n[ok] after=${afterRuns.toFixed(1)} 落在 15–25 区间`);
