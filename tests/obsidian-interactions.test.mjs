import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {setTimeout as pause} from 'node:timers/promises';
import {build} from 'esbuild';
import {ROOT} from '../src/config.mjs';
import {parseNote} from '../src/content-store.mjs';
import {imageDOM} from './helpers/image-dom.mjs';
import {codeMirrorHost} from './helpers/codemirror-host.mjs';

const require=createRequire(import.meta.url);
const compiled=await build({absWorkingDir:ROOT,stdin:{contents:"export * from './obsidian/taelgarverse/features/interactions.mjs'; export * from './obsidian/taelgarverse/features/interaction-data.mjs';",resolveDir:ROOT},write:false,
  bundle:true,platform:'node',format:'cjs',external:['obsidian','@codemirror/state','@codemirror/view'],logLevel:'silent'});
const registry={campaigns:{cleenseau:{name:'Cleenseau',code:'clee',aliases:['Clee'],campaignRoot:'Campaigns/Clee',notePattern:'Session {session_padded}.md'},other:{name:'Other',code:'other',aliases:['OTH'],campaignRoot:'Campaigns/Other'}}};
const recap=(campaign,text)=>['## Session Header','- Campaign: '+campaign,'- Session Number: 1','- Desc Title: At the Inn','- DR Date: 1748-01-01','## Recap',
  '### recap-001 | Meeting','- Date: 1748-01-01','- NPCs: Person','- Polished Transcript: beat-transcripts/meeting.md','#### Short',text,'#### Long','Unused narrative.'].join('\n');
