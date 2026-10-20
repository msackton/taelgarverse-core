import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {load} from 'cheerio';
import {CampaignSites} from '../src/campaign-sites.mjs';
import {readCampaignHomes} from '../src/website-sources.mjs';
import {ContentStore,parseNote} from '../src/content-store.mjs';
import {RenderEngine} from '../src/render-engine.mjs';
import {handleRequest} from '../src/application.mjs';
import {buildFingerprint,parseOptions} from '../scripts/publish-content.mjs';
import {collectImageUsages} from '../scripts/image-usage.mjs';

const source = (id,body='# Campaign\n\nWelcome.\n\n[[Story]]')=>'---\ncontext: '+id+'\n---\n'+body;
function engine() {
  const registry={campaigns:{cleenseau:{name:'Cleenseau',code:'clee'},'dunmar-frontier':{name:'Dunmar Frontier',code:'dufr'}}};
  const notes={
    'Story.md':'# Story\n\n%%^Campaign:clee%%\nCleenseau text\n%%^End%%\n%%^Campaign:dufr%%\nDunmar text\n%%^End%%\n%% Private comment %%\n\n![[Embedded]]',
    'Embedded.md':'%%^Campaign:clee%%\nCleenseau embed\n%%^End%%\n%%^Campaign:dufr%%\nDunmar embed\n%%^End%%',
    'Cleenseau Session.md':'---\ntags: [session-note]\ncampaign: Cleenseau\nDR: 1720-01-01\n---\n[[Story]]',
    'Dunmar Session.md':'---\ntags: [session-note]\ncampaign: Dunmar Frontier\nDR: 1740-01-01\n---\n[[Story]]',
    'Future.md':'---\ncreated: 1730-01-01\n---\nFuture',
  };
  const store=new ContentStore(Object.entries(notes).map(([id,value])=>({id,target:id.toLowerCase().replaceAll(' ','-'),slug:id.slice(0,-3).toLowerCase().replaceAll(' ','-'),name:id.slice(0,-3),title:id.slice(0,-3),note:parseNote(value),extension:'.md'})));
  return new RenderEngine({settings:{default_date:'1750-01-01'},store,headers:{registry},renderHeader:()=>'',
    navigationSource:'- [Home](index.md)\n- Stories\n    - [Story](story.md)\n    - [Future](future.md)\n',homeSource:'# Main home\n\nShared world.',
    campaignHomes:{cleenseau:source('cleenseau','# Cleenseau home\n\nWelcome.\n\n![[Embedded]]\n\n[[Story]]'),dunmar:source('dunmar-frontier','# Dunmar home\n\nWelcome.\n\n[[Story]]')}});
}
const request=(app,host,url='/')=>handleRequest(new Request('https://'+host+url),app);

test('campaign hosts fix context, date, home and controls across alternating requests',async()=>{
  const app=engine();
  for (const [host,id,date,title] of [['cleenseau.taelgar.org','cleenseau','1720-01-01','Cleenseau home'],['dunmar.taelgar.org','dunmar-frontier','1740-01-01','Dunmar home'],['www.taelgar.org','modern','1740-01-01','Main home'],['cleenseau.localhost','cleenseau','1720-01-01','Cleenseau home']]) {
    const $=load(await (await request(app,host)).text());
    assert.equal($('main h1').text(),title);
    assert.equal($('[data-context-locked]').length,id==='modern'?0:1);
    assert.equal($('#site-context').length,id==='modern'?1:0);
    assert.equal($('.home-destinations').length,id==='modern'?1:0);
    const page=await (await request(app,host,'/api/page?page=Story')).json();
    assert.equal(page.context.id,id);assert.equal(page.date,date);
    assert.equal(page.context.locked,id==='modern'?undefined:true);
    if(id==='cleenseau'){assert.match(page.html,/Cleenseau text/);assert.match(page.html,/Cleenseau embed/);assert.doesNotMatch(page.html,/Dunmar text|Dunmar embed/);}
    const contexts=await (await request(app,host,'/api/contexts')).json();
    assert.equal(contexts.contexts.length,id==='modern'?4:1);
  }
  const $=load(await (await request(app,'cleenseau.taelgar.org')).text());
  assert.match($('.home-prose').text(),/Cleenseau embed/);assert.doesNotMatch($('.home-prose').text(),/Dunmar embed/);
  assert.equal($('.full-site-link').attr('href'),'https://www.taelgar.org/');
  assert.match($('.site-brand').attr('href'),/^\/\?/);
});

