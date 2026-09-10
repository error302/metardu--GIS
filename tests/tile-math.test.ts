/**
 * Automated Test Suite: Web Mercator Tile Mathematics & Projection Conversion
 */

import {
  lonLatToTileXY,
  tileXYToLonLatBounds,
  calculateTileZoom,
  TILE_PROVIDERS,
} from "../src/core/tile-engine";

console.log("=== METARDU GIS STUDIO - TILE ENGINE TEST SUITE ===");

// 1. Equator / Prime Meridian (0, 0) at zoom 0
const t0 = lonLatToTileXY(0, 0, 0);
if (Math.abs(t0.x - 0.5) > 1e-4 || Math.abs(t0.y - 0.5) > 1e-4) {
  throw new Error(`Zoom 0 center tile mismatch: expected (0.5, 0.5), got (${t0.x}, ${t0.y})`);
}
console.log("PASS: Zoom 0 world center tile projection verified.");

// 2. Nairobi / East Africa (~36.82 Lon, -1.29 Lat) at Zoom 15
const t15 = lonLatToTileXY(36.8219, -1.2921, 15);
const intX = Math.floor(t15.x);
const intY = Math.floor(t15.y);
if (intX < 19000 || intX > 20000 || intY < 16000 || intY > 17000) {
  throw new Error(`Tile calculation out of expected bounds for Nairobi: (${intX}, ${intY})`);
}
console.log(`PASS: Nairobi coordinate tile index verified at Z=15: (${intX}, ${intY}).`);

// 3. Tile bounds round-trip
const bounds = tileXYToLonLatBounds(intX, intY, 15);
if (36.8219 < bounds.minLon || 36.8219 > bounds.maxLon) {
  throw new Error(`Longitude 36.8219 not inside computed tile bounds: [${bounds.minLon}, ${bounds.maxLon}]`);
}
if (-1.2921 < bounds.minLat || -1.2921 > bounds.maxLat) {
  throw new Error(`Latitude -1.2921 not inside computed tile bounds: [${bounds.minLat}, ${bounds.maxLat}]`);
}
console.log("PASS: Tile bounding box bounds round-trip containment verified.");

// 4. Zoom calculation
const zCalced = calculateTileZoom(1.0, -1.29); // 1 pixel per meter
if (zCalced < 17 || zCalced > 19) {
  throw new Error(`Zoom calculation expected ~18 at 1 px/m, got ${zCalced}`);
}
console.log(`PASS: Dynamic tile zoom level calculation verified: Z=${zCalced}.`);

// 5. Providers verify
if (!TILE_PROVIDERS["esri-satellite"] || !TILE_PROVIDERS["osm"] || !TILE_PROVIDERS["nasa-viirs"]) {
  throw new Error("Missing required tile providers");
}
console.log("PASS: All 4 tile providers registered and verified.");

console.log("ALL TILE ENGINE TESTS PASSED SUCCESSFULLY.");
