(()=>{const g=Game.expedition, out=[];
for(const id of ['grass','water','mud']){const r=g.terrainRegions.find(r=>r.type===id)||{x:400,y:350};g.player.x=r.x;g.player.y=r.y;g.player.vx=0;g.player.vy=0;g.player.slow=0;g.keys={d:true};for(let i=0;i<30;i++)g.updatePlayer(1/60);out.push({id,speed:g.player.moveSpeed});}g.keys={};
if(!(out[1].speed<out[2].speed&&out[2].speed<out[0].speed))throw Error('speed');
const rock=g.obstacles.find(o=>o.type==='rock');g.projectiles=[{x:rock.x-60,y:rock.y,vx:1200,vy:0,life:1,radius:3,fromPlayer:true,hit:[],damage:10,pierce:1}];g.updateProjectiles(.1);if(g.projectiles.length)throw Error('projectile wall');
g.elapsed=360;g.beastWave.nextIn=0;g.updateWorldSystems(.016);if(!g.beastWave.wave)throw Error('wave');
const high=g.terrainRegions.find(r=>r.type==='highland');g.player.x=high.x;g.player.y=high.y;g.camera.x=high.x-640;g.camera.y=high.y-280;g.fogDirty=true;g.updateTerrainJourney(.01);g.renderMissionHUD();g.timeLeft=720-g.elapsed;g.updateHUD();g.render(document.getElementById('gameCanvas').getContext('2d'));return {movement:out,projectileBlocked:true,wave:g.beastWave.wave,observation:g.extractionIntel};})()
