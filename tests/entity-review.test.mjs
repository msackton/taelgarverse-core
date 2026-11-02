import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {mountEntityReview,entityQueueEntries} from '../src/browser/entity-review.mjs';
const source={kind:'transcript',sourceId:'polished',startUid:'u0002',endUid:'u0004'};
const fixture=()=>({token:{mapSha256:'map',reviewSha256:null,notes:[]},session:{campaign:'Demo',number:1,stagingFolder:'Worldbuilding/Staging/Demo',drStart:'1740-10-03',drEnd:'1740-10-05',realWorldDate:'2026-05-14',transcriptPath:'transcript.md',sessionNotePath:'Campaigns/Demo.md'},reviewPath:'demo-entities-review.json',
  review:{history:[],feedback:[]},evidence:{e001:[{source,path:'transcript.md',line:7}]},
  exclusionDetails:[],document:{exclusions:[],entities:[{id:'e001',label:'Guide',kind:'npc',importance:'cameo',note:'People/Guide.md',confidenceExplanation:'The name matches, but the source does not distinguish two plausible guides.',occurrences:[{source}],review:{confidence:'medium',status:'unreviewed'}},
    {id:'e002',label:'Patron',kind:'divine',importance:'supporting',identifiedLater:true,confidenceExplanation:'The divine name is used consistently throughout the source.',occurrences:[{source}],review:{confidence:'high',status:'automatedReviewed'}}]}});
