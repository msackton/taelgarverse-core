import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {imageDOM} from './helpers/image-dom.mjs';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {ROOT} from '../src/config.mjs';
import {headerFixture} from './helpers/header-fixture.mjs';
const require=createRequire(import.meta.url);
const compiled=await build({absWorkingDir:ROOT,entryPoints:['obsidian/taelgarverse/features/relationships.mjs'],write:false,
  bundle:true,platform:'node',format:'cjs',external:['obsidian'],logLevel:'silent'});
function emitter(){
  const events=new Map();return {on(name,fn){const list=events.get(name)??new Set();list.add(fn);events.set(name,list);return ()=>list.delete(fn);},
    trigger(name,...args){for(const fn of events.get(name)??[])fn(...args);},get count(){return [...events.values()].reduce((n,list)=>n+list.size,0);}};
}
function host(enabled=false,extraNotes={}){
  class Component {
    constructor(){this.children=new Set();this.disposers=[];}
    addChild(child){this.children.add(child);child.onload?.();return child;}
    removeChild(child){this.children.delete(child);child.unload();}
    registerEvent(fn){this.disposers.push(fn);}
    unload(){this.onunload?.();for(const child of this.children)child.unload();for(const fn of this.disposers)fn();}
  }
  const module={exports:{}},timers=new Set(),globals={module,exports:module.exports,console,structuredClone,Buffer,setTimeout,clearTimeout,
    setInterval:fn=>{timers.add(fn);return fn;},clearInterval:fn=>timers.delete(fn),
    require:name=>name==='obsidian'?{Component,MarkdownRenderChild:class extends Component{constructor(element){super();this.containerEl=element;}},ItemView:class{},Setting:class{}}:require(name)};
  vm.runInNewContext(compiled.outputFiles[0].text,globals);
  const notes={'People/Alice.md':{tags:['person']},'People/Bob.md':{tags:['person']},'Places/Town.md':{tags:['place']},...extraNotes};
  const fixture=headerFixture({baseNotes:notes}),files=Object.entries(notes).map(([path,metadata])=>({path,metadata,stat:{mtime:1,size:10}}));
  const cache=emitter(),vault=emitter(),workspace=emitter(),commands=[],opened=[];let reads=0,ribbons=0,closed=0;
  const app={metadataCache:{on:cache.on,getFileCache:file=>({frontmatter:file.metadata}),
      getFirstLinkpathDest:target=>files.find(f=>f.path===target||f.path==='People/'+target+'.md')},
    vault:{on:vault.on,getMarkdownFiles:()=>files,getAbstractFileByPath:path=>files.find(f=>f.path===path),
      cachedRead:async file=>{reads++;return file.path.includes('Alice')?'Alice met [[Bob]].':'Bob traveled.';}},
    workspace:{on:workspace.on,detachLeavesOfType(){closed++;},getLeaf:()=>({openFile:async(...args)=>opened.push(args)})}};
  const plugin={app,settings:{relationshipsEnabled:enabled},headers:{getSnapshot:async()=>({runtime:fixture.runtime,fallback:'1720-01-01'})},
    saveData:async()=>{},registerMarkdownCodeBlockProcessor(name,fn){this.processor=fn;},registerView(){},addCommand:command=>commands.push(command),addRibbonIcon(){ribbons++;return {remove(){ribbons--;}};}};
  const feature=new module.exports.RelationshipsFeature(plugin);feature.onload();
  return {feature,app,plugin,files,cache,vault,workspace,commands,opened,globals,timers,get reads(){return reads;},get ribbons(){return ribbons;},get closed(){return closed;}};
}
test('opt-in lifecycle does no disabled reads, caches prose, invalidates changes and fully disables',async()=>{
  const h=host();try {
    assert.equal(h.reads,0);assert.equal(h.ribbons,0);assert.equal(h.timers.size,0);assert.equal(h.commands[0].checkCallback(true),false);
    await h.feature.setEnabled(true);
    assert.equal(h.ribbons,1);assert.equal(h.timers.size,1);assert.equal(h.commands[0].checkCallback(true),true);
    let data=await h.feature.data();assert.equal(data.graph.date,'1720-01-01');assert.equal(h.reads,2);assert.equal(data.graph.edges[0].kind,'mentions');
    await h.feature.data('1730-01-01');assert.equal(h.reads,2);
    h.cache.trigger('changed',h.files[0]);await h.feature.data();assert.equal(h.reads,3);
    await h.feature.openNote('People/Alice.md',8);assert.equal(h.opened[0][1].eState.line,8);
    let disposed=0;h.feature.views.add({explorer:{dispose(){disposed++;}}});
    await h.feature.setEnabled(false);assert.equal(disposed,1);assert.equal(h.ribbons,0);assert.equal(h.timers.size,0);
    assert.equal(h.cache.count+h.vault.count+h.workspace.count,0);assert.ok(h.closed>0);
    await assert.rejects(h.feature.data(),/disabled/);
  }finally{h.feature.unload();}
});
test('disabled in-flight reads cannot finish building data and failed reads can be retried',async()=>{
  const h=host(true);try {
    let release;h.app.vault.cachedRead=()=>new Promise(resolve=>{release=resolve;});
    h.app.vault.getMarkdownFiles=()=>[h.files[0]];
    const pending=h.feature.data();await new Promise(resolve=>setTimeout(resolve,0));
    await h.feature.setEnabled(false);release('[[Bob]]');await assert.rejects(pending,/disabled/);
    await h.feature.setEnabled(true);
    h.app.vault.cachedRead=async()=>{throw new Error('Temporary read error');};
    const failed=await h.feature.data();assert.match(failed.warnings[0],/Temporary read error/);
    h.app.vault.cachedRead=async()=>'[[Bob]]';
    const recovered=await h.feature.data();assert.equal(recovered.warnings.length,0);assert.equal(recovered.graph.edges.length,1);
  }finally{h.feature.unload();}
});


