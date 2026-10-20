import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from 'cheerio';
import {ContentStore,parseNote} from '../src/content-store.mjs';
import {targetPath} from '../src/common.mjs';
import {compileSearch,searchDescriptor} from '../scripts/compile-search.mjs';
import {SearchIndex} from '../scripts/search-index.mjs';
import {searchInput,createIndexSearch} from '../src/search.mjs';
import {searchView} from '../src/search-view.mjs';
import {LocalSearch} from '../src/local-search.mjs';
import {createWorker} from '../src/worker-handler.mjs';
import {instantiate} from '../src/worker-headers.mjs';

const {DatabaseSync}=await import('node:sqlite').catch(()=>({}));
const sqliteTest=(name,fn)=>test(name,{skip:!DatabaseSync?'Enable node:sqlite on Node 22.12':false},fn);
const rev=letter=>letter.repeat(64);
const context=(campaigns=[],dm=false,date='1740-01-01')=>({kind:'custom',id:'custom',date,campaigns,dm});
function storeFor(sources){return new ContentStore(Object.entries(sources).map(([id,source])=>({id,name:id.slice(0,-3),title:id.slice(0,-3),slug:targetPath(id).slice(0,-3),target:targetPath(id),note:parseNote(source)})));}
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
  'Golden Lantern.md':'---\naliases: ["Étoile Inn", "The Beacon"]\n---\nCaravans gather beside the burning beacon.\nThe bronze fox watches.\n\nAcross the river.\n%% privatemarker %%\n%%^Campaign:dufr%%frontiermarker%%^End%%\n%%^Campaign:adma%%addermarker%%^End%%\n%%^Date:1750-01-01%%futuremarker%%^End%%',
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
  const worker=createWorker(instantiate),request=(url,overrides={})=>worker.fetch(new Request('https://example.test'+url),{...env,...overrides});
  const data=await (await request('/api/search?q=bronze&date=1740-01-01&campaigns=dufr,adma&dm=1')).json();
  assert.equal(data.source,'full-text');assert.equal(data.results[0].page,'golden-lantern');assert.match(data.results[0].url,/campaigns=adma%2Cdufr&dm=1/);assert.ok(d.sessions);
  const html=await (await request('/?q=bronze&date=1740-01-01&campaigns=all&dm=1')).text(),$=load(html);
  assert.equal($('.search-result mark').text(),'bronze');assert.equal($('.search-form input[name="campaigns"]').val(),'all');assert.equal($('.context-form input[name="q"]').val(),'bronze');
  assert.equal($('link[href="/theme/search.css"]').length,1);assert.equal((await request('/theme/search.css')).status,200);
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
  const stale=await createWorker(instantiate).fetch(new Request('https://example.test/api/search?q=Golden'),env);assert.equal((await stale.json()).fallback,true);
  assert.equal(reads.some(key=>key.includes('/notes/')),false);
  const sessions=d.sessions;
  for(const query of ['q='+encodeURIComponent('"open'),'q='+('a'.repeat(257)),'q=fox&limit=51','q=fox&offset=-1','q=fox&date=bad','q=fox&dm=maybe','q=fox&context=custom&campaigns=unknown'])assert.equal((await request('/api/search?'+query)).status,400);
  assert.equal(d.sessions,sessions);
  const invalid=await request('/?q='+encodeURIComponent('"open'));assert.equal(invalid.status,400);assert.match(invalid.headers.get('content-type'),/text\/html/);assert.match(load(await invalid.text())('[role="alert"]').text(),/Close the quoted/);
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
  const data={query:'<script>',context:context(['dufr','adma'],true),offset:20,limit:20,hasMore:true,results:[{title:'<img src=x onerror=alert(1)>',url:'/page/example?date=1740-01-01',page:'example',excerpt:'<script>alert(1)</script> fox',highlights:[{start:26,end:29}]}]};
  const html=searchView(data),$=load(html);
  assert.equal($('script,img').length,0);assert.match($('.search-result').text(),/<script>alert/);assert.equal($('.search-result mark').text(),'fox');
  for(const link of $('.search-pagination a').toArray()){const url=new URL($(link).attr('href'),'https://example.test');assert.equal(url.searchParams.get('campaigns'),'dufr,adma');assert.equal(url.searchParams.get('dm'),'1');assert.equal(url.searchParams.get('q'),'<script>');}
  assert.equal(load(searchView({...data,offset:1000}))('a[rel="next"]').length,0);
});
