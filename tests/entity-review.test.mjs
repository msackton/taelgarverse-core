import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {mountEntityReview,entityQueueEntries} from '../src/browser/entity-review.mjs';

const source={kind:'transcript',sourceId:'transcriptProcessing.artifacts.polishedMarkdown',startUid:'u0002',endUid:'u0004'};
const fixture=()=>({token:{mapSha256:'map',inputDigest:'inputs',notes:[]},session:{campaign:'Demo',number:1},notes:{},
  reviewState:{history:[],excluded:[],deferred:[],invalidated:[],accepted:{},redirects:{},requests:{}},
  document:{entities:[{id:'e001',label:'Gresh',kind:'npc',reason:'Uncertain name.',candidates:['People/Grash.md'],occurrences:[{source}],review:{confidence:'medium',status:'unreviewed'}},
    {id:'e002',label:'Patron',kind:'divine',identifiedLater:true,reason:'Identity established later.',note:'Gods/Spirit.md',occurrences:[{source}],review:{confidence:'high',status:'automatedReviewed'}}]},
  exclusionRecords:[{key:'exclusion:coins',label:'Coins',reason:'Routine treasure.',source}]});
const settle=()=>new Promise(resolve=>setTimeout(resolve,8));
const button=(root,label)=>[...root.querySelectorAll('button')].find(node=>node.textContent===label);
const field=(root,label)=>[...root.querySelectorAll('label')].find(node=>node.textContent.startsWith(label)).querySelector('input,select,textarea');
function setup({fail=false}={}){
  const {document}=parseHTML('<main></main>'),root=document.querySelector('main'),create=document.createElement.bind(document);
  document.createElement=tag=>{const node=create(tag);if(tag==='select')Object.defineProperty(node,'value',{value:'',writable:true});return node;};
  const data=fixture(),calls=[],opened=[];
  const view=mountEntityReview(root,{session:'demo.yaml',open:(...args)=>opened.push(args),request:async request=>{
    calls.push(structuredClone(request));
    if(request.command==='inspect'){data.token.notes=request.notes??[];return structuredClone(data);}
    if(request.command==='entityNoteChoices')return {paths:['People/Grash.md','People/Correct.md']};
    if(request.command==='evidence')return {passages:[{source,text:'Gresh speaks.',path:'demo-transcript.md',line:7}]};
    if(request.command==='exportEntityFeedback')return {count:Object.keys(data.reviewState.requests).length,path:'demo-entity-feedback.json'};
    if(request.command==='transcriptInspect')return {uids:['u0001','u0002','u0003','u0004'],token:{reportSha256:'transcript'}};
    if(request.command==='transcriptPassage')return {speaker:'DM',text:'Gresh speaks.',original:'Gresh speaks.'};
    if(request.command==='entityTranscriptionFlag')return {token:{reportSha256:'updated'}};
    if(request.command==='entityQueueDecision'){
      if(fail)throw new Error('Stale review: reload the queue');
      assert.deepEqual(request.token,data.token);
      const row=data.document.entities.find(item=>'entity:'+item.id===request.key);
      if(request.action==='needsChanges')data.reviewState.requests[request.key]={comment:request.comment};
      else if(row){row.review.status='humanReviewed';if('note' in request)row.note=request.note;delete data.reviewState.requests[request.key];data.reviewState.history.push({entity:row.id,action:request.action});}
      else if(request.action==='keepExcluded')data.exclusionRecords[0].decision='excluded';
      else if(request.action==='include'){data.document.entities.push({id:'e003',label:'Coins',kind:request.kind,occurrences:[{source}],review:{confidence:'medium',status:'humanReviewed'}});data.exclusionRecords=[];}
      data.token.mapSha256+='next';return structuredClone(data);
    }
    throw new Error('Unexpected '+request.command);
  }});
  const details=async label=>{const node=[...root.querySelectorAll('summary')].find(node=>node.textContent===label).parentElement;node.open=true;node.dispatchEvent(new document.defaultView.Event('toggle'));await settle();return node;};
  const show=async value=>{const picker=field(root,'Show');picker.value=value;picker.dispatchEvent(new document.defaultView.Event('change'));await settle();};
  return {root,view,data,calls,opened,details,show};
}

