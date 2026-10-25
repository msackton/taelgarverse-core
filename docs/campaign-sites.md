# Campaign landing pages

Campaign subdomains use the same Worker, vault publication, and theme as the main
site. `taelgar.org`, `www.taelgar.org`, and the Worker preview hostname keep the
shared homepage and selectable context.

## Opt in

Create `_website/<subdomain>.md` in the original Taelgar vault:

```markdown
---
title: Example subsite
campaigns: [dufr, feywild, mawar]
---
# Example subsite

Campaign guides and session records from three adventures in Taelgar.

- [[Dunmari Frontier Campaign|Dunmar Frontier]]
- [[Lost in the Feywild]]
- [[Mawar Adventures]]
```

Saving this as `_website/tim.md` enables `tim.taelgar.org` with all three
campaigns selected. Omit `date` to use **Modern**, the latest dated campaign in
the published content, with the normal configured fallback. This follows Modern
after each content publication; it is not today's real-world date. To freeze
the view, add a full DR date, for example `date: 1748-05-05`. An explicit
`date: modern` has the same behavior as omitting the field.

`campaigns` accepts a YAML list or comma-separated string. Use canonical lowercase
campaign codes from `_scripts/session_note_campaigns.json`; registry IDs, names,
and aliases are also accepted and normalized. `campaigns: all` selects every
registered campaign; `campaigns: []` selects shared content without campaign
blocks. Campaigns without a dated session can be included in a multi-campaign
page, which uses Modern or its explicit date. An optional `title` labels the locked
context in the header; otherwise the selected campaign names supply the label.
The Markdown heading still controls the homepage banner.

A single campaign uses the same field:

```markdown
---
subdomain: cleenseau
campaigns: [clee]
---
# Cleenseau Campaign

Welcome to the campaign.

- [[Cleenseau Campaign|Campaign overview]]
- [[Heroes of Cleenseau|The party]]
```

Save this as `_website/cleenseau-index.md` (or another distinct filename). The
`subdomain` field enables `cleenseau.taelgar.org` independently of the filename,
avoiding collisions with the actual Cleenseau place note in Obsidian.
It follows Cleenseau's latest published session date. A `date` field cannot
override a single campaign's date. Campaign
names and aliases are normalized before counting; repeated references to the same
campaign still count as one. A single campaign without a published session date
is unavailable, rather than falling back to Modern.

The optional `subdomain` field selects the host label, without `.taelgar.org`.
Omit it to keep using the filename without `.md`, so existing landing pages
need no changes. With an explicit `subdomain`, filenames can also contain spaces
or capital letters, such as `Cleenseau Homepage.md`. Keep landing pages directly
inside `_website`; `home.md`, `navigation.md`, and `AGENTS.md` are not campaign homes.

The selected subdomain must be a lowercase DNS label, at most 63 characters,
containing letters, digits, or interior hyphens. `www`, `home`, and `navigation`
are reserved. Invalid explicit values and two files claiming the same subdomain
stop publication, including collisions between explicit and filename-derived
subdomains. Every landing page uses `campaigns`;
`context` frontmatter is no longer supported. Replace `context: cleenseau` with
`campaigns: [clee]` in existing files. Any supplied date must be a valid full DR
date or `modern`, including on single-campaign pages where it is ignored.
Other website Markdown without a `campaigns` field
remains unpublished; `home.md` and `navigation.md` keep their existing roles.

The first heading and paragraph form the banner. Remaining Markdown supplies the
campaign guide, including ordinary links, callouts, images, and note embeds. The
main homepage's three entry buttons are not added. No note header is generated,
and website sources are not indexed as articles or search results.

Use the normal content publication workflow after adding, editing, or removing a
campaign home. All opted-in subdomain labels and Markdown enter the publisher fingerprint
and revision index, so no `--force` or core redeployment is needed for later edits.
Campaign-home images join normal image processing. Sources always come from the
original vault's `_website`, including when `source_dir` selects a materialized
export or `home_source` overrides the shared homepage.

Use the updated local publisher to read `subdomain`. It stores the selected host
in the existing `campaignHomes` map, so this field needs no snapshot migration,
DNS change for an existing subdomain, or website redeployment. Publish the content
after changing the file or its frontmatter to update the hosted site.

