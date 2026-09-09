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
  OffGridPlannerParams,
} from "../types/spatial";
import { parseRawSurveyText } from "./parser";
import { reduceOrthometricHeight } from "./crs";
import { CRS_EPSG_FROM_METADATA, toWGS84 } from "./crs";
import { generateFeatureVectors } from "./feature-coding";
import { generateTinMesh } from "./tin-engine";
import { generateContours } from "./contour-engine";
import { auditBoundaryTopology } from "./topology";
import { generateCorridorBuffers } from "./buffer-engine";
import { evaluateSuitabilityGrid, DEFAULT_MCDA_WEIGHTS } from "./mcda-suitability";
import { auditHazardExposure } from "./hazard-exposure";
import { modelEnergyClusters, DEFAULT_OFFGRID_PARAMS } from "./energy-catchment";

/** Emitted before each pipeline stage so a worker or the UI can render progress. */
export interface PipelineProgressEvent {
  step: number;
  totalSteps: number;
  stage: string;
}

export async function runAutonomousGisPipeline(
  rawInput: string | SurveyPoint[],
  metadata: ProjectMetadata,
  mcdaWeights: McdaWeights = DEFAULT_MCDA_WEIGHTS,
  offGridParams: OffGridPlannerParams = DEFAULT_OFFGRID_PARAMS,
  onProgress?: (p: PipelineProgressEvent) => void
): Promise<PipelineResult> {
  const startTime = performance.now();
  const telemetries: PipelineTelemetry[] = [];
  const emit = (step: number, stage: string) =>
    onProgress?.({ step, totalSteps: 9, stage });

  // ── Step 1: Raw Ingest & Delimiter Sniffing ──
  emit(1, "Ingest & Coordinate Parsing");
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
  emit(2, "Geodesy & Geoid MSL Reduction");
  const t1 = performance.now();
  const srcEpsg = CRS_EPSG_FROM_METADATA(metadata.crs);
  const reducedPoints = points.map((p) => {
    const [lon, lat] = toWGS84(srcEpsg, p.easting, p.northing);
    const { orthometricH, geoidN } = reduceOrthometricHeight(p.elevation, lat, lon);
    return {
      ...p,
      elevation: orthometricH,
      ellipsoidHeight: p.elevation,
      geoidN,
      latitude: Number(lat.toFixed(6)),
      longitude: Number(lon.toFixed(6)),
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
  emit(3, "Field-to-Finish Feature Coding");
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
  emit(4, "Delaunay TIN & Contouring");
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
  emit(5, "Cadastral Topology & Misclosure");
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
  emit(6, "Corridor & Riparian Buffering");
  const t5 = performance.now();
  const buffers = generateCorridorBuffers(vectors, reducedPoints, 15.0, 30.0);
  const d5 = Number((performance.now() - t5).toFixed(1));
  telemetries.push({
    stepName: "6. Corridor & Riparian Buffering",
    durationMs: d5,
    status: "pass",
    details: `Generated ${buffers.length} corridor reserves (15m road / 30m riparian setbacks).`,
  });

  // ── Step 7: Settlement Suitability (MCDA) ──
  emit(7, "Settlement Suitability (MCDA)");
  const t6 = performance.now();
  const suitability = evaluateSuitabilityGrid(tin, vectors, mcdaWeights, 20);
  const d6 = Number((performance.now() - t6).toFixed(1));
  telemetries.push({
    stepName: "7. Settlement Suitability (MCDA)",
    durationMs: d6,
    status: "pass",
    details: `Computed ${suitability.length} multi-criteria suitability cells across terrain slope & setbacks.`,
  });

  // ── Step 8: Hazard & Flood Exposure Audit ──
  emit(8, "Hazard & Flood Exposure Audit");
  const t7 = performance.now();
  const { sinks: hazardSinks, exposedAssets } = auditHazardExposure(tin, reducedPoints);
  const d7 = Number((performance.now() - t7).toFixed(1));
  telemetries.push({
    stepName: "8. Hazard & Flood Exposure Audit",
    durationMs: d7,
    status: exposedAssets.length > 0 ? "warn" : "pass",
    details: `Identified ${hazardSinks.length} depression sinks. Audited ${exposedAssets.length} exposed assets in flood path.`,
  });

  // ── Step 9: Off-Grid Electrification Planner ──
  emit(9, "Off-Grid Electrification Sizer");
  const t8 = performance.now();
  const energyClusters = modelEnergyClusters(reducedPoints, vectors, offGridParams);
  const d8 = Number((performance.now() - t8).toFixed(1));
  telemetries.push({
    stepName: "9. Off-Grid Electrification Sizer",
    durationMs: d8,
    status: "pass",
    details: `Clustered ${energyClusters.length} settlement zones. Evaluated mini-grid vs SHS vs grid extension.`,
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