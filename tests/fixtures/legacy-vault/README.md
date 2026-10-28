# Frozen legacy reference inputs

These eleven files are test fixtures, recovered from
[`tsackton/taelgar` main at `80ad43bd2bcaf6b200217c4f8e8d426c28fce533`](https://github.com/tsackton/taelgar/tree/80ad43bd2bcaf6b200217c4f8e8d426c28fce533)
on 2026-10-27. They include the original `OutputHandler.regenerateHeader` code
that was removed from the working vault after migration to the maintained core.

`source.json` records the commit and SHA-256 of every file after normalizing line
endings to LF. Tests verify these hashes. No test fetches GitHub or copies files
from a working vault to refresh this directory.

- `_scripts/customJS/` supplies the independent legacy VM reference used by
  `src/headers.mjs`. Its historical bugs are intentional reference behavior.
- `.obsidian/metadata.json` and `_scripts/session_note_campaigns.json` supply
  frozen display rules and campaign configuration for synthetic test vaults.
- Existing `header-*-cases` and `header-*-outputs` fixtures outside this directory
  remain unchanged. Their captured outputs are checked against this reference
  and the maintained core.

Update these files only as an explicit, reviewed fixture change. Record the
source commit and new hashes, explain changed behavior, and review expected
outputs individually. Do not regenerate expectations merely to make tests pass.
These sources are never shipped by normal website or plugin builds.
