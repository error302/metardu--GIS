/**
 * OSINT Overpass connector tests — query determinism, bbox validation,
 * response parsing (inline geometry + node-index fallback), tag mapping
 * to survey categories, and endpoint failover (no network: stubbed fetch).
 */
import * as assert from "assert";
import {
  OVERPASS_ENDPOINTS,
  OVERPASS_PRESETS,
  OVERPASS_PRESET_ORDER,
  buildOverpassQuery,
  validateBbox,
  expandBboxRadius,
  bboxSizeKm,
  parseOverpassResponse,
  osmCategoryAndCode,
  featuresToSurveyPoints,
  fetchOverpassFeatures,
  OverpassBbox,
  OSM_LICENSE,
} from "../src/core/osint/overpass";

const NAIROBI: OverpassBbox = { lonMin: 36.9, latMin: -1.35, lonMax: 37.0, latMax: -1.25 };

/* ---------------- bbox validation ---------------- */

assert.strictEqual(validateBbox(NAIROBI), null, "Nairobi bbox is valid");
assert.ok(validateBbox({ lonMin: 37, latMin: -1, lonMax: 36, latMax: 0 }), "inverted lon rejected");
assert.ok(validateBbox({ lonMin: 0, latMin: -1, lonMax: 0, latMax: -2 }), "inverted lat rejected");
assert.ok(validateBbox({ lonMin: 36, latMin: -1, lonMax: 200, latMax: 0 }), "lon > 180 rejected");
assert.ok(validateBbox({ lonMin: 36, latMin: -1, lonMax: 38, latMax: 0 }), "span > 1° rejected");
assert.ok(
  validateBbox({ lonMin: NaN, latMin: -1, lonMax: 36.5, latMax: 0 }),
  "non-finite rejected",
);

/* ---------------- radius expansion ---------------- */

{
  const wide = expandBboxRadius(NAIROBI, 5);
  assert.ok(wide.lonMin < NAIROBI.lonMin && wide.lonMax > NAIROBI.lonMax, "expands lon both ways");
  assert.ok(wide.latMin < NAIROBI.latMin && wide.latMax > NAIROBI.latMax, "expands lat both ways");
  // ~5 km of latitude is ~0.045°
  assert.ok(Math.abs((wide.latMax - NAIROBI.latMax) - 5 / 111.32) < 1e-9, "lat pad exact");
  const size = bboxSizeKm(wide);
  // original 0.1° tall = 11.13 km; +10 km pad ≈ 21.13 km
  assert.ok(size.heightKm > 21 && size.heightKm < 21.5, `height ≈ 21.1 km, got ${size.heightKm}`);
  // clamped to valid ranges at the poles
  const polar = expandBboxRadius({ lonMin: 0, latMin: 89.99, lonMax: 0.1, latMax: 90 }, 10);
  assert.ok(polar.latMax <= 85, "lat clamped to search limit");
}

/* ---------------- query builder ---------------- */

{
  const q = buildOverpassQuery(NAIROBI, ["buildings", "places"]);
  assert.ok(q.startsWith("[out:json][timeout:25]"), "settings prefix");
  assert.ok(
    q.includes("[bbox:-1.35,36.9,-1.25,37]"),
    "global bbox in Overpass south,west,north,east order",
  );
  // canonical preset order regardless of input order
  const q2 = buildOverpassQuery(NAIROBI, ["places", "buildings"]);
  assert.strictEqual(q, q2, "query is input-order independent");
  assert.ok(q.includes('way["building"]'), "buildings selector present");
  assert.ok(q.includes('node["place"]'), "places selector present");
  assert.ok(!q.includes('way["highway"]'), "unselected preset absent");
  assert.ok(/out geom 20000;$/, q, "inline geometry output with limit");

  // water preset carries both waterway and natural=water selectors
  const q3 = buildOverpassQuery(NAIROBI, ["water"]);
  assert.ok(q3.includes('way["waterway"]') && q3.includes('way["natural"="water"]'));

  assert.throws(() => buildOverpassQuery(NAIROBI, []), "empty preset list rejected");
  assert.throws(
    () => buildOverpassQuery({ lonMin: 0, latMin: 0, lonMax: 5, latMax: 1 }, ["buildings"]),
    "oversized bbox rejected at query time",
  );

  // every canonical preset produces a non-empty selector set
  const all = buildOverpassQuery(NAIROBI, OVERPASS_PRESET_ORDER);
  for (const id of OVERPASS_PRESET_ORDER) {
    for (const sel of OVERPASS_PRESETS[id].selectors) assert.ok(all.includes(sel), `${id} in full query`);
  }
}

