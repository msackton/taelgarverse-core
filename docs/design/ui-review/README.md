# TaelgarVerse UI design review

Download and open [TaelgarVerse-UI-Review.html](TaelgarVerse-UI-Review.html) in a
current browser. This single file includes all styles, scripts, seven complete
rendered articles, and their images. It works offline without installation.

The review bar above the site has a **Current site · reference** button, five
proposed design buttons, and a page selector. The existing-site reference opens
first and uses the actual page template, all three production stylesheets, and
the navigation script in an isolated frame. It preserves the existing light
appearance, teal header, context controls, typography, and layout for all seven
pages. Proposal styles cannot affect the reference.

For the five proposals:
Everything below it is the proposed site presentation, with no review labels,
section previews, or excerpt notices mixed into the article. Appearance offers
System, Light, and Dark. Each design uses exactly the same article content.

Included pages: Chardon, Addermarch, Voltara, Melusa, the Green Sea, and Dunmari
Frontier Sessions 110 and 120. All rendered headings, prose, metadata, callouts,
links, and images are retained. Contents links scroll within the full article.
Navigation and contents collapse on mobile. Pages without subheadings omit
contents. Source content, including any empty headings, is preserved.

This is an offline visual proposal, not a deployed site. Content and navigation
are snapshots from October 19, 2026. Place pages use Modern context and session
pages use Dunmar Frontier. Context is displayed as a fixed snapshot; changing
dates or DM visibility requires the live backend. Links between bundled pages
work locally. Other internal links explain that their destination is not
included. Search matches bundled page titles in proposals; the reference explains its
offline limitation when search or context controls are used. Reference contents
links and links between bundled pages work locally. Navigation branches use
the captured server-rendered tree. Images are embedded as resized WebP.

To share, send the HTML file as an attachment. Recipients should download it
and open it in their browser; GitHub's source preview does not run the controls.

## Rebuild

With repository dependencies installed and the configured source/runtime vault
available, run from the repository root:

```sh
node docs/design/ui-review/build.mjs
```

`template.html` contains the five proposed styles and offline interactions.
`build.mjs` uses the site's actual rendering and navigation engines to populate
the standalone file. Rebuilding captures current content. This package does
not change the production theme or server behavior.
