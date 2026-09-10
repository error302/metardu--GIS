/**
 * OSM multipolygon assembly tests — ring primitives, fragment chaining,
 * containment classification, hole assignment, orientation normalization,
 * relation-level skip semantics, and the Overpass parser integration
 * (consumed-way dedupe, skip counting, orphan disclosure).
 */
import * as assert from "assert";
import {
  signedArea,
  isClosed,
  dedupeRing,
  pointInRing,
  orient,
  chainOpenWays,
  classifyRingsByContainment,
  assignInners,
  assembleRelation,
  RelationMemberInput,
  Ring,
} from "../src/core/osint/assembly";
import { parseOverpassResponse } from "../src/core/osint/overpass";

/* ---------------- ring primitives ---------------- */

{
  const ccw: Ring = [
    [0, 0],
    [2, 0],
    [2, 2],
    [0, 2],
    [0, 0],
  ];
  assert.ok(signedArea(ccw) > 0, "unit square CCW has positive signed area");
  assert.ok(signedArea([...ccw].reverse()) < 0, "reversed ring is negative");
  assert.strictEqual(Math.abs(signedArea(ccw)), 4, "2x2 square area = 4");

  assert.ok(isClosed(ccw), "ring with coincident ends is closed");
  assert.ok(!isClosed(ccw.slice(0, 4)), "open chain is not closed");

  const duped: Ring = [
    [0, 0],
    [0, 0],
    [1, 0],
    [1, 0],
    [1, 1],
    [1, 1],
    [0, 1],
    [0, 0],
  ];
  assert.strictEqual(dedupeRing(duped).length, 5, "consecutive duplicates collapse");

  assert.ok(pointInRing([0.5, 0.5], ccw), "center is inside");
  assert.ok(!pointInRing([5, 5], ccw), "far point is outside");
  assert.ok(!pointInRing([3, 1], ccw), "right of ring is outside");

  const cw = orient(ccw, false);
  assert.ok(signedArea(cw) < 0, "orient(wantCcw=false) makes CW");
  const ccwAgain = orient(cw, true);
  assert.ok(signedArea(ccwAgain) > 0, "orient(wantCcw=true) makes CCW");
  assert.strictEqual(ccwAgain.length, ccw.length, "orient preserves vertex count");
}

/* ---------------- fragment chaining ---------------- */

{
  // Two fragments forming a closed ring; the second ships reversed.
  const a: Ring = [
    [0, 0],
    [1, 0],
    [2, 0],
  ];
  const b: Ring = [
    [2, 2],
    [2, 1],
    [2, 0],
  ];
  const c: Ring = [
    [0, 2],
    [0, 0],
  ];
  const d: Ring = [
    [2, 2],
    [1, 2],
    [0, 2],
  ];
  const r1 = chainOpenWays([a, b, c, d]);
  assert.strictEqual(r1.rings.length, 1, "four fragments chain into one ring");
  assert.strictEqual(r1.leftover, 0, "no leftover fragments");
  assert.ok(isClosed(r1.rings[0]), "chained result is closed");
  assert.strictEqual(r1.rings[0].length, 8, "chain has 7 unique vertices + closure");

  const r2 = chainOpenWays([a, c]);
  assert.strictEqual(r2.rings.length, 0, "unclosable pair yields no ring");
  assert.strictEqual(r2.leftover, 1, "fragments merge into one dangling chain");

  // Input order must not matter.
  const r3 = chainOpenWays([d, c, b, a]);
  assert.strictEqual(r3.rings.length, 1, "order independence");
  assert.strictEqual(r3.rings[0].length, r1.rings[0].length, "same vertex count");
}

/* ---------------- classification + hole assignment ---------------- */

