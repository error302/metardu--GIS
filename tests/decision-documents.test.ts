/**
 * Phase D — decision documents tests:
 *  1. renderTemplate RenderOptions: MCDA weights disclosed on the method note.
 *  2. Scenario snapshot + compare: metrics derived from the document, delta
 *     judgment by direction of merit, baseline reordering.
 */

import { renderTemplate } from "../src/core/composer/render";
import { atlasPreset } from "../src/core/composer/presets";
import {
  snapshotScenario, compareScenarios, formatRowValue, deltaVsBaseline, ScenarioSnapshot,
} from "../src/core/scenario-compare";
import { McdaWeights, PipelineResult, SurveyPoint, BoundaryPolygon } from "../src/types/spatial";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) console.log(`PASS: ${msg}`);
  else {
    console.error(`FAIL: ${msg}`);
    failures++;
  }
}

console.log("=== DECISION DOCUMENTS TEST SUITE ===");

/* ---------------- fixture ---------------- */

const pts: SurveyPoint[] = [
  { id: "B1", easting: 250000, northing: 9850000, elevation: 1650, rawCode: "BL", category: "boundary", description: "B1" },
  { id: "B2", easting: 250100, northing: 9850000, elevation: 1651, rawCode: "BL", category: "boundary", description: "B2" },
  { id: "B3", easting: 250100, northing: 9850100, elevation: 1652, rawCode: "BL", category: "boundary", description: "B3" },
  { id: "B4", easting: 250000, northing: 9850100, elevation: 1651, rawCode: "BL", category: "boundary", description: "B4" },
];
const boundary: BoundaryPolygon = {
  id: "bnd", name: "Parcel", parcelNo: "LR/7/1", points: pts,
  perimeterM: 400, areaSqM: 10000, areaHa: 1.0, areaAcres: 2.471, isClosed: true,
  linearMisclosureM: 0.03, precisionRatio: 12500, precisionRating: "Class A (Urban)",
  bearingsDistances: [],
};
const result: PipelineResult = {
  metadata: {
    id: "DEC-01", title: "Decision Test", locality: "L", country: "Kenya",
    crs: "Arc 1960 / UTM zone 37S (EPSG: 21037)", surveyorName: "S", registrationNo: "R",
    date: "2026-09-10", scale: "1:2,500", organization: "MetaRDU GIS Workstation",
  },
  points: pts, vectors: [], boundary, tin: null,
  contours: [], buffers: [],
  suitability: [
    { x: 0, y: 0, score: 85, category: "optimal", slope: 2, distToRoadM: 10, distToRiverM: 200, distToInfraM: 50 },
    { x: 1, y: 0, score: 45, category: "moderate", slope: 12, distToRoadM: 120, distToRiverM: 90, distToInfraM: 300 },
    { x: 2, y: 0, score: 8, category: "hazard", slope: 30, distToRoadM: 400, distToRiverM: 10, distToInfraM: 900 },
  ],
  hazardSinks: [{ id: "S1", center: [0, 0], minElevation: 1640, spillElevation: 1645, depthM: 5, pondingAreaSqM: 250, riskLevel: "medium" }],
  exposedAssets: [],
  energyClusters: [{
    id: "C1", centroid: [0, 0], householdCount: 12, populationEstimate: 60, clusterRadiusM: 150,
    gridDistanceKm: 3, solarGhiKwhM2: 5.5, recommendedType: "Mini-Grid", dailyDemandKwh: 48,
    recommendedSolarKw: 11, batteryStorageKwh: 48, capexEstimateUsd: 19000, nightTimeLuminosity: "Dark (Unserved)",
  }],
  telemetries: [], totalDurationMs: 1,
};

/* ---------------- 1. weights disclosure on the sheet ---------------- */

const w: McdaWeights = { slopeWeight: 50, roadAccessWeight: 10, waterBufferWeight: 30, socialInfraWeight: 10, maxSlopeAllowed: 25, riparianBufferM: 30 };

