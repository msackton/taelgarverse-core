import path from 'node:path';
import MarkdownIt from 'markdown-it';
import attrs from 'markdown-it-attrs';
import footnote from 'markdown-it-footnote';
import deflist from 'markdown-it-deflist';
import {full as emoji} from 'markdown-it-emoji';
import {load} from 'cheerio';
import {escapeHtml, pageUrl, titleCase, contextQuery} from './common.mjs';
import {IMAGE_TYPES, AUDIO_TYPES, availableInContext} from './content-store.mjs';
import {decorateDMNotes} from './dm.mjs';
import {renderMap} from './maps.mjs';
import {renderIndexBlock} from './website-indexes.mjs';

import {icons} from './icons.mjs';
const aliases = {summary:'abstract',tldr:'abstract',hint:'tip',important:'tip',check:'success',done:'success',
  help:'question',faq:'question',caution:'warning',attention:'warning',fail:'failure',missing:'failure',error:'danger',cite:'quote'};
export const anchorId = value => value.trim().toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').replace(/\s+/g, '-');
export const fragmentId = value => value.startsWith('^') ? value.slice(1) : anchorId(value);

function wikiTarget(env, target) {
  if (!target) return {status:'heading',entry:env.entry};
  // Explicit relative paths belong to the authoring note, including inside embeds.
  if (/^\.\.?\//.test(target)) {
    const relative = path.posix.normalize(path.posix.join(path.posix.dirname(env.entry.id),target));
    const matches = env.store.canonical.get(relative) || env.store.canonical.get(relative + '.md');
    return matches?.size === 1 ? {status:'found',entry:[...matches][0]} : {status:matches ? 'ambiguous' : 'missing'};
  }
  return env.store.lookup(target);
}

function calloutClass(value) {
  const [raw, meta = ''] = value.toLowerCase().split('|');
  const base = aliases[raw.trim()] || raw.trim();
  if (base === 'image') {
    const tokens = meta.split(/[\s,]+/);
    const align = tokens.find(t => ['left','right'].includes(t));
    const size = tokens.find(t => ['small','standard','large'].includes(t));
    const role = tokens.find(t => ['aside','figure','hero'].includes(t)) || (size ? (align ? 'aside' : 'figure') : null);
    if (role) return ['image','taelgar-image','taelgar-image--' + role,
      ...(role === 'aside' ? ['inline', ...(align !== 'left' ? ['end'] : []), 'taelgar-image--align-' + (align || 'right')] : []),
      'taelgar-image--size-' + (size || 'standard')].join(' ');
  }
  return base + (['inline','left'].includes(meta.trim()) ? ' inline' : ['inline end','right'].includes(meta.trim()) ? ' inline end' : '');
}
function blockExtensions(md) {
  md.block.ruler.before('html_block', 'markdown_html', (state, start, end, silent) => {
    if (!state.md.options.html) return false;
    const startText = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]);
    if (!/^<div\b[^>]*\bmarkdown(?:="[^"]*")?[^>]*>\s*$/i.test(startText)) return false;
    let last = start + 1, depth = 1;
    for (; last < end; last++) {
      const line = state.src.slice(state.bMarks[last], state.eMarks[last]);
      depth += (line.match(/<div\b/gi) || []).length - (line.match(/<\/div>/gi) || []).length;
      if (depth === 0) break;
    }
    if (last >= end) return false;
    if (silent) return true;
    const open = state.push('html_block', '', 0);
    open.content = startText.replace(/\smarkdown(?:="[^"]*")?/i, '') + '\n';
    const inner = state.getLines(start + 1, last, state.blkIndent, false);
    state.md.block.parse(inner, state.md, state.env, state.tokens);
    const close = state.push('html_block', '', 0); close.content = '</div>\n';
    state.line = last + 1;
    return true;
  });
  md.block.ruler.before('blockquote', 'obsidian_callout', (state, start, end, silent) => {
    const lineAt = line => state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
    const match = /^> ?\[!([^\]]+)\]([-+]?)(.*)$/.exec(lineAt(start));
    if (!match) return false;
    if (silent) return true;
    const body = [];
    let line = start + 1;
    while (line < end && /^>/.test(lineAt(line))) body.push(lineAt(line++).replace(/^> ?/, ''));
    const type = calloutClass(match[1]);
    const fold = match[2], title = match[3].trim();
    const opening = state.push('html_block', '', 0);
    opening.content = fold
      ? '<details class="' + escapeHtml(type) + '"' + (fold === '+' ? ' open' : '') + '><summary>' + (title ? md.renderInline(title,state.env) : ' ') + '</summary>\n'
      : '<div class="admonition ' + escapeHtml(type) + '"><p class="admonition-title">' + (title ? md.renderInline(title,state.env) : ' ') + '</p>\n';
    state.md.block.parse(body.join('\n') + '\n', state.md, state.env, state.tokens);
    const closing = state.push('html_block', '', 0); closing.content = fold ? '</details>\n' : '</div>\n';
    state.line = line;
    return true;
  }, {alt: ['paragraph','reference','blockquote','list']});
}

