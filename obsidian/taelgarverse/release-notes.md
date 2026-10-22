Taelgarverse 0.4.0

- Add Campaign interactions at the bottom of notes with registered knownTo campaigns, in Reading View and Live Preview. Place an empty taelgar-interactions code block wherever you want the panel instead, or turn off automatic panels in settings.
- Build encounter history from the authoritative session recap's NPC beats and Short text. When a session has no recap, use explicit links in its official session note as session references.
- Show titles and dates beside interaction dots, with automatic grouping and zoom. Session references on the same exact day share one counted dot; zoom reveals the individual notes. Select a dot for a compact popup with its date, details, session link, and available polished beat transcript.
- Switch between known campaigns with a picker that includes All. Notes without recorded interactions keep a compact campaign header and Known to party status.
- Group related campaign links into Items, Stories, Sources, and References, with ten links per category before expansion. Exclude untagged, meta, and background material.
- Refresh histories when notes, metadata, or the calendar date change. Panels use native Obsidian links and leave note text unchanged.

Campaign interactions use the vault's _scripts/session_note_campaigns.json registry and authoritative recaps under _sessions. Existing notes need no edits to receive automatic panels when their knownTo field contains a registered campaign.

Desktop only. The minimum app version remains Obsidian 1.8.0.
