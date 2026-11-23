import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from 'cheerio';
import {headerFixture} from './helpers/header-fixture.mjs';
import {indexNotes,indexSources,featureIndexNotes} from './fixtures/indexes.mjs';
import {parseIndex,queryIndex} from '../src/indexes.mjs';
import {handleRequest} from '../src/application.mjs';
import {ContentStore,parseNote} from '../src/content-store.mjs';
import {RenderEngine} from '../src/render-engine.mjs';
import {targetPath} from '../src/common.mjs';
import {collectImageUsages} from '../scripts/image-usage.mjs';
import {indexImageTarget,indexImageEntry} from '../src/index-images.mjs';

const campaignRegistry={campaigns:{frontier:{name:'Frontier',code:'dufr'}}};
const fixture=extraNotes=>headerFixture({baseNotes:indexNotes,extraNotes,campaignRegistry});
const visible=page=>!['People/Hidden.md','People/Campaign Secret.md'].includes(page.path);
const paths=result=>result.items.map(item=>item.path);
const query=(via,target,options={},extraNotes={})=>queryIndex(fixture(extraNotes).runtime,
  {type:'whereabouts',from:'person',via,target,...options},{date:'1720-01-01',visible});

function website(extraSources={},assets=[]) {
  const sources={...indexSources(),...extraSources};
  const entries=Object.entries(sources).map(([id,source])=>({id,target:targetPath(id),slug:targetPath(id).slice(0,-3),name:id.split('/').at(-1).slice(0,-3),title:id.split('/').at(-1).slice(0,-3),note:parseNote(source)}));
  const store=new ContentStore([...entries,...assets],[],{});
  const {runtime}=headerFixture({baseNotes:Object.fromEntries(entries.map(entry=>[entry.id,entry.note.metadata])),campaignRegistry});
  return new RenderEngine({settings:store.settings,store,headers:runtime,navigationSource:null});
}

test('resident and presence scopes distinguish homes, visits, and the relationship at death',()=>{
  const extraNotes={
    'People/Died Away.md':{tags:['person'],died:1715,whereabouts:[{type:'home',location:'Town'},{type:'away',location:'Other Realm',start:1712,end:1716}]},
    'People/Died Visiting.md':{tags:['person'],died:1715,whereabouts:[{type:'home',location:'Other Realm'},{type:'away',location:'Town',start:1712,end:1716}]},
    'People/Left Before Death.md':{tags:['person'],died:1715,whereabouts:[{type:'home',location:'Town',end:1710},{type:'home',location:'Other Realm',start:1711}]},
    'People/Expired Visit.md':{tags:['person'],whereabouts:[{type:'away',location:'Town',start:1710}]},
    'People/Trip Before Birth.md':{tags:['person'],born:1715,whereabouts:[{type:'away',location:'Town',start:1710}]},
    'People/Future Visit.md':{tags:['person'],whereabouts:[{type:'away',location:'Town',start:1730}]},
  };
  const samplePaths=(type,scope)=>paths(query(type,'Town',{scope},extraNotes)).filter(id=>Object.hasOwn(extraNotes,id));
  assert.deepEqual(samplePaths('home','current'),[]);
  assert.deepEqual(samplePaths('home','historical'),['People/Died Away.md']);
  assert.deepEqual(samplePaths('home','ever'),['People/Died Away.md','People/Left Before Death.md']);
  assert.deepEqual(samplePaths('current','current'),[]);
  assert.deepEqual(samplePaths('current','historical'),['People/Died Visiting.md']);
  assert.deepEqual(samplePaths('current','ever'),['People/Died Away.md','People/Died Visiting.md','People/Expired Visit.md','People/Left Before Death.md']);
});

test('ever follows nested whereabouts on the same day and honors visibility and direct scope',()=>{
  const extraNotes={
    'Places/Moving Inn.md':{tags:['place'],whereabouts:[{type:'home',location:'Town',end:1710},{type:'home',location:'Other Realm',start:1711}]},
    'Places/Hidden Inn.md':{tags:['place'],whereabouts:'Town'},
    'People/Early Visitor.md':{tags:['person'],whereabouts:[{type:'away',location:'Moving Inn',start:1710,end:1712}]},
    'People/Late Visitor.md':{tags:['person'],whereabouts:[{type:'away',location:'Moving Inn',start:1711,end:1712}]},
    'People/Hidden Visitor.md':{tags:['person'],whereabouts:[{type:'away',location:'Hidden Inn',start:1710,end:1712}]},
  };
  const result=recursive=>queryIndex(fixture(extraNotes).runtime,{type:'whereabouts',from:'person',via:'current',target:'Town',scope:'ever',recursive},
    {date:'1720-01-01',visible:page=>visible(page)&&page.path!=='Places/Hidden Inn.md'});
  assert.deepEqual(paths(result(true)).filter(id=>Object.hasOwn(extraNotes,id)),['People/Early Visitor.md']);
  assert.deepEqual(paths(result(false)).filter(id=>Object.hasOwn(extraNotes,id)),[]);
});

