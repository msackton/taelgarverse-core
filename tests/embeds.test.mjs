import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {load} from 'cheerio';
import {ContentStore,parseNote} from '../src/content-store.mjs';
import {RenderEngine} from '../src/render-engine.mjs';
import {buildBacklinkIndex} from '../src/backlinks.mjs';

function engine(sources,{lazy=false,backlinks=false,homeSource=null}={}) {
  const notes = new Map();
  const entries = Object.entries(sources).map(([id,source])=>{
    const name = path.posix.basename(id,'.md'), note = parseNote(source);
    notes.set(id,note);
    const slug = id.slice(0,-3).toLowerCase().replaceAll(' ','-');
    return {id,name,title:name,target:slug+'.md',slug,note:lazy ? {metadata:note.metadata} : note};
  });
  entries.push({id:'Sources/portrait.png',target:'sources/portrait.png',extension:'.png'});
  const store = new ContentStore(entries);
  const renderer = new RenderEngine({store,settings:{default_date:'1750-01-01',campaigns:[]},
    headers:{registry:{campaigns:{frontier:{code:'dufr',name:'Frontier'},march:{code:'adma',name:'March'}}}},
    renderHeader:()=>{throw new Error('Embedded headers must not regenerate');},navigationSource:'',homeSource,
    backlinkIndex:backlinks ? undefined : null});
  return {renderer,store,notes};
}
const render = (app,page='Parent',campaigns=[],dm=false,date='1750-01-01') => app.renderer.render(page,date,'custom',dm,undefined,campaigns);
const text = result => load(result.html,{},false).text();

test('whole-note embeds preserve source-relative links/media, nested content and the host TOC',()=>{
  const app = engine({'Parent.md':'# Parent\n\n## Host section\n\n![[Sources/Child]]',
    'Sources/Child.md':'# Child\n\nChild prose. [target](../Targets/Other.md#history) ![[./portrait.png]]\n\n![[Nested]]',
    'Targets/Other.md':'# Other', 'Nested.md':'Nested prose.'});
  const result = render(app), $ = load(result.html,{},false);
  assert.equal($('.note-embed').length,2);
  assert.match($.text(),/Child prose/); assert.match($.text(),/Nested prose/);
  assert.equal($('.note-embed-content h2').first().text(),'Child');
  assert.equal($('img').attr('src'),'/assets/sources/portrait.png');
  assert.equal($('a').filter((_,el)=>$(el).text()==='target').attr('href'),'/page/targets/other?date=1750-01-01#history');
  assert.match(result.toc,/Host section/); assert.doesNotMatch(result.toc,/Child|Nested/);
});

test('heading embeds select nested subheadings, including headings inside callouts',()=>{
  const app = engine({'Parent.md':'![[Child#Travels]]\n\n![[Child#Inside]]',
    'Child.md':'# Child\n\nBefore section.\n\n## Travels\n\nVoyage.\n\n### Detail\n\nDetail prose.\n\n## After\n\nOutside prose.\n\n> [!note] Wrapped\n> ## Inside\n> Wrapped prose.\n> ## Outside\n> Hidden by section selection.'});
  const result = render(app), $ = load(result.html,{},false);
  assert.equal($('.note-embed').length,2);
  assert.match($.text(),/Voyage/); assert.match($.text(),/Detail prose/); assert.match($.text(),/Wrapped prose/);
  assert.doesNotMatch($.text(),/Before section|Outside prose|Hidden by section selection/);
  assert.equal($('.note-embed .admonition.note').length,1);
  assert.deepEqual(result.warnings,[]);
});

test('block embeds and ordinary block links share anchors; literal syntax stays literal',()=>{
  const app = engine({'Parent.md':'![[Child#^quote]] ![[Child#^list]]\n\n`![[Unknown]]`\n\n```\n![[Unknown]]\n```',
    'Child.md':'Chosen paragraph. ^quote\n\nOther paragraph.\n\n- First\n- Chosen item ^list\n\n[[#^quote|jump]]'});
  const result = render(app), $ = load(result.html,{},false);
  assert.equal($('.note-embed').length,2); assert.equal($('.note-embed ul li').length,1);
  assert.match($.text(),/Chosen paragraph/); assert.match($.text(),/Chosen item/);
  assert.doesNotMatch($.text(),/Other paragraph|\^quote|\^list/);
  assert.equal($('code').length,2); assert.match($('code').first().text(),/!\[\[Unknown\]\]/);
  assert.deepEqual(result.warnings,[]);
  const child = load(render(app,'Child').html,{},false);
  assert.equal(child('a').attr('href'),'#quote'); assert.equal(child('#quote').text(),'Chosen paragraph.');
});

