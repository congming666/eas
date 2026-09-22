const fs = require('fs');
const path = require('path');
const GAME_VERSION = require('./package.json').version;
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

// 截图等测试产物统一输出到 test-results/（已在 .gitignore 中）
const RESULT_DIR = path.join(__dirname, 'test-results');
fs.mkdirSync(RESULT_DIR, { recursive: true });
const shot = name => path.join(RESULT_DIR, name);

// 浏览器解析：CI 用 Playwright 自带 Chromium；本机未下载浏览器时自动降级到系统 Chrome。
// 也可用环境变量显式指定：PW_CHANNEL=chrome 或 PW_EXECUTABLE_PATH=/path/to/chrome
const FALLBACK_CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
];

async function launchBrowser() {
  if (process.env.PW_EXECUTABLE_PATH) {
    return chromium.launch({ headless: true, executablePath: process.env.PW_EXECUTABLE_PATH });
  }
  if (process.env.PW_CHANNEL) {
    return chromium.launch({ headless: true, channel: process.env.PW_CHANNEL });
  }
  try {
    return await chromium.launch({ headless: true });
  } catch (err) {
    const fallback = FALLBACK_CHROME_PATHS.find(p => fs.existsSync(p));
    if (!fallback) throw err;
    console.log(`Playwright Chromium 不可用，改用系统 Chrome：${fallback}`);
    return chromium.launch({ headless: true, executablePath: fallback });
  }
}

