# Campaign interactions

The website shows **Campaign interactions** on available notes with registered
`knownTo` campaigns, including people, divine beings, items, and organizations.
Only campaigns shared by `knownTo` and the active reader context appear. Each
campaign retains its own heading and **Known to party** line; `campaignInfo`
retains its normal header wording and does not create dots.

## Session maps on the website

The Node reader discovers `cleaned/*-entity-map.json` under
`_sessions/<campaign>/<session>/`. A v4 entity map supplies exact vault-relative
note targets, session importance, and an optional Mirror of the Past flag.
Unresolved entities have no public page target; labels, aliases, and candidate
paths never substitute for a missing mapped note. Targets still obey normal
publication and page availability rules.

The matching `*-session.yaml` supplies campaign, session number, and fallback DR
dates. The reader verifies the entity map's session metadata digest and actual
registered source hashes. If `*-interactions.json` exists, it must be v1, belong
to the same session, reference the current entity-map bytes and polished
transcript hash, and contain unique exchange/participation IDs with recognized
roles and actions. Stale or malformed artifacts omit the session with a local
warning. An orphan interactions file also reserves its session rather than
restoring recap or generated-note evidence.

The website gives each extracted exchange its own selectable widget entry,
using the title and retained `lines` from `*-interactions.json`. Selecting an
entry opens that exact transcript snippet immediately, with its action/role,
session title, DR date range, and optional numbered session-note link. There is
no session-summary step or second passage disclosure. The popup uses a wider
reading area for snippets. The no-JavaScript list also shows each snippet directly.

The compiled index still groups exchanges by mapped note and session. Several
mapped identities resolving to the same note deduplicate shared exchanges; the
view expands these records into entries identified by campaign, session, and
exchange ID, preserving source collection order. Entries distinguish
**Encounter** (`interacted`), **Observed**, **Present**, and **Mentioned**. The
summary counts transcript snippets and sessions separately. A map without
extracted exchanges supplies a **Session record**, without inferring a meeting
or current presence. Session importance and exchange roles remain separate: a
session cameo can be featured in its own exchange. Map-only session records
retain their session importance and optional Mirror of the Past flag.

Passages render as escaped text with line breaks; editorial cut descriptions
remain readable. Source comments containing UIDs or omitted speech, review
context, review reasons, full transcript bodies, source paths, and
entity-resolution bookkeeping are excluded from the public projection. There
is no full-transcript route or download.

Session titles and taglines retain campaign/date/DM filtering. Extracted exchange
titles and passages receive the same conditional filtering before they reach
HTML or browser JSON. Ordinary annotations are discarded. A wholly hidden
exchange title omits that exchange and cannot establish a visible encounter.
Malformed conditional text omits the affected session locally.

An available official session note's `descTitle`, `DR`, `DR_end`, and `tagline`
take precedence for session context; they never replace an extracted exchange's
title or passage. Recap Session Header titles/taglines remain optional
fallbacks for mapped sessions. Without either, the title is **Session N**.
Each record waits until its full session end date; dates remain undated when
unknown. No exchange UID or transcript position is treated as an in-world date.
The registry's exact `campaignRoot`/`notePattern` selects the preferred official
note; otherwise one available metadata candidate is required. Missing or
ambiguous links do not remove mapped records.

## Older sessions

Mapped artifacts take precedence over recap Cast membership for the whole
session, including map-only sessions, empty collections, invalid artifacts, and
entities represented only by mentions. Sessions without maps retain the existing
recap behavior: `## Cast` / `### NPCs` entries explicitly containing `met` create
one encounter per resolved person. Combined statuses such as `met, fought`
qualify; mention-only entries do not. Resolution uses explicit wikilinks or
unambiguous filenames, aliases, or metadata names among person-tagged notes.
Beats, beat NPC lists, Short/Long text, and old transcript artifacts remain
irrelevant to this fallback.

When neither maps nor a recap exist, explicit authored links in the preferred
or unambiguous official session note provide hollow **Session reference** dots.
These do not imply an encounter and show only session metadata and the note
link. Existing authoritative artifacts suppress this fallback for their entire
session, even when they contain no qualifying entry. Missing scans in old
snapshots do not establish that source artifacts were absent.

Duplicate authoritative session identities are omitted with local warnings.
Inverted date ranges are also omitted. Fractional session numbers remain intact.
For equal or unknown dates, session identities sort numerically.

## Controls and related material

Snippet entries show their exchange titles, session numbers, dates, and action
categories. Older session-only dots retain session titles and dates. Entries
wrap across rows and use two columns on narrow screens.
Selecting a dot opens its popup directly. A close button, Escape, an outside
click, or selecting the dot again dismisses it; only one popup opens across
campaigns. Popups fit the viewport and scroll for long passages. Keyboard and
touch use the same controls. The existing plain HTML list remains available
when JavaScript is disabled.

**Related campaign material** remains separate from dots and encounter counts.
Only non-session notes inside registered campaign folders contribute via
occurrence-filtered authored backlinks. Authored `object`/`item` tags select
**Items**, `story` selects **Stories**, and `source`/`document` selects **Sources**;
other eligible tags use **References**. Nested tags work. Untagged notes and
notes with `meta` or `background` are excluded. Categories sort by title, wrap
horizontally, and show ten links before a native **Show more** disclosure. A
reference's own date never creates an encounter date.

Generic **Linked from** on person pages continues to exclude session notes and
campaign material; shared world references remain there. The compiled backlink
index is preserved for interaction-related material.

## Publication and compatibility

The Node renderer and publisher read maps from the original vault. Fingerprints
include the normalized session/exchange projection and parser/compiler source.
Changes to retained passages, participation, session metadata, importance, or
Mirror of the Past flags invalidate the projection. Review context and unrelated
recap beat edits do not become published data. Full source bytes are read only
to check freshness and are not copied into the interaction projection.

The existing version-2 interaction projection gains mapped session records and
conditional exchange variants. Existing recap session records remain readable;
old beat records without `scope: session` remain omitted. The Worker filters
compiled data using indexed session metadata without fetching session or
transcript bodies. The viewed article shard is sufficient. There are no new
Cloudflare resources, transcript shards, or D1 migrations. Deploy core through
the normal website workflow, then republish content to compile maps. Deployment,
push, and publication retain the gates in [deployment workflows](deploy.md).

## Obsidian

This website change does not add map discovery to the Obsidian adapter. The
plugin continues to read recap Session Headers and Cast membership with native
metadata/link caches; it shares the compiler and popup controls. Its local
`taelgar-interactions` blocks and automatic footers retain their campaign picker,
date selection, native note links, and DM-inclusive author view. See the
[plugin guide](../obsidian/taelgarverse/README.md#campaign-interactions).

## Code and checks

- `src/mapped-sessions.mjs`: Node-only mapped artifact validation and projection.
- `src/session-interactions.mjs`: discovery, map precedence, and recap fallback.
- `src/recap-parser.mjs`: shared recap Session Header/Cast parser.
- `src/campaign-interactions.mjs`: compilation and request visibility.
- `src/interaction-view.mjs`, `src/browser/interactions.mjs`,
  `src/browser/interaction-groups.mjs`, `public/interactions.css`: accessible
  dots, counts, expandable passages, and related material.
- `tests/mapped-interactions.test.mjs`, `tests/interactions.test.mjs`,
  `tests/interactions-worker.test.mjs`, `tests/obsidian-interactions.test.mjs`:
  artifact freshness, exact targets, action distinctions, passage escaping,
  visibility, Worker parity, compatibility, and existing consumer behavior.
