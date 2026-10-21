Taelgarverse 0.3.0

- Add generated headers with an empty taelgar-header code block. Each block reads the note's frontmatter and displays its title, pronunciation, biographical information, dates, affiliations, and whereabouts.
- Use the shared Taelgarverse header rules without requiring Dataview or CustomJS for header blocks. Support historical affiliations, custom display defaults, secondary residences, and nested location chains.
- Refresh headers when note metadata or the active calendar date changes, and resolve location links through Obsidian's own link resolution.
- Show a clear header error for circular location or organization chains.
- Keep the native information callout styling while hiding the Live Preview code-block edit button and hover frame. Edit the fence in Source mode.

To use the new header, replace the old generated title, pronunciation, and information callout with an empty block immediately after frontmatter:

````markdown
```taelgar-header
```
````

Keep the frontmatter. The block includes the H1 title, so remove any separate H1 above it. Existing notes are not migrated automatically.

Header blocks require the Taelgar vault's metadata.json in its Obsidian configuration folder and _scripts/session_note_campaigns.json. Other Dataview or CustomJS body queries still need their existing plugins.

Desktop only. The minimum app version remains Obsidian 1.8.0.
