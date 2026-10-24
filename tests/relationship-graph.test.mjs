import test from 'node:test';
import assert from 'node:assert/strict';
import {headerFixture} from './helpers/header-fixture.mjs';
import {buildRelationshipGraph,proseMentions,queryRelationshipGraph,graphPositions,filterWorldbuilding} from '../src/relationship-graph.mjs';
import {layoutRelationships} from '../src/relationship-layout.mjs';

const notes={
  'People/Alice.md':{tags:['person'],born:1700,affiliations:[{org:'Guild',start:'1710-01-01',end:'1725-01-01',title:'Treasurer'}],whereabouts:'Inn'},
  'People/Bob.md':{tags:['person'],aliases:['Robert'],leaderOf:[{place:'Guild',start:'1715-01-01',title:'Master'}],whereabouts:'Town'},
  'People/Dead.md':{tags:['person'],died:'1710-01-01',affiliations:['Guild'],whereabouts:'Town'},
  'People/Future.md':{tags:['person'],born:1760,affiliations:['Guild'],whereabouts:'Town'},
  'People/Visitor.md':{tags:['person'],whereabouts:[{type:'away',location:'Town',start:'1710-01-01',end:'1715-01-01'}]},
  'People/Isolated.md':{tags:['person']},
  'Groups/Guild.md':{tags:['group'],partOf:'Alliance'},
  'Groups/Alliance.md':{tags:['group']},
  'Places/Inn.md':{tags:['place'],whereabouts:'Town'},
  'Places/Town.md':{tags:['place'],aliases:['Old Town'],whereabouts:'Realm',graphPositions:{map:'map.png',x:.4,y:.6}},
  'Places/Realm.md':{tags:['place']},
  'Places/Empty.md':{tags:['place'],whereabouts:'Realm'},
};
function graph(date='1720-01-01',extra={}){
  return buildRelationshipGraph(headerFixture({baseNotes:{...notes,...extra}}).runtime,{date,
    mentions:[{source:'People/Alice.md',target:'Robert',line:4,excerpt:'Alice met [[Robert]].'}]});
}
test('typed relationships reuse dates, aliases, leadership and location services',()=>{
  const g=graph();
  assert.ok(g.edges.some(e=>e.source==='People/Alice.md'&&e.target==='People/Bob.md'&&e.kind==='mentions'&&e.undated));
  assert.ok(g.edges.some(e=>e.source==='People/Bob.md'&&e.target==='Groups/Guild.md'&&e.kind==='leader'));
  assert.ok(g.edges.some(e=>e.source==='Groups/Guild.md'&&e.target==='Groups/Alliance.md'&&e.kind==='organization'));
  assert.ok(g.edges.some(e=>e.source==='Places/Inn.md'&&e.target==='Places/Town.md'&&e.kind==='contains'));
  assert.ok(!g.nodes.some(n=>n.id==='People/Future.md'));
  assert.ok(!g.edges.some(e=>e.source==='People/Dead.md'&&['current','lastKnown'].includes(e.kind)));
  assert.ok(g.edges.some(e=>e.source==='People/Visitor.md'&&e.kind==='lastKnown'&&e.uncertain));
  assert.equal(g.warnings.length,0);
});
test('relationships accumulate up to the cutoff; ended memberships and deceased members remain',()=>{
  const active=queryRelationshipGraph(graph('1725-01-01'));
  assert.ok(active.edges.some(e=>e.source==='People/Alice.md'&&e.kind==='member'));
  const later=graph('1725-01-02');
  assert.ok(queryRelationshipGraph(later).edges.some(e=>e.source==='People/Alice.md'&&e.kind==='member'&&e.status==='past'));
  assert.ok(!queryRelationshipGraph(graph('1709-12-31')).edges.some(e=>e.source==='People/Alice.md'&&e.kind==='member'));
  assert.ok(queryRelationshipGraph(later).nodes.some(n=>n.id==='People/Dead.md'));
  assert.ok(queryRelationshipGraph(later).edges.some(e=>e.source==='People/Alice.md'&&e.kind==='member'&&e.status==='past'));
  assert.ok(queryRelationshipGraph(later).edges.some(e=>e.kind==='mentions'));
  assert.throws(()=>graph('1720-02-30'));
});
test('native source-relative resolution wins over ambiguous names',()=>{
  const runtime=headerFixture({baseNotes:{...notes,'Other/Bob.md':{tags:['person']}}}).runtime;
  const calls=[];
  const g=buildRelationshipGraph(runtime,{date:'1720-01-01',mentions:[{source:'People/Alice.md',target:'Bob',line:1,excerpt:'[[Bob]]'}],
    resolve:(target,source)=>{calls.push([target,source]);return target==='Bob'?{path:'Other/Bob.md'}:undefined;}});
  assert.equal(g.edges.find(e=>e.kind==='mentions').target,'Other/Bob.md');
  assert.ok(calls.some(([target,source])=>target==='Bob'&&source==='People/Alice.md'));
});
test('prose extraction excludes frontmatter, generated info, code, embeds and comments; keeps evidence lines',()=>{
  const source=['---','friend: "[[Wrong]]"','---','# Alice','>[!info]+ Bio','> [[Wrong]]','','Alice met [[Bob#History|Robert]].',
    '','`[[Wrong]]` and ![[Wrong]]','', '~~~taelgar-index','[[Wrong]]','~~~','','%% [[Wrong]] %%','<!-- [[Wrong]] -->',
    '','She met [Bob](People/Bob.md#History).'].join('\n');
  const mentions=proseMentions(source);
  assert.deepEqual(mentions.map(m=>m.target),['Bob','People/Bob.md']);
  assert.equal(mentions[0].line,7);
  assert.match(mentions[0].excerpt,/Robert/);
  assert.equal(mentions[1].line,18);
});
test('filters hide isolates after edge selection, follow incoming edges, and limit hops',()=>{
  const g=graph();
  const direct=queryRelationshipGraph(g,{root:'People/Bob.md',depth:1,kinds:['mentions']});
  assert.deepEqual(new Set(direct.nodes.map(n=>n.name)),new Set(['Alice','Bob']));
  assert.equal(queryRelationshipGraph(g,{kinds:[]}).nodes.length,0);
  assert.ok(queryRelationshipGraph(g,{kinds:[],hideIsolated:false}).nodes.some(n=>n.name==='Isolated'));
  const two=queryRelationshipGraph(g,{root:'People/Alice.md',depth:2});
  assert.ok(two.nodes.some(n=>n.name==='Alliance'));
  const all=queryRelationshipGraph(g,{root:'Groups/Alliance.md',depth:'all'});
  assert.ok(all.nodes.some(n=>n.name==='Alice'));
});
test('occupied places retain ancestors; collapsing keeps a counted parent even without other edges',()=>{
  const g=graph();
  const occupied=queryRelationshipGraph(g,{preset:'places',onlyOccupied:true});
  assert.ok(occupied.nodes.some(n=>n.name==='Realm'));
  assert.ok(occupied.nodes.some(n=>n.name==='Inn'));
  assert.ok(!occupied.nodes.some(n=>n.name==='Empty'));
  const collapsed=queryRelationshipGraph(g,{preset:'places',root:'Places/Town.md',depth:'all',collapsed:['Places/Town.md']});
  assert.ok(!collapsed.nodes.some(n=>n.name==='Alice'||n.name==='Inn'));
  assert.ok(collapsed.nodes.find(n=>n.name==='Town').collapsedCount>=3);
});
test('geographic placement keeps each map independent and unpositioned descendants schematic',()=>{
  const g=queryRelationshipGraph(graph(),{preset:'places'});
  const layout=layoutRelationships(g,{mode:'geographic',map:'map.png',aspect:2});
  assert.deepEqual(layout.positions.get('Places/Town.md'),{x:400,y:300,anchored:true});
  assert.equal(layout.positions.get('Places/Inn.md').anchored,false);
  assert.ok(layout.boxes.some(b=>b.anchor==='Places/Town.md'));
  assert.ok(layout.boxes.some(b=>!b.anchor));
  const other=layoutRelationships(g,{mode:'geographic',map:'other.png'});
  assert.equal([...other.positions.values()].filter(p=>p.anchored).length,0);
  assert.throws(()=>graphPositions({map:'map.png',x:12,y:.5}),/between 0 and 1/);
});
test('cycles and multiple parents terminate; layouts remain finite and filters never mutate the input',()=>{
  const g=graph('1720-01-01',{'Places/Realm.md':{tags:['place'],whereabouts:'Town'}});
  const original=JSON.stringify(g);
  const visible=queryRelationshipGraph(g,{preset:'places',onlyOccupied:true,root:'Places/Town.md',depth:'all'});
  for(const mode of ['hierarchy','network','geographic']){
    const layout=layoutRelationships(visible,{mode,map:'map.png'});
    assert.equal(layout.positions.size,visible.nodes.length);
    for(const p of layout.positions.values())assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));
  }
  queryRelationshipGraph(g,{preset:'places',collapsed:['Places/Town.md']});
  assert.equal(JSON.stringify(g),original);
});


