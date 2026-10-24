// Pure deterministic layouts. Coordinates describe presentation unless anchored=true.
export function layoutRelationships(graph,{mode='network',map='',aspect=1.4,previous=new Map()}={}) {
  const nodes=graph.nodes,ids=new Set(nodes.map(n=>n.id)),parents=new Map();
  for(const e of graph.edges)if(['contains','secondaryPlace','current','lastKnown','organization','member','leader'].includes(e.kind)) {
    const list=parents.get(e.source)??[];list.push(e.target);parents.set(e.source,list);
  }
  if(mode==='geographic') {
    const width=1000,height=width/Math.max(.2,Math.min(5,aspect)),positions=new Map(),groups=new Map();
    for(const n of nodes) {
      const pin=n.positions.find(p=>p.map===map);
      if(pin)positions.set(n.id,{x:pin.x*width,y:pin.y*height,anchored:true});
    }
    for(const n of nodes) {
      if(positions.has(n.id))continue;
      const seen=new Set([n.id]),queue=[n.id];let anchor;
      for(let i=0;i<queue.length && !anchor;i++)for(const next of parents.get(queue[i])??[]) {
        if(positions.get(next)?.anchored){anchor=next;break;}
        if(!seen.has(next)){seen.add(next);queue.push(next);}
      }
      const key=anchor??'',list=groups.get(key)??[];list.push(n);groups.set(key,list);
    }
    const column=Math.max(200,...nodes.filter(n=>!positions.has(n.id)).map(n=>relationshipLabel(n).width+32));
    const boxWidth=column*3+60,baseX=map?1060:0,boxes=[];let y=10;
    for(const [anchor,members] of groups) {
      const h=110+Math.ceil(members.length/3)*150;
      boxes.push({x:baseX,y,width:boxWidth,height:h,label:anchor?
        'Within '+nodes.find(n=>n.id===anchor).name+' — schematic':'Unplaced',anchor});
      members.forEach((n,i)=>positions.set(n.id,{x:baseX+30+column/2+(i%3)*column,y:y+110+Math.floor(i/3)*150,anchored:false}));
      y+=h+30;
    }
    return {positions,boxes,width:groups.size?baseX+50+boxWidth:1100,height:Math.max(map?height+50:300,y),mapBox:{x:0,y:0,width,height}};
  }
  if(mode==='hierarchy') {
    const levels=new Map(),visiting=new Set();
    const depth=id=>{
      if(levels.has(id))return levels.get(id);
      if(visiting.has(id))return 0;
      visiting.add(id);
      const ancestors=(parents.get(id)??[]).filter(p=>ids.has(p));
      const value=ancestors.length?1+Math.min(...ancestors.map(depth)):0;
      visiting.delete(id);levels.set(id,value);return value;
    };
    nodes.forEach(n=>depth(n.id));
    const rows=new Map();
    for(const n of nodes){const d=levels.get(n.id),list=rows.get(d)??[];list.push(n);rows.set(d,list);}
    const width=Math.max(1100,...[...rows.values()].map(row=>row.reduce((sum,n)=>sum+relationshipLabel(n).width+40,100))),positions=new Map();
    for(const [d,row] of rows){
      let x=(width-row.reduce((sum,n)=>sum+relationshipLabel(n).width+40,0))/2;
      for(const n of row){const w=relationshipLabel(n).width;positions.set(n.id,{x:x+w/2,y:85+d*170});x+=w+40;}
    }
    return framePositions(nodes,positions);
  }
  const memberships=visibleMemberships(graph),memberGroups=new Map();
  for(const group of memberships)for(const id of [group.id,...group.members]){
    const groups=memberGroups.get(id)??new Set();groups.add(group.id);memberGroups.set(id,groups);
  }
  const width=Math.max(1100,Math.sqrt(nodes.length)*280),height=Math.max(700,Math.sqrt(nodes.length)*210);
  const positions=new Map(nodes.map((n,i)=>{
    const old=previous.get(n.id),angle=i*2.3999632297,radius=72+Math.sqrt(i)*85;
    return [n.id,old?{...old}:{x:width/2+Math.cos(angle)*radius,y:height/2+Math.sin(angle)*radius}];
  }));
  for(let pass=0;pass<100;pass++) {
    const movement=new Map(nodes.map(n=>[n.id,{x:0,y:0}]));
    for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++) {
      const a=positions.get(nodes[i].id),b=positions.get(nodes[j].id);
      const dx=a.x-b.x||.1,dy=a.y-b.y||.1,d2=Math.max(100,dx*dx+dy*dy);
      const ag=memberGroups.get(nodes[i].id),bg=memberGroups.get(nodes[j].id);
      const shared=ag&&bg&&[...ag].some(id=>bg.has(id)),factor=(shared?260:ag||bg?1800:550)/d2;
      const da=movement.get(nodes[i].id),db=movement.get(nodes[j].id);
      da.x+=dx*factor;da.y+=dy*factor;db.x-=dx*factor;db.y-=dy*factor;
    }
    for(const e of graph.edges) {
      const a=positions.get(e.source),b=positions.get(e.target);if(!a||!b)continue;
      const membership=e.kind==='member'||e.kind==='leader';
      const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1,factor=(d-(membership?145:270))/d*(membership?.10:.03);
      movement.get(e.source).x+=dx*factor;movement.get(e.source).y+=dy*factor;
      movement.get(e.target).x-=dx*factor;movement.get(e.target).y-=dy*factor;
    }
    for(const n of nodes) {
      const p=positions.get(n.id),d=movement.get(n.id),cooling=1-pass/120;
      p.x+=Math.max(-20,Math.min(20,d.x+(width/2-p.x)*.003))*cooling;
      p.y+=Math.max(-20,Math.min(20,d.y+(height/2-p.y)*.003))*cooling;
    }
  }
  separateLabels(nodes,positions);
  separateOrganizationOutsiders(graph,positions);
  return framePositions(nodes,positions);
}


