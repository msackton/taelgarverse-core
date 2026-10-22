Taelgarverse 0.4.0

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
