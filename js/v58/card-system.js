/* =============================================================================
 * v5.8 卡牌系统（纯逻辑，纯函数 + GameState 读写）
 * 严格遵守 docs/v58-card-spec.md §10 全部 API。
 * 浏览器挂 window.CardV58；node 下 module.exports。不操作 DOM。
 * ========================================================================== */
(function (global) {
  'use strict';

  var CARD_DATA = (typeof require === 'function')
    ? require('./card-data.js')
    : (global.CARD_DATA);

  // node 无 GameState 时使用内存兜底（单测可注入 global.GameState 接管）
  var MEM = { collection: { skill: {}, item: {}, seed: {} }, ownedBlueprints: [], captureLog: [], _v58Research: { inscribeLuck: 0 } };
  function GS() {
    return (typeof GameState !== 'undefined') ? GameState : MEM;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function _section(type) {
    if (type === 'item') return 'item';
    if (type === 'seed') return 'seed';
    return 'skill'; // skill / signature 都计入技能收藏与精通
  }
  function _coll() {
    var gs = GS();
    if (!gs.collection || typeof gs.collection !== 'object') gs.collection = { skill: {}, item: {}, seed: {} };
    if (!gs.collection.skill) gs.collection.skill = {};
    if (!gs.collection.item) gs.collection.item = {};
    if (!gs.collection.seed) gs.collection.seed = {};
    return gs.collection;
  }
  function _rec(type, defId) {
    var sec = _coll()[_section(type)];
    if (!sec[defId]) sec[defId] = { count: 0, masteryLv: 0, masteryProgress: 0 };
    return sec[defId];
  }

  var CardV58 = {
    FACTIONS: CARD_DATA.factions,
    RARITIES: CARD_DATA.rarities,
    AFFIX_CAP: { rare: 1, epic: 2, legendary: 3 }, // 可带后缀条数上限
    ITEM_DISTINCT_CAP: 6,   // 6 种
    ITEM_STACK_CAP: 5,      // 每种 5 个

    /* ---------------- 基础 ---------------- */
    getDef: function (type, defId) {
      var bucket;
      if (type === 'skill') bucket = CARD_DATA.skills;
      else if (type === 'item') bucket = CARD_DATA.items;
      else if (type === 'seed') bucket = CARD_DATA.seeds;
      else if (type === 'signature') bucket = CARD_DATA.signatures;
      else return null;
      return (bucket && bucket[defId]) || null;
    },

    makeCard: function (type, defId, opts) {
      opts = opts || {};
      var def = this.getDef(type, defId);
      if (!def) return null;
      var rarity = opts.rarity && CARD_DATA.rarities[opts.rarity] ? opts.rarity : (def.rarity || 'common');
      var affixes = Array.isArray(opts.affixes) ? opts.affixes.slice() : [];
      var tags = (def.tags || []).slice();
      affixes.forEach(function (a) {
        var ad = CARD_DATA.affixes[a];
        if (ad && ad.tag && tags.indexOf(ad.tag) < 0) tags.push(ad.tag);
      });
      return {
        uid: opts.uid || ('inst_' + Date.now() + '_' + Math.floor(Math.random() * 1e6)),
        type: type,
        defId: defId,
        rarity: rarity,
        masteryLv: clamp(opts.masteryLv || 0, 0, 5),
        affixes: affixes,
        tags: tags,
        count: Math.max(1, Math.floor(opts.count || 1)),
        acquiredFrom: opts.acquiredFrom || 'craft'
      };
    },

    /* ---------------- 协同 ---------------- */
    _factionOfWeapon: function (w) {
      var wid = (typeof w === 'string') ? w : (w && (w.weaponId || w.defId));
      return CARD_DATA.weapons[wid] || null;
    },
    _factionOfEntry: function (entry, fallbackType) {
      if (!entry) return null;
      if (typeof entry === 'string') {
        // 武器 id 走 WEAPON_TAGS；其余按 fallbackType 解析
        if (fallbackType === 'weapon') return CARD_DATA.weapons[entry] || null;
        var def = this.getDef(fallbackType, entry);
        return def ? def.element : null;
      }
      if (entry.element) return entry.element;
      if (entry.weaponId) return CARD_DATA.weapons[entry.weaponId] || null;
      if (entry.defId) {
        var d = this.getDef(entry.type || fallbackType, entry.defId);
        return d ? d.element : null;
      }
      return null;
    },

    loadoutTags: function (loadout) {
      loadout = loadout || {};
      var counts = {};
      var self = this;
      function add(f) { if (f) counts[f] = (counts[f] || 0) + 1; }
      (loadout.weapons || []).forEach(function (w) { add(self._factionOfWeapon(w)); });
      (loadout.skills || []).forEach(function (s) { add(self._factionOfEntry(s, 'skill')); });
      (loadout.items || []).forEach(function (i) { add(self._factionOfEntry(i, 'item')); });
      (loadout.seeds || []).forEach(function (s) { add(self._factionOfEntry(s, 'seed')); });
      return counts;
    },

    synergyState: function (loadout) {
      var counts = this.loadoutTags(loadout);
      var tags = {};
      var buffs = [];
      Object.keys(counts).forEach(function (f) {
        var n = counts[f];
        var milestones = (CARD_DATA.synergy.factions[f] || []).filter(function (m) { return n >= m.at; });
        tags[f] = { count: n, active: milestones.map(function (m) { return m.id; }) };
        milestones.forEach(function (m) { buffs.push({ faction: f, at: m.at, id: m.id, name: m.name, desc: m.desc, mods: m.mods }); });
      });
      return { tags: tags, buffs: buffs };
    },

    synergyMods: function (loadout) {
      var st = this.synergyState(loadout);
      var out = {};
      function merge(mods) {
        Object.keys(mods || {}).forEach(function (k) {
          var v = mods[k];
          if (v && typeof v === 'object' && !Array.isArray(v)) {
            out[k] = out[k] || {};
            Object.keys(v).forEach(function (kk) { out[k][kk] = (out[k][kk] || 0) + v[kk]; });
          } else {
            out[k] = (out[k] || 0) + v;
          }
        });
      }
      st.buffs.forEach(function (b) { merge(b.mods); });
      return out;
    },

    /* ---------------- 精通 ---------------- */
    _keyParse: function (key) {
      if (key && typeof key === 'object') {
        return { type: key.type || 'skill', defId: key.defId };
      }
      var s = String(key);
      var idx = s.indexOf(':');
      if (idx > 0) return { type: s.slice(0, idx), defId: s.slice(idx + 1) };
      return { type: 'skill', defId: s };
    },
    getMastery: function (key) {
      var p = this._keyParse(key);
      return _rec(p.type, p.defId).masteryLv;
    },
    setMastery: function (key, lv) {
      var p = this._keyParse(key);
      _rec(p.type, p.defId).masteryLv = clamp(Math.floor(lv) || 0, 0, 5);
      return _rec(p.type, p.defId).masteryLv;
    },
    addMasteryProgress: function (key, amt) {
      var p = this._keyParse(key);
      var rec = _rec(p.type, p.defId);
      rec.masteryProgress += (amt || 0);
      rec.masteryProgress = Math.round(rec.masteryProgress * 1000) / 1000; // 消除浮点累积漂移
      while (rec.masteryProgress >= 1 && rec.masteryLv < 5) {
        rec.masteryProgress -= 1;
        rec.masteryLv += 1;
      }
      if (rec.masteryLv >= 5) rec.masteryProgress = Math.min(rec.masteryProgress, 1);
      return rec.masteryLv;
    },
    skillEffectiveLevel: function (skillId) {
      // 桥接旧 getSkillStats：有效等级 = 1 + 精通（1..6）
      return 1 + this.getMastery('skill:' + skillId);
    },

    /* ---------------- 附魔词条 ---------------- */
    rollAffix: function (rarity, rng) {
      var pool = Object.keys(CARD_DATA.affixes).filter(function (id) {
        var a = CARD_DATA.affixes[id];
        return CARD_DATA.rarities[a.minRarity] && CARD_DATA.rarities[a.minRarity].power <= CARD_DATA.rarities[rarity].power;
      });
      if (!pool.length) return null;
      var r = (rng || Math.random)();
      return pool[Math.floor(r * pool.length) % pool.length];
    },
    affixMods: function (card) {
      var out = {};
      (card.affixes || []).forEach(function (id) {
        var a = CARD_DATA.affixes[id];
        if (!a || !a.mods) return;
        Object.keys(a.mods).forEach(function (k) {
          var v = a.mods[k];
          if (v && typeof v === 'object' && !Array.isArray(v)) {
            out[k] = out[k] || {};
            Object.keys(v).forEach(function (kk) { out[k][kk] = (out[k][kk] || 0) + v[kk]; });
          } else {
            out[k] = (out[k] || 0) + v;
          }
        });
      });
      return out;
    },

    cardStats: function (card) {
      var lv = (card && card.masteryLv) || 0;
      // 精通每级：伤害/治疗/护盾 +18%，冷却 -5%
      var out = {
        dmgMult: 0.18 * lv,
        healMult: 0.18 * lv,
        shieldMult: 0.18 * lv,
        cdr: 0.05 * lv
      };
      var am = this.affixMods(card);
      Object.keys(am).forEach(function (k) {
        var v = am[k];
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          out[k] = out[k] || {};
          Object.keys(v).forEach(function (kk) { out[k][kk] = (out[k][kk] || 0) + v[kk]; });
        } else {
          out[k] = (out[k] || 0) + v;
        }
      });
      return out;
    },

    describe: function (card) {
      var def = this.getDef(card.type, card.defId);
      if (!def) return '未知卡';
      var parts = [def.name, '·' + (CARD_DATA.rarities[card.rarity] || {}).name];
      if (card.masteryLv > 0) parts.push('精通Lv' + card.masteryLv);
      var mods = this.cardStats(card);
      var tail = [];
      if (mods.dmgMult) tail.push('伤害+' + Math.round(mods.dmgMult * 100) + '%');
      if (mods.cdr) tail.push('冷却-' + Math.round(mods.cdr * 100) + '%');
      (card.affixes || []).forEach(function (id) {
        var a = CARD_DATA.affixes[id]; if (a) tail.push(a.name);
      });
      return parts.join('') + (tail.length ? '（' + tail.join('，') + '）' : '');
    },

    /* ---------------- 夺卡（§7：只给 升级/道具/种子 三类） ---------------- */
    rollCapture: function (ctx) {
      ctx = ctx || {};
      var rng = ctx.rng || Math.random;
      var self = this;
      var existing = (ctx.existingCards || []).slice();
      var choices = [];

      // ① 升级现有卡（精通/附魔）
      var upTarget = existing.length ? existing[Math.floor(rng() * existing.length)] : null;
      choices.push({
        kind: 'upgrade',
        card: upTarget,
        grey: !upTarget,
        reason: upTarget ? '' : '无可用卡可升级'
      });

      // ② 道具卡（受 6 种 ×5 上限约束，满则置灰）
      var itemIds = Object.keys(CARD_DATA.items);
      var pickItem = itemIds[Math.floor(rng() * itemIds.length)];
      var distinctTypes = ctx.distinctItemTypes || 0;
      var itemCount = ctx.itemCounts && ctx.itemCounts[pickItem] || 0;
      var itemFull = (distinctTypes >= this.ITEM_DISTINCT_CAP && !ctx.itemCounts[pickItem]) || itemCount >= this.ITEM_STACK_CAP;
      choices.push({
        kind: 'item',
        defId: itemFull ? null : pickItem,
        grey: !!itemFull,
        reason: itemFull ? '道具位已满（6种×5）' : ''
      });

      // ③ 种子卡
      var seedIds = Object.keys(CARD_DATA.seeds);
      choices.push({
        kind: 'seed',
        defId: seedIds[Math.floor(rng() * seedIds.length)],
        grey: false,
        reason: ''
      });

      return { choices: choices };
    },

    applyCapture: function (choice, ctx) {
      ctx = ctx || {};
      if (!choice || choice.grey) return { ok: false, reason: choice && choice.reason || '不可选' };
      var rec;
      if (choice.kind === 'upgrade') {
        if (!choice.card) return { ok: false, reason: '无卡可升级' };
        var lv = this.addMasteryProgress({ type: choice.card.type, defId: choice.card.defId }, 0.5);
        return { ok: true, kind: 'upgrade', masteryLv: lv };
      }
      if (choice.kind === 'item') {
        rec = _rec('item', choice.defId);
        if (rec.count >= this.ITEM_STACK_CAP) return { ok: false, reason: '该道具已叠满' };
        rec.count += 1;
        return { ok: true, kind: 'item', defId: choice.defId };
      }
      if (choice.kind === 'seed') {
        rec = _rec('seed', choice.defId);
        rec.count += 1;
        return { ok: true, kind: 'seed', defId: choice.defId };
      }
      return { ok: false, reason: '未知类型' };
    },

    /* ---------------- 撤离 / 死亡 ---------------- */
    inscribeRoll: function (card, rng) {
      var def = this.getDef(card.type, card.defId);
      // Boss 蓝图/签名卡必成
      if (def && (def.signature || def.blueprint)) return true;
      var rate = (CARD_DATA.rarities[card.rarity] || {}).inscribe || 0;
      var luck = (GS()._v58Research && GS()._v58Research.inscribeLuck) || 0;
      return (rng || Math.random)() < (rate + luck);
    },

    // 重复副本折算为精通进度（§8：重复卡转精通进度）。每级阈值=1.0 进度（Lv0→Lv5 共 5.0）。
    // 稀有度越高，每张重复副本给的进度越多。
    // 经济模型见 tools/mastery-economy.js：Boss 蓝图技能满级从 ≈68 局压到 ≈22.5 局（3×）。
    DUPLICATE_MASTERY_PROGRESS: { common: 0.30, rare: 0.60, epic: 1.05, legendary: 1.50 },

    onExtract: function (ctx) {
      ctx = ctx || {};
      var self = this;
      var inscribed = [], dropped = [], firstAcquire = [], duplicates = [];
      (ctx.loot || []).forEach(function (card) {
        if (self.inscribeRoll(card, ctx.rng)) {
          var rec = _rec(card.type, card.defId);
          if (rec.count <= 0) {
            // 首次获得：入收藏
            rec.count = 1;
            firstAcquire.push(card.defId);
          } else {
            // 重复副本：折算为精通进度（不再单纯 count+1）
            var amt = self.DUPLICATE_MASTERY_PROGRESS[card.rarity] || 0.10;
            self.addMasteryProgress({ type: card.type, defId: card.defId }, amt);
            rec.duplicateTally = (rec.duplicateTally || 0) + 1; // 仅统计
            duplicates.push(card.defId);
          }
          inscribed.push(card.defId);
        } else {
          dropped.push(card.defId);
        }
      });
      // 安全箱内容必保留
      var safeBoxKept = (ctx.safeBox || []).slice();
      var log = GS().captureLog || (GS().captureLog = []);
      log.push({ t: Date.now(), event: 'extract', inscribed: inscribed, dropped: dropped });
      return { inscribed: inscribed, dropped: dropped, safeBoxKept: safeBoxKept, firstAcquire: firstAcquire, duplicates: duplicates };
    },

    onDeath: function (ctx) {
      ctx = ctx || {};
      var gs = GS();
      var safeSlots = clamp(Number(gs.safeBoxSlots || gs.safeSlots || 1), 1, 3);
      // 安全箱前 safeSlots 格必保留
      var safeBoxKept = (ctx.safeBox || []).slice(0, safeSlots);
      // 带入消耗品/种子/武器实例丢失；局内战利品全丢
      var lost = {
        items: (ctx.carriedItems || []).slice(),
        seeds: (ctx.carriedSeeds || []).slice(),
        weapons: (ctx.broughtWeapons || []).slice(),
        tempLoot: (ctx.tempLoot || []).slice()
      };
      // 50% 概率降级；免死令自动免除
      var roll = (ctx.rng || Math.random)();
      var downgrade = roll < 0.5;
      var pardonUsed = false;
      if (downgrade && ctx.hasDeathPardon) { downgrade = false; pardonUsed = true; }
      // 硬核实体卡全损（开关）
      var hardcore = !!gs.hardcoreFullLoss;
      if (hardcore) {
        // 收藏里的物理卡全损（技能收藏与精通仍保留，见契约 §8）
        var coll = _coll();
        ['item', 'seed'].forEach(function (sec) {
          Object.keys(coll[sec]).forEach(function (id) { coll[sec][id].count = 0; });
        });
        // 硬核模式下安全箱中的实体卡也不保留；非卡牌物资仍按安全箱规则保留。
        safeBoxKept = safeBoxKept.filter(function (item) {
          return !(item && (item.type === 'card' || item.cardType || item.defId));
        });
      }
      // 技能收藏与精通永不丢失：不触碰 collection.skill
      var log = gs.captureLog || (gs.captureLog = []);
      log.push({ t: Date.now(), event: 'death', downgrade: downgrade, pardonUsed: pardonUsed });
      return {
        safeBoxKept: safeBoxKept,
        lost: lost,
        downgrade: downgrade,
        pardonUsed: pardonUsed,
        hardcore: hardcore,
        skillCollectionKept: true
      };
    },

    /* ---------------- 工坊四工位 ---------------- */
    _pay: function (cost) {
      cost = cost || {};
      var gs = GS();
      if (typeof gs.gold === 'number' && cost.gold) {
        if (gs.gold < cost.gold) return false;
        gs.gold -= cost.gold;
      }
      var mats = cost.materials || {};
      var wh = gs.warehouse && gs.warehouse.materials || {};
      Object.keys(mats).forEach(function (m) { wh[m] = (wh[m] || 0) - mats[m]; });
      return true;
    },
    canPrint: function (recipe) {
      recipe = recipe || {};
      var cost = recipe.cost || {};
      var gs = GS();
      if (typeof gs.gold === 'number' && cost.gold && gs.gold < cost.gold) return false;
      var wh = gs.warehouse && gs.warehouse.materials || gs.materials || {};
      var mats = cost.materials || {};
      for (var m in mats) { if ((wh[m] || 0) < mats[m]) return false; }
      if (!this.getDef(recipe.type, recipe.defId)) return false;
      return true;
    },
    print: function (recipe) {
      if (!this.canPrint(recipe)) return { ok: false, reason: '材料或图纸不足' };
      this._pay(recipe.cost || {});
      var rec = _rec(recipe.type, recipe.defId);
      rec.count += 1;
      var card = this.makeCard(recipe.type, recipe.defId, { acquiredFrom: 'print' });
      return { ok: true, card: card, count: rec.count };
    },
    enchant: function (card, affixId) {
      if (!card || !CARD_DATA.affixes[affixId]) return null;
      card.affixes = card.affixes || [];
      if (card.affixes.indexOf(affixId) < 0) card.affixes.push(affixId);
      var ad = CARD_DATA.affixes[affixId];
      if (ad.tag && card.tags.indexOf(ad.tag) < 0) card.tags.push(ad.tag);
      return card;
    },
    fuse: function (cardUids) {
      // 5 合 1：消耗 5 张同类 → 目标卡精通进度 +1
      var list = (cardUids || []).slice();
      if (list.length < 5) return { ok: false, reason: '需要 5 张卡融合' };
      var target = list[0];
      if (target && typeof target === 'object' && target.defId) {
        var lv = this.addMasteryProgress({ type: target.type, defId: target.defId }, 1);
        return { ok: true, masteryLv: lv, consumed: list.length };
      }
      return { ok: false, reason: '无效目标' };
    },
    research: function (recipe) {
      // 铭记研究：消耗材料永久提升铭记幸运（最多 +15%）
      recipe = recipe || {};
      var gs = GS();
      gs._v58Research = gs._v58Research || { inscribeLuck: 0 };
      if (gs._v58Research.inscribeLuck >= 0.15) return { ok: false, reason: '研究已满' };
      if (!this._pay(recipe.cost || {})) return { ok: false, reason: '材料不足' };
      gs._v58Research.inscribeLuck = Math.min(0.15, gs._v58Research.inscribeLuck + 0.05);
      return { ok: true, inscribeLuck: gs._v58Research.inscribeLuck };
    },

    /* ---------------- 迁移（旧 cardInventory / skillLevels → 新收藏与精通） ---------------- */
    migrate: function () {
      var gs = GS();
      if (gs._v58Migrated) return { ok: true, migrated: false };
      _coll();
      // 旧 skillLevels {id: lv(1..8)} → 精通 = clamp(floor(lv-1),0,5)
      if (gs.skillLevels && typeof gs.skillLevels === 'object') {
        var self = this;
        Object.keys(gs.skillLevels).forEach(function (sid) {
          var oldLv = Number(gs.skillLevels[sid]) || 1;
          if (!CARD_DATA.skills[sid]) return;
          self.setMastery('skill:' + sid, clamp(Math.floor(oldLv - 1), 0, 5));
        });
      }
      // 旧 cardInventory 强化卡 [{skillId, power}] → 精通进度
      if (Array.isArray(gs.cardInventory)) {
        var self2 = this;
        gs.cardInventory.forEach(function (c) {
          if (c && c.skillId && CARD_DATA.skills[c.skillId]) {
            self2.addMasteryProgress('skill:' + c.skillId, (c.power || 1) * 0.5);
          }
        });
      }
      gs._v58Migrated = true;
      return { ok: true, migrated: true };
    },

    /* ---------------- 测试辅助 ---------------- */
    _reset: function () {
      MEM = { collection: { skill: {}, item: {}, seed: {} }, ownedBlueprints: [], captureLog: [], _v58Research: { inscribeLuck: 0 } };
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CardV58;
  if (typeof global !== 'undefined') global.CardV58 = CardV58;
  if (typeof window !== 'undefined') window.CardV58 = CardV58;
})(typeof globalThis !== 'undefined' ? globalThis : this);
