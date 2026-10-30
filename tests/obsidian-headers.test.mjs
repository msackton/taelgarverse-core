import {testSettings} from './helpers/test-settings.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {setTimeout as pause} from 'node:timers/promises';
import {build} from 'esbuild';
import {imageDOM} from './helpers/image-dom.mjs';
import {codeMirrorHost} from './helpers/codemirror-host.mjs';
import {ROOT} from '../src/config.mjs';
import {parseNote} from '../src/content-store.mjs';
import {initializeHeaders,renderHeader} from '../src/headers.mjs';

const require=createRequire(import.meta.url),settings=testSettings();
const compiled=await build({absWorkingDir:ROOT,entryPoints:['obsidian/taelgarverse/features/headers.mjs'],write:false,
  bundle:true,platform:'node',format:'cjs',external:['obsidian','@codemirror/state','@codemirror/view'],logLevel:'silent'});
const sources=JSON.parse(fs.readFileSync(new URL('./fixtures/bio-blocks.json',import.meta.url),'utf8'));
const coreMeta=JSON.parse(fs.readFileSync(path.join(settings.vault_dir,'.obsidian/metadata.json'),'utf8'));
const registry=JSON.parse(fs.readFileSync(path.join(settings.vault_dir,'_scripts/session_note_campaigns.json'),'utf8'));

function events(){
  const callbacks=new Map();return {on(name,callback){const list=callbacks.get(name)||new Set();list.add(callback);callbacks.set(name,list);return ()=>list.delete(callback);},
    trigger(name){for(const callback of callbacks.get(name)||[])callback();},get count(){return [...callbacks.values()].reduce((n,list)=>n+list.size,0);}};
}
function host(extraSources={}){
  class Component {
    constructor(){this.disposers=[];this.children=new Set();}
    load(){if(this.loaded)return;this.loaded=true;this.onload?.();}
    addChild(child){this.children.add(child);child.load();return child;}
    removeChild(child){if(this.children.delete(child))child.unload();return child;}
    registerEvent(dispose){this.disposers.push(dispose);}
    unload(){this.onunload?.();for(const child of [...this.children])this.removeChild(child);for(const dispose of this.disposers)dispose();}
  }
  class MarkdownRenderChild extends Component {constructor(element){super();this.containerEl=element;}}
  const notices=[],calls=[],intervals=new Map();let next=0,deferred;
  const MarkdownRenderer={async render(app,markdown,element,sourcePath,child){calls.push({markdown,sourcePath,child});element.markdown=markdown;if(deferred)await deferred;}};
  const cm=codeMirrorHost();
  const module={exports:{}},globals={module,exports:module.exports,structuredClone,console,TextEncoder,TextDecoder,
    setTimeout,clearTimeout,setInterval:callback=>{intervals.set(++next,callback);return next;},clearInterval:id=>intervals.delete(id),
    require:name=>name==='@codemirror/state'?cm.state:name==='@codemirror/view'?cm.view:name==='obsidian'?{Component,MarkdownRenderChild,MarkdownRenderer,Notice:class{constructor(message){notices.push(message);}},editorInfoField:'info',editorLivePreviewField:'live'}:require(name)};
  vm.runInNewContext(compiled.outputFiles[0].text,globals);
  const notes={...sources,...extraSources};
  const files=Object.keys(notes).map(p=>({path:p,basename:path.posix.basename(p,'.md')}));
  const metadata=new Map(Object.entries(notes).map(([p,source])=>[p,{...parseNote(source).metadata,pageTargetDate:'1720-01-01'}]));
  const cacheEvents=events(),vaultEvents=events();
  const app={metadataCache:{...cacheEvents,on:cacheEvents.on,getFileCache:file=>({frontmatter:metadata.get(file?.path)}),
    getFirstLinkpathDest:target=>files.find(file=>file.path===target || file.path===target+'.md' || file.basename===target)},
    vault:{...vaultEvents,on:vaultEvents.on,configDir:'.obsidian',getRoot:()=>({path:''}),getMarkdownFiles:()=>files,getAbstractFileByPath:p=>files.find(file=>file.path===p),
      cachedRead:async file=>notes[file.path],
      adapter:{read:async p=>JSON.stringify(p.endsWith('metadata.json')?coreMeta:registry)}}};
  const processors=new Map(),postprocessors=[],extensions=[];
  const commands=[];
  const plugin={app,addCommand:command=>commands.push(command),registerMarkdownCodeBlockProcessor:(type,processor)=>processors.set(type,processor),
    registerMarkdownPostProcessor:processor=>postprocessors.push(processor),registerEditorExtension:extension=>extensions.push(extension)};
  const feature=new module.exports.HeadersFeature(plugin);feature.load();
  const {document}=imageDOM();
  const element=document.createElement('div');document.body.append(element);
  return {...module.exports,plugin,feature,app,globals,metadata,calls,notices,commands,intervals,element,cacheEvents,vaultEvents,processors,postprocessors,extensions,document,
    defer(){deferred=new Promise(resolve=>{this.release=()=>{deferred=null;resolve();};});},
    notes,
    child(source='',sourcePath='Bio Person.md') {
      let child;
      element.innerHTML='<div class="callout" data-callout="taelgar-header"><div class="callout-content"></div></div>';
      element.querySelector('.callout-content').textContent=source;
      for(const process of postprocessors)process(element,{sourcePath,addChild(value){child=value;}});
      const container=element.firstElementChild;
      container.replaceChildren=output=>{element.output=output;};
      Object.defineProperty(element,'textContent',{get:()=>container.textContent,configurable:true});
      return child;
    }};
}

