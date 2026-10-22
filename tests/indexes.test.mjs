import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from 'cheerio';
import {headerFixture} from './helpers/header-fixture.mjs';
import {headerFixture as legacyFixture} from './helpers/legacy-header-fixture.mjs';
import {indexNotes,indexSources} from './fixtures/indexes.mjs';
import {headerIndexes,parseIndex,queryIndex} from '../src/indexes.mjs';
import {indexGrid} from '../src/index-view.mjs';
import {ContentStore,parseNote} from '../src/content-store.mjs';
import {RenderEngine,document} from '../src/render-engine.mjs';
import {renderBio,renderHeader} from '../src/header-core/index.mjs';
import {targetPath} from '../src/common.mjs';
import {compileSearch} from '../scripts/compile-search.mjs';
import {searchText} from '../src/search-text.mjs';
import {collectImageUsages} from '../scripts/image-usage.mjs';
import {indexImageTarget,indexImageEntry} from '../src/index-images.mjs';

const campaignRegistry={campaigns:{frontier:{name:'Frontier',code:'dufr'}}};
const fixture=extraNotes=>headerFixture({baseNotes:indexNotes,extraNotes,campaignRegistry});
const visible=page=>!['People/Hidden.md','People/Campaign Secret.md','People/POV Secret.md'].includes(page.path);
const query=(type,target,options={},extraNotes={})=>queryIndex(fixture(extraNotes).runtime,{type,target,...options},
  {date:'1720-01-01',visible});
const paths=result=>result.items.map(item=>item.path);

test('index authoring validates arrays and YAML, supplies defaults, and deduplicates buttons',()=>{
  assert.deepEqual(headerIndexes(['members','members']),['members']);
  assert.deepEqual(headerIndexes(undefined),[]);assert.deepEqual(headerIndexes([]),[]);
  for(const invalid of [{members:true},'members',['unknown'],['constructor'],[null]])assert.throws(()=>headerIndexes(invalid),/array/);
  assert.deepEqual(parseIndex('type: residents'),{type:'residents',target:undefined,show:'both',recursive:true,mode:'grid'});
  assert.equal(parseIndex('type: members\nmode: table').mode,'table');
  assert.equal(parseIndex('type: members').recursive,false);
  for(const source of ['', '[]','type: unknown','type: constructor','type: residents\nshow: all','type: residents\nrecursive: yes','type: members\ntarget: []','type: members\ncolumns: 3','type: members\nmode: list'])assert.throws(()=>parseIndex(source));
});

test('residents follow dated homes, retaining traveling residents and excluding transients and future births',()=>{
  assert.deepEqual(paths(query('residents','Realm')),['People/Alice.md','People/Bob.md']);
  assert.deepEqual(paths(query('residents','Town',{recursive:false})),['People/Bob.md']);
  assert.deepEqual(paths(query('residents','Town',{recursive:true})),['People/Alice.md','People/Bob.md']);
  const {runtime}=fixture();
  const later=queryIndex(runtime,{type:'residents',target:'Realm'},{date:'1750-01-01',visible});
  assert.deepEqual(paths(later),[],'a town changing regions changes its residents’ containment');
  assert.deepEqual(paths(query('residents','Other Realm')),['People/Visitor.md']);
});

test('settlements use the canonical settlement type and dated hierarchy, include ruins, and honor direct scope',()=>{
  const result=query('settlements','Realm');
  assert.deepEqual(paths(result),['Places/Ruin.md','Places/Town.md']);assert.equal(result.items[1].description,'town');
  assert.equal(result.items[1].details,'Population 1,234');
  assert.deepEqual(paths(query('settlements','Realm',{recursive:false})),['Places/Ruin.md','Places/Town.md']);
  assert.deepEqual(paths(query('settlements','Town')),[],'the target cannot include itself');
  assert.deepEqual(paths(queryIndex(fixture().runtime,{type:'settlements',target:'Other Realm'},{date:'1750-01-01',visible})),['Places/Town.md']);
});

