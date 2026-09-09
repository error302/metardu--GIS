/**
 * XYZ raster tile infrastructure — provider registry, persistent offline
 * cache (Cache API), in-memory decode LRU, bounded concurrency, and
 * Web-Mercator tile math.
 *
 * Offline doctrine: tiles are fetched through the persistent cache; every
 * tile ever seen is served from disk on subsequent sessions with no network.
 * When tiles are unavailable the map falls back to the procedural vector
 * basemaps — the canvas never blocks on the network.
 */

export interface TileProvider {
  id: "osm" | "esri-imagery";
  label: string;
  /** XYZ template; {z} {x} {y} with y already top-origin */
  url: (z: number, x: number, y: number) => string;
  attribution: string;
  maxZoom: number;
  minZoom: number;
}

export const TILE_PROVIDERS: Record<TileProvider["id"], TileProvider> = {
  osm: {
    id: "osm",
    label: "OpenStreetMap",
    url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
    minZoom: 2,
  },
  "esri-imagery": {
    id: "esri-imagery",
    label: "Esri World Imagery",
    url: (z, x, y) =>
      `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    attribution: "Esri, Maxar, Earthstar Geographics",
    maxZoom: 19,
    minZoom: 2,
  },
};

/* ---------------- Web-Mercator tile math ---------------- */

export const TILE_SIZE = 256;
const EARTH_CIRC_M = 40075016.686; // WGS84 equatorial circumference (Web Mercator sphere)

/** Equatorial resolution (m/px) at a given zoom level. */
export function resolutionAtZoom(z: number): number {
  return EARTH_CIRC_M / TILE_SIZE / Math.pow(2, z);
}

/** Local ground resolution (m/px) at latitude for a zoom level. */
export function groundResolution(z: number, lat: number): number {
  return resolutionAtZoom(z) * Math.cos((lat * Math.PI) / 180);
}

/** Choose the Web-Mercator zoom whose local resolution best matches mpp. */
export function pickTileZoom(mpp: number, lat: number, minZoom: number, maxZoom: number): number {
  if (!(mpp > 0)) return minZoom;
  const raw = Math.log2(EARTH_CIRC_M * Math.cos((lat * Math.PI) / 180) / (TILE_SIZE * mpp));
  return Math.max(minZoom, Math.min(maxZoom, Math.round(raw)));
}

/** Tile indices (float) for lon/lat at zoom z — top-origin y. */
export function lonLatToTile(lon: number, lat: number, z: number): { x: number; y: number } {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const n = Math.pow(2, z);
  const x = ((lon + 180) / 360) * n;
  const sinLat = Math.sin((clampedLat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * n;
  return { x, y };
}

/** NW-corner lon/lat of a tile. */
export function tileToLonLat(x: number, y: number, z: number): { lon: number; lat: number } {
  const n = Math.pow(2, z);
  const lon = (x / n) * 360 - 180;
  const merc = Math.PI * (1 - (2 * y) / n);
  const lat = (Math.atan(Math.sinh(merc)) * 180) / Math.PI;
  return { lon, lat };
}

/* ---------------- Tile cache ---------------- */

interface LruEntry<V> {
  key: string;
  value: V;
}

/** Small insertion-ordered LRU keyed by string. */
export class LruCache<V> {
  private map = new Map<string, V>();
  constructor(private max: number) {}
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, value: V) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as string;
      this.map.delete(oldest);
    }
  }
  get size() {
    return this.map.size;
  }
}

const PERSISTENT_CACHE_NAME = "metardu-tiles-v1";
const MAX_IN_FLIGHT = 8;
const NEGATIVE_TTL_MS = 30_000;

/**
 * TileService — fetch-through-cache XYZ tile images with bounded concurrency.
 * `get()` returns immediately with a decoded image or null; requests are
 * queued and fulfilled asynchronously (the canvas polls or subscribes).
 */
export class TileService {
  private mem = new LruCache<HTMLImageElement>(320);
  private pending = new Map<string, Promise<HTMLImageElement | null>>();
  private failedAt = new Map<string, number>();
  private queue: (() => void)[] = [];
  private inFlight = 0;
  private persistent: Cache | null = null;
  private persistentReady: Promise<void>;
  private listeners = new Set<(key: string) => void>();

  constructor() {
    this.persistentReady =
      typeof caches !== "undefined"
        ? caches
            .open(PERSISTENT_CACHE_NAME)
            .then((c) => {
              this.persistent = c;
            })
            .catch(() => {
              this.persistent = null;
            })
        : Promise.resolve();
  }

  onChange(cb: (key: string) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  static key(provider: TileProvider, z: number, x: number, y: number): string {
    return `${provider.id}/${z}/${x}/${y}`;
  }

  /** Synchronous read of a decoded tile, if already available. */
  peek(key: string): HTMLImageElement | null | undefined {
    return this.mem.get(key);
  }

  /** Request a tile; kicks off fetch if not resident. Returns current state. */
  request(provider: TileProvider, z: number, x: number, y: number): HTMLImageElement | null {
    const key = TileService.key(provider, z, x, y);
    const hit = this.mem.get(key);
    if (hit) return hit;
    if (!this.pending.has(key) && !this.isNegative(key)) {
      this.enqueue(provider, z, x, y, key);
    }
    return null;
  }

  private isNegative(key: string): boolean {
    const t = this.failedAt.get(key);
    if (t === undefined) return false;
    if (Date.now() - t > NEGATIVE_TTL_MS) {
      this.failedAt.delete(key);
      return false;
    }
    return true;
  }

  private enqueue(provider: TileProvider, z: number, x: number, y: number, key: string) {
    this.pending.set(
      key,
      new Promise<HTMLImageElement | null>((resolve) => {
        this.queue.push(() => {
          this.fetchTile(provider, z, x, y, key)
            .then(resolve)
            .catch(() => resolve(null));
        });
        this.pump();
      }),
    );
  }

  private pump() {
    while (this.inFlight < MAX_IN_FLIGHT && this.queue.length > 0) {
      const job = this.queue.shift();
      this.inFlight++;
      job?.();
    }
  }

  private async fetchTile(
    provider: TileProvider,
    z: number,
    x: number,
    y: number,
    key: string,
  ): Promise<HTMLImageElement | null> {
    try {
      await this.persistentReady;
      let blob: Blob | null = null;
      const url = provider.url(z, x, y);

      if (this.persistent) {
        const hit = await this.persistent.match(url);
        if (hit) blob = await hit.blob();
      }
      if (!blob) {
        const res = await fetch(url, { mode: "cors" });
        if (!res.ok) throw new Error(`tile HTTP ${res.status}`);
        // Clone BEFORE consuming the body — a disturbed response cannot be cloned.
        const forCache = this.persistent ? res.clone() : null;
        blob = await res.blob();
        if (this.persistent && forCache) {
          // Fire-and-forget persistence (offline-first for repeat sessions)
          this.persistent.put(url, forCache).catch(() => {});
        }
      }

      const img = await decodeBlob(blob);
      this.mem.set(key, img);
      this.failedAt.delete(key);
      for (const cb of this.listeners) cb(key);
      return img;
    } catch {
      this.failedAt.set(key, Date.now());
      return null;
    } finally {
      this.pending.delete(key);
      this.inFlight--;
      this.pump();
    }
  }

  /** How many tiles are currently decoded (diagnostics/tests). */
  get residentCount(): number {
    return this.mem.size;
  }
}

function decodeBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("tile decode failed"));
    };
    img.src = url;
  });
}

/* ---------------- Viewport tile enumeration ---------------- */

export interface TileSpan {
  z: number;
  x: number;
  y: number;
  /** NW and SE corner lon/lat of the tile (for reprojection onto the canvas) */
  nw: { lon: number; lat: number };
  se: { lon: number; lat: number };
}

/**
 * Enumerate the tiles covering a lon/lat viewport bbox, dropping zoom levels
 * while more than maxTiles would be needed (overzoom behavior at extreme
 * scales). `bbox` = [lonMin, latMin, lonMax, latMax].
 */
export function tilesForViewport(
  provider: TileProvider,
  mpp: number,
  bbox: [number, number, number, number],
  maxTiles = 48,
): TileSpan[] {
  const latCenter = (bbox[1] + bbox[3]) / 2;
  let z = pickTileZoom(mpp, latCenter, provider.minZoom, provider.maxZoom);

  const countFor = (zz: number): number => {
    const nw = lonLatToTile(bbox[0], bbox[3], zz); // lonMin, latMax
    const se = lonLatToTile(bbox[2], bbox[1], zz); // lonMax, latMin
    const nx = Math.floor(se.x) - Math.floor(nw.x) + 1;
    const ny = Math.floor(se.y) - Math.floor(nw.y) + 1;
    return nx * ny;
  };

  while (z > provider.minZoom && countFor(z) > maxTiles) z--;

  const nw = lonLatToTile(bbox[0], bbox[3], z);
  const se = lonLatToTile(bbox[2], bbox[1], z);
  const spans: TileSpan[] = [];
  for (let ty = Math.floor(nw.y); ty <= Math.floor(se.y); ty++) {
    for (let tx = Math.floor(nw.x); tx <= Math.floor(se.x); tx++) {
      if (ty < 0 || ty >= Math.pow(2, z)) continue;
      const wx = ((tx % Math.pow(2, z)) + Math.pow(2, z)) % Math.pow(2, z);
      const nwLL = tileToLonLat(tx, ty, z);
      const seLL = tileToLonLat(tx + 1, ty + 1, z);
      spans.push({ z, x: wx, y: ty, nw: nwLL, se: seLL });
    }
  }
  return spans;
}
