# -*- coding: utf-8 -*-
"""v5.4《游戏数据表》生成器：读 docs/game_data.json + tools/balance-report.json + tools/balance-economy.json"""
import json, os, math

ROOT = r'C:\Users\29401\Desktop\youxi\farm-cards-expedition'
GD = json.load(open(os.path.join(ROOT, 'docs', 'game_data.json'), encoding='utf-8'))
REPORT = None
for f in ['tools/balance-report.json']:
    p = os.path.join(ROOT, f)
    if os.path.exists(p):
        REPORT = json.load(open(p, encoding='utf-8'))
ECON = None
ep = os.path.join(ROOT, 'tools', 'balance-economy.json')
if os.path.exists(ep):
    ECON = json.load(open(ep, encoding='utf-8'))

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

HDR_FILL = PatternFill('solid', fgColor='2E3A2F')
HDR_FONT = Font(name='微软雅黑', bold=True, color='EDE6D2', size=10)
TITLE_FONT = Font(name='微软雅黑', bold=True, size=14, color='2E3A2F')
CELL_FONT = Font(name='微软雅黑', size=10)
SUB_FILL = PatternFill('solid', fgColor='D9E2C9')
WARN_FILL = PatternFill('solid', fgColor='F3E2C0')
thin = Side(style='thin', color='BBBBBB')
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)
WRAP = Alignment(wrap_text=True, vertical='center')
CENTER = Alignment(horizontal='center', vertical='center', wrap_text=True)

wb = Workbook()

def sheet(name):
    ws = wb.create_sheet(name)
    return ws

def header(ws, headers, row=1, widths=None):
    for i, h in enumerate(headers, 1):
        c = ws.cell(row=row, column=i, value=h)
        c.fill = HDR_FILL; c.font = HDR_FONT; c.alignment = CENTER; c.border = BORDER
    if widths:
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = ws.cell(row=row+1, column=1)

def rows(ws, data, start=2, fills=None):
    for r, rowdata in enumerate(data, start):
        for cidx, v in enumerate(rowdata, 1):
            c = ws.cell(row=r, column=cidx, value=v)
            c.font = CELL_FONT; c.alignment = WRAP; c.border = BORDER
            if fills and (r-start) in fills:
                c.fill = fills[r-start]

def title(ws, text, ncol):
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=ncol)
    c = ws.cell(row=1, column=1, value=text); c.font = TITLE_FONT
    ws.row_dimensions[1].height = 24

# ---------- 1 封面 ----------
ws = wb.active; ws.title = '封面'
ws.column_dimensions['A'].width = 22; ws.column_dimensions['B'].width = 90
info = [
    ('游戏', '农庄牌：荒野远征（Farm Cards: Expedition）'),
    ('版本', GD.get('version', '?') + '  v5.4「荒野校准」'),
    ('生成说明', '本表由 tools/build-excel-v54.py 依据 docs/game_data.json（代码实导）与千局 bot 复测数据自动生成，数值与代码一致；标注「设计值」的为机制常量。'),
    ('核心循环', '农场种植（修为/材料/消耗品）→ 搜打撤远征（风险/掉落/Boss）→ 撤离回农场锻造升级 → 更高 Tier'),
    ('v5.4 改动', '①修为仅用于修行台角色升级，武器锻造/升级只耗农作物材料并标注来源；②难度两维化（Tier 单调硬曲线，难度只平移，噩梦补机制）；③12 Boss 软狂暴（交战60s后每25s一阶，共4阶）；④兽潮指数化+密度上限+撤离点清怪；⑤背包超重降速；⑥中期铁/晶掉率下调、草药包供给按 frugal 30-40% 反推；⑦农场新增家园全景面板。'),
    ('数据口径', '怪物 HP/伤害 = 普通难度基础 × 难度系数 × Tier 曲线；角色最终伤害公式见「战斗公式」页。'),
    ('Sheet 索引', '角色等级表 / 战斗公式 / 武器总览 / 武器升级全等级 / 武器锻造配方 / 技能总览 / 技能等级数值 / 作物总览 / 修为作物 / 温室作物 / 战场植物 / 消耗品与局内道具 / 资源清单 / 工坊配方 / 怪物总览 / Boss总览与软狂暴 / 精英与词缀 / 地图总览 / 难度两维 / 兽潮与超重 / 掉落表 / 经济闭环 / v5.4复测数据'),
]
for r, (k, v) in enumerate(info, 1):
    a = ws.cell(row=r, column=1, value=k); a.font = Font(name='微软雅黑', bold=True, size=10); a.fill = SUB_FILL; a.alignment = WRAP; a.border = BORDER
    b = ws.cell(row=r, column=2, value=v); b.font = CELL_FONT; b.alignment = WRAP; b.border = BORDER
    ws.row_dimensions[r].height = 46 if len(str(v)) > 60 else 20

# ---------- 2 角色等级表 ----------
ws = sheet('角色等级表')
title(ws, '角色修行台 1–100 级成长表（修为仅用于升级；突破等级需完成远征档案）', 11)
header(ws, ['等级','生命上限','基础攻击','防御','能量上限','能量回复/s','脱战回血/s','技能卡槽','升级修为','升级金币','泥土/清水/堆肥'], 2,
       [7,10,10,8,10,11,11,9,10,10,18])
