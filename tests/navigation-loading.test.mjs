import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';

const script=await fs.readFile(new URL('../public/navigation.js',import.meta.url),'utf8');
test('navigation body timeouts clear busy state, offer retry and ignore the stale completion',async()=>{
  const {document}=parseHTML('<details data-nav-url="/api/navigation?branch=world"><ul data-nav-children data-loaded="false"><li><a href="/browse/world">Browse</a></li></ul></details>');
  const details=document.querySelector('details'),children=document.querySelector('ul'),requests=[],timers=new Map();let id=0;
  details.open=true;
  const context=vm.createContext({document,AbortController,
    fetch:async(url,{signal})=>({ok:true,json:()=>new Promise(resolve=>requests.push({signal,resolve}))}),
    setTimeout:(callback,ms)=>{assert.equal(ms,12000);timers.set(++id,callback);return id;},clearTimeout:key=>timers.delete(key),
  });
  vm.runInContext(script,context);context.details=details;
  const pending=vm.runInContext('loadBranch(details)',context);
  await Promise.resolve();assert.equal(children.getAttribute('aria-busy'),'true');
  [...timers.values()][0]();await pending;
  assert.equal(children.hasAttribute('aria-busy'),false);assert.equal(timers.size,0);
  assert.equal(requests[0].signal.aborted,true);assert.equal(children.querySelector('button').textContent,'Retry loading');
  const retry=vm.runInContext('loadBranch(details)',context);await new Promise(resolve=>setImmediate(resolve));
  requests[1].resolve({html:'<li>Current branch</li>'});await retry;
  requests[0].resolve({html:'<li>Stale branch</li>'});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(children.dataset.loaded,'true');assert.equal(children.textContent,'Current branch');
  assert.equal(children.hasAttribute('aria-busy'),false);assert.equal(timers.size,0);
});
