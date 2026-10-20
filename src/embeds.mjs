import {load} from 'cheerio';
import {escapeHtml} from './common.mjs';
import {authoredBody,availableInContext} from './content-store.mjs';
import {filterComments} from './comments.mjs';
import {fragmentId,renderMarkdown} from './markdown.mjs';

const MAX_DEPTH = 8, MAX_EMBEDS = 32;

// Keep only the requested section, including its nested headings. DOM ranges
// preserve callout/list wrappers even when a heading is nested inside them.
function selectFragment(html, fragment) {
  if (!fragment) return html;
  const $ = load(html,{},false), id = fragmentId(fragment);
  const auxiliary = $('section.footnotes,.dm-note-popup').remove();
  $('hr.footnotes-sep').remove();
  const target = $('[id]').filter((_,el)=>$(el).attr('id') === id).first();
  if (!target.length) return null;
  if (fragment.startsWith('^')) {
    const block = target.is('.note-block-anchor') ? target.closest('p,li,blockquote,table') : target;
    if (!block.length) return null;
    const selected = block.clone();
    $.root().empty().append(block.is('li') ? $('<' + block.parent()[0].tagName + '>').append(selected) : selected);
  } else {
    if (!target.is('h1,h2,h3,h4,h5,h6')) return null;
    const positions = new WeakMap(); let cursor = 0;
    const index = node => {
      const start = cursor++;
      for (const child of node.children || []) index(child);
      positions.set(node,{start,end:cursor});
    };
    index($.root()[0]);
    const start = positions.get(target[0]).start, level = Number(target[0].tagName.slice(1));
    const next = $('h1,h2,h3,h4,h5,h6').toArray().find(el=>positions.get(el).start > start && Number(el.tagName.slice(1)) <= level);
    const end = next ? positions.get(next).start : cursor;
    const prune = node => {
      for (const child of [...(node.children || [])]) {
        const range = positions.get(child);
        if (range.end <= start || range.start >= end) $(child).remove();
        else prune(child);
      }
    };
    prune($.root()[0]);
  }
  // Footnotes and DM popups are appended by Markdown rendering. Include only
  // those referenced by this section, never notes from the rest of the article.
  const popups = new Map(), footnotes = new Map();
  auxiliary.filter('.dm-note-popup').each((_,el)=>popups.set($(el).attr('id'),el));
  auxiliary.filter('section.footnotes').find('li[id]').each((_,el)=>footnotes.set($(el).attr('id'),el));
  const included = new Set(), selectedFootnotes = [];
  let changed = true;
  while (changed) {
    changed = false;
    $('[popovertarget],a[href^="#"]').each((_,el)=>{
      const ref = $(el).attr('popovertarget') || $(el).attr('href').slice(1);
      if (included.has(ref)) return;
      const popup = popups.get(ref), footnote = footnotes.get(ref);
      if (!popup && !footnote) return;
      included.add(ref); changed = true;
      const copy = $(popup || footnote).clone();
      if (popup) $.root().append(copy);
      else { selectedFootnotes.push(copy); $.root().append(copy); }
    });
  }
  if (selectedFootnotes.length) {
    const section = $('<section class="footnotes"><ol class="footnotes-list"></ol></section>');
    for (const item of selectedFootnotes) section.find('ol').append(item);
    $.root().append(section);
    // Backreferences for occurrences outside the selected section are stale.
    const ids = new Set($('[id]').map((_,el)=>$(el).attr('id')).get());
    $('a.footnote-backref').each((_,el)=>{if (!ids.has($(el).attr('href').slice(1))) $(el).remove();});
  }
  return $.html();
}

function scopeIds(html, prefix, href, used) {
  const $ = load(html,{},false), ids = new Map();
  $('[id]').each((_,el)=>{
    const old = $(el).attr('id'); let id = prefix + old;
    while (used.has(id)) id += '_';
    used.add(id); ids.set(old,id); $(el).attr('id',id);
  });
  $('a[href^="#"]').each((_,el)=>{
    const old = $(el).attr('href').slice(1);
    $(el).attr('href',ids.has(old) ? '#' + ids.get(old) : href.split('#')[0] + '#' + old);
  });
  $('[popovertarget],[aria-labelledby],[aria-describedby],[aria-controls],[for]').each((_,el)=>{
    for (const name of ['popovertarget','aria-labelledby','aria-describedby','aria-controls','for']) {
      const value = $(el).attr(name);
      if (value) $(el).attr(name,value.split(/\s+/).map(id=>ids.get(id) || id).join(' '));
    }
  });
  // Embedded headings remain readable without replacing the page's heading.
  $('h1,h2,h3,h4,h5').each((_,el)=>{el.tagName = 'h' + (Number(el.tagName.slice(1)) + 1);});
  return $.html();
}

