/**
 * Unit Test — Shapefile (.shp + .dbf) and GeoJSON ingest roundtrip.
 * Builds byte-accurate synthetic shapefiles in memory, parses them back, and
 * verifies geometry, typed attributes, and SurveyPoint projection.
 */

import { parseShp, parseDbf, inferCategory } from "../src/core/ingest/shapefile";
import { parseGeoJson, geometryToParts } from "../src/core/ingest/geojson";
import { ingestFiles } from "../src/core/ingest";

console.log("=== INGEST (SHP/DBF/GEOJSON) TEST SUITE ===");

// ── Helpers: build a synthetic .shp ──────────────────────────────────────────
function buildShp(
  records: { type: number; content: (v: DataView, offset: number) => number }[]
): ArrayBuffer {
  const bodies: ArrayBuffer[] = [];
  for (const rec of records) {
    const buf = new ArrayBuffer(4 + 256); // type + generous content
    const view = new DataView(buf);
    const len = rec.content(view, 4) + 4;
    const trimmed = buf.slice(4, len); // drop the 4 scratch bytes before the type field
    bodies.push(trimmed);
  }

  const headerLen = 100;
  const totalWords =
    50 + bodies.reduce((acc, b) => acc + b.byteLength / 2 + 4, 0);
  const out = new ArrayBuffer(totalWords * 2);
  const view = new DataView(out);

  view.setInt32(0, 9994, false); // file code (big-endian)
  view.setInt32(24, totalWords, false); // file length in words
  view.setInt32(28, 1000, true); // version
  view.setInt32(32, 0, true); // shape type (mixed; per-record types set)

  let offset = headerLen;
  bodies.forEach((body, i) => {
    view.setInt32(offset, i + 1, false); // record number
    view.setInt32(offset + 4, body.byteLength / 2, false); // content length in words
    new Uint8Array(out, offset + 8, body.byteLength).set(new Uint8Array(body));
    offset += 8 + body.byteLength;
  });

  return out;
}

function writePointRecord(view: DataView, base: number, x: number, y: number): number {
  view.setInt32(base, 1, true); // shape type Point
  view.setFloat64(base + 4, x, true);
  view.setFloat64(base + 12, y, true);
  return 20;
}

function writePolylineRecord(
  view: DataView,
  base: number,
  parts: [number, number][][]
): number {
  view.setInt32(base, 3, true); // PolyLine
  // bbox
  const xs = parts.flat().map((p) => p[0]);
  const ys = parts.flat().map((p) => p[1]);
  view.setFloat64(base + 4, Math.min(...xs), true);
  view.setFloat64(base + 12, Math.min(...ys), true);
  view.setFloat64(base + 20, Math.max(...xs), true);
  view.setFloat64(base + 28, Math.max(...ys), true);
  const numParts = parts.length;
  const numPoints = parts.flat().length;
  view.setInt32(base + 36, numParts, true);
  view.setInt32(base + 40, numPoints, true);
  let pos = base + 44;
  let acc = 0;
  for (const part of parts) {
    view.setInt32(pos, acc, true);
    acc += part.length;
    pos += 4;
  }
  for (const [x, y] of parts.flat()) {
    view.setFloat64(pos, x, true);
    view.setFloat64(pos + 8, y, true);
    pos += 16;
  }
  return pos - base;
}

// ── Build synthetic shapefile: 2 points + 1 polyline ────────────────────────
const shpBuf = buildShp([
  { type: 1, content: (v, o) => writePointRecord(v, o, 250100.5, 9850200.25) },
  { type: 1, content: (v, o) => writePointRecord(v, o, 250220.75, 9850310.5) },
  {
    type: 3,
    content: (v, o) =>
      writePolylineRecord(v, o, [
        [
          [250000, 9850000],
          [250150, 9850120],
          [250300, 9850080],
        ],
      ]),
  },
]);

const shpRecords = parseShp(shpBuf);
if (shpRecords.length !== 3) {
  console.error(`FAIL: expected 3 shp records, got ${shpRecords.length}`);
  process.exit(1);
}
const p0 = shpRecords[0].geometry as any;
if (p0.kind !== "point" || Math.abs(p0.x - 250100.5) > 1e-9 || Math.abs(p0.y - 9850200.25) > 1e-9) {
  console.error("FAIL: point geometry roundtrip broken");
  process.exit(1);
}
const pl = shpRecords[2].geometry as any;
if (
  pl.kind !== "polyline" ||
  pl.parts.length !== 1 ||
  pl.parts[0].length !== 3 ||
  Math.abs(pl.parts[0][2][0] - 250300) > 1e-9
) {
  console.error("FAIL: polyline geometry roundtrip broken");
  process.exit(1);
}
console.log("PASS: .shp geometry parse (points + polyline)");

