import {convertWebsiteNote} from './website-compatibility.mjs';
import {scanFencedCodeBlocks,scanSectionHeadings,applyReplacements} from './markdown-fences.mjs';

// Publication copies only. DQL evaluation runs in the preceding Node stage;
// conversion and cleanup never execute JavaScript or edit original notes.
export function preparePublicationNote(note) {
  return cleanupPublicationNote(convertWebsiteNote(note).note);
}

export function cleanupPublicationNote(note) {
  const fences=scanFencedCodeBlocks(note.body);
  const removed=fences.filter(block=>block.language==='dataviewjs' && block.closed);
  const replacements=removed.map(block=>({start:block.start,end:block.end,text:block.quotePrefix+'\n'}));
  let sectionsRemoved=0;
  for(const heading of scanSectionHeadings(note.body,fences).reverse()) {
    if(!removed.some(block=>block.start>=heading.contentStart && block.end<=heading.end))continue;
    const changes=replacements.filter(change=>change.start>=heading.contentStart && change.end<=heading.end)
      .map(change=>({...change,start:change.start-heading.contentStart,end:change.end-heading.contentStart}));
    const remaining=applyReplacements(note.body.slice(heading.contentStart,heading.end),changes)
      .replace(/^(?:[ \t]*>)+[ \t]*(?:\r?\n|$)/gm,'')
      .replace(/^[ \t]*%%\^(?:Campaign:[^%\r\n]+|Date:[^%\r\n]+|End)%%[ \t]*(?:\r?\n|$)/gm,'');
    if(remaining.trim())continue;
    replacements.push({start:heading.start,end:heading.contentStart,text:''});sectionsRemoved++;
  }
  const body=applyReplacements(note.body,replacements);
  const frontmatter=note.source.slice(0,note.source.length-note.body.length);
  return {note:body===note.body ? note : {...note,body,source:frontmatter+body},
    dataviewJsBlocksRemoved:removed.length,sectionsRemoved};
}
