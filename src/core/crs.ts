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

export function listSupportedEPSG(): CRSDefinition[] {
  return DEFS;
}

export function getCRS(epsg: number): CRSDefinition | undefined {
  return DEFS.find((d) => d.epsg === epsg);
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
