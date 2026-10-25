/* 世界区域是地表绘制、移动、战斗与资源分布的共同来源。依赖 Expedition、CONFIG。 */

// 本地哈希/调色工具（与 expedition-terrain.js 的 terrainHash/shadeHex 同算法；本地副本避免脚本加载顺序耦合）
function regionHash(x, y, salt) {
  let h = (x * 374761393 + y * 668265263 + (salt || 0) * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

Object.assign(Expedition.prototype, {
  terrainRules: {
    // 地形 = 战斗修正层：moveMul 位移 / dmgOutMul 输出 / dmgInMul 承伤 / meleeOut·rangedOut 攻击类型
    // / critAdd 攻方暴击加成 / critTakenAdd 守方被暴击加成 / elementOut·elementIn 元素修正
    grass: {name:'草甸',moveMul:1,visionMul:1,rangeMul:1,dmgOutMul:1,dmgInMul:1,meleeOut:1,rangedOut:1,critAdd:0,critTakenAdd:0,
      hint:'基准地形：没有增减，靠走位和技能取胜'},
    water: {name:'浅水河湾',moveMul:.62,visionMul:1,rangeMul:1,dmgOutMul:1,dmgInMul:1,meleeOut:1,rangedOut:1,critAdd:0,critTakenAdd:0,
      elementOut:{fire:.70,lightning:1.35}, elementIn:{},
      statusOnEnter:{key:'wet',dur:2.5},
      hint:'移动 -38% · 潮湿：受雷 +15% / 受火 -10% · 灭火 · 冲刺距离 -50%'},
    mud: {name:'泥地',moveMul:.72,visionMul:1,rangeMul:1,dmgOutMul:1,dmgInMul:1,meleeOut:1,rangedOut:.95,critAdd:0,critTakenAdd:0,
      elementOut:{fire:.80},
      statusOnEnter:{key:'rooted',dur:1.0},
      hint:'移动 -28% · 陷足：禁止冲刺、击退 -30% · 火伤 -20%'},
    forest: {name:'密林草丛',moveMul:.94,visionMul:1,rangeMul:1,dmgOutMul:1,dmgInMul:1,meleeOut:1.10,rangedOut:.85,critAdd:0,critTakenAdd:0,
      statusOnEnter:null,
      hint:'近战 +10% / 远程 -15% · 发现距离 -45% · 停火 2 秒隐蔽 5 秒 · 火攻可点燃'},
    ruins: {name:'旧哨站废墟',moveMul:1,visionMul:1,rangeMul:1,dmgOutMul:1,dmgInMul:1,meleeOut:1,rangedOut:1,critAdd:0,critTakenAdd:0,
      statusOnEnter:null,
      hint:'残墙方向掩体：远程减伤 35% · AOE -15% · 掩体可被破坏'},
    highland: {name:'风望高地',moveMul:1,visionMul:1.25,rangeMul:1.15,dmgOutMul:1,dmgInMul:1,meleeOut:1,rangedOut:1.12,critAdd:.08,critTakenAdd:.10,
      statusOnEnter:null,
      hint:'视野 +25% · 射程 +15% · 远程 +12% · 暴击 +8% · 暴露：被远程命中 +10% · 高打低 +10%'}
  },
  regionContains(r,x,y) {
    const dx=(x-r.x)/r.rx, dy=(y-r.y)/r.ry, a=Math.atan2(dy,dx);
    const edge=1+.07*Math.sin(a*3+r.seed)+.04*Math.cos(a*5-r.seed);
    return dx*dx+dy*dy<=edge*edge;
  },
  getTerrainAt(x,y) {
    const r=(this.terrainRegions||[]).find(r=>this.regionContains(r,x,y));
    const id=r?.type||'grass';
    return {id,...this.terrainRules[id],region:r};
  },
  // v5.8.15 每张地图专属地形布局：以地图 id 派生种子，区域类型/位置/尺寸全部差异化。
  // 保证同图重玩一致（确定性），不同图布局截然不同；同时保持与旧版相同的区域数量与游戏性约束。
  mapSeedPRNG() {
    const id = (this.map && this.map.id) || 'default';
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
    let a = (h >>> 0) || 1;
    return function () { // mulberry32
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },
  // 每张地图的「地貌原型」：不同原型 = 不同生态组合/数量/尺寸/道路/植被密度。
  // 原型由地图 id 稳定派生（同图重玩一致），再叠加 tier 偏置，保证 24 张图明显不同。
  mapArchetypes: {
    delta:    { label: '三角洲', types: ['water', 'mud', 'forest', 'water', 'highland'], big: 'water',    count: [4, 6], road: 2, field: 2, tree: .7, rock: .6 },
    woodland: { label: '密林',   types: ['forest', 'forest', 'water', 'forest', 'mud'],   big: 'forest',   count: [5, 7], road: 0, field: 0, tree: 1.35, rock: .5 },
    badlands: { label: '荒原',   types: ['highland', 'ruins', 'mud', 'highland', 'ruins'], big: 'highland', count: [4, 6], road: 1, field: 1, tree: .35, rock: 1.5 },
    marsh:    { label: '沼泽',   types: ['water', 'mud', 'forest', 'water', 'mud'],        big: 'water',    count: [5, 7], road: 0, field: 2, tree: .9, rock: .4 },
    ruinfield:{ label: '废墟群', types: ['ruins', 'ruins', 'highland', 'forest', 'ruins'], big: 'ruins',    count: [4, 6], road: 2, field: 3, tree: .6, rock: 1.1 },
    terrace:  { label: '台地',   types: ['highland', 'highland', 'forest', 'water', 'highland'], big: 'highland', count: [4, 6], road: 1, field: 1, tree: .8, rock: 1.2 },
    mixed:    { label: '混合',   types: ['water', 'forest', 'ruins', 'highland', 'mud'],   big: null,       count: [5, 7], road: 1, field: 1, tree: 1, rock: 1 }
  },
  tierArchetypes: {
    1: ['delta', 'woodland', 'terrace', 'mixed'],
    2: ['woodland', 'ruinfield', 'terrace', 'delta', 'mixed'],
    3: ['marsh', 'badlands', 'ruinfield', 'terrace'],
    4: ['ruinfield', 'badlands', 'terrace', 'marsh']
  },
  generateTerrainRegions() {
    const s = CONFIG.expedition.mapSize;
    const rng = this.mapSeedPRNG();
    const tier = this.map.tier || 1;
    const id = (this.map && this.map.id) || 'default';
    // 稳定选择地貌原型：同图固定，不同图分散
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
    const pool = this.tierArchetypes[tier] || this.tierArchetypes[1];
    const arche = this.mapArchetypes[pool[(h >>> 0) % pool.length]] || this.mapArchetypes.mixed;
    this.mapArchetype = arche.label;

    this.terrainPatches = [];
    this.terrainFields = [];
    this.terrainRoads = [];
    this.terrainDecor = [];
    this.obstacles = [];
    this.terrainRegions = [];

    const margin = s * 0.12;
    const inside = (x, y) => x > margin && x < s - margin && y > margin && y < s - margin;

    // 1) 主地貌：每张图一个「大件」（大湖 / 大林 / 大废墟 / 大台地），方位随机
    const bigType = arche.big || arche.types[Math.floor(rng() * arche.types.length)];
    const bigAng = rng() * Math.PI * 2;
    const bigDist = s * (0.12 + rng() * 0.16);
    const bigX = Math.min(s - margin, Math.max(margin, s * 0.5 + Math.cos(bigAng) * bigDist));
    const bigY = Math.min(s - margin, Math.max(margin, s * 0.5 + Math.sin(bigAng) * bigDist));
    const bigR = s * (0.20 + rng() * 0.12);
    this.terrainRegions.push({
      type: bigType, x: bigX, y: bigY,
      rx: bigR * (0.9 + rng() * 0.5), ry: bigR * (0.55 + rng() * 0.35),
      seed: 1 + Math.floor(rng() * 97), main: true
    });

    // 2) 其余生态区：拒绝采样保证互不重叠、分布错开
    const want = arche.count[0] + Math.floor(rng() * (arche.count[1] - arche.count[0] + 1));
    for (let attempt = 0; attempt < 90 && this.terrainRegions.length < want; attempt++) {
      const type = arche.types[Math.floor(rng() * arche.types.length)];
      const x = s * (0.14 + rng() * 0.72);
      const y = s * (0.14 + rng() * 0.72);
      if (!inside(x, y)) continue;
      const base = s * (0.055 + rng() * 0.10);
      const elong = rng() < 0.35 ? 1.5 + rng() * 0.6 : 1;   // 部分拉长成河湾/林带
      const rot = rng() < 0.5;                                // 拉长方向
      const rx = base * (rot ? elong : 1), ry = base * (rot ? 1 : elong);
      const clash = this.terrainRegions.some(r =>
        Math.hypot(r.x - x, r.y - y) < (Math.max(r.rx, r.ry) + Math.max(rx, ry)) * 0.55);
      if (clash) continue;
      this.terrainRegions.push({ type, x, y, rx, ry, seed: 1 + Math.floor(rng() * 97) });
    }

    // tier 标志地物兜底：T1 必有林地、T3+ 必有泥沼、T4 必有废墟残迹
    const needType = tier >= 4 ? 'ruins' : tier >= 3 ? 'mud' : 'forest';
    if (!this.terrainRegions.some(r => r.type === needType)) {
      for (let k = 0; k < 30; k++) {
        const x = s * (0.18 + rng() * 0.64), y = s * (0.18 + rng() * 0.64);
        const clash = this.terrainRegions.some(r => Math.hypot(r.x - x, r.y - y) < (Math.max(r.rx, r.ry) + s * 0.08) * 0.6);
        if (clash) continue;
        this.terrainRegions.push({ type: needType, x, y, rx: s * 0.07, ry: s * 0.055, seed: 1 + Math.floor(rng() * 97) });
        break;
      }
    }
    // 3) 道路：按原型生成通往主地貌的土路（天然形成地图骨架差异）
    const roadCount = arche.road || 0;
    for (let i = 0; i < roadCount; i++) {
      const r = this.terrainRegions[Math.floor(rng() * this.terrainRegions.length)];
      const edge = Math.floor(rng() * 4);
      const ex = edge < 2 ? (edge === 0 ? margin : s - margin) : r.x + (rng() - .5) * s * .6;
      const ey = edge >= 2 ? (edge === 2 ? margin : s - margin) : r.y + (rng() - .5) * s * .6;
      const mx = (r.x + ex) / 2 + (rng() - .5) * s * .18;
      const my = (r.y + ey) / 2 + (rng() - .5) * s * .18;
      this.terrainRoads.push({
        x1: r.x, y1: r.y, x2: ex, y2: ey, cx: mx, cy: my,
        width: 22 + rng() * 14
      });
    }

    // 4) 田块/废墟痕迹：不同原型数量不同（废墟群最多、沼泽次之）
    const fieldCount = arche.field || 0;
    for (let i = 0; i < fieldCount; i++) {
      const w = s * (0.05 + rng() * 0.1), hh = s * (0.04 + rng() * 0.08);
      this.terrainFields.push({
        x: s * (0.15 + rng() * 0.7), y: s * (0.15 + rng() * 0.7),
        w, h: hh, rotation: rng() * Math.PI,
        ruined: arche.label === '废墟群' || rng() < 0.4
      });
    }

    // 5) 地表装饰：按所处地形选不同笔触（草/碎石/秸秆/裂缝），数量随 tier 增加
    const decorN = 70 + tier * 18;
    for (let i = 0; i < decorN; i++) {
      const x = s * (0.03 + rng() * 0.94), y = s * (0.03 + rng() * 0.94);
      const reg = this.terrainRegions.find(r => this.regionContains(r, x, y));
      const rt = reg ? reg.type : 'grass';
      let kind = 'grass';
      if (rt === 'ruins') kind = rng() < .55 ? 'pebble' : 'crack';
      else if (rt === 'highland') kind = rng() < .6 ? 'pebble' : 'grass';
      else if (rt === 'mud' || rt === 'water') kind = rng() < .5 ? 'crack' : 'pebble';
      else if (rt === 'forest') kind = rng() < .8 ? 'grass' : 'pebble';
      if (rng() < .08) kind = 'straw';
      this.terrainDecor.push({
        x, y, kind, rotation: rng() * Math.PI * 2,
        size: kind === 'grass' ? 4 + rng() * 7 : kind === 'pebble' ? 1.4 + rng() * 2 : kind === 'crack' ? 4 + rng() * 6 : 3 + rng() * 4,
        alpha: kind === 'grass' ? .28 + rng() * .3 : .22 + rng() * .3
      });
    }

    // 6) 障碍：按生态区类型 + 原型密度系数生成（密林多树、荒原多石）
    const pushObstacle = (type, x, y) => {
      if (Math.hypot(x - this.player.x, y - this.player.y) < 150) return;
      const _hp = type === 'tree' ? 60 : type === 'ruin' ? 90 : type === 'rock' ? 130 : 0;
      this.obstacles.push({
        type, x, y, scale: 1, rotation: 0, radius: type === 'tree' ? 15 : 21,
        collisionRx: type === 'tree' ? 15 : 23, collisionRy: 12, collisionOffsetY: 0,
        projectileBlock: type !== 'bush',
        destructible: _hp > 0, hp: _hp, maxHp: _hp
      });
    };
    for (const r of this.terrainRegions) {
      let count = 0;
      if (r.type === 'forest') count = Math.round(30 * arche.tree);
      else if (r.type === 'ruins') count = Math.round(16 * (arche.rock * .9));
      else if (r.type === 'highland') count = Math.round(9 * arche.rock);
      else if (r.type === 'mud') count = Math.round(7 * arche.rock);
      else if (r.type === 'water') count = 0;
      for (let i = 0; i < count; i++) {
        const a = i * 2.399963, d = .36 + .57 * Math.sqrt((i + .5) / Math.max(1, count));
        const x = r.x + Math.cos(a) * r.rx * d, y = r.y + Math.sin(a) * r.ry * d;
        let type;
        if (r.type === 'forest') type = i % 4 ? 'tree' : 'bush';
        else if (r.type === 'ruins') type = i % 3 ? 'ruin' : 'rock';
        else type = i % 5 ? 'rock' : 'bush';
        pushObstacle(type, x, y);
      }
    }
    // 区外零散障碍：荒原/台地多石，密林多树
    const scatter = Math.round(10 + tier * 3);
    for (let i = 0; i < scatter; i++) {
      const x = s * (0.06 + rng() * 0.88), y = s * (0.06 + rng() * 0.88);
      const t = rng() < (arche.tree > 1 ? .6 : .35) ? 'tree' : 'rock';
      pushObstacle(t, x, y);
    }
  },
  renderTerrainRegions(ctx,cam) {
    // 生态区配色由地图主题派生：不同地图的水/林/废墟/高地色互相区分
    const th0 = this.map.terrain || {};
    const tier0 = this.map.tier || 1;
    const mixHex0 = (hex, target, k) => {
      const p = (x) => { const n = parseInt(String(x).replace('#',''), 16); return [(n>>16)&255,(n>>8)&255,n&255]; };
      const a = p(hex), b = p(target);
      const c = a.map((v,i)=>Math.round(v + (b[i]-v)*k));
      return '#' + c.map(v=>v.toString(16).padStart(2,'0')).join('');
    };
    const colors={
      water: th0.water || '#2f7781',
      mud: mixHex0(th0.soil || '#71543b', '#000000', .12),
      forest: mixHex0(th0.ground || '#294d35', '#08150c', .4),
      ruins: tier0 >= 4 ? '#4a4550' : tier0 === 3 ? '#584a3f' : mixHex0(th0.path || '#656653', '#3a3a33', .3),
      highland: mixHex0(th0.glow || '#7b8c57', '#8f8f5c', .22)
    };
    const edgeColor={
      water: mixHex0(colors.water, '#ffffff', .42),
      mud: mixHex0(colors.mud, '#000000', .32),
      forest: mixHex0(colors.forest, '#000000', .28),
      ruins: mixHex0(colors.ruins, '#d8c08a', .4),
      highland: mixHex0(colors.highland, '#e6e0a2', .4)
    };
    const TAU=Math.PI*2;
    const pathFor=(r,extra=0)=>{
      const x=r.x-cam.x,y=r.y-cam.y;
      ctx.beginPath();
      for(let i=0;i<=128;i++){
        const a=i/128*TAU;
        const wave=1+.055*Math.sin(a*3+r.seed)+.035*Math.cos(a*7-r.seed)+.018*Math.sin(a*11+r.seed*2);
        const px=x+Math.cos(a)*(r.rx+extra)*wave;
        const py=y+Math.sin(a)*(r.ry+extra*.72)*wave;
        if(!i)ctx.moveTo(px,py);else ctx.lineTo(px,py);
      }
      ctx.closePath();
    };
    const inside=(r,i,total,scale=1)=>{
      const a=i*2.399963+r.seed*.7;
      const d=Math.sqrt((i+.5)/total)*scale;
      return {x:r.x+Math.cos(a)*r.rx*d,y:r.y+Math.sin(a)*r.ry*d};
    };
    for(const r of this.terrainRegions||[]) {
      const x=r.x-cam.x,y=r.y-cam.y;
      if(x+r.rx+80<0||y+r.ry+80<0||x-r.rx-80>ctx.canvas.width||y-r.ry-80>ctx.canvas.height) continue;
      ctx.save();
      // 羽化过渡带：生态区从草地里「长」出来，而非色块拼贴（两层低alpha生物色外溢）
      pathFor(r,30); ctx.fillStyle=colors[r.type]; ctx.globalAlpha=.10; ctx.fill();
      pathFor(r,15); ctx.globalAlpha=.15; ctx.fill(); ctx.globalAlpha=1;
      // 阴影与外缘：先建立实体地形体积，再绘制材质。
      pathFor(r,14); ctx.fillStyle='rgba(9,18,15,.28)'; ctx.fill();
      if(r.type==='highland') { pathFor(r,10); ctx.fillStyle='rgba(33,42,28,.52)'; ctx.fill(); }
      pathFor(r); const g=ctx.createLinearGradient(x-r.rx,y-r.ry,x+r.rx,y+r.ry);
      g.addColorStop(0,colors[r.type]); g.addColorStop(.58,colors[r.type]); g.addColorStop(1,r.type==='water'?'#1f5967':r.type==='highland'?'#5b713f':'#3b5839');
      ctx.fillStyle=g; ctx.fill();
      ctx.lineWidth=r.type==='water'?5:3; ctx.strokeStyle=edgeColor[r.type]; ctx.globalAlpha=.88; ctx.stroke(); ctx.globalAlpha=1;

      ctx.save(); pathFor(r); ctx.clip();
      const total=r.type==='forest'?210:r.type==='ruins'?180:r.type==='water'?140:190;
      for(let i=0;i<total;i++){
        const p=inside(r,i,total,.93), sx=p.x-cam.x, sy=p.y-cam.y;
        const pulse=Math.sin((i+r.seed)*1.7)*.5+.5;
        if(r.type==='water'){
          ctx.strokeStyle=i%3===0?'rgba(215,244,226,.65)':'rgba(151,214,209,.38)'; ctx.lineWidth=1.2;
          const len=8+(i%5)*4; ctx.beginPath();ctx.moveTo(sx-len,sy);ctx.quadraticCurveTo(sx,sy-3-pulse*3,sx+len,sy);ctx.stroke();
          if(i%9===0){ctx.fillStyle='rgba(223,250,215,.55)';ctx.beginPath();ctx.arc(sx,sy,2.5,0,TAU);ctx.fill();}
          if(i%14===7){ // 睡莲小簇（含叶缺口朝向）
            ctx.fillStyle='rgba(96,150,74,.5)';ctx.beginPath();ctx.ellipse(sx,sy,6,3.6,0,0,TAU);ctx.fill();
            ctx.fillStyle='rgba(130,185,95,.55)';ctx.beginPath();ctx.ellipse(sx+6,sy+3,4.4,2.6,.4,0,TAU);ctx.fill();
            ctx.strokeStyle='rgba(47,119,129,.9)';ctx.lineWidth=1.6;
            ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(sx+6,sy-3);ctx.stroke();
          }
          if(i%17===5){ // 岸边芦苇三株
            ctx.strokeStyle='rgba(168,196,120,.6)';ctx.lineWidth=1.3;
            for(let k=-1;k<=1;k++){ctx.beginPath();ctx.moveTo(sx+k*3,sy+5);ctx.quadraticCurveTo(sx+k*4,sy-4,sx+k*6,sy-9);ctx.stroke();}
          }
        } else if(r.type==='mud') {
          ctx.strokeStyle=i%4===0?'rgba(48,31,24,.45)':'rgba(104,76,51,.42)';ctx.lineWidth=2;
          ctx.beginPath();ctx.moveTo(sx-10,sy-3);ctx.quadraticCurveTo(sx,sy+2,sx+12,sy-1);ctx.stroke();
          if(i%8===0){ctx.fillStyle='rgba(33,24,20,.35)';ctx.beginPath();ctx.ellipse(sx,sy,8,3,.15,0,TAU);ctx.fill();}
          if(i%11===4){ // 积水反光
            ctx.fillStyle='rgba(178,208,214,.13)';ctx.beginPath();ctx.ellipse(sx,sy,13,4.5,.1,0,TAU);ctx.fill();
          }
          if(i%23===9){ // 干裂纹
            ctx.strokeStyle='rgba(36,26,20,.5)';ctx.lineWidth=1.4;
            ctx.beginPath();ctx.moveTo(sx-12,sy-4);ctx.lineTo(sx-3,sy);ctx.lineTo(sx+4,sy-3);ctx.lineTo(sx+13,sy+2);ctx.stroke();
          }
          if(i%29===3){ // 卵石
            ctx.fillStyle='rgba(140,128,106,.55)';ctx.beginPath();ctx.ellipse(sx,sy,3,2,.3,0,TAU);ctx.fill();
          }
        } else if(r.type==='forest') {
          ctx.strokeStyle=i%3?'rgba(129,170,93,.45)':'rgba(185,205,113,.42)';ctx.lineWidth=1.3;
          ctx.beginPath();ctx.moveTo(sx,sy+6);ctx.lineTo(sx-3,sy-5);ctx.moveTo(sx,sy+6);ctx.lineTo(sx+4,sy-3);ctx.stroke();
          if(i%13===0){ctx.fillStyle='rgba(218,196,97,.62)';ctx.beginPath();ctx.arc(sx+3,sy-5,2,0,TAU);ctx.fill();}
          if(i%15===7){ // 林冠阴影（树下地面压暗，体积感）
            ctx.fillStyle='rgba(8,20,12,.12)';ctx.beginPath();ctx.ellipse(sx,sy,30,20,0,0,TAU);ctx.fill();
          }
          if(i%7===3){ // 蕨丛四叶
            ctx.strokeStyle='rgba(88,130,66,.5)';ctx.lineWidth=1.3;
            for(let k=0;k<4;k++){const fa=-.5+k*.5+(i%3)*.12;ctx.beginPath();ctx.moveTo(sx,sy+4);ctx.quadraticCurveTo(sx+Math.cos(fa)*5,sy-2,sx+Math.cos(fa)*9,sy-7);ctx.stroke();}
          }
          if(i%19===11){ // 蘑菇
            ctx.fillStyle='rgba(214,196,158,.7)';ctx.fillRect(sx-.8,sy-3,1.6,3);
            ctx.fillStyle='rgba(196,120,84,.8)';ctx.beginPath();ctx.arc(sx,sy-3.4,2.4,Math.PI,0);ctx.fill();
          }
          if(i%31===17){ // 倒木
            ctx.fillStyle='rgba(74,52,34,.72)';ctx.beginPath();ctx.roundRect(sx-14,sy-4,28,7,3);ctx.fill();
            ctx.fillStyle='rgba(150,116,78,.6)';ctx.beginPath();ctx.ellipse(sx+14,sy-.5,2.6,3.4,0,0,TAU);ctx.fill();
            ctx.strokeStyle='rgba(46,32,20,.5)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(sx-9,sy-1);ctx.lineTo(sx+8,sy-2);ctx.stroke();
          }
        } else if(r.type==='ruins') {
          ctx.fillStyle=i%4?'rgba(49,53,46,.58)':'rgba(151,132,91,.55)';ctx.fillRect(sx-5,sy-3,10+(i%3)*4,6);
          if(i%10===0){ctx.strokeStyle='rgba(196,168,103,.6)';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(sx-12,sy+8);ctx.lineTo(sx+11,sy-8);ctx.stroke();}
          if(i%5===2){ // 斜置碎石（打破直角重复）
            ctx.save();ctx.translate(sx+8,sy+6);ctx.rotate((i*1.7)%1.2-.6);
            ctx.fillStyle='rgba(58,60,52,.5)';ctx.fillRect(-4,-2.5,8,5);ctx.restore();
          }
          if(i%9===2){ // 苔藓侵蚀
            ctx.fillStyle='rgba(96,130,70,.2)';ctx.beginPath();ctx.ellipse(sx,sy,9,5,(i%5)*.4,0,TAU);ctx.fill();
          }
          if(i%27===13){ // 基础轮廓残线
            ctx.strokeStyle='rgba(30,32,28,.42)';ctx.lineWidth=2;
            ctx.beginPath();ctx.moveTo(sx-14,sy+6);ctx.lineTo(sx-14,sy-8);ctx.lineTo(sx+2,sy-8);ctx.stroke();
          }
        } else if(r.type==='highland') {
          ctx.strokeStyle='rgba(215,220,145,.42)';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(sx,sy,10+(i%5)*5,0,Math.PI*1.35);ctx.stroke();
          if(i%6===1){ // 碎石坡
            ctx.fillStyle='rgba(128,130,116,.5)';ctx.beginPath();ctx.ellipse(sx,sy,2.6,1.8,(i%3)*.5,0,TAU);ctx.fill();
          }
          if(i%8===4){ // 等高草行
            ctx.strokeStyle='rgba(196,205,130,.4)';ctx.lineWidth=1.2;
            ctx.beginPath();ctx.moveTo(sx-8,sy);ctx.quadraticCurveTo(sx,sy-3,sx+8,sy);ctx.stroke();
          }
        }
      }
      // 高地台阶与河岸浅滩是区域识别的主轮廓。
      if(r.type==='highland'){
        for(let k=1;k<=3;k++){pathFor(r,-k*15);ctx.strokeStyle=`rgba(223,218,143,${.34-k*.06})`;ctx.lineWidth=2;ctx.stroke();}
        ctx.fillStyle='rgba(236,231,164,.65)';ctx.fillRect(x-5,y-r.ry*.72,10,5);
      }
      if(r.type==='water'){
        for(let k=1;k<=3;k++){pathFor(r,k*9);ctx.strokeStyle=`rgba(219,226,174,${.22-k*.04})`;ctx.lineWidth=3;ctx.stroke();}
        ctx.fillStyle='rgba(204,223,165,.55)';ctx.beginPath();ctx.ellipse(x-r.rx*.55,y+r.ry*.2,18,7,-.2,0,TAU);ctx.fill();
        // 深水中心渐暗（水体体积感，越靠中心越深）
        const dg=ctx.createRadialGradient(x,y,Math.min(r.rx,r.ry)*.1,x,y,Math.max(r.rx,r.ry));
        dg.addColorStop(0,'rgba(8,38,50,.36)');dg.addColorStop(.55,'rgba(8,38,50,.14)');dg.addColorStop(1,'rgba(8,38,50,0)');
        ctx.fillStyle=dg;pathFor(r);ctx.fill();
      }
      if(r.type==='ruins'){
        ctx.strokeStyle='rgba(211,184,122,.52)';ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(x-r.rx*.62,y-r.ry*.1);ctx.lineTo(x-r.rx*.12,y-r.ry*.42);ctx.lineTo(x+r.rx*.43,y-r.ry*.15);ctx.stroke();
        ctx.strokeStyle='rgba(42,45,38,.68)';ctx.lineWidth=3;ctx.stroke();
      }
      if(r.type==='forest'){
        ctx.strokeStyle='rgba(180,205,115,.32)';ctx.lineWidth=2;pathFor(r,-18);ctx.stroke();
      }
      ctx.restore();
      // 地形图标式微标记，让玩家不用靠文字猜区域。
      ctx.globalAlpha=.62;ctx.font='bold 11px sans-serif';ctx.textAlign='center';ctx.fillStyle='#eef1cf';
      const label={water:'河湾',mud:'泥地',forest:'密林',ruins:'废墟',highland:'高地'}[r.type];
      ctx.fillText(label,x,y-r.ry-.12*r.ry);ctx.globalAlpha=1;
      // 边缘侵蚀缺口：草色啃入生态区 + 生物色外溢到草地，弱化「贴纸感」边缘
      const gCol=(this.map.terrain&&this.map.terrain.ground)||'#405638';
      for(let k=0;k<5;k++){
        const na=regionHash(r.seed|0,k,41)*TAU;
        const ex=x+Math.cos(na)*(r.rx+2),ey=y+Math.sin(na)*(r.ry+2);
        ctx.fillStyle=gCol;ctx.globalAlpha=.38;
        ctx.beginPath();ctx.ellipse(ex,ey,7+(k%3)*3,4+(k%2)*2,na,0,TAU);ctx.fill();
        const ix=x+Math.cos(na)*(r.rx-6),iy=y+Math.sin(na)*(r.ry-6);
        ctx.fillStyle=colors[r.type];ctx.globalAlpha=.3;
        ctx.beginPath();ctx.ellipse(ix,iy,5,3.4,na,0,TAU);ctx.fill();
        ctx.globalAlpha=1;
      }
      ctx.restore();
    }
    // 主路：两侧压实边缘 + 中央车辙，让道路成为可读的空间引导。
    ctx.save();ctx.lineCap='round';
    ctx.strokeStyle='rgba(37,29,20,.48)';ctx.lineWidth=48;ctx.beginPath();ctx.moveTo(120-cam.x,480-cam.y);ctx.quadraticCurveTo(610-cam.x,410-cam.y,1120-cam.x,520-cam.y);ctx.stroke();
    ctx.strokeStyle='#92774d';ctx.lineWidth=38;ctx.beginPath();ctx.moveTo(120-cam.x,480-cam.y);ctx.quadraticCurveTo(610-cam.x,410-cam.y,1120-cam.x,520-cam.y);ctx.stroke();
    ctx.strokeStyle='rgba(55,39,25,.45)';ctx.lineWidth=3;
    for(const off of [-10,10]){ctx.beginPath();ctx.moveTo(120-cam.x,480-cam.y+off);ctx.quadraticCurveTo(610-cam.x,410-cam.y+off,1120-cam.x,520-cam.y+off);ctx.stroke();}
    ctx.restore();
  },
  terrainBlocksProjectile(x1,y1,x2,y2,radius=0) {
    const vx=x2-x1,vy=y2-y1,len=vx*vx+vy*vy;
    return (this.obstacles||[]).some(o=>{
      if(o.type==='bush'||o.projectileBlock===false)return false;
      const t=len?Math.max(0,Math.min(1,((o.x-x1)*vx+(o.y-y1)*vy)/len)):0;
      const dx=x1+vx*t-o.x,dy=y1+vy*t-o.y;
      const rx=(o.collisionRx||o.radius||20)+radius,ry=(o.collisionRy||o.radius||20)+radius;
      return dx*dx/(rx*rx)+dy*dy/(ry*ry)<=1;
    });
  },
  terrainCanDetect(m,d) {
    if(m.type==='hunter')return true; // G6 荒野猎手：无视地形/潜行，永远锁定玩家
    if(this.player.stealth>0)return false;
    const forest=this.getTerrainAt(this.player.x,this.player.y).id==='forest';
    const hidden=forest&&(this.elapsed-(this.lastTerrainAttackAt??-99)>2)&&d>90;
    if(hidden && (this.forestHideTime || 0) < 5)return false;
    const radius=(this.elapsed<40?240:400)*(forest?.55:1);
    return d<radius||(m.beastWave&&!forest);
  },
  terrainElementMultiplier(target,info) {
    if(this.getTerrainAt(target.x,target.y).id!=='water')return 1;
    const element=info?.element||(info?.weaponId==='flame_bow'?'fire':null);
    return element==='lightning'?1.35:element==='fire'?.7:1;
  },
  initializeWorldProps() {
    // 竖立物共享一个碰撞代理；仍由原来的 Y 排序渲染，避免重复绘制。
    this.fxProps = (this.fxProps || []).filter(p => p.type !== 'campfire');
    for (const p of this.fxProps) {
      const spec = {brokensword:[9,7,'回收断剑 · 铁矿 ×1'], crystal:[13,10,'采集水晶 · 通用材料 ×2'], crate:[16,12,'拆解木箱 · 通用材料 ×2'], signpost:[6,5,'查看撤离方向']}[p.type];
      if (!spec) continue;
      p.interactionLabel=spec[2];
      p.collider={x:p.x,y:p.y,radius:spec[0],collisionRx:spec[0],collisionRy:spec[1],fxOnly:true,projectileBlock:true};
      this.obstacles.push(p.collider);
    }
    this.obstacleSpatialHash.rebuild(this.obstacles);
    this.obstaclesByY=[...this.obstacles].sort((a,b)=>a.y-b.y);
  },
  interactWorldProp(x,y) {
    const p=(this.fxProps||[]).find(p=>!p.used && p.interactionLabel && dist(p,this.player)<65 && Math.hypot(x-p.x,y-(p.y-14))<36);
    if(!p) return false;
    if(p.type==='signpost') { this.extractionIntel=true; showToast('已标记最近撤离方向','info'); return true; }
    p.used=true;
    this.obstacles=this.obstacles.filter(o=>o!==p.collider);
    this.obstacleSpatialHash.rebuild(this.obstacles);
    this.obstaclesByY=[...this.obstacles].sort((a,b)=>a.y-b.y);
    const item=p.type==='brokensword'
      ? {type:'material',id:'salvaged_iron',matId:'iron',name:'回收铁矿',icon:'铁',amount:1,slots:1}
      : {type:'material',id:'salvaged_material',name:'回收材料',icon:'材',amount:2,slots:1};
    this.spawnGroundLoot(item,p.x,p.y);
    this.spawnImpact(p.x,p.y,'#d5c49a',.7);
    showToast('回收完成：拾取地上材料，撤离后保留','success');
    return true;
  },
  initializeTerrainJourney() {
    this.initializeWorldProps();
    this.phaseLabel='低压探索'; this.nextEventAt=140; this.beastWave.nextIn=this.map.tier===1?240:200;
    let kept=0;
    this.deferredMonsters=[];
    // 在场初始基础怪 8→16：v5.8.11 用户需求「常驻野怪再翻一倍」（延迟池相应减少，总怪量不变）
    this.monsters=this.monsters.filter(m=>{if(!m.elite&&['boar','bat','spider'].includes(m.type)&&kept++<16)return true;this.deferredMonsters.push(m);return false;});
    this.deferredRaiders=this.raiders.splice(0);
    const items=[
      {type:'consumable',id:'water_bottle',name:'河水',icon:'水',amount:1},
      {type:'consumable',id:'herb_kit',name:'河岸药材',icon:'药',amount:1}
    ];
    // 使用现有道具定义，避免生成无法使用的物品。
    items[0]={type:'material',id:'river_water',matId:'water',name:'净水材料',icon:'水',amount:2,slots:1};
    for(const r of this.terrainRegions) {
      if(r.type==='water')items.forEach((it,i)=>this.spawnGroundLoot(it,r.x-r.rx-30,r.y+i*65));
      if(r.type==='ruins')this.spawnGroundLoot({type:'material',id:'ruin_metal',matId:'iron',name:'废墟金属',icon:'铁',amount:3,slots:1},r.x,r.y);
    }
    // 不同地貌原型不一定有森林/高地/废墟：按存在性回退，避免空引用
    const forest=this.terrainRegions.find(r=>r.type==='forest');
    const plantAnchor=forest||this.terrainRegions.find(r=>r.type!=='water')||this.terrainRegions[0]||{x:this.player.x,y:this.player.y};
    this.wildPlants.forEach((p,i)=>{p.x=plantAnchor.x-80+i*38;p.y=plantAnchor.y+Math.sin(i)*65;});
    const seed=CONFIG.wildPlants?.find(p=>p.tier<=this.map.tier&&p.givesSeed);
    if(seed)this.spawnGroundLoot({type:'seed_pickup',seedId:seed.givesSeed,name:seed.name+'种子',icon:seed.icon,amount:1},plantAnchor.x,plantAnchor.y-100);
    const high=this.terrainRegions.find(r=>r.type==='highland'),ruin=this.terrainRegions.find(r=>r.type==='ruins');
    const fallbackPt=(r,ang)=>(r?{x:r.x,y:r.y}:{x:Math.min(CONFIG.expedition.mapSize-120,Math.max(120,this.player.x+Math.cos(ang)*240)),y:Math.min(CONFIG.expedition.mapSize-120,Math.max(120,this.player.y+Math.sin(ang)*240))});
    const highPt=fallbackPt(high,-0.7), ruinPt=fallbackPt(ruin,2.2);
    this.terrainLandmarks=[{kind:'supply',name:'路边补给',x:this.player.x+110,y:this.player.y+65},
      {kind:'observe',name:'高地观测点',x:highPt.x,y:highPt.y}, {kind:'clue',name:'首领遗迹线索',x:ruinPt.x,y:ruinPt.y}];
    this.obstacles=this.obstacles.filter(o=>!this.terrainLandmarks.some(p=>Math.hypot(p.x-o.x,p.y-o.y)<65));
    this.obstacleSpatialHash.rebuild(this.obstacles);this.obstaclesByY=[...this.obstacles].sort((a,b)=>a.y-b.y);
    this.entitySpatialHash.rebuild([...this.monsters,...this.raiders]);
  },
  // v5.8.1 在玩家周围环带（minD~maxD）找一个不撞障碍、不贴玩家的刷新点（挂玩家位置的怪群导演用）
  _ringSpawnAroundPlayer(minD,maxD,radius=18){
    const size=CONFIG.expedition.mapSize;
    for(let i=0;i<10;i++){
      const ang=rand(0,Math.PI*2),d=rand(minD,maxD);
      const x=clamp(this.player.x+Math.cos(ang)*d,80,size-80);
      const y=clamp(this.player.y+Math.sin(ang)*d,80,size-80);
      if(!this.collidesWithObstacle(x,y,radius+12)&&dist({x,y},this.player)>=minD*0.8)return{x,y};
    }
    return this.findSafeSpawn(180,size-180,Math.max(20,radius),Math.round(minD*0.8));
  },
  updateTerrainJourney(dt) {
    // v5.8.11 节奏重排：探索期 120→40s，构筑期 40-120s，Boss 提前到第 2 分钟（120s）觉醒即进风险期
    const phase=this.elapsed<40?'低压探索':this.elapsed<120?'形成构筑':'风险兑现';
    if(phase!==this.phaseLabel) {
      this.phaseLabel=phase;
      showToast(phase==='形成构筑'?'构筑期：精英、商人和篝火已开放':'风险期：区域首领苏醒！考虑撤离','warning');
      if(this.elapsed>=40&&!this.buildUnlocked){
        this.buildUnlocked=true;
        // v5.8.1 怪群接管：延迟怪不再一次性原位放出（玩家路线外的怪永远沉睡），
        // 改由下方怪群导演渐进释放到玩家周边环带；掠夺者仍按原位放出
        this.raiders.push(...(this.deferredRaiders||[]));this.deferredRaiders=[];
        this._directorTimer=2;
      }
    }
    // v5.8.1 怪群导演：构筑期起渐进释放延迟怪（非巡逻怪挪到玩家 380-560 环带），
    // 池空后维持玩家 700 半径内活性怪群密度（遭遇率修复：原 178s 仅遇 16 只）
    if(this.buildUnlocked){
      this._directorTimer=(this._directorTimer??2)-dt;
      if(this._directorTimer<=0){
        this._directorTimer=8;
        const def=this.deferredMonsters||[];
        if(def.length){
          const n=Math.min(3,def.length);
          for(let i=0;i<n;i++){
            const m=def.shift();
            if(!m.patrolRoute){const p=this._ringSpawnAroundPlayer(380,560,m.radius||18);m.x=p.x;m.y=p.y;}
            this.monsters.push(m);
          }
        }else{
          const target={1:5,2:6,3:7,4:8}[this.map.tier]||6;
          const near=this.monsters.filter(m=>m.hp>0&&!m.beastWave&&dist(m,this.player)<700).length;
          const deficit=target-near;
          if(deficit>0){
            let type=null;
            try{if(window.V5&&this.map.monsterPool)type=V5.pickMonsterType(this.map);}catch(e){}
            if(!type&&this.map.monsterPool&&this.map.monsterPool.length){
              const total=this.map.monsterPool.reduce((s,e)=>s+(e[1]||0),0);
              if(total>0){let roll=Math.random()*total;for(const e of this.map.monsterPool){roll-=(e[1]||0);if(roll<=0){type=e[0];break;}}}
            }
            const data=type?CONFIG.monsters[type]:null;
            if(data){
              const cnt=Math.min(2,deficit);
              for(let i=0;i<cnt;i++){
                const p=this._ringSpawnAroundPlayer(480,650,data.radius||18);
                const hp=Math.round(data.hp*this.balance.enemyHp);
                const nm={type,...data,x:p.x,y:p.y,hp,maxHp:hp,
                  damage:Math.round(data.damage*this.balance.enemyDamage),
                  speed:data.speed*this.balance.enemySpeed,
                  attackCd:0,stunned:0,target:null,vx:0,vy:0,
                  facing:rand(0,Math.PI*2),animTime:rand(0,10),hitFlash:0,
                  elite:false,abilityCd:rand(1,4),packOffset:rand(-1,1),state:'idle',stateTimer:0,
                  directorSpawned:true};
                this.monsters.push(nm);
                if(typeof CombatEnhancement!=='undefined'){try{CombatEnhancement.assignAIType(nm);}catch(e){}}
              }
            }
          }
        }
      }
    }
    if(this.elapsed>=120&&!this.bossSpawned)this.spawnBoss();
    const ground=this.getTerrainAt(this.player.x,this.player.y);
    this.forestHideTime=ground.id==='forest' && this.elapsed-(this.lastTerrainAttackAt??-99)>2 ? (this.forestHideTime||0)+dt : 0;
    if(ground.id==='water'&&this.player.burn){this.player.burn=null;this.pushCombatFeedback('河水灭火','#99dfe3');}
    for(const p of this.terrainLandmarks||[]) {
      if(p.used||dist(p,this.player)>48)continue;p.used=true;
      if(p.kind==='supply'){this.spawnGroundLoot({type:'consumable',id:'herb_kit',name:'药草包',icon:'药',amount:1},p.x,p.y);showToast('找到第一处补给：靠近拾取，沿河岸寻找药材','success');}
      if(p.kind==='clue'){this.bossClueFound=true;showToast('首领线索：2 分钟时区域首领就会苏醒；利用废墟残墙挡弹','info');}
      if(p.kind==='observe'){this.extractionIntel=true;showToast('观测完成：撤离方向已标记在视野内','info');}
    }
    this.fogDirty=true;
    if (ground.id !== this.lastGroundId) {
      this.lastGroundId=ground.id;
      this.pushCombatFeedback(ground.name,'#a7d8bb');
    }
  },
  renderTerrainLandmarks(ctx,cam) {
    const lz=cam.zoom||1;   // v1.8 UI 层世界→屏幕乘 zoom
    ctx.save();ctx.font='13px sans-serif';ctx.textAlign='center';
    for(const p of this.terrainLandmarks||[]) {
      if(!this.isWorldVisible(p.x,p.y))continue;
      const x=(p.x-cam.x)*lz,y=(p.y-cam.y)*lz;ctx.fillStyle=p.used?'#74968a':'#edcb75';
      ctx.fillRect(x-4,y-25,8,25);ctx.beginPath();ctx.moveTo(x,y-29);ctx.lineTo(x+19,y-22);ctx.lineTo(x,y-16);ctx.fill();
      ctx.fillStyle='#f5f1d5';ctx.fillText(p.name+(p.used?' · 已发现':''),x,y+20);
    }
    if(this.extractionIntel&&this.extractPoints?.length){
      const p=this.extractPoints.reduce((a,b)=>dist(a,this.player)<dist(b,this.player)?a:b);
      const a=Math.atan2(p.y-this.player.y,p.x-this.player.x),x=(this.player.x-cam.x)*lz+Math.cos(a)*100,y=(this.player.y-cam.y)*lz+Math.sin(a)*100;
      ctx.fillStyle='#96d8f3';ctx.fillText('撤离 '+Math.round(dist(p,this.player))+'m',x,y);
    }
    ctx.restore();
  }
});
