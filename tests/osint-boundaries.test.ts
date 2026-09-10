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
  // Clip: keep only what intersects and lies inside the bbox
  const { impl } = stub(META, GEO);
  const clip = { lonMin: 36.55, latMin: -1.45, lonMax: 36.85, latMax: -1.1 };
  const res = await fetchBoundaryContext("KEN", "ADM1", clip, { fetchImpl: impl });
  // Westlands ring bbox [36..37 x -2..-1] intersects; per-vertex: all 5 outside -> 5 clipped
  // Dagoretti poly1 [36.5..36.6 x -1.3..-1.2]: (36.5,-1.2) lon out; (36.6,-1.2) in;
  //   (36.6,-1.3) in; (36.5,-1.2) out -> 2 kept, 2 clipped
  // poly2 [36.7..36.8 x -1.5..-1.4]: in, in, (36.8,-1.5) lat out, in -> 3 kept, 1 clipped
  const kept = res.points;
  assert.strictEqual(kept.length, 5, "expected kept vertices");
  assert.ok(kept.every((p: SurveyPoint) => p.easting >= clip.lonMin && p.easting <= clip.lonMax));
  assert.ok(kept.every((p: SurveyPoint) => p.northing >= clip.latMin && p.northing <= clip.latMax));
  assert.strictEqual(res.clippedVertices, 5 + 2 + 1, "dropped vertices disclosed");
  assert.ok(res.unitNames.includes("Dagoretti"));
  assert.ok(!res.unitNames.includes("Westlands"), "fully-clipped unit not listed");
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

console.log("osint-boundaries: all assertions passed");
