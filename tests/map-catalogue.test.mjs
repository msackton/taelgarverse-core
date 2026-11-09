import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from 'cheerio';
import {ContentStore,parseNote} from '../src/content-store.mjs';
import {RenderEngine} from '../src/render-engine.mjs';
import {createHeaderSnapshot} from '../src/header-core/index.mjs';
import {handleRequest} from '../src/application.mjs';
import {compileRuntime} from '../scripts/compile-runtime.mjs';
import {buildBacklinkIndex} from '../src/backlinks.mjs';
import {createWorker} from '../src/worker-handler.mjs';
import {headerFixture} from './helpers/header-fixture.mjs';
import {Bucket} from './helpers/page-cache-fixture.mjs';
import MarkdownIt from 'markdown-it';

const fence=(data,type='taelgar-map')=>'```'+type+'\n'+(typeof data==='string'?data:JSON.stringify(data))+'\n```';
const block=(id,extra={})=>({version:2,id,source:'[[assets/world.map.json]]',crop:{x:1010,y:2020,width:300,height:200},...extra});
const revision='a'.repeat(64);
function fixture({body=fence(block('world')),extraNotes={},home=null,campaignHomes={}}={}){
  const settings={default_date:'1748-01-01',campaigns:[]},registry={campaigns:{frontier:{code:'dufr',name:'Frontier'}}};
  const notes={'Maps.md':body,'Session.md':'---\ntags: [session-note]\ncampaign: dufr\nDR: 1745-01-01\n---\nSession',...extraNotes};
  const entries=Object.entries(notes).map(([id,source])=>({id,name:id.slice(0,-3),title:id.slice(0,-3),extension:'.md',target:id.toLowerCase(),slug:id.slice(0,-3).toLowerCase(),note:parseNote(source)}));
  entries.push({id:'assets/world.map.json',target:'assets/world.map.json',extension:'.json',mapManifest:{version:2,image:'world.png',sourceOffset:[1000,2000]}},
    {id:'assets/world.png',target:'assets/world.png',extension:'.png',sha256:'b'.repeat(64),mapImageInfo:{format:'png',width:640,height:480},mapTiles:[{bounds:[[0,0],[480,640]],baseUrl:'/assets/tiles/world',width:640,height:480,tileSize:512,minNativeZoom:-2,maxNativeZoom:0}]});
  const store=new ContentStore(entries,[],settings),coreMeta=headerFixture().input.coreMeta;
  const headers=createHeaderSnapshot({pages:entries.filter(e=>e.note).map(e=>({path:e.id,metadata:e.note.metadata})),coreMeta,registry});
  const engine=new RenderEngine({settings,store,headers,homeSource:home,campaignHomes});
  const index={entries,settings,registry,coreMeta,warnings:[],backlinks:buildBacklinkIndex(store),navigationSource:null,homeSource:home,campaignHomes};
  return {engine,store,index};
}
const request=(engine,path='/api/maps',origin='https://taelgar.org')=>handleRequest(new Request(new URL(path,origin)),engine,{revision});
async function catalogue(engine,path='/api/maps',origin){const response=await request(engine,path,origin);assert.equal(response.status,200,await response.clone().text());return response.json();}

test('catalogue resolves original map definitions with unchanged calibration, crops and tiles',async()=>{
  const {engine}=fixture();
  const list=await catalogue(engine);assert.equal(list.version,1);assert.equal(list.revision,revision);assert.equal(list.total,1);
  const summary=list.maps[0];assert.equal(summary.config,undefined);assert.equal(summary.preview,'https://taelgar.org/assets/assets/world.png');
  assert.deepEqual(summary.coordinates,{frame:'photoshop-pixels',sourceOffset:[1000,2000],unit:'miles'});
  const detail=await catalogue(engine,'/api/maps?id='+summary.id+'&revision='+revision);
  const $=load(engine.render('Maps').html),config=JSON.parse($('.leaflet-map').attr('data-map'));
  config.image=new URL(config.image,'https://taelgar.org').href;config.tile.baseUrl=new URL(config.tile.baseUrl,'https://taelgar.org').href;
  assert.deepEqual(detail.map.config,config);assert.deepEqual(config.crop,{x:10,y:20,width:300,height:200});
  assert.equal(config.measurement.xScale,.6);assert.match(summary.sourceRevision,/^[a-f0-9]{64}$/);
});

