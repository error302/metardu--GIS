/**
 * Atlas cartography primitives — the math layer behind print-grade sheets.
 *
 * Pure geometry/photometry: no SVG strings are emitted here. The composer
 * renderer (core/composer/render.ts) consumes these specs and emits SVG.
 * Everything is derived from live pipeline state — no fabricated values.
 *
 * Contents:
 *  - TIN facet hillshade (Lambertian, NW 315° / 45° sun by default)
 *  - Index-contour label placement (greedy along-line, upright, budgeted)
 *  - UTM zone parsing from CRS labels / EPSG codes (locator insets)
 *  - Suitability classification thresholds (single source of truth)
 */

import { ContourLine, TinTriangle } from "../types/spatial";
import { SUITABILITY_CLASS_BREAKS } from "./mcda-suitability";

/* ------------------------------------------------------------------ */
/* Suitability classification thresholds                                */
/* ------------------------------------------------------------------ */

/**
 * The exact class boundaries applied by the MCDA engine — re-exported so
 * sheet furniture can disclose them verbatim and a reader can re-derive
 * every colour from the printed score distribution.
 */
export const SUITABILITY_THRESHOLDS = SUITABILITY_CLASS_BREAKS;

export const SUITABILITY_CLASS_ORDER = [
  "optimal", "suitable", "moderate", "restricted", "hazard",
] as const;

/** Truthful class-break disclosure, pre-wrapped for a narrow legend column. */
export function suitabilityBreaksLines(): string[] {
  const t = SUITABILITY_THRESHOLDS;
  return [
    "MCDA composite score (0–100) — class breaks:",
    `optimal ≥${t.optimalMin} · suitable ≥${t.suitableMin} · moderate ≥${t.moderateMin}`,
    `restricted <${t.moderateMin} · hazard: slope exceedance`,
  ];
}

/* ------------------------------------------------------------------ */
/* Facet hillshade                                                      */
/* ------------------------------------------------------------------ */

export interface HillshadeOptions {
  /** Light azimuth, degrees from north, clockwise (default 315 = NW). */
  sunAzimuthDeg?: number;
  /** Light altitude above horizon, degrees (default 45). */
  sunAltitudeDeg?: number;
  /** Gray floor for fully away-facing facets (0–255; default 150). */
  minGray?: number;
}

const D2R = Math.PI / 180;

/**
 * Illumination unit vector pointing toward the sun, in ENU
 * (x=east, y=north, z=up) — matching the TIN normal convention.
 */
export function sunVector(sunAzimuthDeg = 315, sunAltitudeDeg = 45): [number, number, number] {
  const az = sunAzimuthDeg * D2R;
  const alt = sunAltitudeDeg * D2R;
  return [Math.cos(alt) * Math.sin(az), Math.cos(alt) * Math.cos(az), Math.sin(alt)];
}

/**
 * Lambertian shade of one TIN facet, normalised so a flat facet = 1.
 * Values are clamped to [0, 1]: sun-facing slopes saturate at the paper
 * white rather than inventing brightness the print cannot carry.
 */
export function facetShade(
  normal: [number, number, number],
  sunAzimuthDeg = 315,
  sunAltitudeDeg = 45,
): number {
  const [lx, ly, lz] = sunVector(sunAzimuthDeg, sunAltitudeDeg);
  const dot = normal[0] * lx + normal[1] * ly + normal[2] * lz;
  const sinAlt = Math.sin(sunAltitudeDeg * D2R);
  if (!(sinAlt > 0)) return 1;
  return Math.max(0, Math.min(1, dot / sinAlt));
}

/** Facet gray 0–255: flat = 255 (paper), away-facing → minGray. */
export function facetGray(
  normal: [number, number, number],
  opts: HillshadeOptions = {},
): number {
  const minGray = opts.minGray ?? 150;
  const s = facetShade(normal, opts.sunAzimuthDeg, opts.sunAltitudeDeg);
  return Math.round(minGray + (255 - minGray) * s);
}

export interface ProjectedTri {
  /** Screen-space vertices [x, y] after projection. */
  pts: [[number, number], [number, number], [number, number]];
  normal: [number, number, number];
  /** Cheap visibility test on the facet centroid (generous margin). */
  visible: boolean;
}

/**
 * Group projected facets into ≤ 18 gray buckets and return one compact
 * SVG path `d` string per bucket plus its fill. Bucketing keeps the sheet
 * SVG small (tens of paths instead of tens of thousands of polygons).
 */
