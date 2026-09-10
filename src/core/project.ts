/**
 * MetaRDU GIS Project File (.metardu.json) Engine
 * QGIS .qgz / ArcGIS Pro .aprx parity for project persistence.
 * Saves and restores complete workspace state: metadata, CRS, points, attributes,
 * layers, symbology, off-grid parameters, and MCDA weights.
 */

import {
  PipelineResult,
  SurveyPoint,
  ProjectMetadata,
  OffGridPlannerParams,
  McdaWeights,
} from "../types/spatial";
import { LayerItem, DEFAULT_LAYERS } from "./layer-store";
import { DEFAULT_OFFGRID_PARAMS } from "./energy-catchment";
import { DEFAULT_MCDA_WEIGHTS } from "./mcda-suitability";
import { ProvenanceGraph } from "./provenance";

export interface MetarduProject {
  format: "METARDU_GIS_PROJECT";
  version: "1.0.0";
  savedAt: string;
  projectName: string;
  crs: string;
  metadata: ProjectMetadata;
  points: SurveyPoint[];
  layers: LayerItem[];
  offGridParams: OffGridPlannerParams;
  mcdaWeights: McdaWeights;
  /** Optional machine-readable provenance graph (Phase D) — survives save/load. */
  provenance?: ProvenanceGraph;
}

/**
 * Creates a complete project snapshot from active workspace state
 */
export function createProjectSnapshot(
  result: PipelineResult,
  layers: LayerItem[] = DEFAULT_LAYERS,
  offGridParams: OffGridPlannerParams = DEFAULT_OFFGRID_PARAMS,
  mcdaWeights: McdaWeights = DEFAULT_MCDA_WEIGHTS,
  provenance?: ProvenanceGraph
): MetarduProject {
  return {
    format: "METARDU_GIS_PROJECT",
    version: "1.0.0",
    savedAt: new Date().toISOString(),
    projectName: result.metadata.title || "Untitled Project",
    crs: result.metadata.crs,
    metadata: { ...result.metadata },
    points: [...result.points],
    layers: [...layers],
    offGridParams: { ...offGridParams },
    mcdaWeights: { ...mcdaWeights },
    provenance,
  };
}

/**
 * Downloads project file to local disk (.metardu.json)
 */
export function downloadProjectFile(project: MetarduProject): void {
  const json = JSON.stringify(project, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const filename = `${project.projectName.replace(/[^a-zA-Z0-9_-]/g, "_")}.metardu.json`;
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Parses and validates an uploaded .metardu.json file
 */
export function parseProjectFile(jsonStr: string): MetarduProject {
  const parsed = JSON.parse(jsonStr);

  if (parsed.format !== "METARDU_GIS_PROJECT" && !parsed.points) {
    throw new Error("Invalid project file format: missing METARDU_GIS_PROJECT signature.");
  }

  return {
    format: "METARDU_GIS_PROJECT",
    version: parsed.version || "1.0.0",
    savedAt: parsed.savedAt || new Date().toISOString(),
    projectName: parsed.projectName || parsed.metadata?.title || "Imported Project",
    crs: parsed.crs || parsed.metadata?.crs || "Arc 1960 / UTM zone 37S",
    metadata: parsed.metadata || {
      id: "PROJ-IMP-01",
      title: parsed.projectName || "Imported Project",
      locality: "Site Locality",
      country: "East Africa",
      crs: parsed.crs || "Arc 1960 / UTM zone 37S",
      surveyorName: "Survey Specialist",
      registrationNo: "MISK-IMP-01",
      date: new Date().toISOString().split("T")[0],
      scale: "1:2,500",
      organization: "MetaRDU GIS Workstation",
    },
    points: parsed.points || [],
    layers: parsed.layers || DEFAULT_LAYERS,
    offGridParams: parsed.offGridParams || DEFAULT_OFFGRID_PARAMS,
    mcdaWeights: parsed.mcdaWeights || DEFAULT_MCDA_WEIGHTS,
    provenance:
      parsed.provenance && parsed.provenance.format === "METARDU_PROVENANCE"
        ? parsed.provenance
        : undefined,
  };
}
