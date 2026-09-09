/**
 * QA: exercise the DXF and GeoJSON exporters against a corridor-bearing
 * pipeline result to verify the new closed-boundary outputs end-to-end.
 */
import { generateCorridorBuffers, ringArea } from "../src/core/buffer-engine";
import { exportToDxf } from "../src/exporters/dxf-exporter";
import { exportToGeoJson } from "../src/exporters/geojson-exporter";
import type { PipelineResult, SurveyVector, SurveyPoint } from "../src/types/spatial";

const pts = (id: string, coords: [number, number][], cat: SurveyPoint["category"]) =>
  coords.map(([e, n], i) => ({
    id: `${id}-p${i}`, easting: e, northing: n, elevation: 0,
    rawCode: "", category: cat, description: "",
  }));

const road: SurveyVector = {
  id: "VEC-ROAD-1", code: "RD-CL", name: "Kangundo Rd", category: "road",
  layer: "INFRA-ROAD",
  points: pts("r", [[1000, 2000], [1100, 2000], [1100, 2120]], "road"),
  isClosed: false, color: "#000", lineType: "solid", lineWidth: 1,
};
const river: SurveyVector = {
  id: "VEC-RIV-1", code: "RIV", name: "Ngong River", category: "water",
  layer: "HYDRO-RIVER",
  points: pts("w", [[950, 1950], [1050, 1990], [1150, 1950]], "water"),
  isClosed: false, color: "#000", lineType: "solid", lineWidth: 1,
};
const building: SurveyPoint = {
  id: "BLD-1", easting: 1098, northing: 2004, elevation: 0,
  rawCode: "BLD", category: "building", description: "kiosk",
};

const buffers = generateCorridorBuffers([road, river], [building], 15, 30);
console.log(`buffers: ${buffers.length}`);
for (const b of buffers) {
  console.log(
    `  ${b.id} verts=${b.polygon.length} registerArea=${b.areaSqM} ringArea=${ringArea(b.polygon).toFixed(2)} encroachment=${b.encroachmentDetected}`
  );
}

const result = {
  points: [building],
  vectors: [road, river],
  boundary: null,
  buffers,
  contours: [],
  tin: null,
  suitability: [],
  hazardSinks: [],
  exposedAssets: [],
  energyClusters: [],
  telemetries: [],
  totalDurationMs: 0,
  metadata: {
    id: "qa", title: "QA Corridor Export", locality: "Nairobi", country: "Kenya",
    crs: "EPSG:21037", surveyorName: "QA", registrationNo: "QA-1",
    date: "2026-09-10", scale: "1:1250", organization: "MetaRDU QA",
  },
} as unknown as PipelineResult;

/* --- DXF checks --- */
const dxf = exportToDxf(result);
const lwpolylines = dxf.split("\n").filter((l) => l.trim() === "LWPOLYLINE").length;
const closedFlags = dxf.split("\n").filter((l) => l.trim() === "1" && false).length;
// Verify structure: LWPOLYLINE followed by layer, vertex count (90), closed flag (70)=1
const dxfLines = dxf.split("\n");
let polyOk = 0;
for (let i = 0; i < dxfLines.length; i++) {
  if (dxfLines[i].trim() === "LWPOLYLINE") {
    const window = dxfLines.slice(i, i + 10).map((l) => l.trim());
    const hasLayer = window.includes("SETBACK-BUFFERS");
    const v90 = window[window.indexOf("90") + 1];
    const f70 = window[window.indexOf("70") + 1];
    if (hasLayer && Number(v90) > 4 && f70 === "1") polyOk++;
  }
}
console.log(`\nDXF: LWPOLYLINE entities=${lwpolylines}, well-formed closed rings=${polyOk}`);
if (lwpolylines !== 2 || polyOk !== 2) {
  console.error("FAIL: expected 2 well-formed closed LWPOLYLINEs (road + river)");
  process.exit(1);
}

/* --- GeoJSON checks --- */
const gj = JSON.parse(exportToGeoJson(result));
const polys = gj.features.filter((f: any) => f.geometry.type === "Polygon");
console.log(`GeoJSON: polygon features=${polys.length}`);
for (const f of polys) {
  const ring = f.geometry.coordinates[0];
  const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  console.log(
    `  ${f.properties.id}: ring=${ring.length} closed=${closed} width=${f.properties.reserveWidthM} enc=${f.properties.encroachmentDetected}`
  );
  if (!closed || ring.length < 4) {
    console.error("FAIL: GeoJSON corridor ring not closed");
    process.exit(1);
  }
}
if (polys.length !== 2) {
  console.error("FAIL: expected 2 corridor Polygon features");
  process.exit(1);
}

const enc = polys.find((f: any) => f.properties.id.startsWith("BUF-1"));
if (!enc || enc.properties.encroachmentDetected !== true) {
  console.error("FAIL: road corridor should flag the kiosk encroachment");
  process.exit(1);
}

console.log("\nEXPORTER QA PASSED (DXF LWPOLYLINE + GeoJSON corridor Polygons)");
