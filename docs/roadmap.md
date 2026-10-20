# Dynamic Taelgarverse roadmap

This document supports planning, discussion, and eventual AI implementation of
the dynamic Taelgarverse. It records agreed scope; it is not yet a complete
feature inventory or implementation plan.

## Working agreements

- `taelgarverse-core` is the architecture going forward. Ignore earlier proposals
  where they conflict with the dynamic implementation.
- Discuss roadmap additions and changes before recording them, and obtain the
  user's agreement. Keep unresolved decisions explicit.
- Commit agreed roadmap changes promptly. Do not push.

## MVP: compatibility with the existing Taelgarverse

Establish the capabilities needed for the dynamic website's MVP, using the
existing Taelgarverse as the compatibility reference and the exclusions below
as explicit scope boundaries. All ten agreed MVP items are completed in the core.
Deployment and content publication remain separate operational steps; completion
here records implementation, not the state of a deployed website.

### MVP-01: Table of contents and navigation

**Status:** Completed.

Recreate a navigation experience close to the existing Taelgarverse, using one
shared, curated site table of contents.

- The website hierarchy does not have to mirror the Obsidian vault's folder
  structure.
- The curated TOC definition determines the site TOC. Do not automatically append
  unlisted notes in an "Additional pages" catch-all.
- Other campaigns' material may remain visible. Campaign-specific navigation
  variants are not required for MVP.

The article TOC nests subheadings, omits the article title and popup/embedded
headings, highlights the current section, and supports per-page hiding.

The automatic "More pages" branch is removed. Unlisted pages remain accessible
through search and direct links, without fabricated breadcrumbs. Empty curated
definitions stay empty; the explicit no-template configuration still produces
a directory tree. The article TOC has a plain **On this page** heading and flows
with the page without a separate scrollbar; page contents are hidden on mobile.

### MVP-02: Generic HTML extensions, including Taelgar II

**Status:** Completed through existing authored links.

Provide a general mechanism for incorporating generic HTML pages or sections
into the dynamic website. Taelgar II is a required MVP use case for that
mechanism.

Externally hosted HTML can be reached using ordinary absolute links in notes.
Taelgar II remains on GitHub Pages with its own presentation and publishing
workflow. Its existing links in Cha'mutte and Heroes of the Great War point to
the absolute GitHub Pages URL. This requires no special renderer, navigation
entry, or publication-pipeline change. Further HTML integration beyond authored
links remains unspecified.

### MVP-03: Basic full-text search

**Status:** Completed; D1 full-text search integrated with publication and the app.

Search article content, titles, and aliases with word-prefix and exact-phrase
matching, ranked results, highlighted excerpts, and pagination. Results respect
the selected date, campaigns, and Behind the Curtain setting. Production uses
D1 FTS5; local previews use SQLite with the same compiler and query. If the
matching index is unavailable, search falls back to visible page names with a
notice. See [production search](search.md).

Optional AI Search evaluation and integration belong to Phase 3, P-04.

### MVP-04: Backlinks

**Status:** Completed; local browser and publication-index verification complete.

Restore a basic display of pages linking to the current page, comparable to the
existing Taelgarverse. Richer backlink presentation can follow later.

Articles show **Linked from** in the right-hand page navigation, with a sorted,
deduplicated list of referring pages. Authored article links respect source-page
availability and occurrence-level campaign/date/Behind the Curtain visibility.
Campaign session notes and other campaign-owned sources appear only when that
campaign is selected; Modern retains shared reference sources. Custom contexts
can select all campaigns or a subset alongside their manual date, and retain
those choices through article links, search, navigation, and backlinks. See
[Custom campaign selections](custom-contexts.md).
Publication builds a reverse index so the Worker can display backlinks without
fetching referring article bodies. The feature needs the updated renderer and
a fresh content publication. See [backlink behavior and indexing](backlinks.md).

### MVP-05: Existing tiled maps

**Status:** Completed; local browser and Node/Worker publication verification complete.

Restore the existing interactive map experience, including tiled maps and basic
pan/zoom behavior. Additional map capabilities can follow under Presentation
improvements.

