import {escapeHtml} from './common.mjs';
import {interactionDateLabel,interactionParts} from './browser/interaction-groups.mjs';

const referenceKinds={
  item:{label:'Items',singular:'item',path:'m12 3 9 5-9 5-9-5 9-5ZM3 8v9l9 5 9-5V8M12 13v9'},
  story:{label:'Stories',singular:'story',plural:'stories',path:'M12 5v16M12 5C9 3 5 3 2 4v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-3-1-7-1-10 1Z'},
  document:{label:'Sources',singular:'source',path:'M14 3H5v18h14V8l-5-5ZM14 3v5h5M8 12h8M8 16h8'},
  reference:{label:'References',singular:'reference',path:'M10 5H5v14h14v-5M13 5h6v6M19 5l-9 9'},
};
const count=(number,singular,plural=singular+'s')=>number+' '+(number===1 ? singular : plural);
function campaignHeading(group) {
  return '<header class="interaction-campaign-header"><h3>'+escapeHtml(group.label)+'</h3>'+
    (group.known ? '<p class="interaction-knowledge">Known to party</p>' : '')+'</header>';
}
function referenceView(references) {
  if(!references.length)return '';
  const groups=new Map(Object.keys(referenceKinds).map(kind=>[kind,[]]));
  for(const event of references)groups.get(Object.hasOwn(referenceKinds,event.referenceType) ? event.referenceType : 'reference').push(event);
  const links=items=>'<ul class="interaction-reference-links">'+items.map(event=>{
    const name='<span>'+escapeHtml(event.title)+'</span>';
    return '<li>'+(event.url ? '<a href="'+escapeHtml(event.url)+'">'+name+'</a>' : name)+'</li>';
  }).join('')+'</ul>';
  return '<section class="interaction-references" aria-label="Related campaign material"><h4>Related campaign material <span>'+count(references.length,'reference')+'</span></h4>'+
    '<div class="interaction-reference-groups">'+[...groups].filter(([,items])=>items.length).map(([kind,items])=>{
      const type=referenceKinds[kind];
      const icon='<span class="interaction-reference-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="'+type.path+'"/></svg></span>';
      return '<div class="interaction-reference-group" data-reference-kind="'+kind+'"><h5 class="interaction-reference-label">'+icon+type.label+'</h5><div class="interaction-reference-body">'+
        links(items.slice(0,3))+(items.length>3 ? '<details class="interaction-reference-more"><summary>Show '+count(items.length-3,'more '+type.singular,'more '+(type.plural || type.singular+'s'))+'</summary>'+links(items.slice(3))+'</details>' : '')+'</div></div>';
    }).join('')+'</div></section>';
}
function sourceLinks(event) {
  const links=[[event.sessionUrl,'Session note'],[event.transcriptUrl,'Transcript']].filter(([url])=>url);
  return links.length ? '<nav class="interaction-sources" aria-label="Recap sources">'+links.map(([url,label])=>'<a href="'+escapeHtml(url)+'">'+label+'</a>').join('')+'</nav>' : '';
}
export function interactionSummary(groups) {
  if (!groups.length) return '';
  return '<p class="campaign-interaction-summary"><a href="#campaign-interactions">Campaign interactions</a> · '+groups.map(group=>{
    const {beats,references}=interactionParts(group.events),facts=[];
    if(group.known)facts.push('known to party');
    if(beats.length)facts.push(count(beats.length,'encounter'));
    if(references.length)facts.push(count(references.length,'reference'));
    if(!facts.length)facts.push('no recorded interactions');
    return escapeHtml(group.label)+': '+facts.join(', ');
  }).join(' · ')+'</p>';
}
export function interactionView(groups) {
  if (!groups.length) return '';
  const knowledgeOnly=groups.every(group=>group.known && !group.events.length);
  const compact=groups.every(group=>!interactionParts(group.events).beats.length);
  return '<section id="campaign-interactions" class="campaign-interactions'+(compact ? ' campaign-interactions--compact' : '')+(knowledgeOnly ? ' campaign-interactions--knowledge-only' : '')+'" aria-label="Campaign interactions">'+
    '<h2>Campaign interactions</h2>'+groups.map(group=>{
    const {beats,references}=interactionParts(group.events),related=referenceView(references);
    const heading=campaignHeading(group);
    if(!beats.length)return '<section class="interaction-campaign interaction-campaign--compact">'+
      heading+(!group.known && !references.length ? '<p class="interaction-empty">No recorded interactions.</p>' : '')+related+'</section>';
    const data=JSON.stringify({...group,events:beats}).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
    return '<section class="interaction-campaign" data-interaction-campaign>'+heading+
      '<div class="interaction-controls" hidden><label>Group by <select data-interaction-group aria-label="Group by"><option value="auto">Automatic</option><option value="session">Session</option><option value="day">Day</option><option value="week">7-day period</option><option value="event">Individual entry</option></select></label><button type="button" data-interaction-back disabled>Zoom out</button></div>'+
      '<p class="interaction-breadcrumb" aria-live="polite" hidden></p><div class="interaction-plot" role="group" aria-label="Interaction dots" hidden></div>'+
      '<div class="interaction-detail" aria-live="polite" hidden></div><p class="interaction-order" hidden>Story order · spacing compressed</p>'+
      '<ol class="interaction-fallback">'+beats.map(event=>'<li><span>'+escapeHtml(interactionDateLabel(event)+(event.start ? ' DR' : ''))+' · Encounter</span> '+
        (event.url ? '<a href="'+escapeHtml(event.url)+'">'+escapeHtml(event.title)+'</a>' : escapeHtml(event.title))+
        (event.text ? '<p>'+escapeHtml(event.text)+'</p>' : '')+(!event.url && event.sourceTitle ? '<p class="interaction-event-meta">'+escapeHtml(event.sessionLabel+' · '+event.sourceTitle)+'</p>' : '')+sourceLinks(event)+'</li>').join('')+'</ol>'+
      related+'<script type="application/json" data-interaction-records>'+data+'</script></section>';
  }).join('')+'</section>';
}