ARCH = {20:'突破：T1 连续撤离 3 次', 40:'突破：T2 单局存活 10 分钟并撤离', 60:'突破：T3 连续 2 次撤离', 80:'突破：击杀 T3 Boss', 100:'突破：击杀全部 12 个 Boss'}
data = []
for row in GD.get('levelTable') or []:
    lv = row['level']
    data.append([lv, row.get('maxHp'), row.get('baseAtk'), row.get('defense'), row.get('maxEnergy'),
                 row.get('energyRegen'), row.get('hpRegen'), row.get('skillSlots'),
                 row.get('cultCost'), row.get('goldCost'),
                 f"{row.get('soilCost')}/{row.get('waterCost')}/{row.get('compostCost')}" if row.get('cultCost') else '满级'])
fills = {i: WARN_FILL for i, row in enumerate(data) if row[0] in ARCH}
rows(ws, data, 3, fills)
# 突破说明列
for i, row in enumerate(data):
    if row[0] in ARCH:
        c = ws.cell(row=3+i, column=11, value=ARCH[row[0]]); c.font = CELL_FONT; c.alignment = WRAP; c.border = BORDER; c.fill = WARN_FILL

# ---------- 3 战斗公式 ----------
ws = sheet('战斗公式')
ws.column_dimensions['A'].width = 24; ws.column_dimensions['B'].width = 100
formulas = [
    ('武器普攻伤害', '武器ATK × (1 + 基础ATK/50) + 基础ATK×0.2，再乘攻击增益、临时倍率（rollWeaponDamage）；武器每升1级武器ATK+10%'),
    ('技能伤害', '技能威力 × (1 + 基础ATK/70) + 基础ATK×0.3，再乘临时倍率'),
    ('减伤率', '防御 / (防御 + 150)；100级防御60 → 减伤 28.6%'),
    ('怪物HP（Tier曲线）', '基础HP × (1+(T-1)×0.55+(T-1)(T-2)×0.06) × 难度hpMul → T1=1 / T2=1.55 / T3=2.22 / T4=3.01'),
    ('怪物伤害（Tier曲线）', '基础Dmg × (1+(T-1)×0.35+(T-1)(T-2)×0.05) × 难度dmgMul → 1 / 1.35 / 1.8 / 2.4'),
    ('怪物移速（Tier曲线）', '基础速度 × (1+(T-1)×0.06) × 难度额外速度'),
    ('技能每级成长', '伤害/持续伤害+18%/级，燃烧/HOT+15%/级，护盾+12%/级，眩晕+0.15s/级，冷却-5%/级，耗能-3%/级（1-5级）'),
    ('完美闪避', '敌人出手帧后窗口内闪避（普通180ms/困难130ms/噩梦100ms）：0.3s慢动作、下次攻击必暴击、怒气+25'),
    ('Boss软狂暴（设计值）', '玩家进入650px开始累计交战时间；60s后每25s升1阶（60/85/110/135s，共4阶）：每阶伤害×(1+0.18n)、速度×(1+0.05n)、攻击间隔×(1-0.08n)（下限0.7s）、施法cd额外加快；召唤上限不放宽'),
    ('兽潮（设计值）', '首波20s；每波数量 min(26+Tier×8, round((12+Tier×4)×1.18^(波次-1)))；刷出即开始下一波倒计时，间隔 max(18, round(40×0.94^(波次-1)))'),
    ('超重（设计值）', '背包使用格数>12 时移速 ×max(0.88, 1-0.03×(格数-12))；16格→×0.88'),
    ('阵亡惩罚', '远征死亡 50% 概率降1级（扣本级修为，最低Lv1）；免死令可免除'),
    ('金币占格', '每100金币占1格，不足100自动合并为1格；同类物品无限叠加'),
]
header(ws, ['项目', '公式 / 规则'], 1)
rows(ws, formulas, 2)

# ---------- 4 武器总览 ----------
ws = sheet('武器总览')
header(ws, ['ID','武器','类型','基础伤害','射程','冷却(s)','定位说明'], 1, [16,14,10,10,8,10,46])
wdata = []
for w in GD.get('weapons', []):
    wdata.append([w.get('id'), w.get('name'), {'melee':'近战','ranged':'远程'}.get(w.get('mode'), w.get('mode')),
                  w.get('damage'), w.get('range'), w.get('cooldown'), w.get('description')])
rows(ws, wdata, 2)

