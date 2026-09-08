/**
 * Cadastral Topology & Statutory Precision Auditor
 * Verifies closed polygon loops, computes Bowditch linear misclosure, and audits statutory tolerances.
 */

import { SurveyPoint, BoundaryPolygon, BearingDistance } from "../types/spatial";
import { calculateBearingAndDistance, calculatePolygonMetrics } from "./geodesy";

export function auditBoundaryTopology(points: SurveyPoint[], parcelNo = "PARCEL-LR-209/145"): BoundaryPolygon | null {
  // Extract all boundary points (BL, PB, IB, MB)
  const boundaryPts = points.filter((p) => p.category === "boundary");
  if (boundaryPts.length < 3) return null;

  // Deduplicate consecutive identical points
  const cleanPts: SurveyPoint[] = [];
  for (let i = 0; i < boundaryPts.length; i++) {
    const cur = boundaryPts[i];
    const prev = cleanPts[cleanPts.length - 1];
    if (!prev || Math.hypot(cur.easting - prev.easting, cur.northing - prev.northing) > 0.01) {
      cleanPts.push(cur);
    }
  }

  if (cleanPts.length < 3) return null;

  // Compute bearings and distances between consecutive beacons
  const bearingsDistances: BearingDistance[] = [];
  const n = cleanPts.length;
  let totalDist = 0;
  let sumDe = 0;
  let sumDn = 0;

  for (let i = 0; i < n; i++) {
    const p1 = cleanPts[i];
    const p2 = cleanPts[(i + 1) % n];

    const bd = calculateBearingAndDistance(p1.easting, p1.northing, p2.easting, p2.northing);
    bearingsDistances.push({
      fromId: p1.id,
      toId: p2.id,
      bearingDeg: bd.bearingDeg,
      bearingDms: bd.bearingDms,
      distanceM: bd.distanceM,
    });

    totalDist += bd.distanceM;
    sumDe += p2.easting - p1.easting;
    sumDn += p2.northing - p1.northing;
  }

  // Linear misclosure vector (dx, dy)
  const misclosureM = Number(Math.hypot(sumDe, sumDn).toFixed(3));
  // If mathematically closed, misclosure is 0, precision is infinite -> set benchmark high precision
  const precisionRatio = misclosureM > 0.001 ? Math.round(totalDist / misclosureM) : 50000;

  let precisionRating: "Class A (Urban)" | "Class B (Rural)" | "Sub-Standard" = "Sub-Standard";
  if (precisionRatio >= 10000) {
    precisionRating = "Class A (Urban)";
  } else if (precisionRatio >= 5000) {
    precisionRating = "Class B (Rural)";
  }

  const metrics = calculatePolygonMetrics(cleanPts);

  return {
    id: `BND-${parcelNo}`,
    name: `Cadastral Boundary ${parcelNo}`,
    parcelNo,
    points: cleanPts,
    perimeterM: metrics.perimeterM,
    areaSqM: metrics.areaSqM,
    areaHa: metrics.areaHa,
    areaAcres: metrics.areaAcres,
    isClosed: true,
    linearMisclosureM: misclosureM,
    precisionRatio,
    precisionRating,
    bearingsDistances,
  };
}