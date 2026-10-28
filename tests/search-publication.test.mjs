import {testSettings} from './helpers/test-settings.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT,isInside} from '../src/config.mjs';
import {ContentStore,parseNote,availableInContext,authoredBody} from '../src/content-store.mjs';
import {targetPath,dateKey} from '../src/common.mjs';
import {filterComments} from '../src/comments.mjs';
import {createMarkdown,renderMarkdown} from '../src/markdown.mjs';
import {searchText} from '../src/search-text.mjs';
import {compileSearch,validateSearchManifest,searchDescriptor,searchHash} from '../scripts/compile-search.mjs';
import {SearchIndex,readPreparedSearch} from '../scripts/search-index.mjs';
import {searchBinding,searchCredentials,createSearchDatabase,SEARCH_BINDING,SEARCH_DATABASE} from '../scripts/search-database.mjs';
import {publishContent,validateCheckpoint,buildFingerprint} from '../scripts/publish-content.mjs';
import {prepareContent} from '../scripts/prepare-cloudflare.mjs';
import {stagePreparedSearch} from '../scripts/search.mjs';

const {DatabaseSync}=await import('node:sqlite').catch(()=>({}));
const sqliteTest=(name,fn)=>test(name,{skip:!DatabaseSync?'Enable node:sqlite with --experimental-sqlite on Node 22.12':false},fn);
function storeFor(sources,settings={}){
  return new ContentStore(Object.entries(sources).map(([id,source])=>({id,name:id.slice(0,-3),title:id.slice(0,-3),target:targetPath(id),slug:targetPath(id).slice(0,-3),note:parseNote(source),extension:'.md'})),[],settings);
}
function database(){
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');let failAt;
  const adapter={identity:'test-database',query:async statements=>{
    db.exec('BEGIN');
    try{const result=statements.map(({sql,params=[]})=>{
      if(failAt?.(sql)){failAt=null;throw new Error('injected D1 failure');}
      const statement=db.prepare(sql),read=/^(SELECT|WITH|PRAGMA)/.test(sql.trim());
      const results=read?statement.all(...params):[];const writes=read?0:Number(statement.run(...params).changes);
      return {success:true,results,meta:{rows_read:results.length,rows_written:writes,duration:0}};
    });db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}
  }};
  return {db,adapter,fail:predicate=>{failAt=predicate;}};
}
const visible=(manifest,context)=>new Set(manifest.rules.filter(r=>r.from<=dateKey(context.date) && (r.before===null || dateKey(context.date)<r.before) &&
  (r.dm===null || r.dm===context.dm) && r.campaigns.every(c=>context.campaigns.includes(c)) && r.exceptCampaigns.every(c=>!context.campaigns.includes(c))).map(r=>r.document));
const rev=letter=>letter.repeat(64);

