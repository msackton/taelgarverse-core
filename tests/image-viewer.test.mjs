import test from 'node:test';
import assert from 'node:assert/strict';
import {createImageViewer,imageCaption} from '../src/browser/image-viewer.mjs';
import {mountImageControls} from '../src/browser/image-controls.mjs';
import {imageDOM} from './helpers/image-dom.mjs';

test('native Obsidian callouts, galleries and session figures supply per-image captions without changing alt text',()=>{
  const h=imageDOM('<main>'+[
    '<div data-callout="image"><div class="callout-title">Not a caption</div><div class="callout-content"><p><span class="image-embed"><img src="a.png" alt="Visual description"></span><br><em>Delwath in Karawa.</em></p></div></div>',
    '<div data-callout="gallery"><div class="callout-content"><ul><li><img src="a.png"><em>First view.</em></li><li><img src="a.png"><em>Second view.</em></li></ul></div></div>',
    '<figure><img src="b.png"><figcaption>Session caption.</figcaption></figure>',
    '<p><img src="c.png" alt="No caption"> Ordinary prose.</p>',
  ].join('')+'</main>');
  const images=[...h.document.querySelectorAll('img')];
  assert.deepEqual(images.map(imageCaption),['Delwath in Karawa.','First view.','Second view.','Session caption.','']);
  assert.equal(images[0].alt,'Visual description');
});

test('shared viewer fits, shows captions, zooms and pans, then restores focus and disposes observers',async()=>{
  const h=imageDOM('<main><figure><img src="a.png" alt="Visual description"><figcaption>Authored caption.</figcaption></figure></main>');
  const viewer=createImageViewer(h.document), root=h.document.querySelector('main'), controls=mountImageControls(root,viewer);
  await h.flush();const image=root.querySelector('img'), opener=root.querySelector('button');
  h.click(opener);const dialog=h.document.querySelector('dialog'), preview=dialog.querySelector('img');
  assert.equal(dialog.open,true);assert.equal(dialog.querySelector('.image-viewer-caption').textContent,'Authored caption.');
  assert.equal(preview.alt,'Visual description');assert.equal(preview.style.width,'800px');
  const buttons=[...dialog.querySelectorAll('button')], byText=label=>buttons.find(button=>button.textContent===label);
  h.click(byText('Pan / zoom'));await h.flush();
  assert.match(preview.style.transform,/scale\(2\)/);
  const stage=dialog.querySelector('.image-viewer-stage');h.event(stage,'keydown',{key:'ArrowRight'});
  assert.match(preview.style.transform,/translate\(-50px,0px\)/);
  h.event(stage,'wheel',{deltaY:-100,clientX:400,clientY:300});assert.doesNotMatch(preview.style.transform,/scale\(2\)$/);
  h.click(byText('Fit to screen'));await h.flush();assert.match(preview.style.transform,/scale\(1\)/);
  h.click(byText('Close'));assert.equal(dialog.open,false);assert.equal(h.document.activeElement,opener);
  controls.dispose();viewer.dispose();viewer.dispose();await h.flush();
  assert.equal(h.document.querySelectorAll('dialog,.image-zoom-control,.image-zoom-host').length,0);
  assert.equal(image.classList.contains('image-enlarge'),false);assert.equal(h.resize.size,0);assert.equal(h.mutations.size,0);
});

test('controls discover rerendered images, preserve linked and modified clicks, exclude maps, and release stale popups',async()=>{
  const h=imageDOM('<main><p><img src="a.png" alt="A"></p><a href="note"><img src="linked.png"></a><div class="leaflet-container"><img src="map.webp"></div></main>');
  const viewer=createImageViewer(h.document), root=h.document.querySelector('main'), controls=mountImageControls(root,viewer);
  await h.flush();assert.equal(root.querySelectorAll('.image-zoom-control').length,1);
  const first=root.querySelector('img');
  assert.equal(h.event(first,'click',{ctrlKey:true}).defaultPrevented,false);assert.equal(h.document.querySelector('dialog').open,undefined);
  assert.equal(h.click(first).defaultPrevented,true);assert.equal(h.document.querySelector('dialog').open,true);
  first.setAttribute('src','changed.png');await h.flush();assert.equal(h.document.querySelector('dialog').open,false);
  const paragraph=h.document.createElement('p');paragraph.innerHTML='<img src="second.png">';root.append(paragraph);await h.flush();
  assert.equal(root.querySelectorAll('.image-zoom-control').length,2);
  first.parentElement.remove();await h.flush();assert.equal(root.querySelectorAll('.image-zoom-control').length,1);
  controls.dispose();viewer.dispose();await h.flush();assert.equal(h.resize.size,0);assert.equal(h.mutations.size,0);
});

test('a late screen-image load cannot replace a newly opened image or revive a disposed viewer',async()=>{
  const h=imageDOM('<main><img src="first.png" data-image-variants=\'[{"url":"screen.png","width":1600}]\'><img src="second.png"></main>');
  h.deferLoads();const viewer=createImageViewer(h.document), [first,second]=h.document.querySelectorAll('main img');
  viewer.open(first,first);assert.equal(h.loads.length,1);
  viewer.closeFor(first);viewer.open(second,second);h.loads[0].resolve();await h.flush();
  assert.equal(h.document.querySelector('dialog img').getAttribute('src'),'second.png');
  viewer.dispose();assert.equal(h.document.querySelector('dialog'),null);assert.equal(h.resize.size,0);
});
