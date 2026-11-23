import assert from 'node:assert/strict';
import test from 'node:test';
import {parseHTML} from 'linkedom';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ContentStore} from '../src/content-store.mjs';
import {campaignDefinitions,parseCampaignBlock} from '../src/campaign-blocks.mjs';
import {campaignDates,formatCampaignDates} from '../src/campaign-dates.mjs';
import {buildCampaignRecord,discoverCampaignSessionNotes} from '../src/campaign-records.mjs';
import {renderCampaignView} from '../src/campaign-view.mjs';
import {readCampaignSessionBundles} from '../src/vault-campaign-sessions.mjs';

const campaign='example',indexPath='Campaigns/_Index/Example Index.md';
const config={name:'Example',code:campaign,campaignRoot:'Campaigns/Example',
  partyPage:'People/PCs/Example Party',sessionBundleDirectory:'_sessions/example',notePattern:'Session {session_padded}.md'};
const registry={campaigns:{[campaign]:config}};
const note=(id,metadata)=>({id,slug:id,name:path.posix.basename(id,'.md'),target:id,note:{metadata}});
const pc=(name,player,org='Example Party',more={})=>note('People/PCs/'+name+'.md',{tags:['person'],player,affiliations:[org],...more});
const session=(number,metadata={},filename='Session '+number+'.md')=>note('Campaigns/Example/'+filename,{tags:['session-note'],campaign,sessionNumber:number,...metadata});
const base=[
  note('People/PCs/Example Party.md',{typeOf:'adventuring party'}),
  pc('Ilex','Pat','[[Example Party|the party]]',{aliases:['The Navigator'],affiliations:[{org:'[[Example Party|the party]]',end:'1747-01-01'}]}),
  pc('Bramble','Pat',{org:'Example Party',title:'guest'}),
  pc('Chanter','Alex',{org:'Example Party',title:'guest'}),
  pc('Dog',undefined,{org:'Example Party',title:'companion'}),
  pc('Ash','Sam','Different Party'),
];
const renderLink=(target,label)=>'<a data-target="'+target+'">'+label+'</a>';
const fence=(name,body='')=>'~~~taelgar-'+name+'\n'+body+'\n~~~';
function make({notes=[],definitions={},bundles=[],arcNotes=[]}={}) {
  const store=new ContentStore([...base,...notes]);
  return buildCampaignRecord({campaign,registry,indexPath,store,sessionNotes:discoverCampaignSessionNotes(store,registry),definitions,bundles,arcNotes});
}

test('a historical roster preserves roles, kinds, and narrow overrides',()=>{
  const definitions=campaignDefinitions(fence('roster',`overrides:
  - player: Pat
    role: other
  - character: "[[Ash]]"
    kind: guest
  - player: Kennedy
    draft: true
    note: Character not recorded.`),campaign);
  const record=make({definitions});
  const players=new Map(record.roster.map(row=>[row.player,row]));
  assert.equal(players.get('Pat').role,'other');
  assert.deepEqual(players.get('Pat').characters.map(character=>character.kind),['member','guest']);
  assert.equal(players.get('Alex').role,'other');
  assert.equal(players.get('Sam').role,'other');
  assert.equal(players.get('Kennedy').draft,true);
  assert.equal(players.get(undefined).characters[0].label,'Dog');
  const markup=renderCampaignView('roster',record,parseCampaignBlock('roster','playerRole: other\ncharacterKind: member\ncolumns: [character]'),renderLink);
  assert.match(markup,/<p>.*Ilex.*<\/p>/);
  assert.doesNotMatch(markup,/Bramble|<table>/);
});

