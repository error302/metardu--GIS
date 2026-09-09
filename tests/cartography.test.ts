/**
 * Atlas cartography tests — the math layer behind print-grade sheets must
 * be provably correct: hillshade photometry, contour label placement,
 * UTM zone parsing, locator grid models, and the disclosed classification
 * breaks. Also an integration pass: a rendered atlas sheet must carry the
 * new cartographic furniture and stay free of fabricated values.
 */
import * as assert from "assert";
import {
  facetShade, facetGray, hillshadePaths, projectFacets, sunVector,
  placeContourLabels, contourLabelText, parseUtmZone, utmCentralMeridian,
  buildLocatorModel, suitabilityBreaksLines, SUITABILITY_THRESHOLDS,
  ProjectedTri,
} from "../src/core/cartography";
import { renderTemplate, validateSheetSvg } from "../src/core/composer/render";
import { atlasPreset } from "../src/core/composer/presets";
import { generateTinMesh } from "../src/core/tin-engine";
import { ContourLine, PipelineResult, SurveyPoint } from "../src/types/spatial";

let passed = 0;
function ok(cond: boolean, label: string) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  passed++;
}

/* ---------- hillshade photometry ---------- */

const R2 = Math.sqrt(2) / 2;

ok(Math.abs(sunVector(315, 45)[2] - R2) < 1e-9, "sun elevation component = sin(45°)");
ok(Math.abs(sunVector(315, 45)[0] + 0.5) < 1e-9, "sun azimuth 315 shines from the NW (x<0)");
ok(Math.abs(sunVector(315, 45)[1] - 0.5) < 1e-9, "sun azimuth 315 shines from the north (y>0)");

const FLAT: [number, number, number] = [0, 0, 1];
ok(Math.abs(facetShade(FLAT, 315, 45) - 1) < 1e-9, "flat facet shade = 1 (paper white)");

// A slope tilted away from a NW sun faces SE: normal = (+sin t, -sin t, cos t)
const away: [number, number, number] = [0.3, -0.3, Math.sqrt(1 - 0.18)];
ok(facetShade(away, 315, 45) < 1, "SE-facing slope is darker than flat");
ok(facetShade(away, 315, 45) > 0, "SE-facing slope stays above the floor");

// Sun-facing slope saturates at 1 (no invented brightness on paper)
const toward: [number, number, number] = [-0.3, 0.3, Math.sqrt(1 - 0.18)];
ok(facetShade(toward, 315, 45) === 1, "NW-facing slope saturates at paper white");

// Altitude 90 (noon): shade reduces to the cosine projection — flat = 1,
// tilted = cos(tilt) = normal z-component.
ok(Math.abs(facetShade(FLAT, 315, 90) - 1) < 1e-9, "vertical sun keeps flat facets at 1");
ok(Math.abs(facetShade(away, 315, 90) - away[2]) < 1e-9, "vertical sun: shade = cos(tilt)");

ok(facetGray(FLAT) === 255, "flat facet renders paper white");
ok(facetGray(away) >= 150 && facetGray(away) < 255, "shaded facet within gray range");
ok(facetGray(away, { minGray: 120 }) < facetGray(away), "lower floor darkens the shade");
ok(facetGray({ ...away } as [number, number, number], { sunAltitudeDeg: 30 }) <
   facetGray(away, { sunAltitudeDeg: 60 }), "lower sun deepens shade");

/* ---------- hillshade path bucketing ---------- */

function tri(
  x: number, y: number, nx: number, ny: number,
): ProjectedTri {
  return {
    pts: [[x, y], [x + 10, y], [x, y + 10]],
    normal: [nx, ny, Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))],
    visible: true,
  };
}

const facets: ProjectedTri[] = [];
for (let i = 0; i < 500; i++) {
  const t = i / 500;
  facets.push(tri((i % 25) * 12, Math.floor(i / 25) * 12, t * 0.9, -t * 0.9));
}
const paths = hillshadePaths(facets);
ok(paths.length > 1 && paths.length <= 18, `bucketed into ≤18 paths (got ${paths.length})`);
ok(paths.every((p) => p.d.startsWith("M") && p.d.includes("Z")), "path geometry well-formed");
ok(!paths.some((p) => /NaN|Infinity/.test(p.d + p.fill)), "no NaN/Infinity in relief paths");

const hidden = { ...tri(0, 0, 0, 0), visible: false };
ok(hillshadePaths([hidden]).length === 0, "invisible facets produce no geometry");

const strides = projectFacets(
  // 100 fake triangles, budget 10 → stride 10 → 10 facets
  Array.from({ length: 100 }, (_, i) => ({
    p1: { id: "a", easting: i, northing: 0, elevation: 0, rawCode: "", category: "survey", description: "" },
    p2: { id: "b", easting: i + 1, northing: 0, elevation: 0, rawCode: "", category: "survey", description: "" },
    p3: { id: "c", easting: i, northing: 1, elevation: 0, rawCode: "", category: "survey", description: "" },
    normal: [0, 0, 1] as [number, number, number],
    slopePercent: 0,
    aspectDeg: 0,
  })),
  (e, n) => [e, n] as [number, number],
  () => true,
  10,
);
ok(strides.length === 10, `facet budget strides large meshes (got ${strides.length})`);

