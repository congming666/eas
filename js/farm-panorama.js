/* 家园全景：分层手绘几何场景，实时作物覆盖，不依赖外部图片。 */
window.FarmPanorama = {
  draw(c,W,H,t){
    c.save();c.scale(W/900,H/300);
    const winter=GameState.season==='winter',autumn=GameState.season==='autumn';
    const sky=c.createLinearGradient(0,0,0,180);sky.addColorStop(0,'#688d9a');sky.addColorStop(.65,'#d4cbb0');sky.addColorStop(1,'#ece0b9');c.fillStyle=sky;c.fillRect(0,0,900,300);
    const sun=c.createRadialGradient(705,57,8,705,57,80);sun.addColorStop(0,'#fff2c1cc');sun.addColorStop(1,'#fff2c100');c.fillStyle=sun;c.fillRect(620,0,170,140);
    const poly=(pts,color)=>{c.fillStyle=color;c.beginPath();pts.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.closePath();c.fill();};
    for(let layer=0;layer<3;layer++){const pts=[[0,170]];for(let x=0;x<=900;x+=30)pts.push([x,95+layer*30+Math.sin(x*.008+layer*2)*22+Math.sin(x*.021+layer)*9]);pts.push([900,300],[0,300]);poly(pts,['#788f87','#617d67',winter?'#b9c9bf':autumn?'#99915e':'#648257'][layer]);}
    // 草甸的细碎明暗与远处云层。
    for(let i=0;i<700;i++){const x=(i*137.51)%900,y=153+(i*37.13)%147;c.fillStyle=['#e0d09c18','#284b3522','#b7c58128'][i%3];c.fillRect(x,y,2+i%7,1);}
    for(let i=0;i<8;i++){const x=(i*163+Math.sin(t*.025)*8)%980-40,y=25+(i*17)%45;c.fillStyle='#f6edda20';c.beginPath();c.ellipse(x,y,40+i%3*13,6,0,0,7);c.fill();}
    poly([[640,142],[671,143],[701,181],[735,214],[783,245],[800,300],[702,300],[726,251],[695,212],[667,180]],'#669b9e');
    c.strokeStyle='#c0ddd177';c.lineWidth=1;for(let i=0;i<15;i++){const y=166+i*8,x=669+(y-166)*.72+Math.sin(t*.5+i)*3;c.beginPath();c.moveTo(x,y);c.lineTo(x+15+i*.5,y);c.stroke();}
    poly([[460,138],[479,138],[495,188],[552,230],[578,300],[519,300],[507,242],[461,192]],'#b9a57b');
    function tree(x,y,s){c.fillStyle='#293e2c33';c.beginPath();c.ellipse(x+5,y+3,s*18,s*6,0,0,7);c.fill();c.fillStyle='#66533b';c.fillRect(x-2*s,y-27*s,4*s,28*s);for(let j=0;j<3;j++){c.fillStyle=[winter?'#b4c7b7':autumn?'#9d773f':'#3b6243','#4c7150',winter?'#d2ddd0':'#678554'][j];c.beginPath();c.ellipse(x+(j-1)*7*s,y-30*s-j*4*s,15*s,20*s,-.2,0,7);c.fill();}}
    for(let i=0;i<18;i++)tree(i*53,145+Math.sin(i*2)*9,.5+(i%3)*.1);
    function house(x,y,s,roof){c.save();c.translate(x,y);c.scale(s,s);c.fillStyle='#293d283d';c.beginPath();c.ellipse(5,5,64,13,0,0,7);c.fill();poly([[-45,0],[-45,-50],[35,-50],[35,0]],'#d4c4a0');poly([[35,-50],[62,-37],[62,-2],[35,0]],'#a68e68');poly([[-55,-48],[-8,-81],[72,-39],[33,-47]],roof);poly([[-55,-48],[-8,-81],[34,-48]],'#674737');c.strokeStyle='#e6c79a55';for(let i=0;i<5;i++){c.beginPath();c.moveTo(-36+i*12,-52-i*3);c.lineTo(39+i*4,-44+i*2);c.stroke();}c.fillStyle='#594b36';c.fillRect(-7,-28,17,28);for(const x of [-33,17]){c.fillStyle='#edc677';c.fillRect(x,-35,13,16);c.strokeStyle='#7e7657';c.strokeRect(x,-35,13,16);c.beginPath();c.moveTo(x+6,-35);c.lineTo(x+6,-19);c.stroke();}c.fillStyle='#796550';c.fillRect(31,-75,10,20);
      c.strokeStyle='#8a795938';for(let j=0;j<5;j++){c.beginPath();c.moveTo(-43,-43+j*9);c.lineTo(33,-43+j*9);c.stroke();}
      c.fillStyle='#73905a';for(const wx of [-33,17]){c.fillRect(wx-2,-16,17,4);for(let i=0;i<4;i++){c.fillStyle=i%2?'#d8b681':'#a77b79';c.beginPath();c.arc(wx+i*4,-18,2,0,7);c.fill();}}
      c.fillStyle='#c2b18c';c.fillRect(-11,0,26,4);c.fillStyle='#7c6952';c.fillRect(29,-77,14,4);
      c.restore();}
    house(445,151,1,'#8b5f47');house(184,173,.72,'#667b73');
    // 温室玻璃顶。
    poly([[535,168],[535,137],[565,116],[608,138],[608,170]],'#8eb4a780');poly([[535,137],[565,116],[608,138],[578,147]],'#c2d7c066');c.strokeStyle='#d5d2aa';for(let i=0;i<4;i++){c.beginPath();c.moveTo(538+i*21,168);c.lineTo(538+i*21,138);c.stroke();}
    const plots=GameState.farmPlots||[],n=Math.min(GameState.unlockedPlots||16,plots.length),cols=8,rows=Math.ceil(n/cols);
    for(let i=0;i<n;i++){const row=Math.floor(i/cols),col=i%cols,s=.72+row*.09,x=110+col*49+row*9,y=190+row*17;
      poly([[x,y],[x+37*s,y-4],[x+43*s,y+9],[x+4,y+13]],'#5c4731');c.strokeStyle='#a5865c66';c.lineWidth=1;for(let k=0;k<4;k++){c.beginPath();c.moveTo(x+6+k*7*s,y+1);c.lineTo(x+9+k*7*s,y+10);c.stroke();}
      const p=plots[i];if(p?.crop){const sway=Math.sin(t*1.3+i)*1.4;for(let k=0;k<3;k++){const px=x+10+k*10*s,py=y+5;c.strokeStyle=p.ready?'#d7bc68':'#749b51';c.beginPath();c.moveTo(px,py);c.lineTo(px+sway,py-(p.ready?15:9)*s);c.stroke();c.fillStyle=p.crop.rewardType==='oil'?'#d9c980':p.ready?'#e6c36d':'#95b465';c.beginPath();c.ellipse(px+sway,py-10*s,3*s,5*s,.5,0,7);c.fill();}if(p.ready){c.fillStyle='#f7df9144';c.beginPath();c.ellipse(x+23,y+4,24,10,0,0,7);c.fill();}}}
    // 河岸石块、木桥与花圃，形成可辨识的空间层次。
    for(let i=0;i<32;i++){const y=166+i*4,x=652+(y-166)*.77+(i%2?43:-3);c.fillStyle=['#839083','#b4b09a','#6c7b71'][i%3];c.beginPath();c.ellipse(x,y,3+i%3,2+i%2,.3,0,7);c.fill();}
    poly([[683,209],[729,194],[739,206],[695,224]],'#70573c');c.strokeStyle='#c1a775';for(let i=0;i<8;i++){c.beginPath();c.moveTo(684+i*6,209-i*2);c.lineTo(696+i*6,222-i*2);c.stroke();}
    for(let i=0;i<48;i++){const x=310+(i*29)%92,y=147+(i*13)%22;c.fillStyle=['#e6c183','#cba1a0','#d5d7ac'][i%3];c.beginPath();c.arc(x,y,1.4,0,7);c.fill();}
    // 前景栅栏与花草。
    c.strokeStyle='#ae9770';c.lineWidth=3;c.beginPath();c.moveTo(55,271);c.lineTo(485,289);c.stroke();for(let x=60;x<490;x+=31){const y=271+(x-55)*.042;c.fillStyle='#c0a577';c.fillRect(x,y-10,4,21);}
    for(let i=0;i<90;i++){const x=(i*127)%900,y=270+(i*17)%30;c.strokeStyle=['#526d40','#829356','#bcaf74'][i%3];c.lineWidth=1;c.beginPath();c.moveTo(x,y);c.lineTo(x+Math.sin(t+i)*2,y-4-i%5);c.stroke();}
    tree(43,254,1.35);tree(835,243,1.5);tree(882,275,1.8);
    const weather=GameState.farmWeather?.state||GameState.weather;
    if(['rain','heavy_rain','storm'].includes(weather)){c.fillStyle='#263d5528';c.fillRect(0,0,900,300);c.strokeStyle='#d8e8ee66';for(let i=0;i<65;i++){const x=(i*113+t*95)%900,y=(i*57+t*160)%300;c.beginPath();c.moveTo(x,y);c.lineTo(x-3,y+10);c.stroke();}}
    if(weather==='fog'){const fog=c.createLinearGradient(0,85,0,250);fog.addColorStop(0,'#d7e0dc00');fog.addColorStop(.6,'#d7e0dc66');fog.addColorStop(1,'#d7e0dc00');c.fillStyle=fog;c.fillRect(0,85,900,165);}
    (GameState.decorations||[]).slice(0,5).forEach((d,i)=>{c.font='18px serif';c.fillText(d.icon||'✿',540+i*25,225+i%2*8);});
    c.restore();
  }
};
