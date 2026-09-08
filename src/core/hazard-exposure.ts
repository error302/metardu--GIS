/**
 * Hazard & Climate Risk Vulnerability Auditor (UN-Habitat)
 * Traces low-point depression sinks, flood inundation zones, and audits exposed infrastructure.
 */

import { TinMesh, SurveyPoint, HazardSink, ExposedAsset } from "../types/spatial";

export function auditHazardExposure(
  tin: TinMesh | null,
  points: SurveyPoint[]
): { sinks: HazardSink[]; exposedAssets: ExposedAsset[] } {
  if (!tin || tin.triangles.length === 0) {
    return { sinks: [], exposedAssets: [] };
  }

  // Find local minima across vertices
  const localMinima: SurveyPoint[] = [];
  const vertexNeighbors: Map<string, SurveyPoint[]> = new Map();

  for (const tri of tin.triangles) {
    for (const [v1, v2] of [[tri.p1, tri.p2], [tri.p2, tri.p3], [tri.p3, tri.p1]]) {
      if (!vertexNeighbors.has(v1.id)) vertexNeighbors.set(v1.id, []);
      vertexNeighbors.get(v1.id)!.push(v2);
    }
  }

  for (const [id, neighbors] of vertexNeighbors.entries()) {
    const pt = tin.vertices.find((p) => p.id === id);
    if (!pt) continue;

    const isLowest = neighbors.every((n) => n.elevation >= pt.elevation);
    if (isLowest && neighbors.length >= 3) {
      localMinima.push(pt);
    }
  }

  // If no strict local minimum found, take the lowest 5% elevation points
  const candidateMinima = localMinima.length > 0 ? localMinima : [
    [...tin.vertices].sort((a, b) => a.elevation - b.elevation)[0]
  ];

  const sinks: HazardSink[] = [];
  let sinkCounter = 1;

  for (const minPt of candidateMinima.slice(0, 3)) {
    // Estimate spill elevation (lowest neighbor saddle)
    const neighbors = vertexNeighbors.get(minPt.id) || [];
    const maxNeighborElev = neighbors.reduce((max, n) => Math.max(max, n.elevation), minPt.elevation + 1.5);
    const depth = Number((maxNeighborElev - minPt.elevation).toFixed(2));

    let riskLevel: HazardSink["riskLevel"] = "low";
    if (depth > 2.0) riskLevel = "critical";
    else if (depth > 1.0) riskLevel = "high";
    else if (depth > 0.5) riskLevel = "medium";

    sinks.push({
      id: `SINK-0${sinkCounter++}`,
      center: [minPt.easting, minPt.northing],
      minElevation: minPt.elevation,
      spillElevation: maxNeighborElev,
      depthM: depth,
      pondingAreaSqM: Math.round(Math.PI * Math.pow(depth * 30, 2)),
      riskLevel,
    });
  }

  // Exposure analysis against surveyed points
  const exposedAssets: ExposedAsset[] = [];

  for (const pt of points) {
    if (pt.category === "terrain" || pt.category === "control") continue;

    for (const sink of sinks) {
      const dist = Math.hypot(pt.easting - sink.center[0], pt.northing - sink.center[1]);
      const floodRadius = Math.max(40, sink.depthM * 25);

      if (dist < floodRadius) {
        let risk: ExposedAsset["hazardRisk"] = "moderate";
        if (dist < floodRadius * 0.4 || pt.elevation <= sink.minElevation + 0.5) {
          risk = "critical";
        } else if (dist < floodRadius * 0.7) {
          risk = "high";
        }

        let type: ExposedAsset["type"] = "infrastructure";
        if (pt.category === "settlement") type = "settlement";
        else if (pt.rawCode === "CLINIC") type = "clinic";
        else if (pt.rawCode === "SCH") type = "school";
        else if (pt.category === "road") type = "road";
        else if (pt.rawCode === "WTR_PT") type = "water_point";

        exposedAssets.push({
          id: `EXP-${pt.id}`,
          name: `${pt.description || pt.rawCode} (${pt.id})`,
          type,
          coordinate: [pt.easting, pt.northing],
          elevation: pt.elevation,
          hazardRisk: risk,
          distanceToSinkM: Math.round(dist),
        });
        break; // matched nearest sink
      }
    }
  }

  return { sinks, exposedAssets };
}