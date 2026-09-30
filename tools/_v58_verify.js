// v5.8 农场页面验收脚本（headless chromium）
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = 'C:/Users/29401/Desktop/u/farm-cards-expedition';
const SHOT = path.join(ROOT, 'tools', '_v58_shots');
if (!fs.existsSync(SHOT)) fs.mkdirSync(SHOT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERR: ' + e.message));

  await page.goto('file:///' + ROOT.replace(/\\/g, '/') + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(1200);

  // 进入农场：直接调用 Game.startGame()
  await page.evaluate(() => { try { Game.startGame(); } catch (e) { console.warn('startGame', e); } });
  await page.waitForTimeout(1800);

  async function shot(name) {
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(SHOT, name + '.png') });
    console.log('shot', name);
  }

  // 1 顶栏占满 + 修为条
  await shot('01-topbar');

  // 2 农田真实格子（整页）
  await shot('02-farm-full');

  // 3 家园全景 2.5D
  await page.evaluate(() => { const hs = document.getElementById('farmHomestead'); if (hs) hs.scrollIntoView(); });
  await shot('03-panorama');

  // 4 一键种植弹窗
  try { await page.evaluate(() => Farm.plantAllPicker()); await page.waitForTimeout(500); await shot('04-plantpicker'); await page.keyboard.press('Escape'); await page.evaluate(() => { const o = document.getElementById('cropPickerOverlay'); if (o) o.classList.add('hidden'); }); await page.waitForTimeout(300); } catch (e) { console.log('picker err', e.message); }

  // 5 仓库独立全屏
  try { await page.evaluate(() => Warehouse.open()); await page.waitForTimeout(600); await shot('05-warehouse'); await page.evaluate(() => Warehouse.close()); await page.waitForTimeout(300); } catch (e) { console.log('wh err', e.message); }

  // 6 温室新作物
  try { await page.evaluate(() => Greenhouse.open()); await page.waitForTimeout(600); await shot('06-greenhouse'); await page.evaluate(() => Greenhouse.close ? Greenhouse.close() : (document.querySelectorAll('#greenhouseModal').forEach(m=>m.classList.add('hidden')))); await page.waitForTimeout(300); } catch (e) { console.log('gh err', e.message); }

  console.log('=== CONSOLE ERRORS ===');
  errors.slice(0, 20).forEach(e => console.log(e));
  console.log('total errors:', errors.length);

  await browser.close();
})();
