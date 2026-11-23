import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from 'cheerio';
import {headerFixture} from './helpers/header-fixture.mjs';
import {headerFixture as legacyFixture} from './helpers/legacy-header-fixture.mjs';
import {indexNotes,indexSources,featureIndexNotes,objectIndexNotes} from './fixtures/indexes.mjs';
import {headerIndexes,headerIndexesForMetadata,parseIndex,queryIndex,indexHasResults} from '../src/indexes.mjs';
import {indexGrid,indexPopupShell} from '../src/index-view.mjs';
import {handleRequest} from '../src/application.mjs';
import {ContentStore,parseNote} from '../src/content-store.mjs';
import {RenderEngine,document} from '../src/render-engine.mjs';
import {targetPath} from '../src/common.mjs';
import {compileSearch} from '../scripts/compile-search.mjs';
import {searchText} from '../src/search-text.mjs';
import {collectImageUsages} from '../scripts/image-usage.mjs';
import {indexImageTarget,indexImageEntry} from '../src/index-images.mjs';

const campaignRegistry={campaigns:{frontier:{name:'Frontier',code:'dufr'}}};
const fixture=extraNotes=>headerFixture({baseNotes:indexNotes,extraNotes,campaignRegistry});
const visible=page=>!['People/Hidden.md','People/Campaign Secret.md'].includes(page.path);
const query=(type,target,options={},extraNotes={})=>queryIndex(fixture(extraNotes).runtime,{type,target,...options},
  {date:'1720-01-01',visible});
const paths=result=>result.items.map(item=>item.path);

