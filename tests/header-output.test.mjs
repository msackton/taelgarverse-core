import test from 'node:test';
import assert from 'node:assert/strict';
import {createHeaderSnapshot,renderHeaderCallout} from '../src/header-core/index.mjs';
import {headerFixture} from './helpers/header-fixture.mjs';

test('repeated renders isolate dates and styles and do not mutate request or snapshot data',()=>{
  const h=headerFixture(),before=JSON.stringify(h.input),metadata=structuredClone(h.metadata('Example'));
  const request={name:'Example',metadata,date:'1720-01-01',mode:'obsidian'};
  const requestBefore=structuredClone(request),first=renderHeaderCallout(h.runtime,request);
  const later=h.callout('Example',{date:'1750-01-01',mode:'website'});
  assert.match(first,/20 years old/);assert.match(later,/died at age 40 years/);
  assert.equal(renderHeaderCallout(h.runtime,request),first);assert.deepEqual(request,requestBefore);
  assert.equal(JSON.stringify(h.input),before);assert.equal(Object.isFrozen(h.runtime.coreMeta),true);
  assert.equal(Object.isFrozen(h.metadata('Example').whereabouts),true);
});

test('indexed leadership matches the full scan for both render formats through succession boundaries',()=>{
  const h=headerFixture(),full=createHeaderSnapshot({...h.input,indexAffiliations:false});
  for(const date of ['1719-12-31','1720-01-01','1729-12-31','1730-01-01'])for(const mode of ['obsidian','website']){
    const request={name:'River Town',metadata:h.metadata('River Town'),date,mode};
    assert.equal(renderHeaderCallout(h.runtime,request),renderHeaderCallout(full,request),date+' / '+mode);
  }
});

test('unrecognized affiliation containers disable the optimization rather than narrowing the full scan',()=>{
  const h=headerFixture({extraNotes:{'Legacy.md':{affiliations:'Guild'}}});
  assert.equal(h.runtime.canIndexAffiliations,false);
});
