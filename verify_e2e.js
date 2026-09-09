const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

// 端到端回归：菜单 → 农场 → 准备大厅 → 远征实战（真实点击 + 自动攻击 + 换武器 + 受击）
async function main() {
  const consoleErrors = [];
  const pageErrors = [];
  const gameUrl = pathToFileURL(path.join(__dirname, 'index.html')).href;

  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => pageErrors.push(String(error)));

  await page.goto(gameUrl, { timeout: 60000 });
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: '开 始 游 戏' }).click();
  if (!(await page.locator('#farmScreen').isVisible())) throw new Error('农场未显示');
  await page.waitForTimeout(300);

  // 给足金币并直接进准备大厅
  await page.evaluate(() => { GameState.gold = 2500; SaveSystem.save(); Farm.render(); });
  await page.getByRole('button', { name: /进入远征准备大厅/ }).click();
  if (!(await page.locator('#expeditionPrepScreen').isVisible())) throw new Error('准备大厅未显示');

  // 选 T1 地图，不选强化卡直接出发（用默认武器镰刃）
  await page.locator('.map-option').first().click();
  await page.getByRole('button', { name: '确认配置并出发' }).click();
  if (!(await page.locator('#expeditionHUD').isVisible())) throw new Error('远征 HUD 未显示');

  // 把玩家放到怪物群附近，按住左键自动攻击 240 帧（真实玩家攻击路径）
  await page.evaluate(() => {
    const ex = Game.expedition;
    const m = ex.monsters.find(x => x.hp > 0);
    if (m) {
      ex.player.x = m.x - 60;
      ex.player.y = m.y;
      ex.camera.x = ex.player.x - CONFIG.canvas.width / 2;
      ex.camera.y = ex.player.y - CONFIG.canvas.height / 2;
      ex.mouse.x = m.x - ex.camera.x;
      ex.mouse.y = m.y - ex.camera.y;
      ex.player.hp = 9999;
      ex.mouse.down = true;
    }
  });
  await page.evaluate(() => {
    const c = document.getElementById('gameCanvas');
    const ctx = c.getContext('2d');
    const ex = Game.expedition;
    for (let i = 0; i < 240; i++) {
      if (ex.hitStop > 0) { ex.hitStop = Math.max(0, ex.hitStop - 1 / 60); }
      else ex.update(1 / 60);
      ctx.clearRect(0, 0, c.width, c.height);
      ex.render(ctx, 0);
    }
    ex.mouse.down = false;
  });
  const meleeResult = await page.evaluate(() => {
    const ex = Game.expedition;
    return {
      kills: ex.killCount,
      comboSeen: ex.attackCombo,
      particles: ex.particles.length,
      sounds: typeof AudioManager.playAttack === 'function',
    };
  });
  if (meleeResult.kills <= 0) throw new Error('自动攻击没有击杀任何怪物');
  console.log('实战自动攻击 OK:', JSON.stringify(meleeResult));

  // 换武器：豌豆连弩，按住左键攻击 180 帧
  await page.evaluate(() => {
    const ex = Game.expedition;
    ex.player.hp = 9999;
    const m = ex.monsters.find(x => x.hp > 0);
    if (m) {
      ex.player.x = m.x - 200;
      ex.player.y = m.y;
      ex.mouse.x = m.x - ex.camera.x;
      ex.mouse.y = m.y - ex.camera.y;
    }
    ex.mouse.down = true;
  });
  await page.keyboard.press('Tab');
  await page.evaluate(() => {
    const c = document.getElementById('gameCanvas');
    const ctx = c.getContext('2d');
    const ex = Game.expedition;
    for (let i = 0; i < 180; i++) {
      if (ex.hitStop > 0) { ex.hitStop = Math.max(0, ex.hitStop - 1 / 60); }
      else ex.update(1 / 60);
      ctx.clearRect(0, 0, c.width, c.height);
      ex.render(ctx, 0);
    }
    ex.mouse.down = false;
  });
  const rangedResult = await page.evaluate(() => {
    const ex = Game.expedition;
    return { weapon: ex.weapon.id, projectiles: ex.projectiles.length };
  });
  if (rangedResult.weapon !== 'pea_repeater') throw new Error('武器切换失败');
  console.log('远程实战 OK:', JSON.stringify(rangedResult));

  // 受击反馈：让怪物打玩家一下，检查红屏 + 冲击环
  const hurt = await page.evaluate(() => {
    const ex = Game.expedition;
    ex.player.invuln = 0;
    ex.damagePlayer(10);
    return {
      damageFlash: ex.playerDamageFlash > 0,
      shake: ex.screenShake > 0,
      shock: ex.particles.some(p => p.type === 'shock'),
    };
  });
  if (!hurt.damageFlash || !hurt.shake || !hurt.shock) throw new Error('受击反馈缺失: ' + JSON.stringify(hurt));
  console.log('受击反馈 OK:', JSON.stringify(hurt));

  await page.screenshot({ path: path.join(__dirname, 'e2e-combat.png') });
  await browser.close();

  if (consoleErrors.length || pageErrors.length) {
    throw new Error('浏览器错误：' + JSON.stringify({ consoleErrors, pageErrors }));
  }
  console.log('E2E COMBAT TEST PASSED');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
