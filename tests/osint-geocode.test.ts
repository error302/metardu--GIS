/**
 * Nominatim geocoding client tests — URL building, response parsing
 * (string lat/lon, [south, north, west, east] boundingbox order), query
 * validation, client-side 1 req/s spacing, and failure paths. No network:
 * fetch is stubbed.
 */
import * as assert from "assert";
import {
  searchPlaces,
  validateGeocodeQuery,
  describeGeocodeResult,
  resetGeocodeRate,
  NOMINATIM_ENDPOINT,
} from "../src/core/osint/geocode";

const FIXTURE = [
  {
    place_id: 38439054,
    osm_type: "relation",
    osm_id: 16246696,
    lat: "-1.2465281",
    lon: "36.7860759",
    category: "boundary",
    type: "administrative",
    importance: 0.24,
    display_name: "Westlands, Nairobi, Kenya",
    boundingbox: ["-1.3005", "-1.1924", "36.7212", "36.8472"],
  },
  {
    place_id: 42,
    osm_type: "node",
    osm_id: 30121815,
    lat: "-1.2647",
    lon: "-36.8018",
    category: "place",
    type: "suburb",
    importance: 0.14,
    display_name: "Somewhere",
  },
];

function stubFetch(body: unknown, status = 200): { impl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    impl: (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
    }) as typeof fetch,
  };
}

/* ---------------- query validation ---------------- */

assert.strictEqual(validateGeocodeQuery("  Westlands "), null, "trimmed query valid");
assert.ok(validateGeocodeQuery("   "), "empty query rejected");
assert.ok(validateGeocodeQuery("x".repeat(121)), "overlong query rejected");

/* ---------------- happy path ---------------- */

{
  resetGeocodeRate();
  const { impl, calls } = stubFetch(FIXTURE);
  const res = await searchPlaces("Westlands Nairobi", { limit: 2, countryCode: "KE", minIntervalMs: 0, fetchImpl: impl });
  assert.strictEqual(calls.length, 1, "one request per search");
  assert.ok(calls[0].startsWith(NOMINATIM_ENDPOINT), "endpoint hit");
  assert.ok(calls[0].includes("format=jsonv2"), "jsonv2 requested");
  assert.ok(calls[0].includes("limit=2"), "limit honoured");
  assert.ok(calls[0].includes("countrycodes=ke"), "country filter honoured");

  assert.strictEqual(res.results.length, 2);
  const first = res.results[0];
  assert.ok(Math.abs(first.lat - -1.2465281) < 1e-9, "string lat parsed");
  assert.ok(Math.abs(first.lon - 36.7860759) < 1e-9, "string lon parsed");
  // boundingbox arrives [south, north, west, east] -> mapped to min/max
  assert.ok(Math.abs(first.bbox.latMin - -1.3005) < 1e-9, "south -> latMin");
  assert.ok(Math.abs(first.bbox.latMax - -1.1924) < 1e-9, "north -> latMax");
  assert.ok(Math.abs(first.bbox.lonMin - 36.7212) < 1e-9, "west -> lonMin");
  assert.ok(Math.abs(first.bbox.lonMax - 36.8472) < 1e-9, "east -> lonMax");
  assert.strictEqual(first.label, "Westlands, Nairobi, Kenya");
  assert.strictEqual(first.osmType, "relation");
  assert.ok(res.endpoint.startsWith(NOMINATIM_ENDPOINT));
  assert.ok(!Number.isNaN(Date.parse(res.fetchedAt)), "ISO timestamp");

  // Result with no boundingbox falls back to a point bbox
  const second = res.results[1];
  assert.ok(Math.abs(second.bbox.lonMin - -36.8018) < 1e-9, "point bbox fallback");
  assert.ok(second.bbox.lonMin <= second.bbox.lonMax, "point bbox ordered");
}

/* ---------------- politeness spacing ---------------- */

{
  resetGeocodeRate();
  const { impl } = stubFetch([]);
  const t0 = Date.now();
  await searchPlaces("a", { minIntervalMs: 40, fetchImpl: impl });
  await searchPlaces("b", { minIntervalMs: 40, fetchImpl: impl });
  const spaced = Date.now() - t0;
  assert.ok(spaced >= 35, `second search waited out the interval (${spaced} ms)`);
}

/* ---------------- failure paths ---------------- */

{
  resetGeocodeRate();
  const { impl } = stubFetch("server error", 500);
  await assert.rejects(
    searchPlaces("anything", { minIntervalMs: 0, fetchImpl: impl }),
    /HTTP 500/,
  );
}
{
  resetGeocodeRate();
  const { impl } = stubFetch("<html>not json</html>");
  await assert.rejects(
    searchPlaces("anything", { minIntervalMs: 0, fetchImpl: impl }),
    /malformed JSON/,
  );
}
{
  resetGeocodeRate();
  const { impl } = stubFetch({ not: "an array" });
  await assert.rejects(
    searchPlaces("anything", { minIntervalMs: 0, fetchImpl: impl }),
    /unexpected payload/,
  );
}
{
  resetGeocodeRate();
  const { impl } = stubFetch([]);
  await assert.rejects(searchPlaces("   ", { fetchImpl: impl }), /place name/i);
}

/* ---------------- describe helper ---------------- */

assert.strictEqual(
  describeGeocodeResult({
    placeId: 1,
    osmType: "node",
    osmId: 2,
    lat: -1.26475,
    lon: 36.80184,
    category: "place",
    type: "suburb",
    label: "x",
    importance: 0,
    bbox: { lonMin: 0, latMin: 0, lonMax: 0, latMax: 0 },
  }),
  "suburb · -1.2648, 36.8018",
);

console.log("osint-geocode: all assertions passed");
