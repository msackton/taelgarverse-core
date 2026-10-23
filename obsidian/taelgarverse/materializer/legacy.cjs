// Ported from the vault materializer; legacy DQL/JS/header behavior is preserved.
"use strict";

const { Notice, Component } = require("obsidian");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const LAYOUT_READY_GRACE_MS = 5000;
const DEFAULT_EXCLUDED_TOP_LEVEL_DIRS = ["Worldbuilding"];
const DEFAULT_EXCLUDED_TOP_LEVEL_PREFIXES = ["_"];
const EXCLUDED_ASSET_DIRS = ["assets/dm", "assets/worldbuilding"];

module.exports = class LegacyMaterializer extends Component {
  constructor(plugin) { super(); this.plugin = plugin; this.app = plugin.app; this.manifest = plugin.manifest; this.running = false; }
  addCommand(command) { return this.plugin.addCommand(command); }
  get supportsDynamicWebsite() {
    return true;
  }

  get supportsExternalCopy() {
    return true;
  }

  async onload() {
    this.running = false;
    this.core = undefined;

    this.addCommand({
      id: "materialize-dataview",
      name: "Audit Dataview materialization",
      callback: async () =>
        this.runRequest({
          id: `manual-${Date.now()}`,
          config: {
            vaultPath: this.getVaultBasePath(),
            mode: "audit",
            strict: false,
            reportPath: path.join(this.getPluginDirPath(), "last-report.json"),
          },
        }),
    });
  }

  getVaultBasePath() {
    const adapter = this.app.vault.adapter;
    if (typeof adapter.getBasePath === "function") return adapter.getBasePath();
    if (adapter.basePath) return adapter.basePath;
    throw new Error("This materializer requires a desktop FileSystemAdapter vault.");
  }

  getPluginDirPath() {
    return path.join(
      this.getVaultBasePath(),
      this.app.vault.configDir,
      "plugins",
      this.manifest.id,
    );
  }

  loadCore() { return require("./core.cjs"); }

  async runRequest(request) {
    if (this.running) throw new Error("A materialization request is already running.");
    this.running = true;

    const config = request.config || request;
    const reportPath = config.reportPath || request.reportPath;
    const startedAt = new Date().toISOString();

    try {
      await this.writeProgress(
        { progressPath: config.progressPath || progressPathFor(reportPath) },
        {
          status: "starting",
          fileIndex: 0,
          totalFiles: 0,
          counts: {},
        },
      );
      const report = await this.runMaterialization(config);
      report.id = request.id || report.id;
      report.startedAt = startedAt;
      report.finishedAt = new Date().toISOString();
      await this.writeReport(reportPath, report);

      if (report.status === "ok" && report.deferredCopy) {
        new Notice("Dataview Markdown is ready. The Node CLI will copy the output files.");
      } else if (report.status === "ok") {
        new Notice(`Dataview materialization complete: ${report.counts.filesChanged} files changed.`);
      } else {
        new Notice(`Dataview materialization failed: ${report.counts.errors} errors.`);
      }
    } catch (error) {
      const failureReport = {
        id: request.id,
        status: "failed",
        exitCode: 1,
        startedAt,
        finishedAt: new Date().toISOString(),
        error: {
          message: error.message,
          stack: error.stack,
        },
      };
      await this.writeReport(reportPath, failureReport);
      new Notice(`Dataview materialization failed: ${error.message}`);
      console.error("Taelgar Dataview materialization failed", error);
    } finally {
      this.running = false;
    }
  }

  async writeReport(reportPath, report) {
    const target = reportPath || path.join(this.getPluginDirPath(), "last-report.json");
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, JSON.stringify(report, null, 2) + "\n", "utf8");
  }

  async readVaultFile(file) {
    if (typeof this.app.vault.cachedRead === "function") {
      return this.app.vault.cachedRead(file);
    }
    return this.app.vault.read(file);
  }

  addTimingTotals(totals, timing) {
    totals.readMs += timing.readMs || 0;
    totals.headerMs += timing.headerMs || 0;
    totals.dataviewMs += timing.dataviewMs || 0;
    totals.dataviewJsMs += timing.dataviewJsMs || 0;
    totals.inlineMs += timing.inlineMs || 0;
    totals.totalFileMs += timing.totalMs || 0;
  }

  async runMaterialization(rawConfig) {
    const startedMs = Date.now();
    const core = this.loadCore();
    const config = this.normalizeConfig(rawConfig);
    const runtimeStartedMs = Date.now();
    const runtime = await this.prepareRuntime(config);
    const prepareRuntimeMs = Date.now() - runtimeStartedMs;

    const materializedFiles = [];
    const fileReports = [];
    const slowFiles = [];
    const timingTotals = {
      readMs: 0,
      headerMs: 0,
      dataviewMs: 0,
      dataviewJsMs: 0,
      inlineMs: 0,
      totalFileMs: 0,
    };
    const counts = {
      filesScanned: 0,
      filesChanged: 0,
      dataviewBlocks: 0,
      dataviewJsBlocks: 0,
      inlineExpressions: 0,
      headersRegenerated: 0,
      headerMarkersInserted: 0,
      dataviewJsBlocksRemoved: 0,
      sectionsRemoved: 0,
      unsupported: 0,
      errors: 0,
      taelgarBlocks: 0,
      mapsConverted: 0,
      remainingDataviewBlocks: 0,
      remainingDataviewJsBlocks: 0,
      remainingInlineExpressions: 0,
    };

    try {
      const allMarkdownFiles = this.app.vault.getMarkdownFiles();
      const markdownFiles = allMarkdownFiles.filter((file) => this.shouldProcessVaultPath(file.path, config));
      counts.filesSkipped = allMarkdownFiles.length - markdownFiles.length;
      const processStartedMs = Date.now();
      for (let index = 0; index < markdownFiles.length; index += 1) {
        const file = markdownFiles[index];
        await this.writeProgress(config, {
          status: "running",
          fileIndex: index + 1,
          totalFiles: markdownFiles.length,
          currentFile: file.path,
          counts,
        });

        counts.filesScanned += 1;
        const fileStartedMs = Date.now();
        const readStartedMs = Date.now();
        const original = await this.readVaultFile(file);
        const readMs = Date.now() - readStartedMs;
        const result = await this.materializeMarkdown(original, file, runtime, core, config);
        result.report.timing.readMs = readMs;
        result.report.timing.totalMs = Date.now() - fileStartedMs;
        this.addTimingTotals(timingTotals, result.report.timing);
        recordSlowFile(slowFiles, {
          path: file.path,
          ...result.report.timing,
          counts: result.report.counts,
        });
        materializedFiles.push({ path: file.path, content: result.content });
        fileReports.push(result.report);

        if (result.changed) counts.filesChanged += 1;
        counts.taelgarBlocks += result.report.counts.taelgarBlocks || 0;
        counts.mapsConverted += result.report.counts.mapsConverted || 0;
        counts.dataviewBlocks += result.report.counts.dataviewBlocks;
        counts.dataviewJsBlocks += result.report.counts.dataviewJsBlocks;
        counts.inlineExpressions += result.report.counts.inlineExpressions;
        counts.headersRegenerated += result.report.counts.headersRegenerated;
        counts.headerMarkersInserted += result.report.counts.headerMarkersInserted;
        counts.dataviewJsBlocksRemoved += result.report.counts.dataviewJsBlocksRemoved;
        counts.sectionsRemoved += result.report.counts.sectionsRemoved;
        counts.unsupported += result.report.counts.unsupported;
        counts.errors += result.report.counts.errors;
        counts.remainingDataviewBlocks += result.report.remaining.dataviewFences;
        counts.remainingDataviewJsBlocks += result.report.remaining.dataviewJsFences;
        counts.remainingInlineExpressions += result.report.remaining.inlineExpressions;
      }

      const hasFailures = counts.errors > 0 || counts.unsupported > 0;
      const status = config.strict && hasFailures ? "failed" : "ok";
      const processFilesMs = Date.now() - processStartedMs;
      let copyMs = 0;
      let deferredCopy;

      if (config.mode === "write" && status === "ok") {
        const copyStartedMs = Date.now();
        if (config.externalCopy) {
          await this.writeProgress(config, { status: "running", phase: "staging", counts });
          await fsp.mkdir(path.dirname(config.stagedMarkdownPath), { recursive: true });
          await fsp.writeFile(config.stagedMarkdownPath, JSON.stringify({
            schemaVersion: 1, requestId: config.requestId, vaultPath: config.vaultPath,
            outputPath: config.outputPath, files: materializedFiles, dynamicWebsite: config.dynamicWebsite,
            excludedTopLevelDirs: config.excludedTopLevelDirs,
            excludedTopLevelPrefixes: config.excludedTopLevelPrefixes,
          }) + "\n", "utf8");
          deferredCopy = config.stagedMarkdownPath;
        } else {
          await this.copyVaultToOutput(config.outputPath, materializedFiles, config);
        }
        copyMs = Date.now() - copyStartedMs;
      }

      await this.writeProgress(config, {
        status,
        phase: deferredCopy ? "awaiting-copy" : "complete",
        fileIndex: markdownFiles.length,
        totalFiles: markdownFiles.length,
        counts,
      });

      return {
        status,
        exitCode: status === "ok" ? 0 : 1,
        mode: config.mode,
        strict: config.strict,
        dynamicWebsite: config.dynamicWebsite,
        publicationPolicy: config.dynamicWebsite ? "context-v1" : "static",
        deferredCopy,
        phase: deferredCopy ? "awaiting-copy" : "complete",
        outputComplete: config.mode === "write" && status === "ok" && !deferredCopy,
        vaultPath: config.vaultPath,
        outputPath: config.outputPath,
        counts,
        performance: {
          totalMs: Date.now() - startedMs,
          prepareRuntimeMs,
          processFilesMs,
          copyMs,
          timingTotals,
          slowFiles,
        },
        files: fileReports.filter(
          (entry) =>
            entry.changed ||
            entry.issues.length > 0 ||
            entry.remaining.dataviewFences > 0 ||
            entry.remaining.dataviewJsFences > 0 ||
            entry.remaining.inlineExpressions > 0,
        ),
      };
    } finally {
      runtime.restore();
    }
  }

  normalizeConfig(rawConfig) {
    const vaultPath = path.resolve(rawConfig.vaultPath || this.getVaultBasePath());
    const currentVault = path.resolve(this.getVaultBasePath());
    if (vaultPath !== currentVault) {
      throw new Error(`This Obsidian instance is open on ${currentVault}, not ${vaultPath}.`);
    }

    const mode = rawConfig.mode || (rawConfig.outputPath ? "write" : "audit");
    if (!["audit", "write", "check"].includes(mode)) {
      throw new Error(`Unsupported materializer mode: ${mode}`);
    }

    if (rawConfig.inPlace) {
      throw new Error("In-place materialization is intentionally disabled; provide outputPath instead.");
    }

    const outputPath = rawConfig.outputPath ? path.resolve(rawConfig.outputPath) : undefined;
    if (mode === "write" && !outputPath) {
      throw new Error("write mode requires outputPath.");
    }
    if (outputPath && this.isSubpath(outputPath, currentVault)) {
      throw new Error("outputPath must be outside the source vault.");
    }
    if (outputPath === currentVault) throw new Error("outputPath must be outside the source vault.");

    const externalCopy = rawConfig.externalCopy === true;
    const stagedMarkdownPath = rawConfig.stagedMarkdownPath ? path.resolve(rawConfig.stagedMarkdownPath) : undefined;
    if (externalCopy && (!rawConfig.dynamicWebsite || mode !== "write" || !rawConfig.requestId ||
        !stagedMarkdownPath || !this.isSubpath(stagedMarkdownPath, outputPath))) {
      throw new Error("External copy requires dynamic website write mode and a staging file inside the output directory.");
    }

    const headerType = rawConfig.headerType || "none";
    if (!["none", "static", "website"].includes(headerType)) {
      throw new Error(`Unsupported materializer headerType: ${headerType}`);
    }

    return {
      mode,
      strict: rawConfig.strict !== false,
      dynamicWebsite: rawConfig.dynamicWebsite === true,
      externalCopy,
      stagedMarkdownPath,
      requestId: rawConfig.requestId,
      vaultPath,
      outputPath,
      headerType: rawConfig.dynamicWebsite === true ? "none" : headerType,
      reportPath: rawConfig.reportPath,
      progressPath: rawConfig.progressPath || progressPathFor(rawConfig.reportPath),
      excludedTopLevelDirs: rawConfig.excludedTopLevelDirs || DEFAULT_EXCLUDED_TOP_LEVEL_DIRS,
      excludedTopLevelPrefixes:
        rawConfig.excludedTopLevelPrefixes || DEFAULT_EXCLUDED_TOP_LEVEL_PREFIXES,
      overrideDate: rawConfig.overrideDate,
      blockTimeoutMs: rawConfig.blockTimeoutMs || 30000,
    };
  }

  isSubpath(candidate, parent) {
    const relative = path.relative(parent, candidate);
    return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
  }

  shouldProcessVaultPath(vaultPath, config) {
    return !this.isExcludedVaultPath(vaultPath, config);
  }

  isExcludedVaultPath(vaultPath, config, isDirectory = false) {
    if (/^assets?\/dm(?:\/|$)/i.test(vaultPath)) return true;
    if (config.dynamicWebsite) {
      const parts = vaultPath.split("/");
      const directories = isDirectory ? parts : parts.slice(0, -1);
      return parts.some(part => part.startsWith(".")) || parts.at(-1) === "AGENTS.md" ||
        directories.some(part => part.startsWith("_") || part.toLowerCase() === "worldbuilding");
    }
    if (EXCLUDED_ASSET_DIRS.some((directory) => vaultPath === directory || vaultPath.startsWith(`${directory}/`))) {
      return true;
    }
    const topLevel = vaultPath.split("/")[0];
    if (!topLevel) return false;
    if ((config.excludedTopLevelDirs || []).includes(topLevel)) return true;
    return (config.excludedTopLevelPrefixes || []).some((prefix) => topLevel.startsWith(prefix));
  }

  async prepareRuntime(config) {
    await this.waitForLayout();

    const dataviewPlugin = this.app.plugins.plugins.dataview;
    if (!dataviewPlugin?.api) throw new Error("Dataview plugin API is not available.");
    await this.waitForDataviewIndex(dataviewPlugin);

    if (config.dynamicWebsite) {
      return { api: dataviewPlugin.api, restore: () => {} };
    }

    if (typeof window.forceLoadCustomJS !== "function") {
      throw new Error("CustomJS forceLoadCustomJS() is not available.");
    }
    await window.forceLoadCustomJS();
    await this.waitForCustomJs();

    const customJS = window.customJS;
    const previousOverrideDate = customJS.state.overrideDate;
    const previousCoreMeta = customJS.state.coreMeta;

    try {
      const metadataPath = `${this.app.vault.configDir}/metadata.json`;
      const metadataJson = await this.app.vault.adapter.read(metadataPath);
      customJS.state.coreMeta = JSON.parse(metadataJson);
    } catch (error) {
      console.warn("Could not load .obsidian/metadata.json for materializer", error);
    }

    if (config.overrideDate) {
      customJS.state.overrideDate = customJS.DateManager.normalizeDate(config.overrideDate, false);
    }

    const restoreCompatibilityAliases = this.installCompatibilityAliases(customJS);
    const restoreMaterializationCaches = this.installMaterializationCaches(customJS, dataviewPlugin.api);

    return {
      api: dataviewPlugin.api,
      customJS,
      restore: () => {
        restoreMaterializationCaches();
        restoreCompatibilityAliases();
        customJS.state.overrideDate = previousOverrideDate;
        customJS.state.coreMeta = previousCoreMeta;
      },
    };
  }

  installCompatibilityAliases(customJS) {
    const patches = [];
    const setValue = (object, key, value) => {
      const hadOwn = Object.prototype.hasOwnProperty.call(object, key);
      const previous = object[key];
      object[key] = value;
      patches.push(() => {
        if (hadOwn) object[key] = previous;
        else delete object[key];
      });
    };
    const setFunctionIfMissing = (object, key, value) => {
      if (!object || typeof object[key] === "function") return;
      setValue(object, key, value);
    };

    if (!customJS.LocationManager) {
      setValue(customJS, "LocationManager", {});
    }
    setFunctionIfMissing(customJS.LocationManager, "getLocationName", (target) =>
      customJS.NameManager.getName(target),
    );

    setFunctionIfMissing(customJS.WhereaboutsManager, "getPartyMeeting", (metadata, campaign) =>
      customJS.EventManager.getPartyMeeting({ name: metadata?.name ?? "", frontmatter: metadata ?? {} }, campaign),
    );

    setFunctionIfMissing(customJS.util, "getName", (target) => customJS.NameManager.getName(target));
    setFunctionIfMissing(customJS.util, "getLoc", (metadata) => {
      const current = customJS.WhereaboutsManager.getWhereabouts(metadata ?? {}).current;
      return current?.location ? customJS.NameManager.getName(current.location) : "";
    });
    setFunctionIfMissing(customJS.util, "inPolity", (target, metadata, targetDate) =>
      customJS.util.inLocation(target, metadata, true, true, targetDate),
    );
    setFunctionIfMissing(customJS.util, "inRegion", (target, metadata, targetDate) =>
      customJS.util.inLocation(target, metadata, true, true, targetDate),
    );

    return () => {
      for (const restore of patches.reverse()) restore();
    };
  }

  installMaterializationCaches(customJS, dataviewApi) {
    const patches = [];
    const patchMethod = (object, key, replacementFactory) => {
      if (!object || typeof object[key] !== "function") return;
      const original = object[key];
      object[key] = replacementFactory(original.bind(object), object);
      patches.push(() => {
        object[key] = original;
      });
    };

    patchMethod(customJS.NameManager, "getFileForTarget", (original) => {
      const cache = new Map();
      return (target, filter) => {
        if (filter || typeof target !== "string") return original(target, filter);

        const key = target.toLowerCase();
        if (!cache.has(key)) {
          cache.set(key, original(target, filter) || null);
        }
        return cache.get(key) || undefined;
      };
    });

    patchMethod(customJS.AffiliationManager, "getLeadBy", (original, manager) => {
      const resultCache = new Map();
      const leaderIndexCache = new Map();

      const getPages = () => {
        const pages = dataviewApi.pages();
        if (pages && typeof pages.array === "function") return pages.array();
        return Array.from(pages || []);
      };

      const buildLeaderIndex = (targetDate) => {
        const targetKey = targetDate.sort;
        if (leaderIndexCache.has(targetKey)) return leaderIndexCache.get(targetKey);

        const grouped = new Map();
        for (const page of getPages()) {
          for (const aff of manager.getAffiliations(page) || []) {
            if (aff.type !== "leader") continue;
            if (aff.startDate.sort > targetDate.sort || aff.endDate.sort < targetDate.sort) continue;

            const entries = grouped.get(aff.org) || [];
            entries.push({ file: page, aff });
            grouped.set(aff.org, entries);
          }
        }

        leaderIndexCache.set(targetKey, grouped);
        return grouped;
      };

      return (thing, targetDate) => {
        const { DateManager, NameManager, TokenParser } = customJS;
        const normalizedDate = targetDate
          ? DateManager.normalizeDate(targetDate)
          : DateManager.getTargetDateForPage();
        if (!normalizedDate) return original(thing, targetDate);

        const cacheKey = `${thing}\u0000${normalizedDate.sort}`;
        if (resultCache.has(cacheKey)) return resultCache.get(cacheKey);

        const file = NameManager.getFileForTarget(thing);
        const displayData = NameManager.getDisplayData(file.frontmatter);
        const leaderAffs = buildLeaderIndex(normalizedDate).get(thing) || [];
        const lines = [];

        for (const aff of leaderAffs) {
          const dateInfo = {
            startDate: aff.aff.startDate,
            endDate: aff.aff.endDate,
            isCreated: true,
            isAlive: undefined,
            age: undefined,
          };

          DateManager.setPageDateProperties(dateInfo, normalizedDate);
          lines.push(
            TokenParser.formatDisplayString(
              displayData?.ruledBy,
              { name: aff.file.file.name, frontmatter: aff.file },
              normalizedDate,
              {
                dateInfo,
                affiliationtitle: aff.aff.title,
              },
            ),
          );
        }

        const result = lines.join("\n");
        resultCache.set(cacheKey, result);
        return result;
      };
    });

    return () => {
      for (const restore of patches.reverse()) restore();
    };
  }

  waitForLayout() {
    if (this.app.workspace.layoutReady) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => resolve(), LAYOUT_READY_GRACE_MS);
      this.app.workspace.onLayoutReady(() => {
        window.clearTimeout(timer);
        resolve();
      });
    });
  }

  async waitForDataviewIndex(dataviewPlugin) {
    while (!dataviewPlugin.index?.initialized) {
      await sleep(250);
    }
  }

  async waitForCustomJs() {
    while (!window.customJS?.state?._ready) {
      await sleep(250);
    }
  }

  async writeProgress(config, progress) {
    if (!config.progressPath) return;
    await fsp.mkdir(path.dirname(config.progressPath), { recursive: true });
    await fsp.writeFile(
      config.progressPath,
      JSON.stringify({ ...progress, updatedAt: new Date().toISOString() }, null, 2) + "\n",
      "utf8",
    );
  }

  async materializeMarkdown(original, file, runtime, core, config) {
    const timingStartedMs = Date.now();
    const report = {
      path: file.path,
      changed: false,
      counts: {
        dataviewBlocks: 0,
        dataviewJsBlocks: 0,
        inlineExpressions: 0,
        headersRegenerated: 0,
        headerMarkersInserted: 0,
        dataviewJsBlocksRemoved: 0,
        sectionsRemoved: 0,
        unsupported: 0,
        errors: 0,
      },
      issues: [],
      remaining: {
        dataviewFences: 0,
        dataviewJsFences: 0,
        inlineExpressions: 0,
      },
      timing: {
        headerMs: 0,
        dataviewMs: 0,
        dataviewJsMs: 0,
        inlineMs: 0,
        totalMs: 0,
      },
    };

    let source = original;
    if (config.dynamicWebsite) {
      const prepared = core.prepareDynamicWebsiteMarkdown(source);
      source = prepared.content;
      for (const key of ["headerMarkersInserted", "dataviewJsBlocksRemoved", "sectionsRemoved"]) {
        report.counts[key] = prepared[key];
      }
    }
    if (!config.dynamicWebsite && config.headerType !== "none") {
      const headerStartedMs = Date.now();
      try {
        const regenerated = this.regenerateHeader(source, file, runtime, config.headerType);
        if (regenerated !== source) {
          source = regenerated;
          report.counts.headersRegenerated += 1;
        }
      } catch (error) {
        report.counts.errors += 1;
        report.issues.push({
          type: "error",
          line: 1,
          message: `Header regeneration failed: ${error.message}`,
        });
      } finally {
        report.timing.headerMs += Date.now() - headerStartedMs;
      }
    }

    const fenceReplacements = [];
    const fences = core.scanFencedCodeBlocks(source);

    for (const block of fences) {
      if (!["dataview", "dataviewjs"].includes(block.language)) continue;

      if (!block.closed) {
        this.addIssue(report, "error", block, "Unclosed fenced code block.");
        continue;
      }
      if (config.dynamicWebsite && block.language === "dataviewjs") continue;

      if (block.language === "dataview") {
        report.counts.dataviewBlocks += 1;
        const unsupportedReasons = core.detectUnsupportedDataviewQuery(block.body);
        if (unsupportedReasons.length > 0) {
          this.addIssue(report, "unsupported", block, unsupportedReasons.join("; "));
          continue;
        }

        const queryStartedMs = Date.now();
        try {
          const rendered = await withTimeout(
            runtime.api.tryQueryMarkdown(block.body, file.path),
            config.blockTimeoutMs,
            `${file.path}:${block.startLine} dataview query`,
          );
          fenceReplacements.push({
            start: block.start,
            end: block.end,
            text: core.prefixMarkdownLines(normalizeRenderedMarkdown(rendered), block.quotePrefix) +
              (config.dynamicWebsite ? (source.includes("\r\n") ? "\r\n" : "\n") : ""),
          });
        } catch (error) {
          this.addIssue(report, "error", block, error.message);
        } finally {
          report.timing.dataviewMs += Date.now() - queryStartedMs;
        }
        continue;
      }

      report.counts.dataviewJsBlocks += 1;
      const unsupportedReasons = core.detectUnsupportedDataviewJs(block.body);
      if (unsupportedReasons.length > 0) {
        this.addIssue(report, "unsupported", block, unsupportedReasons.join("; "));
        continue;
      }

      const jsStartedMs = Date.now();
      try {
        const rendered = await withTimeout(
          this.renderDataviewJs(block.body, file, runtime),
          config.blockTimeoutMs,
          `${file.path}:${block.startLine} dataviewjs block`,
        );
        fenceReplacements.push({
          start: block.start,
          end: block.end,
          text: core.prefixMarkdownLines(normalizeRenderedMarkdown(rendered), block.quotePrefix),
        });
      } catch (error) {
        this.addIssue(report, "error", block, error.message);
      } finally {
        report.timing.dataviewJsMs += Date.now() - jsStartedMs;
      }
    }

    let materialized = core.applyReplacements(source, fenceReplacements);
    const protectedRanges = core.scanFencedCodeBlocks(materialized).map((block) => ({
      start: block.start,
      end: block.end,
    }));
    const inlineExpressions = config.dynamicWebsite
      ? []
      : core.findInlineDataviewExpressions(materialized, protectedRanges);
    const inlineReplacements = [];
    const inlineStartedMs = Date.now();

    for (const expression of inlineExpressions) {
      const parsed = core.parseKnownInlineExpression(expression.expression);
      if (!parsed) {
        report.counts.inlineExpressions += 1;
        report.counts.unsupported += 1;
        report.issues.push({
          type: "unsupported",
          line: materialized.slice(0, expression.start).split("\n").length,
          message: `Unsupported inline Dataview expression: ${expression.expression}`,
        });
        continue;
      }

      report.counts.inlineExpressions += 1;
      try {
        const rendered = this.renderKnownInlineExpression(parsed, file, runtime);
        inlineReplacements.push({
          start: expression.start,
          end: expression.end,
          text: core.formatInlineReplacement(rendered, expression),
        });
      } catch (error) {
        report.counts.errors += 1;
        report.issues.push({
          type: "error",
          line: materialized.slice(0, expression.start).split("\n").length,
          message: error.message,
        });
      }
    }
    report.timing.inlineMs += Date.now() - inlineStartedMs;

    materialized = core.applyReplacements(materialized, inlineReplacements);
    report.remaining = core.countRemainingDynamicMarkdown(materialized);
    report.changed = materialized !== original;
    report.timing.totalMs = Date.now() - timingStartedMs;

    return {
      content: materialized,
      changed: report.changed,
      report,
    };
  }

  regenerateHeader(source, file, runtime, headerType) {
    const outputHandler = runtime.customJS.OutputHandler;
    if (!outputHandler) throw new Error("customJS.OutputHandler is not available.");

    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!frontmatter?.tags || !frontmatter?.headerVersion) return source;

    return outputHandler.regenerateHeader(source, file.name, frontmatter, headerType).join("\n");
  }

  addIssue(report, type, block, message) {
    if (type === "unsupported") report.counts.unsupported += 1;
    else report.counts.errors += 1;

    report.issues.push({
      type,
      line: block.startLine,
      endLine: block.endLine,
      language: block.language,
      message,
    });
  }

  renderKnownInlineExpression(parsed, file, runtime) {
    const outputHandler = runtime.customJS.OutputHandler;
    if (!outputHandler) throw new Error("customJS.OutputHandler is not available.");

    const page = runtime.api.page(file.path, file.path);
    const metadata = page?.file?.frontmatter || this.app.metadataCache.getFileCache(file)?.frontmatter || {};

    if (parsed.kind === "pageDatedValue") {
      return outputHandler.outputPageDatedValue(file.basename, metadata);
    }
    if (parsed.kind === "affiliations") {
      return outputHandler.outputAffiliations(file.basename, metadata);
    }
    if (parsed.kind === "whereabouts") {
      return outputHandler.outputWhereabouts(file.basename, metadata);
    }
    if (parsed.kind === "campaignInteractions") {
      return outputHandler.outputCampaignInteractions(file.basename, page, parsed.campaign);
    }

    throw new Error(`Unsupported inline view kind: ${parsed.kind}`);
  }

  async renderDataviewJs(source, file, runtime) {
    const adapter = new CapturingDataviewAdapter(this, runtime.api, runtime.customJS, file.path);
    const result = await adapter.executeSource(source);
    return adapter.renderFinalResult(result);
  }

  async copyVaultToOutput(outputPath, materializedFiles, config) {
    const sourceRoot = this.getVaultBasePath();
    const outputRoot = path.resolve(outputPath);
    const contentByPath = new Map(materializedFiles.map((entry) => [entry.path, entry.content]));

    await fsp.mkdir(outputRoot, { recursive: true });
    await this.copyDirectory(sourceRoot, outputRoot, sourceRoot, contentByPath, config);
  }

  async copyDirectory(currentSource, currentTarget, sourceRoot, contentByPath, config) {
    const entries = await fsp.readdir(currentSource, { withFileTypes: true });
    await fsp.mkdir(currentTarget, { recursive: true });

    for (const entry of entries) {
      const sourcePath = path.join(currentSource, entry.name);
      const relativePath = path.relative(sourceRoot, sourcePath).split(path.sep).join("/");
      if (this.shouldSkipCopyPath(relativePath, entry, config)) continue;

      const targetPath = path.join(currentTarget, entry.name);
      if (entry.isDirectory()) {
        await this.copyDirectory(sourcePath, targetPath, sourceRoot, contentByPath, config);
      } else if (contentByPath.has(relativePath)) {
        await fsp.mkdir(path.dirname(targetPath), { recursive: true });
        await fsp.writeFile(targetPath, contentByPath.get(relativePath), "utf8");
      } else if (entry.isFile()) {
        await fsp.mkdir(path.dirname(targetPath), { recursive: true });
        await fsp.copyFile(sourcePath, targetPath);
      }
    }
  }

  shouldSkipCopyPath(relativePath, entry, config) {
    if (!relativePath) return false;
    const parts = relativePath.split("/");
    if (parts.some((part) => part.startsWith("."))) return true;
    if (entry.isSymbolicLink()) return true;
    if (this.isExcludedVaultPath(relativePath, config, entry.isDirectory())) return true;
    if (entry.name === ".DS_Store") return true;
    return false;
  }
};