Existing Leaflet image maps preserve their authored bounds, center, dimensions,
and zoom settings, with extra zooming out to fit narrow screens. Large maps use
generated WebP tile pyramids; regional maps use image overlays. Leaflet is bundled
locally and loaded only where needed. Maps support mouse, keyboard, and touch
interaction, a Fit map control, and an
original-image fallback. Publication preserves map image resolution and packages
tiles with the existing asset pipeline. Deployment and content publication remain
separate.

### MVP-06: Click-to-enlarge images

**Status:** Completed; local browser verification complete.

Let readers click page images to view them enlarged, restoring the existing
site's basic image-viewing capability. Further image presentation improvements
can follow later.

Unlinked article images open in a modal viewer with keyboard controls, focus
management, mobile sizing, backdrop dismissal, and a link to open the published
image directly. Authored image links retain their destinations. Verified with
real article images at desktop and mobile sizes; deployment remains separate.

### MVP-07: Audio embeds

**Status:** Completed; existing support verified locally for the current MP3/M4A embeds.

Support in-page playback of audio embeds used in the current vault. Verify the
existing audio support as part of MVP compatibility.

Real MP3 and M4A clips play and seek in the local browser. Representative audio
files pass unchanged through the existing export-copy, image-optimization, and
snapshot-packaging stages. Regression checks cover player rendering, campaign
filtering, packaged assets, MIME types, HEAD requests, and media byte ranges in
both Node and Worker handlers. No audio publication-pipeline change is needed.

### MVP-08: Note embeds

**Status:** Completed; real-vault, Node, and Worker verification complete.

Render embedded notes as included content rather than ordinary links. Embedded
content respects the selected campaign/date context and applicable publication
rules. Whole-note, heading/section, block, local-heading, and nested embeds render
in bordered panels with source links. Generated headers are omitted, embedded
headings stay out of the host TOC, and repeated anchors/footnotes/popups remain
distinct. Cycles and unsafe or missing sections recover with a source link;
expansion is bounded. The Worker loads visible embedded notes on demand from
existing Markdown shards. All 12 current vault embed sources were checked in
Modern, Dunmar Frontier, and Custom All campaigns; the materializer preserves
their syntax. No new publication schema or embed index is required.

### MVP-09: Mermaid diagrams

**Status:** Completed; diagram rendering, links, and article previews implemented.

Render Mermaid blocks as diagrams, including the existing family trees in the
vault, with context-aware links and optional previews of linked articles.

Mermaid is pinned and bundled locally, loaded only for pages with diagrams, and
uses strict rendering with authored JavaScript callbacks disabled. Existing node styles are
preserved. Diagrams fit within the article width and viewport height. "See bigger"
opens a full-size popup with a fit-to-window option, and "See source" opens the
Mermaid text in a popup. Both support keyboard closing and focus restoration.
Readable source remains available without JavaScript or after a rendering error.
Both existing family trees, mobile containment, and recovery after an invalid
diagram were checked in the browser. Node and Worker tests cover context
filtering and asset routing. Family-tree nodes marked `internal-link` and explicit
Mermaid destinations resolve to ordinary links. Internal destinations preserve
the reader context and open article previews, with a toggle for direct navigation.
Links work in the enlarged diagram; unavailable or ambiguous pages stay unlinked.

### MVP-10: Excalidraw through exported images

**Status:** Completed through exported PNGs; local compatibility verified.

Display Excalidraw drawings through exported images, using the normal image
presentation and enlargement support. Automatic export and interactive drawing
support are deferred until after MVP.

Verified the existing Voltara, Mostreve Hills, and Addermarch PNG embeds; the
latter two remain inside their authored Behind the Curtain blocks. Exported
drawings use the normal image viewer. Snapshot and HTTP regression checks cover
PNG assets, and the Voltara drawing was checked in the browser.

### Explicitly outside MVP

- **Advanced session reading views.** The short/long narrative controls,
  transcript views, and other enhanced session presentation do not need to be
  carried over for MVP. This remains an area of active work.
- **DataviewJS support and output parity.** MVP may omit DataviewJS-derived
  sections. Reexecuting those queries or reproducing all their outputs is not
  required; reconsider how DataviewJS is used before choosing a replacement.

