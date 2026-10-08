/* 根据 index.html 的真实 script 顺序和 JS 中的全局引用生成运行时依赖图。 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
  .map(m => m[1]).filter(s => /^js\//.test(s)).map(s => s.split('?')[0]);
const globals = {};
for (const rel of scripts) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const provided = new Set();
  for (const m of src.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=|window\.([A-Za-z_$][\w$]*)\s*=/g)) provided.add(m[1] || m[2]);
  globals[rel] = [...provided];
}
const known = new Set(Object.values(globals).flat());
const graph = scripts.map((rel, i) => {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const uses = [...src.matchAll(/\b(?:window\.)?([A-Z][A-Za-z0-9_$]*)\b/g)].map(m => m[1]);
  const dependsOn = [...new Set(uses.filter(x => known.has(x) && !globals[rel].includes(x)))].map(x => scripts.find(s => globals[s].includes(x))).filter(Boolean);
  return { order: i + 1, module: rel, provides: globals[rel], dependsOn: [...new Set(dependsOn)] };
});
const outDir = path.join(ROOT, 'docs'); fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'runtime-dependency-graph.json'), JSON.stringify({ generatedAt: new Date().toISOString(), entry: 'index.html', scripts: graph }, null, 2));
let md = '# 实际运行时依赖图\n\n';
md += `生成时间：${new Date().toISOString()}\n\n`;
md += '数据来源：`index.html` 的实际脚本标签、各模块导出的 `window` 入口和运行时全局引用。\n\n';
md += '## 加载顺序\n\n';
for (const n of graph) md += `${n.order}. **${n.module}**${n.provides.length ? ` 提供：${n.provides.join('、')}` : ''}${n.dependsOn.length ? `；依赖：${n.dependsOn.join('、')}` : ''}\n`;
md += '\n## 模块边界\n\n';
md += '- **基础配置与持久化**：`config.js`、`save.js`、`telemetry.js`。\n';
md += '- **农场与仓库**：`farm.js`、`farm-expansion.js`、`farm-ui.js`、`warehouse.js`、`greenhouse.js`。\n';
md += '- **远征核心**：`expedition-types.js`、`expedition-core.js`、`expedition-terrain.js`、`expedition-combat.js`、`expedition-effects.js`、`expedition-render.js`。\n';
md += '- **规则扩展**：`difficulty-system.js`、`tech-system.js`、`combat-enhancement.js`、`v5.js`。\n';
md += '- **卡牌系统**：`v58/card-data.js`、`v58/card-system.js`；`card.js` 是旧存档和农场掉落的兼容适配层，当前仍被 `farm.js`、`game.js` 使用，暂不能删除。\n';
md += '- **测试与工具**：根目录测试脚本、`tools/` 下验证和构建脚本不进入运行时发布目录。\n\n';
md += '## 维护规则\n\n- 修改脚本加载顺序后运行 `npm run graph:runtime`。\n- 新模块必须明确提供的全局入口和依赖模块。\n- 新功能优先挂到已有稳定入口，避免新增裸 `window` 全局。\n- 删除兼容层前必须先清零调用方并通过存档迁移测试。\n';
fs.writeFileSync(path.join(outDir, 'runtime-dependency-graph.md'), md, 'utf8');
console.log(`generated ${graph.length} runtime modules`);
