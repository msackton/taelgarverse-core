import {parseDocument} from 'yaml';
import {pronunciationPaths, synthesisInput} from '../../src/pronunciation-data.mjs';
const normalize = value => String(value || '').trim().toLocaleLowerCase('en').replaceAll('’', "'");
export const nameKey = entry => [entry.name, entry.language, entry.role].map(normalize).join('|');

// Only complete marker blocks outside Markdown fences supply generation inputs.
export function parseNameEntries(source) {
  const lines = String(source).match(/[^\n]*(?:\n|$)/g) || [];
  let offset = 0, fence = null, block = null; const entries = [];
  for (const raw of lines) {
    const text = raw.replace(/\r?\n$/, ''), trimmed = text.trim();
    const delimiter = /^ {0,3}(`{3,}|~{3,})/.exec(text);
    if (delimiter) {
      const ch = delimiter[1][0];
      if (!fence) fence = {ch, size: delimiter[1].length};
      else if (fence.ch === ch && delimiter[1].length >= fence.size) fence = null;
    } else if (!fence) {
      if (trimmed === '%%^Metadata:names:v1%%') block = [];
      else if (trimmed === '%%^End%%' && block) { entries.push(...block); block = null; }
      else if (/^%%\^/.test(trimmed)) block = null;
      else if (block && /^-\s*\{.*\}\s*$/.test(trimmed)) {
        try {
          const doc = parseDocument(trimmed, {schema: 'core', uniqueKeys: true});
          if (!doc.errors.length) {
            const [entry] = doc.toJS({maxAliasCount: 0});
            if (entry && typeof entry.name === 'string' && entry.name.trim()) {
              block.push({...entry, name: entry.name.trim(), language: typeof entry.language === 'string' ? entry.language.trim() : 'unknown',
                pronunciation: typeof entry.pronunciation === 'string' ? entry.pronunciation.trim() : '',
                from: offset, to: offset + text.length, key: nameKey(entry)});
            }
          }
        } catch { /* A malformed editing-in-progress row gets no control. */ }
      }
    }
    offset += raw.length;
  }
  return entries;
}
const localeWords = [
  ['French', 'fr-FR'], ['English', 'en-GB'], ['Spanish', 'es-ES'], ['Portuguese', 'pt-PT'], ['Italian', 'it-IT'],
  ['Welsh', 'cy-GB'], ['Maltese', 'mt-MT'], ['Arabic', 'ar-SA'], ['Hebrew', 'he-IL'], ['Finnish', 'fi-FI'],
  ['Norwegian', 'nb-NO'], ['Swedish', 'sv-SE'], ['Russian', 'ru-RU'], ['Lithuanian', 'lt-LT'], ['Latvian', 'lv-LV'],
  ['Hindi', 'hi-IN'], ['Persian', 'fa-IR'], ['Basque', 'eu-ES'], ['Turkish', 'tr-TR'], ['Hungarian', 'hu-HU'],
  ['Greek', 'el-GR'], ['Japanese', 'ja-JP']
];
const aliases = {'illoria': 'illorian', 'urksan': 'urskan'};
export function parseLanguageProfiles(source) {
  const profiles = new Map(); let language = null;
  const clean = String(source).replace(/%%[\s\S]*?%%/g, '');
  let fence = null;
  for (const line of clean.split(/\r?\n/)) {
    const delimiter = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (delimiter) { if (!fence) fence = delimiter[1][0]; else if (fence === delimiter[1][0]) fence = null; continue; }
    if (fence) continue;
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) { language = heading[1].length >= 4 ? heading[2].trim() : null; continue; }
    const analog = /^Real world (?:analog|mapping)\s*:\s*(.+)$/i.exec(line.trim().replace(/[_*]/g, ''));
    if (!language || !analog) continue;
    const description = analog[1];
    const options = localeWords.map(([label, locale]) => ({label, locale, index: description.search(new RegExp('\\b' + label + '\\b', 'i'))}))
      .filter(option => option.index >= 0).sort((a, b) => a.index - b.index).map(({label, locale}) => ({label, locale}));
    const uncertain = /^(?:not defined|not determined|none|nothing|undetermined|diverse|classical latin|tolkien|old norse|indo-european|semitic|balto-slavic)/i.test(description);
    const profile = {language, description, options, automatic: !uncertain && options.length > 0};
    const key = normalize(language); profiles.set(key, profile);
    if (aliases[key]) profiles.set(aliases[key], profile);
  }
  return profiles;
}
export function primaryNameEntry(entries, metadata, fallback) {
  return entries.find(entry => /^primary/i.test(entry.role || '')) ||
    entries.find(entry => normalize(entry.name) === normalize(metadata.name || fallback) && !/component/i.test(entry.role || '')) ||
    entries.find(entry => !/component/i.test(entry.role || ''));
}
const entryHash = text => {
  let hash = 2166136261;
  for (const ch of text) { hash ^= ch.codePointAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
};
export function nameAudioPaths(notePath, entry, primary) {
  if (!entry || entry.key === primary?.key) return pronunciationPaths(notePath);
  return pronunciationPaths(notePath.slice(0, -3) + '.name-' + entryHash(entry.key) + '.md');
}
export function nameSynthesisInput(metadata, fallback, settings, entries, profiles, selector = {}) {
  const primary = primaryNameEntry(entries, metadata, fallback);
  const entry = selector.key ? entries.find(candidate => candidate.key === selector.key) : primary;
  if (selector.key && !entry) throw new Error('This name entry changed; use its current Generate audio button');
  const profile = profiles.get(normalize(entry?.language));
  const automatic = profile?.automatic ? profile.options[0] : null;
  const choice = selector.locale === 'default' ? null : selector.locale ? profile?.options.find(option => option.locale === selector.locale) : automatic;
  const overridden = Boolean(entry?.pronunciationLocale || metadata.pronunciationLocale || entry?.pronunciationVoice || metadata.pronunciationVoice);
  const locale = entry?.pronunciationLocale || metadata.pronunciationLocale || choice?.locale || settings.locale;
  const voiceOverride = entry?.pronunciationVoice || metadata.pronunciationVoice;
  const requestedGender = normalize(selector.gender ?? settings.voiceGender ?? 'auto');
  if (!['auto', 'female', 'male'].includes(requestedGender)) throw new Error('Choose Default, Female, or Male for the speech voice');
  const gender = voiceOverride ? 'auto' : requestedGender;
  const voice = voiceOverride || (gender !== 'auto' || (locale && locale !== settings.locale) || choice ? 'auto' : settings.voice);
  const isPrimary = !entry || entry.key === primary?.key;
  // A row's guide and IPA form one override: do not combine its IPA with an
  // inherited written guide, which would silently win during SSML generation.
  const hasRowPronunciation = [entry?.pronunciation, entry?.pronunciationIPA].some(value => typeof value === 'string' && value.trim());
  const inheritPronunciation = isPrimary && !hasRowPronunciation;
  const merged = {...metadata, ...(entry ? {name: entry.name,
    pronunciation: inheritPronunciation ? metadata.pronunciation : entry.pronunciation,
    pronunciationIPA: inheritPronunciation ? metadata.pronunciationIPA : entry.pronunciationIPA
  } : {}), pronunciationLocale: locale, pronunciationVoice: voice};
  const mode = selector.mode ?? settings.speechMode ?? 'pronunciation';
  if (!['pronunciation', 'name'].includes(mode)) throw new Error('Choose Name only or Pronunciation / IPA');
  if (mode === 'name') { merged.pronunciation = ''; merged.pronunciationIPA = ''; }
  const input = synthesisInput(merged, fallback, settings);
  return {...input, mode, gender, voiceOverride: Boolean(voiceOverride), language: entry?.language || 'unknown', analog: profile?.description || '',
    entryKey: entry?.key || '', primary: !entry || entry.key === primary?.key, status: entry?.status || '',
    route: overridden ? 'Voice override' : choice ? entry.language + ' → ' + choice.label : (entry?.language || 'Unknown') + ' → default voice (no fixed supported analog)'};
}