# ---------- 5 武器升级全等级 ----------
ws = sheet('武器升级全等级')
title(ws, '5 把武器 × Lv0–10：每级伤害+10%，Lv4/7/8/10 解锁专属词条；升级材料全部由农作物产出', 9)
header(ws, ['武器','等级','伤害','解锁词条','升级金币','升级材料','材料来源作物'], 2, [14,7,8,40,10,34,46])
BONUS = {
 'harvest_sickle': {4:'挥砍范围+15%',5:'连击第3段小击退',6:'暴击率+10%',7:'击杀回血2HP',8:'质变·旋风斩（长按360°旋转）',9:'旋风斩伤害+30%',10:'质变·割裂（命中叠流血，5层爆伤）'},
 'pea_repeater': {4:'攻速+8%',5:'弹道速度+20%',6:'穿透+1',7:'暴击后0.5s攻速+20%',8:'质变·散射（3发扇弹）',9:'散射+1发（4发）',10:'质变·夺命豆（暴击秒杀30%血以下小怪）'},
 'vine_staff': {4:'范围+20%',5:'穿透+2',6:'命中减速30%/1.5s',7:'击杀小范围爆炸60',8:'质变·藤蔓禁锢（25%定身1s）',9:'定身+1s（2s）',10:'质变·瘟疫（死亡毒雾扩散）'},
 'throwing_knife': {4:'攻速+12%',5:'弹道回旋（打2次）',6:'暴击率+15%',7:'移动射击无惩罚',8:'质变·影分身（投2把）',9:'影分身+1（3把）',10:'质变·必中（自动追踪最近敌人）'},
 'flame_bow': {4:'暴击伤害+50%',5:'弹道小AOE爆炸50',6:'燃烧DOT 8/s',7:'燃烧可叠3层',8:'质变·火箭雨（3支落箭AOE）',9:'燃烧伤害+50%',10:'质变·核爆（满蓄力大范围爆炸）'},
}
# 材料来源反查
crop_mat = GD.get('cropMaterials') or {}
mat_from = {}
for crop, mats in crop_mat.items():
    cname = next((c.get('name') for c in GD.get('crops', []) if c.get('id') == crop), crop)
    for m, chance in (mats.items() if isinstance(mats, dict) else []):
        pct = f"{round(chance*100)}%" if isinstance(chance, (int, float)) and chance <= 2 else str(chance)
        mat_from.setdefault(m, []).append(f"{cname}{pct}")
res_names = {k: v.get('name', k) for k, v in (GD.get('resources') or {}).items()}
def src_text(mat):
    parts = mat_from.get(mat, [])
    extra = {'refined_iron':'工坊：铁矿×3→精铁锭','soul_ash':'高Tier怪物/温室稀有作物','bossFang':'首领掉落/温室稀有作物','venom':'毒系怪物掉落/毒荆棘','carapace':'甲壳系怪物/仙人掌'}
    if parts: return '、'.join(parts)
    return extra.get(mat, (GD.get('resources') or {}).get(mat, {}).get('from', '见资源清单'))
costs = GD.get('upgradeCosts') or []
wdata = []
for w in GD.get('weapons', []):
    base = w['damage']
    for lv in range(0, 11):
        dmg = round(base * (1 + 0.1*lv))
        bonus = BONUS.get(w['id'], {}).get(lv, '基础数值成长' if lv else '出厂状态')
        if lv < 10 and lv < len(costs):
            co = costs[lv]
            gold = co.get('gold')
            mats = co.get('materials', {})
            mtext = '、'.join(f"{res_names.get(m,m)}×{n}" for m, n in mats.items())
            srctext = '；'.join(f"{res_names.get(m,m)}：{src_text(m)}" for m in mats)
        else:
            gold = '满级'; mtext = '—'; srctext = '—'
        wdata.append([w['name'], lv, dmg, bonus, gold, mtext, srctext])
fills = {i: SUB_FILL for i, r in enumerate(wdata) if r[1] in (4, 8, 10)}
rows(ws, wdata, 3, fills)

# ---------- 6 武器锻造配方 ----------
ws = sheet('武器锻造配方')
header(ws, ['武器','打造金币','打造材料','材料来源'], 1, [14,10,30,60])
craft = GD.get('craftCosts') or {}
wname = {w['id']: w['name'] for w in GD.get('weapons', [])}
cdata = []
for wid, co in craft.items():
    mats = co.get('materials', {})
    cdata.append([wname.get(wid, wid), co.get('gold'),
                  '、'.join(f"{res_names.get(m,m)}×{n}" for m, n in mats.items()),
                  '；'.join(f"{res_names.get(m,m)}：{src_text(m)}" for m in mats)])
rows(ws, cdata, 2)

# ---------- 7 技能总览 ----------
ws = sheet('技能总览')
unlock_text = {
 'straw_smash':'初始解锁','vine_bind':'角色Lv10','earth_dash':'首次T1撤离','smoke_screen':'完美闪避20次',
 'chili_breath':'收获辣椒50株','pea_storm':'豌豆连弩锻造+5','frost_barrier':'T1连续撤离3次','thorn_burst':'击杀狂暴野猪王',
 'earth_slam':'角色Lv25','gale_slash':'信号弹撤离成功3次','healing_rain':'温室Lv1（解锁4种温室作物）',
 'sun_drum':'农业科技点满10点','poison_mist':'击杀石像魔王(t2_ruin_golem)','iron_armor':'角色Lv45',
 'thunder_chain':'首次T3撤离','death_scythe':'远征档案点亮12份'}
