/**
 * Copernicus GLO-30 ingestion tests — tile naming, fetch planning (pixel
 * caps, per-tile crop split), GeoTIFF crop decoding against hand-built
 * byte-exact fixtures (the verified production layout: uncompressed
 * float32, 1-2 samples per pixel, strips, WGS84 pixel-scale + tiepoint),
 * mosaic alignment, and the production fetch path with stubbed network.
 */
import * as assert from "assert";
import {
  glo30ItemId,
  padBboxToMinWindow,
  intersectingDemTiles,
  planDemFetch,
  decodeCropTiff,
  DemDecodeError,
  mosaicCrops,
  fetchDemGrid,
  DemCrop,
  DemFetchPlan,
  Bbox,
} from "../src/core/dem/copernicus";

/* ------------------------------------------------------------------ */
/* Byte-exact TIFF fixture builder (mirrors the PC crop.tif layout)    */
/* ------------------------------------------------------------------ */

interface TiffSpec {
  width: number;
  height: number;
  west: number;
  north: number;
  dLonDeg: number;
  dLatDeg: number;
  samplesPerPixel: 1 | 2;
  rowsPerStrip?: number;
  /** Elevation at (col,row); returning NaN writes alpha=0 (masked). */
  elevAt?: (c: number, r: number) => number;
}

function buildCropTiff(spec: TiffSpec): ArrayBuffer {
  const le = true;
  const { width, height, dLonDeg, dLatDeg } = spec;
  const rowsPerStrip = spec.rowsPerStrip ?? 2;
  const stripCount = Math.ceil(height / rowsPerStrip);
  const stripBytes = rowsPerStrip * width * spec.samplesPerPixel * 4;

  // Overflow area layout (bytes, relative to overflowOffset):
  //   ModelPixelScale (3xDOUBLE), ModelTiepoint (6xDOUBLE),
  //   StripOffsets table (stripCount x LONG), StripByteCounts table.
  // BitsPerSample/SampleFormat are SHORT count<=2 and live inline in the IFD.
  const scaleOff = 0;
  const tieOff = scaleOff + 24;
  const stripOffTab = tieOff + 48;
  const stripCntTab = stripOffTab + stripCount * 4;
  const overflowLen = stripCntTab + stripCount * 4;

  const ifdCount = 12;
  const ifdOffset = 8;
  const overflowOffset = ifdOffset + 2 + ifdCount * 12 + 4;
  const dataOffset = overflowOffset + overflowLen;

  const strips: { off: number; len: number; bytes: Uint8Array }[] = [];
  let cursor = dataOffset;
  for (let s = 0; s < stripCount; s++) {
    const row0 = s * rowsPerStrip;
    const rows = Math.min(rowsPerStrip, height - row0);
    const bytes = new Uint8Array(stripBytes);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < width; c++) {
        const elev = spec.elevAt ? spec.elevAt(c, row0 + r) : 0;
        const idx = (r * width + c) * spec.samplesPerPixel * 4;
        const sdv = new DataView(bytes.buffer);
        if (Number.isFinite(elev)) {
          sdv.setFloat32(idx, elev, le);
          if (spec.samplesPerPixel === 2) sdv.setFloat32(idx + 4, 255, le);
        } else {
          sdv.setFloat32(idx, 0, le);
          if (spec.samplesPerPixel === 2) sdv.setFloat32(idx + 4, 0, le);
        }
      }
    }
    strips.push({ off: cursor, len: rows * width * spec.samplesPerPixel * 4, bytes });
    cursor += stripBytes;
  }

  const total = cursor;
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  dv.setUint16(0, 0x4949, le); // "II"
  dv.setUint16(2, 42, le);
  dv.setUint32(4, ifdOffset, le);
  for (const s of strips) u8.set(s.bytes, s.off);

  // IFD — tags must be in ascending order
  dv.setUint16(ifdOffset, ifdCount, le);
  let e = ifdOffset + 2;
  const tagShort = (tag: number, values: number[]) => {
    dv.setUint16(e, tag, le);
    dv.setUint16(e + 2, 3, le);
    dv.setUint16(e + 4, values.length, le);
    for (let i = 0; i < Math.min(values.length, 2); i++) dv.setUint16(e + 8 + i * 2, values[i], le);
    e += 12;
  };
  const tagShortU32 = (tag: number, value: number) => {
    dv.setUint16(e, tag, le);
    dv.setUint16(e + 2, 4, le);
    dv.setUint16(e + 4, 1, le);
    dv.setUint32(e + 8, value, le);
    e += 12;
  };
  /** SHORT pair stored inline in the entry (total 4 bytes fits inline). */
  const tagShortPair = (tag: number, v1: number, v2: number) => {
    dv.setUint16(e, tag, le);
    dv.setUint16(e + 2, 3, le);
    dv.setUint16(e + 4, 2, le);
    dv.setUint16(e + 8, v1, le);
    dv.setUint16(e + 10, v2, le);
    e += 12;
  };
  /** LONG array stored in the overflow area at overflowOffset + at. */
  const tagLongArray = (tag: number, at: number, values: number[]) => {
    dv.setUint16(e, tag, le);
    dv.setUint16(e + 2, 4, le);
    dv.setUint16(e + 4, values.length, le);
    dv.setUint32(e + 8, overflowOffset + at, le);
    for (let i = 0; i < values.length; i++) dv.setUint32(overflowOffset + at + i * 4, values[i], le);
    e += 12;
  };
  const tagDoubleArray = (tag: number, at: number, values: number[]) => {
    dv.setUint16(e, tag, le);
    dv.setUint16(e + 2, 12, le);
    dv.setUint16(e + 4, values.length, le);
    dv.setUint32(e + 8, overflowOffset + at, le);
    for (let i = 0; i < values.length; i++) dv.setFloat64(overflowOffset + at + i * 8, values[i], le);
    e += 12;
  };

  tagShort(256, [width]); // ImageWidth
  tagShort(257, [height]); // ImageLength
  if (spec.samplesPerPixel === 1) tagShortU32(258, 32);
  else tagShortPair(258, 32, 32);
  tagShort(259, [1]); // Compression = none
  if (stripCount === 1) tagShortU32(273, strips[0].off);
  else tagLongArray(273, stripOffTab, strips.map((s) => s.off));
  tagShort(277, [spec.samplesPerPixel]);
  tagShort(278, [rowsPerStrip]);
  if (stripCount === 1) tagShortU32(279, strips[0].len);
  else tagLongArray(279, stripCntTab, strips.map((s) => s.len));
  tagShort(284, [1]); // PlanarConfig = chunky
  if (spec.samplesPerPixel === 1) tagShortU32(339, 3);
  else tagShortPair(339, 3, 3);
  tagDoubleArray(33550, scaleOff, [dLonDeg, dLatDeg, 0]); // ModelPixelScale
  tagDoubleArray(33922, tieOff, [0, 0, 0, spec.west, spec.north, 0]); // ModelTiepoint
  dv.setUint32(ifdOffset + 2 + ifdCount * 12, 0, le); // next IFD = none

  return buf;
}

