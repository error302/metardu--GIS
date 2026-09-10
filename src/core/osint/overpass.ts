/**
 * OSINT Overpass connector — OpenStreetMap as a verifiable external source.
 *
 * Purpose: pull named, tagged ground context (buildings, roads, watercourses,
 * land use, places) around a job extent into the workstation as coded survey
 * vertices, exactly like a file import — so the whole downstream machinery
 * (field-to-finish coding, canvas rendering, attribute table, composer
 * layers) treats it as data, not as a picture.
 *
 * Honesty contract:
 *  - OSM is NOT survey-grade. Every import is disclosed as "indicative
 *    context" and the source (endpoint, license, timestamp, feature count)
 *    is recorded into the provenance registry.
 *  - The query is deterministic: same bbox + same presets = same query text.
 *  - Relations (multipolygon landuse, route masters) are intentionally not
 *    assembled in v1 — the parser reports how many were skipped instead of
 *    inventing a partial geometry.
 */

import { FeatureCategory, SurveyPoint } from "../../types/spatial";

/* ------------------------------------------------------------------ */
/* Source identity                                                     */
/* ------------------------------------------------------------------ */

/** Public endpoints, tried in order (first success wins). */
export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
] as const;

export const OSM_SERVICE = "OpenStreetMap (Overpass API)";
export const OSM_LICENSE = "ODbL 1.0";
export const OSM_ATTRIBUTION = "© OpenStreetMap contributors";

/* ------------------------------------------------------------------ */
/* Bounding box model                                                  */
/* ------------------------------------------------------------------ */

export interface OverpassBbox {
  lonMin: number;
  latMin: number;
  lonMax: number;
  latMax: number;
}

/** Upper bound on query area: ~1° x 1° (≈111 km square at the equator). */
const MAX_SPAN_DEG = 1.0;
const LAT_LIMIT = 85.0;

/** Validate a query bbox; returns a human error or null when usable. */
export function validateBbox(b: OverpassBbox): string | null {
  const nums = [b.lonMin, b.latMin, b.lonMax, b.latMax];
  if (nums.some((n) => !Number.isFinite(n))) return "bbox contains a non-finite coordinate";
  if (b.lonMin < -180 || b.lonMax > 180 || b.lonMin > 180 || b.lonMax < -180)
    return "longitude out of range [-180, 180]";
  if (b.latMin < -LAT_LIMIT || b.latMax > LAT_LIMIT || b.latMin >= b.latMax)
    return "latitude out of range or inverted";
  if (b.lonMin >= b.lonMax) return "longitude range inverted";
  if (b.lonMax - b.lonMin > MAX_SPAN_DEG || b.latMax - b.latMin > MAX_SPAN_DEG)
    return `query area too large (max ${MAX_SPAN_DEG}° per axis) — narrow the scope or lower the radius`;
  return null;
}

/**
 * Expand a bbox by a ground radius (km) on every side, clamped to the
 * valid ranges. Latitude grows by radius/111.32; longitude by the same
 * ground distance divided by the cosine of the centroid latitude.
 */
export function expandBboxRadius(b: OverpassBbox, radiusKm: number): OverpassBbox {
  const dLat = radiusKm / 111.32;
  const latCenter = (b.latMin + b.latMax) / 2;
  const cos = Math.max(0.1, Math.cos((latCenter * Math.PI) / 180));
  const dLon = radiusKm / (111.32 * cos);
  return {
    lonMin: Math.max(-180, b.lonMin - dLon),
    latMin: Math.max(-LAT_LIMIT, b.latMin - dLat),
    lonMax: Math.min(180, b.lonMax + dLon),
    latMax: Math.min(LAT_LIMIT, b.latMax + dLat),
  };
}

/** Approximate ground size of a bbox (km) — for scope disclosure lines. */
export function bboxSizeKm(b: OverpassBbox): { widthKm: number; heightKm: number } {
  const latCenter = (b.latMin + b.latMax) / 2;
  const cos = Math.cos((latCenter * Math.PI) / 180);
  return {
    widthKm: (b.lonMax - b.lonMin) * 111.32 * cos,
    heightKm: (b.latMax - b.latMin) * 111.32,
  };
}

