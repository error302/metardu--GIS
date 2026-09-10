/**
 * Edge-first CRDT test suite (Phase D).
 *
 * Proves the convergence contract on real project-shaped data:
 *   - Idempotency, commutativity, associativity of merge.
 *   - Concurrent scalar / point / weight edits resolve by (lamport, replica).
 *   - Tombstones: removal beats concurrent-stale upserts; later edits win.
 *   - Change-file round trip between two replicas converges to identical state.
 *   - Project ⇄ ops projection round trip preserves points and metadata.
 */

import { CrdtDoc, parseChangeFile, ChangeFile } from "../src/core/crdt/crdt";
import { snapshotToOps, buildChangeFile, docToProject } from "../src/core/crdt/project-crdt";
import { createProjectSnapshot, parseProjectFile } from "../src/core/project";
import { SurveyPoint } from "../src/types/spatial";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) console.log(`PASS: ${msg}`);
  else {
    console.error(`FAIL: ${msg}`);
    failures++;
  }
}

console.log("=== EDGE-FIRST CRDT TEST SUITE ===");

const pt = (id: string, e: number, n: number, elev = 1650): SurveyPoint => ({
  id, easting: e, northing: n, elevation: elev, rawCode: "BL", category: "boundary", description: id,
});

/* ---------------- 1. basic register semantics ---------------- */

{
  const a = new CrdtDoc("A");
  a.setScalar("project.name", "Alpha name");
  check(a.getScalar("project.name") === "Alpha name", "scalar set locally");
  check(a.clock === 1, "lamport advances on local op");
}

/* ---------------- 2. idempotency ---------------- */

{
  const a = new CrdtDoc("A");
  const op = a.upsertPoint(pt("B1", 100, 200));
  const b = new CrdtDoc("B");
  b.merge([op, op, op]);
  check(b.livePoints().length === 1 && b.opCount === 1, "duplicate ops are deduplicated (idempotent merge)");
}

/* ---------------- 3. commutativity ---------------- */

{
  // Two replicas concurrently edit the same project name and same point.
  const base = new CrdtDoc("BASE");
  const p1 = pt("B1", 100, 200);
  base.upsertPoint(p1);
  base.setScalar("project.name", "Base");
  const baseOps = [base.livePoints()[0]];

  const a = new CrdtDoc("A");
  a.merge(baseOps);
  a.setScalar("project.name", "Edit from A");
  a.upsertPoint(pt("B1", 111, 222)); // concurrent edit of B1

  const b = new CrdtDoc("B");
  b.merge(baseOps);
  b.setScalar("project.name", "Edit from B");
  b.upsertPoint(pt("B1", 333, 444)); // concurrent edit of B1

  // a merges b's log; b merges a's log — both orders.
  const aOps = [a.getScalar("project.name") ? { op: "set-scalar", id: "A:1", replica: "A", lamport: 1, ts: "", key: "project.name", value: "Edit from A" } as const : null].filter(Boolean);

  // Simpler: rebuild each side's ops deterministically for the exchange.
  const aDoc2 = new CrdtDoc("A2");
  aDoc2.merge(baseOps);
  const sA = aDoc2.setScalar("project.name", "Edit from A");
  const pA = aDoc2.upsertPoint(pt("B1", 111, 222));

  const bDoc2 = new CrdtDoc("B2");
  bDoc2.merge(baseOps);
  const sB = bDoc2.setScalar("project.name", "Edit from B");
  const pB = bDoc2.upsertPoint(pt("B1", 333, 444));

  const x = new CrdtDoc("X");
  x.merge(baseOps);
  x.merge([sA, pA, sB, pB]);
  const y = new CrdtDoc("Y");
  y.merge(baseOps);
  y.merge([sB, pB, sA, pA]); // opposite order

  check(x.getScalar("project.name") === y.getScalar("project.name"), "concurrent scalar edits converge (same winner both orders)");
  const xp = x.livePoints()[0];
  const yp = y.livePoints()[0];
  check(xp.easting === yp.easting && xp.northing === yp.northing, "concurrent point edits converge (same winner both orders)");
  check(xp.easting === 333 && xp.northing === 444, "higher lamport wins the point register");
}

/* ---------------- 4. associativity ---------------- */

