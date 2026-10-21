import fs from 'node:fs/promises';
import path from 'node:path';
import {ROOT, loadSettings} from '../src/config.mjs';
import {pronunciationPaths, linkPronunciation, mockWav} from '../src/pronunciation-data.mjs';
import './build-pronunciation.mjs';

const demo = path.join(ROOT, '.cache/pronunciation-demo-vault');
// Explicitly refuse to overwrite a used demo vault, preserving any user experiments.
try { await fs.access(demo); throw new Error('Demo vault already exists; open it to preserve your experiments.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await fs.mkdir(path.join(demo, 'People'), {recursive: true});
const plugin = path.join(demo, '.obsidian/plugins/taelgar-pronunciation');
await fs.mkdir(plugin, {recursive: true});
for (const file of ['main.js', 'manifest.json', 'styles.css']) await fs.copyFile(path.join(ROOT, '.cache/pronunciation-plugin/taelgar-pronunciation', file), path.join(plugin, file));
await fs.writeFile(path.join(demo, '.obsidian/community-plugins.json'), JSON.stringify(['taelgar-pronunciation']));
await fs.writeFile(path.join(demo, '.obsidian/app.json'), JSON.stringify({showInlineTitle: false}));
const sample = (name, guide, ipa) => ['---', 'name: ' + name, 'pronunciation: ' + guide, 'pronunciationIPA: "' + ipa + '"', '---', '# ' + name, '*(' + guide + ')*', '', 'Disposable pronunciation demo. IPA here is illustrative test data, not a change to the real vault.', '', 'Use **Generate pronunciation** in Reading view, the note toolbar, ribbon, or command palette. With no key this saves a test tone. **Browser speech preview** speaks the spelling approximately without saving.', ''].join('\n');
await fs.writeFile(path.join(demo, 'People/Zahara.md'), sample('Zahara', 'zah-HAH-rah', 'zɑˈhɑːrɑ'));
const saved = 'People/Taquin.md', audio = pronunciationPaths(saved).mock;
await fs.mkdir(path.dirname(path.join(demo, audio)), {recursive: true});
await fs.writeFile(path.join(demo, audio), new Uint8Array(mockWav()));
await fs.writeFile(path.join(demo, saved), linkPronunciation(sample('Taquin', 'tah-KEEN', 'tɑˈkiːn'), audio));
const config = path.join(ROOT, '.cache/pronunciation-demo.config.json');
await fs.writeFile(config, JSON.stringify({vault_dir: loadSettings().vault_dir, source_dir: demo, nav_source: null, home_source: null}, null, 2));
console.log('Open this folder as an Obsidian vault: ' + demo);
console.log('Website preview: set TAELGARVERSE_CONFIG to ' + config + ', then npm start');
