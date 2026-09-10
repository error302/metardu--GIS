/**
 * Regional elevation from Terrarium DEM terrain tiles (AWS elevation-tiles-prod).
 *
 * Purpose: elevation context BEYOND the surveyed TIN footprint. The pipeline's
 * surveyed elevations remain the statutory source of truth inside the job
 * boundary; this service reports regional ground surface for planning context
 * (drainage direction, neighbouring terrain, corridor reconnaissance).
 *
 * Decode: elevation = (R * 256 + G + B / 256) − 32768 metres (Terrarium spec).
 * Provenance: every probe result carries the tile zoom (ground resolution)
 * and dataset name so the UI can disclose what it is standing on.
 */

import { LruCache, pickTileZoom } from "./tiles";

const DEM_TILE_URL = (z: number, x: number, y: number) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

export const DEM_PROVIDER_ID = "terrarium-dem";
export const DEM_ATTRIBUTION = "DEM: Terrain Tiles (Terrarium/Mapzen)";
/** ~10 m/px at the equator — good balance of detail vs tile availability. */
const TARGET_MPP = 10;
const ZOOM_FLOOR = 8;
const ZOOM_CEIL = 14;

export interface DemProbe {
  elevationM: number;
  zoom: number;
  /** Ground resolution (m/px) of the sampled tile. */
  resolutionM: number;
  lat: number;
  lon: number;
}

/* Decode cache: tile key -> Float32Array elevation grid (65536 floats). */
const gridCache = new LruCache<Float32Array>(64);

/* A private tile fetcher (image decode only — no Cache API to avoid double
   caching image blobs; elevation grids are tiny once decoded). */
const imgCache = new LruCache<HTMLImageElement>(48);
const pending = new Map<string, Promise<HTMLImageElement | null>>();

function fetchTileImage(url: string): Promise<HTMLImageElement | null> {
  const cached = imgCache.get(url);
  if (cached) return Promise.resolve(cached);
  const inflight = pending.get(url);
  if (inflight) return inflight;
  const p = fetch(url, { mode: "cors" })
    .then((res) => {
      if (!res.ok) throw new Error(`DEM tile HTTP ${res.status}`);
      return res.blob();
    })
    .then(
      (blob) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const urlObj = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            URL.revokeObjectURL(urlObj);
            imgCache.set(url, img);
            resolve(img);
          };
          img.onerror = () => {
            URL.revokeObjectURL(urlObj);
            reject(new Error("DEM tile decode failed"));
          };
          img.src = urlObj;
        }),
    )
    .catch(() => null)
    .finally(() => pending.delete(url));
  pending.set(url, p);
  return p;
}

let scratchCanvas: HTMLCanvasElement | null = null;

async function decodeTileGrid(z: number, x: number, y: number): Promise<Float32Array | null> {
  const key = `${z}/${x}/${y}`;
  const cached = gridCache.get(key);
  if (cached) return cached;
  const img = await fetchTileImage(DEM_TILE_URL(z, x, y));
  if (!img) return null;
  if (!scratchCanvas) scratchCanvas = document.createElement("canvas");
  scratchCanvas.width = img.width;
  scratchCanvas.height = img.height;
  const ctx = scratchCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.clearRect(0, 0, img.width, img.height);
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height).data;
  const n = img.width * img.height;
  const grid = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    grid[i] = r * 256 + g + b / 256 - 32768;
  }
  gridCache.set(key, grid);
  return grid;
}

/**
 * Sample regional elevation at a WGS84 position. Bilinear across the four
 * nearest pixels of the chosen tile. Returns null when the tile cannot be
 * fetched (offline, outside coverage) — callers disclose the failure rather
 * than inventing a value.
 */
export async function probeElevation(lat: number, lon: number): Promise<DemProbe | null> {
  const zoom = Math.max(ZOOM_FLOOR, Math.min(ZOOM_CEIL, pickTileZoom(TARGET_MPP, lat, ZOOM_FLOOR, ZOOM_CEIL)));
  const n = Math.pow(2, zoom);
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const xf = ((lon + 180) / 360) * n;
  const sinLat = Math.sin((clampedLat * Math.PI) / 180);
  const yf = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * n;
  const tx = Math.floor(xf);
  const ty = Math.floor(yf);

  const grid = await decodeTileGrid(zoom, tx, ty);
  if (!grid) return null;

  const size = 256;
  const px = (xf - tx) * size;
  const py = (yf - ty) * size;
  const x0 = Math.min(Math.floor(px), size - 2);
  const y0 = Math.min(Math.floor(py), size - 2);
  const fx = px - x0;
  const fy = py - y0;
  const idx = (xx: number, yy: number) => yy * size + xx;
  const v00 = grid[idx(x0, y0)];
  const v01 = grid[idx(x0 + 1, y0)];
  const v10 = grid[idx(x0, y0 + 1)];
  const v11 = grid[idx(x0 + 1, y0 + 1)];
  const top = v00 * (1 - fx) + v01 * fx;
  const bot = v10 * (1 - fx) + v11 * fx;
  const elev = top * (1 - fy) + bot * fy;

  const resolutionM = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * n);
  return {
    elevationM: Number(elev.toFixed(2)),
    zoom,
    resolutionM: Number(resolutionM.toFixed(1)),
    lat,
    lon,
  };
}
