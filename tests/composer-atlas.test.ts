/**
 * Atlas Series planner tests — uniform-scale tiling must be deterministic,
 * cover the extent, honour the sheet cap, name sheets atlas-style, and
 * disclose (never silently clamp) cap breaches.
 */
import * as assert from "assert";
import {
  ATLAS_SCALE_SERIES,
  AtlasPlan,
  atlasExtentFromResult,
  atlasFrameBox,
  atlasSheetByLabel,
  planAtlasSeries,
} from "../src/core/composer/atlas";
import { pageDimsMm } from "../src/core/composer/template";
import { PipelineResult, SurveyPoint } from "../src/types/spatial";

const A3L = { size: "A3" as const, orientation: "landscape" as const };

/* ---------- Fixture (mirrors composer.test.ts) ---------- */

function pt(id: string, e: number, n: number, z = 100): SurveyPoint {
  return { id, easting: e, northing: n, elevation: z, rawCode: "BND", category: "boundary", description: id };
}

const BOUNDARY_PTS = [pt("B1", 5000, 8000), pt("B2", 5200, 8000), pt("B3", 5200, 8150), pt("B4", 5000, 8150)];

function makeResult(): PipelineResult {
  return {
    metadata: {
      id: "T-01", title: "Test Parcel", locality: "Test Locality", country: "Kenya",
      crs: "Arc 1960 / UTM zone 37S", surveyorName: "J. Surveyor", registrationNo: "MISK-TEST",
      date: "2026-09-10", scale: "1:1,250", organization: "MetaRDU QA",
    },
    points: [...BOUNDARY_PTS, pt("X1", 5100, 8075), pt("X2", 5150, 8100)],
    vectors: [{
      id: "v1", code: "RD", name: "Access Road", category: "road", layer: "roads",
      points: [pt("R1", 4980, 7990), pt("R2", 5230, 8210)], isClosed: false,
      color: "#8a6d3b", lineType: "solid", lineWidth: 1.5,
    }],
    boundary: {
      id: "bnd", name: "Parcel", parcelNo: "LR-TEST/1", points: BOUNDARY_PTS,
      perimeterM: 700, areaSqM: 30000, areaHa: 3.0, areaAcres: 7.41,
      isClosed: true, linearMisclosureM: 0.042, precisionRatio: 5000,
      precisionRating: "Class A (Urban)",
      bearingsDistances: [],
    },
    tin: null,
    contours: [],
    buffers: [],
    suitability: [],
    hazardSinks: [],
    exposedAssets: [],
    energyClusters: [],
    telemetries: [],
    totalDurationMs: 0,
  };
}

/* ---------- 1. Frame box geometry ---------- */
{
  const box = atlasFrameBox(A3L);
  const page = pageDimsMm(A3L);
  assert.deepStrictEqual(page, { w: 420, h: 297 });
  assert.strictEqual(box.x, 14);
  assert.strictEqual(box.y, 33);
  assert.strictEqual(box.w, 420 - 28);
  assert.strictEqual(box.h, 297 - 33 - 16);
  console.log("PASS: atlas frame box derives from page dimensions");
}

/* ---------- 2. Extent derivation from a pipeline result ---------- */
{
  const ext = atlasExtentFromResult(makeResult());
  // Union of boundary (5000..5200, 8000..8150), vector (4980..5230, 7990..8210), points
  assert.ok(ext, "extent should derive from a populated document");
  assert.strictEqual(ext!.minE, 4980);
  assert.strictEqual(ext!.maxE, 5230);
  assert.strictEqual(ext!.minN, 7990);
  assert.strictEqual(ext!.maxN, 8210);
  const empty = makeResult();
  empty.points = [];
  empty.vectors = [];
  empty.boundary = null;
  assert.strictEqual(atlasExtentFromResult(empty), null);
  console.log("PASS: extent derivation (union bbox, null on empty)");
}

/* ---------- 3. Auto scale selection: known tiling ---------- */
// 10 km x 6 km extent on A3L, cap 9. Frame box 392 x 248 mm.
// 1:5000  -> ground 1960x1240, cols=6, rows=6 -> 36 > 9.
// 1:10000 -> ground 3920x2480, step 3528/2232, cols=3, rows=3 -> 9 <= 9 => chosen.
{
  const plan = planAtlasSeries({
    extent: { minE: 0, maxE: 10000, minN: 0, maxN: 6000 },
    page: A3L,
    scaleDenominator: null,
    maxSheets: 9,
    overlapFrac: 0.10,
  });
  assert.ok(plan, "plan should build");
  assert.strictEqual(plan!.scaleDenominator, 10000);
  assert.strictEqual(plan!.cols, 3);
  assert.strictEqual(plan!.rows, 3);
  assert.strictEqual(plan!.sheets.length, 9);
  assert.ok(plan!.withinCap);
  assert.strictEqual(plan!.disclosure, null);
  assert.strictEqual(plan!.groundW, 3920);
  assert.strictEqual(plan!.groundH, 2480);
  console.log("PASS: auto scale picks the largest series scale fitting the cap");
}

