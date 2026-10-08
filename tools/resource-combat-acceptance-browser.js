(() => {
const out=[];const check=(name,pass,data)=>{out.push({name,pass:!!pass,data});};
const rng=Math.random; Math.random=()=>0;
try {
CharacterSystem.init();Greenhouse.init();LoadoutSystem.init();
GameState.level=19;GameState.cultivation=0;GameState.gold=100000;
const needed=[...new Set(LoadoutSystem.UPGRADE_COSTS.flatMap(c=>Object.keys(c.materials)))];
for(const mat of needed){
 const sources=Object.entries(CONFIG.cropMaterials).filter(([id,ys])=>CONFIG.crops.some(c=>c.id===id)&&ys.some(y=>y[0]===mat&&y[1]>0&&y[2]>0));
 const before=ResourceSystem.count(mat);
 for(const [id] of sources) CharacterSystem.onCropHarvested(id,1,'normal');
 check('材料实际收获：'+mat,sources.length>0&&ResourceSystem.count(mat)>before,sources.map(s=>s[0]));
}
for(const id of Greenhouse.V58_PLANTS){GameState.greenhouse.selectedPlant=id;GameState.greenhouse.plots[0].plant=null;Greenhouse.plant(0);check('默认温室种植：'+id,GameState.greenhouse.plots[0].plant?.id===id);}
for(const p of CONFIG.greenhousePlants.filter(p=>p.drops.some(d=>(CONFIG.greenhouseDrops[d.id]||CONFIG.warehouseItems[d.id])?.type==='cultivation'))){
 GameState.level=19;GameState.cultivation=100000;
 const expected=p.drops.reduce((s,d)=>{const def=CONFIG.greenhouseDrops[d.id]||CONFIG.warehouseItems[d.id];return s+(def?.type==='cultivation'?(def.cult??def.value??0)*(Array.isArray(d.amount)?d.amount[0]:d.amount??d.min??1):0)},0);
 GameState.greenhouse.plots[0]={plant:p,ready:true};Greenhouse.harvest(0);check('修为丹到账：'+p.id,GameState.cultivation===100000+expected,{expected,actual:GameState.cultivation-100000});
}
const w=GameState.weaponInstances[0];w.level=0;const cost=LoadoutSystem.UPGRADE_COSTS[0];for(const [id,n]of Object.entries(cost.materials))GameState.warehouse.materials[id]=n;
const gold=GameState.gold;LoadoutSystem.upgradeWeapon(w.uid);check('武器升级扣料',w.level===1&&GameState.gold===gold-cost.gold&&Object.keys(cost.materials).every(id=>ResourceSystem.count(id)===0));
GameState.blueprints=['throwing_knife'];GameState.expBoost=true;SaveSystem.save();GameState.blueprints=[];GameState.expBoost=false;SaveSystem.load();check('蓝图与加成存档',GameState.blueprints.includes('throwing_knife')&&GameState.expBoost);
GameState.loadoutWeaponUids=[w.uid];GameState.selectedMap='t1_1';Game.startExpedition();cancelAnimationFrame(Game.animId);const g=Game.expedition;g.paused=false;
check('取消空壳建筑',g.landmarks.length===0);
g.player.invuln=0;g.cardShield=100;g.player.hitStun=0;g.screenShake=0;const hp=g.player.hp;g.damagePlayer(10,{x:g.player.x+40,y:g.player.y,type:'test'});check('护盾格挡反馈',g.player.hp===hp&&g.player.hitStun===0&&g.screenShake===0&&g.combatFeedback.some(f=>f.text==='格挡'));
const t={x:g.player.x+80,y:g.player.y,radius:18,hp:10000,maxHp:10000,type:'boar',state:'chase'};
g.damageEnemy(t,10,'#ffffff',false,{fromPlayer:true,crit:false});check('命中缺省坐标',Number.isFinite(t.knockX)&&Number.isFinite(t.knockY)&&g.particles.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
g.damageNumbers=[];t.state='chase';t.hitFlash=0;const pc=g.particles.length;for(let i=0;i<15;i++)g.damageEnemy(t,2,'#cc5544',false,{quiet:true,crit:false});check('持续伤害合并且不硬直',g.damageNumbers.length===1&&t.state==='chase'&&t.hitFlash===0&&g.particles.length===pc);
const m={...CONFIG.monsters.boar,type:'boar',x:g.player.x+500,y:g.player.y,hp:100,maxHp:100,windupT:.01,windupKind:'melee',windupTarget:'player',windupAngle:0,attackCd:1,stateTimer:0,animTime:0};g.monsters=[m];g.cardShield=0;const beforeHp=g.player.hp;g.updateMonsters(.02);check('躲开近战不受伤',g.player.hp===beforeHp);
for(const id of ['t1_4','t2_3']){g.map=CONFIG.maps.find(m=>m.id===id);g.obstacles=[];g.applyMapModifiers();check('障碍碰撞完整：'+id,g.obstacles.length>0&&g.obstacles.every(o=>Number.isFinite(o.radius)&&Number.isFinite(o.scale)));}
g.map=CONFIG.maps[0];g.obstacles=[];g.monsters=[];GameState.expBoost=true;const pre=GameState.cultivation;V5.onExtractSuccess(g);check('加成卡实际生效',GameState.cultivation-pre===180&&!GameState.expBoost);
} finally {Math.random=rng;}
window.resourceAuditResults=out;return out;
})()
