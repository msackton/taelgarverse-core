import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {load} from 'cheerio';
import {Engine} from '../src/engine.mjs';
import {initializeHeaders, renderHeader} from '../src/headers.mjs';
import {createServer} from '../src/server.mjs';
import {ROOT, loadSettings, isInside, validateDate} from '../src/config.mjs';

let engine, server, base, directory;
const text = result => load(result.html,{},false).text().replace(/\s+/g,' ').trim();
const render = (page = 'Example',date = '1720-01-01') => engine.render(page,date);
before(async () => {
  fs.mkdirSync(path.join(ROOT,'.cache'),{recursive:true});
  directory = fs.mkdtempSync(path.join(ROOT,'.cache','node-test-'));
  const notes = JSON.parse(fs.readFileSync(new URL('./fixtures/notes.json',import.meta.url),'utf8'));
  for (const [relative,source] of Object.entries(notes)) {
    const filename = path.join(directory,relative);
    fs.mkdirSync(path.dirname(filename),{recursive:true});
    fs.writeFileSync(filename,source);
  }
  fs.writeFileSync(path.join(directory,'tiny.png'),'fixture asset');
  fs.writeFileSync(path.join(directory,'Dynamic.md'),'---\ntags: [person]\nspecies: human\nname: Dynamic Person\nborn: 1700-01-01\n---\n<!-- taelgar:header -->\n\n# Body heading\n\nPrepared biography.\n\n```html\n<!-- taelgar:header -->\n```\n');
  fs.writeFileSync(path.join(directory,'Session.md'),'---\ntags: [session-note]\ncampaign: Dunmar Frontier\nsessionNumber: 1\nDR: 1720-01-01\nDR_end: 1720-01-02\n---\n# Session\n');
  fs.writeFileSync(path.join(directory,'AdderSession.md'),'---\ntags: [session-note]\ncampaign: Addermarch\nsessionNumber: 1\nDR: 1720-01-01\nDR_end: 1720-01-02\n---\n# Session\n');
  fs.appendFileSync(path.join(directory,'People/Example.md'),'\n%%^Campaign:adma%%\nAddermarch-only text\n%%^End%%\n');
  fs.writeFileSync(path.join(directory,'ignore.txt'),'Ignored/\n');
  const navSource = path.join(directory,'_navigation.md');
  fs.writeFileSync(navSource,'- [Home](index.md)\n- People\n    - {glob: people/}\n- Places\n    - {glob: places/}\n- [Future](future.md)\n');
  engine = new Engine({...loadSettings(),source_dir:directory,ignore_file:path.join(directory,'ignore.txt'),nav_source:navSource});
  server = createServer(engine);
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (directory && isInside(path.join(ROOT,'.cache'),directory)) fs.rmSync(directory,{recursive:true});
});
test('headers recalculate ages, locations, lifecycle and preserve body',() => {
  const early = text(render()), later = text(render('Example','1730-01-01')), dead = text(render('Example','1750-01-01'));
  assert.match(early,/20 years old/); assert.match(early,/First Town/);
  assert.match(later,/30 years old/); assert.match(later,/Second Town/);
  assert.match(dead,/died at age 40 years/);
  assert.doesNotMatch(early,/Stale header/); assert.match(early,/Fixture biography/);
});

