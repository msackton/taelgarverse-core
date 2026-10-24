import {isRoutePlace} from './place-routes.mjs';
import MarkdownIt from 'markdown-it';
import {createHeaderContext} from './header-core/index.mjs';
import {getPageType} from './header-core/metadata.mjs';
import {validateDate,dateKey} from './common.mjs';
import {filterComments} from './comments.mjs';

export const RELATIONS = Object.freeze({
  member:'Member of',leader:'Leads',organization:'Part of organization',mentions:'Prose mentions',
  contains:'Contained in',secondaryPlace:'Secondary containment',current:'Currently at',
  lastKnown:'Last known at',route:'Connects with',
});
export const PRESETS = Object.freeze({
  people:['member','leader','organization','mentions'],
  places:['contains','secondaryPlace','current','lastKnown','route'],
});
const markdown = new MarkdownIt({html:false});
const targetText = value => typeof value === 'string' ? value.trim().replace(/^!?\[\[|\]\]$/g,'').split('|')[0].split('#')[0].trim() : '';
const basename = path => path.split('/').at(-1).replace(/\.md$/i,'');
const blank = text => text.replace(/[^\n]/g,' ');

// Keep source lines and dated passages; the shared parser validates marker syntax
// and protects code examples. Date blocks date evidence, not the relationship itself.
export function proseMentions(source) {
  let text=String(source).replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/,blank)
    .replace(/<!--[\s\S]*?-->/g,blank);
  const lines=text.split('\n');
  for(let i=0;i<lines.length;i++)if(/^\s*>\s*\[!info\]/i.test(lines[i])) {
    while(i<lines.length&&/^\s*>/.test(lines[i])){lines[i]=blank(lines[i]);i++;}
    i--;
  }
  text=lines.join('\n');
  const spans=[];
  filterComments(text,{date:'9999-12-31',spans});
  const blocks=spans.filter(s=>s.marker);
  const top=spans.filter(s=>s.marker||!blocks.some(b=>s.start>=b.bodyStart&&s.end<=b.bodyEnd)).sort((a,b)=>a.start-b.start);
  const results=[];
  const scan=(start,end,dating={})=>{
    let body=text.slice(start,end);
    for(const span of spans.filter(s=>!s.marker&&s.start>=start&&s.end<=end).sort((a,b)=>b.start-a.start))
      body=body.slice(0,span.start-start)+blank(text.slice(span.start,span.end))+body.slice(span.end-start);
    const offset=text.slice(0,start).split('\n').length-1;
    for(const token of markdown.parse(body,{})) {
      if(token.type!=='inline'||!token.map)continue;
      let inLink=false;
      const add=target=>results.push({target:targetText(target),line:offset+token.map[0],excerpt:token.content,...dating});
      for(const child of token.children??[]) {
        if(child.type==='link_open') {
          inLink=true;const href=child.attrGet('href')??'';
          if(!/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href))try{add(decodeURIComponent(href));}catch{}
        }else if(child.type==='link_close')inLink=false;
        else if(child.type==='text'&&!inLink)for(const match of child.content.matchAll(/(?<!!)\[\[([^\[\]\n]+)\]\]/g))add(match[1]);
      }
    }
  };
  let cursor=0;
  for(const span of top) {
    scan(cursor,span.start);
    if(span.marker) {
      const dated=/^Date:\s*([0-9-]+)(b?)\s*$/i.exec(span.marker);
      if(dated) {
        const key=String(dateKey(dated[1],true)).padStart(8,'0'),value=key.slice(0,4)+'-'+key.slice(4,6)+'-'+key.slice(6);
        scan(span.bodyStart,span.bodyEnd,dated[2]?{before:value}:{date:value});
      }else if(/^Campaign:/i.test(span.marker))scan(span.bodyStart,span.bodyEnd);
    }
    cursor=span.end;
  }
  scan(cursor,text.length);
  return results.filter(item=>item.target);
}
// Optional normalized image positions; no global lat/lon or cross-map guessing.
export function graphPositions(value) {
  if(value==null)return [];
  const list=Array.isArray(value)?value:[value];
  if(list.some(p=>!p || !targetText(p.map) || !Number.isFinite(p.x) || !Number.isFinite(p.y) ||
    p.x<0 || p.x>1 || p.y<0 || p.y>1))throw new Error('graphPositions requires map, x and y; x/y must be numbers between 0 and 1.');
  return list.map(p=>({map:targetText(p.map),x:p.x,y:p.y}));
}

