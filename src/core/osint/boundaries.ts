/**
 * OSINT jurisdictional context — geoBoundaries administrative boundaries.
 *
 * Purpose: pull authoritative-open admin boundary geometry (country,
 * province, county/district level) around the job as context vertices,
 * so plans and atlases can reference the surrounding jurisdictional
 * frame without asserting anything about the surveyed boundary itself.
 *
 * Source: geoBoundaries.org gbOpen collection (CC-BY 4.0 / Public Domain
 * per dataset — the license string comes from the metadata response and
 * is recorded verbatim). Metadata API: /api/current/gbOpen/{ISO3}/{ADM}/,
 * geometry: the pinned `simplifiedGeometryGeoJSON` download (an order of
 * magnitude smaller than the full-resolution file, appropriate for
 * context work).
 *
 * Honesty contract:
 *  - Boundaries are clipped to the query bbox when one is supplied; the
 *    disclosure line states what was kept and what was dropped.
 *  - A hard vertex cap bounds the import; when the cap truncates the
 *    geometry the panel discloses it rather than failing silently.
 *  - Never survey-grade: statutory boundary determination comes from
 *    licensed cadastral products, not from open context layers.
 */

import { SurveyPoint } from "../../types/spatial";

/* ------------------------------------------------------------------ */
/* Source identity                                                     */
/* ------------------------------------------------------------------ */

export const GB_API_BASE = "https://www.geoboundaries.org/api/current/gbOpen";
export const GB_SERVICE = "geoBoundaries (gbOpen)";
export const GB_ATTRIBUTION = "geoBoundaries contributors (geoBoundaries.org)";
export const ADM_LEVELS = ["ADM0", "ADM1", "ADM2"] as const;
export type AdmLevel = (typeof ADM_LEVELS)[number];
/** Hard cap on ingested vertices (disclosed when hit). */
export const GB_VERTEX_CAP = 60_000;
/** Refuse downloads beyond this size (the metadata gives no length). */
const GB_MAX_BYTES = 48 * 1024 * 1024;

export interface GBMetadata {
  boundaryId: string;
  iso: string;
  adm: AdmLevel;
  /** Year the boundary geometry represents. */
  year: string;
  /** License string exactly as published (recorded verbatim). */
  license: string;
  /** Pinned simplified-geometry download URL. */
  simplifiedUrl: string;
  metadataUrl: string;
}

export interface Bbox {
  lonMin: number;
  latMin: number;
  lonMax: number;
  latMax: number;
}

export interface GBFetchResult {
  metadata: GBMetadata;
  /** Coded vertices (WGS84 lon in easting, lat in northing — the OSINT
      import path reprojects into the working CRS). */
  points: SurveyPoint[];
  /** Feature/unit names present (for the UI summary). */
  unitNames: string[];
  /** Vertices dropped by the bbox clip. */
  clippedVertices: number;
  /** True when the vertex cap truncated the geometry. */
  truncated: boolean;
  endpoint: string;
  geometryUrl: string;
  fetchedAt: string;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export function validateIso3(iso: string): string | null {
  if (!/^[a-zA-Z]{3}$/.test(iso)) return "Use a 3-letter ISO 3166-1 alpha-3 code (e.g. KEN)";
  return null;
}

/* ------------------------------------------------------------------ */
/* Metadata                                                            */
/* ------------------------------------------------------------------ */

interface GBApiRecord {
  boundaryID?: string;
  boundaryISO?: string;
  boundaryType?: string;
  boundaryYearRepresented?: string | number;
  boundaryLicense?: string;
  simplifiedGeometryGeoJSON?: string;
  gjDownloadURL?: string;
}

export async function fetchBoundaryMetadata(
  iso: string,
  adm: AdmLevel,
  deps: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<GBMetadata> {
  const isoErr = validateIso3(iso);
  if (isoErr) throw new Error(isoErr);
  if (!ADM_LEVELS.includes(adm)) throw new Error(`unsupported admin level ${adm}`);

  const metadataUrl = `${GB_API_BASE}/${iso.toUpperCase()}/${adm}/`;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? 20_000);
  let res: Response;
  try {
    res = await fetchImpl(metadataUrl, { signal: ctrl.signal });
  } catch (e) {
    clearTimeout(timer);
    throw new Error(`geoBoundaries metadata failed: ${e instanceof Error ? e.message : "network error"}`);
  }
  clearTimeout(timer);
  if (!res.ok) {
    throw new Error(
      `geoBoundaries metadata for ${iso.toUpperCase()} ${adm} returned HTTP ${res.status}` +
        (res.status === 404 ? " (no such boundary — check the ISO code and level)" : ""),
    );
  }
  const rec = (await res.json()) as GBApiRecord;
  const simplifiedUrl = rec.simplifiedGeometryGeoJSON ?? rec.gjDownloadURL;
  if (!simplifiedUrl) throw new Error("metadata response carried no geometry download URL");

  return {
    boundaryId: String(rec.boundaryID ?? `${iso.toUpperCase()}-${adm}`),
    iso: iso.toUpperCase(),
    adm,
    year: String(rec.boundaryYearRepresented ?? "unknown"),
    license: String(rec.boundaryLicense ?? "unspecified"),
    simplifiedUrl,
    metadataUrl,
  };
}

/* ------------------------------------------------------------------ */
/* Geometry → context vertices                                         */
/* ------------------------------------------------------------------ */

type Ring = [number, number][];

/** Flatten Polygon/MultiPolygon coordinates into outer+inner rings. */
function geometryRings(geom: { type: string; coordinates: unknown }): Ring[] {
  if (geom.type === "Polygon") return geom.coordinates as Ring[];
  if (geom.type === "MultiPolygon") {
    const polys = geom.coordinates as Ring[][];
    return polys.flat();
  }
  return [];
}

function ringBbox(ring: Ring): Bbox | null {
  let lonMin = Infinity, latMin = Infinity, lonMax = -Infinity, latMax = -Infinity;
  for (const [lon, lat] of ring) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (lon < lonMin) lonMin = lon;
    if (lon > lonMax) lonMax = lon;
    if (lat < latMin) latMin = lat;
    if (lat > latMax) latMax = lat;
  }
  if (!Number.isFinite(lonMin)) return null;
  return { lonMin, latMin, lonMax, latMax };
}

