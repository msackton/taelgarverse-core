import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import {parseHTML} from 'linkedom';
import {parseNote} from '../src/content-store.mjs';
import {mockWav, pronunciationPaths} from '../src/pronunciation-data.mjs';

const compiled = await build({entryPoints: ['obsidian/taelgarverse/features/pronunciation.mjs'], bundle: true, platform: 'browser', format: 'cjs', external: ['obsidian', '@codemirror/view'], write: false, logLevel: 'silent'});
function fixture() {
  const {document} = parseHTML('<html><body><div id="leaf"><div class="view-actions"></div><div class="markdown-preview-view"><h1>Zahara</h1><p>Body.</p></div></div></body></html>');
  const events = new Set(), commands = [], timers = new Map(), processors = [], ready = [], extensions = [];
  const liveField = Symbol('live'), infoField = Symbol('editorInfo');
  const cm = {WidgetType: class {}, Decoration: {none: [], set: ranges => ranges, widget: ({widget}) => ({range: from => ({from, widget})})}, ViewPlugin: {fromClass: (Klass, spec) => ({Klass, spec})}};
  const notices = [], audio = [], urls = new Set(), revoked = [];
  const speech = {voices: [], spoken: [], cancelled: 0, listeners: new Set(),
    getVoices() { return this.voices; }, cancel() { this.cancelled++; }, speak(value) { this.spoken.push(value); },
    addEventListener(_name, fn) { this.listeners.add(fn); }, removeEventListener(_name, fn) { this.listeners.delete(fn); }};
  class Audio {
    constructor(url) { this.url = url; this.listeners = new Map(); audio.push(this); }
    addEventListener(name, fn) { this.listeners.set(name, fn); }
    async play() { this.played = true; }
    pause() { this.paused = true; }
  }
  let request = async () => { throw new Error('No request expected'); };
  class Component {
    constructor() { this.cleanups = []; }
    registerEvent(ref) { this.cleanups.push(ref.off); }
    unload() { this.onunload?.(); this.cleanups.forEach(fn => fn()); }
  }
  class TFile {
    constructor(path, data = '') { this.path = path; this.data = data; }
    get extension() { return this.path.split('.').at(-1); }
    get basename() { return this.path.split('/').at(-1).replace(/\.[^.]+$/, ''); }
  }
  const file = new TFile('People/Zahara.md', '---\nname: Zahara\npronunciationIPA: zɑˈhɑːrɑ\n---\n# Zahara\n\nBody.\n');
  const entries = new Map([[file.path, file]]);
  class MarkdownView {
    constructor() { this.file = file; this.containerEl = document.querySelector('#leaf'); }
    addAction(_icon, _label, fn) { const action = document.createElement('button'); action.addEventListener('click', fn); this.containerEl.querySelector('.view-actions').appendChild(action); return action; }
  }
  const view = new MarkdownView(), leaves = [{view}];
  const on = (_name, fn) => { events.add(fn); return {off: () => events.delete(fn)}; };
  const info = source => { const match = /^---\n([\s\S]*?)\n---\n/.exec(source); return {exists: !!match, frontmatter: match?.[1], contentStart: match?.[0].length || 0}; };
  const api = {editorLivePreviewField: liveField, editorInfoField: infoField, Component, TFile, MarkdownView, Notice: class { constructor(text) { notices.push(text); } }, getFrontMatterInfo: info, parseYaml: source => parseNote('---\n' + source + '\n---\n').metadata, requestUrl: args => request(args)};
  const module = {exports: {}};
  vm.runInNewContext(compiled.outputFiles[0].text, {module, exports: module.exports, Blob, URL: {createObjectURL() { const url = 'blob:preview-' + urls.size; urls.add(url); return url; }, revokeObjectURL(url) { urls.delete(url); revoked.push(url); }}, Audio, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } }, require: name => name === 'obsidian' ? api : cm, window: {speechSynthesis: speech, setTimeout(fn) { const id = Symbol(); timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); }}});
  const parent = {saveData: async () => {}, settings: {imageViewer: true, pronunciation: {...module.exports.pronunciationDefaults}},
    registerEditorExtension: extension => extensions.push(extension), addCommand: command => commands.push(command), registerMarkdownPostProcessor: fn => processors.push(fn),
    addRibbonIcon() { const icon = document.createElement('button'); document.body.appendChild(icon); return icon; },
    app: {metadataCache: {getFileCache: file => ({frontmatter: parseNote(file.data).metadata})},
      workspace: {on, onLayoutReady: fn => ready.push(fn), getActiveFile: () => file, getLeavesOfType: () => leaves},
      vault: {on, getAbstractFileByPath: path => entries.get(path), cachedRead: async file => file.data, read: async file => file.data,
        createFolder: async path => entries.set(path, {path}), createBinary: async (path, data) => entries.set(path, new TFile(path, data)),
        modifyBinary: async (file, data) => { file.data = data; }, process: async (file, fn) => { file.data = fn(file.data); }}}};
  const feature = new module.exports.PronunciationFeature(parent); feature.onload();
  return {notices, audio, urls, revoked, speech, feature, parent, document, commands, timers, events, processors, ready, file, entries, leaves, extensions, liveField, infoField,
    editor(initial, {live = true} = {}) {
      let source = initial, liveMode = live;
      const state = () => ({doc: {toString: () => source}, field: key => key === liveField ? liveMode : key === infoField ? {file} : undefined});
      const view = {dom: document.querySelector('#leaf'), state: state(), visibleRanges: [{from: 0, to: source.length}], dispatch(transaction) {
        const startState = this.state;
        if (transaction.changes) { const {from, to, insert} = transaction.changes; source = source.slice(0, from) + insert + source.slice(to); }
        this.state = state(); this.visibleRanges = [{from: 0, to: source.length}];
        editor.update({docChanged: !!transaction.changes, viewportChanged: false, transactions: [], startState, state: this.state});
      }};
      const editor = new extensions[0].Klass(view);
      return {view, editor, get source() { return source; }, setLive(value) { liveMode = value; view.dispatch({changes: {from: 0, to: 0, insert: ''}}); }};
    },
    setRequest(fn) { request = fn; },
    async flush() { await new Promise(resolve => setImmediate(resolve)); },
    enable() { parent.settings.pronunciation.enabled = true; feature.setEnabled(true); }};
}