## POV date filtering

A microsite can enforce POV filtering in its landing-page frontmatter:

```yaml
---
campaigns: [clee]
enforcePoV: 1
---
```

Use `enforcePoV: 1` to hide pages whose dated POV is after the microsite's date.
Use `enforcePoV: 0` to keep POV filtering off. The setting applies across that
microsite: its landing page links and embeds, articles, search, navigation,
diagram links, and backlinks. Other date and publication restrictions still
apply. Plural POV years such as `1740s` mean January 1, 1740.

This field takes precedence over both the reader's `pov` URL parameter and the
shared `respect_pov_dates` default. If omitted, readers retain the hidden
`pov=1` / `pov=0` opt-in, with the shared setting used when no URL preference is
supplied. Use 1 or 0 (quoted values also work); other values fail homepage
validation. The field is optional, so existing microsites retain their behavior.

Deploy core support first, then publish the edited `_website/<name>.md`
through the normal content workflow. Later field changes require only content
publication. The raw landing page is already part of the snapshot and publisher
fingerprint; no schema or database migration is needed.

## Locked context

The request hostname selects the campaign set and date on the server. One
campaign follows that campaign's latest published session. Multiple campaigns
use the authored date, or Modern when it is omitted. An empty campaign selection
also uses the authored date or Modern, showing shared content only.
`context`, `date`, and `campaigns` query parameters are ignored on campaign hosts;
responses report the effective context. This applies to article HTML and APIs,
search, section browsing, navigation, diagram links, backlinks, and note embeds.

The header displays the campaign and date in place of the context picker, with
a **Full site** link to `https://www.taelgar.org/`. Home links remain on the
campaign host. Behind the Curtain and appearance preferences retain their usual
behavior. An unknown campaign subdomain returns 404. A single campaign without
a usable published session date returns an explicit unavailable response.

Preview locally at `http://cleenseau.localhost:8765/` while the normal quick
preview is running. Browsers that do not resolve `*.localhost` can use a local
hosts entry pointing `cleenseau.localhost` to `127.0.0.1`. This uses the same
hostname selection and context enforcement as production.

## One-time Cloudflare setup

`wrangler.json` preserves the apex and `www` Custom Domains and declares the route
`*.taelgar.org/*` on zone `taelgar.org`. Campaign subdomains, including Cleenseau,
use this shared wildcard route without dedicated Custom Domain attachments.
Deploy the updated core through the normal website deployment workflow.
In Cloudflare DNS, add a **proxied** wildcard record
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

An additional [hostname firewall allowlist](hostname-protection.md) is prepared
but has not been applied. Once enabled, the updated publisher automatically adds
new campaign hostnames and verifies the edge rule before activating content.
Its token needs WAF read/edit access. Existing services and rollback hosts are
preserved. Older publishers require manually allowing the host before publication.

On **2026-10-20**, Cleenseau's dedicated Custom Domain attachment was removed
through the Cloudflare API. The API confirmed that the shared wildcard route and
the apex/`www` attachments remained. Cleenseau's homepage and contexts API still
returned HTTP 200 over HTTPS, with the Cleenseau campaign locked. An unconfigured
subdomain also reached the Worker's expected campaign-not-found response over
HTTPS. DNS record details were not inspected because the login lacked DNS read
permission.

References: [Cloudflare wildcard DNS](https://developers.cloudflare.com/dns/manage-dns-records/reference/wildcard-dns-records/),
[Worker routes](https://developers.cloudflare.com/workers/configuration/routing/routes/),
[Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

## Compatibility and rollback

Snapshots store an optional `campaignHomes` object mapping host labels to Markdown
alongside `homeSource`. Older snapshots without it retain the shared homepage;
campaign subdomains return 404 until a supporting publication is active. Invalid
campaign names or configuration fail preparation before any publication writes.
Snapshots containing the removed `context` frontmatter must be regenerated with
`campaigns` before this renderer can load them; discovery reports the migration
error rather than silently dropping those homepages.
Restoring a previous content revision restores its campaign homes together with
its notes. Campaign selection is request-local; cached engines never retain a
visitor's chosen hostname.
