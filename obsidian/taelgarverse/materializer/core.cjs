"use strict";

const KNOWN_INLINE_VIEWS = new Map([
  ["_scripts/view/get_PageDatedValue", "pageDatedValue"],
  ["_scripts/view/get_Affiliations", "affiliations"],
  ["_scripts/view/get_Whereabouts", "whereabouts"],
  ["_scripts/view/get_CampaignInteractions", "campaignInteractions"],
]);

const UNSUPPORTED_DATAVIEWJS_PATTERNS = [
  { pattern: /\bdocument\s*\./, reason: "uses document DOM APIs" },
  { pattern: /\bwindow\s*\./, reason: "uses window APIs" },
  { pattern: /\bapp\.workspace\s*\./, reason: "uses Obsidian workspace APIs" },
  { pattern: /\.createEl\s*\(/, reason: "creates DOM elements" },
  { pattern: /\.addEventListener\s*\(/, reason: "registers DOM event handlers" },
  { pattern: /\bfetch\s*\(/, reason: "performs network IO" },
  { pattern: /\brequire\s*\(/, reason: "uses CommonJS require" },
];

const UNSUPPORTED_DATAVIEW_QUERY_PATTERNS = [
  {
    pattern: (source) => /\bfile\.lists\b/i.test(source) && /\bthis\.file\.name\b/i.test(source),
    reason: "scans all file lists for the current page name",
  },
];

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

function positionInRanges(position, ranges) {
  return ranges.some((range) => position >= range.start && position < range.end);
}

function findInlineDataviewExpressions(text, protectedRanges = []) {
  const expressions = [];
  const regex = /`\$=([^`]+)`/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (positionInRanges(match.index, protectedRanges)) continue;

    const lineStart = text.lastIndexOf("\n", match.index) + 1;
    const lineEndIndex = text.indexOf("\n", match.index);
    const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
    const line = text.slice(lineStart, lineEnd);
    const before = text.slice(lineStart, match.index);

    expressions.push({
      type: "inlineDataview",
      raw: match[0],
      expression: match[1].trim(),
      start: match.index,
      end: match.index + match[0].length,
      lineStart,
      lineEnd,
      line,
      continuationPrefix: before.match(/^((?:[ \t]*>[ \t]?)+[ \t]*)/)?.[1] ?? "",
    });
  }

  return expressions;
}

function parseKnownInlineExpression(expression) {
  const viewMatch = expression.match(
    /^dv\.view\(\s*["']([^"']+)["']\s*(?:,\s*(.*?)\s*)?\)\s*$/s,
  );
  if (viewMatch && KNOWN_INLINE_VIEWS.has(viewMatch[1])) {
    return {
      kind: KNOWN_INLINE_VIEWS.get(viewMatch[1]),
      view: viewMatch[1],
      inputSource: viewMatch[2],
      campaign: parseCampaignInput(viewMatch[2]),
    };
  }

  const campaignMatch = expression.match(
    /^customJS\.OutputHandler\.outputCampaignInteractions\(\s*dv\.current\(\)\.file\.name\s*,\s*dv\.current\(\)\s*(?:,\s*["']([^"']+)["']\s*)?\)\s*$/s,
  );
  if (campaignMatch) {
    return {
      kind: "campaignInteractions",
      campaign: campaignMatch[1],
    };
  }

  return undefined;
}

function parseCampaignInput(inputSource) {
  if (!inputSource) return undefined;
  const match = inputSource.match(/\bcampaign\s*:\s*["']([^"']+)["']/);
  return match?.[1];
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

function formatInlineReplacement(markdown, expression) {
  const normalized = markdown == null ? "" : String(markdown);
  if (!normalized.includes("\n")) return normalized;

  const lines = normalized.replace(/\n+$/, "").split("\n");
  if (lines.length <= 1) return normalized.trimEnd();
  return lines
    .map((line, index) => (index === 0 ? line : expression.continuationPrefix + line))
    .join("\n");
}

function detectUnsupportedDataviewJs(source) {
  return UNSUPPORTED_DATAVIEWJS_PATTERNS.filter((entry) => entry.pattern.test(source)).map(
    (entry) => entry.reason,
  );
}

function detectUnsupportedDataviewQuery(source) {
  return UNSUPPORTED_DATAVIEW_QUERY_PATTERNS.filter((entry) => entry.pattern(source)).map(
    (entry) => entry.reason,
  );
}

const DYNAMIC_HEADER_MARKER = "<!-- taelgar:header -->";

function prepareDynamicWebsiteMarkdown(text) {
  const frontmatter = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  const prefix = frontmatter?.[0] || "";
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  let body = text.slice(prefix.length);
  let headerMarkersInserted = 0;

  // Only versioned, generated note headers are replaced. Ordinary page titles
  // and the frontmatter are retained on notes without headerVersion.
  const headerVersion = frontmatter?.[1].match(/^headerVersion[ \t]*:[ \t]*([^\r\n#]+)/m)?.[1].trim();
  if (headerVersion && !["null", "~", '""', "''"].includes(headerVersion) &&
      !body.trimStart().startsWith(DYNAMIC_HEADER_MARKER)) {
    const lines = splitLinesWithPositions(body);
    let index = lines.findIndex((line) => line.text.trim());
    let end = 0;
    if (index >= 0 && /^ {0,3}#[ \t]+\S/.test(lines[index].text)) {
      end = lines[index].end;
      let inInfo = false;
      for (index += 1; index < lines.length; index += 1) {
        const line = lines[index].text;
        if (/^[ \t]*>+[ \t]*\[!info\]/i.test(line)) inInfo = true;
        else if (/^[ \t]*>[ \t]*\[!/.test(line)) break;
        const inline = line.trim().match(/^`\$=(.+)`[ \t]*$/);
        if (!(/^[ \t]*\*\(.+\)\*[ \t]*$/.test(line) ||
              (inInfo && /^[ \t]*>/.test(line)) ||
              (inline && parseKnownInlineExpression(inline[1].trim())))) break;
        end = lines[index].end;
      }
    }
    body = DYNAMIC_HEADER_MARKER + newline + newline + body.slice(end).replace(/^(?:[ \t]*\r?\n)*/, "");
    headerMarkersInserted = 1;
  }

  const fences = scanFencedCodeBlocks(body);
  const removedBlocks = fences.filter((block) => block.language === "dataviewjs" && block.closed);
  const replacements = removedBlocks.map((block) => ({
    start: block.start, end: block.end, text: block.quotePrefix + newline,
  }));
  const headings = scanSectionHeadings(body, fences);
  let sectionsRemoved = 0;

  // Remove heading lines, rather than whole ranges, so surrounding campaign/date
  // delimiters survive. Work from the leaves upward to prune empty parent sections.
  for (const heading of headings.reverse()) {
    if (!removedBlocks.some((block) => block.start >= heading.contentStart && block.end <= heading.end)) continue;
    const changes = replacements.filter((replacement) =>
      replacement.start >= heading.contentStart && replacement.end <= heading.end,
    ).map((replacement) => ({ ...replacement, start: replacement.start - heading.contentStart, end: replacement.end - heading.contentStart }));
    const remaining = applyReplacements(body.slice(heading.contentStart, heading.end), changes)
      .replace(/^(?:[ \t]*>)+[ \t]*(?:\r?\n|$)/gm, "")
      .replace(/^[ \t]*%%\^(?:Campaign:[^%\r\n]+|Date:[^%\r\n]+|End)%%[ \t]*(?:\r?\n|$)/gm, "");
    if (remaining.trim()) continue;
    replacements.push({ start: heading.start, end: heading.contentStart, text: "" });
    sectionsRemoved += 1;
  }

  return {
    content: prefix + applyReplacements(body, replacements),
    headerMarkersInserted,
    dataviewJsBlocksRemoved: removedBlocks.length,
    sectionsRemoved,
  };
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

function countRemainingDynamicMarkdown(text) {
  const fences = scanFencedCodeBlocks(text).filter((block) =>
    ["dataview", "dataviewjs"].includes(block.language),
  );
  const inlines = findInlineDataviewExpressions(
    text,
    scanFencedCodeBlocks(text).map((block) => ({ start: block.start, end: block.end })),
  );

  return {
    dataviewFences: fences.filter((block) => block.language === "dataview").length,
    dataviewJsFences: fences.filter((block) => block.language === "dataviewjs").length,
    inlineExpressions: inlines.length,
  };
}

module.exports = {
  DYNAMIC_HEADER_MARKER,
  KNOWN_INLINE_VIEWS,
  applyReplacements,
  countRemainingDynamicMarkdown,
  detectUnsupportedDataviewQuery,
  detectUnsupportedDataviewJs,
  findInlineDataviewExpressions,
  formatInlineReplacement,
  parseKnownInlineExpression,
  prefixMarkdownLines,
  prepareDynamicWebsiteMarkdown,
  scanFencedCodeBlocks,
  splitLinesWithPositions,
  stripBlockquotePrefix,
};
