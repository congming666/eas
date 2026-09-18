#!/usr/bin/env node
/**
 * 版本号统一维护脚本（唯一数据源：js/config.js 顶部的 GAME_VERSION）
 *
 * 用法：
 *   node tools/bump-version.js            按 config.js 当前版本刷新 index.html
 *   node tools/bump-version.js 4.3.0      先把 config.js 升到 4.3.0，再同步 index.html
 *
 * 同步内容：
 *   - <title> 里的 vX.Y.Z
 *   - <meta name="game-version"> 的 content
 *   - 所有本地 js/css 引用的 ?v= 缓存戳（外部 CDN 不动）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'js', 'config.js');
const HTML_PATH = path.join(ROOT, 'index.html');
const VERSION_RE = /const GAME_VERSION = '(\d+\.\d+\.\d+)'/;

function read(p) { return fs.readFileSync(p, 'utf8'); }
function write(p, c) { fs.writeFileSync(p, c, 'utf8'); }

let config = read(CONFIG_PATH);
let version = (config.match(VERSION_RE) || [])[1];
const next = process.argv[2];

if (next) {
  if (!/^\d+\.\d+\.\d+$/.test(next)) {
    console.error(`版本号格式错误：${next}（应为 x.y.z）`);
    process.exit(1);
  }
  if (!version) {
    console.error('未在 js/config.js 找到 const GAME_VERSION，无法更新');
    process.exit(1);
  }
  config = config.replace(VERSION_RE, `const GAME_VERSION = '${next}'`);
  write(CONFIG_PATH, config);
  version = next;
  console.log(`config.js GAME_VERSION -> ${version}`);
}

if (!version) {
  console.error('未在 js/config.js 找到 const GAME_VERSION');
  process.exit(1);
}

let html = read(HTML_PATH);
let changed = 0;

// 1. <title>游戏名 vX.Y.Z</title>
html = html.replace(/<title>(.*?)v\d+\.\d+(?:\.\d+)*(.*?)<\/title>/, (m, pre, post) => {
  changed++;
  return `<title>${pre}v${version}${post}</title>`;
});

// 2. <meta name="game-version" content="x.y.z">
html = html.replace(/(<meta\s+name="game-version"\s+content=")[^"]*(")/, (m, pre, post) => {
  changed++;
  return pre + version + post;
});

// 3. 本地资源 ?v= 缓存戳（排除 http://、https://、// 开头的外部地址）
html = html.replace(/((?:src|href)=")(?!https?:|\/\/)([^"?]+)\?v=[^"]*(")/g, (m, pre, url, tail) => {
  changed++;
  return `${pre}${url}?v=${version}${tail}`;
});

write(HTML_PATH, html);
console.log(`index.html 已同步到 v${version}（更新 ${changed} 处：标题/meta/本地资源缓存戳）`);

// 4. package.json#version 跟随唯一数据源
const PKG_PATH = path.join(ROOT, 'package.json');
if (fs.existsSync(PKG_PATH)) {
  const pkg = JSON.parse(read(PKG_PATH));
  if (pkg.version !== version) {
    pkg.version = version;
    write(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`package.json version -> ${version}`);
  }
}
