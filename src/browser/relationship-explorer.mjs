import {buildPlaceTree} from '../place-tree.mjs';
import {mountPlaceBoxes} from './place-boxes.mjs';
import {PRESETS,queryRelationshipGraph,isWorldbuildingNode,filterWorldbuilding} from '../relationship-graph.mjs';
import {layoutRelationships,membershipEnclosures,membershipColor,visibleMemberships,relationshipLabel} from '../relationship-layout.mjs';

let nextId=0;
export function mountRelationshipExplorer(root,{loadData,openNote,initialRoot='',embedded=false}={}) {
  const doc=root.ownerDocument,uid='taelgar-graph-'+(++nextId);
  let placeTree;
  let disposed=false,initialized=false,sequence=0,data,visible,layout,selected='',previous=new Map(),camera,drag,fullscreen=null;
  const state={preset:'people',mode:'network',root:initialRoot,depth:embedded?1:2,unexpandedOrganizations:[],includeWorldbuilding:false};
  const el=(tag,parent,text,attrs={})=>{
    const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;
    for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);
    parent?.append(node);return node;
  };
  const button=(parent,text,action,attrs={})=>{const node=el('button',parent,text,{type:'button',...attrs});node.addEventListener('click',()=>{if(!disposed)action();});return node;};
  root.replaceChildren();root.classList.add('taelgar-graph');root.classList.toggle('tg-embedded',embedded);
  const controls=el('div',root,undefined,{class:'tg-controls'});
  const modes=el('div',controls,undefined,{class:'tg-modes',role:'group','aria-label':'Explore'});
  const switchMode=value=>{
    state.preset=value;state.mode=value==='places'?'containment':'network';selected='';
    if(data&&!allowedNode(data.graph.nodes.find(n=>n.id===state.root)))state.root='';
    previous=new Map();draw();
  };
  const peopleMode=button(modes,'People',()=>switchMode('people'),{'aria-pressed':'true'});
  const placesMode=button(modes,'Places',()=>switchMode('places'),{'aria-pressed':'false'});
  const focus=el('input',controls,undefined,{list:uid+'-notes',placeholder:'Find a note…','aria-label':'Starting note',title:'Starting note'});
  const suggestions=el('datalist',controls,undefined,{id:uid+'-notes'});
  focus.addEventListener('change',()=>{
    const value=focus.value.trim(),matches=(state.preset==='places'?placeTree?.nodes:data?.graph.nodes)?.filter(n=>allowedNode(n)&&(n.id===value||n.name===value))??[];
    if(value&&matches.length!==1){status.textContent='Choose a note from the list.';return;}
    state.root=matches[0]?.id??'';draw();
  });
  button(controls,'All notes',()=>{state.root='';selected='';draw();},{title:'Clear starting note'});
  const depthLabel=el('label',controls,'Depth',{class:'tg-depth'}),depth=el('select',depthLabel,undefined,{'aria-label':'Connection depth'});
  for(const value of ['1','2','3','all'])el('option',depth,value==='all'?'All':value,{value});
  depth.value='2';depth.addEventListener('change',()=>{state.depth=depth.value;draw();});
  const worldbuildingLabel=el('label',controls,undefined,{class:'tg-worldbuilding'});
  const worldbuilding=el('input',worldbuildingLabel,undefined,{type:'checkbox','aria-label':'Include Worldbuilding'});
  el('span',worldbuildingLabel,'Include Worldbuilding');
  worldbuilding.addEventListener('change',()=>{
    state.includeWorldbuilding=worldbuilding.checked;selected='';previous=new Map();draw();
  });
  const actions=el('div',controls,undefined,{class:'tg-actions'});
  button(actions,'↻',()=>refresh(),{'aria-label':'Refresh',title:'Refresh'});
  const fullButton=button(actions,'Full screen',()=>fullscreen?leaveFullscreen():enterFullscreen(),{'aria-pressed':'false',title:'Full screen'});

  const body=el('div',root,undefined,{class:'tg-body'});
  const stage=el('div',body,undefined,{class:'tg-stage'});
  const zoom=el('div',stage,undefined,{class:'tg-zoom'});
  button(zoom,'+',()=>scale(.8),{'aria-label':'Zoom in',title:'Zoom in'});
  button(zoom,'−',()=>scale(1.25),{'aria-label':'Zoom out',title:'Zoom out'});
  button(zoom,'Fit',()=>fit(),{title:'Fit graph (0)'});button(zoom,'100%',()=>readable(),{title:'Readable size (1)'});
  const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('aria-label','Relationship graph');
  svg.setAttribute('role','group');svg.setAttribute('tabindex','0');stage.append(svg);
  const status=el('p',stage,'Loading…',{class:'tg-status',role:'status','aria-live':'polite'});
  const placeContainer=el('div',stage,undefined,{class:'tg-place-browser'});placeContainer.hidden=true;
  const placeBoxes=mountPlaceBoxes(placeContainer,{onSelect:showNode,onFocus:focusNode,onCount:count=>{status.textContent=count+' shown · DR '+data.graph.date;}});
  const details=el('aside',body,undefined,{class:'tg-details','aria-label':'Selection details'});details.hidden=true;
  const warnings=el('details',root,undefined,{class:'tg-warnings'});warnings.hidden=true;
  const svgEl=(tag,parent,attrs={},text)=>{
    const node=doc.createElementNS('http://www.w3.org/2000/svg',tag);
    for(const [k,v] of Object.entries(attrs))node.setAttribute(k,String(v));
    if(text!==undefined)node.textContent=text;parent.append(node);return node;
  };
  function allowedNode(node){return node&&(state.includeWorldbuilding||!isWorldbuildingNode(node))&&(state.preset==='places'?['person','place']:['person','group']).includes(node.type);}
  function sync(){
    peopleMode.setAttribute('aria-pressed',String(state.preset==='people'));
    placesMode.setAttribute('aria-pressed',String(state.preset==='places'));
    focus.value=state.root;depth.value=String(state.depth);worldbuilding.checked=state.includeWorldbuilding;
    suggestions.replaceChildren();
    for(const n of (state.preset==='places'?placeTree?.nodes:data?.graph.nodes)??[])if(allowedNode(n))el('option',suggestions,n.name,{value:n.id});
    depthLabel.hidden=embedded||state.preset==='places';
    if(embedded)for(const child of controls.children)child.hidden=child!==actions;
  }
  function enterFullscreen(){
    const placeholder=doc.createComment('relationship explorer');root.parentNode?.insertBefore(placeholder,root);
    const shell=el('dialog',doc.body,undefined,{class:'tg-fullscreen-shell','aria-label':'Relationship explorer'});
    fullscreen={shell,placeholder};shell.append(root);root.classList.add('is-fullscreen');
    shell.addEventListener('cancel',event=>{event.preventDefault();leaveFullscreen();});
    shell.addEventListener('close',()=>{if(fullscreen?.shell===shell)leaveFullscreen();});
    try{shell.showModal();}catch{shell.setAttribute('open','');}
    fullButton.textContent='Exit full screen';fullButton.setAttribute('aria-pressed','true');
    fullButton.setAttribute('title','Exit full screen (Escape)');readable();fullButton.focus();
  }
  function leaveFullscreen(restoreFocus=true){
    if(!fullscreen)return;
    const {shell,placeholder}=fullscreen;fullscreen=null;
    if(placeholder.parentNode)placeholder.parentNode.insertBefore(root,placeholder);else root.remove();
    placeholder.remove();root.classList.remove('is-fullscreen');
    if(shell.open)shell.close?.();shell.remove();
    fullButton.textContent='Full screen';fullButton.setAttribute('aria-pressed','false');fullButton.setAttribute('title','Full screen');
    if(!disposed){readable();if(restoreFocus)fullButton.focus();}
  }
  function openSource(path,line){leaveFullscreen(false);openNote(path,line);}
  function showDetails(){
    details.hidden=false;details.replaceChildren();
    button(details,'×',()=>showNode(''),{class:'tg-close','aria-label':'Close details',title:'Close details'});
  }
  const onRootKeydown=event=>{
    if(event.key==='Escape'){event.preventDefault();if(fullscreen)leaveFullscreen();else showNode('');}
  };
  root.addEventListener('keydown',onRootKeydown);
  function fit(){if(!layout)return;camera={x:-50,y:-45,w:layout.width+100,h:layout.height+90};applyCamera();}
  function readable(){
    if(state.preset==='places'&&!embedded||!layout)return;
    const rect=svg.getBoundingClientRect(),w=rect.width||900,h=rect.height||600;
    const center=layout.positions.get(state.root)||{x:layout.width/2,y:layout.height/2};
    camera={x:center.x-w/2,y:center.y-h/2,w,h};applyCamera();
  }
  function applyCamera(){svg.setAttribute('viewBox',[camera.x,camera.y,camera.w,camera.h].join(' '));}
  function updateGeometry(){
    const size=1,ratio=1;
    for(const group of svg.querySelectorAll('[data-node]')){
      group.firstElementChild.setAttribute('transform','scale('+size+')');
      const node=visible.nodes.find(n=>n.id===group.getAttribute('data-node')),text=group.querySelector('text');
      const label=relationshipLabel(node);
      text.style.fontSize=label.fontSize+'px';text.style.strokeWidth='3px';text.setAttribute('y',34);
      text.replaceChildren();
      label.lines.forEach((line,i)=>svgEl('tspan',text,{x:0,dy:i?label.lineHeight:0},line));
    }
    for(const text of svg.querySelectorAll('.tg-zone-label')){
      text.style.fontSize=(12*ratio)+'px';
      const full=text.getAttribute('data-label')??text.textContent;text.setAttribute('data-label',full);
      const max=Math.max(15,Math.floor(620/ratio/6.5));text.textContent=full.length>max?full.slice(0,max-1)+'…':full;
    }
    for(const region of membershipEnclosures(visible,layout.positions)){
      const enclosure=[...svg.querySelectorAll('[data-enclosure]')].find(e=>e.getAttribute('data-enclosure')===region.id);
      const mask=doc.getElementById(enclosure.getAttribute('data-mask'));
      mask.replaceChildren();
      const points=region.points.map(p=>p.x+','+p.y).join(' ');
      const xs=region.points.map(p=>p.x),ys=region.points.map(p=>p.y),bounds={x:Math.min(...xs)-4*ratio,y:Math.min(...ys)-4*ratio,
        width:Math.max(...xs)-Math.min(...xs)+8*ratio,height:Math.max(...ys)-Math.min(...ys)+8*ratio};
      for(const [key,value] of Object.entries(bounds))mask.setAttribute(key,String(value));
      svgEl('rect',mask,{...bounds,fill:'white'});
      for(const hole of region.cutouts)svgEl('rect',mask,{x:hole.x,y:hole.y,width:hole.width,height:hole.height,rx:12*ratio,fill:'black','data-excluded':hole.id});
      enclosure.querySelector('polygon').setAttribute('points',points);
    }
    for(const group of svg.querySelectorAll('[data-edge]')){
      const edge=visible.edges.find(e=>e.id===group.getAttribute('data-edge'));
      const a=layout.positions.get(edge.source),b=layout.positions.get(edge.target),dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1;
      const siblings=visible.edges.filter(e=>e.source===edge.source&&e.target===edge.target||e.source===edge.target&&e.target===edge.source);
      const bend=(siblings.indexOf(edge)-(siblings.length-1)/2)*30*size*(edge.source<edge.target?1:-1);
      const path='M '+(a.x+dx/d*20*size)+' '+(a.y+dy/d*20*size)+' Q '+((a.x+b.x)/2-dy/d*bend)+' '+((a.y+b.y)/2+dx/d*bend)+' '+(b.x-dx/d*24*size)+' '+(b.y-dy/d*24*size);
      for(const line of group.querySelectorAll('path'))line.setAttribute('d',path);
    }
  }
  function scale(factor){
    if(!camera)return;const next=Math.max(120,Math.min(20000,camera.w*factor)),ratio=next/camera.w;
    camera={x:camera.x+(camera.w-next)/2,y:camera.y+camera.h*(1-ratio)/2,w:next,h:camera.h*ratio};applyCamera();
  }
  svg.addEventListener('wheel',event=>{
    if(!camera)return;event.preventDefault();
    if(event.ctrlKey||event.metaKey){scale(event.deltaY>0?1.12:.89);return;}
    const rect=svg.getBoundingClientRect(),ratio=Math.max(camera.w/(rect.width||900),camera.h/(rect.height||600));
    const unit=event.deltaMode===1?16:event.deltaMode===2?(rect.height||600):1;
    camera.x+=(event.deltaX||0)*unit*ratio;camera.y+=(event.deltaY||0)*unit*ratio;applyCamera();
  },{passive:false});
  svg.addEventListener('pointerdown',event=>{
    if(event.button!==0||event.target.closest?.('[data-node], [data-edge]')||!camera)return;
    drag={x:event.clientX,y:event.clientY,camera:{...camera}};svg.setPointerCapture?.(event.pointerId);
  });
  svg.addEventListener('pointermove',event=>{
    if(!drag)return;
    const rect=svg.getBoundingClientRect(),ratio=Math.max(camera.w/Math.max(1,rect.width),camera.h/Math.max(1,rect.height));
    camera.x=drag.camera.x-(event.clientX-drag.x)*ratio;camera.y=drag.camera.y-(event.clientY-drag.y)*ratio;applyCamera();
  });
  for(const event of ['pointerup','pointercancel','lostpointercapture'])svg.addEventListener(event,()=>{drag=null;});
  svg.addEventListener('keydown',event=>{
    if(event.target!==svg||!camera)return;
    if(event.key==='+'||event.key==='='){event.preventDefault();scale(.8);}
    if(event.key==='-'){event.preventDefault();scale(1.25);}
    if(event.key==='0'){event.preventDefault();fit();}
    if(event.key==='1'){event.preventDefault();readable();}
    const step=camera.w*.1;
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){
      event.preventDefault();camera.x+=event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0;
      camera.y+=event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0;applyCamera();
    }
  });
  function showEdge(edge) {
    showDetails();
    const source=visible.nodes.find(n=>n.id===edge.source),target=visible.nodes.find(n=>n.id===edge.target);
    el('h3',details,source.name+' → '+target.name);
    el('p',details,edge.label+(edge.status==='past'?' · historical relationship':'')+(edge.uncertain?' · last-known evidence':''));
    if(edge.kind==='mentions'){
      if(edge.earliestDate)el('p',details,'Earliest dated passage: DR '+edge.earliestDate);
    }
    if(edge.implicit)el('p',details,'Default placement in Material Plane; not written to the note.');
    if(!edge.implicit&&!edge.evidence.length)button(details,'Open source note',()=>openSource(edge.source));
    for(const evidence of edge.evidence) {
      if(evidence.date)el('p',details,'Passage dated DR '+evidence.date);
      else if(evidence.before)el('p',details,'Passage before DR '+evidence.before+' · start unknown');
      else if(edge.kind==='mentions')el('p',details,'Undated passage');
      el('blockquote',details,evidence.excerpt);
      button(details,evidence.line===undefined?'Open structured source':'Open passage · line '+(evidence.line+1),()=>openSource(evidence.source,evidence.line));
    }
  }
  function focusNode(id){
    if(embedded)return;
    state.root=id;focus.value=id;draw();
  }
  function showNode(id){
    selected=id;details.hidden=true;details.replaceChildren();
    if(!visible)return;
    placeBoxes.select(id);
    for(const node of svg.querySelectorAll('[data-node]'))node.classList.toggle('is-selected',node.getAttribute('data-node')===id);
    const memberships=visibleMemberships(visible);
    for(const region of svg.querySelectorAll('[data-enclosure]')){
      const membership=memberships.find(g=>g.id===region.getAttribute('data-enclosure'));
      region.classList.toggle('is-selected',membership.id===id||membership.members.includes(id));
    }
    const node=visible.nodes.find(n=>n.id===id);
    if(!node)return;
    showDetails();
    el('h3',details,node.name);
    el('p',details,[node.type==='group'?'Organization':node.type,node.subtype,!node.alive?'Ended / deceased':''].filter(Boolean).join(' · '));
    const ownGroup=memberships.find(g=>g.id===id);
    if(ownGroup)el('p',details,ownGroup.members.length+' visible '+(ownGroup.members.length===1?'member':'members')+'.');
    const memberOf=memberships.filter(g=>g.members.includes(id));
    if(memberOf.length>1)el('p',details,'Shared member of '+memberOf.map(g=>visible.nodes.find(n=>n.id===g.id).name).join(', ')+'.');
    if(node.type==='group'){
      const toggle=button(details,node.expansionStopped?'Expansion off':'Expansion on',()=>{
        const stopped=state.unexpandedOrganizations;
        state.unexpandedOrganizations=stopped.includes(id)?stopped.filter(value=>value!==id):[...stopped,id];
        draw();
      },{'aria-pressed':String(!node.expansionStopped),title:!state.root?'Choose a starting note to control expansion':
        state.root===id?'The starting organization always expands':
        node.expansionStopped?'Allow connections through this organization':'Stop following connections through this organization'});
      toggle.disabled=!state.root||state.root===id;
    }
    if(!node.synthetic)button(details,'Open note',()=>openSource(id));
    if(!embedded)button(details,'Explore from here',()=>focusNode(id));
    el('h4',details,state.preset==='places'?'Connections':'Visible connections');
    const list=el('ul',details);
    for(const edge of visible.edges.filter(e=>e.source===id||e.target===id)) {
      const other=visible.nodes.find(n=>n.id===(edge.source===id?edge.target:edge.source));
      button(el('li',list),detailsLabel(edge,other,id),()=>showEdge(edge));
    }
  }
  const detailsLabel=(edge,other,id)=>(edge.source===id?'→ ':'← ')+edge.label+' · '+other.name;
  function draw(){
    if(disposed||!data)return;
    const graph=filterWorldbuilding(data.graph,state.includeWorldbuilding);
    placeTree=state.preset==='places'?buildPlaceTree(graph):null;
    if(state.root&&!(placeTree?.nodes??graph.nodes).some(n=>n.id===state.root))state.root='';
    sync();
    const places=state.preset==='places'&&!embedded;
    svg.hidden=places;svg.style.display=places?'none':'';zoom.hidden=places;placeContainer.hidden=!places;
    stage.classList.toggle('is-places',places);
    if(places){
      const tree=placeTree;
      visible={...data.graph,nodes:tree.nodes,edges:tree.edges};layout=null;svg.replaceChildren();
      placeBoxes.render(tree,state.root);showNode(selected);renderWarnings(tree.warnings);return;
    }
    visible=queryRelationshipGraph(graph,{...state,...(embedded?{root:initialRoot,depth:1,hideIsolated:false}:{}),kinds:PRESETS[state.preset]});
    layout=layoutRelationships(visible,{mode:'network',previous});
    if(state.mode==='network')previous=layout.positions;
    svg.replaceChildren();
    const defs=svgEl('defs',svg),marker=svgEl('marker',defs,{id:uid+'-arrow',viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:6,markerHeight:6,orient:'auto-start-reverse'});
    svgEl('path',marker,{d:'M 0 0 L 10 5 L 0 10 z',class:'tg-arrow'});
    for(const box of layout.boxes) {
      svgEl('rect',svg,{x:box.x,y:box.y,width:box.width,height:box.height,rx:12,class:'tg-zone'});
      svgEl('text',svg,{x:box.x+15,y:box.y+50,class:'tg-zone-label'},box.label);
    }
    const memberships=visibleMemberships(visible);
    memberships.forEach((region,index)=>{
      const maskId=uid+'-group-mask-'+index;
      svgEl('mask',defs,{id:maskId,maskUnits:'userSpaceOnUse'});
      const group=svgEl('g',svg,{'data-enclosure':region.id,'data-mask':maskId,class:'tg-enclosure','aria-hidden':'true',style:'--tg-enclosure-color:'+membershipColor(region.id)});
      svgEl('polygon',group,{mask:'url(#'+maskId+')'});
    });
    for(const edge of visible.edges) {
      const a=layout.positions.get(edge.source),b=layout.positions.get(edge.target);if(!a||!b)continue;
      const group=svgEl('g',svg,{'data-edge':edge.id,class:'tg-edge'+(edge.undated||edge.uncertain||edge.status==='past'?' tg-edge-dashed':''),tabindex:0,role:'button','aria-label':edge.label});
      svgEl('path',group,{class:'tg-edge-hit'});
      svgEl('path',group,{class:'tg-edge-line','marker-end':'url(#'+uid+'-arrow)'});
      svgEl('title',group,{},edge.label+(edge.status==='past'?' (past)':''));
      group.addEventListener('click',()=>showEdge(edge));
      group.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();showEdge(edge);}});
    }
    for(const node of visible.nodes) {
      const p=layout.positions.get(node.id);
      const group=svgEl('g',svg,{'data-node':node.id,class:'tg-node tg-'+node.type+(node.expansionStopped?' tg-unexpanded':'')+(p.anchored?' tg-anchored':''),transform:'translate('+p.x+' '+p.y+')',tabindex:0,role:'button','aria-label':node.name+' ('+node.type+')'});
      if(node.type==='group'&&memberships.some(g=>g.id===node.id))group.style.setProperty('--tg-group',membershipColor(node.id));
      if(node.type==='person')svgEl('circle',group,{r:16});
      else if(node.type==='group')svgEl('rect',group,{x:-18,y:-16,width:36,height:32,rx:5});
      else svgEl('path',group,{d:'M 0 -21 L 20 0 L 0 21 L -20 0 Z'});
      const label=node.name.length>26?node.name.slice(0,25)+'…':node.name;
      svgEl('text',group,{y:38,'text-anchor':'middle'},label+(node.collapsedCount?' (+'+node.collapsedCount+')':''));
      svgEl('title',group,{},node.name+' · '+node.path+(node.expansionStopped?' · expansion off':''));
      group.addEventListener('click',()=>showNode(node.id));
      group.addEventListener('dblclick',()=>focusNode(node.id));
      group.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();showNode(node.id);}});
    }
    status.textContent=visible.nodes.length+(visible.truncated?'/'+visible.total:'')+' nodes · '+visible.edges.length+' links · DR '+data.graph.date;
    renderWarnings();
    updateGeometry();readable();showNode(selected);
  }
  function renderWarnings(extra=[]){
    warnings.replaceChildren();const allWarnings=[...data.graph.warnings,...(data.warnings??[]),...extra];
    warnings.hidden=!allWarnings.length;
    el('summary',warnings,allWarnings.length+' data warnings');
    for(const message of allWarnings)el('p',warnings,message);
  }
  async function refresh(){
    if(disposed)return;
    const current=++sequence;status.textContent='Loading…';
    try {
      const loaded=await loadData();
      if(disposed||current!==sequence)return;
      data=loaded;
      if(!initialized){
        const initial=data.graph.nodes.find(n=>n.id===state.root);
        if(initial?.type==='place'){state.preset='places';state.mode='containment';}
        else if(!allowedNode(initial))state.root='';
        initialized=true;
      }
      draw();
    }catch(error){
      if(disposed||current!==sequence)return;
      data=null;svg.replaceChildren();placeContainer.replaceChildren();details.replaceChildren();details.hidden=true;status.textContent='Explorer unavailable: '+error.message;
    }
  }
  const onResize=()=>{if(!disposed&&camera)applyCamera();};
  doc.defaultView?.addEventListener('resize',onResize);
  const ready=refresh();
  return {ready,refresh,dispose(){disposed=true;sequence++;placeBoxes.dispose();leaveFullscreen(false);root.removeEventListener('keydown',onRootKeydown);doc.defaultView?.removeEventListener('resize',onResize);root.replaceChildren();root.classList.remove('taelgar-graph','tg-embedded');}};
}

