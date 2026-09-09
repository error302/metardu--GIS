import React, { useMemo, useState } from "react";
import { PipelineResult, McdaWeights } from "../types/spatial";
import {
  DEFAULT_MCDA_WEIGHTS,
  evaluateSuitabilityGrid,
  buildSuitabilityIndexContext,
} from "../core/mcda-suitability";

interface McdaSuitabilityPanelProps {
  result: PipelineResult;
  onUpdateSuitability: (newSuitability: any) => void;
}

const WeightSlider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  hint: string;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, step, display, hint, onChange }) => (
  <div className="space-y-1.5 min-w-0">
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[12px] text-ink-2">{label}</span>
      <span className="tnum text-[12px] text-ink whitespace-nowrap">{display}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full h-1 bg-line rounded-full appearance-none cursor-pointer accent-[#d9a441]"
    />
    <span className="text-[10px] text-ink-3 block leading-relaxed">{hint}</span>
  </div>
);

export const McdaSuitabilityPanel: React.FC<McdaSuitabilityPanelProps> = ({
  result,
  onUpdateSuitability,
}) => {
  const [weights, setWeights] = useState<McdaWeights>(DEFAULT_MCDA_WEIGHTS);

  // Indexes amortized per terrain/feature snapshot — weight-slider drags only
  // re-evaluate cells, never rebuild spatial indexes.
  const suitabilityContext = useMemo(
    () => buildSuitabilityIndexContext(result.tin, result.vectors),
    [result.tin, result.vectors]
  );

  const handleWeightChange = (key: keyof McdaWeights, val: number) => {
    const updated = { ...weights, [key]: val };
    setWeights(updated);
    const newCells = evaluateSuitabilityGrid(result.tin, result.vectors, updated, 20, suitabilityContext);
    onUpdateSuitability(newCells);
  };

  const totalCells = result.suitability.length || 1;
  const optimal = result.suitability.filter((c) => c.category === "optimal").length;
  const suitable = result.suitability.filter((c) => c.category === "suitable").length;
  const moderate = result.suitability.filter((c) => c.category === "moderate").length;
  const restricted = result.suitability.filter((c) => c.category === "restricted").length;
  const hazard = result.suitability.filter((c) => c.category === "hazard").length;

  const totalAreaHa = result.boundary ? result.boundary.areaHa : 18.5;
  const buildableHa = Number(((optimal + suitable) / totalCells * totalAreaHa).toFixed(2));
  const restrictedHa = Number(((restricted + hazard) / totalCells * totalAreaHa).toFixed(2));

  const classRows = [
    { label: "Optimal", cells: optimal, swatch: "#6fb07c" },
    { label: "Suitable", cells: suitable, swatch: "#8ec498" },
    { label: "Moderate", cells: moderate, swatch: "#d9a441" },
    { label: "Restricted", cells: restricted, swatch: "#d97b7b" },
    { label: "Hazard", cells: hazard, swatch: "#a04a4a" },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-5">
        {/* Section head */}
        <div className="pb-3 border-b border-line">
          <h2 className="text-[15px] font-semibold text-ink tracking-tight">
            Settlement Suitability — Multi-Criteria Analysis
          </h2>
          <p className="text-[12px] text-ink-3 mt-0.5">
            Weighted overlay of terrain slope, riparian setbacks and road proximity on a 20 × 20 evaluation grid.
          </p>
        </div>

        {/* Class distribution — readout strip + in-cell proportion bars */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-px bg-line border border-line rounded-[3px] overflow-hidden">
          {classRows.map((row) => {
            const pct = Math.round((row.cells / totalCells) * 100);
            return (
              <div key={row.label} className="bg-panel p-3.5">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span
                    className="w-2 h-2 rounded-[2px] shrink-0"
                    style={{ backgroundColor: row.swatch }}
                  />
                  <span className="ui-label truncate">{row.label}</span>
                </div>
                <div className="ui-stat-value">{pct}<span className="ui-stat-unit">%</span></div>
                <div className="mt-2 h-[3px] bg-line rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, backgroundColor: row.swatch }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-[11px] text-ink-3">
          Net buildable envelope <span className="tnum text-ink-2">{buildableHa} ha</span> · restricted / hazard excision{" "}
          <span className="tnum text-ink-2">{restrictedHa} ha</span> of {totalAreaHa} ha total.
        </p>

        {/* Weights */}
        <section className="ui-card">
          <div className="ui-panel-head">
            <span className="ui-label">Decision criteria weights</span>
            <span className="text-[11px] text-ink-3 tnum">live re-evaluation</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5 p-4">
            <WeightSlider
              label="Terrain slope weight"
              value={weights.slopeWeight}
              min={0} max={100} step={1}
              display={`${weights.slopeWeight} %`}
              hint="Penalizes steep slopes and escarpment faces"
              onChange={(v) => handleWeightChange("slopeWeight", v)}
            />
            <WeightSlider
              label="Road accessibility weight"
              value={weights.roadAccessWeight}
              min={0} max={100} step={1}
              display={`${weights.roadAccessWeight} %`}
              hint="Prioritizes parcels within 250 m of access roads"
              onChange={(v) => handleWeightChange("roadAccessWeight", v)}
            />
            <WeightSlider
              label="Riparian conservation setback"
              value={weights.riparianBufferM}
              min={10} max={100} step={5}
              display={`${weights.riparianBufferM} m`}
              hint="Statutory exclusion corridor along the stream channel"
              onChange={(v) => handleWeightChange("riparianBufferM", v)}
            />
            <WeightSlider
              label="Maximum buildable slope"
              value={weights.maxSlopeAllowed}
              min={10} max={45} step={1}
              display={`${weights.maxSlopeAllowed} %`}
              hint="Slopes above this threshold are classified non-buildable"
              onChange={(v) => handleWeightChange("maxSlopeAllowed", v)}
            />
          </div>
        </section>

        {/* Planning directives */}
        <section className="ui-card">
          <div className="ui-panel-head">
            <span className="ui-label">Planning directives</span>
          </div>
          <div className="divide-y divide-line">
            <div className="px-4 py-3 flex gap-3">
              <span className="text-[11px] tnum text-ink-3 w-14 shrink-0 pt-0.5">Zone A</span>
              <p className="text-[12px] text-ink-2 leading-relaxed">
                Upper ridge (&lt; 5% slope) — designated for higher-density residential and civic infrastructure. No grading remediation required.
              </p>
            </div>
            <div className="px-4 py-3 flex gap-3">
              <span className="text-[11px] tnum text-ink-3 w-14 shrink-0 pt-0.5">Zone B</span>
              <p className="text-[12px] text-ink-2 leading-relaxed">
                Intermediate terraces — structural benching and terraced grading required prior to building approval. Apply moderate caution class.
              </p>
            </div>
            <div className="px-4 py-3 flex gap-3">
              <span className="text-[11px] tnum text-ink-3 w-14 shrink-0 pt-0.5">Zone C</span>
              <p className="text-[12px] text-ink-2 leading-relaxed">
                Riparian corridor — building prohibited within {weights.riparianBufferM} m of the channel per environmental statute.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
