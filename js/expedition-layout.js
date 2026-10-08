/* Presentation only: derive summaries from live state, never change rewards or inventory. */
const ExpeditionLayout = {
  observer: null,
  prepare() {
    this.observer?.disconnect();
    const screen = document.getElementById('expeditionPrepScreen');
    this.observer = new MutationObserver(() => this.summary());
    this.observer.observe(screen.querySelector('.prep-content'), {childList:true, subtree:true});
    this.summary();
  },
  summary() {
    const map = CONFIG.maps.find(m => m.id === GameState.selectedMap) || CONFIG.maps[0];
    const weapons = (GameState.loadoutWeaponUids || []).map(id => LoadoutSystem.getWeaponInstance(id)).filter(Boolean);
    const ready = weapons.length > 0 && GameState.gold >= map.entryFee;
    const names = weapons.map(w => CONFIG.weapons.find(d => d.id === w.weaponId)?.name || w.weaponId);
    const types = Object.values(GameState.loadout || {}).filter(v => v > 0).length;
    document.getElementById('prepSummary').textContent = `${map.name} · 入场 ${map.entryFee} 金 · 补给 ${types}/6 种 · ${names.join('、') || '请先在左栏选择武器'}${GameState.gold < map.entryFee ? ' · 金币不足' : ''}`;
    const btn = document.getElementById('startExpeditionBtn');
    btn.disabled = !ready;
    btn.textContent = ready ? '确认配置并出发' : weapons.length ? '金币不足' : '请先选择武器';
  },
  hud(g) {
    const conditions = document.getElementById('playerConditions');
    const labels = [];
    const shield = Math.max(0, g.cardShield || 0) + Math.max(0, g.v5?.shield || 0);
    labels.push('护盾 ' + Math.ceil(shield));
    if (g.player.root > 0) labels.push('定身');
    if (g.player.slow > 0) labels.push('减速');
    if (g.player.invuln > 0) labels.push('保护中');
    if (g.player.stealth > 0) labels.push('隐身');
    conditions.textContent = labels.join(' · ');
    const nodes = [['商人',g.merchant],['篝火',g.campfire]].filter(([,n])=>n && !n.used);
    nodes.sort((a,b)=>dist(a[1],g.player)-dist(b[1],g.player));
    const node = nodes[0];
    const directions = ['东','东南','南','西南','西','西北','北','东北'];
    document.getElementById('nodeDirection').textContent = node ? `${node[0]} · ${directions[(Math.round(Math.atan2(node[1].y-g.player.y,node[1].x-g.player.x)/(Math.PI/4))+8)%8]} · ${Math.round(dist(node[1],g.player))}米` : '附近暂无可用节点';
    const toggle = document.getElementById('hudDetailsToggle');
    if (!toggle.onclick) toggle.onclick = () => {
      const expanded = document.getElementById('expeditionHUD').classList.toggle('details-open');
      toggle.setAttribute('aria-expanded',String(expanded)); toggle.textContent = expanded ? '收起信息' : '展开信息';
    };
    if (g.extracting) {
      const total = g.extractType === 'signal' ? CONFIG.expedition.signalExtractTime : CONFIG.expedition.extractTime;
      document.getElementById('targetName').textContent = '正在撤离';
      document.getElementById('targetMeta').textContent = `剩余 ${Math.max(0,total-g.extractProgress).toFixed(1)} 秒`;
    }
  },
  result(data) {
    const stats = document.getElementById('resultStats');
    const gold = [...stats.children].find(n => n.textContent.includes('获得金币'));
    if (gold) stats.prepend(gold);
    const list = document.getElementById('lootList');
    list.querySelectorAll('.loot-item.kept').forEach(n => n.classList.add('result-kept'));
    // No new settlement calculations: display the actual settled data only.
    const heading = document.createElement('h3'); heading.textContent = data.success ? '撤离收益与保留物资' : '保留与遗失物资';
    list.prepend(heading);
  },
  openCollection() {
    Game.returnToFarm();
    document.getElementById('runCollection')?.remove();
    const overlay = document.createElement('div'); overlay.id = 'runCollection'; overlay.className = 'v58-overlay';
    const panel = document.createElement('div'); panel.className = 'v58-modal';
    const title = document.createElement('h2'); title.textContent = '卡牌收藏'; panel.appendChild(title);
    for (const [type,records] of Object.entries(GameState.collection || {})) {
      const h = document.createElement('h3'); h.textContent = ({skill:'技能',item:'道具',seed:'种子'})[type] || type; panel.appendChild(h);
      for (const id of Object.keys(records || {})) {
        const row = document.createElement('p'); row.textContent = CardV58.getDef(type,id)?.name || id; panel.appendChild(row);
      }
      if (!Object.keys(records || {}).length) { const p=document.createElement('p');p.textContent='尚未收藏';panel.appendChild(p); }
    }
    const close = document.createElement('button');close.className='secondary-btn';close.textContent='返回农场';close.onclick=()=>overlay.remove();panel.appendChild(close);
    overlay.appendChild(panel);document.body.appendChild(overlay);
  }
};