// ── Build synthetic .dbf ─────────────────────────────────────────────────────
function buildDbf(fields: { name: string; type: string; length: number; decimals: number }[], records: string[][]): ArrayBuffer {
  const recordLength = 1 + fields.reduce((a, f) => a + f.length, 0);
  const headerLength = 32 + fields.length * 32 + 1;
  const out = new ArrayBuffer(headerLength + records.length * recordLength);
  const view = new DataView(out);
  const bytes = new Uint8Array(out);

  bytes[0] = 0x03; // dBASE III
  view.setInt32(4, records.length, true);
  view.setUint16(8, headerLength, true);
  view.setUint16(10, recordLength, true);

  let pos = 32;
  for (const f of fields) {
    const nameBytes = new TextEncoder().encode(f.name.slice(0, 10).toUpperCase());
    bytes.set(nameBytes, pos);
    bytes[pos + 11] = f.type.charCodeAt(0);
    bytes[pos + 16] = f.length;
    bytes[pos + 17] = f.decimals;
    pos += 32;
  }
  bytes[pos] = 0x0d; // header terminator

  let recPos = headerLength;
  for (const rec of records) {
    bytes[recPos] = 0x20; // not deleted
    let fPos = recPos + 1;
    rec.forEach((value, fi) => {
      const raw = new TextEncoder().encode(value.padEnd(fields[fi].length, " "));
      bytes.set(raw.slice(0, fields[fi].length), fPos);
      fPos += fields[fi].length;
    });
    recPos += recordLength;
  }
  return out;
}

const dbfBuf = buildDbf(
  [
    { name: "SITE", type: "C", length: 10, decimals: 0 },
    { name: "VALUE", type: "N", length: 10, decimals: 2 },
    { name: "ACTIVE", type: "L", length: 1, decimals: 0 },
  ],
  [
    ["PUMP-01   ", "  125.50  ", "T"],
    ["GAUGE-02  ", "   98.30  ", "F"],
    ["—", "0", "?"],
  ]
);

const dbf = parseDbf(dbfBuf);
if (dbf.fields.length !== 3 || dbf.records.length !== 3) {
  console.error(`FAIL: dbf structure wrong (${dbf.fields.length} fields, ${dbf.records.length} records)`);
  process.exit(1);
}
if (dbf.records[0]["SITE"] !== "PUMP-01" || dbf.records[0]["VALUE"] !== 125.5 || dbf.records[0]["ACTIVE"] !== true) {
  console.error(`FAIL: dbf typed values wrong: ${JSON.stringify(dbf.records[0])}`);
  process.exit(1);
}
if (dbf.records[1]["ACTIVE"] !== false || dbf.records[2]["VALUE"] !== 0) {
  console.error("FAIL: dbf boolean/numeric coercion wrong");
  process.exit(1);
}
if (inferCategory(dbf.records[0]) !== "terrain") {
  console.error("FAIL: category inference should default to terrain for neutral attributes");
  process.exit(1);
}
console.log("PASS: .dbf typed-field parse (C/N/L coercion)");

// ── GeoJSON ──────────────────────────────────────────────────────────────────
const gj = parseGeoJson(
  JSON.stringify({
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { roadtype: "primary" }, geometry: { type: "LineString", coordinates: [[250000, 9850000], [250100, 9850100]] } },
      { type: "Feature", properties: { river: "true" }, geometry: { type: "Point", coordinates: [250050, 9850050] } },
      { type: "Feature", properties: null, geometry: { type: "MultiPolygon", coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] } },
    ],
  })
);
if (gj.features.length !== 3) {
  console.error("FAIL: GeoJSON feature count");
  process.exit(1);
}
const line = geometryToParts(gj.features[0].geometry!);
if (line?.kind !== "line" || line.parts[0].length !== 2) {
  console.error("FAIL: GeoJSON LineString parts");
  process.exit(1);
}
if (inferCategory(gj.features[0].properties!) !== "road" || inferCategory(gj.features[1].properties!) !== "water") {
  console.error("FAIL: GeoJSON attribute-driven category inference");
  process.exit(1);
}
const mp = geometryToParts(gj.features[2].geometry!);
if (mp?.kind !== "polygon" || mp.parts.length !== 1) {
  console.error("FAIL: GeoJSON MultiPolygon flattening");
  process.exit(1);
}
console.log("PASS: GeoJSON parse + typed category inference");

// ── End-to-end ingestFiles ───────────────────────────────────────────────────
const shpFile = new File([shpBuf], "parcels.shp");
const dbfFile = new File([dbfBuf], "parcels.dbf");
const gjFile = new File([JSON.stringify({
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { name: "POINT A" }, geometry: { type: "Point", coordinates: [250500, 9850500] } },
  ],
})], "extras.geojson");

const result = await ingestFiles([shpFile, dbfFile, gjFile]);
// 2 shp points + 3 polyline vertices + 1 geojson point = 6 survey points
if (result.points.length !== 6) {
  console.error(`FAIL: ingest point count ${result.points.length} != 6`);
  process.exit(1);
}
if (!result.layerName.includes("parcels") || !result.layerName.includes("extras")) {
  console.error(`FAIL: layer naming: ${result.layerName}`);
  process.exit(1);
}
if (result.stats.pointFeatures !== 3 || result.stats.lineFeatures !== 1) {
  console.error(`FAIL: ingest stats: ${JSON.stringify(result.stats)}`);
  process.exit(1);
}
const first = result.points[0];
if (first.rawCode !== "PUMP-01" || first.category !== "terrain") {
  console.error(`FAIL: attribute seeding: ${first.rawCode}/${first.category}`);
  process.exit(1);
}
if (!Number.isFinite(first.easting) || first.easting <= 0) {
  console.error("FAIL: coordinate sanity");
  process.exit(1);
}
console.log("PASS: end-to-end ingestFiles (SHP+DBF+GeoJSON → SurveyPoint[])");

console.log("\nALL INGEST TESTS PASSED");