{
  const a = new CrdtDoc("A");
  const s1 = a.setScalar("meta.title", "One");
  const b = new CrdtDoc("B");
  const s2 = b.setScalar("meta.title", "Two");
  const c = new CrdtDoc("C");
  const s3 = c.setScalar("meta.title", "Three");

  const r1 = new CrdtDoc("R1"); r1.merge([s1]); r1.merge([s2]); r1.merge([s3]);
  const r2 = new CrdtDoc("R2"); r2.merge([s3]); r2.merge([s1]); r2.merge([s2]);
  const r3 = new CrdtDoc("R3");
  r3.merge([s1, s2]);
  r3.merge([s3]);

  check(
    r1.getScalar("meta.title") === r2.getScalar("meta.title") && r1.getScalar("meta.title") === r3.getScalar("meta.title"),
    "three-way merge is associative (any grouping converges)",
  );
}

/* ---------------- 5. tombstones ---------------- */

{
  const a = new CrdtDoc("A");
  a.upsertPoint(pt("B1", 100, 200));
  const rm = a.removePoint("B1");
  check(a.livePoints().length === 0, "removed point disappears locally");

  const stale = new CrdtDoc("B");
  stale.merge([{ op: "upsert-point", id: "B0:1", replica: "B0", lamport: 1, ts: "", point: pt("B1", 100, 200) }]);
  stale.merge([rm]);
  check(stale.livePoints().length === 0, "tombstone beats a stale concurrent upsert");

  const fresh = new CrdtDoc("C");
  fresh.merge([rm]);
  fresh.merge([{ op: "upsert-point", id: "D0:9", replica: "D0", lamport: 9, ts: "", point: pt("B1", 555, 666) }]);
  check(fresh.livePoints().length === 1 && fresh.livePoints()[0].easting === 555, "strictly later upsert resurrects a removed point");
}

/* ---------------- 6. change-file round trip between replicas ---------------- */

{
  // Field crew (replica F) surveys; office (replica O) adjusts weights & renames.
  const f = new CrdtDoc("F");
  const projF = {
    format: "METARDU_GIS_PROJECT" as const,
    version: "1.0.0" as const,
    savedAt: "2026-09-10T08:00:00Z",
    projectName: "Rift Survey",
    crs: "Arc 1960 / UTM zone 37S",
    metadata: {
      id: "RIFT-1", title: "Rift Survey", locality: "Naivasha", country: "Kenya",
      crs: "Arc 1960 / UTM zone 37S", surveyorName: "F. Crew", registrationNo: "MISK-F",
      date: "2026-09-10", scale: "1:2,500", organization: "MetaRDU",
    },
    points: [pt("B1", 100, 200), pt("B2", 150, 210), pt("B3", 190, 260)],
    layers: [],
    offGridParams: { costPerKwSolar: 900, costPerKwhBattery: 300, demandPerHhKwh: 1.2, gridThresholdKm: 5, minMiniGridHh: 20, peakSunHours: 5.5, batteryAutonomyDays: 1 },
    mcdaWeights: { slopeWeight: 35, roadAccessWeight: 25, waterBufferWeight: 25, socialInfraWeight: 15, maxSlopeAllowed: 25, riparianBufferM: 30 },
  };
  const fOps = snapshotToOps(f, projF);

  const o = new CrdtDoc("O");
  o.merge(fOps);

  // Office renames the project and removes a spurious point, adds a control point.
  const oRename = o.setScalar("project.name", "Rift Survey (checked)");
  const oMeta = o.setScalar("meta.title", "Rift Survey (checked)");
  const oRm = o.removePoint("B3");
  const oAdd = o.upsertPoint(pt("CTRL-1", 500, 500, 1660));

  // Field crew, meanwhile, edits B1 coordinates (concurrent with office work).
  const fEdit = f.upsertPoint(pt("B1", 105, 205));

  // Exchange: full change files both ways (idempotent, dedup by op id).
  const fFile = buildChangeFile(f, [fEdit], "Rift Survey");
  const oFile = buildChangeFile(o, [oRename, oMeta, oRm, oAdd], "Rift Survey (checked)");

  // Each side applies the other's file.
  const fReport = f.merge(parseChangeFile(JSON.stringify(oFile)).ops);
  const oReport = o.merge(parseChangeFile(JSON.stringify(fFile)).ops);

  check(fReport.applied === 4 && oReport.applied === 1, "each side applies exactly the other's unseen ops");

  const mergedF = docToProject(f, { metadata: projF.metadata, layers: [], offGridParams: projF.offGridParams, mcdaWeights: projF.mcdaWeights });
  const mergedO = docToProject(o, { metadata: projF.metadata, layers: [], offGridParams: projF.offGridParams, mcdaWeights: projF.mcdaWeights });

  check(mergedF.projectName === mergedO.projectName && mergedF.projectName === "Rift Survey (checked)", "project rename converges");
  check(mergedF.points.length === mergedO.points.length, "point sets converge to the same size");
  const sorted = (ps: SurveyPoint[]) => ps.map((p) => p.id).sort().join(",");
  const ids = sorted(mergedF.points);
  check(sorted(mergedO.points) === ids && ids === "B1,B2,CTRL-1", "B3 tombstoned, CTRL-1 present on both replicas");
  const b1f = mergedF.points.find((p) => p.id === "B1")!;
  const b1o = mergedO.points.find((p) => p.id === "B1")!;
  check(b1f.easting === 105 && b1o.easting === 105, "field edit of B1 survives the merge on both replicas");
  check(mergedF.metadata.title === "Rift Survey (checked)", "metadata scalar merged from office replica");
}