test('settlement location matching includes last-known and secondary paths without using future or stale ancestor locations',()=>{
  const extras={
    'Places/Last Known.md':{tags:['place'],typeOf:'settlement',whereabouts:[{type:'away',location:'Realm',start:1700,end:1710}]},
    'Places/Secondary.md':{tags:['place'],typeOf:'settlement',whereabouts:[{type:'home',location:'Other Realm'},{type:'secondary',location:'Realm'}]},
    'Places/Border.md':{tags:['place'],whereabouts:[{type:'home',location:'Other Realm'},{type:'secondary',location:'Realm'}]},
    'Places/Nested.md':{tags:['place'],typeOf:'settlement',whereabouts:'Border'},
    'Places/Moved.md':{tags:['place'],typeOf:'settlement',whereabouts:[{type:'home',location:'Realm',end:1710},{type:'home',location:'Other Realm',start:1711}]},
    'Places/Not Yet.md':{tags:['place'],typeOf:'settlement',created:1760,whereabouts:'Realm'},
    'Places/Lost Region.md':{tags:['place'],whereabouts:[{type:'away',location:'Realm',start:1700,end:1710}]},
    'Places/Lost Child.md':{tags:['place'],typeOf:'settlement',whereabouts:'Lost Region'},
  };
  const result=query('settlements','Realm',{},extras);
  for(const name of ['Last Known','Secondary','Nested'])assert.ok(paths(result).includes('Places/'+name+'.md'),name);
  for(const name of ['Moved','Not Yet','Lost Child'])assert.ok(!paths(result).includes('Places/'+name+'.md'),name);
  assert.equal(result.items.find(item=>item.path==='Places/Last Known.md').region,undefined,'the Region column still uses home, not last-known');
  const direct=paths(query('settlements','Realm',{recursive:false},extras));
  assert.ok(direct.includes('Places/Secondary.md'));assert.ok(!direct.includes('Places/Nested.md'));
  const aliases=query('settlements','Realm',{}, {
    'Places/Realm.md':{...indexNotes['Places/Realm.md'],aliases:['Kingdom']},
    'Places/Aliased.md':{tags:['place'],typeOf:'settlement',whereabouts:'Kingdom'},
  });
  assert.deepEqual(aliases.items.find(item=>item.path==='Places/Aliased.md').region,{path:'Places/Realm.md',name:'Kingdom'});
});

test('settlement containment explores alternate branches after cycles and warns only for omitted candidates',()=>{
  const extras={
    'Places/Loop A.md':{tags:['place'],whereabouts:'Loop B'},
    'Places/Loop B.md':{tags:['place'],whereabouts:[{type:'home',location:'Loop A'},{type:'secondary',location:'Realm'}]},
    'Places/Reachable.md':{tags:['place'],typeOf:'settlement',whereabouts:'Loop A'},
  };
  const result=query('settlements','Realm',{},extras);
  assert.ok(paths(result).includes('Places/Reachable.md'));assert.deepEqual(result.warnings,[]);
  const cycle=query('settlements','Realm',{}, {...extras,'Places/Loop B.md':{tags:['place'],whereabouts:'Loop A'}});
  assert.ok(!paths(cycle).includes('Places/Reachable.md'));assert.equal(cycle.warnings.length,1);
});

test('members use active affiliations and leadership, deduplicate people, and optionally follow chapters',()=>{
  assert.deepEqual(paths(query('members','Guild')),['People/Alice.md','People/Bob.md','People/Future.md']);
  assert.deepEqual(paths(query('members','Guild',{recursive:true})),['People/Alice.md','People/Bob.md','People/Chapter Member.md','People/Future.md']);
  assert.deepEqual(paths(queryIndex(fixture().runtime,{type:'members',target:'Guild'},{date:'1730-01-02',visible})),['People/Bob.md','People/Future.md']);
  const result=query('members','Groups/Guild.md',{}, {'People/Bob.md':{...indexNotes['People/Bob.md'],affiliations:['Groups/Guild.md','Guild']}});
  assert.equal(result.items.filter(item=>item.path==='People/Bob.md').length,1);
  assert.match(result.items[1].details,/Master/);
});

const unlinked=text=>text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,(_,target,alias)=>alias ?? target);
const partText=parts=>parts.map(part=>typeof part==='string' ? part : part.name).join('');

