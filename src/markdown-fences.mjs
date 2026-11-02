import blocks from './markdown-blocks.cjs';
const {scanCodeBlocks,scanFencedCodeBlocks,splitLinesWithPositions,applyReplacements,prefixMarkdownLines}=blocks;

function scanSectionHeadings(text, fences) {
  const lines = splitLinesWithPositions(text);
  const headings = [];
  const protectedLine = (line) => fences.some((block) => line.start >= block.start && line.start < block.end);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (protectedLine(line)) continue;
    const atx = /^ {0,3}(#{1,6})(?:[ \t]+|$)/.exec(line.text);
    if (atx) {
      headings.push({ start: line.start, contentStart: line.end, level: atx[1].length });
      continue;
    }
    const setext = /^ {0,3}(=+|-+)[ \t]*$/.exec(line.text);
    const previous = lines[index - 1];
    if (setext && previous && !protectedLine(previous) &&
        /^ {0,3}(?![\s#>`~]|[-+*][ \t]|\d+[.)][ \t])\S/.test(previous.text) &&
        !headings.some((heading) => heading.start === previous.start)) {
      headings.push({ start: previous.start, contentStart: line.end, level: setext[1][0] === "=" ? 1 : 2 });
    }
  }
  const stack = [];
  for (const heading of headings) {
    while (stack.length && stack[stack.length - 1].level >= heading.level) stack.pop().end = heading.start;
    stack.push(heading);
  }
  for (const heading of stack) heading.end = text.length;
  return headings;
}


export {scanCodeBlocks,scanFencedCodeBlocks,splitLinesWithPositions,applyReplacements,prefixMarkdownLines,scanSectionHeadings};
