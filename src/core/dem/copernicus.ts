/**
 * Copernicus DEM GLO-30 — regional terrain ingestion for the workstation.
 *
 * Data: ESA Copernicus DEM (GLO-30, 30 m global, free-and-open licence),
 * consumed through the Microsoft Planetary Computer Data API mirror:
 *   POST {base}/item/crop.tif?collection=cop-dem-glo-30&item=<tileId>
 *        &assets=data&width=<w>&height=<h>
 *   body: GeoJSON Feature whose geometry is the query window (WGS84).
 * The API returns an uncompressed float32 GeoTIFF (elevation band + alpha
 * mask) georeferenced in EPSG:4326 — decodable in-browser with no
 * dependencies and no storage credentials. Verified live against the
 * Nairobi window: CORS open, POST well-formed, classic TIFF layout.
 *
 * Why full-tile ingestion and not more probes: a decoded regional grid
 * unlocks the analysis products the point probe cannot express — Horn
 * slope, along-line terrain profiles, regional contours — while the
 * surveyed TIN stays the statutory elevation source inside the job
 * boundary.
 *
 * Honesty contract (matches the OSINT doctrine):
 *  - The source (service, endpoint, tile ids, timestamp, coverage) is
 *    recorded into the provenance registry on every fetch.
 *  - Raster context is "regional terrain context", never a statutory
 *    elevation source; the effective ground resolution is disclosed
 *    whenever the request exceeds the pixel cap and must be resampled.
 */

/* ------------------------------------------------------------------ */
/* Source identity                                                     */
/* ------------------------------------------------------------------ */

export const DEM_SERVICE = "Copernicus DEM GLO-30 (ESA / Planetary Computer mirror)";
export const DEM_LICENSE = "Copernicus open licence (free, full and open access)";
export const DEM_ATTRIBUTION = "Contains modified Copernicus DEM data";
export const GLO30_COLLECTION = "cop-dem-glo-30";
export const DATA_API_BASE = "https://planetarycomputer.microsoft.com/api/data/v1";

/* ------------------------------------------------------------------ */
/* Tile model — GLO-30 tiles are 1° x 1°, named by their SW corner     */
/* (verified: item S02_00_E036_00 spans lat [-2,-1], lon [36,37])      */
/* ------------------------------------------------------------------ */

export interface Bbox {
  lonMin: number;
  latMin: number;
  lonMax: number;
  latMax: number;
}

export interface DemTileRef {
  /** Planetary Computer / ESA item id, e.g. Copernicus_DSM_COG_10_S02_00_E036_00_DEM. */
  itemId: string;
  south: number;
  north: number;
  west: number;
  east: number;
}

/** Item id for the 1° tile whose SW corner is (latIndex, lonIndex). */
export function glo30ItemId(latIndex: number, lonIndex: number): string {
  const ns = latIndex < 0 ? "S" : "N";
  const ew = lonIndex < 0 ? "W" : "E";
  return (
    `Copernicus_DSM_COG_10_${ns}${String(Math.abs(latIndex)).padStart(2, "0")}_00_` +
    `${ew}${String(Math.abs(lonIndex)).padStart(3, "0")}_00_DEM`
  );
}

/** The 1° tiles (by SW corner) that intersect a WGS84 bbox. */
export function intersectingDemTiles(bbox: Bbox): DemTileRef[] {
  const latLo = Math.max(-85, Math.floor(bbox.latMin));
  const latHi = Math.min(84, Math.ceil(bbox.latMax) - 1);
  const lonLo = Math.max(-180, Math.floor(bbox.lonMin));
  const lonHi = Math.min(179, Math.ceil(bbox.lonMax) - 1);
  const tiles: DemTileRef[] = [];
  for (let lat = latLo; lat <= latHi; lat++) {
    for (let lon = lonLo; lon <= lonHi; lon++) {
      tiles.push({
        itemId: glo30ItemId(lat, lon),
        south: lat,
        north: lat + 1,
        west: lon,
        east: lon + 1,
      });
    }
  }
  return tiles;
}