async function main() {
  const consoleErrors = [];
  const pageErrors = [];
  const gameUrl = pathToFileURL(path.join(__dirname, 'index.html')).href;

  const browser = await launchBrowser();
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
  if ((await page.title()) !== '农庄牌：荒野远征 v' + GAME_VERSION) throw new Error('标题不正确：' + await page.title());
  if (!(await page.locator('#mainMenu').isVisible())) throw new Error('主菜单未显示');

  await page.getByRole('button', { name: /开\s*始\s*游\s*戏/ }).click();
  if (!(await page.locator('#farmScreen').isVisible())) throw new Error('农场界面未显示');
  if (!(await page.evaluate(() => Boolean(AudioManager.ctx)))) throw new Error('背景音乐没有初始化');
  await page.locator('#musicToggle').click();
  if (!(await page.locator('#musicToggle').innerText()).includes('关')) throw new Error('音乐关闭按钮无效');
  await page.locator('#musicToggle').click();
  if (!(await page.locator('#musicToggle').innerText()).includes('开')) throw new Error('音乐开启按钮无效');
  if ((await page.locator('.farm-cell').count()) !== 48) throw new Error('农田格子数量不正确（v5.1 应为48格）');
  if ((await page.locator('.farm-cell.locked').count()) !== 40) throw new Error('初始锁定农田数量不正确（v5.1 应为40）');
  if ((await page.locator('.farm-cell:not(.locked)').count()) !== 8) throw new Error('初始开放农田数量不正确');
  if ((await page.locator('#cropDetailPanel').count()) !== 1) throw new Error('作物产出详情卡未渲染');
  if (!(await page.locator('#cropDetailPanel').innerText()).includes('打造材料')) throw new Error('作物详情卡缺少材料产出标注');
  if (await page.locator('#expeditionPrepScreen').isVisible()) throw new Error('远征准备界面不应与农场同时显示');
  if (!(await page.locator('#dailyRewardButton').isVisible())) throw new Error('每日奖励入口未显示');
  if (!(await page.locator('#reliefRewardButton').isVisible())) throw new Error('开荒保障入口未显示');

  const dailyBefore = await page.evaluate(() => ({ gold: GameState.gold, seeds: Warehouse.getCount('seeds') }));
  await page.locator('#dailyRewardButton').click();
  const dailyAfter = await page.evaluate(() => ({ gold: GameState.gold, seeds: Warehouse.getCount('seeds'), claim: GameState.lastDailyClaim }));
  if (dailyAfter.gold <= dailyBefore.gold || dailyAfter.seeds <= dailyBefore.seeds || !dailyAfter.claim) throw new Error('每日奖励领取失败');
  if (!(await page.locator('#dailyRewardButton').isDisabled())) throw new Error('每日奖励可以重复领取');

  await page.evaluate(() => {
    GameState.gold = 20;
    Warehouse.removeItem('seeds', Warehouse.getCount('seeds'));
    GameState.lastReliefClaim = '';
    Farm.render();
  });
  if (await page.locator('#reliefRewardButton').isDisabled()) throw new Error('资源耗尽时没有开放开荒保障');
  await page.locator('#reliefRewardButton').click();
  const reliefAfter = await page.evaluate(() => ({ gold: GameState.gold, seeds: Warehouse.getCount('seeds'), claim: GameState.lastReliefClaim }));
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
  // v4.2 起空地点击先弹作物选择器，需在弹窗内确认种植
  await page.locator('#cropPickerOverlay > div > div').filter({ hasText: '小麦' }).locator('button').click();
  if (Number(await page.locator('#seedDisplay').innerText()) !== seedsBefore - 1) {
    throw new Error('播种没有消耗种子');
  }

  await page.evaluate(() => {
    const idx = GameState.farmPlots.findIndex(plot => plot.crop);
    // v4.2 只有 rewardType=gold 的小麦收获稳定加金币，其余作物给卡/道具
    GameState.farmPlots[idx].crop = CONFIG.crops.find(c => c.id === 'wheat');
    GameState.farmPlots[idx].plantedAt = Date.now() - 999999;
    GameState.farmPlots[idx].status = null;
    Farm.render();
  });
  const goldBefore = Number(await page.locator('#goldDisplay').innerText());
  await page.locator('.farm-cell.ready').first().click();
  await page.waitForTimeout(120);
  if (Number(await page.locator('#goldDisplay').innerText()) <= goldBefore) {
    throw new Error('收获没有增加金币');
  }

  const upgradeTarget = await page.evaluate(() => {
    const card = CardSystem.createCard(CONFIG.crops.find(c => c.id === 'pea_shooter'));
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
  await page.screenshot({ path: shot('workshop-test.png'), fullPage: true });
  await page.locator('.upgrade-card.legendary').first().click();
  const upgradedLevel = await page.evaluate(skillId => GameState.skillLevels[skillId], upgradeTarget.skillId);
  if (upgradedLevel <= upgradeTarget.before) throw new Error('强化卡没有提升基础技能');
  await page.getByRole('button', { name: '关闭' }).click();

  // ===== v4.2 仓库扩容与远征产出覆盖回归 =====
  await page.evaluate(() => {
    // 基础容量与旧档迁移
    if (GameState.warehouse.capacity !== 120) throw new Error('仓库基础容量应为120，实际 ' + GameState.warehouse.capacity);
    GameState.warehouse.capacity = 50; delete GameState.warehouse.capVersion; Warehouse.init();
    if (GameState.warehouse.capacity !== 120) throw new Error('旧档容量未迁移到新基础值');
    // 扩建步长 +50、费用 100/200 递增
    GameState.gold = 5000;
    const costBefore = Warehouse.getUpgradeCost();
    if (!Warehouse.upgradeCapacity() || GameState.warehouse.capacity !== 170) throw new Error('扩建步长应为+50');
    if (costBefore !== 100 || Warehouse.getUpgradeCost() !== 200) throw new Error('扩建费用曲线错误');
    GameState.warehouse.capacity = 120;
    // 加工链：3 小麦 -> 面粉（修复前产物因无定义直接丢失）
    Warehouse.addItem('wheat', 6);
    if (!FarmProcessingSystem.startProcessing('flour', 1)) throw new Error('面粉加工未启动');
    GameState.processingQueue.forEach(j => { j.remaining = 0; });
    FarmProcessingSystem.tick(1);
    if (Warehouse.getCount('flour') < 1) throw new Error('加工产物面粉未入仓（产物定义缺失回归）');
    // 野生种子 -> 作物 -> 仓库定义 全链路闭环
    for (const w of CONFIG.wildPlants) {
      // v5.1 野生种子分两类：农场作物种子、远征部署植物种子；两者都必须有仓库物品定义
      const isCrop = CONFIG.crops.find(c => c.id === w.givesSeed);
      if (!isCrop && !(CONFIG.warehouseItems && CONFIG.warehouseItems[w.givesSeed])) {
        throw new Error('野生种子既无作物也无物品定义: ' + w.givesSeed);
      }
      if (!CONFIG.warehouseItems[w.givesSeed]) throw new Error('野生作物无仓库定义: ' + w.givesSeed);
    }
    // 远征/温室/工坊全部现行产出 id 均有仓库定义
    const mustHave = ['herb','flour','bread','oil','torch','juice','feed','egg','pumpkin_lantern','insecticide',
      'wood','iron','crystal','bossFang','ancientSeeds','herb_kit','thorn_storm','signal_flare','growth_catalyst',
      'gold_card','big_gold_card','transform_card','rare_seed_pack','exp_boost_card','weapon_upgrade_stone',
      'deathcap','frost_flower','lightning_vine','shadow_flower','rice'];
    for (const id of mustHave) {
      if (!CONFIG.warehouseItems[id]) throw new Error('仓库缺物品定义: ' + id);
    }
    // 批量入库爆仓：只入空余 2 件，汇总丢失 3 件且不刷逐条 toast
    ['wheat','flour'].forEach(id => Warehouse.removeItem(id, Warehouse.getCount(id)));
    GameState.warehouse.capacity = Warehouse.getUsedCapacity() + 2;
    Warehouse.beginBatch();
    Warehouse.addItem('wood', 5);
    const b = Warehouse.endBatch();
    if (Warehouse.getCount('wood') !== 2 || b.requested - b.added !== 3) throw new Error('批量入库爆仓计数错误');
    Warehouse.removeItem('wood', Warehouse.getCount('wood'));
    GameState.warehouse.capacity = 120;
    // 未知物品安全拒收
    if (Warehouse.addItem('__not_exist__', 1) !== 0) throw new Error('未知物品不应入仓');
    // v5.1 农作物 -> 打造材料闭环（闪电藤高产铁矿）
    const ironBefore = ResourceSystem.count('iron');
    const matGained = CharacterSystem.onCropHarvested('lightning_vine', 50, 'fine');
    if (!Array.isArray(matGained) || !matGained.some(t => t.includes('铁矿'))) throw new Error('农作物材料产出失败');
    if (ResourceSystem.count('iron') <= ironBefore) throw new Error('收获后材料库存未增加');
    if (!CONFIG.cropMaterials || !CONFIG.cropMaterials.deathcap) throw new Error('作物材料映射表不完整');
    SaveSystem.save();
  });

  await page.evaluate(() => {
    GameState.gold = 2500;
    for (let i = 0; i < 4; i++) {
      const card = CardSystem.createCard(CONFIG.crops[i]);
      card.id = `loadout-test-${i}`;
      GameState.cardInventory.push(card);
    }
    // v5.1 解锁并装备 4 个技能（模拟玩家修行进度：Lv60 有 4 卡槽），准备大厅只显示已装备技能
    GameState.level = 60;
    const s4 = CONFIG.skills.slice(0, 4).map(s => s.id);
    GameState.unlockedSkills = s4.slice();
    GameState.equippedSkills = s4.slice();
    SaveSystem.save();
    Farm.render();
  });
  await page.getByRole('button', { name: /进入远征准备大厅/ }).click();
  if (!(await page.locator('#expeditionPrepScreen').isVisible())) throw new Error('远征准备大厅未显示');
  if (await page.locator('#farmScreen').isVisible()) throw new Error('农场与远征准备界面同时显示');
  if ((await page.locator('.map-option').count()) !== (await page.evaluate(() => CONFIG.maps.length + 1))) throw new Error('地图数量不正确');
  if ((await page.locator('#loadoutGrid .loadout-slot').count()) !== (await page.evaluate(() => CONFIG.consumables.length))) throw new Error('消耗品槽位数量不正确');
  if ((await page.locator('.prep-skill').count()) !== 4) throw new Error('准备大厅技能信息不完整');

  // v5.1 消耗品携带闭环：无库存不可携带，携带扣库存，右键归还
  const loadoutCheck = await page.evaluate(() => {
    GameState.warehouse.capacity = Warehouse.getUsedCapacity() + 10;
    Warehouse.removeItem('herb_kit', Warehouse.getCount('herb_kit'));
    GameState.loadout = {};
    Farm.renderLoadout();
    const slot0 = () => document.querySelectorAll('#loadoutGrid .loadout-slot')[0];
    slot0().click(); // 仓库没有，应被拒绝
    const blocked = (GameState.loadout.herb_kit || 0) === 0 && slot0().classList.contains('muted');
    Warehouse.addItem('herb_kit', 2);
    Farm.renderLoadout();
    slot0().click();
    const afterCarry = { n: GameState.loadout.herb_kit || 0, wh: Warehouse.getCount('herb_kit') };
    slot0().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    const afterReturn = { n: GameState.loadout.herb_kit || 0, wh: Warehouse.getCount('herb_kit') };
    return { blocked, afterCarry, afterReturn };
  });
  if (!loadoutCheck.blocked) throw new Error('没有库存的消耗品不应允许携带（携带bug回归）');
  if (loadoutCheck.afterCarry.n !== 1 || loadoutCheck.afterCarry.wh !== 1) throw new Error('携带消耗品没有扣减仓库库存');
  if (loadoutCheck.afterReturn.n !== 0 || loadoutCheck.afterReturn.wh !== 2) throw new Error('卸下消耗品没有归还仓库');

  // v5.1 修行台技能卸下：卸下后准备大厅技能预览同步减少
  await page.evaluate(() => {
    CharacterSystem.equip(CONFIG.skills[3].id);
    Farm.renderSkillPreview();
  });
  if ((await page.locator('.prep-skill').count()) !== 3) throw new Error('修行台卸下技能后准备大厅仍显示该技能');
  await page.evaluate(() => { CharacterSystem.equip(CONFIG.skills[3].id); Farm.renderSkillPreview(); });

  await page.locator('.map-option').nth(13).click();
  await page.screenshot({ path: shot('prep-test.png'), fullPage: true });

  // v4.2 出发强制校验：至少携带一把武器（新存档默认有 w_001 收割镰）
  await page.locator('#weaponLoadoutSelect > div').first().click();
  await page.getByRole('button', { name: '确认配置并出发' }).click();
  if (!(await page.locator('#expeditionHUD').isVisible())) throw new Error('远征 HUD 未显示');
  if ((await page.evaluate(() => GameState.screen)) !== 'expedition') throw new Error('远征状态未切换');
  if ((await page.evaluate(() => Game.expedition.monsters.length)) <= 0) throw new Error('没有生成怪物');
  if ((await page.evaluate(() => Game.expedition.chests.length)) <= 0) throw new Error('没有生成宝箱');
  if ((await page.evaluate(() => Game.expedition.map.tier)) !== 3) throw new Error('高等级地图选择失败');
  if (!(await page.evaluate(() => Game.expedition.map.bgImage.endsWith('t3_1_blighted.jpg')))) throw new Error('T3 专属背景路径不正确');
  if (!(await page.evaluate(() => Game.expedition.mapBgImg && Game.expedition.mapBgImg.complete && Game.expedition.mapBgImg.naturalWidth > 0))) throw new Error('远征背景图片未完成加载');
  if ((await page.evaluate(() => Game.expedition.terrainPatches.length)) < 18) throw new Error('地形色块生成不足');
  if ((await page.evaluate(() => Game.expedition.terrainFields.length)) < 7) throw new Error('农田地形生成不足');
  if ((await page.evaluate(() => Game.expedition.obstacles.length)) < 30) throw new Error('立体障碍物生成不足');
  if ((await page.evaluate(() => Game.expedition.traps.length)) < 10) throw new Error('环境陷阱生成不足');
  if ((await page.locator('.skill-meta').count()) < 7) throw new Error('技能数值信息未显示');
  if ((await page.locator('#skillBar .skill-slot').count()) !== 4) throw new Error('常驻技能栏布局不正确');
  // v5.6 消耗品 HUD：固定 R 道具转盘入口 + 未携带时回退显示 3 个核心道具（草药/信号弹/荆棘）
  if ((await page.locator('#consumableBar .cons-wheel-chip').count()) !== 1) throw new Error('R 道具转盘入口未显示');
  if ((await page.locator('#consumableBar .skill-slot.consumable:not(.cons-more):not(.cons-wheel-chip)').count()) !== 3) throw new Error('消耗品核心栏没有独立显示');
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
  });
  await page.screenshot({ path: shot('expedition-test.png'), fullPage: true });
  // v4.2 掉落物走近自动拾取（update 每帧调 pickupLoot）；金币按堆叠加，断言金额而非格子数
  const pickup = await page.evaluate(() => {
    const expedition = Game.expedition;
    const goldSum = () => expedition.bag.filter(i => i.type === 'gold').reduce((s, i) => s + (i.amount || 0), 0);
    const goldBefore = goldSum();
    expedition.groundLoot.push({ type: 'gold', name: '测试金币', amount: 9, icon: '💰', x: expedition.player.x, y: expedition.player.y, bob: 0 });
    const picked = expedition.pickupLoot();
    return { picked, goldBefore, goldAfter: goldSum() };
  });
  if (!pickup.picked || pickup.goldAfter !== pickup.goldBefore + 9) throw new Error('掉落物自动拾取失败');

  const obstacleCollisionPassed = await page.evaluate(() => {
    const expedition = Game.expedition;
    // 隔离战斗干扰：怪物击退/单位挤推会让玩家在碰撞断言期间位移，先清场并解除硬直
    expedition.monsters.length = 0;
    expedition.raiders.length = 0;
    expedition.projectiles.length = 0;
    expedition.player.hitStun = 0;
    expedition.player.slow = 0;
    expedition.player.stun = 0;
    const obstacle = { type: 'rock', x: expedition.player.x + 42, y: expedition.player.y, scale: 1, radius: 24, rotation: 0 };
    expedition.obstacles.push(obstacle);
    // 障碍碰撞查询走 obstacleSpatialHash（仅生成时构建），动态加入后需重建
    expedition.obstacleSpatialHash.rebuild(expedition.obstacles);
    expedition.keys.d = true;
    for (let i = 0; i < 20; i++) expedition.update(1 / 60);
    expedition.keys.d = false;
    // 游戏实际移动碰撞使用 collisionRadius（默认 11），而非视觉 radius
    const pr = expedition.player.collisionRadius || expedition.player.radius * 0.72;
    return expedition.player.x <= obstacle.x - obstacle.radius - pr + 2;
  });
  if (!obstacleCollisionPassed) throw new Error('玩家可以穿过立体障碍物');

  // v5.1 直接调用技能接口（给满能量），避免键盘焦点导致的偶发失败
  await page.evaluate(() => {
    const e = Game.expedition;
    e.player.energy = e.player.maxEnergy;
    e.useSkill(0);
  });
  if (!(await page.evaluate(() => Game.expedition.skillCooldowns.some(cd => cd > 0)))) {
    throw new Error('技能没有进入冷却');
  }
  // v5.1 useSkill 内部已立即刷新 HUD；保险起见断言前再同步一帧
  const ringCount = await page.evaluate(() => { const e = Game.expedition; e.hudTimer = 0; e.updateHUD(); return document.querySelectorAll('.skill-cd-ring').length; });
  if (ringCount < 1) throw new Error('技能环形冷却未显示');
  await page.evaluate(() => { Game.expedition.player.hp = 20; Game.expedition.updateHUD(); });
  if (!(await page.locator('#lowHealthVignette').evaluate(el => el.classList.contains('active')))) throw new Error('低生命警告未显示');
  await page.evaluate(() => { Game.expedition.player.hp = 100; Game.expedition.updateHUD(); });

  const seedSettle = await page.evaluate(() => {
    const seedsBefore = Warehouse.getCount('seeds');
    Game.expedition.bag.push({ type: 'gold', name: '金币', amount: 100, icon: '💰' });
    Game.expedition.bag.push({ type: 'seed', name: '胡萝卜种子', amount: 1, icon: '🥕', cropId: 'carrot' });
    // v4.2 野生作物种子：撤离后解锁对应作物并按通用种子入仓
    Game.expedition.bag.push({ type: 'seed_item', name: '寒霜花种子', amount: 1, icon: '❄️', seedId: 'frost_flower' });
    Game.expedition.completeExtract();
    return {
      seedsBefore,
      seedsAfter: Warehouse.getCount('seeds'),
      unlockedFrost: GameState.unlockedCrops.includes('frost_flower'),
      capVersion: GameState.warehouse.capVersion
    };
  });
  if (!seedSettle.unlockedFrost) throw new Error('野生种子没有解锁对应作物');
  if (seedSettle.seedsAfter !== seedSettle.seedsBefore + 2) throw new Error('撤离种子没有全部入仓');
  if (seedSettle.capVersion !== 2) throw new Error('仓库容量版本标记缺失');
  if (!(await page.locator('#resultScreen').isVisible())) throw new Error('结算界面未显示');
  if (!(await page.locator('#resultTitle').innerText()).includes('远征成功')) throw new Error('成功结算不正确');
  await page.getByRole('button', { name: '返回农场' }).click();
  if (!(await page.locator('#farmScreen').isVisible())) throw new Error('无法返回农场');
  if ((await page.locator('.crop-choice').count()) < 2) throw new Error('远征种子没有解锁新作物');

  const savedGold = Number(await page.locator('#goldDisplay').innerText());
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: /开\s*始\s*游\s*戏/ }).click();
  // startGame 分帧加载（setTimeout 80ms 后才 SaveSystem.load + render），等待存档值上屏
  await page.waitForFunction(
    value => document.getElementById('goldDisplay').textContent.trim() === String(value),
    savedGold,
    { timeout: 5000 }
  );
  if (Number(await page.locator('#goldDisplay').innerText()) !== savedGold) throw new Error('金币存档未恢复');
  if ((await page.locator('.crop-choice').count()) < 2) throw new Error('作物解锁存档未恢复');
  if ((await page.evaluate(() => GameState.unlockedPlots)) !== 9) throw new Error('农田解锁进度未恢复');
  if ((await page.evaluate(skillId => GameState.skillLevels[skillId], upgradeTarget.skillId)) !== upgradedLevel) throw new Error('技能强化进度未恢复');
  if ((await page.evaluate(() => GameState.lastDailyClaim)) !== (await page.evaluate(() => RewardSystem.dateKey()))) throw new Error('每日奖励领取记录未恢复');
  if ((await page.evaluate(() => GameState.lastReliefClaim)) !== (await page.evaluate(() => RewardSystem.dateKey()))) throw new Error('开荒保障领取记录未恢复');

  await page.screenshot({ path: shot('smoke-test.png'), fullPage: true });
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
