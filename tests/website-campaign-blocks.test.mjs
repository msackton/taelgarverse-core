import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {load} from 'cheerio';
import {prepareContent} from '../scripts/prepare-cloudflare.mjs';
import {ROOT} from '../src/config.mjs';
import {Engine} from '../src/engine.mjs';
import {createWorker} from '../src/worker-handler.mjs';
import {Bucket} from './helpers/page-cache-fixture.mjs';
import {fixtureVault,testSettings} from './helpers/test-settings.mjs';

const notes={
  '_sessions/campaign-registry.json':JSON.stringify({
    dufr:'Campaigns/_Index/Frontier.md',elderwood:'Campaigns/_Index/Elderwood.md',
  }),
  'Campaigns/_Index/Frontier.md':`---
name: Frontier
canon: canonical
continuity: [main]
campaignDirectory: Campaigns/Frontier
notePattern: Session {session_padded}.md
partyPage: People/PCs/Fellowship
sessionBundleDirectory: _sessions/frontier
---`,
  'Campaigns/_Index/Elderwood.md':`---
name: Elderwood Heist
canon: canonical
continuity: [taelgar-2]
---
~~~taelgar-roster
overrides:
  - {player: Ellis, character: Grove}
~~~
~~~taelgar-session
estimate:
  count: 4
  dr: {label: "About 200 years after the Godfall"}
~~~
`,
  'People/PCs/Fellowship.md':'---\nname: Fellowship\nnoPublish: true\n---',
  'People/PCs/Aster.md':'---\ntags: [person]\nplayer: Robin\naffiliations: [Fellowship]\nnoPublish: true\n---',
  'Campaigns/Frontier/Session 01.md':`---
tags: [session-note]
campaign: dufr
sessionNumber: 1
descTitle: A Day on the Frontier
DR: 1748-03-22
DR_end: 1748-03-23
players: [Aster]
noPublish: true
---
Unpublished narrative.
`,
  'Unrelated/Session 01.md':'# An unrelated public session',
  '_sessions/frontier/frontier-001/cleaned/frontier-001-session.yaml':`sourceType: transcript
scope: session
realWorldDate: "2025-01-01"
drStart: "1748-03-22"
`,
  '_sessions/frontier/frontier-001/cleaned/frontier-001-speaker-stats.json':JSON.stringify({
    speakers:[{name:'Robin',gameRole:'Aster',durationSeconds:60},{name:'Sam',gameRole:'DM',durationSeconds:60}],
  }),
  'Games.md':`# Games

~~~taelgar-roster
campaign: dufr
characterPresence: true
overrides: [{player: Secondary Roster Override}]
~~~
~~~taelgar-session
campaign: dufr
columns: [session, account, played, dr, people, evidence]
overrides: [{number: 1, played: "1999-01-01"}]
estimate: {count: 99}
~~~
~~~taelgar-roster
campaign: elderwood
~~~
~~~taelgar-session
campaign: elderwood
summary: only
~~~
`,
};

