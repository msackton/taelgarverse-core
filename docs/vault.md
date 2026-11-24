# How vault notes appear on the website

TaelgarVerse uses the notes, properties, and media in your `taelgar` vault.
Readers can choose a campaign and an in-world date. The website uses that choice
to update page headers and show or hide marked content.

After editing the vault, follow [Update the website](deploy.md) to publish your
changes. Publishing works on copies; it does not rewrite your source notes.

## Relationship explorer metadata

The optional Obsidian relationship explorer reads existing person/group/place
types, affiliations, leadership, containment, whereabouts, and explicit links
between person-note prose. It retains historical relationships up to the selected
cutoff and uses Date blocks to date prose evidence. The spatial view instead
shows nested place boxes with people inside their current/last-known location at
that date. It uses primary containment, with labeled secondary containment as a
fallback. Legacy `graphPositions` metadata is not used by these boxes. It does not affect website rendering,
publishing, or existing map calibration. Per-organization expansion controls can
stop traversal through a group without changing affiliations or hiding people
reached through other links. These choices apply only to the open explorer. See the
[explorer guide](relationship-explorer.md) for the field schema and query rules.

The explorer excludes notes under `Worldbuilding` folders by default. Its
**Include Worldbuilding** checkbox includes them in both People and Places,
without changing website publication rules.

## Files the website uses

The website includes Markdown notes and these media formats:

| Media | Supported files |
| --- | --- |
| Images | PNG, JPG/JPEG, GIF, WebP, HEIC |
| Audio | MP3, M4A, WAV, FLAC, OGG |
| Documents | PDF |

SVG, video, and other file types are not included.

The following are left out of the article and media collection:

- Folders beginning with `_`, anywhere in the vault.
- Folders named `Worldbuilding`, anywhere in the vault, regardless of capitalization.
- `assets/dm/` and `asset/dm/` at the vault root, including everything inside them,
  regardless of capitalization.
- Files and folders beginning with `.`, files named `AGENTS.md`, and symbolic links
  (filesystem links to another location).
- Folders containing a `.nopublish` marker, including every descendant.
- Notes with the exact frontmatter tag `status/stub`.
- Notes with the boolean frontmatter property `noPublish: true`.

The underscore rule applies to **folders**: a file named `_example.md` can still
be included. Likewise, `assets/dm-map.png` is included; it is outside `assets/dm/`.
Tags such as `excalidraw` or `status/check/ai` do not prevent publication.

`status/stub` is an exception: tagged notes are omitted before website query
processing and packaging, including their bodies, metadata, aliases, backlinks,
and search documents. The tag can be in a YAML list or scalar `tags` string;
matching ignores capitalization and an optional leading `#`. Only the exact tag
matches, not `status/stubbed` or `status/stub/child`. Inline body hashtags do not
control this policy. Local website previews use the same rule. Source notes and
separately stored media remain untouched. Remove the tag and republish to include
the note. Text already copied into other notes is unaffected. Publication's
Dataview index excludes stub notes.

To exclude any individual note from the publication package, add this property
to its YAML frontmatter:

```yaml
noPublish: true
```

This uses the same packaging exclusion as `status/stub`: the note is omitted
from the working copy, metadata, article content, backlinks, and search documents,
including in local previews. It applies in every campaign/date view, including
Behind the Curtain. Use a boolean (an Obsidian checkbox property); the quoted
string `"true"` does not enable it. Setting `noPublish: false` or removing the
property restores normal eligibility, but does not override `status/stub` or
other exclusion rules. Source notes, separately stored media and text copied into
another note are unaffected. Republish content for changes to reach the website; an existing
active snapshot is not changed by editing this property.

Notes with unreadable text or invalid properties are skipped with a warning.
Two notes that produce the same website address stop publication until the
conflict is resolved.

### Exclude a folder

Create a file named **`.nopublish`** inside any folder you want omitted from the
article and media collection. It can be empty or contain an explanatory note;
only its presence matters. For example:

```text
Campaigns/Cleenseau Campaign/Chats/.nopublish
```

The folder and all descendants are excluded in every campaign/date view,
including Behind the Curtain. Their notes, metadata, aliases, backlinks, search
documents, and contained media are not packaged for publication. A child folder
cannot override an excluded parent. Removing the marker opts the folder back in
on the next preview refresh or content publication.

The website working copy applies the same file and folder exclusions as the
article store. Dataview uses the store's accepted pages for all publication queries.
Homepage, menu, and session inputs come from their configured files in the original vault. Explicit `mapPath.source` references
are also copied as geometry inputs, including files under `_maps`; unrelated
files in underscore folders stay excluded. `.nopublish` still applies.

The publisher reads markers from the original vault even when preparing a
materialized export that omits dotfiles. Marker additions and removals invalidate
the unchanged-publication check. A marker does not remove files from an already
active publication: republish the content through the normal approved workflow.
It also does not remove text already copied or quoted into other notes.

## Homepage and menu

Files in the vault's `_website` folder supply the website's own content:

