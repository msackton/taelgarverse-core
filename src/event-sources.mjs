import MarkdownIt from 'markdown-it';
import {dateKey} from './common.mjs';
import {codeRanges,filterComments} from './comments.mjs';
import {scanHeaderCallouts} from './header-callout.mjs';
import {getPageType} from './header-core/metadata.mjs';
import {eventDate,eventDateRange,eventQualifier,eventSort} from './event-dates.mjs';

export const EVENT_SOURCE_VERSION=1;
export const eventMetadataKeys=['tags','DR','DR_end','born','created','died','destroyed','whereabouts'];
const markdown=new MarkdownIt({html:true});
const metadataDates=['born','created','died','destroyed'];
const blank=text=>text.replace(/[^\r\n]/g,' ');
const dateValue='-?\\d{1,4}(?:-\\d{1,2}){0,2}(?:\\s+to\\s+-?\\d{1,4}(?:-\\d{1,2}){0,2})?';
const field='(DR(?:_end)?)::\\s*('+dateValue+')(?![\\d-]|\\s+to\\s)';
const dateTokens=new RegExp('\\(\\(\\s*'+field+'\\s*\\)\\)|\\(\\s*'+field+'\\s*\\)|\\[\\s*'+field+'\\s*\\]|(?<![\\w\\[(])'+field,'g');

export function eligibleEventSource(path) {
  return !path.split('/').slice(0,-1).some(part=>part.startsWith('_') || part.startsWith('.') || part.toLowerCase()==='worldbuilding');
}

function conditionFor(marker) {
  const campaign=/^Campaign:\s*(.+)$/i.exec(marker);
  if(campaign)return {campaign:campaign[1].trim().toLowerCase()};
  const dated=/^Date:\s*([\d-]+)(b?)$/i.exec(marker);
  if(dated)return {[dated[2]?'before':'after']:dateKey(dated[1],true)};
  return null;
}

function replaceSpans(source,spans) {
  let text='',cursor=0;
  for(const [start,end] of spans.sort((a,b)=>a[0]-b[0])) {
    if(end<=cursor)continue;
    if(start>cursor)text+=source.slice(cursor,start);
    text+=blank(source.slice(Math.max(start,cursor),end));
    cursor=end;
  }
  return text+source.slice(cursor);
}

function extractInlineRows(body,path,rows,warnings,lineOffset) {
  if(!/\bDR::/.test(body))return;
  const spans=[];
  try{filterComments(body,{date:'9999-12-31',source:path,lineOffset,spans});}
  catch(error){warnings.push(error.message);return;}
  const mask=scanHeaderCallouts(body).map(({start,end})=>[start,end]);
  const conditions=[];
  for(const {start,end,bodyStart,bodyEnd,marker} of spans) {
    const condition=marker && conditionFor(marker);
    if(condition) {
      conditions.push({start:bodyStart,end:bodyEnd,condition});
      mask.push([start,bodyStart],[bodyEnd,end]);
    } else mask.push([start,end]);
  }
  const source=replaceSpans(body,mask),offsets=[0];
  for(const match of source.matchAll(/\n/g))offsets.push(match.index+1);
  offsets.push(source.length);
  const stack=[];
  for(const token of markdown.parse(source,{})) {
    if(token.type==='list_item_open')stack.push({level:token.level,chunks:[],conditions:new Set(),line:lineOffset+token.map[0]+1});
    const item=stack.at(-1);
    if(!item)continue;
    if(token.type==='inline' && token.level===item.level+2) {
      item.chunks.push(token.content);
      const [start,end]=token.map;
      for(const span of conditions)if(span.start<offsets[end] && span.end>offsets[start])item.conditions.add(span.condition);
    } else if(token.type==='list_item_close') {
      stack.pop();
      const text=item.chunks.join('\n');
      const fields=[...replaceSpans(text,codeRanges(text)).matchAll(dateTokens)].map(match=>{
        const position=[1,3,5,7].find(i=>match[i]);
        return {name:match[position],value:match[position+1],uncertain:position===1,start:match.index,end:match.index+match[0].length};
      });
      const start=fields.find(field=>field.name==='DR'),end=fields.find(field=>field.name==='DR_end');
      if(!start)continue;
      const range=eventDateRange(start.value,end?.value,{uncertainStart:start.uncertain,uncertainEnd:end?.uncertain});
      if(!range){warnings.push(path+':'+item.line+': Invalid inline event date.');continue;}
      let prose=text;
      for(const {start,end} of fields.reverse()) {
        const before=prose.slice(0,start).trimEnd(),after=prose.slice(end).trimStart();
        prose=before+(before && after && !/^[.,;:!?)]+/.test(after)?' ':'')+after;
      }
      prose=prose.replace(/\n\s*/g,' ').replace(/^\s*(?:[-–]\s*)?[,;:]?\s*/,'').trim();
      // When both fields are at the front, their separator may be a word.
      if(end)prose=prose.replace(/^to\s*[:;,]?\s+/i,'');
      const prefix=/^([^:]{1,40}):\s*(.+)$/.exec(prose),qualifier=prefix && eventQualifier(prefix[1]);
      if(qualifier)prose=prefix[2];
      if(!prose)continue;
      rows.push({...range,sort:eventSort(range.start,range.precision,qualifier),kind:'inline',text:prose,line:item.line,
        ...(qualifier?{label:range.label+', '+prefix[1].trim()}:{}),
        ...(item.conditions.size?{when:[...item.conditions]}:{})});
    }
  }
}

