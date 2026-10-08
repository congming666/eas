# -*- coding: utf-8 -*-
"""从当前运行配置重建唯一中文最终版，不再读取旧 Excel。"""
import os, subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
RUNTIME = Path.home()/'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
subprocess.run(['node', str(ROOT/'tools/export-game-data.js')], cwd=ROOT, check=True)
result = subprocess.run([str(RUNTIME), str(ROOT/'.workbook-final/build.mjs')], cwd=ROOT)
# 某些 Windows 运行时导出完成后返回 1；必须通过独立读回校验。
subprocess.run(['python', str(ROOT/'.workbook-final/validate.py')], cwd=ROOT, check=True)
print('最终版已重建并通过逐单元格验证：docs/游戏数据总表_最终版.xlsx')
