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
  const cache=events(),vault=events(),bodies=new Map();
  const app={metadataCache:{...cache,getFileCache:file=>file && {frontmatter:metadata.get(file.path)},
    getFirstLinkpathDest:(target,source)=>[...files,...images].find(file=>file.path===target || file.path===target+'.md' || file.basename===target || metadata.get(file.path)?.aliases?.includes(target))},
    vault:{...vault,configDir:'.obsidian',getRoot:()=>({path:''}),getMarkdownFiles:()=>files,getAbstractFileByPath:path=>files.find(file=>file.path===path),
      adapter:{read:async path=>JSON.stringify(path.endsWith('metadata.json')?input.coreMeta:input.registry)},
      cachedRead:async file=>bodies.get(file.path) ?? indexSources(Object.fromEntries(metadata))[file.path].replace('Authored prose.',file.path==='People/Alice.md' ? "Alice's first authored sentence. A second sentence." : 'Authored prose.'),
      getResourcePath:file=>'app://local/'+file.path},
    workspace:{openLinkText:(...args)=>opened.push(args)}};
  const plugin={app,settings,registerMarkdownCodeBlockProcessor:(type,processor)=>processors.set(type,processor),registerMarkdownPostProcessor:processor=>postprocessors.push(processor)};
  const feature=new module.exports.HeadersFeature(plugin);feature.load();
  const context=sourcePath=>({sourcePath,addChild(child){child.load();this.child=child;}});
  return {...dom,...module.exports,app,feature,metadata,files,bodies,opened,intervals,cache,vault,globals,
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

test('Obsidian inline grids and tables have H2 labels, including empty results',async()=>{
  const h=host();
  try {
    for(const [path,metadata] of Object.entries(featureIndexNotes)) {
      h.metadata.set(path,metadata);h.files.push({path,basename:path.split('/').at(-1).replace(/\.md$/,'')});
    }
    for(const [type,source,label] of [['residents','Places/Realm.md','Residents'],['settlements','Places/Realm.md','Settlements'],['members','Groups/Guild.md','Members'],['rivers','Places/Basin.md','Rivers'],['places','Places/Town.md','Places'],['places','Places/Inn.md','Places']])for(const mode of ['grid','table']) {
      const {element}=await h.block('type: '+type+'\nmode: '+mode,source);
      const section=element.querySelector('.taelgar-index');
      assert.equal(section.firstElementChild.tagName,'H2');
      assert.equal(section.querySelectorAll('h2').length,1);
      assert.equal(section.querySelector('h2').textContent,label);
    }
    const bio=await h.block('','Places/Realm.md','taelgar-header');
    h.click(bio.element.querySelector('summary'));await pause(10);
    const dialog=h.document.querySelector('dialog[open]');
    assert.equal(dialog.querySelectorAll('h2').length,1,'the popup keeps its single dialog title');
  } finally {h.feature.unload();}
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
    assert.equal(buttons.querySelectorAll('.taelgar-index-card,img').length,0,'headers do not build popup rows');
    const summary=buttons.querySelector('summary');h.click(summary);await pause(10);
    const dialog=h.document.querySelector('dialog[open]');assert.ok(dialog);assert.match(dialog.textContent,/Alice Example/);
    h.click(dialog.querySelector('.taelgar-index-link'));assert.equal(h.opened.length,1);
    assert.equal(h.opened[0][1],'Places/Realm.md');
    assert.equal(h.document.documentElement.classList.contains('taelgar-index-open'),true);
    h.click(dialog.querySelector('.taelgar-index-close'));assert.equal(h.document.querySelector('dialog'),null);
    assert.equal(h.document.activeElement,summary);
    assert.equal(h.document.documentElement.classList.contains('taelgar-index-open'),false);
    h.click(summary);bio.child.unload();assert.equal(h.document.querySelector('dialog'),null);
    h.metadata.set('Groups/Empty.md',{tags:['group'],indexes:['members']});
    h.files.push({path:'Groups/Empty.md',basename:'Empty'});
    h.cache.trigger('changed');await pause(160);
    const empty=await h.block('','Groups/Empty.md','taelgar-header');
    assert.equal(empty.element.querySelector('.taelgar-index-popup'),null);
    assert.equal(empty.element.querySelector('.taelgar-index-buttons'),null);
    const inline=await h.block('type: members','Groups/Empty.md');
    assert.match(inline.element.textContent,/No members found/);
  } finally {h.feature.unload();}
});

