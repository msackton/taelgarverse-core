import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from 'cheerio';
import {ContentStore,parseNote} from '../src/content-store.mjs';
import {targetPath,titleCase} from '../src/common.mjs';
import {compileSearch,searchDescriptor} from '../scripts/compile-search.mjs';
import {SearchIndex} from '../scripts/search-index.mjs';
import {searchInput,createIndexSearch,pageNameSearch} from '../src/search.mjs';
import {searchType} from '../src/search-types.mjs';
import {searchView} from '../src/search-view.mjs';
import {LocalSearch} from '../src/local-search.mjs';
import {createWorker} from '../src/worker-handler.mjs';

const {DatabaseSync}=await import('node:sqlite').catch(()=>({}));
const sqliteTest=(name,fn)=>test(name,{skip:!DatabaseSync?'Enable node:sqlite on Node 22.12':false},fn);
const rev=letter=>letter.repeat(64);
const context=(campaigns=[],dm=false,date='1740-01-01')=>({kind:'custom',id:'custom',date,campaigns,dm});
function storeFor(sources){return new ContentStore(Object.entries(sources).map(([id,source])=>{
  const note=parseNote(source),name=id.split('/').at(-1).slice(0,-3);
  const title=[note.metadata.title?titleCase(note.metadata.title):'',titleCase(note.metadata.name || name.replace(/-/g,' '))].filter(Boolean).join(' ');
  return {id,name,title,slug:targetPath(id).slice(0,-3),target:targetPath(id),note};
}));}
function database(t){
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');t.after(()=>db.close());let calls=0,sessions=0;
  const adapter={identity:'search-test',query:async statements=>{
    calls++;db.exec('BEGIN');
    try{const output=statements.map(({sql,params=[]})=>{const statement=db.prepare(sql),read=sql.trim().startsWith('SELECT');const results=read?statement.all(...params):[];if(!read)statement.run(...params);return {success:true,results};});db.exec('COMMIT');return output;}
    catch(error){db.exec('ROLLBACK');throw error;}
  }};
  const binding={withSession:constraint=>{assert.equal(constraint,'first-primary');sessions++;return binding;},prepare:sql=>({bind:(...params)=>({sql,params})}),batch:adapter.query};
  return {db,adapter,binding,get calls(){return calls;},get sessions(){return sessions;}};
}
const sources={
  'Golden Lantern.md':'---\ntags: [place]\naliases: ["Étoile Inn", "The Beacon"]\n---\nCaravans gather beside the burning beacon.\nThe bronze fox watches.\n\nAcross the river.\n%% privatemarker %%\n%%^Campaign:dufr%%frontiermarker%%^End%%\n%%^Campaign:adma%%addermarker%%^End%%\n%%^Date:1750-01-01%%futuremarker%%^End%%',
  'Another Tale.md':'The golden lantern illuminates a merchant road.',
  'Athens.md':'---\naliases: ["Ἀθήνα"]\n---\nA place with a Greek alias.',
  'Available.md':'rankmarker visible to everyone.',
  'Excluded.md':'---\nexcludePublish: [dufr]\n---\nexcludedmarker',
  'Future.md':'---\ncreated: "1750-01-01"\n---\nrankmarker future-only.',
};
test('queries quote literal FTS operators, support prefixes/phrases/Unicode and bound pagination before database access',()=>{
  assert.equal(searchInput('bronze fox').match,'"bronze"* AND "fox"*');
  assert.equal(searchInput('"bronze fox"').match,'"bronze fox"');
  assert.equal(searchInput('Étoile').match,'"étoile"*');
  assert.equal(searchInput('OR NEAR(foo)').match,'"or"* AND "near"* AND "foo"*');
  assert.equal(searchInput('***').match,'');
  for(const [query,options] of [['x'.repeat(257),{}],['"open',{}],[Array(18).fill('word').join(' '),{}],['hi',{limit:51}],['hi',{offset:1001}],['hi',{offset:-1}],['hi',{limit:'no'}]])assert.throws(()=>searchInput(query,options),{status:400});
  for(const type of ['people','invalid',"person' OR 1=1",['person'],null])assert.throws(()=>searchInput('Seeker',{type}),{status:400});
});
test('content types use existing tags, including scalar, hash-prefixed and nested tags; unmatched notes are Other',()=>{
  for(const [tags,expected] of [[['status/check/lint','person/pc'],'person'],['#place/settlement','place'],['meta, session-note','session-note'],[['group/organization'],'group'],[['personality','status/place'],'other'],[null,'other']]){
    assert.equal(searchType({note:{metadata:{tags}}}),expected);
  }
});
const nameSources={
  'People/Seeker.md':'---\ntags: [person]\nname: Seeker\ntitle: The\n---\nSeeker writes a journal. '+('Long background prose. '.repeat(500)),
  'Seeker Hometown.md':'---\ntags: [place]\n---\nSeeker hometown.',
  'A Pretender.md':'---\ntags: [person]\naliases: [Seeker]\n---\nSeeker.',
  'Étoile.md':'---\ntags: [place]\n---\nA long history. '+('Historical prose. '.repeat(500)),
  'Etoile Harbor.md':'---\ntags: [place]\n---\nEtoile.',
};
test('page-name fallback prefers exact canonical names and aliases and applies type filters to browsing',()=>{
  const store=storeFor(nameSources);
  for(const query of ['Seeker','"SEEKER"']){
    assert.deepEqual(pageNameSearch(store,searchInput(query),context()).results.map(r=>r.title),['The Seeker','A Pretender','Seeker Hometown']);
  }
  assert.equal(pageNameSearch(store,searchInput('etoile'),context()).results[0].title,'Étoile');
  const people=pageNameSearch(store,searchInput('',{type:'person',limit:1}),context());
  assert.equal(people.type,'person');assert.equal(people.hasMore,true);assert.equal(people.results.length,1);
  assert.deepEqual(pageNameSearch(store,searchInput('Seeker',{type:'place'}),context()).results.map(r=>r.title),['Seeker Hometown']);
});
sqliteTest('exact page names outrank exact aliases and partial titles before pagination, including quotes, case and accents',async t=>{
  const store=storeFor(nameSources),manifest=compileSearch(store),d=database(t);await new SearchIndex(d.adapter).stage(rev('a'),manifest);
  const search=createIndexSearch(d.adapter.query,{revision:rev('a'),descriptor:searchDescriptor(manifest),store});
  for(const query of ['Seeker','"SEEKER"','  seeker  ']){
    const result=await search(searchInput(query,{limit:1}),context());
    assert.equal(result.source,'full-text');assert.equal(result.results[0].title,'The Seeker');assert.equal(result.hasMore,true);
    const next=await search(searchInput(query,{limit:1,offset:1}),context());assert.equal(next.results[0].title,'A Pretender');
    const partial=await search(searchInput(query,{limit:1,offset:2}),context());assert.equal(partial.results[0].title,'Seeker Hometown');
  }
  assert.equal((await search(searchInput('etoile',{limit:1}),context())).results[0].title,'Étoile');
  assert.equal((await search(searchInput('"Seeker Hometown"',{limit:1}),context())).results[0].title,'Seeker Hometown');
});
sqliteTest('content type is filtered in SQL before pagination and retains campaign/date/DM visibility',async t=>{
  const notes=Object.fromEntries(Array.from({length:45},(_,i)=>['Person '+i+'.md','---\ntags: [person]\n---\ncollectionmarker.']));
  for(let i=0;i<25;i++)notes['Place '+String(i).padStart(2,'0')+'.md']='---\ntags: [place/settlement]\n---\ncollectionmarker.';
  notes['Hidden Place.md']='---\ntags: [place]\n---\n%%^Campaign:adma%%hiddenmarker%%^End%%';
  notes['Future Place.md']='---\ntags: [place]\ncreated: "1750-01-01"\n---\nfuturemarker';
  notes['DM Place.md']='---\ntags: [place]\n---\n%% privatemarker %%';
  notes['Other.md']='collectionmarker.';
  const store=storeFor(notes),search=new LocalSearch(store);t.after(()=>search.close());
  const first=await search.search(searchInput('collectionmarker',{type:'place'}),context());
  const next=await search.search(searchInput('collectionmarker',{type:'place',offset:20}),context());
  assert.equal(first.type,'place');assert.equal(first.results.length,20);assert.equal(first.hasMore,true);
  assert.equal(next.results.length,5);assert.equal(next.hasMore,false);
  assert.equal(new Set([...first.results,...next.results].map(r=>r.page)).size,25);
  assert.ok([...first.results,...next.results].every(r=>r.page.startsWith('place-')));
  assert.equal((await search.search(searchInput('collectionmarker',{type:'other'}),context())).results[0].title,'Other');
  for(const [query,c,count] of [['hiddenmarker',context(),0],['hiddenmarker',context(['adma']),1],['privatemarker',context(),0],['privatemarker',context([],true),1],['futuremarker',context(),0],['futuremarker',context([],false,'1750-01-01'),1]]){
    assert.equal((await search.search(searchInput(query,{type:'place'}),c)).results.length,count,query);
  }
});
sqliteTest('production SQL ranks names, finds aliases/phrases/body prefixes, filters before LIMIT and returns only the visible excerpt',async t=>{
  const store=storeFor(sources),manifest=compileSearch(store),d=database(t);await new SearchIndex(d.adapter).stage(rev('a'),manifest);
  const search=createIndexSearch(d.adapter.query,{revision:rev('a'),descriptor:searchDescriptor(manifest),store});
  const find=(q,c=context(),options)=>search(searchInput(q,options),c);
  assert.equal((await find('Golden Lantern')).results[0].title,'Golden Lantern');
  assert.equal((await find('Étoile')).results[0].title,'Golden Lantern');
  assert.equal((await find('Etoile')).results[0].title,'Golden Lantern');
  assert.equal((await find('Ἀθήνα')).results[0].title,'Athens');
  assert.equal((await find('beac')).results[0].title,'Golden Lantern');
  assert.equal((await find('"watches Across"')).results[0].title,'Golden Lantern');
  assert.equal((await find('"fox bronze"')).results.length,0);
  assert.equal((await find('rankmarker',context(),{limit:1})).results[0].page,'available');
  for(const [term,c,count] of [['privatemarker',context(),0],['privatemarker',context([],true),1],['frontiermarker',context(['dufr']),1],['frontiermarker',context(['adma']),0],
    ['addermarker',context(['dufr','adma']),1],['futuremarker',context(),0],['futuremarker',context([],false,'1750-01-01'),1],['excludedmarker',context(['dufr']),0],['excludedmarker',context(),1]]){
    const result=await find(term,c);assert.equal(result.results.length,count,term+JSON.stringify(c));
    for(const item of result.results){assert.ok(item.url.includes('date='+c.date));assert.ok(!item.excerpt.includes('privatemarker') || c.dm);}
  }
  const result=await find('bronze fox'),item=result.results[0];assert.ok(item.highlights.length);assert.match(item.excerpt,/bronze fox/);
  assert.equal((await find('fox OR nonexistent')).results.length,0);
});
sqliteTest('Worker search API/HTML use the active revision, preserve context, fall back safely, and never read R2 note bodies',async t=>{
  const d=database(t),indexer=new SearchIndex(d.adapter),store=storeFor(sources),manifest=compileSearch(store);
  await indexer.stage(rev('a'),manifest);
  const registry={campaigns:{'dunmar-frontier':{code:'dufr',name:'Dunmar Frontier'},addermarch:{code:'adma',name:'Addermarch'}}};
  const makeIndex=(revision,source,manifest)=>({schemaVersion:1,revision,search:searchDescriptor(manifest),settings:{default_date:'1740-01-01'},coreMeta:{},registry,navigationSource:null,homeSource:null,
    entries:source.entries.map(e=>({...e,note:{metadata:e.note.metadata,shard:'00',sha256:rev('f')}}))});
  const objects=new Map([['published/current.json',{revision:rev('a')}],[`revisions/${rev('a')}/index.json`,makeIndex(rev('a'),store,manifest)]]),reads=[];
  const env={SEARCH_DB:d.binding,CONTENT:{get:async key=>{reads.push(key);const value=objects.get(key);return value?{json:async()=>value}:null;}},ASSETS:{fetch:async request=>new Response(new URL(request.url).pathname)}};
  const worker=createWorker(),request=(url,overrides={})=>worker.fetch(new Request('https://example.test'+url),{...env,...overrides});
  const data=await (await request('/api/search?q=bronze&date=1740-01-01&campaigns=dufr,adma&dm=1')).json();
  assert.equal(data.source,'full-text');assert.equal(data.results[0].page,'golden-lantern');assert.match(data.results[0].url,/campaigns=adma%2Cdufr&dm=1/);assert.ok(d.sessions);
  const html=await (await request('/?q=bronze&date=1740-01-01&campaigns=all&dm=1')).text(),$=load(html);
  assert.equal($('.search-result mark').text(),'bronze');assert.equal($('.search-form input[name="campaigns"]').val(),'all');assert.equal($('.context-form input[name="q"]').val(),'bronze');
  assert.equal($('link[href="/theme/search.css"]').length,1);assert.equal((await request('/theme/search.css')).status,200);
  assert.equal($('#site-search').length,1);assert.equal($('#search-query').length,1);
  const filtered=await (await request('/api/search?q=bronze&type=place')).json();assert.equal(filtered.type,'place');assert.equal(filtered.results[0].title,'Golden Lantern');
  assert.equal((await (await request('/api/search?q=bronze&type=person')).json()).results.length,0);
  const filteredHtml=load(await (await request('/?q=bronze&type=place&campaigns=all&dm=1')).text());
  assert.equal(filteredHtml('#search-type').val(),'place');assert.equal(filteredHtml('.context-form input[name="type"]').val(),'place');assert.equal(filteredHtml('#header-search input[name="type"]').val(),'place');
  const fallback=await (await request('/api/search?q=Golden&type=person',{SEARCH_DB:undefined})).json();assert.equal(fallback.fallback,true);assert.equal(fallback.results.length,0);assert.equal(fallback.type,'person');
  const browse=await (await request('/api/search?q=&type=place')).json();assert.equal(browse.source,'page-names');assert.deepEqual(browse.results.map(r=>r.title),['Golden Lantern']);
  const simultaneous=await Promise.all(['','&dm=1','&campaigns=dufr','&campaigns=adma'].map(async query=>(await request('/api/search?q=privatemarker&date=1740-01-01'+query)).json()));
  assert.deepEqual(simultaneous.map(r=>r.results.length),[0,1,0,0]);
  const missing=await (await request('/api/search?q=Golden',{SEARCH_DB:undefined})).json();assert.equal(missing.fallback,true);assert.equal(missing.results[0].excerpt,'');
  const unavailable=await (await request('/?q=Golden',{SEARCH_DB:{withSession(){throw new Error('private provider error');}}})).text();assert.match(unavailable,/Showing matching page names/);assert.doesNotMatch(unavailable,/private provider error/);
  const nextStore=storeFor({...sources,'Golden Lantern.md':'newrevisionmarker'}),nextManifest=compileSearch(nextStore);
  await indexer.stage(rev('b'),nextManifest);objects.set(`revisions/${rev('b')}/index.json`,makeIndex(rev('b'),nextStore,nextManifest));objects.set('published/current.json',{revision:rev('b')});
  assert.equal((await (await request('/api/search?q=bronze')).json()).results.length,0);
  assert.equal((await (await request('/api/search?q=newrevisionmarker')).json()).results.length,1);
  objects.set('published/current.json',{revision:rev('a')});assert.equal((await (await request('/api/search?q=bronze')).json()).results.length,1);
  objects.get(`revisions/${rev('a')}/index.json`).search={...searchDescriptor(manifest),digest:rev('c')};
  // A fresh Worker must reject a descriptor that does not match D1 readiness.
  const stale=await createWorker().fetch(new Request('https://example.test/api/search?q=Golden'),env);assert.equal((await stale.json()).fallback,true);
  assert.equal(reads.some(key=>key.includes('/notes/')),false);
  const sessions=d.sessions;
  for(const query of ['q='+encodeURIComponent('"open'),'q='+('a'.repeat(257)),'q=fox&limit=51','q=fox&offset=-1','q=fox&type=invalid','q=fox&date=bad','q=fox&dm=maybe','q=fox&context=custom&campaigns=unknown'])assert.equal((await request('/api/search?'+query)).status,400);
  assert.equal(d.sessions,sessions);
  const invalid=await request('/?q='+encodeURIComponent('"open'));assert.equal(invalid.status,400);assert.match(invalid.headers.get('content-type'),/text\/html/);assert.match(load(await invalid.text())('[role="alert"]').text(),/Close the quoted/);
  const invalidTyped=await request('/?q='+encodeURIComponent('"open')+'&type=place');assert.equal(invalidTyped.status,400);assert.equal(load(await invalidTyped.text())('#search-type').val(),'place');
  const head=await worker.fetch(new Request('https://example.test/api/search?q=Golden',{method:'HEAD'}),env);assert.equal(head.status,200);assert.equal(await head.text(),'');
});
sqliteTest('local preview uses identical compiler/FTS SQL and does not need Cloudflare credentials',async t=>{
  const search=new LocalSearch(storeFor(sources));t.after(()=>search.close());
  assert.equal((await search.search(searchInput('bronze'),context())).results[0].title,'Golden Lantern');
  assert.equal((await search.search(searchInput('privatemarker'),context())).results.length,0);
  assert.equal((await search.search(searchInput('privatemarker'),context([],true))).results.length,1);
});
sqliteTest('ranked pagination is stable and hidden matches never consume the result limit',async t=>{
  const notes=Object.fromEntries(Array.from({length:25},(_,i)=>['Entry '+String(i).padStart(2,'0')+'.md','paginationmarker public.']));
  for(let i=0;i<30;i++)notes['Secret '+i+'.md']='%%^Campaign:adma%%paginationmarker paginationmarker%%^End%%';
  const store=storeFor(notes),manifest=compileSearch(store),d=database(t);await new SearchIndex(d.adapter).stage(rev('a'),manifest);
  const search=createIndexSearch(d.adapter.query,{revision:rev('a'),descriptor:searchDescriptor(manifest),store});
  const first=await search(searchInput('paginationmarker'),context()),next=await search(searchInput('paginationmarker',{offset:20}),context());
  assert.equal(first.results.length,20);assert.equal(first.hasMore,true);assert.equal(next.results.length,5);assert.equal(next.hasMore,false);
  assert.equal(new Set([...first.results,...next.results].map(r=>r.page)).size,25);
  assert.ok([...first.results,...next.results].every(r=>r.page.startsWith('entry-')));
});
test('results escape excerpt/title/query markup and pagination preserves context and bounds',()=>{
  const data={query:'<script>',type:'person',context:context(['dufr','adma'],true),offset:20,limit:20,hasMore:true,results:[{title:'<img src=x onerror=alert(1)>',url:'/page/example?date=1740-01-01',page:'example',excerpt:'<script>alert(1)</script> fox',highlights:[{start:26,end:29}]}]};
  const html=searchView(data),$=load(html);
  assert.equal($('script,img').length,0);assert.match($('.search-result').text(),/<script>alert/);assert.equal($('.search-result mark').text(),'fox');
  assert.equal($('#search-type').val(),'person');
  for(const link of $('.search-pagination a').toArray()){const url=new URL($(link).attr('href'),'https://example.test');assert.equal(url.searchParams.get('campaigns'),'dufr,adma');assert.equal(url.searchParams.get('dm'),'1');assert.equal(url.searchParams.get('q'),'<script>');assert.equal(url.searchParams.get('type'),'person');}
  assert.equal(load(searchView({...data,offset:1000}))('a[rel="next"]').length,0);
});

