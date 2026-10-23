# Taelgarverse for Obsidian

Taelgarverse tools for desktop Obsidian: generated note headers and indexes, interactive maps,
distance measurement, freehand tracing, enclosed-area measurement, and an optional image viewer.

The plugin also evaluates plain Dataview queries for Taelgarverse website
publication. Keep Dataview enabled when publishing notes that still contain
queries. Node handles note cleanup, result insertion and assets; the plugin
does not modify vault notes or execute DataviewJS for publication. Reload
Taelgarverse after updating before running the publisher.

## Install with BRAT

1. Install **BRAT** from Obsidian's Community plugins and enable it (BRAT 1.1.0 or newer).
2. In BRAT, add `msackton/taelgarverse-obsidian` as a beta plugin.
3. Enable **Taelgarverse** in Community plugins.

BRAT can follow the latest release or pin an individual installation to a specific
version. Plugin files and BRAT preferences should stay outside vault Git tracking.

## Generated indexes

Turn off **Show header index popups** in Taelgarverse settings to hide these
buttons in Obsidian only. The setting defaults to on and applies immediately,
closing any open header popup. Inline `taelgar-index` blocks and website popups
are unaffected; no note metadata is changed.

Inline grids and tables start with an H2 heading matching the index label.

Residents, Settlements, Members, Rivers and Places grids use current vault
metadata and the selected in-world date. Enable header popup buttons with
`indexes: [residents, settlements]` on a place. Organizations tagged `group`
get Members automatically when `indexes` is omitted; `indexes: []` suppresses
it and an explicit list overrides the default. Buttons appear only with a `taelgar-header` block, at the bottom
of the generated header and outside the information callout.

For an inline grid:

````markdown
```taelgar-index
type: residents
mode: grid
show: both
```
````

`target` optionally names another note. `show` accepts `obsidian`, `website`, or
`both` (default). Residents includes living people whose active home is in the
place, including traveling residents; transients whose home is elsewhere are
excluded. Settlements follows
`typeOf: settlement`, and Members follows active affiliations and leadership.
Residents and Settlements include contained locations by default; Members
matches the direct organization. Override this with `recursive: true` or `false`.
Cards show available lead images from note `image` frontmatter. People cards
include pronouns and pronunciation when available; settlement cards also show
pronunciation. Residents cards show Info, Current Location and Home. Members
cards show Info, the first authored prose sentence, and roles. Descriptions skip
callouts, headings, code, lists, tables and image-only paragraphs. Set `mode: table`
inline to show Person (name, pronouns, pronunciation), Info (ancestry and main
type), Current Location (last-known chain and date), and Home for Residents and Members.
Member tables show Person (name, pronouns, pronunciation),
Info (ancestry and main type), Current Location (last-known location chain
and date), and Home, following the existing `isAffiliated` and header-template rules.
Settlement tables show Place, Region,
Type Of, and Population, sorted by dated home region, with the same type and
population formatting as headers. Settlements includes ruins and matches
current, last-known and secondary locations using the existing location rules.
Table rows have no image column; popups always use image grids.
Grids and buttons refresh when vault metadata or calendar dates change. Notes
remain editable and are never rewritten.

Rivers lists waterway and lake notes in a place or watershed, including secondary watershed
membership. Places lists contained place notes, including buildings in town
quarters. Inline Places blocks accept `placeType: built` or `placeType: natural`;
omit it for all types. These select communities/structures/infrastructure or
geographic regions/biomes/water features/landforms by `typeOf`. Extraplanar and
unclassified types remain in unfiltered results only. Enable the default header
buttons with `indexes: [rivers]` or `indexes: [places]`, or use
the same type in an inline `taelgar-index` block. Their compact tables show
River/Place and Type Of; recursive containment is enabled by default.

## Generated headers

Version 0.3.0 adds an empty `taelgar-header` code block that generates a note's
complete header from frontmatter, using the shared Taelgarverse header rules:

````markdown
```taelgar-header
```
````

Place it immediately after frontmatter, replacing the old generated title,
pronunciation and information callout. Keep the frontmatter. The block includes
the H1 title, so remove a separate H1 above it. Notes are not migrated automatically.

Headers include pronunciation, biographical details, dates, affiliations and
location chains. They refresh after metadata or calendar-date changes and show
a clear error for circular relationships. In Live Preview, the header keeps its
native callout styling without a code-block edit button or hover frame. Use
Source mode to edit the fence.

Header blocks require the Taelgar vault's `metadata.json` in its Obsidian
configuration folder and `_scripts/session_note_campaigns.json`. Dataview and
CustomJS are not required for these blocks; existing body queries still need
their existing plugins. Dates follow an active CustomJS override, the note's
`pageTargetDate`, Fantasy Calendar, or Taelgar's Calendarium calendar, in that
order. Otherwise, they use the latest campaign session date, falling back to
DR 1750-01-01.

## Campaign interactions

