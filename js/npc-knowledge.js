/* ================= 小满的百晓生知识库 =================
 * 从游戏运行时数据（CONFIG / TechSystem / FarmRecipes / NpcSystem）编译出结构化知识，
 * 按问题关键词检索最相关段落，注入 NPC 的 system prompt。
 * 原则：只引用代码里的真实数值，不编造；查不到就说查不到。
 */
(function () {
  'use strict';

  let _cache = null;

  const fmt = (n) => (Math.round(n * 10) / 10);

  function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }

  // ---------- 各段知识 ----------
  function secBasics() {
    const v = (window.CONFIG && CONFIG.GAME_VERSION) || '5.9';
    return `【基础】当前版本 v${v}。资源分三类：作物/加工品（仓库）、远征材料（硬木/铁块/灵晶/Boss獠牙，建筑升级用）、金币。远征分 T1-T4，难度与门票金逐级提高；撤离成功带回战利品，死亡按安全箱规则结算。`;
  }

  function secCrops() {
    const list = safe(() => (CONFIG.crops || []).filter(c => c.rewardType !== 'cultivation'), []);
    if (!list.length) return '';
    const rows = list.map(c => `${c.name}(${c.id})：生长${c.growTime}秒，种价${c.seedPrice}，售价${c.sellPrice}，${c.rarity}${c.trait ? '，特性' + c.trait : ''}${c.rewardType ? '，产出' + c.rewardType : ''}`).join('\n');
    return `【作物】共${list.length}种。\n${rows}`;
  }

  function secRecipes() {
    const list = safe(() => window.FarmRecipes || [], []);
    if (!list.length) return '';
    const rows = list.map(r => `${r.name}：${r.inputCrop}×${r.inputQty} → ${r.outputName}×${r.outputQty}，耗时${r.time}秒，需加工工坊Lv${r.workshopLevel}`).join('\n');
    return `【加工配方】共${list.length}条。\n${rows}`;
  }

  function secBuildings() {
    if (!window.TechSystem) return '';
    const rows = [];
    for (const b of Object.values(TechSystem.BUILDINGS)) {
      const costs = [];
      for (let l = 1; l <= b.maxLevel; l++) {
        const c = TechSystem.computeCost(b, l);
        const mat = TechSystem.computeMaterials(b, l);
        const items = TechSystem.distributeMatItems(b, l, mat);
        const matTxt = items ? '，材料' + Object.entries(items).map(([k, n]) => k + '×' + n).join('+') : '';
        const matSum = items ? Object.values(items).reduce((a, n) => a + n, 0) : c.materials;
        costs.push(`L${l}：${c.gold}金币+${matSum}材料${matTxt}`);
      }
      const eff = (b.effects || []).map(e => `L${e.level}:${e.desc}`).join('；');
      rows.push(`${b.name}(${b.id})，满级L${b.maxLevel}，前置${(b.requires || []).join('、') || '无'}\n  升级消耗：${costs.join('；')}\n  效果：${eff}`);
    }
    return `【建筑升级】共${rows.length}座。金币按 costMultiplier 指数增长（约每级×1.65-2.6），材料按2.5倍/级增长。\n${rows.join('\n')}`;
  }

  function secTech() {
    if (!window.TechSystem) return '';
    const rows = [];
    for (const t of Object.values(TechSystem.TECH_TREES)) {
      const nodes = (t.nodes || []).map(n => `${n.name}(${n.cost}点${n.requires.length ? ',需' + n.requires.join('/') : ''})：${n.desc}`).join('；');
      rows.push(`${t.name}线：${nodes}`);
    }
    return `【科技树】${rows.join('\n')}`;
  }

  function secSkills() {
    const list = safe(() => CONFIG.skills || [], []);
    if (!list.length) return '';
    const rows = list.map(s => `${s.name}：冷却${s.cooldown}s，耗能${s.energyCost}${s.damage ? '，伤害' + s.damage : ''}${s.range ? '，范围' + s.range : ''}${s.aoe ? '，群体' : ''}——${s.desc || ''}`).join('\n');
    return `【技能】共${list.length}个。\n${rows}`;
  }

  function secWeapons() {
    const list = safe(() => CONFIG.weapons || [], []);
    if (!list.length) return '';
    const rows = list.map(w => `${w.name}：${w.mode}，伤害${w.damage}，射程${w.range}，冷却${w.cooldown}s——${w.description || ''}`).join('\n');
    return `【武器】共${list.length}把。\n${rows}`;
  }

  function secConsumables() {
    const list = safe(() => CONFIG.consumables || [], []);
    if (!list.length) return '';
    const rows = list.map(c => `${c.name}：${c.heal ? '回血' + c.heal : ''}${c.damage ? '伤害' + c.damage : ''}${c.range ? '范围' + c.range : ''}——${c.desc || ''}`).join('\n');
    return `【消耗品】${rows}`;
  }

  // Boss 弱点：按代码里的机制标记推导战术（护甲/飞行/治疗/召唤/远程/冲锋/狂暴）
  function bossWeakness(b) {
    const tags = [];
    const sk = b.skill || '';
    if (b.armor || /护甲|减伤/.test(sk)) tags.push('有护甲减伤，弱点是破甲/持续高伤，别用低伤害武器硬磨');
    if (b.flying) tags.push('会飞，近战够不到，必须远程/范围武器，可贴身躲俯冲');
    if (b.healer || /治疗|回血/.test(sk)) tags.push('会自我治疗，弱点是爆发秒杀或先控制，拖久必被奶回来');
    if (b.summoner || /召唤|产卵/.test(sk)) tags.push('会召唤小怪，弱点是范围清场+优先集火本体，别被小怪缠住');
    if (b.ranged || /远程|弹幕|风筝/.test(sk)) tags.push('远程风筝，弱点是贴脸压制，绕柱近身');
    if (b.charger || /冲锋|突刺/.test(sk)) tags.push('突进型，弱点是冲锋后硬直，完美闪避后反打');
    if (/狂暴/.test(sk)) tags.push('半血会狂暴，弱点是留爆发和控制，在狂暴前打掉血量');
    if (/毒/.test(sk)) tags.push('带毒伤，弱点是别在毒沼里恋战，边跑边打');
    if (/火雨|火焰/.test(sk)) tags.push('火属性AOE，弱点是持续移动、不站原地');
    if (!tags.length) tags.push('没有明显机制弱点，按常规躲技能+集火打');
    return tags.join('；');
  }

  function secBosses() {
    const list = safe(() => Object.values(CONFIG.bosses || {}), []);
    if (!list.length) return '';
    const rows = list.map(b => `${b.name}(T${b.tier})：血量${b.hp}，伤害${b.dmg}，速度${b.speed}，技能「${b.skill}」，掉落${(b.loot || []).join('/')}\n  战术弱点：${bossWeakness(b)}`).join('\n');
    return `【Boss名录】共${list.length}个。\n${rows}`;
  }

  function secMonsters() {
    const list = safe(() => Object.entries(CONFIG.monsters || {}), []);
    const normal = list.filter(([, m]) => !m.boss);
    const elites = list.filter(([, m]) => m.elite);
    const fmtRow = ([id, m]) => `${m.name}：血${m.hp}，伤${m.damage}，速${m.speed}${m.armor ? '，护甲' + Math.round(m.armor * 100) + '%' : ''}${m.flying ? '，飞行' : ''}${m.ranged ? '，远程' : ''}`;
    return `【普通怪】${normal.slice(0, 12).map(fmtRow).join('；')}\n【精英怪】${elites.slice(0, 10).map(fmtRow).join('；')}`;
  }

  function secMaps() {
    const list = safe(() => CONFIG.maps || [], []);
    if (!list.length) return '';
    const rows = list.map(m => `T${m.tier} ${m.name}：门票${m.entryFee}金，怪物${m.monsterCount}，宝箱${m.chestCount}，危险度${m.danger}${m.modifier ? '，修正「' + m.modifier + '」' : ''}`).join('\n');
    return `【地图】共${list.length}张。\n${rows}`;
  }

  function secNpc() {
    if (!window.NpcSystem) return '';
    const rows = Object.values(NpcSystem.NPCS).map(n => {
      const gifts = Object.entries(n.gifts || {}).map(([k, v]) => k + '+' + v + '好感').join('、');
      const shop = (n.shop || []).map(s => `${s.name}${s.cost}金`).join('、');
      const quests = ((n.dialogues && n.dialogues.quest) || []).map(q => q.text).join(' / ');
      return `${n.name}：喜好礼物${gifts || '无'}${shop ? '；商店' + shop : ''}${quests ? '；委托' + quests : ''}`;
    });
    return `【NPC】${rows.join('\n')}`;
  }

  function secOrders() {
    if (!window.OrderSystem) return '';
    return `【今日订单】每天3条，按等级分层：1-10级只出作物，11-30级加加工品，31级起出远征材料。奖励=200+12×等级金币，另随机材料1-3个、15%种子、5%蓝图。交付查仓库、加工与收获按当日计数。每天可花200金币手动刷新1次。`;
  }

  // ---------- 段落表 + 检索 ----------
  const SECTIONS = [
    { id: 'basics', key: ['版本', '资源', '金币', '赚钱', '收益', '材料', '远征规则', '撤离', '死亡'], fn: secBasics },
    { id: 'crops', key: ['作物', '种子', '种植', '生长', '成熟', '收获', '产量', '季节', '变异', '品质', '种什么', '卖'], fn: secCrops },
    { id: 'recipes', key: ['加工', '配方', '面粉', '面包', '植物油', '火把', '饲料', '鸡蛋', '工坊', '制作'], fn: secRecipes },
    { id: 'buildings', key: ['建筑', '升级', '费用', '材料', '加工研究所', '温室', '畜舍', '研究所', '建什么', '科技'], fn: secBuildings },
    { id: 'tech', key: ['科技', '研究', '科技点', '节点', '解锁'], fn: secTech },
    { id: 'skills', key: ['技能', '冷却', '能量', '主动技能', '技能点'], fn: secSkills },
    { id: 'weapons', key: ['武器', '长刃', '豌豆', '射程', '伤害', '换武器'], fn: secWeapons },
    { id: 'consumables', key: ['道具', '药', '绷带', '消耗品', '回血', '火把'], fn: secConsumables },
    { id: 'boss', key: ['boss', '首领', '弱点', '打法', '野猪王', '枯木精', '石像鬼', '魔像', '巫妪', '虫母', '炎魔', '深渊', '守望', '祭司', '冠军'], fn: secBosses },
    { id: 'monsters', key: ['怪物', '野猪', '蝙蝠', '精英', '词缀', '怪'], fn: secMonsters },
    { id: 'maps', key: ['地图', '区域', 'T1', 'T2', 'T3', 'T4', '门票', '难度', '去哪'], fn: secMaps },
    { id: 'npc', key: ['NPC', '好感', '礼物', '商店', '委托', '阿洛', '王伯', '铁山', '影'], fn: secNpc },
    { id: 'orders', key: ['订单', '每日', '刷新', '委托', '收益'], fn: secOrders }
  ];

  function buildAll() {
    if (_cache && _cache.sections) return _cache.sections;
    const sections = SECTIONS.map(s => ({ id: s.id, key: s.key, text: safe(s.fn, '') })).filter(s => s.text);
    _cache = { sections, at: Date.now() };
    return sections;
  }

  function retrieve(question, maxSections) {
    const q = (question || '').toLowerCase();
    const sections = buildAll();
    const max = maxSections || 3;
    if (!q) return '';
    const scored = sections.map(s => {
      let score = 0;
      s.key.forEach(k => { if (q.indexOf(String(k).toLowerCase()) >= 0) score += 2; });
      return { s, score };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, max);
    return scored.map(x => x.s.text).join('\n\n');
  }

  function index() {
    const sections = buildAll();
    return '可查：' + sections.map(s => s.id).join('、');
  }

  // ===== 本地问答：AI 不可用时，用知识库按关键词直接答（公开版没有 API key 也能问） =====
  function tokenize(q) {
    const s = String(q || '').replace(/[\s，。？！、：:；;,.?!（）()]/g, '');
    const grams = new Set();
    for (let i = 0; i < s.length - 1; i++) grams.add(s.slice(i, i + 2));
    return [...grams];
  }

  function answer(question) {
    const sections = buildAll();
    const grams = tokenize(question);
    if (!grams.length) return null;
    const scored = sections.map((s) => {
      const lines = s.text.split('\n');
      const ranked = [];
      for (const line of lines) {
        if (!line.trim()) continue;
        let n = 0;
        for (const g of grams) if (line.indexOf(g) >= 0) n++;
        if (n > 0) ranked.push({ line: line.trim(), n });
      }
      ranked.sort((a, b) => b.n - a.n);
      // 段落级命中权重：问题里直接出现该段的关键词（如「加工研究所」「Boss 弱点」）时强优先，
      // 避免大段落靠行数堆分数压过真正相关的段落。
      const qRaw = String(question || '');
      let keyHits = 0;
      for (const k of s.key) if (qRaw.indexOf(String(k)) >= 0) keyHits++;
      const lineScore = ranked.reduce((a, x) => a + x.n, 0);
      const total = keyHits * 12 + Math.min(lineScore, 8) * 2 + (ranked[0] ? ranked[0].n * 3 : 0);
      return { s, ranked, total };
    }).filter((x) => x.ranked.length || x.total > 0).sort((a, b) => b.total - a.total);
    if (!scored.length) return null;
    const top = scored[0];
    if (!top.ranked.length) top.ranked = [{ line: top.s.text.split('\n')[0], n: 1 }];
    // 取最相关的 2 行；如果第一行是"【段落】"标题，换下一行
    const rawLines = top.s.text.split('\n');
    const allLines = rawLines.map((l) => l.trim());
    const picked = [];
    const clean = (line) => (line.startsWith('【') ? line.replace(/^【[^】]*】/, '').trim() : line);
    const best = top.ranked[0];
    const bestIdx = allLines.indexOf(best.line);
    const first = clean(best.line);
    if (first) picked.push(first);
    // 只有「缩进的续行」才是同一实体的细节（建筑的升级消耗、Boss 的战术弱点）；
    // 作物/NPC 这类一行一条的段落不会误带下一条。
    const rawNext = bestIdx >= 0 ? (rawLines[bestIdx + 1] || '') : '';
    if (rawNext.startsWith('  ') && clean(rawNext.trim())) picked.push(clean(rawNext.trim()));
    // 只保留一条命中行 + 其续行，避免把相邻条目也念出来
    let text = picked.join('；');
    if (!text) return null;
    if (text.length > 160) text = text.slice(0, 158) + '…';
    const bonus = top.s.id === 'boss' ? '（具体打法按它技能来，别硬顶）' : '';
    return { section: top.s.id, text: text + bonus };
  }

  window.NpcKnowledge = { buildAll, retrieve, index, answer };
})();