test('cached date-block evidence is re-filtered by cutoff without rereading person notes',async()=>{
  const h=host(true);let reads=0;
  h.app.vault.cachedRead=async file=>{reads++;return file.path.includes('Alice')?
    '%%^Date:1730%%Alice met [[Bob]].%%^End%%':'';};
  try{
    const before=await h.feature.data('1720-01-01');assert.equal(before.graph.edges.length,0);
    const at=await h.feature.data('1730-01-01');assert.equal(at.graph.edges.length,1);
    assert.equal(at.graph.edges[0].earliestDate,'1730-01-01');assert.equal(reads,2);
    const later=await h.feature.data('1800-01-01');assert.equal(later.graph.edges.length,1);
    const earlier=await h.feature.data('1720-01-01');assert.equal(earlier.graph.edges.length,0);assert.equal(reads,2);
  }finally{h.feature.unload();}
});

test('route metadata is lazily read, cached, invalidated, and resolved through native note links',async()=>{
  const h=host(true,{'Places/Road.md':{tags:['place'],typeOf:'road'},'Places/River.md':{tags:['place'],typeOf:'waterway'}});
  let reads=0,target='Places/Town.md';
  h.app.vault.cachedRead=async file=>{reads++;return file.path==='Places/Road.md'?
    '%%^Metadata:map:v1%%\nlocations:\n  - {feature: "'+target+'"}\n%%^End%%':'';};
  try{
    let data=await h.feature.data();
    assert.equal(data.graph.edges.filter(e=>e.kind==='route').length,1);assert.equal(reads,4);
    await h.feature.data('1730-01-01');assert.equal(reads,4);
    target='Places/River.md';
    h.cache.trigger('changed',h.files.find(f=>f.path==='Places/Road.md'));
    data=await h.feature.data();assert.equal(reads,5);
    assert.equal(data.graph.edges.find(e=>e.kind==='route').target,'Places/River.md');
    assert.equal(data.warnings.length,0);
  }finally{h.feature.unload();}
});

test('relationship blocks use their source note, stop when disabled, resume, and dispose with Markdown',async()=>{
 const h=host(),dom=imageDOM(),element=dom.document.createElement('div');dom.document.body.append(element);
 const prototype=dom.window.HTMLSelectElement.prototype,desc=Object.getOwnPropertyDescriptor(prototype,'value');
 if(!desc.set)Object.defineProperty(prototype,'value',{...desc,set(){}});
 let block;h.plugin.processor('',element,{sourcePath:'People/Alice.md',addChild(child){block=child;child.onload();}});
 assert.equal(h.reads,0);assert.match(element.textContent,/Enable Relationship explorer/);
 await h.feature.setEnabled(true);await block.explorer.ready;
 assert.equal(element.querySelectorAll('[data-node]').length,2);

 await h.feature.setEnabled(false);assert.equal(block.explorer,null);assert.equal(h.timers.size,0);
 assert.match(element.textContent,/Enable Relationship explorer/);
 await h.feature.setEnabled(true);await block.explorer.ready;
 block.unload();assert.equal(h.feature.blocks.size,0);assert.equal(element.children.length,0);
 h.feature.unload();
});
