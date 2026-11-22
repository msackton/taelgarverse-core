export const campaignList = value => Array.isArray(value) ? value : value == null ? [] : [value];
export const campaignNameKey = value => String(value ?? '').trim().toLowerCase();
export const campaignText = value => typeof value==='string' && value.trim() ? value.trim() : undefined;

export function campaignWikiLink(value) {
  const match=/^!?\[\[([^|\]]+)(?:\|([^\]]+))?\]\]$/.exec(String(value ?? '').trim());
  return match ? {target:match[1].trim(), label:campaignText(match[2])} : null;
}

function partyCharacterKind(title,type) {
  const key=campaignNameKey(title);
  if (['member','regular'].includes(key) || (!key && ['','member','primary'].includes(campaignNameKey(type)))) return 'member';
  if (key==='guest' || key==='companion') return key;
  return 'associated';
}

function defaultRole(characters) {
  if (characters.some(character=>character.kind==='member')) return 'core';
  if (characters.some(character=>character.kind==='guest') &&
      characters.every(character=>['guest','companion'].includes(character.kind))) return 'other';
}

function fromEntry(entry) {
  const metadata=entry.note.metadata;
  return {
    key:entry.id, target:entry.id, label:campaignText(metadata.name) || entry.name,
    aliases:[entry.name,...campaignList(metadata.aliases)],
    player:campaignText(metadata.player),
  };
}

function trackName(map,name,character) {
  const key=campaignNameKey(name);
  if (!key) return;
  const candidates=map.get(key) || new Set();
  candidates.add(character);
  map.set(key,candidates);
}

export function campaignRoster(store,config,overrides,warn) {
  const characters=new Map(),players=new Map();
  const party=config.partyPage && store.lookup(config.partyPage);
  if (party && party.status!=='found') warn('Cannot resolve registered party '+config.partyPage+'.');
  const playerRow=(name)=>{
    const key=campaignNameKey(name);
    if (!players.has(key)) players.set(key,{key,player:name,characters:[],attendance:[]});
    return players.get(key);
  };
  if (party?.status==='found') for(const entry of store.entries) {
    const metadata=entry.note.metadata;
    if (!entry.id.startsWith('People/PCs/') || !campaignList(metadata.tags).includes('person')) continue;
    const kinds=new Set();
    for(const raw of campaignList(metadata.affiliations)) {
      const affiliation=typeof raw==='string' ? {org:raw} : raw;
      const org=campaignText(affiliation?.org);
      if (!org) continue;
      const target=campaignWikiLink(org)?.target || org;
      if (store.lookup(target).entry?.id===party.entry.id ||
          [party.entry.note.metadata.name,party.entry.name].some(label=>campaignNameKey(label)===campaignNameKey(target))) {
        kinds.add(partyCharacterKind(affiliation.title,affiliation.type));
      }
    }
    if (kinds.size>1) warn('Conflicting party affiliations for '+entry.id+'.');
    if (kinds.size) characters.set(entry.id,{...fromEntry(entry),kind:kinds.size===1 ? [...kinds][0] : 'associated'});
  }

  for(const override of overrides) {
    const {player,role,kind,note,description,draft}=override;
    let character;
    if (override.character) {
      const link=campaignWikiLink(override.character);
      if (link) {
        const result=store.lookup(link.target);
        if (result.status!=='found') {
          warn('Cannot resolve character '+link.target+' ('+result.status+').');
          continue;
        }
        character=characters.get(result.entry.id) || fromEntry(result.entry);
        if (link.label) character={...character,label:link.label};
      } else {
        const key='name:'+campaignNameKey(override.character);
        character=characters.get(key) || {key,label:override.character,aliases:[]};
      }
      character={...character,player:player || character.player,kind:kind || character.kind || 'member'};
      if (description!==undefined) character.description=description;
      characters.set(character.key,character);
    }
    const name=player || character?.player;
    if (name && (!character || role!==undefined || note!==undefined || draft!==undefined)) {
      const row=playerRow(name);
      if (role!==undefined) row.role=role;
      if (note!==undefined) row.note=note;
      if (draft!==undefined) row.draft=draft;
    }
  }

  const byName=new Map();
  for(const character of characters.values()) {
    for(const name of [character.label,character.target,...character.aliases]) trackName(byName,name,character);
    playerRow(character.player).characters.push(character);
  }
  for(const row of players.values()) if(row.role===undefined) row.role=defaultRole(row.characters);

  function resolveCharacter(value) {
    const raw=campaignText(value);
    if(!raw) return null;
    const link=campaignWikiLink(raw);
    if (link) {
      const result=store.lookup(link.target);
      if (result.status==='found') {
        const character=characters.get(result.entry.id) || fromEntry(result.entry);
        return link.label ? {...character,label:link.label} : character;
      }
      warn('Cannot resolve character '+link.target+' ('+result.status+').');
      return {key:'name:'+campaignNameKey(raw),label:link.label || link.target};
    }
    const candidates=byName.get(campaignNameKey(raw));
    if(candidates?.size===1) return [...candidates][0];
    if(candidates?.size>1) warn('Ambiguous campaign character '+raw+'.');
    return {key:'name:'+campaignNameKey(raw),label:raw};
  }

  return {players,resolveCharacter};
}
