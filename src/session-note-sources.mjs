import {sessionNumber} from './session-bundles.mjs';

export function indexSessionNotes(store,resolver) {
  const sessions=new Map();
  for(const entry of store.bySlug.values()) {
    const {type,campaign}=resolver.resolve(entry.id,entry.note.metadata);
    if(type!=='session-note' || !campaign)continue;
    const number=sessionNumber(entry.note.metadata.sessionNumber);
    if(number===null)continue;
    const identity=campaign+':'+number;
    if(!sessions.has(identity))sessions.set(identity,{campaign,number,entries:[]});
    sessions.get(identity).entries.push(entry);
  }
  return sessions;
}

export function sessionSources(sessions,registry,campaign,number) {
  const candidates=sessions.get(campaign+':'+number)?.entries || [];
  if(!candidates.length)return {candidates:[]};
  const config=Object.values(registry.campaigns || {}).find(item=>item.code===campaign);
  let preferred;
  if (config?.campaignRoot && config.notePattern && /^\d+(?:\.\d+)?$/.test(String(number))) {
    const [whole,fraction]=String(number).split('.'),padded=whole.padStart(2,'0')+(fraction ? '.'+fraction : '');
    const expected=(config.campaignRoot.replace(/[\\/]+$/,'')+'/'+config.notePattern.replaceAll('{session_padded}',padded).replaceAll('{session}',String(number))).replaceAll('\\','/');
    preferred=candidates.find(entry=>entry.id===expected)?.slug;
  }
  return {candidates:candidates.map(entry=>entry.slug),...(preferred ? {preferred} : {})};
}
