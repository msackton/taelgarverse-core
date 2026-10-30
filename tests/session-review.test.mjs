import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {mountSessionReview} from '../src/browser/session-review.mjs';

const ref={kind:'transcript',sourceId:'transcriptProcessing.artifacts.polishedMarkdown',startUid:'u0002',endUid:'u0004'};
const fixture=()=>({token:{mapSha256:'map',inputDigest:'inputs',notes:[]},session:{campaign:'Demo',number:1},
  reviewState:{history:[],excluded:[],deferred:[],invalidated:[],accepted:{},redirects:{}},notes:{},
  document:{entities:[{id:'e001',kind:'npc',label:'Uncertain guide',reason:'Candidate unresolved.',candidates:['People/Guide.md'],occurrences:[{source:ref}],review:{confidence:'medium',status:'unreviewed'}},
    {id:'e002',kind:'divine',label:'Named spirit',reason:'No individual page.',occurrences:[{source:ref}],review:{confidence:'high',status:'automatedReviewed'}}],
    exclusions:[{label:'Ordinary coins',reason:'Routine treasure.',source:ref}]},exclusionRecords:[{key:'exclusion:coins',label:'Ordinary coins',reason:'Routine treasure.',source:ref}]} );
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
    if(request.command==='entityQueueDecision'){
      assert.deepEqual(request.token,data.token);
      const row=data.document.entities.find(x=>'entity:'+x.id===request.key);row.review.status='humanReviewed';data.reviewState.history.push({entity:row.id,action:request.action});
      data.token.mapSha256+='next';return structuredClone(data);
    }
    throw new Error('Unexpected request');
  }});
  return {root,view,calls,opened};
}
test('session selection opens a compact queue and hides the session inventory',async()=>{
  const {root,view}=setup();await view.ready;
  button(root,'Demo 1').click();await settle();
  assert.match(root.textContent,/Uncertain guide/);assert.match(root.textContent,/1 accepted by AI confidence/);
  assert.ok([...root.querySelectorAll('div')].some(node=>node.hidden&&node.querySelector('table')));
  assert.doesNotMatch(root.textContent,/The guide speaks/);
  button(root,'Skip for now').click();await settle();assert.match(root.textContent,/Ordinary coins/);
  button(root,'Back to sessions').click();await settle();assert.ok(button(root,'Demo 1'));
  view.dispose();assert.equal(root.childNodes.length,0);
});
test('selected evidence opens original UID-resolved source and accepts only the selected entity',async()=>{
  const {root,view,calls,opened}=setup();await view.ready;
  button(root,'Demo 1').click();await settle();
  const evidence=[...root.querySelectorAll('summary')].find(node=>node.textContent==='Transcript evidence').parentElement;
  evidence.open=true;evidence.dispatchEvent(new root.ownerDocument.defaultView.Event('toggle'));await settle();
  assert.match(root.textContent,/The guide speaks/);
  button(root,'Open transcript passage').click();await settle();assert.deepEqual(opened,[['_sessions/demo/cleaned/demo-transcript.md',9]]);
  button(root,'Accept and next').click();await settle();
  const applied=calls.filter(x=>x.command==='entityQueueDecision');assert.equal(applied.length,1);assert.equal(applied[0].key,'entity:e001');
  assert.equal(view.getState().entity,'exclusion:coins');view.dispose();
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
  assert.ok(button(root,'Accept and next'));
  const count=calls.length;
  await view.restore({session:'_sessions/other/cleaned/other-session.yaml',stage:'entities'});
  assert.equal(calls.length,count);assert.equal(button(root,'Accept and next'),undefined);
  assert.doesNotMatch(root.textContent,/Uncertain guide/);assert.match(root.textContent,/Saved selection restored/);view.dispose();
});
