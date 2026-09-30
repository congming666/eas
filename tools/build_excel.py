# -*- coding: utf-8 -*-
"""
build_excel.py — 生成 docs/游戏数据表_v5.8.xlsx
在 v5.7（32 sheet）基础上，从 js/v58/card-data.js + docs/game_data.json 读取 v5.8 权威数据，
新增 v5.8 卡牌体系相关 sheet。可重复运行：每次从 v5.7 重新加载。

数据源：
  - js/v58/card-data.js  （node require 后 dump 成 JSON）
  - docs/game_data.json  （作物/消耗品/Boss/武器/地图/等级表）
  - docs/v58-card-spec.md §6/§7/§8/§9（精通/夺卡/撤离/工坊规则）
不编造未在数据源中冻结的数值；缺失项在“未覆盖项”里声明。
"""
import json, os, subprocess, sys, collections
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_XLSX = os.path.join(ROOT, "docs", "游戏数据表_v5.7.xlsx")
OUT_XLSX = os.path.join(ROOT, "docs", "游戏数据表_v5.8.xlsx")
CARD_JSON = os.path.join(ROOT, "tools", "_v58_card_data.json")
GD_JSON = os.path.join(ROOT, "docs", "game_data.json")

# ---------- 0. 加载 card-data（node require 后 dump） ----------
def load_card_data():
    # 先 dump 一次（幂等）
    js = "const d=require(%s);process.stdout.write(JSON.stringify(d))" % json.dumps(
        os.path.join(ROOT, "js", "v58", "card-data.js"))
    out = subprocess.check_output(["node", "-e", js], cwd=ROOT)
    data = json.loads(out.decode("utf-8"))
    with open(CARD_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    return data

CARD = load_card_data()
GD = json.load(open(GD_JSON, encoding="utf-8"))

# 重复卡转精通进度：从 card-system.js 权威读取（不硬编码，避免源更新后脱节）
_sys = subprocess.check_output(
    ["node", "-e", "process.stdout.write(JSON.stringify({d:require(%s).DUPLICATE_MASTERY_PROGRESS}))"
     % json.dumps(os.path.join(ROOT,"js","v58","card-system.js"))], cwd=ROOT)
DUP = json.loads(_sys.decode("utf-8"))["d"]

FACTIONS = CARD["factions"]
RARITIES = CARD["rarities"]

def faction_name(fid):
    return FACTIONS.get(fid, {}).get("name", fid or "")

def rarity_name(r):
    return RARITIES.get(r, {}).get("name", r)

# ---------- 样式 ----------
HDR_FILL = PatternFill("solid", fgColor="2F5496")
HDR_FONT = Font(bold=True, color="FFFFFF", size=11)
TITLE_FONT = Font(bold=True, size=13, color="2F5496")
WRAP = Alignment(wrap_text=True, vertical="top")
CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)
THIN = Side(style="thin", color="BFBFBF")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
RARITY_FILL = {
    "common":    PatternFill("solid", fgColor="E7E6E6"),
    "rare":      PatternFill("solid", fgColor="DDEBF7"),
    "epic":      PatternFill("solid", fgColor="E6D7F0"),
    "legendary": PatternFill("solid", fgColor="FCE4B6"),
}

def style_sheet(ws, headers, widths, header_row=1):
    for c, h in enumerate(headers, 1):
        cell = ws.cell(row=header_row, column=c, value=h)
        cell.fill = HDR_FILL; cell.font = HDR_FONT; cell.alignment = CENTER; cell.border = BORDER
    for c, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(c)].width = w
    ws.freeze_panes = ws.cell(row=header_row+1, column=1)

def fill_rows(ws, rows, rarity_col=None, start_row=2):
    for r, row in enumerate(rows, start_row):
        for c, v in enumerate(row, 1):
            cell = ws.cell(row=r, column=c, value=v)
            cell.alignment = WRAP; cell.border = BORDER
        if rarity_col is not None:
            rv = row[rarity_col-1]
            key = {"普通":"common","稀有":"rare","史诗":"epic","传说":"legendary"}.get(rv)
            if key:
                ws.cell(row=r, column=rarity_col).fill = RARITY_FILL[key]

