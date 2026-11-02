# Entity map review in Obsidian

The desktop **Session review** tab now focuses on entity maps. Enable
**Settings → Taelgarverse → Enable session review**, then run
**Taelgarverse: Open session review**. The session list has exactly two actions:
**Show entities map** and **Review entities**. Only mapped sessions are listed;
discovery errors remain visible. Search uses campaign, session number, and YAML path.

A session is **Unreviewed** whenever any included entity is not `humanReviewed`.
High-confidence or `automatedReviewed` entities still require human review. Counts
are local discovery hints; opening a map validates registered source, YAML, note,
map, and feedback fingerprints. Refresh after external changes. Source or note
changes block review until the map is intentionally rechecked; old human status
is never proof that changed evidence was reviewed.

## Table and queue

**Show entities map** displays a row per entity with ID, kind, session importance,
confidence, review status, source names, vault target, and clickable UID source
blocks. Later-identification and Mirror of the Past flags remain visible.
**Read source passages** loads verbatim evidence on demand. Vault links open the
actual local note, and source links open the UID-resolved source editor line.
Both polished transcripts and registered prepared narratives are supported.

Expand **Edit entity / feedback** to change the label, kind, importance, vault
link, or review status. New links are inspected before saving. Leaving a link blank
keeps the entity unlinked. Choosing a target clears unresolved alternatives; clearing
a target also clears the later-identification flag. Changing an item to another
kind clears its item-only Mirror flag. Other fields and source evidence remain intact.
**Save changes**, **Mark human reviewed**, and **Remove entity** save immediately.
Every edit/removal records the old/new record and an optional reason. Removal
retains the old record in history. There is no automatic deletion of session files.

**Review entities** uses the same fields and saves, showing one entity at a time.
The default queue includes every included entity not human reviewed; **All entities**
also allows reopening completed decisions. **Skip for now** and **Previous** navigate
without saving. **Accept and next** explicitly marks the displayed decision human
reviewed; **Save and next** preserves the selected review status. Returning to the
session list refreshes its counts. Empty maps have zero pending included entities.
Original excluded candidates are visible as context below the table; they are not
part of the included-entity review count. Request complex splits, merges, additions,
or exclusion revisions through feedback for the agent.

## Feedback and agent handoff

**Agent feedback** saves an entity comment/question immediately, without an export
step or a model call. **Session feedback and history** accepts missing-entity or
session-level comments and shows saved changes/reasons, including removed entities.
Comments do not change review status. Use the explicit status control to reopen a
record that needs another human review. Feedback is saved in
`cleaned/<stem>-entities-review.json`, beside `*-entity-map.json`; a link appears
after the first save. Merely opening review never creates a file.

The vault's `check-session-entities` skill understands this JSON and these requests:

- **Recalibrate skill based on feedback:** inspect corrections and original
  confidence/reasons, reconcile their snapshots, and update supported skill rules
  and examples. Session-specific edits do not automatically become general rules.
- **Resolve feedback with my help:** inspect open issues and supporting passages,
  work through questions with the human, apply agreed changes through guarded
  saves, and record a resolution only after checking the outcome.

Human corrections remain in history. Agent resolutions do not create human approval.
Changed source/note evidence requires preserving the old record’s fields while
resetting its status to unreviewed; the earlier approval remains in history.
Regeneration appends an agent event and cannot overwrite whole human-reviewed
records, forge new human statuses, or recreate removed IDs. Reopen a protected
record as unreviewed before asking an agent to revise it. Historical calibration
exports are preserved and are not automatically replayed or migrated.

## Setup, persistence, and recovery

Discovery runs in JavaScript without Python. Review requires Python 3.9+ and the
vault's maintained `.agents/skills/check-session-entities/scripts/entity_review.py`
and its source-reader dependencies. Install the entity skill requirements, e.g.:

```powershell
python -m pip install -r D:\personal\taelgar\.agents\skills\check-session-entities\requirements.txt
```

Configure the Python executable in Taelgarverse settings when needed. The desktop
adapter invokes Python without a shell using UTF-8 JSON stdin/stdout. Windows
uses the existing native executable resolution and forward-slash launch paths.
Requests have a 60-second timeout, 16 MiB output limit, and callback watchdog.
Errors stay visible beside the form; failed writes do not advance the queue.
The lower-level Python setup/connection commands remain available to adapter tests;
the focused session UI no longer contains transcript repair or connection tools.

Map and review writes share the session lock. Review JSON contains version 1,
purpose `session-entities-review`, the session YAML, current map byte hash,
history, and open/resolved feedback. Each human change includes before/after
snapshots and exact map hashes. Agent regeneration records whole-map snapshots.
A write-ahead transaction inside the review file allows the next inspection to
complete an interrupted two-file save if the map still matches its before/after
hash. Unexpected external changes stop for reconciliation; never edit hashes to
bypass the guard. Refresh/reinspect after a stale-token failure.

This replaces the old provisional `reviewState` queue and high-confidence default
acceptance. The current entity-map schema does not accept `reviewState`; unsupported
legacy maps need the entity skill's explicit upgrade. Existing transcript review
artifacts and helpers are preserved, but transcript repair is outside this tab.
No final interaction generation or automatic agent execution is added.

## Ownership and checks

Core owns the desktop adapter, native index, DOM table/queue, and plugin styles.
The vault owns source validation, guarded edits, review JSON, locks, and recoverable
writes in `entity_review.py` and `entity_review_store.py`. `entity_map.py` uses the
same store when regenerating a reviewed map. See the vault skill's
`references/review-workflow.md` for the agent API and feedback semantics.

Run core's entity/session review, index, process, Python-resolution, and Obsidian
adapter tests, plus `node scripts/build-obsidian.mjs`. Run the vault entity suite
with `python3 -B -m unittest discover -s .agents/skills/check-session-entities/tests -v`.
Use temporary bundles for save/recovery tests. A local plugin build does not install
or release it. Development installation, when requested, uses:

```powershell
npm run dev -- --plugin --vault D:\personal\taelgar
```
