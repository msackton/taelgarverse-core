import test from 'node:test';
import assert from 'node:assert/strict';
import {headerEligibility,headerInfo,rewriteHeader,savedHeaderTitle,timelessLocation} from '../src/header-rewrite.mjs';
import {headerFixture} from './helpers/header-fixture.mjs';

test('saved H1 titles match the shared formatter for inferred articles, explicit empty articles and title/name composition',()=>{
  for(const [metadata,expected] of [
    [{tags:['place'],name:'Green Sea'},'The Green Sea'],
    [{tags:['place'],name:'Green Sea',displayDefaults:{defArt:''}},'Green Sea'],
    [{tags:['place'],name:'Irrla',displayDefaults:{defArt:'the'}},'The Irrla'],
    [{tags:['person'],name:'Morgan Vale',title:'mayor'},'Mayor Morgan Vale'],
    [{tags:['person'],name:'Morgan Vale',displayDefaults:{defArt:'the'}},'The Morgan Vale'],
    [{tags:['place'],name:'the green sea',displayDefaults:{defArt:''}},'The Green Sea'],
  ]) {
    const fixture=headerFixture({baseNotes:{'Title.md':metadata}});
    const actual=savedHeaderTitle(metadata,'Title.md',fixture.runtime.coreMeta);
    assert.equal(actual,expected);assert.equal(actual,fixture.services.NameManager.getName('Title','tn'));
  }
  const rules={requiredDisplayDefaults:{defArt:'the'},typeDisplayDefaults:{place:{defArt:'an'}}};
  assert.equal(savedHeaderTitle({tags:['place'],name:'island'},'File.md',rules),'An Island');
  assert.equal(savedHeaderTitle({tags:['place'],name:'island',displayDefaults:{defArt:''}},'File.md',rules),'Island');
  assert.equal(savedHeaderTitle({tags:['person'],name:'Named Note'},'Untitled.md'),'Named Note');
});

test('writer eligibility excludes untagged files and blocked tags before detecting either header style, including with Add',()=>{
  for(const tags of [undefined,null,[],[''],[123],{},' ',...['session-note','meta','background','source','story'].flatMap(tag=>
    [[tag],['person',tag],[tag,'person'],['person','#'+tag.toUpperCase()+'/detail']])]) {
    const yaml='---\n'+(tags===undefined?'':'tags: '+JSON.stringify(tags)+'\n')+'headerVersion: old\nname: Keep\n---\n';
    for(const body of ['# Old\n> [!info]+ Bio\n> Old\n','# Old\n> [!taelgar-header]\n> Saved\n','Prose before\n> [!taelgar-header]\n','Body.'])
      for(const add of [false,true]) {
        const result=rewriteHeader(yaml+body,{add});
        assert.equal(result.status,'skipped');assert.match(result.reason,/^Header ineligible:/);
        assert.equal(result.source,undefined);assert.equal(result.before,undefined,'ineligible header contents are never inspected or previewed');
      }
  }
  assert.equal(headerEligibility({tags:'person'}).eligible,true);
  assert.equal(headerEligibility({tags:['metadata','sourcebook','person']}).eligible,true,'only exact tag roots and their descendants are excluded');
});

test('person summaries use approved order, known ka, years only and a timeless home',()=>{
  const metadata={tags:['person/npc'],species:'elf',ancestry:'Chardonian',subspecies:'ignored',pronouns:'she/her',ka:3,
    born:'1714-06-12',died:'1749-09-10',whereabouts:'Cleenseau',affiliations:[{type:'primary',org:'Ignored'}]};
  assert.equal(headerInfo(metadata),'(elf, Chardonian, she/her, ka 3, b. 1714, d. 1749, lives in Cleenseau)');
  assert.equal(headerInfo({...metadata,ka:'unknown',born:1,died:9999,pronouns:null,gender:'female',whereabouts:[]}),
    '(elf, Chardonian, she/her)');
  assert.equal(headerInfo({tags:['person'],species:'Human',ka:0,gender:'nonbinary'}),'(human, they/them, ka 0)');
});