test('Obsidian registers a callout postprocessor without a competing Live Preview widget',()=>{
  const h=host();
  try {
    assert.deepEqual([...h.processors.keys()],['taelgar-index']);assert.equal(h.extensions.length,0);
    assert.equal(h.feature.bios.size,0);
  } finally {h.feature.unload();}
});

test('header commands are hotkey-ready, use unsaved editor metadata and apply one undoable range edit',async()=>{
  const h=host();
  let source='---\nname: Unsaved Name\ntags: [person]\nspecies: elf\npronunciation: UNSAVED\nka: 3\n---\n# Old\n> [!info]+ Bio\n> Old\n\nAuthored prose.\n';
  const original=source,edits=[];
  const offset=pos=>source.split('\n').slice(0,pos.line).reduce((sum,line)=>sum+line.length+1,0)+pos.ch;
  const editor={getValue:()=>source,offsetToPos:value=>{const lines=source.slice(0,value).split('\n');return {line:lines.length-1,ch:lines.at(-1).length};},
    replaceRange(text,from,to){edits.push({text,from,to});const a=offset(from),b=offset(to);source=source.slice(0,a)+text+source.slice(b);}};
  try {
    assert.deepEqual(h.commands.map(command=>command.id),['regenerate-page-header','add-page-header']);
    assert.ok(h.commands.every(command=>!command.hotkeys));
    const file={path:'Bio Person.md'};
    await h.commands[0].editorCallback(editor,{file});assert.equal(edits.length,1);
    assert.match(source,/# Unsaved Name\n\*\(UNSAVED\)\*\n> \[!taelgar-header\]\n> \(elf, ka 3\)/);
    assert.equal(source.slice(0,source.indexOf('# Unsaved')),original.slice(0,original.indexOf('# Old')));
    assert.ok(source.endsWith('\nAuthored prose.\n'));assert.equal(h.notes['Bio Person.md'],sources['Bio Person.md'],'editor commands never write through the Vault API');
    await h.commands[0].editorCallback(editor,{file});assert.equal(edits.length,1,'unchanged output needs no edit');
    source='---\ntags: [person]\n---\nOpening prose.';await h.commands[0].editorCallback(editor,{file});assert.equal(edits.length,1,'missing headers are not implicitly added');
    await h.commands[1].editorCallback(editor,{file});assert.equal(edits.length,2);assert.ok(source.endsWith('Opening prose.'));
    source='---\ninvalid: [\n---\n> [!taelgar-header]\n';await h.commands[1].editorCallback(editor,{file});assert.equal(edits.length,2);assert.match(h.notices.at(-1),/Header unavailable/);
  } finally {h.feature.unload();}
});

test('editor H1 regeneration uses vault and unsaved per-note naming defaults and never overwrites edits made during setup',async()=>{
  const h=host(),file={path:'Bio Person.md'},view={file};
  let source='---\ntags: [place]\nname: Green Sea\n---\n# Old\n> [!taelgar-header]\n',edits=0;
  const editor={getValue:()=>source,offsetToPos:offset=>offset,replaceRange(text,from,to){edits++;source=source.slice(0,from)+text+source.slice(to);}};
  try {
    h.app.vault.adapter.read=async()=>JSON.stringify({typeDisplayDefaults:{place:{defArt:'the'}}});
    await h.commands[0].editorCallback(editor,view);assert.match(source,/# The Green Sea\n/);
    source=source.replace('name: Green Sea','name: Green Sea\ndisplayDefaults: {defArt: ""}');
    await h.commands[0].editorCallback(editor,view);assert.match(source,/# Green Sea\n/);assert.doesNotMatch(source,/# The Green Sea/);
    const before=edits;
    h.app.vault.adapter.read=async()=>{source+='\nA concurrent edit.';return '{}';};
    const changed=await h.commands[0].editorCallback(editor,view);
    assert.equal(changed.status,'skipped');assert.equal(edits,before);assert.ok(source.endsWith('A concurrent edit.'));
    h.app.vault.adapter.read=async()=>{view.file={path:'Another.md'};return '{}';};
    const switched=await h.commands[0].editorCallback(editor,view);assert.equal(switched.status,'skipped');assert.equal(edits,before);
  } finally {h.feature.unload();}
});

test('editor commands skip untagged/excluded metadata while an explicit callout still renders',async()=>{
  const h=host();
  try {
    for(const tags of [null,[],...['session-note','meta','background','source','story'].map(tag=>['person',tag])]) {
      const source='---\n'+(tags===null?'':'tags: '+JSON.stringify(tags)+'\n')+'---\n# Old\n> [!taelgar-header]\n> Saved.\n';
      const editor={getValue:()=>source,replaceRange(){assert.fail('ineligible notes must receive no edit');}};
      for(const command of h.commands) {
        const result=await command.editorCallback(editor,{file:{path:'Bio Person.md'}});
        assert.equal(result.status,'skipped');assert.match(result.reason,/Header ineligible/);
      }
      const snapshot=await h.obsidianHeaders(h.app);
      const markdown=h.obsidianBio(snapshot,{basename:'Explicit'},{...(tags===null?{}:{tags}),displayDefaults:{boxInfo:'Explicit information'}},{});
      assert.match(markdown,/Explicit information/,'rendering has no source-writing eligibility restrictions');
    }
  } finally {h.feature.unload();}
});

test('Obsidian bios match the existing static header generator for people, places and dated events without Dataview or CustomJS',async()=>{
  const h=host();
  try{
    const snapshot=await h.obsidianHeaders(h.app);
    const reference=initializeHeaders({runtimeDir:settings.vault_dir,coreMeta,registry,pages:h.app.vault.getMarkdownFiles().map(file=>({path:file.path,metadata:h.metadata.get(file.path)}))});
    for(const file of h.app.vault.getMarkdownFiles())for(const date of ['1720-01-01','1730-01-01']){
      const metadata={...h.metadata.get(file.path),pageTargetDate:date};
      const actual=h.obsidianBio(snapshot,file,metadata,{});
      const header=parseNote(renderHeader(reference,{source:'---\n---\n',name:file.basename,metadata,date,headerType:'static'})).body;
      const expected=header.replace(/^# [^\n]*\n/,'').replace(/^\*\([^\n]*\)\*\n/,'').trimEnd()+'\n';
      assert.equal(actual.trimEnd(),expected.trimEnd(),file.path+' at '+date);
      assert.match(actual,/>\[!info\]/);assert.doesNotMatch(actual,/\$=|dataview|^---/m);
      assert.equal((actual.match(/^# /gm)||[]).length,0);
      assert.doesNotMatch(actual,/BY-oh/);
    }
  }finally{h.feature.unload();}
});

test('Obsidian location chains follow its link resolver when a homepage has the same basename',async()=>{
  const h=host({
    'People/Alain.md':'---\ntags: [person]\nspecies: human\nborn: 1659\nwhereabouts: Cleenseau\n---\n',
    '_website/cleenseau.md':'---\ncampaign: clee\n---\nCampaign homepage.',
    'Gazetteer/Cleenseau.md':'---\ntags: [place]\ntypeOf: settlement\nwhereabouts: Manor of Cleenseau\n---\n',
    'Gazetteer/Manor of Cleenseau.md':'---\ntags: [place]\ntypeOf: realm\nwhereabouts: Barony of Aveil\n---\n',
    'Gazetteer/Barony of Aveil.md':'---\ntags: [place]\ntypeOf: realm\n---\n',
  });
  try{
    const file=h.app.vault.getAbstractFileByPath('People/Alain.md');
    const snapshot=await h.obsidianHeaders(h.app);
    const markdown=h.obsidianBio(snapshot,file,h.metadata.get(file.path),{});
    assert.match(markdown,/Based in \[\[Cleenseau\]\], the \[\[Manor of Cleenseau\]\], the \[\[Barony of Aveil\]\]/);
    assert.equal(snapshot.runtime.resolve('cleenseau').path,'_website/cleenseau.md');
    assert.equal(snapshot.runtime.resolve('Cleenseau').path,'Gazetteer/Cleenseau.md');
  }finally{h.feature.unload();}
});

test('bio dates honor the existing override, note date, calendars and fallback order',()=>{
  const h=host(),calendar={year:1749,month:6,day:1};
  try{
    assert.equal(h.bioDate({pageTargetDate:'1720-01-01'},{customJS:{state:{overrideDate:'1730-01-01'}}},'1750-01-01'),'1730-01-01');
    assert.equal(h.bioDate({pageTargetDate:'1720-01-01'},{},'1750-01-01'),'1720-01-01');
    const campaign={getCurrentDate:()=>'1748-07-23'};
    assert.equal(h.bioDate({},{TaelgarverseCalendar:campaign,FantasyCalendarAPI:{getCalendars:()=>[{current:calendar}]}},'1750-01-01'),'1748-07-23');
    assert.equal(h.bioDate({pageTargetDate:'1720-01-01'},{TaelgarverseCalendar:campaign},'1750-01-01'),'1720-01-01');
    assert.equal(h.bioDate({},{FantasyCalendarAPI:{getCalendars:()=>[{current:calendar}]}},'1750-01-01'),calendar);
    assert.equal(h.bioDate({},{Calendarium:{getAPI:()=>({getCurrentDate:()=>calendar})}},'1750-01-01'),calendar);
    assert.equal(h.bioDate({},{Calendarium:{getAPI:()=>{throw Error('No calendar');}}},'1750-01-01'),'1750-01-01');
  }finally{h.feature.unload();}
});

test('Obsidian displays the requested header error for circular relationship metadata',async()=>{
  const h=host({
    'Loop Person.md':'---\ntags: [person]\nwhereabouts: Loop A\n---\n',
    'Loop A.md':'---\ntags: [object]\nwhereabouts: Loop B\n---\n',
    'Loop B.md':'---\ntags: [object]\nwhereabouts: Loop A\n---\n',
  });
  try{
    const child=h.child('','Loop Person.md');await child.onload();
    assert.match(h.element.textContent,/Bio unavailable: Circular location chain:/);
    assert.doesNotMatch(h.element.textContent,/Maximum call stack/);
    assert.equal(h.calls.length,0,'invalid metadata does not mount a partially rendered bio');
  }finally{h.feature.unload();}
});

test('Obsidian renders native callout Markdown, refreshes metadata and dates, and releases handlers and timers',async()=>{
  const h=host(),child=h.child();
  try{
    await child.onload();assert.equal(h.processors.has('taelgar-header'),false);
    assert.match(h.element.output.markdown,/Biographical Info/);assert.equal(h.calls[0].sourcePath,'Bio Person.md');
    const before=h.element.output.markdown;
    h.metadata.get('Bio Person.md').pageTargetDate='1730-01-01';h.cacheEvents.trigger('changed');
    await pause(180);assert.notEqual(h.element.output.markdown,before);
    const calls=h.calls.length;h.globals.customJS={state:{overrideDate:'1740-01-01'}};
    for(const tick of h.intervals.values())tick();await pause(20);assert.ok(h.calls.length>calls);
    assert.equal(child.children.size,1,'only the current Markdown render remains mounted');
    assert.equal(h.metadata.get('Bio Person.md').pageTargetDate,'1730-01-01');
  }finally{h.feature.unload();}
  assert.equal(h.intervals.size,0);assert.equal(h.cacheEvents.count,0);assert.equal(h.vaultEvents.count,0);
});

test('closed notes cannot mount a stale header and arbitrary fallback text is ignored',async()=>{
  const h=host(),child=h.child();
  try{
    h.defer();const pending=child.onload();await pause(20);child.unload();h.release();await pending;
    assert.equal(h.element.output,undefined);assert.equal(h.intervals.size,0);
    const fallback=h.child('Saved fallback including dv.current()');await fallback.onload();assert.match(h.element.output.markdown,/Biographical Info/);assert.doesNotMatch(h.element.output.markdown,/Saved fallback|dv.current/);fallback.unload();
  }finally{h.feature.unload();}
});

test('native Live Preview callout processing renders one header across repeat processing, metadata refresh and remounts',async()=>{
  const h=host(),children=[];
  const mount=async()=>{
    const widget=h.document.createElement('div');widget.className='cm-embed-block cm-callout';
    widget.innerHTML='<div class="markdown-rendered"><div class="callout" data-callout="taelgar-header"><div class="callout-content">Saved fallback</div></div></div>';
    h.document.body.append(widget);
    const rendered=widget.firstElementChild;
    const context={sourcePath:'Bio Person.md',getSectionInfo:()=>null,displayMode:false,addChild(child){children.push(child);child.load();}};
    for(const process of h.postprocessors)process(rendered,context);
    await pause(30);
    // Native callout processing can be followed by another section processor pass.
    for(const process of h.postprocessors)process(widget,context);
    assert.equal(widget.querySelectorAll('.taelgar-generated-bio').length,1);
    assert.equal(widget.querySelectorAll('[data-callout="taelgar-header"]').length,0);
    assert.equal(h.extensions.length,0,'only the native widget owns source replacement');
    return widget;
  };
  try {
    const first=await mount();assert.equal(children.length,1);assert.equal(h.feature.bios.size,1);
    const before=first.querySelector('.taelgar-generated-bio').markdown;
    h.metadata.get('Bio Person.md').pageTargetDate='1730-01-01';h.cacheEvents.trigger('changed');await pause(180);
    assert.equal(first.querySelectorAll('.taelgar-generated-bio').length,1);
    assert.notEqual(first.querySelector('.taelgar-generated-bio').markdown,before);
    // Obsidian tears down the native widget to expose source while editing.
    children[0].unload();first.remove();assert.equal(h.feature.bios.size,0);
    const second=await mount();assert.equal(h.feature.bios.size,1);assert.equal(h.intervals.size,1);
    children[1].unload();second.remove();assert.equal(h.feature.bios.size,0);assert.equal(h.intervals.size,0);
  } finally {for(const child of children)child.unload();h.feature.unload();}
});
