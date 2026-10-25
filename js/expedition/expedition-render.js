/* Expedition 原型混合：实体/天气/昼夜/HUD/小地图渲染与 render 编排（由 expedition.js 拆分） */
Object.assign(Expedition.prototype, {
  // v1.8 视角拉远：当前可见世界宽高（画布/zoom）——世界层屏幕裁剪的统一基准
  viewW() { return CONFIG.canvas.width / (this.camera.zoom || 1); },
  viewH() { return CONFIG.canvas.height / (this.camera.zoom || 1); },

  renderMonster(ctx, monster, cam) {
    const sx = monster.x - cam.x, sy = monster.y - cam.y;
    const cullMargin = monster.type === 'boss' ? 180 : 90;
    if (sx < -cullMargin || sx > this.viewW() + cullMargin || sy < -cullMargin || sy > this.viewH() + cullMargin) return;
    // G6 荒野猎手：专属渲染（血红光环 + 斗篷 + 红眼），委托 CombatDirector
    if (monster.type === 'hunter' && typeof CombatDirector !== 'undefined') {
      CombatDirector.renderHunter(ctx, monster, sx, sy);
      return;
    }
    // v3.3 攻击前摇可视化
    if (monster.windupT > 0) {
      const prog = 1 - monster.windupT / (monster.windupDur || 0.4);
      ctx.save();
      if (monster.windupKind === 'ranged') {
        // 抬手白光
        ctx.globalAlpha = 0.5 + 0.4 * Math.sin(prog * Math.PI * 4);
        ctx.fillStyle = '#ffdd88';
        ctx.beginPath(); ctx.arc(sx + Math.cos(monster.windupAngle || 0) * 22, sy - 14, 8, 0, Math.PI * 2); ctx.fill();
      } else if (monster.windupKind === 'bomb') {
        // 身体变红 + 倒计时
        ctx.globalAlpha = 0.4 + 0.3 * Math.sin(this.elapsed * 18);
        ctx.fillStyle = '#ff3322';
        ctx.beginPath(); ctx.arc(sx, sy, (monster.radius || 20) * (1.2 + prog), 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffffff'; ctx.font = 'bold 14px sans-serif';
        ctx.fillText(Math.ceil(monster.windupT).toString(), sx - 4, sy + 4);
      } else {
        // 近战：武器发光（白）+ 面前半圆预警区
        ctx.globalAlpha = 0.35 + 0.3 * prog;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(sx + Math.cos(monster.windupAngle || 0) * 26, sy + Math.sin(monster.windupAngle || 0) * 26, 7, 0, Math.PI * 2); ctx.fill();
        // 红色扇形
        ctx.globalAlpha = 0.18 + 0.15 * prog;
        ctx.fillStyle = '#ff4433';
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.arc(sx, sy, monster.attackRange || 36, (monster.windupAngle || 0) - 0.6, (monster.windupAngle || 0) + 0.6);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
    const scale = (monster.elite ? 1.18 : 1) * (monster.radius / 18) * this.getDepthScale(monster.y);
    const stride = Math.sin(monster.animTime || 0);
    const hpPct = clamp(monster.hp / monster.maxHp, 0, 1);
    ctx.save();
    const lift = monster.visualZ || 0;
    this.renderCastShadow(ctx, monster.x, monster.y, 28 * scale, 28 * scale, 0.38, lift);
    ctx.translate(sx + (monster.knockX || 0), sy - lift + (monster.knockY || 0) * 0.45);
    // v5.2 全角色程序化动画：呼吸/颠簸/攻击前冲/受击闪白/死亡倒下
    const _at = monster.animTime || 0;
    const _moving = monster.state === 'move' || monster.state === 'chase' || monster.state === 'patrol';
    if (monster.state === 'death') {
      const _dt = monster.deathTimer || 0;
      const _prog = Math.min(1, Math.max(0, 1 - _dt / .42));
      ctx.globalAlpha = Math.max(0, _dt / .42);
      ctx.rotate(_prog * .85);
      ctx.scale(1 - _prog * .12, .65 + _dt / .42 * .35);
      ctx.translate(0, _prog * 8);
    } else if (monster.hitFlash > 0) {
      const _hk = Math.min(1, monster.hitFlash / .14);
      ctx.translate(-4 * _hk, Math.sin(_at * 40) * 1.5 * _hk);
      ctx.globalAlpha = .82 + _hk * .18;
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 14 * _hk;
    } else if (monster.attackAnim > 0 || monster.state === 'attack') {
      const _ak = Math.sin(Math.min(1, (monster.attackAnim || .15) / .3) * Math.PI);
      ctx.translate(6 * _ak, 0);
      ctx.scale(1 + .1 * _ak, 1 - .04 * _ak);
      ctx.rotate(.06 * _ak);
    } else if (monster.state === 'windup') {
      ctx.scale(.94, 1.06);
      ctx.translate(Math.sin(_at * 30) * 1.2, 0);
    } else if (_moving) {
      ctx.translate(0, Math.sin(_at * 10) * 2);
      ctx.scale(1 + Math.sin(_at * 10) * .02, 1 - Math.sin(_at * 10) * .01);
    } else {
      ctx.translate(0, Math.sin(_at * 2.5) * 1.2);
      ctx.scale(1, 1 + Math.sin(_at * 2.5) * .01);
    }

    // v5.0 12 Boss 写实透明立绘（CropArt，局部坐标系绘制）
    if (monster.type === 'boss' && monster.bossId && typeof CropArt !== 'undefined' && CropArt.ready(monster.bossId)) {
      const bossImg = CropArt.img(monster.bossId);
      const bossScale2 = this.getDepthScale(monster.y) * (1 + Math.sin(monster.animTime * 2.2) * .018);
      const drawW = 200 * bossScale2;
      const drawH = drawW * bossImg.naturalHeight / bossImg.naturalWidth;
      const _channeling = monster.castState && (monster.castState.indexOf('windup') === 0 || monster.castState.indexOf('h_') === 0);
      if (_channeling) {
        const w = Math.sin((monster.castTimer || 0) * 26);
        ctx.translate(w * 2.4, -5 + w * 2);
        ctx.shadowColor = monster.castState === 'windup_charge' ? '#ff5a3c' : '#c07aff';
        ctx.shadowBlur = 16 + (Math.sin((monster.castTimer || 0) * 30) + 1) * 10;
        ctx.globalAlpha = .95;
      } else if (monster.castState === 'charge') {
        ctx.shadowColor = '#ff7a4a'; ctx.shadowBlur = 22; ctx.globalAlpha = .95;
      } else if (monster.castState === 'stagger') {
        ctx.globalAlpha = .78;
      }
      ctx.translate(0, Math.sin(monster.animTime * 2.2) * 1.5);
      if (monster.hitFlash > 0) { ctx.shadowColor = '#fff4cf'; ctx.shadowBlur = 24; ctx.globalAlpha = .92; }
      ctx.drawImage(bossImg, -drawW * .5, -drawH * .96, drawW, drawH);
      ctx.restore();
      const bw = 118, by = sy - drawH * 1.04;
      ctx.fillStyle = 'rgba(8,10,12,.9)'; ctx.beginPath(); ctx.roundRect(sx - bw/2 - 3, by - 3, bw + 6, 12, 5); ctx.fill();
      const bhg = ctx.createLinearGradient(sx-bw/2, 0, sx+bw/2, 0);
      bhg.addColorStop(0, '#a03a2e'); bhg.addColorStop(1, '#ff8a52');
      ctx.fillStyle = bhg; ctx.beginPath(); ctx.roundRect(sx - bw/2, by, bw * hpPct, 6, 3); ctx.fill();
      ctx.fillStyle = '#ffd9b0'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(monster.name || 'Boss', sx, by - 8);
      return;
    }

    // T1/T2 Boss 使用三视图定制的伪 3D 透明素材，并保留实时阴影、受击和血条反馈。
    const bossSprite = this.bossSprites[`t${this.map.tier}`];
    if (monster.type === 'boss' && this.map.tier <= 2 && bossSprite?.complete) {
      const bossImage = bossSprite;
      const bossScale = this.getDepthScale(monster.y) * (1 + Math.sin(monster.animTime * 2.2) * .018);
      const drawW = (this.map.tier === 2 ? 205 : 190) * bossScale;
      const drawH = drawW * bossImage.naturalHeight / bossImage.naturalWidth;
      ctx.save();
      ctx.scale(1, .42);
      const bossShadow = ctx.createRadialGradient(8, 18, 8, 8, 18, drawW * .44);
      bossShadow.addColorStop(0, 'rgba(0,0,0,.68)');
      bossShadow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = bossShadow;
      ctx.beginPath(); ctx.arc(8, 18, drawW * .44, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      ctx.save();
      // Boss 攻击动作：挥击前倾 / 技能蓄力下压抖动发光 / 释放瞬间前扑
      if (monster.attackAnim > 0) {
        const k = Math.sin((monster.attackAnim / 0.34) * Math.PI);
        ctx.translate(Math.cos(monster.facing || 0) * 7 * k, 0);
        ctx.rotate(k * 0.14);
      } else if (monster.castState && (monster.castState.indexOf('windup') === 0 || monster.castState.indexOf('h_') === 0)) {
        const w = Math.sin((monster.castTimer || 0) * 26);
        ctx.translate(w * 2.4, -5 + w * 2);
        ctx.rotate(w * 0.05);
        ctx.shadowColor = monster.castState === 'windup_charge' ? '#ff5a3c' : '#c07aff';
        ctx.shadowBlur = 16 + (Math.sin((monster.castTimer || 0) * 30) + 1) * 10;
        ctx.globalAlpha = .93;
      } else if (monster.castState === 'charge') {
        ctx.shadowColor = '#ff7a4a'; ctx.shadowBlur = 22; ctx.globalAlpha = .95;
      } else if (monster.castState === 'stagger') {
        ctx.globalAlpha = .78;
      } else if (monster.castState === 'cast') {
        ctx.translate(Math.cos(monster.facing || 0) * 6, 0);
      }
      ctx.translate(0, Math.sin(monster.animTime * 2.2) * 1.5);
      if (monster.hitFlash > 0) {
        ctx.shadowColor = this.map.tier === 2 ? '#8aeaff' : '#fff4cf';
        ctx.shadowBlur = 26;
        ctx.globalAlpha = .9;
      }
      ctx.drawImage(bossImage, -drawW * .5, -drawH + 25 * bossScale, drawW, drawH);
      if (this.map.tier === 2) {
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = .2 + Math.sin(monster.animTime * 4) * .06;
        ctx.shadowColor = '#54dcff';
        ctx.shadowBlur = 20;
        ctx.drawImage(bossImage, -drawW * .5, -drawH + 25 * bossScale, drawW, drawH);
      }
      ctx.restore();
      ctx.restore();

      const bossBarW = 112;
      const bossBarY = sy - drawH + 10;
      ctx.fillStyle = 'rgba(8,10,12,.9)'; ctx.beginPath(); ctx.roundRect(sx - bossBarW/2 - 3, bossBarY - 3, bossBarW + 6, 12, 5); ctx.fill();
      const bossHp = ctx.createLinearGradient(sx-bossBarW/2, 0, sx+bossBarW/2, 0);
      bossHp.addColorStop(0, this.map.tier === 2 ? '#247da0' : '#759c42');
      bossHp.addColorStop(1, this.map.tier === 2 ? '#73e3f2' : '#d6b755');
      ctx.fillStyle = bossHp; ctx.beginPath(); ctx.roundRect(sx - bossBarW/2, bossBarY, bossBarW * hpPct, 6, 3); ctx.fill();
      ctx.fillStyle = '#f1dfaa'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(monster.name || (this.map.tier === 2 ? '幽潮骨翼龙' : '苔岩裂颚兽'), sx, bossBarY - 8);
      return;
    }

    const spriteState = monster.state === 'death' ? 'death' : monster.hitFlash > 0 ? 'hit' : monster.state === 'attack' ? 'attack' : 'idle';
    const creatureSprite = this.monsterSprites[monster.type]?.[spriteState];
    if (creatureSprite?.complete && creatureSprite.naturalWidth) {
      const spriteScale = this.getDepthScale(monster.y) * (monster.elite ? 1.15 : 1);
      const drawSize = (monster.type === 'boar' ? 88 : monster.type === 'spider' ? 82 : monster.type === 'ancient_tree' ? 86 : 76) * spriteScale;
      ctx.save();
      if (Math.cos(monster.facing || 0) < 0) ctx.scale(-1, 1);
      ctx.drawImage(creatureSprite, -drawSize * .5, -drawSize * .67, drawSize, drawSize);
      ctx.restore();
      if (monster.attackAnim > 0) {
        // 怪物攻击：程序化新月刃（不再用 mobfx JPEG 贴图），朝向玩家
        const toP = Math.atan2((this.player.y - monster.y) || .001, (this.player.x - monster.x) || .001);
        const ATK_COL = { treant: '#9fd86a', gargoyle: '#c2a8ff', shadow_demon: '#b48aff', boar: '#ff9a6a', boar_king: '#ffb066' };
        this.drawSlashArc(ctx, sx, sy - drawSize * .28, toP, ATK_COL[monster.type] || '#ff9a6a',
          drawSize * .5, Math.min(1, monster.attackAnim * 5), 1 - Math.min(1, monster.attackAnim / .3), 1);
      }
      ctx.restore();
      const barW = monster.elite ? 54 : 44, barY = sy - drawSize * .52;
      ctx.fillStyle = 'rgba(8,10,12,.82)'; ctx.beginPath(); ctx.roundRect(sx - barW/2 - 2, barY - 2, barW + 4, 9, 4); ctx.fill();
      const spriteHp = ctx.createLinearGradient(sx-barW/2, 0, sx+barW/2, 0);
      spriteHp.addColorStop(0, hpPct > .35 ? '#57c96b' : '#db4b43'); spriteHp.addColorStop(1, hpPct > .35 ? '#a6e56e' : '#ff8a52');
      ctx.fillStyle = spriteHp; ctx.beginPath(); ctx.roundRect(sx - barW/2, barY, barW * hpPct, 5, 3); ctx.fill();
      // N3 荒野古树：💰 金标（一眼可辨的资源目标）
      if (monster.type === 'ancient_tree') {
        ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'left';
        ctx.fillText('💰×3', sx + barW * .5 + 4, barY + 7);
      }
      return;
    }

    // v5.0 新精英/怪物写实透明立绘（部分精英复用对应 Boss 立绘）
    const V5_ART_ALIAS = {
      withered_treant: 't1_withered', quarry_troll: 't1_quarry',
      brood_queen: 't3_brood_mother', swamp_hag_elite: 't3_swamp_hag',
      moon_priestess_elite: 't4_moon_priestess', arena_elite: 't4_arena_champion'
    };
    const v5ArtId = V5_ART_ALIAS[monster.type] || monster.type;
    if (typeof CropArt !== 'undefined' && CropArt.ready(v5ArtId)) {
      const mImg = CropArt.img(v5ArtId);
      const mScale = this.getDepthScale(monster.y) * (monster.elite ? 1.12 : 1);
      const mSize = (monster.radius > 26 ? 118 : 88) * mScale;
      const mH = mSize * mImg.naturalHeight / mImg.naturalWidth;
      if (Math.cos(monster.facing || 0) < 0) ctx.scale(-1, 1);
      if (monster.hitFlash > 0) { ctx.shadowColor = '#fff4cf'; ctx.shadowBlur = 18; ctx.globalAlpha = .92; }
      ctx.drawImage(mImg, -mSize * .5, -mH * .96, mSize, mH);
      ctx.restore();
      const mbarW = monster.elite ? 58 : 46, mbarY = sy - mH * .98;
      ctx.fillStyle = 'rgba(8,10,12,.82)'; ctx.beginPath(); ctx.roundRect(sx - mbarW/2 - 2, mbarY - 2, mbarW + 4, 9, 4); ctx.fill();
      const mhp = ctx.createLinearGradient(sx-mbarW/2, 0, sx+mbarW/2, 0);
      mhp.addColorStop(0, hpPct > .35 ? '#57c96b' : '#db4b43'); mhp.addColorStop(1, hpPct > .35 ? '#a6e56e' : '#ff8a52');
      ctx.fillStyle = mhp; ctx.beginPath(); ctx.roundRect(sx - mbarW/2, mbarY, mbarW * hpPct, 5, 3); ctx.fill();
      if (monster.elite) { ctx.fillStyle = '#edc7ff'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('ELITE', sx, mbarY - 5); }
      return;
    }

    // v1.12 基础怪 3D 立绘（Monsters3D 抠像管线）：替换原代码剪影，死亡/受击/攻击变换沿用外层
    const mob3d = (typeof Monsters3D !== 'undefined') ? Monsters3D.resolve(monster.type) : null;
    if (mob3d) {
      const _aerial = monster.type === 'bat';
      const mh = mob3d.meta.h * this.getDepthScale(monster.y) * (monster.elite ? 1.15 : 1)
        * (_aerial ? 1 + Math.sin(_at * 5) * .05 : 1);
      const mw = mh * mob3d.meta.aspect;
      if (Math.cos(monster.facing || 0) > 0) ctx.scale(-1, 1);   // 立绘面朝左：向右走时翻转
      if (monster.hitFlash > 0) { ctx.shadowColor = '#fff4cf'; ctx.shadowBlur = 18 * Math.min(1, monster.hitFlash / .14); ctx.globalAlpha = .92; }
      if (_aerial) ctx.translate(0, -8 + Math.sin(_at * 2.2) * 3.5);   // 蝙蝠悬浮起伏
      ctx.drawImage(mob3d.im, -mw * .5, -mh, mw, mh);
      ctx.shadowBlur = 0;
      // 疾风狼：移动时身后拖速度线（与立绘同层、朝向后侧）
      if (monster.type === 'swift_wolf' && _moving) {
        ctx.save();
        ctx.globalAlpha = .55; ctx.strokeStyle = '#cfe8ff'; ctx.lineWidth = 2; ctx.lineCap = 'round';
        for (let k = 0; k < 3; k++) {
          const ly = -mh * (.3 + k * .22), lx = (Math.cos(monster.facing || 0) > 0 ? -1 : 1) * (mw * .5 + 6 + k * 5);
          ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + (Math.cos(monster.facing || 0) > 0 ? -1 : 1) * (10 + k * 3), ly); ctx.stroke();
        }
        ctx.restore();
      }
      ctx.restore();
      // 血条（屏幕对齐，与 sprite 分支同规格）
      const barW = monster.elite ? 54 : 44, barY = sy - mh - 10;
      ctx.fillStyle = 'rgba(8,10,12,.82)'; ctx.beginPath(); ctx.roundRect(sx - barW/2 - 2, barY - 2, barW + 4, 9, 4); ctx.fill();
      const mobHp = ctx.createLinearGradient(sx-barW/2, 0, sx+barW/2, 0);
      mobHp.addColorStop(0, hpPct > .35 ? '#57c96b' : '#db4b43'); mobHp.addColorStop(1, hpPct > .35 ? '#a6e56e' : '#ff8a52');
      ctx.fillStyle = mobHp; ctx.beginPath(); ctx.roundRect(sx - barW/2, barY, barW * hpPct, 5, 3); ctx.fill();
      if (monster.elite) { ctx.fillStyle = '#edc7ff'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('ELITE', sx, barY - 5); }
      if (monster.type === 'herbivore') { ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'left'; ctx.fillText('🌿×2', sx + barW * .5 + 4, barY + 7); }
      return;
    }

    // Soft contact shadow anchors the creature to the terrain.
    ctx.save();
    ctx.scale(1, .42);
    const shadow = ctx.createRadialGradient(5, 12, 2, 5, 12, 33 * scale);
    shadow.addColorStop(0, 'rgba(0,0,0,.5)');
    shadow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shadow;
    ctx.beginPath(); ctx.arc(5, 12, 33 * scale, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    if (monster.elite) {
      ctx.globalAlpha = .28 + Math.sin(monster.animTime * 2) * .08;
      ctx.strokeStyle = '#d8a9ff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(0, 4, 30 * scale, 13 * scale, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.rotate(monster.facing || 0);
    ctx.scale(scale, scale);
    const flash = monster.hitFlash > 0;
    if (monster.type === 'boar') {
      // Layered hide, shoulder plate, legs, tusks and rim light.
      ctx.fillStyle = '#2b1b19';
      [-1, 1].forEach(side => { ctx.beginPath(); ctx.ellipse(-8 + stride * 2, side * 13, 13, 6, side * .12, 0, Math.PI * 2); ctx.fill(); });
      const hide = ctx.createLinearGradient(-24, -18, 25, 18);
      hide.addColorStop(0, flash ? '#fff0e7' : '#9b5a3e'); hide.addColorStop(.5, flash ? '#ffd9cf' : '#62372d'); hide.addColorStop(1, '#281a1b');
      ctx.fillStyle = hide; ctx.beginPath(); ctx.ellipse(-2, 0, 30, 20, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3b2a2a'; ctx.beginPath(); ctx.ellipse(23, 0, 15, 14, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1d1518'; ctx.beginPath(); ctx.ellipse(35, 0, 8, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#d9c49a';
      [-1,1].forEach(side => { ctx.beginPath(); ctx.moveTo(29, side * 7); ctx.quadraticCurveTo(38, side * 14, 43, side * 4); ctx.quadraticCurveTo(36, side * 9, 31, side * 3); ctx.fill(); });
      ctx.strokeStyle = 'rgba(255,205,150,.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(-7, -2, 21, Math.PI * 1.05, Math.PI * 1.7); ctx.stroke();
      ctx.fillStyle = '#f4b64b'; ctx.beginPath(); ctx.arc(27, -6, 2.4, 0, Math.PI * 2); ctx.fill();
    } else if (monster.type === 'bat') {
      // 腐翼蝙蝠：待机悬浮、攻击俯冲，受击闪白。
      const flap = Math.sin(monster.animTime * 5) * .25;
      ctx.fillStyle = flash ? '#fff4f1' : '#31243f';
      [-1, 1].forEach(side => { ctx.save(); ctx.rotate(side * (.55 + flap)); ctx.beginPath(); ctx.moveTo(-2, 0); ctx.quadraticCurveTo(-28, -25, -38, -4); ctx.quadraticCurveTo(-25, 3, -4, 9); ctx.closePath(); ctx.fill(); ctx.restore(); });
      ctx.fillStyle = flash ? '#ffd7d1' : '#6f4a83'; ctx.beginPath(); ctx.ellipse(4, 0, 16, 13, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f34f65'; [-1,1].forEach(side => { ctx.beginPath(); ctx.arc(11, side * 4, 2.4, 0, Math.PI * 2); ctx.fill(); });
      ctx.strokeStyle = '#d8a3d9'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(15, 8); ctx.lineTo(12, 14); ctx.lineTo(18, 12); ctx.stroke();
    } else if (monster.type === 'spider') {
      // 毒雾蛛：八足待机，远程喷吐绿色毒液弹。
      const step = Math.sin(monster.animTime * 3) * 3;
      ctx.strokeStyle = flash ? '#fff' : '#3f342e'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      for (let i = -1; i <= 1; i += 2) for (let j = 0; j < 4; j++) { ctx.beginPath(); ctx.moveTo(-4, i * 5); ctx.lineTo(-22 - j * 4, i * (12 + j * 4) + step * i); ctx.stroke(); }
      const shell = ctx.createRadialGradient(-5, -8, 2, 4, 3, 25); shell.addColorStop(0, flash ? '#efffe4' : '#b1c56c'); shell.addColorStop(.55, '#58633a'); shell.addColorStop(1, '#20251e');
      ctx.fillStyle = shell; ctx.beginPath(); ctx.ellipse(0, 0, 22, 17, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ef5b6d'; [-1, 1].forEach(side => { ctx.beginPath(); ctx.arc(15, side * 5, 2.5, 0, Math.PI * 2); ctx.fill(); });
      if (monster.state === 'attack') { ctx.strokeStyle = 'rgba(167,255,90,.75)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(22, 0, 8 + (monster.stateTimer || 0) * 10, -0.55, 0.55); ctx.stroke(); }
    } else if (monster.type === 'locust') {
      // Translucent wings and segmented chitin catch the environment light.
      ctx.globalAlpha = .55;
      const wing = ctx.createLinearGradient(-23, 0, 10, 0); wing.addColorStop(0, '#d8f2ba'); wing.addColorStop(1, 'rgba(100,180,105,.18)');
      ctx.fillStyle = wing;
      [-1,1].forEach(side => { ctx.save(); ctx.rotate(side * (.36 + stride * .04)); ctx.beginPath(); ctx.ellipse(-13, side * 8, 27, 8, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); });
      ctx.globalAlpha = 1;
      const shell = ctx.createLinearGradient(-22, -12, 22, 12); shell.addColorStop(0, flash ? '#f4ffe9' : '#b5bc42'); shell.addColorStop(.45, '#5d7e35'); shell.addColorStop(1, '#253d25');
      ctx.fillStyle = shell; ctx.beginPath(); ctx.ellipse(0, 0, 25, 10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#cbd66a'; ctx.lineWidth = 1.3; for(let x=-14;x<13;x+=8){ctx.beginPath();ctx.moveTo(x,-8);ctx.lineTo(x+3,8);ctx.stroke();}
      ctx.fillStyle='#31452c';ctx.beginPath();ctx.arc(23,0,9,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='#8ca85b';ctx.lineWidth=2;[-1,1].forEach(side=>{ctx.beginPath();ctx.moveTo(26,side*5);ctx.quadraticCurveTo(37,side*15,42,side*12);ctx.stroke();});
      ctx.fillStyle='#fff06a';[-1,1].forEach(side=>{ctx.beginPath();ctx.arc(27,side*3,1.8,0,Math.PI*2);ctx.fill();});
    } else {
      // Angular wolf silhouette with fur planes, paws, ears and luminous eyes.
      ctx.fillStyle='#20252d';
      [-1,1].forEach(side=>{ctx.beginPath();ctx.ellipse(-7+stride*2,side*14,15,6,side*.16,0,Math.PI*2);ctx.fill();});
      const fur=ctx.createLinearGradient(-26,-20,26,18);fur.addColorStop(0,flash?'#eef7ff':'#8794a3');fur.addColorStop(.5,flash?'#dceaff':'#46515f');fur.addColorStop(1,'#1f2731');
      ctx.fillStyle=fur;ctx.beginPath();ctx.moveTo(-31,0);ctx.lineTo(-18,-18);ctx.lineTo(8,-19);ctx.lineTo(29,-8);ctx.lineTo(33,0);ctx.lineTo(27,10);ctx.lineTo(5,18);ctx.lineTo(-19,15);ctx.closePath();ctx.fill();
      ctx.fillStyle='#394554';ctx.beginPath();ctx.moveTo(16,-11);ctx.lineTo(25,-27);ctx.lineTo(29,-9);ctx.lineTo(38,-20);ctx.lineTo(37,1);ctx.lineTo(26,12);ctx.closePath();ctx.fill();
      ctx.fillStyle='#171e27';ctx.beginPath();ctx.moveTo(-23,-7);ctx.quadraticCurveTo(-42,-20,-47,-11);ctx.quadraticCurveTo(-36,-7,-29,5);ctx.fill();
      ctx.fillStyle='#7ee5ff';[-1,1].forEach(side=>{ctx.beginPath();ctx.arc(30,side*5,2.2,0,Math.PI*2);ctx.fill();});
      ctx.strokeStyle='rgba(210,233,255,.48)';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(-15,-12);ctx.lineTo(5,-15);ctx.lineTo(19,-8);ctx.stroke();
    }
    ctx.restore();

    // Compact framed health bar and elite marker stay screen-aligned.
    const barW = monster.elite ? 54 : 44, barY = sy - monster.radius * scale - 24;
    ctx.fillStyle = 'rgba(8,10,12,.82)'; ctx.beginPath(); ctx.roundRect(sx - barW/2 - 2, barY - 2, barW + 4, 9, 4); ctx.fill();
    const hpGrad = ctx.createLinearGradient(sx-barW/2, 0, sx+barW/2, 0);
    hpGrad.addColorStop(0, hpPct > .35 ? '#57c96b' : '#db4b43'); hpGrad.addColorStop(1, hpPct > .35 ? '#a6e56e' : '#ff8a52');
    ctx.fillStyle = hpGrad; ctx.beginPath(); ctx.roundRect(sx - barW/2, barY, barW * hpPct, 5, 3); ctx.fill();
    if (monster.elite) { ctx.fillStyle='#edc7ff';ctx.font='bold 9px sans-serif';ctx.textAlign='center';ctx.fillText('ELITE',sx,barY-5); }
    if (monster.stunned > 0) { ctx.fillStyle='#ffe56b';ctx.font='15px sans-serif';ctx.textAlign='center';ctx.fillText('✦',sx,barY-12); }
  },

  // 怪物状态光环：冰冻（青色冰环+碎霜）/ 燃烧（暖色辉光）
  renderMonsterStatus(ctx, m, sx, sy) {
    const t = m.animTime || 0;
    if (m.slow > 0) {
      ctx.save();
      ctx.globalAlpha = 0.5 + Math.sin(t * 6) * 0.12;
      ctx.strokeStyle = '#9fe4ff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(sx, sy + 4, m.radius + 6, (m.radius + 6) * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#d8f6ff';
      for (let i = 0; i < 3; i++) {
        const a = t * 1.6 + i * 2.1;
        const px = sx + Math.cos(a) * (m.radius + 4), py = sy + Math.sin(a * 1.3) * (m.radius * 0.5);
        ctx.beginPath(); ctx.arc(px, py, 1.6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    if (m.burn) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35 + Math.sin(t * 14) * 0.1;
      const fg = ctx.createRadialGradient(sx, sy - 4, 2, sx, sy - 4, m.radius + 10);
      fg.addColorStop(0, 'rgba(255,170,60,.5)');
      fg.addColorStop(1, 'rgba(255,90,20,0)');
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.arc(sx, sy - 4, m.radius + 10, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  },

  renderHero(ctx, sx, sy) {
    // 骨骼版：真实立绘切成身体+双腿，按步态相位旋转
    if (typeof PlayerSkel !== 'undefined' && PlayerSkel.ENABLED !== false) {
      const sp = PlayerSkel.pose(this.player);
      if (sp) {
        const depth = this.getDepthScale(this.player.y);
        const lift = this.player.visualZ || 0;
        // 影子随步伐呼吸：支撑瞬间最大、抬脚时收小，读作"踩地"
        const shPulse = 0.88 + 0.12 * Math.abs(Math.sin(Math.PI * 2 * (sp.phase || 0)));
        this.renderCastShadow(ctx, this.player.x, this.player.y,
          24 * depth * shPulse, 32 * depth * shPulse, .4 * shPulse, lift);
        ctx.save();
        ctx.translate(sx, sy - lift);
        // 受击不再整身闪白（玩家反馈去掉）——只保留后仰姿态
        // 转向过渡：旧方向残影淡出，避免方向硬切
        const turnT = this.player._skelTurnT || 0;
        if (turnT > 0 && this.player._skelFromDir) {
          const gp = PlayerSkel.pose(this.player, this.player._skelFromDir);
          if (gp) {
            ctx.globalAlpha = Math.min(1, turnT / 0.07);
            PlayerSkel.drawCanvas(ctx, gp, 0, 0, (124 / 256) * depth);
            ctx.globalAlpha = 1;
          }
        }
        PlayerSkel.drawCanvas(ctx, sp, 0, 0, (124 / 256) * depth);
        ctx.filter = 'none';
        ctx.save(); ctx.scale(.7 * depth, .7 * depth);
        const swing = this.attackAnim > 0 ? Math.sin((1 - this.attackAnim / .24) * Math.PI) : 0;
        this.renderHeroWeapon(ctx, this.player.angle || 0, swing, this.attackCombo, this.weaponRecoil);
        ctx.restore();
        if (this.player.invuln > 0) {
          ctx.strokeStyle = 'rgba(125,231,255,.65)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(0, -4, 22 * depth, 9 * depth, 0, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.restore();
        return;
      }
    }
    const art = typeof PlayerArt !== 'undefined' && PlayerArt.resolve(this.player);
    if (art) {
      const depth = this.getDepthScale(this.player.y);
      const lift = this.player.visualZ || 0;
      const h = art.baseH * depth, w = h * art.aspect;
      const moving = (this.player.moveSpeed || 0) > 10;
      // 起伏与轻侧摆：接触帧最低、过渡帧最高（步态相位来自 PlayerArt）
      const phase = art.phase || 0;
      const bob = moving ? -Math.abs(Math.sin(Math.PI * 2 * phase)) * 2.6
                         : Math.sin(this.elapsed * 2.5) * .45;
      const sway = moving ? Math.sin(Math.PI * 2 * phase) * 1.1 : 0;
      this.renderCastShadow(ctx, this.player.x, this.player.y, 24 * depth, 32 * depth, .4, lift);
      ctx.save();
      ctx.translate(sx + sway, sy - lift + bob);
      ctx.rotate(moving ? Math.sin(Math.PI * 2 * phase) * 0.012 : 0);
      ctx.scale(art.flip, 1);
      ctx.drawImage(art.img, -w / 2, -h, w, h);
      // 四帧走图表在帧尾与下一帧交叉淡化：60fps 下不再是"一张图卡 190ms"的跳帧感
      if (art.nextImg && art.blend > 0.001) {
        ctx.globalAlpha = art.blend;
        ctx.drawImage(art.nextImg, -w / 2, -h, w, h);
        ctx.globalAlpha = 1;
      }
      ctx.filter = 'none';
      ctx.scale(art.flip, 1);
      ctx.save(); ctx.scale(.7 * depth, .7 * depth);
      const swing = this.attackAnim > 0 ? Math.sin((1 - this.attackAnim / .24) * Math.PI) : 0;
      this.renderHeroWeapon(ctx, this.player.angle || 0, swing, this.attackCombo, this.weaponRecoil);
      ctx.restore();
      if (this.player.invuln > 0) {
        ctx.strokeStyle = 'rgba(125,231,255,.65)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(0, -4, 22 * depth, 9 * depth, 0, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
      return;
    }
    const angle = this.player.angle || 0;
    // 行走朝向必须来自移动方向，不能使用鼠标瞄准角度；否则玩家向上下左右走时始终播放右向帧。
    const moveAngle = this.player.facing !== undefined ? this.player.facing : angle;
    const horizontal = Math.abs(Math.cos(moveAngle)) >= Math.abs(Math.sin(moveAngle));
    const facingLeft = horizontal && Math.cos(moveAngle) < 0;
    const facingUp = !horizontal && Math.sin(moveAngle) < 0;
    const moving = (this.player.moveSpeed || 0) > 10;
    const bob = moving ? Math.sin(this.elapsed * 12) * 2 : Math.sin(this.elapsed * 3) * 0.8;
    const swing = this.attackAnim > 0 ? Math.sin((1 - this.attackAnim / 0.24) * Math.PI) : 0;
    const lift = this.player.visualZ || 0;
    const depthScale = this.getDepthScale(this.player.y);
    this.renderCastShadow(ctx, this.player.x, this.player.y, 34 * depthScale, 44 * depthScale, 0.42, lift);
    ctx.save();
    ctx.translate(sx, sy + bob - lift);
    // 角色落地阴影与脚底接触光，避免立绘像悬浮贴纸。
    ctx.save();
    ctx.scale(1, .34);
    const foot = ctx.createRadialGradient(0, 34, 3, 0, 34, 42);
    foot.addColorStop(0, 'rgba(8,12,10,.58)'); foot.addColorStop(1, 'rgba(8,12,10,0)');
    ctx.fillStyle = foot; ctx.beginPath(); ctx.ellipse(0, 34, 42, 20, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (this.player.invuln > 0) {
      ctx.save();
      ctx.scale(1 / (0.6 * depthScale), 1 / (0.6 * depthScale));
      ctx.strokeStyle = `rgba(125,231,255,${0.55 + Math.sin(this.elapsed * 10) * .2})`;
      ctx.lineWidth = 3;
      ctx.shadowColor = '#7de7ff'; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.arc(0, 20, 34, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    ctx.scale(0.6 * depthScale, 0.6 * depthScale);
    // P0-4 死亡呼吸窗口：压缩变形（Bounce.Out 压扁，X 向外扩补偿），平时 no-op
    if (typeof CombatDirector !== 'undefined') {
      const __sq = CombatDirector.deathSquash(this);
      if (__sq) ctx.scale(__sq.sx, __sq.sy);
    }
    if (facingLeft) ctx.scale(-1, 1);
    // v5.2 玩家攻击前倾 + 静止呼吸缩放
    if (this.attackAnim > 0) {
      const _pak = Math.sin(Math.min(1, this.attackAnim / 0.24) * Math.PI);
      ctx.translate(10 * _pak, 0);
      ctx.scale(1 + 0.09 * _pak, 1 - 0.04 * _pak);
    } else if (!moving) {
      const _pbr = Math.sin(this.elapsed * 3);
      ctx.scale(1 + _pbr * 0.008, 1 - _pbr * 0.008);
    }
    if (horizontal && this.playerWalkSheet?.naturalWidth) {
      const fw = this.playerWalkSheet.naturalWidth / 4;
      const frame = moving ? Math.floor((this.player.walkDistance || 0) / 14) % 4 : 0;
      const height = 140, sourceHeight = 1035, width = fw * height / sourceHeight;
      ctx.drawImage(this.playerWalkSheet, frame * fw, 290, fw, sourceHeight,
        -width / 2, -height, width, height);
    } else if (this.playerSprite?.naturalWidth) {
      // 现有资源没有独立的上下行走帧：上下移动使用正面立绘，避免继续显示右侧行走动作。
      // 向上时略微压低并降低亮度，形成背向移动的层次感。
      const pdraw = 140 * this.playerSprite.naturalHeight / this.playerSprite.naturalWidth;
      if (facingUp) { ctx.globalAlpha = .88; ctx.scale(1, .96); }
      ctx.drawImage(this.playerSprite, -70, -pdraw, 140, pdraw);
      ctx.globalAlpha = 1;
    }
    this.renderHeroWeapon(ctx, angle, swing, this.attackCombo, this.weaponRecoil);
    ctx.restore();
  },

  // v3.8 去黑底：把生成图的黑色背景变透明（缓存处理结果）
  drawNoBlack(ctx, img, dx, dy, dw, dh) {
    if ((img.src||'').includes('_t.png')) { ctx.drawImage(img, dx, dy, dw, dh); return; }
    if (!this._noBlackCache) this._noBlackCache = new Map();
    let processed = this._noBlackCache.get(img);
    if (!processed) {
      // 首次处理：把近黑像素变透明
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const cctx = c.getContext('2d');
      cctx.drawImage(img, 0, 0);
      try {
        const data = cctx.getImageData(0, 0, c.width, c.height);
        const px = data.data;
        for (let i = 0; i < px.length; i += 4) {
          const r = px[i], g = px[i+1], b = px[i+2];
          // 近黑像素（RGB 都 < 30）变透明
          if (r < 30 && g < 30 && b < 30) {
            px[i+3] = 0;
          } else if (r < 50 && g < 50 && b < 50) {
            // 边缘半透明过渡
            px[i+3] = Math.min(px[i+3], (r+g+b) / 150 * 255);
          }
        }
        cctx.putImageData(data, 0, 0);
      } catch(e) { /* 跨域时跳过 */ }
      processed = c;
      this._noBlackCache.set(img, processed);
    }
    ctx.drawImage(processed, dx, dy, dw, dh);
  },

  renderHeroWeapon(ctx, angle, swing, combo = 0, recoil = 0) {
    const dir = combo === 1 ? -1 : 1;
    ctx.save();
    // v3.8 武器放大+放到手上（木偶化后手在 y≈-32，武器同步下移缩小）
    ctx.translate(22, -64 - recoil * 3);
    const targetRot = Math.atan2(Math.sin(angle), Math.cos(angle));
    ctx.rotate(targetRot + swing * 0.3 * dir);
    if (this.weaponSheet && this.weaponSheet.naturalWidth) {
      const sheetH = this.weaponSheet.naturalHeight;
      const slotH = sheetH / 5;
      const rowMap = { harvest_sickle: 0, pea_repeater: 1, vine_staff: 2, throwing_knife: 3, flame_bow: 4 };
      const row = rowMap[this.weapon.id] || 0;
      const sw = this.weaponSheet.naturalWidth, sh = slotH;
      const dw = 85, dh = dw * sh / sw;
      if (!this._weaponCache) this._weaponCache = {};
      let proc = this._weaponCache[this.weapon.id];
      if (!proc) {
        proc = document.createElement('canvas');
        proc.width = sw; proc.height = sh;
        const pctx = proc.getContext('2d');
        pctx.drawImage(this.weaponSheet, 0, row*slotH, sw, sh, 0, 0, sw, sh);
        if (!this.weaponSheetPrekeyed) {
          try {
            const data = pctx.getImageData(0, 0, sw, sh);
            const px = data.data;
            for (let i = 0; i < px.length; i += 4) {
              const r = px[i], g = px[i+1], b = px[i+2];
              const lum = 0.299*r + 0.587*g + 0.114*b;
              // 旧武器图是白底：去掉近白
              if (lum > 200) px[i+3] = 0;
              else if (lum > 170) px[i+3] = Math.min(px[i+3], (200 - lum) / 30 * 255);
            }
            pctx.putImageData(data, 0, 0);
          } catch(e) {}
        }
        this._weaponCache[this.weapon.id] = proc;
      }
      ctx.drawImage(proc, -dw/2, -dh/2, dw, dh);
    }
    ctx.restore();
  },

  renderNutrientCrystals(ctx, cam) {
    const nowSeconds = performance.now() / 1000;
    this.nutrientCrystals.forEach(c => {
      if (!this.isWorldVisible(c.x, c.y)) return;
      const sx = c.x - cam.x, sy = c.y - cam.y + Math.sin(nowSeconds * 3 + c.bob) * 4;
      const glow = ctx.createRadialGradient(sx, sy, 1, sx, sy, 20);
      glow.addColorStop(0, 'rgba(255,226,138,.5)'); glow.addColorStop(1, 'rgba(255,226,138,0)');
      ctx.fillStyle = glow; ctx.fillRect(sx - 22, sy - 22, 44, 44);
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(nowSeconds * 1.6 + c.bob);
      ctx.fillStyle = '#ffe28a'; ctx.strokeStyle = '#b8860b'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(8, 0); ctx.lineTo(0, 10); ctx.lineTo(-8, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    });
  },

  // v3.5 远征植物 id -> CropArt id 映射
  _plantArtId(type) {
    const map = {
      chili: 'chili', garlic: 'garlic', mint: 'mint', cactus: 'cactus',
      sun_flower: 'sunflower', sunflower: 'sunflower',
      vine: 'rosemary', pea_plant: 'pea', frost_vine: 'frost_flower',
      bind_flower: 'shadow_flower', sacred_tree: 'rainbow_flower',
      firegrass: 'fire_grass', frost: 'frost_flower', lightning: 'lightning_vine',
      shadow: 'shadow_flower', rainbow: 'rainbow_flower',
      spike_root: 'spike_root', poison_spore: 'poison_spore', ice_cactus: 'ice_cactus',
      thunder_vine: 'thunder_vine', purify_flower: 'purify_flower', mirror_grass: 'mirror_grass',
    };
    return map[type] || null;
  },

  renderPlants(ctx, cam, list) {
    const items = list || (this.plantsDirty || !this.plantsSorted
      ? (this.plantsSorted = [...this.plants].sort((a, b) => a.y - b.y), this.plantsDirty = false, this.plantsSorted)
      : this.plantsSorted);
    items.forEach(p => {
      if (!this.isWorldVisible(p.x, p.y)) return;
      const sx = p.x - cam.x, sy = p.y - cam.y;
      // 血条 + 寿命条
      const barW = 30, barY = sy - 30;
      ctx.fillStyle = 'rgba(8,10,12,.7)'; ctx.beginPath(); ctx.roundRect(sx - barW / 2 - 2, barY - 2, barW + 4, 7, 3); ctx.fill();
      ctx.fillStyle = '#7dff9a'; ctx.beginPath(); ctx.roundRect(sx - barW / 2, barY, barW * clamp(p.hp / p.maxHp, 0, 1), 3, 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,226,138,.85)'; ctx.beginPath(); ctx.roundRect(sx - barW / 2, barY + 5, barW * clamp(p.life / p.maxLife, 0, 1), 2, 1); ctx.fill();
      // 图标（受击闪烁）
      const flash = p.hitFlash > 0 ? (Math.floor(p.hitFlash * 20) % 2 ? 0.4 : 1) : 1;
      ctx.globalAlpha = flash;
      const pScale = this.getDepthScale(p.y);
      const drawSize = (p.type === 'ultimate' ? 44 : 34) * pScale;
      // v3.5 优先用真实贴图，失败回退 emoji
      const artId = this._plantArtId(p.type);
      const usedArt = (typeof CropArt !== 'undefined' && artId) ? CropArt.draw(ctx, artId, sx, sy, drawSize) : false;
      if (!usedArt) {
        ctx.font = `${(p.type === 'ultimate' ? 36 : 28) * pScale}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(p.icon, sx, sy + 9 * pScale);
      }
      ctx.globalAlpha = 1;
      // 攻击动画
      if (p.attackAnim > 0) {
        ctx.strokeStyle = '#a6ffc2'; ctx.lineWidth = 2;
        ctx.globalAlpha = (p.attackAnim / .2) * .8;
        ctx.beginPath(); ctx.arc(sx, sy, 20 + (1 - p.attackAnim / .2) * 14, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (p.starving) {
        ctx.fillStyle = '#ffd37a'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('养分枯竭', sx, sy - 36);
      }
    });
  },

  renderMissionHUD() {
    if (!this.objective) return;
    let panel = document.getElementById('missionHud');
    if (!panel) { panel = document.createElement('div'); panel.id = 'missionHud'; document.getElementById('expeditionHUD').appendChild(panel); }
    const objective = this.objective;
    const progress = Math.min(objective.progress, objective.target);
    const eventMarkup = this.activeEvent ? `<div class="mission-event" style="--event-color:${this.activeEvent.color}"><b>${this.activeEvent.name}</b><span>${Math.ceil(this.activeEvent.timeLeft)}s · ${this.activeEvent.text}</span></div>` : '<div class="mission-event dormant"><b>区域平静</b><span>探索可能触发地图事件</span></div>';
    const ownedTowers = this.towers.filter(t => t.state === 'player').length;
    const protectedByTower = this.towers.some(t => t.state === 'player' && dist(t, this.player) <= t.range);
    const waveMarkup = this.beastWave.active
      ? `<div class="wave-status active"><b>⚠ 第 ${this.beastWave.wave} 波兽潮</b><span>剩余 ${this.beastWave.remaining} 只 · 下一波 ${Math.ceil(this.beastWave.nextIn)}s · ${protectedByTower ? '防御塔护盾生效' : '未受保护，伤害提升'}</span></div>`
      : `<div class="wave-status"><b>兽潮预警 ${Math.ceil(this.beastWave.nextIn)}s</b><span>已占塔 ${ownedTowers} · 提前进入绿色射程</span></div>`;
    panel.innerHTML = `<div class="mission-label">${this.phaseLabel || "低压探索"} · ${this.getTerrainAt(this.player.x,this.player.y).name}</div><span>${this.getTerrainAt(this.player.x,this.player.y).hint}</span><strong>${objective.title}${objective.complete ? ' · 已完成' : ''}</strong><span>${objective.description}</span><div class="mission-progress"><i style="width:${progress/objective.target*100}%"></i></div><small>${progress}/${objective.target}</small>${waveMarkup}${eventMarkup}${this.boss && this.boss.hp > 0 ? `<div class="boss-hud"><b>${this.boss.name}</b><span>阶段 ${this.boss.phase}</span><i style="width:${this.boss.hp/this.boss.maxHp*100}%"></i></div>` : ''}`;
  },

  updateHUD() {
    // HUD 分层：附近有怪时进入战斗态，隐藏背包计数与操作提示，只留血条/技能/小地图
    const hudRoot = document.getElementById('expeditionHUD');
    if (hudRoot) {
      const inCombat = this.monsters.some((m) => m.hp > 0 && dist(m, this.player) < 450);
      hudRoot.classList.toggle('hud-combat', inCombat);
    }
    // 血条能量条
    ExpeditionLayout.hud(this);
    document.getElementById('hpBar').style.width = (this.player.hp / this.player.maxHp * 100) + '%';
    document.getElementById('hpText').textContent = `${Math.ceil(this.player.hp)}/${this.player.maxHp}`;
    document.getElementById('energyBar').style.width = (this.player.energy / this.player.maxEnergy * 100) + '%';
    document.getElementById('energyText').textContent = `${Math.ceil(this.player.energy)}/${this.player.maxEnergy}`;
    // 养分
    const nb = document.getElementById('nutrientBar');
    const nt = document.getElementById('nutrientText');
    if (nb) nb.style.width = clamp(this.nutrient / this.nutrientMax, 0, 1) * 100 + '%';
    if (nt) nt.textContent = `${Math.floor(this.nutrient)}/${this.nutrientMax}`;

    // 计时器
    const mins = Math.floor(this.timeLeft / 60);
    const secs = Math.floor(this.timeLeft % 60);
    const timerEl = document.getElementById('timerDisplay');
    timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    timerEl.className = 'timer-display' + (this.timeLeft < 30 ? ' critical' : (this.timeLeft < 180 ? ' pressure' : ''));
    document.getElementById('mapNameDisplay').textContent = `T${this.map.tier} · ${this.map.name} · ${this.map.danger}`;
    const targetName = document.getElementById('targetName');
    const targetProgress = document.getElementById('targetProgress');
    const targetMeta = document.getElementById('targetMeta');
    if (targetName && this.objective) {
      targetName.textContent = this.boss && this.boss.hp > 0 ? `Boss：${this.boss.name || '区域首领'}` : this.objective.title;
      const pct = this.boss && this.boss.hp > 0 ? this.boss.hp / this.boss.maxHp : (this.objective.progress || 0) / Math.max(1, this.objective.target || 1);
      targetProgress.style.width = `${clamp(pct, 0, 1) * 100}%`;
      targetMeta.textContent = this.beastWave?.active ? `兽潮第 ${this.beastWave.wave} 波 · 剩余 ${this.beastWave.remaining || 0}` : `${this.objective.progress || 0}/${this.objective.target || 1} · ${this.map.danger}`;
    }
    document.getElementById('lowHealthVignette').classList.toggle('active', this.player.hp / this.player.maxHp <= 0.3);

    // 低频重量更新（250ms 节流）：任务面板/武器/技能/消耗品/背包/防线栏
    // 这些模块每帧 innerHTML 重建会强制布局并产生大量 DOM/GC 开销。
    this.hudTimer -= 1 / 60;
    if (this.hudTimer > 0) return;
    this.hudTimer = 0.25;
    this.renderMissionHUD();
    const weaponDisplay = document.getElementById('weaponDisplay');
    if (weaponDisplay) {
      weaponDisplay.style.setProperty('--weapon-color', this.weapon.color);
      const attackMode = this.weapon.mode === 'melee' ? '近战横扫' : (this.weapon.mode === 'ranged' ? '远程连射' : '贯穿灵波');
      weaponDisplay.innerHTML = `<span class="weapon-glyph">${this.weapon.icon}</span><div><b>${this.weapon.name}</b><small>${attackMode} · 伤害 ${this.weapon.damage}</small></div><kbd>Tab</kbd>`;
    }

    // 技能栏
    const skillBar = document.getElementById('skillBar');
    skillBar.innerHTML = '';
    (this.equippedSkills || CONFIG.skills.slice(0, 4).map(s => s.id)).forEach((sid, i) => {
      const baseSkill = CONFIG.skills.find(s => s.id === sid);
      if (!baseSkill) return;
      const skill = getSkillStats(baseSkill, this.skillBoosts[baseSkill.id] || 0);
      const cd = this.skillCooldowns[i];
      const div = document.createElement('div');
      const quality = skill.level >= 6 ? 'legendary' : (skill.level >= 3 ? 'rare' : 'common');
      div.className = `skill-slot quality-${quality}` + (cd <= 0 ? ' ready' : '') + (this.skillFlashes[i] > 0 ? ' casting' : '');
      div.style.setProperty('--skill-color', skill.color);
      div.title = skill.desc;
      const powerText = skill.damage > 0
        ? `⚔ ${skill.damage}`
        : (skill.stunDuration ? `控 ${skill.stunDuration}s` : (skill.dashDistance ? `移 ${skill.dashDistance}` : `隐 ${skill.stealthDuration}s`));
      const skillArt = (typeof CropArt !== 'undefined' && CropArt.ready(baseSkill.id)) ? CropArt.dom(baseSkill.id, skill.icon, 26) : skill.icon;
      div.innerHTML = `
        <span class="skill-key">${i + 1}</span>
        <span class="skill-icon">${skillArt}</span>
        <span class="skill-name">${skill.name} · Lv.${skill.level}${skill.extraLevels ? ` (+${skill.extraLevels})` : ''}</span>
        <div class="skill-meta"><span>${powerText}</span><span>⚡ ${skill.energyCost}</span><span>CD ${skill.cooldown}s</span></div>
        ${cd > 0 ? `<div class="skill-cd-ring" style="--progress:${clamp(cd / skill.cooldown, 0, 1)}"><span>${cd.toFixed(1)}</span></div>` : ''}
      `;
      skillBar.appendChild(div);
    });
    // 消耗品（v5.0：只展示已携带道具；未携带时给核心道具占位 + 折叠提示，避免 26 格撑爆屏幕）
    const consumableBar = document.getElementById('consumableBar');
    consumableBar.innerHTML = '';
    const KEYLABEL = { herb_kit: 'Q', signal_flare: 'E' };
    const CORE_CONS = ['herb_kit', 'signal_flare', 'thorn_storm'];
    const carried = CONFIG.consumables.filter(item => (this.consumables[item.id] || 0) > 0);
    const visList = carried.length
      ? carried
      : CONFIG.consumables.filter(item => CORE_CONS.includes(item.id));
    const hiddenCount = CONFIG.consumables.length - visList.length;
    visList.forEach(item => {
      const count = this.consumables[item.id] || 0;
      const div = document.createElement('div');
      div.className = 'skill-slot consumable' + (count > 0 ? ' ready' : '') + ((this.consumableFlashes[item.id] || 0) > 0 ? ' spent' : '');
      div.title = item.desc;
      const effectText = item.heal ? ('治疗 ' + item.heal) : (item.damage ? ('伤害 ' + item.damage) : (item.effectLabel || '局内道具'));
      const consArt = (typeof CropArt !== 'undefined' && CropArt.ready(item.id)) ? CropArt.dom(item.id, item.icon, 26) : item.icon;
      const keyLabel = count > 0 ? (KEYLABEL[item.id] || 'R') : '·';
      div.innerHTML =
        '<span class="skill-key">' + keyLabel + '</span>'
        + '<span class="skill-icon">' + consArt + '</span>'
        + '<span class="skill-name">' + item.name + '</span>'
        + '<div class="skill-meta"><span>' + effectText + '</span><span>' + (count > 0 ? (KEYLABEL[item.id] ? '快捷键' : 'R 转盘') : '未携带') + '</span></div>'
        + '<span class="skill-count">×' + count + '</span>';
      consumableBar.appendChild(div);
    });
    const wheelChip = document.createElement('div');
    wheelChip.className = 'skill-slot consumable cons-wheel-chip';
    wheelChip.title = '按 R 打开道具转盘，鼠标点选使用携带的消耗品（含火把/食品/药品）';
    wheelChip.innerHTML = '<span class="skill-key">R</span><span class="skill-icon" style="font-size:20px">🎡</span><span class="skill-name">道具转盘</span><div class="skill-meta"><span>' + (carried.length || 0) + ' 种已携带</span></div>';
    consumableBar.appendChild(wheelChip);
    if (hiddenCount > 0) {
      const chip = document.createElement('div');
      chip.className = 'skill-slot consumable cons-more';
      chip.title = '其余道具未携带，可在出征准备大厅携带（最多 6 种）';
      chip.innerHTML = '<span class="skill-icon" style="font-size:20px">🎒</span><span class="skill-name">+' + hiddenCount + ' 种</span><div class="skill-meta"><span>准备大厅</span></div>';
      consumableBar.appendChild(chip);
    }

    // 背包显示
    const bagDisplay = document.getElementById('bagDisplay');
    const gold = this.bag.filter(i => i.type === 'gold').reduce((s, i) => s + i.amount, 0);
    const seeds = this.bag.filter(i => i.type === 'seed_item' || i.type === 'seed' || i.type === 'plant_seed').reduce((s, i) => s + (i.amount || 1), 0);
    const safeCap = (typeof LoadoutSystem !== 'undefined') ? LoadoutSystem.getSafeCapacity() : 1;
    const coinArt = (typeof CropArt !== 'undefined' && CropArt.ready('coin')) ? CropArt.dom('coin', '💰', 18) : '💰';
    const pouchArt = (typeof CropArt !== 'undefined' && CropArt.ready('seed_pouch')) ? CropArt.dom('seed_pouch', '🌱', 18) : '🌱';
    bagDisplay.innerHTML = `
      <div class="bag-item">${coinArt} ${gold}</div>
      <div class="bag-item">${pouchArt} ${seeds}</div>
      <div class="bag-item">🎒 ${this.bag.length}件</div>
      <div class="bag-item" style="border-color:#d7a83d;color:#f2d078;">🔐 ${this.safeBox.length}/${safeCap}</div>
    `;

    // 防线槽（本局可部署植物）
    const defenseBar = document.getElementById('defenseBar');
    if (defenseBar) {
      const list = this.getPlantSeedList();
      defenseBar.innerHTML = list.length === 0
        ? `<div class="defense-slot empty">无防线种子 · 打开宝箱获取或出发前装备</div>`
        : list.map((p, i) => {
            const selected = this.selectedPlantId === p.id;
            const avail = p.maxPerRun - p.deployed;
            const pArt = (typeof CropArt !== 'undefined' && CropArt.ready(p.id)) ? CropArt.dom(p.id, p.icon, 26) : p.icon;
            return `<div class="defense-slot${selected ? ' selected' : ''}${avail <= 0 ? ' spent' : ''}" title="${p.name}：预扣养分${p.deployCost}，每${p.sustain}维持/s，寿命${p.life}s，本局可再种${avail}株">
              <span class="defense-key">${i + 5}</span><span class="defense-icon">${pArt}</span>
              <span class="defense-name">${p.name}</span><span class="defense-meta">养分${p.deployCost} · 剩余${avail}</span>
            </div>`;
          }).join('');
    }
  },

  render(ctx) {
    const cam = this.camera;
    // v1.4 双层渲染：世界层（ctx，被雾罩+昼夜分级）与 UI 层（uiCtx，永不雾罩/分级）。
    // UI 层不存在时回退单画布（旧语义）。
    const uictx = this.uiCtx || ctx;
    if (this.uiCtx) this.uiCtx.clearRect(0, 0, this.uiCanvas.width, this.uiCanvas.height);
    // v1.8 视角拉远：世界层统一套 zoom 缩放（ctx 内所有 world-cam 坐标自动乘 zoom 落屏），
    // 屏幕级效果（雾/昼夜/天气/暂停遮罩/迷雾事件渐变）必须画在恒等变换下。
    const rz = cam.zoom || 1;
    ctx.save();
    if (Math.abs(rz - 1) > 0.001) ctx.scale(rz, rz);
    this.renderGroundLayer(ctx, cam);    // 天气雾遮罩/野生植物/分层地形/脚印/地图边界
    this.renderAmbient(ctx, cam);        // 环境粒子层：漂浮尘埃/萤火（视差 0.3）
    this.renderTraps(ctx, cam);
    this.renderBossHazards(ctx, cam);
    this.renderGroundLoot(ctx, cam);
    this.renderNutrientCrystals(ctx, cam);
    this.renderMapMarkers(ctx, cam);     // 撤离点/危险区/传送门/宝箱/防御塔
    // Pixi 实体层接管整个 Y-sort 集合与弹道；未就绪/禁用时走 2D（失败安全）
    const entitiesOnPixi = !!(window.PixiEntities && PixiEntities.render(this));
    if (entitiesOnPixi) {
      // Same-frame success decides ownership; failed or covered layers fall back immediately.
    } else {
      this.renderSortedEntities(ctx, cam); // 2.5D Y-sort：植物/怪物/掠夺者/障碍/地标/道具/玩家
      this.renderProjectiles(ctx, cam);
    }
    this.renderAimLine(ctx, cam);
    this.renderDeployPreview(ctx, cam);
    this.renderParticles(ctx, cam);
    this.renderDamageNumbers(ctx, cam);
    ctx.restore();
    this.renderPauseOverlay(ctx);
    // 屏幕级反馈上 UI 层（v1.5）：濒死脉冲/受击红边/死亡序列不再被迷雾与昼夜分级压暗——
    // 濒死警示是保命信息，必须永远可见（走查发现夜雾中 hp<25% 红脉冲几乎不可见）。
    this.renderLowHealthPulse(uictx);
    this.renderScreenFlashes(uictx);
    this.renderHitDirs(uictx);           // v1.7 受击方向弧（保命信息，永不被雾/夜色吞）
    // P0-4 死亡呼吸窗口覆盖层（红闪/黑幕/死因文案）
    if (typeof CombatDirector !== 'undefined') CombatDirector.render(this, uictx);
    this.renderFogAndCombatHUD(ctx, uictx, cam);
    this.renderExtractBar(uictx);
    this.renderTerrainLandmarks(uictx, cam);
    this.renderAllySignal(uictx, cam);   // v1.9 游侠信号（UI 层：600px 环带必然雾外，指引信息永不被雾罩）
    this.renderWeather(ctx);
    this.renderDayNight(ctx);

    this.renderMinimap();
    this.renderInteractPrompt(uictx);
    this.renderOffscreenCompass(uictx, cam);  // v1.5 屏外目标方位罗盘（方向感）
    this.renderIntroToast(uictx);             // v1.5 落地引导 toast
    // v3.9 前景草遮挡 + 全局后处理
    if (typeof WorldFX !== 'undefined') {
      WorldFX.renderForeground(uictx, this);
      WorldFX.postProcess(uictx, this);
    }
  },

  renderGroundLayer(ctx, cam) {
    const size = CONFIG.expedition.mapSize;
    if (this.activeEvent?.id === 'mist') {
      // v1.8 屏幕级渐变在恒等变换下绘制（不受 zoom 缩放影响，覆盖整屏）
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const fog = ctx.createRadialGradient(CONFIG.canvas.width/2, CONFIG.canvas.height/2, 150, CONFIG.canvas.width/2, CONFIG.canvas.height/2, 650);
      fog.addColorStop(0, 'rgba(190,215,220,.02)'); fog.addColorStop(.55, 'rgba(150,180,185,.18)'); fog.addColorStop(1, 'rgba(12,23,28,.72)');
      ctx.fillStyle=fog; ctx.fillRect(0,0,CONFIG.canvas.width,CONFIG.canvas.height);
      ctx.restore();
    }
    // v3.5 植物改由下方 Y-sort 统一绘制（避免双绘）
    // this.renderPlants(ctx, cam);
    // 地形：3D（three.js 正交地表）优先 → Pixi 平面地形 → 2D chunk 三级回退
    this._terrainOn3D = !!(window.Terrain3D && Terrain3D.render && Terrain3D.render(this, cam));
    if (this._terrainOn3D) {
      // 3D 地表已绘制；Pixi 平面分块地形必须停用，避免盖在 3D 上
      this._terrainOnPixi = true;
      if (!this._pixiTerrainCleared) { this._pixiTerrainCleared = true; if (window.PixiTerrain && PixiTerrain.clear) PixiTerrain.clear(); }
    } else {
      this._pixiTerrainCleared = false;
      this._terrainOnPixi = !!(window.PixiTerrain && PixiTerrain.enabled && PixiTerrain.render(this, cam));
    }
    if (!this._terrainOn3D && !this._terrainOnPixi) {
      this.renderTerrain(ctx, cam);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (this.wildPlants) {
      for (const w of this.wildPlants) {
        if (w.picked) continue;
        const sx = w.x - cam.x, sy = w.y - cam.y;
        const artId = this._plantArtId(w.givesSeed || w.id);
        const used = (typeof CropArt !== 'undefined' && artId) ? CropArt.draw(ctx, artId, sx, sy, 30) : false;
        if (!used) {
          ctx.font = '24px serif';
          ctx.fillText(w.icon, sx, sy);
        }
      }
    }

    // 分层地形：道路、水域、田块、树林和地图专属地标。

    if (typeof WorldFX !== 'undefined') WorldFX.renderGround(ctx, this);
    if (window.WeatherFX) WeatherFX.renderGroundWet(ctx, this, cam); // v5.7 积水/反光/积雪/云影
    // v3.8 脚印
    this.renderFootprints(ctx, cam);

    // 地图边界
    ctx.strokeStyle = this.map.accentColor;
    ctx.lineWidth = 4;
    ctx.globalAlpha = 0.82;
    ctx.strokeRect(-cam.x, -cam.y, size, size);
    ctx.globalAlpha = 1;
  },
  renderPauseOverlay(ctx) {
    if (this.paused) {
      ctx.fillStyle = 'rgba(8, 14, 18, 0.68)';
      ctx.fillRect(0, 0, CONFIG.canvas.width, CONFIG.canvas.height);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f4d58a';
      ctx.font = '700 34px sans-serif';
      ctx.fillText('游戏已暂停', CONFIG.canvas.width / 2, CONFIG.canvas.height / 2 - 8);
      ctx.fillStyle = '#d7e2e5';
      ctx.font = '16px sans-serif';
      ctx.fillText('按 ESC 继续', CONFIG.canvas.width / 2, CONFIG.canvas.height / 2 + 28);
      ctx.textAlign = 'left';
    }
  },
  renderTraps(ctx, cam) {
    if (this.elapsed < 40) return;
    // 环境陷阱
    this.traps.forEach(trap => {
      if (!this.isWorldVisible(trap.x, trap.y)) return;
      const sx = trap.x - cam.x, sy = trap.y - cam.y;
      if (sx < -80 || sx > this.viewW() + 80 || sy < -80 || sy > this.viewH() + 80) return;
      const pulse = 0.65 + Math.sin(trap.phase * 3) * 0.18;
      ctx.globalAlpha = trap.type === 'bear' ? 0.72 : 0.88;
      ctx.fillStyle = trap.color + '22';
      ctx.strokeStyle = trap.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, trap.radius * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.font = `${trap.type === 'bear' ? 20 : 24}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(trap.icon, sx, sy + 7);
      ctx.globalAlpha = 1;
    });
  },
  // v5.1 Boss 延迟范围打击预警圈（收缩动画 + 图标，引爆前闪烁）
  renderBossHazards(ctx, cam) {
    if (!this.bossHazards || !this.bossHazards.length) return;
    this.bossHazards.forEach(h => {
      const sx = h.x - cam.x, sy = h.y - cam.y;
      if (sx < -120 || sy < -120 || sx > this.viewW() + 120 || sy > this.viewH() + 120) return;
      const frac = Math.max(0, Math.min(1, h.t / h.delay));
      const r = h.r * (0.35 + 0.65 * frac);
      const blink = h.t < 0.45 ? (Math.floor(h.t * 12) % 2 === 0 ? 1 : 0.45) : 0.85;
      ctx.save();
      ctx.globalAlpha = blink;
      ctx.fillStyle = h.color + '22';
      ctx.strokeStyle = h.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = blink;
      ctx.strokeStyle = h.color + '88';
      ctx.beginPath(); ctx.arc(sx, sy, h.r, 0, Math.PI * 2); ctx.stroke();
      ctx.font = '22px serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(h.icon, sx, sy);
      ctx.restore();
    });
  },

  renderGroundLoot(ctx, cam) {
    // 地面战利品：进入固定近战攻击范围后自动拾取。
    // v1.12 稀有度光柱（蓝/紫/金）+ 掉落弹出抛物线 + 落地尘土 + 高稀有度上升光点。
    const nowSeconds = performance.now() / 1000;
    const RAR_COL = { blue: '77,184,255', purple: '179,107,255', gold: '255,194,61' };
    for (const item of this.groundLoot) {
      if (!this.isWorldVisible(item.x, item.y)) continue;
      const sx = item.x - cam.x, sy = item.y - cam.y;
      if (sx < -60 || sx > this.viewW() + 60 || sy < -80 || sy > this.viewH() + 60) continue;
      // ---- 弹出抛物线：spawnT 由 updateGroundLootMagnet 衰减（视野外也走完），这里只读 ----
      let dropH = 0;
      if (item.spawnT > 0) {
        const k = 1 - item.spawnT / 0.42;                  // 0→1
        dropH = item.spawnH * (1 - (k * 2 - 1) * (k * 2 - 1));  // 抛物线
        if (item.spawnT <= 0.12) dropH += Math.sin((0.12 - item.spawnT) / 0.12 * Math.PI) * 7;
      }
      const rarCol = RAR_COL[item.rar];
      const near = dist(this.player, item) <= (CONFIG.weapons.find(weapon => weapon.mode === 'melee')?.range || CONFIG.player.attackRange);
      // ---- 稀有度光柱（竖直渐变梯形）+ 地面光环 ----
      if (rarCol) {
        const pulse = 0.72 + Math.sin(nowSeconds * 3.2 + item.bob) * 0.28;
        const beamH = item.rar === 'gold' ? 88 : item.rar === 'purple' ? 74 : 60;
        const bgrad = ctx.createLinearGradient(0, sy - beamH, 0, sy + 2);
        bgrad.addColorStop(0, `rgba(${rarCol},0)`);
        bgrad.addColorStop(0.55, `rgba(${rarCol},${0.26 * pulse})`);
        bgrad.addColorStop(1, `rgba(${rarCol},${0.5 * pulse})`);
        ctx.fillStyle = bgrad;
        ctx.beginPath();
        ctx.moveTo(sx - 4, sy - beamH);
        ctx.lineTo(sx + 4, sy - beamH);
        ctx.lineTo(sx + 15, sy + 2);
        ctx.lineTo(sx - 15, sy + 2);
        ctx.closePath(); ctx.fill();
        // 地面光环（椭圆，脉动）
        ctx.strokeStyle = `rgba(${rarCol},${0.5 * pulse})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(sx, sy + 3, 16 + pulse * 4, 6.5 + pulse * 1.6, 0, 0, Math.PI * 2); ctx.stroke();
        // 高稀有度上升光点（视野内偶尔冒一颗）
        if (Math.random() < 0.02) {
          const p = this.allocParticle();
          Object.assign(p, { x: item.x + rand(-8, 8), y: item.y - rand(4, 16), vx: rand(-6, 6), vy: rand(-46, -26),
            life: 0.8, maxLife: 0.8, color: `rgb(${rarCol})`, size: rand(1.4, 2.6), type: 'splat', drag: 0.4, grav: -20 });
          this.particles.push(p);
        }
      }
      // ---- 本体光晕（common 档也保留微光） ----
      const glow = ctx.createRadialGradient(sx, sy - dropH, 2, sx, sy - dropH, 28);
      const gc = rarCol || (item.type === 'invincible' ? '90,225,255' : '246,199,91');
      glow.addColorStop(0, `rgba(${gc},${near ? .5 : .26})`);
      glow.addColorStop(1, 'rgba(246,199,91,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(sx - 30, sy - dropH - 30, 60, 60);
      ctx.textAlign = 'center';
      // ---- 图标（掉落中缩放 punch：落地瞬间 1.22→1） ----
      if (!item._landAt && item.landed) item._landAt = nowSeconds;
      const lootArtId = (typeof CropArt !== 'undefined') ? CropArt.resolveArtId(item) : null;
      const iconSize = 25 * (item.spawnT > 0 ? 1 : Math.max(1, 1.22 - (nowSeconds - (item._landAt || 0)) * 2.4));
      if (lootArtId && CropArt.ready(lootArtId)) {
        CropArt.draw(ctx, lootArtId, sx, sy - dropH - 2, iconSize);
      } else {
        ctx.font = `${iconSize | 0}px sans-serif`;
        ctx.fillText(item.icon, sx, sy - dropH + 7);
      }
      if (near) {
        ctx.fillStyle = '#f6d77e';
        ctx.font = '10px sans-serif';
        ctx.fillText(`自动拾取 ${item.name}`, sx, sy - dropH - 22);
      }
    }
  },
  renderLowHealthPulse(ctx) {
    // v3.3 低血量心跳脉冲 + 受击红边 · v1.5 强化：阈值 35%、血量越低心跳越快越亮、外圈警示环
    const hpPct = this.player.maxHp > 0 ? this.player.hp / this.player.maxHp : 1;
    if (this.player.hp > 0 && hpPct < 0.35) {
      const danger = 1 - hpPct / 0.35;                    // 0→1 越濒死越高
      const bpm = 4 + danger * 5;                          // 心跳随血量加速（4→9 rad/s）
      const beat = (Math.sin(this.elapsed * bpm) + 1) / 2;
      const W = CONFIG.canvas.width, H = CONFIG.canvas.height;
      ctx.save();
      const grad = ctx.createRadialGradient(W/2, H/2, H*0.26, W/2, H/2, H*0.78);
      grad.addColorStop(0, 'rgba(180,0,0,0)');
      grad.addColorStop(1, 'rgba(190,0,0,' + (0.20 + 0.30 * beat * (0.5 + danger * 0.5)) + ')');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      // 濒死（<15%）加呼吸警示环：细描边随心跳收缩，视线焦点感
      if (hpPct < 0.15) {
        const ringR = H * (0.46 - beat * 0.05);
        ctx.strokeStyle = `rgba(255,60,50,${0.28 + beat * 0.3})`;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(W/2, H/2, ringR, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
    if (this.playerDamageFlash > 0) {
      this.playerDamageFlash -= 0.016;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,40,40,' + Math.min(0.85, this.playerDamageFlash * 2.2) + ')';
      ctx.lineWidth = 16;
      ctx.strokeRect(0, 0, CONFIG.canvas.width, CONFIG.canvas.height);
      ctx.restore();
    }
  },
  // v1.7 受击方向弧（Hades/Apex 惯例）：被屏外/雾中怪命中时，屏幕中心环上的红色弧段指向伤害来源。
  // 画在 UI 层（不受迷雾/昼夜压暗），0.9s 衰减，最多同时 4 条（AoE 群伤不糊屏）。
  renderHitDirs(ctx) {
    if (!this.hitDirs || !this.hitDirs.length) return;
    const W = CONFIG.canvas.width, H = CONFIG.canvas.height;
    const cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) * 0.30;
    ctx.save();
    for (const h of this.hitDirs) {
      const k = Math.max(0, h.t / 0.9);
      const alpha = 0.25 + 0.65 * k;
      const span = 0.30 + 0.14 * k;
      ctx.strokeStyle = `rgba(255,56,48,${alpha})`;
      ctx.lineWidth = 8 + 4 * k;
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(255,40,30,.8)';
      ctx.shadowBlur = 10 * k;
      ctx.beginPath();
      ctx.arc(cx, cy, R, h.a - span, h.a + span);
      ctx.stroke();
      // 弧心外一枚小箭头强化方向读数
      const ax = cx + Math.cos(h.a) * (R + 16), ay = cy + Math.sin(h.a) * (R + 16);
      ctx.fillStyle = `rgba(255,72,60,${alpha})`;
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(h.a);
      ctx.beginPath();
      ctx.moveTo(10, 0); ctx.lineTo(-6, 7); ctx.lineTo(-6, -7); ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  },
  renderMapMarkers(ctx, cam) {
    // 撤离点
    this.extractPoints.forEach(ep => {
      if (!this.isWorldVisible(ep.x, ep.y)) return;
      const sx = ep.x - cam.x, sy = ep.y - cam.y;
      ctx.beginPath();
      ctx.arc(sx, sy, ep.radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(127,255,127,0.15)';
      ctx.fill();
      ctx.strokeStyle = '#7fff7f';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '20px sans-serif';
      ctx.fillStyle = '#7fff7f';
      ctx.textAlign = 'center';
      ctx.fillText('🚁 撤离点', sx, sy - ep.radius - 8);
    });

    // v3.4 地图危险区
    if (this.hazardZones) {
      for (const hz of this.hazardZones) {
        const sx = hz.x - cam.x, sy = hz.y - cam.y;
        if (sx < -150 || sx > this.viewW() + 150 || sy < -150 || sy > this.viewH() + 150) continue;
        ctx.beginPath();
        ctx.arc(sx, sy, hz.r, 0, Math.PI * 2);
        if (hz.type === 'pit') {
          ctx.fillStyle = 'rgba(40,30,25,0.55)';
          ctx.fill();
          ctx.strokeStyle = '#5a4030';
          ctx.lineWidth = 2;
          ctx.stroke();
        } else if (hz.type === 'mud') {
          ctx.fillStyle = 'rgba(90,70,40,0.45)';
          ctx.fill();
        } else if (hz.type === 'poison') {
          const pulse = 0.35 + 0.15 * Math.sin(performance.now() / 300);
          ctx.fillStyle = `rgba(150,80,200,${pulse})`;
          ctx.fill();
        }
      }
    }
    // v3.4 时空传送门（v1.3 程序化能量门烘焙）
    if (this.teleporters) {
      for (const tp of this.teleporters) {
        const sx = tp.x - cam.x, sy = tp.y - cam.y;
        ctx.beginPath();
        ctx.arc(sx, sy, tp.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(120,160,255,0.18)';
        ctx.fill();
        if (typeof ArtTextures !== 'undefined') {
          const art = ArtTextures.portalArt();
          const sz = tp.r * 2.3;
          ctx.drawImage(art, sx - sz / 2, sy - sz / 2, sz, sz);
        } else {
          ctx.strokeStyle = '#7aa8ff';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }

    // 宝箱（v1.3 木箱烘焙替代 emoji）
    this.chests.forEach(c => {
      if (!this.isWorldVisible(c.x, c.y)) return;
      const sx = c.x - cam.x, sy = c.y - cam.y;
      if (sx < -50 || sx > this.viewW() + 50 || sy < -50 || sy > this.viewH() + 50) return;
      if (typeof ArtTextures !== 'undefined') {
        const art = ArtTextures.chestArt(c.opened);
        ctx.drawImage(art, sx - 32, sy - 32 * 1.7 + 12, 64, 64);
      } else {
        ctx.font = '28px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(c.opened ? '📭' : '📦', sx, sy + 8);
      }
      if (!c.opened) {
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, 20, 0, Math.PI * 2);
        ctx.stroke();
      }
    });

    // v5.8 篝火 / 商人（v1.3 烘焙纹理 + 呼吸光晕）
    if (this.campfire && this.isWorldVisible(this.campfire.x, this.campfire.y)) {
      const sx = this.campfire.x - cam.x, sy = this.campfire.y - cam.y;
      if (typeof ArtTextures !== 'undefined') {
        // 动态光晕（火光呼吸）
        const flick = .5 + .18 * Math.sin(performance.now() / 160) + .1 * Math.sin(performance.now() / 61);
        const glow = ctx.createRadialGradient(sx, sy - 10, 4, sx, sy - 10, 42);
        glow.addColorStop(0, `rgba(255,150,60,${.3 * flick + .1})`);
        glow.addColorStop(1, 'rgba(255,150,60,0)');
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(sx, sy - 10, 42, 0, Math.PI * 2); ctx.fill();
        const art = ArtTextures.campfireArt();
        ctx.drawImage(art, sx - 30, sy - 30 * 1.7 + 12, 60, 60);
      } else {
        ctx.font = '30px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('🔥', sx, sy + 8);
      }
      ctx.strokeStyle = '#ff9a3c'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx, sy, 22, 0, Math.PI * 2); ctx.stroke();
    }
    if (this.merchant && this.isWorldVisible(this.merchant.x, this.merchant.y)) {
      const sx = this.merchant.x - cam.x, sy = this.merchant.y - cam.y;
      if (typeof ArtTextures !== 'undefined') {
        const art = ArtTextures.merchantArt();
        ctx.drawImage(art, sx - 28, sy - 28 * 1.8 + 12, 56, 56);
      } else {
        ctx.font = '30px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('🧑‍🌾', sx, sy + 8);
      }
      ctx.strokeStyle = '#7fb8ff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx, sy, 22, 0, Math.PI * 2); ctx.stroke();
    }

    // 防御塔（v1.3 程序化石砌哨塔烘焙纹理替代 emoji）
    this.towers.forEach(t => {
      if (!this.isWorldVisible(t.x, t.y)) return;
      const sx = t.x - cam.x, sy = t.y - cam.y;
      if (sx < -60 || sx > this.viewW() + 60 || sy < -60 || sy > this.viewH() + 60) return;
      let color = '#8a8f98';
      if (t.state === 'player') color = '#7fff7f';
      else if (t.state === 'enemy') color = '#ff4444';
      else if (t.state === 'broken') color = '#555';
      if (typeof ArtTextures !== 'undefined') {
        const art = ArtTextures.towerArt(t.state);
        ctx.drawImage(art, sx - 44, sy - 44 * 1.75 + 16, 88, 88);
      }
      if (t.state !== 'broken') {
        // 状态环（沿塔基）
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, t.radius, 0, Math.PI * 2);
        ctx.stroke();
        // 攻击范围（呼吸脉冲——占领前的目标感）
        const pulse = .22 + .1 * Math.sin(performance.now() / 500);
        ctx.strokeStyle = t.state === 'player' ? `rgba(127,255,127,${pulse})` : color + '44';
        ctx.setLineDash([10, 8]);
        ctx.beginPath();
        ctx.arc(sx, sy, t.range, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });
  },
  renderSortedEntities(ctx, cam) {
    // v3.5 2.5D：所有实体按 y 轴排序绘制（前后遮挡）
    const drawables = [];
    // 植物
    this.plants.forEach(p => drawables.push({ y: p.y, type: 'plant', obj: p }));
    // 怪物
    this.monsters.forEach(m => {
      if (!this.isWorldVisible(m.x, m.y)) return;
      drawables.push({ y: m.y, type: 'monster', obj: m });
    });
    // 掠夺者
    this.raiders.forEach(r => {
      if (!this.isWorldVisible(r.x, r.y)) return;
      drawables.push({ y: r.y, type: 'raider', obj: r });
    });
    // v1.9 游侠盟友（活的/阵亡淡出的都参与 Y-sort）
    (this.allies || []).forEach(a => {
      if (!this.isWorldVisible(a.x, a.y)) return;
      drawables.push({ y: a.y, type: 'ally', obj: a });
    });
    // 障碍物
    this.obstaclesByY.forEach(o => {
      if (o.fxOnly) return;
      if (!this.isWorldVisible(o.x, o.y)) return;
      drawables.push({ y: o.y, type: 'obstacle', obj: o });
    });
    if (this.fxWalls) this.fxWalls.forEach(w => { if (this.isWorldVisible(w.x, w.y)) drawables.push({ y: w.y, type: 'wallfx', obj: w }); });
    if (this.fxProps) this.fxProps.forEach(pp => { if (this.isWorldVisible(pp.x, pp.y)) drawables.push({ y: pp.y, type: 'fxprop', obj: pp }); });
    // 地标（大物件，Y-sort 挡在玩家前面）
    if (this.landmarks) this.landmarks.forEach(lm => {
      if (!this.isWorldVisible(lm.x, lm.y)) return;
      drawables.push({ y: lm.y, type: 'landmark', obj: lm });
    });
    // 道具（油桶/木箱/高草/骷髅/推车）
    if (this.props) this.props.forEach(pr => {
      if (!this.isWorldVisible(pr.x, pr.y)) return;
      drawables.push({ y: pr.y, type: 'prop', obj: pr });
    });
    // 玩家（y 位置 + 1，保证站在怪脚下时怪在身后）
    drawables.push({ y: this.player.y + 1, type: 'player' });
    drawables.sort((a, b) => a.y - b.y);

    // v3.8 落地投影
    const self = this;
    this._drawShadow = function(sx, sy, r, alpha) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,' + (alpha || 0.28) + ')';
      ctx.beginPath();
      ctx.ellipse(sx + r * 0.16, sy + r * 0.32, r * 0.9, r * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    for (const d of drawables) {
      if (d.type === 'plant') {
        this.renderPlants(ctx, cam, [d.obj]);
      } else if (d.type === 'monster') {
        const m = d.obj;
        const sx = m.x - cam.x, sy = m.y - cam.y;
        self._drawShadow(sx, sy, m.radius || 18, m.elite ? 0.35 : 0.25);
        this.renderMonster(ctx, m, cam);
        this.renderMonsterStatus(ctx, m, sx, sy);
        if (m.stunned > 0) {
          ctx.fillStyle = '#ffff00';
          ctx.font = '14px sans-serif';
          ctx.fillText('💫', sx, sy - m.radius - 18);
        }
      } else if (d.type === 'raider') {
        const r = d.obj;
        const sx = r.x - cam.x, sy = r.y - cam.y;
        self._drawShadow(sx, sy, r.radius || 16, 0.3);
        // v1.3 兜帽刺客烘焙（替代 emoji）
        if (typeof ArtTextures !== 'undefined') {
          const art = ArtTextures.raiderArt();
          ctx.drawImage(art, sx - 24, sy - 24 * 1.8 + 10, 48, 48);
        } else {
          ctx.font = '24px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('🥷', sx, sy + 8);
        }
        const hpPct = r.hp / r.maxHp;
        ctx.fillStyle = '#333';
        ctx.fillRect(sx - 20, sy - r.radius - 12, 40, 5);
        ctx.fillStyle = '#ff6644';
        ctx.fillRect(sx - 20, sy - r.radius - 12, 40 * hpPct, 5);
        ctx.font = '24px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🥷', sx, sy + 8);
      } else if (d.type === 'ally') {
        // v1.9 游侠盟友（本体 + 血条 + 名字 + 聊天气泡）
        this.renderAlly(ctx, d.obj, cam);
      } else if (d.type === 'obstacle') {
        this.renderObstacle(ctx, d.obj, cam);
      } else if (d.type === 'landmark') {
        const lm = d.obj;
        const img = this.landmarkImgs && this.landmarkImgs[lm.type];
        const sx = lm.x - cam.x, sy = lm.y - cam.y;
        self._drawShadow(sx, sy, lm.size * 0.4, 0.35);
        if (img && img.complete && img.naturalWidth > 0) {
          const s = lm.size;
          this.drawNoBlack(ctx, img, sx - s/2, sy - s, s, s);
        } else {
          ctx.fillStyle = '#4a3a2a';
          ctx.beginPath();
          ctx.arc(sx, sy, 30, 0, Math.PI*2);
          ctx.fill();
        }
      } else if (d.type === 'prop') {
        const pr = d.obj;
        const prsx = pr.x - cam.x, prsy = pr.y - cam.y;
        if (pr.kind !== 'grass') self._drawShadow(prsx, prsy, pr.size * 0.4, 0.25);
        if (pr.kind === 'grass' && !pr.used) {
          const img = this.propImgs && this.propImgs.grass;
          const sx = pr.x - cam.x, sy = pr.y - cam.y;
          if (img && img.complete && img.naturalWidth > 0) {
            this.drawNoBlack(ctx, img, sx - pr.size/2, sy - pr.size/2, pr.size, pr.size*0.7);
          } else {
            ctx.fillStyle = '#4a7a3a';
            ctx.beginPath(); ctx.arc(sx, sy, pr.size/2, 0, Math.PI*2); ctx.fill();
          }
        } else if (pr.kind === 'skeleton' && !pr.looted) {
          const img = this.propImgs && this.propImgs.skeleton;
          const sx = pr.x - cam.x, sy = pr.y - cam.y;
          if (img && img.complete && img.naturalWidth > 0) {
            this.drawNoBlack(ctx, img, sx - pr.size/2, sy - pr.size/2, pr.size, pr.size);
          } else {
            ctx.font = '24px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('💀', sx, sy + 8);
          }
        } else if (pr.kind === 'cart' && !pr.looted) {
          const img = this.propImgs && this.propImgs.cart;
          const sx = pr.x - cam.x, sy = pr.y - cam.y;
          if (img && img.complete && img.naturalWidth > 0) {
            this.drawNoBlack(ctx, img, sx - pr.size/2, sy - pr.size/2, pr.size, pr.size*0.7);
          } else {
            ctx.font = '24px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('🛒', sx, sy + 8);
          }
        } else if (pr.kind === 'barrel' && pr.hp > 0) {
          const img = this.propImgs && this.propImgs.barrel;
          const sx = pr.x - cam.x, sy = pr.y - cam.y;
          if (img && img.complete && img.naturalWidth > 0) {
            this.drawNoBlack(ctx, img, sx - pr.size/2, sy - pr.size/2, pr.size, pr.size);
          } else {
            ctx.font = '24px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('🛢️', sx, sy + 8);
          }
        } else if (pr.kind === 'crate' && pr.hp > 0) {
          const img = this.propImgs && this.propImgs.crate;
          const sx = pr.x - cam.x, sy = pr.y - cam.y;
          if (img && img.complete && img.naturalWidth > 0) {
            this.drawNoBlack(ctx, img, sx - pr.size/2, sy - pr.size/2, pr.size, pr.size);
          } else {
            ctx.font = '24px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('📦', sx, sy + 8);
          }
        }
      } else if (d.type === 'wallfx') {
        WorldFX.renderWall(ctx, this, d.obj);
      } else if (d.type === 'fxprop') {
        WorldFX.renderSetProp(ctx, this, d.obj);
      } else if (d.type === 'player') {
        const psx = this.player.x - cam.x, psy = this.player.y - cam.y;
        self._drawShadow(psx, psy, 18, 0.32);
        ctx.globalAlpha = this.player.stealth > 0 ? 0.4 : 1;
        if (this.player.invuln > 0 && Math.floor(this.player.invuln * 10) % 2 === 0) {
          ctx.globalAlpha *= 0.5;
        }
        // v3.5 玩家也应用深度缩放
        const dScale = typeof PlayerArt !== 'undefined' && PlayerArt.resolve(this.player) ? 1 : this.getDepthScale(this.player.y);
        ctx.save();
        ctx.translate(psx, psy);
        ctx.scale(dScale, dScale);
        ctx.translate(-psx, -psy);
        this.renderHero(ctx, psx, psy);
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    }
  },
  renderProjectiles(ctx, cam) {
    // 子弹
    this.projectiles.forEach(p => {
      if (p.fromMonster && !this.isWorldVisible(p.x, p.y)) return;
      const sx = p.x - cam.x, sy = p.y - cam.y;
      ctx.save();
      const projectileAngle = Math.atan2(p.vy, p.vx);
      if (p.fromPlayer && p.weaponId === 'pea_repeater') {
        ctx.shadowColor = p.color; ctx.shadowBlur = 12; ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(sx, sy, p.radius, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(208,255,169,.7)'; ctx.lineWidth = 3; ctx.beginPath();
        ctx.moveTo(sx - Math.cos(projectileAngle) * 22, sy - Math.sin(projectileAngle) * 22); ctx.lineTo(sx, sy); ctx.stroke();
      } else if (p.fromPlayer && p.weaponId === 'vine_staff') {
        ctx.translate(sx, sy); ctx.rotate(projectileAngle); ctx.shadowColor = p.color; ctx.shadowBlur = 14;
        const beam = ctx.createLinearGradient(-26, 0, 18, 0); beam.addColorStop(0, 'rgba(123,229,196,0)'); beam.addColorStop(1, p.color);
        ctx.fillStyle = beam; ctx.beginPath(); ctx.ellipse(0, 0, 27, 7, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#d5fff1'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-14, 0); ctx.quadraticCurveTo(0, -8, 16, 0); ctx.stroke();
      } else {
        // v1.12 易读性升级：拖尾（玩家弹青绿 / 怪弹橙红）+ 怪弹红核白描边（Brotato 惯例：敌火一眼可辨）
        const host = p.fromMonster;
        const col = p.fromMonster ? (p.color || '#ff6644') : '#7fff7f';
        const trailCol = p.fromMonster ? '255,110,70' : '127,255,127';
        // 拖尾：沿速度反方向的三段渐隐残影
        const sp = Math.hypot(p.vx, p.vy) || 1;
        const tx = p.vx / sp, ty = p.vy / sp;
        for (let k = 1; k <= 3; k++) {
          const a = (0.26 / k) * (host ? 1 : 0.8);
          ctx.globalAlpha = a;
          ctx.fillStyle = `rgb(${trailCol})`;
          ctx.beginPath(); ctx.arc(sx - tx * k * 9, sy - ty * k * 9, p.radius * (1 - k * 0.22), 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
        if (host) {
          ctx.shadowColor = col; ctx.shadowBlur = 10;
          ctx.fillStyle = col;
          ctx.beginPath(); ctx.arc(sx, sy, p.radius, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.arc(sx, sy, p.radius + 1.2, 0, Math.PI * 2); ctx.stroke();
        } else {
          ctx.shadowColor = col; ctx.shadowBlur = 9;
          ctx.fillStyle = col;
          ctx.beginPath(); ctx.arc(sx, sy, p.radius, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = 'rgba(255,255,255,.75)';
          ctx.beginPath(); ctx.arc(sx - tx * p.radius * .3, sy - ty * p.radius * .3, p.radius * .45, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();
    });
  },
  renderAimLine(ctx, cam) {
    // Active weapon range and aim line.
    const psx = this.player.x - cam.x, psy = this.player.y - cam.y;
    const wm = this.screenToWorld(this.mouse.x, this.mouse.y);   // v1.8 zoom 换算
    const worldMouseX = wm.x;
    const worldMouseY = wm.y;
    const angle = Math.atan2(worldMouseY - this.player.y, worldMouseX - this.player.x);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(psx, psy);
    ctx.lineTo(psx + Math.cos(angle) * Math.min(this.weapon.range, 145), psy + Math.sin(angle) * Math.min(this.weapon.range, 145));
    ctx.stroke();
  },
  renderDeployPreview(ctx, cam) {
    // Foreground geometry is drawn after the hero so trunks and ruins create real occlusion.
    // Nearby blockers fade through isBehindHero(), keeping the character readable.
    // 防线部署预览（选中植物时鼠标处显示半透明图标 + 可用性）
    if (this.selectedPlantId) {
      const selPlant = CONFIG.plants.find(p => p.id === this.selectedPlantId);
      if (selPlant) {
        // v1.8 zoom：屏幕鼠标 → 世界（部署判定）/ 世界绘制坐标（画布已套 zoom 变换，屏幕 px 需除回）
        const zq = cam.zoom || 1;
        const pmx = this.mouse.x / zq, pmy = this.mouse.y / zq;
        const wm = this.screenToWorld(this.mouse.x, this.mouse.y);
        const canPlace = this.canDeployHere(wm.x, wm.y, 18)
          && dist(this.player, { x: wm.x, y: wm.y }) <= 240
          && this.nutrient >= selPlant.deployCost;
        ctx.globalAlpha = canPlace ? 0.72 : 0.28;
        ctx.font = '30px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(selPlant.icon, pmx, pmy + 9);
        ctx.strokeStyle = canPlace ? '#7dff9a' : '#ff6b6b';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(pmx, pmy, 20, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
        if (!canPlace) {
          ctx.fillStyle = '#ff8a8a'; ctx.font = '12px sans-serif';
          ctx.fillText('不可部署', pmx, pmy + 34);
        }
      }
    }
  },
  /* 环境粒子层：每张图 30-40 个漂浮尘埃/萤火，视差 0.3，静止画面不空 */
  renderAmbient(ctx, cam) {
    // 环境粒子随地貌换色：T1/T2 花粉与尘埃、T3 毒沼孢子、T4 虚空灰烬
    const tier = (this.map && this.map.tier) || 1;
    const PAL = {
      1: { warm: '#ffe6a8', cool: '#dfe8c8', n: 34, alpha: 0.12 },
      2: { warm: '#ffd9a0', cool: '#d8e0c0', n: 36, alpha: 0.12 },
      3: { warm: '#9fe6a8', cool: '#b8e07a', n: 42, alpha: 0.13 },
      4: { warm: '#c9b6ff', cool: '#8fa8ff', n: 26, alpha: 0.10 }
    };
    const pal = PAL[tier] || PAL[1];
    if (!this._ambient || this._ambientTier !== tier) {
      this._ambientTier = tier;
      this._ambient = Array.from({ length: pal.n }, () => ({
        x: Math.random() * CONFIG.canvas.width * 1.5,
        y: Math.random() * CONFIG.canvas.height * 1.5,
        r: 0.6 + Math.random() * 1.4,
        sp: 3 + Math.random() * 7,
        ph: Math.random() * 6.283,
        warm: Math.random() < 0.35
      }));
    }
    const W = CONFIG.canvas.width * 1.5, H = CONFIG.canvas.height * 1.5;
    const t = this.elapsed || 0;
    const px = cam.x * 0.3, py = cam.y * 0.3;
    ctx.save();
    for (const a of this._ambient) {
      let x = (a.x - px + t * a.sp) % W; if (x < 0) x += W;
      let y = (a.y - py + Math.sin(t * 0.5 + a.ph) * 10) % H; if (y < 0) y += H;
      ctx.globalAlpha = (pal.alpha || 0.11) * (0.6 + 0.4 * Math.sin(t * 0.8 + a.ph));
      ctx.fillStyle = a.warm ? pal.warm : pal.cool;
      ctx.beginPath(); ctx.arc(x, y, a.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  },
  // 程序化新月刀光：玩家挥砍 / 怪物攻击共用（颜色、大小、方向、进度可调）
  drawSlashArc(ctx, x, y, angle, color, size, alpha, t, dir = 1) {
    const a = Math.max(0, Math.min(1, alpha || 0));
    if (a <= 0.001) return;
    const sweep = (1.85 + t * 0.35) * dir;
    const outerR = size * (1.05 + t * 0.22);
    const innerR = outerR * 0.56;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle || 0);
    ctx.globalCompositeOperation = 'lighter';
    // 新月刃体：外弧 + 内弧反向闭合，两端自然收尖
    ctx.beginPath();
    ctx.arc(0, 0, outerR, -sweep / 2, sweep / 2, dir < 0);
    ctx.arc(0, 0, innerR, sweep / 2, -sweep / 2, dir > 0);
    ctx.closePath();
    const g = ctx.createRadialGradient(0, 0, innerR, 0, 0, outerR);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(.55, color || '#f2c45b');
    g.addColorStop(1, 'rgba(255,255,255,.92)');
    ctx.fillStyle = g;
    ctx.globalAlpha = a * .5;
    ctx.fill();
    // 外缘柔光
    ctx.globalAlpha = a * .55;
    ctx.strokeStyle = color || '#f2c45b';
    ctx.lineWidth = size * .12;
    ctx.beginPath();
    ctx.arc(0, 0, outerR, -sweep / 2, sweep / 2, dir < 0);
    ctx.stroke();
    // 白热内刃
    ctx.globalAlpha = a * .95;
    ctx.strokeStyle = 'rgba(255,252,240,.95)';
    ctx.lineWidth = Math.max(1.6, size * .05);
    ctx.beginPath();
    ctx.arc(0, 0, outerR * .74, -sweep * .42, sweep * .42, dir < 0);
    ctx.stroke();
    // 刀尖星屑
    for (let e = 0; e < 2; e++) {
      const ang = (sweep / 2) * (e === 0 ? 1 : -1);
      const rx = Math.cos(ang) * outerR * .95, ry = Math.sin(ang) * outerR * .95;
      ctx.globalAlpha = a * .85;
      const tip = ctx.createRadialGradient(rx, ry, 0, rx, ry, size * .2);
      tip.addColorStop(0, 'rgba(255,255,245,.95)');
      tip.addColorStop(.4, color || '#f2c45b');
      tip.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = tip;
      ctx.beginPath();
      ctx.arc(rx, ry, size * .2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  },

  renderParticles(ctx, cam) {
    // 粒子
    this.particles.forEach(p => {
      if (window.PixiEffects?.graphics && (!p.type || p.type === 'smoke')) return;
      if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.size)) return;
      const sx = p.x - cam.x, sy = p.y - cam.y;
      const alpha = p.life / p.maxLife;
      if (p.type === 'aoe') {
        ctx.beginPath();
        ctx.arc(sx, sy, p.size * (1 - alpha * 0.3), 0, Math.PI * 2);
        ctx.strokeStyle = p.color;
        ctx.globalAlpha = alpha * 0.6;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (p.type === 'starburst') {
        // v5.8.3 暴击星芒爆裂（程序化）：白热亮核 + 色晕 + 8 向渐变光束（4 长 4 短），出帧即猛、快速收束
        const t = 1 - alpha;
        const env = Math.sin(Math.min(1, t * 1.22) * Math.PI * 0.8 + 0.2);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(p.rot || 0);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = alpha;
        const coreR = p.size * (0.55 + env * 0.8);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, coreR);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.32, p.color);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, 0, coreR, 0, Math.PI * 2); ctx.fill();
        for (let i = 0; i < 8; i++) {
          const long = i % 2 === 0;
          const L = p.size * (long ? 3.1 : 1.75) * (0.38 + env * 0.72);
          const w = (long ? 3.4 : 2.1) * (0.55 + env * 0.55);
          ctx.save();
          ctx.rotate(i * Math.PI / 4);
          const lg = ctx.createLinearGradient(0, 0, L, 0);
          lg.addColorStop(0, '#ffffff');
          lg.addColorStop(0.22, p.color);
          lg.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = lg;
          ctx.beginPath();
          ctx.moveTo(0, -w);
          ctx.lineTo(L, -w * 0.12);
          ctx.lineTo(L, w * 0.12);
          ctx.lineTo(0, w);
          ctx.closePath(); ctx.fill();
          ctx.restore();
        }
        ctx.restore();
        ctx.globalAlpha = 1;
      } else if (p.type === 'mist') {
        // v5.8.3 程序化血雾：暗红雾团扩散淡出（替代 hit_blood 贴图）
        const r = p.size * (1.55 - alpha * 0.5);
        ctx.save();
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
        g.addColorStop(0, p.color);
        g.addColorStop(0.55, p.color);
        g.addColorStop(1, 'rgba(60,8,12,0)');
        ctx.globalAlpha = alpha * 0.5;
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.globalAlpha = 1;
      } else if (p.type === 'slash') {
        // 程序化刀光（新月刃 + 白热内刃 + 刀尖星屑），不再加载 fire_slash 贴图
        this.drawSlashArc(ctx, sx, sy, p.angle, p.color, p.size, alpha, 1 - alpha, p.dir || 1);
      } else if (p.type === 'warn') {
        // Boss 蓄力警示：头顶上浮闪烁的感叹号
        ctx.save();
        ctx.translate(sx, sy);
        const blink = 0.55 + Math.sin(p.life * 26) * 0.45;
        ctx.globalAlpha = alpha * blink;
        ctx.fillStyle = p.color;
        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('!', 0, 0);
        ctx.restore();
      } else if (p.type === 'impact') {
        const grow = p.size * (1.25 - alpha * .25);
        if (!isFinite(grow) || grow <= 0) { ctx.restore(); return; }
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, grow);
        glow.addColorStop(0, p.color);
        glow.addColorStop(0.45, p.color + 'aa');
        glow.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(sx, sy, grow, 0, Math.PI * 2); ctx.fill();
        // 十字星芒
        ctx.strokeStyle = '#ffffff';
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 2;
        const m = grow * 0.9;
        ctx.beginPath();
        ctx.moveTo(sx - m, sy); ctx.lineTo(sx + m, sy);
        ctx.moveTo(sx, sy - m); ctx.lineTo(sx, sy + m);
        ctx.stroke();
        ctx.restore();
        ctx.globalAlpha = 1;
      } else if (p.type === 'shock') {
        const r = p.size * (1 - alpha * alpha);
        ctx.beginPath(); ctx.arc(sx, sy, Math.max(2, r), 0, Math.PI * 2);
        ctx.strokeStyle = p.color; ctx.globalAlpha = alpha * 0.85;
        ctx.lineWidth = 2 + alpha * 3; ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (p.type === 'trail') {
        const dir = p.dir || 1;
        const layer = p.layer || 0;
        const sweep = (1 - alpha) * 1.9;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(p.angle);
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        ctx.strokeStyle = p.color;
        ctx.globalAlpha = alpha * (layer === 0 ? 0.85 : 0.4);
        ctx.lineWidth = layer === 0 ? 5 : 3;
        ctx.beginPath();
        ctx.arc(0, 0, p.size, -sweep * dir * 0.5, sweep * dir * 0.5);
        ctx.stroke();
        if (layer === 0) {
          ctx.strokeStyle = '#ffffff';
          ctx.globalAlpha = alpha * 0.75;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, p.size * 0.96, -sweep * dir * 0.42, sweep * dir * 0.42);
          ctx.stroke();
        }
        ctx.restore();
        ctx.globalAlpha = 1;
      } else if (p.type === 'splat') {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(sx, sy, Math.max(1, p.size * alpha), 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.globalAlpha = 1;
      } else if (p.type === 'ice') {
        ctx.save();
        ctx.translate(sx, sy); ctx.rotate(p.rot || 0);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        const isz = p.size * (0.5 + alpha * 0.5);
        ctx.beginPath(); ctx.moveTo(0, -isz); ctx.lineTo(isz * 0.5, 0); ctx.lineTo(0, isz); ctx.lineTo(-isz * 0.5, 0); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.restore();
        ctx.globalAlpha = 1;
      } else if (p.type === 'dust') {
        // 落脚扬尘：软圆、快速淡出，画在地面层之上
        ctx.globalAlpha = alpha * 0.62;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(sx, sy, p.size * (1.5 - alpha * 0.5), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      } else if (p.type === 'flame') {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const fs = p.size * (0.6 + alpha * 0.7);
        const fg = ctx.createRadialGradient(sx, sy, 0, sx, sy, fs);
        fg.addColorStop(0, '#fff2b0');
        fg.addColorStop(0.45, p.color);
        fg.addColorStop(1, 'rgba(255,90,20,0)');
        ctx.fillStyle = fg; ctx.globalAlpha = alpha;
        ctx.beginPath(); ctx.arc(sx, sy, fs, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.globalAlpha = 1;
      } else if (p.type === 'chain') {
        if (p.points && p.points.length > 1) {
          const trace = (width, color, a) => {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.strokeStyle = color; ctx.globalAlpha = a; ctx.lineWidth = width;
            ctx.lineJoin = 'round'; ctx.lineCap = 'round';
            ctx.beginPath();
            p.points.forEach((pt, i) => { const px = pt.x - cam.x, py = pt.y - cam.y; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
            ctx.stroke();
            ctx.restore();
          };
          trace(8, 'rgba(90,200,255,.55)', alpha * 0.5);
          trace(3.4, '#7fe9ff', alpha * 0.9);
          trace(1.5, '#ffffff', alpha);
          ctx.globalAlpha = 1;
        }
      } else if (p.type === 'weaponRing') {
        ctx.beginPath(); ctx.arc(sx, sy, p.size * (1.25 - alpha * .25), 0, Math.PI * 2);
        ctx.strokeStyle = p.color; ctx.globalAlpha = alpha * .65; ctx.lineWidth = 2; ctx.stroke(); ctx.globalAlpha = 1;
      } else if (p.type === 'vine') {
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(p.angle); ctx.strokeStyle = p.color; ctx.globalAlpha = alpha;
        ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(0, 0);
        for (let i = 1; i <= 5; i++) ctx.quadraticCurveTo(p.size * i / 5 - 12, Math.sin(i * 2.4) * 11, p.size * i / 5, 0);
        ctx.stroke(); ctx.fillStyle = '#a5e675';
        for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.ellipse(p.size * i / 5, Math.sin(i * 2.4) * 7, 7, 3, i % 2 ? .6 : -.6, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore(); ctx.globalAlpha = 1;
      } else if (p.type === 'earthTrail') {
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(p.angle); ctx.globalAlpha = alpha * .7;
        ctx.fillStyle = '#765c3d'; ctx.beginPath(); ctx.ellipse(0, 0, p.size * 1.8, p.size * .55, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = p.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-p.size, 0); ctx.lineTo(p.size, -4); ctx.stroke(); ctx.restore(); ctx.globalAlpha = 1;
      } else if (p.type === 'smoke') {
        ctx.beginPath(); ctx.arc(sx, sy, p.size * (1.35 - alpha * .35), 0, Math.PI * 2);
        ctx.fillStyle = p.color; ctx.globalAlpha = alpha * .32; ctx.fill(); ctx.globalAlpha = 1;
      } else {
        ctx.beginPath();
        ctx.arc(sx, sy, p.size * alpha, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = alpha;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    });

    // v5.8.3：v2.6 血雾贴图粒子（fxParticles/hit_blood.png）已由程序化 spawnBloodMist 替代，贴图渲染块移除
  },
  renderDamageNumbers(ctx, cam) {
    // 上限 40：超出丢弃最旧，避免怪群刷屏
    if (this.damageNumbers.length > 40) this.damageNumbers.splice(0, this.damageNumbers.length - 40);
    // 伤害跳字：P0-2 两段式（前 40% 上浮加速+放大 / 后 60% 减速淡出），旧数字保持线性渐隐。
    this.damageNumbers.forEach(number => {
      const sx = number.x - cam.x, sy = number.y - cam.y;
      const prof = (number.twoPhase && typeof CombatDirector !== 'undefined')
        ? CombatDirector.dmgNumProfile(1 - number.life / number.maxLife)
        : null;
      const alpha = prof ? prof.alpha : clamp(number.life / number.maxLife, 0, 1);
      const isHeal = number.heal || (typeof number.value === 'string' && number.value.indexOf('+') >= 0);
      const crit = !!number.crit && !isHeal;
      // 分级：普通 14px 白 / 暴击 18px 金 / 治疗 14px 绿
      const baseSize = crit ? 18 : 14;
      const color = isHeal ? '#7fd96a' : (crit ? '#ffd166' : '#ffffff');
      const scale = (prof ? prof.scale : (crit ? 1 + (1 - alpha) * 0.15 : 1)) * (crit ? 1.12 : 1);
      const label = (crit ? '✧ ' : '') + (typeof number.value === 'number' ? `-${number.value}` : number.value);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(sx, sy);
      ctx.scale(scale, scale);
      ctx.font = `bold ${baseSize}px sans-serif`;
      ctx.textAlign = 'center'; ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(18,12,12,.85)';
      ctx.strokeText(label, 0, 0);
      ctx.fillStyle = color;
      ctx.fillText(label, 0, 0);
      if (crit) { ctx.strokeStyle = 'rgba(255,240,180,.6)'; ctx.lineWidth = 1.5; ctx.strokeText(label, 0, 0); }
      ctx.restore();
    });
    (this.combatFeedback || []).forEach(f => {
      const sx = f.x - cam.x, sy = f.y - cam.y, a = clamp(f.life / f.maxLife, 0, 1);
      ctx.save(); ctx.globalAlpha = a; ctx.textAlign = 'center'; ctx.font = 'bold 13px sans-serif';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(10,12,18,.9)'; ctx.strokeText(f.text, sx, sy); ctx.fillStyle = f.color; ctx.fillText(f.text, sx, sy); ctx.restore();
    });
  },
  renderScreenFlashes(ctx) {
    if (false) { // 击杀白闪已移除：避免击杀瞬间"闪一下屏幕"
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = clamp(this.killFlash * 4.2, 0, .42);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, CONFIG.canvas.width, CONFIG.canvas.height);
      ctx.restore();
    }

    // 玩家受击红屏：边缘红色渐晕
    if (this.playerDamageFlash > 0) {
      const da = clamp(this.playerDamageFlash, 0, 1) * 0.5;
      const vg = ctx.createRadialGradient(CONFIG.canvas.width / 2, CONFIG.canvas.height / 2, CONFIG.canvas.height * 0.32, CONFIG.canvas.width / 2, CONFIG.canvas.height / 2, CONFIG.canvas.height * 0.75);
      vg.addColorStop(0, 'rgba(255,40,30,0)');
      vg.addColorStop(1, `rgba(255,45,35,${da})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, CONFIG.canvas.width, CONFIG.canvas.height);
    }
    // 暴击金色闪屏
    if (this.critFlash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(this.critFlash * 3.4, 0, 0.16);
      ctx.fillStyle = '#ffe9a0';
      ctx.fillRect(0, 0, CONFIG.canvas.width, CONFIG.canvas.height);
      ctx.restore();
    }
  },
  renderFogAndCombatHUD(ctx, uictx, cam) {
    // 战争迷雾（世界层）：未探索全遮 / 已探索半遮 / 当前视野透明（噪声侵蚀边缘）。
    this.renderFogOfWar(ctx);
    // 战斗 HUD（UI 层）：连击/怒气/可破坏物——与旧顺序语义一致（画在雾之后，不被雾罩）
    if (typeof CombatEnhancement !== 'undefined') {
      CombatEnhancement.renderDestructibles(uictx, cam);
      CombatEnhancement.renderHUD(uictx, cam);
    }
  },
  renderExtractBar(ctx) {
    // 撤离读条UI
    if (this.extracting) {
      const extractTime = this.extractType === 'signal' ? CONFIG.expedition.signalExtractTime : CONFIG.expedition.extractTime;
      const pct = this.extractProgress / extractTime;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(CONFIG.canvas.width / 2 - 150, 100, 300, 50);
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 2;
      ctx.strokeRect(CONFIG.canvas.width / 2 - 150, 100, 300, 50);
      ctx.fillStyle = '#ffd700';
      ctx.fillRect(CONFIG.canvas.width / 2 - 148, 120, 296 * pct, 28);
      ctx.fillStyle = '#fff';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.extractType === 'signal' ? '🔥 信号弹撤离中...' : '🚁 撤离读条中...', CONFIG.canvas.width / 2, 118);
      ctx.font = '14px sans-serif';
      ctx.fillText(`${(extractTime - this.extractProgress).toFixed(1)}秒`, CONFIG.canvas.width / 2, 142);
    }
  },
  updateWorldSystems(dt) {
    this.elapsed += dt;
    this.updateTerrainJourney(dt);
    // v4.1 固定节奏兽潮：倒计时始终走，当前波没清完下一波照样刷（波次叠加、强度滚大）
    const aliveByWave = {};
    for (let i = 0; i < this.monsters.length; i++) {
      const mm = this.monsters[i];
      if (mm.beastWave && mm.hp > 0 && mm.waveNo) aliveByWave[mm.waveNo] = (aliveByWave[mm.waveNo] || 0) + 1;
    }
    let waveMonsterCount = 0;
    for (const wk in aliveByWave) waveMonsterCount += aliveByWave[wk];
    // N1 滴流化：剩余数 = 场上存活 + 待刷出（HUD「剩余 X 只」含未入场份额）
    const _pend = this.beastWave._pending || {};
    let pendingTotal = 0;
    for (const pk in _pend) pendingTotal += _pend[pk] || 0;
    this.beastWave.remaining = waveMonsterCount + pendingTotal;
    // active：有存活怪或当前波流组未刷完（波开始瞬间即 active，HUD 不回退到预警态）
    this.beastWave.active = waveMonsterCount > 0 || pendingTotal > 0;
    // 每波各自清完各发一次奖励（允许晚于下一波刷出才清完）
    // N1 守卫：必须该波全部刷完（_pending 归零）且清完才发——滴流期间不会误发
    for (let wn = 1; wn <= this.beastWave.wave; wn++) {
      if (!this.beastWave.rewarded[wn] && !aliveByWave[wn] && !(_pend[wn] > 0)) {
        this.beastWave.rewarded[wn] = true;
        GameState.gold += 20 * wn * this.map.tier;
        showToast(`第 ${wn} 波兽潮已击退，获得守塔奖励`, 'success');
      }
    }
    this.beastWave.nextIn -= dt;
    // P0-1/G6 战斗手感导演：兽潮临期预警（T-20s 横幅 / T-5s vignette）+ 终局猎手入场
    if (typeof CombatDirector !== 'undefined') CombatDirector.tick(this, dt);
    if (this.beastWave.nextIn <= 0) this.spawnBeastWave();
    // N1 滴流驱动：流组按 interval 持续压出（下一波触发时旧流组已在 spawnBeastWave 内收尾）
    this.updateBeastStreams(dt);
    // N3 常驻资源怪：每 10s/33% roll 荒野古树
    this.updateResourceTrees(dt);
    // v5.8.11 危险事件随风险期提前：360→120s 起调度（首事件 140s，配合 Boss 提前觉醒）
    if (this.elapsed >= 120 && this.elapsed >= this.nextEventAt && !this.activeEvent) {
      this.startMapEvent();
      this.nextEventAt += 90 + rand(0, 35);
    }
    if (this.activeEvent) {
      this.activeEvent.timeLeft -= dt;
      if (this.activeEvent.id === 'spirit_rain') {
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + dt * 1.25);
        this.player.energy = Math.min(this.player.maxEnergy, this.player.energy + dt * 2);
      }
      if (this.activeEvent.timeLeft <= 0) {
        this.activeEvent = null;
        this.eventModifiers = { enemySpeed:1, enemyDamage:1, loot:1, vision:1 };
      }
    }
    this.updateMission();

    this.monsters.forEach(monster => {
      monster.abilityCd = Math.max(0, (monster.abilityCd || 0) - dt);
      const d = dist(monster, this.player);
      if (!this.terrainCanDetect(monster, d) || monster.stunned > 0) return;
      const angle = Math.atan2(this.player.y - monster.y, this.player.x - monster.x);
      if (monster.type === 'locust' && d < 115) {
        monster.x -= Math.cos(angle) * monster.speed * .42 * dt;
        monster.y -= Math.sin(angle) * monster.speed * .42 * dt;
      } else if (monster.type === 'wolf' && d > 85) {
        monster.facing = angle + (monster.packOffset || 1) * .42;
      } else if (monster.type === 'boar' && monster.abilityCd <= 0 && d > 120 && d < 275) {
        monster.abilityCd = 5.5;
        monster.x += Math.cos(angle) * 64;
        monster.y += Math.sin(angle) * 64;
        this.spawnAoeEffect(monster.x, monster.y, 42, '#e9a15e');
      } else if (monster.type === 'boss') {
        monster.phase = monster.hp / monster.maxHp < .5 ? 2 : 1;
        // v5.1 Boss 技能由 V5.tickBoss 差异化状态机驱动（12 只 Boss 独立技能组）
      }
    });
  },

  renderWeather(ctx) {
    const tier = this.map.tier;
    const t = performance.now() / 1000;
    ctx.save();
    // v5.7：统一连续天气（世界空间雨/雾/闪电/雪/调色），替代旧的农场天气屏幕绘制
    if (window.WeatherFX) WeatherFX.renderWorld(ctx, this, this.camera);
    if (tier === 1) {
      for (let i = 0; i < 26; i++) {
        const x = (i * 83 + t * (9 + i % 4)) % CONFIG.canvas.width;
        const y = (i * 137 + Math.sin(t + i) * 35 + 720) % CONFIG.canvas.height;
        ctx.globalAlpha = 0.18 + (Math.sin(t * 2 + i) + 1) * 0.12;
        ctx.fillStyle = '#d8ff8a';
        ctx.beginPath(); ctx.arc(x, y, 1.7, 0, Math.PI * 2); ctx.fill();
      }
    } else if (tier === 2) {
      ctx.strokeStyle = '#d5b67a';
      ctx.lineWidth = 2;
      for (let i = 0; i < 32; i++) {
        const x = (i * 71 + t * 90) % (CONFIG.canvas.width + 120) - 60;
        const y = (i * 109 + t * 18) % CONFIG.canvas.height;
        ctx.globalAlpha = 0.12 + (i % 3) * 0.04;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 28, y + 5); ctx.stroke();
      }
    } else if (tier === 3) {
      for (let i = 0; i < 12; i++) {
        const x = (i * 131 + Math.sin(t * .3 + i) * 90 + 1280) % 1280;
        const y = (i * 79 + t * 13) % 760 - 40;
        const radius = 55 + (i % 4) * 24;
        const fog = ctx.createRadialGradient(x, y, 0, x, y, radius);
        fog.addColorStop(0, 'rgba(116,173,74,.1)'); fog.addColorStop(1, 'rgba(70,105,50,0)');
        ctx.fillStyle = fog; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      }
    } else {
      ctx.strokeStyle = '#b9a2ff';
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 38; i++) {
        const x = (i * 97 + t * 44) % CONFIG.canvas.width;
        const y = (i * 61 + t * 145) % (CONFIG.canvas.height + 60) - 30;
        ctx.globalAlpha = 0.12 + (i % 5) * 0.025;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 9, y + 24); ctx.stroke();
      }
    }
    ctx.restore();
  },

  // v3.7 昼夜光照循环 · v1.4 GPU 分级重制
  // 周期 180s：day(0-60) -> dusk(60-90) -> night(90-150) -> dawn(150-180)
  // 分级三路同步：世界画布 CSS filter（GPU 合成：饱和/对比/亮度）+ 地形层 ColorMatrixFilter
  //（GPU 着色器）+ 本层冷色投影（蓝调）与黑暗洞/火把辉光。
  // 黑暗洞：恒定剖面渐变对象缓存 + CTM 平移（零每帧渐变重建，剖面与旧实现逐点等价）。
  _dnSprites(ctx) {
    if (!this._dnTorch) {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const g = c.getContext('2d');
      const rg = g.createRadialGradient(128, 128, 6, 128, 128, 128);
      rg.addColorStop(0, 'rgba(255,182,96,.55)');
      rg.addColorStop(.45, 'rgba(255,150,62,.22)');
      rg.addColorStop(1, 'rgba(255,120,40,0)');
      g.fillStyle = rg; g.fillRect(0, 0, 256, 256);
      this._dnTorch = c;
    }
    // 黑暗洞渐变（以玩家为原点建模；R 变化才重建；globalAlpha 承担夜幕强度）
    const R = this._dnCurR || 0;
    if (!this._dnGrad || this._dnGradR !== R) {
      const rg = ctx.createRadialGradient(0, 0, R * .3, 0, 0, R);
      rg.addColorStop(0, 'rgba(0,0,0,0)');
      rg.addColorStop(.7, 'rgba(0,0,0,.6)');
      rg.addColorStop(1, 'rgba(0,0,0,1)');
      this._dnGrad = rg; this._dnGradR = R;
    }
  },
  renderDayNight(ctx) {
    const t = this.elapsed < 360 ? 0 : (this.elapsed - 300) % 180;
    let phase, overlayAlpha, tint, nightK = 0, duskK = 0;
    if (t < 60) {
      phase = 'day'; overlayAlpha = 0; tint = null;
    } else if (t < 90) {
      const k = (t - 60) / 30; // 0..1
      phase = 'dusk'; overlayAlpha = 0.35 * k; duskK = k;
      tint = { r: 255, g: 140, b: 60, a: 0.12 * k };
    } else if (t < 150) {
      const k = (t - 90) / 60;
      phase = 'night'; overlayAlpha = 0.55; nightK = k;
      tint = { r: 20, g: 30, b: 70, a: 0.26 };
    } else {
      const k = (t - 150) / 30;
      phase = 'dawn'; overlayAlpha = 0.55 * (1 - k); nightK = 1 - k;
      tint = { r: 20, g: 30, b: 70, a: 0.26 * (1 - k) };
    }
    // 昼夜相切换 → 迷雾重烘焙（夜雾更浓）
    if (this._dnLastPhase !== phase) { this._dnLastPhase = phase; this.fogDirty = true; }
    this.dayNightPhase = phase;
    this.nightVisionRadius = (t >= 90 && t < 150) ? 180 : 0; // 夜晚视野半径

    // ---- GPU 分级同步（有变化才写，避免每帧字符串/矩阵上传）----
    const sat = 1.06 - .42 * nightK - .08 * duskK;
    const con = 1.04 + .03 * nightK + .05 * duskK;
    const bri = 1 - .27 * nightK - .05 * duskK;
    let css = `saturate(${sat.toFixed(3)}) contrast(${con.toFixed(3)}) brightness(${bri.toFixed(3)})`;
    if (duskK > .01) css += ` sepia(${(0.15 * duskK).toFixed(3)})`;
    if (this._cssGrade !== css) {
      this._cssGrade = css;
      ctx.canvas.style.filter = css;         // 世界层 GPU 合成分级（雾/实体/粒子一并生效）
    }
    if (window.PixiTerrain && PixiTerrain.ready) PixiTerrain.setGrade(nightK, duskK);  // 地形层 GPU 着色器分级

    // 冷色投影（色彩层——亮度工作已交给 CSS/矩阵，这里只留色调）
    if (tint && tint.a > 0.01) {
      ctx.fillStyle = `rgba(${tint.r|0},${tint.g|0},${tint.b|0},${tint.a})`;
      ctx.fillRect(0, 0, CONFIG.canvas.width, CONFIG.canvas.height);
    }

    // 黑暗洞 + 火把暖光
    if (overlayAlpha > 0.01) {
      const dz = this.camera.zoom || 1;   // v1.8 屏幕空间绘制：世界偏移/半径乘 zoom
      const px = (this.player.x - this.camera.x) * dz;
      const py = (this.player.y - this.camera.y) * dz;
      // 火把照明半径：有火把道具更大
      const torchBonus = (this.player.torchTime && this.player.torchTime > 0) ? 80 : 0;
      const R = (this.nightVisionRadius + torchBonus) * dz;
      this._dnCurR = R;
      this._dnSprites(ctx);
      ctx.save();
      // 夜幕：恒定剖面渐变 + CTM 平移到玩家（外接圆之外自动延伸为全暗——与旧实现等价）
      ctx.translate(px, py);
      ctx.globalAlpha = overlayAlpha;
      ctx.fillStyle = this._dnGrad;
      ctx.fillRect(-px, -py, CONFIG.canvas.width, CONFIG.canvas.height);
      // 火把暖辉：加色混合 + 双频闪烁（火焰呼吸感）
      const flick = (Math.sin(this.elapsed * 13) + Math.sin(this.elapsed * 7.3)) * .5;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = overlayAlpha * (.5 + flick * .12);
      const TR = R * 2.2 + flick * 10;
      ctx.drawImage(this._dnTorch, -TR, -TR, TR * 2, TR * 2);
      ctx.restore();
    }

    // 白天/夜晚 HUD 提示
    if (phase === 'day' && t > 55) {
      ctx.fillStyle = '#ffd700';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('☀️ 白天即将结束…', CONFIG.canvas.width / 2, 28);
    } else if (phase === 'night' && Math.floor(this.elapsed) % 2 === 0) {
      ctx.fillStyle = '#aaccff';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🌙 夜晚：视野缩小，小心黑暗中的怪物', CONFIG.canvas.width / 2, 28);
    }
  },

  // v3.7 远景雾 + 地平线剪影
  renderHorizonSilhouettes(ctx) {
    const W = CONFIG.canvas.width, H = CONFIG.canvas.height;
    // 远景雾（屏幕边缘渐暗，营造深度）
    const fog = ctx.createRadialGradient(W/2, H/2, Math.min(W,H)*0.45, W/2, H/2, Math.max(W,H)*0.75);
    fog.addColorStop(0, 'rgba(0,0,0,0)');
    fog.addColorStop(1, 'rgba(10,15,20,0.35)');
    ctx.fillStyle = fog;
    ctx.fillRect(0, 0, W, H);

    // v3.9 三层视差远景：远山（蓝灰空气透视，0.15x）+ 中景树林团（0.4x）
    const nightSky = this.dayNightPhase === 'night';
    const drawRidge = (parallax, baseY, amp, color, step) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-step, baseY + 80);
      const off = this.camera.x * parallax;
      for (let x = -step; x <= W + step; x += step) {
        const wx = x + off;
        const y = baseY
          - (Math.sin(wx * 0.0042) * 0.5 + 0.5) * amp
          - (Math.sin(wx * 0.011 + 1.7) * 0.5 + 0.5) * amp * 0.55;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W + step, baseY + 80);
      ctx.closePath();
      ctx.fill();
    };
    drawRidge(0.15, 104, 42, nightSky ? 'rgba(28,36,56,0.6)' : 'rgba(74,90,108,0.5)', 22);
    drawRidge(0.24, 116, 30, nightSky ? 'rgba(22,30,40,0.55)' : 'rgba(56,70,80,0.45)', 20);
    // 中景：团状远树剪影（替代三角山）
    ctx.fillStyle = nightSky ? 'rgba(16,24,22,0.62)' : 'rgba(42,56,46,0.5)';
    const treeOff = this.camera.x * 0.4;
    for (let i = -1; i < W / 64 + 2; i++) {
      const wx = i * 64 - (((treeOff % 64) + 64) % 64);
      const h = 18 + ((Math.abs(Math.floor((i * 64 + treeOff) * 7.91)) % 40));
      ctx.beginPath();
      ctx.arc(wx + 32, 108 - h * 0.35, 22 + (h % 12), 0, Math.PI * 2);
      ctx.arc(wx + 10, 112 - h * 0.28, 17, 0, Math.PI * 2);
      ctx.arc(wx + 56, 112 - h * 0.32, 19, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  },

  renderMinimap() {
    const mm = document.getElementById('minimapCanvas');
    const mctx = mm.getContext('2d');
    const size = CONFIG.expedition.mapSize;
    const scale = 160 / size;

    // v3.7 战争迷雾：记录已探索格子（32px 一格）
    if (!this.exploredSet) this.exploredSet = new Set();
    const TILE = 64;
    const viewR = this.visionRadius * this.getTerrainAt(this.player.x,this.player.y).visionMul; // 视野半径（世界坐标）
    const px = this.player.x, py = this.player.y;
    for (let dy = -viewR; dy <= viewR; dy += TILE) {
      for (let dx = -viewR; dx <= viewR; dx += TILE) {
        if (dx*dx + dy*dy > viewR*viewR) continue;
        const tx = Math.floor((px + dx) / TILE);
        const ty = Math.floor((py + dy) / TILE);
        this.exploredSet.add(tx + ',' + ty);
      }
    }

    mctx.fillStyle = 'rgba(0,0,0,0.9)';
    mctx.fillRect(0, 0, 160, 160);

    // 地形斑块（只画已探索的）
    const terrainColors={water:'#397c87',mud:'#715c42',forest:'#294b32',ruins:'#696a53',highland:'#99ab70',grass:'#405638'};
    for(const key of this.exploredSet) {
      const [tx,ty]=key.split(',').map(Number);
      mctx.fillStyle=terrainColors[this.getTerrainAt((tx+.5)*TILE,(ty+.5)*TILE).id];
      mctx.fillRect(tx*TILE*scale,ty*TILE*scale,TILE*scale+1,TILE*scale+1);
    }
    this.terrainPatches.forEach(patch => {
      const key = Math.floor(patch.x / TILE) + ',' + Math.floor(patch.y / TILE);
      if (!this.exploredSet.has(key)) return;
      mctx.globalAlpha = patch.type === 'water' ? 0.7 : 0.18;
      mctx.fillStyle = patch.color;
      mctx.beginPath();
      mctx.ellipse(patch.x * scale, patch.y * scale, Math.max(1, patch.rx * scale), Math.max(1, patch.ry * scale), patch.rotation, 0, Math.PI * 2);
      mctx.fill();
    });
    // 道路（已探索才画）
    mctx.globalAlpha = 0.35;
    mctx.strokeStyle = this.map.terrain.path;
    mctx.lineWidth = 2;
    this.terrainRoads.forEach(road => {
      const k1 = Math.floor(road.x1 / TILE) + ',' + Math.floor(road.y1 / TILE);
      const k2 = Math.floor(road.x2 / TILE) + ',' + Math.floor(road.y2 / TILE);
      if (!this.exploredSet.has(k1) && !this.exploredSet.has(k2)) return;
      mctx.beginPath();
      mctx.moveTo(road.x1 * scale, road.y1 * scale);
      mctx.lineTo(road.x2 * scale, road.y2 * scale);
      mctx.stroke();
    });
    mctx.globalAlpha = 1;

    // 撤离点（已探索才显示）
    this.extractPoints.forEach(ep => {
      const k = Math.floor(ep.x / TILE) + ',' + Math.floor(ep.y / TILE);
      if (!this.exploredSet.has(k)) return;
      mctx.fillStyle = '#7fff7f';
      mctx.beginPath();
      mctx.arc(ep.x * scale, ep.y * scale, 4, 0, Math.PI * 2);
      mctx.fill();
    });
    // 宝箱（已探索过记住）
    this.chests.forEach(c => {
      if (c.opened) return;
      const k = Math.floor(c.x / TILE) + ',' + Math.floor(c.y / TILE);
      if (!this.exploredSet.has(k)) return;
      mctx.fillStyle = '#ffd700';
      mctx.fillRect(c.x * scale - 2, c.y * scale - 2, 4, 4);
    });
    // v1.9 游侠信号（青色脉冲点）+ 已并肩盟友（青绿实心点）
    if (this.allySignal) {
      const pulse = 2.5 + 1.5 * Math.sin(this.elapsed * 5);
      mctx.fillStyle = '#7fd8c0';
      mctx.beginPath(); mctx.arc(this.allySignal.x * scale, this.allySignal.y * scale, pulse, 0, Math.PI * 2); mctx.fill();
    }
    (this.allies || []).forEach(a => {
      if (a.hp <= 0) return;
      mctx.fillStyle = '#8fe8cc';
      mctx.beginPath(); mctx.arc(a.x * scale, a.y * scale, 3, 0, Math.PI * 2); mctx.fill();
    });
    // 怪物（只显示玩家附近 200px 内的）
    this.monsters.forEach(m => {
      const d = Math.hypot(m.x - px, m.y - py);
      if (d > 200) return;
      mctx.fillStyle = '#ff4444';
      mctx.fillRect(m.x * scale - 1, m.y * scale - 1, 3, 3);
    });
    // 掠夺者
    this.raiders.forEach(r => {
      const d = Math.hypot(r.x - px, r.y - py);
      if (d > 250) return;
      mctx.fillStyle = '#ff8800';
      mctx.fillRect(r.x * scale - 2, r.y * scale - 2, 4, 4);
    });
    // 防御塔（已探索才显示）
    this.towers.forEach(t => {
      const k = Math.floor(t.x / TILE) + ',' + Math.floor(t.y / TILE);
      if (!this.exploredSet.has(k)) return;
      mctx.fillStyle = t.state === 'player' ? '#7fff7f' : t.state === 'enemy' ? '#ff4444' : '#666';
      mctx.fillRect(t.x * scale - 2, t.y * scale - 2, 4, 4);
    });
    // 地面战利品（附近才显示）
    this.groundLoot.forEach(item => {
      const d = Math.hypot(item.x - px, item.y - py);
      if (d > 180) return;
      mctx.globalAlpha = 1;
      mctx.fillStyle = '#f6c75b';
      mctx.beginPath();
      mctx.arc(item.x * scale, item.y * scale, 2.2, 0, Math.PI * 2);
      mctx.fill();
    });
    mctx.globalAlpha = 1;
    // 玩家
    mctx.fillStyle = '#4488ff';
    mctx.beginPath();
    mctx.arc(this.player.x * scale, this.player.y * scale, 4, 0, Math.PI * 2);
    mctx.fill();
    if (this.extracting && this.extractType === 'signal') {
      mctx.strokeStyle = '#ff4d3f';
      mctx.lineWidth = 2;
      mctx.globalAlpha = 0.45 + Math.sin(performance.now() / 130) * 0.3;
      mctx.beginPath();
      mctx.arc(this.player.x * scale, this.player.y * scale, 8, 0, Math.PI * 2);
      mctx.stroke();
      mctx.globalAlpha = 1;
    }
    // 视野框（v1.8 拉远后可见世界 = 画布/zoom）
    mctx.strokeStyle = 'rgba(255,255,255,0.3)';
    const vz = this.camera.zoom || 1;
    mctx.strokeRect(this.camera.x * scale, this.camera.y * scale,
      CONFIG.canvas.width / vz * scale, CONFIG.canvas.height / vz * scale);
  },

  // v1.5 屏外目标方位罗盘：当前目标/撤离点/商人在屏外时，屏幕边缘箭头 + 距离。
  // 方向感是新手第一痛点（走查：落地视野空旷，目标 0/5 却不知道怪在哪）。
  // 规则：每类只指最近一个；屏内目标不画（不遮挡战斗）；死亡序列中不画。
  renderOffscreenCompass(ctx, cam) {
    if (this._deathSeq || this.extracting) return;
    const W = CONFIG.canvas.width, H = CONFIG.canvas.height;
    const M = 34;                                   // 边缘内缩
    const cx = W / 2, cy = H / 2;
    const onScreen = (x, y) => { const cz = cam.zoom || 1; const sx = (x - cam.x) * cz, sy = (y - cam.y) * cz; return sx > 30 && sx < W - 30 && sy > 30 && sy < H - 30; };
    const pick = (list, filt) => {
      let best = null, bd = 1e9;
      for (const o of list) { if (!filt(o)) continue; const d = Math.hypot(o.x - this.player.x, o.y - this.player.y); if (d < bd) { bd = d; best = o; } }
      return best ? { o: best, d: bd } : null;
    };
    const marks = [];
    const obj = this.objective;
    if (obj && obj.progress < obj.target) {
      if (obj.type === 'hunt') { const t = pick(this.monsters || [], m => m.hp > 0 && m.state !== 'death'); if (t) marks.push({ ...t, color: '#ff7a66', label: '野怪' }); }
      else if (obj.type === 'scavenge') { const t = pick(this.chests || [], c => !c.opened); if (t) marks.push({ ...t, color: '#ffd700', label: '宝箱' }); }
      else if (obj.type === 'tower') { const t = pick(this.towers || [], tw => tw.state !== 'player' && tw.state !== 'broken'); if (t) marks.push({ ...t, color: '#5ad0ff', label: '防御塔' }); }
    }
    const ep = (this.extractPoints || [])[0];
    if (ep) marks.push({ o: ep, d: Math.hypot(ep.x - this.player.x, ep.y - this.player.y), color: '#7fff7f', label: '撤离' });
    if (this.merchant && !this.merchant.used) { const d = Math.hypot(this.merchant.x - this.player.x, this.merchant.y - this.player.y); marks.push({ o: this.merchant, d, color: '#7fb8ff', label: '商人' }); }
    // v1.9 游侠信号（屏外方位罗盘指向，青色）
    if (this.allySignal) { const d = Math.hypot(this.allySignal.x - this.player.x, this.allySignal.y - this.player.y); marks.push({ o: this.allySignal, d, color: '#7fd8c0', label: '游侠' }); }

    ctx.save();
    ctx.textAlign = 'center';
    for (const mk of marks) {
      if (onScreen(mk.o.x, mk.o.y)) continue;
      const ang = Math.atan2(mk.o.y - this.player.y, mk.o.x - this.player.x);
      // 从屏心沿方向射线到内缩矩形边缘
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const sx0 = mk.o.x - cam.x - cx, sy0 = mk.o.y - cam.y - cy;
      const scale = Math.min((W / 2 - M) / Math.abs(dx || 1e-6), (H / 2 - M) / Math.abs(dy || 1e-6));
      const ax = cx + sx0 * 0 + dx * scale, ay = cy + dy * scale;   // 从屏心投影到边缘
      const pulse = 0.75 + 0.25 * Math.sin(this.elapsed * 4);
      ctx.globalAlpha = 0.9 * pulse;
      // 箭头（指向目标）
      ctx.save();
      ctx.translate(ax, ay); ctx.rotate(ang);
      ctx.fillStyle = mk.color;
      ctx.strokeStyle = 'rgba(10,14,18,.8)'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(11, 0); ctx.lineTo(-7, -7.5); ctx.lineTo(-3, 0); ctx.lineTo(-7, 7.5);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
      // 标签 + 距离
      ctx.globalAlpha = 0.85;
      ctx.font = 'bold 11px sans-serif';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(10,14,18,.85)';
      const lx = ax - dx * 26, ly = ay - dy * 26;
      const label = `${mk.label} ${Math.round(mk.d)}m`;
      ctx.strokeText(label, lx, ly + 4);
      ctx.fillStyle = mk.color;
      ctx.fillText(label, lx, ly + 4);
    }
    ctx.restore();
  },

  // v1.5 落地引导 toast：开局 7 秒，一句话讲清「做什么 + 怎么走」。
  renderIntroToast(ctx) {
    if (this.elapsed > 7 || this._deathSeq) return;
    const W = CONFIG.canvas.width, H = CONFIG.canvas.height;
    const fadeIn = clamp(this.elapsed / 0.5, 0, 1);
    const fadeOut = clamp((7 - this.elapsed) / 1, 0, 1);
    const a = Math.min(fadeIn, fadeOut);
    const obj = this.objective;
    const line1 = obj ? `当前目标：${obj.title} · ${obj.description}` : '';
    const line2 = '找到绿色 🚁 撤离圈点击撤离 · 信号弹可应急撤离';
    ctx.save();
    ctx.globalAlpha = a * 0.92;
    ctx.textAlign = 'center';
    const y = H - 108;
    const w = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width) + 44;
    ctx.fillStyle = 'rgba(10,16,20,.82)';
    ctx.strokeStyle = 'rgba(127,255,127,.35)'; ctx.lineWidth = 1;
    ctx.beginPath();
    const rx = W / 2 - w / 2, ry = y - 34, rw = w, rh = 52, r = 10;
    ctx.moveTo(rx + r, ry); ctx.arcTo(rx + rw, ry, rx + rw, ry + rh, r); ctx.arcTo(rx + rw, ry + rh, rx, ry + rh, r);
    ctx.arcTo(rx, ry + rh, rx, ry, r); ctx.arcTo(rx, ry, rx + rw, ry, r); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.font = 'bold 13px sans-serif'; ctx.fillStyle = '#c9f5d2';
    ctx.fillText(line1, W / 2, y - 13);
    ctx.font = '12px sans-serif'; ctx.fillStyle = '#9fb8a8';
    ctx.fillText(line2, W / 2, y + 7);
    ctx.restore();
  },

  renderInteractPrompt(uictx) {
    const cam = this.camera;
    const c = uictx || ctx;   // v1.4 UI 层；回退旧全局 ctx
    // 检查附近可交互物
    let prompt = null;
    // v1.9 游侠接纳提示
    if (this.allySignal && dist(this.player, this.allySignal) < 80) {
      prompt = { x: this.allySignal.x, y: this.allySignal.y - 46, text: `左键接纳「${this.allySignal.def.name}」并肩作战` };
    }
    if (!prompt && this.campfire && this.isWorldVisible(this.campfire.x, this.campfire.y) && dist(this.player, this.campfire) < 60) {
      prompt = { x: this.campfire.x, y: this.campfire.y - 40, text: '左键篝火：升级/移除/休息' };
    }
    if (!prompt && this.merchant && this.isWorldVisible(this.merchant.x, this.merchant.y) && dist(this.player, this.merchant) < 60) {
      prompt = { x: this.merchant.x, y: this.merchant.y - 40, text: '左键交易：买/删/升级/补货' };
    }
    for (const chest of this.chests) {
        if (!chest.opened && this.isWorldVisible(chest.x, chest.y) && dist(this.player, chest) < 60) {
          prompt = { x: chest.x, y: chest.y - 40, text: '左键打开宝箱' };
          break;
        }
      }
    if (!prompt) {
      for (const tower of this.towers) {
        if (tower.state !== 'player' && this.isWorldVisible(tower.x, tower.y) && dist(this.player, tower) < 60) {
          prompt = { x: tower.x, y: tower.y - 40, text: tower.state === 'broken' ? '点击修复并占领防御塔' : '点击占领防御塔' };
          break;
        }
      }
    }
    if (!prompt) {
      for (const ep of this.extractPoints) {
        if (this.isWorldVisible(ep.x, ep.y) && dist(this.player, ep) < ep.radius) {
          prompt = { x: ep.x, y: ep.y - ep.radius - 20, text: '点击开始撤离' };
          break;
        }
      }
    }
    if (prompt) {
      const pz = cam.zoom || 1;   // v1.8 UI 层世界→屏幕乘 zoom
      const sx = (prompt.x - cam.x) * pz, sy = (prompt.y - cam.y) * pz;
      c.fillStyle = 'rgba(0,0,0,0.8)';
      c.strokeStyle = '#ffd700';
      c.lineWidth = 1;
      const w = c.measureText(prompt.text).width + 20;
      c.fillRect(sx - w / 2, sy - 14, w, 24);
      c.strokeRect(sx - w / 2, sy - 14, w, 24);
      c.fillStyle = '#ffd700';
      c.font = '13px sans-serif';
      c.textAlign = 'center';
      c.fillText(prompt.text, sx, sy + 3);
    }
  },

});






