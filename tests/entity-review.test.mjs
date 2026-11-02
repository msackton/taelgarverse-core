import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {mountEntityReview,entityQueueEntries} from '../src/browser/entity-review.mjs';
const source={kind:'transcript',sourceId:'polished',startUid:'u0002',endUid:'u0004'};
const fixture=()=>({token:{mapSha256:'map',reviewSha256:null,notes:[]},session:{campaign:'Demo',number:1},reviewPath:'demo-entities-review.json',
  review:{history:[],feedback:[]},evidence:{e001:[{source,path:'transcript.md',line:7}]},
  document:{entities:[{id:'e001',label:'Guide',kind:'npc',importance:'cameo',note:'People/Guide.md',occurrences:[{source}],review:{confidence:'medium',status:'unreviewed'}},
    {id:'e002',label:'Patron',kind:'divine',importance:'supporting',identifiedLater:true,occurrences:[{source}],review:{confidence:'high',status:'automatedReviewed'}}]}});
const settle=()=>new Promise(resolve=>setTimeout(resolve,10));
const button=(root,label)=>[...root.querySelectorAll('button')].find(node=>node.textContent===label);
const field=(root,label)=>[...root.querySelectorAll('label')].find(node=>node.textContent.startsWith(label)).querySelector('input,select,textarea');
function setup(mode='review',{fail=false}={}){
  const {document}=parseHTML('<main></main>'),root=document.querySelector('main'),create=document.createElement.bind(document);
  document.createElement=tag=>{const node=create(tag);if(tag==='select')Object.defineProperty(node,'value',{value:'',writable:true});return node;};
  const data=fixture(),calls=[],opened=[];
  const view=mountEntityReview(root,{session:'demo.yaml',mode,open:(...args)=>opened.push(args),request:async request=>{
    calls.push(structuredClone(request));
    if(request.command==='inspect'){data.token.notes=request.notes??[];return structuredClone(data);}
    if(request.command==='entityNoteChoices')return {paths:['People/Correct.md']};
    if(request.command==='evidence')return {passages:[{source,text:'The guide speaks.',path:'transcript.md',line:7}]};
    if(request.command==='entityFeedback'){
      data.review.feedback.push({entity:request.entity,comment:request.comment,status:'open'});return structuredClone(data);
    }
    if(request.command==='entityUpdate'){
      if(fail)throw new Error('Stale review; reload');
      assert.deepEqual(request.token,data.token);
      const row=data.document.entities.find(item=>item.id===request.entity);
      if(request.action==='remove')data.document.entities=data.document.entities.filter(item=>item!==row);
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
  button(h.root,'Skip for now').click();await settle();assert.match(h.root.textContent,/Patron/);assert.equal(h.calls.length,1);
  assert.match(h.root.textContent,/Identified later/);h.view.dispose();
});
test('table renders a row per entity with source and vault links; edits preserve optional reasons',async()=>{
  const h=setup('map');await h.view.ready;assert.equal(h.root.querySelectorAll('tbody tr').length,2);
  const links=[...h.root.querySelectorAll('a')];links.find(a=>a.textContent==='u0002–u0004').click();await settle();
  links.find(a=>a.textContent==='People/Guide.md').click();await settle();assert.deepEqual(h.opened,[['transcript.md',7],['People/Guide.md',undefined]]);
  field(h.root,'Entity label').value='Correct guide';field(h.root,'Reason').value='Same person.';
  button(h.root,'Save changes').click();await settle();
  assert.equal(h.calls.at(-1).reason,'Same person.');assert.equal(h.data.document.entities[0].label,'Correct guide');h.view.dispose();
});
test('human approval advances to the high-confidence agent-reviewed entity',async()=>{
  const h=setup();await h.view.ready;button(h.root,'Accept and next').click();await settle();
  assert.equal(h.data.document.entities[0].review.status,'humanReviewed');assert.equal(h.data.document.entities[1].review.status,'automatedReviewed');
  assert.equal(h.root.querySelector('strong').textContent,'Patron');h.view.dispose();
});
test('new vault links are inspected before saving and status may be reopened',async()=>{
  const h=setup();await h.view.ready;field(h.root,'Vault link').value='People/Correct.md';button(h.root,'Accept and next').click();await settle();
  assert.deepEqual(h.calls.filter(x=>x.command==='inspect').at(-1).notes,['People/Correct.md']);
  assert.equal(h.data.document.entities[0].note,'People/Correct.md');h.view.dispose();
});
test('agent feedback persists without supplying human approval or an export step',async()=>{
  const h=setup();await h.view.ready;field(h.root,'Comment or question').value='Check the identity.';button(h.root,'Save agent feedback').click();await settle();
  assert.equal(h.data.review.feedback[0].comment,'Check the identity.');assert.equal(h.data.document.entities[0].review.status,'unreviewed');h.view.dispose();
});
test('remove saves only the selected record and stale saves keep the form visible',async()=>{
  const h=setup();await h.view.ready;button(h.root,'Remove and next').click();await settle();assert.deepEqual(h.data.document.entities.map(r=>r.id),['e002']);h.view.dispose();
  const stale=setup('review',{fail:true});await stale.view.ready;button(stale.root,'Accept and next').click();await settle();
  assert.match(stale.root.textContent,/Stale review/);assert.equal(stale.root.querySelector('strong').textContent,'Guide');stale.view.dispose();
});
test('evidence is lazy and late helper responses cannot redraw a disposed view',async()=>{
  const h=setup();await h.view.ready;assert.equal(h.calls.some(r=>r.command==='evidence'),false);
  const details=h.root.querySelector('details');details.open=true;details.dispatchEvent(new h.root.ownerDocument.defaultView.Event('toggle'));await settle();
  assert.match(h.root.textContent,/The guide speaks/);h.view.dispose();assert.equal(h.root.childNodes.length,0);
});

test('acceptance preserves unresolved candidates when the vault link is unchanged',async()=>{
  const h=setup();delete h.data.document.entities[0].note;h.data.document.entities[0].candidates=['People/Maybe.md'];
  await h.view.ready;button(h.root,'Accept and next').click();await settle();
  assert.equal('note' in h.calls.find(r=>r.command==='entityUpdate').changes,false);
  assert.deepEqual(h.data.document.entities[0].candidates,['People/Maybe.md']);h.view.dispose();
});
