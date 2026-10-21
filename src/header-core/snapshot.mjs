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
  const pages=deepFreeze(input.pages.map(({path,metadata})=>({path,name:path.split('/').at(-1).replace(/\.md$/,''),metadata})));
  const byPath=new Map(pages.map(page=>[page.path,page])),byTarget=new Map();
  for(const page of pages)for(const key of [page.path,page.path.replace(/\.md$/,''),page.name,page.name+'.md']) {
    const normalized=key.toLowerCase(),candidates=byTarget.get(normalized)??new Set();
    candidates.add(page);byTarget.set(normalized,candidates);
  }
  const byAffiliation=new Map();
  let canIndexAffiliations=rawInput.indexAffiliations!==false;
  for(const page of pages) {
    const targets=new Set();
    for(const field of [page.metadata.leaderOf,page.metadata.affiliations]) {
      if(!field)continue;
      if(!Array.isArray(field)){canIndexAffiliations=false;continue;}
      for(const item of field) {
        if(typeof item==='string')targets.add(item);
        else if(item && typeof item==='object')targets.add(item.org || item.place);
        else canIndexAffiliations=false;
      }
    }
    for(const target of targets) {
      if(target==null)continue;
      const candidates=byAffiliation.get(String(target))??[];
      candidates.push(page);byAffiliation.set(String(target),candidates);
    }
  }
  for(const candidates of byAffiliation.values())Object.freeze(candidates);
  const empty=Object.freeze([]);
  return Object.freeze({
    pages,coreMeta:deepFreeze(input.coreMeta),registry:deepFreeze(input.registry),
    campaigns:deepFreeze(normalizeCampaignRegistry(input.registry)),canIndexAffiliations,
    resolve(target) {
      if(resolveLink)return byPath.get(resolveLink(target));
      const candidates=byTarget.get(target.toLowerCase());
      return candidates?.size===1?[...candidates][0]:undefined;
    },
    affiliationCandidates:target=>canIndexAffiliations?(byAffiliation.get(String(target))??empty):pages,
  });
}
