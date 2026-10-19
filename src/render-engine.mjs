import {RenderError, escapeHtml, parseDM} from './common.mjs';
import {parseNote, availableInContext} from './content-store.mjs';
import {filterComments} from './comments.mjs';
import {createMarkdown, renderMarkdown} from './markdown.mjs';
import {Contexts} from './contexts.mjs';
import {siteHeader} from './header.mjs';
import {Navigation} from './navigation.mjs';

export class RenderEngine {
  constructor({settings,store,headers,renderHeader,navigationSource}) {
    this.settings = settings;
    this.store = store;
    this.headers = headers;
    this.renderHeader = renderHeader;
    this.contexts = new Contexts(this.store,this.headers.registry,settings);
    this.markdown = createMarkdown();
    this.notesMarkdown = createMarkdown({html:false});
    this.navigation = new Navigation(this.store,navigationSource);
  }

  resolvePage(page, date, contextId, dm = false) {
    dm = parseDM(dm);
    const context = {...this.contexts.resolve(contextId,date), dm};
    const entry = this.store.resolve(page);
    if (!availableInContext(entry,context)) throw new RenderError(404,'Page is not available in this context');
    return {entry,context};
  }

  render(page, date, contextId, dm = false, loadedNote) {
    const {entry,context} = this.resolvePage(page,date,contextId,dm);
    date = context.date;
    dm = context.dm;
    const metadata = entry.note.metadata;
    const note = loadedNote || entry.note;
    let body = note.body;
    // Prepared Markdown places this marker at the start of the body. A leading
    // marker is explicit; examples inside code or prose are left alone.
    const headerMarker = /^[ \t\r\n]*<!-- taelgar:header -->[ \t]*(?:\r?\n|$)/.exec(body);
    if (headerMarker || (metadata.headerVersion && metadata.tags)) {
      try {
        const source = headerMarker ? '---\n---\n' : note.source;
        const generated = parseNote(this.renderHeader(this.headers, {source, name: entry.name, metadata, date})).body;
        body = headerMarker ? generated.trimEnd() + '\n\n' + body.slice(headerMarker[0].length).replace(/^(?:[ \t]*\r?\n)*/, '') : generated;
      } catch (error) {
        const wrapped = new RenderError(422, 'Header generation failed; check the configured CustomJS runtime');
        wrapped.cause = error;
        throw wrapped;
      }
    }
    const dmNotes = [];
    try {
      body = filterComments(body, {campaigns: context.campaigns, date, source: entry.id, dm, notes:dmNotes});
    } catch (error) {
      if (error.status === 422) throw new RenderError(422, 'Cannot safely render ' + entry.id + ': ' + error.reason);
      throw error;
    }
    const warnings = [];
    const rendered = renderMarkdown(this.markdown, body, {store: this.store, entry, date, context, warnings, dmNotes, notesMarkdown:this.notesMarkdown});
    return {page: entry.slug, title: entry.title, date, dm, campaigns: [...context.campaigns],context,
      ...rendered, warnings: [...new Set(warnings)]};
  }
}

export function document(result,contextOptions,navigation) {
  const warning = result.warnings.length ? '<details class="warning"><summary>Render notes</summary><ul>' +
    result.warnings.map(w => '<li>' + escapeHtml(w) + '</li>').join('') + '</ul></details>' : '';
  const view = navigation?.view(result.context,result.page,result.navigationId);
  const sidebar = view ? navigation.sidebar(view) : '';
  const breadcrumbs = view ? navigation.breadcrumbs(view) : '';
  const toc = result.toc ? '<aside class="page-toc"><details open><summary>On this page</summary><nav aria-label="On this page">' + result.toc + '</nav></details></aside>' : '';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escapeHtml(result.title) + ' — TaelgarVerse</title><link rel="stylesheet" href="/theme/material.css">' +
    '<link rel="stylesheet" href="/theme/taelgarverse.css"><link rel="stylesheet" href="/theme/preview.css"></head>' +
    '<body data-md-color-scheme="default" data-md-color-primary="teal" data-md-color-accent="deep-purple">' +
    siteHeader(result.context,contextOptions,{query:result.query}) +
    '<a class="skip-link" href="#page-content">Skip to content</a><div class="layout' + (toc ? '' : ' layout--no-toc') + '">' + sidebar +
    '<main id="page-content" class="md-typeset article-main">' + breadcrumbs + result.html + warning + '</main>' + toc +
    '</div><script src="/theme/navigation.js" defer></script></body></html>';
}
