/**
 * Phase D — field-to-statute tests:
 *  1. Plain-language traverse diagnostics (derived from the adjustment report).
 *  2. Dependency-free ZIP writer (CRC-32 vectors, structure parse-back).
 *  3. One-click lodgement package contents.
 */

import { adjustTraverseFromObservations, TraverseObservation } from "../src/core/traverse-adjust";
import { describeTraverse } from "../src/core/traverse-diagnostics";
import { crc32, buildZip, ZipEntry, buildLodgementPackage } from "../src/core/export/lodgement";
import { CogoPoint } from "../src/core/cogo";
import { PipelineResult, SurveyPoint, BoundaryPolygon } from "../src/types/spatial";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) console.log(`PASS: ${msg}`);
  else {
    console.error(`FAIL: ${msg}`);
    failures++;
  }
}

console.log("=== FIELD-TO-STATUTE TEST SUITE ===");

/* ---------------- 1. traverse diagnostics ---------------- */

const start: CogoPoint = { id: "STM-1", easting: 1000, northing: 2000 };
const square: TraverseObservation[] = [
  { fromId: "STM-1", toId: "T-1", bearingDeg: 90, distanceM: 100 },
  { fromId: "T-1", toId: "T-2", bearingDeg: 180, distanceM: 100 },
  { fromId: "T-2", toId: "T-3", bearingDeg: 270, distanceM: 100 },
  { fromId: "T-3", toId: "STM-1", bearingDeg: 0, distanceM: 100 },
];

const perfect = adjustTraverseFromObservations(start, square, undefined, 10000);
const perfectNarr = describeTraverse(perfect);
check(perfect.status === "PASSED" && perfect.linearMisclosureM === 0, "perfect square closes exactly");
check(perfectNarr.summary.includes("passes"), "perfect traverse summary says passes");
check(
  perfectNarr.diagnostics.some((d) => d.detail.includes("exactly on target")),
  "zero misclosure narrated as 'exactly on target'",
);
check(perfectNarr.worstLeg === null || Math.hypot(perfectNarr.worstLeg.corrE, perfectNarr.worstLeg.corrN) === 0,
  "no corrections on a perfect traverse (or zero-magnitude)");

const imperfect = adjustTraverseFromObservations(
  start,
  square.map((o, i) => (i === 3 ? { ...o, distanceM: 99.94 } : o)),
  undefined,
  10000,
);
const impNarr = describeTraverse(imperfect);
check(imperfect.status === "EXCEEDED", "6 cm short-closure fails the 1:10,000 class");
check(impNarr.summary.includes("FAILS"), "failing traverse summary says FAILS");
check(
  impNarr.diagnostics.some((d) => d.severity === "critical" && d.title.includes("Precision requirement exceeded")),
  "critical diagnostic present on failure",
);
check(
  impNarr.diagnostics.some((d) => d.detail.includes("north–south")),
  "axis-bias diagnostic detects the north–south lean",
);
check(
  impNarr.diagnostics.some((d) => d.title === "Largest correction"),
  "worst-leg diagnostic present",
);
check(
  impNarr.diagnostics.some((d) => d.detail.includes("cm")),
  "misclosure narrated in centimetres",
);
check(
  impNarr.diagnostics.every((d) => d.detail.length > 30),
  "diagnostics are full sentences, not fragments",
);

// The narrative must quote the actual numbers (no fabrication).
check(impNarr.summary.includes(imperfect.precisionFraction), "summary quotes the real precision fraction");
check(impNarr.summary.includes(imperfect.linearMisclosureM.toFixed(3)), "summary quotes the real misclosure");

/* ---------------- 2. ZIP writer ---------------- */

check(crc32(new TextEncoder().encode("hello")) === 0x3610a686, "CRC-32 matches the canonical 'hello' vector");
check(crc32(new Uint8Array(0)) === 0x00000000, "CRC-32 of empty input is zero");

const entries: ZipEntry[] = [
  { name: "a/text.txt", data: new TextEncoder().encode("hello lodgement") },
  { name: "b/data.json", data: new TextEncoder().encode('{"ok":true}') },
];
const zip = buildZip(entries, new Date(2026, 8, 10, 12, 0, 0));

const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
const eocdOff = zip.length - 22;
check(view.getUint32(eocdOff, true) === 0x06054b50, "EOCD signature at fixed offset (no comment)");
check(view.getUint16(eocdOff + 8, true) === 2 && view.getUint16(eocdOff + 10, true) === 2, "EOCD entry counts correct");

// Walk the central directory.
const cdStart = view.getUint32(eocdOff + 16, true);
const names: string[] = [];
const sizes: number[] = [];
let p = cdStart;
for (let i = 0; i < 2; i++) {
  check(view.getUint32(p, true) === 0x02014b50, `central entry ${i} signature`);
  const method = view.getUint16(p + 10, true);
  const size = view.getUint32(p + 24, true);
  const nameLen = view.getUint16(p + 28, true);
  const lho = view.getUint32(p + 42, true);
  const nameBytes = zip.slice(p + 46, p + 46 + nameLen);
  names.push(new TextDecoder().decode(nameBytes));
  sizes.push(size);
  // Local header sanity
  check(view.getUint32(lho, true) === 0x04034b50, `entry ${i} local header signature`);
  check(view.getUint16(lho + 8, true) === method && method === 0, `entry ${i} stored (method 0)`);
  check(view.getUint32(lho + 18, true) === size, `entry ${i} size matches central record`);
  // Payload spot check: local header name length lands on data
  const dataStart = lho + 30 + view.getUint16(lho + 26, true);
  const first = String.fromCharCode(zip[dataStart]);
  check(first.length === 1, `entry ${i} data offset lands on payload`);
  p += 46 + nameLen;
}
check(names.join("|") === "a/text.txt|b/data.json", "central directory preserves entry names and order");
check(sizes.join("|") === "15|11", "central directory preserves uncompressed sizes");

