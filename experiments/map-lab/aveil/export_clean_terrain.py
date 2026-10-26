"""Export original PSB terrain without transport, hydrology or annotations.

Composite native cached layer pixels with their original opacity and placement.
No generative artwork, tracing, inpainting, or changes to the PSB.
"""
from pathlib import Path
import json,gc
from PIL import Image
from psd_tools import PSDImage
from psd_tools.constants import BlendMode

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'clean-terrain'
OUT.mkdir(exist_ok=True)
Image.MAX_IMAGE_PIXELS=None
psd=PSDImage.open(ROOT/'source/taelgar-basemap.psb',max_alloc_bytes=8*1024**3)
names={'coastline_VEC','ripples_1','ripples_2','ripples_3','plains','forest','swamp','topography'}
layers=[layer for layer in psd.descendants() if layer.name in names and layer.is_visible()]
assert len(layers)==len(names)
canvas=Image.new('RGBA',psd.size,(255,255,255,0))
records=[]
for layer in layers:
    assert not layer.has_mask() and not len(layer.effects)
    assert layer.blend_mode==BlendMode.NORMAL and layer.fill_opacity==255
    im=layer.topil()
    assert im.mode=='RGBA'
    if layer.opacity!=255:
        im.putalpha(im.getchannel('A').point([round(i*layer.opacity/255) for i in range(256)]))
    width=min(im.width,psd.width-layer.left)
    height=min(im.height,psd.height-layer.top)
    canvas.alpha_composite(im,dest=(layer.left,layer.top),source=(0,0,width,height))
    records.append(dict(layer=layer.name,kind=layer.kind,opacity=layer.opacity,bbox=layer.bbox))
    im.close();del im;gc.collect()
    print('Composited',layer.name,flush=True)
canvas.save(OUT/'taelgar-terrain-transparent.png')
print('Saved full 14400 x 14400 transparent terrain',flush=True)

# Produce the registered published-world frame using the previously measured
# world -> PSB affine transform. The document-coordinate export above is native.
registration=json.loads((ROOT/'exports/registration.json').read_text())
m=registration['world_to_psb']
aligned=canvas.transform(tuple(registration['world_dimensions']),Image.Transform.AFFINE,
                         tuple(m[0]+m[1]),resample=Image.Resampling.BICUBIC)
white=Image.new('RGBA',aligned.size,'white');white.alpha_composite(aligned)
world=white.convert('RGB');white.close();aligned.close()
world.save(OUT/'taelgar-terrain-known-world.png')
world.crop((3450,3500,3900,3890)).save(OUT/'aveil-terrain-only.png')
world.crop((3200,3200,4350,4250)).save(OUT/'sembara-terrain-only.png')
preview=world.copy();preview.thumbnail((1700,1700));preview.save(OUT/'known-world-preview.png')
print('Saved registered known-world image and regional crops',flush=True)
manifest=dict(source='/MapV3/base/taelgar-basemap.psb',source_size=list(psd.size),
              included=records,excluded=['Background (replaced by transparency or white)',
              'Layer 1','Layer 2','hex-grid','hex-labels','latitude','coast_old',
              'rivers (including rivers_old, rivers and lakes)','points-of-interest (including locations, roads and volcanos)'],
              full_export='taelgar-terrain-transparent.png',known_world_export='taelgar-terrain-known-world.png',
              known_world_size=registration['world_dimensions'],world_to_psb=m,
              method='Native RGBA layer pixels, Photoshop normal blending and authored opacity. Coastline uses cached raster rendering of the original vector shape. Registered known-world export resamples with the fitted affine transform.',
              limitation='Excludes separate lake and volcano layers as well as rivers. Coastline paths may themselves enclose inland water-shaped features; no semantic cleanup or invention is applied.')
(OUT/'layers.json').write_text(json.dumps(manifest,indent=2))
print('Done',flush=True)
