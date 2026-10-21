import {Plugin, PluginSettingTab} from 'obsidian';
import {PronunciationFeature, pronunciationDefaults} from '../../../obsidian/taelgarverse/features/pronunciation.mjs';
// The optional standalone demo now shares the unified Taelgarverse implementation.
class Settings extends PluginSettingTab {
  constructor(plugin) { super(plugin.app, plugin); this.plugin = plugin; }
  display() { this.containerEl.empty(); this.plugin.pronunciation.renderSettings(this.containerEl); }
}
export default class PronunciationPrototype extends Plugin {
  async onload() {
    const saved = await this.loadData();
    this.settings = {pronunciation: {...pronunciationDefaults, enabled: true, ...(saved?.pronunciation || saved)}};
    this.pronunciation = this.addChild(new PronunciationFeature(this));
    this.addSettingTab(new Settings(this));
  }
}
