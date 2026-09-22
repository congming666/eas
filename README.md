# 农场卡牌：荒野远征

> 当前版本 **v5.5「家园联动」** — 加工工坊成品（面包/急救包/火把/毒雾弹等）全部接入远征消耗品体系、火把照明按难度分级且无火把视野极小、农场底部改为实时家园指挥台（48格微缩地图+建筑状态卡+一键操作）、美观度增益显性化、天气屏幕特效（雨丝/雷暴/雾/旱）、撤离卡死修复、边界迷雾裁剪；数值表升级为 24 sheet《游戏数据表_v5.5.xlsx》。
> 当前版本 **v5.4「荒野校准」** — 难度两维重做（Tier 单调硬曲线 + 难度平移，噩梦机制化）、12 Boss 软狂暴双向收束（进攻增益封顶、受伤递增不封顶）、兽潮指数化 + 撤离点清怪、背包超重减速、消耗品拾取断链修复；四轮全量级千局复测 + 定向验证，经济闭环实测 **7 次成功撤离满级一把武器**（目标 5–8 局）；v5.3：5 画像 1088 局无头跑批、Wilson 置信区间、单杠杆 A/B、nightly CI；v5.2：22 事件对局埋点 + 数据看板；v5.0「荒野觉醒」：100 级修行台 × 16 技能 × 远征档案 × 14 种具体资源 × 12 Boss/24 地图 × 105 张统一写实图标

融合 QQ 农场经营 + 卡牌收集 + 搜打撤远征的 2D 网页游戏。

## 玩法

- **农场经营**：种植 20+ 种作物（战斗型/季节型/稀有型/修为型）、4 阶段生长、4 品质变异、作物组合、加工工坊（16 配方闭环）、14 种温室作物、**修行台（角色 1–100 级升级与技能装备）**
- **远征搜打撤**：T1–T4 共 24 张子地图（**每张独立怪物池、专属精英与 12 个专属 Boss**、天气倾向），16 格背包 + 安全箱，随机撤离点，死亡永久损失带入武器/战利品，50% 概率降 1 级（免死令可免除）
- **战场种植**：20 种作战植物（火焰陷阱/视野灯/减速藤/治疗菇/雷鸣藤/镜草等），携带种子 F1–F5 右键种植，整局存活、结算即消失，野生植株可采摘回种
- **武器系统**：5 把武器（镰刃/连弩/法杖/飞刃/火弓），每把独立实例、独立锻造 10 级，4–7 级解锁专属词条、8–10 级质变特效
- **地图表现**：分层地形（土路/泥地/水洼/密林/废墟）、三层视差远景、昼夜循环与火把照明、晴雨雷雾天气、空间叙事地标、相机震屏与惯性
- **技能构筑**：16 个技能各 5 级，初始解锁 1 个，其余按等级/收获/锻造/撤离/Boss/档案条件解锁，卡槽随等级 1→5
- **远征档案**：5 份突破档案卡等级上限 + 约 20 份普通档案，点亮给技能卷轴/安全箱扩容/传说种子/蓝图/免死令
- **成就殿堂**：31 个成就，从“初次撤离”到“噩梦通关”，解锁属性/蓝图/称号
- **难度系统**：休闲/普通/困难/噩梦 + Heat 修改器（Hades 式负面词缀）
- **战斗系统**：攻击前摇预警、连击计数、完美闪避慢动作、精英词缀、Boss 多阶段、怒气超杀、整局一次的 Roguelike 岔路
- **NPC 系统**：流浪商人/老农夫/远征老兵/神秘旅人，好感度解锁专属内容
- **资源闭环**：14 种具体资源（泥土/清水/堆肥/石料/纤维/精铁锭/毒腺/甲壳/魂烬等），工坊食品药品全部可在远征消耗，旧“材料”存档无损迁移

## 技术栈

- 纯前端 Canvas2D + 原生 JavaScript，无框架依赖
- localStorage 存档（schema 版本 + 自动迁移）
- **数据驱动平衡**：`js/telemetry.js` 22 事件本地埋点 + 游戏内数据看板（JSON 导出）；`tools/balance-bot.js` 用 Playwright 无头驱动真实游戏代码自动跑 **1088 局**（5 画像：满级配装/新手/寻 Boss/有限补给/贪财，每画像×Tier×难度 n≥25，虚拟时钟快进、跳过渲染），所有撤离率带 Wilson 95% 置信区间、相邻难度用两比例 z 检验标"噪声"，支持注入式单杠杆 A/B；产出 `docs/balance-report.md`（13 节平衡报表）与 `docs/balance-economy.md`（30 档经济闭环模拟，v5.4 实测双线 7 次成功撤离满级、纯远征零成长反证），逐局 JSON 归档 `tools/balance-history/` 并自动做版本对比
- 武器/怪物/Boss/技能/作物/道具/资源/建筑素材：AI 生成概念图并统一云端抠图为 512px 透明 PNG（`assets/icons/**/*_t.png`，累计 105 张），双击 file:// 打开也不会出现黑/白底方块；技能释放特效由 Canvas 程序化实时绘制
- 天气雨声/狼嚎等环境音由 Web Audio 程序合成，无外部音频文件

