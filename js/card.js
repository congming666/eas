/* =============================================================================
 * v5.8 卡牌收藏 / 牌组装载器 / 卡牌工坊（COLLECTION 代理）
 * - getSkillStats 桥接：精通(=旧 skillLevels 语义) + 装备卡附魔词条
 * - 统一面板：收藏 + 装载(协同/能耗/战力/克制) + 工坊四工位
 * - 旧 cardInventory 强化卡并行 UI 已并入精通/附魔（兼容 farm.js 旧调用）
 * 仅依赖 window.CardV58 / window.CARD_DATA（在本文件之后加载，调用时再取）。
 * ========================================================================== */
(function () {
  'use strict';

  /* --------------------------------------------------------------------- *
   *  一、getSkillStats 桥接 helpers（挂 window.__v58Bridge 供 ui.js / v5.js）
   * --------------------------------------------------------------------- */

  // 有效基础等级：1 + 精通（CardV58.skillEffectiveLevel）；无 CardV58 时回退旧 skillLevels
  function bridgeBaseLevel(skillId) {
    try {
      if (typeof CardV58 !== 'undefined' && CardV58.skillEffectiveLevel) {
        var lv = CardV58.skillEffectiveLevel(skillId); // 1..6
        // 回写 skillLevels，保证旧读取点（skillLevelOf / 修行台 / v5.js:1927）一致
        if (typeof GameState !== 'undefined' && GameState.skillLevels) {
          GameState.skillLevels[skillId] = lv;
        }
        return lv;
      }
    } catch (e) { /* fall through */ }
    return (typeof GameState !== 'undefined' && GameState.skillLevels)
      ? (GameState.skillLevels[skillId] || 1) : 1;
  }

  // 装备在该技能上的附魔词条 mods（仅词条，不含精通；无词条返回 null）
  function bridgeAffixMods(skillId) {
    try {
      if (typeof CardV58 !== 'undefined' && CardV58.affixMods &&
        typeof GameState !== 'undefined' && GameState.collection &&
        GameState.collection.skill && GameState.collection.skill[skillId]) {
        var rec = GameState.collection.skill[skillId];
        if (rec.affixes && rec.affixes.length) {
          return CardV58.affixMods({ affixes: rec.affixes });
        }
      }
    } catch (e) { /* noop */ }
    return null;
  }

  // 把词条 mods 应用到 getSkillStats 输出对象 s（原地）
  function bridgeApplyAffix(s, am) {
    if (!s || !am) return;
    if (am.dmgMult) {
      ['dmg', 'burn', 'dot', 'hot', 'thornsDps', 'jumps'].forEach(function (k) {
        if (typeof s[k] === 'number' && s[k]) s[k] = Math.round(s[k] * (1 + am.dmgMult));
      });
    }
    if (am.shieldHealMult) {
      if (typeof s.shield === 'number' && s.shield) s.shield = Math.round(s.shield * (1 + am.shieldHealMult));
      if (typeof s.hot === 'number' && s.hot) s.hot = Math.round(s.hot * (1 + am.shieldHealMult));
    }
    if (am.cdr && typeof s.cooldown === 'number') {
      s.cooldown = +(s.cooldown * (1 - Math.min(0.6, am.cdr))).toFixed(2);
    }
    if (am.costDown && typeof s.energyCost === 'number') {
      s.energyCost = Math.max(8, Math.round(s.energyCost * (1 - am.costDown)));
    }
    if (am.rangeMult && typeof s.range === 'number' && s.range) {
      s.range = Math.round(s.range * (1 + am.rangeMult));
    }
    if (am.durationMult && typeof s.duration === 'number' && s.duration) {
      s.duration = +(s.duration * (1 + am.durationMult)).toFixed(2);
    }
    s.affixMods = am; // 透传给战斗层（暴击/再触发/附加元素等）
  }

  window.__v58Bridge = { baseLevel: bridgeBaseLevel, affixModsFor: bridgeAffixMods, applyAffix: bridgeApplyAffix };

  // 防御性：确保迁移只跑一次（save.js 已守卫，这里兜底）
  function ensureMigrated() {
    try {
      if (typeof CardV58 !== 'undefined' && typeof GameState !== 'undefined' && !GameState._v58Migrated) {
        CardV58.migrate();
        GameState._v58Migrated = true;
      }
    } catch (e) { /* noop */ }
  }

  /* --------------------------------------------------------------------- *
   *  二、常量与工具
   * --------------------------------------------------------------------- */
  var RARITY_NAME = { common: '普通', rare: '稀有', epic: '史诗', legendary: '传说' };
  var FACTION_NAME = {
    fire: '烈焰燃烧', ice: '寒冰控制', lightning: '雷鸣连锁', poison: '剧毒蔓延',
    summon: '召唤园艺', bleed: '流血处决', armor: '铁甲坚守', wind: '疾风机动'
  };
  var FACTION_ORDER = ['fire', 'ice', 'lightning', 'poison', 'summon', 'bleed', 'armor', 'wind'];

  function cdata() { return (typeof CARD_DATA !== 'undefined') ? CARD_DATA : null; }
  function cardV() { return (typeof CardV58 !== 'undefined') ? CardV58 : null; }

  // 已拥有的收藏记录：skill/item/seed → {count, masteryLv, masteryProgress, affixes?, tags?}
  function recOf(type, defId) {
    var gs = (typeof GameState !== 'undefined') ? GameState : null;
    if (!gs || !gs.collection) return null;
    var sec = type === 'item' ? gs.collection.item : (type === 'seed' ? gs.collection.seed : gs.collection.skill);
    return sec ? (sec[defId] || null) : null;
  }
  function ensureRec(type, defId) {
    var C = cardV(); if (!C) return null;
    // 走 CardV58 的内部记录器语义：借 getDef + 直接建记录
    var gs = GameState;
    if (!gs.collection) gs.collection = { skill: {}, item: {}, seed: {} };
    var sec = type === 'item' ? gs.collection.item : (type === 'seed' ? gs.collection.seed : gs.collection.skill);
    if (!sec[defId]) sec[defId] = { count: 0, masteryLv: 0, masteryProgress: 0, affixes: [], tags: [] };
    if (!Array.isArray(sec[defId].affixes)) sec[defId].affixes = [];
    return sec[defId];
  }

  function matName(id) {
    var r = (typeof CONFIG !== 'undefined' && CONFIG.resources && CONFIG.resources[id]);
    return r ? (r.icon || '') + r.name : id;
  }
  function haveMat(id) {
    if (id === 'gold') return (typeof GameState !== 'undefined') ? (GameState.gold || 0) : 0;
    if (typeof ResourceSystem !== 'undefined') return ResourceSystem.count(id);
    var wh = (typeof GameState !== 'undefined' && GameState.warehouse && GameState.warehouse.materials) || {};
    return wh[id] || 0;
  }
  function payCost(cost) {
    // 金币单独校验扣减；材料解包 cost.materials（兼容扁平写法）
    cost = cost || {};
    var gold = cost.gold || 0;
    var mats = (cost.materials && typeof cost.materials === 'object') ? Object.assign({}, cost.materials) : {};
    Object.keys(cost).forEach(function (k) { if (k !== 'gold' && k !== 'materials') mats[k] = cost[k]; });
    if (gold && (GameState.gold || 0) < gold) return false;
    if (typeof ResourceSystem !== 'undefined') {
      if (!ResourceSystem.pay(mats)) return false;
    } else {
      var wh = (GameState.warehouse = GameState.warehouse || {}); wh.materials = wh.materials || {};
      for (var k in mats) { if ((wh.materials[k] || 0) < mats[k]) return false; wh.materials[k] -= mats[k]; }
    }
    if (gold) GameState.gold -= gold;
    return true;
  }
  function costText(cost) {
    var parts = [];
    if (cost.gold) parts.push('💰' + cost.gold);
    var mats = (cost.materials && typeof cost.materials === 'object') ? cost.materials : {};
    Object.keys(mats).forEach(function (k) {
      parts.push(matName(k) + '×' + mats[k] + (haveMat(k) >= mats[k] ? '' : '(缺)'));
    });
    return parts.join(' ');
  }

  /* --------------------------------------------------------------------- *
   *  三、装载 / 协同计算
   * --------------------------------------------------------------------- */
  // 组装当前牌组：武器 + 已装备技能 + 携带道具 + 携带种子
  function buildLoadout() {
    ensureMigrated();
    var gs = (typeof GameState !== 'undefined') ? GameState : {};
    var weapons = (gs.loadoutWeaponUids || []).map(function (uid) {
      var inst = (gs.weaponInstances || []).find(function (w) { return w.uid === uid; });
      return inst ? inst.weaponId : null;
    }).filter(Boolean);
    var skills = (gs.equippedSkills || []).slice();
    var items = Object.keys(gs.loadout || {}).filter(function (k) { return (gs.loadout[k] || 0) > 0; });
    var seeds = (gs.carriedSeeds || []).map(function (c) { return c.type; });
    return { weapons: weapons, skills: skills, items: items, seeds: seeds };
  }

  // 解析一个条目所属流派（兼容技能/道具/种子/武器 id）
  function factionOfEntry(id, kind) {
    var C = cdata(); if (!C) return null;
    if (kind === 'weapon') return C.weapons[id] || null;
    var def = null;
    if (kind === 'skill') def = C.skills[id];
    else if (kind === 'item') def = C.items[id];
    else if (kind === 'seed') def = C.seeds[id];
    if (def) return def.element || null;
    // 种子：carriedSeeds 存的是 deployId，反查作物
    if (typeof CONFIG !== 'undefined' && CONFIG.cropToDeploy) {
      var cropId = Object.keys(CONFIG.cropToDeploy).find(function (c) { return CONFIG.cropToDeploy[c] === id; });
      if (cropId && C.seeds[cropId]) return C.seeds[cropId].element;
    }
    return null;
  }

  function computeSynergy() {
    var lo = buildLoadout();
    var counts = {};
    function add(f) { if (f) counts[f] = (counts[f] || 0) + 1; }
    lo.weapons.forEach(function (w) { add(factionOfEntry(w, 'weapon')); });
    lo.skills.forEach(function (s) { add(factionOfEntry(s, 'skill')); });
    lo.items.forEach(function (i) { add(factionOfEntry(i, 'item')); });
    lo.seeds.forEach(function (s) { add(factionOfEntry(s, 'seed')); });

    var C = cdata();
    var tags = {};
    var buffs = [];
    FACTION_ORDER.forEach(function (f) {
      var n = counts[f] || 0;
      var ms = (C && C.synergy && C.synergy.factions[f] || []).filter(function (m) { return n >= m.at; });
      tags[f] = { count: n, active: ms.map(function (m) { return m.id; }) };
      ms.forEach(function (m) { buffs.push({ faction: f, at: m.at, name: m.name, desc: m.desc }); });
    });

    // 平均能耗：已装备技能 energyCost
    var energySum = 0, energyN = 0;
    lo.skills.forEach(function (sid) {
      var sk = (typeof CONFIG !== 'undefined' && CONFIG.skills.find) ? CONFIG.skills.find(function (x) { return x.id === sid; }) : null;
      if (sk && typeof getSkillStats === 'function') {
        try { var st = getSkillStats(sk, 0); if (st && st.energyCost) { energySum += st.energyCost; energyN++; } } catch (e) {}
      }
    });
    var avgEnergy = energyN ? Math.round(energySum / energyN) : 0;

    // 战力评分（启发式）：技能(伤害类) + 道具数量 + 协同里程碑数
    var power = 0;
    lo.skills.forEach(function (sid) {
      var sk = (typeof CONFIG !== 'undefined' && CONFIG.skills.find) ? CONFIG.skills.find(function (x) { return x.id === sid; }) : null;
      if (sk) {
        try { var st = getSkillStats(sk, 0); power += Math.round((st.damage || st.hot || st.shield || 0) * 1.2 + (200 - (st.cooldown || 5)) * 0.5); } catch (e) { power += 20; }
      }
    });
    power += itemsCount(lo) * 6;
    power += buffs.length * 25;

    // 推荐 Tier
    var tier = power >= 420 ? 4 : power >= 260 ? 3 : power >= 140 ? 2 : 1;

    // 主流派 & 克制
    var dominant = null, max = 0;
    FACTION_ORDER.forEach(function (f) { if (counts[f] > max) { max = counts[f]; dominant = f; } });
    var counter = (C && C.factions[dominant]) ? C.factions[dominant].counterTo : null; // 我克谁
    // 谁克我：反向环
    var counteredBy = null;
    if (C) for (var f in C.factions) { if (C.factions[f].counterTo === dominant) counteredBy = f; }

    return { loadout: lo, counts: counts, tags: tags, buffs: buffs, avgEnergy: avgEnergy, power: power, tier: tier, dominant: dominant, counter: counter, counteredBy: counteredBy };
  }
  function itemsCount(lo) {
    lo = lo || buildLoadout();
    return Object.keys(lo.items || {}).length;
  }

  /* --------------------------------------------------------------------- *
   *  四、工坊配方
   * --------------------------------------------------------------------- */
  // 印制：消耗卡牌纸(fiber+清水) / 墨汁(venom+herb) + 金币，产出收藏计数
  function printRecipeFor(type, defId) {
    var C = cdata(); if (!C) return null;
    var def = C.skills[defId] || C.items[defId] || C.seeds[defId];
    if (!def) return null;
    var rar = def.rarity || 'common';
    var base = { gold: 30, materials: { fiber: 2, water: 1 } };
    if (rar === 'rare') { base.gold = 80; base.materials = { fiber: 3, water: 2, venom: 1 }; }
    else if (rar === 'epic') { base.gold = 200; base.materials = { fiber: 4, water: 3, venom: 2, crystal: 1 }; }
    else if (rar === 'legendary') { base.gold = 500; base.materials = { fiber: 6, water: 4, venom: 3, crystal: 2, bossFang: 1 }; }
    return { type: type, defId: defId, cost: base, rarity: rar, name: def.name, icon: def.icon };
  }

  /* --------------------------------------------------------------------- *
   *  五、CardSystem（对外兼容 + 新统一面板）
   * --------------------------------------------------------------------- */
  var CardSystem = window.CardSystem = {
    rarityNames: RARITY_NAME,
    rarityPower: { common: 1, rare: 2, epic: 3, legendary: 4 },

    // ---- 旧 harvest 掉落兼容（farm.js 调用 createCard / tryDrop / showDrop） ----
    createCard(crop) {
      // 直接折算为该技能的精通进度，不再产出游离强化卡
      var skillId = crop.upgradeSkill && crop.upgradeSkill !== 'all' ? crop.upgradeSkill : null;
      var power = 1;
      var roll = Math.random();
      var rarity = 'common';
      if (crop.rarity === 'legendary') { rarity = roll < 0.42 ? 'legendary' : (roll < 0.86 ? 'rare' : 'common'); }
      else if (crop.rarity === 'rare') { rarity = roll < 0.06 ? 'legendary' : (roll < 0.38 ? 'rare' : 'common'); }
      else { rarity = roll < 0.12 ? 'rare' : 'common'; }
      power = this.rarityPower[rarity] || 1;
      if (skillId && cardV()) {
        cardV().addMasteryProgress('skill:' + skillId, power * 0.5);
      }
      var skill = (typeof CONFIG !== 'undefined' && CONFIG.skills && CONFIG.skills.find) ? CONFIG.skills.find(function (s) { return s.id === skillId; }) : null;
      return {
        id: 'card_' + Date.now() + '_' + Math.floor(Math.random() * 1e5),
        rarity: rarity, power: power, skillId: skillId, icon: crop.icon,
        name: (skill ? skill.name : (crop.name || '作物')) + '·精通',
        desc: '精通进度 +' + (power * 0.5).toFixed(1)
      };
    },
    tryDrop(crop) {
      if (Math.random() >= (crop.cardChance || 0)) return null;
      var card = this.createCard(crop);
      this.showDrop(card);
      try { if (typeof SaveSystem !== 'undefined') SaveSystem.save(); } catch (e) {}
      return card;
    },
    showDrop(card) {
      var container = document.getElementById('cardDropContainer');
      if (!container) return;
      var banner = document.createElement('div');
      banner.className = 'card-drop-banner ' + (card.rarity || 'common');
      var skill = (card.skillId && typeof CONFIG !== 'undefined' && CONFIG.skills && CONFIG.skills.find) ? CONFIG.skills.find(function (s) { return s.id === card.skillId; }) : null;
      var label = skill ? ('「' + skill.name + '」精通进度提升') : (card.name || '卡牌');
      banner.innerHTML = '<div style="color:#f3d68d;font-size:10px;">收获掉落 · ' + (RARITY_NAME[card.rarity] || '') + '</div>'
        + '<div style="font-size:16px;font-weight:800;margin-top:3px;display:flex;align-items:center;gap:6px;justify-content:center;">' + (card.icon || '🃏') + ' ' + label + '</div>'
        + '<div style="font-size:10px;color:#b8c9c0;margin-top:3px;">已计入收藏精通</div>';
      container.appendChild(banner);
      setTimeout(function () { banner.remove(); }, 3100);
    },

    // ---- 旧并行 UI 空壳（外部可能调用，保留不报错） ----
    apply() {},
    getSelectedBoosts() { return {}; },
    toggleBoost() {},
    renderBoostSelection() {},
    countByRarity() { return 0; },
    makeCardOfRarity() { return null; },
    combineCards() {},
    renderSynth() {},

    /* ===================== 新统一面板 ===================== */
    _tab: 'loadout',
    _enchantSel: null,

    open() {
      ensureMigrated();
      var m = document.getElementById('cardWorkshopModal');
      if (m) m.classList.remove('hidden');
      this.renderWorkshop();
    },
    close() {
      var m = document.getElementById('cardWorkshopModal');
      if (m) m.classList.add('hidden');
    },
    switchTab(t) { this._tab = t; this.renderWorkshop(); },

    renderWorkshop() {
      ensureMigrated();
      var win = document.querySelector('#cardWorkshopModal .workshop-window');
      if (!win) return;
      var self = this;
      var sy = computeSynergy();

      win.innerHTML = '';
      var header = document.createElement('div');
      header.className = 'workshop-header v58-header';
      header.innerHTML = '<div><h2>🃏 牌阵觉醒 · 收藏 / 装载 / 工坊</h2>'
        + '<p>精通每级：伤害/治疗/护盾 +18%、冷却 -5%；附魔追加后缀词条。武器普攻始终独立可用。</p></div>'
        + '<button class="secondary-btn" onclick="Game.closeCardWorkshop()">关闭</button>';
      win.appendChild(header);

      // Tab 条
      var tabBar = document.createElement('div');
      tabBar.className = 'v58-tabbar';
      [['loadout', '牌组装载'], ['collection', '收藏'], ['workshop', '卡牌工坊']].forEach(function (t) {
        var b = document.createElement('button');
        b.className = 'v58-tab' + (self._tab === t[0] ? ' active' : '');
        b.textContent = t[1];
        b.onclick = function () { self.switchTab(t[0]); };
        tabBar.appendChild(b);
      });
      win.appendChild(tabBar);

      var body = document.createElement('div');
      body.className = 'v58-body';
      win.appendChild(body);

      if (this._tab === 'loadout') this._renderLoadout(body, sy);
      else if (this._tab === 'collection') this._renderCollection(body, sy);
      else this._renderWorkshopStation(body, sy);
    },

    /* ---------- 装载页：协同 / 能耗 / 战力 / 克制 ---------- */
    _renderLoadout(body, sy) {
      var self = this;
      var C = cdata();
      var gs = GameState;

      // 协同总览条
      var summary = document.createElement('div');
      summary.className = 'v58-summary';
      var tiers = ['', 'T1', 'T2', 'T3', 'T4'];
      summary.innerHTML =
        '<div class="v58-stat"><label>平均能耗</label><b>' + sy.avgEnergy + '</b><i>能量/技能</i></div>'
        + '<div class="v58-stat"><label>综合战力</label><b>' + sy.power + '</b><i>' + tiers[sy.tier] + ' 推荐</i></div>'
        + '<div class="v58-stat"><label>主流派</label><b>' + (sy.dominant ? (C.factions[sy.dominant].name) : '混合') + '</b><i>'
        + (sy.dominant ? ('克 ' + (C.factions[sy.counter] ? C.factions[sy.counter].name : '?') + ' · 被 ' + (C.factions[sy.counteredBy] ? C.factions[sy.counteredBy].name : '?') + ' 克') : '单一流派 ≥2 张触发协同')
        + '</i></div>';
      body.appendChild(summary);

      // 标签计数 + 里程碑高亮
      var tagRow = document.createElement('div');
      tagRow.className = 'v58-tagrow';
      FACTION_ORDER.forEach(function (f) {
        var t = sy.tags[f];
        var active = t.active.length > 0;
        var div = document.createElement('div');
        div.className = 'v58-tag' + (active ? ' milestone' : '') + (sy.dominant === f ? ' dominant' : '');
        div.innerHTML = '<span class="v58-tagname">' + (C.factions[f].name) + '</span>'
          + '<span class="v58-tagcount">' + t.count + '</span>'
          + (active ? '<span class="v58-tagms">' + sy.buffs.filter(function (b) { return b.faction === f; }).map(function (b) { return b.name; }).join('·') + '</span>' : '<span class="v58-tagms dim">2/3/4/5</span>');
        tagRow.appendChild(div);
      });
      body.appendChild(tagRow);

      // 激活里程碑列表
      if (sy.buffs.length) {
        var msBox = document.createElement('div');
        msBox.className = 'v58-mslist';
        msBox.innerHTML = '<div class="v58-mslist-title">已激活协同被动</div>'
          + sy.buffs.map(function (b) { return '<div class="v58-msitem"><b>' + b.name + '</b>（' + FACTION_NAME[b.faction] + ' ' + b.at + '张）：' + b.desc + '</div>'; }).join('');
        body.appendChild(msBox);
      } else {
        var hint = document.createElement('div');
        hint.className = 'v58-nohint';
        hint.textContent = '同流派标签 ≥2 张触发协同被动。当前牌组流派分散，先围绕一个流派堆叠。';
        body.appendChild(hint);
      }

      // 克制 / 第二元素建议
      var counterBox = document.createElement('div');
      counterBox.className = 'v58-counter';
      var secondElem = sy.counteredBy || (sy.dominant ? C.factions[sy.dominant].counterTo : null);
      counterBox.innerHTML =
        '<div class="v58-counter-title">克制提示</div>'
        + '<div>主流派 <b>' + (sy.dominant ? C.factions[sy.dominant].name : '—') + '</b>：对 <b>' + (sy.counter ? C.factions[sy.counter].name : '—') + '</b> 伤害 +25%；被 <b>' + (sy.counteredBy ? C.factions[sy.counteredBy].name : '—') + '</b> 克制（-25%）。</div>'
        + '<div class="v58-second">建议第二元素：<b>' + (secondElem ? C.factions[secondElem].name : '—') + '</b>'
        + (sy.dominant ? '（应对免疫该元素的目标，避免输出归零）' : '') + '</div>';
      body.appendChild(counterBox);

      // 技能卡装备（1→5 槽）
      var slots = (typeof CharacterSystem !== 'undefined') ? CharacterSystem.slotCount() : 4;
      var skPanel = document.createElement('div');
      skPanel.className = 'v58-panel';
      skPanel.innerHTML = '<div class="v58-panel-title">🪄 技能卡装备（' + (gs.equippedSkills || []).length + '/' + slots + ' 槽，随角色等级 1→5）</div>';
      var skGrid = document.createElement('div');
      skGrid.className = 'v58-skillgrid';
      (CONFIG.skills || []).forEach(function (sk) {
        var unlocked = (gs.unlockedSkills || []).indexOf(sk.id) >= 0;
        var equipped = (gs.equippedSkills || []).indexOf(sk.id) >= 0;
        var rec = recOf('skill', sk.id);
        var mastery = rec ? (rec.masteryLv || 0) : 0;
        var affixN = rec && rec.affixes ? rec.affixes.length : 0;
        var div = document.createElement('div');
        div.className = 'v58-skillcard' + (equipped ? ' equipped' : '') + (unlocked ? '' : ' locked');
        div.innerHTML = '<div class="v58-skillicon">' + sk.icon + '</div>'
          + '<div class="v58-skillname">' + sk.name + '</div>'
          + '<div class="v58-skillmeta">' + (unlocked ? ('精通 Lv' + mastery + (affixN ? ' · ' + affixN + '词条' : '')) : '未解锁') + '</div>';
        if (unlocked) {
          div.onclick = function () {
            try { CharacterSystem.equip(sk.id); SaveSystem.save(); } catch (e) {}
            self.renderWorkshop();
          };
        }
        skGrid.appendChild(div);
      });
      skPanel.appendChild(skGrid);
      body.appendChild(skPanel);

      // 道具 / 种子容量提示
      var cap = document.createElement('div');
      cap.className = 'v58-caprow';
      var itemTypes = Object.keys(gs.loadout || {}).filter(function (k) { return (gs.loadout[k] || 0) > 0; }).length;
      var seedN = (gs.carriedSeeds || []).reduce(function (s, c) { return s + (c.count || 0); }, 0);
      cap.innerHTML = '<span>道具：<b>' + itemTypes + '/6 种</b>（每种 ≤5）</span><span>种子：<b>' + seedN + '/5</b>（F1–F5 种植）</span>'
        + '<span class="v58-capnote">道具/种子在「远征准备」页携带，此处实时反映协同。</span>';
      body.appendChild(cap);
    },

    /* ---------- 收藏页：全部已拥有卡，精通/词条一览 ---------- */
    _renderCollection(body, sy) {
      var self = this;
      var C = cdata();
      var gs = GameState;
      var sec = gs.collection || { skill: {}, item: {}, seed: {} };

      var title = document.createElement('div');
      title.className = 'v58-panel-title';
      title.innerHTML = '📖 收藏（精通 Lv1–5：伤害/治疗/护盾 +18%/级、冷却 -5%/级；附魔追加词条）';
      body.appendChild(title);

      function group(type, label, defs) {
        var grp = document.createElement('div');
        grp.className = 'v58-collgroup';
        var h = document.createElement('div');
        h.className = 'v58-collh'; h.textContent = label;
        grp.appendChild(h);
        var grid = document.createElement('div');
        grid.className = 'v58-collgrid';
        Object.keys(defs).forEach(function (did) {
          var def = defs[did];
          var rec = (sec[type === 'skill' ? 'skill' : type] || {})[did];
          var owned = !!rec && (rec.count > 0 || (type === 'skill' && (gs.unlockedSkills || []).indexOf(did) >= 0));
          var div = document.createElement('div');
          div.className = 'v58-collcard rarity-' + (def.rarity || 'common') + (owned ? '' : ' owned-no');
          var affixTxt = rec && rec.affixes && rec.affixes.length
            ? rec.affixes.map(function (a) { var ad = C.affixes[a]; return ad ? ad.name : a; }).join('、') : '';
          div.innerHTML = '<div class="v58-collicon">' + def.icon + '</div>'
            + '<div class="v58-collname">' + def.name + '</div>'
            + '<div class="v58-collrarity">' + (RARITY_NAME[def.rarity] || '') + '</div>'
            + '<div class="v58-collmeta">' + (type === 'skill'
              ? (owned ? '精通 Lv' + (rec.masteryLv || 0) + ' · 进度 ' + Math.floor((rec.masteryProgress || 0) * 100) + '%' : '未拥有/未解锁')
              : (owned ? '持有 ×' + (rec.count || 0) : '未印制')) + '</div>'
            + (affixTxt ? '<div class="v58-collaffix">' + affixTxt + '</div>' : '');
          grid.appendChild(div);
        });
        grp.appendChild(grid);
        body.appendChild(grp);
      }
      group('skill', '🪄 技能卡', C.skills);
      group('item', '🧪 道具卡（6 种 ×5）', C.items);
      group('seed', '🌱 种子卡（F1–F5）', C.seeds);
    },

    /* ---------- 工坊页：四工位 ---------- */
    _renderWorkshopStation(body, sy) {
      var self = this;
      var C = cdata();
      var gs = GameState;

      // 工位标签
      var stations = document.createElement('div');
      stations.className = 'v58-stations';
      stations.innerHTML = '<div class="v58-station-title">🏭 卡牌工坊 · 四工位</div>';
      body.appendChild(stations);

      // ① 印制
      var printBox = document.createElement('div');
      printBox.className = 'v58-station';
      printBox.innerHTML = '<div class="v58-station-h">① 印制 <span class="v58-station-desc">消耗卡牌纸(纤维+清水)/墨汁(毒腺+药草)+金币，产出收藏计数</span></div>';
      var printSel = document.createElement('select');
      printSel.className = 'v58-select';
      var opts = [];
      Object.keys(C.skills).forEach(function (id) { opts.push(['skill', id, C.skills[id].name + '（技能·' + RARITY_NAME[C.skills[id].rarity] + '）']); });
      Object.keys(C.items).forEach(function (id) { opts.push(['item', id, C.items[id].name + '（道具）']); });
      Object.keys(C.seeds).forEach(function (id) { opts.push(['seed', id, C.seeds[id].name + '（种子）']); });
      opts.forEach(function (o) {
        var op = document.createElement('option');
        op.value = o[0] + '|' + o[1]; op.textContent = o[2];
        printSel.appendChild(op);
      });
      printBox.appendChild(printSel);
      var printInfo = document.createElement('div');
      printInfo.className = 'v58-cost';
      var doPrint = function () {
        var v = printSel.value.split('|');
        var recipe = printRecipeFor(v[0], v[1]);
        if (!recipe) { showToast('无效配方', 'warning'); return; }
        if (!payCost(recipe.cost)) { showToast('材料或金币不足：' + costText(recipe.cost), 'warning'); return; }
        var rec = ensureRec(recipe.type, recipe.defId);
        rec.count += 1;
        // 稀有/传说印制即随机追加词条（按稀有度分配）
        self._rollPrintAffixes(rec, recipe.rarity);
        try { if (typeof SaveSystem !== 'undefined') SaveSystem.save(); } catch (e) {}
        showToast('印制成功：' + recipe.name + '（' + RARITY_NAME[recipe.rarity] + '）已入收藏', 'gold');
        self.renderWorkshop();
      };
      var printBtn = document.createElement('button');
      printBtn.className = 'secondary-btn v58-actbtn';
      printBtn.textContent = '印制';
      printBtn.onclick = doPrint;
      printBox.appendChild(printBtn);
      var updPrintInfo = function () {
        var v = printSel.value.split('|');
        var recipe = printRecipeFor(v[0], v[1]);
        printInfo.textContent = recipe ? ('成本：' + costText(recipe.cost)) : '';
      };
      printSel.onchange = updPrintInfo; updPrintInfo();
      printBox.appendChild(printInfo);
      body.appendChild(printBox);

      // ② 附魔
      var enBox = document.createElement('div');
      enBox.className = 'v58-station';
      enBox.innerHTML = '<div class="v58-station-h">② 附魔 <span class="v58-station-desc">给技能卡追加后缀词条（+燃烧/回收/急速…），按稀有度上限 rare1/epic2/legendary3</span></div>';
      var enSel = document.createElement('select');
      enSel.className = 'v58-select';
      Object.keys(C.skills).forEach(function (id) {
        var op = document.createElement('option');
        var rec = recOf('skill', id);
        var n = rec && rec.affixes ? rec.affixes.length : 0;
        op.value = id; op.textContent = C.skills[id].name + '（词条 ' + n + '/' + (({ rare: 1, epic: 2, legendary: 3 })[C.skills[id].rarity] || 1) + '）';
        enSel.appendChild(op);
      });
      enBox.appendChild(enSel);
      var enInfo = document.createElement('div');
      enInfo.className = 'v58-cost';
      var doEnchant = function () {
        var id = enSel.value;
        var def = C.skills[id];
        var cap = ({ rare: 1, epic: 2, legendary: 3 })[def.rarity] || 1;
        var rec = ensureRec('skill', id);
        if (rec.affixes.length >= cap) { showToast('该稀有度词条已满（' + cap + ' 条）', 'warning'); return; }
        var cost = { gold: 120, materials: { crystal: 1, herb: 1 } };
        if (!payCost(cost)) { showToast('材料或金币不足：' + costText(cost), 'warning'); return; }
        var affixId = cardV().rollAffix(def.rarity);
        if (!affixId) { showToast('无可用词条', 'warning'); return; }
        if (rec.affixes.indexOf(affixId) >= 0) { // 去重重骰
          affixId = Object.keys(C.affixes).find(function (a) { return rec.affixes.indexOf(a) < 0; });
        }
        cardV().enchant(rec, affixId); // 直接 mutate rec.affixes / rec.tags
        try { SaveSystem.save(); } catch (e) {}
        var ad = C.affixes[affixId];
        showToast('附魔成功：' + def.name + ' + ' + (ad ? ad.name : affixId), 'gold');
        self.renderWorkshop();
      };
      var enBtn = document.createElement('button');
      enBtn.className = 'secondary-btn v58-actbtn'; enBtn.textContent = '附魔';
      enBtn.onclick = doEnchant;
      enBox.appendChild(enBtn);
      enInfo.textContent = '成本：' + costText({ gold: 120, materials: { crystal: 1, herb: 1 } });
      enBox.appendChild(enInfo);
      body.appendChild(enBox);

      // ③ 融合（5 合 1 → 精通进度 +1）
      var fuBox = document.createElement('div');
      fuBox.className = 'v58-station';
      fuBox.innerHTML = '<div class="v58-station-h">③ 融合 <span class="v58-station-desc">消耗同一技能 5 张副本 → 精通进度 +1（满 1 进度升 1 级精通）</span></div>';
      var fuSel = document.createElement('select');
      fuSel.className = 'v58-select';
      Object.keys(C.skills).forEach(function (id) {
        var rec = recOf('skill', id);
        var cnt = rec ? rec.count : 0;
        var op = document.createElement('option');
        op.value = id; op.textContent = C.skills[id].name + '（副本 ' + cnt + '，精通 Lv' + (rec ? rec.masteryLv : 0) + '）';
        fuSel.appendChild(op);
      });
      fuBox.appendChild(fuSel);
      var fuBtn = document.createElement('button');
      fuBtn.className = 'secondary-btn v58-actbtn'; fuBtn.textContent = '5 合 1 融合';
      fuBtn.onclick = function () {
        var id = fuSel.value;
        var rec = ensureRec('skill', id);
        if (rec.count < 5) { showToast('需要 5 张 ' + C.skills[id].name + ' 副本（当前 ' + rec.count + '）', 'warning'); return; }
        if ((rec.masteryLv || 0) >= 5) { showToast('精通已满 Lv5', 'warning'); return; }
        rec.count -= 5;
        cardV().addMasteryProgress('skill:' + id, 1);
        try { SaveSystem.save(); } catch (e) {}
        showToast('融合成功：' + C.skills[id].name + ' 精通进度 +1（Lv' + rec.masteryLv + '）', 'gold');
        self.renderWorkshop();
      };
      fuBox.appendChild(fuBtn);
      body.appendChild(fuBox);

      // ④ 铭记研究
      var rsBox = document.createElement('div');
      rsBox.className = 'v58-station';
      var luck = (gs._v58Research && gs._v58Research.inscribeLuck) || 0;
      rsBox.innerHTML = '<div class="v58-station-h">④ 铭记研究 <span class="v58-station-desc">消耗材料永久提升撤离铭记幸运（当前 +' + Math.round(luck * 100) + '%，上限 +15%）</span></div>';
      var rsBtn = document.createElement('button');
      rsBtn.className = 'secondary-btn v58-actbtn'; rsBtn.textContent = '研究（+5% 铭记率）';
      rsBtn.onclick = function () {
        var cost = { gold: 200, materials: { crystal: 2, soul_ash: 1 } };
        if (!payCost(cost)) { showToast('材料或金币不足：' + costText(cost), 'warning'); return; }
        var res = cardV().research({ cost: {} }); // 已扣材料，直接推进
        if (!gs._v58Research) gs._v58Research = { inscribeLuck: 0 };
        if (gs._v58Research.inscribeLuck >= 0.15) { showToast('研究已满', 'warning'); return; }
        gs._v58Research.inscribeLuck = Math.min(0.15, gs._v58Research.inscribeLuck + 0.05);
        try { SaveSystem.save(); } catch (e) {}
        showToast('铭记研究完成：幸运 +' + Math.round(gs._v58Research.inscribeLuck * 100) + '%', 'gold');
        self.renderWorkshop();
      };
      rsBox.appendChild(rsBtn);
      var rsInfo = document.createElement('div');
      rsInfo.className = 'v58-cost';
      rsInfo.textContent = '成本：' + costText({ gold: 200, materials: { crystal: 2, soul_ash: 1 } });
      rsBox.appendChild(rsInfo);
      body.appendChild(rsBox);
    },

    // 印制稀有/传说卡时按稀有度自动追加词条
    _rollPrintAffixes(rec, rarity) {
      var cap = ({ rare: 1, epic: 2, legendary: 3 })[rarity] || 0;
      if (!cap) return;
      var C = cdata();
      if (!rec.affixes) rec.affixes = [];
      for (var i = 0; i < cap; i++) {
        var pool = Object.keys(C.affixes).filter(function (a) {
          var ad = C.affixes[a];
          return (C.rarities[ad.minRarity] && C.rarities[ad.minRarity].power <= C.rarities[rarity].power) && rec.affixes.indexOf(a) < 0;
        });
        if (!pool.length) break;
        var pick = pool[Math.floor(Math.random() * pool.length)];
        rec.affixes.push(pick);
      }
      // 同步 tags
      rec.affixes.forEach(function (a) { var ad = C.affixes[a]; if (ad && ad.tag && rec.tags.indexOf(ad.tag) < 0) rec.tags.push(ad.tag); });
    }
  };

  // 暴露给可能的外部调用
  window.CardSystem = CardSystem;
})();