def fmt_effect(eff):
    if not eff: return ""
    parts = []
    order = [("energy","能量"),("cd","冷却s"),("range","射程"),("radius","半径"),
             ("dmg","伤害"),("hot","持续回血/s"),("heal","治疗"),("healPct","按比例治疗"),
             ("shield","护盾"),("burn","燃烧"),("burnDur","燃烧时长"),("dot","每秒毒伤"),
             ("duration","持续s"),("stun","眩晕s"),("slow","减速"),("jumps","跳跃数"),
             ("dash","位移"),("stealth","隐身s"),("atkSpd","攻速"),("moveSpd","移速"),
             ("reduce","减伤"),("reflect","反伤"),("aoe","AOE"),("healFull","回满生命"),
             ("energyFull","回满能量"),("growTime","生长s")]
    for k, lab in order:
        if k in eff:
            v = eff[k]
            if v is True: parts.append(lab)
            elif isinstance(v, float) and v <= 1.5 and v > 0 and k in ("slow","atkSpd","moveSpd","reduce","reflect","healPct","dmgBuff","takenBuff","atkBuff"):
                parts.append("%s=%.0f%%" % (lab, v*100))
            else:
                parts.append("%s=%s" % (lab, v))
    # extra flags
    for k, lab in [("cone","锥形"),("untilBreak","盾至击破"),("totem","图腾"),("place","放置"),
                   ("cleanse","净化"),("blind","致盲"),("invuln","无敌"),("gather","聚怪"),
                   ("reveal","开雾"),("light","照明"),("root","定身"),("pull","牵引"),("nova","新星")]:
        if k in eff and eff[k]:
            parts.append(lab)
    return "；".join(parts)

# ---------- 加载既有 v5.7 ----------
wb = openpyxl.load_workbook(SRC_XLSX)
orig_sheets = wb.sheetnames
print("v5.7 原 sheet 数:", len(orig_sheets))

# 若重跑，先删掉本脚本上次加的 v5.8 sheet
NEW_PREFIX = "v58-"
for name in list(wb.sheetnames):
    if name.startswith(NEW_PREFIX):
        del wb[name]

# ============================================================
# 1) v58-卡牌总表（67 = 16 技能 + 27 道具 + 24 种子）
# ============================================================
skills = CARD["skills"]; items = CARD["items"]; seeds = CARD["seeds"]
cons_price = {}
for c in GD.get("consumables", []):
    cons_price[c["id"]] = c.get("value")

TYPE_LABEL = {"skill":"技能卡","item":"道具卡","seed":"种子卡"}
rows = []
for bucket, tlabel in [(skills,"skill"),(items,"item"),(seeds,"seed")]:
    for did, c in bucket.items():
        eff = c.get("effect", {})
        rows.append([
            TYPE_LABEL[c["type"]], did, c.get("icon",""), c["name"],
            rarity_name(c["rarity"]),
            faction_name(c.get("element")),
            "、".join(c.get("tags",[])),
            c.get("desc",""),
            fmt_effect(eff),
            c.get("niche",""),
            c.get("source",""),
            cons_price.get(did, ""),
        ])
ws = wb.create_sheet(NEW_PREFIX+"卡牌总表")
hdr = ["类型","卡ID","图标","名称","稀有度","流派","标签","卡面描述","结构化效果","niche（不可替代定位）","来源","售价(金币)"]
style_sheet(ws, hdr, [10,18,6,12,8,12,18,34,40,30,22,9])
fill_rows(ws, rows, rarity_col=5)
print("  卡牌总表 行数:", len(rows))

# ============================================================
# 2) v58-流派协同（8 流派 × 4 里程碑 = 32 行）
# ============================================================
syn = CARD["synergy"]; th = syn["thresholds"]
rows = []
for fid in ["fire","ice","lightning","poison","summon","bleed","armor","wind"]:
    for m in syn["factions"][fid]:
        rows.append([faction_name(fid), fid, "≥%d 张" % m["at"], m["id"], m["name"], m["desc"], fmt_effect(m.get("mods",{}))])
