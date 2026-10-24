import test from 'node:test';
import assert from 'node:assert/strict';
import {mountRelationshipExplorer} from '../src/browser/relationship-explorer.mjs';
import {imageDOM} from './helpers/image-dom.mjs';
const node=(id,type,positions=[])=>({id,path:id,name:id,type,alive:true,positions});
const edge=(source,target,kind)=>({id:source+target+kind,source,target,kind,label:kind,evidence:[]});
const graph={date:'1720-01-01',warnings:[],nodes:[node('Alice','person'),node('Bob','person'),node('Guild','group'),
  node('Town','place',[{map:'world.png',x:.3,y:.5}]),node('Inn','place'),node('Realm','place')],
  edges:[{...edge('Alice','Bob','mentions'),undated:true,evidence:[{source:'Alice',line:8,excerpt:'Alice met [[Bob]]. <script>unsafe</script>'}]},
    edge('Alice','Guild','member'),edge('Bob','Town','current'),edge('Alice','Inn','current'),edge('Inn','Town','contains'),edge('Town','Realm','contains')]};
function dom(){
  const h=imageDOM(),root=h.document.createElement('div');h.document.body.append(root);
  // Linkedom exposes select.value as read-only; real browsers provide this setter.
  const prototype=h.window.HTMLSelectElement.prototype,descriptor=Object.getOwnPropertyDescriptor(prototype,'value');
  if(!descriptor.set)Object.defineProperty(prototype,'value',{...descriptor,set(value){
    const options=[...this.querySelectorAll('option')];
    for(const option of options)option.selected=false;
    const selected=options.find(option=>option.getAttribute('value')===String(value));if(selected)selected.selected=true;
  }});
  return {...h,root};
}
const button=(root,text)=>[...root.querySelectorAll('button')].find(b=>b.textContent===text);
test('explorer inspects safe prose evidence, opens its original line, and hides details until selected',async()=>{
  const h=dom(),opened=[];let reads=0;
  const explorer=mountRelationshipExplorer(h.root,{loadData:async()=>{reads++;return {graph};},openNote:(...args)=>opened.push(args)});
  await explorer.ready;
  assert.equal(h.root.querySelectorAll('[data-node]').length,3);
  assert.equal(h.root.querySelector('.tg-details').hidden,true);
  h.click(h.root.querySelector('[data-edge]'));
  assert.match(h.root.querySelector('.tg-details').textContent,/Undated passage/);
  assert.equal(h.root.querySelector('.tg-details script'),null);
  h.click(button(h.root,'Open passage · line 9'));assert.deepEqual(opened,[['Alice',8]]);
  h.click(button(h.root,'×'));assert.equal(h.root.querySelector('.tg-details').hidden,true);
  assert.equal(h.root.querySelectorAll('[data-node]').length,3);assert.equal(reads,1);
  h.event(h.root.querySelector('[data-node="Alice"]'),'keydown',{key:'Enter'});
  assert.match(h.root.querySelector('.tg-details').textContent,/Visible connections/);
  explorer.dispose();assert.equal(h.root.children.length,0);
});