test('geography columns can be reordered and sorted by visible or hidden fields',()=>{
  const sources=indexSources({
    'Places/Alpha Region.md':{tags:['place'],typeOf:'region',whereabouts:'Realm'},
    'Places/A-late.md':{tags:['place'],typeOf:'tower',whereabouts:'Alpha Region',population:1200,created:1718,destroyed:1742},
    'Places/Z-early.md':{tags:['place'],typeOf:'tower',whereabouts:'Alpha Region',population:50,created:1699,destroyed:1712},
    'Places/Secondary Site.md':{tags:['place'],typeOf:'ruin',whereabouts:[{type:'secondary',location:'Realm'}]},
  });
  sources['Places table.md']='```taelgar-index\ntype: whereabouts\nfrom: place\nvia: current\nscope: historical\ntarget: Realm\nmode: table\ncolumns: [region, name, type, population, created, destroyed]\nsortBy: [region, type, population, name]\n```';
  sources['Hidden sort.md']='```taelgar-index\ntype: whereabouts\nfrom: place\nvia: current\nscope: historical\ntarget: Realm\nmode: table\ncolumns: [name]\nsortBy: [created]\n```';
  const engine=website(sources);
  const $=load(engine.render('Places table','1720-01-01','custom').html,{},false);
  assert.deepEqual($('th').map((_,cell)=>$(cell).text()).get(),['Region','Place','Type Of','Population','Created','Destroyed']);
  const rows=$('tbody tr').map((_,row)=>[$(row).find('td').map((_,cell)=>$(cell).text()).get()]).get();
  assert.deepEqual(rows.slice(0,2),[
    ['Alpha Region','Z-early','tower','pop. 50','DR 1699','DR 1712'],
    ['Alpha Region','A-late','tower','pop. 1,200','DR 1718','—'],
  ]);
  assert.equal(rows.at(-1)[0],'Unknown','missing regions sort last');
  assert.match($('tbody tr:first-child td:first-child a').attr('href'),/alpha-region/);
  const hidden=load(engine.render('Hidden sort','1720-01-01','custom').html,{},false);
  assert.equal(hidden('th').text(),'Place');
  assert.deepEqual(hidden('tbody tr').slice(0,2).map((_,row)=>hidden(row).text()).get(),['Z-early','A-late']);
});

test('grid images use lead metadata, omit missing/unsafe images, and render responsive thumbnails',()=>{
  const portrait={id:'portraits/alice.png',target:'portraits/alice.png',extension:'.png',note:null,
    image:{width:1200,height:1600,variants:[{url:'/assets/portrait-small.webp',width:270,height:360,inline:true}]}};
  const alice=indexNotes['People/Alice.md'];
  const updatedAlice={...alice,whereabouts:[...alice.whereabouts,{type:'away',start:1741,location:null}]};
  const engine=website({
    'Grid.md':'```taelgar-index\ntype: whereabouts\nfrom: person\nvia: home\ntarget: Realm\nmode: grid\n```',
    'People/Alice.md':indexSources({'People/Alice.md':updatedAlice})['People/Alice.md'],
  },[portrait]);
  const result=engine.render('Grid','1720-01-01','custom',false,undefined,['dufr']),$=load(result.html,{},false);
  assert.equal($('.taelgar-index-image').length,1);assert.equal($('img').attr('alt'),'Alice Example');
  assert.match($('.taelgar-index-card').first().text(),/Alice Example \(she\/her AL-iss\)/);
  assert.equal($('.taelgar-index-card').eq(1).find('a').first().text(),'Bob');
  assert.doesNotMatch($('.taelgar-index-card').eq(1).text(),/\(\s*\)/,'missing pronouns and pronunciation produce no empty parentheses');
  assert.equal($('.taelgar-index-card').first().find('.taelgar-index-detail').first().text(),'Current Location: the Other Realm');
  assert.match($('.taelgar-index-card').first().text(),/Home: Inn/);assert.doesNotMatch(result.html,/Visitor/);
  assert.equal($('img').attr('src'),'/assets/portrait-small.webp');assert.match($('img').attr('srcset'),/270w/);assert.equal($('img').attr('loading'),'lazy');
  assert.ok(collectImageUsages(engine.store).has(portrait.id),'frontmatter-only lead images are prepared for publication');
  assert.equal(indexImageTarget([['alice.png']]),'alice.png');assert.equal(indexImageTarget('![[alice.png|Portrait]]'),'alice.png');
  for(const unsafe of ['javascript:alert(1)','data:image/png;base64,abc','https://example.test/alice.png','//example.test/alice.png',{},['one.png','two.png']])assert.equal(indexImageTarget(unsafe),undefined);
  assert.equal(indexImageEntry(engine.store,'./missing/alice.png','People/Bob.md'),undefined,'explicit relative paths cannot silently select a different image');
  assert.equal(indexImageEntry(engine.store,'People/Alice.md','Grid.md'),undefined,'notes cannot become image URLs');
});

