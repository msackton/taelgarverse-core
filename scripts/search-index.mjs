import fs from 'node:fs';
import {SEARCH_VERSION,searchHash,documentHash,validateSearchManifest,searchDescriptor} from './compile-search.mjs';

const OWNER='taelgarverse-core-search',SCHEMA=1;
const schema=[
  'CREATE TABLE tv_search_meta(owner TEXT PRIMARY KEY,version INTEGER NOT NULL)',
  `CREATE TABLE tv_search_revisions(revision TEXT PRIMARY KEY,digest TEXT NOT NULL,compiler INTEGER NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('staging','ready')),documents INTEGER NOT NULL,rules INTEGER NOT NULL)`,
  `CREATE TABLE tv_search_documents(id TEXT PRIMARY KEY,page TEXT NOT NULL,title TEXT NOT NULL,aliases TEXT NOT NULL,text TEXT NOT NULL)`,
  `CREATE VIRTUAL TABLE tv_search_fts USING fts5(title,aliases,text,content='tv_search_documents',content_rowid='rowid',tokenize='unicode61 remove_diacritics 2')`,
  `CREATE TRIGGER tv_search_insert AFTER INSERT ON tv_search_documents BEGIN
    INSERT INTO tv_search_fts(rowid,title,aliases,text) VALUES(new.rowid,new.title,new.aliases,new.text); END`,
  `CREATE TRIGGER tv_search_immutable BEFORE UPDATE ON tv_search_documents BEGIN SELECT RAISE(ABORT,'Search documents are immutable'); END`,
  `CREATE TABLE tv_search_rules(revision TEXT NOT NULL REFERENCES tv_search_revisions(revision),ordinal INTEGER NOT NULL,
    document TEXT NOT NULL REFERENCES tv_search_documents(id),from_date INTEGER NOT NULL,before_date INTEGER,
    campaigns TEXT NOT NULL,except_campaigns TEXT NOT NULL,dm INTEGER CHECK(dm IS NULL OR dm IN (0,1)),PRIMARY KEY(revision,ordinal))`,
  'CREATE INDEX tv_search_scope ON tv_search_rules(revision,document)',
  `CREATE TRIGGER tv_search_rule_insert BEFORE INSERT ON tv_search_rules WHEN
    (SELECT state FROM tv_search_revisions WHERE revision=new.revision)<>'staging'
    BEGIN SELECT RAISE(ABORT,'Ready search membership is immutable'); END`,
  `CREATE TRIGGER tv_search_rule_update BEFORE UPDATE ON tv_search_rules BEGIN SELECT RAISE(ABORT,'Search membership is immutable'); END`,
  `CREATE TRIGGER tv_search_rule_delete BEFORE DELETE ON tv_search_rules WHEN
    (SELECT state FROM tv_search_revisions WHERE revision=old.revision)='ready'
    BEGIN SELECT RAISE(ABORT,'Ready search membership is immutable'); END`,
  `CREATE TRIGGER tv_search_revision_immutable BEFORE UPDATE ON tv_search_revisions WHEN old.state='ready'
    BEGIN SELECT RAISE(ABORT,'Ready search revisions are immutable'); END`,
];
const validRevision=revision=>{if(!/^[a-f0-9]{64}$/.test(revision || ''))throw new Error('Invalid search content revision');};
export function validateSearchDescriptor(search){
  if(search?.version!==SEARCH_VERSION || !/^[a-f0-9]{64}$/.test(search.digest || '') || !Number.isSafeInteger(search.documents) || search.documents<0 || !Number.isSafeInteger(search.rules) || search.rules<0)throw new Error('Invalid search descriptor');
  return search;
}
export function readPreparedSearch(report){
  validRevision(report.revision);validateSearchDescriptor(report.search);
  const manifest=validateSearchManifest(JSON.parse(fs.readFileSync(report.searchFile,'utf8')));
  if(JSON.stringify(searchDescriptor(manifest))!==JSON.stringify(report.search))throw new Error('Prepared search descriptor does not match its manifest');
  const index=JSON.parse(fs.readFileSync(report.indexFile,'utf8'));
  if(index.revision!==report.revision || JSON.stringify(index.search)!==JSON.stringify(report.search))throw new Error('Search manifest is not associated with this R2 content revision');
  return manifest;
}
// Keep JSON parameters comfortably below D1's 2 MB bound-value limit. Large
// individual documents remain one whole-note row so multiword/phrase semantics
// do not accidentally become passage-only search.
function chunks(items,maxBytes=500000){
  const batches=[];let batch=[],bytes=2;
  for(const item of items){const size=Buffer.byteLength(JSON.stringify(item))+1;
    if(batch.length && (bytes+size>maxBytes || batch.length>=250)){batches.push(batch);batch=[];bytes=2;}
    batch.push(item);bytes+=size;
  }
  if(batch.length)batches.push(batch);return batches;
}
export class SearchIndex {
  constructor(database,{log=()=>{}}={}){this.database=database;this.log=log;this.usage={requests:0,rowsRead:0,rowsWritten:0,sqlMs:0};}
  async query(statements){
    const result=await this.database.query(statements);
    if(!Array.isArray(result) || result.length!==statements.length || result.some(r=>r.success===false || !Array.isArray(r.results)))throw new Error('Unexpected D1 search results');
    this.usage.requests++;
    for(const r of result){this.usage.rowsRead+=r.meta?.rows_read || 0;this.usage.rowsWritten+=r.meta?.rows_written || 0;this.usage.sqlMs+=r.meta?.duration || 0;}
    return result.map(r=>r.results);
  }
  async ensure(){
    const [tables]=await this.query([{sql:"SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'"}]);
    if(tables.some(t=>t.name==='tv_search_meta')){
      const [rows]=await this.query([{sql:'SELECT owner,version FROM tv_search_meta'}]);
      if(rows.length!==1 || rows[0].owner!==OWNER || rows[0].version!==SCHEMA)throw new Error('Incompatible search database ownership/schema');
    }else{
      if(tables.length)throw new Error('Refusing to initialize a nonempty database without the production search marker');
      await this.query([...schema.map(sql=>({sql})),{sql:'INSERT INTO tv_search_meta VALUES(?,?)',params:[OWNER,SCHEMA]}]);
    }
  }
  async verify(revision,descriptor){
    validRevision(revision);validateSearchDescriptor(descriptor);
    const [rows]=await this.query([{sql:`SELECT r.*,(SELECT COUNT(*) FROM tv_search_rules s WHERE s.revision=r.revision) AS rule_count,
      (SELECT COUNT(DISTINCT s.document) FROM tv_search_rules s JOIN tv_search_documents d ON d.id=s.document WHERE s.revision=r.revision) AS document_count
      FROM tv_search_revisions r WHERE revision=?`,params:[revision]}]);
    const row=rows[0];
    if(!row || row.state!=='ready' || row.digest!==descriptor.digest || row.compiler!==descriptor.version || row.rules!==descriptor.rules || row.documents!==descriptor.documents || row.rule_count!==descriptor.rules || row.document_count!==descriptor.documents)throw new Error('Search index is not ready for content revision '+revision.slice(0,12));
    return {revision,...descriptor,database:this.database.identity,ready:true};
  }
  async stage(revision,manifest){
    validRevision(revision);validateSearchManifest(manifest);const descriptor=searchDescriptor(manifest),start={...this.usage};
    await this.ensure();
    let [existing]=await this.query([{sql:'SELECT * FROM tv_search_revisions WHERE revision=?',params:[revision]}]);
    if(existing.length && (existing[0].digest!==manifest.digest || existing[0].compiler!==manifest.version || existing[0].documents!==descriptor.documents || existing[0].rules!==descriptor.rules))throw new Error('An immutable content revision already has a different search manifest');
    if(existing[0]?.state==='ready')return {...await this.verify(revision,descriptor),uploaded:0,reused:manifest.documents.length,resumed:true,usage:this.delta(start)};
    await this.query([{sql:"INSERT INTO tv_search_revisions VALUES(?,?,?,'staging',?,?) ON CONFLICT(revision) DO NOTHING",params:[revision,manifest.digest,manifest.version,descriptor.documents,descriptor.rules]}]);
    let uploaded=0,reused=0;
    for(const group of chunks(manifest.documents)){
      const [rows]=await this.query([{sql:'SELECT id FROM tv_search_documents WHERE id IN (SELECT value FROM json_each(?))',params:[JSON.stringify(group.map(d=>d.id))]}]);
      const present=new Set(rows.map(r=>r.id)),missing=group.filter(d=>!present.has(d.id));reused+=present.size;
      if(missing.length){
        await this.query([{sql:`INSERT INTO tv_search_documents(id,page,title,aliases,text)
          SELECT json_extract(value,'$.id'),json_extract(value,'$.page'),json_extract(value,'$.title'),json_extract(value,'$.aliases'),json_extract(value,'$.text')
          FROM json_each(?) WHERE true ON CONFLICT(id) DO NOTHING`,params:[JSON.stringify(missing.map(d=>({...d,aliases:JSON.stringify(d.aliases)})))]}]);uploaded+=missing.length;
      }
    }
    for(const group of chunks(manifest.rules.map((r,ordinal)=>({...r,ordinal})))){
      await this.query([{sql:`INSERT INTO tv_search_rules(revision,ordinal,document,from_date,before_date,campaigns,except_campaigns,dm)
        SELECT ?,json_extract(value,'$.ordinal'),json_extract(value,'$.document'),json_extract(value,'$.from'),json_extract(value,'$.before'),
          json_extract(value,'$.campaigns'),json_extract(value,'$.exceptCampaigns'),json_extract(value,'$.dm') FROM json_each(?)
        WHERE (SELECT state FROM tv_search_revisions WHERE revision=?)='staging' ON CONFLICT(revision,ordinal) DO NOTHING`,
        params:[revision,JSON.stringify(group.map(r=>({...r,campaigns:JSON.stringify(r.campaigns),exceptCampaigns:JSON.stringify(r.exceptCampaigns)}))),revision]}]);
    }
    // Read back exact membership and content, including resumed documents, in
    // bounded pages. Counts alone cannot prove that a partial upload is correct.
    const verifiedDocuments=[],verifiedRules=[];
    for(const group of chunks(manifest.documents)){
      const [rows]=await this.query([{sql:'SELECT * FROM tv_search_documents WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id',params:[JSON.stringify(group.map(d=>d.id))]}]);
      for(const row of rows){const doc={id:row.id,page:row.page,title:row.title,aliases:JSON.parse(row.aliases),text:row.text};if(documentHash(doc)!==doc.id)throw new Error('Stored search text failed its content hash');verifiedDocuments.push(doc);}
    }
    for(let offset=0;;offset+=500){
      const [rows]=await this.query([{sql:'SELECT * FROM tv_search_rules WHERE revision=? ORDER BY ordinal LIMIT 500 OFFSET ?',params:[revision,offset]}]);
      for(const r of rows)verifiedRules.push({document:r.document,from:r.from_date,before:r.before_date,campaigns:JSON.parse(r.campaigns),exceptCampaigns:JSON.parse(r.except_campaigns),dm:r.dm===null?null:Boolean(r.dm)});
      if(rows.length<500)break;
    }
    if(searchHash({version:SEARCH_VERSION,documents:verifiedDocuments,rules:verifiedRules})!==manifest.digest)throw new Error('Staged search membership failed verification; content remains inactive');
    await this.query([{sql:"INSERT INTO tv_search_fts(tv_search_fts,rank) VALUES('integrity-check',1)"},
      {sql:"UPDATE tv_search_revisions SET state='ready' WHERE revision=? AND digest=? AND state='staging'",params:[revision,manifest.digest]}]);
    const receipt=await this.verify(revision,descriptor);this.log('Search ready: '+descriptor.documents+' text versions; '+uploaded+' new, '+reused+' reused.');
    return {...receipt,uploaded,reused,resumed:Boolean(existing.length),usage:this.delta(start)};
  }
  delta(start){return Object.fromEntries(Object.keys(this.usage).map(k=>[k,this.usage[k]-start[k]]));}
}
