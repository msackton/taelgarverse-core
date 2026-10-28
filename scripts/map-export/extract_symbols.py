"""Extract reviewed location symbols as unchanged transparent Photoshop pixels.

This asset-building tool is independent of map export recipes and saved layer
visibility. Coordinates below identify clean examples in the Taelgar source.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path

from psd_tools import PSDImage

SYMBOLS = {
    "square": (5196, 6867, 5223, 6896),
    "open-square": (9209, 4400, 9232, 4423),
    "diagonal-square": (6868, 4789, 6911, 4832),
    "crossed-square": (6489, 8662, 6532, 8705),
    "dot": (5595, 6900, 5620, 6926),
    "triangle": (4444, 4304, 4464, 4325),
    "gate": (8865, 4380, 8885, 4396),
}


def extract(source, output, module):
    source, output, module = Path(source), Path(output), Path(module)
    document = PSDImage.open(source, max_alloc_bytes=8*1024**3)
    layer = next(child for group in document if group.name == "points-of-interest"
                 for child in group if child.name == "locations")
    if document.size != (14400, 14400) or layer.kind != "pixel" or layer.opacity != 255 or layer.has_mask() or len(layer.effects):
        raise ValueError("Expected the reviewed 14400-square source and unmodified locations pixel layer")
    pixels = layer.topil(apply_icc=False)
    if pixels.mode != "RGBA":
        raise ValueError("Expected native transparent RGBA pixels")
    output.mkdir(parents=True, exist_ok=True)
    module.parent.mkdir(parents=True, exist_ok=True)
    runtime, records = {}, {}
    for name, box in SYMBOLS.items():
        crop = pixels.crop((box[0]-layer.left, box[1]-layer.top, box[2]-layer.left, box[3]-layer.top))
        low, high = crop.getchannel("A").getextrema()
        if low > 8 or high < 200:
            raise ValueError(f"Symbol {name} no longer has the expected transparent edges and ink")
        target = output/(name+".png")
        crop.save(target, format="PNG", optimize=True)
        data = target.read_bytes()
        runtime[name] = {"image": "data:image/png;base64,"+base64.b64encode(data).decode("ascii"), "width": crop.width, "height": crop.height}
        records[name] = {"image": target.name, "sourceRect": box, "size": crop.size, "sha256": hashlib.sha256(data).hexdigest()}
        crop.close()
    pixels.close()
    with source.open("rb") as stream:
        source_hash = hashlib.file_digest(stream, "sha256").hexdigest()
    provenance = {"source": source.name, "sourceSha256": source_hash, "sourceSize": document.size,
                  "layer": "/points-of-interest/locations", "symbols": records}
    (output/"source.json").write_text(json.dumps(provenance, indent=2)+"\n", encoding="utf-8")
    module.write_text(json.dumps(runtime, indent=2)+"\n", encoding="utf-8")
    print(f"Extracted {len(records)} native transparent symbols to {output}; embedded assets: {module}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", type=Path, default=Path("public/images/map-symbols"))
    parser.add_argument("--module", type=Path, default=Path("src/map-symbols.json"))
    args = parser.parse_args()
    extract(args.source, args.output, args.module)
