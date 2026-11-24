import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {parseHTML} from 'linkedom';
import {ROOT} from '../src/config.mjs';
import {headerFixture} from './helpers/header-fixture.mjs';

const require=createRequire(import.meta.url);
const compiled=await build({absWorkingDir:ROOT,stdin:{contents:"export * from './obsidian/taelgarverse/services/events.mjs'; export * from './obsidian/taelgarverse/features/events.mjs';",resolveDir:ROOT},
  write:false,bundle:true,platform:'node',format:'cjs',external:['obsidian'],logLevel:'silent'});

function host() {
  const {document}=parseHTML('<div></div>');
  const files=new Map([['History/A.md','- (DR:: 1740): First record.'],['History/B.md','- (DR:: 1740): Second record.'],
    ['History/_generated/Draft.md','- (DR:: 1740): Draft record.']]);
  const counts=new Map(),handlers=new Map(),reloads=[];
  class Component {
    constructor(){this.children=[];this.cleanup=[];}
    addChild(child){this.children.push(child);child.ready=child.onload?.();return child;}
    removeChild(child){this.children=this.children.filter(item=>item!==child);child.unload();}
    register(cleanup){this.cleanup.push(cleanup);}
    registerEvent(cleanup){this.register(cleanup);}
    unload(){this.onunload?.();this.children.forEach(child=>child.unload());this.cleanup.forEach(fn=>fn());}
  }
  class MarkdownRenderChild extends Component {constructor(el){super();this.containerEl=el;}}
  const MarkdownRenderer={async render(app,text,cell,path){cell.textContent=text;cell.dataset.source=path;}};
  const module={exports:{}};
  vm.runInNewContext(compiled.outputFiles[0].text,{module,exports:module.exports,structuredClone,setTimeout,clearTimeout,
    require:name=>name==='obsidian'?{Component,MarkdownRenderChild,MarkdownRenderer}:require(name)});
  const app={vault:{
    on(name,callback){handlers.set(name,callback);return ()=>handlers.delete(name);},
    getMarkdownFiles:()=>[...files.keys()].map(path=>({path})),
    cachedRead:async({path})=>{counts.set(path,(counts.get(path) || 0)+1);return files.get(path);}
  },metadataCache:{getFirstLinkpathDest:target=>files.has(target)?{path:target}:null},workspace:{openLinkText(){}}};
  const events=new module.exports.ObsidianEventService(app);
  events.onload();
  const snapshot={runtime:headerFixture({baseNotes:Object.fromEntries([...files.keys()].map(path=>[path,{}]))}).runtime,fallback:'1740-12-31'};
  let processor;
  const feature=new module.exports.EventsFeature({app,events,snapshots:{getSnapshot:async()=>snapshot,subscribe:()=>()=>{}},
    registerMarkdownCodeBlockProcessor:(language,callback)=>{assert.equal(language,'taelgar-events');processor=callback;}});
  feature.onload();
  return {files,counts,events,handlers,reloads,render(source='yearStart: 1740') {
    const el=document.createElement('div'),parent=new Component();
    const child=processor(source,el,{sourcePath:'Timeline.md',addChild:child=>parent.addChild(child)});
    const render=child.render.bind(child);
    child.render=()=>{const pending=render();reloads.push(pending);return pending;};
    return {el,child,parent};
  }};
}

test('two native Obsidian timelines share the first scan and reread only the edited file',async t=>{
  const h=host();
  t.after(()=>h.events.unload());
  const first=h.render(),second=h.render();
  t.after(()=>{first.parent.unload();second.parent.unload();});
  await Promise.all([first.child.ready,second.child.ready]);
  assert.deepEqual([...h.counts],[['History/A.md',1],['History/B.md',1]]);
  assert.match(first.el.textContent,/First record.*Second record/);
  assert.equal(second.el.querySelector('[data-source]').dataset.source,'History/A.md');
  h.files.set('History/A.md','- (DR:: 1740): Edited record.');
  h.handlers.get('modify')({path:'History/A.md'});
  await new Promise(resolve=>setTimeout(resolve,110));
  await Promise.all(h.reloads);
  assert.deepEqual([...h.counts],[['History/A.md',2],['History/B.md',1]]);
  assert.match(first.el.textContent,/Edited record/);
  assert.match(second.el.textContent,/Edited record/);
});
