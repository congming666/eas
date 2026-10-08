(()=>{
const g=Game.expedition,results=[];cancelAnimationFrame(Game.animId);g.paused=false;
const check=(name,ok,data)=>{results.push({name,pass:!!ok,data});if(!ok)throw Error(name+JSON.stringify(data));};
check('opening',g.monsters.length<=4&&!g.monsters.some(m=>m.elite),g.monsters.length);
g.offerCapture('chest');check('early choice blocked',!g.choiceOpen);
for(const r of g.terrainRegions)check('region '+r.type,g.getTerrainAt(r.x,r.y).id===r.type);
const water=g.terrainRegions.find(r=>r.type==='water'),forest=g.terrainRegions.find(r=>r.type==='forest'),high=g.terrainRegions.find(r=>r.type==='highland');
check('electric water',g.terrainElementMultiplier(water,{element:'lightning'})===1.35);
check('fire water',g.terrainElementMultiplier(water,{element:'fire'})===.7);
const target={x:water.x,y:water.y,hp:100,burn:{time:3}};g.updateBurn(target,.1);check('extinguish',!target.burn);
g.player.x=forest.x;g.player.y=forest.y;g.elapsed=130;g.lastTerrainAttackAt=0;check('forest loses aggro',!g.terrainCanDetect({},150));
g.lastTerrainAttackAt=130;check('forest firing reveals',g.terrainCanDetect({},150));
const rock=g.obstacles.find(o=>o.type==='rock');check('swept projectile',g.terrainBlocksProjectile(rock.x-100,rock.y,rock.x+100,rock.y,3));
g.player.x=high.x;g.player.y=high.y;g.player.attackCd=0;g.projectiles=[];g.playerAttack();const p=g.projectiles[0];check('highland range',Math.abs(p.life*Math.hypot(p.vx,p.vy)-g.weapon.range*(1+(g.weapon.rangeBonus||0))*1.15)<.01);
g.elapsed=120;g.updateTerrainJourney(.01);check('build phase',g.buildUnlocked&&g.phaseLabel==='形成构筑');
g.elapsed=360;g.updateTerrainJourney(.01);check('risk phase',!g.bossSpawned&&g.phaseLabel==='风险兑现');WeatherSystem.updateExpedition(g,.01);check('storm warning',g.weather.next==='storm');
g.elapsed=368;g.updateTerrainJourney(.01);check('boss after warning',g.bossSpawned);
g.player.x=water.x-160;g.player.y=water.y;g.camera.x=g.player.x-640;g.camera.y=g.player.y-360;g.fogDirty=true;g.updateHUD();g.render(document.getElementById("gameCanvas").getContext("2d"));
window.terrainResults=results;return results;
})()
