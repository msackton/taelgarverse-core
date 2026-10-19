# Update the website

The site is [taelgarverse.msackton.workers.dev](https://taelgarverse.msackton.workers.dev/).

- **Notes, images, audio, homepage, and menu in `taelgar`:** run the publishing command below.
  Saving them to GitHub alone does not update the website.
- **Website code in `taelgarverse-core`:** merging changes into `main` on
  GitHub updates the website automatically through Cloudflare.

Start with [publishing](#publish-your-latest-notes) for a normal update.
The references below explain [publishing options](#publishing-options),
[configuration settings](#configuration-settings), and
[the other npm commands](#command-reference).

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
   npm run content:publish -- --no-strict
   ```

4. Leave Obsidian open and avoid editing the vault until the command finishes.
   Then open the website and check the pages you changed, including their images
   and any relevant campaign/date views.

The command prepares copies of your notes, makes large images smaller, and
uploads the results. It switches the site to the new content after the upload
succeeds. Your original notes and images stay unchanged. If the same saved
version and publishing settings are already online, it skips the work.

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

In commands such as `npm run content:publish`, `npm run` starts one of the
project's named scripts. The extra `--` passes any following options to that
script. For example, in `npm run content:publish -- --no-strict`, `--no-strict`
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
storage location (`taelgarverse-content`). You do not need to create either one
or change configuration files for a normal update.

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

By default, published images are reduced to at most **2,560 pixels** on their
longest side. They are not cropped or enlarged. JPEG and WebP use quality **82**;
PNG keeps its transparency. Animation and audio are left unchanged.

If map labels need more detail, publish with larger images:

```sh
npm run content:publish -- --no-strict --max-image-size 4096 --image-quality 85
```

This changes only the website's copies of your images.

## Publishing options

Add these after `npm run content:publish --`. You can combine them unless noted.

| Option | What it does |
| --- | --- |
| `--no-strict` | Continues when a Dataview query cannot be converted, and reports the problem. Without this option, query problems stop the export. |
| `--force` | Publishes again even when the saved Git version and settings appear unchanged. |
| `--build-only` | Prepares the notes and images on this computer without contacting Cloudflare storage. Useful for checking an export. |
| `--local` | Publishes into a local copy of Cloudflare storage for previewing. The live site stays unchanged. Use this or `--build-only`, not both. |
| `--allow-dirty` | Allows uncommitted vault changes. Useful for local checks; if used for a live publication, the next publication will rebuild. |
| `--vault "path/to/taelgar"` | Uses this vault instead of `vault_dir` for one publication. Use the root of its Git repository. |
| `--config preview.json` | Uses a different settings file instead of `config.local.json`, keeping shared defaults for anything omitted. See [configuration settings](#configuration-settings). |
| `--max-image-size 4096` | Sets the longest image edge in pixels. Default: `2560`. |
| `--image-quality 85` | Sets JPEG/WebP quality from 1 to 100. Default: `82`. |
| `--obsidian-command "path/to/Obsidian"` | Tells the script where Obsidian's command-line program is if it cannot find it automatically. |
| `--obsidian-vault "Taelgar"` | Selects the vault by its Obsidian name or ID when needed. |
| `--help` | Prints the available options and exits. |

For example, check uncommitted edits without changing the live website:

```sh
npm run content:publish -- --build-only --allow-dirty --no-strict
```

To preview an exported publication in a local Cloudflare Worker:

```sh
npm run content:publish -- --local --allow-dirty --no-strict
npm run cf:dev
```

Keep the second command running and open [the local preview](http://127.0.0.1:8787).
Press Ctrl+C to stop it.

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
| `source_dir` (optional) | Uses `vault_dir` | Reads notes and media from a different folder for local previews and `cf:prepare`. Only needed to preview an already exported copy. |
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
`npm run content:publish -- --config preview.json --no-strict`, or set
`$env:TAELGARVERSE_CONFIG = 'preview.json'` for commands in a PowerShell terminal.
The selected file replaces `config.local.json` for that run; omitted settings
still come from `config.json`. An explicit `--config` takes priority over the
terminal setting. Inherited paths remain relative to the file that supplied them.

Republish content after changing the homepage, menu, or fallback date. Restart a
local preview after changing its settings or vault files.

### Cloudflare settings

[wrangler.json](../wrangler.json) is the shared Cloudflare configuration.
These settings are already supplied for the live site:

| Setting | Current value | What it means |
| --- | --- | --- |
| `name` | `taelgarverse` | The website program's name in Cloudflare. |
| `main` | `src/worker.mjs` | The code file Cloudflare starts when running the website. |
| `r2_buckets` | `taelgarverse-content`, named `CONTENT` in the code | The storage location for published notes and media. |
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
| `REPEATS` | Sets how many times `npm run benchmark` measures each sample page. Default: `10`. |

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
npm run content:publish -- --no-strict
Remove-Item Env:CLOUDFLARE_API_TOKEN
```

The prompt hides the token as you paste it. The last command removes it from
this terminal session. Keep the token out of Git and project files.

For how vault files appear on the site, read [Vault usage](vault.md). For changes
to the scripts that generate note headers, follow the
[code update instructions](architecture.md#change-and-release-rules).

## Command reference

Run these from `taelgarverse-core`. The `cf:` prefix means the command works
with the Cloudflare version of the website. It does not always mean the command
changes the live site.

### Everyday commands and local checks

| Command | What it does | Changes the live site? |
| --- | --- | --- |
| `npm ci` | Installs the project's required packages. | No |
| `npm run content:publish` | Exports through Obsidian, prepares images, uploads content, and switches the site to it. | **Yes**, unless you use `--local` or `--build-only` |
| `npm start` | Starts a local website at `http://127.0.0.1:8765`, reading the configured content folder directly. It does not export Dataview queries through Obsidian. | No |
| `npm run dev` | Starts the same local website and restarts it when code changes. Restart it yourself after vault or settings changes. | No |
| `npm run cf:check` | Builds the browser files and checks that the Worker can be packaged for deployment. It does not check every page. | No |
| `npm run cf:dev` | Starts a local Cloudflare Worker at `http://127.0.0.1:8787`. Prepare local content first, as shown above. | No |
| `npm run cf:smoke` | Checks sample pages on the local Worker against the local renderer. It needs matching content and settings. An optional URL after `--` selects another running Worker. | No; reads the selected site |
| `npm test` | Runs the automated tests, first rebuilding local header code and browser files. Requires the configured vault. | No |
| `npm run benchmark` | Measures how quickly the local renderer creates a selection of pages. | No |

### Commands for maintaining website code

| Command | What it does | Changes the live site? |
| --- | --- | --- |
| `npm run build:browser` | Prepares Mermaid diagram support in `public/generated/`. Runs automatically for local previews, tests, and `cf:check` / `cf:dev` / `cf:deploy`. | No |
| `npm run build:runtime` | Rebuilds local header code from the vault's CustomJS and updates generated icons. It does not update the Worker's header code. | No |
| `npm run build:worker-headers` | Updates `src/worker-headers.mjs` from those same vault scripts. Review and commit the result so the next core deployment includes it. | No, until the code is deployed |
| `npm run cf:deploy` | Builds the browser files and deploys the Worker and website files directly from this checkout. Normally GitHub's automatic deployment handles this. | **Yes: website code**, not vault content |

The `prestart`, `predev`, and `pretest` scripts in `package.json` are automatic
preparation steps for `start`, `dev`, and `test`; you do not need to run them
separately.

### Separate preparation and upload steps

These are lower-level maintenance commands. The full `content:publish` command
already handles normal publication.

| Command | What it does | Changes the live site? |
| --- | --- | --- |
| `npm run cf:prepare` | Packages the configured content folder, plus the vault's homepage and menu, into `.cache/cloudflare/`. It does **not** export Obsidian queries or resize images. | No |
| `npm run cf:seed` | Loads the prepared content into local Cloudflare storage and selects it for the local Worker. Run after preparation. | No |
| `npm run cf:upload` | Uploads prepared content to the configured R2 bucket, leaving the site's selected publication unchanged. | Writes live storage; readers still see the previous content |
| `npm run cf:publish` | Selects the uploaded content for readers. Requires a successful `cf:upload` for the same content and destination. | **Yes: vault content** |
| `npm run cf:bucket` | Creates the bucket named by the prepared configuration. The existing site already has one. | Creates Cloudflare storage; does not publish content |

Prepare again after changing settings before using these separate commands.
The manual `cf:publish` command records only the revision ID, so the next full
`content:publish` run rebuilds instead of skipping unchanged content.
