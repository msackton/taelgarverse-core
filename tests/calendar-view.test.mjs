import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as pause} from 'node:timers/promises';
import {mountCampaignCalendar} from '../src/browser/campaign-calendar.mjs';
import {imageDOM} from './helpers/image-dom.mjs';

const campaigns=[
  {id:'alpha',label:'Alpha',date:'1748-07-23',available:true,source:'Campaigns/A/Session.md'},
  {id:'beta',label:'Beta',date:'1748-07-23',available:true,source:'Campaigns/B/Session.md'},
  {id:'old',label:'Old campaign',date:'1715-05-02',available:true,source:'Campaigns/Old/Session.md'},
  {id:'undated',label:'Undated',date:null,available:false,unavailableReason:'No published session date'},
];
const data={context:campaigns[0],campaigns};

test('minimal calendar shows one moon per day and separate campaign dots; browsing never selects a campaign or rereads notes',async()=>{
  const h=imageDOM(),root=h.document.createElement('div');h.document.body.append(root);let reads=0;
  const calendar=mountCampaignCalendar(root,{initialDate:data.context.date,loadCalendar:async()=>{reads++;return data;}});
  try{
    await calendar.ready;
    assert.equal(root.querySelectorAll('.tc-weekdays th').length,7);assert.equal(root.querySelectorAll('.tc-moon-icon').length,31);
    assert.equal(root.querySelectorAll('.tc-campaign').length,4);
    const dots=root.querySelectorAll('[data-calendar-date="1748-07-23"] .tc-date-dots .tc-campaign-dot');
    assert.equal(dots.length,2);assert.match(dots[0].getAttribute('aria-label'),/Alpha/);assert.match(dots[1].getAttribute('aria-label'),/Beta/);
    assert.equal(root.querySelector('.tc-campaign[data-calendar-campaign="undated"]').disabled,true);
    assert.equal(root.querySelector('.tc-agenda'),null);assert.equal(root.querySelector('.tc-layers'),null);
    h.click(root.querySelector('.tc-campaign[data-calendar-campaign="old"]'));
    assert.deepEqual(calendar.state,{year:1715,month:5});assert.equal(root.querySelectorAll('.tc-date-dots .tc-campaign-dot').length,1);
    assert.match(root.querySelector('.tc-current').textContent,/Alpha.*1748-07-23/);
    h.click(root.querySelector('[data-calendar-action="today"]'));assert.deepEqual(calendar.state,{year:1748,month:7});
    h.click(root.querySelector('[data-calendar-action="previous"]'));assert.deepEqual(calendar.state,{year:1748,month:6});assert.equal(root.querySelectorAll('.tc-moon-icon').length,30);
    assert.equal(root.querySelector('[data-calendar-action="settings"]'),null);assert.equal(reads,1);
    const control=root.querySelector('[data-calendar-action="next"]');calendar.dispose();h.click(control);assert.equal(calendar.state.month,6);
  }finally{calendar.dispose();}
});

test('a custom current date has its own dot without changing registered campaign dates',async()=>{
  const h=imageDOM(),root=h.document.createElement('div');h.document.body.append(root);
  let value={...data,context:{id:'custom',kind:'custom',label:'Custom',date:'1748-07-24',available:true}};
  const calendar=mountCampaignCalendar(root,{initialDate:value.context.date,loadCalendar:async()=>value});
  try{
    await calendar.ready;
    assert.equal(root.querySelectorAll('.tc-campaign').length,5);
    assert.match(root.querySelector('[data-calendar-date="1748-07-24"] .tc-campaign-dot').title,/Custom/);
    assert.equal(root.querySelectorAll('[data-calendar-date="1748-07-23"] .tc-date-dots .tc-campaign-dot').length,2);
    h.click(root.querySelector('[data-calendar-action="previous"]'));
    h.click(root.querySelector('.tc-campaign[data-calendar-campaign="custom"]'));
    assert.deepEqual(calendar.state,{year:1748,month:7});
    value={...value,context:{...value.context,date:'0001-01-01'}};await calendar.refresh();
    h.click(root.querySelector('[data-calendar-action="today"]'));
    h.click(root.querySelector('[data-calendar-action="previous"]'));
    assert.deepEqual(calendar.state,{year:1,month:1});
    value={...value,context:{...value.context,date:'9999-12-31'}};await calendar.refresh();
    h.click(root.querySelector('[data-calendar-action="today"]'));
    h.click(root.querySelector('[data-calendar-action="next"]'));
    assert.deepEqual(calendar.state,{year:9999,month:12});
    value=data;await calendar.refresh();assert.equal(root.querySelector('.tc-campaign[data-calendar-campaign="custom"]'),null);
  }finally{calendar.dispose();}
});

test('moon tooltips show the adopted midnight anchor and exact July full moon time without extra panels',async()=>{
  const h=imageDOM(),root=h.document.createElement('div');h.document.body.append(root);
  const calendar=mountCampaignCalendar(root,{initialDate:'1748-04-06',loadCalendar:async()=>data});
  try{
    await calendar.ready;
    assert.match(root.querySelector('[data-calendar-date="1748-04-06"] .tc-moon-icon').getAttribute('aria-label'),/Full moon at 00:00/);
    assert.match(root.querySelector('.tc-lunar-note').textContent,/1748-04-06 at 00:00; 29.5-day/);
    const select=root.querySelector('[data-calendar-field="month"]');
    select.querySelector('[value="7"]').selected=true;h.event(select,'change');
    assert.match(root.querySelector('[data-calendar-date="1748-07-03"] .tc-moon-icon').title,/Full moon at 12:00/);
    assert.equal(root.querySelector('.tc-lunar-month'),null);
  }finally{calendar.dispose();}
});

test('session-date refresh moves dots and preserves the browsed month even when the active campaign is unavailable',async()=>{
  const h=imageDOM(),root=h.document.createElement('div');h.document.body.append(root);let value=data;
  const calendar=mountCampaignCalendar(root,{initialDate:'1748-07-23',loadCalendar:async()=>value});
  try{
    await calendar.ready;
    value={context:null,error:'Alpha: latest session has no full DR date',campaigns:[{...campaigns[0],available:false,date:null},campaigns[1]]};
    await calendar.refresh();
    assert.match(root.querySelector('.tc-status').textContent,/no full DR date/);
    assert.equal(root.querySelectorAll('.tc-date-dots .tc-campaign-dot').length,1);
    assert.equal(root.querySelectorAll('.tc-moon-icon').length,31);
    assert.equal(root.querySelector('[data-calendar-action="today"]').disabled,true);
    value={context:{...campaigns[0],date:'1748-07-24'},campaigns:[{...campaigns[0],date:'1748-07-24'},campaigns[1]]};
    await calendar.refresh();
    assert.equal(root.querySelectorAll('[data-calendar-date="1748-07-24"] .tc-campaign-dot').length,1);
    assert.deepEqual(calendar.state,{year:1748,month:7});
  }finally{calendar.dispose();}
});

test('late asynchronous loads cannot replace newer campaign dates or an unloaded view',async()=>{
  const h=imageDOM(),root=h.document.createElement('div');h.document.body.append(root);const pending=[];
  const calendar=mountCampaignCalendar(root,{initialDate:'1748-07-23',loadCalendar:()=>new Promise(resolve=>pending.push(resolve))});
  const refreshing=calendar.refresh();pending[1]({...data,context:campaigns[1]});await refreshing;
  const before=root.textContent;pending[0](data);await calendar.ready;assert.equal(root.textContent,before);
  const closing=calendar.refresh();calendar.dispose();pending[2](data);await closing;await pause(0);assert.equal(root.textContent,before);
});