/* ------------------------------------------------------------------ */
/* Fetch planning — equal pixel scale across all crops so the mosaic   */
/* is a pure translation of each crop into the master grid             */
/* ------------------------------------------------------------------ */

const EARTH_M_PER_DEG_LAT = 111_320;
/** Upper bound on crop pixels per axis (keeps requests polite and bounded). */
export const MAX_CROP_PX = 2048;

export interface DemCropPlan {
  itemId: string;
  bbox: Bbox;
  width: number;
  height: number;
}

export interface DemFetchPlan {
  /** Master-grid georeference: (west, north) origin, rows go north→south. */
  west: number;
  north: number;
  dLonDeg: number;
  dLatDeg: number;
  width: number;
  height: number;
  /** Actual ground resolution after any pixel-cap resampling. */
  effectiveResM: number;
  /** True when the target resolution had to be coarsened (disclosed in UI). */
  resampled: boolean;
  crops: DemCropPlan[];
}

export interface DemPlanOptions {
  /** Desired ground resolution (m/px). Default 30 = native GLO-30. */
  targetResM?: number;
  maxPx?: number;
}

export function planDemFetch(bbox: Bbox, opts: DemPlanOptions = {}): DemFetchPlan {
  const targetResM = opts.targetResM ?? 30;
  const maxPx = Math.max(64, Math.min(4096, opts.maxPx ?? MAX_CROP_PX));

  const latCenter = (bbox.latMin + bbox.latMax) / 2;
  const cos = Math.max(0.1, Math.cos((latCenter * Math.PI) / 180));
  let dLatDeg = targetResM / EARTH_M_PER_DEG_LAT;
  let dLonDeg = targetResM / (EARTH_M_PER_DEG_LAT * cos);
  let width = Math.ceil((bbox.lonMax - bbox.lonMin) / dLonDeg);
  let height = Math.ceil((bbox.latMax - bbox.latMin) / dLatDeg);

  let resampled = false;
  let effectiveResM = targetResM;
  if (width > maxPx || height > maxPx) {
    const f = Math.max(width, height) / maxPx;
    effectiveResM = targetResM * f;
    dLatDeg = effectiveResM / EARTH_M_PER_DEG_LAT;
    dLonDeg = effectiveResM / (EARTH_M_PER_DEG_LAT * cos);
    width = Math.ceil((bbox.lonMax - bbox.lonMin) / dLonDeg);
    height = Math.ceil((bbox.latMax - bbox.latMin) / dLatDeg);
    resampled = true;
  }

  const crops: DemCropPlan[] = [];
  for (const tile of intersectingDemTiles(bbox)) {
    const west = Math.max(bbox.lonMin, tile.west);
    const east = Math.min(bbox.lonMax, tile.east);
    const south = Math.max(bbox.latMin, tile.south);
    const north = Math.min(bbox.latMax, tile.north);
    if (east <= west || north <= south) continue;
    crops.push({
      itemId: tile.itemId,
      bbox: { lonMin: west, latMin: south, lonMax: east, latMax: north },
      width: Math.max(2, Math.ceil((east - west) / dLonDeg)),
      height: Math.max(2, Math.ceil((north - south) / dLatDeg)),
    });
  }

  return {
    west: bbox.lonMin,
    north: bbox.latMax,
    dLonDeg,
    dLatDeg,
    width: Math.max(2, width),
    height: Math.max(2, height),
    effectiveResM,
    resampled,
    crops,
  };
}

/* ------------------------------------------------------------------ */
/* GeoTIFF decode — uncompressed float32 crop output (verified layout) */
/* ------------------------------------------------------------------ */

export interface DemCrop {
  width: number;
  height: number;
  /** Longitude of column 0 (west edge) and latitude of row 0 (north edge). */
  west: number;
  north: number;
  dLonDeg: number;
  dLatDeg: number;
  /** Row-major elevation grid, rows north→south. NaN = no data. */
  values: Float32Array;
  /** Number of masked (NaN) samples. */
  nodataCount: number;
}

export class DemDecodeError extends Error {}

