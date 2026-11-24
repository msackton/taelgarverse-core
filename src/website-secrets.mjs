import fs from 'node:fs';
import {omitFromPublication,parseNote} from './content-store.mjs';

const opener = '%%SECRET';
const placeholder = /^%%SECRET\[(?:v2:[0-9a-f]{32}|[0-9]+)\]%%/;
const yamlMarker = /(?:^|[ \t])##secret(?=[ \t]|$)/;
const lineEnding = /\r\n|\r|\n/;
const sequenceItem = /^[ \t]*-(?:[ \t]|$)/;
const blank = value => value.replace(/[^\r\n]/g,'');

// Match the vault Git filter's spoiler markers without using its sidecar store.
export function stripWebsiteSecrets(source,filename) {
  const error = (message,line) => new Error(filename+': '+message+' at line '+line);
  let result = '';
  let cursor = 0;
  for (let start = source.indexOf(opener); start !== -1; start = source.indexOf(opener,cursor)) {
    const token = placeholder.exec(source.slice(start));
    const closing = token ? start+token[0].length-2 : source.indexOf('%%',start+opener.length);
    if (closing === -1 || (!token && source.startsWith(opener,closing))) {
      throw error('unclosed SECRET block',source.slice(0,start).split(lineEnding).length);
    }
    result += source.slice(cursor,start)+blank(source.slice(start,closing+2));
    cursor = closing+2;
  }
  result += source.slice(cursor);
  if (!result.includes('##secret')) return result;

  const lines=result.split(/(\r\n|\r|\n)/);
  if (!/^\uFEFF?---[ \t]*$/.test(lines[0])) return result;
  const end=lines.findIndex((line,index)=>index>0 && index%2===0 && /^(?:---|\.\.\.)[ \t]*$/.test(line));
  for (let index = 2; index < lines.length && index !== end; index += 2) {
    const line = lines[index];
    if (!yamlMarker.test(line)) continue;
    if (end === -1) throw error('unclosed frontmatter containing a secret',index/2+1);
    // The Git convention marks one YAML line. Reject a continuation rather
    // than risk publishing a block scalar or nested value after its key is gone.
    const indent = line.match(/^[ \t]*/)[0].length;
    for (let next = index+2; next < end; next += 2) {
      const following = lines[next];
      if (/^[ \t]*(?:#.*)?$/.test(following)) continue;
      const nextIndent = following.match(/^[ \t]*/)[0].length;
      const indentlessSequence = nextIndent === indent && sequenceItem.test(following) && !sequenceItem.test(line);
      if (nextIndent > indent || indentlessSequence) {
        throw error('secret frontmatter must be on one line',index/2+1);
      }
      break;
    }
    lines[index] = '';
  }
  return lines.join('');
}

export function readWebsiteMarkdown(filename) {
  return stripWebsiteSecrets(fs.readFileSync(filename,'utf8'),filename);
}

export function inspectWebsiteNote(source,filename) {
  const parse = text => {
    try { return parseNote(text.replace(/^\uFEFF/,'')); }
    catch { return undefined; } // Store reports invalid YAML for ordinary notes.
  };
  const original = parse(source);
  // A marked noPublish or stub value still excludes its note.
  if (original && omitFromPublication(original.metadata)) return {omitted:true};
  const filtered = stripWebsiteSecrets(source,filename);
  const note = filtered === source ? original : parse(filtered);
  if (note && omitFromPublication(note.metadata)) return {omitted:true};
  return {source:filtered,note};
}