test('map identities survive prose, block order, viewport and origin changes; revisions track source changes',async()=>{
  const a=fixture(),b=fixture({body:'Changed prose\n\n'+fence(block('world',{grid:{visible:true}}))});
  const first=(await catalogue(a.engine)).maps[0],next=(await catalogue(b.engine)).maps[0];
  assert.equal(first.id,next.id);assert.notEqual(first.sourceRevision,next.sourceRevision);
  const other=(await catalogue(a.engine,'/api/maps','https://www.taelgar.org')).maps[0];
  assert.equal(first.sourceRevision,other.sourceRevision);assert.equal(other.preview,'https://www.taelgar.org/assets/assets/world.png');
  const anon={image:'[[assets/world.png]]',bounds:[[0,0],[480,640]],scale:2,unit:'feet'};
  const x=fixture({body:fence(anon,'leaflet')+'\n\n'+fence(block('second'))}),y=fixture({body:fence(block('second'))+'\n\n'+fence(anon,'leaflet')});
  assert.deepEqual((await catalogue(x.engine)).maps.map(m=>m.id).sort(),(await catalogue(y.engine)).maps.map(m=>m.id).sort());
});

test('campaign/date/comment and page availability are checked for both listing and direct IDs',async()=>{
  const body=[fence(block('always')),'%%^Campaign:dufr%%',fence(block('campaign')),'%%^End%%','%%^Date:1740-01-01%%',fence(block('later')),'%%^End%%','%%^Campaign:None%%',fence(block('dm')),'%%^End%%','%%',fence(block('comment')),'%%'].join('\n\n');
  const {engine}=fixture({body,extraNotes:{'Future.md':'---\nborn: 1800\n---\n'+fence(block('unborn')),'Broken.md':'%% unclosed\n'+fence(block('broken'))}});
  const early=await catalogue(engine,'/api/maps?context=custom&date=1730-01-01&campaigns=');
  assert.deepEqual(early.maps.map(m=>m.blockId),['always']);assert.ok(early.warnings.some(w=>w.includes('Broken.md')));
  const privileged=await catalogue(engine,'/api/maps?context=custom&date=1748-01-01&campaigns=dufr&dm=1');
  assert.deepEqual(privileged.maps.map(m=>m.blockId).sort(),['always','campaign','dm','later']);
  const dm=privileged.maps.find(m=>m.blockId==='dm');assert.equal((await request(engine,'/api/maps?id='+dm.id)).status,404);
  assert.equal((await request(engine,'/api/maps?page=Future')).status,404);
  const mainId=early.maps[0].id;assert.equal(privileged.maps.find(m=>m.blockId==='always').id,mainId);
});

test('catalogue isolates invalid definitions and rejects ambiguous identities',async()=>{
  const {engine}=fixture({body:[fence(block('duplicate')),fence(block('duplicate')),fence(block('good')),fence(block('bad',{source:'[[missing.map.json]]'}))].join('\n\n')});
  const list=await catalogue(engine);assert.deepEqual(list.maps.map(m=>m.blockId),['good']);
  assert.ok(list.warnings.some(w=>w.includes('Duplicate')));assert.ok(list.warnings.some(w=>w.includes('missing')));
  assert.equal((await request(engine,'/api/maps?id=map-'+'f'.repeat(32))).status,404);
});

test('pagination, page selection, methods and revision guards have explicit API errors',async()=>{
  const {engine}=fixture({body:fence(block('one'))+'\n\n'+fence(block('two')),extraNotes:{'Other.md':fence(block('other'))}});
  const list=await catalogue(engine,'/api/maps?page=Maps&limit=1&offset=1');assert.equal(list.total,2);assert.equal(list.maps.length,1);assert.equal(list.maps[0].page.id,'Maps.md');
  for(const query of ['limit=0','limit=101','offset=-1','offset=10001','limit=1.5','id=bad','page=','offset='])assert.equal((await request(engine,'/api/maps?'+query)).status,400,query);
  assert.equal((await request(engine,'/api/maps?revision=outdated')).status,409);
  assert.equal((await handleRequest(new Request('https://taelgar.org/api/maps',{method:'POST'}),engine)).status,405);
  const head=await handleRequest(new Request('https://taelgar.org/api/maps',{method:'HEAD'}),engine);assert.equal(head.status,200);assert.equal(await head.text(),'');
});