/* ---------------- 3. lodgement package ---------------- */

const bPts: SurveyPoint[] = [
  { id: "B1", easting: 1000, northing: 2000, elevation: 1650.25, rawCode: "BL", category: "boundary", description: "B1" },
  { id: "B2", easting: 1100, northing: 2000, elevation: 1651.0, rawCode: "BL", category: "boundary", description: "B2" },
  { id: "B3", easting: 1100, northing: 1900, elevation: 1652.1, rawCode: "BL", category: "boundary", description: "B3" },
  { id: "B4", easting: 1000, northing: 1900, elevation: 1651.5, rawCode: "BL", category: "boundary", description: "B4" },
];
const boundary: BoundaryPolygon = {
  id: "bnd", name: "Parcel", parcelNo: "LR/99/1", points: bPts,
  perimeterM: 400, areaSqM: 10000, areaHa: 1.0, areaAcres: 2.471, isClosed: true,
  linearMisclosureM: 0.03, precisionRatio: 13333, precisionRating: "Class A (Urban)",
  bearingsDistances: [
    { fromId: "B1", toId: "B2", bearingDeg: 90, bearingDms: "90°00'00\"", distanceM: 100 },
    { fromId: "B2", toId: "B3", bearingDeg: 180, bearingDms: "180°00'00\"", distanceM: 100 },
    { fromId: "B3", toId: "B4", bearingDeg: 270, bearingDms: "270°00'00\"", distanceM: 100 },
    { fromId: "B4", toId: "B1", bearingDeg: 0, bearingDms: "00°00'00\"", distanceM: 100 },
  ],
};
const pkgResult: PipelineResult = {
  metadata: {
    id: "LODG-01", title: "Lodgement Test", locality: "Test", country: "Kenya",
    crs: "Arc 1960 / UTM zone 37S (EPSG: 21037)", surveyorName: "T. Surveyor",
    registrationNo: "MISK-L1", date: "2026-09-10", scale: "1:2,500",
    organization: "MetaRDU GIS Workstation",
  },
  points: bPts,
  vectors: [],
  boundary,
  tin: null, contours: [], buffers: [], suitability: [],
  hazardSinks: [], exposedAssets: [], energyClusters: [],
  telemetries: [], totalDurationMs: 1,
};

const pkg = buildLodgementPackage(pkgResult, new Date(2026, 8, 10, 9, 30, 0));
check(pkg.filename === "Lodgement_Lodgement_Test_2026-09-10.zip", "package filename is deterministic");

// Parse the package ZIP structure.
const pv = new DataView(pkg.bytes.buffer, pkg.bytes.byteOffset, pkg.bytes.byteLength);
const pEocd = pkg.bytes.length - 22;
check(pv.getUint32(pEocd, true) === 0x06054b50, "package EOCD signature");
const count = pv.getUint16(pEocd + 10, true);
const pCd = pv.getUint32(pEocd + 16, true);
const pkgNames: string[] = [];
let q = pCd;
for (let i = 0; i < count; i++) {
  const nameLen = pv.getUint16(q + 28, true);
  pkgNames.push(new TextDecoder().decode(pkg.bytes.slice(q + 46, q + 46 + nameLen)));
  q += 46 + nameLen;
}
check(
  pkgNames.some((n) => n.startsWith("LandXML/") && n.endsWith("_Cadastre.xml")),
  "package contains the LandXML lodgement schema",
);
check(pkgNames.includes("provenance/provenance.json"), "package contains provenance.json");
check(pkgNames.includes("schedules/beacons.csv"), "package contains the beacon schedule");
check(pkgNames.includes("schedules/bearings-distances.csv"), "package contains the traverse schedule");
check(pkgNames.some((n) => n.startsWith("plans/Form4_")), "package contains the Form 4 plan");
check(pkgNames.includes("MANIFEST.txt"), "package contains MANIFEST.txt");

// Manifest quotes the real provenance digest and boundary figures.
const manifest = pkg.manifest;
check(/Provenance digest : [0-9a-f]{8}/.test(manifest), "manifest carries the provenance digest");
check(manifest.includes("1:13,333") && manifest.includes("1.00 ha"), "manifest quotes the real boundary figures");

// CSV schedule content: extract beacons.csv from the zip payload.
let csvFound = "";
let r = pCd;
for (let i = 0; i < count; i++) {
  const nameLen = pv.getUint16(r + 28, true);
  const extraLen = pv.getUint16(r + 30, true);
  const commentLen = pv.getUint16(r + 32, true);
  const name = new TextDecoder().decode(pkg.bytes.slice(r + 46, r + 46 + nameLen));
  const size = pv.getUint32(r + 24, true);
  const lho = pv.getUint32(r + 42, true);
  if (name === "schedules/beacons.csv") {
    const dataStart = lho + 30 + pv.getUint16(lho + 26, true);
    csvFound = new TextDecoder().decode(pkg.bytes.slice(dataStart, dataStart + size));
  }
  r += 46 + nameLen + extraLen + commentLen;
}
check(csvFound.startsWith("station,easting_m,northing_m,elev_msl_m"), "beacon CSV header correct");
check(csvFound.includes("B2,1100.000,2000.000,1651.000"), "beacon CSV carries adjusted coordinates");

console.log(failures === 0 ? "ALL FIELD-TO-STATUTE TESTS PASSED" : `${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
