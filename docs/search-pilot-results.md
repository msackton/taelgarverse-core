# AI Search pilot observations

Measured on 2026-10-19 against the isolated `taelgarverse-search-pilot` instance.
These are exploratory results from the 22-note sample, not a production search
evaluation. See the [operating guide](../experiments/ai-search/README.md) to repeat
the runs or try different questions.

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
