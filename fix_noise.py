# -*- coding: utf-8 -*-
import io
path = 'C:/Users/29401/Desktop/youxi/farm-cards-expedition/js/ui.js'
with io.open(path, 'r', encoding='utf-8', newline='') as f:
    text = f.read()
old = "noiseGain.gain.exponentialRampToValueAtTime(.0001, now + preset.duration);\r\n    // 武器专属命中音色"
new = "noiseGain.gain.exponentialRampToValueAtTime(.0001, now + preset.duration);\r\n    noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(this.master);\r\n    // 武器专属命中音色"
if old not in text:
    raise SystemExit('pattern not found')
text = text.replace(old, new, 1)
with io.open(path, 'w', encoding='utf-8', newline='') as f:
    f.write(text)
print('noise connect restored')