sqliteTest('D1 retention keeps only two generations, removes orphan FTS text and shares a cross-publisher lock',async()=>{
  const {db,adapter,fail}=database(),index=new SearchIndex(adapter),other=new SearchIndex(adapter);
  const make=text=>compileSearch(storeFor({'One.md':text,'Shared.md':'sharedmarker'}));
  const a=make('oldmarker'),b=make('previousmarker'),c=make('currentmarker');
  await index.stage(rev('a'),a);await index.stage(rev('b'),b);await index.stage(rev('c'),c);
  // Also remove interrupted staging, including text without any membership.
  fail(sql=>sql.startsWith('INSERT INTO tv_search_rules'));
  await assert.rejects(index.stage(rev('d'),make('failedmarker')),/injected/);
  await assert.rejects(index.prune([rev('c'),rev('b')]),/lock/);
  await index.withPublicationLock(async()=>{
    await assert.rejects(other.withPublicationLock(async()=>assert.fail('must not acquire')),/Another publisher/);
    fail(sql=>sql==='DELETE FROM tv_search_gc');
    await assert.rejects(index.prune([rev('c'),rev('b')]),/injected/);
    await index.verify(rev('a'),searchDescriptor(a));assert.equal(db.prepare('SELECT COUNT(*) n FROM tv_search_gc').get().n,0);
    await index.prune([rev('c'),rev('b')]);
  });
  await index.verify(rev('b'),searchDescriptor(b));await index.verify(rev('c'),searchDescriptor(c));
  await assert.rejects(index.verify(rev('a'),searchDescriptor(a)),/not ready/);
  assert.deepEqual(db.prepare('SELECT revision FROM tv_search_revisions ORDER BY revision').all().map(r=>r.revision),[rev('b'),rev('c')]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tv_search_documents').get().n,3);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tv_search_fts WHERE tv_search_fts MATCH 'oldmarker OR failedmarker'").get().n,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tv_search_fts WHERE tv_search_fts MATCH 'sharedmarker'").get().n,1);
  assert.throws(()=>db.prepare('DELETE FROM tv_search_rules WHERE revision=?').run(rev('b')),/immutable/);
  await assert.rejects(index.withPublicationLock(async()=>{throw new Error('failed operation');}),/failed operation/);
  await other.withPublicationLock(async()=>{});db.close();
});

sqliteTest('explicit unblock recovers a stale lock, preserves content, and releases after success or failure',async t=>{
  const {db,adapter}=database();t.after(()=>db.close());
  const index=new SearchIndex(adapter),manifest=compileSearch(storeFor({'One.md':'publishedmarker'}));
  await index.stage(rev('a'),manifest);
  const seed=()=>db.prepare('INSERT INTO tv_search_publish_lock VALUES(1,?,?)').run('stale-owner','2026-10-20T18:19:04.423Z');
  const current=()=>db.prepare('SELECT owner FROM tv_search_publish_lock').get()?.owner;
  seed();
  await assert.rejects(index.withPublicationLock(async()=>assert.fail('must not publish')),/confirming.*any computer.*--unblock/);
  assert.equal(current(),'stale-owner');
  for(const fail of [false,true]){
    if(fail)seed();
    const action=async()=>{
      assert.ok(current());assert.notEqual(current(),'stale-owner');assert.equal(index.lockOwner,current());
      await index.verify(rev('a'),searchDescriptor(manifest));
      await assert.rejects(new SearchIndex(adapter).withPublicationLock(async()=>assert.fail('must remain locked')),/Another publisher/);
      if(fail)throw new Error('publication failed');
      return 'published';
    };
    if(fail)await assert.rejects(index.withPublicationLock(action,{unblock:true}),/publication failed/);
    else assert.equal(await index.withPublicationLock(action,{unblock:true}),'published');
    assert.equal(current(),undefined);assert.equal(index.lockOwner,null);
  }
  await index.withPublicationLock(async()=>assert.ok(current()),{unblock:true});
  assert.equal(current(),undefined);
});

sqliteTest('unblock never removes a replacement owner and rolls back failed recovery',async t=>{
  const {db,adapter,fail}=database();t.after(()=>db.close());
  const index=new SearchIndex(adapter);await index.ensure();
  db.prepare('INSERT INTO tv_search_publish_lock VALUES(1,?,?)').run('stale-owner','old-time');
  let replaced=false;
  const racing=new SearchIndex({...adapter,query:async statements=>{
    if(!replaced && statements[0].sql.startsWith('DELETE FROM tv_search_publish_lock')){
      replaced=true;
      db.prepare('UPDATE tv_search_publish_lock SET owner=?,started_at=?').run('new-publisher','new-time');
    }
    return adapter.query(statements);
  }});
  await assert.rejects(racing.withPublicationLock(async()=>assert.fail('must not publish'),{unblock:true}),/lock changed during --unblock/);
  assert.equal(db.prepare('SELECT owner FROM tv_search_publish_lock').get().owner,'new-publisher');
  assert.ok(!racing.lockOwner);
  let inserts=0;
  fail(sql=>sql.startsWith('INSERT INTO tv_search_publish_lock') && ++inserts===2);
  await assert.rejects(index.withPublicationLock(async()=>assert.fail('must not publish'),{unblock:true}),/injected D1 failure/);
  assert.equal(db.prepare('SELECT owner FROM tv_search_publish_lock').get().owner,'new-publisher');
});

sqliteTest('schema-1 database upgrades transactionally without dropping ready generations',async()=>{
  const {db,adapter}=database(),index=new SearchIndex(adapter),manifest=compileSearch(storeFor({'One.md':'oldmarker'}));
  delete manifest.metadata;manifest.digest=searchHash({version:manifest.version,documents:manifest.documents,rules:manifest.rules});
  await index.stage(rev('a'),manifest);
  db.exec(`DROP TRIGGER tv_search_delete; DROP TRIGGER tv_search_revision_delete; DROP TRIGGER tv_search_rule_delete;
    CREATE TRIGGER tv_search_rule_delete BEFORE DELETE ON tv_search_rules WHEN
      (SELECT state FROM tv_search_revisions WHERE revision=old.revision)='ready'
      BEGIN SELECT RAISE(ABORT,'Ready search membership is immutable'); END;
    DROP TABLE tv_search_page_metadata; DROP INDEX tv_search_document_membership; DROP TABLE tv_search_gc; DROP TABLE tv_search_publish_lock; UPDATE tv_search_meta SET version=1;`);
  await index.ensure();assert.equal(db.prepare('SELECT version FROM tv_search_meta').get().version,3);
  await index.verify(rev('a'),searchDescriptor(manifest));
  await index.withPublicationLock(()=>index.prune([rev('a')]));db.close();
});

sqliteTest('failed lock release preserves the original publication error and explains recovery',async t=>{
  const {db,adapter,fail}=database();t.after(()=>db.close());const index=new SearchIndex(adapter);
  await assert.rejects(index.withPublicationLock(async()=>{
    fail(sql=>sql.startsWith('DELETE FROM tv_search_publish_lock'));
    throw new Error('original upload failure');
  }),/original upload failure[\s\S]*Could not release[\s\S]*--unblock/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tv_search_publish_lock').get().n,1);
});

sqliteTest('schema-2 upgrade is atomic and retains old ready search revisions',async t=>{
  const {db,adapter,fail}=database();t.after(()=>db.close());
  const index=new SearchIndex(adapter),manifest=compileSearch(storeFor({'One.md':'legacy marker'}));
  delete manifest.metadata;manifest.digest=searchHash({version:manifest.version,documents:manifest.documents,rules:manifest.rules});
  await index.stage(rev('a'),manifest);
  db.exec('DROP TABLE tv_search_page_metadata; UPDATE tv_search_meta SET version=2');
  fail(sql=>sql.startsWith('CREATE TRIGGER tv_search_metadata_update'));
  await assert.rejects(index.ensure(),/injected/);
  assert.equal(db.prepare('SELECT version FROM tv_search_meta').get().version,2);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='tv_search_page_metadata'").get(),undefined);
  await index.ensure();await index.verify(rev('a'),searchDescriptor(manifest));
  assert.equal(db.prepare('SELECT version FROM tv_search_meta').get().version,3);
  const next=compileSearch(storeFor({'One.md':'new marker'}));await index.stage(rev('b'),next);
  assert.throws(()=>db.prepare("UPDATE tv_search_page_metadata SET type='other' WHERE revision=?").run(rev('b')),/immutable/);
  assert.throws(()=>db.prepare('DELETE FROM tv_search_page_metadata WHERE revision=?').run(rev('b')),/immutable/);
  await index.withPublicationLock(()=>index.prune([rev('a')]));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tv_search_page_metadata').get().n,0);
});

sqliteTest('resumed search staging validates metadata as well as immutable text before activation',async t=>{
  const {db,adapter,fail}=database();t.after(()=>db.close());
  const index=new SearchIndex(adapter),manifest=compileSearch(storeFor({'One.md':'---\nPOV: 1750\n---\nmarker'}));
  fail(sql=>sql.startsWith('INSERT INTO tv_search_rules'));
  await assert.rejects(index.stage(rev('a'),manifest),/injected/);
  db.exec('DROP TRIGGER tv_search_metadata_update');
  db.prepare('UPDATE tv_search_page_metadata SET pov_date=10101 WHERE revision=?').run(rev('a'));
  await assert.rejects(index.stage(rev('a'),manifest),/verification/);
  await assert.rejects(index.verify(rev('a'),searchDescriptor(manifest)),/not ready/);
});

test('compiler supports arbitrary dates, campaign subsets and DM mode with whole-note renderer parity',()=>{
  const store=storeFor({'Host.md':'---\naliases: ["Other Name"]\n---\nPublic phrase beginning.\n%%^Campaign:dufr%%frontiertext%%^End%%\n%%^Campaign:adma%%addertext%%^End%%\n%%^Date:1740-05%%afterdate%%^End%%\n%%^Date:1740-05b%%beforedate%%^End%%\n%% privatepopup %%\n%%^Campaign:none%%dmonlyblock%%^End%%\n%%^Metadata:lint%%adminnever%%^End%%\nEnd of public phrase.',
    'Excluded.md':'---\nexcludePublish: [dufr]\n---\nExclusion text.',
    'Future.md':'---\ncreated: "1740-05"\n---\nFuture text.',
    'Born.md':'---\nborn: 1740\nactiveYear: 1742\n---\nBorn text.',
    'POV Year.md':'---\nPOV: 1740\n---\nPOV year text.',
    'POV Plural.md':'---\nPOV: 1740s\n---\nPOV plural text.',
    'POV Full.md':'---\nPOV: 1740-05-31\n---\nPOV full text.',
    'POV Modern.md':'---\nPOV: modern\n---\nPOV modern text.',
    'Never.md':'---\nexcludePublish: all\n---\nDo not index.',
    'Unsafe.md':'Public prefix %% unclosed private data',
    'Heading.md':'## Searchable heading only'},{respect_pov_dates:true});
  const manifest=validateSearchManifest(compileSearch(store)),md=createMarkdown(),notesMarkdown=createMarkdown({html:false});
  assert.equal(manifest.warnings.length,1);assert.doesNotMatch(JSON.stringify(manifest.documents),/Do not index|unclosed private|adminnever/);
  for(const date of ['1739-09-17','1740-01-01','1740-04-30','1740-05-01','1740-05-30','1740-05-31','1742-01-01','1750-02-05']){
    for(const campaigns of [[],['dufr'],['adma'],['adma','dufr'],['irrelevant','dufr']])for(const dm of [false,true]){
      const context={date,campaigns,dm},ids=visible(manifest,context);
      for(const entry of store.bySlug.values()){
        const docs=manifest.documents.filter(d=>d.page===entry.slug && ids.has(d.id));
        if(entry.id==='Unsafe.md' || !availableInContext(entry,context)){assert.equal(docs.length,0);continue;}
        assert.equal(docs.length,1,JSON.stringify([entry.id,context]));
        const dmNotes=[],source=filterComments(authoredBody(entry.note),{...context,notes:dmNotes});
        const html=renderMarkdown(md,source,{store,entry,date,context,dmNotes,notesMarkdown,noteEmbeds:[],warnings:[]}).html;
        assert.equal(docs[0].text,searchText(html));
        if(entry.id==='Host.md')assert.equal(docs[0].text.includes('privatepopup'),dm);
      }
    }
  }
  for (const [page,from] of [['pov-year',10101],['pov-plural',10101],['pov-full',10101],['pov-modern',10101]]) {
    const document=manifest.documents.find(d=>d.page===page);
    assert.ok(document,page);
    assert.deepEqual(manifest.rules.filter(r=>r.document===document.id).map(r=>r.from),[from],page);
  }
  assert.ok(manifest.documents.some(d=>d.text.includes('Searchable heading only')));
  assert.equal(compileSearch(store).digest,manifest.digest);
});

test('compiler avoids transitive embeds, executable source, unsafe partial results and unbounded state expansion',()=>{
  const manifest=compileSearch(storeFor({'Host.md':'Visible ![[Child]]\n```dataview\nLIST secretquery\n```\n```mermaid\ngraph LR; A --> B\n```',
    'Child.md':'Child-only text.'}));
  const host=manifest.documents.find(d=>d.page==='host');assert.doesNotMatch(host.text,/Child-only|secretquery|graph LR/);
  assert.throws(()=>compileSearch(storeFor({'Complex.md':'%%^Campaign:a%%one%%^End%%\n%%^Campaign:b%%two%%^End%%'}),{maxStatesPerNote:4}),/state limit/);
  const changed=structuredClone(manifest);changed.documents[0].text='tampered';assert.throws(()=>validateSearchManifest(changed),/digest/);
  const empty=validateSearchManifest(compileSearch(storeFor({'Never.md':'---\nexcludePublish: all\n---\nNo search'})));assert.equal(empty.documents.length,0);
});

test('prepared search is revision-bound, stays out of R2 uploads, and tampering fails before database access',async t=>{
  fs.mkdirSync(path.join(ROOT,'.cache'),{recursive:true});const directory=fs.mkdtempSync(path.join(ROOT,'.cache','search-preparation-test-'));
  t.after(()=>{assert.ok(isInside(path.join(ROOT,'.cache'),fs.realpathSync(directory)));assert.ok(path.basename(directory).startsWith('search-preparation-test-'));fs.rmSync(directory,{recursive:true});});
  const source=path.join(directory,'source');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'One.md'),'Public.\n%% private-fixture-marker %%');
  const report=await prepareContent({...testSettings(),source_dir:source,home_source:null,nav_source:null},path.join(directory,'output'),{commit:'a'.repeat(40),dirty:false});
  const manifest=readPreparedSearch(report);assert.ok(manifest.documents.some(d=>d.text.includes('private-fixture-marker')));
  const index=fs.readFileSync(report.indexFile,'utf8');assert.equal(JSON.parse(index).settings.respect_pov_dates,false);assert.ok(!index.includes('private-fixture-marker'));assert.ok(!index.includes('searchFile'));
  const uploads=JSON.parse(fs.readFileSync(report.manifestFile,'utf8'));assert.ok(!uploads.some(item=>item.file===report.searchFile || item.key.endsWith('/search.json')));
  fs.writeFileSync(report.searchFile,JSON.stringify({...manifest,digest:'f'.repeat(64)}));
  await assert.rejects(stagePreparedSearch(report),/manifest\/digest/);
});

