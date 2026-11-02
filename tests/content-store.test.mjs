import test from 'node:test';
import assert from 'node:assert/strict';
import {availableFrom,availableInContext,compileAvailability,hasStubTag,omitFromPublication,parseNote} from '../src/content-store.mjs';
import {instantiate} from '../src/worker-headers.mjs';

const entry = metadata => ({note:{metadata}});
const context = date => ({date,campaigns:[]});

test('stub publication policy recognizes exact frontmatter tags in lists and scalar strings',()=>{
  for(const tags of [['person','status/stub'],'status/stub','person, status/stub','person #STATUS/STUB',[null,42,' #Status/Stub ']])
    assert.equal(hasStubTag({tags}),true,JSON.stringify(tags));
  for(const tags of [undefined,null,42,{},['status/wip'],['status/stubbed'],['status/stub/child'],['other/status/stub']])
    assert.equal(hasStubTag({tags}),false,JSON.stringify(tags));
});

test('noPublish requires a YAML boolean true and does not override stub or campaign policy',()=>{
  assert.equal(omitFromPublication(parseNote('---\nnoPublish: true\n---\n').metadata),true);
  for(const value of [undefined,false,null,'true','false',0,1,[],{}])
    assert.equal(omitFromPublication({noPublish:value}),false,JSON.stringify(value));
  assert.equal(omitFromPublication({noPublish:false,tags:['status/stub']}),true);
  assert.equal(omitFromPublication({excludePublish:'all'}),false);
  assert.equal(omitFromPublication({excludePublish:['dufr']}),false);
});

test('birth and creation boundaries agree with CustomJS for full and partial dates',()=>{
  const customJS={state:{}};
  instantiate({customJS,app:{}});
  for (const value of [1730,'1730','1730-04','1730-04-02']) {
    for (const field of ['born','created']) {
      for (const date of ['1729-12-31','1730-01-01','1730-04-01','1730-04-02','1730-04-30','1730-12-31','1731-01-01']) {
        const metadata = {[field]:value};
        const expected=customJS.DateManager.getPageDates(metadata,customJS.DateManager.normalizeDate(date,false)).isCreated;
        assert.equal(availableInContext(entry(metadata),context(date)),expected,field+' '+value+' at '+date);
      }
    }
  }
});

test('birth takes precedence over creation; activeYear remains an independent restriction',()=>{
  assert.equal(availableInContext(entry({born:'1730-04-02',created:'1750-01-01'}),context('1730-04-02')),true);
  for (const metadata of [{born:1740,activeYear:1720},{born:1720,activeYear:1740}]) {
    assert.equal(availableInContext(entry(metadata),context('1730-01-01')),false);
    assert.equal(availableInContext(entry(metadata),context('1740-01-01')),true);
  }
  for (const metadata of [{born:null},{born:'unknown'},{created:'unknown'},{born:'not-a-date'},{died:1720},{destroyed:1720}]) {
    assert.equal(availableInContext(entry(metadata),context('1730-01-01')),true);
  }
});


test('retired POV metadata, settings and context flags never restrict page availability',()=>{
  for(const POV of [1740,'1740','1740s','1740-04','1740-04-02','modern',null,{},[1740]])
    for(const respect_pov_dates of [undefined,false,true])for(const pov of [undefined,false,true]){
      const view={...context('1730-01-01'),pov},settings={respect_pov_dates};
      assert.equal(availableFrom(entry({POV}),settings),10101);
      assert.equal(availableInContext(entry({POV}),view,settings),true);
      for(const restriction of [{born:1740},{created:1740},{activeYear:1740}])
        assert.equal(availableInContext(entry({POV,...restriction}),view,settings),false);
    }
});

test('retired publication exclusions are ignored in raw and compiled availability',()=>{
  for(const excludePublish of ['all',['all'],['dufr'],'DUFR, adma']){
    const page=entry({excludePublish});
    assert.deepEqual(compileAvailability(page),{from:10101});
    for(const campaigns of [[],['dufr'],['adma']]){
      const view={date:'1730-01-01',campaigns};
      assert.equal(availableInContext(page,view),true);
      assert.equal(availableInContext({...page,availability:{from:10101,exclusions:['all']}},view),true);
    }
  }
});
