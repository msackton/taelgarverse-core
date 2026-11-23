Taelgarverse 3.0.0

- Convert inline `taelgar-index` blocks to one of two query types. For residents use `type: whereabouts`, `from: person`, and `via: home`. For membership rosters use `type: affiliation` and `from: person`. Replace frontmatter index buttons with inline blocks.
- Find subjects by home, current or last-known location, or by dated affiliation and leadership. Use `scope: ever` for people who formerly belonged to a group. Tables support ordered columns and sorting, and `where` filters result notes by frontmatter.
- Use `taelgar-map` for maps rendered by Taelgarverse. The plugin no longer handles legacy `leaflet` fences. Website Dataview evaluation now runs in the Node publisher, replacing the plugin's export and materialization commands.
