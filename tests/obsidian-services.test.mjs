import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {ROOT} from '../src/config.mjs';
import {headerFixture} from './helpers/header-fixture.mjs';
import {serviceExports,attachServices} from './helpers/obsidian-services.mjs';

const require=createRequire(import.meta.url);
const bundled=await build({absWorkingDir:ROOT,stdin:{contents:serviceExports+
  "export * from './obsidian/taelgarverse/features/headers.mjs'; export * from './obsidian/taelgarverse/features/relationships.mjs'; export * from './obsidian/taelgarverse/features/calendar.mjs';",resolveDir:ROOT},
  write:false,bundle:true,platform:'node',format:'cjs',external:['obsidian'],logLevel:'silent'});
function events(){
  const listeners=new Map();return {
    on(name,callback){const set=listeners.get(name)??new Set();set.add(callback);listeners.set(name,set);return ()=>set.delete(callback);},
    trigger(name,...args){for(const callback of listeners.get(name)??[])callback(...args);},
    get count(){return [...listeners.values()].reduce((sum,set)=>sum+set.size,0);},
  };
}
function host(){
  class Component{
    constructor(){this.children=new Set();this.cleanups=[];}
    load(){if(this.loaded)return;this.loaded=true;this.onload?.();}
    addChild(child){this.children.add(child);child.load();return child;}
    removeChild(child){this.children.delete(child);child.unload();}
    register(callback){this.cleanups.push(callback);}
    registerEvent(callback){this.register(callback);}
    unload(){if(!this.loaded)return;this.loaded=false;this.onunload?.();for(const child of this.children)child.unload();for(const cleanup of this.cleanups)cleanup();this.cleanups=[];}
  }
  const timeouts=new Map(),intervals=new Map();let next=0;
  const module={exports:{}},globals={module,exports:module.exports,console,structuredClone,TextEncoder,TextDecoder,
    setTimeout:fn=>{timeouts.set(++next,fn);return next;},clearTimeout:id=>timeouts.delete(id),
    setInterval:fn=>{intervals.set(++next,fn);return next;},clearInterval:id=>intervals.delete(id),
    require:name=>name==='obsidian'?{Component,MarkdownRenderChild:class extends Component{},ItemView:class{},Setting:class{},Notice:class{}}:require(name)};
  vm.runInNewContext(bundled.outputFiles[0].text,globals);
  const {input}=headerFixture({baseNotes:{'People/Alice.md':{tags:['person'],affiliations:['Guild']},'Groups/Guild.md':{tags:['group']}}});
  const files=input.pages.map(page=>({path:page.path,basename:page.path.split('/').at(-1).replace(/\.md$/,''),metadata:structuredClone(page.metadata)}));
  const cache=events(),vault=events(),workspace=events(),reads=[];
  const app={metadataCache:{...cache,getFileCache:file=>({frontmatter:file.metadata}),getFirstLinkpathDest:target=>files.find(file=>file.path===target || file.basename===target)},
    vault:{...vault,configDir:'custom-config',getRoot:()=>({path:''}),getMarkdownFiles:()=>files,getAbstractFileByPath:path=>files.find(file=>file.path===path),
      adapter:{read:async path=>{reads.push(path);return JSON.stringify(path==='custom-config/metadata.json'?input.coreMeta:input.registry);}},cachedRead:async()=>''},
    workspace:{...workspace,detachLeavesOfType(){}},
  };
  const plugin={app,settings:{relationshipsEnabled:true,calendarEnabled:false},saveData:async()=>{},addCommand(){},registerView(){},registerMarkdownCodeBlockProcessor(){},registerMarkdownPostProcessor(){},addRibbonIcon:()=>({remove(){}})};
  const disposeServices=attachServices(plugin,module.exports),features=[];
  return {api:module.exports,globals,plugin,app,input,files,reads,cache,vault,workspace,intervals,timeouts,
    flush(){const callbacks=[...timeouts.values()];timeouts.clear();for(const callback of callbacks)callback();},
    tick(){for(const callback of intervals.values())callback();},
    feature(Type){const feature=new Type(plugin);features.push(feature);feature.load();return feature;},
    dispose(){for(const feature of features)feature.unload();disposeServices();},
  };
}

test('snapshot consumers coalesce reads, share immutable metadata, and invalidate without a Headers owner',async()=>{
  const h=host();let changes=0;
  try{
    assert.equal(h.reads.length,0,'plugin initialization is lazy');
    const stop=h.plugin.snapshots.subscribe(()=>{changes++;});
    const [first,second]=await Promise.all([h.plugin.snapshots.getSnapshot(),h.plugin.snapshots.getSnapshot()]);
    assert.equal(first,second);assert.equal(h.reads.length,2);
    assert.ok(h.reads.includes('custom-config/metadata.json'));
    const alice=h.files.find(file=>file.basename==='Alice');alice.metadata.name='Updated Alice';
    h.cache.trigger('changed',alice);h.cache.trigger('resolved');h.flush();assert.equal(changes,1);
    const updated=await h.plugin.snapshots.getSnapshot();assert.notEqual(updated,first);
    assert.equal(updated.runtime.resolve('Alice').metadata.name,'Updated Alice');
    assert.equal(first.runtime.resolve('Alice').metadata.name,undefined,'existing renders keep their original frozen input');
    assert.throws(()=>{updated.runtime.resolve('Alice').metadata.name='Mutated';},TypeError);
    for(const path of ['custom-config/metadata.json','_scripts/session_note_campaigns.json']){
      h.vault.trigger('modify',{path});h.flush();assert.equal(h.plugin.snapshots.snapshot,null);
      await h.plugin.snapshots.getSnapshot();
    }
    stop();
  }finally{h.dispose();}
  assert.equal(h.cache.count+h.vault.count+h.workspace.count,0);assert.equal(h.timeouts.size,0);
});

