import {load} from 'cheerio';
import {escapeHtml,pageUrl} from './common.mjs';
import {availableInContext} from './content-store.mjs';

const destinations = [
  {slug:'campaigns/current-games',label:'Current Games',description:'Follow the ongoing campaigns.',icon:'<path d="m12 3 9 5v8l-9 5-9-5V8Z M3 8l9 5 9-5 M12 13v8 M12 3v10"/>'},
  {slug:'gazetteer/geography-of-taelgar',label:'Gazetteer',description:'Explore the places of Taelgar.',icon:'<path d="M12 6v15 M3 3c4-1 7 0 9 3 2-3 5-4 9-3v15c-4-1-7 0-9 3-2-3-5-4-9-3Z"/>'},
  {slug:'gazetteer/world-of-taelgar',label:'World Map',description:'Find your way across the world.',icon:'<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5Z M12 1v2 M12 21v2 M1 12h2 M21 12h2"/>'},
];

// Presentation belongs to core; all introductory prose still comes from the
// context-filtered, rendered vault homepage. This also works with old snapshots.
export function homepage(home,context,store) {
  const $ = load(home.html,{},false);
  const title = $.root().children('h1').first();
  const campaign = context.locked;
  const pageTitle = campaign ? title.text() || context.label : 'TaelgarVerse';
  const heading = title.length ? $.html(title) : '<h1>'+escapeHtml(pageTitle)+'</h1>';
  title.remove();
  // Earlier home.md versions included the same three entry links as a plain
  // paragraph. Remove only that exact navigation row, leaving prose links alone.
  $.root().children('p').each((_,element) => {
    const paragraph = $(element), links = paragraph.children('a');
    if (campaign || links.length !== destinations.length) return;
    const matches = links.toArray().every((link,index) => {
      const href = $(link).attr('href') || '';
      return href.split(/[?#]/)[0] === '/page/' + destinations[index].slug;
    });
    if (matches && !paragraph.clone().children('a').remove().end().text().replace(/[\s·|]/g,'')) paragraph.remove();
  });
  const first = $.root().children().first();
  const lead = first.is('p') ? $.html(first) : '';
  if (lead) first.remove();
  const cards = (campaign ? [] : destinations).map(item => {
    const entry = store.bySlug.get(item.slug), available = availableInContext(entry,context,store.settings);
    const icon = '<svg viewBox="0 0 24 24" aria-hidden="true">' + item.icon + '</svg>';
    const copy = '<span class="home-entry-copy"><span class="home-entry-title">' + item.label + '</span><span class="home-entry-description">' +
      (available ? item.description : 'Not available in this view.') + '</span></span>';
    return '<li>' + (available ? '<a class="home-entry" aria-label="' + item.label + '" href="' + escapeHtml(pageUrl(entry.slug,context.date,context)) + '">' + icon + copy + '<span class="home-entry-arrow" aria-hidden="true">↗</span></a>' :
      '<div class="home-entry home-entry-unavailable" role="group" aria-label="' + item.label + '">' + icon + copy + '</div>') + '</li>';
  }).join('');
  return {...home,title:pageTitle,homepage:true,toc:'',html:
    '<section class="home-hero" aria-label="'+escapeHtml('Welcome to '+pageTitle)+'"><div class="home-map" aria-hidden="true"></div><div class="home-hero-copy">' +
    '<span class="home-ornament" aria-hidden="true">◆</span>' + heading + '<div class="home-lead">' + lead + '</div></div></section>' +
    (cards ? '<nav class="home-destinations" aria-label="Explore Taelgar"><ul>' + cards + '</ul></nav>' : '') +
    '<section class="home-introduction'+(campaign ? ' home-introduction--campaign' : '')+'" aria-label="'+escapeHtml('About '+pageTitle)+'"><div class="home-section-label" aria-hidden="true">'+(campaign ? 'Campaign guide' : 'A world of stories')+'</div><div class="home-prose">' + $.html() + '</div></section>'};
}
