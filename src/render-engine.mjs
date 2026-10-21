import {RenderError, escapeHtml, parseDM, parsePOV} from './common.mjs';
import {buildBacklinkIndex,buildBacklinkCampaigns,linkedFrom} from './backlinks.mjs';
import {parseNote, availableInContext} from './content-store.mjs';
import {filterComments} from './comments.mjs';
import {createMarkdown, renderMarkdown} from './markdown.mjs';
import {Contexts} from './contexts.mjs';
import {siteHeader,siteDialogs} from './header.mjs';
import {Navigation} from './navigation.mjs';
import {expandNoteEmbeds} from './embeds.mjs';
import {releaseFooter} from './release-footer.mjs';
import {decoratePronunciation} from './pronunciation.mjs';
import {stripPronunciationLink} from './pronunciation-data.mjs';
import {responsiveImages} from './images.mjs';
import {CampaignSites} from './campaign-sites.mjs';
import {articleLayout} from './article-layout.mjs';

export class RenderEngine {
  constructor({settings,store,headers,renderHeader,navigationSource,homeSource = null,campaignHomes = {},backlinkIndex}) {
    this.settings = settings;
    this.store = store;
    this.store.settings = settings;
    this.headers = headers;
    this.renderHeader = renderHeader;
    this.contexts = new Contexts(this.store,this.headers.registry,settings);
    this.campaignSites = new CampaignSites(campaignHomes,this.contexts);
    this.markdown = createMarkdown();
    this.notesMarkdown = createMarkdown({html:false});
    this.navigation = new Navigation(this.store,navigationSource);
    this.home = homeSource === null ? null : parseNote(homeSource);
    this.backlinkIndex = backlinkIndex === undefined ? buildBacklinkIndex(store) : backlinkIndex;
    this.backlinkCampaigns = buildBacklinkCampaigns(store,this.headers.registry);
    if (backlinkIndex === undefined) this.store.warnings.push(...this.backlinkIndex.warnings);
  }

  resolvePage(page, date, contextId, dm = false, selectedCampaigns, pov) {
    dm = parseDM(dm);
    pov = parsePOV(pov);
    const context = {...this.contexts.resolve(contextId,date,selectedCampaigns), dm,...(pov === undefined ? {} : {pov})};
    const entry = this.store.resolve(page);
    if (!availableInContext(entry,context,this.settings)) throw new RenderError(404,'Page is not available in this context');
    return {entry,context};
  }

  render(page, date, contextId, dm = false, loadedNote, selectedCampaigns, embedLoading, pov) {
    const {entry,context} = this.resolvePage(page,date,contextId,dm,selectedCampaigns,pov);
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
    const hide = Array.isArray(metadata.hide) ? metadata.hide : typeof metadata.hide === 'string' ? metadata.hide.split(/[\s,]+/) : [];
    const rendered = decoratePronunciation(this.renderBody(stripPronunciationLink(body),entry,context,embedLoading),entry,this.store);
    if (hide.includes('toc')) rendered.toc = '';
    return {page: entry.slug, title: entry.title, date, dm, campaigns: [...context.campaigns],context,hide,
      ...(metadata.layout === 'wide' ? {layout:'wide'} : {}),
      ...rendered, backlinks:this.backlinkIndex && (this.backlinkIndex.version>=2 || context.campaigns.length<=1)
        ? linkedFrom(this.backlinkIndex,this.store,entry.slug,context,this.backlinkCampaigns) : undefined};
  }

  async renderAsync(page,date,contextId,dm,selectedCampaigns,loadNote,pov) {
    const {entry} = this.resolvePage(page,date,contextId,dm,selectedCampaigns,pov);
    const note = await loadNote(entry);
    return this.loadEmbeds(loading=>this.render(page,date,contextId,dm,note,selectedCampaigns,loading,pov),loadNote,new Map([[entry.id,note]]));
  }

  async loadEmbeds(render,loadNote,notes=new Map()) {
    const loading = {notes,pending:new Map()};
    for (;;) {
      loading.pending.clear();
      const result = render(loading);
      if (!loading.pending.size) return result;
      await Promise.all([...loading.pending.values()].map(async entry=>loading.notes.set(entry.id,await loadNote(entry))));
    }
  }

  renderHome(context,embedLoading,siteHost) {
    // This is website content, not a searchable vault article or a header input.
    const home = siteHost ? this.campaignSites.byHost.get(siteHost)?.note : this.home;
    if (!home) return null;
    return {...this.renderBody(home.body,{id:'_website/'+(siteHost || 'home')+'.md',target:'index.md'},context,embedLoading),hide:Array.isArray(home.metadata.hide) ? home.metadata.hide : []};
  }

  async renderHomeAsync(context,loadNote,siteHost) {
    return this.loadEmbeds(loading=>this.renderHome(context,loading,siteHost),loadNote);
  }

