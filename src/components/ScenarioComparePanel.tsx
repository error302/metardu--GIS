/**
 * Scenario Compare panel — versioned decision scenarios side-by-side.
 * Snapshots freeze derived decision metrics (small, geometry-free) with the
 * MCDA weights that produced them; the table judges deltas against a chosen
 * baseline. Session-scoped: snapshots live with the workspace, no server.
 */

import React, { useMemo, useState } from "react";
import { Camera, Trash2, Anchor, GitCompare } from "lucide-react";
import { PipelineResult, McdaWeights } from "../types/spatial";
import {
  ScenarioSnapshot,
  snapshotScenario,
  compareScenarios,
  formatRowValue,
  deltaVsBaseline,
} from "../core/scenario-compare";
import { DEFAULT_MCDA_WEIGHTS } from "../core/mcda-suitability";

interface ScenarioComparePanelProps {
  result: PipelineResult;
  /** Active weights come from the MCDA workflow; defaults match the document. */
  activeWeights?: McdaWeights;
}

export const ScenarioComparePanel: React.FC<ScenarioComparePanelProps> = ({
  result,
  activeWeights = DEFAULT_MCDA_WEIGHTS,
}) => {
  const [snapshots, setSnapshots] = useState<ScenarioSnapshot[]>([]);
  const [baselineId, setBaselineId] = useState<string | null>(null);
  const [name, setName] = useState("");

  const ordered = useMemo(() => {
    if (snapshots.length <= 1) return snapshots;
    const base = snapshots.find((s) => s.id === baselineId) ?? snapshots[0];
    return [base, ...snapshots.filter((s) => s.id !== base.id)];
  }, [snapshots, baselineId]);

  const rows = useMemo(() => compareScenarios(ordered), [ordered]);

  const take = () => {
    const n =
      name.trim() ||
      `Scenario ${snapshots.length + 1} — ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
    const snap = snapshotScenario(n, result, activeWeights);
    setSnapshots((prev) => [...prev, snap]);
    setBaselineId((b) => b ?? snap.id);
    setName("");
  };

  return (
    <div className="h-full overflow-y-auto bg-app">
      <div className="max-w-[980px] mx-auto p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-[3px] border border-line-strong bg-sunken flex items-center justify-center shrink-0">
            <GitCompare className="w-4.5 h-4.5 text-ink-2" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[14px] font-semibold text-ink leading-tight">Scenario compare</h2>
            <p className="text-[11px] text-ink-3 mt-0.5">
              Freeze decision metrics with the weights that produced them; judge deltas against a baseline.
            </p>
          </div>
        </div>

        {/* Capture */}
        <div className="ui-card p-3 mb-4 flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`Scenario ${snapshots.length + 1} name (optional)`}
            className="ui-input flex-1 text-[12px]"
          />
          <button onClick={take} className="ui-btn-accent shrink-0">
            <Camera className="w-3.5 h-3.5" />
            <span>Snapshot current scenario</span>
          </button>
        </div>

        {ordered.length === 0 ? (
          <div className="ui-card p-8 text-center">
            <p className="text-[13px] text-ink-2 font-medium">No scenarios captured yet</p>
            <p className="text-[12px] text-ink-3 mt-1 leading-relaxed max-w-[440px] mx-auto">
              Adjust MCDA weights (or the document), snapshot the state, repeat — then compare
              area, precision, suitability mix, hazard exposure and CAPEX side-by-side with deltas
              judged against the baseline.
            </p>
          </div>
        ) : (
          <>
            {/* Scenario chips */}
            <div className="flex flex-wrap gap-2 mb-3">
              {ordered.map((s, i) => (
                <div
                  key={s.id}
                  className={`flex items-center gap-2 border rounded-[3px] px-2.5 py-1.5 ${
                    i === 0 ? "border-accent/60 bg-accent/5" : "border-line bg-panel"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-[12px] text-ink font-medium truncate max-w-[220px]">
                      {i === 0 && <Anchor className="w-3 h-3 text-accent inline mr-1 -mt-0.5" />}
                      {s.name}
                    </p>
                    <p className="text-[10px] text-ink-3 tnum">
                      {new Date(s.savedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} ·
                      w {s.weights.slopeWeight}/{s.weights.roadAccessWeight}/{s.weights.waterBufferWeight}/{s.weights.socialInfraWeight}
                    </p>
                  </div>
                  {i !== 0 && (
                    <button
                      onClick={() => setBaselineId(s.id)}
                      title="Set as baseline"
                      className="ui-btn-icon w-5 h-5"
                    >
                      <Anchor className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setSnapshots((prev) => prev.filter((x) => x.id !== s.id));
                      if (baselineId === s.id) setBaselineId(null);
                    }}
                    title="Remove snapshot"
                    className="ui-btn-icon w-5 h-5"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>

            {/* Comparison table */}
            <div className="ui-card overflow-x-auto">
              <table className="w-full text-[12px] tnum">
                <thead>
                  <tr className="bg-raised/60 border-b border-line">
                    <th className="text-left font-medium px-3 py-2 text-[10.5px] uppercase tracking-wide text-ink-3">
                      Metric
                    </th>
                    {ordered.map((s, i) => (
                      <th
                        key={s.id}
                        className={`text-right font-medium px-3 py-2 text-[10.5px] uppercase tracking-wide ${
                          i === 0 ? "text-accent" : "text-ink-3"
                        }`}
                      >
                        {i === 0 ? "BASELINE · " : ""}
                        {s.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, ri) => (
                    <tr key={ri} className="border-b border-line last:border-b-0 hover:bg-raised/40">
                      <td className="px-3 py-1.5 text-ink-2 text-left">
                        {row.label}
                        {row.kind === "value" && row.unit !== "1:N" && row.unit !== "#" ? (
                          <span className="text-ink-3"> ({row.unit})</span>
                        ) : null}
                      </td>
                      {row.values.map((_, ci) => {
                        const d = deltaVsBaseline(row, ci);
                        return (
                          <td key={ci} className="px-3 py-1.5 text-right whitespace-nowrap">
                            <span className={ci === 0 ? "text-ink font-medium" : "text-ink-2"}>
                              {formatRowValue(row, ci)}
                            </span>
                            {d && d.delta !== 0 && (
                              <span className={`ml-1.5 text-[10.5px] ${d.good ? "text-emerald-400" : "text-red-400"}`}>
                                {d.delta > 0 ? "+" : ""}
                                {row.kind === "value" && row.unit === "USD"
                                  ? Math.round(d.delta).toLocaleString("en-US")
                                  : Number(d.delta.toFixed(1)).toLocaleString("en-US")}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-ink-3 mt-2 leading-relaxed">
              Deltas are judged by direction of merit (e.g. lower hazard share is better; CAPEX is
              reported without judgment). Snapshots are session-scoped and geometry-free — metrics
              are computed at capture time from the live document.
            </p>
          </>
        )}
      </div>
    </div>
  );
};
