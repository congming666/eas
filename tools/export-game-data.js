/**
 * 导出游戏全量配置为 JSON（供生成《游戏数据表》使用），保证表格数值与代码一致。
 * 用法：node tools/export-game-data.js   → docs/game_data.json
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

const FALLBACK = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
async function launch() {
  try { return await chromium.launch({ headless: true }); }
  catch (e) { return chromium.launch({ headless: true, executablePath: FALLBACK }); }
}

async function main() {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: /开\s*始\s*游\s*戏/ }).click();
  await page.waitForSelector('#farmScreen');

  const data = await page.evaluate(() => {
    const pick = (obj) => JSON.parse(JSON.stringify(obj || null));
    return {
      version: CONFIG.GAME_VERSION || CONFIG.version,
      crops: pick(CONFIG.crops),
      cropMaterials: pick(CONFIG.cropMaterials),
      resources: pick(CONFIG.resources),
      materialsLegacy: pick(CONFIG.materials),
      weapons: pick(CONFIG.weapons),
      bosses: pick(CONFIG.bosses),
      skills: pick(CONFIG.skills),
      skillUnlock: pick(CONFIG.skillUnlock),
      greenhousePlants: pick(CONFIG.greenhousePlants),
      cultivationCrops: pick(CONFIG.cultivationCrops),
      heatModifiers: (typeof DifficultySystem !== 'undefined' && DifficultySystem.getHeatModifier) ? ['ironwall','frenzy','darkness','barren','headless'].map(id => { try { return Object.assign({ id }, DifficultySystem.getHeatModifier(id)); } catch (e) { return null; } }).filter(Boolean) : null,
      consumables: pick(CONFIG.consumables),
      maps: pick(CONFIG.maps),
      monsters: pick(CONFIG.monsters),
      plants: pick(CONFIG.plants),
      craftCosts: pick(LoadoutSystem.CRAFT_COSTS),
      recipes: (typeof FarmRecipes !== 'undefined') ? pick(FarmRecipes) : null,
      upgradeCosts: pick(LoadoutSystem.UPGRADE_COSTS),
      warehouseItems: pick(CONFIG.warehouseItems),
      expedition: pick(CONFIG.expedition),
      player: pick(CONFIG.player),
      nutrients: pick(CONFIG.nutrients),
      difficulties: (typeof DifficultySystem !== 'undefined') ? ['casual','normal','hard','nightmare'].map(id => DifficultySystem.getDifficulty(id)) : null,
      levelTable: (typeof CharacterSystem !== 'undefined') ? (function(){
        const rows = [];
        for (let lv = 1; lv <= 100; lv++) {
          const d = CharacterSystem.derived(lv);
          rows.push({
            level: lv,
            maxHp: d.hp, baseAtk: d.atk, defense: d.def,
            maxEnergy: d.energyMax, energyRegen: d.energyRegen, hpRegen: d.ocRegen,
            skillSlots: d.slots,
            cultCost: lv < 100 ? CharacterSystem.expNeeded(lv) : null,
            goldCost: lv < 100 ? CharacterSystem.goldNeeded(lv) : null,
            soilCost: lv < 100 ? CharacterSystem.soilNeeded(lv) : null,
            waterCost: lv < 100 ? CharacterSystem.waterNeeded(lv) : null,
            compostCost: lv < 100 ? CharacterSystem.compostNeeded(lv) : null,
          });
        }
        return rows;
      })() : null,
    };
  });

  // 角色成长（修行台）常量在 v5.js 闭包，尝试从 CharacterSystem 暴露面取
  data.growth = await page.evaluate(() => {
    try {
      return {
        slotLevels: (typeof GROWTH !== 'undefined') ? GROWTH.slotLevels : window.GROWTH_REF || null,
      };
    } catch (e) { return { error: String(e) }; }
  });

  await browser.close();
  const out = path.join(__dirname, '..', 'docs', 'game_data.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(data, null, 2), 'utf8');
  console.log('exported:', out);
  console.log('counts:', JSON.stringify({
    crops: data.crops && data.crops.length,
    cropMaterials: data.cropMaterials && Object.keys(data.cropMaterials).length,
    resources: data.resources && Object.keys(data.resources).length,
    weapons: data.weapons && data.weapons.length,
    bosses: data.bosses && Object.keys(data.bosses).length,
    skills: data.skills && data.skills.length,
    consumables: data.consumables && data.consumables.length,
    maps: data.maps && data.maps.length,
    monsters: data.monsters && Object.keys(data.monsters).length,
  }));
}
main().catch(e => { console.error(e); process.exit(1); });
