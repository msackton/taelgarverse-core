import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {mountSessionReview} from '../src/browser/session-review.mjs';

const ref={kind:'transcript',sourceId:'transcriptProcessing.artifacts.polishedMarkdown',startUid:'u0002',endUid:'u0004'};
const fixture=()=>({token:{mapSha256:'map',inputDigest:'inputs',notes:[]},session:{campaign:'Demo',number:1},
  reviewState:{history:[],excluded:[],deferred:[],invalidated:[],accepted:{},redirects:{}},notes:{},
  document:{entities:[{id:'e001',kind:'npc',label:'Uncertain guide',reason:'Candidate unresolved.',candidates:['People/Guide.md'],occurrences:[{source:ref}],review:{confidence:'medium',status:'unreviewed'}},
    {id:'e002',kind:'divine',label:'Named spirit',reason:'No individual page.',occurrences:[{source:ref}],review:{confidence:'high',status:'automatedReviewed'}}],
    exclusions:[{label:'Ordinary coins',reason:'Routine treasure.',source:ref}]}});
const settle=()=>new Promise(resolve=>setTimeout(resolve,5));
function button(root,name){return [...root.querySelectorAll('button')].find(el=>el.textContent===name);}
function setup(){
  const {document}=parseHTML('<html><body><main></main></body></html>');const root=document.querySelector('main');
  // linkedom does not implement a writable select.value like Chromium does.
  const create=document.createElement.bind(document);
  document.createElement=tag=>{const el=create(tag);if(tag==='select')Object.defineProperty(el,'value',{value:'',writable:true});return el;};
  let data=fixture();const calls=[],opened=[];
  const view=mountSessionReview(root,{open:async(...args)=>opened.push(args),request:async request=>{
    calls.push(request);
    if(request.command==='index')return {sessions:[{sessionYaml:'_sessions/demo/cleaned/demo-session.yaml',campaign:'Demo',number:1,stage:'reviewable',entities:2,pending:1,human:0}]};
    if(request.command==='inspect')return structuredClone(data);
    if(request.command==='evidence')return {passages:[{source:ref,owner:'Scene 1',text:'DM: The guide speaks.',path:'_sessions/demo/cleaned/demo-transcript.md',line:9}]};
    if(request.command==='apply'){
      assert.deepEqual(request.token,data.token);
      const row=data.document.entities.find(x=>x.id===request.entity);row.review.status='humanReviewed';data.reviewState.history.push({entity:row.id,action:request.action,reason:request.reason});
      data.token.mapSha256+='next';return structuredClone(data);
    }
    throw new Error('Unexpected request');
  }});
  return {root,view,calls,opened};
}
test('session index opens an entity-first inventory; divine filter and excluded candidates stay visible',async()=>{
  const {root,view}=setup();await view.ready;
  button(root,'Demo 1').click();await settle();
  assert.match(root.textContent,/Uncertain guide/);assert.match(root.textContent,/Named spirit/);
  assert.match(root.textContent,/Excluded candidates \(1\)/);
  assert.doesNotMatch(root.textContent,/The guide speaks/);
  button(root,'divine').click();await settle();
  assert.match(root.textContent,/Named spirit/);assert.doesNotMatch(root.textContent,/Uncertain guide/);
  view.dispose();assert.equal(root.childNodes.length,0);
});
test('selected evidence opens original UID-resolved source and accepts only the selected entity',async()=>{
  const {root,view,calls,opened}=setup();await view.ready;
  button(root,'Demo 1').click();await settle();button(root,'Uncertain guide').click();await settle();
  assert.match(root.textContent,/The guide speaks/);
  button(root,'Open original source').click();await settle();assert.deepEqual(opened,[['_sessions/demo/cleaned/demo-transcript.md',9]]);
  const labels=[...root.querySelectorAll('label')];labels.find(x=>x.textContent.startsWith('Decision explanation')).querySelector('input').value='I reviewed this identity.';
  button(root,'Accept').click();await settle();
  const applied=calls.filter(x=>x.command==='apply');assert.equal(applied.length,1);assert.equal(applied[0].entity,'e001');
  assert.equal(applied[0].reason,'I reviewed this identity.');assert.match(root.textContent,/humanReviewed/);
  assert.equal(view.getState().entity,'e001');view.dispose();
});
test('late index response cannot redraw an unloaded review view',async()=>{
  const {document}=parseHTML('<main></main>');const root=document.querySelector('main');let resolve;
  const view=mountSessionReview(root,{request:()=>new Promise(r=>resolve=r),open:()=>{}});
  view.dispose();resolve({sessions:[]});await view.ready;assert.equal(root.childNodes.length,0);
});

test('restored session state waits for an explicit user action before loading its review',async()=>{
  const {document}=parseHTML('<main></main>');const root=document.querySelector('main');const calls=[];
  const view=mountSessionReview(root,{initialState:{session:'demo-session.yaml',entity:'e001'},open:()=>{},request:async request=>{
    calls.push(request.command);if(request.command==='index')return {sessions:[]};throw new Error('Unexpected helper request');
  }});
  await view.ready;await view.restore({session:'demo-session.yaml',entity:'e001'});
  assert.deepEqual(calls,['index']);assert.equal(view.getState().session,'demo-session.yaml');view.dispose();
});

test('changing restored session state clears old decision controls before resuming',async()=>{
  const {root,view,calls}=setup();await view.ready;button(root,'Demo 1').click();await settle();
  button(root,'Uncertain guide').click();await settle();assert.ok(button(root,'Accept'));
  const count=calls.length;
  await view.restore({session:'_sessions/other/cleaned/other-session.yaml',stage:'entities'});
  assert.equal(calls.length,count);assert.equal(button(root,'Accept'),undefined);
  assert.doesNotMatch(root.textContent,/Uncertain guide/);assert.match(root.textContent,/Saved selection restored/);view.dispose();
});
