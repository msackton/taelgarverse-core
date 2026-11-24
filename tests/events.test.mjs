import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseNote} from '../src/content-store.mjs';
import {createEventIndex,parseEvents,queryEvents} from '../src/events.mjs';
import {collectEventSources,extractEventSource} from '../src/event-sources.mjs';
import {compileEvents} from '../scripts/compile-events.mjs';
import {headerFixture} from './helpers/header-fixture.mjs';

const note=(id,source)=>({id,note:parseNote(source)});
const registry={campaigns:{frontier:{code:'dufr',name:'Dunmari Frontier',aliases:['Frontier']},adder:{code:'adma',name:'Addermarch'}}};
const subject=note('People/Visitor.md','---\ntags: [person]\nknownTo: [dufr]\nborn: 1740\nwhereabouts: [{type: home, location: Haven, start: 1741}]\n---\n- (DR:: 1742), fall: Visited the *old house*.');
const war=note('Elsewhere/War.md','---\ntags: [event]\nDR: 1740-10\nDR_end: 1742-06-15\nsummary: The conflict ends.\n---\n- (DR:: 1740): The war starts.');
const session=note('Records/Recap.md','---\ntags: [session-note]\ncampaign: Dunmari Frontier\nDR: 1741-02-03\n---\n- (DR:: 1741-02-03), evening: Group arrives.');
const other=note('People/Stranger.md','---\ntags: [person]\nknownTo: []\n---\n- (DR:: 1741): The stranger arrives.');
const self=note('Timeline.md','---\nDR: 1740\n---\nSelf.');
const draft=note('Records/_generated/Draft.md','---\ntags: [event]\nDR: 1740\n---\nDraft.');
const entries=[subject,war,session,other,self,draft];
const {runtime}=headerFixture({baseNotes:Object.fromEntries(entries.map(({id,note})=>[id,note.metadata])),campaignRegistry:registry});
const index=createEventIndex(collectEventSources(entries));
const run=(options='',extra={})=>queryEvents(index,runtime,parseEvents('yearStart: 1740\nyearEnd: 1742\n'+options),
  {sourcePath:self.id,date:'1742-12-31',...extra});

test('event source selectors combine fields, allow alternatives and take exclusions before row generation',()=>{
  const selected=run('sources:\n  - {type: event}\n  - {type: person, knownTo: Frontier}\n  - {folder: People, note: Visitor}\nincludeLifecycle: true\nincludeTravel: true');
  assert.deepEqual(new Set(selected.map(row=>row.path)),new Set([war.id,subject.id]));
  assert.deepEqual(selected.filter(row=>row.path===subject.id).map(row=>row.kind),['start','travel','inline']);
  assert.match(selected.find(row=>row.kind==='travel').text,/moved to Haven/);
  assert.equal(run('sources: [{type: event, knownTo: dufr}]').length,0);
  assert.equal(run('sources: [{type: session-note, campaign: dufr}]').length,2);
  assert.deepEqual(new Set(run('excludeSources: [{type: person}]').map(row=>row.path)),new Set([war.id,session.id]));
  assert.throws(()=>run('sources: [{knownTo: bogus}]'),/Unknown campaign/);
  assert.throws(()=>parseEvents('yearStart: 1740\nincludeTravel: yes'),/must be true or false/);
});

test('dated bullets keep uncertainty, ranges, qualifiers, and eligibility without interpreting hidden prose or code',()=>{
  const source=note('History/Chronicle.md',`---
tags: [background]
---
- ((DR:: 1740)), fall: Some *history*.
  - (DR:: 1740-06-15) to ((DR_end:: 1740-07)): [[Another|another event]].
- Narrative with \`(DR:: 1740)\` code.
- A normal row (DR:: 1740). %% local comment %%
- (DR:: 1740 to 1741): An explicit range.

%%^Campaign:dufr%%
- [DR:: 1740-12-31] Campaign row.
%%^End%%
%%^Date:1741b%%
- (DR:: 1740) Before row.
%%^End%%
%%^Campaign:none%%
- (DR:: 1740) Private row.
%%^End%%
%%^Lint%%
- (DR:: 1740) Editorial row.
%%^End%%
%%
- (DR:: 1740) Ordinary comment row.
%%
<!--
- (DR:: 1740) HTML comment row.
-->
\`\`\`md
- (DR:: 1740) Example.
\`\`\`
`);
  const record=extractEventSource(source.id,source.note);
  assert.deepEqual(record.warnings,[]);
  assert.equal(record.rows.length,7);
  assert.equal(record.rows.find(row=>row.text==='Some *history*.').label,'(DR 1740), fall');
  const nested=record.rows.find(row=>row.text.includes('another event'));
  assert.equal(nested.label,'June 15th, 1740 - (July 1740)');
  assert.equal(nested.end,17400731);
  assert.equal(nested.line,5);
  assert.ok(record.rows.some(row=>row.text==='A normal row.'));
  const history=headerFixture({baseNotes:{[source.id]:source.note.metadata},campaignRegistry:registry}).runtime;
  const data=createEventIndex(collectEventSources([source])),options=parseEvents('yearStart: 1740\nyearEnd: 1741');
  const view=(date,campaigns=[],dm=false)=>queryEvents(data,history,options,{date,context:{date,campaigns,dm}}).map(row=>row.text);
  assert.deepEqual(view('1740-06-30'),[]);
  assert.match(view('1740-12-31').join(),/Before row/);
  assert.doesNotMatch(view('1740-12-31').join(),/Campaign row|Private row|explicit range/);
  assert.match(view('1741-12-31',['dufr'],true).join(),/Campaign row.*Private row|Private row.*Campaign row/);
  assert.match(view('1741-12-31').join(),/An explicit range/);
  assert.doesNotMatch(view('1741-12-31').join(),/Before row/);
});

test('publication caches extracted notes and invalidates changes or removed paths',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'taelgar-events-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const cache=path.join(dir,'notes.json');
  const first=compileEvents({entries:[subject,war]},cache);
  assert.deepEqual(compileEvents({entries:[subject,war]},cache),first);
  const changed={...subject,note:{...subject.note,body:'- (DR:: 1743): Updated.'}};
  const next=compileEvents({entries:[changed]},cache);
  assert.deepEqual(next.notes.map(([id])=>id),[subject.id]);
  assert.equal(next.notes[0][1].find(row=>row.kind==='inline').text,'Updated.');
  assert.deepEqual(JSON.parse(fs.readFileSync(cache,'utf8')).notes.map(([id])=>id),[subject.id]);
});
