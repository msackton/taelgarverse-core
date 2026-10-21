import {RenderError,pageUrl} from './common.mjs';
import {publicationExclusions} from './content-store.mjs';

export const nameTypes = [
  ['person','People'],['place','Places'],['group','Groups'],['power','Powers'],
  ['object','Objects'],['creature','Creatures'],['ancestry','Ancestries'],
  ['event','Events'],['religion','Religions'],['source','Works'],['other','Other subjects'],
];
export const namePartTypes = [['given','First names'],['family','Surnames']];
export const nameKey = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g,' ').trim();
export const nameSearchKey = value => nameKey(value).normalize('NFD').replace(/\p{M}/gu,'');
export const nameId = (page,name) => page+'::'+nameKey(name);

const titles=new Set('sir ser lady lord dame king queen prince princess emperor empress duke duchess count countess baron baroness archduke archfey chief captain commander general sergeant master mistress doctor dr professor father mother sister brother saint st widow magister'.split(' '));
const particles=new Set('de del della des du da di la le van von den der ten ter ap ab bin ibn al el'.split(' '));
const descriptions=new Set(['of','the','from','at','and']);
const personalWord=/^\p{L}[\p{L}\p{M}'’\-]*\.?$/u;

// These are browsing hints, not edits to a person's recorded name or culture.
// Longer ambiguous names retain only their first word; titles, regnal numbers,
// and descriptive endings never become surnames.
export function splitPersonalName(name) {
  const words=String(name).trim().split(/\s+/);
  while (words.length && titles.has(nameKey(words[0]).replace(/\.$/,''))) words.shift();
  if (!words.length || ['the','a','an','unknown','unnamed'].includes(nameKey(words[0])) || !personalWord.test(words[0])) return [];
  const result=[{name:words[0],type:'given'}],tail=words.slice(1);
  if (tail.length && ['jr','sr'].includes(nameKey(tail.at(-1)).replace(/\.$/,''))) tail.pop();
  if (!tail.length || tail.some(word=>!personalWord.test(word) || descriptions.has(nameKey(word)) || /^[IVXLCDM]+$/.test(word))) return result;
  if (tail.length===1 || (particles.has(nameKey(tail[0])) && !particles.has(nameKey(tail.at(-1))))) result.push({name:tail.join(' '),type:'family'});
  return result;
}

export function personalNameParts(entries) {
  const parts=new Map();
  for (const item of entries) {
    if (item.type!=='person' || ['nickname','title','epithet','translation','translated'].includes(nameKey(item.role))) continue;
    const split=splitPersonalName(item.name);
    // A one-word alias can be a nickname or epithet. Primary personal names
    // and explicit given names are the useful evidence for this shelf.
    if (split.length===1 && !item.primary && !['primary','full name','given name','regnal'].includes(nameKey(item.role))) continue;
    for (const part of split) {
      const component=item.components.find(component=>nameKey(component.name)===nameKey(part.name));
      const exact=nameKey(part.name)===nameKey(item.name);
      const language=component?.language || item.language;
      const id='part::'+part.type+'::'+nameKey(language)+'::'+nameKey(part.name);
      let entry=parts.get(id);
      if (!entry) {
        entry={id,name:part.name,type:part.type,language,role:part.type==='given'?'first name':'surname',
          pronunciation:component?.pronunciation || (exact?item.pronunciation:''),
          meaning:component?.meaning || (exact?item.meaning:''),
          status:component?.status || item.status,
          languageSource:component?'Recorded component':exact?'Recorded personal name':'Full-name language',
          inferred:!component,sources:[]};
        parts.set(id,entry);
      }
      const previous=entry.sources.findIndex(source=>source.page===item.page);
      if (previous<0) entry.sources.push(item);
      else if (item.name.length>entry.sources[previous].name.length) entry.sources[previous]=item;
      // Prefer recorded component evidence when a part also occurs in an
      // automatically split full name. Never borrow a full-name pronunciation.
      if (component) {
        entry.inferred=false;entry.languageSource='Recorded component';entry.status=component.status || '';
        entry.pronunciation ||= component.pronunciation || '';
        entry.meaning ||= component.meaning || '';
      }
    }
  }
  return [...parts.values()];
}

export function nameInput(params) {
  const input = Object.fromEntries(['language','kind','find','name'].map(key=>[key,params.get(key) || '']));
  input.view=params.get('view') || (input.kind && nameTypes.some(([type])=>type===input.kind) || input.name && !input.name.startsWith('part::') ? 'names':'parts');
  if (!['names','parts'].includes(input.view)) throw new RenderError(400,'Unknown name explorer view');
  for (const [key,max] of [['language',120],['kind',30],['find',256],['name',2048]]) {
    if (input[key].length>max) throw new RenderError(400,'Name explorer '+key+' is too long');
  }
  if (input.kind && !(input.view==='parts'?namePartTypes:nameTypes).some(([type])=>type===input.kind)) throw new RenderError(400,'Unknown name subject type');
  const raw=params.get('offset') ?? '0';
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw)>100000) throw new RenderError(400,'Invalid name explorer offset');
  return {...input,offset:Number(raw)};
}

