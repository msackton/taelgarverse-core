# Campaign landing pages

Campaign subdomains use the same Worker, vault publication, and theme as the main
site. `taelgar.org`, `www.taelgar.org`, and the Worker preview hostname keep the
shared homepage and selectable context.

## Opt in

Create `_website/<subdomain>.md` in the original Taelgar vault:

```markdown
---
context: cleenseau
---
# Cleenseau Campaign

Welcome to the campaign.

- [[Cleenseau Campaign|Campaign overview]]
- [[Heroes of Cleenseau|The party]]
```

This file enables `cleenseau.taelgar.org`. The filename must be a lowercase DNS
label, at most 63 characters, containing letters, digits, or interior hyphens.
`www`, `home`, and `navigation` are reserved. The required `context` is the exact
campaign registry ID, never `modern` or `custom`. For example, `_website/dunmar.md`
uses `context: dunmar-frontier`. Other website Markdown without a `context` field
remains unpublished; `home.md` and `navigation.md` keep their existing roles.

The first heading and paragraph form the banner. Remaining Markdown supplies the
campaign guide, including ordinary links, callouts, images, and note embeds. The
main homepage's three entry buttons are not added. No note header is generated,
and website sources are not indexed as articles or search results.

Use the normal content publication workflow after adding, editing, or removing a
campaign home. All opted-in filenames and Markdown enter the publisher fingerprint
and revision index, so no `--force` or core redeployment is needed for later edits.
Campaign-home images join normal image processing. Sources always come from the
original vault's `_website`, including when `source_dir` selects a materialized
export or `home_source` overrides the shared homepage.

## Locked context

The request hostname selects the campaign on the server. Its current date comes
from the latest published session, using the existing campaign-date rules. It
advances after content publication, rather than being saved in the landing file.
`context`, `date`, and `campaigns` query parameters are ignored on campaign hosts;
responses report the effective context. This applies to article HTML and APIs,
search, section browsing, navigation, diagram links, backlinks, and note embeds.

The header displays the campaign and date in place of the context picker, with
a **Full site** link to `https://www.taelgar.org/`. Home links remain on the
campaign host. Behind the Curtain and appearance preferences retain their usual
behavior. An unknown campaign subdomain returns 404. A campaign without a usable
published session date returns an explicit unavailable response, never Modern.

Preview locally at `http://cleenseau.localhost:8765/` while the normal quick
preview is running. Browsers that do not resolve `*.localhost` can use a local
hosts entry pointing `cleenseau.localhost` to `127.0.0.1`. This uses the same
hostname selection and context enforcement as production.

## One-time Cloudflare setup

`wrangler.json` preserves the apex and `www` Custom Domains and declares the route
`*.taelgar.org/*` on zone `taelgar.org`. Cleenseau also has an explicit Custom
Domain attachment so it can work before wildcard DNS is configured. Deploy the updated core through the normal
website deployment workflow. In Cloudflare DNS, add a **proxied** wildcard record
(`A`, name `*`, address `192.0.2.1` is Cloudflare's documented example). The Worker
answers these requests directly; it does not fetch the placeholder origin.

Before enabling the wildcard route, inspect existing subdomain routes and DNS.
If another service uses a proxied subdomain, give it a more specific Worker route
or a route without a Worker to exclude it. Specific DNS records override wildcard
DNS, but they do not bypass a matching Worker route. Verify active certificate
coverage for `*.taelgar.org` and HTTPS for Cleenseau before calling setup complete.

With wildcard DNS and routing in place, future campaign activation requires only
the Markdown file and publication. If the deployment identity lacks DNS edit
permission, an individual Worker Custom Domain can provision a campaign's DNS and
certificate instead, but each additional campaign then needs a domain attachment
until wildcard DNS is configured.

References: [Cloudflare wildcard DNS](https://developers.cloudflare.com/dns/manage-dns-records/reference/wildcard-dns-records/),
[Worker routes](https://developers.cloudflare.com/workers/configuration/routing/routes/),
[Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

## Compatibility and rollback

Snapshots store an optional `campaignHomes` object mapping host labels to Markdown
alongside `homeSource`. Older snapshots without it retain the shared homepage;
campaign subdomains return 404 until a supporting publication is active. Invalid
campaign names or configuration fail preparation before any publication writes.
Restoring a previous content revision restores its campaign homes together with
its notes. Campaign selection is request-local; cached engines never retain a
visitor's chosen hostname.
