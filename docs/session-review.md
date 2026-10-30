# Session review in Obsidian

The experimental **Session review** workspace tab indexes the local vault's
`_sessions/**/*-session.yaml` manifests. It is a manual editor and review queue:
you choose passages and identities, inspect changes, and explicitly save them.
Existing suggestions are optional inputs. Discovery runs locally in JavaScript;
opening the hub does not launch Python. Python supplies deterministic source
validation and guarded writes when you explicitly open or change a review.

## Local setup

Opening and searching the session index requires only the desktop plugin. For
transcript/entity review operations the vault must contain the maintained `process-transcript`,
`prepare-interaction-transcript`, `map-transcript-scenes`, and
`check-session-entities` helpers under `.agents/skills/`. Install Python 3.9+
and the requirements from the entity skill:

```powershell
python -m pip install -r D:\personal\taelgar\.agents\skills\check-session-entities\requirements.txt
```

From core, build/install the local development plugin:

```powershell
npm run dev -- --plugin --vault D:\personal\taelgar
```

This updates the local plugin installation, preserving its settings and vault
notes. Reload Taelgarverse if the installer cannot reload it. Enable
**Settings → Taelgarverse → Enable session review**, then run
**Taelgarverse: Open session review**. The Python executable can be configured
in the same settings. Requests invoke it without a shell, in UTF-8 mode, using
asynchronous `execFile` and JSON stdin/stdout. On Windows the executable and
working-directory paths use forward slashes for the native launch. It resolves
a native Python `.exe` from PATH or the usual Python
installation folders before launching; non-executable Windows aliases are skipped.
An explicit executable setting takes precedence. **Inspect Python setup** shows
the resolved path and host versions without starting a process. This feature
requires desktop Obsidian; it does not run on mobile.

## Session index

The index shows transcript stage/pending questions and entity counts. Its
**Reviewable only** checkbox includes portable transcript reviews and entity
maps; clear it to find finalized transcripts for a new bounded correction.
Select the transcript or entity button for the desired stage. Search by campaign,
session number, or manifest path. Counts are discovery hints: opening a stage
validates current references before allowing decisions. Refresh explicitly after
external edits. The workspace remembers the selected session, stage, and entity.
**Reload selected session** resumes that saved selection explicitly. Opening or
restoring the hub only discovers sessions; it never reopens a Python-backed
review automatically. Unprocessed sessions open their manifest as an ordinary note.

The tab initializes both when opened and when its workspace state is restored;
deferred tabs are loaded before reuse. Startup failures display an explanation
and **Retry opening session review**. If an older build left an empty tab,
reload Taelgarverse and reopen the command. A Python/helper error appears in the
tab beside its refresh controls; copy that message when reporting a failure.

On 2026-10-29, approved live checks isolated the Windows blank-window issue to
native process creation with the original launch paths in Obsidian 1.14.5
(Electron 43.8.3 / Node 24.22.0, x64). Both renderer and experimental main-process
launches failed before Python could respond; the latter exited with Windows
status `0xC0000420`. Copied-runtime scratch tests had passed and did not reproduce
the live failure. Normalizing the executable and working directory to equivalent
forward-slash Windows paths made ordinary asynchronous stdin/stdout work in the
live app. The final implementation uses that normalization without a main-process
bridge, temporary transcript files, or an extra service. The lower-level cause of
the host's path-dependent termination has not been established.

After installing and reloading that build, the actual **Check Python connection**
button succeeded with Python 3.11.7. Opening **Dragonets 1 → Transcript** displayed
two queued questions in the hub's 223-session index. All decision buttons remained
disabled pending a preview, and SHA-256 comparisons confirmed all 20 files in that
session bundle were unchanged. Saving real decisions was outside this check.

Native timeout is 60 seconds, output limit is 16 MiB, and the request also has a
65-second callback watchdog. Early launch errors preserve the OS error even when
stdin was never created. Stdin error listeners are removed on completion. Unit
tests cover Windows drive/UNC normalization, Unicode and quoted JSON, large
responses, controlled helper errors, output limits, and timeouts.

The process-free setup inspection records runtime path/architecture, Node option
names, selected non-secret environment flags, child-process import identity, and
the selected launch backend in `session-review-debug.log`.

