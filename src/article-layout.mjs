import {load} from 'cheerio';

const expanded = '.leaflet-map,.taelgar-image--hero,.taelgar-image-gallery,.admonition.gallery,details.gallery,.taelgar-image--figure.taelgar-image--size-large,.mermaid-diagram';
const floated = '.taelgar-image--aside,.image.inline,img[align],.taelgar-session-zoom__image--left,.taelgar-session-zoom__image--right';

// A Markdown image is usually inside a paragraph (and sometimes a link). Only
// promote that wrapper when it contains media, never a sentence with an image.
function mediaParagraph($, node) {
  return node.is('p') && node.find('img').length > 0 && !node.text().trim() &&
    node.find('*').toArray().every(el=>['img','a','br'].includes(el.tagName));
}

// Keep ordinary blocks in a shared formatting context: turning each paragraph
// into a grid item would silently sever the relationship with floated portraits.
// This is shell presentation only; API fragments and embed anchors stay intact.
export function articleLayout(html, {wide = false} = {}) {
  const $ = load(html,{},false);
  const group = parent => {
    let prose;
    for (const element of parent.contents().toArray()) {
      const node = $(element);
      if (element.type !== 'tag') {
        if (prose) prose.append(node);
        continue;
      }
      if (node.is('.dm-note-popup,[popover],script,style')) { prose = undefined; continue; }
      const media = mediaParagraph($,node);
      const floating = node.is(floated) || (media && node.find(floated).length > 0);
      const breakout = !floating && (node.is(expanded) ||
        (media && node.find(expanded).length > 0) ||
        (node.is('.note-embed') && node.children('.note-embed-content').children('.article-breakout').length > 0) ||
        (wide && (node.is('table,figure') || media)));
      if (breakout) {
        prose = undefined;
        // Material styles unclassed tables; use a wrapper to retain those rules.
        if (node.is('table')) node.wrap('<div class="article-breakout article-table"></div>');
        else node.addClass('article-breakout');
      } else {
        if (!prose) {
          prose = $('<div class="article-prose"></div>');
          node.before(prose);
        }
        prose.append(node);
      }
    }
  };
  // Embeds are independent documents. Allow their semantic media room without
  // widening their paragraphs or unwrapping their title, border, or scoped IDs.
  $('.note-embed-content').toArray().reverse().forEach(el=>group($(el)));
  group($.root());
  return $.html();
}
