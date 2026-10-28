import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import {parseHTML} from 'linkedom';
import {parse} from 'yaml';
import {ROOT} from '../src/config.mjs';
import {mapLocation} from '../src/map-location.mjs';
import symbols from '../src/map-symbols.json' with {type:'json'};
const bundle=await build({absWorkingDir:ROOT,entryPoints:['obsidian/taelgarverse/maps/towns.mjs'],bundle:true,write:false,
  format:'cjs',platform:'browser',external:['obsidian'],logLevel:'silent'});
const tick=()=>new Promise(setImmediate);
function setup({overlays=[],editable=true,zoom=2,usePicker=false,viewport=null}={}){
  const {document,window}=parseHTML('<figure><div class="map-canvas"></div><figcaption></figcaption></figure>');
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return [...this.options].find(o=>o.selected)?.value??this.options[0]?.value??'';},set(value){for(const o of this.options)o.removeAttribute('selected');const target=[...this.options].find(o=>o.value===String(value));if(target)target.selected=true;}});
  const figure=document.querySelector('figure'),canvas=figure.querySelector('div'),handlers={},layers=[],files=[
    {path:'Places/Town.md',basename:'Town',extension:'md'},{path:'Places/Other.md',basename:'Other',extension:'md'}];
  let text='---\nname: "Town" # preserved\n---\nBody\n',writes=0,fail=false,deferred=null,pickerChoice,opened;
  const caches=new Map([[files[1],{frontmatter:{mapLocation:mapLocation([5200,7200])}}]]),subscriptions=[];
  const events=()=>({on(name,fn){const ref={name,fn};subscriptions.push(ref);return ref;},offref(ref){ref.removed=true;}});
  const app={workspace:{getLeavesOfType:()=>[],openLinkText:path=>{opened=path;}},metadataCache:{...events(),getFileCache:file=>caches.get(file)},
    vault:{...events(),getMarkdownFiles:()=>files,getAbstractFileByPath:path=>files.find(file=>file.path===path),read:async()=>text,
      process:async(file,fn)=>{if(deferred)await deferred;if(fail)throw new Error('Save failed');text=fn(text);writes++;}}};
  const map={on(names,fn){for(const name of names.split(' '))handlers[name]=fn;},off(names){for(const name of names.split(' '))delete handlers[name];},getCenter:()=>({lng:250,lat:700}),
    getZoom:()=>zoom,getZoomScale:(to,from)=>2**(to-from)};
  if(viewport)map.getBounds=()=>({pad:()=>({contains:([lat,lng])=>lng>=viewport.x && lng<=viewport.x+viewport.width && 1000-lat>=viewport.y && 1000-lat<=viewport.y+viewport.height})});
  const layer=()=>{const item={children:[],addTo(){layers.push(this);return this;},removeLayer(child){this.children=this.children.filter(item=>item!==child);},clearLayers(){this.children=[];},remove(){this.removed=true;}};return item;};
  const L={layerGroup:layer,divIcon:options=>options,marker:(ll,options)=>({ll,options,addTo(parent){parent.children.push(this);return this;},bindTooltip(label){this.label=label;return this;},on(name,fn){this[name]=fn;return this;}})};
  let pickerModal;
  class FuzzySuggestModal {constructor(){pickerModal=this;}setPlaceholder(){}open(){}close(){}}
  const module={exports:{}};vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:()=>({FuzzySuggestModal}),console,structuredClone});
  const api=module.exports.mountTownPlacement({L,map,canvas,figure,app,editable,sourcePath:'Map.md',manifest:{height:1000,width:1000,sourceOffset:[5000,7000]},
    config:{crop:{x:0,y:0,width:1000,height:1000},overlays},selectNote:usePicker?undefined:(app,fn)=>{pickerChoice=fn;}});
  const button=label=>[...figure.querySelectorAll('button')].find(b=>b.textContent===label);
  return {api,app,figure,canvas,files,layers,subscriptions,button,caches,get picker(){return pickerModal;},get text(){return text;},set text(value){text=value;},get writes(){return writes;},get opened(){return opened;},
    zoom:value=>{zoom=value;handlers.zoomend();},pan:next=>{Object.assign(viewport,next);handlers.moveend();},
    importance:value=>{const select=figure.querySelector('[aria-label="Feature importance"]');select.value=value;select.dispatchEvent(new window.Event('change'));},
    symbol:value=>{const select=figure.querySelector('[aria-label="Feature symbol"]');select.value=value;select.dispatchEvent(new window.Event('change'));},
    set fail(value){fail=value;},set deferred(value){deferred=value;},status:()=>figure.querySelector('.map-town-status').textContent,
    choose:async(file=files[0])=>{button('Place town').click();await pickerChoice(file);},
    pick:(x,y)=>handlers.click({latlng:{lng:x,lat:1000-y}}),click:label=>button(label).click()};
}

