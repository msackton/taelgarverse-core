# Pronunciation prototype

A local Obsidian plugin generates saved audio from a note's IPA. The website and
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
too. **Browser speech preview** speaks the name's spelling approximately using
the current device, does not apply IPA, and never saves audio. Browser speech
availability in Obsidian depends on the platform and installed voices.

To view the same saved file on the local website:

~~~powershell
$env:TAELGARVERSE_CONFIG = (Resolve-Path .cache/pronunciation-demo.config.json).Path
$env:PORT = '8766'
npm start
~~~

Open http://127.0.0.1:8766/page/people/taquin for the saved mock clip, or
http://127.0.0.1:8766/page/people/zahara after generating it in Obsidian. Restart
the Node preview after changes to notes or audio; it reads a startup snapshot.
Use a fresh terminal for other work, or remove the two environment variables.

## Use with an existing vault

Build with **npm run build:pronunciation**. Copy the resulting
**.cache/pronunciation-plugin/taelgar-pronunciation** folder into the target
vault's **.obsidian/plugins/** folder, then enable the plugin. The prototype
never installs itself into your real vault. The build output is ignored; source
lives beside this README and in the shared helpers.

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
   required IPA phonemes. IPA input is mandatory in Azure mode.
2. On Obsidian **1.11.4+**, select/create a secret through the plugin settings'
   **Azure Speech API key** control. Only its identifier is saved in plugin data;
   the key goes through Obsidian SecretStorage, not frontmatter, scripts or website
   configuration. Older Obsidian versions can use the no-key prototype.
3. Set the resource region and default voice/locale in plugin settings.
4. Click **Regenerate pronunciation**. The adapter sends SSML phonemes and
   requests 24 kHz mono PCM WAV. Failed requests or invalid responses leave the
   previous audio intact and do not fall back silently to a mock clip.

The secret must be configured on each device as appropriate for Obsidian's secret
storage. Azure mode requires network access only when generating. Saved files
play offline wherever the vault's attachments are synced. A new Azure WAV takes
precedence over an older mock clip; the prototype keeps that mock file for review.

There is no automatic synthesis, bulk generation, stale-IPA detection, generation
history, or review-before-save flow yet. Regeneration replaces the corresponding
WAV after a successful response; duplicate clicks for one note are blocked. A
response is discarded if its note path, name, IPA, locale or voice changed during
the request. Human listening is still needed to judge voice/phoneme quality.

The website's existing content publisher already includes WAV/MP3. Publishing
these assets and deploying the core changes would be separate future actions.
Neither is done by the prototype commands.

## Validation

~~~powershell
node --test tests/pronunciation.test.mjs
npm test
npm run cf:check
~~~

The focused tests use a bundled plugin with an in-memory Obsidian API and a mocked
Azure response. They cover actual save/link logic, regeneration, request failure,
concurrent clicks and note edits, exact asset selection, header integration and
playback fallback. Desktop/mobile Obsidian UI and real Azure synthesis still need
manual checking; credentials are not required by automated tests.

References: [Azure pronunciation](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-synthesis-markup-pronunciation),
[Azure REST audio output](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech),
[Obsidian SecretStorage](https://docs.obsidian.md/plugins/guides/secret-storage).