/* ---------------- 7. project ⇄ ops round trip ---------------- */

{
  const src = new CrdtDoc("SRC");
  const proj = {
    format: "METARDU_GIS_PROJECT" as const,
    version: "1.0.0" as const,
    savedAt: "2026-09-10T08:00:00Z",
    projectName: "Roundtrip",
    crs: "EPSG:21037",
    metadata: {
      id: "RT-1", title: "Roundtrip", locality: "L", country: "Kenya",
      crs: "EPSG:21037", surveyorName: "S", registrationNo: "R",
      date: "2026-09-10", scale: "1:1,000", organization: "MetaRDU",
    },
    points: [pt("P1", 1, 2), pt("P2", 3, 4, 1655)],
    layers: [],
    offGridParams: { costPerKwSolar: 800, costPerKwhBattery: 250, demandPerHhKwh: 1, gridThresholdKm: 3, minMiniGridHh: 15, peakSunHours: 5, batteryAutonomyDays: 1 },
    mcdaWeights: { slopeWeight: 40, roadAccessWeight: 20, waterBufferWeight: 20, socialInfraWeight: 20, maxSlopeAllowed: 20, riparianBufferM: 25 },
  };
  const ops = snapshotToOps(src, proj);
  const dst = new CrdtDoc("DST");
  dst.merge(ops);
  const rebuilt = docToProject(dst, { metadata: proj.metadata, layers: [], offGridParams: proj.offGridParams, mcdaWeights: proj.mcdaWeights });

  const viaProjectFile = parseProjectFile(JSON.stringify(createProjectSnapshot({
    metadata: rebuilt.metadata,
    points: rebuilt.points,
    vectors: [], boundary: null, tin: null, contours: [], buffers: [],
    suitability: [], hazardSinks: [], exposedAssets: [], energyClusters: [],
    telemetries: [], totalDurationMs: 0,
  } as any)));

  check(viaProjectFile.points.length === 2 && viaProjectFile.points[1].id === "P2", "project roundtrip preserves the point schedule");
  check(rebuilt.projectName === "Roundtrip" && rebuilt.crs === "EPSG:21037", "project roundtrip preserves scalars");
  check(rebuilt.mcdaWeights.slopeWeight === 40, "weights register roundtrips");

  // Change file envelope round trip.
  const file = buildChangeFile(src, ops, "Roundtrip");
  const parsed: ChangeFile = parseChangeFile(JSON.stringify(file));
  check(parsed.format === "METARDU_CHANGES" && parsed.ops.length === ops.length, "change file envelope roundtrips");
  let threw = false;
  try { parseChangeFile('{"format":"NOPE"}'); } catch { threw = true; }
  check(threw, "foreign payloads are rejected");
}

console.log(failures === 0 ? "ALL EDGE-FIRST CRDT TESTS PASSED" : `${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
