import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {load} from 'cheerio';
import {authoredBody,availableInContext} from '../../src/content-store.mjs';
import {filterComments} from '../../src/comments.mjs';
import {createMarkdown,renderMarkdown} from '../../src/markdown.mjs';
import {pageUrl} from '../../src/common.mjs';

const {get_encoding}=createRequire(import.meta.url)('tiktoken');
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const PILOT_INSTANCE='taelgarverse-search-pilot';
export const OWNER='taelgarverse-core-pilot';
export const MODES=['keyword','vector','hybrid'];
const validId=value=>typeof value==='string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(value);
export function tokenizer() {
  const encoder=get_encoding('cl100k_base');
  return {encode:text=>encoder.encode(text,[],[]),count:text=>encoder.encode(text,[],[]).length,
    decode:ids=>new TextDecoder().decode(encoder.decode(Uint32Array.from(ids))),free:()=>encoder.free()};
}
export function validateConfig(config) {
  if(config.experiment && !validId(config.experiment))throw new Error('Invalid pilot experiment name');
  if(config.siteUrl && !/^https?:$/.test(new URL(config.siteUrl).protocol))throw new Error('Pilot siteUrl must use HTTP or HTTPS');
  if (!Array.isArray(config.notes) || !config.notes.length || new Set(config.notes).size!==config.notes.length ||
      config.notes.some(id=>typeof id!=='string' || !id.endsWith('.md') || id.includes('\\') || id.split('/').some(p=>!p || p==='.' || p==='..'))) {
    throw new Error('Pilot notes must be a nonempty allowlist of unique, exact relative Markdown paths');
  }
  for (const key of ['notes','batchTokens','totalTokens','queries']) {
    if (!Number.isSafeInteger(config.limits?.[key]) || config.limits[key]<1) throw new Error('Invalid pilot limit: '+key);
  }
  if (config.notes.length>config.limits.notes) throw new Error('Pilot note limit exceeded');
  if (!Array.isArray(config.views) || !config.views.length || new Set(config.views.map(v=>v.id)).size!==config.views.length ||
      config.views.some(v=>!validId(v.id) || typeof v.dm!=='boolean' || typeof v.campaigns!=='string')) throw new Error('Invalid pilot views');
  return config;
}

