import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from 'cheerio';
import {document} from '../src/render-engine.mjs';
import {Navigation} from '../src/navigation.mjs';
import {themeFiles} from '../src/http-assets.mjs';

const context = {id:'custom',kind:'custom',date:'1730-01-01',campaigns:['dufr'],dm:true};
const entry = {id:'Places/Town.md',target:'places/town.md',slug:'places/town',title:'Town',note:{metadata:{}}};
const nav = new Navigation({entries:[entry]},'- [Home](index.md)\n- Places\n    - [Town](places/town.md)');
const result = {title:'Town',page:'places/town',context,html:'<h1>Town</h1><h2 id="history">History</h2>',toc:'<a href="#history">History</a>',warnings:[]};
test('live Quiet Library shell includes accessible settings, context-preserving search and active sections',() => {
  const $ = load(document(result,[],nav));
  assert.equal($('html').attr('data-appearance'),'system');
  assert.equal($('head script[src="/theme/appearance.js"]:not([defer])').length,1);
  assert.equal($('link[href="/theme/quiet-library.css"]').length,1);
  assert.equal($('#settings-toggle').attr('aria-controls'),'settings-dialog');
  assert.deepEqual($('#site-appearance option').map((_,el)=>$(el).val()).get(),['system','light','dark']);
  assert.equal($('.section-navigation [aria-current="location"]').text(),'Places');
  assert.equal($('.nav-tree > .active-section > details > summary').text(),'Places');
  assert.equal($('.layout--no-navigation').length,0);
  assert.equal($('.page-nav-title').text(),'On this page');
  assert.equal($('.page-contents summary,details.page-contents').length,0);
  assert.equal($('#header-search input[name="date"]').val(),'1730-01-01');
  assert.equal($('#header-search input[name="campaigns"]').val(),'dufr');
  assert.equal($('#header-search input[name="dm"]').val(),'1');
  const ids = $('[id]').map((_,el)=>$(el).attr('id')).get();
  assert.equal(new Set(ids).size,ids.length);
  for (const file of ['appearance.js','site-ui.js','quiet-library.css']) assert.equal(themeFiles[file],file);
});
test('optional navigation omissions reclaim space while retaining search/settings and backlinks',() => {
  for (const hide of [['navigation'],['toc'],['navigation','toc']]) {
    const $ = load(document({...result,hide,backlinks:[{page:'source',title:'Source',url:'/page/source'}]},[],nav));
    assert.equal($('.section-navigation').length,hide.includes('navigation') ? 0 : 1);
    assert.equal($('.site-sidebar').length,hide.includes('navigation') ? 0 : 1);
    assert.equal($('#navigation-toggle').length,hide.includes('navigation') ? 0 : 1);
    assert.equal($('.page-contents').length,hide.includes('toc') ? 0 : 1);
    assert.equal($('.layout--no-toc').length,0); // Backlinks still use the right sidebar.
    assert.equal($('#header-search').length,1); assert.equal($('#settings-toggle').length,1);
    assert.equal($('.page-backlinks').length,1);
  }
  const $ = load(document({...result,page:undefined,toc:''},[],nav));
  assert.equal($('.layout--no-navigation.layout--no-toc').length,1);
  assert.equal($('.section-navigation a').length,2);
});
