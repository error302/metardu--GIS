import React, { useState, useEffect, useCallback } from "react";
import { Header, ActiveTab } from "./components/Header";
import { StatusBar, CursorReadout } from "./components/StatusBar";
import { MapCanvas2D } from "./components/MapCanvas2D";
import { TerrainViewer3D } from "./components/TerrainViewer3D";
import { McdaSuitabilityPanel } from "./components/McdaSuitabilityPanel";
import { HazardAuditPanel } from "./components/HazardAuditPanel";
import { EnergyPlanningPanel } from "./components/EnergyPlanningPanel";
import { DeedPlanViewer } from "./components/DeedPlanViewer";
import { PlanningAtlasViewer } from "./components/PlanningAtlasViewer";
import { AttributeTable } from "./components/AttributeTable";
import { ExportHubModal } from "./components/ExportHubModal";
import { BENCHMARK_SCENARIOS, BenchmarkScenario } from "./data/sample-surveys";
import { runAutonomousGisPipeline } from "./core/pipeline";
import { PipelineResult, SurveyPoint } from "./types/spatial";
import { transform, crsEpsgFromMetadata, getCRS } from "./core/crs";
import { createProjectSnapshot, downloadProjectFile, parseProjectFile } from "./core/project";

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>("canvas2d");
  const [selectedScenario, setSelectedScenario] = useState<BenchmarkScenario>(BENCHMARK_SCENARIOS[0]);
  const [pipelineResult, setPipelineResult] = useState<PipelineResult | null>(null);
  const [selectedPointIds, setSelectedPointIds] = useState<string[]>([]);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Live view state reported by the 2D canvas into the global status bar
  const [cursor, setCursor] = useState<CursorReadout | null>(null);
  const [scaleDenominator, setScaleDenominator] = useState(1000);

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

  const handleCrsChange = (newEpsg: number) => {
    if (!pipelineResult) return;
    const currentEpsg = crsEpsgFromMetadata(pipelineResult.metadata.crs);
    if (currentEpsg === newEpsg) return;

    const crsDef = getCRS(newEpsg);
    const newCrsName = crsDef ? `${crsDef.name} (EPSG: ${crsDef.epsg})` : `EPSG:${newEpsg}`;

    // Reproject all coordinates to target CRS using proj4
    const reprojectedPoints = pipelineResult.points.map((pt) => {
      const [newE, newN] = transform(currentEpsg, newEpsg, pt.easting, pt.northing);
      return {
        ...pt,
        easting: Number(newE.toFixed(3)),
        northing: Number(newN.toFixed(3)),
      };
    });

    const updatedMetadata = {
      ...pipelineResult.metadata,
      crs: newCrsName,
    };

    executePipeline({ ...selectedScenario, metadata: updatedMetadata }, reprojectedPoints);
  };

  const handleSaveProject = () => {
    if (!pipelineResult) return;
    const project = createProjectSnapshot(pipelineResult);
    downloadProjectFile(project);
  };

  const handleOpenProjectFile = (jsonText: string) => {
    try {
      const proj = parseProjectFile(jsonText);
      executePipeline(
        {
          id: proj.metadata.id,
          title: proj.projectName,
          badge: "Project File",
          description: `Loaded project file (${proj.savedAt.split("T")[0]})`,
          metadata: proj.metadata,
          points: proj.points,
        },
        proj.points
      );
    } catch (err: any) {
      alert(`Could not load project: ${err.message}`);
    }
  };

  const handleCursorReadout = useCallback((c: CursorReadout | null) => setCursor(c), []);
  const handleScaleChange = useCallback((s: number) => setScaleDenominator(s), []);

  if (!pipelineResult) {
    return (
      <div className="w-screen h-screen bg-app flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <span className="ui-label">Initializing workspace</span>
        </div>
      </div>
    );
  }

  const activeEpsg = crsEpsgFromMetadata(pipelineResult.metadata.crs);
  const activeCrsDef = getCRS(activeEpsg);

  return (
    <div className="flex flex-col h-screen w-screen bg-app text-ink overflow-hidden">
      {/* Top application chrome */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        selectedScenario={selectedScenario}
        onSelectScenario={handleScenarioChange}
        onRunPipeline={handleRunPipeline}
        onOpenExport={() => setIsExportOpen(true)}
        totalDurationMs={pipelineResult.totalDurationMs}
        currentCrs={pipelineResult.metadata.crs}
        onCrsChange={handleCrsChange}
        onSaveProject={handleSaveProject}
        onOpenProjectFile={handleOpenProjectFile}
      />

      {/* Workspace */}
      <main className="flex-1 min-h-0 relative overflow-hidden">
        {isLoading && (
          <div className="absolute inset-x-0 top-0 h-0.5 z-50 overflow-hidden">
            <div className="h-full w-1/3 bg-accent animate-[pipeline_0.9s_ease-in-out_infinite]" />
          </div>
        )}
        {activeTab === "canvas2d" && (
          <MapCanvas2D
            result={pipelineResult}
            selectedPointIds={selectedPointIds}
            onSelectPoint={(id) => {
              setSelectedPointIds((prev) =>
                prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
              );
            }}
            onCursorReadout={handleCursorReadout}
            onScaleChange={handleScaleChange}
          />
        )}
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
        {activeTab === "energy" && (
          <EnergyPlanningPanel
            result={pipelineResult}
            onUpdateClusters={(newClusters) =>
              setPipelineResult((prev) => (prev ? { ...prev, energyClusters: newClusters } : prev))
            }
          />
        )}
        {activeTab === "deedplan" && <DeedPlanViewer result={pipelineResult} />}
        {activeTab === "atlas" && <PlanningAtlasViewer result={pipelineResult} />}
        {activeTab === "datagrid" && (
          <AttributeTable
            result={pipelineResult}
            selectedPointIds={selectedPointIds}
            onSelectPoints={setSelectedPointIds}
            onUploadCustomSurvey={handleUploadCustomSurvey}
            onUpdatePoints={(pts) => executePipeline(selectedScenario, pts)}
          />
        )}
      </main>

      {/* Persistent instrument strip */}
      <StatusBar
        cursor={activeTab === "canvas2d" ? cursor : null}
        scaleDenominator={scaleDenominator}
        epsg={activeEpsg}
        crsName={activeCrsDef?.name ?? pipelineResult.metadata.crs}
        featureCount={pipelineResult.points.length}
        selectedCount={selectedPointIds.length}
        scenarioTitle={pipelineResult.metadata.title}
        telemetries={pipelineResult.telemetries}
        totalDurationMs={pipelineResult.totalDurationMs}
      />

      {/* Export hub */}
      {isExportOpen && (
        <ExportHubModal result={pipelineResult} onClose={() => setIsExportOpen(false)} />
      )}
    </div>
  );
};
