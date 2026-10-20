# Running the search pilot

This is an isolated experiment, separate from the production Worker, search UI,
content publisher, and R2 publication bucket. It uses only the explicit allowlist
in `pilot.json`. The [pilot plan](../../docs/search-pilot.md) records scope and
the remaining decisions before production integration.

Install the locked dependencies with `npm ci`. Local preparation uses the normal
vault configuration and does not contact Cloudflare or invoke Obsidian. Remote
commands use `CLOUDFLARE_API_TOKEN`, if set, or capture the existing project-local
Wrangler login in memory. The token is never printed, saved in reports, or sent
to the browser. `CLOUDFLARE_ACCOUNT_ID` selects an account; otherwise the ignored
`wrangler.local.json` account or a single account reported by Wrangler is used.
Required permissions are D1 Write for baseline setup/updates (D1 Read suffices
for querying an existing index), and AI Search Edit and Run for the optional AI
commands. Run project-local Wrangler
`whoami`/`login` if authentication needs attention.

## First comparison

From the core repository:

```powershell
node experiments/ai-search/cli.mjs prepare
node experiments/ai-search/cli.mjs baseline-upload --dry-run
node experiments/ai-search/cli.mjs baseline-upload
node experiments/ai-search/cli.mjs compare --engine baseline --no-ai
node experiments/ai-search/cli.mjs serve --no-ai
```

This creates only the D1 database named `taelgarverse-search-pilot`, with an
ownership marker and FTS5 index. It indexes the already filtered export, with
title/alias weighting, exact-name preference, matching excerpts, and source-page
deduplication. Quoted phrases are supported; matching requires all words by
default. Choose **Any word** or `--keyword-match or` to broaden it. D1 is
independent of AI Search: no AI instance or completed AI upload is required.
There is no production D1 binding. The local harness uses the management API;
production should use a Worker binding.

To add semantic retrieval, stop the viewer and run:

```powershell
node experiments/ai-search/cli.mjs upload --dry-run
node experiments/ai-search/cli.mjs init
node experiments/ai-search/cli.mjs upload
node experiments/ai-search/cli.mjs compare
node experiments/ai-search/cli.mjs serve
```

`prepare` reports the batch ID, token count, and manifest path. Review the exact
payloads in that batch's `documents` directory. `init` creates only the fixed
`taelgarverse-search-pilot` instance, using built-in storage, hybrid indexing,
800-token managed chunks, and zero managed overlap. It rejects incompatible
existing configuration instead of changing another index.

`upload` updates changed documents and waits for indexing. It can take several
minutes, especially initially. Rerunning it resumes pending items and skips
completed content with the same hash. Cloudflare's actual chunk count is recorded
in the receipt. A completed AI receipt is required for original AI-only searches;
missing or stale AI uploads fall back
to the independently synced D1 batch in layered mode.

