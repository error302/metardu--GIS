/**
 * MetaRDU GIS Studio - Advanced Spatial Analysis & Geoprocessing Extensions
 * Pure client-side algorithms: Voronoi / Thiessen Polygons, Spatial Join (Point-in-Polygon),
 * Convex Hull, Polygon Dissolve, and Equal-Area Cadastral Subdivision.
 */

import { SurveyPoint } from "../types/spatial";

/**
 * Tests whether point (px, py) is strictly inside polygon using Jordan ray-casting algorithm.
 */
export function pointInPolygon(px: number, py: number, polygon: [number, number][]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];

    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Calculates planar polygon area in square meters using the Shoelace formula.
 */
export function calculatePolygonArea(polygon: [number, number][]): number {
  let area = 0;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += polygon[i][0] * polygon[j][1];
    area -= polygon[j][0] * polygon[i][1];
  }
  return Math.abs(area) / 2.0;
}

/**
 * Computes the 2D Convex Hull of a set of 2D points using Andrew's Monotone Chain Algorithm.
 * Returns vertices in counter-clockwise order. Time complexity: O(N log N).
 */
export function computeConvexHull(points: [number, number][]): [number, number][] {
  if (points.length <= 2) return [...points];

  // 1. Sort points lexicographically (first by x, then by y)
  const sorted = [...points].sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));

  // 2D cross product of OA and OB vectors: (A.x - O.x)*(B.y - O.y) - (A.y - O.y)*(B.x - O.x)
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  // 2. Build lower hull
  const lower: [number, number][] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  // 3. Build upper hull
  const upper: [number, number][] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  // Remove the last point of each half because it's repeated at the beginning of the other
  lower.pop();
  upper.pop();

  return lower.concat(upper);
}

export interface SpatialJoinResult {
  polygonId: string;
  polygonName: string;
  pointCount: number;
  containedPointIds: string[];
  totalDemandKwh?: number;
  averageElevationM: number;
  dominantCategory: string;
}

/**
 * Executes a Spatial Join (Point-in-Polygon Aggregation).
 */
export function executeSpatialJoin(
  polygons: { id: string; name: string; coordinates: [number, number][] }[],
  points: SurveyPoint[]
): SpatialJoinResult[] {
  return polygons.map((poly) => {
    const contained: SurveyPoint[] = [];
    let elevSum = 0;
    let demandSum = 0;
    const catCounts: Record<string, number> = {};

    for (const pt of points) {
      if (pointInPolygon(pt.easting, pt.northing, poly.coordinates)) {
        contained.push(pt);
        elevSum += pt.elevation;
        if (pt.properties?.dailyDemandKwh) {
          demandSum += Number(pt.properties.dailyDemandKwh);
        }
        catCounts[pt.category] = (catCounts[pt.category] || 0) + 1;
      }
    }

    let dominantCat = "none";
    let maxCount = 0;
    for (const [cat, count] of Object.entries(catCounts)) {
      if (count > maxCount) {
        maxCount = count;
        dominantCat = cat;
      }
    }

    return {
      polygonId: poly.id,
      polygonName: poly.name,
      pointCount: contained.length,
      containedPointIds: contained.map((p) => p.id),
      totalDemandKwh: demandSum > 0 ? Number(demandSum.toFixed(2)) : undefined,
      averageElevationM: contained.length > 0 ? Number((elevSum / contained.length).toFixed(2)) : 0,
      dominantCategory: dominantCat,
    };
  });
}

export interface VoronoiCell {
  seedPointId: string;
  seedCoord: [number, number];
  polygon: [number, number][];
  areaM2: number;
  areaHa: number;
}

/**
 * Computes Voronoi / Thiessen polygons for a set of seed points bounded by a rectangular bounding box.
 * Uses half-plane clipping to determine each cell cleanly.
 */
