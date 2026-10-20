import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {load} from 'cheerio';
import {ContentStore,parseNote} from '../src/content-store.mjs';
import {targetPath} from '../src/common.mjs';
import {buildBacklinkIndex,buildBacklinkCampaigns,linkedFrom,authoredBody} from '../src/backlinks.mjs';
import {filterComments} from '../src/comments.mjs';
import {createMarkdown,renderMarkdown} from '../src/markdown.mjs';
import {document} from '../src/render-engine.mjs';

const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/backlinks.json',import.meta.url),'utf8'));
function makeStore(notes=fixtures) {
  return new ContentStore(Object.entries(notes).map(([id,source]) => {
    const note = parseNote(source), target = targetPath(id), name = path.posix.basename(id,'.md');
    return {id,note,name,title:note.metadata.name || name,target,slug:target.slice(0,-3)};
  }));
}
const store = makeStore(), index = buildBacklinkIndex(store);
const registry = {campaigns:{
  addermarch:{code:'adma',name:'Addermarch',aliases:['Addermarch Campaign'],campaignRoot:'Campaigns/Addermarch Campaign'},
  'dunmar-frontier':{code:'dufr',name:'Dunmar Frontier',aliases:['Dunmari Frontier'],campaignRoot:'Campaigns/Dunmari Frontier Campaign'},
}};
const ownership = buildBacklinkCampaigns(store,registry);
const context = (date='1720-01-01',campaigns=[],dm=false) => ({id:'custom',kind:'custom',date,campaigns,dm});
const pages = ctx => linkedFrom(index,store,'backlink-target',ctx,ownership).map(link => link.page);

test('backlinks deduplicate aliases and link formats, sort by title, and omit self links and literals',() => {
  assert.deepEqual(pages(context()),['backlink-source','before-reference','embedded-reference','excluded-reference']);
  assert.equal(index.byTarget['backlink-target'].filter(link => link.source==='backlink-source').length,1);
  assert.deepEqual(index.byTarget['backlink-target'].find(link => link.source==='backlink-source').when,[{}]);
  assert.deepEqual(linkedFrom(index,store,'backlink-empty',context()),[]);
  assert.doesNotMatch(JSON.stringify(index),/Article without|Paragraph|%% unterminated/);
  assert.match(index.warnings[0],/Backlinks omitted for Broken Reference.md/);
  const named = makeStore({'Constructor.md':'# Constructor'});
  assert.deepEqual(linkedFrom(buildBacklinkIndex(named),named,'constructor',context()),[]);
});

test('backlinks filter source availability and occurrence campaign, date, and DM rules on every request',() => {
  for (const date of ['1729-12-31','1730-01-01','1740-01-01']) for (const campaigns of [[],['dufr'],['adma'],['adma','dufr']]) for (const dm of [false,true]) {
    const ctx = context(date,campaigns,dm), actual = pages(ctx);
    const expected = ['backlink-source','embedded-reference'];
    if (date<'1730-01-01') expected.push('before-reference');
    else expected.push('date-reference','future-reference');
    if (campaigns.includes('dufr')) expected.push('campaign-reference','cross-campaign-reference');
    else expected.push('excluded-reference');
    if (campaigns.includes('dufr')) expected.push('dunmar-backlink-session','campaigns/dunmari-frontier-campaign/letters/backlink-letter');
    if (campaigns.includes('adma')) expected.push('addermarch-backlink-session','campaigns/addermarch-campaign/handouts/backlink-letter');
    if (dm) expected.push('dm-reference','dm-block-reference');
    assert.deepEqual(new Set(actual),new Set(expected),JSON.stringify(ctx));
    assert.equal(linkedFrom(index,store,'backlink-empty',ctx,ownership).some(link=>link.page==='cross-campaign-reference'),campaigns.includes('adma')&&!campaigns.includes('dufr'));
    const url = new URL(linkedFrom(index,store,'backlink-target',ctx)[0].url,'https://example.test');
    assert.equal(url.searchParams.get('date'),date);
    assert.equal(url.searchParams.has('dm'),dm);
  }
  assert.deepEqual(pages(context()),['backlink-source','before-reference','embedded-reference','excluded-reference']);
});

