import {Component,ItemView,Setting} from 'obsidian';
import {calendarContext} from '../../../src/campaign-calendar-context.mjs';
import {CALENDAR_REGISTRY} from '../../../src/campaign-calendar.mjs';
import {mountCampaignCalendar} from '../../../src/browser/campaign-calendar.mjs';
import {readFolderExclusions} from '../../../src/folder-exclusions.mjs';
import {validateDate} from '../../../src/common.mjs';

export const CALENDAR_VIEW='taelgar-campaign-calendar';

export class CalendarView extends ItemView {
  constructor(leaf,feature){super(leaf);this.feature=feature;}
  getViewType(){return CALENDAR_VIEW;}
  getDisplayText(){return 'Campaign calendar';}
  getIcon(){return 'calendar-days';}
  async onOpen(){
    if(!this.feature.enabled){this.leaf.detach();return;}
    this.feature.views.add(this);await this.feature.ready;
    if(!this.feature.views.has(this))return;
    this.calendar=mountCampaignCalendar(this.contentEl,{
      initialDate:this.feature.state?.context?.date??this.feature.state?.contexts?.resolve('modern').date,
      loadCalendar:()=>this.feature.data(),
    });
    await this.calendar.ready;
  }
  onClose(){this.feature.views.delete(this);this.calendar?.dispose();this.calendar=null;}
}

