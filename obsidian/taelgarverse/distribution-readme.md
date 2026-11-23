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

Use an inline whereabouts block to list notes by their dated locations.

````markdown
```taelgar-index
type: whereabouts
from: person
via: home
mode: table
```
````

The containing note is the default target. Choose `home`, `current` or `lastKnown` for the first hop. The result can be displayed as a grid or table. See the [whereabouts index reference](https://github.com/msackton/taelgarverse-core/blob/main/docs/vault.md#generated-indexes) for date scopes, filters, columns and sorting.

## Generated headers

Use a top-level `taelgar-header` callout for generated information, with an
authored title and optional pronunciation above it:

```markdown
# Fausto
*(FOW-stoh)*
> [!taelgar-header]
> (human, Chardonian, b. 1714, d. 1749)
```

The renderer replaces only the callout's information, including biographical
details, dates, affiliations and location chains. It ignores the saved fallback
contents and preserves authored title/pronunciation. Reading view and native
Live Preview share the callout handler; Source mode exposes the saved Markdown.
Headers refresh after metadata or calendar-date changes and show a clear error
for circular relationships. Rendering never rewrites notes.

Use **Regenerate page header** to refresh an existing native callout or
**Add header to current note** to insert one. Both commands can be assigned to
hotkeys. Both remove any top-level `headerVersion` field and preserve other
frontmatter and ordinary info callouts. The installed `header-tool.cjs`
supports standalone single-file and bulk previews and writes without a core
checkout. It requires Node.
Use `--report` for JSON, `--errors` for problems and `--check` for a read-only
exit-code check. Untagged notes and excluded tag types are skipped.
The website generates headers from native callouts authored in the vault.

Header blocks require the Taelgar vault's `metadata.json` in its Obsidian
configuration folder and `_sessions/campaign-registry.json` and its campaign index notes. Dataview and
CustomJS are not required for these blocks; existing body queries still need
their existing plugins. Dates follow an active CustomJS override, the note's
`pageTargetDate`, the campaign selected in Taelgarverse, Fantasy Calendar, or
Taelgar's Calendarium calendar, in that order. Otherwise, they use the latest campaign session date, falling back to
DR 1750-01-01.

The plugin owns shared snapshot and date services independently of the header
renderer. Calendar changes refresh subscribers immediately; legacy external
calendar and CustomJS changes share one two-second polling bridge. Renderers
release their subscriptions on teardown, and the bridge stops when none remain. Snapshot
loading is lazy, so initializing the plugin in a Maps-only vault does not require
header display metadata.

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
Eligible linked notes are attributed by `campaign` or their registered folder.
An explicitly attributed handout can appear from elsewhere in the vault.
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

Interactions require `_sessions/campaign-registry.json` and its campaign index notes. Session membership
comes from local `_sessions/<campaign>/<session>/cleaned/*-session-recap.md` files;
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

Taelgarverse renders `taelgar-map` blocks. The separate **Obsidian Leaflet**
plugin can still handle `leaflet` fences. To use the Taelgarverse viewer for
an existing image map, change its opening fence label to `taelgar-map`.

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
