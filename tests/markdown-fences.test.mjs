import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import {load} from 'cheerio';
import {ROOT,isInside} from '../src/config.mjs';
import {scanFencedCodeBlocks,scanCodeBlocks} from '../src/markdown-fences.mjs';
import {filterComments} from '../src/comments.mjs';
import {parseNote} from '../src/content-store.mjs';
import {cleanupPublicationNote} from '../src/publication-markdown.mjs';
import {materializeWebsiteDataview} from '../scripts/materialize-website-dataview.mjs';

const markdown=new MarkdownIt();

test('conditional markers stay literal in fenced and indented code inside Markdown containers',()=>{
  for(const [first,next] of [['> ','> '],['- ','  '],['> 1. ','>    '],['- > ','  > '],['  ','  ']]){
    const source=first+'~~~text\n'+next+'%%^Date:1748%%\n'+next+'Example syntax\n'+next+'%%^End%%\n'+next+'~~~\n';
    assert.equal(filterComments(source,{date:'1730-01-01'}),source);
    const crlf=source.replaceAll('\n','\r\n');
    assert.equal(filterComments(crlf,{date:'1730-01-01'}),crlf);
  }
  const indented='    %%^Date:1748%%\n    Example\n    %%^End%%\n';
  assert.equal(filterComments(indented,{date:'1730-01-01'}),indented);
});

test('unclosed fences stop at their container boundary and retain exact CRLF source offsets',()=>{
  const source='Intro\r\n\r\n> ~~~text\r\n> Literal %%^End%%\r\n\r\nOutside %%^Date:1748%%hidden%%^End%%\r\n';
  const [block]=scanFencedCodeBlocks(source);
  assert.equal(block.closed,false);
  assert.equal(block.startLine,3);
  assert.equal(source.slice(block.start,block.end),'> ~~~text\r\n> Literal %%^End%%\r\n');
  const result=filterComments(source,{date:'1730-01-01'});
  assert.match(result,/Literal %%\^End%%/);
  assert.match(result,/Outside \r\n$/);
});

test('outer fences, indented examples, HTML blocks and mismatched closers do not become executable queries',()=>{
  const source='~~~~markdown\n~~~dataview\nLIST\n~~~\n~~~~\n\n    ~~~dataview\n    LIST\n    ~~~\n\n<div>\n~~~dataview\nLIST\n~~~\n</div>\n';
  assert.deepEqual(scanFencedCodeBlocks(source).map(block=>block.language),['markdown']);
  assert.ok(scanCodeBlocks(source).some(block=>block.type==='indentedCode'));
  for(const source of ['~~~dataview\nLIST\n~~\n','~~~dataview\nLIST\n```\n','~~~dataview\nLIST\n~~~ trailing\n','~~~dataview\nLIST\n~~~`\n'])
    assert.equal(scanFencedCodeBlocks(source)[0].closed,false);
  assert.equal(scanFencedCodeBlocks('~~~dataview\nLIST\n~~~~~')[0].closed,true);
});

test('Node DQL materialization preserves quote and list nesting and leaves code examples untouched',async t=>{
  await fs.mkdir(path.join(ROOT,'.cache'),{recursive:true});
  const directory=await fs.mkdtemp(path.join(ROOT,'.cache','fence-materialization-'));
  t.after(async()=>{assert.ok(isInside(path.join(ROOT,'.cache'),directory));await fs.rm(directory,{recursive:true,force:true});});
  const examples='~~~~markdown\n~~~dataview\nLIST example\n~~~\n~~~~\n';
  const entry={id:'Note.md',note:parseNote('- ~~~dataview\n  LIST first\n  ~~~\n\n> 1. ~~~dataview\n>    LIST second\n>    ~~~\n\n'+examples)};
  const calls=[];
  const report=await materializeWebsiteDataview({entries:[entry],settings:{source_dir:directory}},{directory},{createRuntime:async()=>({
    errors:[],identity:{version:'test'},index:{pages:new Map()},links:{ambiguities:new Map()},
    api:{tryQueryMarkdown:async query=>{calls.push(query.trim());return '- Alpha\n- Beta\n';}},
  })});
  assert.equal(report.counts.materialized,2);
  assert.deepEqual(calls,['LIST first','LIST second']);
  assert.match(entry.note.body,/- - Alpha\n  - Beta/);
  assert.match(entry.note.body,/> 1. - Alpha\n>    - Beta/);
  assert.ok(entry.note.body.endsWith(examples));
  const $=load(markdown.render(entry.note.body),{},false);
  assert.equal($('blockquote > ol > li > ul > li').length,2);
  assert.equal($('pre code').length,1);
});