test('roster play links follow each player and character across shared sessions',()=>{
  const definitions=campaignDefinitions(fence('session',`overrides:
  - number: 63
    attendance:
      - {player: Pat, character: Ilex}
      - {player: Pat, character: Bramble}
  - number: 65
    attendance:
      - {player: Pat, character: Ilex}
  - number: 102
    attendance:
      - {player: Pat, character: Tilly}
      - {player: Alex, character: Ilex}`),campaign);
  const record=make({definitions,notes:[session(63),session(65),session(102)]});
  const {document}=parseHTML(renderCampaignView('roster',record,{},renderLink));
  const groups=[...document.querySelectorAll('.taelgar-roster-group-heading')];
  assert.deepEqual(groups.map(node=>node.textContent),['Core players','Other players']);
  const [core,other]=document.querySelectorAll('.taelgar-roster-players');
  const pat=core.querySelector('.taelgar-roster-player');
  assert.equal(pat.querySelector('.taelgar-roster-name').textContent,'Pat');
  const asIlex=pat.querySelector('summary[aria-label="2 sessions as Ilex"]').parentElement;
  assert.deepEqual([...asIlex.querySelectorAll('a')].map(node=>node.textContent),['Session 63','Session 65']);
  const asBramble=pat.querySelector('summary[aria-label="1 session as Bramble"]').parentElement;
  assert.equal(asBramble.querySelector('a').textContent,'Session 63');
  const occasional=pat.querySelector('.taelgar-roster-other');
  assert.match(occasional.textContent,/Other appearancesTillySession 102/);
  assert.match(other.querySelector('.taelgar-roster-other').textContent,/IlexSession 102/);
  assert.equal(document.querySelector('table'),null);
  assert.doesNotMatch(pat.textContent,/Member|Dog/);
  assert.match(pat.textContent,/Bramble Guest/);
  assert.match(document.querySelector('.taelgar-roster-companions').textContent,/Dog/);

  const {document:uniform}=parseHTML(renderCampaignView('roster',record,{playerRole:['core']},renderLink));
  assert.equal(uniform.querySelector('.taelgar-roster-group-heading'),null);
  assert.equal(uniform.querySelectorAll('.taelgar-roster-player').length,1);
  const filtered=renderCampaignView('roster',record,{playerRole:['core'],characterKind:['member'],columns:['character']},renderLink);
  assert.match(filtered,/<p>.*Ilex.*<\/p>/);
  assert.doesNotMatch(filtered,/Bramble|Tilly|Dog|<ul>/);
});

test('recorded attendance, ordinary character presence, and inferred attendance coexist',()=>{
  const notes=[
    session(1,{players:['The Navigator','Chanter'],companions:['Dog']},'Session 01.md'),
    session(2,{players:['The Navigator'],realWorldDate:'2024-02-29'},'Session 02.md'),
    session(3,{players:[],companions:[],descTitle:'Calendar Stub'},'Session 03.md'),
  ];
  const bundles=[{
    number:'1',played:true,manifestPath:'manifest.yaml',manifest:{sourceType:'transcript',
      participants:[{name:'Pat',gameRole:'Ilex'},{name:'Alex',gameRole:'Chanter'},{name:'Guest Player',gameRole:'Ilex'},{name:'GM',gameRole:'DM'}]},
    speakerStatsPath:'speakers.json',speakerStats:{speakers:[
      {name:'Pat',gameRole:'Ilex',segmentCount:0},
      {name:'Guest Player',gameRole:'Ilex',durationSeconds:30},
      {name:'GM',gameRole:'DM',wordCount:4},
      {name:'Bystander',gameRole:'Unknown',segmentCount:1},
    ]},
  }];
  const record=make({notes,bundles});
  const [first,second,third]=record.sessions;
  assert.deepEqual(first.characters.map(person=>person.label),['Ilex','Chanter']);
  assert.deepEqual(first.attendance.map(row=>[row.player,row.basis,row.role]),[['Guest Player','speaker','player'],['GM','speaker','dm']]);
  assert.deepEqual(first.companions.map(person=>person.label),['Dog']);
  assert.equal(second.attendance[0].player,'Pat');
  assert.equal(second.attendance[0].basis,'inferred');
  assert.equal(second.played[0].text,'2024-02-29');
  assert.equal(third.attendance,null);
  assert.deepEqual(record.roster.find(row=>row.player==='Pat').attendance.map(row=>row.number),['2']);
  assert.deepEqual(record.roster.find(row=>row.player==='Guest Player').attendance.map(row=>row.number),['1']);
  assert.ok(!record.roster.some(row=>row.player==='GM'));
});

