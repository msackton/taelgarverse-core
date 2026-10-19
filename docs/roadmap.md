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

**Status:** Agreed scope; detailed behavior remains open.

Provide sensible article table-of-contents management and site navigation
architecture.

**Open decision:** Whether campaign-specific navigation variants belong in MVP,
and what those variants should change.

### MVP-02: Generic HTML extensions, including Taelgar II

**Status:** Agreed scope; detailed behavior remains open.

Provide a general mechanism for incorporating generic HTML pages or sections
into the dynamic website. Taelgar II is a required MVP use case for that
mechanism. Navigation, presentation, and publishing integration remain to be
discussed.

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

No individual backlog items have been agreed yet.

## Presentation improvements

Website-only improvements that do not change the vault. Discussion areas include
UI, table-of-contents and navigation management, search, map structures, image
zoom and popups, and backlink generation.

No individual backlog items have been agreed yet.
