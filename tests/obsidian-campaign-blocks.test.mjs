import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {imageDOM} from './helpers/image-dom.mjs';
import {ROOT} from '../src/config.mjs';

const bundle=await build({
  absWorkingDir:ROOT,entryPoints:['obsidian/taelgarverse/features/campaign-blocks.mjs'],bundle:true,
  write:false,platform:'node',format:'cjs',external:['obsidian'],logLevel:'silent',
});
const require=createRequire(import.meta.url);
const indexPath='Campaigns/_Index/Example Index.md',secondary='Example Campaign.md';
const registry={campaigns:{example:{code:'example',name:'Example',campaignRoot:'Campaigns/Example',partyPage:'People/PCs/Example Party'}}};

function host() {
  const {document}=imageDOM('');
  class Component {
    constructor(){this.cleanups=[];}
    register(cleanup){this.cleanups.push(cleanup);}
    registerEvent(cleanup){this.register(cleanup);}
    unload(){this.onunload?.();this.cleanups.forEach(cleanup=>cleanup());}
  }
  class MarkdownRenderChild extends Component {
    constructor(containerEl){super();this.containerEl=containerEl;}
  }
  let timer,changed,modified;
  const module={exports:{}};
  vm.runInNewContext(bundle.outputFiles[0].text,{
    module,exports:module.exports,TextEncoder,TextDecoder,
    setTimeout:callback=>{timer=callback;},clearTimeout:()=>{timer=null;},
    require:name=>name==='obsidian' ? {Component,MarkdownRenderChild} : require(name),
  });
  const files=[
    {path:indexPath,basename:'Example Index'},
    {path:'People/PCs/Example Party.md',basename:'Example Party',metadata:{typeOf:'adventuring party'}},
    {path:'People/PCs/Ilex.md',basename:'Ilex',metadata:{tags:['person'],player:'Pat',affiliations:['Example Party']}},
    {path:'Campaigns/Example/Session 1.md',basename:'Session 1',metadata:{tags:['session-note'],campaign:'example',sessionNumber:1,descTitle:'Beyond the Vale',players:['Ilex'],realWorldDate:'2025-01-01'}},
  ];
  let index='~~~taelgar-roster\n~~~\n\n~~~taelgar-session\n~~~';
  const processors=new Map(),reads=[],opened=[];
  const snapshots={subscribe(fn){changed=fn;return ()=>{changed=null;};},
    getSnapshot:async()=>snapshot};
  let snapshot={campaignIndex:{example:indexPath},campaignRegistry:registry};
  const app={
    vault:{adapter:{},getMarkdownFiles:()=>files,getAbstractFileByPath:path=>files.find(file=>file.path===path),
      cachedRead:async file=>{reads.push(file.path);return index;},on(event,listener){assert.equal(event,'modify');modified=listener;return ()=>{modified=null;};}},
    metadataCache:{getFileCache:file=>({frontmatter:file.metadata})},
    workspace:{openLinkText:(...args)=>opened.push(args)},
  };
  const feature=new module.exports.CampaignBlocksFeature({app,snapshots,registerMarkdownCodeBlockProcessor:(name,fn)=>processors.set(name,fn)});
  feature.onload();
  return {
    feature,processors,files,reads,opened,
    block(language,source,path) {
      const element=document.createElement('div');
      let child;
      processors.get(language)(source,element,{sourcePath:path,addChild(value){child=value;child.ready=child.onload();}});
      return {element,child};
    },
    updateIndex(source){index=source;modified({path:indexPath});},
    updatePC(player){files[2].metadata.player=player;snapshot={...snapshot};changed();},
    async flush() {
      const renderTasks=[];
      for(const child of feature.childrenRendered) {
        const render=child.render.bind(child);
        child.render=()=>{const task=render();renderTasks.push(task);return task;};
      }
      timer?.();
      await Promise.all(renderTasks);
    },
  };
}

test('registered and secondary fences share one model and refresh after source edits',async()=>{
  const h=host();
  try {
    assert.deepEqual([...h.processors.keys()],['taelgar-roster','taelgar-session']);
    const roster=h.block('taelgar-roster','',indexPath);
    const history=h.block('taelgar-session','campaign: example\ncolumns: [session, played, participants, account]',secondary);
    await Promise.all([roster.child.ready,history.child.ready]);
    assert.match(roster.element.textContent,/Pat/);
    assert.match(history.element.textContent,/Jan 1, 2025/);
    assert.match(history.element.textContent,/Pat/);
    assert.deepEqual(h.reads,[indexPath]);
    assert.equal(history.element.querySelector('[data-href="Campaigns/Example/Session 1.md"]').textContent,'Beyond the Vale');

    h.updatePC('Sam');
    await h.flush();
    assert.match(roster.element.textContent,/Sam/);
    assert.match(history.element.textContent,/Sam/);
    h.updateIndex('~~~taelgar-roster\n~~~\n~~~taelgar-session\noverrides: [{number: 1, played: "2025-01-02"}]\n~~~');
    await h.flush();
    assert.match(history.element.textContent,/Jan 2, 2025/);

    const event=new history.element.ownerDocument.defaultView.Event('click',{bubbles:true});
    Object.defineProperties(event,{button:{value:0},metaKey:{value:true}});
    history.element.querySelector('[data-href="Campaigns/Example/Session 1.md"]').dispatchEvent(event);
    assert.deepEqual(h.opened,[['Campaigns/Example/Session 1.md',indexPath,true]]);
  } finally { h.feature.unload(); }
});

test('secondary overrides and duplicate registered fences give visible errors',async()=>{
  const h=host();
  try {
    const secondaryBlock=h.block('taelgar-session','campaign: example\noverrides: []',secondary);
    await secondaryBlock.child.ready;
    assert.match(secondaryBlock.element.textContent,/Put overrides/);
    h.updateIndex('~~~taelgar-roster\n~~~\n~~~taelgar-roster\n~~~');
    const registered=h.block('taelgar-roster','',indexPath);
    await registered.child.ready;
    assert.match(registered.element.textContent,/more than once/);
  } finally { h.feature.unload(); }
});