header(ws, ['技能','类型','耗能','冷却(s)','射程','1级核心数值','解锁条件','说明'], 1, [12,10,7,9,7,22,26,44])
sdata = []
for s in GD.get('skills', []):
    core = []
    for k in ('dmg','burn','dot','hot','shield','stun','duration','jumps','reflect','thornsDps','reduce','atkSpd','moveSpd','heal','dash','stealth'):
        if k in s: core.append(f"{k}={s[k]}")
    sdata.append([s.get('name'), s.get('kind'), s.get('energy'), s.get('cd'), s.get('range'),
                  '、'.join(core), unlock_text.get(s['id'], str((GD.get('skillUnlock') or {}).get(s['id'], ''))), s.get('desc')])
rows(ws, sdata, 2)

# ---------- 8 技能等级数值 ----------
ws = sheet('技能等级数值')
title(ws, '16 技能 × 5 级 = 80 行（伤害+18%/级，燃烧/HOT+15%，DOT+18%，护盾+12%，眩晕+0.15s，CD-5%，耗能-3%）', 9)
header(ws, ['技能','等级','伤害','燃烧/持续','护盾','眩晕(s)','冷却(s)','耗能','持续(s)'], 2, [12,7,8,12,8,9,9,7,9])
sdata = []
for s in GD.get('skills', []):
    for L in range(1, 6):
        x = L - 1
        dmg = round(s['dmg']*(1+0.18*x)) if s.get('dmg') else None
        burn = None
        if s.get('burn'): burn = round(s['burn']*(1+0.15*x))
        elif s.get('hot'): burn = round(s['hot']*(1+0.15*x))
        elif s.get('dot'): burn = round(s['dot']*(1+0.18*x))
        elif s.get('thornsDps'): burn = round(s['thornsDps']*(1+0.18*x))
        shield = round(s['shield']*(1+0.12*x)) if s.get('shield') else None
        stun = round(s.get('stun', 0)+0.15*x, 2) if s.get('stun') else None
        cd = round(s['cd']*(1-0.05*x), 2)
        energy = round(s['energy']*(1-0.03*x))
        dur = s.get('duration')
        sdata.append([s['name'], L, dmg, burn, shield, stun, cd, energy, dur])
rows(ws, sdata, 3)

# ---------- 9 作物总览 ----------
ws = sheet('作物总览')
header(ws, ['ID','作物','生长(s)','售价','种子价','稀有度','特性','产出材料（概率）'], 1, [16,12,9,7,7,9,26,40])
cdata = []
for c in GD.get('crops', []):
    mats = crop_mat.get(c['id'], {})
    mtext = '、'.join(f"{res_names.get(m,m)} {round(ch*100) if isinstance(ch,(int,float)) and ch<=1 else ch}%" for m, ch in mats.items()) if isinstance(mats, dict) else ''
    cdata.append([c.get('id'), c.get('icon','')+' '+str(c.get('name')), c.get('growTime'), c.get('sellPrice'),
                  c.get('seedPrice'), c.get('rarity'), c.get('trait') or c.get('rewardLabel') or '', mtext])
rows(ws, cdata, 2)

# ---------- 10 修为作物 ----------
ws = sheet('修为作物')
header(ws, ['修为作物','生长时间','修为产量/株','获取条件','备注'], 1, [14,12,12,20,30])
cult = list(GD.get('cultivationCrops') or [])
gh = GD.get('greenhousePlants') or []
GH_EXP = {'wudao_fruit': (75, '温室Lv1'), 'jiuye_lingzhi': (260, '温室Lv2'), 'jiuzhuan_ginseng': (900, '温室Lv3，传说品质×2')}
extra = []
for c in gh:
    if c.get('id') in GH_EXP or '修为' in (c.get('desc') or ''):
        exp, unlock = GH_EXP.get(c.get('id'), ('', '温室'))
        extra.append({'icon': c.get('icon',''), 'name': c.get('name'), 'growTime': c.get('growTime'),
                      'exp': exp, 'unlock': unlock, 'desc': c.get('desc','')})
if cult:
    crows = [[c.get('icon','')+' '+c.get('name'), c.get('growTime'), c.get('exp') or c.get('cultivation') or c.get('cult'), c.get('unlock') or c.get('source',''), c.get('desc','')] for c in cult]
    crows += [[c['icon']+' '+c['name'], c['growTime'], c['exp'], c['unlock'], c['desc']] for c in extra]
    rows(ws, crows, 2)
else:
    rows(ws, [
        ['🌱 凝气草','30s',10,'初始解锁','基础修为作物'],
        ['🌾 灵穗麦','60s',28,'角色Lv15解锁种子','中期'],
        ['🍑 悟道果','120s',75,'温室Lv1','高阶'],
        ['🍄 九叶灵芝','现实4h',260,'温室Lv2','后期'],
        ['🫚 九转人参','现实12h',900,'温室Lv3','传说品质×2；NPC好感+10'],
    ], 2)

# ---------- 11 温室作物 ----------
ws = sheet('温室作物')
gh = GD.get('greenhousePlants')
if gh:
    header(ws, ['ID','作物','稀有度','生长(s)','种子价','产物（概率/数量）','描述'], 1, [16,14,9,9,8,40,40])
    gdata = []
    for c in gh:
        drops = []
        for d in (c.get('drops') or []):
            amt = d.get('amount')
            if isinstance(amt, list): amt = f"{amt[0]}-{amt[1]}"
            drops.append(f"{d.get('id')} {round((d.get('chance') or 0)*100)}%×{amt}")
        gdata.append([c.get('id'), c.get('icon','')+' '+c.get('name'), c.get('rarity'), c.get('growTime'),
                      c.get('seedPrice'), '；'.join(drops), c.get('desc','')])
    rows(ws, gdata, 2)
