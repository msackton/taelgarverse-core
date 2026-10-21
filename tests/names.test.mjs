import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from 'cheerio';
import {ContentStore,parseNote} from '../src/content-store.mjs';
import {targetPath} from '../src/common.mjs';
import {compileNames,parseNameMetadata} from '../scripts/compile-names.mjs';
import {nameInput,queryNames,nameId,splitPersonalName,personalNameParts} from '../src/names.mjs';
import {namesView} from '../src/names-view.mjs';
import {RenderEngine} from '../src/render-engine.mjs';
import {handleRequest} from '../src/application.mjs';
import {SnapshotStore} from '../src/snapshot.mjs';

const block=entries=>'%%^Metadata:names:v1%%\n'+entries.map(entry=>'- '+JSON.stringify(entry)).join('\n')+'\n%%^End%%';
const named=(metadata,entries=[],body='')=>'---\n'+Object.entries(metadata).map(([key,value])=>key+': '+JSON.stringify(value)).join('\n')+'\n---\n'+body+'\n'+(entries.length?block(entries):'');
function store(notes) {
  return new ContentStore(Object.entries(notes).map(([id,source])=>{
    const target=targetPath(id);
    return {id,target,slug:target.slice(0,-3),name:id.slice(0,-3),title:id.slice(0,-3),note:parseNote(source),extension:'.md'};
  }));
}
const context={id:'custom',kind:'custom',date:'1720-01-01',campaigns:[],dm:false};
const input=values=>nameInput(new URLSearchParams({view:'names',...values}));
const fixture=()=>store({
  'River.md':named({tags:['place'],name:'Istaros',aliases:['Drogar']},[
    {name:'Istaros',language:'Common',derivedFrom:'Aistanë',status:'documented',notes:'EDITORIAL SECRET'},
    {name:'Aistanë',language:'Elvish',pronunciation:'EYE-stah-neh',meaning:'blessed water',status:'documented'},
    {name:'Secret Form',language:'Elvish',status:'proposed'},
    {name:'Water',role:'name component',language:'Common'},
  ],'%%^Campaign:dufr%%\nSecret Form\n%%^End%%'),
  'Future.md':named({tags:['person'],name:'Future Person',born:'1740-01-01',excludePublish:['dufr']}),
  'Hidden.md':named({tags:['person'],name:'Unpublished',excludePublish:'all'}),
  'Background.md':named({tags:['background'],name:'History of Everywhere'}),
  'Book.md':named({tags:['source'],name:'A Book'},[{name:'A Book',language:'Common'}]),
  'Malformed.md':named({tags:['group'],name:'Fallback'})+'\n%%^Metadata:names:v1%%\n- {name: Broken}\n%%^End%%',
});

test('name metadata accepts YAML and JSON mappings, excludes code examples and separates components',()=>{
  const fence=String.fromCharCode(96).repeat(4);
  const source=fence+'yaml\n'+block([{name:'Literal',language:'Common'}])+'\n'+fence+'\n'+
    '%%^Metadata:names:v1%%\n- {name: "Hero\'s Road", language: Common, meaning: "a: b"}\n%%^End%%\n';
  assert.deepEqual(parseNameMetadata(source),[{name:"Hero's Road",language:'Common',meaning:'a: b'}]);
  assert.throws(()=>parseNameMetadata('%%^Metadata:names:v1%%\n- {name: Missing}\n%%^End%%'),/requires/);
});

test('catalog reads named subjects, explicit forms and aliases while keeping editorial notes out',()=>{
  const source=fixture(),index=compileNames(source);
  assert.equal(index.version,1);
  assert.deepEqual(index.entries.filter(item=>item.page==='river').map(item=>item.name).sort(),['Aistanë','Drogar','Istaros','Secret Form'].sort());
  assert.equal(index.entries.some(item=>item.name==='Water'),false);
  assert.equal(index.entries.some(item=>item.name==='Unpublished'),false);
  assert.equal(index.entries.some(item=>item.name==='History of Everywhere'),false);
  assert.equal(index.entries.some(item=>item.name==='A Book'),true);
  assert.equal(index.entries.find(item=>item.name==='Drogar').language,'Unknown');
  assert.equal(index.warnings.length,1);
  assert.equal(index.entries.find(item=>item.name==='Fallback').language,'Unknown');
  assert.doesNotMatch(JSON.stringify(index),/EDITORIAL SECRET|"notes"|lint|whereabouts/);
});

