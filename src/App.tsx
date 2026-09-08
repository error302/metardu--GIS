import React, { useState, useEffect } from "react";
import { Header, ActiveTab } from "./components/Header";
import { PipelineTelemetryBar } from "./components/PipelineTelemetry";
import { MapCanvas2D } from "./components/MapCanvas2D";
import { TerrainViewer3D } from "./components/TerrainViewer3D";
import { McdaSuitabilityPanel } from "./components/McdaSuitabilityPanel";
import { HazardAuditPanel } from "./components/HazardAuditPanel";
import { EnergyPlanningPanel } from "./components/EnergyPlanningPanel";
import { DeedPlanViewer } from "./components/DeedPlanViewer";
import { PlanningAtlasViewer } from "./components/PlanningAtlasViewer";
import { PointDataGrid } from "./components/PointDataGrid";
import { ExportHubModal } from "./components/ExportHubModal";
import { BENCHMARK_SCENARIOS, BenchmarkScenario } from "./data/sample-surveys";
import { runAutonomousGisPipeline } from "./core/pipeline";
import { PipelineResult, SurveyPoint } from "./types/spatial";

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>("canvas2d");
  const [selectedScenario, setSelectedScenario] = useState<BenchmarkScenario>(BENCHMARK_SCENARIOS[0]);
  const [pipelineResult, setPipelineResult] = useState<PipelineResult | null>(null);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Execute pipeline for scenario
  const executePipeline = async (scenario: BenchmarkScenario, customPoints?: SurveyPoint[]) => {
    setIsLoading(true);
    const pts = customPoints || scenario.points;
    const res = await runAutonomousGisPipeline(pts, scenario.metadata);
    setPipelineResult(res);
    setIsLoading(false);
  };

  // Run on initial mount
  useEffect(() => {
    executePipeline(selectedScenario);
  }, []);

  const handleScenarioChange = (scenario: BenchmarkScenario) => {
    setSelectedScenario(scenario);
    executePipeline(scenario);
  };

  const handleRunPipeline = () => {
    if (pipelineResult) {
      executePipeline(selectedScenario, pipelineResult.points);
    } else {
      executePipeline(selectedScenario);
    }
  };

  const handleUploadCustomSurvey = (text: string) => {
    executePipeline(
      {
        id: "custom-survey",
        title: "Custom Field Ingested Survey",
        badge: "User Uploaded",
        description: "Custom uploaded field survey coordinates.",
        metadata: {
          id: "CUSTOM-01",
          title: "Custom Project Site",
          locality: "Field Station Locality",
          country: "East Africa",
          crs: "Arc 1960 / UTM zone 37S",
          surveyorName: "Field Geomatics Specialist",
          registrationNo: "MISK-FIELD-01",
          date: new Date().toISOString().split("T")[0],
          scale: "1:1,000",
          organization: "MetaRDU GIS Workstation",
        },
        points: [],
      },
      text as any
    );
  };

  if (!pipelineResult) {
    return (
      <div className="w-screen h-screen bg-[#0B0F17] flex items-center justify-center text-slate-100 font-mono">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-slate-400">INITIALIZING METARDU AUTONOMOUS GIS WORKSTATION...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0B0F17] text-slate-100 overflow-hidden font-['Plus_Jakarta_Sans'] select-none">
      {/* Top Application Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        selectedScenario={selectedScenario}
        onSelectScenario={handleScenarioChange}
        onRunPipeline={handleRunPipeline}
        onOpenExport={() => setIsExportOpen(true)}
        totalDurationMs={pipelineResult.totalDurationMs}
      />

      {/* Real-time Sub-Second Pipeline Telemetry Bar */}
      <PipelineTelemetryBar
        telemetries={pipelineResult.telemetries}
        totalDurationMs={pipelineResult.totalDurationMs}
      />

      {/* Main Workspace Tabs */}
      <main className="flex-1 relative overflow-hidden">
        {activeTab === "canvas2d" && <MapCanvas2D result={pipelineResult} />}
        {activeTab === "terrain3d" && <TerrainViewer3D result={pipelineResult} />}
        {activeTab === "mcda" && (
          <McdaSuitabilityPanel
            result={pipelineResult}
            onUpdateSuitability={(newCells) =>
              setPipelineResult((prev) => (prev ? { ...prev, suitability: newCells } : prev))
            }
          />
        )}
        {activeTab === "hazards" && <HazardAuditPanel result={pipelineResult} />}
        {activeTab === "energy" && <EnergyPlanningPanel result={pipelineResult} />}
        {activeTab === "deedplan" && <DeedPlanViewer result={pipelineResult} />}
        {activeTab === "atlas" && <PlanningAtlasViewer result={pipelineResult} />}
        {activeTab === "datagrid" && (
          <PointDataGrid
            result={pipelineResult}
            onUploadCustomSurvey={handleUploadCustomSurvey}
            onUpdatePoints={(pts) => executePipeline(selectedScenario, pts)}
          />
        )}
      </main>

      {/* 1-Click Export Hub Modal */}
      {isExportOpen && (
        <ExportHubModal result={pipelineResult} onClose={() => setIsExportOpen(false)} />
      )}
    </div>
  );
};