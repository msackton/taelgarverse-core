export const isPlane=node=>node?.type==='place'&&String(node.placeType??node.subtype??'').trim().toLowerCase()==='plane';

// Structural containment for the Places browser; never uses geographic coordinates.
// One canonical parent per node prevents duplication; alternate edges remain inspectable.
export function buildPlaceTree(graph) {
  const byId=new Map(graph.nodes.filter(n=>['place','person'].includes(n.type)).map(n=>[n.id,n]));
  const parent=new Map(),parentEdge=new Map(),warnings=[];
  const priority={contains:0,secondaryPlace:1,current:0,lastKnown:1};
  const candidates=graph.edges.filter(e=>!isPlane(byId.get(e.source))&&byId.get(e.target)?.type==='place'&&
    (byId.get(e.source)?.type==='place'?['contains','secondaryPlace'].includes(e.kind):
      byId.get(e.source)?.type==='person'&&byId.get(e.source).alive!==false&&['current','lastKnown'].includes(e.kind)))
    .sort((a,b)=>priority[a.kind]-priority[b.kind]||a.source.localeCompare(b.source)||a.target.localeCompare(b.target));
  for(const edge of candidates){
    if(parent.has(edge.source))continue;
    let ancestor=edge.target,cycle=false;
    while(ancestor){if(ancestor===edge.source){cycle=true;break;}ancestor=parent.get(ancestor);}
    if(cycle){warnings.push('Containment cycle: '+byId.get(edge.source).name+' → '+byId.get(edge.target).name);continue;}
    parent.set(edge.source,edge.target);parentEdge.set(edge.source,edge);
  }
  // Planes are navigation roots, even when their notes name a cosmological container.
  // Attach only orphan place trees; people without a known location remain unplaced.
  const orphans=[...byId.values()].filter(n=>n.type==='place'&&!isPlane(n)&&!parent.has(n.id));
  const implicitEdges=[];
  if(orphans.length){
    let material=[...byId.values()].filter(isPlane).sort((a,b)=>a.id.localeCompare(b.id)).find(n=>
      [n.name,n.path?.split(/[\\/]/).pop()?.replace(/\.md$/i,'')].some(v=>String(v??'').trim().toLowerCase()==='material plane'));
    if(!material){
      let id='implicit:material-plane';while(byId.has(id))id+=':';
      material={id,name:'Material Plane',type:'place',placeType:'plane',subtype:'plane',alive:true,synthetic:true};
      byId.set(id,material);
    }
    for(const node of orphans){
      const edge={id:'implicit:'+node.id,source:node.id,target:material.id,kind:'contains',
        label:'Within (implicit)',implicit:true,evidence:[]};
      parent.set(node.id,material.id);parentEdge.set(node.id,edge);implicitEdges.push(edge);
    }
  }
  const nodes=[...byId.values()].filter(n=>n.type==='place'||parent.has(n.id));
  const children=new Map(nodes.filter(n=>n.type==='place').map(n=>[n.id,[]]));
  for(const n of nodes)if(parent.has(n.id))children.get(parent.get(n.id)).push(n.id);
  const compare=(a,b)=>{const x=byId.get(a),y=byId.get(b);return (x.type==='place'?0:1)-(y.type==='place'?0:1)||x.name.localeCompare(y.name)||a.localeCompare(b);};
  for(const ids of children.values())ids.sort(compare);
  const roots=nodes.filter(n=>!parent.has(n.id)).map(n=>n.id).sort(compare);
  const ids=new Set(nodes.map(n=>n.id));
  return {nodes,byId,parent,parentEdge,children,roots,warnings,
    edges:[...graph.edges,...implicitEdges].filter(e=>ids.has(e.source)&&ids.has(e.target)&&['contains','secondaryPlace','current','lastKnown','route'].includes(e.kind))};
}
