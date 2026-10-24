import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {headerFixture} from './helpers/header-fixture.mjs';
import {indexNotes,featureIndexNotes,indexSources} from './fixtures/indexes.mjs';
import {registryDocument,indexRegistry} from './helpers/index-registry.mjs';
import {compileIndexRegistry,parseIndexRegistry,parseIndex,resolveIndex} from '../src/index-registry.mjs';
import {readIndexRegistry} from '../src/index-registry-node.mjs';
import {matchIndexField,metadataValues,validateIndexCondition} from '../src/index-fields.mjs';
import {indexColumns,indexCards,hydrateIndexItem,indexNeedsContent} from '../src/index-columns.mjs';
import {queryIndex,indexHasResults,headerIndexesForMetadata} from '../src/indexes.mjs';
import {indexView} from '../src/index-view.mjs';
import {indexImageTarget,indexImageEntry} from '../src/index-images.mjs';
import {indexMarkdown} from '../src/static-markdown.mjs';
import {ContentStore,parseNote} from '../src/content-store.mjs';
import {RenderEngine} from '../src/render-engine.mjs';
import {renderHeader,renderBio} from '../src/header-core/index.mjs';
import {handleRequest} from '../src/application.mjs';
import {targetPath} from '../src/common.mjs';
const fence=String.fromCharCode(96).repeat(3);
const visible=page=>!page.metadata.excludePublish && !page.path.includes('POV Secret');
const fixture=extraNotes=>headerFixture({baseNotes:{...indexNotes,...featureIndexNotes},extraNotes});
const paths=result=>result.items.map(item=>item.path);
const query=(index,target,extra={},notes={},registry=indexRegistry)=>queryIndex(fixture(notes).runtime,{index,...(target?{target}:{}),...extra},{date:'1720-01-01',sourcePath:'Places/Realm.md',indexRegistry:registry,visible});
const derived=(where,rest={})=>compileIndexRegistry({version:1,indexes:{custom:{label:'Custom',where,...rest}}});
test('base definitions compile and invocations reject removed type syntax',()=>{
  assert.equal(parseIndex('index: members',indexRegistry).cards.image,true);
  for(const source of ['[]','type: members','index: missing','index: members\nwhere: {}','index: members\nrecursive: true','index: members\nmembership: historical','index: members\nmode: list'])assert.throws(()=>parseIndex(source,indexRegistry));
  assert.throws(()=>parseIndexRegistry('version: 2'),/version/);
  assert.throws(()=>parseIndexRegistry('version: 1\nhosts:\n  browser: {}'),/hosts/);
});
test('extends inherits only ANDed conditions and columns',()=>{
  const registry=compileIndexRegistry({version:1,indexes:{
    base:{label:'Base',where:{field:'page.kind',eq:'place'},columns:['name','region'],mode:'table',cards:{image:false},target:'Elsewhere',sort:[{field:'page.path'}],header:{mode:'table'}},
    child:{extends:'base',label:'Child',where:{field:'life.exists',eq:true}},
  }});
  const options=resolveIndex(registry,{index:'child'});
  assert.equal(options.where.all.length,2);assert.equal(options.mode,'grid');assert.equal(options.cards.image,true);
  assert.equal(options.target,undefined);assert.equal(options.sort.length,0);assert.equal(options.header.mode,'grid');
  assert.deepEqual(options.columns.map(c=>c.label),['Name','Region']);
  assert.throws(()=>compileIndexRegistry({version:1,indexes:{a:{extends:'b'},b:{extends:'a'}}}),/cycle/);
  assert.throws(()=>compileIndexRegistry({version:1,indexes:{a:{extends:'missing'}}}),/parent/);
});
test('host and profile patches apply in order; card positions and arrays replace',()=>{
  const base={version:1,indexes:{x:{label:'Base',where:{field:'page.kind',eq:'person'},columns:['name'],cards:{body:{template:'base'},footer:'home'}}},
    hosts:{website:{indexes:{x:{label:'Website',cards:{body:['info']}}}}}};
  const overlay={indexes:{x:{label:'Personal',columns:['person'],cards:{body:{field:'metadata.species'}}}},
    hosts:{website:{indexes:{x:{label:'Personal website',cards:{footer:null}}}}}};
  const options=resolveIndex(compileIndexRegistry(base,overlay),{index:'x'});
  assert.equal(options.label,'Personal website');assert.deepEqual(options.columns.map(c=>c.label),['Person']);
  assert.deepEqual(options.cards.body,[{field:'metadata.species',empty:''}]);assert.deepEqual(options.cards.footer,[]);
  assert.equal(resolveIndex(compileIndexRegistry(base,overlay,{host:'obsidian'}),{index:'x'}).label,'Personal');
  assert.equal(compileIndexRegistry(base).indexes.x.label,'Website');assert.ok(Object.isFrozen(compileIndexRegistry(base).indexes.x));
});
test('filters are flat and permit one relationship',()=>{
  for(const condition of [{any:[]},{not:{}},{all:[]},{all:[{all:[{field:'page.kind',eq:'place'}]}]},
    {field:'metadata.x',eq:1,ne:2},{field:'life.alive',eq:true},{field:'location.home',eq:'Town'},
    {field:'metadata.constructor.x',eq:1},{field:'metadata.x',contains:'a'},
    {all:[{relation:'home',within:'$target'},{relation:'affiliation',target:'Guild'}]},
    {relation:'homeOrIn',within:'$target'},{relation:'affiliation',target:'Guild',state:'historical'}])assert.throws(()=>validateIndexCondition(condition));
  assert.throws(()=>compileIndexRegistry({version:1,indexes:{a:{label:'A',where:{relation:'home',within:'$target'}},b:{label:'B',extends:'a',where:{relation:'watershed',within:'$target'}}}}),/one relationship/);
});
test('scalar comparisons support lists, coercion, exact paths and missing values',()=>{
  assert.equal(matchIndexField({field:'metadata.x',eq:'DWARF'},['dwarf']),true);
  assert.equal(matchIndexField({field:'page.path',eq:'People/a.md'},['people/a.md']),false);
  assert.equal(matchIndexField({field:'metadata.x',eq:'2'},[2]),false);
  assert.equal(matchIndexField({field:'metadata.x',as:'text',eq:'2'},[2]),true);
  assert.equal(matchIndexField({field:'metadata.x',as:'number',gt:10000},['10001']),true);
  assert.equal(matchIndexField({field:'metadata.x',as:'number',ne:2},['bad']),false);
  assert.equal(matchIndexField({field:'metadata.x',ne:'2'},[2]),false);
  for(const value of [false,0])assert.equal(matchIndexField({field:'metadata.x',exists:true},[value]),true);
  for(const values of [[],[''],[null],[undefined]])assert.equal(matchIndexField({field:'metadata.x',ne:2},values),false);
  assert.equal(matchIndexField({field:'metadata.x',in:['a','b']},['c','B']),true);
  assert.deepEqual(metadataValues({nested:{x:[1,'two',{},false]}},['nested','x']),[1,'two',false]);
  assert.deepEqual(metadataValues({nested:[{x:1}]},['nested','x']),[]);
});
test('the six core queries use the actual base definitions',()=>{
  const notes={'People/Dwarf.md':{tags:['person'],species:'dwarf',whereabouts:'Town'},
    'People/Former.md':{tags:['person'],affiliations:[{org:'Guild',end:'1710-01-01'}]},
    'Places/City.md':{tags:['place'],typeOf:'settlement',population:'10001',whereabouts:'Realm'},
    'Places/Small.md':{tags:['place'],typeOf:'settlement',population:10000,whereabouts:'Realm'}};
  assert.deepEqual(paths(query('settlements-in','Realm',{},notes)),['Places/City.md','Places/Ruin.md','Places/Small.md','Places/Town.md']);
  assert.deepEqual(paths(query('major-cities',undefined,{},notes)),['Places/City.md']);
  assert.deepEqual(paths(query('dwarven-residents','Realm',{},notes)),['People/Dwarf.md']);
  assert.deepEqual(paths(query('family-members','Guild',{},notes)),['People/Alice.md','People/Bob.md','People/Dead.md']);
  assert.deepEqual(paths(query('current-members','Guild',{},notes)),['People/Alice.md','People/Bob.md']);
  assert.deepEqual(paths(query('waterways-in-watershed','Basin',{},notes)),['Places/Brook.md','Places/Lake.md','Places/River.md']);
});
test('home follows dated homes and partOf without travel or secondary fallbacks',()=>{
  assert.deepEqual(paths(query('residents','Realm')),['People/Alice.md','People/Bob.md']);
  const notes={'Places/Travel.md':{tags:['place'],whereabouts:[{type:'away',location:'Realm',end:'1710-01-01'}]},
    'Places/Secondary.md':{tags:['place'],whereabouts:[{type:'home',location:'Other Realm'},{type:'secondary',location:'Realm'}]},
    'Places/Part.md':{tags:['place'],partOf:'Town'}};
  const found=paths(query('places-in','Realm',{},notes));
  assert.ok(found.includes('Places/Part.md'));assert.ok(!found.includes('Places/Travel.md'));assert.ok(!found.includes('Places/Secondary.md'));
  const direct=derived({all:[{field:'page.kind',eq:'place'},{relation:'home',within:'$target'}]});
  assert.ok(!paths(query('custom','Realm',{},notes,direct)).includes('Places/Inn.md'));
  assert.deepEqual(paths(queryIndex(fixture().runtime,{index:'residents',target:'Realm'},{date:'1750-01-01',indexRegistry,visible})),[]);
});
test('affiliation states use explicit intervals, including deceased members and repeated roles',()=>{
  const notes={'People/Left.md':{tags:['person'],affiliations:[{org:'Guild',start:1700,end:'1710-01-01'}]},
    'People/Not Joined.md':{tags:['person'],affiliations:[{org:'Guild',start:1730}]},
    'People/Multiple.md':{tags:['person'],died:1710,affiliations:[{org:'Guild',title:'Old',end:1700},{org:'Guild',title:'New',start:1701}]}};
  const result=query('members','Guild',{},notes);
  assert.ok(paths(result).includes('People/Dead.md'));assert.ok(paths(result).includes('People/Multiple.md'));
  assert.ok(!paths(result).includes('People/Left.md'));assert.ok(!paths(result).includes('People/Not Joined.md'));
  assert.equal(result.items.find(i=>i.path==='People/Multiple.md').cells[1].join(''),'New');
  assert.equal(result.items.find(i=>i.path==='People/Alice.md').cells[3].join(''),'—');
  const former=derived({relation:'affiliation',target:'$target',state:'former'},{columns:['name','left']});
  assert.deepEqual(paths(query('custom','Guild',{},notes,former)),['People/Left.md','People/Multiple.md']);
  const recursive=structuredClone(registryDocument);recursive.indexes.members.where.all[2].recursive=true;
  assert.ok(paths(query('members','Guild',{},notes,compileIndexRegistry(recursive))).includes('People/Chapter Member.md'));
});
test('life exists includes ended notes while active requires a start by the selected date',()=>{
  const notes={'People/Future End.md':{tags:['person'],born:1760,died:1800,affiliations:['Guild']}};
  assert.ok(!paths(query('current-members','Guild',{},notes)).includes('People/Future End.md'));
  assert.ok(paths(query('settlements-in','Realm')).includes('Places/Ruin.md'));
  assert.ok(!paths(query('residents','Realm')).includes('People/Dead.md'));
});
test('partial intervals include the full year/month independent of YAML quoting',()=>{
  const reg=derived({all:[{field:'page.kind',eq:'person'},{field:'life.active',eq:true}]});
  const snapshot=headerFixture({baseNotes:{'Year.md':{tags:['person'],born:'1720',died:'1720'},'Month.md':{tags:['person'],born:'1720-02',died:'1720-02'}}}).runtime;
  for(const date of ['1720-02-01','1720-02-28'])assert.deepEqual(paths(queryIndex(snapshot,{index:'custom'},{date,indexRegistry:reg})),['Month.md','Year.md']);
  assert.deepEqual(paths(queryIndex(snapshot,{index:'custom'},{date:'1720-03-01',indexRegistry:reg})),['Year.md']);
});
test('region skips immediate home, accepts realms and falls back to Taelgar',()=>{
  const snapshot=headerFixture({baseNotes:{'World.md':{tags:['place'],typeOf:'realm'},'Barony.md':{tags:['place'],typeOf:'realm',whereabouts:'World'},
    'City.md':{tags:['place'],whereabouts:'Barony'},'Inn.md':{tags:['place'],whereabouts:'City'},'Rootless.md':{tags:['place'],whereabouts:'Lost'}}}).runtime;
  const reg=derived({field:'page.kind',eq:'place'},{columns:['name','region']});
  const result=queryIndex(snapshot,{index:'custom'},{date:'1720-01-01',indexRegistry:reg});
  const region=name=>result.items.find(i=>i.path===name+'.md').cells[1][0];
  assert.equal(region('Inn').name,'Barony');assert.equal(region('City').name,'World');
  assert.equal(region('Barony').name,'Taelgar');assert.equal(region('Rootless').name,'Taelgar');
  const hidden=queryIndex(snapshot,{index:'custom'},{date:'1720-01-01',indexRegistry:reg,visible:p=>p.path!=='Barony.md'});
  assert.equal(hidden.items.find(i=>i.path==='Inn.md').cells[1][0],'Unknown');
});
test('display fields, templates, boolean icons and cards share an evaluator',()=>{
  const result=query('family-members','Guild',{columns:['name',{label:'Species',field:'metadata.species'},{label:'Dead',field:'life.active',format:'boolean',trueText:'',falseText:'💀'}],
    cards:{image:false,title:'name',subtitle:null,body:{template:'<ancestry> <maintype>'},footer:{field:'life.active',format:'boolean',trueText:'',falseText:'💀'}}});
  for(const item of result.items)hydrateIndexItem(item);
  assert.equal(result.items[0].cells[2][0],'');assert.equal(result.items.at(-1).cells[2][0],'💀');
  assert.equal(result.items[0].card.footer.length,0);assert.equal(result.items.at(-1).card.footer[0][0],'💀');
  assert.match(indexView(result,item=>item.name,'table'),/Dead<\/th>/);assert.match(indexMarkdown(result),/\| Name \| Species \| Dead \|/);
  assert.equal(indexNeedsContent(resolveIndex(indexRegistry,{index:'members'}),'firstSentence'),true);
  assert.equal(indexNeedsContent(resolveIndex(indexRegistry,{index:'members',mode:'table'}),'firstSentence'),false);
  assert.equal(indexNeedsContent(resolveIndex(indexRegistry,{index:'members',mode:'table',columns:['image','firstSentence']}),'image'),true);
});
test('typed sorting puts missing values last in both directions and sorts dates by first day',()=>{
  const notes={'Z.md':{tags:['place'],population:50},'A.md':{tags:['place'],population:'100'}};
  const reg=derived({field:'page.kind',eq:'place'},{sort:[{field:'metadata.population',format:'number',direction:'desc'}]});
  const found=paths(query('custom',undefined,{},notes,reg));
  assert.ok(found.indexOf('A.md')<found.indexOf('Z.md'));assert.ok(found.indexOf('Z.md')<found.indexOf('Places/Inn.md'));
  const dates=derived({field:'page.kind',eq:'person'},{sort:[{field:'life.end',format:'date'}]});
  const snapshot=headerFixture({baseNotes:{'Z.md':{tags:['person'],died:'1720'},'A.md':{tags:['person'],died:'1720-02-01'},'B.md':{tags:['person']}}}).runtime;
  assert.deepEqual(paths(queryIndex(snapshot,{index:'custom'},{date:'1730-01-01',indexRegistry:dates})),['Z.md','A.md','B.md']);
});
test('display validation limits fields/formats and requires a card title',()=>{
  for(const value of [[],['place'],[{label:'X',field:'life.alive'}],[{label:'X',field:'metadata.__proto__.x'}],[{label:'X',field:'metadata.x',format:'html'}],
    [{field:'metadata.x'}],[{label:'X',field:'metadata.x',template:'<name>'}],[{label:'X',template:'<name>',format:'text'}]])assert.throws(()=>indexColumns(value));
  assert.throws(()=>indexCards({fields:['name']}));assert.throws(()=>indexCards({title:[]}));assert.throws(()=>indexCards({image:'yes'}));
  assert.throws(()=>indexColumns(['role'],{membership:false}),/affiliation/);assert.deepEqual(indexCards({body:null,footer:[]}).body,[]);
});
test('cycles are bounded and existence probes skip display evaluation',()=>{
  assert.equal(query('places-in','Realm',{}, {'Loop.md':{tags:['place'],whereabouts:'Loop'},'Child.md':{tags:['place'],whereabouts:'Loop'}}).warnings.length,1);
  const options=resolveIndex(indexRegistry,{index:'members',target:'Guild'});options.columns=[{template:'<bad>'}];
  assert.equal(indexHasResults(fixture().runtime,options,{date:'1720-01-01',indexRegistry,visible}),true);
});
test('header rules combine in order and explicit IDs replace automatic rules',()=>{
  const registry=compileIndexRegistry({...registryDocument,hosts:{},headerRules:{a:{when:{field:'page.kind',eq:'group'},indexes:['members']},b:{when:{field:'metadata.featured',eq:true},indexes:['members','current-members']}}});
  assert.deepEqual(headerIndexesForMetadata({tags:['group'],featured:true},registry),['members','current-members']);
  assert.deepEqual(headerIndexesForMetadata({tags:['group'],indexes:[]},registry),[]);
  assert.deepEqual(headerIndexesForMetadata({indexes:['current-members','current-members']},registry),['current-members']);
  assert.throws(()=>headerIndexesForMetadata({indexes:['unknown']},registry),/Unknown/);
  assert.throws(()=>compileIndexRegistry({version:1,indexes:{},headerRules:{a:{when:{relation:'home',within:'x'},indexes:[]}}}),/relationship/);
});
test('node loading supports absent default, selected files and a personal profile',t=>{
  const dir=fs.mkdtempSync(path.join(process.env.TEMP || '.','index-registry-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  assert.deepEqual(readIndexRegistry({vault_dir:dir}).files,[]);
  assert.throws(()=>readIndexRegistry({vault_dir:dir,index_registry:'missing.yaml'}),/missing/);
  assert.throws(()=>readIndexRegistry({vault_dir:dir,index_registry:'../outside.yaml'}),/escapes/);
  fs.mkdirSync(path.join(dir,'_scripts'));fs.writeFileSync(path.join(dir,'_scripts/indexes.yaml'),fs.readFileSync(new URL('../examples/indexes.yaml',import.meta.url)));
  fs.writeFileSync(path.join(dir,'profile.yaml'),'indexes:\n  members: {label: Personal}\n');
  assert.equal(readIndexRegistry({vault_dir:dir,index_override:'profile.yaml'}).registry.indexes.members.label,'Personal');
});
function engineFixture() {
  const {input,runtime}=fixture(),sources=indexSources(featureIndexNotes);
  sources['Guide.md']='# Guide\n\n'+fence+'taelgar-index\nindex: members\ntarget: Guild\nmode: table\ncolumns: [person, firstSentence, image]\n'+fence;
  const entries=Object.entries(sources).map(([id,source])=>({id,target:targetPath(id),slug:targetPath(id).slice(0,-3),name:id.split('/').at(-1).slice(0,-3),title:id.split('/').at(-1).slice(0,-3),note:parseNote(source)}));
  entries.push({id:'portraits/alice.png',target:'portraits/alice.png',extension:'.png',note:null});
  const settings={default_date:'1720-01-01',campaigns:[]},store=new ContentStore(entries,[],settings);store.indexRegistry=indexRegistry;
  return {engine:new RenderEngine({settings,store,headers:runtime,renderHeader,renderBio,homeSource:null,navigationSource:null}),store,input};
}
test('website tables render selected content and API validates configured IDs',async()=>{
  const {engine}=engineFixture(),result=engine.render('Guide','1720-01-01');
  assert.match(result.html,/Description<\/th>/);assert.match(result.html,/Authored prose/);assert.match(result.html,/taelgar-index-image/);
  const response=await handleRequest(new Request('https://test/api/index?page=Groups/Guild.md&index=members&date=1720-01-01'),engine);
  assert.equal(response.status,200);assert.match(await response.text(),/Treasurer/);
  assert.equal((await handleRequest(new Request('https://test/api/index?page=Groups/Guild.md&index=residents&date=1720-01-01'),engine)).status,404);
  assert.equal((await handleRequest(new Request('https://test/api/index?page=Groups/Guild.md&type=members'),engine)).status,400);
});
test('empty header buttons respect hideWhenEmpty and disabled definitions',()=>{
  const {engine,store}=engineFixture();
  store.indexRegistry=compileIndexRegistry(registryDocument,{indexes:{members:{where:{all:[{field:'metadata.never',eq:true},{relation:'affiliation',target:'$target'}]},columns:['name'],cards:{title:'name',subtitle:null,body:null},header:{hideWhenEmpty:false,mode:'table'}}}});
  assert.match(engine.render('Groups/Guild.md','1720-01-01').html,/data-index="members"/);
  assert.match(engine.renderIndex('Groups/Guild.md','members','1720-01-01'),/No members found/);
  store.indexRegistry=compileIndexRegistry(registryDocument,{indexes:{members:{enabled:false}}});
  assert.doesNotMatch(engine.render('Groups/Guild.md','1720-01-01').html,/data-index="members"/);
});

test('unknown prototype names cannot bypass named lookup and disabled sparse definitions stay hidden',()=>{
  assert.throws(()=>parseIndex('index: constructor',indexRegistry),/Unknown named/);
  const registry=compileIndexRegistry({version:1,indexes:{off:{enabled:false,columns:['role']}}});
  assert.equal(resolveIndex(registry,{index:'off'}).enabled,false);
  assert.deepEqual(paths(query('off',undefined,{}, {},registry)),[]);
});
test('a selected profile can add new definitions and inherit the patched parent',()=>{
  const registry=compileIndexRegistry(registryDocument,{indexes:{
    members:{columns:['person','status']},
    local:{extends:'members',label:'Local members',where:{field:'metadata.species',eq:'human'}},
  }},{host:'obsidian'});
  const options=resolveIndex(registry,{index:'local'},{host:'obsidian'});
  assert.deepEqual(options.columns.map(c=>c.label),['Person','Status']);
  assert.equal(options.where.all.length,4);
  assert.deepEqual(paths(query('local','Guild',{}, {},registry)),['People/Alice.md']);
});
test('tags are scalar lists without leading hash and text output stays escaped',()=>{
  const registry=derived({field:'page.tags',eq:'person/special'},{columns:['name',{label:'Value',field:'metadata.value'}]});
  const result=query('custom',undefined,{}, {'Tags.md':{tags:['#person/special'],value:'<script>alert(1)</script>'}},registry);
  assert.deepEqual(paths(result),['Tags.md']);
  assert.match(indexView(result,item=>item.name,'table'),/&lt;script&gt;/);
  assert.doesNotMatch(indexView(result,item=>item.name,'table'),/<script>/);
});
test('documented complete bases and derived queries compile together',()=>{
  const source=fs.readFileSync(new URL('../docs/index-registry-proposal.md',import.meta.url),'utf8');
  const base=source.split('### Complete base definitions')[1].split(fence+'yaml\n')[1].split(fence)[0];
  const derived=source.split('### Derived definitions for the six core queries')[1].split(fence+'yaml\n')[1].split(fence)[0];
  const registry=compileIndexRegistry(parseIndexRegistry(base),parseIndexRegistry(derived,{overlay:true}));
  assert.equal(Object.keys(registry.indexes).length,10);
});
test('image sources reject remote URLs and ambiguous local names',()=>{
  assert.equal(indexImageTarget('https://example.test/image.png'),undefined);
  assert.equal(indexImageTarget('//example.test/image.png'),undefined);
  assert.equal(indexImageTarget([[['photo.png']]]),'photo.png');
  const entries=['A/photo.png','B/photo.png'].map(id=>({id,target:id,extension:'.png',note:null}));
  const store=new ContentStore(entries,[],{});
  assert.equal(indexImageEntry(store,'photo.png','Guide.md'),undefined);
  assert.equal(indexImageEntry(store,'./photo.png','A/Guide.md').id,'A/photo.png');
});
