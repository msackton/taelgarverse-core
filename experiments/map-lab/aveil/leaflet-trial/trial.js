const W=11329,H=9419;
const worldBounds=[[0,0],[H,W]];
const detailBounds=[[H-3890,3450],[H-3500,3900]];
const map=L.map('map',{crs:L.CRS.Simple,minZoom:-6,maxZoom:4,zoomSnap:.1,zoomDelta:.5,attributionControl:false});
L.imageOverlay('world.png',worldBounds).on('error',()=>document.querySelector('#error').textContent='World image could not load.').addTo(map);
map.fitBounds(worldBounds);
let compare=false;
let lastState={opacity:0,zoom:map.getZoom()};
const towns=L.layerGroup();
for(const [name,x,y] of [['Cleenseau',3641,3768],['Rinburg',3730,3698]]){
  const content=document.createElement('div');
  const title=document.createElement('strong');title.textContent=name;
  const copy=document.createElement('p');copy.textContent='Existing world-map position.';
  const link=document.createElement('a');link.textContent='Open note in Obsidian';link.href='obsidian://open?vault=taelgar&file='+encodeURIComponent(name);
  content.append(title,copy,link);
  L.circleMarker([H-y,x],{radius:8,color:'#812f35',fillColor:'#faf8ef',fillOpacity:.85,weight:2}).bindTooltip(name).bindPopup(content).addTo(towns);
}
function showState(state){
  lastState=state;
  if(compare){document.querySelectorAll('.regional-detail').forEach(image=>image.style.opacity=0);}
  const opacity=compare?0:state.opacity;
  document.querySelector('#status').textContent=compare?'World artwork (comparison)':state.failed?'Detail unavailable; world retained':opacity===0?'World map':`Regional detail ${Math.round(opacity*100)}%`;
  document.querySelector('#map').dataset.detailOpacity=String(opacity);
  if(opacity>.5&&!map.hasLayer(towns))towns.addTo(map);
  if(opacity<=.5&&map.hasLayer(towns))map.removeLayer(towns);
}
const detail=attachDetailLayer(L,map,{url:'aveil-detail.png',bounds:detailBounds,startZoom:-.5,endZoom:1,onChange:showState});
const outline=L.rectangle(detailBounds,{color:'#557963',weight:1,fillOpacity:.05,dashArray:'5 4'}).addTo(map);
outline.bindTooltip('Aveil · zoom for detail',{permanent:true,direction:'top',className:'region-label'});
outline.on('click',()=>map.flyTo([H-3660,3655],1,{duration:2}));
map.on('zoomend',()=>{if(map.getZoom()>-.5){if(map.hasLayer(outline))map.removeLayer(outline);}else if(!map.hasLayer(outline))outline.addTo(map);});
document.querySelector('#world').onclick=()=>map.flyToBounds(worldBounds,{duration:2});
document.querySelector('#aveil').onclick=()=>map.flyTo([H-3660,3655],1,{duration:2.5});
document.querySelector('#closer').onclick=()=>map.setZoom(Math.min(4,map.getZoom()+.5));
document.querySelector('#base').onclick=e=>{
  compare=!compare;e.target.textContent=compare?'Show regional detail':'Compare world artwork';
  detail.update();
};
// Exposed only for this local experiment's geographic and interaction checks.
window.aveilTrial={map,detail,detailBounds,worldBounds,towns,get state(){return lastState;}};
