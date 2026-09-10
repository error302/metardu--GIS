/**
 * NASA FIRMS active-fire watchlists — thermal-anomaly alerts as a monitored
 * screening feed with a persistent, diffable chain of checks.
 *
 * Purpose: a survey/planning job near flammable or fire-prone land needs a
 * standing answer to "what is burning near my scope right now, and what
 * started burning since I last looked?". FIRMS NRT (VIIRS 375 m / MODIS
 * 1 km) answers that. This module wraps the FIRMS area CSV API:
 *
 *  - one call per satellite source per check (bbox, 1-10 day window);
 *  - deterministic alert ids (FNV-1a over source|lat|lon|date|time) so a
 *    re-fetch of the SAME detection yields the SAME id — new-alert diffing
 *    is then exact set difference, not guesswork;
 *  - watchlists persist to a pluggable storage (localStorage in the app)
 *    with a bounded ring of seen ids;
 *  - every check is disclosed to the provenance registry by the caller.
 *
 * Honesty contract: active-fire pixels are screening alerts (~375 m VIIRS /
 * ~1 km MODIS centroids), not fire perimeters. Confidence varies with
 * cloud, smoke and sensor geometry; an alert must be verified on imagery
 * before it drives any field or legal action. Data is public domain
 * (NASA EOSDIS), attribution requested: NASA FIRMS.
 *
 * The API is documented CORS-open and key-free registration (free MAP_KEY
 * from the FIRMS site). All network failures surface as actionable errors.
 */

import { OverpassBbox } from "./overpass";

/* ------------------------------------------------------------------ */
/* Source identity                                                     */
/* ------------------------------------------------------------------ */

export const FIRMS_SERVICE = "NASA FIRMS active-fire detections";
export const FIRMS_LICENSE = "Public domain (NASA EOSDIS)";
export const FIRMS_ATTRIBUTION = "NASA FIRMS";

export const FIRMS_API_BASE =
  "https://firms.modaps.eosdis.nasa.gov/api/area/csv";
export const FIRMS_KEY_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/";

export const FIRMS_SOURCES = [
  { id: "VIIRS_SNPP_NRT", label: "VIIRS S-NPP · 375 m" },
  { id: "VIIRS_NOAA20_NRT", label: "VIIRS NOAA-20 · 375 m" },
  { id: "VIIRS_NOAA21_NRT", label: "VIIRS NOAA-21 · 375 m" },
  { id: "MODIS_NRT", label: "MODIS C6.1 · 1 km" },
] as const;

export type FirmsSource = (typeof FIRMS_SOURCES)[number]["id"];

export const FIRMS_SOURCE_IDS: FirmsSource[] = FIRMS_SOURCES.map((s) => s.id);

/** The area API accepts 1-10 day windows. */
export const MAX_DAY_RANGE = 10;

/* ------------------------------------------------------------------ */
/* Hash + ids                                                          */
/* ------------------------------------------------------------------ */

/** FNV-1a 32-bit (hex) — stable across sessions, no dependencies. */
export function firmsFnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Deterministic alert id. The SAME detection refetched later maps to the
 * SAME id (coords rounded to ~100 m, time kept raw) — enabling exact
 * new-alert diffs between checks.
 */
export function firmsAlertId(
  source: string,
  lat: number,
  lon: number,
  acqDate: string,
  acqTime: string,
): string {
  return `fa-${firmsFnv1a(
    `${source}|${lat.toFixed(3)}|${lon.toFixed(3)}|${acqDate}|${acqTime}`,
  )}`;
}

/* ------------------------------------------------------------------ */
/* URL + validation                                                    */
/* ------------------------------------------------------------------ */

/** Validate a MAP_KEY-shaped credential (non-empty token, sane length). */
export function validateMapKey(key: string): string | null {
  const k = key.trim();
  if (!k) return "A FIRMS MAP_KEY is required — get a free one from the FIRMS site";
  if (!/^[A-Za-z0-9-]{8,64}$/.test(k))
    return "The MAP_KEY looks malformed (expected an alphanumeric token)";
  return null;
}

/** Validate a watch bbox (finite, ordered, in-range) — no area cap here. */
export function validateWatchBbox(b: OverpassBbox): string | null {
  const nums = [b.lonMin, b.latMin, b.lonMax, b.latMax];
  if (nums.some((n) => !Number.isFinite(n))) return "bbox contains a non-finite coordinate";
  if (b.lonMin < -180 || b.lonMax > 180) return "longitude out of range";
  if (b.latMin < -85 || b.latMax > 85) return "latitude out of range";
  if (b.lonMin >= b.lonMax || b.latMin >= b.latMax) return "bbox order inverted";
  return null;
}