test('the town picker includes only settlement notes and distinguishes duplicate names by path',()=>{
  const h=setup({usePicker:true});
  const duplicate={path:'Elsewhere/Town.md',basename:'Town',extension:'md'},uncached={path:'Uncached.md',basename:'Uncached',extension:'md'};
  h.files.push(duplicate,uncached);
  h.caches.set(h.files[0],{frontmatter:{typeOf:'settlement'}});
  h.caches.set(h.files[1],{frontmatter:{typeOf:'region',mapLocation:mapLocation([5200,7200])}});
  h.caches.set(duplicate,{frontmatter:{typeOf:'settlement'}});
  h.click('Place town');
  assert.deepEqual(Array.from(h.picker.getItems(),file=>file.path),['Elsewhere/Town.md','Places/Town.md']);
  assert.equal(h.picker.getItemText(duplicate),'Town — Elsewhere/Town.md');
  assert.equal(h.picker.getItemText(h.files[0]),'Town — Places/Town.md');
  h.caches.set(h.files[0],{frontmatter:{}});h.caches.set(duplicate,{frontmatter:{typeOf:'building'}});
  assert.equal(h.picker.getItems().length,0,'missing types, other types and uncached notes are excluded');
  assert.equal(h.writes,0);h.api();
});

test('placement writes only on Save, translates export offsets and restores saved markers',async()=>{
  const h=setup(),original=h.text;assert.equal(h.layers[0].children.length,1);assert.equal(h.writes,0);
  h.layers[0].children[0].click();assert.equal(h.opened,'Places/Other.md');
  await h.choose();h.pick(100.123456789,200.987654321);
  assert.equal(h.writes,0);assert.equal(h.text,original);assert.equal(h.layers[1].children.length,1);
  const x=5100.123456789,y=7200.987654321;
  assert.match(h.status(),/Unsaved/);h.click('Save town position');await tick();
  const saved=parse(h.text.split('---')[1]).mapLocation;
  assert.equal(saved.x,x);assert.equal(saved.y,y);assert.equal(saved.hex,mapLocation([x,y]).hex);
  assert.equal(h.writes,1);assert.ok(h.text.includes('name: "Town" # preserved'));assert.ok(h.text.endsWith('Body\n'));
  assert.equal(h.layers[0].children.length,2);assert.equal(h.layers[1].children.length,0);assert.match(h.status(),/Saved Places\/Town.md/);
  await h.choose();assert.match(h.status(),/Click to move/);h.pick(300,400);h.click('Cancel placement');
  assert.equal(h.writes,1);assert.equal(parse(h.text.split('---')[1]).mapLocation.x,x);
  assert.equal(h.canvas.classList.contains('map-editing'),false);h.api();assert.ok(h.layers.every(l=>l.removed));
  assert.ok(h.subscriptions.every(s=>s.removed));assert.equal(h.figure.querySelector('.map-town-controls'),null);
});

test('crop edges and measurement prevent accidental placement',async()=>{
  const h=setup();
  await h.choose();h.pick(-1,200);assert.equal(h.button('Save town position').disabled,true);
  h.canvas.classList.add('map-measuring');h.pick(100,100);assert.match(h.status(),/Turn off distance/);
  h.canvas.classList.remove('map-measuring');h.pick(100,100);assert.equal(h.button('Save town position').disabled,false);
  h.click('Cancel placement');assert.equal(h.writes,0);h.api();
});

test('viewer embeds show towns without placement controls or writes',()=>{
  const h=setup({editable:false});
  assert.equal(h.figure.querySelector('.map-town-controls'),null);
  assert.equal(h.layers[0].children.length,1);
  h.layers[0].children[0].click();assert.equal(h.opened,'Places/Other.md');
  assert.equal(h.writes,0);h.api();
});

test('failed saves retain the draft, busy saves block cancellation, and disposal prevents a late write',async()=>{
  const h=setup();await h.choose();h.click('Place at map center');h.fail=true;
  h.click('Save town position');await tick();assert.match(h.status(),/Save failed/);assert.equal(h.button('Save town position').disabled,false);
  assert.equal(h.layers[1].children.length,1);h.fail=false;
  let release;h.deferred=new Promise(resolve=>{release=resolve;});h.click('Save town position');
  assert.equal(h.button('Cancel placement').disabled,true);assert.equal(h.button('Save town position').disabled,true);
  assert.equal(h.figure.querySelector('[aria-label="Feature symbol"]').disabled,true);
  h.api();release();await tick();assert.equal(h.writes,0);
});

