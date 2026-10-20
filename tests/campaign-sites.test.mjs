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

const source = (id,body='# Campaign\n\nWelcome.\n\n[[Story]]')=>'---\ncampaigns: ['+id+']\n---\n'+body;
function engine(campaignHomes={},settings={}) {
  const registry={campaigns:{cleenseau:{name:'Cleenseau',code:'clee'},'dunmar-frontier':{name:'Dunmar Frontier',code:'dufr'},'lost-in-the-feywild':{name:'Lost in the Feywild',code:'feywild',aliases:['litf']},'mawar-adventures':{name:'Mawar Adventures',code:'mawar'}}};
  const notes={
    'Story.md':'# Story\n\n%%^Campaign:clee%%\nCleenseau text\n%%^End%%\n%%^Campaign:dufr%%\nDunmar text\n%%^End%%\n%% Private comment %%\n\n![[Embedded]]',
    'Embedded.md':'%%^Campaign:clee%%\nCleenseau embed\n%%^End%%\n%%^Campaign:dufr%%\nDunmar embed\n%%^End%%\n%%^Campaign:feywild%%\nFeywild embed\n%%^End%%\n%%^Campaign:mawar%%\nMawar embed\n%%^End%%',
    'Cleenseau Session.md':'---\ntags: [session-note]\ncampaign: Cleenseau\nDR: 1720-01-01\n---\n[[Story]]',
    'Dunmar Session.md':'---\ntags: [session-note]\ncampaign: Dunmar Frontier\nDR: 1740-01-01\n---\n[[Story]]',
    'Future.md':'---\ncreated: 1730-01-01\n---\nFuture',
    'POV.md':'---\nPOV: 1730s\n---\nPerspective body marker.',
  };
  const store=new ContentStore(Object.entries(notes).map(([id,value])=>({id,target:id.toLowerCase().replaceAll(' ','-'),slug:id.slice(0,-3).toLowerCase().replaceAll(' ','-'),name:id.slice(0,-3),title:id.slice(0,-3),note:parseNote(value),extension:'.md'})));
  return new RenderEngine({settings:{default_date:'1750-01-01',...settings},store,headers:{registry},renderHeader:()=>'',
    navigationSource:'- [Home](index.md)\n- Stories\n    - [Story](story.md)\n    - [Future](future.md)\n    - [POV](pov.md)\n',homeSource:'# Main home\n\nShared world.',
    campaignHomes:{cleenseau:source('cleenseau','# Cleenseau home\n\nWelcome.\n\n![[Embedded]]\n\n[[Story]]'),dunmar:source('dunmar-frontier','# Dunmar home\n\nWelcome.\n\n[[Story]]'),...campaignHomes}});
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
    assert.equal(contexts.contexts.length,id==='modern'?6:1);
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
  for(const homes of [{cleenseau:source('modern')},{cleenseau:source('unknown')},{www:source('cleenseau')},{'Bad Host':source('cleenseau')},{cleenseau:12},{cleenseau:'---\ncampaigns: [\n---\nInvalid'},[]])assert.throws(()=>new CampaignSites(homes,app.contexts));
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
  fs.writeFileSync(file,source('dunmar-frontier').replace('campaigns:','enforcePoV: 1\ncampaigns:'));
  assert.notEqual(buildFingerprint(settings,options),added);
  fs.writeFileSync(file,source('dunmar-frontier'));
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

const combinedHome = '---\ntitle: Dunmar, Feywild & Mawar\ncampaigns: [dunmar-frontier, litf, Mawar Adventures, dufr]\n---\n# Three campaigns\n\nWelcome.\n\n![[Embedded]]\n\n[[Story]]\n\n[[Future]]';
test('a campaign subset and Modern date remain sticky across the whole site',async()=>{
  const app=engine({combined:combinedHome,historic:combinedHome.replace('campaigns:','date: 1720-01-01\ncampaigns:')}),host='combined.taelgar.org';
  const overrides='context=cleenseau&date=0001-01-01&campaigns=clee&campaigns=all';
  for(const dm of ['', '&dm=1']) {
    const page=await(await request(app,host,'/api/page?page=Story&'+overrides+dm)).json();
    assert.equal(page.context.id,'custom');assert.equal(page.context.label,'Dunmar, Feywild & Mawar');
    assert.equal(page.context.locked,true);assert.equal(page.date,'1740-01-01');assert.deepEqual(page.campaigns,['dufr','feywild','mawar']);
    assert.match(page.html,/Dunmar text/);assert.match(page.html,/Feywild embed/);assert.match(page.html,/Mawar embed/);
    assert.doesNotMatch(page.html,/Cleenseau text|Cleenseau embed/);assert.equal(page.html.includes('Private comment'),!!dm);
  }
  const $=load(await(await request(app,host,'/?'+overrides)).text());
  assert.equal($('#site-context').length,0);assert.match($('[data-context-locked]').text(),/Dunmar, Feywild & Mawar · 1740-01-01 DR/);
  assert.match($('.home-prose').text(),/Feywild embed/);assert.match($('.home-prose').text(),/Mawar embed/);assert.doesNotMatch($('.home-prose').text(),/Cleenseau embed/);
  const articleLink=$('.home-prose a[href*="/page/story"]').attr('href');assert.ok(articleLink);
  const article=load(await(await request(app,host,articleLink)).text());assert.equal(article('[data-context-locked]').length,1);
  const contexts=await(await request(app,host,'/api/contexts?'+overrides)).json();
  assert.equal(contexts.contexts.length,1);assert.equal(contexts.contexts[0].date,'1740-01-01');assert.deepEqual(contexts.contexts[0].campaigns,['dufr','feywild','mawar']);
  const search=await(await request(app,host,'/api/search?q=Future&'+overrides)).json();
  assert.equal(search.context.locked,true);assert.equal(search.results.length,1);
  const searchHtml=load(await(await request(app,host,'/?q=Future&'+overrides)).text());assert.equal(searchHtml('[data-context-locked]').length,1);
  const branch=article('a[href*="/browse/"]').first().attr('href');assert.ok(branch);
  const node=branch.split('/browse/')[1].split('?')[0];
  const navigation=await(await request(app,host,'/api/navigation?branch='+node+'&'+overrides)).json();assert.match(navigation.html,/future/);
  const browse=load(await(await request(app,host,branch+'&'+overrides)).text());assert.equal(browse('[data-context-locked]').length,1);
  const diagrams=await(await request(app,host,'/api/diagram-links?source=Story&target=Future&'+overrides)).json();assert.match(diagrams.links[0].href,/\/page\/future/);
  const historic=await(await request(app,'historic.taelgar.org','/api/search?q=Future&'+overrides)).json();assert.equal(historic.context.date,'1720-01-01');assert.equal(historic.results.length,0);
  assert.equal((await request(app,'historic.taelgar.org','/api/page?page=Future&'+overrides)).status,404);
  assert.deepEqual((await(await request(app,'www.taelgar.org','/api/page?page=Story')).json()).campaigns,[]);
  assert.deepEqual((await(await request(app,'cleenseau.taelgar.org','/api/page?page=Story')).json()).campaigns,['clee']);
});

test('omitted or Modern dates follow Modern while an explicit date remains fixed',async()=>{
  const app=engine({combined:combinedHome,explicit:combinedHome.replace('campaigns:','date: modern\ncampaigns:'),historic:combinedHome.replace('campaigns:','date: 1720-01-01\ncampaigns:')});
  app.contexts.byId.get('modern').date='1755-06-03';
  for(const [host,date] of [['combined','1755-06-03'],['explicit','1755-06-03'],['historic','1720-01-01']]) {
    const page=await(await request(app,host+'.localhost','/api/page?page=Story&date=bad&campaigns=unknown')).json();assert.equal(page.date,date);
  }
});

test('one distinct campaign always follows its session date, including names, duplicates and authored dates',async()=>{
  const app=engine({single:source('clee'),named:source('Cleenseau'),duplicates:source('clee, cleenseau, Cleenseau'),dated:source('clee').replace('campaigns:','date: 1740-01-01\ncampaigns:'),modern:source('clee').replace('campaigns:','date: modern\ncampaigns:')});
  app.contexts.byId.get('cleenseau').date='1721-02-03';
  app.contexts.byId.get('modern').date='1755-06-03';
  for(const host of ['single','named','duplicates','dated','modern']) {
    const page=await(await request(app,host+'.taelgar.org','/api/page?page=Story&date=9999-01-01&campaigns=all')).json();
    assert.equal(page.date,'1721-02-03');assert.equal(page.context.dateSource,'latest-session');assert.equal(page.context.id,'cleenseau');
    assert.deepEqual(page.campaigns,['clee']);assert.equal(page.context.locked,true);
  }
});

test('a single undated campaign stays unavailable even with an authored date',async()=>{
  const app=engine({undated:source('mawar').replace('campaigns:','date: 1740-01-01\ncampaigns:'),combined:combinedHome});
  const response=await request(app,'undated.taelgar.org');assert.equal(response.status,400);assert.match(await response.text(),/No published session date/);
  assert.equal((await request(app,'combined.taelgar.org')).status,200);
});

test('landing metadata rejects invalid dates, campaigns and removed context metadata',()=>{
  const app=engine(),home=metadata=>'---\n'+metadata+'\n---\n# Home';
  for(const metadata of ['campaigns: [unknown]','campaigns: [dufr]\ndate: 1740-02-29','campaigns: [dufr]\ndate: 1740','campaigns: [dufr]\ndate: null','campaigns: [dufr]\ntitle: []','campaigns: [dufr]\ncontext: cleenseau','context: cleenseau','context: cleenseau\ndate: 1740-01-01','campaigns: {dufr: true}','campaigns: [null]']) {
    assert.throws(()=>new CampaignSites({combined:home(metadata)},app.contexts),error=>error.status===503 && error.message.includes('_website/combined.md'));
  }
  for(const campaigns of ['all','[]','dufr, litf, mawar'])assert.doesNotThrow(()=>new CampaignSites({combined:home('campaigns: '+campaigns)},app.contexts));
});

test('discovery and publication fingerprints include multi-campaign metadata',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'taelgar-multi-sites-'));
  t.after(()=>{assert.equal(path.dirname(directory),os.tmpdir());assert.ok(path.basename(directory).startsWith('taelgar-multi-sites-'));fs.rmSync(directory,{recursive:true});});
  fs.mkdirSync(path.join(directory,'_website'));
  const settings={vault_dir:directory},options=parseOptions([]),before=buildFingerprint(settings,options),file=path.join(directory,'_website','dunmar.md');
  fs.writeFileSync(file,combinedHome);assert.equal(readCampaignHomes(settings).dunmar,combinedHome);
  const added=buildFingerprint(settings,options);assert.notEqual(added,before);
  fs.writeFileSync(file,combinedHome.replace('campaigns:','date: 1720-01-01\ncampaigns:'));assert.notEqual(buildFingerprint(settings,options),added);
  fs.unlinkSync(file);assert.equal(buildFingerprint(settings,options),before);
  fs.writeFileSync(file,'---\ncontext: cleenseau\n---\n# Old homepage');
  assert.throws(()=>new CampaignSites(readCampaignHomes(settings),engine().contexts),/context is no longer supported/);
});

