Taelgarverse 0.9.2

- Bundle the Photoshop exporter, geometry, recipe, and support modules inside the plugin. BRAT updates now carry the exporter; no separate checkout or script download is required.
- Support public Dropbox PSD/PSB shared links, including modern `/scl/fi/` and older `/s/` links. Paste a link to select Dropbox mode automatically. Downloads preserve the shared access key, stream to a local cache, and keep query strings out of output filenames.
- Simplify Dropbox import to shared links only. Remove account paths, file IDs, API tokens, credential-file settings, refresh authentication, and namespace configuration. Links must permit downloads without signing in or entering a password.

Upgrading from 0.9.1: clear **Map exporter: script override (optional)** to use the bundled exporter. Keep your configured Python executable; a local 64-bit Python 3.11 environment with psd-tools, Pillow, numpy, and attrs is still required. Existing private credential files are no longer used and are not deleted. CLI users should replace `--dropbox-path` with `--dropbox-link` (or `--dropbox-link-env`).

The downloader checks Photoshop signatures and declared lengths, records local SHA-256 checksums, and revalidates cached downloads when Dropbox supplies HTTP validators. It does not use the former API revision/content-hash contract. Shared URLs are not saved in map notes or cache indexes.

Automated tests cover shared-link transport and real PSD export, and browser checks use the bundled exporter. A live download of the full user PSB and an actual Obsidian/BRAT installation were not verified in this environment.

Minimum Obsidian version remains 1.8.0; this plugin is desktop-only. See [setup and shared-link instructions](https://github.com/msackton/taelgarverse-core/blob/main/docs/map-editor.md#create-a-map-from-photoshop).
