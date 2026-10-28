"""The flat global grid and its slash hierarchy/export contract.

Kept equivalent to src/map-locators.mjs, with shared cross-language fixtures.
"""
import json
from pathlib import Path
import math
import re

GEOMETRY = json.loads((Path(__file__).resolve().parents[2] / "src/map-geometry.json").read_text())
BLOCK_WIDTH = 18*GEOMETRY["hexPixels"]/2*math.sqrt(3)
BLOCK_HEIGHT = 12*GEOMETRY["hexPixels"]
SUBHEX_OFFSETS = GEOMETRY["subhexOffsets"]
MAX_HEX_DEPTH = 4
MATRICES = (((3, 1), (-1, 2)), ((2, -1), (1, 3)))
CHILD_OFFSETS = ((0, 0), (0, -1), (1, -1), (1, 0), (0, 1), (-1, 1), (-1, 0))


def refine_axial(axial, path):
    if not isinstance(path, str) or not re.fullmatch(r"[0-6]{0,4}", path):
        raise ValueError("Hex path must contain 0-4 digits, each 0-6")
    for depth, digit in enumerate(path, 1):
        matrix, offset = MATRICES[depth % 2], CHILD_OFFSETS[int(digit)]
        axial = [sum(a*b for a, b in zip(row, axial))+delta for row, delta in zip(matrix, offset)]
    return axial


def parse_block(value):
    match = re.fullmatch(r"(\d{1,6})\.(\d{1,6})", value.strip()) if isinstance(value, str) else None
    if not match or int(match[1]) < 1 or int(match[2]) < 1:
        raise ValueError("Block must be row.column, starting at 01.01")
    return int(match[1]), int(match[2])


