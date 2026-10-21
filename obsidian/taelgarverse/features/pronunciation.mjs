import {Component, Setting, Notice, MarkdownView, TFile, SecretComponent, requestUrl, getFrontMatterInfo, parseYaml} from 'obsidian';
import {pronunciationPaths, linkPronunciation, synthesisInput} from '../../../src/pronunciation-data.mjs';
import {synthesizePronunciation} from '../pronunciation-synthesis.mjs';
import {parseNameEntries, parseLanguageProfiles, nameSynthesisInput, nameAudioPaths} from '../pronunciation-names.mjs';
import {namesEditorExtension} from '../pronunciation-editor.mjs';

export const pronunciationDefaults = {enabled: false, region: '', voice: 'en-US-JennyNeural', locale: 'en-US', voiceGender: 'auto', voiceChoices: {}, speechMode: 'pronunciation', speechModes: {}, secretId: 'taelgar-azure-speech', autoLink: true, languagesPath: 'Background/Languages.md'};

export class PronunciationFeature extends Component {
  constructor(plugin) {
    super(); this.plugin = plugin; this.enabled = false; this.disposed = false;
    this.generating = new Set(); this.linking = new Set(); this.timers = new Map(); this.players = new Set();
    this.toolbars = new Set(); this.actions = new Set();
    this.previewSerial = 0; this.previewUrls = new Map(); this.voiceWaiters = new Set();
    this.editors = new Set(); this.editorRevision = 0; this.languageProfiles = new Map(); this.analogChoices = new Map();
  }
  get app() { return this.plugin.app; }
  get settings() { return this.plugin.settings.pronunciation; }
  onload() { this.plugin.registerEditorExtension(namesEditorExtension(this)); this.setEnabled(this.settings.enabled); }
  setEnabled(enabled) {
    this.enabled = enabled === true && !this.disposed;
    if (!this.enabled) { this.clearControls(); this.refreshEditors(); return; }
    if (!this.initialized) this.initialize();
    if (this.ribbon) this.ribbon.hidden = false;
    this.addViewActions(); this.refreshEditors(); void this.loadLanguages();
  }
  initialize() {
    this.initialized = true;
    this.plugin.addCommand({id: 'pronunciation-generate', name: 'Generate pronunciation for current note', checkCallback: checking => this.command(checking, file => this.run(file))});
    this.plugin.addCommand({id: 'pronunciation-link', name: 'Refresh saved pronunciation link', checkCallback: checking => this.command(checking, file => this.refresh(file).catch(error => new Notice(error.message)))});
    this.plugin.addCommand({id: 'pronunciation-preview', name: 'Preview pronunciation without saving', checkCallback: checking => this.command(checking, file => this.preview(file))});
    this.ribbon = this.plugin.addRibbonIcon('audio-lines', 'Generate pronunciation (prototype)', () => this.run(this.app.workspace.getActiveFile()));
    this.registerEvent(this.app.vault.on('modify', file => {
      if (this.enabled && file.path === this.settings.languagesPath) void this.loadLanguages();
      if (this.enabled && this.settings.autoLink && file.extension === 'md') this.scheduleLink(file);
    }));
    this.registerEvent(this.app.workspace.on('file-open', file => {
      if (this.enabled && this.settings.autoLink && file?.extension === 'md') this.scheduleLink(file);
    }));
    this.registerEvent(this.app.workspace.on('layout-change', () => this.addViewActions()));
    this.app.workspace.onLayoutReady(() => this.addViewActions());
    this.plugin.registerMarkdownPostProcessor((element, context) => this.decorate(element, context));
  }

  command(checking, action) {
    const file = this.app.workspace.getActiveFile();
    if (!this.enabled || this.disposed || !(file instanceof TFile) || file.extension !== 'md') return false;
    if (!checking) void action(file);
    return true;
  }