else:
    header(ws, ['温室作物','产物','去向/效果','解锁'], 1)
    rows(ws, [
        ['冰心莲','冰心护盾药','远征一次性护盾','温室Lv1'],
        ['赤炎果','抗火药','火抗/火伤增益','温室Lv1'],
        ['幽魂兰','幽魂粉','隐身时间延长','温室Lv2'],
        ['雷霆果','能量药剂','能量上限/回能','温室Lv2'],
        ['水晶葡萄','水晶果汁','能量回复buff','温室Lv2'],
        ['九转人参','修为丹/人参汤','巨额修为/满血红蓝药','温室Lv3'],
    ], 2)

# ---------- 12 战场植物 ----------
ws = sheet('战场植物')
header(ws, ['植物','类型','部署消耗','生命','持续/冷却','效果描述'], 1, [14,10,9,7,14,50])
pdata = []
for p in GD.get('plants', []):
    pdata.append([p.get('icon','')+' '+str(p.get('name')), p.get('type'), p.get('deployCost'), p.get('hp'),
                  f"{p.get('life','—')}/{p.get('cooldown','—')}", p.get('desc')])
rows(ws, pdata, 2)

# ---------- 13 消耗品 ----------
ws = sheet('消耗品与局内道具')
header(ws, ['ID','道具','按键','效果数值','描述'], 1, [16,16,7,16,50])
rows(ws, [[c.get('id'), c.get('icon','')+' '+str(c.get('name')), c.get('key'),
           '、'.join(f"{k}={v}" for k, v in c.items() if k in ('heal','value','damage','shield','duration','range','count')), c.get('desc')]
          for c in GD.get('consumables', [])], 2)

# ---------- 14 资源清单 ----------
ws = sheet('资源清单')
header(ws, ['资源ID','名称','类别','来源','去向','可产出作物/途径'], 1, [14,12,10,40,34,40])
rdata = []
for rid, r in (GD.get('resources') or {}).items():
    crops = '、'.join(mat_from.get(rid, [])) if mat_from.get(rid) else ''
    rdata.append([rid, r.get('name'), r.get('kind',''), r.get('from',''), r.get('to',''), crops])
rows(ws, rdata, 2)

# ---------- 15 工坊配方 ----------
ws = sheet('工坊配方')
recipes = GD.get('recipes') or []
if recipes:
    header(ws, ['配方','工坊等级','耗时(s)','输入','产物','作用闭环'], 1, [14,9,9,24,16,44])
    rdata = []
    for r in recipes:
        inp = r.get('inputCrop')
        ins = f"{inp}×{r.get('inputQty')}" if inp else '、'.join(f"{k}×{v}" for k, v in (r.get('inputs') or {}).items())
        rdata.append([r.get('icon','')+' '+r.get('name'), r.get('workshopLevel'), r.get('time'), ins,
                     f"{r.get('outputIcon','')} {r.get('outputName')}×{r.get('outputQty',1)}", r.get('desc')])
    rows(ws, rdata, 2)
else:
    header(ws, ['说明'], 1); rows(ws, [['导出时未取到 FarmRecipes，重跑 export-game-data.js 后刷新']], 2)

# ---------- 16 怪物总览 ----------
ws = sheet('怪物总览')
mons = GD.get('monsters') or {}
m0 = next(iter(mons.values()), {})
mkeys = [k for k in ('name','tier','hp','dmg','speed','radius','ranged','elite','affixes','behavior','desc') if any(k in v for v in mons.values())]
header(ws, ['ID'] + mkeys, 1)
rows(ws, [[mid] + [v.get(k) for k in mkeys] for mid, v in mons.items()], 2)

# ---------- 17 Boss 与软狂暴 ----------
ws = sheet('Boss总览与软狂暴')
title(ws, '12 Boss（普通难度基础值，实战再乘 Tier 曲线与难度系数）+ 软狂暴四阶（设计值）', 9)
header(ws, ['Boss ID','名称','Tier','基础HP','基础伤害','速度','技能','掉落','击杀目标TTK(秒)'], 2, [18,14,6,9,9,7,34,20,12])
bosses = GD.get('bosses') or {}
TARGET_TTK = {1:18, 2:22, 3:28, 4:36}
bdata = []
for bid, b in bosses.items():
    bdata.append([bid, b.get('emoji','')+' '+b.get('name'), b.get('tier'), b.get('hp'), b.get('dmg'), b.get('speed'),
                  b.get('skill'), '、'.join(b.get('loot', [])), TARGET_TTK.get(b.get('tier'))])
