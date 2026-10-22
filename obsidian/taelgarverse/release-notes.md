Taelgarverse 0.4.0

- Add Campaign interactions at the bottom of notes with registered knownTo campaigns, in Reading View and Live Preview. Place an empty taelgar-interactions code block wherever you want the panel instead, or turn off automatic panels in settings.
- Build encounter history from the authoritative session recap's NPC beats and Short text. When a session has no recap, use explicit links in its official session note as session references.
- Show titles and dates beside interaction dots, with automatic grouping and zoom. Session references on the same exact day share one counted dot; zoom reveals the individual notes. Select a dot for a compact popup with its date, details, session link, and available polished beat transcript.
- Switch between known campaigns with a picker that includes All. Notes without recorded interactions keep a compact campaign header and Known to party status.
- Group related campaign links into Items, Stories, Sources, and References, with ten links per category before expansion. Exclude untagged, meta, and background material.
- Refresh histories when notes, metadata, or the calendar date change. Panels use native Obsidian links and leave note text unchanged.

Campaign interactions use the vault's _scripts/session_note_campaigns.json registry and authoritative recaps under _sessions. Existing notes need no edits to receive automatic panels when their knownTo field contains a registered campaign.

Desktop only. The minimum app version remains Obsidian 1.8.0.

- Add Residents, Settlements, and Members grids calculated from current vault metadata and the selected in-world date.
- Enable popup buttons with an `indexes` array in frontmatter. Buttons appear at the bottom of the new `taelgar-header` block, below and outside the information callout.
- Place grids inline with `taelgar-index` fences. Use `show: obsidian`, `show: website`, or `show: both` to choose where each grid appears.
- Grid cards show available lead images from note `image` frontmatter. Inline blocks also support `mode: table`. Popups always use grids.
- People cards include available pronouns and name pronunciation, matching table name formatting. Settlement cards also show available pronunciation.
- Residents tables show Person (name, pronouns, pronunciation), Info (ancestry and main type), Current Location (last-known chain and date), and Home. Queries match living people's active homes, retaining traveling residents and excluding transients whose home is elsewhere.
- People cards use the same Info and Current Location templates as tables, with Home on Residents and affiliation roles on Members.
- Settlement tables show Place, Region, Type Of, and Population, sorted by dated home region. Settlement queries include ruins and use the existing current, last-known and secondary location rules.
- Member tables show Person (including pronouns/pronunciation), Info (ancestry and main type), and Current Location (last-known chain and date), matching the existing query's templates and affiliation-date rules.
- Indexes refresh when vault metadata or the current date changes and require no Dataview or CustomJS scripts.
