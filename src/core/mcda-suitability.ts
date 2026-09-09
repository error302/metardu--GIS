/**
 * Settlement Suitability (MCDA) — Generic Multi-Criteria Modeler
 * Computes development suitability via weighted overlay: slope, road access, riparian setbacks, infra.
 * Reference: UN-Habitat / FAO frameworks (see methodology-registry.ts). Weights are user-parametrized presets.
 */

import { TinMesh, SurveyVector, SuitabilityCell, McdaWeights } from "../types/spatial";
import { pointToSegmentDistance } from "./buffer-engine";
import { UniformGridIndex, SegmentIndex, XY } from "./spatial-index";

export const DEFAULT_MCDA_WEIGHTS: McdaWeights = {
  slopeWeight: 35,
  roadAccessWeight: 25,
  waterBufferWeight: 25,
  socialInfraWeight: 15,
  maxSlopeAllowed: 25, // %
  riparianBufferM: 30, // meters
};

/**
 * Class boundaries applied to the composite score (0–100). Single source
 * of truth: the engine classifies with these, and the print legend
 * discloses them verbatim so every colour on a sheet is re-derivable.
 */
export const SUITABILITY_CLASS_BREAKS = {
  optimalMin: 78,
  suitableMin: 60,
  moderateMin: 40,
} as const;

/**
 * Prebuilt spatial context — amortizes index construction across repeated
 * evaluations (interactive weight sliders rebuild the grid many times on the
 * same terrain/features).
 */
export interface SuitabilityIndexContext {
  triangleIndex: UniformGridIndex<TinMesh["triangles"][number]>;
  roadIndex: SegmentIndex;
  riverIndex: SegmentIndex;
  infraIndex: SegmentIndex;
}

export function buildSuitabilityIndexContext(
  tin: TinMesh | null,
  vectors: SurveyVector[]
): SuitabilityIndexContext {
  const triangleIndex = new UniformGridIndex(tin?.triangles ?? [], (t) => ({
    x: (t.p1.easting + t.p2.easting + t.p3.easting) / 3,
    y: (t.p1.northing + t.p2.northing + t.p3.northing) / 3,
  }));
  const roadVectors = vectors.filter((v) => v.category === "road" || v.code === "RD-CL");
  const riverVectors = vectors.filter((v) => v.category === "water" || v.code === "RIV");
  const infraVectors = vectors.filter((v) => v.category === "settlement" || v.category === "utility");
  return {
    triangleIndex,
    roadIndex: buildSegmentIndex(roadVectors),
    riverIndex: buildSegmentIndex(riverVectors),
    infraIndex: buildSegmentIndex(infraVectors),
  };
}

