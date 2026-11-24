import test from 'node:test';
import assert from 'node:assert/strict';
import {installNoteQueryAPI} from '../obsidian/taelgarverse/services/note-queries.mjs';
import {headerFixture} from './helpers/header-fixture.mjs';

test('note queries use the recorded home at origin and resolve native links before vault aliases', async()=>{
  const {runtime} = headerFixture({
    baseNotes:{
      'Places/Harbor.md':{tags:['place'],aliases:['Old Wharf','Pier']},
      'Other/Pier.md':{tags:['place']},
      'Places/Pier.md':{tags:['place']},
      'People/Moved.md':{tags:['person'],born:1700,whereabouts:[
        {type:'home',location:'A home with no linked note',end:1709},
        {type:'home',location:'Harbor',start:1710},
      ]},
      'People/Undated.md':{whereabouts:'Harbor'},
      'People/Later Home.md':{born:1700,whereabouts:[{type:'home',location:'Harbor',start:1710}]},
    },
    displayRules:{linkmap:[{from:'Old Harbor',to:'Places/Harbor.md'}]},
  });
  const globals = {};
  let dispose,snapshotReads=0;
  installNoteQueryAPI({
    snapshots:{async getSnapshot(){snapshotReads++;return {runtime};}},
    app:{metadataCache:{getFirstLinkpathDest(target,sourcePath){
      if (target==='Pier' && sourcePath.endsWith('/Journal.md')) {
        return {path:sourcePath.replace('/Journal.md','/Pier.md')};
      }
      if (target==='Local Annex' && sourcePath==='Other/Journal.md') return {path:'Other/Pier.md'};
      if (target==='Sketch.png') return {path:'Assets/Sketch.png'};
    }}},
    register(callback){dispose=callback;},
  },globals);
  const api=globals.Taelgarverse;
  assert.equal(api.apiVersion,1);
  const queries=await api.getNoteQueries();

  assert.equal(queries.getRecordedOrigin('People/Moved.md'),'A home with no linked note');
  assert.equal(queries.getRecordedOrigin('People/Undated.md'),'Harbor');
  assert.equal(queries.getRecordedOrigin('People/Later Home.md'),null);
  assert.equal(queries.getRecordedOrigin('People/Missing.md'),null);

  assert.equal(queries.isResolvable('[[Pier#History|the pier]]','Other/Journal.md'),true);
  assert.equal(queries.isResolvable('Local Annex','Other/Journal.md'),true);
  assert.equal(queries.isResolvable('Local Annex','Places/Journal.md'),false);
  assert.equal(queries.isResolvable('Old Wharf'),true);
  assert.equal(queries.isResolvable('Old Harbor'),true);
  assert.equal(queries.isResolvable('Sketch.png'),false);
  assert.equal(queries.isResolvable('Missing'),false);
  assert.equal(queries.isResolvable(''),false);
  assert.equal(snapshotReads,1);

  dispose();
  assert.equal(globals.Taelgarverse,undefined);
  await assert.rejects(api.getNoteQueries(),/unloaded/);
});

test('campaign, DR date, and note formatting queries reuse shared domain rules', async()=>{
  const notePath='People/Moved.md';
  const {runtime,services,file}=headerFixture({
    baseNotes:{
      [notePath]:{tags:['person'],name:'Traveler',born:1700,pageTargetDate:'1705-01-01',
        whereabouts:[{type:'home',location:'Harbor',end:1709},{type:'home',location:'Haven',start:1710}]},
      'Places/Harbor.md':{tags:['place']},
      'Places/Haven.md':{tags:['place']},
    },
    campaignRegistry:{campaigns:{demo:{name:'Demo Campaign',code:'demo',campaignRoot:'Campaigns/Demo'}}},
  });
  const globals={};
  installNoteQueryAPI({
    snapshots:{async getSnapshot(){return {runtime,fallback:'1720-01-01'};}},
    dates:{getDate(metadata,fallback){return metadata.pageTargetDate ?? fallback;}},
    register(){},
  },globals);
  const queries=await globals.Taelgarverse.getNoteQueries();
  assert.deepEqual(queries.getCampaigns(),[{code:'demo',name:'Demo Campaign',campaignRoot:'Campaigns/Demo'}]);
  queries.getCampaigns()[0].name='Changed by caller';
  assert.equal(queries.getCampaigns()[0].name,'Demo Campaign');

  for (const value of [1748,'1748','1748-11','1748-11-19']) {
    assert.deepEqual(queries.normalizeDR(value),services.DateManager.normalizeDate(value,false));
    assert.deepEqual(queries.normalizeDR(value,{boundary:'end'}),services.DateManager.normalizeDate(value,true));
  }
  const normalized=queries.normalizeDR('1748-11-19');
  assert.deepEqual(queries.normalizeDR(new Date('1748-11-19T00:00:00Z')),normalized);
  assert.deepEqual(queries.normalizeDR({toISODate:()=> '1748-11-19'}),normalized);
  assert.notEqual(queries.normalizeDR(normalized),normalized);
  assert.equal(queries.normalizeDR('invalid'),null);
  assert.throws(()=>queries.normalizeDR(1748,{boundary:'middle'}),/start or end/);

  const template='<current:1>';
  const atBirth=queries.formatNoteText(template,notePath);
  const later=queries.formatNoteText(template,notePath,{date:'1720-01-01'});
  assert.equal(atBirth,services.TokenParser.formatDisplayString(template,file(notePath),'1705-01-01'));
  assert.match(atBirth,/Harbor/);
  assert.match(later,/Haven/);
  assert.equal(queries.formatNoteText(template,'Missing.md'),null);
});
