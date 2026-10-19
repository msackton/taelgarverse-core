import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from 'cheerio';
import {createMarkdown,renderMarkdown} from '../src/markdown.mjs';
import {ContentStore} from '../src/content-store.mjs';

function render(source, {metadata = {}, context = {id:'custom',kind:'custom',date:'1730-01-01',campaigns:[]}} = {}) {
  const store = new ContentStore([
    {id:'Places/Target.md',name:'Target',target:'places/target.md',note:{metadata:{aliases:['Sovereign'],...metadata}},slug:'places/target'},
    {id:'assets/portrait.png',extension:'.png',target:'assets/portrait.png'},
  ]);
  const env = {entry:{id:'People/Example.md',target:'people/example.md'},date:context.date,context,warnings:[],store};
  return {...renderMarkdown(createMarkdown(),source,env),warnings:env.warnings};
}
test('footnotes, definition lists, attrs and inline date fields',() => {
  const result = render('Term\n: Definition\n\nA footnote[^one]. (DR:: 1749-03-17)\n\n[^one]: Footnote text\n\nParagraph.\n{ .bio }\n');
  const $ = load(result.html,{},false);
  assert.equal($('dl').length,1);
  assert.ok($('sup.footnote-ref').length);
  assert.match($.text(),/Mar 17, 1749 DR/);
  assert.equal($('p.bio').length,1);
});
test('nested and foldable callouts, semantic image roles',() => {
  const source = '> [!note]+ Outer\n> Body.\n>> [!warning]- Inner\n>> Nested.\n\n> [!image|right small] Portrait\n> ![[portrait.png]]\n';
  const $ = load(render(source).html,{},false);
  assert.equal($('details.note[open]').length,1);
  assert.equal($('details.note details.warning:not([open])').length,1);
  assert.equal($('.taelgar-image--aside.taelgar-image--size-small').length,1);
});
test('wikilinks, heading anchors, code literals, image alt and dimensions',() => {
  const bt = String.fromCharCode(96);
  const result = render('[[Target#A Heading|label]] [[#A Heading]] ![[portrait.png|right|small]] ![[portrait.png|400x200]]\n\n' +
    bt + '[[Target]] (DR:: 1749)' + bt + '\n\n' + bt.repeat(3) + '\n[[Target]]\n' + bt.repeat(3));
  const $ = load(result.html,{},false);
  assert.equal($('a').first().attr('href'),'/page/places/target?date=1730-01-01#a-heading');
  assert.equal($('a').eq(1).attr('href'),'#a-heading');
  assert.equal($('img').first().attr('alt'),'Portrait');
  assert.equal($('img').eq(1).attr('width'),'400'); assert.equal($('img').eq(1).attr('height'),'200');
  assert.match($('code').first().text(),/\[\[Target\]\] \(DR:: 1749\)/);
  assert.match($('pre code').text(),/\[\[Target\]\]/);
});
test('unknown links warn; duplicate headings get distinct anchors',() => {
  const result = render('# Same\n\n## Same\n\n[[Unknown|Readable]]');
  const $ = load(result.html,{},false);
  assert.equal($('h1').attr('id'),'same'); assert.equal($('h2').attr('id'),'same_1');
  assert.match($.text(),/Readable/);
  assert.deepEqual(result.warnings,['Missing wikilink target: Unknown']);
});

