"""Package a self-contained browser trial and a portable Obsidian test folder."""
from pathlib import Path
import os
import base64,json,html,re,shutil,zipfile

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'exports'
TRIAL=ROOT/'try-aveil'
TRIAL.mkdir(exist_ok=True)
places=json.loads((OUT/'places.json').read_text())
raw=(OUT/'aveil-study.svg').read_text()
raw=re.sub(r'<svg[^>]*>','<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1125 1800" aria-label="Aveil regional map">',raw,count=1)
inner=raw[raw.index('>')+1:raw.rindex('</svg>')]
# Separate linked towns from artwork so both reference modes share the hit targets.
anchors=re.findall(r'<a href=.*?</a>',inner)
assert len(anchors)==len(places)
for anchor in anchors:inner=inner.replace(anchor,'')
markers=''.join(a.replace('<a ',f'<a data-place="{i}" ',1) for i,a in enumerate(anchors))
reference=base64.b64encode((Path(os.environ["TAELGAR_VAULT"])/"assets/Aveil.jpg").read_bytes()).decode()
map_svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1125 1800" aria-label="Aveil regional map"><g id="study-layer">{inner}</g><g id="reference-layer" style="display:none"><image width="1125" height="1800" href="data:image/jpeg;base64,{reference}"/></g><g id="town-layer">{markers}</g></svg>'
buttons=''.join(f'<button data-town-button aria-pressed="false">{html.escape(p["name"])}</button>' for p in places)
data=json.dumps(places).replace('<','\\u003c')
js=(ROOT/'trial.js').read_text()
page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aveil — map trial</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#efede5;color:#263b35;font:15px system-ui,sans-serif}header{padding:18px 25px;border-bottom:1px solid #cccac1;display:flex;align-items:baseline;gap:24px}h1{font:27px Georgia,serif;margin:0}header p{margin:0;color:#5b6660;font-size:13px}main{display:grid;grid-template-columns:minmax(0,1fr) 270px;height:calc(100dvh - 70px)}.viewer{display:flex;flex-direction:column;min-height:0;min-width:0}nav{padding:12px 18px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;border-bottom:1px solid #d5d2c8;background:#f7f5ef}button{background:#fffdf8;border:1px solid #b5bcb2;border-radius:5px;padding:8px 12px;color:#263b35;cursor:pointer;font:inherit}button:hover,button[aria-pressed=true]{background:#dce6d9;border-color:#577461}button:focus-visible,a:focus-visible,input:focus-visible,#map:focus-visible{outline:3px solid #456b93;outline-offset:2px}nav label{display:flex;align-items:center;gap:5px;margin-left:10px;font-size:13px}#map{flex:1;min-height:250px;overflow:hidden;background:#dfded6}#map>svg{width:100%;height:100%;display:block;touch-action:none;user-select:none;cursor:grab}#map>svg:active{cursor:grabbing}#map svg a{cursor:pointer}#map svg a.selected circle{stroke:#1e6580;stroke-width:5px;r:11}#map svg.reference a text{display:none}#map svg.reference a circle{fill:#a42e29;stroke:white;stroke-width:3px;r:10}footer{font-size:12px;color:#60685f;padding:8px 18px;border-top:1px solid #d5d2c8}aside{padding:22px 18px;background:#f7f5ef;border-left:1px solid #cccac1;overflow:auto}h2{font:23px Georgia,serif;margin:0 0 9px}h3{font-size:12px;letter-spacing:.07em;text-transform:uppercase;margin-top:28px}aside p{font-size:13px;line-height:1.5;color:#5b6660}.towns{display:flex;gap:6px;flex-wrap:wrap}.towns button{font-size:13px;padding:7px 9px}#open-note{display:inline-block;background:#31584a;color:white;padding:10px 13px;border-radius:5px;text-decoration:none}#open-note[hidden]{display:none}input[type=text]{width:100%;padding:8px;border:1px solid #b5bcb2;background:#fffdf8;border-radius:4px;color:#263b35}aside label{font-size:12px;display:block;margin:18px 0 7px}#zoom-level{min-width:40px;text-align:center;font-size:13px}small{font-size:11px;color:#626c61}.notice{margin-top:24px;padding-top:14px;border-top:1px solid #d5d2c8}@media(max-width:750px){header{display:block;padding:12px 16px}header p{margin-top:5px}main{display:flex;flex-direction:column;height:auto}.viewer{height:72dvh}aside{border-left:0;border-top:1px solid #cccac1;padding:16px}nav{padding:8px;gap:5px}nav button{padding:7px 9px}nav label{margin-left:3px}.notice{margin-top:12px}}
</style>
<header><h1>Aveil / map trial</h1><p>Regional artwork, zoom and linked towns</p></header>
<main><section class="viewer" aria-label="Map viewer"><nav aria-label="Map controls"><button id="minus" aria-label="Zoom out">−</button><span id="zoom-level">1.0×</span><button id="plus" aria-label="Zoom in">+</button><button id="fit">Fit map</button><button id="woodland">Woodland</button><button id="aslain">Aslain area</button><label><input id="reference" type="checkbox">Original reference</label><label><input id="towns" type="checkbox" checked>Towns</label></nav>
<div id="map" tabindex="0" role="region" aria-label="Interactive map. Drag to pan; scroll, plus or minus to zoom. Arrow keys pan. Zero fits map.">__SVG__</div><footer>Drag to pan · Scroll or pinch to zoom · Click a town · Keyboard: arrows, +/−, 0</footer></section>
<aside><div aria-live="polite"><h2 id="selection-title">Explore Aveil</h2><p id="selection-copy">Start with Woodland to inspect the forests, or choose a town below.</p></div><a id="open-note" hidden href="#">Open note in Obsidian</a><h3>Go to a town</h3><div class="towns">__BUTTONS__</div><label for="vault-name">Your Obsidian vault name</label><input id="vault-name" type="text" value="taelgar"><small>Used only when you open a note.</small><div class="notice"><p>Draft regional map. Town positions are provisional. World-map alignment and distance calibration are pending.</p><p>Try the Original reference switch at the same zoom to compare the geography and visual detail.</p></div></aside></main>
<script id="places-data" type="application/json">__DATA__</script><script>__JS__</script></html>'''
page=page.replace('__SVG__',map_svg).replace('__BUTTONS__',buttons).replace('__DATA__',data).replace('__JS__',js)
(TRIAL/'Aveil Map Trial.html').write_text(page)

# Obsidian package: uses only supported image-map fields. Individual map marker
# overlays are not supported by the current Taelgarverse plugin.
folder=TRIAL/'Aveil Map Trial'
(folder/'assets').mkdir(parents=True,exist_ok=True)
(folder/'.nopublish').write_text('Local mapping experiment. Exclude this folder from website publication.\n')
shutil.copy2(OUT/'aveil-study.png',folder/'assets/aveil-study.png')
shutil.copy2(OUT/'aveil-study.svg',folder/'assets/aveil-study.svg')
note='''---
tags: [experiment/map]
---
# Aveil map trial