const settle=()=>new Promise(resolve=>setTimeout(resolve,10));
const button=(root,label)=>[...root.querySelectorAll('button')].find(node=>node.textContent===label);
const field=(root,label)=>[...root.querySelectorAll('label')].find(node=>node.textContent.startsWith(label)).querySelector('input,select,textarea');
function setup(mode='review',{fail=false,reviewed=false,evidenceRequest,failFeedback=false,failStaging=false,stagingRequest,sourceChanged=false,failConfirmation=false}={}){
  const {document}=parseHTML('<main></main>'),root=document.querySelector('main'),create=document.createElement.bind(document);
  document.createElement=tag=>{
    const node=create(tag);if(tag==='select')Object.defineProperty(node,'value',{value:'',writable:true});
    if(tag==='dialog'){
      Object.defineProperty(node,'open',{get:()=>node.hasAttribute('open')});
      node.showModal=()=>node.setAttribute('open','');
      node.close=()=>{node.removeAttribute('open');node.dispatchEvent(new document.defaultView.Event('close'));};
    }
    return node;
  };
  const data=fixture(),calls=[],opened=[];
  if(reviewed)data.document.entities[0].review.status='humanReviewed';
  const view=mountEntityReview(root,{session:'demo.yaml',mode,open:(...args)=>opened.push(args),request:async request=>{
    calls.push(structuredClone(request));
    if(request.command==='inspect'){
      data.token.notes=request.notes??[];
      if(sourceChanged)return {confirmationRequired:true,token:structuredClone(data.token),session:data.session,
        sourceChanges:[{name:'Polished transcript',previousSha256:'old-source',currentSha256:'current-source'}]};
      return structuredClone(data);
    }
    if(request.command==='confirmSourceChanges'){
      if(failConfirmation)throw new Error('Inputs or review changed since confirmation; reload and confirm again');
      assert.deepEqual(request.token,data.token);sourceChanged=false;return structuredClone(data);
    }
    if(request.command==='entityNoteChoices')return {paths:['People/Correct.md']};
    if(request.command==='evidence')return evidenceRequest?evidenceRequest(request):{passages:[{source,text:'The guide speaks.',path:'transcript.md',line:7}]};
    if(request.command==='entityFeedback'){
      if(failFeedback)throw new Error('Feedback changed; reload before saving.');
      data.review.feedback.push({entity:request.entity,comment:request.comment,status:'open'});return structuredClone(data);
    }
    if(request.command==='createStagingNote'){
      if(stagingRequest)await stagingRequest(request);
      if(failStaging)throw new Error('A note with that name already exists.');
      const row=data.document.entities.find(item=>item.id===request.entity);
      Object.assign(row,request.changes);row.note=data.session.stagingFolder+'/'+request.name+'.md';row.review.status='unreviewed';
      return structuredClone(data);
    }
    if(request.command==='exclusionInclude'){
      assert.deepEqual(request.token,data.token);
      const excluded=data.document.exclusions.splice(request.exclusionIndex,1)[0];
      const restored=excluded.record??{id:'e003',label:excluded.label,kind:request.kind,importance:request.importance,occurrences:excluded.occurrences,review:{confidence:'low',status:'unreviewed'}};
      restored.review.status='unreviewed';data.document.entities.push(restored);
      data.exclusionDetails.splice(request.exclusionIndex,1);return structuredClone(data);
    }
    if(request.command==='entityUpdate'){
      if(fail)throw new Error('Stale review; reload');
      assert.deepEqual(request.token,data.token);
      const row=data.document.entities.find(item=>item.id===request.entity);
      if(request.action==='exclude'){
        for(const [key,value] of Object.entries(request.changes??{})){if(key==='status')row.review.status=value;else row[key]=value;}
        data.document.exclusions.push({label:row.label,reason:request.reason,occurrences:row.occurrences,record:structuredClone(row)});
        data.exclusionDetails.push({restorable:true,restoreNotes:row.note?[row.note]:[]});
        data.document.entities=data.document.entities.filter(item=>item!==row);
      }
      else if(request.action==='remove')data.document.entities=data.document.entities.filter(item=>item!==row);
      else for(const [key,value] of Object.entries(request.changes)){if(key==='status')row.review.status=value;else row[key]=value;}
      data.token.mapSha256+='next';return structuredClone(data);
    }
    throw new Error('Unexpected '+request.command);
  }});
  return {root,view,data,calls,opened};
}
test('all agent-reviewed entities remain pending including high confidence; opening does not save',async()=>{
  const h=setup();await h.view.ready;
  assert.equal(entityQueueEntries(h.data).filter(item=>item.decision==='pending').length,2);
  assert.deepEqual(h.calls.map(item=>item.command),['inspect']);
  assert.equal(h.root.querySelector('.entity-review-confidence').textContent,'Confidence: Medium');
  assert.equal(h.root.querySelector('.entity-confidence-explanation').textContent,h.data.document.entities[0].confidenceExplanation);
  button(h.root,'Skip for now').click();await settle();assert.match(h.root.textContent,/Patron/);assert.equal(h.calls.length,1);
  assert.equal(h.root.querySelector('.entity-review-confidence').textContent,'Confidence: High');
  assert.equal(h.root.querySelector('.entity-confidence-explanation').textContent,h.data.document.entities[1].confidenceExplanation);
  assert.match(h.root.textContent,/Identified later/);h.view.dispose();
});
test('map shows dates, available note links, and lazily loaded source details',async()=>{
  const h=setup('map');await h.view.ready;
  assert.equal(h.root.querySelectorAll('.entity-map-table tbody tr').length,2);
  assert.deepEqual([...h.root.querySelectorAll('.entity-map-table .entity-review-confidence')].map(node=>node.textContent),['Confidence: Medium','Confidence: High']);
  assert.equal(h.root.querySelector('.entity-map-table .entity-confidence-explanation'),null);
  assert.deepEqual([...h.root.querySelectorAll('.entity-map-table th')].map(node=>node.textContent),['Entity','Type','Status','Role','Details','Accept','Exclude']);
  assert.match(h.root.querySelector('h2').textContent,/1740-10-03 – 1740-10-05 DR.*2026-05-14.*List of Entities/);
  const links=[...h.root.querySelectorAll('a')];links.find(a=>a.textContent==='Transcript').click();await settle();
  links.find(a=>a.textContent==='Session note').click();await settle();links.find(a=>a.textContent==='Guide').click();await settle();
  assert.deepEqual(h.opened,[['transcript.md',undefined],['Campaigns/Demo.md',undefined],['People/Guide.md',undefined]]);
  assert.equal(h.calls.some(call=>call.command==='evidence'),false);
  button(h.root,'Details').click();await settle();assert.match(h.root.textContent,/The guide speaks/);
  assert.match(h.root.querySelector('dialog').textContent,/No active feedback/);assert.equal(h.calls.at(-1).entity,'e001');
  assert.equal(h.root.querySelector('dialog .entity-confidence-explanation').textContent,h.data.document.entities[0].confidenceExplanation);
  assert.equal(h.root.querySelectorAll('.entity-map-table tbody tr').length,2);h.view.dispose();
});

