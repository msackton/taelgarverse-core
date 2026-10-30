import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {mountTranscriptReview} from '../src/browser/transcript-review.mjs';
const settle=()=>new Promise(resolve=>setTimeout(resolve,5));
const button=(root,text)=>[...root.querySelectorAll('button')].find(el=>el.textContent===text);
function setup({finalized=false,resolved=false,fail=false}={}){
  const {document}=parseHTML('<main></main>');const root=document.querySelector('main');
  const create=document.createElement.bind(document);document.createElement=tag=>{const el=create(tag);if(tag==='select')Object.defineProperty(el,'value',{value:'',writable:true});return el;};
  const issue={id:'word',uid:'u0001',original:'It got denser.',target:{start:7,end:13,before:'denser'},proposal:'It got darker.',alternatives:[],recommendation:'Recover the adjective.',question:'Which word?',resolution:'pending',turns:[{index:0,before:'It got denser.',speaker:'DM'}],context:[{uid:'u0001',speaker:'DM',text:'It got denser.'}]};
  let data={token:{reportSha256:'inspected',references:{cleaned:'hash'}},mode:finalized?'finalized':'review',issues:finalized||resolved?[]:[issue],paths:{polishedMarkdown:'cleaned/demo-transcript.md',prepared:'cleaned/demo-prepared.md'},uids:['u0001']};
  const calls=[],opened=[];
  const view=mountTranscriptReview(root,{session:'cleaned/demo-session.yaml',open:async path=>opened.push(path),request:async request=>{
    calls.push(request);
    if(request.command==='transcriptInspect')return structuredClone(data);
    if(request.command==='transcriptPreview')return {changes:[{path:'cleaned/demo-transcript.md',diff:'-It got denser.\n+It got darker.'}]};
    if(request.command==='transcriptApply'){
      if(fail)throw new Error('Stale transcript review; reload before applying');
      assert.deepEqual(request.token,data.token);data={...data,issues:[],downstreamNotice:'Recheck scene/entity maps.'};return structuredClone(data);
    }
    if(request.command==='transcriptPassage')return {uid:'u0001',text:issue.original,original:issue.original,context:issue.context};
    if(request.command==='transcriptSearch')return {total:1,passages:[{uid:'u0001',speaker:'DM',text:issue.original}]};
    if(request.command==='transcriptPrepare'){data={...data,mode:'review',issues:[issue]};return structuredClone(data);}
    if(request.command==='transcriptFinalizePreview')return {planSha256:'plan',update:'cleaned/demo-session.yaml',retire:['cleaned/demo-transcript-review.md']};
    if(request.command==='transcriptFinalize'){assert.equal(request.planSha256,'plan');data={...data,mode:'finalized'};return structuredClone(data);}
    throw new Error('Unexpected command');
  }});return {root,view,calls,opened};
}
test('transcript pane presents context and applies only the chosen fix with inspected guards',async()=>{
  const {root,view,calls}=setup();await view.ready;
  assert.match(root.textContent,/Original: It got denser/);assert.match(root.textContent,/Conversation context/);
  root.querySelector('select').value='proposed';button(root,'Copy replacement into matching turns').click();await settle();
  assert.equal(root.querySelector('textarea').value,'It got darker.');
  assert.equal(button(root,'Apply this transcript decision').disabled,true);
  button(root,'Preview transcript decision').click();await settle();
  assert.match(root.textContent,/Changes to save/);assert.equal(calls.filter(x=>x.command==='transcriptApply').length,0);
  button(root,'Apply this transcript decision').click();await settle();
  const applied=calls.filter(x=>x.command==='transcriptApply');assert.equal(applied.length,1);assert.equal(applied[0].issue,'word');
  assert.equal(applied[0].turns[0].after,'It got darker.');assert.match(root.textContent,/Recheck scene\/entity/);view.dispose();
});
test('stale transcript decision stays visible and displays the guard failure',async()=>{
  const {root,view}=setup({fail:true});await view.ready;
  root.querySelector('select').value='retain';button(root,'Preview transcript decision').click();await settle();
  button(root,'Apply this transcript decision').click();await settle();
  assert.match(root.textContent,/Stale transcript review/);assert.match(root.textContent,/Which word/);view.dispose();
});
test('a finalized passage is inspected before exact words are queued for correction',async()=>{
  const {root,view,calls}=setup({finalized:true});await view.ready;
  [...root.querySelectorAll('label')].find(el=>el.textContent.startsWith('Find words')).querySelector('input').value='denser';
  button(root,'Search transcript').click();await settle();
  assert.equal(calls.find(x=>x.command==='transcriptSearch').query,'denser');
  button(root,'u0001 · DM: It got denser.').click();await settle();
  assert.match(root.textContent,/Prepared original: It got denser/);
  [...root.querySelectorAll('label')].find(el=>el.textContent.startsWith('Exact words')).querySelector('input').value='denser';
  button(root,'Queue this passage for correction').click();await settle();
  const queued=calls.find(x=>x.command==='transcriptPrepare');assert.equal(queued.uid,'u0001');assert.equal(queued.before,'denser');
  assert.match(root.textContent,/Which word/);view.dispose();
});

test('editing a previewed correction requires a fresh preview before saving',async()=>{
  const {root,view,calls}=setup();await view.ready;
  root.querySelector('select').value='retain';button(root,'Preview transcript decision').click();await settle();
  assert.equal(button(root,'Apply this transcript decision').disabled,false);
  const correction=[...root.querySelectorAll('label')].find(el=>el.textContent.startsWith('Replacement words')).querySelector('input');
  correction.value='colder';correction.dispatchEvent(new root.ownerDocument.defaultView.Event('input',{bubbles:true}));
  assert.equal(button(root,'Apply this transcript decision').disabled,true);assert.doesNotMatch(root.textContent,/Changes to save/);
  button(root,'Apply this transcript decision').click();await settle();
  assert.equal(calls.filter(x=>x.command==='transcriptApply').length,0);view.dispose();
});

test('finishing a resolved review shows the retirement plan before an explicit finalize request',async()=>{
  const {root,view,calls}=setup({resolved:true});await view.ready;
  assert.equal(button(root,'Finish transcript review').disabled,true);
  button(root,'Preview finishing review').click();await settle();
  assert.match(root.textContent,/cleaned\/demo-transcript-review.md/);
  assert.equal(calls.filter(x=>x.command==='transcriptFinalize').length,0);
  button(root,'Finish transcript review').click();await settle();
  assert.equal(calls.filter(x=>x.command==='transcriptFinalize').length,1);assert.doesNotMatch(root.textContent,/Preview finishing review/);view.dispose();
});
