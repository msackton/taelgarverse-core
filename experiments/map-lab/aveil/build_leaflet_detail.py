"""Build a geographically registered detail crop for a single Leaflet map.

The published-world crop stays the source for every river, road and settlement.
Only the forest's drawn texture is replaced, inside a local woodland envelope.
"""
from pathlib import Path
import os
import base64,json,random,math,shutil
import cairosvg
import cv2
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'exports'
DEST=ROOT/'leaflet-trial'
def uri(path): return 'data:image/png;base64,'+base64.b64encode(path.read_bytes()).decode()
source=uri(OUT/'aveil-world-context.png')
sheet=uri(OUT/'forest-groves.png')
boxes=[(15,15,395,395),(440,10,370,390),(845,20,395,385),(10,435,430,370),(450,425,365,390),(845,425,395,385),(15,830,395,410),(435,865,385,330),(845,805,395,430)]
defs=f'<image id="sheet" width="1254" height="1254" href="{sheet}"/>'
defs+=''.join(f'<symbol id="grove{i}" viewBox="{x} {y} {w} {h}"><use href="#sheet"/></symbol>' for i,(x,y,w,h) in enumerate(boxes))
# Broad extent of the forest depicted in this published-map crop, in world pixels.
# Derive the replacement envelope from the isolated PSB forest alpha, with a
# small allowance for the measured registration residual. Keep original river,
# road, hill, and label pixels out of the mask using the published image colors.
alpha=np.array(Image.open(OUT/'forest.png'))[:,:,3]
m=cv2.morphologyEx((alpha>8).astype('uint8'),cv2.MORPH_CLOSE,np.ones((13,13),np.uint8))
m=cv2.dilate(m,np.ones((9,9),np.uint8))
rgb=np.array(Image.open(OUT/'aveil-world-context.png').convert('RGB')).astype('int16')
protected=((rgb[:,:,2]-rgb[:,:,0]>20)|(rgb[:,:,0]-rgb[:,:,2]>20)).astype('uint8')
hill_alpha=np.array(Image.open(OUT/'topography.png'))[:,:,3]
protected|=(hill_alpha>8).astype('uint8')
protected=cv2.dilate(protected,np.ones((3,3),np.uint8))
m[protected>0]=0
contours,_=cv2.findContours(m,cv2.RETR_LIST,cv2.CHAIN_APPROX_SIMPLE)
forests=[cv2.approxPolyDP(c,.5,True).reshape(-1,2).tolist() for c in contours if len(c)>=3]
def inside(x,y):
    result=False
    for forest in forests:
        for (a,b),(c,d) in zip(forest,forest[1:]+forest[:1]):
            if (b>y)!=(d>y) and x<(c-a)*(y-b)/(d-b)+a:result=not result
    return result
path_data=' '.join('M '+' L '.join(f'{x},{y}' for x,y in forest)+' Z' for forest in forests)
polygons=f'<path d="{path_data}" fill-rule="evenodd" clip-rule="evenodd"/>'
defs+=f'<clipPath id="forest-envelope">{polygons}</clipPath>'
parts=[f'<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1560" viewBox="0 0 450 390"><defs>{defs}</defs>',f'<image width="450" height="390" href="{source}"/>',f'<g fill="#f8f9fa">{polygons}</g>']
rng=random.Random(208)
groves=[]
for _ in range(7000):
    x,y=rng.uniform(40,210),rng.uniform(10,285)
    if not inside(x,y):continue
    size=rng.uniform(13,23)
    if any(math.hypot(x-a,y-b)<(size+s)*.24 for a,b,s,i in groves):continue
    groves.append((x,y,size,rng.randrange(9)))
parts.append('<g clip-path="url(#forest-envelope)">')
for x,y,s,i in sorted(groves,key=lambda g:g[1]+g[2]/2):
    parts.append(f'<use href="#grove{i}" x="{x-s/2}" y="{y-s/2}" width="{s}" height="{s}"/>')
parts.append('</g>')
# Restore all original pixels in the town-label strip and outside the forest.
# This keeps annotations from being changed by the illustrative woodland envelope.
parts.append(f'<svg x="0" y="265" width="450" height="125" viewBox="0 265 450 125"><image width="450" height="390" href="{source}"/></svg>')
parts.append('</svg>')
svg=''.join(parts)
(DEST/'aveil-detail.svg').write_text(svg)
cairosvg.svg2png(bytestring=svg.encode(),write_to=str(DEST/'aveil-detail.png'))
shutil.copy2((Path(os.environ["TAELGAR_VAULT"])/"assets/taelgar-world-map.png"),DEST/'world.png')
manifest=dict(world_size=[11329,9419],source_world_bbox=[3450,3500,3900,3890],
    leaflet_bounds=[[5529,3450],[5919,3900]],detail_size=[1800,1560],
    fade_start_zoom=-.5,fade_end_zoom=1,
    content='World-registered crop with sharper woodland artwork; original river, road and town pixels retained. This is not the independently drawn Aveil reference map.',
    towns=[dict(name='Cleenseau',world_xy=[3641,3768]),dict(name='Rinburg',world_xy=[3730,3698])])
(DEST/'detail.json').write_text(json.dumps(manifest,indent=2))
print('Built aligned Leaflet detail,',len(groves),'groves; bounds',manifest['leaflet_bounds'])