export function computeThiessenPolygons(
  seedPoints: SurveyPoint[],
  bbox: { minE: number; maxE: number; minN: number; maxN: number }
): VoronoiCell[] {
  if (seedPoints.length === 0) return [];

  const pad = 10;
  const initialBox: [number, number][] = [
    [bbox.minE - pad, bbox.minN - pad],
    [bbox.maxE + pad, bbox.minN - pad],
    [bbox.maxE + pad, bbox.maxN + pad],
    [bbox.minE - pad, bbox.maxN + pad],
  ];

  // Clip polygon with half-plane: a*x + b*y + c <= 0
  const clipPolygonWithHalfPlane = (
    poly: [number, number][],
    ax: number,
    ay: number,
    bx: number,
    by: number
  ): [number, number][] => {
    // Perpendicular bisector of segment AB:
    // Midpoint M = ((ax+bx)/2, (ay+by)/2)
    // Normal vector from A to B: (bx - ax, by - ay)
    // Half-plane containing A: (x - mx)*(bx - ax) + (y - my)*(by - ay) <= 0
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const nx = bx - ax;
    const ny = by - ay;

    const isInside = (x: number, y: number) => (x - mx) * nx + (y - my) * ny <= 0;

    const out: [number, number][] = [];
    const n = poly.length;
    if (n === 0) return out;

    for (let i = 0; i < n; i++) {
      const curr = poly[i];
      const prev = poly[(i + n - 1) % n];

      const currIn = isInside(curr[0], curr[1]);
      const prevIn = isInside(prev[0], prev[1]);

      if (currIn) {
        if (!prevIn) {
          // Intersection
          const t =
            -((prev[0] - mx) * nx + (prev[1] - my) * ny) /
            ((curr[0] - prev[0]) * nx + (curr[1] - prev[1]) * ny);
          out.push([prev[0] + t * (curr[0] - prev[0]), prev[1] + t * (curr[1] - prev[1])]);
        }
        out.push(curr);
      } else if (prevIn) {
        const t =
          -((prev[0] - mx) * nx + (prev[1] - my) * ny) /
          ((curr[0] - prev[0]) * nx + (curr[1] - prev[1]) * ny);
        out.push([prev[0] + t * (curr[0] - prev[0]), prev[1] + t * (curr[1] - prev[1])]);
      }
    }
    return out;
  };

  const cells: VoronoiCell[] = [];

  for (let i = 0; i < seedPoints.length; i++) {
    const ptA = seedPoints[i];
    let cellPoly = [...initialBox];

    for (let j = 0; j < seedPoints.length; j++) {
      if (i === j) continue;
      const ptB = seedPoints[j];
      cellPoly = clipPolygonWithHalfPlane(
        cellPoly,
        ptA.easting,
        ptA.northing,
        ptB.easting,
        ptB.northing
      );
      if (cellPoly.length < 3) break;
    }

    if (cellPoly.length >= 3) {
      const area = calculatePolygonArea(cellPoly);
      cells.push({
        seedPointId: ptA.id,
        seedCoord: [ptA.easting, ptA.northing],
        polygon: cellPoly.map((p) => [Number(p[0].toFixed(2)), Number(p[1].toFixed(2))]),
        areaM2: Number(area.toFixed(1)),
        areaHa: Number((area / 10000).toFixed(3)),
      });
    }
  }

  return cells;
}

export interface ParcelSubdivisionResult {
  originalAreaM2: number;
  originalAreaHa: number;
  targetCount: number;
  targetAreaPerParcelM2: number;
  subParcels: {
    parcelNumber: number;
    areaM2: number;
    areaHa: number;
    perimeterM: number;
    boundary: [number, number][];
  }[];
}

/**
 * Subdivides a parcel polygon into N approximately equal-area subplots along its primary axis (East-West).
 */