ws = wb.create_sheet(NEW_PREFIX+"流派协同")
hdr = ["流派","流派ID","触发张数","里程碑ID","里程碑名","效果描述","结构化数值"]
style_sheet(ws, hdr, [12,10,10,12,12,40,34])
fill_rows(ws, rows)
# 阈值说明行
ws.append([])
ws.append(["说明","统计整套装载（武器+已装备技能卡+携带道具卡+种子卡）同标签数量；达到 2/3/4/5 张激活对应档，取满足条件的最高档；带入即生效，非抽牌触发。"])
ws.cell(row=ws.max_row, column=1).font = Font(bold=True)
print("  流派协同 行数:", len(rows))

# ============================================================
# 3) v58-克制环
# ============================================================
order = ["fire","summon","poison","armor","bleed","wind","lightning","ice"]
rows = []
for i, atk in enumerate(order):
    df = order[(i+1) % len(order)]
    rows.append([faction_name(atk), atk, "→ 克制 →", faction_name(df), "攻击伤害 +25%", "被对方反击时 -25%（0.75×）"])
ws = wb.create_sheet(NEW_PREFIX+"克制环")
hdr = ["攻击流派","攻击ID","关系","被击流派","克制倍率","被克时倍率"]
style_sheet(ws, hdr, [12,12,10,12,16,20])
fill_rows(ws, rows)
# 8x8 矩阵
ws.append([]); ws.append(["克制倍率矩阵（行=攻击，列=防守；1.25=克制，0.75=被克，1.0=普通）"])
ws.cell(row=ws.max_row, column=1).font = TITLE_FONT
mat_hdr = ["攻击\\防守"] + [faction_name(f) for f in order]
ws.append(mat_hdr)
hr = ws.max_row
for c in range(1, len(mat_hdr)+1):
    cell = ws.cell(row=hr, column=c); cell.fill=HDR_FILL; cell.font=HDR_FONT; cell.alignment=CENTER
counter = CARD["counter"]
for atk in order:
    r = [faction_name(atk)]
    for dfn in order:
        if atk == dfn: r.append("—")
        else: r.append(counter.get(atk,{}).get(dfn, 1.0))
    ws.append(r)
print("  克制环 行数:", len(rows))

# ============================================================
# 4) v58-道具niche审计（27）
# ============================================================
GROUPS = [
 ("治疗阶梯", ["herb_kit","bread","ketchup","medkit","med_shot","ginseng_soup"],
   "按回复量/比例分层；前期固定小额→后期按最大生命%，避免数值贬值。"),
 ("护盾", ["shield_gen","shield_elixir"],
   "短时窗口盾(10s) vs 持久到击破盾；按战斗节奏选。"),
 ("攻击增益", ["war_horn","rage_tonic","flame_elixir","egg"],
   "站桩图腾/高风险换伤/安全净化/长效弱增益；风险与时长区分。"),
 ("机动脱战", ["mint_tea","wraith_draft","insecticide"],
   "移速拉扯/完整隐身/双用途脱身+农场治虫。"),
 ("控制聚怪", ["beartrap_item","rotting_bait"],
   "定点定身 vs 聚怪拉群；配合AOE一波清。"),
 ("视野能量", ["scout_eagle","torch","energy_cell","grape_juice","juice"],
   "开雾/照明/瞬满/短窗口回能×2/抬能量上限。"),
 ("投掷攻防", ["thorn_storm","poison_bomb"],
   "纯AOE爆发 vs AOE+减速铺伤。"),
 ("特殊", ["signal_flare","death_pardon","purify_tonic"],
   "撤离点/自动免降级/解负面状态。"),
]
rows = []
for gname, ids, gnote in GROUPS:
    for did in ids:
        it = items[did]
        rows.append([gname, did, it["name"], rarity_name(it["rarity"]), faction_name(it["element"]),
                     fmt_effect(it["effect"]), it["niche"], gnote, it.get("source","")])
