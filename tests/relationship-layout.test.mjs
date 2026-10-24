import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutRelationships,visibleMemberships,membershipEnclosures,nodeFootprint,relationshipLabel} from '../src/relationship-layout.mjs';
import {queryRelationshipGraph} from '../src/relationship-graph.mjs';
const node=(id,type)=>({id,path:id,name:id,type,positions:[],alive:true});
const edge=(source,target,kind,status='current')=>({id:source+target+kind,source,target,kind,status});
const graph={
  nodes:[node('Alice','person'),node('Bob','person'),node('Shared','person'),node('Former','person'),node('Outsider','person'),
    node('Guild','group'),node('Council','group'),node('Parent','group')],
  edges:[edge('Alice','Guild','member'),edge('Bob','Council','member'),edge('Shared','Guild','member'),
    edge('Shared','Guild','leader'),edge('Shared','Council','member'),edge('Former','Guild','member','past'),
    edge('Guild','Parent','organization'),edge('Alice','Outsider','mentions')],
};
const inside=(p,polygon)=>polygon.every((a,i)=>{
  const b=polygon[(i+1)%polygon.length];
  return (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x)>=-1e-8;
});

test('enclosures use only visible memberships; reach and edge filters do not expand',()=>{
  const before=JSON.stringify(graph);
  const direct=queryRelationshipGraph(graph,{root:'Alice',depth:1});
  assert.deepEqual(visibleMemberships(direct),[{id:'Guild',members:['Alice']}]);
  const layout=layoutRelationships(direct);
  assert.deepEqual(new Set(layout.positions.keys()),new Set(direct.nodes.map(n=>n.id)));
  const all=queryRelationshipGraph(graph);
  assert.deepEqual(visibleMemberships(all),[
    {id:'Council',members:['Bob','Shared']},{id:'Guild',members:['Alice','Former','Shared']}]);
  assert.deepEqual(visibleMemberships(queryRelationshipGraph(graph,{kinds:['mentions','organization']})),[]);
  assert.deepEqual(visibleMemberships(queryRelationshipGraph(graph,{kinds:['leader']})),[{id:'Guild',members:['Shared']}]);
  assert.ok(visibleMemberships(queryRelationshipGraph(graph)).find(g=>g.id==='Guild').members.includes('Former'));
  assert.equal(JSON.stringify(graph),before);
});

test('shared people have one position inside both envelopes; nonmembers get exclusions and parents do not inherit',()=>{
  const visible=queryRelationshipGraph(graph),positions=new Map([
    ['Former',{x:100,y:250}],['Guild',{x:100,y:100}],['Alice',{x:100,y:400}],['Shared',{x:500,y:250}],
    ['Council',{x:900,y:100}],['Bob',{x:900,y:400}],['Outsider',{x:250,y:250}],['Parent',{x:700,y:100}],
  ]);
  const regions=membershipEnclosures(visible,positions);
  assert.equal(regions.length,2);
  for(const region of regions) {
    assert.ok(inside(positions.get('Shared'),region.points));
    for(const id of [region.id,...region.members])assert.ok(inside(positions.get(id),region.points));
    assert.ok(!region.cutouts.some(c=>c.id==='Shared'));
  }
  assert.ok(regions.find(g=>g.id==='Guild').cutouts.some(c=>c.id==='Outsider'));
  assert.ok(!regions.some(g=>g.id==='Parent'));
  const zoomed=membershipEnclosures(visible,positions,{size:2,ratio:3});
  assert.deepEqual(zoomed[0].points,regions[0].points);
  assert.deepEqual(zoomed.map(g=>g.color),regions.map(g=>g.color));
  for(const mode of ['network','hierarchy','geographic']){
    const layout=layoutRelationships(visible,{mode});
    assert.equal(layout.positions.size,visible.nodes.length);
    assert.equal(membershipEnclosures(visible,layout.positions).length,2);
    for(const p of layout.positions.values())assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));
  }
  assert.deepEqual(layoutRelationships(visible),layoutRelationships(visible));
});