test('places renders nested boxes, preserves expansion on refresh, and follows the active campaign date',async()=>{
  const h=dom(),dates=[];let campaignDate='1720-01-01';
  const explorer=mountRelationshipExplorer(h.root,{initialRoot:'Town',loadData:async(...args)=>{
    dates.push(args);return {graph:{...graph,date:campaignDate}};
  },openNote(){}});
  await explorer.ready;
  assert.equal(button(h.root,'Places').getAttribute('aria-pressed'),'true');
  assert.equal(h.root.querySelector('.tg-depth').hidden,true);
  assert.ok(h.root.querySelector('[data-place-box="Town"] [data-place-box="Inn"]'));
  assert.equal(h.root.querySelector('[data-node="Alice"]'),null);
  const expand=h.root.querySelector('[aria-label="Expand Inn"]');h.click(expand);
  assert.ok(h.root.querySelector('[data-place-box="Inn"] [data-node="Alice"]'));
  assert.ok(h.root.querySelector('[data-place-box="Town"] [data-node="Bob"]'));
  assert.equal(h.root.querySelector('[data-node="Bob"]').closest('[data-place-box]').getAttribute('data-place-box'),'Town');
  campaignDate='1730-01-01';await explorer.refresh();
  assert.deepEqual(dates,[[],[]]);assert.match(h.root.querySelector('.tg-status').textContent,/1730/);
  assert.ok(h.root.querySelector('[data-node="Alice"]'));
  h.click(h.root.querySelector('[aria-label="Collapse Inn"]'));assert.equal(h.root.querySelector('[data-node="Alice"]'),null);
  h.click(button(h.root,'Full screen'));h.event(h.root,'keydown',{key:'Escape'});
  assert.ok(h.root.querySelector('[aria-label="Expand Inn"]'));
  h.click(button(h.root,'People'));
  assert.equal(h.root.querySelector('.tg-place-browser').hidden,true);
  assert.equal(h.root.querySelector('.tg-depth').hidden,false);
  assert.equal(h.root.querySelector('svg').querySelectorAll('[data-node]').length,3);
  explorer.dispose();
});

test('stale and disposed asynchronous data cannot overwrite a newer graph',async()=>{
  const h=dom(),pending=[];
  const explorer=mountRelationshipExplorer(h.root,{loadData:()=>new Promise(resolve=>pending.push(resolve)),openNote(){}});
  const newer=explorer.refresh();pending[1]({graph:{...graph,date:'1730-01-01'}});await newer;
  pending[0]({graph});await explorer.ready;
  assert.match(h.root.querySelector('.tg-status').textContent,/1730/);
  const closing=explorer.refresh();explorer.dispose();pending[2]({graph});await closing;
  assert.equal(h.root.children.length,0);
});


test('opening from an unrelated note starts with all connected typed nodes and refresh preserves Places',async()=>{
  const h=dom();let reads=0;
  const explorer=mountRelationshipExplorer(h.root,{initialRoot:'Session note',loadData:async()=>{reads++;return {graph};},openNote(){}});
  await explorer.ready;
  assert.equal(h.root.querySelector('[aria-label="Starting note"]').value,'');
  assert.equal(h.root.querySelectorAll('[data-node]').length,3);
  h.click(button(h.root,'Places'));
  await explorer.refresh();assert.equal(button(h.root,'Places').getAttribute('aria-pressed'),'true');
  assert.ok(h.root.querySelector('[data-place-box]'));
  explorer.dispose();const before=reads;await explorer.refresh();assert.equal(reads,before);
});


test('group enclosures preserve reach and counts, highlight shared people, and remain stable through zoom',async()=>{
  const h=dom(),g={...graph,nodes:[...graph.nodes,node('Council','group'),node('Carol','person')],
    edges:[...graph.edges,edge('Alice','Council','leader'),edge('Bob','Guild','member'),
      edge('Carol','Guild','member'),edge('Carol','Council','member')]};
  let reads=0;
  const explorer=mountRelationshipExplorer(h.root,{initialRoot:'Alice',loadData:async()=>{reads++;return {graph:g};},openNote(){}});
  await explorer.ready;
  const depth=h.root.querySelector('[aria-label="Connection depth"]');depth.value='1';h.event(depth,'change');
  const ids=()=>[...h.root.querySelectorAll('[data-node]')].map(n=>n.getAttribute('data-node')).sort();
  assert.deepEqual(ids(),['Alice','Bob','Council','Guild']);
  assert.equal(h.root.querySelector('[data-node="Carol"]'),null);
  assert.equal(h.root.querySelectorAll('[data-enclosure]').length,2);
  h.click(h.root.querySelector('[data-node="Alice"]'));
  assert.equal(h.root.querySelectorAll('[data-enclosure].is-selected').length,2);
  assert.match(h.root.querySelector('.tg-details').textContent,/Shared member of Council, Guild/);
  h.click(h.root.querySelector('[data-node="Guild"]'));
  assert.match(h.root.querySelector('.tg-details').textContent,/2 visible members/);
  const hull=h.root.querySelector('[data-enclosure] polygon').getAttribute('points');
  h.click(button(h.root,'+'));
  assert.equal(h.root.querySelector('[data-enclosure] polygon').getAttribute('points'),hull);
  assert.deepEqual(ids(),['Alice','Bob','Council','Guild']);
  assert.equal(reads,1);
  explorer.dispose();
});

