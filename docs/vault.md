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

The underscore rule applies to **folders**: a file named `_example.md` can still
be included. Likewise, `assets/dm-map.png` is included; it is outside `assets/dm/`.
Tags such as `excalidraw` or `status/check/ai` do not prevent publication.

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

The website working copy also skips underscore folders and `.nopublish` folders
at every depth, including their media and descendants. They are not copied or
indexed by Node Dataview. Explicit homepage, menu, and session inputs still read
their configured files in the original vault. Explicit `mapPath.source` references
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
| `headerVersion`, `tags` | Whether and how the usual note header is generated. Existing type tags also supply the website's [search content-type filters](search.md#app-search). Keep these from the appropriate vault template. |
| `species`, `ancestry`, `typeOf`, `pronunciation` | Descriptions and pronunciation in the header. |
| `displayDefaults`, `ddbLink` | Header formatting and a link to game mechanics. |
| `born`, `created`, `died`, `destroyed`, `DR`, `DR_end` | Ages, lifespans, and event dates. |
| `whereabouts`, `partOf`, `affiliations`, `leaderOf`, `campaignInfo` | Locations, relationships, leadership, and campaign events, using the selected date. |
| `excludePublish`, `activeYear` | Whether the page is shown, as explained below. |

Related notes also matter: a location or affiliation may use another note's name
and properties. The selected website date takes priority over `pageTargetDate`.
The usual header is rebuilt for that date; you do not need to edit its displayed
age or location by hand.

## Generated bio block

To render the existing note header from frontmatter, put this empty block
immediately after the frontmatter, replacing the saved title and information
callout:

````markdown
```taelgar-header
```
````

Keep the note's frontmatter, including `headerVersion` when present. The website
uses the selected date and campaign as usual, with the same header styling.
The block renders the complete header, including one H1 title, pronunciation,
and the remaining details. To supply a custom title, put a Markdown H1 directly
above the block; blank lines may separate them. That heading is preserved and
the block omits its generated H1 while still rendering pronunciation, details,
and index controls. Both `# Custom title` and a title underlined with `===`
work. An H2 or an earlier H1 separated by prose or another block does not
suppress the generated title. The Taelgarverse Obsidian development plugin uses
the familiar native information callout with values filled in. Rendering does
not modify the note.
In Obsidian, pronunciation sits directly beneath the name without the normal
heading-to-paragraph gap; this spacing applies only to generated bios with pronunciation.
Generated bios use the note's normal spacing after the callout when there are no
index buttons. When buttons are present, their row supplies the spacing.
Existing saved headers and prepared HTML header markers remain supported;
an older materializer's marker before the new block is removed on the website,
while an adjacent authored H1 is retained.
The block is omitted from note transclusions and authored search/backlink text.
Node, Worker and the development plugin use the same maintained header core;
the vault's legacy CustomJS scripts are not required to render these blocks.
Circular location or organization chains show a header error instead of a
partial header or a stack overflow.

The block must be empty and at the start of the note body, optionally preceded
by that authored H1. Examples inside other
code fences stay literal. Replacing existing vault headers is a separate,
explicit edit; enabling support does not migrate notes automatically.

Content preparation normalizes old `<!-- taelgar:header -->` markers (including
the `<!-- taelgar-header -->` spelling), detected versioned generated headers,
and native fences into one leading empty `taelgar-header` fence, preserving an
authored H1 immediately before an existing native fence.
This runs in Node before content hashes, search, backlinks, or media discovery;
it accepts raw notes or materializer exports without modifying the vault.
Frontmatter and authored content are retained. Invalid explicit blocks stop
preparation with the source path. The existing snapshot schema is unchanged.
Deploy website support before publishing these newly normalized snapshots;
the new renderer can read older R2 markers without a content migration.

## Generated indexes

Enable popup buttons at the bottom of a `taelgar-header` block with an array in
frontmatter:

```yaml
indexes: [residents, settlements]
```