test('occupied-place filtering works with people hidden and isolated nodes removed',()=>{
  const visible=queryRelationshipGraph(graph(),{preset:'places',onlyOccupied:true,people:false});
  assert.ok(visible.nodes.every(n=>n.type==='place'));
  assert.ok(visible.nodes.some(n=>n.name==='Inn'));
  assert.ok(visible.nodes.some(n=>n.name==='Realm'));
  assert.ok(!visible.nodes.some(n=>n.name==='Empty'));
});
test('multiple parents are retained and limits prioritize the selected neighborhood',()=>{
  const g=graph('1720-01-01',{'Places/Inn.md':{tags:['place'],whereabouts:[{type:'home',location:'Town'},{type:'secondary',location:'Realm'}]}});
  assert.deepEqual(new Set(g.edges.filter(e=>e.source==='Places/Inn.md').map(e=>e.target)),new Set(['Places/Town.md','Places/Realm.md']));
  const limited=queryRelationshipGraph(g,{root:'Groups/Alliance.md',depth:'all',limit:3});
  assert.equal(limited.truncated,true);assert.ok(limited.nodes.some(n=>n.id==='Groups/Alliance.md'));
  assert.ok(limited.edges.some(e=>e.target==='Groups/Alliance.md'));
  for(const n of limited.nodes)assert.ok(limited.edges.some(e=>e.source===n.id||e.target===n.id));
});


