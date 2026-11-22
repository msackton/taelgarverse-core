import {filterComments} from './comments.mjs';
import {scanCodeBlocks,scanSectionHeadings} from './markdown-fences.mjs';
import {sessionNumber} from './session-bundles.mjs';
import {indexSessionNotes,sessionSources} from './session-note-sources.mjs';
import {noteCampaignResolver} from './campaign-ownership.mjs';
import {campaignRoster,campaignList as list,campaignNameKey as nameKey,campaignText as text} from './campaign-roster.mjs';
import {campaignDates,dateSpan,mergeCampaignDates} from './campaign-dates.mjs';

const distinct = (items,key) => [...new Map(items.map(item=>[key(item),item])).values()];
const appearanceKey=person=>person.key;
const attendanceKey=row=>[nameKey(row.player),row.role,row.character?.key].join('\0');
const isAdventure=row=>row.kind==='adventure' || row.kind==='solo';
const minimumPlayerSpeechMs=30_000;

export function compareCampaignSessionNumbers(a,b) {
  const left=a.split('.'),right=b.split('.');
  for(let i=0;i<Math.max(left.length,right.length);i++) {
    if(left[i]===undefined || right[i]===undefined) return left.length-right.length;
    const x=BigInt(left[i]),y=BigInt(right[i]);
    if(x!==y) return x<y ? -1 : 1;
    if(left[i]!==right[i]) return left[i].length-right[i].length;
  }
  return 0;
}

export function discoverCampaignSessionNotes(store,registry) {
  const resolver=noteCampaignResolver(registry);
  const numbered=indexSessionNotes(store,resolver),arcs=new Map();
  for(const entry of store.entries) {
    const {type,campaign}=resolver.resolve(entry.id,entry.note.metadata);
    if(type!=='session-note' || !campaign || entry.note.metadata.sessionNumber!=null) continue;
    const paths=arcs.get(campaign) || [];
    paths.push(entry.id);
    arcs.set(campaign,paths);
  }
  return {numbered,arcs};
}