test('prepared header markers insert a date-aware header and preserve following headings and literal examples',() => {
  for (const [date,age] of [['1720-01-01',20],['1730-01-01',30]]) {
    const result = render('Dynamic',date), $ = load(result.html,{},false);
    assert.equal($('h1#dynamic-person').length,1);
    assert.equal($('h1#body-heading').length,1);
    assert.match($.text(),new RegExp(age + ' years old'));
    assert.match($.text(),/Prepared biography/);
    assert.equal($('pre code').text().trim(),'<!-- taelgar:header -->');
    assert.equal((result.html.match(/<!-- taelgar:header -->/g) || []).length,0);
    assert.equal(result.warnings.length,0);
  }
});
test('private comments, campaigns and temporal blocks',() => {
  const early = text(render()), later = text(render('Example','1730-01-01'));
  for (const body of [early,later]) assert.doesNotMatch(body,/private ordinary|secret body|other campaign text/);
  assert.doesNotMatch(early,/selected campaign text|Addermarch-only text/);
  assert.doesNotMatch(early,/later body/); assert.match(later,/later body/);
});
test('links, callouts, tables, headings, HTML cards and footnotes',() => {
  const result = render(), $ = load(result.html,{},false);
  assert.match(result.html,/\/page\/places\/first-town\?date=1720-01-01/);
  assert.equal($('.admonition.note').length,1); assert.equal($('table').length,1);
  assert.equal($('.grid.cards .bio').length,1); assert.equal($('h2#details').length,1);
  assert.doesNotMatch(result.html,/\[\[|markdown>|:octicons-info-24:/);
});
for (const page of ['Hidden','CampaignHidden','Invisible','Secret','../README','A/../../Hidden','C:\\secret']) {
  test('unavailable page: ' + page,() => assert.throws(() => render(page),{status:404}));
}
test('future pages, ambiguous names and full paths',() => {
  assert.throws(() => render('Future','1730-01-01'),{status:404});
  assert.equal(render('Future','1741-01-01').page,'future');
  assert.throws(() => render('Same'),{status:409});
  assert.equal(render('A/Same.md').page,'a/same');
  assert.throws(() => render('Missing'),{status:404});
});
test('malformed comments fail closed without affecting other pages',() => {
  assert.throws(() => render('Broken'),error => error.status === 422 && !error.message.includes('secret'));
  assert.ok(render('First Town').html);
});
test('query code becomes a warning, never executes',() => {
  const result = render('Queries');
  assert.equal(result.warnings.length,2);
  assert.doesNotMatch(result.html,/never execute me/);
  assert.match(result.html,/Dynamic content unavailable/);
});
test('indexed assets and traversal restrictions',async () => {
  const $ = load(render('Image').html,{},false);
  assert.equal(await (await fetch(base + $('img').attr('src'))).text(),'fixture asset');
  const range = await fetch(base + $('img').attr('src'),{headers:{Range:'bytes=0-6'}});
  assert.equal(range.status,206); assert.equal(await range.text(),'fixture');
  assert.equal((await fetch(base + $('img').attr('src'),{headers:{Range:'bytes=999-1000'}})).status,416);
  assert.equal((await fetch(base + '/assets/ignore.txt')).status,404);
  assert.equal((await fetch(base + '/assets/%2e%2e/README.md')).status,404);
});
for (const date of ['today','1750-02-29','1720-02-29','1750-13-01','0000-01-01','1750-04-31','']) {
  test('invalid date: ' + date,() => assert.throws(() => render('Example',date),{status:400}));
}
test('concurrent HTTP dates stay isolated',async () => {
  const dates = ['1720-01-01','1730-01-01','1720-01-01','1730-01-01'];
  const results = await Promise.all(dates.map(async date => {
    const response = await fetch(base + '/api/page?' + new URLSearchParams({page:'Example',date}));
    assert.equal(response.status,200); assert.equal(response.headers.get('cache-control'),'no-store');
    return text(await response.json());
  }));
  results.forEach((result,i) => assert.match(result,dates[i].startsWith('1720') ? /20 years old/ : /30 years old/));
});
test('indexed leadership equals full-scan reference across dates',() => {
  const input = {
    runtimeDir:engine.settings.runtime_dir,
    pages:engine.store.entries.filter(e => e.note).map(e => ({path:e.id,metadata:e.note.metadata})),
    coreMeta:engine.headers.coreMeta, registry:engine.headers.registry, indexAffiliations:false,
  };
  const reference = initializeHeaders(input), entry = engine.store.resolve('Example');
  for (const date of ['1720-01-01','1730-01-01','1750-01-01']) {
    const request = {source:entry.note.source,name:entry.name,metadata:entry.note.metadata,date};
    assert.equal(renderHeader(engine.headers,request),renderHeader(reference,request));
  }
  assert.match(text(render()),/Guardian/);
  assert.match(text(render('Example','1730-01-01')),/Protector/);
});
test('HTTP HTML, styles, docs, schema, errors and method handling',async () => {
  const response = await fetch(base + '/page/people/example?date=1720-01-01');
  assert.equal(response.status,200); assert.match(response.headers.get('content-type'),/text\/html/);
  assert.match(await response.text(),/20 years old/);
  for (const filename of ['material.css','taelgarverse.css','preview.css']) {
    assert.equal((await fetch(base + '/theme/' + filename)).status,200);
  }
  assert.equal((await fetch(base + '/docs')).status,200);
  assert.equal((await (await fetch(base + '/openapi.json')).json()).openapi,'3.1.0');
  assert.equal((await fetch(base + '/api/page')).status,400);
  assert.equal((await fetch(base + '/api/page?page=Missing')).status,404);
  assert.equal((await fetch(base + '/api/page?page=Same')).status,409);
  assert.equal((await fetch(base + '/api/page?page=Broken')).status,422);
  assert.equal((await fetch(base + '/health',{method:'POST'})).status,405);
  assert.equal((await fetch(base + '/health')).status,200);
});
test('calendar and aliases',() => {
  assert.equal(validateDate('1730-02-28'),'1730-02-28');
});
test('context API, campaign filtering and context links survive navigation',async () => {
  const response = await fetch(base + '/api/contexts');
  assert.equal(response.status,200);
  const catalogue = await response.json();
  assert.equal(catalogue.contexts.find(c=>c.id==='modern').date,'1720-01-02');
  const result = await (await fetch(base + '/api/page?page=Example&context=dunmar-frontier')).json();
  assert.deepEqual(result.campaigns,['dufr']);
  assert.equal(result.context.id,'dunmar-frontier');
  assert.match(result.html,/selected campaign text/);
  assert.match(result.html,/\/page\/places\/first-town\?context=dunmar-frontier/);
  const html = await (await fetch(base + '/page/people/example?context=dunmar-frontier')).text();
  const $ = load(html,{},false);
  assert.equal($('header select option[selected]').val(),'dunmar-frontier');
  assert.equal($('main form').length,0);
  assert.equal($('[data-custom-date]').is('[hidden]'),true);
  const home = load(await (await fetch(base + '/?context=dunmar-frontier&q=Example')).text(),{},false);
  assert.match(home('main li a').first().attr('href'),/context=dunmar-frontier/);
  assert.equal(home('main form input[name=context]').val(),'dunmar-frontier');
  assert.match((await fetch(base + '/theme/context.js')).headers.get('content-type'),/javascript/);
});
test('unavailable-in-date page retains the header for switching context',async () => {
  const response = await fetch(base + '/page/future?context=modern');
  assert.equal(response.status,404);
  assert.match(response.headers.get('content-type'),/html/);
  const $ = load(await response.text(),{},false);
  assert.equal($('header select').length,1);
  assert.match($('main').text(),/Page unavailable/);
});
test('campaign blocks appear only for the selected campaign, never Modern or Custom',async () => {
  for (const [context,date] of [['dunmar-frontier',undefined],['addermarch',undefined],['modern',undefined],['custom','1720-01-02']]) {
    const params = new URLSearchParams({page:'Example',context});
    if (date) params.set('date',date);
    const response = await fetch(base + '/api/page?' + params);
    assert.equal(response.status,200);
    const result = await response.json(), content = text(result);
    assert.equal(content.includes('selected campaign text'),context === 'dunmar-frontier');
    assert.equal(content.includes('Addermarch-only text'),context === 'addermarch');
    assert.doesNotMatch(content,/secret body|other campaign text/);
    assert.match(content,/Fixture biography/);
    assert.deepEqual(result.campaigns,context === 'dunmar-frontier' ? ['dufr'] : context === 'addermarch' ? ['adma'] : []);
  }
});

test('See Behind the Curtain is explicit, survives navigation, and leaves the default response unchanged',async () => {
  const params = new URLSearchParams({page:'Example',context:'dunmar-frontier',dm:'1'});
  const response = await fetch(base + '/api/page?' + params);
  assert.equal(response.status,200);
  const result = await response.json(), $ = load(result.html,{},false);
  assert.equal(result.dm,true);
  assert.equal(result.context.dm,true);
  assert.equal($('.dm-note-popup').length,1);
  assert.match($('.dm-note-popup').text(),/private ordinary comment/);
  assert.match($('.dm-only-block').text(),/Behind the Curtain.*secret body/s);
  assert.match(result.html,/selected campaign text/);
  assert.doesNotMatch(result.html,/other campaign text|Addermarch-only text|later body/);
  assert.match($('a[href^="/page/"]').first().attr('href'),/context=dunmar-frontier&dm=1/);
  const article = load(await (await fetch(base + '/page/people/example?context=dunmar-frontier&dm=1')).text(),{},false);
  assert.equal(article('header input[name=dm]').is(':checked'),true);
  assert.match(article('.site-brand').attr('href'),/dm=1/);
  const home = load(await (await fetch(base + '/?context=dunmar-frontier&dm=1&q=Example')).text(),{},false);
  assert.equal(home('main form input[name=dm]').val(),'1');
  assert.match(home('main li a').first().attr('href'),/dm=1/);
  const unavailable = load(await (await fetch(base + '/page/future?context=modern&dm=1')).text(),{},false);
  assert.equal(unavailable('header input[name=dm]').is(':checked'),true);
  for (const value of ['', '&dm=0', '&dm=false']) {
    const player = await (await fetch(base + '/api/page?page=Example&context=dunmar-frontier' + value)).json();
    assert.equal(player.dm,false);
    assert.doesNotMatch(player.html,/private ordinary comment|secret body|dm-note-popup|dm-only-block/);
  }
  assert.equal((await fetch(base + '/api/page?' + params.toString().replace('dm=1','dm=maybe'))).status,400);
});

test('site navigation, breadcrumbs, page TOC and lazy branch links retain context',async()=>{
  const response = await fetch(base + '/page/people/example?context=dunmar-frontier&dm=1');
  const $ = load(await response.text(),{},false);
  assert.equal($('.site-sidebar nav[aria-label="Site navigation"]').length,1);
  assert.equal($('.site-sidebar a[aria-current="page"]').text(),'Example');
  assert.deepEqual($('.breadcrumbs li').map((_,el)=>$(el).text()).get(),['Home','People','Example']);
  assert.equal($('.page-toc a[href="#details"]').text(),'Details');
  assert.equal($('.page-toc a[href="#example"]').length,0);
  assert.equal($('.site-sidebar a[href*="future"]').length,0);
  const places = $('.site-sidebar details[data-nav-url]').filter((_,el)=>$(el).children('summary').text()==='Places');
  assert.equal(places.is('[open]'),false);
  const branchUrl = places.attr('data-nav-url');
  const branchResponse = await fetch(base + branchUrl);
  assert.equal(branchResponse.status,200);
  const branch = await branchResponse.json();
  const children = load(branch.html,{},false);
  assert.equal(branch.title,'Places');
  assert.equal(children('a').length,2);
  children('a').each((_,el)=>assert.match(children(el).attr('href'),/context=dunmar-frontier&dm=1/));
  const section = await fetch(base + places.find('.nav-placeholder a').attr('href'));
  assert.equal(section.status,200);
  const folder = load(await section.text(),{},false);
  assert.equal(folder('main h1').text(),'Places');
  assert.equal(folder('main .section-pages a').length,2);
  assert.equal((await fetch(base + '/api/navigation')).status,400);
  assert.equal((await fetch(base + '/api/navigation?branch=missing')).status,404);
  assert.equal((await fetch(base + '/browse/missing')).status,404);
  assert.equal((await fetch(base + '/theme/navigation.js')).status,200);
});

test('page finder and navigation use the same date availability as articles',async()=>{
  for (const [date,count] of [['1730-01-01',0],['1750-01-01',1]]) {
    const $ = load(await (await fetch(base + '/?q=Future&date=' + date)).text(),{},false);
    assert.equal($('main li a').length,count);
    assert.equal($('.site-sidebar a[href*="/page/future?"]').length,count);
  }
  const $ = load(await (await fetch(base + '/page/future?date=1730-01-01')).text(),{},false);
  assert.equal($('.site-sidebar').length,1);
  assert.equal($('.site-sidebar a[href*="/page/future?"]').length,0);
});
