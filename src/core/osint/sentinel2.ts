/**
 * Sentinel-2 epoch change detection — screening-grade change mapping by
 * pixel-differencing the EOX "Sentinel-2 cloudless" annual mosaics.
 *
 * Key-free by design: tiles.maps.eox.at serves CORS-open WMTS tiles for
 * every mosaic year 2017-2024 (verified live: `Access-Control-Allow-Origin:
 * *`, image/jpeg), so two epochs of the SAME tile grid can be pulled
 * client-side and compared pixel-by-pixel — no scene ordering, no API keys,
 * no processing account. Where commercial imagery access is unavailable
 * (the common case for field work), this yields a defensible "what changed
 * here between these two years" screen at ~10 m native resolution.
 *
 * Method: per tile pair, luma (0.299R+0.587G+0.114B) absolute difference
 * above a threshold marks a changed pixel — but first the epochs are
 * RADIOMETRICALLY NORMALIZED by luma histogram matching (epoch B's luma
 * distribution is remapped onto epoch A's through a 256-entry CDF LUT),
 * because annual mosaics are composited from different acquisitions and
 * their global tonality drifts far beyond any real change signal. Pixels
 * then aggregate to measurable lon/lat cells (cellsPerTile² per tile) so
 * results land as countable, downloadable evidence — not a vague picture.
 *
 * Honesty contract:
 *  - Annual mosaics composite acquisitions from different dates: phenology,
 *    water level and shadow changes flag exactly like structural change.
 *    Every result is labeled a SCREEN to be verified against the imagery
 *    pair, never a determination.
 *  - License is CC-BY-NC-SA 4.0 (verified from the EOX WMTS capabilities):
 *    attribution mandatory, non-commercial, share-alike — a shared change
 *    mask is a derivative and must carry the same license and source line.
 *  - Cells whose centre falls outside the query bbox are excluded (small
 *    edge slivers are dropped rather than partially measured).
 *
 * The pure planning/diff/aggregation functions are DOM-free and fully
 * unit-tested; the browser runner at the bottom of this module handles
 * fetch + decode + preview rendering.
 */

import { OverpassBbox, validateBbox } from "./overpass";
import { tileToLonLat, TILE_SIZE, groundResolution } from "../tiles";

/* ------------------------------------------------------------------ */
/* Source identity                                                     */
/* ------------------------------------------------------------------ */

export const S2_SERVICE_PREFIX = "Sentinel-2 cloudless";
export const S2_LICENSE = "CC-BY-NC-SA 4.0";
export const S2_ATTRIBUTION =
  "Sentinel-2 cloudless by EOX IT Services (contains modified Copernicus Sentinel data)";

export const S2_DISCLOSURE =
  "Screening-grade epoch comparison — annual mosaics composite acquisitions from different dates. Epochs are radiometrically normalized by luma histogram matching before differencing, and vegetation, water or shadow changes still flag alongside real structural change. Verify every flagged cell against the imagery pair. Mosaic license CC-BY-NC-SA 4.0: change masks are derivatives (non-commercial use, share-alike, attribution required).";

/** Mosaic years published by EOX under the s2cloudless-{year}_3857 ids. */
export const S2_YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024] as const;
export type S2Year = (typeof S2_YEARS)[number];

export const S2_MIN_ZOOM = 8;
export const S2_MAX_ZOOM = 15; // mosaic native ~10 m/px; the layer serves to z15
export const DEFAULT_MAX_TILES = 60;
export const DEFAULT_CELLS_PER_TILE = 8;
export const DEFAULT_THRESHOLD = 30; // luma delta (0..255) counting as changed
export const DEFAULT_FLAG_RATIO = 0.15; // cell flags at >=15% changed pixels

/** WMTS layer id for a mosaic year. */
export function s2LayerId(year: S2Year): string {
  return `s2cloudless-${year}_3857`;
}

/** XYZ tile URL (EOX WMTS REST path is TileMatrix/z, TileRow/y, TileCol/x). */
export function s2TileUrl(year: S2Year, z: number, x: number, y: number): string {
  return `https://tiles.maps.eox.at/wmts/1.0.0/${s2LayerId(year)}/default/g/${z}/${y}/${x}.jpg`;
}

