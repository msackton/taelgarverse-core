"""Trace one complete river network from the registered Photoshop raster.
Run: PYTHONPATH=/tmp/map-tools:/tmp/psd-tools python trace_rivers.py
Input rivers.png is the original rivers layer registered to crop.json's frame.
No bridges, missing tributaries or flow directions are invented.
"""
from pathlib import Path
import json, heapq, math
import numpy as np
import cv2
from scipy.ndimage import gaussian_filter1d
from PIL import Image, ImageDraw
Image.MAX_IMAGE_PIXELS=None
ROOT=Path(__file__).resolve().parent
OUT=ROOT.parent/'progressive-map'
box=json.loads((ROOT/'crop.json').read_text())['world_bbox']
rgba=np.array(Image.open(ROOT/'rivers.png'))
mask=(rgba[:,:,3]>70).astype('uint8')
_,components=cv2.connectedComponents(mask,connectivity=8)
# Chosen mouth, visible on the original map on the western shore of the bay.
seed=(4206-box[0],3366-box[1])
ys,xs=np.nonzero(mask)
j=np.argmin((xs-seed[0])**2+(ys-seed[1])**2)
component=int(components[ys[j],xs[j]])
a=(components==component).astype('uint8')
# Zhang-Suen thinning, retaining connectivity and endpoints.
while True:
    removed=0
    for phase in (0,1):
        p=np.pad(a,1)
        ns=[p[:-2,1:-1],p[:-2,2:],p[1:-1,2:],p[2:,2:],p[2:,1:-1],p[2:,:-2],p[1:-1,:-2],p[:-2,:-2]]
        count=sum(ns)
        turns=sum(((ns[i]==0)&(ns[(i+1)%8]==1)).astype('uint8') for i in range(8))
        n,e,s,w=ns[0],ns[2],ns[4],ns[6]
        cond=(n*e*s==0)&(e*s*w==0) if phase==0 else (n*e*w==0)&(n*s*w==0)
        remove=(a==1)&(count>=2)&(count<=6)&(turns==1)&cond
        removed+=int(remove.sum());a[remove]=0
    if not removed:break
pixels=set(zip(*np.nonzero(a)))
def neighbors(p):
    y,x=p
    for dy,dx in ((-1,0),(1,0),(0,-1),(0,1),(-1,-1),(-1,1),(1,-1),(1,1)):
        q=(y+dy,x+dx)
        if q not in pixels:continue
        # Orthogonal adjacency takes precedence, avoiding pixel-corner triangles.
        if dy and dx and ((y,x+dx) in pixels or (y+dy,x) in pixels):continue
        yield q
endpoints=[p for p in pixels if len(list(neighbors(p)))==1]
root=min(endpoints,key=lambda p:(p[1]-seed[0])**2+(p[0]-seed[1])**2)
dist={root:0};parent={root:None};queue=[(0,root)]
while queue:
    cost,p=heapq.heappop(queue)
    if cost!=dist[p]:continue
    for q in neighbors(p):
        new=cost+math.dist(p,q)
        if new<dist.get(q,math.inf):
            dist[q]=new;parent[q]=p;heapq.heappush(queue,(new,q))
children={p:[] for p in parent}
for p,pa in parent.items():
    if pa is not None:children[pa].append(p)
heights={}
for p in sorted(dist,key=dist.get,reverse=True):
    heights[p]=max((heights[q]+math.dist(p,q) for q in children[p]),default=0)
raw=[]
def follow(start,first,depth):
    path=[start];p=first;offshoots=[]
    while True:
        path.append(p)
        if not children[p]:break
        best=max(children[p],key=lambda q:heights[q]+math.dist(p,q))
        offshoots.extend((p,q,depth+1) for q in children[p] if q!=best)
        p=best
    length=sum(math.dist(a,b) for a,b in zip(path,path[1:]))
    if length>=8:
        raw.append((path,depth,length))
        for args in offshoots:follow(*args)
