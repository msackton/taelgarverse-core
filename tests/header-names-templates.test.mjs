import test from 'node:test';
import assert from 'node:assert/strict';
import {headerFixture} from './helpers/header-fixture.mjs';

for(const [metadata,type] of [
  [{tags:['person']},'person'],[{tags:'place/town'},'place'],[{tags:['object/book']},'object'],
  [{tags:['group']},'group'],[{tags:['event']},'event'],[{tags:['power']},'power'],
  [{tags:['ancestry']},'ancestry'],[{tags:['creature']},'creature'],
  [{file:{tags:['person']}},'person'],[{file:{etags:['#place']}},'place'],
  [{tags:[null,42,'status/check/ai','person']},'person'],[{},'unknown'],[undefined,'unknown'],
])test('page classification: '+JSON.stringify(metadata),()=>{
  assert.equal(headerFixture().services.NameManager.getPageType(metadata),type);
});

test('name lookup handles paths, case, scalar/list aliases, link maps and filtering',()=>{
  const n=headerFixture({extraNotes:{'Alias.md':{tags:['place'],aliases:'Single Alias'}}}).services.NameManager;
  for(const target of ['Harbor','harbor','Places/Harbor','Places/Harbor.md','PORT'])
    assert.equal(n.getFileForTarget(target).filename,'Harbor',target);
  assert.equal(n.getFileForTarget('single alias').filename,'Alias');
  assert.equal(n.getFileForTarget('human').filename,'Humans');
  assert.equal(n.getFileForTarget('human').isAlias,true);
  assert.equal(n.getFileForTarget('Harbor',m=>m.tags.includes('person')),undefined);
  assert.equal(n.getFileForTarget('Port',m=>m.tags.includes('person')),undefined);
  assert.equal(n.getFileForTarget('human',m=>m.tags.includes('person')),undefined);
  assert.equal(n.getFileForTarget('Missing'),undefined);
});

test('published-content name lookup leaves duplicate basenames unresolved but accepts full paths',()=>{
  const n=headerFixture({extraNotes:{'One/Same.md':{name:'One'},'Two/Same.md':{name:'Two'}}}).services.NameManager;
  assert.equal(n.getFileForTarget('Same'),undefined);
  assert.equal(n.getFileForTarget('One/Same').frontmatter.name,'One');
  assert.equal(n.getFileForTarget('Two/Same.md').frontmatter.name,'Two');
});

test('display rules merge required, type, and per-note values while preserving explicit empty overrides',()=>{
  const n=headerFixture().services.NameManager;
  const actual=n.getDisplayData({tags:['person'],displayDefaults:{boxName:'Profile',wHome:'',linkText:null}});
  assert.equal(actual.boxName,'Profile');assert.equal(actual.startStatus,'born');
  assert.equal(actual.wHome,'');assert.equal(actual.linkText,null);assert.equal(actual.aNoDate,'<affiliationtitle:tx> of <affiliations>');
  assert.equal(n.getDisplayData('River Town').startStatus,'founded');
  assert.equal(n.getDisplayData('Missing').boxName,'Information');
});

for(const [target,format,expected] of [
  ['River Town','q','in the [[River Town]]'],['River Town','Q','the [[River Town]]'],
  ['River Town','xn','River Town'],['River Town','tqn','in The River Town'],
  ['River Town','tuqn','In The River Town'],
  ['Harbor','a','a [[Harbor]]'],['Guild','q','with the [[Guild|Glass Guild]]'],
  ['Glassworkers','','[[Guild|Glassworkers]]'],['Port','','[[Harbor|Port]]'],
  ['human','s','[[Humans|human]]'],['human','sAn','human'],
  ['Missing','y','[[Missing]]'],['Missing','n','Missing'],
])test('name formatting: '+target+' / '+format,()=>{
  const n=headerFixture().services.NameManager;
  assert.equal(n.formatName(n.getNameObject(target,'person'),format),expected);
});

