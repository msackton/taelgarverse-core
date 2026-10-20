# Taelgarverse for Obsidian

Taelgarverse tools for desktop Obsidian. Version 0.1.0 includes interactive maps,
distance measurement, freehand tracing, and enclosed-area measurement.

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

## Development

This repository distributes releases. Source, shared website code, tests, and
release instructions live in [taelgarverse-core](https://github.com/msackton/taelgarverse-core/tree/main/obsidian/taelgarverse).
Each release includes its source commit in `release.json`. Licensed under
GPL-3.0; bundled libraries retain their license notices.