test('inline fields save only their own value and accept explicitly approves',async()=>{
  const h=setup('map');await h.view.ready;
  for(const [label,value,key] of [['Type','organization','kind'],['Role','star','importance'],['Status','automatedReviewed','status']]){
    const choice=h.root.querySelector(`select[aria-label="${label} for Guide"]`);choice.value=value;
    choice.dispatchEvent(new h.root.ownerDocument.defaultView.Event('change'));await settle();
    assert.deepEqual(h.calls.at(-1).changes,{[key]:value});
  }
  assert.equal(h.data.document.entities[0].review.status,'automatedReviewed');
  button(h.root,'Accept').click();await settle();assert.equal(h.data.document.entities[0].review.status,'humanReviewed');h.view.dispose();
});

test('excluded entities show passages and can be restored with their saved note',async()=>{
  const h=setup('map');await h.view.ready;button(h.root,'Exclude').click();await settle();
  const originalRow=h.root.querySelector('.entity-map-table tbody tr');
  assert.equal(originalRow.firstElementChild.getAttribute('rowspan'),'2');
  assert.equal(originalRow.querySelector('textarea'),null);
  assert.ok(originalRow.nextElementSibling.classList.contains('entity-map-exclusion-row'));
  assert.equal(originalRow.nextElementSibling.firstElementChild.colSpan,6);
  button(originalRow.nextElementSibling,'Cancel').click();await settle();
  assert.equal(originalRow.firstElementChild.hasAttribute('rowspan'),false);
  assert.equal(h.root.querySelector('.entity-map-exclusion-row'),null);
  button(originalRow,'Exclude').click();await settle();
  field(h.root,'Exclusion reason').value='Only a passing mention.';button(h.root,'Confirm exclude').click();await settle();
  assert.equal(h.data.document.entities.length,1);assert.equal(h.data.document.exclusions[0].reason,'Only a passing mention.');
  const lower=h.root.querySelector('.entity-exclusions-table');button(lower,'Details').click();await settle();
  assert.equal(h.calls.at(-1).exclusionIndex,0);assert.match(h.root.querySelector('dialog').textContent,/The guide speaks/);
  button(h.root.querySelector('dialog'),'Close').click();
  button(lower,'Include').click();await settle();
  assert.equal(h.data.document.entities.length,2);assert.equal(h.data.document.exclusions.length,0);
  assert.equal(h.data.document.entities[1].id,'e001');assert.equal(h.data.document.entities[1].note,'People/Guide.md');
  assert.deepEqual(h.calls.filter(call=>call.command==='inspect').at(-1).notes,['People/Guide.md']);h.view.dispose();
});

test('details popup closes with its button or cancel and source links dismiss it',async()=>{
  const h=setup('map');await h.view.ready;
  const trigger=button(h.root,'Details');trigger.click();await settle();
  assert.equal(h.root.querySelector('dialog').open,true);
  assert.equal(h.root.querySelector('dialog').getAttribute('aria-label'),'Guide — Details');
  button(h.root.querySelector('dialog'),'Close').click();
  assert.equal(h.root.querySelector('dialog'),null);assert.equal(trigger.getAttribute('aria-expanded'),'false');
  trigger.click();await settle();h.root.querySelector('dialog').dispatchEvent(new h.root.ownerDocument.defaultView.Event('cancel',{cancelable:true}));
  assert.equal(h.root.querySelector('dialog'),null);
  trigger.click();await settle();[...h.root.querySelectorAll('dialog a')].find(link=>link.textContent==='Open source passage').click();await settle();
  assert.equal(h.root.querySelector('dialog'),null);assert.deepEqual(h.opened,[['transcript.md',7]]);h.view.dispose();
});