For a watershed use `indexes: [rivers]`; for a town use `indexes: [places]`.
For an organization (`tags: [group]`), Members is enabled automatically when
`indexes` is omitted. Set `indexes: []` to suppress it, or provide another
valid array to choose the header indexes explicitly. Types can be combined in
one array. Repeated entries produce one button; unknown names and mappings
such as `indexes: {members: true}` show an author-visible error.
The button row sits below the complete generated header, outside its information
callout. An ordinary Markdown title or saved header does not receive buttons;
use the new `taelgar-header` block. Header buttons show only their label. A
first-match existence check hides empty buttons for the selected date and
visibility context; it does not format or sort the full index. Opening a button
calculates its rows, resolves images, and builds its card grid. Obsidian reuses
its snapshot-bound query cache; the website fetches context-filtered HTML from
`/api/index` on first activation. Closing and reopening reuses the loaded popup
until its header is refreshed. Failed loads can be retried by reopening. Date
or metadata changes refresh Obsidian headers and discard stale popup bodies.
Grids show their result count except for Members, which omits it.
Inline indexes continue to calculate immediately and show empty-result messages.
Without browser dialog support, the button expands the grid in place. Without
JavaScript, website buttons include a link to the index content.

| Index | Results at the selected in-world date |
| --- | --- |
| `residents` | Living people whose active home is in the target place or a contained location, following `homeLocation(target, metadata, false, date)`. Traveling residents remain included; transients whose home is elsewhere are excluded, even when their current, secondary or last-known location is here. |
| `settlements` | Places with `typeOf: settlement` within the target place, including nested regions and destroyed settlements, but excluding places not yet created. Matches the current location, or last-known location when current is unknown, and also secondary locations. |
| `members` | People with an active affiliation or leadership relationship to the target organization, following `isAffiliated(target, file, date)`. Direct membership is the default; past memberships are excluded. |
| `rivers` | Place notes with `typeOf: waterway` or `typeOf: lake` in the target place or watershed. Always includes lakes alongside rivers, streams, brooks and other waterway subtypes; marine features are excluded. Membership follows primary/current, last-known and secondary `whereabouts`, including secondary watershed membership and nested tributary locations. |
| `places` | All place notes within the target place, typically a town's buildings, landmarks and quarters. Optional `placeType: built` or `placeType: natural` filters the results. Includes places nested within quarters or other contained locations, and excludes the target itself, people and organizations. |

Location containment follows the dated `whereabouts` chain, including the legacy
place `partOf` fallback. Members compare resolved organization identities, so
aliases and full paths work. Place containment follows both current and
secondary locations on each ancestor. Settlements matches `inLocation(target,
metadata, true, true, date)`. Settlement results sort by their immediate dated home region,
then displayed name; people sort by displayed name. Rivers and Places sort by
displayed type, then name. Paths break ties. Rivers and Places exclude locations
not yet created, but retain destroyed locations, matching Settlements. Watershed
membership is read from `whereabouts`, not inferred from prose or folders.
Members use the affiliation's inclusive start/end dates directly. An omitted
end date defaults to the person's death date when known; explicit affiliation
dates retain the helper's behavior, without an additional living-person filter.
People cards show Person and Info using the same templates as tables. Residents
cards also show Current Location and Home. Member cards show the member note's
first authored sentence and roles instead of location fields.
Descriptions come from the first ordinary prose paragraph after filtering
comments for the selected date, campaigns and DM mode. Headings, callouts and
other blockquotes, code, lists, tables, and image-only paragraphs are skipped.
Wikilink aliases and Markdown link labels become plain text. The website loads
visible members' bodies when rendering a grid, including header popups and
inline indexes; existing published snapshots support this without republication.
Names include available pronouns and pronunciation. The displayed current or
last-known location can differ from the home used to select Residents.
Settlement cards show population when numeric.
Grid cards show the linked note's lead image when its `image` frontmatter field
resolves to a local image file. For example, use `image: alice.png` or
`image: "[[portraits/alice.png]]"`. Missing, ambiguous, or unavailable images
are omitted. Images embedded only in the body are not selected automatically.
Settlement cards also show pronunciation when available.
Missing values are omitted. Cyclic relationship chains omit affected candidates
and show a warning without preventing the rest of the index from rendering.

To place an index inline anywhere in a note, use:

````markdown
```taelgar-index
type: residents
mode: grid
show: both
```
````

