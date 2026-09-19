/**
 * 最终 UI 巡检：截图农场/作物详情/铁匠铺/仓库/准备大厅五个关键界面。
 * 全部走游戏真实公开方法，不做非常规 DOM 强删。
 */
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');
const FALLBACK = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SHOT = path.join(__dirname, 'test-results', 'final-ui');

async function closeOverlays(page) {
  await page.evaluate(() => {
    if (typeof Warehouse !== 'undefined' && Warehouse.close) { try { Warehouse.close(); } catch (e) {} }
    document.querySelectorAll('.overlay .close-btn').forEach(b => b.click());
    document.querySelectorAll('.modal-overlay[data-dynamic="1"]').forEach(o => o.remove());
  });
  await page.waitForTimeout(150);
}

async function main() {
  fs.mkdirSync(SHOT, { recursive: true });
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch { browser = await chromium.launch({ headless: true, executablePath: FALLBACK }); }
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(pathToFileURL(path.join(__dirname, 'index.html')).href);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: /开\s*始\s*游\s*戏/ }).click();
  await page.waitForSelector('#farmScreen');

  await page.evaluate(() => {
    GameState.gold = 99999; GameState.cultivation = 99999; GameState.level = 60;
    GameState.warehouse.materials = { wood: 99, stone: 99, fiber: 99, iron: 99, refined_iron: 9, crystal: 99, venom: 9, carapace: 9, soul_ash: 9, bossFang: 9, compost: 9, soil: 9, water: 9, herb: 9 };
    Warehouse.addItem('herb_kit', 3); Warehouse.addItem('thorn_storm', 2);
    ['straw_smash','vine_bind','earth_dash','smoke_screen'].forEach(id => { if (!CharacterSystem.getEquipped().includes(id)) CharacterSystem.equip(id); });
    // 选中仙人掌以展示材料产出详情卡
    GameState.selectedCrop = 'cactus';
    Farm.renderCropDetail();
    SaveSystem.save();
  });
  await page.waitForTimeout(400);

  // 1+2. 农场全景（含 48 格与作物详情卡）
  await page.screenshot({ path: path.join(SHOT, '1-farm-cropdetail.png') });

  // 3. 铁匠铺（材料/修为双按钮）
  await page.evaluate(() => Game.openBlacksmith());
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOT, '2-blacksmith.png') });
  await closeOverlays(page);

  // 4. 仓库（材料分区）
  await page.evaluate(() => Warehouse.open());
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOT, '3-warehouse.png') });
  await closeOverlays(page);

  // 5. 准备大厅（技能预览 + 消耗品携带）
  await page.evaluate(() => Game.openExpeditionPrep());
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOT, '4-loadout.png') });

  await browser.close();
  const real = errors.filter(e => !/favicon|Failed to load resource|404/i.test(e));
  const report = 'errors: ' + real.length + '\n' + JSON.stringify(real, null, 1) + '\nshots: ' + fs.readdirSync(SHOT).join(', ');
  fs.writeFileSync(path.join(SHOT, 'report.txt'), report, 'utf8');
  if (real.length) { console.error(report); process.exit(1); }
  console.log(report);
}
main().catch(e => { console.error(e); process.exit(1); });