test('late passages cannot redraw a dismissed or replaced popup',async()=>{
  const responses=[];const h=setup('map',{evidenceRequest:()=>new Promise(resolve=>responses.push(resolve))});await h.view.ready;
  const triggers=[...h.root.querySelectorAll('button[aria-haspopup=dialog]')];triggers[0].click();await settle();
  button(h.root.querySelector('dialog'),'Close').click();triggers[1].click();await settle();
  responses[0]({passages:[{text:'Stale passage',path:'old.md',line:1}]});await settle();
  assert.doesNotMatch(h.root.querySelector('dialog').textContent,/Stale passage/);
  responses[1]({passages:[{text:'Current passage',path:'new.md',line:2}]});await settle();
  assert.match(h.root.querySelector('dialog').textContent,/Current passage/);
  h.view.dispose();assert.equal(h.root.querySelector('dialog'),null);assert.equal(h.root.childNodes.length,0);
});

test('passage errors can be retried and feedback failures stay in the popup',async()=>{
  let reads=0;const h=setup('map',{failFeedback:true,evidenceRequest:async()=>{
    if(!reads++)throw new Error('Passage unavailable');
    return {passages:[{text:'Recovered passage',path:'source.md',line:2}]};
  }});await h.view.ready;button(h.root,'Details').click();await settle();
  const dialog=h.root.querySelector('dialog');assert.match(dialog.textContent,/Passage unavailable/);
  button(dialog,'Retry loading passages').click();await settle();assert.match(dialog.textContent,/Recovered passage/);
  field(dialog,'Message for the agent').value='Check identity.';button(dialog,'Save entity feedback').click();await settle();
  assert.match(dialog.textContent,/Feedback changed/);assert.equal(dialog.open,true);
  assert.equal(field(dialog,'Message for the agent').value,'Check identity.');
  assert.equal(h.data.review.feedback.length,0);h.view.dispose();
});

test('original exclusions require explicit type and role before inclusion',async()=>{
  const h=setup('map');await h.view.ready;h.data.document.exclusions.push({label:'Sword',reason:'Incidental',occurrences:[{source}]});
  button(h.root,'Reload list').click();await settle();button(h.root.querySelector('.entity-exclusions-table'),'Include').click();await settle();
  const lower=h.root.querySelector('.entity-exclusions-table');button(lower,'Confirm include').click();await settle();
  assert.equal(h.calls.some(call=>call.command==='exclusionInclude'),false);
  field(lower,'Type').value='item';field(lower,'Role').value='cameo';button(lower,'Confirm include').click();await settle();
  assert.equal(h.data.document.entities.at(-1).kind,'item');assert.equal(h.data.document.entities.at(-1).review.status,'unreviewed');h.view.dispose();
});

test('failed inline saves restore the displayed value and leave the row unapproved',async()=>{
  const h=setup('map',{fail:true});await h.view.ready;
  const choice=h.root.querySelector('select[aria-label="Role for Guide"]');choice.value='star';
  choice.dispatchEvent(new h.root.ownerDocument.defaultView.Event('change'));await settle();
  assert.equal(choice.value,'cameo');assert.match(h.root.textContent,/Stale review/);assert.equal(h.data.document.entities[0].review.status,'unreviewed');h.view.dispose();
});

test('missing transcript, session note, and dates do not create placeholder links',async()=>{
  const h=setup('map');await h.view.ready;h.data.session={campaign:'Demo',number:1};
  button(h.root,'Reload list').click();await settle();
  assert.equal([...h.root.querySelectorAll('a')].some(link=>['Transcript','Session note'].includes(link.textContent)),false);
  assert.equal(h.root.querySelector('h2').textContent,'Demo 1 — List of Entities');h.view.dispose();
});
test('human approval advances to the high-confidence agent-reviewed entity',async()=>{
  const h=setup();await h.view.ready;button(h.root,'Save and next').click();await settle();
  assert.equal(h.data.document.entities[0].review.status,'humanReviewed');assert.equal(h.data.document.entities[1].review.status,'automatedReviewed');
  assert.equal(h.data.document.entities[0].review.confidence,'medium');
  assert.equal(h.root.querySelector('strong').textContent,'Patron');h.view.dispose();
});