export class CalendarFeature extends Component {
  constructor(plugin){super();this.plugin=plugin;this.app=plugin.app;this.views=new Set();this.sequence=0;this.disposed=false;}
  onload(){
    this.plugin.registerView(CALENDAR_VIEW,leaf=>new CalendarView(leaf,this));
    this.plugin.addCommand({id:'open-campaign-calendar',name:'Open campaign calendar',checkCallback:checking=>{
      if(!this.enabled)return false;
      if(!checking)void this.open();
      return true;
    }});
    this.api={
      getCurrentDate:()=>{
        if(!this.enabled)throw new Error('Calendar disabled');
        if(!this.state?.context)throw new Error(this.state?.error??'Campaign calendar is loading');
        return this.state.context.date;
      },
      getContext:()=>this.state?.context?{...this.state.context,campaigns:[...this.state.context.campaigns]}:null,
      getCampaignDates:()=>this.state?.contexts?.list().filter(context=>context.kind==='campaign')??[],
    };
    this.activate(this.plugin.settings.calendarEnabled===true);
    this.app.workspace.onLayoutReady?.(()=>{if(this.enabled && !this.disposed)this.ready=this.refresh();});
  }
  async setEnabled(enabled){
    this.plugin.settings.calendarEnabled=enabled===true;await this.plugin.saveData(this.plugin.settings);
    this.activate(this.plugin.settings.calendarEnabled);await this.ready;
  }
  activate(enabled){
    if(this.enabled===enabled || this.disposed && enabled)return;
    this.enabled=enabled;this.sequence++;clearTimeout(this.timer);
    if(enabled){
      this.events=this.addChild(new Component());
      this.ribbon=this.plugin.addRibbonIcon('calendar-days','Open campaign calendar',()=>{void this.open();});
      const invalidate=()=>{if(!this.enabled)return;clearTimeout(this.timer);this.timer=setTimeout(()=>{this.ready=this.refresh();},180);};
      for(const [target,names] of [[this.app.metadataCache,['changed','resolved']],[this.app.vault,['rename','delete']]])if(target?.on)for(const name of names)this.events.registerEvent(target.on(name,invalidate));
      if(this.app.vault.on)this.events.registerEvent(this.app.vault.on('modify',file=>{if(file.path===CALENDAR_REGISTRY)invalidate();}));
      this.ready=this.refresh();
    }else{
      const hadContext=!!this.state;
      if(this.events){this.removeChild(this.events);this.events=null;}
      this.ribbon?.remove();this.ribbon=null;
      for(const view of this.views){view.calendar?.dispose();view.calendar=null;}this.views.clear();
      this.app.workspace.detachLeavesOfType?.(CALENDAR_VIEW);
      if(globalThis.TaelgarverseCalendar===this.api){if(this.previousAPI===undefined)delete globalThis.TaelgarverseCalendar;else globalThis.TaelgarverseCalendar=this.previousAPI;}
      this.previousAPI=undefined;this.state=null;this.ready=Promise.resolve();
      if(hadContext)this.notifyDate();
    }
  }
  async refresh(){
    if(!this.enabled || this.disposed)return;
    const sequence=++this.sequence;
    if(!this.app.vault.getMarkdownFiles || !this.app.vault.adapter?.read)return;
    let state;
    try{
      const registry=JSON.parse(await this.app.vault.adapter.read(CALENDAR_REGISTRY));
      const excluded=readFolderExclusions(this.app.vault.adapter.getBasePath?.());
      const notes=this.app.vault.getMarkdownFiles().filter(file=>!excluded.some(folder=>!folder || file.path.startsWith(folder+'/')))
        .map(file=>({path:file.path,metadata:this.app.metadataCache.getFileCache(file)?.frontmatter??{}}));
      state=calendarContext(notes,registry,this.plugin.settings.calendarCampaign??'modern',this.plugin.settings.calendarCustomDate);
    }catch(error){state={error:error.message};}
    if(this.disposed || !this.enabled || sequence!==this.sequence)return;
    const previous=JSON.stringify(this.state?.context);this.state=state;
    if(state.contexts && globalThis.TaelgarverseCalendar!==this.api){this.previousAPI=globalThis.TaelgarverseCalendar;globalThis.TaelgarverseCalendar=this.api;}
    if(previous!==JSON.stringify(state.context))this.notifyDate();
    // A view awaits this.ready, so context readiness must not await the view.
    for(const view of this.views)void view.calendar?.refresh();
  }
  notifyDate(){
    this.app.workspace.trigger?.('taelgarverse:context-changed',this.api.getContext());
    this.app.workspace.trigger?.('dataview:refresh-views');
    for(const child of this.plugin.headers?.bios??[])void child.render();
    this.plugin.interactions?.invalidate();
  }
  async selectCampaign(id){
    if(!this.state?.contexts?.byId.has(id))throw new Error('Unknown campaign setting');
    if(id==='custom' && !this.plugin.settings.calendarCustomDate)this.plugin.settings.calendarCustomDate=
      this.state.context?.date??this.state.contexts.resolve('modern').date;
    this.plugin.settings.calendarCampaign=id;await this.plugin.saveData(this.plugin.settings);
    this.ready=this.refresh();await this.ready;
  }
  async setCustomDate(value){
    const date=validateDate(String(value).trim());
    this.plugin.settings.calendarCustomDate=date;await this.plugin.saveData(this.plugin.settings);
    this.ready=this.refresh();await this.ready;
  }
  async data(){
    await this.ready;
    if(this.disposed)throw new Error('Calendar unloaded');
    if(!this.enabled)throw new Error('Calendar disabled');
    if(!this.state?.contexts)throw new Error(this.state?.error??'No campaign registry in this vault');
    return {context:this.api.getContext(),campaigns:this.api.getCampaignDates(),error:this.state.error};
  }
  async open(){
    if(!this.enabled || this.disposed)return;
    let leaf=this.app.workspace.getLeavesOfType(CALENDAR_VIEW)[0];
    if(!leaf){leaf=this.app.workspace.getLeaf('tab');await leaf.setViewState({type:CALENDAR_VIEW,active:true});}
    await this.app.workspace.revealLeaf(leaf);
  }
  renderSettings(container,redisplay){
    new Setting(container).setName('Campaign calendar').setHeading();
    new Setting(container).setName('Enable campaign calendar')
      .setDesc('Show campaign date dots and moon phases, and use the selected date for CustomJS queries, headers, and indexes. Applies immediately.')
      .addToggle(toggle=>toggle.setValue(this.enabled).onChange(async value=>{await this.setEnabled(value);redisplay();}));
    if(!this.enabled)return;
    const active=new Setting(container).setName('Active campaign')
      .setDesc('Uses this campaign’s latest session date for CustomJS queries, headers, and indexes. Choose Custom to set a date here. Browsing the calendar leaves dates unchanged.');
    if(!this.state?.contexts){active.setDesc('Campaign registry unavailable: '+(this.state?.error??'loading…'));return;}
    active.addDropdown(dropdown=>{
      for(const context of this.state.contexts.list())dropdown.addOption(context.id,context.id==='modern'?'Latest campaign date':context.label+(context.available?'':' (date unavailable)'));
      dropdown.setValue(this.plugin.settings.calendarCampaign??'modern').onChange(async value=>{await this.selectCampaign(value);redisplay();});
    });
    if(this.plugin.settings.calendarCampaign==='custom'){
      const hint='DR date in YYYY-MM-DD format. Taelgar has no leap days.';
      const custom=new Setting(container).setName('Custom date').setDesc(hint);let input;
      custom.addText(text=>{input=text;text.setPlaceholder('YYYY-MM-DD')
        .setValue(this.plugin.settings.calendarCustomDate??this.state.context?.date??'')
        .onChange(()=>custom.setDesc(hint));});
      custom.addButton(button=>button.setButtonText('Set date').onClick(async()=>{
        try{await this.setCustomDate(input.getValue());redisplay();}
        catch(error){custom.setDesc('Cannot set date: '+error.message);}
      }));
    }
    if(this.state.error)new Setting(container).setName('Campaign date unavailable').setDesc(this.state.error);
    if(globalThis.customJS?.state?.overrideDate)new Setting(container).setName('Temporary CustomJS date override')
      .setDesc('A test/export override is active: '+(globalThis.customJS.state.overrideDate.display??globalThis.customJS.state.overrideDate)+'. It takes precedence over the campaign date in queries.')
      .addButton(button=>button.setButtonText('Clear test override').onClick(()=>{delete globalThis.customJS.state.overrideDate;this.notifyDate();redisplay();}));
  }
  onunload(){
    this.disposed=true;this.activate(false);
  }
}