function inlineExtensions(md) {
  md.inline.ruler.before('image', 'wikilink', (state, silent) => {
    const embed = state.src.startsWith('![[', state.pos);
    if (!embed && !state.src.startsWith('[[', state.pos)) return false;
    const end = state.src.indexOf(']]', state.pos + (embed ? 3 : 2));
    if (end < 0) return false;
    const parts = state.src.slice(state.pos + (embed ? 3 : 2), end).replace(/\\\|/g, '|').split('|');
    const [target, fragment = ''] = parts[0].split('#', 2);
    const label = parts[1] || target || fragment;
    if (silent) return true;
    const env = state.env;
    const resolution = /^(?:https?:\/\/|mailto:)/.test(target) ? {status:'external'} : wikiTarget(env,target);
    if (embed && resolution.entry?.note) {
      const entry = resolution.entry, href = pageUrl(entry.slug,env.date,env.context) + (fragment ? '#' + fragmentId(fragment) : '');
      // Capture the authored reference without expanding it in the backlink compiler.
      env.pageLinks?.add(entry.slug);
      if (availableInContext(entry,env.context || {date:env.date,campaigns:[]},env.store.settings)) {
        const index = (env.noteEmbeds ??= []).length;
        env.noteEmbeds.push({entry,fragment,label,href});
        state.push('html_inline','',0).content = '<span class="note-embed-slot" data-note-embed="' + index + '"><a href="' + escapeHtml(href) + '">' + escapeHtml(label) + '</a></span>';
      }
      state.pos = end + 2;
      return true;
    }
    if (resolution.status === 'external' || resolution.status === 'heading' || resolution.entry?.note) {
      const href = resolution.status === 'external' ? target : resolution.status === 'heading' ? '' : pageUrl(resolution.entry.slug, env.date,env.context);
      const open = state.push('link_open', 'a', 1); open.attrSet('href', href + (fragment ? '#' + fragmentId(fragment) : ''));
      state.push('text', '', 0).content = label;
      state.push('link_close', 'a', -1);
    } else if (resolution.entry) {
      const entry = resolution.entry, url = '/assets/' + entry.target.split('/').map(encodeURIComponent).join('/');
      if (IMAGE_TYPES.has(entry.extension)) {
        const image = state.push('image', 'img', 0);
        image.attrs = [['src', url], ['alt', titleCase(path.posix.basename(target, path.posix.extname(target)).replace(/[-_]/g, ' '))]];
        const altText = new state.Token('text', '', 0);
        altText.content = image.attrGet('alt');
        image.children = [altText];
        const align = parts.slice(1).find(x => ['left','right'].includes(x));
        const size = parts.slice(1).find(x => ['small','standard','large'].includes(x));
        const role = parts.slice(1).find(x => ['aside','figure','hero'].includes(x)) || (size ? (align ? 'aside' : 'figure') : null);
        if (align) image.attrSet('align', align);
        if (role) image.attrSet('class', ['taelgar-image','taelgar-image--' + role,
          ...(role === 'aside' ? ['taelgar-image--align-' + (align || 'right')] : []), 'taelgar-image--size-' + (size || 'standard')].join(' '));
        const numbers = parts.slice(1).flatMap(p => p.split('x')).filter(x => /^[0-9]+$/.test(x));
        if (numbers[0]) image.attrSet('width', numbers[0]);
        if (numbers[1]) image.attrSet('height', numbers[1]);
      } else if (AUDIO_TYPES.has(entry.extension) && embed) {
        state.push('html_inline', '', 0).content = '<audio controls preload="metadata" src="' + escapeHtml(url) + '"></audio>';
      } else {
        const open = state.push('link_open', 'a', 1); open.attrSet('href', url);
        state.push('text', '', 0).content = label;
        state.push('link_close', 'a', -1);
      }
    } else {
      env.warnings.push((resolution.status === 'ambiguous' ? 'Ambiguous link candidates' : 'Missing wikilink target') + ': ' + target);
      state.push('text', '', 0).content = label;
    }
    state.pos = end + 2;
    return true;
  });
  md.inline.ruler.before('text', 'taelgar_icon', (state, silent) => {
    if (state.src[state.pos] !== ':') return false;
    const match = /^:([a-z0-9-]+):(?:\{([^}]*)\})?/.exec(state.src.slice(state.pos));
    if (!match || !icons.has(match[1])) return false;
    if (!silent) {
      const classes = (match[2]?.match(/\.[\w-]+/g) || []).map(c => c.slice(1));
      state.push('html_inline', '', 0).content = '<span class="twemoji ' + classes.join(' ') + '">' + icons.get(match[1]) + '</span>';
    }
    state.pos += match[0].length;
    return true;
  });
}

