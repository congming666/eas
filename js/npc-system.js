// ================= v0.8.0 NPC + 剧情线系统（网页版） =================
// 4个常驻NPC，智能对话（条件/记忆/情绪），好感度，任务，碎片化剧情
(function () {
  'use strict';

  // ===== NPC 定义 =====
  const NPCS = {
    merchant: {
      id: 'merchant', name: '流浪商人·阿洛', icon: '🧳',
      position: { x: 200, y: 180 },
      description: '走南闯北的商人，每周刷新稀有商品',
      baseAffection: 10,
      // 智能对话池：按条件分类
      dialogues: {
        greeting: [
          { text: '哟，又见面了！今天想买点什么？', minAff: 0 },
          { text: '老朋友来了！我这刚到一批好货。', minAff: 30 },
          { text: '哈哈，就知道你会来！给你留了最好的货。', minAff: 60 },
          { text: '我的挚友！今天所有商品给你打八折！', minAff: 80 }
        ],
        weather: [
          { text: '这大晴天，正适合出远门做生意。', condition: 'sunny' },
          { text: '下雨天路滑，我这有防滑靴，要看看吗？', condition: 'rain' },
          { text: '雾天容易迷路，买个指南针吧，保命用的。', condition: 'fog' },
          { text: '雷暴天别乱跑，待在屋里最安全。', condition: 'storm' }
        ],
        lore: [
          { text: '你知道吗？这片荒野以前是富饶的农田……', minAff: 20, loreId: 'lore_1' },
          { text: '我年轻时见过"大灾变"，那一天天空变成了紫色……', minAff: 40, loreId: 'lore_2' },
          { text: '据说古老谷场深处有导致灾变的源头……', minAff: 60, loreId: 'lore_3' }
        ],
        quest: [
          { text: '帮我收集 5 株向日葵，我给你稀有种子。', questId: 'merchant_sunflower' },
          { text: '我需要 3 个兽核，你去远征帮我打回来？', questId: 'merchant_beastcore', minAff: 30 }
        ],
        hint: [
          { text: '小贴士：西瓜虽然长得慢，但一次收获量很大。', minAff: 10 },
          { text: '远征时记得带火把，T4 黑得伸手不见五指。', minAff: 20 },
          { text: '精英怪的词缀是随机的，遇到"分裂"要小心。', minAff: 40 }
        ]
      },
      gifts: { wheat: 2, sunflower: 5, watermelon: 8, 'legendary_crop': 20 },
      rewards: [
        { aff: 20, desc: '解锁稀有商品栏', type: 'shop_tier2' },
        { aff: 50, desc: '每日免费领取 1 个随机种子', type: 'daily_seed' },
        { aff: 80, desc: '所有商品 8 折', type: 'discount' }
      ],
      shop: [
        { id: 'rare_seed', name: '稀有种子包', cost: 100, tier: 1 },
        { id: 'expedition_map', name: '远征地图（显示宝箱）', cost: 200, tier: 1 },
        { id: 'weapon_blueprint', name: '武器蓝图', cost: 500, tier: 2 },
        { id: 'legendary_seed', name: '传说种子', cost: 1000, tier: 2 }
      ]
    },
    farmer: {
      id: 'farmer', name: '老农夫·王伯', icon: '👴',
      position: { x: 400, y: 150 },
      description: '种了一辈子地的老人，知道所有作物的秘密',
      baseAffection: 20,
      dialogues: {
        greeting: [
          { text: '年轻人，又来学种地？', minAff: 0 },
          { text: '来来来，我新琢磨了个施肥技巧，教你。', minAff: 30 },
          { text: '你种的地越来越有样子了，像我年轻时候。', minAff: 60 }
        ],
        farmTip: [
          { text: '小麦连种有加成，但别一直种同一块地，会累土。', minAff: 0 },
          { text: '西瓜要占两格，但产量是真的高。', minAff: 10 },
          { text: '夜间作物长得慢，卷心菜不怕冷。', minAff: 20 },
          { text: '变异作物需要特定条件，多试试不同搭配。', minAff: 40 }
        ],
        lore: [
          { text: '我小时候，这里还是万亩良田……后来灾变来了。', minAff: 30, loreId: 'lore_4' },
          { text: '老人们说，是古老谷场的实验出了问题。', minAff: 50, loreId: 'lore_5' }
        ],
        quest: [
          { text: '帮我收获 20 株小麦，我教你高级施肥。', questId: 'farmer_wheat' },
          { text: '培育出一株优质作物给我看看？', questId: 'farmer_quality', minAff: 30 }
        ]
      },
      gifts: { wheat: 3, cabbage: 4, carrot: 5, 'quality_crop': 15 },
      rewards: [
        { aff: 20, desc: '解锁高级施肥技巧（+20% 产量）', type: 'farm_boost1' },
        { aff: 50, desc: '解锁作物变异指南（+10% 变异率）', type: 'farm_boost2' },
        { aff: 80, desc: '解锁传说作物培育', type: 'farm_boost3' }
      ]
    },
    veteran: {
      id: 'veteran', name: '远征老兵·铁山', icon: '⚔️',
      position: { x: 600, y: 200 },
      description: '从深渊活着回来的战士，掌握武器蓝图',
      baseAffection: 5,
      dialogues: {
        greeting: [
          { text: '……又是你。想变强？', minAff: 0 },
          { text: '你最近的战斗我听说了，有点意思。', minAff: 30 },
          { text: '好小子，已经有战士的样子了。', minAff: 60 }
        ],
        combatTip: [
          { text: '连击别贪刀，断了就重来。', minAff: 0 },
          { text: '完美闪避的关键是预判，不是反应。', minAff: 20 },
          { text: '怒气超杀留到精英怪堆里用，清场效率最高。', minAff: 40 },
          { text: 'Boss 阶段转换时是输出窗口，别浪费。', minAff: 60 }
        ],
        lore: [
          { text: '我在 T4 见过"那个东西"……它不是自然生成的。', minAff: 40, loreId: 'lore_6' },
          { text: '古老谷场的地下，有一个被封印的实验室。', minAff: 70, loreId: 'lore_7' }
        ],
        quest: [
          { text: '通关 T2 不死一次，我给你武器蓝图。', questId: 'veteran_t2' },
          { text: '连击达到 50，我教你进阶技巧。', questId: 'veteran_combo', minAff: 30 }
        ]
      },
      gifts: { beast_core: 10, boss_trophy: 25, 'high_combo': 15 },
      rewards: [
        { aff: 20, desc: '解锁铁剑蓝图', type: 'weapon_1' },
        { aff: 50, desc: '解锁长矛蓝图（范围+30%）', type: 'weapon_2' },
        { aff: 80, desc: '解锁暗影刃蓝图（暴击+20%）', type: 'weapon_3' }
      ]
    },
    traveler: {
      id: 'traveler', name: '神秘旅人·影', icon: '🌙',
      position: { x: 800, y: 170 },
      description: '身份不明的旅人，触发随机事件，知道太多秘密',
      baseAffection: 0,
      dialogues: {
        greeting: [
          { text: '……你能看见我？有意思。', minAff: 0 },
          { text: '又来了。你身上的气息……越来越浓了。', minAff: 20 },
          { text: '我等的人……也许就是你。', minAff: 50 }
        ],
        randomEvent: [
          { text: '我给你一个祝福：今日远征金币+20%。', event: 'gold_boost' },
          { text: '小心，今日有血月征兆。', event: 'blood_moon_warn' },
          { text: '这颗种子给你，种出来会有惊喜。', event: 'mystery_seed' },
          { text: '我看到了你的未来……有一场恶战。', event: 'vision' }
        ],
        lore: [
          { text: '灾变不是意外，是有人故意打开了"门"。', minAff: 30, loreId: 'lore_8' },
          { text: '古老谷场的实验室……研究的是"融合"。', minAff: 50, loreId: 'lore_9' },
          { text: '你以为怪物是野兽？不，它们曾经是人。', minAff: 70, loreId: 'lore_10' }
        ],
        quest: [
          { text: '收集 3 页日记残页，我告诉你真相。', questId: 'traveler_pages' }
        ]
      },
      gifts: { diary_page: 30, 'mystery_item': 20 },
      rewards: [
        { aff: 30, desc: '解锁每日随机事件', type: 'daily_event' },
        { aff: 60, desc: '解锁预言（显示下波兽潮类型）', type: 'predict' },
        { aff: 90, desc: '解锁真结局线索', type: 'true_ending' }
      ]
    }
  };

  // ===== 日记残页（碎片化剧情） =====
  const DIARY_PAGES = {
    page_1: { id: 'page_1', title: '研究员日记·第1天', content: '项目批准了。"融合计划"正式启动。我们将把植物基因与动物基因结合，创造能在荒野生存的新物种。', source: 'T1 宝箱掉落' },
    page_2: { id: 'page_2', title: '研究员日记·第47天', content: '第3号实验体成功了！它同时具有植物的光合作用和动物的行动力。但它……似乎有自己的意识。', source: 'T2 Boss 掉落' },
    page_3: { id: 'page_3', title: '研究员日记·第120天', content: '实验体开始失控。它们不满足于实验室，想要出去。主管说"加速最终阶段"。', source: 'T3 精英掉落' },
    page_4: { id: 'page_4', title: '研究员日记·最后一页', content: '门打开了。不是我们打开的，是它们。它们融合了……变成了我们无法理解的东西。快跑。', source: 'T4 Boss 掉落' },
    page_5: { id: 'page_5', title: '幸存者笔记', content: '灾变后第3年。农田变成了荒野，人类躲在少数据点。我们学会了用变异作物生存，但也在变成它们那样……', source: '神秘旅人好感度50赠送' }
  };

  // ===== 运行时状态 =====
  let _state = null;

  function init() {
    if (!GameState.npcData) {
      GameState.npcData = {};
      Object.keys(NPCS).forEach(id => {
        GameState.npcData[id] = {
          affection: NPCS[id].baseAffection,
          unlockedLore: [],
          completedQuests: [],
          activeQuest: null,
          lastDialogue: '',
          lastVisitDay: 0,
          visitStreak: 0
        };
      });
      GameState.diaryPages = [];
      GameState.npcEvents = {};
    }
    _state = GameState.npcData;
  }

  function getNpc(id) { return NPCS[id]; }
  function getNpcState(id) { return _state ? _state[id] : null; }
  function getAllNpcs() { return Object.values(NPCS); }

  // ===== 智能对话选择 =====
  function getDialogue(npcId, context) {
    const npc = NPCS[npcId];
    const st = _state[npcId];
    if (!npc || !st) return { text: '……', category: 'idle' };

    const aff = st.affection;
    const weather = (typeof Farm !== 'undefined' && Farm.weather) ? Farm.weather : 'sunny';
    const today = new Date().toDateString();

    // 1. 优先：有未完成任务时给任务对话
    if (st.activeQuest && !st.completedQuests.includes(st.activeQuest)) {
      const q = npc.dialogues.quest.find(q => q.questId === st.activeQuest);
      if (q) return { text: q.text + '（任务进行中）', category: 'quest', questId: q.questId };
    }

    // 2. 可接新任务时（概率触发）
    const availableQuests = (npc.dialogues.quest || []).filter(q =>
      !st.completedQuests.includes(q.questId) &&
      st.activeQuest !== q.questId &&
      (!q.minAff || aff >= q.minAff)
    );
    if (availableQuests.length > 0 && Math.random() < 0.3) {
      const q = availableQuests[Math.floor(Math.random() * availableQuests.length)];
      return { text: q.text, category: 'quest_offer', questId: q.questId };
    }

    // 3. 新解锁的剧情（只说一次）
    const newLore = (npc.dialogues.lore || []).find(l =>
      (!l.minAff || aff >= l.minAff) && !st.unlockedLore.includes(l.loreId)
    );
    if (newLore) {
      st.unlockedLore.push(newLore.loreId);
      return { text: newLore.text, category: 'lore', loreId: newLore.loreId, isNew: true };
    }

    // 4. 根据天气选择对话
    const weatherDialogues = (npc.dialogues.weather || []).filter(w => w.condition === weather);
    if (weatherDialogues.length > 0 && Math.random() < 0.3) {
      return { text: weatherDialogues[Math.floor(Math.random() * weatherDialogues.length)].text, category: 'weather' };
    }

    // 5. 根据好感度选择问候
    const greetings = (npc.dialogues.greeting || []).filter(g => aff >= g.minAff);
    if (greetings.length > 0) {
      const best = greetings[greetings.length - 1];
      // 避免重复：如果上次说过这句，换一个
      if (st.lastDialogue === best.text && greetings.length > 1) {
        const alt = greetings.filter(g => g.text !== st.lastDialogue);
        if (alt.length > 0) {
          st.lastDialogue = alt[alt.length - 1].text;
          return { text: alt[alt.length - 1].text, category: 'greeting' };
        }
      }
      st.lastDialogue = best.text;
      return { text: best.text, category: 'greeting' };
    }

    // 6. 提示/技巧
    const hints = (npc.dialogues.hint || npc.dialogues.farmTip || npc.dialogues.combatTip || []).filter(h => !h.minAff || aff >= h.minAff);
    if (hints.length > 0) {
      return { text: hints[Math.floor(Math.random() * hints.length)].text, category: 'hint' };
    }

    return { text: '……', category: 'idle' };
  }

  // ===== 好感度系统 =====
  function addAffection(npcId, amount) {
    const st = _state[npcId];
    if (!st) return;
    const before = st.affection;
    st.affection = Math.min(100, st.affection + amount);
    // 检查解锁奖励
    const npc = NPCS[npcId];
    (npc.rewards || []).forEach(r => {
      if (before < r.aff && st.affection >= r.aff) {
        if (typeof showToast === 'function') showToast(`🎉 ${npc.name} 好感度达到 ${r.aff}！解锁：${r.desc}`, 'gold');
        unlockReward(npcId, r);
      }
    });
  }

  function unlockReward(npcId, reward) {
    if (!GameState.npcRewards) GameState.npcRewards = {};
    GameState.npcRewards[reward.type] = true;
    // 应用效果
    switch (reward.type) {
      case 'farm_boost1': if (typeof FarmProcessingSystem !== 'undefined') FarmProcessingSystem.yieldBonus = 0.2; break;
      case 'discount': GameState.merchantDiscount = 0.8; break;
    }
  }

  function giveGift(npcId, itemId) {
    const npc = NPCS[npcId];
    const st = _state[npcId];
    if (!npc || !st) return false;
    const giftValue = npc.gifts[itemId] || 1;
    addAffection(npcId, giftValue);
    if (typeof showToast === 'function') showToast(`${npc.name} 很喜欢！好感度 +${giftValue}`, 'success');
    return true;
  }

  // ===== 任务系统 =====
  function acceptQuest(npcId, questId) {
    const st = _state[npcId];
    if (!st) return;
    st.activeQuest = questId;
    if (typeof showToast === 'function') showToast('接受任务', 'info');
  }

  function completeQuest(npcId, questId) {
    const st = _state[npcId];
    if (!st || st.completedQuests.includes(questId)) return;
    st.completedQuests.push(questId);
    if (st.activeQuest === questId) st.activeQuest = null;
    addAffection(npcId, 15);
    // 任务奖励
    const rewards = {
      merchant_sunflower: { gold: 100, seeds: 3 },
      merchant_beastcore: { gold: 300, item: 'rare_seed' },
      farmer_wheat: { gold: 50, skill: 'farm_boost' },
      farmer_quality: { gold: 200, item: 'quality_fertilizer' },
      veteran_t2: { gold: 500, item: 'weapon_blueprint' },
      veteran_combo: { gold: 300, skill: 'combo_boost' },
      traveler_pages: { gold: 0, lore: 'true_ending' }
    };
    const r = rewards[questId];
    if (r) {
      if (r.gold) GameState.gold += r.gold;
      if (r.seeds) GameState.seeds += r.seeds;
      if (typeof showToast === 'function') showToast(`任务完成！获得 ${r.gold ? r.gold + '金币 ' : ''}${r.item || ''}`, 'gold');
    }
  }

  // ===== 日记残页 =====
  function findDiaryPage(pageId) {
    if (!GameState.diaryPages) GameState.diaryPages = [];
    if (GameState.diaryPages.includes(pageId)) return false;
    GameState.diaryPages.push(pageId);
    const page = DIARY_PAGES[pageId];
    if (page && typeof showToast === 'function') showToast(`📜 发现日记残页：${page.title}`, 'gold');
    return true;
  }

  function getCollectedPages() { return GameState.diaryPages || []; }
  function getPageContent(pageId) { return DIARY_PAGES[pageId]; }
  function getAllPages() { return Object.values(DIARY_PAGES); }

  // ===== 神秘旅人随机事件 =====
  function triggerTravelerEvent() {
    const npc = NPCS.traveler;
    const events = npc.dialogues.randomEvent;
    const ev = events[Math.floor(Math.random() * events.length)];
    GameState.npcEvents = GameState.npcEvents || {};
    GameState.npcEvents.travelerEvent = ev.event;
    if (ev.event === 'gold_boost') GameState.expeditionGoldBonus = 0.2;
    if (ev.event === 'mystery_seed') { GameState.seeds++; if (typeof showToast === 'function') showToast('获得神秘种子！', 'gold'); }
    return ev;
  }

  // ===== 每日拜访奖励 =====
  function dailyVisit(npcId) {
    const st = _state[npcId];
    if (!st) return;
    const today = new Date().toDateString();
    if (st.lastVisitDay !== today) {
      st.lastVisitDay = today;
      st.visitStreak++;
      addAffection(npcId, 2); // 每日拜访+2好感
      // 连续拜访奖励
      if (st.visitStreak >= 7) {
        addAffection(npcId, 5);
        if (typeof showToast === 'function') showToast(`连续拜访 7 天！${NPCS[npcId].name} 好感度额外+5`, 'gold');
        st.visitStreak = 0;
      }
    }
  }

  // 暴露全局
  window.NpcSystem = {
    NPCS, DIARY_PAGES,
    init, getNpc, getNpcState, getAllNpcs,
    getDialogue, addAffection, giveGift,
    acceptQuest, completeQuest,
    findDiaryPage, getCollectedPages, getPageContent, getAllPages,
    triggerTravelerEvent, dailyVisit
  };
})();
