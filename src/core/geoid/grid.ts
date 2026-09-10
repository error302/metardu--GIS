/**
 * EGM2008 geoid grid — MTGEOD01 binary format.
 *
 * The grid ships as a compact East-Africa window extracted from the official
 * NGA EGM2008 2.5 arc-minute global grid (us_nga_egm08_25.tif, PROJ CDN;
 * "WGS 84 (EPSG:4979) to EGM2008 height (EPSG:3855)").
 *
 * Binary layout (little-endian):
 *   bytes 0..7  : magic "MTGEOD01"
 *   float64 x4  : latMax, latMin, lonMin, lonMax   (degrees)
 *   float64 x2  : dLat, dLon                        (degrees)
 *   uint32      : nRows
 *   uint32      : nCols
 *   uint16      : cellType (1 = int16 centimetres)
 *   uint16      : reserved
 *   int16[]     : N in centimetres, row-major, first row = latMax (north),
 *                 each row west (lonMin) -> east. -32768 = nodata.
 *
 * Sampling is bilinear with corner-registered nodes (row 0 IS the latMax
 * node, matching the GTX/PROJ convention of the source grid).
 */

import { registerGeoidGridLoader } from "../crs";

export interface GeoidGridInfo {
  model: string;
  source: string;
  resolutionArcMin: number;
  bounds: { latMax: number; latMin: number; lonMin: number; lonMax: number };
  rows: number;
  cols: number;
  interpolation: "bilinear";
  accuracyNote: string;
}

export type GeoidStatus =
  | { state: "uninitialized"; model: "parametric" }
  | { state: "loading"; model: "EGM2008" }
  | { state: "ready"; model: "EGM2008"; info: GeoidGridInfo }
  | { state: "unavailable"; model: "parametric"; reason: string };

const MAGIC = "MTGEOD01";
const NODATA = -32768;

interface GridData {
  info: GeoidGridInfo;
  latMax: number;
  latMin: number;
  lonMin: number;
  lonMax: number;
  dLat: number;
  dLon: number;
  rows: number;
  cols: number;
  cells: Int16Array;
}

let grid: GridData | null = null;
let loadPromise: Promise<boolean> | null = null;
const statusListeners = new Set<(s: GeoidStatus) => void>();
let status: GeoidStatus = { state: "uninitialized", model: "parametric" };

export function getGeoidStatus(): GeoidStatus {
  return status;
}

export function subscribeGeoidStatus(cb: (s: GeoidStatus) => void): () => void {
  statusListeners.add(cb);
  cb(status);
  return () => statusListeners.delete(cb);
}

function setStatus(s: GeoidStatus) {
  status = s;
  for (const cb of statusListeners) cb(s);
}

/** Parse the MTGEOD01 buffer. Throws on malformed data. */
export function parseGeoidGrid(buf: ArrayBuffer): GridData {
  if (buf.byteLength < 68) throw new Error("Geoid grid too small");
  const view = new DataView(buf);
  let magic = "";
  for (let i = 0; i < 8; i++) magic += String.fromCharCode(view.getUint8(i));
  if (magic !== MAGIC) throw new Error(`Bad geoid grid magic: ${magic}`);

  const latMax = view.getFloat64(8, true);
  const latMin = view.getFloat64(16, true);
  const lonMin = view.getFloat64(24, true);
  const lonMax = view.getFloat64(32, true);
  const dLat = view.getFloat64(40, true);
  const dLon = view.getFloat64(48, true);
  const rows = view.getUint32(56, true);
  const cols = view.getUint32(60, true);
  const cellType = view.getUint16(64, true);
  if (cellType !== 1) throw new Error(`Unsupported geoid cellType ${cellType}`);
  if (68 + rows * cols * 2 > buf.byteLength) throw new Error("Geoid grid truncated");
  const cells = new Int16Array(buf, 68, rows * cols);

  return {
    info: {
      model: "EGM2008",
      source: "NGA EGM2008 2.5' grid (us_nga_egm08_25, PROJ CDN; converted from egm08_25.gtx)",
      resolutionArcMin: 2.5,
      bounds: { latMax, latMin, lonMin, lonMax },
      rows,
      cols,
      interpolation: "bilinear",
      accuracyNote:
        "Bilinear interpolation of the 2.5' grid; typically within 0.1 m of the full " +
        "spherical-harmonic model in smooth terrain, up to ~0.3 m over sharp geoid gradients.",
    },
    latMax,
    latMin,
    lonMin,
    lonMax,
    dLat,
    dLon,
    rows,
    cols,
    cells,
  };
}

/** Corner-registered bilinear sample. Returns null outside the grid or on nodata. */
export function sampleGrid(g: GridData, lat: number, lon: number): number | null {
  // Row-major from latMax going south; column 0 = lonMin going east.
  const r = (g.latMax - lat) / g.dLat;
  const c = (lon - g.lonMin) / g.dLon;
  if (r < 0 || c < 0 || r > g.rows - 1 || c > g.cols - 1) return null;

  const r0 = Math.min(Math.floor(r), g.rows - 2);
  const c0 = Math.min(Math.floor(c), g.cols - 2);
  const fr = r - r0;
  const fc = c - c0;

  const v00 = g.cells[r0 * g.cols + c0];
  if (v00 === NODATA) return null;
  // Exact node read — no neighbor stencil, robust to adjacent nodata.
  if (fr === 0 && fc === 0) return v00 / 100;

  const v01 = g.cells[r0 * g.cols + c0 + 1];
  const v10 = g.cells[(r0 + 1) * g.cols + c0];
  const v11 = g.cells[(r0 + 1) * g.cols + c0 + 1];
  if (v01 === NODATA || v10 === NODATA || v11 === NODATA) return null;

  const top = v00 * (1 - fc) + v01 * fc;
  const bot = v10 * (1 - fc) + v11 * fc;
  return (top * (1 - fr) + bot * fr) / 100; // cm -> m
}

/**
 * Lazy-load the bundled EGM2008 East-Africa grid and register it as the
 * active geoid model. Safe to call multiple times; resolves true when the
 * real grid is active, false when falling back to the parametric model.
 */
export function initGeoidModel(baseUrl = "/geoid/egm2008-ea-2p5.bin"): Promise<boolean> {
  if (loadPromise) return loadPromise;
  setStatus({ state: "loading", model: "EGM2008" });
  loadPromise = (async () => {
    try {
      const res = await fetch(baseUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      grid = parseGeoidGrid(buf);
      registerGeoidGridLoader((lat, lon) => {
        if (!grid) return null;
        return sampleGrid(grid, lat, lon);
      });
      setStatus({ state: "ready", model: "EGM2008", info: grid.info });
      return true;
    } catch (e) {
      setStatus({
        state: "unavailable",
        model: "parametric",
        reason: e instanceof Error ? e.message : String(e),
      });
      return false;
    }
  })();
  return loadPromise;
}

/** Force the parametric fallback (used by tests / explicit downgrade). */
export function _resetGeoidForTests() {
  grid = null;
  loadPromise = null;
  status = { state: "uninitialized", model: "parametric" };
}