test('home summaries never select a location using a calendar date or competing entries',()=>{
  for(const key of ['start','end','date'])assert.equal(timelessLocation({whereabouts:[{type:'home',location:'Town',[key]:'1700-01-01'}]}),'');
  assert.equal(timelessLocation({whereabouts:[{type:'primary',location:'Town'},{type:'away',location:'Road',date:'1750-01-01'}]}),'Town');
  assert.equal(timelessLocation({whereabouts:[{type:'home',location:'Town'},{type:'home',location:'Other'}]}),'');
  assert.equal(timelessLocation({whereabouts:[{type:'home',location:'Town'},{type:'home',location:'unknown'}]}),'');
  assert.equal(timelessLocation({whereabouts:[{type:'home',location:'Town'},{type:'home',location:'Town'}]}),'Town');
  assert.equal(timelessLocation({whereabouts:[{type:'home',location:'Town'},'malformed']}),'');
});

test('power and group summaries include only undated primary affiliations',()=>{
  const affiliations=[{type:'primary',org:'Pantheon'},{type:'primary',org:'Past',end:1700},
    {type:'primary',org:'Future',start:1800},{type:'primary',org:'Dated',date:1750},{type:'member',org:'Other'},'Member'];
  assert.equal(headerInfo({tags:['power'],typeOf:'god',typeOfAlias:'deity',gender:'female',affiliations}),'(deity, she/her, part of Pantheon)');
  assert.equal(headerInfo({tags:['group'],typeOf:'guild',subTypeOf:'merchant',ancestry:'Chardonian',affiliations}),
    '(Chardonian merchant guild, of Pantheon)');
});

test('places prefer type aliases, omit population and include timeless secondary locations for every place type',()=>{
  const whereabouts=[{type:'primary',location:'Sembara'},{type:'secondary',location:'Wistel-Enst Watershed'}];
  assert.equal(headerInfo({tags:['place'],typeOf:'waterway',typeOfAlias:'river',whereabouts,population:1200}),
    '(river, in Sembara / Wistel-Enst Watershed)');
  assert.equal(headerInfo({tags:['place'],typeOf:'settlement',whereabouts}),'(settlement, in Sembara / Wistel-Enst Watershed)');
  assert.equal(headerInfo({tags:['place'],typeOf:'watershed',whereabouts:[whereabouts[0],{...whereabouts[1],start:1700}]}),'(watershed, in Sembara)');
});

test('Irrla regeneration includes both unambiguous timeless locations and omits dated or competing secondary locations',()=>{
  const yaml='---\nheaderVersion: 2023.11.25\ntags: [place]\ntypeOf: island\ntypeOfAlias: large island\nname: Irrla\npronunciation: EAR-la\nwhereabouts:\n- {type: primary, location: Green Sea}\n- {type: secondary, location: Eastern Green Sea}\n---\n';
  const result=rewriteHeader(yaml+'# Irrla\n> [!taelgar-header]\n> Old fallback\n\nAuthored article.\n',{filename:'Irrla.md'});
  assert.equal(result.source,yaml.replace('headerVersion: 2023.11.25\n','')+'# Irrla\n*(EAR-la)*\n> [!taelgar-header]\n> (large island, in Green Sea / Eastern Green Sea)\n\nAuthored article.\n');
  const metadata={tags:['place'],typeOf:'island',whereabouts:[{type:'primary',location:'Green Sea'},{type:'secondary',location:'Eastern Green Sea'}]};
  for(const bound of ['start','end','date'])assert.equal(headerInfo({...metadata,whereabouts:[metadata.whereabouts[0],{...metadata.whereabouts[1],[bound]:1740}]}),
    '(island, in Green Sea)');
  assert.equal(headerInfo({...metadata,whereabouts:[...metadata.whereabouts,{type:'secondary',location:'Other Sea'}]}),'(island, in Green Sea)');
});

test('objects and remaining types use their fixed formats and plain reference labels',()=>{
  assert.equal(headerInfo({tags:['object'],rarity:'rare',ancestry:'Chardonian',subtypeof:'ceremonial',typeOf:'sword'}),'(rare Chardonian ceremonial sword)');
  for(const type of ['ancestry','creature','unknown'])assert.equal(headerInfo({tags:[type],typeOf:'base',typeOfAlias:'type',partOf:'[[Folder/Parent|Parent label]]'}),
    '(type, Parent label)');
  assert.equal(headerInfo({}), '');
});

