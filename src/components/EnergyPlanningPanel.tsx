import React, { useState } from "react";
import { Zap, Sun, Battery, DollarSign, Sliders, Moon, CheckCircle2, RotateCcw, Sparkles } from "lucide-react";
import { PipelineResult, EnergyCluster, OffGridPlannerParams } from "../types/spatial";
import { DEFAULT_OFFGRID_PARAMS, modelEnergyClusters } from "../core/energy-catchment";

interface EnergyPlanningPanelProps {
  result: PipelineResult;
  onUpdateClusters?: (newClusters: EnergyCluster[]) => void;
}

export const EnergyPlanningPanel: React.FC<EnergyPlanningPanelProps> = ({
  result,
  onUpdateClusters,
}) => {
  const [params, setParams] = useState<OffGridPlannerParams>(DEFAULT_OFFGRID_PARAMS);

  // Recalculate clusters whenever params change
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
    <div className="p-6 max-w-6xl mx-auto space-y-6 text-slate-100 overflow-y-auto h-[calc(100vh-125px)]">
      {/* Header */}
      <div className="border-b border-slate-800 pb-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-bold tracking-tight text-white font-['Plus_Jakarta_Sans']">
              OFF-GRID ELECTRIFICATION &amp; MINI-GRID PLANNER
            </h2>
            <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 text-blue-400 font-semibold">
              PARAMETRIC TECHNO-ECONOMIC SIZER
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Settlement spatial clustering and dynamic techno-economic sizing. Adjust costs, demand, and grid distance thresholds below.
          </p>
        </div>

        {/* Quick Presets */}
        <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 p-1.5 rounded-lg shrink-0 text-xs">
          <span className="text-slate-400 text-[11px] px-1 font-medium flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-amber-400" /> Presets:
          </span>
          <button
            onClick={() => applyPreset("tier1")}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] transition cursor-pointer"
          >
            Tier 1 (Basic 0.6 kWh)
          </button>
          <button
            onClick={() => applyPreset("tier2")}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] transition cursor-pointer"
          >
            Tier 2 (Standard 1.4 kWh)
          </button>
          <button
            onClick={() => applyPreset("tier3")}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] transition cursor-pointer"
          >
            Tier 3 (Productive 2.8 kWh)
          </button>
          <button
            onClick={() => applyPreset("tier2")}
            title="Reset to Defaults"
            className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Primary KPI Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
          <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider block">SETTLEMENT CLUSTERS</span>
          <div className="text-2xl font-extrabold text-white mt-1 font-mono">{totalClusters}</div>
          <span className="text-xs text-slate-400 mt-0.5 block">{totalHH} Total Households</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
          <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider block">DAILY ENERGY DEMAND</span>
          <div className="text-2xl font-extrabold text-white mt-1 font-mono">{totalDemandKwh.toFixed(1)} kWh</div>
          <span className="text-xs text-slate-400 mt-0.5 block">{params.demandPerHhKwh} kWh / HH / Day</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
          <span className="text-[11px] font-bold text-sky-400 uppercase tracking-wider block">GENERATION &amp; STORAGE</span>
          <div className="text-2xl font-extrabold text-white mt-1 font-mono">{totalSolarKw.toFixed(1)} kWp</div>
          <span className="text-xs text-slate-400 mt-0.5 block">{totalBatteryKwh.toFixed(1)} kWh Battery Storage</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
          <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider block">TOTAL CAPEX ESTIMATE</span>
          <div className="text-2xl font-extrabold text-emerald-400 mt-1 font-mono">${totalCapexUsd.toLocaleString()}</div>
          <span className="text-xs text-slate-400 mt-0.5 block">
            {miniGridCount} Mini-Grid · {shsCount} SHS · {gridExtCount} Grid Ext
          </span>
        </div>
      </div>

      {/* Interactive User Parameters Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
            <Sliders className="w-4 h-4 text-amber-400" />
            <span>CUSTOM USER PARAMETERS &amp; THRESHOLDS</span>
          </h3>
          <span className="text-xs text-slate-400 font-mono">Live Recalculation Active</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-1">
          {/* 1. Cost per kWp Solar */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-slate-300 font-medium">Solar PV Cost ($/kWp)</span>
              <span className="font-mono text-amber-400 font-bold">${params.costPerKwSolar} / kWp</span>
            </div>
            <input
              type="range"
              min="600"
              max="2500"
              step="50"
              value={params.costPerKwSolar}
              onChange={(e) => handleParamChange("costPerKwSolar", Number(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
            />
            <div className="flex justify-between text-[10px] text-slate-500">
              <span>$600</span>
              <span>$2,500</span>
            </div>
          </div>

          {/* 2. Battery Storage Cost */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-slate-300 font-medium">Battery Storage Cost ($/kWh)</span>
              <span className="font-mono text-sky-400 font-bold">${params.costPerKwhBattery} / kWh</span>
            </div>
            <input
              type="range"
              min="150"
              max="700"
              step="25"
              value={params.costPerKwhBattery}
              onChange={(e) => handleParamChange("costPerKwhBattery", Number(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-400"
            />
            <div className="flex justify-between text-[10px] text-slate-500">
              <span>$150</span>
              <span>$700</span>
            </div>
          </div>

          {/* 3. Daily Demand per HH */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-slate-300 font-medium">Daily Demand / Household</span>
              <span className="font-mono text-emerald-400 font-bold">{params.demandPerHhKwh} kWh / day</span>
            </div>
            <input
              type="range"
              min="0.3"
              max="4.0"
              step="0.1"
              value={params.demandPerHhKwh}
              onChange={(e) => handleParamChange("demandPerHhKwh", Number(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
            />
            <div className="flex justify-between text-[10px] text-slate-500">
              <span>0.3 kWh (Basic)</span>
              <span>4.0 kWh (Productive)</span>
            </div>
          </div>

          {/* 4. Grid Extension Threshold */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-slate-300 font-medium">Grid Extension Threshold</span>
              <span className="font-mono text-indigo-400 font-bold">{params.gridThresholdKm} km</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="5.0"
              step="0.25"
              value={params.gridThresholdKm}
              onChange={(e) => handleParamChange("gridThresholdKm", Number(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
            <span className="text-[10px] text-slate-500">Clusters closer than this are recommended for grid tie-in</span>
          </div>

          {/* 5. Mini-Grid Threshold */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-slate-300 font-medium">Mini-Grid Min Household Threshold</span>
              <span className="font-mono text-amber-400 font-bold">{params.minMiniGridHh} HH</span>
            </div>
            <input
              type="range"
              min="15"
              max="100"
              step="5"
              value={params.minMiniGridHh}
              onChange={(e) => handleParamChange("minMiniGridHh", Number(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
            />
            <span className="text-[10px] text-slate-500">Clusters above this size justify a centralized microgrid</span>
          </div>

          {/* 6. Solar Insolation Peak Sun Hours */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-slate-300 font-medium">Solar Peak Sun Hours</span>
              <span className="font-mono text-yellow-400 font-bold">{params.peakSunHours} hrs/day</span>
            </div>
            <input
              type="range"
              min="3.5"
              max="6.5"
              step="0.1"
              value={params.peakSunHours}
              onChange={(e) => handleParamChange("peakSunHours", Number(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-yellow-400"
            />
            <span className="text-[10px] text-slate-500">Regional daily solar irradiance equivalent</span>
          </div>
        </div>
      </div>

      {/* Clusters Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
            <Sun className="w-4 h-4 text-amber-400" />
            <span>SETTLEMENT CLUSTERS &amp; CUSTOMIZED SIZING</span>
          </h3>
          <span className="text-xs text-slate-400 font-mono">
            {currentClusters.length} Clusters Modeled
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 font-semibold">
              <tr>
                <th className="p-2.5">Cluster ID</th>
                <th className="p-2.5">Households</th>
                <th className="p-2.5">Pop. Est.</th>
                <th className="p-2.5">Grid Dist</th>
                <th className="p-2.5">Daily Demand</th>
                <th className="p-2.5">Solar PV Sizing</th>
                <th className="p-2.5">Battery Storage</th>
                <th className="p-2.5">CAPEX Estimate</th>
                <th className="p-2.5">Recommended Technology</th>
                <th className="p-2.5">Nocturnal Light</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-300 font-mono text-[11px]">
              {currentClusters.map((c) => (
                <tr key={c.id} className="hover:bg-slate-800/40">
                  <td className="p-2.5 font-bold text-white">{c.id}</td>
                  <td className="p-2.5">{c.householdCount} HH</td>
                  <td className="p-2.5">{c.populationEstimate} people</td>
                  <td className="p-2.5 text-blue-400">{c.gridDistanceKm} km</td>
                  <td className="p-2.5">{c.dailyDemandKwh} kWh</td>
                  <td className="p-2.5 text-amber-400 font-bold">{c.recommendedSolarKw} kWp</td>
                  <td className="p-2.5 text-sky-400">{c.batteryStorageKwh} kWh</td>
                  <td className="p-2.5 text-emerald-400 font-bold">${c.capexEstimateUsd.toLocaleString()}</td>
                  <td className="p-2.5 font-sans">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        c.recommendedType === "Mini-Grid"
                          ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                          : c.recommendedType === "Grid Extension"
                          ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30"
                          : "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                      }`}
                    >
                      {c.recommendedType}
                    </span>
                  </td>
                  <td className="p-2.5 font-sans">
                    <span className="text-slate-400 flex items-center gap-1">
                      <Moon className="w-3 h-3 text-amber-400" />
                      {c.nightTimeLuminosity}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Decision Summary Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-bold text-white tracking-wide">
          OFF-GRID INVESTMENT SUMMARY &amp; POLICY BRIEF
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-300">
          <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800 space-y-1">
            <span className="text-amber-400 font-bold block">Solar Hybrid Mini-Grids</span>
            <p className="text-slate-400 text-[11px]">
              {miniGridCount} clusters meet the minimum density threshold of {params.minMiniGridHh} households.
              Centralized distribution network recommended with {params.batteryAutonomyDays} days of battery autonomy.
            </p>
          </div>
          <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800 space-y-1">
            <span className="text-blue-400 font-bold block">Stand-Alone Solar Home Systems</span>
            <p className="text-slate-400 text-[11px]">
              {shsCount} dispersed homestead clusters situated &gt; {params.gridThresholdKm} km from grid lines.
              Recommended for decentralized PAYG financing kits.
            </p>
          </div>
          <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800 space-y-1">
            <span className="text-indigo-400 font-bold block">Grid Extension Tie-Ins</span>
            <p className="text-slate-400 text-[11px]">
              {gridExtCount} clusters within the {params.gridThresholdKm} km grid corridor cutoff.
              Utility transmission line extension is more cost-effective than islanded generation.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};