function bboxesIntersect(a: Bbox, b: Bbox): boolean {
  return a.lonMin <= b.lonMax && a.lonMax >= b.lonMin && a.latMin <= b.latMax && a.latMax >= b.latMin;
}

const inBbox = (lon: number, lat: number, b: Bbox) =>
  lon >= b.lonMin && lon <= b.lonMax && lat >= b.latMin && lat <= b.latMax;

/**
 * Fetch a boundary context: metadata, then the pinned simplified GeoJSON,
 * converted to coded survey vertices ("boundary" category). When clipBbox
 * is supplied, only rings intersecting it contribute, and only their
 * vertices inside it are kept — both counts disclosed.
 */
export async function fetchBoundaryContext(
  iso: string,
  adm: AdmLevel,
  clipBbox: Bbox | null,
  deps: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    vertexCap?: number;
    /** Metadata injection (tests / offline use). */
    metadata?: GBMetadata;
  } = {},
): Promise<GBFetchResult> {
  const metadata = deps.metadata ?? (await fetchBoundaryMetadata(iso, adm, deps));
  const fetchImpl = deps.fetchImpl ?? fetch;
  const cap = deps.vertexCap ?? GB_VERTEX_CAP;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? 120_000);
  let res: Response;
  try {
    res = await fetchImpl(metadata.simplifiedUrl, { signal: ctrl.signal });
  } catch (e) {
    clearTimeout(timer);
    throw new Error(`boundary geometry download failed: ${e instanceof Error ? e.message : "network error"}`);
  }
  clearTimeout(timer);
  if (!res.ok) {
    throw new Error(`boundary geometry download returned HTTP ${res.status}`);
  }
  const lenHeader = res.headers.get("content-length");
  if (lenHeader && Number(lenHeader) > GB_MAX_BYTES) {
    throw new Error(
      `boundary geometry too large (${(Number(lenHeader) / 1048576).toFixed(0)} MB) — choose a smaller admin level`,
    );
  }
  const gj = (await res.json()) as {
    type?: string;
    features?: { geometry?: { type: string; coordinates: unknown }; properties?: Record<string, unknown> }[];
  };
  if (gj.type !== "FeatureCollection" || !Array.isArray(gj.features)) {
    throw new Error("boundary download is not a GeoJSON FeatureCollection");
  }

  const points: SurveyPoint[] = [];
  const unitNames: string[] = [];
  let clippedVertices = 0;
  let truncated = false;

  for (const feature of gj.features) {
    if (truncated) break;
    const props = feature.properties ?? {};
    const name = String(props.shapeName ?? props.shapeISO ?? "Unnamed unit");
    const shapeId = String(props.shapeID ?? name);
    const rings = feature.geometry ? geometryRings(feature.geometry) : [];
    if (rings.length === 0) continue;

    let contributed = 0;
    for (const ring of rings) {
      if (truncated) break;
      if (clipBbox) {
        const rb = ringBbox(ring);
        if (!rb || !bboxesIntersect(rb, clipBbox)) {
          clippedVertices += ring.length;
          continue;
        }
      }
      for (let vi = 0; vi < ring.length; vi++) {
        const [lon, lat] = ring[vi];
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        if (clipBbox && !inBbox(lon, lat, clipBbox)) {
          clippedVertices++;
          continue;
        }
        if (points.length >= cap) {
          truncated = true;
          break;
        }
        points.push({
          id: `gb-${shapeId}-v${vi + 1}`,
          easting: lon,
          northing: lat,
          elevation: 0,
          rawCode: `GB-${metadata.adm}`,
          category: "boundary",
          description: `${name} (v${vi + 1})`,
          properties: {
            shapeName: name,
            shapeID: shapeId,
            adm: metadata.adm,
            year: metadata.year,
          },
        });
        contributed++;
      }
    }
    if (contributed > 0 && !unitNames.includes(name)) unitNames.push(name);
  }

  return {
    metadata,
    points,
    unitNames,
    clippedVertices,
    truncated,
    endpoint: metadata.metadataUrl,
    geometryUrl: metadata.simplifiedUrl,
    fetchedAt: new Date().toISOString(),
  };
}
