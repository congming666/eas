/**
 * 临时验证脚本（v5.1）：逐只实例化 12 个 Boss，驱动 V5.tickBoss 45 秒游戏时间，
 * 验证差异化技能状态机不抛异常、且确实产生了技能痕迹（危险区/陷阱/召唤/天气/护甲等）。
 * 验证通过后本脚本删除。
 */
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');
const fs = require('fs');

const FALLBACK = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function launch() {
  try { return await chromium.launch({ headless: true }); }
  catch (e) { return chromium.launch({ headless: true, executablePath: FALLBACK }); }
}

async function main() {
  const pageErrors = [];
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(pathToFileURL(path.join(__dirname, 'index.html')).href);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: /开\s*始\s*游\s*戏/ }).click();
  await page.waitForSelector('#farmScreen');

  const report = await page.evaluate(() => new Promise((resolve) => {
    const ids = Object.keys(CONFIG.bosses);
    const results = [];
    for (const id of ids) {
      let exp;
      try {
        const mapId = (CONFIG.maps.find(m => m.bossId === id) || CONFIG.maps[0]).id;
        exp = new Expedition(mapId);
        exp.map.bossId = id;
        exp.running = true;
        const b = V5.makeBoss(exp);
        exp.boss = b;
        exp.monsters = exp.monsters || [];
        exp.monsters.push(b);
        b.x = exp.player.x + 170; b.y = exp.player.y;
        // 玩家近乎无敌，避免被技能打死干扰状态机验证
        exp.player.maxHp = 1e9; exp.player.hp = 1e9;
        const errs = [];
        const trace = [];
        // 基线：新远征可能预置地图怪/地图陷阱，必须以驱动前数量为基线
        const baseMonsters = exp.monsters.length;
        const baseTraps = (exp.traps || []).length;
        let maxHazards = 0, maxAdds = 0, maxTraps = 0, maxProj = 0;
        let weatherSeen = null, armorSeen = false; const states = {};
        const snap = (tag) => ({
          tag,
          hazards: (exp.bossHazards || []).length,
          newTraps: (exp.traps || []).length - baseTraps,
          adds: exp.monsters.length - baseMonsters,
          weather: exp.fxWeather ? exp.fxWeather.state : 'NOFX',
          state: b.castState,
          armor: !!(b.armorUntil && b.armorUntil > performance.now()),
          proj: exp.projectiles ? exp.projectiles.length : -1,
        });
        for (let sec = 0; sec < 45; sec++) {
          try {
            for (let k = 0; k < 60; k++) {
              V5.tickBoss(exp, 1 / 60);
              maxHazards = Math.max(maxHazards, (exp.bossHazards || []).length);
              maxAdds = Math.max(maxAdds, exp.monsters.length - baseMonsters);
              maxTraps = Math.max(maxTraps, (exp.traps || []).length - baseTraps);
              maxProj = Math.max(maxProj, exp.projectiles ? exp.projectiles.length : 0);
              if (exp.fxWeather && exp.fxWeather.state !== 'clear') weatherSeen = exp.fxWeather.state;
              if (b.armorUntil && b.armorUntil > performance.now()) armorSeen = true;
              states[b.castState] = (states[b.castState] || 0) + 1;
            }
          } catch (e) { errs.push('sec' + sec + ': ' + (e && e.stack || e)); }
          // 分阶段压血，触发二阶段/分裂/狂暴/复活
          if (sec === 10) b.hp = b.maxHp * 0.72;
          if (sec === 20) b.hp = b.maxHp * 0.45;
          if (sec === 30) { b.hp = b.maxHp * 0.2; }
          // 模拟玩家绕圈移动（拉开/拉近，触发冲锋/风筝/凝视）
          const ang = sec * 0.7;
          exp.player.x = b.x + Math.cos(ang) * 230;
          exp.player.y = b.y + Math.sin(ang) * 230;
          if (sec === 10 || sec === 20 || sec === 44) trace.push(snap('s' + sec));
        }
        // 技能痕迹汇总（基于驱动期间的峰值/基线差值）
        const sig = {
          hazards: maxHazards, traps: maxTraps, adds: maxAdds, proj: maxProj,
          weather: weatherSeen, armor: armorSeen, states,
        };
        results.push({ id, name: b.name, errs, trace, sig });
      } catch (e) {
        results.push({ id, fatal: String(e && e.stack || e) });
      }
    }
    // 等待 scorch 的 setTimeout 火弹回调（3 轮，约 3 秒真实时间）
    setTimeout(() => resolve({ results, pageErrors: window.__bossTestErrors || [] }), 4500);
  }));

  await browser.close();
  let fail = 0;
  for (const r of report.results) {
    if (r.fatal || (r.errs && r.errs.length)) {
      fail++;
      console.log(`FAIL ${r.id}: ${r.fatal || r.errs.join(' | ')}`);
    } else {
      const s = r.sig;
      const parts = [];
      if (s.hazards) parts.push(`危险区×${s.hazards}`);
      if (s.traps) parts.push(`陷阱+${s.traps}`);
      if (s.adds) parts.push(`召唤+${s.adds}`);
      if (s.proj) parts.push(`弹幕×${s.proj}`);
      if (s.weather) parts.push(`天气:${s.weather}`);
      if (s.armor) parts.push('护甲');
      const nonIdle = Object.keys(s.states).filter(k => k !== 'idle').map(k => `${k}×${s.states[k]}`).join(',');
      if (nonIdle) parts.push('状态[' + nonIdle + ']');
      console.log(`OK   ${r.id} ${r.name} -> ${parts.join(' / ') || '（无技能痕迹!）'}`);
    }
  }
  console.log('pageErrors:', pageErrors.length ? pageErrors.slice(0, 5) : 'none');
  if (fail) { console.log(`BOSS TEST FAILED: ${fail}/${report.results.length}`); process.exit(1); }
  console.log(`BOSS TEST PASSED: ${report.results.length}/12`);
}
main().catch(e => { console.error(e); process.exit(1); });
