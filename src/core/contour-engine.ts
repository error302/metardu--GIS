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

  // Elevation-band bucketing: register each triangle into the 1 m bands it
  // spans, so every iso-level intersects only the triangles that can cross
  // it (the legacy loop rescanned the full mesh per elevation).
  const bands = new Map<number, TinMesh["triangles"]>([]);
  for (const tri of tin.triangles) {
    const b0 = Math.floor(Math.min(tri.p1.elevation, tri.p2.elevation, tri.p3.elevation) / minorInterval);
    const b1 = Math.floor(Math.max(tri.p1.elevation, tri.p2.elevation, tri.p3.elevation) / minorInterval);
    for (let b = b0; b <= b1; b++) {
      const bucket = bands.get(b);
      if (bucket) bucket.push(tri);
      else bands.set(b, [tri]);
    }
  }

  for (let z = minZ; z <= maxZ; z += minorInterval) {
    const targetZ = Number(z.toFixed(2));
    if (targetZ < tin.minZ || targetZ > tin.maxZ) continue;

    const isMajor = Math.abs(targetZ % majorInterval) < 0.001 || Math.abs((targetZ % majorInterval) - majorInterval) < 0.001;
    const segments: [[number, number], [number, number]][] = [];

    const bandTris = bands.get(Math.round(targetZ / minorInterval));
    if (bandTris) {
      for (const tri of bandTris) {
        const seg = intersectTriangleWithPlane(tri.p1, tri.p2, tri.p3, targetZ);
        if (seg) {
          segments.push(seg);
        }
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

/**
 * Stitch segments into polylines via endpoint spatial hashing.
 * The legacy implementation rescanned every remaining segment per extension
 * (O(S²)) — at 50k points that dominated the pipeline. The hash grid makes
 * each extension a local lookup: O(S) amortized.
 */
function stitchSegments(segments: [[number, number], [number, number]][]): [number, number][][] {
  const polylines: [number, number][][] = [];
  const visited = new Uint8Array(segments.length);
  const EPS = 0.05;
  const CELL = 0.05;

  // Quantized endpoint grid: key -> segment indices with an endpoint in cell
  const grid = new Map<number, number[]>();
  const cellKey = (x: number, y: number): number => {
    // Quantize to 5 cm cells; pack two 21-bit signed values into one int key
    const cx = Math.round(x / CELL);
    const cy = Math.round(y / CELL);
    return (cy + 0x100000) * 0x200000 + (cx + 0x100000);
  };
  for (let i = 0; i < segments.length; i++) {
    for (const [x, y] of segments[i]) {
      const key = cellKey(x, y);
      const bucket = grid.get(key);
      if (bucket) bucket.push(i);
      else grid.set(key, [i]);
    }
  }

  /** Find an unvisited segment with an endpoint within EPS of (x, y). */
  const findNext = (x: number, y: number): number => {
    const cx = Math.round(x / CELL);
    const cy = Math.round(y / CELL);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = grid.get((cy + dy + 0x100000) * 0x200000 + (cx + dx + 0x100000));
        if (!bucket) continue;
        for (const j of bucket) {
          if (visited[j]) continue;
          const [pA, pB] = segments[j];
          if (Math.hypot(x - pA[0], y - pA[1]) < EPS || Math.hypot(x - pB[0], y - pB[1]) < EPS) {
            return j;
          }
        }
      }
    }
    return -1;
  };

  for (let i = 0; i < segments.length; i++) {
    if (visited[i]) continue;
    visited[i] = 1;

    const line: [number, number][] = [segments[i][0], segments[i][1]];

    for (;;) {
      const tail = line[line.length - 1];
      const j = findNext(tail[0], tail[1]);
      if (j === -1) break;
      visited[j] = 1;
      const [pA, pB] = segments[j];
      line.push(
        Math.hypot(tail[0] - pA[0], tail[1] - pA[1]) < EPS ? pB : pA
      );
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