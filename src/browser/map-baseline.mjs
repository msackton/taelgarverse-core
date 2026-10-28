import {coreToLatLng,latLngToCore,hexVertices,pointToHex,visibleHexes,inCrop} from '../map-core.mjs';
import {axialToLocator,axialToHexReference,LOCATOR_SCHEME,pointToBlock,visibleBlocks,blockGridLines} from '../map-locators.mjs';
import {MAX_HEX_DEPTH,hexLevel,hierarchyGrid,parentHex} from '../map-hex-hierarchy.mjs';

export const HEX_DETAIL_MIN_PIXELS=18;
export function gridDetail(scale,hasBlocks,hasSubhexes=hasBlocks){
  for(let depth=hasSubhexes?MAX_HEX_DEPTH:0;depth>=0;depth--)if(hexLevel(depth).hexPixels*scale>=HEX_DETAIL_MIN_PIXELS-1e-9)return depth;
  return hasBlocks?'blocks':'hidden';
}
const sizeLabel=depth=>depth===0?'24':hexLevel(depth).hexMiles.toFixed(2);
let nextGridPane=0;

function clipEdge(a,b,rect){
  if(inCrop(a,rect) && inCrop(b,rect))return [a,b];
  const dx=b[0]-a[0],dy=b[1]-a[1];let start=0,end=1;
  for(const [p,q] of [[-dx,a[0]-rect.x],[dx,rect.x+rect.width-a[0]],[-dy,a[1]-rect.y],[dy,rect.y+rect.height-a[1]]]){
    if(p===0){if(q<0)return null;continue;}
    const t=q/p;if(p<0)start=Math.max(start,t);else end=Math.min(end,t);
    if(start>end)return null;
  }
  return [[a[0]+start*dx,a[1]+start*dy],[a[0]+end*dx,a[1]+end*dy]];
}

