# 实际运行时依赖图

生成时间：2026-10-08T09:47:12.372Z

数据来源：`index.html` 的实际脚本标签、各模块导出的 `window` 入口和运行时全局引用。

## 加载顺序

1. **js/config.js**；依赖：js/v5.js
2. **js/crop-art.js** 提供：CropArt
3. **js/save.js**；依赖：js/v5.js、js/v58/card-system.js
4. **js/telemetry.js** 提供：Telemetry；依赖：js/v5.js
5. **js/ui.js**；依赖：js/v58/card-system.js
6. **js/card.js** 提供：__v58Bridge、CardSystem；依赖：js/v58/card-system.js、js/v58/card-data.js、js/v5.js
7. **js/farm.js**；依赖：js/v5.js、js/farm-expansion.js、js/crop-render-ext.js、js/crop-art.js、js/crop-expansion.js、js/card.js、js/npc-system.js
8. **js/farm-expansion.js** 提供：FarmTraitSystem、FarmCareSystem、FarmProcessingSystem、FarmCollectionSystem、FarmDecorationSystem、FarmRecipes、DecoShopItems；依赖：js/weather-system.js、js/v5.js、js/telemetry.js
9. **js/warehouse.js**；依赖：js/v5.js、js/loadout-system.js、js/crop-art.js
10. **js/greenhouse.js** 提供：__ghRegisterV58；依赖：js/v5.js、js/crop-art.js
11. **js/performance.js** 提供：SpatialHash、TerrainChunkCache
12. **js/pixi-renderer.js** 提供：PixiEffects；依赖：js/v5.js
13. **js/expedition/expedition-types.js**
14. **js/expedition/expedition-core.js**；依赖：js/v5.js、js/tech-system.js、js/loadout-system.js、js/crop-expansion.js、js/performance.js、js/difficulty-system.js、js/combat-enhancement.js、js/crop-art.js
15. **js/expedition/expedition-terrain.js**；依赖：js/v5.js、js/combat-enhancement.js、js/v58/card-system.js、js/v58/card-data.js、js/loadout-system.js
16. **js/expedition/expedition-world.js**；依赖：js/v5.js
17. **js/expedition/expedition-combat.js**；依赖：js/v5.js、js/telemetry.js、js/loadout-system.js、js/crop-art.js、js/v58/card-data.js、js/v58/card-system.js、js/difficulty-system.js、js/achievement-system.js、js/tech-system.js、js/weather-system.js、js/combat-enhancement.js
18. **js/expedition/expedition-effects.js**
19. **js/expedition/expedition-render.js**；依赖：js/v5.js、js/crop-art.js、js/loadout-system.js、js/weather-system.js、js/pixi-renderer.js、js/combat-enhancement.js
20. **js/weather-system.js** 提供：showToast、WeatherFX、WeatherSystem；依赖：js/v5.js、js/farm-expansion.js
21. **js/world-fx.js**；依赖：js/v5.js、js/weather-system.js
22. **js/difficulty-system.js** 提供：DifficultySystem
23. **js/npc-system.js** 提供：NpcSystem；依赖：js/farm-expansion.js
24. **js/tech-system.js** 提供：TechSystem
25. **js/v080-ui.js** 提供：NpcSystemUI、TechSystemUI、DiaryUI；依赖：js/npc-system.js、js/tech-system.js
26. **js/crop-expansion.js** 提供：CropExpansion；依赖：js/v5.js、js/farm-expansion.js
27. **js/crop-render-ext.js** 提供：CropRenderExt；依赖：js/crop-expansion.js、js/weather-system.js、js/crop-art.js、js/v5.js
28. **js/combat-enhancement.js** 提供：CombatEnhancement；依赖：js/difficulty-system.js、js/v5.js
29. **js/achievement-system.js** 提供：AchievementSystem；依赖：js/npc-system.js
30. **js/loadout-system.js** 提供：LoadoutSystem；依赖：js/telemetry.js、js/v5.js、js/achievement-system.js
31. **js/v58/card-data.js** 提供：CARD_DATA
32. **js/v58/card-system.js** 提供：CardV58；依赖：js/v58/card-data.js
33. **js/v5.js** 提供：CONFIG、V5、getSkillStats、CharacterSystem、ResourceSystem、ArchiveSystem、CodexSystem；依赖：js/v58/card-system.js、js/farm-expansion.js、js/telemetry.js、js/achievement-system.js、js/tech-system.js、js/combat-enhancement.js、js/difficulty-system.js、js/crop-art.js
34. **js/game.js**；依赖：js/npc-system.js、js/tech-system.js、js/crop-expansion.js、js/achievement-system.js、js/loadout-system.js、js/card.js、js/difficulty-system.js、js/v5.js、js/crop-art.js、js/farm-expansion.js、js/farm-ui.js、js/telemetry.js、js/pixi-renderer.js、js/combat-enhancement.js
35. **js/nebula.js** 提供：Nebula
36. **js/nebula-text.js**；依赖：js/v5.js
37. **js/title-starfield.js**
38. **js/farm-panorama.js** 提供：FarmPanorama
39. **js/farm-ui.js** 提供：__farmCmdInit、FarmUI；依赖：js/farm-expansion.js、js/v5.js、js/weather-system.js、js/achievement-system.js、js/farm-panorama.js
40. **js/expedition-layout.js**；依赖：js/v5.js、js/loadout-system.js、js/v58/card-system.js

## 模块边界

- **基础配置与持久化**：`config.js`、`save.js`、`telemetry.js`。
- **农场与仓库**：`farm.js`、`farm-expansion.js`、`farm-ui.js`、`warehouse.js`、`greenhouse.js`。
- **远征核心**：`expedition-types.js`、`expedition-core.js`、`expedition-terrain.js`、`expedition-combat.js`、`expedition-effects.js`、`expedition-render.js`。
- **规则扩展**：`difficulty-system.js`、`tech-system.js`、`combat-enhancement.js`、`v5.js`。
- **卡牌系统**：`v58/card-data.js`、`v58/card-system.js`；`card.js` 是旧存档和农场掉落的兼容适配层，当前仍被 `farm.js`、`game.js` 使用，暂不能删除。
- **测试与工具**：根目录测试脚本、`tools/` 下验证和构建脚本不进入运行时发布目录。

## 维护规则

- 修改脚本加载顺序后运行 `npm run graph:runtime`。
- 新模块必须明确提供的全局入口和依赖模块。
- 新功能优先挂到已有稳定入口，避免新增裸 `window` 全局。
- 删除兼容层前必须先清零调用方并通过存档迁移测试。
