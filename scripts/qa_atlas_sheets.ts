/**
 * Visual QA: run the real pipeline over a synthetic 6k-point East-Africa
 * style scenario, render the two statutory presets, and write SVG sheets
 * for browser screenshot inspection (atlas cartography upgrade).
 */
import { runAutonomousGisPipeline } from "../src/core/pipeline";
import { generateSurveyDataset, BENCH_METADATA } from "../benchmarks/generate";
import { renderTemplate, validateSheetSvg } from "../src/core/composer/render";
import { atlasPreset, form4Preset } from "../src/core/composer/presets";
import { writeFileSync, mkdirSync } from "fs";

async function main() {
  const points = generateSurveyDataset(6_000, 42);
  const metadata = {
    ...BENCH_METADATA,
    title: "Koma Valley Scheme",
    locality: "Machakos North",
    country: "Kenya",
    crs: "Arc 1960 / UTM zone 37S",
    surveyorName: "P. K. Mutiso",
    registrationNo: "MISK/LS/2041",
    date: "2026-09-10",
    scale: "1:12,500",
    organization: "MetaRDU QA",
  };

  console.log("running pipeline on", points.length, "points…");
  const result = await runAutonomousGisPipeline(points, metadata);
  console.log(
    "tin:", result.tin?.triangles.length ?? 0,
    "| contours:", result.contours.length,
    "| cells:", result.suitability.length,
    "| sinks:", result.hazardSinks.length,
    "| clusters:", result.energyClusters.length,
    "| buffers:", result.buffers.length,
  );

  mkdirSync("/home/z/my-project/download/metardu-audit/atlas-qa", { recursive: true });

  for (const [name, tpl] of [["atlas", atlasPreset()], ["form4", form4Preset()]] as const) {
    const sheet = renderTemplate(tpl, result);
    const problems = validateSheetSvg(sheet.svg);
    const file = `/home/z/my-project/download/metardu-audit/atlas-qa/${name}-a3.svg`;
    writeFileSync(file, sheet.svg);
    console.log(name, "->", file, "| MB:", (sheet.svg.length / 1e6).toFixed(2), "| problems:", problems.length ? problems : "none");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
