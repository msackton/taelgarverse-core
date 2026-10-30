import MarkdownIt from 'markdown-it';

const markdown=new MarkdownIt({html:true});
export const HEADER_CALLOUT='> [!taelgar-header]\n';

// Markdown owns the block boundaries: fences, indented examples, nested quotes
// and list items cannot accidentally become top-level generated headers.
// Offsets refer to the original string, including CRLF line endings.
export function scanHeaderCallouts(source) {
  return scanTopLevelCallouts(source,['taelgar-header']);
}

export function scanTopLevelCallouts(source,types) {
  if(!types.some(type=>source.toLowerCase().includes('[!'+type+']')))return [];
  const lines=source.match(/[^\n]*(?:\n|$)/g) || [],offsets=[0];
  for(const line of lines)offsets.push(offsets.at(-1)+line.length);
  return markdown.parse(source,{}).flatMap(token=>{
    if(token.type!=='blockquote_open' || token.level!==0)return [];
    const match=/^ {0,3}>[\t ]*\[!([\w-]+)\](?:[-+])?(?:[\t ].*)?\r?\n?$/i.exec(lines[token.map[0]]);
    return match && types.includes(match[1].toLowerCase()) ? [{type:match[1].toLowerCase(),start:offsets[token.map[0]],
      end:offsets[token.map[1]],startLine:token.map[0],endLine:token.map[1]}] : [];
  });
}

export function withoutHeaderCallouts(source) {
  let result='',end=0;
  for(const callout of scanHeaderCallouts(source)) {result+=source.slice(end,callout.start);end=callout.end;}
  return result+source.slice(end);
}
