"""Build a cartographic proof from digitized reference features and PSB symbols.

Geometry is manually sampled from Aveil.jpg, not inferred world geography.
The SVG is the editable composition; JSON records coordinates and provenance.
"""
from pathlib import Path
import os
from urllib.parse import quote
import base64, json, html, math, random
import numpy as np
from PIL import Image
import cairosvg

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'exports'
VAULT=Path(os.environ["TAELGAR_VAULT"]).expanduser().resolve()
def uri(path):
    mime='image/jpeg' if str(path).endswith('.jpg') else 'image/png'
    return 'data:'+mime+';base64,'+base64.b64encode(Path(path).read_bytes()).decode()
def image(path,x,y,w,h):
    return f'<image x="{x}" y="{y}" width="{w}" height="{h}" href="{uri(path)}"/>'
def text(x,y,s,size=22,extra=''):
    label=f'<text x="{x}" y="{y}" font-size="{size}" {extra}>{html.escape(s)}</text>'
    if 'class="label"' in extra:
        label += f'<text x="{x}" y="{y}" font-size="{size}" stroke="none">{html.escape(s)}</text>'
    return label
def points(ps): return ' '.join(f'{x},{y}' for x,y in ps)
def link(name):
    files=list((VAULT/'Gazetteer').rglob(name+'.md'))
    if len(files)!=1: raise ValueError((name,files))
    note=str(files[0].relative_to(VAULT))
    return note, 'obsidian://open?vault=taelgar&file='+quote(note,safe='')

# Coordinates below refer to a 1125 x 1800 display of the 1280 x 2048 reference.
# They are provisional manual samples, with roughly 5–15 reference-pixel precision.
towns=[('Veltor',590,240),('Aslain',836,811),('Peydon',894,995),
       ('Rinburg',963,1209),('Essenmer',716,1340),('Eftly',580,1415),
       ('Champimont',483,1459),('Dallet',317,1536),('Beury',146,1675),
       ('Cleenseau',35,1676)]
rivers={
 'Auberonne':[(490,82),(510,110),(554,127),(590,159),(617,190),(639,226),(642,270),(621,317),(614,370),(616,425),(628,479),(659,535),(681,588),(700,642),(736,676),(756,719),(780,763),(791,800),(797,839),(812,901),(849,969),(862,1006),(859,1049),(827,1110),(800,1168),(794,1220),(798,1259)],
 'Auberonne tributary':[(839,0),(872,45),(939,85),(974,112),(965,151),(940,202),(889,245),(838,277),(803,326),(768,379),(747,432),(729,465),(687,492),(674,514),(659,535)],
 'Leandre':[(201,503),(227,553),(271,590),(333,629),(399,652),(449,675),(497,691),(545,718),(584,743),(647,764),(693,778),(740,795),(779,814),(797,839)],
 'Leandre tributary':[(61,1067),(37,1008),(28,943),(42,909),(89,872),(150,843),(195,821),(253,817),(300,806),(361,781),(399,745),(442,723),(502,709)],
 'Maudor Brook':[(389,999),(426,1007),(474,992),(530,1005),(565,1035),(636,1047),(695,1064),(737,1088),(779,1124),(800,1168)],
 'Enst':[(0,1707),(68,1704),(139,1696),(192,1688),(238,1649),(270,1610),(310,1587),(355,1555),(400,1512),(430,1480),(475,1474),(531,1474),(597,1468),(660,1455),(688,1437),(717,1397),(748,1371),(769,1332),(801,1310),(860,1297),(911,1289),(945,1256),(991,1243),(1057,1218),(1125,1189)]
}
rivers['Auberonne'].append((798,1273))
rivers['Leandre tributary'].append((515,701))
lake=[(765,1314),(774,1291),(798,1273),(827,1283),(849,1293),(888,1290),(919,1274),(963,1257),(951,1298),(922,1323),(901,1357),(877,1386),(839,1391),(809,1382),(787,1364),(764,1350)]
woods=[[(0,0),(105,0),(121,112),(236,204),(286,297),(248,370),(196,452),(222,514),(161,623),(181,740),(158,831),(70,900),(66,998),(153,1097),(160,1242),(191,1371),(267,1511),(234,1606),(180,1651),(0,1646)],
       [(323,329),(429,306),(564,321),(557,400),(507,452),(409,460),(321,426)],
       [(828,468),(914,360),(1042,330),(1125,404),(1125,669),(982,624),(924,569)],
       [(493,854),(590,801),(680,852),(691,934),(624,975),(527,969)]]

# These are native transparent crops; no tracing or generated replacements.
Image.open(OUT/'forest.png').crop((68,20,115,83)).save(OUT/'tree-cluster.png')
Image.open(OUT/'topography.png').crop((119,63,237,105)).save(OUT/'hill-cluster.png')

def inside(x,y,poly):
    hit=False
    for (a,b),(c,d) in zip(poly,poly[1:]+poly[:1]):
        if (b>y)!=(d>y) and x<(c-a)*(y-b)/(d-b)+a: hit=not hit
    return hit

