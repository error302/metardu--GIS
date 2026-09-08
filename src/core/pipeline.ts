/**
 * Master Autonomous Survey-to-GIS Pipeline Orchestrator
 * Executes the entire spatial pipeline end-to-end in milliseconds with high-resolution micro-telemetry.
 */

import {
  SurveyPoint,
  PipelineResult,
  PipelineTelemetry,
  ProjectMetadata,
  McdaWeights,
} from "../types/spatial";
import { parseRawSurveyText } from "./parser";
import { reduceOrthometricHeight } from "./geodesy";
import { generateFeatureVectors } from "./feature-coding";
import { generateTinMesh } from "./tin-engine";
import { generateContours } from "./contour-engine";
import { auditBoundaryTopology } from "./topology";
import { generateCorridorBuffers } from "./buffer-engine";
import { evaluateSuitabilityGrid, DEFAULT_MCDA_WEIGHTS } from "./mcda-suitability";
import { auditHazardExposure } from "./hazard-exposure";
import { modelEnergyClusters } from "./energy-catchment";

export async function runAutonomousGisPipeline(
  rawInput: string | SurveyPoint[],
  metadata: ProjectMetadata,
  mcdaWeights: McdaWeights = DEFAULT_MCDA_WEIGHTS
): Promise<PipelineResult> {
  const startTime = performance.now();
  const telemetries: PipelineTelemetry[] = [];

  // ── Step 1: Raw Ingest & Delimiter Sniffing ──
  const t0 = performance.now();
  let points: SurveyPoint[] = [];
  if (typeof rawInput === "string") {
    points = parseRawSurveyText(rawInput);
  } else {
    points = [...rawInput];
  }
  const d0 = Number((performance.now() - t0).toFixed(1));
  telemetries.push({
    stepName: "1. Ingest & Coordinate Parsing",
    durationMs: d0,
    status: points.length > 0 ? "pass" : "fail",
    details: `Ingested ${points.length} survey stations with auto-column mapping.`,
  });

  if (points.length === 0) {
    return {
      metadata,
      points: [],
      vectors: [],
      boundary: null,
      tin: null,
      contours: [],
      buffers: [],
      suitability: [],
      hazardSinks: [],
      exposedAssets: [],
      energyClusters: [],
      telemetries,
      totalDurationMs: Number((performance.now() - startTime).toFixed(1)),
    };
  }

  // ── Step 2: Geodetic & Geoid MSL Elevation Reduction (H = h - N) ──
  const t1 = performance.now();
  const reducedPoints = points.map((p) => {
    // Standard central Kenya lat/lon approximation from UTM 37S coordinates
    const approxLat = (p.northing - 10000000) / 110574;
    const approxLon = 36.8 + (p.easting - 250000) / 111320;
    const { orthometricH, geoidN } = reduceOrthometricHeight(p.elevation, approxLat, approxLon);
    return {
      ...p,
      elevation: orthometricH,
      ellipsoidHeight: p.elevation,
      geoidN,
      latitude: Number(approxLat.toFixed(6)),
      longitude: Number(approxLon.toFixed(6)),
    };
  });
  const d1 = Number((performance.now() - t1).toFixed(1));
  telemetries.push({
    stepName: "2. Geodesy & Geoid MSL Reduction",
    durationMs: d1,
    status: "pass",
    details: `EGM2008 / KEN_GEOID (H = h - N) applied. Orthometric elevations computed.`,
  });

  // ── Step 3: Field-to-Finish Feature Vectorization ──
  const t2 = performance.now();
  const vectors = generateFeatureVectors(reducedPoints);
  const d2 = Number((performance.now() - t2).toFixed(1));
  telemetries.push({
    stepName: "3. Field-to-Finish Feature Coding",
    durationMs: d2,
    status: "pass",
    details: `Vectorized ${vectors.length} CAD layers (boundaries, roads, buildings, hydrology).`,
  });

  // ── Step 4: 3D Surface Triangulation (TIN) & Marching Contours ──
  const t3 = performance.now();
  const tin = generateTinMesh(reducedPoints);
  const contours = generateContours(tin, 1.0, 5.0);
  const d3 = Number((performance.now() - t3).toFixed(1));
  telemetries.push({
    stepName: "4. Delaunay TIN & Contouring",
    durationMs: d3,
    status: "pass",
    details: `Built ${tin.triangles.length} Delaunay faces & ${contours.length} smoothed isolines.`,
  });

  // ── Step 5: Cadastral Topology & Bowditch Precision Audit ──
  const t4 = performance.now();
  const boundary = auditBoundaryTopology(reducedPoints, metadata.title);
  const d4 = Number((performance.now() - t4).toFixed(1));
  telemetries.push({
    stepName: "5. Cadastral Topology & Misclosure",
    durationMs: d4,
    status: boundary ? (boundary.precisionRatio >= 5000 ? "pass" : "warn") : "warn",
    details: boundary
      ? `Area: ${boundary.areaHa} Ha (${boundary.areaAcres} Ac) | Precision: 1:${boundary.precisionRatio} (${boundary.precisionRating}).`
      : "No closed boundary beacons detected in dataset.",
  });

  // ── Step 6: Corridor Buffers & Encroachment Checks ──
  const t5 = performance.now();
  const buffers = generateCorridorBuffers(vectors, reducedPoints, 15.0, 30.0);
  const d5 = Number((performance.now() - t5).toFixed(1));
  telemetries.push({
    stepName: "6. Corridor & Riparian Buffering",
    durationMs: d5,
    status: "pass",
    details: `Generated ${buffers.length} corridor reserves (15m road / 30m riparian setbacks).`,
  });

  // ── Step 7: UN-Habitat Climate-Smart Suitability (MCDA) ──
  const t6 = performance.now();
  const suitability = evaluateSuitabilityGrid(tin, vectors, mcdaWeights, 20);
  const d6 = Number((performance.now() - t6).toFixed(1));
  telemetries.push({
    stepName: "7. UN-Habitat Climate-Smart MCDA",
    durationMs: d6,
    status: "pass",
    details: `Computed ${suitability.length} multi-criteria suitability cells across terrain slope & setbacks.`,
  });

  // ── Step 8: Hazard & Climate Risk Vulnerability Audit ──
  const t7 = performance.now();
  const { sinks: hazardSinks, exposedAssets } = auditHazardExposure(tin, reducedPoints);
  const d7 = Number((performance.now() - t7).toFixed(1));
  telemetries.push({
    stepName: "8. Hazard & Inundation Risk Audit",
    durationMs: d7,
    status: exposedAssets.length > 0 ? "warn" : "pass",
    details: `Identified ${hazardSinks.length} depression sinks. Audited ${exposedAssets.length} exposed assets in flood path.`,
  });

  // ── Step 9: Sun King Off-Grid Energy Reach & Clustering ──
  const t8 = performance.now();
  const energyClusters = modelEnergyClusters(reducedPoints, vectors);
  const d8 = Number((performance.now() - t8).toFixed(1));
  telemetries.push({
    stepName: "9. Sun King Energy Catchment Sizer",
    durationMs: d8,
    status: "pass",
    details: `Clustered ${energyClusters.length} settlement zones. Evaluated mini-grid vs SHS potential.`,
  });

  const totalDurationMs = Number((performance.now() - startTime).toFixed(1));

  return {
    metadata,
    points: reducedPoints,
    vectors,
    boundary,
    tin,
    contours,
    buffers,
    suitability,
    hazardSinks,
    exposedAssets,
    energyClusters,
    telemetries,
    totalDurationMs,
  };
}