test('prose details distinguish dated evidence from unknown starts and the old history toggle is absent',async()=>{
  const h=dom();
  const g={...graph,edges:graph.edges.map(e=>e.kind==='mentions'?{...e,earliestDate:'1710-01-01',
    evidence:[{source:'Alice',line:8,excerpt:'Met Bob.',date:'1710-01-01'},
      {source:'Alice',line:10,excerpt:'Previously knew Bob.',before:'1700-01-01'}]}:e)};
  const explorer=mountRelationshipExplorer(h.root,{loadData:async()=>({graph:g}),openNote(){}});
  await explorer.ready;
  assert.equal(h.root.querySelector('[aria-label="Include past memberships"]'),null);
  assert.match(h.root.querySelector('.tg-status').textContent,/DR 1720-01-01/);
  h.click(h.root.querySelector('[data-edge]'));
  const details=h.root.querySelector('.tg-details').textContent;
  assert.match(details,/Earliest dated passage: DR 1710-01-01/);
  assert.match(details,/Passage before DR 1700-01-01 · start unknown/);
  explorer.dispose();
});

test('places always shows both current and last-known connections',async()=>{
  const h=dom(),g={...graph,nodes:[...graph.nodes,node('Lost','person')],
    edges:[...graph.edges,{...edge('Lost','Town','lastKnown'),uncertain:true}]};
  const explorer=mountRelationshipExplorer(h.root,{initialRoot:'Town',loadData:async()=>({graph:g}),openNote(){}});
  await explorer.ready;
  assert.equal(h.root.querySelector('[aria-label="Include Worldbuilding"]').checked,false);
  assert.ok(h.root.querySelector('[data-node="Lost"]'));
  assert.match(h.root.querySelector('[data-node="Lost"]').textContent,/Last known/);
  assert.equal(h.root.querySelector('[data-node="Lost"]').closest('[data-place-box]').getAttribute('data-place-box'),'Town');

  assert.ok(h.root.querySelector('[data-node="Bob"]'));
  explorer.dispose();
});

test('readable view wraps labels; fit scales the diagram and scrolling pans without inflating labels',async()=>{
  const h=dom(),long='Heroes of the Great War and the Wandering Knights';
  const g={...graph,nodes:graph.nodes.map(n=>n.id==='Guild'?{...n,name:long}:n)};
  const explorer=mountRelationshipExplorer(h.root,{loadData:async()=>({graph:g}),openNote(){}});
  await explorer.ready;
  const svg=h.root.querySelector('svg'),label=h.root.querySelector('[data-node="Guild"] text');
  assert.ok(label.querySelectorAll('tspan').length>1);
  assert.equal(label.style.fontSize,'13px');
  const camera=()=>svg.getAttribute('viewBox').split(' ').map(Number);
  const start=camera(),points=h.root.querySelector('[data-enclosure] polygon').getAttribute('points');
  h.event(svg,'wheel',{deltaY:100,deltaX:0,deltaMode:0});
  assert.equal(camera()[0],start[0]);assert.ok(camera()[1]>start[1]);assert.equal(camera()[2],start[2]);
  h.event(svg,'wheel',{deltaY:-100,ctrlKey:true});
  assert.ok(camera()[2]<start[2]);assert.equal(label.style.fontSize,'13px');
  h.click(button(h.root,'Fit'));
  assert.equal(h.root.querySelector('[data-enclosure] polygon').getAttribute('points'),points);
  assert.equal(label.style.fontSize,'13px');
  h.click(button(h.root,'100%'));assert.deepEqual(camera(),start);
  h.event(svg,'keydown',{key:'ArrowRight'});assert.ok(camera()[0]>start[0]);
  explorer.dispose();
});

