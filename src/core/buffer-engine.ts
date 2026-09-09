/**
 * Corridor Buffering & Statutory Setback Engine (v2)
 *
 * Generates gazetted road reserves (6m-60m) and 30m riparian buffers;
 * detects building encroachments.
 *
 * v2 geometry contract (parity-verified against GEOS/shapely, see
 * tests/buffer-parity.test.ts and scripts/golden_buffers.py):
 *  - Round joins at every interior bend (8 arc segments per quarter
 *    circle, matching GEOS quad_segs=8). The v1 engine offset each
 *    segment independently, which left wedge gaps or self-intersecting
 *    overlaps at every corner -- a legal ambiguity for a gazetted
 *    reserve whose boundary must be a single closed simple ring.
 *  - Flat end caps: the corridor terminates at the centerline extent.
 *    Round caps would reserve land beyond the gazetted road section.
 *  - `polygon` carries the closed, simple corridor ring (first vertex
 *    repeated last). `leftOffset`/`rightOffset` remain the two
 *    join-resolved edge paths for DXF/CAD exchange.
 *  - `areaSqM` remains the statutory register figure (centerline
 *    length x reserve width). The closed polygon differs from it only
 *    by the (correct) round-join wedges at bends.
 */

import { SurveyVector, CorridorBuffer, SurveyPoint } from "../types/spatial";

/** Arc segments per quarter circle for round joins (matches GEOS quad_segs=8). */
const QUAD_SEGS = 8;
/** Coordinates are emitted at millimetre precision (field-data convention). */
const MM = 3;
/** Consecutive vertices closer than this are treated as the same point (metres). */
const DUP_EPS = 1e-6;

type Pt = [number, number];

/** Remove consecutive duplicate vertices (keeps order, keeps first). */
function dedupePath(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > DUP_EPS) out.push(p);
  }
  return out;
}

/** Counterclockwise cross of segment directions (z of cross product). */
function crossZ(d1x: number, d1y: number, d2x: number, d2y: number): number {
  return d1x * d2y - d1y * d2x;
}

/**
 * Build one side's join-resolved offset path.
 *
 * side = +1 → left of travel direction (normal (-dy, dx));
 * side = -1 → right of travel direction.
 * Convex corners get a round-join arc; concave corners get the offset-line
 * intersection (inner miter); collinear vertices are dropped.
 */
