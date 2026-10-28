import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {parseHTML} from 'linkedom';
import {ROOT} from '../src/config.mjs';
import {captureMapPath,patchMapPath} from '../obsidian/taelgarverse/maps/path-persistence.mjs';
const require=createRequire(import.meta.url),plain=x=>JSON.parse(JSON.stringify(x));
const bundle=await build({absWorkingDir:ROOT,entryPoints:['obsidian/taelgarverse/maps/paths.mjs'],bundle:true,write:false,format:'cjs',platform:'node',external:['obsidian']});
const tick=()=>new Promise(setImmediate);
function host({editable=true}={}){
  const {document,window}=parseHTML('<figure><div class="map-canvas"></div><figcaption></figcaption></figure>');
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return [...this.options].find(o=>o.selected)?.value??this.options[0]?.value??'';},set(value){for(const o of this.options)o.removeAttribute('selected');const target=[...this.options].find(o=>o.value===String(value));if(target)target.selected=true;}});
  let frameId=0;const frames=new Map();window.requestAnimationFrame=fn=>{frames.set(++frameId,fn);return frameId;};window.cancelAnimationFrame=id=>frames.delete(id);
  const figure=document.querySelector('figure'),canvas=document.querySelector('div'),files=[{path:'River.md',basename:'River',extension:'md'},{path:'Road.md',basename:'Road',extension:'md'}];
  let text='---\nname: River\ntypeOf: waterway\n---\nBody',chooseNote,saved,writes=0,opened,zoom=2,defer;
  const geometry=new Map(),folders=new Set();
  const caches=new Map([[files[0],{frontmatter:{typeOf:'waterway'}}]]),subscriptions=new Map(),events=new Map(),overlays=[],groups=[];
  const owner=()=>({on(name,fn){const ref={name,fn};subscriptions.set(ref,this);return ref;},offref(ref){subscriptions.delete(ref);}});
  const app={metadataCache:{...owner(),getFileCache:file=>caches.get(file)},vault:{...owner(),getMarkdownFiles:()=>files,getAbstractFileByPath:path=>files.find(f=>f.path===path)??(geometry.has(path)?{path,extension:'json'}:folders.has(path)?{path}:null),
    createFolder:async path=>{folders.add(path);},create:async(path,text)=>{assert.ok(!geometry.has(path));geometry.set(path,text);return {path};},
    read:async file=>{if(defer)await defer;return file.extension==='json'?geometry.get(file.path):text;},
    process:async(file,fn)=>{if(defer)await defer;if(file.extension==='json')geometry.set(file.path,fn(geometry.get(file.path)));else{text=fn(text);writes++;caches.set(files[0],{frontmatter:{typeOf:'waterway',mapPath:captureMapPath(text).path}});}}},workspace:{getLeavesOfType:()=>[],openLinkText:path=>{opened=path;}}};
  const handler=()=>{let enabled=true;return {enabled:()=>enabled,disable(){enabled=false;},enable(){enabled=true;}};};
  const map={on(names,fn){for(const name of names.split(' ')){const set=events.get(name)??new Set();set.add(fn);events.set(name,set);}},off(names,fn){for(const name of names.split(' '))events.get(name)?.delete(fn);},getCenter:()=>({lat:600,lng:200}),getZoom:()=>zoom,getZoomScale:()=>2**zoom,
    dragging:handler(),touchZoom:handler(),boxZoom:handler(),doubleClickZoom:handler(),mouseEventToLatLng:e=>({lat:800-e.clientY,lng:e.clientX})};
  const layer=(points,options)=>({points:plain(points),options,addTo(group){group.children.push(this);return this;},setLatLngs(points){this.points=plain(points);this.updates=(this.updates??0)+1;},setLatLng(point){this.points=plain(point);},setStyle(options){this.options={...this.options,...options};}});
  const L={svgOverlay:(svg,bounds)=>({svg,bounds,addTo(){overlays.push(this);return this;},remove(){this.removed=true;}}),layerGroup:()=>({children:[],addTo(){groups.push(this);return this;},clearLayers(){this.children=[];},remove(){this.clearLayers();}}),polyline:layer,circleMarker:layer};
  const module={exports:{}};vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,structuredClone,crypto:globalThis.crypto,console,require:name=>name==='obsidian'?{FuzzySuggestModal:class{}}:require(name)});
  const api=module.exports.mountNotePaths({L,map,canvas,figure,config:{bounds:[[0,0],[800,1000]],crop:{x:0,y:0,width:1000,height:800}},manifest:{height:800,width:1000,sourceOffset:[5000,7000]},app,sourcePath:'Map.md',editable,onSaved:(file,path)=>{saved=plain(path);},selectNote:(app,fn)=>{chooseNote=fn;}});
  const click=label=>{const el=[...figure.querySelectorAll('button')].find(b=>b.textContent===label);assert.ok(el,label);if(!el.disabled)el.click();};
  const input=name=>figure.querySelector('[aria-label="'+name+'"]');
  const event=(name,arg)=>{for(const fn of events.get(name)??[])fn(arg);};
  const pointer=(name,x,y,extra={})=>{const e=new window.Event(name,{bubbles:true,cancelable:true});Object.assign(e,{clientX:x,clientY:y,pointerId:1,isPrimary:true,button:0,...extra});canvas.dispatchEvent(e);};
  return {api,map,figure,canvas,geometry,files,caches,subscriptions,overlays,groups,frames,event,pointer,input,click,
    choose:async()=>{click('Draw or edit river / road');await chooseNote(files[0]);},pick:(x,y)=>event('click',{latlng:{lat:800-y,lng:x}}),flush:()=>{for(const [id,fn] of frames){frames.delete(id);fn();}},
    get text(){return text;},set text(v){text=v;},get saved(){return saved;},get writes(){return writes;},get opened(){return opened;},set defer(value){defer=value;},
    status:()=>figure.querySelector('.map-path-status').textContent,change:(name,value)=>{input(name).value=value;input(name).dispatchEvent(new window.Event('change'));}};
}

