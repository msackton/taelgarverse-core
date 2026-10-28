import test from 'node:test';
import assert from 'node:assert/strict';
import {captureMapBlock,patchMapBlock,parseMapBlock,mapFences} from '../src/map-block.mjs';
import {openMapSession,saveMapSession} from '../obsidian/taelgarverse/maps/persistence.mjs';

const manifest={version:2,image:'core.png',sourceOffset:[0,0],width:1000,height:800};
const block={version:2,source:'maps/core.map.json'};
const fence=body=>'```taelgar-map\n'+body+'\n```\n';
const source='version: 2\nsource: "maps/core.map.json" # same source\n# Keep this custom field\ncustom: "unchanged" # retain comment\n';
const note='# Original\n\n'+fence(source)+'\nOther text\n'+fence('image: old.png\nbounds: [[0,0],[800,1000]]');
const crop={x:100,y:100,width:500,height:400};

function persistenceHost(initial,{buffers=[]}={}){
  let disk=initial,writes=0;
  const file={path:'Map.md'},editors=buffers.map(value=>({value,transactions:[],getValue(){return this.value;},
    offsetToPos:offset=>offset,transaction(change){this.transactions.push(change);for(const edit of change.changes)this.value=this.value.slice(0,edit.from)+edit.text+this.value.slice(edit.to);}}));
  const app={workspace:{getLeavesOfType:()=>editors.map(editor=>({view:{file,editor,getMode:()=> 'source'}}))},
    vault:{getAbstractFileByPath:()=>file,read:async()=>disk,process:async(file,fn)=>{disk=fn(disk);writes++;}}};
  return {app,editors,get disk(){return disk;},set disk(value){disk=value;},get writes(){return writes;}};
}

test('save changes one fence, assigns an ID only on explicit save, and preserves comments and CRLF',()=>{
  const text=note.replace(/\n/g,'\r\n'),guard=captureMapBlock(text,{source});
  assert.equal(guard.id,undefined);assert.equal(text.includes('id:'),false);
  const result=patchMapBlock(text,guard,{...block,crop},manifest,{newId:()=> 'new-map'});
  assert.equal(result.block.id,'new-map');assert.equal(result.block.custom,'unchanged');
  assert.match(result.text,/source: "maps\/core.map.json" # same source/);
  assert.match(result.text,/# Keep this custom field\r\ncustom: "unchanged" # retain comment/);
  assert.equal(result.text.slice(0,result.from),text.slice(0,result.from));
  assert.equal(result.text.slice(result.from+result.replacement.length),text.slice(result.to));
  assert.equal(result.text.replace(/\r\n/g,'').includes('\n'),false);
  assert.deepEqual(parseMapBlock(result.guard.body).crop,crop);
});

test('block guards tolerate unrelated edits and moved fences but reject changed, deleted and duplicate targets',()=>{
  const text=fence(source+'id: region'),guard=captureMapBlock(text,{id:'region'});
  const result=patchMapBlock('Unrelated dirty text\n'+text,guard,{...block,crop},manifest);
  assert.ok(result.text.startsWith('Unrelated dirty text\n'));assert.equal(mapFences(result.text)[0].data.id,'region');
  for(const changed of [text.replace('custom: "unchanged"','custom: changed'),'',text+text])assert.throws(()=>patchMapBlock(changed,guard,{...block,crop},manifest),/changed|ambiguous/);
  assert.throws(()=>captureMapBlock(text+text,{id:'region',lineHint:0}),/Duplicate/);
  assert.throws(()=>patchMapBlock(text,guard,{...block,source:'another.map.json',crop},manifest),/Source/);
});

test('identical ID-less maps use the observed note guard, never a stale line number',()=>{
  const text=fence(source)+fence(source),guard=captureMapBlock(text,{source,lineHint:0});
  const saved=patchMapBlock(text,guard,{...block,crop},manifest,{newId:()=> 'first-map'});
  assert.equal(mapFences(saved.text)[0].data.id,'first-map');assert.equal(mapFences(saved.text)[1].data.id,undefined);
  assert.throws(()=>patchMapBlock('New line\n'+text,guard,{...block,crop},manifest),/ambiguous/);
});

test('blockquote maps preserve their fence prefix and leave outer fences untouched',()=>{
  const quoted=fence(source).split('\n').filter(Boolean).map(line=>'> '+line).join('\n')+'\n';
  const example='````markdown\n'+fence(source)+'````\n',text=example+quoted;
  const guard=captureMapBlock(text,{source});
  const result=patchMapBlock(text,guard,{...block,crop},manifest,{newId:()=> 'quoted'});
  assert.ok(result.text.startsWith(example));assert.ok(result.replacement.split('\n').filter(Boolean).every(line=>line.startsWith('> ')));
  assert.equal(mapFences(result.text).length,1);assert.deepEqual(parseMapBlock(result.guard.body).crop,crop);
});

test('dirty editor save is a range transaction and retains unsaved text, with no disk write',async()=>{
  const dirty='Unsaved introduction\n'+note,h=persistenceHost(note,{buffers:[dirty]}),session=await openMapSession(h.app,'Map.md',{source});
  h.editors[0].value+='Unsaved ending\n';
  const result=await saveMapSession(h.app,session,{...block,crop},manifest);
  assert.equal(h.writes,0);assert.equal(h.disk,note);assert.ok(h.editors[0].value.startsWith('Unsaved introduction'));
  assert.ok(h.editors[0].value.endsWith('Unsaved ending\n'));assert.equal(h.editors[0].transactions.length,1);assert.equal(result.block.crop.width,500);
});

test('atomic closed-note save rechecks current text and does not overwrite external block edits',async()=>{
  const h=persistenceHost(note),session=await openMapSession(h.app,'Map.md',{source});
  h.disk='Other edit\n'+note;const saved=await saveMapSession(h.app,session,{...block,crop},manifest);
  assert.equal(h.writes,1);assert.ok(h.disk.startsWith('Other edit\n'));
  h.disk=h.disk.replace('width: 500','width: 450');const changed=h.disk;
  await assert.rejects(saveMapSession(h.app,saved.session,{...saved.block,crop:{...crop,width:400}},manifest),/changed/);
  assert.equal(h.disk,changed);assert.equal(h.writes,1);
});

test('divergent split editors and editors opened during atomic save fail without overwriting',async()=>{
  const h=persistenceHost(note,{buffers:[note,note+'Unsaved']}),session={path:'Map.md',guard:captureMapBlock(note,{source})};
  await assert.rejects(saveMapSession(h.app,session,{...block,crop},manifest),/disagree/);
  assert.ok(h.editors.every(e=>e.transactions.length===0));
  const clean=persistenceHost(note);let opened=false;
  clean.app.workspace.getLeavesOfType=()=>opened?[{view:{file:{path:'Map.md'},editor:h.editors[0],getMode:()=> 'source'}}]:[];
  clean.app.vault.process=async(file,fn)=>{opened=true;fn(note);};
  await assert.rejects(saveMapSession(clean.app,session,{...block,crop},manifest),/opened in an editor/);assert.equal(clean.writes,0);
});