def line_distance(x,y,segments):
    best=float('inf')
    for (ax,ay),(bx,by) in segments:
        dx,dy=bx-ax,by-ay
        t=max(0,min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy or 1)))
        best=min(best,math.hypot(x-ax-t*dx,y-ay-t*dy))
    return best

# Nine freshly drawn groves. SVG viewBoxes select atlas regions without
# modifying the generated image. Irregular sampling replaces the old lattice.
grove_boxes=[(15,15,395,395),(440,10,370,390),(845,20,395,385),
             (10,435,430,370),(450,425,365,390),(845,425,395,385),
             (15,830,395,410),(435,865,385,330),(845,805,395,430)]
grove_defs=f'<image id="grove-sheet" width="1254" height="1254" href="{uri(OUT/"forest-groves.png")}"/>'
grove_defs+=''.join(f'<symbol id="grove-{i}" viewBox="{x} {y} {w} {h}"><use href="#grove-sheet"/></symbol>' for i,(x,y,w,h) in enumerate(grove_boxes))
river_segments=[(a,b) for ps in rivers.values() for a,b in zip(ps,ps[1:])]
rng=random.Random(74021)
placements=[]
for region,poly in enumerate(woods):
    edges=list(zip(poly,poly[1:]+poly[:1]))
    lo_x,hi_x=min(x for x,y in poly),max(x for x,y in poly)
    lo_y,hi_y=min(y for x,y in poly),max(y for x,y in poly)
    accepted=[]
    for attempt in range(5500):
        x,y=rng.uniform(lo_x,hi_x),rng.uniform(lo_y,hi_y)
        if not inside(x,y,poly):continue
        edge=line_distance(x,y,edges)
        size=rng.uniform(49,79) if edge<45 else rng.uniform(65,98)
        if edge<size*.26:continue
        if any(math.hypot(x-a,y-b)<(size+s)*.25 for a,b,s in accepted):continue
        if any(math.hypot(x-a,y-b)<size*.4+22 for _,a,b in towns):continue
        if line_distance(x,y,river_segments)<size*.3+5:continue
        # Mild variation in density leaves small openings within large woods.
        if math.sin(x*.029+y*.013)+math.cos(y*.037-x*.01)>1.7:continue
        accepted.append((x,y,size))
        placements.append(dict(region=region,x=round(x,2),y=round(y,2),size=round(size,2),grove=rng.randrange(9)))
placements.sort(key=lambda p:p['y']+p['size']/2)
(OUT/'forest-placement.json').write_text(json.dumps(dict(seed=74021,asset='forest-groves.png',source='New image-generated pen-and-ink assets; not original PSB pixels',placements=placements),indent=2))

parts=['<svg xmlns="http://www.w3.org/2000/svg" width="1125" height="1800" viewBox="0 0 1125 1800">',
       '<style>text{font-family:Georgia,serif;fill:#343735}a:hover text{fill:#9b2929}a:hover circle{fill:#9b2929}.label{paint-order:stroke;stroke:#faf9f5;stroke-width:6px;stroke-linejoin:round}</style>',
       '<rect width="1125" height="1800" fill="#faf9f5"/>',
       '<defs>'+grove_defs+'</defs>']
for p in placements:
    x,y,s,i=p['x'],p['y'],p['size'],p['grove']
    parts.append(f'<use href="#grove-{i}" x="{x-s/2}" y="{y-s/2}" width="{s}" height="{s}"/>')
# Placement follows the regional reference; individual stamps are illustrative.
for x,y,w in [(260,105,170),(400,70,190),(565,99,170),(725,75,190),(890,95,170),
              (277,980,150),(383,1003,160),(252,1069,170),(348,1108,180),(290,1170,190)]:
    parts.append(image(OUT/'hill-cluster.png',x,y,w,w*42/118))
parts.append('<polygon points="'+points(lake)+'" fill="#818fae"/>')
for name,ps in rivers.items():
    parts.append(f'<polyline points="{points(ps)}" fill="none" stroke="#475c8b" stroke-width="{4 if name in ["Auberonne","Enst"] else 2.7}" stroke-linejoin="round" stroke-linecap="round"><title>{name}: approximate trace of Aveil.jpg</title></polyline>')
parts.append('<polyline points="600,250 632,290 635,410 654,492 704,590 720,654 771,751 811,829 834,900 875,980 879,1041 839,1137 816,1213 811,1250" fill="none" stroke="#ab9777" stroke-width="3" stroke-dasharray="8 6"><title>Old Veltor Road: approximate reference trace</title></polyline>')
for name,x,y in [('AVEIL RIDGE',665,55),('CLEENSEAU WOOD',34,600),('MAUDOR HILLS',256,1250),('Auberonne',730,655),('Leandre',302,682),('Lake Rin',815,1430)]:
    parts.append(text(x,y,name,22,'class="label"'))
