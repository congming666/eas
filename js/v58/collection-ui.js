/* =============================================================================
 * v5.8 卡牌图鉴（荣誉室）CollectionUI
 * 纯展示层：读取 CARD_DATA + GameState.collection，渲染全部 79 张卡牌的
 * 正面（卡面详情）与背面（统一纹样）。不修改任何游戏状态。
 * 浏览器挂 window.CollectionUI；不操作 DOM 的部分保持纯函数便于复用。
 * ========================================================================== */
(function (global) {
  'use strict';

  /* ---------------- 素材别名（defId -> CropArt id） ---------------- */
  // P13-f：24 种子已全部有专属立绘（含 pea_shooter/tinder_grass），无需再回退到旧图
  var ART_ALIAS = {
  };

  var TYPE_TABS = [
    { id: 'all',       name: '全部',   icon: '📖' },
    { id: 'skill',     name: '技能',   icon: '⚔️' },
    { id: 'item',      name: '道具',   icon: '🧪' },
    { id: 'seed',      name: '种子',   icon: '🌱' },
    { id: 'signature', name: '签名卡', icon: '👑' }
  ];
  var TYPE_LABEL = { skill: '技能卡', item: '道具卡', seed: '种子卡', signature: 'Boss 签名卡' };

  /* v2：类型徽章色（卡头左侧色块） */
  var TYPE_COLOR = { skill: '#9fc4e8', item: '#ffcf8a', seed: '#9fe8b0', signature: '#d9a8ff' };

  /* v2：能量/携带角标（卡头右侧） */
  function costText(def) {
    if (def.type === 'skill') return (def.effect && def.effect.energy != null) ? '⚡' + def.effect.energy : '';
    if (def.type === 'item') return '背包';
    if (def.type === 'seed') return '🌱 种植';
    if (def.type === 'signature') return '👑';
    return '';
  }

  var ELEMENT_STYLE = {
    fire:      { name: '烈焰燃烧', main: '#ff9a4d', bg: 'rgba(255,120,50,0.14)' },
    ice:       { name: '寒冰控制', main: '#9ad8ff', bg: 'rgba(120,190,255,0.13)' },
    lightning: { name: '雷鸣连锁', main: '#ffe97a', bg: 'rgba(255,225,100,0.12)' },
    poison:    { name: '剧毒蔓延', main: '#c79aff', bg: 'rgba(190,130,255,0.13)' },
    summon:    { name: '召唤园艺', main: '#8aff9a', bg: 'rgba(120,255,150,0.12)' },
    bleed:     { name: '流血处决', main: '#ff7a8a', bg: 'rgba(255,110,125,0.13)' },
    armor:     { name: '铁甲坚守', main: '#d8b48c', bg: 'rgba(216,180,140,0.13)' },
    wind:      { name: '疾风机动', main: '#a8e8d8', bg: 'rgba(150,230,210,0.12)' }
  };

  var RARITY_STYLE = {
    common:    { name: '普通', color: '#9fb0a5' },
    rare:      { name: '稀有', color: '#6fb0ff' },
    epic:      { name: '史诗', color: '#c07fff' },
    legendary: { name: '传说', color: '#ffd680' }
  };

  var RARITY_CHIPS = [
    { id: 'all', name: '全部稀有度' },
    { id: 'common', name: '普通' },
    { id: 'rare', name: '稀有' },
    { id: 'epic', name: '史诗' },
    { id: 'legendary', name: '传说' }
  ];

  function data() { return (typeof CARD_DATA !== 'undefined') ? CARD_DATA : null; }

  function defsOf(type) {
    var d = data(); if (!d) return [];
    if (type === 'skill') return Object.values(d.skills);
    if (type === 'item') return Object.values(d.items);
    if (type === 'seed') return Object.values(d.seeds);
    if (type === 'signature') return Object.values(d.signatures);
    return [];
  }

  /* ---------------- 收藏记录（只读） ---------------- */
  function sectionOf(def) { return def.type === 'signature' ? 'skill' : def.type; }
  function recOf(def) {
    var coll = (typeof GameState !== 'undefined' && GameState.collection) || {};
    var sec = coll[sectionOf(def)] || {};
    return sec[def.defId] || null;
  }
  function isOwned(def) {
    var r = recOf(def);
    if (!r) return false;
    return (r.count || 0) > 0 || (r.masteryLv || 0) > 0 || (r.masteryProgress || 0) > 0;
  }

  /* ---------------- 素材解析 ---------------- */
  function artIdOf(def) {
    if (typeof CropArt === 'undefined') return null;
    var id = def.defId;
    if (def.type === 'signature') id = def.bossId || def.defId;
    if (ART_ALIAS[id]) id = ART_ALIAS[id];
    return CropArt.map[id] ? id : null;
  }
  function artHtml(def, size) {
    var id = artIdOf(def);
    if (id && CropArt.ready(id)) return CropArt.dom(id, def.icon || '', size);
    // 无素材时用流派渐变圆底 + emoji，保证每张卡都有完整卡面
    var el = ELEMENT_STYLE[def.element] || ELEMENT_STYLE.summon;
    return '<span class="ccard-art-emoji" style="font-size:' + Math.round(size * 0.62) + 'px;'
      + 'background:radial-gradient(circle at 38% 30%, ' + el.bg + ', transparent 72%);">' + (def.icon || '❔') + '</span>';
  }

  /* ---------------- 来源提示 ---------------- */
  function sourceHint(def) {
    var s = def.source || '';
    var d = data();
    if (s === 'start') return '初始卡组携带';
    if (s === 'shop') return '商店有售';
    if (s === 'chest') return '宝箱获取';
    if (s === 'farm') return '农场产出';
    if (s.indexOf('farm:') === 0) {
      var cropId = s.slice(5);
      var nm = null;
      if (typeof CONFIG !== 'undefined' && CONFIG.crops) {
        var c = CONFIG.crops.find(function (x) { return x.id === cropId; });
        if (c) nm = c.name;
      }
      if (!nm && d && d.seeds[cropId]) nm = d.seeds[cropId].name;
      return '种植「' + (nm || cropId) + '」产出';
    }
    if (s.indexOf('boss:') === 0) {
      var bossId = s.slice(5);
      var bn = null;
      if (typeof CONFIG !== 'undefined' && CONFIG.bosses && CONFIG.bosses[bossId]) bn = CONFIG.bosses[bossId].name;
      return '击败 Boss「' + (bn || '？？？') + '」掉落';
    }
    return '远征中获取';
  }

  /* ---------------- 完成度统计（游戏结算页也调用） ---------------- */
  function progress() {
    var types = ['skill', 'item', 'seed', 'signature'];
    var owned = 0, total = 0, byType = {};
    types.forEach(function (t) {
      var defs = defsOf(t);
      var n = defs.filter(isOwned).length;
      byType[t] = { owned: n, total: defs.length };
      owned += n; total += defs.length;
    });
    return { owned: owned, total: total, byType: byType };
  }

  /* ---------------- 单卡渲染 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function footHtml(def, rec) {
    if (def.type === 'skill' || def.type === 'signature') {
      var lv = (rec && rec.masteryLv) || 0;
      var prog = (rec && rec.masteryProgress) || 0;
      var pct = Math.min(100, ((lv + Math.min(prog, 1)) / 6) * 100);
      var lab = lv >= 6 ? '精通已满级' : '精通 Lv.' + lv;
      var html = '<div class="ccard-mastery-v2"><div class="lab"><span>' + lab + '</span><b>' + Math.round(pct) + '%</b></div>'
        + '<div class="bar"><i style="width:' + pct + '%"></i></div></div>';
      // v5.8.7 金库兑换：未满级且金库非空时给兑换入口（重复卡 → 自选进度，数学上永远可达）
      var owned = (rec && ((rec.count || 0) > 0 || lv > 0 || prog > 0));
      if (owned && lv < 5 && vaultTotal() > 0) {
        html += '<button class="ccard-vault-btn" data-vault-key="' + def.type + ':' + def.defId + '">🏦 兑换碎片</button>';
      }
      return html;
    }
    var count = (rec && rec.count) || 0;
    return '<div class="ccard-count">库存 ×' + count + '</div>';
  }

  /* ---------------- 卡面金库（FMV 贴纸金库竞品解法） ---------------- */
  var VAULT_RAR_META = [
    { id: 'common', name: '普通', color: '#9fb5aa' },
    { id: 'rare', name: '稀有', color: '#5fa8d3' },
    { id: 'epic', name: '史诗', color: '#b07fd8' },
    { id: 'legendary', name: '传说', color: '#e8b45a' }
  ];
  function vaultObj() {
    if (typeof CardV58 === 'undefined') return { common: 0, rare: 0, epic: 0, legendary: 0 };
    return CardV58.vault();
  }
  function vaultTotal() {
    if (typeof CardV58 === 'undefined') return 0;
    return CardV58.vaultTotal();
  }
  function vaultHtml() {
    var v = vaultObj();
    var chips = VAULT_RAR_META.map(function (r) {
      return '<span class="coll-vault-chip"><i style="background:' + r.color + '"></i>' + r.name + ' ×' + (v[r.id] || 0) + '</span>';
    }).join('');
    return '<div class="coll-vault-row"><span class="coll-vault-title">🏦 卡面金库</span>' + chips + '</div>'
      + '<div class="coll-vault-hint">重复卡按稀有度自动存入金库（蓝图/签名双倍），在技能卡上点「兑换碎片」即可把进度灌注给任意想养的卡 —— 精通从此永远可达</div>';
  }

  function cardHtml(def) {
    var rar = RARITY_STYLE[def.rarity] || RARITY_STYLE.common;
    var el = ELEMENT_STYLE[def.element] || ELEMENT_STYLE.summon;
    var typeIcon = TYPE_TABS.find(function (t) { return t.id === def.type; });
    var owned = isOwned(def);
    var rec = recOf(def);

    /* ---- 正面 ---- */
    var front;
    if (owned) {
      front = '<div class="ccard-face ccard-front" style="border-color:' + rar.color + '">'
        + '<div class="ccard-top"><span class="ccard-type-badge" style="background:' + (TYPE_COLOR[def.type] || '#9fb5aa') + '">' + (TYPE_LABEL[def.type] || '') + '</span>'
        + '<span class="ccard-cost">' + costText(def) + '</span></div>'
        + '<div class="ccard-art">' + artHtml(def, 54) + '</div>'
        + '<div class="ccard-name"><i style="color:' + rar.color + '">✦</i>' + esc(def.name) + '</div>'
        + '<div class="ccard-faction" style="color:' + el.main + ';background:' + el.bg + '">' + el.name + '</div>'
        + '<div class="ccard-desc" title="' + esc(def.desc) + '">' + esc(def.desc) + '</div>'
        + '<div class="ccard-foot">' + footHtml(def, rec) + '</div>'
        + '</div>';
    } else {
      front = '<div class="ccard-face ccard-front ccard-unknown" style="border-color:' + rar.color + '">'
        + '<div class="ccard-top"><span class="ccard-type-badge" style="background:' + (TYPE_COLOR[def.type] || '#9fb5aa') + '">' + (TYPE_LABEL[def.type] || '') + '</span>'
        + '<span class="ccard-cost">' + costText(def) + '</span></div>'
        + '<div class="ccard-art"><span class="ccard-art-mask">？</span></div>'
        + '<div class="ccard-name"><i style="color:' + rar.color + '">✦</i>？？？</div>'
        + '<div class="ccard-faction" style="color:' + el.main + ';background:' + el.bg + '">' + el.name + '</div>'
        + '<div class="ccard-desc ccard-desc-hint">来源：' + esc(sourceHint(def)) + '</div>'
        + '<div class="ccard-foot"><div class="ccard-count ccard-count-hint">收藏后揭示卡面</div></div>'
        + '</div>';
    }

    /* ---- 背面（统一纹样，稀有度描边 + 稀有度色收藏印章） ---- */
    var back = '<div class="ccard-face ccard-back" style="border-color:' + rar.color + '">'
      + '<div class="cb-typeicon">' + (typeIcon ? typeIcon.icon : '📖') + '</div>'
      + '<div class="cb-rarity" style="color:' + rar.color + '">' + rar.name + '</div>'
      + '<div class="cb-ring"><span class="cb-emblem">🌾</span></div>'
      + '<div class="cb-title">农 庄 牌</div>'
      + '<div class="cb-sub">荒 野 远 征</div>'
      + '<div class="cb-stamp ' + (owned ? 'cb-stamp-owned' : '') + '" style="color:' + rar.color + ';border-color:' + rar.color + '">' + (owned ? '已收藏' : '未收藏') + '</div>'
      + '</div>';

    return '<div class="ccard' + (owned ? '' : ' flipped') + '" role="button" tabindex="0" title="点击翻面">'
      + '<div class="ccard-inner">' + front + back + '</div></div>';
  }

  /* ---------------- 图鉴主体 ---------------- */
  var state = { tab: 'all', rarity: 'all' };

  function gridHtml() {
    var types = state.tab === 'all' ? ['skill', 'item', 'seed', 'signature'] : [state.tab];
    var html = '';
    types.forEach(function (t) {
      defsOf(t).forEach(function (def) {
        if (state.rarity !== 'all' && def.rarity !== state.rarity) return;
        html += cardHtml(def);
      });
    });
    return html || '<div class="coll-empty">该筛选下暂无卡牌</div>';
  }

  function open() {
    document.getElementById('runCollection')?.remove();
    var prog = progress();
    var meterPct = prog.total ? (prog.owned / prog.total * 100).toFixed(1) : 0;

    var overlay = document.createElement('div');
    overlay.id = 'runCollection';
    overlay.className = 'v58-overlay';
    overlay.innerHTML = '<div class="v58-modal coll-modal">'
      + '<div class="coll-header">'
      + '<div><h2 class="coll-title">📖 卡牌图鉴</h2>'
      + '<div class="coll-subtitle">技能 ' + prog.byType.skill.total + ' · 道具 ' + prog.byType.item.total
      + ' · 种子 ' + prog.byType.seed.total + ' · Boss 签名卡 ' + prog.byType.signature.total
      + ' —— 点击卡牌可翻面</div></div>'
      + '<button class="secondary-btn" id="collCloseBtn">返回农场</button></div>'
      + '<div class="coll-meter">'
      + '<div class="coll-meter-top"><span class="coll-meter-num"><b>' + prog.owned + '</b> / ' + prog.total + ' 已收藏</span>'
      + '<span class="coll-meter-types">'
      + '技能 ' + prog.byType.skill.owned + '/' + prog.byType.skill.total
      + ' · 道具 ' + prog.byType.item.owned + '/' + prog.byType.item.total
      + ' · 种子 ' + prog.byType.seed.owned + '/' + prog.byType.seed.total
      + ' · 签名 ' + prog.byType.signature.owned + '/' + prog.byType.signature.total
      + '</span></div>'
      + '<div class="coll-meter-bar"><i style="width:' + meterPct + '%"></i></div>'
      + '</div>'
      + '<div class="coll-vault" id="collVault"></div>'
      + '<div class="coll-tabs" id="collTabs"></div>'
      + '<div class="coll-rarities" id="collRarities"></div>'
      + '<div class="coll-grid" id="collGrid"></div>'
      + '<div class="coll-footer">未收藏卡牌以「？」剪影展示，稀有度边框与来源提示保留 —— 按图索骥去收集吧</div>'
      + '</div>';
    document.body.appendChild(overlay);

    var tabsEl = overlay.querySelector('#collTabs');
    var rarEl = overlay.querySelector('#collRarities');
    var gridEl = overlay.querySelector('#collGrid');

    function renderTabs() {
      tabsEl.innerHTML = TYPE_TABS.map(function (t) {
        var n = t.id === 'all' ? '' : ' <i>' + defsOf(t.id).filter(isOwned).length + '/' + defsOf(t.id).length + '</i>';
        return '<button class="coll-tab' + (state.tab === t.id ? ' active' : '') + '" data-tab="' + t.id + '">'
          + t.icon + ' ' + t.name + n + '</button>';
      }).join('');
    }
    function renderChips() {
      rarEl.innerHTML = RARITY_CHIPS.map(function (c) {
        return '<button class="coll-chip' + (state.rarity === c.id ? ' active' : '') + '" data-rar="' + c.id + '">'
          + (RARITY_STYLE[c.id] ? '<i style="background:' + RARITY_STYLE[c.id].color + '"></i>' : '')
          + c.name + '</button>';
      }).join('');
    }
    function renderGrid() { gridEl.innerHTML = gridHtml(); }
    function renderVault() {
      var el = overlay.querySelector('#collVault');
      if (el) { el.innerHTML = vaultHtml(); el.style.display = vaultTotal() > 0 ? '' : 'none'; }
    }

    renderTabs(); renderChips(); renderGrid(); renderVault();

    tabsEl.addEventListener('click', function (e) {
      var b = e.target.closest('[data-tab]'); if (!b) return;
      state.tab = b.getAttribute('data-tab'); renderTabs(); renderGrid();
    });
    rarEl.addEventListener('click', function (e) {
      var b = e.target.closest('[data-rar]'); if (!b) return;
      state.rarity = b.getAttribute('data-rar'); renderChips(); renderGrid();
    });
    gridEl.addEventListener('click', function (e) {
      // 金库兑换按钮优先于翻面
      var vb = e.target.closest('.ccard-vault-btn');
      if (vb) {
        e.stopPropagation();
        if (typeof CardV58 === 'undefined') return;
        var key = vb.getAttribute('data-vault-key');
        var res = CardV58.spendVaultBest(key);
        if (res && res.ok) {
          var p = CardV58._keyParse(key);
          var def = CardV58.getDef(p.type, p.defId);
          var nm = def ? def.name : p.defId;
          var msg = '🏦 已为「' + nm + '」灌注 +' + res.gained.toFixed(2) + ' 精通进度';
          if (res.leveledUp) msg += '，精通升至 Lv.' + res.masteryLv + '！';
          if (typeof showToast === 'function') showToast(msg, res.leveledUp ? 'success' : 'info');
          renderGrid(); renderVault();
        } else if (typeof showToast === 'function') {
          showToast('🏦 ' + ((res && res.reason) || '兑换失败'), 'warning');
        }
        return;
      }
      var c = e.target.closest('.ccard'); if (c) c.classList.toggle('flipped');
    });
    gridEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var c = e.target.closest('.ccard'); if (c) { e.preventDefault(); c.classList.toggle('flipped'); }
    });
    overlay.querySelector('#collCloseBtn').addEventListener('click', function () { overlay.remove(); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
  }

  var CollectionUI = {
    open: open,
    progress: progress,
    isOwned: isOwned,
    sourceHint: sourceHint,
    _state: state
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CollectionUI;
  if (typeof global !== 'undefined') global.CollectionUI = CollectionUI;
  if (typeof window !== 'undefined') window.CollectionUI = CollectionUI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
