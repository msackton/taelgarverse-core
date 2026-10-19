import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script = fs.readFileSync(new URL('../public/appearance.js',import.meta.url),'utf8');
function appearance({saved = null,dark = false,blocked = false} = {}) {
  const events = {}, root = {dataset:{}}, select = {value:'',addEventListener:(name,callback)=>{ events.select = callback; }};
  const media = {matches:dark,addEventListener:(name,callback)=>{ events.system = callback; }};
  const storage = new Map(saved ? [['taelgarverse-appearance',saved]] : []);
  let ready = false;
  vm.runInNewContext(script,{
    document:{documentElement:root,getElementById:()=>ready ? select : null,addEventListener:(name,callback)=>{ events.ready = callback; }},
    localStorage:{getItem:key=>{ if (blocked) throw Error('disabled'); return storage.get(key); },setItem:(key,value)=>{ if (blocked) throw Error('disabled'); storage.set(key,value); }},
    matchMedia:()=>media,addEventListener:(name,callback)=>{ events[name] = callback; }
  });
  return {root,select,storage,ready(){ ready=true; events.ready(); },choose(value){ events.select({target:{value}}); },system(dark){ media.matches=dark; events.system(); },sync(key,value){ events.storage({key,newValue:value}); }};
}
test('appearance defaults to the system before first paint and follows live system changes',() => {
  for (const saved of [null,'invalid']) {
    const h = appearance({saved,dark:true});
    assert.equal(h.root.dataset.appearance,'system'); assert.equal(h.root.dataset.theme,'dark');
    h.ready(); assert.equal(h.select.value,'system');
    h.system(false); assert.equal(h.root.dataset.theme,'light');
  }
});
test('manual appearance is restored before paint, persisted, and overrides system until System is chosen',() => {
  const h = appearance({saved:'dark'});
  assert.equal(h.root.dataset.theme,'dark');
  h.ready(); assert.equal(h.select.value,'dark');
  h.system(false); assert.equal(h.root.dataset.theme,'dark');
  h.choose('light'); assert.equal(h.storage.get('taelgarverse-appearance'),'light');
  h.system(true); assert.equal(h.root.dataset.theme,'light');
  h.choose('system'); assert.equal(h.root.dataset.theme,'dark');
  assert.equal(h.storage.get('taelgarverse-appearance'),'system');
});
test('appearance remains usable with blocked storage and synchronizes across tabs',() => {
  const blocked = appearance({blocked:true}); blocked.ready(); blocked.choose('dark');
  assert.equal(blocked.root.dataset.theme,'dark');
  const h = appearance({dark:true}); h.ready();
  h.sync('unrelated','light'); assert.equal(h.root.dataset.theme,'dark');
  h.sync('taelgarverse-appearance','light'); assert.equal(h.select.value,'light');
  h.sync(null,null); assert.equal(h.select.value,'system'); assert.equal(h.root.dataset.theme,'dark');
});
