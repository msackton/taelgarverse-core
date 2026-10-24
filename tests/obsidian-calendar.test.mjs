import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {setTimeout as pause} from 'node:timers/promises';
import {build} from 'esbuild';
import {ROOT} from '../src/config.mjs';

const require=createRequire(import.meta.url);
const compiled=await build({absWorkingDir:ROOT,entryPoints:['obsidian/taelgarverse/features/calendar.mjs'],write:false,bundle:true,platform:'node',format:'cjs',external:['obsidian'],logLevel:'silent'});
const registry={campaigns:{alpha:{name:'Alpha',code:'a',campaignRoot:'Campaigns/A'},beta:{name:'Beta',code:'b',campaignRoot:'Campaigns/B'}}};
function emitter(){const listeners=new Map(),calls=[];return {
  on(name,callback){const list=listeners.get(name)??new Set();list.add(callback);listeners.set(name,list);return ()=>list.delete(callback);},
  trigger(name,...args){calls.push([name,...args]);for(const callback of listeners.get(name)??[])callback(...args);},calls,
  get count(){return [...listeners.values()].reduce((sum,list)=>sum+list.size,0);}
};}
function host(saved={}){
  class Component{
    constructor(){this.disposers=[];this.children=new Set();}
    registerEvent(dispose){this.disposers.push(dispose);}
    addChild(child){this.children.add(child);child.onload?.();return child;}
    removeChild(child){this.children.delete(child);child.unload();}
    unload(){this.onunload?.();for(const child of this.children)child.unload();this.children.clear();for(const dispose of this.disposers)dispose();}
  }
  const settings=[];
  class Setting {
    constructor(){this.value={};settings.push(this.value);}
    setName(value){this.value.name=value;return this;}setDesc(value){this.value.desc=value;return this;}setHeading(){return this;}
    control(kind,callback){const record=this.value,control={addOption(id,label){(record.options??={})[id]=label;return control;},setValue(value){record.value=value;return control;},getValue(){return record.value;},setPlaceholder(){return control;},setButtonText(value){record.button=value;return control;},onChange(fn){record.change=fn;return control;},onClick(fn){record.click=fn;return control;}};record.kind=kind;callback(control);return this;}
    addDropdown(fn){return this.control('dropdown',fn);}addButton(fn){return this.control('button',fn);}addText(fn){return this.control('text',fn);}addToggle(fn){return this.control('toggle',fn);}
  }
  const module={exports:{}},globals={module,exports:module.exports,console,setTimeout,clearTimeout,require:name=>name==='obsidian'?{Component,ItemView:class{},Setting}:require(name)};
  vm.runInNewContext(compiled.outputFiles[0].text,globals);
  const cache=emitter(),vault=emitter(),workspace=emitter(),files=[
    {path:'Campaigns/A/Session.md',metadata:{tags:['session-note'],campaign:'Alpha',DR:'1748-07-19',DR_end:'1748-07-23',sessionNumber:43}},
    {path:'Campaigns/B/Session.md',metadata:{tags:['session-note'],campaign:'Beta',DR:'1715-05-02'}},
    {path:'Events/Shared.md',metadata:{tags:['event'],DR:'1748-07-21'}},
  ];
  const commands=[],views=new Map();let saves=0,renders=0,ribbons=0,reads=0,closed=0;
  const app={metadataCache:{...cache,getFileCache:file=>({frontmatter:file.metadata})},
    vault:{...vault,adapter:{read:async()=>{reads++;return JSON.stringify(registry);}},getMarkdownFiles:()=>files,cachedRead(){throw new Error('The minimal calendar must not read event bodies');}},
    workspace:{...workspace,detachLeavesOfType(){closed++;}},setting:{open(){},openTabById(){}}};
  const plugin={app,manifest:{id:'taelgarverse'},settings:{calendarEnabled:true,calendarCampaign:'alpha',imageViewer:true,...saved},saveData:async()=>{saves++;},registerView:(id,factory)=>views.set(id,factory),addCommand:command=>commands.push(command),
    addRibbonIcon(){ribbons++;return {remove(){ribbons--;}};},headers:{bios:new Set([{render(){renders++;}}])}};
  const feature=new module.exports.CalendarFeature(plugin);feature.onload();
  return {feature,plugin,globals,files,cache,vault,workspace,commands,views,settings,get saves(){return saves;},get renders(){return renders;},get ribbons(){return ribbons;},get reads(){return reads;},get closed(){return closed;}};
}