test('residents match homeLocation at the selected date, excluding current, last-known and secondary-only visitors',()=>{
  const extraNotes={
    'Places/Border.md':{tags:['place'],whereabouts:[{type:'home',location:'Other Realm'},{type:'secondary',location:'Realm'}]},
    'Places/Lost Region.md':{tags:['place'],whereabouts:[{type:'away',location:'Realm',start:1700,end:1710}]},
    'People/Last Seen.md':{tags:['person'],whereabouts:[{type:'away',location:'Realm',start:1700,end:1710}]},
    'People/Secondary.md':{tags:['person'],whereabouts:[{type:'home',location:'Other Realm'},{type:'secondary',location:'Realm'}]},
    'People/Nested.md':{tags:['person'],whereabouts:'Border'},
    'People/Stale.md':{tags:['person'],whereabouts:[{type:'home',location:'Other Realm'},{type:'away',location:'Realm',start:1700,end:1710}]},
    'People/Lost Child.md':{tags:['person'],whereabouts:'Lost Region'},
    'People/Away.md':{tags:['person'],whereabouts:[{type:'home',location:'Realm'},{type:'away',location:'Other Realm',start:1700,end:1760}]},
  };
  const legacy=legacyFixture({baseNotes:indexNotes,extraNotes,campaignRegistry});
  for(const date of ['1710-01-01','1720-01-01','1750-01-01']) {
    const expected=Object.entries({...indexNotes,...extraNotes}).filter(([path,metadata])=>metadata.tags.includes('person') && visible({path}) &&
      legacy.services.util.homeLocation('Realm',metadata,false,date)).map(([path])=>path).sort();
    const result=queryIndex(fixture(extraNotes).runtime,{type:'residents',target:'Realm'},{date,visible});
    assert.deepEqual(paths(result).sort(),expected,date);
  }
  const result=query('residents','Realm',{},extraNotes);
  for(const name of ['Nested','Away'])assert.ok(paths(result).includes('People/'+name+'.md'),name);
  for(const name of ['Last Seen','Secondary','Stale','Lost Child','Dead','Future','Visitor'])assert.ok(!paths(result).includes('People/'+name+'.md'),name);
  const direct=query('residents','Realm',{recursive:false},extraNotes);
  assert.ok(paths(direct).includes('People/Away.md'));assert.ok(!paths(direct).includes('People/Nested.md'));
});

test('people columns match the original templates, retaining regions and the last-known hierarchy and date',()=>{
  const extraNotes={
    'Places/Ship.md':{tags:['place'],typeOf:'ship',whereabouts:[{type:'home',location:'Town',end:1710},{type:'home',location:'Other Realm',start:1711}]},
    'People/Traveler.md':{tags:['person'],pronouns:'xe/xem',pronunciation:'TRA-vel-er',ancestry:'Townfolk',species:'human',
      whereabouts:[{type:'home',location:'Other Realm'},{type:'away',location:'Ship',start:1710}]},
  };
  const legacy=legacyFixture({baseNotes:indexNotes,extraNotes,campaignRegistry});
  for(const date of ['1720-01-01','1750-01-01']) {
    const result=queryIndex(fixture(extraNotes).runtime,{type:'residents',target:'Other Realm'},{date,visible});
    for(const item of result.items)for(const [field,format] of [
      ['person','<name> (<pronouns> <pronunciation>)'],['info','<ancestry> <maintype>'],
      ['lastKnown','<lastknown:2> (<lastknowndate>)'],['home','<home:1>'],
    ])assert.equal(partText(item[field]),unlinked(legacy.services.util.s(format,legacy.file(item.path),date)),item.path+' '+field+' '+date);
    const traveler=result.items.find(item=>item.path==='People/Traveler.md');
    assert.equal(partText(traveler.lastKnown),'Ship, Town (DR 1710)');assert.equal(partText(traveler.home),'the Other Realm');
  }
  const bob=query('residents','Realm').items.find(item=>item.path==='People/Bob.md');
  assert.equal(partText(bob.person),'Bob');assert.equal(partText(bob.lastKnown),'the Old Town, Realm (January 1st, 1720)');
  assert.equal(partText(bob.home),'the Old Town');
});