/** Endpoint prefix recorded into provenance (tile path without z/y/x). */
export function s2EndpointPrefix(year: S2Year): string {
  return `https://tiles.maps.eox.at/wmts/1.0.0/${s2LayerId(year)}/default/g`;
}

/* ------------------------------------------------------------------ */
/* Tile planning                                                       */
/* ------------------------------------------------------------------ */

/** Tile index range (inclusive) covering a bbox at zoom z. */
export function tileRange(bbox: OverpassBbox, z: number): {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  count: number;
} {
  const n = Math.pow(2, z);
  const min = tileXY(bbox.lonMin, bbox.latMax, z, n); // NW corner of bbox
  const max = tileXY(bbox.lonMax, bbox.latMin, z, n); // SE corner
  const x0 = Math.max(0, Math.floor(min.x));
  const x1 = Math.min(n - 1, Math.floor(max.x));
  const y0 = Math.max(0, Math.floor(min.y));
  const y1 = Math.min(n - 1, Math.floor(max.y));
  return { x0, x1, y0, y1, count: (x1 - x0 + 1) * (y1 - y0 + 1) };
}

/** Float tile indices for lon/lat at zoom z (top-origin y). */
function tileXY(lon: number, lat: number, z: number, n: number): { x: number; y: number } {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const x = ((lon + 180) / 360) * n;
  const sinLat = Math.sin((clampedLat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * n;
  return { x, y };
}

/** Highest Web-Mercator zoom whose bbox coverage fits the tile budget. */
export function pickChangeZoom(bbox: OverpassBbox, maxTiles = DEFAULT_MAX_TILES): number {
  for (let z = S2_MAX_ZOOM; z >= S2_MIN_ZOOM; z--) {
    if (tileRange(bbox, z).count <= maxTiles) return z;
  }
  return S2_MIN_ZOOM;
}

/* ------------------------------------------------------------------ */
/* Cell planning                                                       */
/* ------------------------------------------------------------------ */

export interface ChangeCellSpec {
  id: string;
  tileX: number;
  tileY: number;
  /** Pixel origin of the cell inside its 256-px tile. */
  px: number;
  py: number;
  /** Cell edge in pixels (square). */
  sizePx: number;
  lonMin: number;
  latMin: number;
  lonMax: number;
  latMax: number;
}

export interface ChangePlan {
  zoom: number;
  tiles: { x: number; y: number }[];
  cells: ChangeCellSpec[];
  cellsPerTile: number;
}

/**
 * Enumerate the tile list and the measurable lon/lat cell grid. A cell is
 * included when its CENTRE lies inside the bbox (partial edge cells are
 * excluded rather than measured with invented pixels).
 */
export function planChangeGrid(
  bbox: OverpassBbox,
  zoom: number,
  cellsPerTile = DEFAULT_CELLS_PER_TILE,
): ChangePlan {
  const err = validateBbox(bbox);
  if (err) throw new Error(`Invalid change-detection bbox: ${err}`);
  const range = tileRange(bbox, zoom);
  const sizePx = TILE_SIZE / cellsPerTile;
  const tiles: { x: number; y: number }[] = [];
  const cells: ChangeCellSpec[] = [];

  for (let ty = range.y0; ty <= range.y1; ty++) {
    for (let tx = range.x0; tx <= range.x1; tx++) {
      tiles.push({ x: tx, y: ty });
      for (let cy = 0; cy < cellsPerTile; cy++) {
        for (let cx = 0; cx < cellsPerTile; cx++) {
          const px = cx * sizePx;
          const py = cy * sizePx;
          // Centre of the cell in fractional tile units -> lon/lat.
          const fx = tx + (px + sizePx / 2) / TILE_SIZE;
          const fy = ty + (py + sizePx / 2) / TILE_SIZE;
          const c = tileToLonLat(fx, fy, zoom);
          if (c.lon < bbox.lonMin || c.lon > bbox.lonMax) continue;
          if (c.lat < bbox.latMin || c.lat > bbox.latMax) continue;
          const nw = tileToLonLat(tx + px / TILE_SIZE, ty + py / TILE_SIZE, zoom);
          const se = tileToLonLat(tx + (px + sizePx) / TILE_SIZE, ty + (py + sizePx) / TILE_SIZE, zoom);
          cells.push({
            id: `c${zoom}-${tx}-${ty}-${cx}-${cy}`,
            tileX: tx,
            tileY: ty,
            px,
            py,
            sizePx,
            lonMin: nw.lon,
            latMax: nw.lat,
            lonMax: se.lon,
            latMin: se.lat,
          });
        }
      }
    }
  }
  return { zoom, tiles, cells, cellsPerTile };
}

/** Approximate ground size of one cell edge (m) at a latitude. */
export function approxCellMeters(zoom: number, lat: number, cellsPerTile: number): number {
  return groundResolution(zoom, lat) * (TILE_SIZE / cellsPerTile);
}

/* ------------------------------------------------------------------ */
/* Pixel differencing + cell aggregation                               */
/* ------------------------------------------------------------------ */

/** 256-bin histogram of luma over an RGBA buffer. */
export function lumaHistogram(px: Uint8ClampedArray): number[] {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < px.length; i += 4) {
    const l = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
    hist[l]++;
  }
  return hist;
}

/** Normalized cumulative distribution of a histogram. */
function cdf(hist: number[]): number[] {
  const total = hist.reduce((s, v) => s + v, 0);
  const out = new Array<number>(256);
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    out[v] = total > 0 ? acc / total : v / 255;
  }
  return out;
}