/** FIRMS area-CSV endpoint for one source and window. */
export function buildAreaCsvUrl(
  mapKey: string,
  source: FirmsSource,
  bbox: OverpassBbox,
  dayRange: number,
): string {
  const err = validateWatchBbox(bbox);
  if (err) throw new Error(`Invalid watch bbox: ${err}`);
  const days = Math.max(1, Math.min(MAX_DAY_RANGE, Math.floor(dayRange)));
  return (
    `${FIRMS_API_BASE}/${encodeURIComponent(mapKey.trim())}/${source}/` +
    `${bbox.lonMin},${bbox.latMin},${bbox.lonMax},${bbox.latMax}/${days}`
  );
}

/* ------------------------------------------------------------------ */
/* CSV parsing                                                         */
/* ------------------------------------------------------------------ */

export interface FireAlert {
  alertId: string;
  source: FirmsSource;
  lat: number;
  lon: number;
  /** bright_ti4 (VIIRS) / brightness (MODIS), Kelvin. */
  brightnessK: number | null;
  /** Acquisition date, YYYY-MM-DD. */
  acqDate: string;
  /** Normalized HH:MM. */
  acqTime: string;
  satellite: string;
  instrument: string;
  /** Raw confidence field (VIIRS may be l/n/h or 0-100 by version). */
  confidenceRaw: string;
  /** 0-100 when the source shipped numeric confidence. */
  confidencePct: number | null;
  /** Fire radiative power, MW. */
  frpMW: number | null;
  /** "D" or "N". */
  dayNight: string;
}

/** "1955" -> "19:55", "105" -> "01:05" (FIRMS strips leading zeros). */
export function normalizeAcqTime(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits || digits.length > 4) return "";
  const padded = digits.padStart(4, "0");
  return `${padded.slice(0, 2)}:${padded.slice(2)}`;
}

function num(v: string | undefined): number | null {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a FIRMS area CSV response (header-driven, tolerant of the VIIRS
 * and MODIS column sets). Malformed rows are skipped, never invented.
 */
export function parseFirmsCsv(csv: string, source: FirmsSource): FireAlert[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return []; // header only (or empty)

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const latC = col("latitude");
  const lonC = col("longitude");
  const brightC = header.includes("bright_ti4") ? col("bright_ti4") : col("brightness");
  const dateC = col("acq_date");
  const timeC = col("acq_time");
  const satC = col("satellite");
  const instrC = col("instrument");
  const confC = col("confidence");
  const frpC = col("frp");
  const dnC = col("daynight");
  if (latC < 0 || lonC < 0 || dateC < 0) return [];

  const alerts: FireAlert[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",");
    const lat = num(cells[latC]);
    const lon = num(cells[lonC]);
    if (lat === null || lon === null) continue;
    // Geographically impossible values are corrupt rows, not alerts.
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const acqDate = (cells[dateC] ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(acqDate)) continue;
    const acqTime = normalizeAcqTime(cells[timeC] ?? "");
    const confidenceRaw = (cells[confC] ?? "").trim();
    const confidenceNum = num(confidenceRaw);
    alerts.push({
      alertId: firmsAlertId(source, lat, lon, acqDate, cells[timeC] ?? ""),
      source,
      lat,
      lon,
      brightnessK: brightC >= 0 ? num(cells[brightC]) : null,
      acqDate,
      acqTime,
      satellite: (cells[satC] ?? "").trim(),
      instrument: (cells[instrC] ?? "").trim(),
      confidenceRaw,
      confidencePct: confidenceNum !== null ? confidenceNum : null,
      frpMW: frpC >= 0 ? num(cells[frpC]) : null,
      dayNight: (cells[dnC] ?? "").trim(),
    });
  }
  return alerts;
}

/** Newest first (acqDate, then acqTime). */
export function sortAlerts(alerts: FireAlert[]): FireAlert[] {
  return [...alerts].sort((a, b) => {
    const d = b.acqDate.localeCompare(a.acqDate);
    if (d !== 0) return d;
    return (b.acqTime || "").localeCompare(a.acqTime || "");
  });
}

/* ------------------------------------------------------------------ */
/* Watchlist store (pluggable storage)                                 */
/* ------------------------------------------------------------------ */

export interface FireWatchlist {
  id: string;
  name: string;
  bbox: OverpassBbox;
  sources: FirmsSource[];
  /** Window per check, 1-10 days. */
  dayRange: number;
  createdAt: string;
  lastCheckedAt: string | null;
  lastTotal: number | null;
  /** Ring of alert ids already seen by previous checks. */
  seenIds: string[];
}

export interface WatchlistStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const WATCHLIST_STORAGE_KEY = "metardu.firms.watchlists.v1";
export const MAPKEY_STORAGE_KEY = "metardu.firms.mapkey";

/** Watchlists whose bbox is inside this many km of the document scope. */
export function makeWatchlist(
  name: string,
  bbox: OverpassBbox,
  sources: FirmsSource[],
  dayRange: number,
  id?: string,
): FireWatchlist {
  const genId = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? `fw-${crypto.randomUUID().slice(0, 8)}`
      : `fw-${Date.now().toString(36)}`;
  return {
    id: id ?? genId(),
    name,
    bbox,
    sources,
    dayRange: Math.max(1, Math.min(MAX_DAY_RANGE, Math.floor(dayRange))),
    createdAt: new Date().toISOString(),
    lastCheckedAt: null,
    lastTotal: null,
    seenIds: [],
  };
}

