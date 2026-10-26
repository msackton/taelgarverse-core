/* Progressive cartography: one geometry, independent feature visibility. */
(() => {
 const d=window.mapDemoData,H=d.height;
 const xy=p=>[H-p[1],p[0]];
 const map=L.map('map',{crs:L.CRS.Simple,minZoom:-6,maxZoom:5,zoomSnap:.1,zoomDelta:.5,attributionControl:false});
 const worldBounds=[[0,0],[H,d.width]];
 map.fitBounds(worldBounds);
 const terrain=L.imageOverlay('terrain.png',worldBounds).on('error',()=>document.querySelector('#status').textContent='Terrain image could not load.').addTo(map);
 const categories={rivers:true,roads:true,places:true};
 const sourceBox=window.tracedRivers.metadata.sourceBounds;
 const sourceRiver=L.imageOverlay('river-source.png',[[H-sourceBox[3],sourceBox[0]],[H-sourceBox[1],sourceBox[2]]],{opacity:0}).addTo(map);
 let compareSource=false;
 const records=[];
 const fade=(z,start,span=.8)=>start===-Infinity?1:Math.max(0,Math.min(1,(z-start)/span));
 function inspect(feature){
  document.querySelector('#selection').textContent=feature.name;
  document.querySelector('#description').textContent=feature.description||`${feature.type||'Map feature'} in the illustrative network.`;
  document.querySelector('#selected-kind').textContent=feature.type||'Map feature';
 }
 function add(layer,category,start,options={}){
  layer.addTo(map);
  const record={layer,category,start,span:options.span||.8,baseOpacity:options.opacity??1,fill:options.fill??.4,weight:options.weight??1,limit:options.limit,kind:options.kind||'path',opacity:0};
  records.push(record);return record;
 }
 // Smooth paths are sampled once, preserving the control-point junctions.
 // Leaflet then simplifies them in screen pixels as the zoom changes.
 function curve(points){
  const result=[];
  for(let i=0;i<points.length-1;i++){
   const p0=points[Math.max(0,i-1)],p1=points[i],p2=points[i+1],p3=points[Math.min(points.length-1,i+2)];
   for(let j=0;j<18;j++){
    const t=j/18,t2=t*t,t3=t2*t;
    result.push([0,1].map(k=>.5*((2*p1[k])+(-p0[k]+p2[k])*t+(2*p0[k]-5*p1[k]+4*p2[k]-p3[k])*t2+(-p0[k]+3*p1[k]-3*p2[k]+p3[k])*t3)));
   }
  }
  result.push(points.at(-1));return result.map(xy);
 }
 function label(name,point,category,start,className='place-label',offset=[9,-13],limit){
  const div=document.createElement('span');div.className=className;div.textContent=name;
  const marker=L.marker(xy(point),{interactive:false,keyboard:false,icon:L.divIcon({className:'label-anchor',html:div,iconSize:[0,0],iconAnchor:[-offset[0],-offset[1]]})});
  add(marker,category,start,{kind:'marker',limit});return marker;
 }
 // Larger-scale field patterns are underneath all transport and water features.
 d.fields.forEach(points=>add(L.polygon(points.map(xy),{color:'#aeab83',weight:1,fillColor:'#d5d0a0',interactive:false}), 'places',.55,{fill:.16,opacity:.6}));
 d.rivers.forEach(r=>{
  const starts=[-Infinity,-2,-.8,.6];
  const width=[3.2,2,1.25,.9][r.rank];
  const layer=L.polyline(curve(r.points),{color:'#4d7890',weight:width,smoothFactor:1.1,lineCap:'round',lineJoin:'round'}).bindTooltip(r.name,{sticky:true});
  layer.on('click',()=>inspect({...r,type:r.rank?'Traced tributary':'Traced main river'}));
  add(layer,'rivers',starts[r.rank],{weight:width});
 });
 // Settlement footprint fades in before buildings; the location never moves.
 add(L.polygon(d.extent.map(xy),{color:'#a89479',weight:1,fillColor:'#ece2cc',interactive:false}),'places',.05,{fill:.42,opacity:.7});
 d.roads.forEach(r=>{
  const start=[-Infinity,-1.5,-.25,1][r.rank],weight=[2.6,1.8,1.15,1][r.rank];
  // Casing distinguishes roads from the terrain without making them grow
  // thicker in geographic units as the user zooms.
  add(L.polyline(r.points.map(xy),{color:'#fffdf8',weight:weight+2.4,interactive:false,smoothFactor:1}), 'roads',start,{weight:weight+2.4});
  const layer=L.polyline(r.points.map(xy),{color:r.rank<2?'#aa8150':'#b19b7e',weight,dashArray:r.rank>=2?'4 4':null,smoothFactor:1,lineJoin:'round'}).bindTooltip(r.name,{sticky:true});
  layer.on('click',()=>inspect({...r,type:r.rank>=2?'Local track':'Road'}));
  add(layer,'roads',start,{weight});
 });
 d.streets.forEach(s=>{
  const layer=L.polyline(s.points.map(xy),{color:'#a79275',weight:1.4}).bindTooltip(s.name,{sticky:true});
  layer.on('click',()=>inspect({...s,type:'Street'}));add(layer,'roads',1.1,{weight:1.4});
 });
 d.buildings.forEach(b=>{
  const landmark=b.type==='Landmark';
  const layer=L.polygon(b.points.map(xy),{color:landmark?'#735843':'#8d7864',weight:.8,fillColor:landmark?'#b68c64':'#cdb69a'}).bindTooltip(b.name);
  layer.on('click',()=>inspect(b));add(layer,'places',1.45,{fill:landmark?.9:.72,weight:.8});
  if(landmark){const p=b.points[0];label(b.name,[p[0],p[1]-2],'places',1.5,'landmark-label',[0,-5]);}
 });
 const townMarkers={};
 d.towns.forEach(t=>{
  const start=[-Infinity,-1.6,-.4][t.rank],size=[5.5,4.5,3.5][t.rank];
  const circle=L.circleMarker(xy([t.x,t.y]),{radius:size,color:'#7c453b',weight:1.6,fillColor:'#fffaf1',fillOpacity:1});
  circle.on('click',()=>{inspect(t);circle.bindPopup(`<strong>${t.name}</strong><br>${t.type}<br><small>Illustrative geography</small>`).openPopup();});
  // At street scale the large town symbol yields to the actual footprint.
  add(circle,'places',start,{fill:1,weight:1.6,limit:t.id==='alderbridge'?[1.4,2.2]:null});
  townMarkers[t.id]=circle;
  label(t.name,[t.x,t.y],'places',t.rank===0?-Infinity:start+.3,'place-label',[10,-13],t.id==='alderbridge'?[1.4,2.2]:null);
 });
 label('A L D E R B R I D G E',[3905,3660],'places',1.5,'town-heading',[0,-12]);
 label('Traced river',[4010,3300],'rivers',-1.6,'river-label',[8,0]);
 label('Market Street',[3940,3754],'roads',3,'street-label',[6,-5]);
 label('North Lane',[3945,3690],'roads',3,'street-label',[0,-10]);
 const demoOutline=L.rectangle([[H-sourceBox[3],sourceBox[0]],[H-sourceBox[1],sourceBox[2]]],{color:'#778c7c',weight:1,dashArray:'4 5',fillOpacity:.025});
 demoOutline.on('click',()=>go('region'));
 let activeStage='';
 function render(){
  const z=map.getZoom();
  // Coarse raster terrain recedes to keep close-up vector detail readable.
  const center=map.getCenter();
  const nearTown=Math.hypot(center.lng-3970,H-center.lat-3740)<180;
  terrain.setOpacity(1-(nearTown?.94:.7)*fade(z,1.2,1));
  sourceRiver.setOpacity(compareSource&&categories.rivers?1:0);
  for(const r of records){
   let a=categories[r.category]&&!(compareSource&&r.category==='rivers')?fade(z,r.start,r.span):0;
   if(r.limit)a*=1-fade(z,r.limit[0],r.limit[1]-r.limit[0]);
   if(a<.01&&r.opacity>=.01){r.layer.closeTooltip?.();r.layer.closePopup?.();}
   r.opacity=a;
   if(r.kind==='marker'){
    r.layer.setOpacity(a);const el=r.layer.getElement();if(el){el.style.pointerEvents='none';el.style.visibility=a<.01?'hidden':'visible';}
   }else{
    r.layer.setStyle({opacity:a*r.baseOpacity,fillOpacity:a*r.fill,weight:r.weight});
    const el=r.layer.getElement();if(el)el.style.pointerEvents=a>.12?'auto':'none';
   }
  }
  if(z<-2.3&&!map.hasLayer(demoOutline))demoOutline.addTo(map);
  if(z>=-2.3&&map.hasLayer(demoOutline))map.removeLayer(demoOutline);
  const stage=z<-1.4?'World':z<.3?'Region':z<1.7?'Local':nearTown?'Town':'Detail';
  document.querySelector('#status').textContent=`${stage} view · zoom ${z.toFixed(1)}`;
  if(stage!==activeStage){
   activeStage=stage;
   document.querySelectorAll('[data-stage]').forEach(el=>el.classList.toggle('active',el.dataset.stage===stage));
   document.querySelector('#stage-copy').textContent={World:'The traced main river appears at world scale. Roads and towns remain fictional.',Region:'Original tributaries fade in along their Photoshop courses.',Local:'Smaller branches appear. River bends resolve as you zoom closer.',Detail:'Close-up of the original river junctions. Lines remain crisp and connected; no extra waterways are invented.',Town:'The earlier fictional town plan: streets, buildings and landmarks. Its geography is independent of the traced river system.'}[stage];
  }
 }
 map.on('zoom zoomend moveend',render);
 document.querySelector('#compare').onclick=()=>{stopTour();map.stop();compareSource=!compareSource;const button=document.querySelector('#compare');button.textContent=compareSource?'Return to zoomable rivers':'Show Photoshop original';button.setAttribute('aria-pressed',String(compareSource));render();};
 let tourTimers=[];
 function stopTour(){tourTimers.forEach(clearTimeout);tourTimers=[];document.querySelector('#tour').textContent='Play river zoom tour';document.querySelector('#tour').setAttribute('aria-pressed','false');}
 function go(name,duration=2){
  if(name==='world')map.flyToBounds(worldBounds,{duration});
  else{const v=d.views[name];map.flyTo(xy(v.center),v.zoom,{duration});}
 }
 document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{stopTour();go(button.dataset.view);});
 document.querySelector('#tour').onclick=()=>{
  if(tourTimers.length){stopTour();map.stop();return;}
  compareSource=false;document.querySelector('#compare').textContent='Show Photoshop original';document.querySelector('#compare').setAttribute('aria-pressed','false');render();
  document.querySelector('#tour').textContent='Stop tour';document.querySelector('#tour').setAttribute('aria-pressed','true');
  const itinerary=[['world',0],['region',2600],['local',6500],['river',10300],['region',15500]];
  itinerary.forEach(([name,time])=>tourTimers.push(setTimeout(()=>go(name),time)));
  tourTimers.push(setTimeout(stopTour,18500));
 };
 // Manual navigation takes priority over a running camera tour.
 map.on('dragstart',stopTour);
 map.getContainer().addEventListener('wheel',stopTour,{passive:true});
 for(const input of document.querySelectorAll('[data-category]'))input.onchange=()=>{categories[input.dataset.category]=input.checked;render();};
 document.querySelector('#town-jump').onclick=()=>{stopTour();inspect(d.towns[0]);go('town');};
 render();
 window.progressiveDemo={map,data:d,records,worldBounds,townMarkers,go,render,get stage(){return activeStage;}};
})();
