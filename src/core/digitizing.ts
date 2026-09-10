/**
 * MetaRDU GIS Studio - Interactive Digitizing & Cadastral COGO Engine
 * Pure client-side mathematical geometry tools for on-canvas drafting, snapping, and editing.
 */

import { SurveyPoint, SurveyVector, TinMesh } from "../types/spatial";
import { cogoForward, dmsToDecimal } from "./cogo";

export interface SnapResult {
  snapped: boolean;
  x: number;
  y: number;
  elevation: number;
  type: "vertex" | "edge" | "none";
  targetId?: string;
  distanceWorld: number;
}

export interface CogoLegInput {
  fromPointId: string;
  bearingStr: string; // e.g. "45-30-15" or "45.5042"
  distanceM: number;
  newPointId: string;
  code?: string;
  category?: string;
}

/**
 * Calculates perpendicular distance from point P to line segment AB.
 * Returns closest point on segment and distance.
 */
export function pointToSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): { distance: number; closestX: number; closestY: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    const d = Math.hypot(px - ax, py - ay);
    return { distance: d, closestX: ax, closestY: ay };
  }

  // Projection parameter t
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const closestX = ax + t * dx;
  const closestY = ay + t * dy;
  const distance = Math.hypot(px - closestX, py - closestY);

  return { distance, closestX, closestY };
}

/**
 * Finds the nearest snapping target (vertex or edge) within a world-coordinate tolerance.
 */
export function findNearestSnapTarget(
  cursorE: number,
  cursorN: number,
  points: SurveyPoint[],
  vectors: SurveyVector[],
  toleranceWorldM: number = 5.0
): SnapResult {
  let closestDist = Infinity;
  let snapX = cursorE;
  let snapY = cursorN;
  let snapElev = 1680.0;
  let snapType: "vertex" | "edge" | "none" = "none";
  let targetId: string | undefined = undefined;

  // 1. Vertex Snapping (Highest priority)
  for (const pt of points) {
    const d = Math.hypot(pt.easting - cursorE, pt.northing - cursorN);
    if (d <= toleranceWorldM && d < closestDist) {
      closestDist = d;
      snapX = pt.easting;
      snapY = pt.northing;
      snapElev = pt.elevation;
      snapType = "vertex";
      targetId = pt.id;
    }
  }

  // If vertex found within tolerance, return it directly
  if (snapType === "vertex") {
    return {
      snapped: true,
      x: snapX,
      y: snapY,
      elevation: snapElev,
      type: "vertex",
      targetId,
      distanceWorld: closestDist,
    };
  }

  // 2. Edge / Segment Snapping (Secondary priority)
  for (const vec of vectors) {
    const pts = vec.points;
    if (pts.length < 2) continue;

    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const res = pointToSegmentDistance(
        cursorE,
        cursorN,
        p1.easting,
        p1.northing,
        p2.easting,
        p2.northing
      );

      if (res.distance <= toleranceWorldM && res.distance < closestDist) {
        closestDist = res.distance;
        snapX = res.closestX;
        snapY = res.closestY;
        // Linear interpolation of elevation
        const segLen = Math.hypot(p2.easting - p1.easting, p2.northing - p1.northing);
        const distFromP1 = Math.hypot(snapX - p1.easting, snapY - p1.northing);
        const ratio = segLen > 0 ? distFromP1 / segLen : 0;
        snapElev = p1.elevation + ratio * (p2.elevation - p1.elevation);
        snapType = "edge";
        targetId = `${vec.id}-seg-${i}`;
      }
    }

    // Check closing segment if closed polygon
    if (vec.isClosed && pts.length > 2) {
      const p1 = pts[pts.length - 1];
      const p2 = pts[0];
      const res = pointToSegmentDistance(
        cursorE,
        cursorN,
        p1.easting,
        p1.northing,
        p2.easting,
        p2.northing
      );
      if (res.distance <= toleranceWorldM && res.distance < closestDist) {
        closestDist = res.distance;
        snapX = res.closestX;
        snapY = res.closestY;
        snapElev = (p1.elevation + p2.elevation) / 2;
        snapType = "edge";
        targetId = `${vec.id}-seg-close`;
      }
    }
  }

  if (snapType !== "none") {
    return {
      snapped: true,
      x: snapX,
      y: snapY,
      elevation: Number(snapElev.toFixed(2)),
      type: snapType,
      targetId,
      distanceWorld: closestDist,
    };
  }

  return {
    snapped: false,
    x: cursorE,
    y: cursorN,
    elevation: 1680.0,
    type: "none",
    distanceWorld: Infinity,
  };
}