test('connection depth includes one, two, three, or all hops without changing connection kinds',async()=>{
  const h=dom(),g={...graph,nodes:['A','B','C','D','E'].map(id=>node(id,'person')),
    edges:[edge('A','B','mentions'),edge('B','C','mentions'),edge('C','D','mentions'),edge('D','E','mentions')]};
  const explorer=mountRelationshipExplorer(h.root,{initialRoot:'A',loadData:async()=>({graph:g}),openNote(){}});
  await explorer.ready;
  const depth=h.root.querySelector('[aria-label="Connection depth"]');
  for(const [value,count] of [['1',2],['2',3],['3',4],['all',5]]){
    depth.value=value;h.event(depth,'change');
    assert.equal(h.root.querySelectorAll('[data-node]').length,count);
    assert.equal(h.root.querySelectorAll('[data-edge]').length,count-1);
  }
  h.click(button(h.root,'All notes'));assert.equal(h.root.querySelector('[aria-label="Starting note"]').value,'');
  explorer.dispose();
});

test('full screen preserves exploration, restores its tab on Escape or source opening, and cleans up on disposal',async()=>{
  const h=dom(),parent=h.root.parentNode,opened=[];
  const explorer=mountRelationshipExplorer(h.root,{initialRoot:'Alice',loadData:async()=>({graph}),openNote:(...args)=>opened.push(args)});
  await explorer.ready;
  const count=h.root.querySelectorAll('[data-node]').length;
  h.click(button(h.root,'Full screen'));
  let shell=h.document.querySelector('.tg-fullscreen-shell');
  assert.equal(h.root.parentNode,shell);assert.ok(shell.hasAttribute('open'));
  assert.equal(h.root.querySelectorAll('[data-node]').length,count);
  assert.equal(h.root.querySelector('[aria-label="Starting note"]').value,'Alice');
  h.event(h.root,'keydown',{key:'Escape'});
  assert.equal(h.root.parentNode,parent);assert.equal(h.document.querySelector('.tg-fullscreen-shell'),null);
  h.click(button(h.root,'Full screen'));
  // An old dialog's queued close must not close a newly opened one.
  h.event(shell,'close');assert.ok(h.document.querySelector('.tg-fullscreen-shell'));
  h.click(h.root.querySelector('[data-node="Alice"]'));
  h.click(button(h.root,'Open note'));
  assert.deepEqual(opened,[['Alice',undefined]]);assert.equal(h.root.parentNode,parent);
  h.click(button(h.root,'Full screen'));
  h.event(h.document.querySelector('.tg-fullscreen-shell'),'cancel');
  assert.equal(h.root.parentNode,parent);
  h.click(button(h.root,'Full screen'));explorer.dispose();
  assert.equal(h.document.querySelector('.tg-fullscreen-shell'),null);
  assert.equal(h.root.parentNode,parent);assert.equal(h.root.children.length,0);
});

test('Escape and full screen are safe while data is loading',async()=>{
  const h=dom();let resolve;
  const explorer=mountRelationshipExplorer(h.root,{loadData:()=>new Promise(r=>resolve=r),openNote(){}});
  h.event(h.root,'keydown',{key:'Escape'});
  h.click(button(h.root,'Full screen'));h.event(h.root,'keydown',{key:'Escape'});
  resolve({graph});await explorer.ready;explorer.dispose();
});

