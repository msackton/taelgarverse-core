# Taelgarverse for Obsidian

Taelgarverse tools for desktop Obsidian: interactive maps, distance measurement,
freehand tracing, enclosed-area measurement, and an optional image viewer.

## Install with BRAT

1. Install **BRAT** from Obsidian's Community plugins and enable it (BRAT 1.1.0 or newer).
2. In BRAT, add `msackton/taelgarverse-obsidian` as a beta plugin.
3. Enable **Taelgarverse** in Community plugins.

BRAT can follow the latest release or pin an individual installation to a specific
version. Plugin files and BRAT preferences should stay outside vault Git tracking.

## Maps

Use a `taelgar-map` code block containing your existing map definition:

````markdown
```taelgar-map
image: [[My Map.png]]
bounds: [[0, 0], [100, 200]]
height: 600px
```
````

Copy the image into your vault. Add your map's verified calibration to measure
physical distances; without calibration or a scale, measurements use map units.
Definitions and calibration have the same meaning on the Taelgarverse website.

The separate **Obsidian Leaflet** plugin can remain enabled: Taelgarverse claims
only `taelgar-map` blocks by default. Existing `leaflet` blocks stay with their
current renderer. To use Taelgarverse for old blocks, disable other map renderers,
enable **Render legacy leaflet blocks** in Taelgarverse settings, then restart
Obsidian. Disable the former **Taelgar Map Tools** plugin during migration.

The plugin reads local images and does not rewrite notes. Measurements are
temporary and are cleared when the rendered map closes. Requires desktop
Obsidian 1.8.0 or newer.

## Images

Turn on **Image viewer** in Taelgarverse settings to add the website's image
viewer to Reading View and Live Preview. It is off by default and applies
immediately. Click an image or its expand icon to view it fitted to the window,
then choose **Pan / zoom** for dragging, +/−, keyboard, wheel, and pinch controls.
**Fit to screen**, **Download**, Close, and Escape work as on the website.
Captions in image callouts, gallery items, and HTML figures appear in the viewer.
Images without captions use their alt text.

Inline image callouts and embeds honor left/right placement and named sizes.
Figures center, heroes span the note, and galleries use a responsive grid.
Captions stay with images, and asides stack on narrow displays. No extra vault
CSS snippet is required; these styles use the same Image viewer switch.

Linked images and modified clicks keep their existing behavior. The feature uses
local original images and preserves notes; it generates no thumbnails or map
tiles. Disable the setting to remove its controls without changing map features.

## Development

This repository distributes releases. Source, shared website code, tests, and
release instructions live in [taelgarverse-core](https://github.com/msackton/taelgarverse-core/tree/main/obsidian/taelgarverse).
Each release includes its source commit in `release.json`. Licensed under
GPL-3.0; bundled libraries retain their license notices.