test('name overrides, titles and missing values are resolved without mutating names',()=>{
  const n=headerFixture().services.NameManager;
  assert.equal(n.getName('Leader','n'),'Mayor Morgan');
  const name=n.getNameObject('Harbor','person',{alias:'Port City',definiteArticle:'the',linkText:'near'});
  const before=structuredClone(name);
  assert.equal(n.formatName(name,'q'),'near the [[Harbor|Port City]]');assert.deepEqual(name,before);
  assert.equal(n.formatName(n.getNameObject(null),'n'),'');assert.equal(n.formatName(undefined,'n'),'');
});

for(const [metadata,expected] of [
  [{gender:'male'},'(he/him)'],[{gender:'female'},'(she/her)'],[{gender:'nonbinary'},'(they/them)'],
  [{gender:'female',pronouns:'xe/xem'},'(xe/xem)'],[{},''],
])test('pronoun templates: '+JSON.stringify(metadata),()=>{
  const t=headerFixture().services.TokenParser;
  assert.equal(t.formatDisplayString('<(()pronouns())>',{frontmatter:metadata}),expected);
});

test('templates expand linked species, ancestry, quantities and elf ka',()=>{
  const h=headerFixture(),t=h.services.TokenParser;
  assert.equal(t.formatDisplayString('<ancestry:UA> <species:sAU> <(()pronouns())>',h.file('Example')),
    'A [[Townfolk]] [[Humans|human]] (she/her)');
  assert.equal(t.formatDisplayString('<population>',h.file('River Town')),'pop. 1,200');
  assert.equal(t.formatDisplayString('<ka>',{frontmatter:{species:'elf',ka:3}}),'ka 3');
  assert.equal(t.formatDisplayString('<ka>',{frontmatter:{species:'elf'}}),'ka unknown');
  assert.equal(t.formatDisplayString('<ka>',{frontmatter:{species:'human'}}),'');
});

test('templates remove empty optional text and normalize punctuation without damaging literal prose',()=>{
  const t=headerFixture().services.TokenParser;
  assert.equal(t.formatDisplayString(' : <(of )primary>, <(()missing())> ',{frontmatter:{}}),'');
  assert.equal(t.formatDisplayString('Hello    <pronunciation>  !',{frontmatter:{pronunciation:'eh'}}),'Hello eh !');
  assert.equal(t.formatDisplayString('Literal [brackets]; unfinished <token',{frontmatter:{}}),
    'Literal [brackets]; unfinished <token');
  assert.equal(t.formatDisplayString(undefined,{frontmatter:{}}),'');
});

test('template aliases, case-insensitive fields and explicit empty type overrides remain supported',()=>{
  const h=headerFixture(),t=h.services.TokenParser;
  assert.equal(t.formatDisplayString('<target> / <currentdate> / <targetdate>',h.file('Example')),
    'January 1st, 1720 / January 1st, 1720 / January 1st, 1720');
  assert.equal(t.formatDisplayString('<length>',h.file('Example')),'20 years');
  assert.equal(t.formatDisplayString('<subtype>',{frontmatter:{subTypeOf:'large'}}),'large');
  assert.equal(t.formatDisplayString('<type>',{frontmatter:{tags:['object/weapon']}}),'weapon');
  assert.equal(t.formatDisplayString('<type>',{frontmatter:{tags:['object/weapon'],typeOf:''}}),'');
  assert.equal(t.formatDisplayString('<species:n>',{frontmatter:{Species:'human',SpeciesAlias:'mortal'}}),'mortal');
});

test('separate first-item formatting, chain filters and parent-organization depth limits work together',()=>{
  const h=headerFixture(),t=h.services.TokenParser;
  assert.equal(t.formatDisplayString('<home:3Fr;q;tn>',h.file('Example')),
    'The River Town, in the [[Old County]], the [[Kingdom|Green Kingdom]]');
  assert.equal(t.formatDisplayString('<partof:1n>',h.file('Guild')),'the Guild Federation');
  assert.equal(t.formatDisplayString('<partof:n>',h.file('Guild')),'the Guild Federation, the High Council');
});
