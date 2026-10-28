import {cropInset} from './map-baseline.mjs';

// An image-aligned SVG clips the artwork without inventing a border along
// the crop edge. Leaflet carries it through both dragging and animated zoom.
export function addMapRegions(L,map,canvas,figure,initial,openNote){
  const doc=canvas.ownerDocument,ns='http://www.w3.org/2000/svg',visibility=new Map();
  const controls=doc.createElement('span');controls.className='map-region-controls';
  figure.querySelector('figcaption').append(controls);
  let overlay;
  function update(config){
    overlay?.remove();overlay=null;controls.replaceChildren();
    if(!config.regionLayers?.length)return;
    const height=config.bounds[1][0],width=config.bounds[1][1],offset=config.sourceOffset;
    const svg=doc.createElementNS(ns,'svg');svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
    svg.setAttribute('class','map-region-overlay');svg.style.clipPath=cropInset(config.crop,{x:0,y:0,width,height});
    for(const layer of config.regionLayers){
      const group=doc.createElementNS(ns,'g');svg.append(group);
      const shown=(layer.toggleable===true?visibility.get(layer.key):undefined)??layer.visible!==false;
      group.style.display=shown?'':'none';
      if(layer.toggleable===true){
        const label=doc.createElement('label'),toggle=doc.createElement('input');toggle.type='checkbox';toggle.checked=shown;
        label.append(toggle,doc.createTextNode(' '+layer.name));controls.append(label);
        toggle.addEventListener('change',()=>{visibility.set(layer.key,toggle.checked);group.style.display=toggle.checked?'':'none';});
      }
      const details=doc.createElement('details'),summary=doc.createElement('summary'),list=doc.createElement('ul');summary.textContent=layer.name+' regions';details.append(summary,list);controls.append(details);
      for(const region of layer.regions){
        const item=doc.createElement('li'),href=config.regionLinks?.[layer.key+'#'+region.id];
        const link=doc.createElement(region.note && openNote?'button':href?.startsWith('/page/')?'a':'span');link.textContent=region.name;
        if(link.tagName==='BUTTON'){link.type='button';link.addEventListener('click',()=>openNote(region.note));}
        else if(link.tagName==='A')link.setAttribute('href',href);
        item.append(link);list.append(item);
        const polygon=doc.createElementNS(ns,'polygon');
        polygon.setAttribute('points',region.points.map(p=>`${p[0]-offset[0]},${p[1]-offset[1]}`).join(' '));
        polygon.setAttribute('stroke',region.color??'#795548');polygon.setAttribute('stroke-width',String(region.width??2));
        polygon.setAttribute('stroke-linejoin','round');polygon.setAttribute('vector-effect','non-scaling-stroke');
        polygon.setAttribute('fill',region.color??'#795548');polygon.setAttribute('fill-opacity',String(region.fillOpacity??0));
        if(region.dashed)polygon.setAttribute('stroke-dasharray','6 4');
        polygon.setAttribute('aria-label',region.name);polygon.setAttribute('role','img');
        const title=doc.createElementNS(ns,'title');title.textContent=layer.name+' · '+region.name;polygon.append(title);group.append(polygon);
      }
    }
    overlay=L.svgOverlay(svg,config.bounds,{interactive:false}).addTo(map);
  }
  update(initial);
  const dispose=()=>{overlay?.remove();controls.remove();};dispose.update=update;return dispose;
}
