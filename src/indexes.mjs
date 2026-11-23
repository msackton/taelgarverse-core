import {parse} from 'yaml';
import {createHeaderContext,HeaderDataError} from './header-core/index.mjs';
import {getPageType} from './header-core/metadata.mjs';

export const indexLabels = Object.freeze({residents:'Residents','people-in-place':'People Present',settlements:'Settlements',members:'Members',rivers:'Rivers',places:'Places'});
const indexTypes=Object.keys(indexLabels).join(', ');

// Broad groups follow the vault's Place Categories, using typeOf rather than
// display aliases. Unclassified and extraplanar types stay in unfiltered Places.
const placeTypes = {
  built:new Set(['settlement','neighborhood','realm','inn','building','holy site','road','infrastructure','battlefield']),
  natural:new Set(['region','watershed','forest','wetlands','desert','grassland','waterway','lake','marine feature',
    'topographical feature','topographic feature','subterranean feature','island']),
};

function validatePlaceType(type,placeType) {
  if (placeType === undefined) return;
  if (type !== 'places') throw new Error('placeType is only supported for places indexes.');
  if (placeType !== 'built' && placeType !== 'natural') throw new Error('placeType must be built or natural.');
}

function validateScopeAndColumns({type,scope,columns,mode}) {
  if (scope !== undefined && !['current','historical','ever'].includes(scope)) throw new Error('scope must be current, historical, or ever.');
  if (type !== 'members' && columns !== undefined) throw new Error('columns is only supported for members indexes.');
  if (columns !== undefined && (columns !== 'life-dates' || mode !== 'table')) {
    throw new Error('columns must be life-dates and requires mode: table.');
  }
}

export function headerIndexes(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some(type=>typeof type !== 'string' || !Object.hasOwn(indexLabels,type))) {
    throw new Error('indexes must be an array of supported types: '+indexTypes+'.');
  }
  return [...new Set(value)];
}

// Groups get a Members header index by default. Any explicit indexes value,
// including an empty array, takes precedence over the inferred default.
export function headerIndexesForMetadata(metadata = {}) {
  if (metadata.indexes !== undefined) return headerIndexes(metadata.indexes);
  return getPageType(metadata) === 'group' ? ['members'] : [];
}

export function parseIndex(source) {
  const value = parse(source,{maxAliasCount:20});
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Use YAML with a supported index type: '+indexTypes+'.');
  for (const key of Object.keys(value)) if (!['type','target','show','recursive','mode','placeType','heading','scope','columns'].includes(key)) throw new Error('Unknown index option: '+key);
  if (typeof value.type !== 'string' || !Object.hasOwn(indexLabels,value.type)) throw new Error('type must be one of: '+indexTypes+'.');
  if (value.target !== undefined && (typeof value.target !== 'string' || !value.target.trim())) throw new Error('target must be a note name or path.');
  if (value.show !== undefined && !['obsidian','website','both'].includes(value.show)) throw new Error('show must be obsidian, website, or both.');
  if (value.recursive !== undefined && typeof value.recursive !== 'boolean') throw new Error('recursive must be true or false.');
  if (value.mode !== undefined && !['grid','table'].includes(value.mode)) throw new Error('mode must be grid or table.');
  if (value.heading !== undefined && typeof value.heading !== 'boolean') throw new Error('heading must be true or false.');
  validatePlaceType(value.type,value.placeType);
  validateScopeAndColumns(value);
  return {type:value.type,target:value.target?.trim(),show:value.show ?? 'both',recursive:value.recursive ?? value.type !== 'members',mode:value.mode ?? 'grid',heading:value.heading ?? true,
    ...(value.placeType !== undefined ? {placeType:value.placeType} : {}),
    ...(value.scope !== undefined ? {scope:value.scope} : {}),
    ...(value.columns !== undefined ? {columns:value.columns} : {})};
}

const plain = value => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const linkTarget = value => typeof value === 'string' ? value.trim().replace(/^\[\[|\]\]$/g,'').split('|')[0].split('#')[0] : '';
const currentLocation = whereabouts => {
  const reference=linkTarget(whereabouts.current.location).trim();
  return reference.toLowerCase() === 'unknown' ? '' : reference;
};
const compareNames=new Intl.Collator('en',{sensitivity:'base',numeric:true}).compare;
const comparePaths=new Intl.Collator('en').compare;
const candidateIndexes=new WeakMap();
const dateAtDay=day=>({sort:day,days:day,isNormalizedDate:true});

