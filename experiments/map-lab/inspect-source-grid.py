"""Extract repeatable grid-registration evidence from the audited PSB.

Writes diagnostics only; never changes source artwork or a map recipe.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from psd_tools import PSDImage
from psd_tools.api.pil_io import convert_pattern_to_pil
from psd_tools.constants import Tag
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts/map-export"))
from export_core import require, inventory
from map_coordinates import GEOMETRY

def stable_json(value):
    return json.dumps(value, indent=2)+"\n"


def inspect(source, output):
    Image.MAX_IMAGE_PIXELS = None
    psd = PSDImage.open(source, max_alloc_bytes=8*1024**3)
    patterns = psd.tagged_blocks.get_data(Tag.PATTERNS1)
    pattern = next(p for p in patterns if p.pattern_id == "fdc43107-4ac8-2e48-9fe1-bbe3621e7a6d")
    grid = dict(inventory(psd))["/hex-grid/hex-grid"].topil(apply_icc=False)
    pattern_image = convert_pattern_to_pil(pattern)
    alpha = np.array(pattern_image.getchannel("A"))
    output.mkdir(parents=True, exist_ok=True)
    checks = []
    for i, (x, y) in enumerate([(2600, 2000), (6200, 7000), (13000, 10000)]):
        sample = grid.crop((x, y, x+560, y+484))
        actual = np.array(sample.getchannel("A"))
        expected = alpha[np.arange(y, y+484)[:, None] % alpha.shape[0], np.arange(x, x+560)[None, :] % alpha.shape[1]]
        difference = np.abs(actual.astype(int)-expected.astype(int))
        checks.append({"sourceRect": [x, y, x+560, y+484], "maxAlphaDifference": int(difference.max()),
                       "matchingPixels": int((difference == 0).sum()), "totalPixels": int(difference.size)})
        white = Image.new("RGBA", sample.size, "white")
        white.alpha_composite(sample)
        # Diagnostic red regular hexes in the source frame (translation only).
        draw = ImageDraw.Draw(white)
        ox, oy = GEOMETRY["origin"]
        aq, ar = GEOMETRY["axialOrigin"]
        step, radius = 20*math.sqrt(3), 40/math.sqrt(3)
        for q in range(math.floor((x-ox)/step)+aq-2, math.ceil((x+560-ox)/step)+aq+2):
            for r in range(math.floor((y-oy)/40-(q-aq)/2)+ar-2, math.ceil((y+484-oy)/40-(q-aq)/2)+ar+2):
                cx, cy = ox+step*(q-aq)-x, oy+40*(r-ar+(q-aq)/2)-y
                points = [(cx+radius*math.cos(k*math.pi/3),cy+radius*math.sin(k*math.pi/3)) for k in range(6)]
                draw.line(points+[points[0]], fill=(185, 50, 45, 255), width=1)
        white.convert("RGB").save(output / f"registration-{i}.png")
        sample.close(); white.close()
    grid.close(); pattern_image.close()
    label_pattern=next(p for p in patterns if p.pattern_id == "39b99696-78ae-e441-9ec8-b328ca501a28")
    label_image=convert_pattern_to_pil(label_pattern)
    label_alpha=np.array(label_image.getchannel("A"))
    labels=dict(inventory(psd))["/hex-labels/text-3x3"].topil(apply_icc=False)
    label_checks=[]
    for x,y in [(0,0),(6210,7200),(12420,13440)]:
        actual=np.array(labels.crop((x,y,x+621,y+480)).getchannel("A"))
        label_checks.append({"sourceRect":[x,y,x+621,y+480],"maxAlphaDifference":int(np.abs(actual.astype(int)-label_alpha.astype(int)).max())})
    labels.close();label_image.close()
    report = {"version": 2,
              "pattern": {"id": pattern.pattern_id, "size": [int(alpha.shape[1]), int(alpha.shape[0])],
                          "nativeHexHeight": 40, "nativeColumnStep": 34.5, "regularColumnStep": 20*math.sqrt(3)},
              "phaseChecks": checks,
              "labelPattern": {"id":label_pattern.pattern_id,"size":[621,480],"phaseChecks":label_checks},
              "regularGridDifference": [{"column": q, "sourceCenterX": 16.5+34.5*q,
                                         "regularCenterX": ox+20*math.sqrt(3)*(q-aq),
                                         "deltaPixels": ox+20*math.sqrt(3)*(q-aq)-(16.5+34.5*q)} for q in [75, 180, 395]],
              "status": "Native grid and label phases verified. User chose regular geometry with the same numbering and accepted raster drift."}
    require(all(c["maxAlphaDifference"] == 0 for c in checks), "Source grid phase differs from the audited zero-offset pattern")
    require(all(c["maxAlphaDifference"] == 0 for c in label_checks), "Source label phase differs from its audited pattern")
    (output / "grid-evidence.json").write_text(stable_json(report), encoding="utf-8", newline="\n")
    print(stable_json(report))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    inspect(args.source, args.output)
