# Running the AI Search pilot

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
Required permissions are AI Search Edit and Run. Run project-local Wrangler
`whoami`/`login` if authentication needs attention.

## First comparison

From the core repository:

```powershell
npm run search:pilot -- prepare
npm run search:pilot -- upload --dry-run
npm run search:pilot -- init
npm run search:pilot -- upload
npm run search:pilot -- compare
npm run search:pilot -- serve
```

`prepare` reports the batch ID, token count, and manifest path. Review the exact
payloads in that batch's `documents` directory. `init` creates only the fixed
`taelgarverse-search-pilot` instance, using built-in storage, hybrid indexing,
800-token managed chunks, and zero managed overlap. It rejects incompatible
existing configuration instead of changing another index.

`upload` updates changed documents and waits for indexing. It can take several
minutes, especially initially. Rerunning it resumes pending items and skips
completed content with the same hash. A completed receipt is required to search.
Cloudflare's actual chunk count is recorded in that receipt.

The viewer runs at [127.0.0.1:8770](http://127.0.0.1:8770/). It compares keyword,
vector, and hybrid results and offers reranking and a minimum-score control.
Source links open the matching context on the live reference site. A different
source site can be set with `siteUrl` in the pilot config. This does not modify
the source site. Restart the viewer after changing its code; refresh the browser
to list newly uploaded batches.

`compare` runs the checked-in query set, saving JSON and an HTML report. Its
default threshold is zero to expose weak matches for evaluation. The viewer
starts at 0.4; neither setting is a production ranking decision. A hit@5 checks
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
npm run search:pilot -- prepare --style passages --chunk-tokens 600
npm run search:pilot -- upload --dry-run
npm run search:pilot -- upload
npm run search:pilot -- compare
npm run search:pilot -- compare --rerank --threshold 0.4
npm run search:pilot -- query --query "Where did the adventurers infiltrate a vampire lord's castle?"
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
npm run search:pilot -- prepare --pilot experiments/ai-search/visibility.json --views public-all,public-none,dm-all,before-fire,after-fire,before-door
npm run search:pilot -- upload
npm run search:pilot -- probe-visibility
npm run search:pilot -- probe-updates --batch <main-sample-batch-ID>
```

The visibility corpus uses four of the selected notes in six fixed views. The
probe tests real campaign-only prose, DM comments, and date transitions using
metadata filters before retrieval. These fixed rendered views are a pilot
technique, not support for arbitrary production contexts.

The update probe creates two diagnostic copies in a separate run, adds synthetic
search markers, edits one copy and deletes the other, and verifies both outcomes.
It then checks that an unchanged upload sends no content, and removes its own
diagnostic documents. The vault is never edited. If interrupted, its saved
diagnostic manifest permits an explicit reset by batch ID.

## Limits, artifacts, and cleanup

All prepared text, usage reservations, upload receipts, and results live under
the ignored `.cache/ai-search-pilot`. DM exports and results can include DM prose;
do not publish that cache. No credentials are stored there.

The defaults allow 25 selected notes, 100,000 prepared tokens per batch, one
million cumulative reserved ingestion tokens, and 500 search requests per
account. Each comparison of three modes spends three requests. Attempts are
reserved before the request, including failures or unknown outcomes. These are
conservative local counters, not Cloudflare's billing meter or an account-level
spend cap. Actual indexed tokens can differ after managed chunking. Review usage
before changing limits; reranking uses the same request count.

```powershell
npm run search:pilot -- status
npm run search:pilot -- reset --batch <ID>
```

Reset deletes only built-in documents bearing the pilot ownership marker and
the specified run ID. It preserves cumulative usage counters, local reports,
and the instance. It cannot delete production content or delete the instance.
Query rewriting and answer generation are always disabled in this harness.