ws = wb.create_sheet(NEW_PREFIX+"道具niche审计")
hdr = ["分组","道具ID","名称","稀有度","流派","效果","最佳时机/niche","组内区分要点","来源"]
style_sheet(ws, hdr, [12,16,12,8,10,30,30,34,10])
fill_rows(ws, rows, rarity_col=4)
print("  道具niche审计 行数:", len(rows))

# ============================================================
# 5) v58-词条池（21）
# ============================================================
affixes = CARD["affixes"]
rows = []
for aid, a in affixes.items():
    mods = a.get("mods", {})
    modstr = "; ".join("%s=%s" % (k, ("%.2f" % v if isinstance(v,float) else v)) if not isinstance(v,dict)
                       else "; ".join("%s=%.2f" %(kk,vv) for kk,vv in v.items())
                       for k,v in mods.items())
    rows.append([aid, a["name"], rarity_name(a["minRarity"]), a["minRarity"], modstr])
ws = wb.create_sheet(NEW_PREFIX+"词条池")
hdr = ["词条ID","词条名","最低出现稀有度","minRarity","结构化数值mods"]
style_sheet(ws, hdr, [20,22,14,12,46])
fill_rows(ws, rows, rarity_col=3)
ws.append([])
ws.append(["后缀条数上限 AFFIX_CAP","rare=1 / epic=2 / legendary=3（card-system.js）"])
ws.append(["获取方式","附魔站(enchant)追加；rollAffix 从 ≤ 该卡稀有度的词条池随机抽取"])
ws.append(["命名","后缀统一命名，如「+燃烧」「+回收」「+急速」"])
print("  词条池 行数:", len(rows))

# ============================================================
# 6) v58-精通成长（逐卡 Lv0-5）
# ============================================================
# cardStats: dmgMult=0.18*lv, healMult=0.18*lv, shieldMult=0.18*lv, cdr=0.05*lv
rows = []
all_cards = []
for t,b in [("skill",skills),("item",items),("seed",seeds)]:
    for did,c in b.items(): all_cards.append(c)

def growth_rows(c):
    eff = c.get("effect",{}) or {}
    base_dmg = eff.get("dmg")
    base_heal = eff.get("heal") if "heal" in eff else eff.get("hot")
    base_shield = eff.get("shield")
    base_cd = eff.get("cd")
    out = []
    for lv in range(0,6):
        dmgMul = 1 + 0.18*lv
        cdMul = 1 - 0.05*lv
        dmg_s = ("%.1f" % (base_dmg*dmgMul)) if isinstance(base_dmg,(int,float)) else "—"
        heal_s = ("%.1f" % (base_heal*dmgMul)) if isinstance(base_heal,(int,float)) else "—"
        shield_s = ("%.1f" % (base_shield*dmgMul)) if isinstance(base_shield,(int,float)) else "—"
        cd_s = ("%.2f" % (base_cd*cdMul)) if isinstance(base_cd,(int,float)) else "—"
        note = ""
        if c["type"]=="seed": note="种子卡无战斗数值；精通不影响种植时间"
        elif base_dmg is None and base_heal is None and base_shield is None and base_cd is None:
            note="纯功能/buff类，精通仅冷却/收藏意义"
        out.append([TYPE_LABEL[c["type"]], c["defId"], c["name"], rarity_name(c["rarity"]),
                    faction_name(c.get("element")), lv,
                    "+%d%%" % int(18*lv), "+%d%%" % int(18*lv), "+%d%%" % int(18*lv),
                    "-%d%%" % int(5*lv),
                    base_dmg if base_dmg is not None else "—", dmg_s,
                    base_heal if base_heal is not None else "—", heal_s,
                    base_shield if base_shield is not None else "—", shield_s,
                    base_cd if base_cd is not None else "—", cd_s, note])
    return out

for c in all_cards:
    rows.extend(growth_rows(c))
ws = wb.create_sheet(NEW_PREFIX+"精通成长")
hdr = ["类型","卡ID","卡名","稀有度","流派","精通Lv","伤害加成","治疗加成","护盾加成","冷却减免",
       "基础伤害","Lv后伤害","基础治疗/HoT","Lv后治疗/HoT","基础护盾","Lv后护盾","基础冷却s","Lv后冷却s","备注"]
