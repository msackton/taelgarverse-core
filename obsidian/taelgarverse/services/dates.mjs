import {Component} from 'obsidian';

export function selectObsidianDate(metadata = {}, globals = globalThis, fallback) {
  if (globals.customJS?.state?.overrideDate) return globals.customJS.state.overrideDate;
  if (metadata.pageTargetDate) return metadata.pageTargetDate;
  if (globals.TaelgarverseCalendar) return globals.TaelgarverseCalendar.getCurrentDate();
  const fantasy = globals.FantasyCalendarAPI?.getCalendars()?.[0]?.current;
  if (fantasy) return fantasy;
  try { return globals.Calendarium?.getAPI('Taelgar')?.getCurrentDate() ?? fallback; }
  catch { return fallback; }
}

// One bridge for campaign events and legacy APIs that expose no change event.
// Subscriptions are owned by consumers; the poll stops with the last subscriber.
export class ObsidianDateService extends Component {
  constructor(app,{globals=globalThis}={}){super();this.app=app;this.globals=globals;this.listeners=new Set();this.disposed=false;}
  onload(){
    if(this.app.workspace?.on)this.registerEvent(this.app.workspace.on('taelgarverse:context-changed',()=>this.notify()));
  }
  getDate(metadata={},fallback){
    if(this.disposed)throw new Error('The Obsidian date service has unloaded.');
    return selectObsidianDate(metadata,this.globals,fallback);
  }
  key(){try{return JSON.stringify({date:this.getDate()});}catch(error){return JSON.stringify({error:error.message});}}
  subscribe(listener){
    if(this.disposed)throw new Error('The Obsidian date service has unloaded.');
    this.listeners.add(listener);
    if(this.timer===undefined){this.dateKey=this.key();this.timer=setInterval(()=>this.check(),2000);}
    return ()=>{this.listeners.delete(listener);if(!this.listeners.size){clearInterval(this.timer);this.timer=undefined;}};
  }
  check(){if(!this.disposed && this.key()!==this.dateKey)this.notify();}
  notify(){
    if(this.disposed)return;
    this.dateKey=this.key();for(const listener of this.listeners)listener();
  }
  onunload(){this.disposed=true;clearInterval(this.timer);this.timer=undefined;this.listeners.clear();}
}