function insert($, slot, html) {
  const parent = slot.closest('p');
  if (!parent.length) { slot.replaceWith(html); return; }
  // An Obsidian embed can occur within prose. Split the paragraph around the
  // block rather than putting a section inside a paragraph (invalid HTML).
  const content = node => node.text().trim() || node.find('img,audio,video,.note-embed-slot').length;
  const split = element => {
    const before = $(element).clone().empty(), after = $(element).clone().empty().removeAttr('id');
    let passed = false;
    for (const node of $(element).contents().toArray()) {
      if (node === slot[0]) { passed = true; continue; }
      if ($(node).find(slot).length) {
        const [left,right] = split(node);
        if (content(left)) before.append(left);
        if (content(right)) after.append(right);
        passed = true;
      } else (passed ? after : before).append($(node).clone());
    }
    return [before,after];
  };
  const [before,after] = split(parent[0]);
  parent.replaceWith((content(before) ? $.html(before) : '') + html + (content(after) ? $.html(after) : ''));
}

// The Worker supplies a request-local note cache and a pending set. A render
// discovers only visible embeds; the engine loads their shards and renders
// again. Node already has bodies in memory and completes in one pass.
export function expandNoteEmbeds(html, embeds, env, loading) {
  const root = load(html,{},false);
  const state = {count:0,used:new Set(root('[id]').map((_,el)=>root(el).attr('id')).get())};
  const expand = (html, descriptors, stack) => {
    const $ = load(html,{},false);
    const replace = el => {
      // A previous replacement may have removed an ancestor.
      if (!el.parent) return;
      const slot = $(el), embed = descriptors[Number(slot.attr('data-note-embed'))];
      if (!embed) {slot.replaceWith(slot.contents()); return;}
      const {entry,fragment,href,label} = embed;
      if (!availableInContext(entry,env.context,env.store.settings)) {slot.remove(); return;}
      const key = entry.id + '#' + fragment;
      const fallback = reason => {
        env.warnings.push(reason + ': ' + entry.id + (fragment ? '#' + fragment : ''));
        slot.replaceWith(slot.contents());
      };
      if (stack.includes(key)) return fallback('Recursive note embed omitted');
      if (stack.length > MAX_DEPTH || state.count >= MAX_EMBEDS) return fallback('Note embed limit reached');
      const number = ++state.count;
      const note = loading?.notes.get(entry.id) || entry.note;
      if (typeof note.body !== 'string') {
        loading?.pending.set(entry.id,entry);
        slot.replaceWith(slot.contents());
        return;
      }
      const dmNotes = [], noteEmbeds = [];
      let body;
      try {
        body = filterComments(authoredBody(note),{campaigns:env.context.campaigns,date:env.date,dm:env.context.dm,source:entry.id,notes:dmNotes});
      } catch (error) {
        if (error.status === 422) return fallback('Cannot safely render embedded note');
        throw error;
      }
      const rendered = renderMarkdown(env.markdown,body,{...env,entry,dmNotes,noteEmbeds});
      let content = selectFragment(rendered.html,fragment);
      if (content === null) return fallback('Embedded section unavailable in this view');
      content = expand(content,noteEmbeds,[...stack,key]);
      content = scopeIds(content,'note-embed-' + number + '-',href,state.used);
      const title = label || entry.title || entry.name;
      insert($,slot,'<section class="note-embed" aria-label="' + escapeHtml(title) + '"><div class="note-embed-title"><a href="' + escapeHtml(href) + '">' + escapeHtml(title) +
        '<span aria-hidden="true"> ↗</span></a></div><div class="note-embed-content">' + content + '</div></section>');
    };
    // Replacing a paragraph recreates any remaining inline slots in it.
    while ($('.note-embed-slot[data-note-embed]').length) replace($('.note-embed-slot[data-note-embed]')[0]);
    return $.html();
  };
  return expand(html,embeds,[env.entry.id + '#']);
}
