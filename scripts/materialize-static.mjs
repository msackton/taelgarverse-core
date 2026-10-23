#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { finishDeferredCopy } from "./static-copy-output.mjs";

const PLUGIN_ID = "taelgarverse";
const DEFAULT_OBSIDIAN_COMMAND = "obsidian";

export function parseArgs(argv) {
  const args = {
    strict: true,
    dynamicWebsite: false,
    blockTimeoutMs: 30000,
    wait: true,
    obsidianCommand: process.env.OBSIDIAN_COMMAND || DEFAULT_OBSIDIAN_COMMAND,
    headerType: "website",
    progress: true,
    progressIntervalMs: 1000,
    obsidianOutput: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[index];
    };

    if (arg === "--vault") args.vaultPath = next();
    else if (arg === "--out" || arg === "--output") args.outputPath = next();
    else if (arg === "--date") args.overrideDate = next();
    else if (arg === "--mode") args.mode = next();
    else if (arg === "--report") args.reportPath = next();
    else if (arg === "--header-type") args.headerType = next();
    else if (arg === "--dynamic-website") args.dynamicWebsite = true;
    else if (arg === "--timeout") throw new Error("--timeout was removed; stop stuck materialization processes explicitly.");
    else if (arg === "--block-timeout") args.blockTimeoutMs = Number(next()) * 1000;
    else if (arg === "--obsidian-command" || arg === "--obsidian-cli") {
      args.obsidianCommand = next();
    } else if (arg === "--obsidian-vault") {
      args.obsidianVault = next();
    } else if (arg === "--strict") args.strict = true;
    else if (arg === "--no-strict") args.strict = false;
    else if (arg === "--progress") args.progress = true;
    else if (arg === "--no-progress") args.progress = false;
    else if (arg === "--progress-interval") args.progressIntervalMs = Number(next()) * 1000;
    else if (arg === "--obsidian-output") args.obsidianOutput = true;
    else if (arg === "--no-obsidian-output") args.obsidianOutput = false;
    else if (arg === "--no-wait") args.wait = false;
    else if (
      [
        "--launcher",
        "--protocol-delay",
        "--request-only",
        "--request-path",
        "--vault-request",
      ].includes(arg)
    ) {
      throw new Error(`${arg} was removed; this wrapper now uses the official Obsidian CLI.`);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

export function printHelp() {
  console.log(`Usage:
  npm run materialize:static -- --vault /path/to/Taelgar --out /path/to/Taelgar-static --date YYYY-MM-DD --strict

Options:
  --vault PATH       Source Obsidian vault. Defaults to the current working directory.
  --out PATH         Output vault path. Enables write mode unless --mode is supplied.
  --mode MODE        audit, write, or check. Defaults to write when --out is set, otherwise audit.
  --date DATE        Override CustomJS target date.
  --report PATH      Report JSON path.
  --header-type TYPE website, static, or none. Default: website.
  --dynamic-website Replace generated headers with <!-- taelgar:header -->,
                    delete dataviewjs blocks and sections left empty by them,
                    and materialize dataview queries; overrides --header-type.
  --strict           Fail when unsupported blocks or errors are found. Default.
  --no-strict        Produce partial output and report unsupported blocks.
  --block-timeout SECONDS
                    Per-block Dataview render timeout. Default: 30.
  --obsidian-command PATH
                    Official Obsidian CLI command. Defaults to OBSIDIAN_COMMAND or "obsidian".
  --obsidian-vault NAME_OR_ID
                    Optional explicit Obsidian vault target. By default the CLI runs with
                    the source vault as its working directory.
  --progress        Show a progress bar while Obsidian processes files. Default.
  --no-progress     Disable progress output.
  --progress-interval SECONDS
                    Progress polling interval. Default: 1.
  --obsidian-output Show Obsidian CLI stdout/stderr while waiting. Default.
  --no-obsidian-output
                    Hide Obsidian CLI stdout/stderr unless the command fails.
  --no-wait          Run the CLI request and print the report path without reading it.
                    Unavailable for dynamic website write mode, which needs the Node copy phase.
`);
}

export function buildMaterializerRequest(args, options = {}) {
  const cwd = options.cwd || process.cwd();
  const vaultPath = path.resolve(args.vaultPath || cwd);
  const mode = args.mode || (args.outputPath ? "write" : "audit");
  const id = options.id || `materialize-${Date.now()}`;
  const pluginDir = path.join(vaultPath, ".obsidian", "plugins", PLUGIN_ID);
  const outputPath = args.outputPath ? path.resolve(args.outputPath) : undefined;
  const reportPath = path.resolve(
    args.reportPath ||
      (outputPath
        ? path.join(outputPath, ".dataview-materialization-report.json")
        : path.join(pluginDir, "last-report.json")),
  );
  const externalCopy = args.dynamicWebsite && mode === "write";
  if (externalCopy && args.wait === false) throw new Error("--no-wait cannot be used for dynamic website write mode: the Node CLI must finish copying the output.");

  const request = {
    id,
    config: {
      vaultPath,
      outputPath,
      mode,
      strict: args.strict,
      dynamicWebsite: args.dynamicWebsite ?? false,
      externalCopy: Boolean(externalCopy),
      requestId: id,
      stagedMarkdownPath: externalCopy ? path.join(outputPath, `.dataview-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}.markdown.json`) : undefined,
      reportPath,
      progressPath: `${reportPath}.progress.json`,
      overrideDate: args.overrideDate,
      headerType: args.dynamicWebsite ? "none" : (args.headerType ?? "website"),
      blockTimeoutMs: args.blockTimeoutMs,
    },
  };

  return { request, vaultPath, outputPath, reportPath };
}

export function buildEvalCode(request) {
  return `(async () => {
  const request = ${JSON.stringify(request)};
  const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.materializer;
  if (!plugin) throw new Error(${JSON.stringify(`Plugin not loaded: ${PLUGIN_ID}`)});
  if (typeof plugin.runRequest !== "function") {
    throw new Error(${JSON.stringify(`Plugin does not expose runRequest(): ${PLUGIN_ID}`)});
  }
  if ((request.config?.dynamicWebsite && plugin.supportsDynamicWebsite !== true) ||
      (request.config?.externalCopy && plugin.supportsExternalCopy !== true)) {
    const message = "The loaded materializer plugin is outdated. Reload the Taelgarverse plugin or restart Obsidian, then rerun this command.";
    if (typeof plugin.writeReport !== "function") throw new Error(message);
    await plugin.writeReport(request.config.reportPath, {
      id: request.id, status: "failed", exitCode: 1, error: {message}
    });
    return message;
  }
  await plugin.runRequest(request);
  return ${JSON.stringify(`Materializer request ${request.id} finished`)};
})()`;
}

export function buildObsidianCliArgs({ code, vaultTarget } = {}) {
  const args = [];
  if (vaultTarget) args.push(`vault=${vaultTarget}`);
  args.push("eval", `code=${code}`);
  return args;
}

export async function runObsidianCli(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";

    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (options.onStdout) options.onStdout(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (options.onStderr) options.onStderr(text);
    });

    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        finish(
          reject,
          new Error(
            `Obsidian CLI command not found: ${command}. ` +
              `Pass --obsidian-command or set OBSIDIAN_COMMAND to the registered CLI path.`,
          ),
        );
      } else {
        finish(reject, error);
      }
    });

    child.on("close", (code, signal) => {
      if (code === 0) {
        finish(resolve, { stdout, stderr });
        return;
      }

      const suffix = [
        signal ? `signal ${signal}` : `exit code ${code}`,
        stderr.trim() ? `stderr:\n${stderr.trim()}` : undefined,
        stdout.trim() ? `stdout:\n${stdout.trim()}` : undefined,
      ]
        .filter(Boolean)
        .join("\n");
      finish(reject, new Error(`Obsidian CLI failed with ${suffix}`));
    });
  });
}