export function loadWatchlists(store: WatchlistStorage | null): FireWatchlist[] {
  if (!store) return [];
  const raw = store.getItem(WATCHLIST_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (w): w is FireWatchlist =>
        w && typeof w.id === "string" && Array.isArray(w.sources) && w.bbox,
    );
  } catch {
    return []; // corrupt state never blocks the panel
  }
}

export function saveWatchlists(store: WatchlistStorage | null, lists: FireWatchlist[]): void {
  if (!store) return;
  store.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(lists));
}

/** Cap the seen-id ring (drop oldest first). */
export function trimSeenIds(ids: string[], cap = 4000): string[] {
  return ids.length > cap ? ids.slice(ids.length - cap) : ids;
}

/** Alerts not present in the watchlist's seen ring. */
export function diffAlerts(list: FireWatchlist, alerts: FireAlert[]): FireAlert[] {
  const seen = new Set(list.seenIds);
  return alerts.filter((a) => !seen.has(a.alertId));
}

/** Merge a completed check into the watchlist (pure — returns a new object). */
export function applyCheck(
  list: FireWatchlist,
  alerts: FireAlert[],
  checkedAt: string,
): FireWatchlist {
  const seen = new Set(list.seenIds);
  for (const a of alerts) seen.add(a.alertId);
  return {
    ...list,
    lastCheckedAt: checkedAt,
    lastTotal: alerts.length,
    seenIds: trimSeenIds([...seen]),
  };
}

/* ------------------------------------------------------------------ */
/* Fetch + check orchestration                                         */
/* ------------------------------------------------------------------ */

export interface FirmsFetchOptions {
  mapKey: string;
  source: FirmsSource;
  bbox: OverpassBbox;
  dayRange: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface FirmsFetchResult {
  alerts: FireAlert[];
  endpoint: string;
  fetchedAt: string;
}

function mapKeyHintError(status: number | null, body?: string): Error {
  const invalid = body && /invalid|unauthorized|not\s+authorized/i.test(body);
  return new Error(
    invalid
      ? "FIRMS rejected the MAP_KEY — check it or get a free key from firms.modaps.eosdis.nasa.gov/api/area/"
      : `FIRMS request failed${status ? ` (HTTP ${status})` : ""} — the service may be busy or unreachable from this network`,
  );
}

/** Fetch one source's CSV window. Throws actionable errors. */
export async function fetchFirmsAlerts(opts: FirmsFetchOptions): Promise<FirmsFetchResult> {
  const endpoint = buildAreaCsvUrl(opts.mapKey, opts.source, opts.bbox, opts.dayRange);
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  let status: number | null = null;
  try {
    const res = await doFetch(endpoint, { signal: controller.signal });
    status = res.status;
    const body = await res.text();
    if (!res.ok) throw mapKeyHintError(status, body);
    if (/^invalid/i.test(body.trim())) throw mapKeyHintError(null, body);
    return {
      alerts: parseFirmsCsv(body, opts.source),
      endpoint,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes("MAP_KEY")) throw err;
    if (controller.signal.aborted)
      throw new Error(`FIRMS request timed out after ${opts.timeoutMs ?? 20_000} ms`);
    if (err instanceof TypeError)
      throw new Error(
        "FIRMS is unreachable from this browser (network or CORS block) — check connectivity",
      );
    throw err instanceof Error ? err : mapKeyHintError(status);
  } finally {
    clearTimeout(timer);
  }
}

export interface CheckOutcome {
  /** All alerts in the current window (union across sources, newest first). */
  alerts: FireAlert[];
  /** Subset not seen by any earlier check. */
  newAlerts: FireAlert[];
  checkedAt: string;
  endpoints: string[];
}

/** Run a check: fetch every configured source, diff against the seen ring. */
export async function checkWatchlist(
  list: FireWatchlist,
  mapKey: string,
  fetchImpl?: typeof fetch,
): Promise<CheckOutcome> {
  if (list.sources.length === 0) throw new Error("Watchlist has no fire sources selected");
  const keyErr = validateMapKey(mapKey);
  if (keyErr) throw new Error(keyErr);

  const results = await Promise.all(
    list.sources.map((source) =>
      fetchFirmsAlerts({ mapKey, source, bbox: list.bbox, dayRange: list.dayRange, fetchImpl }),
    ),
  );
  const checkedAt = new Date().toISOString();
  const alerts = sortAlerts(results.flatMap((r) => r.alerts));
  return {
    alerts,
    newAlerts: diffAlerts(list, alerts),
    checkedAt,
    endpoints: results.map((r) => r.endpoint),
  };
}