test('lakes honor location aliases, secondary membership, creation dates and visibility without including seas',()=>{
  const extra={...featureIndexNotes,
    'Places/Secondary Lake.md':{tags:['place'],typeOf:'lake',whereabouts:[{type:'home',location:'Town'},{type:'secondary',location:'Drainage Basin'}]},
    'Places/Nested Lake.md':{tags:['place'],typeOf:'lake',whereabouts:'Lake'},
    'Places/Ruined Lake.md':{tags:['place'],typeOf:'lake',destroyed:1710,whereabouts:'Basin'},
    'Places/Future Lake.md':{tags:['place'],typeOf:'lake',created:1760,whereabouts:'Basin'},
    'Places/Hidden Lake.md':{tags:['place'],typeOf:'lake',born:9999,whereabouts:'Basin'},
    'Places/Sea.md':{tags:['place'],typeOf:'marine feature',typeOfAlias:'sea',whereabouts:'Basin'},
    'Places/Lake Named Sea.md':{tags:['place'],typeOf:'marine feature',typeOfAlias:'lake',whereabouts:'Basin'},
  };
  const {runtime}=fixture(extra),options={type:'whereabouts',from:'place',via:'current',scope:'historical',where:{typeOf:['waterway','lake']},target:'Drainage Basin'},context={date:'1720-01-01',visible:page=>page.metadata.born!==9999};
  const result=paths(queryIndex(runtime,options,context));
  for(const name of ['Lake','Secondary Lake','Nested Lake','Ruined Lake'])assert.ok(result.includes('Places/'+name+'.md'),name);
  for(const name of ['Future Lake','Hidden Lake','Sea','Lake Named Sea'])assert.ok(!result.includes('Places/'+name+'.md'),name);
  assert.ok(!paths(queryIndex(runtime,{...options,recursive:false},context)).includes('Places/Nested Lake.md'));
  assert.ok(paths(queryIndex(runtime,options,{...context,date:'1760-01-01'})).includes('Places/Future Lake.md'));
});

test('places include only contained place notes, including town quarters and their buildings',()=>{
  const {runtime}=fixture(featureIndexNotes),context={date:'1720-01-01',visible:page=>page.metadata.born!==9999};
  const places=queryIndex(runtime,{type:'whereabouts',from:'place',via:'current',target:'Old Town'},context);
  assert.deepEqual(paths(places),['Places/Quarter.md','Places/Inn.md','Places/Shop.md','Places/Temple.md']);
  assert.deepEqual(paths(queryIndex(runtime,{type:'whereabouts',from:'place',via:'current',target:'Town',recursive:false},context)),['Places/Quarter.md','Places/Inn.md','Places/Temple.md']);
  assert.ok(!paths(places).some(path=>path.startsWith('People/') || path.startsWith('Groups/')));
});


test('whereabouts YAML validates every first-hop choice, filter shape and table option',()=>{
  const valid = 'type: whereabouts\nfrom: place\nvia: current';
  assert.deepEqual(parseIndex(valid),{type:'whereabouts',from:'place',via:'current',scope:'current',show:'both',mode:'grid',heading:true,recursive:true});
  for (const fragment of ['where: null','where: [plane]','where: {typeOf: []}','where: {typeOf: null}',
    'where: {typeOf: {is: plane}}','placeType: built','recursive: yes','columns: [name]','extra: true',
    'mode: table\nsortBy: [name, name]','mode: table\ncolumns: [roles]']) {
    assert.throws(()=>parseIndex(valid+'\n'+fragment),undefined,fragment);
  }
  for (const source of ['type: residents','type: members','type: whereabouts\nvia: home',
    'type: whereabouts\nfrom: object\nvia: [current, secondary]','type: whereabouts\nfrom: object\nvia: secondary']) {
    assert.throws(()=>parseIndex(source),undefined,source);
  }
  assert.deepEqual(parseIndex(valid+'\nwhere: {typeOf: [plane, realm], population: 500}').where,{typeOf:['plane','realm'],population:500});
});

