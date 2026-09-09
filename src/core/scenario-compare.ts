/**
 * Scenario Compare — versioned decision scenarios side-by-side (Phase D).
 *
 * Planners defend decisions, not layers. A scenario snapshot freezes the
 * derived decision metrics of the current document (plus the MCDA weights
 * that produced them); the comparison table exposes deltas against a chosen
 * baseline. Metrics are computed eagerly at snapshot time — the snapshot is
 * small (no geometry) and comparison is pure arithmetic over stored values.
 */

import { PipelineResult, McdaWeights } from "../types/spatial";

export interface ScenarioMetrics {
  areaHa: number | null;
  perimeterM: number | null;
  precisionRatio: number | null;
  featureCount: number;
  vectorCount: number;
  sinkCount: number;
  exposedCount: number;
  householdTotal: number;
  capexUsd: number;
  optimalPct: number;
  suitablePct: number;
  moderatePct: number;
  restrictedPct: number;
  hazardPct: number;
}

export interface ScenarioSnapshot {
  id: string;
  name: string;
  savedAt: string;
  weights: McdaWeights;
  metrics: ScenarioMetrics;
}

export function snapshotScenario(
  name: string,
  result: PipelineResult,
  weights: McdaWeights,
  id = `scn-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
): ScenarioSnapshot {
  const n = result.suitability.length || 1;
  const pct = (k: string) =>
    Number(((result.suitability.filter((c) => c.category === k).length / n) * 100).toFixed(1));
  return {
    id,
    name,
    savedAt: new Date().toISOString(),
    weights: { ...weights },
    metrics: {
      areaHa: result.boundary ? Number(result.boundary.areaHa.toFixed(3)) : null,
      perimeterM: result.boundary ? Number(result.boundary.perimeterM.toFixed(2)) : null,
      precisionRatio: result.boundary ? result.boundary.precisionRatio : null,
      featureCount: result.points.length,
      vectorCount: result.vectors.length,
      sinkCount: result.hazardSinks.length,
      exposedCount: result.exposedAssets.length,
      householdTotal: result.energyClusters.reduce((s, c) => s + c.householdCount, 0),
      capexUsd: Math.round(result.energyClusters.reduce((s, c) => s + c.capexEstimateUsd, 0)),
      optimalPct: pct("optimal"),
      suitablePct: pct("suitable"),
      moderatePct: pct("moderate"),
      restrictedPct: pct("restricted"),
      hazardPct: pct("hazard"),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Comparison rows                                                     */
/* ------------------------------------------------------------------ */

export type ScenarioRow =
  | { kind: "value"; label: string; unit: string; better: "higher" | "lower" | "neutral"; values: (number | null)[] }
  | { kind: "weights"; label: string; values: number[] };

const num = (v: number | null, d = 1) => (v === null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: d }));

/** Column comparison against the baseline (first snapshot). */
export function compareScenarios(snaps: ScenarioSnapshot[]): ScenarioRow[] {
  if (snaps.length === 0) return [];
  const vals = (k: keyof ScenarioMetrics) => snaps.map((s) => s.metrics[k]);

  return [
    { kind: "value", label: "Parcel area", unit: "ha", better: "neutral", values: vals("areaHa") },
    { kind: "value", label: "Traverse precision", unit: "1:N", better: "higher", values: vals("precisionRatio") },
    { kind: "value", label: "Perimeter", unit: "m", better: "neutral", values: vals("perimeterM") },
    { kind: "value", label: "Optimal cells", unit: "%", better: "higher", values: vals("optimalPct") },
    { kind: "value", label: "Suitable cells", unit: "%", better: "higher", values: vals("suitablePct") },
    { kind: "value", label: "Restricted cells", unit: "%", better: "lower", values: vals("restrictedPct") },
    { kind: "value", label: "Hazard cells", unit: "%", better: "lower", values: vals("hazardPct") },
    { kind: "value", label: "Depression sinks", unit: "#", better: "lower", values: vals("sinkCount") },
    { kind: "value", label: "Exposed assets", unit: "#", better: "lower", values: vals("exposedCount") },
    { kind: "value", label: "Households served", unit: "#", better: "higher", values: vals("householdTotal") },
    { kind: "value", label: "Electrification CAPEX", unit: "USD", better: "neutral", values: vals("capexUsd") },
    { kind: "value", label: "Survey features", unit: "#", better: "neutral", values: vals("featureCount") },
    { kind: "weights", label: "Weights (slope / road / water / infra)", values: snaps.map((s) => s.weights.slopeWeight * 10000 + s.weights.roadAccessWeight * 100 + s.weights.waterBufferWeight) },
  ];
}

export function formatRowValue(row: ScenarioRow, i: number): string {
  if (row.kind === "weights") {
    const s = row.values[i];
    return `${Math.floor(s / 10000)} / ${Math.floor((s % 10000) / 100)} / ${s % 100} / —`;
  }
  return num(row.values[i], row.unit === "USD" ? 0 : 1);
}

/** Delta vs baseline with direction judgment — null for the baseline itself. */
export function deltaVsBaseline(row: ScenarioRow, i: number): { delta: number; good: boolean } | null {
  if (row.kind !== "value" || i === 0) return null;
  const a = row.values[0];
  const b = row.values[i];
  if (a === null || b === null) return null;
  const delta = b - a;
  if (Math.abs(delta) < 1e-9) return { delta: 0, good: true };
  const good = row.better === "higher" ? delta > 0 : row.better === "lower" ? delta < 0 : true;
  return { delta, good };
}
