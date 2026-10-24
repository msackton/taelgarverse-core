import {calendarMonth,drMonthNames,drWeekdays,drDateString,parseDRDate,drDayDate} from '../campaign-calendar.mjs';
import {lunarDefinition,lunarDay} from '../lunar.mjs';

export function campaignColor(id) {
  let hash=0;for(const letter of id)hash=(Math.imul(hash,31)+letter.charCodeAt(0))>>>0;
  return 'hsl('+hash%360+' 58% 50%)';
}

// Browsing is local view state. Only the normal plugin setting selects the
// campaign used by date queries; this view never changes a campaign's date.
export function mountCampaignCalendar(root,{loadCalendar,initialDate}) {
  const doc=root.ownerDocument,initial=parseDRDate(initialDate??'1750-01-01');
  const state={year:initial.year,month:initial.month};let data,disposed=false,sequence=0;
  const el=(tag,cls,text,parent)=>{const node=doc.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;parent?.append(node);return node;};
  const button=(text,action,parent)=>{const node=el('button','',text,parent);node.type='button';node.dataset.calendarAction=action;return node;};
  const dot=(campaign,parent)=>{const node=el('span','tc-campaign-dot',null,parent);node.style.setProperty('--tc-dot',campaignColor(campaign.id));return node;};
  root.replaceChildren();root.classList.add('taelgar-calendar');
  const header=el('header','tc-header',null,root),title=el('div','',null,header);
  el('h2','','Campaign calendar',title);const current=el('p','tc-current','',title);
  const navigation=el('nav','tc-navigation',null,root);navigation.setAttribute('aria-label','Browse calendar months');
  button('←','previous',navigation).setAttribute('aria-label','Previous month');
  const month=el('select','',null,navigation);month.setAttribute('aria-label','Month');month.dataset.calendarField='month';
  drMonthNames.forEach((name,index)=>{const option=el('option','',name,month);option.value=String(index+1);});
  const year=el('input','tc-year',null,navigation);year.type='number';year.min='1';year.max='9999';year.setAttribute('aria-label','DR year');year.dataset.calendarField='year';
  el('span','','DR',navigation);button('→','next',navigation).setAttribute('aria-label','Next month');const today=button('Active campaign date','today',navigation);
  const legend=el('div','tc-campaigns',null,root);legend.setAttribute('aria-label','Campaign current dates');
  const status=el('p','tc-status','Loading campaign dates…',root);status.setAttribute('aria-live','polite');
  const grid=el('table','tc-grid',null,root);
  el('p','tc-lunar-note','Moon icons show illumination at noon. Full moon anchor: '+lunarDefinition.fullMoonDate+' at '+lunarDefinition.fullMoonTime+'; '+lunarDefinition.cycleDays+'-day cycle. Hover a moon for phase times.',root);
  function moonIcon(moon,parent) {
    const icon=el('span','tc-moon-icon',null,parent),phase=moon.phase;
    const label=drDateString(moon.day)+': '+moon.name+' appearance at noon, '+(moon.illumination*100).toFixed(1)+'% illuminated'+(moon.crossings.length?'; '+moon.crossings.map(c=>c.name+' at '+c.time).join('; '):'');
    icon.title=label;icon.setAttribute('role','img');icon.setAttribute('aria-label',label);icon.tabIndex=0;
    if(moon.crossings.length)icon.classList.add('has-crossing');
    const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');icon.append(svg);
    const shape=(tag,attributes)=>{const node=doc.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));svg.append(node);};
    shape('circle',{cx:12,cy:12,r:9,class:'tc-moon-shadow'});
    const waxing=phase<0.5,outer=waxing?1:0,returning=waxing?(phase<0.25?0:1):(phase<0.75?0:1),radius=Math.abs(Math.cos(2*Math.PI*phase))*9;
    shape('path',{d:'M12 3 A9 9 0 0 '+outer+' 12 21 A'+Math.max(radius,0.00001).toFixed(5)+' 9 0 0 '+returning+' 12 3 Z',class:'tc-moon-light'});
    shape('circle',{cx:12,cy:12,r:9,class:'tc-moon-outline'});
  }
  function jump(date){const parsed=parseDRDate(date);state.year=parsed.year;state.month=parsed.month;render();}
  function render() {
    if(!data || disposed)return;
    const model=calendarMonth(state.year,state.month);
    const campaigns=data.context?.kind==='custom'?[...data.campaigns,data.context]:data.campaigns;
    for(const option of month.options)option.selected=option.value===String(state.month);year.value=String(state.year);
    current.textContent=data.context?'Active: '+data.context.label+' · '+data.context.date+' DR':'Choose an active campaign in settings';today.disabled=!data.context;
    status.textContent=data.error??'';status.hidden=!data.error;
    legend.replaceChildren();
    for(const campaign of campaigns) {
      const control=button('','campaign',legend);control.className='tc-campaign'+(data.context?.id===campaign.id?' is-active':'');control.dataset.calendarCampaign=campaign.id;control.disabled=!campaign.available;
      dot(campaign,control);const text=el('span','',null,control);el('span','tc-campaign-name',campaign.label,text);el('span','tc-campaign-date',campaign.date?campaign.date+' DR':'Date unavailable',text);
      control.title=campaign.available?'Show '+campaign.label+' current date · '+(campaign.kind==='custom'?'set in plugin settings':campaign.source):campaign.unavailableReason;
      control.setAttribute('aria-label',campaign.available?'Show '+campaign.label+' current date, '+campaign.date:campaign.label+': '+campaign.unavailableReason);
    }
    grid.replaceChildren();grid.setAttribute('aria-label',drMonthNames[state.month-1]+' '+state.year+' DR');
    const headings=el('tr','tc-weekdays',null,el('thead','',null,grid));
    for(const name of drWeekdays){const cell=el('th','',name.slice(0,3),headings);cell.scope='col';cell.title=name;}
    const body=el('tbody','',null,grid),first=model.start-model.offset;
    for(let week=0;week<model.weeks;week++) {
      const row=el('tr','tc-week',null,body);
      for(let column=0;column<7;column++) {
        const day=first+week*7+column,cell=el('td','tc-day',null,row);
        if(day<model.start || day>=model.endExclusive){cell.classList.add('tc-outside');continue;}
        const date=drDateString(day),head=el('div','tc-day-head',null,cell);cell.dataset.calendarDate=date;
        el('span','tc-day-number',String(drDayDate(day).day),head);moonIcon(lunarDay(day),head);
        if(date===data.context?.date)cell.classList.add('is-active-date');
        const markers=el('div','tc-date-dots',null,cell);
        for(const campaign of campaigns.filter(campaign=>campaign.available && campaign.date===date)) {
          const marker=dot(campaign,markers);marker.dataset.calendarCampaign=campaign.id;marker.title=campaign.label+' · '+date+' DR';marker.setAttribute('role','img');marker.setAttribute('aria-label',marker.title);
        }
      }
    }
  }
  async function refresh() {
    if(disposed)return;const ticket=++sequence;
    try{const next=await loadCalendar();if(disposed || ticket!==sequence)return;data=next;render();}
    catch(error){if(disposed || ticket!==sequence)return;status.hidden=false;status.textContent='Calendar unavailable: '+error.message;legend.replaceChildren();grid.replaceChildren();}
  }
  const click=event=>{
    const control=event.target.closest?.('[data-calendar-action]');if(!control || !root.contains(control))return;
    const action=control.dataset.calendarAction;
    if(action==='today'){if(data?.context)jump(data.context.date);return;}
    if(action==='campaign'){const id=control.dataset.calendarCampaign,campaign=id==='custom'?data?.context:data?.campaigns.find(c=>c.id===id);if(campaign?.available)jump(campaign.date);return;}
    if(action==='previous' || action==='next'){let index=(state.year-1)*12+state.month-1+(action==='previous'?-1:1);index=Math.max(0,Math.min(9999*12-1,index));state.year=Math.floor(index/12)+1;state.month=index%12+1;render();}
  };
  const change=event=>{
    const target=event.target;
    if(target.dataset.calendarField==='year'){const value=Number(target.value);if(!Number.isInteger(value) || value<1 || value>9999){target.value=String(state.year);return;}state.year=value;}
    if(target.dataset.calendarField==='month')state.month=Number(target.value);
    if(target.dataset.calendarField)render();
  };
  root.addEventListener('click',click);root.addEventListener('change',change);
  return {ready:refresh(),refresh,get state(){return {...state};},dispose(){disposed=true;sequence++;root.removeEventListener('click',click);root.removeEventListener('change',change);}};
}
