import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import YAML from 'yaml';
import {parseHTML} from 'linkedom';
import {ContentStore,parseNote} from '../src/content-store.mjs';
import {targetPath} from '../src/common.mjs';
import {readInteractionBundles} from '../src/session-interactions.mjs';
import {compileInteractionIndex,campaignInteractions} from '../src/campaign-interactions.mjs';
import {interactionView,interactionSummary} from '../src/interaction-view.mjs';
import {mountInteractions} from '../src/browser/interactions.mjs';
import {prepareContent} from '../scripts/prepare-cloudflare.mjs';
import {buildFingerprint} from '../scripts/publish-content.mjs';
import {loadSnapshot} from '../src/snapshot.mjs';
import {Engine} from '../src/engine.mjs';
import {ROOT} from '../src/config.mjs';
import {testSettings} from './helpers/test-settings.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const stable=value=>value && typeof value==='object' ? Array.isArray(value) ? value.map(stable) : Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])) : value;
const registry={campaigns:{trial:{code:'trial',name:'Trial',sessionRoot:'trial',campaignRoot:'Campaigns/Trial',notePattern:'Session {session_padded}.md'}}};
const ctx=(date='1720-01-03',dm=false)=>({date,campaigns:['trial'],dm});
function fixture() {
  fs.mkdirSync(path.join(ROOT,'.cache'),{recursive:true});
  const root=fs.mkdtempSync(path.join(ROOT,'.cache','mapped-interactions-'));
  const prefix='_sessions/trial/trial-002/cleaned/trial-002';
  const write=(key,value)=>{const file=path.join(root,key);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);};
  const metadata={campaign:'Trial',drEnd:'1720-01-03',drStart:'1720-01-01',scope:'session',sessionNumber:2,sourceType:'transcript',transcriptProcessing:{artifacts:{polishedMarkdown:{path:'cleaned/trial-002-transcript.md',sha256:hash('PRIVATE FULL TRANSCRIPT')}}}};
  write(prefix+'-session.yaml',YAML.stringify(metadata));write(prefix+'-transcript.md','PRIVATE FULL TRANSCRIPT');
  const map={schemaVersion:4,sessionYaml:prefix+'-session.yaml',inputs:{sessionInputs:{sessionYamlDigest:hash(JSON.stringify(stable(metadata))),sources:{'transcriptProcessing.artifacts.polishedMarkdown':hash('PRIVATE FULL TRANSCRIPT')}}},entities:[
    {id:'e1',kind:'npc',label:'Person',note:'Person.md',importance:'star'},
    {id:'e2',kind:'divine',label:'Power',note:'Power.md',importance:'supporting'},
    {id:'e3',kind:'item',label:'Relic',note:'Relic.md',importance:'cameo',examinedInMirrorOfPast:true},
    {id:'e4',kind:'organization',label:'Guild',note:'Guild.md',importance:'supporting'},
    {id:'e5',kind:'npc',label:'Unresolved',note:null,importance:'cameo'}]};
  const saveMap=()=>write(prefix+'-entity-map.json',JSON.stringify(map));saveMap();
  const exchange=(id,entity,action,title)=>({id,title,entities:[{id:entity,action,role:'star'}],source:{startUid:'u0001',endUid:'u0002'},reviewContext:{before:['PRIVATE BEFORE CONTEXT'],after:['PRIVATE AFTER CONTEXT']},review:{confidence:'low',status:'unreviewed',reason:'PRIVATE REVIEW REASON'},lines:['%% u0001:0-20 %%','Person: Hello <img src=x onerror=alert(1)>.', '%% omitted private source text %% ((A pause))','%%^Campaign:none%%DM: HIDDEN PASSAGE.%%^End%%']});
  const interactions={schemaVersion:1,sessionYaml:map.sessionYaml,inputs:{entityMap:{path:prefix+'-entity-map.json',sha256:hash(JSON.stringify(map))},transcript:{sourceId:'transcriptProcessing.artifacts.polishedMarkdown',sha256:hash('PRIVATE FULL TRANSCRIPT')}},interactions:[
    exchange('i1','e1','interacted','Talking with Person'),exchange('i2','e2','mentioned','Discussing Power'),exchange('i3','e3','observed','Examining Relic')]};
  const saveInteractions=()=>write(prefix+'-interactions.json',JSON.stringify(interactions));saveInteractions();
  const notes={'Person.md':'---\ntags: [person]\nknownTo: [trial]\n---\n# Person',
    'Power.md':'---\ntags: [deity]\nknownTo: [trial]\n---\n# Power','Relic.md':'---\ntags: [item]\nknownTo: [trial]\n---\n# Relic',
    'Guild.md':'---\ntags: [organization]\nknownTo: [trial]\n---\n# Guild',
    'Campaigns/Trial/Session 02.md':'---\ntags: [session-note]\ncampaign: Trial\nsessionNumber: 2\nDR: 1720-01-01\nDR_end: 1720-01-03\ndescTitle: Official title\n---\n[[Person]]'};
  for(const [key,value] of Object.entries(notes))write(key,value);
  const store=new ContentStore(Object.entries(notes).map(([id,value])=>({id,note:parseNote(value),slug:targetPath(id).slice(0,-3),target:targetPath(id),name:path.basename(id,'.md'),title:path.basename(id,'.md')})));
  const compile=()=>{const read=readInteractionBundles({vault_dir:root});return {...read,index:compileInteractionIndex(store,registry,null,read.bundles)};};
  const events=(name='Person',context=ctx())=>campaignInteractions(compile().index,store,store.resolve(name),context,registry)[0]?.events || [];
  return {root,prefix,write,map,interactions,saveMap,saveInteractions,store,compile,events,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}

