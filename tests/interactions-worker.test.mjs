import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {parseHTML} from 'linkedom';
import {ROOT,loadSettings,isInside} from '../src/config.mjs';
import {Engine} from '../src/engine.mjs';
import {prepareContent} from '../scripts/prepare-cloudflare.mjs';
import {buildFingerprint} from '../scripts/publish-content.mjs';
import {loadSnapshot} from '../src/snapshot.mjs';
import {createWorker} from '../src/worker-handler.mjs';

test('publication compiles authoritative Short beats, Worker matches Node without session-body reads, and older snapshots retain campaign references',async()=>{
  fs.mkdirSync(path.join(ROOT,'.cache'),{recursive:true});
  const directory=fs.mkdtempSync(path.join(ROOT,'.cache','interaction-worker-'));
  try {
    const original=loadSettings(),vault=path.join(directory,'vault');fs.mkdirSync(vault);
    fs.mkdirSync(path.join(vault,'_scripts'));
    fs.mkdirSync(path.join(vault,'.obsidian'));
    fs.copyFileSync(path.join(original.vault_dir,'.obsidian','metadata.json'),path.join(vault,'.obsidian','metadata.json'));
    fs.writeFileSync(path.join(vault,'_scripts','session_note_campaigns.json'),JSON.stringify({campaigns:{cleenseau:{code:'clee',name:'Cleenseau',aliases:[],partyPage:'Party',campaignRoot:'Campaigns/Clee'},other:{code:'other',name:'Other',campaignRoot:'Campaigns/Other'}}}));
    fs.writeFileSync(path.join(vault,'Person.md'),'---\nheaderVersion: 2023.11.25\ntags: [person]\nname: Person\nspecies: human\nwhereabouts: Inn\nknownTo: [clee]\ncampaignInfo: [{campaign: clee, date: 1720-01-01, type: fought alongside}]\n---\n<!-- taelgar:header -->\n\nPerson biography.');
    fs.writeFileSync(path.join(vault,'Party.md'),'# Party');fs.writeFileSync(path.join(vault,'Inn.md'),'# Inn');
    fs.writeFileSync(path.join(vault,'World.md'),'# World\n[[Person]]');
    fs.mkdirSync(path.join(vault,'Campaigns','Clee'),{recursive:true});
    fs.writeFileSync(path.join(vault,'Campaigns','Clee','Handout.md'),'---\ntags: [source]\n---\n# Handout\n[[Person]]');
    fs.writeFileSync(path.join(vault,'Campaigns','Clee','Story.md'),'---\ntags: [source, story]\n---\n[[Person]]');
    fs.mkdirSync(path.join(vault,'Campaigns','Other'),{recursive:true});
    fs.writeFileSync(path.join(vault,'Campaigns','Other','Other Handout.md'),'---\ntags: [source]\n---\n[[Person]]');
    for(const [name,tags] of [['Untagged',''],['List of NPCs','tags: [source, meta]'],['Background','tags: [background/lore]']])
      fs.writeFileSync(path.join(vault,'Campaigns','Clee',name+'.md'),'---\n'+tags+'\n---\n[[Person]]');
    fs.writeFileSync(path.join(vault,'Session.md'),'---\ntags: [session-note]\ncampaign: Cleenseau\nsessionNumber: 12.1\nDR: 1720-01-01\nDR_end: 1720-01-02\n---\n# Session\n\nThe party met [[Person]] at the inn.\n\n%%^Campaign:none%%\nPerson showed them a hidden room.\n%%^End%%');
    const cleaned=path.join(vault,'_sessions','cleenseau','cleenseau-012.1','cleaned');fs.mkdirSync(cleaned,{recursive:true});
    const recap=['# Session Recap','## Session Header','- Campaign: Cleenseau','- Session Number: 12.1','## Recap',
      '### recap-001 | At the Inn','- Date: 1720-01-01','- NPCs: Person, Unpublished Unresolved Person','- Source Range: u0001 -> u0020','- Polished Transcript: beat-transcripts/public.md','#### Short','An authoritative Short independent of generated prose.','#### Long','Unused Long narrative.',
      '### recap-002 | Hidden Room','- Date: 1720-01-02','- NPCs: Person','- Polished Transcript: beat-transcripts/secret.md','#### Short','%%^Campaign:none%%Person showed them a hidden room.%%^End%%','#### Long','Unused secret Long narrative.',
      '## Cast','### NPCs','- Person (met): innkeeper','## Source Files','- Cleaned Source: /private/transcript.md'].join('\n');
    const recapFile=path.join(cleaned,'cleenseau-012.1-session-recap.md');fs.writeFileSync(recapFile,recap);
    fs.writeFileSync(path.join(cleaned,'cleenseau-012.1-source-cleaned.md'),'UNPUBLISHED PRIVATE TRANSCRIPT');
    fs.mkdirSync(path.join(cleaned,'beat-transcripts'));
    const transcript='# Beat\n- Source Transcript: /private/cleaned-source.md\n## Transcript\n%% u0001-u0020 %%\nPerson: POLISHED PUBLIC CONVERSATION.\n\n%%^Campaign:none%%Person: DM ONLY DETAIL.%%^End%%';
    fs.writeFileSync(path.join(cleaned,'beat-transcripts','public.md'),transcript);
    fs.writeFileSync(path.join(cleaned,'beat-transcripts','secret.md'),transcript.replace('POLISHED PUBLIC CONVERSATION','POLISHED SECRET CONVERSATION'));
    fs.writeFileSync(path.join(cleaned,'beat-transcripts','unreferenced.md'),'UNREFERENCED TRANSCRIPT');
    const settings={...original,vault_dir:vault,source_dir:vault,nav_source:null,home_source:null,campaigns:[]};
    const before=buildFingerprint(settings,{});
    fs.writeFileSync(path.join(cleaned,'beat-transcripts','public.md'),transcript+' Changed words.');
    assert.notEqual(buildFingerprint(settings,{}),before);
    fs.writeFileSync(path.join(cleaned,'beat-transcripts','public.md'),transcript);
    fs.writeFileSync(recapFile,recap.replace('At the Inn','At the Tavern'));
    assert.notEqual(buildFingerprint(settings,{}),before);
    fs.writeFileSync(recapFile,recap.replace('/private/transcript.md','D:/another/machine/transcript.md'));
    assert.equal(buildFingerprint(settings,{}),before);
    fs.writeFileSync(recapFile,recap.replace('Unused Long narrative.','An edited Long narrative.'));
    assert.equal(buildFingerprint(settings,{}),before);
    fs.writeFileSync(recapFile,recap);
    const report=await prepareContent(settings,path.join(directory,'package'),{commit:'fixture',dirty:false});
    const raw=fs.readFileSync(report.indexFile,'utf8'),index=JSON.parse(raw);
    assert.equal(index.interactions.version,2);
    assert.equal(index.interactions.byTarget.person.filter(event=>event.kind==='encounter').length,2);
    assert.doesNotMatch(raw,/UNPUBLISHED PRIVATE TRANSCRIPT|Unpublished Unresolved Person|\/private\/|Source Range|u0001|session-recap\.md/);
    assert.match(report.interactions.warnings.join('\n'),/Unpublished Unresolved Person/);
    assert.doesNotMatch(JSON.stringify(index.interactions),/Long narrative|The party met|Source Range|u0001/);
    assert.doesNotMatch(raw,/POLISHED PUBLIC|POLISHED SECRET|DM ONLY DETAIL|UNREFERENCED TRANSCRIPT|Source Transcript|beat-transcripts/);
    assert.equal(Object.keys(index.interactions.transcripts).length,2);
    const uploads=new Map(JSON.parse(fs.readFileSync(report.manifestFile,'utf8')).map(item=>[item.key,item.file]));
    const reads=[];
    const bucket={async get(key){reads.push(key);const file=uploads.get(key);if(!file)return null;return {json:async()=>JSON.parse(fs.readFileSync(file,'utf8'))};}};
    const node=new Engine(settings),snapshot=await loadSnapshot(bucket,report.revision);
    for(const dm of [false,true,false]) {
      reads.length=0;
      const actual=await snapshot.engine.renderAsync('Person','1720-01-02','custom',dm,['clee'],entry=>snapshot.store.getNote(entry));
      const expected=node.render('Person','1720-01-02','custom',dm,undefined,['clee']);
      assert.deepEqual(actual.interactions,expected.interactions);
      assert.deepEqual(actual.backlinks,expected.backlinks);
      assert.deepEqual(actual.backlinks.map(link=>link.page),['world']);
      assert.equal(actual.html,expected.html);
      assert.equal(actual.interactions[0].events.length,dm ? 4 : 3);
      assert.equal(actual.interactions[0].events.find(event=>event.kind==='reference').referenceType,'document');
      assert.equal(actual.interactions[0].events.find(event=>event.title==='Story').referenceType,'story');
      assert.match(actual.html,/Related campaign material/);
      const grouped=parseHTML('<html><body>'+actual.html+'</body></html>').document;
      assert.equal(grouped.querySelector('[data-reference-kind="story"] a').textContent,'Story');
      assert.equal(grouped.querySelector('[data-reference-kind="document"] a').textContent,'Handout');
      assert.ok(reads.every(key=>key.endsWith('/'+snapshot.store.resolve('Person').note.shard+'.json')),'only the person shard is loaded');
      assert.equal(actual.interactions[0].events[0].text,'An authoritative Short independent of generated prose.');
      assert.match(actual.html,/fought alongside/i); // Authored campaignInfo remains in the normal header.
      assert.match(actual.interactions[0].events[0].sessionUrl,/page\/session\?/);
      assert.match(actual.interactions[0].events[0].transcriptUrl,/campaign-transcripts\//);
    }
    const originalGet=bucket.get.bind(bucket);
    for(const campaigns of [['clee','other'],['other'],[]]) {
      reads.length=0;
      const actual=await snapshot.engine.renderAsync('Person','1720-01-02','custom',false,campaigns,entry=>snapshot.store.getNote(entry));
      const expected=node.render('Person','1720-01-02','custom',false,undefined,campaigns);
      assert.deepEqual(actual.interactions,expected.interactions);
      const intersecting=campaigns.filter(code=>code==='clee');
      assert.deepEqual(actual.interactions.map(group=>group.code),intersecting);
      assert.equal(actual.html,expected.html);
      const parsed=parseHTML('<html><body>'+actual.html+'</body></html>').document;
      assert.equal(parsed.querySelectorAll('#campaign-interactions > h2').length,intersecting.length?1:0);
      assert.equal(parsed.querySelector('#campaign-interactions select[aria-label="Campaign"]'),null);
      assert.doesNotMatch(parsed.querySelector('#campaign-interactions')?.textContent || '',/Other Handout/);
      if(!intersecting.length)assert.equal(parsed.querySelector('#campaign-interactions'),null);
    }
    const legacy=structuredClone(index);
    for(const name of ['Untagged','List of NPCs','Background']) {
      const source=node.store.lookup('Campaigns/Clee/'+name+'.md').entry.slug;
      legacy.interactions.byTarget.person.push({id:'reference:clee:'+source,campaign:'clee',source,kind:'reference',when:[{}]});
    }
    const legacySnapshot=await loadSnapshot({get:async key=>key.endsWith('/index.json') ? {json:async()=>legacy} : originalGet(key)},report.revision);
    const filtered=await legacySnapshot.engine.renderAsync('Person','1720-01-02','custom',false,['clee'],entry=>legacySnapshot.store.getNote(entry));
    assert.deepEqual(filtered.interactions[0].events.filter(event=>event.kind==='reference').map(event=>event.title),['Handout','Story']);
    const env={CONTENT:{async get(key){if(key==='published/current.json')return {json:async()=>({revision:report.revision})};return originalGet(key);}},ASSETS:{fetch:async()=>new Response('asset')}};
    const response=await createWorker().fetch(new Request('https://cleenseau.taelgar.org/api/page?page=Person'),env);
    assert.equal(response.status,404); // No configured campaign host silently falls back.
    const worker=createWorker();
    const api=await worker.fetch(new Request('https://www.taelgar.org/api/page?page=Person&context=cleenseau'),env);
    assert.equal(api.status,200);
    const result=await api.json();
    assert.equal(result.interactions[0].events.length,3);
    assert.deepEqual(result.backlinks.map(link=>link.page),['world']);
    const event=result.interactions[0].events[0];
    assert.equal((await worker.fetch(new Request('https://www.taelgar.org'+event.sessionUrl),env)).status,200);
    reads.length=0;
    const transcriptResponse=await worker.fetch(new Request('https://www.taelgar.org'+event.transcriptUrl),env);
    assert.equal(transcriptResponse.status,200);
    const html=await transcriptResponse.text();
    assert.match(html,/POLISHED PUBLIC CONVERSATION/);assert.match(html,/1720-01-01 DR/);
    assert.doesNotMatch(html,/DM ONLY DETAIL|Source Transcript|u0001|private\/|UNREFERENCED/);
    assert.ok(reads.some(key=>key.includes('/transcripts/')));
    assert.ok(reads.every(key=>!key.includes('/notes/')),'transcript view requires no article body');
    const publicId='recap:clee:12.1:recap-001',secretId='recap:clee:12.1:recap-002';
    for(const dm of [false,true]) {
      const actual=await snapshot.engine.renderTranscript(publicId,'1720-01-02','custom',dm,['clee']);
      const expected=await node.renderTranscript(publicId,'1720-01-02','custom',dm,['clee']);
      assert.equal(actual.html,expected.html);
      assert.equal(actual.html.includes('DM ONLY DETAIL'),dm);
    }
    for(const query of ['context=modern','date=1719-12-31&campaigns=clee','date=1720-01-02&campaigns=']) {
      reads.length=0;
      const denied=await worker.fetch(new Request('https://www.taelgar.org/campaign-transcripts/'+encodeURIComponent(publicId)+'?'+query),env);
      assert.equal(denied.status,404);assert.equal(reads.some(key=>key.includes('/transcripts/')),false);
    }
    const secretUrl='https://www.taelgar.org/campaign-transcripts/'+encodeURIComponent(secretId)+'?date=1720-01-02&campaigns=clee';
    assert.equal((await worker.fetch(new Request(secretUrl),env)).status,404);
    const secretResponse=await worker.fetch(new Request(secretUrl+'&dm=1'),env);
    assert.equal(secretResponse.status,200);assert.match(await secretResponse.text(),/POLISHED SECRET CONVERSATION/);
    const corrupted=await loadSnapshot({async get(key){return key.includes('/transcripts/') ? {json:async()=>({[publicId]:'changed'})} : originalGet(key);}},report.revision);
    await assert.rejects(corrupted.engine.renderTranscript(publicId,'1720-01-02','custom',false,['clee']),/does not match/);
    const old=structuredClone(index);delete old.interactions;
    const oldBucket={async get(key){return key.endsWith('/index.json') ? {json:async()=>old} : originalGet(key);}};
    const loaded=await loadSnapshot(oldBucket,report.revision);
    const fallback=await loaded.engine.renderAsync('Person','1720-01-02','custom',false,['clee'],entry=>loaded.store.getNote(entry));
    assert.equal(fallback.interactions[0].events.some(event=>event.kind==='reference'),true);
    assert.equal(fallback.interactions[0].events.length,2);
    assert.equal(fallback.interactions[0].events[0].title,'Handout');
    assert.match(fallback.html,/Related campaign material/);
    assert.doesNotMatch(fallback.html,/class="interaction-plot"/);
    assert.deepEqual(fallback.backlinks.map(link=>link.page),['world']);
    const invalid={...index,interactions:{version:99,byTarget:{}}};
    await assert.rejects(loadSnapshot({get:async()=>({json:async()=>invalid})},report.revision),/interaction index format/);
    await assert.rejects(loadSnapshot({get:async()=>({json:async()=>({...index,interactions:{version:1,byTarget:{}}})})},report.revision),/interaction index format/);
  } finally {const resolved=fs.realpathSync(directory);assert.ok(isInside(fs.realpathSync(path.join(ROOT,'.cache')),resolved));assert.ok(path.basename(resolved).startsWith('interaction-worker-'));fs.rmSync(resolved,{recursive:true});}
});
