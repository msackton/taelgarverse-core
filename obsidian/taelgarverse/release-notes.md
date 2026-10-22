Taelgarverse 0.5.0

- Add Residents, Settlements, Members, Rivers, and Places indexes calculated from vault metadata and the selected in-world date. Rivers includes secondary watershed membership; Places includes nested quarters, buildings, and shops.
- Enable header popup buttons with an `indexes` frontmatter array. Buttons appear below the information callout in a `taelgar-header` block, stay hidden when empty, and calculate their contents when clicked.
- Add inline `taelgar-index` blocks with image grids or compact tables. Each inline index starts with an H2 heading. Use `target`, `show`, and `recursive` to choose its note, renderer, and containment scope.
- Use the existing people and location formatting for pronouns, pronunciation, ancestry, current location, and home. Residents follow active homes, Settlements includes ruins, and Members follows dated affiliations.
- Speed up repeated renders with shared metadata lookups and a bounded query cache that refreshes when metadata or the date changes. Member indexes omit result counts.

Indexes require no Dataview or CustomJS scripts and use native Obsidian links. Existing notes are unchanged; opt in with frontmatter or an inline block. Header popup buttons require the new `taelgar-header` block.

Desktop only. The minimum app version remains Obsidian 1.8.0.
