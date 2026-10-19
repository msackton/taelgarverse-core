# TaelgarVerse UI design review

Download and open [TaelgarVerse-UI-Review.html](TaelgarVerse-UI-Review.html) in a
current browser. This standalone file includes all styles, scripts, seven full
articles, and embedded images. It works offline without installation.

## Review controls

- **Fit window**, **Desktop · 1440**, **Tablet · 900**, and **Mobile · 390** set
  the actual preview viewport. Fixed widths scale down when necessary to fit
  your window; the status shows the viewport width and display scale. Scroll
  inside the preview to read the page. Device changes retain the selected page,
  design, palette, and navigation options, and restart at the top.
- **Current site · reference** opens first and uses the existing page template,
  production stylesheets, and navigation script in an isolated frame. Switching
  designs always replaces that frame's document, including when returning to
  the reference. Reference appearance stays unchanged.
- **Classic Encyclopedia**, **Quiet Library**, and **Atlas Reference** share
  responsive navigation. Classic emphasizes compact reference reading; Library
  adds serif prose and restrained rules; Atlas gives maps more space. Modern
  Codex and Reader's Edition have been retired following the first review.
- Proposal **Palette** choices are Sage & stone, Muted plum, and Parchment,
  independent of typography. **Appearance** offers System, Light, and Dark.
- **Site navigation** and **Page contents** independently simulate build-time
  navigation omissions. These options apply to proposals and do not change
  production configuration. Contents are also omitted automatically when the
  article has no headings; try **Green Sea**. Omitted navigation releases its
  grid column, including when both navigation areas are disabled.

At desktop and tablet widths, main sections appear in a second header row,
with the current section highlighted. Links are taken from the captured
navigation: Home, Campaigns, People, Gazetteer, World Map, History, and the
snapshot's More pages fallback. The left sidebar shows only the current
section's branch. Sections without children release the left sidebar space.
Page contents stay in the right sidebar, headed by the current page name.
Both sidebars scroll independently when long, below the sticky site header.
At 800px and below, the header's section row and right sidebar disappear;
a hamburger button opens all main sections and their nested navigation in a
modal drawer. Disabling Site navigation hides the section row as well as
the sidebar and hamburger button. The drawer supports its
close button, Escape, and clicking outside it. Images stop floating on mobile.

Search lives in the header as a search bar above 1100px; at smaller widths a
magnifying-glass button opens a search dialog. The context switcher and **See
Behind the Curtain** are visible in the desktop header. At mobile widths, a
gear button opens them in a settings dialog. The same controls move between
header and dialogs without duplicating IDs. The context options and selected
values come from the captured reference; changing them explains the offline
limitation and restores the snapshot values.

## Snapshot limitations

Included pages: Chardon, Addermarch, Voltara, Melusa, the Green Sea, and Dunmari
Frontier Sessions 110 and 120. Full rendered prose, headings, metadata, callouts,
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

To share, send the HTML file as an attachment. Recipients should download it
and open it in their browser; GitHub's source preview does not run the controls.

## Rebuild and check

To update only the UI using the existing bundled content (no dependencies or
source vault required):

```sh
node docs/design/ui-review/build.mjs --snapshot
node --test docs/design/ui-review/review.test.mjs
```

To refresh content as well, install repository dependencies and make the
configured source/runtime vault available, then run:

```sh
node docs/design/ui-review/build.mjs
```

`template.html` holds the review controls, proposal markup, and styles;
`review.js` manages the frame and review controls; `preview.js` runs inside
proposal frames. The builder embeds all of them into the distributable HTML.
The dependency-free tests exercise the shipped JavaScript with a DOM/event
harness; they check switching, viewport sizing, navigation options, bundled
links, header controls, drawer/dialog interactions, and generated script syntax,
but do not verify visual browser layout.
This package does not change the production theme or server behavior.
