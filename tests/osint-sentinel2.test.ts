/**
 * Sentinel-2 epoch change detection tests — tile planning, zoom picking,
 * cell grid geometry, pixel differencing, cell aggregation, flagging,
 * summaries, and download serialization. All pure (no DOM, no network).
 */
import * as assert from "assert";
import {
  S2_YEARS,
  s2LayerId,
  s2TileUrl,
  pickChangeZoom,
  tileRange,
  planChangeGrid,
  diffTilePair,
  cellStatsFromMask,
  finalizeCells,
  summarizeChange,
  approxCellMeters,
  changeCellsToCsv,
  changeCellsToGeoJson,
  lumaHistogram,
  histogramMatchLut,
  DEFAULT_CELLS_PER_TILE,
  DEFAULT_THRESHOLD,
} from "../src/core/osint/sentinel2";
import { tileToLonLat, resolutionAtZoom } from "../src/core/tiles";

const SMALL: import("../src/core/osint/overpass").OverpassBbox = {
  lonMin: 36.79,
  latMin: -1.3,
  lonMax: 36.8,
  latMax: -1.29,
};

/* ---------------- source identity ---------------- */

{
  assert.ok(S2_YEARS.includes(2017) && S2_YEARS.includes(2024), "year inventory");
  assert.strictEqual(s2LayerId(2020), "s2cloudless-2020_3857");
  const url = s2TileUrl(2020, 10, 616, 515);
  assert.ok(
    url.endsWith("/s2cloudless-2020_3857/default/g/10/515/616.jpg"),
    "EOX REST path is TileMatrix/z / TileRow/y / TileCol/x",
  );
}

/* ---------------- tile planning ---------------- */

{
  // At z8 a tile spans ~0.7° — the 0.01° bbox is safely inside one tile.
  const r8 = tileRange(SMALL, 8);
  assert.strictEqual(r8.count, 1, "small bbox fits one tile at z8");
  assert.strictEqual(r8.x0, r8.x1, "single column");

  // At z14 the bbox straddles a y-boundary: 1 col x 2 rows (verified arithmetic).
  assert.strictEqual(tileRange(SMALL, 14).count, 2);

  // A 1° square: z11 -> 7x7 = 49 tiles; z12 -> 156 > 60 budget.
  const oneDeg = { lonMin: 36.5, latMin: -1.5, lonMax: 37.5, latMax: -0.5 };
  assert.strictEqual(tileRange(oneDeg, 10).count, 16, "1° at z10 = 16 tiles");
  assert.strictEqual(pickChangeZoom(oneDeg, 60), 11, "highest zoom fitting the budget");
  assert.strictEqual(pickChangeZoom(SMALL, 60), 15, "small scope gets native z15");
  // Budget 1 drops SMALL to z13, the highest zoom where it fits one tile.
  assert.strictEqual(pickChangeZoom(SMALL, 1), 13);
  // A 1° square never fits a single tile — the floor applies.
  assert.strictEqual(
    pickChangeZoom({ lonMin: 36.5, latMin: -1.5, lonMax: 37.5, latMax: -0.5 }, 1),
    8,
    "impossible budget falls to the floor",
  );
}

/* ---------------- cell grid ---------------- */

{
  const plan = planChangeGrid(SMALL, 14, DEFAULT_CELLS_PER_TILE);
  assert.strictEqual(plan.tiles.length, 2, "two tiles straddling the boundary");
  assert.ok(plan.cells.length > 0, "cells enumerated");
  assert.ok(plan.cells.length <= plan.tiles.length * 64, "at most 64 cells per tile");

  const ids = new Set(plan.cells.map((c) => c.id));
  assert.strictEqual(ids.size, plan.cells.length, "cell ids unique");

  for (const c of plan.cells) {
    // Center must lie inside the bbox (inclusion rule).
    const cx = ((c.lonMin + c.lonMax) / 2);
    const cy = ((c.latMin + c.latMax) / 2);
    assert.ok(cx >= SMALL.lonMin && cx <= SMALL.lonMax, "cell center lon inside");
    assert.ok(cy >= SMALL.latMin && cy <= SMALL.latMax, "cell center lat inside");
    assert.ok(c.lonMax > c.lonMin && c.latMax > c.latMin, "cell box sane");
  }

  // Cell geometry must agree with an independent tile->lonlat conversion.
  const first = plan.cells[0];
  assert.strictEqual(first.sizePx, 32, "256/8 = 32 px cells");
  const expectNw = tileToLonLat(first.tileX + first.px / 256, first.tileY + first.py / 256, 14);
  assert.ok(Math.abs(expectNw.lon - first.lonMin) < 1e-9, "NW corner exact");
  assert.ok(Math.abs(expectNw.lat - first.latMax) < 1e-9, "NW corner lat exact");

  // Invalid bbox refused.
  assert.throws(() => planChangeGrid({ lonMin: 5, latMin: 0, lonMax: 4, latMax: 1 }, 14));
}

/* ---------------- pixel differencing ---------------- */