test('regular campaign setting supplies query dates and all campaign dots without event-body reads',async()=>{
  const h=host();try{
    await h.feature.ready;assert.equal(h.globals.TaelgarverseCalendar.getCurrentDate(),'1748-07-23');
    const data=await h.feature.data();assert.equal(data.campaigns.length,2);assert.equal(data.campaigns.find(c=>c.id==='beta').date,'1715-05-02');
    const copy=h.globals.TaelgarverseCalendar.getCampaignDates();copy[0].date='1700-01-01';
    assert.equal(h.globals.TaelgarverseCalendar.getCurrentDate(),'1748-07-23');
    h.feature.renderSettings({},()=>{});const campaign=h.settings.find(item=>item.name==='Active campaign');
    assert.equal(campaign.kind,'dropdown');assert.equal(campaign.options.alpha,'Alpha');assert.equal(campaign.options.custom,'Custom');
    assert.equal(h.settings.some(item=>item.button==='Open calendar'),false);
    assert.equal(h.settings.some(item=>item.name==='Current date'),false);
    assert.equal(h.settings.some(item=>/source|world events/i.test(item.name)),false);
    const before=h.renders;await campaign.change('beta');
    assert.equal(h.globals.TaelgarverseCalendar.getCurrentDate(),'1715-05-02');assert.ok(h.renders>before,'open header and index children refresh immediately');
    assert.equal(h.plugin.settings.imageViewer,true);assert.ok(h.workspace.calls.some(([name])=>name==='dataview:refresh-views'));
    await h.feature.selectCampaign('alpha');
    h.files[0].metadata.DR_end='1748-07-24';h.cache.trigger('changed',h.files[0]);await pause(230);await h.feature.ready;
    assert.equal(h.globals.TaelgarverseCalendar.getCurrentDate(),'1748-07-24');assert.equal(h.commands[0].id,'open-campaign-calendar');
  }finally{h.feature.unload();}
  assert.equal(h.globals.TaelgarverseCalendar,undefined);assert.equal(h.cache.count,0);assert.equal(h.vault.count,0);
});

test('the whole calendar is opt-in, stops on disable, and retains campaign and custom-date settings',async()=>{
  const h=host({calendarEnabled:false});let disposed=0;
  try{
    await h.feature.ready;
    assert.equal(h.globals.TaelgarverseCalendar,undefined);assert.equal(h.reads,0);assert.equal(h.ribbons,0);
    assert.equal(h.cache.count,0);assert.equal(h.vault.count,0);assert.equal(h.commands[0].checkCallback(true),false);
    h.feature.renderSettings({},()=>{});
    assert.deepEqual(h.settings.map(row=>row.name),['Campaign calendar','Enable campaign calendar']);
    const toggle=h.settings.find(row=>row.kind==='toggle');assert.equal(toggle.value,false);
    await toggle.change(true);
    assert.equal(h.ribbons,1);assert.equal(h.commands[0].checkCallback(true),true);
    assert.equal(h.globals.TaelgarverseCalendar.getCurrentDate(),'1748-07-23');
    await h.feature.selectCampaign('custom');await h.feature.setCustomDate('1748-04-06');
    const api=h.globals.TaelgarverseCalendar;
    h.feature.views.add({calendar:{dispose(){disposed++;}}});
    const closed=h.closed;await h.feature.setEnabled(false);
    assert.equal(h.globals.TaelgarverseCalendar,undefined);assert.equal(h.ribbons,0);assert.equal(disposed,1);assert.ok(h.closed>closed);
    assert.equal(h.cache.count,0);assert.equal(h.vault.count,0);assert.equal(h.commands[0].checkCallback(false),false);
    assert.throws(()=>api.getCurrentDate(),/disabled/);await assert.rejects(h.feature.data(),/disabled/);
    const reads=h.reads;h.cache.trigger('changed',h.files[0]);await h.feature.refresh();assert.equal(h.reads,reads);
    assert.equal(h.plugin.settings.calendarCampaign,'custom');assert.equal(h.plugin.settings.calendarCustomDate,'1748-04-06');
    await h.feature.setEnabled(true);
    assert.equal(h.ribbons,1);assert.equal(h.globals.TaelgarverseCalendar.getCurrentDate(),'1748-04-06');
    const listeners=h.cache.count;await h.feature.setEnabled(true);assert.equal(h.ribbons,1);assert.equal(h.cache.count,listeners);
  }finally{h.feature.unload();}
  assert.equal(h.ribbons,0);assert.equal(h.cache.count,0);assert.equal(h.vault.count,0);
});