export function queryNames(index,store,context,input) {
  const visible=(index?.entries || []).filter(item=>{
    const entry=store.bySlug.get(item.page);
    return entry?.note && !publicationExclusions(entry.note.metadata).includes('all');
  });
  const parts=input.view==='parts',types=parts?namePartTypes:nameTypes;
  const corpus=parts?personalNameParts(visible):visible;
  const languageCounts=new Map(),byPage=new Map();
  for (const item of visible) {
    const items=byPage.get(item.page) || [];items.push(item);byPage.set(item.page,items);
  }
  for (const item of corpus) languageCounts.set(item.language,(languageCounts.get(item.language)||0)+1);
  const languages=[...languageCounts].sort(([a],[b])=>a==='Unknown'?1:b==='Unknown'?-1:a.localeCompare(b)).map(([language,count])=>({language,count}));
  const terms=nameSearchKey(input.find).split(/\s+/).filter(Boolean);
  const searched=corpus.filter(item=>(!input.language || item.language===input.language) &&
    terms.every(term=>nameSearchKey([item.name,item.subject,item.meaning,item.pronunciation,item.derivedFrom,
      ...(item.sources || []).flatMap(source=>[source.name,source.subject])].join(' ')).includes(term)));
  const counts=new Map();
  for (const item of searched) counts.set(item.type,(counts.get(item.type)||0)+1);
  const matching=searched.filter(item=>!input.kind || item.type===input.kind).sort((a,b)=>a.name.localeCompare(b.name,'en',{sensitivity:'base',numeric:true}) || (a.subject || '').localeCompare(b.subject || '') || a.id.localeCompare(b.id));
  const limit=72, offset=input.kind ? Math.min(input.offset,Math.max(0,Math.floor((matching.length-1)/limit)*limit)) : 0;
  const page=input.kind ? matching.slice(offset,offset+limit) : matching;
  const groups=types.filter(([type])=>!input.kind || input.kind===type).map(([type,label])=>{
    const items=page.filter(item=>item.type===type);
    let shelf=items;
    if (!input.kind && items.length>16) {
      shelf=Array.from({length:16},(_,i)=>items[Math.floor(i*(items.length-1)/15)]);
      const selected=items.find(item=>item.id===input.name);
      if (selected && !shelf.includes(selected)) shelf=[...shelf.slice(0,-1),selected].sort((a,b)=>a.name.localeCompare(b.name));
    }
    return {type,label,total:counts.get(type)||0,items:shelf};
  }).filter(group=>group.items.length);
  const chosen=matching.find(item=>item.id===input.name) || groups[0]?.items[0];
  const publicName = item => {
    if (item.sources) return {...item,sources:item.sources.map(publicName)};
    const availableNames=new Set(byPage.get(item.page).map(other=>nameKey(other.name)));
    return {...item,derivedFrom:availableNames.has(nameKey(item.derivedFrom)) ? item.derivedFrom : '',
      url:pageUrl(item.page,context.date,context)};
  };
  const selected=chosen ? publicName(chosen) : null;
  return {available:Boolean(index),context,input:{...input,offset},languages,
    types:types.map(([type,label])=>({type,label,count:counts.get(type)||0})).filter(type=>type.count),
    total:matching.length,subjects:new Set(matching.flatMap(item=>parts?item.sources.map(source=>source.page):[item.page])).size,
    groups:groups.map(group=>({...group,items:group.items.map(publicName)})),selected,
    related:chosen && !parts ? byPage.get(chosen.page).filter(item=>item.id!==chosen.id).map(publicName).sort((a,b)=>a.name.localeCompare(b.name)) : [],
    pagination:input.kind ? {offset,limit,previous:offset>0,next:offset+limit<matching.length} : null};
}
