// ================= v0.8.0 NPC + 科技树 UI 渲染（网页版） =================
(function () {
  'use strict';

  // ===== NPC UI =====
  const NpcSystemUI = {
    _currentNpc: null,

    open() {
      NpcSystem.init();
      this._renderList();
      document.getElementById('npcModal').classList.remove('hidden');
    },
    close() { document.getElementById('npcModal').classList.add('hidden'); },

    _renderList() {
      const list = document.getElementById('npcList');
      list.innerHTML = '';
      NpcSystem.getAllNpcs().forEach(npc => {
        const st = NpcSystem.getNpcState(npc.id);
        const aff = st ? st.affection : 0;
        const div = document.createElement('div');
        div.className = 'npc-card';
        div.innerHTML = `
          <div class="npc-icon">${npc.icon}</div>
          <div class="npc-info">
            <div class="npc-name">${npc.name}</div>
            <div class="npc-desc">${npc.description}</div>
            <div class="npc-aff-bar"><div class="npc-aff-fill" style="width:${aff}%"></div></div>
            <div class="npc-aff-text">好感度 ${aff}/100</div>
          </div>
          <button class="npc-talk-btn" onclick="NpcSystemUI.talk('${npc.id}')">对话</button>
        `;
        list.appendChild(div);
      });
    },

    talk(npcId) {
      this._currentNpc = npcId;
      NpcSystem.dailyVisit(npcId);
      const dlg = NpcSystem.getDialogue(npcId, {});
      const npc = NpcSystem.getNpc(npcId);
      const st = NpcSystem.getNpcState(npcId);
      const detail = document.getElementById('npcDetail');
      detail.innerHTML = `
        <div class="npc-detail-header">
          <span class="npc-icon-large">${npc.icon}</span>
          <div>
            <div class="npc-name-large">${npc.name}</div>
            <div class="npc-aff-text">好感度 ${st.affection}/100 ${dlg.isNew ? ' <span style="color:#ffd700;">【新剧情】</span>' : ''}</div>
          </div>
        </div>
        <div class="npc-dialogue-box">
          <div class="npc-dialogue-text">"${dlg.text}"</div>
          <div class="npc-dialogue-cat">[${this._catName(dlg.category)}]</div>
        </div>
        <div class="npc-actions">
          <button onclick="NpcSystemUI.talk('${npcId}')" class="npc-action-btn">再聊一句</button>
          <button onclick="NpcSystemUI.gift('${npcId}')" class="npc-action-btn">送礼（小麦+2）</button>
          ${dlg.category === 'quest_offer' ? `<button onclick="NpcSystemUI.acceptQuest('${npcId}','${dlg.questId}')" class="npc-action-btn npc-quest-btn">接受任务</button>` : ''}
        </div>
        <div class="npc-rewards">
          <div class="npc-rewards-title">好感度奖励：</div>
          ${npc.rewards.map(r => `<div class="npc-reward-item ${st.affection >= r.aff ? 'unlocked' : ''}">${r.aff}好感：${r.desc} ${st.affection >= r.aff ? '✅' : '🔒'}</div>`).join('')}
        </div>
      `;
    },

    gift(npcId) {
      if (GameState.gold >= 10) {
        GameState.gold -= 10;
        NpcSystem.giveGift(npcId, 'wheat');
        this.talk(npcId);
        if (typeof Farm !== 'undefined') Farm.render();
      } else showToast('金币不足（送礼需10金币）', 'warning');
    },

    acceptQuest(npcId, questId) {
      NpcSystem.acceptQuest(npcId, questId);
      this.talk(npcId);
    },

    _catName(cat) {
      const names = { greeting: '问候', weather: '天气', lore: '剧情', quest: '任务', quest_offer: '任务邀请', hint: '提示', idle: '沉默' };
      return names[cat] || cat;
    }
  };

  // ===== 科技树 UI =====
  const TechSystemUI = {
    _currentTree: 'agriculture',

    open() {
      TechSystem.init();
      this._renderBuildings();
      this._renderTechTree();
      document.getElementById('techModal').classList.remove('hidden');
    },
    close() { document.getElementById('techModal').classList.add('hidden'); },

    _renderBuildings() {
      const list = document.getElementById('buildingList');
      list.innerHTML = `<div class="tech-points-display">🔬 科技点：${GameState.techPoints}</div>`;
      TechSystem.getAllBuildings().forEach(b => {
        const level = TechSystem.getBuildingLevel(b.id);
        const cost = TechSystem.getUpgradeCost(b.id);
        const div = document.createElement('div');
        div.className = 'building-card';
        div.innerHTML = `
          <div class="building-icon">${b.icon}</div>
          <div class="building-info">
            <div class="building-name">${b.name} Lv.${level}/${b.maxLevel}</div>
            <div class="building-desc">${b.description}</div>
            <div class="building-effect">${b.effects[Math.min(level, b.effects.length - 1)].desc}</div>
          </div>
          ${cost ? `<button class="building-upgrade-btn" onclick="TechSystemUI.upgrade('${b.id}')">升级<br>${cost.gold}💰 ${cost.materials}📦</button>` : '<div class="building-max">已满级</div>'}
        `;
        list.appendChild(div);
      });
    },

    upgrade(id) {
      if (TechSystem.upgradeBuilding(id)) {
        this._renderBuildings();
        if (typeof Farm !== 'undefined') Farm.render();
      }
    },

    switchTree(treeId) {
      this._currentTree = treeId;
      this._renderTechTree();
    },

    _renderTechTree() {
      const tree = TechSystem.getTechTree(this._currentTree);
      const container = document.getElementById('techTreeContainer');
      container.innerHTML = `
        <div class="tech-tree-tabs">
          ${TechSystem.getAllTechTrees().map(t => `<button class="tech-tab ${t.id === this._currentTree ? 'active' : ''}" style="border-color:${t.color}" onclick="TechSystemUI.switchTree('${t.id}')">${t.icon} ${t.name}</button>`).join('')}
        </div>
        <div class="tech-nodes">
          ${tree.nodes.map(node => {
            const unlocked = TechSystem.isTechUnlocked(node.id);
            const can = TechSystem.canUnlockTech(node.id);
            const reqMet = node.requires.every(r => TechSystem.isTechUnlocked(r));
            return `<div class="tech-node ${unlocked ? 'unlocked' : ''} ${can ? 'available' : ''} ${!reqMet ? 'locked' : ''}" style="border-color:${tree.color}" onclick="TechSystemUI.unlock('${node.id}')">
              <div class="tech-node-name">${node.name}</div>
              <div class="tech-node-desc">${node.desc}</div>
              <div class="tech-node-cost">${unlocked ? '✅ 已解锁' : `${node.cost} 科技点`}</div>
            </div>`;
          }).join('')}
        </div>
      `;
    },

    unlock(techId) {
      if (TechSystem.unlockTech(techId)) {
        this._renderTechTree();
        this._renderBuildings();
      }
    }
  };

  // 日记残页 UI
  const DiaryUI = {
    open() {
      const pages = NpcSystem.getAllPages();
      const collected = NpcSystem.getCollectedPages();
      const container = document.getElementById('diaryContainer');
      container.innerHTML = pages.map(p => `
        <div class="diary-page ${collected.includes(p.id) ? 'collected' : 'locked'}">
          <div class="diary-title">${collected.includes(p.id) ? p.title : '???'}</div>
          <div class="diary-content">${collected.includes(p.id) ? p.content : '尚未发现，来源：' + p.source}</div>
          <div class="diary-source">来源：${p.source}</div>
        </div>
      `).join('');
      document.getElementById('diaryModal').classList.remove('hidden');
    },
    close() { document.getElementById('diaryModal').classList.add('hidden'); }
  };

  window.NpcSystemUI = NpcSystemUI;
  window.TechSystemUI = TechSystemUI;
  window.DiaryUI = DiaryUI;
})();
