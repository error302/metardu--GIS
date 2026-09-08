/**
 * Unit Test for Extended Parser & Field Calculator Engine
 */

import { parseRawSurveyText, extractAttributeFields, serializePointsToCsv, serializePointsToGeoJson } from "../src/core/parser";
import { executeFieldCalculator, EXPRESSION_PRESETS } from "../src/core/field-calculator";
import { SurveyPoint } from "../src/types/spatial";

console.log("=== METARDU GIS STUDIO - PARSER & FIELD CALCULATOR TEST SUITE ===");

// 1. Test CSV with extra custom attributes
const csvData = `id,easting,northing,elevation,code,contractor,voltage_kv,status
P1,250100.5,9850200.3,1650.2,PWR_POLE,SolPower,33,Active
P2,250150.2,9850220.1,1652.8,PWR_POLE,SolPower,33,Maintenance
P3,250200.0,9850250.0,1655.0,SOLAR_INV,MicroGrid,415,Active`;

const parsed = parseRawSurveyText(csvData);
console.log(`Parsed ${parsed.length} points from custom CSV.`);

if (parsed.length !== 3) {
  console.error("FAIL: Expected 3 points.");
  process.exit(1);
}

// Verify custom properties retention
const p1 = parsed[0];
if (!p1.properties || p1.properties.contractor !== "SolPower" || p1.properties.voltage_kv !== 33 || p1.properties.status !== "Active") {
  console.error("FAIL: Extra CSV properties were not retained correctly!", p1.properties);
  process.exit(1);
}
console.log("PASS: Custom CSV properties retained:", p1.properties);

// 2. Test Extract Attribute Fields
const fields = extractAttributeFields(parsed);
console.log("Extracted fields:", fields.map((f) => `${f.name} (${f.type})`).join(", "));
if (!fields.some((f) => f.name === "contractor") || !fields.some((f) => f.name === "voltage_kv")) {
  console.error("FAIL: Missing custom fields in extractAttributeFields");
  process.exit(1);
}
console.log("PASS: Schema extraction verified.");

// 3. Test Field Calculator: Easting in KM
const calc1 = executeFieldCalculator(parsed, {
  fieldName: "easting_km",
  isNewField: true,
  fieldType: "number",
  expression: "round($x / 1000, 3)",
});

if (calc1.error || calc1.modifiedCount !== 3) {
  console.error("FAIL: Field calculator easting_km failed:", calc1.error);
  process.exit(1);
}
if (calc1.updatedPoints[0].properties?.easting_km !== 250.101) {
  console.error("FAIL: Calculated value mismatch:", calc1.updatedPoints[0].properties?.easting_km);
  process.exit(1);
}
console.log("PASS: Field Calculator arithmetic expression verified (250.101 km).");

// 4. Test Field Calculator: Conditional expression
const calc2 = executeFieldCalculator(calc1.updatedPoints, {
  fieldName: "priority_tier",
  isNewField: true,
  fieldType: "string",
  expression: "if($z > 1652, 'HIGH_ELEV', 'NORMAL')",
});

if (calc2.error) {
  console.error("FAIL: Conditional field calculator failed:", calc2.error);
  process.exit(1);
}
if (calc2.updatedPoints[0].properties?.priority_tier !== "NORMAL" || calc2.updatedPoints[1].properties?.priority_tier !== "HIGH_ELEV") {
  console.error("FAIL: Conditional evaluation mismatch:", calc2.updatedPoints.map((p) => p.properties?.priority_tier));
  process.exit(1);
}
console.log("PASS: Conditional if() expression verified.");

// 5. Test GeoJSON serialization with all properties
const geojsonStr = serializePointsToGeoJson(calc2.updatedPoints, "EPSG:21037");
const geojson = JSON.parse(geojsonStr);
if (geojson.features.length !== 3 || !geojson.features[0].properties.easting_km) {
  console.error("FAIL: GeoJSON export missing calculated properties.");
  process.exit(1);
}
console.log("PASS: GeoJSON export with dynamic properties verified.");

// 6. Test CSV serialization round-trip
const csvOut = serializePointsToCsv(calc2.updatedPoints);
const roundtripParsed = parseRawSurveyText(csvOut);
if (roundtripParsed.length !== 3 || roundtripParsed[0].properties?.easting_km !== 250.101) {
  console.error("FAIL: CSV round-trip serialization failed. csvOut:\n", csvOut, "\nroundtripParsed[0]:", roundtripParsed[0]);
  process.exit(1);
}
console.log("PASS: CSV round-trip serialization verified.");

console.log("ALL PARSER & FIELD CALCULATOR TESTS PASSED SUCCESSFULLY.");