export function hillshadePaths(
  tris: ProjectedTri[],
  opts: HillshadeOptions = {},
  buckets = 18,
): { d: string; fill: string }[] {
  const minGray = opts.minGray ?? 150;
  const groups = new Map<number, string[]>();
  for (const t of tris) {
    if (!t.visible) continue;
    const g = facetGray(t.normal, opts);
    const b = Math.min(buckets - 1, Math.floor(((g - minGray) / (255 - minGray)) * buckets));
    const arr = groups.get(b);
    if (arr) arr.push(triPath(t.pts));
    else groups.set(b, [triPath(t.pts)]);
  }
  const out: { d: string; fill: string }[] = [];
  for (const [b, ds] of [...groups.entries()].sort((a, z) => a[0] - z[0])) {
    const g = Math.round(minGray + ((255 - minGray) * b) / buckets);
    out.push({ d: ds.join(" "), fill: `rgb(${g},${g},${g})` });
  }
  return out;
}

function triPath(pts: [[number, number], [number, number], [number, number]]): string {
  const n = (v: number) => (Math.round(v * 10) / 10).toString();
  return `M${n(pts[0][0])},${n(pts[0][1])}L${n(pts[1][0])},${n(pts[1][1])}L${n(pts[2][0])},${n(pts[2][1])}Z`;
}

/* ------------------------------------------------------------------ */
/* Contour label placement                                              */
/* ------------------------------------------------------------------ */

export interface ContourLabelSpec {
  x: number;
  y: number;
  /** Text rotation, degrees; always upright (flipped into [-90, 90]). */
  angleDeg: number;
  text: string;
}

export interface ContourLabelOptions {
  /** Screen distance between successive labels on one line (px). */
  spacingPx?: number;
  /** Minimum line length before a label is worth placing (px). */
  minLinePx?: number;
  /** Hard budget across the whole frame. */
  maxLabels?: number;
}

export function contourLabelText(elevation: number): string {
  return Number.isInteger(elevation) ? String(elevation) : elevation.toFixed(1);
}

/**
 * Greedy along-line placement for index contours: walk the polyline in
 * screen space by arc length and drop a halo label every `spacingPx`,
 * oriented along the local segment and flipped upright. Positions outside
 * the frame (per the caller's visibility test) are skipped without
 * consuming the budget. Minor contours are never labelled.
 */