{
  const big: Ring = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ];
  const small: Ring = [
    [4, 4],
    [6, 4],
    [6, 6],
    [4, 6],
    [4, 4],
  ];
  const far: Ring = [
    [20, 20],
    [22, 20],
    [22, 22],
    [20, 22],
    [20, 20],
  ];

  const cls = classifyRingsByContainment([small, big, far]);
  assert.strictEqual(cls.outers.length, 2, "big + far are outers");
  assert.strictEqual(cls.inners.length, 1, "small is an inner");

  const { polygons, orphanInners } = assignInners([big, far], [small]);
  assert.strictEqual(polygons.length, 2, "two polygons");
  assert.strictEqual(orphanInners, 0, "hole assigned");
  const withHole = polygons.find((p) => p.inners.length > 0);
  assert.ok(withHole, "hole landed on the containing outer");
  assert.ok(Math.abs(signedArea(withHole!.outer)) > Math.abs(signedArea(small)), "outer is the big ring");

  const orphan = assignInners([big], [far]);
  assert.strictEqual(orphan.orphanInners, 1, "inner with no container is an orphan");
  assert.strictEqual(orphan.polygons[0].inners.length, 0, "orphan not attached");
}

/* ---------------- assembleRelation ---------------- */

const square = (x: number, y: number, s: number, closed = true): Ring => {
  const ring: Ring = [
    [x, y],
    [x + s, y],
    [x + s, y + s],
    [x, y + s],
  ];
  return closed ? [...ring, ring[0]] : ring;
};

{
  // Explicit roles, both closed — orientation normalized to RFC 7946.
  const out = assembleRelation([
    { ref: 1, role: "outer", coords: square(0, 0, 4) },
    { ref: 2, role: "inner", coords: square(1, 1, 1) },
  ]);
  assert.strictEqual(out.status, "assembled");
  if (out.status === "assembled") {
    assert.strictEqual(out.polygons.length, 1);
    assert.strictEqual(out.polygons[0].inners.length, 1);
    assert.ok(signedArea(out.polygons[0].outer) > 0, "outer normalized CCW");
    assert.ok(signedArea(out.polygons[0].inners[0]) < 0, "inner normalized CW");
  }
}

{
  // Open fragments (one ships reversed) chain into the outer ring.
  const west: Ring = [
    [0, 4],
    [0, 0],
  ];
  const north: Ring = [
    [0, 4],
    [4, 4],
  ];
  const southEast: Ring = [
    [4, 4],
    [4, 0],
    [0, 0],
  ];
  const out = assembleRelation([
    { ref: 1, role: "outer", coords: west },
    { ref: 2, role: "outer", coords: north },
    { ref: 3, role: "outer", coords: southEast },
    { ref: 4, role: "inner", coords: square(1, 1, 1) },
  ]);
  assert.strictEqual(out.status, "assembled");
  if (out.status === "assembled") {
    assert.strictEqual(out.polygons[0].outer.length, 5, "chained + closed ring");
    assert.strictEqual(out.polygons[0].inners.length, 1);
    assert.ok(signedArea(out.polygons[0].outer) > 0);
  }
}

{
  // Role-less members classify by containment (outer + hole).
  const out = assembleRelation([
    { ref: 1, role: "", coords: square(0, 0, 4) },
    { ref: 2, role: "", coords: square(1, 1, 1) },
  ]);
  assert.strictEqual(out.status, "assembled");
  if (out.status === "assembled") {
    assert.strictEqual(out.polygons.length, 1);
    assert.strictEqual(out.polygons[0].inners.length, 1, "roleless inner detected");
  }
}

{
  // Two outers, each with its own hole → multi-polygon assembly.
  const out = assembleRelation([
    { ref: 1, role: "outer", coords: square(0, 0, 4) },
    { ref: 2, role: "inner", coords: square(1, 1, 1) },
    { ref: 3, role: "outer", coords: square(10, 0, 4) },
    { ref: 4, role: "inner", coords: square(11, 1, 1) },
  ]);
  assert.strictEqual(out.status, "assembled");
  if (out.status === "assembled") {
    assert.strictEqual(out.polygons.length, 2, "two polygons");
    assert.ok(out.polygons.every((p) => p.inners.length === 1), "each keeps its hole");
  }
}

{
  // Missing member geometry skips the whole relation — no partial output.
  const missing: RelationMemberInput = { ref: 99, role: "outer", coords: null };
  const out = assembleRelation([
    { ref: 1, role: "outer", coords: square(0, 0, 4) },
    missing,
  ]);
  assert.deepStrictEqual(out, { status: "skipped", reason: "missing-member-geometry" });
}