test('embeds apply parent/child campaign, date, exclusion and Behind the Curtain rules',()=>{
  const app = engine({'Parent.md':'![[Child]]\n\n![[Hidden]] ![[Future]]\n\n%%^Campaign:adma%%\n![[March]]\n%%^End%%',
    'Child.md':'Shared.\n\n%%^Campaign:dufr%%\nFrontier-only.\n%%^End%%\n\n%%^Date:1740-01-01%%\nLater.\n%%^End%%\n\n%%DM Popup secret.%%\n\n%%^Campaign:none%%\nDM-only body.\n%%^End%%',
    'Hidden.md':'---\nexcludePublish: all\n---\nAlways hidden.',
    'Future.md':'---\ncreated: 1740-01-01\n---\nFuture visible.', 'March.md':'March-only.'});
  const early = render(app,'Parent',[],false,'1730-01-01');
  assert.match(text(early),/Shared/);
  assert.doesNotMatch(early.html,/Frontier-only|Later\.|Popup secret|DM-only body|Always hidden|Future visible|March-only/);
  const all = render(app,'Parent',['all'],true);
  for (const expected of ['Frontier-only','Later.','Popup secret','DM-only body','Future visible','March-only']) assert.ok(text(all).includes(expected),expected);
  assert.doesNotMatch(all.html,/Always hidden/);
});

test('repeated inline embeds have unique heading, footnote and DM popup IDs and valid paragraphs',()=>{
  const app = engine({'Parent.md':'Before ![[Child]] middle ![[Child]] after.',
    'Child.md':'## Detail\n\nFootnote[^one] and [[#Detail|local]]. %%DM Popup.%%\n\n[^one]: Footnote body.'});
  const result = render(app,'Parent',[],true), $ = load(result.html,{},false);
  assert.equal($('.note-embed').length,2); assert.equal($('.note-embed .dm-note-popup').length,2);
  const ids = $('[id]').map((_,el)=>$(el).attr('id')).get();
  assert.equal(new Set(ids).size,ids.length);
  $('a[href^="#"],[popovertarget]').each((_,el)=>{
    const id = $(el).attr('popovertarget') || $(el).attr('href').slice(1);
    assert.ok(ids.includes(id),id);
  });
  assert.deepEqual($.root().children('p').map((_,el)=>$(el).text()).get(),['Before ',' middle ',' after.']);
  assert.equal($('p .note-embed').length,0);
  const formatted=render(engine({'Parent.md':'Start **bold ![[Child]] bold** end.','Child.md':'Embedded.'}));
  const formattedDOM=load(formatted.html,{},false);
  assert.equal(formattedDOM('.note-embed').length,1);
  assert.equal(formattedDOM('p .note-embed').length,0);
  assert.deepEqual(formattedDOM('p strong').map((_,el)=>formattedDOM(el).text()).get(),['bold ',' bold']);
});

test('missing and ambiguous embed targets retain readable labels without including a candidate',()=>{
  const app=engine({'Parent.md':'![[Missing|Missing note]] ![[Same|Ambiguous note]]',
    'A/Same.md':'First candidate.','B/Same.md':'Second candidate.'});
  const result=render(app);
  assert.match(text(result),/Missing note/); assert.match(text(result),/Ambiguous note/);
  assert.doesNotMatch(result.html,/First candidate|Second candidate|class="note-embed"/);
  assert.ok(result.warnings.some(w=>w.startsWith('Missing wikilink target')));
  assert.ok(result.warnings.some(w=>w.startsWith('Ambiguous link candidates')));
});

test('heading selection includes only its own footnotes, popups and nested embeds',async()=>{
  const app = engine({'Parent.md':'![[Child#Chosen]]',
    'Child.md':'## Before\n\nBefore[^a]. %%DM Before secret.%%\n\n![[Unselected]]\n\n## Chosen\n\nChosen[^b]. %%DM Chosen secret.%%\n\n![[Selected]]\n\n## After\n\nAfter[^c]. %%DM After secret.%%\n\n[^a]: Before footnote.\n[^b]: Chosen footnote.\n[^c]: After footnote.',
    'Unselected.md':'Unselected embed.', 'Selected.md':'Selected embed.'},{lazy:true});
  const calls = [];
  const result = await app.renderer.renderAsync('Parent','1750-01-01','custom',true,[],async entry=>{calls.push(entry.id);return app.notes.get(entry.id);});
  for (const expected of ['Chosen footnote','Chosen secret','Selected embed']) assert.ok(text(result).includes(expected),expected);
  assert.doesNotMatch(result.html,/Before footnote|Before secret|After footnote|After secret|Unselected embed/);
  assert.deepEqual(calls,['Parent.md','Child.md','Selected.md']);
});

