// Dump a real lodgement package to disk for external unzip verification.
import { buildLodgementPackage } from "../src/core/export/lodgement";
import { writeFileSync } from "fs";
import { PipelineResult, SurveyPoint, BoundaryPolygon } from "../src/types/spatial";

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
const result: PipelineResult = {
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

const pkg = buildLodgementPackage(result);
writeFileSync("/home/z/my-project/scripts/lodgement-verify.zip", pkg.bytes);
console.log(`wrote ${pkg.bytes.length} bytes -> ${pkg.filename}`);
