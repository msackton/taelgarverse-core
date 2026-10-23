import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNote} from '../src/content-store.mjs';
import {DateManager} from '../src/header-core/dates.mjs';
import {firstDescriptionSentence} from '../src/index-description.mjs';
import {cintraSource,cintraSentence} from './fixtures/index-descriptions.mjs';

test('Cintra descriptions skip her generated header, private comment and image callout',()=>{
  assert.equal(firstDescriptionSentence(parseNote(cintraSource)),cintraSentence);
  const body=cintraSource.slice(cintraSource.indexOf('%% Private'));
  for(const header of ['```taelgar-header\n```\n\n','<!-- taelgar:header -->\n\n']) {
    assert.equal(firstDescriptionSentence(parseNote(header+body)),cintraSentence);
  }
});

test('descriptions select prose after headings, nested callouts, lazy quotes, code, lists and image-only paragraphs',()=>{
  const note=parseNote(`# Heading
> [!info] An irrelevant sentence.
> Quoted text.
>> [!image] Nested caption.
Lazy continuation inside the quote.

![An image caption.](portrait.png)

![[portrait.png|right|320]]

- A list item.

~~~js
A code example.
~~~

| Heading | Column |
| --- | --- |
| Table sentence. | Value |

![Portrait](portrait.png) **A [[Folder/Hero#History|hero]]** lives in [Town](town.md), with _friends_ &amp; family. Another sentence.
`);
  assert.equal(firstDescriptionSentence(note),'A hero lives in Town, with friends & family.');
  assert.equal(firstDescriptionSentence(parseNote('> [!image]\n> Only a caption.\n\n![[image.jpg]]')),'');
});

test('descriptions apply date, campaign and DM visibility before choosing the first paragraph',()=>{
  const note=parseNote('%% Private sentence. %%\n\n%%^Campaign:none%%DM sentence.%%^End%%\n\n%%^Campaign:dufr%%Frontier sentence.%%^End%%\n\n%%^Date:1720-06-01b%%Earlier sentence.%%^End%%\n\nLater sentence.');
  assert.equal(firstDescriptionSentence(note,{date:'1720-05-31'}),'Earlier sentence.');
  assert.equal(firstDescriptionSentence(note,{date:'1720-06-01'}),'Later sentence.');
  assert.equal(firstDescriptionSentence(note,{date:'1720-06-01',campaigns:['dufr']}),'Frontier sentence.');
  assert.equal(firstDescriptionSentence(note,{date:'1720-06-01',dm:true}),'DM sentence.');
  assert.throws(()=>firstDescriptionSentence(parseNote('%% Unclosed private text.')),/comment/);
});

test('description dates agree with header dates for calendar objects, normalized dates and partial dates',()=>{
  const note=parseNote('%%^Date:1720-06-01b%%Earlier.%%^End%%\n\nLater.');
  const dates=new DateManager({});
  for(const date of [{year:1720,month:5,day:1},{isLuxonDateTime:true,year:1720,month:6,day:1},dates.normalizeDate('1720-06-01'),new Date('1720-06-01T00:00:00Z'),'1720']) {
    assert.equal(firstDescriptionSentence(note,{date}),'Later.',JSON.stringify(date));
  }
  for(const date of [{year:1720,month:4,day:31},dates.normalizeDate('1720-05-31'),1720,'1720-05']) {
    assert.equal(firstDescriptionSentence(note,{date}),'Earlier.',JSON.stringify(date));
  }
});