export function buildRelationshipGraph(snapshot,{date,resolve,mentions=[],routes=[]}={}) {
  validateDate(date);
  const {dates,names,locations,affiliations}=createHeaderContext(snapshot,{date});
  const at=dates.normalizeDate(date),nodes=[],edges=[],warnings=[];
  const pages=new Map(snapshot.pages.map(p=>[p.path,p]));
  const lookup=(target,source)=>{
    const clean=targetText(target);if(!clean)return;
    if(resolve){const resolved=resolve(clean,source);return pages.get(resolved?.path??resolved);}
    return pages.get(names.getFileForTarget(clean)?.path);
  };
  const lives=new Map();
  for(const page of snapshot.pages) {
    const type=getPageType(page.metadata);
    if(!['person','group','place'].includes(type))continue;
    try {
      const life=dates.getPageDates(page.metadata,at);if(!life.isCreated)continue;
      lives.set(page.path,life);
      let positions=[];
      try{positions=type==='place'?graphPositions(page.metadata.graphPositions):[];}catch(error){warnings.push(page.path+': '+error.message);}
      nodes.push({id:page.path,path:page.path,name:String(page.metadata.name??page.name??basename(page.path)),
        type,...(type==='place'?{placeType:String(page.metadata.typeOf??'')}:{}),subtype:String(page.metadata.typeOfAlias??page.metadata.typeOf??''),positions,alive:life.isAlive});
    }catch(error){warnings.push(page.path+': '+error.message);}
  }
  nodes.sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
  const byId=new Map(nodes.map(n=>[n.id,n])),byEdge=new Map();
  const add=(source,target,kind,detail={})=>{
    if(!byId.has(source)||!byId.has(target)||source===target)return;
    const id=JSON.stringify([source,target,kind,detail.status??'']);
    let edge=byEdge.get(id);
    if(!edge){edge={id,source,target,kind,label:RELATIONS[kind],evidence:[],...detail};byEdge.set(id,edge);edges.push(edge);}
    if(detail.evidence)edge.evidence=detail.evidence;
    return edge;
  };
  for(const node of nodes) {
    const metadata=pages.get(node.id).metadata;
    try {
      if(node.type==='person')for(const role of affiliations.getAffiliations(metadata,at)) {
        const dest=lookup(role.org,node.id);
        if(getPageType(dest?.metadata)!=='group')continue;
        const edge=add(node.id,dest.path,role.type==='leader'?'leader':'member',{status:role.endDate.sort<at.sort?'past':'current'});
        edge?.evidence.push({source:node.id,field:'affiliations / leaderOf',excerpt:role.title+' · '+role.startDate.display+' – '+role.endDate.display});
      }
      if(node.type==='group') {
        const dest=lookup(metadata.partOf,node.id);
        if(getPageType(dest?.metadata)==='group')add(node.id,dest.path,'organization');
      }
      if(node.type==='place'||node.type==='person'&&node.alive) {
        const where=locations.getWhereabouts(metadata,at);
        // The spatial view is a snapshot: prefer current, otherwise last known.
        // Home/secondary records never create separate person-location edges.
        const entries=node.type==='place'?
          [['contains',where.current.location?where.current:where.lastKnown,!where.current.location],
            ['secondaryPlace',where.secondary,false]]:
          where.current.location?[['current',where.current,false]]:[['lastKnown',where.lastKnown,true]];
        for(const [kind,item,uncertain] of entries) {
          const dest=lookup(item.location,node.id);
          if(getPageType(dest?.metadata)!=='place')continue;
          const edge=add(node.id,dest.path,kind,{uncertain});
          edge?.evidence.push({source:node.id,field:'whereabouts / partOf',
            excerpt:(item.type??'location')+' · '+(item.start?.display??'start unknown')+' – '+(item.end?.display??'end unspecified')});
        }
      }

    }catch(error){warnings.push(node.path+': '+error.message);}
  }
  for(const route of routes){
    const node=byId.get(route.source);if(!isRoutePlace(node))continue;
    const dest=lookup(route.target,route.source);
    if(!dest){
      (node.unresolvedRouteEndpoints??=[]).push({target:route.target,role:route.role});
      continue;
    }
    if(getPageType(dest.metadata)!=='place'||!byId.has(dest.path))continue;
    const edge=add(node.id,dest.path,'route');
    if(edge&&!edge.evidence.some(e=>e.line===route.line&&e.excerpt===route.excerpt))
      edge.evidence.push({source:node.id,line:route.line,excerpt:route.excerpt,role:route.role});
  }
  for(const mention of mentions) {
    if(byId.get(mention.source)?.type!=='person'||mention.date&&dateKey(mention.date)>dateKey(date))continue;
    const target=lookup(mention.target,mention.source);
    if(byId.get(target?.path)?.type!=='person')continue;
    const edge=add(mention.source,target.path,'mentions');
    if(edge && !edge.evidence.some(e=>e.line===mention.line&&e.date===mention.date&&e.before===mention.before))
      edge.evidence.push({source:mention.source,line:mention.line,excerpt:mention.excerpt,...(mention.date?{date:mention.date}:{}),...(mention.before?{before:mention.before}:{})});
  }
  for(const edge of edges.filter(e=>e.kind==='mentions')){
    edge.undated=edge.evidence.some(e=>!e.date);
    edge.earliestDate=edge.evidence.map(e=>e.date).filter(Boolean).sort()[0];
  }
  return {nodes,edges,warnings,date};
}