test('events preserve date precision, collapse identical endpoints and ignore hidden/invalid dates',()=>{
  const base={tags:['event'],typeOf:'battle',partOf:'Example War'};
  assert.equal(headerInfo({...base,DR:'1749-06-12',DR_end:'1749-06-12'}),'(battle, Example War, June 12, 1749)');
  assert.equal(headerInfo({...base,DR:1748,DR_end:1749}),'(battle, Example War, 1748–1749)');
  assert.equal(headerInfo({...base,DR:'1749-06'}),'(battle, Example War, June 1749)');
  assert.equal(headerInfo({...base,DR:1,DR_end:'1749-02-29'}),'(battle, Example War)');
});

test('legacy conversion replaces precisely the header and retains YAML bytes and the entire authored suffix',()=>{
  const yaml='\uFEFF---\r\nname: Fausto # keep comment\r\ntags: [person]\r\nspecies: human\r\npronunciation: FOW-stoh\r\nborn: 1714-06-12\r\n---\r\n';
  const suffix='\r\n%% Authored comment %%\r\n\r\n# Body heading\r\n\r\n> [!info] Authored\r\n> Keep.\r\n';
  const source=yaml+'\r\n# Old title\r\n*(OLD)*\r\n>[!info]+ Biographical Info\r\n> Old description\r\n>> `$=dv.view("_scripts/view/get_Whereabouts")`\r\n'+suffix;
  const result=rewriteHeader(source,{filename:'People/Fausto.md'});
  assert.equal(result.kind,'converted');assert.equal(result.status,'changed');
  assert.equal(result.source,yaml+'# Fausto\r\n*(FOW-stoh)*\r\n> [!taelgar-header]\r\n> (human, b. 1714)\r\n'+suffix);
  assert.equal(rewriteHeader(result.source,{filename:'People/Fausto.md'}).status,'unchanged');
});

test('successful conversion, regeneration and Add remove headerVersion in the same range edit',()=>{
  const yaml='---\nname: Fausto # keep\nheaderVersion: 2023.11.25 # obsolete\ntags: [person]\nspecies: human\n---\n';
  for(const [body,options,kind] of [
    ['# Old\n> [!info]+ Bio\n> Old\n',{},'converted'],
    ['# Fausto\n> [!taelgar-header]\n> (human)\n',{},'regenerated'],
    ['',{add:true},'added'],
  ]) {
    const source=yaml+body+'\nAuthored prose.\n',result=rewriteHeader(source,{filename:'Fausto.md',...options});
    assert.equal(result.status,'changed');assert.equal(result.kind,kind);
    assert.equal(result.source,yaml.replace('headerVersion: 2023.11.25 # obsolete\n','')+'# Fausto\n> [!taelgar-header]\n> (human)\n\nAuthored prose.\n');
    assert.equal(source.slice(0,result.start)+result.replacement+source.slice(result.end),result.source);
    assert.match(result.before,/headerVersion:/);assert.doesNotMatch(result.after,/headerVersion:/);
    assert.equal(rewriteHeader(result.source,{filename:'Fausto.md'}).status,'unchanged');
  }
});

test('headerVersion removal preserves quoted keys, comments, BOM, CRLF and nested or literal occurrences',()=>{
  const yaml='\uFEFF---\r\n# Keep this comment\r\n"headerVersion": "old" # obsolete\r\nname: Fausto # keep inline\r\ntags: [person]\r\nnotes: |\r\n  headerVersion: literal text\r\ndisplayDefaults:\r\n  headerVersion: nested\r\n---\r\n';
  const suffix='\r\nArticle.\r\n\r\n```yaml\r\nheaderVersion: example\r\n```\r\n';
  const result=rewriteHeader(yaml+'# Old\r\n> [!info]\r\n> Old\r\n'+suffix,{filename:'Fausto.md'});
  assert.equal(result.source,yaml.replace('"headerVersion": "old" # obsolete\r\n','')+'# Fausto\r\n> [!taelgar-header]\r\n'+suffix);
});

test('headerVersion removal handles null, multiline and duplicate top-level values without changing other fields',()=>{
  for(const field of ['headerVersion:\n','headerVersion: |\n  old\n  value\n','headerVersion: {old: value}\n','headerVersion: old\nheaderVersion: newer\n']) {
    const yaml='---\n'+field+'# Keep next field comment\ntags: [person]\nname: Fausto\n---\n';
    const result=rewriteHeader(yaml+'# Old\n> [!info]\n> Old\n',{filename:'Fausto.md'});
    assert.equal(result.source,yaml.replace(field,'')+'# Fausto\n> [!taelgar-header]\n');
  }
});