## 运行

直接用浏览器打开 `index.html` 即可（零构建、零模块加载器，file:// 下可玩），或起一个静态服务器：

```bash
npx serve .
```

## 工程命令

```bash
npm run check     # 对全部 JS 跑 node --check 语法关卡
npm test          # Playwright 端到端冒烟（首次需 npx playwright install chromium）
npm run balance   # 无头 bot 全量跑批（full=1088 局 / nightly=504 局），产出 docs/balance-report.md
npm run balance:nightly  # CI 夜间档：504 局（5 画像压缩队列）
npm run balance:economy  # 经济闭环专项：新号连跑 30 档，验证武器 +10 所需成功撤离局数
npm run build     # 把运行时文件汇集到 dist/，并校验所有本地资源引用
npm run version:sync -- 4.3.0   # 升版：config.js 为唯一数据源，联动 title/meta/缓存戳/package.json
```

## 目录

```
js/
  config.js              全局配置（武器/怪物/作物/材料/难度/24张子地图，GAME_VERSION 唯一版本源）
  game.js                主游戏控制
  farm-ui.js             农场界面 DOM 交互（原内联在 index.html）
  expedition/            远征玩法（按 Unity 端同名边界拆分，原型混合挂载，加载顺序见 index.html）
    expedition-types.js    共享常量与类型
    expedition-core.js     class 本体：实例状态/输入/暂停菜单，update() 仅做帧编排
    expedition-terrain.js  地形/迷雾/碰撞/地图生成/玩家移动/相机/陷阱
    expedition-combat.js   怪物AI/Boss/技能/植物防线/子弹/掠夺者/防御塔/拾取/撤离/结算
    expedition-effects.js  粒子对象池/武器命中特效/帧视觉计时
    expedition-render.js   render() 帧编排 + 实体/天气/昼夜/HUD/小地图渲染
  world-fx.js            地图真实感模块（后处理/密林/废墟/远景/光照/天气/叙事道具/相机）
  crop-art.js            作物/道具/陷阱/建筑透明贴图统一加载器
  loadout-system.js      背包/安全箱/武器实例管理
  achievement-system.js  成就殿堂
  warehouse.js           物资仓库
  npc-system.js          NPC 好感度
  combat-enhancement.js  连击/闪避/怒气/处决/Roguelike 岔路
  difficulty-system.js   难度 + Heat 修改器
  telemetry.js           22 事件本地埋点 + 数据看板（localStorage 采集、JSON 导出）
assets/
  crops/ items/ traps/ buildings/ props/ landmarks/   物品透明贴图（*_t.png）
  monsters/ bosses/ obstacles/                       角色与障碍 webp 精灵
  maps/                                                24 张子地图背景
  weapons/                                             5 把武器精灵图
docs/art/                                             武器等运行时美术图（发布时随 dist 拷贝）
css/style.css          全部样式（原内联在 index.html）
tools/                 syntax-check / build-dist / bump-version / export-game-data 工程脚本
  balance-bot.js       无头平衡 bot（Playwright 驱动真实游戏；5 画像、CI/杠杆/经济专项）
  balance-report.json  bot 逐局原始数据
  balance-economy.json 经济闭环专项逐档数据
  balance-history/     历次跑批 JSON 归档（版本对比数据源）
.github/workflows/     balance.yml：nightly 500 局 + 经济专项，定时/手动触发
docs/balance-report.md 千局平衡报表（CI/z 检验/12 Boss TTK 与软狂暴/杠杆 A·B/r5 定向验证）
docs/balance-economy.md 30 档经济闭环模拟报告（纯远征反证 + 农场双线）
index.html             入口（仅结构与脚本引用）
smoke_test.js          Playwright 端到端冒烟测试，截图输出到 test-results/
```

## 更新日志

见 [CHANGELOG.md](./CHANGELOG.md)
