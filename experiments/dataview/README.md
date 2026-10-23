# Dataview comparison harness

Local experiment for running the **actual Dataview 0.5.68 engine** in Node and
comparing it with the installed Obsidian plugin. Plain fenced DQL only. Timeline
queries are excluded; DataviewJS is never executed. Nothing here publishes
content, starts Cloudflare tools or changes notes. The harness uses the same
maintained adapter in `src/dataview-node` as the Node website publisher.

## Run

From the core checkout, prepare a new run directory:

```powershell
node experiments/dataview/harness.mjs prepare --vault ../taelgar --out .cache/dataview-harness/example
node experiments/dataview/harness.mjs node --run .cache/dataview-harness/example
```

`prepare` uses the configured vault when `--vault` is omitted. It selects queries
from website notes, honoring folder exclusions and `excludePublish: all`, but
freezes **all** non-hidden vault Markdown for the Dataview index. That includes
Worldbuilding and underscore folders. `--scope vault` also selects maintenance
queries. Timeline detection currently recognizes the vault's `file.lists` queries
using `events.text` or `events.DR`; inspect `request.json` for every exclusion.
Malformed closed queries stay in the corpus so errors can be compared too.

This full-vault index is a diagnostic choice. Website publication prunes
underscore folders and `.nopublish` subtrees before copying and indexing;
queries depending on those notes can differ from this harness and Obsidian.

For a live baseline, enable Obsidian's command line interface, open the same vault,
and wait for Dataview to finish indexing:

```powershell
node experiments/dataview/harness.mjs capture --run .cache/dataview-harness/example --obsidian "C:/Program Files/Obsidian/Obsidian.com"
node experiments/dataview/harness.mjs node --run .cache/dataview-harness/example --index captured
node experiments/dataview/harness.mjs compare --run .cache/dataview-harness/example --index captured
node experiments/dataview/harness.mjs compare --run .cache/dataview-harness/example
```

Omit `--obsidian` if `obsidian` is on PATH. `--vault` on `capture` selects an
Obsidian vault name; `--vault` on `prepare` is a filesystem path. Alternatively,
execute the generated `capture-code.txt` in Obsidian's developer console. The
capture script calls the running Dataview plugin directly; Taelgarverse need not
be installed or reloaded. Capture refuses to overwrite an existing baseline;
prepare a new directory to repeat an experiment.

If plugin settings differ from the saved settings, rerun the filesystem `node`
command after capture. It then uses the captured settings. Each comparison writes
`comparison-filesystem.json` / `.md` or `comparison-captured.json` / `.md`, and
exits with status 1 for differences or index errors. `matching-empty` and
`matching-error` are separate outcomes; they do not establish that a query
produces useful website content.

## What the two comparisons establish

**Captured index replay** hydrates the plugin's actual page metadata, tags,
forward/inverse link maps, iteration order, resolved links, starred state, and
observed link resolutions in Node. This isolates engine/host compatibility from
metadata extraction. Unobserved host resolutions fail explicitly. Capturing the
exact inverse maps matters: reconstructing them from current pages can change
ordering or erase inconsistent cached backlinks present in the running plugin.

**Filesystem index** reads the frozen source files, constructs approximate
Obsidian `CachedMetadata`, then uses Dataview's own embedded importer and query
engine. It runs with Obsidian closed and needs no captured index. This measures
the remaining Markdown metadata and link-resolution work. Ambiguous filename
guesses and indexing failures are retained in `node-filesystem.json`.

The comparator checks typed values (including link targets, aliases, dates,
zones, durations and nulls), table headers, row order, Markdown, and error text.
An order difference with otherwise identical rows is labeled `row-order`, not
silently accepted. Query IDs/hashes, full source inventory/hash, engine hash,
settings, time, locale and zone guard against comparing different inputs. Live
capture checks source bytes before and after evaluation, index freshness, and
the index revision. Results come from both `tryQuery` and `tryQueryMarkdown`.

## Boundaries and next steps

- The private bundle seams are pinned to version **and SHA-256** in `src/dataview-node/bundle.mjs`.
  The installed bundle is read from `.obsidian/plugins/dataview` by default;
  `prepare --dataview DIRECTORY` can use a copy containing `main.js`,
  `manifest.json`, and optional `data.json`. This harness keeps its explicit
  installed-bundle capture workflow. Website publication instead defaults to a
  verified GitHub download cached locally, independently of the vault's plugin.
  Review and update the loader before changing that pin.
- Node loads the trusted bundle in a VM context without starting its plugin,
  UI, IndexedDB, workers, or timers. UI-only declarations have minimal stubs;
  unsupported host calls throw. This VM is a compatibility mechanism, not an
  untrusted-code sandbox. CSV/network queries are outside this experiment.
- The filesystem adapter uses markdown-it plus a small Obsidian syntax adapter.
  HTML, comments, blockquotes, list positions, Markdown links, and ambiguous
  filenames can differ from Obsidian. A matching corpus is evidence about those
  queries, not a complete Obsidian API implementation.
- Equal sort keys can yield different row order because the two indexes were
  populated differently. Add explicit tie sorts to authored queries only after
  reviewing the results. This harness never rewrites them.
- Frozen sources and complete index captures stay in ignored `.cache` folders
  and can contain unpublished vault data. Only the harness code belongs in Git.

Meaningful portable checks, plus a real-engine synthetic integration test when
the local Dataview installation exists:

```powershell
node --test tests/dataview-harness.test.mjs
```

Use the failures to extend the metadata adapter one concrete case at a time.
The website publisher now uses the same pinned adapter. Keep new corpus probes
and capture diagnostics isolated here, and review dependency changes explicitly.

## Local evidence: October 23, 2026

Tested the 26 non-timeline queries from website notes against Dataview 0.5.68,
indexing 5,518 vault Markdown files. Captured-index replay matched every typed
result and Markdown output: 18 nonempty results, seven empty results, and the
same existing parsing error in `People/PCs/PCs.md` (`LIST from`).

The filesystem adapter matched 25 queries exactly. The remaining query, in
`People/Halflings/Harriet Goodbarrel.md`, returned the same two rows in reverse
order. Its sort uses species alone, so both rows have the same sort key. This
remains a reported difference; no source note was edited. A discovered backlink
difference was fixed by retaining wiki links inside `%%` comments, as Obsidian's
metadata index does. Building the filesystem index took about 22 seconds; replay
of the captured index took about 1.3 seconds (excluding bundle/JSON loading).

These results support a small Node metadata adapter plus Dataview's existing
engine for this corpus. They do not establish parity for all DQL or establish
that the seven empty queries still express the intended content.
