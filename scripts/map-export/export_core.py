"""Export a recipe on white, or one Photoshop layer on transparency, at native resolution."""
import argparse
import json
from pathlib import Path
import sys

from PIL import Image
from psd_tools import PSDImage
from psd_tools.constants import BlendMode, ColorMode, Resource
from map_coordinates import pixel_bounds


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


def export(source, recipe_path, output, *, top_left=None, bottom_right=None, include=(), exclude=(), only_layer=None, plan=False):
    if only_layer is not None:
        require(not include and not exclude, "--only-layer cannot be combined with --include-layer or --exclude-layer.")
        # Selection is independent of the basemap recipe, including missing or
        # renamed recipe layers. Other drawable layers are deliberately omitted.
        recipe = {"layers": {only_layer: True}}
        decisions = validate_recipe(recipe)
    else:
        recipe = json.loads(Path(recipe_path).read_text(encoding="utf-8"))
        decisions = layer_choices(recipe, include, exclude)
    rect = pixel_bounds(top_left, bottom_right)
    if plan:
        print(json.dumps({"sourceRect": rect or "full Photoshop canvas", "layers": decisions,
                          "background": "transparent" if only_layer is not None else "white"}, indent=2))
        return
    require(source is not None and output is not None, "Pass --source and --output, or use --plan.")
    output = Path(output).resolve()
    require(output.name and not any(c in output.name for c in ':?#') and
            all(ord(c) >= 32 and ord(c) != 127 for c in output.name), "Choose a filename prefix without : ? # or control characters.")
    png = output.with_name(output.name + ".png")
    metadata = output.with_name(output.name + ".map.json")
    for destination in (png, metadata):
        require(not destination.exists(), f"Output already exists: {destination}; choose a new prefix.")
    document = PSDImage.open(source, max_alloc_bytes=8*1024**3)
    require(0 < document.width <= 50000 and 0 < document.height <= 50000 and document.width*document.height <= 250_000_000,
            "Source exceeds supported image dimensions (50,000 per side / 250 million pixels).")
    Image.MAX_IMAGE_PIXELS = 250_000_000
    rect = rect or [0, 0, document.width, document.height]
    require(0 <= rect[0] < rect[2] <= document.width and 0 <= rect[1] < rect[3] <= document.height,
            "Requested complete hexes extend beyond the Photoshop canvas; choose smaller bounds.")
    layers = selected_layers(document, decisions, recipe["layers"], warn_unknown=only_layer is None)
    output.parent.mkdir(parents=True, exist_ok=True)
    image = compose(rect, layers, transparent=True) if only_layer is not None else compose(rect, layers)
    manifest = {"version": 2, "image": png.name, "sourceOffset": rect[:2]}
    written = []
    try:
        # Exclusive creation protects existing files, including a concurrent export.
        # Write the manifest last; remove only files this attempt created on failure.
        with png.open("xb") as stream:
            written.append(png)
            image.save(stream, format="PNG", compress_level=6)
        with metadata.open("x", encoding="utf-8", newline="\n") as stream:
            written.append(metadata)
            stream.write(json.dumps(manifest, indent=2)+"\n")
        print(f"Exported {rect[2]-rect[0]} x {rect[3]-rect[1]} pixels\nPNG: {png}\nManifest: {metadata}")
        if only_layer is not None:
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
    parser.add_argument("--source", type=Path)
    parser.add_argument("--recipe", type=Path, default=Path(__file__).with_name("taelgar-core.recipe.json"))
    parser.add_argument("--output", type=Path, metavar="PREFIX", help="Write PREFIX.png and PREFIX.map.json; creates parent folders, never overwrites files")
    parser.add_argument("--top-left", help="First hex: 04.04, 04.04.H, 04.04.H.07, or 04.04.H.07.12")
    parser.add_argument("--bottom-right", help="Last hex, inclusive (same size as first); defaults to first hex")
    parser.add_argument("--include-layer", action="append", default=[], metavar="/GROUP/LAYER")
    parser.add_argument("--exclude-layer", action="append", default=[], metavar="/GROUP/LAYER")
    parser.add_argument("--only-layer", metavar="/GROUP/LAYER", help="Export exactly one drawable layer as transparent RGBA; ignores the recipe, preserves canvas/crop extent and writes the offset manifest")
    parser.add_argument("--plan", action="store_true", help="Print bounds and layer choices without opening Photoshop or writing files")
    args = parser.parse_args()
    try:
        export(args.source, args.recipe, args.output, top_left=args.top_left, bottom_right=args.bottom_right,
               include=args.include_layer, exclude=args.exclude_layer, only_layer=args.only_layer, plan=args.plan)
    except (ValueError, OSError) as error:
        parser.exit(1, f"Map export failed: {error}\n")