class CapturingDataviewAdapter {
  constructor(plugin, api, customJS, currentFilePath) {
    this.plugin = plugin;
    this.api = api;
    this.customJS = customJS;
    this.currentFilePath = currentFilePath;
    this.outputs = [];
    this.app = plugin.app;
    this.settings = api.settings;
    this.io = api.io;
    this.func = api.func;
    this.value = api.value;
    this.widget = api.widget;
    this.luxon = api.luxon;
  }

  async executeSource(source, input) {
    const before = this.outputs.length;
    const func = new Function(
      "dv",
      "input",
      "customJS",
      "app",
      "DataviewAPI",
      `"use strict"; return (async () => {\n${source}\n})()`,
    );
    const result = await func(
      this,
      input,
      this.customJS,
      this.plugin.app,
      this.api,
    );
    if (result !== undefined && result !== null && this.outputs.length === before) {
      this.outputs.push(this.valueToMarkdown(result));
    }
    return result;
  }

  renderFinalResult() {
    return this.outputs.filter((entry) => entry !== "").join("\n\n");
  }

  page(pathLike) {
    return this.api.page(pathLike, this.currentFilePath);
  }

  pages(query) {
    return this.api.pages(query, this.currentFilePath);
  }

  current() {
    return this.api.page(this.currentFilePath, this.currentFilePath);
  }

