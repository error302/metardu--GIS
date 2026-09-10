/**
 * Benchmark harness — synthetic 10k/50k-point scenarios with hard budgets.
 * Budgets (UPGRADE-ROADMAP Phase A):
 *   pipeline @ 50k              < 2000 ms
 *   MCDA re-evaluation @ 50k    <  500 ms
 *   spatial index build @ 50k   <  250 ms
 *   radius / nearest p99        <  0.5 ms
 *   hazard audit @ 50k          <  200 ms
 *   energy clustering @ 50k     <  300 ms
 *   undo/redo command ops       <  50 ms per 1000 ops
 * Exits non-zero when any budget is breached (CI-gateable).
 */

import { generateSurveyDataset, BENCH_METADATA } from "./generate";
import { runAutonomousGisPipeline } from "../src/core/pipeline";
import {
  evaluateSuitabilityGrid,
  buildSuitabilityIndexContext,
  DEFAULT_MCDA_WEIGHTS,
} from "../src/core/mcda-suitability";
import { auditHazardExposure } from "../src/core/hazard-exposure";
import { modelEnergyClusters, DEFAULT_OFFGRID_PARAMS } from "../src/core/energy-catchment";
import { UniformGridIndex, SegmentIndex } from "../src/core/spatial-index";
import { CommandHistory } from "../src/core/history";
import { pointToSegmentDistance } from "../src/core/buffer-engine";
import { SurveyPoint } from "../src/types/spatial";

interface Row {
  name: string;
  budgetMs: number;
  ms: number;
  extra?: string;
}

