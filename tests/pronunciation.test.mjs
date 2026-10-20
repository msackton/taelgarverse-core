import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {buildSync} from 'esbuild';
import {load} from 'cheerio';
import {pronunciationPaths, linkPronunciation, stripPronunciationLink, synthesisInput, mockWav, validateWav} from '../src/pronunciation-data.mjs';
import {decoratePronunciation} from '../src/pronunciation.mjs';
import {ContentStore, parseNote} from '../src/content-store.mjs';
import {targetPath} from '../src/common.mjs';
import {RenderEngine, document} from '../src/render-engine.mjs';
import {synthesizePronunciation} from '../experiments/pronunciation/synthesis.mjs';

const note = (id, metadata = {}) => ({id, target: targetPath(id), slug: targetPath(id).slice(0, -3), name: id.split('/').at(-1).slice(0, -3), title: 'Zahara', note: {metadata, body: '# Zahara\n\nBody.\n'}});
const asset = id => ({id, target: targetPath(id), extension: '.wav', note: null});

test('paths preserve note identity and reject traversal and unsafe embed syntax', () => {
  assert.equal(pronunciationPaths('People/Zimkovans/Zahara.md').audio, 'assets/pronunciation/People/Zimkovans/Zahara.wav');
  assert.notEqual(pronunciationPaths('People/Same.md').audio, pronunciationPaths('Places/Same.md').audio);
  for (const id of ['../Secret.md', '/Secret.md', 'A/../B.md', 'A//B.md', 'A|B.md', 'A]B.md', 'A\nB.md', 'x.txt']) assert.throws(() => pronunciationPaths(id));
});

