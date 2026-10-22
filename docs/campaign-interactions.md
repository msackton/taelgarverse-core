# Campaign interactions with people

Person pages show authored campaign knowledge beside the header and a graphical
**Campaign interactions** history below the article. Interaction beats come
directly from the authoritative recap Markdown. The index does not summarize
prose, interpret transcripts, or infer relationships.

## Reader experience

Selected campaigns each have a separate history. `knownTo` supplies **Known to
party** without inventing a first-known date or controlling page availability.
Existing `campaignInfo` wording remains in the normal generated header; it does
not create additional dots. A recap can record interactions for a campaign not
listed in `knownTo`. Modern and Custom with no campaigns omit these histories.

Short histories show individual dots; automatic grouping switches to sessions
above six entries. Readers can group by session, day, seven-day period, or
individual entry. Selecting a counted dot zooms into its entries; **Zoom out**
returns to the whole history. A selected beat shows its date, title, Short text,
location, and recap session/title. Supplementary campaign references link to
their source articles. The same actions work with touch and keyboard; without
JavaScript, all records remain available as a linked list.

Dots distinguish **Encounter** and **Campaign reference** with shapes and labels.
Position represents story order with compressed spacing. Date ranges retain
their precision; undated entries remain explicitly undated. Seven-day groups use
the vault's 365-day DR calendar, starting with the first visible date. A range
spanning a group boundary retains its range rather than acquiring an invented day.

## Authoritative sources

| Source | Use |
| --- | --- |
| Person `knownTo` and `campaignInfo` | Authored header information. |
| Recap `## Recap` entries | One beat per explicitly listed, resolved NPC, using the entry's title, Date, Locations, and **Short** text. |
| Non-session articles in registered campaign folders | Supplementary backlinks labeled **Campaign reference**, with no inferred encounter date. |
| Session notes, including legacy named notes | Ignored by the interaction index. |

The Node importer reads
`_sessions/<campaign>/<session>/cleaned/*-session-recap.md`. Campaign identity
comes from the existing registry; the recap's **Campaign** and **Session Number**
identify the session. Fractional numbers remain intact. Recap IDs identify beats.
Neither registry `notePattern` nor any session article's filename, existence,
body, metadata, or publication status determines whether a recap beat exists.

**Short** is the display text, with Markdown presentation converted to plain
text. It need not match **Long** or a generated session note. Missing Short text
produces a local diagnostic and omits that beat; Long is never a fallback.
Timeline summaries and Cast entries do not create extra beats. Earlier beat-facts
files and transcripts do not override the recap.

NPC fields resolve through explicit wikilinks or unambiguous existing filenames,
aliases, or metadata names, restricted to person-tagged notes. Repeated NPC names
within one beat produce one dot. There is no fuzzy matching. Ambiguous names,
duplicate recap identities, duplicate beat IDs, missing Short text, and malformed
conditional comments are reported locally. Duplicate identities are omitted
rather than selected arbitrarily. Other valid beats still appear.

Supplementary references use the existing authored backlink index. Sources must
be inside a registered `campaignRoot`, belong to a selected campaign, and be
non-session notes (neither tagged `session-note` nor carrying `sessionNumber`).
General world articles and campaign-tagged articles outside campaign folders do
not contribute these dots. These references are undated and separate from recap
beats.

On person pages, generic **Linked from** backlinks exclude session notes and
other campaign material in all contexts. Campaign ownership includes declared
campaign metadata, registered campaign folders, and unregistered campaign folders;
session tags or session numbers also identify session material. Shared world
references remain in **Linked from**. The compiled backlink index stays intact
so the interaction component can still use eligible campaign references.

## Visibility and publication

Person availability retains existing publication and POV rules. A beat waits until
its recorded end date. When its date is unknown, the recap header's **DR Date**
end is a visibility cutoff if available, while the beat remains labeled undated.
If neither date is recorded, the beat is undated without a date cutoff.

The recap's own conditional campaign/date/DM markers control its Short, title,
location, and source-title text. Ordinary comment annotations are excluded.
Malformed markers omit the affected beat. Session-note comments do not affect
recap visibility. Campaign references retain source availability, POV, and
occurrence-level campaign/date/DM filtering.

Only selected, compiled fields enter the publication. Raw transcripts, Long
narratives, source ranges, full recap files, filesystem paths, cast bookkeeping,
and editorial annotations are excluded. Recap files have no public article route,
so beat details show the session and recap title without inventing a session-note
link. Diagnostics remain in the local preparation report
(`.cache/cloudflare/latest.json`), outside the published index.

Local previews and publication use the same compiler. Publication stores an
optional version-2 `interactions` projection in the revision index; the Worker
filters it per request without fetching session bodies. The person article's
normal shard read is sufficient. Projection changes affect the revision hash.
Fingerprints include the importer/compiler and parsed fields; changing only
Long text or machine-specific source bookkeeping does not change these inputs.

Deploy core through the normal website workflow, then publish content to enable
recap beats. Snapshots without an interaction index remain readable and supply
authored header information and available non-session campaign references.
Experimental version-1 interaction projections and unknown versions require
repreparation. Legacy version-1 backlinks remain omitted for multi-campaign
combinations. No new Cloudflare resources, bindings, or D1 migrations are needed.
Deployment and publication retain the permission gates in
[deployment workflows](deploy.md).

## Code and checks

- `src/session-interactions.mjs`: Node-only recap discovery and selected-field parser.
- `src/campaign-interactions.mjs`: shared compiler and request-local projection.
- `src/interaction-view.mjs`, `src/browser/interactions.mjs`,
  `src/browser/interaction-groups.mjs`, `public/interactions.css`: accessible dots,
  selection, grouping, zoom, and DR date arithmetic.
- `tests/interactions.test.mjs`, `tests/interactions-worker.test.mjs`: recap
  authority, session-note independence, references, visibility, provenance,
  fingerprinting, publication, compatibility, and Node/Worker parity.