test('Omitting JavaScript removes empty list items and preserves sibling prose and examples',()=>{
  const source='> - ~~~dataviewjs\n>   await dv.view("_scripts/view/get_CampaignInteractions");\n>   ~~~\n\n- ~~~dataviewjs\n  unknown();\n  ~~~\n\n- Keep this sibling.\n';
  const result=cleanupPublicationNote(parseNote(source));
  assert.equal(result.note.body.trim(),'- Keep this sibling.');
  assert.match(result.note.body,/- Keep this sibling\./);
  assert.doesNotMatch(result.note.body,/unknown|dataviewjs|dv\.view|taelgar-interactions/);
  assert.deepEqual(result.removedLines,[1,5]);
  const example='    ```dataviewjs\n    unknown();\n    ```\n';
  assert.equal(cleanupPublicationNote(parseNote(example)).note.body,example);
});

test('publication removes an unsupported block and a heading with no remaining content',()=>{
  for(const heading of ['# Query only','Query only\n==========']){
    const note=parseNote(heading+'\n\n```unrecognized\nopaque payload\n```\n');
    const result=cleanupPublicationNote(note);
    assert.equal(result.note.source,'');
    assert.equal(result.removedLines.length,1);
    assert.equal(result.sectionsRemoved,1);
  }
  const frontmatter='---\ntags: [background]\n---\n';
  const result=cleanupPublicationNote(parseNote(frontmatter+'# Query\n```dataviewjs\nlegacy();\n```\n'));
  assert.equal(result.note.source,frontmatter);
  assert.equal(result.note.body,'');
});

test('cleanup removes an empty DM wrapper around discarded code',()=>{
  const note=parseNote('# Guide\n\n%%^Campaign:none%%\n\n```dataviewjs\nlegacy();\n```\n\n%%^End%%\n');
  const result=cleanupPublicationNote(note);
  assert.equal(result.note.body,'');
  assert.equal(result.removedLines.length,1);
  assert.equal(result.sectionsRemoved,1);
});

test('cleanup removes empty descendants and keeps parent, code examples, and conditional prose',()=>{
  const source='# Guide\n\n## Empty\n\n%% Comment only. %%\n\n### Empty child\n\n> ```dataviewjs\n> legacy();\n> ```\n\n'+
    '## Events\n\n```taelgar-events\nyearStart: 1740\n```\n\n'+
    '## Examples\n\n````markdown\n```unsupported\nquoted only\n```\n````\n\n'+
    '## Campaign\n\n%%^Campaign:dufr%%\nAuthored prose.\n%%^End%%\n\n# Unrelated empty title\n';
  const result=cleanupPublicationNote(parseNote(source));
  assert.equal(result.sectionsRemoved,3);
  assert.equal(result.removedLines.length,1);
  assert.match(result.note.body,/# Guide/);
  assert.match(result.note.body,/## Events\n\n```taelgar-events/);
  assert.match(result.note.body,/```unsupported\nquoted only/);
  assert.match(result.note.body,/## Campaign[\s\S]*Authored prose/);
  assert.doesNotMatch(result.note.body,/# Empty|Unrelated empty title|legacy\(\)/);
  assert.equal(cleanupPublicationNote(result.note).note.body,result.note.body);
});

test('a removed fence preserves the boundary between a paragraph and a horizontal rule',()=>{
  const source='Authored prose.\n```unrecognized\nDiscarded.\n```\n---\n';
  assert.equal(cleanupPublicationNote(parseNote(source)).note.body,'Authored prose.\n\n---\n');
});


test('cleanup preserves the list marker when prose follows a removed fence in the same item',()=>{
  const source='- ```dataviewjs\n  legacy();\n  ```\n  Keep the rest of this list item.\n';
  const {note}=cleanupPublicationNote(parseNote(source));
  assert.equal(note.body,'- \n  Keep the rest of this list item.\n');
});