| Block option | Values and default |
| --- | --- |
| `type` | Required: `residents`, `settlements`, `members`, `rivers`, or `places`. |
| `target` | Note name, alias, or path; defaults to the note containing the block. Quote wikilinks, for example `target: "[[Cleenseau]]"`. Explicit `./` and `../` paths are relative to the containing note. |
| `show` | `obsidian`, `website`, or `both` (default). The other renderer omits the entire block. Source mode still shows the editable definition. |
| `mode` | `grid` (default) or `table`. Header popups always use the grid. |
| `placeType` | Places only: `built` or `natural`. Omit to include all place types. Classification uses the note's `typeOf`, not its name or `typeOfAlias`. |
| `heading` | Boolean, defaults to `true`. Set `false` to omit the inline index's H2 title. Table column headings, grid counts, and popup titles are unaffected. |
| `recursive` | Boolean. Defaults to `true` for Residents, Settlements, Rivers and Places, and `false` for Members. `false` matches only the immediate location or organization; recursive Members also includes organizations connected through `partOf`. |

Residents, Settlements, Rivers and Places require a place target; Members
requires a group target. Rivers can also list waterways and lakes in a barony or other
place; Places is not restricted to towns.

Places filters follow the vault's broad Place Categories:

| Filter | Included `typeOf` values |
| --- | --- |
| `built` | `settlement`, `neighborhood`, `realm`, `inn`, `building`, `holy site`, `road`, `infrastructure`, `battlefield` |
| `natural` | `region`, `watershed`, `forest`, `wetlands`, `desert`, `grassland`, `waterway`, `lake`, `marine feature`, `topographical feature`, `subterranean feature`, `island` |

The documented legacy spelling `topographic feature` also matches `natural`.
These are metadata groups: realms belong to the community group, and waterways
remain natural for this filter even when their display alias is canal.
Extraplanar types and missing or unrecognized types appear in unfiltered Places
but neither filtered category. Filtering selects results, not ancestors: a built
shrine inside a forest still appears in recursive built results, and natural
features inside a neighborhood still appear in recursive natural results.
Date, visibility and `recursive` rules apply as usual. The option does not change
note metadata. Header `indexes: [places]` buttons continue to show all types.

For example, place this on a town to list its buildings and other built places;
use `placeType: natural` for its natural features:

````markdown
```taelgar-index
type: places
placeType: built
mode: table
```
````

Invalid definitions show a local error while leaving the article readable.
Inline blocks in transcluded notes use that note as their default target.
By default, every inline grid or table starts with an H2 heading matching the index label
(Residents, Settlements, Members, Rivers or Places). Set `heading: false` when an
authored heading already supplies that context, for example:

````markdown
```taelgar-index
type: settlements
mode: table
heading: false
```
````

This option works in both Obsidian and the website, including empty indexes.

Rivers tables have **River** and **Type Of** columns. Places tables have **Place**
and **Type Of** columns. Both include available name pronunciation and use the
same type formatting as headers. Their grids use available lead images. For
example, use `type: rivers` on a watershed or `type: places` on a town, with
`mode: table` for the compact two-column view. Both support explicit `target`,
`show` and `recursive` options like the existing indexes.

Tables use compact rows, regular-weight links, and a single rule below the
column headings, without a separate result-count line.

With `mode: table`, Residents have four columns, using the existing people query's
header templates:

| Column | Template |
| --- | --- |
| Person | `<name> (<pronouns> <pronunciation>)` |
| Info | `<ancestry> <maintype>` |
| Current Location | `<lastknown:2> (<lastknowndate>)` |
| Home | `<home:1>` |

Current Location includes the first two locations, including regions, following
the hierarchy at the last-known date. Home shows the immediate home at the
selected date. Residents are selected by home; their displayed current or
last-known location may be elsewhere. Empty home
or location values show **Unknown**. All calculations use the selected date;
the legacy helper's `includeDead` parameter is explicitly `false` for Residents.
Resolvable names link to their pages, and website-hidden destinations show
**Unknown**. Table rows have no image column.

Member tables have four columns, using the existing query's header templates:

| Column | Template |
| --- | --- |
| Person | `<name> (<pronouns> <pronunciation>)` |
| Info | `<ancestry> <maintype>` |
| Current Location | `<lastknown:2Fr> (<lastknowndate>)` |
| Home | `<home:1>` |

Pronouns use explicit `pronouns` or the header's gender fallback; empty optional
values and parentheses are removed by the formatter. Info honors ancestry and
main-type aliases, with species taking precedence for the main type. Current
Location shows the last-known location chain and observation date, even after
travel has ended. It includes the first location, excludes subsequent regions,
and limits the chain to two counted locations. The chain follows the hierarchy
at the last-known date, and the date retains its original precision. Resolved
names link to their pages; website-hidden destinations show **Unknown**.

