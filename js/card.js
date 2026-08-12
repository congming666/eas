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
    banner.innerHTML = `<div style="color:#f3d68d;font-size:10px;">收获掉落 · ${this.rarityNames[card.rarity]}</div><div style="font-size:16px;font-weight:800;margin-top:3px;">${card.icon} ${card.name}</div><div style="font-size:10px;color:#b8c9c0;margin-top:3px;">已送入卡牌工坊</div>`;
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
    const boosts = {};
    GameState.selectedBoostCards.forEach(id => {
      const card = GameState.cardInventory.find(item => item.id === id);
      if (card) boosts[card.skillId] = (boosts[card.skillId] || 0) + card.power;
    });
    return boosts;
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
      div.innerHTML = `${selected ? '<span class="boost-check">✓ 已携带</span>' : ''}<div style="font-size:23px;">${card.icon}</div><div style="font-size:10px;font-weight:800;color:#effff4;">${skill.name} +${card.power}</div><div style="font-size:8px;color:#91a69b;margin-top:4px;">${this.rarityNames[card.rarity]}卡 · 点击${selected ? '卸下' : '携带'}</div>`;
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
      const effect = skill.damage ? `伤害 ${skill.damage}` : (skill.stunDuration ? `控制 ${skill.stunDuration}s` : (skill.dashDistance ? `位移 ${skill.dashDistance}` : `隐身 ${skill.stealthDuration}s`));
      div.innerHTML = `<div style="font-size:25px;">${skill.icon}</div><div style="font-size:12px;font-weight:800;">${skill.name}</div><div class="level">Lv.${skill.level}</div><div style="font-size:9px;color:#9eb2a7;margin-top:4px;">${effect} · 能量 ${skill.energyCost} · CD ${skill.cooldown}s</div>`;
      skills.appendChild(div);
    });
    cards.innerHTML = '';
    if (GameState.cardInventory.length === 0) {
      cards.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#7f9288;padding:46px;">收获作物时有概率掉落强化卡。高价值作物更容易掉落高品质卡牌。</div>';
      return;
    }
    GameState.cardInventory.forEach(card => {
      const div = document.createElement('div');
      div.className = `upgrade-card ${card.rarity}`;
      div.onclick = () => this.apply(card.id);
      div.innerHTML = `<div class="card-rarity">${this.rarityNames[card.rarity]}强化卡</div><div class="card-icon">${card.icon}</div><div class="card-name">${card.name}</div><div class="card-desc">${card.desc}<br><span style="color:#f0c866;">点击使用</span></div>`;
      cards.appendChild(div);
    });
  }
};

// ==================== 农场系统 ====================