interface IfdEntry {
  type: number;
  count: number;
  values: number[];
}

function parseIfd(view: DataView, ifdOffset: number): Map<number, IfdEntry> {
  const le = view.getUint16(0, true) === 0x4949; // "II"
  const magic = view.getUint16(2, le);
  if (magic === 43) throw new DemDecodeError("BigTIFF is not supported");
  if (magic !== 42) throw new DemDecodeError("not a TIFF file");
  const u16 = (o: number) => view.getUint16(o, le);
  const u32 = (o: number) => view.getUint32(o, le);

  const typeSize: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
  const tags = new Map<number, IfdEntry>();
  const n = u16(ifdOffset);
  if (n === 0 || n > 512) throw new DemDecodeError("implausible IFD size");
  for (let i = 0; i < n; i++) {
    const e = ifdOffset + 2 + i * 12;
    const tag = u16(e);
    const type = u16(e + 2);
    const count = u32(e + 4);
    const size = typeSize[type] ?? 1;
    const total = size * count;
    let dataOff = e + 8;
    if (total > 4) dataOff = u32(e + 8);
    if (dataOff + total > view.byteLength) throw new DemDecodeError(`tag ${tag} data out of bounds`);

    const values: number[] = [];
    if (type === 3) {
      for (let k = 0; k < count; k++) values.push(u16(dataOff + k * 2));
    } else if (type === 4 || type === 9) {
      for (let k = 0; k < count; k++) values.push(u32(dataOff + k * 4));
    } else if (type === 11) {
      for (let k = 0; k < count; k++) values.push(view.getFloat32(dataOff + k * 4, le));
    } else if (type === 12) {
      for (let k = 0; k < count; k++) values.push(view.getFloat64(dataOff + k * 8, le));
    } else if (type === 1 || type === 6 || type === 7 || type === 8) {
      for (let k = 0; k < count; k++) values.push(view.getUint8(dataOff + k));
    }
    // Rationals (5/10) and ASCII (2) are not needed for the crop layout.
    tags.set(tag, { type, count, values });
  }
  return tags;
}

/** Decompress a zlib-wrapped DEFLATE payload (TIFF Compression 8/32946)
    when the runtime provides DecompressionStream. The production crop
    output is uncompressed (verified), so this is a robustness fallback. */
