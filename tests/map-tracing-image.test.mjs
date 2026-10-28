import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {tracingRectangle,loadTracingImage,mountTracingImage} from '../obsidian/taelgarverse/maps/tracing-image.mjs';
const manifest={sourceOffset:[5000,7000],width:1000,height:800};

test('tracing uses canvas offsets and native pixel scale, with explicit scaling for resized PNGs',()=>{
  assert.deepEqual(tracingRectangle({width:1000,height:800},{x:5000,y:7000,scale:1},manifest),{x:0,y:0,width:1000,height:800});
  assert.deepEqual(tracingRectangle({width:6000,height:8000},{x:0,y:0,scale:1},manifest),{x:-5000,y:-7000,width:6000,height:8000});
  assert.deepEqual(tracingRectangle({width:500,height:400},{x:5100,y:7200,scale:2},manifest),{x:100,y:200,width:1000,height:800});
  for(const patch of [{x:-1},{y:NaN},{scale:0},{scale:Infinity},{x:100000}])assert.throws(()=>tracingRectangle({width:100,height:100},{x:0,y:0,scale:1,...patch},manifest));
});
function png(width=1000,height=800){const buffer=new ArrayBuffer(33),v=new DataView(buffer);for(const [i,n] of [[0,0x89504e47],[4,0x0d0a1a0a],[8,13],[12,0x49484452],[16,width],[20,height]])v.setUint32(i,n);return {name:'trace.png',size:33,slice:()=>({arrayBuffer:async()=>buffer})};}
test('loader validates PNG dimensions before decoding and releases blob URLs on errors and disposal',async()=>{
  const created=[],revoked=[];let fail=false;
  const doc={defaultView:{URL:{createObjectURL:file=>{created.push(file);return 'blob:trace';},revokeObjectURL:url=>revoked.push(url)},Image:class{naturalWidth=1000;naturalHeight=800;async decode(){if(fail)throw new Error('corrupt');}}}};
  const image=await loadTracingImage(png(),doc);assert.equal(image.width,1000);image.release();image.release();assert.equal(revoked.length,1);
  fail=true;await assert.rejects(loadTracingImage(png(),doc),/decoded/);assert.equal(revoked.length,2);
  await assert.rejects(loadTracingImage(png(50000,50000),doc),/dimensions/);assert.equal(created.length,2);
  await assert.rejects(loadTracingImage({...png(),size:300*1024*1024},doc),/256 MiB/);
  await assert.rejects(loadTracingImage({size:1,slice:()=>({arrayBuffer:async()=>new ArrayBuffer(1)})},doc),/valid PNG/);
});
function setup(){
  const {document,window}=parseHTML('<figure><div></div><figcaption></figcaption></figure>'),figure=document.querySelector('figure'),layers=[],releases=[],panes=[];
  let pending=null;
  const map={createPane:name=>{const el=document.createElement('div');el.dataset.name=name;document.body.append(el);panes.push(el);return el;}};
  const L={imageOverlay:(url,bounds,options)=>{const el=document.createElement('img');return {url,bounds,options,addTo(){layers.push(this);return this;},setBounds(value){this.bounds=value;},setOpacity(value){this.opacity=value;},getElement:()=>el,remove(){this.removed=true;}};}};
  const dispose=mountTracingImage({L,map,canvas:figure.querySelector('div'),figure,manifest,loadImage:async file=>{
    if(pending)await pending;if(file.fail)throw new Error('Decode failed');return {name:file.name,url:'blob:'+file.name,width:file.width??1000,height:file.height??800,release:()=>releases.push(file.name)};
  }});
  const input=name=>figure.querySelector('[aria-label="'+name+'"]');
  const load=file=>{Object.defineProperty(input('Load tracing PNG'),'files',{configurable:true,value:[file]});input('Load tracing PNG').dispatchEvent(new window.Event('change'));};
  const change=(name,value,event='change')=>{input(name).value=String(value);input(name).dispatchEvent(new window.Event(event));};
  const click=name=>[...figure.querySelectorAll('button')].find(b=>b.textContent===name).click();
  return {dispose,figure,input,load,change,click,layers,releases,panes,window,set pending(value){pending=value;}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('reference aligns automatically, remains under drawing panes and cannot intercept tracing clicks',async()=>{
  const h=setup();h.load({name:'same.png'});await settle();
  assert.deepEqual(h.layers[0].bounds,[[0,0],[800,1000]]);assert.equal(h.layers[0].options.interactive,false);
  assert.equal(h.panes[0].style.pointerEvents,'none');assert.equal(h.panes[0].style.zIndex,'350');
  h.change('Tracing X',5100);h.change('Tracing scale',.5);
  assert.deepEqual(h.layers[0].bounds,[[400,100],[800,600]]);
  h.change('Tracing scale',0);assert.deepEqual(h.layers[0].bounds,[[400,100],[800,600]],'bad alignment retains last good bounds');
  h.change('Tracing opacity',.25,'input');assert.equal(h.layers[0].opacity,.25);
  h.input('Show tracing image').checked=false;h.input('Show tracing image').dispatchEvent(new h.window.Event('change'));assert.equal(h.layers[0].getElement().style.display,'none');
  h.click('Remove tracing image');assert.deepEqual(h.releases,['same.png']);assert.ok(h.layers[0].removed);h.dispose();
});
test('full-canvas references clip to the basemap and can be realigned to a trimmed export',async()=>{
  const h=setup();h.load({name:'canvas.png',width:10000,height:10000});await settle();
  assert.deepEqual(h.layers[0].bounds,[[-2200,-5000],[7800,5000]]);
  assert.equal(h.layers[0].getElement().style.clipPath,'inset(70% 40% 22% 50%)');
  h.click('Align to basemap export');assert.equal(h.input('Tracing X').value,'5000');
  h.click('Align to canvas origin');assert.equal(h.input('Tracing X').value,'0');h.dispose();
});
test('failed replacement preserves the reference; removing or closing cancels pending loads and frees URLs',async()=>{
  const h=setup();h.load({name:'good.png'});await settle();h.load({name:'bad.png',fail:true});await settle();
  assert.equal(h.layers.length,1);assert.equal(h.layers[0].removed,undefined);
  let release;h.pending=new Promise(resolve=>{release=resolve;});h.load({name:'late.png'});h.click('Remove tracing image');release();await settle();
  assert.deepEqual(h.releases,['good.png','late.png']);assert.equal(h.layers.length,1);
  h.pending=null;h.load({name:'last.png'});h.dispose();await settle();assert.ok(h.releases.includes('last.png'));assert.equal(h.layers.length,1);
});
