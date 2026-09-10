import React from "react";
import {
  Layers,
  Play,
  Download,
  Compass,
  Box,
  Sliders,
  AlertTriangle,
  Zap,
  FileText,
  MapPin,
  Clock,
  Globe,
  Save,
  FolderOpen,
  Printer,
} from "lucide-react";
import { BenchmarkScenario, BENCHMARK_SCENARIOS } from "../data/sample-surveys";
import { listSupportedEPSG, crsEpsgFromMetadata } from "../core/crs";

export type ActiveTab =
  | "canvas2d"
  | "terrain3d"
  | "mcda"
  | "hazards"
  | "energy"
  | "deedplan"
  | "atlas"
  | "layout"
  | "datagrid";

interface HeaderProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  selectedScenario: BenchmarkScenario;
  onSelectScenario: (scenario: BenchmarkScenario) => void;
  onRunPipeline: () => void;
  onOpenExport: () => void;
  totalDurationMs: number;
  currentCrs?: string;
  onCrsChange?: (epsg: number) => void;
  onSaveProject?: () => void;
  onOpenProjectFile?: (content: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  selectedScenario,
  onSelectScenario,
  onRunPipeline,
  onOpenExport,
  totalDurationMs,
  currentCrs,
  onCrsChange,
  onSaveProject,
  onOpenProjectFile,
}) => {
  const supportedCrs = listSupportedEPSG();
  const activeEpsg = crsEpsgFromMetadata(currentCrs || selectedScenario.metadata.crs);
  return (
    <header className="bg-[#0B0F17] border-b border-slate-800 px-4 py-2.5 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        {/* Brand & Identity */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center shadow-lg shadow-blue-500/20 border border-blue-400/30">
            <Compass className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold tracking-tight text-white font-['Plus_Jakarta_Sans']">
                METARDU GIS STUDIO
              </h1>
              <span className="px-2 py-0.5 text-[10px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded">
                AUTONOMOUS WORKSTATION
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Survey-to-GIS Precision, Settlement Suitability &amp; Off-Grid Electrification
            </p>
          </div>
        </div>

        {/* Center: Scenario Switcher & Run Pipeline */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-2 bg-slate-900/90 border border-slate-700/60 rounded-md px-2.5 py-1.5">
            <span className="text-xs text-slate-400 font-medium">Scenario:</span>
            <select
              value={selectedScenario.id}
              onChange={(e) => {
                const s = BENCHMARK_SCENARIOS.find((sc) => sc.id === e.target.value);
                if (s) onSelectScenario(s);
              }}
              className="bg-transparent text-xs text-white font-semibold focus:outline-none cursor-pointer"
            >
              {BENCHMARK_SCENARIOS.map((sc) => (
                <option key={sc.id} value={sc.id} className="bg-slate-900 text-white">
                  {sc.title} ({sc.badge})
                </option>
              ))}
            </select>
          </div>

          {/* CRS Selector */}
          <div className="flex items-center gap-1.5 bg-slate-900/90 border border-slate-700/60 rounded-md px-2.5 py-1.5">
            <Globe className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span className="text-xs text-slate-400 font-medium">CRS:</span>
            <select
              value={activeEpsg}
              onChange={(e) => onCrsChange?.(Number(e.target.value))}
              className="bg-transparent text-xs text-white font-semibold focus:outline-none cursor-pointer max-w-[170px] truncate"
              title="Coordinate Reference System (proj4)"
            >
              {supportedCrs.map((c) => (
                <option key={c.epsg} value={c.epsg} className="bg-slate-900 text-white">
                  EPSG:{c.epsg} — {c.name}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={onRunPipeline}
            className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white text-xs font-bold px-3.5 py-1.5 rounded-md shadow-md shadow-blue-600/30 transition active:scale-95 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>RUN AUTONOMOUS PIPELINE</span>
          </button>

          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-slate-900 border border-slate-800 text-xs font-mono text-emerald-400">
            <Clock className="w-3.5 h-3.5" />
            <span>{totalDurationMs} ms</span>
          </div>

          <button
            onClick={onOpenExport}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold px-3 py-1.5 rounded-md transition cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Deliverables</span>
          </button>

          {onSaveProject && (
            <button
              onClick={onSaveProject}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold px-3 py-1.5 rounded-md transition cursor-pointer"
              title="Save Project to .metardu.json"
            >
              <Save className="w-3.5 h-3.5 text-blue-400" />
              <span>Save Project</span>
            </button>
          )}

          {onOpenProjectFile && (
            <label
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold px-3 py-1.5 rounded-md transition cursor-pointer"
              title="Open .metardu.json Project File"
            >
              <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
              <span>Open Project</span>
              <input
                type="file"
                accept=".json,.metardu.json"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const r = new FileReader();
                  r.onload = (ev) => {
                    const text = ev.target?.result as string;
                    if (text) onOpenProjectFile(text);
                  };
                  r.readAsText(file);
                }}
                className="hidden"
              />
            </label>
          )}
        </div>
      </div>

      {/* Tabs Bar */}
      <div className="flex items-center gap-1 border-t border-slate-800/80 pt-1.5 overflow-x-auto text-xs font-medium">
        <button
          onClick={() => setActiveTab("canvas2d")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition cursor-pointer ${
            activeTab === "canvas2d"
              ? "bg-blue-600/20 text-blue-400 border border-blue-500/30 font-semibold"
              : "text-slate-400 hover:text-white hover:bg-slate-800/50"
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>2D GIS &amp; CAD Canvas</span>
        </button>

        <button
          onClick={() => setActiveTab("terrain3d")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition cursor-pointer ${
            activeTab === "terrain3d"
              ? "bg-blue-600/20 text-blue-400 border border-blue-500/30 font-semibold"
              : "text-slate-400 hover:text-white hover:bg-slate-800/50"
          }`}
        >
          <Box className="w-3.5 h-3.5" />
          <span>3D Surface &amp; Contours</span>
        </button>

        <button
          onClick={() => setActiveTab("mcda")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition cursor-pointer ${
            activeTab === "mcda"
              ? "bg-blue-600/20 text-blue-400 border border-blue-500/30 font-semibold"
              : "text-slate-400 hover:text-white hover:bg-slate-800/50"
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Settlement Suitability (MCDA)</span>
        </button>

        <button
          onClick={() => setActiveTab("hazards")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition cursor-pointer ${
            activeTab === "hazards"
              ? "bg-blue-600/20 text-blue-400 border border-blue-500/30 font-semibold"
              : "text-slate-400 hover:text-white hover:bg-slate-800/50"
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>Hazard Vulnerability</span>
        </button>

        <button
          onClick={() => setActiveTab("energy")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition cursor-pointer ${
            activeTab === "energy"
              ? "bg-blue-600/20 text-blue-400 border border-blue-500/30 font-semibold"
              : "text-slate-400 hover:text-white hover:bg-slate-800/50"
          }`}
        >
          <Zap className="w-3.5 h-3.5" />
          <span>Off-Grid Electrification</span>
        </button>

        <button
          onClick={() => setActiveTab("deedplan")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition cursor-pointer ${
            activeTab === "deedplan"
              ? "bg-blue-600/20 text-blue-400 border border-blue-500/30 font-semibold"
              : "text-slate-400 hover:text-white hover:bg-slate-800/50"
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Statutory Deed Plan (Form 4)</span>
        </button>

        <button
          onClick={() => setActiveTab("atlas")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition cursor-pointer ${
            activeTab === "atlas"
              ? "bg-blue-600/20 text-blue-400 border border-blue-500/30 font-semibold"
              : "text-slate-400 hover:text-white hover:bg-slate-800/50"
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Regional Planning Atlas</span>
        </button>

        <button
          onClick={() => setActiveTab("layout")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition cursor-pointer ${
            activeTab === "layout"
              ? "bg-blue-600/20 text-blue-400 border border-blue-500/30 font-semibold"
              : "text-slate-400 hover:text-white hover:bg-slate-800/50"
          }`}
        >
          <Printer className="w-3.5 h-3.5" />
          <span>Print Layout Composer</span>
        </button>

        <button
          onClick={() => setActiveTab("datagrid")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition cursor-pointer ${
            activeTab === "datagrid"
              ? "bg-blue-600/20 text-blue-400 border border-blue-500/30 font-semibold"
              : "text-slate-400 hover:text-white hover:bg-slate-800/50"
          }`}
        >
          <MapPin className="w-3.5 h-3.5" />
          <span>Attribute Table &amp; Data Grid</span>
        </button>
      </div>
    </header>
  );
};