test('residents containment can reach the target through a secondary branch after a cycle',()=>{
  const extras={
    'Places/Loop A.md':{tags:['place'],whereabouts:'Loop B'},
    'Places/Loop B.md':{tags:['place'],whereabouts:[{type:'home',location:'Loop A'},{type:'secondary',location:'Realm'}]},
    'People/Reachable.md':{tags:['person'],whereabouts:'Loop A'},
  };
  const result=query('residents','Realm',{},extras);
  assert.ok(paths(result).includes('People/Reachable.md'));assert.deepEqual(result.warnings,[]);
});

test('members match legacy isAffiliated dates, including explicit overrides to the default death end date',()=>{
  const extraNotes={
    'People/Explicit End.md':{tags:['person'],died:1710,affiliations:[{org:'Guild',start:1700,end:1730}]},
    'People/Former.md':{tags:['person'],affiliations:[{org:'Guild',start:1700,end:1710}]},
    'People/Later.md':{tags:['person'],affiliations:[{org:'Guild',start:1740}]},
    'People/Boundary.md':{tags:['person'],affiliations:[{org:'Guild',start:'1720-01-01',end:'1720-01-01'}]},
  };
  const legacy=legacyFixture({baseNotes:indexNotes,extraNotes,campaignRegistry});
  for(const date of ['1710-12-31','1711-01-01','1720-01-01','1720-01-02','1740-01-01']) {
    const expected=Object.entries({...indexNotes,...extraNotes}).filter(([path,metadata])=>metadata.tags.includes('person') && visible({path}) &&
      legacy.services.util.isAffiliated('Guild',{frontmatter:metadata},date)).map(([path])=>path).sort();
    const result=queryIndex(fixture(extraNotes).runtime,{type:'members',target:'Guild'},{date,visible});
    assert.deepEqual(paths(result).sort(),expected,date);
  }
});

test('member columns match the original templates, including aliases, pronouns and last-known ancestry at the sighting date',()=>{
  const extraNotes={
    'Ancestries/Townfolk.md':{tags:['ancestry'],aliases:['Townlander']},
    'Creatures/Humans.md':{tags:['creature']},
    'Places/Ship.md':{tags:['place'],typeOf:'ship',whereabouts:[{type:'home',location:'Town',end:1710},{type:'home',location:'Other Realm',start:1711}]},
    'People/Traveler.md':{tags:['person'],pronouns:'xe/xem',pronunciation:'TRA-vel-er',ancestry:'Townlander',species:'human',affiliations:['Guild'],
      whereabouts:[{type:'away',location:'Ship',start:1708,end:1710}]},
  };
  const legacy=legacyFixture({baseNotes:indexNotes,extraNotes,campaignRegistry});
  for(const date of ['1720-01-01','1750-01-01']) {
    const result=queryIndex(fixture(extraNotes).runtime,{type:'members',target:'Guild'},{date,visible});
    for(const item of result.items)for(const [field,format] of [
      ['person','<name> (<pronouns> <pronunciation>)'],['info','<ancestry> <maintype>'],['lastKnown','<lastknown:2Fr> (<lastknowndate>)'],
    ])assert.equal(partText(item[field]),unlinked(legacy.services.util.s(format,legacy.file(item.path),date)),item.path+' '+field+' '+date);
    const traveler=result.items.find(item=>item.path==='People/Traveler.md');
    assert.equal(partText(traveler.person),'Traveler (xe/xem TRA-vel-er)');
    assert.equal(partText(traveler.info),'Townlander human');
    assert.equal(partText(traveler.lastKnown),'Ship, Town (DR 1710)');
  }
});

test('target validation, empty results, cycles, and source-relative host resolution are bounded',()=>{
  assert.throws(()=>query('members','Realm'),/organization/);
  assert.throws(()=>query('residents','Guild'),/place/);
  assert.throws(()=>query('residents','missing'),/unavailable/);
  const {runtime,services}=fixture({'Places/Loop A.md':{tags:['place'],whereabouts:'Loop B'},'Places/Loop B.md':{tags:['place'],whereabouts:'Loop A'},'People/Loop.md':{tags:['person'],whereabouts:'Loop A'}});
  const result=queryIndex(runtime,{type:'residents',target:'Realm'},{date:'1720-01-01',visible});
  assert.deepEqual(paths(result),['People/Alice.md','People/Bob.md']);assert.equal(result.warnings.length,1);
  assert.match(indexGrid(query('settlements','Town'),()=>''),/No settlements found/);
  const calls=[];
  const relative=queryIndex(runtime,{type:'residents',target:'./Town.md'},{date:'1720-01-01',sourcePath:'Places/Realm.md',visible,
    resolve:(target,source)=>{calls.push([target,source]);const file=services.NameManager.getFileForTarget(target==='./Town.md'?'Places/Town.md':target);return file && runtime.resolve(file.path);}});
  assert.ok(paths(relative).includes('People/Bob.md'));assert.deepEqual(calls[0],['./Town.md','Places/Realm.md']);
});

