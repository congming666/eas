# -*- coding: utf-8 -*-
import io
path = 'C:/Users/29401/Desktop/youxi/farm-cards-expedition/js/expedition.js'
with io.open(path, 'r', encoding='utf-8', newline='') as f:
    text = f.read().replace('\r\n', '\n')

old = "if (heavy || isCrit || isBoss) this.spawnShockRing(hitX, hitY, isBoss ? '#ffd9a0' : fxColor, isBoss ? 78 : 46);"
new = "if (heavy || isCrit || isBoss) this.spawnShockRing(hitX, hitY, isBoss ? '#ffd9a0' : impactColor, isBoss ? 78 : 46);"

if old not in text:
    raise SystemExit('pattern not found')
text = text.replace(old, new, 1).replace('\n', '\r\n')
with io.open(path, 'w', encoding='utf-8', newline='') as f:
    f.write(text)
print('fxColor -> impactColor fixed')
