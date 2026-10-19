# Backlinks

Articles show **Linked from** in the right-hand page navigation, below **On this
page** when a TOC exists. Both sections can be collapsed. At smaller widths they
start collapsed above the article. Articles with no incoming links show an empty
state; articles without headings still have the backlink section.

The list contains one entry per referring article, sorted by title. Links retain
the selected context/date and Behind the Curtain preference. `/api/page` returns
the same list in `backlinks`, with `page`, `title`, and `url` for each entry.

## What counts

The index covers authored article references: wikilinks (including aliases and
headings), relative Markdown links, reference-style Markdown links, local HTML
page links, and note embeds currently rendered as links. Code examples, external
links, assets, heading-only references, and self links do not add backlinks.
Generated metadata headers are removed before indexing: location/affiliation
cards are computed presentation rather than authored article references.
Materialized query output in the exported article is included.

Both the source page and target page must be available in the selected context.
Each occurrence also follows campaign/date blocks and Behind the Curtain rules.
Ordinary comment links count only when their DM note is visible; administrative
comments never count. An unsafe comment source contributes no backlinks and
adds an index warning; it retains its normal article-rendering error.

## Publication and runtime

`prepareContent` builds a versioned reverse index under `backlinks` in
`revisions/<revision>/index.json`. It records source slugs and visibility rules,
without copying article bodies or excerpts. It is included in the content
revision hash and uploaded with the normal immutable snapshot. The publisher's
build fingerprint includes the backlink compiler and link/comment parsers, so
changing them triggers a rebuild even when the vault commit is unchanged.

At publication, the compiler parses each complete filtered article for the
finite campaign/DM/date states that its comment markers can produce. Campaign
contexts currently select one campaign; Modern and Custom select none. Parsing
the whole article preserves reference definitions across blocks. Equal states
reuse parsed references, and adjacent date intervals are merged.

At request time, the Worker looks up the target's incoming entries and filters
their rules and source metadata. It does not fetch or render the referring
articles, or scan all note bodies. The Node preview builds the same index once
at startup. New content revisions replace the index along with the article
snapshot, so removed links disappear without redeploying the Worker.

Enabling the feature in production requires the updated renderer and one fresh
content publication through `npm run content:publish -- --no-strict` (omit
`--no-strict` for strict query checking). Deploying code and publishing content
remain separate operations. Older snapshots remain renderable and omit the
backlink section until republished. An unknown backlink index version is
rejected explicitly.
