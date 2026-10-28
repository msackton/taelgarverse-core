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

The [frozen legacy sources](fixtures/legacy-vault/README.md) provide independent
header comparisons. Synthetic notes, frozen tagged-note metadata and captured
expected outputs stay versioned in core. Fixture updates require review.

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

`--live-vault` and `--integration` are separate modes and cannot be combined.
They are not implicit prerequisites of the default suite or deployment CI.
