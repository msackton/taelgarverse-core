// Shared source-local sketch geometry. This module needs no DOM or game state.
export const drawingPaths=drawing=>[drawing.points,...drawing.segments??[]];
const distance=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,n=dx*dx+dy*dy,t=n?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/n)):0;return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};
const inside=(p,polygon)=>{let result=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)result=!result;}return result;};
export function hitDrawing(drawings,p,tolerance){return [...drawings].reverse().find(d=>d.closed&&inside(p,d.points)||drawingPaths(d).some(path=>{const line=d.closed?[...path,path[0]]:path;return line.some((b,i)=>i>0&&distance(p,line[i-1],b)<=tolerance+d.width/2);}))?.id;}
export function drawingsInBox(drawings,box){
  const contains=p=>p.x>=box.x&&p.x<=box.x+box.width&&p.y>=box.y&&p.y<=box.y+box.height;
  const crosses=(a,b)=>{let low=0,high=1;for(const [value,delta,min,max] of [[a.x,b.x-a.x,box.x,box.x+box.width],[a.y,b.y-a.y,box.y,box.y+box.height]]){if(Math.abs(delta)<1e-12){if(value<min||value>max)return false;continue;}const from=(min-value)/delta,to=(max-value)/delta;low=Math.max(low,Math.min(from,to));high=Math.min(high,Math.max(from,to));if(low>high)return false;}return true;};
  return drawings.filter(d=>d.closed&&inside({x:box.x,y:box.y},d.points)||drawingPaths(d).some(path=>{const line=d.closed?[...path,path[0]]:path;return line.some((p,i)=>contains(p)||i>0&&crosses(line[i-1],p));})).map(d=>d.id);
}
export const eraserRadius=(speed,previous=10)=>Math.max(10,Math.min(42,previous*.55+(10+Math.min(1,Math.max(0,speed)/1.5)*32)*.45));
const dot=(a,b)=>a.x*b.x+a.y*b.y,sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
const clip=(v,s,lo,hi)=>{if(Math.abs(s)<1e-10)return v>=lo&&v<=hi?[0,1]:null;const a=(lo-v)/s,b=(hi-v)/s,start=Math.max(0,Math.min(a,b)),end=Math.min(1,Math.max(a,b));return start<=end?[start,end]:null;};
function circle(a,delta,center,radius){const offset=sub(a,center),aa=dot(delta,delta),bb=2*dot(offset,delta),cc=dot(offset,offset)-radius*radius;if(aa<1e-10)return cc<=0?[0,1]:null;const disc=bb*bb-4*aa*cc;if(disc<0)return null;const start=Math.max(0,(-bb-Math.sqrt(disc))/(2*aa)),end=Math.min(1,(-bb+Math.sqrt(disc))/(2*aa));return start<=end?[start,end]:null;}
function capsule(a,b,c,d,radius){
  if(Math.max(a.x,b.x)<Math.min(c.x,d.x)-radius||Math.min(a.x,b.x)>Math.max(c.x,d.x)+radius||Math.max(a.y,b.y)<Math.min(c.y,d.y)-radius||Math.min(a.y,b.y)>Math.max(c.y,d.y)+radius)return [];
  const delta=sub(b,a),axis=sub(d,c),offset=sub(a,c),length=dot(axis,axis),result=[circle(a,delta,c,radius),circle(a,delta,d,radius)].filter(Boolean);
  if(length>1e-10){const along=clip(dot(offset,axis)/length,dot(delta,axis)/length,0,1),cross=p=>(axis.x*p.y-axis.y*p.x)/Math.sqrt(length),across=clip(cross(offset),cross(delta),-radius,radius);if(along&&across){const start=Math.max(along[0],across[0]),end=Math.min(along[1],across[1]);if(start<=end)result.push([start,end]);}}
  return result;
}
const same=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)<.001;
export function eraseDrawings(drawings,trail){
  if(!trail.length)return drawings;
  return drawings.flatMap(drawing=>{
    if(drawing.closed&&trail.some(p=>inside(p,drawing.points)))return [];
    const fragments=[];let changed=false;
    for(const original of drawingPaths(drawing)){
      const path=drawing.closed?[...original,original[0]]:original;let fragment=[];
      const finish=()=>{if(fragment.length>=2)fragments.push(fragment);fragment=[];};
      for(let i=1;i<path.length;i++){
        const a=path[i-1],b=path[i],cuts=[];
        for(let j=0;j<trail.length;j++){const previous=trail[Math.max(0,j-1)],next=trail[j];cuts.push(...capsule(a,b,previous,next,Math.max(previous.radius,next.radius)));}
        cuts.sort((a,b)=>a[0]-b[0]);const merged=[];
        for(const cut of cuts){const last=merged.at(-1);if(last&&cut[0]<=last[1])last[1]=Math.max(last[1],cut[1]);else merged.push([...cut]);}
        const at=t=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
        const keep=(start,end)=>{if(end-start<1e-8)return;const from=at(start),to=at(end);if(same(from,to))return;if(fragment.length&&!same(fragment.at(-1),from))finish();if(!fragment.length)fragment.push(from);fragment.push(to);};
        let cursor=0;for(const [start,end] of merged){if(end-start<1e-8)continue;changed=true;keep(cursor,start);finish();cursor=Math.max(cursor,end);}keep(cursor,1);
      }
      finish();
    }
    if(!changed)return [drawing];
    if(drawing.closed||!fragments.length)return [];
    return [{...drawing,points:fragments[0],segments:fragments.slice(1)}];
  });
}
export function applySketchCommand(drawings,command){
  switch(command.type){
    case 'addDrawing':return drawings.some(d=>d.id===command.drawing.id)?drawings:[...drawings,command.drawing];
    case 'removeDrawings':{const ids=new Set(command.ids);return drawings.filter(d=>!ids.has(d.id));}
    case 'eraseDrawings':return eraseDrawings(drawings,command.trail);
    case 'clearDrawings':return [];
    case 'patchDrawings':return patchDrawings(drawings,command.patches);
    default:throw new Error('Unknown sketch command');
  }
}

