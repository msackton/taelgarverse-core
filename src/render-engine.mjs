import {RenderError, escapeHtml, parseDM, parsePOV, pageUrl} from './common.mjs';
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
import {leadingBioBlock,leadingHeaderMarker} from './bio-block.mjs';
import {HeaderDataError} from './header-core/errors.mjs';
import {compileInteractionIndex,campaignInteractions} from './campaign-interactions.mjs';
import {interactionSummary,interactionView} from './interaction-view.mjs';

export class RenderEngine {
  constructor({settings,store,headers,renderHeader,renderBio,navigationSource,homeSource = null,campaignHomes = {},backlinkIndex,prepared,interactionIndex,interactionBundles,loadTranscript}) {
    this.settings = settings;
    this.store = store;
    this.store.settings = settings;
    this.headers = headers;
    this.renderHeader = renderHeader;
    this.renderBio = renderBio;
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
    this.loadTranscript = loadTranscript;
    if (!interactionIndex) this.store.warnings.push(...this.interactionIndex.warnings);
  }

  resolvePage(page, date, contextId, dm = false, selectedCampaigns, pov) {
    dm = parseDM(dm);
    pov = parsePOV(pov);
    const context = {...this.contexts.resolve(contextId,date,selectedCampaigns), dm,...(pov === undefined ? {} : {pov})};
    const entry = this.store.resolve(page);
    if (!availableInContext(entry,context,this.settings)) throw new RenderError(404,'Page is not available in this context');
    return {entry,context};
  }

  render(page, date, contextId, dm = false, loadedNote, selectedCampaigns, embedLoading, pov, backlinkIndex = this.backlinkIndex) {
    const {entry,context} = this.resolvePage(page,date,contextId,dm,selectedCampaigns,pov);
    date = context.date;
    dm = context.dm;
    const metadata = entry.note.metadata;
    const note = loadedNote || entry.note;
    let body = note.body;
    const bio = Object.hasOwn(note,'bio') ? note.bio : leadingBioBlock(body);
    if (bio?.error) throw new RenderError(422, bio.error);
    // Prepared Markdown places this marker at the start of the body. A leading
    // marker is explicit; examples inside code or prose are left alone.
    const headerMarker = Object.hasOwn(note,'headerMarkerEnd') ? note.headerMarkerEnd ? [body.slice(0,note.headerMarkerEnd)] : null : leadingHeaderMarker(body);
    if (bio || headerMarker || (metadata.headerVersion && metadata.tags)) {
      try {
        let generated;
        if(bio && this.renderBio)generated=this.renderBio(this.headers,{name:entry.name,metadata,date,headerType:'website'});
        else {
          const source = bio || headerMarker ? '---\n---\n' : note.source;
          const header = parseNote(this.renderHeader(this.headers, {source, name: entry.name, metadata, date})).body;
          generated = header;
        }
        body = bio || headerMarker ? generated.trimEnd() + '\n\n' + body.slice(bio?.end ?? headerMarker[0].length).replace(/^(?:[ \t]*\r?\n)*/, '') : generated;
      } catch (error) {
        if(error instanceof HeaderDataError)throw new RenderError(422,`Header generation failed: circular ${error.kind} chain.`);
        const wrapped = new RenderError(422, 'Header generation failed; check the note metadata and display rules');
        wrapped.cause = error;
        throw wrapped;
      }
    }
    const hide = Array.isArray(metadata.hide) ? metadata.hide : typeof metadata.hide === 'string' ? metadata.hide.split(/[\s,]+/) : [];
    const rendered = this.renderBody(body,entry,context,embedLoading);
    const interactions = campaignInteractions(this.interactionIndex,this.store,entry,context,this.headers.registry).filter(group=>group.known);
    if (interactions.length) {
      const summary=interactionSummary(interactions);
      rendered.html=/<\/h1>/i.test(rendered.html) ? rendered.html.replace(/<\/h1>/i,match=>match+summary) : summary+rendered.html;
      rendered.html+=interactionView(interactions);
    }
    if (hide.includes('toc')) rendered.toc = '';
    return {page: entry.slug, title: entry.title, date, dm, campaigns: [...context.campaigns],context,hide,
      ...(metadata.layout === 'wide' ? {layout:'wide'} : {}),
      ...rendered, interactions, backlinks:backlinkIndex && (backlinkIndex.version>=2 || context.campaigns.length<=1)
        ? linkedFrom(backlinkIndex,this.store,entry.slug,context,this.backlinkCampaigns) : undefined};
  }

