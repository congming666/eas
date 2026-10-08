import json,openpyxl,re
from pathlib import Path
p=Path('docs/游戏数据总表_最终版.xlsx');w=openpyxl.load_workbook(p,data_only=False);expected=json.loads(Path('.workbook-final/source-cells.json').read_text(encoding='utf-8'));errors=[]
for spec in expected:
 for r,row in enumerate(spec['values'],4):
  for c,v in enumerate(row,1):
   got=w[spec['name']].cell(r,c).value
   if got!=v and not(got is None and v==''):errors.append([spec['name'],r,c])
rows=next(s['values'][1:] for s in expected if s['name']=='完整参数索引')
unknown=sorted(set(r[2] for r in rows if isinstance(r[2],str) and r[2].isascii() and not r[2].isdigit()))
assert not errors,errors[:10]
assert not unknown,unknown
assert all(re.search('[\u4e00-\u9fff]',s) for s in w.sheetnames)
assert w['武器基础']['B5'].value=='harvest_sickle'
assert w['技能解锁']['B5'].value=='初始解锁'
assert w['材料与用途'].max_row==21
assert len(w['科技树']['A'])==19
report={'sheets':len(w.sheetnames),'dataRows':sum(len(s['values'])-1 for s in expected),'sourceFields':len(rows),'mismatches':0,'untranslatedParameterNames':0,'bytes':p.stat().st_size}
Path('test-results/final-workbook-validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report))
w.close()
