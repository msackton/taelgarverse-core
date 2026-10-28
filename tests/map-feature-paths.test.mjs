import test from 'node:test';
import assert from 'node:assert/strict';
import {parse} from 'yaml';
import {parseHTML} from 'linkedom';
import {validateMapPath,storedMapPath,pathIntersectsCrop} from '../src/map-feature-path.mjs';
import {captureMapPath,patchMapPath} from '../obsidian/taelgarverse/maps/path-persistence.mjs';
import {addMapFeaturePaths} from '../src/browser/map-feature-paths.mjs';
import {writeMapNote} from '../obsidian/taelgarverse/maps/persistence.mjs';
import {MAP_IMPORTANCE} from '../src/map-importance.mjs';
import {hexLevel} from '../src/map-hex-hierarchy.mjs';
const value=()=>({kind:'river',importance:'regional',points:[[5100.123456789,7200.987654321],[5200,7300],[5300,7200]]});

test('river and road metadata preserves bends, crossings and open endpoints; rejects malformed paths',()=>{
  const path=value();assert.deepEqual(validateMapPath(path),path);assert.notEqual(validateMapPath(path).points,path.points);
  const crossing={kind:'road',points:[[1,1],[10,10],[1,10],[10,1],[1,1]]};assert.equal(validateMapPath(crossing).importance,'local');
  for(const patch of [{kind:'lake'},{importance:'oops'},{points:[]},{points:[[1,1]]},{points:[[1,1],[1,1]]},{points:[[0,0],[-1,3]]},{points:[[0,0],[NaN,2]]},{points:[[1,2],['3',4]]},{points:Array.from({length:10001},(_,i)=>[i,0])}]){
    assert.throws(()=>validateMapPath({...path,...patch}));assert.equal(storedMapPath({...path,...patch}),null);
  }
  assert.equal(storedMapPath(null),null);
  assert.ok(pathIntersectsCrop([[4900,7250],[5500,7250]],{x:100,y:100,width:200,height:200},[5000,7000]),'crossing segment survives even with both endpoints outside crop');
  assert.equal(pathIntersectsCrop([[0,0],[1,1]],{x:100,y:100,width:200,height:200},[5000,7000]),false);
});

test('path saves and deletion patch only guarded frontmatter, preserve comments, BOM, CRLF, and unrelated changes',()=>{
  for(const nl of ['\n','\r\n'])for(const bom of ['','\uFEFF']){
    const prefix=bom+['---','name: "River" # Keep','typeOf: waterway',''].join(nl),suffix=['# Next comment','tags: [place]','---','Body [[Link]]',''].join(nl);
    const text=prefix+'mapPath: null'+nl+suffix,guard=captureMapPath(text),result=patchMapPath(text,guard,value());
    assert.equal(result.text,prefix+result.replacement+suffix);assert.deepEqual(captureMapPath(result.text).path,value());
    const changed=result.text.replace('Body','Changed body'),updated=patchMapPath(changed,result.guard,{...value(),kind:'road',importance:'world'});
    assert.ok(updated.text.endsWith(suffix.replace('Body','Changed body')));assert.equal(captureMapPath(updated.text).path.importance,'world');
    assert.throws(()=>patchMapPath(updated.text,result.guard,value()),/changed/);
    const removed=patchMapPath(updated.text,updated.guard,null);assert.equal(removed.text,prefix+suffix.replace('Body','Changed body'));assert.equal(removed.path,null);
    const bare=bom+'# River'+nl+'Body',created=patchMapPath(bare,captureMapPath(bare),value());assert.ok(created.text.endsWith(bare.slice(bom.length)));
    const empty=prefix+suffix,inserted=patchMapPath(empty,captureMapPath(empty),value());assert.deepEqual(captureMapPath(inserted.text).path,value());
  }
  for(const bad of ['---\nname: broken','---\nmapPath: 1\nmapPath: 2\n---\n','---\n{x: 1}\n---\n','---\nx: &a [1]\ny: *a\n---\n'])assert.throws(()=>captureMapPath(bad));
});

test('path writes preserve an open buffer and reject races against atomic vault saves',async()=>{
  let text='---\nname: River\n---\nDraft prose',writes=0,open=true;
  const editor={getValue:()=>text,offsetToPos:x=>x,transaction:({changes:[change]})=>{text=text.slice(0,change.from)+change.text+text.slice(change.to);}};
  const app={workspace:{getLeavesOfType:()=>open?[{view:{file:{path:'River.md'},getMode:()=> 'source',editor}}]:[]},vault:{getAbstractFileByPath:()=>({path:'River.md'}),process:async(file,fn)=>{writes++;text=fn(text);}}};
  const guard=captureMapPath(text);await writeMapNote(app,'River.md',text=>patchMapPath(text,guard,value()));
  assert.equal(writes,0);assert.ok(text.endsWith('Draft prose'));assert.deepEqual(captureMapPath(text).path,value());
  open=false;app.vault.process=async(file,fn)=>{open=true;fn(text);};
  await assert.rejects(writeMapNote(app,'River.md',text=>patchMapPath(text,captureMapPath(text),null)),/opened in an editor/);
});

test('saved paths align through offsets, clip without joining endpoints and reuse SVG across importance zooms',()=>{
  const {document,window}=parseHTML('<figure><div></div></figure>'),canvas=document.querySelector('div'),overlays=[],events={};let scale=.001,opened;
  const L={svgOverlay:(svg,bounds)=>{const overlay={svg,bounds,addTo(){overlays.push(this);return this;},remove(){this.removed=true;}};return overlay;}};
  const map={on:(name,fn)=>events[name]=fn,off:name=>delete events[name],getZoom:()=>0,getZoomScale:()=>scale};
  const config={bounds:[[0,0],[800,1000]],crop:{x:100,y:100,width:200,height:200},sourceOffset:[5000,7000],mapPaths:MAP_IMPORTANCE.map(t=>({...value(),id:t.value,name:'River <unsafe>',importance:t.value}))};
  const api=addMapFeaturePaths(L,map,canvas,config,id=>{opened=id;});
  const svg=overlays[0].svg,groups=[...svg.querySelectorAll('g')],lines=[...svg.querySelectorAll('polyline')];
  assert.equal(lines.length,4);assert.equal(lines[0].getAttribute('points').split(' ').length,3,'no closed segment added');
  assert.equal(lines[0].getAttribute('fill'),'none');assert.match(svg.style.clipPath,/inset/);assert.equal(svg.querySelectorAll('unsafe').length,0);
  assert.deepEqual(groups.map(g=>g.style.display),['','none','none','none']);
  for(let i=1;i<4;i++){scale=18/hexLevel(MAP_IMPORTANCE[i].depth).hexPixels;events.zoomend();assert.equal(groups[i].style.display,'');}
  assert.equal(overlays.length,1);assert.equal(svg.querySelector('polyline'),lines[0]);
  svg.querySelector('a').dispatchEvent(new window.Event('click',{cancelable:true}));assert.equal(opened,'world');
  canvas.classList.add('map-editing');opened=null;svg.querySelector('a').dispatchEvent(new window.Event('click',{cancelable:true}));assert.equal(opened,null);
  api.update({...config,sourceOffset:[4900,6900]});assert.ok(overlays[0].removed);assert.match(overlays[1].svg.querySelector('polyline').getAttribute('points'),/^200\.123/);
  api();assert.ok(overlays[1].removed);assert.equal(events.zoomend,undefined);
});