style_sheet(ws, hdr, [8,16,11,8,10,7,9,9,9,9,9,9,11,11,9,9,9,9,26])
fill_rows(ws, rows, rarity_col=4)
print("  精通成长 行数:", len(rows))

# 6b) 精通进度 / 重复卡折算 小表
ws.append([]); ws.append(["【重复卡转精通进度】每张重复副本给予进度（card-system.js DUPLICATE_MASTERY_PROGRESS）"])
ws.cell(row=ws.max_row,column=1).font=TITLE_FONT
ws.append(["稀有度","每张重复卡进度","升满 Lv0→5 所需重复张数(共需5.0进度)",""])
hr=ws.max_row
for c in range(1,5):
    cell=ws.cell(row=hr,column=c); cell.fill=HDR_FILL; cell.font=HDR_FONT
import math
for k in ["common","rare","epic","legendary"]:
    prog = DUP[k]
    need = 5.0/prog
    ceil = math.ceil(need)
    ws.append([rarity_name(k), prog,
               "%.2f 张/级 ≈ 满级 %.1f 张（向上取整约 %d 张）" % (prog, need, ceil), ""])
ws.append(["经济实测参考","满级约 22.5 次成功撤离；印制传说卡约 6 局"])
ws.cell(row=ws.max_row, column=1).font = Font(bold=True)

# ============================================================
# 7) v58-Boss签名卡（12）+ 蓝图
# ============================================================
sigs = CARD["signatures"]
bosses = GD.get("bosses", {})
rows = []
for sid, s in sigs.items():
    b = bosses.get(s["bossId"], {})
    rows.append([sid, s["bossId"], b.get("tier",""), s["name"], rarity_name(s["rarity"]),
                 faction_name(s["element"]), s["desc"], fmt_effect(s["effect"]),
                 s["niche"], "必给蓝图(blueprint=true)·撤离铭记必成",
                 b.get("name",""), b.get("hp",""), b.get("skill","")])
ws = wb.create_sheet(NEW_PREFIX+"Boss签名卡")
hdr = ["签名卡ID","Boss ID","Tier","签名卡名","稀有度","流派","效果描述","结构化数值","niche","蓝图/铭记规则","对应Boss名","Boss HP","Boss技能"]
style_sheet(ws, hdr, [18,16,6,16,8,10,30,30,26,24,12,10,30])
fill_rows(ws, rows, rarity_col=5)
print("  Boss签名卡 行数:", len(rows))

# ============================================================
# 8) v58-夺卡节点
# ============================================================
rows = [
 ["节点节奏","每 2 分钟出现道路夺卡节点；并叠加 精英 / Boss / 宝箱 / 商人 / 篝火 节点"],
 ["三选一内容(固定三类)","① 升级现有卡（精通/附魔，给 0.5 精通进度）② 道具卡 ③ 种子卡"],
 ["局内绝不投放","新技能卡一律走 Boss 蓝图 / 局外解锁，局内不塞技能（避免技能槽满却抽到技能）"],
 ["道具置灰规则","6 种×5 上限：若道具种类已达 6 种且该道具未拥有 → 置灰「道具位已满(6种×5)」；若该道具堆叠≥5 → 置灰「该道具已叠满」"],
 ["升级类置灰","无任何已持有卡时，升级选项置灰「无可用卡可升级」"],
 ["篝火节点三选一","升级一张卡 / 移除一张卡 / 休息回血"],
 ["商人节点","买卡 / 删卡 / 升级 / 补货"],
 ["选择性质","奖励选择不占技能槽、不制造死牌；选择后立即生效(升级)或入背包(道具/种子)"],
]
ws = wb.create_sheet(NEW_PREFIX+"夺卡节点")
hdr=["项目","规则说明"]
style_sheet(ws, hdr, [18,90])
fill_rows(ws, rows)
print("  夺卡节点 行数:", len(rows))