  array(raw) {
    return this.api.array(raw);
  }

  isArray(raw) {
    return this.api.isArray(raw);
  }

  isDataArray(raw) {
    return this.api.isDataArray(raw);
  }

  fileLink(pathLike, embed = false, display) {
    return this.api.fileLink(pathLike, embed, display);
  }

  sectionLink(pathLike, section, embed = false, display) {
    return this.api.sectionLink(pathLike, section, embed, display);
  }

  blockLink(pathLike, blockId, embed = false, display) {
    return this.api.blockLink(pathLike, blockId, embed, display);
  }

  date(pathLike) {
    return this.api.date(pathLike);
  }

  duration(value) {
    return this.api.duration(value);
  }

  parse(value) {
    return this.api.parse(value);
  }

  literal(value) {
    return this.api.literal(value);
  }

  clone(value) {
    return this.api.clone(value);
  }

  compare(a, b) {
    return this.api.compare(a, b);
  }

  equal(a, b) {
    return this.api.equal(a, b);
  }

  evaluate(expression, context) {
    return this.api.evaluate(expression, context, this.currentFilePath);
  }

  tryEvaluate(expression, context) {
    return this.api.tryEvaluate(expression, context, this.currentFilePath);
  }

  async execute(source) {
    const markdown = await this.api.tryQueryMarkdown(source, this.currentFilePath);
    const normalized = normalizeRenderedMarkdown(markdown);
    this.outputs.push(normalized);
    return normalized;
  }

