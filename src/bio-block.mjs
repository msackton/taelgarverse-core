export const HEADER_BLOCK = '```taelgar-header\n```\n';

const blanks = '(?:[\\t ]*\\r?\\n)*';
const marker = ' {0,3}<!-- taelgar(?::|-)header -->[\\t ]*(?:\\r?\\n|$)';

export function leadingHeaderMarker(body) {
  return new RegExp('^' + blanks + marker).exec(body);
}

// Consume older materializer markers and a separately saved title together with
// the fence. The block now owns the complete header, including its H1.
export function leadingBioBlock(body) {
  const opening = new RegExp('^' + blanks + '(?:' + marker + blanks + ')?' +
    '(?: {0,3}#[\\t ]+[^\\r\\n]+\\r?\\n' + blanks + ')?' +
    ' {0,3}(`{3,}|~{3,})taelgar-header[\\t ]*\\r?\\n').exec(body);
  if (!opening) return null;
  const fence = opening[1], rest = body.slice(opening[0].length);
  const closing = new RegExp('^ {0,3}' + fence[0] + '{' + fence.length + ',}[\\t ]*(?:\\r?\\n|$)', 'm').exec(rest);
  return {end: closing ? opening[0].length + closing.index + closing[0].length : body.length,
    error: !closing ? 'Close the taelgar-header code block.' : rest.slice(0, closing.index).trim() ? 'Leave the taelgar-header block empty; its values come from frontmatter.' : null};
}

// Detect only the familiar versioned saved-header layout. In particular, do not
// eat an authored paragraph just because it immediately follows the title.
function savedHeaderEnd(note) {
  if (!note.metadata.headerVersion || !note.metadata.tags) return null;
  const title = /^(?:[\t ]*\r?\n)* {0,3}#[\t ]+[^\r\n]+(?:\r?\n|$)/.exec(note.body);
  if (!title) return null;
  let end = title[0].length;
  while (end < note.body.length) {
    const line = /^[^\r\n]*(?:\r?\n|$)/.exec(note.body.slice(end))[0];
    if (/^[\t ]*>+[\t ]*\[!/.test(line) && !/^[\t ]*>+[\t ]*\[!info\]/i.test(line)) break;
    const pronunciation = /^[\t ]*\*\([^\r\n]+\)\*[\t ]*(?:\r?\n|$)/.test(line);
    const inline = /^[\t ]*`\$=dv\.view\(["']_scripts\/view\/get_(?:PageDatedValue|Affiliations|Whereabouts)["']\)`[\t ]*(?:\r?\n|$)/.test(line);
    const link = /^[\t ]*\[\[[^\]\r\n]+\]\][\t ]*(?:\r?\n|$)/.test(line);
    if (!(pronunciation || inline || link || /^[\t ]*>/.test(line))) break;
    end += line.length;
  }
  return end;
}

// Publication-only transformation of a parsed note. Keep frontmatter and the
// authored suffix intact; a second pass returns exactly the same source.
export function normalizeHeader(note) {
  const bio = leadingBioBlock(note.body);
  if (bio?.error) throw new Error(bio.error);
  const oldMarker = bio ? null : leadingHeaderMarker(note.body);
  const end = bio?.end ?? oldMarker?.[0].length ?? savedHeaderEnd(note);
  if (end == null) return note;
  const suffix = note.body.slice(end);
  const separator = suffix && !/^[\t ]*\r?\n/.test(suffix) ? '\n' : '';
  const body = HEADER_BLOCK + separator + suffix;
  if (body === note.body) return note;
  const frontmatter = note.source.slice(0, note.source.length - note.body.length);
  return {...note, body, source: frontmatter + body};
}
