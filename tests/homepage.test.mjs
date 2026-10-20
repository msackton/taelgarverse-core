import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from 'cheerio';
import {homepage} from '../src/homepage.mjs';
import {document} from '../src/render-engine.mjs';

const slugs = ['campaigns/current-games','gazetteer/geography-of-taelgar','gazetteer/world-of-taelgar'];
const store = {bySlug:new Map(slugs.map(slug=>[slug,{slug,note:{metadata:{}}}]))};
const context = {id:'custom',kind:'custom',date:'1730-01-01',campaigns:['adma'],dm:true};
const home = {html:'<h1 id="welcome">Welcome to Taelgar</h1><p>Authored introduction with <em>emphasis</em>.</p><p>More authored words with <a href="/page/story">a story</a>.</p>',toc:'',hide:[],warnings:[]};

test('homepage gives authored title and introduction a dedicated layout, with context-preserving entry points',() => {
  const rendered = homepage(home,context,store), $ = load(document({...rendered,title:'TaelgarVerse',context},[]));
  assert.equal($('.layout--home').length,1);
  assert.equal($('main h1').length,1); assert.equal($('.home-hero h1').text(),'Welcome to Taelgar');
  assert.equal($('.home-lead em').text(),'emphasis');
  assert.equal($('.home-prose a').text(),'a story');
  assert.equal($('.home-prose h1').length,0);
  assert.equal($('.page-toc').length,0);
  assert.deepEqual($('.home-destinations a').map((_,el)=>$(el).attr('aria-label')).get(),['Current Games','Gazetteer','World Map']);
  $('.home-destinations a').each((index,el)=>{
    const url = new URL($(el).attr('href'),'https://example.test');
    assert.equal(url.pathname,'/page/'+slugs[index]);
    assert.equal(url.searchParams.get('date'),'1730-01-01');
    assert.equal(url.searchParams.get('campaigns'),'adma'); assert.equal(url.searchParams.get('dm'),'1');
  });
  assert.equal($('.home-find, #home-search, main form[role="search"]').length,0);
  assert.equal($('form[role="search"]').length,1);
  assert.equal($('#header-search input[name="campaigns"]').val(),'adma');
  assert.equal($('link[href="/theme/homepage.css"]').length,1);
});

test('homepage buttons respect missing and context-excluded destinations',() => {
  const restricted = {bySlug:new Map(store.bySlug)};
  restricted.bySlug.delete(slugs[0]);
  restricted.bySlug.set(slugs[1],{slug:slugs[1],note:{metadata:{created:'1740-01-01'}}});
  restricted.bySlug.set(slugs[2],{slug:slugs[2],note:{metadata:{excludePublish:['adma']}}});
  const early = load(homepage(home,context,restricted).html);
  assert.equal(early('.home-destinations a').length,0);
  assert.equal(early('.home-entry-unavailable').length,3);
  const later = load(homepage(home,{...context,date:'1750-01-01',campaigns:[]},restricted).html);
  assert.equal(later('.home-destinations a').length,2);
});

test('old snapshots promote the three plain entry links without duplicating them or removing prose',() => {
  const row = '<p>'+slugs.map((slug,index)=>'<a href="/page/'+slug+'?context=modern">'+['Current Games','Gazetteer','World Map'][index]+'</a>').join(' · ')+'</p>';
  const $ = load(homepage({...home,html:'<h1>Home</h1>'+row+'<p>The introduction.</p><p>Visit '+row.slice(3,-4)+' for more.</p>'},context,store).html);
  assert.equal($('.home-lead').text(),'The introduction.');
  assert.match($('.home-prose').text(),/Visit Current Games · Gazetteer · World Map for more/);
  assert.equal($('.home-prose a').length,3);
});

test('empty and heading-free introductions render without fabricated prose or article-only assets',() => {
  const $ = load(homepage({...home,html:'<h2 id="stories">Stories</h2><p>An authored section.</p>'},context,store).html);
  assert.equal($('h1').text(),'TaelgarVerse');
  assert.equal($('.home-prose h2').text(),'Stories');
  assert.equal($('.home-lead').text(),'');
  const article = load(document({...home,title:'Article',context},[]));
  assert.equal(article('link[href="/theme/homepage.css"]').length,0);
});
