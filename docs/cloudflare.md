# Cloudflare publishing

The Cloudflare version serves the same site through a Worker, with a private R2
bucket holding the content snapshot and binary assets. The initial Worker name
is `taelgarverse-preview`; its first public URL will be on your `workers.dev`
subdomain. The original GitHub Pages site is independent of this deployment.

## Current state

The Worker builds and runs locally against Cloudflare's Workers runtime and R2
emulator. Real-vault article output matches the original Node renderer across
the six benchmark requests with See Behind the Curtain on and off. The shared
test suite covers the snapshot and Worker request handler too.

The first prepared snapshot contains 2,685 notes and 681 indexed asset paths
(about 1.6 GB of asset data). Deduplicated assets and 32 Markdown shards produce
711 uploaded objects, including the metadata index. This is a content snapshot;
HTML still renders for each requested date and campaign.

No remote bucket, Worker, or domain was created in the initial preparation.
The CLI's saved login was expired; sign-in was deferred by the user.

## Local Cloudflare preview

Requires Node 22+, the sibling vault and ignore file configured in
config.example.json, and dependencies installed with `npm ci`.

```powershell
npm run cf:prepare
npm run cf:seed
npm run cf:dev
```

Open http://127.0.0.1:8787/. `cf:seed` explicitly writes to local R2 storage,
under `.wrangler/state`, and `cf:dev` uses those local bindings. Neither command
uploads content to Cloudflare. The first seed copies the asset data into local
emulator storage, so it takes longer and uses more disk than the Node preview.

Verify the running Worker with:

```powershell
npm test
npm run cf:check
npm run cf:smoke
```

`cf:check` bundles the Worker with Wrangler's deployment dry run. `cf:smoke`
compares the actual running Worker with the local reference renderer. It accepts
a different URL as an argument, including a deployed preview URL.

## First hosted preview

Refresh the CLI login in an interactive terminal:

```powershell
npx.cmd wrangler login
npx.cmd wrangler whoami
```

Confirm the intended account. If it has multiple accounts, or you want different
resource names, create ignored `wrangler.local.json` with the desired overrides:

```json
{
  "account_id": "your-account-id",
  "name": "taelgarverse-preview",
  "r2_buckets": [
    {"binding": "CONTENT", "bucket_name": "taelgarverse-content"}
  ]
}
```

Publish the web core directly from this repository. It only needs the checked-in
Worker code and `public/` assets. Cloudflare's deploy command can remain
`npx wrangler deploy` with no build command or vault checkout. A new Worker
responds to `/health` with `awaiting-content` until content is published:

```powershell
npm run cf:check
npm run cf:deploy
```

Publish vault content separately from a machine with the configured vault:

```powershell
npm run cf:prepare
npm run cf:bucket
npm run cf:upload
npm run cf:publish
```

Bucket creation is a one-time operation. If the named bucket already exists,
verify that it is the intended content bucket before using it. R2 must be
enabled on the account. The bucket can remain private: visitors receive rendered
HTML and indexed assets through the Worker. There is no raw-Markdown route.

Wrangler prints the actual public URL after deployment. Check it with:

```powershell
npm run cf:smoke -- https://the-url-printed-by-wrangler.workers.dev
```

The upload wrapper records success for the prepared revision, bucket, Worker
name, and configured account. `cf:publish` requires that matching receipt, then
updates `published/current.json` in R2. The Worker reads that pointer on each
request and loads the new snapshot without a Worker deployment. An account ID
in the override file makes the destination explicit between runs.

The upload command uses the pinned Wrangler version's experimental `r2 bulk put`
command. It streams files with bounded concurrency. The wrapper validates that
every object key belongs to the prepared revision or a content hash, then skips
Wrangler's overwrite prompt: retrying the upload writes the same immutable
objects. Use the dedicated normal R2 bucket created above. Verify this command
when upgrading Wrangler.

## Content updates and rollback

After editing Markdown, navigation, or content configuration, run prepare,
upload, and publish again. Repeat seed instead of upload and publish for a
local-only update. Web core changes deploy through `cf:deploy` independently.

Preparation creates `.cache/cloudflare/latest.json`, a revision directory with
the metadata index, Markdown shards, and upload manifest, and content-addressed
asset copies. It also emits an R2 pointer file and an ignored Wrangler config
for content upload. Static theme files and the Worker header runtime are part
of the web core repository.
No output is written to the vault. Configuration and machine paths are excluded
from the uploaded metadata index.

The Worker lazily reads the requested Markdown shard. It keeps a bounded cache
of eight shards and shares the immutable metadata/link/header indexes between
requests. Header objects and date/campaign preferences are request-local.
Binary assets stream from R2 with ETags, conditional GET, and byte-range support.

Existing revisions and asset objects remain available for rollback. To select
an earlier content revision, publish a pointer containing that revision to
`published/current.json`. Worker rollback is a separate operation. There is
no automatic deletion of old content in this version.

## Runtime compatibility and scope

The hosted renderer uses a checked-in JavaScript module derived from the vault's
trusted CustomJS classes. A syntax-aware transform replaces
Obsidian's `.first()`, `.last()`, and `.contains()` helpers with standard methods.
Changes to those CustomJS classes are renderer changes: run
`npm run build:worker-headers`, commit `src/worker-headers.mjs`, then deploy the
web core. Markdown and asset changes only need the content publication step.
It uses neither `node:vm` nor runtime evaluation and does not modify global
prototypes. The local Node preview retains the VM adapter as a reference;
article rendering, routing, filters, Markdown, and navigation are shared.

Wrangler currently warns about an existing nullish-coalescing expression in the
upstream date utility. That source rule is preserved and parity checks pass.
The warning does not prevent the build.

See Behind the Curtain remains a viewing preference for everyone. There is no
DM login requirement. HTML/API responses retain `Cache-Control: no-store` during
this first migration. Content-aware HTML caching can be added after deployment
measurements. A custom domain and automated publishing can follow the preview.

Workers Free has a 10 ms CPU limit per request, which may be too tight for cold
snapshot initialization or larger pages. Measure on the hosted preview; the
Workers Paid plan starts at $5/month and provides higher CPU limits. No plan
change is performed by these scripts. Optional paid-plan CPU limits can be set
through a `limits` override in `wrangler.local.json`.

Provider references: [Workers Node compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/),
[R2 bindings](https://developers.cloudflare.com/r2/api/workers/workers-api-usage/),
[static assets](https://developers.cloudflare.com/workers/static-assets/),
[pricing](https://developers.cloudflare.com/workers/platform/pricing/), and
[deployment rollback](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/).
