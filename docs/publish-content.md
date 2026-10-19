# Export and publish Taelgar content

Run this from `taelgarverse-core` on Windows or macOS, with Node 22+ and Git:

```sh
npm ci
npm run content:publish -- --no-strict
```

This checks the Taelgar checkout's `HEAD` commit against the build metadata in
R2 **before opening an export or processing images**. If the commit and build
settings match the last clean publication, it skips the export, image processing,
and upload. It checks the local checkout; it does not fetch or pull Git changes.

The source vault must already be open in Obsidian, with Dataview indexed and the
updated Taelgar Dataview Materializer plugin loaded. The script finds the native
Obsidian CLI in its usual Windows/macOS installation location. It uses Node's
subprocess APIs directly, so shell syntax and paths with spaces work on both
systems. No Python or additional image-processing tools are required.

Before the first remote run, enable R2, create the configured bucket, and sign in
to Wrangler (`npx wrangler login`; use `npx.cmd` if PowerShell blocks `npx`). The
destination is the `CONTENT` binding in `wrangler.json`, with the same
`wrangler.local.json` overrides used by content preparation. Set `account_id` in
that override when choosing between multiple Cloudflare accounts. Existing
Wrangler API-token authentication also works. The publisher does not create
resources or deploy Worker code.

## What a changed commit does

1. Export into a fresh temporary directory using `--dynamic-website`: insert
   header markers, delete DataviewJS and newly empty sections, render Dataview.
2. Resize and compress the exported, publishable JPEG, PNG, and WebP assets.
3. Prepare the existing content-addressed assets, Markdown shards, and index.
4. Upload all immutable objects to R2. Only after that succeeds, write
   `published/current.json` with the revision, Taelgar commit, repository identity,
   build fingerprint, dirty flag, timestamp, and image/query statistics.

That final R2 write both activates the snapshot for the Worker and records its
commit for the next run. A failed export, image operation, or upload leaves the
previous pointer and commit intact. Authentication, network, bucket, and malformed
checkpoint errors stop the run; only a missing object means "first publication."
An older pointer containing just a revision triggers a build to establish Git
metadata. Manual `cf:publish` also writes a revision-only pointer, so a subsequent
publisher run rebuilds to restore its checkpoint.

No Worker redeploy is needed for content updates when using the Worker that reads
`published/current.json`. Deploy Worker code separately with `npm run cf:deploy`
when application code changes. Old immutable objects remain available in R2.

The default query policy is strict: a query error or unsupported query stops
publication. `--no-strict` permits partial output and prints each issue. The
current vault needs this option for one invalid query and five unsupported
queries. These six blocks stay unchanged; their counts are saved with the build.

## Image settings

The default longest edge is **2,560 pixels**, with no enlargement or cropping.
JPEG/WebP quality is **82**. PNG uses lossless encoding after any resizing,
preserving transparency. Filenames and formats stay the same, so links and MIME
types continue to work. Animated PNG/WebP, GIF, SVG, and other formats are left
intact. Image metadata is removed from recompressed files. If recompression is
larger, the original bytes are retained.

```sh
npm run content:publish -- --no-strict --max-image-size 4096 --image-quality 85
```

Choose a larger edge if map labels need more detail. Source-vault files are never
optimized; only disposable exported copies are changed. A cache keyed by original
image bytes, image settings, and Sharp/libvips versions avoids recompressing the
same image on later builds. Work is sequential to bound memory use.

## Testing and overrides

```sh
# Complete local build, without reading or writing R2:
npm run content:publish -- --build-only --no-strict

# Force an otherwise unchanged commit to rebuild:
npm run content:publish -- --force --no-strict

# Exercise upload/pointer behavior against the local R2 emulator:
npm run content:publish -- --local --no-strict

# Test uncommitted changes without contacting R2:
npm run content:publish -- --build-only --allow-dirty --no-strict
```

By default, the Taelgar checkout must be clean, including untracked, non-ignored
files. This ensures the saved commit identifies the exported content. Commit or
ignore local artifacts as appropriate. `--allow-dirty` explicitly permits a dirty
checkout; a remote publication is marked dirty and will never cause the next run
to skip. If a clean checkout changes during export/upload, the final pointer is
not advanced. Run one publisher at a time and avoid editing the vault during a
publication.

`--config FILE` (or `TAELGARVERSE_CONFIG`) selects the website settings; the vault
defaults to `runtime_dir`. `--vault PATH` overrides the source/runtime vault for
this run. `source_dir` is replaced with the fresh export internally; the preview
configuration is not changed. `--obsidian-command PATH` (or `OBSIDIAN_COMMAND`)
overrides executable detection. `--obsidian-vault NAME_OR_ID` explicitly chooses
an open vault when necessary.

Local reports and the image cache live in ignored `.cache/publish/`. Successful
builds remove their temporary export; failures retain it for inspection. The
prepared snapshot stays in `.cache/cloudflare/` for inspection and manual upload.
The saved local build metadata is `.cache/publish/latest.json`, with a separate
`materialization-report.json` for query details. A lock prevents concurrent runs
of this command on one machine. If a killed process leaves `publish.lock`, remove
that exact file after confirming no publisher is running.

Verification commands:

```sh
npm test
node --test tests/publish-r2.integration.mjs
```

The integration check uploads a small fixture through actual Wrangler commands
to an isolated local R2 emulator, reads its saved commit, and verifies that the
next run skips. It does not contact remote R2.

Reference: [Sharp resize options](https://sharp.pixelplumbing.com/api-resize/),
[Sharp output formats](https://sharp.pixelplumbing.com/api-output/), and
[Wrangler R2 commands](https://developers.cloudflare.com/workers/wrangler/commands/r2/).
