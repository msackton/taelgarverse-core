# Working in taelgarverse-core

Read [architecture and maintenance](docs/architecture.md) for component ownership,
required documentation updates, and checks. Preserve unrelated work in this
checkout and in the neighboring vault repositories.

## Check upstream before implementation

Before making implementation changes, fetch `origin/main` and compare it with
the local checkout. Check current `main` for the requested behavior in the code,
tests, and documentation. Implement only the missing work on a base that
includes current `main`. Preserve existing local changes while updating the
base. If the remote is unavailable, report that before starting substantial
implementation from an unverified checkout.

## Mandatory permission gates

**NEVER change a production Cloudflare environment, push to a remote, or create
a commit in the sibling `taelgar` repository without explicit permission from
the human user for that specific action. These are hard requirements.**

- A request to implement a feature, fix a bug, complete a plan, or "go ahead"
  with development does **not** authorize production changes or a remote push,
  even when a plan mentions eventual rollout.
- Before a production change, explain the exact action, target environment, and
  expected impact, then obtain explicit user permission. Existing explicit
  permission for that action and scope is sufficient; do not ask for it again.
- This applies to CLI commands, APIs, dashboard actions, scripts, CI workflows,
  and delegated work. Production changes include deployments, rollbacks, DNS,
  domain attachments, routes, bindings, secrets, R2/D1 writes, content publication
  or activation, migrations, and cleanup. Never use a production write as an
  incidental test. Read-only production inspection is allowed.
- **Local commits in `taelgarverse-core` are allowed without separate permission**
  for authorized task changes. Stage only the task's files and preserve unrelated
  work. Permission to commit locally does **not** authorize pushing any branch or
  tag to any remote. Obtain explicit permission before a push, merge, or workflow
  trigger that causes a production deployment.
- **Commits in `taelgar` always require explicit user permission for the commit
  and its scope**, including commits made indirectly by scripts or tools. Editing
  vault files or publishing content does not authorize a vault commit. If a
  workflow needs a clean vault checkout, report the prerequisite and ask; never
  create a convenience commit to make it proceed.
- If permission is absent or ambiguous, stop before the gated action and ask.
  Continue independently authorized local work when possible. Never bypass these
  gates by switching tools or triggering an action indirectly.

## All releases must come from main

**No release of any kind may come from a branch other than `main`. There are
no exceptions.** Use the `main` branch of the repository that owns the released
source. Verify that the exact source commit is on remote `main` before creating
a release tag, dispatching a release workflow, or publishing release artifacts.
If the reviewed changes are on another branch, land them on `main` with the
required authorization before starting the release. This rule governs every
linked release procedure, including instructions that refer to a source branch
or source ref.

## Content publication and website deployment

These are separate release paths:

- **Vault content:** publish the local `taelgar` notes, media, homepage, and menu
  to Taelgar's Cloudflare R2/D1 storage using the publishing scripts in **this
  repository**, normally `npm run publish -- --no-strict`. This changes production
  and requires explicit permission. Committing or pushing the vault to GitHub
  does not publish its content to Cloudflare.
- **Website/code:** deploy through **GitHub Actions**. A push to this repository's
  `main` branch triggers `.github/workflows/website.yml`, which runs tests before
  deploying the Worker and static application assets. This does not publish vault
  content. Do not push without explicit user permission, and do not substitute
  a direct local production deployment unless the user explicitly authorizes
  that method. See [deployment workflows](docs/deploy.md).

## Obsidian releases

When asked to prepare, test, or publish a **Taelgarverse Obsidian release**, follow
[the agent release procedure](docs/obsidian-releases.md). The agent reviews the
actual changes and writes the notes; the helper handles version consistency;
GitHub builds and publishes. A request to **prepare** ends with a reviewable
proposal. A request to **publish/release** authorizes the described publication
steps, including the push to core `main` needed for the plugin release and the
website deployment that GitHub Actions triggers from that push. This permission
covers the release changes and their automated website deployment. Publishing
vault content or deploying directly still requires separate authorization.
Do not ask for the same authorization again if it was already given.
Never interpret an ordinary code commit/push as a request for a plugin release.