test('disabled header popups preserve headers, inline indexes, and frontmatter',async()=>{
  const h=host({headerIndexPopups:false});
  try {
    const before=JSON.stringify([...h.metadata]);
    for(const path of ['Places/Realm.md','Groups/Guild.md']) {
      const bio=await h.block('',path,'taelgar-header');
      assert.ok(bio.element.querySelector('h1'));
      assert.ok(bio.element.querySelector('blockquote'));
      assert.equal(bio.element.querySelector('.taelgar-index-buttons'),null);
    }
    const table=await h.block('type: members\ntarget: Guild\nmode: table\nshow: obsidian');
    assert.ok(table.element.querySelector('table'));
    assert.match(table.element.textContent,/Alice Example/);
    const grid=await h.block('type: residents');
    assert.ok(grid.element.querySelector('.taelgar-index-grid'));
    assert.equal(JSON.stringify([...h.metadata]),before);
  } finally {h.feature.unload();}
});

test('header popup toggle closes dialogs immediately and refreshes existing and pending headers',async()=>{
  const h=host();
  try {
    const bio=await h.block('','Places/Realm.md','taelgar-header');
    const table=await h.block('type: residents\nmode: table');
    const originalTable=table.element.querySelector('table');
    h.click(bio.element.querySelector('summary'));await pause(10);
    assert.ok(h.document.querySelector('dialog[open]'));
    h.defer();
    const disabling=h.feature.setHeaderIndexPopups(false);
    assert.equal(h.document.querySelector('dialog'),null);
    assert.equal(h.document.documentElement.classList.contains('taelgar-index-open'),false);
    h.release();await disabling;
    assert.equal(bio.element.querySelector('.taelgar-index-buttons'),null);
    assert.equal(table.element.querySelector('table'),originalTable);
    await h.feature.setHeaderIndexPopups(true);
    assert.ok(bio.element.querySelector('summary'));
    h.click(bio.element.querySelector('summary'));await pause(10);
    assert.match(h.document.querySelector('dialog').textContent,/Alice Example/);
    h.defer();const pending=h.block('','Places/Realm.md','taelgar-header');await pause(10);
    const disabled=h.feature.setHeaderIndexPopups(false);
    h.release();await disabled;
    const later=await pending;
    assert.equal(later.element.querySelector('.taelgar-index-buttons'),null);
    assert.equal(h.document.querySelector('dialog'),null);
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
  const h=imageDOM(indexPopup({label:'Residents',target:'Town',items:[{name:'Alice'}],warnings:[]},item=>item.name));
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
    assert.equal(header.element.querySelectorAll('.taelgar-index-card,img').length,0);
    h.click(header.element.querySelector('summary'));await pause(10);
    const popup=h.document.querySelector('dialog');
    assert.equal(popup.querySelectorAll('img').length,1);
    assert.equal(popup.querySelectorAll('table').length,0);
    assert.match(popup.querySelector('.taelgar-index-card').textContent,/Alice Example \(she\/her AL-iss\)/);
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

test('Obsidian member tables format pronouns, info, dated locations and homes; grids show the first authored sentence',async()=>{
  const h=host();
  try {
    const alice=h.metadata.get('People/Alice.md');
    alice.pronouns='xe/xem';
    alice.whereabouts=[{type:'away',location:'Inn',start:'1708-01-01',end:'1710-01-01'}];
    const table=await h.block('type: members\ntarget: Guild\nmode: table');
    assert.deepEqual([...table.element.querySelectorAll('th')].map(cell=>cell.textContent),['Person','Info','Current Location','Home']);
    const cells=table.element.querySelector('tbody tr').querySelectorAll('td');
    assert.equal(cells[0].textContent,'Alice Example (xe/xem AL-iss)');assert.equal(cells[1].textContent,'Townfolk human');
    assert.equal(cells[2].textContent,'Inn, Town (January 1st, 1710)');
    h.click(cells[2].querySelector('a'));assert.deepEqual(h.opened[0],['Places/Inn.md','Places/Realm.md',false]);
    assert.equal(table.element.querySelectorAll('tbody tr:not([hidden])').length,6,'local results follow affiliation dates, including future-born and publication-hidden members');
    assert.equal(table.element.querySelectorAll('img').length,0);
    const grid=await h.block('type: members\ntarget: Guild\nmode: grid');
    assert.match(grid.element.querySelector('.taelgar-index-card').textContent,/Alice Example \(xe\/xem AL-iss\)/);
    assert.match(grid.element.querySelector('.taelgar-index-card').textContent,/Alice's first authored sentence\./);
    assert.doesNotMatch(grid.element.querySelector('.taelgar-index-card').textContent,/A second sentence/);
    assert.doesNotMatch(grid.element.querySelector('.taelgar-index-card').textContent,/Current Location:/);
    assert.doesNotMatch(grid.element.querySelector('.taelgar-index-card').textContent,/Home:/);
  } finally {h.feature.unload();}
});


test('Obsidian Members grids and tables honor includeHistorical modes without sharing checkbox or cached query state',async()=>{
  const h=host();
  try {
    for(const mode of ['grid','table']) {
      const source='type: members\ntarget: Guild\nmode: '+mode;
      const automatic=await h.block(source+'\nincludeHistorical: null');
      const checkbox=automatic.element.querySelector('input[data-index-include-historical]');
      const deceased=automatic.element.querySelector('[data-index-deceased]');
      assert.equal(checkbox.hasAttribute('checked'),false);assert.equal(deceased.hidden,true);
      checkbox.checked=true;h.event(checkbox,'change');assert.equal(deceased.hidden,false);
      const included=await h.block(source+'\nincludeHistorical: true');
      assert.equal(included.element.querySelector('input[data-index-include-historical]'),null);
      assert.equal(included.element.querySelector('[data-index-deceased]').hidden,false);
      const excluded=await h.block(source+'\nincludeHistorical: false');
      assert.equal(excluded.element.querySelector('input[data-index-include-historical]'),null);
      assert.equal(excluded.element.querySelector('[data-index-deceased]'),null);
      const again=await h.block(source);
      assert.equal(again.element.querySelector('[data-index-deceased]').hidden,true,'another render retains its default');
    }
  } finally {h.feature.unload();}
});

test('Obsidian entirely deceased groups have a checked default popup and explicit false still renders empty',async()=>{
  const h=host();
  try {
    h.metadata.set('Groups/Old.md',{tags:['group']});
    h.metadata.set('People/Old Member.md',{tags:['person'],died:'1710-01-01',affiliations:['Old']});
    for(const path of ['Groups/Old.md','People/Old Member.md'])h.files.push({path,basename:path.split('/').at(-1).slice(0,-3)});
    const header=await h.block('','Groups/Old.md','taelgar-header');
    h.click(header.element.querySelector('summary'));await pause(10);
    const dialog=h.document.querySelector('dialog'),checkbox=dialog.querySelector('input[data-index-include-historical]');
    assert.equal(checkbox.hasAttribute('checked'),true);
    assert.equal(dialog.querySelector('[data-index-deceased]').hidden,false);
    checkbox.checked=false;h.event(checkbox,'change');
    assert.equal(dialog.querySelector('.taelgar-index-empty').hidden,false);
    const excluded=await h.block('type: members\nincludeHistorical: false','Groups/Old.md');
    assert.equal(excluded.element.querySelector('[data-index-member]'),null);
    assert.match(excluded.element.textContent,/No members found/);
  } finally {h.feature.unload();}
});

test('Obsidian auto-Members popups skip Cintra image callouts and explicit empty indexes override the default',async()=>{
  const h=host();
  try {
    h.metadata.set('People/Cintra.md',{tags:['person'],affiliations:['Shakun Mystai']});
    h.metadata.set('Groups/Shakun Mystai.md',{tags:['group']});
    for(const path of ['People/Cintra.md','Groups/Shakun Mystai.md'])h.files.push({path,basename:path.split('/').at(-1).slice(0,-3)});
    h.bodies.set('People/Cintra.md',cintraSource);
    const bio=await h.block('','Groups/Shakun Mystai.md','taelgar-header');
    assert.equal(bio.element.querySelector('summary').textContent,'Members');
    h.click(bio.element.querySelector('summary'));await pause(10);
    assert.ok(h.document.querySelector('dialog').textContent.includes(cintraSentence));
    assert.doesNotMatch(h.document.querySelector('dialog').textContent,/Cintra, the Supreme Oracle|Private preparation/);
    h.metadata.get('Groups/Shakun Mystai.md').indexes=[];
    const empty=await h.block('','Groups/Shakun Mystai.md','taelgar-header');
    assert.equal(empty.element.querySelector('.taelgar-index-buttons'),null);
    h.metadata.get('Groups/Shakun Mystai.md').indexes={members:true};
    const invalid=await h.block('','Groups/Shakun Mystai.md','taelgar-header');
    assert.ok(invalid.element.querySelector('.taelgar-generated-bio'));
    assert.match(invalid.element.querySelector('.taelgar-index-error').textContent,/indexes must be an array/);
  } finally {h.feature.unload();}
});

test('Obsidian table indexes avoid description reads and closing a view cancels a pending grid mount',async()=>{
  const h=host();
  try {
    h.app.vault.cachedRead=async()=>{throw new Error('Tables must not read descriptions');};
    const table=await h.block('type: members\ntarget: Guild\nmode: table');
    assert.ok(table.element.querySelector('table'));
    let started,release;
    const reading=new Promise(resolve=>{started=resolve;});
    const source=new Promise(resolve=>{release=resolve;});
    h.app.vault.cachedRead=()=>{started();return source;};
    const pending=h.block('type: members\ntarget: Guild');
    await reading;h.feature.unload();release(cintraSource);
    const grid=await pending;
    assert.equal(grid.element.innerHTML,'');
    assert.equal(h.document.querySelector('.taelgar-index-grid'),null);
  } finally {h.feature.unload();}
});

test('reused Obsidian queries isolate render additions, dates, targets and metadata refreshes',async()=>{
  const h=host();
  try {
    const snapshot=await h.feature.getSnapshot();
    const run=(date='1720-01-01',source='Places/Realm.md')=>h.obsidianIndex(h.app,snapshot,{type:'residents'},source,date);
    const first=run(),expected=JSON.stringify(first);
    first.items[0].name='Changed by one render';first.items[0].image='app://stale';
    first.items[0].person[0]='Changed nested part';first.warnings.push('Only this render');
    assert.equal(JSON.stringify(run()),expected);
    assert.equal(run('1750-01-01').items.length,0,'date changes cannot reuse the earlier residence');
    assert.deepEqual(Array.from(run('1720-01-01','Places/Other Realm.md').items,item=>item.path),['People/Visitor.md']);
    h.metadata.get('People/Alice.md').whereabouts='Other Realm';
    h.cache.trigger('changed');await pause(160);
    const updated=await h.feature.getSnapshot();
    const changed=h.obsidianIndex(h.app,updated,{type:'residents'},'Places/Realm.md','1720-01-01');
    assert.ok(!changed.items.some(item=>item.path==='People/Alice.md'));
  } finally {h.feature.unload();}
});


test('lazy popup loads coalesce, retry after failure, and ignore completion after disposal',async()=>{
  const h=imageDOM(indexPopupShell({type:'members',label:'Members',target:'Guild'}));
  let calls=0,resolve;
  const load=()=>{calls++;return new Promise(done=>{resolve=done;});};
  const dispose=mountIndexPopups(h.document,{load}),summary=h.document.querySelector('summary');
  assert.equal(calls,0);h.click(summary);h.click(summary);await pause(0);assert.equal(calls,1);
  dispose();resolve('<p>Stale rows</p>');await pause(0);
  assert.doesNotMatch(h.document.body.textContent,/Stale rows/);assert.equal(h.document.querySelector('dialog'),null);
  const retry=mountIndexPopups(h.document,{load:async()=>{if(++calls===2)throw new Error('Offline');return '<p>Loaded rows</p>';}});
  h.click(summary);await pause(0);assert.match(h.document.body.textContent,/Close and reopen to retry/);
  h.click(h.document.querySelector('dialog .taelgar-index-close'));h.click(summary);await pause(0);
  assert.match(h.document.body.textContent,/Loaded rows/);assert.equal(calls,3);retry();
  h.window.HTMLElement.prototype.showModal=undefined;
  const fallback=mountIndexPopups(h.document,{load:async()=>'<p>Fallback rows</p>'});
  assert.equal(h.click(summary).defaultPrevented,false);await pause(0);
  assert.match(h.document.body.textContent,/Fallback rows/);fallback();
});


test('Places filters keep independent Obsidian cached grids, tables and existence checks',async()=>{
  const h=host();
  try {
    const extra={...featureIndexNotes,
      'Places/Wood.md':{tags:['place'],typeOf:'forest',whereabouts:'Quarter'},
      'Places/Shrine.md':{tags:['place'],typeOf:'holy site',whereabouts:'Wood'},
    };
    for(const [path,metadata] of Object.entries(extra)) {
      h.metadata.set(path,{...structuredClone(metadata),pageTargetDate:'1720-01-01'});
      if(!h.files.some(file=>file.path===path))h.files.push({path,basename:path.split('/').at(-1).slice(0,-3)});
    }
    const all=await h.block('type: places','Places/Town.md');assert.match(all.element.textContent,/Wood/);assert.match(all.element.textContent,/Shrine/);
    const built=await h.block('type: places\nplaceType: built\nmode: table','Places/Town.md');
    assert.match(built.element.textContent,/Shop/);assert.match(built.element.textContent,/Shrine/);assert.doesNotMatch(built.element.textContent,/Wood/);
    const natural=await h.block('type: places\nplaceType: natural','Places/Town.md');
    assert.equal(natural.element.querySelectorAll('.taelgar-index-card').length,1);assert.match(natural.element.textContent,/Wood/);assert.doesNotMatch(natural.element.textContent,/Shop|Shrine/);
    h.click(natural.element.querySelector('.taelgar-index-link'));assert.deepEqual(h.opened.at(-1),['Places/Wood.md','Places/Town.md',false]);
    const snapshot=await h.obsidianHeaders(h.app),context='Places/Wood.md',date='1720-01-01';
    h.obsidianIndex(h.app,snapshot,{type:'places',placeType:'built'},context,date);
    assert.equal(h.obsidianIndexExists(h.app,snapshot,{type:'places',placeType:'built'},context,date),true);
    assert.equal(h.obsidianIndexExists(h.app,snapshot,{type:'places',placeType:'natural'},context,date),false);
    const invalid=await h.block('type: rivers\nplaceType: built','Places/Basin.md');assert.match(invalid.element.textContent,/only supported for places/);
  } finally {h.feature.unload();}
});

test('Rivers and Places use native links, compact tables and lazy image-card popups in Obsidian',async()=>{
  const h=host();
  try {
    for(const [path,metadata] of Object.entries(featureIndexNotes)) {
      h.metadata.set(path,{...structuredClone(metadata),pageTargetDate:'1720-01-01'});
      if(!h.files.some(file=>file.path===path))h.files.push({path,basename:path.split('/').at(-1).slice(0,-3)});
    }
    for(const [type,target,heading,expected] of [['rivers','Basin','River','Main River'],['places','Town','Place','Shop']]) {
      const inline=await h.block('type: '+type+'\nmode: table','Places/'+target+'.md');
      assert.deepEqual([...inline.element.querySelectorAll('th')].map(cell=>cell.textContent),[heading,'Type Of']);
      assert.match(inline.element.textContent,new RegExp(expected));assert.doesNotMatch(inline.element.textContent,/Future/);
      if(type==='rivers')assert.match(inline.element.textContent,/Lake/);
      const header=await h.block('','Places/'+target+'.md','taelgar-header');
      assert.equal(header.element.querySelectorAll('.taelgar-index-card,img').length,0);
      h.click(header.element.querySelector('summary'));await pause(10);
      const popup=h.document.querySelector('dialog[open]');assert.ok(popup);assert.match(popup.textContent,new RegExp(expected));
      if(type==='rivers')assert.match(popup.textContent,/Lake/);
      if(type==='rivers')assert.equal(popup.querySelector('img').getAttribute('src'),'app://local/portraits/alice.png');
      h.click(popup.querySelector('.taelgar-index-link'));assert.equal(h.opened.at(-1)[1],'Places/'+target+'.md');
      h.click(popup.querySelector('.taelgar-index-close'));
    }
  } finally {h.feature.unload();}
});