test('snapshot invalidation during a read cannot restore stale metadata and failed reads can retry',async()=>{
  const h=host();let release;
  try{
    const normal=h.app.vault.adapter.read;
    h.app.vault.adapter.read=path=>path==='custom-config/metadata.json' && !release?
      new Promise(resolve=>{release=()=>resolve(JSON.stringify({...h.input.coreMeta,generation:'stale'}));}):Promise.resolve(JSON.stringify(path==='custom-config/metadata.json'?{...h.input.coreMeta,generation:'fresh'}:h.input.registry));
    const stale=h.plugin.snapshots.getSnapshot();h.plugin.snapshots.invalidate();
    const fresh=await h.plugin.snapshots.getSnapshot();release();
    assert.equal(await stale,fresh);assert.equal(fresh.runtime.coreMeta.generation,'fresh');
    h.plugin.snapshots.invalidate();h.app.vault.adapter.read=async()=>'not JSON';
    await assert.rejects(h.plugin.snapshots.getSnapshot());
    h.app.vault.adapter.read=normal;
    assert.ok((await h.plugin.snapshots.getSnapshot()).runtime);
  }finally{h.dispose();}
});

test('unloading the snapshot service rejects pending readers and cancels queued notifications',async()=>{
  const h=host();let release,notifications=0;
  h.app.vault.adapter.read=path=>path==='custom-config/metadata.json'?new Promise(resolve=>{release=()=>resolve(JSON.stringify(h.input.coreMeta));}):Promise.resolve(JSON.stringify(h.input.registry));
  h.plugin.snapshots.subscribe(()=>{notifications++;});
  const pending=h.plugin.snapshots.getSnapshot();h.plugin.snapshots.invalidate();h.dispose();release();
  await assert.rejects(pending,/snapshot service has unloaded/);h.flush();
  assert.equal(notifications,0);assert.equal(h.plugin.snapshots.snapshot,null);
  await assert.rejects(h.plugin.snapshots.getSnapshot(),/unloaded/);
});

test('all date subscribers share one polling bridge, detect in-place legacy overrides, and release it independently',()=>{
  const h=host();let first=0,second=0;
  try{
    assert.equal(h.intervals.size,0);
    h.globals.customJS={state:{overrideDate:{year:1748,month:0,day:2}}};
    const stopFirst=h.plugin.dates.subscribe(()=>{first++;}),stopSecond=h.plugin.dates.subscribe(()=>{second++;});
    assert.equal(h.intervals.size,1);h.tick();assert.equal(first,0);
    h.globals.customJS.state.overrideDate.day=3;h.tick();assert.equal(first,1);assert.equal(second,1);
    h.tick();assert.equal(first,1,'unchanged state does not refresh views');
    stopFirst();assert.equal(h.intervals.size,1);
    h.workspace.trigger('taelgarverse:context-changed');assert.equal(first,1);assert.equal(second,2);
    stopSecond();assert.equal(h.intervals.size,0);assert.equal(h.reads.length,0,'watching dates never loads vault snapshots');
  }finally{h.dispose();}
  assert.equal(h.workspace.count,0);assert.throws(()=>h.plugin.dates.getDate(),/unloaded/);
});

test('date-provider errors notify once per transition and recover without rebuilding snapshots',()=>{
  const h=host();let changes=0;
  try{
    h.plugin.dates.subscribe(()=>{changes++;});
    h.globals.TaelgarverseCalendar={getCurrentDate(){throw new Error('Campaign date unavailable');}};
    h.tick();assert.equal(changes,1);assert.throws(()=>h.plugin.dates.getDate(),/unavailable/);
    h.tick();assert.equal(changes,1);
    delete h.globals.TaelgarverseCalendar;h.tick();assert.equal(changes,2);
    assert.equal(h.plugin.dates.getDate({},'1750-01-01'),'1750-01-01');assert.equal(h.reads.length,0);
  }finally{h.dispose();}
});

test('relationships survive unloading Headers and calendar changes reach shared date subscribers immediately',async()=>{
  const h=host();let changes=0;
  try{
    const headers=h.feature(h.api.HeadersFeature),relationships=h.feature(h.api.RelationshipsFeature);
    const snapshot=await h.plugin.snapshots.getSnapshot();headers.unload();
    assert.equal(await h.plugin.snapshots.getSnapshot(),snapshot);
    assert.ok((await relationships.data()).graph.nodes.some(node=>node.name==='Alice'));
    const alice=h.files.find(file=>file.basename==='Alice');alice.metadata.name='Updated Alice';h.cache.trigger('changed',alice);
    assert.notEqual(await h.plugin.snapshots.getSnapshot(),snapshot);
    assert.ok((await relationships.data()).graph.nodes.some(node=>node.name==='Updated Alice'));
    const reads=h.reads.length;
    h.plugin.dates.subscribe(()=>{changes++;});
    const calendar=h.feature(h.api.CalendarFeature);await calendar.setEnabled(true);
    await calendar.selectCampaign('custom');await calendar.setCustomDate('1748-04-06');
    assert.ok(changes>0);assert.equal((await relationships.data()).graph.date,'1748-04-06');
    assert.equal(h.reads.filter(path=>path==='custom-config/metadata.json').length,2,'date changes reuse the metadata snapshot');
    assert.ok(h.reads.length>reads,'Calendar owns its separate metadata-only registry reads');
    await calendar.setEnabled(false);
    assert.equal(h.plugin.dates.getDate({},snapshot.fallback),snapshot.fallback);
  }finally{h.dispose();}
  assert.equal(h.intervals.size,0);assert.equal(h.cache.count+h.vault.count+h.workspace.count,0);
});