// Extract rendered prose, rather than indexing comment markers, generated UI,
// hidden HTML, Dataview source, Mermaid source, or an embedded note's body.
export function proseSections(html) {
  const $=load(html,{},false);
  $('script,style,template,svg,button,.dm-note-ref,.dm-note-header,.dm-block-label,.mermaid-diagram').remove();
  $('.admonition.warning').filter((_,el)=>$(el).find('.admonition-title').text()==='Dynamic content unavailable').remove();
  $('[hidden],[aria-hidden="true"]').remove();
  const sections=[];
  let heading='', text='';
  const flush=()=>{const value=text.replace(/[\t \r]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
    if(value)sections.push({heading,text:value});text='';};
  const walk=node=>{
    if(node.type==='text'){text+=node.data;return;}
    const tag=node.name || '';
    if(/^h[1-6]$/.test(tag)){flush();heading=$(node).text().trim();return;}
    const block=/^(p|div|li|tr|table|blockquote|pre|ul|ol|section|article)$/.test(tag);
    if(block)text+='\n\n';
    for(const child of node.children || [])walk(child);
    if(block)text+='\n\n';
  };
  for(const node of $.root().contents().toArray())walk(node);
  flush();return sections;
}

function pieces(sections,{style,chunkTokens,overlapTokens},codec,prefix) {
  if(style==='article')return [{heading:'',text:prefix+sections.map(s=>(s.heading ? s.heading+'\n\n' : '')+s.text).join('\n\n')}];
  const result=[];
  for(const section of sections){
    const intro=prefix+(section.heading ? 'Section: '+section.heading+'\n\n' : '');
    const budget=chunkTokens-codec.count(intro)-(overlapTokens ? overlapTokens+4 : 0);
    if(budget<32 || overlapTokens>=budget)throw new Error('Title/aliases leave too little space in a passage');
    let current='';
    const emit=()=>{if(current.trim())result.push({heading:section.heading,text:intro+current.trim()});current='';};
    for(const paragraph of section.text.split(/\n\n+/)){
      if(codec.count(current+'\n\n'+paragraph)<=budget){current+=(current ? '\n\n' : '')+paragraph;continue;}
      emit();
      const ids=codec.encode(paragraph);
      if(ids.length<=budget){current=paragraph;continue;}
      // Split an unusually long paragraph without cutting UTF-8 characters.
      for(let start=0;start<ids.length;){
        let end=Math.min(ids.length,start+budget), decoded=codec.decode(ids.slice(start,end));
        while(end>start && decoded.endsWith('\ufffd'))decoded=codec.decode(ids.slice(start,--end));
        if(end<=start)throw new Error('Cannot split passage at a UTF-8 boundary');
        result.push({heading:section.heading,text:intro+decoded});
        if(end===ids.length)break;
        start=end;
      }
    }
    emit();
  }
  if(overlapTokens)for(let i=result.length-1;i>0;i--){
    if(result[i-1].heading!==result[i].heading)continue;
    const intro=prefix+(result[i].heading ? 'Section: '+result[i].heading+'\n\n' : '');
    const ids=codec.encode(result[i-1].text.slice(intro.length));let start=Math.max(0,ids.length-overlapTokens);
    while(start<ids.length && codec.decode(ids.slice(start)).startsWith('\ufffd'))start++;
    result[i].text=intro+codec.decode(ids.slice(start))+'\n\n'+result[i].text.slice(intro.length);
  }
  return result;
}

export function prepareCorpus({store,contexts,config,views=['public-all'],style='article',chunkTokens=600,overlapTokens=0,codec}) {
  validateConfig(config);
  if(!['article','passages'].includes(style))throw new Error('Style must be article or passages');
  if(!Number.isInteger(chunkTokens) || chunkTokens<128 || chunkTokens>2048 || !Number.isInteger(overlapTokens) ||
      overlapTokens<0 || overlapTokens>Math.floor(chunkTokens*.3))throw new Error('Invalid passage size or overlap');
  if(new Set(views).size!==views.length || !views.length)throw new Error('Select unique pilot views');
  const selected=views.map(id=>{const view=config.views.find(v=>v.id===id);if(!view)throw new Error('Unknown pilot view: '+id);
    return {...view,context:{...contexts.resolve('custom',view.date,view.campaigns),dm:view.dm}};});
  const options={style,chunkTokens,overlapTokens,...(config.experiment ? {experiment:config.experiment} : {}),views:selected.map(v=>({id:v.id,context:v.context}))};
  const run=style+'-'+hash(JSON.stringify(options)).slice(0,16);
  const md=createMarkdown(), notesMarkdown=createMarkdown({html:false}), documents=[], warnings=[], sources=[];
  const byId=new Map(store.entries.filter(e=>e.note).map(e=>[e.id,e]));
  for(const id of config.notes){
    const entry=byId.get(id);if(!entry)throw new Error('Allowlisted note is not in the website store: '+id);
    sources.push({id,sha256:hash(entry.note.source)});
    const start=documents.length;
    try{
      for(const view of selected){
        if(!availableInContext(entry,view.context))continue;
        const dmNotes=[], filtered=filterComments(authoredBody(entry.note),{...view.context,source:id,notes:dmNotes});
        const rendered=renderMarkdown(md,filtered,{store,entry,date:view.context.date,context:view.context,notesMarkdown,dmNotes,noteEmbeds:[],warnings:[]});
        const sections=proseSections(rendered.html);
        const raw=entry.note.metadata.aliases ?? [], aliases=(Array.isArray(raw)?raw:[raw]).map(String);
        const prefix=entry.title+'\n'+(aliases.length ? 'Aliases: '+aliases.join('; ')+'\n' : '')+'\n';
        const parts=pieces(sections,options,codec,prefix);
        for(let i=0;i<parts.length;i++){
          const {text,heading}=parts[i], sha256=hash(text);
          documents.push({key:'tvpilot/'+run+'/'+view.id+'/'+hash(entry.slug).slice(0,16)+'-'+i+'.txt',
            page:entry.slug,title:entry.title,source:id,sourceHash:hash(entry.note.source),view:view.id,heading,
            url:config.siteUrl ? new URL(pageUrl(entry.slug,view.context.date,view.context),config.siteUrl).href : pageUrl(entry.slug,view.context.date,view.context),sha256,text,tokens:codec.count(text),
            metadata:{owner:OWNER,run,view:view.id,sha256}});
        }
      }
    }catch(error){
      if(error.status!==422)throw error;
      documents.splice(start);warnings.push({source:id,reason:error.reason || 'Unsafe comment syntax'});
    }
  }
  const tokens=documents.reduce((n,d)=>n+d.tokens,0);
  if(!documents.length)throw new Error('Pilot export contains no documents');
  if(tokens>config.limits.batchTokens)throw new Error('Batch token limit exceeded: '+tokens+' > '+config.limits.batchTokens+'; select fewer views/notes');
  return {version:1,instance:PILOT_INSTANCE,run,options,views:selected,sources,documents,tokens,warnings,limits:config.limits,
    digest:hash(JSON.stringify(documents.map(({key,sha256})=>({key,sha256}))))};
}
