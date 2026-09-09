/**
 * Coordinate Reference System Engine (proj4-powered)
 * Real datum transforms replacing legacy linear approximations.
 */

import proj4 from "proj4";

export interface CRSDefinition {
  epsg: number;
  name: string;
  proj4: string;
  units: "m" | "degrees";
  region: string;
}

// Register EPSG definitions Kenya / East Africa
const DEFS: CRSDefinition[] = [
  {
    epsg: 4326,
    name: "WGS 84 Geographic",
    proj4: "+title=WGS 84 +proj=longlat +datum=WGS84 +units=degrees",
    units: "degrees",
    region: "Global",
  },
  {
    epsg: 21037,
    name: "Arc 1960 / UTM zone 37S",
    proj4: "+proj=utm +zone=37 +ellps=clrk80 +towgs84=-160,-6,-302,0,0,0,0 +units=m +south +no_defs",
    units: "m",
    region: "Kenya",
  },
  {
    epsg: 32637,
    name: "WGS 84 / UTM zone 37N",
    proj4: "+proj=utm +zone=37 +datum=WGS84 +units=m +no_defs",
    units: "m",
    region: "East Africa",
  },
  {
    epsg: 32636,
    name: "WGS 84 / UTM zone 36N",
    proj4: "+proj=utm +zone=36 +datum=WGS84 +units=m +no_defs",
    units: "m",
    region: "Ethiopia/Gambella",
  },
  {
    epsg: 3857,
    name: "Web Mercator",
    proj4: "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs",
    units: "m",
    region: "Web Basemaps",
  },
];

for (const d of DEFS) proj4.defs(`EPSG:${d.epsg}`, d.proj4);

/* ---------- Phase B: registry expansion ----------
   Full WGS84 UTM zone set (surveyor workhorse), plus Arc 1960 UTM zones for
   East Africa. Generated programmatically to keep this file honest.
   EPSG codes (real registry):
     WGS84 UTM N: 32601..32660   WGS84 UTM S: 32701..32760
     Arc 1960 UTM S: 21035/36/37   Arc 1960 UTM N: 21095/96/97  */
for (let zone = 1; zone <= 60; zone++) {
  for (const south of [false, true]) {
    const epsg = (south ? 32700 : 32600) + zone;
    if (DEFS.some((d) => d.epsg === epsg)) continue; // keep hand-curated metadata
    DEFS.push({
      epsg,
      name: `WGS 84 / UTM zone ${zone}${south ? "S" : "N"}`,
      proj4: `+proj=utm +zone=${zone}${south ? " +south" : ""} +datum=WGS84 +units=m +no_defs`,
      units: "m",
      region: south ? "Southern hemisphere" : "Northern hemisphere",
    });
  }
}
// Arc 1960 UTM — East African national grids (Clarke 1880, towgs84 3-param)
for (const [zone, south, epsg] of [
  [35, false, 21095],
  [36, false, 21096],
  [37, false, 21097],
  [35, true, 21035],
  [36, true, 21036],
  [37, true, 21037],
] as [number, boolean, number][]) {
  if (DEFS.some((d) => d.epsg === epsg)) continue;
  DEFS.push({
    epsg,
    name: `Arc 1960 / UTM zone ${zone}${south ? "S" : "N"}`,
    proj4: `+proj=utm +zone=${zone}${south ? " +south" : ""} +ellps=clrk80 +towgs84=-160,-6,-302,0,0,0,0 +units=m +no_defs`,
    units: "m",
    region: "East Africa",
  });
}

for (const d of DEFS) proj4.defs(`EPSG:${d.epsg}`, d.proj4);

/* ---------- Session CRS definitions (paste-EPSG / epsg.io lookup) ---------- */
const SESSION_DEFS_KEY = "metardu-crs-session-defs";
const sessionDefs: CRSDefinition[] = [];

/** Register a CRS definition for this session (and remember it offline). */
export function registerCrsDefinition(def: CRSDefinition, persist = true): CRSDefinition {
  if (!getCRS(def.epsg)) sessionDefs.push(def);
  proj4.defs(`EPSG:${def.epsg}`, def.proj4);
  if (persist && typeof localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(SESSION_DEFS_KEY);
      const arr: CRSDefinition[] = raw ? JSON.parse(raw) : [];
      if (!arr.some((d) => d.epsg === def.epsg)) {
        arr.push(def);
        localStorage.setItem(SESSION_DEFS_KEY, JSON.stringify(arr));
      }
    } catch {
      /* storage unavailable — session-only registration */
    }
  }
  return def;
}

