/**
 * Automated Test Suite: Advanced Spatial Analysis & Geoprocessing Extensions
 */

import {
  pointInPolygon,
  calculatePolygonArea,
  computeConvexHull,
  executeSpatialJoin,
  computeThiessenPolygons,
  subdivideParcelEqualArea,
} from "../src/core/spatial-analysis";
import { SurveyPoint } from "../src/types/spatial";

console.log("=== METARDU GIS STUDIO - ADVANCED GEOPROCESSING TEST SUITE ===");

// 1. Polygon Area & Point in Polygon
// Square 100m x 100m = 10,000 m² (1.0 Ha)
const square: [number, number][] = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
];
const area = calculatePolygonArea(square);
if (Math.abs(area - 10000) > 1e-3) throw new Error(`Shoelace area failed: expected 10,000, got ${area}`);
if (!pointInPolygon(50, 50, square)) throw new Error("Point (50, 50) should be inside square");
if (pointInPolygon(150, 50, square)) throw new Error("Point (150, 50) should be outside square");
console.log("PASS: Shoelace area and Jordan ray-casting point-in-polygon verified.");

// 2. Convex Hull Algorithm (Monotone Chain)
const cloud: [number, number][] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
  [5, 5],
  [2, 3],
  [7, 8],
];
const hull = computeConvexHull(cloud);
if (hull.length !== 4) throw new Error(`Convex hull should have 4 extreme points, got ${hull.length}`);
console.log(`PASS: Convex hull computed: ${hull.length} boundary vertices.`);

// 3. Spatial Join (Point-in-Polygon Aggregation)
const testPoints: SurveyPoint[] = [
  { id: "P1", easting: 25, northing: 25, elevation: 1600, rawCode: "BLD", category: "building", properties: { dailyDemandKwh: 2.5 } },
  { id: "P2", easting: 75, northing: 75, elevation: 1620, rawCode: "BLD", category: "building", properties: { dailyDemandKwh: 3.5 } },
  { id: "P3", easting: 200, northing: 200, elevation: 1650, rawCode: "CTR", category: "control" },
];
const joinResults = executeSpatialJoin(
  [{ id: "parcel-1", name: "Survey Plot 1", coordinates: square }],
  testPoints
);
if (joinResults.length !== 1) throw new Error("Spatial join failed");
const res1 = joinResults[0];
if (res1.pointCount !== 2) throw new Error(`Spatial join point count failed: expected 2, got ${res1.pointCount}`);
if (Math.abs((res1.totalDemandKwh || 0) - 6.0) > 1e-3) throw new Error("Aggregated demand calculation failed");
if (Math.abs(res1.averageElevationM - 1610) > 1e-3) throw new Error("Average elevation calculation failed");
console.log(`PASS: Spatial join aggregated 2 points: Total Demand = ${res1.totalDemandKwh} kWh, Avg Elev = ${res1.averageElevationM}m.`);

// 4. Voronoi / Thiessen Polygons
const seedPoints: SurveyPoint[] = [
  { id: "CLINIC-A", easting: 20, northing: 50, elevation: 1600, rawCode: "CLINIC", category: "building" },
  { id: "CLINIC-B", easting: 80, northing: 50, elevation: 1610, rawCode: "CLINIC", category: "building" },
];
const voronoi = computeThiessenPolygons(seedPoints, { minE: 0, maxE: 100, minN: 0, maxN: 100 });
if (voronoi.length !== 2) throw new Error(`Expected 2 Voronoi cells, got ${voronoi.length}`);
console.log(`PASS: Thiessen Voronoi polygons partitioned space for ${voronoi.length} facilities.`);

// 5. Cadastral Equal-Area Parcel Subdivision
const subdiv = subdivideParcelEqualArea(square, 2);
if (subdiv.subParcels.length !== 2) throw new Error("Subdivision should yield 2 sub-parcels");
const p1Area = subdiv.subParcels[0].areaM2;
const p2Area = subdiv.subParcels[1].areaM2;
if (Math.abs(p1Area - 5000) > 50 || Math.abs(p2Area - 5000) > 50) {
  throw new Error(`Equal-area subdivision unbalanced: P1=${p1Area}m², P2=${p2Area}m² (target ~5000m²)`);
}
console.log(`PASS: Cadastral equal-area subdivision verified: P1=${p1Area}m², P2=${p2Area}m² (Target 5,000m²).`);

console.log("ALL ADVANCED GEOPROCESSING TESTS PASSED SUCCESSFULLY.");