test('mapped sessions use exact notes across entity types and preserve exchange actions, visibility and passages',()=>{
  const f=fixture();try {
    assert.deepEqual(f.compile().warnings,[]);assert.deepEqual(f.compile().index.warnings,[]);
    assert.equal(f.events().length,1);assert.equal(f.events()[0].kind,'encounter');
    assert.equal(f.events('Power')[0].kind,'mention');assert.equal(f.events('Relic')[0].kind,'observation');
    assert.equal(f.events('Guild')[0].kind,'mapped-reference','mapping alone never establishes an encounter');
    assert.equal(f.events('Relic')[0].examinedInMirrorOfPast,true);
    assert.equal(f.events('Person',ctx('1720-01-02')).length,0);
    assert.equal(f.events()[0].title,'Official title');assert.match(f.events()[0].sessionUrl,/session-02/);
    assert.doesNotMatch(JSON.stringify(f.events()),/HIDDEN PASSAGE|u0001|PRIVATE|omitted private/);
    assert.match(f.events('Person',ctx('1720-01-03',true))[0].exchanges[0].passage,/HIDDEN PASSAGE/);
    assert.match(f.events()[0].exchanges[0].passage,/\(\(A pause\)\)/);
    const groups=campaignInteractions(f.compile().index,f.store,f.store.resolve('Power'),ctx(),registry);
    assert.match(interactionSummary(groups),/1 mention/);assert.doesNotMatch(interactionSummary(groups),/encounter/);
    const doc=parseHTML('<html><body>'+interactionView(groups)+'</body></html>').document;
    assert.match(doc.querySelector('.interaction-fallback').textContent,/Discussing Power/);
    assert.equal(doc.querySelector('img'),null,'passages are escaped text');
    const root=doc.querySelector('[data-interaction-campaign]');mountInteractions(root);root.querySelector('.interaction-dot').click();
    assert.match(root.querySelector('.interaction-detail').textContent,/Mentioned/);
    assert.match(root.querySelector('.interaction-detail .interaction-passage').textContent,/Person: Hello/);
    assert.doesNotMatch(root.querySelector('.interaction-detail').textContent,/HIDDEN|PRIVATE/);
    assert.equal(root.querySelector('img'),null);
    f.map.entities[0].note='Elsewhere/Person.md';f.saveMap();f.interactions.inputs.entityMap.sha256=hash(JSON.stringify(f.map));f.saveInteractions();
    assert.equal(f.events().length,0,'exact mapped paths cannot fall back to a basename');
  } finally {f.close();}
});