test('unified Pronunciation is opt-in, mounts existing notes, and cleans controls without changing Maps/Images settings', async () => {
  const h = fixture(); assert.equal(h.feature.enabled, false); assert.equal(h.commands.length, 0); assert.equal(h.events.size, 0);
  const original = h.file.data;
  h.enable(); await h.flush();
  assert.equal(h.commands.length, 3); assert.equal(h.events.size, 3); assert.equal(h.processors.length, 1);
  assert.equal(h.document.querySelectorAll('.taelgar-pronunciation-toolbar').length, 1);
  assert.equal(h.document.querySelectorAll('[data-taelgar-pronunciation-action]').length, 1);
  assert.equal(h.file.data, original, 'mounting a note does not synthesize or rewrite it');
  h.feature.setEnabled(false); assert.equal(h.document.querySelectorAll('.taelgar-pronunciation-toolbar,[data-taelgar-pronunciation-action]').length, 0);
  assert.equal(h.commands[0].checkCallback(true), false); assert.equal(h.parent.settings.imageViewer, true);
  h.feature.setEnabled(true); await h.flush(); assert.equal(h.commands.length, 3); assert.equal(h.document.querySelectorAll('.taelgar-pronunciation-toolbar').length, 1);
  h.feature.unload(); h.ready.forEach(fn => fn()); await h.flush();
  assert.equal(h.events.size, 0); assert.equal(h.timers.size, 0); assert.equal(h.document.querySelectorAll('.taelgar-pronunciation-toolbar').length, 0);
});

