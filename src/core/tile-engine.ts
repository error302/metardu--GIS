/**
 * MetaRDU GIS Studio - Real Multi-Source Satellite & Remote Sensing Tile Streamer
 * Pure client-side Web Mercator (EPSG:3857) Slippy Map tile engine with coordinate reprojectors,
 * asynchronous tile caching, and sub-pixel canvas blitting.
 */

import { toWGS84, fromWGS84 } from "./crs";

export type TileProviderId = "esri-satellite" | "osm" | "carto-dark" | "nasa-viirs" | "none";

export interface TileProvider {
  id: TileProviderId;
  name: string;
  attribution: string;
  urlTemplate: string;
  minZoom: number;
  maxZoom: number;
  tileSize: number;
}

export const TILE_PROVIDERS: Record<TileProviderId, TileProvider> = {
  "esri-satellite": {
    id: "esri-satellite",
    name: "ESRI World Imagery (Satellite)",
    attribution: "Tiles (C) Esri, Maxar, Earthstar Geographics",
    urlTemplate: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    minZoom: 1,
    maxZoom: 19,
    tileSize: 256,
  },
  "osm": {
    id: "osm",
    name: "OpenStreetMap Standard",
    attribution: "(C) OpenStreetMap contributors",
    urlTemplate: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    minZoom: 1,
    maxZoom: 19,
    tileSize: 256,
  },
  "carto-dark": {
    id: "carto-dark",
    name: "CartoDB Dark Matter",
    attribution: "(C) CARTO, (C) OpenStreetMap contributors",
    urlTemplate: "https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png",
    minZoom: 1,
    maxZoom: 19,
    tileSize: 256,
  },
  "nasa-viirs": {
    id: "nasa-viirs",
    name: "NASA GIBS Night-Time Lights (VIIRS Earth at Night)",
    attribution: "NASA Earth Science Data and Information System (ESDIS) Project",
    urlTemplate: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2022-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png",
    minZoom: 1,
    maxZoom: 8,
    tileSize: 256,
  },
  "none": {
    id: "none",
    name: "Vector Only (No Tiles)",
    attribution: "",
    urlTemplate: "",
    minZoom: 1,
    maxZoom: 19,
    tileSize: 256,
  },
};

/**
 * Converts Lon/Lat to fractional Tile coordinates at a given zoom level
 */
export function lonLatToTileXY(lon: number, lat: number, zoom: number): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const x = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

/**
 * Converts Tile integer coordinates to bounding box in Lon/Lat (WGS84)
 */
export function tileXYToLonLatBounds(
  tx: number,
  ty: number,
  zoom: number
): { minLon: number; maxLon: number; minLat: number; maxLat: number } {
  const n = Math.pow(2, zoom);
  const minLon = (tx / n) * 360 - 180;
  const maxLon = ((tx + 1) / n) * 360 - 180;

  const latRad1 = Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + 1)) / n)));
  const minLat = (latRad1 * 180) / Math.PI;

  const latRad2 = Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n)));
  const maxLat = (latRad2 * 180) / Math.PI;

  return { minLon, maxLon, minLat, maxLat };
}

/**
 * Computes optimal Web Mercator tile zoom level for current viewport resolution.
 * canvasZoom is in pixels per meter.
 */
export function calculateTileZoom(canvasZoom: number, centerLat: number, minZoom = 1, maxZoom = 19): number {
  // meters per pixel = 1 / canvasZoom
  const metersPerPixel = 1 / canvasZoom;
  const latRad = (centerLat * Math.PI) / 180;
  const cosLat = Math.max(0.1, Math.cos(latRad));

  // ground resolution at zoom z = (40075016.686 * cosLat) / (256 * 2^z)
  // 2^z = (40075016.686 * cosLat) / (256 * metersPerPixel)
  const z = Math.log2((40075016.686 * cosLat) / (256 * metersPerPixel));
  return Math.max(minZoom, Math.min(maxZoom, Math.round(z)));
}

/**
 * In-memory client-side Tile Cache with async image loading.
 */
export class TileManager {
  private cache: Map<string, HTMLImageElement> = new Map();
  private failedUrls: Set<string> = new Set();
  private pendingRequests: Set<string> = new Set();
  private maxCacheSize: number;