function timeIt(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function main() {
  const rows: Row[] = [];
  let failed = false;

  console.log("=== MetaRDU GIS — Phase A Performance Benchmarks ===");
  console.log(`node ${process.version} | ${new Date().toISOString()}\n`);

  // JIT warmup: one small pipeline run so one-time engine init does not
  // pollute the first measured scenario.
  await runAutonomousGisPipeline(generateSurveyDataset(500), BENCH_METADATA as any);

  for (const n of [10_000, 50_000]) {
    const pts = generateSurveyDataset(n);
    const budgetPipeline = n === 50_000 ? 2000 : 600;

    // 1. Full pipeline
    const res = await runAutonomousGisPipeline(pts, BENCH_METADATA as any);
    rows.push({
      name: `pipeline @ ${n / 1000}k pts`,
      budgetMs: budgetPipeline,
      ms: res.totalDurationMs,
      extra: `${res.tin?.triangles.length ?? 0} tris, ${res.contours.length} contours`,
    });

    if (n === 50_000) {
      const tin = res.tin!;
      const vectors = res.vectors;

      // 2. MCDA re-evaluation (worst interactive path: weight slider drag).
      // The panel amortizes index construction, so measure the warm path.
      const mcdaCtx = buildSuitabilityIndexContext(tin, vectors);
      const mcdaBuildMs = timeIt(() => buildSuitabilityIndexContext(tin, vectors));
      rows.push({ name: "mcda index build @ 50k", budgetMs: 500, ms: mcdaBuildMs });
      const mcdaMs = timeIt(() => {
        const cells = evaluateSuitabilityGrid(tin, vectors, DEFAULT_MCDA_WEIGHTS, 20, mcdaCtx);
        if (cells.length === 0) throw new Error("MCDA produced no cells");
      });
      rows.push({ name: "mcda re-eval (warm) @ 50k", budgetMs: 500, ms: mcdaMs });

      // 3. Spatial index build
      const idx = new UniformGridIndex<SurveyPoint>(pts, (p) => ({ x: p.easting, y: p.northing }));
      const buildMs = timeIt(() => {
        const i2 = new UniformGridIndex<SurveyPoint>(pts, (p) => ({ x: p.easting, y: p.northing }));
        if (i2.size !== pts.length) throw new Error("index lost items");
      });
      rows.push({ name: "index build @ 50k", budgetMs: 250, ms: buildMs, extra: `${idx.size} items` });

      // 4. Query latency: radius + nearest, 500 probes each
      const probes: [number, number][] = [];
      for (let i = 0; i < 500; i++) {
        const p = pts[Math.floor((i * 7919) % pts.length)];
        probes.push([p.easting, p.northing]);
      }
      const radiusTimes: number[] = [];
      const nearestTimes: number[] = [];
      for (const [x, y] of probes) {
        let t0 = performance.now();
        idx.radius(x, y, 60);
        radiusTimes.push(performance.now() - t0);
        t0 = performance.now();
        idx.nearest(x, y);
        nearestTimes.push(performance.now() - t0);
      }
      const p99 = Math.max(percentile(radiusTimes, 99), percentile(nearestTimes, 99));
      rows.push({ name: "query p99 (radius+nearest)", budgetMs: 0.5, ms: p99 });

      // 5. Hazard audit standalone
      const hazardMs = timeIt(() => auditHazardExposure(tin, pts));
      rows.push({ name: "hazard audit @ 50k", budgetMs: 200, ms: hazardMs });

      // 6. Energy clustering standalone
      const energyMs = timeIt(() =>
        modelEnergyClusters(pts, vectors, DEFAULT_OFFGRID_PARAMS)
      );
      rows.push({ name: "energy clustering @ 50k", budgetMs: 300, ms: energyMs });

      // 7. Segment index (MCDA's distance field) — build + 200 queries
      const polylines = vectors
        .filter((v) => v.category === "road" || v.category === "water")
        .map((v) => v.points.map((p) => ({ x: p.easting, y: p.northing })));
      const segBuildMs = timeIt(() => new SegmentIndex(polylines));
      const segIdx = new SegmentIndex(polylines);
      let brute = Infinity;
      const segQueryTimes: number[] = [];
      for (let i = 0; i < 200; i++) {
        const p = pts[Math.floor((i * 6271) % pts.length)];
        const t0 = performance.now();
        const d = segIdx.nearestDistance(p.easting, p.northing, pointToSegmentDistance);
        segQueryTimes.push(performance.now() - t0);
        if (i === 0) {
          for (const pl of polylines) {
            for (let k = 0; k < pl.length - 1; k++) {
              brute = Math.min(
                brute,
                pointToSegmentDistance(p.easting, p.northing, pl[k].x, pl[k].y, pl[k + 1].x, pl[k + 1].y)
              );
            }
          }
          if (Math.abs(d - brute) > 1e-9) {
            throw new Error(`SegmentIndex parity broken: ${d} vs ${brute}`);
          }
        }
      }
      rows.push({
        name: "segment index build @ 50k",
        budgetMs: 250,
        ms: segBuildMs,
        extra: `${segIdx.segmentCount} segments`,
      });
      rows.push({ name: "segment nearest p99", budgetMs: 0.5, ms: percentile(segQueryTimes, 99) });
    }
  }

  // 8. Undo/redo command throughput
  {
    const store = new CommandHistory<number>(0, "init");
    let acc = 0;
    const opsMs = timeIt(() => {
      for (let i = 1; i <= 1000; i++) store.push(i, `op ${i}`);
      for (let i = 0; i < 500; i++) acc += store.undo() ?? 0;
      for (let i = 0; i < 500; i++) acc += store.redo() ?? 0;
    });
    if (acc === -1) console.log("unreachable");
    rows.push({ name: "undo/redo 1000 ops", budgetMs: 50, ms: opsMs });
  }

  // Report
  console.log(
    "benchmark".padEnd(32) + "measured".padStart(12) + "budget".padStart(12) + "   verdict"
  );
  console.log("-".repeat(66));
  for (const r of rows) {
    const ok = r.ms <= r.budgetMs;
    if (!ok) failed = true;
    console.log(
      r.name.padEnd(32) +
        `${r.ms.toFixed(2)} ms`.padStart(12) +
        `${r.budgetMs} ms`.padStart(12) +
        (`   ${ok ? "PASS" : "FAIL"}`) +
        (r.extra ? `   (${r.extra})` : "")
    );
  }

  console.log(failed ? "\nRESULT: FAIL — budget breach" : "\nRESULT: PASS — all budgets honoured");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("Benchmark crashed:", err);
  process.exit(1);
});
