import {parse} from 'yaml';
import {createHeaderContext,HeaderDataError} from './header-core/index.mjs';
import {getPageType} from './header-core/metadata.mjs';

export const indexLabels = Object.freeze({residents:'Residents',settlements:'Settlements',members:'Members',rivers:'Rivers',places:'Places'});

export function headerIndexes(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some(type=>typeof type !== 'string' || !Object.hasOwn(indexLabels,type))) {
    throw new Error('indexes must be an array containing residents, settlements, members, rivers, or places.');
  }
  return [...new Set(value)];
}

export function parseIndex(source) {
  const value = parse(source,{maxAliasCount:20});
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Use YAML with a type: residents, settlements, members, rivers, or places.');
  for (const key of Object.keys(value)) if (!['type','target','show','recursive','mode'].includes(key)) throw new Error('Unknown index option: '+key);
  if (typeof value.type !== 'string' || !Object.hasOwn(indexLabels,value.type)) throw new Error('type must be residents, settlements, members, rivers, or places.');
  if (value.target !== undefined && (typeof value.target !== 'string' || !value.target.trim())) throw new Error('target must be a note name or path.');
  if (value.show !== undefined && !['obsidian','website','both'].includes(value.show)) throw new Error('show must be obsidian, website, or both.');
  if (value.recursive !== undefined && typeof value.recursive !== 'boolean') throw new Error('recursive must be true or false.');
  if (value.mode !== undefined && !['grid','table'].includes(value.mode)) throw new Error('mode must be grid or table.');
  return {type:value.type,target:value.target?.trim(),show:value.show ?? 'both',recursive:value.recursive ?? value.type !== 'members',mode:value.mode ?? 'grid'};
}

const plain = value => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const linkTarget = value => typeof value === 'string' ? value.trim().replace(/^\[\[|\]\]$/g,'').split('|')[0].split('#')[0] : '';
const compareNames=new Intl.Collator('en',{sensitivity:'base',numeric:true}).compare;
const comparePaths=new Intl.Collator('en').compare;
const candidateIndexes=new WeakMap();

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
        else if(page.metadata.typeOf==='waterway')index.rivers.push(page);
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
  const {type,recursive=type !== 'members'} = options;
  if (!Object.hasOwn(indexLabels,type)) throw new Error('Unknown index type.');
  const {dates,names,locations,affiliations,templates} = createHeaderContext(snapshot,{date});
  const at = dates.normalizeDate(date);
  const candidates=indexCandidates(snapshot),{byPath,people}=candidates;
  const placeIndex=type==='settlements' || type==='rivers' || type==='places';
  const resolved=new Map(),whereaboutsCache=new WeakMap();
  const whereaboutsFor=metadata=>{
    if(!whereaboutsCache.has(metadata))whereaboutsCache.set(metadata,locations.getWhereabouts(metadata,at));
    return whereaboutsCache.get(metadata);
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
  if (getPageType(target.metadata) !== (type === 'members' ? 'group' : 'place')) {
    throw new Error(type === 'members' ? 'Members requires an organization target.' : 'This index requires a place target.');
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
  // Residents match homeLocation; place indexes match inLocation with last-known
  // fallback. Both follow current and secondary locations along containment.
  const inLocation = (whereabouts,source,homeOnly=false) => {
    let cycle;
    const visit = (location,source,visited=[]) => {
      const page=lookup(location,source);
      if (!page) return false;
      if (page.path === target.path) return true;
      if (!recursive) return false;
      if (visited.includes(page.path)) {cycle ??= [...visited,page.path];return false;}
      const nextVisited=[...visited,page.path];
      const next=whereaboutsFor(page.metadata);
      return visit(next.current.location,page.path,nextVisited) || visit(next.secondary.location,page.path,nextVisited);
    };
    const matched=homeOnly ? visit(whereabouts.home.location,source) :
      visit((whereabouts.current.location ? whereabouts.current : whereabouts.lastKnown).location,source) ||
      visit(whereabouts.secondary.location,source);
    if (!matched && cycle) throw new HeaderDataError('location',cycle);
    return matched;
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
    try {
      if (type !== 'members') {
        const life=dates.getPageDates(metadata,at);
        if (!life.isCreated || (type === 'residents' && !life.isAlive)) continue;
      }
      let roles=[];
      if (type === 'members') {
        roles=affiliations.getAffiliations(metadata,at).filter(item=>item.startDate.sort<=at.sort && at.sort<=item.endDate.sort && inOrganization(item.org,page.path));
        if (!roles.length) continue;
      } else {
        const whereabouts=whereaboutsFor(metadata);
        if (!inLocation(whereabouts,page.path,type === 'residents')) continue;
      }
      if(firstOnly)return true;
      const description=placeIndex ? plain(metadata.typeOfAlias || metadata.typeOf) :
        [...new Set([metadata.ancestry,metadata.species,metadata.typeOfAlias || metadata.typeOf].map(plain).filter(Boolean))].join(' · ');
      const details=type === 'settlements' && typeof metadata.population === 'number' && Number.isFinite(metadata.population) ? 'Population '+metadata.population.toLocaleString('en-US') :
        type === 'members' ? [...new Set(roles.map(role=>plain(role.title)).filter(Boolean))].join(' · ') : '';
      const settlement=type === 'settlements' ? {
        name:templates.formatDisplayString('<name:n>',{name:page.name,frontmatter:metadata},at),
        region:locationItem(whereaboutsFor(metadata).home,page.path),
        settlementType:templates.formatDisplayString('<maintype:n>',{name:page.name,frontmatter:metadata},at),
        population:templates.formatDisplayString('<population>',{name:page.name,frontmatter:metadata},at),
      } : {};
      const place=type==='rivers' || type==='places' ? {
        name:templates.formatDisplayString('<name:n>',{name:page.name,frontmatter:metadata},at),
        placeType:templates.formatDisplayString('<maintype:n>',{name:page.name,frontmatter:metadata},at),
      } : {};
      const person=!placeIndex ? Object.fromEntries([
        ['person','<name> (<pronouns> <pronunciation>)'],
        ['info','<ancestry> <maintype>'],
        ['lastKnown',type === 'residents' ? '<lastknown:2> (<lastknowndate>)' : '<lastknown:2Fr> (<lastknowndate>)'],
        ...(type === 'residents' ? [['home','<home:1>']] : []),
      ].map(([field,format])=>[field,formattedParts(templates.formatDisplayString(format,{name:page.name,frontmatter:metadata},at),page.path)])) : {};
      items.push({path:page.path,name:displayName(page),description,details,
        pronunciation:plain(metadata.pronunciation),imageTarget:metadata.image,...settlement,...place,...person});
    } catch (error) {
      if (!(error instanceof HeaderDataError)) throw error;
      warnings.add('Some pages were omitted because their relationship metadata contains a cycle.');
    }
  }
  if(firstOnly)return false;
  items.sort((a,b)=>(type === 'settlements' ? compareNames(a.region?.name || 'Unknown',b.region?.name || 'Unknown') :
    type==='rivers' || type==='places' ? compareNames(a.placeType || 'Unknown',b.placeType || 'Unknown') : 0) ||
    compareNames(a.name,b.name) || comparePaths(a.path,b.path));
  return {type,label:indexLabels[type],target:displayName(target),items,warnings:[...warnings]};
}