test('dated prose keeps before-state history, excludes administrative material and preserves paragraph source lines',()=>{
  const source=['---','tags: [person]','---','[[Bob]] is known.',
    '%%^Date:1720-06%%','Met [[Bob]] and [Carol](Carol.md).','%%^End%%',
    '%%^Date:1710b%%','Once knew [[Former]].','%%^End%%',
    '%%^Campaign:dufr%%','[[Campaign friend]]','%%^End%%',
    '%%^Lint%%','[[Wrong]]; example \x60%%^Date:2000%%\x60','%%^End%%',
    '%%^Metadata:x%%','[[Wrong]]','%%^End%%',
    '~~~md','%%^Date:2200%%','[[Wrong]]','%%^End%%','~~~',
    '%%^Date:1730%%A [[Later]] mention.%%^End%%',
    '%%^Date:1740%%','Text %% private [[Wrong]] %% and [[Newest]].','%%^End%%'].join('\n');
  const found=proseMentions(source);
  assert.deepEqual(found.map(m=>[m.target,m.line,m.date,m.before]),[
    ['Bob',3,undefined,undefined],['Bob',5,'1720-06-01',undefined],['Carol.md',5,'1720-06-01',undefined],
    ['Former',8,undefined,'1710-01-01'],['Campaign friend',11,undefined,undefined],
    ['Later',24,'1730-01-01',undefined],['Newest',26,'1740-01-01',undefined]]);
  assert.throws(()=>proseMentions('%%^Date:1720-02-30%%[[Wrong]]%%^End%%'),/invalid date/);
  assert.throws(()=>proseMentions('%%^Date:1720a%%[[Wrong]]%%^End%%'),/unsupported/);
  assert.throws(()=>proseMentions('%%^Date:1720%%[[Wrong]]'),/unterminated/);
});

