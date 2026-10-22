import {groupInteractions,interactionDateLabel} from './interaction-groups.mjs';

const kindLabel=kind=>({encounter:'Encounter',reference:'Campaign reference'}[kind]);
function node(document,tag,className,text) {
  const result=document.createElement(tag);result.className=className;if(text!=null)result.textContent=text;return result;
}
export function mountInteractions(root) {
  if(root.dataset.interactionsMounted)return;
  const document=root.ownerDocument,payload=root.querySelector('[data-interaction-records]');
  let data;try{data=JSON.parse(payload.textContent);}catch{return;}
  if(!data.events.length)return;
  const plot=root.querySelector('.interaction-plot'),detail=root.querySelector('.interaction-detail'),breadcrumb=root.querySelector('.interaction-breadcrumb');
  const grouping=root.querySelector('[data-interaction-group]'),back=root.querySelector('[data-interaction-back]');
  let focused=null,focusLabel='',selected=data.events[0].id;
  function render(){
    const visible=focused ? data.events.filter(event=>focused.includes(event.id)) : data.events;
    const groups=groupInteractions(visible,focused ? 'event' : grouping.value);
    const current=visible.find(event=>event.id===selected) || visible[0];selected=current.id;
    plot.replaceChildren();plot.dataset.density=groups.length>8 ? 'dense' : groups.length>3 ? 'medium' : 'sparse';
    const dated=visible.filter(event=>event.start),first=dated.map(event=>event.start).sort()[0],last=dated.map(event=>event.end).sort().at(-1);
    const period=first ? ' · '+first+(first!==last ? '–'+last : '') : '';
    breadcrumb.textContent=focused ? 'All interactions / '+focusLabel+' · '+visible.length+' entries' : data.events.length+' recorded '+(data.events.length===1?'entry':'entries')+period;
    back.disabled=!focused;
    groups.forEach((group,index)=>{
      const cluster=group.events.length>1,button=node(document,'button','interaction-dot');button.type='button';
      button.setAttribute('aria-label',cluster ? 'Zoom into '+group.title+', '+group.events.length+' entries' : kindLabel(group.events[0].kind)+': '+group.title+', '+group.dateLabel);
      if(!cluster)button.setAttribute('aria-pressed',String(group.events[0].id===selected));
      const glyph=node(document,'span','interaction-glyph');glyph.setAttribute('aria-hidden','true');
      glyph.append(node(document,'span',cluster ? 'interaction-count' : 'interaction-mark '+group.events[0].kind,cluster ? group.events.length : ''));
      button.append(glyph,node(document,'span','interaction-dot-title',groups.length>8 ? String(index+1) : group.title));
      if(groups.length<=8)button.append(node(document,'span','interaction-dot-date',group.dateLabel));
      button.addEventListener('click',()=>{
        if(cluster){focused=group.events.map(event=>event.id);focusLabel=group.title;selected=group.events[0].id;render();back.focus();}
        else {selected=group.events[0].id;render();plot.querySelectorAll('button')[index]?.focus();}
      });plot.append(button);
    });
    detail.replaceChildren(node(document,'p','interaction-event-meta',interactionDateLabel(current)+' · '+kindLabel(current.kind)),node(document,'h4','',current.title));
    if(current.text)detail.append(node(document,'p','interaction-event-text',current.text));
    if(current.location)detail.append(node(document,'p','interaction-event-meta',current.location));
    if(current.url){const link=node(document,'a','interaction-source',current.sourceTitle);link.href=current.url;detail.append(link);}
    else if(current.sourceTitle)detail.append(node(document,'p','interaction-event-meta',current.sessionLabel+' · '+current.sourceTitle));
  }
  grouping.addEventListener('change',()=>{focused=null;render();});
  back.addEventListener('click',()=>{focused=null;render();plot.querySelector('button')?.focus();});
  render();plot.hidden=false;root.dataset.interactionsMounted='true';
  for(const item of root.querySelectorAll('.interaction-controls,.interaction-detail,.interaction-breadcrumb,.interaction-legend,.interaction-order'))item.hidden=false;
  root.querySelector('.interaction-fallback').hidden=true;
}
if(typeof document!=='undefined')for(const root of document.querySelectorAll('[data-interaction-campaign]'))mountInteractions(root);
