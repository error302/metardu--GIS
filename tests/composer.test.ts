/**
 * Print Composer tests — template-driven sheets must render valid, honest
 * SVG: computed KPIs only, provenance block present, graceful em-dashes on
 * empty documents, and no fabricated indicators anywhere.
 */
import * as assert from "assert";
import {
  ComposerTemplate, resolveFieldValue, pageDimsMm,
} from "../src/core/composer/template";
import { form4Preset, atlasPreset } from "../src/core/composer/presets";
import { renderTemplate, validateSheetSvg, buildResolveContext, PX_PER_MM } from "../src/core/composer/render";
import { PipelineResult, SurveyPoint } from "../src/types/spatial";

/* ---------- Fixture ---------- */

function pt(id: string, e: number, n: number, z = 100): SurveyPoint {
  return { id, easting: e, northing: n, elevation: z, rawCode: "BND", category: "boundary", description: id };
}

const BOUNDARY_PTS = [pt("B1", 5000, 8000), pt("B2", 5200, 8000), pt("B3", 5200, 8150), pt("B4", 5000, 8150)];

function makeResult(over: Partial<PipelineResult> = {}): PipelineResult {
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
      bearingsDistances: BOUNDARY_PTS.map((p, i) => ({
        fromId: p.id,
        toId: BOUNDARY_PTS[(i + 1) % BOUNDARY_PTS.length].id,
        bearingDeg: 90 * (i === 2 ? 3 : i === 3 ? 2 : i),
        bearingDms: `0${90 * (i === 2 ? 3 : i === 3 ? 2 : i)}°00'00"`,
        distanceM: i % 2 === 0 ? 200 : 150,
      })),
    },
    tin: null,
    contours: [{ elevation: 100, isMajor: true, points: [[4990, 8010], [5210, 8190]] }],
    buffers: [],
    suitability: Array.from({ length: 9 }, (_, i) => ({
      x: 5025 + (i % 3) * 75, y: 8025 + Math.floor(i / 3) * 50,
      score: 60 + i, category: (["optimal", "suitable", "moderate", "restricted", "hazard"] as const)[i % 5],
      slope: 4, distToRoadM: 50, distToRiverM: 200, distToInfraM: 300,
    })),
    hazardSinks: [{ id: "S1", center: [5060, 8040], minElevation: 90, spillElevation: 95, depthM: 2.5, pondingAreaSqM: 400, riskLevel: "medium" }],
    exposedAssets: [{ id: "A1", name: "Dispensary", type: "clinic", coordinate: [5070, 8050], elevation: 98, hazardRisk: "high", distanceToSinkM: 140 }],
    energyClusters: [{
      id: "EC-1", centroid: [5100, 8060], householdCount: 40, populationEstimate: 200,
      clusterRadiusM: 180, gridDistanceKm: 4.2, solarGhiKwhM2: 5.8,
      recommendedType: "Mini-Grid", dailyDemandKwh: 120, recommendedSolarKw: 32,
      batteryStorageKwh: 96, capexEstimateUsd: 38500, nightTimeLuminosity: "Dark (Unserved)",
    }],
    telemetries: [
      { stepName: "COGO", durationMs: 12, status: "pass", details: "4 vectors adjusted" },
      { stepName: "TIN", durationMs: 8, status: "pass", details: "6 triangles" },
    ],
    totalDurationMs: 20,
    ...over,
  };
}

/* ---------- 1. Page geometry ---------- */
{
  const a3 = pageDimsMm({ size: "A3", orientation: "landscape" });
  assert.deepStrictEqual(a3, { w: 420, h: 297 });
  const a4p = pageDimsMm({ size: "A4", orientation: "portrait" });
  assert.deepStrictEqual(a4p, { w: 210, h: 297 });
  const sheet = renderTemplate(form4Preset(), makeResult());
  assert.ok(Math.abs(sheet.widthPx - 420 * PX_PER_MM) < 1);
}

/* ---------- 2. Field resolution — em-dash on missing, never fabricated ---------- */
{
  const ctx = buildResolveContext(makeResult());
  assert.strictEqual(resolveFieldValue({ ref: "boundary.parcelNo" }, ctx), "LR-TEST/1");
  assert.strictEqual(resolveFieldValue({ ref: "boundary.areaHa" }, ctx), "3.00 ha");
  const emptyCtx = buildResolveContext(makeResult({ boundary: null }));
  assert.strictEqual(resolveFieldValue({ ref: "boundary.parcelNo" }, emptyCtx), "—");
  assert.strictEqual(resolveFieldValue({ ref: "computed.capexTotal" }, emptyCtx), "$38,500");
}