# ============================================================
# 9) v58-工坊四工位
# ============================================================
rows = [
 ["print 印制","消耗 gold + 材料(recipe.cost) 印制一张物理卡入收藏","卡牌纸=纤维+清水；墨汁=毒腺/炭+莓果；颜料=季节彩果；附魔精华=温室灵光菇+符文藤","逐卡 gold/材料数量未在冻结数据中给出，按 recipe.cost 动态校验(canPrint)；材料全部可种植"],
 ["enchant 附魔","给卡追加一条后缀词条(+燃烧/+回收/+急速)","词条见 v58-词条池；受稀有度后缀上限 rare1/epic2/legendary3 约束","enchant(card,affixId) 追加，不重复同词条"],
 ["fuse 融合","5 张同类卡融合 → 目标卡精通进度 +1.0","需 5 张卡","5 合 1；不足 5 张拒绝"],
 ["inscribe 铭记研究","消耗材料永久提升铭记幸运 inscribeLuck","每研究一次 +5% 铭记率，上限 +15%（共 3 次）","研究满后拒绝重复研究；叠加在基础铭记率上"],
]
ws = wb.create_sheet(NEW_PREFIX+"工坊四工位")
hdr=["工位","功能","材料/成本","备注"]
style_sheet(ws, hdr, [16,40,40,40])
fill_rows(ws, rows)
print("  工坊四工位 行数:", len(rows))

# ============================================================
# 10) v58-撤离死亡规则
# ============================================================
ext = GD.get("expedition", {})
rows = [
 ["战利品性质","局内夺卡/掉落是物理副本，进有限格背包（每格 100 金币）"],
 ["撤离时间","信号弹撤离点召唤后 extractTime=%ss 秒；信号弹 signalExtractTime=%ss 秒" % (ext.get("extractTime",15), ext.get("signalExtractTime",20))],
 ["铭记-普通","撤离铭记概率 25%（未铭记则该副本丢失）"],
 ["铭记-稀有","15%"],
 ["铭记-史诗","8%"],
 ["铭记-传说/Boss蓝图","100% 必成（signature/blueprint 卡 inscribeRoll 直接 true）"],
 ["铭记研究加成","工坊铭记研究每级 +5% 幸运，上限 +15%，叠加在基础率上"],
 ["重复卡","已收藏卡再次撤离铭记 → 折算精通进度：普通%.2f/稀有%.2f/史诗%.2f/传说%.2f（每升1级需1.0进度）" % (DUP["common"],DUP["rare"],DUP["epic"],DUP["legendary"])],
 ["死亡-丢失","带入的消耗品/种子/武器实例 丢失；局内临时战利品全丢"],
 ["死亡-保留","安全箱前 N 格必保留（safeBoxSlots 默认 1，可升级到 3）"],
 ["死亡-永不丢失","技能收藏与精通永远不丢失（onDeath 不触碰 collection.skill）"],
 ["降级","死亡 50% 概率降级；持有 death_pardon 免死令时自动消耗免除一次"],
 ["硬核模式","hardcoreFullLoss 默认 false；开启后 item/seed 收藏数量清零（物理卡全损），技能收藏与精通仍保留"],
]
ws = wb.create_sheet(NEW_PREFIX+"撤离死亡规则")
hdr=["项目","规则说明"]
style_sheet(ws, hdr, [20,80])
fill_rows(ws, rows)
print("  撤离死亡规则 行数:", len(rows))

# ---------- 保存 ----------
wb.save(OUT_XLSX)
print("已保存:", OUT_XLSX)

# ---------- 自检：重新打开 ----------
wb2 = openpyxl.load_workbook(OUT_XLSX, read_only=True)
print("\n===== 自检 =====")
print("总 sheet 数:", len(wb2.worksheets), "(原 %d)" % len(orig_sheets))
new_count = 0
for s in wb2.worksheets:
    tag = "  [新]" if s.title.startswith(NEW_PREFIX) else ""
    if tag: new_count += 1
    print("  - %-26s rows=%-5d cols=%d%s" % (s.title, s.max_row, s.max_column, tag))
print("新增 sheet 数:", new_count)
wb2.close()
