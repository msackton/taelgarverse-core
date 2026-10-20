import {RenderError,dateKey,pageUrl} from './common.mjs';
import {availableInContext} from './content-store.mjs';
import {searchType,searchTypes} from './search-types.mjs';

const OPEN='\ue000',CLOSE='\ue001';
const normalize=value=>String(value).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
const nameQuery=query=>normalize(query).replaceAll('"','').replace(/\s+/g,' ').trim();
function nameRank(entry,query){
  if(!query)return 2;
  const names=[entry.title,entry.name,entry.note.metadata.name].filter(Boolean);
  if(names.some(name=>nameQuery(name)===query))return 0;
  const raw=entry.note.metadata.aliases ?? [],aliases=Array.isArray(raw)?raw:[raw];
  return aliases.some(alias=>nameQuery(alias)===query)?1:2;
}
export function searchInput(query='',{limit=20,offset=0,type=''}={}){
  if(typeof query!=='string' || query.length>256)throw new RenderError(400,'Search must be at most 256 characters');
  limit=Number(limit);offset=Number(offset);
  if(!Number.isInteger(limit) || limit<1 || limit>50 || !Number.isInteger(offset) || offset<0 || offset>1000)throw new RenderError(400,'Search limit must be 1–50 and offset 0–1000');
  if(typeof type!=='string' || (type && !searchTypes.some(([value])=>value===type)))throw new RenderError(400,'Choose a valid content type');
  query=query.trim();
  if((query.match(/"/g) || []).length%2)throw new RenderError(400,'Close the quoted search phrase');
  const terms=[];
  for(const match of query.normalize('NFC').matchAll(/"([^"]*)"|([\p{L}\p{N}][\p{L}\p{N}\p{M}]*)/gu)){
    // Let unicode61 apply its own case/Latin-diacritic rules. Stripping every
    // combining mark here would incorrectly change Greek and other scripts.
    const phrase=match[1]!==undefined,words=(phrase?match[1]:match[2]).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu);
    if(words?.length)terms.push('"'+words.join(' ')+'"'+(phrase?'':'*'));
  }
  if(terms.length>16)throw new RenderError(400,'Use at most 16 search terms');
  return {query,limit,offset,type,match:[...new Set(terms)].join(' AND ')};
}
function result(entry,context,excerpt='',highlights=[]){return {page:entry.slug,title:entry.title,url:pageUrl(entry.slug,context.date,context),excerpt,highlights};}
export function pageNameSearch(store,input,context,notice){
  const query=nameQuery(input.query);
  const entries=[...store.bySlug.values()].filter(entry=>{
    const raw=entry.note.metadata.aliases || [],aliases=Array.isArray(raw)?raw:[raw];
    return availableInContext(entry,context) && (!input.type || searchType(entry)===input.type) &&
      nameQuery([entry.slug,entry.name,entry.title,entry.note.metadata.name,...aliases].filter(Boolean).join(' ')).includes(query);
  }).sort((a,b)=>{
    return nameRank(a,query)-nameRank(b,query) || a.title.localeCompare(b.title) || a.slug.localeCompare(b.slug);
  });
  return {query:input.query,type:input.type,context,source:'page-names',fallback:Boolean(notice),...(notice?{notice}:{}),limit:input.limit,offset:input.offset,
    hasMore:entries.length>input.offset+input.limit,results:entries.slice(input.offset,input.offset+input.limit).map(e=>result(e,context))};
}
export async function searchPages(engine,provider,input,context){
  // Browsing/punctuation-only queries never scan the FTS index or load bodies.
  if(!input.match)return pageNameSearch(engine.store,input,context);
  if(provider){
    try{return await provider(input,context);}
    catch{
      // Query text, excerpts, and raw provider errors must not enter logs.
      console.warn(JSON.stringify({event:'search-unavailable'}));
    }
  }
  return pageNameSearch(engine.store,input,context,'Full-text search is temporarily unavailable. Showing matching page names.');
}
function excerptParts(marked){
  let text='',start=null;const highlights=[];
  for(const character of marked){
    if(character===OPEN){if(start===null)start=text.length;}
    else if(character===CLOSE){if(start!==null){highlights.push({start,end:text.length});start=null;}}
    else text+=character;
  }
  if(start!==null)highlights.push({start,end:text.length});
  return {excerpt:text,highlights};
}

// Read-only: neither request handler nor local query code mutates publication
// state. The caller supplies a binding/query adapter for this request only.
export function createIndexSearch(query,{revision,descriptor,store}){
  return async(input,context)=>{
    if(!/^[a-f0-9]{64}$/.test(revision || '') || descriptor?.version!==1 || !/^[a-f0-9]{64}$/.test(descriptor.digest || '') ||
      !Number.isSafeInteger(descriptor.documents) || descriptor.documents<0 || !Number.isSafeInteger(descriptor.rules) || descriptor.rules<0)throw new Error('Search revision descriptor unavailable');
    const day=dateKey(context.date),campaigns=JSON.stringify(context.campaigns);
    // Metadata is already in the revision snapshot. Pass only matching slugs,
    // so ranking and type filtering happen before LIMIT without a schema change
    // or reads of article bodies. JSON parameters avoid per-page SQL bindings.
    const exact=[],aliases=[],typed=[],name=nameQuery(input.query);
    for(const entry of store.bySlug.values()){
      const rank=nameRank(entry,name);
      if(rank===0)exact.push(entry.slug);else if(rank===1)aliases.push(entry.slug);
      if(input.type && searchType(entry)===input.type)typed.push(entry.slug);
    }
    const output=await query([
      {sql:`SELECT revision FROM tv_search_revisions WHERE revision=? AND state='ready' AND digest=? AND compiler=? AND documents=? AND rules=?
        AND EXISTS(SELECT 1 FROM tv_search_meta WHERE owner='taelgarverse-core-search' AND version IN (1,2))`,
        params:[revision,descriptor.digest,descriptor.version,descriptor.documents,descriptor.rules]},
      {sql:`SELECT d.page,d.title,bm25(tv_search_fts,10,6,1) AS rank,
        substr(snippet(tv_search_fts,2,?,?,' … ',36),1,1200) AS marked,
        CASE WHEN d.page IN (SELECT value FROM json_each(?)) THEN 0
          WHEN d.page IN (SELECT value FROM json_each(?)) THEN 1 ELSE 2 END AS exact
        FROM tv_search_fts JOIN tv_search_documents d ON d.rowid=tv_search_fts.rowid
        WHERE tv_search_fts MATCH ? ${input.type?'AND d.page IN (SELECT value FROM json_each(?))':''} AND EXISTS(
          SELECT 1 FROM tv_search_rules r JOIN tv_search_revisions v ON v.revision=r.revision
          WHERE r.document=d.id AND r.revision=? AND v.state='ready' AND v.digest=? AND r.from_date<=? AND (r.before_date IS NULL OR r.before_date>?)
          AND (r.dm IS NULL OR r.dm=?)
          AND NOT EXISTS(SELECT 1 FROM json_each(r.campaigns) c WHERE c.value NOT IN (SELECT value FROM json_each(?)))
          AND NOT EXISTS(SELECT 1 FROM json_each(r.except_campaigns) c WHERE c.value IN (SELECT value FROM json_each(?))))
        ORDER BY exact,rank,d.page LIMIT ? OFFSET ?`,
        params:[OPEN,CLOSE,JSON.stringify(exact),JSON.stringify(aliases),input.match,...(input.type?[JSON.stringify(typed)]:[]),
          revision,descriptor.digest,day,day,context.dm?1:0,campaigns,campaigns,input.limit+1,input.offset]},
    ]);
    if(!Array.isArray(output) || output.length!==2 || output.some(r=>r.success===false || !Array.isArray(r.results)) || output[0].results[0]?.revision!==revision)throw new Error('Search revision is not ready');
    const rows=output[1].results;
    if(rows.length>input.limit+1)throw new Error('Unbounded search response');
    const seen=new Set(),results=rows.map(row=>{
      const entry=store.bySlug.get(row.page);
      if(!availableInContext(entry,context) || (input.type && searchType(entry)!==input.type) || entry.title!==row.title || seen.has(row.page) || typeof row.marked!=='string' || row.marked.length>2400)throw new Error('Search result does not match this publication');
      seen.add(row.page);const {excerpt,highlights}=excerptParts(row.marked);return result(entry,context,excerpt,highlights);
    });
    return {query:input.query,type:input.type,context,source:'full-text',fallback:false,limit:input.limit,offset:input.offset,hasMore:rows.length>input.limit,results:results.slice(0,input.limit)};
  };
}

export function createD1Search(database,options){
  return async(input,context)=>{
    if(!database)throw new Error('Search binding unavailable');
    // Fresh request-local session sees the latest publication readiness, even
    // when D1 read replicas are enabled. No context/result cache is shared.
    const session=database.withSession?database.withSession('first-primary'):database;
    return createIndexSearch(statements=>session.batch(statements.map(({sql,params})=>session.prepare(sql).bind(...params))),options)(input,context);
  };
}