export async function waitForReport(reportPath, expectedId) {
  while (true) {
    try {
      const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
      if (!expectedId || report.id === expectedId) return report;
    } catch {
    }
    await sleep(1000);
  }
}

export function formatProgressLine(progress, options = {}) {
  const width = options.width ?? 28;
  const columns = options.columns ?? 120;
  const total = Number(progress.totalFiles || 0);
  const current = Number(progress.fileIndex || progress.counts?.filesScanned || 0);
  const status = progress.status || "running";

  if (progress.phase === "copying") {
    return truncateLine(`Copying output: ${progress.filesCopied || 0} files, ${(Number(progress.bytesCopied || 0) / 1048576).toFixed(1)} MiB | ${progress.currentFile || status}`, columns);
  }
  if (progress.phase === "staging") return truncateLine("Materializing: Markdown finished; preparing Node output copy", columns);
  if (progress.phase === "awaiting-copy") return truncateLine("Materializing: Markdown ready; waiting for Node output copy", columns);
  if (progress.phase === "complete") return status === "ok" ? "Materialization complete." : "Materialization failed; see report.";
  if (progress.phase === "copy-failed") return "Output copy failed; see report.";

  if (status === "starting" && total === 0) {
    return truncateLine("Materializing: starting Obsidian runtime and waiting for Dataview/CustomJS", columns);
  }

  const ratio = total > 0 ? Math.max(0, Math.min(1, current / total)) : 0;
  const filled = total > 0 ? Math.round(ratio * width) : 0;
  const percent = total > 0 ? `${(ratio * 100).toFixed(1).padStart(5)}%` : "  ?.?%";
  const counts = progress.counts || {};
  const bar = `${"#".repeat(filled)}${"-".repeat(Math.max(0, width - filled))}`;
  const base =
    `Materializing [${bar}] ${current}/${total || "?"} ${percent} ` +
    `changed ${counts.filesChanged ?? 0} headers ${counts.headersRegenerated ?? 0} ` +
    `dv ${Number(counts.dataviewBlocks ?? 0) + Number(counts.dataviewJsBlocks ?? 0)} ` +
    `inline ${counts.inlineExpressions ?? 0} errors ${counts.errors ?? 0} ` +
    `unsupported ${counts.unsupported ?? 0}`;
  const currentFile = progress.currentFile ? ` | ${progress.currentFile}` : ` | ${status}`;
  return truncateLine(base + currentFile, columns);
}