test('organization expansion toggles reach, preserves direct links, and survives refresh and mode switches',async()=>{
  const h=dom(),g={...graph,nodes:['A','B','D','E','F'].map(id=>node(id,'person')).concat(node('C','group')),
    edges:[edge('A','B','mentions'),edge('B','D','mentions'),...['B','D','E','F'].map(id=>edge(id,'C','member'))]};
  let reads=0;
  const explorer=mountRelationshipExplorer(h.root,{initialRoot:'A',loadData:async()=>{reads++;return {graph:g};},openNote(){}});
  await explorer.ready;
  const depth=h.root.querySelector('[aria-label="Connection depth"]');depth.value='all';h.event(depth,'change');
  h.click(h.root.querySelector('[data-node="C"]'));
  h.click(button(h.root,'Expansion on'));
  const ids=()=>[...h.root.querySelectorAll('[data-node]')].map(n=>n.getAttribute('data-node')).sort();
  assert.deepEqual(ids(),['A','B','C','D']);assert.equal(reads,1);
  assert.equal(button(h.root,'Expansion off').getAttribute('aria-pressed'),'false');
  assert.ok(h.root.querySelector('[data-node="C"]').classList.contains('tg-unexpanded'));
  assert.ok(h.root.querySelector('[data-edge="DCmember"]'));
  h.click(button(h.root,'Full screen'));h.click(button(h.root,'Exit full screen'));
  await explorer.refresh();assert.deepEqual(ids(),['A','B','C','D']);
  h.click(button(h.root,'Places'));h.click(button(h.root,'People'));
  const focus=h.root.querySelector('[aria-label="Starting note"]');focus.value='A';h.event(focus,'change');
  assert.deepEqual(ids(),['A','B','C','D']);
  h.click(h.root.querySelector('[data-node="C"]'));h.click(button(h.root,'Expansion off'));
  assert.deepEqual(ids(),['A','B','C','D','E','F']);
  h.click(button(h.root,'All notes'));h.click(h.root.querySelector('[data-node="C"]'));
  assert.equal(button(h.root,'Expansion on').disabled,true);
  h.click(button(h.root,'Explore from here'));
  assert.equal(button(h.root,'Expansion on').disabled,true);
  explorer.dispose();
});

test('Places searches locate people inside their own box and breadcrumb navigation restores ancestors',async()=>{
 const h=dom(),explorer=mountRelationshipExplorer(h.root,{initialRoot:'Town',loadData:async()=>({graph}),openNote(){}});
 await explorer.ready;
 const input=h.root.querySelector('[aria-label="Starting note"]');input.value='Alice';h.event(input,'change');
 assert.ok(h.root.querySelector('[data-place-box="Inn"] [data-node="Alice"]'));
 assert.equal(h.root.querySelector('[data-place-box="Town"]'),null);
 h.click(button(h.root.querySelector('.tg-place-breadcrumbs'),'Town'));
 assert.ok(h.root.querySelector('[data-place-box="Town"] [data-place-box="Inn"]'));
 explorer.dispose();
});
test('large place lists reveal more children without dropping containment ancestors',async()=>{
 const h=dom(),g={...graph,nodes:[node('Realm','place'),...Array.from({length:45},(_,i)=>node('Town '+i,'place'))],
  edges:Array.from({length:45},(_,i)=>edge('Town '+i,'Realm','contains'))};
 const explorer=mountRelationshipExplorer(h.root,{initialRoot:'Realm',loadData:async()=>({graph:g}),openNote(){}});
 await explorer.ready;
 assert.equal(h.root.querySelectorAll('[data-place-box]').length,41);
 h.click(button(h.root,'Show more (5)'));assert.equal(h.root.querySelectorAll('[data-place-box]').length,46);
 h.click(h.root.querySelector('[aria-label="Collapse Realm"]'));assert.equal(h.root.querySelectorAll('[data-place-box]').length,1);
 h.click(h.root.querySelector('[aria-label="Expand Realm"]'));assert.equal(h.root.querySelectorAll('[data-place-box]').length,46);
 explorer.dispose();
});

