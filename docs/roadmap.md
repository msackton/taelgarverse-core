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

## Presentation improvements

Website-only improvements that do not change the vault. Discussion areas include
UI, table-of-contents and navigation management, search, map structures, image
zoom and popups, and backlink generation.

No individual backlog items have been agreed yet.
