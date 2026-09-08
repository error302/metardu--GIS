/**
 * Unit Test for COGO, Traverse Adjustment, and Topology Repair
 */

import { cogoInverse, cogoForward, dmsToDecimal, intersectBearingBearing, offsetLineSegment } from "../src/core/cogo";
import { adjustTraverseBowditch, adjustTraverseFromObservations } from "../src/core/traverse-adjust";
import { auditTopologyDefects, repairTopology } from "../src/core/topology";
import { SurveyPoint } from "../src/types/spatial";

console.log("=== METARDU GIS STUDIO - COGO & TRAVERSE ADJUSTMENT TEST SUITE ===");

// 1. DMS Parsing
const dec = dmsToDecimal("124°30'36\"");
console.log(`Parsed 124°30'36" -> ${dec.toFixed(4)}°`);
if (Math.abs(dec - 124.51) > 0.001) {
  console.error("FAIL: DMS conversion incorrect!");
  process.exit(1);
}
console.log("PASS: DMS parsing verified.");

// 2. COGO Forward & Inverse Roundtrip
const p1 = { easting: 250000, northing: 9850000, elevation: 1650 };
const bearing = 45.0; // NE
const distance = 100.0; // 100m
const p2 = cogoForward(p1, bearing, distance);
console.log(`COGO Forward: Origin -> (${p2.easting}, ${p2.northing})`);

const inv = cogoInverse(p1, p2);
console.log(`COGO Inverse: Distance = ${inv.distanceM}m, Bearing = ${inv.bearingDms}`);
if (Math.abs(inv.distanceM - 100.0) > 0.01 || Math.abs(inv.bearingDeg - 45.0) > 0.01) {
  console.error("FAIL: COGO Forward/Inverse roundtrip error!");
  process.exit(1);
}
console.log("PASS: COGO Forward/Inverse roundtrip verified.");

// 3. Bearing-Bearing Intersection
const r1Origin = { easting: 0, northing: 0 };
const r2Origin = { easting: 100, northing: 0 };
// Ray 1: Easting 0, Northing 0 bearing 45° (dx=1, dy=1)
// Ray 2: Easting 100, Northing 0 bearing 315° (-45°, dx=-1, dy=1)
// Intersection should be (50, 50)
const isect = intersectBearingBearing(r1Origin, 45, r2Origin, 315);
console.log("Intersection:", isect);
if (!isect || Math.abs(isect.easting - 50) > 0.01 || Math.abs(isect.northing - 50) > 0.01) {
  console.error("FAIL: Bearing-Bearing intersection mismatch!");
  process.exit(1);
}
console.log("PASS: Bearing-Bearing intersection verified (50.000, 50.000).");

// 4. Closed Traverse Adjustment (Bowditch Rule) from field observations
const startStation = { id: "STN_1", easting: 250000.0, northing: 9850000.0 };
const fieldObservations = [
  { fromId: "STN_1", toId: "STN_2", distanceM: 100.02, bearingDeg: 90.0 },  // East
  { fromId: "STN_2", toId: "STN_3", distanceM: 200.01, bearingDeg: 0.0 },   // North
  { fromId: "STN_3", toId: "STN_4", distanceM: 100.01, bearingDeg: 270.0 }, // West
  { fromId: "STN_4", toId: "STN_1", distanceM: 200.02, bearingDeg: 180.0 }, // South
];

const report = adjustTraverseFromObservations(startStation, fieldObservations, startStation, 5000);
console.log(`Traverse Perimeter: ${report.totalPerimeterM}m, Misclosure: ${report.linearMisclosureM}m, Precision: ${report.precisionFraction}, Status: ${report.status}`);

if (report.linearMisclosureM <= 0 || report.relativePrecisionRatio < 5000 || report.status !== "PASSED") {
  console.error("FAIL: Traverse adjustment failed or precision invalid!");
  process.exit(1);
}
console.log("PASS: Bowditch traverse adjustment verified.");

// 5. Topology Defects & Repair
const dirtyPoints: SurveyPoint[] = [
  { id: "B1", easting: 250000, northing: 9850000, elevation: 1650, rawCode: "BL", category: "boundary", description: "B1" },
  { id: "B1_DUP", easting: 250000.01, northing: 9850000.01, elevation: 1650, rawCode: "BL", category: "boundary", description: "B1 duplicate" },
  { id: "B2", easting: 250100, northing: 9850000, elevation: 1650, rawCode: "BL", category: "boundary", description: "B2" },
  { id: "B3", easting: 250100, northing: 9850100, elevation: 1650, rawCode: "BL", category: "boundary", description: "B3" },
];

const audit = auditTopologyDefects(dirtyPoints, 0.05);
console.log("Topology defects found:", audit.defects.length);
if (audit.defects.length === 0) {
  console.error("FAIL: Expected to detect duplicate vertex defect!");
  process.exit(1);
}

const cleaned = repairTopology(dirtyPoints, 0.05);
console.log(`Cleaned points count: ${cleaned.length} (original: ${dirtyPoints.length})`);
if (cleaned.length !== 3) {
  console.error("FAIL: Expected 3 points after deduplication repair!");
  process.exit(1);
}
console.log("PASS: Topology audit and snapping repair verified.");

console.log("ALL COGO, TRAVERSE & TOPOLOGY TESTS PASSED SUCCESSFULLY.");