const initial={
  'People/Person.md':'---\ntags: [person]\nknownTo: [Clee, OTH, clee]\nexcludePublish: all\npageTargetDate: 1748-01-02\n---\n# Person\nBiography.',
  'Places/Inn.md':'---\ntags: [place]\nknownTo: clee\n---\n# Inn',
  'World.md':'# World\n[[Person]]',
  'Campaigns/Clee/Session 01.md':'---\ntags: [session-note]\ncampaign: Clee\nsessionNumber: 1\nDR: 1748-01-01\n---\n[[Person]]',
  'Campaigns/Other/Session 01.md':'---\ntags: [session-note]\ncampaign: Other\nsessionNumber: 1\nDR: 1748-01-01\n---\n[[Person]]',
  'Campaigns/Clee/Handout.md':'# Handout\n[[Person]] [[Inn]]',
  'Campaigns/Clee/Conditional.md':'%%^Campaign:other%%[[Person]]%%^End%%',
  'Campaigns/Clee/Later.md':'%%^Date:1750-01-02%%[[Person]]%%^End%%',
  'Campaigns/Clee/Secret.md':'# Secret\n%% A DM reference to [[Person]]. %%',
  'Campaigns/Clee/Header.md':'---\nheaderVersion: 1\ntags: [person]\n---\n# Header [[Person]]\n\nBody without a link.',
  'Campaigns/Clee/_generated/narrative.md':'[[Person]]',
  '_sessions/cleenseau/cleenseau-001/cleaned/cleenseau-001-session-recap.md':recap('Clee','Person met the Cleenseau party.'),
  '_sessions/other/other-001/cleaned/other-001-session-recap.md':recap('Other','Person met the other party.'),
  '_sessions/cleenseau/cleenseau-001/cleaned/beat-transcripts/meeting.md':'Private local polished transcript.',
  '_sessions/cleenseau/cleenseau-001/cleaned/cleenseau-001-source-cleaned.md':'Raw transcript is never read.',
};
function events(){const callbacks=new Map();return {on(name,fn){const set=callbacks.get(name)||new Set();set.add(fn);callbacks.set(name,set);return ()=>set.delete(fn);},trigger(name){for(const fn of callbacks.get(name)||[])fn();},get count(){return [...callbacks.values()].reduce((n,set)=>n+set.size,0);}};}
function host({automatic=false,notes={}}={}) {
  const dom=imageDOM('<div id="leaf"><div class="markdown-preview-view"><div class="markdown-preview-sizer"><p>Biography</p></div></div></div>');
  class Component {
    constructor(){this.children=new Set();this.cleanups=[];}
    load(){if(this.loaded)return;this.loaded=true;this.ready=this.onload?.();}
    unload(){if(!this.loaded)return;this.loaded=false;this.onunload?.();for(const child of [...this.children])this.removeChild(child);for(const cleanup of this.cleanups)cleanup();this.cleanups=[];}
    addChild(child){this.children.add(child);child.load();return child;}
    removeChild(child){this.children.delete(child);child.unload();}
    registerEvent(off){this.cleanups.push(off);}
    registerDomEvent(element,name,fn){element.addEventListener(name,fn);this.cleanups.push(()=>element.removeEventListener(name,fn));}
  }
  class MarkdownRenderChild extends Component {constructor(element){super();this.containerEl=element;}}
  const cm=codeMirrorHost(),infoField=Symbol('info'),liveField=Symbol('live'),module={exports:{}},intervals=new Map();let timer=0;
  const globals={module,exports:module.exports,console,structuredClone,TextEncoder,TextDecoder,URLSearchParams,setTimeout,clearTimeout,
    setInterval:fn=>{intervals.set(++timer,fn);return timer;},clearInterval:id=>intervals.delete(id),
    require:name=>name==='obsidian'?{Component,MarkdownRenderChild,editorInfoField:infoField,editorLivePreviewField:liveField}:name==='@codemirror/state'?cm.state:name==='@codemirror/view'?cm.view:require(name)};
  vm.runInNewContext(compiled.outputFiles[0].text,globals);
  const texts=new Map(Object.entries({...initial,...notes})),files=new Map(),metadata=new Map(),reads=[],opened=[];
  for(const [p,text] of texts){files.set(p,{path:p,basename:path.posix.basename(p,'.md'),extension:'md'});metadata.set(p,parseNote(text).metadata);}
  const cache=events(),vault=events(),workspace=events();let defer,release;
  const app={metadataCache:{...cache,getFileCache(file){const source=texts.get(file.path);return {frontmatter:metadata.get(file.path),links:[...source.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map(match=>({link:match[1],position:{start:{offset:match.index},end:{offset:match.index+match[0].length}}}))};},
    getFirstLinkpathDest:target=>[...files.values()].find(file=>file.path===target || file.path===target+'.md' || file.basename===target)},
    vault:{...vault,getName:()=> 'Test Vault',getMarkdownFiles:()=>[...files.values()],getAbstractFileByPath:p=>files.get(p),
      adapter:{async read(){if(defer)await defer;return JSON.stringify(registry);}},cachedRead:async file=>{reads.push(file.path);return texts.get(file.path);}},
    workspace:{...workspace,onLayoutReady:fn=>fn(),iterateAllLeaves:fn=>leaves.forEach(fn),openLinkText:(...args)=>opened.push(args)}};
  const view={file:files.get('People/Person.md'),mode:'preview',getMode(){return this.mode;},getViewType:()=> 'markdown',previewMode:{containerEl:dom.document.querySelector('.markdown-preview-view')}};
  const leaves=[{view}],processors=new Map(),extensions=[];
  const plugin={app,settings:{automaticInteractions:automatic},registerMarkdownCodeBlockProcessor:(language,fn)=>processors.set(language,fn),registerMarkdownPostProcessor(fn){this.post=fn;},registerEditorExtension:value=>extensions.push(value)};
  const feature=new module.exports.InteractionsFeature(plugin);feature.load();
  return {...dom,...module.exports,globals,app,feature,plugin,view,leaves,processors,extensions,metadata,texts,reads,opened,intervals,cache,vault,workspace,
    async settle(){await pause(15);await Promise.all([...feature.panels.values()].map(child=>child.ready));await pause(5);},
    block(source='',p='People/Person.md'){const element=dom.document.createElement('div');dom.document.body.append(element);let child;processors.get('taelgar-interactions')(source,element,{sourcePath:p,addChild(value){child=value;child.load();}});return {element,child};},
    editor(source=texts.get('People/Person.md'),p='People/Person.md',live=true){return {doc:{length:source.length,toString:()=>source},field:key=>key===liveField?live:key===infoField?{file:files.get(p)}:undefined};},
    defer(){defer=new Promise(resolve=>{release=resolve;});},release(){defer=null;release();}};
}

test('Obsidian indexes authoritative recaps and native campaign references, retains local excluded pages, and never reads session bodies or transcripts',async()=>{
  const h=host();
  try {
    const snapshot=await h.obsidianInteractions(h.app),metadata=h.metadata.get('People/Person.md');
    assert.deepEqual(Array.from(h.knownCampaigns(snapshot,metadata),item=>item.code),['clee','other']);
    const result=h.localInteractions(snapshot,'People/Person.md',registry.campaigns.cleenseau,'1748-01-02',h.app);
    assert.deepEqual(Array.from(result.group.events,event=>event.title),['Meeting','Handout','Secret']);
    assert.match(result.group.events[0].text,/Cleenseau party/);
    assert.equal(result.links.get(result.group.events[0].sessionUrl),'Campaigns/Clee/Session 01.md');
    assert.equal(result.links.get(result.group.events[0].transcriptUrl),'_sessions/cleenseau/cleenseau-001/cleaned/beat-transcripts/meeting.md');
    assert.ok(h.reads.every(p=>!p.includes('/Session 01.md') && !p.includes('transcript') && !p.startsWith('World') && !p.includes('_generated')));
    assert.equal(h.metadata.get('People/Person.md').excludePublish,'all','vault metadata is never modified');
  }finally{h.feature.unload();}
});

test('explicit blocks select known campaigns, retain choice after refresh, and open native session and transcript links',async()=>{
  const h=host();
  try {
    const {element,child}=h.block();await child.ready;
    assert.equal(element.querySelectorAll('select[aria-label="Campaign"] option').length,2);
    assert.match(element.textContent,/Cleenseau party/);
    const sessionLink=element.querySelector('.interaction-detail .interaction-sources a');
    assert.ok(child.links.has(sessionLink.getAttribute('href')),sessionLink.outerHTML+' '+JSON.stringify([...child.links]));
    h.click(sessionLink);
    assert.equal(h.opened[0][0],'Campaigns/Clee/Session 01.md');
    h.click(element.querySelector('.interaction-detail .interaction-sources a:last-child'));assert.match(h.opened[1][0],/beat-transcripts\/meeting.md/);
    const select=element.querySelector('select[aria-label="Campaign"]');select.querySelector('option[value="other"]').selected=true;select.dispatchEvent(new h.window.Event('change'));await h.settle();
    assert.match(element.textContent,/other party/);assert.doesNotMatch(element.textContent,/Cleenseau party/);
    h.cache.trigger('changed');await pause(190);await h.settle();assert.match(element.textContent,/other party/);
    child.unload();assert.equal(h.feature.panels.size,0);
  }finally{h.feature.unload();}
  assert.equal(h.intervals.size,0);assert.equal(h.cache.count,0);assert.equal(h.vault.count,0);assert.equal(h.workspace.count,0);assert.equal(h.resize.size,0);
});

test('native backlink offsets preserve CRLF frontmatter and saved-header boundaries',async()=>{
  const h=host({notes:{'Campaigns/Clee/Windows.md':'---\r\nname: Windows letter\r\n---\r\n\r\n[[Person]]\r\n',
    'Campaigns/Clee/Windows header.md':'---\r\nheaderVersion: 1\r\ntags: [person]\r\n---\r\n# Saved header [[Person]]\r\n\r\nBody.\r\n'}});
  try{
    const snapshot=await h.obsidianInteractions(h.app),events=h.localInteractions(snapshot,'People/Person.md',registry.campaigns.cleenseau,'1748-01-02',h.app).group.events;
    assert.ok(events.some(event=>event.title==='Windows letter'));
    assert.equal(events.some(event=>event.title==='Windows header'),false);
  }finally{h.feature.unload();}
});

test('automatic Reading View footers stay at the end, appear on non-person knownTo pages, suppress explicit blocks, and disappear when notes close',async()=>{
  const h=host({automatic:true});
  try {
    await h.feature.syncReading();await h.settle();const root=h.document.querySelector('.markdown-preview-sizer');
    assert.equal(root.querySelectorAll('.taelgar-interactions').length,1);
    const tail=h.document.createElement('p');tail.textContent='Rendered later';root.append(tail);await h.settle();assert.ok(root.lastElementChild.classList.contains('taelgar-interactions'));
    await h.feature.syncReading();assert.equal(root.querySelectorAll('.taelgar-interactions').length,1);
    h.view.file=h.app.vault.getAbstractFileByPath('Places/Inn.md');await h.feature.syncReading();await h.settle();assert.match(root.textContent,/Handout/);assert.equal(root.querySelector('select[aria-label="Campaign"]'),null);
    h.texts.set('Places/Inn.md',h.texts.get('Places/Inn.md')+'\n\n```taelgar-interactions\n```');await h.feature.syncReading();assert.equal(root.querySelectorAll('.taelgar-interactions').length,0);
    h.view.file=h.app.vault.getAbstractFileByPath('People/Person.md');await h.feature.syncReading();await h.settle();
    h.feature.setAutomatic(false);await pause(180);await h.feature.syncReading();assert.equal(root.querySelectorAll('.taelgar-interactions').length,0);
    h.feature.setAutomatic(true);await h.feature.syncReading();await h.settle();h.leaves.length=0;await h.feature.syncReading();assert.equal(h.feature.panels.size,0);assert.equal(h.mutations.size,0);
  }finally{h.feature.unload();}
});

test('Live Preview uses a block widget at the document end, updates for edits and metadata, and leaves Source mode and explicit fences alone',async()=>{
  const h=host({automatic:true});
  try {
    const [field,Tracker]=h.extensions[0],state=h.editor(),ranges=field.create(state).ranges;
    assert.equal(ranges.length,1);assert.equal(ranges[0].from,state.doc.length);assert.equal(ranges[0].value.block,true);
    const editor={dom:h.document.createElement('div'),requestMeasure(){},dispatch(){}};const tracker=new Tracker(editor);
    const widget=ranges[0].value.widget,element=widget.toDOM(editor);h.document.body.append(element);await h.settle();assert.match(element.textContent,/Cleenseau party/);
    const edited=h.editor('Updated body');const updated=field.update({ranges},{docChanged:true,effects:[],state:edited,startState:state});assert.equal(updated.ranges[0].from,12);
    assert.equal(field.create(h.editor('```taelgar-interactions\n```')).ranges.length,0);
    assert.equal(field.create(h.editor('Body','People/Person.md',false)).ranges.length,0);
    assert.equal(field.create(h.editor('Body','World.md')).ranges.length,0);
    const examples='````markdown\n```taelgar-interactions\n```\n````';assert.equal(h.hasInteractionsBlock(examples),false);
    h.metadata.get('People/Person.md').knownTo=[];assert.equal(field.create(state).ranges.length,0);
    widget.destroy(element);tracker.destroy();assert.equal(h.feature.editors.size,0);
  }finally{h.feature.unload();}
});

test('date overrides and recap edits refresh the shared history without stale renders or note writes',async()=>{
  const h=host();
  try {
    const {element,child}=h.block();await child.ready;
    h.globals.customJS={state:{overrideDate:'1747-01-01'}};for(const tick of h.intervals.values())tick();await h.settle();assert.doesNotMatch(element.textContent,/Cleenseau party/);assert.match(element.textContent,/Handout/);
    h.globals.customJS.state.overrideDate='1750-01-02';for(const tick of h.intervals.values())tick();await h.settle();assert.match(element.textContent,/Later/);
    const p='_sessions/cleenseau/cleenseau-001/cleaned/cleenseau-001-session-recap.md';h.texts.set(p,h.texts.get(p).replace('Cleenseau party','edited party'));h.vault.trigger('modify');await pause(190);await h.settle();assert.match(element.textContent,/edited party/);
    assert.equal(h.interactionsDate({},{FantasyCalendarAPI:{getCalendars:()=>[{current:{year:1748,month:0,day:2}}]}},'1750-01-01'),'1748-01-02');
    assert.equal(h.texts.get('People/Person.md'),initial['People/Person.md']);
  }finally{h.feature.unload();}
});

test('closed panels cannot mount late results and invalid block bodies explain the supported syntax',async()=>{
  const h=host();
  try {
    h.defer();const {element,child}=h.block();child.unload();h.release();await child.ready;assert.equal(element.childElementCount,0);
    const invalid=h.block('campaign: clee');await invalid.child.ready;assert.match(invalid.element.textContent,/Leave.*empty/);invalid.child.unload();
  }finally{h.feature.unload();}
});
