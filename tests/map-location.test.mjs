import test from 'node:test';
import assert from 'node:assert/strict';
import {parse} from 'yaml';
import {mapLocation,storedMapLocation,captureMapLocation,patchMapLocation} from '../src/map-location.mjs';
import {readMapNote,writeMapNote} from '../obsidian/taelgarverse/maps/persistence.mjs';
import {MAP_IMPORTANCE,importanceVisible} from '../src/map-importance.mjs';
import {hexLevel} from '../src/map-hex-hierarchy.mjs';
import {gridDetail} from '../src/browser/map-baseline.mjs';
import {MAP_SYMBOLS} from '../src/map-symbols.mjs';
import symbols from '../src/map-symbols.json' with {type:'json'};
const point=[5681.234567891234,7601.123456789123];
const patch=(text,guard=captureMapLocation(text))=>patchMapLocation(text,guard,point);

test('town positions retain exact unsnapped pixels and always save a depth-four reference',()=>{
  const position=mapLocation(point);assert.equal(position.x,point[0]);assert.equal(position.y,point[1]);
  assert.match(position.hex,/^16\.10\.C\.07\/[0-6]{4}$/);
  assert.deepEqual(storedMapLocation({...position,hex:'outdated'}),position,'pixels are authoritative when reading');
  for(const invalid of [[NaN,0],[1,Infinity],[-1,2],['5681',7601],[1,100001]])assert.throws(()=>mapLocation(invalid));
  assert.equal(storedMapLocation(null),null);
});

test('importance thresholds follow the same grid scales, including exact boundaries',()=>{
  assert.equal(importanceVisible('world',.001),true);
  for(const tier of MAP_IMPORTANCE.filter(t=>t.depth!==null)){
    const scale=18/hexLevel(tier.depth).hexPixels;
    assert.equal(importanceVisible(tier.value,scale-.0001),false);
    assert.equal(importanceVisible(tier.value,scale),true);
    assert.equal(gridDetail(scale,true),tier.depth);
    assert.equal(importanceVisible(tier.value,64),true,'features remain visible at closer zooms');
  }
});

test('importance defaults and changes preserve exact positions, references and conflict guards',()=>{
  const legacy={x:point[0],y:point[1],hex:'old'};
  assert.equal(storedMapLocation(legacy).importance,'local');
  assert.equal(storedMapLocation({...legacy,importance:'typo'}).importance,'local');
  assert.throws(()=>mapLocation(point,'typo'),/Importance/);
  const initial=patch('# Town\n');
  const ranked=patchMapLocation(initial.text,initial.guard,point,{importance:'regional'});
  assert.deepEqual(ranked.location,{...initial.location,importance:'regional'});
  const moved=patchMapLocation(ranked.text,ranked.guard,[point[0]+1,point[1]+1]);
  assert.equal(moved.location.importance,'regional','an omitted option preserves the saved importance');
  assert.throws(()=>patchMapLocation(ranked.text,initial.guard,point,{importance:'world'}),/position changed/);
});

test('symbol choices round-trip without moving a point, retain defaults and guard concurrent edits',()=>{
  assert.deepEqual(MAP_SYMBOLS.map(s=>s.value).sort(),Object.keys(symbols).sort(),'every offered symbol has bundled artwork');
  const legacy={x:point[0],y:point[1],hex:'old',importance:'world'};
  for(const value of [legacy,{...legacy,symbol:'typo'},{...legacy,symbol:'__proto__'}]){
    const before=structuredClone(value);
    assert.equal(storedMapLocation(value).symbol,'square');assert.deepEqual(value,before,'reading does not rewrite old metadata');
  }
  assert.throws(()=>mapLocation(point,'local','typo'),/Symbol/);
  const initial=patch('# Town\n');
  for(const {value} of MAP_SYMBOLS){
    const selected=patchMapLocation(initial.text,initial.guard,point,{symbol:value});
    assert.deepEqual(selected.location,{...initial.location,symbol:value});
    assert.deepEqual(captureMapLocation(selected.text).location,selected.location);
    const moved=patchMapLocation(selected.text,selected.guard,[point[0]+1,point[1]+1],{importance:'world'});
    assert.equal(moved.location.symbol,value,'moving or editing importance preserves the symbol');
  }
  const changed=patchMapLocation(initial.text,initial.guard,point,{symbol:'gate'});
  assert.throws(()=>patchMapLocation(changed.text,initial.guard,point,{symbol:'dot'}),/position changed/);
});