test('recorded player attendance uses 30 seconds across speaker labels and allows a reviewed override',()=>{
  const definitions=campaignDefinitions(fence('session',`overrides:
  - number: 3
    attendance:
      - {player: Pat, character: Ilex}`),campaign);
  const bundle=(number,speakers)=>({number,played:true,manifest:{sourceType:'transcript'},speakerStats:{speakers}});
  const speaker=(transcriptIdentifier,gameRole,durationSeconds)=>({name:'Pat',transcriptIdentifier,gameRole,durationSeconds});
  const record=make({definitions,notes:[session(1,{players:['Ilex']})],bundles:[
    bundle('1',[speaker('Pat on Zoom','Ilex',29.999),speaker('Pat as DM','DM',90)]),
    bundle('2',[speaker('Pat on Zoom','Ilex',11.25),speaker('Pat on Phone','Bramble',18.75)]),
    bundle('3',[speaker('Pat on Zoom','Ilex',2)]),
    bundle('4',[speaker('Pat on Zoom','Ilex',2)]),
  ]});
  const [below,at,reviewed,unknown]=record.sessions;
  assert.deepEqual(below.attendance.map(person=>person.role),['dm']);
  assert.deepEqual(below.characters.map(character=>character.label),['Ilex']);
  assert.deepEqual(at.attendance.map(person=>[person.player,person.character.label,person.basis]),
    [['Pat','Ilex','speaker'],['Pat','Bramble','speaker']]);
  assert.equal(reviewed.attendance[0].basis,'reviewed');
  assert.equal(unknown.attendance,null);
  assert.deepEqual(record.roster.find(row=>row.player==='Pat').attendance.map(session=>session.number),['2','3']);
});

test('character presence follows the session sources independently of player attendance',()=>{
  const definitions=campaignDefinitions(fence('session',`overrides:
  - number: 2
    characters: [Chanter, Dog]
    companions: []
    attendance:
      - {player: Substitute, character: Ilex}
  - number: 3
    characters: null
    attendance: []
  - number: 5
    characters: [Chanter]
  - number: 6
    characters: []
  - number: 7
    characters: null
    attendance:
      - {player: Pat, character: Ilex}`),campaign);
  const baselineNotes=[
    session(1,{players:['Ilex'],companions:['Dog']},'Session 01.md'),
    session(1,{players:['Chanter']},'Old Session 1.md'),
    session(2,{players:['Ilex'],companions:['Dog']}),
    session(3,{players:['Ilex']}),
    session(4,{players:[]}),
    session(5,{players:['Ilex']}),
    session(6,{players:['Ilex']}),
  ];
  const record=make({definitions,notes:baselineNotes,bundles:[
    {number:'1',played:true,manifest:{sourceType:'transcript'},recap:{PCs:'Chanter'},recapPath:'Recap 1.md',
      speakerStats:{speakers:[{name:'Pat',gameRole:'Bramble',durationSeconds:45}]}},
    {number:'4',played:true,manifest:{sourceType:'narrative'},recap:{PCs:'Ilex'},recapPath:'Recap 4.md'},
  ]});
  assert.deepEqual(record.sessions.map(row=>row.characters.map(character=>character.label)),
    [['Ilex'],['Chanter'],[],['Ilex'],['Chanter'],[],[]]);
  assert.deepEqual(record.sessions.map(row=>row.charactersKnown),[true,true,false,true,true,true,false]);
  assert.deepEqual(record.sessions.map(row=>row.attendance?.map(person=>[person.player,person.character.label,person.basis])),[
    [['Pat','Bramble','speaker']],
    [['Substitute','Ilex','reviewed']],
    [],
    [['Pat','Ilex','inferred']],
    [['Pat','Ilex','inferred']],
    [['Pat','Ilex','inferred']],
    [['Pat','Ilex','reviewed']],
  ]);
  assert.equal(record.sessions[3].attendance[0].evidence,'Recap 4.md');
  assert.deepEqual(record.sessions[0].companions.map(character=>character.label),['Dog']);
  assert.deepEqual(record.sessions[1].companions,[]);

  const options=parseCampaignBlock('roster','characterPresence: true');
  const {document}=parseHTML(renderCampaignView('roster',record,options,renderLink));
  const pat=[...document.querySelectorAll('.taelgar-roster-player')].find(row=>row.querySelector('.taelgar-roster-name').textContent==='Pat');
  const ilex=[...pat.querySelectorAll('.taelgar-roster-character')].find(row=>row.querySelector('a')?.textContent==='Ilex');
  assert.equal(ilex.querySelectorAll('details').length,1);
  assert.equal(ilex.querySelector('summary').textContent,'5 sessions');
  assert.deepEqual([...ilex.querySelectorAll('ul li')].map(node=>node.textContent),[
    'Session 1 Present only',
    'Session 4',
    'Session 5 Played · unlisted in cast',
    'Session 6 Played · unlisted in cast',
    'Session 7 Played · cast unknown',
  ]);
  const companion=document.querySelector('.taelgar-roster-companions .taelgar-roster-play');
  assert.equal(companion.querySelector('summary').textContent,'1 session present');
  assert.equal(companion.querySelector('li').textContent,'Session 1');
  const history=renderCampaignView('sessions',record,{columns:['characters']},renderLink);
  assert.match(history,/>Unknown<\/div>/);
  assert.match(history,/>None recorded<\/div>/);
});