async function inflate(zlibPayload: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new DemDecodeError("compressed DEM payload but no DecompressionStream in this runtime");
  }
  const ds = new DecompressionStream("deflate");
  const stream = new Blob([zlibPayload as BlobPart]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/** Decode a crop.tif response (GeoTIFF, EPSG:4326, float32 elevation). */
export async function decodeCropTiff(buffer: ArrayBuffer): Promise<DemCrop> {
  if (buffer.byteLength < 16) throw new DemDecodeError("response too short to be a GeoTIFF");
  const view = new DataView(buffer);
  const le = view.getUint16(0, true) === 0x4949;
  const tags = parseIfd(view, view.getUint32(4, le));

  const width = tags.get(256)?.values[0];
  const height = tags.get(257)?.values[0];
  const bits = tags.get(258)?.values ?? [];
  const compression = tags.get(259)?.values[0] ?? 1;
  const stripOffsets = tags.get(273)?.values ?? [];
  const samplesPerPixel = tags.get(277)?.values[0] ?? 1;
  const rowsPerStrip = tags.get(278)?.values[0] ?? height ?? 0;
  const stripCounts = tags.get(279)?.values ?? [];
  const sampleFormat = tags.get(339)?.values ?? [];
  const pixelScale = tags.get(33550)?.values ?? [];
  const tiepoint = tags.get(33922)?.values ?? [];

  if (!width || !height) throw new DemDecodeError("missing image dimensions");
  if (bits.some((b) => b !== 32)) throw new DemDecodeError("expected 32-bit samples");
  if (samplesPerPixel !== 1 && samplesPerPixel !== 2) {
    throw new DemDecodeError(`unexpected sample count ${samplesPerPixel}`);
  }
  if (sampleFormat.length && sampleFormat.some((f) => f !== 3)) {
    throw new DemDecodeError("expected float32 sample format");
  }
  if (compression !== 1 && compression !== 8 && compression !== 32946) {
    throw new DemDecodeError(`unsupported TIFF compression ${compression}`);
  }
  if (!stripOffsets.length || !stripCounts.length) throw new DemDecodeError("stripped TIFF required");
  if (pixelScale.length < 2 || tiepoint.length < 6) {
    throw new DemDecodeError("missing georeference (pixel scale / tiepoint)");
  }

  const dLonDeg = pixelScale[0];
  const dLatDeg = pixelScale[1];
  const west = tiepoint[3];
  const north = tiepoint[4];
  if (!Number.isFinite(dLonDeg) || !Number.isFinite(dLatDeg) || dLonDeg <= 0 || dLatDeg <= 0) {
    throw new DemDecodeError("implausible pixel scale");
  }
  if (!Number.isFinite(west) || !Number.isFinite(north)) {
    throw new DemDecodeError("implausible tiepoint");
  }

  const values = new Float32Array(width * height).fill(NaN);
  let nodataCount = 0;

  const stripRows = Math.max(1, rowsPerStrip);
  let filled = 0;
  for (let s = 0; s < stripOffsets.length; s++) {
    const off = stripOffsets[s];
    const len = stripCounts[s];
    if (off + len > view.byteLength) throw new DemDecodeError("strip out of bounds");
    let bytes: Uint8Array;
    if (compression === 1) {
      bytes = new Uint8Array(buffer, off, len);
    } else {
      bytes = await inflate(new Uint8Array(buffer, off, len));
    }
    const row0 = s * stripRows;
    const rowSpan = Math.min(stripRows, height - row0);
    for (let r = 0; r < rowSpan; r++) {
      for (let c = 0; c < width; c++) {
        const idx = (r * width + c) * samplesPerPixel * 4;
        if (idx + 4 > bytes.length) break;
        // Production layout (verified against live crop.tif): both samples
        // are float32 — band 2 is the alpha mask, 255.0 = valid, 0 = masked.
        const elev = new DataView(bytes.buffer, bytes.byteOffset + idx, 4).getFloat32(0, true);
        let valid = true;
        if (samplesPerPixel === 2) {
          const alpha = new DataView(bytes.buffer, bytes.byteOffset + idx + 4, 4).getFloat32(0, true);
          valid = alpha > 0;
        }
        if (!valid || !Number.isFinite(elev)) {
          nodataCount++;
        } else {
          values[(row0 + r) * width + c] = elev;
          filled++;
        }
      }
    }
  }
  if (filled === 0) throw new DemDecodeError("crop contained no valid elevation samples");

  return { width, height, west, north, dLonDeg, dLatDeg, values, nodataCount };
}

/* ------------------------------------------------------------------ */
/* Mosaic — place per-tile crops into the master grid (pure function)  */
/* ------------------------------------------------------------------ */

export interface DemGrid {
  width: number;
  height: number;
  west: number;
  north: number;
  dLonDeg: number;
  dLatDeg: number;
  /** Row-major elevations, rows north→south, NaN = masked. */
  values: Float32Array;
  /** Number of valid (non-NaN) samples. */
  validCount: number;
  /** Mosaic placement disclosure: "WxH@lon,lat" per contributing crop. */
  sourceItems: string[];
}

/** Merge crops planned by planDemFetch into one master grid. */
export function mosaicCrops(crops: DemCrop[], plan: DemFetchPlan): DemGrid {
  const values = new Float32Array(plan.width * plan.height).fill(NaN);
  const sourceItems: string[] = [];

  for (const crop of crops) {
    const col0 = Math.round((crop.west - plan.west) / plan.dLonDeg);
    const row0 = Math.round((plan.north - crop.north) / plan.dLatDeg);
    sourceItems.push(`${crop.width}x${crop.height}@${crop.west.toFixed(4)},${crop.north.toFixed(4)}`);
    for (let r = 0; r < crop.height; r++) {
      const gr = row0 + r;
      if (gr < 0 || gr >= plan.height) continue;
      for (let c = 0; c < crop.width; c++) {
        const gc = col0 + c;
        if (gc < 0 || gc >= plan.width) continue;
        const v = crop.values[r * crop.width + c];
        if (Number.isFinite(v)) values[gr * plan.width + gc] = v;
      }
    }
  }

  return {
    width: plan.width,
    height: plan.height,
    west: plan.west,
    north: plan.north,
    dLonDeg: plan.dLonDeg,
    dLatDeg: plan.dLatDeg,
    values,
    validCount: countFinite(values),
    sourceItems,
  };
}

function countFinite(values: Float32Array): number {
  let n = 0;
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) n++;
  return n;
}