def locator_to_axial(value):
    row, column, section, number = parse_hex(value)
    q = (column-1)*18+(section//3)*6+(number-1)//4
    offset_row = (row-1)*12+(section % 3)*4+(number-1) % 4
    return [q, offset_row-math.ceil(q/2)]


def parse_hex(value):
    match = re.fullmatch(r"([0-9]{1,6})\.([0-9]{1,6})(?:\.([A-I])(?:\.?([0-9]{1,2}))?)?", value.strip(), re.I) if isinstance(value, str) else None
    if not match:
        raise ValueError("Hex must be row.column[.letter[.number]], for example 16.11.A.01")
    row, column = parse_block(match[1]+"."+match[2])
    section, number = ord((match[3] or "A").upper())-65, int(match[4] or "1")
    if not 1 <= number <= 24:
        raise ValueError("Hex number must be 01-24")
    return row, column, section, number


def canonical_hex(value):
    if isinstance(value, str) and "/" in value:
        return parse_reference(value)["canonical"]
    if isinstance(value, str) and re.search(r"\.[A-Za-z]\.?\d+\.\d+$", value.strip()):
        return parse_reference(value)["canonical"]
    row, column, section, number = parse_hex(value)
    return f"{row:02d}.{column:02d}.{chr(65+section)}.{number:02d}"


def parse_reference(value):
    if isinstance(value, str) and "/" in value:
        parts = value.strip().split("/")
        if len(parts) != 2 or not parts[1]:
            raise ValueError("Hex reference needs one slash followed by digits 0-6")
        base, path = parts
        # Base must be a 24-mile reference, not another fine-cell format.
        axial = refine_axial(locator_to_axial(base), path)
        depth = len(path)
        return {"axial": axial, "depth": depth, "rotation": -math.atan(math.sqrt(3)/5) if depth % 2 else 0,
                "hexPixels": GEOMETRY["hexPixels"]/7**(depth/2), "hexMiles": GEOMETRY["hexMiles"]/7**(depth/2),
                "canonical": canonical_hex(base)+"/"+path}
    # Retain the old 6-mile addresses for existing export commands only.
    if isinstance(value, str) and re.search(r"\.[A-Za-z]\.?\d+\.\d+$", value.strip()):
        match = re.fullmatch(r"([0-9]{1,6}\.[0-9]{1,6}\.[A-I]\.?[0-9]{1,2})\.([0-9]{1,2})", value.strip(), re.I)
        if not match or not 1 <= int(match[2]) <= 16:
            raise ValueError("Small hex must be a full 24-mile reference followed by .01-.16, for example 16.10.C.07.12")
        parent, number = canonical_hex(match[1]), int(match[2])
        axial = [4*v+offset for v, offset in zip(locator_to_axial(parent), SUBHEX_OFFSETS[number-1])]
        return {"axial": axial, "hexPixels": GEOMETRY["hexPixels"]/GEOMETRY["subhexDivisions"], "hexMiles": GEOMETRY["hexMiles"]/GEOMETRY["subhexDivisions"], "canonical": f"{parent}.{number:02d}"}
    return {"axial": locator_to_axial(value), "hexPixels": GEOMETRY["hexPixels"], "hexMiles": GEOMETRY["hexMiles"], "canonical": canonical_hex(value)}


def hex_range_bounds(top_left, bottom_right, origin=GEOMETRY["origin"], axial_origin=GEOMETRY["axialOrigin"]):
    first, last = parse_reference(top_left), parse_reference(bottom_right)
    if first.get("depth", 0) > 0 or last.get("depth", 0) > 0:
        if first.get("depth") != last.get("depth"):
            raise ValueError("Use two hex references at the same subdivision depth for an export")
        depth, rotation, pixels = first["depth"], first["rotation"], first["hexPixels"]
        anchor = refine_axial(axial_origin, "0"*depth)

        def center(cell):
            q, r = [v-a for v, a in zip(cell["axial"], anchor)]
            x, y = math.sqrt(3)*pixels*q/2, pixels*(r+q/2)
            return [origin[0]+x*math.cos(rotation)-y*math.sin(rotation), origin[1]+x*math.sin(rotation)+y*math.cos(rotation)]

        a, b = center(first), center(last)
        if b[0] < a[0]-1e-8 or b[1] < a[1]-1e-8:
            raise ValueError("Bottom-right hex center must be below and right of the top-left hex center")
        radius = pixels/math.sqrt(3)
        angles = [i*math.pi/3+rotation for i in range(6)]
        dx, dy = radius*max(map(math.cos, angles)), radius*max(map(math.sin, angles))
        return [a[0]-dx, a[1]-dy, max(a[0], b[0])+dx, max(a[1], b[1])+dy]
    if first["hexMiles"] != last["hexMiles"]:
        raise ValueError("Use two 24-mile references or two 6-mile references for an export")
    (q0, r0), (q1, r1), pixels = first["axial"], last["axial"], first["hexPixels"]
    factor = 40/pixels
    m0, m1 = r0+math.ceil(q0/2), r1+math.ceil(q1/2)
    if q1 < q0 or m1 < m0:
        raise ValueError("Bottom-right hex must be below and right of the top-left hex in numbered rows/columns")
    if not isinstance(origin, (list, tuple)) or len(origin) != 2 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in origin):
        raise ValueError("Invalid source hex grid origin")
    if not isinstance(axial_origin, (list, tuple)) or len(axial_origin) != 2 or not all(type(v) is int for v in axial_origin):
        raise ValueError("Invalid axial grid origin")
    step, radius = pixels/2*math.sqrt(3), pixels/math.sqrt(3)
    base_y = origin[1]-40*(axial_origin[1]+axial_origin[0]/2)
    has_odd, has_even = q0 % 2 == 1 or q1 > q0, q0 % 2 == 0 or q1 > q0
    x0, x1 = origin[0]+(q0-factor*axial_origin[0])*step-radius, origin[0]+(q1-factor*axial_origin[0])*step+radius
    y0, y1 = base_y+pixels*m0-(pixels/2 if has_odd else 0)-pixels/2, base_y+pixels*m1-(0 if has_even else pixels/2)+pixels/2
    return [x0, y0, x1, y1]


def pixel_bounds(top_left=None, bottom_right=None):
    if top_left is None:
        if bottom_right is not None:
            raise ValueError("Pass --top-left with --bottom-right")
        return None
    edges = hex_range_bounds(top_left, bottom_right or top_left)
    return [math.floor(edges[0]), math.floor(edges[1]), math.ceil(edges[2]), math.ceil(edges[3])]