/* ---------- 4. Coverage and symmetric centring ---------- */
{
  const plan = planAtlasSeries({
    extent: { minE: 0, maxE: 10000, minN: 0, maxN: 6000 },
    page: A3L, scaleDenominator: null, maxSheets: 9, overlapFrac: 0.10,
  })!;
  // Every corner of the source extent falls inside some sheet.
  const inside = (e: number, n: number) =>
    plan.sheets.some(
      (s) => e >= s.extent.minE && e <= s.extent.maxE && n >= s.extent.minN && n <= s.extent.maxN,
    );
  for (const [e, n] of [[0, 0], [10000, 0], [0, 6000], [10000, 6000], [5000, 3000]]) {
    assert.ok(inside(e, n), `extent corner (${e},${n}) must be covered`);
  }
  // Symmetric overhang: E span 2*3528 + 3920 = 10976 -> 488 per side;
  // N span 2*2232 + 2480 = 6944 -> 472 per side.
  assert.ok(Math.abs(plan.coverage.minE + 488) < 1e-6);
  assert.ok(Math.abs(plan.coverage.maxE - 10488) < 1e-6);
  assert.ok(Math.abs(plan.coverage.minN + 472) < 1e-6);
  assert.ok(Math.abs(plan.coverage.maxN - 6472) < 1e-6);
  console.log("PASS: tiling covers the extent with symmetric centred overhang");
}

/* ---------- 5. Overlap geometry ---------- */
{
  const plan = planAtlasSeries({
    extent: { minE: 0, maxE: 10000, minN: 0, maxN: 6000 },
    page: A3L, scaleDenominator: null, maxSheets: 9, overlapFrac: 0.10,
  })!;
  const a1 = plan.sheets.find((s) => s.label === "A1")!;
  const a2 = plan.sheets.find((s) => s.label === "A2")!;
  // Adjacent sheets overlap by exactly groundW * overlap.
  assert.ok(Math.abs(a1.extent.maxE - a2.extent.minE - plan.groundW * 0.10) < 1e-6);
  assert.ok(Math.abs(a2.extent.minE - (a1.extent.minE + plan.stepE)) < 1e-6);
  console.log("PASS: neighbour sheets overlap by the planned fraction");
}

