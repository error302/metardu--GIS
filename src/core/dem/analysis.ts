/**
 * Regional terrain analysis over a decoded GLO-30 grid.
 *
 * Pure functions over the DemGrid model (row-major, rows north→south,
 * lon/lat georeference) so every product is unit-testable without
 * network or DOM. The surveyed TIN remains the statutory elevation
 * source inside the job boundary — these products are regional context
 * (drainage direction, slopes, reconnaissance profiles) and are always
 * disclosed as such in the UI.
 *
 * Conventions:
 *  - lon/lat in WGS84 degrees; ground meters via equirectangular scaling
 *    (dy = dLat·111320, dx = dLon·111320·cos(lat)) — valid for the ≤1°
 *    windows this module consumes.
 *  - NaN cells are masked data; every product skips them and reports
 *    how much of the grid it could actually see.
 */

import { DemGrid } from "./copernicus";

const M_PER_DEG_LAT = 111_320;

/* ------------------------------------------------------------------ */
/* Sampling                                                            */
/* ------------------------------------------------------------------ */

/** Continuous-coordinate bilinear sample; NaN when a corner is masked. */
export function sampleGrid(grid: DemGrid, lon: number, lat: number): number {
  // Pixel centers sit at (c + 0.5)·dLon from the west edge — convert to
  // continuous index space where integers are pixel centers. An epsilon
  // relaxes the bounds so a station computed at exactly the grid edge
  // (float64 drift) still samples the edge cells instead of returning NaN.
  const EPS = 1e-9;
  const cf = (lon - grid.west) / grid.dLonDeg - 0.5;
  const rf = (grid.north - lat) / grid.dLatDeg - 0.5;
  if (cf < -0.5 - EPS || rf < -0.5 - EPS || cf > grid.width - 0.5 + EPS || rf > grid.height - 0.5 + EPS) {
    return NaN;
  }
  const c0 = Math.min(Math.max(Math.floor(cf), 0), grid.width - 2);
  const r0 = Math.min(Math.max(Math.floor(rf), 0), grid.height - 2);
  const fx = Math.min(Math.max(cf - c0, 0), 1);
  const fy = Math.min(Math.max(rf - r0, 0), 1);
  const z00 = grid.values[r0 * grid.width + c0];
  const z01 = grid.values[r0 * grid.width + c0 + 1];
  const z10 = grid.values[(r0 + 1) * grid.width + c0];
  const z11 = grid.values[(r0 + 1) * grid.width + c0 + 1];
  if (!Number.isFinite(z00) || !Number.isFinite(z01) || !Number.isFinite(z10) || !Number.isFinite(z11)) {
    return NaN;
  }
  const top = z00 * (1 - fx) + z01 * fx;
  const bot = z10 * (1 - fx) + z11 * fx;
  return top * (1 - fy) + bot * fy;
}

/* ------------------------------------------------------------------ */
/* Statistics                                                          */
/* ------------------------------------------------------------------ */

export interface GridStats {
  minM: number;
  maxM: number;
  meanM: number;
  stdDevM: number;
  validCount: number;
  /** Valid samples / total cells (0..1) — the coverage disclosure. */
  coverage: number;
  /** Cell edges of the grid in WGS84 (for display). */
  bbox: { lonMin: number; latMin: number; lonMax: number; latMax: number };
}

