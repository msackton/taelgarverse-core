import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import YAML from 'yaml';
import {load} from 'cheerio';
import {HEADER_BLOCK,normalizeHeader} from '../src/bio-block.mjs';
import {parseNote,authoredBody} from '../src/content-store.mjs';
import {ROOT,loadSettings,isInside} from '../src/config.mjs';
import {Engine} from '../src/engine.mjs';
import {loadSnapshot} from '../src/snapshot.mjs';
import {prepareContent} from '../scripts/prepare-cloudflare.mjs';
import {vaultCases,vaultHeaderFixture} from './helpers/vault-header-fixture.mjs';

const yaml='---\nheaderVersion: 2023.11.25\ntags: [person]\ncustom: "keep this formatting" # keep comment\n---\n';
const article='\n## Biography\n\nAuthored [[First Town]] text.\n\n> [!warning] Authored callout\n> Keep this.\n\n````markdown\n```taelgar-header\n```\n````\n';
const forms={
  canonical:HEADER_BLOCK,
  marker:'<!-- taelgar:header -->\n',
  'hyphen marker':'<!-- taelgar-header -->\n',
  'materializer marker and block':'<!-- taelgar:header -->\n\n'+HEADER_BLOCK,
  'saved title and block':'# Old saved title\n\n'+HEADER_BLOCK,
  'marker, saved title and block':'<!-- taelgar:header -->\n\n# Old saved title\n'+HEADER_BLOCK,
  'saved generated header':'# Old saved title\n*(OLD)*\n>[!info]+ Biographical Info\n> A human.\n> `$=dv.view("_scripts/view/get_PageDatedValue")`\n>> `$=dv.view("_scripts/view/get_Whereabouts")`\n',
  'title-only generated header':'# Old saved title\n',
  'older quoted generated header':'# Old saved title\n> Stale header details with [[First Town]].\n',
  'older linked generated header':'# Old saved title\n[[First Town]]\n',
  'tilde fence':'~~~taelgar-header\n\n~~~~\n',
};

for(const [name,header] of Object.entries(forms))test('preparation normalizes '+name+' without changing frontmatter or authored content',()=>{
  const note=parseNote(yaml+header+article),before=structuredClone(note);
  const result=normalizeHeader(note);
  assert.equal(result.source,yaml+HEADER_BLOCK+article);
  assert.equal(result.body,HEADER_BLOCK+article);
  assert.equal(authoredBody(result),article);
  assert.deepEqual(note,before,'input remains unchanged');
  assert.strictEqual(normalizeHeader(result),result,'second pass is unchanged');
  assert.deepEqual(parseNote(result.source),result,'parsed and serialized note agree');
});

test('header detection preserves adjacent prose, authored callouts, and all later headings and examples',()=>{
  for(const suffix of ['Opening paragraph.\n\n## Details\nBody.\n','> [!warning] Keep this callout\n> Text.\n',article]){
    const result=normalizeHeader(parseNote(yaml+'# Old title\n'+suffix));
    assert.ok(result.body.endsWith(suffix));
    assert.equal(result.body,HEADER_BLOCK+(suffix.startsWith('\n')?'':'\n')+suffix);
  }
  const legacy=yaml+'# Old title\n>[!info]+ Information\n> Old detail\n> [!warning] Authored\n> Keep.\n';
  assert.equal(normalizeHeader(parseNote(legacy)).body,HEADER_BLOCK+'\n> [!warning] Authored\n> Keep.\n');
});

test('unversioned titles and ordinary code examples are not treated as generated headers',()=>{
  for(const source of [
    '# Authored title\n>[!info] Authored details\n',
    '---\ntags: [person]\n---\n# Authored title\n\nProse.\n',
    yaml+'Opening paragraph.\n\n'+HEADER_BLOCK,
    yaml+'````markdown\n'+HEADER_BLOCK+'````\n',
    yaml+'    ```taelgar-header\n    ```\n',
  ]){
    const note=parseNote(source);assert.strictEqual(normalizeHeader(note),note);
  }
});

test('canonical blocks need no frontmatter or headerVersion; empty notes and CRLF exports are supported',()=>{
  assert.equal(normalizeHeader(parseNote('<!-- taelgar:header -->')).source,HEADER_BLOCK);
  assert.equal(normalizeHeader(parseNote(yaml+'# Old title')).source,yaml+HEADER_BLOCK);
  assert.equal(normalizeHeader(parseNote((yaml+forms['saved generated header']+article).replaceAll('\n','\r\n'))).source,yaml+HEADER_BLOCK+article);
  const note=parseNote(HEADER_BLOCK+article);assert.strictEqual(normalizeHeader(note),note);
  assert.equal(normalizeHeader(parseNote('# Stale title\n'+HEADER_BLOCK+article)).source,HEADER_BLOCK+article);
});

