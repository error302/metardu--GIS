/**
 * Delaunay Triangulation (TIN) & 3D Surface Engine
 * Computes non-overlapping triangle meshes, face normal vectors, slope gradients, and cut/fill volumes.
 *
 * Triangulation uses the sweep-hull Delaunay algorithm (delaunator, O(n) in
 * practice) — the previous ad-hoc Bowyer-Watson loop was O(n²) and dominated
 * the 50k-point pipeline (>100 s). Face metrics, volumes, and the TinMesh
 * contract are unchanged.
 */

import Delaunator from "delaunator";
import { SurveyPoint, TinTriangle, TinMesh } from "../types/spatial";

export function generateTinMesh(points: SurveyPoint[], datumElevation?: number): TinMesh {
  if (points.length < 3) {
    return {
      vertices: points,
      triangles: [],
      minZ: 0,
      maxZ: 0,
      meanSlopePercent: 0,
      cutVolumeM3: 0,
      fillVolumeM3: 0,
      datumElevation: datumElevation ?? 0,
    };
  }

  // Find bounding box
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const pt of points) {
    if (pt.easting < minX) minX = pt.easting;
    if (pt.easting > maxX) maxX = pt.easting;
    if (pt.northing < minY) minY = pt.northing;
    if (pt.northing > maxY) maxY = pt.northing;
    if (pt.elevation < minZ) minZ = pt.elevation;
    if (pt.elevation > maxZ) maxZ = pt.elevation;
  }

  const datum = datumElevation ?? Number(((minZ + maxZ) / 2).toFixed(2));

  // Sweep-hull 2D Delaunay Triangulation
  const triangles = triangulateDelaunay(points);

  let totalSlope = 0;
  let totalCut = 0;
  let totalFill = 0;

  for (const tri of triangles) {
    totalSlope += tri.slopePercent;

    // Prismoidal volume per triangle above/below datum plane
    const area = triangleArea2D(tri.p1, tri.p2, tri.p3);
    const avgZ = (tri.p1.elevation + tri.p2.elevation + tri.p3.elevation) / 3.0;
    const diff = avgZ - datum;

    if (diff > 0) {
      totalCut += area * diff;
    } else {
      totalFill += area * Math.abs(diff);
    }
  }

  const meanSlopePercent = triangles.length > 0 ? Number((totalSlope / triangles.length).toFixed(1)) : 0;

  return {
    vertices: points,
    triangles,
    minZ: Number(minZ.toFixed(2)),
    maxZ: Number(maxZ.toFixed(2)),
    meanSlopePercent,
    cutVolumeM3: Number(totalCut.toFixed(1)),
    fillVolumeM3: Number(totalFill.toFixed(1)),
    datumElevation: datum,
  };
}

/**
 * Sweep-hull Delaunay triangulation (delaunator). Returns TinTriangle faces
 * with the same metric payloads the legacy Bowyer-Watson path produced.
 */
function triangulateDelaunay(points: SurveyPoint[]): TinTriangle[] {
  // Dedupe coincident coordinates — delaunator tolerates duplicates but the
  // degenerate faces would waste downstream work. First occurrence wins.
  const coordIndex = new Map<string, number>();
  const representative: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const key = `${points[i].easting}|${points[i].northing}`;
    if (!coordIndex.has(key)) {
      coordIndex.set(key, representative.length);
      representative.push(i);
    }
  }

  const coords = new Float64Array(representative.length * 2);
  for (let i = 0; i < representative.length; i++) {
    const pt = points[representative[i]];
    coords[i * 2] = pt.easting;
    coords[i * 2 + 1] = pt.northing;
  }

  const delaunay = new Delaunator(coords);
  const tri = delaunay.triangles;

  const finalTriangles: TinTriangle[] = [];
  for (let t = 0; t < tri.length; t += 3) {
    const p1 = points[representative[tri[t]]];
    const p2 = points[representative[tri[t + 1]]];
    const p3 = points[representative[tri[t + 2]]];

    const metrics = computeTriangleFaceMetrics(p1, p2, p3);
    finalTriangles.push({
      p1,
      p2,
      p3,
      normal: metrics.normal,
      slopePercent: metrics.slopePercent,
      aspectDeg: metrics.aspectDeg,
    });
  }

  return finalTriangles;
}

function computeTriangleFaceMetrics(p1: SurveyPoint, p2: SurveyPoint, p3: SurveyPoint): {
  normal: [number, number, number];
  slopePercent: number;
  aspectDeg: number;
} {
  const ux = p2.easting - p1.easting;
  const uy = p2.northing - p1.northing;
  const uz = p2.elevation - p1.elevation;

  const vx = p3.easting - p1.easting;
  const vy = p3.northing - p1.northing;
  const vz = p3.elevation - p1.elevation;

  // Cross product
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;

  // Ensure upward normal
  if (nz < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }

  const mag = Math.hypot(nx, ny, nz) || 1;
  const unitNorm: [number, number, number] = [nx / mag, ny / mag, nz / mag];

  // Slope in percent = (rise / run) * 100
  const horizontalRun = Math.hypot(unitNorm[0], unitNorm[1]);
  const slopePercent = unitNorm[2] !== 0 ? Number(((horizontalRun / Math.abs(unitNorm[2])) * 100).toFixed(1)) : 999;

  // Aspect in degrees (0 = North, 90 = East, 180 = South, 270 = West)
  let aspectRad = Math.atan2(-unitNorm[0], -unitNorm[1]);
  if (aspectRad < 0) aspectRad += 2 * Math.PI;
  const aspectDeg = Number(((aspectRad * 180) / Math.PI).toFixed(1));

  return { normal: unitNorm, slopePercent, aspectDeg };
}

export function triangleArea2D(p1: SurveyPoint, p2: SurveyPoint, p3: SurveyPoint): number {
  return Math.abs(
    (p1.easting * (p2.northing - p3.northing) +
      p2.easting * (p3.northing - p1.northing) +
      p3.easting * (p1.northing - p2.northing)) /
      2
  );
}