/* ------------------------------------------------------------------ */
/* Presets — what the fetcher asks Overpass for                        */
/* ------------------------------------------------------------------ */

export type OverpassPreset = "buildings" | "roads" | "water" | "landuse" | "places";

export interface OverpassPresetSpec {
  id: OverpassPreset;
  label: string;
  description: string;
  /** Overpass QL selector fragments (element type + tag filter). */
  selectors: string[];
  /** Default SurveyPoint category for features returned by this preset. */
  category: FeatureCategory;
}

/** Canonical order — the query builder iterates this array, never input order. */
export const OVERPASS_PRESET_ORDER: OverpassPreset[] = [
  "buildings",
  "roads",
  "water",
  "landuse",
  "places",
];

export const OVERPASS_PRESETS: Record<OverpassPreset, OverpassPresetSpec> = {
  buildings: {
    id: "buildings",
    label: "Buildings & structures",
    description: "Mapped building footprints — compare against the surveyed plan.",
    selectors: ['way["building"]'],
    category: "building",
  },
  roads: {
    id: "roads",
    label: "Roads & tracks",
    description: "Highways, access roads and tracks from the OSM road network.",
    selectors: ['way["highway"]'],
    category: "road",
  },
  water: {
    id: "water",
    label: "Watercourses & waterbodies",
    description: "Rivers, streams and drainage — riparian reserve context.",
    selectors: ['way["waterway"]', 'way["natural"="water"]'],
    category: "water",
  },
  landuse: {
    id: "landuse",
    label: "Land use",
    description: "Farmland, forest, residential and industrial zoning polygons.",
    selectors: ['way["landuse"]'],
    category: "vegetation",
  },
  places: {
    id: "places",
    label: "Named places",
    description: "Villages, towns and neighbourhoods as labeled points.",
    selectors: ['node["place"]'],
    category: "settlement",
  },
};

/* ------------------------------------------------------------------ */
/* Query builder (deterministic)                                       */
/* ------------------------------------------------------------------ */

/** Build the Overpass QL query. Throws when bbox/presets are unusable. */
export function buildOverpassQuery(
  bbox: OverpassBbox,
  presets: OverpassPreset[],
  limit = 20000,
): string {
  const err = validateBbox(bbox);
  if (err) throw new Error(`Invalid query bbox: ${err}`);
  if (presets.length === 0) throw new Error("Select at least one feature preset");

  const selectors: string[] = [];
  for (const id of OVERPASS_PRESET_ORDER) {
    if (!presets.includes(id)) continue;
    selectors.push(...OVERPASS_PRESETS[id].selectors);
  }

  // Global bbox setting applies to every statement; elements print with
  // inline geometry (`out geom`) so no node-index resolution round-trip.
  return (
    `[out:json][timeout:25][bbox:${bbox.latMin},${bbox.lonMin},${bbox.latMax},${bbox.lonMax}];` +
    `(${selectors.join(";")};);` +
    `out geom ${Math.max(1, Math.floor(limit))};`
  );
}

/** Human-readable scope line for notes and provenance records. */
export function describeQueryScope(bbox: OverpassBbox, presets: OverpassPreset[]): string {
  const size = bboxSizeKm(bbox);
  const names = OVERPASS_PRESET_ORDER.filter((p) => presets.includes(p)).map(
    (p) => OVERPASS_PRESETS[p].label.toLowerCase(),
  );
  return `${names.join(", ")} — bbox [${bbox.latMin.toFixed(4)}, ${bbox.lonMin.toFixed(4)}, ${bbox.latMax.toFixed(4)}, ${bbox.lonMax.toFixed(4)}] ≈ ${size.widthKm.toFixed(1)} × ${size.heightKm.toFixed(1)} km`;
}

/* ------------------------------------------------------------------ */
/* Response parser                                                     */
/* ------------------------------------------------------------------ */

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

export interface OsmFeature {
  osmType: "node" | "way";
  osmId: number;
  kind: "point" | "line" | "polygon";
  /** point: one part, one coord · line: polyline parts · polygon: rings */
  parts: [number, number][][];
  tags: Record<string, string>;
}

