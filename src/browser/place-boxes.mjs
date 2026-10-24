import {isPlane} from '../place-tree.mjs';
import {isRoutePlace} from '../place-routes.mjs';
import {placeAppearance} from '../place-appearance.mjs';
// Native nested boxes keep containment explicit and allow ordinary scrolling.
export function mountPlaceBoxes(container,{onSelect,onFocus,onCount}){
  const doc=container.ownerDocument,expanded=new Map(),pages=new Map();
  let tree,root='',selection='',lastRoot,forest,overlay,links=[],frame,disposed=false;
  const win=doc.defaultView;
  const svg=(tag,parent,attrs={})=>{const n=doc.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));parent.append(n);return n;};
  const schedule=()=>{if(!disposed&&!frame)frame=win.requestAnimationFrame(()=>{frame=null;paintConnections();});};
  const observer=win.ResizeObserver?new win.ResizeObserver(schedule):null;
  win.addEventListener('resize',schedule);
  const el=(tag,parent,text,attrs={})=>{
    const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;
    for(const [key,value] of Object.entries(attrs))n.setAttribute(key,String(value));
    parent.append(n);return n;
  };
  const button=(parent,text,action,attrs={})=>{
    const n=el('button',parent,text,{type:'button',...attrs});n.addEventListener('click',action);return n;
  };
  const select=id=>{
    selection=id;
    for(const n of container.querySelectorAll('[data-node]'))n.classList.toggle('is-selected',n.getAttribute('data-node')===id);
    for(const line of container.querySelectorAll('[data-route-source]')){
      const active=line.getAttribute('data-route-source')===id||line.getAttribute('data-route-target')===id;
      line.classList.toggle('is-selected',active);
      line.classList.toggle('is-muted',Boolean(id)&&!active);
    }
  };
  function paintConnections(){
    if(disposed||!overlay||!forest)return;
    overlay.replaceChildren();
    const bounds=forest.getBoundingClientRect(),width=bounds.width,height=bounds.height;
    if(!width||!height)return;
    overlay.setAttribute('viewBox','0 0 '+width+' '+height);
    for(const [index,link] of links.entries()){
      const a=link.from.getBoundingClientRect(),b=link.to.getBoundingClientRect();
      const x1=a.right-bounds.left,y1=(a.top+a.bottom)/2-bounds.top;
      const x2=b.right-bounds.left,y2=(b.top+b.bottom)/2-bounds.top;
      const lane=width-10-(index%10)*7;
      const path=svg('path',overlay,{d:'M '+x1+' '+y1+' H '+lane+' V '+y2+' H '+x2,
        class:'tg-route-connection '+(link.kind==='road'?'is-road':'is-river'),
        stroke:link.color,'data-route-source':link.source,'data-route-target':link.target});
      svg('title',path).textContent=link.label;
      for(const [x,y] of [[x1,y1],[x2,y2]])svg('circle',overlay,{cx:x,cy:y,r:3,fill:link.color});
    }
    select(selection);
  }
  function draw(){
    const scroll=root===lastRoot?container.scrollTop:0;lastRoot=root;
    observer?.disconnect();container.replaceChildren();links=[];overlay=null;let count=0;
    const anchors=new Map(),routeHeaders=new Map();
    let focus=tree.byId.get(root),focusId=focus?.type==='place'?root:tree.parent.get(root);
    if(focusId){
      const ancestors=[];let id=tree.parent.get(focusId);
      while(id){ancestors.unshift(id);id=tree.parent.get(id);}
      const nav=el('nav',container,undefined,{class:'tg-place-breadcrumbs','aria-label':'Place ancestors'});
      button(nav,'All places',()=>onFocus(''));
      for(const id of ancestors){el('span',nav,'›',{'aria-hidden':'true'});button(nav,tree.byId.get(id).name,()=>onFocus(id));}
      el('span',nav,'›',{'aria-hidden':'true'});el('span',nav,tree.byId.get(focusId).name,{'aria-current':'location'});
    }
    forest=el('div',container,undefined,{class:'tg-place-forest'});
    const renderList=(parent,ids,key,level)=>{
      const limit=pages.get(key)??40;
      for(const id of ids.slice(0,limit))renderNode(parent,id,level);
      if(ids.length>limit)button(parent,'Show more ('+(ids.length-limit)+')',()=>{
        pages.set(key,limit+40);draw();
        [...container.querySelectorAll('[data-more]')].find(n=>n.getAttribute('data-more')===key)?.focus();
      },{class:'tg-place-more','data-more':key});
    };
    const renderNode=(parent,id,level)=>{
      const node=tree.byId.get(id),edge=tree.parentEdge.get(id);count++;
      if(node.type==='person'){
        const person=button(parent,node.name,()=>onSelect(id),{class:'tg-place-person','data-node':id,
          title:node.path,'aria-label':node.name+(edge?.kind==='lastKnown'?' · Last known':' · Currently at')});
        if(edge?.kind==='lastKnown')el('span',person,'Last known',{class:'tg-place-badge'});
        return;
      }
      const ids=tree.children.get(id)??[],open=ids.length>0&&(expanded.get(id)??(level===0&&(!isPlane(node)||Boolean(focusId))));
      const appearance=placeAppearance(node),route=isRoutePlace(node);
      const card=el('section',parent,undefined,{class:(route?'tg-place-route':'tg-place-box')+(open?' is-expanded':''),'data-place-box':id,
        'aria-label':node.name,'data-place-kind':appearance.kind,style:'--tg-place-level:'+level+';--tg-place-accent:'+appearance.color});
      const header=el('div',card,undefined,{class:'tg-place-header'});
      anchors.set(id,header);
      if(route)routeHeaders.set(id,{card,header,appearance});
      if(ids.length)button(header,open?'−':'+',()=>{
        expanded.set(id,!open);onSelect('');draw();
        [...container.querySelectorAll('[data-toggle]')].find(n=>n.getAttribute('data-toggle')===id)?.focus();
      },{'data-toggle':id,'aria-label':(open?'Collapse ':'Expand ')+node.name,'aria-expanded':open,title:open?'Collapse':'Expand',class:'tg-place-toggle'});
      const icon=doc.createElementNS('http://www.w3.org/2000/svg','svg');
      for(const [key,value] of Object.entries({class:'tg-place-icon',viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',
        'stroke-width':'1.7','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'}))icon.setAttribute(key,value);
      for(const d of appearance.paths){const path=doc.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',d);icon.append(path);}
      header.append(icon);
      button(header,node.name,()=>onSelect(id),{class:'tg-place-name','data-node':id,title:node.path??'Implicit plane root'});
      el('span',header,appearance.label,{class:'tg-place-type',title:appearance.label});
      if(edge?.uncertain)el('span',header,'Last known',{class:'tg-place-badge'});
      else if(edge?.kind==='secondaryPlace')el('span',header,'Secondary',{class:'tg-place-badge'});
      const places=ids.filter(id=>tree.byId.get(id).type==='place').length,people=ids.length-places;
      const counts=[places?places+' '+(places===1?'place':'places'):'',people?people+' '+(people===1?'person':'people'):''].filter(Boolean);
      if(counts.length)el('span',header,counts.join(' · '),{class:'tg-place-count'});
      if(open){
        const contents=el('div',card,undefined,{class:'tg-place-children'});
        renderList(contents,ids,id,level+1);
      }
    };
    renderList(forest,focusId?[focusId]:tree.roots,'',0);
    // Endpoint chips also provide keyboard navigation when a destination is offscreen.
    for(const [id,{card,header,appearance}] of routeHeaders){
      const endpoints=el('div',card,undefined,{class:'tg-route-endpoints'});header.after(endpoints);
      const connections=tree.edges.filter(e=>e.kind==='route'&&(e.source===id||e.target===id));
      for(const edge of connections){
        const target=edge.source===id?edge.target:edge.source,node=tree.byId.get(target);
        let anchorId=target;
        while(anchorId&&!anchors.has(anchorId))anchorId=tree.parent.get(anchorId);
        const proxy=anchorId&&anchorId!==target;
        button(endpoints,node.name+(proxy?' ↗':''),
          ()=>onFocus(target),{class:'tg-route-endpoint','data-route-endpoint':target,
            title:proxy?node.name+' (inside '+tree.byId.get(anchorId).name+')':'Explore '+node.name});
        // When both route strips are visible, draw their shared link only once.
        if(anchorId&&anchorId!==id&&!(edge.target===id&&routeHeaders.has(edge.source))){
          links.push({source:id,target,from:anchors.get(id),to:anchors.get(anchorId),
            kind:appearance.kind,color:appearance.color,label:tree.byId.get(id).name+' ↔ '+node.name+(proxy?' (inside '+tree.byId.get(anchorId).name+')':'')});
        }
      }
      for(const missing of tree.byId.get(id).unresolvedRouteEndpoints??[])
        el('span',endpoints,missing.target+' ?', {class:'tg-route-unresolved',title:'Endpoint note not found'});
      if(!endpoints.children.length)el('span',endpoints,'No recorded connections',{class:'tg-route-unresolved'});
    }
    if(links.length){
      forest.classList.add('has-route-connections');
      overlay=svg('svg',forest,{class:'tg-route-overlay','aria-hidden':'true',focusable:'false'});
      observer?.observe(forest);
      for(const anchor of anchors.values())observer?.observe(anchor);
      schedule();
    }
    if(!count)el('p',forest,'No places to show.',{class:'tg-place-empty'});
    select(selection);container.scrollTop=scroll;onCount(count);
  }
  return {render(next,startingNote){
    tree=next;
    if(root!==startingNote){
      const id=tree.byId.get(startingNote)?.type==='place'?startingNote:tree.parent.get(startingNote);
      if(id)expanded.set(id,true);
    }
    root=startingNote;draw();
  },select,dispose(){disposed=true;observer?.disconnect();win.removeEventListener('resize',schedule);if(frame)win.cancelAnimationFrame(frame);links=[];}};
}
