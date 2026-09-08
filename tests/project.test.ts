/**
 * Unit Test for Project Persistence (.metardu.json)
 */

import { createProjectSnapshot, parseProjectFile } from "../src/core/project";
import { PipelineResult } from "../src/types/spatial";

console.log("=== METARDU GIS STUDIO - PROJECT PERSISTENCE TEST SUITE ===");

const dummyPipeline: PipelineResult = {
  metadata: {
    id: "TEST-01",
    title: "Nairobi Solar Cadastre",
    locality: "Embakasi",
    country: "Kenya",
    crs: "Arc 1960 / UTM zone 37S (EPSG: 21037)",
    surveyorName: "Lead Geomatics Engineer",
    registrationNo: "MISK-2026",
    date: "2026-09-08",
    scale: "1:2,500",
    organization: "MetaRDU Geospatial",
  },
  points: [
    { id: "B1", easting: 250000, northing: 9850000, elevation: 1650, rawCode: "BL", category: "boundary", description: "B1", properties: { zoning: "Commercial", height_limit: 45 } },
    { id: "B2", easting: 250200, northing: 9850000, elevation: 1652, rawCode: "BL", category: "boundary", description: "B2", properties: { zoning: "Commercial", height_limit: 45 } },
  ],
  vectors: [],
  boundary: null,
  tin: null,
  contours: [],
  buffers: [],
  suitability: [],
  hazardSinks: [],
  exposedAssets: [],
  energyClusters: [],
  telemetries: [],
  totalDurationMs: 42,
};

// 1. Create project snapshot
const snapshot = createProjectSnapshot(dummyPipeline);
console.log(`Snapshot created: Format = ${snapshot.format}, Version = ${snapshot.version}, Points = ${snapshot.points.length}`);

if (snapshot.format !== "METARDU_GIS_PROJECT" || snapshot.points.length !== 2) {
  console.error("FAIL: Snapshot format invalid!");
  process.exit(1);
}
console.log("PASS: Project snapshot generated.");

// 2. Serialize to JSON and restore
const jsonStr = JSON.stringify(snapshot, null, 2);
const restored = parseProjectFile(jsonStr);

console.log(`Restored project: ${restored.projectName}, CRS: ${restored.crs}, Points: ${restored.points.length}`);

if (
  restored.projectName !== "Nairobi Solar Cadastre" ||
  restored.points[0].properties?.zoning !== "Commercial" ||
  restored.points[0].properties?.height_limit !== 45
) {
  console.error("FAIL: Restored project attributes mismatch!");
  process.exit(1);
}
console.log("PASS: Full project roundtrip persistence verified.");

console.log("ALL PROJECT PERSISTENCE TESTS PASSED SUCCESSFULLY.");
