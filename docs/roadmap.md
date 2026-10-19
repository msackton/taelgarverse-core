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
as explicit scope boundaries. The list is still being developed; ordering does
not establish implementation priority.

### MVP-01: Table of contents and navigation

**Status:** Agreed scope; article TOC details remain open.

Recreate a navigation experience close to the existing Taelgarverse, using one
shared, curated site table of contents.

- The website hierarchy does not have to mirror the Obsidian vault's folder
  structure.
- The curated TOC definition determines the site TOC. Do not automatically append
  unlisted notes in an "Additional pages" catch-all (currently labeled "More
  pages" in the dynamic implementation).
- Other campaigns' material may remain visible. Campaign-specific navigation
  variants are not required for MVP.

Sensible article table-of-contents management remains in scope; its detailed
behavior is still to be discussed.

### MVP-02: Generic HTML extensions, including Taelgar II

**Status:** Agreed scope; detailed behavior remains open.

Provide a general mechanism for incorporating generic HTML pages or sections
into the dynamic website. Taelgar II is a required MVP use case for that
mechanism.

Taelgar II can remain a standalone website with its own presentation; it does
not need the shared Taelgarverse header or navigation. Preserving the link in
the source material may be sufficient as its entry point. Hosting and
publishing integration remain to be discussed.

### MVP-03: Basic full-text search

**Status:** Agreed scope; detailed behavior remains open.

Restore basic full-text search across article content, beyond the current
title/path finder. More advanced search improvements can follow under
Presentation improvements.

### MVP-04: Backlinks

**Status:** Agreed scope; detailed behavior remains open.

Restore a basic display of pages linking to the current page, comparable to the
existing Taelgarverse. Richer backlink presentation can follow later.

### MVP-05: Existing tiled maps

**Status:** Agreed scope; detailed behavior remains open.

Restore the existing interactive map experience, including tiled maps and basic
pan/zoom behavior. Additional map capabilities can follow under Presentation
improvements.

### MVP-06: Click-to-enlarge images

**Status:** Agreed scope; detailed behavior remains open.

Let readers click page images to view them enlarged, restoring the existing
site's basic image-viewing capability. Further image presentation improvements
can follow later.

### MVP-07: Audio embeds

**Status:** Agreed scope; compatibility verification remains open.

Support in-page playback of audio embeds used in the current vault. Verify the
existing audio support as part of MVP compatibility.

### MVP-08: Note embeds

**Status:** Agreed scope; detailed behavior remains open.

Render embedded notes as included content rather than ordinary links. Embedded
content must respect the selected campaign/date context and applicable
publication rules. Presentation and section/block embed behavior remain to be
discussed.

### MVP-09: Mermaid diagrams

**Status:** Agreed scope; detailed behavior remains open.

Render Mermaid blocks as diagrams, including the existing family trees in the
vault. Detailed styling and diagram-link behavior remain to be discussed.

### MVP-10: Excalidraw through exported images

**Status:** Agreed scope.

Display Excalidraw drawings through exported images, using the normal image
presentation and enlargement support. Automatic export and interactive drawing
support are deferred until after MVP.

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

## Presentation improvements

Website-only improvements that do not change the vault. Discussion areas include
UI, table-of-contents and navigation management, search, map structures, image
zoom and popups, and backlink generation.

### P-01: Reading experience

**Status:** Agreed direction; detailed design remains open.

Improve typography, spacing, mobile layouts, and theme choices, informed by
the existing UI design work.

### P-02: Tables and cards

**Status:** Agreed direction; detailed design remains open.

Explore sortable and filterable reference tables and compact NPC cards where
they make collections easier to scan.

### P-03: Map exploration

**Status:** Agreed direction; detailed design remains open.

Extend the MVP map experience with distance measurement, switchable overlays,
and navigation between world and regional maps.

### P-04: Better search

**Status:** Agreed direction; detailed design remains open.

Improve ranking and snippets beyond basic MVP full-text search, with optional
filters for types of content.

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
