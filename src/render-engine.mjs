import {RenderError, escapeHtml, parseDM, pageUrl} from './common.mjs';
import {buildBacklinkIndex,buildBacklinkCampaigns,linkedFrom} from './backlinks.mjs';
import {parseNote, availableInContext} from './content-store.mjs';
import {filterComments} from './comments.mjs';
import {createMarkdown, renderMarkdown} from './markdown.mjs';
import {Contexts} from './contexts.mjs';
import {siteHeader,siteDialogs} from './header.mjs';
import {Navigation} from './navigation.mjs';
import {expandNoteEmbeds} from './embeds.mjs';
import {releaseFooter} from './release-footer.mjs';
import {responsiveImages} from './images.mjs';
import {CampaignSites} from './campaign-sites.mjs';
import {articleLayout} from './article-layout.mjs';
import {scanHeaderCallouts} from './header-callout.mjs';
import {renderHeaderCallout} from './header-core/index.mjs';
import {HeaderDataError} from './header-core/errors.mjs';
import {compileInteractionIndex,campaignInteractions} from './campaign-interactions.mjs';
import {interactionSummary,interactionView} from './interaction-view.mjs';
import {addHeaderIndexes,renderHeaderIndex,HEADER_INDEX_SLOT} from './website-indexes.mjs';
import {headerIndexesForMetadata} from './indexes.mjs';

export class RenderEngine {
  constructor({settings,store,headers,navigationSource,homeSource = null,campaignHomes = {},backlinkIndex,prepared,interactionIndex,interactionBundles}) {
    this.settings = settings;
    this.store = store;
    this.store.settings = settings;
    this.headers = headers;
    this.contexts = prepared?.contexts || new Contexts(this.store,this.headers.registry,settings);
    this.campaignSites = prepared?.campaignSites || new CampaignSites(campaignHomes,this.contexts);
    this.markdown = createMarkdown();
    this.notesMarkdown = createMarkdown({html:false});
    this.navigation = prepared?.navigation || new Navigation(this.store,navigationSource);
    this.home = prepared ? prepared.home : homeSource === null ? null : parseNote(homeSource);
    this.backlinkIndex = backlinkIndex === undefined ? buildBacklinkIndex(store) : backlinkIndex;
    this.backlinkCampaigns = prepared?.backlinkCampaigns || buildBacklinkCampaigns(store,this.headers.registry);
    this.loadBacklinks = prepared?.loadBacklinks;
    if (backlinkIndex === undefined) this.store.warnings.push(...this.backlinkIndex.warnings);
    this.interactionIndex = interactionIndex || compileInteractionIndex(store,headers.registry,this.backlinkIndex,interactionBundles);
    this.projectInteractionBacklinks = !interactionIndex && !!this.loadBacklinks;
    if (!interactionIndex) this.store.warnings.push(...this.interactionIndex.warnings);
  }

  resolvePage(page, date, contextId, dm = false, selectedCampaigns) {
    dm = parseDM(dm);
    const context = {...this.contexts.resolve(contextId,date,selectedCampaigns), dm};
    const entry = this.store.resolve(page);
    if (!availableInContext(entry,context)) throw new RenderError(404,'Page is not available in this context');
    return {entry,context};
  }

  render(page, date, contextId, dm = false, loadedNote, selectedCampaigns, embedLoading, backlinkIndex = this.backlinkIndex) {
    const {entry,context} = this.resolvePage(page,date,contextId,dm,selectedCampaigns);
    date = context.date;
    dm = context.dm;
    const metadata = entry.note.metadata;
    const note = loadedNote || entry.note;
    let body = note.body;
    const callouts=scanHeaderCallouts(body);
    const hasHeaderIndexSlot=callouts.length>0 && (metadata.indexes!==undefined || headerIndexesForMetadata(metadata).length>0);
    if(callouts.length) {
      try {
        let generated=renderHeaderCallout(this.headers,{name:entry.name,metadata,date,mode:'website'}).trimEnd();
        let ordinal=callouts.length;
        for(const callout of [...callouts].reverse()) {
          // A note has one controls row even if the author repeats its header.
          const controls=hasHeaderIndexSlot && --ordinal===0 ? '\n\n'+HEADER_INDEX_SLOT : '';
          body=body.slice(0,callout.start)+generated+controls+'\n\n'+body.slice(callout.end);
        }
      } catch (error) {
        if(error instanceof HeaderDataError)throw new RenderError(422,`Header generation failed: circular ${error.kind} chain.`);
        const wrapped = new RenderError(422, 'Header generation failed; check the note metadata and display rules');
        wrapped.cause = error;
        throw wrapped;
      }
    }
    const hide = Array.isArray(metadata.hide) ? metadata.hide : typeof metadata.hide === 'string' ? metadata.hide.split(/[\s,]+/) : [];
    const rendered = this.renderBody(body,entry,context,embedLoading);
    const interactionIndex = this.projectInteractionBacklinks ? compileInteractionIndex(this.store,this.headers.registry,backlinkIndex) : this.interactionIndex;
    const interactions = campaignInteractions(interactionIndex,this.store,entry,context,this.headers.registry).filter(group=>group.known);
    if (interactions.length) {
      const summary=interactionSummary(interactions);
      rendered.html=/<\/h1>/i.test(rendered.html) ? rendered.html.replace(/<\/h1>/i,match=>match+summary) : summary+rendered.html;
      rendered.html+=interactionView(interactions);
    }
    if (hasHeaderIndexSlot) rendered.html = addHeaderIndexes(rendered.html,{store:this.store,entry,context,headers:this.headers,warnings:rendered.warnings});
    if (hide.includes('toc')) rendered.toc = '';
    return {page: entry.slug, title: entry.title, date, dm, campaigns: [...context.campaigns],context,hide,
      ...(metadata.layout === 'wide' ? {layout:'wide'} : {}),
      ...rendered, interactions, backlinks:backlinkIndex && (backlinkIndex.version>=2 || context.campaigns.length<=1)
        ? linkedFrom(backlinkIndex,this.store,entry.slug,context,this.backlinkCampaigns) : undefined};
  }

