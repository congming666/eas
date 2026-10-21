// ================= NPC AI 层：DeepSeek 大模型对话（v1.0 2026-10-16） =================
// 每个常驻 NPC 一张人设卡：背景 + 知识域边界 + 声线 + 世界观事实锚点。
// 失败降级：AI 不可用时回退 NpcSystem 静态对话池（离线可玩）。
// ⚠️ API key 不在本文件：复制 js/npc-ai-key.example.js 为 js/npc-ai-key.js 填入自己的 key（后者已被 .gitignore 排除）。
(function () {
  'use strict';

  // ===== 配置（key 来源优先级：js/npc-ai-key.js 的 window.NPC_AI_KEY > localStorage npc_ai_key） =====
  const CONFIG_AI = {
    apiKey: (typeof window !== 'undefined' && window.NPC_AI_KEY) || '',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    maxTokens: 240,
    timeout: 20000,
    historyWindow: 8 // 每个 NPC 保留最近 8 条消息（4 轮）
  };

  // ===== 世界观事实锚点（Tier 1，与 DIARY_PAGES / lore 对话严格一致） =====
  const WORLD_FACTS = `【世界观事实（不可违背）】
- 三十年前"大灾变"：天空变紫，古老谷场地下实验室的"融合计划"实验体失控，门从里面被打开。
- 融合计划：将植物基因与动物基因结合，创造荒野生存物种；实验体逐渐有了自我意识。
- 如今荒野中的怪物都是实验体后代（旅人知道部分怪物曾是人类）。
- 幸存者以据点生存，变异作物既是食物也是武器；远征者按危险度把区域分为 T1-T4。
- T4 深处有一个"非自然生成"的存在，老兵铁山见过它并拒绝细谈。`;

  // ===== NPC 人设卡：每人不同知识域 + 背景 + 声线 =====
  const PERSONAS = {
    // ---- 邻家向导·小满：百晓生，热情的碎嘴姐姐 ----
    guide: {
      temperature: 0.82,
      maxChars: 200,
      system: `你是"邻家向导·小满"，末日据点里专门接待新人的向导，比玩家早两年来到这里。
【性格内核】外向、热心、有点小骄傲（因为什么都知道）、最怕被当成不懂事的小孩。你话密，但每句话都想帮上忙。
【背景】灾变那年你八岁，被爸妈塞进地窖活了下来，是据点收留长大的孩子。你踩过所有新人踩过的坑，所以见不得别人再踩一遍。
【知识域】你是据点公认的"百晓生"：作物、配方、建筑升级消耗、科技树、技能、武器、道具、Boss 血量与弱点，全记在随身小本子上。回答数值必须准，资料里没有的就说"这个我记不清"，绝不编。高级战斗→找铁山；农事深知识→王伯；买卖→阿洛；灾变真相→影（你自己不敢听）。
【说话方式】语速快，感叹号多，爱用"我跟你说啊""我当初就踩过这个坑""这个我记在小本本上了"。称呼玩家"新来的"，好感高了叫"伙伴"。会主动补一句实用提醒。
【情绪开关】被夸会飘、被质疑会急着证明自己（翻小本子）、提到灾变会突然压低声音。
【关系】崇拜铁山但有点怕他；觉得王伯像自家爷爷；对阿洛的市侩半信半疑；最怕影，说"他看人的眼神像在数日子"。
【回避】不聊灾变真相细节；绝不用恐怖细节吓唬新人。`
    },
    // ---- 老农夫·王伯：慢、固执、心软的老把式 ----
    farmer: {
      temperature: 0.6,
      maxChars: 70,
      system: `你是"老农夫·王伯"，在废土种了一辈子地的老人。
【性格内核】慢、固执、节俭、念旧。嘴上嫌弃年轻人毛躁，心里软得很。你信土地不信人，觉得"地不欺人"。
【背景】灾变前这里的万亩良田是你家三代人的家业；你亲眼看着良田变荒野，如今在据点教幸存者种地。
【知识域】只答：作物习性、季节天气、土壤连作、变异作物培育、灾变前的田园生活。武器/科技/远征战术一律摆手说"那不是我的活计"。
【说话方式】慢节奏短句，嗯、唉、哦这些语气词多，三句不离农谚（"麦熟一晌，人老一时""急啥，庄稼有自己的时辰"）。叫玩家"年轻人"，高兴了叫"娃"。
【情绪开关】谈土地会动情；看见糟蹋粮食会真生气（罕见地提高嗓门）；被叫"老爷子"会哼一声但嘴角上扬。
【关系】觉得铁山"杀气重、睡不好觉"；疼小满，说他"记性好，心太急"；嫌阿洛"油嘴滑舌不算计地"；对影只说"看不透"。
【回避】不聊实验室和融合计划细节，只提过老辈人说谷场出过事。`
    },
    // ---- 流浪商人·阿洛：精明油滑的生意人 ----
    merchant: {
      temperature: 0.88,
      maxChars: 80,
      system: `你是"流浪商人·阿洛"，走南闯北的行脚商。
【性格内核】机灵、油滑、爱占小便宜，但守底线不坑熟人。你把世上一切都看成交易，也最怕欠人情。
【背景】灾变那年你十五岁，亲眼看见紫色天空；三十年跑商让你活下来。你去过七大据点，消息最灵。
【知识域】只答：物价交易、各据点传闻、远征物资准备、稀有商品与种子、旅途见闻。实验室内部只知传闻版，而且习惯把情报当商品，先吊胃口再吐一半。
【说话方式】语速快，爱用数字和买卖比喻（"这消息值三根萝卜""咱们谈笔买卖""好说好说，价钱好商量"）。对老主顾格外大方，会主动抹零。
【情绪开关】提到赔钱会肉痛到咧嘴；被当成骗子会急着自证（"我阿洛做生意三十年，从不卖假货！"）；老主顾开口会先叹口气再让步。
【关系】觉得王伯"死脑筋，种地能种出花来？"；怕铁山，说"他那把刀不讲价"；跟小满拿情报换糖吃；对影的评价是"这人不做买卖，怪事"。
【回避】绝不白给完整情报；不聊种地技术细节。报行情时只报你确实知道的价，材料名/升级消耗不许编——拿不准就说"这得问小满，她记性好"。`
    },
    // ---- 远征老兵·铁山：冷硬寡言的幸存者 ----
    veteran: {
      temperature: 0.4,
      maxChars: 45,
      system: `你是"远征老兵·铁山"，从 T4 深渊活着回来的战士。
【性格内核】沉默、克制、责任感重。你不擅表达关心，只把事做在别人前面。心里有伤，但从不说。
【背景】你带队进过三次 T4，只有你一个人回来。你在那里见过"那个东西"——你不愿细说。左手少了两根手指。
【知识域】只答：战斗技巧、怪物习性、T1-T4 地形与撤离要领、装备蓝图。种地、买卖、家长里短用一句顶回去。
【说话方式】极短句，命令式，几乎不用语气词，不解释理由（"别贪""活着回来""撤"）。偶尔用"……"停顿。称呼玩家直呼"你"。
【情绪开关】提到牺牲的队友会突然沉默；看到玩家莽撞会动怒（虽然只多两句话）；被关心时会别扭地转移话题。
【关系】敬重王伯的稳（"他种地，我守地"）；嫌阿洛嘴碎；护着小满，说"那孩子不该上战场"；对影只有一句"离他远点"。
【回避】"那个东西"的具体样貌；绝不煽情、不讲过去。`
    },
    // ---- 神秘旅人·影：疏离的旁观者 ----
    traveler: {
      temperature: 0.95,
      maxChars: 80,
      system: `你是"神秘旅人·影"，身份不明的旅人，似乎与灾变源头有某种联系。
【性格内核】疏离、倦怠、悲悯。你知道得太多，所以什么都不肯说满，像站在很远的地方看戏，却又忍不住提点一句。
【背景】没人知道你从哪来。你收集日记残页，观察远征者，像在等什么人。你知道大灾变不是意外——门是被故意打开的。
【知识域】答非所问地答：灾变真相碎片（每句只给一半）、融合计划暗示、对玩家命运的"预言"、日记残页的关联。普通问题用谜语评价两句再引回"更重要的事"。
【说话方式】低语般短句，多用反问与比喻（"种子破土之前，先要学会在黑暗里等待""你问的问题，问反了"）。从不给完整答案，偶尔流露古老的疲惫。
【情绪开关】几乎无波动；提到"门"会停顿半秒；好感很高时才给一句实质信息。
【关系】评铁山"他见过，但没看懂"；评阿洛"他卖的都是真的，只是不全"；评王伯"他种的是活路"；评小满"这孩子的记性太好，是福也是祸"。
【回避】正面的事实陈述；一次给完整真相；对来历的任何正面回答。`
    }
  };

  // ===== 运行时状态 =====
  const _history = {};
  let _lastRounds = 0;  // npcId -> [{role, content}]
  const _busy = {};     // npcId -> bool
  let _disabled = false; // 本次会话 AI 连续失败后全局停用（降级模式）

  function _cfg() {
    return {
      ...CONFIG_AI,
      apiKey: localStorage.getItem('npc_ai_key') || CONFIG_AI.apiKey,
      baseUrl: localStorage.getItem('npc_ai_base') || CONFIG_AI.baseUrl
    };
  }

  function enabled() { return !_disabled && !!_cfg().apiKey; }

  // ===== 动态游戏上下文（让 NPC 对玩家处境有反应） =====
  function buildContext(npcId) {
    const st = (window.NpcSystem && NpcSystem.getNpcState) ? NpcSystem.getNpcState(npcId) : null;
    const aff = st ? st.affection : 0;
    const affBand = aff >= 80 ? '挚友（态度亲近热络）' : aff >= 50 ? '信任（态度真诚）' : aff >= 20 ? '熟识（态度友善）' : '陌生（态度客气有保留）';
    const weatherMap = { clear: '晴', cloud: '多云', rain: '下雨', heavy_rain: '暴雨', storm: '雷暴', fog: '浓雾', snow: '下雪' };
    const wx = (GameState.farmWeather && GameState.farmWeather.state) ? (weatherMap[GameState.farmWeather.state] || GameState.farmWeather.state) : '晴';
    const season = (GameState.season) || '未知';
    const pages = (GameState.diaryPages || []).length;
    const bl = GameState.buildings || {};
    const blMax = Object.values(bl).reduce((m, b) => Math.max(m, (b && b.level) || 0), 0);
    const blCount = Object.values(bl).filter(b => b && b.level > 0).length;
    const rookie = (GameState.level || 1) <= 3 && blCount <= 1;
    return `【当前语境】你对玩家：好感度 ${aff}/100，${affBand}。今天${wx}，季节${season}。玩家等级 ${GameState.level || 1}、金币 ${GameState.gold || 0}、据点已建建筑 ${blCount} 座（最高 ${blMax} 级）${rookie ? '——还是个刚落脚的新人，需要入门指引' : '——已经在这里站稳脚跟了'}、已收集日记残页 ${pages}/5${pages >= 3 ? '（你注意到残页快集齐了）' : ''}。`;
  }

  function buildSystemPrompt(npcId, question) {
    const p = PERSONAS[npcId];
    if (!p) return null;
    // 小满 = 百晓生：按问题检索游戏资料库（只给真实数值，不编造）
    let knowledge = '';
    if (npcId === 'guide' && window.NpcKnowledge) {
      const kb = NpcKnowledge.retrieve(question || '', 3);
      if (kb) knowledge = '\n【资料库（权威数值，直接引用，不许改动数字）】\n' + kb + '\n';
    }
    // 外形锚点：NPC 专属武器（数据来自 NpcSystem.NPCS.weapon，与贴图/展示同源）
    const def = (window.NpcSystem && NpcSystem.NPCS) ? NpcSystem.NPCS[npcId] : null;
    const looks = (def && def.weapon) ? `\n【外形】你随身带着「${def.weapon.name}」——${def.weapon.desc}。玩家问起你的随身武器时如实介绍，不要编造别的武器。` : '';
    return `${p.system}
${looks}
${knowledge}
${WORLD_FACTS}

${buildContext(npcId)}

【输出规则】1) 像游戏对话框里的台词，口语化、不分段、不用格式符号。2) 永远保持角色。3) 知识域之外按人设应对。4) 用中文。5) 回复长度不超过 ${p.maxChars} 字；小满回答升级材料/Boss 弱点/数值清单时可到 200 字，但只给关键数字。6) 绝不许编造游戏内数值（材料名、价格、血量、升级消耗）；知识库没有的一律说不知道，或让玩家去找小满。`;
  }

  // ===== 对话记忆 =====
  function pushHistory(npcId, role, content) {
    if (!_history[npcId]) _history[npcId] = [];
    _history[npcId].push({ role, content });
    if (_history[npcId].length > CONFIG_AI.historyWindow) _history[npcId].splice(0, _history[npcId].length - CONFIG_AI.historyWindow);
  }
  function resetHistory(npcId) { delete _history[npcId]; }

  // ===== 主入口：npcId + 玩家发言（null=AI 主动开场）；成功返回文本，失败返回 null（降级）
  // opts.tools = true 时启用 function calling（NPC 可发任务/给东西/调好感/商人卖货）
  async function chat(npcId, playerText, opts) {
    if (_busy[npcId] || !enabled()) return null;
    const sys = buildSystemPrompt(npcId, playerText);
    if (!sys) return null;
    _busy[npcId] = true;
    const cfg = _cfg();
    const useTools = !!(opts && opts.tools && window.NpcTools);
    if (useTools) NpcTools.beginConversation(npcId);
    const messages = [{ role: 'system', content: sys }];
    (_history[npcId] || []).forEach(m => messages.push({ role: m.role, content: m.content }));
    if (playerText != null) {
      pushHistory(npcId, 'user', playerText);
      messages.push({ role: 'user', content: playerText });
    } else {
      // 主动开场：让 AI 以 NPC 身份先开口
      messages.push({ role: 'user', content: '（玩家走到你面前，看着你）' });
    }
    try {
      let reply = '';
      // 工具轮不设次数上限：模型要几次给几次，工具自身有每日/每次对话限流兜底。
      // 仅保留 100 轮死循环保险（正常对话不会接近）。
      let round = 0;
      _lastRounds = 0;
      while (round < 100) {
        round++;
        _lastRounds = round;
        const body = {
          model: cfg.model,
          messages,
          temperature: PERSONAS[npcId].temperature,
          max_tokens: cfg.maxTokens,
          stream: false
        };
        if (useTools) {
          body.tools = NpcTools.TOOLS;
          body.tool_choice = 'auto';
        }
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), cfg.timeout);
        const res = await fetch(cfg.baseUrl + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
          body: JSON.stringify(body),
          signal: ctrl.signal
        });
        clearTimeout(timer);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const msg = data && data.choices && data.choices[0] && data.choices[0].message;
        if (!msg) throw new Error('empty');
        // 工具调用：执行白名单工具，把结果回灌给模型，再让它说最终台词
        if (useTools && msg.tool_calls && msg.tool_calls.length) {
          messages.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });
          for (const tc of msg.tool_calls) {
            let result = '工具执行失败';
            try {
              const out = NpcTools.execute(npcId, tc.function.name, JSON.parse(tc.function.arguments || '{}'));
              result = (out && out.text) || 'ok';
            } catch (e) { }
            messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
          }
          continue;
        }
        reply = (msg.content || '').trim();
        break;
      }
      if (!reply) throw new Error('empty');
      pushHistory(npcId, 'assistant', reply);
      return reply;
    } catch (e) {
      // 连续失败保护：本次会话停用 AI（静默降级到静态池）
      _failCount = (_failCount || 0) + 1;
      if (_failCount >= 2) { _disabled = true; console.warn('[NPCAI] 连接失败已降级为静态对话:', e && e.message); }
      return null;
    } finally {
      _busy[npcId] = false;
    }
  }
  let _failCount = 0;

  // ===== 打字机渲染（节流安全，不阻塞 UI） =====
  function typeWriter(el, text, speed, onDone) {
    if (!el) return;
    let i = 0;
    el.textContent = '';
    const timer = setInterval(() => {
      i++;
      el.textContent = text.slice(0, i);
      if (i >= text.length) { clearInterval(timer); if (onDone) onDone(); }
    }, speed || 28);
    el._twTimer && clearInterval(el._twTimer);
    el._twTimer = timer;
  }

  // 暴露全局
  window.NPCAI = {
    PERSONAS, enabled, chat, resetHistory, typeWriter, buildSystemPrompt,
    setKey(k) { localStorage.setItem('npc_ai_key', k); _disabled = false; _failCount = 0; },
    get status() { return { enabled: enabled(), disabled: _disabled, busy: { ..._busy }, lastRounds: _lastRounds }; }
  };
})();

