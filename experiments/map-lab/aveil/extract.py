"""Extract source geometry and register the published map to the PSB.
Run with psd-tools, Pillow, numpy and opencv-python-headless installed.
"""
from pathlib import Path
import os
import json, hashlib
import cv2
import numpy as np
from PIL import Image
from psd_tools import PSDImage

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'exports'
VAULT = Path(os.environ["TAELGAR_VAULT"]).expanduser().resolve()
Image.MAX_IMAGE_PIXELS = None
OUT.mkdir(exist_ok=True)
p = PSDImage.open(ROOT / 'source/taelgar-basemap.psb')
layers = list(p.descendants())
inventory = [dict(name=l.name, kind=l.kind, visible=l.visible, bbox=l.bbox,
                  vector_mask=l.has_vector_mask()) for l in layers]
(OUT / 'layers.json').write_text(json.dumps(inventory, indent=2))

# Preserve cubic Bezier control points exactly, in original document coordinates.
coast = next(l for l in layers if l.name == 'coastline_VEC')
paths = []
raw = []
def xy(pt): return f'{pt[1]*p.width:.6f},{pt[0]*p.height:.6f}'
for sub in coast.vector_mask.paths:
    if not len(sub): continue
    d = ['M ' + xy(sub[0].anchor)]
    for a,b in zip(sub, list(sub)[1:] + ([sub[0]] if sub.is_closed() else [])):
        d.append('C ' + xy(a.leaving)+' '+xy(b.preceding)+' '+xy(b.anchor))
    if sub.is_closed(): d.append('Z')
    paths.append('<path d="'+' '.join(d)+'"/>')
    raw.append(dict(operation=sub.operation, closed=sub.is_closed(), knots=[
        dict(anchor=k.anchor, preceding=k.preceding, leaving=k.leaving) for k in sub]))
(OUT/'coastline-paths.json').write_text(json.dumps(raw))
(OUT/'coastline.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14400 14400"><g fill="none" stroke="#333" stroke-width="4">'+''.join(paths)+'</g></svg>')

world = Image.open(VAULT/'assets/taelgar-world-map.png').convert('RGB')
ws = world.copy(); ws.thumbnail((2400,2400))
ps = p.topil(); ps.thumbnail((2400,2400))
ps.save(OUT/'psb-overview.png')
ws.save(OUT/'world-overview.png')
detector = cv2.SIFT_create(nfeatures=22000)
k1,d1 = detector.detectAndCompute(cv2.cvtColor(np.array(ws),cv2.COLOR_RGB2GRAY),None)
k2,d2 = detector.detectAndCompute(cv2.cvtColor(np.array(ps),cv2.COLOR_RGB2GRAY),None)
matches = cv2.BFMatcher().knnMatch(d1,d2,k=2)
good = [a for a,b in matches if a.distance < .65*b.distance]
src = np.float32([k1[m.queryIdx].pt for m in good]) * (world.width/ws.width)
dst = np.float32([k2[m.trainIdx].pt for m in good]) * (p.width/ps.width)
M,mask = cv2.estimateAffinePartial2D(src,dst,method=cv2.RANSAC,ransacReprojThreshold=6,maxIters=10000)
if M is None or mask.sum()<30: raise RuntimeError('Insufficient registration evidence')
err=np.linalg.norm(src @ M[:,:2].T+M[:,2]-dst,axis=1)
result=dict(world_to_psb=M.tolist(),candidate_matches=len(good),inliers=int(mask.sum()),
            median_error_psb_pixels=float(np.median(err[mask.ravel()==1])),
            world_dimensions=world.size,psb_dimensions=p.size)
(OUT/'registration.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result),flush=True)

# Broad context around Aveil; coordinates are published-world source pixels.
box=(3450,3500,3900,3890)
world.crop(box).save(OUT/'aveil-world-context.png')
corners=np.array([[box[0],box[1]],[box[2],box[3]]]) @ M[:,:2].T+M[:,2]
crop=tuple(int(v) for v in np.rint(corners).ravel())
(OUT/'crop.json').write_text(json.dumps(dict(world_bbox=box,psb_bbox=crop)))
for name in ['topography','forest','plains','swamp','rivers_old','rivers','lakes','locations','roads']:
    l=next(l for l in layers if l.name==name and not l.is_group())
    im=l.topil()
    im.crop((crop[0]-l.left,crop[1]-l.top,crop[2]-l.left,crop[3]-l.top)).save(OUT/(name+'.png'))
    print('Exported',name,flush=True)
# Extract a small candidate symbol library, retaining native pixels and source boxes.
l=next(l for l in layers if l.name=='forest')
im=l.topil()
alpha=np.array(im)[:,:,3]
_,_,stats,_=cv2.connectedComponentsWithStats((alpha>20).astype('uint8'))
valid=[s for s in stats[1:] if 20<=s[2]<=60 and 30<=s[3]<=80 and .35<s[2]/s[3]<1.3 and s[4]>200]
cx,cy=(crop[0]+crop[2])/2,(crop[1]+crop[3])/2
valid.sort(key=lambda s:(s[0]+s[2]/2+l.left-cx)**2+(s[1]+s[3]/2+l.top-cy)**2)
records=[]
for i,s in enumerate(valid[:6]):
    x,y,w,h,area=map(int,s);b=(x-2,y-2,x+w+2,y+h+2)
    im.crop(b).save(OUT/f'tree-{i}.png')
    records.append(dict(file=f'tree-{i}.png',source_layer='forest',
       psb_bbox=[b[0]+l.left,b[1]+l.top,b[2]+l.left,b[3]+l.top],
       note='Connected-component candidate; native transparent pixel crop'))
(OUT/'symbols.json').write_text(json.dumps(records,indent=2))
print('Done',flush=True)
