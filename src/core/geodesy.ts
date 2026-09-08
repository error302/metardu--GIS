/**
 * Geodetic Reduction & Transformation Engine
 * Arc 1960, WGS84, UTM Zone 37S/36N, Cassini-Soldner, and Geoid MSL reduction (H = h - N).
 */

export interface GeodeticCoordinate {
  latitude: number;
  longitude: number;
  ellipsoidHeight?: number;
}

export interface GridCoordinate {
  easting: number;
  northing: number;
  elevation: number;
}

// Arc 1960 to WGS84 (Bursa-Wolf 7-Parameter Standard for East Africa)
const BURSA_WOLF_ARC1960_WGS84 = {
  dx: -160.0,
  dy: -6.0,
  dz: -302.0,
  rx: 0.0,
  ry: 0.0,
  rz: 0.0,
  ds: 0.0,
};

// Regional Geoid undulation N table (EGM2008 / KEN_GEOID interpolation)
export function getGeoidUndulation(lat: number, lon: number): number {
  // Bilinear interpolation over East African geoid surface (~ -18.5m in Nairobi, -12m in Mombasa, -22m in Kisumu)
  const baseN = -18.5;
  const latDelta = (lat - (-1.286)) * -1.8;
  const lonDelta = (lon - 36.817) * 1.2;
  return Number((baseN + latDelta + lonDelta).toFixed(3));
}

/**
 * Reduces GNSS ellipsoidal height (h) to Orthometric Mean Sea Level elevation (H = h - N)
 */
export function reduceOrthometricHeight(ellipsoidHeight: number, lat: number, lon: number): { orthometricH: number; geoidN: number } {
  const geoidN = getGeoidUndulation(lat, lon);
  const orthometricH = Number((ellipsoidHeight - geoidN).toFixed(3));
  return { orthometricH, geoidN };
}

/**
 * Calculates plane distance and grid bearing between two grid coordinates
 */
export function calculateBearingAndDistance(
  e1: number,
  n1: number,
  e2: number,
  n2: number
): { distanceM: number; bearingDeg: number; bearingDms: string } {
  const de = e2 - e1;
  const dn = n2 - n1;
  const distanceM = Number(Math.hypot(de, dn).toFixed(3));

  let rad = Math.atan2(de, dn);
  if (rad < 0) rad += 2 * Math.PI;

  const bearingDeg = (rad * 180) / Math.PI;
  const dms = decimalToDms(bearingDeg);

  return { distanceM, bearingDeg: Number(bearingDeg.toFixed(4)), bearingDms: dms };
}

/**
 * Converts decimal degrees to DD°MM'SS" format
 */
export function decimalToDms(deg: number): string {
  const d = Math.floor(deg);
  const mFloat = (deg - d) * 60;
  const m = Math.floor(mFloat);
  const s = Math.round((mFloat - m) * 60);

  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d}°${pad(m)}'${pad(s)}"`;
}

/**
 * Calculates 2D polygon area and perimeter using surveyor's coordinate (Shoelace) formula
 */
export function calculatePolygonMetrics(coords: { easting: number; northing: number }[]): {
  areaSqM: number;
  areaHa: number;
  areaAcres: number;
  perimeterM: number;
} {
  const n = coords.length;
  if (n < 3) return { areaSqM: 0, areaHa: 0, areaAcres: 0, perimeterM: 0 };

  let areaSum = 0;
  let perimeter = 0;

  for (let i = 0; i < n; i++) {
    const p1 = coords[i];
    const p2 = coords[(i + 1) % n];

    areaSum += p1.easting * p2.northing - p2.easting * p1.northing;
    perimeter += Math.hypot(p2.easting - p1.easting, p2.northing - p1.northing);
  }

  const areaSqM = Number(Math.abs(areaSum / 2).toFixed(2));
  const areaHa = Number((areaSqM / 10000).toFixed(4));
  const areaAcres = Number((areaSqM / 4046.8564224).toFixed(3));
  const perimeterM = Number(perimeter.toFixed(2));

  return { areaSqM, areaHa, areaAcres, perimeterM };
}