import {Plugin,PluginSettingTab,Setting} from 'obsidian';
import {MapsFeature} from './features/maps.mjs';
import {ImagesFeature} from './features/images.mjs';
import {HeadersFeature} from './features/headers.mjs';
import {InteractionsFeature} from './features/interactions.mjs';
import {ExporterFeature} from './features/exporter.mjs';
import {MaterializerFeature} from './features/materializer.mjs';
import {RelationshipsFeature} from './features/relationships.mjs';
import {CalendarFeature} from './features/calendar.mjs';
import {SessionReviewFeature} from './features/session-review.mjs';
import {DATAVIEW_EXPORT_VERSION} from '../../src/dataview-export.mjs';

class TaelgarverseSettings extends PluginSettingTab {
  constructor(plugin){super(plugin.app,plugin);this.plugin=plugin;}
  display(){
    this.containerEl.empty();
    this.plugin.relationships?.renderSettings(this.containerEl);
    this.plugin.calendar?.renderSettings(this.containerEl,()=>this.display());
    for(const [key,name,description,placeholder] of [
      ['photoshopPython','Map exporter: Python executable','Python 3.11 environment with psd-tools, Pillow, numpy and attrs installed. Use an executable name or absolute path, without shell arguments. Windows resolves a native .exe before launching.','python3'],
      ['photoshopExporter','Map exporter: script override (optional)','Leave blank to use the exporter bundled with this plugin. Advanced: absolute path to a custom export_core.py. Clear an old checkout path to use the bundled version.','Bundled exporter (default)'],
    ])new Setting(this.containerEl).setName(name).setDesc(description).addText(text=>text.setPlaceholder(placeholder).setValue(this.plugin.settings[key] || '').onChange(async value=>{
      this.plugin.settings[key]=value.trim();await this.plugin.saveData(this.plugin.settings);
    }));
    this.plugin.sessionReview?.renderSettings(this.containerEl);
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
  get dataviewExportVersion(){return DATAVIEW_EXPORT_VERSION;}
  exportDataview(request){return this.materializer.exportDataview(request);}

  async onload(){
    this.settings={legacyLeafletBlocks:false,imageViewer:false,automaticInteractions:true,headerIndexPopups:true,calendarEnabled:false,relationshipsEnabled:false,calendarCampaign:'modern',...await this.loadData()};
    delete this.settings.photoshopDropboxCredentials; // Removed account-path integration.
    this.addSettingTab(new TaelgarverseSettings(this));
    // Features own their state and cleanup through Obsidian's Component lifecycle.
    this.addChild(new MapsFeature(this));
    this.images=this.addChild(new ImagesFeature(this));
    this.headers=this.addChild(new HeadersFeature(this));
    this.interactions=this.addChild(new InteractionsFeature(this));
    this.exporter=this.addChild(new ExporterFeature(this));
    this.materializer=this.addChild(new MaterializerFeature(this));
    this.calendar=this.addChild(new CalendarFeature(this));
    this.relationships=this.addChild(new RelationshipsFeature(this));
    this.sessionReview=this.addChild(new SessionReviewFeature(this));
  }
}