test('prose evidence is filtered individually by cutoff and reports earliest dated passage without losing undated history',()=>{
  const runtime=headerFixture({baseNotes:{...notes,'People/Carol.md':{tags:['person']}}}).runtime;
  const source='%%^Date:1720-06-01%%First met [[Bob]].%%^End%%\n'+
    '%%^Date:1730%%Later [[Bob]] and [[Carol]].%%^End%%\n'+
    'An undated [[Carol]] mention.\n%%^Date:1710b%%Once knew [[Carol]].%%^End%%';
  const mentions=proseMentions(source).map(m=>({...m,source:'People/Alice.md'}));
  const get=date=>buildRelationshipGraph(runtime,{date,mentions}).edges.filter(e=>e.kind==='mentions');
  assert.deepEqual(get('1720-05-31').map(e=>e.target),['People/Carol.md']);
  const at=get('1720-06-01'),bob=at.find(e=>e.target==='People/Bob.md'),carol=at.find(e=>e.target==='People/Carol.md');
  assert.equal(bob.earliestDate,'1720-06-01');assert.equal(bob.undated,false);assert.equal(bob.evidence.length,1);
  assert.equal(carol.earliestDate,undefined);assert.equal(carol.undated,true);assert.equal(carol.evidence.length,2);
  assert.ok(carol.evidence.some(e=>e.before==='1710-01-01'));
  const later=get('1740-01-01');
  assert.equal(later.find(e=>e.target==='People/Bob.md').evidence.length,2);
  assert.equal(later.find(e=>e.target==='People/Carol.md').earliestDate,'1730-01-01');
  assert.equal(later.find(e=>e.target==='People/Carol.md').undated,true);
});


test('spatial view uses current or last known, never separate homes or former paths',()=>{
  const extra={
    'People/Traveller.md':{tags:['person'],whereabouts:[
      {type:'home',location:'Inn',start:1700},{type:'away',location:'Town',start:1715,end:1716},
      {type:'away',location:'Realm',start:1719,end:1721},{type:'secondary',location:'Empty',start:1710},
      {type:'away',location:'Empty',start:1730,end:1731}]},
    'People/Lost.md':{tags:['person'],whereabouts:[
      {type:'home',location:'Inn',start:1700,end:1710},{type:'away',location:'Town',start:1715,end:1716},
      {type:'away',location:'Realm',start:1719,end:1719},{type:'away',start:1720}]},
    'People/Unknown.md':{tags:['person'],whereabouts:[{type:'away',location:'Town',start:1730}]},
    'People/Ended.md':{tags:['person'],died:1719,affiliations:['Guild'],whereabouts:'Town'},
    'Places/Moving.md':{tags:['place'],whereabouts:[
      {type:'home',location:'Town',start:1700,end:1710},{type:'home',location:'Realm',start:1711}]},
  };
  const raw=graph('1720-01-01',extra),g=queryRelationshipGraph(raw,{preset:'places'});
  const spatial=id=>g.edges.filter(e=>e.source==='People/'+id+'.md').map(e=>[e.kind,e.target,e.uncertain]);
  assert.deepEqual(spatial('Traveller'),[['current','Places/Realm.md',false]]);
  assert.deepEqual(spatial('Lost'),[['lastKnown','Places/Realm.md',true]]);
  assert.deepEqual(spatial('Unknown'),[]);
  assert.deepEqual(spatial('Ended'),[]);
  assert.ok(queryRelationshipGraph(raw).edges.some(e=>e.source==='People/Ended.md'&&e.kind==='member'));
  assert.ok(!g.edges.some(e=>e.kind==='home'||e.kind==='secondary'));
  assert.deepEqual(g.edges.filter(e=>e.source==='Places/Moving.md').map(e=>e.target),['Places/Realm.md']);
  const lastOnly=queryRelationshipGraph(raw,{preset:'places',kinds:['lastKnown']});
  assert.ok(!lastOnly.nodes.some(n=>n.id==='People/Traveller.md'));
  assert.ok(lastOnly.nodes.some(n=>n.id==='People/Lost.md'));
  const layout=layoutRelationships(g,{mode:'geographic',map:'map.png'});
  const lostBox=layout.boxes.find(b=>b.anchor==='Places/Realm.md');
  // Realm is unpositioned; neither Lost nor Traveller is anchored to their old Town.
  assert.equal(lostBox,undefined);
  const townBox=layout.boxes.find(b=>b.anchor==='Places/Town.md');
  assert.ok(townBox);
  assert.ok(layout.positions.get('People/Traveller.md').x>=1060);
});

