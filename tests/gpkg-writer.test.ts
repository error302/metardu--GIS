/**
 * GeoPackage writer tests — byte-level container conformance plus a full
 * write → read roundtrip through the production parser (parseGpkg).
 */
import * as assert from "assert";
import { readFileSync } from "fs";
import { join } from "path";
import { exportGpkg, gpBlob } from "../src/core/export/gpkg-writer";
import { parseGpkg, configureSqlLoader, readGpHeader } from "../src/core/ingest/gpkg";
import { PipelineResult, SurveyPoint } from "../src/types/spatial";

function pt(id: string, e: number, n: number, z = 100): SurveyPoint {
  return { id, easting: e, northing: n, elevation: z, rawCode: "BND", category: "boundary", description: id };
}

function makeResult(): PipelineResult {
  const BPTS = [pt("B1", 5000, 8000), pt("B2", 5200, 8000), pt("B3", 5200, 8150), pt("B4", 5000, 8150)];
  return {
    metadata: {
      id: "T-01", title: "Test Parcel", locality: "Test", country: "Kenya",
      crs: "Arc 1960 / UTM zone 37S", surveyorName: "J. Surveyor", registrationNo: "MISK-TEST",
      date: "2026-09-10", scale: "1:1,250", organization: "MetaRDU QA",
    },
    points: [...BPTS, pt("X1", 5100, 8075)],
    vectors: [{
      id: "v1", code: "RD", name: "Access Road", category: "road", layer: "roads",
      points: [pt("R1", 4980, 7990), pt("R2", 5230, 8210)], isClosed: false,
      color: "#8a6d3b", lineType: "solid", lineWidth: 1.5,
    }],
    boundary: {
      id: "bnd", name: "Parcel", parcelNo: "LR-TEST/1", points: BPTS,
      perimeterM: 700, areaSqM: 30000, areaHa: 3.0, areaAcres: 7.41,
      isClosed: true, linearMisclosureM: 0.042, precisionRatio: 5000,
      precisionRating: "Class A (Urban)",
      bearingsDistances: [],
    },
    tin: null, contours: [], buffers: [], suitability: [],
    hazardSinks: [], exposedAssets: [], energyClusters: [],
    telemetries: [], totalDurationMs: 0,
  };
}

/* ---------- 1. GP blob header ---------- */
{
  const wkb = new Uint8Array(21);
  const blob = gpBlob(wkb, 21037, [0, 10, 5, 15]);
  const v = new DataView(blob.buffer);
  const h = readGpHeader(v);
  assert.strictEqual(h.littleEndian, true);
  assert.strictEqual(h.envelopeCode, 1);
  assert.strictEqual(h.srsId, 21037);
  assert.strictEqual(h.offset, 8 + 32);
  assert.strictEqual(blob.length, 40 + 21);
}

async function main(): Promise<void> {
  /* ---------- 2. sql.js engine ---------- */
  const wasmBinary = readFileSync(join(process.cwd(), "node_modules", "sql.js", "dist", "sql-wasm.wasm"));
  const sqlModule = await import("sql.js");
  configureSqlLoader((opts) => sqlModule.default({ wasmBinary, ...opts }));

  /* ---------- 3. Container conformance ---------- */
  const bytes = await exportGpkg(makeResult());
  assert.strictEqual(new TextDecoder().decode(bytes.slice(0, 16)), "SQLite format 3\u0000", "SQLite magic");
  // application_id at offset 68 (big-endian) = 'GPKG'
  const appId = (bytes[68] << 24) | (bytes[69] << 16) | (bytes[70] << 8) | bytes[71];
  assert.strictEqual(appId, 0x47504b47, `application_id GPKG, got 0x${(appId >>> 0).toString(16)}`);

  /* ---------- 4. Write → read roundtrip ---------- */
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const parsed = await parseGpkg(ab);
  assert.strictEqual(parsed.srsId, 21037, "working CRS written as srs_id");
  // 5 beacons + 1 vector + 1 boundary polygon
  assert.strictEqual(parsed.features.length, 7, `expected 7 features, got ${parsed.features.length}`);

  const kinds = parsed.features.map((f) => f.geom.kind);
  assert.strictEqual(kinds.filter((k) => k === "point").length, 5);
  assert.strictEqual(kinds.filter((k) => k === "line").length, 1);
  assert.strictEqual(kinds.filter((k) => k === "polygon").length, 1);

  // Polygon ring closure written by the writer must decode with >= 4 positions
  const poly = parsed.features.find((f) => f.geom.kind === "polygon")!;
  if (poly.geom.kind === "polygon") {
    assert.ok(poly.geom.rings[0].length >= 4, "boundary ring closed");
  }
  // Attributes survive the roundtrip
  const b1 = parsed.features.find((f) => f.geom.kind === "point" && f.properties["beacon_id"] === "B1");
  assert.ok(b1, "beacon B1 exported");
  assert.strictEqual(b1!.properties["elev_m"], 100);
  const road = parsed.features.find((f) => f.geom.kind === "line");
  assert.strictEqual(road!.properties["name"], "Access Road");
  const parcel = parsed.features.find((f) => f.geom.kind === "polygon");
  assert.strictEqual(parcel!.properties["parcel_no"], "LR-TEST/1");
  assert.strictEqual(parcel!.properties["area_ha"], 3.0);

  /* ---------- 5. Empty document refuses politely ---------- */
  const empty = makeResult();
  empty.points = [];
  empty.vectors = [];
  empty.boundary = null;
  await assert.rejects(() => exportGpkg(empty), /Nothing to export/);

  console.log("gpkg-writer.test.ts: ALL ASSERTIONS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