function website(extraSources={},assets=[]) {
  const sources={...indexSources(),...extraSources};
  const entries=Object.entries(sources).map(([id,source])=>({id,target:targetPath(id),slug:targetPath(id).slice(0,-3),name:id.split('/').at(-1).slice(0,-3),title:id.split('/').at(-1).slice(0,-3),note:parseNote(source)}));
  const store=new ContentStore([...entries,...assets],[],{respect_pov_dates:true});
  const {runtime}=headerFixture({baseNotes:Object.fromEntries(entries.map(entry=>[entry.id,entry.note.metadata])),campaignRegistry});
  return new RenderEngine({settings:store.settings,store,headers:runtime,renderHeader,renderBio,navigationSource:null});
}

test('website header popups and inline grids filter before counts and retain reader context',()=>{
  const engine=website();
  const result=engine.render('Places/Realm.md','1720-01-01','custom',true,undefined,['dufr'],undefined,true);
  const $=load(result.html,{},false);
  assert.equal($('.taelgar-index-popup').length,2);
  assert.equal($('.taelgar-index-popup summary').first().text(),'Residents (2)');
  const buttons=$('.taelgar-index-buttons');
  assert.equal(buttons.prev().is('.grid.cards'),true,'buttons follow the complete generated information box');
  assert.equal(buttons.closest('.grid.cards,.admonition,details.info').length,0,'buttons are outside the information box');
  assert.equal(buttons.next().text(),'Authored prose.');
  assert.equal($('h1').next().is('.taelgar-index-buttons'),false);
  assert.equal($('.taelgar-header-index-slot').length,0);
  assert.doesNotMatch(result.html,/People\/(Hidden|Campaign Secret|POV Secret)|Future|Dead|Visitor/);
  const url=new URL($('.taelgar-index-link').first().attr('href'),'https://test.invalid');
  assert.equal(url.searchParams.get('date'),'1720-01-01');assert.equal(url.searchParams.get('campaigns'),'dufr');
  assert.equal(url.searchParams.get('dm'),'1');assert.equal(url.searchParams.get('pov'),'1');
  const page=document(result,engine.contexts.list(),engine.navigation);
  assert.match(page,/\/theme\/indexes.css/);assert.match(page,/\/theme\/indexes.js/);
});

test('inline blocks select host, support other targets and embeds, and never enter search or backlinks',()=>{
  const engine=website({
    'Guide.md':'# Guide\n\n```taelgar-index\ntype: residents\ntarget: Town\nshow: website\n```\n\n```taelgar-index\ntype: members\ntarget: Guild\nshow: obsidian\n```\n\n```taelgar-index\ntype: members\ntarget: Guild\nshow: both\n```',
    'Embedded.md':'# Embedded\n\n![[Guide]]',
    'Bad.md':'```taelgar-index\ntype: residents\nrecursive: yes\n```',
    'Places/Local.md':'```taelgar-index\ntype: settlements\ntarget: ./Realm.md\n```',
  });
  const render=page=>engine.render(page,'1720-01-01','custom',false,undefined,['dufr'],undefined,true);
  const result=render('Guide'),$=load(result.html,{},false);
  assert.equal($('.taelgar-index').length,2);assert.equal($('.taelgar-index-card').length,4);
  assert.doesNotMatch(searchText(result.html),/Alice|Bob|Guild|Residents/);
  assert.match(render('Embedded').html,/Alice Example/);
  assert.match(render('Bad').html,/Index unavailable: recursive/);
  assert.match(render('Places/Local').html,/Population 1,234/);
  const compiled=compileSearch(engine.store);
  assert.ok(compiled.documents.filter(doc=>doc.page==='guide').every(doc=>!doc.text.includes('Alice')));
  assert.ok(!engine.render('People/Alice.md','1720-01-01','custom').backlinks?.some(link=>link.title==='Guide'));
});

