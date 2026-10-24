import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {setTimeout as pause} from 'node:timers/promises';
import {build} from 'esbuild';
import MarkdownIt from 'markdown-it';
import {registrySource} from './helpers/index-registry.mjs';
import {ROOT} from '../src/config.mjs';
import {headerFixture} from './helpers/header-fixture.mjs';
import {imageDOM} from './helpers/image-dom.mjs';
import {indexNotes,featureIndexNotes,indexSources} from './fixtures/indexes.mjs';
import {mountIndexPopups} from '../src/browser/index-popups.mjs';
import {indexPopup,indexPopupShell} from '../src/index-view.mjs';
import {cintraSource,cintraSentence} from './fixtures/index-descriptions.mjs';

const require=createRequire(import.meta.url);
const compiled=await build({absWorkingDir:ROOT,entryPoints:['obsidian/taelgarverse/features/headers.mjs'],write:false,
  bundle:true,platform:'node',format:'cjs',external:['obsidian'],logLevel:'silent'});

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
  const module={exports:{}},globals={module,exports:module.exports,structuredClone,console,TextEncoder,TextDecoder,AbortController,setTimeout,clearTimeout,
    setInterval:callback=>{intervals.set(++next,callback);return next;},clearInterval:id=>intervals.delete(id),
    require:name=>name==='obsidian'?{Component,MarkdownRenderChild,MarkdownRenderer}:require(name)};
  vm.runInNewContext(compiled.outputFiles[0].text,globals);
  const {input}=headerFixture(),metadata=new Map(Object.entries(structuredClone(indexNotes)).map(([path,metadata])=>[path,{...metadata,pageTargetDate:'1720-01-01'}]));
  const files=[...metadata.keys()].map(path=>({path,basename:path.split('/').at(-1).slice(0,-3)}));
  const images=[{path:'portraits/alice.png',basename:'alice'}];
  const cache=events(),vault=events(),bodies=new Map(),reads=[],registries=new Map([['_scripts/indexes.yaml',registrySource]]);
  const app={metadataCache:{...cache,getFileCache:file=>file && {frontmatter:metadata.get(file.path)},
    getFirstLinkpathDest:(target,source)=>[...files,...images].find(file=>file.path===target || file.path===target+'.md' || file.basename===target || metadata.get(file.path)?.aliases?.includes(target))},
    vault:{...vault,configDir:'.obsidian',getRoot:()=>({path:''}),getMarkdownFiles:()=>files,getAbstractFileByPath:path=>files.find(file=>file.path===path),
      adapter:{exists:async path=>registries.has(path) || path.endsWith('metadata.json') || path.endsWith('session_note_campaigns.json'),read:async path=>{if(registries.has(path))return registries.get(path);if(path.endsWith('metadata.json'))return JSON.stringify(input.coreMeta);if(path.endsWith('session_note_campaigns.json'))return JSON.stringify(input.registry);throw new Error('ENOENT');}},
      cachedRead:async file=>{reads.push(file.path);return bodies.get(file.path) ?? indexSources(Object.fromEntries(metadata))[file.path].replace('Authored prose.',file.path==='People/Alice.md' ? "Alice's first authored sentence. A second sentence." : 'Authored prose.');},
      getResourcePath:file=>'app://local/'+file.path},
    workspace:{openLinkText:(...args)=>opened.push(args)}};
  const plugin={app,settings,registerMarkdownCodeBlockProcessor:(type,processor)=>processors.set(type,processor),registerMarkdownPostProcessor:processor=>postprocessors.push(processor)};
  const feature=new module.exports.HeadersFeature(plugin);feature.load();
  const context=sourcePath=>({sourcePath,addChild(child){child.load();this.child=child;}});
  return {...dom,...module.exports,app,feature,metadata,files,bodies,reads,registries,opened,intervals,cache,vault,globals,
    async block(source,sourcePath='Places/Realm.md',type='taelgar-index') {
      const element=document.createElement('div');document.body.append(element);
      const ctx=context(sourcePath);processors.get(type)(source,element,ctx);await ctx.child.loading;
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

test('Obsidian inline indexes use registry definitions and native links',async()=>{
  const h=host();
  try {
    const {element}=await h.block('index: residents');
    assert.match(element.textContent,/Alice Example/);assert.doesNotMatch(element.textContent,/Visitor|Dead|Future/);
    h.click(element.querySelector('.taelgar-index-link'));assert.deepEqual(h.opened[0],['People/Alice.md','Places/Realm.md',false]);
    const hidden=await h.block('index: residents\nshow: website');assert.equal(hidden.element.hidden,true);
    const member=await h.block('index: members\ntarget: Guild');assert.match(member.element.textContent,/Treasurer/);assert.match(member.element.textContent,/Dead/);
    const old=await h.block('type: residents');assert.match(old.element.textContent,/Unknown/);
  }finally{h.feature.unload();}
  assert.equal(h.intervals.size,0);assert.equal(h.cache.count,0);assert.equal(h.vault.count,0);
});
test('tables support arbitrary metadata, boolean icons, images and first sentences',async()=>{
  const h=host();
  try {
    const {element}=await h.block('index: members\ntarget: Guild\nmode: table\ncolumns: [person, {label: Species, field: metadata.species}, {label: State, field: life.active, format: boolean, trueText: "", falseText: "💀"}, image, firstSentence]');
    assert.match(element.textContent,/Species/);assert.match(element.textContent,/human/);assert.match(element.textContent,/💀/);
    assert.match(element.textContent,/Alice's first authored sentence\./);assert.doesNotMatch(element.textContent,/A second sentence/);
    assert.equal(element.querySelector('img').getAttribute('src'),'app://local/portraits/alice.png');
    assert.match(element.querySelector('a').dataset.href,/People\/Alice/);
  }finally{h.feature.unload();}
});
test('cards use title/subtitle/body/footer and an image boolean',async()=>{
  const h=host();
  try {
    const {element}=await h.block('index: members\ntarget: Guild\ncards:\n  image: false\n  title: person\n  subtitle: role\n  body: firstSentence\n  footer: {field: life.active, format: boolean, trueText: "", falseText: "💀"}');
    assert.equal(element.querySelector('img'),null);assert.match(element.querySelector('.taelgar-index-card-title').textContent,/Alice/);
    assert.match(element.querySelector('.taelgar-index-card-subtitle').textContent,/Treasurer/);
    assert.match(element.querySelector('.taelgar-index-card-body').textContent,/first authored sentence/);
    assert.match(element.textContent,/💀/);
  }finally{h.feature.unload();}
});
test('headers probe metadata, then load the configured header mode lazily',async()=>{
  const h=host();
  try {
    const bio=await h.block('','Groups/Guild.md','taelgar-header');
    assert.ok(bio.element.querySelector('[data-index="members"]'));assert.equal(h.reads.filter(p=>p.startsWith('People/')).length,0);
    h.click(bio.element.querySelector('summary'));await pause(15);
    const dialog=h.document.querySelector('dialog');assert.match(dialog.textContent,/Treasurer/);
    assert.ok(h.reads.some(p=>p==='People/Alice.md'));
    await h.feature.setHeaderIndexPopups(false);assert.equal(bio.element.querySelector('summary'),null);assert.equal(h.document.querySelector('dialog'),null);
    await h.feature.setHeaderIndexPopups(true);assert.ok(bio.element.querySelector('summary'));
  }finally{h.feature.unload();}
});
test('selected personal profiles can enable local rules and file changes refresh indexes',async()=>{
  const h=host({indexOverride:'_scripts/indexes.mike.yaml'});
  try {
    h.registries.set('_scripts/indexes.mike.yaml','hosts:\n  obsidian:\n    headerRules:\n      group-members: {enabled: true}\n    indexes:\n      members:\n        label: My members\n        header: {mode: table}\n');
    h.metadata.get('Groups/Guild.md').indexes=undefined;
    const bio=await h.block('','Groups/Guild.md','taelgar-header');
    assert.match(bio.element.textContent,/My members/);
    h.click(bio.element.querySelector('summary'));await pause(15);assert.ok(h.document.querySelector('table'));
    h.registries.set('_scripts/indexes.mike.yaml','indexes:\n  members: {label: Changed members}\n');
    h.vault.trigger('modify');await pause(160);assert.equal(h.document.querySelector('dialog'),null);
    assert.equal(bio.element.querySelector('summary'),null,'base Obsidian rule is disabled again');
    h.metadata.get('Groups/Guild.md').indexes=['members'];h.cache.trigger('changed');await pause(160);
    assert.match(bio.element.textContent,/Changed members/);
  }finally{h.feature.unload();}
});
test('bad selected registries show local errors while the bio still renders',async()=>{
  const h=host({indexRegistry:'missing.yaml'});
  try {
    const bio=await h.block('','Groups/Guild.md','taelgar-header');assert.ok(bio.element.querySelector('h1'));assert.match(bio.element.textContent,/registry file is missing/);
    const block=await h.block('index: members','Groups/Guild.md');assert.match(block.element.textContent,/registry file is missing/);
    h.feature.plugin.settings.indexRegistry=null;h.feature.refresh();await pause(160);assert.ok(bio.element.querySelector('summary'));
  }finally{h.feature.unload();}
});
test('metadata, date, rename and delete refresh queries without stale popups',async()=>{
  const h=host();
  try {
    const {element}=await h.block('index: members\ntarget: Guild');
    h.metadata.get('People/Alice.md').affiliations=[];h.cache.trigger('changed');await pause(160);assert.doesNotMatch(element.textContent,/Alice Example/);
    h.metadata.get('People/Alice.md').affiliations=[{org:'Guild',start:'1710-01-01',end:'1730-01-01'}];h.vault.trigger('rename');await pause(160);assert.match(element.textContent,/Alice Example/);
    h.globals.customJS={state:{overrideDate:'1735-01-01'}};for(const tick of h.intervals.values())tick();await pause(20);assert.doesNotMatch(element.textContent,/Alice Example/);
    h.globals.customJS.state.overrideDate='1720-01-01';h.files.splice(h.files.findIndex(f=>f.path==='People/Alice.md'),1);h.vault.trigger('delete');await pause(160);assert.doesNotMatch(element.textContent,/Alice Example/);
  }finally{h.feature.unload();}
});
test('cache keys include all display options and return independent results',async()=>{
  const h=host();
  try {
    const snapshot=await h.feature.getSnapshot();
    const first=h.obsidianIndex(h.app,snapshot,{index:'members',target:'Guild',columns:['name']},'Groups/Guild.md','1720-01-01');
    first.items[0].name='Changed';
    const again=h.obsidianIndex(h.app,snapshot,{index:'members',target:'Guild',columns:['name']},'Groups/Guild.md','1720-01-01');
    assert.notEqual(again.items[0].name,'Changed');
    const different=h.obsidianIndex(h.app,snapshot,{index:'members',target:'Guild',columns:['person','role']},'Groups/Guild.md','1720-01-01');
    assert.equal(different.columns.length,2);assert.equal(again.columns.length,1);
  }finally{h.feature.unload();}
});
test('unloading during asynchronous bio rendering cannot mount stale controls',async()=>{
  const h=host();
  try {
    h.defer();const pending=h.block('','Places/Realm.md','taelgar-header');await pause(20);h.feature.unload();h.release();
    assert.equal((await pending).element.innerHTML,'');assert.equal(h.document.querySelector('dialog'),null);
  }finally{h.feature.unload();}
});
test('shared popups support native details fallback, backdrop dismissal and disposal',()=>{
  const h=imageDOM(indexPopupShell({index:'residents',label:'Residents',target:'Town'},'<p>Alice</p>'));
  const dispose=mountIndexPopups(h.document),summary=h.document.querySelector('summary');h.click(summary);
  const dialog=h.document.querySelector('dialog');assert.equal(dialog.open,true);
  h.event(dialog,'pointerdown',{clientX:-10,clientY:-10});h.event(dialog,'click',{clientX:-10,clientY:-10});assert.equal(h.document.querySelector('dialog'),null);
  h.click(summary);dispose();assert.equal(h.document.querySelector('dialog'),null);
  h.window.HTMLElement.prototype.showModal=undefined;const cleanup=mountIndexPopups(h.document);assert.equal(h.click(summary).defaultPrevented,false);cleanup();
});