// Match the vault's folder convention, not names or prose containing the word.
export function isWorldbuildingNode(node) {
  return String(node.path??node.id).replaceAll('\\','/').split('/').slice(0,-1)
    .some(part=>part.toLowerCase()==='worldbuilding');
}
export function filterWorldbuilding(graph,include=true) {
  if(include)return graph;
  const nodes=graph.nodes.filter(n=>!isWorldbuildingNode(n)),ids=new Set(nodes.map(n=>n.id));
  return {...graph,nodes,edges:graph.edges.filter(e=>ids.has(e.source)&&ids.has(e.target))};
}

export function queryRelationshipGraph(graph,{
  preset='people',kinds=PRESETS[preset],root='',depth=2,hideIsolated=true,
  people=true,onlyOccupied=false,collapsed=[],unexpandedOrganizations=[],limit=250,
}={}) {
  const types=new Set(preset==='places'?['person','place']:['person','group']);
  let nodes=graph.nodes.filter(n=>types.has(n.type)),ids=new Set(nodes.map(n=>n.id));
  let edges=graph.edges.filter(e=>kinds.includes(e.kind)&&ids.has(e.source)&&ids.has(e.target));
  // An occupancy view preserves all ancestor paths, including secondary parents.
  if(preset==='places' && onlyOccupied) {
    const keep=new Set(nodes.filter(n=>n.type==='person').map(n=>n.id));
    const parents=new Map();
    for(const e of edges){const list=parents.get(e.source)??[];list.push(e.target);parents.set(e.source,list);}
    const queue=[...keep];
    for(let i=0;i<queue.length;i++)for(const id of parents.get(queue[i])??[])if(!keep.has(id)){keep.add(id);queue.push(id);}
    nodes=nodes.filter(n=>keep.has(n.id));edges=edges.filter(e=>keep.has(e.source)&&keep.has(e.target));
  }
  if(preset==='places'&&!people){nodes=nodes.filter(n=>n.type!=='person');const allowed=new Set(nodes.map(n=>n.id));edges=edges.filter(e=>allowed.has(e.source)&&allowed.has(e.target));}
  const stopped=new Set(nodes.filter(n=>n.type==='group'&&n.id!==root&&unexpandedOrganizations.includes(n.id)).map(n=>n.id));
  const reachOrder=new Map();
  if(root) {
    const adjacency=new Map();
    for(const e of edges)for(const [a,b] of [[e.source,e.target],[e.target,e.source]]) {
      const list=adjacency.get(a)??[];list.push(b);adjacency.set(a,list);
    }
    const seen=new Set(nodes.some(n=>n.id===root)?[root]:[]),queue=[{id:root,d:0}];
    for(let i=0;i<queue.length;i++){
      const {id,d}=queue[i];
      // An organization may be a visible endpoint without serving as a bridge.
      // Other paths can still discover any of its members independently.
      if(stopped.has(id)||(depth!=='all' && d>=Number(depth)))continue;
      for(const next of adjacency.get(id)??[])if(!seen.has(next)){seen.add(next);queue.push({id:next,d:d+1});}
    }
    queue.forEach(({id},i)=>reachOrder.set(id,i));
    nodes=nodes.filter(n=>seen.has(n.id));edges=edges.filter(e=>seen.has(e.source)&&seen.has(e.target));
  }
  const hidden=new Set(),counts=new Map(),children=new Map();
  if(preset==='places') {
    for(const e of edges)if(['contains','secondaryPlace','current','lastKnown'].includes(e.kind)) {
      const list=children.get(e.target)??[];list.push(e.source);children.set(e.target,list);
    }
    for(const id of collapsed) {
      const seen=new Set([id]),queue=[id];
      for(let i=0;i<queue.length;i++)for(const next of children.get(queue[i])??[])if(!seen.has(next)){seen.add(next);queue.push(next);}
      seen.delete(id);counts.set(id,seen.size);for(const child of seen)if(child!==root && !collapsed.includes(child))hidden.add(child);
    }
    nodes=nodes.filter(n=>!hidden.has(n.id));edges=edges.filter(e=>!hidden.has(e.source)&&!hidden.has(e.target));
  }
  if(hideIsolated) {
    const connected=new Set(edges.flatMap(e=>[e.source,e.target]));
    nodes=nodes.filter(n=>connected.has(n.id)||(counts.get(n.id)??0)>0);
  }
  const total=nodes.length;
  if(root)nodes.sort((a,b)=>(reachOrder.get(a.id)??Infinity)-(reachOrder.get(b.id)??Infinity));
  nodes=nodes.slice(0,limit);ids=new Set(nodes.map(n=>n.id));
  edges=edges.filter(e=>ids.has(e.source)&&ids.has(e.target));
  // Truncation must not create isolated nodes when they were explicitly hidden.
  if(hideIsolated) {
    const connected=new Set(edges.flatMap(e=>[e.source,e.target]));
    nodes=nodes.filter(n=>connected.has(n.id)||(counts.get(n.id)??0)>0);
  }
  return {...graph,nodes:nodes.map(n=>({...n,expansionStopped:!!root&&stopped.has(n.id),collapsedCount:counts.get(n.id)??0,childCount:children.get(n.id)?.length??0})),
    edges,total,truncated:total>limit,hiddenCount:hidden.size};
}

