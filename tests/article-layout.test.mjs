import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from 'cheerio';
import {articleLayout} from '../src/article-layout.mjs';
import {document} from '../src/render-engine.mjs';
import {imageDisplayBounds,responsiveImages} from '../src/images.mjs';
import {usedImageWidths} from '../scripts/build-images.mjs';

const fragment = html=>load(articleLayout(html),{},false);
test('semantic media breaks out between continuous prose groups, retaining IDs and floats',()=>{
  const $ = fragment('<h1 id="title">Title</h1><div class="admonition image inline end taelgar-image--aside"><p><img src="portrait.png"></p></div><p id="bio">Biography</p><ul><li>Fact</li></ul><figure class="leaflet-map"><div class="map-canvas"></div></figure><h2 id="history">History</h2><p>More prose</p>');
  assert.equal($('.article-prose').length,2);
  assert.equal($('.article-prose').first().children().length,4);
  assert.equal($('#bio').parent()[0],$('.taelgar-image--aside').parent()[0]);
  assert.ok($.root().children().toArray().includes($('.leaflet-map')[0]));
  assert.equal($('.leaflet-map.article-breakout').length,1);
  assert.equal($('#history').parent()[0],$('.article-prose').last()[0]);
});

test('hero links, large figures, both gallery forms and diagrams expand; ordinary figures and prose do not',()=>{
  const $ = fragment('<p><a href="full.png"><img class="taelgar-image--hero" src="hero.png"></a></p><div class="taelgar-image--figure taelgar-image--size-large">Large figure</div><div class="taelgar-image-gallery">Gallery</div><div class="admonition gallery">Gallery callout</div><figure class="mermaid-diagram">Diagram</figure><div class="taelgar-image--figure">Figure</div><p>Text <img class="taelgar-image--hero" src="inline.png"> continues.</p><p>Image-heavy prose stays prose <img src="one.png"><img src="two.png"></p>');
  assert.equal($('.article-breakout').length,5);
  assert.equal($('.article-prose > .taelgar-image--figure').length,1);
  assert.equal($('.article-prose > p').length,2);
  assert.equal($('a[href="full.png"] img').length,1);
});

test('wide escape hatch promotes tables and standalone media but retains portrait and prose flow',()=>{
  const $=load(articleLayout('<p>Prose</p><table><tr><td>Wide data</td></tr></table><p><img src="drawing.png"></p><figure>Diagram</figure><p><img align="right" src="portrait.png"></p><p>Biography</p><div popover class="dm-note-popup">Popup</div>',{wide:true}),{},false);
  assert.equal($('.article-breakout').length,3);
  assert.equal($('.article-table > table:not([class])').length,1);
  assert.equal($('.article-prose').last().children('p').length,2);
  assert.ok($.root().children().toArray().includes($('.dm-note-popup')[0]));
  assert.equal(fragment('<p>Prose</p><table><tr><td>Data</td></tr></table>')('table.article-breakout').length,0);
});

test('embedded maps expand inside the intact note boundary, nested callout prose stays constrained',()=>{
  const $=fragment('<section class="note-embed"><div class="note-embed-title">Source</div><div class="note-embed-content"><p id="embedded-intro">Intro</p><figure class="leaflet-map"></figure><p>After</p></div></section><div class="admonition note"><p>Callout</p><figure class="leaflet-map"></figure></div>');
  assert.equal($('section.note-embed.article-breakout').length,1);
  assert.equal($('.note-embed-content > .article-prose').length,2);
  assert.equal($('.note-embed-content > .leaflet-map.article-breakout').length,1);
  assert.equal($('.article-prose > .admonition.note').length,1);
  assert.equal($('#embedded-intro').length,1);
});

test('shell applies the presentation to articles but preserves the bespoke homepage and API input',()=>{
  const html='<h1>Page</h1><p>Prose</p><figure class="leaflet-map"></figure>';
  const result={title:'Page',html,toc:'',context:{id:'modern',date:'1750-01-01',campaigns:[]}};
  const $=load(document(result,[]));
  assert.equal($('.article-main > .article-prose').length,1);
  assert.equal($('.article-main > .leaflet-map').length,1);
  assert.equal($('script[src="/theme/maps.js"]').length,1);
  assert.equal(result.html,html);
  assert.equal(load(document({...result,homepage:true},[]))('.article-prose').length,0);
});

test('hero/gallery image planning covers expanded width and never enlarges small sources',()=>{
  for (const markup of ['<img class="taelgar-image--hero">','<div class="taelgar-image-gallery"><img></div>','<div class="admonition gallery"><ul><li><img></li></ul></div>']) {
    const $=load(markup,{},false), bounds=imageDisplayBounds($('img'));
    assert.deepEqual(bounds,[{width:1936}]);
    assert.deepEqual(usedImageWidths(600,400,[bounds]),[{width:600,inline:true}]);
    const widths=usedImageWidths(4000,2000,[bounds]);
    assert.ok(widths.some(item=>item.inline && item.width===1936));
    assert.ok(widths.some(item=>item.inline && item.width===2560));
  }
  const store={assets:new Map([['hero.png',{target:'hero.png',image:{width:600,height:400,variants:[{width:600,height:400,url:'/assets/variant.webp',inline:true}]}}]])};
  const $=load(responsiveImages('<img class="taelgar-image--hero" src="/assets/hero.png">',store));
  assert.match($('img').attr('sizes'),/1936px/);
  assert.equal($('img').attr('srcset'),'/assets/variant.webp 600w');
});