## Information Architecture

Work that may affect vault organization or the underlying information model to
support a better experience. Discussion areas include temporal POV, campaign
knowledge, and how relationships are represented in data.

### IA-01: Temporal POV and multi-POV pages

**Status:** Agreed direction; metadata and authoring design remain open.

The intended reader experience is:

- When a page's POV is earlier than the selected date, keep it available and
  highlight its POV.
- When a page's POV is later than the selected date, hide the page.
- Support appropriate POVs for each campaign without making authoring and
  maintenance burdensome.

Multi-POV pages need further design: how to represent their content, select the
appropriate POV, and apply the availability and highlighting rules.

The central design question is whether to reuse the existing campaign and date
blocks, with POV adding an effective whole-page date gate, or adopt a different
representation for multi-POV content. Neither approach is selected. Evaluate
them against the intended reader behavior and the authoring burden above.

The existing vault specification, `_MoC/Temporal POV Metadata.md`, defines POV
as an editorial reading position rather than a validity interval. Comparison
rules for years, decades, `modern`, and `undated`, along with the relationship
to authored date blocks, remain to be worked out before implementation.

### IA-02: Campaign indexes from knownTo

**Status:** Agreed direction; index design remains open.

Use `knownTo` to build campaign-specific reference collections, such as a
campaign NPC index. Do not use it to filter page availability by party knowledge
or change a page's description.

The specific collections, their contents, and how they are authored and
generated remain to be discussed.

### IA-03: Reusable views of existing relationships

**Status:** Agreed direction; authoring and generation design remain open.

Make existing relationship metadata useful through reusable views, including:

- People based in a place, using `whereabouts`.
- Members and leaders of an organization, using `affiliations`.
- Related or contained places and groups, using the applicable `whereabouts`
  and `partOf` relationships.

Together with campaign indexes from `knownTo`, these are the main relationship
views to consider. How authors request and configure them, including their role
as replacements for common DataviewJS uses, remains open.

### IA-04: Connections between NPCs

**Status:** Exploratory idea; no data model or presentation selected.

Explore showing clusters of related NPCs, including which NPCs know one another.
These interpersonal connections are distinct from the campaign knowledge
recorded by `knownTo`.

Prefer discovering relationships from existing prose. Explicit authoring is
acceptable for a few key relationships involving important people; this should
not require maintaining a comprehensive manual relationship catalog.

The extraction approach, representation, and website presentation remain to be
discussed.

### IA-05: Audit queries, inserts, and embedded content

**Status:** Agreed investigation; feature decisions follow the inventory.

Review where the current vault uses Dataview, DataviewJS, inline backtick
expressions, and other special inserts or embeds. Include Leaflet, Mermaid,
Obsidian canvases, and any other formats found in use.

Identify the purpose and location of each pattern, its current website
handling, and the decisions needed to preserve, replace, or deliberately omit
it. This audit does not change the agreed exclusion of DataviewJS support and
output parity from MVP.

## Phase 3: Presentation improvements

Website-only improvements that do not change the vault. Discussion areas include
UI, table-of-contents and navigation management, search, map structures, image
zoom and popups, and backlink generation.

### P-01: Reading experience

**Status:** Completed in core.

Quiet Library provides the typography, spacing, responsive layouts, and
System/Light/Dark appearance choices. Further reading polish can be scoped from
specific feedback rather than remaining an open implementation requirement.

### P-02: Tables and cards

**Status:** Agreed direction; detailed design remains open.

Explore sortable and filterable reference tables and compact NPC cards where
they make collections easier to scan.

### P-03: Map exploration

**Status:** Agreed direction; detailed design remains open.

Extend the MVP map experience with distance measurement, switchable overlays,
and navigation between world and regional maps.

### P-04: Better search

**Status:** Full-text search and content-type filters implemented; production AI
integration deferred.

Build on the completed D1 full-text search from MVP-03. Basic ranking, highlighted
excerpts, and pagination are implemented. Content-type filters use existing vault
tags and work in full-text search, page-name fallback, and browsing. Exact page
filenames, display titles, and metadata names precede exact aliases and partial
matches, with normalized comparison and ranking applied before pagination. See
[production search](search.md). Further ranking and snippet changes can follow
specific feedback.