export function placeContourLabels(
  contours: ContourLine[],
  toScreen: (e: number, n: number) => [number, number],
  visible: (x: number, y: number) => boolean,
  opts: ContourLabelOptions = {},
): ContourLabelSpec[] {
  const spacing = opts.spacingPx ?? 150;
  const minLine = opts.minLinePx ?? 60;
  const budget = opts.maxLabels ?? 48;
  const out: ContourLabelSpec[] = [];

  for (const c of contours) {
    if (out.length >= budget) break;
    if (!c.isMajor || c.points.length < 2) continue;

    const scr = c.points.map(([e, n]) => toScreen(e, n));
    let total = 0;
    for (let i = 1; i < scr.length; i++) {
      total += Math.hypot(scr[i][0] - scr[i - 1][0], scr[i][1] - scr[i - 1][1]);
    }
    if (total < minLine) continue;

    let nextAt = spacing; // arc-length position of the next label
    let acc = 0; // arc length walked so far
    for (let i = 1; i < scr.length && out.length < budget; i++) {
      const [x0, y0] = scr[i - 1];
      const [x1, y1] = scr[i];
      const seg = Math.hypot(x1 - x0, y1 - y0);
      if (seg < 1e-6) continue;
      while (nextAt <= acc + seg && out.length < budget) {
        const t = (nextAt - acc) / seg;
        const lx = x0 + (x1 - x0) * t;
        const ly = y0 + (y1 - y0) * t;
        if (visible(lx, ly)) {
          let ang = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
          if (ang > 90) ang -= 180;
          if (ang < -90) ang += 180;
          out.push({ x: lx, y: ly, angleDeg: ang, text: contourLabelText(c.elevation) });
        }
        nextAt += spacing; // advance regardless; keep scanning the line
      }
      acc += seg;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* UTM zone parsing (locator insets)                                    */
/* ------------------------------------------------------------------ */

export interface UtmZone {
  zone: number;
  south: boolean;
}

/**
 * Extract a UTM zone from the CRS label or EPSG code. Understands:
 *  - "…UTM zone 37S" / "UTM 37S" / "37N" suffixes
 *  - EPSG 326xx (WGS 84 north) / 327xx (WGS 84 south)
 *  - EPSG 21001–21060 (Arc 1960 south) / 21061–21120 (Arc 1960 north)
 * Returns null for non-UTM systems — the locator then falls back to a
 * plain 100 km grid with no zone claim.
 */
export function parseUtmZone(crs: string): UtmZone | null {
  const s = crs.toUpperCase();

  let m = s.match(/ZONE\s*(\d{1,2})\s*([NS])/);
  if (m) return zone(+m[1], m[2] === "S");

  m = s.match(/UTM[\s-]?(\d{1,2})\s*([NS])/);
  if (m) return zone(+m[1], m[2] === "S");

  m = s.match(/EPSG[:\s]*327(\d{2})/);
  if (m) return zone(+m[1], true);

  m = s.match(/EPSG[:\s]*326(\d{2})/);
  if (m) return zone(+m[1], false);

  m = s.match(/EPSG[:\s]*21(\d{3})/);
  if (m) {
    const code = +m[1];
    if (code >= 1 && code <= 60) return zone(code, true);
    if (code >= 61 && code <= 120) return zone(code - 60, false);
  }
  return null;
}

function zone(z: number, south: boolean): UtmZone | null {
  if (!(z >= 1 && z <= 60)) return null;
  return { zone: z, south };
}

/** Central meridian of a UTM zone, degrees east. */
export function utmCentralMeridian(z: UtmZone): number {
  return z.zone * 6 - 183;
}

/* ------------------------------------------------------------------ */
/* Locator grid model                                                   */
/* ------------------------------------------------------------------ */

export interface LocatorModel {
  /** Grid lines to draw (metres) and their step. */
  eastings: number[];
  northings: number[];
  step: number;
  /** Ground bbox of the grid window (metres). */
  window: { minE: number; maxE: number; minN: number; maxN: number };
  /** Parcel extent within the window (metres), or null. */
  extent: { minE: number; maxE: number; minN: number; maxN: number } | null;
  zone: UtmZone | null;
}

/**
 * Build an adaptive locator grid around a feature bbox: the window spans
 * roughly eight times the parcel diagonal (clamped to 20–300 km) so a small
 * parcel is still visible as a box, not a dot. The grid step is picked from
 * {5, 10, 20, 50, 100} km so the window carries a readable 2–6 squares.
 * No CRS? The same grid is returned without a zone claim — still truthful.
 */
export function buildLocatorModel(
  bbox: { minE: number; maxE: number; minN: number; maxN: number } | null,
  crs: string,
): LocatorModel | null {
  if (!bbox || !(bbox.maxE > bbox.minE) || !(bbox.maxN > bbox.minN)) return null;
  const diag = Math.hypot(bbox.maxE - bbox.minE, bbox.maxN - bbox.minN);
  const target = Math.min(Math.max(diag * 8, 20_000), 300_000);
  const STEPS = [5_000, 10_000, 20_000, 50_000, 100_000];
  const step = STEPS.find((s) => target / s <= 6) ?? 100_000;
  const cx = (bbox.minE + bbox.maxE) / 2;
  const cy = (bbox.minN + bbox.maxN) / 2;
  const half = Math.max(target / 2, diag);
  const w = {
    minE: Math.floor((cx - half) / step) * step,
    maxE: Math.ceil((cx + half) / step) * step,
    minN: Math.floor((cy - half) / step) * step,
    maxN: Math.ceil((cy + half) / step) * step,
  };
  const eastings: number[] = [];
  const northings: number[] = [];
  for (let e = w.minE; e <= w.maxE + step / 2; e += step) eastings.push(e);
  for (let n = w.minN; n <= w.maxN + step / 2; n += step) northings.push(n);
  return { eastings, northings, step, window: w, extent: bbox, zone: parseUtmZone(crs) };
}

/* ------------------------------------------------------------------ */
/* TinTriangle → projected facet helper                                 */
/* ------------------------------------------------------------------ */

/**
 * Project TIN facets to screen space for hillshadePaths, with centroid
 * visibility and a facet-count budget (stride sampling on very large
 * meshes keeps sheet SVGs printable; relief is a base map, not a dataset).
 */
export function projectFacets(
  triangles: TinTriangle[],
  toScreen: (e: number, n: number) => [number, number],
  visible: (x: number, y: number) => boolean,
  maxFacets = 45_000,
): ProjectedTri[] {
  const stride = Math.max(1, Math.ceil(triangles.length / maxFacets));
  const out: ProjectedTri[] = [];
  for (let i = 0; i < triangles.length; i += stride) {
    const t = triangles[i];
    const pts: [[number, number], [number, number], [number, number]] = [
      toScreen(t.p1.easting, t.p1.northing),
      toScreen(t.p2.easting, t.p2.northing),
      toScreen(t.p3.easting, t.p3.northing),
    ];
    const cx = (pts[0][0] + pts[1][0] + pts[2][0]) / 3;
    const cy = (pts[0][1] + pts[1][1] + pts[2][1]) / 3;
    out.push({ pts, normal: t.normal, visible: visible(cx, cy) });
  }
  return out;
}
