// Convert each display-coordinate axis back to original image pixels, then
// apply the calibration authored in the leaflet block. Zoom and tile sizes
// never change the resulting distance. These are flat image distances.
export function measurementOptions(data,entry={},bounds=data.bounds) {
  if(data.calibration!==undefined){
    const calibration=data.calibration;
    if(!calibration || typeof calibration!=='object' || Array.isArray(calibration))return null;
    const {hexMiles,hexPixels,imageSize,imageSha256}=calibration;
    if(![hexMiles,hexPixels].every(value=>typeof value==='number' && Number.isFinite(value) && value>0) ||
      !Array.isArray(imageSize) || imageSize.length!==2 ||
      !imageSize.every(value=>Number.isInteger(value) && value>0 && value<=10_000_000))return null;
    if(imageSha256!==undefined && (typeof imageSha256!=='string' || !/^[a-f0-9]{64}$/.test(imageSha256) || imageSha256!==entry.sha256))return null;
    const perPixel=hexMiles/hexPixels;
    const xScale=imageSize[0]*perPixel/(bounds[1][1]-bounds[0][1]);
    const yScale=imageSize[1]*perPixel/(bounds[1][0]-bounds[0][0]);
    if(![xScale,yScale].every(value=>Number.isFinite(value) && value>0))return null;
    return {unit:'miles',hexMiles,xScale,yScale};
  }
  const scale=data.scale ?? 1,unit=data.unit === undefined ? 'map units' : data.unit;
  if(typeof scale!=='number' || !Number.isFinite(scale) || scale<=0 ||
    typeof unit!=='string' || !unit.trim() || unit.trim().length>40 || /[\x00-\x1f\x7f]/.test(unit))return null;
  return {xScale:scale,yScale:scale,unit:unit.trim()};
}

export function routeDistance(points,{xScale=1,yScale=1}={}) {
  let total=0;
  for(let i=1;i<points.length;i++)total+=Math.hypot((points[i].lat-points[i-1].lat)*yScale,(points[i].lng-points[i-1].lng)*xScale);
  return total;
}

export const isClosedRoute=points=>points.length>=4 && points[0].lat===points.at(-1).lat && points[0].lng===points.at(-1).lng;

// A single simple ring has an unambiguous interior. Translate to its first
// vertex before the shoelace sum to preserve precision at large map origins.
// Reject crossings/touches rather than returning an algebraic area that can
// cancel lobes or count overlapping regions twice.
export function routeArea(points,{xScale=1,yScale=1}={}) {
  if(!isClosedRoute(points))return null;
  const first=points[0],ring=[];
  for(const point of points){
    const p={x:(point.lng-first.lng)*xScale,y:(point.lat-first.lat)*yScale};
    if(!ring.length || p.x!==ring.at(-1).x || p.y!==ring.at(-1).y)ring.push(p);
  }
  if(ring.length<4)return null;
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const onSegment=(a,b,p)=>cross(a,b,p)===0 && p.x>=Math.min(a.x,b.x) && p.x<=Math.max(a.x,b.x) && p.y>=Math.min(a.y,b.y) && p.y<=Math.max(a.y,b.y);
  const intersects=(a,b,c,d)=>{
    const abC=cross(a,b,c),abD=cross(a,b,d),cdA=cross(c,d,a),cdB=cross(c,d,b);
    return ((abC>0 && abD<0 || abC<0 && abD>0) && (cdA>0 && cdB<0 || cdA<0 && cdB>0)) ||
      onSegment(a,b,c) || onSegment(a,b,d) || onSegment(c,d,a) || onSegment(c,d,b);
  };
  const segments=ring.slice(0,-1).map((a,i)=>{
    const b=ring[i+1];return {a,b,i,minX:Math.min(a.x,b.x),maxX:Math.max(a.x,b.x),minY:Math.min(a.y,b.y),maxY:Math.max(a.y,b.y)};
  });
  // Prune disjoint X/Y bounds before the intersection check, especially for
  // densely sampled freehand outlines. Neighboring edges may share a vertex.
  const sorted=[...segments].sort((a,b)=>a.minX-b.minX);let active=[];
  for(const segment of sorted){
    active=active.filter(other=>other.maxX>=segment.minX);
    for(const other of active){
      const gap=Math.abs(segment.i-other.i);
      if(gap===1 || gap===segments.length-1){
        const i=Math.min(segment.i,other.i),closing=gap===segments.length-1;
        const shared=closing?ring[0]:ring[i+1],start=closing?ring[1]:ring[i],end=closing?ring.at(-2):ring[i+2];
        if(cross(shared,start,end)===0 && (start.x-shared.x)*(end.x-shared.x)+(start.y-shared.y)*(end.y-shared.y)>0)return null;
        continue;
      }
      if(other.maxY<segment.minY || other.minY>segment.maxY)continue;
      if(intersects(segment.a,segment.b,other.a,other.b))return null;
    }
    active.push(segment);
  }
  let twice=0;
  for(const {a,b} of segments)twice+=a.x*b.y-b.x*a.y;
  const area=Math.abs(twice)/2;
  return Number.isFinite(area) && area>0?area:null;
}

export const formatArea=(area,unit)=>formatDistance(area,unit==='miles'?'square miles':'square '+unit);

export function formatDistance(distance,unit) {
  return distance.toLocaleString(undefined,{maximumFractionDigits:distance>0 && distance<1?2:1})+' '+unit;
}
