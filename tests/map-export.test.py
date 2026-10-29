"""Small synthetic layers test composition independently of the private PSB."""
import importlib.util
from pathlib import Path
import unittest
import sys
import json
import io
import tempfile
import subprocess
from unittest.mock import patch
from contextlib import redirect_stdout, redirect_stderr
from PIL import Image
from psd_tools.constants import BlendMode, ColorMode

sys.path.insert(0, str(Path(__file__).parents[1] / "scripts/map-export"))
spec = importlib.util.spec_from_file_location("export_core", Path(__file__).parents[1] / "scripts/map-export/export_core.py")
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)
import map_coordinates as coordinates
ROOT = Path(__file__).parents[1]
RECIPE = ROOT / "scripts/map-export/taelgar-core.recipe.json"
FIXTURES = json.loads((ROOT / "tests/fixtures/map-locators.json").read_text())


class Layer:
    def __init__(self, name, color, box=(0, 0, 4, 4), opacity=255):
        self.name, self.color, self.bbox, self.opacity = name, color, box, opacity
        self.left, self.top, self.right, self.bottom = box
        self.visible = True
        self.fill_opacity = 255
        self.kind = "pixel"
        self.blend_mode = BlendMode.NORMAL
        self.clipping = False
        self.effects = []
        self.mask = False
    def is_visible(self): return self.visible
    def is_group(self): return False
    def has_mask(self): return self.mask
    def has_vector_mask(self): return False
    def has_pixels(self): return True
    def topil(self, **kwargs): return Image.new("RGBA", (self.right-self.left, self.bottom-self.top), self.color)


class Group(Layer):
    def __init__(self, name, children):
        super().__init__(name, "white")
        self.children = children
        self.blend_mode = BlendMode.PASS_THROUGH
    def is_group(self): return True
    def __iter__(self): return iter(self.children)


class Document(list):
    width, height = 4, 4
    size = (4, 4)
    color_mode = ColorMode.RGB
    depth = 8
    image_resources = {}


