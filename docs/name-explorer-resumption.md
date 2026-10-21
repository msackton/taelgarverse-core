# Name explorer: resumption notes

Status: parked prototype, 2026-10-20. The user did not find this direction
compelling enough to adopt. Preserve the experiment on `codex/name-explorer`
and its draft PR; do not merge it to `main` or publish it without a new decision.

## What was explored

The initial goal was to move browsing from the vault's Name Explorer onto the
website, while keeping editing, review, and naming decisions in the vault.
Public AI name generation was considered and set aside. Language shelves were
the preferred mockup, but the full-vault version felt like an uninteresting list.
The second iteration separates first names and surnames and shows the people
whose recorded full names use a selected part. This also remains an experiment.

Current constraints:

- Browsing is read-only; editing and review stay in the vault.
- No public AI tool, generation service, prompts, or usage limits were added.
- Browse the full eligible vault independently of reader context. The user
  explicitly said not to worry about reader context. Article links still use
  the website's ordinary context and availability rules.
- Preserve authored names and language labels. Neither vault metadata nor the
  old vault explorer was changed or removed.

## What is in the branch

- `/names` and `/api/names`, plus a **Names** header link.
- The default `view=parts` has first-name and surname shelves, grouped within
  language, with distinct-person counts and source full-name/article links.
- `view=names` retains the first iteration: whole-name shelves by subject type,
  pronunciations, meanings, alternate forms, and article links.
- Language/type filters, accent-insensitive live search, selection URLs,
  pagination, ordinary link/form fallbacks, and progressive browser navigation.
- Local compilation from `Metadata:names:v1`, eligible frontmatter names/aliases,
  and direct decisions in `_Plugins/Name Explorer/Name Decisions.jsonl`.
- An optional version-1 name index in content snapshots, shared Node/Worker
  queries, and publication fingerprint coverage. No new binding or migration.
- Documentation in [the name explorer guide](names.md), with ownership and
  publication references in the existing core docs.

At the last local review, the vault supplied 2,743 whole-name forms for 2,332
subjects. The parts projection produced 831 first-name entries and 248 surname
entries across 853 people. These are observations of that vault state, not fixed
expected counts; identical spellings in different languages remain separate.

## Limits that matter before resuming

The vault mostly records complete names, not first/last components. The parts
view therefore uses explicitly unconfirmed browsing splits. Common leading
titles, regnal numerals, and descriptive endings are omitted; surname particles
stay attached. Longer ambiguous names contribute only their first word. A
simple two-word split does not prove which component is a hereditary surname
or establish a culture's naming order. This needs a product/data decision, not
just more token-splitting rules.

An exact recorded component supplies its language and any component-specific
pronunciation or meaning. Otherwise the part is grouped under the full name's
language and that inheritance is explained in the details. Full-name
pronunciations are not copied onto smaller parts. Proposed/disputed source
records remain labeled. Conflicting component evidence still needs vault review.

Other known limitations:

- Authored language labels include variants such as Dwarven/Dwarvish and
  Elven/Elvish; no normalization was attempted.
- Three malformed name blocks fell back to eligible frontmatter names during
  the initial review: Pietravola Abbey, Avelina Smith, and Selma Wisthelwind.
  No vault fixes were made. They may have changed since that review.
- Vault-explorer language heuristics, catalog rules, grouping overrides, prose
  extraction, and place-evidence scores were not ported.
- The overview samples sixteen entries across each alphabetical collection;
  **Browse all** paginates the chosen collection in groups of seventy-two.
- The old vault explorer is still available. This branch is not a completed
  replacement or a rollout plan.

## Resume locally

Use this branch in an isolated checkout. Install dependencies with `npm ci`.
Set the ignored `config.local.json` to the original vault location, for example:

```json
{"vault_dir":"D:/personal/taelgar"}
```

For an automatically refreshing preview:

```text
npm run dev -- --port 8770
```

The supervisor stops and restarts the server as the vault changes. During an
active vault-editing session this repeatedly interrupted browsing. For a stable
review, run the server directly instead, after stopping any preview on that port:

```powershell
$env:PORT = '8770'
node src/server.mjs
```

That server reads a vault snapshot at startup. Restart it manually after source
or vault edits. Open `/names?view=parts&language=Sembaran` for the split view,
or `/names?view=names` for the original whole-name shelves. The **Thorne** surname
was a useful example of deduplication: five source people under one entry.

Machine-specific settings, dependencies, generated caches, and screenshots are
not part of the branch. The branch contains no vault content publication.

## Validation already performed

- `npm test`: 362 tests passed after the parts iteration.
- `node --test tests/names.test.mjs`: 10 passed after the final source-status
  display adjustment.
- `node scripts/cloudflare.mjs check`: local package dry run passed; the existing
  generated-header `??` warning remains unrelated to this experiment.
- `node --test tests/publish-r2.integration.mjs`: local storage integration
  passed during the initial whole-name implementation.
- Browser checks covered language filtering, live search, selection, grouped
  surname sources, full-name links, switching views, and browser history.
- Documentation links and `git diff --check` passed.

No production deployment, vault publication, or vault commit was performed.
The draft PR is for preservation and resumption, not approval to merge.

## Decisions to make next

Start by deciding what this browser should help someone accomplish. The user
normally gets good naming help from AI chat with vault context; a public AI tool
was not appealing, and reorganizing the same inventory has not yet demonstrated
enough value. Revisit whether language examples, naming patterns, comparisons,
relationships, or assembling a shortlist actually help before extending the UI.

If first-name/surname browsing is worth continuing, decide how those components
should be recorded and reviewed in the vault, including mononyms, bynames,
patronymics, mixed-language names, and culture-specific order. Keep inferred
splits visibly provisional until there is authoritative component data.

If this ever becomes a release candidate, review the prototype's scope afresh,
rerun checks against the then-current vault, and follow the separate website
deployment and content publication paths. The existing permission gates still
apply; retaining this branch does not authorize either path.