Settlement tables have four columns: **Place**, **Region**, **Type Of**, and
**Population**. Place includes pronunciation when available. Region is the
immediate dated home location (`<home:1>`), even when inclusion matched a
secondary or last-known location. Type Of uses the header's `<maintype>` rules,
including `typeOfAlias`; Population uses `<population>` formatting, including
the `pop.` prefix, numeric separators and textual values. Missing type or
population shows an em dash. For example:

````markdown
```taelgar-index
type: settlements
mode: table
show: both
```
````

Obsidian queries current vault metadata and follows the same date-selection
order as generated bios. Open indexes and header buttons refresh after metadata
changes, renames, deletions, or calendar/override date changes. Repeated author-view
queries reuse results for the same metadata snapshot, date and target; refreshing
metadata discards those results. Obsidian's own
note resolver and links are used; publication exclusions do not restrict the
local vault view. The shared metadata and campaign registry files listed below
are required when rendering indexes, as for bios.

The website calculates results from the latest published metadata at request
time. It applies the selected date, campaign exclusions, and POV preference
before generating cards or counts, and preserves the reader's context in links.
Editing the vault requires content publication before the website sees the
change. Index fences survive export and publication as definitions; results are
not frozen by the materializer. Deploy website support before publishing notes
that use them. Generated rows do not become authored search text or backlinks.

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
`DR_end` or `DR`. Publication exclusions apply to this date choice. Templates,
private/generated folders, Worldbuilding, and `.nopublish` folders are excluded
before selecting sessions, as in the website's source store. A latest session
without a usable date makes its campaign unavailable; the calendar does not
silently pick an older session. Unavailable campaigns stay in the legend without
a dot. **Latest campaign date** uses the latest dated campaign, falling back to
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

| Reader's choice | What it means |
| --- | --- |
| A named campaign | Use that campaign's latest session date and show text marked for that campaign. |
| Modern | Use the latest date across the campaigns. Campaign-specific text stays hidden. |
| Custom | Use a date chosen by the reader and select All campaigns, an individual subset, or no campaigns. |

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

A session excluded with `excludePublish: all` or that campaign's code is not used.
If the latest remaining session has no full date, the campaign cannot be selected,
even if an older session has one. A flashback can move the campaign's date backward.

Campaign names and codes come from `_scripts/session_note_campaigns.json`.
For example, **Dunmar Frontier** uses the code **`dufr`** in comment markers and
`excludePublish`. The note's `campaign` property can match the registered name,
code, ID, or alias.