test('editor saves original coordinates, moves vertices, preserves importance, cancels, and confirms deletion',async()=>{
  const h=host();await h.choose();assert.equal(h.input('Path kind').value,'river');
  h.pick(100.1234,200.5678);h.pick(300,300);h.pick(500,200);h.change('Path importance','world');h.click('Save path');await tick();
  assert.equal(h.writes,1);assert.deepEqual(h.saved,{kind:'river',importance:'world',points:[[5100.1234,7200.5678],[5300,7300],[5500,7200]]});assert.ok(h.text.endsWith('Body'));assert.ok(captureMapPath(h.text).path.source);assert.equal(captureMapPath(h.text).path.points,undefined);assert.equal(h.geometry.size,1);
  await h.choose();assert.equal(h.input('Path importance').value,'world');h.change('Path vertex','1');h.pick(320,310);h.click('Undo path edit');h.click('Save path');await tick();assert.deepEqual(h.saved.points[1],[5300,7300]);
  await h.choose();h.change('Path vertex','1');h.pick(330,320);h.click('Save path');await tick();assert.deepEqual(h.saved.points[1],[5330,7320]);
  const before=h.text;await h.choose();h.click('Redraw path');h.pick(5,5);h.pick(10,10);h.click('Cancel path');assert.equal(h.text,before);
  await h.choose();h.change('Path kind','road');h.click('Save path');await tick();assert.equal(h.saved.kind,'road');
  await h.choose();h.click('Delete saved path');assert.notEqual(captureMapPath(h.text).path,null);h.click('Confirm path deletion');await tick();assert.equal(captureMapPath(h.text).path,null);assert.equal(h.saved,null);
  assert.equal(h.map.doubleClickZoom.enabled(),true);h.api();assert.equal(h.subscriptions.size,0);
});

