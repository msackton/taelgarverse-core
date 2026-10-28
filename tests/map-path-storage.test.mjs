import test from 'node:test';
import assert from 'node:assert/strict';
import {validateMapPath,validateMapPathGeometry,resolveMapPath,pathGeometryText,mapPathSource} from '../src/map-feature-path.mjs';
import {captureMapPath,patchMapPath,readMapPathDocument,saveMapPathNote} from '../obsidian/taelgarverse/maps/path-persistence.mjs';
const value=()=>({kind:'river',importance:'regional',points:[[5100.123456789,7200.987654321],[5200,7300],[5300,7200]]});
function vault(){
  const files=new Map([['River.md','---\nname: "River" # keep\n---\nUnrelated prose.']]),folders=new Set();let beforeProcess=()=>{},afterProcess=()=>{};
  const app={workspace:{getLeavesOfType:()=>[]},metadataCache:{getFileCache:file=>({frontmatter:{mapPath:captureMapPath(files.get(file.path)).path}})},vault:{
    getAbstractFileByPath:path=>files.has(path)?{path,extension:path.split('.').at(-1)}:folders.has(path)?{path}:null,
    getMarkdownFiles:()=>[...files.keys()].filter(p=>p.endsWith('.md')).map(path=>({path})),read:async file=>files.get(file.path),
    createFolder:async path=>folders.add(path),create:async(path,text)=>{assert.equal(files.has(path),false);files.set(path,text);return {path};},
    process:async(file,fn)=>{await beforeProcess(file);files.set(file.path,fn(files.get(file.path)));await afterProcess(file);}
  }};
  const session=async()=>{const guard=captureMapPath(files.get('River.md'));return {path:'River.md',guard,...await readMapPathDocument(app,guard.path),...{path:'River.md'}};};
  return {app,files,session,set beforeProcess(fn){beforeProcess=fn;},set afterProcess(fn){afterProcess=fn;}};
}

test('references are exact vault paths; versioned geometry preserves precision and readable point pairs',()=>{
  for(const source of ['../x.map-path.json','/x.map-path.json','x/../y.map-path.json','x//y.map-path.json','./x.map-path.json','x\\y.map-path.json','https://x.map-path.json','x.map-path.json#part','.hidden/x.map-path.json',' x.map-path.json'])assert.throws(()=>mapPathSource(source));
  const ref={kind:'road',source:'_maps/paths/My road.map-path.json'};assert.equal(validateMapPath(ref).importance,'local');
  assert.throws(()=>validateMapPath({...ref,points:[[1,1],[2,2]]}),/not both/);
  assert.throws(()=>validateMapPathGeometry({version:2,points:value().points}),/version 1/);
  const geometry={version:1,points:value().points},text=pathGeometryText(geometry);
  assert.deepEqual(JSON.parse(text),geometry);assert.equal(text.trimEnd().split('\n').length,8);
  assert.deepEqual(resolveMapPath({...ref,importance:'world'},geometry),{kind:'road',importance:'world',points:value().points});
  assert.throws(()=>resolveMapPath(ref),/version 1/);
});

test('first Save and inline migration create compact note references; later edits reuse the geometry file',async()=>{
  for(const inline of [false,true]){
    const h=vault();if(inline)h.files.set('River.md',patchMapPath(h.files.get('River.md'),captureMapPath(h.files.get('River.md')),value()).text);
    const first=await saveMapPathNote(h.app,await h.session(),value()),ref=captureMapPath(h.files.get('River.md')).path;
    assert.match(ref.source,/^_maps\/paths\/River-[a-f0-9-]+\.map-path\.json$/);assert.equal(ref.points,undefined);
    assert.equal(first.replacement.trimEnd().split('\n').length,4);assert.ok(h.files.get('River.md').endsWith('Unrelated prose.'));
    assert.deepEqual(JSON.parse(h.files.get(ref.source)),{version:1,points:value().points});
    const changed={...value(),kind:'road',importance:'detail',points:[[5000,7100],[5200.123456789,7300]]};
    await saveMapPathNote(h.app,await h.session(),changed);
    assert.equal(captureMapPath(h.files.get('River.md')).path.source,ref.source);assert.equal(h.files.size,2);
    assert.deepEqual((await readMapPathDocument(h.app,captureMapPath(h.files.get('River.md')).path)).path,changed);
    await saveMapPathNote(h.app,await h.session(),null);
    assert.equal(captureMapPath(h.files.get('River.md')).path,null);assert.ok(h.files.has(ref.source),'unlink preserves geometry for recovery or other references');
  }
});

test('failed attachment leaves a named recoverable geometry file and preserves the note',async()=>{
  const h=vault(),before=h.files.get('River.md'),session=await h.session();
  h.beforeProcess=file=>{if(file.path==='River.md')throw new Error('Note write failed');};
  await assert.rejects(saveMapPathNote(h.app,session,value()),/geometry remains at _maps\/paths\/.*draft is retained/);
  assert.equal(h.files.get('River.md'),before);assert.equal(h.files.size,2);
});

test('geometry conflicts retain the draft; note conflicts or closing after a geometry write roll back without overwriting newer files',async()=>{
  const h=vault(),initial=await saveMapPathNote(h.app,await h.session(),value()),source=initial.document.source;
  const old=h.files.get(source),session=await h.session(),next={...value(),points:[[5100,7200],[5400,7400]]};
  h.files.set(source,old+'\n');await assert.rejects(saveMapPathNote(h.app,session,next),/geometry changed/);h.files.set(source,old);
  h.beforeProcess=file=>{if(file.path==='River.md')h.files.set(file.path,h.files.get(file.path).replace('regional','world'));};
  await assert.rejects(saveMapPathNote(h.app,session,next),/saved path changed/);assert.equal(h.files.get(source),old);
  h.beforeProcess=()=>{};let open=true;h.afterProcess=file=>{if(file.path===source)open=false;};
  await assert.rejects(saveMapPathNote(h.app,await h.session(),next,{isOpen:()=>open}),/closed/);assert.equal(h.files.get(source),old);
  h.afterProcess=()=>{};h.beforeProcess=file=>{if(file.path==='River.md'){h.files.set(source,'newer edit');throw new Error('Note failure');}};
  await assert.rejects(saveMapPathNote(h.app,await h.session(),next),/Could not restore geometry/);assert.equal(h.files.get(source),'newer edit');
});

test('shared references fork on edit and open note buffers receive only the small metadata patch',async()=>{
  const h=vault(),first=await saveMapPathNote(h.app,await h.session(),value()),source=first.document.source,original=h.files.get('River.md');
  h.files.set('Other.md',original);
  let buffer=original+'\nUnsaved buffer text.';
  const editor={getValue:()=>buffer,offsetToPos:x=>x,transaction:({changes:[change]})=>{buffer=buffer.slice(0,change.from)+change.text+buffer.slice(change.to);}};
  h.app.workspace.getLeavesOfType=()=>[{view:{file:{path:'River.md'},getMode:()=> 'source',editor}}];
  const guard=captureMapPath(buffer),loaded=await readMapPathDocument(h.app,guard.path);
  const result=await saveMapPathNote(h.app,{path:'River.md',guard,document:loaded.document},{...value(),points:[[1,1],[2,2]]});
  assert.notEqual(result.document.source,source);assert.equal(h.files.get(source),first.document.text);
  assert.equal(h.files.get('River.md'),original);assert.ok(buffer.endsWith('Unsaved buffer text.'));assert.equal(captureMapPath(buffer).path.source,result.document.source);
});
