# Running tests

Run from the core repository after `npm ci`:

```powershell
npm test
npm test -- --integration
```

The default suite and local R2/D1 emulator suite use checked-in fixtures and
disposable directories. Neither needs a sibling vault, Obsidian, personal
`config.local.json`, or a `TAELGARVERSE_CONFIG` override. CI checks out only core.
Tests build browser assets but never regenerate legacy code from a working
vault. Existing installed dependencies are used for builds.

`helpers/test-settings.mjs` resolves `fixtures/test-config.json` explicitly and
ignores personal configuration. Tests may replace its content path with their
own temporary notes. The configuration-loader tests use separate temporary
configuration roots. Do not call bare `loadSettings()` from a default test.

## Historical header comparisons

```powershell
npm test -- --historical-headers
```

This optional run compares the former header generator with captured Markdown
for tagged notes, historical kingdoms and synthetic examples in both layouts.
It also checks the [frozen legacy sources](fixtures/legacy-vault/README.md)
against the captures and reproduces their documented defects. The VM and
generated comparison implementations live in [test support](helpers/legacy-headers/).
The ordinary run exercises current callouts, publication conversion and
Obsidian editing. It also uses the generated reference for date-boundary and
index comparisons.

## Optional live-vault checks

```powershell
npm test -- --live-vault
```

Only this mode selects `*.live-vault.mjs`. It uses the normal configured vault
(including `config.local.json` or `TAELGARVERSE_CONFIG`) to check current tagged
notes and representative headers against the frozen reference. It also checks
the installed pinned Dataview bundle when available; that check is skipped when
there is no installation. These checks read the vault without changing it and
can fail when live content has drifted from captured samples. The deleted
CustomJS methods do not need to be restored: the legacy algorithm stays frozen
even in this mode.

Select one optional mode per run. Deployment CI runs the default and local
emulator suites.

## Common map tools

The shared CI workflow tests the map package on Windows and Ubuntu. To reproduce
the package check locally, run `node --test tests/map-package.test.mjs` with
`tar` on the path. The test extracts the archive and bundles its viewer as a consumer.

Pull requests, main builds and Obsidian release builds also run both synthetic
Photoshop exporter suites. To reproduce them in a Python 3.11 environment, run

```sh
python -m pip install -r scripts/map-export/requirements.txt
python tests/map-export.test.py
python tests/map-export-links.test.py
```

`npm run test:ui:maps` runs real Chromium against test-owned map figures. It checks
local drawing, point outlines, selection/deletion, measurements, independent maps,
and omission of the shared-only Ping tool from ordinary note maps,
light/dark/system appearance contrast including hover, and a phone viewport; screenshots go to ignored `outputs/`. Set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when Chromium is not at `/usr/bin/chromium`.
`tests/map-sketch.test.mjs` verifies DOM-free selection and swept erasing. Package
checks import both geometry entries without browser globals and verify declarations.
The character manager separately tests the packed controls with real room state,
concurrent browsers, live roles, source changes, erasing and phone touch.