test('session identities, dates, source links and campaign summaries survive filtering',()=>{
  const arcPath='Campaigns/Example/Arc 1.md';
  const notes=[session('12.1',{realWorldDate:'2021-12-06',DR:'1752-06-01'},'Session 12.1.md'),
    session('12.1',{realWorldDate:'2021-12-07'},'Older Session.md'),
    session('12.10',{DR:'1752-06-05'},'Session 12.10.md')];
  const definitions=campaignDefinitions(fence('session',`overrides:
  - number: "12.1"
    played: "2021-12-05"
    attendance: []
    note: Local date adopted.
  - number: "12.10"
    kind: inter-session
    played: {from: "2021-12-06", through: "2021-12-09", qualifier: possible}
  - number: "37"
    played:
      - {on: "2022-03-21", qualifier: inferred}
      - {on: "2022-03-26", qualifier: inferred}
    dr: "1752-08-01"
  - id: organizing-meeting
    kind: meeting
    title: Organizing meeting
    date: "2019-12-01"`),campaign);
  const record=make({notes,definitions,arcNotes:[{path:arcPath,body:
    '### Session 0\nPlayed.\n\n%%\n### Session 99\nExample.\n%%\n\n~~~md\n### Session 98\nExample.\n~~~\n\n### Session 37\nPlayed twice.'}]});
  assert.deepEqual(record.sessions.map(row=>row.key),['session:0','session:12.1','session:12.10','session:37','event:organizing-meeting']);
  assert.equal(record.summary.first,'0');
  assert.equal(record.summary.latest,'37');
  assert.equal(record.summary.count,3);
  assert.equal(record.summary.byKind.meeting,1);
  assert.equal(record.summary.dr.last.text,'1752-08-01');
  assert.equal(record.sessions[1].account,'Campaigns/Example/Session 12.1.md');
  assert.deepEqual(record.sessions[1].attendance,[]);
  assert.equal(record.sessions[1].dateConflicts.played.length,2);
  assert.equal(record.sessions[3].played.length,2);
  assert.equal(record.sessions[3].account,arcPath+'#Session 37');
  const markup=renderCampaignView('sessions',record,parseCampaignBlock('sessions','kinds: [solo]\nsummary: [first, latest, count, dr]'),renderLink);
  assert.match(markup,/Latest numbered adventure<\/dt><dd>37/);
  assert.match(markup,/Sessions played<\/dt><dd>3/);
  assert.match(markup,/No individual sessions/);
});

test('substitutes, missing facts and estimates use their own representations',()=>{
  const definitions=campaignDefinitions(fence('session',`estimate:
  count: 110
  first: 1
  latest: 110
  played: {label: "fall 1993 to late spring 1997", qualifier: approximate}
`),campaign);
  const approximate=make({definitions});
  assert.equal(approximate.sessions.length,0);
  assert.match(renderCampaignView('sessions',approximate,{},renderLink),/About 110/);
  assert.match(renderCampaignView('sessions',approximate,{},renderLink),/late spring 1997/);
  const unresolved=make({notes:[session(1,{realWorldDate:'2020-01-01'}),session(1,{realWorldDate:'2020-01-02'},'Legacy.md')]});
  assert.deepEqual(unresolved.sessions[0].played[0].alternatives.map(date=>date.text),['2020-01-01','2020-01-02']);
  assert.throws(()=>campaignDefinitions(fence('session','overrides: [{number: 12.10}]'),campaign),/quote/);
  assert.deepEqual(parseCampaignBlock('sessions','campaign: example\noverrides: ignored\nestimate: ignored'),{campaign:'example'});
  assert.deepEqual(parseCampaignBlock('roster','campaign: example\noverrides: ignored'),{campaign:'example'});
  assert.throws(()=>campaignDefinitions(fence('session')+'\n'+fence('session'),campaign),/more than once/);
  assert.throws(()=>campaignDefinitions(fence('roster','campaign: other'),campaign),/own campaign/);
});

