/**
 * Traverse Panel — guided field-to-statute traverse workflow (Phase D).
 *
 * Enter or load field observations (bearing/distance legs), adjust by
 * Bowditch, read the plain-language misclosure diagnostics, and promote the
 * adjusted coordinates into the working document — in one session.
 */

import React, { useMemo, useState } from "react";
import { Play, Upload, Crosshair, AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { PipelineResult, SurveyPoint } from "../types/spatial";
import { CogoPoint, cogoInverse } from "../core/cogo";
import { decimalToDms } from "../core/geodesy";
import {
  adjustTraverseFromObservations,
  TraverseAdjustmentReport,
  TraverseObservation,
} from "../core/traverse-adjust";
import { describeTraverse } from "../core/traverse-diagnostics";

interface TraversePanelProps {
  result: PipelineResult;
  onApplyPoints: (pts: SurveyPoint[]) => void;
}

interface LegRow {
  fromId: string;
  toId: string;
  bearingDeg: number;
  distanceM: number;
}

const TOLERANCES = [
  { label: "Class A (Urban) — 1:10,000", value: 10000 },
  { label: "Class B (Rural) — 1:5,000", value: 5000 },
  { label: "Detail / topographic — 1:2,500", value: 2500 },
];

const numInput =
  "ui-input w-24 text-right tnum text-[12px] px-2 py-1";
const idInput = "ui-input w-20 text-[12px] px-2 py-1";

export const TraversePanel: React.FC<TraversePanelProps> = ({ result, onApplyPoints }) => {
  const [startId, setStartId] = useState("STM-1");
  const [startE, setStartE] = useState("");
  const [startN, setStartN] = useState("");
  const [useClosing, setUseClosing] = useState(false);
  const [closeId, setCloseId] = useState("CLS-1");
  const [closeE, setCloseE] = useState("");
  const [closeN, setCloseN] = useState("");
  const [tolerance, setTolerance] = useState(10000);
  const [legs, setLegs] = useState<LegRow[]>([
    { fromId: "STM-1", toId: "T-1", bearingDeg: 45, distanceM: 120 },
    { fromId: "T-1", toId: "T-2", bearingDeg: 135, distanceM: 150 },
    { fromId: "T-2", toId: "STM-1", bearingDeg: 225, distanceM: 190 },
  ]);
  const [report, setReport] = useState<TraverseAdjustmentReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const narrative = useMemo(() => (report ? describeTraverse(report) : null), [report]);

  const startPoint: CogoPoint = { id: startId, easting: Number(startE), northing: Number(startN) };
  const closingPoint: CogoPoint = { id: closeId, easting: Number(closeE), northing: Number(closeN) };

  const loadBoundaryLegs = () => {
    const b = result.boundary;
    if (!b || b.points.length < 3) {
      setError("No closed boundary in the current document to load a traverse from.");
      return;
    }
    setError(null);
    const bp = b.points;
    const s = bp[0];
    setStartId(s.id);
    setStartE(s.easting.toFixed(3));
    setStartN(s.northing.toFixed(3));
    setUseClosing(false);
    const rows: LegRow[] = [];
    for (let i = 0; i < bp.length; i++) {
      const a = bp[i];
      const c = bp[(i + 1) % bp.length];
      const inv = cogoInverse(a, c);
      rows.push({
        fromId: a.id,
        toId: c.id,
        bearingDeg: Number(inv.bearingDeg.toFixed(4)),
        distanceM: Number(inv.distanceM.toFixed(3)),
      });
    }
    setLegs(rows);
    setReport(null);
  };

  const adjust = () => {
    setError(null);
    try {
      const observations: TraverseObservation[] = legs.map((l) => ({
        fromId: l.fromId,
        toId: l.toId,
        bearingDeg: l.bearingDeg,
        distanceM: l.distanceM,
      }));
      const r = adjustTraverseFromObservations(
        startPoint,
        observations,
        useClosing ? closingPoint : undefined,
        tolerance,
      );
      setReport(r);
    } catch (err) {
      setReport(null);
      setError((err as Error).message);
    }
  };

  const applyAdjusted = () => {
    if (!report) return;
    const byId = new Map(result.points.map((p) => [p.id, p]));
    for (const ap of report.adjustedPoints) {
      const key = ap.id ?? `ADJ-${byId.size + 1}`;
      const existing = byId.get(key);
      byId.set(key, {
        ...(existing ?? {
          elevation: 0,
          rawCode: "CTRL",
          category: "control" as const,
          description: `Traverse station (adjusted ${new Date().toISOString().split("T")[0]})`,
        }),
        id: key,
        easting: ap.easting,
        northing: ap.northing,
      });
    }
    onApplyPoints([...byId.values()]);
  };

  const severityIcon = (sev: string) =>
    sev === "ok" ? (
      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
    ) : sev === "info" ? (
      <Info className="w-4 h-4 text-sky-400 shrink-0" />
    ) : sev === "warning" ? (
      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
    ) : (
      <XCircle className="w-4 h-4 text-red-400 shrink-0" />
    );

  const setLeg = (i: number, patch: Partial<LegRow>) =>
    setLegs((prev) => prev.map((l, li) => (li === i ? { ...l, ...patch } : l)));

  return (
    <div className="h-full flex bg-app overflow-hidden">
      {/* Observation rail */}
      <div className="w-[420px] shrink-0 border-r border-line bg-panel flex flex-col">
        <div className="ui-panel-head">
          <div>
            <h2 className="text-[13px] font-semibold text-ink">Traverse adjustment</h2>
            <p className="text-[11px] text-ink-3 mt-0.5">Bowditch (compass rule) — Survey of Kenya practice</p>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-3 space-y-3">
          {/* Control points */}
          <div className="ui-card p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="ui-label">Occupation point</span>
              <button
                onClick={loadBoundaryLegs}
                className="ui-btn text-[11px] h-6 px-2"
                title="Load legs and start point from the document boundary beacons"
              >
                <Upload className="w-3 h-3" />
                <span>Load from boundary</span>
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input value={startId} onChange={(e) => setStartId(e.target.value)} className={idInput} title="Station id" />
              <input value={startE} onChange={(e) => setStartE(e.target.value)} placeholder="Easting" className={numInput} />
              <input value={startN} onChange={(e) => setStartN(e.target.value)} placeholder="Northing" className={numInput} />
            </div>
            <label className="flex items-center gap-2 text-[12px] text-ink-2 select-none cursor-pointer">
              <input type="checkbox" checked={useClosing} onChange={(e) => setUseClosing(e.target.checked)} className="accent-amber-500" />
              Closes onto known control (link traverse)
            </label>
            {useClosing && (
              <div className="flex items-center gap-2">
                <input value={closeId} onChange={(e) => setCloseId(e.target.value)} className={idInput} />
                <input value={closeE} onChange={(e) => setCloseE(e.target.value)} placeholder="Easting" className={numInput} />
                <input value={closeN} onChange={(e) => setCloseN(e.target.value)} placeholder="Northing" className={numInput} />
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="ui-label w-28">Acceptance</span>
              <select
                value={tolerance}
                onChange={(e) => setTolerance(Number(e.target.value))}
                className="ui-select flex-1 text-[12px]"
              >
                {TOLERANCES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Legs */}
          <div className="ui-card p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="ui-label">Observed legs ({legs.length})</span>
              <div className="flex gap-1">
                <button
                  onClick={() =>
                    setLegs((prev) => [
                      ...prev,
                      {
                        fromId: prev[prev.length - 1]?.toId ?? startId,
                        toId: `T-${prev.length + 1}`,
                        bearingDeg: 0,
                        distanceM: 100,
                      },
                    ])
                  }
                  className="ui-btn text-[11px] h-6 px-2"
                >
                  + Leg
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              {legs.map((l, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input value={l.fromId} onChange={(e) => setLeg(i, { fromId: e.target.value })} className={idInput} title="From station" />
                  <span className="text-ink-3 text-[11px]">→</span>
                  <input value={l.toId} onChange={(e) => setLeg(i, { toId: e.target.value })} className={idInput} title="To station" />
                  <input
                    type="number"
                    step="0.0001"
                    value={l.bearingDeg}
                    onChange={(e) => setLeg(i, { bearingDeg: Number(e.target.value) })}
                    className={numInput}
                    title={`Bearing (decimal degrees) = ${decimalToDms(l.bearingDeg)}`}
                  />
                  <input
                    type="number"
                    step="0.001"
                    value={l.distanceM}
                    onChange={(e) => setLeg(i, { distanceM: Number(e.target.value) })}
                    className={numInput}
                    title="Horizontal distance (m)"
                  />
                  <button
                    onClick={() => setLegs((prev) => prev.filter((_, li) => li !== i))}
                    className="ui-btn-icon shrink-0"
                    title="Remove leg"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <p className="text-[10.5px] text-ink-3 mt-2">
              Bearings in decimal degrees (whole-circle, from grid north); distances in metres.
            </p>
          </div>

          <button onClick={adjust} className="ui-btn-accent w-full justify-center">
            <Play className="w-3.5 h-3.5" />
            <span>Adjust traverse</span>
          </button>
          {error && (
            <p className="text-[12px] text-red-400 bg-red-500/10 border border-red-500/30 rounded-[3px] px-2.5 py-2">
              {error}
            </p>
          )}
        </div>
      </div>

      {/* Report */}
      <div className="flex-1 overflow-auto">
        {!report || !narrative ? (
          <EmptyState />
        ) : (
          <div className="max-w-[900px] mx-auto p-5 space-y-4">
            {/* Verdict card */}
            <div className="ui-card p-4">
              <div className="flex items-center gap-3 mb-2">
                {report.status === "PASSED" ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-400" />
                )}
                <h3 className="text-[15px] font-semibold text-ink">
                  {report.status === "PASSED" ? "Traverse accepted" : "Traverse exceeds tolerance"}
                </h3>
                <span className="ml-auto font-mono text-[18px] text-accent tnum">{report.precisionFraction}</span>
              </div>
              <p className="text-[13px] text-ink-2 leading-relaxed">{narrative.summary}</p>
              <div className="grid grid-cols-4 gap-3 mt-3">
                <Stat label="Misclosure E" value={`${report.misclosureE >= 0 ? "+" : ""}${report.misclosureE.toFixed(3)} m`} />
                <Stat label="Misclosure N" value={`${report.misclosureN >= 0 ? "+" : ""}${report.misclosureN.toFixed(3)} m`} />
                <Stat label="Linear" value={`${report.linearMisclosureM.toFixed(3)} m`} />
                <Stat label="Perimeter" value={`${report.totalPerimeterM.toLocaleString("en-US", { maximumFractionDigits: 2 })} m`} />
              </div>
            </div>

            {/* Plain-language diagnostics */}
            <div className="ui-card divide-y divide-line">
              <div className="px-4 py-2 flex items-center gap-2">
                <Crosshair className="w-3.5 h-3.5 text-ink-3" />
                <span className="ui-label">Plain-language diagnostics</span>
              </div>
              {narrative.diagnostics.map((d, i) => (
                <div key={i} className="flex gap-3 px-4 py-2.5">
                  {severityIcon(d.severity)}
                  <div>
                    <p className="text-[12.5px] font-medium text-ink">{d.title}</p>
                    <p className="text-[12px] text-ink-2 leading-relaxed mt-0.5">{d.detail}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Adjusted leg schedule */}
            <div className="ui-card overflow-hidden">
              <div className="px-4 py-2 flex items-center gap-2 border-b border-line">
                <span className="ui-label">Adjusted leg schedule</span>
                <span className="text-[10.5px] text-ink-3 ml-auto">measured → correction → adjusted</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11.5px] tnum">
                  <thead>
                    <tr className="bg-raised/60 text-ink-3 text-[10.5px] uppercase tracking-wide">
                      <th className="text-left font-medium px-3 py-1.5">From</th>
                      <th className="text-left font-medium px-3 py-1.5">To</th>
                      <th className="text-right font-medium px-3 py-1.5">Bearing</th>
                      <th className="text-right font-medium px-3 py-1.5">Dist (m)</th>
                      <th className="text-right font-medium px-3 py-1.5">Corr E (m)</th>
                      <th className="text-right font-medium px-3 py-1.5">Corr N (m)</th>
                      <th className="text-right font-medium px-3 py-1.5">Adj E (m)</th>
                      <th className="text-right font-medium px-3 py-1.5">Adj N (m)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.legs.map((leg, i) => (
                      <tr key={i} className="border-t border-line hover:bg-raised/40">
                        <td className="px-3 py-1.5 text-ink">{leg.fromId}</td>
                        <td className="px-3 py-1.5 text-ink">{leg.toId}</td>
                        <td className="px-3 py-1.5 text-right text-ink-2 font-mono">{leg.measuredBearingDms}</td>
                        <td className="px-3 py-1.5 text-right text-ink-2 font-mono">{leg.measuredDistanceM.toFixed(3)}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-amber-400/90">{leg.corrE >= 0 ? "+" : ""}{leg.corrE.toFixed(3)}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-amber-400/90">{leg.corrN >= 0 ? "+" : ""}{leg.corrN.toFixed(3)}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-ink">{leg.adjustedE.toFixed(3)}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-ink">{leg.adjustedN.toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Apply */}
            <div className="ui-card p-4 flex items-center gap-3">
              <div className="flex-1">
                <p className="text-[12.5px] font-medium text-ink">Promote adjusted coordinates to the document</p>
                <p className="text-[11.5px] text-ink-3 mt-0.5">
                  Replaces stations by id ({report.adjustedPoints.length} adjusted); new stations enter as control.
                  Recorded as an undoable command; the provenance digest will change.
                </p>
              </div>
              <button onClick={applyAdjusted} className="ui-btn-accent shrink-0">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Apply to document</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="bg-sunken border border-line rounded-[3px] px-2.5 py-1.5">
    <p className="text-[10px] uppercase tracking-wide text-ink-3">{label}</p>
    <p className="text-[13px] font-mono text-ink tnum mt-0.5">{value}</p>
  </div>
);

const EmptyState: React.FC = () => (
  <div className="h-full flex items-center justify-center p-8">
    <div className="max-w-[420px] text-center">
      <div className="w-12 h-12 mx-auto rounded-[4px] border border-line-strong bg-sunken flex items-center justify-center mb-3">
        <Crosshair className="w-5 h-5 text-ink-2" />
      </div>
      <h3 className="text-[14px] font-semibold text-ink">No adjustment yet</h3>
      <p className="text-[12px] text-ink-3 mt-1.5 leading-relaxed">
        Enter field observations or load the boundary traverse, then adjust. You will get a
        precision verdict against the survey class, plain-language misclosure diagnostics,
        and one-click promotion of the adjusted coordinates into the document.
      </p>
    </div>
  </div>
);
