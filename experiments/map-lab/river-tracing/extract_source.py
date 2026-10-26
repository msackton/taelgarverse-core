"""Re-extract the registered raster river input from the unchanged PSB.
Run with PYTHONPATH=/tmp/map-tools:/tmp/psd-tools.
"""
from pathlib import Path
import json
from PIL import Image
from psd_tools import PSDImage
ROOT=Path(__file__).resolve().parent
Image.MAX_IMAGE_PIXELS=None
psd=PSDImage.open(ROOT.parent/'aveil/source/taelgar-basemap.psb',max_alloc_bytes=8*1024**3)
box=(3000,2400,5200,4500)
m=json.loads((ROOT.parent/'aveil/exports/registration.json').read_text())['world_to_psb']
layer=next(l for l in psd.descendants() if l.name=='rivers' and not l.is_group())
a,b,c=m[0];d,e,f=m[1]
image=layer.topil().transform((box[2]-box[0],box[3]-box[1]),Image.Transform.AFFINE,
    (a,b,a*box[0]+b*box[1]+c-layer.left,d,e,d*box[0]+e*box[1]+f-layer.top),Image.Resampling.BICUBIC)
image.save(ROOT/'rivers.png')
(ROOT/'crop.json').write_text(json.dumps({'world_bbox':box}))