/**
 * Interpolates ground elevation at coordinate (E, N) from TIN surface.
 * Falls back to inverse-distance-weighting from 3 nearest points if not inside a triangle.
 */
export function interpolateElevation(
  e: number,
  n: number,
  points: SurveyPoint[],
  tin?: TinMesh
): number {
  if (points.length === 0) return 1680.0;

  // Check TIN triangles
  if (tin && tin.triangles.length > 0) {
    for (const tri of tin.triangles) {
      const { p1, p2, p3 } = tri;
      // Barycentric coordinates
      const detT =
        (p2.northing - p3.northing) * (p1.easting - p3.easting) +
        (p3.easting - p2.easting) * (p1.northing - p3.northing);

      if (Math.abs(detT) > 1e-6) {
        const l1 =
          ((p2.northing - p3.northing) * (e - p3.easting) +
            (p3.easting - p2.easting) * (n - p3.northing)) /
          detT;
        const l2 =
          ((p3.northing - p1.northing) * (e - p3.easting) +
            (p1.easting - p3.easting) * (n - p3.northing)) /
          detT;
        const l3 = 1 - l1 - l2;

        if (l1 >= 0 && l2 >= 0 && l3 >= 0) {
          const z = l1 * p1.elevation + l2 * p2.elevation + l3 * p3.elevation;
          return Number(z.toFixed(2));
        }
      }
    }
  }

  // IDW from nearest 3 points fallback
  const sorted = [...points].sort(
    (a, b) =>
      Math.hypot(a.easting - e, a.northing - n) - Math.hypot(b.easting - e, b.northing - n)
  );
  const k = Math.min(3, sorted.length);
  let weightSum = 0;
  let zSum = 0;

  for (let i = 0; i < k; i++) {
    const d = Math.hypot(sorted[i].easting - e, sorted[i].northing - n);
    if (d < 0.001) return sorted[i].elevation;
    const w = 1 / (d * d);
    weightSum += w;
    zSum += sorted[i].elevation * w;
  }

  return weightSum > 0 ? Number((zSum / weightSum).toFixed(2)) : 1680.0;
}

/**
 * Computes end point of a COGO leg from a start point, bearing string, and distance.
 */
export function calculateCogoLeg(
  startPt: SurveyPoint,
  bearingStr: string,
  distanceM: number,
  newId: string,
  code: string = "PB",
  category: string = "boundary",
  allPoints: SurveyPoint[] = []
): SurveyPoint {
  // Parse bearing string: supports decimal degrees or "DD-MM-SS" or "DD MM SS"
  let azDeg = 0;
  if (bearingStr.includes("-") || bearingStr.includes(" ") || bearingStr.includes("°")) {
    azDeg = dmsToDecimal(bearingStr);
  } else {
    azDeg = parseFloat(bearingStr) || 0;
  }

  const { easting, northing } = cogoForward(
    { easting: startPt.easting, northing: startPt.northing, elevation: startPt.elevation },
    azDeg,
    distanceM
  );

  const elevation = interpolateElevation(easting, northing, allPoints);

  return {
    id: newId,
    easting: Number(easting.toFixed(3)),
    northing: Number(northing.toFixed(3)),
    elevation,
    rawCode: code,
    category: (category as any) || "boundary",
    description: `COGO radiation from ${startPt.id} (Az: ${azDeg.toFixed(2)}°, Dist: ${distanceM.toFixed(2)}m)`,
    properties: {
      source: "cogo_digitizing",
      fromPoint: startPt.id,
      azimuthDeg: azDeg,
      distanceM,
    },
  };
}

/**
 * Generates next auto-incremented point ID given existing point list.
 * E.g., given ["BK1", "BK2"], produces "BK3".
 */
export function getNextPointId(points: SurveyPoint[], prefix: string = "BK"): string {
  let maxNum = 0;
  const regex = new RegExp(`^${prefix}(\\d+)$`, "i");
  for (const p of points) {
    const match = p.id.match(regex);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }
  return `${prefix}${maxNum + 1}`;
}