test('direct human decisions fill missing assignments and preserve conflicting metadata assignments',()=>{
  const source=fixture(),index=compileNames(source,[
    {type:'concept',subject:'River.md',concept:'form:drogar',form:'Drogar',language:'Orcish',notes:'PRIVATE DECISION'},
    {type:'concept',subject:'River.md',concept:'primary',form:'Istaros',language:'Elvish'},
    {type:'component',subject:'River.md',concept:'primary',form:'Istaros',language:'Common',role:'core'},
    {type:'rule',match:{noteType:'person'},language:'Guessed'},
  ]);
  assert.equal(index.entries.find(item=>item.name==='Drogar').language,'Orcish');
  const primary=index.entries.find(item=>item.name==='Istaros');
  assert.equal(primary.language,'Common');assert.equal(primary.catalogLanguage,'Elvish');
  assert.deepEqual(primary.components,[{name:'Istaros',language:'Common',role:'core',status:'catalog decision'}]);
  assert.equal(index.entries.find(item=>item.name==='Future Person').language,'Unknown');
  assert.doesNotMatch(JSON.stringify(index),/PRIVATE DECISION|Guessed/);
});

test('shelves intentionally ignore date, campaign and POV while retaining global publication exclusions',()=>{
  const source=fixture(),index=compileNames(source);
  const baseline=queryNames(index,source,context,input({}));
  for (const alternate of [{...context,date:'1750-01-01',campaigns:['dufr'],dm:true,pov:true},context]) {
    const result=queryNames(index,source,alternate,input({}));
    assert.equal(result.total,baseline.total);
    assert.ok(result.groups.some(group=>group.items.some(item=>item.name==='Secret Form')));
    assert.ok(result.groups.some(group=>group.items.some(item=>item.name==='Future Person')));
    assert.equal(result.groups.some(group=>group.items.some(item=>item.name==='Unpublished')),false);
  }
});

test('filters support accent-insensitive search, selected details and related names across languages',()=>{
  const source=fixture(),index=compileNames(source);
  const result=queryNames(index,source,context,input({language:'Elvish',find:'aistane',name:nameId('river','Aistanë')}));
  assert.equal(result.total,1);assert.equal(result.selected.meaning,'blessed water');
  assert.ok(result.related.some(item=>item.name==='Istaros'));
  const $=load(namesView(result));
  assert.equal($('.names-word').text(),'Aistanë');
  const url=new URL($('.names-related a').filter((_,el)=>$(el).text()==='Istaros').attr('href'),'https://example.test');
  assert.equal(url.searchParams.has('language'),false);assert.equal(url.searchParams.has('find'),false);
  assert.equal(url.searchParams.get('date'),context.date);
});

test('large shelves show samples per type and paginate one subject collection',()=>{
  const source=store(Object.fromEntries(Array.from({length:90},(_,i)=>['Person '+i+'.md',named({tags:['person'],name:'Person '+String(i).padStart(3,'0')})])));
  const index=compileNames(source),overview=queryNames(index,source,context,input({}));
  assert.equal(overview.total,90);assert.equal(overview.groups[0].items.length,16);
  assert.equal(overview.groups[0].items.at(-1).name,'Person 089');
  const selected=queryNames(index,source,context,input({name:nameId('person-1','Person 001')}));
  assert.ok(selected.groups[0].items.some(item=>item.id===selected.selected.id));
  const page=queryNames(index,source,context,input({kind:'person',offset:'72'}));
  assert.equal(page.groups[0].items.length,18);assert.equal(page.pagination.previous,true);assert.equal(page.pagination.next,false);
  assert.equal(queryNames(index,source,context,input({kind:'person',offset:'99999'})).input.offset,72);
  for (const values of [{offset:'1.5'},{kind:'invalid'},{find:'x'.repeat(257)}]) assert.throws(()=>input(values),error=>error.status===400);
});

test('personal name splits retain surname particles and omit titles, descriptions and regnal suffixes',()=>{
  assert.deepEqual(splitPersonalName('Sir Jean de la Croix'),[{name:'Jean',type:'given'},{name:'de la Croix',type:'family'}]);
  assert.deepEqual(splitPersonalName('Alban of Ashcombe'),[{name:'Alban',type:'given'}]);
  assert.deepEqual(splitPersonalName('Queen Arryn II'),[{name:'Arryn',type:'given'}]);
  assert.deepEqual(splitPersonalName('Kaelion the Elder'),[{name:'Kaelion',type:'given'}]);
  assert.deepEqual(splitPersonalName('John Paul Jones'),[{name:'John',type:'given'}]);
  assert.deepEqual(splitPersonalName('The Grey Knight'),[]);
  assert.deepEqual(splitPersonalName('Bree Charmheart'),[{name:'Bree',type:'given'},{name:'Charmheart',type:'family'}]);
});