test('page links follow campaign exclusions and date boundaries across link formats',() => {
  const source = [
    '[[Target|the old king]]', '[[Target#History|his history]]', '[[Sovereign|an alias]]',
    '[**formatted** label](../Places/Target.md#History)', '[exported](../places/target.md)',
    '[encoded](../Places/%54arget.md)', '[site](/page/places/target?date=1800-01-01#history)',
    '<a href="/page/places/target.md/?context=modern"><em>HTML</em> label</a>',
    '[reference][king]\n\n[king]: ../Places/Target.md',
  ].join('\n\n');
  for (const [metadata,campaigns,date,visible] of [
    [{excludePublish:'all'},[],'1800-01-01',false],
    [{excludePublish:'DUFR, itc'},['dufr'],'1730-01-01',false],
    [{excludePublish:['dufr']},['adma'],'1730-01-01',true],
    [{excludePublish:['dufr']},[],'1730-01-01',true],
    [{born:'1730-04-02'},[],'1730-04-01',false],
    [{born:'1730-04-02'},[],'1730-04-02',true],
    [{created:'1730-04-02'},[],'1730-04-01',false],
    [{created:'1730-04-02'},[],'1730-04-02',true],
    [{activeYear:1740},[],'1739-12-31',false],
    [{activeYear:1740},[],'1740-01-01',true],
  ]) for (const dm of [false,true]) {
    const context = {id:'custom',kind:'custom',date,campaigns,dm};
    const result = render(source,{metadata,context}), $ = load(result.html,{},false);
    assert.equal($('a').length,visible ? 9 : 0,JSON.stringify({metadata,context}));
    assert.match($.text(),/the old king/);
    assert.match($.text(),/his history/);
    assert.match($.text(),/an alias/);
    assert.equal($('strong').text(),'formatted');
    assert.equal($('em').text(),'HTML');
    assert.deepEqual(result.warnings,[]);
  }
});

test('unlinked contents retain escaping and images; external, asset, heading and literal links stay intact',() => {
  const source = [
    '[[Target|<img src=x onerror=alert(1)>]]',
    '[![portrait](../assets/portrait.png)](../Places/Target.md)',
    '[outside](https://example.com/page/places/target) [protocol](//example.com/page/places/target)',
    '[mail](mailto:test@example.com) [asset](/assets/assets/portrait.png) [[#History]]',
    '`[[Target]]`\n\n```md\n[Target](../Places/Target.md)\n```',
  ].join('\n\n');
  const result = render(source,{metadata:{excludePublish:'all'}}), $ = load(result.html,{},false);
  assert.equal($('a[href^="/page/"]').length,0);
  assert.equal($('a').length,5);
  assert.equal($('img').length,1);
  assert.equal($('img').parent().is('a'),false);
  assert.equal($('img').attr('src'),'/assets/assets/portrait.png');
  assert.match($.text(),/<img src=x onerror=alert\(1\)>/);
  assert.equal($('code').first().text(),'[[Target]]');
  assert.equal($('pre code').text().trim(),'[Target](../Places/Target.md)');
  assert.deepEqual(result.warnings,[]);
});
test('icon shortcodes preserve earlier inline markup',() => {
  const $ = load(render('**Bold** [link](https://example.com) :octicons-info-24:{ .lg .middle } after.').html,{},false);
  assert.equal($('strong').text(),'Bold');
  assert.equal($('a').text(),'link');
  assert.equal($('.twemoji.lg.middle svg').length,1);
});

test('page TOC follows heading hierarchy, omits the title and preserves duplicate anchors',()=>{
  const result = render('# Page title\n\n## First\n\n### Child\n\n#### Detail\n\n## Second\n\n### Child\n');
  const $ = load(result.toc,{},false);
  assert.deepEqual($('.toc > ul > li > a').map((_,el)=>$(el).text()).get(),['First','Second']);
  assert.equal($('a[href="#page-title"]').length,0);
  assert.equal($('a[href="#child_1"]').length,1);
  assert.equal($('.toc > ul > li').first().find('ul ul a').text(),'Detail');
  assert.equal(render('# Only a title').toc,'');
});

test('Mermaid fences preserve escaped source as a readable fallback without affecting ordinary fences or TOC',()=>{
  const definition = 'graph TD\nA["<img src=x onerror=alert(1)>"] --> B["[[Target]]"]\n';
  const result = render('## Family\n\n```mermaid \n' + definition + '```\n\n```js\nconst x = 1;\n```\n');
  const $ = load(result.html,{},false);
  assert.equal($('.mermaid-diagram').length,1);
  assert.equal($('.mermaid-output[role="region"][tabindex="0"]').length,1);
  assert.equal($('.mermaid-source[open] code').text(),definition);
  assert.equal($('.mermaid-diagram img,.mermaid-diagram a,.mermaid-diagram script').length,0);
  assert.match($('code.language-js').text(),/const x = 1/);
  assert.equal(load(result.toc)('a').text(),'Family');
  assert.deepEqual(result.warnings,[]);
});