/* ---------- contour label placement ---------- */

const hline: ContourLine = { elevation: 1200, isMajor: true, points: [] };
for (let e = 0; e <= 3000; e += 10) hline.points.push([e, 500]);
const minor: ContourLine = { elevation: 1250, isMajor: false, points: [[0, 700], [3000, 700]] };
const shortMajor: ContourLine = { elevation: 1300, isMajor: true, points: [[0, 900], [40, 900]] };

const labels = placeContourLabels(
  [hline, minor, shortMajor],
  (e, n) => [e, n] as [number, number],
  () => true,
  { spacingPx: 400, minLinePx: 60, maxLabels: 48 },
);

ok(labels.length >= 6 && labels.length <= 8, `labels spaced along the line (got ${labels.length})`);
ok(labels.every((l) => l.text === "1200"), "labels carry the contour elevation");
ok(labels.every((l) => Math.abs(l.angleDeg) < 1e-9), "horizontal line → upright labels");
ok(!labels.some((l) => l.y === 700), "minor contours are never labelled");
ok(!labels.some((l) => l.y === 900), "lines shorter than minLinePx are skipped");

// Angles flip upright: a line running right-to-left labels identically
const rev = placeContourLabels(
  [{ elevation: 1000, isMajor: true, points: [...hline.points].reverse() }],
  (e, n) => [e, n] as [number, number],
  () => true,
  { spacingPx: 400, minLinePx: 60, maxLabels: 48 },
);
ok(rev.every((l) => Math.abs(l.angleDeg) < 1e-9), "reversed line stays upright");

// Budget respected
const many: ContourLine[] = Array.from({ length: 60 }, (_, i) => ({
  elevation: 1000 + i * 10, isMajor: true, points: [[0, i * 100], [3000, i * 100]],
}));
ok(placeContourLabels(many, (e, n) => [e, n] as [number, number], () => true).length <= 48,
  "global label budget honoured");

// Off-frame positions are skipped
ok(placeContourLabels([hline], (e, n) => [e, n] as [number, number], () => false).length === 0,
  "labels outside the frame are suppressed");

ok(contourLabelText(1200) === "1200" && contourLabelText(1200.5) === "1200.5",
  "contour label formatting");

/* ---------- UTM zone parsing ---------- */

const z = (s: string) => parseUtmZone(s);
assert.deepStrictEqual(z("Arc 1960 / UTM zone 37S"), { zone: 37, south: true }, "label 37S");
assert.deepStrictEqual(z("WGS 84 / UTM zone 36N"), { zone: 36, south: false }, "label 36N");
assert.deepStrictEqual(z("EPSG:21037"), { zone: 37, south: true }, "Arc 1960 37S");
assert.deepStrictEqual(z("EPSG:21097"), { zone: 37, south: false }, "Arc 1960 37N");
assert.deepStrictEqual(z("EPSG:32637"), { zone: 37, south: false }, "WGS84 37N");
assert.deepStrictEqual(z("EPSG:32736"), { zone: 36, south: true }, "WGS84 36S");
assert.deepStrictEqual(z("UTM 36S"), { zone: 36, south: true }, "bare UTM 36S");
ok(z("EPSG:4326") === null, "geographic CRS → no zone");
ok(z("EPSG:3857") === null, "web mercator → no zone");
ok(z("EPSG:21000") === null && z("EPSG:21121") === null, "out-of-range Arc codes → null");
ok(utmCentralMeridian({ zone: 37, south: true }) === 39, "zone 37 central meridian = 39°E");
ok(utmCentralMeridian({ zone: 36, south: true }) === 33, "zone 36 central meridian = 33°E");

/* ---------- locator grid model ---------- */

const bbox = { minE: 400_100, maxE: 400_500, minN: 9_949_800, maxN: 9_950_100 };
const model = buildLocatorModel(bbox, "Arc 1960 / UTM zone 37S");
ok(model !== null, "locator model built");
assert.ok(model);
ok(model.step === 5_000, `small parcel → 5 km grid (got ${model.step})`);
ok(model.window.minE % model.step === 0 && model.window.minN % model.step === 0,
  "grid window snapped to the grid step");
ok(model.window.maxE - model.window.minE >= 2 * model.step, "window spans ≥ 2 grid squares");
{
  const winSpan = Math.max(
    model.window.maxE - model.window.minE,
    model.window.maxN - model.window.minN,
  );
  ok((bbox.maxE - bbox.minE) / winSpan > 0.005, "parcel renders as a visible box, not a dot");
}
ok(model.eastings.length >= 3 && model.northings.length >= 3, "grid lines span the window");
assert.deepStrictEqual(model.extent, bbox, "parcel extent preserved");
assert.deepStrictEqual(model.zone, { zone: 37, south: true }, "zone parsed for caption");

// Large parcel → coarser grid, still 2–6 squares across.
const big = buildLocatorModel(
  { minE: 400_000, maxE: 550_000, minN: 9_950_000, maxN: 10_100_000 }, "EPSG:21037",
);
ok(big !== null && big.step === 50_000, `large parcel → 50 km grid (got ${big?.step})`);

