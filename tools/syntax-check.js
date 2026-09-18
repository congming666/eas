#!/usr/bin/env node
/**
 * 零依赖语法关卡：对项目所有 JS 文件运行 `node --check`。
 * 用法：node tools/syntax-check.js
 * 退出码非 0 表示存在语法错误（CI 关卡直接失败）。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

function collectJs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'test-results') continue;
      out.push(...collectJs(full));
    } else if (entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

const files = [
  ...collectJs(path.join(ROOT, 'js')),
  ...collectJs(path.join(ROOT, 'tools')),
  path.join(ROOT, 'smoke_test.js'),
];

let failed = 0;
for (const file of files) {
  const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (res.status !== 0) {
    failed++;
    console.error(`FAIL ${path.relative(ROOT, file)}`);
    console.error(res.stderr || res.stdout);
  } else {
    console.log(`ok   ${path.relative(ROOT, file)}`);
  }
}

if (failed) {
  console.error(`\n${failed} 个文件语法检查失败`);
  process.exit(1);
}
console.log(`\n全部 ${files.length} 个 JS 文件语法检查通过`);
