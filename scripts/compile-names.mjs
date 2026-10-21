import {parse} from 'yaml';
import {nameTypes,nameKey,nameId} from '../src/names.mjs';
import {codeRanges} from '../src/comments.mjs';
import {publicationExclusions} from '../src/content-store.mjs';

const text=value=>typeof value==='string' ? value.trim() : '';
const strings=value=>(Array.isArray(value)?value:typeof value==='string'?[value]:[]).map(text).filter(Boolean);
const language=value=>!text(value) || nameKey(value)==='unknown' ? 'Unknown' : text(value);
const field=(record,key,max=500)=>text(record?.[key]).slice(0,max);
const statuses=new Set(['documented','inferred','proposed','disputed','unresolved']);

export function parseNameMetadata(source) {
  const ranges=codeRanges(source),blocks=[];
  const pattern=/^%%\^Metadata:names:v1%%[ \t]*\n([\s\S]*?)^%%\^End%%[ \t]*(?:\n|$)/gm;
  for (const match of source.matchAll(pattern)) {
    if (ranges.some(([start,end])=>start<=match.index && match.index<end)) continue;
    const parsed=parse(match[1],{version:'1.2',maxAliasCount:100,uniqueKeys:true});
    if (!Array.isArray(parsed)) throw new Error('Name metadata must be a list');
    for (const entry of parsed) {
      if (!entry || typeof entry!=='object' || !field(entry,'name') || !field(entry,'language',120)) throw new Error('A name entry requires a name and language');
      blocks.push(entry);
    }
  }
  return blocks;
}

function mentioned(value,name) {
  const haystack=nameKey(value),needle=nameKey(name);
  let from=0;
  for (;;) {
    const at=haystack.indexOf(needle,from);
    if (at<0) return false;
    const before=haystack.slice(0,at).at(-1) || '',after=haystack.slice(at+needle.length)[0] || '';
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return true;
    from=at+needle.length;
  }
}

// The explorer covers the published vault independently of reader context.
// Only selected structured fields enter the index; editorial notes stay local.
export function compileNames(store,decisions=[]) {
  const entries=[],warnings=[];
  const bySubject=new Map();
  for (const decision of decisions) if (typeof decision.subject==='string') {
    const items=bySubject.get(decision.subject) || [];items.push(decision);bySubject.set(decision.subject,items);
  }
  for (const entry of store.bySlug.values()) {
    if (publicationExclusions(entry.note.metadata).includes('all')) continue;
    let metadata;
    try { metadata=parseNameMetadata(entry.note.source); }
    catch { warnings.push('Name metadata omitted for '+entry.id+': invalid names block');metadata=[]; }
    const whole=metadata.filter(item=>!['name component','component'].includes(nameKey(item.role)));
    const tags=strings(entry.note.metadata.tags).map(tag=>tag.replace(/^#/,'').split('/')[0]);
    const type=nameTypes.find(([type])=>tags.includes(type))?.[0] || 'other';
    // A background/session/meta title alone does not establish an in-world subject.
    if (!whole.length && (type==='other' || type==='source')) continue;
    const primary=whole.find(item=>nameKey(item.role)==='primary') || whole[0];
    const primaryName=field(primary,'name') || field(entry.note.metadata,'name') || entry.name;
    const authoredName=field(entry.note.metadata,'name') || entry.name;
    const aliases=strings(entry.note.metadata.aliases),candidates=new Map();
    const add=(name,props={})=>{
      name=text(name);
      if (!name || name.length>500) return;
      const key=nameKey(name),previous=candidates.get(key) || {name};
      candidates.set(key,{...previous,...props});
    };
    add(primaryName,{primary:true});
    if (nameKey(authoredName)!==nameKey(primaryName)) add(authoredName,{publicAlias:true});
    for (const alias of aliases) add(alias,{publicAlias:true});
    for (const item of whole) add(field(item,'name'),{metadata:item});
    const records=bySubject.get(entry.id) || [];
    for (const record of records) if (record.type==='concept' && record.form) {
      add(record.form,{decision:record});
    }
    for (const record of records) if (record.type==='concept' && record.concept==='primary') {
      const item=candidates.get(nameKey(primaryName));if (item) item.decision=record;
    }
    for (const candidate of candidates.values()) {
      const item=candidate.metadata,decision=candidate.decision;
      const metaLanguage=language(item?.language),catalogLanguage=text(decision?.language)?language(decision.language):'';
      const direct=metaLanguage!=='Unknown' ? metaLanguage : catalogLanguage || metaLanguage;
      const components=metadata.filter(part=>['name component','component'].includes(nameKey(part.role)) && mentioned(candidate.name,part.name))
        .map(part=>({name:field(part,'name'),language:language(part.language),role:field(part,'role',100),status:statuses.has(part.status)?part.status:'',
          ...(field(part,'pronunciation',250)?{pronunciation:field(part,'pronunciation',250)}:{}),...(field(part,'meaning')?{meaning:field(part,'meaning')}:{})}));
      for (const part of records.filter(record=>record.type==='component' && text(record.form) && mentioned(candidate.name,record.form))) {
        if (!components.some(component=>nameKey(component.name)===nameKey(part.form))) components.push({name:field(part,'form'),language:language(part.language),role:field(part,'role',100),status:'catalog decision'});
      }
      entries.push({id:nameId(entry.slug,candidate.name),page:entry.slug,subject:authoredName,type,name:candidate.name,
        primary:Boolean(candidate.primary),language:direct,catalogLanguage:catalogLanguage && catalogLanguage!==metaLanguage && metaLanguage!=='Unknown'?catalogLanguage:'',
        languageSource:metaLanguage!=='Unknown'?'Name metadata':catalogLanguage?'Catalog decision':item?'Name metadata':'Frontmatter',
        status:statuses.has(item?.status)?item.status:decision?'catalog decision':'',
        role:field(item,'role',100) || (candidate.primary?'primary':'alias'),
        pronunciation:field(item,'pronunciation',250) || (candidate.primary?field(entry.note.metadata,'pronunciation',250):''),
        pronunciationSource:item?.pronunciation?'Name metadata':candidate.primary && entry.note.metadata.pronunciation?'Frontmatter':'',
        meaning:field(item,'meaning'),derivedFrom:field(item,'derivedFrom') || field(decision,'sourceForm'),
        components});
    }
  }
  return {version:1,entries:entries.sort((a,b)=>a.id.localeCompare(b.id)),warnings};
}