test('crowded groups reserve label space and can grow beyond the original viewport',()=>{
  const names=['Beryl','Empress of Chaos','Landrel','Willow Wind','Vahaiya','Heroes of the Great War'];
  const nodes=Array.from({length:70},(_,i)=>node(names[i%names.length]+' '+i,i%9===0?'group':'person'));
  const edges=nodes.slice(1).map(n=>edge(n.id,nodes[0].id,n.type==='person'?'member':'organization'));
  const g={nodes,edges},before=JSON.stringify(g),previous=new Map(nodes.map(n=>[n.id,{x:80,y:600}]));
  const layout=layoutRelationships(g,{previous});
  assert.equal(layout.positions.size,nodes.length);assert.equal(JSON.stringify(g),before);
  const bounds=nodes.map(n=>nodeFootprint(n,layout.positions.get(n.id)));
  for(let i=0;i<bounds.length;i++){
    const a=bounds[i];
    assert.ok(a.x>=0&&a.y>=0&&a.x+a.width<=layout.width&&a.y+a.height<=layout.height);
    for(let j=i+1;j<bounds.length;j++){
      const b=bounds[j];
      assert.ok(a.x+a.width+20<=b.x||b.x+b.width+20<=a.x||a.y+a.height+20<=b.y||b.y+b.height+20<=a.y,
        'Labels overlap: '+nodes[i].id+' / '+nodes[j].id);
    }
  }
  assert.ok(layout.width>1100||layout.height>700);
  assert.deepEqual(previous.get(nodes[0].id),{x:80,y:600});
  const long=relationshipLabel({name:'The Fellowship of the Wandering Knights of the Northern Mountains'});
  assert.ok(long.lines.length>1);assert.ok(long.lines.length<=3);
});

test('hierarchy separates long labels while preserving distinct levels',()=>{
  const nodes=[node('The Extremely Long Named Northern Organization','group'),
    ...Array.from({length:12},(_,i)=>node('Member of the Distant Northern Mountains '+i,'person'))];
  const g={nodes,edges:nodes.slice(1).map(n=>edge(n.id,nodes[0].id,'member'))},layout=layoutRelationships(g,{mode:'hierarchy'});
  const row=nodes.slice(1).map(n=>nodeFootprint(n,layout.positions.get(n.id)));
  for(let i=1;i<row.length;i++)assert.ok(row[i-1].x+row[i-1].width+20<=row[i].x);
  assert.ok(layout.positions.get(nodes[0].id).y<layout.positions.get(nodes[1].id).y);
});

test('geographic fallback uses the canvas without reserving space for an absent map',()=>{
  const g={nodes:[node('Town','place'),node('Alice','person')],edges:[edge('Alice','Town','current')]};
  const layout=layoutRelationships(g,{mode:'geographic'});
  assert.equal(layout.boxes[0].x,0);
  assert.equal(layout.boxes[0].label,'Unplaced');
  for(const p of layout.positions.values()){
    assert.equal(p.anchored,false);assert.ok(p.x<layout.width&&p.y<layout.height);
  }
  assert.ok(layout.width<1000);
});

test('a visitor linked to several members stays outside the organization outline, including after refresh',()=>{
  const nodes=[node('Guild','group'),...Array.from({length:6},(_,i)=>node('Member '+i,'person')),node('Visitor','person')];
  const edges=nodes.slice(1,-1).flatMap(n=>[edge(n.id,'Guild','member'),edge('Visitor',n.id,'mentions')]);
  const g={nodes,edges},original=JSON.stringify(g);
  let previous=new Map(nodes.map((n,i)=>[n.id,{x:500+Math.cos(i)*80,y:500+Math.sin(i)*80}]));
  for(let refresh=0;refresh<3;refresh++){
    const layout=layoutRelationships(g,{previous}),region=membershipEnclosures(g,layout.positions)[0];
    const visitor=nodeFootprint(nodes.at(-1),layout.positions.get('Visitor'));
    for(const p of [{x:visitor.x,y:visitor.y},{x:visitor.x+visitor.width,y:visitor.y},
      {x:visitor.x+visitor.width,y:visitor.y+visitor.height},{x:visitor.x,y:visitor.y+visitor.height}]){
      assert.equal(inside(p,region.points),false,'Unrelated visitor should stay outside the group');
    }
    for(const id of [region.id,...region.members])assert.ok(inside(layout.positions.get(id),region.points));
    assert.equal(layout.positions.size,nodes.length);
    previous=layout.positions;
  }
  assert.equal(JSON.stringify(g),original);
});
