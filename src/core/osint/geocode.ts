/**
 * OSINT place search — OpenStreetMap Nominatim geocoding client.
 *
 * Purpose: locate a place by name (site reconnaissance, jumping the
 * workspace to a new area of interest) without leaving the workstation.
 * Results are disclosures, not evidence: the search itself is recorded
 * into the provenance registry by the calling panel (service, endpoint,
 * license, timestamp, result count) so the session's chain of custody
 * shows where coordinates came from.
 *
 * Usage policy discipline (https://operations.osmfoundation.org/policies/nominatim/):
 *  - absolute maximum 1 request/second — enforced client-side via a
 *    module-level spacing timer (searches are user-initiated, on demand;
 *    no keystroke autocomplete by design).
 *  - a descriptive User-Agent identifies the application.
 */

/* ------------------------------------------------------------------ */
/* Source identity                                                     */
/* ------------------------------------------------------------------ */

export const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";
export const NOMINATIM_SERVICE = "OpenStreetMap Nominatim (geocoding)";
export const NOMINATIM_LICENSE = "ODbL 1.0";
export const NOMINATIM_ATTRIBUTION = "© OpenStreetMap contributors";
/** Politeness floor between successive searches (OSMF policy: 1 req/s). */
export const NOMINATIM_MIN_INTERVAL_MS = 1100;

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */

export interface GeocodeResult {
  placeId: number;
  osmType: string;
  osmId: number;
  lat: number;
  lon: number;
  category: string;
  type: string;
  /** Full display name, most specific last. */
  label: string;
  importance: number;
  /** WGS84 bounds of the place (lonMin, latMin, lonMax, latMax). */
  bbox: { lonMin: number; latMin: number; lonMax: number; latMax: number };
}

export interface GeocodeResponse {
  results: GeocodeResult[];
  endpoint: string;
  fetchedAt: string;
}

export interface GeocodeOptions {
  /** 1..10 (Nominatim allows up to 50; the UI shows 5). */
  limit?: number;
  /** Two-letter ISO 3166-1 alpha-2 country filter, e.g. "ke". */
  countryCode?: string;
  /** Override the politeness floor (tests only). */
  minIntervalMs?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/* ------------------------------------------------------------------ */
/* Rate discipline — module-level spacing between searches             */
/* ------------------------------------------------------------------ */

let lastSearchAt = 0;

/** Reset the spacing timer (tests / explicit user override). */
export function resetGeocodeRate(): void {
  lastSearchAt = 0;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

export function validateGeocodeQuery(query: string): string | null {
  const q = query.trim();
  if (q.length === 0) return "Enter a place name to search";
  if (q.length > 120) return "Query too long (120 character limit)";
  return null;
}

export async function searchPlaces(query: string, opts: GeocodeOptions = {}): Promise<GeocodeResponse> {
  const q = query.trim();
  const err = validateGeocodeQuery(q);
  if (err) throw new Error(err);

  const limit = Math.max(1, Math.min(10, opts.limit ?? 5));
  const params = new URLSearchParams({
    q,
    format: "jsonv2",
    limit: String(limit),
    addressdetails: "0",
  });
  if (opts.countryCode && /^[a-z]{2}$/i.test(opts.countryCode)) {
    params.set("countrycodes", opts.countryCode.toLowerCase());
  }
  const url = `${NOMINATIM_ENDPOINT}?${params.toString()}`;

  // Client-side 1 req/s floor — wait out the remainder of the interval.
  const minInterval = opts.minIntervalMs ?? NOMINATIM_MIN_INTERVAL_MS;
  const now = Date.now();
  const elapsed = now - lastSearchAt;
  if (lastSearchAt > 0 && elapsed < minInterval) {
    await sleep(minInterval - elapsed);
  }
  lastSearchAt = Date.now();

  const fetchImpl = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    throw new Error(`Place search failed: ${e instanceof Error ? e.message : "network error"}`);
  }
  clearTimeout(timer);
  if (!res.ok) {
    throw new Error(`Place search returned HTTP ${res.status}${res.status === 429 ? " (rate limited — retry in a moment)" : ""}`);
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    throw new Error("Place search returned malformed JSON");
  }
  if (!Array.isArray(raw)) throw new Error("Place search returned an unexpected payload");

  // Nominatim boundingbox order: [south, north, west, east] as strings.
  const results: GeocodeResult[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    const lat = Number(item.lat);
    const lon = Number(item.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const bb = item.boundingbox as string[] | undefined;
    const bbox = bb && bb.length === 4
      ? {
          latMin: Number(bb[0]),
          latMax: Number(bb[1]),
          lonMin: Number(bb[2]),
          lonMax: Number(bb[3]),
        }
      : {
          latMin: lat,
          latMax: lat,
          lonMin: lon,
          lonMax: lon,
        };
    results.push({
      placeId: Number(item.place_id) || 0,
      osmType: String(item.osm_type ?? ""),
      osmId: Number(item.osm_id) || 0,
      lat,
      lon,
      category: String(item.category ?? item.class ?? ""),
      type: String(item.type ?? ""),
      label: String(item.display_name ?? "Unnamed place"),
      importance: Number(item.importance) || 0,
      bbox: {
        lonMin: Math.min(bbox.lonMin, bbox.lonMax),
        latMin: Math.min(bbox.latMin, bbox.latMax),
        lonMax: Math.max(bbox.lonMin, bbox.lonMax),
        latMax: Math.max(bbox.latMin, bbox.latMax),
      },
    });
  }

  return {
    results,
    endpoint: url,
    fetchedAt: new Date().toISOString(),
  };
}

/** Short human line for a result row, e.g. "suburb · -1.2648, 36.8018". */
export function describeGeocodeResult(r: GeocodeResult): string {
  return `${r.type || r.category} · ${r.lat.toFixed(4)}, ${r.lon.toFixed(4)}`;
}
