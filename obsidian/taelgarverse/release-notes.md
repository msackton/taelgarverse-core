Taelgarverse 2.0.0

**Update your vault before upgrading the plugin.** Campaign features now read `_sessions/campaign-registry.json`. Each campaign ID points to an index note that supplies its name and directories. Vaults that still use `_scripts/session_note_campaigns.json` need to migrate. For the Taelgar vault, pull the latest `main` before updating through BRAT.

- Campaign interactions group session references and handouts by their registered folder or an explicit campaign on the note. A handout can live outside the campaign folder and still appear under the right campaign.
- Session Review discovers entity maps in each campaign’s registered session bundle directory.
- Note maps now have a compact toolbar for panning, sketching, selecting, erasing, and measuring. Measure straight lines or trace routes freehand. Each measured route has its own number and distance, and Undo and Redo let you revise annotations.
- The relationship explorer uses its People and Places views. It ignores legacy `graphPositions` coordinates.

Requires Obsidian Desktop 1.8.0 or later.
