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
import { pipelineService, PipelineProgressEvent } from "./core/pipeline-client";
import { ingestFiles } from "./core/ingest";
import { ensureGpkgBrowserLoader } from "./core/ingest/gpkg-browser";
import { PipelineResult, SurveyPoint } from "./types/spatial";
import { transform, transformFromDef, crsEpsgFromMetadata, getCRS, registerCrsDefinition } from "./core/crs";
import { createProjectSnapshot, downloadProjectFile, parseProjectFile } from "./core/project";
import { useHistoryState } from "./hooks/use-history";
import { initGeoidModel, subscribeGeoidStatus, GeoidStatus } from "./core/geoid/grid";
import { DEFAULT_MCDA_WEIGHTS } from "./core/mcda-suitability";
import { ComposerPanel } from "./components/ComposerPanel";
import { PostgisPanel } from "./components/PostgisPanel";
import { ProvenancePanel } from "./components/ProvenancePanel";
import { TraversePanel } from "./components/TraversePanel";
import { ScenarioComparePanel } from "./components/ScenarioComparePanel";
import { SyncPanel } from "./components/SyncPanel";

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>("canvas2d");
  const [selectedScenario, setSelectedScenario] = useState<BenchmarkScenario>(BENCHMARK_SCENARIOS[0]);
  const [selectedPointIds, setSelectedPointIds] = useState<string[]>([]);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<{ pct: number; stage: string } | null>(null);

  // Real geoid model — lazy-load the bundled EGM2008 East-Africa grid on mount.
  const [geoidStatus, setGeoidStatus] = useState<GeoidStatus>({
    state: "uninitialized",
    model: "parametric",
  });
  useEffect(() => {
    const unsub = subscribeGeoidStatus(setGeoidStatus);
    initGeoidModel();
    return unsub;
  }, []);

  // Single immutable document with a bounded undo/redo command stack
  const doc = useHistoryState<PipelineResult | null>(null, "Workspace opened");
  const pipelineResult = doc.state;

  // Live view state reported by the 2D canvas into the global status bar
  const [cursor, setCursor] = useState<CursorReadout | null>(null);
  const [scaleDenominator, setScaleDenominator] = useState(1000);

  /**
   * Execute the pipeline through the worker service (main-thread fallback
   * transparent). mode "reset" starts a new document; "push" records an
   * undoable command.
   */
  const executePipeline = async (
    scenario: BenchmarkScenario,
    customPoints?: SurveyPoint[] | string,
    mode: "push" | "reset" = "push",
    label = "Run pipeline"
  ) => {
    setIsLoading(true);
    setProgress({ pct: 0, stage: "Queued" });
    try {
      const res = await pipelineService.run(customPoints ?? scenario.points, scenario.metadata, {
        onProgress: (p: PipelineProgressEvent) =>
          setProgress({ pct: Math.round((p.step / p.totalSteps) * 100), stage: p.stage }),
      });
      if (mode === "reset") doc.reset(res, label);
      else doc.push(res, label);
    } catch (err: any) {
      alert(`Pipeline failed: ${err?.message ?? err}`);
    } finally {
      setIsLoading(false);
      setProgress(null);
    }
  };

  // Initial load — opens a fresh document (not an undoable command)
  useEffect(() => {
    executePipeline(selectedScenario, undefined, "reset", "Workspace opened");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleScenarioChange = (scenario: BenchmarkScenario) => {
    setSelectedScenario(scenario);
    executePipeline(scenario, undefined, "reset", `Open scenario: ${scenario.title}`);
  };

  const handleRunPipeline = () => {
    if (pipelineResult) {
      executePipeline(selectedScenario, pipelineResult.points, "push", "Re-run pipeline");
    } else {
      executePipeline(selectedScenario, undefined, "reset", "Run pipeline");
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
      text as any,
      "reset",
      "Ingest pasted survey"
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

    executePipeline(
      { ...selectedScenario, metadata: updatedMetadata },
      reprojectedPoints,
      "push",
      `Reproject to ${newCrsName}`
    );
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
        proj.points,
        "reset",
        `Open project: ${proj.projectName}`
      );
    } catch (err: any) {
      alert(`Could not load project: ${err.message}`);
    }
  };

  const handleImportFiles = async (files: File[]) => {
    setIsLoading(true);
    setProgress({ pct: 0, stage: "Reading files" });
    try {
      // Prepare the GeoPackage WASM engine only when a .gpkg is in the set.
      if (files.some((f) => f.name.toLowerCase().endsWith(".gpkg"))) {
        setProgress({ pct: 5, stage: "Loading GeoPackage engine" });
        await ensureGpkgBrowserLoader();
      }
      const result = await ingestFiles(files);

      // Working CRS for imports (matches importedMetadata below).
      const WORKING_EPSG = 21037;
      let points = result.points;
      if (result.sourceCrs) {
        const src = result.sourceCrs;
        const needsTransform =
          (src.epsg !== null && src.epsg !== WORKING_EPSG) || src.epsg === null;
        if (needsTransform && points.length > 0) {
          setProgress({ pct: 12, stage: "Reprojecting to working CRS" });
          if (src.epsg === null) {
            // Unregistered WKT definition — transform from the raw proj4 string.
            const def = src.proj4;
            points = points.map((p) => {
              const [e, n] = transformFromDef(def, WORKING_EPSG, p.easting, p.northing);
              return { ...p, easting: Number(e.toFixed(4)), northing: Number(n.toFixed(4)) };
            });
          } else {
            const def = getCRS(src.epsg);
            if (def) registerCrsDefinition(def, false);
            points = points.map((p) => {
              const [e, n] = transform(src.epsg!, WORKING_EPSG, p.easting, p.northing);
              return { ...p, easting: Number(e.toFixed(4)), northing: Number(n.toFixed(4)) };
            });
          }
          result.warnings.push(
            `Reprojected ${points.length} vertices from ${src.name}${src.epsg ? ` (EPSG:${src.epsg})` : ""} to the working CRS.`,
          );
        }
      }

      const importedMetadata = {
        id: "IMPORT-01",
        title: result.layerName,
        locality: "Imported dataset",
        country: "—",
        crs: "Arc 1960 / UTM zone 37S",
        surveyorName: "Imported source",
        registrationNo: "IMPORT",
        date: new Date().toISOString().split("T")[0],
        scale: "1:1,000",
        organization: "MetaRDU GIS Workstation",
      };
      await executePipeline(
        { ...(selectedScenario as BenchmarkScenario), metadata: importedMetadata, points: [] },
        points,
        "reset",
        `Import: ${result.layerName}`
      );
      if (result.warnings.length > 0) {
        alert(`Imported with notes:\n\n${result.warnings.join("\n")}`);
      }
    } catch (err: any) {
      alert(`Import failed: ${err?.message ?? err}`);
    } finally {
      setIsLoading(false);
      setProgress(null);
    }
  };

  /** PostGIS layer import — same reset-document path as file imports. */
  const handlePostgisImport = async (
    points: SurveyPoint[],
    layerName: string,
    srid: number,
    notes: string[],
  ) => {
    const WORKING_EPSG = 21037;
    let pts = points;
    const warnings = [...notes];
    if (srid && srid !== WORKING_EPSG && pts.length > 0) {
      setIsLoading(true);
      setProgress({ pct: 20, stage: "Reprojecting PostGIS layer" });
      try {
        const def = getCRS(srid);
        if (def) registerCrsDefinition(def, false);
        pts = pts.map((p) => {
          const [e, n] = transform(srid, WORKING_EPSG, p.easting, p.northing);
          return { ...p, easting: Number(e.toFixed(4)), northing: Number(n.toFixed(4)) };
        });
        warnings.push(`Reprojected ${pts.length} vertices from EPSG:${srid} to the working CRS.`);
      } finally {
        setIsLoading(false);
        setProgress(null);
      }
    }
    const metadata = {
      id: "PG-01",
      title: layerName,
      locality: "PostGIS source",
      country: "—",
      crs: "Arc 1960 / UTM zone 37S",
      surveyorName: "PostGIS bridge (read-only)",
      registrationNo: `SRID-${srid || "NA"}`,
      date: new Date().toISOString().split("T")[0],
      scale: "1:1,000",
      organization: "MetaRDU GIS Workstation",
    };
    await executePipeline(
      { ...(selectedScenario as BenchmarkScenario), metadata, points: [] },
      pts,
      "reset",
      `PostGIS import: ${layerName}`,
    );
    if (warnings.length > 0) {
      alert(`PostGIS import notes:\n\n${warnings.join("\n")}`);
    }
  };

  const handleCursorReadout = useCallback((c: CursorReadout | null) => setCursor(c), []);
  const handleScaleChange = useCallback((s: number) => setScaleDenominator(s), []);

  if (!pipelineResult) {
    return (
      <div className="w-screen h-screen bg-app flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <span className="ui-label">{progress ? `${progress.stage}…` : "Initializing workspace"}</span>
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
        onImportFiles={handleImportFiles}
        onUndo={doc.undo}
        onRedo={doc.redo}
        canUndo={doc.canUndo}
        canRedo={doc.canRedo}
        undoLabel={doc.undoLabel}
        redoLabel={doc.redoLabel}
      />

      {/* Workspace */}
      <main className="flex-1 min-h-0 relative overflow-hidden">
        {isLoading && progress && (
          <div
            className="absolute inset-x-0 top-0 z-50 flex items-center gap-2 bg-panel border-b border-line px-3 h-6"
            title={`Pipeline stage ${progress.pct}%`}
          >
            <div className="flex-1 h-1 bg-line rounded-full overflow-hidden">
              <div
                className="h-full bg-accent transition-all duration-200"
                style={{ width: `${Math.max(progress.pct, 4)}%` }}
              />
            </div>
            <span className="text-[10px] text-ink-2 tnum whitespace-nowrap">
              {progress.pct}% — {progress.stage}
            </span>
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
              doc.push(
                pipelineResult ? { ...pipelineResult, suitability: newCells } : pipelineResult,
                "Recompute suitability (MCDA)"
              )
            }
          />
        )}
        {activeTab === "hazards" && <HazardAuditPanel result={pipelineResult} />}
        {activeTab === "energy" && (
          <EnergyPlanningPanel
            result={pipelineResult}
            onUpdateClusters={(newClusters) =>
              doc.push(
                pipelineResult ? { ...pipelineResult, energyClusters: newClusters } : pipelineResult,
                "Re-plan electrification"
              )
            }
          />
        )}
        {activeTab === "deedplan" && <DeedPlanViewer result={pipelineResult} />}
        {activeTab === "atlas" && <PlanningAtlasViewer result={pipelineResult} />}
        {activeTab === "composer" && <ComposerPanel result={pipelineResult} />}
        {activeTab === "postgis" && (
          <PostgisPanel onImportPoints={handlePostgisImport} />
        )}
        {activeTab === "provenance" && <ProvenancePanel result={pipelineResult} />}
        {activeTab === "traverse" && (
          <TraversePanel
            result={pipelineResult}
            onApplyPoints={(pts) => executePipeline(selectedScenario, pts, "push", "Apply adjusted traverse")}
          />
        )}
        {activeTab === "scenarios" && (
          <ScenarioComparePanel result={pipelineResult} activeWeights={DEFAULT_MCDA_WEIGHTS} />
        )}
        {activeTab === "sync" && (
          <SyncPanel
            result={pipelineResult}
            onApplyProject={(proj) =>
              executePipeline(
                { ...(selectedScenario as BenchmarkScenario), metadata: proj.metadata, points: [] },
                proj.points,
                "push",
                `Edge sync merge: ${proj.projectName}`,
              )
            }
          />
        )}
        {activeTab === "datagrid" && (
          <AttributeTable
            result={pipelineResult}
            selectedPointIds={selectedPointIds}
            onSelectPoints={setSelectedPointIds}
            onUploadCustomSurvey={handleUploadCustomSurvey}
            onUpdatePoints={(pts) => executePipeline(selectedScenario, pts, "push", "Edit survey points")}
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
        geoidStatus={geoidStatus}
      />

      {/* Export hub */}
      {isExportOpen && (
        <ExportHubModal result={pipelineResult} onClose={() => setIsExportOpen(false)} />
      )}
    </div>
  );
};
