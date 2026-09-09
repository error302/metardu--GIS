/**
 * Unit Test — Spatial index parity vs brute force.
 * Guarantees the indexed engines (MCDA, clustering, hit-testing) return
 * identical results to the legacy linear scans.
 */

import { UniformGridIndex, SegmentIndex, XY } from "../src/core/spatial-index";
import { pointToSegmentDistance } from "../src/core/buffer-engine";

console.log("=== SPATIAL INDEX PARITY TEST SUITE ===");

// Deterministic PRNG (mulberry32)
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(1234);

// Build a mixed-scale point cloud
interface P extends XY {
  label: number;
}
const items: P[] = [];
for (let i = 0; i < 2000; i++) {
  items.push({ x: rand() * 4000 - 2000, y: rand() * 4000 - 2000, label: i });
}
// Add a dense clump to force many-items-per-cell
for (let i = 0; i < 500; i++) {
  items.push({ x: 10 + rand() * 5, y: 10 + rand() * 5, label: 10000 + i });
}
const index = new UniformGridIndex<P>(items, (p) => ({ x: p.x, y: p.y }));

// 1. Radius parity vs brute force
let radiusChecked = 0;
for (let q = 0; q < 200; q++) {
  const qx = rand() * 4400 - 2200;
  const qy = rand() * 4400 - 2200;
  const r = 5 + rand() * 300;
  const expected = items
    .filter((p) => Math.hypot(p.x - qx, p.y - qy) < r)
    .sort((a, b) => a.label - b.label);
  const got = index.radius(qx, qy, r).sort((a, b) => a.label - b.label);
  if (expected.length !== got.length || expected.some((p, i) => p.label !== got[i].label)) {
    console.error(`FAIL: radius mismatch at probe ${q} (expected ${expected.length}, got ${got.length})`);
    process.exit(1);
  }
  radiusChecked++;
}
console.log(`PASS: radius query parity (${radiusChecked} probes, ${items.length} items)`);

// 2. Nearest parity vs brute force
for (let q = 0; q < 200; q++) {
  const qx = rand() * 4400 - 2200;
  const qy = rand() * 4400 - 2200;
  let best: P | null = null;
  let bestD = Infinity;
  for (const p of items) {
    const d = Math.hypot(p.x - qx, p.y - qy);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  const hit = index.nearest(qx, qy);
  if (!hit || hit.item.label !== best!.label || Math.abs(hit.dist - bestD) > 1e-9) {
    console.error(`FAIL: nearest mismatch at probe ${q}`);
    process.exit(1);
  }
}
console.log("PASS: nearest-neighbour parity (200 probes incl. dense clump)");

// 3. Segment index parity vs brute-force linear scan
const polylines: XY[][] = [];
for (let l = 0; l < 40; l++) {
  const line: XY[] = [];
  let x = rand() * 3000 - 1500;
  let y = rand() * 3000 - 1500;
  for (let s = 0; s < 50; s++) {
    line.push({ x, y });
    x += (rand() - 0.5) * 120;
    y += (rand() - 0.5) * 120;
  }
  polylines.push(line);
}
const segIdx = new SegmentIndex(polylines);
const totalSegs = polylines.reduce((acc, l) => acc + l.length - 1, 0);
if (segIdx.segmentCount !== totalSegs) {
  console.error(`FAIL: segment count ${segIdx.segmentCount} != ${totalSegs}`);
  process.exit(1);
}

for (let q = 0; q < 200; q++) {
  const qx = rand() * 3200 - 1600;
  const qy = rand() * 3200 - 1600;
  let brute = Infinity;
  for (const line of polylines) {
    for (let i = 0; i < line.length - 1; i++) {
      brute = Math.min(
        brute,
        pointToSegmentDistance(qx, qy, line[i].x, line[i].y, line[i + 1].x, line[i + 1].y)
      );
    }
  }
  const got = segIdx.nearestDistance(qx, qy, pointToSegmentDistance);
  if (Math.abs(got - brute) > 1e-9) {
    console.error(`FAIL: segment distance mismatch at probe ${q}: indexed ${got} vs brute ${brute}`);
    process.exit(1);
  }
}
console.log("PASS: segment-index distance parity (200 probes, 2000 segments)");

// 4. Empty-index edge cases
const empty = new UniformGridIndex<P>([], (p) => p);
if (empty.nearest(0, 0) !== null || empty.radius(0, 0, 10).length !== 0) {
  console.error("FAIL: empty index behaviour");
  process.exit(1);
}
const emptySeg = new SegmentIndex([]);
if (emptySeg.nearestDistance(5, 5, pointToSegmentDistance) !== Infinity) {
  console.error("FAIL: empty segment index should return Infinity");
  process.exit(1);
}
console.log("PASS: empty-index edge cases");

console.log("\nALL SPATIAL INDEX TESTS PASSED");
