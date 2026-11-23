import {indexedCampaigns} from './helpers/indexed-campaigns.mjs';
import {serviceExports,attachServices} from './helpers/obsidian-services.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {setTimeout as pause} from 'node:timers/promises';
import {build} from 'esbuild';
import MarkdownIt from 'markdown-it';
import {codeMirrorHost} from './helpers/codemirror-host.mjs';
import {ROOT} from '../src/config.mjs';
import {headerFixture} from './helpers/header-fixture.mjs';
import {imageDOM} from './helpers/image-dom.mjs';
import {indexNotes,featureIndexNotes,indexSources,objectIndexNotes} from './fixtures/indexes.mjs';

const require=createRequire(import.meta.url);
const compiled=await build({absWorkingDir:ROOT,stdin:{contents:"export * from './obsidian/taelgarverse/features/headers.mjs';"+serviceExports,resolveDir:ROOT},write:false,
  bundle:true,platform:'node',format:'cjs',external:['obsidian','@codemirror/state','@codemirror/view'],logLevel:'silent'});

function events(){const callbacks=new Map();return {
  on(name,callback){const list=callbacks.get(name) || new Set();list.add(callback);callbacks.set(name,list);return ()=>list.delete(callback);},
  trigger(name){for(const callback of callbacks.get(name) || [])callback();},
  get count(){return [...callbacks.values()].reduce((sum,list)=>sum+list.size,0);},
};}

function host(settings={}) {
  const dom=imageDOM(),{document}=dom;
  class Component {
    constructor(){this.children=new Set();this.disposers=[];}
    load(){if(this.loaded)return;this.loaded=true;this.loading=Promise.resolve(this.onload?.());}
    addChild(child){this.children.add(child);child.load();return child;}
    removeChild(child){if(this.children.delete(child))child.unload();}
    register(dispose){this.disposers.push(dispose);}
    registerEvent(dispose){this.disposers.push(dispose);}
    unload(){this.onunload?.();for(const child of [...this.children])this.removeChild(child);for(const dispose of this.disposers)dispose();}
  }
  class MarkdownRenderChild extends Component {constructor(element){super();this.containerEl=element;}}
  const intervals=new Map(),opened=[],processors=new Map(),postprocessors=[];
  let next=0,deferred,release;
  const MarkdownRenderer={async render(app,source,element){
    element.innerHTML=new MarkdownIt({html:true}).render(source);
    for(const process of postprocessors)process(element,{sourcePath:'Places/Realm.md',addChild:child=>child.load()});
    if(deferred)await deferred;
  }};
  const cm=codeMirrorHost();
  const module={exports:{}},globals={module,exports:module.exports,structuredClone,console,TextEncoder,TextDecoder,AbortController,setTimeout,clearTimeout,
    setInterval:callback=>{intervals.set(++next,callback);return next;},clearInterval:id=>intervals.delete(id),
    require:name=>name==='@codemirror/state'?cm.state:name==='@codemirror/view'?cm.view:name==='obsidian'?{Component,MarkdownRenderChild,MarkdownRenderer}:require(name)};
  vm.runInNewContext(compiled.outputFiles[0].text,globals);
  const {input}=headerFixture(),metadata=new Map(Object.entries(structuredClone(indexNotes)).map(([path,metadata])=>[path,{...metadata,pageTargetDate:'1720-01-01'}]));
  const indexed=indexedCampaigns(input.registry);
  const files=[...metadata.keys()].map(path=>({path,basename:path.split('/').at(-1).slice(0,-3)}));
  const images=[{path:'portraits/alice.png',basename:'alice'}];
  const cache=events(),vault=events(),bodies=new Map();
  const app={metadataCache:{...cache,getFileCache:file=>file && {frontmatter:file.metadata ?? metadata.get(file.path)},
    getFirstLinkpathDest:(target,source)=>[...files,...images].find(file=>file.path===target || file.path===target+'.md' || file.basename===target)},
    vault:{...vault,configDir:'.obsidian',getRoot:()=>({path:''}),getMarkdownFiles:()=>files,getAbstractFileByPath:path=>files.find(file=>file.path===path) || indexed.files.get(path),
      adapter:{read:async path=>JSON.stringify(path.endsWith('metadata.json')?input.coreMeta:indexed.index)},
      cachedRead:async file=>bodies.get(file.path) ?? indexSources(Object.fromEntries(metadata))[file.path].replace('Authored prose.',file.path==='People/Alice.md' ? "Alice's first authored sentence. A second sentence." : 'Authored prose.'),
      getResourcePath:file=>'app://local/'+file.path},
    workspace:{openLinkText:(...args)=>opened.push(args)}};
  const plugin={app,settings,addCommand:()=>{},registerMarkdownCodeBlockProcessor:(type,processor)=>processors.set(type,processor),registerMarkdownPostProcessor:processor=>postprocessors.push(processor),registerEditorExtension:()=>{}};
  const disposeServices=attachServices(plugin,module.exports);
  const feature=new module.exports.HeadersFeature(plugin);feature.load();
  const dispose=()=>{feature.unload();disposeServices();};
  const context=sourcePath=>({sourcePath,addChild(child){child.load();this.child=child;}});
  return {...dom,...module.exports,app,plugin,feature,dispose,metadata,files,bodies,opened,intervals,cache,vault,globals,
    async block(source,sourcePath='Places/Realm.md',type='taelgar-index') {
      const element=document.createElement('div');document.body.append(element);
      const ctx=context(sourcePath);
      if(type==='taelgar-header') {
        element.innerHTML='<div class="callout" data-callout="taelgar-header"><div class="callout-content">Fallback</div></div>';
        for(const process of postprocessors)process(element,ctx);
      } else processors.get(type)(source,element,ctx);
      await ctx.child.loading;
      return {element,child:ctx.child};
    },
    async savedHeader(direct=false) {
      const element=document.createElement('div');element.innerHTML='<h1>Realm</h1>';document.body.append(element);
      const ctx=context('Places/Realm.md');for(const process of postprocessors)process(direct ? element.querySelector('h1') : element,ctx);await ctx.child?.loading;
      for(const process of postprocessors)process(element,ctx);
      return {element,child:ctx.child};
    },
    defer(){deferred=new Promise(resolve=>{release=resolve;});},release(){deferred=null;release();},
  };
}