test('self-heading embeds work; recursion, missing sections and malformed child comments recover safely',()=>{
  const app = engine({'Parent.md':'# Parent\n\n![[#Selected]]\n\n![[Loop]] ![[Child#Missing]] ![[Unsafe]]\n\n## Selected\n\nOwn prose.',
    'Loop.md':'![[Loop]]', 'Child.md':'## Different\n\nOther prose.',
    'Unsafe.md':'Safe-looking prose.\n\n%%^Campaign:dufr%%\nUnsafe prose.'});
  const result = render(app);
  assert.equal((text(result).match(/Own prose/g) || []).length,2);
  assert.doesNotMatch(result.html,/Other prose|Safe-looking prose|Unsafe prose/);
  assert.ok(result.warnings.some(w=>w.startsWith('Recursive note embed')));
  assert.ok(result.warnings.some(w=>w.startsWith('Embedded section unavailable')));
  assert.ok(result.warnings.some(w=>w.startsWith('Cannot safely render embedded note')));
});

test('expansion limits bound recursive fan-out and depth',()=>{
  const sources = {'Parent.md':'![[Child]] '.repeat(40),'Child.md':'Child prose.'};
  const repeated = render(engine(sources));
  assert.equal(load(repeated.html,{},false)('.note-embed').length,32);
  assert.ok(repeated.warnings.some(w=>w.startsWith('Note embed limit')));
  const chain = {'Parent.md':'![[Link0]]'};
  for (let i=0;i<15;i++) chain['Link'+i+'.md']='![[Link'+(i+1)+']]';
  const deep = render(engine(chain));
  assert.equal(load(deep.html,{},false)('.note-embed').length,8);
  assert.ok(deep.warnings.some(w=>w.startsWith('Note embed limit')));
});

test('generated callouts are omitted; backlinks remain direct authored references',()=>{
  const app = engine({'Parent.md':'![[Legacy]]\n\n![[Prepared]]',
    'Legacy.md':'---\nheaderVersion: old\ntags: [object]\n---\n> [!taelgar-header]\n> Private stale details.\n\nLegacy body [[Target]].',
    'Prepared.md':'> [!taelgar-header]\n\nPrepared body.', 'Target.md':'Target.'},{backlinks:true});
  const result = render(app);
  assert.match(text(result),/Legacy body/); assert.match(text(result),/Prepared body/);
  assert.doesNotMatch(result.html,/Stale header|Private stale details|taelgar:header/);
  const index = buildBacklinkIndex(app.store);
  assert.deepEqual(index.byTarget.legacy.map(edge=>edge.source),['parent']);
  assert.deepEqual(index.byTarget.target.map(edge=>edge.source),['legacy']);
});

test('lazy loads are request-local and skip excluded, future and parent-filtered embeds',async()=>{
  const app = engine({'Parent.md':'![[Child]] ![[Hidden]] ![[Future]]\n\n%%^Campaign:dufr%%\n![[Campaign]]\n%%^End%%',
    'Child.md':'Public.\n\n%%^Campaign:dufr%%\nFrontier.\n%%^End%%',
    'Hidden.md':'---\nexcludePublish: all\n---\nHidden.', 'Future.md':'---\ncreated: 1800-01-01\n---\nFuture.', 'Campaign.md':'Selected campaign.'},{lazy:true});
  const requests = [[],['dufr']].map(async campaigns=>{
    const calls = [];
    const result = await app.renderer.renderAsync('Parent','1750-01-01','custom',false,campaigns,async entry=>{calls.push(entry.id);return app.notes.get(entry.id);});
    return {calls,result};
  });
  const [modern,frontier] = await Promise.all(requests);
  assert.deepEqual(modern.calls,['Parent.md','Child.md']);
  assert.deepEqual(frontier.calls,['Parent.md','Child.md','Campaign.md']);
  assert.doesNotMatch(modern.result.html,/Frontier\.|Selected campaign/);
  assert.match(frontier.result.html,/Frontier\./); assert.match(frontier.result.html,/Selected campaign/);
});