/* ------------------------------------------------------------------ */
/* Tile naming                                                         */
/* ------------------------------------------------------------------ */

assert.strictEqual(
  glo30ItemId(-2, 36),
  "Copernicus_DSM_COG_10_S02_00_E036_00_DEM",
  "Nairobi tile (SW-corner naming, verified against live item)",
);
assert.strictEqual(glo30ItemId(0, 36), "Copernicus_DSM_COG_10_N00_00_E036_00_DEM", "equator tile N00");
assert.strictEqual(glo30ItemId(12, -79), "Copernicus_DSM_COG_10_N12_00_W079_00_DEM", "west tile padded");
assert.strictEqual(glo30ItemId(-33, 151), "Copernicus_DSM_COG_10_S33_00_E151_00_DEM", "southeast tile");

{
  // bbox spanning two tiles each axis -> four tile refs
  const tiles = intersectingDemTiles({ lonMin: 36.5, latMin: -1.5, lonMax: 37.5, latMax: -0.5 });
  assert.strictEqual(tiles.length, 4, "2x2 tile split");
  const ids = tiles.map((t) => t.itemId).sort();
  assert.ok(ids.includes("Copernicus_DSM_COG_10_S02_00_E036_00_DEM"));
  assert.ok(ids.includes("Copernicus_DSM_COG_10_S02_00_E037_00_DEM"));
  assert.ok(ids.includes("Copernicus_DSM_COG_10_S01_00_E036_00_DEM"));
  assert.ok(ids.includes("Copernicus_DSM_COG_10_S01_00_E037_00_DEM"));

  // bbox exactly on integer bounds excludes the tile beyond the edge
  const tight = intersectingDemTiles({ lonMin: 36, latMin: -1, lonMax: 37, latMax: 0 });
  assert.strictEqual(tight.length, 1, "integer-bounded bbox = one tile");
  assert.strictEqual(tight[0].itemId, "Copernicus_DSM_COG_10_S01_00_E036_00_DEM");
}

