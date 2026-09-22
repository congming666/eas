const CardSystem = {
  rarityNames: { common: '普通', rare: '稀有', legendary: '传说' },
  rarityPower: { common: 1, rare: 2, legendary: 3 },

  createCard(crop) {
    const roll = Math.random();
    let rarity = 'common';
    if (crop.rarity === 'legendary') rarity = roll < 0.42 ? 'legendary' : (roll < 0.86 ? 'rare' : 'common');
    else if (crop.rarity === 'rare') rarity = roll < 0.06 ? 'legendary' : (roll < 0.38 ? 'rare' : 'common');
    else rarity = roll < 0.12 ? 'rare' : 'common';
    const skillId = crop.upgradeSkill === 'all'
      ? CONFIG.skills[randInt(0, CONFIG.skills.length - 1)].id
      : crop.upgradeSkill;
    const skill = CONFIG.skills.find(item => item.id === skillId);
    const power = this.rarityPower[rarity];
    return {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      rarity, power, skillId,
      icon: crop.icon,
      name: `${crop.name}·${skill.name}强化`,
      desc: `使用后令「${skill.name}」永久提升 ${power} 级，最高 8 级。`,
    };
  },

  tryDrop(crop) {
    if (Math.random() >= crop.cardChance) return null;
    const card = this.createCard(crop);
    GameState.cardInventory.push(card);
    SaveSystem.save();
    this.showDrop(card);
    return card;
  },

  showDrop(card) {
    const container = document.getElementById('cardDropContainer');
    const banner = document.createElement('div');
    banner.className = `card-drop-banner ${card.rarity}`;
    const bArt = (typeof CropArt!=='undefined' && card.skillId && CropArt.ready(card.skillId)) ? CropArt.dom(card.skillId, card.icon, 22) : card.icon;
    banner.innerHTML = `<div style="color:#f3d68d;font-size:10px;">收获掉落 · ${this.rarityNames[card.rarity]}</div><div style="font-size:16px;font-weight:800;margin-top:3px;display:flex;align-items:center;gap:6px;justify-content:center;">${bArt} ${card.name}</div><div style="font-size:10px;color:#b8c9c0;margin-top:3px;">已送入卡牌工坊</div>`;
    container.appendChild(banner);
    setTimeout(() => banner.remove(), 3100);
  },

  apply(cardId) {
    const index = GameState.cardInventory.findIndex(card => card.id === cardId);
    if (index < 0) return;
    const card = GameState.cardInventory[index];
    const before = GameState.skillLevels[card.skillId] || 1;
    if (before >= 8) {
      showToast('该技能已达到最高等级', 'warning');
      return;
    }
    GameState.skillLevels[card.skillId] = Math.min(8, before + card.power);
    GameState.selectedBoostCards = GameState.selectedBoostCards.filter(id => id !== card.id);
    GameState.cardInventory.splice(index, 1);
    SaveSystem.save();
    this.renderWorkshop();
    this.renderBoostSelection();
    Farm.renderSkillPreview();
    const skill = CONFIG.skills.find(item => item.id === card.skillId);
    showToast(`${skill.name}提升至 Lv.${GameState.skillLevels[card.skillId]}`, 'gold');
  },

  getSelectedBoosts() {
    // v5.6：强化卡只在卡牌工坊“使用”做永久升级（skillLevels），不再局前临选
    return {};
  },

  toggleBoost(cardId) {
    const selected = GameState.selectedBoostCards.includes(cardId);
    if (selected) {
      GameState.selectedBoostCards = GameState.selectedBoostCards.filter(id => id !== cardId);
    } else {
      if (GameState.selectedBoostCards.length >= 3) {
        showToast('每次远征最多携带3张强化卡', 'warning');
        return;
      }
      GameState.selectedBoostCards.push(cardId);
    }
    SaveSystem.save();
    this.renderBoostSelection();
    Farm.renderSkillPreview();
  },

  renderBoostSelection() {
    const grid = document.getElementById('boostCardGrid');
    const count = document.getElementById('boostCardCount');
    if (!grid || !count) return;
    count.textContent = `${GameState.selectedBoostCards.length}/3`;
    grid.innerHTML = '';
    if (GameState.cardInventory.length === 0) {
      grid.innerHTML = '<div style="grid-column:1/-1;color:#71877b;text-align:center;padding:31px 8px;font-size:10px;">卡牌工坊暂无强化卡。收获作物后再来配置。</div>';
      return;
    }
    GameState.cardInventory.forEach(card => {
      const selected = GameState.selectedBoostCards.includes(card.id);
      const skill = CONFIG.skills.find(item => item.id === card.skillId);
      const div = document.createElement('div');
      div.className = `boost-card ${card.rarity}${selected ? ' selected' : ''}`;
      div.onclick = () => this.toggleBoost(card.id);
      const bcArt = (typeof CropArt!=='undefined' && CropArt.ready(card.skillId)) ? CropArt.dom(card.skillId, card.icon, 30) : card.icon;
      div.innerHTML = `${selected ? '<span class="boost-check">✓ 已携带</span>' : ''}<div style="height:32px;display:flex;align-items:center;justify-content:center;">${bcArt}</div><div style="font-size:10px;font-weight:800;color:#effff4;">${skill.name} +${card.power}</div><div style="font-size:8px;color:#91a69b;margin-top:4px;">${this.rarityNames[card.rarity]}卡 · 点击${selected ? '卸下' : '携带'}</div>`;
      grid.appendChild(div);
    });
  },

  renderWorkshop() {
    const skills = document.getElementById('workshopSkills');
    const cards = document.getElementById('workshopCards');
    if (!skills || !cards) return;
    skills.innerHTML = '';
    CONFIG.skills.forEach(baseSkill => {
      const skill = getSkillStats(baseSkill);
      const div = document.createElement('div');
      div.className = 'workshop-skill';
      const EFFECT_TAG = { 稻草猛击:'横扫伤害', 藤蔓缠绕:'定身控制', 泥土遁走:'突进无敌', 烟幕诀:'隐身脱战', 辣椒火息:'锥形灼烧', 豌豆风暴:'速射弹幕', 寒冰屏障:'护盾减速', 荆棘爆发:'反伤光环', 裂地猛击:'范围眩晕', 疾风斩:'位移风刃', 治愈甘霖:'范围回血', 骄阳战鼓:'攻速移速', 毒雾蔓延:'毒云致盲', 金刚藤甲:'减伤霸体', 雷霆链:'连锁闪电', 死神镰舞:'旋转绞杀' };
      const effect = skill.damage ? `伤害 ${skill.damage}` : (skill.heal ? `回血 ${skill.heal}` : (skill.shield ? `护盾 ${skill.shield}` : (skill.stunDuration ? `控制 ${skill.stunDuration}s` : (skill.dashDistance ? `位移 ${skill.dashDistance}` : (skill.stealthDuration ? `隐身 ${skill.stealthDuration}s` : (EFFECT_TAG[skill.name] || '主动技能'))))));
      const wsArt = (typeof CropArt!=='undefined' && CropArt.ready(baseSkill.id)) ? CropArt.dom(baseSkill.id, skill.icon, 32) : skill.icon;
      div.innerHTML = `<div style="height:34px;display:flex;align-items:center;justify-content:center;">${wsArt}</div><div style="font-size:12px;font-weight:800;">${skill.name}</div><div class="level">Lv.${skill.level}</div><div style="font-size:9px;color:#9eb2a7;margin-top:4px;">${effect} · 能量 ${skill.energyCost} · CD ${skill.cooldown}s</div>`;
      skills.appendChild(div);
    });
    cards.innerHTML = '';
    if (GameState.cardInventory.length === 0) {
      cards.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#7f9288;padding:36px;">收获作物时有概率掉落强化卡。高价值作物更容易掉落高品质卡牌；多余的卡可在下方 5 合 1 升级。</div>';
    } else {
      GameState.cardInventory.forEach(card => {
        const div = document.createElement('div');
        div.className = 'upgrade-card ' + card.rarity;
        div.onclick = () => this.apply(card.id);
        const wcArt = (typeof CropArt!=='undefined' && CropArt.ready(card.skillId)) ? CropArt.dom(card.skillId, card.icon, 34) : card.icon;
        div.innerHTML = '<div class="card-rarity">'+this.rarityNames[card.rarity]+'强化卡</div><div class="card-icon" style="display:flex;align-items:center;justify-content:center;">'+wcArt+'</div><div class="card-name">'+card.name+'</div><div class="card-desc">'+card.desc+'<br><span style="color:#f0c866;">点击使用（永久升级）</span></div>';
        cards.appendChild(div);
      });
    }
    this.renderSynth();
  },

  // v5.6 强化卡 5 合 1
  countByRarity(rarity) {
    return GameState.cardInventory.filter(c => c.rarity === rarity).length;
  },
  makeCardOfRarity(rarity) {
    const skill = CONFIG.skills[randInt(0, CONFIG.skills.length - 1)];
    const power = this.rarityPower[rarity] || 1;
    return {
      id: 'card_' + Date.now() + '_' + Math.floor(Math.random() * 100000),
      rarity, power, skillId: skill.id, icon: skill.icon,
      name: skill.name + ' · ' + this.rarityNames[rarity] + '强化',
      desc: '使用后令「' + skill.name + '」永久提升 ' + power + ' 级，最高 8 级。'
    };
  },
  combineCards(rarity) {
    const order = ['common', 'rare', 'legendary'];
    const idx = order.indexOf(rarity);
    const have = this.countByRarity(rarity);
    if (have < 5) { showToast('需要 5 张' + this.rarityNames[rarity] + '卡', 'warning'); return; }
    // 移除 5 张该品质
    let removed = 0;
    GameState.cardInventory = GameState.cardInventory.filter(c => {
      if (c.rarity === rarity && removed < 5) { removed++; return false; }
      return true;
    });
    let out;
    if (idx < order.length - 1) {
      out = this.makeCardOfRarity(order[idx + 1]);
      showToast('5 张' + this.rarityNames[rarity] + '卡合成 1 张' + this.rarityNames[out.rarity] + '卡：' + out.name, 'gold');
    } else {
      // 传说为最高品质：5 张重铸为 1 张随机传说（清理重复）
      out = this.makeCardOfRarity('legendary');
      showToast('传说卡已达最高品质，5 张重铸为 1 张新传说卡：' + out.name, 'gold');
    }
    GameState.cardInventory.push(out);
    if (typeof CardSystem !== 'undefined') CardSystem.showDrop && CardSystem.showDrop(out);
    SaveSystem.save();
    this.renderWorkshop();
  },
  renderSynth() {
    const box = document.getElementById('workshopSynth');
    if (!box) return;
    const order = ['common', 'rare', 'legendary'];
    box.innerHTML = '';
    order.forEach((r, i) => {
      const have = this.countByRarity(r);
      const next = i < order.length - 1 ? this.rarityNames[order[i + 1]] : '随机传说（重铸）';
      const row = document.createElement('div');
      row.className = 'synth-row' + (have >= 5 ? ' ready' : '');
      row.innerHTML = '<div class="synth-left"><span class="synth-badge synth-' + r + '">' + this.rarityNames[r] + '</span>'
        + '<span class="synth-formula">5 张' + this.rarityNames[r] + ' → 1 张' + next + '</span></div>'
        + '<div class="synth-right"><span class="synth-count">持有 ' + have + '</span>'
        + '<button class="secondary-btn" ' + (have < 5 ? 'disabled' : '') + ' onclick="CardSystem.combineCards(\'' + r + '\')">合成</button></div>';
      box.appendChild(row);
    });
  }
};

// ==================== 农场系统 ====================