export function truncateLine(value, columns) {
  if (!columns || value.length <= columns) return value;
  if (columns <= 4) return value.slice(0, columns);
  return `${value.slice(0, columns - 3)}...`;
}

export function formatWaitingForProgressLine(progressPath, elapsedMs) {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  let line = `Materializing: waiting ${seconds}s for Obsidian to create ${progressPath}`;
  if (seconds >= 30) {
    line += "; the CLI has launched, but the materializer plugin has not written startup progress yet";
  }
  return line;
}

export function writePrefixedLines(stream, prefix, text) {
  const normalized = String(text ?? "").replace(/\r/g, "");
  for (const line of normalized.split("\n")) {
    if (!line.trim()) continue;
    stream.write(`${prefix}${line}\n`);
  }
}

export function createProgressMonitor(progressPath, options = {}) {
  const stream = options.stream || process.stderr;
  const intervalMs = options.intervalMs || 1000;
  const lineIntervalMs = options.lineIntervalMs || Math.max(5000, intervalMs);
  const enabled = options.enabled !== false;
  const isTty = Boolean(stream.isTTY);
  let interval;
  let lastLine = "";
  let lastPrintedBucket = -1;
  let lastPrintedAt = 0;
  let waitingPrintedAt = 0;
  let sawProgress = false;
  let stopped = false;
  const startedAt = Date.now();

  async function readProgress() {
    try {
      return JSON.parse(await fs.readFile(progressPath, "utf8"));
    } catch {
      return undefined;
    }
  }

  function writeLine(line, progress) {
    if (!enabled || !line) return;

    if (isTty) {
      const clear = lastLine.length > line.length ? " ".repeat(lastLine.length - line.length) : "";
      stream.write(`\r${line}${clear}`);
      lastLine = line;
      return;
    }

    const total = Number(progress.totalFiles || 0);
    const current = Number(progress.fileIndex || progress.counts?.filesScanned || 0);
    const bucket = total > 0 ? Math.floor((current / total) * 20) : 0;
    const now = Date.now();
    if (
      progress.status !== "running" ||
      bucket > lastPrintedBucket ||
      now - lastPrintedAt >= lineIntervalMs
    ) {
      stream.write(`${line}\n`);
      lastPrintedBucket = bucket;
      lastPrintedAt = now;
    }
  }

  async function tick() {
    if (stopped) return;
    const progress = await readProgress();
    if (!progress) {
      if (!enabled) return;
      const now = Date.now();
      if (now - waitingPrintedAt >= lineIntervalMs) {
        const line = formatWaitingForProgressLine(progressPath, now - startedAt);
        if (isTty) {
          const truncated = truncateLine(line, Math.max(60, (stream.columns || 120) - 1));
          const clear = lastLine.length > truncated.length ? " ".repeat(lastLine.length - truncated.length) : "";
          stream.write(`\r${truncated}${clear}`);
          lastLine = truncated;
        } else {
          stream.write(`${line}\n`);
        }
        waitingPrintedAt = now;
      }
      return;
    }
    if (!sawProgress && !isTty && enabled) {
      stream.write(`Materializing: Obsidian progress file detected.\n`);
    }
    sawProgress = true;
    writeLine(
      formatProgressLine(progress, {
        columns: Math.max(60, (stream.columns || 120) - 1),
      }),
      progress,
    );
  }

  return {
    start() {
      if (!enabled || interval) return;
      if (!isTty) stream.write(`Materializing: progress file ${progressPath}\n`);
      void tick();
      interval = setInterval(() => {
        void tick();
      }, intervalMs);
    },
    async stop() {
      if (stopped) return;
      if (interval) clearInterval(interval);
      await tick();
      stopped = true;
      if (enabled && isTty && lastLine) stream.write("\n");
    },
  };
}