test('from selects candidates, where matches scalar result fields, and a background target works',()=>{
  const {runtime}=fixture({
    'Energy.md':{tags:['background']},
    'World.md':{tags:['place'],typeOf:'region',whereabouts:'Energy'},
    'Air.md':{tags:['place'],typeOf:'plane',population:500,flag:false,whereabouts:'World'},
    'Sea.md':{tags:['place'],typeOf:'plane',population:'500',flag:false,whereabouts:'World'},
    'Trinket.md':{tags:['object'],typeOf:'plane',population:500,flag:false,whereabouts:'World'},
  });
  const run=(where,from='place',extra={})=>paths(queryIndex(runtime,{type:'whereabouts',from,via:'current',where,...extra},{sourcePath:'Energy.md',date:'1720-01-01'})).sort();
  assert.deepEqual(run({typeOf:['plane','realm'],population:500,flag:false}),['Air.md']);
  assert.deepEqual(run({typeOf:'plane'},'object'),['Trinket.md']);
  assert.deepEqual(run({typeOf:'Plane'}),[]);
  assert.deepEqual(run({tags:'place'}),[]);
  assert.deepEqual(run({missing:false}),[]);
  assert.deepEqual(run({},'place',{recursive:false}),['World.md']);
});

test('home ignores own secondary, current respects its dates, and lastKnown uses sighting-day geography',()=>{
  const place=whereabouts=>({tags:['place'],whereabouts});
  const wp=(type,location,start,end)=>({type,location,start,end});
  const {runtime}=fixture({
    'Dock A.md':place([]),'Dock B.md':place([]),'Old Basin.md':place([]),'New Basin.md':place([]),
    'Barge.md':{tags:['object'],whereabouts:[wp('home','Dock A',null,'1719-12-31'),wp('home','Dock B','1720-01-01')]},
    'Visitor.md':{tags:['person'],whereabouts:[wp('away','Barge','1719-12-29','1719-12-31'),
      wp('secondary','Old Basin','1719-12-29','1719-12-31'),wp('secondary','New Basin','1720-01-01','1720-01-01')]},
    'Township.md':place([wp('home','Dock A'),wp('secondary','Old Basin')]),
    'Resident.md':{tags:['person'],whereabouts:[wp('home','Township'),wp('secondary','Dock B')]},
  });
  function has(person,via,target,date='1720-01-02',extra={}) {
    return paths(queryIndex(runtime,{type:'whereabouts',from:'person',target,via,...extra},{date})).includes(person+'.md');
  }
  assert.equal(has('Resident','home','Dock B'),false);
  assert.equal(has('Resident','home','Old Basin'),true);
  assert.equal(has('Resident','home','Old Basin',undefined,{recursive:false}),false);
  assert.equal(has('Visitor','current','New Basin','1720-01-01'),true);
  assert.equal(has('Visitor','current','New Basin'),false);
  assert.equal(has('Visitor','current','Dock A'),false);
  assert.equal(has('Visitor','lastKnown','Dock A'),true);
  assert.equal(has('Visitor','lastKnown','Dock B'),false);
  assert.equal(has('Visitor','lastKnown','Old Basin'),true);
  assert.equal(has('Visitor','lastKnown','New Basin'),false);
  assert.equal(has('Visitor','lastKnown','Barge',undefined,{recursive:false}),true);
  assert.equal(has('Visitor','lastKnown','Dock A',undefined,{recursive:false}),false);
});

test('site renders inline queries and ignores header indexes on places and groups',async()=>{
  const engine=website({
    'Guide.md':'# Guide\n\n```taelgar-index\ntype: whereabouts\nfrom: person\nvia: home\ntarget: Town\nheading: false\n```',
    'Embedded.md':'# Embedded\n\n![[Guide]]',
    'Groups/No Buttons.md':'---\ntags: [group]\nindexes: [members]\n---\n# Group\n> [!taelgar-header]\n',
  });
  const render=page=>engine.render(page,'1720-01-01','custom').html;
  assert.match(render('Embedded'),/Alice Example/);
  assert.doesNotMatch(render('Guide'),/<h2>People|Visitor/);
  assert.doesNotMatch(render('Groups/No Buttons'),/taelgar-index-buttons|taelgar-index-popup|header-index-slot/);
  assert.equal((await handleRequest(new Request('https://test.invalid/api/index?page=Town&type=places'),engine)).status,404);
});
