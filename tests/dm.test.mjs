import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from 'cheerio';
import {filterComments} from '../src/comments.mjs';
import {createMarkdown,renderMarkdown} from '../src/markdown.mjs';

function render(source, dm = true) {
  const notes = [], warnings = [];
  const body = filterComments(source,{dm,notes,date:'1730-01-01',campaigns:['dufr']});
  const result = renderMarkdown(createMarkdown(),body,{
    dmNotes:notes, notesMarkdown:createMarkdown({html:false}), warnings,
    entry:{id:'Example.md',target:'example.md'}, date:'1730-01-01',
    context:{id:'dunmar-frontier',kind:'campaign',date:'1730-01-01',campaigns:['dufr'],dm},
    store:{lookup:target => ['Target','target'].includes(target) ? {status:'found',entry:{note:{metadata:{}},slug:'target'}} : {status:'missing'}},
  });
  return {...result, $:load(result.html,{},false), notes};
}

test('DM notes move to paragraph ends and preserve source order',() => {
  const {$,notes} = render('Before %%first%% the end.\n\n%%second%%\n\nNext paragraph %%third%% finishes.');
  assert.deepEqual(notes.map(n=>n.text),['first','second','third']);
  const paragraphs = $.root().children('p');
  assert.equal(paragraphs.length,2);
  assert.equal(paragraphs.first().text(),'Before  the end.12');
  assert.equal(paragraphs.last().text(),'Next paragraph  finishes.3');
  assert.equal(paragraphs.first().children().last().is('sup.dm-note-ref'),true);
  assert.equal($('.dm-note-anchor').length,0);
  assert.equal($('.dm-note-popup[popover="auto"]').length,3);
  assert.equal($('.dm-note-trigger').first().attr('popovertarget'),$('.dm-note-popup').first().attr('id'));
});

test('standalone notes work before prose, inside callouts, lists and tables',() => {
  const {$} = render('%%opening%%\n\n> [!note] A callout\n> A paragraph %%callout%% ends.\n\n- List %%list%% ends.\n\n| Name | Detail |\n| --- | --- |\n| One | Cell %%table%% ends. |');
  assert.equal($.root().children('p').first().find('.dm-note-ref').length,1);
  assert.equal($('.admonition p').last().text(),'A paragraph  ends.2');
  assert.equal($('li').text(),'List  ends.3');
  assert.equal($('td').last().text(),'Cell  ends.4');
});

test('behind-the-curtain blocks are marked and their notes stay within the block',() => {
  const source = 'Public paragraph.\n\n%%^Campaign:none%%\n%%A DM comment%%\n\n## Plans\n\n**Secret** content.\n%%^End%%';
  const result = render(source), $ = result.$;
  assert.equal($('.dm-only-block').length,1);
  assert.equal($('.dm-block-label').text(),'Behind the Curtain');
  assert.equal($('.dm-only-block strong').text(),'Secret');
  assert.equal($('.dm-only-block .dm-note-ref').length,1);
  assert.equal($.root().children('p').first().text(),'Public paragraph.');
  const player = render(source,false);
  assert.doesNotMatch(player.html,/Secret|A DM comment|dm-only-block|Behind the Curtain/);
});

test('DM comments respect campaign/date filters and suppress administrative blocks',() => {
  const source = ['%%visible%%',
    '%%^Campaign:dufr%%Kept %%kept note%%%%^End%%',
    '%%^Campaign:adma%%Other %%other note%%%%^End%%',
    '%%^Date:1740%%Future %%future note%%%%^End%%',
    ...['Metadata','povNotes','Lint'].map(kind=>'%%^' + kind + '%%Hidden %%admin note%%%%^End%%'),
  ].join('\n\n');
  const result = render(source);
  assert.deepEqual(result.notes.map(n=>n.text),['visible','kept note']);
  assert.doesNotMatch(result.html,/other note|future note|admin note|Other|Future|Hidden/);
  assert.equal(render(source,false).$('.dm-note-popup').length,0);
  assert.throws(()=>render('%%^Campaign:adma%%Hidden %%unterminated\n%%^End%%'),{status:422});
});

test('popup Markdown preserves navigation, escapes raw HTML and scopes footnotes',() => {
  const {$,toc} = render('Article[^a].\n\n[^a]: Main footnote\n\n%%## Note heading\n**Emphasis** [[Target]]\n\n<script>alert(1)</script>\n\nNote[^a].\n\n[^a]: Popup footnote%%');
  const popup = $('.dm-note-popup');
  assert.equal(popup.find('strong').last().text(),'Emphasis');
  assert.equal(popup.find('a').first().attr('href'),'/page/target?context=dunmar-frontier&dm=1');
  assert.equal(popup.find('script').length,0);
  assert.match(popup.text(),/<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(toc,/Note heading/);
  const ids = $('[id]').map((_,el)=>$(el).attr('id')).get();
  assert.equal(new Set(ids).size,ids.length);
  for (const link of popup.find('a[href^="#"]').toArray()) {
    const id = $(link).attr('href').slice(1);
    assert.equal(popup.find('[id="' + id + '"]').length,1);
  }
});

test('literal comment examples in code stay literal in DM view',() => {
  const source = '`%%literal%%`\n\n~~~md\n%%^Campaign:none%%\nExample\n%%^End%%\n~~~';
  const result = render(source);
  assert.deepEqual(result.notes,[]);
  assert.equal(result.$('.dm-only-block').length,0);
  assert.match(result.$('code').text(),/%%literal%%/);
});