export function sameDrawing(a,b){
  if(a===b)return true;if(!a||!b||a.id!==b.id||a.color!==b.color||a.width!==b.width||a.closed!==b.closed)return false;
  const aa=drawingPaths(a),bb=drawingPaths(b);return aa.length===bb.length&&aa.every((path,i)=>path.length===bb[i].length&&path.every((p,j)=>Math.abs(p.x-bb[i][j].x)<=1e-7&&Math.abs(p.y-bb[i][j].y)<=1e-7));
}
export function sketchChanges(before,after){
  const a=new Map(before.map((d,index)=>[d.id,{drawing:d,index}])),b=new Map(after.map((d,index)=>[d.id,{drawing:d,index}]));
  return [...new Set([...a.keys(),...b.keys()])].flatMap(id=>sameDrawing(a.get(id)?.drawing,b.get(id)?.drawing)?[]:[{id,before:a.get(id)?.drawing??null,after:b.get(id)?.drawing??null,beforeIndex:a.get(id)?.index??0,afterIndex:b.get(id)?.index??0}]);
}
export const sketchHistoryCommand=(changes,undo)=>({type:'patchDrawings',patches:changes.map(change=>({id:change.id,expected:undo?change.after:change.before,drawing:undo?change.before:change.after,index:undo?change.beforeIndex:change.afterIndex}))});
export function canPatchDrawings(drawings,patches){const current=new Map(drawings.map(d=>[d.id,d]));return patches.every(p=>sameDrawing(current.get(p.id)??null,p.expected)||sameDrawing(current.get(p.id)??null,p.drawing));}
export function patchDrawings(drawings,patches,{strict=false}={}){
  if(!canPatchDrawings(drawings,patches)){if(strict)throw new Error('A drawing changed since this edit. Undo or redo is no longer available.');return drawings;}
  const current=new Map(drawings.map(d=>[d.id,d]));if(patches.every(p=>sameDrawing(current.get(p.id)??null,p.drawing)))return drawings;
  const ids=new Set(patches.map(p=>p.id)),result=drawings.filter(d=>!ids.has(d.id));
  for(const patch of patches.filter(p=>p.drawing).sort((a,b)=>a.index-b.index))result.splice(Math.min(patch.index,result.length),0,patch.drawing);
  return result;
}
