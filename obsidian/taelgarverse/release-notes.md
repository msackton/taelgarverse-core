Taelgarverse 0.6.1

- Fix native `taelgar-header` blocks in the opt-in static materializer so they honor `--header-type website`, including the CLI's default. They now use the GitHub Pages header cards, icon markup, and pronunciation styling instead of always exporting a plain Markdown callout.
- Keep `--header-type static` producing the existing Markdown information callout. Native headers are materialized once; saved legacy headers keep their existing CustomJS path.
- Preserve an authored H1 immediately above `taelgar-header` and omit the generated title, avoiding duplicate titles in Obsidian and retaining custom titles on the website and in static exports. Both `# Title` and an H1 underlined with `===` work, with optional blank lines before the block. Pronunciation, header details, and index controls still render.

Reload Taelgarverse after updating, then rerun the existing static export. The CLI and `TAELGAR_MATERIALIZER` overrides introduced in 0.6.0 continue to work; no vault-note edits or pipeline migration are required for this fix. A new local build is needed to refresh previously exported native headers.

The original standalone materializer remains the old pipeline's default. Selecting Taelgarverse is still opt-in; see the [pipeline guide](https://github.com/msackton/taelgarverse-core/blob/main/docs/publishing-pipelines.md) for the override and local comparison steps.

Desktop only. The minimum app version remains Obsidian 1.8.0.
