const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

// 第二轮新特效特写：冻结碎裂 / 火焰灼烧 / 电击链 / 拖尾刀光
async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  });
  const page = await browser.newPage({ viewport: { width: 1000, height: 640 }, deviceScaleFactor: 2 });
  const gameUrl = pathToFileURL(path.join(__dirname, 'index.html')).href;
  await page.goto(gameUrl, { timeout: 60000 });
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForLoadState('networkidle');

  async function setup(count) {
    await page.evaluate((n) => {
      GameState.gold = 1000;
      GameState.selectedMap = 't1';
      GameState.selectedWeapon = 'harvest_sickle';
      Game.expedition = new Expedition('t1');
      GameState.expedition = Game.expedition;
      document.getElementById('mainMenu').classList.add('hidden');
      ['nebulaBg', 'nebulaCanvas', 'nebulaTextFx'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.visibility = 'hidden';
      });
      document.getElementById('expeditionHUD').classList.remove('hidden');
      const ex = Game.expedition;
      ex.monsters.length = 0;
      const base = CONFIG.monsters.boar;
      for (let i = 0; i < n; i++) {
        ex.monsters.push({ ...base, type: 'boar', x: 760 + i * 70, y: 340, hp: 9999, maxHp: 9999,
          damage: 1, speed: 0, attackCd: 99, stunned: 0, state: 'idle', stateTimer: 0,
          animTime: i, hitFlash: 0, facing: Math.PI, elite: false, target: null, vx: 0, vy: 0 });
      }
      ex.player.x = 640; ex.player.y = 340;
      ex.camera.x = ex.player.x - 500;
      ex.camera.y = ex.player.y - 320;
      ex.mouse.x = 820 - ex.camera.x;
      ex.mouse.y = 340 - ex.camera.y;
      ex.player.hp = 9999; ex.player.maxHp = 9999;
      const c = document.getElementById('gameCanvas');
      const ctx = c.getContext('2d');
      for (let i = 0; i < 40; i++) { ex.update(1 / 60); ctx.clearRect(0, 0, c.width, c.height); ex.render(ctx, 0); }
      ex.particles.length = 0;
      ex.damageNumbers.length = 0;
    }, count);
  }

  async function snap(name, frames) {
    await page.evaluate((n) => {
      const c = document.getElementById('gameCanvas');
      const ctx = c.getContext('2d');
      const ex = Game.expedition;
      for (let i = 0; i < n; i++) {
        if (ex.hitStop > 0) { ex.hitStop = Math.max(0, ex.hitStop - 1 / 60); }
        else ex.update(1 / 60);
        ctx.clearRect(0, 0, c.width, c.height);
        ex.render(ctx, 0);
      }
    }, frames);
    await page.screenshot({ path: path.join(__dirname, name), clip: { x: 300, y: 120, width: 640, height: 430 } });
  }

  // 1 冻结碎裂：怪物带 slow（寒冰藤冰冻状态），受击碎冰 + 死亡大碎裂
  await setup(2);
  await page.evaluate(() => {
    const ex = Game.expedition;
    ex.monsters[0].slow = 0.3;
    ex.damageEnemy(ex.monsters[0], 30, '#f2c45b', false, { x: ex.monsters[0].x, y: ex.monsters[0].y, angle: 0, weaponId: 'harvest_sickle', fromPlayer: true, crit: false });
    ex.monsters[1].slow = 0.3;
    ex.monsters[1].hp = 1;
    ex.damageEnemy(ex.monsters[1], 99, '#f2c45b', true, { x: ex.monsters[1].x, y: ex.monsters[1].y, angle: 0, weaponId: 'harvest_sickle', fromPlayer: true, crit: false });
  });
  await snap('fx3-frost.png', 1);

  // 2 火焰灼烧：暴击点燃 + applyBurn，跑 12 帧让火焰飘起
  await setup(3);
  await page.evaluate(() => {
    const ex = Game.expedition;
    ex.monsters.forEach(m => ex.applyBurn(m, 26, 3));
  });
  await snap('fx3-burn.png', 12);

  // 3 电击链：三只怪排成线，藤杖命中第一只后连跳
  await setup(3);
  await page.evaluate(() => {
    const ex = Game.expedition;
    ex.weapon = CONFIG.weapons[2]; // vine_staff
    ex.monsters.forEach((m, i) => { m.x = 740 + i * 120; });
    ex.camera.x = 140; ex.camera.y = 20;
    const a = ex.monsters[0];
    const proj = { damage: 24, hit: [a] };
    ex.damageEnemy(a, 24, '#7be5c4', false, { x: a.x, y: a.y, angle: 0, weaponId: 'vine_staff', fromPlayer: true, crit: false, quiet: true });
    ex.lightningChainFrom(a, proj, proj.hit, 2, 0.55);
  });
  await snap('fx3-chain.png', 1);

  // 4 拖尾刀光：三连击全部打出，三层残留弧光同时在屏
  await setup(1);
  await page.evaluate(() => {
    const ex = Game.expedition;
    ex.weapon = CONFIG.weapons[0];
    for (let i = 0; i < 3; i++) { ex.player.attackCd = 0; ex.playerAttack(); }
  });
  await snap('fx3-blade.png', 5);

  await browser.close();
  console.log('SHOWCASE V3 DONE');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
