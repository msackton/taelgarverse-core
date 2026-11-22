import {escapeHtml as escape} from './common.mjs';
import {sessionPeopleColumns} from './campaign-blocks.mjs';
import {formatCampaignDate,formatCampaignDates} from './campaign-dates.mjs';
import {campaignList as list,campaignNameKey,campaignWikiLink} from './campaign-roster.mjs';

const labels={
  player:'Player',role:'Role',character:'Characters',attendance:'Documented play',note:'Notes',
  session:'Session',title:'Title',played:'Played',dr:'In-world dates',
  participants:'Attendance',characters:'Characters present',people:'Cast and attendance',account:'Session Notes',evidence:'Evidence',
  first:'First numbered adventure',latest:'Latest numbered adventure',count:'Sessions played',
};
const defaultSessionColumns=['session','account','played','dr'];
const defaultSummaryFields=['count','played','dr'];
const summaryLabels={...labels,played:'Real-world span',dr:'In-world span'};
const kindLabel={adventure:'Adventure',solo:'Solo', 'inter-session':'Inter-session',meeting:'Meeting'};
const sessionLabel=row=>row.number!==undefined ? 'Session '+row.number : row.title;

export function campaignReference(value) {
  const wikilink=campaignWikiLink(value);
  if(wikilink) return {target:wikilink.target,label:wikilink.label || wikilink.target.split('/').at(-1).replace(/\.md(?=#|$)/,'')};
  const markdown=/^\[([^\]]+)\]\((.+)\)$/.exec(value);
  if(markdown) return {target:markdown[2],label:markdown[1]};
  return {target:value,label:value.split('/').at(-1).replace(/\.md(?=#|$)/,'')};
}

function table(columns,rows,sessionList=false) {
  const wrapper='taelgar-index-table-scroll'+(sessionList ? ' taelgar-session-list' : '');
  const cell=(key,value)=>{
    const content=value || '—';
    return '<td>'+(sessionList ? '<span class="taelgar-session-cell-label" aria-hidden="true">'+escape(labels[key])+
      '</span><div class="taelgar-session-cell-value">'+content+'</div>' : content)+'</td>';
  };
  return '<div class="'+wrapper+'"><table class="taelgar-index-table"'+(sessionList ? ' role="table"' : '')+'><thead><tr>'+
    columns.map(key=>'<th scope="col">'+escape(labels[key])+'</th>').join('')+'</tr></thead><tbody>'+
    rows.map(row=>'<tr'+(row.details ? ' class="taelgar-session-has-details"' : '')+'>'+
      columns.map(key=>cell(key,row[key])).join('')+'</tr>'+
      (row.details ? '<tr class="taelgar-session-detail-row"><td colspan="'+columns.length+'">'+row.details+'</td></tr>' : '')).join('')+
    '</tbody></table></div>';
}
const htmlList=items=>'<ul>'+items.map(item=>'<li>'+item+'</li>').join('')+'</ul>';
const details=(label,content)=>'<details><summary>'+escape(label)+'</summary>'+content+'</details>';
const characterLink=(character,link)=>character.target ? link(character.target,character.label) : escape(character.label);

const roleNames={core:'Core players',other:'Other players',unspecified:'Role unrecorded'};
const rosterKinds={guest:'Guest',associated:'Associated'};

function rosterAppearances(row) {
  const roles=new Map();
  for(const session of row.attendance) for(const person of list(session.attendance)) {
    if(person.role==='dm' || campaignNameKey(person.player)!==row.key) continue;
    const key=person.character?.key ?? null;
    if(!roles.has(key)) roles.set(key,{character:person.character,sessions:new Map()});
    roles.get(key).sessions.set(session.key,session);
  }
  return roles;
}

function rosterRows(record,options) {
  const groups=new Map(Object.keys(roleNames).map(role=>[role,[]]));
  const companions=new Map(),presence=new Map();
  if(options.characterPresence) for(const session of record.sessions) {
    for(const character of [...session.characters,...session.companions]) {
      const appearances=presence.get(character.key) || new Map();
      appearances.set(session.key,session);
      presence.set(character.key,appearances);
    }
  }
  for(const player of record.roster) {
    if(options.playerRole && !options.playerRole.includes(player.role)) continue;
    const shown=player.characters.filter(character=>!options.characterKind || options.characterKind.includes(character.kind));
    const roles=rosterAppearances(player),characters=[];
    for(const character of shown) {
      const item={...character,sessions:roles.get(character.key)?.sessions,presence:presence.get(character.key)};
      if(character.kind==='companion') companions.set(character.key,item);
      else characters.push(item);
    }
    const rosterKeys=new Set(player.characters.map(character=>character.key));
    const other=options.characterKind ? [] : [...roles.entries()].filter(([key])=>!rosterKeys.has(key)).map(([,role])=>role);
    if(characters.length || other.length ||
        (!options.characterKind && (!player.characters.length || player.draft || player.note))) {
      groups.get(player.role ?? 'unspecified').push({...player,characters,other});
    }
  }
  return {groups:[...groups].filter(([,rows])=>rows.length),companions:[...companions.values()]};
}

function rosterCharacter(character,link) {
  return characterLink(character,link)+(rosterKinds[character.kind] ?
    ' <small class="taelgar-roster-label">'+rosterKinds[character.kind]+'</small>' : '')+
    (character.description ? ' <span class="taelgar-roster-description">'+escape(character.description)+'</span>' : '');
}

function rosterSessionLinks(sessions,link,describe) {
  const links=[...sessions.values()].map(session=>{
    const label=sessionLabel(session);
    const account=session.account ? referenceLink(session.account,link,label) : escape(label);
    const status=describe?.(session);
    return '<li>'+account+(status ? ' <small class="taelgar-roster-label">'+escape(status)+'</small>' : '')+'</li>';
  });
  return '<ul class="taelgar-roster-session-links">'+links.join('')+'</ul>';
}

function rosterSessionCount(character,link,orderedSessions) {
  const played=character.sessions,present=character.presence;
  if(!played?.size && !present?.size) return '';
  const sessions=orderedSessions ?
    orderedSessions.filter(session=>played?.has(session.key) || present?.has(session.key)) : [...played.values()];
  const count=sessions.length;
  const countLabel=count+' '+(count===1 ? 'session' : 'sessions');
  const label=played?.size ? countLabel : countLabel+' present';
  const accessibleLabel=orderedSessions ? character.label+' · '+label : label+' as '+character.label;
  const describe=orderedSessions && played?.size ? session=>{
    if(!played.has(session.key)) return 'Present only';
    if(present?.has(session.key)) return '';
    return session.charactersKnown ? 'Played · unlisted in cast' : 'Played · cast unknown';
  } : undefined;
  return '<details class="taelgar-roster-play"><summary aria-label="'+escape(accessibleLabel)+'">'+label+
    '</summary>'+rosterSessionLinks(sessions,link,describe)+'</details>';
}

function rosterOtherAppearances(other,link) {
  if(!other.length) return '';
  return '<details class="taelgar-roster-other"><summary>Other appearances</summary>'+
    other.map(({character,sessions})=>'<div class="taelgar-roster-character"><div>'+
      (character ? characterLink(character,link) : 'Character unrecorded')+'</div>'+rosterSessionLinks(sessions,link)+'</div>').join('')+'</details>';
}

function rosterCompanions(companions,link,{open,orderedSessions}={}) {
  if(!companions.length) return '';
  return '<details class="taelgar-roster-companions"'+(open ? ' open' : '')+'><summary>Companions ('+companions.length+')</summary>'+
    companions.map(character=>'<div class="taelgar-roster-character"><div>'+rosterCharacter(character,link)+
      '</div>'+rosterSessionCount(character,link,orderedSessions)+'</div>').join('')+'</details>';
}

const rosterPlayer=row=>escape(row.player || 'Player unrecorded')+
  (row.draft ? ' <small class="taelgar-roster-label">Draft</small>' : '');

function rosterView(record,options,link) {
  const {groups,companions}=rosterRows(record,options),columns=options.columns;
  const rows=groups.flatMap(([,players])=>players);
  const showCharacters=!columns || columns.includes('character');
  const orderedSessions=options.characterPresence ? record.sessions : undefined;
  const side=showCharacters ? rosterCompanions(companions,link,{open:!rows.length,orderedSessions}) : '';
  if(!rows.length) return side || '<p>No roster entries match this view.</p>';
  if(columns?.length===1 && columns[0]==='character') {
    const characters=rows.flatMap(row=>row.characters).map(character=>rosterCharacter(character,link));
    if(characters.length===1) return '<p>'+characters[0]+'</p>'+side;
    return (characters.length ? htmlList(characters) : '<p>No characters documented.</p>')+side;
  }
  if(columns) return table(columns,rows.map(row=>({
    player:rosterPlayer(row),
    role:row.role ? escape(row.role) : '',
    character:row.characters.map(character=>'<div>'+rosterCharacter(character,link)+'</div>').join(''),
    attendance:row.characters.filter(character=>character.sessions?.size || character.presence?.size)
      .map(character=>'<div class="taelgar-roster-character"><span>'+characterLink(character,link)+'</span>'+
        rosterSessionCount(character,link,orderedSessions)+'</div>').join('')+rosterOtherAppearances(row.other,link),
    note:row.note ? escape(row.note) : '',
  })))+side;
  return groups.map(([role,players])=>'<div class="taelgar-roster-group">'+
    (groups.length>1 ? '<h3 class="taelgar-roster-group-heading">'+roleNames[role]+'</h3>' : '')+
    '<ul class="taelgar-roster-players">'+players.map(row=>'<li class="taelgar-roster-player"><div class="taelgar-roster-name">'+
      rosterPlayer(row)+'</div><div>'+
      row.characters.map(character=>'<div class="taelgar-roster-character"><div>'+rosterCharacter(character,link)+'</div>'+
        rosterSessionCount(character,link,orderedSessions)+'</div>').join('')+
      rosterOtherAppearances(row.other,link)+(row.note ? '<div class="taelgar-roster-description">'+escape(row.note)+'</div>' : '')+
      '</div></li>').join('')+'</ul></div>').join('')+side;
}

function formatSpan(estimate,span,calendar) {
  const options={includeDuration:true};
  if(estimate.length) return formatCampaignDates(estimate,calendar,[],options);
  return span ? formatCampaignDates(span.first ? [span.first] : [],calendar,span.last ? [span.last] : [],options) : '';
}

function evidenceView(row,link) {
  const evidence=[...row.evidence,...[...row.played,...row.dr,...row.drEnd].flatMap(item=>dateSources(item))];
  const conflicts=Object.entries(row.dateConflicts).flatMap(([field,dates])=>dates.map(item=>'<li>'+
    escape((field==='drEnd' ? 'In-world end date' : labels[field])+': '+formatCampaignDate(item,field==='played' ? 'real' : 'dr'))+
    (item.evidence.length ? ' ('+item.evidence.map(value=>referenceLink(value,link)).join(', ')+')' : '')+'</li>'));
  const sources=[...new Set(evidence)].map(value=>referenceLink(value,link));
  if(!sources.length && !conflicts.length) return null;
  return {
    summary:conflicts.length ? 'Sources and date differences' : 'Sources',
    content:(sources.length ? htmlList(sources) : '')+
      (conflicts.length ? '<p class="taelgar-session-field-heading">Other recorded dates</p><ul>'+conflicts.join('')+'</ul>' : ''),
  };
}

function dateSources(item) {
  return [...item.evidence,...list(item.alternatives).flatMap(dateSources)];
}

function referenceLink(value,link,label) {
  const reference=campaignReference(value);
  return link(reference.target,label || reference.label);
}

function summaryView(summary,options,link) {
  if(options.summary===false) return '';
  const fields=Array.isArray(options.summary) ? options.summary : defaultSummaryFields;
  const values={
    first:summary.first ?? (summary.estimatedFirst!==undefined ? summary.estimatedFirst+' (estimated)' : undefined),
    latest:summary.latest ?? (summary.estimatedLatest!==undefined ? summary.estimatedLatest+' (estimated)' : undefined),
    count:summary.estimated ? 'About '+summary.count : summary.count,
    played:formatSpan(summary.estimatedPlayed,summary.played,'real'),
    dr:formatSpan(summary.estimatedDR,summary.dr,'dr'),
  };
  const entries=fields.filter(field=>values[field]!==null && values[field]!==undefined && values[field]!=='');
  if(!entries.length && !summary.note && !summary.evidence.length) return '';
  return '<section class="taelgar-session-summary"><h3>Session summary</h3>'+
    (entries.length ? '<dl class="taelgar-campaign-summary">'+entries.map(field=>'<div><dt>'+escape(summaryLabels[field])+
      '</dt><dd>'+escape(values[field])+'</dd></div>').join('')+'</dl>' : '')+
    (summary.note ? '<p>'+escape(summary.note)+'</p>' : '')+
    (summary.evidence.length ? details('Summary sources',htmlList(summary.evidence.map(value=>referenceLink(value,link)))) : '')+'</section>';
}

function sessionCast(row) {
  return new Map([
    ...row.characters.map(character=>[character.key,{character,companion:false}]),
    ...row.companions.map(character=>[character.key,{character,companion:true}]),
  ]);
}

function castLabel({character,companion},link) {
  return characterLink(character,link)+(companion ? ' <small>(companion)</small>' : '');
}

function sessionCharacters(row,link) {
  const characters=[...sessionCast(row).values()].map(cast=>castLabel(cast,link));
  if(!characters.length) return row.charactersKnown ?
    {summary:'No characters recorded',content:'None recorded'} : {summary:'Cast unknown',content:'Unknown'};
  return {summary:characters.length===1 ? '1 character' : characters.length+' characters',content:htmlList(characters)};
}

function sessionParticipants(row) {
  const participants=new Map();
  for(const fact of list(row.attendance)) {
    const key=campaignNameKey(fact.player);
    if(!participants.has(key))
      participants.set(key,{name:fact.player,dm:false,inferred:true,characters:new Map()});
    const participant=participants.get(key);
    participant.dm ||= fact.role==='dm';
    participant.inferred &&= fact.basis==='inferred';
    if(fact.role!=='dm' && fact.character) participant.characters.set(fact.character.key,fact.character);
  }
  return [...participants.values()].sort((a,b)=>Number(b.dm)-Number(a.dm));
}

function participantLabel(person) {
  return escape(person.name)+(person.dm ? ' <small>(DM)</small>' : '')+
    (person.inferred ? ' <small>(inferred)</small>' : '');
}

function sessionAttendance(row) {
  if(row.attendance===null) return {summary:'Attendance unknown',content:'Unknown'};
  if(!row.attendance.length) return {summary:'No attendance recorded',content:'None recorded'};
  const participants=sessionParticipants(row).map(participantLabel);
  const count=participants.length;
  return {summary:count===1 ? '1 participant' : count+' participants',content:htmlList(participants)};
}

function sessionPeople(row,link) {
  const cast=sessionCast(row);
  const participants=sessionParticipants(row);
  const played=new Set();
  const items=participants.map(person=>{
    const roles=[...person.characters.values()].map(character=>{
      played.add(character.key);
      const entry=cast.get(character.key);
      if(entry) return castLabel(entry,link);
      return characterLink(character,link)+(row.charactersKnown ? ' <small>(unlisted in cast)</small>' : '');
    });
    return participantLabel(person)+(roles.length ? ' · '+roles.join(', ') : '');
  });
  for(const [key,entry] of cast) {
    if(!played.has(key))
      items.push(castLabel(entry,link)+(row.attendance!==null && !entry.companion ? ' <small>(present only)</small>' : ''));
  }
  const statuses=[];
  if(!row.charactersKnown) statuses.push('Cast unknown');
  if(row.attendance===null) statuses.push('Attendance unknown');
  const content=(items.length ? htmlList(items) : '')+
    (statuses.length ? '<p>'+statuses.join(' · ')+'</p>' : '');
  return {summary:labels.people,content:content || 'None recorded'};
}

const sessionDetailRenderers={
  characters:sessionCharacters,participants:sessionAttendance,people:sessionPeople,evidence:evidenceView,
  note:row=>row.note ? {summary:'Notes',content:escape(row.note)} : null,
};

function sessionDetails(row,fields,link) {
  const sections=fields.flatMap(field=>{
    const section=sessionDetailRenderers[field](row,link);
    return section ? [{field,...section}] : [];
  });
  if(!sections.length) return '';
  const summary=sections.map(section=>section.summary).join(' · ');
  return '<details class="taelgar-session-details"><summary aria-label="'+escape(sessionLabel(row)+' · '+summary)+'">'+
    escape(summary)+'</summary><div class="taelgar-session-detail-fields">'+sections.map(({field,content})=>{
      const heading=field==='evidence' ? 'Sources' : labels[field];
      return '<div class="taelgar-session-detail-field" data-field="'+field+'">'+
        (heading!==summary ? '<p class="taelgar-session-field-heading">'+escape(heading)+'</p>' : '')+
        '<div>'+content+'</div></div>';
    }).join('')+'</div></details>';
}

function sessionFields(columns) {
  const [first,...others]=columns.filter(column=>sessionPeopleColumns.includes(column));
  if(!others.length) return columns;
  return columns.flatMap(column=>column===first ? ['people'] : others.includes(column) ? [] : [column]);
}

function sessionView(record,options,link) {
  const summary=summaryView(record.summary,options,link);
  if(options.summary==='only') return summary;
  const columns=sessionFields(options.columns || defaultSessionColumns);
  const detailFields=columns.filter(column=>Object.hasOwn(sessionDetailRenderers,column));
  const overviewColumns=columns.filter(column=>!detailFields.includes(column));
  const sessions=record.sessions.filter(row=>!options.kinds || options.kinds.includes(row.kind));
  if(!sessions.length) return summary+'<p>No individual sessions match this view.</p>';
  return summary+(options.kinds ? '<p>'+sessions.length+' matching '+(sessions.length===1 ? 'entry' : 'entries')+'</p>' : '')+
    table(overviewColumns.length ? overviewColumns : ['session'],sessions.map(row=>({
      session:escape(sessionLabel(row))+(row.kind!=='adventure' ? ' <small>('+escape(kindLabel[row.kind])+')</small>' : ''),
      title:row.title===sessionLabel(row) ? '' : escape(row.title),
      played:escape(formatCampaignDates(row.played,'real')),dr:escape(formatCampaignDates(row.dr,'dr',row.drEnd)),
      account:row.account ? referenceLink(row.account,link,row.title) :
        !columns.includes('title') && row.title!==sessionLabel(row) ? escape(row.title) : '',
      details:sessionDetails(row,detailFields,link),
    })),true);
}

export function renderCampaignView(type,record,options,link) {
  const title=record.name+(type==='roster' ? ' roster' : ' play history');
  return '<section class="taelgar-campaign-view" aria-label="'+escape(title)+'">'+
    (type==='roster' ? rosterView(record,options,link) : sessionView(record,options,link))+
    (record.warnings.length ? details('Source issues ('+record.warnings.length+')',htmlList(record.warnings.map(escape))) : '')+'</section>';
}
