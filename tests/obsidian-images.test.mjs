import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import {ROOT} from '../src/config.mjs';
import {imageDOM} from './helpers/image-dom.mjs';

const compiled=await build({absWorkingDir:ROOT,entryPoints:['obsidian/taelgarverse/features/images.mjs'],write:false,bundle:true,
  platform:'node',format:'cjs',external:['obsidian','@codemirror/view'],logLevel:'silent'});

function featureHost({enabled=false,deferReady=false}={}) {
  const h=imageDOM('<div id="leaf"><div class="markdown-preview-view"><div data-callout="image"><div class="callout-content"><p><img src="app://local/portrait.png" alt="Portrait"><em>Local caption.</em></p></div></div><a href="note"><img src="linked.png"></a><div class="leaflet-container"><img src="tile.webp"></div></div><div class="markdown-source-view"><div id="editor"><p><img src="app://local/editor.png"></p></div></div></div>');
  const leaf={view:{containerEl:h.document.querySelector('#leaf'),getViewType:()=> 'markdown'}};
  const leaves=[leaf], events=new Set(), extensions=[];let ready;
  class Component {
    constructor(){this.cleanups=[];}
    registerEvent(ref){this.cleanups.push(()=>ref.off());}
    unload(){this.onunload?.();for(const cleanup of this.cleanups)cleanup();}
  }
  const liveField=Symbol('editorLivePreviewField'), module={exports:{}};
  vm.runInNewContext(compiled.outputFiles[0].text,{module,exports:module.exports,console,
    require:name=>name==='obsidian'?{Component,editorLivePreviewField:liveField}:{ViewPlugin:{fromClass:value=>value}}});
  const plugin={settings:{imageViewer:enabled},registerEditorExtension(extension){extensions.push(extension);},
    app:{workspace:{on(name,fn){assert.equal(name,'layout-change');events.add(fn);return {off:()=>events.delete(fn)};},
      onLayoutReady(fn){ready=fn;if(!deferReady)fn();},iterateAllLeaves(fn){leaves.forEach(fn);}}}};
  const feature=new module.exports.ImagesFeature(plugin);feature.onload();
  let live=true;
  const view={dom:h.document.querySelector('#editor'),state:{field(key){assert.equal(key,liveField);return live;}}};
  const editor=new extensions[0](view);
  return {...h,feature,plugin,editor,leaves,events,layout(){for(const fn of events)fn();},ready(){ready();},setLive(value){live=value;editor.update();}};
}

test('Images is off by default; its switch adds the shared viewer to Reading View and Live Preview immediately',async()=>{
  const h=featureHost();await h.flush();
  const originalEditor=h.document.querySelector('#editor').innerHTML;
  assert.equal(h.document.querySelectorAll('dialog,.image-zoom-control').length,0);
  assert.equal(h.document.querySelectorAll('.taelgar-images-enabled').length,0);
  h.feature.setEnabled(true);await h.flush();
  assert.equal(h.document.querySelector('#leaf').classList.contains('taelgar-images-enabled'),true);
  assert.equal(h.document.querySelectorAll('dialog').length,1,'one viewer serves both modes');
  assert.equal(h.document.querySelectorAll('.image-zoom-control').length,2,'linked images and map tiles are excluded');
  assert.equal(h.document.querySelector('#editor').innerHTML,originalEditor,'Live Preview controls do not alter editor-owned DOM');
  h.click(h.document.querySelector('.markdown-preview-view .image-zoom-control'));
  assert.equal(h.document.querySelector('.image-viewer-caption').textContent,'Local caption.');
  h.feature.setEnabled(false);await h.flush();
  assert.equal(h.document.querySelectorAll('dialog,.image-zoom-control,.image-zoom-host').length,0);
  assert.equal(h.document.querySelectorAll('.taelgar-images-enabled').length,0,'disabling restores native inline layout');
  assert.equal(h.resize.size,0);assert.equal(h.mutations.size,0);
  h.feature.setEnabled(true);h.layout();h.editor.update();await h.flush();
  assert.equal(h.document.querySelectorAll('.image-zoom-control').length,2,'reenabling does not duplicate controls');
  h.feature.unload();h.editor.destroy();assert.equal(h.events.size,0);assert.equal(h.resize.size,0);assert.equal(h.mutations.size,0);
});

test('source mode, editor rerenders and closed pop-out leaves remove controls and their document viewers',async()=>{
  const h=featureHost({enabled:true});await h.flush();
  h.setLive(false);await h.flush();assert.equal(h.document.querySelectorAll('.image-zoom-control--portal').length,0);
  h.setLive(true);await h.flush();assert.equal(h.document.querySelectorAll('.image-zoom-control--portal').length,1);
  const old=h.document.querySelector('#editor p');
  old.innerHTML='<img src="app://local/replacement.png" alt="Replacement">';await h.flush();
  assert.equal(h.document.querySelectorAll('.image-zoom-control--portal').length,1);
  const popout=imageDOM('<div class="markdown-preview-view"><p><img src="app://local/popout.png"></p></div>');
  h.leaves.push({view:{containerEl:popout.document.body,getViewType:()=> 'markdown'}});h.layout();await popout.flush();
  assert.equal(popout.document.querySelectorAll('.image-zoom-control,dialog').length,2);
  assert.equal(popout.document.body.classList.contains('taelgar-images-enabled'),true);
  h.leaves.pop();h.layout();await popout.flush();assert.equal(popout.document.querySelectorAll('.image-zoom-control,dialog').length,0);
  assert.equal(popout.document.body.classList.contains('taelgar-images-enabled'),false);
  h.editor.destroy();h.leaves.length=0;h.layout();await h.flush();
  assert.equal(h.document.querySelectorAll('dialog,.image-zoom-control').length,0);
  assert.equal(h.resize.size,0);assert.equal(h.mutations.size,0);h.feature.unload();
});

test('a layout-ready callback cannot reactivate Images after the feature unloads',()=>{
  const h=featureHost({deferReady:true});h.feature.unload();h.ready();h.layout();h.editor.destroy();
  assert.equal(h.document.querySelectorAll('dialog,.image-zoom-control').length,0);
  assert.equal(h.events.size,0);
});