/* ---------------- parser ---------------- */

const FIXTURE = {
  version: 0.6,
  generator: "Overpass API 0.7.62 (test fixture)",
  osm3s: { timestamp_osm_base: "2026-01-01T00:00:00Z" },
  elements: [
    {
      type: "node",
      id: 1001,
      lat: -1.3,
      lon: 36.95,
      tags: { place: "village", name: "Kilimani" },
    },
    {
      type: "node",
      id: 1002,
      lat: -1.31,
      lon: 36.96,
    }, // untagged helper — never a feature
    {
      type: "way",
      id: 2001,
      geometry: [
        { lat: -1.3, lon: 36.9 },
        { lat: -1.31, lon: 36.91 },
        { lat: -1.32, lon: 36.92 },
      ],
      tags: { highway: "track", name: "Access Road", surface: "earth" },
    }, // open polyline
    {
      type: "way",
      id: 2002,
      geometry: [
        { lat: -1.33, lon: 36.93 },
        { lat: -1.33, lon: 36.94 },
        { lat: -1.34, lon: 36.94 },
        { lat: -1.33, lon: 36.93 },
      ],
      tags: { building: "yes" },
    }, // closed ring
    {
      type: "way",
      id: 2003,
      nodes: [3001, 3002, 3003],
      tags: { waterway: "stream" },
    }, // geometry via node index
    { type: "node", id: 3001, lat: -1.35, lon: 36.9 },
    { type: "node", id: 3002, lat: -1.35, lon: 36.91 },
    { type: "node", id: 3003, lat: -1.35, lon: 36.92 },
    {
      type: "way",
      id: 2004,
      nodes: [9001, 9002],
      tags: { landuse: "farmland" },
    }, // unresolvable — nodes missing
    {
      type: "relation",
      id: 4001,
      tags: { landuse: "forest", type: "multipolygon" },
      members: [],
    }, // skipped, counted
  ],
};

{
  const res = parseOverpassResponse(FIXTURE);
  assert.strictEqual(res.features.length, 4, "place node + road + building ring + stream = 4");
  assert.strictEqual(res.skippedRelations, 1, "relation counted, not assembled");
  assert.strictEqual(res.unresolvedWays, 1, "unresolvable way counted");

  const place = res.features.find((f) => f.osmId === 1001);
  assert.ok(place, "place node parsed");
  assert.strictEqual(place!.kind, "point");
  assert.deepStrictEqual(place!.parts[0][0], [36.95, -1.3]);

  const road = res.features.find((f) => f.osmId === 2001);
  assert.ok(road && road.kind === "line" && road.parts[0].length === 3, "open way → line");

  const building = res.features.find((f) => f.osmId === 2002);
  assert.ok(building && building.kind === "polygon", "closed way → polygon");

  const stream = res.features.find((f) => f.osmId === 2003);
  assert.ok(stream && stream.kind === "line" && stream.parts[0].length === 3, "node-index fallback resolves");

  assert.throws(
    () => parseOverpassResponse({ foo: 1 }),
    "non-Overpass JSON rejected with a clear error",
  );
  assert.strictEqual(parseOverpassResponse({ elements: [] }).features.length, 0, "empty result is valid");
}

/* ---------------- tag → survey mapping ---------------- */

{
  assert.deepStrictEqual(osmCategoryAndCode({ place: "village" }).category, "settlement");
  assert.deepStrictEqual(osmCategoryAndCode({ building: "yes" }).category, "building");
  assert.deepStrictEqual(osmCategoryAndCode({ highway: "track" }).category, "road");
  assert.deepStrictEqual(osmCategoryAndCode({ waterway: "stream" }).category, "water");
  assert.deepStrictEqual(osmCategoryAndCode({ natural: "water" }).category, "water");
  assert.deepStrictEqual(osmCategoryAndCode({ landuse: "farmland" }).category, "vegetation");
  assert.deepStrictEqual(osmCategoryAndCode({ landuse: "residential" }).category, "settlement");

  const road = osmCategoryAndCode({ highway: "secondary", name: "Kangundo Road" });
  assert.strictEqual(road.rawCode, "highway=secondary");
  assert.strictEqual(road.description, "Kangundo Road", "named feature wears its name");
  const unnamed = osmCategoryAndCode({ highway: "track" });
  assert.strictEqual(unnamed.description, "Highway (track)", "unnamed falls back to the kind");
  const named = osmCategoryAndCode({ building: "yes", name: "Silo 3" });
  assert.strictEqual(named.description, "Silo 3");
  assert.strictEqual(named.rawCode, "building=yes");
}