test('concurrent Reading View decoration cannot duplicate pronunciation controls', async () => {
  const h = fixture(); h.enable();
  const reading = h.document.querySelector('.markdown-preview-view');
  await Promise.all([h.processors[0](reading, {sourcePath: h.file.path, getSectionInfo: () => ({lineStart: 4, lineEnd: 4})}), h.processors[0](reading, {sourcePath: h.file.path, getSectionInfo: () => ({lineStart: 4, lineEnd: 4})})]);
  assert.equal(h.document.querySelectorAll('.taelgar-pronunciation-toolbar').length, 1); h.feature.unload();
});

test('disabling pronunciation during Azure generation discards the response without writing audio or notes', async () => {
  const h = fixture(); h.enable(); h.parent.app.secretStorage = {getSecret: () => 'test-only'}; h.parent.settings.pronunciation.region = 'eastus';
  let finish; h.setRequest(() => new Promise(resolve => { finish = resolve; }));
  const original = h.file.data, pending = h.feature.generate(h.file); await h.flush();
  h.feature.setEnabled(false); finish({status: 200, arrayBuffer: mockWav()});
  await assert.rejects(pending, /disabled/); assert.equal(h.file.data, original);
  assert.equal(h.entries.has(pronunciationPaths(h.file.path).audio), false); h.feature.unload();
});

