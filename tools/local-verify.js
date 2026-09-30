// 本地确定性 UI 验证脚本（Playwright，跑在本机，可访问 C: 盘）
// 用法: node tools/local-verify.js <scenario>
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const INDEX = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');
const SHOTS = path.join(ROOT, 'shots');

const scenario = process.argv[2] || 'title';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + (e.stack || e.message)));

  await page.goto(INDEX, { waitUntil: 'load' });
  await page.waitForTimeout(1200);

  if (scenario === 'titleclean') {
    await page.mouse.move(6, 6);
    await page.waitForTimeout(5200);
    const fsx = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(x => {
      const r = x.getBoundingClientRect(); const c = getComputedStyle(x);
      return r.width > innerWidth * 0.9 && r.height > innerHeight * 0.9 && c.display !== 'none' && c.visibility !== 'hidden' && x.tagName !== 'CANVAS';
    }).map(x => x.className || x.id));
    await page.screenshot({ path: path.join(SHOTS, 'lv-title-clean.png') });
    console.log('FULLSCREEN_NONCANVAS', JSON.stringify(fsx));
    console.log('ERRORS(' + errors.length + '):'); errors.forEach(e => console.log('  ' + e));
  }

  if (scenario === 'peek') {
    const info = await page.evaluate(() => {
      const chain = [];
      let el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      while (el && el !== document.body) { const r = el.getBoundingClientRect(); const c = getComputedStyle(el); chain.push({ tag: el.tagName, cls: el.className || el.id, pos: c.position, disp: c.display, z: c.zIndex, w: Math.round(r.width), h: Math.round(r.height) }); el = el.parentElement; }
      const all = [...document.querySelectorAll('body *')].filter(x => { const r = x.getBoundingClientRect(); const c = getComputedStyle(x); return r.width > innerWidth * 0.9 && r.height > innerHeight * 0.9 && c.display !== 'none' && c.visibility !== 'hidden'; }).map(x => ({ tag: x.tagName, cls: x.className || x.id, pos: getComputedStyle(x).position, z: getComputedStyle(x).zIndex }));
      return { centerChain: chain, fullScreen: all };
    });
    console.log('PEEK', JSON.stringify(info, null, 1));
  }

  if (scenario === 'title') {
    // keep mouse away from title while particles converge
    await page.mouse.move(6, 6);
    await page.waitForTimeout(5200);
    // isolate title: list then temporarily hide any non-mainMenu full-screen overlays
    const overlays = await page.evaluate(() => {
      const list = [...document.querySelectorAll('body *')].filter(el => {
        if (el.tagName === 'CANVAS') return false;
        const r = el.getBoundingClientRect(); const c = getComputedStyle(el);
        return c.position === 'fixed' && r.width > innerWidth * 0.9 && r.height > innerHeight * 0.9
          && c.display !== 'none' && !el.closest('#mainMenu');
      }).map(el => el.className || el.id);
      list.forEach(cls => { const el = document.querySelector('.' + String(cls).split(' ')[0]); if (el) { el.dataset.vv = '1'; el.style.display = 'none'; } });
      return list;
    });
    const probe = await page.evaluate(() => {
      const vis = el => el ? getComputedStyle(el).display : 'NO_EL';
      const r = el => { if (!el) return null; const b = el.getBoundingClientRect(); const c = getComputedStyle(el); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), disp: c.display, vis: c.visibility, op: c.opacity }; };
      return {
        viewport: [innerWidth, innerHeight],
        meta: vis(document.querySelector('.nebula-brand-meta')),
        ver: vis(document.querySelector('.nebula-card .nebula-ver')),
        hint: vis(document.querySelector('#mainMenu .nebula-hint')),
        card: r(document.querySelector('#mainMenu .nebula-card')),
        titleBox: r(document.querySelector('.nebula-title')),
        buttons: [...document.querySelectorAll('#mainMenu button')].map(b => ({ t: b.textContent.trim(), ...r(b) })),
        canvases: [...document.querySelectorAll('canvas')].map(c => ({ cls: c.className || c.id, z: getComputedStyle(c).zIndex, ...r(c) })),
      };
    });
    await page.screenshot({ path: path.join(SHOTS, 'lv-title-before.png') });
    // hover at title center
    if (probe.titleBox) {
      const cx = probe.titleBox.x + probe.titleBox.w / 2;
      const cy = probe.titleBox.y + probe.titleBox.h / 2;
      await page.mouse.move(cx, cy);
      await page.waitForTimeout(1400);
      await page.screenshot({ path: path.join(SHOTS, 'lv-title-after.png') });
    }
    console.log('OVERLAYS_HIDDEN', JSON.stringify(overlays));
    console.log('PROBE', JSON.stringify(probe, null, 1));
  }

  console.log('ERRORS(' + errors.length + '):');
  errors.forEach(e => console.log('  ' + e));
  await browser.close();
})();