test('flow-style frontmatter removes only headerVersion and its separator',()=>{
  for(const [yaml,expected] of [
    ['{headerVersion: old, tags: [person], name: Fausto}','{ tags: [person], name: Fausto}'],
    ['{tags: [person], headerVersion: old, name: Fausto}','{tags: [person] , name: Fausto}'],
    ['{tags: [person], name: Fausto, headerVersion: old}','{tags: [person], name: Fausto }'],
    ['{headerVersion: old, headerVersion: newer, tags: [person]}','{  tags: [person]}'],
  ]) {
    const result=rewriteHeader('---\n'+yaml+'\n---\n# Old\n> [!info]\n> Old\n',{filename:'Fausto.md'});
    assert.equal(result.source,'---\n'+expected+'\n---\n# Fausto\n> [!taelgar-header]\n');
  }
});

test('unsafe shared anchors and unmarked or ambiguous headers never remove headerVersion',()=>{
  const yaml='---\nheaderVersion: &version old\nlintVersion: *version\ntags: [person]\n---\n';
  assert.throws(()=>rewriteHeader(yaml+'# Old\n> [!info]\n> Old\n'),/Cannot remove headerVersion without affecting other frontmatter/);
  for(const body of ['An unmarked note.\n','# Old\nAuthored prose.\n\n> [!info]\n> Keep.\n']) {
    const result=rewriteHeader(yaml+body);
    assert.equal(result.status,'skipped');assert.equal(result.source,undefined);
  }
});

test('empty callouts opt in without --add and regeneration reads the supplied unsaved frontmatter',()=>{
  const source='---\nname: New Name\ntitle: Captain\ntags: [person]\nspecies: human\n---\n# Old name\n\n> [!taelgar-header]\n\nArticle.\n';
  const result=rewriteHeader(source,{filename:'Old Name.md'});
  assert.match(result.source,/# Captain New Name\n> \[!taelgar-header\]\n> \(human\)/);
  assert.ok(result.source.endsWith('\nArticle.\n'));
});

test('Add header preserves the body and reuses the leading title range without duplicating it',()=>{
  for(const heading of ['','# Old name\n\n','Old name\n========\n*(OLD)*\n\n']) {
    const source='---\ntags: [person]\nname: New Name\npronunciation: NEW\n---\n'+heading+'An authored opening.\n\n> [!warning] Keep\n> Body.\n';
    assert.equal(rewriteHeader(source,{filename:'File.md'}).status,'skipped');
    const result=rewriteHeader(source,{filename:'File.md',add:true});
    assert.equal(result.kind,'added');assert.equal((result.source.match(/^# /gm)||[]).length,1);
    assert.ok(result.source.endsWith('An authored opening.\n\n> [!warning] Keep\n> Body.\n'));
    assert.equal(rewriteHeader(result.source,{filename:'File.md',add:true}).status,'unchanged');
  }
  for(const body of ['Introductory prose.\n\n> [!info] Article information\n> Keep.\n','> [!info] Article information\n> Keep.\n']) {
    const result=rewriteHeader('---\ntags: [person]\n---\n'+body,{filename:'New.md',add:true});
    assert.equal(result.kind,'added');assert.ok(result.source.endsWith(body),'an ordinary article callout is preserved by Add');
  }
});

test('ambiguous prefixes, ordinary callouts and literal/nested examples are not destructive conversion targets',()=>{
  for(const prefix of ['An authored introduction.\n\n','# Title\n%% A comment %%\n','![Portrait](image.png)\n\n']) {
    const source='---\ntags: [person]\n---\n'+prefix+'> [!taelgar-header]\n> Saved.\n';
    assert.equal(rewriteHeader(source,{filename:'File.md',add:true}).status,'skipped');
  }
  for(const source of ['> [!info] Authored\n> Body.\n','```markdown\n> [!taelgar-header]\n```\n',
    '> > [!taelgar-header]\n','- item\n  > [!taelgar-header]\n'])assert.equal(rewriteHeader('---\ntags: [person]\n---\n'+source).status,'skipped');
  assert.equal(rewriteHeader('---\ntags: [person]\n---\n```taelgar-header\n```\n',{add:true}).status,'skipped');
  assert.throws(()=>rewriteHeader('---\nname: Unclosed\n'),/Unclosed YAML/);
});
