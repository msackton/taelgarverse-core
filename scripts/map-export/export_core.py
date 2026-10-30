"""Export a recipe on white, or one Photoshop layer on transparency, at native resolution."""
import argparse
import json
import math
import os
import signal
from pathlib import Path
import sys

from PIL import Image
from psd_tools import PSDImage
from psd_tools.constants import BlendMode, ColorMode, Resource
from map_coordinates import pixel_bounds
from dropbox_link import download_link


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate_recipe(recipe):
    require(isinstance(recipe, dict) and set(recipe) == {"layers"}, "Recipe must contain only a layers object.")
    layers = recipe["layers"]
    require(isinstance(layers, dict) and layers, "List each drawable layer in layers.")
    require(all(isinstance(p, str) and p.startswith("/") and not p.endswith("/") and
                all(p.split("/")[1:]) and type(v) is bool for p, v in layers.items()),
            "Layer decisions must be full /group/layer paths with true or false values.")
    return layers


def layer_choices(recipe, include=(), exclude=()):
    decisions = dict(validate_recipe(recipe))
    require(not set(include) & set(exclude), "Do not both include and exclude the same layer.")
    decisions.update(dict.fromkeys(include, True))
    decisions.update(dict.fromkeys(exclude, False))
    validate_recipe({"layers": decisions})
    return decisions


def inventory(document):
    result = []
    def visit(parent, prefix=""):
        names = set()
        for layer in parent:
            require(layer.name not in names and "/" not in layer.name,
                    f"Ambiguous layer path under {prefix or '/'}: {layer.name}")
            names.add(layer.name)
            name = prefix + "/" + layer.name
            result.append((name, layer))
            if layer.is_group():
                visit(layer, name)
    visit(document)
    return result


def validate_selected_layer(name, paths):
    # Validate the selected leaf AND its ancestors, regardless of saved visibility.
    parent = name
    while parent:
        item = paths[parent]
        require(not item.has_mask() and not item.clipping and not len(item.effects),
                f"Unsupported mask, clipping, or effect on {parent}.")
        require(item.fill_opacity == 255, f"Unsupported fill opacity on {parent}.")
        if item.is_group():
            require(item.blend_mode == BlendMode.PASS_THROUGH and item.opacity == 255 and not item.has_vector_mask(),
                    f"Unsupported group compositing on {parent}.")
        else:
            require(item.blend_mode == BlendMode.NORMAL and item.kind in {"pixel", "shape", "smartobject", "type"},
                    f"Unsupported layer kind or blending on {parent}.")
            require(item.has_pixels(), f"Missing saved layer pixels on {parent}; resave in Photoshop.")
            require(not item.has_vector_mask() or item.kind == "shape", f"Unsupported separate vector mask on {parent}.")
        parent = parent.rsplit("/", 1)[0]


def selected_layers(document, decisions, known_paths=None, *, warn_unknown=True):
    require(document.color_mode == ColorMode.RGB and document.depth == 8, "Exporter requires RGB, 8-bit source layers.")
    require(Resource.ICC_PROFILE not in document.image_resources, "ICC profiles require color conversion; export an untagged RGB source.")
    layers = inventory(document)
    paths = dict(layers)
    for name, included in decisions.items():
        require(not included or name in paths, f"Selected layer is missing: {name}")
        require(name not in paths or not paths[name].is_group(), f"Select individual drawable layers, not the group: {name}")
    selected = []
    for name, layer in layers:
        if layer.is_group():
            continue  # Groups are containers; their saved visibility is irrelevant.
        if warn_unknown and name not in (decisions if known_paths is None else known_paths):
            action = "included by CLI" if decisions.get(name, False) else "omitted"
            print(f"Warning: layer not in recipe; {action}: {name}", file=sys.stderr)
        if not decisions.get(name, False):
            continue
        selected.append((name, layer))
        validate_selected_layer(name, paths)
    return selected