test('adding a location preserves the entire existing note, frontmatter styles and comments',()=>{
  for(const newline of ['\n','\r\n'])for(const bom of ['','\uFEFF']){
    const head=bom+['---','name: "Town" # keep quotation','tags: [place, status/check]','# Keep this comment',''].join(newline);
    const tail=['---','# Town','','Some **body** and [[Links]].',''].join(newline),text=head+tail,result=patch(text);
    assert.equal(result.text,head+result.replacement+tail);
    assert.deepEqual(captureMapLocation(result.text).location,mapLocation(point));
    assert.equal(patch(result.text).text,result.text,'resaving is stable');
    const plain=bom+'# Town'+newline+'Body',created=patch(plain);
    assert.ok(created.text.startsWith(bom+'---'+newline));assert.ok(created.text.endsWith(plain.slice(bom.length)));
  }
});

test('changing an existing location patches only that field, preserving neighboring comments and prose',()=>{
  for(const old of ['mapLocation: {x: 100, y: 200, hex: old}\n','mapLocation:\n  x: 100\n  y: 200\n  hex: old\n','mapLocation: null\n']){
    const before='---\nname: "Town" # untouched\n# Location comment\n',after='# Next key comment\ntypeOf: settlement\n---\nBody\n';
    const text=before+old+after,result=patch(text);
    assert.equal(result.text,before+result.replacement+after);
    assert.deepEqual(captureMapLocation(result.text).location,mapLocation(point));
  }
  const indented='---\n  name: Town\n  mapLocation: {x: 100, y: 200, hex: old}\n  typeOf: settlement\n---\nBody';
  const updated=patch(indented);assert.ok(updated.text.startsWith('---\n  name: Town\n  mapLocation:\n    x:'));
  assert.deepEqual(captureMapLocation(updated.text).location,mapLocation(point));
  assert.deepEqual(captureMapLocation(patch('---\n  name: Town\n---\nBody').text).location,mapLocation(point));
});

test('location conflicts fail while unrelated concurrent edits remain intact',()=>{
  const initial='---\nname: Town\n---\nBody\n',guard=captureMapLocation(initial);
  const concurrent=initial.replace('name: Town','name: Town\ntags: [place]')+'New prose\n';
  assert.ok(patch(concurrent,guard).text.endsWith('Body\nNew prose\n'));
  const saved=patch(initial);
  assert.throws(()=>patch(saved.text,guard),/position changed/);
  assert.throws(()=>patch(saved.text.replace(String(point[0]),'5000'),saved.guard),/position changed/);
  for(const bad of ['---\nname: Town','---\nname: [\n---\n','---\nname: A\nname: B\n---\n','---\n- Town\n---\n','---\n{name: Town}\n---\n'])
    assert.throws(()=>captureMapLocation(bad),/frontmatter/);
});

test('town saves use live editor transactions, retain unsaved text and never write its stale disk copy',async()=>{
  let text='---\nname: Town\n---\nUnsaved body\n',writes=0,transactions=0;
  const editor={getValue:()=>text,offsetToPos:offset=>offset,transaction({changes}){transactions++;for(const c of changes)text=text.slice(0,c.from)+c.text+text.slice(c.to);}};
  const app={workspace:{getLeavesOfType:()=>[{view:{file:{path:'Town.md'},editor,getMode:()=> 'source'}}]},vault:{process:()=>{writes++;}}};
  const guard=captureMapLocation(await readMapNote(app,'Town.md'));text+='More unsaved work\n';
  await writeMapNote(app,'Town.md',current=>patchMapLocation(current,guard,point));
  assert.equal(writes,0);assert.equal(transactions,1);assert.ok(text.endsWith('Unsaved body\nMore unsaved work\n'));
  assert.deepEqual(parse(text.split('---')[1]).mapLocation,mapLocation(point));
});

test('closed-note town saves patch the latest contents atomically and reject a competing location change',async()=>{
  let text='# Town\n',writes=0;
  const app={workspace:{getLeavesOfType:()=>[]},vault:{getAbstractFileByPath:()=>({path:'Town.md'}),read:async()=>text,
    process:async(file,fn)=>{text=fn(text);writes++;}}};
  const guard=captureMapLocation(await readMapNote(app,'Town.md'));text+='Concurrent prose\n';
  const result=await writeMapNote(app,'Town.md',current=>patchMapLocation(current,guard,point));
  assert.equal(writes,1);assert.ok(text.endsWith('Concurrent prose\n'));
  text=text.replace(String(point[0]),'5000');const changed=text;
  await assert.rejects(writeMapNote(app,'Town.md',current=>patchMapLocation(current,result.guard,point)),/position changed/);
  assert.equal(text,changed);assert.equal(writes,1);
});