AI Search is deferred because its current benefit does not justify production
integration. The isolated, explicitly selected 22-note pilot
compares exact names/phrases and meaning-based questions, keyword/vector/hybrid
retrieval, chunking, context visibility, updates, latency, and costs. See the
[search pilot plan](search-pilot.md) and [measured results](search-pilot-results.md).
Keep those results as a reference if AI Search is reconsidered. Full-corpus AI
indexing and production integration are outside the current work.

### P-05: More informative backlinks

**Status:** Agreed direction; detailed design remains open.

Make backlinks more useful, including short excerpts explaining why another
page links to the current page.

### P-06: Campaign hubs and standard campaign presentation

**Status:** Agreed structure and authoring direction; emphasis and layout remain open.

Use a shared set of sections while retaining room for each campaign's character
and particular resources:

- **Overview:** premise, setting, campaign dates, and current/completed status.
- **The party:** PCs and their shared party page.
- **The story:** sessions or episodes, grouped into arcs where useful, plus the
  timeline.
- **Campaign reference:** relevant NPCs, places, maps, and organizations.
- **Resources:** handouts, treasure, special mechanics, and other
  campaign-specific material.

Generate collections that otherwise require repetitive maintenance, such as
session lists and NPC indexes. Keep introductions, arc summaries, and highlighted
resources authored. Existing hubs such as Lost in the Feywild illustrate how
storytelling and distinctive content can fit within this shared structure.

For active campaigns, the relative emphasis on finding references during play
versus catching up on the story between sessions remains open. Placement of the
latest session, common references, and broader story is still to be discussed.

### P-07: Generated campaign context and encounters

**Status:** Agreed investigation; sources and generation approach remain open.

Explore per-campaign encounter lists for NPCs and similar campaign context on
entity pages. Consider session-note backlinks, processed transcripts, and
related session artifacts as sources. The definition of an encounter and the
details of extraction and presentation remain open.

### P-08: Name explorers from linter metadata

**Status:** Agreed investigation; detailed design remains open.

Explore using the name metadata recorded by the linter to generate name
explorers. Start from the existing metadata rather than assuming a new
authoring requirement.

### P-09: Automatic map locations from linter metadata

**Status:** Agreed investigation; detailed design remains open.

Explore generating map locations and linked map features from the map metadata
recorded by the linter. Determine how existing location records can be resolved
onto the website's maps.

### P-10: Excalidraw export automation and interactive drawings

**Status:** Deferred until after MVP; detailed scope remains open.

Consider automatic generation of updated drawing exports and interactive
Excalidraw presentation after MVP. Exported images are sufficient for MVP.

### P-11: Image optimization and bandwidth reduction

**Status:** Responsive variants and on-demand image viewing implemented and
verified locally; broader full-vault performance measurement remains open.

Reduce image download sizes substantially. Large source images currently incur
unnecessary bandwidth costs when displayed at small or fixed sizes on the page.

- Generate resized and compressed website image variants while preserving vault
  originals.
- Serve variants appropriate to the displayed size, viewport, and screen pixel
  density, including thumbnails and cards.
- Load larger versions for enlargement or detailed inspection when requested,
  rather than downloading them during ordinary page viewing.
- Defer loading offscreen images where appropriate.
- Preserve visual quality, transparency, and legibility, including text and
  fine detail in maps and diagrams.

Measure image bytes transferred on representative image-heavy pages, including
mobile views, and compare before/after results alongside visual quality. The
implementation preserves full-resolution exports, produces cached WebP sizes
from actual authored widths and layout roles (combining reused image sizes),
and uses small responsive images with offscreen loading deferred. An expand
icon opens a fitted screen-sized image; Download and Pan / zoom request the
original on demand. PNG derivatives retain transparency and use lossless encoding.
Generated assets use the existing publication, retention and rollback lifecycle.
See [image delivery and verification](images.md). Performance targets and broader
full-vault measurements remain to be decided.
