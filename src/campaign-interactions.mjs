import {indexSessionNotes,sessionSources} from './session-note-sources.mjs';
import {dateKey, pageUrl} from './common.mjs';
import {availableInContext} from './content-store.mjs';
import {buildBacklinkCampaigns,noteCampaignResolver} from './campaign-ownership.mjs';
import {filterComments} from './comments.mjs';

const list = value => Array.isArray(value) ? value : value == null ? [] : [value];
const normalize = value => String(value ?? '').trim().toLowerCase();
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
// Display authored session metadata as plain text, without interpreting its meaning.
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
// The recap supplies session-level fallback metadata, never beat text.
function sessionVariants(bundle,fields={title:bundle.title || 'Session '+bundle.number,text:bundle.tagline || ''}) {
  const conditions=[];
  for (const value of Object.values(fields)) filterComments(value,{date:'0001-01-01',conditions});
  const campaigns=[...new Set(conditions.map(rule=>rule.campaign).filter(code=>code && code!=='none'))].sort();
  if (campaigns.length>10) throw new Error('Too many campaign conditions for session projection');
  const states=campaigns.reduce((all,code)=>[...all,...all.map(state=>[...state,code])],[[]]);
  const dates=[...new Set([10101,...conditions.map(rule=>rule.date).filter(Boolean)])].sort((a,b)=>a-b),variants=new Map();
  for (let i=0;i<dates.length;i++) for (const selected of states) for (const dm of [false,true]) {
    const projected=Object.fromEntries(Object.entries(fields).map(([key,value])=>{
      const visible=filterComments(value,{date:fullDate(dates[i]),campaigns:selected,dm}).replace(/<p class="dm-block-label">Behind the Curtain<\/p>/g,'');
      return [key,key==='passage' ? visible.trim() : interactionText(visible)];
    }));
    if (!projected.title) continue;
    const key=JSON.stringify(projected),variant=variants.get(key) || {...projected,when:[]};
    variant.when.push({...(selected.length ? {campaigns:selected} : {}),
      ...(campaigns.length-selected.length ? {exceptCampaigns:campaigns.filter(code=>!selected.includes(code))} : {}),dm,
      ...(dates[i]!==10101 ? {from:dates[i]} : {}),...(dates[i+1] ? {before:dates[i+1]} : {})});
    variants.set(key,variant);
  }
  return [...variants.values()];
}
function isPerson(entry) { return list(entry?.note?.metadata.tags).includes('person'); }
const actionKinds={interacted:'encounter',observed:'observation',present:'presence',mentioned:'mention'};
const actionPriority=['interacted','observed','present','mentioned'];
export function interactionReferenceType(metadata) {
  const tags=new Set(list(metadata?.tags).filter(tag=>typeof tag==='string').flatMap(tag=>tag.split(/[\s,]+/)).map(tag=>tag.replace(/^#/,'').toLowerCase().split('/')[0]).filter(Boolean));
  if(!tags.size || tags.has('meta') || tags.has('background'))return null;
  return tags.has('object') || tags.has('item') ? 'item' : tags.has('story') ? 'story' : tags.has('source') || tags.has('document') ? 'document' : 'reference';
}
export function isRelatedCampaignSource(metadata) {
  return Boolean(interactionReferenceType(metadata)) &&
    !list(metadata.tags).includes('session-note') && metadata.sessionNumber==null;
}

// A fallback belongs to the whole session, never to an NPC missing from a recap.
// Choose the registry filename, or one unambiguous legacy metadata candidate.
export function sessionNoteFallbacks(store,registry,bundles=[],resolver=noteCampaignResolver(registry)) {
  return fallbacksForSessions(store,registry,bundles,indexSessionNotes(store,resolver));
}

function fallbacksForSessions(store,registry,bundles,sessions) {
  const recaps=new Set(bundles.map(bundle=>bundle.campaign+':'+bundle.number)),fallbacks=new Map();
  for(const [identity,{campaign,number}] of sessions) {
    if(recaps.has(identity))continue;
    const sources=sessionSources(sessions,registry,campaign,number);
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
  const resolver=noteCampaignResolver(registry),byTarget=Object.create(null),warnings=[],recaps=new Map();
  const sessions=bundles ? indexSessionNotes(store,resolver) : new Map();
  const append=(target,record)=>{(byTarget[target] ||= []).push(record);};
  const mappedIdentities=new Set((bundles || []).filter(bundle=>bundle.mapped).map(bundle=>bundle.campaign+':'+bundle.number));
  for (const bundle of bundles || []) {
    if(bundle.invalid)continue;
    const key=bundle.campaign+':'+bundle.number;
    if(!bundle.mapped && mappedIdentities.has(key))continue;
    const items=recaps.get(key) || [];
    items.push(bundle);recaps.set(key,items);
  }
  for (const [identity,items] of recaps) {
    if (items.length!==1) {warnings.push(items.map(item=>item.key).join(', ')+': duplicate recap identity '+identity);continue;}
    const bundle=items[0],campaign=bundle.campaign;
    const period=interactionDate(bundle.date),until=interactionDate(bundle.end) || period;
    if(period && until.end<period.start){warnings.push(bundle.key+': inverted session dates');continue;}
    const sources=sessionSources(sessions,registry,campaign,bundle.number);
    try {
      const variants=sessionVariants(bundle);
      const records=new Map();
      if(bundle.mapped)for(const entity of bundle.entities) {
        if(!entity.note)continue;
        const target=store.entries.find(entry=>entry.note && entry.id===entity.note);
        if(!target){warnings.push(bundle.key+': unavailable mapped note '+entity.note);continue;}
        // Several session-era identities may resolve to the same canonical note.
        const previous=records.get(target.slug),exchanges=previous?.exchanges || [];
        for(const exchange of entity.exchanges) {
          const existing=exchanges.find(item=>item.id===exchange.id);
          if(existing) {
            if(actionPriority.indexOf(exchange.action)<actionPriority.indexOf(existing.action))existing.action=exchange.action;
            if(['star','supporting','cameo'].indexOf(exchange.role)<['star','supporting','cameo'].indexOf(existing.role))existing.role=exchange.role;
          } else exchanges.push({id:exchange.id,order:exchange.order,action:exchange.action,role:exchange.role,
            variants:sessionVariants(bundle,{title:exchange.title,passage:exchange.passage})});
        }
        exchanges.sort((a,b)=>a.order-b.order);
        const importance=['star','supporting','cameo'].find(role=>role===previous?.importance || role===entity.importance);
        records.set(target.slug,{kind:'mapped-reference',exchanges,importance,
          ...(previous?.examinedInMirrorOfPast || entity.examinedInMirrorOfPast ? {examinedInMirrorOfPast:true} : {})});
      }
      else for(const target of new Set((bundle.metPeople || []).map(name=>explicitTarget(store,name,warnings,bundle.key)?.slug).filter(Boolean)))records.set(target,{kind:'encounter'});
      for (const [target,details] of records) append(target,{id:(bundle.mapped ? 'mapped:' : 'recap:')+identity,campaign,...details,
        ...(details.exchanges ? {exchanges:details.exchanges.map(({order,...exchange})=>exchange)} : {}),scope:'session',sessionSources:sources,
        session:'recap:'+identity,sessionLabel:'Session '+bundle.number,variants,
        start:period?.start || null,end:until?.end || null,
        precision:period ? period.start===until.end ? period.precision : 'range' : 'undated'});
    } catch(error) {warnings.push(bundle.key+': session omitted: '+error.message);}
  }
  // No scan supplied (older snapshots) does not prove that recaps are absent.
  const fallbacks=bundles ? fallbacksForSessions(store,registry,bundles,sessions) : new Map();
  const ownership=buildBacklinkCampaigns(store,registry);
  for (const entry of store.bySlug.values()) {
    const eligibleForRelated=isPerson(entry) || list(entry.note.metadata.knownTo).length>0;
    if (!eligibleForRelated && (!fallbacks.size || !resolver.resolve(entry.id,entry.note.metadata).knownTo.length)) continue;
    for (const link of Object.hasOwn(backlinks?.byTarget || {},entry.slug) ? backlinks.byTarget[entry.slug] : []) {
      const fallback=fallbacks.get(link.source);
      if(fallback) {append(entry.slug,{...fallback,when:link.when});continue;}
      if (!eligibleForRelated) continue;
      const source=store.bySlug.get(link.source),metadata=source?.note?.metadata;
      const campaigns=ownership.get(link.source);
      if (!campaigns?.length || !isRelatedCampaignSource(metadata)) continue;
      for (const campaign of campaigns) append(entry.slug,{id:'reference:'+campaign+':'+source.slug,
        campaign,source:source.slug,kind:'reference',when:link.when});
    }
  }
  return {version:2,backlinkVersion:backlinks?.version || null,byTarget,warnings};
}
export function campaignInteractions(index,store,entry,context,registry,resolver=noteCampaignResolver(registry)) {
  if (!availableInContext(entry,context)) return [];
  const known=new Set(resolver.resolve(entry.id,entry.note.metadata).knownTo);
  if (!isPerson(entry) && !known.size) return [];
  const selected=new Set(context.campaigns),groups=new Map();
  for (const campaign of Object.values(registry.campaigns || {})) if (selected.has(campaign.code)) groups.set(campaign.code,{code:campaign.code,label:campaign.name,known:known.has(campaign.code),events:[]});
  for (const record of Object.hasOwn(index?.byTarget || {},entry.slug) ? index.byTarget[entry.slug] : []) {
    const group=groups.get(record.campaign);
    if (!group) continue;
    if (record.kind==='encounter' || record.kind==='mapped-reference') {
      // Older beat projections cannot establish session-level met membership.
      if(record.scope!=='session')continue;
      const variant=record.variants.find(item=>interactionRuleVisible(item.when,context));
      if (!variant) continue;
      const {when,...text}=variant,{variants,campaign,sessionSources:sources,exchanges:compiledExchanges,...event}=record;
      const exchanges=(compiledExchanges || []).flatMap(({variants,...exchange})=>{
        const visible=variants.find(item=>interactionRuleVisible(item.when,context));
        if(!visible)return [];
        const {when,...content}=visible;return [{...exchange,...content}];
      });
      const action=actionPriority.find(action=>exchanges.some(exchange=>exchange.action===action));
      const candidates=(sources?.candidates || []).map(slug=>store.bySlug.get(slug)).filter(source=>availableInContext(source,context));
      const source=candidates.find(entry=>entry.slug===sources?.preferred) || (candidates.length===1 ? candidates[0] : null);
      const period=interactionDate(source?.note.metadata.DR),until=interactionDate(source?.note.metadata.DR_end) || period;
      const validPeriod=period && until.end>=period.start;
      const start=validPeriod ? period.start : record.start,end=validPeriod ? until.end : record.end;
      if(end && end>context.date)continue;
      const visible=value=>interactionText(filterComments(value,{...context}).replace(/<p class="dm-block-label">Behind the Curtain<\/p>/g,''));
      let title,description;
      try {
        title=source?.note.metadata.descTitle ? visible(source.note.metadata.descTitle) : text.title;
        description=source?.note.metadata.tagline ? visible(source.note.metadata.tagline) : text.text;
      } catch {continue;}
      group.events.push({...event,...text,...(compiledExchanges ? {kind:actionKinds[action] || 'mapped-reference',exchanges} : {}),url:null,sessionUrl:source ? pageUrl(source.slug,context.date,context) : null,
        title,text:description,sourceTitle:source?.title || text.title,location:'',start,end,
        precision:validPeriod ? period.start===until.end ? period.precision : 'range' : record.precision});
    } else if(record.kind==='session-reference') {
      const source=store.bySlug.get(record.source);
      if((record.cutoff && record.cutoff>context.date) || !interactionReferenceType(source?.note?.metadata) || !availableInContext(source,context) ||
        (index.backlinkVersion===1 && context.campaigns.length>1) || !interactionRuleVisible(record.when,context))continue;
      const {cutoff,when,campaign,...event}=record;
      group.events.push({...event,title:interactionText(source.note.metadata.descTitle || source.title),
        text:'',sourceTitle:source.title,location:'',url:null,
        sessionUrl:pageUrl(source.slug,context.date,context)});
    } else {
      const source=store.bySlug.get(record.source);
      const type=interactionReferenceType(source?.note?.metadata);
      if (!type || !availableInContext(source,context) || (index.backlinkVersion===1 && context.campaigns.length>1) || !interactionRuleVisible(record.when,context)) continue;
      group.events.push({id:record.id,kind:'reference',title:source.title,text:'',start:null,end:null,precision:'undated',
        session:null,sourceTitle:source.title,url:pageUrl(source.slug,context.date,context),location:'',referenceType:type});
    }
  }
  return [...groups.values()].map(group=>({...group,events:group.events.sort((a,b)=>
    (a.start || a.sessionStart || '9999').localeCompare(b.start || b.sessionStart || '9999') ||
    (a.session || '').localeCompare(b.session || '',undefined,{numeric:true}) || a.id.localeCompare(b.id,undefined,{numeric:true}))}));
}
