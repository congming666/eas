(() => {
const out=[];const check=(name,pass,data)=>out.push({name,pass:!!pass,data});
GameState.gold=100000;GameState.loadoutWeaponUids=[GameState.weaponInstances[0].uid];Game.startExpedition();cancelAnimationFrame(Game.animId);const g=Game.expedition;g.paused=false;
const oldRandom=Math.random;
try{
 Math.random=()=>0;
 const boss={...CONFIG.monsters.boar,type:'boss',boss:true,x:g.player.x+100,y:g.player.y,hp:0,maxHp:100,name:'测试首领'};
 g.monsters=[boss];g.processDeadMonsters();g.processDeadMonsters();check('首领只掉落一次种子包',g.groundLoot.filter(i=>i.id==='rare_seed_pack').length===1);
 const before=GameState.greenhouse.unlockedPlants.length;Warehouse.addItem('rare_seed_pack',1);Greenhouse.useRareSeedPack();check('种子包实际解锁',GameState.greenhouse.unlockedPlants.length===before+1);
 const plant=CONFIG.greenhousePlants.find(p=>p.drops.some(d=>d.id==='weapon_upgrade_stone'));
 GameState.greenhouse.plots[0]={plant,ready:true};const stones=Warehouse.getCount('weapon_upgrade_stone');Greenhouse.harvest(0);check('强化石实际产出',Warehouse.getCount('weapon_upgrade_stone')===stones+1);
 const damage=g.rollWeaponDamage(g.weapon),bonus=GameState.greenhouse.weaponBonus||0;Greenhouse.useDropItem('weapon_upgrade_stone');check('强化石进入伤害',Math.abs(g.rollWeaponDamage(g.weapon)/damage-(1+bonus+.1)/(1+bonus))<1e-8);
 GameState.level=19;GameState.cultivation=100000;Math.random=()=>.75;
 const pill=CONFIG.greenhousePlants.find(p=>p.id==='jiuye_lingzhi');GameState.greenhouse.plots[0]={plant:pill,ready:true};Greenhouse.harvest(0);check('修为丹数量范围',GameState.cultivation===100520,{delta:GameState.cultivation-100000});
 g.safeBox=[{type:'farm_item',id:'rare_seed_pack',amount:1,name:'稀有种子包'}];g.bag=[];g.result='failed';const packs=Warehouse.getCount('rare_seed_pack');g.endExpedition();check('死亡安全箱道具到账',Warehouse.getCount('rare_seed_pack')===packs+1);
} finally{Math.random=oldRandom;}
window.extraAuditResults=out;return out;
})()