function arcSessions(note,campaign) {
  const visible=filterComments(note.body,{campaigns:[campaign],dm:true,date:'9999-12-31',source:note.path});
  const headings=scanSectionHeadings(visible,scanCodeBlocks(visible));
  const results=[];
  for(const heading of headings) {
    const headingText=visible.slice(heading.start,heading.contentStart).split('\n')[0].trim().replace(/^#+\s+/,'').replace(/\s+#+$/,'');
    const match=/^Session\s+([0-9]+(?:\.[0-9]+)?)(?:\s*[:–—]\s*(.+))?$/i.exec(headingText);
    if(!match || !visible.slice(heading.contentStart,heading.end).trim()) continue;
    results.push({number:sessionNumber(match[1]),title:match[2],target:note.path+'#'+headingText});
  }
  return results;
}

function isStub(metadata) {
  return list(metadata.tags).includes('status/stub') || nameKey(metadata.descTitle)==='calendar stub';
}

function metadataFacts(metadata,target) {
  return {
    target, title:text(metadata.descTitle) || text(metadata.name), stub:isStub(metadata),
    played:campaignDates(metadata.realWorldDate,'real',target),
    dr:campaignDates(metadata.DR,'dr',target),drEnd:campaignDates(metadata.DR_end,'dr',target),
    characters:list(metadata.players),companions:list(metadata.companions),
  };
}

function bundleFacts(bundle) {
  const {manifest={},manifestPath,recap,recapPath}=bundle;
  return {
    title:text(recap?.['Desc Title']) || text(recap?.Title),
    played:campaignDates(manifest.realWorldDate,'real',manifestPath),
    dr:[...campaignDates(manifest.drStart,'dr',manifestPath),...campaignDates(bundle.recapStart,'dr',recapPath)],
    drEnd:[...campaignDates(manifest.drEnd,'dr',manifestPath),...campaignDates(bundle.recapEnd,'dr',recapPath)],
    characters:text(recap?.PCs)?.split(/,\s*/) || [],
  };
}

function attendingSpeakers(bundle,resolveCharacter) {
  const participants=list(bundle.manifest?.participants);
  const byRole=new Map(participants.map(row=>[nameKey(row?.gameRole),row]));
  const positive=list(bundle.speakerStats?.speakers).filter(row=>['segmentCount','durationSeconds','wordCount'].some(key=>Number(row?.[key])>0));
  const attendance=[],speechByPlayer=new Map();
  for(const row of positive) {
    const mapped=byRole.get(nameKey(row.gameRole)) || participants.find(participant=>list(participant?.transcriptIdentifiers).includes(row.transcriptIdentifier));
    const gameRole=text(row.gameRole) || text(mapped?.gameRole);
    if(!gameRole || nameKey(gameRole)==='unknown') continue;
    const role=nameKey(gameRole)==='dm' ? 'dm' : 'player';
    const character=role==='player' ? resolveCharacter(gameRole) : null;
    const player=text(row.name) || text(mapped?.name);
    if(!player) continue;
    attendance.push({player,role,character,basis:'speaker',evidence:bundle.speakerStatsPath});
    const seconds=Number(row.durationSeconds);
    if(role==='player' && Number.isFinite(seconds) && seconds>0) {
      const key=nameKey(player);
      speechByPlayer.set(key,(speechByPlayer.get(key) || 0)+Math.round(seconds*1000));
    }
  }
  return attendance.filter(row=>row.role==='dm' || (speechByPlayer.get(nameKey(row.player)) || 0)>=minimumPlayerSpeechMs);
}

function participationFacts({notes,recapCharacters,bundle,roster,override,source}) {
  const resolve=values=>values.filter(value=>text(value) && !['none','unknown','—'].includes(nameKey(value)))
    .map(roster.resolveCharacter).filter(Boolean);
  const castNotes=notes.map(note=>({...note,characters:resolve(note.characters)})).filter(note=>note.characters.length);
  const preferred=castNotes.find(note=>note.preferred);
  const castSources=preferred ? [preferred] : castNotes.length ? castNotes :
    [{characters:resolve(list(recapCharacters)),target:bundle?.recapPath}];
  const listedCharacters=castSources.flatMap(item=>item.characters);
  const listedCompanions=resolve(notes.flatMap(note=>note.companions));
  const hasCharacterOverride=Object.hasOwn(override,'characters');
  const characters=hasCharacterOverride ? resolve(list(override.characters)) : listedCharacters;
  const hasCompanionOverride=Object.hasOwn(override,'companions');
  const companions=hasCompanionOverride ? resolve(list(override.companions)) :
    [...listedCompanions,...characters.filter(character=>character.kind==='companion')];
  const recorded=bundle?.manifest?.sourceType==='transcript' || !!bundle?.speakerStats;
  let attendance=null;
  if(Object.hasOwn(override,'attendance')) {
    if(override.attendance!==null) attendance=override.attendance.map(row=>({
      player:row.player,role:row.role || 'player',character:row.character ? roster.resolveCharacter(row.character) : null,basis:'reviewed',evidence:source,
    }));
  } else if(recorded) {
    const speakers=attendingSpeakers(bundle,roster.resolveCharacter);
    if(speakers.length) attendance=speakers;
  } else {
    const named=castSources.flatMap(item=>item.characters
      .filter(character=>character.player && character.kind!=='companion' &&
        !listedCompanions.some(companion=>companion.key===character.key))
      .map(character=>({player:character.player,role:'player',character,basis:'inferred',evidence:item.target})));
    if(named.length) attendance=named;
  }
  return {
    characters:distinct(characters.filter(character=>character.kind!=='companion' &&
      !companions.some(companion=>companion.key===character.key)),appearanceKey),
    companions:distinct(companions,appearanceKey),
    charactersKnown:hasCharacterOverride ? override.characters!==null : listedCharacters.length>0,
    attendance:attendance===null ? null : distinct(attendance,attendanceKey),
  };
}

function sessionRecord({row,override,roster,indexPath}) {
  const {number,id,notes=[],arcs=[],bundle}=row;
  const kind=override.kind || 'adventure';
  const fromBundle=bundle ? bundleFacts(bundle) : {};
  const finalNote=notes.find(note=>note.preferred && !note.stub);
  const account=override.account || finalNote?.target ||
    (notes.filter(note=>!note.stub).length===1 ? notes.find(note=>!note.stub).target : undefined) ||
    (arcs.length===1 ? arcs[0].target : undefined) || bundle?.recapPath ||
    (Object.keys(override).length ? indexPath+'#Play history' : undefined) ||
    (notes.length===1 ? notes[0].target : undefined);
  const authored=Object.keys(override).length ? indexPath : undefined;
  const dates={},dateConflicts={};
  for(const [field,calendar] of [['played','real'],['dr','dr'],['drEnd','dr']]) {
    const key=field==='played' && Object.hasOwn(override,'date') ? 'date' : field;
    let selected;
    if(Object.hasOwn(override,key)) selected=campaignDates(override[key],calendar,authored);
    else if(calendar==='dr' && finalNote?.[field].length) selected=finalNote[field];
    // The final note omits DR_end for a single-day session.
    else if(field==='drEnd' && finalNote?.dr.length) selected=dates.dr;
    const merged=mergeCampaignDates([...notes.map(note=>note[field]),fromBundle[field] || []],selected);
    dates[field]=merged.dates;
    dateConflicts[field]=merged.conflicts;
  }
  return {
    key:number!==undefined ? 'session:'+number : 'event:'+id, number,id,kind,
    title:override.title || finalNote?.title || notes.find(note=>!note.stub)?.title ||
      arcs[0]?.title || fromBundle.title || (number===undefined ? id.replaceAll('-',' ') : 'Session '+number),
    account,note:override.note,...dates,dateConflicts,
    ...participationFacts({notes,recapCharacters:fromBundle.characters,bundle,roster,override,source:authored}),
    evidence:[...new Set([...notes.map(note=>note.target),...arcs.map(arc=>arc.target),bundle?.manifestPath,bundle?.recapPath,
      bundle?.speakerStatsPath,authored,...list(override.evidence)].filter(Boolean))],
  };
}

function summaryFor(rows,estimate,indexPath) {
  const played=rows.filter(isAdventure),numbered=played.filter(row=>row.number!==undefined);
  const byKind=Object.fromEntries(['adventure','solo','inter-session','meeting'].map(kind=>[kind,rows.filter(row=>row.kind===kind).length]));
  return {
    count:estimate?.count ?? played.length,estimated:estimate?.count!==undefined,
    first:numbered[0]?.number,latest:numbered.at(-1)?.number,
    estimatedFirst:estimate?.first,estimatedLatest:estimate?.latest,
    played:dateSpan(played,'played'),dr:dateSpan(played,'dr','drEnd'),
    estimatedPlayed:campaignDates(estimate?.played,'real',indexPath),
    estimatedDR:campaignDates(estimate?.dr,'dr',indexPath),
    note:estimate?.note,evidence:list(estimate?.evidence),byKind,
  };
}

function appendAppearanceLinks(roster,rows) {
  for(const session of rows) for(const participation of list(session.attendance)) {
    if(participation.role==='dm') continue;
    const key=nameKey(participation.player);
    let row=roster.players.get(key);
    if(!row) {
      row={key,player:participation.player,characters:[],attendance:[]};
      roster.players.set(key,row);
    }
    if(!row.attendance.some(item=>item.key===session.key)) row.attendance.push(session);
  }
}

export function buildCampaignRecord({campaign,registry,indexPath,store,sessionNotes,definitions={},arcNotes=[],bundles=[],warnings=[]}) {
  const config=registry.campaigns[campaign];
  if(!config) throw new Error('Unknown campaign '+campaign+'.');
  const diagnostics=new Set(warnings),warn=message=>diagnostics.add(message);
  const roster=campaignRoster(store,config,definitions.roster?.overrides || [],warn);
  const rows=new Map();
  const ensure=(number,id)=>{
    const key=number!==undefined ? 'session:'+number : 'event:'+id;
    if(!rows.has(key)) rows.set(key,{number,id});
    return rows.get(key);
  };
  for(const {campaign:owner,number,entries} of sessionNotes.numbered.values()) {
    if(owner!==campaign) continue;
    const {preferred}=sessionSources(sessionNotes.numbered,registry,campaign,number);
    if(entries.length>1 && !preferred) warn('Multiple session notes for '+campaign+' '+number+'.');
    ensure(number).notes=entries.map(entry=>({...metadataFacts(entry.note.metadata,entry.id),preferred:entry.slug===preferred}));
  }
  for(const note of arcNotes) {
    try {
      for(const arc of arcSessions(note,campaign)) {
        const row=ensure(arc.number);
        (row.arcs ||= []).push(arc);
      }
    } catch(error) { warn(note.path+': '+error.message); }
  }
  for(const bundle of bundles) {
    if(bundle.played) ensure(bundle.number).bundle=bundle;
    else if(rows.has('session:'+bundle.number)) rows.get('session:'+bundle.number).bundle=bundle;
  }
  for(const override of definitions.sessions?.overrides || []) {
    const row=ensure(override.number,override.id);
    if(row.override) throw new Error('The '+campaign+' index overrides '+(override.number ?? override.id)+' more than once.');
    row.override=override;
  }
  const sessions=[...rows.values()].map(row=>sessionRecord({row,override:row.override || {},roster,indexPath}));
  sessions.sort((a,b)=>a.number!==undefined && b.number!==undefined ? compareCampaignSessionNumbers(a.number,b.number) :
    Number(a.number===undefined)-Number(b.number===undefined) ||
    (a.played[0]?.start || '9999').localeCompare(b.played[0]?.start || '9999') || a.key.localeCompare(b.key));
  appendAppearanceLinks(roster,sessions);
  return {
    campaign,indexPath,name:config.name,sessions,summary:summaryFor(sessions,definitions.sessions?.estimate,indexPath),
    roster:[...roster.players.values()].sort((a,b)=>(a.player || '').localeCompare(b.player || '')),
    warnings:[...diagnostics],
  };
}
