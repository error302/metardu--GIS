import React from "react";
import {
  Play,
  Download,
  Save,
  FolderOpen,
  Layers,
  Box,
  SlidersHorizontal,
  ShieldAlert,
  Zap,
  FileText,
  Map,
  Table2,
  Undo2,
  Redo2,
  Import,
  Printer,
  Database,
  Fingerprint,
  Crosshair,
} from "lucide-react";
import { BenchmarkScenario, BENCHMARK_SCENARIOS } from "../data/sample-surveys";
import { CrsPicker } from "./CrsPicker";
import { crsEpsgFromMetadata } from "../core/crs";

export type ActiveTab =
  | "canvas2d"
  | "terrain3d"
  | "mcda"
  | "hazards"
  | "energy"
  | "deedplan"
  | "atlas"
  | "composer"
  | "datagrid"
  | "postgis"
  | "provenance"
  | "traverse";

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
  onImportFiles?: (files: File[]) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  undoLabel?: string | null;
  redoLabel?: string | null;
}

/** Navigation model — grouped by discipline, mirrors the survey workflow. */
const NAV_GROUPS: { label: string; items: { id: ActiveTab; label: string; icon: React.ElementType }[] }[] = [
  {
    label: "Canvas",
    items: [
      { id: "canvas2d", label: "2D Canvas", icon: Layers },
      { id: "terrain3d", label: "3D Terrain", icon: Box },
    ],
  },
  {
    label: "Analysis",
    items: [
      { id: "traverse", label: "Traverse", icon: Crosshair },
      { id: "mcda", label: "Suitability (MCDA)", icon: SlidersHorizontal },
      { id: "hazards", label: "Hazard Audit", icon: ShieldAlert },
      { id: "energy", label: "Electrification", icon: Zap },
    ],
  },
  {
    label: "Deliverables",
    items: [
      { id: "deedplan", label: "Deed Plan (Form 4)", icon: FileText },
      { id: "atlas", label: "Planning Atlas", icon: Map },
      { id: "composer", label: "Print Composer", icon: Printer },
    ],
  },
  {
    label: "Data",
    items: [
      { id: "datagrid", label: "Attribute Table", icon: Table2 },
      { id: "postgis", label: "PostGIS Link", icon: Database },
      { id: "provenance", label: "Provenance", icon: Fingerprint },
    ],
  },
];

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
  onImportFiles,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  undoLabel,
  redoLabel,
}) => {
  const activeEpsg = crsEpsgFromMetadata(currentCrs || selectedScenario.metadata.crs);

  return (
    <header className="bg-panel border-b border-line flex flex-col shrink-0">
      {/* ── Row 1: application toolbar ──────────────────────────── */}
      <div className="h-10 px-3 flex items-center gap-2">
        {/* Identity */}
        <div className="flex items-center gap-2 pr-1">
          <div className="w-6 h-6 rounded-[3px] border border-line-strong bg-raised flex items-center justify-center">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M12 2L15 9L22 12L15 15L12 22L9 15L2 12L9 9L12 2Z" fill="var(--color-accent)" />
            </svg>
          </div>
          <span className="text-[13px] font-semibold tracking-tight text-ink whitespace-nowrap">
            MetaRDU GIS
          </span>
          <span className="text-[10px] tnum text-ink-3 border border-line rounded-[3px] px-1 py-px">
            v1.0
          </span>
        </div>

        <div className="ui-vsep" />

        {/* Project I/O */}
        <button
          onClick={onSaveProject}
          className="ui-btn"
          title="Save workspace to .metardu.json"
        >
          <Save className="w-3.5 h-3.5" />
          <span>Save</span>
        </button>
        <label className="ui-btn" title="Open .metardu.json project" style={{ cursor: "pointer" }}>
          <FolderOpen className="w-3.5 h-3.5" />
          <span>Open</span>
          <input
            type="file"
            accept=".json,.metardu.json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const r = new FileReader();
              r.onload = (ev) => {
                const text = ev.target?.result as string;
                if (text) onOpenProjectFile?.(text);
              };
              r.readAsText(file);
            }}
            className="hidden"
          />
        </label>
        <label
          className="ui-btn"
          title="Import Shapefile (.shp + .dbf), GeoJSON, or GeoPackage"
          style={{ cursor: "pointer" }}
        >
          <Import className="w-3.5 h-3.5" />
          <span>Import</span>
          <input
            type="file"
            multiple
            accept=".shp,.dbf,.shx,.prj,.geojson,.json,.gpkg"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = ""; // allow re-selecting the same file set
              if (files.length > 0) onImportFiles?.(files);
            }}
            className="hidden"
          />
        </label>

        <div className="ui-vsep" />

        {/* Edit history */}
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className="ui-btn-icon"
          title={canUndo ? `Undo: ${undoLabel ?? ""} (Ctrl+Z)` : "Nothing to undo"}
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className="ui-btn-icon"
          title={canRedo ? `Redo: ${redoLabel ?? ""} (Ctrl+Shift+Z)` : "Nothing to redo"}
        >
          <Redo2 className="w-3.5 h-3.5" />
        </button>

        <div className="ui-vsep" />

        {/* Job + CRS */}
        <select
          value={selectedScenario.id}
          onChange={(e) => {
            const s = BENCHMARK_SCENARIOS.find((sc) => sc.id === e.target.value);
            if (s) onSelectScenario(s);
          }}
          className="ui-select w-[300px]"
          title="Survey job / scenario"
        >
          {BENCHMARK_SCENARIOS.map((sc) => (
            <option key={sc.id} value={sc.id}>
              {sc.title}
            </option>
          ))}
        </select>

        <CrsPicker activeEpsg={activeEpsg} onCrsChange={onCrsChange ?? (() => {})} />

        {/* Right cluster */}
        <div className="ml-auto flex items-center gap-2">
          <span
            className="text-[11px] tnum text-ink-3 px-1.5"
            title="Last pipeline execution time"
          >
            {totalDurationMs} ms
          </span>

          <button onClick={onOpenExport} className="ui-btn">
            <Download className="w-3.5 h-3.5" />
            <span>Export</span>
          </button>

          <button onClick={onRunPipeline} className="ui-btn-accent" title="Re-run full processing pipeline">
            <Play className="w-3 h-3 fill-current" />
            <span>Run Pipeline</span>
          </button>
        </div>
      </div>

      {/* ── Row 2: grouped workspace navigation ─────────────────── */}
      <nav className="h-[35px] px-2 flex items-stretch border-t border-line overflow-x-auto">
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.label} className="flex items-stretch">
            {gi > 0 && <div className="ui-vsep self-center mx-1.5" />}
            <div className="flex items-stretch">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    className={`ui-tab ${isActive ? "is-active" : ""}`}
                    title={group.label}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </header>
  );
};
