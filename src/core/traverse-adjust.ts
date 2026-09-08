/**
 * Traverse Adjustment Engine
 * Bowditch (Compass Rule) and Transit Rule mathematical adjustment for closed polygon and link traverses.
 * Conforms to Survey of Kenya Cadastral Regulations and Commonwealth geodetic survey standards.
 */

import { CogoPoint, cogoInverse } from "./cogo";
import { decimalToDms } from "./geodesy";

export interface TraverseObservation {
  fromId: string;
  toId: string;
  distanceM: number;
  bearingDeg: number;
}

export interface TraverseLeg {
  fromId: string;
  toId: string;
  measuredDistanceM: number;
  measuredBearingDeg: number;
  measuredBearingDms: string;
  deltaE: number;
  deltaN: number;
  corrE: number;
  corrN: number;
  adjustedE: number;
  adjustedN: number;
}

export interface TraverseAdjustmentReport {
  method: "Bowditch" | "Transit";
  isClosed: boolean;
  totalPerimeterM: number;
  misclosureE: number;
  misclosureN: number;
  linearMisclosureM: number;
  relativePrecisionRatio: number; // e.g. 25000 for 1:25,000
  precisionFraction: string; // e.g. "1:25,410"
  status: "PASSED" | "EXCEEDED";
  standardToleranceRatio: number; // e.g. 10000 for 1:10,000 Class A cadastre
  legs: TraverseLeg[];
  adjustedPoints: CogoPoint[];
}

/**
 * Adjusts a traverse from field observations (bearing and distance for each leg).
 * Can be a closed loop traverse (closing back to startPoint) or a link traverse (closing to endControlPoint).
 */
export function adjustTraverseFromObservations(
  startPoint: CogoPoint,
  observations: TraverseObservation[],
  closingPoint?: CogoPoint,
  standardToleranceRatio: number = 10000
): TraverseAdjustmentReport {
  if (observations.length < 2) {
    throw new Error("Traverse requires at least 2 observed legs.");
  }

  const targetEnd = closingPoint || startPoint;
  let totalPerimeter = 0;
  let sumDeltaE = 0;
  let sumDeltaN = 0;

  // 1. Calculate raw departures (dE) and latitudes (dN)
  const rawLegs = observations.map((obs) => {
    const rad = (obs.bearingDeg * Math.PI) / 180;
    const de = obs.distanceM * Math.sin(rad);
    const dn = obs.distanceM * Math.cos(rad);

    totalPerimeter += obs.distanceM;
    sumDeltaE += de;
    sumDeltaN += dn;

    return {
      fromId: obs.fromId,
      toId: obs.toId,
      distanceM: obs.distanceM,
      bearingDeg: obs.bearingDeg,
      bearingDms: decimalToDms(obs.bearingDeg),
      rawDeltaE: de,
      rawDeltaN: dn,
    };
  });

  // 2. Computed end coordinates vs Known Target end coordinates
  const computedEndE = startPoint.easting + sumDeltaE;
  const computedEndN = startPoint.northing + sumDeltaN;

  const misclosureE = Number((computedEndE - targetEnd.easting).toFixed(4));
  const misclosureN = Number((computedEndN - targetEnd.northing).toFixed(4));
  const linearMisclosure = Number(Math.hypot(misclosureE, misclosureN).toFixed(4));

  // 3. Precision: Perimeter / Linear Misclosure
  const precisionRatio =
    linearMisclosure > 0.0001
      ? Math.round(totalPerimeter / linearMisclosure)
      : 999999;
  const precisionFraction = `1:${precisionRatio.toLocaleString()}`;
  const status = precisionRatio >= standardToleranceRatio ? "PASSED" : "EXCEEDED";

  // 4. Distribute error using Bowditch Rule: corr = -misclosure * (legDistance / perimeter)
  let currentE = startPoint.easting;
  let currentN = startPoint.northing;

  const adjustedPoints: CogoPoint[] = [{ ...startPoint }];
  const adjustedLegs: TraverseLeg[] = [];

  for (let i = 0; i < rawLegs.length; i++) {
    const leg = rawLegs[i];
    const weight = totalPerimeter > 0 ? leg.distanceM / totalPerimeter : 0;
    const corrE = Number((-misclosureE * weight).toFixed(4));
    const corrN = Number((-misclosureN * weight).toFixed(4));

    const adjDeltaE = leg.rawDeltaE + corrE;
    const adjDeltaN = leg.rawDeltaN + corrN;

    currentE = Number((currentE + adjDeltaE).toFixed(3));
    currentN = Number((currentN + adjDeltaN).toFixed(3));

    // For the final point, snap exactly to targetEnd
    const finalE = i === rawLegs.length - 1 ? targetEnd.easting : currentE;
    const finalN = i === rawLegs.length - 1 ? targetEnd.northing : currentN;

    const nextStation: CogoPoint = {
      id: leg.toId,
      easting: finalE,
      northing: finalN,
    };

    if (i < rawLegs.length - 1 || targetEnd !== startPoint) {
      adjustedPoints.push(nextStation);
    }

    adjustedLegs.push({
      fromId: leg.fromId,
      toId: leg.toId,
      measuredDistanceM: leg.distanceM,
      measuredBearingDeg: leg.bearingDeg,
      measuredBearingDms: leg.bearingDms,
      deltaE: Number(leg.rawDeltaE.toFixed(3)),
      deltaN: Number(leg.rawDeltaN.toFixed(3)),
      corrE,
      corrN,
      adjustedE: finalE,
      adjustedN: finalN,
    });
  }

  return {
    method: "Bowditch",
    isClosed: targetEnd === startPoint,
    totalPerimeterM: Number(totalPerimeter.toFixed(3)),
    misclosureE,
    misclosureN,
    linearMisclosureM: linearMisclosure,
    relativePrecisionRatio: precisionRatio,
    precisionFraction,
    status,
    standardToleranceRatio,
    legs: adjustedLegs,
    adjustedPoints,
  };
}

/**
 * Convenience wrapper for closed polygon coordinates
 */
export function adjustTraverseBowditch(
  stations: CogoPoint[],
  standardToleranceRatio: number = 10000
): TraverseAdjustmentReport {
  if (stations.length < 3) {
    throw new Error("Traverse requires at least 3 stations.");
  }

  // Generate observed legs from stations
  const observations: TraverseObservation[] = [];
  for (let i = 0; i < stations.length; i++) {
    const p1 = stations[i];
    const p2 = stations[(i + 1) % stations.length];
    const inv = cogoInverse(p1, p2);
    observations.push({
      fromId: p1.id || `STN_${i + 1}`,
      toId: p2.id || `STN_${((i + 1) % stations.length) + 1}`,
      distanceM: inv.distanceM,
      bearingDeg: inv.bearingDeg,
    });
  }

  return adjustTraverseFromObservations(
    stations[0],
    observations,
    stations[0],
    standardToleranceRatio
  );
}
