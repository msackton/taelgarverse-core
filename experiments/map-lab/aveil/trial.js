const svg=document.querySelector('#map svg');
const placeData=JSON.parse(document.querySelector('#places-data').textContent);
const mapPanel=document.querySelector('#map');
let box=[0,0,1125,1800];
let selected=-1;
const pointers=new Map();
const modes={study:document.querySelector('#study-layer'),reference:document.querySelector('#reference-layer')};
function setBox(next){
  const w=Math.max(140,Math.min(4500,next[2])),h=w*1800/1125;
  box=[Math.max(-w+80,Math.min(1045,next[0])),Math.max(-h+80,Math.min(1720,next[1])),w,h];
  svg.setAttribute('viewBox',box.join(' '));
  document.querySelector('#zoom-level').textContent=(1125/w).toFixed(1)+'×';
}
function local(x,y){return new DOMPoint(x,y).matrixTransform(svg.getScreenCTM().inverse());}
function zoom(factor,anchor){
  anchor=anchor||{x:box[0]+box[2]/2,y:box[1]+box[3]/2};
  const w=Math.max(140,Math.min(4500,box[2]*factor)),f=w/box[2];
  setBox([anchor.x+(box[0]-anchor.x)*f,anchor.y+(box[1]-anchor.y)*f,w,box[3]*f]);
}
function fit(){setBox([0,0,1125,1800]);}
document.querySelector('#fit').onclick=fit;
document.querySelector('#plus').onclick=()=>zoom(.75);
document.querySelector('#minus').onclick=()=>zoom(1/.75);
document.querySelector('#woodland').onclick=()=>setBox([-40,220,640,1024]);
document.querySelector('#aslain').onclick=()=>setBox([550,570,520,832]);
document.querySelector('#reference').onchange=e=>{
  modes.study.style.display=e.target.checked?'none':'';
  modes.reference.style.display=e.target.checked?'':'none';
  // Keep clickable markers, suppress duplicate labels over the original map.
  svg.classList.toggle('reference',e.target.checked);
};
document.querySelector('#towns').onchange=e=>{
  svg.querySelectorAll('a[data-place]').forEach(a=>a.style.display=e.target.checked?'':'none');
};
mapPanel.addEventListener('wheel',e=>{
  e.preventDefault();zoom(Math.exp(Math.max(-.3,Math.min(.3,e.deltaY*.0015))),local(e.clientX,e.clientY));
},{passive:false});
svg.addEventListener('pointerdown',e=>{
  if(e.button!==0||e.target.closest('a'))return;
  pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});svg.setPointerCapture(e.pointerId);
});
svg.addEventListener('pointermove',e=>{
  if(!pointers.has(e.pointerId))return;
  const before=[...pointers.values()];
  const previous=pointers.get(e.pointerId);
  pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pointers.size===2){
    const after=[...pointers.values()];
    const distance=ps=>Math.hypot(ps[0].x-ps[1].x,ps[0].y-ps[1].y);
    const oldDistance=distance(before),newDistance=distance(after);
    const oldMid=local((before[0].x+before[1].x)/2,(before[0].y+before[1].y)/2);
    if(newDistance>1&&oldDistance>1)zoom(oldDistance/newDistance,oldMid);
    const newMid=local((after[0].x+after[1].x)/2,(after[0].y+after[1].y)/2);
    setBox([box[0]+oldMid.x-newMid.x,box[1]+oldMid.y-newMid.y,box[2],box[3]]);
  }else if(pointers.size===1){
    const a=local(previous.x,previous.y),b=local(e.clientX,e.clientY);
    setBox([box[0]+a.x-b.x,box[1]+a.y-b.y,box[2],box[3]]);
  }
});
for(const event of ['pointerup','pointercancel','lostpointercapture'])svg.addEventListener(event,e=>pointers.delete(e.pointerId));
mapPanel.addEventListener('keydown',e=>{
  const step=box[2]*.08;
  const offsets={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]};
  if(offsets[e.key]){e.preventDefault();setBox([box[0]+offsets[e.key][0],box[1]+offsets[e.key][1],box[2],box[3]]);}
  if(['+','=','-','0'].includes(e.key)){e.preventDefault();e.key==='0'?fit():zoom(e.key==='-'?1/.75:.75);}
});
function select(index){
  selected=index;
  const place=placeData[index];
  document.querySelector('#selection-title').textContent=place.name;
  document.querySelector('#selection-copy').textContent='Position sampled from the Aveil reference map.';
  const link=document.querySelector('#open-note');
  const vault=document.querySelector('#vault-name').value.trim()||'taelgar';
  link.href='obsidian://open?vault='+encodeURIComponent(vault)+'&file='+encodeURIComponent(place.note);
  link.hidden=false;
  document.querySelectorAll('[data-town-button]').forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));
  svg.querySelectorAll('a[data-place]').forEach((a,i)=>a.classList.toggle('selected',i===index));
}
svg.querySelectorAll('a[data-place]').forEach((a,i)=>{
  a.addEventListener('click',e=>{e.preventDefault();select(i);});
  a.setAttribute('tabindex','0');a.setAttribute('aria-label','Select '+placeData[i].name);
  a.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select(i);}});
});
document.querySelectorAll('[data-town-button]').forEach((button,i)=>button.onclick=()=>{
  select(i);const [x,y]=placeData[i].reference_xy;const px=x*1125/1280,py=y*1800/2048;
  setBox([px-300,py-480,600,960]);
});
document.querySelector('#vault-name').oninput=()=>{if(selected>=0)select(selected);};
setBox(box);