records=[]
for name,x,y in towns:
    note,url=link(name)
    records.append(dict(name=name,reference_xy=[round(x*1280/1125,2),round(y*2048/1800,2)],
                        reference_image='assets/Aveil.jpg',note=note,uri=url,
                        world_xy=None,status='provisional manual digitization; world registration unresolved'))
    dx,dy=(14,-14)
    if name=='Rinburg':dx,dy=-100,-26
    if name=='Cleenseau':dx,dy=0,-30
    if name=='Beury':dx,dy=14,30
    parts.append(f'<a href="{html.escape(url,quote=True)}"><title>{name}: open vault note; position digitized from regional reference</title><circle cx="{x}" cy="{y}" r="7" fill="#7d292e" stroke="#faf9f5" stroke-width="2"/>'+text(x+dx,y+dy,name,25,'class="label"')+'</a>')
parts += [text(480,1740,'AVEIL · CARTOGRAPHIC STUDY',26),text(480,1772,'Reference geometry · revised woodland artwork · provisional',15),'</svg>']
svg=''.join(parts)
(OUT/'aveil-study.svg').write_text(svg)
cairosvg.svg2png(bytestring=svg.encode(),write_to=str(OUT/'aveil-study.png'))
(OUT/'places.json').write_text(json.dumps(records,indent=2))
(OUT/'reference-features.json').write_text(json.dumps(dict(coordinate_system=dict(width=1125,height=1800,source_width=1280,source_height=2048),rivers=rivers,lake=lake,woodland_approximate_envelopes=woods,status='manual reference digitization, not authoritative world geometry'),indent=2))

# A world-aligned source composition with individually extracted PSB layers.
context=['<svg xmlns="http://www.w3.org/2000/svg" width="1350" height="1170" viewBox="0 0 450 390"><rect width="450" height="390" fill="#faf9f5"/>']
for n in ['topography','forest','plains','swamp','rivers_old','rivers','lakes','roads','locations']:
    context.append(image(OUT/(n+'.png'),0,0,450,390))
context.append('</svg>')
(OUT/'psb-region.svg').write_text(''.join(context))
cairosvg.svg2png(bytestring=''.join(context).encode(),write_to=str(OUT/'psb-region.png'))

# Registration diagnostic: use two town icons, then check an independent confluence.
r1=np.array([35.,1676.]);r2=np.array([963.,1209.])
w1=np.array([3641.,3768.]);w2=np.array([3730.,3698.])
z=complex(*(w2-w1))/complex(*(r2-r1));M=np.array([[z.real,-z.imag],[z.imag,z.real]]);b=w1-M@r1
pred=M@np.array([797.,839.])+b
observed=np.array([3669.,3655.])
diagnostic=dict(status='REJECTED for seamless overlay: independent hydrology mismatch',
   controls=[dict(name='Cleenseau',reference_display=r1.tolist(),world=w1.tolist()),dict(name='Rinburg',reference_display=r2.tolist(),world=w2.tolist())],
   method='Two-point similarity fit using approximate town icon centers; exploratory only',
   reference_display_to_world=np.column_stack([M,b]).tolist(),
   check=dict(feature='Leandre-Auberonne confluence',predicted_world=pred.tolist(),observed_world=observed.tolist(),error_world_pixels=float(np.linalg.norm(pred-observed))))
(OUT/'reference-registration-diagnostic.json').write_text(json.dumps(diagnostic,indent=2))

# Review sheet: compositions remain separate so differences are visible.
sheet=['<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1170" viewBox="0 0 1800 1170"><rect width="1800" height="1170" fill="#f2f0e9"/><style>text{font-family:Georgia,serif;fill:#303b38}</style>',
 text(40,53,'AVEIL / FIRST MAPPING PROOF',30),text(40,86,'Extract the source. Preserve provenance. Review alignment before zoom integration.',18),
 text(40,135,'01  PSB source layers',23),image(OUT/'psb-region.png',40,160,540,468),
 text(40,670,'World / PSB alignment',22),text(40,704,'2,297 matched features · 1.25 px median residual',17),
 text(40,755,'Regional registration remains provisional.',18),text(40,786,'A two-town fit misses a river junction by ~36 px.',17),
 text(40,855,'Terrain samples, extracted from the PSB',20),image(OUT/'tree-cluster.png',55,885,94,126),image(OUT/'hill-cluster.png',205,915,236,84),
 text(40,1090,'Source geography and proposed regional styling',17),text(40,1117,'are saved separately with coordinates and vault links.',17),
 text(625,135,'02  Existing regional reference',23),image(VAULT/'assets/Aveil.jpg',625,160,540,864),
 text(625,1065,'Town positions and waterways sampled from this map.',17),
 text(1210,135,'03  Editable style study',23),image(OUT/'aveil-study.png',1210,160,540,864),
 text(1210,1065,'New forest assets + PSB hills + linked labels.',17),text(1210,1094,'Draft placement; no invented settlements.',17),'</svg>']
(OUT/'review.svg').write_text(''.join(sheet))
cairosvg.svg2png(bytestring=''.join(sheet).encode(),write_to=str(OUT/'review.png'))
print('Built editable study, source composition, review sheet, place data and registration diagnostic.')
