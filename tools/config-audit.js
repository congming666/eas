/* v5.8 配置一致性审计：检查关键字段是否存在、是否被运行时读取、表格导出是否与代码版本一致。 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const files = {
  config: read('js/config.js'), v5: read('js/v5.js'), core: read('js/expedition/expedition-core.js'),
  combat: read('js/expedition/expedition-combat.js'), terrain: read('js/expedition/expedition-terrain.js'),
  difficulty: read('js/difficulty-system.js'), tech: read('js/tech-system.js'), greenhouse: read('js/greenhouse.js'),
  export: read('tools/export-game-data.js')
};
const checks = [];
function check(name, ok, detail) { checks.push({ name, ok: !!ok, detail }); }
check('唯一版本源', /const GAME_VERSION\s*=/.test(files.config) && /CONFIG\.GAME_VERSION|CONFIG\.version/.test(files.export), 'config.js -> export-game-data.js');
check('Tier 使用 1-based 修正', /tier - 1/.test(files.core), 'getBalanceProfile 使用 tier - 1');
check('Boss 主创建入口', /V5\.makeBoss/.test(files.terrain) && /CONFIG\.bosses\[map\.bossId\]/.test(files.v5), 'V5.makeBoss 读取 CONFIG.bosses');
check('难度奖励倍率参与远征奖励', /rewardMul/.test(files.core) && /getHeatRewardMultiplier/.test(files.core), 'DifficultySystem + Heat');
check('金币掉落统一乘奖励倍率', /item\.type === 'gold'/.test(files.combat) && /this\.balance\.reward/.test(files.combat), 'spawnGroundLoot');
check('科技树武器伤害已接线', /TechSystem\.getTechBonus/.test(files.v5), 'rollWeaponDamage');
check('温室武器强化已接线', /greenhouse\.weaponBonus/.test(files.v5), 'rollWeaponDamage');
check('技能等级 1-8 生效', /scaleSkill\(skill, Math\.min\(8/.test(files.v5), 'getSkillStats');
check('失败金币显示为 0', /goldEarned:\s*this\.result === 'success' \? totalGold : 0/.test(files.combat), '结算 UI');
const jsonPath = path.join(ROOT, 'docs', 'game_data.json');
const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
check('导出版本一致', data.version === (files.config.match(/GAME_VERSION\s*=\s*'([^']+)'/) || [])[1], `JSON=${data.version}`);
const failed = checks.filter(x => !x.ok);
console.log(JSON.stringify({ passed: checks.length - failed.length, failed: failed.length, checks }, null, 2));
if (failed.length) process.exit(1);
