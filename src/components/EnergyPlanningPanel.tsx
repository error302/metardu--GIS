import React from "react";
import { Zap, Sun, Battery, MapPin, CheckCircle2, Moon } from "lucide-react";
import { PipelineResult } from "../types/spatial";

interface EnergyPlanningPanelProps {
  result: PipelineResult;
}

export const EnergyPlanningPanel: React.FC<EnergyPlanningPanelProps> = ({ result }) => {
  const totalClusters = result.energyClusters.length;
  const totalHH = result.energyClusters.reduce((sum, c) => sum + c.householdCount, 0);
  const totalDemandKwh = result.energyClusters.reduce((sum, c) => sum + c.dailyDemandKwh, 0);
  const totalSolarKw = result.energyClusters.reduce((sum, c) => sum + c.recommendedSolarKw, 0);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 text-slate-100 overflow-y-auto h-[calc(100vh-125px)]">
      {/* Header */}
      <div className="border-b border-slate-800 pb-4">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-amber-400" />
          <h2 className="text-lg font-bold tracking-tight text-white font-['Plus_Jakarta_Sans']">
            SUN KING OFF-GRID ENERGY REACH &amp; CLUSTERING STUDIO
          </h2>
        </div>
        <p className="text-xs text-slate-400 mt-1">
          Settlement clustering, distance-to-grid modeling, and solar mini-grid vs stand-alone SHS sizing for un-electrified African communities.
        </p>
      </div>

      {/* Energy Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
          <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider block">CLUSTERS IDENTIFIED</span>
          <div className="text-2xl font-extrabold text-white mt-1 font-mono">{totalClusters}</div>
          <span className="text-xs text-slate-400 mt-0.5 block">{totalHH} Total Households</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
          <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider block">DAILY ENERGY DEMAND</span>
          <div className="text-2xl font-extrabold text-white mt-1 font-mono">{totalDemandKwh.toFixed(1)} kWh</div>
          <span className="text-xs text-slate-400 mt-0.5 block">1.4 kWh / HH / Day Avg</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
          <span className="text-[11px] font-bold text-sky-400 uppercase tracking-wider block">RECOMMENDED SOLAR PV</span>
          <div className="text-2xl font-extrabold text-white mt-1 font-mono">{totalSolarKw.toFixed(1)} kWp</div>
          <span className="text-xs text-slate-400 mt-0.5 block">5.6 kWh/m² Solar GHI</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
          <span className="text-[11px] font-bold text-indigo-400 uppercase tracking-wider block">VIIRS NIGHT LIGHTS GAP</span>
          <div className="text-2xl font-extrabold text-white mt-1 font-mono">100% Dark</div>
          <span className="text-xs text-slate-400 mt-0.5 block">Unserved Off-Grid Territory</span>
        </div>
      </div>

      {/* Clusters Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
          <Sun className="w-4 h-4 text-amber-400" />
          <span>SETTLEMENT CLUSTERS &amp; ELECTRIFICATION ARCHITECTURE</span>
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 font-semibold">
              <tr>
                <th className="p-2.5">Cluster ID</th>
                <th className="p-2.5">Households</th>
                <th className="p-2.5">Pop. Est.</th>
                <th className="p-2.5">Grid Distance</th>
                <th className="p-2.5">Daily Demand</th>
                <th className="p-2.5">Solar PV Capacity</th>
                <th className="p-2.5">Recommended Solution</th>
                <th className="p-2.5">Nocturnal Radiance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-300 font-mono text-[11px]">
              {result.energyClusters.map((c) => (
                <tr key={c.id} className="hover:bg-slate-800/40">
                  <td className="p-2.5 font-bold text-white">{c.id}</td>
                  <td className="p-2.5">{c.householdCount} HH</td>
                  <td className="p-2.5">{c.populationEstimate} people</td>
                  <td className="p-2.5 text-blue-400">{c.gridDistanceKm} km</td>
                  <td className="p-2.5">{c.dailyDemandKwh} kWh</td>
                  <td className="p-2.5 text-amber-400">{c.recommendedSolarKw} kWp</td>
                  <td className="p-2.5 font-sans">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        c.recommendedType === "Mini-Grid"
                          ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
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

      {/* Commercial Field Deployment Strategy */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-bold text-white tracking-wide">
          FIELD OPERATIONS &amp; AGENT NETWORK RECOMMENDATION (SUN KING)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-300">
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
            <strong className="text-amber-400 block mb-1">Last-Mile Sales Territory Routing</strong>
            Deploy a dedicated team of 8 commission-based field agents covering a 4.5km service radius from the community health dispensary depot.
          </div>
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
            <strong className="text-sky-400 block mb-1">PAYG Financing Model</strong>
            Roll out Pay-As-You-Go solar loans at $0.45/day payable via M-Pesa / mobile money, replacing diesel generator fuel expenses.
          </div>
        </div>
      </div>
    </div>
  );
};