/**
 * Histogram-matching LUT: maps epoch B luma values onto epoch A's
 * distribution (LUT[b] = closest a by CDF quantile). Identity when the
 * distributions match; this is the standard radiometric normalization for
 * bi-sensor change differencing.
 */
export function histogramMatchLut(histA: number[], histB: number[]): Uint8Array {
  const cdfA = cdf(histA);
  const cdfB = cdf(histB);
  const lut = new Uint8Array(256);
  // First-CDF-crossing walk: LUT[b] is the smallest a whose reference CDF
  // covers B's quantile. Monotone, O(256) total, and exact-identity on the
  // distribution's support (CDF plateaus on zero-mass bins map to 0).
  let j = 0;
  for (let b = 0; b < 256; b++) {
    while (j < 255 && cdfA[j] < cdfB[b]) j++;
    lut[b] = j;
  }
  return lut;
}

/**
 * Luma absolute difference between two RGBA buffers. Returns a 0/1 mask
 * (1 = changed). Buffers must be the same length. An optional LUT (from
 * `histogramMatchLut`) remaps B's luma before differencing.
 */
export function diffTilePair(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  threshold = DEFAULT_THRESHOLD,
  lut?: Uint8Array,
): Uint8Array {
  if (a.length !== b.length) throw new Error("Tile buffers differ in size");
  if (a.length % 4 !== 0) throw new Error("Buffers are not RGBA");
  const t = Math.max(0, Math.min(255, threshold));
  const mask = new Uint8Array(a.length / 4);
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    const la = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
    let lb = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
    if (lut) lb = lut[Math.max(0, Math.min(255, Math.round(lb)))];
    const d = la > lb ? la - lb : lb - la;
    mask[p] = d > t ? 1 : 0;
  }
  return mask;
}

/** Changed-pixel count per cell (index = cy * cellsPerTile + cx). */
export function cellStatsFromMask(mask: Uint8Array, cellsPerTile: number): number[] {
  const size = TILE_SIZE / cellsPerTile;
  const counts = new Array<number>(cellsPerTile * cellsPerTile).fill(0);
  for (let y = 0; y < TILE_SIZE; y++) {
    const cy = (y / size) | 0;
    const row = y * TILE_SIZE;
    for (let x = 0; x < TILE_SIZE; x++) {
      if (mask[row + x]) counts[cy * cellsPerTile + ((x / size) | 0)]++;
    }
  }
  return counts;
}