sqliteTest('staging is resumable, reuses immutable text, verifies membership and preserves old revisions after edits/deletions',async t=>{
  const {db,adapter,fail}=database();t.after(()=>db.close());
  const first=compileSearch(storeFor({'One.md':'oldmarker','Two.md':'deletemarker'})),index=new SearchIndex(adapter);
  fail(sql=>sql.startsWith('INSERT INTO tv_search_rules'));
  await assert.rejects(index.stage(rev('a'),first),/injected/);
  await assert.rejects(index.verify(rev('a'),searchDescriptor(first)),/not ready/);
  const resumed=await index.stage(rev('a'),first);assert.equal(resumed.uploaded,0);assert.equal(resumed.reused,2);assert.equal(resumed.resumed,true);
  const again=await index.stage(rev('a'),first);assert.equal(again.usage.rowsWritten,0);
  const second=compileSearch(storeFor({'One.md':'newmarker','Three.md':'new page'}));
  await index.stage(rev('b'),second);await index.verify(rev('a'),searchDescriptor(first));
  const query=(revision,term)=>db.prepare(`SELECT d.page FROM tv_search_fts JOIN tv_search_documents d ON d.rowid=tv_search_fts.rowid
    WHERE tv_search_fts MATCH ? AND EXISTS(SELECT 1 FROM tv_search_rules r WHERE r.revision=? AND r.document=d.id)`).all(term,revision);
  assert.equal(query(rev('a'),'deletemarker').length,1);assert.equal(query(rev('b'),'deletemarker').length,0);
  assert.equal(query(rev('a'),'oldmarker').length,1);assert.equal(query(rev('b'),'newmarker').length,1);
  await assert.rejects(index.stage(rev('a'),second),/different search/);
  const unchangedRevision=await index.stage(rev('c'),second);assert.equal(unchangedRevision.uploaded,0);assert.equal(unchangedRevision.reused,2);
  assert.throws(()=>db.prepare('UPDATE tv_search_rules SET from_date=? WHERE revision=?').run(12345,rev('c')),/immutable/);
  await index.verify(rev('c'),searchDescriptor(second));
});