test('first names and surnames deduplicate by language with source people and component-specific evidence',()=>{
  const source=store({
    'Jean.md':named({tags:['person'],name:'Jean Laurent',aliases:['Jean']},[{name:'Jean Laurent',language:'Sembaran',pronunciation:'COMPLETE NAME ONLY'}]),
    'Another Jean.md':named({tags:['person'],name:'Jean de Valarin'},[{name:'Jean de Valarin',language:'Sembaran'}]),
    'Corrine.md':named({tags:['person'],name:'Corrine Morphokamia'},[
      {name:'Corrine Morphokamia',language:'Common'},
      {name:'Corrine',role:'name component',language:'Drankorian',pronunciation:'koh-REEN',meaning:'maiden',status:'proposed'},
      {name:'Morphokamia',role:'name component',language:'Drankorian'},
    ]),
    'Title.md':named({tags:['person'],name:'Alban of Ashcombe'},[{name:'Alban of Ashcombe',language:'Sembaran'}]),
    'Private.md':named({tags:['person'],name:'Jean Private',excludePublish:'all'}),
    'Place.md':named({tags:['place'],name:'Jean River'}),
  });
  const index=compileNames(source),parts=personalNameParts(index.entries);
  const jean=parts.find(item=>item.type==='given' && item.name==='Jean');
  assert.equal(jean.sources.length,2);assert.equal(jean.language,'Sembaran');assert.equal(jean.pronunciation,'');
  assert.ok(parts.some(item=>item.type==='family' && item.name==='de Valarin'));
  assert.equal(parts.some(item=>item.name==='of Ashcombe' || item.name==='Private' || item.name==='River'),false);
  const corrine=parts.find(item=>item.name==='Corrine');
  assert.equal(corrine.language,'Drankorian');assert.equal(corrine.inferred,false);
  assert.equal(corrine.pronunciation,'koh-REEN');assert.equal(corrine.meaning,'maiden');
  const recorded=queryNames(index,source,context,input({view:'parts',name:corrine.id}));
  assert.match(load(namesView(recorded))('.names-pronunciation').text(),/Proposed entry/);
  const query=input({view:'parts',language:'Sembaran',find:'jean',name:jean.id});
  const result=queryNames(index,source,context,query);
  assert.equal(result.subjects,2);assert.equal(result.selected.sources.length,2);
  assert.deepEqual(result.groups.map(group=>group.label),['First names','Surnames']);
  const $=load(namesView(result));
  assert.match($('.names-part-sources').text(),/Jean Laurent/);
  const full=new URL($('.names-part-sources li>a').first().attr('href'),'https://example.test');
  assert.equal(full.searchParams.get('view'),'names');assert.equal(full.searchParams.has('find'),false);
  assert.equal(nameInput(new URLSearchParams()).view,'parts');
  assert.equal(nameInput(new URLSearchParams({name:nameId('jean','Jean Laurent')})).view,'names');
  for(const values of [{view:'other'},{view:'parts',kind:'person'},{view:'names',kind:'given'}]) assert.throws(()=>input(values),error=>error.status===400);
});

test('HTML and API escape authored values, preserve fallback links and load name assets only on the explorer',async()=>{
  const source=store({'Example.md':named({tags:['person'],name:'<img src=x onerror=alert(1)>'},[{name:'<img src=x onerror=alert(1)>',language:'<script>bad</script>',meaning:'<b>meaning</b>'}])});
  const engine=new RenderEngine({store:source,settings:{default_date:'1750-01-01'},headers:{registry:{campaigns:{}}},renderHeader:()=>'',navigationSource:null,nameIndex:compileNames(source)});
  const request=(url,options)=>handleRequest(new Request('https://example.test'+url,options),engine);
  const response=await request('/names?view=names');assert.equal(response.status,200);
  const $=load(await response.text());
  assert.equal($('.names-word img,.names-detail script,.names-detail b').length,0);
  assert.match($('.names-word').text(),/<img/);
  assert.equal($('link[href="/theme/names.css"]').length,1);assert.equal($('script[src="/theme/names.js"]').length,1);
  assert.equal($('.article-prose .name-explorer').length,0);
  assert.ok($('.names-filters input[name="context"]').length);
  const head=await request('/names',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  const api=await (await request('/api/names?view=names')).json();assert.equal(api.total,1);assert.match(api.html,/data-name-explorer/);
  const root=load(await (await request('/?q=')).text());assert.equal(root('link[href="/theme/names.css"]').length,0);
  assert.equal((await request('/api/names?offset=-1')).status,400);
});

test('published name indexes browse without fetching Markdown shards; older snapshots remain usable',()=>{
  const source=fixture(),names=compileNames(source);
  const entries=source.entries.map(entry=>({...entry,note:{metadata:entry.note.metadata,shard:'00',sha256:'unused'}}));
  let reads=0;
  const storage={get:async()=>{reads++;throw new Error('Unexpected shard read');}};
  const snapshot=new SnapshotStore({entries,revision:'a'.repeat(64),warnings:[],settings:{}},storage);
  const result=queryNames(names,snapshot,context,input({language:'Elvish'}));
  assert.ok(result.total>0);assert.equal(reads,0);
  assert.equal(queryNames(null,snapshot,context,input({})).available,false);
});
