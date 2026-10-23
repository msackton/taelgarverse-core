import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative !== "" && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
};
const writeJson = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + "\n", "utf8");

function excluded(relative, bundle, isDirectory) {
  if (/^assets?\/dm(?:\/|$)/i.test(relative)) return true;
  const parts = relative.split("/");
  if (bundle.dynamicWebsite) {
    const directories = isDirectory ? parts : parts.slice(0, -1);
    return parts.some(part => part.startsWith(".")) || parts.at(-1) === "AGENTS.md" ||
      directories.some(part => part.startsWith("_") || part.toLowerCase() === "worldbuilding");
  }
  return parts.some(part => part.startsWith(".")) ||
    (bundle.excludedTopLevelDirs || ["Worldbuilding"]).includes(parts[0]) ||
    (bundle.excludedTopLevelPrefixes || ["_"]).some(prefix => parts[0].startsWith(prefix)) ||
    ["assets/dm", "assets/worldbuilding"].some(directory => relative === directory || relative.startsWith(directory + "/"));
}

export async function copyOutputBundle(bundle, onProgress = async () => {}) {
  const sourceRoot = await fs.realpath(bundle.vaultPath);
  const outputRoot = path.resolve(bundle.outputPath);
  if (outputRoot === path.parse(outputRoot).root || sourceRoot === outputRoot || inside(sourceRoot, outputRoot)) {
    throw new Error("Output must be outside the source vault and cannot be a filesystem root.");
  }
  await fs.mkdir(outputRoot, { recursive: true });
  const realOutput = await fs.realpath(outputRoot);
  if (sourceRoot === realOutput || inside(sourceRoot, realOutput)) throw new Error("Output resolves inside the source vault.");
  const notes = new Map((bundle.files || []).map(file => [file.path, file.content]));
  const progress = { phase: "copying", filesCopied: 0, bytesCopied: 0, currentFile: "" };

  async function copyDirectory(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const source = path.join(directory, entry.name);
      const relative = path.relative(sourceRoot, source).split(path.sep).join("/");
      if (excluded(relative, bundle, entry.isDirectory()) || entry.isSymbolicLink()) continue;
      const target = path.join(outputRoot, relative);
      if (entry.isDirectory()) {
        await fs.mkdir(target, { recursive: true });
        await copyDirectory(source);
      } else if (entry.isFile()) {
        progress.currentFile = relative;
        await onProgress({ ...progress });
        if (notes.has(relative)) {
          const content = notes.get(relative);
          await fs.writeFile(target, content, "utf8");
          progress.bytesCopied += Buffer.byteLength(content);
        } else {
          let lastUpdate = Date.now();
          await pipeline(createReadStream(source, { highWaterMark: 1024 * 1024 }), async function* (chunks) {
            for await (const chunk of chunks) {
              progress.bytesCopied += chunk.length;
              if (Date.now() - lastUpdate >= 250) {
                await onProgress({ ...progress });
                lastUpdate = Date.now();
              }
              yield chunk;
            }
          }, createWriteStream(target));
        }
        progress.filesCopied += 1;
      }
    }
  }
  await copyDirectory(sourceRoot);
  progress.currentFile = "";
  await onProgress({ ...progress });
  return { filesCopied: progress.filesCopied, bytesCopied: progress.bytesCopied };
}

export async function finishDeferredCopy(report, reportPath, onProgress = async () => {}) {
  if (report.status !== "ok" || !report.deferredCopy || report.outputComplete) return report;
  const started = Date.now();
  const bundlePath = path.resolve(report.deferredCopy);
  const outputRoot = path.resolve(report.outputPath);
  try {
    if (!inside(outputRoot, bundlePath)) throw new Error("Staged Markdown must be inside the output directory.");
    const bundle = JSON.parse(await fs.readFile(bundlePath, "utf8"));
    if (bundle.schemaVersion !== 1 || bundle.requestId !== report.id ||
        path.resolve(bundle.vaultPath) !== path.resolve(report.vaultPath) ||
        path.resolve(bundle.outputPath) !== outputRoot) throw new Error("Staged Markdown does not match this materialization request.");
    report.phase = "copying";
    report.outputComplete = false;
    await writeJson(reportPath, report);
    report.outputCopy = await copyOutputBundle(bundle, onProgress);
    report.phase = "complete";
    report.outputComplete = true;
    report.performance.copyMs = Date.now() - started;
    report.performance.totalMs += report.performance.copyMs;
    report.finishedAt = new Date().toISOString();
    await writeJson(reportPath, report);
    // This is the exact request-owned staging file validated above.
    await fs.rm(bundlePath);
  } catch (error) {
    report.status = "failed";
    report.exitCode = 1;
    report.phase = "copy-failed";
    report.outputComplete = false;
    report.error = { message: `Output copy failed: ${error.message}` };
    await writeJson(reportPath, report);
  }
  return report;
}