const fillTile = (luma: number): Uint8ClampedArray => {
  const t = new Uint8ClampedArray(256 * 256 * 4);
  for (let i = 0; i < t.length; i += 4) {
    t[i] = luma;
    t[i + 1] = luma;
    t[i + 2] = luma;
    t[i + 3] = 255;
  }
  return t;
};

{
  const a = fillTile(100);
  const same = diffTilePair(a, a, DEFAULT_THRESHOLD);
  assert.ok(same.every((v) => v === 0), "identical epochs -> no change");

  const b = fillTile(200);
  const all = diffTilePair(a, b, DEFAULT_THRESHOLD);
  assert.strictEqual(all.length, 256 * 256);
  assert.ok(all.every((v) => v === 1), "luma delta 100 > 30 -> everything changed");

  // Exactly-at-threshold is NOT changed (strict greater-than).
  assert.ok(diffTilePair(fillTile(100), fillTile(130), 30).every((v) => v === 0), "delta 30 excluded");
  assert.ok(diffTilePair(fillTile(100), fillTile(130), 29).some((v) => v === 1), "delta 30 beats 29");

  assert.throws(() => diffTilePair(new Uint8ClampedArray(10), new Uint8ClampedArray(12)), "size mismatch");
  assert.throws(() => diffTilePair(new Uint8ClampedArray(8), new Uint8ClampedArray(9)), "non-RGBA length");
}

/* ---------------- cell aggregation + flagging ---------------- */

/** Controlled 4-cell plan (independent of bbox-edge cell filtering). */
const syntheticPlan = (): import("../src/core/osint/sentinel2").ChangePlan => {
  const spec = (px: number, py: number): import("../src/core/osint/sentinel2").ChangeCellSpec => ({
    id: `c14-9872-8250-${px / 32}-${py / 32}`,
    tileX: 9872,
    tileY: 8250,
    px,
    py,
    sizePx: 32,
    lonMin: 36.79,
    latMin: -1.3,
    lonMax: 36.793,
    latMax: -1.297,
  });
  return {
    zoom: 14,
    tiles: [{ x: 9872, y: 8250 }],
    cells: [spec(0, 0), spec(32, 0), spec(0, 32), spec(32, 32)],
    cellsPerTile: 8,
  };
};

{
  // Change ONLY the top-left 32x32 cell region (cell 0).
  const a = fillTile(100);
  const b = fillTile(100);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const i = (y * 256 + x) * 4;
      b[i] = 250;
      b[i + 1] = 250;
      b[i + 2] = 250;
    }
  }
  const mask = diffTilePair(a, b, DEFAULT_THRESHOLD);
  const counts = cellStatsFromMask(mask, DEFAULT_CELLS_PER_TILE);
  assert.strictEqual(counts.length, 64);
  assert.strictEqual(counts[0], 32 * 32, "top-left cell fully changed");
  let rest = 0;
  for (let i = 1; i < counts.length; i++) rest += counts[i];
  assert.strictEqual(rest, 0, "no bleed into other cells");

  const plan = syntheticPlan();
  const diffs = new Map([[`${plan.tiles[0].x}:${plan.tiles[0].y}`, counts]]);
  const cells = finalizeCells(plan, diffs, 0.15);
  assert.strictEqual(cells.length, 4);
  const cell0 = cells.find((c) => c.px === 0 && c.py === 0)!;
  assert.strictEqual(cell0.changedPx, 1024);
  assert.strictEqual(cell0.totalPx, 32 * 32);
  assert.ok(Math.abs(cell0.ratio - 1) < 1e-9, "cell 0 fully changed");
  assert.strictEqual(cell0.flagged, true, "ratio 1 >= 0.15");
  assert.strictEqual(cells.filter((c) => c.flagged).length, 1, "only the hot cell flags");

  // A small change (4 of 32 columns) stays below the flag threshold.
  const light = cellStatsFromMask(
    diffTilePair(
      a,
      (() => {
        const t = fillTile(100);
        for (let y = 0; y < 32; y++)
          for (let x = 0; x < 4; x++) {
            const i = (y * 256 + x) * 4;
            t[i] = 250;
            t[i + 1] = 250;
            t[i + 2] = 250;
          }
        return t;
      })(),
    ),
    DEFAULT_CELLS_PER_TILE,
  );
  const cells2 = finalizeCells(plan, new Map([[`${plan.tiles[0].x}:${plan.tiles[0].y}`, light]]), 0.15);
  assert.strictEqual(cells2.filter((c) => c.flagged).length, 0, "1/8 column change never flags a cell");
}

/* ---------------- summary + meters ---------------- */

{
  const plan = syntheticPlan();
  const counts = new Array(64).fill(0);
  counts[0] = 1024;
  const cells = finalizeCells(plan, new Map([[`${plan.tiles[0].x}:${plan.tiles[0].y}`, counts]]), 0.15);
  const s = summarizeChange(cells, plan, -1.295, 30, 0.15);
  assert.strictEqual(s.totalCells, cells.length);
  assert.strictEqual(s.flaggedCells, 1);
  assert.ok(s.changedPct > 0 && s.changedPct < 100);
  assert.ok(s.flaggedPct > 0);
  // z14 native: 9.5493 m/px * 32 px ≈ 305.6 m at the equator.
  const m = approxCellMeters(14, 0, 8);
  assert.ok(Math.abs(m - resolutionAtZoom(14) * 32) < 1e-6, "equator cell meters");
  assert.ok(approxCellMeters(14, -60, 8) < m, "higher latitude shrinks the cell");
}

