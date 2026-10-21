// ==================== GM 调试控制台（v5.8 · 仅浏览器 F12 控制台可用，不进 UI） ====================
// 用法示例：
//   GM.set(100000)     金币 + 通用种子一起拉到 100000
//   GM.gold(100000)    只设金币
//   GM.seeds(100000)   只设通用种子（自动扩仓库容量，保证远征战利品照常入库）
//   GM.add(5000)       金币与种子在当前值上各 +5000
//   GM.stats()         查看金币 / 种子 / 仓库占用
//   GM.help()          打印本说明
const GM = {
  _num(n) { return Math.max(0, Math.floor(Number(n) || 0)); },

  // 写入后统一：落盘 + 刷新当前可见界面 + 反馈
  _sync(msg) {
    try { SaveSystem.save(); } catch (e) { console.warn('[GM] 存档写入失败', e); }
    try {
      if (GameState.screen === 'farm' && window.Farm && Farm.render) Farm.render();
      const ms = document.getElementById('mapSelect');
      if (ms && ms.offsetParent !== null && window.Farm && Farm.renderMapSelect) Farm.renderMapSelect();
    } catch (e) { /* 界面刷新失败不影响数值与存档 */ }
    if (msg) {
      console.log('%c[GM] ' + msg, 'color:#7fd96a;font-weight:bold;');
      try { showToast('🧪 GM：' + msg, 'gold'); } catch (e) {}
    }
  },

  _setGold(n) {
    GameState.gold = n;
  },

  _setSeeds(n) {
    Warehouse.init();
    if (n <= 0) { delete GameState.warehouse.items.seeds; return; }
    GameState.warehouse.items.seeds = n;
    // 通用种子按件数占仓库容量：自动扩容并留 80 件余量，避免远征结算战利品无法入库
    const need = Warehouse.getUsedCapacity() + 80;
    if (GameState.warehouse.capacity < need) GameState.warehouse.capacity = need;
  },

  gold(n) {
    n = this._num(n);
    this._setGold(n);
    this._sync('金币已设为 ' + n.toLocaleString());
    return GameState.gold;
  },

  seeds(n) {
    n = this._num(n);
    this._setSeeds(n);
    this._sync('通用种子已设为 ' + n.toLocaleString() + '（仓库容量 → ' + GameState.warehouse.capacity + '）');
    return n;
  },

  set(n) {
    n = this._num(n);
    this._setGold(n);
    this._setSeeds(n);
    this._sync('金币 ' + n.toLocaleString() + ' · 种子 ' + n.toLocaleString());
    return n;
  },

  add(n) {
    n = this._num(n);
    this._setGold(GameState.gold + n);
    this._setSeeds(Warehouse.getCount('seeds') + n);
    this._sync('金币与种子各 +' + n.toLocaleString() + '（现：金 ' + GameState.gold.toLocaleString() + ' / 种子 ' + Warehouse.getCount('seeds').toLocaleString() + '）');
    return n;
  },

  stats() {
    Warehouse.init();
    const info = {
      gold: GameState.gold,
      seeds: GameState.warehouse.items.seeds || 0,
      warehouseUsed: Warehouse.getUsedCapacity(),
      warehouseCapacity: GameState.warehouse.capacity
    };
    console.log('[GM] 当前资源', info);
    return info;
  },

  help() {
    const usage = [
      '%c[GM] 调试命令',
      'GM.set(n)     金币+种子一起设为 n',
      'GM.gold(n)    只设金币',
      'GM.seeds(n)   只设通用种子（自动扩仓库容量）',
      'GM.add(n)     金币与种子各加 n',
      'GM.stats()    查看当前资源'
    ].join('\n');
    console.log(usage, 'color:#7fd96a;font-weight:bold;');
  }
};
window.GM = GM;
console.log('%c[GM] 调试命令已就绪：GM.set(金币&种子) / GM.gold(n) / GM.seeds(n) / GM.add(n) / GM.stats() / GM.help()',
  'color:#7fd96a;');

// ==================== 一次性指令：金币拉到 100,000 ====================
// 玩家要求：打开游戏金币即为十万。执行一次后写入标记，之后不再重复。
window.addEventListener('load', function () {
  setTimeout(function () {
    try {
      if (localStorage.getItem('farm-gm-gold-100k-v1')) return;
      if (typeof GameState === 'undefined' || !GameState) return;
      GameState.gold = 100000;
      try { SaveSystem.save(); } catch (e) {}
      try { if (window.Farm && Farm.render) Farm.render(); } catch (e) {}
      localStorage.setItem('farm-gm-gold-100k-v1', '1');
      console.log('%c[GM] 金币已调整为 100,000', 'color:#7fd96a;font-weight:bold;');
      try { showToast('💰 金币已调整为 100,000', 'gold'); } catch (e) {}
    } catch (e) { console.warn('[GM] 一次性金币指令失败', e); }
  }, 800);
});
