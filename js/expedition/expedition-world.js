/* 世界区域是地表绘制、移动、战斗与资源分布的共同来源。依赖 Expedition、CONFIG。 */
Object.assign(Expedition.prototype, {
  terrainRules: {
    grass: {name:'草甸',moveMul:1,visionMul:1,rangeMul:1,hint:'沿路寻找补给；树干与岩石可挡弹'},
    water: {name:'浅水河湾',moveMul:.62,visionMul:1,rangeMul:1,hint:'移动 -38% · 灭火 · 雷电 +35% / 火焰 -30%'},
    mud: {name:'泥地',moveMul:.72,visionMul:1,rangeMul:1,hint:'移动 -28% · 冲刺也受泥地影响'},
    forest: {name:'密林草丛',moveMul:.94,visionMul:1,rangeMul:1,hint:'发现距离 -45% · 停火 2 秒后隐蔽 5 秒'},
    ruins: {name:'旧哨站废墟',moveMul:1,visionMul:1,rangeMul:1,hint:'残墙挡弹 · 搜寻金属与首领线索'},
    highland: {name:'风望高地',moveMul:1,visionMul:1.25,rangeMul:1.15,hint:'视野 +25% · 远程射程 +15% · 观测撤离方向'}
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
  generateTerrainRegions() {
    const s=CONFIG.expedition.mapSize;
    this.terrainRegions=[
      {type:'water',x:s*.46,y:s*.29,rx:s*.10,ry:s*.23,seed:1},
      {type:'mud',x:s*.31,y:s*.31,rx:s*.085,ry:s*.06,seed:2},
      {type:'forest',x:s*.23,y:s*.57,rx:s*.18,ry:s*.15,seed:3},
      {type:'ruins',x:s*.72,y:s*.56,rx:s*.15,ry:s*.13,seed:4},
      {type:'highland',x:s*.72,y:s*.22,rx:s*.145,ry:s*.12,seed:5},
      {type:'forest',x:s*.61,y:s*.84,rx:s*.17,ry:s*.095,seed:6}
    ];
    this.terrainPatches=[]; this.terrainFields=[]; this.terrainRoads=[];
    this.terrainDecor=[]; this.obstacles=[];
    for(const r of this.terrainRegions) {
      const count=r.type==='forest'?35:r.type==='ruins'?20:r.type==='highland'?9:0;
      for(let i=0;i<count;i++) {
        const a=i*2.399963, d=.36+.57*Math.sqrt((i+.5)/count);
        const x=r.x+Math.cos(a)*r.rx*d,y=r.y+Math.sin(a)*r.ry*d;
        if(Math.hypot(x-this.player.x,y-this.player.y)<150) continue;
        const type=r.type==='forest'?(i%4?'tree':'bush'):r.type==='ruins'?(i%3?'ruin':'rock'):'rock';
        this.obstacles.push({type,x,y,scale:1,rotation:0,radius:type==='tree'?15:21,
          collisionRx:type==='tree'?15:23,collisionRy:12,collisionOffsetY:0,projectileBlock:type!=='bush'});
      }
    }
  },
  renderTerrainRegions(ctx,cam) {
    const colors={water:'#2f7781',mud:'#71543b',forest:'#294d35',ruins:'#656653',highland:'#7b8c57'};
    const edgeColor={water:'#bdd7a0',mud:'#4b382c',forest:'#1e3c2b',ruins:'#b39a6c',highland:'#d0cb83'};
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
      // 阴影与外缘：先建立实体地形体积，再绘制材质。
      pathFor(r,14); ctx.fillStyle='rgba(9,18,15,.28)'; ctx.fill();
      if(r.type==='highland') { pathFor(r,10); ctx.fillStyle='rgba(33,42,28,.52)'; ctx.fill(); }
      pathFor(r); const g=ctx.createLinearGradient(x-r.rx,y-r.ry,x+r.rx,y+r.ry);
      g.addColorStop(0,colors[r.type]); g.addColorStop(.58,colors[r.type]); g.addColorStop(1,r.type==='water'?'#1f5967':r.type==='highland'?'#5b713f':'#3b5839');
      ctx.fillStyle=g; ctx.fill();
      ctx.lineWidth=r.type==='water'?5:3; ctx.strokeStyle=edgeColor[r.type]; ctx.globalAlpha=.88; ctx.stroke(); ctx.globalAlpha=1;

      ctx.save(); pathFor(r); ctx.clip();
      const total=r.type==='forest'?115:r.type==='ruins'?90:r.type==='water'?70:105;
      for(let i=0;i<total;i++){
        const p=inside(r,i,total,.93), sx=p.x-cam.x, sy=p.y-cam.y;
        const pulse=Math.sin((i+r.seed)*1.7)*.5+.5;
        if(r.type==='water'){
          ctx.strokeStyle=i%3===0?'rgba(215,244,226,.65)':'rgba(151,214,209,.38)'; ctx.lineWidth=1.2;
          const len=8+(i%5)*4; ctx.beginPath();ctx.moveTo(sx-len,sy);ctx.quadraticCurveTo(sx,sy-3-pulse*3,sx+len,sy);ctx.stroke();
          if(i%9===0){ctx.fillStyle='rgba(223,250,215,.55)';ctx.beginPath();ctx.arc(sx,sy,2.5,0,TAU);ctx.fill();}
        } else if(r.type==='mud') {
          ctx.strokeStyle=i%4===0?'rgba(48,31,24,.45)':'rgba(104,76,51,.42)';ctx.lineWidth=2;
          ctx.beginPath();ctx.moveTo(sx-10,sy-3);ctx.quadraticCurveTo(sx,sy+2,sx+12,sy-1);ctx.stroke();
          if(i%8===0){ctx.fillStyle='rgba(33,24,20,.35)';ctx.beginPath();ctx.ellipse(sx,sy,8,3,.15,0,TAU);ctx.fill();}
        } else if(r.type==='forest') {
          ctx.strokeStyle=i%3?'rgba(129,170,93,.45)':'rgba(185,205,113,.42)';ctx.lineWidth=1.3;
          ctx.beginPath();ctx.moveTo(sx,sy+6);ctx.lineTo(sx-3,sy-5);ctx.moveTo(sx,sy+6);ctx.lineTo(sx+4,sy-3);ctx.stroke();
          if(i%13===0){ctx.fillStyle='rgba(218,196,97,.62)';ctx.beginPath();ctx.arc(sx+3,sy-5,2,0,TAU);ctx.fill();}
        } else if(r.type==='ruins') {
          ctx.fillStyle=i%4?'rgba(49,53,46,.58)':'rgba(151,132,91,.55)';ctx.fillRect(sx-5,sy-3,10+(i%3)*4,6);
          if(i%10===0){ctx.strokeStyle='rgba(196,168,103,.6)';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(sx-12,sy+8);ctx.lineTo(sx+11,sy-8);ctx.stroke();}
        } else if(r.type==='highland') {
          ctx.strokeStyle='rgba(215,220,145,.42)';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(sx,sy,10+(i%5)*5,0,Math.PI*1.35);ctx.stroke();
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
    if(this.player.stealth>0)return false;
    const forest=this.getTerrainAt(this.player.x,this.player.y).id==='forest';
    const hidden=forest&&(this.elapsed-(this.lastTerrainAttackAt??-99)>2)&&d>90;
    if(hidden && (this.forestHideTime || 0) < 5)return false;
    const radius=(this.elapsed<120?240:400)*(forest?.55:1);
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
    this.phaseLabel='低压探索'; this.nextEventAt=380; this.beastWave.nextIn=360;
    let kept=0;
    this.deferredMonsters=[];
    this.monsters=this.monsters.filter(m=>{if(!m.elite&&['boar','bat','spider'].includes(m.type)&&kept++<4)return true;this.deferredMonsters.push(m);return false;});
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
    const forest=this.terrainRegions.find(r=>r.type==='forest');
    this.wildPlants.forEach((p,i)=>{p.x=forest.x-80+i*38;p.y=forest.y+Math.sin(i)*65;});
    const seed=CONFIG.wildPlants?.find(p=>p.tier<=this.map.tier&&p.givesSeed);
    if(seed)this.spawnGroundLoot({type:'seed_pickup',seedId:seed.givesSeed,name:seed.name+'种子',icon:seed.icon,amount:1},forest.x,forest.y-100);
    const high=this.terrainRegions.find(r=>r.type==='highland'),ruin=this.terrainRegions.find(r=>r.type==='ruins');
    this.terrainLandmarks=[{kind:'supply',name:'路边补给',x:this.player.x+110,y:this.player.y+65},
      {kind:'observe',name:'高地观测点',x:high.x,y:high.y}, {kind:'clue',name:'首领遗迹线索',x:ruin.x,y:ruin.y}];
    this.obstacles=this.obstacles.filter(o=>!this.terrainLandmarks.some(p=>Math.hypot(p.x-o.x,p.y-o.y)<65));
    this.obstacleSpatialHash.rebuild(this.obstacles);this.obstaclesByY=[...this.obstacles].sort((a,b)=>a.y-b.y);
    this.entitySpatialHash.rebuild([...this.monsters,...this.raiders]);
  },
  updateTerrainJourney(dt) {
    const phase=this.elapsed<120?'低压探索':this.elapsed<360?'形成构筑':'风险兑现';
    if(phase!==this.phaseLabel) {
      this.phaseLabel=phase;
      showToast(phase==='形成构筑'?'构筑期：精英、商人和篝火已开放':'风险期：兽潮将至，8 秒后首领现身；考虑撤离','warning');
      if(this.elapsed>=120&&!this.buildUnlocked){
        this.buildUnlocked=true;
        for(const m of this.deferredMonsters||[]){if(dist(m,this.player)<460){const p=this.findSafeSpawn(180,CONFIG.expedition.mapSize-180,30,460);m.x=p.x;m.y=p.y;}this.monsters.push(m);}
        this.raiders.push(...(this.deferredRaiders||[]));this.deferredMonsters=[];this.deferredRaiders=[];
      }
    }
    if(this.elapsed>=368&&!this.bossSpawned)this.spawnBoss();
    const ground=this.getTerrainAt(this.player.x,this.player.y);
    this.forestHideTime=ground.id==='forest' && this.elapsed-(this.lastTerrainAttackAt??-99)>2 ? (this.forestHideTime||0)+dt : 0;
    if(ground.id==='water'&&this.player.burn){this.player.burn=null;this.pushCombatFeedback('河水灭火','#99dfe3');}
    for(const p of this.terrainLandmarks||[]) {
      if(p.used||dist(p,this.player)>48)continue;p.used=true;
      if(p.kind==='supply'){this.spawnGroundLoot({type:'consumable',id:'herb_kit',name:'药草包',icon:'药',amount:1},p.x,p.y);showToast('找到第一处补给：靠近拾取，沿河岸寻找药材','success');}
      if(p.kind==='clue'){this.bossClueFound=true;showToast('首领线索：6 分钟后区域首领苏醒；利用废墟残墙挡弹','info');}
      if(p.kind==='observe'){this.extractionIntel=true;showToast('观测完成：撤离方向已标记在视野内','info');}
    }
    this.fogDirty=true;
    if (ground.id !== this.lastGroundId) {
      this.lastGroundId=ground.id;
      this.pushCombatFeedback(ground.name,'#a7d8bb');
    }
  },
  renderTerrainLandmarks(ctx,cam) {
    ctx.save();ctx.font='13px sans-serif';ctx.textAlign='center';
    for(const p of this.terrainLandmarks||[]) {
      if(!this.isWorldVisible(p.x,p.y))continue;
      const x=p.x-cam.x,y=p.y-cam.y;ctx.fillStyle=p.used?'#74968a':'#edcb75';
      ctx.fillRect(x-4,y-25,8,25);ctx.beginPath();ctx.moveTo(x,y-29);ctx.lineTo(x+19,y-22);ctx.lineTo(x,y-16);ctx.fill();
      ctx.fillStyle='#f5f1d5';ctx.fillText(p.name+(p.used?' · 已发现':''),x,y+20);
    }
    if(this.extractionIntel&&this.extractPoints?.length){
      const p=this.extractPoints.reduce((a,b)=>dist(a,this.player)<dist(b,this.player)?a:b);
      const a=Math.atan2(p.y-this.player.y,p.x-this.player.x),x=this.player.x-cam.x+Math.cos(a)*100,y=this.player.y-cam.y+Math.sin(a)*100;
      ctx.fillStyle='#96d8f3';ctx.fillText('撤离 '+Math.round(dist(p,this.player))+'m',x,y);
    }
    ctx.restore();
  }
});
