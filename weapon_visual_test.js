const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

(async () => {
  const errors = [];
  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(pathToFileURL(path.join(__dirname, 'index.html')).href, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.clear();
    GameState.gold = 5000;
    GameState.selectedMap = 't1';
    document.getElementById('mainMenu').classList.add('hidden');
    Game.startExpedition();
  });
  await page.waitForTimeout(800);

  const result = await page.evaluate(() => {
    const expedition = Game.expedition;
    const weapons = [expedition.weapon.id];
    expedition.cycleWeapon(1); weapons.push(expedition.weapon.id);
    expedition.mouse.x = 900; expedition.mouse.y = 360;
    expedition.player.attackCd = 0; expedition.playerAttack();
    const rangedProjectile = expedition.projectiles.some(projectile => projectile.weaponId === 'pea_repeater');
    expedition.cycleWeapon(1); weapons.push(expedition.weapon.id);
    expedition.player.attackCd = 0; expedition.playerAttack();
    const piercingProjectile = expedition.projectiles.some(projectile => projectile.weaponId === 'vine_staff');
    const effects = [];
    CONFIG.skills.forEach((skill, index) => {
      expedition.player.energy = 100;
      expedition.skillCooldowns[index] = 0;
      expedition.useSkill(index);
      effects.push(skill.id);
    });
    expedition.updateHUD();
    return { weapons, rangedProjectile, piercingProjectile, effects,
      weaponLabel: document.getElementById('weaponDisplay').innerText,
      objective: expedition.objective?.type };
  });

  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(__dirname, 'weapon-effects-test.png'), fullPage: true });
  await page.evaluate(() => {
    Game.expedition.player.stealth = 0;
    Game.expedition.particles = [];
    Game.expedition.projectiles = [];
    Game.expedition.updateHUD();
  });
  await page.waitForTimeout(80);
  await page.screenshot({ path: path.join(__dirname, 'weapon-hero-test.png'), fullPage: true });
  if (result.weapons.join(',') !== 'harvest_sickle,pea_repeater,vine_staff') throw new Error(`武器轮换错误: ${result.weapons}`);
  if (!result.rangedProjectile || !result.piercingProjectile) throw new Error('远程武器未生成独立弹道');
  if (!result.weaponLabel.includes('藤芯法杖')) throw new Error('武器 HUD 未显示当前武器');
  if (!result.objective || result.effects.length !== 4) throw new Error('远征任务或技能系统未初始化');
  if (errors.length) throw new Error(`浏览器错误: ${errors.join(' | ')}`);
  console.log(JSON.stringify(result));
  await browser.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
