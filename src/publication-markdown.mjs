import {scanFencedCodeBlocks,scanSectionHeadings,applyReplacements,prefixMarkdownLines} from './markdown-fences.mjs';

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

export function cleanupPublicationNote(note) {
  const fences=scanFencedCodeBlocks(note.body);
  const removed=fences.filter(block=>block.language==='dataviewjs' && block.closed);
  if(!removed.length)return {note,removedLines:[],sectionsRemoved:0};
  const replacements=removed.map(block=>({start:block.start,end:block.end,text:prefixMarkdownLines('\n',block.openingPrefix,block.continuationPrefix)}));
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
  return {note:{...note,body,source:frontmatter+body},removedLines:removed.map(block=>block.startLine),sectionsRemoved};
}