test('invalid explicit header blocks fail preparation instead of being silently removed',()=>{
  for(const prefix of ['', '# Old title\n', '<!-- taelgar:header -->\n\n']){
    assert.throws(()=>normalizeHeader(parseNote(yaml+prefix+'```taelgar-header\n')),/Close/);
    assert.throws(()=>normalizeHeader(parseNote(yaml+prefix+'```taelgar-header\nUnexpected settings\n```\n')),/empty/);
  }
});

test('all 21 vault cases package to one format and render one complete header in Node and R2 snapshots',async()=>{
  const directory=fs.mkdtempSync(path.join(ROOT,'.cache/header-preparation-'));
  try{
    const source=path.join(directory,'vault'),output=path.join(directory,'package');
    fs.mkdirSync(path.join(source,'.obsidian'),{recursive:true});
    fs.mkdirSync(path.join(source,'_scripts'));
    fs.writeFileSync(path.join(source,'.obsidian/metadata.json'),JSON.stringify(vaultCases.coreMeta));
    fs.writeFileSync(path.join(source,'_scripts/session_note_campaigns.json'),JSON.stringify(vaultCases.registry));
    const fixture=vaultHeaderFixture(),originals=new Map(),caseByPath=new Map(vaultCases.cases.map((example,i)=>[example.path,i]));
    for(const page of vaultCases.pages){
      const index=caseByPath.get(page.path),frontmatter='---\n'+YAML.stringify(page.metadata)+'---\n';
      let header='';
      if(index!==undefined){
        const variants=[parseNote(fixture.render(page.path,{headerType:'static'})).body.trimEnd()+'\n',
          forms.marker,forms.canonical,forms['saved title and block'],forms['materializer marker and block'],forms['hyphen marker']];
        header=variants[index%variants.length];
      }
      const text=frontmatter+header+article,file=path.join(source,page.path);
      fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);originals.set(page.path,text);
    }
    const settings={...loadSettings(),vault_dir:source,source_dir:source,nav_source:null,home_source:null,respect_pov_dates:false};
    const report=await prepareContent(settings,output,{commit:'a'.repeat(40),dirty:false});
    const uploads=JSON.parse(fs.readFileSync(report.manifestFile,'utf8'));
    const objects=new Map(uploads.map(item=>[item.key,item.file]));
    const remote=await loadSnapshot({get:async key=>objects.has(key)?{json:async()=>JSON.parse(fs.readFileSync(objects.get(key),'utf8'))}:null},report.revision);
    const local=new Engine(settings);
    for(const example of vaultCases.cases){
      const entry=remote.store.entries.find(e=>e.id===example.path),packed=await remote.store.getNote(entry);
      assert.equal(packed.body,HEADER_BLOCK+article,example.path);
      assert.deepEqual(packed.metadata,parseNote(originals.get(example.path)).metadata,example.path);
      assert.equal(entry.note.sha256,createHash('sha256').update(packed.source).digest('hex'));
      for(const date of ['1752-01-01','1760-01-01']){
        const actual=await remote.engine.renderAsync(entry.slug,date,undefined,false,undefined,e=>remote.store.getNote(e));
        const expected=local.render(entry.slug,date);
        assert.equal(actual.html,expected.html,example.path+' / '+date);
        const $=load(actual.html);
        assert.equal($('h1').length,1,example.path);
        assert.equal($('code.language-taelgar-header').length,0,example.path);
        assert.equal($('h2').text(),'Biography');
        assert.match(actual.html,/Authored callout/);
      }
    }
    for(const [file,text] of originals)assert.equal(fs.readFileSync(path.join(source,file),'utf8'),text,'vault source unchanged: '+file);
    fs.writeFileSync(path.join(source,vaultCases.cases[0].path),yaml+'```taelgar-header\ninvalid\n```\n');
    await assert.rejects(prepareContent(settings,output),/\.md: Leave the taelgar-header block empty/);
  }finally{
    assert.ok(isInside(path.join(ROOT,'.cache'),directory));fs.rmSync(directory,{recursive:true});
  }
});