To change a campaign's date, correct its session note and republish. Existing
campaign links will then use the updated date; links to a Custom date keep that
date. The [current campaign list](https://taelgarverse.msackton.workers.dev/api/contexts)
shows the dates and which notes supplied them.

## When a page is shown

These properties hide a whole page:

| Property | Effect |
| --- | --- |
| `excludePublish: all` | Hide the page in every view. |
| `excludePublish: [dufr]` | Hide the page when Dunmar Frontier is selected, including in Custom. It can still appear in Modern or selections that omit Dunmar Frontier. |
| `born` or `created` after the selected date | Hide the page until that date. If both are present, `born` is used. |
| `activeYear` after the selected date | Hide the page until it becomes active. |
| Dated `POV` after the selected date, with `pov=1` or an enabled site default | Treat the page as not yet born; hide it until its POV date. |

`excludePublish` can also contain several campaign codes, as a YAML list or a
comma-separated string. Codes are matched regardless of capitalization.
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

POV filtering is an optional reader preference. Add `pov=1` to a website URL
to try it, for example `/?context=addermarch&pov=1`, or `&pov=1` when the URL
already has query parameters. Use `pov=0` to turn it off. The choice travels
through article links, navigation, search, and context changes, including
campaign sites. It is kept in URLs, so a bookmark or shared link keeps the choice;
a fresh URL without `pov` follows the site default. No new control appears for
ordinary visitors. The API also accepts `pov=true` and `pov=false`.

The site-wide `respect_pov_dates` setting supplies the default when `pov` is
omitted. It defaults to `false`, including in older snapshots. A reader can
override either default unless the microsite landing page sets `enforcePoV: 1`
or `enforcePoV: 0`, which fixes that host's mode. See
[microsite POV filtering](campaign-sites.md#pov-date-filtering) and
[configuration settings](deploy.md#configuration-settings).
Birth/creation, activity, and campaign exclusions still apply in both modes.

When enabled, dated `POV` uses the beginning of its stated period: `POV: 1740`,
`POV: "1740"`, and `POV: 1740s` all make the page available on January 1,
1740. A year-month starts on its first day; a full date starts on that day.
The page becomes available on the latest of its birth/creation, activity, and POV
dates. Missing, invalid, or nondated POV values such as `modern` and `undated`
add no date restriction.

Hidden pages disappear from search and navigation. Links to them keep their text
but cannot be clicked; opening their address gives “Page unavailable.”

**Readers can choose any campaign and turn on See Behind the Curtain.** These
choices do not require a login. That option reveals comments, but never overrides
the whole-page rules above. `knownTo`, nondated POV/audience notes, and status
tags do not limit who can read a page.

A hidden page's properties may still contribute to other pages' headers. Its
images and other media can still be opened separately. Ordinary prose does not
change with the selected date unless you mark it as described below.

## Comments and text for particular campaigns or dates

An ordinary Obsidian comment, `%% like this %%`, is hidden by default. With
**See Behind the Curtain** enabled, it becomes a numbered popup note. Comments
inside a section hidden for the current campaign or date stay hidden.

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
links when their campaign is selected, including Custom subsets. Modern and
Custom without campaigns show shared reference sources. Custom All campaigns
also includes unrecognized campaign sources. Campaign ownership comes from the
source note's `campaign` property or its registered campaign folder. This does
not change whether those articles can be opened directly.
Generated header relationships and links back to the same article are excluded.
On person-tagged NPC pages, **Linked from** also excludes session notes and other
campaign material in every view, including Modern and Behind the Curtain.
Their campaign history belongs in **Campaign interactions**; shared world
references remain in **Linked from**. Backlinks on other article types keep the
normal campaign filtering described above.
Nonempty backlinks appear in the right sidebar even on short articles; on mobile they
appear in a collapsed **Linked from** section below the article.

Person pages also show a **Campaign interactions** summary and session dot history
for the intersection of the page's registered `knownTo` campaigns and the active
context's campaigns, without a component campaign picker. An empty intersection
means no component. `knownTo` supplies undated party knowledge and
`campaignInfo` retains its normal header wording. Authoritative recap entries
supply one encounter per session for resolved NPCs explicitly marked `met` in
the recap's Cast. Mention-only and other statuses do not qualify; combined
statuses containing `met` do. Cast membership alone selects sessions; beats,
their NPC lists, Short/Long text, and transcripts are ignored. The available
session note's `descTitle`, `DR`, `DR_end`, and `tagline` supply
the popup's title, dates, and description, falling back to the recap Session Header. Session
notes supply optional full-session links. If a session has no recap file, its official
session note's explicit NPC links supply hollow **Session reference** dots, counted
separately from encounters, with session dates and a note link. The registry
filename wins, with a unique legacy metadata candidate as a fallback; ambiguous
notes supply no dots. An existing recap suppresses note fallback for the whole
session, even when its Cast contains no met entry for the person. Non-session
campaign-folder backlinks supply separate links under **Related campaign material**. Untagged sources and
sources with `meta` or `background` tags (including nested tags) are excluded.
Related links run horizontally with wrapping on separate Items, Stories, Sources, and other References lines,
based on authored tags, each showing up to ten links before **Show more** for longer lists.
Selecting a dot opens its details in a compact popup with DR dates and links to
available full session notes. Beat and transcript links are omitted. Popups start closed
and dismiss with their close button, Escape, an outside click, or selecting the
dot again. Missing source links never
remove session encounters.
Session references show only title, date, and a session-number link, with no
explanatory commentary or repeated session titles. Recap sessions show only
session-level information; they never combine beat details.
Each session keeps a separate dot, even on the same recorded day. Dots open
their popups directly without beat drill-down or zoom.
Dots show their title and date even in long histories. Labels wrap across rows, with
two-line titles and full text in the popup.
This does not infer encounters from mentions or filter page availability by party
knowledge. See [campaign interaction sources and rules](campaign-interactions.md).

The Obsidian plugin offers the same dots through an empty `taelgar-interactions`
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

Click a linked node to preview its article in a popup, then use **Open page** to
navigate. Uncheck **Preview linked pages** below the diagram for direct navigation;
modified clicks retain normal browser behavior. Links also work in **See bigger**.
Explicit `_blank` destinations open a new tab; HTTP(S) and mail links navigate
normally. Closing a preview returns focus to the node. Mermaid stays in strict
mode; authored JavaScript callbacks and nonstandard URL schemes are not enabled.
The `/api/diagram-links` endpoint resolves a bounded batch against the current
source/context metadata; previews use the existing context-filtered page API.

## Interactive maps

Fenced `taelgar-map` and legacy `leaflet` blocks render as interactive image maps.
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
Use `taelgar-map` for new notes so the plugin can coexist with Obsidian Leaflet.
Existing `leaflet` blocks require opting into legacy support in Taelgarverse,
with other map renderers disabled, or changing only their opening fence label.
Returning to the start or choosing **Close shape** closes an outline and shows
its enclosed area in square miles alongside the distance. Separate outlines
have separate readings; crossed outlines report that area is unavailable.
The current Taelgar maps record their verified **24-mile hex** calibration inside
each `leaflet` block: `calibration.hexMiles`, `hexPixels` in original image pixels,
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
date/campaign/POV visibility and publication exclusions. The editor can trace
or edit them, writes the geometry file, and patches only that note field on Save; see [rivers and roads](map-editor.md#rivers-and-roads)
and the [metadata schema](../schemas/map-path.schema.json).

Other images may be made smaller during publication. See
[image settings](deploy.md#image-settings).

## Dataview and other generated content

The taelgar.org publisher copies the vault into a working directory and
materializes supported plain Dataview queries in Node by default. Obsidian can
be closed. `--materializer obsidian` selects the new Taelgarverse materializer's
website DQL mode in the open source vault. Both choices leave native blocks
intact for the same conversion and dynamic rendering stages.
The Node backend fetches a pinned GitHub Dataview release into core's local
cache and uses built-in settings; it does not depend on the vault's Dataview
installation. `--dataview-directory` explicitly selects another verified bundle
and its optional saved settings. See [dependency caching](publishing-pipelines.md#taelgarorg).
Those query results are static until republication; changing the website's
campaign or date does not rerun DQL. Queries on pages marked
`excludePublish: all` are not evaluated. Node indexes the remaining working copy,
excluding underscore folders and any subtree marked `.nopublish`. The optional
Obsidian backend uses its live vault index, which can include those folders;
queries depending on excluded notes can therefore differ between backends.
Current-page chronology scans remain unsupported in Node. The Obsidian backend
evaluates selected closed DQL blocks normally through Dataview, including those
scans, and reports Dataview errors or per-query timeouts under the same
strict/`--no-strict` policy as other queries.

A separate Node conversion pass then normalizes known saved headers into
`taelgar-header` and recognizes complete supported DataviewJS index patterns,
rewriting them to `taelgar-index`. A recognized campaign-interactions view becomes
`taelgar-interactions`. No JavaScript is executed. Native indexes use the reader's
current context. The original vault notes remain unchanged.

Unrecognized closed DataviewJS blocks and headings made empty by their removal
retain the existing omission policy. Every unmatched block is listed in the
conversion report. Remaining unsupported DQL and inline expressions show
warnings or unavailable-content messages. The website does not execute scripts.
HTML in the normal article body remains supported.

The old static site keeps its original Obsidian materializer by default. An
explicit override selects Taelgarverse's materializer, which renders
native headers/indexes/interactions to static Markdown, changes `taelgar-map`
fences to `leaflet`, and retains legacy Dataview, DataviewJS, supported inline
expressions and CustomJS header behavior. See [publishing pipelines](publishing-pipelines.md).

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
| `_scripts/session_note_campaigns.json` | Campaign names, codes, aliases, and folder information. |

Changes to the two JSON files take effect after publishing content again.
Header logic is maintained in this repository's `src/header-core/`; changes use
the website code release path and a separate plugin release. The vault's
`_scripts/customJS/` still belongs to the legacy materializer and compatibility
tests, and changes there do not update the new header core. See the
[release rules](architecture.md#change-and-release-rules).


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
