// ================= v1.0 成就系统 =================
// 三类成就：远征 / 农场 / 收藏
const AchievementSystem = {
  definitions: [
    // ===== 远征类 =====
    { id: 'first_extract', cat: 'expedition', name: '初次撤离', desc: '首次成功撤离', icon: '🚁', reward: { type: 'gold', amount: 200 } },
    { id: 'kill_50', cat: 'expedition', name: '猎杀新手', desc: '单局击杀50只怪物', icon: '⚔️', reward: { type: 'gold', amount: 300 } },
    { id: 'kill_100', cat: 'expedition', name: '战场收割者', desc: '单局击杀100只怪物', icon: '💀', reward: { type: 'stat', key: 'allDamage', value: 0.05 } },
    { id: 'no_damage_t2', cat: 'expedition', name: '无伤通关', desc: '零受伤通关T2', icon: '🛡️', reward: { type: 'blueprint', weaponId: 'throwing_knife' } },
    { id: 'extract_10', cat: 'expedition', name: '老练探险家', desc: '连续成功撤离10次', icon: '🏆', reward: { type: 'stat', key: 'maxHp', value: 20 } },
    { id: 'boss_kill_t1', cat: 'expedition', name: '荒野猎手', desc: '击败T1 Boss', icon: '👹', reward: { type: 'gold', amount: 500 } },
    { id: 'boss_kill_t2', cat: 'expedition', name: '废墟征服者', desc: '击败T2 Boss', icon: '🐉', reward: { type: 'blueprint', weaponId: 'flame_bow' } },
    { id: 'hardcore', cat: 'expedition', name: '噩梦通关', desc: '噩梦难度成功撤离', icon: '🔥', reward: { type: 'title', title: '噩梦征服者' } },
    { id: 'rich_run', cat: 'expedition', name: '满载而归', desc: '单局带回2000金币', icon: '💰', reward: { type: 'stat', key: 'goldBonus', value: 0.1 } },
    // ===== 农场类 =====
    { id: 'harvest_100', cat: 'farm', name: '勤劳农夫', desc: '累计收获100个作物', icon: '🌾', reward: { type: 'stat', key: 'growSpeed', value: 0.05 } },
    { id: 'harvest_500', cat: 'farm', name: '种植大师', desc: '累计收获500个作物', icon: '🌻', reward: { type: 'stat', key: 'sellPrice', value: 0.1 } },
    { id: 'legendary_harvest', cat: 'farm', name: '传说收获', desc: '收获一个传说品质作物', icon: '✨', reward: { type: 'gold', amount: 500 } },
    { id: 'combo_master', cat: 'farm', name: '园艺大师', desc: '触发10次作物组合', icon: '🌿', reward: { type: 'stat', key: 'quality', value: 0.05 } },
    { id: 'greenhouse', cat: 'farm', name: '温室主人', desc: '建造温室', icon: '🏡', reward: { type: 'gold', amount: 800 } },
    // ===== 收藏类 =====
    { id: 'kill_3_bosses', cat: 'collection', name: '屠龙者', desc: '累计击杀3种不同Boss', icon: '⚡', reward: { type: 'stat', key: 'critChance', value: 0.05 } },
    { id: 'collect_10_mats', cat: 'collection', name: '材料收藏家', desc: '收集10种不同材料', icon: '📦', reward: { type: 'gold', amount: 400 } },
    { id: 'hidden_extract', cat: 'collection', name: '秘密通道', desc: '发现隐藏撤离点', icon: '🚪', reward: { type: 'safeSlot', slots: 1 } },
    { id: 'weapon_owner', cat: 'collection', name: '武器大师', desc: '锻造出3把不同武器', icon: '🔨', reward: { type: 'title', title: '锻造宗师' } },
    { id: 'npc_all', cat: 'collection', name: '荒野之友', desc: '所有NPC好感度达到满级', icon: '🤝', reward: { type: 'gold', amount: 1000 } }
  ],

  init() {
    if (!GameState.achievements) GameState.achievements = { unlocked: [], progress: {}, stats: { kills: 0, harvests: 0, extracts: 0, bossKills: {}, materials: {}, consecutiveExtracts: 0 } };
  },

  getUnlocked() { return GameState.achievements.unlocked; },

  isUnlocked(id) { return GameState.achievements.unlocked.includes(id); },

  // 追踪统计
  track(key, value) {
    if (!GameState.achievements.stats[key]) GameState.achievements.stats[key] = 0;
    GameState.achievements.stats[key] += value || 1;
    this.checkAll();
  },

  // 追踪事件（如boss击杀、材料收集）
  trackEvent(type, subId) {
    const s = GameState.achievements.stats;
    if (type === 'boss') {
      s.bossKills[subId] = (s.bossKills[subId] || 0) + 1;
    } else if (type === 'material') {
      s.materials[subId] = (s.materials[subId] || 0) + 1;
    } else if (type === 'extract') {
      s.extracts++;
    } else if (type === 'harvest') {
      s.harvests++;
    } else if (type === 'kill') {
      s.kills++;
    }
    this.checkAll();
  },

  checkAll() {
    this.definitions.forEach(def => {
      if (this.isUnlocked(def.id)) return;
      if (this._check(def.id)) this.unlock(def.id);
    });
  },

  _check(id) {
    const s = GameState.achievements.stats;
    switch(id) {
      case 'first_extract': return s.extracts >= 1;
      case 'kill_50': return (s.lastRunKills || 0) >= 50;
      case 'kill_100': return (s.lastRunKills || 0) >= 100;
      case 'no_damage_t2': return s.lastRunNoDamageT2 === true;
      case 'extract_10': return s.consecutiveExtracts >= 10;
      case 'boss_kill_t1': return (s.bossKills['t1'] || 0) >= 1;
      case 'boss_kill_t2': return (s.bossKills['t2'] || 0) >= 1;
      case 'hardcore': return s.lastRunHardcore === true;
      case 'rich_run': return s.lastRunGold >= 2000;
      case 'harvest_100': return s.harvests >= 100;
      case 'harvest_500': return s.harvests >= 500;
      case 'legendary_harvest': return s.legendaryHarvests >= 1;
      case 'combo_master': return s.comboTriggers >= 10;
      case 'greenhouse': return GameState.buildings && GameState.buildings.greenhouse >= 1;
      case 'kill_3_bosses': return Object.keys(s.bossKills).length >= 3;
      case 'collect_10_mats': return Object.keys(s.materials).length >= 10;
      case 'hidden_extract': return s.hiddenExtracts >= 1;
      case 'weapon_owner': return (GameState.forgedWeapons || []).length >= 3;
      case 'npc_all': {
        if (typeof NpcSystem === 'undefined' || !NpcSystem.NPCS) return false;
        return Object.keys(NpcSystem.NPCS).every(id => {
          const st = NpcSystem.getNpcState(id);
          return st && st.affection >= 100;
        });
      }
      default: return false;
    }
  },

  unlock(id) {
    const def = this.definitions.find(d => d.id === id);
    if (!def) return;
    GameState.achievements.unlocked.push(id);
    // 发奖励
    if (def.reward) this._giveReward(def.reward);
    // 弹成就通知
    if (typeof showToast === 'function') {
      showToast(`🏆 成就解锁：${def.name}！${def.reward ? this._rewardText(def.reward) : ''}`, 'gold');
    }
    // 持久化
    if (typeof SaveSystem !== 'undefined') SaveSystem.save();
  },

  _giveReward(r) {
    switch(r.type) {
      case 'gold': GameState.gold += r.amount; break;
      case 'stat':
        if (!GameState.permStats) GameState.permStats = {};
        GameState.permStats[r.key] = (GameState.permStats[r.key] || 0) + r.value;
        break;
      case 'blueprint':
        if (!GameState.blueprints) GameState.blueprints = [];
        if (!GameState.blueprints.includes(r.weaponId)) GameState.blueprints.push(r.weaponId);
        break;
      case 'title':
        if (!GameState.titles) GameState.titles = [];
        if (!GameState.titles.includes(r.title)) GameState.titles.push(r.title);
        break;
      case 'safeSlot':
        GameState.safeSlots = Math.max(GameState.safeSlots || 1, (GameState.safeSlots || 1) + r.slots);
        break;
    }
  },

  _rewardText(r) {
    switch(r.type) {
      case 'gold': return `金币+${r.amount}`;
      case 'stat': return '永久属性提升';
      case 'blueprint': return '新武器蓝图！';
      case 'title': return `称号「${r.title}」`;
      case 'safeSlot': return `安全箱+${r.slots}格`;
      default: return '';
    }
  },

  // 渲染成就板
  renderPanel(container) {
    if (!container) return;
    const cats = [
      { id: 'expedition', label: '远征', icon: '⚔️' },
      { id: 'farm', label: '农场', icon: '🌾' },
      { id: 'collection', label: '收藏', icon: '📦' }
    ];
    let html = '<div style="padding:16px;max-height:500px;overflow-y:auto;">';
    html += '<h3 style="color:#ffd700;margin:0 0 12px;">🏆 成就</h3>';
    const unlocked = GameState.achievements.unlocked.length;
    html += `<p style="color:#aaa;font-size:12px;margin-bottom:12px;">已解锁 ${unlocked}/${this.definitions.length}</p>`;
    cats.forEach(cat => {
      html += `<div style="margin-bottom:12px;"><div style="color:#8ecf9a;font-weight:bold;margin-bottom:6px;">${cat.icon} ${cat.label}</div>`;
      this.definitions.filter(d => d.cat === cat.id).forEach(def => {
        const un = this.isUnlocked(def.id);
        html += `<div style="display:flex;align-items:center;padding:6px 8px;margin:3px 0;background:${un?'rgba(255,215,0,0.08)':'rgba(0,0,0,0.2)'};border-radius:6px;opacity:${un?1:0.5};">
          <span style="font-size:20px;margin-right:8px;">${un?def.icon:'🔒'}</span>
          <div><div style="color:${un?'#ffd700':'#888'};font-size:13px;font-weight:bold;">${def.name}</div>
          <div style="color:#999;font-size:11px;">${def.desc}</div></div>
        </div>`;
      });
      html += '</div>';
    });
    html += '</div>';
    container.innerHTML = html;
  }
};

if (typeof window !== 'undefined') window.AchievementSystem = AchievementSystem;