test('Include Worldbuilding filters people, organizations, places, suggestions, and survives mode changes',async()=>{
 const h=dom(),person='Worldbuilding/People/Draft.md',org='Worldbuilding/Groups/Draft.md',place='Worldbuilding/Places/Draft.md';
 const g={...graph,nodes:[...graph.nodes,node(person,'person'),node(org,'group'),node(place,'place'),node('Traveler','person')],
  edges:[...graph.edges,edge(person,'Alice','mentions'),edge(person,org,'member'),edge(person,'Town','current'),
    edge(place,'Town','contains'),edge('Traveler',place,'current')]};
 let reads=0;
 const explorer=mountRelationshipExplorer(h.root,{loadData:async()=>{reads++;return {graph:g};},openNote(){}});
 await explorer.ready;
 const checkbox=h.root.querySelector('[aria-label="Include Worldbuilding"]');
 const ids=()=>[...h.root.querySelectorAll('[data-node]')].map(n=>n.getAttribute('data-node'));
 assert.equal(checkbox.checked,false);assert.ok(!ids().includes(person));
 assert.ok(![...h.root.querySelectorAll('datalist option')].some(o=>o.value===person));
 checkbox.checked=true;h.event(checkbox,'change');
 assert.ok(ids().includes(person));assert.ok(ids().includes(org));assert.equal(reads,1);
 const focus=h.root.querySelector('[aria-label="Starting note"]');focus.value=person;h.event(focus,'change');
 checkbox.checked=false;h.event(checkbox,'change');
 assert.equal(focus.value,'');assert.ok(!ids().includes(person));
 checkbox.checked=true;h.event(checkbox,'change');h.click(button(h.root,'Places'));
 focus.value='Town';h.event(focus,'change');
 assert.ok(ids().includes(person));assert.ok(h.root.querySelector('[data-place-box="'+place+'"]'));
 h.click(h.root.querySelector('[data-toggle="'+place+'"]'));
 assert.equal(h.root.querySelector('[data-node="Traveler"]').closest('[data-place-box]').getAttribute('data-place-box'),place);
 checkbox.checked=false;h.event(checkbox,'change');
 assert.ok(!ids().includes(person));assert.ok(!ids().includes(place));assert.ok(!ids().includes('Traveler'));
 assert.ok(ids().includes('Bob'));
 await explorer.refresh();assert.equal(checkbox.checked,false);assert.equal(reads,2);
 h.click(button(h.root,'People'));assert.equal(checkbox.checked,false);assert.ok(!ids().includes(org));
 explorer.dispose();
});

test('place boxes expose distinct icons, accent colors, and type labels without changing containment',async()=>{
 const h=dom(),g={...graph,nodes:[
  {...node('Realm','place'),placeType:'realm',subtype:'duchy'},
  {...node('Road','place'),placeType:'road',subtype:'road'},
  {...node('River','place'),placeType:'waterway',subtype:'river'},
  {...node('Town','place'),placeType:'settlement',subtype:'town'}],
  edges:['Road','River','Town'].map(id=>edge(id,'Realm','contains'))};
 const explorer=mountRelationshipExplorer(h.root,{initialRoot:'Realm',loadData:async()=>({graph:g}),openNote(){}});
 await explorer.ready;
 const colors=new Set();
 for(const [id,kind,label] of [['Realm','realm','duchy'],['Road','road','road'],['River','river','river'],['Town','settlement','town']]){
  const box=h.root.querySelector('[data-place-box="'+id+'"]'),header=box.querySelector('.tg-place-header');
  assert.equal(box.getAttribute('data-place-kind'),kind);
  assert.equal(header.querySelector('.tg-place-icon').getAttribute('aria-hidden'),'true');
  assert.ok(header.querySelector('.tg-place-icon path'));
  assert.equal(header.querySelector('.tg-place-type').textContent,label);
  colors.add(box.style.getPropertyValue('--tg-place-accent'));
 }
 assert.equal(colors.size,4);
 assert.equal(h.root.querySelectorAll('[data-place-box="Realm"] [data-place-box]').length,3);
 explorer.dispose();
});