test('Obsidian inline indexes render current metadata, respect show, and open native note links',async()=>{
  const h=host();
  try {
    const {element}=await h.block('type: whereabouts\nfrom: person\nvia: home');
    assert.match(element.textContent,/Alice Example/);assert.match(element.textContent,/Bob/);
    assert.doesNotMatch(element.textContent,/Visitor|Dead|Future/);
    const link=element.querySelector('.taelgar-index-link');h.click(link);
    assert.deepEqual(h.opened[0],['People/Alice.md','Places/Realm.md',false]);
    h.event(link,'click',{ctrlKey:true});assert.equal(h.opened[1][2],true);
    const hidden=await h.block('type: whereabouts\nfrom: person\nvia: home\nshow: website');assert.equal(hidden.element.hidden,true);assert.equal(hidden.element.innerHTML,'');
    const invalid=await h.block('type: whereabouts\nfrom: person\nvia: home\nshow: invalid');assert.match(invalid.element.textContent,/show must/);
  } finally {h.dispose();}
  assert.equal(h.intervals.size,0);assert.equal(h.cache.count,0);assert.equal(h.vault.count,0);
});

test('Obsidian people tables use object notes as local and explicit targets',async()=>{
  const h=host();
  try {
    for(const [path,metadata] of Object.entries(objectIndexNotes)) {
      h.metadata.set(path,{...metadata,pageTargetDate:'1720-01-01'});
      h.files.push({path,basename:path.split('/').at(-1).slice(0,-3)});
    }
    const aboard=await h.block('type: whereabouts\nfrom: person\nvia: current\nmode: table\nscope: current','Objects/Vessel.md');
    assert.deepEqual(Array.from(aboard.element.querySelectorAll('tbody tr td:first-child a'),link=>link.textContent),['Boarding Visitor','Occupant']);
    const mirror=await h.block('type: whereabouts\nfrom: person\nvia: home\ntarget: "[[Objects/Mirror.md]]"\nmode: table');
    assert.deepEqual(Array.from(mirror.element.querySelectorAll('tbody tr td:first-child a'),link=>link.textContent),['Occupant']);
  } finally {h.dispose();}
});

test('Obsidian place indexes follow aliases at intermediate locations and prefer a matching filename',async()=>{
  const h=host();
  try {
    // Quarter is in Old Town (an alias for Town), and Shop is in Quarter.
    for(const name of ['Quarter','Shop']) {
      const path='Places/'+name+'.md';
      h.metadata.set(path,featureIndexNotes[path]);
      h.files.push({path,basename:name});
    }
    const places=async (options='')=>{
      const {element}=await h.block('type: whereabouts\nfrom: place\nvia: current\nmode: table'+options);
      return Array.from(element.querySelectorAll('tbody tr td:first-child a'),a=>a.textContent);
    };
    assert.equal(h.app.metadataCache.getFirstLinkpathDest('Old Town','Places/Quarter.md'),undefined);
    const viaAlias=await places();
    assert.ok(viaAlias.includes('Quarter'));
    assert.ok(viaAlias.includes('Shop'));
    assert.ok((await places('\nscope: ever')).includes('Shop'));
    const path='Places/Old Town.md';
    h.metadata.set(path,{tags:['place'],whereabouts:'Other Realm'});
    h.files.push({path,basename:'Old Town'});
    h.plugin.snapshots.invalidate();
    const rows=await places();
    assert.ok(!rows.includes('Quarter'));
    assert.ok(!rows.includes('Shop'));
    assert.ok(!(await places('\nscope: ever')).includes('Shop'));
  } finally {h.dispose();}
});

