/* 首页读取存档摘要；进入游戏仍由 Game / SaveSystem 负责。 */
window.TitleEntry = {
  refresh(){
    const label=document.getElementById('titleStartLabel'),summary=document.getElementById('titleSaveSummary');
    if(!label||!summary)return;
    let save=null;try{save=JSON.parse(localStorage.getItem(SaveSystem.key)||'null');}catch(_){}
    label.textContent=save?'继续游戏':'开始游戏';
    summary.hidden=!save;
    if(save){const map=CONFIG.maps.find(m=>m.id===save.selectedMap);summary.textContent=`旅程记录 · Lv.${Math.max(1,Number(save.level)||1)}${map?' · '+map.name:''}`;}
  },
  start(){
    if(this._starting)return;this._starting=true;
    Game.startGame();
    const farm=document.getElementById('farmScreen');
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches&&!document.body.classList.contains('title-reduced-motion'))farm.animate([{opacity:.35},{opacity:1}],{duration:450,easing:'ease-out'});
    this._starting=false;
  }
};
(() => {
  function init(){
    const menu=document.getElementById('mainMenu');TitleEntry.refresh();
    new MutationObserver(()=>{if(!menu.classList.contains('hidden'))TitleEntry.refresh();}).observe(menu,{attributes:true,attributeFilter:['class']});
    let queued=false,x=0,y=0;
    menu.addEventListener('pointermove',e=>{
      if(e.pointerType==='touch'||document.body.classList.contains('title-reduced-motion')||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
      const r=menu.getBoundingClientRect();x=(e.clientX-r.left-r.width/2)/r.width*10;y=(e.clientY-r.top-r.height/2)/r.height*5;
      if(!queued){queued=true;requestAnimationFrame(()=>{menu.style.setProperty('--scene-x',x+'px');menu.style.setProperty('--scene-y',y+'px');queued=false;});}
    },{passive:true});
    menu.addEventListener('pointerleave',()=>{menu.style.setProperty('--scene-x','0px');menu.style.setProperty('--scene-y','0px');});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
