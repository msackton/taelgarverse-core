import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRelationshipBlock} from '../src/relationship-block.mjs';
import {mountRelationshipList} from '../src/browser/relationship-list.mjs';
import {imageDOM} from './helpers/image-dom.mjs';
test('relationship block defaults to diagram and validates the small configuration surface',()=>{
  assert.deepEqual(parseRelationshipBlock(''),{mode:'diagram'});
  assert.deepEqual(parseRelationshipBlock('mode: list'),{mode:'list'});
  for(const source of ['mode: other','depth: 2','[list]','mode: [','mode: list\nmode: diagram'])assert.throws(()=>parseRelationshipBlock(source));
});
test('list groups direct connections, preserves evidence and source links, and filters Worldbuilding',async()=>{
 const h=imageDOM(),root=h.document.createElement('div');h.document.body.append(root);const opened=[];
 const nodes=['A','B','C','Guild','Town','Worldbuilding/Draft'].map(id=>({id,path:id,name:id,type:id==='Town'?'place':id==='Guild'?'group':'person'}));
 const edges=[['A','B','mentions'],['B','C','mentions'],['A','Guild','member'],['A','Town','current'],['A','Worldbuilding/Draft','mentions']].map(([source,target,kind])=>({source,target,kind,evidence:kind==='mentions'?[{source,line:7,excerpt:'Met <script>bad</script>',date:'1720-01-01'}]:[]}));
 const list=mountRelationshipList(root,{initialRoot:'A',loadData:async()=>({graph:{date:'1720-01-01',nodes,edges}}),openNote:(...args)=>opened.push(args)});
 await list.ready;
 assert.match(root.textContent,/People mentioned/);assert.match(root.textContent,/Organizations/);assert.match(root.textContent,/Currently at/);
 assert.equal(root.querySelector('script'),null);assert.equal(root.querySelector('[data-href="C"]'),null);
 assert.equal(root.querySelector('[data-href="Worldbuilding/Draft"]'),null);
 h.click(root.querySelector('[data-href="B"]'));h.click(root.querySelector('[data-href="A"]'));
 assert.deepEqual(opened,[['B',undefined],['A',7]]);
 list.dispose();assert.equal(root.children.length,0);
});
test('list ignores late reads after disposal and reports empty relationships',async()=>{
 const h=imageDOM(),root=h.document.createElement('div');let resolve;
 const list=mountRelationshipList(root,{initialRoot:'A',loadData:()=>new Promise(r=>resolve=r),openNote(){}});
 list.dispose();resolve({graph:{nodes:[],edges:[]}});await list.ready;assert.equal(root.children.length,0);
 const empty=mountRelationshipList(root,{initialRoot:'A',loadData:async()=>({graph:{date:'1720',nodes:[{id:'A',type:'person'}],edges:[]}}),openNote(){}});
 await empty.ready;assert.match(root.textContent,/No direct connections/);empty.dispose();
});
