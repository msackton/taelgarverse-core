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
import {preparePublicationNote,cleanupPublicationNote} from '../src/publication-markdown.mjs';
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

test('JavaScript conversion and omission preserve list markers, sibling prose and source examples',()=>{
  const source='> - ~~~dataviewjs\n>   await dv.view("_scripts/view/get_CampaignInteractions");\n>   ~~~\n\n- ~~~dataviewjs\n  unknown();\n  ~~~\n\n- Keep this sibling.\n';
  const result=preparePublicationNote(parseNote(source));
  assert.match(result.note.body,/> - ```taelgar-interactions\n>   ```/);
  assert.match(result.note.body,/- Keep this sibling\./);
  assert.doesNotMatch(result.note.body,/unknown/);
  assert.equal(result.dataviewJsBlocksRemoved,1);
  const example='    ```dataviewjs\n    unknown();\n    ```\n';
  assert.equal(cleanupPublicationNote(parseNote(example)).note.body,example);
});
