# v5.8「牌阵觉醒」卡牌架构冻结契约（所有子代理必读）

> 本文件是 v5.8 的**唯一架构合同**。数据 Schema、流派分类、API 名、文件归属、加载顺序一旦冻结不得擅改；
> 数值可在平衡测试后微调，但结构与命名必须遵守。简体中文。禁止刺眼全屏闪白。

---

## 0. 工程与运行

- 网页权威工程根（只改这里）：`C:\Users\29401\Desktop\u\farm-cards-expedition`
- 纯 Canvas2D + 原生 JS、零构建、`file://` 双击 `index.html` 直开。
- `index.html` **禁止内联脚本**；新 JS 独立文件；版本号统一用 `node tools/bump-version.js <ver>`。
- 数据源 `docs/game_data.json`；导出 `node tools/export-game-data.js`（headless Chrome，与 smoke test 错峰）。
- Shell 只有 PowerShell；Edit 工具若报 “File has not been read”，改用 node fs 补丁脚本，每个锚点断言**恰好出现 1 次**。
- 全局可见性：`GameState` 是顶层词法全局（`window.GameState===undefined`），模块内用裸标识符 `GameState`。
  金币在 `GameState.gold`；资源在 `GameState.warehouse.materials[id]`（旧代码也用 `GameState.materials`，迁移时两者兼容）。
  可用全局：`window.CONFIG / window.V5 / window.ResourceSystem(count,pay,add,has,key) / window.AudioManager / window.showToast / LoadoutSystem`。

---

## 1. 文件归属（避免并发冲突，严格执行）

**任何代理都不得编辑 `index.html`**（由 Organizer 统一加 `<link>/<script>`）。
**任何代理都不得直接改 `css/style.css`**；各模块新建独立 CSS，并由 Organizer 预挂 link：
- `css/v58-card.css`（卡牌数据/收藏/装载/工坊 UI）
- `css/v58-farm.css`（农场/仓库独立界面/家园全景）
- `css/v58-expedition.css`（远征 HUD/夺卡/图鉴）

