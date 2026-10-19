# Custom campaign selections

Choose **Custom** in the header to set a DR date and choose which campaigns to
show. The campaign picker initially selects **All campaigns** when entering
Custom from a preset. Uncheck All campaigns to clear the list, then check any
subset; leaving every box unchecked selects no campaigns. Press **Apply** to
update the page. Unchecking an individual campaign switches from All to a subset.

All campaigns selects every campaign in the registry, including campaigns whose
current session date is unavailable. It also includes backlinks from campaign
folders that have no registered preset. General world-reference backlinks remain
available alongside campaign sources. Campaign blocks use the selected canonical
codes. Date filters, publication exclusions, and Behind the Curtain remain
independent checks; selecting all campaigns does not bypass them.

The chosen date and campaigns persist through article links, backlinks, search,
site navigation, breadcrumbs, section browsing, and the Behind the Curtain toggle.
All-campaign links retain the word `all`, so newly registered campaigns join
that selection automatically. Subset links retain their canonical campaign codes.
Modern and named campaign presets keep their existing behavior. Older date-only
links with no campaign selection continue to select no campaigns.

## URLs and API

The website and `/api/page` accept `campaigns` with Custom context. Supplying
`date` or `campaigns` without a context ID also selects Custom.

```http
GET /page/people/zimkovans/zahara?context=custom&date=1730-01-20&campaigns=all
GET /api/page?page=Zahara&date=1730-01-20&campaigns=adma,dufr
GET /api/page?page=Zahara&context=custom&date=1730-01-20&campaigns=
```

An empty value or omitted selection means no campaigns. Repeated `campaigns`
parameters are also supported for native HTML forms. Registry names, IDs, codes,
and aliases are accepted case-insensitively; responses normalize subsets to
sorted, deduplicated canonical codes. Unknown selections and campaign overrides
on a named preset return 400. API responses include the resolved `campaigns`;
Custom All also has `context.allCampaigns: true`.

Multi-campaign backlinks require a freshly published version 2 backlink index.
Publication compiles combinations once; requests continue to use the index
without reading the referring article bodies. Older snapshots still render
articles, with multi-campaign backlinks enabled after republishing.