The viewer runs at [127.0.0.1:8770](http://127.0.0.1:8770/). Its default comparison
is **D1 full-text** against **D1 + semantic**. Both columns share one D1 query;
the enhanced column optionally adds one vector retrieval request and combines
page ranks using reciprocal-rank fusion (constant 60). Exact titles and aliases
retain preference. Provenance labels identify full-text and semantic matches.
AI-disabled and failure results retain the original D1 ordering and excerpts.

Uncheck **Enable AI** to make zero AI calls. `serve --no-ai` enforces this for the
entire server, even if a client requests AI; original AI-only modes are rejected.
Provider errors, quota/budget failures, missing AI uploads, stale/out-of-view AI
results, and a five-second timeout preserve D1 results with an explanatory status.
`--ai-timeout-ms 10..30000` changes that timeout. D1 is required for layered mode;
its failures remain explicit. The comparison response waits for the optional AI
attempt, so the displayed D1 column also waits when comparing. Baseline-only mode
does not wait for AI. Production could display the baseline before enrichment.

The original keyword/vector/hybrid comparisons remain in the engine dropdown
and with `--engine ai`. For compatibility, an explicit `--mode` without an
`--engine` also selects the original AI path. Reranking and the minimum-score
control apply only to AI.
Source links open the matching context on the live reference site. A different
source site can be set with `siteUrl` in the pilot config. This does not modify
the source site. Restart the viewer after changing its code; refresh the browser
to list newly uploaded batches.

`compare` runs the checked-in query set, saving JSON and an HTML report. Its
default engine is the layered comparison and its AI threshold is 0.4. Use
`--engine baseline`, `--engine enhanced`, or `--engine ai`; the original AI-only
CLI comparison defaults to a zero threshold. The viewer starts at 0.4; neither
setting is a production ranking decision. A hit@5 checks
whether at least one expected source appears, not whether every excerpt is
useful or every answer is correct. Keyword retrieval defaults to requiring all
terms; `--keyword-match or` allows the alternative.

With reranking on, retrieval keeps a broad candidate pool and the selected
threshold applies to the reranker. Scores from different modes or reranking are
not interchangeable. Batches share one instance and its keyword statistics;
finish indexing before comparing runs, and treat these small-sample observations
as exploration rather than a controlled production benchmark.

## Change one variable at a time

```powershell
node experiments/ai-search/cli.mjs prepare --style passages --chunk-tokens 600
node experiments/ai-search/cli.mjs baseline-upload
node experiments/ai-search/cli.mjs upload --dry-run
node experiments/ai-search/cli.mjs upload
node experiments/ai-search/cli.mjs compare
node experiments/ai-search/cli.mjs compare --rerank --threshold 0.4
node experiments/ai-search/cli.mjs query --query "Where did the adventurers infiltrate a vampire lord's castle?"
```

Use `--batch <ID>` on remote commands to select a particular prepared batch;
otherwise the last prepared batch is selected. `--views` selects fixed exported
views during preparation and one view during querying/comparison. The normal
sample defaults to `public-all` at 1750-01-01. A different passage size or overlap
creates another batch. `--overlap-tokens` adds overlap only within a section and
is capped at 30% of the requested passage size. Passage titles, aliases, and
section prefixes count toward the budget. Cloudflare may split our passages
further.

An alternate `--pilot <JSON>` must provide an explicit `notes` allowlist, `views`,
and `limits`. Give it a distinct `experiment` name to keep a different corpus
independent of the main sample. Editing source content retains stable document
keys; changing the allowlist within the same experiment replaces that run's
membership when next uploaded. `--source <existing export directory>` can read
materialized copies instead of the vault without invoking the materializer.

## Visibility and update checks

```powershell
node experiments/ai-search/cli.mjs prepare --pilot experiments/ai-search/visibility.json --views public-all,public-none,dm-all,before-fire,after-fire,before-door
node experiments/ai-search/cli.mjs upload
node experiments/ai-search/cli.mjs baseline-upload
node experiments/ai-search/cli.mjs baseline-probe-visibility
node experiments/ai-search/cli.mjs probe-visibility
node experiments/ai-search/cli.mjs baseline-probe-updates --batch <main-sample-batch-ID>
node experiments/ai-search/cli.mjs probe-updates --batch <main-sample-batch-ID>
```

The visibility corpus uses four of the selected notes in six fixed views. The
probe tests real campaign-only prose, DM comments, and date transitions using
metadata filters before retrieval. These fixed rendered views are a pilot
technique, not support for arbitrary production contexts.

The update probes create two diagnostic copies from the first exported view in
a separate run, add synthetic
search markers, edits one copy and deletes the other, and verifies both outcomes.
It then checks that an unchanged upload sends no content, and removes its own
diagnostic documents. The vault is never edited. If interrupted, its saved
diagnostic manifest permits an explicit reset by batch ID. The D1 probe also
verifies real REST batch rollback with an intentionally failed diagnostic
transaction. D1 updates, obsolete-row deletion, and the batch digest commit
together. An unchanged sync performs reads but sends no content and writes no
rows. D1 test coverage uses real SQLite FTS5, with no remote calls; on Node 22.12,
enable `node:sqlite` with `NODE_OPTIONS=--experimental-sqlite` before `npm test`.

## Limits, artifacts, and cleanup

All prepared text, usage reservations, upload receipts, and results live under
the ignored `.cache/ai-search-pilot`. DM exports and results can include DM prose;
do not publish that cache. No credentials are stored there.

The defaults allow 25 selected notes, 100,000 prepared tokens per batch, one
million cumulative reserved ingestion tokens, and 500 search requests per
account. Each original AI comparison of three modes spends three requests;
the layered comparison reserves at most one AI request. Attempts are
reserved before the request, including failures or unknown outcomes. These are
conservative local counters, not Cloudflare's billing meter or an account-level
spend cap. Actual indexed tokens can differ after managed chunking. Review usage
before changing limits; reranking uses the same request count.

D1 has a separate 500-SQL-request reservation budget per account under `d1/usage`;
it does not consume the AI request or token allowance. Setup, sync, queries, probes,
and resets count toward it, including failed attempts. Reported `rows_read`,
`rows_written`, SQL duration and database size accumulate under `d1/metrics` and
appear in results/status. These measure successful SQL responses, including
FTS/index work; they are distinct from request counts and are not account billing
caps. The viewer's AI attempt count includes attempts rejected before an API call;
the AI ledger reserves only after readiness checks and before the request.

Queries and indexing have independent controls. Disabling AI queries does not
delete its index or stop its ingestion. Run `baseline-upload` as needed and omit
`upload` to maintain only D1. Re-enabling AI requires explicitly syncing its batch;
missing/stale local receipts trigger full-text fallback. Keep the stored index
within included usage or explicitly reset its documents if it is no longer wanted.

```powershell
node experiments/ai-search/cli.mjs status
node experiments/ai-search/cli.mjs baseline-status
node experiments/ai-search/cli.mjs reset --batch <ID>
node experiments/ai-search/cli.mjs baseline-reset --batch <ID>
```

Reset deletes only built-in documents bearing the pilot ownership marker and
the specified run ID. It preserves cumulative usage counters, local reports,
and the instance. It cannot delete production content or delete the instance.
`baseline-reset` removes only that run's D1 rows and receipt. It retains other
runs, the D1 database, AI documents, and cumulative counters. Query rewriting
and answer generation are always disabled in this harness.