test('campaign host context is authoritative and homepage-only maps join their own catalogue',async()=>{
  const {engine}=fixture({home:fence(block('main-home')),campaignHomes:{frontier:'---\ncampaigns: [dufr]\n---\n'+fence(block('campaign-home'))}});
  const main=await catalogue(engine);assert.ok(main.maps.some(m=>m.blockId==='main-home'));assert.ok(!main.maps.some(m=>m.blockId==='campaign-home'));
  const site=await catalogue(engine,'/api/maps?context=custom&date=1600-01-01&campaigns=','https://frontier.taelgar.org');
  assert.deepEqual(site.context.campaigns,['dufr']);assert.equal(site.context.date,'1745-01-01');assert.equal(site.context.locked,true);
  assert.ok(site.maps.some(m=>m.blockId==='campaign-home'));assert.ok(!site.maps.some(m=>m.blockId==='main-home'));
});

test('versioned map configs preserve legacy scale, detail imagery and context-filtered feature links',async()=>{
  const {engine,store}=fixture({body:fence(block('world',{details:['assets/detail.map-detail.json']}))+'\n\n'+fence({id:'legacy',image:'[[assets/world.png]]',bounds:[[10,20],[490,660]],scale:5,unit:'feet'},'leaflet'),
    extraNotes:{'River.md':'---\nmapPath:\n  kind: river\n  points: [[1010,2020],[1200,2100]]\n---\nRiver','FutureRoad.md':'---\nborn: 1800\nmapPath:\n  kind: road\n  points: [[1010,2020],[1200,2100]]\n---\nFuture'}});
  const detail={id:'assets/detail.map-detail.json',target:'assets/detail.map-detail.json',extension:'.json',mapDetail:{version:1,name:'Detail',image:'detail.png',worldBounds:{x:1010,y:2020,width:100,height:100},pixelSize:[100,100]}};
  const image={id:'assets/detail.png',target:'assets/detail.png',extension:'.png',mapImageInfo:{format:'png',width:100,height:100}};
  // Rebuild lookups after fixture-owned additions.
  engine.store=new ContentStore([...store.entries,detail,image],[],store.settings);
  const list=await catalogue(engine),world=list.maps.find(m=>m.blockId==='world'),legacy=list.maps.find(m=>m.blockId==='legacy');
  assert.ok(world);assert.ok(legacy);
  const w=(await catalogue(engine,'/api/maps?id='+world.id)).map.config;
  assert.equal(w.detailLayers[0].image,'https://taelgar.org/assets/assets/detail.png');assert.equal(w.mapPaths.length,1);assert.match(w.mapPaths[0].href,/^https:\/\/taelgar.org\/page\/river/);
  const l=(await catalogue(engine,'/api/maps?id='+legacy.id)).map;assert.equal(l.coordinates.frame,'leaflet');assert.deepEqual(l.config.measurement,{xScale:5,yScale:5,unit:'feet'});
});

test('compiled Workers and existing format 2 snapshots return identical catalogues without vault republication',async()=>{
  const {store,index}=fixture(),compiled=compileRuntime(index,store);
  const makeBucket=old=>{
    const objects=new Map([...compiled.objects].map(([file,json])=>['revisions/'+revision+'/'+file,json]));
    const manifest=structuredClone(compiled.manifest);if(old){delete manifest.parts.maps;objects.delete('revisions/'+revision+'/runtime/maps.json');}
    objects.set('revisions/'+revision+'/runtime.json',JSON.stringify({...manifest,revision}));
    objects.set('published/current.json',JSON.stringify({revision}));return new Bucket(objects);
  };
  const list=async bucket=>{const worker=createWorker({}, {cache:null,snapshotCache:null,log:()=>{}}),response=await worker.fetch(new Request('https://taelgar.org/api/maps'),{CONTENT:bucket});assert.equal(response.status,200,await response.clone().text());return response.json();};
  const current=makeBucket(false),old=makeBucket(true);
  assert.deepEqual(await list(current),await list(old));assert.equal((await list(old)).total,1);
  assert.ok(current.calls.some(k=>k.endsWith('/runtime/maps.json')));assert.ok(!current.calls.some(k=>k.includes('/runtime/notes/')),'new catalogue loads no note shards');
  assert.ok(old.calls.some(k=>k.includes('/runtime/notes/')),'old publication uses its existing prepared notes');
});