// Group only the filtered graph; this cannot expand reach.
export function visibleMemberships(graph) {
  const types=new Map(graph.nodes.map(n=>[n.id,n.type])),groups=new Map();
  for(const edge of graph.edges) {
    if(!['member','leader'].includes(edge.kind)||types.get(edge.source)!=='person'||types.get(edge.target)!=='group')continue;
    const members=groups.get(edge.target)??new Set();members.add(edge.source);groups.set(edge.target,members);
  }
  return [...groups].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([id,members])=>({id,members:[...members].sort()}));
}
export function membershipColor(id) {
  let hash=0;for(const char of id)hash=(Math.imul(hash,31)+char.codePointAt(0))|0;
  return 'hsl('+((hash>>>0)%360)+' 58% 60%)';
}
// Padded envelopes follow fixed node and label footprints. Nonmembers
// get SVG mask cutouts so incidental placement cannot imply membership.
export function membershipEnclosures(graph,positions) {
  const footprints=new Map(graph.nodes.map(n=>[n.id,nodeFootprint(n,positions.get(n.id))]));
  const cross=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
  const hull=points=>{
    const sorted=points.sort((a,b)=>a.x-b.x||a.y-b.y),lower=[],upper=[];
    for(const p of sorted){while(lower.length>=2&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}
    for(const p of [...sorted].reverse()){while(upper.length>=2&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}
    return lower.slice(0,-1).concat(upper.slice(0,-1));
  };
  return visibleMemberships(graph).map(group=>{
    const included=new Set([group.id,...group.members]),points=[],padding=8;
    for(const id of included) {
      const f=footprints.get(id);
      for(const [x,y] of [[f.x,f.y],[f.x+f.width,f.y],[f.x+f.width,f.y+f.height],[f.x,f.y+f.height]])
        for(let i=0;i<8;i++){const angle=i*Math.PI/4;points.push({x:x+Math.cos(angle)*padding,y:y+Math.sin(angle)*padding});}
    }
    const boundary=hull(points),xs=boundary.map(p=>p.x),ys=boundary.map(p=>p.y);
    const bounds={x:Math.min(...xs),y:Math.min(...ys),right:Math.max(...xs),bottom:Math.max(...ys)};
    const cutouts=graph.nodes.filter(n=>!included.has(n.id)).map(n=>({id:n.id,...footprints.get(n.id)}))
      .filter(f=>f.x<bounds.right&&f.x+f.width>bounds.x&&f.y<bounds.bottom&&f.y+f.height>bounds.y);
    return {...group,color:membershipColor(group.id),points:boundary,cutouts};
  });
}

// Keep unrelated node footprints outside visible organization envelopes where
// possible. Shared members belong to both envelopes and are never excluded.
function separateOrganizationOutsiders(graph,positions) {
  for(let pass=0;pass<6;pass++){
    let moved=false;
    for(const region of membershipEnclosures(graph,positions)){
      const included=new Set([region.id,...region.members]);
      for(const node of graph.nodes){
        if(included.has(node.id))continue;
        const shift=outsideEnvelope(region.points,nodeFootprint(node,positions.get(node.id)));
        if(!shift)continue;
        const p=positions.get(node.id);p.x+=shift.x;p.y+=shift.y;moved=true;
      }
    }
    if(!moved)break;
    separateLabels(graph.nodes,positions);
  }
}

// Separating-axis test: choose the shortest move that puts a rectangle outside
// the convex envelope, with a small visible gap. It also handles edge crossings
// where neither the node center nor an envelope vertex is inside the other.
function outsideEnvelope(polygon,box) {
  const corners=[{x:box.x,y:box.y},{x:box.x+box.width,y:box.y},
    {x:box.x+box.width,y:box.y+box.height},{x:box.x,y:box.y+box.height}];
  const axes=[{x:1,y:0},{x:0,y:1}];
  polygon.forEach((a,i)=>{
    const b=polygon[(i+1)%polygon.length],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
    if(length)axes.push({x:-dy/length,y:dx/length});
  });
  let best;
  for(const axis of axes){
    const project=p=>p.x*axis.x+p.y*axis.y;
    const a=polygon.map(project),b=corners.map(project);
    const minA=Math.min(...a),maxA=Math.max(...a),minB=Math.min(...b),maxB=Math.max(...b);
    if(maxA+12<=minB||maxB+12<=minA)return null;
    const positive=maxA-minB+12,negative=minA-maxB-12;
    const distance=positive<-negative?positive:negative;
    if(!best||Math.abs(distance)<best.distance)best={x:axis.x*distance,y:axis.y*distance,distance:Math.abs(distance)};
  }
  return best;
}

// Shared drawing/layout metrics. Labels stay fixed in graph coordinates so zoom
// scales the whole diagram instead of enlarging labels into neighboring nodes.
export function relationshipLabel(node) {
  const text=node.name+(node.collapsedCount?' (+'+node.collapsedCount+')':''),lines=[];
  let line='';
  for(const word of text.split(/\s+/)){
    if(line&&(line+' '+word).length>26){lines.push(line);line='';}
    let rest=word;
    while(rest.length>26){if(line){lines.push(line);line='';}lines.push(rest.slice(0,26));rest=rest.slice(26);}
    line+=(line?' ':'')+rest;
  }
  if(line)lines.push(line);
  if(lines.length>3){lines.length=3;lines[2]=lines[2].slice(0,25)+'…';}
  if(!lines.length)lines.push('');
  const width=Math.max(56,...lines.map(value=>[...value].reduce((w,c)=>w+(/[MW@#%]/.test(c)?13:/[^\u0000-\u007f]/.test(c)?14:9),0)+20));
  return {lines,width,top:-26,bottom:42+(lines.length-1)*17,fontSize:13,lineHeight:17};
}

export function nodeFootprint(node,position) {
  const label=relationshipLabel(node);
  return {x:position.x-label.width/2,y:position.y+label.top,width:label.width,height:label.bottom-label.top};
}

const overlaps=(a,b,gap=22)=>a.x<b.x+b.width+gap&&a.x+a.width+gap>b.x&&a.y<b.y+b.height+gap&&a.y+a.height+gap>b.y;
function separateLabels(nodes,positions) {
  const metrics=new Map(nodes.map(n=>[n.id,relationshipLabel(n)]));
  const bounds=n=>{
    const p=positions.get(n.id),m=metrics.get(n.id);
    return {x:p.x-m.width/2,y:p.y+m.top,width:m.width,height:m.bottom-m.top};
  };
  // No hard viewport boundary: dense clusters can spread beyond the old canvas.
  for(let pass=0;pass<100;pass++){
    let moved=false;
    for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
      const a=bounds(nodes[i]),b=bounds(nodes[j]);if(!overlaps(a,b))continue;
      const pa=positions.get(nodes[i].id),pb=positions.get(nodes[j].id);
      const dx=(a.x+a.width/2)-(b.x+b.width/2),dy=(a.y+a.height/2)-(b.y+b.height/2);
      const ox=(a.width+b.width)/2+22-Math.abs(dx),oy=(a.height+b.height)/2+22-Math.abs(dy);
      if(ox<oy){const shift=(ox/2+.05)*(dx<0?-1:1);pa.x+=shift;pb.x-=shift;}
      else {const shift=(oy/2+.05)*(dy<0?-1:1);pa.y+=shift;pb.y-=shift;}
      moved=true;
    }
    if(!moved)break;
  }
  // A deterministic final pass guarantees separation even for pathological piles.
  const placed=[];
  for(const n of nodes){
    let box=bounds(n),hit;
    while((hit=placed.find(b=>overlaps(box,b)))){
      positions.get(n.id).y+=hit.y+hit.height+23-box.y;box=bounds(n);
    }
    placed.push(box);
  }
}

function framePositions(nodes,positions) {
  if(!nodes.length)return {positions,boxes:[],width:600,height:400};
  const bounds=nodes.map(n=>nodeFootprint(n,positions.get(n.id)));
  const left=Math.min(...bounds.map(b=>b.x)),top=Math.min(...bounds.map(b=>b.y));
  const right=Math.max(...bounds.map(b=>b.x+b.width)),bottom=Math.max(...bounds.map(b=>b.y+b.height));
  for(const p of positions.values()){p.x+=80-left;p.y+=80-top;}
  return {positions,boxes:[],width:right-left+160,height:bottom-top+160};
}