export function gridStats(grid: DemGrid): GridStats {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < grid.values.length; i++) {
    const v = grid.values[i];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    n++;
  }
  const mean = n > 0 ? sum / n : NaN;
  let varSum = 0;
  for (let i = 0; i < grid.values.length; i++) {
    const v = grid.values[i];
    if (!Number.isFinite(v)) continue;
    varSum += (v - mean) * (v - mean);
  }
  return {
    minM: n > 0 ? min : NaN,
    maxM: n > 0 ? max : NaN,
    meanM: mean,
    stdDevM: n > 0 ? Math.sqrt(varSum / n) : NaN,
    validCount: n,
    coverage: n / (grid.width * grid.height),
    bbox: {
      lonMin: grid.west,
      latMin: grid.north - grid.height * grid.dLatDeg,
      lonMax: grid.west + grid.width * grid.dLonDeg,
      latMax: grid.north,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Slope — Horn's 3×3 method (the GDAL default), degrees               */
/* ------------------------------------------------------------------ */

/**
 * Slope grid in degrees, same dimensions as the input (NaN on the 1-px
 * border, at masked cells, and where any of the 8 neighbors is masked).
 * Cell size honors the latitude: dy from dLat, dx from dLon·cos(lat).
 */
export function gridSlope(grid: DemGrid): Float32Array {
  const { width, height, values } = grid;
  const out = new Float32Array(width * height).fill(NaN);
  const latCenter = grid.north - (height * grid.dLatDeg) / 2;
  const dy = grid.dLatDeg * M_PER_DEG_LAT;
  const dx = grid.dLonDeg * M_PER_DEG_LAT * Math.max(0.1, Math.cos((latCenter * Math.PI) / 180));

  for (let r = 1; r < height - 1; r++) {
    for (let c = 1; c < width - 1; c++) {
      const i = r * width + c;
      if (!Number.isFinite(values[i])) continue; // masked center: no slope
      const nw = values[i - width - 1];
      const n = values[i - width];
      const ne = values[i - width + 1];
      const w = values[i - 1];
      const e = values[i + 1];
      const sw = values[i + width - 1];
      const s = values[i + width];
      const se = values[i + width + 1];
      if (![nw, n, ne, w, e, sw, s, se].every(Number.isFinite)) continue;
      // Rows run north→south: row r-1 is the NORTH neighbor, so the
      // north-pointing gradient subtracts the southern stencil.
      const dzdx = (ne + 2 * e + se - (nw + 2 * w + sw)) / (8 * dx);
      const dzdy = (nw + 2 * n + ne - (sw + 2 * s + se)) / (8 * dy);
      out[i] = Math.atan(Math.hypot(dzdx, dzdy)) * (180 / Math.PI);
    }
  }
  return out;
}

/** Histogram of a slope grid in fixed degree bins (masked cells skipped). */
export interface SlopeHistogram {
  /** Inclusive bin edges, e.g. [0,2,4,...] — bins.length - 1 buckets. */
  edges: number[];
  counts: number[];
  /** Cells seen (finite) and total interior cells, for the disclosure. */
  evaluated: number;
}

export function slopeHistogram(slope: Float32Array, binDeg = 2): SlopeHistogram {
  // Cap the top bin at the last edge — steeper terrain all lands there.
  const edges = [0, 2, 4, 6, 8, 10, 15, 20, 30, 45];
  const counts = new Array(edges.length - 1).fill(0);
  let evaluated = 0;
  for (let i = 0; i < slope.length; i++) {
    const v = slope[i];
    if (!Number.isFinite(v)) continue;
    evaluated++;
    let b = 0;
    for (let k = 1; k < edges.length; k++) {
      if (v >= edges[k]) b = k;
      else break;
    }
    counts[Math.min(b, counts.length - 1)]++;
  }
  return { edges, counts, evaluated };
}

/* ------------------------------------------------------------------ */
/* Terrain profile — bilinear elevations along a straight WGS84 line   */
/* ------------------------------------------------------------------ */

export interface ProfileStation {
  /** Ground distance from the start point, meters (equirectangular). */
  distM: number;
  /** NaN where the line crosses masked cells. */
  elevM: number;
}

/**
 * Sample `count` equally spaced stations (inclusive of both ends) along
 * the straight line from→to. Distance uses the local equirectangular
 * metric; the vertical exaggeration choices belong to the caller.
 */
export function terrainProfile(
  grid: DemGrid,
  from: { lon: number; lat: number },
  to: { lon: number; lat: number },
  count = 160,
): ProfileStation[] {
  const latCenter = (from.lat + to.lat) / 2;
  const cos = Math.max(0.1, Math.cos((latCenter * Math.PI) / 180));
  const dLon = to.lon - from.lon;
  const dLat = to.lat - from.lat;
  const lenM = Math.hypot(dLon * M_PER_DEG_LAT * cos, dLat * M_PER_DEG_LAT);
  const n = Math.max(2, count);
  const stations: ProfileStation[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    stations.push({
      distM: lenM * t,
      elevM: sampleGrid(grid, from.lon + dLon * t, from.lat + dLat * t),
    });
  }
  return stations;
}

/* ------------------------------------------------------------------ */
/* Contours — marching squares with segment stitching                  */
/* ------------------------------------------------------------------ */

export interface GridContour {
  level: number;
  /** True for every `indexEvery`-th level (heavier cartographic stroke). */
  isIndex: boolean;
  /** Polyline(s) at this level; lon/lat pairs, rows closed by repetition. */
  lines: [number, number][][];
}

/** Marching-squares edge cases: corner bitmask → [startEdge, endEdge] pairs. */
type M2 = [number, number];

const CASES: Record<number, M2[]> = {
  // Bit order: NW=1, NE=2, SE=4, SW=8 (corner >= level)
  1: [[3, 0]],
  2: [[0, 1]],
  3: [[3, 1]],
  4: [[1, 2]],
  5: [[3, 0], [1, 2]],
  6: [[0, 2]],
  7: [[3, 2]],
  8: [[2, 3]],
  9: [[0, 2]],
  10: [[0, 1], [2, 3]],
  11: [[1, 2]],
  12: [[1, 3]],
  13: [[0, 1]],
  14: [[0, 3]],
  15: [],
};
// Edge indices: 0 = top (N edge), 1 = right (E edge), 2 = bottom (S edge), 3 = left (W edge)

function key(x: number, y: number): string {
  return `${Math.round(x * 1e9)}:${Math.round(y * 1e9)}`;
}

/**
 * Extract contour polylines at a fixed elevation interval. Adjacent cells
 * share bitwise-identical edge points, so stitching by exact endpoint
 * keys joins segments into the longest possible lines; closed loops are
 * emitted as rings (first point repeated last). Levels with no crossing
 * are omitted; every line carries its level for labeling.
 */
export function gridContours(grid: DemGrid, interval = 20, indexEvery = 5): GridContour[] {
  if (interval <= 0) throw new Error("contour interval must be positive");
  const stats = gridStats(grid);
  if (!Number.isFinite(stats.minM)) return [];
  const out: GridContour[] = [];

  for (
    let level = Math.ceil(stats.minM / interval) * interval;
    level <= stats.maxM;
    level += interval
  ) {
    const lvl = Math.round(level * 100) / 100;
    const segs: [number, number, number, number][] = [];

    for (let r = 0; r < grid.height - 1; r++) {
      for (let c = 0; c < grid.width - 1; c++) {
        const i = r * grid.width + c;
        const nw = grid.values[i];
        const ne = grid.values[i + 1];
        const sw = grid.values[i + grid.width];
        const se = grid.values[i + grid.width + 1];
        if (![nw, ne, sw, se].every(Number.isFinite)) continue;
        const mask =
          (nw >= lvl ? 1 : 0) | (ne >= lvl ? 2 : 0) | (se >= lvl ? 4 : 0) | (sw >= lvl ? 8 : 0);
        const cases = CASES[mask];
        if (!cases || cases.length === 0) continue;

        const x0 = grid.west + c * grid.dLonDeg;
        const x1 = x0 + grid.dLonDeg;
        const y0 = grid.north - r * grid.dLatDeg; // top (north)
        const y1 = y0 - grid.dLatDeg; // bottom (south)
        // Edge point: lerp where the level crosses each edge.
        const edgePoint = (edge: number): [number, number] => {
          switch (edge) {
            case 0:
              return [x0 + ((lvl - nw) / (ne - nw)) * grid.dLonDeg, y0];
            case 1:
              return [x1, y0 + ((lvl - ne) / (se - ne)) * grid.dLatDeg];
            case 2:
              return [x0 + ((lvl - sw) / (se - sw)) * grid.dLonDeg, y1];
            default:
              return [x0, y0 + ((lvl - nw) / (sw - nw)) * grid.dLatDeg];
          }
        };
        for (const [a, b] of cases) {
          const pa = edgePoint(a);
          const pb = edgePoint(b);
          segs.push([pa[0], pa[1], pb[0], pb[1]]);
        }
      }
    }

    if (segs.length === 0) continue;

    /* Stitch — endpoint hash: each point key maps to segment ends. */
    const byKey = new Map<string, number[]>();
    const kOf = (s: number, end: 0 | 1) => key(segs[s][end === 0 ? 0 : 2], segs[s][end === 0 ? 1 : 3]);
    for (let s = 0; s < segs.length; s++) {
      for (const end of [0, 1] as const) {
        const k = kOf(s, end);
        const list = byKey.get(k);
        if (list) list.push(s);
        else byKey.set(k, [s]);
      }
    }
    const used = new Uint8Array(segs.length);
    const lines: [number, number][][] = [];
    for (let s = 0; s < segs.length; s++) {
      if (used[s]) continue;
      used[s] = 1;
      const line: [number, number][] = [
        [segs[s][0], segs[s][1]],
        [segs[s][2], segs[s][3]],
      ];
      // Extend forward and backward until a dead end or a closed loop.
      for (const dir of [1, -1] as const) {
        for (;;) {
          const tail = dir === 1 ? line[line.length - 1] : line[0];
          const cands = byKey.get(key(tail[0], tail[1]));
          let next = -1;
          if (cands) {
            for (const cand of cands) {
              if (!used[cand]) {
                next = cand;
                break;
              }
            }
          }
          if (next < 0) break;
          used[next] = 1;
          const p: [number, number] = [segs[next][2], segs[next][3]];
          const q: [number, number] = [segs[next][0], segs[next][1]];
          // Choose the endpoint that is NOT the one we arrived from.
          const arrive = dir === 1 ? line[line.length - 1] : line[0];
          const arrivesAtP = key(arrive[0], arrive[1]) === key(p[0], p[1]);
          const continuation = arrivesAtP ? q : p;
          if (key(continuation[0], continuation[1]) === key(tail[0], tail[1])) {
            // Degenerate zero-length segment; drop it.
            continue;
          }
          if (dir === 1) line.push(continuation);
          else line.unshift(continuation);
        }
      }
      if (line.length >= 2) lines.push(line);
    }

    if (lines.length > 0) {
      out.push({ level: lvl, isIndex: Math.abs(lvl % (interval * indexEvery)) < 1e-6, lines });
    }
  }
  return out;
}
