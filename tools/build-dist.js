#!/usr/bin/env node
/**
 * 零依赖发布构建：把 GitHub Pages 实际需要的运行时文件汇集到 dist/。
 * 刻意保持零打包步骤——游戏要求 file:// 双击可玩，dist/ 同样是纯静态文件。
 * 同时校验 index.html / js / css 引用的每一个本地资源都存在，避免发布白屏。
 * 用法：node tools/build-dist.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// 运行时白名单（评审要求：测试脚本、概念图源工程、内部文档不再随 Pages 公开）
const COPY_ENTRIES = [
  'index.html',
  '.nojekyll',
  'css',
  'js',
  'vendor',
  'assets',
  path.join('docs', 'art'), // 武器等运行时图片实际挂在 docs/art 下
];

function rmrf(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

function copyRecursive(src, dest, stats) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dest, name), stats);
    }
  } else {
    fs.copyFileSync(src, dest);
    stats.files++;
    stats.bytes += stat.size;
  }
}

// 收集 html/js/css 中出现的本地引用（相对路径），用于发布完整性校验
const LOCAL_REF = /['"(]((?:assets|docs|vendor|css|js)\/[^'")?#]+)/g;
function collectReferences() {
  const refs = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|css|html)$/.test(entry.name)) {
        const text = fs.readFileSync(full, 'utf8');
        let m;
        while ((m = LOCAL_REF.exec(text))) refs.add(m[1]);
      }
    }
  };
  walk(path.join(DIST, 'js'));
  walk(path.join(DIST, 'css'));
  refs.add('index.html');
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  let m;
  while ((m = LOCAL_REF.exec(html))) refs.add(m[1]);
  return refs;
}

function main() {
  rmrf(DIST);
  fs.mkdirSync(DIST, { recursive: true });

  const stats = { files: 0, bytes: 0 };
  for (const entry of COPY_ENTRIES) {
    const src = path.join(ROOT, entry);
    if (!fs.existsSync(src)) {
      console.error(`构建失败：缺少运行时入口 ${entry}`);
      process.exit(1);
    }
    copyRecursive(src, path.join(DIST, entry), stats);
    console.log(`copy ${entry}`);
  }

  // 引用完整性校验（含模板变量的动态拼接路径跳过）
  const missing = [];
  for (const ref of collectReferences()) {
    if (ref.includes('${') || ref.includes('*')) continue;
    const target = path.join(DIST, ref.split('/').join(path.sep));
    if (!fs.existsSync(target)) missing.push(ref);
  }
  if (missing.length) {
    console.error('\n发布完整性校验失败，以下本地引用在 dist 中不存在：');
    for (const ref of missing) console.error('  ' + ref);
    process.exit(1);
  }

  const mb = (stats.bytes / 1024 / 1024).toFixed(1);
  console.log(`\ndist 构建完成：${stats.files} 个文件，${mb} MB`);
}

main();
