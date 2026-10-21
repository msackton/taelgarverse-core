import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNameEntries, parseLanguageProfiles, nameSynthesisInput, nameAudioPaths} from '../obsidian/taelgarverse/pronunciation-names.mjs';
import {synthesisInput, mockWav} from '../src/pronunciation-data.mjs';
import {synthesizePronunciation} from '../obsidian/taelgarverse/pronunciation-synthesis.mjs';

const settings = {locale: 'en-US', voice: 'en-US-JennyNeural'};
const block = '%%^Metadata:names:v1%%\n- {name: Alain, language: Sembaran, pronunciation: ah-LAN, role: primary, status: documented}\n- {"name":"Le Bouillon", "language":"Isinguese", "pronunciation":"luh-boo-YON", "role":"alias"}\n%%^End%%\n';
const languages = '##### Sembaran\n_Real world analog_: French (south) and English (north)\n##### Isinguese\n_Real world analog_: Spanish or French\n##### Illoria\n_Real world analog_: Not defined. %% Likely Italian %%\n##### Sylvan\n_Real world analog_: None, specifically, but many names use Classic Greek.\n##### Drankorian\n_Real world analog_: Classical Latin; occasional Greek loan words\n';

test('name rows parse YAML and JSON, retain positions, and ignore malformed, incomplete and fenced blocks', () => {
  const entries = parseNameEntries(block); assert.equal(entries.length, 2); assert.equal(entries[0].name, 'Alain');
  assert.equal(entries[1].pronunciation, 'luh-boo-YON'); assert.match(block.slice(entries[0].from, entries[0].to), /^- \{name: Alain/);
  assert.equal(parseNameEntries('```md\n' + block + '```\n').length, 0);
  assert.equal(parseNameEntries(block.replace('%%^End%%', '')).length, 0);
  assert.equal(parseNameEntries(block.replace('name: Alain', 'name: Alain, name: Duplicate')).length, 1);
  assert.equal(parseNameEntries(block.replaceAll('\n', '\r\n')).length, 2);
});

test('language profiles use only documented analogs, preserve alternatives, and keep uncertainty explicit', () => {
  const profiles = parseLanguageProfiles(languages);
  assert.deepEqual(profiles.get('sembaran').options.map(option => option.locale), ['fr-FR', 'en-GB']);
  assert.equal(profiles.get('illorian').options.length, 0, 'a hidden suggestion is not an adopted analog');
  assert.equal(profiles.get('sylvan').automatic, false); assert.equal(profiles.get('sylvan').options[0].locale, 'el-GR');
  assert.equal(profiles.get('drankorian').automatic, false, 'Greek loan words do not replace unsupported Latin');
});

test('metadata text supplies Azure input without frontmatter IPA, with explicit analog choices and fallback', () => {
  const entries = parseNameEntries(block), profiles = parseLanguageProfiles(languages);
  const input = nameSynthesisInput({}, 'Alain', settings, entries, profiles);
  assert.equal(input.name, 'Alain'); assert.equal(input.pronunciation, 'ah-LAN'); assert.equal(input.locale, 'fr-FR'); assert.equal(input.voice, 'auto');
  assert.match(input.ssml, /<sub alias="ah-LAN">Alain<\/sub>/); assert.doesNotMatch(input.ssml, /phoneme/);
  assert.equal(nameSynthesisInput({}, 'Alain', settings, entries, profiles, {key: entries[0].key, locale: 'en-GB'}).locale, 'en-GB');
  assert.equal(nameSynthesisInput({}, 'Alain', settings, entries, profiles, {key: entries[0].key, locale: 'default'}).locale, 'en-US');
  const unknown = nameSynthesisInput({}, 'Alain', settings, entries, new Map()); assert.equal(unknown.voice, settings.voice); assert.match(unknown.route, /no fixed supported analog/);
  const withoutGuide = entries.map(entry => entry === entries[1] ? {...entry, pronunciation: ''} : entry);
  const alias = nameSynthesisInput({pronunciation: 'primary only', pronunciationIPA: 'primary ipa'}, 'Alain', settings, withoutGuide, profiles, {key: entries[1].key});
  assert.equal(alias.pronunciation, ''); assert.equal(alias.ipa, '');
  const override = nameSynthesisInput({pronunciationLocale: 'cy-GB'}, 'Alain', settings, entries, profiles); assert.equal(override.locale, 'cy-GB'); assert.equal(override.voice, 'auto');
});

test('primary audio retains the header path; aliases get separate stable paths and cannot replace it', () => {
  const entries = parseNameEntries(block);
  const primary = nameAudioPaths('People/Alain.md', entries[0], entries[0]); const alias = nameAudioPaths('People/Alain.md', entries[1], entries[0]);
  assert.equal(primary.audio, 'assets/pronunciation/People/Alain.wav'); assert.notEqual(alias.audio, primary.audio);
  assert.equal(nameAudioPaths('People/Alain.md', {...entries[1], pronunciation: 'edited guide'}, entries[0]).audio, alias.audio);
  assert.notEqual(nameAudioPaths('Places/Alain.md', entries[1], entries[0]).audio, alias.audio);
  assert.throws(() => nameSynthesisInput({}, 'Alain', settings, entries, new Map(), {key: 'removed'}), /entry changed/);
});

test('written guides take precedence over optional IPA and are XML-escaped', () => {
  const input = synthesisInput({name: 'A & B', pronunciation: 'a "bee" <see>', pronunciationIPA: 'ignored'}, 'fallback');
  assert.match(input.ssml, /alias="a &quot;bee&quot; &lt;see&gt;"/); assert.doesNotMatch(input.ssml, /phoneme/);
});

test('Azure resolves a real region-supported voice for the documented analog before requesting speech', async () => {
  const input = nameSynthesisInput({}, 'Alain', settings, parseNameEntries(block), parseLanguageProfiles(languages));
  const calls = [];
  const result = await synthesizePronunciation({input, key: 'test-key', region: 'eastus', request: async request => {
    calls.push(request);
    if (request.method === 'GET') return {status: 200, json: [{Locale: 'fr-FR', VoiceType: 'Neural', ShortName: 'fr-FR-Vivienne:DragonHDLatestNeural'}, {Locale: 'en-US', VoiceType: 'Neural', ShortName: 'en-US-JennyNeural'}, {Locale: 'fr-FR', VoiceType: 'Neural', ShortName: 'fr-FR-DeniseNeural'}]};
    assert.match(request.body, /xml:lang="fr-FR"/); assert.match(request.body, /voice name="fr-FR-DeniseNeural"/); assert.match(request.body, /<sub alias="ah-LAN"/);
    return {status: 200, arrayBuffer: mockWav()};
  }});
  assert.equal(result.voice, 'fr-FR-DeniseNeural'); assert.equal(calls.length, 2);
  let posted = false;
  await assert.rejects(synthesizePronunciation({input, key: 'test-key', region: 'eastus', request: async request => { posted ||= request.method === 'POST'; return {status: 200, json: []}; }}), /No Azure neural voice/);
  assert.equal(posted, false);
  await assert.rejects(synthesizePronunciation({input, key: 'test-key', region: 'eastus', request: async () => ({status: 401})}), /lookup failed/);
});


test('row IPA overrides the primary frontmatter guide; pronunciation fields inherit together only when absent on the row', () => {
  const source = '%%^Metadata:names:v1%%\n- {name: Cassia, role: primary, language: Chardonian, pronunciationIPA: ˈksas.sja, status: documented}\n%%^End%%\n';
  const entries = parseNameEntries(source);
  const metadata = {name: 'Cassia', pronunciation: 'KAS-see-ah', pronunciationIPA: 'old-frontmatter-ipa'};
  const profiles = parseLanguageProfiles('##### Chardonian\n_Real world analog_: Italian/Latin\n');
  for (const selector of [{}, {key: entries[0].key}]) {
    const input = nameSynthesisInput(metadata, 'Cassia', settings, entries, profiles, selector);
    assert.equal(input.pronunciation, ''); assert.equal(input.ipa, 'ˈksas.sja'); assert.equal(input.locale, 'it-IT');
    assert.match(input.ssml, /<phoneme alphabet="ipa" ph="ˈksas.sja">Cassia<\/phoneme>/);
    assert.doesNotMatch(input.ssml, /<sub|KAS-see-ah|old-frontmatter/);
  }
  const rowText = nameSynthesisInput(metadata, 'Cassia', settings, [{...entries[0], pronunciation: 'row guide', pronunciationIPA: undefined}], profiles);
  assert.equal(rowText.ipa, ''); assert.equal(rowText.pronunciation, 'row guide');
  const both = nameSynthesisInput(metadata, 'Cassia', settings, [{...entries[0], pronunciation: 'row guide'}], profiles);
  assert.match(both.ssml, /<sub alias="row guide"/); assert.doesNotMatch(both.ssml, /phoneme/);
  const inherited = nameSynthesisInput(metadata, 'Cassia', settings, [{...entries[0], pronunciation: '', pronunciationIPA: ' '}], profiles);
  assert.equal(inherited.pronunciation, metadata.pronunciation); assert.equal(inherited.ipa, metadata.pronunciationIPA);
});


test('male/female voice choices retain the locale, work for fallback languages, and respect pinned voices', () => {
  const entries = parseNameEntries(block), profiles = parseLanguageProfiles(languages);
  const male = nameSynthesisInput({}, 'Alain', {...settings, voiceGender: 'male'}, entries, profiles);
  assert.equal(male.gender, 'male'); assert.equal(male.locale, 'fr-FR'); assert.equal(male.voice, 'auto');
  const female = nameSynthesisInput({}, 'Alain', {...settings, voiceGender: 'male'}, entries, new Map(), {gender: 'female'});
  assert.equal(female.gender, 'female'); assert.equal(female.locale, settings.locale); assert.equal(female.voice, 'auto');
  const pinned = nameSynthesisInput({pronunciationVoice: 'fr-FR-DeniseNeural'}, 'Alain', settings, entries, profiles, {gender: 'male'});
  assert.equal(pinned.voice, 'fr-FR-DeniseNeural'); assert.equal(pinned.gender, 'auto'); assert.equal(pinned.voiceOverride, true);
});

test('name-only mode ignores both row and frontmatter guides/IPA but retains language and selected voice gender', () => {
  const entries = parseNameEntries(block), profiles = parseLanguageProfiles(languages);
  const input = nameSynthesisInput({pronunciation: 'front guide', pronunciationIPA: 'front ipa'}, 'Alain', settings,
    [{...entries[0], pronunciationIPA: 'row ipa'}], profiles, {mode: 'name', gender: 'male'});
  assert.equal(input.mode, 'name'); assert.equal(input.pronunciation, ''); assert.equal(input.ipa, '');
  assert.equal(input.locale, 'fr-FR'); assert.equal(input.gender, 'male'); assert.match(input.ssml, />Alain<\/voice>/);
  assert.doesNotMatch(input.ssml, /phoneme|sub alias|guide|ipa/);
  assert.equal(nameSynthesisInput({}, 'Alain', {...settings, speechMode: 'name'}, entries, profiles).mode, 'name');
  assert.equal(nameSynthesisInput({}, 'Alain', {...settings, speechMode: 'name'}, entries, profiles, {mode: 'pronunciation'}).pronunciation, 'ah-LAN');
});

test('Azure filters actual Gender metadata and fails without posting if the requested voice gender is unavailable', async () => {
  const base = nameSynthesisInput({}, 'Alain', settings, parseNameEntries(block), parseLanguageProfiles(languages));
  const voices = [
    {Locale: 'fr-FR', VoiceType: 'Neural', ShortName: 'fr-FR-DeniseNeural', Gender: 'Female'},
    {Locale: 'fr-FR', VoiceType: 'Neural', ShortName: 'fr-FR-Henri:DragonHDLatestNeural', Gender: 'Male'},
    {Locale: 'en-US', VoiceType: 'Neural', ShortName: 'en-US-GuyNeural', Gender: 'Male'},
    {Locale: 'fr-FR', VoiceType: 'Neural', ShortName: 'fr-FR-HenriNeural', Gender: 'Male'}
  ];
  for (const [gender, expected] of [['male', 'fr-FR-HenriNeural'], ['female', 'fr-FR-DeniseNeural']]) {
    const result = await synthesizePronunciation({input: {...base, gender}, key: 'test', region: 'eastus', request: async request => {
      if (request.method === 'GET') return {status: 200, json: voices};
      assert.ok(request.body.includes(expected)); return {status: 200, arrayBuffer: mockWav()};
    }});
    assert.equal(result.voice, expected);
  }
  let posted = false;
  await assert.rejects(synthesizePronunciation({input: {...base, gender: 'male'}, key: 'test', region: 'eastus', request: async request => {
    posted ||= request.method === 'POST'; return {status: 200, json: voices.slice(0, 1)};
  }}), /No Azure male neural voice/);
  assert.equal(posted, false);
});
