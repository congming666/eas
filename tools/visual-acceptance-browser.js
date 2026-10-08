const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
window.visualReview = {
 report: [],
 prep() {
  Game.returnToFarm(); Game.openExpeditionPrep();
  assert(document.querySelectorAll('.prep-column').length === 3, 'prep columns');
  const c=document.querySelector('.prep-content').getBoundingClientRect(), f=document.querySelector('.prep-footer').getBoundingClientRect();
  assert(c.bottom <= f.top + 2, 'footer overlap');
  GameState.loadoutWeaponUids=[]; Game.renderWeaponLoadout(); ExpeditionLayout.summary();
  assert(document.getElementById('startExpeditionBtn').disabled, 'weapon gate');
  this.report.push({test:'prep',pass:true});
 },
 start() { GameState.loadoutWeaponUids=[GameState.weaponInstances[0].uid]; Game.renderWeaponLoadout(); ExpeditionLayout.summary(); Game.startExpedition(); cancelAnimationFrame(Game.animId); this.g=Game.expedition; this.g.paused=false; },
 move(key, n=18) { const g=this.g,x=g.player.x,y=g.player.y; g.keys[key]=true; for(let i=0;i<n;i++)g.update(1/60); g.keys[key]=false; const moved=Math.hypot(g.player.x-x,g.player.y-y); for(let i=0;i<40;i++)g.update(1/60); assert(moved>0 && g.player.moveSpeed<1,'movement'); this.report.push({test:'movement',pass:true,moved}); },
 result() { Game.showResult({success:false,mapName:this.g.map.name,timeUsed:1,kills:0,chests:0,damageTaken:1,goldEarned:0,keptItems:[],lostItems:[],plantGrowth:[]}); assert(!document.querySelector('.result-card').textContent.includes('MVP'),'failed mvp'); this.report.push({test:'result',pass:true}); return this.report; }
};
