import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from 'cheerio';
import {createMarkdown,renderMarkdown} from '../src/markdown.mjs';

function render(source) {
  const entries = new Map([
    ['Target',{note:{},slug:'places/target'}],
    ['portrait.png',{extension:'.png',target:'assets/portrait.png'}],
  ]);
  const env = {entry:{id:'People/Example.md',target:'people/example.md'},date:'1730-01-01',warnings:[],
    store:{lookup:target => entries.has(target) ? {status:'found',entry:entries.get(target)} : {status:'missing'}}};
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
