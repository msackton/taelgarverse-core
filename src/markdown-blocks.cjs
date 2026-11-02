// Shared Markdown block boundaries for render protection and source rewrites.
// CommonJS keeps the legacy static materializer on the same implementation.
const MarkdownIt = require('markdown-it');
const markdown = new MarkdownIt({html:true});
const fenceRule = markdown.block.ruler.__rules__.find(rule=>rule.name==='fence').fn;
markdown.block.ruler.at('fence',(state,startLine,endLine,silent)=>{
  const position=state.bMarks[startLine]+state.tShift[startLine];
  const column=position-(state.src.lastIndexOf('\n',position-1)+1);
  if(!fenceRule(state,startLine,endLine,silent))return false;
  if(!silent){
    const token=state.tokens.at(-1),last=state.line-1;
    const tail=state.src.slice(state.bMarks[last]+state.tShift[last],state.eMarks[last]);
    const run=tail.match(token.markup[0]==='`'?/^`+/:/^~+/)?.[0] || '';
    token.meta={column,closed:last>startLine && run[0]===token.markup[0] &&
      run.length>=token.markup.length && !tail.slice(run.length).trim() &&
      state.sCount[last]-state.blkIndent<4};
  }
  return true;
},{alt:['paragraph','reference','blockquote','list']});

function splitLinesWithPositions(text) {
  const lines=[];let offset=0;
  for(const raw of text.match(/[^\n]*\n|[^\n]+$/g) || []){
    lines.push({raw,text:raw.replace(/\r?\n$/,''),start:offset,end:offset+raw.length,line:lines.length+1});
    offset+=raw.length;
  }
  if(!lines.length)lines.push({raw:'',text:'',start:0,end:0,line:1});
  return lines;
}

function scanCodeBlocks(text) {
  const lines=splitLinesWithPositions(text);
  return markdown.parse(text,{}).filter(token=>['fence','code_block'].includes(token.type)).map(token=>{
    const [first,after]=token.map,start=lines[first].start,end=lines[after-1].end;
    const openingPrefix=token.type==='fence'?lines[first].text.slice(0,token.meta.column):'';
    // List markers belong only on the first line; following lines keep their
    // indentation and quote markers. Original offsets retain CRLF boundaries.
    const continuationPrefix=openingPrefix.replace(/[^>\t ]/g,' ');
    return {type:token.type==='fence'?'fencedCode':'indentedCode',
      language:(token.info.trim().split(/\s+/)[0] || '').toLowerCase(),info:token.info.trim(),body:token.content,
      start,end,startLine:first+1,endLine:after,closed:token.meta?.closed ?? false,
      openingPrefix,continuationPrefix,quotePrefix:continuationPrefix,
      quoteDepth:(openingPrefix.match(/>/g) || []).length,
      fenceChar:token.markup[0],fenceLength:token.markup.length};
  });
}
const scanFencedCodeBlocks=text=>scanCodeBlocks(text).filter(block=>block.type==='fencedCode');
function applyReplacements(text,replacements) {
  for(const replacement of [...replacements].sort((a,b)=>b.start-a.start || b.end-a.end))
    text=text.slice(0,replacement.start)+replacement.text+text.slice(replacement.end);
  return text;
}
function prefixMarkdownLines(markdown,prefix,continuationPrefix=prefix) {
  if(!markdown)return '';
  const trailing=markdown.endsWith('\n');
  const lines=(trailing?markdown.slice(0,-1):markdown).split('\n');
  return lines.map((line,index)=>(index?continuationPrefix:prefix)+line).join('\n')+(trailing?'\n':'');
}
module.exports={scanCodeBlocks,scanFencedCodeBlocks,splitLinesWithPositions,applyReplacements,prefixMarkdownLines};
