/* 首页星空：独立 Canvas2D，鼠标彩色流星；不参与游戏状态。 */
(() => {
  'use strict';
  const init = () => {
    const menu = document.getElementById('mainMenu');
    if (!menu || document.getElementById('titleStarfield')) return;
    const canvas = document.createElement('canvas');
    canvas.id = 'titleStarfield'; canvas.setAttribute('aria-hidden', 'true'); menu.prepend(canvas);
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    const palettes = [[177,294,330],[184,212,260],[28,43,349],[310,268,195],[130,168,48]];
    let w=0,h=0,stars=[],bursts=[],meteors=[],pointer=null,lastBurst=0,lastTrail=0,last=0,raf=0,nextMeteor=0;
    let dust=document.createElement('canvas'), disabled=false;
    const rand=(a,b)=>a+Math.random()*(b-a);
    const visible=()=>!menu.classList.contains('hidden')&&!document.hidden;
    const reduced=()=>reduce.matches||document.body.classList.contains('title-reduced-motion');
    function resize(){
      const r=menu.getBoundingClientRect(); w=r.width;h=r.height;if(!w||!h)return;
      const dpr=Math.min(devicePixelRatio||1,1.5); canvas.width=w*dpr;canvas.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);
      stars=Array.from({length:Math.min(650,Math.floor(w*h/1600))},()=>({x:Math.random()*w,y:Math.random()*h,r:rand(.4,1.65),p:rand(0,6.28),z:rand(.2,1)}));
      dust.width=w;dust.height=h;const dc=dust.getContext('2d');dc.clearRect(0,0,w,h);
      for(let i=0;i<80;i++){
        const t=i/79,x=t*w,y=h*(.79-.68*t)+Math.sin(t*9)*h*.07,r=rand(35,130);
        const grad=dc.createRadialGradient(x,y,0,x,y,r);const hue=195+Math.sin(t*5)*65;
        grad.addColorStop(0,`hsla(${hue},65%,55%,.045)`);grad.addColorStop(1,`hsla(${hue},65%,25%,0)`);dc.fillStyle=grad;dc.fillRect(x-r,y-r,r*2,r*2);
      }
      for(let i=0;i<2400;i++){const t=Math.random(),x=t*w,y=h*(.79-.68*t)+Math.sin(t*9)*h*.07+rand(-1,1)*rand(0,h*.15);dc.fillStyle=`rgba(166,204,238,${rand(.05,.35)})`;dc.fillRect(x,y,rand(.4,1.3),rand(.4,1.3));}
      draw(performance.now(),0);
    }
    function burst(x,y,large=false){
      const colors=palettes[Math.floor(Math.random()*palettes.length)],count=w<600?24:42;
      for(let i=0;i<count;i++){const a=rand(0,Math.PI*2),v=rand(35,large?270:190);bursts.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,life:rand(.6,1.5),max:1.5,hue:colors[i%colors.length],r:rand(.8,2.5)});}
      if(bursts.length>300)bursts.splice(0,bursts.length-300);
      // 从鼠标位置射出带长尾的颜料流星。
      for(let i=0;i<3;i++){const a=rand(-Math.PI,Math.PI);meteors.push({x,y,vx:Math.cos(a)*rand(150,320),vy:Math.sin(a)*rand(150,320),life:1.1,max:1.1,hue:colors[i%colors.length]});}
      if(meteors.length>18)meteors.splice(0,meteors.length-18);
    }
    function draw(now,dt){
      ctx.clearRect(0,0,w,h);ctx.drawImage(dust,0,0,w,h);
      const px=pointer?(pointer.x/w-.5)*12:0,py=pointer?(pointer.y/h-.5)*8:0;
      for(const s of stars){const x=s.x+px*s.z,y=s.y+py*s.z;ctx.globalAlpha=reduced()?.6:.4+.5*(.5+.5*Math.sin(now*.0007+s.p));ctx.fillStyle='#d5e8f5';ctx.beginPath();ctx.arc(x,y,s.r,0,Math.PI*2);ctx.fill();if(s.r>1.5){ctx.globalAlpha*=.35;ctx.fillRect(x-4,y-.35,8,.7);ctx.fillRect(x-.35,y-4,.7,8);}}
      ctx.globalAlpha=1;
      if(!reduced()){
        ctx.globalCompositeOperation='lighter';
        for(const m of meteors){m.life-=dt;m.x+=m.vx*dt;m.y+=m.vy*dt;const alpha=Math.max(0,m.life/m.max),tx=m.x-m.vx*.24,ty=m.y-m.vy*.24;const g=ctx.createLinearGradient(tx,ty,m.x,m.y);g.addColorStop(0,`hsla(${m.hue},95%,65%,0)`);g.addColorStop(1,`hsla(${m.hue},95%,78%,${alpha})`);ctx.strokeStyle=g;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(tx,ty);ctx.lineTo(m.x,m.y);ctx.stroke();ctx.fillStyle=`hsla(${m.hue},90%,90%,${alpha})`;ctx.beginPath();ctx.arc(m.x,m.y,2,0,7);ctx.fill();}
        for(const p of bursts){p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=Math.exp(-dt*1.6);p.vy=p.vy*Math.exp(-dt*1.6)+dt*15;const a=Math.max(0,p.life/p.max);ctx.strokeStyle=`hsla(${p.hue},95%,66%,${a*.75})`;ctx.lineWidth=p.r;ctx.beginPath();ctx.moveTo(p.x-p.vx*.05,p.y-p.vy*.05);ctx.lineTo(p.x,p.y);ctx.stroke();ctx.fillStyle=`hsla(${p.hue},90%,75%,${a*.3})`;ctx.beginPath();ctx.arc(p.x,p.y,p.r*3,0,7);ctx.fill();}
        meteors=meteors.filter(m=>m.life>0);bursts=bursts.filter(p=>p.life>0);
        ctx.globalCompositeOperation='source-over';
        if(pointer){const g=ctx.createRadialGradient(pointer.x,pointer.y,0,pointer.x,pointer.y,80);g.addColorStop(0,'rgba(102,199,237,.09)');g.addColorStop(1,'rgba(102,199,237,0)');ctx.fillStyle=g;ctx.fillRect(pointer.x-80,pointer.y-80,160,160);}
      }
      canvas.dataset.particles=bursts.length;canvas.dataset.meteors=meteors.length;
    }
    function frame(now){raf=0;if(!visible())return;const dt=Math.min((now-last)/1000,.04);last=now;
      if(!reduced()&&now>nextMeteor){nextMeteor=now+rand(1800,3800);meteors.push({x:rand(0,w*.85),y:rand(0,h*.3),vx:rand(190,310),vy:rand(90,160),life:1.5,max:1.5,hue:rand(185,260)});}
      draw(now,dt);if(!reduced())raf=requestAnimationFrame(frame);
    }
    function sync(){if(raf)cancelAnimationFrame(raf);raf=0;pointer=null;bursts=[];meteors=[];last=performance.now();if(visible()){resize();raf=requestAnimationFrame(frame);}}
    menu.addEventListener('pointermove',e=>{
      if(!visible()||reduced()||e.pointerType==='touch')return;
      const r=menu.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,now=performance.now();
      const moved=!pointer||Math.hypot(x-pointer.x,y-pointer.y)>3;pointer={x,y};
      if(e.target.closest('button,summary,input,.title-settings'))return;
      if(moved&&now-lastTrail>24){lastTrail=now;bursts.push({x,y,vx:rand(-22,22),vy:rand(-22,22),life:.65,max:.65,hue:now*.08%360,r:1.7});if(bursts.length>300)bursts.shift();}
      if(moved&&now-lastBurst>320){lastBurst=now;burst(x,y);}
    },{passive:true});
    menu.addEventListener('pointerdown',e=>{if(reduced()||e.target.closest('button,summary,input,.title-settings'))return;const r=menu.getBoundingClientRect(),now=performance.now();if(now-lastBurst<160)return;lastBurst=now;burst(e.clientX-r.left,e.clientY-r.top,true);},{passive:true});
    menu.addEventListener('pointerleave',()=>{pointer=null;});
    new MutationObserver(sync).observe(menu,{attributes:true,attributeFilter:['class']});
    new MutationObserver(sync).observe(document.body,{attributes:true,attributeFilter:['class']});
    document.addEventListener('visibilitychange',sync);reduce.addEventListener('change',sync);
    let timer;window.addEventListener('resize',()=>{clearTimeout(timer);timer=setTimeout(sync,100);});sync();
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
