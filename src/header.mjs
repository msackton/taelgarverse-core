import {escapeHtml} from './common.mjs';

export function contextQuery(context) {
  const query = context.kind === 'custom' ? new URLSearchParams({date:context.date}) : new URLSearchParams({context:context.id});
  if (context.dm) query.set('dm','1');
  return query;
}
export function siteHeader(context, options, {query = ''} = {}) {
  const custom = context.kind === 'custom';
  const choices = options.map(option => '<option value="' + escapeHtml(option.id) + '"' +
    (option.id === context.id ? ' selected' : '') + (!option.available ? ' disabled' : '') + '>' +
    escapeHtml(option.label + (option.date ? ' · ' + option.date + ' DR' : option.available ? '' : ' · date unavailable')) + '</option>').join('');
  return '<header class="site-header"><a class="site-brand" href="/?' + escapeHtml(contextQuery(context).toString()) + '">TaelgarVerse</a>' +
    '<form class="context-form" method="get" data-context-form>' +
    (query ? '<input type="hidden" name="q" value="' + escapeHtml(query) + '">' : '') +
    '<label class="context-label" for="site-context">Context:</label><select id="site-context" name="context" aria-label="Context">' + choices + '</select>' +
    '<span class="custom-date-controls" data-custom-date' + (custom ? '' : ' hidden') + '>' +
    '<label class="sr-only" for="context-date">Custom date (DR)</label><input id="context-date" type="date" name="date" aria-label="Custom date (DR)" value="' +
    context.date + '" min="0001-01-01" max="9999-12-31"' + (custom ? ' required' : ' disabled') + '><button type="submit">Apply</button></span>' +
    '<label class="dm-toggle"><input type="checkbox" name="dm" value="1"' + (context.dm ? ' checked' : '') + '> See Behind the Curtain</label>' +
    '<noscript><button type="submit">Apply context</button></noscript></form></header>' +
    '<script src="/theme/context.js" defer></script>';
}
