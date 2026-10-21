# Pronunciation prototype

For the saved experiment and conversation decisions, read [resumption notes](HANDOFF.md).

The unified Taelgarverse plugin contains an opt-in Pronunciation feature that generates saved audio from a note's IPA. The standalone demo uses that same feature. The website and
Obsidian discover the same file by note path. Nothing calls a speech service when
rendering a header or playing saved audio. This prototype has not been deployed.

## Try without credentials

Run from the pronunciation worktree:

~~~powershell
npm run demo:pronunciation
~~~

Open **.cache/pronunciation-demo-vault** as a separate Obsidian vault. Enable
community plugins if Obsidian requests it. The local Taelgar Pronunciation
Prototype plugin is included. Open **People/Zahara** in Reading view and click
**Generate pronunciation**. It saves a valid two-note WAV test tone, labels it
explicitly, and inserts a native audio embed after the leading H1. **People/Taquin**
already has a saved mock clip for checking playback. These names and IPA are demo
data; no real vault notes or settings are changed. Re-running the demo command
refuses to overwrite your experiments.

The ribbon, note toolbar, and command palette expose Generate in editing modes
too. **Preview** uses Azure with the same voice and text/IPA settings as Generate when
a key is configured, playing temporary audio without saving or linking it. Azure
usage charges apply. Without a key, an explicitly matched device voice speaks the written guide approximately using
the selected locale on the current device and never saves audio. Browser speech
availability in Obsidian depends on the platform and installed voices.

To view the same saved file on the local website:

~~~powershell
$env:TAELGARVERSE_CONFIG = (Resolve-Path .cache/pronunciation-demo.config.json).Path
$env:PORT = '8766'
node scripts/build-browser.mjs
node src/server.mjs
~~~

Open http://127.0.0.1:8766/page/people/taquin for the saved mock clip, or
http://127.0.0.1:8766/page/people/zahara after generating it in Obsidian. Restart
the Node preview after changes to notes or audio; it reads a startup snapshot.
Use a fresh terminal for other work, or remove the two environment variables.

## Use with an existing vault

Build, install and try to reload the unified Taelgarverse plugin locally:

~~~powershell
npm run dev -- --plugin --vault D:/personal/taelgar
~~~

This replaces only its runtime files, preserves data.json and notes, and
performs no remote write. Enable **Settings → Taelgarverse → Pronunciation →
Enable pronunciation tools**. Restart Obsidian or toggle Taelgarverse off/on if
automatic reload is unavailable. The feature is off by default and stores
settings under pronunciation, alongside existing Maps and Images settings.

For a separate disposable demo, **npm run build:pronunciation** still creates
**.cache/pronunciation-plugin/taelgar-pronunciation**, which can be installed in
a test vault. Avoid enabling both standalone and unified pronunciation controls
in the same vault. Their generation and linking logic is shared.

Keep the existing readable guide and optionally add:

~~~yaml
pronunciation: zah-HAH-rah
pronunciationIPA: "zɑˈhɑːrɑ"
# Optional voice overrides:
pronunciationLocale: en-US
pronunciationVoice: en-US-JennyNeural
~~~

Audio identity follows the note's full relative filename, not its displayed name:

~~~text
People/Zimkovans/Zahara.md
assets/pronunciation/People/Zimkovans/Zahara.wav       # real generated speech
assets/pronunciation/People/Zimkovans/Zahara.mock.wav  # no-key test tone
~~~

Real WAV, then real MP3, then mock WAV are checked in that order. Exact paths
prevent same-name notes in different folders from sharing the wrong clip. Missing
clips do not produce website playback controls. Audio needs no frontmatter link.
Changing a note's filename or folder requires relinking/regenerating its clip;
changing the displayed name leaves its path unchanged.

The plugin inserts only an owned block after a leading Markdown H1. Ordinary
native embeds work without the plugin, including in Live Preview. A debounced
listener restores a missing link when a note with matching audio is opened or
modified, including after the existing CustomJS header regeneration command.
Disable **Restore links after header regeneration** to opt out; **Refresh saved
pronunciation link** remains available. No bulk scan or header rewrite runs on
enable. Notes without a leading H1 can generate audio, but need a title/header
before a native link can be inserted. The inline Generate toolbar is a Reading
view enhancement; ribbon, note action and palette commands work in editing modes.

Website rendering resolves the saved asset independently after dynamic header
generation, so it does not depend on the persisted Obsidian header block. The
owned embed is removed before article rendering to prevent duplicate players.
Saved native embeds elsewhere remain ordinary audio embeds.

## Enable Azure later

1. Create an Azure Speech resource and choose a region and voice supporting the
   intended language analog. IPA is optional; written guides take precedence.
2. On Obsidian **1.11.4+**, select/create a secret through the plugin settings'
   **Azure Speech API key** control. Only its identifier is saved in plugin data;
   the key goes through Obsidian SecretStorage, not frontmatter, scripts or website
   configuration. Older Obsidian versions can use the no-key prototype.
