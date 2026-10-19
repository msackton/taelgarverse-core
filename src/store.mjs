import fs from 'node:fs';
import path from 'node:path';
import ignore from 'ignore';
import {isInside,targetPath,titleCase} from './config.mjs';
import {ContentStore,parseNote,excluded,ASSET_TYPES} from './content-store.mjs';
export * from './content-store.mjs';

export class Store extends ContentStore {
  constructor(settings) {
    const entries = [], warnings = [];
    const matcher = ignore({ignorecase: false}).add(fs.readFileSync(settings.ignore_file, 'utf8'));
    const walk = directory => {
      for (const file of fs.readdirSync(directory, {withFileTypes: true}).sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
        if (file.name.startsWith('.') || file.name.startsWith('_') || file.name === 'AGENTS.md') continue;
        const filename = path.join(directory, file.name);
        if (file.isSymbolicLink() || !isInside(settings.source_dir, fs.realpathSync(filename))) continue;
        if (file.isDirectory()) { if (file.name !== 'Worldbuilding') walk(filename); continue; }
        const relative = path.relative(settings.source_dir, filename).split(path.sep).join('/');
        const extension = path.extname(file.name).toLowerCase();
        if (matcher.ignores(relative) || (extension !== '.md' && !ASSET_TYPES.has(extension))) continue;
        const entry = {id: relative, filename, target: targetPath(relative), extension, note: null};
        if (extension === '.md') {
          try {
            entry.note = parseNote(new TextDecoder('utf-8', {fatal: true}).decode(fs.readFileSync(filename)));
          } catch (error) {
            warnings.push(relative + ': invalid YAML or UTF-8');
            continue;
          }
          if (excluded(entry.note.metadata, settings)) continue;
          entry.name = path.basename(file.name, '.md');
          entry.title = [entry.note.metadata.title ? titleCase(entry.note.metadata.title) : '',
            titleCase(entry.note.metadata.name || entry.name.replace(/-/g, ' '))].filter(Boolean).join(' ');
          entry.slug = entry.target.slice(0, -3);
        }
        entries.push(entry);
      }
    };
    walk(settings.source_dir);
    super(entries,warnings);
    this.settings = settings;
  }
}