  async renderAsync(page,date,contextId,dm,selectedCampaigns,loadNote,pov) {
    const {entry} = this.resolvePage(page,date,contextId,dm,selectedCampaigns,pov);
    const [note,backlinks] = await Promise.all([loadNote(entry),this.loadBacklinks ? this.loadBacklinks(entry) : this.backlinkIndex]);
    return this.loadEmbeds(loading=>this.render(page,date,contextId,dm,note,selectedCampaigns,loading,pov,backlinks),loadNote,new Map([[entry.id,note]]));
  }

  async renderTranscript(id,date,contextId,dm=false,selectedCampaigns,pov,fromPerson) {
    const context={...this.contexts.resolve(contextId,date,selectedCampaigns),dm:parseDM(dm),...(pov===undefined ? {} : {pov:parsePOV(pov)})};
    const transcripts=this.interactionIndex.transcripts || {};
    if (!Object.hasOwn(transcripts,id)) throw new RenderError(404,'Transcript is not available in this context');
    let entry,event;
    for (const [target,records] of Object.entries(this.interactionIndex.byTarget)) {
      if (fromPerson && target!==fromPerson) continue;
      if (!records.some(record=>record.id===id)) continue;
      const person=this.store.bySlug.get(target);
      const visible=campaignInteractions(this.interactionIndex,this.store,person,context,this.headers.registry).flatMap(group=>group.events).find(record=>record.id===id);
      if (visible?.transcriptUrl) {entry=person;event=visible;break;}
    }
    if (!event) throw new RenderError(404,'Transcript is not available in this context');
    // Check context before loading a transcript shard. Ordinary person requests
    // never load transcript text, and the revision index contains no bodies.
    const body=this.loadTranscript ? await this.loadTranscript(id) : transcripts[id];
    if (typeof body!=='string') throw new RenderError(503,'Transcript content is incomplete');
    const rendered=this.renderBody(body,entry,context);
    const period=event.start ? event.start+(event.end!==event.start ? '–'+event.end : '')+' DR' : 'Date unrecorded';
    const links='<a href="'+escapeHtml(pageUrl(entry.slug,context.date,context))+'#campaign-interactions">Back to '+escapeHtml(entry.title)+'</a>'+
      (event.sessionUrl ? ' · <a href="'+escapeHtml(event.sessionUrl)+'">Session note</a>' : '');
    return {...rendered,title:event.title+' — Transcript',context,date:context.date,dm:context.dm,campaigns:[...context.campaigns],
      html:'<h1>'+escapeHtml(event.title)+' — Transcript</h1><p>'+escapeHtml(period+' · '+event.sessionLabel+' · '+event.sourceTitle)+'</p><p>'+links+'</p>'+rendered.html};
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
  const interactions = result.interactions?.length;
  return '<!doctype html><html lang="en" dir="ltr" data-appearance="system"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><script src="/theme/appearance.js"></script>' +
    '<title>' + escapeHtml(result.title) + ' — TaelgarVerse</title><link rel="stylesheet" href="/theme/material.css">' +
    '<link rel="stylesheet" href="/theme/taelgarverse.css"><link rel="stylesheet" href="/theme/preview.css"><link rel="stylesheet" href="/theme/image-viewer.css"><link rel="stylesheet" href="/theme/quiet-library.css">' +
    (maps ? '<link rel="stylesheet" href="/theme/leaflet.css"><link rel="stylesheet" href="/theme/maps.css">' : '') +
    (interactions ? '<link rel="stylesheet" href="/theme/interactions.css">' : '') +
    (result.search ? '<link rel="stylesheet" href="/theme/search.css">' : '') +
    (result.homepage ? '<link rel="stylesheet" href="/theme/homepage.css">' : '') + '</head>' +
    '<body>' + siteHeader(result.context,contextOptions,{query:result.query,searchType:result.searchType,sections:showNavigation ? navigation.sections(view) : '',navigation:!!showNavigation}) +
    '<a class="skip-link" href="#page-content">Skip to content</a><div class="layout' + (pageNav ? '' : ' layout--no-toc') + (hasSection ? '' : ' layout--no-navigation') + (result.homepage ? ' layout--home' : '') + '">' + sidebar +
    '<main id="page-content" class="md-typeset article-main" tabindex="-1">' + breadcrumbs + article + '</main>' + pageNav +
    '</div>' + siteDialogs() + releaseFooter(releases) + '<script src="/theme/release.js" defer></script><script src="/theme/navigation.js" defer></script><script src="/theme/site-ui.js" defer></script><script type="module" src="/theme/search-overlay.js"></script><script src="/theme/image-viewer.js" defer></script>' + diagrams +
    (maps ? '<script type="module" src="/theme/maps.js"></script>' : '') +
    (interactions ? '<script type="module" src="/theme/interactions.js"></script>' : '') + '</body></html>';
}