const plain = renderTemplate(atlasPreset(), result).svg;
const tuned = renderTemplate(atlasPreset(), result, { mcdaWeights: w }).svg;

check(!plain.includes("MCDA weights"), "default render does not invent a weights line");
check(
  tuned.includes("slope 50 · road 10 · water 30 · infra 10"),
  "adjusted render discloses the exact weights",
);
check(
  tuned.includes("user-adjusted for sensitivity review"),
  "adjusted weights are disclosed as a sensitivity review",
);
check(tuned.includes("Uncertainty:"), "uncertainty line present (precision-bounded figures)");
check(tuned.includes("1:12,500"), "uncertainty quotes the real traverse precision");
check(tuned.includes("not a rainfall-runoff forecast"), "hazard limitation disclosed");
check(
  renderTemplate(atlasPreset(), result, { mcdaWeights: { ...w, slopeWeight: 35, roadAccessWeight: 25, waterBufferWeight: 25, socialInfraWeight: 15 } }).svg.includes("document defaults"),
  "default weights render as document defaults",
);

/* ---------------- 2. scenario snapshot & compare ---------------- */

const s1 = snapshotScenario("Baseline (defaults)", result, { ...w, slopeWeight: 35, roadAccessWeight: 25, waterBufferWeight: 25, socialInfraWeight: 15 });
const s2 = snapshotScenario("Access-first", result, w);

check(s1.metrics.areaHa === 1.0 && s1.metrics.precisionRatio === 12500, "snapshot derives boundary metrics from the document");
check(s1.metrics.optimalPct === 33.3 && s1.metrics.hazardPct === 33.3, "snapshot derives class distribution from the document");
check(s1.metrics.householdTotal === 12 && s1.metrics.capexUsd === 19000, "snapshot derives energy totals from the document");
check(s1.id !== s2.id, "snapshot ids unique");

const rows = compareScenarios([s1, s2]);
check(rows.length >= 12, "comparison covers the full metric set");
const precisionRow = rows.find((r) => r.kind === "value" && r.label === "Traverse precision")!;
check(precisionRow.better === "higher", "precision direction of merit is higher");
const hazardRow = rows.find((r) => r.kind === "value" && r.label === "Hazard cells")!;
check(hazardRow.better === "lower", "hazard direction of merit is lower");

// Baseline first: delta of baseline itself is null; second column computed.
check(deltaVsBaseline(precisionRow, 0) === null, "baseline has no delta");
const d = deltaVsBaseline(precisionRow, 1)!;
check(d.delta === 0 && d.good, "identical states give zero delta judged neutral-good");

// Synthetic divergent scenario to prove judgment direction.
const s3: ScenarioSnapshot = {
  ...s2,
  id: "s3",
  name: "Worse hazard",
  metrics: { ...s2.metrics, hazardPct: s2.metrics.hazardPct + 10, precisionRatio: s2.metrics.precisionRatio! + 5000 },
};
const rows2 = compareScenarios([s1, s3]);
const hz = rows2.find((r) => r.kind === "value" && r.label === "Hazard cells")!;
const hzDelta = deltaVsBaseline(hz, 1)!;
check(hzDelta.delta > 0 && !hzDelta.good, "hazard increase judged BAD");
const pr = rows2.find((r) => r.kind === "value" && r.label === "Traverse precision")!;
const prDelta = deltaVsBaseline(pr, 1)!;
check(prDelta.delta > 0 && prDelta.good, "precision increase judged GOOD");
check(formatRowValue(hz, 1) === "43.3", "row formatter renders the real value");

// Baseline reordering: baseline first, others keep order.
const reordered = [s2, s1];
const rows3 = compareScenarios(reordered);
check(rows3.length === rows.length, "comparison works with any baseline order");

console.log(failures === 0 ? "ALL DECISION DOCUMENTS TESTS PASSED" : `${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