test('Obsidian grids resolve local images and people tables link to current locations and homes',async()=>{
  const h=host();
  try {
    const grid=await h.block('type: whereabouts\nfrom: person\nvia: home\nmode: grid');
    assert.equal(grid.element.querySelectorAll('img').length,1);
    assert.equal(grid.element.querySelector('img').getAttribute('src'),'app://local/portraits/alice.png');
    assert.match(grid.element.querySelector('.taelgar-index-card').textContent,/Alice Example \(she\/her AL-iss\)/);
    assert.equal(grid.element.querySelectorAll('.taelgar-index-card')[1].querySelector('a').textContent,'Bob');
    assert.equal(grid.element.querySelector('.taelgar-index-card .taelgar-index-detail').textContent,'Current Location: the Other Realm');
    assert.match(grid.element.querySelector('.taelgar-index-card').textContent,/Home: Inn/);
    assert.doesNotMatch(grid.element.textContent,/Visitor/);
    const table=await h.block('type: whereabouts\nfrom: person\nvia: home\nmode: table');
    assert.equal(table.element.querySelectorAll('img,.taelgar-index-grid').length,0);
    const cells=table.element.querySelector('tbody tr').querySelectorAll('td');
    assert.equal(cells[0].textContent,'Alice Example (she/her AL-iss)');assert.equal(cells[1].textContent,'Townfolk human');
    assert.equal(cells[2].textContent,'the Other Realm');h.click(cells[2].querySelector('a'));
    assert.deepEqual(h.opened[0],['Places/Other Realm.md','Places/Realm.md',false]);
    assert.equal(cells[3].textContent,'Inn');h.click(cells[3].querySelector('a'));
    assert.deepEqual(h.opened[1],['Places/Inn.md','Places/Realm.md',false]);
    assert.doesNotMatch(table.element.textContent,/Visitor/);
    const header=await h.block('','Places/Realm.md','taelgar-header');
    assert.equal(header.element.querySelectorAll('.taelgar-index-card,img').length,0);
    assert.equal(header.element.querySelector('.taelgar-index-buttons'),null);
  } finally {h.dispose();}
});

test('reused Obsidian queries isolate render additions, dates, targets and metadata refreshes',async()=>{
  const h=host();
  try {
    const snapshot=await h.plugin.snapshots.getSnapshot();
    const run=(date='1720-01-01',source='Places/Realm.md')=>h.obsidianIndex(h.app,snapshot,{type:'whereabouts',from:'person',via:'home'},source,date);
    const first=run(),expected=JSON.stringify(first);
    first.items[0].name='Changed by one render';first.items[0].image='app://stale';
    first.items[0].person[0]='Changed nested part';first.warnings.push('Only this render');
    assert.equal(JSON.stringify(run()),expected);
    assert.equal(run('1750-01-01').items.length,0,'date changes cannot reuse the earlier residence');
    assert.deepEqual(Array.from(run('1720-01-01','Places/Other Realm.md').items,item=>item.path),['People/Visitor.md']);
    h.metadata.get('People/Alice.md').whereabouts='Other Realm';
    h.cache.trigger('changed');await pause(160);
    const updated=await h.plugin.snapshots.getSnapshot();
    const changed=h.obsidianIndex(h.app,updated,{type:'whereabouts',from:'person',via:'home'},'Places/Realm.md','1720-01-01');
    assert.ok(!changed.items.some(item=>item.path==='People/Alice.md'));
  } finally {h.dispose();}
});

test('Obsidian caches where filters independently, including after an invalid block',async()=>{
  const h=host();
  try {
    const source='type: whereabouts\nfrom: person\nvia: home\nmode: table\ncolumns: [name]\n';
    const filtered=await h.block(source+'where: {species: human}');
    assert.match(filtered.element.textContent,/Alice Example/);
    const empty=await h.block(source+'where: {species: dragon}');
    assert.equal(empty.element.querySelector('tbody'),null);
    assert.match((await h.block('type: members')).element.textContent,/Index unavailable/);
    assert.equal((await h.block(source+'where: {species: human}')).element.innerHTML,filtered.element.innerHTML);
  } finally {h.dispose();}
});

test('Obsidian renders the affiliation block and isolates relationship filters in its cache',async()=>{
  const h=host();
  try {
    const source='type: affiliation\nfrom: person\nmode: table\ncolumns: [name, roles]\n';
    const roster=async extra=>(await h.block(source+extra,'Groups/Guild.md')).element;
    const leaders=await roster('affiliationType: leader');
    assert.match(leaders.querySelector('tbody').textContent,/Bob.*Master/);
    const members=await roster('affiliationType: member');
    assert.match(members.querySelector('tbody').textContent,/Alice Example.*Treasurer/);
    assert.doesNotMatch(members.querySelector('tbody').textContent,/Master/);
    assert.equal((await roster('affiliationType: leader')).innerHTML,leaders.innerHTML);
  } finally {h.dispose();}
});
