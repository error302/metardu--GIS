/**
 * Corridor Buffering & Statutory Setback Engine
 * Generates gazetted road reserves (6m-60m) and 30m riparian buffers; detects building encroachments.
 */

import { SurveyVector, CorridorBuffer, SurveyPoint } from "../types/spatial";

export function generateCorridorBuffers(
  vectors: SurveyVector[],
  points: SurveyPoint[],
  roadReserveWidthM = 15.0,
  riparianBufferM = 30.0
): CorridorBuffer[] {
  const buffers: CorridorBuffer[] = [];
  let bufferId = 1;

  for (const vec of vectors) {
    let width = 0;
    let isRiparian = false;

    if (vec.category === "road" || vec.code === "RD-CL") {
      width = roadReserveWidthM;
    } else if (vec.category === "water" || vec.code === "RIV") {
      width = riparianBufferM;
      isRiparian = true;
    } else {
      continue;
    }

    const halfWidth = width / 2;
    const pts = vec.points;
    if (pts.length < 2) continue;

    const leftOffset: [number, number][] = [];
    const rightOffset: [number, number][] = [];

    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i];
      const p2 = pts[i + 1];

      const dx = p2.easting - p1.easting;
      const dy = p2.northing - p1.northing;
      const len = Math.hypot(dx, dy) || 1;

      // Normal vector (-dy, dx)
      const nx = (-dy / len) * halfWidth;
      const ny = (dx / len) * halfWidth;

      if (i === 0) {
        leftOffset.push([Number((p1.easting + nx).toFixed(3)), Number((p1.northing + ny).toFixed(3))]);
        rightOffset.push([Number((p1.easting - nx).toFixed(3)), Number((p1.northing - ny).toFixed(3))]);
      }
      leftOffset.push([Number((p2.easting + nx).toFixed(3)), Number((p2.northing + ny).toFixed(3))]);
      rightOffset.push([Number((p2.easting - nx).toFixed(3)), Number((p2.northing - ny).toFixed(3))]);
    }

    // Check encroachment: do any building (BLD) points fall within distance to this centerline?
    let encroachmentDetected = false;
    for (const p of points) {
      if (p.category === "building" || p.category === "boundary") {
        for (let i = 0; i < pts.length - 1; i++) {
          const d = pointToSegmentDistance(p.easting, p.northing, pts[i].easting, pts[i].northing, pts[i + 1].easting, pts[i + 1].northing);
          if (d < halfWidth) {
            encroachmentDetected = true;
            break;
          }
        }
      }
      if (encroachmentDetected) break;
    }

    // Rough corridor area
    let totalLen = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      totalLen += Math.hypot(pts[i + 1].easting - pts[i].easting, pts[i + 1].northing - pts[i].northing);
    }
    const areaSqM = Number((totalLen * width).toFixed(2));

    buffers.push({
      id: `BUF-${bufferId++}-${isRiparian ? "RIPARIAN" : "ROAD"}`,
      sourceFeatureId: vec.id,
      featureName: `${vec.name} (${width}m Reserve)`,
      reserveWidthM: width,
      leftOffset,
      rightOffset,
      areaSqM,
      encroachmentDetected,
    });
  }

  return buffers;
}

export function pointToSegmentDistance(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) return Math.hypot(px - x1, py - y1);

  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = x1 + t * dx;
  const projY = y1 + t * dy;

  return Math.hypot(px - projX, py - projY);
}