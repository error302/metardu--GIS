/**
 * Climate-Smart Multi-Criteria Suitability Modeler (UN-Habitat MCDA)
 * Dynamically computes settlement development suitability based on slope, road access, and riparian setbacks.
 */

import { TinMesh, SurveyVector, SuitabilityCell, McdaWeights } from "../types/spatial";
import { pointToSegmentDistance } from "./buffer-engine";

export const DEFAULT_MCDA_WEIGHTS: McdaWeights = {
  slopeWeight: 35,
  roadAccessWeight: 25,
  waterBufferWeight: 25,
  socialInfraWeight: 15,
  maxSlopeAllowed: 25, // %
  riparianBufferM: 30, // meters
};

export function evaluateSuitabilityGrid(
  tin: TinMesh | null,
  vectors: SurveyVector[],
  weights: McdaWeights = DEFAULT_MCDA_WEIGHTS,
  gridResolution = 20
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

  const cells: SuitabilityCell[] = [];

  for (let ix = 0; ix <= gridResolution; ix++) {
    const x = minX + ix * stepX;
    for (let iy = 0; iy <= gridResolution; iy++) {
      const y = minY + iy * stepY;

      // Find elevation & slope from nearest triangle
      const slope = estimateSlopeAtPoint(x, y, tin);
      const distToRoad = minDistanceToVectors(x, y, roadVectors);
      const distToRiver = minDistanceToVectors(x, y, riverVectors);
      const distToInfra = minDistanceToVectors(x, y, infraVectors);

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
      if (compositeScore >= 78) category = "optimal";
      else if (compositeScore >= 60) category = "suitable";
      else if (compositeScore >= 40) category = "moderate";
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

function estimateSlopeAtPoint(x: number, y: number, tin: TinMesh): number {
  let nearestTri = tin.triangles[0];
  let minD = Infinity;

  for (const tri of tin.triangles) {
    const cx = (tri.p1.easting + tri.p2.easting + tri.p3.easting) / 3;
    const cy = (tri.p1.northing + tri.p2.northing + tri.p3.northing) / 3;
    const d = Math.hypot(x - cx, y - cy);
    if (d < minD) {
      minD = d;
      nearestTri = tri;
    }
  }

  return nearestTri ? nearestTri.slopePercent : 5.0;
}

function minDistanceToVectors(x: number, y: number, vectors: SurveyVector[]): number {
  if (vectors.length === 0) return 200; // default moderate distance
  let minDist = Infinity;

  for (const vec of vectors) {
    const pts = vec.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const d = pointToSegmentDistance(x, y, pts[i].easting, pts[i].northing, pts[i + 1].easting, pts[i + 1].northing);
      if (d < minDist) minDist = d;
    }
  }

  return minDist;
}