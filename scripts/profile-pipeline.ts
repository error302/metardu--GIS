// Stage-level profile of the pipeline at 50k
import { generateSurveyDataset, BENCH_METADATA } from "../benchmarks/generate";
import { runAutonomousGisPipeline } from "../src/core/pipeline";

async function main() {
  const pts = generateSurveyDataset(10_000);
  console.log("generated", pts.length, "points");
  const res = await runAutonomousGisPipeline(pts, BENCH_METADATA as any);
  for (const t of res.telemetries) {
    console.log(`${t.durationMs.toFixed(1).padStart(10)} ms  ${t.stepName}`);
  }
  console.log(`${res.totalDurationMs.toFixed(1).padStart(10)} ms  TOTAL`);
}

main();