export function createMarkdown(options = {}) {
  const md = new MarkdownIt({html: true, breaks: true, typographer: true, ...options})
    .use(footnote).use(deflist).use(emoji);
  if (md.options.html) md.use(attrs);
  blockExtensions(md);
  inlineExtensions(md);
  const originalFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, index, options, env, renderer) => {
    const type = tokens[index].info.trim();
    // The website already renders its campaign history after the article. An
    // empty Obsidian placement block must not add a visible code frame there.
    if (type==='taelgar-interactions' && !tokens[index].content.trim()) return '';
    if (/^taelgar-index(?:\s|$)/i.test(type)) return renderIndexBlock(tokens[index].content,env);
    if (/^mermaid(?:\s|$)/i.test(type)) {
      const query = contextQuery(env.context || {kind:'custom',date:env.date});
      query.set('source',env.entry.id);
      return '<figure class="mermaid-diagram" data-links-url="' + escapeHtml('/api/diagram-links?' + query) + '"><div class="mermaid-output"></div>' +
        '<details class="mermaid-source" open><summary>Diagram source</summary><pre><code class="language-mermaid">' +
        escapeHtml(tokens[index].content) + '</code></pre></details></figure>\n';
    }
    if (/^(?:taelgar-map|leaflet)(?:\s|$)/i.test(type)) return renderMap(tokens[index].content,env);
    if (['dataview','dataviewjs'].includes(type)) {
      env.warnings.push(type + ' block requires a materialized body or a future query adapter');
      return '<div class="admonition warning"><p class="admonition-title">Dynamic content unavailable</p><p>This block has not been rendered.</p></div>\n';
    }
    return originalFence(tokens,index,options,env,renderer);
  };
  const originalCode = md.renderer.rules.code_inline;
  md.renderer.rules.code_inline = (tokens,index,options,env,renderer) => {
    if (/^\$?=/.test(tokens[index].content)) {
      env.warnings.push('Inline Dataview expressions are not supported yet');
      return '<em>[Dynamic value unavailable]</em>';
    }
    return originalCode(tokens,index,options,env,renderer);
  };
  md.core.ruler.after('inline','taelgar_inline_fields',state => {
    const months = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    for (const block of state.tokens) for (const token of block.children || []) {
      if (token.type !== 'text') continue;
      token.content = token.content.replace(/\((\w+)::\s*([^\s\)]+)\s*\)/g,(_,key,value) => {
        if (!['DR','DR_end'].includes(key)) return key + ' ' + value;
        const [year,month,day] = value.split('-');
        return (month ? months[Number(month)] + (day ? ' ' + day + ',' : '') + ' ' : '') + year + ' DR';
      });
    }
  });
  md.core.ruler.after('inline','obsidian_block_ids',state => {
    for (const block of state.tokens) {
      if (block.type !== 'inline') continue;
      const last = block.children?.at(-1);
      const match = last?.type === 'text' && /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/.exec(last.content);
      if (!match || /\\\^[A-Za-z0-9-]+\s*$/.test(block.content)) continue;
      last.content = last.content.slice(0,match.index).trimEnd();
      const marker = new state.Token('html_inline','',0);
      marker.content = '<span class="note-block-anchor" id="' + match[1] + '"></span>';
      block.children.push(marker);
    }
  });
  // Prevent the text rule consuming icon shortcodes before our inline rule.
  const originalText = md.inline.ruler.__rules__.find(r => r.name === 'text').fn;
  md.inline.ruler.at('text', (state, silent) => {
    const rest = state.src.slice(state.pos);
    const position = rest.search(/:(?:octicons-[a-z0-9-]+|material-calendar|simple-dungeonsanddragons|speaker):/);
    if (position > 0) {
      const originalMax = state.posMax;
      state.posMax = state.pos + position;
      try { return originalText(state,silent); }
      finally { state.posMax = originalMax; }
    }
    return originalText(state, silent);
  });
  return md;
}

