/**
 * v5.2 角色动画验证：进入远征 → 移动玩家触发走路帧 → 靠近怪物 → 截图
 * 检查：playerWalkSheet 加载、怪物 4 状态图加载、无控制台错误
 */
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');
const FALLBACK = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SHOT = path.join(__dirname, 'test-results', 'anim-check');
fs.mkdirSync(SHOT, { recursive: true });

function shot(name) { return path.join(SHOT, name); }

async function main() {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch { browser = await chromium.launch({ headless: true, executablePath: FALLBACK }); }
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto(pathToFileURL(path.join(__dirname, 'index.html')).href);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: /开\s*始\s*游\s*戏/ }).click();
  await page.waitForSelector('#farmScreen');

  // 设置高等级、解锁技能、携带消耗品
  await page.evaluate(() => {
    GameState.gold = 99999; GameState.cultivation = 99999; GameState.level = 60;
    const s4 = CONFIG.skills.slice(0, 4).map(s => s.id);
    GameState.unlockedSkills = s4.slice();
    GameState.equippedSkills = s4.slice();
    Warehouse.addItem('herb_kit', 3);
    SaveSystem.save();
    Farm.render();
  });
  await page.waitForTimeout(300);

  // 进入远征准备大厅
  await page.getByRole('button', { name: /进入远征准备大厅/ }).click();
  await page.waitForSelector('#expeditionPrepScreen');
  await page.waitForTimeout(300);

  // 选第一张地图（最简单），选武器，出发
  await page.locator('.map-option').nth(1).click();
  await page.waitForTimeout(200);
  await page.locator('#weaponLoadoutSelect > div').first().click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: '确认配置并出发' }).click();
  await page.waitForSelector('#expeditionHUD');
  await page.waitForTimeout(500);

  // 检查资源加载
  const assetCheck = await page.evaluate(() => {
    const exp = Game.expedition;
    const walk = exp.playerWalkSheet;
    const walkOk = walk && walk.complete && walk.naturalWidth > 0;
    const walkFrames = walkOk ? walk.naturalWidth / 4 : 0;
    // 检查怪物 4 状态图
    const mobCheck = {};
    for (const t of ['bat', 'boar', 'spider']) {
      const sp = exp.monsterSprites[t];
      if (sp) {
        mobCheck[t] = {
          idle: sp.idle && sp.idle.complete && sp.idle.naturalWidth > 0,
          attack: sp.attack && sp.attack.complete && sp.attack.naturalWidth > 0,
          hit: sp.hit && sp.hit.complete && sp.hit.naturalWidth > 0,
          death: sp.death && sp.death.complete && sp.death.naturalWidth > 0,
        };
      }
    }
    return { walkOk, walkFrames, walkW: walk ? walk.naturalWidth : 0, walkH: walk ? walk.naturalHeight : 0, mobCheck, monsterCount: exp.monsters.length };
  });
  console.log('ASSET CHECK:', JSON.stringify(assetCheck, null, 2));

  // 把玩家传送到怪物附近
  await page.evaluate(() => {
    const exp = Game.expedition;
    const m = exp.monsters.find(x => x.type === 'bat' || x.type === 'boar' || x.type === 'spider') || exp.monsters[0];
    if (m) {
      exp.player.x = m.x - 60;
      exp.player.y = m.y;
      exp.camera.x = exp.player.x - CONFIG.canvas.width / 2;
      exp.camera.y = exp.player.y - CONFIG.canvas.height / 2;
    }
  });
  await page.waitForTimeout(300);

  // 截图 1：玩家静止（呼吸）+ 怪物 idle（呼吸）
  await page.screenshot({ path: shot('01_idle.png') });

  // 模拟按 d 键移动玩家 1.5 秒（触发走路帧动画）
  await page.keyboard.down('d');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot('02_walking.png') });
  await page.keyboard.up('d');
  await page.waitForTimeout(200);

  // 截图 3：玩家攻击（触发攻击前倾）
  await page.evaluate(() => {
    const exp = Game.expedition;
    const m = exp.monsters.find(x => x.hp > 0);
    if (m) {
      exp.player.x = m.x - 50;
      exp.player.y = m.y;
      exp.player.angle = 0;
      exp.camera.x = exp.player.x - CONFIG.canvas.width / 2;
      exp.camera.y = exp.player.y - CONFIG.canvas.height / 2;
    }
    exp.attackAnim = 0.24;
  });
  await page.waitForTimeout(100);
  await page.screenshot({ path: shot('03_attack.png') });

  // 让怪物攻击玩家（触发怪物 attackAnim）
  await page.evaluate(() => {
    const exp = Game.expedition;
    const m = exp.monsters.find(x => x.hp > 0);
    if (m) {
      m.attackAnim = 0.3;
      m.state = 'attack';
      m.facing = Math.PI; // 朝向玩家
    }
  });
  await page.waitForTimeout(100);
  await page.screenshot({ path: shot('04_monster_attack.png') });

  // 怪物受击（hitFlash）
  await page.evaluate(() => {
    const exp = Game.expedition;
    const m = exp.monsters.find(x => x.hp > 0);
    if (m) {
      m.hitFlash = 0.14;
      m.state = 'idle';
    }
  });
  await page.waitForTimeout(50);
  await page.screenshot({ path: shot('05_monster_hit.png') });

  // 怪物死亡
  await page.evaluate(() => {
    const exp = Game.expedition;
    const m = exp.monsters.find(x => x.hp > 0);
    if (m) {
      m.hp = 0;
      m.state = 'death';
      m.deathTimer = 0.42;
      m.stateTimer = 0.42;
    }
  });
  await page.waitForTimeout(100);
  await page.screenshot({ path: shot('06_monster_death.png') });

  await browser.close();

  console.log('\n=== 动画验证结果 ===');
  console.log('playerWalkSheet 加载:', assetCheck.walkOk, '帧宽:', assetCheck.walkFrames, '尺寸:', assetCheck.walkW + 'x' + assetCheck.walkH);
  console.log('怪物数量:', assetCheck.monsterCount);
  for (const [t, v] of Object.entries(assetCheck.mobCheck)) {
    console.log(`  ${t}: idle=${v.idle} attack=${v.attack} hit=${v.hit} death=${v.death}`);
  }
  console.log('控制台错误数:', errors.length);
  if (errors.length > 0) {
    errors.slice(0, 10).forEach(e => console.log('  -', e));
  }
  console.log('截图保存在:', SHOT);
  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