/* ---------------- minimum query window ---------------- */

{
  // A tiny job extent (~400 m) still gets a ≥3 km regional window, centered
  const tiny: Bbox = { lonMin: 36.7912, latMin: -1.2859, lonMax: 36.7945, latMax: -1.2823 };
  const paddedBox = padBboxToMinWindow(tiny);
  const latSpanKm = (paddedBox.latMax - paddedBox.latMin) * 111.32;
  const lonSpanKm = (paddedBox.lonMax - paddedBox.lonMin) * 111.32 * Math.cos((-1.284 * Math.PI) / 180);
  assert.ok(latSpanKm >= 2.99 && latSpanKm < 3.2, `padded lat span ≈ 3 km, got ${latSpanKm}`);
  assert.ok(lonSpanKm >= 2.99 && lonSpanKm < 3.2, `padded lon span ≈ 3 km, got ${lonSpanKm}`);
  // center preserved
  assert.ok(
    Math.abs((paddedBox.lonMin + paddedBox.lonMax) / 2 - (tiny.lonMin + tiny.lonMax) / 2) < 1e-9,
    "lon center kept",
  );
  // a window already ≥3 km passes through unchanged
  const big: Bbox = { lonMin: 36.0, latMin: -1.5, lonMax: 37.0, latMax: -0.5 };
  assert.deepStrictEqual(padBboxToMinWindow(big), big, "no padding when already wide");
}

/* ------------------------------------------------------------------ */
/* Fetch planning                                                      */
/* ------------------------------------------------------------------ */

const NAIROBI: Bbox = { lonMin: 36.8, latMin: -1.32, lonMax: 36.84, latMax: -1.28 };

{
  const plan = planDemFetch(NAIROBI);
  // ~4.45 x 4.45 km window at 30 m -> about 149 px per axis
  assert.ok(plan.width > 140 && plan.width < 160, `width ≈ 149, got ${plan.width}`);
  assert.ok(!plan.resampled && plan.effectiveResM === 30, "native resolution for a small window");
  assert.strictEqual(plan.crops.length, 1, "small window = one tile crop");
  assert.strictEqual(plan.crops[0].itemId, "Copernicus_DSM_COG_10_S02_00_E036_00_DEM");
  // crop spans the whole query window
  assert.strictEqual(plan.crops[0].bbox.lonMin, NAIROBI.lonMin);
  assert.strictEqual(plan.crops[0].bbox.latMax, NAIROBI.latMax);
  assert.strictEqual(plan.crops[0].width, plan.width);

  // 1° window splits into up to 4 crops with the shared pixel scale
  const wide: Bbox = { lonMin: 36.2, latMin: -1.7, lonMax: 37.4, latMax: -0.4 };
  const plan2 = planDemFetch(wide);
  assert.strictEqual(plan2.crops.length, 4, "2x2 tiles for a 1.2° window");
  for (const crop of plan2.crops) {
    // per-crop geometry follows the SAME dLon/dLat as the master plan
    assert.ok(Math.abs(crop.bbox.lonMax - crop.bbox.lonMin - crop.width * plan2.dLonDeg) < 2 * plan2.dLonDeg,
      "crop width matches its span at the shared scale");
    assert.ok(crop.width <= plan2.width && crop.height <= plan2.height, "crops fit the master grid");
  }
  // crops tile the window without gaps: total area ≈ window area
  const cropArea = plan2.crops.reduce((a, c) => a + c.width * c.height, 0);
  assert.ok(
    Math.abs(cropArea - plan2.width * plan2.height) / (plan2.width * plan2.height) < 0.02,
    `crop pixels ≈ master pixels (${cropArea} vs ${plan2.width * plan2.height})`,
  );

  // pixel cap forces resampling, disclosed via resampled + effectiveResM
  const capped = planDemFetch(NAIROBI, { targetResM: 30, maxPx: 64 });
  assert.ok(capped.resampled, "cap triggers resample flag");
  assert.ok(capped.effectiveResM > 30, "effective resolution coarsened");
  assert.ok(capped.width <= 64 && capped.height <= 64, "master fits the cap");
}

