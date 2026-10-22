# Taelgarverse for Obsidian

Taelgarverse tools for desktop Obsidian: generated note headers and indexes, interactive maps,
distance measurement, freehand tracing, enclosed-area measurement, and an optional image viewer.

## Install with BRAT

1. Install **BRAT** from Obsidian's Community plugins and enable it (BRAT 1.1.0 or newer).
2. In BRAT, add `msackton/taelgarverse-obsidian` as a beta plugin.
3. Enable **Taelgarverse** in Community plugins.

BRAT can follow the latest release or pin an individual installation to a specific
version. Plugin files and BRAT preferences should stay outside vault Git tracking.

## Generated indexes

Version 0.4.0 adds Residents, Settlements, and Members grids from current vault
metadata and the selected in-world date. Enable header popup buttons with
`indexes: [residents, settlements]` on a place or `indexes: [members]` on an
organization. Buttons appear only with a `taelgar-header` block, at the bottom
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
pronunciation. People cards show Info and Current Location using the same
templates as tables, plus Home on Residents. Set `mode: table`
inline to show Person (name, pronouns, pronunciation), Info (ancestry and main
type), Current Location (last-known chain and date), and Home for Residents.
Member tables show Person (name, pronouns, pronunciation),
Info (ancestry and main type), and Current Location (last-known location chain
and date), following the existing `isAffiliated` and header-template rules.
Settlement tables show Place, Region,
Type Of, and Population, sorted by dated home region, with the same type and
population formatting as headers. Settlements includes ruins and matches
current, last-known and secondary locations using the existing location rules.
Table rows have no image column; popups always use image grids.
Grids and buttons refresh when vault metadata or calendar dates change. Notes
remain editable and are never rewritten.

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
