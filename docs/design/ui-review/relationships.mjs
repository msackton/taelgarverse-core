// Offline review data only: use the existing dated whereabouts and renderer.
import vm from 'node:vm';
import * as cheerio from 'cheerio';
import sharp from 'sharp';
import {availableInContext} from '../../../src/content-store.mjs';
import {document as siteDocument} from '../../../src/render-engine.mjs';
import {pageUrl} from '../../../src/common.mjs';

export async function captureRelationships(engine, pages) {
  const relatedPages = new Map(), images = new Map();
  const customJS = {state:{coreMeta:structuredClone(engine.headers.coreMeta)}};
  const runtime = vm.createContext({customJS, app:engine.headers.app, window:{app:engine.headers.app}, console:{log(){},warn(){}}});
  vm.runInContext('Array.prototype.last=function(){return this[this.length-1]};Array.prototype.first=function(){return this[0]};String.prototype.contains=String.prototype.includes;', runtime);
  for (const [name, script] of engine.headers.scripts) customJS[name] = new (script.runInContext(runtime))();
  customJS.state.campaignRegistry = customJS.init.normalizeCampaignRegistry(engine.headers.registry);
  customJS.state.coreMeta.campaigns = customJS.state.campaignRegistry;
  const entries = engine.store.entries.filter(entry => entry.note);
  runtime.serialized = JSON.stringify(entries.map(entry => entry.note.metadata));
  const metadata = vm.runInContext('JSON.parse(serialized)', runtime);

  async function embed(src, size = 800) {
    if (!src?.startsWith('/assets/')) return null;
    const key = src + ':' + size;
    if (!images.has(key)) {
      const asset = engine.store.assets.get(decodeURIComponent(src.slice('/assets/'.length)));
      if (!asset) throw new Error('Missing relationship image: ' + src);
      const buffer = await sharp(asset.filename).resize({width:size,height:size,fit:'inside',withoutEnlargement:true}).webp({quality:80}).toBuffer();
      images.set(key, 'data:image/webp;base64,' + buffer.toString('base64'));
    }
    return images.get(key);
  }

  for (const page of pages) {
    delete page.relationships;
    const place = engine.store.resolve(page.slug);
    if (customJS.NameManager.getPageType(place.note.metadata) !== 'place') continue;
    const kind = place.note.metadata.typeOf === 'settlement' ? 'residents' : 'settlements';
    const cards = [];
    customJS.state.overrideDate = page.context.date;
    for (const [index, entry] of entries.entries()) {
      const meta = metadata[index], type = customJS.NameManager.getPageType(meta);
      if (entry.slug === page.slug || !availableInContext(entry, page.context)) continue;
      if (kind === 'residents') {
        if (type !== 'person' || /^People\/PCs\//i.test(entry.id) || (meta.tags || []).includes('person/pc')) continue;
      } else if (type !== 'place' || meta.typeOf !== 'settlement') continue;
      if (!customJS.util.homeLocation(place.name, meta, false, page.context.date)) continue;

      const key = entry.slug + ':' + page.context.id + ':' + page.context.date;
      if (!relatedPages.has(key)) {
        // Date and DM filtering are applied by the normal renderer before any
        // descriptions or full notes enter the downloadable review.
        const result = engine.render(entry.slug, page.context.date, page.context.id, false);
        const $ = cheerio.load(result.html, null, false);
        $('script').remove();
        const image = await embed($('img').first().attr('src'), 220);
        const text = $('p').toArray().map(node => $(node)).find(node =>
          !node.parents('.grid, .admonition, blockquote').length && !node.find('img').length && node.text().trim().length > 45)?.text().trim().replace(/\s+/g, ' ') || '';
        const description = text.length > 180 ? text.slice(0,177).replace(/\s+\S*$/, '') + '…' : text;
        const embedded = new Map();
        for (const node of $('img').toArray()) {
          const img = $(node), src = img.attr('src'), data = await embed(src);
          if (data) { embedded.set(src,data); img.attr('src',data); }
          else img.remove();
        }
        const view = engine.navigation.view(result.context,result.page);
        const current = cheerio.load(siteDocument(result,engine.contexts.list(),engine.navigation));
        current('script, link[rel="stylesheet"]').remove();
        current('img').each((_, node) => {
          const img = current(node), data = embedded.get(img.attr('src'));
          if (data) img.attr('src',data); else img.remove();
        });
        current('[data-nav-children]').attr('data-loaded','true');
        relatedPages.set(key, {
          name:entry.name, slug:entry.slug, title:$('h1').first().text() || entry.title,
          context:result.context, html:$.html(), toc:result.toc,
          navigation:engine.navigation.sidebar(view), breadcrumbs:engine.navigation.breadcrumbs(view), currentDocument:current.html(),
          relatedFrom:{title:page.title, href:pageUrl(page.slug,page.context.date,page.context)},
          card:{image,description}
        });
      }
      const related = relatedPages.get(key);
      cards.push({name:related.title,href:pageUrl(entry.slug,page.context.date,page.context),...related.card});
    }
    cards.sort((a,b) => a.name.localeCompare(b.name));
    page.relationships = {[kind]:cards};
  }
  return [...relatedPages.values()].map(({card,...page}) => page);
}