Open this note in Reading View with the Taelgarverse plugin's Maps feature enabled.
Use **+ / −**, **Fit map**, and drag to inspect the new woodland artwork.

This is a draft regional study. Its geography and town positions are provisional.
Distance calibration and a seamless world-map transition are still pending.

```taelgar-map
id: aveil-artwork-trial
image: ./assets/aveil-study.png
bounds:
  - [0, 0]
  - [1800, 1125]
height: 700px
width: 100%
minZoom: -3
maxZoom: 3
defaultZoom: -2
fitBounds: true
scale: 1
unit: image pixels
```

The viewer's ruler reports **image pixels**, not miles. The current plugin displays
the image but does not support clickable town overlays. Use these note links,
or the browser trial's clickable markers:

'''
note+='\n'.join('- [['+p['note'].removesuffix('.md')+'|'+p['name']+']]' for p in places)
note+='\n\n## What to try\n\n1. Inspect the whole region, then zoom into the western forest.\n2. Check whether the trees stay readable near the towns and waterways.\n3. Compare the original regional map: ![[Aveil.jpg]]\n\nIf the map plugin is unavailable, open [[assets/aveil-study.png|the map image]].\n'
(folder/'Aveil map trial.md').write_text(note)
instructions='''AVEIL MAP TRIAL

Browser: open "Aveil Map Trial.html" in Chrome, Firefox, Safari or Edge.
It is self-contained and works offline; no server or account is required.
Try Woodland, scroll or pinch to zoom, toggle Original reference, and select
Aslain. Set your local vault name before choosing Open note in Obsidian.

Obsidian: copy the "Aveil Map Trial" folder into your Taelgar vault, then open
"Aveil map trial" in Reading View with the Taelgarverse Maps feature enabled.
This uses your installed image-map viewer. Clickable town overlays are available
only in the browser trial; the note supplies ordinary links to the same towns.
The .nopublish marker excludes the experiment folder from website publication.

The HTML is a separate experimental viewer, not an update to the plugin or site.
It does not implement a world-to-region zoom transition. Regional alignment and
real-distance calibration remain unresolved. No notes are edited by the viewer.
'''
(TRIAL/'READ ME.txt').write_text(instructions)
with zipfile.ZipFile(TRIAL/'Aveil Map Trial.zip','w',zipfile.ZIP_DEFLATED) as z:
    for path in sorted(TRIAL.rglob('*')):
        if path.is_file() and path.suffix!='.zip':z.write(path,path.relative_to(TRIAL))
print('Created browser trial and portable Obsidian package:',TRIAL)
