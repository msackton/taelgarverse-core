import MarkdownIt from 'markdown-it';
import attrs from 'markdown-it-attrs';
import {authoredBody} from './content-store.mjs';
import {filterComments} from './comments.mjs';
import {dateKey} from './common.mjs';
import {DateManager} from './header-core/dates.mjs';

const markdown=new MarkdownIt({html:true}).use(attrs);
const sentenceSegmenter=typeof Intl.Segmenter==='function' ? new Intl.Segmenter('en',{granularity:'sentence'}) : null;

// Share the header's calendar and partial-date conventions. In particular,
// Fantasy Calendar months start at zero and normalized dates use DR day counts.
function commentDate(value) {
  if(value == null)return null;
  if(value instanceof Date)value=value.toISOString().slice(0,10);
  if(typeof value==='string')dateKey(value,true);
  const dates=new DateManager({date:value}),normalized=dates.normalizeDate(value);
  if(!normalized || !Number.isInteger(normalized.year) || !Number.isInteger(normalized.days))throw new Error('Description requires a valid Taelgar DR date');
  const year=normalized.year;
  let day=normalized.days-dates.normalizeDate(year).days+1,month=1;
  for(const length of [31,28,31,30,31,30,31,31,30,31,30,31]) {
    if(day<=length)break;
    day-=length;month++;
  }
  const result=String(year).padStart(4,'0')+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
  dateKey(result);
  return result;
}

function paragraphText(tokens) {
  return tokens.map(token=>{
    if(token.type==='text' || token.type==='code_inline' && !token.content.startsWith('$='))return token.content;
    if(token.type==='softbreak' || token.type==='hardbreak')return ' ';
    return '';
  }).join('').replace(/\s+/g,' ').trim();
}

export function firstDescriptionSentence(note,{date=null,campaigns=[],dm=false,source='<note>'}={}) {
  const body=filterComments(authoredBody(note),{date:commentDate(date),campaigns,dm,source})
    .replace(/!\[\[[^\]]+\]\]/g,'')
    .replace(/\[\[([^\]]+)\]\]/g,(_,value)=>{
      const [target,alias]=value.split('|');
      return alias || target.split('#')[0].split('/').at(-1) || target.slice(1);
    });
  const tokens=markdown.parse(body,{});
  for(let index=0;index<tokens.length;index++) {
    // Only ordinary article paragraphs qualify. Markdown parsing skips entire
    // callouts/blockquotes (including lazy continuations), headings, code,
    // tables and lists. Image-only paragraphs have no text; keep looking.
    if(tokens[index].type!=='paragraph_open' || tokens[index].level!==0)continue;
    const inline=tokens[index+1];
    if(inline?.type!=='inline')continue;
    const text=paragraphText(inline.children || []);
    if(!text)continue;
    return sentenceSegmenter ? sentenceSegmenter.segment(text)[Symbol.iterator]().next().value.segment.trim() : (text.match(/^.*?[.!?](?=\s|$)/)?.[0] || text).trim();
  }
  return '';
}