The referenced [Python Scripter implementation](https://github.com/nickrallison/obsidian-python-scripter/blob/master/src/managers/scriptManager.ts)
launches an external interpreter with `child_process.exec` through a shell; it does
not embed Python. Its [README](https://github.com/nickrallison/obsidian-python-scripter/blob/master/README.md)
marks it archived and points to Shell Commands. This is a comparison reference,
not a dependency or a confirmed solution to the live renderer crash.
Follow the user's current permissions for local build installation and for
interaction with their running Obsidian session separately.

## Transcript fixes

Portable `*-transcript-review.md` files remain the transcript decision store.
The original work queue is not required. Each question presents its original
full UID, exact replacement target, proposal, alternatives, recommendation,
conversation context, and affected readable turns.

Choose proposed wording, an alternative, a custom replacement, or **Retain
unresolved**. Leave undecided questions pending. **Copy replacement into matching turns**
only replaces a unique literal occurrence of the target in the displayed readable
turn; inspect that suggestion before applying. If punctuation differs, edit the
turn explicitly. The existing validator checks the complete corrected turn,
source coverage, meaningful symbols, and preserved words outside the correction.
Speaker reassignment and turns needing reconstructed `[garbled]`/`[cross-talk]`
substitution spans are not supported by the desktop form.

**Preview transcript decision** validates the proposed changes in memory and
shows exact file diffs without writing. Changing any form field invalidates its
preview. **Apply this transcript decision** applies only that previewed question,
rechecking its inspected fingerprints under the session lock. The existing
session transaction writes cleaned text, readable text, and remaining review
together. Original and prepared references remain unchanged. The inspected review
hash and every retained reference fingerprint are checked under the shared session
lock. A stale or invalid decision fails without recording a partial decision.
Interrupted transactions use the existing transcript recovery procedure.

**Search transcript** finds current wording, speakers, or a UID. Choose a result to
inspect its original, current wording, and conversation context, then supply exact
words occurring once in its cleaned text. **Queue this passage for correction**
creates a bounded question, or adds one to an existing review. Overlap with another
question is rejected; existing decisions and reviewed turn updates are preserved.
Queuing a question does not change transcript wording. This works with portable
reviews and finalized transcripts, without generating any model suggestions.

After resolving all questions, **Preview finishing review** lists the completion
record to update and the temporary review/processing files to retire. **Finish
transcript review** requires that preview's exact current plan and invokes the
existing deterministic finalizer. Retained original/prepared/cleaned/readable
references remain in place. There are no autonomous runs or model calls.

A changed transcript makes
dependent scene/entity fingerprints stale. Their accepted decisions remain stored;
recheck/rebuild maps before resuming entity review. The plugin never rewrites map
fingerprints merely to make them appear current.

## Entity decisions

The inventory has one row per identity, with uncertain/unreviewed decisions first.
Divine entities have their own filter. Selecting an entity loads original polished
UID passages; **Open original source** resolves the UID to the current Obsidian
editor line at display time. Lines are not persisted as provenance. Candidate and
matched pages open as normal vault files. Excluded candidates remain visible.

Accept, correct kind/label/note, retain candidates, defer, include, or exclude an
entity. Explain a decision in the form; inspect changed note targets before
applying. A person may have a clear identity and no page. No canon page is created.
Merge selected identities into the selected stable ID, or split evidence between
two explicit identities while retaining the continuing identity's ID. Invalid
overlapping merge evidence is rejected for explicit reconciliation.

Decisions and history currently live in optional `reviewState` inside the entity
map, atomically with its entities. This is provisional review storage, not a final
processing-log design. Excluded entities remain available there and are omitted by
the read-only v7 projection. Redirects and history flag references needing recheck
after merge/split/exclusion; no final interactions are rewritten or generated.

Ordinary guarded regeneration preserves accepted human identities and review
state. It rejects removal of protected identities and forged new human statuses.
Changed dependent evidence resets the affected entity to unreviewed while retaining
its accepted snapshot for recheck. Source ranges that no longer resolve require
explicit reconciliation. Fingerprints do not discover newly created potential
matches elsewhere in the vault. Validation never supplies semantic review status.

## Ownership and checks

Core owns the Obsidian feature and DOM views in
`obsidian/taelgarverse/features/session-review.mjs`,
native discovery in `obsidian/taelgarverse/features/session-review-index.mjs`,
`src/browser/session-review.mjs`, and `src/browser/transcript-review.mjs`.
The vault owns the scene/entity readers, guarded decision API, portable transcript
review, shared lock, and atomic/transactional writes. The desktop adapter reuses
those helpers instead of implementing source alignment or persistence in JavaScript.
Windows uses a session-specific kernel mutex and no-follow draft file opens;
Unix uses the existing directory flock.

Use core's `node --test tests/session-review-index.test.mjs tests/session-review.test.mjs tests/transcript-review.test.mjs`
and plugin integration tests/build. In the vault, run the three scoped
reduction/scene/entity suites plus `process-transcript`'s `test_desktop.py` and
`test_review.py` with its scripts on `PYTHONPATH`. On Windows, use
`python -X utf8 -B` for transcript tests whose legacy fixtures rely on UTF-8 defaults.
Tests use temporary bundles and do not require saved calibration maps. A passing
structural suite does not establish transcription accuracy or entity identity.