3. Set the resource region and default voice/locale in plugin settings.
4. Click **Regenerate pronunciation**. The adapter sends the written guide using SSML substitution (or IPA when no
   written guide is present) and
   requests 24 kHz mono PCM WAV. Failed requests or invalid responses leave the
   previous audio intact and do not fall back silently to a mock clip.

The secret must be configured on each device as appropriate for Obsidian's secret
storage. Azure mode requires network access only when generating. Saved files
play offline wherever the vault's attachments are synced. A new Azure WAV takes
precedence over an older mock clip; the prototype keeps that mock file for review.

There is no automatic synthesis, bulk generation, stale-IPA detection, generation
history, or review-before-save flow yet. Regeneration replaces the corresponding
WAV after a successful response; duplicate clicks for one note are blocked. A
response is discarded if its note path, name, written guide, IPA, language, locale or voice changed during
the request. Human listening is still needed to judge voice/phoneme quality.

The website's existing content publisher already includes WAV/MP3. Publishing
these assets and deploying the core changes would be separate future actions.
Neither is done by the prototype commands.

## Validation

~~~powershell
node --test tests/pronunciation.test.mjs
npm test
node scripts/cloudflare.mjs check
~~~

The focused tests use the bundled unified feature with an in-memory Obsidian API and a mocked
Azure response. They cover actual save/link logic, regeneration, request failure,
concurrent clicks and note edits, exact asset selection, header integration and
playback fallback. Desktop/mobile Obsidian UI and real Azure synthesis still need
manual checking; credentials are not required by automated tests.

References: [Azure pronunciation](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-synthesis-markup-pronunciation),
[Azure REST audio output](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech),
[Obsidian SecretStorage](https://docs.obsidian.md/plugins/guides/secret-storage).

## Names metadata and Live Preview

With Pronunciation enabled, open a note in **Live Preview** and find its
`%%^Metadata:names:v1%%` block. Each valid YAML/JSON name row gets **Generate
audio**, **Preview**, and a language-analog selector. Existing clips also get a
play button. The controls are editor decorations; they do not rewrite the name
rows and do not appear in ordinary Source mode. No frontmatter or IPA is required:

~~~yaml
%%^Metadata:names:v1%%
- {name: Alain LeBouillon, language: Sembaran, pronunciation: ah-LAN luh-boo-YON, status: documented}
%%^End%%
~~~

The plugin reads **Background/Languages.md**, configurable as **Languages reference
note**. It matches the row's `language` to the note's language heading and its
real-world analog/mapping. For example, Sembaran offers French and English;
Isinguese offers Spanish and French. Multiple documented options are selectable.
The first listed supported analog is the initial choice; the plugin does not
infer north/south dialects from geography. Unknown, undefined, speculative,
family-only, and unsupported mappings use a labeled default voice. Qualified
suggestions can be selected explicitly. Fictional/Tolkien/ancient languages are
not treated as natively supported Azure languages. Choices are remembered for
that entry during the current plugin session, not written into canon.

Azure receives a real locale and a region-available standard neural voice. Its
voice list is queried only when Generate or Azure Preview is clicked; opening notes does not
contact Azure. The full language note and biography are never sent. The written
pronunciation is an SSML substitution, not an instruction interpreted by an LLM:
accuracy and stress still need listening and adjustment. Optional IPA remains a
fallback when no written guide is present. Explicit `pronunciationLocale` and
`pronunciationVoice` on the row or note override automatic mapping.

The primary name retains the existing note-based audio path and header link.
Aliases and components save separate `.name-<id>.wav`/`.name-<id>.mock.wav` clips
and play from their own row; they cannot overwrite the primary clip. Their paths
stay stable when the written guide is edited. Live Preview generation reads the
current editor buffer, preserves unsaved prose, and inserts only the primary
header's owned embed through an editor transaction. A changed name entry or guide
during synthesis causes that response to be discarded.

A names row that supplies either `pronunciation` or `pronunciationIPA` overrides
both frontmatter pronunciation fields for that name. Within the row, a written
`pronunciation` guide takes precedence over IPA. The primary name inherits the
frontmatter guide/IPA only when its row supplies neither.

### Voice and input choices

Beside each names row, choose **Female** or **Male** to select a matching Azure
neural voice for the language. **Default voice** uses the plugin default. A
specific `pronunciationVoice` override takes priority and disables this selector.
The Azure voice list must contain a standard neural voice with the requested
gender for that locale; otherwise the action reports that no matching voice is
available and preserves the saved clip. Device speech does not expose gender,
so male/female previews require Azure.

Choose **Name only** to ignore written pronunciation and IPA while retaining the
selected language and voice. **Pronunciation / IPA** uses the normal guide/IPA
precedence. **Default input** follows the plugin default. Both selectors are
remembered per note/name in plugin settings across restarts; they do not rewrite
metadata or infer anything from character gender. Preview and Generate share
the same choices. Existing saved clips require Regenerate to change.