test('one save action applies edits, approves, and completes the pending queue',async()=>{
  const h=setup();await h.view.ready;
  assert.equal(h.root.querySelectorAll('.entity-review-actions .mod-cta').length,1);
  assert.equal([...h.root.querySelectorAll('label')].some(label=>label.textContent.startsWith('Review status')),false);
  field(h.root,'Name in this session').value='Updated guide';
  button(h.root,'Save and next').click();await settle();
  assert.equal(h.data.document.entities[0].label,'Updated guide');
  assert.equal(h.data.document.entities[0].review.status,'humanReviewed');
  assert.equal(h.root.querySelector('strong').textContent,'Patron');
  button(h.root,'Save and next').click();await settle();
  assert.equal(h.data.document.entities[1].review.status,'humanReviewed');
  assert.match(h.root.textContent,/No entities remain/);h.view.dispose();
});

test('save advances even with the all-entities filter',async()=>{
  const h=setup();await h.view.ready;
  const picker=field(h.root,'Show');picker.value='all';picker.dispatchEvent(new h.root.ownerDocument.defaultView.Event('change'));
  field(h.root,'Name in this session').value='Reviewed guide';
  button(h.root,'Save and next').click();await settle();
  assert.equal(h.data.document.entities[0].label,'Reviewed guide');
  assert.equal(h.data.document.entities[0].review.status,'humanReviewed');
  assert.equal(h.root.querySelector('strong').textContent,'Patron');h.view.dispose();
});
test('new vault links are inspected before saving',async()=>{
  const h=setup();await h.view.ready;field(h.root,'Linked vault note').value='People/Correct.md';button(h.root,'Save and next').click();await settle();
  assert.deepEqual(h.calls.filter(x=>x.command==='inspect').at(-1).notes,['People/Correct.md']);
  assert.equal(h.data.document.entities[0].note,'People/Correct.md');h.view.dispose();
});

test('reviewed entities can be reopened while saving current edits',async()=>{
  const h=setup('review',{reviewed:true});await h.view.ready;
  const picker=field(h.root,'Show');picker.value='all';picker.dispatchEvent(new h.root.ownerDocument.defaultView.Event('change'));
  field(h.root,'Name in this session').value='Guide to recheck';
  button(h.root,'Reopen review').click();await settle();
  assert.equal(h.data.document.entities[0].label,'Guide to recheck');
  assert.equal(h.data.document.entities[0].review.status,'unreviewed');
  assert.equal(button(h.root,'Reopen review'),undefined);h.view.dispose();
});
test('agent feedback persists without supplying human approval or an export step',async()=>{
  const h=setup();await h.view.ready;field(h.root,'Message for the agent').value='Check the identity.';button(h.root,'Save entity feedback').click();await settle();
  assert.equal(h.data.review.feedback[0].comment,'Check the identity.');assert.equal(h.data.document.entities[0].review.status,'unreviewed');
  assert.equal([...h.root.querySelectorAll('summary')].some(node=>/Follow up with the agent|Change history/.test(node.textContent)),false);
  assert.match(h.root.querySelector('.entity-review-card').textContent,/1 open question for the agent/);
  button(h.root,'Skip for now').click();await settle();
  assert.equal(h.root.querySelector('strong').textContent,'Patron');assert.equal(h.data.document.entities[0].review.status,'unreviewed');
  assert.deepEqual(h.calls.map(call=>call.command),['inspect','entityFeedback']);h.view.dispose();
});