sqliteTest('reader POV filters full-text matches before ranking and pagination in one shared index',async t=>{
  const sources={'Visible A.md':'perspectivemarker first current reference.','Visible B.md':'perspectivemarker second current reference.'};
  for (let i=0;i<40;i++) sources['Future '+i+'.md']='---\nPOV: 1750s\n---\nperspectivemarker';
  const store=storeFor(sources);store.settings={respect_pov_dates:true};
  const manifest=compileSearch(store),d=database(t);await new SearchIndex(d.adapter).stage(rev('a'),manifest);
  const search=createIndexSearch(d.adapter.query,{revision:rev('a'),descriptor:searchDescriptor(manifest),store});
  const view={...context([],false,'1740-01-01'),pov:true};
  for (const dm of [false,true]) {
    const first=await search(searchInput('perspectivemarker',{limit:1}),{...view,dm});
    const second=await search(searchInput('perspectivemarker',{limit:1,offset:1}),{...view,dm});
    assert.equal(first.hasMore,true);assert.equal(second.hasMore,false);
    assert.deepEqual([...first.results,...second.results].map(r=>r.page).sort(),['visible-a','visible-b']);
    assert.equal((await search(searchInput('perspectivemarker',{limit:50}),{...view,dm,pov:false})).results.length,42);
    assert.equal((await search(searchInput('perspectivemarker',{limit:50}),{...view,dm,date:'1750-01-01'})).results.length,42);
  }
  assert.equal((await search(searchInput('perspectivemarker',{limit:50}),context())).results.length,2);
});