/* ------------------------------------------------------------------ */
/* TIFF decode                                                         */
/* ------------------------------------------------------------------ */

{
  const W = 8;
  const H = 6;
  const spec: TiffSpec = {
    width: W,
    height: H,
    west: 36.8,
    north: -1.28,
    dLonDeg: 0.0001,
    dLatDeg: 0.0001,
    samplesPerPixel: 2,
    elevAt: (c, r) => (c === 3 && r === 2 ? NaN : 100 + c * 10 + r * 5),
  };
  const crop = await decodeCropTiff(buildCropTiff(spec));
  assert.strictEqual(crop.width, W);
  assert.strictEqual(crop.height, H);
  assert.strictEqual(crop.west, 36.8);
  assert.strictEqual(crop.north, -1.28);
  assert.strictEqual(crop.nodataCount, 1, "one alpha-masked cell");
  assert.ok(Number.isNaN(crop.values[2 * W + 3]), "masked cell is NaN");
  assert.strictEqual(crop.values[0 * W + 0], 100, "NW cell = 100");
  assert.strictEqual(crop.values[5 * W + 7], 100 + 70 + 25, "SE cell");
}

{
  // single-band variant decodes with no mask
  const crop = await decodeCropTiff(
    buildCropTiff({
      width: 4,
      height: 4,
      west: 0,
      north: 0,
      dLonDeg: 0.001,
      dLatDeg: 0.001,
      samplesPerPixel: 1,
      elevAt: (c, r) => 5 * r + c,
    }),
  );
  assert.strictEqual(crop.nodataCount, 0);
  assert.strictEqual(crop.values[3 * 4 + 3], 18, "SE cell single band");
}

{
  // malformed inputs fail with decode errors, not crashes
  const good = buildCropTiff({
    width: 4,
    height: 4,
    west: 0,
    north: 0,
    dLonDeg: 0.001,
    dLatDeg: 0.001,
    samplesPerPixel: 2,
    elevAt: () => 1,
  });
  await assert.rejects(decodeCropTiff(new ArrayBuffer(8)), DemDecodeError, "truncated buffer rejected");

  const png = new ArrayBuffer(16);
  new Uint8Array(png).set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  await assert.rejects(decodeCropTiff(png), DemDecodeError, "not a TIFF");

  const bigtiff = new ArrayBuffer(16);
  const bdv = new DataView(bigtiff);
  bdv.setUint16(0, 0x4949, true);
  bdv.setUint16(2, 43, true);
  await assert.rejects(decodeCropTiff(bigtiff), DemDecodeError, "BigTIFF rejected");

  // rows-per-strip larger than the image still decodes (single strip)
  const tall = await decodeCropTiff(
    buildCropTiff({
      width: 3,
      height: 5,
      west: 0,
      north: 0,
      dLonDeg: 0.001,
      dLatDeg: 0.001,
      samplesPerPixel: 2,
      rowsPerStrip: 64,
      elevAt: (c, r) => r * 3 + c,
    }),
  );
  assert.strictEqual(tall.values[4 * 3 + 2], 14, "single-strip decode");
}

/* ------------------------------------------------------------------ */
/* Mosaic                                                              */
/* ------------------------------------------------------------------ */