test('native toolbar generation saves a mock and refreshes its playback button', async () => {
  const h = fixture(); h.enable(); await h.flush();
  const generate = [...h.document.querySelectorAll('.taelgar-pronunciation-toolbar button')].find(button => button.textContent === 'Generate pronunciation');
  generate.click(); await h.flush(); await h.flush();
  assert.ok(h.entries.has(pronunciationPaths(h.file.path).mock)); assert.match(h.file.data, /!\[\[/);
  assert.match(h.document.querySelector('.taelgar-pronunciation-toolbar').textContent, /Play test tone/);
  assert.equal(h.document.querySelectorAll('.taelgar-pronunciation-toolbar').length, 1); h.feature.unload();
});

test('Live Preview names widgets generate from unsaved written guides without requiring IPA', async () => {
  const h = fixture(); h.enable(); await h.flush();
  const source = '---\nname: Zahara\n---\n# Zahara\n\nUnsaved prose.\n\n%%^Metadata:names:v1%%\n- {name: Zahara, language: unknown, pronunciation: zah-HAH-rah, status: documented}\n%%^End%%\n';
  const disk = h.file.data;
  const cm = h.editor(source);
  assert.equal(cm.editor.decorations.length, 1);
  const widget = cm.editor.decorations[0].widget.toDOM(); h.document.body.appendChild(widget);
  assert.match(widget.textContent, /Generate audio/); assert.match(widget.textContent, /default voice/);
  [...widget.querySelectorAll('button')].find(button => button.textContent === 'Generate audio').click(); await h.flush();
  assert.ok(h.entries.has(pronunciationPaths(h.file.path).mock));
  assert.match(cm.source, /Unsaved prose/); assert.match(cm.source, /zah-HAH-rah/); assert.match(cm.source, /!\[\[/);
  assert.equal(h.file.data, disk, 'the command updates the editor instead of overwriting a stale disk copy');
  cm.setLive(false); assert.equal(cm.editor.decorations.length, 0);
  cm.setLive(true); assert.equal(cm.editor.decorations.length, 1);
  h.feature.setEnabled(false); assert.equal(cm.editor.decorations.length, 0);
  cm.editor.destroy(); assert.equal(h.feature.editors.size, 0); h.feature.unload();
});

test('alias-row generation saves separate audio and leaves the main header alone', async () => {
  const h = fixture(); h.enable(); await h.flush();
  const source = '# Zahara\n\n%%^Metadata:names:v1%%\n- {name: Zahara, language: unknown, pronunciation: zah-HAH-rah, role: primary}\n- {name: Other Name, language: unknown, pronunciation: other, role: alias}\n%%^End%%\n';
  const cm = h.editor(source); assert.equal(cm.editor.decorations.length, 2);
  const widget = cm.editor.decorations[1].widget.toDOM(); h.document.body.appendChild(widget);
  [...widget.querySelectorAll('button')].find(button => button.textContent === 'Generate audio').click(); await h.flush();
  assert.equal(cm.source, source); assert.equal(h.entries.has(pronunciationPaths(h.file.path).mock), false);
  assert.equal([...h.entries.keys()].filter(path => /\.name-.*\.mock\.wav$/.test(path)).length, 1);
  h.feature.unload(); cm.editor.destroy();
});

test('invalid frontmatter while editing does not crash the names extension and controls return after correction', async () => {
  const h = fixture(); h.enable(); await h.flush();
  const source = '---\nname: "unfinished\n---\n# Zahara\n\n%%^Metadata:names:v1%%\n- {name: Zahara, pronunciation: zah-HAH-rah}\n%%^End%%\n';
  const cm = h.editor(source); assert.equal(cm.editor.decorations.length, 0);
  const at = cm.source.indexOf('"unfinished') + '"unfinished'.length;
  cm.view.dispatch({changes: {from: at, to: at, insert: '"'}});
  assert.equal(cm.editor.decorations.length, 1); cm.editor.destroy(); h.feature.unload();
});


test('Azure Preview matches Generate SSML and selected analog from unsaved names, without writing files', async () => {
  const h = fixture(); h.enable(); await h.flush();
  h.parent.app.secretStorage = {getSecret: () => 'test-only'}; h.parent.settings.pronunciation.region = 'eastus';
  const requests = [];
  h.setRequest(async args => {
    requests.push(args);
    return args.method === 'GET' ? {status: 200, json: [{Locale: 'it-IT', VoiceType: 'Neural', ShortName: 'it-IT-ElsaNeural'}]} : {status: 200, arrayBuffer: mockWav()};
  });
  const original = h.file.data;
  const source = '# Zahara\n\n%%^Metadata:names:v1%%\n- {name: Casian, role: primary, language: Chardonian, pronunciationIPA: "ˈka.si.an"}\n%%^End%%\n';
  const selector = {locale: 'it-IT', sourceProvider: () => source};
  // Explicit locale on the row is independent of an installed Languages reference.
  const withOverride = source.replace('language: Chardonian,', 'language: Chardonian, pronunciationLocale: it-IT,');
  selector.sourceProvider = () => withOverride;
  await h.feature.preview(h.file, selector);
  assert.equal(h.audio.length, 1); assert.equal(h.audio[0].played, true);
  assert.equal(h.speech.spoken.length, 0); assert.equal(h.urls.size, 1);
  assert.match(requests[1].body, /it-IT-ElsaNeural/); assert.match(requests[1].body, /alphabet="ipa" ph="ˈka.si.an"/);
  assert.equal(h.file.data, original); assert.equal(h.entries.size, 1);
  await h.feature.generate(h.file, selector);
  assert.equal(requests[1].body, requests[3].body, 'Preview and Generate send identical synthesis settings');
  h.audio[0].listeners.get('ended')(); assert.equal(h.urls.size, 0); assert.equal(h.feature.players.size, 0);
  h.feature.unload();
});

test('browser fallback explicitly selects the matching language and reports the actual device voice', async () => {
  const h = fixture(); h.enable(); await h.flush();
  const english = {lang: 'en-US', name: 'English'}, italian = {lang: 'it-IT', name: 'Italian'};
  h.speech.voices = [english, italian];
  await h.feature.preview(h.file, {sourceProvider: () => '---\nname: Casian\npronunciationLocale: it-IT\npronunciation: KAH-see-ahn\n---\n# Casian\n'});
  assert.equal(h.speech.spoken.length, 1); assert.equal(h.speech.spoken[0].voice, italian);
  assert.equal(h.speech.spoken[0].text, 'KAH-see-ahn'); assert.match(h.notices.at(-1), /Italian \(it-IT\)/);
  assert.equal(h.entries.size, 1); h.feature.unload(); assert.ok(h.speech.cancelled > 0);
});

test('browser fallback refuses an unrelated voice and waits for asynchronously loaded voices', async () => {
  const h = fixture(); h.enable(); await h.flush();
  h.parent.settings.pronunciation.locale = 'it-IT'; h.speech.voices = [{lang: 'en-US', name: 'English'}];
  await h.feature.preview(h.file); assert.equal(h.speech.spoken.length, 0); assert.match(h.notices.at(-1), /No device voice.*it-IT/);
  h.speech.voices = [];
  const pending = h.feature.preview(h.file); await h.flush(); assert.equal(h.speech.listeners.size, 1);
  const italian = {lang: 'it-IT', name: 'Italian'}; h.speech.voices = [italian];
  [...h.speech.listeners].forEach(fn => fn()); await pending;
  assert.equal(h.speech.spoken[0].voice, italian); assert.equal(h.speech.listeners.size, 0); assert.equal(h.timers.size, 0);
  assert.match(h.notices.at(-1), /IPA is only used by Azure/); h.feature.unload();
});

test('Azure Preview errors never silently fall back to browser speech', async () => {
  const h = fixture(); h.enable(); await h.flush();
  h.parent.app.secretStorage = {getSecret: () => 'test-only'}; h.parent.settings.pronunciation.region = 'eastus';
  h.setRequest(async () => ({status: 401}));
  await h.feature.preview(h.file);
  assert.match(h.notices.at(-1), /HTTP 401/); assert.equal(h.audio.length, 0); assert.equal(h.speech.spoken.length, 0); assert.equal(h.entries.size, 1);
  h.feature.unload();
});

test('obsolete and disabled Azure Preview responses do not play; disabling releases temporary audio', async () => {
  const h = fixture(); h.enable(); await h.flush();
  h.parent.app.secretStorage = {getSecret: () => 'test-only'}; h.parent.settings.pronunciation.region = 'eastus';
  const responses = []; h.setRequest(() => new Promise(resolve => responses.push(resolve)));
  const first = h.feature.preview(h.file); await h.flush();
  const second = h.feature.preview(h.file); await h.flush();
  responses[0]({status: 200, arrayBuffer: mockWav()}); await first; assert.equal(h.audio.length, 0);
  responses[1]({status: 200, arrayBuffer: mockWav()}); await second; assert.equal(h.audio.length, 1);
  const third = h.feature.preview(h.file); await h.flush(); assert.equal(h.audio[0].paused, true); assert.equal(h.urls.size, 0);
  h.feature.setEnabled(false); responses[2]({status: 200, arrayBuffer: mockWav()}); await third;
  assert.equal(h.audio.length, 1); assert.equal(h.entries.size, 1); h.feature.unload();
});


test('browser voice loading times out clearly and disabling cleans its listener and timer', async () => {
  const h = fixture(); h.enable(); await h.flush();
  const pending = h.feature.preview(h.file); await h.flush();
  [...h.timers.values()].forEach(fn => fn()); await pending;
  assert.match(h.notices.at(-1), /No device voice/); assert.equal(h.speech.listeners.size, 0); assert.equal(h.timers.size, 0);
  const disabled = h.feature.preview(h.file); await h.flush(); assert.equal(h.speech.listeners.size, 1);
  h.feature.setEnabled(false); await disabled;
  assert.equal(h.speech.listeners.size, 0); assert.equal(h.timers.size, 0); assert.equal(h.speech.spoken.length, 0);
  h.feature.unload();
});


test('names widgets remember male/female and name-only choices and use them identically for Preview and Generate', async () => {
  const h = fixture(); h.enable(); await h.flush();
  h.parent.app.secretStorage = {getSecret: () => 'test-only'}; h.parent.settings.pronunciation.region = 'eastus';
  h.file.data = '---\nname: Zahara\npronunciation: old guide\n---\n# Zahara\n\n%%^Metadata:names:v1%%\n- {name: Zahara, language: unknown, role: primary, pronunciationIPA: "test-ipa"}\n%%^End%%\n';
  const cm = h.editor(h.file.data);
  let saved;
  h.parent.saveData = async settings => { saved = JSON.parse(JSON.stringify(settings)); };
  const selectChoice = (label, value) => {
    const widget = cm.editor.decorations[0].widget.toDOM();
    const select = widget.querySelector('select[aria-label="' + label + ' for Zahara"]');
    assert.ok(select);
    select.querySelector('option[value="' + value + '"]').selected = true;
    select.dispatchEvent(new h.document.defaultView.Event('change'));
  };
  selectChoice('Voice gender', 'male'); await h.flush();
  selectChoice('Pronunciation input', 'name'); await h.flush();
  const input = h.feature.inputForSource(h.file, cm.source);
  assert.equal(input.gender, 'male'); assert.equal(input.voice, 'auto'); assert.equal(input.mode, 'name');
  assert.equal(input.pronunciation, ''); assert.equal(input.ipa, '');
  const requests = [];
  h.setRequest(async args => {
    requests.push(args);
    return args.method === 'GET' ? {status: 200, json: [
      {Locale: 'en-US', VoiceType: 'Neural', ShortName: 'en-US-JennyNeural', Gender: 'Female'},
      {Locale: 'en-US', VoiceType: 'Neural', ShortName: 'en-US-GuyNeural', Gender: 'Male'}
    ]} : {status: 200, arrayBuffer: mockWav()};
  });
  await h.feature.preview(h.file, {sourceProvider: () => cm.source});
  await h.feature.generate(h.file, {sourceProvider: () => cm.source, editorView: cm.view});
  assert.equal(requests[1].body, requests[3].body);
  assert.match(requests[1].body, /voice name="en-US-GuyNeural">Zahara<\/voice>/);
  assert.doesNotMatch(requests[1].body, /phoneme|sub alias|old guide|test-ipa/);
  assert.match(cm.source, /pronunciationIPA: "test-ipa"/, 'input choices do not rewrite the row');
  const restored = fixture(); restored.parent.settings = saved; restored.enable(); await restored.flush();
  assert.equal(restored.feature.inputForSource(h.file, h.file.data).gender, 'male');
  assert.equal(restored.feature.inputForSource(h.file, h.file.data).mode, 'name');
  selectChoice('Voice gender', 'default'); selectChoice('Pronunciation input', 'default'); await h.flush();
  const reset = h.feature.inputForSource(h.file, cm.source);
  assert.equal(reset.gender, 'auto'); assert.equal(reset.mode, 'pronunciation'); assert.equal(reset.ipa, 'test-ipa');
  cm.editor.destroy(); h.feature.unload(); restored.feature.unload();
});

test('a pinned voice disables the gender selector, and a requested gender without Azure is explained clearly', async () => {
  const h = fixture(); h.enable(); await h.flush();
  const cm = h.editor('# Zahara\n\n%%^Metadata:names:v1%%\n- {name: Zahara, pronunciationVoice: en-US-JennyNeural}\n%%^End%%\n');
  const widget = cm.editor.decorations[0].widget.toDOM();
  assert.equal(widget.querySelector('[aria-label="Voice gender for Zahara"]').disabled, true);
  h.parent.settings.pronunciation.voiceGender = 'female';
  await h.feature.preview(h.file);
  assert.equal(h.speech.spoken.length, 0); assert.match(h.notices.at(-1), /requires Azure/);
  cm.editor.destroy(); h.feature.unload();
});