rows(ws, bdata, 3)
base_row = 3 + len(bdata) + 2
ws.cell(row=base_row, column=1, value='软狂暴阶段（交战60s起，每25s一阶）').font = Font(name='微软雅黑', bold=True, size=11)
header(ws, ['阶段','触发交战时间','伤害倍率','速度倍率','攻击间隔倍率','施法CD额外'], base_row+1)
enr = [['0阶','<60s','×1.00','×1.00','×1.00','—'],
       ['1阶','60s','×1.18','×1.05','×0.92','+15%加快'],
       ['2阶','85s','×1.36','×1.10','×0.84','+30%加快'],
       ['3阶','110s','×1.54','×1.15','×0.76','+45%加快'],
       ['4阶','135s','×1.72','×1.20','×0.70(下限)','+60%加快']]
rows(ws, enr, base_row+2)

# ---------- 18 精英与词缀 ----------
ws = sheet('精英与词缀')
header(ws, ['词缀','效果','出现层级'], 1, [12,52,14])
rows(ws, [
    ['狂暴','血量<30%攻速翻倍','T1+'],['迅捷','移速+50%','T1+'],['吸血','命中回血','T1+'],['分裂','死亡分裂2只小怪','T1+'],
    ['护盾','开场30%最大血量护盾，护盾不破不进硬直','T3+'],['反弹','受到攻击反弹15%伤害','T3+'],
    ['召唤','每10秒召唤2只小怪','T4+'],['免疫','免疫一种伤害类型，需切换武器','T4+'],
], 2)

# ---------- 19 地图总览 ----------
ws = sheet('地图总览')
maps = GD.get('maps') or []
header(ws, ['地图ID','名称','Tier','入场费','词条','怪物数','宝箱数','怪物池','专属精英','专属Boss','天气倾向','稀有种子率'], 1,
       [10,12,5,7,22,8,7,30,16,18,14,9])
mdata = []
for m in maps:
    pool = m.get('monsterPool')
    def _poolname(x):
        if isinstance(x, (list, tuple)): return str(x[0])
        return str(x)
    pooltext = '、'.join(_poolname(x) for x in pool) if isinstance(pool, list) else str(pool or '')
    mdata.append([m.get('id'), m.get('name'), m.get('tier'), m.get('entryFee'), m.get('modifier'),
                  m.get('monsterCount'), m.get('chestCount'), pooltext, m.get('eliteId'), m.get('bossId'),
                  m.get('weatherTendency',''), m.get('rareSeedChance')])
rows(ws, mdata, 2)

# ---------- 20 难度两维 ----------
ws = sheet('难度两维')
title(ws, 'Tier 决定基础强度（单调硬曲线），难度只做平移；噩梦以机制差异为主', 12)
diffs = GD.get('difficulties') or []
dkeys = ['id','name','hpMul','dmgMul','supplyMul','rewardMul','vision','minAffixes','maxAffixes','torchMul','dodgeWindow','comboCap']
header(ws, ['ID','名称','怪物HP','怪物伤害','补给倍率','奖励倍率','视野','最少词缀','最多词缀','火把消耗','闪避窗口(ms)','连击上限'], 2,
       [10,8,8,9,9,9,7,9,9,9,12,9])
ddata = []
nm = {'casual':'休闲','normal':'普通','hard':'困难','nightmare':'噩梦'}
for d in diffs:
    ddata.append([d.get('id'), d.get('name'), d.get('hpMul'), d.get('dmgMul'), d.get('supplyMul'), d.get('rewardMul'),
                  d.get('vision'), d.get('minAffixes'), d.get('maxAffixes'), d.get('torchMul'), d.get('dodgeWindow'),
                  d.get('comboCap')])
rows(ws, ddata, 3)
hr = 3 + len(ddata) + 2
ws.cell(row=hr, column=1, value='Heat 负面修改器（通关后自选，每个增加奖励倍率）').font = Font(name='微软雅黑', bold=True, size=11)
header(ws, ['Heat','名称','效果','奖励加成'], hr+1, [10,10,46,10])
heat = GD.get('heatModifiers') or [
    {'id':'ironwall','name':'铁壁','desc':'所有怪物+50%血量','rewardBonus':0.2},
    {'id':'frenzy','name':'狂乱','desc':'所有怪物行动速度+30%','rewardBonus':0.25},
    {'id':'darkness','name':'黑暗','desc':'视野永久-30%','rewardBonus':0.15},
    {'id':'barren','name':'贫瘠','desc':'补给掉落-50%','rewardBonus':0.3},
    {'id':'headless','name':'无头','desc':'禁用怒气超杀','rewardBonus':0.5},
]
rows(ws, [[h.get('id'), h.get('name'), h.get('desc'), f"+{round((h.get('rewardBonus') or 0)*100)}%"] for h in heat], hr+2)

# ---------- 21 兽潮与超重 ----------
ws = sheet('兽潮与超重')
header(ws, ['波次','T1数量','T2数量','T3数量','T4数量','下一波间隔(s)'], 1, [7,9,9,9,9,14])
wdata = []
for wn in range(1, 21):
    counts = []
    for t in range(1, 5):
        cap = 26 + t*8
        counts.append(min(cap, round((12+t*4)*1.18**(wn-1))))
    interval = max(18, round(40*0.94**(wn-1)))
    wdata.append([wn] + counts + [interval])
