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
import {compileRuntime} from '../scripts/compile-runtime.mjs';
import {openSnapshot} from '../src/runtime-snapshot.mjs';

test('publication compiles session encounters without beat data, Worker matches Node without session-body reads, and older snapshots retain campaign references',async()=>{
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
    fs.writeFileSync(path.join(vault,'Session.md'),'---\ntags: [session-note]\ncampaign: Cleenseau\nsessionNumber: 12.1\nDR: 1720-01-01\nDR_end: 1720-01-02\ndescTitle: Full session title\ntagline: A full-session description. %%^Campaign:none%%DM session detail.%%^End%%\n---\n# Session\n\nThe party met [[Person]] at the inn.\n\n%%^Campaign:none%%\nPerson showed them a hidden room.\n%%^End%%');
    fs.writeFileSync(path.join(vault,'Campaigns','Clee','Older session.md'),'---\ntags: [session-note]\ncampaign: Cleenseau\nsessionNumber: 13\nDR: 1720-01-03\n---\n%%^Campaign:other%%[[Person]]%%^End%%\nSESSION PROSE NOT COMPILED');
    const cleaned=path.join(vault,'_sessions','cleenseau','cleenseau-012.1','cleaned');fs.mkdirSync(cleaned,{recursive:true});
    const recap=['# Session Recap','## Session Header','- Campaign: Cleenseau','- Session Number: 12.1','- Desc Title: At the Inn','- DR Date: 1720-01-01 to 1720-01-02','- Tagline: Session tagline fallback.','## Recap',
      '### recap-001 | At the Inn','- Date: 1720-01-01','- NPCs: Person, Unpublished Unresolved Person','- Source Range: u0001 -> u0020','- Polished Transcript: beat-transcripts/public.md','#### Short','An authoritative Short independent of generated prose.','#### Long','Unused Long narrative.',
      '### recap-002 | Hidden Room','- Date: 1720-01-02','- NPCs: Person','- Polished Transcript: beat-transcripts/secret.md','#### Short','%%^Campaign:none%%Person showed them a hidden room.%%^End%%','#### Long','Unused secret Long narrative.',
      '## Cast','### NPCs','- Person (met): innkeeper','- Unpublished Unresolved Person (met): unknown','## Source Files','- Cleaned Source: /private/transcript.md'].join('\n');
    const recapFile=path.join(cleaned,'cleenseau-012.1-session-recap.md');fs.writeFileSync(recapFile,recap);
    fs.writeFileSync(path.join(cleaned,'cleenseau-012.1-source-cleaned.md'),'UNPUBLISHED PRIVATE TRANSCRIPT');
    fs.mkdirSync(path.join(cleaned,'beat-transcripts'));
    const transcript='# Beat\n- Source Transcript: /private/cleaned-source.md\n## Transcript\n%% u0001-u0020 %%\nPerson: POLISHED PUBLIC CONVERSATION.\n\n%%^Campaign:none%%Person: DM ONLY DETAIL.%%^End%%';
    fs.writeFileSync(path.join(cleaned,'beat-transcripts','public.md'),transcript);
    fs.writeFileSync(path.join(cleaned,'beat-transcripts','secret.md'),transcript.replace('POLISHED PUBLIC CONVERSATION','POLISHED SECRET CONVERSATION'));
    fs.writeFileSync(path.join(cleaned,'beat-transcripts','unreferenced.md'),'UNREFERENCED TRANSCRIPT');
    const settings={...original,vault_dir:vault,source_dir:vault,nav_source:null,home_source:null,campaigns:[]};
    const before=buildFingerprint(settings,{});
    fs.writeFileSync(recapFile,recap.replace('Person (met)','Person (mentioned)'));
    assert.notEqual(buildFingerprint(settings,{}),before,'Cast eligibility participates in publication fingerprints');
    fs.writeFileSync(recapFile,recap);
    fs.writeFileSync(path.join(cleaned,'beat-transcripts','public.md'),transcript+' Changed words.');
    assert.equal(buildFingerprint(settings,{}),before,'transcripts are not session inputs');
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
    assert.equal(index.interactions.byTarget.person.filter(event=>event.kind==='encounter').length,1);
    assert.doesNotMatch(raw,/UNPUBLISHED PRIVATE TRANSCRIPT|Unpublished Unresolved Person|\/private\/|Source Range|u0001|session-recap\.md/);
    assert.match(report.interactions.warnings.join('\n'),/Unpublished Unresolved Person/);
    assert.doesNotMatch(JSON.stringify(index.interactions),/Long narrative|The party met|Source Range|u0001/);
    assert.doesNotMatch(raw,/POLISHED PUBLIC|POLISHED SECRET|DM ONLY DETAIL|UNREFERENCED TRANSCRIPT|Source Transcript|beat-transcripts/);
    assert.equal(Object.keys(index.interactions.transcripts).length,0);
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
      assert.equal(actual.interactions[0].events.length,3);
      assert.equal(actual.interactions[0].events.find(event=>event.kind==='reference').referenceType,'document');
      assert.equal(actual.interactions[0].events.find(event=>event.title==='Story').referenceType,'story');
      assert.match(actual.html,/Related campaign material/);
      const grouped=parseHTML('<html><body>'+actual.html+'</body></html>').document;
      assert.equal(grouped.querySelector('[data-reference-kind="story"] a').textContent,'Story');
      assert.equal(grouped.querySelector('[data-reference-kind="document"] a').textContent,'Handout');
      assert.ok(reads.every(key=>key.endsWith('/'+snapshot.store.resolve('Person').note.shard+'.json')),'only the person shard is loaded');
      assert.equal(actual.interactions[0].events[0].text,'A full-session description.'+(dm ? ' DM session detail.' : ''));
      assert.equal(actual.interactions[0].events[0].title,'Full session title');
      assert.doesNotMatch(JSON.stringify(actual.interactions),/authoritative Short|hidden room|recap-001/);
      assert.match(actual.html,/fought alongside/i); // Authored campaignInfo remains in the normal header.
      assert.match(actual.interactions[0].events[0].sessionUrl,/page\/session\?/);
      assert.equal(actual.interactions[0].events[0].transcriptUrl,undefined);
      assert.doesNotMatch(actual.html,/href="[^"]*campaign-transcripts/);
    }
    const originalGet=bucket.get.bind(bucket);
    for(const campaigns of [['clee'],['clee','other']]) {
      reads.length=0;
      const actual=await snapshot.engine.renderAsync('Person','1720-01-03','custom',false,campaigns,entry=>snapshot.store.getNote(entry));
      const expected=node.render('Person','1720-01-03','custom',false,undefined,campaigns);
      assert.deepEqual(actual.interactions,expected.interactions);
      const sessions=actual.interactions[0].events.filter(event=>event.kind==='session-reference');
      assert.equal(sessions.length,campaigns.includes('other')?1:0);
      if(sessions.length)assert.match(sessions[0].sessionUrl,/older-session/);
      assert.ok(reads.every(key=>key.endsWith('/'+snapshot.store.resolve('Person').note.shard+'.json')),'fallbacks require no Worker session-body reads');
    }
    assert.doesNotMatch(JSON.stringify(index.interactions),/SESSION PROSE NOT COMPILED/);
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
    const transcriptResponse=await worker.fetch(new Request('https://www.taelgar.org/campaign-transcripts/'+encodeURIComponent('recap:clee:12.1:recap-001')+'?date=1720-01-02&campaigns=clee&person=person'),env);
    assert.equal(transcriptResponse.status,404);
    assert.equal(reads.some(key=>key.includes('/transcripts/')),false);
    assert.equal([...uploads.keys()].some(key=>key.includes('/transcripts/')),false,'new snapshots contain no transcript shards');
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
    const oldRuntime=compileRuntime(old,node.store);
    const oldCompiled=await openSnapshot({async get(key){
      if(key.endsWith('/runtime.json'))return {json:async()=>({...oldRuntime.manifest,revision:report.revision})};
      const relative=key.slice(('revisions/'+report.revision+'/').length),json=oldRuntime.objects.get(relative);
      return json ? {text:async()=>json} : originalGet(key);
    }},report.revision);
    const {engine:oldEngine,store:oldStore}=await oldCompiled.renderer();
    const oldResult=await oldEngine.renderAsync('Person','1720-01-02','custom',false,['clee'],entry=>oldStore.getNote(entry));
    assert.deepEqual(oldResult.interactions,fallback.interactions,'older compiled publications retain non-session references using only the target backlink shard');
    const invalid={...index,interactions:{version:99,byTarget:{}}};
    await assert.rejects(loadSnapshot({get:async()=>({json:async()=>invalid})},report.revision),/interaction index format/);
    await assert.rejects(loadSnapshot({get:async()=>({json:async()=>({...index,interactions:{version:1,byTarget:{}}})})},report.revision),/interaction index format/);
  } finally {const resolved=fs.realpathSync(directory);assert.ok(isInside(fs.realpathSync(path.join(ROOT,'.cache')),resolved));assert.ok(path.basename(resolved).startsWith('interaction-worker-'));fs.rmSync(resolved,{recursive:true});}
});
