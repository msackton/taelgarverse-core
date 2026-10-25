# Reject unconfigured hostnames

Prepared 2026-10-24. **Not applied to Cloudflare.** The current token is read-only
except for D1; activation requires Zone WAF edit access and explicit production
authorization under [AGENTS.md](../AGENTS.md). No application deployment or vault
publication is needed to activate this rule.

Publisher synchronization is implemented as of 2026-10-25 and covered by local
tests. It has not been used against production. Update the core checkout used
for publishing before relying on automatic additions.

## Verified allowlist

The inventory used live Cloudflare DNS, Worker routes, Worker Custom Domains,
the active R2 publication's runtime manifest, its previous snapshot, and local
vault campaign-home discovery. DNS enumeration returned all three records in
one page; Worker Custom Domains returned both attachments. No additional named
web services were found in those records/routes.

| Host | Evidence / purpose |
| --- | --- |
| `taelgar.org` | Live Custom Domain for `taelgarverse`; proxied apex DNS. |
| `www.taelgar.org` | Live Custom Domain for `taelgarverse`; proxied DNS. |
| `characters.taelgar.org` | More-specific Worker route to `taelgar-character-manager`. |
| `cleenseau.taelgar.org` | Active and previous published runtime `sites` entry; local `_website/cleenseau-homepage.md` explicitly selects `subdomain: cleenseau`. |
| `tim.taelgar.org` | Active and previous published runtime `sites` entry; local `_website/tim.md` selects the label through its filename. |

Active publication revision:
`2301583319a5752c7dbdc8a7134b552a9627c3410fa492d01bfd92e8edfdb8ee`.
Previous revision:
`7a099842f980b639a5a3756071ad3a232376539f2dc797236c2e527c7e3d5dfb`.
Both contain only `cleenseau` and `tim` in their runtime `sites` arrays.

The proxied `*.taelgar.org` A record and `*.taelgar.org/*` Worker route currently
admit arbitrary hostnames. Keep them: configured campaign hosts depend on that
shared setup. The character manager's more-specific route must also remain.

## Exact edge rule

Target zone: **taelgar.org**, ID `f32f02403c20a34cae5a18f9a04e131d`.
Phase: `http_request_firewall_custom`. Action: **Block**.

```text
not (lower(http.host) in {"taelgar.org" "www.taelgar.org" "characters.taelgar.org" "cleenseau.taelgar.org" "tim.taelgar.org"})
```

The ready-to-review API rule body is [hostname-firewall-rule.json](hostname-firewall-rule.json).
Cloudflare's `/filters/validate-expr` endpoint accepted this expression on
2026-10-24 (`success: true`); this validation did not create or enable a rule.
It is a single rule, not a replacement ruleset. Its scope comes from installing
it in this zone's custom firewall entrypoint. It allows the five exact hostnames
regardless of case and blocks every other hostname reaching that zone, including
nested subdomains. It does not inspect paths or User-Agents, so scanner requests
cannot evade it by pretending to be Chrome. There are no `/health` or
`/robots.txt` exceptions on unconfigured hosts. Allowed hosts still pass through
other security rules and application checks.

## Apply when authorized and write access is available

1. Refresh the inventory above immediately before activation. Read the current
   publication pointer and its runtime `sites`, previous snapshot, vault
   campaign homes, DNS, Worker routes and Custom Domains. Stop if any additional
   real service is found; add it to the allowlist before proceeding.
2. Read `/zones/{zone_id}/rulesets/phases/http_request_firewall_custom/entrypoint`.
   No custom entrypoint existed during this inspection. Preserve a complete
   before-state record. Do not replace another ruleset or its unrelated rules.
3. If an entrypoint exists, add this rule with
   `POST /zones/{zone_id}/rulesets/{ruleset_id}/rules`; update an existing rule
   with the same `ref` instead of creating a duplicate. Put the hostname block
   before any broad skip rule that would bypass it.
4. If none exists (confirmed 404), create a zone ruleset with
   `POST /zones/{zone_id}/rulesets`, `kind: "zone"`,
   `phase: "http_request_firewall_custom"`, and this rule in `rules`.
   Record the returned ruleset and rule IDs. HTTP 401/403 is a permission failure,
   not evidence that a ruleset is absent.
5. Read back the rule and verify the exact hostnames, action and enabled state.
   Perform the browser and edge checks below. Do not change DNS or Worker routes.

## Verify and maintain

Open all five allowed hosts in a normal browser; confirm their expected site
responses, including the character manager's login and character access flow.
Check campaign context on `cleenseau` and `tim`. Existing crawler protection can
block script clients even on an allowed hostname, so use a browser or a deliberate
browser User-Agent for these checks. Do not save character keys or cookies.

Request `intranet`, `panel`, `uat`, `staging2`, `internal`, `shop`, a random label,
and a nested random label under `taelgar.org`, using a browser User-Agent.
Where TLS permits the request to reach WAF, expect an edge 403. Check Security
Events for this rule's ID, then verify the rejected requests did not execute
either Worker. A TLS certificate error alone does not prove WAF blocking.
Zone WAF does not cover the Workers' separate `workers.dev` addresses; existing
Worker crawler protection remains useful there.

## Automatic additions during publication

[`hostname-firewall.mjs`](../scripts/hostname-firewall.mjs) synchronizes the enabled
rule with `ref: block_unconfigured_taelgar_hosts` before the remote storage
adapter writes `published/current.json`. This covers `npm run publish`, the
lower-level prepared-content activation command, and rollback. An unchanged
normal publication also checks/repairs host access without rebuilding content.

The publisher reads the new revision and retained rollback revision from their
uploaded runtime `sites` arrays, with a legacy `index.json` / `campaignHomes`
fallback. It validates host labels, adds their full hostnames plus the apex,
`www`, and `characters`, and preserves every existing allowlist entry. It reads
the rule again before updating to preserve recent dashboard additions, patches
only that rule's expression, and verifies the result through a fresh API read
before activating content. Unknown policy expressions, malformed manifests,
permission failures, and failed read-back stop activation. The current content
pointer stays unchanged. A failed activation may leave an extra allowed host;
the application still returns its usual 404 until content configures that host.

Initial rule creation/enabling remains a separate authorized setup action. An
absent/disabled rule is left unchanged; the publisher does not create or enable
one. Synchronization runs only for the inventoried Taelgar account, Worker, and
bucket, and never for local preview, build-only, or assets-only publication.
Remote publishers need WAF read access for the check and WAF edit access when
adding hostnames, in addition to their existing R2/D1 permissions. Using an old
publisher after enabling the edge rule will still require manual host additions.

With the updated publisher and token, a new campaign home needs only the normal
publication command: its edge allowlist addition is part of activation. Other
new web services still require a manual inventory/update. Automatic synchronization
never removes hosts; remove retired hosts manually only after checking live
content, rollback, and other services. This avoids accidentally blocking a service
that is not represented in the vault.

The shared D1 publication lock serializes publishers. Avoid editing this rule in
the dashboard during publication; the API has no cross-service transaction with
R2. API read-back confirms configuration acceptance, not simultaneous propagation
to every Cloudflare location. A newly added host can briefly return an edge 403
while Cloudflare propagates the rule. DNS and certificate coverage must already
exist through the wildcard setup.

For rollback, disable only the rule identified by
`ref: block_unconfigured_taelgar_hosts` using its recorded ruleset/rule IDs.
Keep existing bot rules, DNS, wildcard routing, and content untouched. Confirm
the disabled state by reading it back.
