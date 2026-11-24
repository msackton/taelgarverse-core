import {indexedCampaigns} from './helpers/indexed-campaigns.mjs';
import {serviceExports,attachServices} from './helpers/obsidian-services.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {imageDOM} from './helpers/image-dom.mjs';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {codeMirrorHost} from './helpers/codemirror-host.mjs';
import {ROOT} from '../src/config.mjs';
import {headerFixture} from './helpers/header-fixture.mjs';
const require=createRequire(import.meta.url);
const compiled=await build({absWorkingDir:ROOT,stdin:{contents:"export * from './obsidian/taelgarverse/features/relationships.mjs';"+serviceExports,resolveDir:ROOT},write:false,
  bundle:true,platform:'node',format:'cjs',external:['obsidian','@codemirror/state','@codemirror/view'],logLevel:'silent'});
function emitter(){
  const events=new Map();return {on(name,fn){const list=events.get(name)??new Set();list.add(fn);events.set(name,list);return ()=>list.delete(fn);},
    trigger(name,...args){for(const fn of events.get(name)??[])fn(...args);},get count(){return [...events.values()].reduce((n,list)=>n+list.size,0);}};
}
function host(enabled=false,extraNotes={}){
  class Component {
    constructor(){this.children=new Set();this.disposers=[];}
    addChild(child){this.children.add(child);child.onload?.();return child;}
    removeChild(child){this.children.delete(child);child.unload();}
    register(dispose){this.disposers.push(dispose);}
    registerEvent(fn){this.disposers.push(fn);}
    unload(){this.onunload?.();for(const child of this.children)child.unload();for(const fn of this.disposers)fn();}
  }
  const cm=codeMirrorHost();
  const module={exports:{}},timers=new Set(),globals={module,exports:module.exports,console,structuredClone,Buffer,setTimeout,clearTimeout,
    setInterval:fn=>{timers.add(fn);return fn;},clearInterval:fn=>timers.delete(fn),
    require:name=>name==='@codemirror/state'?cm.state:name==='@codemirror/view'?cm.view:name==='obsidian'?{Component,MarkdownRenderChild:class extends Component{constructor(element){super();this.containerEl=element;}},ItemView:class{},Setting:class{}}:require(name)};
  vm.runInNewContext(compiled.outputFiles[0].text,globals);
  const notes={'People/Alice.md':{tags:['person']},'People/Bob.md':{tags:['person']},'Places/Town.md':{tags:['place']},...extraNotes};
  const fixture=headerFixture({baseNotes:notes}),files=Object.entries(notes).map(([path,metadata])=>({path,metadata,stat:{mtime:1,size:10}}));
  const indexed=indexedCampaigns(fixture.input.registry);
  const cache=emitter(),vault=emitter(),workspace=emitter(),commands=[],opened=[];let reads=0,ribbons=0,closed=0;
  const app={metadataCache:{on:cache.on,getFileCache:file=>({frontmatter:file.metadata}),
      getFirstLinkpathDest:target=>files.find(f=>f.path===target||f.path.endsWith('/'+target+'.md'))},
    vault:{on:vault.on,getRoot:()=>({path:''}),adapter:{read:async file=>JSON.stringify(file.endsWith('metadata.json')?fixture.input.coreMeta:indexed.index)},getMarkdownFiles:()=>files,getAbstractFileByPath:path=>files.find(f=>f.path===path) || indexed.files.get(path),
      cachedRead:async file=>{reads++;return file.path.includes('Alice')?'Alice met [[Bob]].':'Bob traveled.';}},
    workspace:{on:workspace.on,detachLeavesOfType(){closed++;},getLeaf:()=>({openFile:async(...args)=>opened.push(args)})}};
  const plugin={app,settings:{relationshipsEnabled:enabled},
    saveData:async()=>{},registerMarkdownCodeBlockProcessor(name,fn){this.processor=fn;},registerView(){},addCommand:command=>commands.push(command),addRibbonIcon(){ribbons++;return {remove(){ribbons--;}};}};
  const disposeServices=attachServices(plugin,module.exports);
  const serviceListeners=cache.count+vault.count+workspace.count;
  const load=plugin.snapshots.getSnapshot.bind(plugin.snapshots);
  plugin.snapshots.getSnapshot=async()=>({...await load(),fallback:'1720-01-01'});
  const feature=new module.exports.RelationshipsFeature(plugin);feature.onload();
  const dispose=()=>{feature.unload();disposeServices();};
  return {feature,app,plugin,dispose,serviceListeners,files,cache,vault,workspace,commands,opened,globals,timers,get reads(){return reads;},get ribbons(){return ribbons;},get closed(){return closed;}};
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
    assert.equal(h.cache.count+h.vault.count+h.workspace.count,h.serviceListeners);assert.ok(h.closed>0);
    await assert.rejects(h.feature.data(),/disabled/);
  }finally{h.dispose();}
});
test('disabled in-flight reads cannot finish building data and failed reads can be retried',async()=>{
  const h=host(true);try {
    let release;h.app.vault.cachedRead=file=>file.path===h.files[0].path?new Promise(resolve=>{release=resolve;}):Promise.resolve('');
    const pending=h.feature.data();await new Promise(resolve=>setTimeout(resolve,0));
    await h.feature.setEnabled(false);release('[[Bob]]');await assert.rejects(pending,/disabled/);
    await h.feature.setEnabled(true);
    h.app.vault.cachedRead=async()=>{throw new Error('Temporary read error');};
    const failed=await h.feature.data();assert.match(failed.warnings[0],/Temporary read error/);
    h.app.vault.cachedRead=async()=>'[[Bob]]';
    const recovered=await h.feature.data();assert.equal(recovered.warnings.length,0);assert.equal(recovered.graph.edges.length,1);
  }finally{h.dispose();}
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
  }finally{h.dispose();}
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
  }finally{h.dispose();}
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
 h.dispose();
});