/* ---------------- SurveyPoint conversion ---------------- */

{
  const res = parseOverpassResponse(FIXTURE);
  const pts = featuresToSurveyPoints(res.features, "OSM Context");
  assert.ok(pts.length === 3 + 3 + 4 + 1, `vertex count = ${pts.length} (road 3 + stream 3 + building ring 4 + place 1)`);

  const place = pts.find((p) => p.id === "OSM_Context-n1001");
  assert.ok(place, "point id follows layer-base-type+id convention");
  assert.strictEqual(place!.category, "settlement");
  assert.strictEqual(place!.description, "Kilimani");
  assert.strictEqual(place!.properties?.place, "village");

  const roadVertex = pts.find((p) => p.id === "OSM_Context-w2001-v1");
  assert.ok(roadVertex, "vertex id convention");
  assert.strictEqual(roadVertex!.properties?.surface, "earth", "useful tags kept");
  assert.strictEqual(roadVertex!.elevation, 0, "OSM has no elevation — honest zero");

  // building ring vertices carry the building code
  const ring = pts.filter((p) => p.id.startsWith("OSM_Context-w2002-v"));
  assert.strictEqual(ring.length, 4, "ring has 4 vertices");
  assert.ok(ring.every((p) => p.rawCode === "building=yes"), "uniform code per feature");

  // IDs are unique across the whole import (attribute table + selection keys)
  const ids = new Set(pts.map((p) => p.id));
  assert.strictEqual(ids.size, pts.length, "no duplicate point ids");
}

/* ---------------- fetch orchestration (stubbed network) ---------------- */

{
  const okResponse = { ok: true, status: 200, json: async () => FIXTURE } as unknown as Response;

  // First endpoint healthy — used, second never called
  const calls: string[] = [];
  const fetchA = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return okResponse;
  }) as typeof fetch;
  const a = await fetchOverpassFeatures({ bbox: NAIROBI, presets: ["buildings"], fetchImpl: fetchA, timeoutMs: 500 });
  assert.deepStrictEqual(calls, [OVERPASS_ENDPOINTS[0]], "healthy primary used");
  assert.strictEqual(a.parse.features.length, 4);
  assert.strictEqual(a.endpoint, OVERPASS_ENDPOINTS[0]);
  assert.ok(typeof a.fetchedAt === "string" && !Number.isNaN(Date.parse(a.fetchedAt)));

  // Primary fails with HTTP 429 → failover to the mirror
  const fetchB = (async (url: string | URL | Request) => {
    calls.push(String(url));
    if (String(url) === OVERPASS_ENDPOINTS[0]) {
      return { ok: false, status: 429 } as Response;
    }
    return okResponse;
  }) as typeof fetch;
  calls.length = 0;
  const b = await fetchOverpassFeatures({ bbox: NAIROBI, presets: ["roads"], fetchImpl: fetchB, timeoutMs: 500 });
  assert.strictEqual(b.endpoint, OVERPASS_ENDPOINTS[1], "mirror failover on HTTP 429");
  assert.deepStrictEqual(calls, [OVERPASS_ENDPOINTS[0], OVERPASS_ENDPOINTS[1]]);

  // Everything down → one error with both attempts named
  const fetchC = (async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;
  await assert.rejects(
    () => fetchOverpassFeatures({ bbox: NAIROBI, presets: ["water"], fetchImpl: fetchC, timeoutMs: 500 }),
    (err: Error) => err.message.includes("All Overpass endpoints failed") && err.message.includes("503"),
    "aggregate failure names every endpoint status",
  );

  // Invalid bbox fails before any network call
  const fetchD = (async () => {
    throw new Error("network should not be reached");
  }) as unknown as typeof fetch;
  await assert.rejects(
    () =>
      fetchOverpassFeatures({
        bbox: { lonMin: 0, latMin: 0, lonMax: 5, latMax: 1 },
        presets: ["buildings"],
        fetchImpl: fetchD,
      }),
    /query area too large/,
    "validation precedes network",
  );
}

/* ---------------- source identity (provenance contract) ---------------- */

assert.strictEqual(OSM_LICENSE, "ODbL 1.0", "license constant is explicit");
assert.ok(OVERPASS_ENDPOINTS.every((e) => e.startsWith("https://")), "all endpoints are TLS");

console.log("osint-overpass.test.ts: all assertions passed");