  async decorate(element, context) {
    if (!this.enabled || this.disposed) return;
    const heading = element.querySelector('h1');
    if (!heading || heading.parentElement.querySelector('.taelgar-pronunciation-toolbar')) return;
    const file = this.app.vault.getAbstractFileByPath(context.sourcePath);
    if (!(file instanceof TFile)) return;
    const source = await this.app.vault.cachedRead(file);
    const frontmatter = getFrontMatterInfo(source);
    const offset = frontmatter.exists ? frontmatter.contentStart : 0;
    const leading = /^[ \t\r\n]*# [^\r\n]+/.exec(source.slice(offset));
    const section = context.getSectionInfo(heading);
    if (!leading || !section) return;
    const headingStart = offset + leading[0].indexOf('#');
    const headingLine = source.slice(0, headingStart).split('\n').length - 1;
    if (!this.enabled || this.disposed || section.lineStart > headingLine || section.lineEnd < headingLine || !heading.isConnected) return;
    if (heading.parentElement.querySelector('.taelgar-pronunciation-toolbar')) return;
    for (const toolbar of this.toolbars) if (!toolbar.isConnected) this.toolbars.delete(toolbar);
    const metadata = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!(file instanceof TFile) || !(metadata?.pronunciation || metadata?.pronunciationIPA || parseNameEntries(source).length || this.audioFile(file.path))) return;
    const owner = heading.ownerDocument;
    const toolbar = owner.createElement('div'); toolbar.className = 'taelgar-pronunciation-toolbar';
    const button = (label, action) => {
      const el = owner.createElement('button'); el.type = 'button'; el.textContent = label;
      el.addEventListener('click', action); toolbar.appendChild(el); return el;
    };
    const audio = this.audioFile(file.path);
    if (audio) button(audio.path.endsWith('.mock.wav') ? 'Play test tone' : 'Hear pronunciation', () => this.play(this.audioFile(file.path)));
    const generate = button(audio ? 'Regenerate pronunciation' : 'Generate pronunciation', async () => {
      generate.disabled = true;
      try {
        await this.run(file);
        if (toolbar.isConnected && this.enabled && !this.disposed) { toolbar.remove(); this.toolbars.delete(toolbar); await this.decorate(element, context); }
      } finally { generate.disabled = false; }
    });
    button('Preview pronunciation', () => this.preview(file));
    const label = owner.createElement('small');
    label.textContent = 'Prototype: without an Azure key, generation saves a test tone. Preview uses Azure when configured; otherwise it uses an approximate device voice.';
    toolbar.appendChild(label); heading.after(toolbar); this.toolbars.add(toolbar);
  }

  onunload() { this.disposed = true; this.setEnabled(false); }

  clearControls() {
    for (const timer of this.timers.values()) window.clearTimeout(timer);
    this.timers.clear();
    this.stopPlayback();
    if (this.ribbon) this.ribbon.hidden = true;
    for (const action of this.actions) action.remove(); this.actions.clear();
    for (const toolbar of this.toolbars) toolbar.remove(); this.toolbars.clear();
  }

  addViewActions() {
    if (!this.enabled || this.disposed) return;
    for (const action of this.actions) if (!action.isConnected) this.actions.delete(action);
    for (const toolbar of this.toolbars) if (!toolbar.isConnected) this.toolbars.delete(toolbar);
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || view.containerEl.querySelector('[data-taelgar-pronunciation-action]')) continue;
      const action = view.addAction('audio-lines', 'Generate pronunciation (prototype)', () => this.run(view.file));
      action.dataset.taelgarPronunciationAction = 'true'; this.actions.add(action);
      const reading = view.containerEl.querySelector('.markdown-preview-view');
      if (view.file && reading) void this.decorate(reading, {sourcePath: view.file.path, getSectionInfo: () => ({lineStart: 0, lineEnd: Infinity})});
    }
  }

  refreshEditors() {
    this.editorRevision++;
    for (const editor of this.editors) editor.view.dispatch({});
  }
  async loadLanguages() {
    try {
      const file = this.app.vault.getAbstractFileByPath(this.settings.languagesPath || 'Background/Languages.md');
      this.languageProfiles = file instanceof TFile ? parseLanguageProfiles(await this.app.vault.read(file)) : new Map();
      this.refreshEditors();
    } catch { this.languageProfiles = new Map(); this.refreshEditors(); }
  }
  inputForSource(file, source, selector = {}) {
    const frontmatter = getFrontMatterInfo(source);
    const metadata = frontmatter.exists ? parseYaml(frontmatter.frontmatter) || {} : {};
    const entries = parseNameEntries(source);
    const input = nameSynthesisInput(metadata, file.basename, this.settings, entries, this.languageProfiles, selector);
    const key = file.path + '|' + input.entryKey;
    const gender = selector.gender ?? this.settings.voiceChoices?.[key];
    const mode = selector.mode ?? this.settings.speechModes?.[key];
    return gender !== undefined || mode !== undefined ? nameSynthesisInput(metadata, file.basename, this.settings, entries, this.languageProfiles, {...selector, gender, mode}) : input;
  }
  async setGenderChoice(file, entryKey, gender) {
    const choices = {...this.settings.voiceChoices}, key = file.path + '|' + entryKey;
    if (gender === 'default') delete choices[key];
    else if (gender === 'male' || gender === 'female') choices[key] = gender;
    else throw new Error('Choose Default, Female, or Male for the speech voice');
    this.settings.voiceChoices = choices;
    this.refreshEditors();
    await this.plugin.saveData(this.plugin.settings);
  }
  async setSpeechMode(file, entryKey, mode) {
    const modes = {...this.settings.speechModes}, key = file.path + '|' + entryKey;
    if (mode === 'default') delete modes[key];
    else if (mode === 'name' || mode === 'pronunciation') modes[key] = mode;
    else throw new Error('Choose Name only or Pronunciation / IPA');
    this.settings.speechModes = modes;
    this.refreshEditors();
    await this.plugin.saveData(this.plugin.settings);
  }
  async readInput(file, selector = {}) {
    if (!(file instanceof TFile) || file.extension !== 'md') throw new Error('Open a Markdown note first');
    const source = selector.sourceProvider ? selector.sourceProvider() : await this.app.vault.read(file);
    return this.inputForSource(file, source, selector);
  }
  audioForInput(file, input) {
    const entry = input.entryKey ? {key: input.entryKey} : null;
    const paths = nameAudioPaths(file.path, entry, input.primary ? entry : null);
    return paths.candidates.map(path => this.app.vault.getAbstractFileByPath(path)).find(candidate => candidate instanceof TFile);
  }
  linkEditor(view, audioPath) {
    const source = view.state.doc.toString(), next = linkPronunciation(source, audioPath);
    if (source === next) return;
    let from = 0, end = source.length, nextEnd = next.length;
    while (from < source.length && from < next.length && source[from] === next[from]) from++;
    while (end > from && nextEnd > from && source[end - 1] === next[nextEnd - 1]) { end--; nextEnd--; }
    view.dispatch({changes: {from, to: end, insert: next.slice(from, nextEnd)}});
  }

  audioFile(notePath) {
    try { return pronunciationPaths(notePath).candidates.map(path => this.app.vault.getAbstractFileByPath(path)).find(file => file instanceof TFile); }
    catch { return undefined; }
  }

  async run(file, selector = {}) {
    try { await this.generate(file, selector); }
    catch (error) { new Notice(error.message); }
  }

  async generate(file, selector = {}) {
    if (!this.enabled || this.disposed) throw new Error('Enable Pronunciation in Taelgarverse settings first');
    if (!(file instanceof TFile) || file.extension !== 'md') throw new Error('Open a Markdown note first');
    const path = file.path;
    if (this.generating.has(path)) throw new Error('Pronunciation generation is already running for this note');
    this.generating.add(path);
    try {
      await this.loadLanguages();
      const input = await this.readInput(file, selector);
      const entry = input.entryKey ? {key: input.entryKey} : null;
      const paths = nameAudioPaths(path, entry, input.primary ? entry : null);
      const key = this.app.secretStorage?.getSecret(this.settings.secretId);
      new Notice(key ? 'Generating audio: ' + input.route + ' (' + input.locale + ')…' : 'Saving prototype test tone (not speech)…');
      const result = await synthesizePronunciation({input, key, region: this.settings.region, request: requestUrl});
      if (!this.enabled || this.disposed) throw new Error('Pronunciation was disabled; the response was discarded');
      if (file.path !== path || JSON.stringify(await this.readInput(file, selector)) !== JSON.stringify(input)) {
        throw new Error('The note name or pronunciation changed during generation; generate again');
      }
      const target = result.mock ? paths.mock : paths.audio;
      let folder = '';
      for (const part of target.split('/').slice(0, -1)) {
        folder = folder ? folder + '/' + part : part;
        if (!this.app.vault.getAbstractFileByPath(folder)) {
          try { await this.app.vault.createFolder(folder); }
          catch (error) { if (!this.app.vault.getAbstractFileByPath(folder)) throw error; }
        }
      }
      const existing = this.app.vault.getAbstractFileByPath(target);
      if (existing instanceof TFile) await this.app.vault.modifyBinary(existing, result.buffer);
      else await this.app.vault.createBinary(target, result.buffer);
      if (input.primary) {
        if (selector.editorView) this.linkEditor(selector.editorView, target);
        else await this.refresh(file);
      }
      this.refreshEditors();
      new Notice('Saved ' + target + (result.mock ? ' — test tone only' : ' · ' + result.voice));
    } finally { this.generating.delete(path); }
  }

  scheduleLink(file) {
    if (!this.enabled || this.disposed) return;
    const path = file.path;
    window.clearTimeout(this.timers.get(path));
    this.timers.set(path, window.setTimeout(() => {
      this.timers.delete(path);
      this.refresh(file).catch(error => new Notice('Pronunciation link: ' + error.message));
    }, 350));
  }

  async refresh(file) {
    if (!this.enabled || this.disposed || !(file instanceof TFile) || file.extension !== 'md' || this.linking.has(file.path)) return;
    const audio = this.audioFile(file.path);
    if (!audio) return;
    this.linking.add(file.path);
    try {
      const source = await this.app.vault.read(file);
      if (this.enabled && !this.disposed && linkPronunciation(source, audio.path) !== source) {
        await this.app.vault.process(file, current => this.enabled && !this.disposed ? linkPronunciation(current, audio.path) : current);
      }
    } finally { this.linking.delete(file.path); }
  }

  play(file) {
    if (!file) return;
    const audio = new Audio(this.app.vault.getResourcePath(file)); this.players.add(audio);
    audio.addEventListener('ended', () => this.players.delete(audio), {once: true});
    audio.play().catch(() => { this.players.delete(audio); new Notice('Could not play the saved audio; try its native embedded player'); });
  }

  stopPlayback() {
    this.previewSerial++;
    for (const finish of this.voiceWaiters) finish();
    if (this.browserUtterance) window.speechSynthesis?.cancel();
    this.browserUtterance = null;
    for (const player of this.players) player.pause();
    this.players.clear();
    for (const url of this.previewUrls.values()) URL.revokeObjectURL(url);
    this.previewUrls.clear();
  }

  async browserVoices() {
    const speech = window.speechSynthesis;
    if (!speech) throw new Error('Browser speech is unavailable on this device');
    const voices = speech.getVoices();
    if (voices.length) return voices;
    return new Promise(resolve => {
      const finish = () => {
        window.clearTimeout(timer);
        speech.removeEventListener('voiceschanged', changed);
        this.voiceWaiters.delete(finish);
        resolve(speech.getVoices());
      };
      const changed = () => { if (speech.getVoices().length) finish(); };
      const timer = window.setTimeout(finish, 1500);
      this.voiceWaiters.add(finish);
      speech.addEventListener('voiceschanged', changed);
      changed();
    });
  }

  async preview(file, selector = {}) {
    let serial;
    try {
      if (!this.enabled || this.disposed) throw new Error('Enable Pronunciation in Taelgarverse settings first');
      this.stopPlayback(); serial = this.previewSerial;
      await this.loadLanguages();
      const input = await this.readInput(file, selector);
      const path = file.path;
      const active = () => this.enabled && !this.disposed && serial === this.previewSerial;
      const unchanged = async () => active() && file.path === path && JSON.stringify(await this.readInput(file, selector)) === JSON.stringify(input) && active();
      if (!active()) return;
      const key = this.app.secretStorage?.getSecret(this.settings.secretId);
      if (key) {
        new Notice('Previewing with Azure: ' + input.route + ' (' + input.locale + ')…');
        const result = await synthesizePronunciation({input, key, region: this.settings.region, request: requestUrl});
        if (!await unchanged()) return;
        const url = URL.createObjectURL(new Blob([result.buffer], {type: 'audio/wav'}));
        const audio = new Audio(url);
        this.players.add(audio); this.previewUrls.set(audio, url);
        const release = () => { this.players.delete(audio); if (this.previewUrls.delete(audio)) URL.revokeObjectURL(url); };
        audio.addEventListener('ended', release, {once: true});
        audio.addEventListener('error', release, {once: true});
        try { await audio.play(); }
        catch { release(); throw new Error('Could not play the Azure preview'); }
        if (active()) new Notice('Azure preview · ' + result.voice + ' · no file saved');
        return;
      }
      if (input.gender !== 'auto') throw new Error('Male/female voice selection requires Azure; device voices do not report their gender');
      const voices = await this.browserVoices();
      if (!await unchanged()) return;
      const normalize = locale => locale.toLowerCase().replaceAll('_', '-');
      const locale = normalize(input.locale);
      const voice = voices.find(voice => normalize(voice.lang) === locale)
        || voices.find(voice => normalize(voice.lang).split('-')[0] === locale.split('-')[0]);
      if (!voice) throw new Error('No device voice is available for ' + input.locale + '; configure Azure to preview this language');
      const utterance = new SpeechSynthesisUtterance(input.pronunciation || input.name);
      utterance.voice = voice; utterance.lang = voice.lang;
      this.browserUtterance = utterance;
      utterance.onend = () => { if (this.browserUtterance === utterance) this.browserUtterance = null; };
      utterance.onerror = () => { utterance.onend(); if (active()) new Notice('Browser speech failed; available voices depend on this device'); };
      new Notice('Approximate device preview · ' + voice.name + ' (' + voice.lang + ')' + (input.ipa && !input.pronunciation ? ' · IPA is only used by Azure' : '') + ' · no file saved');
      window.speechSynthesis.speak(utterance);
    } catch (error) { if (serial === undefined || serial === this.previewSerial) new Notice(error.message); }
  }

  renderSettings(containerEl) {
    containerEl.createEl('h2', {text: 'Pronunciation'});
    new Setting(containerEl).setName('Enable pronunciation tools').setDesc('Generate saved name audio and restore its header link. Without an Azure key, generation saves a labeled test tone.').addToggle(toggle =>
      toggle.setValue(this.settings.enabled).onChange(async value => { this.settings.enabled = value; this.setEnabled(value); await this.plugin.saveData(this.plugin.settings); }));
    containerEl.createEl('p', {text: 'Without a selected Azure secret, Generate saves a clearly labeled test-tone WAV. Written pronunciation guides are used directly; IPA remains optional. Preview uses Azure when configured (normal usage charges apply) without saving a file.'});
    new Setting(containerEl).setName('Default pronunciation input').setDesc('Name only ignores written pronunciation guides and IPA, and lets the selected language pronounce the name. Each names row can override this.').addDropdown(dropdown =>
      dropdown.addOption('pronunciation', 'Pronunciation / IPA').addOption('name', 'Name only').setValue(this.settings.speechMode || 'pronunciation').onChange(async value => {
        this.settings.speechMode = value; this.refreshEditors(); await this.plugin.saveData(this.plugin.settings);
      }));
    new Setting(containerEl).setName('Default voice gender').setDesc('Choose an Azure male or female voice for the selected language. Each names row can override this. A specific pronunciationVoice override takes priority.').addDropdown(dropdown =>
      dropdown.addOption('auto', 'Default voice').addOption('female', 'Female').addOption('male', 'Male').setValue(this.settings.voiceGender || 'auto').onChange(async value => {
        this.settings.voiceGender = value; this.refreshEditors(); await this.plugin.saveData(this.plugin.settings);
      }));
    for (const [key, label, description] of [
      ['region', 'Azure region', 'For example eastus. Used only when a secret is selected.'],
      ['locale', 'Default speech locale', 'Select a locale whose voice supports the IPA sounds.'],
      ['voice', 'Fallback Azure voice', 'Used when no supported language analog is documented. Notes or name entries can override pronunciationVoice and pronunciationLocale.'],
      ['languagesPath', 'Languages reference note', 'Read the documented real-world analogs from this vault-relative Markdown path.']
    ]) {
      new Setting(containerEl).setName(label).setDesc(description).addText(text => text.setValue(this.settings[key]).onChange(async value => {
        this.settings[key] = value.trim(); await this.plugin.saveData(this.plugin.settings); await this.loadLanguages();
      }));
    }
    if (SecretComponent && this.app.secretStorage) {
      new Setting(containerEl).setName('Azure Speech API key').setDesc('Choose or create a secret in Obsidian SecretStorage. The plugin saves only its identifier.').addComponent(el =>
        new SecretComponent(this.app, el).setValue(this.settings.secretId).onChange(async value => {
          this.settings.secretId = value || ''; await this.plugin.saveData(this.plugin.settings);
        }));
    } else containerEl.createEl('p', {text: 'Azure credentials require Obsidian 1.11.4+ SecretStorage. The no-key prototype works without it.'});
    new Setting(containerEl).setName('Restore links after header regeneration').setDesc('When a note is opened or modified and matching audio exists, maintain a small native audio embed after its leading H1. Does not scan or rewrite other notes.').addToggle(toggle =>
      toggle.setValue(this.settings.autoLink).onChange(async value => { this.settings.autoLink = value; await this.plugin.saveData(this.plugin.settings); }));
  }
}
