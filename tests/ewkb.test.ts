/**
 * PostGIS EWKB parser tests — hand-built EWKB values (SRID flag, Z/M flags,
 * collections with nested byte-order bytes) plus hex/binary equivalence.
 */
import * as assert from "assert";
import { parseEwkb, parseEwkbHex } from "../src/core/postgis/ewkb";

/* ---------- 1. Point with SRID (little endian) ---------- */
// SRID=21037 POINT(500000 9990000)
{
  const buf = new ArrayBuffer(1 + 4 + 4 + 4 + 16);
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o++, 1); // LE
  v.setUint32(o, 0x20000001, true); o += 4; // SRID flag + type 1
  v.setInt32(o, 21037, true); o += 4;
  v.setFloat64(o, 500000, true); o += 8;
  v.setFloat64(o, 9990000, true); o += 8;
  const r = parseEwkb(buf);
  assert.strictEqual(r.srid, 21037);
  assert.strictEqual(r.geoms.length, 1);
  assert.strictEqual(r.geoms[0].kind, "point");
  if (r.geoms[0].kind === "point") {
    assert.strictEqual(r.geoms[0].coord.x, 500000);
    assert.strictEqual(r.geoms[0].coord.y, 9990000);
  }
  // Hex path must agree byte-for-byte
  const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const rh = parseEwkbHex(hex);
  assert.deepStrictEqual(rh, r);
}

/* ---------- 2. PointZ (big endian, ISO-style flags) ---------- */
// POINT Z(36.82 -1.29 1800.5), srid 4326 — big endian
{
  const buf = new ArrayBuffer(1 + 4 + 4 + 24);
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o++, 0); // BE
  v.setUint32(o, 0x20000000 | 0x80000000 | 1, false); o += 4; // SRID + Z + type 1
  v.setInt32(o, 4326, false); o += 4;
  v.setFloat64(o, 36.82, false); o += 8;
  v.setFloat64(o, -1.29, false); o += 8;
  v.setFloat64(o, 1800.5, false); o += 8;
  const r = parseEwkb(buf);
  assert.strictEqual(r.srid, 4326);
  const g = r.geoms[0];
  assert.strictEqual(g.kind, "point");
  if (g.kind === "point") {
    assert.strictEqual(g.coord.z, 1800.5);
  }
}

/* ---------- 3. MultiPoint flattens to member points ---------- */
// MULTIPOINT((1 2),(3 4)) — no SRID
{
  const buf = new ArrayBuffer(1 + 4 + 4 + 2 * (1 + 4 + 16));
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o++, 1);
  v.setUint32(o, 4, true); o += 4; // MULTIPOINT
  v.setUint32(o, 2, true); o += 4;
  // member 1
  v.setUint8(o++, 1);
  v.setUint32(o, 1, true); o += 4;
  v.setFloat64(o, 1, true); o += 8;
  v.setFloat64(o, 2, true); o += 8;
  // member 2
  v.setUint8(o++, 1);
  v.setUint32(o, 1, true); o += 4;
  v.setFloat64(o, 3, true); o += 8;
  v.setFloat64(o, 4, true); o += 8;
  const r = parseEwkb(buf);
  assert.strictEqual(r.srid, null);
  assert.strictEqual(r.geoms.length, 2);
  assert.ok(r.geoms.every((g) => g.kind === "point"));
}

/* ---------- 4. GeometryCollection with mixed members ---------- */
{
  // Build: COLLECTION( POINT(0 0), LINESTRING(0 0, 5 5) )
  const pointPart = new Uint8Array(1 + 4 + 16);
  let pv = new DataView(pointPart.buffer);
  pointPart[0] = 1; pv.setUint32(1, 1, true); pv.setFloat64(5, 0, true); pv.setFloat64(13, 0, true);
  const linePart = new Uint8Array(1 + 4 + 4 + 32);
  let lv = new DataView(linePart.buffer);
  linePart[0] = 1; lv.setUint32(1, 2, true); lv.setUint32(5, 2, true);
  lv.setFloat64(9, 0, true); lv.setFloat64(17, 0, true); lv.setFloat64(25, 5, true); lv.setFloat64(33, 5, true);
  const header = new ArrayBuffer(1 + 4 + 4);
  let hv = new DataView(header);
  let o = 0;
  hv.setUint8(o++, 1); hv.setUint32(o, 7, true); o += 4; hv.setUint32(o, 2, true); o += 4;
  const merged = new Uint8Array(header.byteLength + pointPart.length + linePart.length);
  merged.set(new Uint8Array(header), 0);
  merged.set(pointPart, header.byteLength);
  merged.set(linePart, header.byteLength + pointPart.length);
  const r = parseEwkb(merged.buffer);
  assert.strictEqual(r.geoms.length, 2);
  assert.strictEqual(r.geoms[0].kind, "point");
  assert.strictEqual(r.geoms[1].kind, "line");
}

/* ---------- 5. Polygon + malformed input ---------- */
{
  // POLYGON((0 0, 10 0, 10 10, 0 10, 0 0)) — LE, closed ring decodes with 5 positions
  const coords = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]] as [number, number][];
  const buf = new ArrayBuffer(1 + 4 + 4 + 4 + coords.length * 16);
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o++, 1);
  v.setUint32(o, 3, true); o += 4;
  v.setUint32(o, 1, true); o += 4; // rings
  v.setUint32(o, coords.length, true); o += 4;
  for (const [x, y] of coords) { v.setFloat64(o, x, true); o += 8; v.setFloat64(o, y, true); o += 8; }
  const r = parseEwkb(buf);
  assert.strictEqual(r.geoms[0].kind, "polygon");
  if (r.geoms[0].kind === "polygon") assert.strictEqual(r.geoms[0].rings[0].length, 5);

  assert.throws(() => parseEwkbHex("xyz"), /malformed/);
  assert.throws(() => parseEwkbHex("0101000000AA"), /malformed|truncated/); // odd length
}

console.log("ewkb.test.ts: ALL ASSERTIONS PASSED");