test('index authoring validates arrays and YAML, supplies defaults, and deduplicates buttons',()=>{
  assert.deepEqual(headerIndexes(['members','members']),['members']);
  assert.deepEqual(headerIndexes(undefined),[]);assert.deepEqual(headerIndexes([]),[]);
  assert.deepEqual(headerIndexesForMetadata({tags:['group']}),['members']);
  assert.deepEqual(headerIndexesForMetadata({tags:['group/clan']}),['members']);
  assert.deepEqual(headerIndexesForMetadata({tags:['group'],indexes:[]}),[]);
  assert.deepEqual(headerIndexesForMetadata({tags:['group'],indexes:['places']}),['places']);
  assert.deepEqual(headerIndexesForMetadata({tags:['person']}),[]);
  for(const invalid of [{members:true},'members',['unknown'],['constructor'],[null]])assert.throws(()=>headerIndexes(invalid),/array/);
  assert.deepEqual(parseIndex('type: residents'),{type:'residents',target:undefined,show:'both',recursive:true,mode:'grid',heading:true});
  assert.equal(parseIndex('type: members\nmode: table').mode,'table');
  assert.equal(parseIndex('type: members').recursive,false);
  assert.equal(parseIndex('type: people-in-place').recursive,true);
  assert.deepEqual(headerIndexes(['people-in-place']),['people-in-place']);
  const historical=parseIndex('type: members\nscope: historical\nmode: table\ncolumns: [name, info, born, died]');
  assert.equal(historical.scope,'historical');
  assert.deepEqual(historical.columns,['name','info','born','died']);
  const columns=parseIndex('type: places\nmode: table\ncolumns: [region, name]\nsortBy: [region, type, name]');
  assert.deepEqual(columns.columns,['region','name']);
  assert.deepEqual(columns.sortBy,['region','type','name']);
  for(const source of ['type: members\ncolumns: [name]', 'type: members\nsortBy: [joined]',
    'type: residents\nmode: table\ncolumns: [joined]', 'type: members\nmode: table\ncolumns: life-dates',
    'type: places\nmode: table\ncolumns: [name, name]', 'type: members\nmode: table\ncolumns: []',
    'type: members\nmode: table\nsortBy: [region]', 'type: members\nmode: table\nsortBy: name']) {
    assert.throws(()=>parseIndex(source),/columns|sortBy/);
  }
  for(const type of ['members','residents','people-in-place','settlements','rivers','places'])for(const scope of ['current','historical','ever']) {
    assert.equal(parseIndex('type: '+type+'\nscope: '+scope).scope,scope);
  }
  for(const source of ['type: members\nmembership: historical','type: members\nignoreDeath: true',
    'type: places\nscope: all','type: residents\nscope: null']) {
    assert.throws(()=>parseIndex(source),/membership|ignoreDeath|scope|columns/);
  }
  assert.equal(parseIndex('type: places\nplaceType: built').placeType,'built');
  assert.equal(parseIndex('type: places\nplaceType: natural').placeType,'natural');
  for(const value of ['all','[]','null','true','""'])assert.throws(()=>parseIndex('type: places\nplaceType: '+value),/placeType/);
  for(const type of ['rivers','settlements','members','residents'])assert.throws(()=>parseIndex('type: '+type+'\nplaceType: built'),/only supported for places/);
  assert.equal(parseIndex('type: settlements\nheading: false').heading,false);
  assert.equal(parseIndex('type: settlements\nheading: true').heading,true);
  for(const value of ['null','0','yes','"false"','[]'])assert.throws(()=>parseIndex('type: settlements\nheading: '+value),/heading must be true or false/);
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

test('people-in-place includes visitors and local residents using only their current whereabouts',()=>{
  const extraNotes={
    'People/Nested Visitor.md':{tags:['person'],whereabouts:[{type:'home',location:'Other Realm'},{type:'away',location:'Inn',start:1719,end:1721}]},
    'People/Expired Visitor.md':{tags:['person'],whereabouts:[{type:'away',location:'Town',start:1719}]},
    'People/Secondary Visitor.md':{tags:['person'],whereabouts:[{type:'home',location:'Other Realm'},{type:'secondary',location:'Town'}]},
    'People/Missing Resident.md':{tags:['person'],whereabouts:[{type:'home',location:'Town'},{type:'away',start:1719,location:'unknown'}]},
    'Places/Hidden Inn.md':{tags:['place'],typeOf:'inn',whereabouts:'Town'},
    'People/Hidden Location.md':{tags:['person'],whereabouts:'Hidden Inn'},
  };
  const {runtime}=fixture(extraNotes);
  const select=(date,recursive=true)=>queryIndex(runtime,{type:'people-in-place',target:'Town',recursive},
    {date,visible:page=>visible(page)&&page.path!=='Places/Hidden Inn.md'});
  assert.deepEqual(paths(select('1720-01-01')),['People/Bob.md','People/Nested Visitor.md','People/Visitor.md']);
  assert.deepEqual(paths(select('1720-01-01',false)),['People/Bob.md','People/Visitor.md']);
  assert.deepEqual(paths(select('1741-01-01')),['People/Alice.md','People/Bob.md']);
  const residentAway=query('residents','Town',{},extraNotes);
  assert.ok(paths(residentAway).includes('People/Alice.md'));
  assert.ok(!paths(residentAway).includes('People/Visitor.md'));
});

test('people indexes accept any object target and keep dated containment and visibility rules',()=>{
  const {runtime}=fixture(objectIndexNotes);
  const withTarget=(type,target,options={},canSee=visible)=>queryIndex(runtime,{type,target,...options},{date:'1720-01-01',visible:canSee});
  assert.deepEqual(paths(withTarget('residents','Sky Kite',{scope:'current'})),['People/Crew.md','People/Occupant.md']);
  assert.deepEqual(paths(withTarget('people-in-place','Vessel',{scope:'current'})),['People/Boarding Visitor.md','People/Occupant.md']);
  assert.deepEqual(paths(withTarget('people-in-place','Vessel',{scope:'current',recursive:false})),['People/Boarding Visitor.md']);
  assert.deepEqual(paths(withTarget('people-in-place','Vessel',{scope:'ever'})),
    ['People/Boarding Visitor.md','People/Crew.md','People/Deceased Occupant.md','People/Former Passenger.md','People/Occupant.md']);
  assert.deepEqual(paths(withTarget('residents','Mirror',{scope:'historical'})),['People/Deceased Occupant.md','People/Occupant.md']);
  assert.throws(()=>withTarget('people-in-place','Mirror',{},page=>page.path!=='Objects/Mirror.md'),/unavailable/);
  for(const type of ['places','rivers','settlements'])assert.throws(()=>withTarget(type,'Vessel'),/requires a place target/);
});

test('People Present on an object lists direct occupants and respects nested object visibility',()=>{
  const {runtime}=fixture(objectIndexNotes);
  const context={date:'1720-01-01',sourcePath:'Objects/Vessel.md',visible};
  const occupants={type:'people-in-place'};
  assert.deepEqual(paths(queryIndex(runtime,{...occupants,recursive:false},context)),['People/Boarding Visitor.md']);
  assert.deepEqual(paths(queryIndex(runtime,occupants,context)),['People/Boarding Visitor.md','People/Occupant.md']);
  assert.deepEqual(paths(queryIndex(runtime,{...occupants,target:'Mirror'},context)),['People/Occupant.md']);
  const hiddenMirror={...context,visible:page=>visible(page) && page.path!=='Objects/Mirror.md'};
  assert.deepEqual(paths(queryIndex(runtime,occupants,hiddenMirror)),['People/Boarding Visitor.md']);
  assert.throws(()=>queryIndex(runtime,{...occupants,target:'Crew'},context),/place or object target/);
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

test('resident columns retain the current hierarchy and omit expired sightings',()=>{
  const extraNotes={
    'Places/Ship.md':{tags:['place'],typeOf:'ship',whereabouts:[{type:'home',location:'Town',end:1710},{type:'home',location:'Other Realm',start:1711}]},
    'People/Traveler.md':{tags:['person'],pronouns:'xe/xem',pronunciation:'TRA-vel-er',ancestry:'Townfolk',species:'human',
      whereabouts:[{type:'home',location:'Other Realm'},{type:'away',location:'Ship',start:1710}]},
  };
  const legacy=legacyFixture({baseNotes:indexNotes,extraNotes,campaignRegistry});
  for(const date of ['1710-12-31','1720-01-01','1750-01-01']) {
    const result=queryIndex(fixture(extraNotes).runtime,{type:'residents',target:'Other Realm'},{date,visible});
    for(const item of result.items)for(const [field,format] of [
      ['person','<name> (<pronouns> <pronunciation>)'],['info','<ancestry> <maintype>'],
      ['home','<home:1>'],
    ])assert.equal(partText(item[field]),unlinked(legacy.services.util.s(format,legacy.file(item.path),date)),item.path+' '+field+' '+date);
    const traveler=result.items.find(item=>item.path==='People/Traveler.md');
    assert.equal(partText(traveler.currentLocation),date==='1710-12-31' ? 'Ship, Town' : '');
    assert.equal(partText(traveler.home),'the Other Realm');
  }
  const bob=query('residents','Realm').items.find(item=>item.path==='People/Bob.md');
  assert.equal(partText(bob.person),'Bob');assert.equal(partText(bob.currentLocation),'the Old Town, Realm');
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

test('membership scopes distinguish active affiliations, affiliations at death, and former affiliations',()=>{
  const extraNotes={
    'People/Former.md':{tags:['person'],born:1690,affiliations:[{org:'Guild',start:1700,end:1719}]},
    'People/Expired Leader.md':{tags:['person'],died:1710,leaderOf:[{place:'Guild',start:1700,end:1717}]},
    'People/Deceased Leader.md':{tags:['person'],died:1710,leaderOf:[{place:'Guild',start:1700}]},
    'People/Died in Office.md':{tags:['person'],died:'1715-01-01',leaderOf:[{place:'Guild',start:1700,end:'1715-01-01'}]},
    'People/Retired Before Death.md':{tags:['person'],died:1715,affiliations:[{org:'Guild',start:1700,end:1710}]},
    'People/Prebirth Role.md':{tags:['person'],born:1710,affiliations:[{org:'Guild',start:1700,end:1709}]},
    'People/Posthumous Role.md':{tags:['person'],died:1710,affiliations:[{org:'Guild',start:1712,end:1725}]},
    'People/Future Member.md':{tags:['person'],affiliations:[{org:'Guild',start:1730}]},
  };
  const {runtime}=fixture(extraNotes);
  const read=(scope,date='1720-01-01')=>queryIndex(runtime,{type:'members',target:'Guild',scope},{date,visible});
  assert.deepEqual(paths(read('current')),['People/Alice.md','People/Bob.md']);
  const historical=read('historical');
  assert.equal(historical.label,'Historical Members');
  assert.deepEqual(paths(historical),['People/Alice.md','People/Bob.md','People/Dead.md','People/Deceased Leader.md','People/Died in Office.md','People/Expired Leader.md']);
  assert.deepEqual(paths(read('ever')),[...paths(historical),'People/Former.md','People/Retired Before Death.md']);
  assert.ok(paths(read('current','1715-01-01')).includes('People/Died in Office.md'),'end dates are inclusive');
  assert.ok(paths(read('ever','1730-01-01')).includes('People/Future Member.md'));
  assert.deepEqual(historical.items.find(item=>item.path==='People/Dead.md').currentLocation,[]);
  assert.ok(paths(read(undefined)).includes('People/Posthumous Role.md'),'omitting scope preserves the original Members selection');
});

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
  assert.deepEqual(samplePaths('residents','current'),[]);
  assert.deepEqual(samplePaths('residents','historical'),['People/Died Away.md']);
  assert.deepEqual(samplePaths('residents','ever'),['People/Died Away.md','People/Left Before Death.md']);
  assert.deepEqual(samplePaths('people-in-place','current'),[]);
  assert.deepEqual(samplePaths('people-in-place','historical'),['People/Died Visiting.md']);
  assert.deepEqual(samplePaths('people-in-place','ever'),['People/Died Away.md','People/Died Visiting.md','People/Expired Visit.md','People/Left Before Death.md']);
});

test('ever follows nested whereabouts on the same day and honors visibility and direct scope',()=>{
  const extraNotes={
    'Places/Moving Inn.md':{tags:['place'],whereabouts:[{type:'home',location:'Town',end:1710},{type:'home',location:'Other Realm',start:1711}]},
    'Places/Hidden Inn.md':{tags:['place'],whereabouts:'Town'},
    'People/Early Visitor.md':{tags:['person'],whereabouts:[{type:'away',location:'Moving Inn',start:1710,end:1712}]},
    'People/Late Visitor.md':{tags:['person'],whereabouts:[{type:'away',location:'Moving Inn',start:1711,end:1712}]},
    'People/Hidden Visitor.md':{tags:['person'],whereabouts:[{type:'away',location:'Hidden Inn',start:1710,end:1712}]},
  };
  const result=recursive=>queryIndex(fixture(extraNotes).runtime,{type:'people-in-place',target:'Town',scope:'ever',recursive},
    {date:'1720-01-01',visible:page=>visible(page)&&page.path!=='Places/Hidden Inn.md'});
  assert.deepEqual(paths(result(true)).filter(id=>Object.hasOwn(extraNotes,id)),['People/Early Visitor.md']);
  assert.deepEqual(paths(result(false)).filter(id=>Object.hasOwn(extraNotes,id)),[]);
});

test('all geography indexes distinguish existing, destroyed in place, and formerly contained places',()=>{
  for(const [type,typeOf] of [['settlements','settlement'],['places','building'],['rivers','waterway']]) {
    const candidate=(whereabouts,extra={})=>({tags:['place'],typeOf,whereabouts,...extra});
    const moved=[{type:'home',location:'Realm',end:1710},{type:'home',location:'Other Realm',start:1711}];
    const extras={
      'Places/Scope Current.md':candidate('Realm'),
      'Places/Scope Destroyed.md':candidate('Realm',{destroyed:1715}),
      'Places/Scope Moved.md':candidate(moved),
      'Places/Scope Moved Before Destruction.md':candidate(moved,{destroyed:1715}),
      'Places/Scope Past Sighting.md':candidate([{type:'away',location:'Realm',start:1710}],{destroyed:1715}),
      'Places/Scope Future.md':candidate('Realm',{created:1740}),
      'Places/Scope Secondary.md':candidate([{type:'home',location:'Other Realm'},{type:'secondary',location:'Realm'}]),
    };
    const result=scope=>query(type,'Realm',{scope},extras);
    const names=scope=>paths(result(scope)).filter(id=>Object.hasOwn(extras,id)).map(id=>id.slice(13,-3)).sort();
    assert.deepEqual(names('current'),['Current','Secondary'],type);
    assert.deepEqual(names('historical'),['Current','Destroyed','Secondary'],type);
    assert.deepEqual(names('ever'),['Current','Destroyed','Moved','Moved Before Destruction','Past Sighting','Secondary'],type);
    assert.ok(names(undefined).includes('Past Sighting'),type);
    if(type==='settlements')assert.equal(result('ever').items.find(item=>item.path==='Places/Scope Moved.md').region.name,'Realm');
  }
});

test('member columns preserve aliases and pronouns and use the selected date for current locations',()=>{
  const extraNotes={
    'Ancestries/Townfolk.md':{tags:['ancestry'],aliases:['Townlander']},
    'Creatures/Humans.md':{tags:['creature']},
    'Places/Ship.md':{tags:['place'],typeOf:'ship',whereabouts:[{type:'home',location:'Town',end:1710},{type:'home',location:'Other Realm',start:1711}]},
    'People/Traveler.md':{tags:['person'],pronouns:'xe/xem',pronunciation:'TRA-vel-er',ancestry:'Townlander',species:'human',affiliations:['Guild'],
      whereabouts:[{type:'away',location:'Ship',start:1708,end:1710}]},
  };
  const legacy=legacyFixture({baseNotes:indexNotes,extraNotes,campaignRegistry});
  for(const date of ['1710-12-31','1720-01-01','1750-01-01']) {
    const result=queryIndex(fixture(extraNotes).runtime,{type:'members',target:'Guild'},{date,visible});
    for(const item of result.items)for(const [field,format] of [
      ['person','<name> (<pronouns> <pronunciation>)'],['info','<ancestry> <maintype>'],
    ])assert.equal(partText(item[field]),unlinked(legacy.services.util.s(format,legacy.file(item.path),date)),item.path+' '+field+' '+date);
    const traveler=result.items.find(item=>item.path==='People/Traveler.md');
    assert.equal(partText(traveler.person),'Traveler (xe/xem TRA-vel-er)');
    assert.equal(partText(traveler.info),'Townlander human');
    assert.equal(partText(traveler.currentLocation),date==='1710-12-31' ? 'Ship, Town' : '');
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
  const store=new ContentStore([...entries,...assets],[],{});
  const {runtime}=headerFixture({baseNotes:Object.fromEntries(entries.map(entry=>[entry.id,entry.note.metadata])),campaignRegistry});
  return new RenderEngine({settings:store.settings,store,headers:runtime,navigationSource:null});
}

test('website renders object people tables and an object header popup',()=>{
  const sources=indexSources(objectIndexNotes);
  sources['Objects/Vessel.md']+='\n\n```taelgar-index\ntype: people-in-place\nmode: table\nscope: current\ncolumns: [name, currentLocation]\n```';
  const engine=website(sources);
  const $=load(engine.render('Objects/Vessel.md','1720-01-01','custom').html,{},false);
  assert.deepEqual($('tbody tr td:first-child a').map((_,cell)=>$(cell).text()).get(),['Boarding Visitor','Occupant']);
  assert.match($('tbody tr').last().find('td').last().find('a').first().attr('href'),/objects\/mirror/);
  assert.deepEqual($('.taelgar-index-popup summary').map((_,item)=>$(item).text()).get(),['Residents','People Present']);
  const popup=load(engine.renderIndex('Objects/Vessel.md','residents','1720-01-01','custom'),{},false);
  assert.equal(popup('.taelgar-index-count').text(),'2 residents');
  assert.match(popup('.taelgar-index-card').first().text(),/Crew/);
});

test('website header popups and inline grids filter before counts and retain reader context',()=>{
  const engine=website({
    'Places/Empty.md':"---\ntags: [place]\nindexes: [residents, settlements]\n---\n> [!taelgar-header]\n\nAuthored prose.",
  });
  const result=engine.render('Places/Realm.md','1720-01-01','custom',true,undefined,['dufr']);
  const $=load(result.html,{},false);
  assert.equal($('.taelgar-index-popup').length,2);
  assert.equal($('.taelgar-index-popup summary').first().text(),'Residents');
  assert.equal($('.taelgar-index-card,img').length,0,'popup content waits for activation');
  const buttons=$('.taelgar-index-buttons');
  assert.equal(buttons.prev().is('.grid.cards'),true,'buttons follow the complete generated information box');
  assert.equal(buttons.closest('.grid.cards,.admonition,details.info').length,0,'buttons are outside the information box');
  assert.equal(buttons.next().text(),'Authored prose.');
  assert.equal($('h1').next().is('.taelgar-index-buttons'),false);
  assert.equal($('.taelgar-header-index-slot').length,0);
  assert.doesNotMatch(result.html,/People\/(Hidden|Campaign Secret)|Future|Dead|Visitor/);
  const url=new URL($('.taelgar-index-popup').first().attr('data-index-url'),'https://test.invalid');
  assert.equal(url.pathname,'/api/index');assert.equal(url.searchParams.get('type'),'residents');
  assert.equal(url.searchParams.get('date'),'1720-01-01');assert.equal(url.searchParams.get('campaigns'),'dufr');
  assert.equal(url.searchParams.get('dm'),'1');assert.equal(url.searchParams.get('pov'),null);
  const page=document(result,engine.contexts.list(),engine.navigation);
  assert.match(page,/\/theme\/indexes.css/);assert.match(page,/\/theme\/indexes.js/);
  const empty=engine.render('Places/Empty.md','1720-01-01','custom');
  assert.doesNotMatch(empty.html,/taelgar-index-buttons|taelgar-index-popup|taelgar-header-index-slot/);
  assert.match(empty.html,/Authored prose/);
});

test('inline blocks select host, support other targets and embeds, and never enter search or backlinks',()=>{
  const engine=website({
    'Guide.md':'# Guide\n\n```taelgar-index\ntype: residents\ntarget: Town\nshow: website\n```\n\n```taelgar-index\ntype: members\ntarget: Guild\nshow: obsidian\n```\n\n```taelgar-index\ntype: members\ntarget: Guild\nshow: both\n```',
    'Embedded.md':'# Embedded\n\n![[Guide]]',
    'Bad.md':'```taelgar-index\ntype: residents\nrecursive: yes\n```',
    'Places/Local.md':'```taelgar-index\ntype: settlements\ntarget: ./Realm.md\n```',
  });
  const render=page=>engine.render(page,'1720-01-01','custom',false,undefined,['dufr']);
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

test('website all-time tables show dated life columns and People Present has a header popup',()=>{
  const sources=indexSources({
    'People/Former.md':{tags:['person'],born:1690,died:1721,affiliations:[{org:'Guild',end:1710}]},
    'Places/Town.md':{...indexNotes['Places/Town.md'],indexes:['people-in-place']},
  });
  sources['Roster.md']='```taelgar-index\ntype: members\ntarget: Guild\nscope: ever\nmode: table\ncolumns: [name, info, born, died]\nsortBy: [born, name]\n```';
  const engine=website(sources);
  const at=date=>load(engine.render('Roster',date,'custom').html,{},false);
  const $=at('1720-01-01');
  assert.equal($('.taelgar-index > h2').text(),'All-time Members');
  assert.deepEqual($('th').map((_,cell)=>$(cell).text()).get(),['Person','Info','Born','Died']);
  assert.deepEqual($('tbody tr td:first-child a').map((_,cell)=>$(cell).text()).get(),['Former','Alice Example','Bob','Dead']);
  assert.match($('tbody tr').first().find('td').eq(2).text(),/1690/);
  assert.equal($('tbody tr').first().find('td').last().text(),'—');
  assert.match(at('1722-01-01')('tbody tr').first().find('td').last().text(),/1721/);

  const town=load(engine.render('Places/Town.md','1720-01-01','custom').html,{},false);
  assert.equal(town('.taelgar-index-popup summary').text(),'People Present');
  const popup=load(engine.renderIndex('Places/Town.md','people-in-place','1720-01-01','custom'),{},false);
  assert.equal(popup('.taelgar-index-count').text(),'2 people');
  assert.deepEqual(popup('.taelgar-index-link').map((_,link)=>popup(link).text()).get().filter(name=>name==='Bob'||name==='Visitor'),['Bob','Visitor']);
  assert.doesNotMatch(popup('.taelgar-index').text(),/Alice|Dead|Future/);
});

test('membership table columns keep joined and left dates on the same qualifying period',()=>{
  const sources=indexSources({
    'People/Multiple Periods.md':{tags:['person'],affiliations:[
      {org:'Guild',start:1701,end:1702,title:'Apprentice'},
      {org:'Guild',start:1714,end:1719,title:'Steward'},
      {org:'Guild',start:1722,end:1725,title:'Treasurer'},
    ]},
    'People/Later End.md':{tags:['person'],affiliations:[{org:'Guild',start:1713,end:1724}]},
    'People/Term at Death.md':{tags:['person'],died:1718,leaderOf:[{place:'Guild',start:1712,end:1718,title:'Captain'}]},
    'People/Reign Fallback.md':{tags:['person'],reignStart:1716,leaderOf:[{place:'Guild',title:'Librarian'}]},
  });
  sources['Roster.md']='```taelgar-index\ntype: members\ntarget: Guild\nscope: ever\nmode: table\ncolumns: [name, roles, joined, left, died]\nsortBy: [joined, name]\n```';
  const engine=website(sources);
  const render=date=>load(engine.render('Roster',date,'custom').html,{},false);
  const $=render('1720-01-01');
  const rows=$('tbody tr').map((_,row)=>[$(row).find('td').map((_,cell)=>$(cell).text()).get()]).get();
  assert.deepEqual($('th').map((_,heading)=>$(heading).text()).get(),['Person','Roles','Joined','Left','Died']);
  assert.deepEqual(rows.map(row=>row[0]),['Alice Example (she/her AL-iss)','Term at Death','Later End','Multiple Periods','Bob','Reign Fallback','Dead']);
  assert.deepEqual(rows.find(row=>row[0]==='Multiple Periods'),['Multiple Periods','Apprentice · Steward','DR 1714','DR 1719','—']);
  assert.deepEqual(rows.find(row=>row[0]==='Term at Death'),['Term at Death','Captain','DR 1712','—','DR 1718']);
  assert.deepEqual(rows.find(row=>row[0]==='Later End').slice(2),['DR 1713','—','—']);
  assert.deepEqual(rows.find(row=>row[0]==='Reign Fallback').slice(2),['DR 1716','—','—']);
  assert.deepEqual(rows.find(row=>row[0]==='Dead').slice(2,4),['—','—']);
  const later=render('1726-01-01');
  const latest=later('tbody tr').filter((_,row)=>later(row).find('td').first().text()==='Multiple Periods');
  assert.deepEqual(latest.find('td').map((_,cell)=>later(cell).text()).get().slice(2),['DR 1722','DR 1725','—']);
});

test('geography columns can be reordered and sorted by visible or hidden fields',()=>{
  const sources=indexSources({
    'Places/Alpha Region.md':{tags:['place'],typeOf:'region',whereabouts:'Realm'},
    'Places/A-late.md':{tags:['place'],typeOf:'tower',whereabouts:'Alpha Region',population:1200,created:1718,destroyed:1742},
    'Places/Z-early.md':{tags:['place'],typeOf:'tower',whereabouts:'Alpha Region',population:50,created:1699,destroyed:1712},
    'Places/Secondary Site.md':{tags:['place'],typeOf:'ruin',whereabouts:[{type:'secondary',location:'Realm'}]},
  });
  sources['Places table.md']='```taelgar-index\ntype: places\ntarget: Realm\nmode: table\ncolumns: [region, name, type, population, created, destroyed]\nsortBy: [region, type, population, name]\n```';
  sources['Hidden sort.md']='```taelgar-index\ntype: places\ntarget: Realm\nmode: table\ncolumns: [name]\nsortBy: [created]\n```';
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

test('all inline index types have one H2 label in grids and tables, including empty indexes',()=>{
  const sources=indexSources(featureIndexNotes);
  const cases=[['residents','Realm','Residents'],['settlements','Realm','Settlements'],['members','Guild','Members'],['rivers','Basin','Rivers'],['places','Town','Places'],['places','Inn','Places']];
  for(const [type,target] of cases)for(const mode of ['grid','table'])sources[type+'-'+target+'-'+mode+'.md']='```taelgar-index\ntype: '+type+'\ntarget: '+target+'\nmode: '+mode+'\n```';
  const engine=website(sources);
  for(const [type,target,label] of cases)for(const mode of ['grid','table']) {
    const $=load(engine.render(type+'-'+target+'-'+mode,'1720-01-01','custom').html,{},false);
    assert.equal($('.taelgar-index > h2').length,1);
    assert.equal($('.taelgar-index').children().first().prop('tagName'),'H2');
    assert.equal($('.taelgar-index > h2').text(),label);
  }
  const popup=load(engine.renderIndex('Places/Basin.md','rivers','1720-01-01','custom'),{},false);
  assert.equal(popup('h2').length,0,'lazy popup content does not duplicate the dialog title');
});

test('inline heading can be disabled without removing table columns, counts or empty messages',()=>{
  for(const mode of ['grid','table'])for(const target of ['Realm','Inn']) {
    const sources={};
    for(const heading of [true,false])sources[String(heading)+'.md']='```taelgar-index\ntype: settlements\ntarget: '+target+'\nmode: '+mode+'\nheading: '+heading+'\n```';
    const engine=website(sources);
    const shown=load(engine.render('true','1720-01-01','custom').html,{},false);
    const hidden=load(engine.render('false','1720-01-01','custom').html,{},false);
    assert.equal(shown('.taelgar-index > h2').length,1);
    assert.equal(hidden('.taelgar-index > h2').length,0);
    shown('.taelgar-index > h2').remove();
    assert.equal(hidden('.taelgar-index').html(),shown('.taelgar-index').html());
    assert.equal(hidden('.taelgar-index').attr('aria-label'),shown('.taelgar-index').attr('aria-label'));
  }
});

test('card metadata and invalid options are escaped without hiding the rest of the article',()=>{
  const result=indexGrid({label:'Residents',target:'<b>Place</b>',items:[{name:'<script>',description:'<img onerror=x>',details:'& detail'}],warnings:[]},()=>'<a>safe</a>');
  assert.doesNotMatch(result,/<img|<script|<b>/);assert.match(result,/&lt;img/);
  const engine=website({'Invalid.md':'---\nindexes: {members: true}\n---\n> [!taelgar-header]\n\nStill readable.'});
  const rendered=engine.render('Invalid','1720-01-01','custom');
  assert.match(rendered.html,/indexes must be an array/);assert.match(rendered.html,/Still readable/);
});

test('website header buttons require the new header block, including when an ordinary title or legacy header has indexes',()=>{
  for (const body of ['# Realm\n\nAuthored prose.','<!-- taelgar:header -->\n\nAuthored prose.','# Realm\n>[!info]+ Information\n> Population 12,000\n\nAuthored prose.']) {
    const source=indexSources()['Places/Realm.md'].replace('> [!taelgar-header]',body);
    for (const versioned of [false,true]) {
      const engine=website({'Places/Realm.md':versioned ? source.replace('---\n','---\nheaderVersion: 2023.11.25\n') : source});
      const result=engine.render('Places/Realm.md','1720-01-01','custom');
      assert.doesNotMatch(result.html,/taelgar-index-buttons|taelgar-index-popup|taelgar-header-index-slot/);
    }
  }
});

test('residents tables show Person, Info, Current Location, and Home while popups remain grids',()=>{
  const engine=website({'Table.md':'```taelgar-index\ntype: residents\ntarget: Realm\nmode: table\n```'});
  const result=engine.render('Table','1720-01-01','custom',false,undefined,['dufr']),$=load(result.html,{},false);
  assert.deepEqual($('th').map((_,el)=>$(el).text()).get(),['Person','Info','Current Location','Home']);
  const cells=$('tbody tr').first().find('td');
  assert.equal(cells.eq(0).text(),'Alice Example (she/her AL-iss)');assert.equal(cells.eq(1).text(),'Townfolk human');
  assert.equal(cells.eq(2).text(),'the Other Realm');assert.equal(cells.eq(3).text(),'Inn');
  assert.doesNotMatch($('tbody').text(),/Visitor/);
  assert.match(cells.eq(2).find('a').attr('href'),/date=1720-01-01.*campaigns=dufr/);
  assert.match(cells.eq(3).find('a').attr('href'),/date=1720-01-01.*campaigns=dufr/);
  assert.equal($('img,.taelgar-index-grid').length,0);
  const popup=engine.renderIndex('Places/Realm.md','residents','1720-01-01','custom');assert.match(popup,/taelgar-index-grid/);assert.doesNotMatch(popup,/taelgar-index-table/);
  const changed=engine.render('Table','1741-01-01','custom',false,undefined,['dufr']);
  assert.equal(load(changed.html)('tbody tr').first().find('td').eq(2).text(),'Inn, Town');
  assert.equal(load(changed.html)('tbody tr').first().find('td').last().text(),'Inn');
  engine.store.resolve('Places/Other Realm.md').note.metadata.born=9999;
  engine.store.resolve('Places/Inn.md').note.metadata.born=9999;
  const filtered=engine.render('Table','1720-01-01','custom',false,undefined,['dufr']);
  assert.doesNotMatch(filtered.html,/Other Realm|other-realm/);assert.match(filtered.html,/Unknown/);
  assert.equal(load(filtered.html)('tbody tr').first().find('td').last().text(),'Unknown');
  assert.doesNotMatch(searchText(result.html),/Alice|Townfolk|Other Realm/);
});

test('website member tables use current locations and enforce visibility for contextual links',()=>{
  const engine=website({
    'Members.md':'```taelgar-index\ntype: members\ntarget: Guild\nmode: table\n```',
    'Ancestries/Townfolk.md':'---\ntags: [ancestry]\n---',
    'Creatures/Humans.md':'---\ntags: [creature]\n---',
  });
  const render=(date='1720-01-01')=>engine.render('Members',date,'custom',false,undefined,['dufr']);
  const result=render(),$=load(result.html,{},false);
  assert.deepEqual($('th').map((_,el)=>$(el).text()).get(),['Person','Info','Current Location','Home']);
  const cells=$('tbody tr').first().find('td');
  assert.equal(cells.eq(0).text(),'Alice Example (she/her AL-iss)');
  assert.equal(cells.eq(1).text(),'Townfolk human');assert.equal(cells.eq(1).find('a').length,2);
  assert.equal(cells.eq(2).text(),'the Other Realm');
  assert.equal(cells.eq(3).text(),'Inn');
  for(const link of $('tbody a').toArray())assert.match($(link).attr('href'),/date=1720-01-01.*campaigns=dufr/);
  assert.equal($('img,.taelgar-index-grid').length,0);assert.doesNotMatch(result.html,/People\/(Hidden|Future|Campaign Secret)/);
  const popup=engine.render('Groups/Guild.md','1720-01-01','custom',false,undefined,['dufr']);
  assert.equal(load(popup.html)('.taelgar-index-popup summary').text(),'Members');
  assert.doesNotMatch(popup.html,/taelgar-index-table|taelgar-index-count/);
  const popupContent=engine.renderIndex('Groups/Guild.md','members','1720-01-01','custom',false,['dufr']);
  assert.match(load(popupContent)('.taelgar-index-card').first().text(),/Alice Example \(she\/her AL-iss\)/);
  assert.match(load(popupContent)('.taelgar-index-card').first().text(),/Authored prose\./);
  assert.doesNotMatch(load(popupContent)('.taelgar-index-card').first().text(),/Current Location:/);
  assert.doesNotMatch(load(popupContent)('.taelgar-index-card').first().text(),/Home:/);
  const laterLocation=load(render('1721-01-01').html)('tbody tr').first().find('td').eq(2);
  assert.equal(laterLocation.text(),'the Other Realm');
  assert.match(laterLocation.find('a').attr('href'),/date=1721-01-01/);
  for(const path of ['Places/Other Realm.md','Ancestries/Townfolk.md','Creatures/Humans.md'])engine.store.resolve(path).note.metadata.born=9999;
  const hidden=render();assert.doesNotMatch(hidden.html,/Other Realm|other-realm|Townfolk|townfolk|human|Humans/);
  assert.match(hidden.html,/Unknown Unknown/);
  assert.equal(load(hidden.html)('tbody tr').first().find('td').eq(2).text(),'Unknown');
  assert.doesNotMatch(searchText(result.html),/Alice|she\/her|Townfolk|Other Realm/);
});

test('member template text is escaped, and an explicit unknown location renders Unknown',()=>{
  const engine=website({
    'Members.md':'```taelgar-index\ntype: members\ntarget: Guild\nmode: table\n```',
    'People/Alice.md':'---\ntags: [person]\nname: "<img onerror=x>"\npronouns: "<script>"\npronunciation: "& sound"\nancestry: "<b>ancestry</b>"\ntypeOf: "<svg>"\naffiliations: [Guild]\nwhereabouts: [{type: away, location: Inn, end: 1710}, {type: away, location: unknown, start: 1711, end: 1730}]\n---',
  });
  const result=engine.render('Members','1720-01-01','custom'),$=load(result.html,{},false);
  assert.equal($('tbody img,tbody script,tbody b,tbody svg').length,0);
  assert.match($('tbody tr').first().find('td').first().text(),/<img onerror=x> \(<script> & sound\)/);
  const location=$('tbody tr').first().find('td').eq(2);
  assert.equal(location.text(),'Unknown');
  assert.equal(location.find('a').length,0);
});

test('settlement tables use Place, Region, Type Of and Population, shared display rules, and dated region sorting',()=>{
  const engine=website({
    'Settlements.md':'```taelgar-index\ntype: settlements\ntarget: Realm\nmode: table\n```',
    'Places/Alpha.md':'---\ntags: [place]\nwhereabouts: Realm\n---',
    'Places/Zeta.md':'---\ntags: [place]\nwhereabouts: Realm\n---',
    'Places/Z-first.md':'---\ntags: [place]\ntypeOf: settlement\ntypeOfAlias: village\npronunciation: ZED\npopulation: sparse\nwhereabouts: Alpha\n---',
    'Places/A-last.md':'---\ntags: [place]\ntypeOf: settlement\ntypeOfAlias: town\npopulation: 2500\nwhereabouts: Zeta\n---',
  });
  const result=engine.render('Settlements','1720-01-01','custom',false,undefined,['dufr']),$=load(result.html,{},false);
  assert.deepEqual($('th').map((_,el)=>$(el).text()).get(),['Place','Region','Type Of','Population']);
  const rows=$('tbody tr').map((_,el)=>[$(el).find('td').map((_,cell)=>$(cell).text()).get()]).get();
  assert.deepEqual(rows,[['Z-first (ZED)','Alpha','village','sparse'],['Ruin','Realm','settlement','—'],['Town','Realm','town','pop. 1,234'],['A-last','Zeta','town','pop. 2,500']]);
  assert.match($('tbody tr').first().find('td').eq(1).find('a').attr('href'),/date=1720-01-01.*campaigns=dufr/);
  const later=load(engine.render('Settlements','1750-01-01','custom').html,{},false);
  assert.doesNotMatch(later('tbody').text(),/Town/,'a settlement in a different region leaves the query at that date');
  const popup=load(engine.renderIndex('Places/Realm.md','settlements','1720-01-01','custom'),{},false);
  assert.match(popup('.taelgar-index-card').filter((_,el)=>popup(el).find('a[href*="places/z-first"]').length).text(),/Z-first \(ZED\)/);
  engine.store.resolve('Places/Alpha.md').note.metadata.born=9999;
  const hidden=engine.render('Settlements','1720-01-01','custom');
  assert.doesNotMatch(hidden.html,/Alpha|\/alpha/);assert.match(hidden.html,/Z-first.*Unknown/s);
  assert.doesNotMatch(searchText(result.html),/Z-first|sparse|2,500/);
});

test('grid images use lead metadata, omit missing/unsafe images, and include responsive popup thumbnails',()=>{
  const portrait={id:'portraits/alice.png',target:'portraits/alice.png',extension:'.png',note:null,
    image:{width:1200,height:1600,variants:[{url:'/assets/portrait-small.webp',width:270,height:360,inline:true}]}};
  const alice=indexNotes['People/Alice.md'];
  const updatedAlice={...alice,whereabouts:[...alice.whereabouts,{type:'away',start:1741,location:null}]};
  const engine=website({
    'Grid.md':'```taelgar-index\ntype: residents\ntarget: Realm\nmode: grid\n```',
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
  const popup=load(engine.renderIndex('Places/Realm.md','residents','1720-01-01','custom'),{},false);
  assert.equal(popup('img').attr('src'),'/assets/portrait-small.webp');
  assert.match(popup('.taelgar-index-card').first().text(),/Alice Example \(she\/her AL-iss\)/);
  const laterPopup=load(engine.renderIndex('Places/Realm.md','residents','1741-01-01','custom'),{},false);
  assert.equal(laterPopup('.taelgar-index-card .taelgar-index-detail').first().text(),'Current Location: Unknown');
  assert.ok(collectImageUsages(engine.store).has(portrait.id),'frontmatter-only lead images are prepared for publication');
  assert.equal(indexImageTarget([['alice.png']]),'alice.png');assert.equal(indexImageTarget('![[alice.png|Portrait]]'),'alice.png');
  for(const unsafe of ['javascript:alert(1)','data:image/png;base64,abc','https://example.test/alice.png','//example.test/alice.png',{},['one.png','two.png']])assert.equal(indexImageTarget(unsafe),undefined);
  assert.equal(indexImageEntry(engine.store,'./missing/alice.png','People/Bob.md'),undefined,'explicit relative paths cannot silently select a different image');
  assert.equal(indexImageEntry(engine.store,'People/Alice.md','Grid.md'),undefined,'notes cannot become image URLs');
});


test('header existence probes skip row formatting and keep dated membership semantics',()=>{
  const {runtime}=fixture();
  const snapshot={...runtime,coreMeta:new Proxy(runtime.coreMeta,{get(){throw new Error('Formatting should wait for activation');}})};
  assert.equal(indexHasResults(snapshot,{type:'residents',target:'Realm'},{date:'1720-01-01',visible}),true);
  assert.equal(indexHasResults(snapshot,{type:'residents',target:'Realm'},{date:'1750-01-01',visible}),false);
  assert.throws(()=>queryIndex(snapshot,{type:'residents',target:'Realm'},{date:'1720-01-01',visible}),/Formatting should wait/);
});

test('lazy index API filters each reader context, accepts only enabled types, and never caches responses',async()=>{
  const engine=website();
  const url='https://test.invalid/api/index?page=Places/Realm.md&type=residents&context=custom&date=1720-01-01&campaigns=dufr&pov=1';
  const response=await handleRequest(new Request(url),engine),html=await response.text();
  assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.match(html,/Alice Example/);assert.doesNotMatch(html,/Hidden|Campaign Secret|Future|Dead|Visitor/);
  assert.match(html,/campaigns=dufr/);assert.doesNotMatch(html,/pov=1/);
  assert.equal((await handleRequest(new Request(url.replace('type=residents','type=members')),engine)).status,404);
  assert.equal((await handleRequest(new Request('https://test.invalid/api/index'),engine)).status,400);
  assert.equal((await handleRequest(new Request(url,{method:'POST'}),engine)).status,405);
  assert.equal(await (await handleRequest(new Request(url,{method:'HEAD'}),engine)).text(),'');
  engine.campaignSites.forHost=host=>host==='party.test' ? {host:'party',contextId:'custom',date:'1720-01-01',campaigns:['dufr'],enforcePoV:true} : undefined;
  const locked=await handleRequest(new Request(url.replace('test.invalid','party.test').replace('1720-01-01','1750-01-01').replace('campaigns=dufr','campaigns=none').replace('pov=1','pov=0')),engine);
  assert.equal(locked.status,200);const lockedHTML=await locked.text();
  assert.match(lockedHTML,/Alice Example/);assert.doesNotMatch(lockedHTML,/Campaign Secret/);
  assert.match(lockedHTML,/date=1720-01-01/);
  engine.store.resolve('Places/Realm.md').note.metadata.born=9999;
  assert.equal((await handleRequest(new Request(url),engine)).status,404);
});


test('rivers include lakes and waterways with watershed secondary locations, recursive and dated scope',()=>{
  const {runtime}=fixture(featureIndexNotes),options={type:'rivers',target:'Basin'},context={date:'1720-01-01',visible:page=>page.metadata.born!==9999};
  assert.deepEqual(headerIndexes(['rivers','places','rivers']),['rivers','places']);
  for(const type of ['rivers','places'])assert.equal(parseIndex('type: '+type).recursive,true);
  const rivers=queryIndex(runtime,options,context);
  assert.deepEqual(paths(rivers),['Places/Brook.md','Places/Lake.md','Places/River.md']);
  assert.equal(rivers.items[2].placeType,'river');assert.equal(rivers.items[2].pronunciation,'RIV-er');
  assert.deepEqual(paths(queryIndex(runtime,{...options,recursive:false},context)),['Places/Lake.md','Places/River.md']);
  assert.equal(indexHasResults(runtime,options,context),true);
  assert.deepEqual(paths(queryIndex(runtime,{...options,target:'Town'},context)),[]);
  assert.ok(paths(queryIndex(runtime,options,{...context,date:'1760-01-01'})).includes('Places/Future River.md'));
  assert.throws(()=>queryIndex(runtime,{type:'rivers',target:'Guild'},context),/place/);
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
  const {runtime}=fixture(extra),options={type:'rivers',target:'Drainage Basin'},context={date:'1720-01-01',visible:page=>page.metadata.born!==9999};
  const result=paths(queryIndex(runtime,options,context));
  for(const name of ['Lake','Secondary Lake','Nested Lake','Ruined Lake'])assert.ok(result.includes('Places/'+name+'.md'),name);
  for(const name of ['Future Lake','Hidden Lake','Sea','Lake Named Sea'])assert.ok(!result.includes('Places/'+name+'.md'),name);
  assert.ok(!paths(queryIndex(runtime,{...options,recursive:false},context)).includes('Places/Nested Lake.md'));
  assert.ok(paths(queryIndex(runtime,options,{...context,date:'1760-01-01'})).includes('Places/Future Lake.md'));
  assert.equal(indexHasResults(runtime,{type:'rivers',target:'Lake'},context),true,'a lake alone can enable the header button');
});

test('places include only contained place notes, including town quarters and their buildings',()=>{
  const {runtime}=fixture(featureIndexNotes),context={date:'1720-01-01',visible:page=>page.metadata.born!==9999};
  const places=queryIndex(runtime,{type:'places',target:'Old Town'},context);
  assert.deepEqual(paths(places),['Places/Quarter.md','Places/Inn.md','Places/Shop.md','Places/Temple.md']);
  assert.deepEqual(paths(queryIndex(runtime,{type:'places',target:'Town',recursive:false},context)),['Places/Quarter.md','Places/Inn.md','Places/Temple.md']);
  assert.ok(!paths(places).some(path=>path.startsWith('People/') || path.startsWith('Groups/')));
  assert.equal(indexHasResults(runtime,{type:'places',target:'Inn'},context),false);
});

test('Places built and natural filters use canonical types and traverse ancestors of either category',()=>{
  const {runtime}=fixture({...featureIndexNotes,
    'Places/Wood.md':{tags:['place'],typeOf:'forest',whereabouts:'Town'},
    'Places/Hill.md':{tags:['place'],typeOf:'topographical feature',whereabouts:'Quarter'},
    'Places/Pond.md':{tags:['place'],typeOf:'lake',whereabouts:'Town'},
    'Places/Shrine.md':{tags:['place'],typeOf:'holy site',whereabouts:'Wood'},
    'Places/Bridge.md':{tags:['place'],typeOf:'infrastructure',destroyed:1710,whereabouts:'Town'},
    'Places/Market.md':{tags:['place'],typeOf:'building',typeOfAlias:'forest',whereabouts:'Town'},
    'Places/Unknown.md':{tags:['place'],whereabouts:'Town'},
    'Places/Portal.md':{tags:['place'],typeOf:'planar link',whereabouts:'Town'},
    'Places/Hidden Forest.md':{tags:['place'],typeOf:'forest',born:9999,whereabouts:'Town'},
    'Places/Future Forest.md':{tags:['place'],typeOf:'forest',created:1760,whereabouts:'Town'},
  });
  const options={type:'places',target:'Town'},context={date:'1720-01-01',visible:page=>page.metadata.born!==9999};
  const all=paths(queryIndex(runtime,options,context)),built=paths(queryIndex(runtime,{...options,placeType:'built'},context)),natural=paths(queryIndex(runtime,{...options,placeType:'natural'},context));
  assert.deepEqual(new Set(built),new Set(['Quarter','Inn','Shop','Temple','Shrine','Bridge','Market'].map(name=>'Places/'+name+'.md')));
  assert.deepEqual(new Set(natural),new Set(['Wood','Hill','Pond'].map(name=>'Places/'+name+'.md')));
  assert.ok(all.includes('Places/Unknown.md'));assert.ok(all.includes('Places/Portal.md'),'unfiltered queries keep unclassified and extraplanar places');
  assert.ok(!paths(queryIndex(runtime,{...options,placeType:'built',recursive:false},context)).includes('Places/Shrine.md'));
  assert.ok(!paths(queryIndex(runtime,{...options,placeType:'natural',recursive:false},context)).includes('Places/Hill.md'));
  assert.ok(paths(queryIndex(runtime,{...options,placeType:'natural'},{...context,date:'1760-01-01'})).includes('Places/Future Forest.md'));
  assert.equal(indexHasResults(runtime,{type:'places',target:'Wood',placeType:'built'},context),true);
  assert.equal(indexHasResults(runtime,{type:'places',target:'Wood',placeType:'natural'},context),false);
  assert.throws(()=>queryIndex(runtime,{...options,placeType:'all'},context),/placeType/);
  assert.throws(()=>queryIndex(runtime,{type:'rivers',target:'Town',placeType:'built'},context),/only supported/);
});

test('website Places filters apply independently in grids and tables with contextual links',()=>{
  const engine=website({...indexSources(featureIndexNotes),
    'Places/Wood.md':'---\ntags: [place]\ntypeOf: forest\nwhereabouts: Quarter\n---',
    'Places/Hidden Wood.md':'---\ntags: [place]\ntypeOf: forest\nwhereabouts: Town\nborn: 9999\n---',
    'Places/Future Wood.md':'---\ntags: [place]\ntypeOf: forest\nwhereabouts: Town\ncreated: 1760\n---',
    'Built.md':'```taelgar-index\ntype: places\ntarget: Town\nplaceType: built\nmode: table\n```',
    'Natural.md':'```taelgar-index\ntype: places\ntarget: Town\nplaceType: natural\n```',
  });
  const built=load(engine.render('Built','1720-01-01','custom',false,undefined,['dufr']).html,{},false);
  assert.match(built('tbody').text(),/Shop/);assert.doesNotMatch(built('tbody').text(),/Wood/);
  const natural=load(engine.render('Natural','1720-01-01','custom',false,undefined,['dufr']).html,{},false);
  assert.equal(natural('.taelgar-index-card').length,1);assert.equal(natural('.taelgar-index-link').text(),'Wood');
  assert.match(natural('.taelgar-index-link').attr('href'),/date=1720-01-01.*campaigns=dufr/);
});

test('rivers and places render compact tables, lazy website buttons, and context-filtered API grids',async()=>{
  const engine=website({...indexSources(featureIndexNotes),
    'River Table.md':'```taelgar-index\ntype: rivers\ntarget: Basin\nmode: table\n```',
    'Places Table.md':'```taelgar-index\ntype: places\ntarget: Town\nmode: table\n```',
  });
  for(const [type,page,target,firstHeading,expected,excluded] of [
    ['rivers','River Table','Basin','River','Main River','Hidden River'],
    ['places','Places Table','Town','Place','Shop','Hidden Building'],
  ]) {
    const table=load(engine.render(page,'1720-01-01','custom').html,{},false);
    assert.deepEqual(table('th').map((_,cell)=>table(cell).text()).get(),[firstHeading,'Type Of']);
    assert.match(table('tbody').text(),new RegExp(expected));assert.doesNotMatch(table('tbody').text(),new RegExp(excluded+'|Future'));
    if(type==='rivers')assert.match(table('tbody').text(),/Lake/);
    const header=load(engine.render('Places/'+target+'.md','1720-01-01','custom').html,{},false);
    assert.equal(header('.taelgar-index-popup summary').text(),type==='rivers'?'Rivers':'Places');
    assert.equal(header('.taelgar-index-card').length,0);
    const response=await handleRequest(new Request('https://test.invalid'+header('.taelgar-index-popup').attr('data-index-url')),engine);
    assert.equal(response.status,200);const grid=await response.text();
    assert.match(grid,new RegExp(expected));assert.doesNotMatch(grid,new RegExp(excluded+'|Future'));
    if(type==='rivers')assert.match(grid,/Lake/);
    assert.match(grid,/taelgar-index-card/);
  }
});

test('website residents include notes with future POV metadata and still exclude future births',()=>{
  const engine=website({'People/Perspective.md':'---\ntags: [person]\nwhereabouts: Town\nPOV: 1800\n---\nVisible perspective.'});
  const grid=engine.renderIndex('Places/Realm.md','residents','1720-01-01','custom',false,['dufr']);
  assert.match(grid,/Perspective/);assert.doesNotMatch(grid,/People\/Future/);
});
