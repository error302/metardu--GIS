import React, { useState } from "react";
import { RotateCcw } from "lucide-react";
import { PipelineResult, EnergyCluster, OffGridPlannerParams } from "../types/spatial";
import { DEFAULT_OFFGRID_PARAMS, modelEnergyClusters } from "../core/energy-catchment";

interface EnergyPlanningPanelProps {
  result: PipelineResult;
  onUpdateClusters?: (newClusters: EnergyCluster[]) => void;
}

/** Instrument-grade parameter slider — neutral track, mono readout. */
const ParamSlider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  hint?: string;
  minLabel: string;
  maxLabel: string;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, step, display, hint, minLabel, maxLabel, onChange }) => (
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
    <div className="flex justify-between text-[10px] text-ink-3">
      <span>{minLabel}</span>
      {hint && <span className="text-center flex-1 px-2 truncate" title={hint}>{hint}</span>}
      <span>{maxLabel}</span>
    </div>
  </div>
);

export const EnergyPlanningPanel: React.FC<EnergyPlanningPanelProps> = ({
  result,
  onUpdateClusters,
}) => {
  const [params, setParams] = useState<OffGridPlannerParams>(DEFAULT_OFFGRID_PARAMS);

  const currentClusters = React.useMemo(() => {
    return modelEnergyClusters(result.points, result.vectors, params);
  }, [result.points, result.vectors, params]);

  const handleParamChange = (key: keyof OffGridPlannerParams, value: number) => {
    const updated = { ...params, [key]: value };
    setParams(updated);
    if (onUpdateClusters) {
      const recalculated = modelEnergyClusters(result.points, result.vectors, updated);
      onUpdateClusters(recalculated);
    }
  };

  const applyPreset = (presetName: "tier1" | "tier2" | "tier3") => {
    let newP: OffGridPlannerParams;
    if (presetName === "tier1") {
      newP = {
        costPerKwSolar: 950,
        costPerKwhBattery: 280,
        demandPerHhKwh: 0.6,
        gridThresholdKm: 1.0,
        minMiniGridHh: 50,
        peakSunHours: 5.2,
        batteryAutonomyDays: 1.0,
      };
    } else if (presetName === "tier3") {
      newP = {
        costPerKwSolar: 1350,
        costPerKwhBattery: 420,
        demandPerHhKwh: 2.8,
        gridThresholdKm: 2.5,
        minMiniGridHh: 30,
        peakSunHours: 4.8,
        batteryAutonomyDays: 2.0,
      };
    } else {
      newP = { ...DEFAULT_OFFGRID_PARAMS };
    }
    setParams(newP);
    if (onUpdateClusters) {
      onUpdateClusters(modelEnergyClusters(result.points, result.vectors, newP));
    }
  };

  const totalClusters = currentClusters.length;
  const totalHH = currentClusters.reduce((sum, c) => sum + c.householdCount, 0);
  const totalDemandKwh = currentClusters.reduce((sum, c) => sum + c.dailyDemandKwh, 0);
  const totalSolarKw = currentClusters.reduce((sum, c) => sum + c.recommendedSolarKw, 0);
  const totalBatteryKwh = currentClusters.reduce((sum, c) => sum + c.batteryStorageKwh, 0);
  const totalCapexUsd = currentClusters.reduce((sum, c) => sum + c.capexEstimateUsd, 0);

  const miniGridCount = currentClusters.filter((c) => c.recommendedType === "Mini-Grid").length;
  const shsCount = currentClusters.filter((c) => c.recommendedType === "Stand-Alone SHS").length;
  const gridExtCount = currentClusters.filter((c) => c.recommendedType === "Grid Extension").length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-5">
        {/* Section head */}
        <div className="flex items-center justify-between gap-4 pb-3 border-b border-line">
          <div>
            <h2 className="text-[15px] font-semibold text-ink tracking-tight">
              Off-Grid Electrification Planner
            </h2>
            <p className="text-[12px] text-ink-3 mt-0.5">
              Spatial settlement clustering with parametric techno-economic sizing. Method basis: SE4All / ESMAP multi-tier framework.
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="ui-label mr-1">Presets</span>
            <button onClick={() => applyPreset("tier1")} className="ui-btn">Tier 1</button>
            <button onClick={() => applyPreset("tier2")} className="ui-btn">Tier 2</button>
            <button onClick={() => applyPreset("tier3")} className="ui-btn">Tier 3</button>
            <button onClick={() => applyPreset("tier2")} className="ui-btn-icon" title="Reset to defaults">
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Aggregate readouts — instrument strip */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-px bg-line border border-line rounded-[3px] overflow-hidden">
          <div className="bg-panel p-3.5">
            <span className="ui-label block mb-1.5">Clusters</span>
            <div className="ui-stat-value">{totalClusters}</div>
            <span className="text-[11px] text-ink-3 mt-0.5">{totalHH} households</span>
          </div>
          <div className="bg-panel p-3.5">
            <span className="ui-label block mb-1.5">Daily demand</span>
            <div className="ui-stat-value">
              {totalDemandKwh.toFixed(1)}<span className="ui-stat-unit">kWh</span>
            </div>
            <span className="text-[11px] text-ink-3 mt-0.5">{params.demandPerHhKwh} kWh / HH</span>
          </div>
          <div className="bg-panel p-3.5">
            <span className="ui-label block mb-1.5">Solar array</span>
            <div className="ui-stat-value">
              {totalSolarKw.toFixed(1)}<span className="ui-stat-unit">kWp</span>
            </div>
            <span className="text-[11px] text-ink-3 mt-0.5">{params.peakSunHours} PSH basis</span>
          </div>
          <div className="bg-panel p-3.5">
            <span className="ui-label block mb-1.5">Storage</span>
            <div className="ui-stat-value">
              {totalBatteryKwh.toFixed(1)}<span className="ui-stat-unit">kWh</span>
            </div>
            <span className="text-[11px] text-ink-3 mt-0.5">{params.batteryAutonomyDays} d autonomy</span>
          </div>
          <div className="bg-panel p-3.5 col-span-2 lg:col-span-1">
            <span className="ui-label block mb-1.5">Total CAPEX</span>
            <div className="ui-stat-value">
              ${totalCapexUsd.toLocaleString("en-US")}
            </div>
            <span className="text-[11px] text-ink-3 mt-0.5">
              {miniGridCount} MG · {shsCount} SHS · {gridExtCount} grid
            </span>
          </div>
        </div>

        {/* Parameters */}
        <section className="ui-card">
          <div className="ui-panel-head">
            <span className="ui-label">Techno-economic parameters</span>
            <span className="text-[11px] text-ink-3 tnum">live recalculation</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-5 p-4">
            <ParamSlider
              label="Solar PV turnkey cost"
              value={params.costPerKwSolar}
              min={600} max={2500} step={50}
              display={`$${params.costPerKwSolar} / kWp`}
              minLabel="$600" maxLabel="$2,500"
              onChange={(v) => handleParamChange("costPerKwSolar", v)}
            />
            <ParamSlider
              label="Battery storage cost"
              value={params.costPerKwhBattery}
              min={150} max={700} step={25}
              display={`$${params.costPerKwhBattery} / kWh`}
              minLabel="$150" maxLabel="$700"
              onChange={(v) => handleParamChange("costPerKwhBattery", v)}
            />
            <ParamSlider
              label="Daily demand / household"
              value={params.demandPerHhKwh}
              min={0.3} max={4.0} step={0.1}
              display={`${params.demandPerHhKwh} kWh / day`}
              minLabel="0.3" maxLabel="4.0"
              hint="Multi-tier framework"
              onChange={(v) => handleParamChange("demandPerHhKwh", v)}
            />
            <ParamSlider
              label="Grid extension threshold"
              value={params.gridThresholdKm}
              min={0.5} max={5.0} step={0.25}
              display={`${params.gridThresholdKm} km`}
              minLabel="0.5" maxLabel="5.0"
              hint="Closer → tie-in"
              onChange={(v) => handleParamChange("gridThresholdKm", v)}
            />
            <ParamSlider
              label="Mini-grid minimum size"
              value={params.minMiniGridHh}
              min={15} max={100} step={5}
              display={`${params.minMiniGridHh} HH`}
              minLabel="15" maxLabel="100"
              hint="Larger → mini-grid"
              onChange={(v) => handleParamChange("minMiniGridHh", v)}
            />
            <ParamSlider
              label="Peak sun hours"
              value={params.peakSunHours}
              min={3.5} max={6.5} step={0.1}
              display={`${params.peakSunHours} h / day`}
              minLabel="3.5" maxLabel="6.5"
              hint="GHI equivalent"
              onChange={(v) => handleParamChange("peakSunHours", v)}
            />
          </div>
        </section>

        {/* Cluster table — numerics right-aligned, color only for recommendation state */}
        <section className="ui-card overflow-hidden">
          <div className="ui-panel-head">
            <span className="ui-label">Settlement clusters — sizing schedule</span>
            <span className="text-[11px] text-ink-3 tnum">{currentClusters.length} modeled</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-line text-ink-3">
                  <th className="text-left font-medium px-3 py-2">Cluster</th>
                  <th className="text-right font-medium px-3 py-2">HH</th>
                  <th className="text-right font-medium px-3 py-2">Pop.</th>
                  <th className="text-right font-medium px-3 py-2">Grid dist</th>
                  <th className="text-right font-medium px-3 py-2">Demand</th>
                  <th className="text-right font-medium px-3 py-2">PV</th>
                  <th className="text-right font-medium px-3 py-2">Battery</th>
                  <th className="text-right font-medium px-3 py-2">CAPEX</th>
                  <th className="text-left font-medium px-3 py-2">Recommendation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {currentClusters.map((c) => (
                  <tr key={c.id} className="hover:bg-raised/60 transition-colors">
                    <td className="px-3 py-2 font-medium text-ink">{c.id}</td>
                    <td className="px-3 py-2 text-right tnum text-ink-2">{c.householdCount}</td>
                    <td className="px-3 py-2 text-right tnum text-ink-2">{c.populationEstimate}</td>
                    <td className="px-3 py-2 text-right tnum text-ink-2">{c.gridDistanceKm} km</td>
                    <td className="px-3 py-2 text-right tnum text-ink-2">{c.dailyDemandKwh} kWh</td>
                    <td className="px-3 py-2 text-right tnum text-ink">{c.recommendedSolarKw} kWp</td>
                    <td className="px-3 py-2 text-right tnum text-ink-2">{c.batteryStorageKwh} kWh</td>
                    <td className="px-3 py-2 text-right tnum text-ink">${c.capexEstimateUsd.toLocaleString("en-US")}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded-[3px] text-[10px] font-semibold border ${
                          c.recommendedType === "Mini-Grid"
                            ? "border-accent/40 text-accent bg-accent-dim"
                            : c.recommendedType === "Grid Extension"
                            ? "border-line-strong text-ink-2 bg-raised"
                            : "border-dt-blue/30 text-dt-blue bg-dt-blue/10"
                        }`}
                      >
                        {c.recommendedType}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Policy brief */}
        <section className="ui-card">
          <div className="ui-panel-head">
            <span className="ui-label">Investment summary</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-line">
            <div className="p-4 space-y-1.5">
              <span className="text-[12px] font-semibold text-ink block">Solar hybrid mini-grids</span>
              <p className="text-[12px] text-ink-2 leading-relaxed">
                {miniGridCount} cluster{miniGridCount === 1 ? "" : "s"} meet the density threshold of {params.minMiniGridHh} households.
                Centralized LV distribution with {params.batteryAutonomyDays}-day battery autonomy is the least-cost service path.
              </p>
            </div>
            <div className="p-4 space-y-1.5">
              <span className="text-[12px] font-semibold text-ink block">Stand-alone solar home systems</span>
              <p className="text-[12px] text-ink-2 leading-relaxed">
                {shsCount} dispersed cluster{shsCount === 1 ? "" : "s"} beyond the {params.gridThresholdKm} km grid cutoff.
                Decentralized kits avoid network build costs where homestead spacing exceeds economic reach.
              </p>
            </div>
            <div className="p-4 space-y-1.5">
              <span className="text-[12px] font-semibold text-ink block">Grid extension tie-ins</span>
              <p className="text-[12px] text-ink-2 leading-relaxed">
                {gridExtCount} cluster{gridExtCount === 1 ? "" : "s"} within the {params.gridThresholdKm} km corridor.
                Extending the existing MV/LV network beats islanded generation on lifecycle cost.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