test('format 1 and legacy raw-note publications expose the same existing maps',async()=>{
  const fs=await import('node:fs/promises');
  const fixture=JSON.parse(await fs.readFile(new URL('./fixtures/runtime-v1.json',import.meta.url),'utf8'));
  // Frozen format 1 coverage also checks the original noncompiled fallback.
  const {revision}=fixture.manifest,prefix='revisions/'+revision+'/';
  const objects=new Map([['published/current.json',JSON.stringify({revision})],[prefix+'runtime.json',JSON.stringify(fixture.manifest)],
    [prefix+'index.json',JSON.stringify(fixture.index)],[prefix+'notes/00.json',JSON.stringify(fixture.rawNotes)],
    ...Object.entries(fixture.artifacts).map(([file,value])=>[prefix+file,JSON.stringify(value)])]);
  const read=async source=>{const worker=createWorker({}, {cache:null,snapshotCache:null,log:()=>{}}),response=await worker.fetch(new Request('https://taelgar.org/api/maps'),{CONTENT:new Bucket(source)});assert.equal(response.status,200,await response.clone().text());return response.json();};
  const compiled=await read(objects);objects.delete(prefix+'runtime.json');
  assert.deepEqual(compiled,await read(objects));assert.equal(compiled.total,0);
});

test('map search filters visible titles and block IDs before pagination',async()=>{
  const {engine}=fixture({body:fence(block('world'))+'\n\n'+fence(block('dungeon',{title:'Castle basement'}))});
  const result=await catalogue(engine,'/api/maps?q=BASEMENT&limit=1');assert.equal(result.total,1);assert.equal(result.maps[0].blockId,'dungeon');
  assert.equal((await catalogue(engine,'/api/maps?q=world')).total,1);
  assert.equal((await request(engine,'/api/maps?q='+'x'.repeat(201))).status,400);
});

test('older vault-sized publications scan each note shard once without parsing ordinary prose as Markdown',async()=>{
  const prose='Ordinary catalogue fixture prose. '+('A plain narrative about places, people and their journeys. '.repeat(70));
  const {store,index}=fixture({extraNotes:Object.fromEntries(Array.from({length:2800},(_,i)=>[`Notes/Entry ${i}.md`,prose]))});
  // Store metadata and prepared-note order are independent. Interleave note
  // preparation to exercise shards beyond the 16-part runtime LRU.
  const sourceOrder=[];
  for(let column=0;column<64;column++)for(let row=column;row<store.entries.length;row+=64)sourceOrder.push(store.entries[row]);
  const compiled=compileRuntime(index,new ContentStore(sourceOrder,[],store.settings)),manifest=structuredClone(compiled.manifest),render=JSON.parse(compiled.objects.get(manifest.parts.render.file));
  delete manifest.parts.maps;
  const objects=new Map([...compiled.objects].map(([file,json])=>['revisions/'+revision+'/'+file,json]));
  objects.set('revisions/'+revision+'/runtime.json',JSON.stringify({...manifest,revision}));
  objects.set('published/current.json',JSON.stringify({revision}));const bucket=new Bucket(objects);
  const parse=MarkdownIt.prototype.parse;let proseParses=0;
  MarkdownIt.prototype.parse=function(source,...args){if(source.startsWith('Ordinary catalogue fixture prose.'))proseParses++;return parse.call(this,source,...args);};
  try {
    const worker=createWorker({}, {cache:null,snapshotCache:null,requestTimeoutMs:30000,log(){}}),env={CONTENT:bucket};
    const response=await worker.fetch(new Request('https://taelgar.org/api/maps'),env);assert.equal(response.status,200,await response.clone().text());
    const list=await response.json();assert.equal(list.total,1);
    const reads=bucket.calls.filter(key=>key.includes('/runtime/notes/'));
    assert.equal(reads.length,render.noteShards.length,'each shard is read once even with interleaved metadata');
    assert.equal(new Set(reads).size,reads.length);assert.equal(proseParses,0,'map discovery does not parse unrelated prose');
    bucket.calls.length=0;
    const detail=await worker.fetch(new Request('https://taelgar.org/api/maps?id='+list.maps[0].id),env);assert.equal(detail.status,200);
    assert.equal((await detail.json()).map.config.measurement.xScale,.6);
    assert.deepEqual(bucket.calls,['published/current.json'],'subsequent map selections reuse discovered sources');
  } finally { MarkdownIt.prototype.parse=parse; }
});
