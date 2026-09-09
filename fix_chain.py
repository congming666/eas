# -*- coding: utf-8 -*-
import io, sys
path = 'C:/Users/29401/Desktop/youxi/farm-cards-expedition/js/expedition.js'
with io.open(path, 'r', encoding='utf-8', newline='') as f:
    text = f.read().replace('\r\n', '\n')

patches = []

# 闪电折线更亮更粗、寿命略长
patches.append(("bolt life",
"""    const p = this.allocParticle();
    Object.assign(p, { x: (x1 + x2) / 2, y: (y1 + y2) / 2, vx: 0, vy: 0,
      life: 0.16, maxLife: 0.16, color, size: 1, type: 'chain', points });""",
"""    const p = this.allocParticle();
    Object.assign(p, { x: (x1 + x2) / 2, y: (y1 + y2) / 2, vx: 0, vy: 0,
      life: 0.2, maxLife: 0.2, color, size: 1, type: 'chain', points });"""))

# 电击链每跳落点加光爆与火花
patches.append(("chain landing fx",
"""    hitSet.push(nearest);
    this.spawnLightningBolt(source.x, source.y, nearest.x, nearest.y);
    this.damageEnemy(nearest, (proj.damage || 10) * dmgRatio, '#a9f5ff', false, {""",
"""    hitSet.push(nearest);
    this.spawnLightningBolt(source.x, source.y, nearest.x, nearest.y);
    this.spawnImpact(nearest.x, nearest.y, '#bff7ff', 1.1);
    this.spawnDirectionalSparks(nearest.x, nearest.y,
      Math.atan2(nearest.y - source.y, nearest.x - source.x), '#cdf9ff', 5, 0.9);
    this.damageEnemy(nearest, (proj.damage || 10) * dmgRatio, '#a9f5ff', false, {"""))

# chain 渲染加粗：三层（外辉光/青色主线/白色芯）
patches.append(("chain render",
"""          const trace = (width, color, a) => {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.strokeStyle = color; ctx.globalAlpha = a; ctx.lineWidth = width;
            ctx.lineJoin = 'round'; ctx.lineCap = 'round';
            ctx.beginPath();
            p.points.forEach((pt, i) => { const px = pt.x - cam.x, py = pt.y - cam.y; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
            ctx.stroke();
            ctx.restore();
          };
          trace(4, '#7fe9ff', alpha * 0.6);
          trace(1.6, '#ffffff', alpha);
          ctx.globalAlpha = 1;""",
"""          const trace = (width, color, a) => {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.strokeStyle = color; ctx.globalAlpha = a; ctx.lineWidth = width;
            ctx.lineJoin = 'round'; ctx.lineCap = 'round';
            ctx.beginPath();
            p.points.forEach((pt, i) => { const px = pt.x - cam.x, py = pt.y - cam.y; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
            ctx.stroke();
            ctx.restore();
          };
          trace(8, 'rgba(90,200,255,.55)', alpha * 0.5);
          trace(3.4, '#7fe9ff', alpha * 0.9);
          trace(1.5, '#ffffff', alpha);
          ctx.globalAlpha = 1;"""))

for name, old, new in patches:
    if text.count(old) != 1:
        print('FAIL [%s] count=%d' % (name, text.count(old))); sys.exit(1)
    text = text.replace(old, new, 1); print('[OK]', name)

with io.open(path, 'w', encoding='utf-8', newline='') as f:
    f.write(text.replace('\n', '\r\n'))
print('chain visual upgraded')
