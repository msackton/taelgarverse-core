# Bot protection handoff

Prepared 2026-10-24 for the Taelgar Cloudflare account. The owner wants to block
as many bots as possible, including legitimate search engines, AI crawlers, and
link-preview services. Search indexing is not required. Normal browser access
must continue to work.

## Current work and rollout

- `taelgarverse-core` commit `d511976` adds early Worker crawler rejection,
  `robots.txt` exclusions, and no-index response headers.
- `taelgar-character-manager` commit `90423dc` adds the same protection before
  application handling. Live encounters remain disabled with
  `COMBAT_ENABLED="false"`; the character sheet Combat tab remains available.
- Both set `BLOCK_CRAWLERS="true"`. Identified bots and missing User-Agent
  requests receive 403 before content/database handling. GET/HEAD `/robots.txt`
  remains readable; GET/HEAD `/health` keeps its existing behavior. Browser
  requests and WebSocket upgrades continue normally.
- The owner explicitly authorized pushing both repositories to `main` after
  these notes were requested. Pushes trigger their existing deployment pipelines;
  check deployment results before describing the protection as live. Core uses
  GitHub Actions, and the character manager uses its existing remote build.
- No vault publication or storage migration is needed for these bot changes.

The existing inspection token is read-only except for D1. Attempts to enable
Bot Fight Mode and create a firewall ruleset returned HTTP 403 authentication
errors. **No Cloudflare edge policy changes were applied.** Do not retry writes
with this token. The owner will provide a write-enabled token later; no secret
belongs in this document or Git.

Validation completed before rollout: core 1,649 passing tests, one existing
skip, local runtime integration tests and Wrangler package dry-run; character
manager 974 passing tests, runtime bot/WebSocket tests, typecheck, lint, and
production build.

## Why edge protection is the next step

Worker rejection avoids expensive page rendering and database reads, but still
uses a Worker invocation. A Cloudflare WAF block can reject traffic before the
Worker runs, including requests for static files. User-Agent checks alone can be
evaded by bots impersonating a browser.

The inspection found Qlyze at roughly 28% of one day's requests (2,706 of 9,677),
with no blocking action. All 33 retained explicit exceeded-CPU errors examined
were from SerpstatBot or QlyzeBot. Expensive public page rendering, rather than
daily request volume, was the main Workers free-tier constraint. D1 publication
writes also briefly exceeded the free daily allowance; bot controls do not fix
that separate publication cost.

## When write access is available

Target only the **taelgar.org** zone in the **Taelgar** account. Zone ID:
`f32f02403c20a34cae5a18f9a04e131d`. Account ID:
`2328f3621c0a639572c74f537c5854c4`.

Use a token scoped to this zone with the permissions needed by each chosen
endpoint: WAF edit for custom rules, Bot Management edit for bot settings,
Transform Rules edit for response headers, and Zone Settings edit only if
changing HTTPS settings. Confirm current permission names in Cloudflare's token
UI/API documentation. D1/R2 write access is unnecessary for this work. Re-read
current settings, plan entitlements, and existing rules before making changes.
When resuming, obtain explicit authorization for the concrete production edge
changes under this repository's AGENTS.md; supplying credentials alone does not
authorize every optional change below.

1. **Add a custom WAF Block rule for identified automation.** Include
   `cf.client.bot` so verified crawlers are blocked too, empty User-Agent, and
   the automation signatures in `src/crawler-policy.mjs`. A baseline expression
   is checked in beside this document as `bot-firewall-expression.txt`. It
   exempts only GET/HEAD `/robots.txt` and `/health`. Apply across the zone so it
   covers the wiki, character manager custom domain, campaign hosts, and static
   files. Read the `http_request_firewall_custom` entrypoint ruleset first;
   append/update an identified rule without replacing unrelated rules. If no
   entrypoint exists, create one. Record the ruleset/rule IDs and prior state.