export interface OverpassParseResult {
  features: OsmFeature[];
  /** Relations are not assembled in v1 — counted, never fabricated. */
  skippedRelations: number;
  /** Ways whose geometry was missing and could not be resolved from nodes. */
  unresolvedWays: number;
}

/** Parse an Overpass `out geom` JSON response into normalized features. */
export function parseOverpassResponse(json: unknown): OverpassParseResult {
  const doc = json as { elements?: OverpassElement[] } | null;
  if (!doc || !Array.isArray(doc.elements)) {
    throw new Error("Response is not Overpass JSON (missing elements array)");
  }

  // Node index for ways that ship `nodes` without inline `geometry`
  // (e.g. older mirrors or `out body` fallbacks).
  const nodeIndex = new Map<number, [number, number]>();
  for (const el of doc.elements) {
    if (el.type === "node" && typeof el.lat === "number" && typeof el.lon === "number") {
      nodeIndex.set(el.id, [el.lon, el.lat]);
    }
  }

  const features: OsmFeature[] = [];
  let skippedRelations = 0;
  let unresolvedWays = 0;

  for (const el of doc.elements) {
    if (!el.tags || Object.keys(el.tags).length === 0) continue; // untagged helpers

    if (el.type === "node") {
      if (typeof el.lat !== "number" || typeof el.lon !== "number") continue;
      features.push({
        osmType: "node",
        osmId: el.id,
        kind: "point",
        parts: [[[el.lon, el.lat]]],
        tags: el.tags,
      });
      continue;
    }

    if (el.type === "way") {
      let coords: [number, number][] | null = null;
      if (Array.isArray(el.geometry) && el.geometry.length > 0) {
        coords = el.geometry
          .filter((g) => typeof g.lat === "number" && typeof g.lon === "number")
          .map((g) => [g.lon, g.lat] as [number, number]);
      } else if (Array.isArray(el.nodes) && el.nodes.length > 0) {
        coords = el.nodes.map((id) => nodeIndex.get(id)).filter(Boolean) as [number, number][];
      }
      if (!coords || coords.length < 2) {
        unresolvedWays++;
        continue;
      }
      const closed =
        coords.length >= 4 &&
        coords[0][0] === coords[coords.length - 1][0] &&
        coords[0][1] === coords[coords.length - 1][1];
      features.push({
        osmType: "way",
        osmId: el.id,
        kind: closed ? "polygon" : "line",
        parts: [coords],
        tags: el.tags,
      });
      continue;
    }

    if (el.type === "relation") skippedRelations++;
  }

  return { features, skippedRelations, unresolvedWays };
}

/* ------------------------------------------------------------------ */
/* Tag → survey mapping                                                */
/* ------------------------------------------------------------------ */

const VEGETATION_LANDUSE = new Set([
  "forest",
  "wood",
  "farmland",
  "farmyard",
  "grass",
  "meadow",
  "orchard",
  "greenhouse_horticulture",
]);

/** Category, raw code and description from OSM tags (priority-ordered). */
export function osmCategoryAndCode(tags: Record<string, string>): {
  category: FeatureCategory;
  rawCode: string;
  description: string;
} {
  let kind: { category: FeatureCategory; rawCode: string; description: string };
  if (tags.place)
    kind = { category: "settlement", rawCode: `place=${tags.place}`, description: `Place (${tags.place})` };
  else if (tags.building)
    kind = {
      category: "building",
      rawCode: `building=${tags.building}`,
      description: `Building${tags.building !== "yes" ? ` (${tags.building})` : ""}`,
    };
  else if (tags.highway)
    kind = { category: "road", rawCode: `highway=${tags.highway}`, description: `Highway (${tags.highway})` };
  else if (tags.waterway)
    kind = { category: "water", rawCode: `waterway=${tags.waterway}`, description: `Waterway (${tags.waterway})` };
  else if (tags.natural === "water" || tags.natural === "wetland")
    kind = { category: "water", rawCode: `natural=${tags.natural}`, description: `Water body (${tags.natural})` };
  else if (tags.landuse) {
    const cat: FeatureCategory = VEGETATION_LANDUSE.has(tags.landuse) ? "vegetation" : "settlement";
    kind = { category: cat, rawCode: `landuse=${tags.landuse}`, description: `Land use (${tags.landuse})` };
  } else {
    const firstKey = Object.keys(tags)[0] ?? "feature";
    kind = { category: "terrain", rawCode: `osm=${tags[firstKey] ?? firstKey}`, description: "OSM feature" };
  }
  // A named feature wears its name — the attribute table reads descriptions.
  return tags.name ? { ...kind, description: tags.name } : kind;
}