test('manual overrides cannot change campaign article, search, navigation, diagrams or DM behavior',async()=>{
  const app=engine(), host='cleenseau.taelgar.org', override='context=custom&context=modern&date=9999-01-01&campaigns=all&campaigns=dufr';
  for(const suffix of ['', '&dm=1']) {
    const page=await (await request(app,host,'/api/page?page=Story&'+override+suffix)).json();
    assert.equal(page.context.id,'cleenseau');assert.equal(page.date,'1720-01-01');assert.deepEqual(page.campaigns,['clee']);
    assert.equal(page.dm,!!suffix);
    assert.equal(page.html.includes('Private comment'),!!suffix);
  }
  const search=await (await request(app,host,'/api/search?q=Future&'+override)).json();
  assert.equal(search.context.id,'cleenseau');assert.equal(search.results.length,0);
  const html=load(await (await request(app,host,'/page/story?'+override)).text());
  assert.equal(html('[data-context-locked]').length,1);
  assert.equal(html('.nav-tree a[href*="future"]').length,0);
  const branch=html('.nav-placeholder a').attr('href');
  if(branch) {
    const node=branch.split('/browse/')[1].split('?')[0];
    const response=await (await request(app,host,'/api/navigation?branch='+node+'&'+override)).json();
    assert.doesNotMatch(response.html,/future/);
    assert.equal((await request(app,host,branch+'&'+override)).status,200);
  }
  const diagrams=await (await request(app,host,'/api/diagram-links?source=Story&target=Future&'+override)).json();
  assert.deepEqual(diagrams.links,[null]);
  const missing=load(await (await request(app,host,'/page/future?'+override)).text());
  assert.equal(missing('[data-context-locked]').length,1);
  assert.equal((await request(app,'www.taelgar.org','/api/page?page=Future&context=dunmar-frontier')).status,200);
});

test('unknown subdomains and undated campaigns never fall back to Modern',async()=>{
  const app=engine();
  for(const host of ['unknown.taelgar.org','nested.cleenseau.taelgar.org','unknown.localhost']) {
    const response=await request(app,host);assert.equal(response.status,404);
    assert.match(await response.text(),/https:\/\/www.taelgar.org\//);
    assert.equal((await request(app,host,'/api/page?page=Story')).status,404);
  }
  app.contexts.byId.get('cleenseau').available=false;
  app.contexts.byId.get('cleenseau').unavailableReason='No published session date';
  const response=await request(app,'cleenseau.taelgar.org');assert.equal(response.status,400);
  assert.match(await response.text(),/No published session date/);
  for(const homes of [{cleenseau:source('modern')},{cleenseau:source('unknown')},{www:source('cleenseau')},{'Bad Host':source('cleenseau')},{cleenseau:12},{cleenseau:'---\ncontext: [\n---\nInvalid'},[]])assert.throws(()=>new CampaignSites(homes,app.contexts));
});

test('discovery opts in only explicit Markdown homes; fingerprints notice edits, adds and removals',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'taelgar-sites-'));
  t.after(()=>{assert.equal(path.dirname(directory),os.tmpdir());assert.ok(path.basename(directory).startsWith('taelgar-sites-'));fs.rmSync(directory,{recursive:true});});
  const website=path.join(directory,'_website');fs.mkdirSync(website);
  const settings={vault_dir:directory,default_date:'1750-01-01'},options=parseOptions([]);
  const original=buildFingerprint(settings,options);
  fs.writeFileSync(path.join(website,'private.md'),'Private website plan.');
  fs.writeFileSync(path.join(website,'home.md'),'# Main');
  assert.deepEqual(readCampaignHomes(settings),{});assert.equal(buildFingerprint(settings,options),original);
  const file=path.join(website,'dunmar.md');fs.writeFileSync(file,source('dunmar-frontier'));
  assert.equal(readCampaignHomes(settings).dunmar,source('dunmar-frontier'));
  const added=buildFingerprint(settings,options);assert.notEqual(added,original);
  fs.writeFileSync(file,source('dunmar-frontier').replaceAll('\n','\r\n'));assert.equal(buildFingerprint(settings,options),added);
  fs.appendFileSync(file,'\nUpdated');assert.notEqual(buildFingerprint(settings,options),added);
  fs.unlinkSync(file);assert.equal(buildFingerprint(settings,options),original);
  fs.writeFileSync(path.join(website,'Bad Host.md'),source('cleenseau'));assert.throws(()=>readCampaignHomes(settings),/filename/);
});

test('campaign landing images contribute responsive-image usages',()=>{
  const app=engine();
  const store=new ContentStore([...app.store.entries,{id:'picture.png',target:'picture.png',extension:'.png',note:null}]);
  const usages=collectImageUsages(store,{campaignHomes:{cleenseau:source('cleenseau','![[picture.png|350]]')}});
  assert.ok(usages.size>0);
});