The plugin automatically adds a **Campaign interactions** panel at the bottom
of any note with at least one registered campaign in `knownTo`, in Reading View
and Live Preview. Scalar and list values work; registry names, codes, and aliases
resolve to the same campaign. A single campaign opens directly. Multiple
campaigns get a **Campaign** selector directly below the heading, with **All**
selected by default to show them together. The choice is retained while the
plugin is running. Source mode stays unchanged.

When the selected campaign has no visible timeline entries, it retains the same
campaign-name heading and **Known to party** status line as a full timeline,
with compact spacing and any related campaign links below it. The **Campaign
interactions** heading and campaign picker stay above the content; choosing a
campaign with recorded sessions adds its timeline below the same header. This applies
to automatic footers and explicit blocks.

Click or tap an individual dot to open a compact popup containing its date,
details, and source links. Details stay closed initially, and one popup is shown
at a time across campaigns. Close it with its close button, Escape, an outside
click, or the same dot. Campaign changes also close it. Keyboard
users can activate dots with Enter or Space; Escape returns focus to the dot.
Session references contain only the title, date, and a link such as **Session 30**.
They omit explanatory commentary and repeated session titles. Recap-backed
popups show the full session's title, dates, tagline, and optional session link.
Only resolved NPCs explicitly marked `met` in the recap's Cast qualify, including
combined statuses such as `met, fought`. Mention-only and other statuses do not.
Cast membership alone selects sessions. Beats, their NPC lists, Short/Long text,
locations, and transcripts are ignored. Each session has one dot even when
multiple sessions share a date. Dots open their popup directly, without beat zoom.
Each dot shows its session title and date, even in long histories. The official
session note's `descTitle`, `DR`, `DR_end`, and `tagline` supply display metadata, falling
back to the recap header. Titles use up to two lines; hover or open
the popup for the complete title. Dots wrap into rows, with two columns on narrow screens.

Recap sessions contribute encounter dots and counts. Sessions without a recap use
explicit NPC links in the official session note as hollow **Session reference**
dots, counted separately, with the session date and a native note link. An
existing recap suppresses this fallback for the entire session. The registry
filename wins; a unique legacy metadata candidate is also supported.

**Related campaign material**
groups links on separate **Items** (`object`/`item`), **Stories** (`story`), and
**Sources** (`source`/`document`) lines, with a **References** line for other types.
Empty categories are omitted. A note appears once; item tags take precedence over
story tags, then source tags.
Untagged notes and notes with `meta` or `background` tags are excluded, including
nested tags. A source note's `knownTo` flag does not bypass these exclusions.
Links run horizontally within each category and wrap as needed. Each line shows
its first ten links; **Show more** reveals the rest in the same layout. Links open
their notes natively. Undated sessions retain their session labels without
inventing a date.

To choose the panel's position, add an empty block:

````markdown
```taelgar-interactions
```
````

An explicit block suppresses the automatic footer for that note. Code examples
inside another fence do not suppress it. The **Automatic campaign interactions**
setting turns automatic footers off immediately; explicit blocks continue to
work. Rendering never inserts fences, modifies frontmatter, or saves note text.

The session dots, dates, and taglines use the same session-header/Cast parser and
interaction model as the website. Session notes supply source links, and
non-session campaign material supplies separate references. Only missing-recap
sessions use session-note bodies, to identify explicit links and preserve their
conditional visibility; no prose summary is generated. Raw transcripts are not
interaction inputs. Links open full session notes and
campaign references natively in Obsidian; beat and transcript links are omitted,
including modified clicks to open another pane.

Interactions require `_scripts/session_note_campaigns.json`. Session membership
come from local `_sessions/<campaign>/<session>/cleaned/*-session-recap.md` files;
sessions without those files use the official session-note fallback.
They do not require a website connection, Dataview, CustomJS, or header display
metadata. Dates follow the header's override, note date, calendar, and fallback
order. This is a local author view: DM text is available and website publication
exclusions do not restrict local notes. Campaign/date conditions still apply.

The index is shared across open notes and refreshed after metadata, recap,
registry, and file changes. Calendar changes refresh visible panels within two
seconds. Closing notes or unloading the plugin disposes panels, observers, and
timers. The website consumes the empty placement fence without showing a code
frame and retains its normal campaign-history section.

## Generated indexes

