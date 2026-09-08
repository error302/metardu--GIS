/**
 * COGO (Coordinate Geometry) Engine
 * Standard surveying geometry algorithms: Forward Radiation, Inverse Computation,
 * Bearing-Bearing Intersection, Distance-Distance Trilateration, and Parallel Offsets.
 */

import { decimalToDms } from "./geodesy";

export interface CogoPoint {
  id?: string;
  easting: number;
  northing: number;
  elevation?: number;
}

export interface CogoInverseResult {
  distanceM: number;
  bearingDeg: number;
  bearingDms: string;
  deltaE: number;
  deltaN: number;
}

export interface CogoForwardResult {
  easting: number;
  northing: number;
  elevation?: number;
}

/**
 * Parse DMS string (e.g. "124°30'15\"", "124 30 15", "124-30-15") into decimal degrees
 */
export function dmsToDecimal(dmsStr: string): number {
  const clean = dmsStr.trim().replace(/[°'"NSEWnsew]/g, " ").replace(/\s+/g, " ");
  const parts = clean.split(" ").map(parseFloat).filter((n) => !isNaN(n));
  if (parts.length === 0) return 0;
  const d = parts[0] || 0;
  const m = parts[1] || 0;
  const s = parts[2] || 0;
  const sign = d < 0 ? -1 : 1;
  return sign * (Math.abs(d) + m / 60.0 + s / 3600.0);
}

/**
 * COGO Inverse: Computes distance, bearing, and delta between two coordinates
 */
export function cogoInverse(p1: CogoPoint, p2: CogoPoint): CogoInverseResult {
  const de = p2.easting - p1.easting;
  const dn = p2.northing - p1.northing;
  const distanceM = Number(Math.hypot(de, dn).toFixed(3));

  let rad = Math.atan2(de, dn);
  if (rad < 0) rad += 2 * Math.PI;

  const bearingDeg = Number(((rad * 180) / Math.PI).toFixed(4));
  const bearingDms = decimalToDms(bearingDeg);

  return {
    distanceM,
    bearingDeg,
    bearingDms,
    deltaE: Number(de.toFixed(3)),
    deltaN: Number(dn.toFixed(3)),
  };
}

/**
 * COGO Forward / Polar Radiation: Computes new coordinates from station, bearing, and distance
 */
export function cogoForward(
  origin: CogoPoint,
  bearingDeg: number,
  distanceM: number,
  verticalAngleDeg: number = 0
): CogoForwardResult {
  const rad = (bearingDeg * Math.PI) / 180;
  const hDist = distanceM * Math.cos((verticalAngleDeg * Math.PI) / 180);

  const easting = Number((origin.easting + hDist * Math.sin(rad)).toFixed(3));
  const northing = Number((origin.northing + hDist * Math.cos(rad)).toFixed(3));

  let elevation = origin.elevation;
  if (elevation !== undefined && verticalAngleDeg !== 0) {
    elevation = Number((elevation + distanceM * Math.sin((verticalAngleDeg * Math.PI) / 180)).toFixed(3));
  }

  return { easting, northing, elevation };
}

/**
 * Bearing-Bearing Intersection: Finds point of intersection between two rays
 */
export function intersectBearingBearing(
  p1: CogoPoint,
  bearing1Deg: number,
  p2: CogoPoint,
  bearing2Deg: number
): CogoPoint | null {
  const r1 = (bearing1Deg * Math.PI) / 180;
  const r2 = (bearing2Deg * Math.PI) / 180;

  const sin1 = Math.sin(r1), cos1 = Math.cos(r1);
  const sin2 = Math.sin(r2), cos2 = Math.cos(r2);

  // Cross product determinant
  const det = sin1 * cos2 - cos1 * sin2;
  if (Math.abs(det) < 1e-7) return null; // Parallel or anti-parallel

  const dx = p2.easting - p1.easting;
  const dy = p2.northing - p1.northing;

  const t = (dx * cos2 - dy * sin2) / det;
  if (t < 0) return null; // Point is behind ray 1

  return {
    easting: Number((p1.easting + t * sin1).toFixed(3)),
    northing: Number((p1.northing + t * cos1).toFixed(3)),
  };
}

/**
 * Parallel Line Offset: Offsets a baseline segment by width W (positive = right, negative = left)
 */
export function offsetLineSegment(
  p1: CogoPoint,
  p2: CogoPoint,
  offsetM: number
): [CogoPoint, CogoPoint] {
  const de = p2.easting - p1.easting;
  const dn = p2.northing - p1.northing;
  const len = Math.hypot(de, dn);
  if (len === 0) return [p1, p2];

  // Unit normal perpendicular (to the right of direction p1->p2)
  const nx = dn / len;
  const ny = -de / len;

  return [
    {
      easting: Number((p1.easting + nx * offsetM).toFixed(3)),
      northing: Number((p1.northing + ny * offsetM).toFixed(3)),
    },
    {
      easting: Number((p2.easting + nx * offsetM).toFixed(3)),
      northing: Number((p2.northing + ny * offsetM).toFixed(3)),
    },
  ];
}
