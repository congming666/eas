const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

// 打击感专项验证：连击 / 暴击 / 新特效粒子 / 击退 / 后坐 / 音效方法
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

  await page.goto(gameUrl);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForLoadState('networkidle');

  // 直接构造远征场景（t1，镰刃）
  await page.evaluate(() => {
    GameState.gold = 1000;
    GameState.selectedMap = 't1';
    GameState.selectedWeapon = 'harvest_sickle';
    Game.expedition = new Expedition('t1');
    GameState.expedition = Game.expedition;
    Game.expedition.updateHUD();
    // 把玩家挪到第一只怪物旁边并面向它
    const m = Game.expedition.monsters[0];
    if (m) {
      Game.expedition.player.x = m.x + 40;
      Game.expedition.player.y = m.y;
      Game.expedition.mouse.x = m.x - Game.expedition.camera.x;
      Game.expedition.mouse.y = m.y - Game.expedition.camera.y;
    }
    // 提供足够的 HP 防止测试中途死亡
    Game.expedition.player.hp = 9999;
    Game.expedition.player.maxHp = 9999;
  });

  // —— 近战连击：连打 6 次，应循环 0→1→2 两轮 ——
  const melee = await page.evaluate(() => {
    const ex = Game.expedition;
    const combos = [];
    for (let i = 0; i < 6; i++) {
      ex.player.attackCd = 0;
      ex.playerAttack();
      combos.push(ex.attackCombo);
    }
    const types = {};
    ex.particles.forEach(p => { types[p.type || 'basic'] = (types[p.type || 'basic'] || 0) + 1; });
    const monster = ex.monsters.find(m => (m.knockX || m.knockY));
    return {
      combos,
      particleTypes: types,
      knockback: monster ? { x: monster.knockX, y: monster.knockY } : null,
      playerLunge: { x: ex.player.lungeX, y: ex.player.lungeY },
      weaponRecoil: ex.weaponRecoil,
      damageNumbers: ex.damageNumbers.length,
    };
  });
  const comboOk = JSON.stringify(melee.combos) === JSON.stringify([1, 2, 0, 1, 2, 0]);
  if (!comboOk) throw new Error('近战连击序号不循环: ' + JSON.stringify(melee.combos));
  for (const t of ['impact', 'splat', 'slash', 'trail']) {
    if (!melee.particleTypes[t]) throw new Error('缺少近战特效粒子: ' + t);
  }
  if (!melee.knockback) throw new Error('怪物没有被击退');
  if (melee.weaponRecoil <= 0) throw new Error('武器后坐未触发');
  if (melee.damageNumbers <= 0) throw new Error('没有伤害跳字');
  console.log('近战连击/特效/击退/后坐 OK:', JSON.stringify(melee.combos), '粒子=', JSON.stringify(melee.particleTypes));

  // —— 渲染 60 帧（含新粒子类型）不应报错 ——
  await page.evaluate(() => {
    const c = document.getElementById('gameCanvas');
    const ctx = c.getContext('2d');
    const ex = Game.expedition;
    for (let i = 0; i < 60; i++) {
      ex.update(1 / 60);
      ctx.clearRect(0, 0, c.width, c.height);
      ex.render(ctx, 0);
    }
  });
  console.log('近战 60 帧 update+render 无异常');

  // —— 远程武器：豌豆连弩 ——
  const ranged = await page.evaluate(() => {
    const ex = Game.expedition;
    ex.weapon = CONFIG.weapons[1]; // pea_repeater
    ex.attackCombo = 0;
    ex.player.attackCd = 0;
    ex.projectiles.length = 0;
    ex.playerAttack();
    return {
      projectileCount: ex.projectiles.length,
      recoil: ex.weaponRecoil,
      muzzle: ex.particles.filter(p => p.type === 'spark').length,
    };
  });
  if (ranged.projectileCount !== 1) throw new Error('豌豆连弩未发射弹道');
  if (ranged.recoil <= 0) throw new Error('远程后坐未触发');
  console.log('远程发射/后坐 OK:', JSON.stringify(ranged));

  // —— 暴击：大量伤害样本中应出现 crit 标记 ——
  const critInfo = await page.evaluate(() => {
    const ex = Game.expedition;
    ex.damageNumbers.length = 0;
    let critCount = 0;
    for (let i = 0; i < 60; i++) {
      const m = ex.monsters.find(x => x.hp > 0);
      if (!m) break;
      ex.damageEnemy(m, 10, '#75dc68', false, { x: m.x, y: m.y, angle: 0, weaponId: 'pea_repeater', fromPlayer: true });
      if (ex.damageNumbers.some(n => n.crit)) critCount++;
      ex.damageNumbers.length = 0;
    }
    return { critCount, critFlash: ex.critFlash };
  });
  if (critInfo.critCount === 0) throw new Error('60 次玩家伤害未出现一次暴击（概率异常）');
  console.log('暴击触发 OK: 60 次伤害中暴击 ' + critInfo.critCount + ' 次');

  // —— 拖尾刀光：每次近战挥击应产生 3 层 trail ——
  const trailInfo = await page.evaluate(() => {
    const ex = Game.expedition;
    ex.particles.length = 0;
    ex.weapon = CONFIG.weapons[0];
    ex.player.attackCd = 0;
    ex.playerAttack();
    const trails = ex.particles.filter(p => p.type === 'trail');
    return { count: trails.length, layers: trails.map(p => p.layer).sort() };
  });
  if (trailInfo.count < 3) throw new Error('拖尾刀光不足 3 层: ' + trailInfo.count);
  console.log('拖尾刀光 OK: 单层挥击产生', trailInfo.count, '层');

  // —— 冻结碎裂：减速（冰冻）状态受击出 ice 粒子，死亡大碎裂 ——
  const frostInfo = await page.evaluate(() => {
    const ex = Game.expedition;
    const base = CONFIG.monsters.boar;
    const mk = (hp, x) => ({ ...base, type: 'boar', x, y: ex.player.y, hp, maxHp: hp, damage: 1, speed: 100,
      attackCd: 9, stunned: 0, slow: 0.3, state: 'idle', stateTimer: 0, animTime: 0, hitFlash: 0,
      facing: 0, elite: false, target: null, vx: 0, vy: 0, radius: 18 });
    const m = mk(500, ex.player.x + 50);
    ex.monsters.push(m);
    ex.particles.length = 0;
    ex.damageEnemy(m, 20, '#f2c45b', false, { x: m.x, y: m.y, angle: 0, weaponId: 'harvest_sickle', fromPlayer: true });
    const smallIce = ex.particles.filter(p => p.type === 'ice').length;
    ex.particles.length = 0;
    const m2 = mk(1, ex.player.x + 50);
    ex.monsters.push(m2);
    ex.damageEnemy(m2, 99, '#f2c45b', false, { x: m2.x, y: m2.y, angle: 0, weaponId: 'harvest_sickle', fromPlayer: true });
    const bigIce = ex.particles.filter(p => p.type === 'ice').length;
    return { smallIce, bigIce };
  });
  if (frostInfo.smallIce < 5) throw new Error('冰冻受击未碎裂: ' + frostInfo.smallIce);
  if (frostInfo.bigIce < 15) throw new Error('冰冻死亡未大碎裂: ' + frostInfo.bigIce);
  console.log('冻结碎裂 OK: 受击', frostInfo.smallIce, '片 / 死亡', frostInfo.bigIce, '片');

  // —— 火焰灼烧：applyBurn 后 update 跳伤害、出 flame 粒子，且 quiet 不击退 ——
  const burnInfo = await page.evaluate(() => {
    const ex = Game.expedition;
    ex.monsters.length = 0;
    const base = CONFIG.monsters.boar;
    const m = { ...base, type: 'boar', x: ex.player.x + 80, y: ex.player.y, hp: 9999, maxHp: 9999,
      damage: 1, speed: 100, attackCd: 9, stunned: 0, state: 'idle', stateTimer: 0, animTime: 0,
      hitFlash: 0, facing: 0, elite: false, target: null, vx: 0, vy: 0, radius: 18 };
    ex.monsters.push(m);
    ex.applyBurn(m, 30, 3);
    const hp0 = m.hp;
    let flames = 0;
    for (let i = 0; i < 90; i++) { ex.update(1 / 60); if (i === 60) flames = ex.particles.filter(p => p.type === 'flame').length; }
    return { hpLost: hp0 - m.hp, flames, knockX: m.knockX || 0, stillBurning: !!m.burn };
  });
  if (burnInfo.hpLost <= 0) throw new Error('灼烧未造成持续伤害');
  if (burnInfo.flames === 0) throw new Error('灼烧没有火焰粒子');
  if (burnInfo.knockX !== 0) throw new Error('灼烧跳伤不应击退');
  console.log('灼烧 OK: 1.5s 造成', burnInfo.hpLost.toFixed(1), '伤害, 火焰粒子', burnInfo.flames);

  // —— 电击链：藤杖命中后向 120px 内最近敌人跳跃 ——
  const chainInfo = await page.evaluate(() => {
    const ex = Game.expedition;
    ex.monsters.length = 0;
    const base = CONFIG.monsters.boar;
    const mk = (x) => ({ ...base, type: 'boar', x, y: ex.player.y, hp: 9999, maxHp: 9999, damage: 1,
      speed: 100, attackCd: 9, stunned: 0, state: 'idle', stateTimer: 0, animTime: 0, hitFlash: 0,
      facing: 0, elite: false, target: null, vx: 0, vy: 0, radius: 18 });
    const a = mk(ex.player.x + 60), b = mk(ex.player.x + 150), c = mk(ex.player.x + 240);
    ex.monsters.push(a, b, c);
    ex.particles.length = 0;
    const hpB0 = b.hp, hpC0 = c.hp;
    const proj = { damage: 24, hit: [a] };
    ex.lightningChainFrom(a, proj, proj.hit, 2, 0.55);
    return {
      chains: ex.particles.filter(p => p.type === 'chain').length,
      bHurt: b.hp < hpB0, cHurt: c.hp < hpC0,
      hitSet: proj.hit.length,
    };
  });
  if (chainInfo.chains < 2) throw new Error('电击链折线不足: ' + chainInfo.chains);
  if (!chainInfo.bHurt || !chainInfo.cHurt) throw new Error('电击链未跳跃伤害: ' + JSON.stringify(chainInfo));
  console.log('电击链 OK: 折线', chainInfo.chains, '道, 连跳', chainInfo.hitSet - 1, '个敌人');

  // —— 音效方法可调用、不抛异常 ——
  const audioOk = await page.evaluate(() => {
    try {
      AudioManager.playAttack('melee', 2);
      AudioManager.playAttack('pea');
      AudioManager.playAttack('vine');
      AudioManager.playMonsterHit('normal', 'harvest_sickle');
      AudioManager.playMonsterHit('heavy', 'pea_repeater');
      AudioManager.playMonsterHit('crit', 'vine_staff');
      AudioManager.playCritHit();
      AudioManager.playBossHit();
      AudioManager.playZap();
      AudioManager.playFrostShatter();
      AudioManager.playIgnite();
      AudioManager.playBurnTick();
      return true;
    } catch (e) { return String(e); }
  });
  if (audioOk !== true) throw new Error('音效方法异常: ' + audioOk);
  console.log('全部音效方法调用 OK');

  await page.screenshot({ path: path.join(__dirname, 'combat-feel-test.png') });
  await browser.close();

  if (consoleErrors.length || pageErrors.length) {
    throw new Error('浏览器错误：' + JSON.stringify({ consoleErrors, pageErrors }));
  }
  console.log('COMBAT FEEL TEST PASSED');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
