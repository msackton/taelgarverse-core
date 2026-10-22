# How vault notes appear on the website

TaelgarVerse uses the notes, properties, and media in your `taelgar` vault.
Readers can choose a campaign and an in-world date. The website uses that choice
to update page headers and show or hide marked content.

After editing the vault, follow [Update the website](deploy.md) to publish your
changes. Publishing works on copies; it does not rewrite your source notes.

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
it prepares the other notes through Obsidian. They do not become searchable
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
and the remaining details. The Taelgarverse Obsidian development plugin uses the
familiar native information callout with values filled in. Remove a separately
saved H1 above the block when migrating a vault note. Rendering does not modify
the note.
Existing saved headers and prepared HTML header markers remain supported;
an older materializer's marker or separately saved H1 before the new block is
consumed as one header on the website.
The block is omitted from note transclusions and authored search/backlink text.
Node, Worker and the development plugin use the same maintained header core;
the vault's legacy CustomJS scripts are not required to render these blocks.
Circular location or organization chains show a header error instead of a
partial header or a stack overflow.

The block must be empty and at the start of the note body. Examples inside other
code fences stay literal. Replacing existing vault headers is a separate,
explicit edit; enabling support does not migrate notes automatically.

Content preparation normalizes old `<!-- taelgar:header -->` markers (including
the `<!-- taelgar-header -->` spelling), detected versioned generated headers,
and title-plus-block layouts into one leading empty `taelgar-header` fence.
This runs in Node before content hashes, search, backlinks, or media discovery;
it accepts raw notes or materializer exports without modifying the vault.
Frontmatter and authored content are retained. Invalid explicit blocks stop
preparation with the source path. The existing snapshot schema is unchanged.
Deploy website support before publishing these newly normalized snapshots;
the new renderer can read older R2 markers without a content migration.

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

Person pages also show a **Campaign interactions** summary and grouped dot history
for the intersection of the page's registered `knownTo` campaigns and the active
context's campaigns, without a component campaign picker. An empty intersection
means no component. `knownTo` supplies undated party knowledge and
`campaignInfo` retains its normal header wording. Authoritative recap entries
supply encounter dots using their explicit NPCs, dates, and Short text. Session
notes supply only optional source links; non-session campaign-folder backlinks
supply separate links under **Related campaign material**. Untagged sources and
sources with `meta` or `background` tags (including nested tags) are excluded.
Related links have separate Items, Stories, Sources, and other References lines,
based on authored tags, each with its own **Show more** for longer lists.
Beat details show DR dates and links to available
session notes and polished beat transcript views. Missing source links never
remove recap beats.
Readers can group by session, day, or seven-day period and zoom into counted dots.
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

Markers, switchable overlays, and navigation between maps remain
future work; the website does not execute Obsidian Leaflet plugin scripts.

Other images may be made smaller during publication. See
[image settings](deploy.md#image-settings).

## Dataview and other generated content

During publication, Obsidian converts supported Dataview queries into ordinary
article content. Those results stay as they were when published; changing the
website's campaign or date does not rerun the query.

DataviewJS blocks are removed, along with headings left empty by their removal.
Remaining unsupported queries and inline query expressions show
warnings or unavailable-content messages. The website does not execute these
scripts. HTML in the normal article body is supported.

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
