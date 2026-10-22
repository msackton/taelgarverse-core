import {dateKey, pageUrl, contextQuery} from './common.mjs';
import {availableInContext} from './content-store.mjs';
import {buildBacklinkCampaigns} from './campaign-ownership.mjs';
import {filterComments} from './comments.mjs';

const list = value => Array.isArray(value) ? value : value == null ? [] : [value];
const normalize = value => String(value ?? '').trim().toLowerCase();
export function campaignIdentities(registry) {
  const identities = new Map();
  for (const [id,campaign] of Object.entries(registry.campaigns || {})) {
    for (const name of [id,campaign.code,campaign.name,...list(campaign.aliases)]) identities.set(normalize(name),campaign.code);
  }
  return identities;
}
export function interactionDate(value) {
  if (value == null || !/^\d{1,4}(?:-\d{1,2})?(?:-\d{1,2})?$/.test(String(value))) return null;
  try {
    dateKey(value,true);
    const [y,m,d] = String(value).split('-').map(Number);
    const first = String(y).padStart(4,'0')+'-'+String(m || 1).padStart(2,'0')+'-'+String(d || 1).padStart(2,'0');
    const last = String(y).padStart(4,'0')+'-'+String(m || 12).padStart(2,'0')+'-'+String(d || (m ? [31,28,31,30,31,30,31,31,30,31,30,31][m-1] : 31)).padStart(2,'0');
    return {start:first,end:last,precision:d ? 'day' : m ? 'month' : 'year'};
  } catch { return null; }
}
// Display the author's Short text as plain text, without interpreting its meaning.
export function interactionText(value) {
  return String(value ?? '').replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,(_,target,label)=>label || target)
    .replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/<[^>]*>/g,'').replace(/[*_`]/g,'').replace(/\s+/g,' ').trim();
}
export function interactionRuleVisible(when,context) {
  const campaigns = new Set(context.campaigns), date = dateKey(context.date);
  return when.some(rule => (!rule.campaign || campaigns.has(rule.campaign)) &&
    (!rule.campaigns || rule.campaigns.every(code=>campaigns.has(code))) &&
    (!rule.exceptCampaigns || !rule.exceptCampaigns.some(code=>campaigns.has(code))) &&
    (rule.dm === undefined || rule.dm === Boolean(context.dm)) &&
    (rule.from === undefined || date >= rule.from) && (rule.before === undefined || date < rule.before));
}
function fullDate(key) {
  return String(Math.floor(key/10000)).padStart(4,'0')+'-'+String(Math.floor(key/100)%100).padStart(2,'0')+'-'+String(key%100).padStart(2,'0');
}
// Compile the recap's own conditional text. Session articles never participate.
// Variants share one beat identity, so a request can only display a beat once.
function beatVariants(scene,sourceTitle) {
  const fields={title:scene.title,text:scene.short,location:scene.location,sourceTitle},conditions=[];
  for (const value of Object.values(fields)) filterComments(value,{date:'0001-01-01',conditions});
  const campaigns=[...new Set(conditions.map(rule=>rule.campaign).filter(code=>code && code!=='none'))].sort();
  if (campaigns.length>10) throw new Error('Too many campaign conditions for beat projection');
  const states=campaigns.reduce((all,code)=>[...all,...all.map(state=>[...state,code])],[[]]);
  const dates=[...new Set([10101,...conditions.map(rule=>rule.date).filter(Boolean)])].sort((a,b)=>a-b),variants=new Map();
  for (let i=0;i<dates.length;i++) for (const selected of states) for (const dm of [false,true]) {
    const projected=Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,interactionText(
      filterComments(value,{date:fullDate(dates[i]),campaigns:selected,dm}).replace(/<p class="dm-block-label">Behind the Curtain<\/p>/g,''))]));
    if (!projected.text) continue;
    const key=JSON.stringify(projected),variant=variants.get(key) || {...projected,when:[]};
    variant.when.push({...(selected.length ? {campaigns:selected} : {}),
      ...(campaigns.length-selected.length ? {exceptCampaigns:campaigns.filter(code=>!selected.includes(code))} : {}),dm,
      ...(dates[i]!==10101 ? {from:dates[i]} : {}),...(dates[i+1] ? {before:dates[i+1]} : {})});
    variants.set(key,variant);
  }
  return [...variants.values()];
}
function isPerson(entry) { return list(entry?.note?.metadata.tags).includes('person'); }
export function interactionReferenceType(metadata) {
  const tags=new Set(list(metadata?.tags).filter(tag=>typeof tag==='string').flatMap(tag=>tag.split(/[\s,]+/)).map(tag=>tag.replace(/^#/,'').toLowerCase().split('/')[0]).filter(Boolean));
  if(!tags.size || tags.has('meta') || tags.has('background'))return null;
  return tags.has('object') || tags.has('item') ? 'item' : tags.has('story') ? 'story' : tags.has('source') || tags.has('document') ? 'document' : 'reference';
}
function sessionSources(store,registry,identities,campaign,number) {
  const candidates=[...store.bySlug.values()].filter(entry=>list(entry.note.metadata.tags).includes('session-note') &&
    identities.get(normalize(entry.note.metadata.campaign))===campaign && String(entry.note.metadata.sessionNumber)===String(number));
  const config=Object.values(registry.campaigns || {}).find(item=>item.code===campaign);
  let preferred;
  if (config?.campaignRoot && config.notePattern && /^\d+(?:\.\d+)?$/.test(String(number))) {
    const [whole,fraction]=String(number).split('.'),padded=whole.padStart(2,'0')+(fraction ? '.'+fraction : '');
    const expected=(config.campaignRoot.replace(/[\\/]+$/,'')+'/'+config.notePattern.replaceAll('{session_padded}',padded).replaceAll('{session}',String(number))).replaceAll('\\','/');
    preferred=candidates.find(entry=>entry.id===expected)?.slug;
  }
  return {candidates:candidates.map(entry=>entry.slug),...(preferred ? {preferred} : {})};
}
function recapIdentity(bundle,registry,identities) {
  const campaign=identities.get(normalize(bundle.campaign));
  if(campaign && bundle.number!=null)return campaign+':'+bundle.number;
  // An unreadable recap must not quietly restore generated-note evidence.
  // Its standard artifact directory can still reserve the session identity.
  const parts=String(bundle.key).replaceAll('\\','/').split('/');
  const config=Object.entries(registry.campaigns || {}).find(([id,item])=>normalize(item.sessionRoot || id)===normalize(parts[1]))?.[1];
  const number=/-(\d+(?:\.\d+)?)$/.exec(parts[2] || '')?.[1];
  if(parts[0]==='_sessions' && config && number)return config.code+':'+String(Number(number));
  return null;
}
// A fallback belongs to the whole session, never to an NPC missing from a recap.
// Choose the registry filename, or one unambiguous legacy metadata candidate.
export function sessionNoteFallbacks(store,registry,bundles=[]) {
  const identities=campaignIdentities(registry),recaps=new Set(bundles.map(bundle=>recapIdentity(bundle,registry,identities)).filter(Boolean));
  const sessions=new Map(),fallbacks=new Map();
  for(const entry of store.bySlug.values()) {
    const metadata=entry.note.metadata,campaign=identities.get(normalize(metadata.campaign)),number=String(metadata.sessionNumber);
    if(!list(metadata.tags).includes('session-note') || !campaign || !/^\d+(?:\.\d+)?$/.test(number))continue;
    sessions.set(campaign+':'+number,{campaign,number});
  }
  for(const [identity,{campaign,number}] of sessions) {
    if(recaps.has(identity))continue;
    const sources=sessionSources(store,registry,identities,campaign,number);
    const source=sources.preferred || (sources.candidates.length===1 ? sources.candidates[0] : null);
    if(!source)continue;
    const metadata=store.bySlug.get(source).note.metadata;
    if(!interactionReferenceType(metadata))continue;
    const period=interactionDate(metadata.DR),until=interactionDate(metadata.DR_end) || period;
    if(period && until.end<period.start)continue;
    fallbacks.set(source,{id:'session:'+identity,campaign,source,kind:'session-reference',session:'recap:'+identity,
      sessionLabel:'Session '+number,sessionStart:period?.start || null,sessionEnd:until?.end || null,
      start:period?.start || null,end:until?.end || null,cutoff:until?.end || null,
      precision:period ? period.start===until.end ? period.precision : 'range' : 'undated'});
  }
  return fallbacks;
}
function explicitTarget(store,name,warnings,source) {
  const raw=String(name).trim(),match=/^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(raw);
  let found=store.lookup(match ? match[1] : raw);
  if (found.status==='missing' && !match) {
    const candidates=store.entries.filter(entry=>entry.note && normalize(entry.note.metadata.name)===normalize(raw));
    found=candidates.length===1 ? {status:'found',entry:candidates[0]} : {status:candidates.length ? 'ambiguous' : 'missing'};
  }
  if (found.status!=='found') {warnings.push(source+': '+found.status+' person '+raw);return null;}
  return isPerson(found.entry) ? found.entry : null;
}
export function compileInteractionIndex(store,registry,backlinks,bundles=null) {
  const identities=campaignIdentities(registry),byTarget=Object.create(null),transcripts=Object.create(null),warnings=[],recaps=new Map();
  const append=(target,record)=>{(byTarget[target] ||= []).push(record);};
  for (const bundle of bundles || []) {
    if(bundle.invalid)continue;
    const campaign=identities.get(normalize(bundle.campaign));
    if (!campaign) {warnings.push(bundle.key+': unknown campaign '+bundle.campaign);continue;}
    const key=campaign+':'+bundle.number,items=recaps.get(key) || [];
    items.push(bundle);recaps.set(key,items);
  }
  for (const [identity,items] of recaps) {
    if (items.length!==1) {warnings.push(items.map(item=>item.key).join(', ')+': duplicate recap identity '+identity);continue;}
    const bundle=items[0],campaign=identities.get(normalize(bundle.campaign)),ids=new Set(),duplicates=new Set();
    for (const scene of bundle.scenes) {if(ids.has(scene.id))duplicates.add(scene.id);ids.add(scene.id);}
    const headerEnd=interactionDate(bundle.end || bundle.date)?.end;
    const sources=sessionSources(store,registry,identities,campaign,bundle.number);
    for (const scene of bundle.scenes) {
      if (duplicates.has(scene.id)) {warnings.push(bundle.key+': duplicate beat '+scene.id);continue;}
      const period=interactionDate(scene.date),until=interactionDate(scene.end) || period;
      if (period && until.end<period.start) {warnings.push(bundle.key+': inverted dates for '+scene.id);continue;}
      try {
        const variants=beatVariants(scene,bundle.title || 'Session '+bundle.number);
        if (!variants.length) {warnings.push(bundle.key+': missing visible Short text for '+scene.id);continue;}
        const targets=new Set(scene.people.map(name=>explicitTarget(store,name,warnings,bundle.key)?.slug).filter(Boolean));
        const id='recap:'+identity+':'+scene.id;
        if (targets.size && scene.transcript) {
          try {filterComments(scene.transcript,{date:'0001-01-01'});transcripts[id]=scene.transcript;}
          catch(error) {warnings.push(bundle.key+': transcript for '+scene.id+' omitted: '+error.message);}
        }
        for (const target of targets) append(target,{id,campaign,kind:'encounter',sessionSources:sources,
          session:'recap:'+identity,sessionLabel:'Session '+bundle.number,variants,
          sessionStart:interactionDate(bundle.date)?.start || null,sessionEnd:headerEnd || null,
          start:period?.start || null,end:until?.end || null,cutoff:until?.end || headerEnd || null,
          precision:period ? period.start===until.end ? period.precision : 'range' : 'undated'});
      } catch(error) {warnings.push(bundle.key+': beat '+scene.id+' omitted: '+error.message);}
    }
  }
  // No scan supplied (older snapshots) does not prove that recaps are absent.
  const fallbacks=bundles ? sessionNoteFallbacks(store,registry,bundles) : new Map();
  const ownership=buildBacklinkCampaigns(store,registry);
  const roots=Object.values(registry.campaigns || {}).map(campaign=>normalize(campaign.campaignRoot).replaceAll('\\','/').replace(/\/+$/,'')).filter(Boolean);
  for (const entry of store.bySlug.values()) {
    if (!isPerson(entry)) continue;
    for (const link of Object.hasOwn(backlinks?.byTarget || {},entry.slug) ? backlinks.byTarget[entry.slug] : []) {
      const source=store.bySlug.get(link.source),metadata=source?.note?.metadata;
      const fallback=fallbacks.get(link.source);
      if(fallback) {append(entry.slug,{...fallback,when:link.when});continue;}
      if (!interactionReferenceType(metadata) || list(metadata.tags).includes('session-note') || metadata.sessionNumber!=null) continue;
      const id=normalize(source.id).replaceAll('\\','/');
      if (!roots.some(root=>id.startsWith(root+'/'))) continue;
      for (const campaign of ownership.get(source.slug) || []) append(entry.slug,{id:'reference:'+campaign+':'+source.slug,
        campaign,source:source.slug,kind:'reference',when:link.when});
    }
  }
  return {version:2,backlinkVersion:backlinks?.version || null,byTarget,transcripts,warnings};
}
export function campaignInteractions(index,store,entry,context,registry) {
  if (!isPerson(entry) || !availableInContext(entry,context,store.settings)) return [];
  const identities=campaignIdentities(registry),known=new Set(list(entry.note.metadata.knownTo).map(name=>identities.get(normalize(name))).filter(Boolean));
  const selected=new Set(context.campaigns),groups=new Map();
  for (const campaign of Object.values(registry.campaigns || {})) if (selected.has(campaign.code)) groups.set(campaign.code,{code:campaign.code,label:campaign.name,known:known.has(campaign.code),events:[]});
  for (const record of Object.hasOwn(index?.byTarget || {},entry.slug) ? index.byTarget[entry.slug] : []) {
    const group=groups.get(record.campaign);
    if (!group) continue;
    if (record.kind==='encounter') {
      if (record.cutoff && record.cutoff>context.date) continue;
      const variant=record.variants.find(item=>interactionRuleVisible(item.when,context));
      if (!variant) continue;
      const {when,...text}=variant,{variants,cutoff,campaign,sessionSources:sources,...event}=record;
      const candidates=(sources?.candidates || []).map(slug=>store.bySlug.get(slug)).filter(source=>availableInContext(source,context,store.settings));
      const source=candidates.find(entry=>entry.slug===sources?.preferred) || (candidates.length===1 ? candidates[0] : null);
      group.events.push({...event,...text,url:null,sessionUrl:source ? pageUrl(source.slug,context.date,context) : null,
        transcriptUrl:Object.hasOwn(index.transcripts || {},record.id) ? '/campaign-transcripts/'+encodeURIComponent(record.id)+'?'+contextQuery(context)+'&person='+encodeURIComponent(entry.slug) : null});
    } else if(record.kind==='session-reference') {
      const source=store.bySlug.get(record.source);
      if((record.cutoff && record.cutoff>context.date) || !interactionReferenceType(source?.note?.metadata) || !availableInContext(source,context,store.settings) ||
        (index.backlinkVersion===1 && context.campaigns.length>1) || !interactionRuleVisible(record.when,context))continue;
      const {cutoff,when,campaign,...event}=record;
      group.events.push({...event,title:interactionText(source.note.metadata.descTitle || source.title),
        text:'Linked in the official session note.',sourceTitle:source.title,location:'',url:null,
        sessionUrl:pageUrl(source.slug,context.date,context),transcriptUrl:null});
    } else {
      const source=store.bySlug.get(record.source);
      const type=interactionReferenceType(source?.note?.metadata);
      if (!type || !availableInContext(source,context,store.settings) || (index.backlinkVersion===1 && context.campaigns.length>1) || !interactionRuleVisible(record.when,context)) continue;
      group.events.push({id:record.id,kind:'reference',title:source.title,text:'',start:null,end:null,precision:'undated',
        session:null,sourceTitle:source.title,url:pageUrl(source.slug,context.date,context),location:'',referenceType:type});
    }
  }
  return [...groups.values()].map(group=>({...group,events:group.events.sort((a,b)=>
    (a.start || a.sessionStart || '9999').localeCompare(b.start || b.sessionStart || '9999') ||
    (a.session || '').localeCompare(b.session || '',undefined,{numeric:true}) || a.id.localeCompare(b.id,undefined,{numeric:true}))}));
}