export interface ChangeCell extends ChangeCellSpec {
  changedPx: number;
  totalPx: number;
  /** 0..1 share of sampled pixels that changed. */
  ratio: number;
  flagged: boolean;
}

export interface ChangeSummary {
  zoom: number;
  cellsPerTile: number;
  threshold: number;
  flagRatio: number;
  totalCells: number;
  sampledPx: number;
  changedPx: number;
  changedPct: number;
  flaggedCells: number;
  flaggedPct: number;
  approxCellMeters: number;
}

/** Tile-level diff counts keyed "x:y" — filled by the browser runner. */
export type TileDiffMap = Map<string, number[]>;

/** Attach pixel counts to the planned cells and flag the hot ones. */
export function finalizeCells(
  plan: ChangePlan,
  diffs: TileDiffMap,
  flagRatio = DEFAULT_FLAG_RATIO,
): ChangeCell[] {
  const totalPx = plan.cells.length > 0 ? plan.cells[0].sizePx ** 2 : 0;
  return plan.cells.map((spec) => {
    const counts = diffs.get(`${spec.tileX}:${spec.tileY}`);
    const changedPx = counts ? counts[cellIndex(plan, spec)] : 0;
    const ratio = totalPx > 0 ? changedPx / totalPx : 0;
    return {
      ...spec,
      changedPx,
      totalPx,
      ratio,
      flagged: ratio >= flagRatio,
    };
  });
}

function cellIndex(plan: ChangePlan, spec: ChangeCellSpec): number {
  const sizePx = TILE_SIZE / plan.cellsPerTile;
  const cx = (spec.px / sizePx) | 0;
  const cy = (spec.py / sizePx) | 0;
  return cy * plan.cellsPerTile + cx;
}

/** Session-level statistics over the finalized cells. */
export function summarizeChange(
  cells: ChangeCell[],
  plan: ChangePlan,
  latCenter: number,
  threshold: number,
  flagRatio: number,
): ChangeSummary {
  let sampledPx = 0;
  let changedPx = 0;
  let flagged = 0;
  for (const c of cells) {
    sampledPx += c.totalPx;
    changedPx += c.changedPx;
    if (c.flagged) flagged++;
  }
  return {
    zoom: plan.zoom,
    cellsPerTile: plan.cellsPerTile,
    threshold,
    flagRatio,
    totalCells: cells.length,
    sampledPx,
    changedPx,
    changedPct: sampledPx > 0 ? (changedPx / sampledPx) * 100 : 0,
    flaggedCells: flagged,
    flaggedPct: cells.length > 0 ? (flagged / cells.length) * 100 : 0,
    approxCellMeters: approxCellMeters(plan.zoom, latCenter, plan.cellsPerTile),
  };
}

/* ------------------------------------------------------------------ */
/* Serialization (downloads)                                           */
/* ------------------------------------------------------------------ */

const pct = (r: number) => `${(r * 100).toFixed(1)}%`;

/** CSV schedule of flagged cells (deterministic column order). */
export function changeCellsToCsv(cells: ChangeCell[]): string {
  const head = "cell_id,lon_min,lat_min,lon_max,lat_max,changed_px,cell_px,changed_ratio,flagged";
  const rows = cells.map((c) =>
    [
      c.id,
      c.lonMin.toFixed(6),
      c.latMin.toFixed(6),
      c.lonMax.toFixed(6),
      c.latMax.toFixed(6),
      c.changedPx,
      c.totalPx,
      c.ratio.toFixed(4),
      c.flagged ? "yes" : "no",
    ].join(","),
  );
  return [head, ...rows].join("\n");
}

