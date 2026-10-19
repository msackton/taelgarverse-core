// From repository root: node docs/design/ui-review/build.mjs
import fs from 'node:fs';
import {Engine} from '../../../src/engine.mjs';
import {document as siteDocument} from '../../../src/render-engine.mjs';
import {loadSettings} from '../../../src/config.mjs';
import * as cheerio from 'cheerio';
import sharp from 'sharp';
const engine = new Engine(loadSettings());
const names = ['Chardon', 'Addermarch', 'Voltara', 'Melusa', 'Green Sea', 'Session 110 (DuFr)', 'Session 120 (DuFr)'];
const images = new Map(), pages = [];
const currentAssets = {
  css: ['vendor/material.css', 'taelgarverse.css', 'preview.css'].map(file => fs.readFileSync(new URL('../../../public/' + file, import.meta.url), 'utf8')).join('\n'),
  navigation: fs.readFileSync(new URL('../../../public/navigation.js', import.meta.url), 'utf8'),
};
for (const name of names) {
  const result = engine.render(name, undefined, name.startsWith('Session') ? 'dunmar-frontier' : 'modern');
  const $ = cheerio.load(result.html, null, false);
  $('script').remove();
  for (const image of $('img').toArray()) {
    const img = $(image), src = img.attr('src');
    if (!images.has(src)) {
      const asset = engine.store.assets.get(src.slice('/assets/'.length));
      if (!asset) throw new Error(`Missing image: ${src}`);
      const buffer = await sharp(asset.filename).resize({width:1400,height:1400,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer();
      images.set(src, 'data:image/webp;base64,' + buffer.toString('base64'));
    }
    img.attr('src', images.get(src));
    if (name === 'Voltara') img.addClass('map-image');
  }
  const view = engine.navigation.view(result.context, result.page);
  // Preserve the real document structure and styling in a separate frame.
  const current = cheerio.load(siteDocument(result, engine.contexts.list(), engine.navigation));
  current('script, link[rel="stylesheet"]').remove();
  current('img').each((_, image) => {
    const img = current(image);
    const embedded = images.get(img.attr('src'));
    if (!embedded) throw new Error('Missing baseline image: ' + img.attr('src'));
    img.attr('src', embedded);
  });
  // Keep the real navigation script, but retain bundled branch snapshots offline.
  current('[data-nav-children]').attr('data-loaded', 'true');
  pages.push({name, slug:result.page, title:$('h1').first().text(), context:result.context,
    html:$.html(), toc:result.toc, navigation:engine.navigation.sidebar(view),
    breadcrumbs:engine.navigation.breadcrumbs(view), currentDocument:current.html()});
}
const template = fs.readFileSync(new URL('./template.html', import.meta.url), 'utf8');
const html = template.replace('__PAGE_DATA__', JSON.stringify(pages).replace(/</g, '\\u003c'))
  .replace('__CURRENT_ASSETS__', JSON.stringify(currentAssets).replace(/</g, '\\u003c'));
fs.writeFileSync(new URL('./TaelgarVerse-UI-Review.html', import.meta.url), html);
console.log(JSON.stringify({bytes:Buffer.byteLength(html),images:images.size,pages:pages.map(p=>p.name)}));
