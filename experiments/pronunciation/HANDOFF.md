# Pronunciation prototype: saved experiment and resumption notes

Checkpoint: 2026-10-20. Branch: `codex/pronunciation-prototype`.

This is a working experiment preserved for later evaluation. The owner is unsure
whether to pursue it. Keep the PR in draft; do not merge, deploy, publish vault
content, or release the plugin without a new request. A remote branch and draft
PR were explicitly requested so the implementation and conversation decisions
would survive beyond the local worktree.

## What problem this explores

Click a name to hear its pronunciation on the website and in Obsidian. Generate
speech once, save an ordinary audio file in the vault, and reuse it without a
cloud dependency for playback. Author names and pronunciation hints alongside
other names metadata, with a button in Obsidian Live Preview.

The useful part to preserve is the shared generate/preview/save pipeline and its
connection to native vault assets. Whether the extra authoring controls and
Azure voice/IPA quality justify keeping it is still an open product decision.

## Conversation recap and agreed behavior

This is a curated recap of the conversation, not a verbatim chat/tool transcript.

1. The initial request was click-to-speak names on pages, also working in
   Obsidian. Browser speech from IPA was considered; it is only an approximate
   fallback and does not interpret IPA.
2. The preferred experiment became an Obsidian Generate button calling Azure
   (or a similar provider), saving under `assets/pronunciation`, and linking a
   saved clip when generating the header. Only Azure and a no-key stub were
   implemented; there is no provider-selection framework.
3. The owner requested a new worktree and initially prohibited remote pushes.
   The original prototype was committed locally, then local main was merged
   into that worktree at the owner's request. Main itself was not changed by
   this experiment. The current request explicitly authorizes the branch push
   and draft PR, but no merge to main.
4. The standalone demo was integrated into the unified Taelgarverse plugin,
   rebuilt, and installed into the real local Taelgar vault for testing.
   Pronunciation is opt-in. The plugin's development manifest remains 0.2.0;
   no BRAT/plugin release has been prepared or published.
5. Generate/Preview controls were requested inside `%%^Metadata:names:v1%%`
   in Live Preview. They are CodeMirror decorations: valid single-line YAML or
   JSON name mappings remain editable. Ordinary Source mode has no widgets.
6. The owner preferred written pronunciation rather than mandatory IPA.
   Written guides use SSML substitution; IPA is optional and uses phoneme
   markup. With both fields at the same source level, the guide wins.
7. Language should come from the name's documented language and its real-world
   analogs in `Background/Languages.md`. The first supported documented analog
   is the default, and alternatives are selectable. Do not infer dialect from
   geography or turn a speculative/ancient/fantasy language into an asserted
   modern equivalent. Unknown/unsupported mappings visibly use the fallback.
8. A reported voice mismatch exposed that Preview always used device speech.
   It now uses exactly the Generate Azure synthesis settings when a key exists,
   plays a temporary WAV, and never saves/links it. Device fallback explicitly
   selects a matching language voice; absent matches are reported. Normal
   Azure usage charges apply to Preview as well as Generate.
9. A Cassia row with IPA was ignored because a primary frontmatter written
   guide was inherited and won. Fixed: a row providing either pronunciation
   field overrides the frontmatter pair. Inherit the pair only if the primary
   row supplies neither; aliases never inherit the primary's guide or IPA.
10. The owner requested Female/Male voice selection. The row selector filters
    actual Azure voice Gender metadata for the locale; it does not infer the
    character's gender. A specific pronunciationVoice override takes priority
    and disables the gender selector. Default preferences are in plugin settings.
11. The owner also requested an option to ignore pronunciation. Name only
    removes both guide and IPA from synthesis input while retaining the name,
    selected language and voice. Pronunciation / IPA restores normal precedence.
12. Gender and input-mode choices are saved per note/name in plugin settings,
    survive reloads, and apply to both Preview and Generate. Language-analog
    choices currently last only for the plugin session. No choice rewrites
    source metadata. Changing choices does not alter saved audio until Generate.

Example pronunciation discussion: Latin-like Cassia can use IPA
`ˈkas.si.a`, or the contracted Italian-like `ˈkas.sja`. A user-supplied
`ˈksas.sja` contained an additional s after k; the plugin now forwards the
provided row IPA rather than silently substituting frontmatter. It does not
validate that an authored IPA describes the intended name.

## Implementation map

- `src/pronunciation-data.mjs`: safe paths, owned header embed, SSML/XML escaping,
  WAV stub/validation. Shared with the website and Obsidian.
- `src/pronunciation.mjs`, `public/pronunciation.js`, `public/pronunciation.css`:
  website playback from an exactly matching indexed asset; no synthesis.
- `src/render-engine.mjs`, `src/http-assets.mjs`: header/asset integration and
  conditional browser assets. No snapshot schema change.
- `obsidian/taelgarverse/features/pronunciation.mjs`: settings, commands,
  generation/preview, local playback, link restoration, saved per-name choices,
  stale-response handling, timers/player cleanup.
- `obsidian/taelgarverse/pronunciation-names.mjs`: names blocks, language
  profiles, primary/alias paths, precedence, voice gender and input mode.
- `obsidian/taelgarverse/pronunciation-editor.mjs`: inline Live Preview controls.
- `obsidian/taelgarverse/pronunciation-synthesis.mjs`: Azure voice lookup and
  WAV synthesis. Standard neural voices are selected, excluding HD/multilingual.
