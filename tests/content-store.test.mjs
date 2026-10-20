import test from 'node:test';
import assert from 'node:assert/strict';
import {availableFrom,availableInContext,excluded} from '../src/content-store.mjs';
import {instantiate} from '../src/worker-headers.mjs';

const entry = metadata => ({note:{metadata}});
const context = date => ({date,campaigns:[]});
const povSettings = {respect_pov_dates:true};

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

test('dated POV hides a page until the start of its stated period, including plural years',()=>{
  for (const [value,boundary,before] of [
    [1740,'1740-01-01','1739-12-31'],['1740','1740-01-01','1739-12-31'],
    ['1740s','1740-01-01','1739-12-31'],[' 1740s ','1740-01-01','1739-12-31'],
    ['1740-04','1740-04-01','1740-03-31'],['1740-04-02','1740-04-02','1740-04-01'],
  ]) for (const dm of [false,true]) {
    const page=entry({POV:value});
    assert.equal(availableInContext(page,{...context(before),dm},povSettings),false,String(value));
    assert.equal(availableInContext(page,{...context(boundary),dm},povSettings),true,String(value));
    assert.equal(availableInContext(page,{...context('1750-01-01'),dm},povSettings),true,String(value));
  }
});

test('POV remains independent of birth, creation, activity, and campaign exclusions',()=>{
  for (const metadata of [
    {POV:1740,born:1720},{POV:1720,born:1740},{POV:1740,created:1720},
    {POV:1720,created:1740},{POV:1740,activeYear:1720},{POV:1720,activeYear:1740},
  ]) {
    assert.equal(availableFrom(entry(metadata),povSettings),17400101);
    assert.equal(availableInContext(entry(metadata),context('1739-12-31'),povSettings),false);
    assert.equal(availableInContext(entry(metadata),context('1740-01-01'),povSettings),true);
  }
  assert.equal(availableInContext(entry({POV:1740,excludePublish:['dufr']}),{...context('1750-01-01'),campaigns:['dufr']},povSettings),false);
  assert.equal(availableInContext(entry({POV:1720,born:'1740'}),context('1740-01-01'),povSettings),false);
});

test('undated, modern, missing, and invalid POV values add no date restriction',()=>{
  for (const POV of [undefined,null,'modern','undated','unknown','',false,{},[1740],'1740s extra','1740-13','1740-02-29']) {
    assert.equal(availableFrom(entry({POV}),povSettings),10101,JSON.stringify(POV));
    assert.equal(availableInContext(entry({POV}),context('1730-01-01'),povSettings),true);
    assert.equal(availableInContext(entry({POV,born:1740}),context('1730-01-01'),povSettings),false);
  }
});

test('POV restrictions are disabled unless the site explicitly opts in',()=>{
  for (const settings of [undefined,{}, {respect_pov_dates:false}]) {
    for (const POV of [1740,'1740','1740s','1740-04-02']) {
      assert.equal(availableFrom(entry({POV}),settings),10101);
      assert.equal(availableInContext(entry({POV}),context('1730-01-01'),settings),true);
      assert.equal(availableInContext(entry({POV,born:1740}),context('1730-01-01'),settings),false);
      assert.equal(availableInContext(entry({POV,activeYear:1740}),context('1730-01-01'),settings),false);
    }
  }
});

test('a reader POV choice overrides the site default while keeping other page restrictions',()=>{
  for (const respect_pov_dates of [false,true]) for (const pov of [false,true]) {
    const settings={respect_pov_dates},view={...context('1730-01-01'),pov};
    assert.equal(availableInContext(entry({POV:'1740s'}),view,settings),!pov);
    assert.equal(availableInContext(entry({born:1740}),view,settings),false);
    assert.equal(availableInContext(entry({activeYear:1740}),view,settings),false);
    assert.equal(availableInContext(entry({excludePublish:'all'}),view,settings),false);
  }
});
