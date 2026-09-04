const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

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
  if ((await page.title()) !== '农庄牌：荒野远征 v1.9') throw new Error('标题不正确');
  if (!(await page.locator('#mainMenu').isVisible())) throw new Error('主菜单未显示');

  await page.getByRole('button', { name: '开始游戏' }).click();
  if (!(await page.locator('#farmScreen').isVisible())) throw new Error('农场界面未显示');
  if (!(await page.evaluate(() => Boolean(AudioManager.ctx)))) throw new Error('背景音乐没有初始化');
  await page.locator('#musicToggle').click();
  if (!(await page.locator('#musicToggle').innerText()).includes('关')) throw new Error('音乐关闭按钮无效');
  await page.locator('#musicToggle').click();
  if (!(await page.locator('#musicToggle').innerText()).includes('开')) throw new Error('音乐开启按钮无效');
  if ((await page.locator('.farm-cell').count()) !== 36) throw new Error('农田格子数量不正确');
  if ((await page.locator('.farm-cell.locked').count()) !== 28) throw new Error('初始锁定农田数量不正确');
  if ((await page.locator('.farm-cell:not(.locked)').count()) !== 8) throw new Error('初始开放农田数量不正确');
  if (await page.locator('#expeditionPrepScreen').isVisible()) throw new Error('远征准备界面不应与农场同时显示');
  if (!(await page.locator('#dailyRewardButton').isVisible())) throw new Error('每日奖励入口未显示');
  if (!(await page.locator('#reliefRewardButton').isVisible())) throw new Error('开荒保障入口未显示');

  const dailyBefore = await page.evaluate(() => ({ gold: GameState.gold, seeds: GameState.seeds }));
  await page.locator('#dailyRewardButton').click();
  const dailyAfter = await page.evaluate(() => ({ gold: GameState.gold, seeds: GameState.seeds, claim: GameState.lastDailyClaim }));
  if (dailyAfter.gold <= dailyBefore.gold || dailyAfter.seeds <= dailyBefore.seeds || !dailyAfter.claim) throw new Error('每日奖励领取失败');
  if (!(await page.locator('#dailyRewardButton').isDisabled())) throw new Error('每日奖励可以重复领取');

  await page.evaluate(() => {
    GameState.gold = 20;
    GameState.seeds = 0;
    GameState.lastReliefClaim = '';
    Farm.render();
  });
  if (await page.locator('#reliefRewardButton').isDisabled()) throw new Error('资源耗尽时没有开放开荒保障');
  await page.locator('#reliefRewardButton').click();
  const reliefAfter = await page.evaluate(() => ({ gold: GameState.gold, seeds: GameState.seeds, claim: GameState.lastReliefClaim }));
  if (reliefAfter.gold !== 120 || reliefAfter.seeds !== 3 || !reliefAfter.claim) throw new Error('开荒保障没有补足基础资源');
  if (!(await page.locator('#reliefRewardButton').isDisabled())) throw new Error('开荒保障可以重复领取');

  const goldBeforeUnlock = Number(await page.locator('#goldDisplay').innerText());
  await page.locator('.farm-cell.locked.next-unlock').click();
  if ((await page.evaluate(() => GameState.unlockedPlots)) !== 9) throw new Error('农田资源解锁失败');
  if (Number(await page.locator('#goldDisplay').innerText()) >= goldBeforeUnlock) throw new Error('农田解锁没有消耗金币');

  await page.evaluate(() => {
    const idx = GameState.farmPlots.findIndex(plot => plot.crop);
    GameState.farmPlots[idx].status = 'drought';
    Farm.render();
  });
  if ((await page.locator('.plot-status').count()) < 1) throw new Error('作物异常状态图标未显示');
  await page.locator('.farm-cell:not(.locked)').filter({ has: page.locator('.plot-status') }).first().click();
  if ((await page.locator('.plot-status').count()) !== 0) throw new Error('作物照料没有清除异常状态');

  const seedsBefore = Number(await page.locator('#seedDisplay').innerText());
  await page.locator('.farm-cell:not(.locked):not(.planted):not(.ready)').first().click();
  if (Number(await page.locator('#seedDisplay').innerText()) !== seedsBefore - 1) {
    throw new Error('播种没有消耗种子');
  }

  await page.evaluate(() => {
    const idx = GameState.farmPlots.findIndex(plot => plot.crop);
    GameState.farmPlots[idx].plantedAt = Date.now() - 999999;
    Farm.render();
  });
  const goldBefore = Number(await page.locator('#goldDisplay').innerText());
  await page.locator('.farm-cell.ready').first().click();
  await page.waitForTimeout(120);
  if (Number(await page.locator('#goldDisplay').innerText()) <= goldBefore) {
    throw new Error('收获没有增加金币');
  }

  const upgradeTarget = await page.evaluate(() => {
    const card = CardSystem.createCard(CONFIG.crops[4]);
    card.rarity = 'legendary';
    card.power = 3;
    GameState.cardInventory.push(card);
    SaveSystem.save();
    return { skillId: card.skillId, before: GameState.skillLevels[card.skillId] };
  });
  await page.locator('.facility').filter({ hasText: '卡牌工坊' }).click();
  if (!(await page.locator('#cardWorkshopModal').isVisible())) throw new Error('卡牌工坊未打开');
  if ((await page.locator('.upgrade-card.legendary').count()) < 1) throw new Error('传说强化卡未显示');
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(__dirname, 'workshop-test.png'), fullPage: true });
  await page.locator('.upgrade-card.legendary').first().click();
  const upgradedLevel = await page.evaluate(skillId => GameState.skillLevels[skillId], upgradeTarget.skillId);
  if (upgradedLevel <= upgradeTarget.before) throw new Error('强化卡没有提升基础技能');
  await page.getByRole('button', { name: '关闭' }).click();

  await page.evaluate(() => {
    GameState.gold = 2500;
    for (let i = 0; i < 4; i++) {
      const card = CardSystem.createCard(CONFIG.crops[i]);
      card.id = `loadout-test-${i}`;
      GameState.cardInventory.push(card);
    }
    SaveSystem.save();
    Farm.render();
  });
  await page.getByRole('button', { name: /进入远征准备大厅/ }).click();
  if (!(await page.locator('#expeditionPrepScreen').isVisible())) throw new Error('远征准备大厅未显示');
  if (await page.locator('#farmScreen').isVisible()) throw new Error('农场与远征准备界面同时显示');
  if ((await page.locator('.map-option').count()) !== 4) throw new Error('地图数量不正确');
  if ((await page.locator('.loadout-slot').count()) !== 3) throw new Error('消耗品槽位数量不正确');
  if ((await page.locator('.prep-skill').count()) !== 4) throw new Error('准备大厅技能信息不完整');
  if ((await page.locator('.boost-card').count()) < 4) throw new Error('强化卡选择区没有显示库存卡牌');
  for (let i = 0; i < 3; i++) await page.locator('.boost-card').nth(i).click();
  if ((await page.locator('#boostCardCount').innerText()).trim() !== '3/3') throw new Error('强化卡携带计数不正确');
  await page.locator('.boost-card').nth(3).click();
  if ((await page.locator('.boost-card.selected').count()) !== 3) throw new Error('强化卡携带上限没有限制为3张');
  await page.locator('.map-option').nth(2).click();
  await page.screenshot({ path: path.join(__dirname, 'prep-test.png'), fullPage: true });

  await page.getByRole('button', { name: '确认配置并出发' }).click();
  if (!(await page.locator('#expeditionHUD').isVisible())) throw new Error('远征 HUD 未显示');
  if ((await page.evaluate(() => GameState.screen)) !== 'expedition') throw new Error('远征状态未切换');
  if ((await page.evaluate(() => Game.expedition.monsters.length)) <= 0) throw new Error('没有生成怪物');
  if ((await page.evaluate(() => Game.expedition.chests.length)) <= 0) throw new Error('没有生成宝箱');
  if ((await page.evaluate(() => Game.expedition.map.tier)) !== 3) throw new Error('高等级地图选择失败');
  if (!(await page.evaluate(() => Game.expedition.map.background.endsWith('t3-ice-canyon.png')))) throw new Error('T3 专属背景没有加载');
  if (!(await page.evaluate(() => Game.expedition.map.backgroundImage && Game.expedition.map.backgroundImage.complete))) throw new Error('远征背景图片未完成加载');
  if ((await page.evaluate(() => Game.expedition.terrainPatches.length)) < 18) throw new Error('地形色块生成不足');
  if ((await page.evaluate(() => Game.expedition.terrainFields.length)) < 7) throw new Error('农田地形生成不足');
  if ((await page.evaluate(() => Game.expedition.obstacles.length)) < 30) throw new Error('立体障碍物生成不足');
  if ((await page.evaluate(() => Object.values(Game.expedition.skillBoosts).reduce((sum, value) => sum + value, 0))) <= 0) throw new Error('携带强化卡没有应用到远征技能');
  if ((await page.evaluate(() => Game.expedition.traps.length)) < 10) throw new Error('环境陷阱生成不足');
  if ((await page.locator('.skill-meta').count()) < 7) throw new Error('技能数值信息未显示');
  if ((await page.locator('#skillBar .skill-slot').count()) !== 4) throw new Error('常驻技能栏布局不正确');
  if ((await page.locator('#consumableBar .skill-slot').count()) !== 3) throw new Error('消耗品栏没有独立显示');
  if (!(await page.locator('#musicToggle').isVisible())) throw new Error('音乐控制器未显示');
  await page.evaluate(() => {
    const expedition = Game.expedition;
    const showcase = expedition.obstacles.find(obstacle =>
      obstacle.x > 450 && obstacle.x < CONFIG.expedition.mapSize - 450 &&
      obstacle.y > 450 && obstacle.y < CONFIG.expedition.mapSize - 450
    );
    if (showcase) {
      expedition.player.x = showcase.x;
      expedition.player.y = showcase.y + showcase.radius + expedition.player.radius + 46;
      expedition.camera.x = expedition.player.x - CONFIG.canvas.width / 2;
      expedition.camera.y = expedition.player.y - CONFIG.canvas.height / 2;
    }
    expedition.groundLoot.push({ type: 'gold', name: '测试金币', amount: 9, icon: '💰', x: expedition.player.x, y: expedition.player.y, bob: 0 });
  });
  await page.screenshot({ path: path.join(__dirname, 'expedition-test.png'), fullPage: true });
  const bagBeforePickup = await page.evaluate(() => Game.expedition.bag.length);
  await page.locator('#gameCanvas').click({ button: 'right', position: { x: 200, y: 200 } });
  if ((await page.evaluate(() => Game.expedition.bag.length)) !== bagBeforePickup + 1) throw new Error('鼠标右键拾取失败');

  const obstacleCollisionPassed = await page.evaluate(() => {
    const expedition = Game.expedition;
    const obstacle = { type: 'rock', x: expedition.player.x + 42, y: expedition.player.y, scale: 1, radius: 24, rotation: 0 };
    expedition.obstacles.push(obstacle);
    expedition.keys.d = true;
    for (let i = 0; i < 20; i++) expedition.update(1 / 60);
    expedition.keys.d = false;
    return expedition.player.x <= obstacle.x - obstacle.radius - expedition.player.radius + 2;
  });
  if (!obstacleCollisionPassed) throw new Error('玩家可以穿过立体障碍物');

  await page.keyboard.press('1');
  await page.keyboard.press('3');
  await page.keyboard.press('4');
  await page.waitForTimeout(200);
  await page.evaluate(() => Game.expedition.updateHUD());
  if (!(await page.evaluate(() => Game.expedition.skillCooldowns.some(cd => cd > 0)))) {
    throw new Error('技能没有进入冷却');
  }
  if ((await page.locator('.skill-cd-ring').count()) < 1) throw new Error('技能环形冷却未显示');
  await page.evaluate(() => { Game.expedition.player.hp = 20; Game.expedition.updateHUD(); });
  if (!(await page.locator('#lowHealthVignette').evaluate(el => el.classList.contains('active')))) throw new Error('低生命警告未显示');
  await page.evaluate(() => { Game.expedition.player.hp = 100; Game.expedition.updateHUD(); });

  await page.evaluate(() => {
    Game.expedition.bag.push({ type: 'gold', name: '金币', amount: 100, icon: '💰' });
    Game.expedition.bag.push({ type: 'seed', name: '胡萝卜种子', amount: 1, icon: '🥕', cropId: 'carrot' });
    Game.expedition.completeExtract();
  });
  if (!(await page.locator('#resultScreen').isVisible())) throw new Error('结算界面未显示');
  if (!(await page.locator('#resultTitle').innerText()).includes('远征成功')) throw new Error('成功结算不正确');
  await page.getByRole('button', { name: '返回农场' }).click();
  if (!(await page.locator('#farmScreen').isVisible())) throw new Error('无法返回农场');
  if ((await page.locator('.crop-choice').count()) < 2) throw new Error('远征种子没有解锁新作物');

  const savedGold = Number(await page.locator('#goldDisplay').innerText());
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: '开始游戏' }).click();
  if (Number(await page.locator('#goldDisplay').innerText()) !== savedGold) throw new Error('金币存档未恢复');
  if ((await page.locator('.crop-choice').count()) < 2) throw new Error('作物解锁存档未恢复');
  if ((await page.evaluate(() => GameState.unlockedPlots)) !== 9) throw new Error('农田解锁进度未恢复');
  if ((await page.evaluate(skillId => GameState.skillLevels[skillId], upgradeTarget.skillId)) !== upgradedLevel) throw new Error('技能强化进度未恢复');
  if ((await page.evaluate(() => GameState.lastDailyClaim)) !== (await page.evaluate(() => RewardSystem.dateKey()))) throw new Error('每日奖励领取记录未恢复');
  if ((await page.evaluate(() => GameState.lastReliefClaim)) !== (await page.evaluate(() => RewardSystem.dateKey()))) throw new Error('开荒保障领取记录未恢复');

  await page.screenshot({ path: path.join(__dirname, 'smoke-test.png'), fullPage: true });
  await browser.close();

  if (consoleErrors.length || pageErrors.length) {
    throw new Error(`浏览器错误：${JSON.stringify({ consoleErrors, pageErrors })}`);
  }
  console.log('SMOKE TEST PASSED');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