test('card metadata and invalid options are escaped without hiding the rest of the article',()=>{
  const result=indexGrid({label:'Residents',target:'<b>Place</b>',items:[{name:'<script>',description:'<img onerror=x>',details:'& detail'}],warnings:[]},()=>'<a>safe</a>');
  assert.doesNotMatch(result,/<img|<script|<b>/);assert.match(result,/&lt;img/);
  const engine=website({'Invalid.md':'---\nindexes: {members: true}\n---\n```taelgar-header\n```\n\nStill readable.'});
  const rendered=engine.render('Invalid','1720-01-01','custom');
  assert.match(rendered.html,/indexes must be an array/);assert.match(rendered.html,/Still readable/);
});

test('website header buttons require the new header block, including when an ordinary title or legacy header has indexes',()=>{
  for (const body of ['# Realm\n\nAuthored prose.','<!-- taelgar:header -->\n\nAuthored prose.','# Realm\n>[!info]+ Information\n> Population 12,000\n\nAuthored prose.']) {
    const source=indexSources()['Places/Realm.md'].replace('```taelgar-header\n```',body);
    for (const versioned of [false,true]) {
      const engine=website({'Places/Realm.md':versioned ? source.replace('---\n','---\nheaderVersion: 2023.11.25\n') : source});
      const result=engine.render('Places/Realm.md','1720-01-01','custom');
      assert.doesNotMatch(result.html,/taelgar-index-buttons|taelgar-index-popup|taelgar-header-index-slot/);
    }
  }
});

test('residents tables show Person, Info, dated last-known location, and Home while popups remain grids',()=>{
  const engine=website({'Table.md':'```taelgar-index\ntype: residents\ntarget: Realm\nmode: table\n```'});
  const result=engine.render('Table','1720-01-01','custom',false,undefined,['dufr'],undefined,true),$=load(result.html,{},false);
  assert.deepEqual($('th').map((_,el)=>$(el).text()).get(),['Person','Info','Current Location','Home']);
  const cells=$('tbody tr').first().find('td');
  assert.equal(cells.eq(0).text(),'Alice Example (she/her AL-iss)');assert.equal(cells.eq(1).text(),'Townfolk human');
  assert.equal(cells.eq(2).text(),'the Other Realm (January 1st, 1720)');assert.equal(cells.eq(3).text(),'Inn');
  assert.doesNotMatch($('tbody').text(),/Visitor/);
  assert.match(cells.eq(2).find('a').attr('href'),/date=1720-01-01.*campaigns=dufr.*pov=1/);
  assert.match(cells.eq(3).find('a').attr('href'),/date=1720-01-01.*campaigns=dufr.*pov=1/);
  assert.equal($('img,.taelgar-index-grid').length,0);
  const popup=engine.render('Places/Realm.md','1720-01-01','custom');assert.match(popup.html,/taelgar-index-grid/);assert.doesNotMatch(popup.html,/taelgar-index-table/);
  const changed=engine.render('Table','1741-01-01','custom',false,undefined,['dufr'],undefined,true);
  assert.equal(load(changed.html)('tbody tr').first().find('td').eq(2).text(),'Inn, Town (January 1st, 1741)');
  assert.equal(load(changed.html)('tbody tr').first().find('td').last().text(),'Inn');
  engine.store.resolve('Places/Other Realm.md').note.metadata.excludePublish='all';
  engine.store.resolve('Places/Inn.md').note.metadata.excludePublish='all';
  const filtered=engine.render('Table','1720-01-01','custom',false,undefined,['dufr'],undefined,true);
  assert.doesNotMatch(filtered.html,/Other Realm|other-realm/);assert.match(filtered.html,/Unknown/);
  assert.equal(load(filtered.html)('tbody tr').first().find('td').last().text(),'Unknown');
  assert.doesNotMatch(searchText(result.html),/Alice|Townfolk|Other Realm/);
});

