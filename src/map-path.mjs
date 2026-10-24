// Point clicks extend the current route. Each freehand stroke starts a separate
// route so lifting the pointer never invents an untraced connecting segment.
import {isClosedRoute} from './map-distance.mjs';

export function measurementRoutes(actions,stroke) {
  const routes=[];
  for(const action of [...actions,...(stroke?[{kind:'stroke',points:stroke}]:[])]){
    if(action.kind==='close' && routes.length)routes[routes.length-1]=[...action.points];
    else if(action.kind==='stroke' || !routes.length || isClosedRoute(routes.at(-1)))routes.push([...action.points]);
    else routes.at(-1).push(...action.points);
  }
  return routes;
}

// Prefer the area centroid. For concave shapes whose centroid falls outside,
// use the middle of the widest interior span on a central scanline instead.
export function shapeLabelPoint(points){
  const origin=points[0],ring=points.slice(0,-1).map(p=>({x:p.lng-origin.lng,y:p.lat-origin.lat}));
  let twice=0,x=0,y=0;
  for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length],cross=a.x*b.y-b.x*a.y;
    twice+=cross;x+=(a.x+b.x)*cross;y+=(a.y+b.y)*cross;
  }
  const center={x:x/(3*twice),y:y/(3*twice)};
  const crossings=y=>{
    const xs=[];
    for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length];
      if((a.y>y)!==(b.y>y))xs.push(a.x+(y-a.y)/(b.y-a.y)*(b.x-a.x));
    }
    return xs.sort((a,b)=>a-b);
  };
  const xs=crossings(center.y);
  if(Number.isFinite(center.x) && xs.filter(x=>x>center.x).length%2===1)return {lng:center.x+origin.lng,lat:center.y+origin.lat};
  const [minY,maxY]=ring.reduce(([lo,hi],p)=>[Math.min(lo,p.y),Math.max(hi,p.y)],[Infinity,-Infinity]);
  const middle=(minY+maxY)/2,spans=crossings(middle);
  let widest=0;
  for(let i=2;i<spans.length;i+=2)if(spans[i+1]-spans[i]>spans[widest+1]-spans[widest])widest=i;
  return spans.length?{lng:(spans[widest]+spans[widest+1])/2+origin.lng,lat:middle+origin.lat}:origin;
}

// Automatic measurement snapping trims only tiny loops. Explicit closure and
// sketching can also discard larger accidental lobes, keeping the larger region.
// The returned ring is what we draw and measure, so the fill matches its edge.
export function repairClosedRoute(points,project,{tolerance=6,forgiving=false}={}) {
  if(!isClosedRoute(points) || (!project && !forgiving))return points;
  project ||= point=>({x:point.lng,y:point.lat});
  const same=(a,b)=>a.lat===b.lat && a.lng===b.lng;
  const compact=ring=>ring.filter((point,i)=>!i || !same(point,ring[i-1]));
  let ring=compact(points);
  const cross=(a,b)=>a.x*b.y-a.y*b.x;
  const delta=(a,b)=>({x:b.x-a.x,y:b.y-a.y});
  const area=vertices=>{
    const first=vertices[0];let twice=0;
    for(let i=1;i<vertices.length;i++)twice+=(vertices[i-1].lng-first.lng)*(vertices[i].lat-first.lat)-(vertices[i].lng-first.lng)*(vertices[i-1].lat-first.lat);
    return Math.abs(twice);
  };
  function intersection(a,b,c,d,adjacent){
    const ab=delta(a,b),cd=delta(c,d),ac=delta(a,c),den=cross(ab,cd);
    if(den!==0){
      const t=cross(ac,cd)/den,u=cross(ac,ab)/den;
      return t>=0 && t<=1 && u>=0 && u<=1 && !adjacent?t:null;
    }
    if(cross(ac,ab)!==0)return null;
    const length=ab.x*ab.x+ab.y*ab.y;
    if(!length)return null;
    const t=p=>((p.x-a.x)*ab.x+(p.y-a.y)*ab.y)/length;
    const lo=Math.max(0,Math.min(t(c),t(d))),hi=Math.min(1,Math.max(t(c),t(d)));
    // Adjacent segments may share a vertex, but must not double back over an edge.
    const startsHere=(c.x===a.x && c.y===a.y) || (d.x===a.x && d.y===a.y);
    return lo<=hi && (!adjacent || hi>lo)?(startsHere?hi:lo):null;
  }
  function trim(){
    const screen=ring.map(project),perimeter=screen.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-screen[i].x,p.y-screen[i].y),0);
    // Leaflet rounds container points to pixels. Intersect in original map
    // coordinates so dense samples do not acquire artificial crossings.
    const origin=ring[0],coords=ring.map(point=>({x:point.lng-origin.lng,y:point.lat-origin.lat}));
    const segments=coords.slice(0,-1).map((a,i)=>{
      const b=coords[i+1];return {i,minX:Math.min(a.x,b.x),maxX:Math.max(a.x,b.x),minY:Math.min(a.y,b.y),maxY:Math.max(a.y,b.y)};
    }).sort((a,b)=>a.minX-b.minX);
    let active=[];
    for(const segment of segments){
      active=active.filter(other=>other.maxX>=segment.minX);
      for(const other of active){
        if(other.maxY<segment.minY || other.minY>segment.maxY)continue;
        const i=Math.min(segment.i,other.i),j=Math.max(segment.i,other.i);
        const t=intersection(coords[i],coords[i+1],coords[j],coords[j+1],j-i===1 || j-i===ring.length-2);
        if(t===null)continue;
        const point=t===0?ring[i]:t===1?ring[i+1]:{lat:ring[i].lat+t*(ring[i+1].lat-ring[i].lat),lng:ring[i].lng+t*(ring[i+1].lng-ring[i].lng)};
        const p=project(point),small=vertices=>{
          const loop=[p,...vertices.map(project),p];
          return loop.every(v=>Math.hypot(v.x-p.x,v.y-p.y)<=tolerance) &&
            loop.slice(1).reduce((sum,v,k)=>sum+Math.hypot(v.x-loop[k].x,v.y-loop[k].y),0)<=perimeter*0.15;
        };
        const inside=ring.slice(i+1,j+1),outside=[...ring.slice(j+1,-1),...ring.slice(0,i+1)];
        const inner=[point,...inside,point],outer=[...ring.slice(0,i+1),point,...ring.slice(j+1)];
        const candidate=forgiving?(area(inner)>area(outer)?inner:outer):small(inside)?outer:small(outside)?inner:null;
        if(candidate){
          const result=compact(candidate);
          if(result.length>=4 && result.length<ring.length)return result;
        }
      }
      active.push(segment);
    }
    return null;
  }
  let repaired;
  while((repaired=trim()))ring=repaired;
  return ring;
}