- `experiments/pronunciation/obsidian/`: standalone wrapper of the same feature;
  `scripts/demo-pronunciation.mjs` creates an isolated demo vault.
- `tests/pronunciation.test.mjs`, `tests/pronunciation-names.test.mjs`,
  `tests/obsidian-pronunciation.test.mjs`: pipeline and host-boundary regressions.
  `tests/obsidian-maps.test.mjs` also checks the unified plugin remains compatible.

See [the prototype guide](README.md) and
[the plugin guide](../../obsidian/taelgarverse/README.md) for setup details.

## Data and credential behavior

Primary clips: `assets/pronunciation/<full note path without .md>.wav`.
Aliases/components add a stable `.name-<hash>` suffix. WAV precedes MP3, then
`.mock.wav`. No key saves a labeled two-note test tone, not simulated speech.
Azure failure preserves existing audio; it never silently becomes mock success.

Primary generation inserts a small owned native embed after a leading H1.
Open/modify listeners restore it after header regeneration. Body examples and
fences are preserved; aliases cannot overwrite the primary clip/header.
Live Preview uses the current unsaved editor buffer and a minimal transaction.

Azure credentials remain in Obsidian SecretStorage (1.11.4+ for this integration).
Only a secret identifier is stored in plugin settings. No keys, note corpus,
settings files, generated real clips, or runtime backups belong in this branch.
Azure receives the selected name, guide/IPA, locale and voice; not the biography
or Languages note. Opening a note never synthesizes or contacts Azure.

## Validation and practical limits

The final focused suite has 44 passing tests, covering unchanged Maps/Images,
installation boundaries, saved settings, matching Preview/Generate requests,
row IPA precedence, gender filtering, Name only, stale responses and cleanup.
The full suite passed all 386 tests. The Worker package check passed as a local
dry-run, with the existing generated worker-headers nullish-coalescing warning.
No production writes were performed. Tests stub Azure and the Obsidian host.

No actual Azure listening test or native Obsidian visual automation was performed
by the agent. The owner has been testing the installed plugin and reported the
voice/precedence issues above. Audio quality, supported phones for each locale,
name-only Italian pronunciation, and UI usability remain manual evaluation work.

Known limitations worth retaining when resuming:

- This is a local experimental build, not a published plugin release. BRAT's
  normal update can replace the development runtime.
- The no-key browser fallback cannot interpret IPA or select Male/Female:
  Web Speech voices do not expose gender. An explicit gender requires Azure.
- Unsupported requested Azure gender/locale combinations fail clearly instead
  of quietly selecting another language or gender. Custom voice overrides are
  authoritative. Automatic routing is a practical documented-analog mapping,
  not a linguistic model or an LLM instruction.
- Guide spelling/hyphenation and IPA still need listening; SSML substitution
  does not reliably encode the intended stress by itself.
- Controls only parse complete marker blocks and standalone single-line mappings
  outside fenced code. Trailing Markdown escapes or wrapped mappings are not
  supported authoring syntax.
- Per-name preferences use note path plus name/language/role. Rename those and
  the old preference is not migrated; it can leave an unused settings entry.
- Existing audio is not fingerprinted against current inputs. Play hears the
  saved clip; Preview hears the current choices. Regenerate updates the clip.
- Disable/unload discards pending results and releases playback resources, but
  it cannot undo an already-issued Azure request or its cost.
- The dev supervisor can claim plugin reload succeeded even when Obsidian's CLI
  is disabled. Toggle Taelgarverse off/on or restart Obsidian after installation.
  Fixing that misleading reload report is separate follow-up work.

## Resume locally

Original worktree:
`C:/Users/msackton/.codex/worktrees/pronunciation-prototype/taelgarverse-core`.
Main checkout: `D:/personal/taelgarverse-core`.
The last development build was installed in
`D:/personal/taelgar/.obsidian/plugins/taelgarverse`.
The installer preserves data.json, enabled plugins and credentials; runtime-only
backups live under the worktree's ignored .cache directory.

On another checkout, install dependencies and configure ignored config.local.json
with the actual vault_dir before full tests or header generation. No local
config, node_modules junction, demo vault, backup or test log is part of Git.

~~~powershell
npm ci
node --test tests/pronunciation.test.mjs tests/pronunciation-names.test.mjs tests/obsidian-pronunciation.test.mjs tests/obsidian-maps.test.mjs
npm test
node scripts/cloudflare.mjs check
node scripts/install-obsidian.mjs --vault D:/personal/taelgar
~~~

The last command installs a local test build only when explicitly appropriate
for the new session. Then reload the plugin, enable Pronunciation, configure the
vault's own Azure secret/region, and use a complete names block. Try Name only
and Pronunciation / IPA with both Female/Male; Preview first, then Generate and
check saved playback after a header rebuild and plugin restart.

Suggested next prompt: "Resume the pronunciation experiment from this branch
and its draft PR. Read this handoff first. Help me evaluate actual Azure voice
quality and the Live Preview controls before deciding whether to keep it."

Preserve the root AGENTS.md permission gates. A branch push is not authorization
to merge main, deploy Cloudflare, publish vault content, commit in the taelgar
vault repository, or publish an Obsidian release.