rows(ws, wdata, 2)
base = len(wdata) + 4
ws.cell(row=base, column=1, value='背包超重降速（使用格数>12）').font = Font(name='微软雅黑', bold=True, size=11)
header(ws, ['使用格数','移速倍率'], base+1)
rows(ws, [[g, round(max(0.82, 1-0.045*(g-12)), 2)] for g in range(13, 17)], base+2)

# ---------- 22 掉落表 ----------
ws = sheet('掉落表')
header(ws, ['来源','掉落','基础概率','难度补给修正','备注'], 1, [16,20,12,26,34])
rows(ws, [
    ['普通怪物','金币','50%','—','—'],
    ['普通怪物','草药包','40%','×supplyMul（上限90%），拾取直接进快捷栏','v5.4 r3 由30%上调'],
    ['普通怪物','信号弹','10%','—','—'],
    ['普通怪物','怒气道具(thorn_storm)','8%','—','—'],
    ['普通怪物','特殊作物种子','1.2%','—','带回仓库可种植'],
    ['精英怪','特殊作物种子','8%','—','另掉赏金/临时武器50%'],
    ['Boss','特殊作物种子','50%','—','首领核心(2+Tier)、赏金150×Tier、草药1-2'],
    ['宝箱','草药包','65%','×supplyMul（上限95%），拾取直接进快捷栏','v5.4 r3 由55%上调'],
    ['无敌核心怪','无敌核心','5.5%','—','—'],
], 2)

# ---------- 23 经济闭环 ----------
ws = sheet('经济闭环')
ws.column_dimensions['A'].width = 30; ws.column_dimensions['B'].width = 90
econ_rows = [
    ('设计目标', '双线运营（农场+远征）账号 5–8 次成功撤离可将一把武器升至+10；金币与作物材料交替成为瓶颈，禁止单一资源独卡。'),
    ('武器升级金币合计', 'Lv1→10 合计 19150 金币（旧曲线26100已下调）；另需作物材料：铁矿193、晶核62、植物纤维4、木材6、石料6、毒腺6、甲壳4、魂烬15、精铁锭11、巨兽獠牙7（设计值，按升级表累计）。'),
    ('材料来源', '全部锻造/升级材料均可由农场作物产出（仙人掌产铁、雷鸣藤产铁/精铁、寒霜花产晶、西瓜产晶、仙人掌产甲壳、毒系作物产毒腺等），远征不再掉落铁/晶/獠牙；稀有材料来自温室作物与高Tier首领。'),
    ('修为来源', '约90%来自修为作物（修行台转化），10%来自远征首通与档案节点；修为不能抵扣武器升级。'),
]
if ECON:
    _es = ECON.get('summary', ECON)
    if isinstance(_es, dict):
        for _k, _v in _es.items():
            econ_rows.append(('经济专项·' + str(_k), json.dumps(_v, ensure_ascii=False)[:1200]))
    for _acct in (ECON.get('accounts') or ECON.get('lines') or []):
        econ_rows.append(('账号 ' + str(_acct.get('uid', '?')), json.dumps(_acct, ensure_ascii=False)[:1500]))
    if not (ECON.get('summary') or ECON.get('accounts') or ECON.get('lines')):
        econ_rows.append(('bot 经济专项（30档）', json.dumps(ECON, ensure_ascii=False)[:1500]))
else:
    econ_rows.append(('bot 经济专项（30档）', 'v5.4 复测后由 tools/balance-bot.js --economy=30 生成并刷新本页'))
header(ws, ['项目','内容'], 1)
rows(ws, econ_rows, 2)

# ---------- 24 v5.4 复测数据 ----------
ws = sheet('v5.4复测数据')
ws.column_dimensions['A'].width = 28; ws.column_dimensions['B'].width = 20; ws.column_dimensions['C'].width = 16; ws.column_dimensions['D'].width = 16; ws.column_dimensions['E'].width = 16; ws.column_dimensions['F'].width = 56
def pct(w):
    if not w: return '-'
    return f"{round((w.get('rate') or 0)*100,1)}%"
def ci(w):
    if not w: return '-'
    return f"[{round((w.get('lo') or 0)*100,1)}-{round((w.get('hi') or 0)*100,1)}]"