| File | What to edit |
| --- | --- |
| `_website/home.md` | The homepage heading, introductory prose, and links within that prose. |
| `_website/navigation.md` | The sidebar menu: section names, order, and links to notes. See the [menu format](../README.md#site-navigation-and-page-toc). |
| `_website/<name>.md` | A landing page with a locked campaign set and date. The optional `subdomain` field selects its host; otherwise the filename does. See [campaign landing pages](campaign-sites.md). |

Edit these in the vault and publish them with your notes. The homepage uses
ordinary Markdown and supports the same links and campaign/date comments as
articles. It does not generate a note header or run Dataview queries. The first
top-level heading and introductory paragraph appear in the homepage banner;
the remaining content appears below the entry buttons. If there is no heading,
the banner uses TaelgarVerse. Keep HTML layout, styles, and decorative images out
of this file: `taelgarverse-core` owns the homepage template, map decoration,
Current Games / Gazetteer / World Map buttons, and search form. Button links
retain the reader's context and are unavailable when their destination is not
published or visible in that view. Older snapshots containing the original
three-link navigation paragraph work without displaying duplicate entry links.

The publisher reads these two files directly from the original vault, even when
it prepares the other notes in Node. They do not become searchable
articles. Additional `_website/<name>.md` files opt in with `campaigns`
frontmatter; other website files stay excluded.
Set `subdomain: cleenseau` in a file such as `cleenseau-index.md` to keep
`cleenseau.taelgar.org` without sharing the place note's filename. Omit `subdomain`
to use the filename as before. Two files cannot claim the same subdomain.
For example, `campaigns: [dufr, feywild, mawar]` keeps those three campaigns selected
throughout that subdomain. An optional `date: 1748-05-05` fixes the in-world date;
omitting it uses Modern. A single campaign, such as `campaigns: [clee]`, always
follows its latest published session date, regardless of an authored `date`.
The old `context` property is no longer supported on landing pages.
Setting `vault_dir` once
is enough to find both files; see [configuration settings](deploy.md#vault-and-website-settings)
only if you need a different location.

## Note properties and page headers

The website reads the properties at the top of each note—the YAML section between
`---` lines. It uses them to build the title and information shown above the article.

| Properties | What they affect |
| --- | --- |
| `name`, `title` | Displayed names and search labels. The website address comes from the filename and folder, so changing `name` does not change the address. |
| `aliases` | Alternative names the website can use to find a linked note. Filenames and paths are checked first. |
| `tags` | Selects header display defaults and supplies the website's [search content-type filters](search.md#app-search). `headerVersion` is historical metadata and does not enable generation. |
| `species`, `ancestry`, `typeOf`, `pronunciation` | Descriptions and pronunciation in the header. |
| `displayDefaults`, `ddbLink` | Header formatting and a link to game mechanics. |
| `born`, `created`, `died`, `destroyed`, `DR`, `DR_end` | Ages, lifespans, and event dates. |
| `whereabouts`, `partOf`, `affiliations`, `leaderOf`, `campaignInfo` | Locations, relationships, leadership, and campaign events, using the selected date. |
| `noPublish` | Boolean `true` omits the note from the publication package, like `status/stub`. |
| `activeYear` | Whether the page is shown, as explained below. |

Related notes also matter: a location or affiliation may use another note's name
and properties. The selected website date takes priority over `pageTargetDate`.
The usual header is rebuilt for that date; you do not need to edit its displayed
age or location by hand.

## Generated bio block

The native header is a top-level `taelgar-header` **callout**. Its saved body is
fallback text; all three consumers generate its displayed information from
frontmatter and related-note metadata:

```markdown
---
name: Fausto
tags: [person]
species: human
---
# Fausto
*(FOW-stoh)*
> [!taelgar-header]
> Saved fallback information.

Authored biography.
```

The title and pronunciation are ordinary authored Markdown. The handler replaces
only the callout, wherever it occurs in the body; it never generates a title or
pronunciation or replaces content above the callout. The proposed opt-in
whole-header replacement is not implemented. Empty callouts are valid, and their
fallback body may contain ordinary Markdown. Fallback content is never a header
configuration language and is ignored by header generation.

Node and the Worker use the website layout at the reader's selected date and
campaign. Obsidian uses the native information-callout layout and the authoring
date selected by the plugin/calendar. A Markdown postprocessor handles both Reading view and Obsidian's native Live
Preview callout widget. The plugin does not add a competing CodeMirror header
replacement. Obsidian owns selection/editing and reveals the saved source when
editing the callout. Source mode always shows saved Markdown.
Metadata and calendar changes refresh generated information without rewriting
the file. Shared plugin services own the metadata snapshot and authoring-date
selection; Calendar signals changes to subscribed headers, indexes, interactions
and relationships. Legacy calendar/CustomJS changes use one shared two-second
polling bridge. Date changes reuse cached interaction data; they do not rebuild
the recap/reference index.

Only top-level callouts are recognized. Examples in code, nested blockquotes,
and list items remain literal. Standard callout title/fold syntax is accepted
as a marker, but the generated component owns its label and layout. The whole
fallback callout is omitted from authored search and backlinks, and from
website transclusions;
surrounding titles, pronunciation and prose remain authored content. Related
links still use the shared naming, location and affiliation rules. Circular
relationships produce a clear header error.

Rendering recognizes only native callouts. Old `taelgar-header` fences remain
code, HTML markers and `headerVersion` do not trigger generation, and saved
legacy headers render as static Markdown. Website preparation takes the header
format from the authored note. See
[publishing header callouts](publishing-pipelines.md#publishing-header-callouts)
and [legacy review](header-callout-migration.md).

### Writing or adding a saved header

The Obsidian commands **Taelgarverse: Regenerate page header** and
**Taelgarverse: Add header to current note** can be assigned in Settings → Hotkeys.
They use the current editor text, including unsaved frontmatter, and make one
undoable range replacement. The command writes the title, optional
`*(pronunciation)*`, and a `taelgar-header` callout with a compact saved summary.
This changes source Markdown; ordinary dynamic rendering still does not.

Source-writing eligibility is checked **before any header detection**. A note
must have at least one nonempty string in its frontmatter `tags`. Notes with a
`session-note`, `meta`, `background`, `source` or `story` tag are always skipped,
even if they also have an eligible entity tag, an existing header or an empty
insertion flag, and even with Add / `--add`. Exclusions also cover descendant
tags such as `source/letter`; comparison ignores case and an optional leading
`#`. Skips preserve the file and explain the eligibility reason. The display
renderer does not apply these restrictions: an explicitly authored
`taelgar-header` callout still renders on any page.

Regenerate updates an existing `taelgar-header` callout, including an empty
one. Add can also insert a callout and reuse the leading title and pronunciation
range. Ordinary `[!info]` callouts stay in the article body. Missing metadata
fields are omitted. The H1 uses the shared `name:tn` naming format, including title +
name composition, filename/session fallbacks, capitalization and definite articles.
Required and type defaults come from the vault's configured `metadata.json`;
per-note `displayDefaults` take precedence. An explicit `defArt: ""` suppresses
the inferred/configured article. Saved summaries retain the fixed formats below.
If the note changes while naming rules are loading, the editor command skips the
write rather than overwriting newer edits.

Add and Regenerate remove the top-level `headerVersion` field in the same edit
and preserve the remaining frontmatter, the BOM, newline style, and article
content. The edit stops if removing the field would affect other YAML values.
The writer accepts a leading H1 and pronunciation before the native callout.
It skips ambiguous placements such as a callout preceded by a comment, prose,
or an image. Fenced code and nested callouts stay in the article body.

Saved summaries use these hardcoded formats; `displayDefaults.boxInfo` does not
control them. All references are plain display text, not generated wikilinks.
The dynamic rendered information still uses the shared display rules.

| Type | Saved summary inside parentheses |
| --- | --- |
| Person | Species, ancestry, pronouns, known `ka X`, `b. YEAR`, `d. YEAR`, `lives in HOME` |
| Power | Type, pronouns, `part of PRIMARY AFFILIATIONS` |
| Place | Type, `in MAIN LOCATION / SECONDARY LOCATION` for any place type, including islands; both locations must be timeless and unambiguous; no population |
| Object | Rarity, ancestry, subtype and type, separated by spaces |
| Group | Ancestry/subtype/type separated by spaces, then `of PRIMARY AFFILIATIONS` |
| Event | Type, direct `partOf`, date/date range from `DR` and `DR_end` |
| Ancestry, creature, unknown | Type, direct `partOf` |

Type uses `typeOfAlias` when present, otherwise `typeOf`. Pronouns use explicit
`pronouns`, then the existing gender fallback. Person birth/death use years only;
events preserve year/month/day precision, with identical endpoints shown once.
Missing/unknown values disappear with their separators; unknown/sentinel dates
and unknown ka never produce placeholders. Empty summaries leave an empty callout.

Timeless home/location summaries require one unambiguous direct location with no
`start`, `end` or `date` restriction. `primary` is treated as `home`; separate
travel entries do not invalidate a timeless home. Competing, dated, unknown or
malformed home records omit the location. Primary affiliations are included only
when their entries have no such date restrictions. No calendar date is selected
when writing a saved summary, and location chains are not expanded.

The plugin also installs a self-contained `header-tool.cjs` in its own directory.
See [standalone and bulk commands](deploy.md#saved-header-commands) for use outside
Obsidian. Select one note with `--file`, a recursive vault-relative directory
with `--dir`, or the whole vault with `--all`. Both directory modes exclude dot
directories, `node_modules`, `_scripts` and `_sessions`, and skip symlinks;
`--dir` cannot select an excluded directory or leave the vault. Bulk editing
previews changes by default and is a separate operation from content publication.

## Obsidian note query API

DataviewJS and Templater can call the read-only note query API when the
Taelgarverse plugin is loaded. Get a query object once per execution so repeated
lookups share the plugin's metadata snapshot. Check `apiVersion` before using it
if the script also runs with an older plugin.

```javascript
const queries = await globalThis.Taelgarverse.getNoteQueries();
const origin = queries.getRecordedOrigin(personNotePath);
const hasMatchingNote = queries.isResolvable(locationReference, sourceNotePath);
```

- `getRecordedOrigin(notePath)` reads the note's original frontmatter using
  its vault-relative Markdown path. It returns the recorded home location at
  birth or creation, or at the beginning of the chronology for an undated
  subject. The result is a string or `null` if the note or origin is missing.
  A recorded location can be plain text.
- `isResolvable(reference, sourcePath)` returns `true` if the reference resolves
  to a Markdown note and `false` otherwise. Pass a filename, path, alias, or
  wikilink as a string. The lookup ignores a wikilink's displayed label and
  heading or block fragment.
  Obsidian resolves links relative to `sourcePath` first. Taelgarverse then
  tries its standard note lookup, including vault aliases and the link map.
  Use an empty source path for a lookup from the vault root.

- `getCampaigns()` returns fresh records with `code`, `name`, and
  `campaignRoot` from the registered campaigns.
- `normalizeDR(value, {boundary})` returns a copy of the shared DR date record
  (including `sort`, `year`, and `display`), or `null` for a missing or
  unrecognized value. The boundary defaults to `start`. It preserves existing
  Taelgar date rules for year numbers, quoted year or month strings, and full
  dates. JavaScript dates and Dataview date objects are converted to ISO dates.
- `formatNoteText(template, notePath, {date})` expands Taelgarverse display
  tokens against a vault-relative Markdown path. Omit the date to use the
  plugin's date selection for that note. A missing note returns `null`.

The methods are synchronous after `getNoteQueries()` resolves. This API is
available in Obsidian, including when the campaign calendar is disabled.

## Generated indexes

Use an inline `taelgar-index` block in a note. Both Obsidian and the website evaluate its YAML against metadata at the reader's selected date.

````markdown
```taelgar-index
type: whereabouts
from: place
via: current
where:
  typeOf: [plane, realm]
mode: table
columns: [name]
heading: false
```
````

| Key | Values and behavior |
| --- | --- |
| `type` | Required. Choose `whereabouts`, `affiliation`, or `catalog`. |
| `from` | Required page classification. Choose `person`, `place`, `object`, `group`, `power`, `event`, `ancestry` or `creature`. |
| `via` | Required for `whereabouts`. Choose `home`, `current` or `lastKnown`. |
| `affiliationType` | Optional for `affiliation`. Match a normalized relationship type such as `leader` or any in a list such as `[member, primary]`. Omit to include every type. |
| `target` | Any resolvable, visible note name, alias or path. Quote wikilinks. The default is the note containing the block, including in a transclusion. Whereabouts also accepts the geographic root `Taelgar`. Catalogs ignore this option. |
| `recursive` | Boolean. Defaults to `true` for whereabouts and `false` for affiliation. Use `false` for direct matches. |
| `scope` | `current` (default), `historical` or `ever`. |
| `where` | Optional mapping of top-level result frontmatter fields. Fields combine with AND. A nonempty list of alternatives within a field means OR. Exact scalar matches preserve case and YAML types (string, number or boolean). Missing or list-valued fields do not match. An empty mapping accepts every candidate for whereabouts and affiliation queries. Catalogs require at least one field. |
| `show` | `both` (default), `website` or `obsidian`. |
| `mode` | `grid` (default) or `table`. Grids show linked cards and available lead images. |
| `heading` | Use `true` (default) for the generated H2, a nonempty text label for a custom H2, or `false` to suppress it. |
| `columns`, `sortBy` | Table-only, ordered nonempty lists of distinct column names. Sort keys may be hidden. Sorting is ascending, with missing values last and name/path breaking ties. |
| `columnHeadings` | Table-only mapping from displayed column keys to nonempty text labels. Any column omitted from the mapping keeps its default label. Use the original keys in `columns` and `sortBy`. |

The first hop for `home` is exclusively the subject's recorded home. For `current`, either the dated current or active secondary location may match. For `lastKnown`, use the current geography when known. When only an earlier primary sighting is known, evaluate its secondary and the entire containing chain on the day of that sighting. A secondary alone can place a subject while active. Subsequent hops use each container's current and active secondary on the same day. Targets and candidates follow host visibility rules, as do intermediate locations. Cycles are reported and an independent matching path can still qualify.

`current` scope evaluates living or existing subjects on the selected date. `historical` evaluates a subject that has since died or been destroyed at its end date. `ever` finds a matching day within its lifetime through the selected date. The current-location column always refers to the reader's date.

All kinds support `name`, `type`, `home`, `currentLocation`, `lastKnown`, `origin`, and `status`. The `lastKnown` column shows the current location when known. For a past sighting, it shows the location with the recorded date in parentheses and follows the location chain as of that sighting. This column works with any index query, including queries that match using `via: home` or `via: current`. Origin shows the recorded home at birth or creation, using the earliest in-world date if neither is recorded. People also support `info`, `born` and `died`. Other kinds support `created` and `destroyed`, and places additionally support `region` and `population`. People default to `[name, info, currentLocation, home]`, other kinds to `[name, type]`. Places sort by displayed type then name by default. Other kinds sort by name.

For top-level regions, query the geographic root directly. The name `Taelgar` matches that location reference without a note of that name. Set `recursive: true` to follow visible intermediate locations to that root.

````markdown
```taelgar-index
type: whereabouts
from: place
via: home
target: Taelgar
recursive: false
where: {typeOf: region}
mode: table
columns: [name]
```
````

### Editorial status

Add `status` to `columns` to show one editorial bucket per note. It uses the note's current YAML tags for any selected in-world date. The first matching rule wins:

| Result | Rule |
| --- | --- |
| Stub | `status/stub` is present. |
| AI review | `status/check/ai` is present. |
| Needs work | `status/review`, `status/wip`, `status/check/errors`, or any unmapped `status/*` tag is present. |
| Check | `status/check` or one of its subtags applies. The exact AI and lint tags and the errors family follow their own rules. |
| Updates pending | `status/gameupdate` or a campaign subtag is present. |
| Lint | `status/check/lint` is the only distinct status tag. |
| Complete | The note has no `status/*` tags. |

Use `sortBy: [status]` to group rows in this order: Stub, Needs work, Check, Lint, AI review, Updates pending, Complete. Usual visibility rules still apply. For example, the website excludes stub notes during publication.

### Catalogs

A catalog lists visible pages of the selected classification that match a nonempty `where` mapping. It can include pages without locations or affiliations. The default scope lists pages in existence at the selected date. Both `historical` and `ever` also include subjects whose existence ended by that date.

````markdown
```taelgar-index
type: catalog
from: place
where: {typeOf: plane}
mode: table
columns: [name, origin]
columnHeadings: {name: Plane, origin: Planar Group}
heading: Planes of the Multiverse
sortBy: [origin, name]
```
````

### Affiliation rosters

````markdown
```taelgar-index
type: affiliation
from: person
affiliationType: leader
scope: ever
mode: table
columns: [name, roles, joined, left]
sortBy: [joined, name]
```
````

An affiliation query returns one row per subject with a qualifying `affiliations` or legacy `leaderOf` record. String memberships and leadership entries use the usual header normalization. The target can be any visible note. Direct matches are the default. With `recursive: true`, a record pointing to a group also matches its visible ancestors through organizational `partOf` links. `affiliationType` filters records, while `where` filters subject frontmatter.

Start and end dates are inclusive. Current rosters require an active relationship on the selected date. Historical rosters evaluate a deceased or destroyed subject at its end date. All-time rosters include terms overlapping the subject's lifetime through the selected date. In tables, `roles` lists distinct qualifying titles. `joined` and `left` describe the term with the most recent qualifying day, using the later start to break ties. Unknown starts, future ends, and ends inferred solely from death or destruction stay blank. These columns can also be sort keys.

Index blocks render inline. The former preset type names and automatic header index buttons are retired. To migrate an old `members` table, use `type: affiliation` and `from: person`. Former `membership: historical` rosters use `scope: ever`; former `columns: life-dates` tables can use `columns: [name, info, born, died]`.

## Event timelines

A `taelgar-events` fence generates a chronological **Date**, **Event**, and **File**
table in Obsidian and on the website.

````markdown
```taelgar-events
yearStart: 1546
yearEnd: 1600
includeLifecycle: true
includeTravel: false
sources:
  - { type: event }
  - { type: person, knownTo: dufr }
```
````

| Option | Behavior |
| --- | --- |
| `yearStart` | Required DR year or `YYYY-MM-DD` date. A year starts on January 1. |
| `yearEnd` | Defaults to `yearStart`. A year ends on December 31. Bounds are inclusive. |
| `includeLifecycle` | Add dated starts and ends such as births, deaths, foundings, and destructions. Defaults to `false`. |
| `includeTravel` | Add dated whereabouts moves, arrivals, visits, and departures. Defaults to `false`. |
| `heading` | Add an Events heading when `true`. Defaults to `false`. |
| `show` | `both` (default), `website`, or `obsidian`. |
| `sources` | List of selectors. Defaults to all eligible source notes. An empty list selects zero notes. |
| `excludeSources` | List of selectors whose matches are removed from the results. |

A selector is one YAML list item. All its fields must match the same source note.
A note matches the list when any item matches, and contributes each row once.
Selectors accept:

| Field | Matches |
| --- | --- |
| `folder` | A vault-relative folder and its descendants. |
| `note` | A specific note name or path. Quote wikilinks. Explicit relative paths resolve from the note containing the block. |
| `type` | The primary descriptive tag, such as `event`, `person`, `background`, `place`, or `session-note`. |
| `knownTo` | The source note's authored `knownTo` campaign codes. |
| `campaign` | The source note's `campaign` field, used by session notes and other campaign records. |

Use `excludeSources: [{ type: person }]` to skip people while keeping other
source types. A selector matches the note that stores the date. To select rows
that mention a person, first select the notes where those rows are authored.
Campaign selectors resolve names and aliases through the campaign registry.
Missing or empty `knownTo` does not match a campaign.

Authored rows come from frontmatter `DR` and Markdown list items with inline
`DR::`. Dates retain year, month, or day precision. Use `DR_end` or a date string
with `to` for a range. The entire range appears once when it overlaps the
requested window. Double parentheses around an inline field mark uncertainty.
A leading qualifier such as `fall:` or `morning:` appears in the Date cell
and affects sorting. Code, ordinary comments, and editorial blocks do not
contribute dates. Event-tagged notes with a frontmatter date supply one authored
date range in place of generated lifecycle rows.

Obsidian uses the full authored window, including dated bullets from local
campaign and date variants. The note containing the block, `Worldbuilding`, and
underscore-prefixed folders at any depth are skipped. The website also applies
publication eligibility, source-note availability, and campaign or date block
visibility. A website reader sees a range or partial date once its latest
possible date is within the reader's context. `knownTo` filters source notes
using their current metadata.

The website renders explicitly authored `taelgar-events` fences. Legacy
`get_EventsTable` calls are omitted along with other DataviewJS fences.

## Campaign calendar prototype

In the local Taelgarverse 0.7.0 development build, turn on **Settings → Taelgarverse →
Enable campaign calendar**, choose **Active campaign**, then click the calendar icon in the left ribbon or run
**Taelgarverse: Open campaign calendar**. This minimal
view shows a colored dot on each campaign's current date and a moon icon on every
day. The campaign legend jumps to that campaign's month. Browsing never changes
the active campaign or a campaign's date. There are no event, holiday, or agenda
layers in this build.

The whole calendar is opt-in and disabled by default. Disabling it immediately
closes its views, removes the ribbon icon, hides its command, stops its metadata
listeners, and releases `TaelgarverseCalendar`. Query consumers return to their
previous date fallback. Campaign and custom-date settings are retained; their
controls appear only while the calendar is enabled.

Dates come from the website's `Contexts` implementation: rank session notes by
play date, session number, DR date, and source path; use the latest session's full
`DR_end` or `DR`. Only notes included in the published store supply website dates. Templates,
private/generated folders, Worldbuilding, and `.nopublish` folders are excluded
before selecting sessions, as in the website's source store. A latest session
without a usable date makes its campaign unavailable; the calendar does not
silently pick an older session. By default, the legend and date dots show only
campaigns whose index has `campaignType: full`, whose `continuity` is `main`
(or `[main]`), and whose latest session supplies a usable date. Campaign types
are `full`, `miniseries`, and `oneshot`; a missing or other type is hidden from
this default view. This filter is independent of `canon`.

Check **Show all campaigns** above the legend to include every registered
campaign, including other continuities and unavailable dates. Unavailable
campaign cards are disabled and have no dot. The checkbox applies only to the
open view, survives month browsing and metadata refreshes, and starts unchecked
when a new view opens. It never changes the active campaign, date settings, or
query-date API. An active Custom date retains its own card and dot in both views.
**Latest campaign date** uses the latest dated campaign, falling back to
DR 1750-01-01 when none exists. Update session metadata to advance a named
campaign's date; the calendar does not edit notes.

Choose **Custom** in **Active campaign** to set a date manually. The **Custom
date** field accepts a full **YYYY-MM-DD** DR date; click **Set date** to save it.
It starts at the selected date on first use and remembers its value when switching
campaigns or reloading the plugin. Invalid input, including February 29, leaves
the saved date in effect and displays an error in settings. An active Custom date
gets its own dot alongside the registered campaigns. It supplies the same date
API used by CustomJS, headers, indexes, and interactions. Settings contain the date
controls; the calendar opens from the ribbon or command palette.

DR has 365-day years and no leap days. Weekdays use Sunday, 1715-05-02 from
Addermarch Session 03, corroborated by Saturday, 1749-04-18 in DuFr Session 95.
Lunar phases use the confirmed **full moon on April 6, 1748 DR at 00:00**
and an exact **29.5-day cycle**, shared across campaigns. Icons show illumination
at noon; hover or inspect a moon's accessible label for its phase, illumination,
and exact new/full/quarter crossings on that date. A ring marks a crossing day.

Phase names round to eight conventional labels, so a full/new appearance can
span nearby days. Exact crossing times are computed separately in three-hour
ticks. A midnight crossing belongs to the new date. All times are world time;
no Earth timezone, DST, or Gregorian leap day is used. For example, July's full
moon is **1748-07-03 at 12:00**; September's is **1748-09-30 at 00:00**.

The plugin exposes `globalThis.TaelgarverseCalendar.getCurrentDate()` (ISO date),
`getContext()` (selected campaign, date and source), and `getCampaignDates()`
(all campaign dates and availability). Native headers, `taelgar-index` blocks,
and interactions use the selected date after an explicit CustomJS override and
`pageTargetDate`. A **local, uncommitted** hook in the experimental vault's
`_scripts/customJS/dataUtil.js` uses the same API before its legacy Fantasy
Calendar/Calendarium fallback. Those older plugins are not needed when this API
is available. Without the API, the previous fallback remains available.
Settings show an existing temporary CustomJS override and offer **Clear test
override**; selecting a campaign does not discard it.

Campaign/date changes refresh native headers and indexes and trigger
`taelgarverse:context-changed` plus Dataview's refresh event. This does not
rewrite notes or saved headers. The calendar reads metadata only; it does not
scan event bodies. Website calendar rendering and materializer integration
remain future work. The shared date/lunar code and DOM renderer are separate
from the Obsidian adapter.

## Campaigns and dates

Session date selection uses the note's resolved `campaign`. A valid authored
campaign ID takes precedence. A session without a usable ID inherits the
campaign of its registered directory. The website applies its campaign
selection rules after resolving the note against the full registry.

| Reader's choice | What it means |
| --- | --- |
| A named campaign | Use that campaign's latest session date and show text marked for that campaign. |
| Modern | Use the latest date across eligible campaigns. Campaign-specific text stays hidden. |
| Custom | Use a date chosen by the reader and select All campaigns, an individual subset, or no campaigns. |

The website includes campaigns whose index note has `canon: canonical` and
`main` as its sole continuity. Eligible campaigns without a usable date appear
disabled as named presets and remain available in Custom. The same eligibility
rule applies to campaign landing pages.
Deploy the updated website code and republish with the updated publisher to apply
the rule to the live site. Existing publications retain their saved context lists.

Dates use `YYYY-MM-DD` in the DR calendar, with no leap days. Use Custom to choose
a date other than a campaign's current date. If no campaign has a usable date,
Modern uses the website's configured `default_date`.

Custom selections persist as you browse; older date-only links select no
campaigns. See [Custom campaign selections](custom-contexts.md) for the picker
and URL format.

Campaign dates come from **session notes**, not campaign overview pages. A session
note needs the `session-note` tag and a recognized `campaign` value. The website
chooses the latest session by `realWorldDate`, then `sessionNumber`, then in-world
date, with the file path breaking any remaining tie. It uses that note's `DR_end`,
or `DR` if there is no valid full `DR_end` date.

Notes omitted by `noPublish`, stub tags or folder markers are not published.
If the latest included session has no full date, the campaign cannot be selected,
even if an older session has one. A flashback can move the campaign's date backward.

The website and Obsidian plugin read campaign IDs from `_sessions/campaign-registry.json` and display names and paths from its index notes.
For example, **Dunmar Frontier** uses the code **`dufr`** in comment markers. The note's `campaign` property can match the registered name,
code, ID, or alias.

To change a campaign's date, correct its session note and republish. Existing
campaign links will then use the updated date; links to a Custom date keep that
date. The [current campaign list](https://taelgarverse.msackton.workers.dev/api/contexts)
shows the dates and which notes supplied them.

## When a page is shown

These properties hide a whole page:

| Property | Effect |
| --- | --- |
| `born` or `created` after the selected date | Hide the page until that date. If both are present, `born` is used. |
| `activeYear` after the selected date | Hide the page until it becomes active. |

`excludePublish` is retired and ignored, including in existing snapshots.
Use `noPublish: true`, `status/stub` for stub notes, or a
[folder marker](#exclude-a-folder) to omit content from packaging. Republishing
rebuilds session contexts and search text that older publications may have
excluded under the retired rule.

Death or destruction does not hide a page; readers can still look up historical
people, places, and objects.

Partial birth/creation dates have different meanings depending on how they are written:

| Example | First date the page is available |
| --- | --- |
| `born: 1730` | January 1, 1730 |
| `born: "1730"` | December 31, 1730 |
| `born: "1730-02"` | February 28, 1730 |
| `born: 1730-02-10` | February 10, 1730 |

The same rules apply to `created`. Missing or unknown birth/creation dates do not
hide the page. `activeYear` uses the start of the specified year.

`POV` metadata does not affect website visibility. The retired `pov` URL
parameter, `respect_pov_dates` setting, and microsite `enforcePoV` field are
ignored, including in older published snapshots. Links and forms no longer
propagate this parameter. Birth/creation, activity and
comment visibility continue to apply.

Hidden pages disappear from search and navigation. Links to them keep their text
but cannot be clicked; opening their address gives “Page unavailable.”

**Readers can choose any campaign and turn on See Behind the Curtain.** These
choices do not require a login. That option reveals comments, but never overrides
the whole-page rules above. `knownTo`, audience notes, and status
tags other than the `status/stub` packaging exclusion do not limit who can read a
page. Notes marked `noPublish: true` are omitted entirely before these view rules.

A hidden page's properties may still contribute to other pages' headers. Its
images and other media can still be opened separately. Ordinary prose does not
change with the selected date unless you mark it as described below.

## Comments and text for particular campaigns or dates

Use a vault `SECRET` block for material that must stay out of website output.
Publication and local website previews strip raw secret blocks and single-line
frontmatter values marked `##secret` before rendering or indexing. See
[website secret filtering](publishing-pipelines.md#website-secret-filtering).

An ordinary Obsidian comment, `%% like this %%`, is hidden by default. With
**See Behind the Curtain** enabled, it becomes a numbered popup note. Comments
inside a section hidden for the current campaign or date stay hidden.

Comment and conditional markers inside fenced or indented code are literal
examples, including fences nested in lists and blockquotes. They do not change
visibility or produce comment-syntax errors. Website query materialization also
preserves those list/quote containers and leaves code examples untouched.

To show a passage only for Dunmar Frontier:

```markdown
%%^Campaign:dufr%%
This passage appears when Dunmar Frontier is selected.
%%^End%%
```

Each marked passage must end with `%%^End%%`. Other supported opening markers are:

| Opening marker | When the passage appears |
| --- | --- |
| `%%^Campaign:none%%` | When See Behind the Curtain is enabled, in a labeled panel. |
| `%%^Date:1730-02-01%%` | On February 1, 1730 and afterward. |
| `%%^Date:1730-02-01b%%` | Before February 1, 1730. The `b` means “before.” |
| `%%^Metadata:...%%`, `%%^povNotes:...%%`, `%%^Lint%%` | Never shown, including with See Behind the Curtain. |

Bare `Metadata` and `povNotes` markers also stay hidden. For partial `Date:` values,
a year starts on January 1 and a year-month starts on its first day.

Do not put one marked passage inside another. Missing closing markers, unknown
markers, and the unsupported date suffix `a` stop the page from displaying—even
if the broken passage would have been hidden. Markers inside code examples are
left alone. Popup comments support Markdown and links, and show HTML as text.

## Links, navigation, and media

Ordinary Markdown, tables, footnotes, callouts, and wikilinks are supported.
Links use filenames/paths first, then aliases. Use a full note path when a short
name matches several files. Missing or ambiguous wikilinks show their text and a
warning.

`![[Another Note]]` includes the note's authored body, with a source link above
it. Generated headers are omitted. Heading embeds such as
`![[Flaming Tempest#Travels]]` include that heading and its subheadings, stopping
at the next heading of the same or higher level. `![[Note#^block-id]]` includes
a paragraph or list item marked with a trailing `^block-id`. A marker on its own
line after a block can name that block. Local `![[#Heading]]` embeds also work.

Embeds use the reader's campaign/date and Behind the Curtain setting, including
whole-page availability rules. Relative links and media resolve from the embedded
note. Footnotes and popup IDs remain distinct when a note is included more than
once; embedded headings do not enter the host TOC. Only visible nested embeds
are loaded. Cycles, missing sections, and unsafe child comments retain a source
link with a render note; nesting stops at eight levels or 32 inclusions per page.

The site sidebar is organized by `_website/navigation.md` in `taelgar`. A page
can still appear in search and work through a direct link without being listed
there. **On this page** comes from the article's headings, excluding its first
title and popup-comment headings. It has a fixed **On this page** heading without
a collapse control. The right sidebar flows with the page, with no sticky
positioning, height cap, or separate scrollbar. The left navigation retains its
own scrolling.

Desktop breadcrumbs align with the article's prose width and stay on one line.
When the full trail will not fit, older ancestors collapse into an `…` disclosure;
open it to follow those links. Home, the current page, and as many nearest ancestors
as fit remain visible. An exceptionally long current-page label truncates with an
ellipsis; hovering shows its full title. The trail expands again when space permits.

Main sections appear in the desktop header, with the current section's branch
on the left. Below 1100px the full navigation moves into a hamburger drawer;
below 800px the page contents disappear. In note or homepage frontmatter,
`hide: [navigation]` omits the section links and left navigation, and
`hide: [toc]` omits page contents. Both may be combined. For articles,
`hide: toc` also works, and hidden contents are omitted from the page API.
Search, settings, and backlinks remain available, and unused navigation columns
release their space.

### Article width

Prose, lists, ordinary figures, and floated asides keep a readable width (up to
80ch). Maps (`.leaflet-map`), hero image roles, both semantic and callout galleries,
large figure roles, and Mermaid diagrams automatically use the wider article
column. Navigation and page navigation keep their own space; on narrow screens
media fits the available width. Mermaid drawings retain their intrinsic size
within that space. No per-page metadata is needed for these semantic roles.

Consecutive prose blocks share a formatting context, preserving image-callout
floats and their text. Breakouts clear those floats. Embedded notes retain their
title, boundary, and scoped anchors while allowing semantic media inside them to
expand. Media nested in ordinary prose callouts or lists stays inside its parent.
Wide tables and code scroll within their container rather than widening the page.

For an exceptional media page, frontmatter `layout: wide` also expands top-level
tables, nonfloated figures, and paragraphs containing only an image or linked
image. It does not widen prose or promote portraits/asides. Unknown layout values
use the normal semantic rules. This affects the website shell; the page API
retains the fragment structure and reports `layout: "wide"` for that override.

**Linked from** lists other articles that link to the current one. Only pages and
passages visible in the selected view contribute links. Campaign notes contribute
links when their campaign is selected, including in Custom All campaigns. Modern
and Custom without campaigns show shared reference sources. Campaign ownership
comes from the source note's `campaign` property or its registered campaign
folder. Published campaign articles remain directly readable when their dates allow.
Generated header relationships and links back to the same article are excluded.
On person-tagged NPC pages, **Linked from** also excludes session notes and other
campaign material in every view, including Modern and Behind the Curtain.
Their campaign history belongs in **Campaign interactions**; shared world
references remain in **Linked from**. Backlinks on other article types keep the
normal campaign filtering described above.
Nonempty backlinks appear in the right sidebar even on short articles; on mobile they
appear in a collapsed **Linked from** section below the article.

Available pages with effective `knownTo` campaigns show a **Campaign
interactions** summary and directly selectable transcript snippets for the intersection of those
campaigns and the active reader context. People, divine beings, items, and
organizations can receive mapped histories. The website reads validated v4
entity maps and matching v1 interaction collections from the original vault's
registered session bundles. Exact mapped note paths identify targets. Dots distinguish
encounters, observations, presence, mentions, and map-only session records.
Only direct `interacted` participation counts as a mapped encounter.

Each mapped exchange is a widget entry labeled with its extracted title.
Selecting it immediately opens its retained passage and action/role labels, with
the session title, dates, and source-note link as context. Map-only session
records retain their session importance and optional Mirror of the Past flag. Text is escaped, conditional campaign/date/DM
blocks are filtered, and source comments, cut-source speech, review context,
source paths, and full transcripts are excluded. The same passages remain
available without JavaScript. Session notes supply preferred display metadata
and optional full-session links; complete-session end dates control visibility.

Maps take precedence for the entire session. Stale or malformed artifacts omit
the session with a local warning. Without maps, explicit recap Cast `met`
membership retains the earlier encounter behavior; only when maps and recaps
are both absent do authored session-note links supply hollow **Session
reference** dots. Related non-session campaign material remains separate.
A handout can join that list by declaring its `campaign`, wherever it is filed.
The list has Items, Stories, Sources, and other References categories with **Show more**
after ten links. `knownTo` and `campaignInfo` retain their authored header
behavior. See [campaign interaction sources and rules](campaign-interactions.md).

The Obsidian plugin offers recap-based dots through an empty `taelgar-interactions`
code block. It also adds a footer automatically to notes with registered
`knownTo` campaigns, with a campaign selector when more than one is known.
The selector sits directly below the heading and defaults to **All**; individual
campaigns remain selectable. Knowledge-only views retain the heading and picker,
with the same campaign-name heading and **Known to party** status as full timelines,
using compact spacing without an empty plot.
Explicit blocks control placement and suppress automatic duplicates. The website
consumes the empty fence and retains its normal history section. See the
[plugin interaction guide](../obsidian/taelgarverse/README.md#campaign-interactions).

The header gear offers **System**, **Light**, and **Dark** appearance. System is
the default and follows operating-system changes. Explicit selections are saved
in that browser. On small screens the gear also contains the context/date,
campaign, and **See Behind the Curtain** controls.

| In the note | On the website |
| --- | --- |
| `![[map.png]]` | A responsive image with an expand icon. The viewer fits the screen and offers full-resolution download and pan/zoom. Size and alignment options work, including `aside`, `figure`, or `hero` with `small`, `standard`, or `large`. |
| `![[clip.m4a]]` | An audio player. Other supported audio formats work the same way. |
| A PDF link/embed | A link to the PDF. |
| An Excalidraw drawing | Use an exported PNG or another supported image; the website does not draw it from Excalidraw data. |
| A Mermaid code block | A diagram, with its source text available as a fallback. |

Captions below images in `[!image|...]` callouts, captions in each `[!gallery]`
list item, and HTML `figcaption` text also appear in the enlarged image viewer.
The viewer uses the image's alt text when no caption is authored; alt text itself
remains unchanged for accessibility. For example:

```markdown
> [!image|right standard]
> ![[portrait.jpg]]
> *A short contextual caption.*
```

Mermaid flowchart nodes marked `internal-link` resolve their visible labels to
notes, including filenames and aliases, as in the existing family trees. Explicit
Mermaid destinations such as `click A href "../People/Example.md"` also work.
Relative destinations resolve from the diagram's source note, including inside
embeds. Missing, ambiguous, excluded, and future destinations remain unlinked.
Internal links preserve the selected campaign/date and Behind the Curtain setting.

Click a linked node to open its destination. The inline diagram and **See bigger**
use standard links with normal keyboard and modified-click behavior. Explicit
`_blank` destinations open a new tab. Mermaid uses strict rendering. The
`/api/diagram-links` endpoint resolves a bounded batch against the source note
and the selected context.

## Interactive maps

Fenced `taelgar-map` blocks render as interactive image maps.
Their image wikilink, bounds, center (`lat`/`long`), zoom limits, default zoom, height, and
width are preserved. Maps support dragging, zoom buttons, keyboard panning and
zooming, and touch gestures. **Fit map** shows the complete map; **Open map image**
also works without JavaScript or if the interactive viewer fails. Mouse-wheel
scrolling continues to scroll the article.

**Measure distance** adds a temporary route ruler. Click or tap successive
points for a total; Undo, Clear, and Done controls appear as needed.
**Trace path** mode follows winding roads or rivers by dragging, with each
stroke measured along its bends and removed as one Undo action. The same tools
are available through the [Taelgarverse Obsidian plugin](../obsidian/taelgarverse/README.md).
To use the Taelgarverse viewer for an existing image map, change its opening
fence label from `leaflet` to `taelgar-map`.
Returning to the start or choosing **Close shape** closes an outline and shows
its enclosed area in square miles alongside the distance. Separate outlines
have separate readings; crossed outlines report that area is unavailable.
The current Taelgar maps record their verified **24-mile hex** calibration inside
each `taelgar-map` block: `calibration.hexMiles`, `hexPixels` in original image pixels,
`imageSize: [width, height]`, and an optional `imageSha256` fingerprint. The vault
owns this data; the website and Obsidian read the same fields. The fingerprint
disables measurement after an image changes until its calibration is rechecked.
Zoom and the older display bounds do not affect calibrated distance. Blocks
without calibration use authored `unit`/`scale`, or show map units if no unit is
supplied. See [map calibration and controls](maps.md).

Large maps use generated WebP tiles, so viewing a map does not fetch its entire
original image. Smaller regional maps use image overlays. On narrow screens,
maps allow extra zooming out so **Fit map** can show the complete image. Map images retain
their resolution during publication. Leaflet and its styles are served locally
and loaded only on pages with maps. Campaign/date and Behind the Curtain blocks
filter maps like other article content, including inside note embeds. Missing
images or invalid definitions produce a map warning without breaking the article.

Legacy map markers and navigation between maps remain
future work; the website does not execute Obsidian Leaflet plugin scripts.

Version 2 `taelgar-map` blocks can instead reference a quoted `.map.json` wikilink
in `source`. Keep the manifest and
its relative PNG together under a publishable assets folder. Both the website
and development plugin use the shared fixed 0.6 miles/pixel scale and the
note's optional `crop` and `grid` settings. Crops use original Photoshop pixels
or inclusive `topLeft`/`bottomRight` hex references, independent of the export. The manifest
contains format version, relative PNG filename, `sourceOffset` and optional
`layers` references to shared region files; PNG
dimensions are decoded. Old draft `coordinateFrame` blocks require conversion
as described in [the baseline guide](map-baseline-progress.md#older-drafts). Blocks and hexes have no
printed labels; hover/select/copy provides references. Use **Open map editor** in
Obsidian for town placement, river/road paths and region border authoring. Embedded maps remain viewers. Retired `overlays`
fields are ignored; masks, dimming and hide-content editing are removed. Publication validates the manifest/image
pair and shares one tile pyramid across crops. See [map editor](map-editor.md)
and [manifest delivery](maps.md#delivery-and-maintenance). Ordinary JSON files
remain excluded; `.map.json`, `.map-layers.json`, and `.map-detail.json` are the additional supported
asset suffixes. See [shared region layers](map-layers.md) for the schema, visibility
controls, publication behavior and authoring limits. Each map offers no region
layer checkboxes unless its block opts in with `toggleableLayers: [layer-id]`.

The development Obsidian plugin also offers **Place town** in the separate map editor.
Choose an existing note with `typeOf: settlement`, click a position and
explicitly save. Only settlement notes appear in the picker. Its `mapLocation`
frontmatter contains numeric Photoshop `x` and `y`, a fourth-level slash
`hex` reference, and an `importance` tier (`world`, `regional`, `local`, or
`detail`). Local is the default; increasing map detail reveals less prominent
markers. Exact pixels are authoritative and independent of export crops.
The plugin displays these notes as markers, excluding points outside the crop. Other note fields and prose are preserved. The website does not yet
render these town markers. See [town placement](map-editor.md#place-towns).

River and road notes instead use `mapPath`, containing a `kind` (`river` or
`road`), an optional `importance` (the same tiers, default `local`), and `source`,
an exact vault-root-relative `.map-path.json` filename. The geometry file contains
`{version: 1, points: [[X,Y], ...]}` in original Photoshop coordinates. Legacy
inline `points` is readable and moves to a geometry file on editor Save. These open paths render on
both Obsidian and published version 2 maps. Website paths respect note
date visibility and publication packaging rules. The editor can trace
or edit them, writes the geometry file, and patches only that note field on Save; see [rivers and roads](map-editor.md#rivers-and-roads)
and the [metadata schema](../schemas/map-path.schema.json).

Other images may be made smaller during publication. See
[image settings](deploy.md#image-settings).

## Dataview and other generated content

The taelgar.org publisher copies the vault into a working directory and
materializes supported plain Dataview queries in Node. It fetches a pinned
GitHub Dataview release into core's local cache and uses built-in settings.
`--dataview-directory` explicitly selects a verified bundle
and its optional saved settings. See [dependency caching](publishing-pipelines.md#taelgarorg).
Dataview results are static until republication. Node indexes the article store's
pages for queries and uses its eligible files for link resolution. This excludes
unpublished notes and Markdown the store could not parse. Current-page chronology
scans appear as unsupported queries in the materialization report.

Website preparation removes unsupported fences and headings whose sections
have no body content. The cleanup report lists each block by file and line. Use `taelgar-index`
for tables that follow the reader's current context.
Remaining unsupported DQL and inline expressions show
warnings or unavailable-content messages. The website does not execute scripts.
HTML in the normal article body remains supported.

### Campaign roster and sessions

Taelgarverse renders `taelgar-roster` and `taelgar-session` in Obsidian and on the website. Each
registered campaign index can define one fence of each type. An empty fence
derives its data from the vault. To reuse the data elsewhere, supply the lowercase
registry ID and any display options.

Website publication builds campaign records from the source vault, including
registered index notes, session notes, and bundles without public pages. A
published article can reference any registered campaign, including other
continuities. Links without a public destination appear as text. Publishing
a new content snapshot refreshes the website records.

Only the registered campaign index supplies `overrides` and `estimate`.
Fences on other notes use that index's values and their own display options.

~~~markdown
```taelgar-roster
campaign: dufr
playerRole: core
characterKind: member
columns: [character]
```

```taelgar-session
campaign: dufr
kinds: [adventure, solo]
columns: [session, played, account]
summary: [count, played, dr]
```
~~~

Roster columns are `player`, `role`, `character`, `attendance`, and `note`.
The default roster groups players by role when roles differ, shows documented
session links next to the character each player played, and gives companions
their own disclosure. Work as another character, including a one-session role
or a substitution, appears under Other appearances. Explicit columns select
a table layout. Set `characterPresence: true` to include play and character
presence in one session list per character. Each session appears once, with
a label where the play record and cast differ. A character-only view uses an inline name for one character
and a list for several. A member character defaults their player to
`core`. Guest-only players default to `other`. Companion and associated
affiliations can leave a player’s role unspecified. Past affiliations count.
Define exceptions in the index fence's `overrides` list. Use `player` for a
player-only override, or `character` with a quoted wikilink for a PC note.
Unlinked names can supply `description`. Override `role` or character `kind`
independently. A player entry can also carry `note` and `draft: true`.

Session columns are `session`, `title`, `played`, `dr`, `account`,
`characters`, `participants`, `people`, `evidence`, and `note`. The default list shows the
session number, Session Notes, played date, and in-world dates. The notes link
uses the descriptive session title where available. Numbered notes, arc
headings, and bundle recaps can supply the target. On narrow panes the list
stacks each row. Optional fields appear in an expandable panel below each session.
Choose `characters` for the in-world cast, `participants` for attendees
including the DM, or `people` to combine them. The combined view pairs
participants with their recorded roles, keeps cast-only characters, and
flags played roles that are missing from a known cast. Selecting both
`characters` and `participants` also produces the combined view. Omit all
three fields to hide participation details.

Session kinds are `adventure`, `solo`,
`inter-session`, and `meeting`. Quote point-session numbers.

The Session summary shows the number of adventures and solos played, the
real-world span, and the in-world span across the campaign. `summary: false`
shows the list alone. `summary: only` shows the summary alone. A list of
summary fields selects the specific entries. Summary ranges with exact
endpoints show elapsed time using the appropriate calendar. Published article
availability does not affect the local campaign record.

~~~markdown
```taelgar-session
overrides:
  - number: "35"
    played: "2021-12-05"
    note: Local play date.
  - number: "29.1"
    kind: solo
    attendance:
      - player: David Kong
  - id: organizing-meeting
    kind: meeting
    title: Organizing meeting
    date: "2022-11-22"
```
~~~

A date can be a quoted date, a mapping with `on` and `qualifier`, a window
with `from` and `through`, or an approximate `label`. An unresolved date can
hold `alternatives`. A list under `played` records distinct sittings for one
session. `dr` and `drEnd` override the in-world endpoints. By default, the
registered final session note supplies its `DR` and `DR_end`, with a single
date when `DR_end` is omitted. Other numbered notes and the bundle manifest
and recap supply dates where there is no dated final note. The `evidence`
field shows other recorded dates when the sources disagree. Date entries and overrides
can cite `evidence`. `account` can link to a particular note, heading, or block.
An index fence can also include an `estimate` mapping with a campaign-wide
`count`, optional `first` and `latest` numbers, and approximate `played` or
`dr` spans. An estimate supplies summary information without individual rows.

The session history tracks characters present in the story separately from
player attendance. Character presence comes from the preferred numbered
session note's nonempty `players` field. When there is no preferred note with
a cast, the reader combines named characters from the other numbered notes.
The bundle recap's `PCs` header is the fallback. Companions come from the
session notes' `companions` lists and cast entries classified as companions.
An explicit `characters` or `companions` list
on a session override replaces the corresponding source list. Use an empty
`characters: []` for known empty presence and `characters: null` for unknown
presence. An empty legacy `players` field can be a placeholder.

Recorded attendance uses named speakers and their game roles from speaker
statistics, with the matched manifest participant as fallback for the name
or role. The default is at least 30 seconds of attributed player speech across
speaker labels in that session. Speaker labels and attendance entries do not
add characters to the in-world cast. For sessions without a transcript or
speaker statistics, the original note or recap cast and usual player pairings
can supply inferred attendance. A `characters` override affects the in-world
cast and preserves that original attendance evidence.

An index `attendance` override supplies the complete attendance for its
session, taking precedence over speaker statistics and legacy inference.
Set `player` and, where known, `character` for the role played in that
session. Use `attendance: []` for known empty attendance and `attendance: null`
for unknown attendance. A missing name in a derived list means there is no
recorded appearance in that view.

## Search

Use the header search for names, aliases, or words from a note. Search
shows results directly below the field as you type, leaving the current article
in place. Previous and Next stay inside the dropdown. Use Escape or click outside
to dismiss it; select a result to open its article. Arrow keys move between the
search input and result links. On phones, the search icon reveals the field in
the header. Regular search URLs and forms remain available without JavaScript.
Words match together and include word beginnings; use double quotes for an exact phrase.
Results show relevant excerpts with highlighted matches and keep the selected
date, campaigns and Behind the Curtain view. Conditional and private prose only
appears when it is visible in that view. Generated headers, executable query
source and embedded copies of other notes are not indexed as authored prose.
Materialized query results are searchable after publication.

If full-text search is unavailable, the site shows a notice and falls back to
page-name matches. Search changes appear after a content publication, just like
article changes. Local previews build their search index on first use; restart
the preview after editing the source notes.

## Supporting files

The website also uses a few files that are not published as articles:

| File in the vault | Purpose |
| --- | --- |
| `.obsidian/metadata.json` | Shared defaults for names and header display. |
| `_sessions/campaign-registry.json` | Campaign IDs and paths to index notes. |

Changes to the two JSON files take effect after publishing content again.
Header logic lives in `src/header-core/`. Changes use the website code release
path and a separate plugin release. Historical comparisons use the
[checked-in reference fixtures](../tests/README.md#historical-header-comparisons).
See the [release rules](architecture.md#change-and-release-rules).


Regional artwork uses an explicit per-map `details` list of vault-root-relative
`.map-detail.json` paths. Keep each manifest beside its full-canvas PNG in a
publishable folder. The manifest anchors higher-resolution artwork to the existing
world frame; it does not change note `location` or `mapPath` coordinates. See
[regional artwork](map-editor.md#regional-artwork) for the schema and export workflow.


The Obsidian **Create map from image** command creates a new `.map.json` and map
note from a native-scale PNG, reusing a vault image or importing bytes from disk.
Defaults are `assets/maps/` for imports and `Maps/` for notes; the chosen paths
follow the normal publication rules. No content is published by creation. See
[creating a map](map-editor.md#create-a-map-from-an-image) for alignment and limits.


The desktop **Create map from Photoshop file** command also creates a PNG,
version 2 manifest, and map note, using local PSD/PSB artwork or public Dropbox shared links through
the bundled exporter and a configured Python environment. Export offsets are retained automatically.
[Configure Python and use shared links](map-editor.md#create-a-map-from-photoshop)
outside vault content; PSD sources and shared URLs are not published map assets.