/* ------------------------------------------------------------------ */
/* Production fetch — Planetary Computer Data API crop endpoint        */
/* ------------------------------------------------------------------ */

export interface DemFetchResult {
  grid: DemGrid;
  plan: DemFetchPlan;
  endpoint: string;
  fetchedAt: string;
  /** Bytes downloaded per tile (provenance disclosure). */
  tileBytes: { itemId: string; bytes: number }[];
  effectiveResM: number;
}

export interface DemFetchDeps {
  fetchImpl?: typeof fetch;
  /** Abort after this many ms (default 90 s — first hit can be slow). */
  timeoutMs?: number;
}

async function fetchCrop(
  crop: DemCropPlan,
  deps: DemFetchDeps,
): Promise<{ crop: DemCrop; bytes: number }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const url =
    `${DATA_API_BASE}/item/crop.tif?collection=${GLO30_COLLECTION}` +
    `&item=${encodeURIComponent(crop.itemId)}&assets=data` +
    `&width=${crop.width}&height=${crop.height}`;
  const body = {
    type: "Feature",
    bbox: [crop.bbox.lonMin, crop.bbox.latMin, crop.bbox.lonMax, crop.bbox.latMax],
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [crop.bbox.lonMin, crop.bbox.latMin],
          [crop.bbox.lonMax, crop.bbox.latMin],
          [crop.bbox.lonMax, crop.bbox.latMax],
          [crop.bbox.lonMin, crop.bbox.latMax],
          [crop.bbox.lonMin, crop.bbox.latMin],
        ],
      ],
    },
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? 90_000);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(
      `GLO-30 crop for ${crop.itemId} failed: ${err instanceof Error ? err.message : "network error"}`,
    );
  }
  clearTimeout(timer);
  if (!res.ok) {
    throw new Error(`GLO-30 crop for ${crop.itemId} returned HTTP ${res.status}`);
  }
  const buf = await res.arrayBuffer();
  const decoded = await decodeCropTiff(buf);
  return { crop: decoded, bytes: buf.byteLength };
}

/**
 * Fetch and mosaic the GLO-30 regional grid for a WGS84 bbox.
 * Throws with a human message when any tile crop fails.
 */
export async function fetchDemGrid(
  bbox: Bbox,
  opts: DemPlanOptions = {},
  deps: DemFetchDeps = {},
): Promise<DemFetchResult> {
  const plan = planDemFetch(bbox, opts);
  if (plan.crops.length === 0) throw new Error("query window intersects no GLO-30 tiles");
  const endpoint = `${DATA_API_BASE}/item/crop.tif (POST, collection ${GLO30_COLLECTION})`;
  const tileBytes: { itemId: string; bytes: number }[] = [];
  const decoded: DemCrop[] = [];

  // Sequential — at most 4 tiles for a 1° window, and the service is shared.
  for (const cropPlan of plan.crops) {
    const { crop, bytes } = await fetchCrop(cropPlan, deps);
    tileBytes.push({ itemId: cropPlan.itemId, bytes });
    decoded.push(crop);
  }

  const grid = mosaicCrops(decoded, plan);
  return {
    grid,
    plan,
    endpoint,
    fetchedAt: new Date().toISOString(),
    tileBytes,
    effectiveResM: plan.effectiveResM,
  };
}
