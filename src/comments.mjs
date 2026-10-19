import {dateKey, RenderError} from './common.mjs';

// Ported from taelgar-utils' public-export parser. Validate discarded blocks too.
export function codeRanges(text) {
  const ranges = [];
  let active = null, offset = 0;
  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const body = line.replace(/\n$/, '');
    if (!active) {
      const opener = /^( {0,3})(\x60{3,}|~{3,})(.*)$/.exec(body);
      if (opener && !(opener[2][0] === '\x60' && opener[3].includes('\x60'))) {
        active = {char: opener[2][0], length: opener[2].length, start: offset};
      }
    } else {
      const trimmed = body.replace(/^ */, '');
      const run = trimmed.match(new RegExp('^' + active.char + '+'))?.[0].length ?? 0;
      if (body.length - trimmed.length <= 3 && run >= active.length && !trimmed.slice(run).trim()) {
        ranges.push([active.start, offset + line.length]); active = null;
      }
    }
    offset += line.length;
  }
  if (active) ranges.push([active.start, text.length]);
  const inFence = position => ranges.find(([a,b]) => a <= position && position < b);
  const escaped = position => {
    let n = 0;
    for (let i = position - 1; i >= 0 && text[i] === '\\'; i--) n++;
    return n % 2 === 1;
  };
  const inline = [];
  let cursor = 0;
  while (cursor < text.length) {
    const opener = text.indexOf('\x60', cursor);
    if (opener < 0) break;
    const fenced = inFence(opener);
    if (fenced) { cursor = fenced[1]; continue; }
    let end = opener + 1;
    while (text[end] === '\x60') end++;
    if (escaped(opener)) { cursor = end; continue; }
    const lineEnd = text.indexOf('\n', end) < 0 ? text.length : text.indexOf('\n', end);
    let search = end, closer = null;
    while (search < lineEnd) {
      const candidate = text.indexOf('\x60', search);
      if (candidate < 0 || candidate >= lineEnd) break;
      let candidateEnd = candidate + 1;
      while (text[candidateEnd] === '\x60') candidateEnd++;
      if (!escaped(candidate) && candidateEnd - candidate === end - opener) { closer = candidateEnd; break; }
      search = candidateEnd;
    }
    if (closer !== null) { inline.push([opener, closer]); cursor = closer; }
    else cursor = end;
  }
  return [...ranges, ...inline].sort((a,b) => a[0] - b[0]);
}

export function filterComments(text, {campaigns = [], date = null, source = '<text>', lineOffset = 0, dm = false, notes = []} = {}) {
  const ranges = codeRanges(text);
  const selected = new Set(campaigns.map(c => c.trim().toLowerCase()));
  const target = date === null ? null : dateKey(date, true);
  const error = (offset, message) => {
    const line = text.slice(0, offset).split('\n').length + lineOffset;
    const exception = new RenderError(422, source + ':' + line + ': ' + message);
    exception.reason = message;
    throw exception;
  };
  const find = (token, start) => {
    let cursor = start;
    while (true) {
      const position = text.indexOf(token, cursor);
      if (position < 0) return -1;
      const protectedRange = ranges.find(([a,b]) => a <= position && position < b);
      if (!protectedRange) return position;
      cursor = protectedRange[1];
    }
  };
  const markerAt = offset => {
    const match = /^%%\^([^%\r\n]+)%%/.exec(text.slice(offset));
    if (!match) error(offset, 'malformed structured block marker');
    return {name: match[1].trim(), end: offset + match[0].length};
  };
  const kind = marker => marker.split(':', 1)[0].trim().slice(0, 80) || 'unknown';
  const keep = (marker, offset) => {
    if (/^(Lint|Metadata(?::[^%\r\n]+)?|povNotes(?::[^%\r\n]+)?)$/i.test(marker)) return false;
    const campaign = /^Campaign:\s*(.+?)\s*$/i.exec(marker);
    if (campaign) return campaign[1].trim().toLowerCase() === 'none' ? dm : selected.has(campaign[1].trim().toLowerCase());
    const dated = /^Date:\s*([0-9]{1,4}(?:-[0-9]{1,2})?(?:-[0-9]{1,2})?)([A-Za-z]?)\s*$/i.exec(marker);
    if (dated) {
      if (target === null) error(offset, 'date block requires a configured export_date');
      const suffix = dated[2].toLowerCase();
      if (suffix === 'a') error(offset, "unsupported date block suffix 'a'; use 'b' for before-state content");
      if (suffix && suffix !== 'b') error(offset, "unsupported date block suffix '" + suffix + "'");
      let cutoff;
      try { cutoff = dateKey(dated[1], true); }
      catch { error(offset, 'date block contains an invalid date'); }
      return suffix === 'b' ? target < cutoff : target >= cutoff;
    }
    error(offset, "unknown structured block marker '" + kind(marker) + "'");
  };
  const segment = (start, end, visible = true) => {
    let output = '', cursor = start;
    while (cursor < end) {
      const position = find('%%', cursor);
      if (position < 0 || position >= end) { output += text.slice(cursor, end); break; }
      output += text.slice(cursor, position);
      if (text.startsWith('%%^', position)) {
        const marker = markerAt(position);
        if (marker.name.toLowerCase() === 'end') error(position, 'stray structured block terminator');
        const closingPosition = find('%%^', marker.end);
        if (closingPosition < 0 || closingPosition >= end) error(position, "unterminated structured block '" + kind(marker.name) + "'");
        const closing = markerAt(closingPosition);
        if (closing.name.toLowerCase() !== 'end') {
          error(closingPosition, "nested structured block '" + kind(closing.name) + "' inside '" + kind(marker.name) + "'");
        }
        const retained = keep(marker.name, position);
        const body = segment(marker.end, closingPosition, visible && retained);
        if (retained) output += dm && /^Campaign:\s*none\s*$/i.test(marker.name)
          ? '\n\n<div class="dm-only-block" markdown>\n<p class="dm-block-label">Behind the Curtain</p>\n\n' + body + '\n\n</div>\n\n'
          : body;
        cursor = closing.end;
      } else {
        const closing = find('%%', position + 2);
        if (closing < 0 || closing >= end) error(position, 'unterminated Obsidian comment');
        const comment = text.slice(position + 2, closing).trim();
        if (dm && visible && comment) {
          const id = notes.length + 1;
          notes.push({id, text: comment});
          output += '<span class="dm-note-anchor" data-dm-note="' + id + '"></span>';
        }
        cursor = closing + 2;
      }
    }
    return output;
  };
  return segment(0, text.length);
}
