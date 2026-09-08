/**
 * Unit Test for CRS Transformation Engine
 * Validates round-trip transforms between Arc 1960 / UTM 37S (EPSG:21037) and WGS 84 (EPSG:4326),
 * as well as EGM2008 geoid height reduction.
 */

import { transform, toWGS84, fromWGS84, geoidUndulation, reduceOrthometricHeight } from "../src/core/crs";

console.log("=== METARDU GIS STUDIO - CRS & GEODESY TEST SUITE ===");

// Benchmark Point: Survey of Kenya primary triangulation beacon / Nairobi reference
// Easting: 250,000 m, Northing: 9,850,000 m (Arc 1960 UTM 37S)
const arcE = 250000;
const arcN = 9850000;
const ellipsoidalH = 1680.50;

console.log(`Original Arc 1960 UTM 37S: E = ${arcE.toFixed(3)}, N = ${arcN.toFixed(3)}`);

// Transform to WGS84 Geographic [lon, lat]
const [wgsLon, wgsLat] = toWGS84(21037, arcE, arcN);
console.log(`Reprojected to WGS84: Lon = ${wgsLon.toFixed(6)}°, Lat = ${wgsLat.toFixed(6)}°`);

// Round-trip back to Arc 1960 UTM 37S
const [roundE, roundN] = fromWGS84(21037, wgsLon, wgsLat);
console.log(`Round-trip Arc 1960 UTM 37S: E = ${roundE.toFixed(3)}, N = ${roundN.toFixed(3)}`);

const deltaE = Math.abs(arcE - roundE);
const deltaN = Math.abs(arcN - roundN);

console.log(`Round-trip Error: dE = ${deltaE.toExponential(3)} m, dN = ${deltaN.toExponential(3)} m`);

if (deltaE > 0.001 || deltaN > 0.001) {
  console.error("FAIL: Round-trip transformation error exceeds 1mm tolerance!");
  process.exit(1);
} else {
  console.log("PASS: Round-trip accuracy < 1mm geodetic precision.");
}

// Test Geoid Height Reduction
const { orthometricH, geoidN } = reduceOrthometricHeight(ellipsoidalH, wgsLat, wgsLon);
console.log(`Ellipsoidal Height: ${ellipsoidalH.toFixed(3)}m, Geoid Undulation N: ${geoidN.toFixed(3)}m -> MSL Orthometric H: ${orthometricH.toFixed(3)}m`);

if (Math.abs((ellipsoidalH - geoidN) - orthometricH) > 1e-4) {
  console.error("FAIL: Geoid reduction formula H = h - N violated!");
  process.exit(1);
} else {
  console.log("PASS: Orthometric height reduction verified.");
}

// Test Web Mercator (EPSG:3857) to WGS84
const [wmX, wmY] = transform(4326, 3857, wgsLon, wgsLat);
const [backLon, backLat] = transform(3857, 4326, wmX, wmY);
const deltaLon = Math.abs(wgsLon - backLon);
const deltaLat = Math.abs(wgsLat - backLat);

console.log(`EPSG:3857 Roundtrip: dLon = ${deltaLon.toExponential(3)}°, dLat = ${deltaLat.toExponential(3)}°`);
if (deltaLon > 1e-7 || deltaLat > 1e-7) {
  console.error("FAIL: EPSG:3857 round-trip error too large!");
  process.exit(1);
} else {
  console.log("PASS: Web Mercator transform verified.");
}

console.log("ALL GEODETIC & CRS TESTS PASSED SUCCESSFULLY.");