sqliteTest('D1 visibility filtering happens before ranking/limits and phrases can span ordinary paragraphs',async t=>{
  const {db,adapter}=database();t.after(()=>db.close());
  const manifest=compileSearch(storeFor({'One.md':'First phrase.\n\nSecond paragraph.\n%%^Campaign:dufr%%campaignmarker%%^End%%\n%% privatepopup %%'}));
  await new SearchIndex(adapter).stage(rev('a'),manifest);
  const sql=`SELECT d.text FROM tv_search_fts JOIN tv_search_documents d ON d.rowid=tv_search_fts.rowid WHERE tv_search_fts MATCH ? AND EXISTS(
    SELECT 1 FROM tv_search_rules r WHERE r.document=d.id AND r.revision=? AND r.from_date<=? AND (r.before_date IS NULL OR r.before_date>?)
    AND (r.dm IS NULL OR r.dm=?) AND NOT EXISTS(SELECT 1 FROM json_each(r.campaigns) c WHERE c.value NOT IN (SELECT value FROM json_each(?)))
    AND NOT EXISTS(SELECT 1 FROM json_each(r.except_campaigns) c WHERE c.value IN (SELECT value FROM json_each(?)))) LIMIT 5`;
  const query=(term,dm,campaigns)=>db.prepare(sql).all(term,rev('a'),17500101,17500101,dm,JSON.stringify(campaigns),JSON.stringify(campaigns));
  assert.equal(query('campaignmarker',0,[]).length,0);assert.equal(query('campaignmarker',0,['dufr']).length,1);
  assert.equal(query('privatepopup',0,['dufr']).length,0);assert.equal(query('privatepopup',1,[]).length,1);
  assert.equal(query('First AND paragraph',0,[]).length,1);
});

