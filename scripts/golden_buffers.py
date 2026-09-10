#!/usr/bin/env python3
"""
Golden-file generator for the corridor buffer engine parity harness.

Generates reference corridor polygons with GEOS (via shapely) -- the same
geometry engine that powers QGIS and PostGIS -- over deterministic survey
fixtures, and writes them as JSON for the TypeScript parity test
(tests/buffer-parity.test.ts).

Reference parameters (must stay in sync with src/core/buffer-engine.ts):
  - join_style : round, quad_segs = 8 (8 arc segments per quarter circle)
  - cap_style  : flat (2) -- statutory corridors terminate at the
                 centerline extent; round caps would over-reserve.

Usage: python3 scripts/golden_buffers.py   (from repo root)
"""

import json
import math
import os

from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union

QUAD_SEGS = 8
HALF_WIDTHS_M = [7.5, 15.0]  # 15 m road reserve, 30 m riparian corridor

# Deterministic fixtures (metres, projected grid CRS -- e.g. Arc 1960 / UTM 37S).
# Coordinates are rounded to 3 dp (mm) exactly like field ingest does.
FIXTURES = {
    # Plain two-point centerline: exercises caps only, no joins.
    "straight_ew": [(1000.0, 2000.0), (1200.0, 2000.0)],
    # Single 90-degree corner: the classic road reserve bend.
    "right_angle": [(1000.0, 2000.0), (1100.0, 2000.0), (1100.0, 2120.0)],
    # Acute 45-degree zigzag: worst case for the old per-segment offset,
    # which left wedge gaps / self-intersections at every bend.
    "acute_zigzag": [
        (1000.0, 2000.0),
        (1100.0, 2000.0),
        (1170.71, 2070.71),  # 45-degree turn
        (1270.71, 2070.71),  # back to east-west
    ],
    # Obtuse 135-degree bend: gentle deviation, near-collinear offsets.
    "obtuse_bend": [(1000.0, 2000.0), (1100.0, 2000.0), (1200.0, 2041.42)],
    # Degenerate input: duplicate vertex + collinear middle point.
    # Must not break the engine; GEOS tolerates it.
    "collinear_degenerate": [
        (1000.0, 2000.0),
        (1100.0, 2000.0),
        (1100.0, 2000.0),  # duplicate
        (1200.0, 2000.0),  # collinear continuation
    ],
    # Realistic road centerline: five vertices, mixed bend directions.
    "road_centerline": [
        (1000.0, 2000.0),
        (1150.0, 2000.0),
        (1150.0, 2100.0),
        (1300.0, 2180.28),
        (1450.0, 2180.28),
    ],
}


def round_ring(ring):
    """Round ring coordinates to sub-mm; drop closure dup handled by caller."""
    return [[[round(x, 3), round(y, 3)] for x, y in ring[0]]]


def main():
    out = {
        "meta": {
            "generator": "shapely (GEOS) " + __import__("shapely").__version__,
            "quad_segs": QUAD_SEGS,
            "cap_style": "flat",
            "join_style": "round",
            "note": (
                "Reference corridor polygons for parity testing. "
                "Flat caps: corridors terminate at the centerline extent. "
                "Round joins: statutory road-reserve convention."
            ),
        },
        "fixtures": {},
    }

    for name, coords in FIXTURES.items():
        line = LineString(coords)
        assert line.is_simple, f"fixture {name} centerline must be simple"
        entry = {
            "centerline": [[x, y] for x, y in coords],
            "buffers": [],
        }
        for hw in HALF_WIDTHS_M:
            poly = line.buffer(
                hw,
                quad_segs=QUAD_SEGS,
                cap_style=2,  # flat
                join_style=1,  # round
            )
            # A simple polyline with flat caps always yields one polygon.
            if poly.geom_type == "Polygon":
                geom = poly
            else:  # defensive: fixtures are designed simple
                geom = unary_union(poly.geoms)
            assert geom.geom_type == "Polygon", f"{name}@{hw}: expected Polygon"
            assert geom.is_valid, f"{name}@{hw}: GEOS polygon invalid"

            exterior = list(geom.exterior.coords)
            entry["buffers"].append(
                {
                    "halfWidthM": hw,
                    # GEOS rings are closed (first == last).
                    "exteriorRing": [[round(x, 3), round(y, 3)] for x, y in exterior],
                    "areaSqM": round(geom.area, 4),
                    "perimeterM": round(geom.exterior.length, 4),
                }
            )
        out["fixtures"][name] = entry
        print(f"fixture {name:22s} " + " ".join(
            f"hw={b['halfWidthM']:>5} area={b['areaSqM']:>10.2f} "
            f"perim={b['perimeterM']:>8.2f} verts={len(b['exteriorRing'])}"
            for b in entry["buffers"]
        ))

    dest = os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures",
                        "buffer-golden.json")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w") as fh:
        json.dump(out, fh, indent=1)
    print(f"\nwrote {os.path.normpath(dest)}")


if __name__ == "__main__":
    main()