const noZone = buildLocatorModel(bbox, "EPSG:4326");
ok(noZone !== null && noZone.zone === null, "non-UTM CRS → grid without zone claim");
ok(buildLocatorModel(null, "EPSG:21037") === null, "no extent → no locator");
ok(buildLocatorModel({ minE: 5, maxE: 5, minN: 0, maxN: 0 }, "EPSG:21037") === null,
  "degenerate extent → no locator");

/* ---------- disclosed class breaks ---------- */

const lines = suitabilityBreaksLines();
ok(lines.length === 3, "breaks disclosure is three short legend lines");
ok(lines.some((l) => l.includes(`≥${SUITABILITY_THRESHOLDS.optimalMin}`)), "optimal break disclosed");
ok(lines.some((l) => l.includes("slope exceedance")), "hazard rule disclosed");

/* ---------- integration: rendered atlas carries the furniture ---------- */

function pt(id: string, e: number, n: number, z2 = 0): SurveyPoint {
  return { id, easting: e, northing: n, elevation: z2, rawCode: "BND", category: "boundary", description: id };
}

const pts: SurveyPoint[] = [];
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
for (let i = 0; i < 400; i++) {
  pts.push(pt(`P${i}`, 400_000 + rnd() * 3_000, 9_950_000 + rnd() * 2_500, 1_100 + rnd() * 60));
}
const BND = [pt("B1", 400_000, 9_950_000), pt("B2", 403_000, 9_950_000),
  pt("B3", 403_000, 9_952_500), pt("B4", 400_000, 9_952_500)];

const tin = generateTinMesh(pts);

const result: PipelineResult = {
  metadata: {
    id: "AT-01", title: "Atlas QA Parcel", locality: "Machakos", country: "Kenya",
    crs: "Arc 1960 / UTM zone 37S", surveyorName: "J. Surveyor", registrationNo: "MISK-AT",
    date: "2026-09-10", scale: "1:12,500", organization: "MetaRDU QA",
  },
  points: pts,
  vectors: [],
  boundary: {
    id: "bnd", name: "Parcel", parcelNo: "LR-AT/7", points: BND,
    perimeterM: 11_000, areaSqM: 7_500_000, areaHa: 750, areaAcres: 1_853,
    isClosed: true, linearMisclosureM: 0.05, precisionRatio: 5_000,
    precisionRating: "Class A (Urban)", bearingsDistances: [],
  },
  tin,
  contours: [
    { elevation: 1_120, isMajor: true, points: [[400_000, 9_950_500], [403_000, 9_950_600], [403_000, 9_950_700]] },
    { elevation: 1_140, isMajor: false, points: [[400_100, 9_951_000], [402_900, 9_951_100]] },
  ],
  buffers: [],
  suitability: Array.from({ length: 120 }, (_, i) => ({
    x: 400_100 + (i % 12) * 250,
    y: 9_950_100 + Math.floor(i / 12) * 200,
    score: 30 + (i % 70),
    category: (i % 70) >= 78 ? "optimal" : (i % 70) >= 60 ? "suitable" : (i % 70) >= 40 ? "moderate" : "restricted",
    slope: 5, distToRoadM: 100, distToRiverM: 200, distToInfraM: 300,
  })),
  hazardSinks: [{ id: "S1", center: [401_500, 9_951_200], depthM: 2.4, catchmentAreaHa: 3.2 }],
  exposedAssets: [],
  energyClusters: [{
    id: "CLUSTER-1", centroid: [401_200, 9_950_500], householdCount: 540,
    recommendedSolarKw: 151.2, batteryStorageKwh: 1134, capexEstimateUsd: 86_460,
  }],
  telemetries: [],
  totalDurationMs: 0,
} as unknown as PipelineResult;

const sheet = renderTemplate(atlasPreset(), result);
const svg = sheet.svg;
const problems = validateSheetSvg(svg);
ok(problems.length === 0, `atlas sheet validates (${problems.join("; ")})`);
ok(svg.includes('id="legend_relief_ramp"'), "relief ramp gradient defined");
ok(/fill="rgb\(\d+,\d+,\d+\)"/.test(svg), "relief facet paths present");
ok(svg.includes("paint-order=\"stroke\""), "halo text on contour labels");
ok(svg.includes("id=\"locator\""), "locator element rendered");
ok(svg.includes("km grid · UTM zone 37S"), "locator captions the parsed zone");
ok(/n=\d/.test(svg), "legend carries per-class counts");
ok(svg.includes("hh"), "cluster labels carry household counts");
ok(svg.includes("class breaks") || svg.includes("class breaks:"), "legend discloses breaks");
ok(svg.includes("optimal ≥78"), "legend break values match the engine constants");
ok(svg.includes("grid metres"), "scale bar carries the unit caption");
ok(svg.includes("stroke=\"#FFFFFF\" stroke-width=\"4.5\""), "boundary casing drawn");

console.log(`cartography.test.ts: ${passed} assertions passed`);
console.log("ALL CARTOGRAPHY TESTS PASSED");
