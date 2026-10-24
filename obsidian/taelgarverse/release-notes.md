Taelgarverse 0.6.0

## Keep the GitHub Pages site working with native Taelgarverse blocks

This release adds an opt-in static materializer inside the Taelgarverse plugin. It lets the existing github.io site keep using its Python exporter, MkDocs configuration, theme, and GitHub Pages workflow as vault notes adopt native Taelgarverse features.

- `taelgar-header` becomes a complete Markdown header, without duplicating an existing saved header.
- `taelgar-index` becomes a dated Markdown table. Grid indexes use a table fallback; blocks marked `show: obsidian` are omitted from the static website.
- Explicit `taelgar-interactions` blocks become campaign headings and Markdown event/source links.
- `taelgar-map` becomes `leaflet`, retaining the map configuration. This lets the old exporter recognize those maps again and include their images and tiles.
- Existing Dataview queries, supported DataviewJS, inline expressions, and saved legacy headers continue through the legacy Dataview/CustomJS materialization path.

Installing 0.6.0 does not select this materializer automatically. The original standalone materializer and vault CLI remain available, and the old publication wrapper still selects them by default. No source-note migration is required; exports write to a separate directory and never rewrite the vault.

## Try a local export

Enable and reload Taelgarverse 0.6.0 in the source vault. Keep Dataview and CustomJS enabled and let their indexes/scripts finish loading. Enable Obsidian's command line interface under Settings → General → Advanced.

The CLI lives in an updated `taelgarverse-core` checkout; it is not installed by the plugin download. From core, install dependencies with `npm ci` if needed, then export to a disposable directory outside the vault:

```sh
npm run materialize:static -- --vault ../taelgar --out ../taelgar-static-test --date 1750-01-01 --no-strict
```

Use the date you want the static site to represent. The default header format remains `website`, matching the legacy wrapper; `--header-type static` selects the plain static format. If `obsidian` is not on PATH, add `--obsidian-command PATH`; use `--obsidian-vault NAME_OR_ID` when explicit vault selection is needed.

This command only creates local export files and a materialization report. It does not build, commit, push, or publish a website. `--no-strict` matches the old wrapper's default: failed or unsupported blocks remain in partial output and are reported. Omit it, or use `--strict`, to stop output when a query/block fails. Review the report before using an export.

The full static mode retains the legacy unsupported chronology-scan and DOM-dependent DataviewJS boundaries. It does not repair malformed queries or invalid vault comment syntax, which can still stop the downstream Python exporter.

## Select it in the existing github.io pipeline

The existing `autobuild_website.sh` already accepts a materializer override. With core beside the `taelgarverse` repository, run this from `taelgarverse` in its existing shell environment:

```sh
TAELGAR_MATERIALIZER="$PWD/../taelgarverse-core/scripts/materialize-static.mjs" ./autobuild_website.sh build
```

Only the materializer changes. The same static output directory, Python exporter, configuration, and MkDocs/GitHub Pages stages remain in use. The wrapper rebuilds its configured static output, so use separate standalone exports for the initial comparison. `build` materializes and exports locally; the wrapper's existing setup still pulls `taelgar-utils`. Its `deploy` and `publish` commands retain their existing commit/push behavior.

The override affects `materialize`, `build`, and `deploy`. It does not refresh materialization for `export`, `serve`, or `publish`, which consume an existing static tree. An inline assignment applies to that one invocation; unset an exported override to return to the original materializer.

## Convert the old pipeline when ready

1. Keep the original plugin and CLI installed while testing. Export the same vault with both materializers to different directories, using the same date, header format, and downstream export settings.
2. Compare reports and Markdown, then run the existing Python export and MkDocs preview against each output. Expect `taelgar-map` → `leaflet` differences and intentional Markdown output where native blocks were previously left unprocessed. Check map assets, headers, index rows, and query failures.
3. Once the comparison is accepted, persist `TAELGAR_MATERIALIZER` in the publishing environment, or change only the wrapper's default `MATERIALIZER` path to core's `scripts/materialize-static.mjs`. Keep the remaining build stages and GitHub Pages destination unchanged. Make this change on each publishing machine; plugin updates alone do not change the wrapper.
4. Retire the old standalone plugin/CLI only after the switched pipeline has been validated. Until then, unsetting the override or restoring the old default provides rollback.

Local full-vault comparison found the same legacy query failures in both materializers. After accounting for map-fence conversion, the downstream exports differed only where existing native settlement indexes now became Markdown tables. Two pre-existing malformed comment blocks required identical temporary exclusions to complete that downstream comparison; a clean default build still requires those source-content issues to be resolved.

## Optional Obsidian backend for taelgar.org

The plugin also exposes a DQL-only service for core's `--materializer obsidian` website option. It delegates selected queries, including chronology DQL, to the installed Dataview plugin. Node then handles compatibility conversion and the remaining website preparation. This mode preserves native blocks for dynamic rendering and does not execute arbitrary DataviewJS. The full static mode's legacy restrictions do not apply to this DQL-only service.

Node remains the default taelgar.org backend, with its separate query limitations and pinned Dataview cache. Switching the github.io materializer does not switch the taelgar.org backend. See the [pipeline guide](https://github.com/msackton/taelgarverse-core/blob/main/docs/publishing-pipelines.md) for both workflows.

Desktop only. The minimum app version remains Obsidian 1.8.0. This is a minor release for new opt-in export functionality; existing authoring settings and pipeline defaults are retained.
