# How the site runs on Cloudflare

The live site is [taelgarverse.msackton.workers.dev](https://taelgarverse.msackton.workers.dev/).
Cloudflare runs the website and stores the published copies of the vault.
Your local Obsidian vault is where you edit the content.

For publishing steps, commands, and account setup, see [Update the website](deploy.md).

## The pieces

| Piece | What it does |
| --- | --- |
| **Worker: `taelgarverse`** | The program that turns notes into web pages. It chooses what to show for the reader's selected campaign and date. |
| **R2 storage: `taelgarverse-content`** | Holds the published notes, images, audio, homepage, menu, and supporting data. Cloudflare calls this storage container a “bucket.” |
| **Website files from `public/`** | The styles, browser scripts, icons, and diagram support used by the site. These are uploaded with the website code. Vault images and audio go in R2 instead. |
| **Workers Builds** | The connection to GitHub that updates the website code when changes merge into `taelgarverse-core/main`. |
| **Logs** | Records of website errors and build failures, available in Cloudflare. Logging is enabled in the project configuration. |

The Worker reaches R2 through a connection named `CONTENT`, and the website
files through one named `ASSETS`. Cloudflare calls these connections “bindings.”
They let the Worker use those resources without a saved API token in its code.
See Cloudflare's [R2 connection guide](https://developers.cloudflare.com/r2/api/workers/workers-api-usage/).

The project declares no separate database or scheduled publishing job. Its
configuration is in [wrangler.json](../wrangler.json); the
[settings reference](deploy.md#cloudflare-settings) explains each setting.

## How updates reach the site

**Website code:** merge a change into `main` in GitHub. Cloudflare builds and
deploys the Worker and website files. This changes page rendering, styles, and
site features. The build uses the core repository; it does not need Obsidian or
a copy of the vault.

**Vault content:** run `npm run content:publish -- --no-strict` on your computer.
The script asks Obsidian to prepare the notes, makes copies of large images
smaller, and uploads a complete saved version to R2. Once the upload succeeds,
it tells the Worker to use that version. No website code deployment is needed.
The homepage and menu come from `taelgar/_website` and are included in the same
publication.

The publisher uses your local Cloudflare login or API token. The GitHub build
has its own Cloudflare authorization. These are separate from how visitors
read the site.

The site footer shows the content publication date (UTC) and abbreviated core
and Taelgar commit IDs. Hover a hash for the full ID and publication timestamp;
click it to copy the full ID. The core timestamp appears only in its tooltip.
An asterisk marks uncommitted changes. Older publications without provenance
show an unavailable date or hash until content is published again.

Wrangler's custom build step captures the core commit and timestamp immediately
before deployment in `.generated/core-release.mjs`. These travel with the Worker
version, including on rollback. Content commits are stored in the immutable
snapshot; activation timestamps come from that request's `published/current.json`
(`completedAt`). Restoring a saved pointer restores its date and commit together.
Local Node previews show checkout hashes and “Local preview” without publication
dates. No Git or GitHub requests occur in the deployed Worker or browser.

For maintainers checking the build setup: the Mermaid diagram files must be
generated before deployment. Using `npm run cf:deploy` as the deploy command
includes this step. If the deploy command is `npx wrangler deploy`, use
`npm run build:browser` as the build command. The destination Worker must be
`taelgarverse`. These are supported setups; the exact current dashboard commands
were not checked. Cloudflare explains the two commands in its
[build settings guide](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

## What is stored in R2

Each publication gets a long unique ID, called a **revision**. The storage
contains three kinds of files:

| Location | What it contains |
| --- | --- |
| `published/current.json` | A small file saying which revision the website should use. It also records the Git version and publishing settings so unchanged content can be skipped next time. |
| `revisions/<revision>/` | A saved version of the notes and supporting data. `index.json` holds the homepage and menu Markdown, plus the page list, campaign information, metadata, backlinks, and media locations. The `notes/` folder holds article Markdown in groups of files. |
| `assets/` | Images, audio, and other published attachments. Identical files share one stored copy, even across publications. |

Older publications and media remain in storage. There is no automatic cleanup.
The JavaScript that generates note headers is part of the Worker code, so changing
those rules requires a [code update](architecture.md#change-and-release-rules).

## What happens when someone opens a page

1. The Worker checks which content revision is current.
2. It finds the requested note and checks whether it is available for the
   selected campaign and date.
3. It reads the note, creates its header, and turns the Markdown into a web page.
4. The browser loads the page's images and audio through the Worker from R2.

Visible note embeds load their note shards on demand, using the same selected
campaign/date as the parent. Request-local note data avoids repeated loads during
nested expansion. Hidden embeds and nested embeds outside a requested section do
not trigger body reads. No separate embed index or snapshot schema is required.

The homepage uses the published `_website/home.md` text, with links and marked
content adjusted for the reader's campaign and date. Submitting its search box
opens the page finder at `/?q=...`. An older publication without homepage text
continues to show the page finder until content is published again.

The Worker reuses loaded note data to keep this fast, but checks for a new
publication on content requests. Page responses are marked not to be cached;
browsers can reuse images and audio after checking whether they have changed.

Readers do not need a login. **Behind the Curtain is also available to everyone.**
Hiding a note from a campaign view does not make its media private, and its
metadata may still contribute to names and relationships shown elsewhere.
See [when a page is shown](vault.md#when-a-page-is-shown).

The site does not offer a raw Markdown or full index download. R2 does not need
public access: the Worker serves the content. Keep the bucket private.

## Check the site

Open the [health page](https://taelgarverse.msackton.workers.dev/health) to see the
current revision, page count, and warnings. The
[campaign information page](https://taelgarverse.msackton.workers.dev/api/contexts)
shows the available campaign views, their dates, and which session notes supplied
those dates.

- `ok` means the content index loaded. Still check the pages and media you changed.
- `awaiting-content` means no publication has been selected yet.
- A `503` error can mean required published files are missing or invalid.
- A `404` or `422` on an article can come from the note or selected campaign/date;
  check [vault usage](vault.md) as well as the error message.

For code deployment failures, look at the Cloudflare build log. For errors while
reading the website, look at the Worker's logs.

## Restore older content

Usually, the easiest fix is to correct the vault, commit it, and publish again.

To restore a saved publication directly, first check that its notes and media
still exist in R2. Then replace `published/current.json` with a saved copy from
that successful publication. This tells the website to use the older content.

If only the revision ID is available, that file can contain
`{"revision":"<64-character revision ID>"}`. The site can read it, but the next
publishing run will rebuild because the record of the previous Git version and
settings is missing.

Restoring an older Worker deployment changes website code only. It does not
change which vault publication is selected in R2.

## What was checked

On **2026-10-19**, the public health page reported `ok`, `cloudflare-worker`,
**3,029 pages**, and no index or campaign warnings. The maintainer confirmed
automatic deployment from `main`.

Resource names and settings above come from the repository. Dashboard-only
settings, including the live bucket connection and exact build commands, were
not independently checked because the local Cloudflare login had expired.
The move to vault-authored homepage and menu files is implemented in this checkout;
the live site needs the updated core deployment and a new content publication.

## Isolated AI Search pilot

The separate `taelgarverse-search-pilot` instance uses built-in storage and hybrid
keyword/vector indexing. Its creation and initial 22-note indexing were verified
through the AI Search API on 2026-10-19. It uses the default
`@cf/qwen/qwen3-embedding-0.6b` embedding model, 800-token managed chunks, and zero
managed overlap. Fixed pilot views use `owner`, `run`, `view`, and `sha256` text
metadata; raw publication shards are not a data source.

The [pilot client](../experiments/ai-search/cloudflare.mjs) fixes the instance
name and uses the existing Wrangler login or an environment token. The
[operating guide](../experiments/ai-search/README.md) owns commands, limits,
artifacts, and cleanup. No binding to this instance has been added to the
production Worker; the local pilot viewer performs the experiment's queries.
