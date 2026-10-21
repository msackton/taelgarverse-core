import {Plugin,PluginSettingTab,Setting} from 'obsidian';
import {MapsFeature} from './features/maps.mjs';
import {ImagesFeature} from './features/images.mjs';
import {PronunciationFeature,pronunciationDefaults} from './features/pronunciation.mjs';

class TaelgarverseSettings extends PluginSettingTab {
  constructor(plugin){super(plugin.app,plugin);this.plugin=plugin;}
  display(){
    this.containerEl.empty();
    new Setting(this.containerEl).setName('Image viewer')
      .setDesc('Style image placement, sizes, and captions, and add enlargement and pan/zoom in Reading View and Live Preview. Applies immediately; leaves notes unchanged.')
      .addToggle(toggle=>toggle.setValue(this.plugin.settings.imageViewer).onChange(async value=>{
        this.plugin.settings.imageViewer=value;
        this.plugin.images.setEnabled(value);
        await this.plugin.saveData(this.plugin.settings);
      }));
    this.plugin.pronunciation.renderSettings(this.containerEl);
    new Setting(this.containerEl).setName('Render legacy leaflet blocks')
      .setDesc('Also render leaflet blocks when no other map renderer is enabled. Restart Obsidian after changing this. New maps should use taelgar-map blocks.')
      .addToggle(toggle=>toggle.setValue(this.plugin.settings.legacyLeafletBlocks).onChange(async value=>{
        this.plugin.settings.legacyLeafletBlocks=value;
        await this.plugin.saveData(this.plugin.settings);
      }));
  }
}

export default class Taelgarverse extends Plugin {
  async onload(){
    const saved=await this.loadData();
    this.settings={legacyLeafletBlocks:false,imageViewer:false,...saved,pronunciation:{...pronunciationDefaults,...saved?.pronunciation}};
    this.addSettingTab(new TaelgarverseSettings(this));
    // Features own their state and cleanup through Obsidian's Component lifecycle.
    this.addChild(new MapsFeature(this));
    this.images=this.addChild(new ImagesFeature(this));
    this.pronunciation=this.addChild(new PronunciationFeature(this));
  }
}