/** Restore definitions fetched in previous sessions (offline-first). */
export function restoreSessionCrsDefinitions() {
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(SESSION_DEFS_KEY);
    if (!raw) return;
    for (const def of JSON.parse(raw) as CRSDefinition[]) {
      registerCrsDefinition(def, false);
    }
  } catch {
    /* ignore malformed cache */
  }
}
restoreSessionCrsDefinitions();

export function listSupportedEPSG(): CRSDefinition[] {
  return [...DEFS, ...sessionDefs];
}

export function getCRS(epsg: number): CRSDefinition | undefined {
  return (
    DEFS.find((d) => d.epsg === epsg) ?? sessionDefs.find((d) => d.epsg === epsg)
  );
}

/** Case-insensitive search over code, name and region. */
export function searchCrs(query: string, limit = 40): CRSDefinition[] {
  const q = query.trim().toLowerCase();
  if (!q) return listSupportedEPSG().slice(0, limit);
  const scored = listSupportedEPSG()
    .map((d) => {
      const code = String(d.epsg);
      const name = d.name.toLowerCase();
      const region = d.region.toLowerCase();
      let score = -1;
      if (code === q) score = 100;
      else if (code.startsWith(q)) score = 80;
      else if (name.includes(q)) score = 60;
      else if (region.includes(q)) score = 40;
      return { d, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.d.epsg - b.d.epsg)
    .slice(0, limit);
  return scored.map((x) => x.d);
}

/* ---------- Paste-EPSG resolution via epsg.io ---------- */

const EPSG_FETCH_TIMEOUT_MS = 8000;
const epsgFetches = new Map<number, Promise<CRSDefinition | null>>();

/**
 * Resolve an arbitrary EPSG code at runtime: known codes return instantly;
 * unknown codes fetch the proj4 string from epsg.io, validate it, register
 * it as a session definition (persisted to localStorage) and return it.
 * Returns null when the code is unknown or unreachable — the caller shows
 * the error; nothing silently falls back.
 */
export function resolveEpsg(code: number): Promise<CRSDefinition | null> {
  const known = getCRS(code);
  if (known) return Promise.resolve(known);
  if (!Number.isInteger(code) || code < 1000 || code > 32767) {
    return Promise.resolve(null);
  }
  const inflight = epsgFetches.get(code);
  if (inflight) return inflight;
  const p = (async () => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), EPSG_FETCH_TIMEOUT_MS);
      const res = await fetch(`https://epsg.io/${code}.proj4`, {
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      let def = (await res.text()).trim();
      if (!def.startsWith("+")) return null; // epsg.io error page / garbage
      def = def.replace(/\s*\+type=crs/, ""); // proj4js doesn't need it
      // Register, then validate with a real round-trip — proj4 throws on
      // malformed definitions, which the catch turns into a clean null.
      proj4.defs(`EPSG:${code}`, def);
      proj4(`EPSG:${code}`, "EPSG:4326", [0, 0]);
      proj4("EPSG:4326", `EPSG:${code}`, [36.8, -1.3]);
      const units: "m" | "degrees" = /\+units=m\b|\+proj=merc|\+proj=utm/.test(def)
        ? "m"
        : /\+proj=longlat/.test(def)
          ? "degrees"
          : "m";
      const crsDef: CRSDefinition = {
        epsg: code,
        name: `EPSG:${code} (fetched)`,
        proj4: def,
        units,
        region: "Session definition",
      };
      registerCrsDefinition(crsDef);
      return crsDef;
    } catch {
      return null;
    } finally {
      epsgFetches.delete(code);
    }
  })();
  epsgFetches.set(code, p);
  return p;
}

