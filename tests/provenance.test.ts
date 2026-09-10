/**
 * Provenance Graph test suite.
 *
 * Contracts:
 *  - Every figure carries value + method + inputs + tolerance (never bare).
 *  - Referential integrity: every input id resolves to a node.
 *  - Digest is deterministic and tamper-evident.
 *  - Provenance survives a .metardu.json project roundtrip.
 *  - GeoJSON and LandXML exports embed the graph.
 */

import { buildProvenanceGraph, provenanceDigest, provenanceRows, ProvenanceGraph } from "../src/core/provenance";
import { recordExternalSource, getExternalSources, clearExternalSources } from "../src/core/osint/registry";
import { createProjectSnapshot, parseProjectFile } from "../src/core/project";
import { exportToGeoJson } from "../src/exporters/geojson-exporter";
import { exportToLandXml } from "../src/exporters/landxml-exporter";
import { PipelineResult, SurveyPoint, BoundaryPolygon } from "../src/types/spatial";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) {
    console.log(`PASS: ${msg}`);
  } else {
    console.error(`FAIL: ${msg}`);
    failures++;
  }
}

/* ---------------- fixture ---------------- */

const pts: SurveyPoint[] = [
  { id: "B1", easting: 250000, northing: 9850000, elevation: 1650.2, rawCode: "BL", category: "boundary", description: "Beacon B1" },
  { id: "B2", easting: 250100, northing: 9850000, elevation: 1651.0, rawCode: "BL", category: "boundary", description: "Beacon B2" },
  { id: "B3", easting: 250100, northing: 9850100, elevation: 1652.4, rawCode: "BL", category: "boundary", description: "Beacon B3" },
  { id: "B4", easting: 250000, northing: 9850100, elevation: 1651.8, rawCode: "BL", category: "boundary", description: "Beacon B4" },
  { id: "RD1", easting: 250050, northing: 9850050, elevation: 1650.9, rawCode: "RD-CL", category: "road", description: "Road chainage" },
];

const boundary: BoundaryPolygon = {
  id: "bnd-1",
  name: "Parcel",
  parcelNo: "LR/1234/5",
  points: pts.filter((p) => p.category === "boundary"),
  perimeterM: 400.0,
  areaSqM: 10000.0,
  areaHa: 1.0,
  areaAcres: 2.471,
  isClosed: true,
  linearMisclosureM: 0.032,
  precisionRatio: 12500,
  precisionRating: "Class A (Urban)",
  bearingsDistances: [],
};

const result: PipelineResult = {
  metadata: {
    id: "TEST-PROV",
    title: "Provenance Test Parcel",
    locality: "Test Locality",
    country: "Kenya",
    crs: "Arc 1960 / UTM zone 37S (EPSG: 21037)",
    surveyorName: "Test Surveyor",
    registrationNo: "MISK-TEST",
    date: "2026-09-10",
    scale: "1:2,500",
    organization: "MetaRDU GIS Workstation",
  },
  points: pts,
  vectors: [],
  boundary,
  tin: null,
  contours: [],
  buffers: [],
  suitability: [
    { x: 0, y: 0, score: 82, category: "optimal", slope: 2, distToRoadM: 10, distToRiverM: 200, distToInfraM: 50 },
    { x: 1, y: 0, score: 45, category: "moderate", slope: 12, distToRoadM: 120, distToRiverM: 90, distToInfraM: 300 },
    { x: 2, y: 0, score: 8, category: "hazard", slope: 30, distToRoadM: 400, distToRiverM: 10, distToInfraM: 900 },
  ],
  hazardSinks: [{ id: "S1", center: [0, 0], minElevation: 1640, spillElevation: 1645, depthM: 5, pondingAreaSqM: 250, riskLevel: "medium" }],
  exposedAssets: [],
  energyClusters: [
    {
      id: "C1", centroid: [0, 0], householdCount: 24, populationEstimate: 120, clusterRadiusM: 180,
      gridDistanceKm: 4.2, solarGhiKwhM2: 5.8, recommendedType: "Mini-Grid", dailyDemandKwh: 96,
      recommendedSolarKw: 21, batteryStorageKwh: 96, capexEstimateUsd: 38200, nightTimeLuminosity: "Dark (Unserved)",
    },
  ],
  telemetries: Array.from({ length: 9 }, (_, i) => ({
    stepName: `${i + 1}. Stage ${i + 1}`,
    durationMs: 1.0 + i,
    status: "pass" as const,
    details: `Stage ${i + 1} completed.`,
  })),
  totalDurationMs: 50,
};

/* ---------------- 1. graph structure ---------------- */

console.log("=== PROVENANCE GRAPH TEST SUITE ===");
const g = buildProvenanceGraph(result);

check(g.format === "METARDU_PROVENANCE" && g.version === "1.0.0", "graph header present");
check(g.nodes.filter((n) => n.kind === "source").length === 3, "three source nodes (survey, geoid, CRS)");
check(g.nodes.filter((n) => n.kind === "process").length === 9, "nine process nodes from telemetry");
check(g.nodes.filter((n) => n.kind === "figure").length >= 6, "at least six audited figures");

const figs = g.nodes.filter((n) => n.kind === "figure");
check(
  figs.every((n) => (n.value ?? "") !== "" && (n.methodCitation ?? "") !== "" && (n.tolerance ?? "") !== ""),
  "every figure has value, method citation and tolerance",
);
check(
  figs.every((n) => (n.inputs ?? []).length > 0),
  "every figure declares at least one input",
);

