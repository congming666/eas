/* ============================================================
 * Telemetry —— 游戏内埋点系统（v5.2）
 * 纯本地采集：事件写入 localStorage，可导出 JSON / 内置数据看板
 * 事件清单（20+）：
 *   game_start / crop_harvest / character_levelup / character_breakthrough
 *   weapon_craft / weapon_upgrade / safe_upgrade / workshop_craft
 *   skill_unlock / skill_equip / archive_claim / codex_discover
 *   expedition_start / extract_begin / beast_wave / consumable_use
 *   player_death / expedition_end / dashboard_open / telemetry_export / telemetry_clear
 * ============================================================ */
(function () {
  'use strict';
  const STORAGE_KEY = 'fce_telemetry_v1';
  const MAX_EVENTS = 2000;

  const Telemetry = {
    events: [],
    sessionId: 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    sessionStart: Date.now(),
    silent: false,          // bot 批量跑图时置 true，不写埋点
    _saveTimer: null,
    _uiReady: false,

    init() {
      if (this.initDone) return;
      this.initDone = true;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) this.events = parsed;          // 兼容旧格式
          else if (Array.isArray(parsed.events)) this.events = parsed.events;
        }
      } catch (e) { this.events = []; }
      this.track('game_start', { version: (typeof CONFIG !== 'undefined' && CONFIG.version) || (typeof GAME_VERSION !== 'undefined' ? GAME_VERSION : 'unknown') });
      this._mountUI();
    },

    /* ---------- 采集 ---------- */
    track(name, props) {
      if (this.silent) return;
      const ev = {
        name,
        t: Date.now(),
        sid: this.sessionId,
        v: (typeof CONFIG !== 'undefined' && CONFIG.version) || '',
      };
      if (props && typeof props === 'object') {
        for (const k in props) {
          if (props[k] === undefined) continue;
          // 只保留可序列化的基础类型，避免对象循环引用
          const val = props[k];
          if (['string', 'number', 'boolean'].indexOf(typeof val) >= 0 || val === null) ev[k] = val;
          else { try { ev[k] = JSON.parse(JSON.stringify(val)); } catch (e) { ev[k] = String(val); } }
        }
      }
      this.events.push(ev);
      if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
      this._scheduleSave();
    },

    _scheduleSave() {
      if (this._saveTimer) return;
      this._saveTimer = setTimeout(() => {
        this._saveTimer = null;
        this.persist();
      }, 400);
    },

    persist() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ events: this.events, updated: Date.now() })); } catch (e) {}
    },

    clear() {
      this.events = [];
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    },

    exportJSON() {
      this.persist();
      const payload = {
        game: 'farm-cards-expedition',
        exportedAt: new Date().toISOString(),
        count: this.events.length,
        events: this.events,
      };
      return JSON.stringify(payload, null, 2);
    },

    /* ---------- 业务事件便捷方法 ---------- */
    onExpeditionStart(exp) {
      if (!exp || !exp.map) return;
      const gs = (typeof GameState !== 'undefined') ? GameState : {};
      this.track('expedition_start', {
        mapId: exp.map.id, mapName: exp.map.name, tier: exp.map.tier,
        difficulty: gs.difficulty || 'normal',
        heat: Array.isArray(gs.heatModifiers) ? gs.heatModifiers.length : 0,
        level: gs.level || 1,
        weapons: (exp.broughtStats || []).map(w => w.weaponId + '@' + w.level).join(','),
        seedCount: (gs.carriedSeeds || []).reduce((s, x) => s + (x.count || 1), 0),
        consumableKinds: exp.consumables ? Object.keys(exp.consumables).filter(k => exp.consumables[k] > 0).length : 0,
      });
    },

    onExtractBegin(type) {
      this.track('extract_begin', { type: type || 'fixed' });
    },

    onBeastWave(exp) {
      if (!exp || !exp.beastWave) return;
      this.track('beast_wave', {
        wave: exp.beastWave.wave,
        tier: exp.map ? exp.map.tier : 0,
        difficulty: (typeof GameState !== 'undefined' && GameState.difficulty) || 'normal',
        elapsed: Math.round(exp.elapsed || 0),
        hpPct: exp.player ? Math.round(exp.player.hp / exp.player.maxHp * 100) : 0,
      });
    },

    onPlayerDeath(exp) {
      if (!exp) return;
      const cause = exp.deathCause || {};
      this.track('player_death', {
        mapId: exp.map ? exp.map.id : '', tier: exp.map ? exp.map.tier : 0,
        difficulty: (typeof GameState !== 'undefined' && GameState.difficulty) || 'normal',
        reason: cause.reason || 'killed',
        by: cause.by || 'unknown',
        wave: cause.wave || 0,
        elapsed: Math.round(cause.elapsed || exp.elapsed || 0),
        kills: exp.killCount || 0,
        damageTaken: Math.round(exp.damageTaken || 0),
      });
    },

    onExpeditionEnd(data, exp) {
      if (!data) return;
      exp = exp || (typeof Game !== 'undefined' ? Game.expedition : null);
      const goldInBag = exp ? (exp.bag || []).filter(i => i.type === 'gold').reduce((s, i) => s + i.amount, 0) : 0;
      const itemCount = exp ? (exp.bag || []).reduce((s, i) => s + (i.amount || 1), 0) : 0;
      const rs = exp ? exp.runStats : null;
      this.track('expedition_end', {
        success: !!data.success,
        mapId: exp && exp.map ? exp.map.id : '',
        mapName: data.mapName || (exp && exp.map ? exp.map.name : ''),
        tier: exp && exp.map ? exp.map.tier : 0,
        difficulty: (typeof GameState !== 'undefined' && GameState.difficulty) || 'normal',
        level: (typeof GameState !== 'undefined' && GameState.level) || 1,
        duration: Math.round(parseFloat(data.timeUsed) || (exp ? exp.elapsed : 0)),
        kills: data.kills || 0,
        eliteKills: rs ? rs.eliteKills || 0 : 0,
        bossKills: rs ? rs.bossKills || 0 : 0,
        wave: exp && exp.beastWave ? exp.beastWave.wave : 0,
        chests: data.chests || 0,
        damageTaken: Math.round(data.damageTaken || 0),
        gold: data.goldEarned || 0,
        goldInBag: goldInBag,
        itemCount: itemCount,
        extractType: exp ? exp.extractType || '' : '',
        deathReason: exp && exp.deathCause ? exp.deathCause.reason || '' : '',
        deathBy: exp && exp.deathCause ? exp.deathCause.by || '' : '',
        minHpPct: rs ? Math.round(rs.minHpSeen || 100) : 100,
        maxCombo: rs ? rs.maxCombo || 0 : 0,
      });
    },

    /* ---------- 聚合统计 ---------- */
    summary() {
      const evs = this.events;
      const out = {
        total: evs.length,
        runs: 0, successes: 0, successRate: 0,
        avgDuration: 0, avgKills: 0, totalGold: 0,
        byTier: {},          // tier -> {runs, success, duration, kills, gold, deaths}
        byDifficulty: {},
        deathCauses: {},
        deathBy: {},
        funnel: { harvest: null, expedition: null, extract: null },
        quality: { common: 0, fine: 0, rare: 0, legendary: 0 },
        levelups: 0, breakthroughs: 0,
        weaponCraft: 0, weaponUpgrade: 0, workshopCraft: 0,
        skillUnlocks: 0, archives: 0,
        maxWave: 0,
        recent: [],
      };
      let durSum = 0, killSum = 0;
      const firstOf = {};
      for (const e of evs) {
        switch (e.name) {
          case 'crop_harvest': {
            if (!firstOf.harvest) firstOf.harvest = e.t;
            if (out.quality[e.quality] !== undefined) out.quality[e.quality] += (e.qty || 1);
            break;
          }
          case 'character_levelup': out.levelups++; break;
          case 'character_breakthrough': out.breakthroughs++; break;
          case 'weapon_craft': out.weaponCraft++; break;
          case 'weapon_upgrade': out.weaponUpgrade++; break;
          case 'workshop_craft': out.workshopCraft += (e.qty || 1); break;
          case 'skill_unlock': out.skillUnlocks++; break;
          case 'archive_claim': out.archives++; break;
          case 'expedition_start': {
            if (!firstOf.expedition) firstOf.expedition = e.t;
            break;
          }
          case 'beast_wave': out.maxWave = Math.max(out.maxWave, e.wave || 0); break;
          case 'expedition_end': {
            out.runs++;
            const tier = 'T' + (e.tier || '?');
            const diff = e.difficulty || 'normal';
            const t = out.byTier[tier] || (out.byTier[tier] = { runs: 0, success: 0, duration: 0, kills: 0, gold: 0 });
            const d = out.byDifficulty[diff] || (out.byDifficulty[diff] = { runs: 0, success: 0, duration: 0, kills: 0, gold: 0 });
            t.runs++; d.runs++;
            if (e.success) {
              out.successes++; t.success++; d.success++;
              if (!firstOf.extract) firstOf.extract = e.t;
            }
            durSum += e.duration || 0; killSum += e.kills || 0;
            t.duration += e.duration || 0; d.duration += e.duration || 0;
            t.kills += e.kills || 0; d.kills += e.kills || 0;
            t.gold += e.gold || 0; d.gold += e.gold || 0;
            out.totalGold += e.gold || 0;
            break;
          }
          case 'player_death': {
            const r = e.reason || 'killed';
            out.deathCauses[r] = (out.deathCauses[r] || 0) + 1;
            const by = e.by || 'unknown';
            out.deathBy[by] = (out.deathBy[by] || 0) + 1;
            break;
          }
        }
      }
      if (out.runs) {
        out.successRate = Math.round(out.successes / out.runs * 1000) / 10;
        out.avgDuration = Math.round(durSum / out.runs);
        out.avgKills = Math.round(killSum / out.runs * 10) / 10;
      }
      out.funnel = {
        harvest: firstOf.harvest ? new Date(firstOf.harvest).toLocaleString('zh-CN') : '未发生',
        expedition: firstOf.expedition ? new Date(firstOf.expedition).toLocaleString('zh-CN') : '未发生',
        extract: firstOf.extract ? new Date(firstOf.extract).toLocaleString('zh-CN') : '未发生',
      };
      out.recent = evs.slice(-12).reverse();
      return out;
    },

    /* ---------- 看板 UI ---------- */
    _mountUI() {
      if (this._uiReady || typeof document === 'undefined') return;
      this._uiReady = true;
      const btn = document.createElement('div');
      btn.id = 'telemetryFab';
      btn.title = '对局数据看板';
      btn.textContent = '📊 数据';
      btn.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:9000;padding:7px 12px;border-radius:18px;' +
        'background:linear-gradient(135deg,#3a2f1c,#241f14);color:#e8d9a8;border:1px solid #8a6d3b;' +
        'font-size:12px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.5);user-select:none;';
      btn.onclick = () => this.openDashboard();
      document.addEventListener('DOMContentLoaded', () => document.body.appendChild(btn));
      if (document.body) document.body.appendChild(btn);
      // 远征中隐藏，避免遮挡 HUD
      setInterval(() => {
        if (!btn.parentNode) return;
        const inGame = (typeof GameState !== 'undefined' && GameState.screen === 'expedition');
        btn.style.display = inGame ? 'none' : '';
      }, 600);
    },

    openDashboard() {
      this.track('dashboard_open', {});
      const s = this.summary();
      const pct = (a, b) => b ? Math.round(a / b * 1000) / 10 + '%' : '—';
      const tierRows = Object.keys(s.byTier).sort().map(k => {
        const t = s.byTier[k];
        return `<tr><td>${k}</td><td>${t.runs}</td><td>${pct(t.success, t.runs)}</td><td>${Math.round(t.duration / t.runs)}s</td><td>${(t.kills / t.runs).toFixed(1)}</td><td>${Math.round(t.gold / t.runs)}</td></tr>`;
      }).join('') || '<tr><td colspan="6" style="text-align:center;color:#888">暂无对局</td></tr>';
      const diffRows = Object.keys(s.byDifficulty).map(k => {
        const d = s.byDifficulty[k];
        return `<tr><td>${k}</td><td>${d.runs}</td><td>${pct(d.success, d.runs)}</td><td>${Math.round(d.duration / d.runs)}s</td><td>${(d.kills / d.runs).toFixed(1)}</td><td>${Math.round(d.gold / d.runs)}</td></tr>`;
      }).join('') || '';
      const causeRows = Object.keys(s.deathCauses).map(k => `<tr><td>${k}</td><td>${s.deathCauses[k]}</td></tr>`).join('') || '<tr><td colspan="2" style="text-align:center;color:#888">无死亡</td></tr>';
      const byRows = Object.keys(s.deathBy).sort((a, b) => s.deathBy[b] - s.deathBy[a]).slice(0, 8).map(k => `<tr><td>${k}</td><td>${s.deathBy[k]}</td></tr>`).join('') || '';
      const recentRows = s.recent.map(e => `<tr><td>${new Date(e.t).toLocaleTimeString('zh-CN')}</td><td>${e.name}</td><td>${e.success !== undefined ? (e.success ? '撤离' : '失败') : (e.mapName || e.cropId || e.weaponId || e.skillId || e.reason || '')}</td></tr>`).join('');

      const overlay = document.createElement('div');
      overlay.id = 'telemetryPanel';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.78);z-index:10001;display:flex;align-items:center;justify-content:center;';
      overlay.innerHTML = `
      <div style="width:min(900px,94vw);max-height:88vh;overflow:auto;background:#1a1f1a;border:1px solid #8a6d3b;border-radius:12px;padding:20px;color:#d8cfb8;font-size:13px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <h2 style="margin:0;color:#ffd700;font-size:18px;">📊 对局数据看板</h2>
          <div>
            <button id="telExport" style="padding:6px 12px;margin:0 4px;background:#3a5a3a;color:#d8f0d8;border:1px solid #5a8a5a;border-radius:6px;cursor:pointer;">导出 JSON</button>
            <button id="telClear" style="padding:6px 12px;margin:0 4px;background:#5a3030;color:#f0d0d0;border:1px solid #8a4a4a;border-radius:6px;cursor:pointer;">清空数据</button>
            <button id="telClose" style="padding:6px 12px;margin:0 4px;background:#333;color:#ccc;border:1px solid #666;border-radius:6px;cursor:pointer;">关闭</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:14px;">
          ${[
            ['总对局', s.runs], ['撤离率', s.runs ? s.successRate + '%' : '—'], ['平均时长', s.runs ? s.avgDuration + 's' : '—'],
            ['平均击杀', s.runs ? s.avgKills : '—'], ['累计收益', s.totalGold], ['最高兽潮', '第' + s.maxWave + '波'],
            ['升级次数', s.levelups], ['突破次数', s.breakthroughs], ['技能解锁', s.skillUnlocks], ['档案点亮', s.archives],
          ].map(([k, v]) => `<div style="background:rgba(255,215,0,0.06);border:1px solid #4a3f28;border-radius:8px;padding:10px;text-align:center;">
              <div style="font-size:11px;color:#a89878;">${k}</div><div style="font-size:18px;color:#ffd700;margin-top:3px;">${v}</div></div>`).join('')}
        </div>
        <div style="margin-bottom:10px;padding:8px 10px;background:rgba(0,0,0,0.25);border-radius:8px;">
          <b style="color:#c9b98a;">新手漏斗：</b>
          首次收获 ${s.funnel.harvest} ｜ 首次远征 ${s.funnel.expedition} ｜ 首次撤离 ${s.funnel.extract}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
          <div>
            <h3 style="color:#c9b98a;font-size:14px;margin:6px 0;">按 Tier</h3>
            <table style="width:100%;border-collapse:collapse;font-size:12px;">
              <tr style="color:#a89878;"><th style="text-align:left;padding:3px;">层级</th><th>场次</th><th>撤离率</th><th>均时长</th><th>均击杀</th><th>均收益</th></tr>
              ${tierRows}
            </table>
          </div>
          <div>
            <h3 style="color:#c9b98a;font-size:14px;margin:6px 0;">按难度</h3>
            <table style="width:100%;border-collapse:collapse;font-size:12px;">
              <tr style="color:#a89878;"><th style="text-align:left;padding:3px;">难度</th><th>场次</th><th>撤离率</th><th>均时长</th><th>均击杀</th><th>均收益</th></tr>
              ${diffRows || '<tr><td colspan="6" style="text-align:center;color:#888">暂无</td></tr>'}
            </table>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
          <div>
            <h3 style="color:#c9b98a;font-size:14px;margin:6px 0;">死亡原因</h3>
            <table style="width:100%;border-collapse:collapse;font-size:12px;">${causeRows}</table>
          </div>
          <div>
            <h3 style="color:#c9b98a;font-size:14px;margin:6px 0;">被谁击杀 Top8</h3>
            <table style="width:100%;border-collapse:collapse;font-size:12px;">${byRows || '<tr><td style="color:#888">暂无</td></tr>'}</table>
          </div>
        </div>
        <div style="margin-bottom:12px;padding:8px 10px;background:rgba(0,0,0,0.25);border-radius:8px;font-size:12px;">
          <b style="color:#c9b98a;">收获品质分布：</b>
          普通 ${s.quality.common} ｜ 优质 ${s.quality.fine} ｜ 稀有 ${s.quality.rare} ｜ 传说 ${s.quality.legendary}
          &nbsp;&nbsp;<b style="color:#c9b98a;">打造/升级/加工：</b>${s.weaponCraft} / ${s.weaponUpgrade} / ${s.workshopCraft}
        </div>
        <h3 style="color:#c9b98a;font-size:14px;margin:6px 0;">最近事件</h3>
        <table style="width:100%;border-collapse:collapse;font-size:11px;color:#b8b098;">
          <tr style="color:#888;"><th style="text-align:left;padding:2px;">时间</th><th style="text-align:left;">事件</th><th style="text-align:left;">详情</th></tr>
          ${recentRows}
        </table>
        <div style="font-size:11px;color:#777;margin-top:10px;">事件仅保存在本机浏览器（localStorage，上限 ${MAX_EVENTS} 条），不会上传。</div>
      </div>`;
      overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
      document.body.appendChild(overlay);
      document.getElementById('telClose').onclick = () => overlay.remove();
      document.getElementById('telExport').onclick = () => {
        this.track('telemetry_export', {});
        const blob = new Blob([this.exportJSON()], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'telemetry-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      };
      document.getElementById('telClear').onclick = () => {
        if (confirm('确定清空全部埋点数据？此操作不可恢复。')) {
          this.track('telemetry_clear', {});
          this.clear();
          overlay.remove();
          showToast && showToast('埋点数据已清空', 'success');
        }
      };
    },
  };

  window.Telemetry = Telemetry;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => Telemetry.init());
  else Telemetry.init();
})();
