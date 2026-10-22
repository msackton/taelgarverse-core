# Campaign interactions with people

Person pages show authored campaign knowledge beside the header and a graphical
**Campaign interactions** history below the article. Encounters are session
records. Recap Cast membership selects the sessions; beats are never inputs.

## Reader experience

The website shows the intersection of the page's registered `knownTo` campaigns
and the active context's campaigns, without a component campaign picker. An empty
intersection means no component. Each selected campaign has its own heading and
**Known to party** line. `knownTo` supplies undated knowledge; `campaignInfo`
retains its normal header wording and does not create dots.

Every session has one dot. Different sessions remain separate even when their
dates match. The dot shows the session title and DR date or date range, including
in long histories. Undated sessions stay undated. Titles use up to two lines;
full titles are available on hover and in the popup. Dots wrap onto additional
rows, with two columns on narrow screens.

Selecting a dot opens its popup directly, without grouping, zoom, or beat
drill-down. Recap-backed encounters show the session title, date, tagline, and
an optional numbered link such as **Session 30** to the full session note. They
do not show beat titles, Short/Long text, beat locations, or transcript links.
The official session note's `descTitle`, `DR`, `DR_end`, and `tagline` supply
display metadata; missing fields fall back to the recap's Session Header.

Details start closed. A close button, Escape, an outside click, or selecting the
dot again dismisses the popup. Only one popup is open across campaigns. Campaign
changes and note closure also dismiss it. Popups fit the viewport and scroll for
long text. Touch and keyboard use the same actions. Without JavaScript, the same
sessions remain available as a list with full-session links.

When a session has no recap file, explicit NPC links in its official session
note retain the older hollow **Session reference** dot. These are counted
separately from encounters and show only the session title, date, and numbered
note link. They do not infer a meeting or copy prose from the note.

**Related campaign material** stays separate from dots and encounter counts.
Authored `object`/`item` tags select **Items**, `story` selects **Stories**,
and `source`/`document` selects **Sources**. Other eligible notes use
**References**. Nested tags work; a note appears once, with item, story, then
source precedence. Untagged notes and notes carrying `meta` or `background`
are excluded, including nested tags and notes carrying other types. Links run
horizontally and wrap. Each category sorts by title, shows the first ten links,
and uses a native **Show more** disclosure for the remainder. A document's own
date never becomes an encounter date.

## Authoritative sources

| Source | Use |
| --- | --- |
| Person `knownTo` and `campaignInfo` | Authored header information. |
| Recap `## Cast` / `### NPCs` | An explicit `met` status creates one session encounter for the resolved NPC. |
| Recap `## Session Header` | Campaign/session identity and fallback title, DR dates, and tagline. |
| Official session note | Full-session display metadata and optional note link; explicit NPC links provide legacy references only when no recap exists. |
| Non-session articles in registered campaign folders | Supplementary related links, typed using authored tags, without inferred dates. |

The Node importer reads
`_sessions/<campaign>/<session>/cleaned/*-session-recap.md`. Campaign identity
comes from the registry; the recap header's **Campaign** and **Session Number**
identify the session. Fractional numbers remain intact. The session exists
independently of any beat, NPC list in a beat, Short text, or transcript.

Only Cast NPCs explicitly marked `met` qualify. Combined statuses such as
`met, fought` or `companion, met` qualify. Mention-only and all other statuses
alone do not. A Cast entry need not appear in any beat. Repeated names resolve
to one session record per person. Resolution uses explicit wikilinks or
unambiguous filenames, aliases, or metadata names, restricted to person-tagged
notes. There is no fuzzy matching. Ambiguous or missing people, duplicate recap
identities, inverted session dates, and malformed session-header conditions are
reported locally. Duplicate recaps are omitted rather than chosen arbitrarily.

For optional session-note metadata and links, campaign and session metadata
identify candidates. The registry's exact `campaignRoot`/`notePattern` path
wins; otherwise a single available candidate is required. Unavailable or
ambiguous notes leave recap-backed session records using header metadata without
a note link. Links retain date, campaign, DM, and POV context.

Session-note fallback chooses that same preferred filename or one unambiguous
legacy metadata candidate before request visibility. An unavailable official
note does not make a duplicate authoritative. Any existing recap suppresses
fallback for its whole session, including empty Cast lists, duplicate recaps,
and sessions where the NPC is only mentioned. Malformed recaps reserve their
standard artifact-directory session identity when resolvable. Ambiguous session
notes supply no fallback.

