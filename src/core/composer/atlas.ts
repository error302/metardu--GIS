/**
 * Atlas Series — multi-sheet map-book planning.
 *
 * An atlas is a set of sheets at ONE uniform scale whose extents tile the
 * project area on a common grid with a small overlap. This module plans
 * that tiling: it picks a scale from a standard series, derives the sheet
 * grid, names every sheet (rows lettered A.. from the north, columns
 * numbered 1.. from the west), and resolves each sheet's neighbours so the
 * renderer can print "go-to" pointers on the frame edges.
 *
 * Pure geometry — no SVG here, no DOM, no fabricated values. The renderer
 * (composer/atlas-render.ts) consumes the plan; the panel consumes both.
 *
 * Doctrine: every derived figure (scale, sheet count, ground coverage) is
 * computed from the live extent and the chosen page, and any cap breach is
 * disclosed in the plan rather than silently clamped.
 */

import { PipelineResult } from "../../types/spatial";
import { PageSizeKey, Orientation, pageDimsMm } from "./template";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface AtlasExtent {
  minE: number;
  maxE: number;
  minN: number;
  maxN: number;
}

export interface AtlasPage {
  size: PageSizeKey;
  orientation: Orientation;
}

/** One atlas sheet: grid position, name, ground extent, neighbours. */
export interface AtlasSheet {
  /** 0-based grid position; row 0 is the southernmost band. */
  row: number;
  col: number;
  /** Atlas name — rows lettered from the north, columns from the west. */
  label: string;
  /** 1-based reading order from the north-west corner. */
  index: number;
  /** Ground extent covered by the frame content box (metres). */
  extent: AtlasExtent;
  /** Neighbour sheet labels (null at the atlas edge). */
  neighbors: { n: string | null; e: string | null; s: string | null; w: string | null };
}

export interface AtlasPlan {
  /** Uniform scale denominator across all sheets (the atlas property). */
  scaleDenominator: number;
  page: AtlasPage;
  /** Map-frame content box on the page, millimetres. */
  frameBox: { x: number; y: number; w: number; h: number };
  /** Applied overlap as a fraction of the sheet ground size. */
  overlapFrac: number;
  cols: number;
  rows: number;
  /** Ground metres covered by one sheet's content box. */
  groundW: number;
  groundH: number;
  /** Ground metres between successive sheet origins (overlap removed). */
  stepE: number;
  stepN: number;
  /** SW corner of sheet (row 0, col 0). */
  originE: number;
  originN: number;
  sheets: AtlasSheet[];
  /** Union of all sheet extents (metres). */
  coverage: AtlasExtent;
  /** The caller-supplied extent the atlas was planned around. */
  sourceExtent: AtlasExtent;
  /** False when the plan breached the sheet cap / fixed scale overflow. */
  withinCap: boolean;
  /** Human-readable disclosure when the plan had to compromise. */
  disclosure: string | null;
}

export interface AtlasPlanOptions {
  extent: AtlasExtent;
  page: AtlasPage;
  /** Fixed scale denominator, or null to auto-select from the series. */
  scaleDenominator: number | null;
  /** Auto mode: maximum sheets (cols × rows) allowed. Default 9. */
  maxSheets?: number;
  /** Overlap fraction of sheet size, clamped to [0, 0.35]. Default 0.10. */
  overlapFrac?: number;
}

/* ------------------------------------------------------------------ */
/* Scale series and layout constants                                   */
/* ------------------------------------------------------------------ */

/**
 * Standard engineering / topographic scale series, ascending denominators
 * (largest scale first). Auto selection walks this list and takes the
 * first (largest) scale whose tiling fits the sheet cap.
 */
export const ATLAS_SCALE_SERIES = [
  250, 500, 1000, 1250, 2000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000,
] as const;

/** Row letters — sheet rows are lettered A (north) downwards. */
const ROW_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Absolute layout bands shared by planner and renderer (millimetres). */
export const ATLAS_LAYOUT_MM = {
  /** Header band: title + sheet identity. */
  headerTop: 12,
  headerBottom: 31,
  /** Frame top edge. */
  frameTop: 33,
  /** Footer band height reserved at the page foot. */
  footerH: 16,
  /** Side margin for the frame content box. */
  sideMargin: 14,
} as const;

/**
 * The map-frame content box for an atlas sheet: page dimensions minus the
 * header band, footer band, and side margins. Single source of truth so
 * the planner's ground coverage matches what the renderer actually draws.
 */
export function atlasFrameBox(page: AtlasPage): { x: number; y: number; w: number; h: number } {
  const { w: pw, h: ph } = pageDimsMm(page);
  return {
    x: ATLAS_LAYOUT_MM.sideMargin,
    y: ATLAS_LAYOUT_MM.frameTop,
    w: pw - 2 * ATLAS_LAYOUT_MM.sideMargin,
    h: ph - ATLAS_LAYOUT_MM.frameTop - ATLAS_LAYOUT_MM.footerH,
  };
}

/* ------------------------------------------------------------------ */
/* Extent derivation                                                   */
/* ------------------------------------------------------------------ */

/**
 * Union bounding box of every survey geometry in the pipeline result:
 * boundary, vectors, then raw points. Returns null on an empty document —
 * the panel shows the disclosure instead of inventing an extent.
 */