test('turning off during an asynchronous load cannot publish the calendar API afterwards',async()=>{
  const h=host({calendarEnabled:false});let release;
  try{
    const previous={getCurrentDate:()=> '1700-01-01'};h.globals.TaelgarverseCalendar=previous;
    h.plugin.app.vault.adapter.read=()=>new Promise(resolve=>{release=()=>resolve(JSON.stringify(registry));});
    const enabling=h.feature.setEnabled(true);await pause(0);
    await h.feature.setEnabled(false);release();await enabling;
    assert.equal(h.globals.TaelgarverseCalendar,previous);assert.equal(h.ribbons,0);assert.equal(h.feature.state,null);
    h.plugin.app.vault.adapter.read=async()=>JSON.stringify(registry);
    await h.feature.setEnabled(true);assert.notEqual(h.globals.TaelgarverseCalendar,previous);
    await h.feature.setEnabled(false);assert.equal(h.globals.TaelgarverseCalendar,previous);
  }finally{h.feature.unload();}
});

test('Custom settings validate and remember a manual date and refresh query consumers',async()=>{
  const h=host();let saved;
  try{
    await h.feature.ready;await h.feature.selectCampaign('custom');
    assert.equal(h.plugin.settings.calendarCustomDate,'1748-07-23','first selection starts at the active campaign date');
    assert.equal(h.globals.TaelgarverseCalendar.getContext().kind,'custom');
    h.feature.renderSettings({},()=>{});const date=h.settings.find(item=>item.name==='Custom date');
    const saves=h.saves,renders=h.renders;date.value='1748-02-29';await date.click();
    assert.match(date.desc,/no leap days/);assert.equal(h.saves,saves);
    assert.equal(h.globals.TaelgarverseCalendar.getCurrentDate(),'1748-07-23');
    date.value=' 1748-04-06 ';await date.click();
    assert.equal(h.globals.TaelgarverseCalendar.getCurrentDate(),'1748-04-06');assert.ok(h.renders>renders);
    assert.equal(h.plugin.settings.calendarCustomDate,'1748-04-06');
    for(const invalid of ['1748-04-31','1748-4-6','0000-01-01',''])await assert.rejects(h.feature.setCustomDate(invalid));
    assert.equal(h.globals.TaelgarverseCalendar.getCurrentDate(),'1748-04-06');
    h.files[0].metadata.DR_end='1749-01-01';h.feature.ready=h.feature.refresh();await h.feature.ready;
    assert.equal(h.globals.TaelgarverseCalendar.getCurrentDate(),'1748-04-06','session edits do not move the custom date');
    await h.feature.selectCampaign('beta');assert.equal(h.globals.TaelgarverseCalendar.getCurrentDate(),'1715-05-02');
    await h.feature.selectCampaign('custom');assert.equal(h.globals.TaelgarverseCalendar.getCurrentDate(),'1748-04-06');
    saved={...h.plugin.settings};
  }finally{h.feature.unload();}
  const reopened=host(saved);
  try{await reopened.feature.ready;assert.equal(reopened.globals.TaelgarverseCalendar.getCurrentDate(),'1748-04-06');}
  finally{reopened.feature.unload();}
});

test('unavailable active dates remain explicit while other campaigns and moon browsing remain available',async()=>{
  const h=host();await h.feature.ready;
  h.files[0].metadata.DR=null;delete h.files[0].metadata.DR_end;h.feature.ready=h.feature.refresh();await h.feature.ready;
  assert.throws(()=>h.globals.TaelgarverseCalendar.getCurrentDate(),/no full DR date/);
  const data=await h.feature.data();assert.equal(data.context,null);assert.match(data.error,/no full DR date/);assert.equal(data.campaigns.find(c=>c.id==='beta').available,true);
  h.feature.unload();
  const pending=host();pending.feature.unload();await pending.feature.ready;assert.equal(pending.globals.TaelgarverseCalendar,undefined);
});

test('switching campaigns with an open calendar cannot deadlock its date provider',async()=>{
  const h=host();let rendering;
  try{
    await h.feature.ready;
    h.feature.views.add({calendar:{refresh(){rendering=h.feature.data();return rendering;},dispose(){}}});
    await Promise.race([h.feature.selectCampaign('beta'),pause(800).then(()=>{throw new Error('Context refresh deadlocked');})]);
    assert.equal((await rendering).context.id,'beta');
    h.feature.ready=h.feature.refresh();await h.feature.ready;assert.equal((await rendering).context.date,'1715-05-02');
  }finally{h.feature.unload();}
});