test('expired visits become last known while current visits are inclusive at their end',()=>{
  const kind=date=>graph(date).edges.filter(e=>e.source==='People/Visitor.md').map(e=>e.kind);
  assert.deepEqual(kind('1715-01-01'),['current']);
  assert.deepEqual(kind('1715-01-02'),['lastKnown']);
  const empty=graph('1709-12-31').edges.filter(e=>e.source==='People/Visitor.md');
  assert.deepEqual(empty,[]);
});

test('an unexpanded organization stops traversal but keeps independently reached members and their edges',()=>{
  const nodes=['A','B','D','E','F'].map(id=>({id,name:id,type:'person'}))
    .concat(['C','Parent'].map(id=>({id,name:id,type:'group'})));
  const edge=(source,target,kind)=>({id:source+target,source,target,kind});
  const edges=[edge('A','B','mentions'),edge('B','D','mentions'),edge('B','C','member'),
    edge('D','C','leader'),edge('E','C','member'),edge('F','C','member'),edge('C','Parent','organization')];
  const g={nodes,edges},original=JSON.stringify(g);
  const ids=result=>result.nodes.map(n=>n.id).sort();
  for(const depth of [3,'all']){
    const result=queryRelationshipGraph(g,{root:'A',depth,unexpandedOrganizations:['C']});
    assert.deepEqual(ids(result),['A','B','C','D']);
    assert.ok(result.nodes.find(n=>n.id==='C').expansionStopped);
    assert.ok(result.edges.some(e=>e.source==='D'&&e.target==='C'));
    assert.deepEqual(ids(queryRelationshipGraph(g,{root:'A',depth})),['A','B','C','D','E','F','Parent']);
  }
  const alternate={nodes,edges:[...edges,edge('D','E','mentions')]};
  assert.deepEqual(ids(queryRelationshipGraph(alternate,{root:'A',depth:3,unexpandedOrganizations:['C']})),['A','B','C','D','E']);
  assert.deepEqual(ids(queryRelationshipGraph(alternate,{root:'A',depth:2,unexpandedOrganizations:['C']})),['A','B','C','D']);
  assert.deepEqual(ids(queryRelationshipGraph(g,{unexpandedOrganizations:['C']})),ids(queryRelationshipGraph(g)));
  const rooted=queryRelationshipGraph(g,{root:'C',depth:1,unexpandedOrganizations:['C']});
  assert.deepEqual(ids(rooted),['B','C','D','E','F','Parent']);
  assert.equal(rooted.nodes.find(n=>n.id==='C').expansionStopped,false);
  assert.equal(JSON.stringify(g),original);
});

test('Worldbuilding filtering covers folder descendants and all types without matching ordinary note names',()=>{
 const n=(id,type)=>({id,path:id,name:id,type});
 const nodes=[n('People/A.md','person'),n('Worldbuilding/People/B.md','person'),
  n('Worldbuilding/Tentative/Org.md','group'),n('Archive/worldbuilding/Place.md','place'),
  n('Worldbuilding Notes/Kept.md','place'),n('People/Worldbuilding.md','person'),
  n('Worldbuilding\\Drafts\\Windows.md','person')];
 const g={nodes,edges:nodes.slice(1).map(n=>({source:nodes[0].id,target:n.id,kind:'mentions'}))};
 const before=JSON.stringify(g),filtered=filterWorldbuilding(g,false);
 assert.deepEqual(filtered.nodes.map(n=>n.id),['People/A.md','Worldbuilding Notes/Kept.md','People/Worldbuilding.md']);
 assert.equal(filtered.edges.length,2);
 assert.equal(filterWorldbuilding(g,true),g);assert.equal(JSON.stringify(g),before);
});
