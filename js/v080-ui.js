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

    // 更新家园设施位的小字（常驻居民数 + 可接任务提示）
    refreshFacilityState() {
      const el = document.getElementById('npcCountState');
      if (!el || !window.NpcSystem) return;
      NpcSystem.init();
      const npcs = NpcSystem.getAllNpcs();
      let quests = 0;
      npcs.forEach(n => {
        const st = NpcSystem.getNpcState(n.id);
        if (!st) return;
        (n.dialogues.quest || []).forEach(q => {
          if (!st.completedQuests.includes(q.questId) && st.activeQuest !== q.questId && (!q.minAff || st.affection >= q.minAff)) quests++;
        });
      });
      el.textContent = `${npcs.length} 位常驻居民${quests ? ` · ${quests} 个任务可接` : ' · 对话/送礼'}`;
    },

    // NPC 形象：3D 渲染图（v1.11 资产管线）→ 程序化贴图（v1.10）→ emoji 三级回退
    _portrait(npc, size) {
      if (window.NpcPortraits && !NpcPortraits.failed(npc.id)) {
        return `<img src="${NpcPortraits.url(npc.id)}" alt="${npc.name}" style="width:${size}px;height:${size}px;object-fit:contain;" onerror="NpcSystemUI._imgFail('${npc.id}',this)">`;
      }
      return this._fallbackArt(npc, size);
    },
    // 3D 形象加载失败时由 img onerror 调用：就地换源
    _imgFail(npcId, el) {
      const npc = (window.NpcSystem && NpcSystem.NPCS && NpcSystem.NPCS[npcId]) ||
                  (window.AllySystem && AllySystem.DEFS[npcId] ? { id: npcId, icon: '🧝', name: npcId } : null);
      if (!npc) { el.style.display = 'none'; return; }
      const rep = this._fallbackArt(npc, el.clientWidth || 58);
      if (rep.startsWith('<img')) {
        const tmp = document.createElement('div'); tmp.innerHTML = rep;
        el.src = tmp.firstChild.src;
      } else {
        el.outerHTML = rep;
      }
    },
    _fallbackArt(npc, size) {
      if (window.ArtTextures && ArtTextures.npcArt) {
        try {
          if (!this._portraitCache) this._portraitCache = {};
          if (!this._portraitCache[npc.id]) this._portraitCache[npc.id] = ArtTextures.npcArt(npc.id).toDataURL();
          return `<img src="${this._portraitCache[npc.id]}" alt="${npc.name}" style="width:${size}px;height:${size}px;">`;
        } catch (e) { /* 回退 emoji */ }
      }
      return `<span style="font-size:${Math.round(size * .62)}px;line-height:${size}px;display:inline-block;">${npc.icon}</span>`;
    },

    _renderList() {
      const list = document.getElementById('npcList');
      list.innerHTML = '';
      NpcSystem.getAllNpcs().forEach(npc => {
        const st = NpcSystem.getNpcState(npc.id);
        const aff = st ? st.affection : 0;
        // 任务角标：可接/进行中的任务一眼可见
        const questAvailable = st && (npc.dialogues.quest || []).some(q =>
          (st.activeQuest === q.questId && !st.completedQuests.includes(q.questId)) ||
          (!st.completedQuests.includes(q.questId) && st.activeQuest !== q.questId && (!q.minAff || aff >= q.minAff)));
        const questMark = questAvailable
          ? (st.activeQuest ? '<span style="color:#8fd48a;font-size:12px;" title="任务进行中">▶ 进行中</span>' : '<span style="color:#ffd76a;font-size:12px;" title="有可接任务">❗ 可接任务</span>')
          : '';
        const div = document.createElement('div');
        div.className = 'npc-card';
        div.innerHTML = `
          <div class="npc-icon">${this._portrait(npc, 58)}</div>
          <div class="npc-info">
            <div class="npc-name">${npc.name}${npc.weapon ? ` <span class="npc-weapon-tag">⚔ ${npc.weapon.name}</span>` : ''} ${questMark}</div>
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
      const aiOn = !!(window.NPCAI && NPCAI.enabled());
      // 公开版没有 API key：小满仍可被提问，用本地知识库作答
      const canAsk = aiOn || (npcId === 'guide' && typeof NpcKnowledge !== 'undefined');
      const npcShort = npc.name.replace(/·.*$/, '');
      detail.innerHTML = `
        <div class="npc-detail-header">
          <span class="npc-icon-large">${this._portrait(npc, 84)}</span>
          <div>
            <div class="npc-name-large">${npc.name}</div>
            <div class="npc-aff-text">好感度 ${st.affection}/100 ${dlg.isNew ? ' <span style="color:#ffd700;">【新剧情】</span>' : ''} ${aiOn ? '<span style="color:#8fd48a;">● 灵魂对话</span>' : ''}</div>
            ${npc.weapon ? `<div class="npc-weapon" title="${npc.weapon.desc}"><span class="npc-weapon-name">⚔ ${npc.weapon.name}</span> · ${npc.weapon.desc}</div>` : ''}
          </div>
        </div>
        <div class="npc-dialogue-box">
          <div class="npc-dialogue-text" id="npcDialogueText">"${dlg.text}"</div>
          <div class="npc-dialogue-cat" id="npcDialogueCat">[${this._catName(dlg.category)}]${aiOn ? ' <span style="color:#6a8f6a;">（思考中…）</span>' : ''}</div>
        </div>
        ${canAsk ? `
        <div class="npc-ask-row" style="display:flex;gap:6px;margin:8px 0;">
          <input id="npcAskInput" placeholder="${aiOn ? '向' + npcShort + '自由提问…' : '问小满：升级材料 / Boss 弱点 / 作物时间…'}" maxlength="80"
            style="flex:1;background:#1c1f26;border:1px solid #3a3f2e;border-radius:4px;color:#e8e2d4;padding:6px 10px;font-size:12px;outline:none;"
            onkeydown="if(event.key==='Enter')NpcSystemUI.ask('${npcId}')">
          <button onclick="NpcSystemUI.ask('${npcId}')" class="npc-action-btn" style="white-space:nowrap;">提问</button>
        </div>` : ''}
        ${aiOn ? '' : `<div style="font-size:11px;color:#8f9d8a;margin:-2px 0 6px;">AI 未连接 · 小满用随身记事本回答（升级材料 / Boss 弱点 / 配方都能查）</div>`}
        <div class="npc-actions">
          <button onclick="NpcSystemUI.talk('${npcId}')" class="npc-action-btn">再聊一句</button>
          <button onclick="NpcSystemUI.gift('${npcId}')" class="npc-action-btn">送礼（消耗小麦 ×2）</button>
          ${dlg.category === 'quest_offer' ? `<button onclick="NpcSystemUI.acceptQuest('${npcId}','${dlg.questId}')" class="npc-action-btn npc-quest-btn">接受任务</button>` : ''}
        </div>
        <div class="npc-rewards">
          <div class="npc-rewards-title">好感度奖励：</div>
          ${npc.rewards.map(r => `<div class="npc-reward-item ${st.affection >= r.aff ? 'unlocked' : ''}">${r.aff}好感：${r.desc} ${st.affection >= r.aff ? '✅' : '🔒'}</div>`).join('')}
        </div>
      `;
      // AI 增强：异步拉取该 NPC 的主动开场白，成功后替换静态台词（失败静默保留静态对话）
      if (aiOn) {
        NPCAI.chat(npcId, null).then(reply => {
          if (!reply || this._currentNpc !== npcId) return;
          const el = document.getElementById('npcDialogueText');
          const cat = document.getElementById('npcDialogueCat');
          if (el) NPCAI.typeWriter(el, '"' + reply + '"', 26);
          if (cat) cat.innerHTML = '[灵魂对话]';
        });
      }
    },

    // 本地知识库兜底：AI 未配置/连接失败时，小满仍能按资料卡回答具体数值
    _localAnswer(npcId, question) {
      if (npcId !== 'guide' || typeof NpcKnowledge === 'undefined' || !NpcKnowledge.answer) return null;
      const res = NpcKnowledge.answer(question);
      if (!res) return null;
      const head = '我跟你说啊，';
      const tail = res.section === 'boss' ? '——打之前先看清它的技能，别硬顶。' : '——这个我记在小本本上，准没错！';
      return head + res.text + tail;
    },

    // 自由提问（AI 模式）：玩家输入 → NPC 按人设回答
    ask(npcId) {
      const input = document.getElementById('npcAskInput');
      if (!input || !input.value.trim()) return;
      const text = input.value.trim();
      input.value = '';
      const el = document.getElementById('npcDialogueText');
      const cat = document.getElementById('npcDialogueCat');
      // AI 没开（公开版没有 key）→ 直接走本地知识库，零 API 也能问数值
      if (!NPCAI.enabled()) {
        const local = this._localAnswer(npcId, text);
        if (local) {
          if (cat) cat.innerHTML = '[本地记事本]';
          if (el) NPCAI.typeWriter(el, '"' + local + '"', 20);
          return;
        }
      }
      if (el) el.textContent = '……';
      if (cat) cat.innerHTML = '[思考中…]';
      NPCAI.chat(npcId, text, { tools: true }).then(reply => {
        // 工具调用可能改变了金币/仓库/任务，刷新一下农场面板
        if (typeof Farm !== 'undefined' && Farm.render) Farm.render();
        if (typeof SaveSystem !== 'undefined' && SaveSystem.save) SaveSystem.save();
        if (this._currentNpc !== npcId) return;
        if (reply) {
          if (el) NPCAI.typeWriter(el, '"' + reply + '"', 26);
          if (cat) cat.innerHTML = '[灵魂对话]';
        } else {
          const local = this._localAnswer(npcId, text);
          if (local) {
            if (cat) cat.innerHTML = '[本地记事本]';
            if (el) NPCAI.typeWriter(el, '"' + local + '"', 20);
          } else {
            this.talk(npcId); // 降级：回退静态对话池
          }
        }
      });
    },

    gift(npcId) {
      if (Warehouse.removeItem('wheat', 2)) {
        NpcSystem.giveGift(npcId, 'wheat');
        this.talk(npcId);
        if (typeof Farm !== 'undefined') Farm.render();
              SaveSystem.save();
      } else showToast('小麦不足（送礼需要2份小麦）', 'warning');
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
      const markup = (window.EconLoop && EconLoop.globalMarkup) ? EconLoop.globalMarkup() : 1;
      list.innerHTML = `<div class="tech-points-display">🔬 科技点：${GameState.techPoints} · 📈 全局通胀 ×${markup.toFixed(1)}</div>
        <button class="building-upgrade-btn" style="width:100%;margin:4px 0 8px;background:#5a4a2a;" onclick="TechSystemUI.refundAll()">♻️ 经济重铸（全额退还建筑金币 + 科技点）</button>`;
      TechSystem.getAllBuildings().forEach(b => {
        const level = TechSystem.getBuildingLevel(b.id);
        const cost = TechSystem.getUpgradeCost(b.id);
        const reqOk = TechSystem.buildingRequiresMet(b.id);
        // W8 槽位
        const slotted = GameState.buildings[b.id] && GameState.buildings[b.id].slot;
        const slotDef = slotted && CONFIG.buildingItems ? CONFIG.buildingItems[slotted] : null;
        const slotHtml = level > 0 ? `
          <div class="building-slot" style="margin-top:4px;font-size:11px;color:#c9b98a;">
            ${slotDef ? `${slotDef.icon} ${slotDef.name}（${slotDef.desc}）<a href="javascript:void(0)" onclick="TechSystemUI.unslot('${b.id}')" style="color:#e88;">拆除</a>`
              : `（空槽位 · 远征可获建筑道具）`}
          </div>` : '';
        const matStr = cost && cost.matItems ? ' ' + Object.keys(cost.matItems).map(k => {
          const names = { wood: '🪵', iron: '⛓️', crystal: '💎', bossFang: '🦷' };
          return `${names[k] || k}×${cost.matItems[k]}`;
        }).join(' ') : '';
        const reqStr = !reqOk ? `<div style="color:#e88;font-size:11px;">🔒 前置：${TechSystem._requiresText ? TechSystem._requiresText(b) : ''}</div>` : '';
        const div = document.createElement('div');
        div.className = 'building-card';
        div.innerHTML = `
          <div class="building-icon">${b.icon}</div>
          <div class="building-info">
            <div class="building-name">${b.name} Lv.${level}/${b.maxLevel}</div>
            <div class="building-desc">${b.description}</div>
            <div class="building-effect">${level ? '当前：' + b.effects[level - 1].desc : '尚未建造'}${cost ? ' · 下级：' + b.effects[level].desc : ''}</div>
            ${reqStr}${slotHtml}
          </div>
          ${cost ? (reqOk ? `<button class="building-upgrade-btn" onclick="TechSystemUI.upgrade('${b.id}')">升级<br>${cost.gold}💰 ${cost.materials}📦${matStr}</button>` : '<div class="building-max">前置未满足</div>') : '<div class="building-max">已满级</div>'}
        `;
        list.appendChild(div);
      });
      // W8：槽位安装面板（有道具时显示）
      this._renderSlotPanel();
    },

    // W8 建筑配装：列出仓库中可安装道具
    _renderSlotPanel() {
      let panel = document.getElementById('slotPanel');
      if (!panel) {
        panel = document.createElement('div');
        panel.id = 'slotPanel';
        document.getElementById('buildingList').appendChild(panel);
      }
      if (!CONFIG.buildingItems || !window.Warehouse) { panel.innerHTML = ''; return; }
      const owned = Object.keys(CONFIG.buildingItems).filter(id => Warehouse.getCount(id) > 0);
      panel.innerHTML = owned.length ? `
        <div style="font-size:12px;color:#c9b98a;margin:8px 0 4px;">🔩 建筑道具（点击安装到对应建筑）：</div>
        ${owned.map(id => {
          const d = CONFIG.buildingItems[id];
          const tgtLv = TechSystem.getBuildingLevel(d.target);
          return `<button class="building-upgrade-btn" style="display:block;width:100%;text-align:left;margin:2px 0;${tgtLv < 1 ? 'opacity:.45;' : ''}"
            onclick="TechSystemUI.slot('${d.target}','${id}')">${d.icon} ${d.name} ×${Warehouse.getCount(id)} → ${tgtLv >= 1 ? '安装' : '需先建造目标建筑'}<br><span style="font-size:10px;">${d.desc}</span></button>`;
        }).join('')}` : '';
    },

    slot(buildingId, itemId) {
      if (window.EconLoop && EconLoop.slotItem(buildingId, itemId)) { this._renderBuildings(); SaveSystem.save(); }
    },
    unslot(buildingId) {
      if (window.EconLoop && EconLoop.unslotItem(buildingId)) { this._renderBuildings(); SaveSystem.save(); }
    },
    refundAll() {
      if (!window.EconLoop) return;
      const r = EconLoop.refundAll();
      if (typeof showToast === 'function') showToast(`已退还 ${r.gold} 金币、${r.tech} 科技点（建筑与土地等级已重置）`, 'gold');
      this._renderBuildings();
      this._renderTechTree();
      if (typeof Farm !== 'undefined') Farm.render();
      SaveSystem.save();
    },

    upgrade(id) {
      if (TechSystem.upgradeBuilding(id)) {
        this._renderBuildings();
        SaveSystem.save();
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

