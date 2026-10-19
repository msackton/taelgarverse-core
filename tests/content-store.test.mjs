import test from 'node:test';
import assert from 'node:assert/strict';
import {availableInContext,excluded} from '../src/content-store.mjs';
import {instantiate} from '../src/worker-headers.mjs';

const entry = metadata => ({note:{metadata}});
const context = date => ({date,campaigns:[]});

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

test('exclusions accept lists and comma-separated strings without making tags a visibility rule',()=>{
  for (const excludePublish of [' DUFR, adma ',[' DUFR ','adma']]) {
    assert.equal(excluded({excludePublish},{campaigns:['dufr']}),true);
    assert.equal(excluded({excludePublish},{campaigns:['ADMA']}),true);
    assert.equal(excluded({excludePublish},{campaigns:[]}),false);
  }
  for (const excludePublish of [' ALL ',['All']]) assert.equal(excluded({excludePublish},{campaigns:[]}),true);
  assert.equal(availableInContext(entry({tags:['excalidraw']}),context('1730-01-01')),true);
});