test('website member tables use the requested templates with contextual links, visibility and last-known dates',()=>{
  const engine=website({
    'Members.md':'```taelgar-index\ntype: members\ntarget: Guild\nmode: table\n```',
    'Ancestries/Townfolk.md':'---\ntags: [ancestry]\n---',
    'Creatures/Humans.md':'---\ntags: [creature]\n---',
  });
  const render=(date='1720-01-01')=>engine.render('Members',date,'custom',false,undefined,['dufr'],undefined,true);
  const result=render(),$=load(result.html,{},false);
  assert.deepEqual($('th').map((_,el)=>$(el).text()).get(),['Person','Info','Current Location']);
  const cells=$('tbody tr').first().find('td');
  assert.equal(cells.eq(0).text(),'Alice Example (she/her AL-iss)');
  assert.equal(cells.eq(1).text(),'Townfolk human');assert.equal(cells.eq(1).find('a').length,2);
  assert.equal(cells.eq(2).text(),'the Other Realm (January 1st, 1720)');
  for(const link of $('tbody a').toArray())assert.match($(link).attr('href'),/date=1720-01-01.*campaigns=dufr.*pov=1/);
  assert.equal($('img,.taelgar-index-grid').length,0);assert.doesNotMatch(result.html,/People\/(Hidden|Future|Campaign Secret|POV Secret)/);
  const popup=engine.render('Groups/Guild.md','1720-01-01','custom',false,undefined,['dufr'],undefined,true);
  assert.match(popup.html,/Members \(2\)/);assert.doesNotMatch(popup.html,/taelgar-index-table/);
  assert.match(load(popup.html)('.taelgar-index-card').first().text(),/Alice Example \(she\/her AL-iss\)/);
  assert.match(load(popup.html)('.taelgar-index-card').first().text(),/Current Location: the Other Realm \(January 1st, 1720\)/);
  assert.doesNotMatch(load(popup.html)('.taelgar-index-card').first().text(),/Home:/);
  assert.match(load(render('1721-01-01').html)('tbody tr').first().find('td').last().text(),/January 1st, 1721/);
  for(const path of ['Places/Other Realm.md','Ancestries/Townfolk.md','Creatures/Humans.md'])engine.store.resolve(path).note.metadata.excludePublish='all';
  const hidden=render();assert.doesNotMatch(hidden.html,/Other Realm|other-realm|Townfolk|townfolk|human|Humans/);
  assert.match(hidden.html,/Unknown Unknown/);assert.match(hidden.html,/Unknown \(January 1st, 1720\)/);
  assert.doesNotMatch(searchText(result.html),/Alice|she\/her|Townfolk|Other Realm/);
});

test('member template text is escaped, and unknown locations retain their observation date',()=>{
  const engine=website({
    'Members.md':'```taelgar-index\ntype: members\ntarget: Guild\nmode: table\n```',
    'People/Alice.md':'---\ntags: [person]\nname: "<img onerror=x>"\npronouns: "<script>"\npronunciation: "& sound"\nancestry: "<b>ancestry</b>"\ntypeOf: "<svg>"\naffiliations: [Guild]\n---',
  });
  const result=engine.render('Members','1720-01-01','custom'),$=load(result.html,{},false);
  assert.equal($('tbody img,tbody script,tbody b,tbody svg').length,0);
  assert.match($('tbody tr').first().find('td').first().text(),/<img onerror=x> \(<script> & sound\)/);
  assert.equal($('tbody tr').first().find('td').last().text(),'Unknown (January 1st, 1720)');
});

