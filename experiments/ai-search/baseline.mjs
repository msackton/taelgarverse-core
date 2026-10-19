import fs from 'node:fs';
import path from 'node:path';
import {CloudflareError} from './cloudflare.mjs';
import {OWNER} from './corpus.mjs';
import {readJSON,writeJSON} from './runner.mjs';

export const D1_DATABASE='taelgarverse-search-pilot';
const VERSION='1';
const schema=[
  'CREATE TABLE tv_pilot_meta (owner TEXT PRIMARY KEY, version TEXT NOT NULL)',
  'CREATE TABLE tv_pilot_batches (run TEXT PRIMARY KEY, digest TEXT NOT NULL)',
  `CREATE TABLE tv_pilot_docs (key TEXT PRIMARY KEY, run TEXT NOT NULL, view TEXT NOT NULL,
    sha256 TEXT NOT NULL, title TEXT NOT NULL, aliases TEXT NOT NULL, names TEXT NOT NULL, body TEXT NOT NULL)`,
  'CREATE INDEX tv_pilot_scope ON tv_pilot_docs(run,view)',
  `CREATE VIRTUAL TABLE tv_pilot_fts USING fts5(title,aliases,body,content='tv_pilot_docs',content_rowid='rowid',tokenize='unicode61 remove_diacritics 2')`,
  `CREATE TRIGGER tv_pilot_insert AFTER INSERT ON tv_pilot_docs BEGIN
    INSERT INTO tv_pilot_fts(rowid,title,aliases,body) VALUES(new.rowid,new.title,new.aliases,new.body); END`,
  `CREATE TRIGGER tv_pilot_delete AFTER DELETE ON tv_pilot_docs BEGIN
    INSERT INTO tv_pilot_fts(tv_pilot_fts,rowid,title,aliases,body) VALUES('delete',old.rowid,old.title,old.aliases,old.body); END`,
  `CREATE TRIGGER tv_pilot_update AFTER UPDATE ON tv_pilot_docs BEGIN
    INSERT INTO tv_pilot_fts(tv_pilot_fts,rowid,title,aliases,body) VALUES('delete',old.rowid,old.title,old.aliases,old.body);
    INSERT INTO tv_pilot_fts(rowid,title,aliases,body) VALUES(new.rowid,new.title,new.aliases,new.body); END`,
];
export const normalizeName=text=>String(text).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.join(' ') || '';
export function namesFor(doc){
  // Original prepared batches contain aliases in the compiler's second line.
  const line=doc.text.split('\n')[1] || '';
  return [doc.title,...(doc.aliases ?? (line.startsWith('Aliases: ') ? line.slice(9).split('; ') : []))];
}
export const exactName=(page,batch,query)=>namesFor(batch.documents.find(d=>d.page===page) || {title:'',text:''}).some(n=>normalizeName(n)===normalizeName(query));
export function ftsQuery(query,match='and'){
  if(typeof query!=='string' || !query.trim() || query.length>1000)throw new Error('Query must contain 1–1000 characters');
  if(!['and','or'].includes(match))throw new Error('Invalid keyword match mode');
  if((query.match(/"/g) || []).length%2)throw new Error('Close the quoted search phrase');
  const terms=(query.match(/"[^"]*"|[\p{L}\p{N}]+/gu) || []).map(normalizeName).filter(Boolean);
  if(terms.length>64)throw new Error('Use at most 64 search terms');
  // Every term/phrase is quoted, so FTS operators remain literal.
  return [...new Set(terms)].map(term=>'"'+term+'"').join(match==='and'?' AND ':' OR ');
}
const metrics=results=>({requests:1,rowsRead:results.reduce((n,r)=>n+(r.meta?.rows_read || 0),0),
  rowsWritten:results.reduce((n,r)=>n+(r.meta?.rows_written || 0),0),sqlMs:results.reduce((n,r)=>n+(r.meta?.duration || 0),0),
  sizeBytes:results.at(-1)?.meta?.size_after ?? null});
export function recordD1Usage(root,account,usage){
  const file=path.join(root,'metrics',account+'.json');fs.mkdirSync(path.dirname(file),{recursive:true});
  const lock=file+'.lock',fd=fs.openSync(lock,'wx');
  try{
    const previous=fs.existsSync(file)?readJSON(file):{requests:0,rowsRead:0,rowsWritten:0,sqlMs:0};
    for(const field of ['requests','rowsRead','rowsWritten','sqlMs']){
      if(!Number.isFinite(usage[field]) || usage[field]<0 || !Number.isFinite(previous[field]) || previous[field]<0)throw new Error('Invalid D1 usage metrics');
    }
    const next={...usage,updatedAt:new Date().toISOString()};
    for(const field of ['requests','rowsRead','rowsWritten','sqlMs'])next[field]+=previous[field];
    writeJSON(file,next);return next;
  }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}

// The local harness uses the management API. Production should use a D1 binding.
export class D1PilotClient {
  constructor({account,token,fetcher=fetch,reserveUsage=()=>{},onUsage=()=>{}}){
    if(!/^[a-f0-9]{32}$/.test(account || '') || !token)throw new Error('Missing D1 pilot credentials');
    this.account=account;this.fetcher=fetcher;this.headers={Authorization:'Bearer '+token};this.reserveUsage=reserveUsage;this.onUsage=onUsage;
    this.base='https://api.cloudflare.com/client/v4/accounts/'+account+'/d1/database';
  }
  async request(suffix='',body){
    let response;
    try{response=await this.fetcher(this.base+suffix,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(30000),
      headers:{...this.headers,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});}
    catch{throw new Error('D1 pilot request could not complete; check status before retrying');}
    let data;try{data=await response.json();}catch{throw new CloudflareError(response.status);}
    if(!response.ok || data.success===false || (Array.isArray(data.result) && data.result.some(r=>r.success===false)))throw new CloudflareError(response.status,(data.errors || []).map(e=>e.code));
    return data;
  }
  async connect(create=false){
    if(this.database)return this.database;
    const data=await this.request('?name='+D1_DATABASE+'&per_page=100');
    if(!Array.isArray(data.result))throw new Error('Unexpected D1 database list');
    const matches=data.result.filter(d=>d.name===D1_DATABASE);
    if(matches.length>1)throw new Error('Ambiguous pilot database name');
    let database=matches[0];
    if(!database && create)database=(await this.request('',{name:D1_DATABASE,primary_location_hint:'enam'})).result;
    if(!database)throw new Error('Create the D1 pilot with baseline-init or baseline-upload first');
    if(database.name!==D1_DATABASE || !/^[a-f0-9-]{36}$/.test(database.uuid || ''))throw new Error('Invalid D1 pilot identity');
    this.database=database;return database;
  }
  async query(statements){
    if(!this.database)throw new Error('Connect to the named D1 pilot first');
    this.reserveUsage({queries:1});
    const data=await this.request('/'+this.database.uuid+'/query',{batch:statements});
    if(!Array.isArray(data.result) || data.result.length!==statements.length || data.result.some(r=>r.success!==true || !Array.isArray(r.results)))throw new Error('Unexpected D1 query response');
    const usage=metrics(data.result);this.onUsage(usage);return {results:data.result,usage};
  }
  async ensure(){
    await this.connect(true);
    const {results}=await this.query([{sql:"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"}]);
    if(results[0].results.some(r=>r.name==='tv_pilot_meta')){
      const check=await this.query([{sql:'SELECT owner,version FROM tv_pilot_meta'}]);
      if(check.results[0].results.length!==1 || check.results[0].results[0].owner!==OWNER || check.results[0].results[0].version!==VERSION)throw new Error('Existing D1 pilot has incompatible ownership/schema');
    }else{
      if(results[0].results.length)throw new Error('Refusing to initialize a nonempty database without the pilot ownership marker');
      await this.query([...schema.map(sql=>({sql})),{sql:'INSERT INTO tv_pilot_meta(owner,version) VALUES(?,?)',params:[OWNER,VERSION]}]);
    }
    return this.database;
  }
  async sync(batch){
    await this.ensure();
    const existing=await this.query([{sql:'SELECT key,sha256 FROM tv_pilot_docs WHERE run=?',params:[batch.run]},
      {sql:'SELECT digest FROM tv_pilot_batches WHERE run=?',params:[batch.run]}]);
    const byKey=new Map(existing.results[0].results.map(r=>[r.key,r.sha256]));
    const changed=batch.documents.filter(d=>byKey.get(d.key)!==d.sha256),keys=new Set(batch.documents.map(d=>d.key));
    const deleted=[...byKey.keys()].filter(k=>!keys.has(k)).length;
    const report={run:batch.run,digest:batch.digest,uploaded:changed.length,unchanged:batch.documents.length-changed.length,deleted};
    if(changed.length || deleted || existing.results[1].results[0]?.digest!==batch.digest){
      const docs=changed.map(d=>({key:d.key,run:batch.run,view:d.view,sha256:d.sha256,title:d.title,
        aliases:namesFor(d).slice(1).join('\n'),names:JSON.stringify(namesFor(d).map(normalizeName)),body:d.text}));
      if(Buffer.byteLength(JSON.stringify(docs))>1500000)throw new Error('D1 pilot payload exceeds 1.5 MB; use a smaller sample');
      const written=await this.query([
        {sql:`INSERT INTO tv_pilot_docs(key,run,view,sha256,title,aliases,names,body)
          SELECT json_extract(value,'$.key'),json_extract(value,'$.run'),json_extract(value,'$.view'),json_extract(value,'$.sha256'),
            json_extract(value,'$.title'),json_extract(value,'$.aliases'),json_extract(value,'$.names'),json_extract(value,'$.body')
          FROM json_each(?) WHERE true ON CONFLICT(key) DO UPDATE SET sha256=excluded.sha256,title=excluded.title,
            aliases=excluded.aliases,names=excluded.names,body=excluded.body`,params:[JSON.stringify(docs)]},
        {sql:'DELETE FROM tv_pilot_docs WHERE run=? AND key NOT IN (SELECT value FROM json_each(?))',params:[batch.run,JSON.stringify([...keys])]},
        {sql:'INSERT INTO tv_pilot_batches(run,digest) VALUES(?,?) ON CONFLICT(run) DO UPDATE SET digest=excluded.digest',params:[batch.run,batch.digest]}
      ]);report.usage=written.usage;
    }else report.usage={requests:0,rowsRead:0,rowsWritten:0,sqlMs:0};
    return {...report,account:this.account,database:D1_DATABASE,completedAt:new Date().toISOString()};
  }
  async reset(run){
    if(!/^(article|passages)-[a-f0-9]{16}$/.test(run || ''))throw new Error('Reset requires an explicit pilot batch');
    await this.ensure();return this.query([{sql:'DELETE FROM tv_pilot_docs WHERE run=?',params:[run]},
      {sql:'DELETE FROM tv_pilot_batches WHERE run=?',params:[run]}]);
  }
  async search(batch,view,query,{keywordMatch='and'}={}){
    if(!batch.views.some(v=>v.id===view))throw new Error('Unknown view for this batch');
    const match=ftsQuery(query,keywordMatch),start=performance.now();await this.connect();
    const statements=[{sql:'SELECT digest FROM tv_pilot_batches WHERE run=?',params:[batch.run]}];
    if(match)statements.push({sql:`SELECT d.key,d.sha256,bm25(tv_pilot_fts,12,8,1) AS rank,
      snippet(tv_pilot_fts,2,'','','',48) AS excerpt,
      EXISTS(SELECT 1 FROM json_each(d.names) WHERE value=?) AS exact
      FROM tv_pilot_fts JOIN tv_pilot_docs d ON d.rowid=tv_pilot_fts.rowid
      WHERE tv_pilot_fts MATCH ? AND d.run=? AND d.view=? ORDER BY exact DESC,rank,d.key LIMIT 100`,
      params:[normalizeName(query),match,batch.run,view]});
    const response=await this.query(statements);
    if(response.results[0].results[0]?.digest!==batch.digest)throw new Error('Sync this exact batch to D1 before searching');
    const docs=new Map(batch.documents.filter(d=>d.view===view).map(d=>[d.key,d])),pages=new Map();
    for(const row of response.results[1]?.results || []){
      const doc=docs.get(row.key),normalize=t=>String(t).replace(/\s+/g,' ').trim();
      if(!doc || row.sha256!==doc.sha256 || !normalize(doc.text).includes(normalize(row.excerpt)))throw new Error('D1 returned stale or out-of-view text; results withheld');
      if(!pages.has(doc.page))pages.set(doc.page,{page:doc.page,title:doc.title,url:doc.url,score:-row.rank,excerpt:row.excerpt,heading:doc.heading,provenance:['full-text']});
    }
    return {mode:'baseline',latencyMs:Math.round(performance.now()-start),pages:[...pages.values()].slice(0,30),usage:response.usage};
  }
}
