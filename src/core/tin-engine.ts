/**
 * Delaunay Triangulation (TIN) & 3D Surface Engine
 * Computes non-overlapping triangle meshes, face normal vectors, slope gradients, and cut/fill volumes.
 */

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

  // Bowyer-Watson 2D Delaunay Triangulation
  const triangles = bowyerWatsonDelaunay(points, minX, maxX, minY, maxY);

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

interface SuperTriangle {
  p1: SurveyPoint;
  p2: SurveyPoint;
  p3: SurveyPoint;
}

function bowyerWatsonDelaunay(
  points: SurveyPoint[],
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): TinTriangle[] {
  const dx = maxX - minX || 100;
  const dy = maxY - minY || 100;
  const deltaMax = Math.max(dx, dy) * 20;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  // Super-triangle enclosing all points
  const stP1: SurveyPoint = { id: "_st1", easting: midX - deltaMax, northing: midY - deltaMax, elevation: 0, rawCode: "", category: "terrain", description: "" };
  const stP2: SurveyPoint = { id: "_st2", easting: midX, northing: midY + deltaMax * 1.5, elevation: 0, rawCode: "", category: "terrain", description: "" };
  const stP3: SurveyPoint = { id: "_st3", easting: midX + deltaMax, northing: midY - deltaMax, elevation: 0, rawCode: "", category: "terrain", description: "" };

  type Tri = { p1: SurveyPoint; p2: SurveyPoint; p3: SurveyPoint };
  let triList: Tri[] = [{ p1: stP1, p2: stP2, p3: stP3 }];

  for (const pt of points) {
    const polygonEdges: [SurveyPoint, SurveyPoint][] = [];
    const badTriangles: Tri[] = [];

    for (const tri of triList) {
      if (inCircumcircle(pt, tri.p1, tri.p2, tri.p3)) {
        badTriangles.push(tri);
      }
    }

    // Find boundary edges of the polygonal hole
    for (const tri of badTriangles) {
      const edges: [SurveyPoint, SurveyPoint][] = [
        [tri.p1, tri.p2],
        [tri.p2, tri.p3],
        [tri.p3, tri.p1],
      ];

      for (const [e1, e2] of edges) {
        let isShared = false;
        for (const other of badTriangles) {
          if (other === tri) continue;
          if (hasEdge(other, e1, e2)) {
            isShared = true;
            break;
          }
        }
        if (!isShared) {
          polygonEdges.push([e1, e2]);
        }
      }
    }

    // Remove bad triangles
    triList = triList.filter((t) => !badTriangles.includes(t));

    // Form new triangles from point to edges
    for (const [e1, e2] of polygonEdges) {
      triList.push({ p1: e1, p2: e2, p3: pt });
    }
  }

  // Remove triangles that share vertices with the super-triangle
  const finalTriangles: TinTriangle[] = [];
  const superIds = new Set(["_st1", "_st2", "_st3"]);

  for (const tri of triList) {
    if (superIds.has(tri.p1.id) || superIds.has(tri.p2.id) || superIds.has(tri.p3.id)) {
      continue;
    }

    const metrics = computeTriangleFaceMetrics(tri.p1, tri.p2, tri.p3);
    finalTriangles.push({
      p1: tri.p1,
      p2: tri.p2,
      p3: tri.p3,
      normal: metrics.normal,
      slopePercent: metrics.slopePercent,
      aspectDeg: metrics.aspectDeg,
    });
  }

  return finalTriangles;
}

function hasEdge(tri: { p1: SurveyPoint; p2: SurveyPoint; p3: SurveyPoint }, e1: SurveyPoint, e2: SurveyPoint): boolean {
  const pts = [tri.p1.id, tri.p2.id, tri.p3.id];
  return pts.includes(e1.id) && pts.includes(e2.id);
}

function inCircumcircle(p: SurveyPoint, a: SurveyPoint, b: SurveyPoint, c: SurveyPoint): boolean {
  const ax = a.easting - p.easting;
  const ay = a.northing - p.northing;
  const bx = b.easting - p.easting;
  const by = b.northing - p.northing;
  const cx = c.easting - p.easting;
  const cy = c.northing - p.northing;

  const det =
    (ax * ax + ay * ay) * (bx * cy - cx * by) -
    (bx * bx + by * by) * (ax * cy - cx * ay) +
    (cx * cx + cy * cy) * (ax * by - bx * ay);

  // Counter-clockwise check
  const ccw = (b.easting - a.easting) * (c.northing - a.northing) - (b.northing - a.northing) * (c.easting - a.easting);
  return ccw > 0 ? det > 0 : det < 0;
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