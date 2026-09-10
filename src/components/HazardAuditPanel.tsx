import React from "react";
import { PipelineResult } from "../types/spatial";

interface HazardAuditPanelProps {
  result: PipelineResult;
}

export const HazardAuditPanel: React.FC<HazardAuditPanelProps> = ({ result }) => {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-5">
        {/* Section head */}
        <div className="pb-3 border-b border-line">
          <h2 className="text-[15px] font-semibold text-ink tracking-tight">
            Hazard &amp; Flood Exposure Audit
          </h2>
          <p className="text-[12px] text-ink-3 mt-0.5">
            Automated delineation of inundation sinks from the TIN drainage model, with exposure scoring for assets in the flood path.
          </p>
        </div>

        {/* Sink inventory */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {result.hazardSinks.map((s) => (
            <div key={s.id} className="ui-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="tnum text-[13px] font-medium text-ink">{s.id}</span>
                <span
                  className={`px-1.5 py-0.5 rounded-[3px] text-[10px] font-semibold uppercase tracking-wide border ${
                    s.riskLevel === "critical"
                      ? "border-dt-red/40 text-dt-red bg-dt-red/10"
                      : "border-accent/40 text-accent bg-accent-dim"
                  }`}
                >
                  {s.riskLevel}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
                <div className="flex justify-between gap-2 border-b border-line/60 pb-1 min-w-0">
                  <span className="text-ink-3 shrink-0">Ponding depth</span>
                  <span className="tnum text-ink whitespace-nowrap">{s.depthM.toFixed(2)} m</span>
                </div>
                <div className="flex justify-between gap-2 border-b border-line/60 pb-1 min-w-0">
                  <span className="text-ink-3 shrink-0">Min elev</span>
                  <span className="tnum text-ink whitespace-nowrap">{s.minElevation.toFixed(2)} m</span>
                </div>
                <div className="flex justify-between gap-2 min-w-0">
                  <span className="text-ink-3 shrink-0">Inundation</span>
                  <span className="tnum text-ink whitespace-nowrap">{Math.round(s.pondingAreaSqM).toLocaleString("en-US")} m²</span>
                </div>
                <div className="flex justify-between gap-2 min-w-0">
                  <span className="text-ink-3 shrink-0">Spill elev</span>
                  <span className="tnum text-ink whitespace-nowrap">{s.spillElevation.toFixed(2)} m</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Exposed assets */}
        <section className="ui-card overflow-hidden">
          <div className="ui-panel-head">
            <span className="ui-label">Assets within inundation path</span>
            <span className="text-[11px] tnum text-dt-red">{result.exposedAssets.length} exposed</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-line text-ink-3">
                  <th className="text-left font-medium px-3 py-2">Asset</th>
                  <th className="text-left font-medium px-3 py-2">Type</th>
                  <th className="text-right font-medium px-3 py-2">Easting</th>
                  <th className="text-right font-medium px-3 py-2">Northing</th>
                  <th className="text-right font-medium px-3 py-2">Elev (MSL)</th>
                  <th className="text-right font-medium px-3 py-2">Dist to sink</th>
                  <th className="text-left font-medium px-3 py-2">Risk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {result.exposedAssets.map((a) => (
                  <tr key={a.id} className="hover:bg-raised/60 transition-colors">
                    <td className="px-3 py-2 text-ink font-medium">{a.name}</td>
                    <td className="px-3 py-2 text-ink-2 capitalize">{a.type}</td>
                    <td className="px-3 py-2 text-right tnum text-ink-2">{a.coordinate[0].toLocaleString("en-US")}</td>
                    <td className="px-3 py-2 text-right tnum text-ink-2">{a.coordinate[1].toLocaleString("en-US")}</td>
                    <td className="px-3 py-2 text-right tnum text-ink-2">{a.elevation.toFixed(1)} m</td>
                    <td className="px-3 py-2 text-right tnum text-ink-2">{a.distanceToSinkM} m</td>
                    <td className="px-3 py-2">
                      <span
                        className={`px-1.5 py-0.5 rounded-[3px] text-[10px] font-semibold uppercase border ${
                          a.hazardRisk === "critical"
                            ? "border-dt-red/40 text-dt-red bg-dt-red/10"
                            : "border-accent/40 text-accent bg-accent-dim"
                        }`}
                      >
                        {a.hazardRisk}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Mitigation plan */}
        <section className="ui-card">
          <div className="ui-panel-head">
            <span className="ui-label">Mitigation action plan</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-line">
            <div className="p-4">
              <span className="text-[12px] font-semibold text-ink block mb-1">
                1 — Drainage culvert upgrades
              </span>
              <p className="text-[12px] text-ink-2 leading-relaxed">
                Install dual 1,200 mm precast concrete culverts at the access road crossing to convey the 50-year design discharge and eliminate the ponding mechanism.
              </p>
            </div>
            <div className="p-4">
              <span className="text-[12px] font-semibold text-ink block mb-1">
                2 — Resettlement action plan
              </span>
              <p className="text-[12px] text-ink-2 leading-relaxed">
                Relocate households situated below the spill elevation contour; prioritize structures with critical risk ratings in the exposure schedule above.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
