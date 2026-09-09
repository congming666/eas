const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

// 打击感特写截图：近战终结技瞬间 / 远程弹道飞行 / 击杀爆裂瞬间
async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const gameUrl = pathToFileURL(path.join(__dirname, 'index.html')).href;
  await page.goto(gameUrl);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForLoadState('networkidle');

  // 构造远征场景：玩家 + 3 只怪物排成扇形
  await page.evaluate(() => {
    GameState.gold = 1000;
    GameState.selectedMap = 't1';
    GameState.selectedWeapon = 'harvest_sickle';
    Game.expedition = new Expedition('t1');
    GameState.expedition = Game.expedition;
    // 隐藏菜单/星云等覆盖层，让远征画布可见
    document.getElementById('mainMenu').classList.add('hidden');
    ['nebulaBg', 'nebulaCanvas', 'nebulaTextFx'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.visibility = 'hidden';
    });
    document.getElementById('expeditionHUD').classList.remove('hidden');
    const ex = Game.expedition;
    ex.monsters.length = 0;
    const base = CONFIG.monsters.boar;
    for (let i = 0; i < 3; i++) {
      const m = {
        ...base,
        type: 'boar', x: 700, y: 360 + (i - 1) * 70,
        hp: 500, maxHp: 500, damage: 15, speed: 140,
        attackCd: 9, stunned: 0, state: 'idle', stateTimer: 0,
        animTime: 0, hitFlash: 0, deathTimer: 0, visualZ: 0, visualVz: 0,
        facing: Math.PI, elite: false, target: null, vx: 0, vy: 0,
      };
      ex.monsters.push(m);
    }
    ex.player.x = 620; ex.player.y = 360;
    ex.camera.x = ex.player.x - CONFIG.canvas.width / 2;
    ex.camera.y = ex.player.y - CONFIG.canvas.height / 2;
    ex.mouse.x = 700 - ex.camera.x;
    ex.mouse.y = 360 - ex.camera.y;
    ex.player.hp = 9999; ex.player.maxHp = 9999;
  });

  async function frame(count) {
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
    }, count);
  }

  // 特写1：近战终结技击中瞬间（第3击 → 冲击环 + 光爆 + 火花 + 击退）
  await page.evaluate(() => {
    const ex = Game.expedition;
    ex.attackCombo = 1; // 下一击为 2（突刺终结）
    ex.player.attackCd = 0;
    ex.particles.length = 0;
    ex.playerAttack();
    ex.player.attackCd = 0;
    ex.playerAttack();
    ex.player.attackCd = 0;
    ex.playerAttack();
  });
  await frame(0);
  await page.screenshot({ path: path.join(__dirname, 'fx-slice-finisher.png') });
  await frame(4);
  await page.screenshot({ path: path.join(__dirname, 'fx-slice-followup.png') });

  // 特写2：豌豆连弩弹道 + 命中火花
  await page.evaluate(() => {
    const ex = Game.expedition;
    ex.weapon = CONFIG.weapons[1];
    ex.monsters.forEach(m => { m.hp = 500; });
    ex.particles.length = 0;
    ex.projectiles.length = 0;
    ex.player.attackCd = 0;
    ex.playerAttack();
  });
  await frame(6);
  await page.screenshot({ path: path.join(__dirname, 'fx-pea-hit.png') });

  // 特写3：击杀爆裂（击杀光环 + 径向迸溅 + 冲击环）
  await page.evaluate(() => {
    const ex = Game.expedition;
    const m = ex.monsters[0];
    if (m) { m.hp = 1; ex.damageEnemy(m, 99, '#75dc68', false, { x: m.x, y: m.y, angle: Math.PI, weaponId: 'pea_repeater', fromPlayer: true }); }
    ex.particles.length = 0;
    ex.monsters.forEach(x => { x.hp = 1; x.deathProcessed = false; ex.spawnKillFeedback(x); });
  });
  await frame(2);
  await page.screenshot({ path: path.join(__dirname, 'fx-kill.png') });

  await browser.close();
  console.log('SHOWCASE SCREENSHOTS DONE');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