export function summarizeReport(report) {
  if (!report.counts) return report;
  return {
    status: report.status,
    exitCode: report.exitCode,
    mode: report.mode,
    strict: report.strict,
    dynamicWebsite: report.dynamicWebsite ?? false,
    filesScanned: report.counts.filesScanned,
    filesSkipped: report.counts.filesSkipped,
    filesChanged: report.counts.filesChanged,
    dataviewBlocks: report.counts.dataviewBlocks,
    dataviewJsBlocks: report.counts.dataviewJsBlocks,
    inlineExpressions: report.counts.inlineExpressions,
    headersRegenerated: report.counts.headersRegenerated,
    headerMarkersInserted: report.counts.headerMarkersInserted,
    dataviewJsBlocksRemoved: report.counts.dataviewJsBlocksRemoved,
    sectionsRemoved: report.counts.sectionsRemoved,
    unsupported: report.counts.unsupported,
    errors: report.counts.errors,
    remaining: {
      dataviewBlocks: report.counts.remainingDataviewBlocks,
      dataviewJsBlocks: report.counts.remainingDataviewJsBlocks,
      inlineExpressions: report.counts.remainingInlineExpressions,
    },
    performance: report.performance
      ? {
          totalMs: report.performance.totalMs,
          prepareRuntimeMs: report.performance.prepareRuntimeMs,
          processFilesMs: report.performance.processFilesMs,
          copyMs: report.performance.copyMs,
          timingTotals: report.performance.timingTotals,
          slowFiles: (report.performance.slowFiles || []).slice(0, 10),
        }
      : undefined,
  };
}