follow(root,children[root][0],0)
junctions={path[0] for path,_,_ in raw}
features=[]
for i,(path,depth,length) in enumerate(raw):
    coords=np.array([[p[1]+box[0]+.5,p[0]+box[1]+.5] for p in path],dtype=float)
    # Split at every confluence before smoothing/simplification, so both paths
    # retain exactly the same junction coordinate in the final browser curves.
    breaks=sorted({0,len(path)-1}|{j for j,p in enumerate(path) if p in junctions})
    segments=[]
    for start,end in zip(breaks,breaks[1:]):
        segment=coords[start:end+1]
        smoothed=gaussian_filter1d(segment,1.0,axis=0,mode='nearest')
        smoothed[0]=segment[0];smoothed[-1]=segment[-1]
        line=cv2.approxPolyDP(smoothed.astype('float32').reshape(-1,1,2),.65,False).reshape(-1,2)
        segments.extend(line if not segments else line[1:])
    simplified=np.array(segments)
    rank=0 if depth==0 else min(3,max(depth,2 if length<90 else 1))
    name='Traced main river' if i==0 else f'Traced tributary {i}'
    features.append(dict(id=f'psb-river-{i}',name=name,rank=rank,points=np.round(simplified,2).tolist(),
        source='taelgar-basemap.psb / rivers',description='Traced from the original Photoshop river pixels. Descriptive demo label; the river’s canonical name has not been assigned. Visibility rank is a display choice.',lengthPixels=round(length,1)))
yy,xx=np.nonzero(components==component)
bounds=[int(xx.min()+box[0]-12),int(yy.min()+box[1]-12),int(xx.max()+box[0]+13),int(yy.max()+box[1]+13)]
# Include antialias fringe around the selected component only.
selection=cv2.dilate((components==component).astype('uint8'),np.ones((3,3),np.uint8))
source=rgba.copy();source[:,:,3]*=selection
im=Image.fromarray(source).crop((bounds[0]-box[0],bounds[1]-box[1],bounds[2]-box[0],bounds[3]-box[1]))
im.save(OUT/'river-source.png')
junction=features[1]['points'][0] if len(features)>1 else features[0]['points'][len(features[0]['points'])//2]
meta=dict(source='/MapV3/base/taelgar-basemap.psb',layer='rivers',sourceIsRaster=True,
  worldToPsb=json.loads((ROOT.parent/'aveil/exports/registration.json').read_text())['world_to_psb'],
  sourceBounds=bounds,riverFocus=junction,featureCount=len(features),
  method='Registered raster alpha >70; connected component at mouth; Zhang-Suen centerline; connected graph; longest upstream path for display hierarchy; Gaussian sigma 1 pixel; RDP tolerance 0.65 pixel; endpoint coordinates preserved.',
  limitations=['Approximate centerline trace, not original Photoshop vector geometry.','Ranks are illustrative cartographic choices, not surveyed hydrological importance.','Only detail already present in the river layer is recovered.','Canonical river names are not assigned.','Other river systems and the separate lakes layer are outside this extraction.'])
(OUT/'river-provenance.json').write_text(json.dumps(meta,indent=2))
(OUT/'rivers.js').write_text('/* Original river courses, traced from Photoshop; see river-provenance.json. */\nwindow.tracedRivers='+json.dumps({'rivers':features,'metadata':meta},separators=(',',':'))+';\n')
# Authoring contact sheet: source stroke next to smooth vector-centerline preview.
terrain=Image.open(OUT/'terrain.png').convert('RGBA').crop(tuple(bounds))
sourceView=terrain.copy();sourceView.alpha_composite(im)
vectorView=terrain.copy();draw=ImageDraw.Draw(vectorView)
colors=['#355e84','#4d7890','#6d94ac','#93acba']
for f in features:
    pts=[(x-bounds[0],y-bounds[1]) for x,y in f['points']]
    draw.line(pts,fill=colors[f['rank']],width=max(2,4-f['rank']))
contact=Image.new('RGB',(terrain.width*2,terrain.height+40),'#f8f6ef');contact.paste(sourceView,(0,40));contact.paste(vectorView,(terrain.width,40))
draw=ImageDraw.Draw(contact);draw.text((12,12),'Original Photoshop river layer',fill='black');draw.text((terrain.width+12,12),'Traced centerlines, with zoom ranks',fill='black')
contact.save(ROOT/'river-comparison.png')
print(json.dumps({'features':len(features),'ranks':[f['rank'] for f in features],'points':[len(f['points']) for f in features],'bounds':bounds,'focus':junction,'rootWorld':[int(root[1]+box[0]),int(root[0]+box[1])]}))
