// Fence scanning and position-preserving edits, moved from the legacy vault materializer.
function splitLinesWithPositions(text) {
  const lines = [];
  let offset = 0;
  let lineNumber = 1;

  while (offset < text.length) {
    const newlineIndex = text.indexOf("\n", offset);
    const end = newlineIndex === -1 ? text.length : newlineIndex + 1;
    const raw = text.slice(offset, end);
    lines.push({
      raw,
      text: raw.endsWith("\n") ? raw.slice(0, -1).replace(/\r$/, "") : raw,
      start: offset,
      end,
      line: lineNumber,
    });
    offset = end;
    lineNumber += 1;
  }

  if (text.length === 0) {
    lines.push({ raw: "", text: "", start: 0, end: 0, line: 1 });
  }

  return lines;
}

function stripBlockquotePrefix(line) {
  const match = line.match(/^((?:[ \t]*>[ \t]?)+)(.*)$/);
  if (!match) return { prefix: "", quoteDepth: 0, rest: line };

  return {
    prefix: match[1],
    quoteDepth: (match[1].match(/>/g) || []).length,
    rest: match[2],
  };
}

function parseFenceOpening(line) {
  const unquoted = stripBlockquotePrefix(line);
  const match = unquoted.rest.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
  if (!match) return undefined;

  const fence = match[2];
  const info = match[3].trim();
  if (fence[0] === "`" && info.includes("`")) return undefined;

  return {
    quotePrefix: unquoted.prefix,
    quoteDepth: unquoted.quoteDepth,
    indent: match[1],
    fence,
    fenceChar: fence[0],
    fenceLength: fence.length,
    info,
    language: (info.split(/\s+/)[0] || "").toLowerCase(),
  };
}

function isFenceClosing(line, opener) {
  const unquoted = stripBlockquotePrefix(line);
  if (opener.quoteDepth > 0 && unquoted.quoteDepth < opener.quoteDepth) {
    return false;
  }

  const escaped = opener.fenceChar === "`" ? "`" : "~";
  const regex = new RegExp(`^ {0,3}${escaped}{${opener.fenceLength},}[ \\t]*$`);
  return regex.test(unquoted.rest);
}

function stripFenceBodyLine(line, quoteDepth) {
  if (quoteDepth <= 0) return line.raw;

  const raw = line.raw.endsWith("\n") ? line.raw.slice(0, -1) : line.raw;
  const newline = line.raw.endsWith("\n") ? "\n" : "";
  let rest = raw;

  for (let i = 0; i < quoteDepth; i += 1) {
    const match = rest.match(/^[ \t]*>[ \t]?(.*)$/);
    if (!match) return line.raw;
    rest = match[1];
  }

  return rest + newline;
}

function scanFencedCodeBlocks(text) {
  const lines = splitLinesWithPositions(text);
  const blocks = [];

  for (let i = 0; i < lines.length; i += 1) {
    const opener = parseFenceOpening(lines[i].text);
    if (!opener) continue;

    let body = "";
    let closed = false;
    let closingLine = undefined;

    for (let j = i + 1; j < lines.length; j += 1) {
      if (isFenceClosing(lines[j].text, opener)) {
        closed = true;
        closingLine = lines[j];
        break;
      }
      body += stripFenceBodyLine(lines[j], opener.quoteDepth);
    }

    const endLine = closingLine || lines[lines.length - 1];
    const end = closingLine ? closingLine.end : text.length;

    blocks.push({
      type: "fencedCode",
      language: opener.language,
      info: opener.info,
      body,
      start: lines[i].start,
      end,
      startLine: lines[i].line,
      endLine: endLine.line,
      closed,
      quotePrefix: opener.quotePrefix,
      quoteDepth: opener.quoteDepth,
      fenceChar: opener.fenceChar,
      fenceLength: opener.fenceLength,
    });

    i = closingLine ? lines.indexOf(closingLine) : lines.length;
  }

  return blocks;
}

function applyReplacements(text, replacements) {
  const sorted = [...replacements].sort((a, b) => {
    if (b.start !== a.start) return b.start - a.start;
    return b.end - a.end;
  });

  let output = text;
  for (const replacement of sorted) {
    output =
      output.slice(0, replacement.start) +
      replacement.text +
      output.slice(replacement.end);
  }
  return output;
}

function prefixMarkdownLines(markdown, quotePrefix) {
  if (!quotePrefix) return markdown;
  if (!markdown) return "";

  const hasTrailingNewline = markdown.endsWith("\n");
  const lines = (hasTrailingNewline ? markdown.slice(0, -1) : markdown).split("\n");
  const prefixed = lines.map((line) => quotePrefix + line).join("\n");
  return hasTrailingNewline ? prefixed + "\n" : prefixed;
}

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


export {scanFencedCodeBlocks,splitLinesWithPositions,applyReplacements,prefixMarkdownLines,scanSectionHeadings};
