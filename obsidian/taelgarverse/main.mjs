import {Plugin,PluginSettingTab,Setting} from 'obsidian';
import {MapsFeature} from './features/maps.mjs';
import {ImagesFeature} from './features/images.mjs';
import {HeadersFeature} from './features/headers.mjs';
import {InteractionsFeature} from './features/interactions.mjs';

class TaelgarverseSettings extends PluginSettingTab {
  constructor(plugin){super(plugin.app,plugin);this.plugin=plugin;}
  display(){
    this.containerEl.empty();
    new Setting(this.containerEl).setName('Show header index popups')
      .setDesc('Show Members, Residents, and other index buttons below generated headers in Obsidian. Applies immediately; inline indexes and website popups are unchanged.')
      .addToggle(toggle=>toggle.setValue(this.plugin.settings.headerIndexPopups).onChange(async value=>{
        this.plugin.settings.headerIndexPopups=value;
        await this.plugin.headers.setHeaderIndexPopups(value);
        await this.plugin.saveData(this.plugin.settings);
      }));
    new Setting(this.containerEl).setName('Automatic campaign interactions')
      .setDesc('Show campaign interactions at the bottom of notes with knownTo campaigns in Reading View and Live Preview. Explicit taelgar-interactions blocks always work.')
      .addToggle(toggle=>toggle.setValue(this.plugin.settings.automaticInteractions).onChange(async value=>{
        this.plugin.settings.automaticInteractions=value;
        this.plugin.interactions.setAutomatic(value);
        await this.plugin.saveData(this.plugin.settings);
      }));
    new Setting(this.containerEl).setName('Image viewer')
      .setDesc('Style image placement, sizes, and captions, and add enlargement and pan/zoom in Reading View and Live Preview. Applies immediately; leaves notes unchanged.')
      .addToggle(toggle=>toggle.setValue(this.plugin.settings.imageViewer).onChange(async value=>{
        this.plugin.settings.imageViewer=value;
        this.plugin.images.setEnabled(value);
        await this.plugin.saveData(this.plugin.settings);
      }));
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
    this.settings={legacyLeafletBlocks:false,imageViewer:false,automaticInteractions:true,headerIndexPopups:true,...await this.loadData()};
    this.addSettingTab(new TaelgarverseSettings(this));
    // Features own their state and cleanup through Obsidian's Component lifecycle.
    this.addChild(new MapsFeature(this));
    this.images=this.addChild(new ImagesFeature(this));
    this.headers=this.addChild(new HeadersFeature(this));
    this.interactions=this.addChild(new InteractionsFeature(this));
  }
}