// Grid geometry and highlights are clipped to the map’s rectangle.
export function addMapBaseline(L,map,canvas,figure,config) {
  const height=config.bounds[1][0],width=config.bounds[1][1],crop=config.crop,grid=config.grid;
  const ll=point=>coreToLatLng(point,height),doc=canvas.ownerDocument;
  const group=L.layerGroup().addTo(map);
  const hasLocators=grid.addressing?.status==='verified' && grid.addressing.scheme===LOCATOR_SCHEME;
  const hasBlocks=hasLocators && Array.isArray(grid.blockOrigin);
  const levels=Array.from({length:MAX_HEX_DEPTH+1},(_,depth)=>{
    const level=hexLevel(depth),cellGrid=hierarchyGrid(grid,depth);
    return {...level,grid:cellGrid,c:Math.cos(cellGrid.rotation??0),s:Math.sin(cellGrid.rotation??0),
      offsets:hexVertices({...cellGrid,origin:[0,0]},cellGrid.axialOrigin,level.hexPixels)};
  });
  const gridPaneName='taelgar-grid-lines-'+nextGridPane++;
  const gridPane=map.createPane(gridPaneName,map.getPane('overlayPane'));
  gridPane.style.zIndex='40';gridPane.style.pointerEvents='none';
  const gridRenderer=L.canvas({padding:0.5,pane:gridPaneName}).addTo(map);
  const gridLine=L.polyline([],{renderer:gridRenderer,weight:1,color:'#5e625c',opacity:0.65,smoothFactor:0,interactive:false}).addTo(group);
  const coarseLine=L.polyline([],{renderer:gridRenderer,weight:1.8,color:'#426453',opacity:0.85,smoothFactor:0,interactive:false}).addTo(group);
  const parentHighlight=L.polyline([],{renderer:gridRenderer,color:'#126c9a',weight:2,dashArray:'5 4',smoothFactor:0,interactive:false}).addTo(group);
  const blockBoundary=L.polyline([],{renderer:gridRenderer,color:'#52685b',weight:1.5,opacity:0.3,
    dashArray:'6 5',smoothFactor:0,interactive:false}).addTo(group);
  blockBoundary.bringToBack();
  // Clip transient selection at the crop boundary too: a cell
  // straddling an opaque boundary must not draw its outline across that area.
  const selection=L.polyline([],{renderer:gridRenderer,color:'#126c9a',weight:2,fill:false,smoothFactor:0,interactive:false}).addTo(group);
  const controls=doc.createElement('span');controls.className='map-grid-controls';
  const label=doc.createElement('label'),toggle=doc.createElement('input');toggle.type='checkbox';toggle.checked=grid.visible;
  label.append(toggle,doc.createTextNode(' Hex grid'));
  const output=doc.createElement('span');output.className='map-hex-coordinate';
  const center=doc.createElement('button');center.type='button';center.textContent='Select center hex';
  const copy=doc.createElement('button');copy.type='button';copy.textContent='Copy hex coordinates';copy.disabled=true;
  const clear=doc.createElement('button');clear.type='button';clear.textContent='Unpin hex';clear.hidden=true;
  const detail=doc.createElement('span');detail.className='map-grid-detail';
  controls.append(label,output,center,copy,clear,detail);figure.querySelector('figcaption').append(controls);
  let pinned=false,address='',disposed=false,frame,mode,lastSelection,selectionKey,lastView;
  const busy=()=>canvas.classList.contains('map-measuring') || canvas.classList.contains('map-editing');
  const reset=()=>{pinned=false;address='';lastSelection=null;selectionKey=null;selection.setLatLngs([]);parentHighlight.setLatLngs([]);output.textContent='';copy.disabled=true;clear.hidden=true;};
  const clipped=line=>{const edge=clipEdge(line[0],line[1],crop);return edge?edge.map(ll):null;};
  const outline=vertices=>vertices.map((p,i)=>clipped([p,vertices[(i+1)%vertices.length]])).filter(Boolean);
  function cellLines(level,rect){
    const {grid:cellGrid,hexPixels:pixels,offsets,c,s}=level,lines=[];
    for(const [q,r] of visibleHexes(cellGrid,rect,pixels)){
      const aq=q-cellGrid.axialOrigin[0],ar=r-cellGrid.axialOrigin[1];
      const ux=Math.sqrt(3)*pixels*aq/2,uy=pixels*(ar+aq/2);
      const x=ux*c-uy*s+cellGrid.origin[0],y=ux*s+uy*c+cellGrid.origin[1];
      // Only four vertices are needed for the three unique edges. Shape offsets
      // and rotation are fixed per level, rather than recomputed for every cell.
      let a=[x+offsets[0][0],y+offsets[0][1]];
      for(let i=1;i<=3;i++){
        const b=[x+offsets[i][0],y+offsets[i][1]],edge=clipEdge(a,b,crop);
        if(edge)lines.push([ll(edge[0]),ll(edge[1])]);a=b;
      }
    }
    return lines;
  }
  function redraw(){
    const scale=map.getZoomScale(map.getZoom(),0),next=toggle.checked?gridDetail(scale,hasBlocks,hasLocators):'off';
    const keepSelection=next!==mode && pinned?lastSelection:null;
    if(next!==mode){reset();lastView=null;mode=next;gridLine.setStyle({opacity:mode>0?0.45:0.65});}
    center.hidden=copy.hidden=!grid.showCoordinates || mode==='off' || mode==='hidden';
    const unit=mode==='blocks'?'block':typeof mode==='number'?sizeLabel(mode)+'-mile hex':'hex';
    center.textContent='Select center '+unit;copy.textContent='Copy '+unit+' coordinates';clear.textContent='Unpin '+unit;
    detail.hidden=mode==='off';detail.textContent=mode==='blocks'?'Blocks · zoom in for hexes':typeof mode==='number'?
      unit+'es'+(hasLocators && mode<MAX_HEX_DEPTH?' · zoom in for '+sizeLabel(mode+1)+'-mile hexes':''):'Zoom in for hexes';
    if(mode==='off' || mode==='hidden'){if(lastView!==mode){gridLine.setLatLngs([]);coarseLine.setLatLngs([]);blockBoundary.setLatLngs([]);lastView=mode;}return;}
    const bounds=map.getBounds(),nw=latLngToCore([bounds.getNorth(),bounds.getWest()],height),se=latLngToCore([bounds.getSouth(),bounds.getEast()],height);
    const x=Math.max(crop.x,nw[0]),y=Math.max(crop.y,nw[1]);
    const right=Math.min(crop.x+crop.width,se[0]),bottom=Math.min(crop.y+crop.height,se[1]);
    const viewKey=[mode,x,y,right,bottom].join(',');
    if(viewKey===lastView)return;lastView=viewKey;
    coarseLine.setLatLngs([]);blockBoundary.setLatLngs([]);
    if(right<x || bottom<y){gridLine.setLatLngs([]);return;}
    const rect={x,y,width:right-x,height:bottom-y},lines=[];
    if(hasBlocks){
      // Count only blocks with area in the visible crop. Looking at one block
      // needs no context lines; crossing into a neighbor restores its boundary.
      const blocks=visibleBlocks(grid.blockOrigin,rect);
      if(!blocks.next().done && !blocks.next().done)
        blockBoundary.setLatLngs(blockGridLines(grid.blockOrigin,rect).map(line=>line.map(ll)));
    }
    if(typeof mode==='number'){
      const level=levels[mode];
      // Only the current grid and its immediate predecessor: drawing every
      // ancestor at deep zoom would obscure the smaller cells.
      gridLine.setLatLngs(cellLines(level,rect));
      if(mode>0){const parent=levels[mode-1];coarseLine.setLatLngs(cellLines(parent,rect));}
    }else gridLine.setLatLngs(lines);
    if(keepSelection)select(keepSelection,true);
  }
  function select(latlng,pin=false){
    if(!toggle.checked || mode==='hidden' || !grid.showCoordinates || busy() || (pinned && !pin))return;
    const point=latLngToCore([latlng.lat,latlng.lng],height);
    if(!inCrop(point,crop)){if(!pinned)reset();return;}
    const selected=key=>{const same=key===selectionKey;selectionKey=key;lastSelection=latlng;pinned=pin;copy.disabled=!pin;clear.hidden=!pin;return same;};
    if(mode==='blocks'){
      const block=pointToBlock(grid.blockOrigin,point);if(!block){if(!pinned)reset();return;}
      if(selected('block:'+block.address))return;
      address=block.address;output.textContent=address+' · block';
      const {x,y,width,height}=block;selection.setLatLngs(outline([[x,y],[x+width,y],[x+width,y+height],[x,y+height]]));
    }else if(mode>0){
      const level=levels[mode],parent=levels[mode-1],axial=pointToHex(level.grid,point,level.hexPixels);
      if(selected(mode+':'+axial.join(',')))return;
      const locator=axialToHexReference(axial,mode);
      address=locator??(`depth ${mode} axial `+axial.join(', '));output.textContent=address+' · '+sizeLabel(mode)+'-mile hex';
      selection.setLatLngs(outline(hexVertices(level.grid,axial,level.hexPixels)));
      parentHighlight.setLatLngs(outline(hexVertices(parent.grid,parentHex(axial,mode).axial,parent.hexPixels)));
    }else{
      const axial=pointToHex(grid,point);
      if(selected('0:'+axial.join(',')))return;
      const locator=grid.addressing?.status==='verified' && grid.addressing.scheme===LOCATOR_SCHEME?axialToLocator(axial):null;
      address=locator??('axial '+axial.join(', '));
      output.textContent=locator?address+' · regular grid':address+' (historical locator unverified)';
      selection.setLatLngs(outline(hexVertices(grid,axial)));
    }
  }
  const move=event=>select(event.latlng),click=event=>select(event.latlng,true);
  const scheduleRedraw=()=>{
    if(frame!==undefined)return;
    frame=doc.defaultView.requestAnimationFrame(()=>{frame=undefined;if(!disposed)redraw();});
  };
  const selectCenter=()=>select(map.getCenter(),true);
  const changed=()=>{reset();redraw();};
  const copyCoordinates=async()=>{
    try{await doc.defaultView.navigator.clipboard.writeText(address);if(!disposed)output.textContent=address+' copied';}
    catch{if(!disposed)output.textContent='Copy this coordinate: '+address;}
  };
  toggle.addEventListener('change',changed);center.addEventListener('click',selectCenter);
  copy.addEventListener('click',copyCoordinates);clear.addEventListener('click',reset);
  // Let Leaflet transform existing grid pixels during a gesture; rebuild once
  // the view settles instead of generating thousands of segments every frame.
  map.on('moveend zoomend resize',scheduleRedraw);map.on('mousemove',move);map.on('click',click);changed();
  return ()=>{
    disposed=true;if(frame!==undefined)doc.defaultView.cancelAnimationFrame(frame);
    map.off('moveend zoomend resize',scheduleRedraw);map.off('mousemove',move);map.off('click',click);
    controls.remove();group.remove();gridRenderer.remove();gridPane.remove();
  };
}

// Clip in the element's own source-aligned frame, so animated transforms cannot
// briefly reveal the full source outside an authored crop.
export function cropInset(crop,rect) {
  const left=Math.max(0,crop.x-rect.x),top=Math.max(0,crop.y-rect.y);
  const right=Math.max(0,rect.x+rect.width-crop.x-crop.width),bottom=Math.max(0,rect.y+rect.height-crop.y-crop.height);
  return `inset(${Math.min(100,top/rect.height*100)}% ${Math.min(100,right/rect.width*100)}% ${Math.min(100,bottom/rect.height*100)}% ${Math.min(100,left/rect.width*100)}%)`;
}
