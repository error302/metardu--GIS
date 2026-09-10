/**
 * GeoPackage ingestion tests — GP header decoding, WKB (incl. ISO Z flag),
 * full .gpkg roundtrip through sql.js using a byte-accurate fixture built
 * by scripts/build_gpkg_fixture.py, and end-to-end ingestFiles routing.
 */
import * as assert from "assert";
import { readFileSync } from "fs";
import { join } from "path";
import {
  readGpHeader,
  parseGpkg,
  geomToFeatureKind,
  configureSqlLoader,
} from "../src/core/ingest/gpkg";
import { ingestFiles } from "../src/core/ingest/index";

/* ---------- 1. GP header ---------- */
{
  // "GP" + version 0 + flags 0x03 (LE, XY envelope) + srs 4326 + 4 doubles
  const buf = new ArrayBuffer(8 + 32);
  const v = new DataView(buf);
  v.setUint8(0, 0x47); // G
  v.setUint8(1, 0x50); // P
  v.setUint8(2, 0);
  v.setUint8(3, 0x03);
  v.setInt32(4, 4326, true);
  v.setFloat64(8, 36.0, true);
  v.setFloat64(16, -1.5, true);
  v.setFloat64(24, 37.0, true);
  v.setFloat64(32, -1.0, true);
  const h = readGpHeader(v);
  assert.strictEqual(h.littleEndian, true);
  assert.strictEqual(h.envelopeCode, 1);
  assert.strictEqual(h.srsId, 4326);
  assert.strictEqual(h.offset, 40);
}

async function main(): Promise<void> {
/* ---------- 2. sql.js engine (wasm from node_modules) ---------- */
const wasmBinary = readFileSync(
  join(process.cwd(), "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
);
// Node needs the ESM build; esbuild bundles it into the test binary.
const sqlModule = await import("sql.js");
configureSqlLoader((opts) => sqlModule.default({ wasmBinary, ...opts }));

/* ---------- 3. Full .gpkg roundtrip ---------- */
const gpkgPath = join(process.cwd(), "tests", "fixtures", "metaqa.gpkg");
const gpkgBuf = readFileSync(gpkgPath);
const parsed = await parseGpkg(gpkgBuf.buffer.slice(gpkgBuf.byteOffset, gpkgBuf.byteOffset + gpkgBuf.byteLength) as ArrayBuffer);

assert.strictEqual(parsed.layerName, "parcels");
assert.strictEqual(parsed.srsId, 4326);
assert.strictEqual(parsed.features.length, 4, `expected 4 features, got ${parsed.features.length}`);

const byName = new Map(parsed.features.map((f) => [String(f.properties["name"]), f]));

// Point feature with attributes
{
  const f = byName.get("Station A")!;
  assert.ok(f, "Station A present");
  const shape = geomToFeatureKind(f.geom);
  assert.strictEqual(shape.kind, "point");
  if (shape.kind === "point") {
    assert.ok(Math.abs(shape.x - 36.7901) < 1e-9);
    assert.ok(Math.abs(shape.y + 1.2886) < 1e-9);
  }
  assert.strictEqual(f.properties["status"], "surveyed");
  assert.strictEqual(f.properties["beacons"], 1);
}

// Polyline feature
{
  const f = byName.get("Access Road")!;
  const shape = geomToFeatureKind(f.geom);
  assert.strictEqual(shape.kind, "polyline");
  if (shape.kind === "polyline") {
    assert.strictEqual(shape.parts.length, 1);
    assert.strictEqual(shape.parts[0].length, 3);
    assert.ok(Math.abs(shape.parts[0][2][0] - 36.7922) < 1e-9);
  }
}

// Polygon feature (closed ring, 5 vertices)
{
  const f = byName.get("Block III")!;
  const shape = geomToFeatureKind(f.geom);
  assert.strictEqual(shape.kind, "polygon");
  if (shape.kind === "polygon") {
    assert.strictEqual(shape.rings.length, 1);
    assert.strictEqual(shape.rings[0].length, 5);
  }
  assert.strictEqual(f.properties["beacons"], 5);
}

// 3D point (ISO Z flag)
{
  const f = byName.get("Bench B2")!;
  const shape = geomToFeatureKind(f.geom);
  assert.strictEqual(shape.kind, "point");
  if (shape.kind === "point") {
    assert.ok(shape.z !== undefined, "Z coordinate decoded");
    assert.ok(Math.abs(shape.z! - 1754.25) < 1e-6);
  }
}

/* ---------- 4. End-to-end ingestFiles routing ---------- */
{
  const file = new File([gpkgBuf], "metaqa.gpkg");
  const result = await ingestFiles([file]);
  assert.ok(result.layerName.includes("parcels"));
  // 1 (Station A) + 1 (Bench B2) points + 3 road vertices + 5 polygon ring vertices
  assert.strictEqual(result.points.length, 10, `points: ${result.points.length}`);
  assert.strictEqual(result.stats.pointFeatures, 2);
  assert.strictEqual(result.stats.lineFeatures, 1);
  assert.strictEqual(result.stats.polygonFeatures, 1);
  assert.ok(result.points.every((p) => p.easting > 36 && p.easting < 37), "coordinates land in layer range");
  const withProps = result.points.filter((p) => p.properties && p.properties["status"] === "surveyed");
  assert.ok(withProps.length >= 2, "typed attributes carried through");
}

console.log("gpkg.test.ts: all assertions passed");
}

main().catch((e) => { console.error(e); process.exit(1); });