{
  // Unclosable fragments skip the relation.
  const out = assembleRelation([
    { ref: 1, role: "outer", coords: square(0, 0, 4, false) },
    { ref: 2, role: "outer", coords: square(10, 10, 2, false) },
  ]);
  assert.deepStrictEqual(out, { status: "skipped", reason: "unclosed-rings" });
}

{
  // Degenerate ring (zero area) is dropped; valid outer still assembles.
  const degenerate: Ring = [
    [1, 1],
    [1, 1],
    [1, 1],
  ];
  const out = assembleRelation([
    { ref: 1, role: "outer", coords: square(0, 0, 4) },
    { ref: 2, role: "inner", coords: degenerate },
  ]);
  assert.strictEqual(out.status, "assembled");
  if (out.status === "assembled") assert.strictEqual(out.polygons[0].inners.length, 0);
}

/* ---------------- Overpass parser integration ---------------- */

{
  const doc = {
    elements: [
      // Tagged member way — must be CONSUMED by the relation, not duplicated.
      {
        type: "way",
        id: 5001,
        geometry: [
          { lat: 0, lon: 0 },
          { lat: 0, lon: 4 },
          { lat: 4, lon: 4 },
          { lat: 4, lon: 0 },
          { lat: 0, lon: 0 },
        ],
        tags: { landuse: "grass" },
      },
      // Untagged inner member — geometry resolved from the way element.
      {
        type: "way",
        id: 5002,
        geometry: [
          { lat: 1, lon: 1 },
          { lat: 1, lon: 2 },
          { lat: 2, lon: 2 },
          { lat: 2, lon: 1 },
          { lat: 1, lon: 1 },
        ],
      },
      {
        type: "relation",
        id: 6001,
        tags: { type: "multipolygon", landuse: "grass", name: "Park" },
        members: [
          { type: "way", ref: 5001, role: "outer" },
          { type: "way", ref: 5002, role: "inner" },
        ],
      },
      // Non-multipolygon relation — skipped, counted.
      {
        type: "relation",
        id: 6002,
        tags: { type: "route", route: "bus" },
        members: [{ type: "way", ref: 5001, role: "" }],
      },
      // Multipolygon with an absent member — skipped, counted.
      {
        type: "relation",
        id: 6003,
        tags: { type: "multipolygon", natural: "water" },
        members: [{ type: "way", ref: 424242, role: "outer" }],
      },
      // Orphan inner — outer still assembles, orphan disclosed.
      {
        type: "relation",
        id: 6004,
        tags: { type: "multipolygon", landuse: "forest" },
        members: [
          { type: "way", ref: 5001, role: "outer" },
          { type: "way", ref: 5002, role: "outer" },
          {
            type: "way",
            ref: 5003,
            role: "inner",
            geometry: [
              { lat: 30, lon: 30 },
              { lat: 30, lon: 31 },
              { lat: 31, lon: 31 },
              { lat: 31, lon: 30 },
              { lat: 30, lon: 30 },
            ],
          },
        ],
      },
    ],
  };

  const res = parseOverpassResponse(doc);
  assert.strictEqual(res.assembledRelations, 2, "park + forest relations assemble");
  assert.strictEqual(res.skippedRelations, 2, "route + incomplete multipolygon skipped");
  assert.strictEqual(res.orphanInners, 1, "orphan inner disclosed");

  const park = res.features.find((f) => f.osmId === 6001);
  assert.ok(park && park.kind === "polygon" && park.osmType === "relation");
  assert.strictEqual(park.parts.length, 2, "outer + inner rings on the feature");
  assert.strictEqual(park.parts[0].length, 5, "closed outer ring");
  assert.strictEqual(park.tags.name, "Park");

  assert.ok(!res.features.some((f) => f.osmType === "way" && f.osmId === 5001),
    "member way consumed — no duplicate standalone feature");

  const forest = res.features.find((f) => f.osmId === 6004);
  assert.ok(forest && forest.kind === "polygon");
  assert.strictEqual(forest.parts.length, 2, "outer + orphan outer consumed as second ring set");
}
