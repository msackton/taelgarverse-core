# Custom campaign selections

Choose **Custom** in the header to set a DR date and choose which campaigns to
show. The campaign picker initially selects **All campaigns** when entering
Custom from a preset. Uncheck All campaigns to clear the list, then check any
subset; leaving every box unchecked selects no campaigns. Press **Apply** to
update the page. Unchecking an individual campaign switches from All to a subset.

All campaigns selects every campaign with `canon: canonical` and `main` as its
sole continuity, including eligible campaigns whose current session date is
unavailable.
Backlinks include sources from the selected campaigns and shared world references.
Campaign blocks use the selected canonical codes. Date and Behind the Curtain
filters also apply.

The chosen date and campaigns persist through article links, backlinks, search,
site navigation, breadcrumbs, section browsing, and the Behind the Curtain toggle.
All-campaign links retain the word `all`, so newly eligible campaigns join
that selection after publication. Subset links retain their canonical campaign
codes. Older date-only links with no campaign selection continue to select no
campaigns.

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
sorted, deduplicated canonical codes. Unknown or ineligible selections and
campaign overrides on a named preset return 400. API responses include the resolved
`campaigns`. Custom All also has `context.allCampaigns: true`.

Publication compiles campaign combinations into backlink shards. The Worker
filters the target page's incoming references for the selected campaigns
without reading the referring article bodies.