test('registered code block renders mode: list, follows source links, and resumes list mode after toggling',async()=>{
 const h=host(true),dom=imageDOM(),element=dom.document.createElement('div');dom.document.body.append(element);
 let block;h.plugin.processor('mode: list',element,{sourcePath:'People/Alice.md',addChild(child){block=child;child.onload();}});
 try{
  assert.ok(block.explorer,'list configuration must reach the renderer');
  await block.explorer.ready;
  assert.ok(element.classList.contains('tg-relationship-list'));
  assert.match(element.textContent,/People mentioned/);
  assert.equal(element.querySelector('svg'),null);
  dom.click(element.querySelector('[data-href="People/Bob.md"]'));
  await Promise.resolve();assert.equal(h.opened[0][0].path,'People/Bob.md');
  await h.feature.setEnabled(false);assert.equal(element.querySelector('a'),null);
  await h.feature.setEnabled(true);await block.explorer.ready;
  assert.ok(element.classList.contains('tg-relationship-list'));
  assert.ok(element.querySelector('[data-href="People/Bob.md"]'));
 }finally{block.unload();h.dispose();}
});

test('inline tables share index formatting, filter direct neighbors, and opt in to object prose',async()=>{
  const h=host(true,{
    'People/Alice.md':{tags:['person'],affiliations:['Guild'],whereabouts:'Town'},
    'People/Bob.md':{tags:['person'],died:'1719-12-31',whereabouts:'Town'},
    'Groups/Guild.md':{tags:['group']},
    'Objects/Brass Bell.md':{tags:['object'],typeOf:'bell'},
    'Objects/Silver Key.md':{tags:['object'],typeOf:'key'},
    'Objects/Unrelated.md':{tags:['object']},
  });
  const prose={
    'People/Alice.md':'Alice met [[Bob]] and found the [[Silver Key]].',
    'Objects/Brass Bell.md':'[[Alice]] rang the bell.',
    'Objects/Silver Key.md':'[[Alice]] found the key. It opens the [[Unrelated]].',
  };
  const reads=[];
  h.app.vault.cachedRead=async file=>{reads.push(file.path);return prose[file.path]??'';};
  h.app.workspace.openLinkText=(...args)=>h.opened.push(args);
  const dom=imageDOM(),sourcePath='People/Alice.md',blocks=[];
  async function render(source,path=sourcePath) {
    const element=dom.document.createElement('div');dom.document.body.append(element);
    let block;
    h.plugin.processor(source,element,{sourcePath:path,addChild(child){block=child;blocks.push(child);child.onload();}});
    await block.explorer.ready;
    return {element,block};
  }
  const links=element=>Array.from(element.querySelectorAll('tbody tr td:last-child a'),node=>node.dataset.href);
  try {
    const browsing=await h.feature.data();
    assert.ok(browsing.graph.nodes.every(node=>node.type!=='object'));
    assert.ok(reads.every(path=>!path.startsWith('Objects/')));

    const {element,block}=await render('mode: table');
    const rows=Array.from(element.querySelectorAll('tbody tr'));
    assert.deepEqual(rows.map(row=>row.querySelector('td a').dataset.href),
      ['People/Bob.md','Objects/Brass Bell.md','Objects/Silver Key.md']);
    assert.match(rows[0].children[2].textContent,/Town.*\(December 31st, 1719\)/);
    assert.equal(rows[0].children[3].textContent,'No');
    assert.equal(rows[1].children[3].textContent,'');
    dom.click(rows[0].querySelector('td a'));
    assert.deepEqual(h.opened[0],['People/Bob.md',sourcePath,false]);

    const selected=await render('mode: table\ntypes: [place, group]\ncolumns: [type, name]\ncolumnHeadings: {name: Connection}\nsortBy: [kind, name]');
    assert.deepEqual(Array.from(selected.element.querySelectorAll('th'),node=>node.textContent),['Type Of','Connection']);
    assert.deepEqual(links(selected.element),['Places/Town.md','Groups/Guild.md']);
    const objectSource=await render('mode: table\ntypes: [person]\ncolumns: [name]','Objects/Silver Key.md');
    assert.deepEqual(links(objectSource.element),['People/Alice.md']);

    h.globals.customJS={state:{overrideDate:'1719-12-31'}};
    await block.explorer.refresh();
    const bob=element.querySelector('tbody tr');
    assert.match(bob.children[2].textContent,/Town/);
    assert.doesNotMatch(bob.children[2].textContent,/1719/);
    assert.equal(bob.children[3].textContent,'Yes');
    assert.ok((await h.feature.data()).graph.nodes.every(node=>node.type!=='object'));
  } finally {
    for(const block of blocks)block.unload();
    h.dispose();
  }
});
