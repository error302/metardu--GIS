/**
 * Geoid grid tests — MTGEOD01 parser, bilinear sampling, and validation of
 * the bundled real EGM2008 East-Africa asset against independently verified
 * anchor values (EGM2008 2.5' vs EGM96 15' agreement ±0.9 m).
 */
import * as assert from "assert";
import { readFileSync } from "fs";
import { join } from "path";
import {
  parseGeoidGrid,
  sampleGrid,
  GridData,
} from "../src/core/geoid/grid";
import { geoidUndulation, reduceOrthometricHeight, registerGeoidGridLoader, getGeoidProvenance } from "../src/core/crs";

/* ---------- 1. Synthetic fixture: parser + sampler semantics ---------- */

function buildFixture(): ArrayBuffer {
  // 3 cols x 2 rows, values in cm; row 0 = latMax.
  const latMax = 2.0, latMin = 1.0, lonMin = 10.0, lonMax = 12.0;
  const dLat = 1.0, dLon = 1.0, rows = 2, cols = 3;
  const cells = Int16Array.from([
    1000, -2000, 3000,   // lat 2.0: lon 10, 11, 12
    -500,  2500, -32768, // lat 1.0: lon 10, 11, 12(nodata)
  ]);
  const head = new ArrayBuffer(68);
  const v = new DataView(head);
  for (let i = 0; i < 8; i++) v.setUint8(i, "MTGEOD01".charCodeAt(i));
  v.setFloat64(8, latMax, true);
  v.setFloat64(16, latMin, true);
  v.setFloat64(24, lonMin, true);
  v.setFloat64(32, lonMax, true);
  v.setFloat64(40, dLat, true);
  v.setFloat64(48, dLon, true);
  v.setUint32(56, rows, true);
  v.setUint32(60, cols, true);
  v.setUint16(64, 1, true);
  v.setUint16(66, 0, true);
  const out = new Uint8Array(68 + cells.byteLength);
  out.set(new Uint8Array(head), 0);
  out.set(new Uint8Array(cells.buffer), 68);
  return out.buffer;
}

const g: GridData = parseGeoidGrid(buildFixture());

// Exact node reads (corner-registered: row 0 == latMax node)
assert.strictEqual(sampleGrid(g, 2.0, 10.0), 10.0);
assert.strictEqual(sampleGrid(g, 2.0, 11.0), -20.0);
assert.strictEqual(sampleGrid(g, 1.0, 10.0), -5.0);
// Bilinear midpoint between 10.0 and -20.0 at lat 2.0
assert.strictEqual(sampleGrid(g, 2.0, 10.5), -5.0);
// Bilinear interior (lat 1.5, lon 10.5): (10 + -20 - 5 + 25)/4 = 2.5
assert.strictEqual(sampleGrid(g, 1.5, 10.5), 2.5);
// Nodata cell propagates null
assert.strictEqual(sampleGrid(g, 1.0, 12.0), null);
assert.strictEqual(sampleGrid(g, 1.0, 11.5), null);
// Outside the grid -> null (caller falls back)
assert.strictEqual(sampleGrid(g, 0.9, 10.0), null);
assert.strictEqual(sampleGrid(g, 2.1, 10.0), null);
assert.strictEqual(sampleGrid(g, 2.0, 12.1), null);

// Malformed inputs throw
assert.throws(() => parseGeoidGrid(new ArrayBuffer(10)));
{
  const bad = new Uint8Array(buildFixture());
  bad[0] = 88; // break magic
  assert.throws(() => parseGeoidGrid(bad.buffer));
}

/* ---------- 2. Bundled real EGM2008 asset validation ---------- */

const assetPath = join(process.cwd(), "public", "geoid", "egm2008-ea-2p5.bin");
const real: GridData = parseGeoidGrid(readFileSync(assetPath).buffer as ArrayBuffer);

assert.strictEqual(real.rows, 433);
assert.strictEqual(real.cols, 481);
assert.ok(Math.abs(real.latMax - 10.0) < 1e-9);
assert.ok(Math.abs(real.latMin + 8.0) < 1e-9);
assert.ok(Math.abs(real.lonMin - 26.0) < 1e-9);
assert.ok(Math.abs(real.lonMax - 46.0) < 1e-9);

// Anchor values sampled from the official grid (cm quantization => ±5 mm)
const ANCHORS: [number, number, number, string][] = [
  [0.0, 36.82, -13.3189, "Nairobi area"],
  [-4.05, 39.67, -29.198, "Mombasa"],
  [0.35, 32.58, -12.9721, "Kampala"],
  [-6.8, 39.28, -27.6735, "Dar es Salaam"],
  [-1.95, 30.06, -8.8232, "Kigali"],
  [9.03, 38.74, -7.0385, "Addis Ababa"],
];
for (const [lat, lon, expected, name] of ANCHORS) {
  const n = sampleGrid(real, lat, lon);
  assert.ok(n !== null, `${name} must be inside the grid`);
  assert.ok(
    Math.abs(n! - expected) < 0.05,
    `${name}: N=${n} expected ${expected}`,
  );
}
// Outside East Africa -> null
assert.strictEqual(sampleGrid(real, 51.5, -0.12), null); // London
assert.strictEqual(sampleGrid(real, -22.9, -43.2), null); // Rio

/* ---------- 3. Registration + reduction pipeline semantics ---------- */

// Register the real grid the way initGeoidModel() does.
registerGeoidGridLoader((lat, lon) => sampleGrid(real, lat, lon));
assert.strictEqual(getGeoidProvenance().statutory, true);

// East Africa: N is negative => orthometric H sits ABOVE ellipsoidal h.
const red = reduceOrthometricHeight(1786.7, 0.0, 36.82); // Nairobi-area GNSS height
assert.ok(Math.abs(red.geoidN + 13.3189) < 0.05);
assert.ok(Math.abs(red.orthometricH - 1800.02) < 0.05);

// Outside grid coverage falls back to parametric anchors (negative N in EA).
const nFallback = geoidUndulation(-1.0, 34.0, "PARAMETRIC");
assert.ok(nFallback < 0 && nFallback > -60, `fallback N in EA should be negative, got ${nFallback}`);
// Fallback reproduces anchors at the anchor points (within IDW tolerance)
for (const [lat, lon, expected] of ANCHORS) {
  const n = geoidUndulation(lat, lon, "PARAMETRIC");
  assert.ok(Math.abs(n - expected) < 1.0, `parametric anchor ${lat},${lon}: ${n} vs ${expected}`);
}

console.log("geoid-grid.test.ts: all assertions passed");
