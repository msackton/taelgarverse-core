import MarkdownIt from 'markdown-it';
import {filterComments} from './comments.mjs';
import {applyReplacements,scanFencedCodeBlocks,splitLinesWithPositions} from './markdown-fences.mjs';
import {isWebsiteFence} from './website-fences.mjs';

const markdown=new MarkdownIt({html:true});

const isConditional=span=>/^(?:Campaign|Date):/i.test(span.marker || '');

function commentSpans(body) {
  if(!body.includes('%%'))return [];
  const spans=[];
  try{filterComments(body,{date:'9999-12-31',spans});}
  catch{return [];} // Preserve malformed comments for the regular renderer's diagnostics.
  return spans;
}

function publicationContentView(body) {
  const spans=commentSpans(body);
  if(!spans.length)return body;
  const blank=(start,end)=>({start,end,text:body.slice(start,end).replace(/[^\r\n]/g,' ')});
  const editorial=spans.filter(span=>span.marker && !isConditional(span));
  return applyReplacements(body,spans.flatMap(span=>{
    if(isConditional(span))return [blank(span.start,span.bodyStart),blank(span.bodyEnd,span.end)];
    if(editorial.some(parent=>span.start>=parent.bodyStart && span.end<=parent.bodyEnd))return [];
    return [blank(span.start,span.end)];
  }));
}

function emptyHeadings(body) {
  const lines=splitLinesWithPositions(body),scopes=[[]],replacements=[];
  function finish(scope,level) {
    while(scope.length && scope.at(-1).level>=level) {
      const heading=scope.pop();
      if(heading.hasBody) {
        if(scope.length)scope.at(-1).hasBody=true;
      } else {
        const [first,after]=heading.map;
        replacements.push({start:lines[first].start,end:lines[after-1].end,text:''});
      }
    }
  }
  const tokens=markdown.parse(publicationContentView(body),{});
  for(let i=0;i<tokens.length;i++) {
    const token=tokens[i],scope=scopes.at(-1);
    if(token.type==='heading_open') {
      const level=Number(token.tag.slice(1));
      finish(scope,level);
      scope.push({level,map:token.map,hasBody:false});
      // The heading text itself does not count as section content.
      while(tokens[i].type!=='heading_close')i++;
    } else if(token.type==='blockquote_open' || token.type==='list_item_open')scopes.push([]);
    else if(token.type==='blockquote_close' || token.type==='list_item_close')finish(scopes.pop(),1);
    else if(token.type==='fence' || token.type==='code_block' || token.type==='hr' ||
      token.type==='inline' && token.content.trim() ||
      token.type==='html_block' && token.content.replace(/<!--[\s\S]*?(?:-->|$)/g,'').trim()) {
      for(const active of scopes)if(active.length)active.at(-1).hasBody=true;
    }
  }
  finish(scopes[0],1);
  return replacements;
}

export function cleanupPublicationNote(note) {
  const fences=scanFencedCodeBlocks(publicationContentView(note.body)).filter(block=>!isWebsiteFence(block.language));
  // Keep a blank separator so neighboring paragraphs and horizontal rules
  // do not merge or turn into a setext heading when a fence disappears.
  const newline=note.body.includes('\r\n')?'\r\n':'\n';
  const replacements=fences.map(({start,end,openingPrefix,continuationPrefix})=>{
    const nextLine=note.body.slice(end).match(/^(?:[ \t]*\r?\n)*([^\r\n]*)/)?.[1] || '';
    const hasListMarker=openingPrefix!==continuationPrefix;
    const continues=hasListMarker && nextLine.startsWith(continuationPrefix) && nextLine.trim();
    return {start,end,text:continues?openingPrefix+newline:newline};
  });
  let body=applyReplacements(note.body,replacements);
  const headings=emptyHeadings(body);
  if(headings.length)body=applyReplacements(body,headings);
  if(fences.length || headings.length) {
    const emptyBlocks=commentSpans(body).filter(span=>isConditional(span) && !body.slice(span.bodyStart,span.bodyEnd).trim());
    body=applyReplacements(body,emptyBlocks.map(({start,end})=>({start,end,text:''})));
    if(!body.trim())body='';
  }
  return {note:body===note.body?note:{...note,body,source:note.source.slice(0,note.source.length-note.body.length)+body},
    removedLines:fences.map(block=>block.startLine),sectionsRemoved:headings.length};
}

export function cleanupPublicationStore(store) {
  const report={schemaVersion:2,omitted:[],sectionsRemoved:0};
  for(const entry of store.entries) {
    if(!entry.note)continue;
    try {
      const {note,removedLines,sectionsRemoved}=cleanupPublicationNote(entry.note);
      entry.note=note;
      for(const line of removedLines)report.omitted.push({file:entry.id,line});
      report.sectionsRemoved+=sectionsRemoved;
    } catch(error) {
      throw new Error(entry.id+': '+error.message,{cause:error});
    }
  }
  return report;
}
