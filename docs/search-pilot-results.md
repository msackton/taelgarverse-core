# Search pilot observations

Measured on 2026-10-19 against the isolated `taelgarverse-search-pilot` instance.
These are exploratory results from the 22-note sample, not a production search
evaluation. See the [operating guide](../experiments/ai-search/README.md) to repeat
the runs or try different questions.

## Independent full-text baseline and optional AI

The same exports are now indexed in the separate D1 database named
`taelgarverse-search-pilot`. The default viewer compares D1 alone with D1 plus
one optional vector-retrieval request. Both use the same visible prose. Exact
title/alias matches are preferred; remaining candidates combine with reciprocal
rank fusion. AI is disabled per search with the checkbox or for the server with
`serve --no-ai`. Index updates remain separate explicit commands.

The 16-query, whole-note run with all-word matching and AI disabled found all
eight name/alias/phrase cases and one paraphrased case: **9/15 positive hits@5**.
It returned no results for the unrelated question. Median D1 response time was
**138.5 ms**, including the management-API network call but excluding harness
startup/authentication. The 16 searches read **333 D1 rows total**, ranging from
2 to 83 per search, and wrote zero rows. The AI request counter stayed unchanged
throughout that run. These are sample measurements, not full-vault estimates.

The five-second bounded-AI comparison found **12/15 positive hits@5** versus
D1's 9/15, and both rejected the unrelated question. D1's median was 166.5 ms;
the enhanced response median was about 3.8 seconds. **Six of 16 AI attempts timed
out**, preserving the D1 ordering and excerpts. An earlier three-second trial
had a different set of timeouts and 13/15 enhanced hits; these sequential runs
are not a controlled comparison of timeout values. Provider latency needs more
observation before choosing production behavior. The browser check separately
found Session 96 for the vampire-castle question with AI enabled and showed
identical full-text results with zero AI attempts when disabled.

A second server started with `--no-ai` also rejected an explicitly requested
AI-only query. Even a client sending `ai: true` received identical D1 results in
both layered columns; the AI request counter remained unchanged. Local tests
cover provider/quota failure, stale or foreign AI results, and timeout/abort
fallback. The pilot comparison waits for the optional AI attempt before showing
both columns; a production interface could display baseline results immediately.

The initial 22-note D1 upload reported **90 rows written**, including index work,
and a **393,216-byte** database. With the passage and visibility exports plus
diagnostic activity, the database remained about 1.2 MB. Successful D1 responses
record row reads/writes, SQL time, and storage separately from the AI budget.
The sample is comfortably below the published included D1 allowances; account
usage and the full corpus still need measurement. See [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

All **eight live D1 visibility checks** and **five update/delete checks** passed.
The real API also rolled back an intentionally failed diagnostic transaction,
preserving the active digest. An unchanged sync sent zero documents and wrote
zero rows. Diagnostic copies were removed afterward. SQLite-backed tests cover
weighted ranking, phrases, apostrophes, edits/deletions, transaction rollback,
stale excerpts, scope isolation, and refusal to initialize a foreign schema.

D1 FTS5's BM25 statistics span the database, including the alternate exports;
as with the AI-only keyword comparisons below, rankings are exploratory. The
pilot is still restricted to fixed exported views and the selected notes.

## Retrieval

The final query set contains eight name/alias/phrase cases, seven paraphrased
questions, and one unrelated question. A positive hit means at least one expected
source is among the first five distinct source pages; it does not score every
excerpt or require the right source to rank first. Keyword matching required all
terms. Query rewriting, generation, and response caching were disabled.

| Corpus and settings | Keyword hits | Vector hits | Hybrid hits | Unrelated question |
| --- | --- | --- | --- | --- |
| Whole notes, minimum score 0.4 | 8/15 | 14/15 | 14/15 | No results in all modes |
| 600-token passages, minimum score 0.4 | 8/15 | 14/15 | 14/15 | No results in all modes |
| Whole notes, reranking, minimum score 0.4 after reranking | 8/15 | 13/15 | 13/15 | No results in all modes |

The earlier 13-positive-question baseline with a zero threshold found all 13
expected sources with vector and hybrid retrieval, but returned weak matches for
the unrelated electric-car question. Its strongest unrelated vector score was
about 0.28. Raising the threshold to 0.4 rejected that question but also removed
Session 96 for the question about who accused Delwath of an attack in Chardon.
Reranking recovered that source, while rejecting useful sources for two other
questions. A universal 0.4 cutoff is therefore not established by this experiment.

Hybrid retrieval found Session 96 for paraphrased questions about entering the
vampire's castle and creating a distraction, while keyword-only AND matching
returned no pages. Exact names and aliases were generally found, but the exact
article was not always first. Title/alias preference and relevance calibration
still deserve review before production integration.

Hybrid median request times in these runs were approximately 1.1 seconds for
whole notes, 1.4 seconds for passages, and 2.7 seconds with reranking. These times
exclude the local harness's authentication/startup work. Cold requests, active
indexing, shared keyword statistics, and sequential request order make these
observations unsuitable as a controlled performance benchmark.

## Chunking and updates

| Export | Prepared tokens, including prefixes | Uploaded documents | Actual indexed chunks |
| --- | --- | --- | --- |
| Whole notes; managed chunk size 800, no overlap | 43,170 | 22 | 79 |
| Our heading/paragraph passages; target 600, no overlap | 44,377 | 140 | 140 |

Our passage prefixes added about 2.8% to the prepared token count. There was no
measured hit@5 improvement on this query set. Smaller passages may still help
excerpts and future visibility rules; the experiment does not establish a best
production chunking strategy.

The live update probe passed all five marker checks: original text and a second
document were initially searchable, edited text became searchable, old text
disappeared, and the deleted document's marker disappeared. A subsequent unchanged
upload sent zero documents and reserved zero ingestion tokens. The two diagnostic
copies were cleaned up; source vault files were untouched.

Initial indexing and reindexing took minutes, with a long tail. Some batches
required resuming the readiness check after its timeout. Resumption retained
completed and pending uploads instead of sending the corpus again. Index readiness
and publication coordination need an explicit production design.

Prepared-token counters are local reservations, including repeat uploads and
failed/unknown attempts. They are not Cloudflare's ingestion billing meter; the
stats response used here exposes item/chunk counts rather than billed tokens.

## Visibility and scope

The local tests cover excluded/future pages, campaign/date/DM prose, unsafe
comments, nonexpansion of embeds, stale excerpts, and batch/view isolation.
The live visibility corpus uses Rhodar, Ursk, Elemental Plane of Fire, and
Twilight Promontory in six exported views. All eight live checks passed: a
campaign-only term, two date cutoffs, and DM-only text were searchable in their
intended views and absent in their paired hidden views. Metadata filters were
applied before retrieval.

The original Rodnya Kinzal DM sample contained an unmaterialized Dataview query,
not searchable DM prose. The exporter correctly omitted that code; Ursk's
authored DM comment supplies the meaningful live comparison instead. Search of
materialized query output requires an existing prepared export and remains a
separate check.

The main 22-note sample and fixed exported views are the entire indexed scope.
The production Worker, production search UI, publisher, and publication bucket
have not been integrated with this index. Arbitrary dates and campaign subsets,
production passage policies, rollback, and release coordination remain open.