export function extractEventSource(path,note) {
  const rows=[],warnings=[],metadata=note.metadata;
  const addPoint=(kind,value,isEnd=false,details={})=>{
    if(value==null || value==='' || /^unknown$/i.test(value))return;
    const period=eventDate(value);
    if(!period){warnings.push(path+': Invalid date for '+kind+'.');return;}
    const day=isEnd?period.end:period.start;
    rows.push({kind,start:day,end:day,sort:eventSort(day,period.precision),label:period.label,...details});
  };
  if(metadata.DR!=null && metadata.DR!=='' && !/^unknown$/i.test(metadata.DR)) {
    const range=eventDateRange(metadata.DR,metadata.DR_end);
    if(range)rows.push({...range,kind:'note',sort:eventSort(range.start,range.precision)});
    else warnings.push(path+': Invalid frontmatter DR date.');
  }
  if(!(getPageType(metadata)==='event' && metadata.DR!=null)) {
    const useDR=!metadataDates.some(field=>Object.hasOwn(metadata,field));
    addPoint('start',useDR?metadata.DR:metadata.born || metadata.created);
    addPoint('end',useDR?metadata.DR_end:metadata.died || metadata.destroyed,true);
  }
  if(Array.isArray(metadata.whereabouts))for(const item of metadata.whereabouts) {
    if(!item || typeof item!=='object')continue;
    const location=[item.location || item.place,item.location ? null : item.region].filter(value=>typeof value==='string' && value.trim()).join(', ');
    if(!location || /^unknown$/i.test(location))continue;
    const start=item.start || item.date;
    const verb=['home','primary'].includes(item.type)?'moved to':item.end?'arrived at':'was at';
    addPoint('travel',item.end,true,{location,verb:'left'});
    addPoint('travel',start,false,{location,verb});
  }
  const lineOffset=note.source?.slice(0,note.source.length-note.body.length).split('\n').length-1 || 0;
  extractInlineRows(note.body,path,rows,warnings,lineOffset);
  return {rows,warnings};
}

export function collectEventSources(entries,extract=extractEventSource) {
  const notes=[],warnings=[];
  for(const entry of entries) {
    if(typeof entry.note?.body!=='string' || !eligibleEventSource(entry.id))continue;
    const record=extract(entry.id,entry.note);
    if(record.rows.length)notes.push([entry.id,record.rows]);
    warnings.push(...record.warnings);
  }
  return {version:EVENT_SOURCE_VERSION,notes,warnings};
}
