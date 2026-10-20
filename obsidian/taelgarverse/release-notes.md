Taelgarverse 0.1.0 brings Map Tools into the unified Taelgarverse plugin.

- Render local image maps in Reading view and rendered Live Preview blocks.
- Measure distances, trace rivers and roads, and measure enclosed areas.
- Share map rendering, measurement, and calibration code with the website.
- Use `taelgar-map` blocks alongside the separate Obsidian Leaflet plugin.
- Optionally render legacy `leaflet` blocks when no other map renderer is enabled.

Disable the old **Taelgar Map Tools** plugin before enabling legacy block support.
Existing map definitions work unchanged inside `taelgar-map` blocks; change only
the opening fence label. Alternatively, enable **Render legacy leaflet blocks**
in Taelgarverse settings and restart Obsidian with other map renderers disabled.

Requires desktop Obsidian 1.8.0 or newer. This first version contains Maps only;
Name Explorer and the Dataview materializer remain separate plugins.