test('settlement tables use Place, Region, Type Of and Population, shared display rules, and dated region sorting',()=>{
  const engine=website({
    'Settlements.md':'```taelgar-index\ntype: settlements\ntarget: Realm\nmode: table\n```',
    'Places/Alpha.md':'---\ntags: [place]\nwhereabouts: Realm\n---',
    'Places/Zeta.md':'---\ntags: [place]\nwhereabouts: Realm\n---',
    'Places/Z-first.md':'---\ntags: [place]\ntypeOf: settlement\ntypeOfAlias: village\npronunciation: ZED\npopulation: sparse\nwhereabouts: Alpha\n---',
    'Places/A-last.md':'---\ntags: [place]\ntypeOf: settlement\ntypeOfAlias: town\npopulation: 2500\nwhereabouts: Zeta\n---',
  });
  const result=engine.render('Settlements','1720-01-01','custom',false,undefined,['dufr'],undefined,true),$=load(result.html,{},false);
  assert.deepEqual($('th').map((_,el)=>$(el).text()).get(),['Place','Region','Type Of','Population']);
  const rows=$('tbody tr').map((_,el)=>[$(el).find('td').map((_,cell)=>$(cell).text()).get()]).get();
  assert.deepEqual(rows,[['Z-first (ZED)','Alpha','village','sparse'],['Ruin','Realm','settlement','—'],['Town','Realm','town','pop. 1,234'],['A-last','Zeta','town','pop. 2,500']]);
  assert.match($('tbody tr').first().find('td').eq(1).find('a').attr('href'),/date=1720-01-01.*campaigns=dufr.*pov=1/);
  const later=load(engine.render('Settlements','1750-01-01','custom').html,{},false);
  assert.doesNotMatch(later('tbody').text(),/Town/,'a settlement in a different region leaves the query at that date');
  const popup=load(engine.render('Places/Realm.md','1720-01-01','custom').html,{},false);
  assert.match(popup('.taelgar-index-card').filter((_,el)=>popup(el).find('a[href*="places/z-first"]').length).text(),/Z-first \(ZED\)/);
  engine.store.resolve('Places/Alpha.md').note.metadata.excludePublish='all';
  const hidden=engine.render('Settlements','1720-01-01','custom');
  assert.doesNotMatch(hidden.html,/Alpha|\/alpha/);assert.match(hidden.html,/Z-first.*Unknown/s);
  assert.doesNotMatch(searchText(result.html),/Z-first|sparse|2,500/);
});

test('grid images use lead metadata, omit missing/unsafe images, and include responsive popup thumbnails',()=>{
  const portrait={id:'portraits/alice.png',target:'portraits/alice.png',extension:'.png',note:null,
    image:{width:1200,height:1600,variants:[{url:'/assets/portrait-small.webp',width:270,height:360,inline:true}]}};
  const engine=website({'Grid.md':'```taelgar-index\ntype: residents\ntarget: Realm\nmode: grid\n```'},[portrait]);
  const result=engine.render('Grid','1720-01-01','custom',false,undefined,['dufr'],undefined,true),$=load(result.html,{},false);
  assert.equal($('.taelgar-index-image').length,1);assert.equal($('img').attr('alt'),'Alice Example');
  assert.match($('.taelgar-index-card').first().text(),/Alice Example \(she\/her AL-iss\)/);
  assert.equal($('.taelgar-index-card').eq(1).find('a').first().text(),'Bob');
  assert.doesNotMatch($('.taelgar-index-card').eq(1).text(),/\(\s*\)/,'missing pronouns and pronunciation produce no empty parentheses');
  assert.match($('.taelgar-index-card').first().text(),/Current Location: the Other Realm \(January 1st, 1720\)/);
  assert.match($('.taelgar-index-card').first().text(),/Home: Inn/);assert.doesNotMatch(result.html,/Visitor/);
  assert.equal($('img').attr('src'),'/assets/portrait-small.webp');assert.match($('img').attr('srcset'),/270w/);assert.equal($('img').attr('loading'),'lazy');
  const popup=load(engine.render('Places/Realm.md','1720-01-01','custom').html,{},false);
  assert.equal(popup('.taelgar-index-popup img').attr('src'),'/assets/portrait-small.webp');
  assert.match(popup('.taelgar-index-popup .taelgar-index-card').first().text(),/Alice Example \(she\/her AL-iss\)/);
  assert.ok(collectImageUsages(engine.store).has(portrait.id),'frontmatter-only lead images are prepared for publication');
  assert.equal(indexImageTarget([['alice.png']]),'alice.png');assert.equal(indexImageTarget('![[alice.png|Portrait]]'),'alice.png');
  for(const unsafe of ['javascript:alert(1)','data:image/png;base64,abc','https://example.test/alice.png','//example.test/alice.png',{},['one.png','two.png']])assert.equal(indexImageTarget(unsafe),undefined);
  assert.equal(indexImageEntry(engine.store,'./missing/alice.png','People/Bob.md'),undefined,'explicit relative paths cannot silently select a different image');
  assert.equal(indexImageEntry(engine.store,'People/Alice.md','Grid.md'),undefined,'notes cannot become image URLs');
});