export function atlasExtentFromResult(result: PipelineResult): AtlasExtent | null {
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
  const grow = (e: number, n: number) => {
    if (e < minE) minE = e;
    if (e > maxE) maxE = e;
    if (n < minN) minN = n;
    if (n > maxN) maxN = n;
  };
  if (result.boundary) for (const p of result.boundary.points) grow(p.easting, p.northing);
  for (const v of result.vectors) for (const p of v.points) grow(p.easting, p.northing);
  for (const p of result.points) grow(p.easting, p.northing);
  if (!isFinite(minE) || maxE <= minE || maxN <= minN) return null;
  return { minE, maxE, minN, maxN };
}

/* ------------------------------------------------------------------ */
/* Planner                                                             */
/* ------------------------------------------------------------------ */

/** Hard sanity ceiling on tiles for a single plan (guards absurd scales). */
const MAX_SHEET_TILES = 1000;

/**
 * Plan an atlas series over `extent`.
 *
 * Auto mode walks the scale series from the largest scale and takes the
 * first whose tiling fits `maxSheets`. Fixed-scale mode honours the caller
 * even when it breaches the cap (disclosed via `withinCap`/`disclosure`).
 * The tile block is centred over the extent so overhang is symmetric.
 * Returns null for degenerate/absurd inputs — never a fabricated plan.
 */
export function planAtlasSeries(opts: AtlasPlanOptions): AtlasPlan | null {
  const src = opts.extent;
  if (!src || !isFinite(src.minE) || !(src.maxE > src.minE) || !(src.maxN > src.minN)) return null;

  const overlap = Math.min(0.35, Math.max(0, opts.overlapFrac ?? 0.10));
  const maxSheets = Math.max(1, Math.floor(opts.maxSheets ?? 9));
  const frameBox = atlasFrameBox(opts.page);
  if (!(frameBox.w > 0) || !(frameBox.h > 0)) return null;

  const extentW = src.maxE - src.minE;
  const extentH = src.maxN - src.minN;

  const tilingFor = (denom: number) => {
    const groundW = (frameBox.w * denom) / 1000;
    const groundH = (frameBox.h * denom) / 1000;
    const stepE = groundW * (1 - overlap);
    const stepN = groundH * (1 - overlap);
    const cols = Math.max(1, Math.ceil(extentW / stepE - 1e-9));
    const rows = Math.max(1, Math.ceil(extentH / stepN - 1e-9));
    return { groundW, groundH, stepE, stepN, cols, rows, count: cols * rows };
  };

  let scaleDenominator: number;
  let withinCap = true;
  let disclosure: string | null = null;
  const fmt = (n: number) => n.toLocaleString("en-US");

  if (opts.scaleDenominator && opts.scaleDenominator > 0) {
    scaleDenominator = opts.scaleDenominator;
    const t = tilingFor(scaleDenominator);
    withinCap = t.count <= maxSheets;
    if (!withinCap) {
      disclosure =
        `Fixed scale 1:${fmt(scaleDenominator)} tiles the extent into ` +
        `${t.cols} × ${t.rows} = ${t.count} sheets — exceeds the ${maxSheets}-sheet cap.`;
    }
  } else {
    let chosen: number | null = null;
    for (const denom of ATLAS_SCALE_SERIES) {
      if (tilingFor(denom).count <= maxSheets) {
        chosen = denom;
        break;
      }
    }
    if (chosen === null) {
      chosen = ATLAS_SCALE_SERIES[ATLAS_SCALE_SERIES.length - 1];
      const t = tilingFor(chosen);
      withinCap = false;
      disclosure =
        `Extent exceeds the ${maxSheets}-sheet cap even at 1:${fmt(chosen)} ` +
        `(${t.cols} × ${t.rows} tiles) — narrow the extent, raise the cap, or fix a smaller scale.`;
    }
    scaleDenominator = chosen;
  }

  const { groundW, groundH, stepE, stepN, cols, rows, count } = tilingFor(scaleDenominator);
  if (count > MAX_SHEET_TILES) return null;

  // Centre the tile block over the source extent (symmetric overhang).
  const totalW = (cols - 1) * stepE + groundW;
  const totalH = (rows - 1) * stepN + groundH;
  const originE = src.minE - (totalW - extentW) / 2;
  const originN = src.minN - (totalH - extentH) / 2;

  const labelAt = (row: number, col: number) =>
    `${ROW_LETTERS[rows - 1 - row]}${col + 1}`;

  const sheets: AtlasSheet[] = [];
  let index = 1;
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = 0; c < cols; c++) {
      const minE = originE + c * stepE;
      const minN = originN + r * stepN;
      sheets.push({
        row: r,
        col: c,
        label: labelAt(r, c),
        index: index++,
        extent: { minE, maxE: minE + groundW, minN, maxN: minN + groundH },
        neighbors: {
          n: r + 1 < rows ? labelAt(r + 1, c) : null,
          e: c + 1 < cols ? labelAt(r, c + 1) : null,
          s: r - 1 >= 0 ? labelAt(r - 1, c) : null,
          w: c - 1 >= 0 ? labelAt(r, c - 1) : null,
        },
      });
    }
  }

  return {
    scaleDenominator,
    page: { ...opts.page },
    frameBox,
    overlapFrac: overlap,
    cols,
    rows,
    groundW,
    groundH,
    stepE,
    stepN,
    originE,
    originN,
    sheets,
    coverage: { minE: originE, maxE: originE + totalW, minN: originN, maxN: originN + totalH },
    sourceExtent: { ...src },
    withinCap,
    disclosure,
  };
}

/** Look up a sheet by its atlas label ("B2"), or null. */
export function atlasSheetByLabel(plan: AtlasPlan, label: string): AtlasSheet | null {
  return plan.sheets.find((s) => s.label === label) ?? null;
}
