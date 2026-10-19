import {escapeHtml,contextQuery} from './common.mjs';
export {contextQuery};
export function siteHeader(context, options, {query = ''} = {}) {
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
  return '<header class="site-header"><a class="site-brand" href="/?' + escapeHtml(contextQuery(context).toString()) + '">TaelgarVerse</a>' +
    '<form class="context-form" method="get" data-context-form>' +
    (query ? '<input type="hidden" name="q" value="' + escapeHtml(query) + '">' : '') +
    '<label class="context-label" for="site-context">Context:</label><select id="site-context" name="context" aria-label="Context">' + choices + '</select>' +
    '<div class="custom-date-controls" data-custom-date' + (custom ? '' : ' hidden') + '>' +
    '<label class="sr-only" for="context-date">Custom date (DR)</label><input id="context-date" type="date" name="date" aria-label="Custom date (DR)" value="' +
    context.date + '" min="0001-01-01" max="9999-12-31"' + (custom ? ' required' : ' disabled') + '>' + picker + '<button type="submit">Apply</button></div>' +
    '<label class="dm-toggle"><input type="checkbox" name="dm" value="1"' + (context.dm ? ' checked' : '') + '> See Behind the Curtain</label>' +
    '<noscript><button type="submit">Apply context</button></noscript></form></header>' +
    '<script src="/theme/context.js" defer></script>';
}
