# TaelgarVerse UI design review

Download and open [TaelgarVerse-UI-Review.html](TaelgarVerse-UI-Review.html) in a
current browser. This standalone file includes all styles, scripts, seven full
review articles, linked NPC/settlement articles, and embedded images. It works
offline without installation.

## Review controls

- **Fit window**, **Desktop · 1440**, **Tablet · 900**, and **Mobile · 390** set
  the actual preview viewport. Fixed widths scale down when necessary to fit
  your window; the status shows the viewport width and display scale. Scroll
  inside the preview to read the page. Device changes retain the selected page,
  design, palette, and navigation options, and restart at the top.
- **Quiet Library** opens first. **Current site · reference** uses the existing page template,
  production stylesheets, and navigation script in an isolated frame. Switching
  designs always replaces that frame's document, including when returning to
  the reference. Reference appearance stays unchanged.
- **Classic Encyclopedia**, **Quiet Library**, and **Atlas Reference** share
  responsive navigation. Classic emphasizes compact reference reading; Library
  combines readable serif prose with Atlas's wordmark and wider article area;
  Atlas gives maps more space. Modern
  Codex and Reader's Edition have been retired following the first review.
- Proposal **Palette** choices are Sage & stone, Muted plum, and Parchment,
  independent of typography. **Appearance** offers System, Light, and Dark.
  Sage & stone uses neutral charcoal surfaces in dark mode, with sage accents;
  Muted plum uses restrained purple accents on neutral surfaces.
- **Site navigation** and **Page contents** independently simulate build-time
  navigation omissions. These options apply to proposals and do not change
  production configuration. Contents are also omitted automatically when the
  article has no headings; try **Green Sea**. Omitted navigation releases its
  grid column, including when both navigation areas are disabled.
- Place headers offer **Residents** for settlements or **Settlements** for
  larger places, without counts. Try Chardon or Voltara for residents and
  Addermarch for settlements. Each button opens a filterable card grid with
  portraits/illustrations when available, names, and short excerpts. Cards
  open bundled notes; a **Back to [place]** link returns to the original place.
  The grid becomes one column on mobile. Melusa demonstrates an empty list.
  These controls appear in proposals only, not the unchanged reference.

Above 1100px, a compact header places main sections in a second row,
with the current section highlighted. Links are taken from the captured
navigation: Home, Campaigns, People, Gazetteer, World Map, History, and the
snapshot's More pages fallback. The left sidebar shows only the current
section's branch. Sections without children release the left sidebar space.
Page contents stay in the right sidebar under the plain **On this page** title,
without a repeated page name or collapse control. Header controls and the space
before the article are kept compact, while small-screen icon buttons retain
their 44px touch targets.
The left sidebar stays below the sticky header and scrolls independently when
long. The right contents list flows with the article and uses the page scrollbar,
without a separate scroll area or sticky positioning.
At 1100px and below, the header's section row and breadcrumbs disappear;
a hamburger button opens all main sections and their nested navigation in a
modal drawer, releasing the left sidebar's space. Page contents remain visible
until 800px, when the right sidebar also disappears.
Disabling Site navigation hides the section row as well as
the sidebar and hamburger button. The drawer supports its
close button, Escape, and clicking outside it. Images stop floating on mobile.

Search lives in the header as a search bar above 1100px; at smaller widths a
magnifying-glass button opens a search dialog. The context switcher and **See
Behind the Curtain** are visible in the desktop header. At 1100px and below, a
gear button opens them in a settings dialog. The same controls move between
header and dialogs without duplicating IDs. The context options and selected
values come from the captured reference; changing them explains the offline
limitation and restores the snapshot values.

When the article title scrolls behind the sticky header, the wordmark becomes
the page title. Long titles truncate visually but retain their full tooltip and
accessible label. Scrolling upward on a long page reveals a floating **Back to
top** button; it hides near the top or when scrolling down. Returning to the top
respects reduced-motion preferences. Backlink placement remains an open design
question.

## Snapshot limitations

Included pages: Chardon, Addermarch, Voltara, Melusa, the Green Sea, and Dunmari
Frontier Sessions 110 and 120, plus 50 linked resident and settlement notes.
The initial page selector lists the seven review articles; linked notes are
added to it when opened and are also available through search.
Full rendered prose, headings, metadata, callouts,
links, and images are retained, including empty headings in the source.

This is an offline visual proposal, not a deployed site. Content and navigation
are snapshots from October 19, 2026. Place pages use Modern context and session
pages use Dunmar Frontier. Context is fixed; changing dates or DM visibility
requires the live backend. Links between bundled pages and contents anchors
work locally. Other internal links explain that their destination is not
included. Search matches bundled page titles in proposals; the reference
explains its offline limitation when search is used. Both presentations explain
the offline limitation when context or Behind the Curtain controls are changed.
Navigation branches use the captured server-rendered tree. Images are embedded
as resized WebP.

Relationship cards use recorded, dated home/containment metadata, including
neighborhoods and subregions, through the existing CustomJS whereabouts helper.
They exclude PCs, people no longer alive at the selected date, and notes
excluded from publication in that context. These are recorded relationships,
not a complete census or relationships inferred from prose. Card descriptions
and linked notes use the normal renderer with DM visibility off; comments and
hidden DM text are filtered before packaging. Portraits use the first available
image from the rendered note; otherwise the card shows initials. Relationship
controls are demonstrated on the five original place pages, not recursively
on every linked settlement.

To share, send the HTML file as an attachment. Recipients should download it
and open it in their browser; GitHub's source preview does not run the controls.

## Rebuild and check

To update only the UI using the existing bundled content (no dependencies or
source vault required):

```sh
node docs/design/ui-review/build.mjs --snapshot
node --test docs/design/ui-review/review.test.mjs
```

To refresh relationship cards and linked notes while preserving the seven
original article snapshots (requires dependencies and the configured vault):

```sh
node docs/design/ui-review/build.mjs --snapshot --refresh-relationships
```

To refresh content as well, install repository dependencies and make the
configured source/runtime vault available, then run:

```sh
node docs/design/ui-review/build.mjs
```

`template.html` holds the review controls, proposal markup, and styles;
`review.js` manages the frame and review controls; `preview.js` runs inside
proposal frames. `relationships.mjs` captures the relationship lists and linked
notes during a content build. The builder embeds everything into the HTML.
The dependency-free tests exercise the shipped JavaScript with a DOM/event
harness; they check switching, viewport sizing, navigation options, bundled
links, header controls, drawer/dialog interactions, relationship cards and
filters, linked-note navigation, scroll controls, and generated script syntax,
but do not verify visual browser layout.
This package does not change the production theme or server behavior.