test('resolved questions show the outcome without supplying human approval',async()=>{
  const h=setup();await h.view.ready;
  h.data.review.feedback.push({entity:'e001',comment:'Check the identity.',status:'resolved',resolution:'Confirmed from the source passage.'});
  button(h.root,'Reload entities').click();await settle();
  assert.match(h.root.querySelector('.entity-review-card').textContent,/Resolved: Check the identity.*Confirmed from the source passage/);
  assert.equal(h.data.document.entities[0].review.status,'unreviewed');
  assert.equal([...h.root.querySelectorAll('summary')].some(node=>/Follow up with the agent|Change history/.test(node.textContent)),false);h.view.dispose();
});

test('entity feedback stays in the queue and session feedback stays on the map',async()=>{
  const h=setup();await h.view.ready;
  field(h.root,'Message for the agent').value='Is this the same guide?';
  button(h.root,'Save entity feedback').click();await settle();
  assert.equal(h.calls.at(-1).entity,'e001');
  assert.equal(button(h.root,'Save session feedback'),undefined);
  assert.equal([...h.root.querySelectorAll('summary')].some(node=>node.textContent==='Feedback on this session'),false);
  assert.equal(h.data.review.feedback.length,1);
  assert.equal(h.data.document.entities[0].review.status,'unreviewed');
  field(h.root,'Change note').value='Corrected the name from the source.';
  button(h.root,'Save and next').click();await settle();
  assert.equal(h.calls.at(-1).reason,'Corrected the name from the source.');
  assert.equal(h.data.review.feedback.length,1);h.view.dispose();
  const map=setup('map');await map.view.ready;
  field(map.root,'Message about this session').value='A merchant is missing.';
  button(map.root,'Save session feedback').click();await settle();
  assert.equal(map.calls.at(-1).entity,undefined);assert.equal(map.data.review.feedback.length,1);
  const handoff=[...map.root.querySelectorAll('details')].find(node=>node.querySelector('summary')?.textContent.startsWith('Follow up with the agent'));
  assert.equal(handoff.open,true);assert.match(handoff.textContent,/1 open question/);
  const prompt=field(map.root,'Request to paste');assert.equal(prompt.readOnly,true);assert.match(prompt.value,/resolve feedback with my help.*demo.yaml/);
  assert.ok([...map.root.querySelectorAll('summary')].some(node=>node.textContent==='Change history'));
  assert.equal(map.data.document.entities[0].review.status,'unreviewed');map.view.dispose();
});

test('unlinked entities can create a staging note while saving their edits without approval',async()=>{
  const h=setup();await h.view.ready;assert.equal(button(h.root,'Create staging note'),undefined);
  button(h.root,'Skip for now').click();await settle();
  field(h.root,'Name in this session').value='Named patron';field(h.root,'Role in this session').value='star';
  button(h.root,'Create staging note').click();await settle();
  const dialog=h.root.querySelector('dialog');assert.equal(field(dialog,'Note name').value,'Named patron');
  assert.match(dialog.textContent,/Worldbuilding\/Staging\/Demo\/Named patron.md/);
  button(dialog,'Create empty note').click();await settle();
  assert.equal(h.calls.at(-1).command,'createStagingNote');assert.deepEqual(h.calls.at(-1).changes,{label:'Named patron',kind:'divine',importance:'star'});
  assert.equal(h.data.document.entities[1].note,'Worldbuilding/Staging/Demo/Named patron.md');
  assert.equal(h.data.document.entities[1].review.status,'unreviewed');
  assert.equal(dialog.open,false);assert.equal(dialog.isConnected,false);assert.equal(h.root.querySelector('dialog'),null);
  assert.equal(h.root.querySelector('strong').textContent,'Named patron');assert.equal(button(h.root,'Create staging note'),undefined);h.view.dispose();
});