test('the registered final note supplies the DR range while preserving conflicts and explicit overrides',()=>{
  const definitions=campaignDefinitions(fence('session',`overrides:
  - number: 3
    dr: "1748-03-25"`),campaign);
  const record=make({definitions,notes:[
    session(1,{DR:'1748-03-22',DR_end:'1748-03-23'},'Session 01.md'),
    session(1,{DR:'1748-03-22',DR_end:'1748-03-22'},'Older Session.md'),
    session(2,{DR:'1748-03-24'},'Session 02.md'),
    session(3,{DR:'1748-03-24'},'Session 03.md'),
    session(4,{tags:['session-note','status/stub'],DR:'1748-03-23'},'Session 04.md'),
  ],bundles:[
    {number:'2',played:true,manifest:{drStart:'1748-03-24',drEnd:'1748-03-27'},manifestPath:'Bundle 2.yaml'},
    {number:'4',played:true,manifest:{drStart:'1748-03-24'},manifestPath:'Bundle 4.yaml'},
  ]});
  const [final,single,override,stub]=record.sessions;
  assert.deepEqual(final.drEnd.map(date=>date.text),['1748-03-23']);
  assert.deepEqual(final.dateConflicts.drEnd.map(date=>date.evidence),[['Campaigns/Example/Older Session.md']]);
  assert.deepEqual(single.drEnd.map(date=>date.text),['1748-03-24']);
  assert.deepEqual(single.dateConflicts.drEnd.map(date=>date.text),['1748-03-27']);
  assert.deepEqual([override.dr[0].text,override.drEnd[0].text],['1748-03-25','1748-03-25']);
  assert.deepEqual(stub.dr[0].alternatives.map(date=>date.text),['1748-03-23','1748-03-24']);
  const {document}=parseHTML(renderCampaignView('sessions',record,{columns:['dr','evidence']},renderLink));
  const row=document.querySelector('tbody tr');
  assert.equal(row.querySelector('.taelgar-session-cell-value').textContent,'Mar 22–23, 1748 DR');
  assert.match(row.nextElementSibling.textContent,/In-world end date: Mar 22, 1748 DR/);
});

test('session history formats dates and note titles and can render only the summary or list',()=>{
  const record=make({notes:[
    session(1,{descTitle:'The Hyenas',realWorldDate:'2020-05-29',DR:'1748-03-22',DR_end:'1748-03-23',players:['Ilex','Chanter']}),
    session(2,{realWorldDate:'2025-10-25',DR:'1749-11-03'}),
  ]});
  const render=source=>parseHTML(renderCampaignView('sessions',record,parseCampaignBlock('sessions',source),renderLink)).document;
  const both=render('');
  assert.equal(both.querySelector('.taelgar-session-summary h3').textContent,'Session summary');
  assert.deepEqual([...both.querySelectorAll('.taelgar-campaign-summary dd')].map(node=>node.textContent),[
    '2','May 29, 2020 – Oct 25, 2025 (5 years, 149 days)','Mar 22, 1748 – Nov 3, 1749 DR (1 year, 226 days)',
  ]);
  assert.deepEqual([...both.querySelectorAll('th')].map(node=>node.textContent),['Session','Session Notes','Played','In-world dates']);
  assert.equal(both.querySelector('tbody a').textContent,'The Hyenas');
  assert.equal(both.querySelector('tbody a').getAttribute('data-target'),'Campaigns/Example/Session 1.md');
  assert.equal(both.querySelector('.taelgar-session-details'),null);
  const withDetails=render('columns: [session, account, played, dr, characters, participants, evidence]');
  const detailRow=withDetails.querySelector('tbody tr').nextElementSibling;
  assert.equal(detailRow.querySelector('td').getAttribute('colspan'),'4');
  assert.equal(detailRow.querySelector('summary').textContent,'Cast and attendance · Sources');
  assert.deepEqual([...detailRow.querySelectorAll('[data-field]')].map(node=>node.getAttribute('data-field')),
    ['people','evidence']);
  assert.match(detailRow.querySelector('[data-field="people"]').textContent,/Pat \(inferred\) · Ilex/);
  const summaryOnly=render('summary: only');
  assert.ok(summaryOnly.querySelector('.taelgar-session-summary'));
  assert.equal(summaryOnly.querySelector('table'),null);
  const listOnly=render('summary: false');
  assert.ok(listOnly.querySelector('table'));
  assert.equal(listOnly.querySelector('.taelgar-session-summary'),null);
});

