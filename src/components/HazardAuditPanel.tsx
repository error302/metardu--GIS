import React from "react";
import { AlertTriangle, ShieldCheck, Droplets, MapPin, CheckSquare } from "lucide-react";
import { PipelineResult } from "../types/spatial";

interface HazardAuditPanelProps {
  result: PipelineResult;
}

export const HazardAuditPanel: React.FC<HazardAuditPanelProps> = ({ result }) => {
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 text-slate-100 overflow-y-auto h-[calc(100vh-125px)]">
      {/* Header */}
      <div className="border-b border-slate-800 pb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-400" />
          <h2 className="text-lg font-bold tracking-tight text-white font-['Plus_Jakarta_Sans']">
            HAZARD &amp; CLIMATE RISK VULNERABILITY AUDITOR (UN-HABITAT)
          </h2>
        </div>
        <p className="text-xs text-slate-400 mt-1">
          Automated identification of low-point flood inundation sinks and audit of vulnerable community assets in harm's way.
        </p>
      </div>

      {/* Sinks Summary Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {result.hazardSinks.map((s) => (
          <div key={s.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-white font-mono">{s.id}</span>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                  s.riskLevel === "critical"
                    ? "bg-red-500/10 text-red-400 border border-red-500/20"
                    : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                }`}
              >
                {s.riskLevel} RISK
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono pt-1 text-slate-300">
              <div>Ponding Depth: <strong className="text-white">{s.depthM}m</strong></div>
              <div>Min Elev: <strong className="text-white">{s.minElevation}m</strong></div>
              <div>Inundation Area: <strong className="text-white">{s.pondingAreaSqM} m²</strong></div>
              <div>Spill Elev: <strong className="text-white">{s.spillElevation}m</strong></div>
            </div>
          </div>
        ))}
      </div>

      {/* Exposed Infrastructure Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
            <Droplets className="w-4 h-4 text-cyan-400" />
            <span>VULNERABLE ASSETS IDENTIFIED WITHIN FLOOD INUNDATION PATH</span>
          </h3>
          <span className="text-xs text-red-400 font-mono font-bold">
            {result.exposedAssets.length} Critical Assets Exposed
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 font-semibold">
              <tr>
                <th className="p-2.5">Asset Name</th>
                <th className="p-2.5">Type</th>
                <th className="p-2.5">Coordinate (E, N)</th>
                <th className="p-2.5">Elevation</th>
                <th className="p-2.5">Distance to Sink</th>
                <th className="p-2.5">Risk Rating</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-300">
              {result.exposedAssets.map((a) => (
                <tr key={a.id} className="hover:bg-slate-800/40 font-mono text-[11px]">
                  <td className="p-2.5 font-bold text-white font-sans">{a.name}</td>
                  <td className="p-2.5 capitalize">{a.type}</td>
                  <td className="p-2.5">{a.coordinate[0].toLocaleString()}m, {a.coordinate[1].toLocaleString()}m</td>
                  <td className="p-2.5 text-sky-400">{a.elevation.toFixed(1)}m MSL</td>
                  <td className="p-2.5">{a.distanceToSinkM}m</td>
                  <td className="p-2.5">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        a.hazardRisk === "critical"
                          ? "bg-red-500/20 text-red-400"
                          : "bg-amber-500/20 text-amber-400"
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
      </div>

      {/* Climate Resilience Action Plan */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
          <CheckSquare className="w-4 h-4 text-emerald-400" />
          <span>STATUTORY CLIMATE MITIGATION ACTION PLAN</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-300">
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
            <strong className="text-white block mb-1">1. Drainage Culvert Upgrades</strong>
            Install dual 1,200mm precast concrete culverts at access road crossing to handle 50-year flood discharge.
          </div>
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
            <strong className="text-white block mb-1">2. Resettlement Action Plan (RAP)</strong>
            Relocate 12 vulnerable households currently situated below the 504.5m spill elevation contour.
          </div>
        </div>
      </div>
    </div>
  );
};