test('owned audio embed is idempotent, preserves body examples and survives header replacement', () => {
  const audio = pronunciationPaths('People/Zahara.md').mock;
  for (const newline of ['\n', '\r\n']) {
    const source = ['---', 'pronunciation: zah-HAH-rah', '---', '# Zahara', '*(zah-HAH-rah)*', '', 'Body.', '', '```html', '<!-- taelgar:pronunciation -->', 'example', '<!-- /taelgar:pronunciation -->', '```', ''].join(newline);
    const linked = linkPronunciation(source, audio);
    assert.equal(linkPronunciation(linked, audio), linked);
    assert.equal(stripPronunciationLink(linked), source);
    assert.match(linked, /Prototype test tone/);
    assert.match(linked, /!\[\[assets\/pronunciation\/People\/Zahara.mock.wav\]\]/);
    const regenerated = source.replace('# Zahara', '# Updated title');
    assert.match(linkPronunciation(regenerated, audio), /# Updated title/);
  }
  assert.equal(linkPronunciation('Prose.\n\n# Later heading\n', audio), 'Prose.\n\n# Later heading\n');
  assert.equal(linkPronunciation('\x60\x60\x60md\n# Example\n\x60\x60\x60\n', audio).startsWith('<!--'), false);
});

test('SSML escapes names, IPA and voice attributes; missing credentials never call a service', async () => {
  const input = synthesisInput({name: 'A & <B>', pronunciationIPA: '/a"b/', pronunciationVoice: 'voice"x'}, 'fallback');
  assert.match(input.ssml, /A &amp; &lt;B&gt;/); assert.match(input.ssml, /ph="a&quot;b"/); assert.match(input.ssml, /voice&quot;x/);
  const result = await synthesizePronunciation({input, request: () => assert.fail('network called')});
  assert.equal(result.mock, true); assert.equal(validateWav(result.buffer), result.buffer);
  const view = new DataView(result.buffer); assert.equal(view.getUint32(24, true), 24000);
  assert.equal(view.getUint32(40, true), result.buffer.byteLength - 44);
});

test('Azure sends IPA SSML and returns validated WAV; failures never become mock success', async () => {
  const input = synthesisInput({name: 'Zahara', pronunciationIPA: 'zɑˈhɑːrɑ'}, 'fallback');
  let calls = 0;
  const args = {input, key: 'test-only-secret', region: 'eastus', request: async request => {
    calls++; assert.match(request.url, /^https:\/\/eastus.tts.speech.microsoft.com\//);
    assert.equal(request.headers['X-Microsoft-OutputFormat'], 'riff-24khz-16bit-mono-pcm');
    assert.equal(request.headers['Ocp-Apim-Subscription-Key'], 'test-only-secret'); assert.equal(request.body, input.ssml);
    return {status: 200, arrayBuffer: mockWav()};
  }};
  assert.equal((await synthesizePronunciation(args)).mock, false); assert.equal(calls, 1);
  await assert.rejects(synthesizePronunciation({...args, input: {...input, ipa: ''}}), /pronunciationIPA/);
  await assert.rejects(synthesizePronunciation({...args, region: 'host/escape'}), /region/);
  await assert.rejects(synthesizePronunciation({...args, request: async () => ({status: 401})}), /HTTP 401/);
  await assert.rejects(synthesizePronunciation({...args, request: async () => ({status: 200, arrayBuffer: new TextEncoder().encode('error').buffer})}), /WAV/);
  await assert.rejects(synthesizePronunciation({...args, request: async () => { throw new Error('raw response with secret'); }}), error => !error.message.includes('secret'));
});

test('website matches exact assets, prefers real audio, escapes IPA, and omits missing clips', () => {
  const entry = note('People/Zahara.md', {pronunciationIPA: '<script>alert(1)</script>'});
  const paths = pronunciationPaths(entry.id), mock = asset(paths.mock), real = asset(paths.audio);
  const rendered = {html: '<h1 id="zahara">Zahara</h1><p>Body.</p>', toc: ''};
  const decorated = decoratePronunciation(rendered, entry, new ContentStore([entry, mock]));
  let $ = load(decorated.html); assert.equal($('.pronunciation-control').length, 1); assert.match($('.pronunciation-control').text(), /test tone/);
  assert.equal($('script').length, 0); assert.equal($('.pronunciation-ipa').text(), entry.note.metadata.pronunciationIPA);
  $ = load(decoratePronunciation(rendered, entry, new ContentStore([entry, real, mock])).html);
  assert.equal($('audio').attr('src'), '/assets/' + real.target); assert.doesNotMatch($('.pronunciation-control').text(), /test tone/);
  const wrong = asset('assets/pronunciation/Other/Zahara.wav');
  assert.equal(decoratePronunciation(rendered, entry, new ContentStore([entry, wrong])).html, rendered.html);
});

test('shared rendering restores pronunciation once after dynamic headers, with conditional shell assets', () => {
  const entry = note('People/Zahara.md', {headerVersion: 'test', tags: ['person'], pronunciationIPA: 'zɑˈhɑːrɑ'});
  const audio = asset(pronunciationPaths(entry.id).mock);
  entry.note = {...entry.note, source: '---\n---\n' + linkPronunciation(entry.note.body, audio.id)};
  entry.note.body = linkPronunciation(entry.note.body, audio.id);
  const store = new ContentStore([entry, audio]);
  const engine = new RenderEngine({settings: {default_date: '1750-01-01'}, store, headers: {registry: {}}, renderHeader: () => '---\n---\n# Zahara\n\nGenerated body.\n', navigationSource: null, backlinkIndex: null});
  const result = engine.render(entry.slug);
  const $ = load(result.html); assert.equal($('audio').length, 1); assert.equal($('.pronunciation-control').length, 1);
  const shell = load(document(result, engine.contexts.list()));
  assert.equal(shell('script[src="/theme/pronunciation.js"]').length, 1); assert.equal(shell('link[href="/theme/pronunciation.css"]').length, 1);
  assert.throws(() => engine.render(entry.slug, '1690-01-01', 'modern'), /Custom/);
  entry.note.metadata.excludePublish = 'all'; assert.throws(() => engine.render(entry.slug), /not available/);
});

// Exercise the built plugin against an in-memory Obsidian API boundary.
class TFile {
  constructor(path, data = '') { this.path = path; this.data = data; }
  get extension() { return this.path.split('.').at(-1); }
  get basename() { return this.path.split('/').at(-1).replace(/\.[^.]+$/, ''); }
}
const notices = []; let provider = async () => { throw new Error('Unexpected network request'); };
const api = {Plugin: class {}, PluginSettingTab: class {}, Setting: class {}, Notice: class {constructor(message) { notices.push(message); }}, TFile,
  requestUrl: args => provider(args), getFrontMatterInfo: source => ({exists: true, frontmatter: source}), parseYaml: source => parseNote(source).metadata};
const bundled = buildSync({entryPoints: ['experiments/pronunciation/obsidian/main.mjs'], bundle: true, platform: 'browser', format: 'cjs', external: ['obsidian'], write: false, logLevel: 'silent'}).outputFiles[0].text;
const module = {exports: {}}; vm.runInNewContext(bundled, {module, exports: module.exports, require: () => api, Notice: api.Notice, Audio: class {} });
const Plugin = module.exports.default;
function pluginFixture(key) {
  const file = new TFile('People/Zahara.md', '---\nname: Zahara\npronunciationIPA: zɑˈhɑːrɑ\n---\n# Zahara\n\nAuthored body.\n');
  const entries = new Map([[file.path, file]]);
  const plugin = new Plugin(); plugin.settings = {region: 'eastus', secretId: 'test', locale: 'en-US', voice: 'en-US-JennyNeural'};
  plugin.generating = new Set(); plugin.linking = new Set();
  plugin.app = {secretStorage: {getSecret: () => key}, workspace: {getLeavesOfType: () => []}, vault: {
    getAbstractFileByPath: path => entries.get(path), read: async file => file.data,
    createFolder: async path => entries.set(path, {path}), createBinary: async (path, data) => entries.set(path, new TFile(path, data)),
    modifyBinary: async (file, data) => { file.data = data; }, process: async (file, fn) => { file.data = fn(file.data); }
  }};
  return {plugin, file, entries};
}

test('Obsidian Generate saves a mock WAV, inserts one embed, and restores it after header regeneration', async () => {
  const {plugin, file, entries} = pluginFixture();
  await plugin.generate(file);
  const mock = entries.get(pronunciationPaths(file.path).mock); assert.ok(mock); validateWav(mock.data);
  assert.match(file.data, /Prototype test tone/); assert.equal((file.data.match(/!\[\[/g) || []).length, 1);
  const linked = file.data; await plugin.refresh(file); assert.equal(file.data, linked);
  file.data = stripPronunciationLink(file.data); await plugin.refresh(file); assert.equal(file.data, linked);
  assert.match(file.data, /Authored body/);
});

test('Obsidian regeneration keeps previous audio and note intact on provider failure, and upgrades mock to real', async () => {
  const {plugin, file, entries} = pluginFixture('test-key');
  const paths = pronunciationPaths(file.path), old = new TFile(paths.audio, mockWav()); entries.set(paths.audio, old);
  const originalAudio = old.data, originalNote = file.data;
  provider = async () => ({status: 401}); await assert.rejects(plugin.generate(file), /HTTP 401/);
  assert.equal(old.data, originalAudio); assert.equal(file.data, originalNote);
  entries.delete(paths.audio); entries.set(paths.mock, new TFile(paths.mock, mockWav()));
  provider = async () => ({status: 200, arrayBuffer: mockWav()}); await plugin.generate(file);
  assert.ok(entries.get(paths.audio)); assert.ok(file.data.includes('![[' + paths.audio + ']]')); assert.doesNotMatch(file.data, /test tone/);
});

test('Obsidian blocks duplicate generation and discards responses after IPA changes', async () => {
  const {plugin, file, entries} = pluginFixture('test-key');
  let resolve; provider = () => new Promise(done => { resolve = done; });
  const pending = plugin.generate(file); await new Promise(done => setImmediate(done));
  await assert.rejects(plugin.generate(file), /already running/);
  file.data = file.data.replace('zɑˈhɑːrɑ', 'changed'); resolve({status: 200, arrayBuffer: mockWav()});
  await assert.rejects(pending, /changed during/); assert.equal(entries.has(pronunciationPaths(file.path).audio), false);
});

test('browser playback handles rejected play promises and exposes native controls', async () => {
  let click; const status = {textContent: ''}, button = {hidden: true, addEventListener: (_, fn) => { click = fn; }};
  const audio = {play: async () => { throw new Error('blocked'); }};
  const control = {querySelector: selector => selector === 'audio' ? audio : selector === '[data-pronunciation-play]' ? button : status};
  vm.runInNewContext(fs.readFileSync('public/pronunciation.js', 'utf8'), {document: {querySelectorAll: () => [control]}});
  assert.equal(button.hidden, false); assert.equal(audio.hidden, true); await click();
  assert.equal(audio.hidden, false); assert.match(status.textContent, /Playback failed/); assert.equal(button.disabled, false);
});
