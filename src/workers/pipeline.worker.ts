/**
 * Pipeline Web Worker — runs the full survey-to-GIS pipeline off the main
 * thread so the canvas keeps a steady frame budget during heavy analysis.
 * Protocol:
 *   in:  { type: "run", payload: { rawInput, metadata, mcdaWeights, offGridParams } }
 *   out: { type: "progress", payload: PipelineProgressEvent }
 *   out: { type: "done", payload: PipelineResult }
 *   out: { type: "error", payload: { message: string } }
 */

import { runAutonomousGisPipeline } from "../core/pipeline";
import {
  SurveyPoint,
  ProjectMetadata,
  McdaWeights,
  OffGridPlannerParams,
} from "../types/spatial";

interface RunPayload {
  rawInput: string | SurveyPoint[];
  metadata: ProjectMetadata;
  mcdaWeights?: McdaWeights;
  offGridParams?: OffGridPlannerParams;
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as { type: string; payload: RunPayload };
  if (msg?.type !== "run") return;

  const { rawInput, metadata, mcdaWeights, offGridParams } = msg.payload;
  try {
    const result = await runAutonomousGisPipeline(
      rawInput,
      metadata,
      mcdaWeights,
      offGridParams,
      (p) => (self as unknown as Worker).postMessage({ type: "progress", payload: p })
    );
    (self as unknown as Worker).postMessage({ type: "done", payload: result });
  } catch (err) {
    (self as unknown as Worker).postMessage({
      type: "error",
      payload: { message: err instanceof Error ? err.message : String(err) },
    });
  }
};
