# 农场卡牌：荒野远征

> 当前版本 **v1.3** — 武器独立实例制 + 搜打撤 + 成就殿堂

融合 QQ 农场经营 + 卡牌收集 + 搜打撤远征的 2D 网页游戏。

## 玩法

- **农场经营**：种植 17 种作物、4 阶段生长、4 品质变异、作物组合、加工工坊、温室
- **远征搜打撤**：进入 T1/T2/T3 地图，16格背包+安全箱，打怪开宝箱，随机撤离点，死亡永久损失带入武器
- **武器系统**：5 把武器（镰刃/连弩/法杖/飞刃/火弓），每把独立实例，可升 10 级，锻造台打造/升级
- **成就殿堂**：31 个成就，从"初次撤离"到"噩梦通关"，解锁属性/蓝图/称号
- **难度系统**：休闲/普通/困难/噩梦 + Heat 修改器（Hades 式负面词缀）
- **战斗系统**：连击计数、完美闪避慢动作、精英词缀、Boss 多阶段、Roguelike 岔路
- **NPC 系统**：流浪商人/老农夫/远征老兵/神秘旅人，好感度解锁专属内容

## 技术栈

- 纯前端 Canvas2D + 原生 JavaScript，无框架依赖
- localStorage 存档（schema 版本 + 自动迁移）
- 武器/怪物/角色素材：AI 生成概念图

## 运行

直接用浏览器打开 `index.html` 即可，或起一个静态服务器：

```bash
npx serve .
```

## 目录

```
js/
  config.js           全局配置（武器/怪物/作物/材料/难度）
  game.js             主游戏控制
  expedition.js       远征核心逻辑（战斗/AI/特效/兽潮/Boss）
  loadout-system.js   背包/安全箱/武器实例管理
  achievement-system.js  成就殿堂
  warehouse.js        物资仓库
  npc-system.js       NPC 好感度
  combat-enhancement.js 连击/闪避/怒气系统
  difficulty-system.js   难度+Heat修改器
css/                  样式
docs/art/weapons/     武器概念图
index.html            入口
```

## 更新日志

见 [CHANGELOG.md](./CHANGELOG.md)
