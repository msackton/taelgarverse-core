import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {load} from 'cheerio';
import sharp from 'sharp';
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
  Object.assign(notes,JSON.parse(fs.readFileSync(new URL('./fixtures/maps.json',import.meta.url),'utf8')));
  Object.assign(notes,JSON.parse(fs.readFileSync(new URL('./fixtures/backlinks.json',import.meta.url),'utf8')));
  Object.assign(notes,JSON.parse(fs.readFileSync(new URL('./fixtures/embeds.json',import.meta.url),'utf8')));
  Object.assign(notes,JSON.parse(fs.readFileSync(new URL('./fixtures/article-options.json',import.meta.url),'utf8')));
  for (const [relative,source] of Object.entries(notes)) {
    const filename = path.join(directory,relative);
    fs.mkdirSync(path.dirname(filename),{recursive:true});
    fs.writeFileSync(filename,source);
  }
  fs.writeFileSync(path.join(directory,'tiny.png'),'fixture asset');
  fs.writeFileSync(path.join(directory,'Tiled Map.md'),'```leaflet\nimage: [[world.png]]\nbounds: [[0,0],[64,4100]]\n```');
  await sharp({create:{width:4100,height:64,channels:3,background:'red'}}).png().toFile(path.join(directory,'world.png'));
  for (const relative of ['assets/audio/song.mp3','assets/session-audio/session/clip.m4a','assets/excalidraw/drawing.png']) {
    const filename = path.join(directory,relative);
    fs.mkdirSync(path.dirname(filename),{recursive:true});
    fs.writeFileSync(filename,'media fixture: ' + relative);
  }
  fs.writeFileSync(path.join(directory,'Dynamic.md'),'---\ntags: [person]\nspecies: human\nname: Dynamic Person\nborn: 1700-01-01\n---\n<!-- taelgar:header -->\n\n# Body heading\n\nPrepared biography.\n\n```html\n<!-- taelgar:header -->\n```\n');
  fs.writeFileSync(path.join(directory,'Session.md'),'---\ntags: [session-note]\ncampaign: Dunmar Frontier\nsessionNumber: 1\nDR: 1720-01-01\nDR_end: 1720-01-02\n---\n# Session\n');
  fs.writeFileSync(path.join(directory,'AdderSession.md'),'---\ntags: [session-note]\ncampaign: Addermarch\nsessionNumber: 1\nDR: 1720-01-01\nDR_end: 1720-01-02\n---\n# Session\n');
  fs.appendFileSync(path.join(directory,'People/Example.md'),'\n%%^Campaign:adma%%\nAddermarch-only text\n%%^End%%\n');
  fs.writeFileSync(path.join(directory,'ignore.txt'),'Ignored/\n');
  fs.mkdirSync(path.join(directory,'_website'));
  const navSource = path.join(directory,'_website','navigation.md'), homeSource = path.join(directory,'_website','home.md');
  fs.copyFileSync(new URL('./fixtures/home.md',import.meta.url),homeSource);
  fs.writeFileSync(navSource,'- [Home](index.md)\n- People\n    - {glob: people/}\n- Places\n    - {glob: places/}\n- [Future](future.md)\n');
  engine = new Engine({...loadSettings(),source_dir:directory,ignore_file:path.join(directory,'ignore.txt'),nav_source:navSource,home_source:homeSource,campaigns:['dufr','adma']});
  server = createServer(engine);
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (directory && isInside(path.join(ROOT,'.cache'),directory)) fs.rmSync(directory,{recursive:true});
});
test('Node renders maps in context and repeated note embeds, loads local map assets only when needed',async()=>{
  for (const [context,dm,count] of [['modern','0',1],['dunmar-frontier','0',2],['modern','1',2]]) {
    const $ = load(await (await fetch(base+'/page/maps?context='+context+'&dm='+dm)).text());
    assert.equal($('.leaflet-map').length,count);
    assert.equal($('script[src="/theme/maps.js"]').length,1);
    assert.equal($('link[href="/theme/leaflet.css"]').length,1);
  }
  const embedded = load(await (await fetch(base+'/page/embedded-maps?context=modern')).text());
  assert.equal(embedded('.leaflet-map').length,2);
  const tiled = await (await fetch(base+'/api/page?page=Tiled%20Map')).json();
  const config = JSON.parse(load(tiled.html)('.leaflet-map').attr('data-map'));
  assert.ok(config.tile);
  const tile = await fetch(base+config.tile.baseUrl+'/0/8/0.webp');
  assert.equal(tile.status,200);assert.match(tile.headers.get('content-type'),/image\/webp/);
  assert.equal((await sharp(Buffer.from(await tile.arrayBuffer())).metadata()).width,512);
  for (const [url,mime] of [['maps.js','javascript'],['leaflet.css','css'],['maps.css','css']]) {
    const response = await fetch(base+'/theme/'+url);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),new RegExp(mime));
  }
  assert.equal(load(await (await fetch(base+'/page/places/first-town')).text())('script[src="/theme/maps.js"]').length,0);
});

