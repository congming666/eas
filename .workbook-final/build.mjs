import fs from 'node:fs/promises';
import path from 'node:path';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';
const root=path.resolve('.');
const d=JSON.parse(await fs.readFile(path.join(root,'docs/game_data.json'),'utf8'));
const c=d.allConfig,card=d.cardData,sys=d.systemData;
const labels={};
for(const line of `id 编号
name 名称
version 版本
ruleset_id 规则版本
canvas 画布
width 宽度
height 高度
player 玩家
weapons 武器
expedition 远征
maps 地图
skills 技能
consumables 消耗品
plants 防线植物
nutrients 养分
plantDrops 防线种子掉落
plantGrowth 植物培育
counterMixes 克制组合
monsters 怪物
crops 作物
deployPlants 部署植物
cropToDeploy 作物部署映射
wildPlants 野生植物
warehouseItems 仓库物品
greenhousePlants 温室植物
greenhouseDrops 温室产物
resources 材料资源
cropMaterials 作物材料产出
skillUnlock 技能解锁
cultivationCrops 修为作物
growth 成长规则
bosses 首领
archives 档案
hp 生命
dmg 伤害
hpMul 生命倍率
dmgMul 伤害倍率
speed 移动速度
radius 半径
range 射程
attackRange 攻击距离
damage 伤害
attackDamage 攻击伤害
attackCooldown 攻击间隔秒
cooldown 冷却秒
cd 冷却秒
energy 能量消耗
maxEnergy 能量上限
energyRegen 能量恢复每秒
maxHp 生命上限
baseAtk 基础攻击
defense 防御
level 等级
maxLevel 等级上限
maxAffixes 词缀上限
minAffixes 词缀下限
tier 区域阶级
minTier 最低阶级
rarity 稀有度
minRarity 最低稀有度
growTime 生长时间秒
seedPrice 种子价格
sellPrice 售价
desc 效果说明
description 详细说明
trait 特性
type 类型
mode 攻击方式
category 分类
kind 种类
value 数值
chance 触发概率
amount 数量
min 数量下限
max 数量上限
drops 产出
gold 金币
materials 材料
wood 木材
stone 石料
iron 铁矿
fiber 纤维
crystal 晶核
refined_iron 精铁
venom 毒腺
carapace 甲壳
soul_ash 魂灰
bossFang 首领獠牙
soil 泥土
water 清水
compost 堆肥
herb 药草
ink 墨汁
pigment 颜料
enchant_essence 附魔精华
from 获取来源
to 用途
cost 费用
baseCost 基础费用
costMultiplier 费用倍率
reward 奖励
rewardMul 奖励倍率
rewardBonus 额外奖励比例
supplyMul 补给倍率
vision 视野倍率
visionMul 视野倍率
torchMul 火把消耗倍率
comboCap 连击加成上限
dodgeWindow 完美闪避窗口毫秒
dodgeCrit 闪避后保证暴击
dodgeCritDmg 闪避暴击倍率
ultBossDmg 终结技首领伤害比例
ultEliteDmg 终结技精英伤害比例
executeKill 允许处决
executeDmg 处决伤害比例
envPlayerMul 环境伤害倍率
effect 效果
effects 等级效果
element 元素
tags 标签
niche 定位
source 来源
power 品质强度
inscribe 铭记概率
defId 定义编号
weaponId 武器编号
cropId 作物编号
skill 技能
unlockSkill 解锁技能
upgradeSkill 升级技能
buffType 增益类型
buffValue 增益数值
buffDuration 增益持续场次
harvestBuff 收获增益
qualityBonus 品质加成
reharvest 可重复收获次数
rareVariant 稀有变种
rareEvent 稀有事件
priceMultiplier 价格倍率
npcAffectionAll 全体居民好感
weatherBoost 天气加成
comboWith 组合搭配
comboName 组合名称
comboEffect 组合效果
comboValue 组合数值
requiresWater 需要水分
waterPlotOnly 仅限水田
droughtImmune 干旱免疫
auraRange 光环范围
auraEffect 光环效果
legendaryBonus 传说额外加成
requiresGreenhouse 需要温室
cardChance 卡牌产出概率
rewardType 收获奖励类型
rewardLabel 收获奖励说明
inputCrop 输入作物
inputQty 输入数量
inputs 输入材料
outputId 产物编号
outputName 产物名称
outputQty 产出数量
time 加工时间秒
workshopLevel 工坊等级
entryFee 入场费用
monsterCount 怪物数量
chestCount 宝箱数量
raiderCount 掠夺者数量
rareSeedChance 稀有种子概率
legendarySeedChance 传说种子概率
monsterPool 怪物池
weatherTendency 天气倾向
terrain 地形
eliteId 精英编号
bossId 首领编号
boss 首领标记
elite 精英标记
loot 旧掉落配置
armor 护甲减伤
ai 行为类型
projectileSpeed 投射物速度
moveSpeed 移动速度
sprintSpeed 冲刺速度
sprintCost 冲刺耗能
collisionRadius 碰撞半径
pickupRange 拾取距离
mapSize 地图尺寸
extractTime 固定撤离读条秒
signalExtractTime 信号撤离读条秒
beastWaveInterval 兽潮间隔秒
extractPoint 撤离点
basePerRun 每局基础养分
normalKill 普通击杀养分
eliteKill 精英击杀养分
crystalAmount 结晶养分
crystalInterval 结晶刷新秒
energyCap 养分上限
cultivation 修为
cult 修为
cultCost 下级修为需求
goldCost 手动修炼金币配置
soilCost 手动修炼泥土配置
waterCost 手动修炼清水配置
compostCost 手动修炼堆肥配置
skillSlots 技能槽数
hpRegen 脱战回血每秒
expBase 修为基础
expPow 修为指数
goldBase 金币基础
goldPow 金币指数
slotLevels 槽位突破等级
breakthrough 突破等级
requires 前置条件
unlock 解锁条件
nodes 科技节点
modifier 属性修正
mods 修正属性
at 阈值
thresholds 阈值表
path 分支
DIFFICULTIES 难度配置
TIER_MECHANICS 区域机制
ADVANCED_AFFIXES 高阶精英词缀
HEAT_MODIFIERS 热度词缀
BUILDINGS 农场建筑
TECH_TREES 科技树
definitions 成就定义
FACTIONS 元素阵营
RARITIES 稀有度
AFFIX_CAP 附魔上限
ITEM_DISTINCT_CAP 道具种类上限
ITEM_STACK_CAP 道具堆叠上限
DUPLICATE_MASTERY_PROGRESS 重复卡精通进度
BAG_SIZE 背包格数
GOLD_PER_SLOT 每格金币容量
CRAFT_COSTS 武器打造费用
UPGRADE_COSTS 武器升级费用
CULTIVATION_VALUE 材料修为折算
factions 元素阵营
counter 克制关系
rarities 稀有度
rarityOrder 品质顺序
utilityTags 功能标签
items 道具卡
seeds 种子卡
signatures 首领签名卡
affixes 附魔词缀
synergy 协同
blueprint 蓝图需求
signature 签名标记
shortName 简称
image 图像
img 图片路径
icon 图标
emoji 图标
color 色值
common 普通
rare 稀有
epic 史诗
legendary 传说
normal 普通
casual 休闲
hard 困难
nightmare 噩梦
skill 技能
item 道具
seed 种子
fire 火焰
ice 冰霜
lightning 雷电
poison 毒素
physical 物理
wind 风
melee 近战
ranged 远程
heal 治疗
healPct 按生命比例治疗
healFull 回满生命
energyFull 回满能量
hot 持续治疗
shield 护盾
burn 燃烧
burnDur 燃烧时长秒
dot 持续伤害
duration 持续秒
stun 眩晕秒
slow 减速比例
jumps 弹射次数
jumpRange 弹射距离
dash 位移
stealth 潜行秒
atkSpd 攻速加成
moveSpd 移速加成
reduce 减伤比例
reflect 反伤比例
aoe 范围伤害
cone 锥形
untilBreak 持续至破盾
totem 图腾
place 放置
cleanse 净化
blind 致盲
invuln 无敌秒
gather 聚怪
reveal 揭开迷雾
light 照明
root 定身
pull 牵引
nova 爆发
healOnKill 击杀回血
critChance 暴击概率
critIgnite 暴击点燃
onHit 命中触发
bleed 流血
burnChance 燃烧概率
slowChance 减速概率
slowAmt 减速强度
freezeChance 冻结概率
freezeDur 冻结时长
shockChance 感电概率
poisonChance 中毒概率
bleedChance 流血概率
dmgMult 伤害加成
rangeMult 射程倍率
durationMult 持续时间倍率
energyRegenMult 回能倍率
energy 能量
costDown 消耗降低
recastChance 重施概率
cdr 冷却缩减
pierce 穿透
stacks 层数
secondElement 第二元素
startShield 开场护盾
summon 召唤
summonUnits 召唤数量
summonHp 召唤生命
summonAspd 召唤攻速
summonBoom 召唤爆炸
summonRoot 召唤定身
execute 处决
executeThreshold 处决血线
armorBreak 破甲
damageTaken 承伤修正
burnStack 燃烧叠层
bleedMult 流血倍率
dotMult 持续伤害倍率
poisonSpread 中毒扩散
frozenTaken 冻结承伤
burningTaken 燃烧承伤
shockDeathChain 感电死亡连锁
wetJumps 湿润额外弹射
shatterDmg 碎冰伤害
shatterNova 碎冰爆发
shieldHealMult 护盾治疗倍率
shieldedHeal 护盾内治疗
thornsDps 荆棘每秒伤害
thornsNova 荆棘爆发
outOfCombatStealth 脱战隐身
armor 护甲
regen 恢复
aspd 攻速
atkBuff 攻击增益
dmgBuff 伤害增益
takenBuff 承伤增益
safe 安全效果
pardon 免死
exp 经验
xp 经验
produceAmount 生产数量
produceInterval 生产间隔
mature 成熟阶段
seedling 幼苗阶段
start 起始
end 结束
maxPerRun 每局部署上限
deployCost 部署养分
surviveBonus 存活培育奖励
destroyPenalty 摧毁培育损失
firstDestroyPenalty 首次摧毁损失
firstDestroyGrace 首次保护
plantDestroyRecover 残骸回收
name 名称`.split('\n')){const i=line.indexOf(' ');labels[line.slice(0,i)]=line.slice(i+1)}
Object.assign(labels,{affixId:'词缀编号',givesSeed:'产出种子',counterTo:'克制目标',branch:'分支',default:'初始解锁',extractTier:'撤离指定阶级',perfectDodge:'完美闪避次数',harvest:'收获次数',weaponLevel:'武器强化等级',consecTier:'指定阶级连续撤离',killElite:'击杀指定精英',signalExtract:'信号撤离次数',greenhouse:'温室格数',tech:'科技数量',killBoss:'击杀指定首领',boar_king:'野猪王'});
for(const line of (await fs.readFile(path.join(root,'.workbook-final/extra-labels.txt'),'utf8')).trim().split(/\r?\n/)){const [k,...v]=line.trim().split(' ');labels[k]=v.join(' ');}
const names={};function collect(x){if(!x||typeof x!=='object')return;if(x.name&&(x.id||x.defId))names[x.id||x.defId]=x.name;for(const[k,v]of Object.entries(x)){if(v&&typeof v==='object'&&v.name)names[k]=v.name;collect(v)}}collect(c);collect(card);collect(sys);
const tr=k=>labels[k]||names[k]||k;
function human(v){if(v==null)return '未配置';if(typeof v==='boolean')return v?'是':'否';if(typeof v==='string')return tr(v);if(typeof v==='number')return v;if(Array.isArray(v))return v.map(human).join('、');return Object.entries(v).map(([k,x])=>`${tr(k)}：${human(x)}`).join('；')}
const wb=Workbook.create(),meta=[];
function col(n){let s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)}return s}
function sheet(name,headers,rows,widths,note=''){const sh=wb.worksheets.add(name);sh.showGridLines=false;const n=headers.length,end=col(n),last=rows.length+4;sh.getRange('A2').values=[[name]];sh.getRange('A2').format.font={name:'Microsoft YaHei',size:15,bold:true,color:'#24483B'};if(note){sh.getRange('A3').values=[[note]];sh.getRange('A3').format.font={name:'Microsoft YaHei',size:10,color:'#666666'}}sh.getRange(`A4:${end}${last}`).values=[headers,...rows.map(r=>r.map(v=>v===undefined?'未配置':v))];const rg=sh.getRange(`A4:${end}${last}`);rg.format.font={name:'Microsoft YaHei',size:10,color:'#26382E'};rg.format.rowHeight=32;rg.format.wrapText=true;rg.format.verticalAlignment='center';sh.getRange(`A4:${end}4`).format={fill:'#315B49',font:{name:'Microsoft YaHei',size:10,bold:true,color:'#FFFFFF'},rowHeight:34};for(let i=0;i<n;i++)sh.getRange(`${col(i+1)}4:${col(i+1)}${last}`).format.columnWidth=widths?.[i]||22;for(let i=0;i<rows.length;i++)if(i%2===1)sh.getRange(`A${i+5}:${end}${i+5}`).format.fill='#F1F5F0';for(let i=0;i<rows.length;i++){const lines=Math.max(...rows[i].map((v,j)=>Math.ceil(String(v??'').length/Math.max(10,(widths?.[j]||22)*.6))));if(lines>1)sh.getRange(`A${i+5}:${end}${i+5}`).format.rowHeight=Math.min(300,lines*16+8);}
sh.freezePanes.freezeRows(4);if(rows.length){const t=sh.tables.add(`A4:${end}${last}`,true,'Data'+meta.length);t.style='TableStyleMedium4';}meta.push({name,rows:rows.length,cols:n});return sh}
const overview=sheet('总览',['内容','说明'],[['游戏版本',d.version],['数据时间',d.exportedAt.slice(0,10)],['数据来源','当前网页运行配置、卡牌定义和系统公开配置'],['维护方式','先修改游戏代码，再导出此表；不从旧版 Excel 拼接'],['数值口径','原始配置与当前执行规则分开说明；不把旧掉落字段视为实际掉落'],['中文规则','名称、标题和说明中文；技术编号、资源路径和颜色值原样保留'],['平衡结论','本表同步代码，并非重新完成长期多局平衡测试'],['使用方法','下方按系统分类；筛选数据表；完整参数保留所有配置字段']], [24,96]);
function list(v){return Array.isArray(v)?v:Object.entries(v||{}).map(([id,x])=>({id,...(x&&typeof x==='object'?x:{value:x})}))}
function table(name,v,fields,widths,note){return sheet(name,fields.map(f=>Array.isArray(f)?f[1]:tr(f)),list(v).map(x=>fields.map(f=>{const key=Array.isArray(f)?f[0]:f;return ['id','defId','affixId'].includes(key)?(x[key]??'未配置'):human(x[key])})),widths,note)}
table('作物',c.crops,['name','id','rarity','growTime','seedPrice','sellPrice','cultivation','trait','description'],[20,24,12,17,14,14,14,25,70]);
const yields=[];for(const[id,arr]of Object.entries(c.cropMaterials))for(const[mat,p,q]of arr)yields.push([tr(id),tr(mat),p,q,id,mat]);const ys=sheet('作物材料产出',['作物','材料','每次收获概率','基础数量','作物编号','材料编号'],yields,[22,20,20,16,25,25]);ys.getRange(`C5:C${yields.length+4}`).setNumberFormat('0.0%');
table('材料与用途',c.resources,['name','id','kind','from','to'],[22,26,20,65,65]);
table('野生种子来源',c.wildPlants,['name','givesSeed','tier','id'],[25,25,18,30],'','');
table('温室植物',c.greenhousePlants,['name','id','rarity','seedPrice','growTime','desc'],[23,28,14,16,20,75]);
const gh=[];for(const p of c.greenhousePlants)for(const drop of p.drops||[])gh.push([p.name,tr(drop.id),drop.chance,Array.isArray(drop.amount)?drop.amount[0]:drop.amount??drop.min??1,Array.isArray(drop.amount)?drop.amount[1]:drop.amount??drop.max??1,drop.id]);const ghs=sheet('温室产出',['植物','产物','产出概率','数量下限','数量上限','产物编号'],gh,[24,26,18,16,16,30]);ghs.getRange(`C5:C${gh.length+4}`).setNumberFormat('0.0%');
table('温室道具效果',c.greenhouseDrops,['name','id','desc','type','value'],[26,30,80,22,16]);
table('武器基础',c.weapons,['name','id','mode','damage','range','attackCooldown','projectileSpeed','blueprint'],[24,26,16,16,16,20,20,18]);
const costs=[];for(const[id,k]of Object.entries(d.craftCosts))costs.push([tr(id),id,k.gold,human(k.materials)]);sheet('武器打造',['武器','编号','金币','材料'],costs,[24,28,18,80]);
const ups=d.upgradeCosts.map((x,i)=>[i,i+1,x.gold,...['iron','fiber','wood','stone','crystal','venom','carapace','refined_iron','soul_ash','bossFang'].map(k=>x.materials[k]||0)]);sheet('武器升级',['当前强化等级','目标强化等级','金币',...['iron','fiber','wood','stone','crystal','venom','carapace','refined_iron','soul_ash','bossFang'].map(tr)],ups,Array(13).fill(17));
table('角色成长',d.levelTable,['level','maxHp','baseAtk','defense','maxEnergy','energyRegen','hpRegen','skillSlots','cultCost','goldCost','soilCost','waterCost','compostCost'],Array(13).fill(20),'手动修炼费用为配置值；自动升级路径不扣这些材料。');
table('主动技能',c.skills,['name','id','energy','cd','dmg','range','desc'],[24,26,16,16,16,16,80]);
table('技能解锁',c.skillUnlock,['id','type','value','crop','weapon','tier'],[28,30,28,24,24,16]);
table('远征消耗品',c.consumables,['name','id','value','desc'],[26,30,18,100]);
table('地图',c.maps,['name','id','tier','entryFee','monsterCount','chestCount','rareSeedChance','legendarySeedChance','bossId','weatherTendency'],[25,18,14,16,16,16,20,22,25,28]);
table('首领基础',c.bosses,['name','id','tier','hp','dmg','speed','radius','skill'],[25,28,14,18,16,16,16,75],'首领基础生命；实战还受难度等修正。旧 loot 字段不作为实际掉落清单。');
table('普通与精英怪物',c.monsters,['name','id','hp','damage','speed','attackRange','attackCooldown','ai'],[24,26,16,16,16,20,20,30]);
table('难度',sys.DifficultySystem.DIFFICULTIES,['name','id','hpMul','dmgMul','rewardMul','supplyMul','torchMul','vision','dodgeWindow'],[18,22,18,18,18,18,22,20,24]);
table('热度词缀',sys.DifficultySystem.HEAT_MODIFIERS,['name','id','desc','rewardBonus'],[22,22,80,24]);
table('部署植物',c.deployPlants,['name','id','hp','range','radius','effect','desc'],[24,26,16,18,18,24,80]);
table('防线植物培育',c.plants,['name','id','rarity','maxPerRun','deployCost','hp','damage','desc'],[24,26,16,22,22,16,16,70]);
table('加工配方',d.recipes,['name','id','inputs','inputCrop','inputQty','outputName','outputQty','time','workshopLevel','desc'],[25,26,60,22,18,25,18,20,20,65]);
table('仓库物品',c.warehouseItems,['name','id','category','sellPrice','rarity'],[26,30,25,18,18]);
for(const[bucket,name]of [['skills','技能卡'],['items','道具卡'],['seeds','种子卡'],['signatures','首领签名卡']])table(name,card[bucket],['name','defId','rarity','element','tags','desc','effect','source'],[26,28,15,18,36,68,90,50]);
table('附魔词缀',card.affixes,['name','affixId','minRarity','mods'],[32,30,18,90]);
table('阵营与克制',card.factions,['name','id','counterTo','desc'],[26,22,30,80]);
table('品质与铭记',card.rarities,['name','id','power','inscribe'],[24,24,20,24]);
table('农场建筑',sys.TechSystem.BUILDINGS,['name','id','maxLevel','baseCost','costMultiplier','effects'],[24,25,18,42,20,110]);
table('科技树',Object.values(sys.TechSystem.TECH_TREES).flatMap(t=>t.nodes.map(n=>({...n,branch:t.name}))),['branch','name','id','cost','requires','desc'],[18,28,26,16,50,80]);
table('档案奖励',c.archives,['name','id','desc','breakthrough','reward'],[28,28,85,20,60]);
table('成就',sys.AchievementSystem.definitions,['name','id','desc','reward'],[28,28,85,65]);
const rules=[['地标建筑','无功能风车、巨剑、石拱门、枯井、石阵停止生成；保留功能节点。','js/expedition/expedition-terrain.js'],['首领掉落','每个首领一次温室稀有种子包、通用首领核心、赏金、补给及签名卡/蓝图流程。','js/expedition/expedition-combat.js'],['修为丹','按 value 字段乘实际数量到账；突破时保留溢出修为。','js/greenhouse.js；js/v5.js'],['强化石','温室产出；永久提高所有武器伤害，每枚增加 10 个百分点。','js/greenhouse.js；js/v5.js'],['修为加成卡','下次成功撤离修为增加 50%；失败保留；重复激活不再消耗。','js/greenhouse.js；js/v5.js'],['温室解锁','四种制卡作物默认可种；首领种子包解锁其他温室植物。','js/greenhouse.js'],['安全箱','按容量保留；农场道具、具名材料和种子解锁统一到账。','js/expedition/expedition-combat.js'],['采摘','种子先掉到地图，拾取进入本局结算；不提前写永久仓库。','js/expedition/expedition-combat.js'],['战斗反馈','持续伤害合并数字且不反复硬直；全额格挡不播放受伤效果；前摇结束复核近战距离。','js/expedition/expedition-combat.js'],['数值调整范围','本次刷新全部导出数据和中文展示；未凭空重新平衡游戏伤害、掉率和价格。','当前代码'],['旧报告','历史击杀时间、经济报告不作为本次改动后的实测数据。','审查口径']];sheet('当前执行规则',['系统','当前规则','实现位置'],rules,[25,110,65]);
// Full scalar inventory ensures no numeric field is discarded by a curated view.
const detail=[],seen=new Set();function flatten(v,raw=[],display=[]){if(v&&typeof v==='object'&&Object.keys(v).length){for(const[k,x]of Object.entries(v))flatten(x,[...raw,k],[...display,/^\d+$/.test(k)?`第${Number(k)+1}项`:tr(k)]);}else{const key=raw.join('.');if(seen.has(key))throw Error('重复字段 '+key);seen.add(key);detail.push([display[0],display.slice(1,-1).join('／'),display.at(-1),human(v),key]);}}
flatten(c,['运行配置'],['运行配置']);flatten(card,['卡牌定义'],['卡牌定义']);flatten(sys,['系统配置'],['系统配置']);
sheet('完整参数索引',['来源类别','所属对象','参数','当前值','原始字段路径'],detail,[22,70,32,90,110],'用于逐项核对；保留原始编号和字段路径以追溯代码。');
const materialChecks=Object.keys(c.resources).map(id=>{const src=[];for(const[crop,arr]of Object.entries(c.cropMaterials))if(arr.some(x=>x[0]===id&&x[1]>0))src.push(tr(crop));for(const p of c.greenhousePlants)if(p.drops?.some(x=>x.id===id&&x.chance>0))src.push('温室：'+p.name);if(['soil','water','compost'].includes(id))src.push('作物收获通用产出');return[tr(id),id,src.join('、')||'查看当前执行规则',src.length?'有配置来源':'需复核']});sheet('资源来源检查',['资源','编号','可产出来源','检查结果'],materialChecks,[25,26,115,24]);
sheet('校验说明',['检查项','结果或口径'],[['完整字段数',detail.length],['作物数量',c.crops.length],['材料资源数量',Object.keys(c.resources).length],['地图数量',c.maps.length],['首领数量',Object.keys(c.bosses).length],['角色等级行数',d.levelTable.length],['导出完整性','完整参数索引包含当前导出配置、卡牌定义和系统配置的所有叶节点'],['概率意义','表中为配置概率；实际还可能受品质、难度和额外逻辑影响'],['未导出内容','闭包内部且未公开的局部常量、函数体不属于配置快照；关键行为见当前执行规则'],['数据核对','生成后重新读取工作簿，逐表逐行与构建数据比较']], [28,115]);
const nav=meta.slice(1).map(x=>[x.name,x.rows]);sheet('工作表目录',['工作表','数据行数'],nav,[40,24]);
await fs.writeFile('.workbook-final/expected.json',JSON.stringify(meta));await fs.writeFile('.workbook-final/source-cells.json',JSON.stringify(meta.map(m=>({name:m.name,values:wb.worksheets.getItem(m.name).getRange(`A4:${col(m.cols)}${m.rows+4}`).values}))));
wb.recalculate();
console.log((await wb.inspect({kind:'sheet',include:'id,name',maxChars:1200})).ndjson);
await fs.writeFile('.workbook-final/overview.png',new Uint8Array(await (await wb.render({sheetName:'总览',range:'A1:B12',scale:1.5,format:'png'})).arrayBuffer()));
await fs.writeFile('.workbook-final/materials.png',new Uint8Array(await (await wb.render({sheetName:'作物材料产出',range:'A1:F14',scale:1.3,format:'png'})).arrayBuffer()));
await (await SpreadsheetFile.exportXlsx(wb)).save(path.join(root,'docs/游戏数据总表_最终版.xlsx'));
console.log(JSON.stringify({sheets:meta.length,rows:meta.reduce((n,x)=>n+x.rows,0),fields:detail.length,output:'docs/游戏数据总表_最终版.xlsx'}));