/** Attributes worth keeping on survey points (bounded, deterministic order). */
const KEEP_TAGS = [
  "name",
  "building",
  "highway",
  "waterway",
  "natural",
  "landuse",
  "place",
  "surface",
  "service",
  "width",
  "lanes",
  "bridge",
  "operator",
  "barrier",
];

/** Convert parsed OSM features into coded survey vertices (import parity). */
export function featuresToSurveyPoints(features: OsmFeature[], layerBase: string): SurveyPoint[] {
  const safeBase = layerBase.replace(/\s+/g, "_") || "osm";
  const out: SurveyPoint[] = [];

  for (const f of features) {
    const { category, rawCode, description } = osmCategoryAndCode(f.tags);
    const props: Record<string, string | number | boolean> = {};
    let kept = 0;
    for (const key of KEEP_TAGS) {
      if (kept >= 14) break;
      const v = f.tags[key];
      if (v !== undefined && v !== "") {
        props[key] = v;
        kept++;
      }
    }

    if (f.kind === "point") {
      out.push({
        id: `${safeBase}-${f.osmType[0]}${f.osmId}`,
        easting: f.parts[0][0][0],
        northing: f.parts[0][0][1],
        elevation: 0,
        rawCode,
        category,
        description,
        ...(kept > 0 ? { properties: props } : {}),
      });
      continue;
    }

    // Line/polygon vertices — field-to-finish re-links chains from codes,
    // matching the Shapefile/GeoJSON vertex import convention.
    f.parts.forEach((part, pi) => {
      part.forEach(([lon, lat], vi) => {
        out.push({
          id: `${safeBase}-${f.osmType[0]}${f.osmId}${pi > 0 ? `-p${pi + 1}` : ""}-v${vi + 1}`,
          easting: lon,
          northing: lat,
          elevation: 0,
          rawCode,
          category,
          description: `${description} (v${vi + 1})`,
          ...(kept > 0 ? { properties: props } : {}),
        });
      });
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Fetch orchestration (endpoint failover)                             */
/* ------------------------------------------------------------------ */

export interface OverpassFetchOptions {
  bbox: OverpassBbox;
  presets: OverpassPreset[];
  limit?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  endpoints?: readonly string[];
}

export interface OverpassFetchResult {
  parse: OverpassParseResult;
  endpoint: string;
  query: string;
  fetchedAt: string;
}

/**
 * POST the query to the first responsive endpoint. Network and HTTP errors
 * fail over to the next mirror; every attempt is bounded by the timeout.
 */
export async function fetchOverpassFeatures(
  opts: OverpassFetchOptions,
): Promise<OverpassFetchResult> {
  const query = buildOverpassQuery(opts.bbox, opts.presets, opts.limit);
  const endpoints = opts.endpoints ?? OVERPASS_ENDPOINTS;
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const errors: string[] = [];

  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(endpoint, {
        method: "POST",
        body: `data=${encodeURIComponent(query)}`,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: controller.signal,
      });
      if (!res.ok) {
        errors.push(`${endpoint}: HTTP ${res.status}`);
        continue;
      }
      const json = await res.json();
      return {
        parse: parseOverpassResponse(json),
        endpoint,
        query,
        fetchedAt: new Date().toISOString(),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${endpoint}: ${controller.signal.aborted ? `timeout after ${timeoutMs} ms` : msg}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`All Overpass endpoints failed — ${errors.join(" | ")}`);
}