test('freehand coalesces display updates, preserves samples, undoes strokes, and cancels on navigation/unload',async()=>{
  const h=host();await h.choose();h.click('Trace river / road');assert.equal(h.map.dragging.enabled(),false);
  h.pointer('pointerdown',10,10);h.pointer('pointermove',20,10);h.pointer('pointermove',20,20);h.pointer('pointermove',30,20);
  assert.equal(h.frames.size,1);const line=h.groups[0].children[0];h.flush();assert.equal(h.groups[0].children[0],line);
  h.pointer('pointerup',30,30);assert.equal(h.frames.size,0);h.click('Save path');await tick();
  assert.deepEqual(h.saved.points,[[5010,7010],[5020,7010],[5020,7020],[5030,7020],[5030,7030]]);assert.equal(h.map.dragging.enabled(),true);
  await h.choose();h.click('Trace river / road');h.pointer('pointerdown',30,30);h.pointer('pointermove',40,30);h.pointer('pointerup',40,40);h.click('Undo path edit');
  h.pointer('pointerdown',30,30);h.pointer('pointermove',40,30);h.event('zoomstart');assert.equal(h.frames.size,0);h.click('Save path');await tick();assert.equal(h.saved.points.length,5);
  await h.choose();h.click('Trace river / road');h.pointer('pointerdown',30,30);h.pointer('pointermove',40,30);h.api();assert.equal(h.frames.size,0);assert.equal(h.map.dragging.enabled(),true);assert.equal(h.map.doubleClickZoom.enabled(),true);
});

test('conflicting saves retain drafts, competing tools block drawing, and close prevents pending writes',async()=>{
  const h=host();h.canvas.classList.add('map-editing-region','map-editing');await h.choose();assert.match(h.status(),/Finish/);assert.equal(h.canvas.classList.contains('map-editing-path'),false);
  h.canvas.classList.remove('map-editing-region','map-editing');await h.choose();h.pick(100,100);h.pick(200,200);
  h.text=patchMapPath(h.text,captureMapPath(h.text),{kind:'road',points:[[1,1],[2,2]]}).text;h.click('Save path');await tick();assert.match(h.status(),/changed/);assert.equal(h.writes,0);assert.ok(h.canvas.classList.contains('map-editing-path'));
  h.click('Cancel path');await h.choose();h.click('Redraw path');h.pick(100,100);h.pick(200,200);
  let release;h.defer=new Promise(resolve=>{release=resolve;});h.click('Save path');h.api();release();await tick();assert.equal(h.writes,0);
});

test('read-only maps refresh saved note metadata and crops without adding authoring controls',async()=>{
  const h=host({editable:false});assert.equal(h.figure.querySelectorAll('button').length,0);
  const path={kind:'river',importance:'world',points:[[5100,7200],[5300,7300]]};h.api.updateNote(h.files[0],path);
  const svg=h.overlays.at(-1).svg;assert.equal(svg.querySelectorAll('polyline').length,1);
  svg.querySelector('a').dispatchEvent(new h.figure.ownerDocument.defaultView.Event('click',{cancelable:true}));assert.equal(h.opened,'River.md');
  h.api.update({bounds:[[0,0],[800,1000]],crop:{x:500,y:500,width:50,height:50}});assert.equal(h.overlays.at(-1).svg.querySelectorAll('polyline').length,0);
  h.caches.set(h.files[0],{frontmatter:{}});for(const [ref,owner] of h.subscriptions)if(ref.name==='changed')ref.fn(h.files[0]);
  await tick();h.flush();assert.ok(h.overlays.at(-1).removed);h.api();
});


test('saved geometry files reload on edits and deletion, and late reads cannot repaint a closed map',async()=>{
  const h=host();await h.choose();h.pick(100,100);h.pick(200,200);h.click('Save path');await tick();
  const source=captureMapPath(h.text).path.source;
  const notify=name=>{for(const [ref] of h.subscriptions)if(ref.name===name)ref.fn({path:source,extension:'json'});};
  h.geometry.set(source,JSON.stringify({version:1,points:[[5100,7100],[5500,7500]]}));notify('modify');await tick();h.flush();
  assert.match(h.overlays.at(-1).svg.querySelector('polyline').getAttribute('points'),/500,500$/);
  h.geometry.delete(source);notify('delete');await tick();h.flush();assert.ok(h.overlays.at(-1).removed);
  h.geometry.set(source,JSON.stringify({version:1,points:[[5100,7100],[5200,7200]]}));notify('create');await tick();h.flush();assert.equal(h.overlays.at(-1).removed,undefined);
  let release;h.defer=new Promise(resolve=>{release=resolve;});notify('modify');const count=h.overlays.length;h.api();release();await tick();h.flush();assert.equal(h.overlays.length,count);
});
