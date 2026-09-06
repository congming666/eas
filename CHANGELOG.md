# 更新日志

## v0.4.0 — 2026-09-06

### 修复
- **兽潮卡死**：第一波兽潮激活时 `updateWorldSystems` 引用未定义变量 `waveMonsters`（应为 `waveMonsterCount`），抛 ReferenceError 导致整个游戏循环冻结。已修正。

### 新增
- **Boss 四技能循环**：原单一 AOE 改为 `abilityIndex` 循环 0-3：
  1. 地裂震荡 — 玩家脚下 AOE + 冲击环 + 近距伤害
  2. 狂暴冲锋 — 向玩家突进 140-170 距离 + 橙色拖尾 + 终点冲击
  3. 召唤兽群 — 召唤 2-3 只 wolf/spider/bat，带召唤阵
  4. 暗影弹幕 — 6-8 发扇形投射物
  - 阶段二（hp<50%）：伤害 ×1.3、数量 +1、冷却 4.0s → 2.6s
- **近战三连击**：横扫 → 反手 → 终结，终结技重击破甲 + 高击退

### 调整
- **处决/死亡动画大幅调低调**：
  - Boss：killFlash 0.26→0.10、hitStop 0.16→0.07、screenShake 1.15→0.45、radialBurst 36→18
  - 普通怪：对应参数同步减半
  - 终结技：lungePower [10,15,23]→[10,13,17]、visualVz 170/125→120/95、slash 范围 86/66→70/58

### 优化
- **所有攻击特效加双层层次**：
  - `spawnImpact` 加外环 shock
  - `spawnShockRing` 加白色内环（0.55 倍大小短寿命）
  - `spawnSlashEffect` 加白色内层高光弧（0.7 倍大小）
  - `spawnAoeEffect` 加白色内环（0.6 倍大小）
- 新增 `SpawnImpact` / `SpawnShockRing` 通用特效方法

---

## v0.3.0 — 2026-08-XX

- 远征系统初版上线（搜打撤、兽潮、Boss、防御塔、宝箱）
- 农场经营（种植、育种、卡牌工坊、物资仓库）
