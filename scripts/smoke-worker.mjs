import assert from 'node:assert/strict';
import {Engine} from '../src/engine.mjs';
import {loadSettings} from '../src/config.mjs';
const base=(process.argv[2] || 'http://127.0.0.1:8787').replace(/\/$/,'');
const engine=new Engine(loadSettings());
const health=await fetch(base+'/health');assert.equal(health.status,200);
assert.equal((await health.json()).runtime,'cloudflare-worker');
for (const [page,date] of [['Zahara','1730-01-20'],['Zahara','1730-02-01'],['Seeker','1748-01-01'],['Melusa','1730-01-20'],['Dunmar Fellowship','1750-01-01'],['Vindristjarna','1750-01-01']]) {
  for (const dm of [false,true]) {
    const response=await fetch(base+'/api/page?'+new URLSearchParams({page,date,dm:String(dm)}));
    assert.equal(response.status,200,page);
    assert.deepEqual(await response.json(),engine.render(page,date,undefined,dm),page);
  }
  console.log('PASS '+page+' / '+date+' / both viewing preferences');
}
const article=await fetch(base+'/page/things/ships/vindristjarna?context=dunmar-frontier&dm=1');
assert.equal(article.status,200);assert.match(await article.text(),/Site navigation/);
for (const file of ['material.css','preview.css','context.js','navigation.js'])assert.equal((await fetch(base+'/theme/'+file)).status,200);
console.log('Worker smoke check passed: article parity, page shell, themes, navigation.');
