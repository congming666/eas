/* ================= NPC 工具调用（DeepSeek function calling 的安全白名单） =================
 * 让 AI 真的能"做事"：发任务、给东西、微调好感、商人卖货。
 * 所有副作用都在本地校验与限流，AI 只能选择预定义工具，不能自由改数值。
 */
(function () {
  'use strict';

  const dayKey = () => (window.RewardSystem && RewardSystem.dateKey)
    ? RewardSystem.dateKey() : new Date().toISOString().slice(0, 10);

  const GIFT_ITEMS = ['seeds', 'herb_kit', 'torch'];
  const SHOP_ITEMS = ['rare_seed', 'expedition_map', 'weapon_blueprint', 'legendary_seed'];

  const TOOLS = [
    {
      type: 'function',
      function: {
        name: 'offer_quest',
        description: '给玩家发布一个当前可接的委托（每位 NPC 每天最多 1 次，需满足好感度门槛）',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'give_gift',
        description: '赠送玩家一件小物品作为聊得好的奖励（每人每天合计最多 2 件）',
        parameters: {
          type: 'object',
          properties: {
            item: { type: 'string', enum: GIFT_ITEMS, description: 'seeds=种子, herb_kit=草药包, torch=火把' },
            count: { type: 'integer', minimum: 1, maximum: 2 }
          },
          required: ['item']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'adjust_affection',
        description: '根据本次对话表现微调好感度，每次对话最多 ±2',
        parameters: {
          type: 'object',
          properties: {
            delta: { type: 'integer', minimum: -2, maximum: 2 },
            reason: { type: 'string', description: '一句话说明原因' }
          },
          required: ['delta']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'sell_item',
        description: '流浪商人专属：按商店价卖给玩家一件商品（扣金币），每次对话限 1 次',
        parameters: {
          type: 'object',
          properties: { item: { type: 'string', enum: SHOP_ITEMS } },
          required: ['item']
        }
      }
    }
  ];

  const _conv = {};   // npcId -> { aff:false, sold:false, gifts:0 }

  function usage() {
    if (!GameState.npcAiUsage || GameState.npcAiUsage.dateKey !== dayKey()) {
      GameState.npcAiUsage = { dateKey: dayKey(), quests: {}, gifts: {}, aff: {}, sold: {} };
    }
    const u = GameState.npcAiUsage;
    u.quests = u.quests || {}; u.gifts = u.gifts || {}; u.aff = u.aff || {}; u.sold = u.sold || {};
    return u;
  }

  function beginConversation(npcId) {
    _conv[npcId] = { aff: false, sold: false, gifts: 0 };
  }

  const ok = (text) => ({ ok: true, text });
  const fail = (text) => ({ ok: false, text });

  function execute(npcId, name, args) {
    const npc = (window.NpcSystem && NpcSystem.NPCS) ? NpcSystem.NPCS[npcId] : null;
    const st = (window.NpcSystem && NpcSystem.getNpcState) ? NpcSystem.getNpcState(npcId) : null;
    if (!npc || !st) return fail('失败：找不到这个 NPC');
    const u = usage();
    const conv = _conv[npcId] || (_conv[npcId] = { aff: false, sold: false, gifts: 0 });
    args = args || {};

    if (name === 'offer_quest') {
      if ((u.quests[npcId] || 0) >= 1) return fail('今天已经给过委托了');
      const list = ((npc.dialogues && npc.dialogues.quest) || npc.quest || []).filter((q) => q.questId !== st.activeQuest
        && !(st.completedQuests || []).includes(q.questId)
        && (!q.minAff || st.affection >= q.minAff));
      if (!list.length) return fail('暂无可用委托（好感或进度不够）');
      const q = list[0];
      NpcSystem.acceptQuest(npcId, q.questId);
      u.quests[npcId] = 1;
      if (typeof showToast === 'function') showToast(`${npc.name} 发布了委托`, 'info');
      return ok('委托已发布：' + q.text);
    }

    if (name === 'give_gift') {
      const item = args.item;
      const count = Math.max(1, Math.min(2, parseInt(args.count, 10) || 1));
      if (!GIFT_ITEMS.includes(item)) return fail('这个物品不能给');
      if ((u.gifts[npcId] || 0) + count > 2) return fail('今天给的够多了');
      if (typeof Warehouse === 'undefined') return fail('仓库不可用');
      const added = Warehouse.addItem(item, count);
      if (!added) return fail('背包/仓库放不下');
      u.gifts[npcId] = (u.gifts[npcId] || 0) + count;
      conv.gifts += count;
      if (typeof showToast === 'function') showToast(`${npc.name} 给了你 ${item} ×${added}`, 'success');
      return ok(`已给玩家 ${item} ×${added}`);
    }

    if (name === 'adjust_affection') {
      if (conv.aff) return fail('本次对话已经调整过好感');
      const d = Math.max(-2, Math.min(2, parseInt(args.delta, 10) || 0));
      if (!d) return fail('无需调整');
      NpcSystem.addAffection(npcId, d);
      conv.aff = true;
      return ok('好感已调整 ' + (d > 0 ? '+' : '') + d);
    }

    if (name === 'sell_item') {
      if (npcId !== 'merchant') return fail('只有商人能卖东西');
      if (conv.sold) return fail('本次对话已经交易过');
      const goods = (npc.shop || []).find((s) => s.id === args.item);
      if (!goods) return fail('没有这件商品');
      const discount = GameState.merchantDiscount || 1;
      const price = Math.round(goods.cost * discount);
      if ((GameState.gold || 0) < price) return fail('金币不足（需要 ' + price + '）');
      GameState.gold -= price;
      if (typeof Warehouse !== 'undefined') Warehouse.addItem(goods.id === 'rare_seed' ? 'seeds' : goods.id, 1);
      conv.sold = true;
      u.sold[npcId] = (u.sold[npcId] || 0) + 1;
      if (typeof showToast === 'function') showToast(`买入 ${goods.name}（-${price} 金币）`, 'gold');
      return ok(`交易完成：${goods.name}，-${price} 金币`);
    }

    return fail('不支持的操作');
  }

  window.NpcTools = { TOOLS, execute, beginConversation };
})();

