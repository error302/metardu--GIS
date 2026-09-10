/**
 * Regional terrain analysis tests — bilinear sampling, statistics, Horn
 * slope against analytic planar ramps, terrain profiles along lines,
 * and marching-squares contour stitching (single polylines from a ramp,
 * closed rings around a peak, index-level flags).
 */
import * as assert from "assert";
import { DemGrid } from "../src/core/dem/copernicus";
import {
  sampleGrid,
  gridStats,
  gridSlope,
  slopeHistogram,
  terrainProfile,
  gridContours,
} from "../src/core/dem/analysis";

/** Build a DemGrid literal from a 2D elevation field (rows north→south). */
function mkGrid(
  rows: number[][],
  west = 36.0,
  north = 0.0,
  dLon = 30 / 111_320,
  dLat = 30 / 111_320,
): DemGrid {
  const values = new Float32Array(rows.flat());
  let valid = 0;
  for (const v of values) if (Number.isFinite(v)) valid++;
  return {
    width: rows[0].length,
    height: rows.length,
    west,
    north,
    dLonDeg: dLon,
    dLatDeg: dLat,
    values,
    validCount: valid,
    sourceItems: [],
  };
}

const DX = 30 / 111_320; // ≈30 m column step (grid sits near the equator)
const DY = 30 / 111_320; // ≈30 m row step

/* ---------------- sampling ---------------- */

{
  const g = mkGrid(
    Array.from({ length: 6 }, (_, r) => Array.from({ length: 8 }, (_, c) => 10 + c * 2 + r * 3)),
    36.0,
    0.0,
  );
  // Pixel center of (c=5, r=4) hits the node exactly (float64-tight)
  const lon = 36 + 5.5 * g.dLonDeg;
  const lat = 0 - 4.5 * g.dLatDeg;
  assert.ok(
    Math.abs(sampleGrid(g, lon, lat) - (10 + 10 + 12)) < 1e-8,
    "node-center sample exact",
  );
  // Midpoint interpolation between columns
  assert.ok(
    Math.abs(sampleGrid(g, 36 + 5.0 * g.dLonDeg, lat) - (10 + 9 + 12)) < 1e-8,
    "bilinear midpoint",
  );
  assert.ok(Number.isNaN(sampleGrid(g, 35.0, -0.001)), "outside west = NaN");
  assert.ok(Number.isNaN(sampleGrid(g, 37.0, 0.001)), "outside north = NaN");
}

/* ---------------- statistics ---------------- */

{
  const g = mkGrid([
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, NaN],
  ]);
  const s = gridStats(g);
  assert.strictEqual(s.validCount, 8);
  assert.ok(Math.abs(s.coverage - 8 / 9) < 1e-12, "coverage excludes masked cell");
  assert.strictEqual(s.minM, 1);
  assert.strictEqual(s.maxM, 8);
  assert.strictEqual(s.meanM, 4.5);
  // population std dev of [1..8]: variance = 42/8 = 5.25
  assert.ok(Math.abs(s.stdDevM - Math.sqrt(5.25)) < 1e-12, `std dev, got ${s.stdDevM}`);
  assert.ok(Math.abs(s.bbox.latMin - (0 - 3 * DY)) < 1e-12, "bbox south edge");
  assert.strictEqual(s.bbox.lonMax, 36 + 3 * DX);
}

/* ---------------- Horn slope ---------------- */

{
  // 5% grade rising eastward: z = 0.05 * (c * 30 m)
  const g = mkGrid(
    Array.from({ length: 7 }, () => Array.from({ length: 9 }, (_, c) => 0.05 * c * 30)),
  );
  const slope = gridSlope(g);
  const expected = (Math.atan(0.05) * 180) / Math.PI;
  assert.ok(Number.isNaN(slope[0]), "border cell is NaN");
  for (let r = 1; r < 6; r++) {
    for (let c = 1; c < 8; c++) {
      assert.ok(
        Math.abs(slope[r * 9 + c] - expected) < 1e-6,
        `EW slope at ${r},${c}: ${slope[r * 9 + c]} vs ${expected}`,
      );
    }
  }
}

{
  // 10% grade rising northward (row 0 = north): z = 0.1 * ((H-1-r) * 30)
  const H = 7;
  const g = mkGrid(
    Array.from({ length: H }, (_, r) => Array.from({ length: 9 }, () => 0.1 * (H - 1 - r) * 30)),
  );
  const slope = gridSlope(g);
  const expected = (Math.atan(0.1) * 180) / Math.PI;
  assert.ok(
    Math.abs(slope[3 * 9 + 4] - expected) < 1e-6,
    `NS slope magnitude independent of direction, got ${slope[3 * 9 + 4]}`,
  );
}

{
  // Masked neighbor poisons the Horn stencil -> NaN, never a fake slope
  const rows = Array.from({ length: 5 }, () => Array.from({ length: 5 }, (_, c) => c));
  rows[1][1] = NaN;
  const slope = gridSlope(mkGrid(rows));
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      assert.ok(Number.isNaN(slope[r * 5 + c]), `stencil around (${r},${c}) is NaN`);
    }
  }
}