test('session participation can show the cast, attendees, or their combined roles',()=>{
  const definitions=campaignDefinitions(fence('session',`overrides:
  - number: 1
    attendance:
      - {player: Pat, character: Ilex}
      - {player: Pat, character: Bramble}
      - {player: Alex}
      - {player: Morgan, role: dm}
  - number: 2
    attendance:
      - {player: Pat, character: Ilex}`),campaign);
  const record=make({definitions,notes:[
    session(1,{players:['Ilex','Chanter'],companions:['Dog']}),
  ]});
  const render=columns=>parseHTML(renderCampaignView('sessions',record,
    parseCampaignBlock('sessions','columns: [session, '+columns+']'),renderLink)).document;
  const items=field=>[...field.querySelectorAll('li')].map(node=>node.textContent);
  const cast=render('characters').querySelector('[data-field="characters"]');
  assert.deepEqual(items(cast),['Ilex','Chanter','Dog (companion)']);
  const attendees=render('participants').querySelector('[data-field="participants"]');
  assert.deepEqual(items(attendees),['Morgan (DM)','Pat','Alex']);
  assert.equal(attendees.querySelector('a'),null);
  const people=[...render('people').querySelectorAll('[data-field="people"]')];
  assert.deepEqual(items(people[0]),[
    'Morgan (DM)','Pat · Ilex, Bramble (unlisted in cast)','Alex','Chanter (present only)','Dog (companion)',
  ]);
  assert.deepEqual(items(people[1]),['Pat · Ilex']);
  assert.match(people[1].textContent,/Cast unknown/);
  assert.equal(render('played').querySelector('.taelgar-session-details'),null);
});

test('date formatting preserves partial and approximate precision and uses the correct leap days',()=>{
  const options={includeDuration:true};
  const range=(from,to,calendar)=>formatCampaignDates(campaignDates(from,calendar),calendar,campaignDates(to,calendar),options);
  assert.equal(range('1748-02-28','1748-03-01','dr'),'Feb 28 – Mar 1, 1748 DR (1 day)');
  assert.equal(range('2024-02-28','2024-03-01','real'),'Feb 28 – Mar 1, 2024 (2 days)');
  assert.equal(range('2024-02-29','2025-02-28','real'),'Feb 29, 2024 – Feb 28, 2025 (1 year)');
  assert.equal(range('1748-02','1748-03','dr'),'Feb 1748 DR – Mar 1748 DR');
  const window=campaignDates({from:'2021-09-24',through:'2021-10-07',qualifier:'possible window'},'real');
  assert.equal(formatCampaignDates(window,'real'),'Sep 24 – Oct 7, 2021 · possible window');
  assert.equal(formatCampaignDates(window,'real',[],options),'Sep 24 – Oct 7, 2021 (13 days) · possible window');
});

test('registered bundle artifacts use the manifest stem and ignore raw-only leads',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'taelgar-campaign-bundles-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const prepared=path.join(root,'_sessions/example/long-prefix-003/cleaned');
  const raw=path.join(root,'_sessions/example/long-prefix-004/sources');
  await Promise.all([fs.mkdir(prepared,{recursive:true}),fs.mkdir(raw,{recursive:true})]);
  await Promise.all([
    fs.writeFile(path.join(prepared,'different-session.yaml'),'scope: session\nsourceType: transcript\ndrStart: &date 1748-01-01\ndrEnd: *date\n'),
    fs.writeFile(path.join(prepared,'different-session-recap.md'),'## Session Header\n- Desc Title: Completed\n- PCs: Chanter\n'),
    fs.writeFile(path.join(prepared,'different-speaker-stats.json'),JSON.stringify({speakers:[{name:'Alex',gameRole:'Chanter',segmentCount:1,durationSeconds:35}]})),
    fs.writeFile(path.join(raw,'raw.txt'),'initial transcript'),
  ]);
  const data=await readCampaignSessionBundles(root,registry,campaign);
  assert.equal(data.warnings.length,0);
  const record=make(data);
  assert.equal(record.summary.count,1);
  assert.match(record.sessions[0].account,/different-session-recap\.md$/);
  assert.equal(record.sessions[0].attendance[0].player,'Alex');
});