test('hide: toc omits the article TOC in the API and shell while retaining headings, backlinks and site navigation',async()=>{
  for (const [page,hidden] of [['Hidden TOC',true],['Scalar TOC',true],['Visible TOC',false]]) {
    const result = await (await fetch(base+'/api/page?page='+encodeURIComponent(page))).json();
    assert.equal(result.toc === '',hidden,page);
    assert.equal(load(result.html)('h2#details').length,1);
    const $ = load(await (await fetch(base+'/page/'+page.toLowerCase().replaceAll(' ','-'))).text());
    assert.equal($('nav[aria-label="On this page"]').length,hidden ? 0 : 1,page);
    assert.equal($('.page-backlinks').length,page === 'Hidden TOC' ? 1 : 0);
    assert.equal($('.site-sidebar').length,page === 'Scalar TOC' ? 1 : 0);
    if (page === 'Hidden TOC') assert.equal($('.page-backlinks a').text(),'Visible TOC');
  }
});

test('diagram links resolve aliases, relative notes and anchors with context and reject hidden or unsafe destinations',async()=>{
  const query = new URLSearchParams({source:'People/Example.md',context:'custom',date:'1730-01-01',campaigns:'all',dm:'1'});
  const targets = ['First Town','../Places/First Town.md#History','/page/places/first-town?date=1800-01-01#History',
    'Hidden','Future','Same','Unknown','javascript:alert(1)','data:text/html,bad','//evil.test','https://example.test/guide','Backlink Alias'];
  targets.forEach(target=>query.append('target',target));
  const response = await fetch(base+'/api/diagram-links?'+query);
  assert.equal(response.status,200);
  const {links} = await response.json();
  for (const link of links.slice(0,3)) {
    assert.equal(link.page,'places/first-town');
    assert.match(link.href,/\?date=1730-01-01&campaigns=all&dm=1/);
  }
  assert.match(links[1].href,/#history$/);
  assert.deepEqual(links.slice(3,10),Array(7).fill(null));
  assert.deepEqual(links[10],{href:'https://example.test/guide'});
  assert.equal(links[11].page,'backlink-target');
  assert.equal((await fetch(base+'/api/diagram-links?source=Hidden&target=Example')).status,404);
  assert.equal((await fetch(base+'/api/diagram-links?source=Example')).status,400);
  assert.equal((await fetch(base+'/api/diagram-links?source=Example&'+Array(101).fill('target=Example').join('&'))).status,400);
});
test('Node HTML and API include context-filtered note embeds without adding child headings to the TOC',async()=>{
  const query='context=custom&date=1730-01-01&campaigns=all&dm=1';
  const api=await fetch(base+'/api/page?page=Embed%20Host&'+query);
  assert.equal(api.status,200);
  const result=await api.json(), $=load(result.html,{},false);
  assert.equal($('.note-embed').length,5);
  for (const expected of ['Shared voyage','Frontier voyage','Later voyage','Voyage popup','Nested voyage','Campaign embed']) assert.ok($.text().includes(expected),expected);
  assert.doesNotMatch(result.html,/Stale embedded header|Outside requested section/);
  assert.doesNotMatch(result.toc,/Travels/);
  const html=await (await fetch(base+'/page/embed-host?'+query)).text();
  assert.match(html,/class="note-embed"/);
  const ids=load(html)('[id]').map((_,el)=>el.attribs.id).get();
  assert.equal(new Set(ids).size,ids.length);
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
for (const page of ['Hidden','Secret','Hidden World','Hidden Nested','../README','A/../../Hidden','C:\\secret']) {
  test('unavailable page: ' + page,() => assert.throws(() => render(page),{status:404}));
}

test('publication retains exclusions, formerly ignored paths, excluded tags and underscore-prefixed files',() => {
  assert.equal(engine.store.resolve('Hidden').note.metadata.excludePublish,'all');
  for (const page of ['CampaignHidden','Invisible','Drawing','_Loose']) assert.ok(render(page).html,page);
  assert.throws(()=>engine.render('CampaignHidden',undefined,'dunmar-frontier'),{status:404});
  assert.ok(engine.render('CampaignHidden',undefined,'addermarch').html);
});

test('website and API apply exclusions and birth/creation dates consistently, including Behind the Curtain',async()=>{
  for (const dm of ['0','1']) {
    for (const [page,query,status] of [
      ['Hidden','context=modern',404], ['Hidden','date=1800-01-01',404],
      ['CampaignHidden','context=dunmar-frontier',404], ['CampaignHidden','context=addermarch',200],
      ['CampaignHidden','context=modern',200], ['CampaignHidden','date=1730-01-01',200],
      ['Unborn','date=1730-04-01',404], ['Unborn','date=1730-04-02',200],
      ['Unbuilt','date=1730-04-01',404], ['Unbuilt','date=1730-04-02',200],
    ]) {
      for (const route of ['/api/page?page='+page+'&','/page/'+page+'?']) {
        const response=await fetch(base+route+query+'&dm='+dm);
        assert.equal(response.status,status,route+query);
        if (status===404) assert.doesNotMatch(await response.text(),/Private page\.|Unborn biography\.|Unbuilt history\./);
      }
      const $=load(await (await fetch(base+'/?q='+page+'&'+query+'&dm='+dm)).text(),{},false);
      assert.equal($('main li a[href*="/page/'+page.toLowerCase()+'?"]').length,status===200 ? 1 : 0,page+' in finder: '+query);
      if (status===404) assert.equal($('.site-sidebar a[href*="/page/'+page.toLowerCase()+'?"]').length,0);
    }
  }
});
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

test('audio players and exported drawings resolve to published assets with seekable media',async()=>{
  const result = engine.render('Media','1720-01-01'), $ = load(result.html,{},false);
  assert.deepEqual(result.warnings,[]);
  assert.equal($('audio[controls][preload="metadata"]').length,2);
  assert.equal($('img').first().attr('width'),'400');
  assert.equal($('img').first().attr('src'),'/assets/assets/excalidraw/drawing.png');
  assert.equal($('a:has(img)').attr('href'),'https://example.test/drawing');
  assert.equal($('a').filter((_,el)=>$(el).text()==='Download song').attr('href'),'/assets/assets/audio/song.mp3');
  assert.equal(load(engine.render('Media',undefined,'dunmar-frontier').html)('audio').length,3);
  for (const [index,mime] of [[0,'audio/mpeg'],[1,'audio/mp4']]) {
    const url = base + $('audio').eq(index).attr('src');
    const full = await fetch(url), bytes = await full.text();
    assert.equal(full.status,200);
    assert.equal(full.headers.get('content-type'),mime);
    assert.equal(full.headers.get('accept-ranges'),'bytes');
    const partial = await fetch(url,{headers:{Range:'bytes=6-12'}});
    assert.equal(partial.status,206);
    assert.equal(partial.headers.get('content-range'),'bytes 6-12/' + bytes.length);
    assert.equal(await partial.text(),bytes.slice(6,13));
    const head = await fetch(url,{method:'HEAD'});
    assert.equal(head.headers.get('content-length'),String(bytes.length));
    assert.equal(await head.text(),'');
  }
  assert.equal((await fetch(base + $('img').first().attr('src'))).headers.get('content-type'),'image/png');
  const article = load(await (await fetch(base + '/page/media')).text());
  assert.equal(article('script[src="/theme/image-viewer.js"][defer]').length,1);
  const script = await fetch(base + '/theme/image-viewer.js');
  assert.equal(script.status,200);
  assert.match(script.headers.get('content-type'),/^text\/javascript/);
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
    runtimeDir:engine.settings.vault_dir,
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

test('homepage renders authored Markdown with context links and keeps search separate',async()=>{
  const response = await fetch(base + '/?context=addermarch');
  assert.equal(response.status,200);
  const $ = load(await response.text());
  assert.equal($('main h1').text(),'Welcome to the fixture site');
  assert.equal($('.home-hero h1').text(),'Welcome to the fixture site');
  assert.equal($('.home-entry').length,3);
  assert.equal($('.layout--home').length,1);
  assert.match($('main').text(),/Website introduction|Addermarch homepage content/);
  assert.doesNotMatch($('main').text(),/Private homepage note|Up to 100 matching pages/);
  assert.equal($('main a[href="/page/people/example?context=addermarch"]').length,1);
  assert.equal($('main form[role="search"]').length,0);
  assert.equal($('#header-search input[name="context"]').val(),'addermarch');
  assert.equal(engine.store.entries.some(entry=>entry.id.startsWith('_website/')),false);
  const finder = load(await (await fetch(base + '/?q=&context=addermarch')).text());
  assert.equal(finder('main h1').text(),'Browse pages');
  assert.equal(finder('main .search-results').length,1);
  assert.doesNotMatch(finder('main').text(),/Website introduction/);
  assert.equal(finder('.context-form input[name="q"]').val(),'');
  assert.equal(finder('.home-hero').length,0);
  for (const [file,type] of [['homepage.css','text/css'],['home-map.webp','image/webp'],['site-logo.webp','image/webp'],['search-overlay.js','text/javascript']]) {
    const asset = await fetch(base+'/theme/'+file);
    assert.equal(asset.status,200); assert.ok(asset.headers.get('content-type').startsWith(type));
  }
});

test('page finder and navigation use the same date availability as articles',async()=>{
  for (const [date,count] of [['1730-01-01',0],['1750-01-01',1]]) {
    const $ = load(await (await fetch(base + '/?q=Future&date=' + date)).text(),{},false);
    assert.equal($('main li a[href^="/page/future?"]').length,count);
    assert.equal($('.site-sidebar a[href*="/page/future?"]').length,count);
  }
  const $ = load(await (await fetch(base + '/page/future?date=1730-01-01')).text(),{},false);
  assert.equal($('.site-sidebar').length,1);
  assert.equal($('.site-sidebar a[href*="/page/future?"]').length,0);
});

test('unlisted articles stay accessible and searchable without a catch-all navigation branch',async()=>{
  const article = await fetch(base + '/page/media?context=modern');
  assert.equal(article.status,200);
  const $ = load(await article.text());
  assert.equal($('.breadcrumbs').length,0);
  assert.doesNotMatch($('.site-sidebar').text(),/More pages/);
  assert.equal($('.site-sidebar a[href*="/page/media?"]').length,0);
  const finder = load(await (await fetch(base + '/?q=Media&context=modern')).text());
  assert.equal(finder('main a[href="/page/media?context=modern"]').length,1);
});

test('Mermaid pages load the local browser bundle only when visible diagrams exist',async()=>{
  const article = load(await (await fetch(base + '/page/diagrams?context=modern')).text());
  assert.equal(article('.mermaid-diagram').length,1);
  assert.equal(article('script[type="module"][src="/theme/diagrams.js"]').length,1);
  assert.equal(article('.mermaid-source[open]').length,1);
  assert.equal(article('.page-toc a[href="#family"]').length,1);
  const campaign = await (await fetch(base + '/api/page?page=Diagrams&context=dunmar-frontier')).json();
  assert.equal(load(campaign.html)('.mermaid-diagram').length,2);
  const ordinary = load(await (await fetch(base + '/page/media')).text());
  assert.equal(ordinary('script[src="/theme/diagrams.js"]').length,0);
  const bundle = await fetch(base + '/theme/diagrams.js');
  assert.equal(bundle.status,200);
  assert.match(bundle.headers.get('content-type'),/^text\/javascript/);
  assert.ok((await bundle.text()).length > 1000);
});

test('Node API and right page navigation expose the same filtered backlinks, including empty articles',async()=>{
  for (const query of ['date=1729-12-31','date=1730-01-01&dm=1','context=dunmar-frontier','context=addermarch&dm=1',
    'context=custom&date=1730-01-01&campaigns=all&dm=1','date=1730-01-01&campaigns=adma,dufr','date=1730-01-01&campaigns=adma']) {
    const response=await fetch(base+'/api/page?page=Backlink%20Target&'+query);
    assert.equal(response.status,200);
    const result=await response.json();
    for (const [campaign,pages] of [
      ['addermarch',['addermarch-backlink-session','campaigns/addermarch-campaign/handouts/backlink-letter']],
      ['dunmar-frontier',['dunmar-backlink-session','campaigns/dunmari-frontier-campaign/letters/backlink-letter']],
    ]) for (const page of pages) assert.equal(result.backlinks.some(link=>link.page===page),result.campaigns.includes(campaign==='addermarch' ? 'adma' : 'dufr'),page+' in '+query);
    const $=load(await(await fetch(base+'/page/backlink-target?'+query)).text());
    assert.deepEqual($('.page-backlinks a').map((_,el)=>$(el).attr('href')).get(),result.backlinks.map(link=>link.url));
    assert.equal($('.page-toc > details').length,1);
    assert.equal($('.article-main .page-backlinks').length,0);
    for (const link of result.backlinks) assert.equal((await fetch(base+link.url)).status,200);
  }
  const $=load(await(await fetch(base+'/page/backlink-empty')).text());
  assert.equal($('.page-backlinks').length,0);
  assert.equal($('.page-toc').length,0);
  assert.equal((await fetch(base+'/page/addermarch-backlink-session?context=modern')).status,200);
});

test('Custom campaigns filter article blocks and persist through article, search, navigation, DM and unavailable-page links',async()=>{
  for (const [selection,adma,dufr,itc] of [['all',true,true,true],['adma,dufr',true,true,false],['adma',true,false,false],['',false,false,false]]) {
    const query=new URLSearchParams({context:'custom',date:'1720-01-02',campaigns:selection,dm:'1'});
    const response=await fetch(base+'/api/page?page=Example&'+query);
    assert.equal(response.status,200);
    const result=await response.json(), $=load(result.html,{},false);
    assert.equal($.text().includes('Addermarch-only text'),adma);
    assert.equal($.text().includes('selected campaign text'),dufr);
    assert.equal($.text().includes('other campaign text'),itc);
    const expected=selection || null;
    for (const link of $('a[href^="/page/"]').toArray()) assert.equal(new URL($(link).attr('href'),'https://example.test').searchParams.get('campaigns'),expected);
    const article=load(await(await fetch(base+'/page/people/example?'+query)).text());
    for (const link of article('.site-sidebar a[href],.breadcrumbs a[href],.site-brand,.page-backlinks a').toArray()) {
      assert.equal(new URL(article(link).attr('href'),'https://example.test').searchParams.get('campaigns'),expected);
    }
    const lazy=article('details[data-nav-url]').first().attr('data-nav-url');
    const branch=await(await fetch(base+lazy)).json();
    const children=load(branch.html,{},false);
    for (const link of children('a[href]').toArray()) assert.equal(new URL(children(link).attr('href'),'https://example.test').searchParams.get('campaigns'),expected);
    const finder=load(await(await fetch(base+'/?q=Example&'+query)).text());
    assert.equal(finder('main form input[name=campaigns]').val(),selection || undefined);
    const unavailable=load(await(await fetch(base+'/page/future?'+query)).text());
    assert.equal(unavailable('header select option[selected]').val(),'custom');
    assert.equal(new URL(unavailable('.site-brand').attr('href'),'https://example.test').searchParams.get('campaigns'),expected);
  }
  for (const query of ['context=modern&campaigns=all','context=custom&campaigns=unknown','context=dunmar-frontier&campaigns=adma']) {
    assert.equal((await fetch(base+'/api/page?page=Example&'+query)).status,400);
  }
  assert.equal((await fetch(base+'/api/page?page=CampaignHidden&date=1720-01-02&campaigns=all')).status,404);
  const links=await(await fetch(base+'/api/page?page=Backlink%20Source&date=1720-01-02&campaigns=all')).json();
  const $=load(links.html,{},false);
  for (const link of $('a[href^="/page/"]').toArray()) assert.equal(new URL($(link).attr('href'),'https://example.test').searchParams.get('campaigns'),'all');
});