sqliteTest('foreign schemas and corrupt resumed text cannot become ready',async t=>{
  const foreign=database();t.after(()=>foreign.db.close());foreign.db.exec('CREATE TABLE unrelated(x)');
  await assert.rejects(new SearchIndex(foreign.adapter).ensure(),/nonempty/);
  const {db,adapter,fail}=database();t.after(()=>db.close());const index=new SearchIndex(adapter),m=compileSearch(storeFor({'One.md':'Original'}));
  fail(sql=>sql.startsWith('INSERT INTO tv_search_rules'));await assert.rejects(index.stage(rev('a'),m));
  db.exec('DROP TRIGGER tv_search_immutable');db.prepare('UPDATE tv_search_documents SET text=?').run('Tampered stored content');
  await assert.rejects(index.stage(rev('a'),m),/content hash/);
  await assert.rejects(index.verify(rev('a'),searchDescriptor(m)),/not ready/);
});

test('publisher gates activation and unchanged skips on D1 readiness; build-only never touches D1',async()=>{
  const manifest=compileSearch(storeFor({'One.md':'Content'})),search=searchDescriptor(manifest),state={repository:'github.com/example/vault',commit:'a'.repeat(40),dirty:false};
  const harness=(overrides={})=>{
    const calls=[],deps={repositoryState:async()=>state,readCheckpoint:async()=>null,build:async()=>({revision:rev('a'),search}),
      upload:async()=>{calls.push('upload');},stageSearch:async()=>{calls.push('stage');},verifySearch:async()=>{calls.push('verify');},
      writeCheckpoint:async value=>{validateCheckpoint(value);calls.push('activate');},recordBuild:async()=>{},log:()=>{},...overrides};return {calls,deps};
  };
  const h=harness();const result=await publishContent({fingerprint:rev('b')},h.deps);assert.deepEqual(h.calls,['upload','stage','verify','activate']);assert.deepEqual(result.search,search);
  for(const failure of ['stageSearch','verifySearch']){
    const h=harness({[failure]:async()=>{throw new Error('D1 failure');}});await assert.rejects(publishContent({},h.deps),/D1 failure/);assert.ok(!h.calls.includes('activate'));
  }
  const skip=harness({readCheckpoint:async()=>result});assert.equal((await publishContent({fingerprint:rev('b')},skip.deps)).skipped,true);assert.deepEqual(skip.calls,['verify']);
  const build=harness({stageSearch:async()=>{throw Error('Must not stage');},verifySearch:async()=>{throw Error('Must not query');}});
  await publishContent({buildOnly:true},build.deps);assert.deepEqual(build.calls,[]);
});