  renderIndex(page,type,date,contextId,dm,selectedCampaigns,noteLoading) {
    const {entry,context}=this.resolvePage(page,date,contextId,dm,selectedCampaigns);
    return renderHeaderIndex(type,{store:this.store,entry,context,headers:this.headers,warnings:[],noteLoading});
  }

  async renderIndexAsync(page,type,date,contextId,dm,selectedCampaigns,loadNote) {
    return this.loadNotes(loading=>this.renderIndex(page,type,date,contextId,dm,selectedCampaigns,loading),loadNote);
  }

  async renderAsync(page,date,contextId,dm,selectedCampaigns,loadNote) {
    const {entry} = this.resolvePage(page,date,contextId,dm,selectedCampaigns);
    const [note,backlinks] = await Promise.all([loadNote(entry),this.loadBacklinks ? this.loadBacklinks(entry) : this.backlinkIndex]);
    return this.loadNotes(loading=>this.render(page,date,contextId,dm,note,selectedCampaigns,loading,backlinks),loadNote,new Map([[entry.id,note]]));
  }

  // Embeds and Members descriptions discover visible note dependencies during
  // rendering. Keep loaded bodies request-local and share pending shard reads.
  async loadNotes(render,loadNote,notes=new Map()) {
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
    return this.loadNotes(loading=>this.renderHome(context,loading,siteHost),loadNote);
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
    const noteEmbeds = [], env = {store:this.store,entry,date,context,headers:this.headers,warnings,dmNotes,notesMarkdown:this.notesMarkdown,noteEmbeds,noteLoading:embedLoading};
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
  const interactions = result.interactions?.length;
  const indexes = result.html.includes('class="taelgar-index');
  return '<!doctype html><html lang="en" dir="ltr" data-appearance="system"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><script src="/theme/appearance.js"></script>' +
    '<title>' + escapeHtml(result.title) + ' — TaelgarVerse</title><link rel="stylesheet" href="/theme/material.css">' +
    '<link rel="stylesheet" href="/theme/taelgarverse.css"><link rel="stylesheet" href="/theme/preview.css"><link rel="stylesheet" href="/theme/image-viewer.css"><link rel="stylesheet" href="/theme/quiet-library.css">' +
    (maps ? '<link rel="stylesheet" href="/theme/leaflet.css"><link rel="stylesheet" href="/theme/maps.css">' : '') +
    (interactions ? '<link rel="stylesheet" href="/theme/interactions.css">' : '') +
    (indexes ? '<link rel="stylesheet" href="/theme/indexes.css">' : '') +
    (result.search ? '<link rel="stylesheet" href="/theme/search.css">' : '') +
    (result.homepage ? '<link rel="stylesheet" href="/theme/homepage.css">' : '') + '</head>' +
    '<body>' + siteHeader(result.context,contextOptions,{query:result.query,searchType:result.searchType,sections:showNavigation ? navigation.sections(view) : '',navigation:!!showNavigation}) +
    '<a class="skip-link" href="#page-content">Skip to content</a><div class="layout' + (pageNav ? '' : ' layout--no-toc') + (hasSection ? '' : ' layout--no-navigation') + (result.homepage ? ' layout--home' : '') + '">' + sidebar +
    '<main id="page-content" class="md-typeset article-main" tabindex="-1">' + breadcrumbs + article + '</main>' + pageNav +
    '</div>' + siteDialogs() + releaseFooter(releases) + '<script src="/theme/release.js" defer></script><script src="/theme/navigation.js" defer></script><script src="/theme/site-ui.js" defer></script><script type="module" src="/theme/search-overlay.js"></script><script src="/theme/image-viewer.js" defer></script>' + diagrams +
    (maps ? '<script type="module" src="/theme/maps.js"></script>' : '') +
    (interactions ? '<script type="module" src="/theme/interactions.js"></script>' : '') +
    (indexes ? '<script type="module" src="/theme/indexes.js"></script>' : '') + '</body></html>';

}