function offsetPath(centerline: Pt[], halfWidth: number, side: 1 | -1): Pt[] {
  const d = halfWidth;
  const n = centerline.length;
  if (n < 2) return [];

  const path: Pt[] = [];
  // Unit direction of segment i (i in [0, n-2]).
  const dir: Pt[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = centerline[i + 1][0] - centerline[i][0];
    const dy = centerline[i + 1][1] - centerline[i][1];
    const len = Math.hypot(dx, dy);
    dir.push([dx / len, dy / len]);
  }
  // Outward normal of segment i for this side.
  const norm = (i: number): Pt => [-dir[i][1] * d * side, dir[i][0] * d * side];

  // Path start: offset of first vertex along the first segment's normal.
  const n0 = norm(0);
  path.push([
    Number((centerline[0][0] + n0[0]).toFixed(MM)),
    Number((centerline[0][1] + n0[1]).toFixed(MM)),
  ]);

  for (let i = 1; i < n - 1; i++) {
    const d1x = dir[i - 1][0], d1y = dir[i - 1][1];
    const d2x = dir[i][0], d2y = dir[i][1];
    const cr = crossZ(d1x, d1y, d2x, d2y);
    const dot = d1x * d2x + d1y * d2y;

    // Collinear (straight through): no join geometry needed.
    if (Math.abs(cr) < 1e-12 && dot > 0) continue;

    const na = norm(i - 1); // normal on the incoming segment
    const nb = norm(i);     // normal on the outgoing segment

    // Convex on this side → round join arc from na to nb. Turning left
    // (cr > 0) makes the LEFT side the inside of the bend (offset lines
    // overlap → concave miter) and the RIGHT side the outside (gap →
    // round join); turning right does the opposite. A 180-degree
    // reversal is convex on both sides (semicircular join).
    const reversal = Math.abs(cr) < 1e-12 && dot < 0;
    const convex = reversal || (side === 1 ? cr < 0 : cr > 0);

    if (convex) {
      const a0 = Math.atan2(na[1], na[0]);
      const a1 = Math.atan2(nb[1], nb[0]);
      // Signed sweep a0 -> a1 the short way, range (-pi, pi]. Both sides
      // sweep the short way around the outside of the corner.
      let sweep = a1 - a0;
      while (sweep > Math.PI) sweep -= 2 * Math.PI;
      while (sweep <= -Math.PI) sweep += 2 * Math.PI;
      if (reversal) {
        // Path doubles back: semicircular join bulging outward on this side.
        sweep = side === 1 ? Math.PI : -Math.PI;
      }
      const steps = Math.max(1, Math.round((QUAD_SEGS * Math.abs(sweep)) / (Math.PI / 2)));
      // k=0 is the incoming segment's offset endpoint (P + na) -- it MUST be
      // part of the path before the arc, otherwise the chord from the
      // previous path point to the first arc point cuts across the ring
      // (self-intersection). k=steps lands on P + nb exactly.
      for (let k = 0; k <= steps; k++) {
        const ang = a0 + (sweep * k) / steps;
        const x = centerline[i][0] + d * Math.cos(ang);
        const y = centerline[i][1] + d * Math.sin(ang);
        const last = path[path.length - 1];
        if (last && Math.hypot(x - last[0], y - last[1]) <= DUP_EPS) continue;
        path.push([
          Number(x.toFixed(MM)),
          Number(y.toFixed(MM)),
        ]);
      }
      continue;
    }

    // Concave on this side → intersect the two offset lines (inner miter).
    // Line A: through P + na along dir[i-1]; Line B: through P + nb along dir[i].
    const px = centerline[i][0], py = centerline[i][1];
    const ax = px + na[0], ay = py + na[1];
    const bx = px + nb[0], by = py + nb[1];
    const denom = crossZ(d1x, d1y, d2x, d2y);
    if (Math.abs(denom) < 1e-12) {
      // Nearly parallel despite the turn test: fall back to both points.
      path.push([Number((ax).toFixed(MM)), Number((ay).toFixed(MM))]);
      path.push([Number((bx).toFixed(MM)), Number((by).toFixed(MM))]);
    } else {
      const t = ((bx - ax) * d2y - (by - ay) * d2x) / denom;
      path.push([
        Number((ax + t * d1x).toFixed(MM)),
        Number((ay + t * d1y).toFixed(MM)),
      ]);
    }
  }

  // Path end: offset of last vertex along the last segment's normal.
  const nl = norm(n - 2);
  path.push([
    Number((centerline[n - 1][0] + nl[0]).toFixed(MM)),
    Number((centerline[n - 1][1] + nl[1]).toFixed(MM)),
  ]);
  return path;
}

/** Shoelace area of a closed or open ring (absolute value). */
export function ringArea(ring: Pt[]): number {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(s) / 2;
}

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
    // v2: consecutive duplicate vertices are removed before offsetting so
    // degenerate zero-length segments cannot corrupt join geometry.
    const pts = dedupePath(vec.points.map((p) => [p.easting, p.northing] as Pt));
    if (pts.length < 2) continue;

    // Join-resolved edge paths and the closed corridor ring.
    const leftOffset = offsetPath(pts, halfWidth, 1);
    const rightOffset = offsetPath(pts, halfWidth, -1);
    const polygon: Pt[] = [...leftOffset, ...[...rightOffset].reverse()];
    if (polygon.length > 2) polygon.push([...polygon[0]]); // close the ring

    // Check encroachment: do any building (BLD) points fall within distance to this centerline?
    let encroachmentDetected = false;
    for (const p of points) {
      if (p.category === "building" || p.category === "boundary") {
        for (let i = 0; i < pts.length - 1; i++) {
          const d = pointToSegmentDistance(p.easting, p.northing, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
          if (d < halfWidth) {
            encroachmentDetected = true;
            break;
          }
        }
      }
      if (encroachmentDetected) break;
    }

    // Statutory register area: centerline length x reserve width.
    let totalLen = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      totalLen += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    }
    const areaSqM = Number((totalLen * width).toFixed(2));

    buffers.push({
      id: `BUF-${bufferId++}-${isRiparian ? "RIPARIAN" : "ROAD"}`,
      sourceFeatureId: vec.id,
      featureName: `${vec.name} (${width}m Reserve)`,
      reserveWidthM: width,
      leftOffset,
      rightOffset,
      polygon,
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