test('high AI confidence defaults to accepted without forging human review or writing on open',async()=>{
  const h=setup();await h.view.ready;
  const entries=entityQueueEntries(h.data);assert.equal(entries.find(item=>item.key==='entity:e002').decision,'accepted');
  assert.equal(entries.find(item=>item.key==='entity:e001').decision,'pending');assert.equal(entries.find(item=>item.type==='exclusion').decision,'pending');
  assert.equal(h.data.document.entities[1].review.status,'automatedReviewed');assert.deepEqual(h.calls.map(item=>item.command),['inspect']);
  assert.match(h.root.textContent,/1 accepted by AI confidence/);assert.match(h.root.querySelector('h3').textContent,/Gresh/);
  await h.show('all');button(h.root,'Skip for now').click();await settle();button(h.root,'Skip for now').click();await settle();assert.equal(h.root.querySelector('h3').textContent,'Patron');
  assert.match(h.root.textContent,/Accepted by AI default/);assert.match(h.root.textContent,/Identified later/);h.view.dispose();
});

test('an invalidated or deferred high-confidence entity has no default acceptance',()=>{
  const data=fixture();data.reviewState.invalidated=['e002'];assert.equal(entityQueueEntries(data).find(item=>item.key==='entity:e002').decision,'pending');
  data.reviewState.invalidated=[];data.reviewState.deferred=['e002'];assert.equal(entityQueueEntries(data).find(item=>item.key==='entity:e002').decision,'pending');
});

test('direct acceptance saves only the selected entity and advances without a comment or preview',async()=>{
  const h=setup();await h.view.ready;button(h.root,'Accept and next').click();await settle();
  const calls=h.calls.filter(item=>item.command==='entityQueueDecision');assert.equal(calls.length,1);assert.equal(calls[0].key,'entity:e001');assert.equal(calls[0].action,'accept');
  assert.equal(h.data.document.entities[0].review.status,'humanReviewed');assert.equal(h.data.document.entities[1].review.status,'automatedReviewed');assert.equal(h.root.querySelector('h3').textContent,'Coins');h.view.dispose();
});

test('a corrected vault link is inspected and immediately saved with acceptance',async()=>{
  const h=setup();await h.view.ready;field(h.root,'Vault link').value='People/Correct.md';button(h.root,'Accept and next').click();await settle();
  const inspected=h.calls.filter(item=>item.command==='inspect');assert.deepEqual(inspected.at(-1).notes,['People/Correct.md']);
  assert.equal(h.calls.find(item=>item.command==='entityQueueDecision').note,'People/Correct.md');assert.equal(h.data.document.entities[0].note,'People/Correct.md');h.view.dispose();
});

test('changes needed are saved and exported separately from direct decisions',async()=>{
  const h=setup();await h.view.ready;field(h.root,'What should').value='Two different people have been merged.';
  button(h.root,'Save change request and next').click();await settle();assert.equal(h.data.reviewState.requests['entity:e001'].comment,'Two different people have been merged.');
  button(h.root,'Export changes needed').click();await settle();assert.match(h.root.textContent,/Exported 1 change requests to demo-entity-feedback.json/);h.view.dispose();
});

test('excluded candidates can be included using a kind without asking for an entity ID',async()=>{
  const h=setup();await h.view.ready;button(h.root,'Skip for now').click();await settle();assert.equal(h.root.querySelector('h3').textContent,'Coins');
  field(h.root,'Include as').value='item';button(h.root,'Include and next').click();await settle();
  const decision=h.calls.find(item=>item.command==='entityQueueDecision');assert.equal(decision.key,'exclusion:coins');assert.equal(decision.kind,'item');assert.equal('newEntity' in decision,false);h.view.dispose();
});

test('evidence is lazy and transcription flags use the existing guarded transcript review token',async()=>{
  const h=setup();await h.view.ready;assert.equal(h.calls.some(item=>item.command==='evidence'),false);
  await h.details('Transcript evidence');assert.match(h.root.textContent,/Gresh speaks/);
  await h.details('Name transcribed incorrectly');field(h.root,'Exact words').value='Gresh';field(h.root,'Suggested spelling').value='Grash';field(h.root,'Explanation').value='This is the same named guide.';
  button(h.root,'Queue transcription review').click();await settle();
  const flag=h.calls.find(item=>item.command==='entityTranscriptionFlag');assert.equal(flag.key,'entity:e001');assert.equal(flag.uid,'u0002');assert.equal(flag.suggestion,'Grash');assert.deepEqual(flag.transcriptToken,{reportSha256:'transcript'});
  assert.equal(h.calls.some(item=>item.command==='entityQueueDecision'),false);assert.match(h.root.textContent,/Transcription issue queued/);h.view.dispose();
});

test('a stale decision remains visible and does not advance or record success',async()=>{
  const h=setup({fail:true});await h.view.ready;button(h.root,'Accept and next').click();await settle();
  assert.match(h.root.textContent,/Stale review/);assert.equal(h.root.querySelector('h3').textContent,'Gresh');h.view.dispose();
});