2. **Enable Bot Fight Mode**, if available on the current plan. It provides
   additional automation detection beyond User-Agent strings. Recheck normal
   browsers, login, OAuth callbacks, and monitoring afterward. Free Bot Fight
   Mode cannot be selectively bypassed with a custom-rule exception, so the
   health/robots exemptions above do not exempt them from Bot Fight Mode.
   Disable this setting again if it breaks required traffic.
3. **Enable available AI crawler blocking controls.** AI training and AI search
   were already set to block in the inspection; AI user-triggered access and
   broader AI/content-crawler controls were not. Inspect the current endpoint
   schema and plan availability before updating supported fields; do not submit
   speculative or unsupported settings wholesale. Keep existing blocks enabled.
4. **Ensure crawler directives remain restrictive.** The applications supply
   `User-agent: *` / `Disallow: /` and `X-Robots-Tag: noindex, nofollow, noarchive,
   nosnippet, noimageindex`. Inspect Cloudflare's managed robots behavior so it
   does not replace that policy with broader permissions. Optionally add a
   zone response-header transform for the same X-Robots-Tag; merge with existing
   transforms rather than replacing them. Directives discourage cooperative
   crawlers; the WAF supplies enforcement. Existing search listings may take
   time to disappear when crawlers are blocked from reading noindex headers.

Do not assume a paid bot score is available on the free plan. Zone rules also
do not cover `workers.dev` hostnames; the Worker guard remains useful there.

## Follow-up optimizations to assess

- Reject unconfigured wildcard hostnames at the edge after inventorying all
  valid campaign hosts and the character manager domain. Scanner traffic was
  reaching names such as `intranet`, `panel`, `uat`, and `staging2`. Do not block
  valid campaign subdomains with an incomplete allowlist.
- Consider Always Use HTTPS after checking current redirects and health checks.
  It was off during inspection. This is a separate zone setting change.
- Add rate limits only after measuring legitimate page, search, map-tile, and
  shared-session bursts. Avoid a guessed global threshold that can interrupt
  players sharing an IP. Check free-plan route/rule limitations first.
- Reassess Workers Paid after measuring the savings. Legitimate uncached page
  requests may still exceed the free plan's per-request CPU limit. A prior
  estimate suggested the roughly $5 base plan could cover current traffic;
  verify current pricing and observed usage before upgrading.

## Verification and rollback

After code deployment, read both Workers' deployed versions/settings and confirm
`BLOCK_CRAWLERS="true"`; also confirm character-manager `COMBAT_ENABLED="false"`.
Test a desktop and mobile browser, a real article, search, character editing,
login, shared dice/WebSockets, static assets, `/robots.txt`, and `/health`.
Do not include character access keys, cookies, or tokens in saved test output.

Send identified crawler User-Agents such as QlyzeBot and SerpstatBot: expect 403.
After WAF rollout, confirm Security Events attributes rejection to the new edge
rule and rejected traffic no longer appears as application execution. Check
both custom domains and representative campaign hosts; Worker-level blocking
should still protect the public `workers.dev` entry points. A curl request
without a browser User-Agent is intentionally blocked outside the exemptions.

Compare the next 24–48 hours with the baseline: Worker requests and CPU,
exceeded-resource errors, D1 reads/writes, and Security Events by action,
User-Agent, host, and rule. Distinguish WAF savings from publication writes and
normal traffic variation. Record deployment IDs, edge rule IDs, settings changed,
and the resulting measurements here.

For an edge false positive, disable the new rule or restore only the changed
bot setting; preserve unrelated rules. For an application false positive, change
`BLOCK_CRAWLERS` to `"false"` through the normal code deployment. Static robots
and no-index headers remain until separately changed. Keep live encounters off.

## References

- [Worker behavior](cloudflare.md#what-happens-when-someone-opens-a-page)
- [Deployment instructions](deploy.md)
- [Production permission gates](../AGENTS.md)
- [Character manager crawler policy](https://github.com/msackton/taelgar-character-manager#crawler-blocking)
