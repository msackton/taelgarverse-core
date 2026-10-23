import test from 'node:test';
import assert from 'node:assert/strict';
import {indexView,indexPopupShell} from '../src/index-view.mjs';
import {mountIndexPopups} from '../src/browser/index-popups.mjs';
import {imageDOM} from './helpers/image-dom.mjs';

const result=(allDead=false)=>({type:'members',label:'Members',target:'Guild',includeHistorical:allDead,showHistoricalToggle:true,warnings:[],items:[
  {name:'Alice',person:['Alice'],info:[],lastKnown:[],home:[],deceased:allDead},
  {name:'Bob',person:['Bob'],info:[],lastKnown:[],home:[],deceased:true},
]});

for(const mode of ['grid','table'])test('Members '+mode+' checkboxes isolate indexes, retain order, show empty state and clean up',()=>{
  const markup=indexView(result(),()=>'',mode);
  const h=imageDOM(markup+markup),dispose=mountIndexPopups(h.document);
  const indexes=h.document.querySelectorAll('.taelgar-index'),checkbox=indexes[0].querySelector('input');
  assert.equal(checkbox.closest('label').textContent.trim(),'Include historical members');
  const members=indexes[0].querySelectorAll('[data-index-member]');
  assert.deepEqual(Array.from(members,item=>item.hidden),[false,true]);
  checkbox.checked=true;h.event(checkbox,'change');
  assert.deepEqual(Array.from(members,item=>item.hidden),[false,false]);
  assert.equal(indexes[1].querySelector('[data-index-deceased]').hidden,true,'a different index stays unchanged');
  checkbox.checked=false;h.event(checkbox,'change');
  assert.deepEqual(Array.from(members,item=>item.hidden),[false,true]);
  assert.equal(indexes[0].querySelectorAll('[data-index-member]')[1],members[1],'filtering retains the original card/row order');
  dispose();checkbox.checked=true;h.event(checkbox,'change');
  assert.equal(members[1].hidden,true,'unmounted controls no longer change the view');
  const dead=imageDOM(indexView(result(true),()=>'',mode)),cleanup=mountIndexPopups(dead.document);
  const toggle=dead.document.querySelector('input');assert.equal(toggle.hasAttribute('checked'),true);
  toggle.checked=false;dead.event(toggle,'change');
  assert.ok([...dead.document.querySelectorAll('[data-index-member]')].every(item=>item.hidden));
  assert.equal(dead.document.querySelector('.taelgar-index-empty').hidden,false);
  assert.equal(dead.document.querySelector('[data-index-results]').hidden,true);
  toggle.checked=true;dead.event(toggle,'change');
  assert.equal(dead.document.querySelector('.taelgar-index-empty').hidden,true);
  assert.equal(dead.document.querySelector('[data-index-results]').hidden,false);cleanup();
});

test('Members checkbox works inside a lazy popup after its panel moves outside the mounted note',async()=>{
  const h=imageDOM('<div class="note">'+indexPopupShell({type:'members',label:'Members',target:'Guild'})+'</div>');
  const root=h.document.querySelector('details'),dispose=mountIndexPopups(root.parentElement,{load:async()=>indexView(result(),()=>'', 'grid')});
  h.click(root.querySelector('summary'));
  await new Promise(resolve=>setTimeout(resolve,0));
  const dialog=h.document.querySelector('dialog'),checkbox=dialog.querySelector('input'),dead=dialog.querySelector('[data-index-deceased]');
  assert.equal(dead.hidden,true);checkbox.checked=true;h.event(checkbox,'change');assert.equal(dead.hidden,false);
  dispose();assert.equal(h.document.querySelector('dialog'),null);
});
