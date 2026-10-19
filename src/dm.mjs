import {load} from 'cheerio';
import {escapeHtml} from './common.mjs';

// The parser leaves anchors at source locations; the rendered DOM tells us
// where the paragraph actually ends (including lists, tables and callouts).
export function decorateDMNotes($, notes, renderComment) {
  if (!notes?.length) return '';
  const positions = new WeakMap();
  $('*').each((index, element) => positions.set(element,index));
  const paragraphs = $('p,li,td,th').toArray();
  const scope = element => $(element).closest('.dm-only-block')[0];
  const hasContent = element => {
    const copy = $(element).clone();
    copy.find('.dm-note-anchor,.dm-note-ref').remove();
    return Boolean(copy.text().trim() || copy.find('img,audio,video,hr').length);
  };
  const emptyParagraphs = new Set();
  const popups = [];
  for (const note of notes) {
    const anchor = $('.dm-note-anchor[data-dm-note="' + note.id + '"]').first();
    if (!anchor.length) continue;
    const element = anchor[0], container = anchor.closest('p,li,td,th');
    let target = container.length && hasContent(container[0]) ? container : null;
    if (!target) {
      const previous = paragraphs.filter(candidate => positions.get(candidate) < positions.get(element) &&
        scope(candidate) === scope(element) && !$(candidate).is('.dm-block-label,.admonition-title') &&
        !$(candidate).find(element).length && hasContent(candidate)).at(-1);
      if (previous) target = $(previous);
    }
    const popupId = 'taelgar-dm-note-' + note.id;
    const reference = '<sup class="dm-note-ref"><button type="button" class="dm-note-trigger" popovertarget="' + popupId +
      '" aria-label="Behind the Curtain note ' + note.id + '" aria-haspopup="dialog" title="Behind the Curtain note ' + note.id + '">' + note.id + '</button></sup>';
    if (target) { target.append(reference); anchor.remove(); }
    else anchor.replaceWith(reference);
    if (container.is('p')) emptyParagraphs.add(container[0]);

    const content = load(renderComment(note.text),{},false);
    const ids = new Map();
    content('[id]').each((_, el) => {
      const old = content(el).attr('id'), id = popupId + '-content-' + old;
      ids.set(old,id); content(el).attr('id',id);
    });
    content('a[href^="#"]').each((_, el) => {
      const id = ids.get(content(el).attr('href').slice(1));
      if (id) content(el).attr('href','#' + id);
    });
    popups.push('<div id="' + popupId + '" class="dm-note-popup" popover="auto" role="dialog" aria-labelledby="' + popupId + '-title">' +
      '<div class="dm-note-header"><strong id="' + popupId + '-title">Behind the Curtain · Note ' + escapeHtml(note.id) + '</strong>' +
      '<button type="button" class="dm-note-close" popovertarget="' + popupId + '" popovertargetaction="hide" aria-label="Close Behind the Curtain note ' + note.id + '">×</button></div>' +
      '<div class="dm-note-content">' + content.html() + '</div></div>');
  }
  for (const element of emptyParagraphs) {
    if (!hasContent(element) && !$(element).find('.dm-note-ref').length) $(element).remove();
  }
  return popups.join('');
}
