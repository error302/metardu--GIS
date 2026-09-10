/**
 * Automated Test Suite: Interactive Digitizing, COGO Drafting & History Management
 */

import { HistoryManager } from "../src/core/history";
import {
  findNearestSnapTarget,
  pointToSegmentDistance,
  calculateCogoLeg,
  getNextPointId,
} from "../src/core/digitizing";
import { SurveyPoint, VectorFeature } from "../src/types/spatial";

console.log("=== METARDU GIS STUDIO - DIGITIZING & COGO TEST SUITE ===");

// 1. HistoryManager Test (Memento Pattern)
const history = new HistoryManager<{ points: number[] }>(5);
let state = { points: [1, 2, 3] };

// Action 1: Add point 4
history.push("Add point 4", state);
state = { points: [1, 2, 3, 4] };

// Action 2: Add point 5
history.push("Add point 5", state);
state = { points: [1, 2, 3, 4, 5] };

if (!history.canUndo()) throw new Error("History should have undo capability");
const undo1 = history.undo(state);
if (!undo1 || undo1.state.points.length !== 4) throw new Error("Undo failed to restore prior state (length 4)");
state = undo1.state;

const redo1 = history.redo(state);
if (!redo1 || redo1.state.points.length !== 5) throw new Error("Redo failed to restore next state (length 5)");
state = redo1.state;
console.log("PASS: HistoryManager undo/redo stack verified.");

// 2. Point to Segment Distance Test
const pDist = pointToSegmentDistance(5, 5, 0, 0, 10, 0);
if (Math.abs(pDist.distance - 5) > 1e-4) throw new Error(`Segment distance calculation failed: expected 5, got ${pDist.distance}`);
if (Math.abs(pDist.closestX - 5) > 1e-4 || Math.abs(pDist.closestY - 0) > 1e-4) {
  throw new Error("Segment projection coordinates incorrect");
}
console.log("PASS: Point-to-segment perpendicular distance verified.");

// 3. Vertex & Edge Snapping Test
const testPoints: SurveyPoint[] = [
  { id: "BK1", easting: 100, northing: 100, elevation: 1500, rawCode: "PB", category: "boundary" },
  { id: "BK2", easting: 200, northing: 100, elevation: 1510, rawCode: "PB", category: "boundary" },
];
const testVectors: VectorFeature[] = [
  {
    id: "vec-bnd",
    featureName: "Cadastral Boundary",
    category: "boundary",
    color: "#3B82F6",
    lineWidth: 2,
    lineType: "solid",
    points: testPoints,
    isClosed: false,
  },
];

// Snap to vertex BK1 (distance ~2m < tolerance 5m)
const snapVertex = findNearestSnapTarget(101.5, 101.2, testPoints, testVectors, 5.0);
if (!snapVertex.snapped || snapVertex.type !== "vertex" || snapVertex.targetId !== "BK1") {
  throw new Error("Vertex snapping failed to lock onto BK1");
}

// Snap to edge between BK1 and BK2 (at E=150, N=102, dist = 2m < 5m)
const snapEdge = findNearestSnapTarget(150, 102, testPoints, testVectors, 5.0);
if (!snapEdge.snapped || snapEdge.type !== "edge") {
  throw new Error("Edge snapping failed to lock onto segment");
}
if (Math.abs(snapEdge.x - 150) > 1e-4 || Math.abs(snapEdge.y - 100) > 1e-4) {
  throw new Error(`Edge snapping coordinates incorrect: expected (150, 100), got (${snapEdge.x}, ${snapEdge.y})`);
}
console.log("PASS: Real-time vertex and edge snapping verified.");

// 4. COGO Radiation Calculation Test
// Radiate from BK1 (100, 100) along Due East (90 deg) for 50m -> (150, 100)
const radiatedPt = calculateCogoLeg(testPoints[0], "90-00-00", 50, "BK3", "PB", "boundary", testPoints);
if (Math.abs(radiatedPt.easting - 150) > 1e-2 || Math.abs(radiatedPt.northing - 100) > 1e-2) {
  throw new Error(`COGO radiation calculation failed: expected (150, 100), got (${radiatedPt.easting}, ${radiatedPt.northing})`);
}
console.log(`PASS: COGO radiation calculated: ${radiatedPt.id} at (${radiatedPt.easting}, ${radiatedPt.northing}).`);

// 5. Point ID Auto-Increment Test
const nextId = getNextPointId(testPoints, "BK");
if (nextId !== "BK3") throw new Error(`Auto-increment failed: expected BK3, got ${nextId}`);
console.log(`PASS: Next auto-incremented ID verified: ${nextId}.`);

console.log("ALL DIGITIZING & COGO TESTS PASSED SUCCESSFULLY.");
