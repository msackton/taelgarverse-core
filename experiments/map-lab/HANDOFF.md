# Resume Taelgar map baseline work

Start here when resuming this branch on another computer or with another agent.

## Current task and authoritative decisions

Implement [the baseline specification](../../docs/taelgar-map-baseline-spec.md). The spec is the current direction; the progressive-detail experiments in this directory are historical reference material.

- One standard Photoshop export serves the full map and regional/player-facing views. Include the usual map artwork, including roads, rivers and towns, but omit the baked hex grid and grid/reference labels.
- The correct scale is **0.6 miles per core-image pixel** and **40 pixels between opposite flat sides of each small hex**, giving **24 miles per small hex**. The user explicitly clarified the units. Conflicting prior calibration claims are wrong and must be corrected, not accommodated as alternative scales.
- Generate the aligned hex grid in Leaflet, with a checkbox and coordinate lookup. It pans and zooms with the image.
- Store each regional rectangle and ordered white/grey/dim masks in its note's map block, using global core-image pixel coordinates. Support masking inside or outside a polygon.
- Provide an Obsidian-only visual editing drawer that saves the selected map block safely. Website rendering uses the same definitions.
- Defer progressive detail, generated forests, editable river/road/town feature layers and regional artwork generation.

The original spec is also available as a [Page](https://chatgpt.com/space/page_7d8099c76a64819198f49e870af71b77). The repository copy has portable paths and can be handed directly to an agent without Page access.

## What is and is not implemented

The production viewer already supports image maps, website tiles, zoom, measurement and temporary sketches. It does **not** yet implement this baseline's manifest, generated hex grid, regional crop/mask schema or persistent editing drawer. This branch adds the specification and archived supporting work, without integrating the prototypes into production code.

| Location | Status and use |
| --- | --- |
| `docs/taelgar-map-baseline-spec.md` | Current feature contract, example block, architecture and acceptance criteria |
| `experiments/map-lab/aveil/exports/layers.json` | Actual PSB layer inventory |
| `experiments/map-lab/aveil/exports/registration.json` | Historical image-registration result; not authority for the new physical scale |
| `experiments/map-lab/aveil/export_clean_terrain.py` | Working extraction approach; excludes too much artwork for the new standard export |
| `experiments/map-lab/river-tracing/` | Original-river extraction and centerline tracing scripts |
| `experiments/map-lab/progressive-map/` | Latest standalone Leaflet experiment: one traced river system and fictional roads/towns |
| `experiments/map-lab/aveil/` | Earlier regional and forest experiments; older README next steps are superseded |
| `experiments/map-lab/excluded-assets.json` | Original relative paths and byte sizes of every deliberately omitted asset |

The latest river demo has one main course plus nine tributary paths from the PSB. Its other geography is invented. No town coordinates from those experiments should become canonical geography. The colored Aveil reference did not register reliably to the world map and should not be assumed aligned.

The correct new hex origin/stagger and the printed locator numbering still need to be established from source evidence. Existing locators such as `13.11.D07` must not be decoded by guesswork. Distinguish historical pixel registration from the user-defined 0.6 miles/pixel contract.

## Checkout and permissions

```sh
git clone --branch codex/taelgar-map-baseline https://github.com/msackton/taelgarverse-core.git
cd taelgarverse-core
```

Read `AGENTS.md` and `docs/architecture.md`. The user authorized pushing this handoff branch. That authorization does not authorize deploying production, publishing vault content, merging to main, or releasing the plugin. Follow repository rules for subsequent work.

The vault is a separate repository: `https://github.com/tsackton/taelgar.git`. The original session used vault revision `5c3f365f6a02ba02cd9d4e55d4db45a0d8b0f9fb`; use that reference if investigating historical inputs, and do not reset someone else's checkout. Access to the vault and Dropbox must be available in the new environment independently of this branch.

```sh
export TAELGAR_VAULT=/absolute/path/to/taelgar
```

The archived scripts that read the vault use this variable. Run setup commands below from the core repository root. Ignore historical `/workspace` and `/tmp` examples inside archived READMEs: neither those directories nor old HTTP servers are part of the handoff.

## Assets deliberately excluded from Git

No PSB/PSD, raster maps, generated SVG artwork, videos, ZIP packages, NumPy dumps or vendored Leaflet assets are included. Code and small text metadata are retained; individual archived files above 128 KiB were excluded. Scoped ignore rules keep locally restored artifacts out of ordinary staging.

The original Photoshop document is available from Dropbox:

- Path: `/MapV3/base/taelgar-basemap.psb`
- File ID: `id:I0L7keDVKGYAAAAAAA_icw`
- Expected byte count: `463733393`
- SHA-256: `4828acc34ac4d6a6e758316d795e84bb15100ff8654c06fe1189b187acc13862`
- Dropbox content hash: `d2183a29eafaa6ac37c0b0a708b6dfe8b250843ef339016c609b5097b1bcf07a`
- Local destination: `experiments/map-lab/aveil/source/taelgar-basemap.psb`

Retrieve it with a newly requested Dropbox download link, or copy the original locally. Dropbox download links are single-use: issue the download directly, with no preliminary HEAD request. Do not save signed links or credentials in Git. In a managed environment, the download host must be permitted by its active network policy; an earlier session's allowlist does not carry over automatically.

The original map references are `assets/taelgar-world-map.png`, `assets/world-map-regions-new.png` and `assets/Aveil.jpg` in the separate vault. They are not copied into this branch.

The accepted generated forest atlas, older videos and screenshots were intentionally omitted. Some older forest demonstrations cannot be reproduced exactly without copying those assets separately from the old environment. They are not dependencies of the new baseline task. The latest terrain-and-river demo can be rebuilt from the PSB using the steps below.

## Optional reconstruction of the latest prototype

This is useful for inspecting prior work, but is not a prerequisite to implementing the baseline specification. The dependency list is an environment bootstrap for archived scripts, not a reproducibility lock. The new production exporter must pin and document its own supported toolchain.

```sh
python -m venv .venv-map-lab
.venv-map-lab/bin/python -m pip install -r experiments/map-lab/requirements-experiments.txt
mkdir -p experiments/map-lab/aveil/source
```

Place the PSB at the destination above before continuing. Extraction can require several GB of memory.

```sh
.venv-map-lab/bin/python experiments/map-lab/aveil/export_clean_terrain.py
cp experiments/map-lab/aveil/clean-terrain/taelgar-terrain-known-world.png experiments/map-lab/progressive-map/terrain.png
.venv-map-lab/bin/python experiments/map-lab/river-tracing/extract_source.py
.venv-map-lab/bin/python experiments/map-lab/river-tracing/trace_rivers.py
```

Those commands reproduce historical prototype imagery, not the proposed standard baseline image: the historical terrain export removes roads, rivers, towns and other layers, and its coordinate frame predates the baseline specification.

Leaflet 1.9.4 is already an exact dependency of the core project. Restore the prototype's local vendor directory from that dependency:

```sh
npm ci
mkdir -p experiments/map-lab/progressive-map/vendor
cp node_modules/leaflet/dist/leaflet.js experiments/map-lab/progressive-map/vendor/
cp node_modules/leaflet/dist/leaflet.css experiments/map-lab/progressive-map/vendor/
cp node_modules/leaflet/LICENSE experiments/map-lab/progressive-map/vendor/
cp -R node_modules/leaflet/dist/images experiments/map-lab/progressive-map/vendor/
python -m http.server 8877 --bind 127.0.0.1 --directory experiments/map-lab/progressive-map
```

Open `http://127.0.0.1:8877/`. Use the local virtual environment's Python on systems without a `python` alias. Activate the virtual environment using the platform's equivalent commands if not using a POSIX shell.

The archived full extractor `aveil/extract.py` can regenerate additional layer crops, registration and coastline data. It needs the vault and considerably more processing. Do not rerun it merely to restore the latest demo; the necessary historical registration is already tracked.

## Suggested first message to the next agent

> Resume the Taelgar map baseline on this branch. Read `AGENTS.md`, `experiments/map-lab/HANDOFF.md` and `docs/taelgar-map-baseline-spec.md`. The scale is authoritative: 40 pixels across a small hex, 24 miles per hex, and 0.6 miles/pixel. Implement the standard Photoshop export without baked hexes, a registered Leaflet hex overlay with coordinate lookup, per-block crops and masks, and an Obsidian-only visual editor. The included progressive-detail prototypes are references, not the target architecture. Establish source alignment and the export recipe first. Keep large/generated assets out of Git and follow repository deployment/push permission rules.

## Checks for this handoff

The handoff packaging does not run or add tests. Script changes are limited to portable vault-path configuration and documentation. The original experiments' checks are recorded in their archived READMEs and are historical results, not verification in a newly restored environment. Follow the feature spec and repository verification requirements when implementing the baseline.
