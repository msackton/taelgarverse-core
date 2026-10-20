# AI Search pilot

This is Phase 3 presentation work under [P-04: Better search](roadmap.md#p-04-better-search).
The completed MVP full-text implementation is documented in [production search](search.md).

**Status:** Pilot tooling implemented, 2026-10-19. The separate Cloudflare
`taelgarverse-search-pilot` instance contains the 22-note sample. Initial retrieval,
chunking, visibility, and update experiments are complete and ready for user review.
An independent D1 FTS5 baseline now supports full-text search with optional AI
enrichment, per-search/server disabling, and provider/timeout fallback. Production
integration remains deferred. See the [operating guide](../experiments/ai-search/README.md).
The [pilot observations](search-pilot-results.md) record the measured results and
remaining limitations.

## Goal

Evaluate hybrid search for exact names/phrases and meaning-based questions before
indexing the full website. Return ranked source pages and excerpts. Generated
answers are outside the initial experiment.

Keep full-text search usable without AI Search. Index the same prepared sample
in D1, prefer exact titles/aliases, and compare D1 alone with D1 plus vector
retrieval. AI queries and AI indexing have separate controls; a disabled or
unavailable AI layer must preserve baseline results. This is implemented in the
isolated harness, with production integration still deferred.

## Sample

Use an explicit, editable allowlist of roughly 20–25 notes. Never expand it
automatically by following links, scanning a folder, or crawling the site.

Selected starting set:

- Dunmari Frontier Sessions 95, 96, and 97.
- Rhodar von Glauer, Shadowkeep, Voknaz Manor, Drachen Peak, Rodnya Kinzal,
  Wellby, Seeker, Delwath, Kenzo, Lyra, Ursk, Chardon, Apollyon, Putrid Agnes,
  and Mirror of Soul Trapping.
- Addermarch Session 01 and Cha'mutte as comparison material.
- Elemental Plane of Fire and Twilight Promontory for date-dependent prose.

The first 20 notes above contain **68,060 authored Markdown tokens** with
`cl100k_base`, before filtering, parsing, or overlap. Adding the two date examples
should keep the source sample near 70,000 tokens. Count the actual export before
each upload; source size is not the same as billable ingestion.

This gives us connected session material, short reference pages, long biographies,
aliases, ordinary DM comments, Campaign:none blocks, campaign-specific prose, and
before/after date text. The sample can be replaced without changing site code.

## Experiment steps

1. **Prepare locally.** Resolve the allowlist to exact vault paths, export copies,
   and produce a manifest with source hashes, context, titles/aliases, source page
   URLs, document IDs, and token counts. Reuse the renderer's authored-body,
   availability, and comment rules. Omit generated headers, unpublished notes,
   administration blocks, and unsafe sources. Keep note embeds as references so
   they cannot pull unselected notes into the corpus. Use only the existing
   prepared export when materialized query output matters; preparing this pilot
   must not automatically invoke the vault materializer.
2. **Index one small batch.** Use a separate `taelgarverse-search-pilot` instance
   with built-in storage and explicit uploads. Do not connect the publication R2
   bucket or enable a website crawler. Start with one recorded Custom context,
   date 1750-01-01, all campaigns, DM off. Wait for indexing completion and report
   failures before querying.
3. **Compare retrieval.** Use a local harness to run the same queries through
   keyword, vector, and hybrid retrieval. Show source pages, excerpts, scores,
   latency, and the settings used, side by side. Start with query rewriting,
   generation, and reranking disabled. Compare reranking separately once the
   baseline is recorded. Retain machine-readable results for repeatable runs.
4. **Compare chunking.** Test cleaned whole-note uploads against our own
   heading/paragraph passages. Try a small number of configurations, initially
   around 400–800 tokens per passage and zero overlap; compare modest overlap
   within the same visibility boundary if needed. Record Cloudflare's actual
   chunk counts as well as our prepared passage counts. AI Search may split
   uploaded passages further.
5. **Test contexts.** Add explicitly named export views for campaign subsets,
   all campaigns, DM on/off, and dates on either side of real cutoffs. Filter by
   experiment/view metadata *before retrieval*, then verify returned sources and
   excerpts. A few duplicated rendered views are acceptable for this small
   experiment; they are not the proposed production solution for arbitrary dates
   and campaign combinations.
6. **Test updates.** Edit one exported copy and remove another, leaving the vault
   untouched. Confirm the new text becomes searchable, removed text disappears,
   unchanged documents are retained, and indexing failures are visible. Measure
   update latency and available ingestion usage before promising incremental
   indexing costs. Keep experiment IDs separate so old batches cannot pollute
   comparisons.

The harness is separate from the ongoing UI redesign. Credentials remain in the
local environment; the production Worker, search box, and publisher stay outside
the pilot. The implemented CLI covers preparation, explicit upload, querying,
comparison, live probes, and an explicit reset of the pilot's own documents.

## Evaluation and limits

Build a short query set with expected pages before tuning settings:

| Cases | What to inspect |
| --- | --- |
| Exact names, aliases, apostrophes, and phrases | Correct source ranks near the top; distinguish alias matching from approximate semantic matches. |
| Paraphrased questions about the sampled sessions | Relevant sources appear without requiring the wording in their titles. |
| Terms found only in hidden campaign/date/DM prose | Hidden passages never influence returned excerpts or appear as source matches in that view. |
| Unrelated questions and empty/invalid input | Irrelevant matches can be rejected; input errors are clear. |
| Repeated passages, edits, and deletions | Results group by source page and reflect the selected experiment batch. |

Record expected sources in the first five results, excerpt usefulness, query
latency, indexing latency, chunk counts, and usage. Search visibility should match
article visibility; do not silently extend the separate campaign-ownership rule
used by backlinks to search results. Additional campaign ownership filters remain
a product decision.

Proposed initial limits: **100,000 prepared tokens per batch**, **1 million total
prepared ingestion tokens**, and **500 AI search requests** across the first pilot.
D1 has a separate 500-SQL-request budget; actual row reads/writes are recorded.
Count duplicated views, passage prefixes, overlap, and reruns. A dry run reports
the planned upload and request counts and refuses work exceeding configured
limits. These are harness limits, not Cloudflare account billing caps; compare
them with actual indexed-token usage. Other account usage may consume included
allowances.

## Decision after the pilot

Review the results together before expanding the corpus or integrating with the
site. Agree on the sample's search quality, chunking, ranking/reranking, latency,
and cost. Revisit AI Search if its filtering or exact-name behavior is unsuitable.

Production design must then establish visibility-homogeneous passages supporting
arbitrary Custom dates and campaign subsets, within AI Search's metadata limits;
incremental updates that reuse unchanged content; and publication/index readiness,
failure, deletion, and rollback behavior. Validate these with the pilot rather
than building a full publication system first. UI integration follows a stable
search response contract and the completed redesign.

## References

Checked 2026-10-19:

- [Hybrid retrieval](https://developers.cloudflare.com/ai-search/configuration/indexing/hybrid-search/)
- [Built-in storage and explicit uploads](https://developers.cloudflare.com/ai-search/configuration/data-source/built-in-storage/)
- [Metadata filtering](https://developers.cloudflare.com/ai-search/configuration/retrieval/filtering/)
- [Chunking](https://developers.cloudflare.com/ai-search/configuration/indexing/chunking/)
- [Limits and pricing](https://developers.cloudflare.com/ai-search/platform/limits-pricing/)