class ExportTests(unittest.TestCase):
    def test_inventory_supported_visibility_and_source_guard(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); source=root/'world.psd'; source.write_bytes(b'fixture')
            hidden=Layer('hidden','blue'); hidden.visible=False
            unsupported=Layer('masked','red'); unsupported.mask=True
            doc=Document([hidden,unsupported])
            with patch.object(exporter.PSDImage,'open',return_value=doc):
                result=exporter.inspect_source(source,root/'inventory.json')
                self.assertEqual(result['source'],exporter.source_revision(source))
                self.assertEqual(result['layers'][0],{'path':'/hidden','visible':False,'supported':True,'reason':None})
                self.assertFalse(result['layers'][1]['supported'])
                self.assertIn('Unsupported mask',result['layers'][1]['reason'])
                with self.assertRaises(FileExistsError):exporter.inspect_source(source,root/'inventory.json')
                source.write_bytes(b'changed source')
                with self.assertRaisesRegex(ValueError,'source changed'):exporter.export(source,None,root/'map',only_layer='/hidden',expected_source=result['source'])
                self.assertFalse((root/'map.png').exists())

    def test_transparent_recipe_and_source_change_during_composition(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=root/'world.psd';source.write_bytes(b'fixture')
            recipe=root/'recipe.json';recipe.write_text(json.dumps({'layers':{'/art':True}}))
            doc=Document([Layer('art','red',(1,1,3,3))]);expected=exporter.source_revision(source)
            with patch.object(exporter.PSDImage,'open',return_value=doc):
                exporter.export(source,recipe,root/'map',transparent=True,expected_source=expected)
                with Image.open(root/'map.png') as image:self.assertEqual(image.getpixel((0,0)),(0,0,0,0))
                compose=exporter.compose
                def changed(*args,**kwargs):
                    source.write_bytes(b'new bytes');return compose(*args,**kwargs)
                with patch.object(exporter,'compose',side_effect=changed):
                    with self.assertRaisesRegex(ValueError,'source changed'):exporter.export(source,recipe,root/'changed',expected_source=expected)
                self.assertFalse((root/'changed.png').exists())

    def test_regional_export_preserves_footprint_and_transparent_full_canvas(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            template = {"version": 1, "name": "Regional", "image": "old.png", "worldBounds": {"x": 5100, "y": 7100, "width": 0.5, "height": 0.5}, "pixelSize": [4, 4], "fadeZoom": [0, 2]}
            template_file = root / "template.map-detail.json"
            template_file.write_text(json.dumps(template))
            document = Document([Layer("art", "red", (1, 1, 3, 3))])
            with patch.object(exporter.PSDImage, "open", return_value=document):
                result = exporter.export("art.psd", None, root / "regional", only_layer="/art", regional_template=template_file)
                self.assertEqual(result, {**template, "image": "regional.png"})
                self.assertTrue((root / "regional.map-detail.json").exists())
                self.assertFalse((root / "regional.map.json").exists())
                with Image.open(root / "regional.png") as image:
                    self.assertEqual(image.size, (4, 4))
                    self.assertEqual(image.getpixel((0, 0)), (0, 0, 0, 0))
                    self.assertEqual(image.getpixel((1, 1)), (255, 0, 0, 255))
                with self.assertRaisesRegex(ValueError, "full canvas"):
                    exporter.export("art.psd", None, root / "cropped", only_layer="/art", regional_template=template_file, top_left="16.11")
                document.width = 5
                with self.assertRaisesRegex(ValueError, "does not match"):
                    exporter.export("art.psd", None, root / "resized", only_layer="/art", regional_template=template_file)
                self.assertFalse((root / "resized.png").exists())

    def test_native_crop_opacity_and_stacking(self):
        document = Document([Layer("base", "red"), Layer("cover", "blue", (1, 1, 3, 3), 128), Layer("grid", "black")])
        layers = exporter.selected_layers(document, {"/base": True, "/cover": True, "/grid": False})
        with exporter.compose([1, 1, 4, 4], layers) as image:
            self.assertEqual(image.size, (3, 3))
            self.assertEqual(image.getpixel((0, 0)), (127, 0, 128))
            self.assertEqual(image.getpixel((2, 2)), (255, 0, 0))

    def test_negative_layer_origin(self):
        layers = [("/cover", Layer("cover", "blue", (-1, -1, 2, 2)))]
        with exporter.compose([0, 0, 4, 4], layers) as image:
            self.assertEqual(image.getpixel((0, 0)), (0, 0, 255))
            self.assertEqual(image.getpixel((3, 3)), (255, 255, 255))

    def test_hidden_layers_and_ancestors_do_not_override_recipe(self):
        leaf = Layer("line", "black")
        group = Group("latitude", [leaf])
        leaf.visible = group.visible = False
        layers = exporter.selected_layers(Document([group]), {"/latitude/line": True})
        self.assertEqual([name for name, _ in layers], ["/latitude/line"])
        with exporter.compose([0, 0, 4, 4], layers) as image:
            self.assertEqual(image.getpixel((0, 0)), (0, 0, 0))
        group.opacity = 200
        with self.assertRaisesRegex(ValueError, "group compositing"):
            exporter.selected_layers(Document([group]), {"/latitude/line": True})

    def test_unknown_layers_warn_and_are_omitted_missing_selected_fails(self):
        document = Document([Layer("base", "red"), Layer("new", "black")])
        warning = io.StringIO()
        with redirect_stderr(warning):
            layers = exporter.selected_layers(document, {"/base": True, "/removed": False})
        self.assertIn("layer not in recipe; omitted: /new", warning.getvalue())
        self.assertEqual([name for name, _ in layers], ["/base"])
        warning = io.StringIO()
        with redirect_stderr(warning):
            layers = exporter.selected_layers(document, {"/base": True, "/new": True}, {"/base"})
        self.assertIn("layer not in recipe; included by CLI: /new", warning.getvalue())
        self.assertEqual(len(layers), 2)
        with self.assertRaisesRegex(ValueError, "Selected layer is missing: /typo"):
            exporter.selected_layers(document, {"/typo": True})

    def test_unsupported_pixels_and_ambiguous_paths_fail(self):
        layer = Layer("base", "red")
        layer.mask = True
        with self.assertRaisesRegex(ValueError, "Unsupported mask"):
            exporter.selected_layers(Document([layer]), {"/base": True})
        with self.assertRaisesRegex(ValueError, "Ambiguous layer path"):
            exporter.inventory(Document([Layer("same", "red"), Layer("same", "blue")]))
        with self.assertRaisesRegex(ValueError, "not the group"):
            exporter.selected_layers(Document([Group("group", [])]), {"/group": True})

    def test_generic_overrides_have_no_special_layer_rules(self):
        recipe = {"layers": {"/latitude/line": False, "/longitude/line": False, "/points-of-interest/roads": True, "/new": False}}
        actual = exporter.layer_choices(recipe, ["/latitude/line", "/longitude/line", "/new"], ["/points-of-interest/roads"])
        self.assertEqual(actual, {"/latitude/line": True, "/longitude/line": True, "/points-of-interest/roads": False, "/new": True})
        self.assertFalse(recipe["layers"]["/latitude/line"])
        with self.assertRaisesRegex(ValueError, "both include and exclude"):
            exporter.layer_choices(recipe, ["/new"], ["/new"])
        for invalid in [{"layers": {"/a": 1}}, {"layers": {"a": True}}, {"layers": {"/a": True}, "source": {}}]:
            with self.assertRaises(ValueError):
                exporter.validate_recipe(invalid)

    def test_cross_language_numbering_and_crop_fixtures(self):
        for address, axial in FIXTURES["addresses"]:
            self.assertEqual(coordinates.locator_to_axial(address), axial)
        for address, axial in FIXTURES["subhexAddresses"] + FIXTURES["hierarchyAddresses"]:
            self.assertEqual(coordinates.parse_reference(address)["axial"], axial)
        for crop in FIXTURES["crops"] + FIXTURES["subhexCrops"] + FIXTURES["hierarchyCrops"]:
            self.assertEqual(coordinates.pixel_bounds(crop["first"], crop["last"]), crop["pixels"])
        for alias, canonical in FIXTURES["aliases"]:
            self.assertEqual(coordinates.canonical_hex(alias), canonical)
            self.assertEqual(coordinates.pixel_bounds(alias), coordinates.pixel_bounds(canonical))

    def test_invalid_ranges_and_mixed_hex_scales(self):
        for path in ["", "7", "-1", "3.2", "3/2", "00000"]:
            with self.assertRaises(ValueError):
                coordinates.parse_reference("16.10.C.07/"+path)
        self.assertEqual(coordinates.canonical_hex("16.10.c7/0031"), "16.10.C.07/0031")
        with self.assertRaises(ValueError):
            coordinates.pixel_bounds("16.10.C.07/3", "16.10.C.07/32")
        for first, last in [(None,"01.01"),("0.01","01.01"),("05.09","04.09"),("04.10","04.09"),
                            ("04.04.C","04.04.D"),("04.04.H.00","04.04.H.24"),("16.10.C.07","16.10.C.07.12")]:
            with self.assertRaises(ValueError):
                coordinates.pixel_bounds(first, last)
        self.assertIsNone(coordinates.pixel_bounds())

    def test_plan_needs_no_source_or_output(self):
        output = io.StringIO()
        with redirect_stdout(output):
            exporter.export(None, RECIPE, None, top_left="04.9", bottom_right="16.11", plan=True)
        plan = json.loads(output.getvalue())
        self.assertEqual(plan["sourceRect"], [4981,1420,6275,7241])
        self.assertFalse(plan["layers"]["/latitude/lat-major/tropics"])

    def test_export_writes_only_png_and_tiny_manifest_without_rescaling(self):
        document = Document([Layer("base", "red")])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            recipe = root / "recipe.json"
            recipe.write_text(json.dumps({"layers": {"/base": True}}))
            with patch.object(exporter.PSDImage, "open", return_value=document), redirect_stdout(io.StringIO()):
                output = root / "exports/Full map.v2"
                manifest = exporter.export(root / "anything.psb", recipe, output)
                self.assertEqual(manifest, {"version": 2, "image": "Full map.v2.png", "sourceOffset": [0,0]})
                self.assertFalse(output.exists(), "The prefix is not a directory")
                self.assertEqual(sorted(p.name for p in output.parent.iterdir()), ["Full map.v2.map.json", "Full map.v2.png"])
                self.assertEqual(json.loads(Path(str(output)+".map.json").read_text()), manifest)
                with Image.open(Path(str(output)+".png")) as image:
                    self.assertEqual(image.size, (4,4))
                    self.assertEqual(image.getpixel((3,3)), (255,0,0))
                with self.assertRaisesRegex(ValueError, "already exists"):
                    exporter.export(root / "anything.psb", recipe, output)
                with patch.object(exporter, "pixel_bounds", return_value=[1,2,4,4]):
                    manifest = exporter.export(root / "anything.psb", recipe, root / "crop")
                    self.assertEqual(manifest["sourceOffset"], [1,2])
                    with Image.open(root / "crop.png") as image:
                        self.assertEqual(image.size, (3,2))
                with self.assertRaisesRegex(ValueError, "beyond the Photoshop canvas"):
                    exporter.export(root / "anything.psb", recipe, root / "bad", top_left="01.01")
                self.assertFalse((root / "bad.png").exists())
                self.assertFalse((root / "bad.map.json").exists())
                document.width, document.height = 50001, 1
                with self.assertRaisesRegex(ValueError, "supported image dimensions"):
                    exporter.export(root / "anything.psb", recipe, root / "oversize")

    def test_single_layer_transparency_preserves_extent_alpha_and_opacity(self):
        leaf = Layer("borders", (20, 40, 60, 128), (1, 1, 3, 3), 128)
        group = Group("regions", [leaf])
        leaf.visible = group.visible = False
        document = Document([Layer("base", "red"), group, Layer("unrelated", "blue")])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(exporter.PSDImage, "open", return_value=document), redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()) as warnings:
                manifest = exporter.export(root / "source.psb", root / "missing-recipe.json", root / "trace", only_layer="/regions/borders")
                self.assertEqual(manifest["sourceOffset"], [0, 0])
                with Image.open(root / "trace.png") as image:
                    self.assertEqual(image.mode, "RGBA")
                    self.assertEqual(image.size, (4, 4), "Do not trim the transparent canvas margins")
                    self.assertEqual(image.getpixel((0, 0)), (0, 0, 0, 0))
                    self.assertEqual(image.getpixel((1, 1)), (20, 40, 60, 64))
                self.assertEqual(warnings.getvalue(), "", "Unselected layers need no recipe warnings in single-layer mode")
                with patch.object(exporter, "pixel_bounds", return_value=[2, 1, 4, 4]):
                    cropped = exporter.export(root / "source.psb", None, root / "crop-trace", only_layer="/regions/borders")
                self.assertEqual(cropped["sourceOffset"], [2, 1])
                with Image.open(root / "crop-trace.png") as image:
                    self.assertEqual(image.size, (2, 3))
                    self.assertEqual(image.getpixel((0, 0)), (20, 40, 60, 64))
                    self.assertEqual(image.getpixel((1, 2))[3], 0)
                with self.assertRaisesRegex(ValueError, "already exists"):
                    exporter.export(root / "source.psb", None, root / "trace", only_layer="/regions/borders")
                leaf.mask = True
                with self.assertRaisesRegex(ValueError, "Unsupported mask"):
                    exporter.export(root / "source.psb", None, root / "masked", only_layer="/regions/borders")
                self.assertFalse((root / "masked.png").exists())

    def test_single_layer_selection_plan_and_validation(self):
        plan = subprocess.run([sys.executable, str(ROOT / "scripts/map-export/export_core.py"),
                               "--only-layer", "/regions/borders", "--recipe", "missing.json", "--plan"],
                              capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(plan.stdout), {"sourceRect": "full Photoshop canvas",
                         "layers": {"/regions/borders": True}, "background": "transparent"})
        for selected in ["", "no-slash", "/group/", "/group//leaf"]:
            with self.assertRaises(ValueError):
                exporter.export(None, None, None, only_layer=selected, plan=True)
        for overrides in [{"include": ["/extra"]}, {"exclude": ["/extra"]}]:
            with self.assertRaisesRegex(ValueError, "cannot be combined"):
                exporter.export(None, None, None, only_layer="/regions/borders", plan=True, **overrides)
        with tempfile.TemporaryDirectory() as directory:
            for selected, message in [("/missing", "Selected layer is missing"), ("/group", "not the group")]:
                with patch.object(exporter.PSDImage, "open", return_value=Document([Group("group", [])])):
                    with self.assertRaisesRegex(ValueError, message):
                        exporter.export("source.psb", None, Path(directory) / "trace", only_layer=selected)
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_cli_exports_a_real_saved_psd_layer_with_transparency(self):
        from psd_tools import PSDImage
        from psd_tools.api.layers import PixelLayer, Group as PSDGroup
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            document = PSDImage.new("RGBA", (8, 6))
            PixelLayer.frompil(Image.new("RGBA", (8, 6), "red"), document, name="base")
            group = PSDGroup.new(document, name="regions")
            group.blend_mode = BlendMode.PASS_THROUGH
            layer = PixelLayer.frompil(Image.new("RGBA", (2, 2), (20, 40, 60, 128)), group,
                                       name="borders", left=3, top=2)
            layer.opacity = 128
            group.visible = layer.visible = False
            document.save(root / "source.psd")
            inspected = subprocess.run([sys.executable, str(ROOT / "scripts/map-export/export_core.py"),
                                        "--source", str(root / "source.psd"), "--inventory-json", str(root / "inventory.json")], capture_output=True, text=True)
            self.assertEqual(inspected.returncode, 0, inspected.stderr)
            inventory = json.loads((root / "inventory.json").read_text())
            self.assertEqual([row['path'] for row in inventory['layers']], ['/base','/regions/borders'])
            self.assertFalse(inventory['layers'][1]['visible'])
            self.assertTrue(all(row['supported'] for row in inventory['layers']))
            result = subprocess.run([sys.executable, str(ROOT / "scripts/map-export/export_core.py"),
                                     "--source", str(root / "source.psd"), "--output", str(root / "trace"),
                                     "--only-layer", "/regions/borders"], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            with Image.open(root / "trace.png") as image:
                self.assertEqual(image.mode, "RGBA")
                self.assertEqual(image.size, (8, 6))
                self.assertEqual(image.getpixel((0, 0)), (0, 0, 0, 0))
                self.assertEqual(image.getpixel((3, 2)), (20, 40, 60, 64))
            self.assertEqual(json.loads((root / "trace.map.json").read_text())["sourceOffset"], [0, 0])
            self.assertIn("Tracing X: 0, Y: 0, scale: 1", result.stdout)

    def test_transparent_export_cleans_up_failed_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(exporter.PSDImage, "open", return_value=Document([Layer("line", "black")])), redirect_stdout(io.StringIO()):
                with patch.object(Image.Image, "save", side_effect=OSError("disk full")):
                    with self.assertRaisesRegex(OSError, "disk full"):
                        exporter.export("source.psb", None, root / "trace", only_layer="/line")
                self.assertEqual(list(root.iterdir()), [])

    def test_either_existing_output_is_preserved_before_reading_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for suffix in (".png", ".map.json"):
                existing = root / ("map"+suffix)
                existing.write_bytes(b"keep this file")
                with patch.object(exporter.PSDImage, "open") as opened:
                    with self.assertRaisesRegex(ValueError, "Output already exists"):
                        exporter.export(root / "source.psb", RECIPE, root / "map")
                    opened.assert_not_called()
                self.assertEqual(existing.read_bytes(), b"keep this file")
                self.assertEqual(list(root.iterdir()), [existing])
                existing.unlink()

    def test_failed_writes_remove_only_files_created_by_this_export(self):
        document = Document([Layer("base", "red")])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            recipe = root / "recipe.json"
            recipe.write_text(json.dumps({"layers": {"/base": True}}))
            with patch.object(exporter.PSDImage, "open", return_value=document), redirect_stdout(io.StringIO()):
                with patch.object(Image.Image, "save", side_effect=OSError("disk full")):
                    with self.assertRaisesRegex(OSError, "disk full"):
                        exporter.export(root / "source.psb", recipe, root / "map")
                self.assertFalse((root / "map.png").exists())
                self.assertFalse((root / "map.map.json").exists())
                # Another writer creates the manifest after the initial checks.
                def competing_manifest(rect, layers):
                    (root / "map.map.json").write_text("other writer")
                    return Image.new("RGB", (4,4), "red")
                with patch.object(exporter, "compose", side_effect=competing_manifest):
                    with self.assertRaises(FileExistsError):
                        exporter.export(root / "source.psb", recipe, root / "map")
                self.assertFalse((root / "map.png").exists())
                self.assertEqual((root / "map.map.json").read_text(), "other writer")


if __name__ == "__main__":
    unittest.main()
