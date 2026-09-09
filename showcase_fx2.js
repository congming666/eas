const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

// 打击感特写截图 v2：近景高清，先展开视野再抓击中瞬间
async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  });
  const page = await browser.newPage({ viewport: { width: 1000, height: 640 }, deviceScaleFactor: 2 });
  const gameUrl = pathToFileURL(path.join(__dirname, 'index.html')).href;
  await page.goto(gameUrl);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForLoadState('networkidle');

  await page.evaluate(() => {
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
    // 玩家 + 3 只野猪排成扇形
    ex.monsters.length = 0;
    const base = CONFIG.monsters.boar;
    for (let i = 0; i < 3; i++) {
      const m = {
        ...base,
        type: 'boar', x: 780 + i * 4, y: 340 + (i - 1) * 78,
        hp: 500, maxHp: 500, damage: 15, speed: 140,
        attackCd: 9, stunned: 0, state: 'idle', stateTimer: 0,
        animTime: 0, hitFlash: 0, deathTimer: 0, visualZ: 0, visualVz: 0,
        facing: Math.PI, elite: false, target: null, vx: 0, vy: 0,
      };
      ex.monsters.push(m);
    }
    ex.player.x = 640; ex.player.y = 340;
    ex.camera.x = ex.player.x - 500;
    ex.camera.y = ex.player.y - 320;
    ex.mouse.x = 820 - ex.camera.x;
    ex.mouse.y = 340 - ex.camera.y;
    ex.player.hp = 9999; ex.player.maxHp = 9999;
  });

  // 先跑 40 帧展开视野并清空旧粒子
  await page.evaluate(() => {
    const c = document.getElementById('gameCanvas');
    const ctx = c.getContext('2d');
    const ex = Game.expedition;
    for (let i = 0; i < 40; i++) { ex.update(1 / 60); ctx.clearRect(0, 0, c.width, c.height); ex.render(ctx, 0); }
    ex.particles.length = 0;
    ex.damageNumbers.length = 0;
  });

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
    await page.screenshot({
      path: path.join(__dirname, name),
      clip: { x: 300, y: 120, width: 640, height: 430 },
    });
  }

  // 特写1：近战终结技（combo 2）击中瞬间
  await page.evaluate(() => {
    const ex = Game.expedition;
    ex.attackCombo = 1;
    ex.player.attackCd = 0;
    ex.playerAttack();
    ex.player.attackCd = 0;
    ex.playerAttack();
    ex.player.attackCd = 0;
    ex.playerAttack();
  });
  await snap('fx2-melee-finisher.png', 0);

  // 特写2：豌豆命中（光爆 + 火花 + 伤害数字）
  await page.evaluate(() => {
    const ex = Game.expedition;
    ex.weapon = CONFIG.weapons[1];
    ex.monsters.forEach(m => { m.hp = 500; m.hitFlash = 0; });
    ex.particles.length = 0;
    ex.damageNumbers.length = 0;
    ex.projectiles.length = 0;
    ex.player.attackCd = 0;
    ex.playerAttack();
  });
  await snap('fx2-pea-hit.png', 8);

  // 特写3：击杀爆裂（径向迸溅 + 冲击环 + 白闪）
  await page.evaluate(() => {
    const ex = Game.expedition;
    ex.monsters.forEach(m => { m.hp = 1; m.deathProcessed = false; m.deathTimer = 0; });
    ex.particles.length = 0;
    ex.damageNumbers.length = 0;
    ex.damageEnemy(ex.monsters[1], 99, '#f2c45b', true, { x: ex.monsters[1].x, y: ex.monsters[1].y, angle: Math.PI, weaponId: 'harvest_sickle', fromPlayer: true });
    ex.monsters[1].hp = 0;
    ex.monsters[1].deathProcessed = true;
    ex.monsters[1].deathTimer = 0.42;
    ex.spawnKillFeedback(ex.monsters[1]);
    ex.spawnHitParticles(ex.monsters[1].x, ex.monsters[1].y, '#ff4444');
  });
  await snap('fx2-kill.png', 1);

  await browser.close();
  console.log('SHOWCASE V2 DONE');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
