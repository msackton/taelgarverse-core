import {escapeHtml,contextQuery} from './common.mjs';
export {contextQuery};
const icon = paths => '<svg viewBox="0 0 24 24" aria-hidden="true">' + paths + '</svg>';
const searchIcon = icon('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>');
const control = (id,label,svg) => '<button type="button" class="icon-button" id="' + id + '-toggle" aria-label="' + label + '" aria-haspopup="dialog" aria-controls="' + id + '-dialog" hidden>' + svg + '</button>';
export function siteHeader(context, options, {query,sections = '',navigation = true} = {}) {
  const custom = context.kind === 'custom';
  const choices = options.map(option => '<option value="' + escapeHtml(option.id) + '"' +
    (option.id === context.id ? ' selected' : '') + (!option.available ? ' disabled' : '') + '>' +
    escapeHtml(option.label + (option.date ? ' · ' + option.date + ' DR' : option.available ? '' : ' · date unavailable')) + '</option>').join('');
  const campaigns = options.filter(option=>option.kind==='campaign');
  const selected = new Set(context.campaigns), all = !custom || context.allCampaigns ||
    campaigns.length > 0 && campaigns.every(option=>selected.has(option.campaigns[0]));
  const selectionLabel = all ? 'All campaigns' : selected.size === 0 ? 'No campaigns' : selected.size === 1 ?
    campaigns.find(option=>selected.has(option.campaigns[0]))?.label || '1 campaign' : selected.size + ' campaigns';
  const picker = '<details class="campaign-picker" data-campaign-picker><summary>Campaigns: <span data-campaign-summary>' + escapeHtml(selectionLabel) + '</span></summary>' +
    '<fieldset class="campaign-options"><legend class="sr-only">Campaigns to show</legend>' +
    '<input type="hidden" name="campaigns" value=""' + (custom ? '' : ' disabled') + '>' +
    '<label class="campaign-all"><input type="checkbox" name="campaigns" value="all" data-campaign-all' + (all ? ' checked' : '') + (custom ? '' : ' disabled') + '> All campaigns</label>' +
    campaigns.map(option=>'<label><input type="checkbox" name="campaigns" value="' + escapeHtml(option.campaigns[0]) + '" data-campaign-choice' +
      (all || selected.has(option.campaigns[0]) ? ' checked' : '') + (custom ? '' : ' disabled') + '> ' + escapeHtml(option.label) + '</label>').join('') +
    '</fieldset></details>';
  const searchFields = [...contextQuery(context)].map(([key,value])=>'<input type="hidden" name="' + key + '" value="' + escapeHtml(value) + '">').join('');
  return '<header class="site-header" id="site-header">' +
    (navigation ? control('navigation','Open navigation',icon('<path d="M3 6h18M3 12h18M3 18h18"/>')) : '') +
    '<a class="site-brand" href="/?' + escapeHtml(contextQuery(context).toString()) + '">TaelgarVerse</a>' +
    '<div id="header-search-slot"><form class="header-search" id="header-search" role="search" action="/">' + searchFields +
    '<label class="sr-only" for="site-search">Search TaelgarVerse</label><input id="site-search" type="search" name="q" maxlength="256" value="' + escapeHtml(query || '') + '" placeholder="Search TaelgarVerse"><button aria-label="Search">' + searchIcon + '</button></form></div>' +
    '<div id="header-context-slot"><form id="context-controls" class="context-form" method="get" data-context-form>' +
    (query !== undefined ? '<input type="hidden" name="q" value="' + escapeHtml(query) + '">' : '') +
    '<label class="context-label" for="site-context">Context:</label><select id="site-context" name="context" aria-label="Context">' + choices + '</select>' +
    '<div class="custom-date-controls" data-custom-date' + (custom ? '' : ' hidden') + '>' +
    '<label class="sr-only" for="context-date">Custom date (DR)</label><input id="context-date" type="date" name="date" aria-label="Custom date (DR)" value="' +
    context.date + '" min="0001-01-01" max="9999-12-31"' + (custom ? ' required' : ' disabled') + '>' + picker + '<button type="submit">Apply</button></div>' +
    '<label class="dm-toggle"><input type="checkbox" name="dm" value="1"' + (context.dm ? ' checked' : '') + '> See Behind the Curtain</label>' +
    '<noscript><button type="submit">Apply context</button></noscript></form></div><div class="header-tools">' +
    control('search','Open search',searchIcon) +
    control('settings','Open settings',icon('<path d="m9 3-.6 2.4-2.1 1.2L4 6l-2 3 1.8 1.8v2.4L2 15l2 3 2.3-.6 2.1 1.2L9 21h4l.6-2.4 2.1-1.2 2.3.6 2-3-1.8-1.8v-2.4L20 9l-2-3-2.3.6-2.1-1.2L13 3Z"/><circle cx="11" cy="12" r="3"/>')) +
    '</div>' + sections + '</header>' +
    '<script src="/theme/context.js" defer></script>';
}

export function siteDialogs() {
  const dialog = (name,title,body) => '<dialog class="site-dialog' + (name==='navigation' ? ' nav-drawer' : '') + '" id="' + name + '-dialog" aria-labelledby="' + name + '-title"><div class="dialog-heading"><h2 id="' + name + '-title">' + title + '</h2><button type="button" data-close-dialog="' + name + '-dialog" aria-label="Close ' + title.toLowerCase() + '">×</button></div>' + body + '</dialog>';
  return dialog('navigation','Explore Taelgar','<div id="navigation-dialog-body"></div>') +
    dialog('search','Search TaelgarVerse','<div id="search-dialog-body"></div>') +
    dialog('settings','Settings','<label class="appearance-control" for="site-appearance">Appearance <select id="site-appearance"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label><div id="settings-dialog-body"></div>') +
    '<button id="back-to-top" class="back-to-top" type="button" hidden>↑ Back to top</button>';
}