Residents, Settlements, Members, Rivers and Places grids are calculated from vault metadata. Put
`indexes: [residents, settlements]` in a place's frontmatter to add popup buttons at the bottom of
its `taelgar-header` block, below and outside the information callout. Organizations tagged
`group` get Members automatically when `indexes` is omitted; set `indexes: []` to suppress it or
provide an explicit list to choose header indexes. Ordinary
Markdown titles and saved headers do not receive buttons. Use a `taelgar-index` fence
containing `type: residents`, `type: settlements`, `type: members`,
`type: rivers`, or `type: places` for an
inline grid. Inline grids and tables start with an H2 heading matching the index
label. Optional `target` selects another note, `show` selects `obsidian`,
`website`, or `both`, and `recursive` controls location/organization containment.
Grid cards show available local images from each note's `image` frontmatter.
People cards include pronouns and name pronunciation when available, using the
same name formatting as tables. Settlement cards also include pronunciation.
Use `mode: table` inline for Person (name, pronouns, pronunciation), Info (ancestry
and main type), Current Location (last-known chain and date), and Home on Residents.
Residents includes living people whose active home is in the place, including
traveling residents. Transients whose home is elsewhere are excluded. Residents
cards show Current Location and Home; Members cards show the member note's first
authored sentence and roles instead of location fields. Descriptions skip callouts,
headings, code, lists, tables and image-only paragraphs before selecting prose.
Member tables show Person (name, pronouns,
pronunciation), Info (ancestry and main type), Current Location (last-known
location chain and date), and Home, using the existing query's header templates
and affiliation-date rules. Settlement tables show
Place, Region, Type Of, and Population, sorted by their dated home region.
Settlements includes ruins and matches current, last-known and secondary
locations using the existing `inLocation(..., true, true, date)` rules.
Rivers follows `typeOf: waterway` or `typeOf: lake` and includes secondary watershed membership.
Places lists contained place notes, such as a town's quarters, buildings and shops.
Inline Places blocks accept `placeType: built` or `placeType: natural`; omit the
option for all types. Built covers communities, structures and infrastructure;
natural covers geographic regions, biomes, water features and landforms, using
`typeOf`. Extraplanar and unclassified types remain in unfiltered results only.
The filter applies to results while containment still follows all ancestor types.
Use `indexes: [rivers]` or `indexes: [places]` for header buttons. Their tables
have River/Place and Type Of columns, sorted by type then name. Both follow dated
nested location chains by default; set `recursive: false` for direct matches.
`mode: grid` is the default; popups always use grids.
See [generated indexes](../../docs/vault.md#generated-indexes) for defaults,
date semantics, website visibility, and complete examples. Grids refresh from
current metadata without Dataview or CustomJS. Source mode keeps the YAML editable.

## Maps

Use a `taelgar-map` code block containing your existing map definition:

````markdown
```taelgar-map
image: [[My Map.png]]
bounds: [[0, 0], [100, 200]]
height: 600px
```
````

Copy the image into your vault. Add your map's verified calibration to measure
physical distances; without calibration or a scale, measurements use map units.
Definitions and calibration have the same meaning on the Taelgarverse website.

The separate **Obsidian Leaflet** plugin can remain enabled: Taelgarverse claims
only `taelgar-map` blocks by default. Existing `leaflet` blocks stay with their
current renderer. To use Taelgarverse for old blocks, disable other map renderers,
enable **Render legacy leaflet blocks** in Taelgarverse settings, then restart
Obsidian. Disable the former **Taelgar Map Tools** plugin during migration.

The plugin reads local images and does not rewrite notes. Measurements are
temporary and are cleared when the rendered map closes. Requires desktop
Obsidian 1.8.0 or newer.

## Images

Turn on **Image viewer** in Taelgarverse settings to add the website's image
viewer to Reading View and Live Preview. It is off by default and applies
immediately. Click an image or its expand icon to view it fitted to the window,
then choose **Pan / zoom** for dragging, +/−, keyboard, wheel, and pinch controls.
**Fit to screen**, **Download**, Close, and Escape work as on the website.
Captions in image callouts, gallery items, and HTML figures appear in the viewer.
Images without captions use their alt text.

Inline image callouts and embeds honor left/right placement and named sizes.
Figures center, heroes span the note, and galleries use a responsive grid.
Captions stay with images, and asides stack on narrow displays. No extra vault
CSS snippet is required; these styles use the same Image viewer switch.

Linked images and modified clicks keep their existing behavior. The feature uses
local original images and preserves notes; it generates no thumbnails or map
tiles. Disable the setting to remove its controls without changing map features.

## Development

This repository distributes releases. Source, shared website code, tests, and
release instructions live in [taelgarverse-core](https://github.com/msackton/taelgarverse-core/tree/main/obsidian/taelgarverse).
Each release includes its source commit in `release.json`. Licensed under
GPL-3.0; bundled libraries retain their license notices.

## Static website export

The plugin includes an opt-in static-site materializer. Native headers, indexes
and interactions export as Markdown, and taelgar-map fences become leaflet.
Existing Dataview/CustomJS export behavior remains available. Source notes are
unchanged. The legacy site retains its original materializer by default; its
`TAELGAR_MATERIALIZER` override can select core's `scripts/materialize-static.mjs`.
The taelgar.org publisher defaults to plain DQL in Node, without a running
Obsidian app. Its explicit `--materializer obsidian` option uses this plugin's
website DQL mode, leaving native blocks dynamic through the shared Node
conversion/publishing pipeline. See the core publishing-pipelines guide.