Supplementary references use the authored backlink index. Sources must be
inside a registered `campaignRoot`, belong to a selected campaign, and be
non-session notes: neither tagged `session-note` nor carrying `sessionNumber`.
General world articles and campaign-tagged articles outside campaign folders
do not contribute. Type exclusions apply to existing indexes too.

Generic **Linked from** backlinks on person pages exclude session notes and
other campaign material in all contexts. Campaign ownership includes declared
metadata and registered or unregistered campaign folders. Shared world
references remain in **Linked from**; the compiled index stays intact for the
interaction component's eligible related material.

## Visibility and publication

Person availability retains existing publication and POV rules. Each encounter
waits until its full session's recorded end date. Available official session
dates take precedence, falling back to recap header dates. Unknown dates remain
undated without borrowing dates from beats. Session identities sort numerically
when dates are equal or absent.

Session title and tagline retain campaign/date/DM conditional filtering; ordinary
annotations are excluded. Malformed selected metadata omits the affected record.
Beat comments and missing or malformed Short/Long sections have no effect.
Session-reference dots and related links retain source availability, POV, and
occurrence-level campaign/date/DM filtering. Only explicit authored links
qualify for fallback; frontmatter, plain names, and generated headers do not.

The version-2 interaction projection stores one encounter per resolved met NPC
per session, marked `scope: session`. No beat IDs, beat text, transcript
bodies/descriptors, source ranges, Cast descriptions, or editorial bookkeeping
are compiled. New publications create no transcript shards. Retained snapshot
storage can still read older descriptors for cleanup/compatibility, but the
session component supplies no transcript links and obsolete beat URLs return 404.

Node, Obsidian, and the Worker share the session model. The Worker filters the
compiled projection and uses indexed session metadata without fetching session
bodies. The person's article shard is sufficient. Fingerprints include selected
session headers, met membership, and compiler/parser source. Edits only to
beats, Short/Long text, transcript references or transcript bodies do not change
the session inputs.

Deploy core through the normal website workflow and republish content to compile
session records. Older beat encounter records without `scope: session` are
omitted until republished; their session references and related material remain
readable. Snapshots without an interaction index supply authored header
information and non-session references, without inventing fallbacks from a
missing scan. Experimental version-1 and unknown interaction projections require
repreparation. Legacy version-1 backlinks remain omitted for multi-campaign
combinations. No new Cloudflare resources or D1 migrations are needed. Deployment
and publication retain the permission gates in [deployment workflows](deploy.md).

## Obsidian

The plugin shares the session-header/Cast parser, campaign ownership, session
model, and dot controls. Its adapter reads vault metadata, recap files, and
native link caches. Full-session and related links open local notes. It never
reads or opens beat/transcript artifacts and requires no website or note writes.
Only sessions missing a recap require session-note body reads to identify
fallback links and preserve their occurrence-level visibility.

An empty `taelgar-interactions` block places a panel explicitly. Otherwise,
Reading View and Live Preview show automatic footers on pages with registered
`knownTo` campaigns, including non-person pages. Multiple campaigns use one
picker directly below the heading, defaulting to **All**. Empty histories retain
the heading, picker, knowledge status, and related material without allocating
an empty timeline. This local author view includes DM text and ignores website
publication exclusions. Selected campaign and date conditions still apply.
A source note's `knownTo` adaptation does not make an untagged reference eligible.
See the [plugin guide](../obsidian/taelgarverse/README.md#campaign-interactions)
for settings, date selection, and lifecycle behavior.

## Code and checks

- `src/recap-parser.mjs`: pure session-header and met-Cast parser.
- `src/session-interactions.mjs`: Node-only recap discovery.
- `src/campaign-interactions.mjs`: compiler and request-local session model.
- `src/interaction-view.mjs`, `src/browser/interactions.mjs`,
  `src/browser/interaction-groups.mjs`, `public/interactions.css`: session
  labels, accessible popups, and related-material links.
- `tests/interactions.test.mjs`, `tests/interactions-worker.test.mjs`,
  `tests/obsidian-interactions.test.mjs`: session authority, beat independence,
  references, visibility, fingerprints, compatibility, and consumer parity.