/* ---------- 3. Form 4 sheet content ---------- */
{
  const sheet = renderTemplate(form4Preset(), makeResult());
  const problems = validateSheetSvg(sheet.svg);
  assert.deepStrictEqual(problems, [], `form 4 validation: ${problems.join("; ")}`);
  assert.ok(sheet.svg.includes("REPUBLIC OF KENYA"));
  assert.ok(sheet.svg.includes("CADASTRAL MUTATION PLAN"));
  assert.ok(sheet.svg.includes("Test Locality"), "header line 3 token-substituted");
  assert.ok(sheet.svg.includes("LR-TEST/1"), "parcel no from computed boundary");
  assert.ok(sheet.svg.includes("BEACON COORDINATE SCHEDULE"));
  assert.ok(sheet.svg.includes("B1"), "beacon ids in schedule");
  assert.ok(sheet.svg.includes("LICENSED SURVEYOR CERTIFICATE"));
  assert.ok(sheet.svg.includes("DIRECTOR OF SURVEYS"));
  assert.ok(sheet.svg.includes("SCALE 1:"), "computed scale caption present");
  assert.ok(sheet.svg.includes("J. Surveyor".toUpperCase()), "surveyor resolved");
  // footer token substitution
  assert.ok(sheet.svg.includes("Arc 1960 / UTM zone 37S"));
}

/* ---------- 4. Atlas sheet content — computed KPIs only ---------- */
{
  const sheet = renderTemplate(atlasPreset(), makeResult());
  const problems = validateSheetSvg(sheet.svg);
  assert.deepStrictEqual(problems, [], `atlas validation: ${problems.join("; ")}`);
  assert.ok(sheet.svg.includes("REGIONAL PLANNING ATLAS"));
  assert.ok(sheet.svg.includes("METHOD &amp; LIMITATIONS"), "provenance block present");
  // buildableHa: (optimal+suitable)/9 * 3.0 ha — optimal=2 (i=0,5), suitable=2 (i=1,6) => 4/9*3 = 1.33
  assert.ok(sheet.svg.includes("1.33"), `buildable envelope computed: ${sheet.svg.match(/1\.\d+/)?.[0]}`);
  // geoid provenance disclosed (parametric in test env — no grid loaded)
  assert.ok(/geoid/i.test(sheet.svg));
  assert.ok(sheet.svg.includes("EC-1"), "energy schedule rows");
  assert.ok(sheet.svg.includes("Dispensary"), "hazard schedule rows");
  // signoff
  assert.ok(sheet.svg.includes("MUNICIPAL CHIEF PLANNER"));
}

/* ---------- 5. Empty-document robustness ---------- */
{
  const empty = makeResult({
    boundary: null, tin: null, contours: [], suitability: [], vectors: [],
    hazardSinks: [], exposedAssets: [], energyClusters: [], points: [],
  });
  for (const t of [form4Preset(), atlasPreset()]) {
    const sheet = renderTemplate(t as ComposerTemplate, empty);
    const problems = validateSheetSvg(sheet.svg);
    assert.deepStrictEqual(problems, [], `${t.id} on empty doc: ${problems.join("; ")}`);
    assert.ok(sheet.svg.includes("No data for this frame"), "honest no-data message in map frame");
  }
  const emptySheet = renderTemplate(form4Preset(), empty);
  assert.ok(emptySheet.svg.includes("No adjusted boundary traverse".toLowerCase()) || emptySheet.svg.includes("No adjusted boundary traverse"));
}

/* ---------- 6. Fixed scale denominator round-trips ---------- */
{
  const t = form4Preset();
  const mapEl = t.elements.find((e) => e.kind === "map-frame") as Extract<typeof t.elements[number], { kind: "map-frame" }>;
  mapEl.scaleDenominator = 1250;
  const sheet = renderTemplate(t, makeResult());
  assert.ok(sheet.svg.includes("1:1,250 (fixed)"), "fixed denominator echoed on sheet");
}

/* ---------- 7. Template JSON round-trip (save/load) ---------- */
{
  const t = atlasPreset();
  const json = JSON.stringify(t);
  const clone = JSON.parse(json) as ComposerTemplate;
  assert.strictEqual(clone.id, t.id);
  assert.strictEqual(clone.elements.length, t.elements.length);
  const a = renderTemplate(t, makeResult()).svg;
  const b = renderTemplate(clone, makeResult()).svg;
  assert.strictEqual(a, b, "template clone renders identically");
}

console.log("composer.test.ts: ALL ASSERTIONS PASSED");