test('stale, malformed and orphan maps suppress legacy evidence, and map-only sessions remain records',()=>{
  const f=fixture();try {
    f.write(f.prefix+'-session-recap.md','# Session Recap\n## Session Header\n- Campaign: Trial\n- Session Number: 2\n## Cast\n### NPCs\n- Person (met): friend');
    for(const mutate of [()=>{f.interactions.inputs.entityMap.sha256='0'.repeat(64);f.saveInteractions();},
      ()=>{f.interactions.interactions[0].entities[0].id='missing';f.saveInteractions();},
      ()=>{f.write(f.prefix+'-transcript.md','changed transcript');}]) {
      const original=JSON.stringify(f.interactions);mutate();
      assert.equal(f.events().length,0);assert.ok(f.compile().warnings.length);
      Object.assign(f.interactions,JSON.parse(original));f.saveInteractions();f.write(f.prefix+'-transcript.md','PRIVATE FULL TRANSCRIPT');
    }
    fs.unlinkSync(path.join(f.root,f.prefix+'-interactions.json'));
    assert.equal(f.events()[0].kind,'mapped-reference');
    f.map.inputs.sessionInputs.sessionYamlDigest='0'.repeat(64);f.saveMap();assert.equal(f.events().length,0);
    fs.unlinkSync(path.join(f.root,f.prefix+'-entity-map.json'));f.saveInteractions();assert.equal(f.events().length,0);
  } finally {f.close();}
});

test('shared canonical targets deduplicate exchanges and hidden titles cannot establish encounters',()=>{
  const f=fixture();try {
    f.map.entities[1].note='Person.md';f.saveMap();
    f.interactions.inputs.entityMap.sha256=hash(JSON.stringify(f.map));
    f.interactions.interactions[0].entities.push({id:'e2',role:'supporting',action:'mentioned'});
    f.interactions.interactions[0].title='%%^Campaign:none%%Private exchange%%^End%%';
    f.interactions.interactions[1].entities[0].action='present';f.saveInteractions();
    const event=f.events()[0];assert.equal(event.kind,'presence');
    assert.equal(event.exchanges.length,1);assert.equal(event.exchanges[0].title,'Discussing Power');
    const dm=f.events('Person',ctx('1720-01-03',true))[0];assert.equal(dm.kind,'encounter');
    assert.equal(dm.exchanges.length,2);assert.equal(dm.exchanges[0].action,'interacted');
    assert.equal(dm.exchanges[0].role,'star');assert.equal(dm.importance,'star');
  } finally {f.close();}
});

test('publication and Worker preserve mapped passages without publishing source or review artifacts',async()=>{
  const f=fixture();try {
    const original=testSettings();f.write('_scripts/session_note_campaigns.json',JSON.stringify(registry));
    f.write('.obsidian/metadata.json',fs.readFileSync(path.join(original.vault_dir,'.obsidian/metadata.json')));
    const settings={...original,vault_dir:f.root,source_dir:f.root,nav_source:null,home_source:null};
    const before=buildFingerprint(settings,{});
    f.interactions.interactions[0].reviewContext.before=['DIFFERENT PRIVATE REVIEW'];f.saveInteractions();
    assert.equal(buildFingerprint(settings,{}),before,'review context does not change public inputs');
    f.interactions.interactions[0].lines.push('Person: Added retained speech.');f.saveInteractions();
    assert.notEqual(buildFingerprint(settings,{}),before,'retained passages invalidate publication');
    const report=await prepareContent(settings,path.join(f.root,'package'),{commit:'fixture',dirty:false});
    const raw=fs.readFileSync(report.indexFile,'utf8');
    assert.doesNotMatch(raw,/PRIVATE FULL TRANSCRIPT|PRIVATE BEFORE|PRIVATE AFTER|PRIVATE REVIEW|omitted private|u0001/);
    const uploads=new Map(JSON.parse(fs.readFileSync(report.manifestFile,'utf8')).map(item=>[item.key,item.file]));
    const reads=[],bucket={async get(key){reads.push(key);const file=uploads.get(key);return file ? {json:async()=>JSON.parse(fs.readFileSync(file,'utf8'))} : null;}};
    const snapshot=await loadSnapshot(bucket,report.revision),node=new Engine(settings);
    for(const dm of [false,true]) {
      reads.length=0;
      const expected=node.render('Power','1720-01-03','custom',dm,undefined,['trial']);
      const actual=await snapshot.engine.renderAsync('Power','1720-01-03','custom',dm,['trial'],entry=>snapshot.store.getNote(entry));
      assert.deepEqual(actual.interactions,expected.interactions);assert.equal(actual.html,expected.html);
      assert.ok(reads.every(key=>key.endsWith('/'+snapshot.store.resolve('Power').note.shard+'.json')));
      assert.equal(actual.interactions[0].events[0].kind,'mention');
      if(!dm)assert.doesNotMatch(actual.html,/HIDDEN PASSAGE/);
    }
  } finally {f.close();}
});