export function subdivideParcelEqualArea(
  polygon: [number, number][],
  subdivisionCount: number = 2
): ParcelSubdivisionResult {
  const originalArea = calculatePolygonArea(polygon);
  const targetCount = Math.max(2, Math.min(10, Math.floor(subdivisionCount)));
  const targetArea = originalArea / targetCount;

  // Bounding box in Easting
  let minE = Infinity, maxE = -Infinity;
  for (const p of polygon) {
    if (p[0] < minE) minE = p[0];
    if (p[0] > maxE) maxE = p[0];
  }

  // Clip polygon with vertical line Easting <= x or >= x
  const clipByVerticalLine = (poly: [number, number][], xCut: number, side: "left" | "right"): [number, number][] => {
    const isInside = (x: number) => (side === "left" ? x <= xCut : x >= xCut);
    const out: [number, number][] = [];
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const curr = poly[i];
      const prev = poly[(i + n - 1) % n];
      const currIn = isInside(curr[0]);
      const prevIn = isInside(prev[0]);

      if (currIn) {
        if (!prevIn) {
          const t = (xCut - prev[0]) / (curr[0] - prev[0]);
          out.push([xCut, prev[1] + t * (curr[1] - prev[1])]);
        }
        out.push(curr);
      } else if (prevIn) {
        const t = (xCut - prev[0]) / (curr[0] - prev[0]);
        out.push([xCut, prev[1] + t * (curr[1] - prev[1])]);
      }
    }
    return out;
  };

  const subParcels: ParcelSubdivisionResult["subParcels"] = [];
  let remainingPoly = [...polygon];

  for (let k = 1; k < targetCount; k++) {
    // Binary search for cut coordinate xCut such that left part area == targetArea
    let low = minE;
    let high = maxE;
    let bestCut = (low + high) / 2;

    for (let iter = 0; iter < 20; iter++) {
      bestCut = (low + high) / 2;
      const leftPart = clipByVerticalLine(remainingPoly, bestCut, "left");
      const leftArea = calculatePolygonArea(leftPart);

      if (Math.abs(leftArea - targetArea) < 5) break;
      if (leftArea < targetArea) {
        low = bestCut;
      } else {
        high = bestCut;
      }
    }

    const parcelSlice = clipByVerticalLine(remainingPoly, bestCut, "left");
    remainingPoly = clipByVerticalLine(remainingPoly, bestCut, "right");
    const pArea = calculatePolygonArea(parcelSlice);

    // Compute perimeter
    let perim = 0;
    for (let i = 0; i < parcelSlice.length; i++) {
      const next = parcelSlice[(i + 1) % parcelSlice.length];
      perim += Math.hypot(next[0] - parcelSlice[i][0], next[1] - parcelSlice[i][1]);
    }

    subParcels.push({
      parcelNumber: k,
      areaM2: Number(pArea.toFixed(1)),
      areaHa: Number((pArea / 10000).toFixed(3)),
      perimeterM: Number(perim.toFixed(1)),
      boundary: parcelSlice.map((p) => [Number(p[0].toFixed(2)), Number(p[1].toFixed(2))]),
    });
  }

  // Last remaining parcel
  const lastArea = calculatePolygonArea(remainingPoly);
  let lastPerim = 0;
  for (let i = 0; i < remainingPoly.length; i++) {
    const next = remainingPoly[(i + 1) % remainingPoly.length];
    lastPerim += Math.hypot(next[0] - remainingPoly[i][0], next[1] - remainingPoly[i][1]);
  }

  subParcels.push({
    parcelNumber: targetCount,
    areaM2: Number(lastArea.toFixed(1)),
    areaHa: Number((lastArea / 10000).toFixed(3)),
    perimeterM: Number(lastPerim.toFixed(1)),
    boundary: remainingPoly.map((p) => [Number(p[0].toFixed(2)), Number(p[1].toFixed(2))]),
  });

  return {
    originalAreaM2: Number(originalArea.toFixed(1)),
    originalAreaHa: Number((originalArea / 10000).toFixed(3)),
    targetCount,
    targetAreaPerParcelM2: Number(targetArea.toFixed(1)),
    subParcels,
  };
}
