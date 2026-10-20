# Development and publication workflows

The site is [taelgarverse.msackton.workers.dev](https://taelgarverse.msackton.workers.dev/).

- **Notes, images, audio, homepage, and menu in `taelgar`:** run the publishing command below.
  Saving them to GitHub alone does not update the website.
- **Website code in `taelgarverse-core`:** merging changes into `main` on
  GitHub runs tests, then deploys to Cloudflare only if they pass (after the
  one-time GitHub deployment setup below).
- **Taelgarverse Obsidian plugin:** publish a separate BRAT release. Its first
  version includes Maps only; the materializer still follows the existing vault
  workflow. See [plugin development and releases](../obsidian/taelgarverse/README.md).

Start with [publishing](#publish-your-latest-notes) for a normal update.
The references below explain [publishing options](#publishing-options),
[configuration settings](#configuration-settings), and
[maintenance internals](#command-reference).

## Local preview and testing

After `npm ci`, use one of these commands from core:

| Command | What it does |
| --- | --- |
| `npm run dev` | Reads the live vault without Obsidian. Restarts on vault/source changes; refresh the browser. Some Dataview content can be incomplete. |
| `npm run dev -- --full` | Exports through running Obsidian, processes images/maps/search, loads local R2/D1, and starts the local Worker. No live publication. Rerun after editing notes. |
| `npm run dev -- --plugin` | Builds and installs Taelgarverse in the configured vault. Tries to reload it in running Obsidian; otherwise asks for a restart. |
| `npm test` | Runs the automated suite without running Obsidian. |

Both previews use http://127.0.0.1:8765/. Add `--port 8766` if needed.
Use `--vault PATH` or `--config FILE` to select local inputs without changing
shared defaults. `--plugin` can be combined with `--full`. Quick preview uses
the original vault even if `source_dir` points to an earlier export.
Full preview permits uncommitted notes and reports unsupported materialization
queries; it never contacts production R2/D1. Its cached data stays in core.

## GitHub tests, website deployment, and plugin releases

The **Tests** workflow runs on pull requests and is reused by website and plugin
release workflows. **Test and deploy website** runs on pushes to core's `main`.
Both automatic triggers skip changes that only affect `.md` files anywhere in
the repository; changes that include any other file still run. Explicit plugin
releases continue to run the reusable tests regardless of changed paths.
The test job checks out public vault Markdown and header metadata/scripts, excluding assets,
then runs `npm test`, local R2/D1 integration checks, and the Worker packaging
check. Testing requires no Obsidian or Cloudflare credentials. The website
deployment job requires the tests to succeed; failures skip deployment and leave
the current site running. Production pipelines are serialized. Deployment uploads
Worker code and static website assets; it does not publish vault content to R2/D1.

### One-time GitHub website deployment setup

1. In Cloudflare, create an API token using the **Edit Cloudflare Workers**
   template, scoped to the **Taelgar** account and the **taelgar.org** zone for
   the custom domains declared in `wrangler.json`. Follow Cloudflare's
   [GitHub Actions authentication guide](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).
   Use a separate deployment token; the local content publisher has different needs.
2. In `msackton/taelgarverse-core` → **Settings → Secrets and variables → Actions**,
   add repository secret **`CLOUDFLARE_API_TOKEN`** with that token. Never put its
   value in Git, chat, or a repository variable.
3. Add repository variable **`CLOUDFLARE_ACCOUNT_ID`** with
   `2328f3621c0a639572c74f537c5854c4` (Taelgar).
4. Before pushing the workflow change to `main`, open Cloudflare → **Workers &
   Pages → taelgarverse → Settings → Builds** and disconnect the Git repository.
   This removes the independent deployment trigger; the deployed Worker and its
   R2/D1 data remain. Keep the GitHub repository itself and the Worker.
5. Push the reviewed workflow changes to `main`, then verify **Test and deploy
   website** completes successfully in GitHub Actions and check the live site.
   Until that verification, the existing deployed version continues to serve.

The migration is not active merely because these files exist locally. Both the
GitHub credential setup and Cloudflare trigger change are required. Afterward,
retry a failed run in GitHub Actions after fixing the cause. A failed test run
never starts the deployment job. A failure after deployment has started requires
checking the job log and live version; it is not an automatic rollback.

For an Obsidian release, commit the version, compatibility entry, and release
notes, then use **Release Taelgarverse for Obsidian** in GitHub, or push a tag
named `obsidian/<manifest version>`. GitHub runs the same CI checks, builds,
uploads a complete draft, and publishes it to BRAT. Manual dispatch can opt to
leave a draft. The one-time distribution-repository credential is described in
the [plugin guide](../obsidian/taelgarverse/README.md).

For agent-driven release preparation, version updates, notes, and publication,
follow the [agent release procedure](obsidian-releases.md). The helper prepares
only the three release files; the agent reviews the change scope and GitHub
continues to own release builds and publication.

## Publish your latest notes

If this is your first time publishing from this computer, follow
[Set up this computer](#set-up-this-computer) first.

1. Make sure your local `taelgar` folder has the content you want to publish.
   Save your edits and commit them in Git. The publishing script uses the files
   on this computer; it does not download changes from GitHub.
2. Open that vault in Obsidian. Wait for Dataview to finish loading, and make sure
   the **Taelgar Dataview Materializer** plugin is enabled. If you updated the
   plugin, restart Obsidian first.
3. Open a terminal in the `taelgarverse-core` folder and run:

   ```sh
   npm run publish -- --no-strict
   ```

4. Leave Obsidian open and avoid editing the vault until the command finishes.
   Then open the website and check the pages you changed, including their images
   and any relevant campaign/date views.

The command prepares copies of your notes, generates small image variants, and
uploads the results and stages the matching D1 search index. It switches the site
to new content after both are verified. Your original notes and images stay
unchanged. If the same saved version/settings are online, it checks search
readiness and skips rebuilding while retrying any pending retention cleanup.
The updated core connects the search UI to that published D1 index.

`--no-strict` means “continue if a Dataview query cannot be converted.” Read the
warnings: those queries may appear as unavailable content on the website. Leave
out `--no-strict` if you want any query problem to stop publication.

### Update the homepage or menu

In your `taelgar` vault, edit `_website/home.md` for the homepage text and links,
or `_website/navigation.md` for the sidebar menu. Save and commit those files,
then run the same publishing command above. They are published with your notes.
You do not need to edit website code for later text or menu changes.

The homepage keeps a search box below the text. The menu format is explained in
the [navigation reference](../README.md#site-navigation-and-page-toc).

Note embeds use the existing published Markdown;
they need the updated renderer but no new snapshot format or Obsidian plugin.

## Set up this computer

You need Node.js **22.12 or later**, Git, and Obsidian with its command-line tool
available. The script finds Obsidian automatically in the usual Windows and
macOS installation locations.

Keep the `taelgar` and `taelgarverse-core` folders beside each other. From a
terminal in `taelgarverse-core`, install the required packages:

```sh
npm ci
```

Run this again after pulling changes to the project's dependencies.
`npm ci` installs the exact package versions recorded by this project.

In commands such as `npm run publish`, `npm run` starts one of the
project's named scripts. The extra `--` passes any following options to that
script. For example, in `npm run publish -- --no-strict`, `--no-strict`
is an option for the publisher.

Next, sign in to Cloudflare:

```sh
npx wrangler login
npx wrangler whoami
```

Wrangler is Cloudflare's command-line tool. The first command opens a browser
for you to sign in; the second shows which account you can use. Sign in with
access to the account that owns TaelgarVerse. You do **not** need an API token
when using this login method.

The project already knows the website name (`taelgarverse`) and the Cloudflare
storage location (`taelgarverse-content`), and search database
(`taelgarverse-search`). These are already configured. Your login needs D1
Read/Write permissions as well as R2 access; Wrangler login includes them.

On Windows, if PowerShell blocks `npm` or `npx`, use `npm.cmd` or `npx.cmd` instead.

### If Cloudflare asks which account to use

Skip this unless your login has access to several accounts and publishing cannot
choose one. Find the correct account ID in the output of `npx wrangler whoami`.
In PowerShell, set it before running the publishing command:

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = 'paste-the-account-id-here'
```

This tells the script where to publish for the rest of this terminal session.
The account ID identifies the account; your login provides permission to use it.

## Image settings

Original exported images are retained at full resolution for download and
detailed pan/zoom. Publication inspects image uses in the exported notes and
homepage, then generates the needed WebP widths. A fixed 300px image normally
gets 300px and 600px inline copies plus a popup version. Reused images share the
combined set of widths. Layout roles, table limits and mobile behavior provide
bounds where a note does not declare a width. Wide layouts also get a phone-sized
choice; nearby widths are combined. Images not displayed inline get no inline
derivatives. Originals remain indexed for ordinary asset links.

The largest popup derivative defaults to a **2,560-pixel longest edge**. Nothing
is cropped or enlarged. Smaller derivatives that cost more bytes than a sharper
alternative are omitted from the choices sent to browsers.

JPEG/WebP derivatives use quality **82**. PNG derivatives use lossless WebP
encoding and retain transparency. Animation, unsupported formats and audio keep
their existing delivery. Leaflet maps retain full-resolution imagery and their
separate WebP tile pipeline. Vault originals remain untouched.

Article images select a small variant for their actual layout and screen density;
offscreen images are deferred. The popup loads a screen-sized version only when
opened. Detailed pan/zoom and **Download** request the original. Both the updated
core and a fresh content publication are needed for responsive delivery; old
snapshots continue working with their existing images. See [image delivery](images.md).

To increase the largest popup derivative, publish with a larger image limit:

```sh
npm run publish -- --no-strict --max-image-size 4096 --image-quality 85
```

These settings affect derivatives; the downloadable original stays unchanged.

## Publishing options

Add these after `npm run publish --`. You can combine them unless noted.

| Option | What it does |
| --- | --- |
| `--no-strict` | Continues when a Dataview query cannot be converted, and reports the problem. Without this option, query problems stop the export. |
| `--force` | Publishes again even when the saved Git version and settings appear unchanged. |
| `--build-only` | Prepares the notes and images on this computer without contacting Cloudflare storage. Useful for checking an export. |
| `--local` | Publishes into a local copy of Cloudflare storage for previewing. The live site stays unchanged. Use this or `--build-only`, not both. |
| `--allow-dirty` | Allows uncommitted vault changes. Useful for local checks; if used for a live publication, the next publication will rebuild. |
| `--vault "path/to/taelgar"` | Uses this vault instead of `vault_dir` for one publication. Use the root of its Git repository. |
| `--config preview.json` | Uses a different settings file instead of `config.local.json`, keeping shared defaults for anything omitted. See [configuration settings](#configuration-settings). |
| `--max-image-size 4096` | Sets the longest responsive-image edge in pixels. Default: `2560`; originals remain full resolution. |
| `--image-quality 85` | Sets JPEG/WebP derivative quality from 1 to 100. Default: `82`; PNG derivatives use lossless encoding. |
| `--obsidian-command "path/to/Obsidian"` | Tells the script where Obsidian's command-line program is if it cannot find it automatically. |
| `--obsidian-vault "Taelgar"` | Selects the vault by its Obsidian name or ID when needed. |
| `--help` | Prints the available options and exits. |

For example, check uncommitted edits without changing the live website:

```sh
npm run publish -- --build-only --allow-dirty --no-strict
```

For the complete local materialization and publication dry run, use `npm run dev -- --full`. It starts the local Worker after preparing its local R2/D1 data. Press Ctrl+C to stop it.

## Configuration settings

Settings are split by purpose. The shared defaults work when `taelgar` and
`taelgarverse-core` are beside each other.

| File | Purpose |
| --- | --- |
| `config.json` | Shared vault and website settings, saved in Git. |
| `config.local.json` | Optional changes for this computer. Loaded automatically and excluded from Git. Include only the settings you want to change. |
| `wrangler.json` | Shared Cloudflare settings, saved in Git. |
| `wrangler.local.json` | Optional Cloudflare account or destination changes for this computer. Loaded by the project's Cloudflare scripts and excluded from Git. |

### Vault and website settings

The shared defaults are in [config.json](../config.json):

| Setting | Default | What it controls |
| --- | --- | --- |
| `vault_dir` | `"../taelgar"` | Your Taelgar vault. Used for notes, media, supporting scripts, and metadata by previews and publishing. This is the only folder you normally need to set. |
| `default_date` | `"1750-01-01"` | The in-world fallback date when no campaign session date is available. Use a full year-month-day date. Campaign dates normally come from session notes. |
| `source_dir` (optional) | Uses `vault_dir` | Selects content for internal preparation/server tools. Quick `dev` deliberately reads the live vault; full `dev` prepares its own materialized snapshot. |
| `nav_source` (optional) | `_website/navigation.md` inside the vault | Uses a different menu file. Set it to `null` to build the menu from the note folders. |
| `home_source` (optional) | `_website/home.md` inside the vault | Uses a different homepage file. Set it to `null` to show the page finder as the homepage. |

To use a vault in another location, create `config.local.json` in
`taelgarverse-core` with:

```json
{
  "vault_dir": "D:/notes/taelgar"
}
```

Replace the example path with your vault's location, then run the usual commands.
No extra command option or terminal setting is needed. The homepage and menu
automatically come from that vault's `_website` folder. The fallback date still
comes from `config.json` because it was not changed in the local file.

Paths are relative to the file containing them. `../taelgar` means “go up one
folder, then into taelgar.” Use forward slashes in Windows JSON paths, as above.
Leave `source_dir` out for normal use. For an already exported copy, set it to
the export folder and keep `vault_dir` pointing at the original vault for scripts
and metadata, including the homepage and menu. Setting `source_dir` to `null` also
means “use the vault.” The full
publisher always exports from `vault_dir` and prepares its own content folder.

Leave `nav_source` and `home_source` out for normal use. Both files must exist in
the vault's `_website` folder. If you had a local `nav_source` pointing to the old
core `navigation.md`, remove that setting so it uses the new location.

Older files using `runtime_dir` still work. To simplify one, rename `runtime_dir`
to `vault_dir` and remove `source_dir` if it repeats the same vault path.

For a separate named setup, use
`npm run publish -- --config preview.json --no-strict`, or set
`$env:TAELGARVERSE_CONFIG = 'preview.json'` for commands in a PowerShell terminal.
The selected file replaces `config.local.json` for that run; omitted settings
still come from `config.json`. An explicit `--config` takes priority over the
terminal setting. Inherited paths remain relative to the file that supplied them.

Republish content after changing the homepage, menu, or fallback date. Quick
preview refreshes automatically; rerun full preview after changing vault content.

### Cloudflare settings

[wrangler.json](../wrangler.json) is the shared Cloudflare configuration.
These settings are already supplied for the live site:

| Setting | Current value | What it means |
| --- | --- | --- |
| `name` | `taelgarverse` | The website program's name in Cloudflare. |
| `main` | `src/worker.mjs` | The code file Cloudflare starts when running the website. |
| `r2_buckets` | `taelgarverse-content`, named `CONTENT` in the code | The storage location for published notes and media. |
| `d1_databases` | `taelgarverse-search`, named `SEARCH_DB` | Revision-matched full-text search storage; indexed during publication. |
| `assets` | `public/`, named `ASSETS` in the code | The styles, scripts, and icons uploaded with website code. |
| `workers_dev` | `true` | Makes the site available at its Cloudflare `workers.dev` address. |
| `preview_urls` | `false` | Turns off Cloudflare's separate version and preview addresses. |
| `compatibility_date` | `2026-10-01` | Selects the Cloudflare behavior the code expects. It is not a content publication date. |
| `observability.enabled` | `true` | Enables Cloudflare logging. |

The `$schema` line helps editors check the file. No custom domain is declared here.
Cloudflare's [configuration reference](https://developers.cloudflare.com/workers/wrangler/configuration/)
explains the provider settings in more detail.

For a normal publication, leave these settings as they are. If you want this
computer to remember which account to use, you can create `wrangler.local.json`
in `taelgarverse-core` with just:

```json
{"account_id": "paste-the-account-id-here"}
```

This is an alternative to setting `CLOUDFLARE_ACCOUNT_ID` in the terminal.
It identifies the account; you still need to sign in or provide an API token.

The project's Cloudflare scripts read this local file automatically. It is
excluded from Git, and any values in it replace the corresponding shared settings.
It can contain only these supported settings:

| Local setting | When to use it |
| --- | --- |
| `account_id` | Select the Cloudflare account used by this computer. |
| `name` | Deliberately deploy website code to a different Worker. |
| `r2_buckets` | Deliberately publish to different storage. Supply the complete bucket list and keep the code's connection name `CONTENT`. |
| `d1_databases` | Override the explicit search database ID. Keep binding `SEARCH_DB` and database name `taelgarverse-search`; the pilot database is not a production destination. |
| `limits` | Set Worker processing limits, such as `cpu_ms` for CPU time. No extra limit is set by this repository. |

If you have an old local file, check it before publishing: it may send an update
somewhere other than the shared defaults. A direct `npx wrangler ...` command
does not read this extra file; the project's npm scripts provide that behavior.

### Settings kept in the terminal

These names can also be set for the current terminal session. They are not
fields in either JSON file.

| Name | Purpose |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Selects the Cloudflare account. |
| `CLOUDFLARE_API_TOKEN` | Supplies a token instead of the browser login; see [token setup](#optional-use-an-api-token-instead-of-signing-in). |
| `TAELGARVERSE_CONFIG` | Chooses an alternative to `config.local.json`. Shared settings from `config.json` still apply unless changed in the selected file. |
| `OBSIDIAN_COMMAND` | Sets the Obsidian command-line program's path. `--obsidian-command` takes priority. |
| `HOST` / `PORT` | Changes the address or port for `npm start` and `npm run dev`. Defaults: `127.0.0.1` and `8765`. |
| `REPEATS` | Sets how many times `node scripts/benchmark.mjs` measures each sample page. Default: `10`. |

## If something goes wrong

| Message or problem | What to do |
| --- | --- |
| Login expired or permission denied | Run `npx wrangler login` again and check that you chose the right account. |
| “Taelgar has uncommitted changes” | Commit the notes you want to publish. New files that Git has not saved yet also count. |
| Materializer plugin needs updating | Update the plugin, restart Obsidian, and try again. |
| Dataview query failed | Read the reported note/query. Fix it, or use `--no-strict` if you accept that part being unavailable online. |
| Export, image processing, or upload failed | Read the error, fix the cause, and rerun the command. These failures leave the previous content online. |
| A publish lock exists | Check that no publishing command is still running. If a previous run was killed, remove only `.cache/publish/publish.lock` and retry. |
| The wrong content is online | Fix the local vault, commit it, and publish again. For restoring an older version, see [recovery instructions](cloudflare.md#restore-older-content). |

Run only one publisher at a time, even if you use more than one computer. Failed
runs keep their temporary files and print the location so you can inspect them.

## Optional: use an API token instead of signing in

Most people can use the browser login above. A token is useful if you want a
script to publish without that login. Treat it like a password.

In Cloudflare, create an API token with **Account → Workers R2 Storage → Edit**
permission for the account that owns TaelgarVerse. Use a token that works with
Cloudflare's API; the R2 “Object Read & Write” option is for S3 tools and does not
work with this publisher. See [Cloudflare's token guide](https://developers.cloudflare.com/r2/api/tokens/).

In **PowerShell 7**, run:

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = 'paste-the-account-id-here'
$env:CLOUDFLARE_API_TOKEN = Read-Host 'Paste your Cloudflare API token' -MaskInput
npm run publish -- --no-strict
Remove-Item Env:CLOUDFLARE_API_TOKEN
```

The prompt hides the token as you paste it. The last command removes it from
this terminal session. Keep the token out of Git and project files.

For how vault files appear on the site, read [Vault usage](vault.md). For changes
to the scripts that generate note headers, follow the
[code update instructions](architecture.md#change-and-release-rules).

## Command reference

The public npm commands are `dev`, `test`, and `publish`; `npm start` is an
alias for `dev`. Plugin releases run in GitHub. Preparation and storage scripts
remain internal tools, rather than separate everyday npm commands.

For maintenance or recovery only:

| Internal command | Effect |
| --- | --- |
| `node scripts/cloudflare.mjs check` | Builds/checks the website package without deployment. CI runs it. |
| `node scripts/cloudflare.mjs deploy` | Deploys website code; GitHub runs this after tests. Direct local use bypasses the CI gate. |
| `node scripts/build-worker-headers.mjs` | Regenerates the committed Worker header module after vault CustomJS changes. Review before committing. |
| `node scripts/maintain-content.mjs rollback --remote` | Restores the previous verified live content snapshot. |
| `node scripts/maintain-content.mjs prune --remote --dry-run` | Reports old content/media/search cleanup candidates. Omit `--dry-run` to remove them. |

The full content publisher owns export, optimization, upload, search staging,
activation, and retention. Lower-level prepare/upload/activation scripts remain
available for diagnostics; ordinary publishing does not need them. See
[search publication](search.md) for indexing and recovery details.

### Enable full-text search in the app

Deploy the updated core through the normal code release, and run a successful
`npm run publish` to populate the matching production D1 revision. No separate
search upload is needed with the full publisher. The app uses `SEARCH_DB` for
`/?q=...` and `/api/search`; missing/older indexes show a page-name fallback notice.
Both release orders work. Verify a body-only phrase and the desired campaign/date/
Behind the Curtain context after publication. Core deployment alone does not
populate D1 or invoke AI Search.

Local Node previews use an in-memory SQLite index, initialized on first search.
They need `node:sqlite` support and do not contact Cloudflare; restart after source
changes to rebuild the local store/index. See [search](search.md#app-search).

## Isolated search experiment

`node experiments/ai-search/cli.mjs help` describes the separate search pilot. Its
[operating guide](../experiments/ai-search/README.md) covers local preparation,
authentication, explicit small uploads, comparisons, and cleanup. These commands
do not publish vault content or deploy the website; they target only
the D1 database and AI Search instance each named `taelgarverse-search-pilot`
when using Cloudflare. `baseline-upload` syncs D1 independently; AI `upload` is
optional. `serve --no-ai` enforces baseline-only operation, and the ordinary
viewer has a per-search AI toggle. Disabling queries does not remove the AI
index or stop separately invoked uploads. Production search integration remains
outside the experiment.
