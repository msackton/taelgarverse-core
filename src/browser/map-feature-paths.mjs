import {MAP_IMPORTANCE,importanceVisible} from '../map-importance.mjs';
import {MAP_PATH_STYLES,pathIntersectsCrop} from '../map-feature-path.mjs';
import {cropInset} from './map-baseline.mjs';

// One image-aligned SVG moves with Leaflet. Zoom changes tier visibility only;
// paths and their point arrays are never reconstructed during navigation.
export function addMapFeaturePaths(L,map,canvas,initial,openNote){
  const doc=canvas.ownerDocument,ns='http://www.w3.org/2000/svg';
  let overlay,groups=[];
  const zoom=()=>{
    const scale=map.getZoomScale(map.getZoom(),0);
    for(const {tier,group} of groups){const display=importanceVisible(tier,scale)?'':'none';if(group.style.display!==display)group.style.display=display;}
  };
  function update(config){
    overlay?.remove();overlay=null;groups=[];
    if(!config.mapPaths?.length)return;
    const height=config.bounds[1][0],width=config.bounds[1][1],offset=config.sourceOffset;
    const svg=doc.createElementNS(ns,'svg');svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('class','map-feature-paths');
    svg.style.clipPath=cropInset(config.crop,{x:0,y:0,width,height});
    for(const {value:tier} of MAP_IMPORTANCE){
      const group=doc.createElementNS(ns,'g');svg.append(group);groups.push({tier,group});
      for(const item of config.mapPaths){
        if(item.importance!==tier || !pathIntersectsCrop(item.points,config.crop,offset))continue;
        const line=doc.createElementNS(ns,'polyline'),style=MAP_PATH_STYLES[item.kind];
        line.setAttribute('points',item.points.map(([x,y])=>`${x-offset[0]},${y-offset[1]}`).join(' '));
        for(const [name,value] of Object.entries({fill:'none',stroke:style.color,'stroke-width':style.weight,'stroke-linejoin':'round','stroke-linecap':'round','vector-effect':'non-scaling-stroke'}))line.setAttribute(name,String(value));
        const title=doc.createElementNS(ns,'title');title.textContent=item.name+' · '+item.kind;line.append(title);
        if(openNote || item.href?.startsWith('/page/')){
          const link=doc.createElementNS(ns,'a');link.setAttribute('href',openNote?'#':item.href);link.setAttribute('aria-label',item.name+' · '+item.kind);
          link.addEventListener('click',event=>{
            if(canvas.classList.contains('map-editing') || canvas.classList.contains('map-measuring')){event.preventDefault();return;}
            event.stopPropagation();if(openNote){event.preventDefault();openNote(item.id);}
          });link.append(line);group.append(link);
        }else{line.setAttribute('aria-label',item.name+' · '+item.kind);group.append(line);}
      }
    }
    overlay=L.svgOverlay(svg,config.bounds,{interactive:false}).addTo(map);zoom();
  }
  map.on('zoomend',zoom);update(initial);
  const dispose=()=>{map.off('zoomend',zoom);overlay?.remove();};dispose.update=update;return dispose;
}
