import {escapeHtml} from './common.mjs';

const label = kind => ({encounter:'Encounter',reference:'Campaign reference'}[kind]);
export function interactionSummary(groups) {
  if (!groups.length) return '';
  return '<p class="campaign-interaction-summary"><a href="#campaign-interactions">Campaign interactions</a> · '+groups.map(group=>
    escapeHtml(group.label)+': '+(group.known ? 'known to party' : 'recorded interactions')+' ('+group.events.length+')').join(' · ')+'</p>';
}
export function interactionView(groups) {
  if (!groups.length) return '';
  return '<section id="campaign-interactions" class="campaign-interactions" aria-label="Campaign interactions"><h2>Campaign interactions</h2>'+groups.map(group=>{
    const data=JSON.stringify(group).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
    return '<section class="interaction-campaign" data-interaction-campaign><h3>'+escapeHtml(group.label)+'</h3>'+
      (group.known ? '<p class="interaction-knowledge">Known to party</p>' : '')+
      '<div class="interaction-controls" hidden><label>Group by <select data-interaction-group aria-label="Group by"><option value="auto">Automatic</option><option value="session">Session</option><option value="day">Day</option><option value="week">7-day period</option><option value="event">Individual entry</option></select></label><button type="button" data-interaction-back disabled>Zoom out</button></div>'+
      '<p class="interaction-breadcrumb" aria-live="polite" hidden></p><div class="interaction-plot" role="group" aria-label="Interaction dots" hidden></div>'+
      '<p class="interaction-legend" hidden><span class="interaction-key encounter">Encounter</span><span class="interaction-key reference">Campaign reference</span></p>'+
      '<div class="interaction-detail" aria-live="polite" hidden></div><p class="interaction-order" hidden>Story order · spacing compressed</p>'+
      '<ol class="interaction-fallback">'+group.events.map(event=>'<li><span>'+escapeHtml(event.start ? event.start+(event.end!==event.start ? '–'+event.end : '') : 'Date unrecorded')+' · '+label(event.kind)+'</span> '+
        (event.url ? '<a href="'+escapeHtml(event.url)+'">'+escapeHtml(event.title)+'</a>' : escapeHtml(event.title))+
        (event.text ? '<p>'+escapeHtml(event.text)+'</p>' : '')+(!event.url && event.sourceTitle ? '<p class="interaction-event-meta">'+escapeHtml(event.sessionLabel+' · '+event.sourceTitle)+'</p>' : '')+'</li>').join('')+'</ol>'+
      (!group.events.length ? '<p>No recap beats or campaign references recorded.</p>' : '')+
      '<script type="application/json" data-interaction-records>'+data+'</script></section>';
  }).join('')+'</section>';
}