/** GeoJSON FeatureCollection of the cell grid (flagged property included). */
export function changeCellsToGeoJson(
  cells: ChangeCell[],
  summary: ChangeSummary,
  yearA: S2Year,
  yearB: S2Year,
): Record<string, unknown> {
  return {
    type: "FeatureCollection",
    metardu: {
      product: "sentinel2-epoch-change-screen",
      epochs: [yearA, yearB],
      license: S2_LICENSE,
      attribution: S2_ATTRIBUTION,
      disclosure: S2_DISCLOSURE,
      summary,
      generatedAt: new Date().toISOString(),
      crs: "urn:ogc:def:crs:OGC:1.3:CRS84",
    },
    features: cells.map((c) => ({
      type: "Feature",
      id: c.id,
      properties: {
        cell_id: c.id,
        changed_px: c.changedPx,
        cell_px: c.totalPx,
        changed_ratio: Number(c.ratio.toFixed(4)),
        flagged: c.flagged,
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [c.lonMin, c.latMax],
            [c.lonMax, c.latMax],
            [c.lonMax, c.latMin],
            [c.lonMin, c.latMin],
            [c.lonMin, c.latMax],
          ],
        ],
      },
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Browser runner (fetch + decode + preview)                           */
/* ------------------------------------------------------------------ */

export interface ChangeRunOptions {
  bbox: OverpassBbox;
  yearA: S2Year;
  yearB: S2Year;
  threshold?: number;
  flagRatio?: number;
  maxTiles?: number;
  cellsPerTile?: number;
  fetchImpl?: typeof fetch;
  onProgress?: (done: number, total: number) => void;
}

export interface ChangeRunResult {
  cells: ChangeCell[];
  summary: ChangeSummary;
  /** Data URL of the preview (grayscale "after" epoch + red change mask). */
  previewDataUrl: string;
  zoom: number;
  tilePairs: number;
  failedTiles: number;
  yearA: S2Year;
  yearB: S2Year;
  threshold: number;
  flagRatio: number;
  bbox: OverpassBbox;
}

/** Decode a tile blob into RGBA pixels via OffscreenCanvas/Canvas 2D. */
async function decodeTile(blob: Blob): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(blob);
  const size = TILE_SIZE;
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  let canvas: OffscreenCanvas | HTMLCanvasElement;
  if (typeof OffscreenCanvas === "function") {
    canvas = new OffscreenCanvas(size, size);
    ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
  } else {
    canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    ctx = (canvas as HTMLCanvasElement).getContext("2d")!;
  }
  ctx.drawImage(bitmap, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  bitmap.close();
  return data;
}

/** Bounded-concurrency map (keeps hostile networks polite). */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Fetch both epochs, diff tile pairs, aggregate cells, render the preview.
 * Tiles failing on ONE epoch are skipped (counted); the run proceeds on
 * the successful pairs and discloses the count.
 */
export async function runChangeDetection(opts: ChangeRunOptions): Promise<ChangeRunResult> {
  const bbox = opts.bbox;
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const flagRatio = opts.flagRatio ?? DEFAULT_FLAG_RATIO;
  const cellsPerTile = opts.cellsPerTile ?? DEFAULT_CELLS_PER_TILE;
  const zoom = pickChangeZoom(bbox, opts.maxTiles ?? DEFAULT_MAX_TILES);
  const plan = planChangeGrid(bbox, zoom, cellsPerTile);
  const doFetch = opts.fetchImpl ?? fetch;
  const total = plan.tiles.length * 2;
  let done = 0;
  let failedTiles = 0;

  const fetchEpoch = async (year: S2Year): Promise<Map<string, Uint8ClampedArray>> => {
    const map = new Map<string, Uint8ClampedArray>();
    await mapPool(plan.tiles, 6, async (t) => {
      try {
        const res = await doFetch(s2TileUrl(year, zoom, t.x, t.y));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        map.set(`${t.x}:${t.y}`, await decodeTile(blob));
      } catch {
        /* counted by the caller via missing keys */
      } finally {
        done++;
        opts.onProgress?.(done, total);
      }
    });
    return map;
  };

  const epochA = await fetchEpoch(opts.yearA);
  const epochB = await fetchEpoch(opts.yearB);

  // Radiometric normalization: match epoch B's luma distribution onto
  // epoch A's over the whole scene before differencing. Without this the
  // mosaic pair's global tonality drift saturates the screen.
  const histA = new Array<number>(256).fill(0);
  const histB = new Array<number>(256).fill(0);
  for (const t of plan.tiles) {
    const key = `${t.x}:${t.y}`;
    const a = epochA.get(key);
    const b = epochB.get(key);
    if (!a || !b) continue;
    lumaHistogram(a).forEach((v, i) => (histA[i] += v));
    lumaHistogram(b).forEach((v, i) => (histB[i] += v));
  }
  const lut = histogramMatchLut(histA, histB);

  const diffs: TileDiffMap = new Map();
  for (const t of plan.tiles) {
    const key = `${t.x}:${t.y}`;
    const a = epochA.get(key);
    const b = epochB.get(key);
    if (!a || !b) {
      failedTiles++;
      continue;
    }
    diffs.set(key, cellStatsFromMask(diffTilePair(a, b, threshold, lut), cellsPerTile));
  }
  if (diffs.size === 0) {
    throw new Error(
      "No tile pairs could be fetched for either epoch — check connectivity and try a smaller scope",
    );
  }

  const cells = finalizeCells(plan, diffs, flagRatio);
  const latCenter = (bbox.latMin + bbox.latMax) / 2;
  const summary = summarizeChange(cells, plan, latCenter, threshold, flagRatio);

  // Preview: grayscale "after" epoch; cells tint red at the SAME flag
  // threshold the stats use — the picture must match the numbers.
  const preview = await renderPreview(plan, epochB, diffs, cellsPerTile, flagRatio);

  return {
    cells,
    summary,
    previewDataUrl: preview,
    zoom,
    tilePairs: diffs.size,
    failedTiles,
    yearA: opts.yearA,
    yearB: opts.yearB,
    threshold,
    flagRatio,
    bbox,
  };
}

/** Compose the preview canvas and return a JPEG data URL. */
async function renderPreview(
  plan: ChangePlan,
  epochB: Map<string, Uint8ClampedArray>,
  diffs: TileDiffMap,
  cellsPerTile: number,
  flagRatio: number,
): Promise<string> {
  const size = TILE_SIZE;
  const cols = Math.max(...plan.tiles.map((t) => t.x)) - Math.min(...plan.tiles.map((t) => t.x)) + 1;
  const rows = Math.max(...plan.tiles.map((t) => t.y)) - Math.min(...plan.tiles.map((t) => t.y)) + 1;
  const canvas = document.createElement("canvas");
  canvas.width = cols * size;
  canvas.height = rows * size;
  const ctx = canvas.getContext("2d")!;
  const minX = Math.min(...plan.tiles.map((t) => t.x));
  const minY = Math.min(...plan.tiles.map((t) => t.y));

  const img = ctx.createImageData(size, size);
  for (const t of plan.tiles) {
    const base = epochB.get(`${t.x}:${t.y}`);
    if (!base) continue;
    const counts = diffs.get(`${t.x}:${t.y}`);
    const cellSize = size / cellsPerTile;
    const cellPx = cellSize * cellSize;
    for (let i = 0, p = 0; p < size * size; p++, i += 4) {
      const x = p % size;
      const y = (p / size) | 0;
      const cx = (x / cellSize) | 0;
      const cy = (y / cellSize) | 0;
      const idx = cy * cellsPerTile + cx;
      const flagged = counts ? counts[idx] / cellPx >= flagRatio : false;
      // Cell-level tint, threshold-consistent with the reported stats.
      if (flagged) {
        img.data[i] = 220;
        img.data[i + 1] = 48;
        img.data[i + 2] = 48;
        img.data[i + 3] = 235;
      } else {
        const lum = Math.round(
          0.299 * base[i] + 0.587 * base[i + 1] + 0.114 * base[i + 2],
        );
        img.data[i] = Math.round(lum * 0.55);
        img.data[i + 1] = Math.round(lum * 0.58);
        img.data[i + 2] = Math.round(lum * 0.6);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, (t.x - minX) * size, (t.y - minY) * size);
  }
  return canvas.toDataURL("image/jpeg", 0.85);
}