| 代理 | 拥有文件（只允许改这些 + 新建） | 不得触碰 |
|---|---|---|
| FOUNDATION | 新建 `js/v58/card-data.js`、`js/v58/card-system.js`；`js/save.js`（仅新增字段默认与迁移） | 其它现有 js、所有 UI 渲染 |
| TITLE | `js/nebula.js`、`js/nebula-text.js`、新建 `css/v58-title.css` | 其余全部 |
| FARM | `js/farm.js`、`js/farm-ui.js`、`js/farm-expansion.js`、`js/warehouse.js`、`js/greenhouse.js`、`css/v58-farm.css` | v5.js、card.js、expedition/* |
| EXPEDITION | `js/expedition/*.js`（全部 6 个）、`css/v58-expedition.css` | farm*、card.js、v5.js |
| COLLECTION | `js/card.js`、`js/loadout-system.js`、`js/v5.js`、`js/ui.js`（仅 getSkillStats 桥接）、`js/v080-ui.js`、`css/v58-card.css` | farm*、expedition/*、greenhouse.js |

新文件加载顺序（Organizer 已写入 index.html）：
`card-data.js` → `card-system.js`（放在 `js/card.js` 之后、`js/v5.js` 之前）。
FOUNDATION 只产出**纯数据 + 纯逻辑**（可被 node require 做单测，不直接操作 DOM）；DOM 渲染归各 UI 代理。

---

## 2. 统一卡牌数据模型

三类卡，**彻底取消“反应卡 / 局前临选强化卡”概念**；不做局内抽牌堆/手牌（武器普攻与技能始终确定性可用，保自主性）。

| 类型 `type` | 用途 | 容量/入口 |
|---|---|---|
| `skill` 技能卡 | 装备到技能栏，走**能量 + 冷却**，确定性主动释放 | 技能卡槽 1→5（角色等级决定） |
| `item` 道具卡 | 远征 R 径向转盘使用 | 最多 **6 种 × 每种 5 个** |
| `seed` 种子卡 | F1–F5 直接种植 | 种子袋 |

武器**普攻始终独立可用**（鼠标），不受卡牌、能量影响。

**稀有度阶梯（4 级，新增 epic）**：
`common 普通 < rare 稀有 < epic 史诗 < legendary 传说`
权重 `rarityPower = {common:1, rare:2, epic:3, legendary:4}`。

**卡实例 Schema**：
```js
{
  uid: "inst_<ts>_<rand>",   // 实例唯一 id
  type: "skill|item|seed",
  defId: "chili_breath",     // 指向 CARD_DATA 定义
  rarity: "common|rare|epic|legendary",
  masteryLv: 0..5,           // 精通等级（见 §6）
  affixes: ["affix_dmg5", ...],   // 附魔/掉落追加词条 id
  tags: ["fire"],            // 冗余快照，来自定义 + 词条
  count: 1,                  // item/seed 的堆叠数量
  acquiredFrom: "boss:t1_boar_king" | "craft" | "capture" | "extract"
}
```
**卡定义 Schema（CARD_DATA）**：`{ defId, type, name, icon, rarity, tags:[], element, desc,
effect:{...结构化数值，禁止只放字符串}, niche:"不可替代定位", source:"来源", milestones?/signature? }`。

---

## 3. 流派 / 关键词分类（8 流派，冻结）

元素/流派 id 与中文名：
`fire 烈焰燃烧 · ice 寒冰控制 · lightning 雷鸣连锁 · poison 剧毒蔓延 · summon 召唤园艺 · bleed 流血处决 · armor 铁甲坚守 · wind 疾风机动`

**16 技能的流派归属（冻结）**：
| 技能 id | 名称 | 流派 |
|---|---|---|
| chili_breath | 辣椒火息 | fire |
| frost_barrier | 寒冰屏障 | ice |
| thunder_chain | 雷霆链 | lightning |
| poison_mist | 毒雾蔓延 | poison |
| pea_storm | 豌豆风暴 | summon |
| vine_bind | 藤蔓缠绕 | summon |
| healing_rain | 治愈甘霖 | summon |
| sun_drum | 骄阳战鼓 | summon |
| death_scythe | 死神镰舞 | bleed |
| straw_smash | 稻草猛击 | bleed |
| iron_armor | 金刚藤甲 | armor |
| thorn_burst | 荆棘爆发 | armor |
| earth_slam | 裂地猛击 | armor |
| earth_dash | 泥土遁走 | wind |
| smoke_screen | 烟幕诀 | wind |
| gale_slash | 疾风斩 | wind |

道具卡 / 种子卡 / 武器 / 战场植物也带流派标签（如 flame_bow、flame_elixir、辣椒/火龙草→fire；
电藤→lightning；寒霜花/寒冰藤→ice；毒荆棘/毒雾弹→poison；豌豆/缠绕/圣树→summon；镰刃/飞刃→bleed；
金刚藤甲/荆棘/护盾→armor；薄荷茶/泥土遁走/烟幕/疾风斩→wind）。

**克制环（冻结，伤害 +25% / -25%，并在卡面与悬浮提示标注）**：
`fire → summon → poison → armor → bleed → wind → lightning → ice → fire`
（即 fire 克 summon「火克藤」、ice 克 fire「雨灭火」；lightning 对水中/冰目标连锁增强；
免疫词条需换第二元素，逼玩家牌组备第二元素。）

---

## 4. 关键词协同（确定性组合加成，带入即生效）

- 统计**整套装载**（武器 + 已装备技能卡 + 携带道具卡 + 种子卡）的同标签数量；**不是抽牌触发**，构筑可见可控。
- 同标签达到 **2 / 3 / 4 / 5** 张触发里程碑被动。各流派里程碑（冻结效果方向，数值可平衡）：
  - **fire 烈焰燃烧**：3 火→攻击附加「燃烧」并可叠层；5 火→暴击点燃。
  - **ice 寒冰控制**：3 冰→冻结时长 +0.5s；碎冰伤害 +50%。
  - **lightning 雷鸣连锁**：水中/潮湿目标连锁 +2；3 雷→附加「感电」并削减敌方能量/攻击。
  - **poison 剧毒蔓延**：4 毒→敌人死亡时毒雾扩散。
  - **summon 召唤园艺**：2 召唤→藤甲减伤；4 召唤→召唤物/攻速 +。
  - **bleed 流血处决**：5 流血→流血爆伤；对低血量敌人触发处决。
  - **armor 铁甲坚守**：开战前叠甲，反伤 + 减伤（主动防御，替代旧反击流）。
  - **wind 疾风机动**：高机动、短冷却、隐身拉扯（替代旧弃牌流）。
- 收藏/装载器 UI 必须实时显示：平均能耗、各标签计数、协同里程碑高亮、战力与推荐 Tier、克制提示。

---

## 5. 27 道具卡（已存在，做“niche 审计”，不删卡）

`docs/game_data.json.consumables` 已有 27 个且效果与下列一致；FOUNDATION 把每个写成道具卡定义，
补 `niche`（最佳时机/不可替代）与 `tags`，重叠靠**数值/时长/条件**区分：

- 治疗阶梯：herb_kit 回50（前期廉价）/ bread 回80 / ketchup 回150 / medkit 回200 / med_shot 回50%最大生命（后期）/ ginseng_soup 满血+60s攻击20%（反攻一体）。
- 护盾：shield_gen 120 盾/10s（兽潮短时爆发） vs shield_elixir 150 盾/持久到击破（长线）。
- 攻击增益：war_horn 图腾攻速+40%（固定区域）/ rage_tonic 8s伤害+50%但受伤+15%（高风险）/ flame_elixir +20%并清中毒（安全净化，fire）/ egg 120s攻击+15%（长效弱增益）。
- 机动脱战：mint_tea 60s移速+15%（wind）/ wraith_draft 完整隐身5s / insecticide 6s丢失目标且农场治虫害（双用途）。
- 控制聚怪：beartrap_item 定身3s / rotting_bait 聚怪8s。
- 视野能量：scout_eagle 开雾8s / torch 限时照明 / energy_cell 瞬满 / grape_juice 15s回能×2 / juice 能量上限+40。
- 投掷攻防：thorn_storm 80纯AOE / poison_bomb 60伤+减速3s。
- 特殊：signal_flare 就地召唤撤离点 / death_pardon 自动免一次降级 / purify_tonic 清减速中毒。

---

## 6. 升级体系统一（精通 + 附魔，取消并行 UI）

- 一条成长路径：**重复卡 / 融合 → 精通 Lv1–5**；**附魔 → 额外后缀词条**。
- 精通每级：**伤害/治疗/护盾 +18%、冷却 -5%**（沿用旧规）；角色等级仍决定技能卡槽与基础属性。
- 取消游离的「强化卡」「技能 5 级」并行 UI，全部并入**卡牌精通 / 附魔**。
- 旧 `GameState.skillLevels` 与 `getSkillStats` 必须桥接：由 COLLECTION 在 `js/ui.js`、`js/v5.js`
  让 `getSkillStats` 读取 `CardV58.skillEffectiveLevel(id)` / `CardV58.cardStats(card)`，保证旧战斗数值不断链。
- 迁移：FOUNDATION 提供 `CardV58.migrate()`，把旧 `cardInventory`（boost 卡）与 `skillLevels` 折算进新收藏与精通。

**词条池（affix，冻结示例，FOUNDATION 补全并按稀有度分配数量：rare 1 / epic 1–2 / legendary 2 + 专属）**
- `affix_dmg5` 伤害额外 +5%（可分元素/物理）
- `affix_recast5` 5% 概率再次触发（技能/道具）
- 冷却 -x%、暴击率 +x%、附加元素（燃烧/冰冻/感电/流血概率与层数）、击杀回血、能量消耗 -、
  持续时间 +、范围 +、攻速 +、处决阈值 +、护盾/治疗 +、移速 +、拾取范围 +、金币/经验 +。
- 附魔站后缀统一命名，如「+燃烧」「+回收」「+急速」。
- **平衡**：单条词条期望收益按 DPS/有效生命折算，传说组合总增益需经 bot 复测，不得出现碾压或废词条。

---

## 7. 局内夺卡（奖励选择，不占技能槽、不制造死牌）

- 节点：每 **2 分钟**道路节点 + 精英 / Boss / 宝箱 / 商人，**三选一**。
- 为堵“技能槽满却抽到技能卡”，夺卡**只给三类**：① 精通/附魔（升级现有卡，永远可用）② 道具卡 ③ 种子卡。
  **新技能卡一律走 Boss 蓝图 / 局外解锁**，不在局内塞技能。
- 道具受「6 种 ×5」上限约束；容量不足时该选项**置灰并说明**，不出现拿了用不了。
- 篝火：升级一张卡 / 移除一张卡 / 休息回血，三选一；商人：买卡 / 删卡 / 升级 / 补货。
- **12 Boss 各掉签名卡 + 必给蓝图**（FOUNDATION 在 CARD_DATA.signatures 为 12 boss 各定义一张签名卡）。

---

## 8. 撤离 / 搜打撤规则（逻辑闭环）

- 局内夺卡/掉落是**物理副本**，进背包（有限格，**金币 100 / 格**）。
- 撤离→按稀有度**铭记**：普通 25% / 稀有 15% / 史诗 8%；**Boss 蓝图必给**；重复卡转**精通进度**。
- 死亡：带入的消耗品 / 种子 / **武器实例**丢失、局内战利品全丢（**安全箱 1–3 格必保留**）；
  **技能收藏与精通永不丢失**；50% 概率降级由 **death_pardon 免死令自动免除**。
- 硬核模式另做「实体卡全损」开关（`GameState.hardcoreFullLoss`，默认 false）。
- 安全箱格数 `GameState.safeBoxSlots` 默认 1，可升级到 3。

---

## 9. 农场 = 卡牌兵工厂

- 卡牌工坊**四工位**：`print 印制` / `enchant 附魔（追加后缀 +燃烧·回收·急速）` /
  `fuse 融合（5 合 1）` / `inscribe 铭记研究`。
- 制卡材料**全部可种植**：
  - 卡牌纸 = 纤维 + 清水；墨汁 = 毒腺/炭 + 莓果；
  - 附魔精华 = 温室「灵光菇」+「符文藤」；颜料 = 季节「彩果」。
- 温室新增 4 种：**墨铃花 inkbell、符文藤 runevine、灵光菇 glowshroom、彩果 colorfruit**（FARM 在 greenhouse 落数据与种植）。
- 各 NPC 给**专属卡**（FOUNDATION 定义，FARM/NPC 接线）。

---

## 10. CardV58 API 契约（FOUNDATION 实现并挂 `window.CardV58`；纯逻辑可 node 单测）

数据：`window.CARD_DATA = { factions:{}, rarities:[], skills:{}, items:{}, seeds:{}, signatures:{}, affixes:{}, synergy:{}, counter:{} }`

```js
CardV58 = {
  FACTIONS, RARITIES,
  makeCard(type, defId, opts),          // 卡实例
  getDef(type, defId),
  // 协同
  loadoutTags(loadout),                 // -> {tag:count}（含武器/技能/道具/种子）
  synergyState(loadout),                // -> {tags:{fire:{count,active:[milestoneId]}}, buffs:[...]}
  synergyMods(loadout),                 // -> 扁平数值修正 {dmgByTag, cdr, ...}
  // 精通/附魔
  getMastery(key), setMastery(key,lv), addMasteryProgress(key,amt),
  skillEffectiveLevel(skillId),         // 供 getSkillStats 桥接
  rollAffix(rarity), affixMods(card),
  cardStats(card),                      // 最终数值（精通+词条+协同外的局部修正）
  describe(card),
  // 夺卡
  rollCapture(ctx), applyCapture(choice, ctx),
  // 撤离/死亡
  inscribeRoll(card),                   // -> bool（25/15/8，蓝图必成）
  onExtract(ctx), onDeath(ctx),
  // 工坊
  canPrint(recipe), print(recipe), enchant(card,affixId), fuse(cardUids), research(...),
  // 迁移
  migrate()
}
```

**GameState 新增字段（FOUNDATION 在 save.js 默认 + 序列化）**：
`collection:{skill:{},item:{},seed:{}}`、`ownedBlueprints:[]`、`safeBoxSlots:1`、
`hardcoreFullLoss:false`、`deckPresets:[]`、`captureLog:[]`。
所有新字段读取都要容错（旧存档缺失时给默认）。

---

## 11. 验收（每个代理自检，FOUNDATION 尤为严格）

- `node tools/syntax-check.js` 通过；新文件可被 node 解析（FOUNDATION 用 `module.exports` 兼容 + 浏览器全局双挂载）。
- FOUNDATION 产出 node 单测：遍历全部卡定义无坏引用、标签合法；协同里程碑、铭记概率、死亡保留规则各至少 1 个断言。
- 不破坏：武器普攻独立、技能能量+冷却确定性、现有远征/天气/难度/Boss 逻辑。
- 完成后回报：新增/修改文件**绝对路径**、自测命令与结果、未覆盖项（不得宣称未做项为完成）。