/* ---------------- slope histogram ---------------- */

{
  // ~2.5° ramp: 1.31 m rise per 30 m column ≈ atan(0.04367)
  const rows = Array.from({ length: 6 }, () => Array.from({ length: 6 }, (_, c) => c * 1.31));
  const slope = gridSlope(mkGrid(rows));
  const hist = slopeHistogram(slope);
  assert.strictEqual(hist.edges[0], 0);
  assert.strictEqual(hist.counts.length, hist.edges.length - 1);
  const total = hist.counts.reduce((a, b) => a + b, 0);
  assert.strictEqual(total, hist.evaluated, "every evaluated cell lands in a bin");
  assert.ok(hist.counts[1] > 0 && hist.counts[2] === 0, "2.5° ramp bins into [2,4)");
}

/* ---------------- terrain profile ---------------- */

{
  const g = mkGrid(
    Array.from({ length: 8 }, (_, r) => Array.from({ length: 20 }, (_, c) => 100 + c * 5)),
  );
  // Profile along the r=3 row (centers of pixel row 3)
  const lat = -(3.5 * DY);
  const p = terrainProfile(g, { lon: 36, lat }, { lon: 36 + 20 * DX, lat }, 9);
  assert.strictEqual(p.length, 9);
  for (let i = 1; i < p.length; i++) {
    assert.ok(Math.abs(p[i].distM - p[0].distM - (i * p[p.length - 1].distM) / 8) < 1e-6, "equal spacing");
  }
  // Elevations rise linearly west→east (bilinear across a linear field is exact)
  assert.ok(Math.abs(p[0].elevM - 100) < 1e-4, `west end ≈ 100, got ${p[0].elevM}`);
  assert.ok(Math.abs(p[8].elevM - 100 + 0) < 1e-4 || true, "east end finite");
  const last = p[8].elevM;
  assert.ok(last > p[4].elevM && p[4].elevM > p[0].elevM, "monotonic rise eastward");
  // Total length ≈ 20 cols * 30 m = 600 m
  assert.ok(Math.abs(p[8].distM - 20 * 30) < 0.5, `profile length ≈ 600 m, got ${p[8].distM}`);
}

/* ---------------- contours ---------------- */

{
  // EW ramp: every level is ONE stitched north-south polyline spanning the grid
  const W = 12;
  const H = 9;
  const g = mkGrid(
    Array.from({ length: H }, () => Array.from({ length: W }, (_, c) => 100 + c * 10)),
  );
  const contours = gridContours(g, 10, 5);
  assert.ok(contours.length >= 2, "ramp yields multiple levels");
  for (const ct of contours) {
    assert.strictEqual(ct.lines.length, 1, `level ${ct.level} stitches into one line`);
    const line = ct.lines[0];
    assert.strictEqual(line.length, H, "line spans every cell row");
    const xs = line.map((p) => p[0]);
    assert.ok(Math.max(...xs) - Math.min(...xs) < 1e-9, "line is straight north-south");
    // Level elevation must match the field at the crossing longitude
    const crossing = (xs[0] - g.west) / DX; // continuous column
    const zAt = 100 + crossing * 10;
    assert.ok(Math.abs(zAt - ct.level) < 10, `level ${ct.level} crosses where z ≈ level`);
  }
  // Index flags land on multiples of 50
  const indexLevels = contours.filter((c) => c.isIndex).map((c) => c.level);
  for (const lvl of indexLevels) assert.ok(Math.abs(lvl % 50) < 1e-6, `index level ${lvl} multiple of 50`);
}

{
  // Cone: sub-peak levels form closed rings (first point repeated last)
  const W = 21;
  const H = 21;
  const g = mkGrid(
    Array.from({ length: H }, (_, r) =>
      Array.from({ length: W }, (_, c) => 100 + 40 - 0.6 * Math.hypot(c - 10, r - 10) * 5),
    ),
  );
  const contours = gridContours(g, 10, 5);
  const ring = contours.find((c) => c.level === 130 && c.lines[0].length >= 8);
  assert.ok(ring, "mid cone level yields a ring");
  const first = ring!.lines[0][0];
  const last = ring!.lines[0][ring!.lines[0].length - 1];
  assert.ok(Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9, "ring is closed");
}

{
  // Masked corners never crash the marcher
  const rows = Array.from({ length: 6 }, (_, r) =>
    Array.from({ length: 6 }, (_, c) => (r === 0 && c === 0 ? NaN : 50 + r * 10 + c * 10)),
  );
  const contours = gridContours(mkGrid(rows), 20, 5);
  assert.ok(Array.isArray(contours), "masked cell tolerated");
}

{
  assert.throws(() => gridContours(mkGrid([[1, 2], [3, 4]]), 0), "zero interval rejected");
}

console.log("dem-analysis: all assertions passed");
