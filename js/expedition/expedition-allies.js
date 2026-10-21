// ================= v1.9 游侠盟友系统（NPC 偶尔加入对局） =================
// 逆向参照：元气骑士佣兵（跟随/职业分化/吸火力）· 塔科夫 Scav（中途进场/阵营协作）
//           L4D2 Bot（传送追赶/救援优先级）· Nemesis 友好版（跨局记忆/重逢台词）
//           BG3（战斗插嘴/台词池压缩成本）
// 结构：四游侠原型 × 信号遭遇 × 接纳并肩 × 跟随索敌走位开火 × 聊天气泡 × 跨局记忆 × 撤离分账
(function () {
  'use strict';

  // ===== 跨局记忆（Nemesis 友好版：并肩局数/共同击杀/一起撤离/牺牲记录） =====
  const MEM_KEY = 'fce_ally_mem';
  const AllyMemory = {
    load() { try { return JSON.parse(localStorage.getItem(MEM_KEY) || '{}') || {}; } catch (_) { return {}; } },
    save(m) { try { localStorage.setItem(MEM_KEY, JSON.stringify(m)); } catch (_) {} },
    // 记忆档位：0 初识 / 1 老战友(并肩过) / 2 生死之交(并肩≥5局)
    tier(id) { const m = this.load()[id]; if (!m || !m.runs) return 0; return m.runs >= 5 ? 2 : 1; }
  };

  // ===== 四游侠原型（元气骑士职业分化 + 本作世界观） =====
  const ALLY_DEFS = {
    kael: {
      id: 'kael', name: '断刃·凯尔', title: '断刃', role: '近战狂人',
      hp: 280, speed: 178, kind: 'melee', range: 64, damage: 16, atkCd: 1.05,
      tauntR: 220,                 // 嘲讽光环（L4D2 吸火力价值：怪更愿意打他）
      sfx: 'knife', color: '#d8c8b0',
      lines: {
        join: ['这把断刀还能砍。带我一个。', '你背后的空档，交给我。', '兽潮的方向就是我的方向。'],
        joinOld: ['又是你？正好，我还欠你一顿酒。', '老搭档！这次换我护着你。'],
        joinSworn: ['生死之交不需要客套——并肩！', '第 {runs} 次了。你活着，我就活着。'],
        fight: ['让开！这片我包了！', '哈！就这？', '别停！跟上我的刀锋！'],
        elite: ['有点骨头的家伙，交给我！', '精英？正好活动筋骨。'],
        boss: ['大家伙……都退我身后！', '这货归我缠住，你找空档！'],
        playerLow: ['你流血了！撑住——！', '别倒！我这有绷带！'],
        beastWave: ['兽潮！背靠背，别被冲散！', '来了多少？够我砍的。'],
        extract: ['撤！我殿后！', '往撤离点跑，别回头！'],
        farewell: ['哈——活着的感觉。拿去，我抢的战利品。', '痛快！下个路口再见。'],
        death: ['值了……替我……看看春天……', '刀……断了……', '别管我……快走……'],
        downed: ['我倒了……拉我一把！', '膝盖中了一刀……扶我起来还能打！'],
        revived: ['欠你一条命！', '哈——又活过来了！继续！'],
        lootWeapon: ['这刀不错，归我了。', '好武器！看我的。'],
        leave: ['看来你不需要帮手。祝好运。']
      }
    },
    lore: {
      id: 'lore', name: '双枪·洛蕾', title: '双枪', role: '远程游侠',
      hp: 175, speed: 168, kind: 'gun', range: 430, damage: 9, atkCd: 0.55, bulletSpeed: 380,
      preferElite: true, sfx: 'pea', color: '#e8c86a',
      lines: {
        join: ['双枪洛蕾，佣兵行情——今天免单。', '一个人打太无聊了，让我加入。', '听说你常去危险的地方？带上我。'],
        joinOld: ['哟，老熟人！这次利息就免了。', '又见面啦——你的枪法进步了没？'],
        joinSworn: ['第 {runs} 次并肩。这世上我只信两把枪——和你。', '你救过我，这次我押上性命。'],
        fight: ['左边那个归我！', '看枪法！', '你们太慢了~'],
        elite: ['戴帽子的那个最值钱，归我。', '精英？我的最爱。'],
        boss: ['大家伙！弱点在哪……找到了！', '打它眼睛！信我！'],
        playerLow: ['趴下！我掩护你！', '撑住，我把它们压回去！'],
        beastWave: ['哈，大买卖来了。子弹管够！', '数不清了……那就都别想跑。'],
        extract: ['边打边撤，跟上节奏！', '撤啦撤啦，钱要落袋为安！'],
        farewell: ['佣金免了——这些是我抢的，分你。', '合作愉快！江湖再见。'],
        death: ['枪……还烫着……', '抱歉……先走一步……', '下一世……再并肩……'],
        downed: ['掩护我……我起不来了……', '枪还在！拉我起来！'],
        revived: ['谢了！子弹上膛！', '这条命，记你账上——免单。'],
        lootWeapon: ['这枪保养得不错，笑纳了。', '火力升级！'],
        leave: ['不需要帮手？行，别浪费我时间~']
      }
    },
    chen: {
      id: 'chen', name: '老军医·陈', title: '军医', role: '战地奶妈',
      hp: 210, speed: 162, kind: 'healgun', range: 320, damage: 5, atkCd: 0.9, bulletSpeed: 300,
      healCd: 6, healAmount: 14,           // L4D2 Bot 递药：周期治疗玩家
      sfx: 'pea', color: '#bfe8d0',
      lines: {
        join: ['老军医陈，退休了但手痒。带上我，你能多活十分钟。', '别嫌弃我枪法——我治人的本事比开枪强。', '战场需要医生。我来了。'],
        joinOld: ['又是你？上次那口锅还你——这次我带上全副家当。', '你小子命硬。正好，我喜欢命硬的病人。'],
        joinSworn: ['第 {runs} 次了。你活着回来的每一次，都是我的勋章。', '我把最后的绷带留给你。'],
        fight: ['都别受伤，我可只有两只手！', '退后点！让我看看伤口！', '省着点血，给我省点药！'],
        elite: ['那家伙看着就危险……都小心！', '我来盯着你们俩的血线！'],
        boss: ['这伤势扛不住两次……全员谨慎！', '稳住！我在，就死不了！'],
        playerLow: ['伤员优先！都往我这边靠！', '别逞强！停下来让我缝两针！'],
        beastWave: ['兽潮……绷带还够，都别慌！', '听我口令——保命第一！'],
        extract: ['撤！我带的是急救包，跑得慢，护着我！', '能救一个是一个，撤！'],
        farewell: ['都活着，就是最好的战果。这些药留给你。', '记住了：受伤就撤，别硬扛。'],
        death: ['药箱……在左边……自己拿……', '救了半辈子人……最后……', '你们……快走……'],
        downed: ['老大夫摔了……谁来扶一把……', '药箱还没空……我不能倒……'],
        revived: ['咳……多谢。你的绷带我包了。', '好，好……接着救人。'],
        lootWeapon: ['手术刀换大刀……也行。', '这玩意儿也能救人——先撂倒它们。'],
        leave: ['不需要医生？那你最好别受伤。']
      }
    },
    miao: {
      id: 'miao', name: '藤语者·苗', title: '藤语者', role: '控场辅助',
      hp: 190, speed: 160, kind: 'vine', range: 380, damage: 7, atkCd: 1.0, bulletSpeed: 300,
      slowOnHit: 0.45, slowDur: 2,        // 藤蔓减速弹（呼应融合计划世界观）
      sfx: 'vine', color: '#8fd8a8',
      lines: {
        join: ['藤语者苗。草木……愿意帮我。你愿意吗？', '荒野太安静了。让我跟着你的火光。', '它们在低语——说你需要同伴。'],
        joinOld: ['风里又有你的味道了。我来了。', '草木记得你。我也记得。'],
        joinSworn: ['第 {runs} 次。藤蔓缠绕的地方，就是我们的阵地。', '我的根须……早已和你相连。'],
        fight: ['慢下来……让荆棘拥抱你们。', '这片土地不欢迎你们。', '根须，缠住。'],
        elite: ['它很强……但大地站在我们这边。', '藤蔓——绊住它！'],
        boss: ['连大地都在颤抖……集中！', '古树的怨怒，与我们一起！'],
        playerLow: ['你的血在滴……快退到我身后！', '荆棘会保护你，撑住！'],
        beastWave: ['兽群躁动……大地母亲，借我力量。', '让藤蔓铺满它们的路。'],
        extract: ['土地指引归途。撤吧。', '风向东……撤离点在等。'],
        farewell: ['草木结的果，分你一半。', '万物有灵……后会有期。'],
        death: ['我……回到泥土里去了……', '种子……会替我……看着你……', '别难过……这是轮回……'],
        downed: ['根……被扯断了……扶我……', '大地啊……再借我一次力量……'],
        revived: ['藤蔓重新发芽了。谢谢你。', '根须又扎稳了——继续吧。'],
        lootWeapon: ['草木说……这件武器有灵性。', '借自然之力一用。'],
        leave: ['你并不孤独。去吧。']
      }
    }
  };

  // ===== v5.8.7 游侠日程栈（SDV 竞品解法：出现逻辑从纯概率改为优先级覆盖栈） =====
  // 层从上往下优先级递减，命中即决定本局「谁来、为什么来」——玩家可通过天气/兽潮/交情预测，
  // 「出现逻辑可被学习」本身就是收集乐趣（SDV 心级改变 NPC 去向的同款设计）。
  // 每层：when(ctx) 命中 + weight 权重表 + flavor 召唤理由（写进 toast，可被玩家学习）
  const ALLY_SCHEDULE = [
    { id: 'beast', // 特殊局况：兽潮进行中或 45s 内将至
      when: (g) => !!(g.beastWave && (g.beastWave.active || (g.beastWave.nextIn <= 45 && g.elapsed >= 60))),
      weights: { kael: 3, lore: 2, chen: 1.5, miao: 1 },
      flavor: (def) => `兽潮的腥风起来了——「${def.name}」循着厮杀声赶来助阵` },
    { id: 'storm', // 天气：雷暴（含 12s 预警中的预报）
      when: (g) => weatherId(g) === 'storm' || weatherNext(g) === 'storm',
      weights: { miao: 3, kael: 2, chen: 1.5, lore: 1 },
      flavor: (def) => `雷暴在云里滚动——「${def.name}」借天地之力而来` },
    { id: 'snow', // 天气：降雪（严寒需要医生）
      when: (g) => weatherId(g) === 'snow',
      weights: { chen: 3, kael: 1.5, miao: 1.5, lore: 1 },
      flavor: (def) => `雪越下越大——「${def.name}」踏雪而至` },
    { id: 'fog', // 天气：浓雾（枪手靠听力索敌）
      when: (g) => weatherId(g) === 'fog',
      weights: { lore: 3, chen: 1.5, miao: 1.5, kael: 1 },
      flavor: (def) => `浓雾里传来脚步声——「${def.name}」循声找到了你` },
    { id: 'rain', // 天气：降雨（草木逢雨）
      when: (g) => weatherId(g) === 'rain' || weatherId(g) === 'heavy_rain',
      weights: { miao: 2.5, chen: 2, kael: 1, lore: 1 },
      flavor: (def) => `雨丝落进荒野——「${def.name}」沿着湿润的泥土走来` },
    { id: 'bond', // 好感：生死之交（并肩 ≥5 局）会主动循着旧战场找来
      when: (g, mem, ids) => ids.some((id) => memTier(mem, id) >= 2),
      weights: { kael: 1, lore: 1, chen: 1, miao: 1 },
      boost: (mem, id) => memTier(mem, id) >= 2 ? 3 : 0,
      flavor: (def) => `熟悉的身影拨开荒草——生死之交「${def.name}」循着旧战场找来了` },
    { id: 'oldfriend', // 好感：老战友（并肩过）优先重逢
      when: (g, mem, ids) => ids.some((id) => memTier(mem, id) >= 1),
      weights: { kael: 1, lore: 1, chen: 1, miao: 1 },
      boost: (mem, id) => memTier(mem, id) >= 1 ? 2 : 0.5,
      flavor: (def) => `远处的火光晃了晃——老战友「${def.name}」发出了并肩信号` },
    { id: 'normal', // 常规兜底
      when: () => true,
      weights: { kael: 1, lore: 1, chen: 1, miao: 1 },
      flavor: (def) => `远处的游侠「${def.name}」发出了并肩信号` }
  ];

  function weatherId(g) { return (g.weather && g.weather.state) || 'clear'; }
  function weatherNext(g) { return (g.weather && g.weather.next) || null; }
  function memTier(mem, id) { const m = mem[id]; if (!m || !m.runs) return 0; return m.runs >= 5 ? 2 : 1; }

  // 覆盖栈求值：自上而下取第一个「命中且候选非空」的层，层内按权重×好感加成随机
  function pickAllyBySchedule(g, ids, mem) {
    for (const layer of ALLY_SCHEDULE) {
      if (!layer.when(g, mem, ids)) continue;
      const pool = ids
        .map((id) => {
          const w = (layer.weights[id] || 0) + (layer.boost ? layer.boost(mem, id) : 0);
          return { id, w };
        })
        .filter((c) => c.w > 0);
      if (!pool.length) continue;
      const total = pool.reduce((s, c) => s + c.w, 0);
      let r = Math.random() * total;
      for (const c of pool) { r -= c.w; if (r <= 0) return { id: c.id, layer }; }
      return { id: pool[pool.length - 1].id, layer };
    }
    return null;
  }

  Object.assign(Expedition.prototype, {
    // ---------- 生成信号（塔科夫 mid-raid：对局中段遭遇） ----------
    maybeSpawnAllySignal(dt) {
      if (this.gameOver || this.dying || this.extracting) return;
      if (this.allySignal) return;
      // 队伍上限 2：满员不再刷信号（倒地不占位——倒地游侠需要你去救）
      const alive = (this.allies || []).filter(a => a.hp > 0 && !a.downed);
      if (alive.length >= 2) return;
      if (this.elapsed < 60) return;                        // 前 60s 绝不打扰
      this._allyRollT = (this._allyRollT || 0) + dt;
      if (this._allyRollT < 25) return;
      this._allyRollT = 0;
      // 180s 保底（大部分对局都能遇到一次）
      const chance = this.elapsed >= 180 ? 1 : 0.45;
      if (Math.random() >= chance) return;
      // v5.8.7 SDV 式优先级覆盖栈选人（兽潮 > 天气 > 好感 > 常规），不与队内在场游侠重复
      const mem = AllyMemory.load();
      const inSquad = new Set((this.allies || []).map(a => a.def.id));
      const ids = Object.keys(ALLY_DEFS).filter(id => !inSquad.has(id));
      if (!ids.length) return;
      const pick = pickAllyBySchedule(this, ids, mem);
      if (!pick) return;
      const def = ALLY_DEFS[pick.id];
      // 出生在视野外不远处（600px 环带；玩家靠边时重掷角度，clamp 后仍保距离感）
      const size = CONFIG.expedition.mapSize;
      let x, y;
      for (let i = 0; i < 12; i++) {
        const a = rand(0, Math.PI * 2);
        x = clamp(this.player.x + Math.cos(a) * 600, 120, size - 120);
        y = clamp(this.player.y + Math.sin(a) * 600, 120, size - 120);
        if (Math.hypot(x - this.player.x, y - this.player.y) >= 420) break;
      }
      this.allySignal = { x, y, def, t: 60, pulseT: 0, layerId: pick.layer.id };
      showToast(pick.layer.flavor(def), 'info'); // 召唤理由入 toast：玩家可学习「什么局况会召唤谁」
      this.spawnAoeEffect(x, y, 40, '#7fd8c0');
    },

    // ---------- 接纳（元气骑士雇佣的免费版：走近点击） ----------
    recruitAlly() {
      const sig = this.allySignal;
      if (!sig) return false;
      const def = sig.def;
      const mem = AllyMemory.load()[def.id] || { runs: 0, kills: 0, extracts: 0 };
      const tier = AllyMemory.tier(def.id);
      const tierMul = 1 + (this.map.tier - 1) * 0.35;              // 地图难度缩放
      const memHp = tier === 2 ? 1.2 : tier === 1 ? 1.1 : 1;        // 记忆加成
      const memDmg = tier === 2 ? 1.2 : 1;
      const hp = Math.round(def.hp * tierMul * memHp);
      const dmg = def.damage * tierMul * memDmg;
      this.allies.push({
        def, x: sig.x, y: sig.y, hp, maxHp: hp, damage: dmg,
        speed: def.speed, radius: 15, state: 'follow',
        attackCd: 0.5, healCd: def.healCd || 0, animT: 0, facing: 0,
        followAng: rand(0, Math.PI * 2), bubble: null, idleTalkT: rand(16, 28),
        coKills: 0, hitFlash: 0, deadT: 0, leaveT: 0
      });
      this.allySignal = null;
      const line = tier === 2 ? this._allyLine(def, 'joinSworn', mem)
        : tier === 1 ? this._allyLine(def, 'joinOld', mem)
        : this._allyLine(def, 'join');
      this._allyBubble(this.allies[this.allies.length - 1], line);
      const title = tier === 2 ? '生死之交' : tier === 1 ? '老战友' : '新面孔';
      this.showCinematicBanner(`⚔ 游侠「${def.name}」加入并肩 ⚔`, `${def.role} · ${title} · ${def.title}会战斗、会说话、也会记住你`, 'mission', 2.2);
      if (typeof AudioManager !== 'undefined' && AudioManager.playMissionComplete) AudioManager.playMissionComplete();
      return true;
    },

    // ---------- 台词工具 ----------
    _allyLine(def, key, mem) {
      const pool = def.lines[key];
      if (!pool || !pool.length) return '';
      let text = pool[Math.floor(Math.random() * pool.length)];
      if (mem) text = text.replace('{runs}', mem.runs || 1);
      return text;
    },
    _allyBubble(ally, text) {
      if (!text) return;
      const now = this.elapsed || 0;
      if (this._allyBubbleCd && now < this._allyBubbleCd) return;   // 全局冷却 4s（BG3 防刷屏）
      this._allyBubbleCd = now + 4;
      ally.bubble = { text, t: 3.2 };
    },
    // 事件台词钩子（一次性 flag / 每类每局一次）
    allySay(key) {
      const alive = (this.allies || []).filter(a => a.hp > 0);
      if (!alive.length) return;
      this._allySaid = this._allySaid || {};
      if (this._allySaid[key]) return;
      this._allySaid[key] = true;
      const a = alive[Math.floor(Math.random() * alive.length)];
      this._allyBubble(a, this._allyLine(a.def, key));
    },

    // ---------- 盟友 AI 主循环 ----------
    updateAllies(dt) {
      this.maybeSpawnAllySignal(dt);
      // 信号阶段：倒计时 + 信号弹脉冲；超时游侠自行离开
      const sig = this.allySignal;
      if (sig) {
        sig.t -= dt; sig.pulseT = (sig.pulseT || 0) - dt;
        if (sig.pulseT <= 0) { sig.pulseT = 2; this.spawnAoeEffect(sig.x, sig.y, 26, '#7fd8c0'); }
        if (sig.t <= 0) {
          showToast(`游侠「${sig.def.name}」等你太久，独自上路了`, 'info');
          this.allySignal = null;
        }
      }
      if (!this.allies || !this.allies.length) return;
      const size = CONFIG.expedition.mapSize;
      // 兽潮触发台词（rising edge）
      if (this.beastWave && this.beastWave.active && !this._allySaidBeast) { this._allySaidBeast = true; this.allySay('beastWave'); }

      for (let i = this.allies.length - 1; i >= 0; i--) {
        const a = this.allies[i];
        a.hitFlash = Math.max(0, a.hitFlash - dt);
        if (a.bubble) { a.bubble.t -= dt; if (a.bubble.t <= 0) a.bubble = null; }
        // 倒地救援（L4D2 救援优先级）：hp 归零 → 倒地 25s 呼救；玩家贴身 2s 扶起（40% 血归队）；超时牺牲
        if (a.hp <= 0) {
          if (!a.downed) {
            a.downed = true; a.downedT = 25; a.reviveP = 0;
            a.bubble = { text: this._allyLine(a.def, 'downed'), t: 3.5 };
            showToast(`游侠「${a.def.name}」倒下了！靠近停留 2 秒可扶起`, 'warning');
          }
          a.downedT -= dt;
          const dpDown = dist(a, this.player);
          if (dpDown < 64 && !this.paused && this.player.hp > 0) {
            a.reviveP = (a.reviveP || 0) + dt;
            if (a.reviveP >= 2) {
              a.downed = false;
              a.hp = Math.round(a.maxHp * 0.4);
              a.bubble = { text: this._allyLine(a.def, 'revived'), t: 3 };
              this.spawnAoeEffect(a.x, a.y, 40, '#7fd8c0');
              this.pushCombatFeedback('救援成功', '#7fff9f', a.x, a.y - 30, 1.1);
              if (typeof AudioManager !== 'undefined' && AudioManager.playChestOpen) AudioManager.playChestOpen();
              this._allyMemoryWrite(a.def.id, m => { m.revived = (m.revived || 0) + 1; });
              continue;
            }
          } else a.reviveP = Math.max(0, (a.reviveP || 0) - dt * .5);
          if (a.downedT <= 0) {
            if (!a._saidDeath) { a._saidDeath = true; a.bubble = { text: this._allyLine(a.def, 'death'), t: 3.5 }; a.deadT = 4; }
            a.deadT -= dt;
            if (a.deadT <= 0) {
              this._allyMemoryWrite(a.def.id, m => { m.died = (m.died || 0) + 1; });
              showToast(`游侠「${a.def.name}」牺牲了……`, 'warning');
              this.allies.splice(i, 1);
            }
          }
          continue;
        }
        a.animT += dt;
        a.attackCd = Math.max(0, a.attackCd - dt);
        a.hitCd = Math.max(0, (a.hitCd || 0) - dt);
        if (a.def.healCd) a.healCd = Math.max(0, a.healCd - dt);
        const p = this.player;
        const dp = dist(a, p);

        // L4D2 传送追赶：掉队太远直接归位（工程兜底，防丢失）
        if (dp > 500 && !this.paused) {
          const ba = Math.atan2(p.y - a.y, p.x - a.x) + Math.PI;   // 玩家背后
          a.x = clamp(p.x + Math.cos(ba) * 80, 40, size - 40);
          a.y = clamp(p.y + Math.sin(ba) * 80, 40, size - 40);
          this.spawnAoeEffect(a.x, a.y, 18, '#7fd8c0');
        }

        // 索敌：精英偏好 > 玩家正在打的 > 最近
        const tgt = this._allyCombatTarget(a);
        const lowHp = a.hp / a.maxHp < 0.35;
        let moved = false;
        if (tgt && !this.paused) {
          const dt2 = dist(a, tgt);
          a.facing = Math.atan2(tgt.y - a.y, tgt.x - a.x);
          if (a.def.kind === 'melee') {
            if (dt2 > a.def.range) {
              this._allyMove(a, tgt.x, tgt.y, dt, 1); moved = true;
            } else if (a.attackCd <= 0) {
              a.attackCd = a.def.atkCd;
              this.spawnSlashEffect(a.x + Math.cos(a.facing) * 26, a.y + Math.sin(a.facing) * 22, a.facing, '#e8dcc0', 42);
              this.damageEnemy(tgt, a.damage, a.def.color, true, {
                x: a.x, y: a.y, angle: a.facing, weaponId: '', fromPlayer: false, fromAlly: true
              });
              this._allySfx('knife');
            }
          } else {
            // 枪系：保持火力距离（200-420），太近退拉开
            if (dt2 > a.def.range) { this._allyMove(a, tgt.x, tgt.y, dt, 1); moved = true; }
            else if (dt2 < 200) { this._allyMove(a, a.x * 2 - tgt.x, a.y * 2 - tgt.y, dt, 0.85); moved = true; }
            else if (a.attackCd <= 0) {
              a.attackCd = a.def.atkCd;
              a.shotsFired = (a.shotsFired || 0) + 1;   // v1.9 射击计数（验收/调试用）
              const ang = Math.atan2(tgt.y - a.y, tgt.x - a.x);
              const proj = this.allocProjectile();
              Object.assign(proj, {
                x: a.x, y: a.y, vx: Math.cos(ang) * a.def.bulletSpeed, vy: Math.sin(ang) * a.def.bulletSpeed,
                damage: a.damage, life: 1.4, fromAlly: true, radius: 5, color: a.def.color,
                slowOnHit: a.def.slowOnHit, slowDur: a.def.slowDur
              });
              proj.hit = proj.hit || []; proj.hit.length = 0;
              this.projectiles.push(proj);
              this._allySfx(a.def.sfx);
            }
          }
        }
        // 跟随（无目标或低血后撤）
        if (!moved && !this.paused) {
          a.followAng += dt * 0.25;                                  // 缓慢绕行，不站死一个点
          let fx, fy, want = 112;
          if (lowHp) {                                               // L4D2 智慧：残血撤到玩家身后
            const ba = Math.atan2(p.y - a.y, p.x - a.x);
            fx = p.x + Math.cos(ba + Math.PI) * 60; fy = p.y + Math.sin(ba + Math.PI) * 60; want = 55;
          } else {
            fx = p.x + Math.cos(a.followAng) * 118; fy = p.y + Math.sin(a.followAng) * 118;
          }
          const dfx = fx - a.x, dfy = fy - a.y;
          const dd = Math.hypot(dfx, dfy);
          if (dd > want) {
            a.facing = Math.atan2(dfy, dfx);
            this.moveEntityWithCollisions(a, dfx / dd * a.speed * dt, dfy / dd * a.speed * dt);
          }
        }
        // 军医治疗（L4D2 递药 Bot）
        if (a.def.healCd && a.healCd <= 0 && p.hp > 0 && p.hp < p.maxHp * 0.85 && dp < 300) {
          a.healCd = a.def.healCd;
          const heal = Math.round(a.def.healAmount * (1 + (this.map.tier - 1) * 0.35));
          p.hp = Math.min(p.maxHp, p.hp + heal);
          this.pushCombatFeedback('+' + heal, '#7fff9f', p.x, p.y - 26, 0.9);
          this.spawnAoeEffect(p.x, p.y, 26, '#9fffc0');
          if (typeof AudioManager !== 'undefined' && AudioManager.playChestOpen) AudioManager.playChestOpen();
        }
        // 捡武器（元气骑士佣兵：路过武器掉落 → 捡起，伤害 +30%，每局限一次）
        if (!a.pickedWeapon && this.groundLoot && !this.paused) {
          let wi = -1;
          for (let li = 0; li < this.groundLoot.length; li++) {
            const it = this.groundLoot[li];
            if (it && it.type === 'weapon_drop' && dist(a, it) < 320) { wi = li; break; }
          }
          if (wi >= 0) {
            const it = this.groundLoot[wi];
            if (dist(a, it) > 26) this._allyMove(a, it.x, it.y, dt, 1.05);
            else {
              this.groundLoot.splice(wi, 1);
              a.pickedWeapon = true;
              a.damage = Math.round(a.damage * 1.3);
              this._allyBubble(a, this._allyLine(a.def, 'lootWeapon'));
              this.spawnAoeEffect(a.x, a.y, 24, '#ffd98a');
              showToast(`游侠「${a.def.name}」捡起武器，伤害提升！`, 'info');
            }
          }
        }
        // 闲聊插嘴（BG3 战斗 banter：低频随机）
        a.idleTalkT -= dt;
        if (a.idleTalkT <= 0) {
          a.idleTalkT = rand(18, 30);
          if (tgt && Math.random() < 0.5) this._allyBubble(a, this._allyLine(a.def, 'fight'));
        }
      }
    },
    _allyMove(a, tx, ty, dt, mul) {
      const ang = Math.atan2(ty - a.y, tx - a.x);
      a.facing = ang;
      this.moveEntityWithCollisions(a, Math.cos(ang) * a.speed * mul * dt, Math.sin(ang) * a.speed * mul * dt);
    },
    _allySfx(kind) {
      if (typeof AudioManager === 'undefined' || !AudioManager.playAttack) return;
      const now = this.elapsed || 0;
      if (this._allySfxCd && now < this._allySfxCd) return;
      this._allySfxCd = now + 0.18;
      AudioManager.playAttack(kind === 'vine' ? 'vine' : kind === 'knife' ? 'knife' : 'pea');
    },
    // 索敌优先级：精英偏好（洛蕾）> 玩家正在攻击的 > 最近
    _allyCombatTarget(a) {
      let best = null, bd = 1e9;
      const consider = (m, bonus) => {
        if (!m || m.hp <= 0 || m.state === 'death') return;
        const d = dist(a, m);
        if (d > 540) return;
        const score = d * (bonus || 1);
        if (score < bd) { bd = score; best = m; }
      };
      if (a.def.preferElite) this.monsters.forEach(m => { if (m.elite || m.type === 'boss') consider(m, 0.6); });
      if (this.lastAttacked && this.lastAttacked.hp > 0) consider(this.lastAttacked, 0.8);
      this.entitySpatialHash.queryCircle(a.x, a.y, 540).forEach(m => {
        if (this.monsters.includes(m)) consider(m, 1);
      });
      return best;
    },
    // 吸火力（元气骑士核心价值）：凯尔嘲讽光环 / 其他盟友显著更近时，怪转火盟友
    _allyAggroTarget(m) {
      if (!this.allies || !this.allies.length) return null;
      const dp = dist(m, this.player);
      for (const a of this.allies) {
        if (a.hp <= 0) continue;
        const da = dist(m, a);
        if (a.def.tauntR && da < a.def.tauntR && da < dp * 1.35) return a;
        if (da < dp * 0.6) return a;
      }
      return null;
    },

    // ---------- 盟友承伤 ----------
    damageAlly(a, amount, source) {
      if (!a || a.hp <= 0 || amount <= 0) return;
      a.hp -= amount;
      a.hitFlash = 0.15;
      this.damageNumbers.push({ x: a.x + rand(-8, 8), y: a.y - 20, value: '-' + Math.round(amount), color: '#e8a8a0', life: .55, maxLife: .55, vx: rand(-14, 14), vy: -46, heavy: false });
      if (a.hp <= 0 && source) {
        this.spawnAoeEffect(a.x, a.y, 34, '#88b8a0');
        showToast(`游侠「${a.def.name}」倒下了……`, 'warning');
      }
    },

    // ---------- 记忆写入 ----------
    _allyMemoryWrite(id, fn) {
      const mem = AllyMemory.load();
      const m = mem[id] || { runs: 0, kills: 0, extracts: 0, died: 0 };
      fn(m);
      mem[id] = m;
      AllyMemory.save(mem);
    },

    // ---------- 结算分账（撤离成功 → 临别礼 + 记忆） ----------
    allySettlement() {
      const alive = (this.allies || []).filter(a => a.hp > 0);
      const totalCoKills = (this.allies || []).reduce((s, a) => s + (a.coKills || 0), 0) + (this.allyKills || 0);
      (this.allies || []).forEach(a => {
        this._allyMemoryWrite(a.def.id, m => { m.runs = (m.runs || 0) + 1; m.kills = (m.kills || 0) + (a.coKills || 0); });
      });
      if (!alive.length) return null;
      if (this.result === 'success') {
        const gift = 40 + totalCoKills * 3 + this.map.tier * 15;
        GameState.gold += gift;
        const a = alive[0];
        this._allyBubble(a, this._allyLine(a.def, 'farewell'));
        alive.forEach(a2 => this._allyMemoryWrite(a2.def.id, m => { m.extracts = (m.extracts || 0) + 1; }));
        showToast(`游侠临别礼：「${a.def.name}」分你 ${gift} 金币（共同击杀 ${totalCoKills}）`, 'gold');
        return { name: a.def.name, gift, kills: totalCoKills };
      }
      return null;
    },

    // ---------- 渲染：游侠本体（挂 renderSortedEntities） ----------
    renderAlly(ctx, a, cam) {
      const sx = a.x - cam.x, sy = a.y - cam.y;
      const P = (typeof NpcPortraits !== 'undefined') ? NpcPortraits : null;
      const art = (typeof ArtTextures !== 'undefined') ? ArtTextures.allyArt(a.def.id) : null;
      ctx.save();
      // 地面影（3D 形象无烘焙影，运行时补）
      ctx.fillStyle = 'rgba(5,10,6,.35)';
      ctx.beginPath(); ctx.ellipse(sx, sy - 2, 15, 5, 0, 0, Math.PI * 2); ctx.fill();
      if (a.hp <= 0) {
        if (a.downed) { /* 倒地跪伏：压低 + 半透明 + 求救脉冲环 */
          ctx.globalAlpha = 0.82; ctx.translate(0, 8); ctx.scale(1.06, 0.82);
        } else { ctx.globalAlpha = Math.max(0.15, a.deadT / 4 * 0.8); ctx.translate(0, 6); ctx.rotate(0.5); }
      }
      if (a.hitFlash > 0) ctx.globalAlpha *= 0.75;
      let drawn = false;
      if (P) drawn = P.drawWorld(ctx, a.def.id, sx, sy, 62);
      if (!drawn && art) ctx.drawImage(art, sx - 26, sy - 52, 52, 60);
      else if (!drawn) { ctx.font = '26px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('🧝', sx, sy + 6); }
      ctx.restore();
      if (a.hp > 0) {
        // 血条 + 名字（青绿系，与玩家/怪区分）
        const pct = a.hp / a.maxHp;
        ctx.fillStyle = 'rgba(10,16,14,.8)'; ctx.fillRect(sx - 22, sy - 62, 44, 5);
        ctx.fillStyle = pct < 0.35 ? '#e8b060' : '#7fd8c0'; ctx.fillRect(sx - 22, sy - 62, 44 * pct, 5);
        ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(8,12,10,.85)';
        ctx.fillText(a.def.name, sx + 1, sy - 66);
        ctx.fillStyle = '#bfe8dc';
        ctx.fillText(a.def.name, sx, sy - 67);
      } else if (a.downed) {
        // 倒地：求救脉冲环 + 倒计时弧 + 扶起提示
        const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * 6);
        ctx.save();
        ctx.strokeStyle = `rgba(255,120,90,${.5 + .4 * pulse})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(sx, sy - 10, 20 + pulse * 5, 0, Math.PI * 2); ctx.stroke();
        // 救援读条
        if (a.reviveP > 0) {
          ctx.strokeStyle = '#7fd8c0'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(sx, sy - 10, 15, -Math.PI / 2, -Math.PI / 2 + (a.reviveP / 2) * Math.PI * 2); ctx.stroke();
        }
        ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = '#ffb59a';
        ctx.fillText(`倒地 ${Math.ceil(a.downedT)}s · 靠近扶起`, sx, sy - 34);
        ctx.restore();
      }
      // 聊天气泡（BG3 战斗插嘴的呈现层）
      if (a.bubble && a.bubble.t > 0) {
        const alpha = Math.min(1, a.bubble.t / 0.5);
        ctx.save(); ctx.globalAlpha = alpha;
        ctx.font = '12px sans-serif';
        const tw = ctx.measureText(a.bubble.text).width;
        const bw = tw + 16, bx = sx - bw / 2, by = sy - 92;
        ctx.fillStyle = 'rgba(14,20,18,.92)';
        ctx.strokeStyle = 'rgba(127,216,192,.55)'; ctx.lineWidth = 1;
        // 圆角气泡 + 小尾巴
        ctx.beginPath();
        ctx.moveTo(bx + 6, by); ctx.lineTo(bx + bw - 6, by);
        ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + 6);
        ctx.lineTo(bx + bw, by + 18); ctx.quadraticCurveTo(bx + bw, by + 24, bx + bw - 6, by + 24);
        ctx.lineTo(bx + 8, by + 24); ctx.quadraticCurveTo(bx + 2, by + 24, bx + 2, by + 18);
        ctx.lineTo(bx + 2, by + 6); ctx.quadraticCurveTo(bx + 2, by, bx + 8, by);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(sx - 3, by + 24); ctx.lineTo(sx + 3, by + 24); ctx.lineTo(sx, by + 29); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#d8f2e8'; ctx.textAlign = 'center';
        ctx.fillText(a.bubble.text, sx, by + 16);
        ctx.restore();
      }
    },

    // ---------- 渲染：信号阶段（UI 层——信号生成在 600px 环带必然雾外，指引信息永不被雾罩） ----------
    renderAllySignal(ctx, cam) {
      const sig = this.allySignal;
      if (!sig) return;
      const cz = cam.zoom || 1;
      const sx = (sig.x - cam.x) * cz, sy = (sig.y - cam.y) * cz;
      const pulse = 0.6 + 0.4 * Math.sin(this.elapsed * 5);
      ctx.save();
      // 信号环
      ctx.strokeStyle = `rgba(127,216,192,${0.35 + 0.3 * pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx, sy, 26 * cz + pulse * 8, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(sx, sy, 12 * cz, 0, Math.PI * 2); ctx.stroke();
      // 游侠本体（3D 形象优先，剪影回退）
      const P = (typeof NpcPortraits !== 'undefined') ? NpcPortraits : null;
      const art = (typeof ArtTextures !== 'undefined') ? ArtTextures.allyArt(sig.def.id) : null;
      ctx.save();
      ctx.fillStyle = 'rgba(5,10,6,.35)';
      ctx.beginPath(); ctx.ellipse(sx, sy - 2, 15 * cz, 5 * cz, 0, 0, Math.PI * 2); ctx.fill();
      let drawn = false;
      if (P) drawn = P.drawWorld(ctx, sig.def.id, sx, sy, 62 * cz);
      if (!drawn && art) ctx.drawImage(art, sx - 26 * cz, sy - 52 * cz, 52 * cz, 60 * cz);
      ctx.restore();
      // 文案
      ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(8,12,10,.85)'; ctx.fillText(`游侠「${sig.def.name}」`, sx + 1, sy - 58 * cz);
      ctx.fillStyle = '#9fe8d4'; ctx.fillText(`游侠「${sig.def.name}」`, sx, sy - 59 * cz);
      ctx.font = '11px sans-serif';
      ctx.fillStyle = `rgba(191,232,220,${0.7 + 0.3 * pulse})`;
      ctx.fillText(`点击接纳 · ${Math.ceil(sig.t)}s 后独自上路`, sx, sy + 42 * cz);
      ctx.restore();
    }
  });

  // 暴露（验收脚本用）
  window.AllySystem = { DEFS: ALLY_DEFS, Memory: AllyMemory, MEM_KEY, SCHEDULE: ALLY_SCHEDULE, pickBySchedule: pickAllyBySchedule };
})();