{
  // Two crops side by side from a continuous field — the mosaic must be
  // seamless across the tile boundary (this is what makes a 2-tile fetch
  // usable for profiles and contours).
  const dLon = 0.0005;
  const dLat = 0.0005;
  const elevAt = (lon: number, lat: number) => 50 + lon * 1000 + lat * 2000;
  const cropAt = (west: number, north: number): DemCrop => {
    const w = 10;
    const h = 10;
    const values = new Float32Array(w * h);
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        values[r * w + c] = elevAt(west + (c + 0.5) * dLon, north - (r + 0.5) * dLat);
      }
    }
    return { width: w, height: h, west, north, dLonDeg: dLon, dLatDeg: dLat, values, nodataCount: 0 };
  };

  const plan: DemFetchPlan = {
    west: 36.8,
    north: -1.28,
    dLonDeg: dLon,
    dLatDeg: dLat,
    width: 20,
    height: 10,
    effectiveResM: 30,
    resampled: false,
    crops: [],
  };
  const grid = mosaicCrops([cropAt(36.8, -1.28), cropAt(36.805, -1.28)], plan);
  assert.strictEqual(grid.width, 20);
  assert.strictEqual(grid.validCount, 200, "no cells lost in the seam");
  // probe the seam: master col 10 row 5 must equal the west crop's col 10...
  // continuous field check on both sides of the boundary
  const probe = (gc: number, gr: number) => {
    const lon = grid.west + (gc + 0.5) * grid.dLonDeg;
    const lat = grid.north - (gr + 0.5) * grid.dLatDeg;
    return { v: grid.values[gr * grid.width + gc], expected: elevAt(lon, lat) };
  };
  for (const [gc, gr] of [[9, 5], [10, 5], [0, 0], [19, 9]] as const) {
    const { v, expected } = probe(gc, gr);
    // float32 storage bounds the agreement to ~1e-4 on these magnitudes
    assert.ok(Math.abs(v - expected) < 1e-3, `seamless at ${gc},${gr}: ${v} vs ${expected}`);
  }
}

/* ------------------------------------------------------------------ */
/* Production fetch path (stubbed network)                            */
/* ------------------------------------------------------------------ */

{
  const wide: Bbox = { lonMin: 36.9, latMin: -1.1, lonMax: 37.1, latMax: -0.9 };
  const calls: string[] = [];
  const result = await fetchDemGrid(
    wide,
    { targetResM: 30 },
    {
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        const u = String(url);
        calls.push(u);
        const item = new URL(u).searchParams.get("item")!;
        const body = JSON.parse(String(init?.body)) as {
          bbox: [number, number, number, number];
        };
        const [lonMin, latMin, lonMax, latMax] = body.bbox;
        // Build the crop at the same pixel scale the planner chose.
        const plan = planDemFetch(wide, { targetResM: 30 });
        const w = Math.ceil((lonMax - lonMin) / plan.dLonDeg);
        const h = Math.ceil((latMax - latMin) / plan.dLatDeg);
        const tiff = buildCropTiff({
          width: w,
          height: h,
          west: lonMin,
          north: latMax,
          dLonDeg: plan.dLonDeg,
          dLatDeg: plan.dLatDeg,
          samplesPerPixel: 2,
          rowsPerStrip: 8,
          elevAt: (c, r) => 100 + (lonMin + (c + 0.5) * plan.dLonDeg) * 10 + (latMax - (r + 0.5) * plan.dLatDeg) * 10,
        });
        return new Response(tiff, { status: 200 });
      }) as typeof fetch,
    },
  );
  assert.strictEqual(calls.length, 4, "one POST per intersecting tile");
  assert.ok(calls[0].includes("collection=cop-dem-glo-30"));
  assert.ok(calls[0].includes("/item/crop.tif"));
  assert.strictEqual(result.tileBytes.length, 4, "per-tile byte disclosure");
  assert.ok(result.grid.validCount > 0, "mosaic has data");
  // Continuity across the seam: neighbouring cells around lon=37 differ by
  // the smooth field step (10 * dLonDeg), never by a tile-edge cliff.
  const plan = result.plan;
  const seamCol = Math.round((37 - plan.west) / plan.dLonDeg - 0.5);
  let maxStep = 0;
  for (let r = 1; r < plan.height - 1; r++) {
    const a = result.grid.values[r * plan.width + seamCol];
    const b = result.grid.values[r * plan.width + seamCol + 1];
    if (Number.isFinite(a) && Number.isFinite(b)) maxStep = Math.max(maxStep, Math.abs(a - b));
  }
  assert.ok(maxStep < 1.0, `no seam cliff at lon=37 (max step ${maxStep})`);

  // HTTP failure surfaces a human message naming the tile
  await assert.rejects(
    fetchDemGrid(wide, {}, { fetchImpl: (async () => new Response("nope", { status: 500 })) as typeof fetch }),
    /GLO-30 crop for Copernicus_DSM_COG_10_S02_00_E036_00_DEM returned HTTP 500/,
  );
}

console.log("dem-copernicus: all assertions passed");