/* ---------------- radiometric normalization ---------------- */

/** Horizontal luma gradient: tone = x>>1 (rich 0..127 distribution). */
const gradientTile = (): Uint8ClampedArray => {
  const t = new Uint8ClampedArray(256 * 256 * 4);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const i = (y * 256 + x) * 4;
      const v = x >> 1;
      t[i] = v;
      t[i + 1] = v;
      t[i + 2] = v;
      t[i + 3] = 255;
    }
  }
  return t;
};

{
  // Strictly increasing count ramp -> strictly increasing CDF -> the
  // first-crossing walk is the exact identity for equal distributions.
  const ramp = Array.from({ length: 256 }, (_, i) => 100 + i);
  const identity = histogramMatchLut(ramp, [...ramp]);
  for (let v = 0; v < 256; v++) assert.strictEqual(identity[v], v, `identity at ${v}`);

  // A +50 shift with MATCHED total mass: reference support 0..205, B
  // support 50..255 — quantile k of B equals quantile k of A shifted by 50.
  const rampA: number[] = new Array(256).fill(0);
  for (let i = 0; i <= 205; i++) rampA[i] = 100 + i;
  const shifted: number[] = new Array(256).fill(0);
  for (let v = 50; v <= 255; v++) shifted[v] = 100 + (v - 50);
  const shiftedLut = histogramMatchLut(rampA, shifted);
  assert.strictEqual(shiftedLut[150], 100, "shifted tone remaps to reference");
  assert.strictEqual(shiftedLut[255], 205, "top of the shifted support maps to the reference top");
  for (let v = 1; v < 256; v++)
    assert.ok(shiftedLut[v] >= shiftedLut[v - 1], `LUT monotone at ${v}`);

  // End-to-end: a global +50 drift must NOT flag; a real new feature must.
  // Epoch A is a gradient; epoch B is the same gradient shifted +50, with a
  // bright 32x32 change block in the top-left corner.
  const a = gradientTile();
  const b = gradientTile();
  for (let i = 0; i < b.length; i += 4) {
    b[i] += 50;
    b[i + 1] += 50;
    b[i + 2] += 50;
  }
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const i = (y * 256 + x) * 4;
      b[i] = 250;
      b[i + 1] = 250;
      b[i + 2] = 250;
    }
  }
  const raw = diffTilePair(a, b, DEFAULT_THRESHOLD);
  const rawChanged = raw.reduce((s, v) => s + v, 0);
  assert.strictEqual(rawChanged, 65536, "without normalization everything flags");

  const lut = histogramMatchLut(lumaHistogram(a), lumaHistogram(b));
  const norm = diffTilePair(a, b, DEFAULT_THRESHOLD, lut);
  const normChanged = norm.reduce((s, v) => s + v, 0);
  assert.strictEqual(normChanged, 1024, "only the real change block survives normalization");

  // ...and the flagged pixels sit exactly in the top-left cell.
  const counts = cellStatsFromMask(norm, DEFAULT_CELLS_PER_TILE);
  assert.strictEqual(counts[0], 1024, "flags concentrate in the changed cell");
  let rest = 0;
  for (let i = 1; i < counts.length; i++) rest += counts[i];
  assert.strictEqual(rest, 0, "normalized shift is silent elsewhere");
}

/* ---------------- serialization ---------------- */

{
  const plan = syntheticPlan();
  const counts = new Array(64).fill(0);
  counts[0] = 1024;
  const cells = finalizeCells(plan, new Map([[`${plan.tiles[0].x}:${plan.tiles[0].y}`, counts]]), 0.15);
  const s = summarizeChange(cells, plan, -1.295, 30, 0.15);

  const csv = changeCellsToCsv(cells);
  const lines = csv.split("\n");
  assert.strictEqual(lines.length, cells.length + 1, "header + one row per cell");
  assert.ok(lines[0].startsWith("cell_id,lon_min,lat_min"), "deterministic header");
  assert.ok(lines[1].includes(",yes") || lines[1].includes(",no"), "flag column present");

  const gj = changeCellsToGeoJson(cells, s, 2018, 2024) as {
    type: string;
    metardu: { epochs: number[]; license: string; disclosure: string };
    features: { properties: Record<string, unknown>; geometry: { coordinates: number[][][] } }[];
  };
  assert.strictEqual(gj.type, "FeatureCollection");
  assert.deepStrictEqual(gj.metardu.epochs, [2018, 2024]);
  assert.ok(gj.metardu.disclosure.length > 40, "disclosure embedded");
  const ring = gj.features[0].geometry.coordinates[0];
  assert.deepStrictEqual(ring[0], ring[ring.length - 1], "ring closed");
  assert.strictEqual(typeof gj.features[0].properties.flagged, "boolean");
}
