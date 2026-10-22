import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {setTimeout as pause} from 'node:timers/promises';
import {build} from 'esbuild';
import MarkdownIt from 'markdown-it';
import {ROOT} from '../src/config.mjs';
import {headerFixture} from './helpers/header-fixture.mjs';
import {imageDOM} from './helpers/image-dom.mjs';
import {indexNotes} from './fixtures/indexes.mjs';
import {mountIndexPopups} from '../src/browser/index-popups.mjs';
import {indexPopup} from '../src/index-view.mjs';

const require=createRequire(import.meta.url);
const compiled=await build({absWorkingDir:ROOT,entryPoints:['obsidian/taelgarverse/features/headers.mjs'],write:false,
  bundle:true,platform:'node',format:'cjs',external:['obsidian'],logLevel:'silent'});

function events(){const callbacks=new Map();return {
  on(name,callback){const list=callbacks.get(name) || new Set();list.add(callback);callbacks.set(name,list);return ()=>list.delete(callback);},
  trigger(name){for(const callback of callbacks.get(name) || [])callback();},
  get count(){return [...callbacks.values()].reduce((sum,list)=>sum+list.size,0);},
};}

function host() {
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
  const module={exports:{}},globals={module,exports:module.exports,structuredClone,console,TextEncoder,TextDecoder,setTimeout,clearTimeout,
    setInterval:callback=>{intervals.set(++next,callback);return next;},clearInterval:id=>intervals.delete(id),
    require:name=>name==='obsidian'?{Component,MarkdownRenderChild,MarkdownRenderer}:require(name)};
  vm.runInNewContext(compiled.outputFiles[0].text,globals);
  const {input}=headerFixture(),metadata=new Map(Object.entries(structuredClone(indexNotes)).map(([path,metadata])=>[path,{...metadata,pageTargetDate:'1720-01-01'}]));
  const files=[...metadata.keys()].map(path=>({path,basename:path.split('/').at(-1).slice(0,-3)}));
  const images=[{path:'portraits/alice.png',basename:'alice'}];
  const cache=events(),vault=events();
  const app={metadataCache:{...cache,getFileCache:file=>file && {frontmatter:metadata.get(file.path)},
    getFirstLinkpathDest:(target,source)=>[...files,...images].find(file=>file.path===target || file.path===target+'.md' || file.basename===target || metadata.get(file.path)?.aliases?.includes(target))},
    vault:{...vault,configDir:'.obsidian',getRoot:()=>({path:''}),getMarkdownFiles:()=>files,getAbstractFileByPath:path=>files.find(file=>file.path===path),
      adapter:{read:async path=>JSON.stringify(path.endsWith('metadata.json')?input.coreMeta:input.registry)},getResourcePath:file=>'app://local/'+file.path},
    workspace:{openLinkText:(...args)=>opened.push(args)}};
  const plugin={app,registerMarkdownCodeBlockProcessor:(type,processor)=>processors.set(type,processor),registerMarkdownPostProcessor:processor=>postprocessors.push(processor)};
  const feature=new module.exports.HeadersFeature(plugin);feature.load();
  const context=sourcePath=>({sourcePath,addChild(child){child.load();this.child=child;}});
  return {...dom,...module.exports,app,feature,metadata,files,opened,intervals,cache,vault,globals,
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

test('Obsidian inline indexes render current metadata, respect show, and open native note links',async()=>{
  const h=host();
  try {
    const {element}=await h.block('type: residents');
    assert.match(element.textContent,/Alice Example/);assert.match(element.textContent,/Bob/);
    assert.doesNotMatch(element.textContent,/Visitor|Dead|Future/);
    const link=element.querySelector('.taelgar-index-link');h.click(link);
    assert.deepEqual(h.opened[0],['People/Alice.md','Places/Realm.md',false]);
    h.event(link,'click',{ctrlKey:true});assert.equal(h.opened[1][2],true);
    const hidden=await h.block('type: residents\nshow: website');assert.equal(hidden.element.hidden,true);assert.equal(hidden.element.innerHTML,'');
    const both=await h.block('type: members\ntarget: Guild\nshow: both');assert.match(both.element.textContent,/Treasurer/);
    const invalid=await h.block('type: residents\nshow: invalid');assert.match(invalid.element.textContent,/show must/);
  } finally {h.feature.unload();}
  assert.equal(h.intervals.size,0);assert.equal(h.cache.count,0);assert.equal(h.vault.count,0);
});

test('new header buttons follow the callout, stay outside it, and release open dialogs',async()=>{
  const h=host();
  try {
    const bio=await h.block('','Places/Realm.md','taelgar-header');
    assert.equal(bio.element.querySelectorAll('.taelgar-index-buttons').length,1);
    assert.equal(bio.element.querySelectorAll('.taelgar-index-popup').length,2);
    const buttons=bio.element.querySelector('.taelgar-index-buttons');
    assert.equal(buttons.parentElement.className,'taelgar-generated-bio');
    assert.equal(buttons.previousElementSibling.tagName,'BLOCKQUOTE');
    assert.equal(buttons.closest('blockquote,[data-callout]'),null);
    assert.equal(buttons.parentElement.lastElementChild,buttons);
    const saved=await h.savedHeader();assert.equal(saved.element.querySelectorAll('.taelgar-index-buttons').length,0);
    const direct=await h.savedHeader(true);assert.equal(direct.element.querySelectorAll('.taelgar-index-buttons').length,0,'an ordinary H1 is left alone');
    const summary=buttons.querySelector('summary');h.click(summary);
    const dialog=h.document.querySelector('dialog[open]');assert.ok(dialog);assert.match(dialog.textContent,/Alice Example/);
    assert.equal(h.document.documentElement.classList.contains('taelgar-index-open'),true);
    h.click(dialog.querySelector('.taelgar-index-close'));assert.equal(h.document.querySelector('dialog'),null);
    assert.equal(h.document.activeElement,summary);
    assert.equal(h.document.documentElement.classList.contains('taelgar-index-open'),false);
    h.click(summary);bio.child.unload();assert.equal(h.document.querySelector('dialog'),null);
  } finally {h.feature.unload();}
});

test('vault edits, date changes, renames and deletes refresh live indexes without stale popups',async()=>{
  const h=host();
  try {
    const {element}=await h.block('type: members\ntarget: Guild');assert.match(element.textContent,/Treasurer/);
    h.metadata.get('People/Alice.md').affiliations=[];h.cache.trigger('changed');await pause(160);
    assert.doesNotMatch(element.textContent,/Alice Example/);
    h.metadata.get('People/Alice.md').affiliations=[{org:'Guild',start:'1710-01-01',end:'1730-01-01'}];
    h.vault.trigger('rename');await pause(160);assert.match(element.textContent,/Alice Example/);
    h.globals.customJS={state:{overrideDate:'1735-01-01'}};
    for(const tick of h.intervals.values())tick();await pause(10);assert.doesNotMatch(element.textContent,/Alice Example/);
    h.globals.customJS.state.overrideDate='1720-01-01';
    h.files.splice(h.files.findIndex(file=>file.path==='People/Alice.md'),1);h.vault.trigger('delete');await pause(160);
    assert.doesNotMatch(element.textContent,/Alice Example/);
  } finally {h.feature.unload();}
});

test('unloading during asynchronous bio rendering cannot mount stale index controls',async()=>{
  const h=host();
  try {
    h.defer();const pending=h.block('','Places/Realm.md','taelgar-header');await pause(20);
    h.feature.unload();h.release();const {element}=await pending;
    assert.equal(element.innerHTML,'');assert.equal(h.document.querySelector('dialog'),null);
  } finally {h.feature.unload();}
});

test('shared popups support native details fallback, backdrop dismissal and disposal',()=>{
  const h=imageDOM(indexPopup({label:'Residents',target:'Town',items:[],warnings:[]},()=>''));
  const dispose=mountIndexPopups(h.document),summary=h.document.querySelector('summary');h.click(summary);
  const dialog=h.document.querySelector('dialog');assert.equal(dialog.open,true);
  h.event(dialog,'pointerdown',{clientX:-10,clientY:-10});h.event(dialog,'click',{clientX:-10,clientY:-10});
  assert.equal(h.document.querySelector('dialog'),null);
  h.click(summary);dispose();assert.equal(h.document.querySelector('dialog'),null);
  h.window.HTMLElement.prototype.showModal=undefined;
  const cleanup=mountIndexPopups(h.document);assert.equal(h.click(summary).defaultPrevented,false);cleanup();
});

test('Obsidian grids resolve local images and people tables keep native links, last-known locations and homes',async()=>{
  const h=host();
  try {
    const grid=await h.block('type: residents\nmode: grid');
    assert.equal(grid.element.querySelectorAll('img').length,1);
    assert.equal(grid.element.querySelector('img').getAttribute('src'),'app://local/portraits/alice.png');
    assert.match(grid.element.querySelector('.taelgar-index-card').textContent,/Alice Example \(she\/her AL-iss\)/);
    assert.equal(grid.element.querySelectorAll('.taelgar-index-card')[1].querySelector('a').textContent,'Bob');
    assert.match(grid.element.querySelector('.taelgar-index-card').textContent,/Current Location: the Other Realm \(January 1st, 1720\)/);
    assert.match(grid.element.querySelector('.taelgar-index-card').textContent,/Home: Inn/);
    assert.doesNotMatch(grid.element.textContent,/Visitor/);
    const table=await h.block('type: residents\nmode: table');
    assert.equal(table.element.querySelectorAll('img,.taelgar-index-grid').length,0);
    const cells=table.element.querySelector('tbody tr').querySelectorAll('td');
    assert.equal(cells[0].textContent,'Alice Example (she/her AL-iss)');assert.equal(cells[1].textContent,'Townfolk human');
    assert.equal(cells[2].textContent,'the Other Realm (January 1st, 1720)');h.click(cells[2].querySelector('a'));
    assert.deepEqual(h.opened[0],['Places/Other Realm.md','Places/Realm.md',false]);
    assert.equal(cells[3].textContent,'Inn');h.click(cells[3].querySelector('a'));
    assert.deepEqual(h.opened[1],['Places/Inn.md','Places/Realm.md',false]);
    assert.doesNotMatch(table.element.textContent,/Visitor/);
    const header=await h.block('','Places/Realm.md','taelgar-header');
    assert.equal(header.element.querySelectorAll('.taelgar-index-popup img').length,1);
    assert.equal(header.element.querySelectorAll('.taelgar-index-popup table').length,0);
    assert.match(header.element.querySelector('.taelgar-index-popup .taelgar-index-card').textContent,/Alice Example \(she\/her AL-iss\)/);
  } finally {h.feature.unload();}
});

test('Obsidian settlement tables use home regions, type aliases and formatted populations, including ruins',async()=>{
  const h=host();
  try {
    const table=await h.block('type: settlements\nmode: table');
    assert.deepEqual([...table.element.querySelectorAll('th')].map(cell=>cell.textContent),['Place','Region','Type Of','Population']);
    const rows=[...table.element.querySelectorAll('tbody tr')].map(row=>[...row.querySelectorAll('td')].map(cell=>cell.textContent));
    assert.deepEqual(rows,[['Ruin','Realm','settlement','—'],['Town','Realm','town','pop. 1,234']]);
    const region=table.element.querySelector('tbody tr td:nth-child(2) a');h.click(region);
    assert.deepEqual(h.opened[0],['Places/Realm.md','Places/Realm.md',false]);
  } finally {h.feature.unload();}
});

test('Obsidian member tables format pronouns, info and dated last-known locations with native links',async()=>{
  const h=host();
  try {
    const alice=h.metadata.get('People/Alice.md');
    alice.pronouns='xe/xem';
    alice.whereabouts=[{type:'away',location:'Inn',start:'1708-01-01',end:'1710-01-01'}];
    const table=await h.block('type: members\ntarget: Guild\nmode: table');
    assert.deepEqual([...table.element.querySelectorAll('th')].map(cell=>cell.textContent),['Person','Info','Current Location']);
    const cells=table.element.querySelector('tbody tr').querySelectorAll('td');
    assert.equal(cells[0].textContent,'Alice Example (xe/xem AL-iss)');assert.equal(cells[1].textContent,'Townfolk human');
    assert.equal(cells[2].textContent,'Inn, Town (January 1st, 1710)');
    h.click(cells[2].querySelector('a'));assert.deepEqual(h.opened[0],['Places/Inn.md','Places/Realm.md',false]);
    assert.equal(table.element.querySelectorAll('tbody tr').length,6,'local results follow affiliation dates, including future-born and publication-hidden members');
    assert.equal(table.element.querySelectorAll('img').length,0);
    const grid=await h.block('type: members\ntarget: Guild\nmode: grid');
    assert.match(grid.element.querySelector('.taelgar-index-card').textContent,/Alice Example \(xe\/xem AL-iss\)/);
    assert.match(grid.element.querySelector('.taelgar-index-card').textContent,/Current Location: Inn, Town \(January 1st, 1710\)/);
    assert.doesNotMatch(grid.element.querySelector('.taelgar-index-card').textContent,/Home:/);
  } finally {h.feature.unload();}
});