const ids = new Set(g.nodes.map((n) => n.id));
check(
  figs.every((n) => (n.inputs ?? []).every((i) => ids.has(i))),
  "referential integrity: all input ids resolve to nodes",
);

check(figs.some((n) => n.id === "fig:boundary-area" && n.numericValue === 1.0), "boundary area figure matches fixture (1.00 ha)");
check(figs.some((n) => n.id === "fig:boundary-precision" && (n.numericValue ?? 0) === 12500), "precision figure matches fixture (1:12,500)");
check(figs.some((n) => n.id === "fig:energy-capex" && (n.numericValue ?? 0) === 38200), "capex figure matches fixture");
check(!JSON.stringify(g).includes("NaN") && !JSON.stringify(g).includes("Infinity"), "no NaN/Infinity leakage");

/* ---------------- 2. digest ---------------- */

const digest2 = provenanceDigest(buildProvenanceGraph(result).nodes);
check(g.digest === digest2 && /^[0-9a-f]{8}$/.test(g.digest), "digest deterministic and 8-hex");

const tampered = buildProvenanceGraph({ ...result, boundary: { ...boundary, areaHa: 1.5 } });
check(tampered.digest !== g.digest, "digest changes when a figure changes (tamper-evident)");

/* ---------------- 3. rows for composer/CSV ---------------- */

const rows = provenanceRows(g);
check(rows.length === figs.length, "one register row per figure");
check(rows.every((r) => r.method !== "—" && r.tolerance !== "—"), "register rows carry method and tolerance");

/* ---------------- 4. project roundtrip ---------------- */

const snapshot = createProjectSnapshot(result, undefined, undefined, undefined, g);
const restored = parseProjectFile(JSON.stringify(snapshot));
const rp = restored.provenance as ProvenanceGraph;
check(!!rp && rp.format === "METARDU_PROVENANCE" && rp.digest === g.digest, "provenance survives .metardu.json roundtrip");

const legacy = parseProjectFile(JSON.stringify({ ...snapshot, provenance: undefined }));
check(legacy.provenance === undefined && legacy.points.length === 5, "legacy project files without provenance still load");

/* ---------------- 5. export embeds ---------------- */

const geo = JSON.parse(exportToGeoJson(result));
check(geo.provenance?.format === "METARDU_PROVENANCE" && geo.provenance.digest === g.digest, "GeoJSON embeds the provenance graph");

const xml = exportToLandXml(result);
check(xml.includes("METARDU PROVENANCE") && xml.includes(`digest: ${g.digest}`), "LandXML embeds the provenance comment block");
check(xml.trimEnd().endsWith("-->") && !/<!--[^]*--[^>]*--[^>]*-->/.test(xml.slice(xml.indexOf("<!--"))), "LandXML comment block is well-formed (no nested --)");

/* ---------------- 6. empty document robustness ---------------- */

const empty = buildProvenanceGraph({ ...result, boundary: null, suitability: [], energyClusters: [], telemetries: [], points: [] });
check(empty.nodes.filter((n) => n.kind === "figure").every((n) => (n.value ?? "") !== ""), "empty document still yields well-formed figures");
check(/^[0-9a-f]{8}$/.test(empty.digest), "empty document digest valid");

/* ---------------- 7. OSINT external sources (chain of custody) ---------------- */

const baseGraph = buildProvenanceGraph(result, []);

const osmSource = {
  service: "OpenStreetMap (Overpass API)",
  endpoint: "https://overpass-api.de/api/interpreter",
  license: "ODbL 1.0",
  attribution: "© OpenStreetMap contributors",
  fetchedAt: "2026-09-10T08:00:00.000Z",
  featureCount: 1234,
  note: "buildings, roads — bbox [-1.35, 36.9, -1.25, 37.0] ≈ 9.9 × 11.1 km",
};
const withSrc = buildProvenanceGraph(result, [osmSource]);
const ext = withSrc.nodes.find((n) => n.id === "src:external-1");
check(!!ext && ext.kind === "source" && ext.label === "OpenStreetMap (Overpass API)", "external fetch lands as a source node");
check(
  !!ext && ext.origin!.includes("ODbL 1.0") && ext.origin!.includes("1,234 features") && ext.origin!.includes("NOT survey-grade"),
  "external node discloses license, feature count and the indicative warning",
);
check(withSrc.nodes.length === baseGraph.nodes.length + 1, "external sources append without disturbing base nodes");
check(provenanceDigest(withSrc.nodes) !== provenanceDigest(baseGraph.nodes), "consulting an external source changes the digest");
check(
  provenanceDigest(withSrc.nodes) === provenanceDigest(buildProvenanceGraph(result, [{ ...osmSource }]).nodes),
  "same sources → same digest (deterministic chain of custody)",
);
check(
  withSrc.nodes
    .filter((n) => n.kind === "figure")
    .every((f) => (f.inputs ?? []).every((id) => withSrc.nodes.some((n) => n.id === id))),
  "referential integrity holds with external nodes present",
);

// Default parameter reads the session registry
clearExternalSources();
check(getExternalSources().length === 0, "registry starts the session empty");
recordExternalSource(osmSource);
check(
  buildProvenanceGraph(result).nodes.some((n) => n.id === "src:external-1"),
  "default builder consumes the session registry",
);
check(getExternalSources()[0].featureCount === 1234, "registry record roundtrips");
clearExternalSources();

console.log(failures === 0 ? "ALL PROVENANCE TESTS PASSED" : `${failures} PROVENANCE TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