test('production credentials never enable Wrangler auth logging, and configured accounts/resources cannot be silently retargeted',async()=>{
  const account='a'.repeat(32),id='11111111-1111-4111-8111-111111111111',config={account_id:account,d1_databases:[{binding:SEARCH_BINDING,database_name:SEARCH_DATABASE,database_id:id}]};
  assert.equal(searchBinding(config).database_id,id);assert.throws(()=>searchBinding({}),/Configure/);
  assert.throws(()=>searchBinding({d1_databases:[{...config.d1_databases[0],database_name:'taelgarverse-search-pilot'}]}),/Configure/);
  assert.throws(()=>searchCredentials(config,{CLOUDFLARE_ACCOUNT_ID:'b'.repeat(32)}),/disagree/);
  const auth=searchCredentials(config,{WRANGLER_WRITE_LOGS:'true'},(_command,args,opts)=>{
    assert.equal(opts.env.WRANGLER_WRITE_LOGS,'false');assert.deepEqual(opts.stdio,['ignore','pipe','pipe']);return JSON.stringify({token:'fake-secret'});
  });assert.equal(auth.token,'fake-secret');
  await assert.rejects(createSearchDatabase(config,{credentials:()=>auth,fetcher:async()=>Response.json({result:{name:'wrong',uuid:id}})}),/identity/);
  await assert.rejects(createSearchDatabase(config,{credentials:()=>auth,fetcher:async()=>Response.json({success:false,errors:[{code:10000,message:'fake-secret'}]},{status:403})}),error=>!error.message.includes('fake-secret'));
  const options={maxSize:2560,quality:82},settings={default_date:'1750-01-01'};
  assert.notEqual(buildFingerprint(settings,options,config),buildFingerprint(settings,options,{...config,d1_databases:[{...config.d1_databases[0],database_id:id.replace('1','2')}]}));
});

test('compiler retains both POV modes and publication fingerprints track the site default',()=>{
  const sources={'POV.md':'---\nPOV: 1740s\n---\nPerspective text.'};
  for (const settings of [{},{respect_pov_dates:false},{respect_pov_dates:true}]) {
    const manifest=validateSearchManifest(compileSearch(storeFor(sources,settings)));
    assert.deepEqual(manifest.rules.map(rule=>rule.from),[10101]);
  }
  const settings=testSettings(),options={maxSize:2560,quality:82};
  assert.notEqual(buildFingerprint({...settings,respect_pov_dates:false},options),buildFingerprint({...settings,respect_pov_dates:true},options));
});
