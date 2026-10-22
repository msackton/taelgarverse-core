# Taelgarverse for Obsidian

Taelgarverse tools for desktop Obsidian: generated note headers, interactive maps,
distance measurement, freehand tracing, enclosed-area measurement, and an optional image viewer.

## Install with BRAT

1. Install **BRAT** from Obsidian's Community plugins and enable it (BRAT 1.1.0 or newer).
2. In BRAT, add `msackton/taelgarverse-obsidian` as a beta plugin.
3. Enable **Taelgarverse** in Community plugins.

BRAT can follow the latest release or pin an individual installation to a specific
version. Plugin files and BRAT preferences should stay outside vault Git tracking.

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

Campaigns without visible timeline entries retain the same campaign-name heading and
**Known to party** status line as a full timeline, with compact spacing and any
related links. The **Campaign interactions** heading and picker stay above the
content; choosing a campaign with recap beats adds its timeline below the same header.

Click or tap an individual dot to open a compact popup containing its date,
details, and source links. Details stay closed initially, and one popup is shown
at a time across campaigns. Close it with its close button, Escape, an outside
click, or the same dot. Zooming and campaign changes also close it. Keyboard
users can activate dots with Enter or Space; Escape returns focus to the dot.
Session references contain only the title, date, and a link such as **Session 30**.
They omit explanatory commentary and repeated session titles. Recap beats retain
their authored Short text and location. Popup titles use compact sans-serif text.
Grouping is automatic. Counted dots zoom into their entries; **Zoom out** appears
only while zoomed in and restores the full history.
Each dot shows its title and date, even in long histories. Grouped dots show the
session label and recorded date range. Titles use up to two lines; hover or open
the popup for the complete title. Dots wrap into rows, with two columns on narrow screens.

Recap beats contribute encounter dots and counts. Sessions without a recap use
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
their notes natively. Undated recap beats retain their session labels without
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

The dots, grouping, zoom, dates, and Short text use the same recap parser and
interaction model as the website. Session notes supply source links, and
non-session campaign material supplies separate references. Only missing-recap
sessions use session-note bodies, to identify explicit links and preserve their
conditional visibility; no prose summary is generated. Raw transcripts are not
interaction inputs. Links open session notes,
campaign references, and available polished transcripts natively in Obsidian,
including modified clicks to open another pane.

Interactions require `_scripts/session_note_campaigns.json`. Authoritative beats
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