test('microsite enforcePoV overrides URL choices and site defaults across all page surfaces',async()=>{
  const home=value=>'---\ncampaigns: [clee]\n'+(value===undefined?'':'enforcePoV: '+value+'\n')+'---\n# Perspective home\n\n[[POV]]\n\n![[POV]]';
  for (const respect_pov_dates of [false,true]) {
    const app=engine({enabled:home(1),disabled:home(0),inherited:home(),combined:'---\ncampaigns: [clee, dufr]\ndate: 1720-01-01\nenforcePoV: 1\n---\n# Combined'}, {respect_pov_dates});
    for (const [host,enforced] of [['enabled',true],['disabled',false],['combined',true]]) for (const pov of [undefined,'0','1','invalid']) {
      const query=pov===undefined?'':'pov='+pov;
      const visible=!enforced,domain=host+'.taelgar.org';
      assert.equal((await request(app,domain,'/api/page?page=POV&'+query)).status,visible?200:404);
      assert.equal((await request(app,domain,'/page/pov?'+query)).status,visible?200:404);
      const story=await (await request(app,domain,'/api/page?page=Story&'+query)).json();
      assert.equal(story.context.pov,enforced);assert.equal(story.date,'1720-01-01');
      const result=await (await request(app,domain,'/api/search?q=POV&'+query)).json();
      assert.equal(result.context.pov,enforced);assert.equal(result.results.length,visible?1:0);
      const links=await (await request(app,domain,'/api/diagram-links?source=Story&target=POV&'+query)).json();
      assert.equal(Boolean(links.links[0]),visible);
      const $=load(await (await request(app,domain,'/?'+query)).text());
      assert.equal($('#context-controls input[name="pov"]').val(),enforced?'1':'0');
      if (host!=='combined') assert.equal($('.home-prose').text().includes('Perspective body marker.'),visible);
      const lazy=$('[data-nav-url]').first().attr('data-nav-url');
      const branch=await (await request(app,domain,lazy+'&'+query)).json();
      assert.equal(branch.html.includes('/page/pov?'),visible);
    }
    for (const pov of [undefined,'0','1']) {
      const enabled=pov===undefined?respect_pov_dates:pov==='1';
      const response=await request(app,'inherited.taelgar.org','/api/page?page=POV'+(pov===undefined?'':'&pov='+pov));
      assert.equal(response.status,enabled?404:200);
    }
    assert.equal(app.settings.respect_pov_dates,respect_pov_dates);
  }
});

test('microsite enforcePoV accepts 1 or 0 and rejects malformed landing-page values',()=>{
  const contexts=engine().contexts;
  for (const value of [1,0,'"1"','"0"']) {
    const sites=new CampaignSites({forced:'---\ncampaigns: [clee]\nenforcePoV: '+value+'\n---\n# Home'},contexts);
    assert.equal(sites.byHost.get('forced').enforcePoV,String(value).includes('1'));
  }
  for (const value of ['2','-1','null','true','false','[]','{}','yes','""']) {
    assert.throws(()=>new CampaignSites({forced:'---\ncampaigns: [clee]\nenforcePoV: '+value+'\n---\n# Home'},contexts),/_website\/forced\.md: enforcePoV must be 1 or 0/);
  }
});