def compose(rect, layers, *, transparent=False):
    left, top, right, bottom = rect
    canvas = Image.new("RGBA", (right-left, bottom-top), (0, 0, 0, 0) if transparent else "white")
    # psd-tools iterates bottom to top. Saved shape pixels already include their vector mask.
    for name, layer in layers:
        x0, y0 = max(left, layer.left), max(top, layer.top)
        x1, y1 = min(right, layer.right), min(bottom, layer.bottom)
        if x0 >= x1 or y0 >= y1:
            continue
        original = layer.topil(apply_icc=False)
        require(original is not None and original.mode in {"RGB", "RGBA"}, f"Invalid saved pixels: {name}")
        image = original.crop((x0-layer.left, y0-layer.top, x1-layer.left, y1-layer.top)).convert("RGBA")
        original.close()
        if layer.opacity != 255:
            image.putalpha(image.getchannel("A").point([(v*layer.opacity+127)//255 for v in range(256)]))
        canvas.alpha_composite(image, dest=(x0-left, y0-top))
        image.close()
        print("Composited " + name, flush=True)
    if transparent:
        return canvas
    result = canvas.convert("RGB")
    canvas.close()
    return result


def source_revision(source):
    filename = Path(source).resolve()
    stat = filename.stat()
    return {"path": str(filename), "size": stat.st_size, "mtimeNs": str(stat.st_mtime_ns)}


def check_source(source, expected):
    if expected is not None and source_revision(source) != expected:
        raise ValueError("Photoshop source changed since layer inspection; reload its layers before exporting.")


def inspect_source(source, output):
    before = source_revision(source)
    document = PSDImage.open(source, max_alloc_bytes=8*1024**3)
    require(0 < document.width <= 50000 and 0 < document.height <= 50000 and document.width*document.height <= 250_000_000,
            "Source exceeds supported image dimensions (50,000 per side / 250 million pixels).")
    selected_layers(document, {}, warn_unknown=False)  # Validate document mode/profile.
    rows, paths = [], dict(inventory(document))
    require(len(paths) <= 4096, "Photoshop source has too many layers (maximum 4096).")
    for name, layer in paths.items():
        if layer.is_group():
            continue
        reason = None
        try:
            validate_selected_layer(name, paths)
        except ValueError as error:
            reason = str(error)
        rows.append({"path": name, "visible": bool(layer.is_visible()), "supported": reason is None, "reason": reason})
    check_source(source, before)
    result = {"version": 1, "source": before, "width": document.width, "height": document.height, "layers": rows}
    with Path(output).open("x", encoding="utf-8") as stream:
        stream.write(json.dumps(result, indent=2)+"\n")
    print(f"Loaded {len(rows)} drawable layers ({document.width} x {document.height} pixels).", flush=True)
    return result


def regional_manifest(filename):
    value = json.loads(Path(filename).read_text(encoding="utf-8"))
    require(isinstance(value, dict) and value.get("version") == 1 and
            set(value) <= {"version", "name", "image", "worldBounds", "pixelSize", "fadeZoom"},
            "Expected a version 1 regional template manifest.")
    require(isinstance(value.get("name"), str) and 0 < len(value["name"].strip()) <= 120,
            "Regional template needs a name.")
    rect, size, zoom = value.get("worldBounds"), value.get("pixelSize"), value.get("fadeZoom", [0, 2])
    number = lambda n: type(n) in (int, float) and math.isfinite(n)
    require(isinstance(rect, dict) and set(rect) == {"x", "y", "width", "height"} and
            all(number(n) for n in rect.values()) and rect["x"] >= 0 and rect["y"] >= 0 and
            rect["width"] > 0 and rect["height"] > 0 and rect["x"]+rect["width"] <= 100000 and rect["y"]+rect["height"] <= 100000,
            "Invalid regional worldBounds.")
    require(isinstance(size, list) and len(size) == 2 and all(type(n) is int and 0 < n <= 16384 for n in size) and size[0]*size[1] <= 64000000,
            "Regional pixelSize exceeds 16384 per side or 64 million pixels.")
    require(math.isclose(size[0]/rect["width"], size[1]/rect["height"], rel_tol=1e-6), "Regional aspect ratio does not match worldBounds.")
    require(isinstance(zoom, list) and len(zoom) == 2 and all(number(n) and -10 <= n <= 10 for n in zoom) and zoom[0] < zoom[1],
            "Invalid regional fadeZoom.")
    return {**value, "fadeZoom": zoom}


def export(source, recipe_path, output, *, top_left=None, bottom_right=None, include=(), exclude=(), only_layer=None, regional_template=None, transparent=False, expected_source=None, plan=False):
    if only_layer is not None:
        require(not include and not exclude, "--only-layer cannot be combined with --include-layer or --exclude-layer.")
        # Selection is independent of the basemap recipe, including missing or
        # renamed recipe layers. Other drawable layers are deliberately omitted.
        recipe = {"layers": {only_layer: True}}
        decisions = validate_recipe(recipe)
    else:
        recipe = json.loads(Path(recipe_path).read_text(encoding="utf-8"))
        decisions = layer_choices(recipe, include, exclude)
    template = regional_manifest(regional_template) if regional_template is not None else None
    require(template is None or (top_left is None and bottom_right is None), "Regional templates require the full canvas; omit hex bounds.")
    rect = pixel_bounds(top_left, bottom_right)
    if plan:
        print(json.dumps({"sourceRect": rect or "full Photoshop canvas", "layers": decisions,
                          "background": "transparent" if only_layer is not None or transparent else "white", **({"regionalTemplate": template} if template else {})}, indent=2))
        return
    require(source is not None and output is not None, "Pass --source and --output, or use --plan.")
    output = Path(output).resolve()
    require(output.name and not any(c in output.name for c in ':?#') and
            all(ord(c) >= 32 and ord(c) != 127 for c in output.name), "Choose a filename prefix without : ? # or control characters.")
    png = output.with_name(output.name + ".png")
    metadata = output.with_name(output.name + (".map-detail.json" if template else ".map.json"))
    for destination in (png, metadata):
        require(not destination.exists(), f"Output already exists: {destination}; choose a new prefix.")
    check_source(source, expected_source)
    document = PSDImage.open(source, max_alloc_bytes=8*1024**3)
    require(0 < document.width <= 50000 and 0 < document.height <= 50000 and document.width*document.height <= 250_000_000,
            "Source exceeds supported image dimensions (50,000 per side / 250 million pixels).")
    if template:
        require([document.width, document.height] == template["pixelSize"], "Photoshop canvas does not match regional pixelSize; do not trim or resize the template.")
    Image.MAX_IMAGE_PIXELS = 250_000_000
    rect = rect or [0, 0, document.width, document.height]
    require(0 <= rect[0] < rect[2] <= document.width and 0 <= rect[1] < rect[3] <= document.height,
            "Requested complete hexes extend beyond the Photoshop canvas; choose smaller bounds.")
    layers = selected_layers(document, decisions, recipe["layers"], warn_unknown=only_layer is None)
    output.parent.mkdir(parents=True, exist_ok=True)
    image = compose(rect, layers, transparent=True) if only_layer is not None or transparent else compose(rect, layers)
    manifest = {**template, "image": png.name} if template else {"version": 2, "image": png.name, "sourceOffset": rect[:2]}
    written = []
    try:
        check_source(source, expected_source)
        # Exclusive creation protects existing files, including a concurrent export.
        # Write the manifest last; remove only files this attempt created on failure.
        with png.open("xb") as stream:
            written.append(png)
            image.save(stream, format="PNG", compress_level=6)
        with metadata.open("x", encoding="utf-8", newline="\n") as stream:
            written.append(metadata)
            stream.write(json.dumps(manifest, indent=2)+"\n")
        print(f"Exported {rect[2]-rect[0]} x {rect[3]-rect[1]} pixels\nPNG: {png}\nManifest: {metadata}")
        if only_layer is not None and not template:
            print(f"Transparent tracing layer: {only_layer}\nTracing X: {rect[0]}, Y: {rect[1]}, scale: 1")
        return manifest
    except BaseException:
        for destination in reversed(written):
            destination.unlink()
        raise
    finally:
        image.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    sources = parser.add_mutually_exclusive_group()
    sources.add_argument("--source", type=Path)
    sources.add_argument("--dropbox-link", help="Public HTTPS Dropbox /scl/fi/ or /s/ link to a PSD/PSB; no token required")
    sources.add_argument("--dropbox-link-env", action="store_true", help="Read shared link from TAELGAR_DROPBOX_LINK instead of process arguments")
    parser.add_argument("--cache-dir", type=Path, default=Path.home()/".cache/taelgarverse/dropbox")
    parser.add_argument("--max-download-gib", type=int, default=16)
    parser.add_argument("--inventory-json", type=Path, help="Inspect drawable layers and save a new JSON inventory instead of exporting")
    parser.add_argument("--expected-source", type=Path, help="Inventory whose source revision must still match before export")
    parser.add_argument("--transparent", action="store_true", help="Compose selected recipe layers on transparency")
    parser.add_argument("--recipe", type=Path, default=Path(__file__).with_name("taelgar-core.recipe.json"))
    parser.add_argument("--output", type=Path, metavar="PREFIX", help="Write PREFIX.png and PREFIX.map.json; creates parent folders, never overwrites files")
    parser.add_argument("--top-left", help="First hex: 04.04, 04.04.H, 04.04.H.07, or 04.04.H.07.12")
    parser.add_argument("--bottom-right", help="Last hex, inclusive (same size as first); defaults to first hex")
    parser.add_argument("--include-layer", action="append", default=[], metavar="/GROUP/LAYER")
    parser.add_argument("--exclude-layer", action="append", default=[], metavar="/GROUP/LAYER")
    parser.add_argument("--only-layer", metavar="/GROUP/LAYER", help="Export exactly one drawable layer as transparent RGBA; ignores the recipe, preserves canvas/crop extent and writes the offset manifest")
    parser.add_argument("--regional-template", type=Path, help="Preserve an editor-exported .map-detail.json footprint; requires the original full template canvas")
    parser.add_argument("--plan", action="store_true", help="Print bounds and layer choices without opening Photoshop or writing files")
    args = parser.parse_args()
    def interrupted(signum, frame):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, interrupted)
    try:
        source = args.source
        require(not (args.inventory_json and args.plan), "Use --inventory-json or --plan, not both.")
        if (args.dropbox_link or args.dropbox_link_env) and not args.plan:
            link = os.environ.get("TAELGAR_DROPBOX_LINK") if args.dropbox_link_env else args.dropbox_link
            source = download_link(link, args.cache_dir, max_bytes=args.max_download_gib*1024**3,
                                   progress=lambda message: print(message, flush=True))
        if args.inventory_json:
            require(source is not None, "Choose a local or Dropbox Photoshop file.")
            inspect_source(source, args.inventory_json)
        else:
            expected = None
            if args.expected_source:
                expected = json.loads(args.expected_source.read_text(encoding="utf-8"))["source"]
            export(source, args.recipe, args.output, top_left=args.top_left, bottom_right=args.bottom_right,
                   include=args.include_layer, exclude=args.exclude_layer, only_layer=args.only_layer,
                   regional_template=args.regional_template, transparent=args.transparent, expected_source=expected, plan=args.plan)
    except KeyboardInterrupt:
        parser.exit(130, "Map export cancelled.\n")
    except (ValueError, OSError, KeyError, TypeError) as error:
        parser.exit(1, f"Map export failed: {error}\n")
