import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {load} from 'cheerio';
import {releaseFooter} from '../src/release-footer.mjs';

const core = {commit:'a'.repeat(40),publishedAt:'2026-10-18T12:34:56Z'};
const content = {commit:'b'.repeat(40),publishedAt:'2026-10-19T00:01:00Z',dirty:true};

test('footer shows the content date in UTC and keeps the core date in its tooltip',()=>{
  const $=load(releaseFooter({core,content}));
  assert.match($('footer').text(),/Updated Oct 19, 2026.*Core aaaaaaa.*Content bbbbbbb\*/);
  assert.doesNotMatch($('footer').text(),/Oct 18|2026-10-18/);
  assert.match($('[data-copy-commit]').first().attr('title'),/2026-10-18T12:34:56.000Z/);
  assert.match($('[data-copy-commit]').last().attr('title'),/uncommitted changes.*\nPublished 2026-10-19T00:01:00.000Z/);
  assert.equal($('time').attr('datetime'),'2026-10-19T00:01:00.000Z');
  assert.equal($('button').first().attr('data-copy-commit'),core.commit);
});

test('legacy snapshots, local previews, and malformed metadata render honest fallbacks',()=>{
  assert.match(load(releaseFooter())('footer').text(),/Update date unavailable.*Core unavailable.*Content unavailable/);
  assert.match(load(releaseFooter({core,content,local:true}))('footer').text(),/Updated/);
  assert.match(load(releaseFooter({core,local:true}))('footer').text(),/Local preview/);
  const html=releaseFooter({core:{commit:'<script>alert(1)</script>'},content:{publishedAt:'bad date'}});
  assert.doesNotMatch(html,/<script>|Invalid Date/);
});

test('hash clicks copy the full commit and report clipboard failures',async()=>{
  let listener,copied;
  const status={textContent:''};
  const button={dataset:{copyCommit:core.commit},closest:()=>({querySelector:()=>status})};
  const navigator={clipboard:{writeText:async value=>{copied=value;}}};
  vm.runInNewContext(fs.readFileSync(new URL('../public/release.js',import.meta.url),'utf8'),{
    document:{addEventListener:(name,callback)=>{assert.equal(name,'click');listener=callback;}},navigator,
  });
  await listener({target:{closest:()=>button}});
  assert.equal(copied,core.commit);
  assert.equal(status.textContent,'Commit copied');
  navigator.clipboard.writeText=async()=>{throw new Error('Clipboard denied');};
  await listener({target:{closest:()=>button}});
  assert.match(status.textContent,/Could not copy/);
});