test('symbol preview, save, reopen, symbol-only edit and cancel retain the correct artwork and exact location',async()=>{
  const h=setup();await h.choose();h.symbol('crossed-square');
  assert.equal(h.writes,0);assert.equal(h.button('Save town position').disabled,true);
  assert.equal(h.figure.querySelector('.map-town-symbol img').src,symbols['crossed-square'].image);
  h.pick(100.123456789,200.987654321);
  assert.ok(h.layers[1].children[0].options.icon.html.includes(symbols['crossed-square'].image));
  h.click('Save town position');await tick();
  const first=parse(h.text.split('---')[1]).mapLocation;
  assert.equal(first.symbol,'crossed-square');
  assert.ok(h.layers[0].children.find(m=>m.label.textContent.startsWith('Town ·')).options.icon.html.includes(symbols['crossed-square'].image));
  await h.choose();assert.equal(h.figure.querySelector('[aria-label="Feature symbol"]').value,'crossed-square');
  h.symbol('triangle');h.click('Save town position');await tick();
  const second=parse(h.text.split('---')[1]).mapLocation;
  assert.deepEqual(second,{...first,symbol:'triangle'},'changing a symbol preserves position, hex and importance');
  await h.choose();h.symbol('dot');h.click('Cancel placement');
  assert.deepEqual(parse(h.text.split('---')[1]).mapLocation,second);assert.equal(h.writes,2);
  assert.ok(h.layers[0].children.find(m=>m.label.textContent.startsWith('Town ·')).options.icon.html.includes(symbols.triangle.image));
  await h.choose();h.pick(350,450);h.click('Save town position');await tick();
  assert.equal(parse(h.text.split('---')[1]).mapLocation.symbol,'triangle','moving retains the chosen symbol');
  h.caches.set(h.files[0],{frontmatter:{mapLocation:{...second,symbol:'gate'}}});
  h.subscriptions.find(s=>s.name==='changed').fn(h.files[0]);
  assert.ok(h.layers[0].children.find(m=>m.label.textContent.startsWith('Town ·')).options.icon.html.includes(symbols.gate.image),'manual note edits update rendered artwork');
  h.api();
});

test('metadata updates and map crops refresh markers, while competing note positions block Save',async()=>{
  const h=setup();await h.choose();h.pick(100,100);
  h.text=h.text.replace('name:', 'mapLocation: {x: 5300, y: 7300, hex: changed}\nname:');
  h.click('Save town position');await tick();assert.match(h.status(),/saved position changed/);assert.equal(h.writes,0);
  h.click('Cancel placement');h.caches.set(h.files[0],{frontmatter:{mapLocation:mapLocation([5300,7300])}});
  h.subscriptions.find(s=>s.name==='changed').fn(h.files[0]);assert.equal(h.layers[0].children.length,2);
  h.api.update({crop:{x:0,y:0,width:250,height:250},overlays:[]});assert.equal(h.layers[0].children.length,1);
  h.subscriptions.find(s=>s.name==='delete').fn(h.files[1]);assert.equal(h.layers[0].children.length,0);h.api();
});

test('importance controls zoom visibility while drafts stay visible and importance-only edits preserve the point',async()=>{
  const h=setup({zoom:-5});assert.equal(h.layers[0].children.length,0,'existing unranked towns default to local');
  h.zoom(1);assert.equal(h.layers[0].children.length,1);
  h.zoom(-5);assert.equal(h.layers[0].children.length,0,'zooming out removes hidden markers and tooltips');
  await h.choose();h.pick(100.123,200.987);h.importance('detail');
  assert.equal(h.layers[1].children.length,1,'the draft remains visible at overview zoom');
  h.click('Save town position');await tick();
  const saved=parse(h.text.split('---')[1]).mapLocation;assert.equal(saved.importance,'detail');
  assert.equal(h.layers[0].children.length,0);assert.match(h.status(),/Detail.*3-mile view and closer/);
  h.zoom(1);assert.equal(h.layers[0].children.length,1,'only the other local town is visible');
  h.zoom(2);assert.equal(h.layers[0].children.length,2);
  await h.choose();assert.equal(h.figure.querySelector('select').value,'detail');
  h.importance('world');h.click('Save town position');await tick();
  const edited=parse(h.text.split('---')[1]).mapLocation;
  assert.deepEqual(edited,{...saved,importance:'world'});
  h.zoom(-5);assert.equal(h.layers[0].children.length,1);
  await h.choose();h.importance('regional');h.pick(400,400);h.click('Cancel placement');
  assert.deepEqual(parse(h.text.split('---')[1]).mapLocation,edited,'Cancel preserves saved importance and position');
  await h.choose();h.pick(150,250);h.click('Save town position');await tick();
  assert.equal(parse(h.text.split('---')[1]).mapLocation.importance,'world','moving a town keeps its importance');h.api();
});


test('town markers survive unchanged zooms and are culled/revealed when the viewport moves',()=>{
  const h=setup({zoom:4,viewport:{x:100,y:100,width:300,height:300}});
  const first=h.layers[0].children[0];assert.ok(first);
  h.zoom(5);assert.equal(h.layers[0].children[0],first,'same artwork and location reuse the marker');
  h.pan({x:120});assert.equal(h.layers[0].children[0],first,'small pan keeps nearby marker');
  h.pan({x:600});assert.equal(h.layers[0].children.length,0,'offscreen marker is removed');
  h.pan({x:100});assert.equal(h.layers[0].children.length,1,'panning back restores it');
  h.layers[0].children[0].click();assert.equal(h.opened,'Places/Other.md');
  h.api.updateNote(h.files[1],mapLocation([5250,7250],'detail','triangle'));
  assert.match(h.layers[0].children[0].label.textContent,/X 5250/);assert.ok(h.layers[0].children[0].options.icon.html.includes(symbols.triangle.image));
  h.api();
});