/* ---------- 6. Naming and neighbours ---------- */
{
  const plan = planAtlasSeries({
    extent: { minE: 0, maxE: 10000, minN: 0, maxN: 6000 },
    page: A3L, scaleDenominator: null, maxSheets: 9, overlapFrac: 0.10,
  })!;
  // 3 cols x 3 rows: reading order from the NW corner; row A is the
  // northernmost band, so the A-row comes first in reading order.
  assert.deepStrictEqual(
    plan.sheets.map((s) => s.label),
    ["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3"],
  );
  assert.deepStrictEqual(
    plan.sheets.map((s) => s.index),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  const b2 = atlasSheetByLabel(plan, "B2")!;
  assert.deepStrictEqual(b2.neighbors, { n: "A2", e: "B3", s: "C2", w: "B1" });
  const a1 = atlasSheetByLabel(plan, "A1")!;
  assert.deepStrictEqual(a1.neighbors, { n: null, e: "A2", s: "B1", w: null });
  const c3 = atlasSheetByLabel(plan, "C3")!;
  assert.strictEqual(c3.neighbors.e, null);
  assert.strictEqual(c3.neighbors.s, null);
  assert.strictEqual(atlasSheetByLabel(plan, "Z9"), null);
  // Row A (north) sits at LARGER northings than row B.
  assert.ok(a1.extent.minN > b2.extent.minN);
  console.log("PASS: atlas naming (A=north), reading order, neighbour graph");
}

/* ---------- 7. Fixed-scale mode discloses cap breaches ---------- */
{
  const plan = planAtlasSeries({
    extent: { minE: 0, maxE: 10000, minN: 0, maxN: 6000 },
    page: A3L, scaleDenominator: 25000, maxSheets: 9, overlapFrac: 0.10,
  })!;
  assert.strictEqual(plan.scaleDenominator, 25000);
  assert.strictEqual(plan.cols, 2);
  assert.strictEqual(plan.rows, 2);
  assert.ok(plan.withinCap);

  // 1:2000 -> ground 784x496 m -> cols=15, rows=14 = 210 sheets: honoured
  // (under the 1000-tile ceiling) but over the 4-sheet cap -> disclosed.
  const absurd = planAtlasSeries({
    extent: { minE: 0, maxE: 10000, minN: 0, maxN: 6000 },
    page: A3L, scaleDenominator: 2000, maxSheets: 4, overlapFrac: 0.10,
  })!;
  assert.strictEqual(absurd.sheets.length, 210);
  assert.ok(!absurd.withinCap);
  assert.ok(absurd.disclosure && /exceeds the 4-sheet cap/.test(absurd.disclosure));

  // 1:250 would tile into 2964 sheets — past the hard tile ceiling, the
  // planner refuses outright rather than building an absurd plan.
  assert.strictEqual(
    planAtlasSeries({
      extent: { minE: 0, maxE: 10000, minN: 0, maxN: 6000 },
      page: A3L, scaleDenominator: 250, maxSheets: 4, overlapFrac: 0.10,
    }),
    null,
  );
  console.log("PASS: fixed scale honoured; cap breach disclosed; absurd tilings refused");
}

/* ---------- 8. Auto mode exhausts the series ---------- */
{
  // Huge extent with a 1-sheet cap: no series scale fits.
  const plan = planAtlasSeries({
    extent: { minE: 0, maxE: 2_000_000, minN: 0, maxN: 2_000_000 },
    page: A3L, scaleDenominator: null, maxSheets: 1, overlapFrac: 0.10,
  })!;
  assert.strictEqual(plan.scaleDenominator, ATLAS_SCALE_SERIES[ATLAS_SCALE_SERIES.length - 1]);
  assert.ok(!plan.withinCap);
  assert.ok(plan.disclosure && /exceeds the 1-sheet cap even at/.test(plan.disclosure));
  console.log("PASS: exhausted series falls back to the coarsest scale with disclosure");
}

/* ---------- 9. Degenerate and tiny inputs ---------- */
{
  assert.strictEqual(
    planAtlasSeries({ extent: { minE: 0, maxE: 0, minN: 0, maxN: 100 }, page: A3L, scaleDenominator: null }),
    null,
  );
  const tiny = planAtlasSeries({
    extent: { minE: 5000, maxE: 5100, minN: 8000, maxN: 8100 },
    page: A3L, scaleDenominator: null, overlapFrac: 0.10,
  })!;
  // 1:250 ground 98x62 m -> 2x2 = 4 sheets <= cap 9, so the LARGEST fitting
  // scale is 1:250 and the tiny parcel tiles into four sheets (A-row north).
  assert.strictEqual(tiny.scaleDenominator, 250);
  assert.strictEqual(tiny.sheets.length, 4);
  assert.strictEqual(tiny.sheets[0].label, "A1");
  assert.ok(tiny.withinCap);
  console.log("PASS: degenerate extent rejected; sub-sheet extent yields a single A1 sheet");
}

/* ---------- 10. Determinism ---------- */
{
  const opts = {
    extent: { minE: 0, maxE: 12345, minN: 0, maxN: 6789 },
    page: A3L, scaleDenominator: null, maxSheets: 9, overlapFrac: 0.15,
  };
  const a: AtlasPlan = planAtlasSeries(opts)!;
  const b: AtlasPlan = planAtlasSeries({ ...opts })!;
  assert.deepStrictEqual(a, b);
  // No NaN/Infinity anywhere in the serialised plan.
  assert.ok(!/NaN|Infinity/.test(JSON.stringify(a)));
  console.log("PASS: planning is deterministic and NaN-free");
}

/* ---------- 11. Sheet renderer ---------- */
import { renderAtlasSheet, renderAtlasIndexSheet } from "../src/core/composer/atlas-render";
import { renderTemplate, validateSheetSvg } from "../src/core/composer/render";

{
  const plan = planAtlasSeries({
    extent: { minE: 0, maxE: 10000, minN: 0, maxN: 6000 },
    page: A3L, scaleDenominator: null, maxSheets: 9, overlapFrac: 0.10,
  })!;
  const result = makeResult();
  // Reposition the fixture near the atlas extent so the sheet shows content.
  const shifted = makeResult();
  shifted.points = shifted.points.map((p) => ({ ...p, easting: p.easting + 1200, northing: p.northing + 1300 }));
  shifted.vectors = shifted.vectors.map((v) => ({
    ...v, points: v.points.map((p) => ({ ...p, easting: p.easting + 1200, northing: p.northing + 1300 })),
  }));
  shifted.boundary = {
    ...shifted.boundary!,
    points: shifted.boundary!.points.map((p) => ({ ...p, easting: p.easting + 1200, northing: p.northing + 1300 })),
  };

  const sheet = renderAtlasSheet(plan, plan.sheets[4], shifted); // B2, a fully interior sheet
  assert.ok(!/NaN|Infinity|undefined/.test(sheet.svg), "no NaN/Infinity in sheet SVG");
  assert.deepStrictEqual(validateSheetSvg(sheet.svg), []);
  assert.ok(sheet.svg.includes("SHEET B2"));
  assert.ok(sheet.svg.includes("Sheet 5 of 9"));
  // Interior sheet carries four neighbour go-to tabs.
  for (const nb of ["A2", "B3", "C2", "B1"]) {
    assert.ok(sheet.svg.includes(nb), `neighbour label ${nb} must appear`);
  }
  // Graticule lines sit at absolute round grid values (continuous across
  // sheets). B2 spans E 3040..6960 -> 1 km lines at 4,000/5,000/6,000;
  // N 1760..4240 -> 500 m lines at 2,000/2,500/3,000/3,500/4,000.
  assert.ok(sheet.svg.includes("4,000 m E"), "eastings labelled at absolute km grid");
  assert.ok(sheet.svg.includes("2,000 m N"), "northings labelled at absolute 500 m grid");
  // Footer identity line.
  assert.ok(sheet.svg.includes("SHEET B2 (5 OF 9)"));
  assert.ok(sheet.svg.includes("1:10,000"));
  assert.ok(sheet.svg.includes("Arc 1960 / UTM zone 37S"));
  // Edge sheet drops the missing-neighbour tab.
  const corner = renderAtlasSheet(plan, plan.sheets[0], shifted); // A1: no N, no W
  assert.ok(!corner.svg.includes("\u2191"), "corner sheet has no north tab");
  assert.ok(!corner.svg.includes("\u2190"), "corner sheet has no west tab");
  assert.ok(corner.svg.includes("A2"));
  assert.ok(corner.svg.includes("B1"));
  // Foreign sheet label is refused.
  assert.throws(() => renderAtlasSheet(plan, { ...plan.sheets[0], label: "Z9" }, shifted));
  // Determinism.
  assert.strictEqual(renderAtlasSheet(plan, plan.sheets[4], shifted).svg, sheet.svg);
  console.log("PASS: atlas sheet renders identity, neighbours, graticule, footer");
}

/* ---------- 12. Index sheet ---------- */
{
  const plan = planAtlasSeries({
    extent: { minE: 0, maxE: 10000, minN: 0, maxN: 6000 },
    page: A3L, scaleDenominator: null, maxSheets: 9, overlapFrac: 0.10,
  })!;
  const result = makeResult();
  const index = renderAtlasIndexSheet(plan, result);
  assert.ok(!/NaN|Infinity|undefined/.test(index.svg));
  assert.deepStrictEqual(validateSheetSvg(index.svg), []);
  assert.ok(index.svg.includes("SHEET INDEX"));
  for (const s of plan.sheets) assert.ok(index.svg.includes(s.label), `index must show ${s.label}`);
  assert.ok(index.svg.includes("PROJECT EXTENT"));
  assert.ok(index.svg.includes("approximate scale"));
  assert.ok(index.svg.includes("10% sheet overlap"));
  assert.strictEqual(renderAtlasIndexSheet(plan, result).svg, index.svg);
  console.log("PASS: index sheet lists every sheet and the project extent");
}

/* ---------- 13. extentOverride integration (renderTemplate) ---------- */
{
  const result = makeResult();
  // Inside-extent vector should draw; the same vector far outside the
  // override must be filtered by the frame.
  const frame = {
    kind: "map-frame" as const, id: "ov", x: 20, y: 40, w: 200, h: 120,
    fit: "features" as const, scaleDenominator: 1000 as number | null,
    extentOverride: { minE: 4900, maxE: 5100, minN: 7950, maxN: 8050 },
    layers: { points: false, vectors: true, boundary: false, contours: false, suitability: false, hazards: false, energy: false, graticule: false },
  };
  const t: import("../src/core/composer/template").ComposerTemplate = {
    id: "t-override", title: "override", version: 1,
    page: { size: "A4", orientation: "landscape" },
    header: null, footer: null, elements: [frame],
  };
  const svg = renderTemplate(t, result).svg;
  assert.ok(svg.includes("<polyline"), "in-extent vector renders");
  assert.ok(!/NaN|Infinity/.test(svg));
  console.log("PASS: map frame honours the explicit extent override");
}

console.log("ALL ATLAS PLANNER TESTS PASSED");