test('website renders both blocks from unpublished sources and a Taelgar-2 index',async t=>{
  const directory=await fs.mkdtemp(path.join(ROOT,'.cache','campaign-website-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const vault=path.join(directory,'vault');
  for(const [name,body] of Object.entries(notes)) {
    const target=path.join(vault,name);
    await fs.mkdir(path.dirname(target),{recursive:true});
    await fs.writeFile(target,body);
  }
  await fs.mkdir(path.join(vault,'.obsidian'));
  await fs.copyFile(path.join(fixtureVault,'.obsidian','metadata.json'),path.join(vault,'.obsidian','metadata.json'));
  const settings={...testSettings(),vault_dir:vault,source_dir:vault};
  const engine=new Engine(settings);
  const node=await engine.renderAsync('Games',undefined,'modern',false,undefined,async entry=>entry.note);
  assert.equal(engine.contexts.byId.get('elderwood')?.available ?? false,false);
  const report=await prepareContent(settings,path.join(directory,'publication'),{commit:'a'.repeat(40),dirty:false});
  const uploads=JSON.parse(await fs.readFile(report.manifestFile,'utf8'));
  const objects=await Promise.all(uploads.map(async ({key,file})=>[key,await fs.readFile(file,'utf8')]));
  const pointer=await fs.readFile(report.pointerFile,'utf8');
  const bucket=new Bucket([...objects,['published/current.json',pointer]]);
  const worker=createWorker(),env={CONTENT:bucket};
  const request=url=>worker.fetch(new Request('https://example.test'+url),env);
  const response=await request('/api/page?page=Unrelated%2FSession%2001');
  assert.equal(response.status,200);
  assert.ok(bucket.calls.every(key=>!key.startsWith('revisions/'+report.revision+'/runtime/campaigns/')));
  const page=await request('/api/page?page=Games&context=modern');
  assert.equal(page.status,200);
  const $=load((await page.json()).html);
  const preview=load(node.html);
  const blocks=doc=>doc('.taelgar-campaign-view').map((_,el)=>doc.html(el)).get();
  assert.deepEqual(blocks($),blocks(preview));
  assert.equal(blocks($).length,4);
  const frontier=$('[aria-label="Frontier play history"]');
  assert.match(frontier.text(),/A Day on the Frontier/);
  assert.match(frontier.text(),/Jan 1, 2025/);
  assert.doesNotMatch(frontier.text(),/1999|About 99/);
  assert.match(frontier.text(),/Mar 22–23, 1748 DR/);
  assert.match(frontier.text(),/Robin · Aster/);
  assert.match(frontier.text(),/Sam \(DM\)/);
  assert.equal(frontier.find('a').length,0);
  assert.match($('[aria-label="Frontier roster"]').text(),/Robin.*Aster/s);
  assert.doesNotMatch($('[aria-label="Frontier roster"]').text(),/Secondary Roster Override/);
  assert.match($('[aria-label="Elderwood Heist roster"]').text(),/Ellis.*Grove/s);
  assert.match($('[aria-label="Elderwood Heist play history"]').text(),/About 4.*About 200 years after the Godfall/s);
  assert.doesNotMatch($.html(),/Unpublished narrative/);
  for(const id of ['dufr','elderwood']) {
    assert.equal(bucket.calls.filter(key=>key.endsWith('/runtime/campaigns/'+id+'.json')).length,1);
  }
  const index=JSON.parse(await fs.readFile(report.indexFile,'utf8'));
  assert.ok(!index.entries.some(entry=>entry.id==='Campaigns/Frontier/Session 01.md'));
  for(const note of ['Campaigns/_Index/Elderwood','People/PCs/Aster']) {
    assert.equal((await request('/api/page?page='+encodeURIComponent(note))).status,404);
  }
  assert.match(await (await request('/page/games')).text(),/\/theme\/campaign-blocks\.css/);

  const legacyBucket=new Bucket([...objects.filter(([key])=>!key.endsWith('/runtime.json')),['published/current.json',pointer]]);
  const legacy=await createWorker().fetch(new Request('https://example.test/api/page?page=Games&context=modern'),{CONTENT:legacyBucket});
  assert.equal(legacy.status,200);
  assert.deepEqual(blocks(load((await legacy.json()).html)),blocks($));

  for(const note of ['Campaigns/Frontier/Session 01.md','People/PCs/Aster.md']) {
    await fs.writeFile(path.join(vault,note),notes[note].replace('noPublish: true\n',''));
  }
  const publicReport=await prepareContent(settings,path.join(directory,'published-source'),{commit:'b'.repeat(40),dirty:false});
  const publicIndex=JSON.parse(await fs.readFile(publicReport.indexFile,'utf8'));
  assert.deepEqual(publicIndex.campaignRecords,index.campaignRecords);
  const publicPreview=new Engine(settings);
  const publicPage=await publicPreview.renderAsync('Games',undefined,'modern',false,undefined,async entry=>entry.note);
  const publicHistory=load(publicPage.html)('[aria-label="Frontier play history"]');
  assert.equal(publicHistory.text(),frontier.text());
  assert.ok(publicHistory.find('a').toArray().some(link=>link.attribs.href.startsWith('/page/campaigns/frontier/session-01')));
});
