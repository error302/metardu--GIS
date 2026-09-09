/**
 * Tile infrastructure tests — Web-Mercator math, zoom picking, viewport
 * enumeration, LRU behavior.
 */
import * as assert from "assert";
import {
  lonLatToTile,
  tileToLonLat,
  pickTileZoom,
  groundResolution,
  tilesForViewport,
  TILE_PROVIDERS,
  resolutionAtZoom,
  LruCache,
} from "../src/core/tiles";

/* Round-trips: tile -> lon/lat -> tile (same z) */
for (const [lon, lat] of [
  [36.82, -1.29], // Nairobi
  [-0.12, 51.5], // London
  [179.9, 70], // high lon/lat
  [-179.9, -70],
]) {
  for (const z of [3, 8, 14, 19]) {
    const t = lonLatToTile(lon, lat, z);
    const back = tileToLonLat(Math.floor(t.x), Math.floor(t.y), z);
    // center of that tile should be within one tile of the original point
    const tc = tileToLonLat(Math.floor(t.x) + 0.5, Math.floor(t.y) + 0.5, z);
    assert.ok(Math.abs(tc.lon - lon) < 360 / Math.pow(2, z) * 1.5, `lon roundtrip z=${z}`);
    assert.ok(Math.abs(tc.lat - lat) < 360 / Math.pow(2, z) * 1.5, `lat roundtrip z=${z}`);
    void back;
  }
}

/* Zoom picking: at 1 m/px near Nairobi (~1.3S), expect a high zoom */
{
  const z = pickTileZoom(1.0, -1.29, 2, 19);
  assert.ok(z >= 17, `1 m/px should map to z>=17, got ${z}`);
  // 10 km/px (very zoomed out) -> low zoom
  const z2 = pickTileZoom(10000, 0, 2, 19);
  assert.ok(z2 <= 5, `10 km/px should map to z<=5, got ${z2}`);
  // ground resolution consistency: pickTileZoom should land within sqrt(2) of mpp
  const z3 = pickTileZoom(2.4, 0, 2, 19);
  assert.ok(Math.abs(groundResolution(z3, 0) - 2.4) < 2.4 * (Math.SQRT2 - 0.01));
}

/* Resolution model: doubling z halves resolution */
assert.ok(Math.abs(resolutionAtZoom(0) - 156543.03392) < 0.01);
assert.ok(Math.abs(resolutionAtZoom(5) * 32 - resolutionAtZoom(0)) < 1e-6);

/* Viewport enumeration: Nairobi at ~1 m/px covers a bounded tile count */
{
  const spans = tilesForViewport(TILE_PROVIDERS.osm, 1.0, [36.7, -1.4, 36.95, -1.2]);
  assert.ok(spans.length > 0 && spans.length <= 48, `spans ${spans.length}`);
  const z = spans[0].z;
  for (const s of spans) assert.strictEqual(s.z, z, "all spans share one zoom");
  // every span intersects the bbox lon range
  for (const s of spans) {
    assert.ok(s.nw.lon < 36.95 && s.se.lon > 36.7, "span lon overlap");
    assert.ok(s.nw.lat > -1.4 && s.se.lat < -1.2, "span lat overlap");
  }
}

/* Overzoom: absurdly small mpp must drop zoom instead of exploding tile count
   (tiles upscale/blur — standard Leaflet-style overzoom behavior). */
{
  const spans = tilesForViewport(TILE_PROVIDERS.osm, 0.0005, [36.7, -1.4, 36.95, -1.2]);
  assert.ok(spans.length <= 48, `overzoom spans ${spans.length}`);
  assert.ok(spans[0].z < TILE_PROVIDERS.osm.maxZoom, "zoom should drop below max to bound tile count");
}

/* LRU eviction and recency */
{
  const lru = new LruCache<number>(3);
  lru.set("a", 1);
  lru.set("b", 2);
  lru.set("c", 3);
  assert.strictEqual(lru.get("a"), 1); // refresh a
  lru.set("d", 4); // evicts b (least recent)
  assert.strictEqual(lru.get("b"), undefined);
  assert.strictEqual(lru.get("a"), 1);
  assert.strictEqual(lru.get("d"), 4);
  assert.strictEqual(lru.size, 3);
}

console.log("tiles.test.ts: all assertions passed");
