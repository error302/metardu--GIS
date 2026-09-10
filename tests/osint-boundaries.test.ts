/**
 * geoBoundaries context tests — ISO validation, metadata parsing (license
 * and pinned simplified URL recorded verbatim), ring flattening for
 * Polygon/MultiPolygon, bbox clipping (ring-level reject + vertex-level
 * keep), the vertex cap with truncation disclosure, and coded-vertex
 * shape. No network: fetch and metadata are stubbed.
 */
import * as assert from "assert";
import {
  fetchBoundaryMetadata,
  toDirectGeometryUrl,
  fetchBoundaryContext,
  validateIso3,
  GB_SERVICE,
  ADM_LEVELS,
} from "../src/core/osint/boundaries";
import { SurveyPoint } from "../src/types/spatial";

const META = {
  boundaryID: "KEN-ADM1-32016919",
  boundaryISO: "KEN",
  boundaryType: "ADM1",
  boundaryYearRepresented: 2020,
  boundaryLicense: "Public Domain",
  simplifiedGeometryGeoJSON: "https://example.test/geoBoundaries-KEN-ADM1_simplified.geojson",
  gjDownloadURL: "https://example.test/geoBoundaries-KEN-ADM1.geojson",
};

/* ---------------- validation ---------------- */

assert.strictEqual(validateIso3("KEN"), null);
assert.strictEqual(validateIso3("ken"), null, "case-insensitive");
assert.ok(validateIso3("KE"), "two letters rejected");
assert.ok(validateIso3("KENY"), "four letters rejected");
assert.ok(validateIso3(""), "empty rejected");
assert.deepStrictEqual([...ADM_LEVELS].sort(), ["ADM0", "ADM1", "ADM2"]);

{
  const { impl } = stub(META, null);
  const meta = await fetchBoundaryMetadata("ken", "ADM1", { fetchImpl: impl });
  assert.strictEqual(meta.iso, "KEN", "ISO normalised to upper case");
  assert.strictEqual(meta.boundaryId, "KEN-ADM1-32016919");
  assert.strictEqual(meta.license, "Public Domain", "license recorded verbatim");
  assert.strictEqual(meta.year, "2020");
  assert.strictEqual(meta.simplifiedUrl, META.simplifiedGeometryGeoJSON, "pinned simplified URL kept");
  assert.ok(meta.metadataUrl.includes("/gbOpen/KEN/ADM1/"));
}

function stub(metaBody: unknown, geoBody: unknown, opts: { status?: number; headers?: Record<string, string> } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const isMeta = String(url).includes("/api/current/");
    const body = isMeta ? metaBody : geoBody;
    if (body === null) return new Response("not found", { status: opts.status ?? 404 });
    return new Response(
      typeof body === "string" ? body : JSON.stringify(body),
      { status: opts.status ?? 200, headers: opts.headers },
    );
  }) as typeof fetch;
  return { impl, calls };
}

{
  // 404 with guidance
  const { impl } = stub(META, null, { status: 404 });
  await assert.rejects(
    fetchBoundaryMetadata("XYZ", "ADM1", { fetchImpl: impl }),
    /no such boundary/,
  );
}

/* ---------------- geometry conversion ---------------- */

const GEO = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { shapeName: "Westlands", shapeID: "KEN-ADM1-1", shapeGroup: "gbOpen", shapeType: "ADM1" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [36.0, -1.0],
            [37.0, -1.0],
            [37.0, -2.0],
            [36.0, -2.0],
            [36.0, -1.0],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: { shapeName: "Dagoretti", shapeID: "KEN-ADM1-2" },
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [36.5, -1.2],
              [36.6, -1.2],
              [36.6, -1.3],
              [36.5, -1.2],
            ],
          ],
          [
            [
              [36.7, -1.4],
              [36.8, -1.4],
              [36.8, -1.5],
              [36.7, -1.4],
            ],
          ],
        ],
      },
    },
    // hole ring inside the first polygon (inner ring contributes too)
  ],
};

{
  const { impl } = stub(META, GEO);
  const res = await fetchBoundaryContext("KEN", "ADM1", null, { fetchImpl: impl, metadata: undefined });
  assert.strictEqual(res.metadata.boundaryId, META.boundaryID);
  assert.strictEqual(res.points.length, 5 + 4 + 4, "all rings contribute without a clip");
  assert.strictEqual(res.clippedVertices, 0);
  assert.strictEqual(res.truncated, false);
  assert.deepStrictEqual(res.unitNames.sort(), ["Dagoretti", "Westlands"]);
  const p0 = res.points[0];
  assert.strictEqual(p0.category, "boundary");
  assert.strictEqual(p0.rawCode, "GB-ADM1");
  assert.strictEqual(p0.easting, 36.0);
  assert.strictEqual(p0.northing, -1.0);
  assert.strictEqual(p0.id, "gb-KEN-ADM1-1-v1");
  assert.strictEqual(p0.description, "Westlands (v1)");
  const props = p0.properties as Record<string, string>;
  assert.strictEqual(props.shapeName, "Westlands");
  assert.strictEqual(props.year, "2020");
  assert.strictEqual(p0.elevation, 0, "no fabricated elevations");
  // geometry URL follows the metadata (redirect target disclosed)
  assert.ok(res.geometryUrl.includes("_simplified.geojson"));
}

