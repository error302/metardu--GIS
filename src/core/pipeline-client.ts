/**
 * Pipeline client — promise-based wrapper over the pipeline Web Worker with a
 * transparent main-thread fallback. All UI code should call
 * `pipelineService.run(...)` instead of importing the pipeline directly, so
 * heavy analysis never blocks the render loop.
 */

import { runAutonomousGisPipeline, PipelineProgressEvent } from "./pipeline";

export type { PipelineProgressEvent } from "./pipeline";
import {
  SurveyPoint,
  PipelineResult,
  ProjectMetadata,
  McdaWeights,
  OffGridPlannerParams,
} from "../types/spatial";

type WorkerMessage =
  | { type: "progress"; payload: PipelineProgressEvent }
  | { type: "done"; payload: PipelineResult }
  | { type: "error"; payload: { message: string } };

export interface RunOptions {
  mcdaWeights?: McdaWeights;
  offGridParams?: OffGridPlannerParams;
  onProgress?: (p: PipelineProgressEvent) => void;
}

interface ActiveJob {
  onProgress?: (p: PipelineProgressEvent) => void;
  resolve: (r: PipelineResult) => void;
  reject: (e: Error) => void;
}

class PipelineService {
  private worker: Worker | null = null;
  private active: ActiveJob | null = null;

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    if (typeof Worker === "undefined") return null;
    try {
      const w = new Worker(new URL("../workers/pipeline.worker.ts", import.meta.url), {
        type: "module",
      });
      w.onmessage = (e: MessageEvent<WorkerMessage>) => this.handleMessage(e.data);
      w.onerror = () => {
        // Module workers unsupported or boot failure: drop to fallback mode.
        this.worker = null;
        const job = this.active;
        this.active = null;
        if (job) job.reject(new Error("worker-failed"));
      };
      this.worker = w;
      return w;
    } catch {
      return null;
    }
  }

  private handleMessage(msg: WorkerMessage): void {
    const job = this.active;
    if (!job) return;
    switch (msg.type) {
      case "progress":
        job.onProgress?.(msg.payload);
        break;
      case "done":
        this.active = null;
        job.onProgress?.({ step: 9, totalSteps: 9, stage: "Complete" });
        job.resolve(msg.payload);
        break;
      case "error":
        this.active = null;
        job.reject(new Error(msg.payload.message));
        break;
    }
  }

  /**
   * True when the worker path is available. When false, run() transparently
   * executes on the main thread (same semantics, blocks the UI).
   */
  get isOffThread(): boolean {
    return this.ensureWorker() !== null;
  }

  run(
    rawInput: string | SurveyPoint[],
    metadata: ProjectMetadata,
    options: RunOptions = {}
  ): Promise<PipelineResult> {
    const { mcdaWeights, offGridParams, onProgress } = options;
    const worker = this.ensureWorker();

    if (worker) {
      return new Promise<PipelineResult>((resolve, reject) => {
        this.active = { onProgress, resolve, reject };
        worker.postMessage({
          type: "run",
          payload: { rawInput, metadata, mcdaWeights, offGridParams },
        });
      });
    }

    // Fallback: run on the main thread with direct progress callbacks.
    return runAutonomousGisPipeline(rawInput, metadata, mcdaWeights, offGridParams, onProgress);
  }
}

export const pipelineService = new PipelineService();