export function evaluateSuitabilityGrid(
  tin: TinMesh | null,
  vectors: SurveyVector[],
  weights: McdaWeights = DEFAULT_MCDA_WEIGHTS,
  gridResolution = 20,
  context?: SuitabilityIndexContext
): SuitabilityCell[] {
  if (!tin || tin.vertices.length < 3) return [];

  // Determine bounds
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  for (const v of tin.vertices) {
    if (v.easting < minX) minX = v.easting;
    if (v.easting > maxX) maxX = v.easting;
    if (v.northing < minY) minY = v.northing;
    if (v.northing > maxY) maxY = v.northing;
  }

  const dx = maxX - minX;
  const dy = maxY - minY;
  if (dx <= 0 || dy <= 0) return [];

  const stepX = dx / gridResolution;
  const stepY = dy / gridResolution;

  const roadVectors = vectors.filter((v) => v.category === "road" || v.code === "RD-CL");
  const riverVectors = vectors.filter((v) => v.category === "water" || v.code === "RIV");
  const infraVectors = vectors.filter((v) => v.category === "settlement" || v.category === "utility");

  // Spatial indexes: built once per evaluation (or supplied via context) so
  // per-cell queries touch a local neighbourhood instead of scanning every
  // triangle/segment (the previous O(cells × triangles + cells × segments)).
  const triangleIndex = context?.triangleIndex ?? new UniformGridIndex(tin.triangles, (t) => ({
    x: (t.p1.easting + t.p2.easting + t.p3.easting) / 3,
    y: (t.p1.northing + t.p2.northing + t.p3.northing) / 3,
  }));
  const roadIndex = context?.roadIndex ?? buildSegmentIndex(roadVectors);
  const riverIndex = context?.riverIndex ?? buildSegmentIndex(riverVectors);
  const infraIndex = context?.infraIndex ?? buildSegmentIndex(infraVectors);

  const cells: SuitabilityCell[] = [];

  for (let ix = 0; ix <= gridResolution; ix++) {
    const x = minX + ix * stepX;
    for (let iy = 0; iy <= gridResolution; iy++) {
      const y = minY + iy * stepY;

      // Find elevation & slope from nearest triangle
      const slope = estimateSlopeAtPoint(x, y, tin, triangleIndex);
      const distToRoad = minDistanceToVectors(x, y, roadVectors, roadIndex);
      const distToRiver = minDistanceToVectors(x, y, riverVectors, riverIndex);
      const distToInfra = minDistanceToVectors(x, y, infraVectors, infraIndex);

      // Hard environmental restriction: inside riparian setback
      if (distToRiver < weights.riparianBufferM) {
        cells.push({
          x: Number(x.toFixed(2)),
          y: Number(y.toFixed(2)),
          score: 5,
          category: "restricted",
          slope,
          distToRoadM: Math.round(distToRoad),
          distToRiverM: Math.round(distToRiver),
          distToInfraM: Math.round(distToInfra),
        });
        continue;
      }

      // Hard geotech hazard: slope exceeds max allowed
      if (slope > weights.maxSlopeAllowed) {
        cells.push({
          x: Number(x.toFixed(2)),
          y: Number(y.toFixed(2)),
          score: 10,
          category: "hazard",
          slope,
          distToRoadM: Math.round(distToRoad),
          distToRiverM: Math.round(distToRiver),
          distToInfraM: Math.round(distToInfra),
        });
        continue;
      }

      // Partial scores (0-100)
      // 1. Slope Score
      let slopeScore = 100;
      if (slope > 5 && slope <= 15) slopeScore = 80;
      else if (slope > 15 && slope <= 25) slopeScore = 50;
      else if (slope > 25) slopeScore = 20;

      // 2. Road Accessibility (within 100m is 100, drops to 20 at 500m)
      const roadScore = Math.max(10, Math.min(100, 100 - (distToRoad / 500) * 80));

      // 3. Water Buffer Score (safe distance away from flooding)
      const waterScore = Math.min(100, ((distToRiver - weights.riparianBufferM) / 100) * 100);

      // 4. Social Infrastructure Proximity
      const infraScore = Math.max(20, Math.min(100, 100 - (distToInfra / 800) * 80));

      const totalWeight = weights.slopeWeight + weights.roadAccessWeight + weights.waterBufferWeight + weights.socialInfraWeight || 100;
      const compositeScore = Math.round(
        (slopeScore * weights.slopeWeight +
          roadScore * weights.roadAccessWeight +
          waterScore * weights.waterBufferWeight +
          infraScore * weights.socialInfraWeight) /
          totalWeight
      );

      let category: SuitabilityCell["category"] = "moderate";
      if (compositeScore >= SUITABILITY_CLASS_BREAKS.optimalMin) category = "optimal";
      else if (compositeScore >= SUITABILITY_CLASS_BREAKS.suitableMin) category = "suitable";
      else if (compositeScore >= SUITABILITY_CLASS_BREAKS.moderateMin) category = "moderate";
      else category = "restricted";

      cells.push({
        x: Number(x.toFixed(2)),
        y: Number(y.toFixed(2)),
        score: compositeScore,
        category,
        slope,
        distToRoadM: Math.round(distToRoad),
        distToRiverM: Math.round(distToRiver),
        distToInfraM: Math.round(distToInfra),
      });
    }
  }

  return cells;
}

function estimateSlopeAtPoint(
  x: number,
  y: number,
  tin: TinMesh,
  triangleIndex: UniformGridIndex<TinMesh["triangles"][number]>
): number {
  const hit = triangleIndex.nearest(x, y);
  return hit ? hit.item.slopePercent : 5.0;
}

function minDistanceToVectors(
  x: number,
  y: number,
  vectors: SurveyVector[],
  index: SegmentIndex
): number {
  if (vectors.length === 0) return 200; // default moderate distance
  return index.nearestDistance(x, y, pointToSegmentDistance);
}

function buildSegmentIndex(vectors: SurveyVector[]): SegmentIndex {
  const polylines: XY[][] = vectors.map((v) =>
    v.points.map((p) => ({ x: p.easting, y: p.northing }))
  );
  return new SegmentIndex(polylines);
}