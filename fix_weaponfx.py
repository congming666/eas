# -*- coding: utf-8 -*-
import io
path = 'C:/Users/29401/Desktop/youxi/farm-cards-expedition/js/expedition.js'
with io.open(path, 'r', encoding='utf-8', newline='') as f:
    text = f.read().replace('\r\n', '\n')

old = "    const fxColor = isCrit ? '#fff3b0' : color;\n    this.spawnImpact(hitX, hitY, fxColor, isCrit ? 1.5 : 1);\n    this.spawnDirectionalSparks(hitX, hitY, hitAngle, isCrit ? '#fff0a0' : color, heavy ? 9 : 6, isBoss ? 1.25 : 1);"
new = "    // 武器专属配色：命中光爆与定向火花颜色随武器变化\n    const fx = WEAPON_FX[weaponId];\n    const impactColor = isCrit ? '#fff3b0' : (fx ? fx.impact : color);\n    const sparkColor = isCrit ? '#fff0a0' : (fx ? fx.spark : color);\n    this.spawnImpact(hitX, hitY, impactColor, isCrit ? 1.5 : 1);\n    this.spawnDirectionalSparks(hitX, hitY, hitAngle, sparkColor, heavy ? 9 : 6, isBoss ? 1.25 : 1);"

if old not in text:
    raise SystemExit('pattern not found')
text = text.replace(old, new, 1).replace('\n', '\r\n')
with io.open(path, 'w', encoding='utf-8', newline='') as f:
    f.write(text)
print('WEAPON_FX wired into damageEnemy')