  async executeJs(source) {
    return this.executeSource(source);
  }

  markdownTable(headers, values, settings) {
    return this.api.markdownTable(
      this.toArray(headers),
      this.toRows(values),
      settings,
    );
  }

  markdownList(values, settings) {
    return this.api.markdownList(this.toArray(values), settings);
  }

  markdownTaskList(values, settings) {
    return this.api.markdownTaskList(this.toArray(values), settings);
  }

  table(headers, values) {
    const markdown = normalizeRenderedMarkdown(this.markdownTable(headers, values));
    this.outputs.push(markdown);
    return markdown;
  }

  list(values) {
    const markdown = normalizeRenderedMarkdown(this.markdownList(values));
    this.outputs.push(markdown);
    return markdown;
  }

  taskList(tasks, groupByFile = true) {
    const values = groupByFile ? tasks : this.toArray(tasks);
    const markdown = normalizeRenderedMarkdown(this.api.markdownTaskList(values, this.settings));
    this.outputs.push(markdown);
    return markdown;
  }

  header(level, text) {
    if (!Number.isInteger(level) || level < 1 || level > 6) {
      throw new Error(`Unsupported dv.header level: ${level}`);
    }
    const markdown = `${"#".repeat(level)} ${this.valueToMarkdown(text)}`;
    this.outputs.push(markdown);
    return markdown;
  }

