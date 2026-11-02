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

const {scanCodeBlocks,scanFencedCodeBlocks,applyReplacements,prefixMarkdownLines}=require('../../../src/markdown-blocks.cjs');

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

function countRemainingDynamicMarkdown(text) {
  const fences = scanFencedCodeBlocks(text).filter((block) =>
    ["dataview", "dataviewjs"].includes(block.language),
  );
  const inlines = findInlineDataviewExpressions(
    text,
    scanCodeBlocks(text).map((block) => ({ start: block.start, end: block.end })),
  );

  return {
    dataviewFences: fences.filter((block) => block.language === "dataview").length,
    dataviewJsFences: fences.filter((block) => block.language === "dataviewjs").length,
    inlineExpressions: inlines.length,
  };
}

module.exports = {
  KNOWN_INLINE_VIEWS,
  applyReplacements,
  countRemainingDynamicMarkdown,
  detectUnsupportedDataviewQuery,
  detectUnsupportedDataviewJs,
  findInlineDataviewExpressions,
  formatInlineReplacement,
  parseKnownInlineExpression,
  prefixMarkdownLines,
  scanCodeBlocks,
  scanFencedCodeBlocks,
};