function indexCandidates(snapshot) {
  let index=candidateIndexes.get(snapshot);
  if(!index) {
    index={byPath:new Map(),people:[],settlements:[],rivers:[],places:[]};
    for(const page of snapshot.pages) {
      index.byPath.set(page.path,page);
      const type=getPageType(page.metadata);
      if(type==='person')index.people.push(page);
      else if(type==='place') {
        index.places.push(page);
        if(page.metadata.typeOf==='settlement')index.settlements.push(page);
        else if(page.metadata.typeOf==='waterway' || page.metadata.typeOf==='lake')index.rivers.push(page);
      }
    }
    candidateIndexes.set(snapshot,index);
  }
  return index;
}

// Hosts supply link resolution and visibility. All relationship calculations use
// the same dated services as the bio, without loading bodies or executing JS.
export function queryIndex(snapshot,options,context) {return runIndexQuery(snapshot,options,context);}

// Header buttons need existence, not a sorted/formatted copy of every row.
export function indexHasResults(snapshot,options,context) {return runIndexQuery(snapshot,options,context,true);}

function runIndexQuery(snapshot,options,{date,sourcePath,resolve,visible=()=>true}={},firstOnly=false) {
  const {type,scope,recursive=type !== 'members'} = options;
  if (!Object.hasOwn(indexLabels,type)) throw new Error('Unknown index type.');
  validatePlaceType(type,options.placeType);
  validateScopeAndColumns(options);
  const isMemberIndex=type==='members',presence=type==='people-in-place';
  const lifeDates=options.columns==='life-dates';
  const {dates,names,locations,affiliations,templates} = createHeaderContext(snapshot,{date});
  const at = dates.normalizeDate(date);
  const candidates=indexCandidates(snapshot),{byPath,people}=candidates;
  const placeIndex=type==='settlements' || type==='rivers' || type==='places';
  const resolved=new Map(),whereaboutsRecords=new WeakMap(),whereaboutsCache=new WeakMap();
  const recordsFor=metadata=>{
    if(!whereaboutsRecords.has(metadata))whereaboutsRecords.set(metadata,locations.getWhereaboutsList(metadata));
    return whereaboutsRecords.get(metadata);
  };
  const whereaboutsFor=(metadata,when=at)=>{
    let byDay=whereaboutsCache.get(metadata);
    if(!byDay){byDay=new Map();whereaboutsCache.set(metadata,byDay);}
    if(!byDay.has(when.sort))byDay.set(when.sort,locations.getWhereabouts(metadata,when,recordsFor(metadata)));
    return byDay.get(when.sort);
  };
  const lookup = (target,source=sourcePath) => {
    target=linkTarget(target);
    if (!target) return undefined;
    let targets=resolved.get(source);
    if(!targets){targets=new Map();resolved.set(source,targets);}
    if(!targets.has(target)) {
      const file=resolve ? undefined : names.getFileForTarget(target);
      targets.set(target,resolve ? resolve(target,source) : file && byPath.get(file.path));
    }
    return targets.get(target);
  };
  const target = options.target ? lookup(options.target) : byPath.get(sourcePath);
  if (!target || !visible(target)) throw new Error('The index target is unavailable.');
  if (getPageType(target.metadata) !== (isMemberIndex ? 'group' : 'place')) {
    throw new Error(isMemberIndex ? 'Members requires an organization target.' : 'This index requires a place target.');
  }
  const displayName = page => names.getNameObject(page.path).name || page.name;
  const inOrganization = (organization,source) => {
    const visited=new Set();
    while (organization) {
      const page=lookup(organization,source);
      if (!page) return false;
      if (page.path === target.path) return true;
      if (!recursive) return false;
      if (visited.has(page.path)) throw new HeaderDataError('organization',[...visited,page.path]);
      visited.add(page.path);
      if (getPageType(page.metadata) !== 'group') return false;
      organization=page.metadata.partOf;
      source=page.path;
    }
    return false;
  };
  const visibleLocation=page=>page && (!(presence || scope) || visible(page));
  // Geography also matches secondary locations. Existing blocks can additionally
  // start from a last-known place when the selected date has no current location.
  const inLocation = (candidate,when) => {
    const whereabouts=whereaboutsFor(candidate.metadata,when),source=candidate.path;
    let cycle;
    const visit = (location,source,visited=[]) => {
      const page=lookup(location,source);
      if (!visibleLocation(page)) return false;
      if (page.path === target.path) return true;
      if (!recursive) return false;
      if (visited.includes(page.path)) {cycle ??= [...visited,page.path];return false;}
      const nextVisited=[...visited,page.path];
      const next=whereaboutsFor(page.metadata,when);
      return visit(next.current.location,page.path,nextVisited) || visit(next.secondary.location,page.path,nextVisited);
    };
    let matched;
    if (type === 'residents') matched=visit(whereabouts.home.location,source);
    else if (presence) matched=visit(currentLocation(whereabouts),source);
    else matched=visit(scope ? currentLocation(whereabouts) : (whereabouts.current.location ? whereabouts.current : whereabouts.lastKnown).location,source) ||
      visit(whereabouts.secondary.location,source);
    if (!matched && cycle) throw new HeaderDataError('location',cycle);
    return matched;
  };
  // On either side of a whereabouts boundary, every link in the containment
  // chain must be evaluated on the same day. Probe the last day of each period.
  const historicalLocationDays=(candidate,first,last)=>{
    const days=new Set(),pending=[candidate],seen=new Set();
    let canReachTarget=false;
    while(pending.length) {
      const page=pending.pop();
      if(seen.has(page.path))continue;
      seen.add(page.path);
      for(const record of recordsFor(page.metadata)) {
        for(const day of [record.logicalStart.sort-1,record.logicalEnd.sort,record.awayEnd.sort]) {
          if(first<=day && day<last)days.add(day);
        }
        const next=lookup(record.location,page.path);
        if(!visibleLocation(next))continue;
        if(next.path===target.path)canReachTarget=true;
        else if(recursive)pending.push(next);
      }
    }
    return canReachTarget ? [...days].sort((a,b)=>b-a) : [];
  };
  const matchEver=(candidate,first,last)=>{
    let cycle;
    const matches=when=>{
      try{return inLocation(candidate,when);}
      catch(error){
        if(!(error instanceof HeaderDataError))throw error;
        cycle=error;
        return false;
      }
    };
    if(matches(last))return last;
    for(const day of historicalLocationDays(candidate,first,last.sort)) {
      const when=dateAtDay(day);
      if(matches(when))return when;
    }
    if(cycle)throw cycle;
  };
  const locationItem = (whereabout,source) => {
    const page=whereabout.location ? lookup(whereabout.location,source) : undefined;
    if (page && !visible(page)) return undefined;
    if (!whereabout.location) return undefined;
    const reference=linkTarget(whereabout.location),file=names.getFileForTarget(reference);
    const name=names.getNameObject(file?.path === page?.path ? reference : page?.path || reference,'place',{alias:whereabout.alias});
    return {path:page?.path,name:names.formatName(name,'n')};
  };
  // Template output is text with wikilinks, never HTML. Resolve each link before
  // rendering so every host keeps its native URLs and website visibility rules.
  const formattedParts = (text,source) => {
    const parts=[];
    let end=0;
    for (const match of text.matchAll(/\[\[([^\[\]\n]+)\]\]/g)) {
      if (match.index>end) parts.push(text.slice(end,match.index));
      const [reference,...alias]=match[1].split('|'),page=lookup(reference,source);
      const name=alias.length ? alias.join('|') : reference;
      parts.push(page ? visible(page) ? {path:page.path,name} : 'Unknown' : name);
      end=match.index+match[0].length;
    }
    if (end<text.length) parts.push(text.slice(end));
    return parts;
  };
  const items=[],warnings=new Set();
  for (const page of placeIndex ? candidates[type] : people) {
    if (!visible(page) || page.path === target.path) continue;
    const metadata=page.metadata;
    if (options.placeType && !placeTypes[options.placeType].has(metadata.typeOf)) continue;
    try {
      const life=dates.getPageDates(metadata,at);
      const first=Number.isFinite(life.startDate?.sort) ? life.startDate.sort : -Infinity;
      let matchDate=at;
      if(scope) {
        if(first>at.sort)continue;
        const end=dates.normalizeDate(placeIndex ? metadata.destroyed : metadata.died,true);
        if(Number.isFinite(end?.sort) && !end.isHiddenDate && end.sort<at.sort) {
          if(scope==='current' || end.sort<first)continue;
          matchDate=end;
        }
      } else {
        if(!life.isCreated && (!isMemberIndex || lifeDates))continue;
        if(!life.isAlive && (type==='residents' || presence))continue;
      }
      let roles=[];
      if (isMemberIndex) {
        roles=affiliations.getAffiliations(metadata,matchDate).filter(item=>
          (scope==='ever' ? Math.max(first,item.startDate.sort)<=Math.min(matchDate.sort,item.endDate.sort) :
            matchDate.sort<=item.endDate.sort) && inOrganization(item.org,page.path));
        if (!roles.length) continue;
      } else {
        if(scope==='ever')matchDate=matchEver(page,first,matchDate);
        else if(!inLocation(page,matchDate))continue;
        if(!matchDate)continue;
      }
      if(firstOnly)return true;
      const description=placeIndex ? plain(metadata.typeOfAlias || metadata.typeOf) :
        [...new Set([metadata.ancestry,metadata.species,metadata.typeOfAlias || metadata.typeOf].map(plain).filter(Boolean))].join(' · ');
      const details=type === 'settlements' && typeof metadata.population === 'number' && Number.isFinite(metadata.population) ? 'Population '+metadata.population.toLocaleString('en-US') :
        isMemberIndex ? [...new Set(roles.map(role=>plain(role.title)).filter(Boolean))].join(' · ') : '';
      const settlement=type === 'settlements' ? {
        name:templates.formatDisplayString('<name:n>',{name:page.name,frontmatter:metadata},at),
        region:locationItem(whereaboutsFor(metadata,matchDate).home,page.path),
        settlementType:templates.formatDisplayString('<maintype:n>',{name:page.name,frontmatter:metadata},at),
        population:templates.formatDisplayString('<population>',{name:page.name,frontmatter:metadata},at),
      } : {};
      const place=type==='rivers' || type==='places' ? {
        name:templates.formatDisplayString('<name:n>',{name:page.name,frontmatter:metadata},at),
        placeType:templates.formatDisplayString('<maintype:n>',{name:page.name,frontmatter:metadata},at),
      } : {};
      let person={};
      if (!placeIndex) {
        const file={name:page.name,frontmatter:metadata};
        const format=template=>formattedParts(templates.formatDisplayString(template,file,at),page.path);
        person={
          person:format('<name> (<pronouns> <pronunciation>)'),
          info:format('<ancestry> <maintype>'),
        };
        if (lifeDates) {
          const born=dates.normalizeDate(metadata.born,false),died=dates.normalizeDate(metadata.died,true);
          person.born=born && !born.isHiddenDate ? born.display : '';
          person.died=died && !died.isHiddenDate && died.sort<=at.sort ? died.display : '';
          person.birthOrder=person.born ? born.sort : Number.MAX_SAFE_INTEGER;
        } else {
          const current=life.isAlive ? currentLocation(whereaboutsFor(metadata)) : '';
          const destination=lookup(current,page.path);
          const hasCurrentLocation=current && (!destination || visible(destination));
          person.currentLocation=hasCurrentLocation ? format(isMemberIndex ? '<current:2Fr>' : '<current:2>') : [];
          person.home=format('<home:1>');
        }
      }
      items.push({path:page.path,name:displayName(page),description,details,
        pronunciation:plain(metadata.pronunciation),imageTarget:metadata.image,...settlement,...place,...person});
    } catch (error) {
      if (!(error instanceof HeaderDataError)) throw error;
      warnings.add('Some pages were omitted because their relationship metadata contains a cycle.');
    }
  }
  if(firstOnly)return false;
  items.sort((a,b)=>(lifeDates ? a.birthOrder-b.birthOrder : type === 'settlements' ? compareNames(a.region?.name || 'Unknown',b.region?.name || 'Unknown') :
    type==='rivers' || type==='places' ? compareNames(a.placeType || 'Unknown',b.placeType || 'Unknown') : 0) ||
    compareNames(a.name,b.name) || comparePaths(a.path,b.path));
  const label=(scope==='historical' ? 'Historical ' : scope==='ever' ? 'All-time ' : '')+indexLabels[type];
  return {type,label,target:displayName(target),items,warnings:[...warnings],
    ...(lifeDates ? {columns:'life-dates'} : {})};
}