if REPORT:
    sm = REPORT.get('summary', {})
    meta = REPORT.get('meta', {})
    header(ws, ['指标','数值','95% CI','样本','超时','口径/目标'], 1)
    rr = [
        ['报表版本', meta.get('label') or meta.get('version') or '-', '-', f"有效 {sm.get('valid')} / 总 {sm.get('total')}", f"{sm.get('timeouts')} ({round((sm.get('timeouts',0)/max(1,sm.get('valid',1)))*100,1)}%)", 'pageErrors=%s' % (REPORT.get('pageErrors') if REPORT.get('pageErrors') is not None else '见日志')],
        ['总撤离率', pct(sm.get('rate')), ci(sm.get('rate')), f"n={sm.get('valid')}", '-', '全部有效局'],
        ['平均时长(s)', round(sm.get('avgDuration') or 0, 1), '-', '-', '-', '目标 120–280s'],
        ['平均击杀', round(sm.get('avgKills') or 0, 1), '-', '-', '-', '—'],
        ['平均带出金币', round(sm.get('avgGold') or 0, 1), '-', '-', '-', '—'],
    ]
    def agg_rows(arr, name_f, target):
        out = []
        for v in (arr or []):
            if not v.get('n'): continue
            out.append([name_f(v), pct(v.get('w')), ci(v.get('w')), f"n={v.get('n')}", str(v.get('timeouts', 0)), target])
        return out
    rr += agg_rows(REPORT.get('byDiffCore'), lambda v: '核心两画像·难度·' + str(v.get('key')), '目标 休闲90/普通75/困难55-60/噩梦45-55')
    rr += agg_rows(REPORT.get('byDiff'), lambda v: '全画像·难度·' + str(v.get('key')), '含特殊画像，仅参考')
    rr += agg_rows(REPORT.get('byTier'), lambda v: 'Tier·' + str(v.get('key')), '满级配装目标 T1 90→T4 60-65')
    rr += agg_rows(REPORT.get('byProfile'), lambda v: '画像·' + str(v.get('key')), 'frugal 30-40 / greedy 75-85')
    rows(ws, rr, 2)

    base = len(rr) + 4
    ws.cell(row=base, column=1, value='逐 Boss（交战率/击杀率/TTK/击杀时狂暴阶）').font = Font(name='微软雅黑', bold=True, size=11)
    header(ws, ['Boss','交战局数','交战率','击杀率','TTK均值(s)','TTK明细/狂暴阶'], base+1)
    br = []
    for b in (REPORT.get('bossById') or {}).values():
        ttk = b.get('ttk') or []
        enr = b.get('enrage') or []
        ttk_s = ','.join(str(round(x,1)) for x in ttk[:12]) + ('…' if len(ttk) > 12 else '')
        enr_s = '狂暴阶 ' + ','.join(str(x) for x in enr[:12]) if any(x for x in enr) else '均0阶'
        br.append([b.get('bossId'), f"{b.get('engaged')}/{b.get('runs')}", pct(b.get('engageRate')), pct(b.get('killRate')),
                   b.get('ttkAvg'), ttk_s + '；' + enr_s])
    rows(ws, br, base+2)

    r3 = base+2+len(br)+1
    extra = []
    ow = REPORT.get('overweight')
    if ow and ow.get('n'):
        extra.append(['贪财超重', f"峰值格数均值 {ow.get('peakAvg')}/16，超12格占比 {round(ow.get('over12',0)/ow.get('n')*100,1)}% (n={ow.get('n')})", '', '', '', '超重降速 0.82 下限'])
    fg = REPORT.get('frugal')
    if fg:
        extra.append(['有限补给画像', f"撤离 {pct(fg.get('successRate'))} {ci(fg.get('successRate'))} (n={fg.get('runs')})；无药而亡 {pct(fg.get('noHerbRate'))}", '', '', '', '目标撤离 30-40%'])
    gr = REPORT.get('greedy')
    if gr:
        extra.append(['贪财画像', f"撤离 {pct(gr.get('successRate'))} {ci(gr.get('successRate'))} (n={gr.get('runs')})；成功局均 {gr.get('avgDuration')}s、均金 {gr.get('avgGold')}", '', '', '', '目标撤离 75-85%'])
    sy = REPORT.get('systems') or {}
    if sy.get('signal'):
        extra.append(['信号弹撤离率', pct(sy['signal'].get('rate')) + ' ' + ci(sy['signal'].get('rate')), '', '', '', f"使用 {sy['signal'].get('used')} 次"])
    for k2, label2 in (('ultimate','超杀/局'), ('execute','处决/局'), ('branch','岔路/局')):
        if sy.get(k2): extra.append([label2, sy[k2].get('perRun'), '', '', '', '系统使用率'])
    if extra:
        header(ws, ['专项指标','数值','','','','备注'], r3)
        rows(ws, extra, r3+1)
    r5_notes = [
        ['patch21 定向验证（r5，非全量级）', '全量级数字以 r4 为准；r5 为软狂暴不封顶后的定向小样本', '', '', '', '方法学注记'],
        ['r5 长尾热点队列', '46/48 = 95.8% [88.3,99.1]，仅1超时；热点格超时率 r4 11% → 2.1%', '', 'n=48', '1', 'oncurve casual/normal × T3/T4'],
        ['r5 Boss 队列', '27/32 = 84.4% [68.2,93.1]，0 超时；最长战斗 167.8s（6阶狂暴后收束）', '', 'n=32', '0', 'hard/nightmare × T1/T3'],
        ['全量超时率投影', '约 1.8%–2.0%（投影值，非实测；r4 实测 2.64%）', '', '', '', '待 nightly 全量确认'],
    ]
    base_r = ws.max_row + 2
    header(ws, ['定向验证指标','数值','','样本','超时','口径'], base_r)
    rows(ws, r5_notes, base_r+1)
else:
    header(ws, ['状态'], 1)
    rows(ws, [['v5.4 千局复测完成后重跑本生成器刷新（tools/balance-bot.js --plan=full → build-excel-v54.py）']], 2)

out = os.path.join(ROOT, 'docs', '游戏数据表_v5.4.xlsx')
wb.save(out)
print('saved:', out, '| sheets:', len(wb.sheetnames))
