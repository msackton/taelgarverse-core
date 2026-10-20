import {createHash} from 'node:crypto';
import {authoredBody,availableInContext,availableFrom,publicationExclusions} from '../src/content-store.mjs';
import {filterComments} from '../src/comments.mjs';
import {createMarkdown,renderMarkdown} from '../src/markdown.mjs';
import {searchText} from '../src/search-text.mjs';

export const SEARCH_VERSION=1;
export const searchHash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const firstDate=10101;
const fullDate=key=>String(Math.floor(key/10000)).padStart(4,'0')+'-'+String(Math.floor(key/100)%100).padStart(2,'0')+'-'+String(key%100).padStart(2,'0');
export const documentHash=({page,title,aliases,text})=>searchHash({page,title,aliases,text});
export function searchDescriptor(manifest){return {version:manifest.version,digest:manifest.digest,documents:manifest.documents.length,rules:manifest.rules.length};}
const payload=manifest=>({version:manifest.version,documents:manifest.documents,rules:manifest.rules});
export function validateSearchManifest(manifest){
  if(manifest?.version!==SEARCH_VERSION || !Array.isArray(manifest.documents) || !Array.isArray(manifest.rules) || searchHash(payload(manifest))!==manifest.digest)throw new Error('Invalid search manifest/digest');
  const ids=new Set();
  for(const doc of manifest.documents){
    if(doc.id!==documentHash(doc) || ids.has(doc.id) || typeof doc.page!=='string' || !doc.page || typeof doc.title!=='string' || !Array.isArray(doc.aliases) || doc.aliases.some(a=>typeof a!=='string') || typeof doc.text!=='string' || Buffer.byteLength(JSON.stringify(doc))>1500000)throw new Error('Invalid or oversized search document');
    ids.add(doc.id);
  }
  for(const rule of manifest.rules){
    if(!ids.has(rule.document) || !Number.isInteger(rule.from) || rule.from<firstDate || rule.from>99991231 ||
       (rule.before!==null && (!Number.isInteger(rule.before) || rule.before<=rule.from || rule.before>99991231)) ||
       ![true,false,null].includes(rule.dm) || !Array.isArray(rule.campaigns) || !Array.isArray(rule.exceptCampaigns) ||
       [...rule.campaigns,...rule.exceptCampaigns].some(c=>typeof c!=='string' || !c || c!==c.trim().toLowerCase()) ||
       new Set([...rule.campaigns,...rule.exceptCampaigns]).size!==rule.campaigns.length+rule.exceptCampaigns.length)throw new Error('Invalid search visibility rule');
  }
  if(new Set(manifest.rules.map(r=>r.document)).size!==ids.size)throw new Error('Search documents must have visibility rules');
  return manifest;
}

export function compileSearch(store,{maxStatesPerNote=4096}={}){
  const documents=new Map(),rules=[],warnings=[],md=createMarkdown(),notesMarkdown=createMarkdown({html:false});
  let notes=0,states=0;
  for(const entry of [...store.bySlug.values()].sort((a,b)=>a.slug.localeCompare(b.slug))){
    const source=authoredBody(entry.note),conditions=[],localDocs=new Map(),localRules=[];
    const exclusions=publicationExclusions(entry.note.metadata);if(exclusions.includes('all'))continue;
    try{
      filterComments(source,{date:'0001-01-01',source:entry.id,conditions});
      const campaigns=[...new Set([...exclusions.filter(Boolean),...conditions.map(c=>c.campaign).filter(c=>c && c!=='none')])].sort();
      const from=availableFrom(entry),dates=[...new Set([firstDate,...(from?[from]:[]),...conditions.map(c=>c.date).filter(Boolean)])].sort((a,b)=>a-b);
      if(campaigns.length>10 || 2**campaigns.length*dates.length*2>maxStatesPerNote)throw new Error('Search state limit exceeded for '+entry.id+'; review the note before publishing');
      const selections=campaigns.reduce((all,c)=>[...all,...all.map(s=>[...s,c])],[[]]),cache=new Map();
      const raw=entry.note.metadata.aliases ?? [],aliases=(Array.isArray(raw)?raw:[raw]).map(String);
      for(let i=0;i<dates.length;i++)for(const selected of selections){
        const found=[];
        for(const dm of [false,true]){
          const context={date:fullDate(dates[i]),campaigns:selected,dm};states++;
          if(!availableInContext(entry,context)){found.push(null);continue;}
          const dmNotes=[],body=filterComments(source,{...context,source:entry.id,notes:dmNotes}),key=JSON.stringify([body,dmNotes]);
          let doc=cache.get(key);
          if(!doc){
            const rendered=renderMarkdown(md,body,{store,entry,date:context.date,context,dmNotes,notesMarkdown,noteEmbeds:[],warnings:[]});
            doc={page:entry.slug,title:entry.title,aliases,text:searchText(rendered.html)};doc={id:documentHash(doc),...doc};
            if(Buffer.byteLength(JSON.stringify(doc))>1500000)throw new Error('Search document exceeds 1.5 MB: '+entry.id);
            cache.set(key,doc);localDocs.set(doc.id,doc);
          }
          found.push(doc.id);
        }
        const policy={from:dates[i],before:dates[i+1] ?? null,campaigns:selected,exceptCampaigns:campaigns.filter(c=>!selected.includes(c))};
        if(found[0] && found[0]===found[1])localRules.push({document:found[0],...policy,dm:null});
        else for(let j=0;j<found.length;j++)if(found[j])localRules.push({document:found[j],...policy,dm:Boolean(j)});
      }
      // Merge adjacent date intervals with the same document/campaign/DM rule.
      const merged=new Map();
      for(const rule of localRules){
        const key=JSON.stringify([rule.document,rule.campaigns,rule.exceptCampaigns,rule.dm]),list=merged.get(key) || [],last=list.at(-1);
        if(last?.before===rule.from)last.before=rule.before;else list.push(rule);merged.set(key,list);
      }
      for(const [id,doc] of localDocs)documents.set(id,doc);
      rules.push(...[...merged.values()].flat());notes++;
    }catch(error){
      if(error.status!==422)throw error;
      warnings.push('Search omitted for '+entry.id+': '+error.reason);
    }
  }
  const manifest={version:SEARCH_VERSION,documents:[...documents.values()].sort((a,b)=>a.id.localeCompare(b.id)),
    rules:rules.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))};
  return {...manifest,digest:searchHash(manifest),stats:{notes,states,documents:documents.size,rules:rules.length,textBytes:[...documents.values()].reduce((n,d)=>n+Buffer.byteLength(d.text),0)},warnings};
}