  paragraph(text) {
    const markdown = this.valueToMarkdown(text);
    this.outputs.push(markdown);
    return markdown;
  }

  span(text) {
    return this.valueToMarkdown(text);
  }

  el() {
    throw new Error("dv.el is not supported by the static materializer.");
  }

  async view(viewName, input) {
    const viewFile = this.resolveViewFile(viewName);
    if (!viewFile) throw new Error(`Dataview view not found: ${viewName}`);

    const source = await this.plugin.readVaultFile(viewFile);
    const before = this.outputs.length;
    const result = await this.executeSource(source, input);
    if (result !== undefined && result !== null && this.outputs.length === before) {
      this.outputs.push(this.valueToMarkdown(result));
    }
    return result;
  }

  resolveViewFile(viewName) {
    const simpleViewPath = `${viewName}.js`;
    const complexViewPath = `${viewName}/view.js`;
    return (
      this.plugin.app.metadataCache.getFirstLinkpathDest(simpleViewPath, this.currentFilePath) ||
      this.plugin.app.metadataCache.getFirstLinkpathDest(complexViewPath, this.currentFilePath)
    );
  }

  toArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (this.api.isDataArray(value) && typeof value.array === "function") return value.array();
    if (typeof value[Symbol.iterator] === "function") return Array.from(value);
    return [value];
  }

  toRows(values) {
    return this.toArray(values).map((row) => this.toArray(row));
  }

  valueToMarkdown(value) {
    if (value === undefined || value === null) return "";
    if (typeof value === "string" || value instanceof String) return String(value);
    if (this.api.value && typeof this.api.value.toString === "function") {
      return this.api.value.toString(value, this.settings);
    }
    return String(value);
  }
}

function normalizeRenderedMarkdown(value) {
  if (value === undefined || value === null) return "";
  return String(value).trimEnd();
}

function recordSlowFile(slowFiles, entry, limit = 25) {
  slowFiles.push(entry);
  slowFiles.sort((a, b) => b.totalMs - a.totalMs);
  if (slowFiles.length > limit) slowFiles.length = limit;
}

function progressPathFor(reportPath) {
  if (!reportPath) return undefined;
  return `${reportPath}.progress.json`;
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = window.setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms while rendering ${label}.`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
