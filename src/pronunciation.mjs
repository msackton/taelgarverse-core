import {load} from 'cheerio';
import {targetPath, escapeHtml} from './common.mjs';
import {pronunciationPaths} from './pronunciation-data.mjs';

export function decoratePronunciation(rendered, entry, store) {
  let paths;
  try { paths = pronunciationPaths(entry.id); } catch { return rendered; }
  const asset = paths.candidates.map(candidate => store.assets.get(targetPath(candidate))).find(candidate => candidate && !candidate.note);
  if (!asset) return rendered;
  const $ = load(rendered.html, {}, false), heading = $.root().children('h1').first();
  if (!heading.length) return rendered;
  const mock = asset.id.endsWith('.mock.wav');
  const src = '/assets/' + asset.target.split('/').map(encodeURIComponent).join('/');
  const ipa = typeof entry.note.metadata.pronunciationIPA === 'string' ? entry.note.metadata.pronunciationIPA : '';
  heading.after('<div class="pronunciation-control"><button type="button" data-pronunciation-play hidden>' + (mock ? 'Play test tone' : 'Hear pronunciation') + '</button>' +
    '<audio controls preload="none" aria-label="' + (mock ? 'Prototype test tone' : 'Name pronunciation') + '" src="' + escapeHtml(src) + '"></audio>' +
    (mock ? '<span>Prototype test tone — not speech</span>' : '') + (ipa ? '<span class="pronunciation-ipa">' + escapeHtml(ipa) + '</span>' : '') + '<span data-pronunciation-status role="status"></span></div>');
  return {...rendered, html: $.html()};
}
