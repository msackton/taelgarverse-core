import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {setTimeout as pause} from 'node:timers/promises';
import {build} from 'esbuild';
import {load} from 'cheerio';
import {ROOT,loadSettings} from '../src/config.mjs';
import {parseNote} from '../src/content-store.mjs';
import {initializeHeaders,renderHeader} from '../src/headers.mjs';

const require=createRequire(import.meta.url),settings=loadSettings();
const compiled=await build({absWorkingDir:ROOT,entryPoints:['obsidian/taelgarverse/features/headers.mjs'],write:false,
  bundle:true,platform:'node',format:'cjs',external:['obsidian'],logLevel:'silent'});
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
  const calls=[],intervals=new Map();let next=0,deferred;
  const MarkdownRenderer={async render(app,markdown,element,sourcePath,child){calls.push({markdown,sourcePath,child});element.markdown=markdown;if(deferred)await deferred;}};
  const module={exports:{}},globals={module,exports:module.exports,structuredClone,console,TextEncoder,TextDecoder,
    setTimeout,clearTimeout,setInterval:callback=>{intervals.set(++next,callback);return next;},clearInterval:id=>intervals.delete(id),
    require:name=>name==='obsidian'?{Component,MarkdownRenderChild,MarkdownRenderer}:require(name)};
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
  const plugin={app,registerMarkdownCodeBlockProcessor(type,processor){
    // Obsidian interpolates the language into this unescaped CSS selector.
    const $=load('<pre><code class="language-'+type+'"></code></pre>');
    assert.equal($('code.language-'+type).length,1,'the language must work with Obsidian’s selector');
    this.type=type;this.processor=processor;
  }};
  const feature=new module.exports.HeadersFeature(plugin);feature.load();
  const doc={createElement:()=>({})},element={ownerDocument:doc,replaceChildren(output){this.output=output;}};
  return {...module.exports,plugin,feature,app,globals,metadata,calls,intervals,element,cacheEvents,vaultEvents,
    defer(){deferred=new Promise(resolve=>{this.release=()=>{deferred=null;resolve();};});},
    notes,
    child(source='',sourcePath='Bio Person.md',section){let child;plugin.processor(source,element,{sourcePath,getSectionInfo:()=>section,addChild(value){child=value;}});return child;}};
}

test('Obsidian uses an adjacent authored H1 in Reading View and Live Preview and refreshes after title edits',async()=>{
  const block='```taelgar-header\n```\n',base=sources['Bio Person.md'];
  for(const prefix of ['# Custom title\n\n','Custom title\n============\n\n','## Section\n\n','# Earlier title\n\nProse.\n\n']){
    for(const positioned of [true,false]){
      const note=base.replace(block,prefix+block),h=host({'Custom.md':note});
      const lineStart=note.slice(0,note.indexOf(block)).split('\n').length-1;
      const child=h.child('','Custom.md',positioned?{text:note,lineStart}:null);
      try{
        await child.onload();
        const hasTitle=prefix.startsWith('# Custom') || prefix.startsWith('Custom');
        assert.equal(/^# /m.test(h.element.output.markdown),!hasTitle,prefix);
        assert.match(h.element.output.markdown,/BY-oh|Biographical Info/);
        if(!positioned && hasTitle){
          h.notes['Custom.md']=base;
          h.cacheEvents.trigger('changed');await pause(180);
          assert.match(h.element.output.markdown,/^# /);
        }
      }finally{h.feature.unload();}
    }
  }
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
      const expected=header;
      assert.equal(actual,expected,file.path+' at '+date);
      assert.match(actual,/>\[!info\]/);assert.doesNotMatch(actual,/\$=|dataview|^---/m);
      assert.equal((actual.match(/^# /gm)||[]).length,1);
      if(file.basename==='Bio Person')assert.match(actual,/BY-oh/);
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
    await child.onload();assert.equal(h.plugin.type,'taelgar-header');
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

test('closed notes cannot mount a stale header and invalid block bodies show an explanation',async()=>{
  const h=host(),child=h.child();
  try{
    h.defer();const pending=child.onload();await pause(20);child.unload();h.release();await pending;
    assert.equal(h.element.output,undefined);assert.equal(h.intervals.size,0);
    const invalid=h.child('dv.current()');await invalid.onload();assert.match(h.element.textContent,/Leave.*empty/);invalid.unload();
  }finally{h.feature.unload();}
});
