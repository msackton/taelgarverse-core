import {normalizeCampaignRegistry} from './campaigns.mjs';

function deepFreeze(value) {
  if(value && typeof value==='object' && !Object.isFrozen(value)) {
    for(const item of Object.values(value))deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

// Host adapters supply metadata and, optionally, their native link resolver.
// Maps stay private; every render shares only this immutable input snapshot.
export function createHeaderSnapshot(rawInput,{resolveLink}={}) {
  const input=structuredClone({pages:rawInput.pages,coreMeta:rawInput.coreMeta,registry:rawInput.registry});
  const compiled=compileHeaderIndexes({...input,indexAffiliations:rawInput.indexAffiliations});
  return hydrateHeaderSnapshot(compiled,input.pages,{resolveLink});
}

// Publication stores indexes separately from page metadata. Hydration reuses
// that revision's parsed metadata rather than cloning the complete vault.
export function compileHeaderIndexes(rawInput) {
  const pages=rawInput.pages,byTarget=new Map(),byAffiliation=new Map();
  for(const [index,page] of pages.entries()){
    const name=page.path.split('/').at(-1).replace(/\.md$/,'');
    for(const key of [page.path,page.path.replace(/\.md$/,''),name,name+'.md']){
      const normalized=key.toLowerCase(),candidates=byTarget.get(normalized)??new Set();
      candidates.add(index);byTarget.set(normalized,candidates);
    }
  }
  let canIndexAffiliations=rawInput.indexAffiliations!==false;
  for(const [index,page] of pages.entries()){
    const targets=new Set();
    for(const field of [page.metadata.leaderOf,page.metadata.affiliations]){
      if(!field)continue;
      if(!Array.isArray(field)){canIndexAffiliations=false;continue;}
      for(const item of field){
        if(typeof item==='string')targets.add(item);
        else if(item && typeof item==='object')targets.add(item.org || item.place);
        else canIndexAffiliations=false;
      }
    }
    for(const target of targets){
      if(target==null)continue;
      const candidates=byAffiliation.get(String(target))??[];
      candidates.push(index);byAffiliation.set(String(target),candidates);
    }
  }
  return {coreMeta:rawInput.coreMeta,registry:rawInput.registry,campaigns:normalizeCampaignRegistry(rawInput.registry),canIndexAffiliations,
    targets:[...byTarget].map(([key,indices])=>[key,[...indices]]),affiliations:[...byAffiliation]};
}

export function hydrateHeaderSnapshot(input,rawPages,{resolveLink}={}) {
  const pages=deepFreeze(rawPages.map(({path,metadata})=>({path,name:path.split('/').at(-1).replace(/\.md$/,''),metadata})));
  const byPath=new Map(pages.map(page=>[page.path,page])),byTarget=new Map(input.targets);
  const byAffiliation=new Map(input.affiliations.map(([key,indices])=>[key,indices.map(index=>pages[index])]));
  const {canIndexAffiliations}=input;
  for(const candidates of byAffiliation.values())Object.freeze(candidates);
  const empty=Object.freeze([]);
  return Object.freeze({
    pages,coreMeta:deepFreeze(input.coreMeta),registry:deepFreeze(input.registry),
    campaigns:deepFreeze(input.campaigns),canIndexAffiliations,
    resolve(target) {
      if(resolveLink)return byPath.get(resolveLink(target));
      const candidates=byTarget.get(target.toLowerCase());
      return candidates?.length===1?pages[candidates[0]]:undefined;
    },
    affiliationCandidates:target=>canIndexAffiliations?(byAffiliation.get(String(target))??empty):pages,
  });
}