test('campaign ownership recognizes registry identities and folders while keeping world references shared',() => {
  const sample = makeStore({
    'Target.md':'# Target',
    'Shared.md':'---\nknownTo: [adma]\ncampaignInfo: [{campaign: adma}]\n---\n# Shared\n\n[[Target]]',
    'Multi.md':'---\ncampaign: [ADMA, dunmar-frontier]\n---\n# Multi\n\n[[Target]]',
    'Other.md':'---\ncampaign: Addermarch Campaign\nexcludePublish: [adma]\n---\n# Excluded\n\n[[Target]]',
    'Unknown.md':'---\ncampaign: Unregistered\n---\n# Unknown\n\n[[Target]]',
    'Unassigned Session.md':'---\ntags: [session-note]\n---\n# Unassigned\n\n[[Target]]',
    'Campaigns/Campaigns.md':'# Campaign Directory\n\n[[Target]]',
    'Campaigns/Unregistered Campaign/Session.md':'# Archived\n\n[[Target]]',
    'Campaigns/Addermarch Campaign Extra/Letter.md':'# Another Folder\n\n[[Target]]',
    'Campaigns/Addermarch Campaign/Secret.md':'# Secret\n\n%%[[Target]]%%',
  });
  const compiled = buildBacklinkIndex(sample), owners = buildBacklinkCampaigns(sample,registry);
  for (const campaigns of [[],['adma'],['dufr']]) for (const dm of [false,true]) {
    const actual = linkedFrom(compiled,sample,'target',context('1720-01-01',campaigns,dm),owners).map(link=>link.page);
    const expected = ['shared','campaigns/campaigns'];
    if (campaigns.length) expected.push('multi');
    if (campaigns.includes('adma') && dm) expected.push('campaigns/addermarch-campaign/secret');
    assert.deepEqual(new Set(actual),new Set(expected),JSON.stringify({campaigns,dm}));
  }
  for (const name of ['Addermarch','ADMA','addermarch','Addermarch Campaign']) {
    const entry = makeStore({'Session.md':'---\ncampaign: '+name+'\n---\n[[Target]]'});
    assert.deepEqual(buildBacklinkCampaigns(entry,registry).get('session'),['adma']);
  }
  const all = linkedFrom(compiled,sample,'target',{...context('1720-01-01',['adma','dufr']),allCampaigns:true},owners).map(link=>link.page);
  for (const source of ['unknown','unassigned-session','campaigns/unregistered-campaign/session']) assert.ok(all.includes(source));
  assert.equal(all.includes('other'),false); // Publication exclusions still apply.
});

test('compiled references agree with actual filtered Markdown, including cross-block reference definitions',() => {
  const sample = makeStore({
    'Target.md':'---\ncreated: 1750-01-01\n---\n# Target',
    'Other.md':'# Other',
    'Source.md': '[link][ref]\n\n%%^Campaign:dufr%%\n[ref]: Target.md\n%%^End%%\n\n%%^Campaign:adma%%\n[ref]: Other.md\n%%^End%%\n\n' +
      '%%^Date:1730%%\n[[Other]]\n%%^End%%\n\n%%^Date:1740b%%\n%%a note [[Target]]%%\n%%^End%%\n',
  });
  const compiled = buildBacklinkIndex(sample), md = createMarkdown(), notesMarkdown = createMarkdown({html:false});
  for (const date of ['1729-12-31','1730-01-01','1739-12-31','1740-01-01','1750-01-01']) for (const campaigns of [[],['dufr'],['adma'],['dufr','adma']]) for (const dm of [false,true]) {
    const ctx = context(date,campaigns,dm), entry = sample.resolve('Source'), dmNotes = [], links = new Set();
    const body = filterComments(entry.note.body,{...ctx,notes:dmNotes});
    renderMarkdown(md,body,{store:sample,entry,date,context:ctx,warnings:[],dmNotes,notesMarkdown,pageLinks:links});
    for (const target of ['target','other']) {
      const expected = links.has(target) && (target!=='target' || date>='1750-01-01');
      assert.equal(linkedFrom(compiled,sample,target,ctx).length>0,expected,JSON.stringify({target,...ctx}));
    }
  }
});

test('the index strips saved and prepared header slots without dropping article content',() => {
  assert.doesNotMatch(authoredBody(store.resolve('Stale Header').note),/\[\[/);
  assert.doesNotMatch(authoredBody(store.resolve('Prepared Header').note),/taelgar:header/);
  for (const source of ['# Old header\n[[Target]]\n\n\nBody [[Other]]', '\n# Body [[Other]]']) {
    const note = {metadata:{headerVersion:'1',tags:['person']},body:source};
    assert.match(authoredBody(note),/Body \[\[Other\]\]/);
  }
});

test('Linked from keeps the right column without a TOC, hides empty sections, and escapes titles',() => {
  const result = {title:'Target',page:'backlink-target',context:context(),html:'<h1>Target</h1>',toc:'',warnings:[],
    backlinks:[{page:'source',title:'<img src=x onerror=alert(1)>',url:'/page/source?date=1720-01-01&dm=1'}]};
  let $ = load(document(result,[]));
  assert.equal($('.page-toc .page-backlinks summary').text(),'Linked from');
  assert.equal($('.article-main .page-backlinks').length,0);
  assert.equal($('.layout--no-toc').length,0);
  assert.equal($('.page-toc--backlinks-only').length,1);
  assert.equal($('.page-backlinks a').text(),result.backlinks[0].title);
  assert.equal($('.page-backlinks img').length,0);
  $ = load(document({...result,toc:'<a href="#section">Section</a>',backlinks:[]},[]));
  assert.equal($('.page-toc > .page-contents').length,1);
  assert.equal($('.page-contents .page-nav-title').text(),'On this page');
  assert.equal($('.page-contents summary').length,0);
  assert.equal($('.page-backlinks').length,0);
  $ = load(document({...result,backlinks:[]},[]));
  assert.equal($('.page-toc').length,0);
  $ = load(document({...result,backlinks:undefined},[]));
  assert.equal($('.page-toc').length,0);
});
