import {Plugin, PluginSettingTab, Setting, Notice, MarkdownView, TFile, SecretComponent, requestUrl, getFrontMatterInfo, parseYaml} from 'obsidian';
import {pronunciationPaths, linkPronunciation, synthesisInput} from '../../../src/pronunciation-data.mjs';
import {synthesizePronunciation} from '../synthesis.mjs';

const defaults = {region: '', voice: 'en-US-JennyNeural', locale: 'en-US', secretId: 'taelgar-azure-speech', autoLink: true};

export default class PronunciationPlugin extends Plugin {
  async onload() {
    this.settings = {...defaults, ...await this.loadData()};
    this.generating = new Set(); this.linking = new Set(); this.timers = new Map(); this.players = new Set();
    this.addSettingTab(new PronunciationSettings(this.app, this));
    this.addCommand({id: 'generate', name: 'Generate pronunciation for current note', callback: () => this.run(this.app.workspace.getActiveFile())});
    this.addCommand({id: 'link', name: 'Refresh saved pronunciation link', callback: () => this.refresh(this.app.workspace.getActiveFile()).catch(error => new Notice(error.message))});
    this.addCommand({id: 'preview', name: 'Preview name with browser speech (approximate)', callback: () => this.preview(this.app.workspace.getActiveFile())});
    this.addRibbonIcon('audio-lines', 'Generate pronunciation (prototype)', () => this.run(this.app.workspace.getActiveFile()));
    this.registerEvent(this.app.vault.on('modify', file => {
      if (this.settings.autoLink && file.extension === 'md') this.scheduleLink(file);
    }));
    this.registerEvent(this.app.workspace.on('file-open', file => {
      if (this.settings.autoLink && file?.extension === 'md') this.scheduleLink(file);
    }));
    this.registerEvent(this.app.workspace.on('layout-change', () => this.addViewActions()));
    this.app.workspace.onLayoutReady(() => this.addViewActions());
    this.registerMarkdownPostProcessor(async (element, context) => {
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
      if (section.lineStart > headingLine || section.lineEnd < headingLine || !heading.isConnected) return;
      const metadata = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!(file instanceof TFile) || !(metadata?.pronunciation || metadata?.pronunciationIPA || this.audioFile(file.path))) return;
      const owner = heading.ownerDocument;
      const toolbar = owner.createElement('div'); toolbar.className = 'taelgar-pronunciation-toolbar';
      const button = (label, action) => {
        const el = owner.createElement('button'); el.type = 'button'; el.textContent = label;
        el.addEventListener('click', action); toolbar.appendChild(el); return el;
      };
      const audio = this.audioFile(file.path);
      if (audio) button(audio.path.endsWith('.mock.wav') ? 'Play test tone' : 'Hear pronunciation', () => this.play(this.audioFile(file.path)));
      const generate = button(audio ? 'Regenerate pronunciation' : 'Generate pronunciation', async () => {
        generate.disabled = true; try { await this.run(file); } finally { generate.disabled = false; }
      });
      button('Browser speech preview', () => this.preview(file));
      const label = owner.createElement('small');
      label.textContent = 'Prototype: without an Azure key, generation saves a test tone. Browser preview is approximate.';
      toolbar.appendChild(label); heading.after(toolbar);
    });
  }

  onunload() {
    for (const timer of this.timers.values()) window.clearTimeout(timer);
    for (const player of this.players) player.pause();
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      leaf.view.containerEl.querySelector('[data-taelgar-pronunciation-action]')?.remove();
    }
    document.querySelectorAll('.taelgar-pronunciation-toolbar').forEach(el => el.remove());
  }

  addViewActions() {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || view.containerEl.querySelector('[data-taelgar-pronunciation-action]')) continue;
      const action = view.addAction('audio-lines', 'Generate pronunciation (prototype)', () => this.run(view.file));
      action.dataset.taelgarPronunciationAction = 'true';
    }
  }

  async readInput(file) {
    if (!(file instanceof TFile) || file.extension !== 'md') throw new Error('Open a Markdown note first');
    const source = await this.app.vault.read(file), frontmatter = getFrontMatterInfo(source);
    const metadata = frontmatter.exists ? parseYaml(frontmatter.frontmatter) || {} : {};
    return synthesisInput(metadata, file.basename, this.settings);
  }

  audioFile(notePath) {
    try { return pronunciationPaths(notePath).candidates.map(path => this.app.vault.getAbstractFileByPath(path)).find(file => file instanceof TFile); }
    catch { return undefined; }
  }

  async run(file) {
    try { await this.generate(file); }
    catch (error) { new Notice(error.message); }
  }

  async generate(file) {
    if (!(file instanceof TFile) || file.extension !== 'md') throw new Error('Open a Markdown note first');
    const path = file.path;
    if (this.generating.has(path)) throw new Error('Pronunciation generation is already running for this note');
    this.generating.add(path);
    try {
      const input = await this.readInput(file), paths = pronunciationPaths(path);
      const key = this.app.secretStorage?.getSecret(this.settings.secretId);
      new Notice(key ? 'Generating pronunciation with Azure…' : 'Saving prototype test tone (not speech)…');
      const result = await synthesizePronunciation({input, key, region: this.settings.region, request: requestUrl});
      if (file.path !== path || JSON.stringify(await this.readInput(file)) !== JSON.stringify(input)) {
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
      await this.refresh(file);
      new Notice('Saved ' + target + (result.mock ? ' — test tone only' : ''));
    } finally { this.generating.delete(path); }
  }

  scheduleLink(file) {
    const path = file.path;
    window.clearTimeout(this.timers.get(path));
    this.timers.set(path, window.setTimeout(() => {
      this.timers.delete(path);
      this.refresh(file).catch(error => new Notice('Pronunciation link: ' + error.message));
    }, 350));
  }

  async refresh(file) {
    if (!(file instanceof TFile) || file.extension !== 'md' || this.linking.has(file.path)) return;
    const audio = this.audioFile(file.path);
    if (!audio) return;
    this.linking.add(file.path);
    try {
      const source = await this.app.vault.read(file);
      if (linkPronunciation(source, audio.path) !== source) {
        await this.app.vault.process(file, current => linkPronunciation(current, audio.path));
      }
    } finally { this.linking.delete(file.path); }
  }

  play(file) {
    if (!file) return;
    const audio = new Audio(this.app.vault.getResourcePath(file)); this.players.add(audio);
    audio.addEventListener('ended', () => this.players.delete(audio), {once: true});
    audio.play().catch(() => { this.players.delete(audio); new Notice('Could not play the saved audio; try its native embedded player'); });
  }

  async preview(file) {
    try {
      const input = await this.readInput(file);
      if (!window.speechSynthesis) throw new Error('Browser speech is unavailable on this device');
      const utterance = new SpeechSynthesisUtterance(input.name); utterance.lang = input.locale;
      utterance.onerror = () => new Notice('Browser speech failed; available voices depend on this device');
      new Notice('Approximate browser preview of the name; IPA is not applied and no file is saved');
      window.speechSynthesis.cancel(); window.speechSynthesis.speak(utterance);
    } catch (error) { new Notice(error.message); }
  }
}

class PronunciationSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const {containerEl} = this; containerEl.empty();
    containerEl.createEl('h2', {text: 'Pronunciation prototype'});
    containerEl.createEl('p', {text: 'Without a selected Azure secret, Generate saves a clearly labeled test-tone WAV. Azure mode requires IPA. Browser preview does not apply IPA.'});
    for (const [key, label, description] of [
      ['region', 'Azure region', 'For example eastus. Used only when a secret is selected.'],
      ['locale', 'Default speech locale', 'Select a locale whose voice supports the IPA sounds.'],
      ['voice', 'Default Azure voice', 'A voice that supports SSML phonemes. Notes can override pronunciationVoice and pronunciationLocale.']
    ]) {
      new Setting(containerEl).setName(label).setDesc(description).addText(text => text.setValue(this.plugin.settings[key]).onChange(async value => {
        this.plugin.settings[key] = value.trim(); await this.plugin.saveData(this.plugin.settings);
      }));
    }
    if (SecretComponent && this.app.secretStorage) {
      new Setting(containerEl).setName('Azure Speech API key').setDesc('Choose or create a secret in Obsidian SecretStorage. The plugin saves only its identifier.').addComponent(el =>
        new SecretComponent(this.app, el).setValue(this.plugin.settings.secretId).onChange(async value => {
          this.plugin.settings.secretId = value || ''; await this.plugin.saveData(this.plugin.settings);
        }));
    } else containerEl.createEl('p', {text: 'Azure credentials require Obsidian 1.11.4+ SecretStorage. The no-key prototype works without it.'});
    new Setting(containerEl).setName('Restore links after header regeneration').setDesc('When a note is opened or modified and matching audio exists, maintain a small native audio embed after its leading H1. Does not scan or rewrite other notes.').addToggle(toggle =>
      toggle.setValue(this.plugin.settings.autoLink).onChange(async value => { this.plugin.settings.autoLink = value; await this.plugin.saveData(this.plugin.settings); }));
  }
}