export function pageLinkEntry(store, href) {
  if (!href?.startsWith('/page/')) return;
  let target;
  try { target = decodeURIComponent(href.slice(6).split(/[?#]/,1)[0]).replace(/\/$/, ''); }
  catch { return; }
  const entry = store.bySlug?.get(target.replace(/\.md$/, '')) || store.lookup(target).entry;
  return entry?.note ? entry : undefined;
}

export function renderMarkdown(md, source, env) {
  const $ = load(md.render(source, env), {decodeEntities: false}, false);
  $('.note-block-anchor').each((_,element)=>{
    const anchor = $(element), parent = anchor.parent();
    let block = parent.closest('li,p,blockquote,table');
    if (parent.is('p') && !parent.text().trim() && parent.contents().length === 1 && parent.prev().length) block = parent.prev();
    if (!block.length || block.attr('id')) return;
    block.attr('id',anchor.attr('id'));
    anchor.remove();
    if (parent.is('p') && !parent.contents().length && parent[0] !== block[0]) parent.remove();
  });
  $('a[href], img[src], audio[src], source[src]').each((_, element) => {
    const el = $(element), attribute = element.tagName === 'a' ? 'href' : 'src';
    const raw = el.attr(attribute);
    if (!raw || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/page\/|\/assets\/)/i.test(raw)) return;
    const hash = raw.indexOf('#'), withoutHash = hash < 0 ? raw : raw.slice(0, hash);
    const fragment = hash < 0 ? '' : raw.slice(hash);
    let decoded;
    try { decoded = decodeURIComponent(withoutHash); } catch { return; }
    const relative = path.posix.normalize(path.posix.join(path.posix.dirname(env.entry.id), decoded));
    const exported = path.posix.normalize(path.posix.join(path.posix.dirname(env.entry.target), decoded));
    const resolution = env.store.lookup(relative);
    const entry = resolution.entry || env.store.lookup(exported).entry || env.store.lookup(decoded.replace(/^\/(?:taelgarverse\/)?/, '')).entry;
    if (entry) el.attr(attribute, entry.note ? pageUrl(entry.slug, env.date,env.context) + fragment : '/assets/' + entry.target.split('/').map(encodeURIComponent).join('/') + fragment);
  });
  // All resolved page links now share the website URL format, including links
  // from generated headers and rendered HTML. Keep their contents when hidden.
  const context = env.context || {date:env.date,campaigns:[]};
  $('a[href^="/page/"]').each((_, element) => {
    const el = $(element);
    const entry = pageLinkEntry(env.store,el.attr('href'));
    if (entry) {
      env.pageLinks?.add(entry.slug);
      if (!availableInContext(entry,context,env.store.settings)) el.replaceWith(el.contents());
      else el.attr('href',pageUrl(entry.slug,env.date,env.context) + (el.attr('href').includes('#') ? '#' + el.attr('href').split('#').slice(1).join('#') : ''));
    }
  });
  const used = new Set(), headings = [];
  $('h1,h2,h3,h4,h5,h6').each((_, element) => {
    const el = $(element), text = el.text();
    let id = el.attr('id') || anchorId(text), original = id, n = 1;
    while (used.has(id)) id = original + '_' + n++;
    used.add(id); el.attr('id', id);
    headings.push({level: Number(element.tagName.slice(1)), id, text});
  });
  const sections = headings[0]?.level===1 ? headings.slice(1) : headings;
  const outline = [], stack = [{level:0,children:outline}];
  for (const heading of sections) {
    while (stack.at(-1).level >= heading.level) stack.pop();
    const node = {...heading,children:[]};
    stack.at(-1).children.push(node); stack.push(node);
  }
  const list = nodes => '<ul>' + nodes.map(h=>'<li><a href="#' + escapeHtml(h.id) + '">' + escapeHtml(h.text) + '</a>' +
    (h.children.length ? list(h.children) : '') + '</li>').join('') + '</ul>';
  const toc = outline.length ? '<div class="toc">' + list(outline) + '</div>' : '';
  const popups = decorateDMNotes($,env.dmNotes,text => renderMarkdown(env.notesMarkdown,text,{
    store:env.store, entry:env.entry, date:env.date, context:env.context, warnings:env.warnings, pageLinks:env.pageLinks, noteEmbeds:env.noteEmbeds,
  }).html);
  if (popups) $.root().append(popups);
  return {html: $.html(), toc};
}