export function formatReportOutcome(report, reportPath) {
  const failed = report.status === "failed" || Number(report.exitCode || 0) !== 0;
  const counts = report.counts;
  const partial = !failed && counts && (counts.errors > 0 || counts.unsupported > 0);
  const lines = [failed ? "Materialization failed." : partial ? "Materialization completed with partial output." : "Materialization complete."];
  if (failed && report.mode === "write" && report.strict && counts && report.phase !== "copy-failed") {
    lines.push("Strict mode blocked writing vault output; only report files were written.");
  } else if (!failed && report.mode === "write" && report.outputPath) {
    lines.push(`Output: ${report.outputPath}`);
  }
  if (counts) {
    lines.push(`Scanned ${counts.filesScanned ?? 0} notes; errors ${counts.errors ?? 0}; unsupported ${counts.unsupported ?? 0}.`);
    if (report.dynamicWebsite) {
      lines.push(`Dynamic website: ${counts.headerMarkersInserted ?? 0} header markers; ${counts.dataviewJsBlocksRemoved ?? 0} JavaScript blocks removed; ${counts.sectionsRemoved ?? 0} headings removed; ${counts.dataviewBlocks ?? 0} Dataview queries processed.`);
    }
  }
  if (report.error?.message) lines.push(report.error.message);
  for (const file of report.files || []) {
    for (const issue of file.issues || []) {
      lines.push(`${file.path}${issue.line ? ':' + issue.line : ''} [${issue.type}]: ${String(issue.message || '').replace(/\s+/g, ' ').trim()}`);
    }
  }
  if (failed && report.mode === "write" && report.strict && counts && report.phase !== "copy-failed") {
    lines.push("Resolve the issues above, or use --no-strict to export partial output with failed/unsupported blocks left unchanged.");
  } else if (partial) {
    lines.push("Failed or unsupported blocks remain unchanged in the output.");
  }
  lines.push(`Report: ${reportPath}`);
  return lines.join("\n");
}

export async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { request, vaultPath, reportPath } = buildMaterializerRequest(args);

  await fs.rm(reportPath, { force: true });
  await fs.rm(`${reportPath}.progress.json`, { force: true });

  const code = buildEvalCode(request);
  const obsidianArgs = buildObsidianCliArgs({
    code,
    vaultTarget: args.obsidianVault,
  });
  const obsidianCommand = args.obsidianCommand;
  const progressMonitor = createProgressMonitor(`${reportPath}.progress.json`, {
    enabled: args.progress,
    intervalMs: args.progressIntervalMs,
  });

  if (args.progress) {
    process.stderr.write(
      [
        `Materializing: request ${request.id}`,
        `Materializing: vault ${vaultPath}`,
        request.config.outputPath ? `Materializing: output ${request.config.outputPath}` : undefined,
        `Materializing: report ${reportPath}`,
        `Materializing: header type ${request.config.headerType}`,
        request.config.dynamicWebsite ? "Materializing: dynamic website Markdown" : undefined,
        `Materializing: launching ${obsidianCommand}`,
      ]
        .filter(Boolean)
        .join("\n") + "\n",
    );
  }

  progressMonitor.start();
  try {
    await runObsidianCli(obsidianCommand, obsidianArgs, {
      cwd: vaultPath,
      onStdout: args.obsidianOutput
        ? (text) => writePrefixedLines(process.stderr, "Obsidian CLI: ", text)
        : undefined,
      onStderr: args.obsidianOutput
        ? (text) => writePrefixedLines(process.stderr, "Obsidian CLI: ", text)
        : undefined,
    });

    if (!args.wait) {
      await progressMonitor.stop();
      console.log(`Report path: ${reportPath}`);
      return;
    }

    let report = await waitForReport(reportPath, request.id);
    report = await finishDeferredCopy(report, reportPath, async copyProgress => {
      await fs.writeFile(`${reportPath}.progress.json`, JSON.stringify({
        ...copyProgress, status: "running", counts: report.counts, updatedAt: new Date().toISOString(),
      }) + "\n", "utf8");
    });
    if (request.config.externalCopy) {
      await fs.writeFile(`${reportPath}.progress.json`, JSON.stringify({
        status: report.status, phase: report.phase, counts: report.counts, updatedAt: new Date().toISOString(),
      }) + "\n", "utf8");
    }
    await progressMonitor.stop();
    const failed = report.status === "failed" || Number(report.exitCode || 0) !== 0;
    (failed ? process.stderr : process.stdout).write(formatReportOutcome(report, reportPath) + "\n");
    process.exitCode = report.exitCode || (failed ? 1 : 0);
  } finally {
    await progressMonitor.stop();
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
