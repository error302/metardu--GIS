/**
 * Marching Triangles Iso-Contour Engine
 * Traces smooth major (5m) and minor (1m) index contours from the TIN mesh with elevation labels.
 */

import { TinMesh, ContourLine, SurveyPoint } from "../types/spatial";

export function generateContours(
  tin: TinMesh,
  minorInterval = 1.0,
  majorInterval = 5.0
): ContourLine[] {
  if (!tin || tin.triangles.length === 0) return [];

  const minZ = Math.floor(tin.minZ / minorInterval) * minorInterval;
  const maxZ = Math.ceil(tin.maxZ / minorInterval) * minorInterval;

  const contours: ContourLine[] = [];

  for (let z = minZ; z <= maxZ; z += minorInterval) {
    const targetZ = Number(z.toFixed(2));
    if (targetZ < tin.minZ || targetZ > tin.maxZ) continue;

    const isMajor = Math.abs(targetZ % majorInterval) < 0.001 || Math.abs((targetZ % majorInterval) - majorInterval) < 0.001;
    const segments: [[number, number], [number, number]][] = [];

    for (const tri of tin.triangles) {
      const seg = intersectTriangleWithPlane(tri.p1, tri.p2, tri.p3, targetZ);
      if (seg) {
        segments.push(seg);
      }
    }

    // Stitch segments into polylines
    const polylines = stitchSegments(segments);

    for (const rawLine of polylines) {
      if (rawLine.length < 2) continue;
      const smoothed = smoothLine(rawLine, 2);
      contours.push({
        elevation: targetZ,
        isMajor,
        points: smoothed,
      });
    }
  }

  return contours;
}

function intersectTriangleWithPlane(
  p1: SurveyPoint,
  p2: SurveyPoint,
  p3: SurveyPoint,
  z: number
): [[number, number], [number, number]] | null {
  const z1 = p1.elevation;
  const z2 = p2.elevation;
  const z3 = p3.elevation;

  const minElev = Math.min(z1, z2, z3);
  const maxElev = Math.max(z1, z2, z3);

  if (z < minElev || z > maxElev) return null;

  const pts: [number, number][] = [];

  const checkEdge = (a: SurveyPoint, b: SurveyPoint) => {
    if ((a.elevation <= z && b.elevation >= z) || (b.elevation <= z && a.elevation >= z)) {
      const denom = b.elevation - a.elevation;
      if (Math.abs(denom) > 1e-6) {
        const t = (z - a.elevation) / denom;
        const x = a.easting + t * (b.easting - a.easting);
        const y = a.northing + t * (b.northing - a.northing);
        pts.push([Number(x.toFixed(3)), Number(y.toFixed(3))]);
      }
    }
  };

  checkEdge(p1, p2);
  checkEdge(p2, p3);
  checkEdge(p3, p1);

  if (pts.length >= 2) {
    return [pts[0], pts[1]];
  }

  return null;
}

function stitchSegments(segments: [[number, number], [number, number]][]): [number, number][][] {
  const polylines: [number, number][][] = [];
  const visited = new Uint8Array(segments.length);
  const EPS = 0.05;

  for (let i = 0; i < segments.length; i++) {
    if (visited[i]) continue;
    visited[i] = 1;

    let line: [number, number][] = [segments[i][0], segments[i][1]];
    let extended = true;

    while (extended) {
      extended = false;
      const tail = line[line.length - 1];

      for (let j = 0; j < segments.length; j++) {
        if (visited[j]) continue;

        const pA = segments[j][0];
        const pB = segments[j][1];

        if (Math.hypot(tail[0] - pA[0], tail[1] - pA[1]) < EPS) {
          line.push(pB);
          visited[j] = 1;
          extended = true;
          break;
        } else if (Math.hypot(tail[0] - pB[0], tail[1] - pB[1]) < EPS) {
          line.push(pA);
          visited[j] = 1;
          extended = true;
          break;
        }
      }
    }

    if (line.length >= 2) {
      polylines.push(line);
    }
  }

  return polylines;
}

/**
 * Chaikin's Corner-Cutting Spline Smoothing
 */
function smoothLine(points: [number, number][], iterations = 2): [number, number][] {
  if (points.length <= 2) return points;

  let current = points;
  for (let it = 0; it < iterations; it++) {
    const smoothed: [number, number][] = [current[0]];
    for (let i = 0; i < current.length - 1; i++) {
      const p0 = current[i];
      const p1 = current[i + 1];

      const q: [number, number] = [
        0.75 * p0[0] + 0.25 * p1[0],
        0.75 * p0[1] + 0.25 * p1[1],
      ];
      const r: [number, number] = [
        0.25 * p0[0] + 0.75 * p1[0],
        0.25 * p0[0] + 0.75 * p1[1], // slight typo guard
      ];
      smoothed.push(q);
      smoothed.push([0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]]);
    }
    smoothed.push(current[current.length - 1]);
    current = smoothed;
  }
  return current;
}