  renderBody(body, entry, context, embedLoading) {
    const {date,dm} = context, dmNotes = [];
    try {
      body = filterComments(body, {campaigns: context.campaigns, date, source: entry.id, dm, notes:dmNotes});
    } catch (error) {
      if (error.status === 422) throw new RenderError(422, 'Cannot safely render ' + entry.id + ': ' + error.reason);
      throw error;
    }
    const warnings = [];
    const noteEmbeds = [], env = {store:this.store,entry,date,context,warnings,dmNotes,notesMarkdown:this.notesMarkdown,noteEmbeds};
    const rendered = renderMarkdown(this.markdown,body,env);
    if (noteEmbeds.length) rendered.html = expandNoteEmbeds(rendered.html,noteEmbeds,{...env,markdown:this.markdown},embedLoading);
    rendered.html = responsiveImages(rendered.html,this.store,{wide:entry.note?.metadata.layout === 'wide'});
    return {...rendered,warnings: [...new Set(warnings)]};
  }
}

export function document(result,contextOptions,navigation,releases) {
  const article = result.homepage ? result.html : articleLayout(result.html,{wide:result.layout === 'wide'});
  const view = navigation?.view(result.context,result.page,result.navigationId);
  const showNavigation = view && view.roots.length > 0 && !result.hide?.includes('navigation');
  const sidebar = showNavigation ? navigation.sidebar(view) : '';
  const hasSection = showNavigation && view.trail[0]?.children.length > 0;
  const breadcrumbs = view ? navigation.breadcrumbs(view) : '';
  const toc = result.toc && !result.hide?.includes('toc') ? '<section class="page-contents"><h2 class="page-nav-title">On this page</h2><nav aria-label="On this page">' + result.toc + '</nav></section>' : '';
  const backlinks = Array.isArray(result.backlinks) && result.backlinks.length ? '<details class="page-backlinks" open><summary>Linked from</summary>' +
    '<nav aria-label="Linked from"><ul>' + result.backlinks.map(link =>
      '<li><a href="' + escapeHtml(link.url) + '">' + escapeHtml(link.title) + '</a></li>').join('') + '</ul></nav></details>' : '';
  const pageNav = toc || backlinks ? '<aside class="page-toc' + (toc ? '' : ' page-toc--backlinks-only') + '" aria-label="Page navigation">' +
    toc + backlinks + '</aside>' : '';
  const diagrams = result.html.includes('class="mermaid-diagram"') ? '<script type="module" src="/theme/diagrams.js"></script>' : '';
  const maps = result.html.includes('class="leaflet-map"');
  const pronunciation = result.html.includes('class="pronunciation-control"');
  return '<!doctype html><html lang="en" dir="ltr" data-appearance="system"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><script src="/theme/appearance.js"></script>' +
    '<title>' + escapeHtml(result.title) + ' — TaelgarVerse</title><link rel="stylesheet" href="/theme/material.css">' +
    '<link rel="stylesheet" href="/theme/taelgarverse.css"><link rel="stylesheet" href="/theme/preview.css"><link rel="stylesheet" href="/theme/image-viewer.css"><link rel="stylesheet" href="/theme/quiet-library.css">' +
    (maps ? '<link rel="stylesheet" href="/theme/leaflet.css"><link rel="stylesheet" href="/theme/maps.css">' : '') +
    (pronunciation ? '<link rel="stylesheet" href="/theme/pronunciation.css">' : '') +
    (result.search ? '<link rel="stylesheet" href="/theme/search.css">' : '') +
    (result.homepage ? '<link rel="stylesheet" href="/theme/homepage.css">' : '') + '</head>' +
    '<body>' + siteHeader(result.context,contextOptions,{query:result.query,searchType:result.searchType,sections:showNavigation ? navigation.sections(view) : '',navigation:!!showNavigation}) +
    '<a class="skip-link" href="#page-content">Skip to content</a><div class="layout' + (pageNav ? '' : ' layout--no-toc') + (hasSection ? '' : ' layout--no-navigation') + (result.homepage ? ' layout--home' : '') + '">' + sidebar +
    '<main id="page-content" class="md-typeset article-main" tabindex="-1">' + breadcrumbs + article + '</main>' + pageNav +
    '</div>' + siteDialogs() + releaseFooter(releases) + '<script src="/theme/release.js" defer></script><script src="/theme/navigation.js" defer></script><script src="/theme/site-ui.js" defer></script><script type="module" src="/theme/search-overlay.js"></script><script src="/theme/image-viewer.js" defer></script>' + diagrams +
    (pronunciation ? '<script src="/theme/pronunciation.js" defer></script>' : '') +
    (maps ? '<script type="module" src="/theme/maps.js"></script>' : '') + '</body></html>';
}