test('map Details can create and link a staging note for its unlinked entity',async()=>{
  const h=setup('map');await h.view.ready;
  button(h.root,'Details').click();await settle();
  assert.equal(button(h.root.querySelector('dialog'),'Create staging note'),undefined);
  [...h.root.querySelectorAll('button')].find(node=>node.getAttribute('aria-label')==='Details for Patron').click();await settle();
  const details=h.root.querySelector('dialog');button(details,'Create staging note').click();await settle();
  const dialog=h.root.querySelector('dialog');assert.notEqual(dialog,details);
  assert.equal(details.open,false);assert.equal(details.isConnected,false);
  assert.equal(field(dialog,'Note name').value,'Patron');
  button(dialog,'Create empty note').click();await settle();
  assert.equal(h.calls.at(-1).command,'createStagingNote');assert.equal(h.calls.at(-1).entity,'e002');
  assert.deepEqual(h.calls.at(-1).changes,{label:'Patron',kind:'divine',importance:'supporting'});
  assert.equal(h.root.querySelector('dialog'),null);
  const row=h.root.querySelectorAll('tbody tr')[1];
  assert.match(row.textContent,/Vault note: Patron/);
  assert.equal(h.data.document.entities[1].note,'Worldbuilding/Staging/Demo/Patron.md');
  assert.equal(h.data.document.entities[1].review.status,'unreviewed');
  assert.match(h.root.textContent,/before choosing Accept/);
  [...row.querySelectorAll('button')].find(node=>node.textContent==='Details').click();await settle();
  assert.equal(button(h.root.querySelector('dialog'),'Create staging note'),undefined);h.view.dispose();
});

test('unnamed entities require a chosen staging name and collisions leave the form visible',async()=>{
  const h=setup('review',{failStaging:true});await h.view.ready;
  h.data.document.entities[0].label='Unnamed guide';delete h.data.document.entities[0].note;
  button(h.root,'Reload entities').click();await settle();button(h.root,'Create staging note').click();await settle();
  const dialog=h.root.querySelector('dialog');assert.equal(field(dialog,'Note name').value,'');
  button(dialog,'Create empty note').click();await settle();
  assert.equal(h.calls.some(call=>call.command==='createStagingNote'),false);assert.match(dialog.textContent,/Enter a name/);
  field(dialog,'Note name').value='Gatekeeper';button(dialog,'Create empty note').click();await settle();
  assert.match(dialog.textContent,/already exists/);assert.equal(field(dialog,'Note name').value,'Gatekeeper');
  assert.equal(button(dialog,'Create empty note').disabled,false);
  assert.equal(h.root.querySelector('dialog'),dialog);assert.equal(h.data.document.entities[0].note,undefined);h.view.dispose();
});

test('staging dialog shows pending progress and closes when a delayed save completes',async()=>{
  let complete;
  const h=setup('review',{stagingRequest:()=>new Promise(resolve=>{complete=resolve;})});await h.view.ready;
  button(h.root,'Skip for now').click();await settle();button(h.root,'Create staging note').click();await settle();
  const dialog=h.root.querySelector('dialog');button(dialog,'Create empty note').click();await settle();
  assert.equal(dialog.open,true);assert.match(dialog.textContent,/Creating and linking note/);
  assert.equal(button(dialog,'Create empty note').disabled,true);
  assert.equal(h.data.document.entities[1].note,undefined);
  complete();await settle();
  assert.equal(dialog.open,false);assert.equal(dialog.isConnected,false);
  assert.equal(field(h.root,'Linked vault note').value,'Worldbuilding/Staging/Demo/Patron.md');h.view.dispose();
});
test('exclude and next requires a reason, saves edits, and preserves a restorable record',async()=>{
  const h=setup();await h.view.ready;
  const originalExplanation=h.data.document.entities[0].confidenceExplanation;
  field(h.root,'Name in this session').value='Corrected guide';field(h.root,'Linked vault note').value='People/Correct.md';
  button(h.root,'Exclude and next').click();await settle();button(h.root,'Confirm exclude').click();await settle();
  assert.equal(h.calls.some(call=>call.command==='entityUpdate'),false);assert.match(h.root.textContent,/Enter an exclusion reason/);
  field(h.root,'Exclusion reason').value='Only a passing mention.';button(h.root,'Confirm exclude').click();await settle();
  assert.deepEqual(h.data.document.entities.map(r=>r.id),['e002']);
  const excluded=h.data.document.exclusions[0];assert.equal(excluded.label,'Corrected guide');assert.equal(excluded.reason,'Only a passing mention.');
  assert.equal(excluded.record.note,'People/Correct.md');assert.equal(excluded.record.review.status,'unreviewed');
  assert.equal(excluded.record.confidenceExplanation,originalExplanation);
  assert.equal(h.root.querySelector('strong').textContent,'Patron');h.view.dispose();
});