{
  // Clip: ring-level matching — a unit CONTAINING the scope is kept whole
  // (its vertices sit far outside the bbox; vertex-level filtering would
  // silently drop exactly the jurisdiction that matters).
  const GEO2 = {
    type: "FeatureCollection",
    features: [
      ...GEO.features,
      {
        type: "Feature",
        properties: { shapeName: "Nairobi Central", shapeID: "KEN-ADM1-3" },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [36.0, -1.5],
              [37.0, -1.5],
              [37.0, -0.5],
              [36.0, -0.5],
              [36.0, -1.5],
            ],
          ],
        },
      },
    ],
  };
  const { impl } = stub(META, GEO2);
  const clip = { lonMin: 36.55, latMin: -1.45, lonMax: 36.85, latMax: -1.1 };
  const res = await fetchBoundaryContext("KEN", "ADM1", clip, { fetchImpl: impl });
  // Westlands ring [36..37 x -2..-1] intersects -> kept whole (5)
  // Dagoretti polys both intersect -> kept whole (4 + 4)
  // Nairobi Central CONTAINS the clip -> kept whole (5)
  assert.strictEqual(res.points.length, 18, "all intersecting rings kept whole");
  assert.strictEqual(res.clippedVertices, 0, "nothing rejected (all rings intersect)");
  assert.ok(res.unitNames.includes("Nairobi Central"), "containing unit kept");
  assert.deepStrictEqual(res.unitNames.sort(), ["Dagoretti", "Nairobi Central", "Westlands"]);

  // A scope far away rejects everything, disclosed
  const far = { lonMin: 10, latMin: 0, lonMax: 11, latMax: 1 };
  const res2 = await fetchBoundaryContext("KEN", "ADM1", far, { fetchImpl: impl });
  assert.strictEqual(res2.points.length, 0);
  assert.strictEqual(res2.clippedVertices, 18, "all vertices counted as clipped");
  assert.strictEqual(res2.unitNames.length, 0);
}

{
  // Vertex cap truncates and is disclosed
  const { impl } = stub(META, GEO);
  const res = await fetchBoundaryContext("KEN", "ADM1", null, { fetchImpl: impl, vertexCap: 6 });
  assert.strictEqual(res.points.length, 6);
  assert.strictEqual(res.truncated, true);
}

{
  // Non-FeatureCollection payload rejected
  const { impl } = stub(META, { type: "Feature" });
  await assert.rejects(
    fetchBoundaryContext("KEN", "ADM1", null, { fetchImpl: impl }),
    /not a GeoJSON FeatureCollection/,
  );
}

/* ---------------- geometry URL rewrite ---------------- */

{
  const original = "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/KEN/ADM1/geoBoundaries-KEN-ADM1_simplified.geojson";
  const urls = toDirectGeometryUrl(original);
  assert.strictEqual(urls.length, 3, "media + raw + published candidates");
  assert.strictEqual(
    urls[0],
    "https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/9469f09/releaseData/gbOpen/KEN/ADM1/geoBoundaries-KEN-ADM1_simplified.geojson",
    "LFS media host first",
  );
  assert.ok(urls[1].startsWith("https://raw.githubusercontent.com/wmgeolab/geoBoundaries/9469f09/"));
  assert.strictEqual(urls[2], original, "published URL kept as last resort");
  assert.deepStrictEqual(
    toDirectGeometryUrl("https://example.test/x.geojson"),
    ["https://example.test/x.geojson"],
    "non-github URLs pass through",
  );
}

{
  // Fallback: rewritten host 404s, published URL serves the geometry
  const calls: string[] = [];
  const impl = (async (url: string | URL | Request) => {
    const u = String(url);
    calls.push(u);
    if (u.includes("/api/current/")) return new Response(JSON.stringify(META), { status: 200 });
    if (u.includes("media.githubusercontent.com")) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(GEO), { status: 200 });
  }) as typeof fetch;
  const ghMeta = {
    boundaryId: "KEN-ADM1-32016919",
    iso: "KEN",
    adm: "ADM1" as const,
    year: "2020",
    license: "Public Domain",
    simplifiedUrl:
      "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/KEN/ADM1/geoBoundaries-KEN-ADM1_simplified.geojson",
    metadataUrl: "https://www.geoboundaries.org/api/current/gbOpen/KEN/ADM1/",
  };
  const res = await fetchBoundaryContext("ken", "ADM1", null, { fetchImpl: impl, metadata: ghMeta });
  assert.strictEqual(res.points.length, 13, "geometry parsed after fallback");
  assert.ok(calls.some((c) => c.includes("media.githubusercontent.com")), "direct host tried first");
  assert.ok(
    calls.some((c) => c.includes("raw.githubusercontent.com") || c.includes("github.com/wmgeolab")),
    "second candidate served the geometry after the first failed",
  );
}

console.log("osint-boundaries: all assertions passed");