  constructor(maxCacheSize: number = 200) {
    this.maxCacheSize = maxCacheSize;
  }

  public getTileKey(providerId: string, z: number, x: number, y: number): string {
    return `${providerId}:${z}:${x}:${y}`;
  }

  public getTileUrl(provider: TileProvider, z: number, x: number, y: number): string {
    return provider.urlTemplate
      .replace("{z}", z.toString())
      .replace("{x}", x.toString())
      .replace("{y}", y.toString());
  }

  /**
   * Retrieves a tile image if already loaded, or kicks off async loading.
   * Calls onTileLoaded callback when the image loads.
   */
  public requestTile(
    provider: TileProvider,
    z: number,
    x: number,
    y: number,
    onTileLoaded?: () => void
  ): HTMLImageElement | null {
    if (provider.id === "none") return null;

    const key = this.getTileKey(provider.id, z, x, y);
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    const url = this.getTileUrl(provider, z, x, y);
    if (this.failedUrls.has(url) || this.pendingRequests.has(url)) {
      return null;
    }

    this.pendingRequests.add(url);
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      this.pendingRequests.delete(url);
      if (this.cache.size >= this.maxCacheSize) {
        // Simple LRU eviction of first key
        const firstKey = this.cache.keys().next().value;
        if (firstKey) this.cache.delete(firstKey);
      }
      this.cache.set(key, img);
      if (onTileLoaded) onTileLoaded();
    };

    img.onerror = () => {
      this.pendingRequests.delete(url);
      this.failedUrls.add(url);
    };

    img.src = url;
    return null;
  }

  /**
   * Calculates visible tiles covering the bounding box in projected coordinates.
   */
  public getVisibleTiles(
    minE: number,
    maxE: number,
    minN: number,
    maxN: number,
    epsg: number,
    tileZoom: number,
    provider: TileProvider
  ): { x: number; y: number; z: number; boundsProj: { minE: number; maxE: number; minN: number; maxN: number } }[] {
    const clampedZ = Math.max(provider.minZoom, Math.min(provider.maxZoom, tileZoom));
    const n = Math.pow(2, clampedZ);

    // Convert corners to WGS84
    const [lon1, lat1] = toWGS84(epsg, minE, minN);
    const [lon2, lat2] = toWGS84(epsg, maxE, maxN);

    const minLon = Math.min(lon1, lon2);
    const maxLon = Math.max(lon1, lon2);
    const minLat = Math.min(lat1, lat2);
    const maxLat = Math.max(lat1, lat2);

    const t1 = lonLatToTileXY(minLon, maxLat, clampedZ);
    const t2 = lonLatToTileXY(maxLon, minLat, clampedZ);

    const startX = Math.max(0, Math.floor(Math.min(t1.x, t2.x)));
    const endX = Math.min(n - 1, Math.floor(Math.max(t1.x, t2.x)));
    const startY = Math.max(0, Math.floor(Math.min(t1.y, t2.y)));
    const endY = Math.min(n - 1, Math.floor(Math.max(t1.y, t2.y)));

    // Limit maximum tiles to prevent runaway requests if zoomed far out
    const totalTiles = (endX - startX + 1) * (endY - startY + 1);
    if (totalTiles > 36) {
      return [];
    }

    const tiles: { x: number; y: number; z: number; boundsProj: { minE: number; maxE: number; minN: number; maxN: number } }[] = [];

    for (let x = startX; x <= endX; x++) {
      for (let y = startY; y <= endY; y++) {
        const bounds = tileXYToLonLatBounds(x, y, clampedZ);
        // Project bounds back to local CRS
        const [projMinE, projMinN] = fromWGS84(epsg, bounds.minLon, bounds.minLat);
        const [projMaxE, projMaxN] = fromWGS84(epsg, bounds.maxLon, bounds.maxLat);

        tiles.push({
          x,
          y,
          z: clampedZ,
          boundsProj: {
            minE: Math.min(projMinE, projMaxE),
            maxE: Math.max(projMinE, projMaxE),
            minN: Math.min(projMinN, projMaxN),
            maxN: Math.max(projMinN, projMaxN),
          },
        });
      }
    }

    return tiles;
  }
}

export const globalTileManager = new TileManager(250);
