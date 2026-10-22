import {parse} from 'yaml';
import {createHeaderContext,HeaderDataError} from './header-core/index.mjs';
import {getPageType} from './header-core/metadata.mjs';

export const indexLabels = Object.freeze({residents:'Residents',settlements:'Settlements',members:'Members'});

export function headerIndexes(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some(type=>typeof type !== 'string' || !Object.hasOwn(indexLabels,type))) {
    throw new Error('indexes must be an array containing residents, settlements, or members.');
  }
  return [...new Set(value)];
}

export function parseIndex(source) {
  const value = parse(source,{maxAliasCount:20});
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Use YAML with a type: residents, settlements, or members.');
  for (const key of Object.keys(value)) if (!['type','target','show','recursive','mode'].includes(key)) throw new Error('Unknown index option: '+key);
  if (typeof value.type !== 'string' || !Object.hasOwn(indexLabels,value.type)) throw new Error('type must be residents, settlements, or members.');
  if (value.target !== undefined && (typeof value.target !== 'string' || !value.target.trim())) throw new Error('target must be a note name or path.');
  if (value.show !== undefined && !['obsidian','website','both'].includes(value.show)) throw new Error('show must be obsidian, website, or both.');
  if (value.recursive !== undefined && typeof value.recursive !== 'boolean') throw new Error('recursive must be true or false.');
  if (value.mode !== undefined && !['grid','table'].includes(value.mode)) throw new Error('mode must be grid or table.');
  return {type:value.type,target:value.target?.trim(),show:value.show ?? 'both',recursive:value.recursive ?? value.type !== 'members',mode:value.mode ?? 'grid'};
}

const plain = value => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const linkTarget = value => typeof value === 'string' ? value.trim().replace(/^\[\[|\]\]$/g,'').split('|')[0].split('#')[0] : '';

// Hosts supply link resolution and visibility. All relationship calculations use
// the same dated services as the bio, without loading bodies or executing JS.
export function queryIndex(snapshot,options,{date,sourcePath,resolve,visible=()=>true}={}) {
  const {type,recursive=type !== 'members'} = options;
  if (!Object.hasOwn(indexLabels,type)) throw new Error('Unknown index type.');
  const {dates,names,locations,affiliations,templates} = createHeaderContext(snapshot,{date});
  const at = dates.normalizeDate(date);
  const byPath = new Map(snapshot.pages.map(page=>[page.path,page]));
  const lookup = (target,source=sourcePath) => {
    target=linkTarget(target);
    if (!target) return undefined;
    if (resolve) return resolve(target,source);
    const file=names.getFileForTarget(target);
    return file && byPath.get(file.path);
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
  // Residents match homeLocation; settlements match inLocation with last-known
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
      const next=locations.getWhereabouts(page.metadata,at);
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
  for (const page of snapshot.pages) {
    if (!visible(page) || page.path === target.path) continue;
    const metadata=page.metadata,pageType=getPageType(metadata);
    if (type === 'settlements' ? pageType !== 'place' || metadata.typeOf !== 'settlement' : pageType !== 'person') continue;
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
        const whereabouts=locations.getWhereabouts(metadata,at);
        if (!inLocation(whereabouts,page.path,type === 'residents')) continue;
      }
      const description=type === 'settlements' ? plain(metadata.typeOfAlias || metadata.typeOf) :
        [...new Set([metadata.ancestry,metadata.species,metadata.typeOfAlias || metadata.typeOf].map(plain).filter(Boolean))].join(' · ');
      const details=type === 'settlements' && typeof metadata.population === 'number' && Number.isFinite(metadata.population) ? 'Population '+metadata.population.toLocaleString('en-US') :
        type === 'members' ? [...new Set(roles.map(role=>plain(role.title)).filter(Boolean))].join(' · ') : '';
      const settlement=type === 'settlements' ? {
        name:templates.formatDisplayString('<name:n>',{name:page.name,frontmatter:metadata},at),
        region:locationItem(locations.getWhereabouts(metadata,at).home,page.path),
        settlementType:templates.formatDisplayString('<maintype:n>',{name:page.name,frontmatter:metadata},at),
        population:templates.formatDisplayString('<population>',{name:page.name,frontmatter:metadata},at),
      } : {};
      const person=type !== 'settlements' ? Object.fromEntries([
        ['person','<name> (<pronouns> <pronunciation>)'],
        ['info','<ancestry> <maintype>'],
        ['lastKnown',type === 'residents' ? '<lastknown:2> (<lastknowndate>)' : '<lastknown:2Fr> (<lastknowndate>)'],
        ...(type === 'residents' ? [['home','<home:1>']] : []),
      ].map(([field,format])=>[field,formattedParts(templates.formatDisplayString(format,{name:page.name,frontmatter:metadata},at),page.path)])) : {};
      items.push({path:page.path,name:displayName(page),description,details,
        pronunciation:plain(metadata.pronunciation),imageTarget:metadata.image,...settlement,...person});
    } catch (error) {
      if (!(error instanceof HeaderDataError)) throw error;
      warnings.add('Some pages were omitted because their relationship metadata contains a cycle.');
    }
  }
  const compare=(a,b)=>a.localeCompare(b,'en',{sensitivity:'base',numeric:true});
  items.sort((a,b)=>(type === 'settlements' ? compare(a.region?.name || 'Unknown',b.region?.name || 'Unknown') : 0) ||
    compare(a.name,b.name) || a.path.localeCompare(b.path,'en'));
  return {type,label:indexLabels[type],target:displayName(target),items,warnings:[...warnings]};
}
