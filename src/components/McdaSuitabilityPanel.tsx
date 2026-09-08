import React, { useState } from "react";
import { Sliders, CheckCircle2, AlertTriangle, ShieldAlert, BarChart3 } from "lucide-react";
import { PipelineResult, McdaWeights } from "../types/spatial";
import { DEFAULT_MCDA_WEIGHTS, evaluateSuitabilityGrid } from "../core/mcda-suitability";

interface McdaSuitabilityPanelProps {
  result: PipelineResult;
  onUpdateSuitability: (newSuitability: any) => void;
}

export const McdaSuitabilityPanel: React.FC<McdaSuitabilityPanelProps> = ({
  result,
  onUpdateSuitability,
}) => {
  const [weights, setWeights] = useState<McdaWeights>(DEFAULT_MCDA_WEIGHTS);

  const handleWeightChange = (key: keyof McdaWeights, val: number) => {
    const updated = { ...weights, [key]: val };
    setWeights(updated);
    const newCells = evaluateSuitabilityGrid(result.tin, result.vectors, updated, 20);
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

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 text-slate-100 overflow-y-auto h-[calc(100vh-125px)]">
      {/* Header */}
      <div className="border-b border-slate-800 pb-4">
        <div className="flex items-center gap-2">
          <Sliders className="w-5 h-5 text-blue-400" />
          <h2 className="text-lg font-bold tracking-tight text-white font-['Plus_Jakarta_Sans']">
            UN-HABITAT CLIMATE-SMART SETTLEMENT SUITABILITY (MCDA)
          </h2>
        </div>
        <p className="text-xs text-slate-400 mt-1">
          Dynamic Multi-Criteria Decision Analysis evaluating terrain slope gradients, statutory riparian river setbacks, and transport proximity.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
          <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider block">PRIME HIGH YIELD</span>
          <div className="text-2xl font-extrabold text-white mt-1 font-mono">{Math.round((optimal / totalCells) * 100)}%</div>
          <span className="text-xs text-slate-400 mt-0.5 block">{buildableHa} Ha Net Usable</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
          <span className="text-[11px] font-bold text-sky-400 uppercase tracking-wider block">SUITABLE (STANDARD GRADING)</span>
          <div className="text-2xl font-extrabold text-white mt-1 font-mono">{Math.round((suitable / totalCells) * 100)}%</div>
          <span className="text-xs text-slate-400 mt-0.5 block">Slope &lt; 15%</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
          <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider block">MODERATE CAUTION</span>
          <div className="text-2xl font-extrabold text-white mt-1 font-mono">{Math.round((moderate / totalCells) * 100)}%</div>
          <span className="text-xs text-slate-400 mt-0.5 block">Requires Retaining Walls</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
          <span className="text-[11px] font-bold text-red-400 uppercase tracking-wider block">RESTRICTED &amp; HAZARD</span>
          <div className="text-2xl font-extrabold text-white mt-1 font-mono">{Math.round(((restricted + hazard) / totalCells) * 100)}%</div>
          <span className="text-xs text-slate-400 mt-0.5 block">{restrictedHa} Ha Setback Excision</span>
        </div>
      </div>

      {/* Interactive Criteria Sliders */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-blue-400" />
          <span>MULTI-CRITERIA DECISION WEIGHTS</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
          {/* Slider 1: Slope */}
          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-slate-300 font-medium">Terrain Slope Weight</span>
              <span className="font-mono text-blue-400 font-bold">{weights.slopeWeight}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={weights.slopeWeight}
              onChange={(e) => handleWeightChange("slopeWeight", Number(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
            <span className="text-[10px] text-slate-500">Penalizes steep slopes and escarpment faces</span>
          </div>

          {/* Slider 2: Road Accessibility */}
          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-slate-300 font-medium">Road Accessibility Weight</span>
              <span className="font-mono text-blue-400 font-bold">{weights.roadAccessWeight}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={weights.roadAccessWeight}
              onChange={(e) => handleWeightChange("roadAccessWeight", Number(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
            <span className="text-[10px] text-slate-500">Prioritizes settlement parcels within 250m of access roads</span>
          </div>

          {/* Slider 3: Water Riparian Buffer */}
          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-slate-300 font-medium">Riparian Conservation Setback</span>
              <span className="font-mono text-cyan-400 font-bold">{weights.riparianBufferM} metres</span>
            </div>
            <input
              type="range"
              min="10"
              max="100"
              step="5"
              value={weights.riparianBufferM}
              onChange={(e) => handleWeightChange("riparianBufferM", Number(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
            />
            <span className="text-[10px] text-slate-500">Statutory 30m environmental exclusion corridor along streams</span>
          </div>

          {/* Slider 4: Max Slope Allowed */}
          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-slate-300 font-medium">Max Buildable Slope Cutoff</span>
              <span className="font-mono text-red-400 font-bold">{weights.maxSlopeAllowed}%</span>
            </div>
            <input
              type="range"
              min="10"
              max="45"
              step="1"
              value={weights.maxSlopeAllowed}
              onChange={(e) => handleWeightChange("maxSlopeAllowed", Number(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-red-400"
            />
            <span className="text-[10px] text-slate-500">Slopes exceeding threshold are classified as non-buildable hazards</span>
          </div>
        </div>
      </div>

      {/* Strategic Decision Matrix */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <h3 className="text-sm font-bold text-white tracking-wide mb-3">
          STRATEGIC PLANNING RECOMMENDATIONS
        </h3>
        <ul className="space-y-2 text-xs text-slate-300">
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span><strong>Zone A (Upper Ridge):</strong> Designated for high-density social housing and civic infrastructure (Slope &lt; 5%).</span>
          </li>
          <li className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span><strong>Zone B (Intermediate Terraces):</strong> Requires structural benching and terraced grading prior to building approval.</span>
          </li>
          <li className="flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span><strong>Zone C (Riparian Corridor):</strong> Absolute building ban enforced within {weights.riparianBufferM}m buffer of the river channel.</span>
          </li>
        </ul>
      </div>
    </div>
  );
};