test('roads and rivers connect visible places and each other while collapsed endpoints remain navigable',async()=>{
  const h=dom(),g={date:'1720-01-01',warnings:[],nodes:[
    node('Realm','place'),node('Town','place'),node('Inn','place'),node('Other','place'),node('Traveler','person'),
    {...node('Road','place'),placeType:'road'},{...node('River','place'),placeType:'waterway',subtype:'river'}],
    edges:[edge('Town','Realm','contains'),edge('Inn','Town','contains'),edge('Road','Realm','contains'),
      edge('River','Realm','contains'),edge('Traveler','Road','current'),edge('Road','Inn','route'),edge('Road','River','route'),edge('River','Other','route')]};
  const explorer=mountRelationshipExplorer(h.root,{initialRoot:'Realm',loadData:async()=>({graph:g}),openNote(){}});
  await explorer.ready;await h.flush();
  assert.equal(h.root.querySelectorAll('.tg-place-route').length,2);
  assert.equal(h.root.querySelector('[data-place-box="Road"]').classList.contains('tg-place-box'),false);
  assert.equal(h.root.querySelectorAll('.tg-route-connection').length,2);
  assert.match(h.root.querySelector('[data-route-endpoint="Inn"]').title,/inside Town/);
  assert.ok(h.root.querySelector('[data-route-endpoint="Other"]'));
  h.click(h.root.querySelector('[aria-label="Expand Town"]'));await h.flush();
  assert.equal(h.root.querySelector('[data-route-endpoint="Inn"]').title,'Explore Inn');
  assert.equal(h.root.querySelectorAll('.tg-route-connection').length,2);
  h.click(h.root.querySelector('[aria-label="Expand Road"]'));await h.flush();
  assert.ok(h.root.querySelector('.tg-place-route [data-node="Traveler"]'));
  h.click(h.root.querySelector('[data-node="Road"]'));
  assert.equal(h.root.querySelectorAll('.tg-route-connection.is-selected').length,2);
  h.click(h.root.querySelector('[data-route-endpoint="Other"]'));await h.flush();
  assert.ok(h.root.querySelector('[data-place-box="Other"]'));
  assert.equal(h.root.querySelector('[data-place-box="Realm"]'),null);
  explorer.dispose();assert.equal(h.resize.size,0);assert.equal(h.frames.size,0);
});

test('Places landing shows only collapsed planes, supports the implicit root, and keeps note actions honest',async()=>{
 const h=dom(),g={...graph,nodes:[...graph.nodes,{...node('Feywild','place'),placeType:'plane'}]};
 const explorer=mountRelationshipExplorer(h.root,{loadData:async()=>({graph:g}),openNote(){}});
 await explorer.ready;h.click(button(h.root,'Places'));
 assert.deepEqual([...h.root.querySelectorAll('[data-place-box]')].map(n=>n.getAttribute('data-place-box')).sort(),['Feywild','implicit:material-plane']);
 h.click(h.root.querySelector('[data-node="implicit:material-plane"]'));
 assert.equal(button(h.root,'Open note'),undefined);
 h.click(button(h.root,'Explore from here'));
 assert.ok(h.root.querySelector('[data-place-box="Realm"]'));
 await explorer.refresh();
 assert.equal(h.root.querySelector('[aria-label="Starting note"]').value,'implicit:material-plane');
 h.click(h.root.querySelector('[data-node="Realm"]'));
 h.click(button(h.root,'→ Within (implicit) · Material Plane'));
 assert.match(h.root.querySelector('.tg-details').textContent,/Default placement in Material Plane/);
 assert.equal(button(h.root,'Open source note'),undefined);
 explorer.dispose();
});

test('embedded diagrams stay on the current note at depth one, including isolated notes and place connections',async()=>{
 for(const id of ['Alice','Town','Lonely','Unsupported']){
  const h=dom(),g={...graph,nodes:[...graph.nodes,node('Lonely','person')]};
  const explorer=mountRelationshipExplorer(h.root,{initialRoot:id,embedded:true,loadData:async()=>({graph:g}),openNote(){}});
  await explorer.ready;
  const ids=[...h.root.querySelectorAll('svg [data-node]')].map(n=>n.getAttribute('data-node')).sort();
  const expected={Alice:['Alice','Bob','Guild'],Town:['Bob','Inn','Realm','Town'],Lonely:['Lonely'],Unsupported:[]};
  assert.deepEqual(ids,expected[id]);assert.equal(h.root.querySelector('.tg-depth').hidden,true);
  assert.equal(h.root.querySelector('.tg-modes').hidden,true);
  if(ids.length){h.click(h.root.querySelector('svg [data-node]'));assert.equal(button(h.root,'Explore from here'),undefined);}
  explorer.dispose();
 }
});
