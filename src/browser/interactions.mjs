import {groupInteractions,interactionDateLabel,interactionParts,interactionKindLabel as kindLabel} from './interaction-groups.mjs';

function node(document,tag,className,text) {
  const result=document.createElement(tag);result.className=className;if(text!=null)result.textContent=text;return result;
}
const openPopups=new WeakMap();
let popupId=0;
export function mountInteractions(root) {
  if(root.dataset.interactionsMounted)return;
  const document=root.ownerDocument,payload=root.querySelector('[data-interaction-records]');
  let data;try{data=JSON.parse(payload.textContent);}catch{return;}
  data.events=interactionParts(data.events).beats;
  if(!data.events.length)return;
  const plot=root.querySelector('.interaction-plot'),detail=root.querySelector('.interaction-detail'),breadcrumb=root.querySelector('.interaction-breadcrumb');
  const grouping=root.querySelector('[data-interaction-group]'),back=root.querySelector('[data-interaction-back]');
  const view=document.defaultView,nativePopover=typeof detail.showPopover==='function';
  detail.id='interaction-popup-'+(++popupId);detail.setAttribute('role','dialog');
  detail.setAttribute('aria-modal','false');detail.setAttribute('aria-labelledby',detail.id+'-title');
  if(nativePopover)detail.setAttribute('popover','manual');
  let focused=null,focusLabel='',anchor=null;
  function positionPopup() {
    if(!anchor)return;
    const dot=anchor.getBoundingClientRect?.(),popup=detail.getBoundingClientRect?.();
    if(!dot || !popup)return;
    const margin=12,gap=8,width=view.innerWidth || document.documentElement.clientWidth,height=view.innerHeight || document.documentElement.clientHeight;
    const below=height-dot.bottom-margin-gap,above=dot.top-margin-gap;
    const left=Math.max(margin,Math.min(dot.left+dot.width/2-popup.width/2,width-popup.width-margin));
    const top=Math.max(margin,Math.min(popup.height>below && above>below ? dot.top-popup.height-gap : dot.bottom+gap,height-popup.height-margin));
    // The top layer escapes scroll-container clipping in Obsidian. Older hosts
    // use a positioned child, preserving native link delegation in either case.
    const origin=nativePopover ? {left:0,top:0} : root.getBoundingClientRect();
    detail.style.left=(left-origin.left)+'px';detail.style.top=(top-origin.top)+'px';
  }
  function closePopup(restoreFocus=false) {
    if(!anchor)return;
    const previous=anchor;anchor=null;previous.setAttribute('aria-expanded','false');
    if(nativePopover && detail.isConnected)detail.hidePopover();detail.hidden=true;
    if(openPopups.get(document)===closePopup)openPopups.delete(document);
    document.removeEventListener('click',outsideClick,true);
    document.removeEventListener('keydown',escape,true);
    document.removeEventListener('scroll',positionPopup,true);
    view?.removeEventListener('resize',positionPopup);
    if(restoreFocus)previous.focus();
  }
  function outsideClick(event) {if(!detail.contains(event.target) && !anchor?.contains(event.target))closePopup();}
  function escape(event) {if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closePopup(true);}}
  function openPopup(current,button) {
    if(anchor===button){closePopup(true);return;}
    openPopups.get(document)?.();anchor=button;button.setAttribute('aria-expanded','true');
    const close=node(document,'button','interaction-popup-close','×');close.type='button';close.setAttribute('aria-label','Close interaction details');
    close.addEventListener('click',event=>{event.stopPropagation();closePopup(true);});
    const title=node(document,'h4','',current.title);title.id=detail.id+'-title';
    detail.replaceChildren(close,node(document,'p','interaction-event-meta',current.start ? interactionDateLabel(current)+' DR' : 'Date unrecorded'),title);
    if(!current.start && current.sessionStart)detail.append(node(document,'p','interaction-event-meta','Session dates: '+current.sessionStart+(current.sessionEnd!==current.sessionStart ? '–'+current.sessionEnd : '')+' DR'));
    if(current.kind!=='session-reference' && current.text)detail.append(node(document,'p','interaction-event-text',current.text));
    if(current.location)detail.append(node(document,'p','interaction-event-meta',current.location));
    const sessionLabel=current.sessionLabel || current.sourceTitle,sessionUrl=current.sessionUrl || current.url;
    if(sessionLabel || current.transcriptUrl){const sources=node(document,'nav','interaction-sources');sources.setAttribute('aria-label','Interaction sources');
      if(sessionLabel){const session=node(document,sessionUrl ? 'a' : 'span','interaction-source',sessionLabel);if(sessionUrl)session.setAttribute('href',sessionUrl);if(current.sourceTitle)session.title=current.sourceTitle;sources.append(session);}
      if(current.transcriptUrl){const link=node(document,'a','interaction-source','Transcript');link.setAttribute('href',current.transcriptUrl);sources.append(link);}detail.append(sources);}
    detail.hidden=false;if(nativePopover)detail.showPopover();
    positionPopup();openPopups.set(document,closePopup);
    document.addEventListener('click',outsideClick,true);
    document.addEventListener('keydown',escape,true);
    document.addEventListener('scroll',positionPopup,true);
    view?.addEventListener('resize',positionPopup);
    close.focus();
  }
  function render(){
    closePopup();
    const visible=focused ? data.events.filter(event=>focused.includes(event.id)) : data.events;
    const groups=groupInteractions(visible,focused ? 'event' : grouping.value);
    plot.replaceChildren();plot.dataset.density=groups.length>8 ? 'dense' : groups.length>3 ? 'medium' : 'sparse';
    const dated=visible.filter(event=>event.start),first=dated.map(event=>event.start).sort()[0],last=dated.map(event=>event.end).sort().at(-1);
    const period=first ? ' · '+first+(first!==last ? '–'+last : '') : '';
    breadcrumb.textContent=focused ? 'All interactions / '+focusLabel+' · '+visible.length+' entries' : data.events.length+' recorded '+(data.events.length===1?'entry':'entries')+period;
    back.disabled=!focused;
    groups.forEach((group,index)=>{
      const cluster=group.events.length>1,button=node(document,'button','interaction-dot');button.type='button';
      button.setAttribute('aria-label',cluster ? 'Zoom into '+group.title+', '+group.events.length+' entries' : kindLabel(group.events[0].kind)+': '+group.title+', '+group.dateLabel);
      if(!cluster){button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls',detail.id);button.setAttribute('aria-expanded','false');}
      const glyph=node(document,'span','interaction-glyph');glyph.setAttribute('aria-hidden','true');
      glyph.append(node(document,'span',cluster ? 'interaction-count' : 'interaction-mark '+group.events[0].kind,cluster ? group.events.length : ''));
      button.append(glyph,node(document,'span','interaction-dot-title',groups.length>8 ? String(index+1) : group.title));
      if(groups.length<=8)button.append(node(document,'span','interaction-dot-date',group.dateLabel));
      button.addEventListener('click',()=>{
        if(cluster){focused=group.events.map(event=>event.id);focusLabel=group.title;render();back.focus();}
        else openPopup(group.events[0],button);
      });plot.append(button);
    });
  }
  const regroup=()=>{focused=null;render();},zoomOut=()=>{focused=null;render();plot.querySelector('button')?.focus();};
  grouping.addEventListener('change',regroup);back.addEventListener('click',zoomOut);
  render();plot.hidden=false;root.dataset.interactionsMounted='true';
  for(const item of root.querySelectorAll('.interaction-controls,.interaction-breadcrumb'))item.hidden=false;
  root.querySelector('.interaction-fallback').hidden=true;
  return ()=>{closePopup();grouping.removeEventListener('change',regroup);back.removeEventListener('click',zoomOut);};
}
if(typeof document!=='undefined')for(const root of document.querySelectorAll('[data-interaction-campaign]'))mountInteractions(root);
