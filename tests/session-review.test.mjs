import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {mountSessionReview} from '../src/browser/session-review.mjs';
const settle=()=>new Promise(resolve=>setTimeout(resolve,10));
const button=(root,name)=>[...root.querySelectorAll('button')].find(el=>el.textContent===name);
function setup(){
  const {document}=parseHTML('<main></main>'),root=document.querySelector('main'),calls=[];
  const create=document.createElement.bind(document);document.createElement=tag=>{const node=create(tag);if(tag==='select')Object.defineProperty(node,'value',{value:'',writable:true});return node;};
  const view=mountSessionReview(root,{open:()=>{},request:async request=>{
    calls.push(request);
    if(request.command==='index')return {sessions:[{sessionYaml:'demo.yaml',campaign:'Demo',number:1,entities:1,pending:1},{sessionYaml:'unmapped.yaml',campaign:'Other'}]};
    if(request.command==='inspect')return {token:{},session:{campaign:'Demo',number:1},review:{history:[],feedback:[]},document:{entities:[{id:'e001',label:'Guide',kind:'npc',importance:'cameo',review:{confidence:'high',status:'automatedReviewed'}}]}};
    throw new Error('Unexpected '+request.command);
  }});return {root,view,calls};
}
test('session inventory only offers two actions for maps, with explicit human-review status',async()=>{
  const h=setup();await h.view.ready;assert.equal(h.root.querySelectorAll('tbody tr').length,1);
  assert.match(h.root.textContent,/Unreviewed · 1 of 1/);assert.equal(h.root.querySelector('tbody').querySelectorAll('button').length,2);
  button(h.root,'Show entities map').click();await settle();assert.equal(h.view.getState().stage,'map');assert.match(h.root.textContent,/Guide/);
  const topbar=h.root.querySelector('.entity-review-topbar');
  assert.deepEqual([...topbar.querySelectorAll('button')].map(node=>node.textContent),['Back to sessions','Entity-by-entity review','Reload list']);
  assert.ok(topbar.querySelector('[role=status]'));
  assert.equal([...h.root.querySelectorAll('[role=status]')].filter(node=>!node.hidden).length,1);
  button(h.root,'Back to sessions').click();await settle();button(h.root,'Review entities').click();await settle();
  assert.equal(h.view.getState().stage,'review');assert.ok(button(h.root,'Skip for now'));h.view.dispose();
});
test('restoring selection does not start Python and changing state clears stale controls',async()=>{
  const h=setup();await h.view.ready;await h.view.restore({session:'other.yaml',stage:'review'});assert.deepEqual(h.calls.map(r=>r.command),['index']);
  button(h.root,'Review entities').click();await settle();assert.ok(button(h.root,'Save and next'));
  await h.view.restore({session:'other.yaml',stage:'map'});assert.equal(button(h.root,'Save and next'),undefined);h.view.dispose();
});
test('late discovery cannot redraw a disposed view',async()=>{
  const {document}=parseHTML('<main></main>');let resolve;const root=document.querySelector('main');
  const view=mountSessionReview(root,{request:()=>new Promise(r=>resolve=r),open:()=>{}});view.dispose();resolve({sessions:[]});await view.ready;assert.equal(root.childNodes.length,0);
});