test('failed approval or exclusion keeps the current entity and reason available',async()=>{
  const stale=setup('review',{fail:true});await stale.view.ready;button(stale.root,'Save and next').click();await settle();
  assert.match(stale.root.textContent,/Stale review/);assert.equal(stale.root.querySelector('strong').textContent,'Guide');
  button(stale.root,'Exclude and next').click();await settle();field(stale.root,'Exclusion reason').value='Needs exclusion.';
  button(stale.root,'Confirm exclude').click();await settle();
  assert.equal(stale.data.document.exclusions.length,0);assert.equal(stale.root.querySelector('strong').textContent,'Guide');
  assert.equal(field(stale.root,'Exclusion reason').value,'Needs exclusion.');stale.view.dispose();
});

test('legacy low confidence remains readable without manufacturing an explanation',async()=>{
  const h=setup();await h.view.ready;delete h.data.document.entities[0].confidenceExplanation;h.data.document.entities[0].review.confidence='low';
  button(h.root,'Reload entities').click();await settle();
  assert.match(h.root.querySelector('.entity-confidence-explanation').textContent,/No confidence explanation was recorded/);
  assert.equal(h.data.document.entities[0].confidenceExplanation,undefined);assert.deepEqual(h.calls.map(call=>call.command),['inspect','inspect']);h.view.dispose();
});
test('evidence is lazy and late helper responses cannot redraw a disposed view',async()=>{
  const h=setup();await h.view.ready;assert.equal(h.calls.some(r=>r.command==='evidence'),false);
  const details=h.root.querySelector('details');details.open=true;details.dispatchEvent(new h.root.ownerDocument.defaultView.Event('toggle'));await settle();
  assert.match(h.root.textContent,/The guide speaks/);h.view.dispose();assert.equal(h.root.childNodes.length,0);
});

test('changed transcript pauses review until an explicit confirmation, then restores the map',async()=>{
  const h=setup('map',{sourceChanged:true,reviewed:true});await h.view.ready;
  assert.match(h.root.textContent,/Transcript or session inputs changed/);
  assert.match(h.root.textContent,/old-source/);assert.match(h.root.textContent,/current-source/);
  assert.equal(h.root.querySelector('table'),null);
  assert.deepEqual(h.calls.map(call=>call.command),['inspect']);
  button(h.root,'Continue with current transcript').click();await settle();
  assert.deepEqual(h.calls.map(call=>call.command),['inspect','confirmSourceChanges']);
  assert.ok(h.root.querySelector('table'));assert.equal(button(h.root,'Continue with current transcript'),undefined);
  assert.equal(h.data.document.entities[0].review.status,'humanReviewed');h.view.dispose();
});

test('a stale source confirmation leaves review paused and allows a fresh inspection',async()=>{
  const h=setup('review',{sourceChanged:true,failConfirmation:true});await h.view.ready;
  button(h.root,'Continue with current transcript').click();await settle();
  assert.match(h.root.textContent,/reload and confirm again/);assert.equal(button(h.root,'Save and next'),undefined);
  button(h.root,'Reload entities').click();await settle();
  assert.equal(h.calls.at(-1).command,'inspect');assert.ok(button(h.root,'Continue with current transcript'));
  assert.equal(h.data.document.entities[0].review.status,'unreviewed');h.view.dispose();
});

test('acceptance preserves unresolved candidates when the vault link is unchanged',async()=>{
  const h=setup();delete h.data.document.entities[0].note;h.data.document.entities[0].candidates=['People/Maybe.md'];
  await h.view.ready;button(h.root,'Save and next').click();await settle();
  assert.equal('note' in h.calls.find(r=>r.command==='entityUpdate').changes,false);
  assert.deepEqual(h.data.document.entities[0].candidates,['People/Maybe.md']);h.view.dispose();
});