/** Parse a metadata.crs string into an EPSG code */
export function crsEpsgFromMetadata(crs: string): number {
  if (!crs) return 21037;
  const m = /EPSG[:\s]*(\d{4,5})/i.exec(crs);
  if (m) return Number(m[1]);
  if (crs.includes("21037") || crs.includes("Arc 1960") || /37S/i.test(crs)) return 21037;
  if (crs.includes("32636") || /36N/i.test(crs)) return 32636;
  if (crs.includes("32637") || /37N/i.test(crs)) return 32637;
  if (crs.includes("3857") || /mercator/i.test(crs)) return 3857;
  if (crs.includes("4326") || /wgs\s*84\s*geo/i.test(crs)) return 4326;
  return 21037;
}
export const CRS_EPSG_FROM_METADATA = crsEpsgFromMetadata;

/** Transform [easting/lon, northing/lat] between supported CRSs */
export function transform(fromEpsg: number, toEpsg: number, x: number, y: number): [number, number] {
  return proj4(`EPSG:${fromEpsg}`, `EPSG:${toEpsg}`, [x, y]);
}

/**
 * Transform from a raw proj4 definition (e.g. derived from a .prj WKT that
 * matched no registry code) into a registered target CRS.
 */
export function transformFromDef(
  fromDef: string,
  toEpsg: number,
  x: number,
  y: number,
): [number, number] {
  return proj4(fromDef, `EPSG:${toEpsg}`, [x, y]);
}

export function toWGS84(epsg: number, x: number, y: number): [number, number] {
  return transform(epsg, 4326, x, y);
}

export function fromWGS84(epsg: number, lon: number, lat: number): [number, number] {
  return transform(4326, epsg, lon, lat);
}

/**
 * Geoid separation (H = h − N) lookup.
 *
 * Active model precedence:
 *   1. Real EGM2008 2.5' grid (src/core/geoid/grid.ts registers a sampler on
 *      lazy load) — statutory-grade.
 *   2. Parametric fallback: inverse-distance interpolation of six EGM2008
 *      anchor values across East Africa. The geoid over East Africa is
 *      NEGATIVE (−5 to −45 m; the region sits on the flank of the Indian
 *      Ocean geoid low). Planning-grade only, disclosed as such.
 */
export type GeoidModel = "EGM2008" | "PARAMETRIC";

let externalGrid: ((lat: number, lon: number) => number | null) | null = null;
let externalGridName: string | null = null;

/** Geoid provenance readout for UI/status disclosure. */
export function getGeoidProvenance(): { model: string; statutory: boolean } {
  return externalGrid
    ? { model: externalGridName ?? "EGM2008 grid", statutory: true }
    : { model: "parametric (regional anchors)", statutory: false };
}

export function registerGeoidGridLoader(
  loader: (lat: number, lon: number) => number | null,
  name = "EGM2008 2.5' grid",
) {
  externalGrid = loader;
  externalGridName = name;
}

/* Regional EGM2008 anchor values (lat, lon, N metres) — validated against both
   EGM2008 2.5' and EGM96 15' NGA grids (mutual agreement ±0.9 m). */
const GEOID_ANCHORS: [number, number, number][] = [
  [9.03, 38.74, -7.04], // Addis Ababa
  [-1.95, 30.06, -8.82], // Kigali
  [0.35, 32.58, -12.97], // Kampala / L. Victoria
  [0.0, 36.82, -13.32], // Nairobi area
  [-4.05, 39.67, -29.2], // Mombasa (coast)
  [-6.8, 39.28, -27.67], // Dar es Salaam
];

export function geoidUndulation(lat: number, lon: number, model: GeoidModel = "EGM2008"): number {
  if (externalGrid && model === "EGM2008") {
    const n = externalGrid(lat, lon);
    if (n !== null) return n;
  }
  // Parametric fallback — planning-grade, disclosed via getGeoidProvenance().
  let wSum = 0;
  let nSum = 0;
  for (const [aLat, aLon, aN] of GEOID_ANCHORS) {
    const dLat = (lat - aLat) * 111.32;
    const dLon = (lon - aLon) * 111.32 * Math.cos((((lat + aLat) / 2) * Math.PI) / 180);
    const d2 = Math.max(dLat * dLat + dLon * dLon, 100); // floor 10 km to avoid singularity
    const w = 1 / d2;
    wSum += w;
    nSum += w * aN;
  }
  return nSum / wSum;
}

export function reduceOrthometricHeight(ellipsoidalH: number, lat: number, lon: number): { orthometricH: number; geoidN: number } {
  const N = geoidUndulation(lat, lon);
  return { orthometricH: ellipsoidalH - N, geoidN: N };
}
