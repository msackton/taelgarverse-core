Taelgarverse 1.1.0

- Redesign Session review around an editable entity map and an entity-by-entity review queue. Edit type, status, and session role inline; use Accept or Save and next to record human review.
- Open source passages and active agent feedback in a Details popup. Show agent confidence and its recorded explanation, with transcript and session-note links when available.
- Exclude entities with a short reason and restore them from the excluded list while retaining their evidence and review history.
- Create an empty, linked staging note from the per-entity screen or the main map's Details popup. Reuse existing campaign folders, prompt for unclear names, and use Obsidian's cached names and aliases to avoid a slow vault-wide collision scan.
- Continue after a transcript or session-input change through explicit confirmation that records the acknowledged revision. Vault-note content changes no longer block processing or reset review status.
- Keep session feedback, agent follow-up instructions, and change history on the main map. Saved feedback waits for an explicitly requested agent follow-up; it does not run an agent automatically.

Before using Session review, update the vault's `check-session-entities` Python helpers and skill to the matching entity-review version. The plugin release does not install those vault files. Enable Session review in Taelgarverse settings and reload the plugin after updating.

Desktop-only; the minimum Obsidian version remains 1.8.0. This release updates the plugin independently of vault content publication.

Validation: the full automated core suite passed (1,874 tests), along with targeted entity-review and staging-helper checks. The workflow also runs local R2/D1 integration tests and Worker packaging before publication. The development build has been exercised during entity-review testing; a separate BRAT installation of the published assets has not been verified.
