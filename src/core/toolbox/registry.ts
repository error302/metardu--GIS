/**
 * GIS Geoprocessing Toolbox Registry (QGIS Processing / ArcGIS Geoprocessing Parity)
 * Composable, extensible spatial tool architecture.
 */

import {
  SurveyPoint,
  PipelineResult,
  CorridorBuffer,
  TinMesh,
  ContourLine,
  SuitabilityCell,
  EnergyCluster,
  OffGridPlannerParams,
  McdaWeights,
} from "../../types/spatial";
import { generateCorridorBuffers } from "../buffer-engine";
import { generateTinMesh } from "../tin-engine";
import { generateContours } from "../contour-engine";
import { evaluateSuitabilityGrid, DEFAULT_MCDA_WEIGHTS } from "../mcda-suitability";
import { modelEnergyClusters, DEFAULT_OFFGRID_PARAMS } from "../energy-catchment";
import { adjustTraverseBowditch } from "../traverse-adjust";
import { auditTopologyDefects, repairTopology } from "../topology";

export type ToolCategory =
  | "Vector Geometry"
  | "Surface & Terrain"
  | "Spatial Analysis"
  | "Cadastral & COGO"
  | "Electrification & Planning";

export interface ToolParamDef {
  name: string;
  label: string;
  type: "number" | "string" | "boolean" | "select";
  defaultValue: any;
  options?: { label: string; value: any }[];
  description: string;
}

export interface ToolExecutionResult {
  toolId: string;
  toolName: string;
  durationMs: number;
  message: string;
  outputLayer?: {
    name: string;
    type: "points" | "buffers" | "tin" | "contours" | "suitability" | "clusters";
    data: any;
  };
  metrics?: Record<string, string | number>;
}

export interface GeoprocessingTool {
  id: string;
  name: string;
  category: ToolCategory;
  description: string;
  iconName: string;
  params: ToolParamDef[];
  run: (pipeline: PipelineResult, paramValues: Record<string, any>) => Promise<ToolExecutionResult>;
}

export const TOOLBOX_REGISTRY: GeoprocessingTool[] = [
  // ── 1. Corridor Buffer ──
  {
    id: "buffer-corridor",
    name: "Corridor & Setback Buffer",
    category: "Vector Geometry",
    description: "Generates offset statutory setback corridors around road centerlines and river drainage channels.",
    iconName: "Shield",
    params: [
      {
        name: "roadWidthM",
        label: "Road Reserve Buffer Width (m)",
        type: "number",
        defaultValue: 15.0,
        description: "Total width of statutory road reserve (e.g. 15m for access, 30m for highway).",
      },
      {
        name: "riparianWidthM",
        label: "Riparian Protection Buffer Width (m)",
        type: "number",
        defaultValue: 30.0,
        description: "Statutory environmental riparian buffer width (typically 30m).",
      },
    ],
    run: async (pipeline, params) => {
      const t0 = performance.now();
      const roadW = Number(params.roadWidthM) || 15.0;
      const ripW = Number(params.riparianWidthM) || 30.0;
      const buffers = generateCorridorBuffers(pipeline.vectors, pipeline.points, roadW, ripW);
      const durationMs = Number((performance.now() - t0).toFixed(1));

      return {
        toolId: "buffer-corridor",
        toolName: "Corridor & Setback Buffer",
        durationMs,
        message: `Generated ${buffers.length} buffer zones with ${roadW}m road and ${ripW}m riparian setbacks.`,
        outputLayer: {
          name: `Buffers_${roadW}m_${ripW}m`,
          type: "buffers",
          data: buffers,
        },
        metrics: {
          "Total Buffers": buffers.length,
          "Road Corridor": `${roadW} m`,
          "Riparian Corridor": `${ripW} m`,
        },
      };
    },
  },

  // ── 2. Topographic Contour Generator ──
  {
    id: "contour-generator",
    name: "Topographic Contour Interpolator",
    category: "Surface & Terrain",
    description: "Derives continuous contour curves and index intervals from Delaunay triangulated mesh surface.",
    iconName: "Activity",
    params: [
      {
        name: "intervalM",
        label: "Contour Interval (m)",
        type: "number",
        defaultValue: 1.0,
        options: [
          { label: "0.5 Meter (Fine Detail)", value: 0.5 },
          { label: "1.0 Meter (Standard Topo)", value: 1.0 },
          { label: "2.0 Meter (Intermediate)", value: 2.0 },
          { label: "5.0 Meter (Macro Terrain)", value: 5.0 },
        ],
        description: "Vertical spacing between successive contour elevations.",
      },
      {
        name: "indexMultiplier",
        label: "Index Contour Step",
        type: "number",
        defaultValue: 5,
        description: "Every Nth contour is rendered as an accentuated index line.",
      },
    ],
    run: async (pipeline, params) => {
      const t0 = performance.now();
      const interval = Number(params.intervalM) || 1.0;
      const indexStep = Number(params.indexMultiplier) || 5;

      const mesh = pipeline.tin && pipeline.tin.triangles.length > 0
        ? pipeline.tin
        : generateTinMesh(pipeline.points);

      const contours = generateContours(mesh, interval, indexStep);
      const durationMs = Number((performance.now() - t0).toFixed(1));

      return {
        toolId: "contour-generator",
        toolName: "Topographic Contour Interpolator",
        durationMs,
        message: `Extracted ${contours.length} contour polylines at ${interval}m vertical interval.`,
        outputLayer: {
          name: `Contours_${interval}m`,
          type: "contours",
          data: contours,
        },
        metrics: {
          "Total Segments": contours.length,
          "Interval": `${interval} m`,
          "Index Multiplier": `${indexStep}x`,
        },
      };
    },
  },

  // ── 3. Delaunay TIN Surface Mesh ──
  {
    id: "tin-generator",
    name: "Delaunay TIN Mesh Constructor",
    category: "Surface & Terrain",
    description: "Constructs 2.5D Triangulated Irregular Network (TIN) surface optimizing triangle equiangularity.",
    iconName: "Box",
    params: [],
    run: async (pipeline) => {
      const t0 = performance.now();
      const tin = generateTinMesh(pipeline.points);
      const durationMs = Number((performance.now() - t0).toFixed(1));

      return {
        toolId: "tin-generator",
        toolName: "Delaunay TIN Mesh Constructor",
        durationMs,
        message: `Synthesized ${tin.triangles.length} triangular facets from ${tin.vertices.length} spot levels.`,
        outputLayer: {
          name: "Delaunay_TIN_Surface",
          type: "tin",
          data: tin,
        },
        metrics: {
          "Triangles": tin.triangles.length,
          "Vertices": tin.vertices.length,
        },
      };
    },
  },

  // ── 4. Settlement Suitability (MCDA) ──
  {
    id: "mcda-suitability-tool",
    name: "Settlement Suitability Modeler (MCDA)",
    category: "Spatial Analysis",
    description: "Evaluates multi-criteria spatial raster using slope, road proximity, water setbacks, and hazard exclusions.",
    iconName: "Sliders",
    params: [
      {
        name: "maxSlope",
        label: "Maximum Buildable Slope (%)",
        type: "number",
        defaultValue: 25.0,
        description: "Slopes exceeding this threshold are categorized as steep/unbuildable.",
      },
      {
        name: "gridResolutionM",
        label: "Grid Cell Resolution (m)",
        type: "number",
        defaultValue: 20.0,
        description: "Raster resolution of suitability evaluation grid.",
      },
    ],
    run: async (pipeline, params) => {
      const t0 = performance.now();
      const maxSlope = Number(params.maxSlope) || 25.0;
      const resM = Number(params.gridResolutionM) || 20.0;

      const weights: McdaWeights = {
        ...DEFAULT_MCDA_WEIGHTS,
        maxSlopeAllowed: maxSlope,
      };

      const cells = evaluateSuitabilityGrid(
        pipeline.tin,
        pipeline.vectors,
        weights,
        resM
      );
      const durationMs = Number((performance.now() - t0).toFixed(1));

      return {
        toolId: "mcda-suitability-tool",
        toolName: "Settlement Suitability Modeler (MCDA)",
        durationMs,
        message: `Evaluated ${cells.length} suitability cells with ${maxSlope}% slope constraint.`,
        outputLayer: {
          name: `Suitability_MaxSlope_${maxSlope}`,
          type: "suitability",
          data: cells,
        },
        metrics: {
          "Total Cells": cells.length,
          "Optimal Cells": cells.filter((c) => c.category === "optimal").length,
          "Restricted Cells": cells.filter((c) => c.category === "restricted" || c.category === "hazard").length,
        },
      };
    },
  },

  // ── 5. Off-Grid Electrification Sizing ──
  {
    id: "offgrid-planner-tool",
    name: "Off-Grid Techno-Economic Sizer",
    category: "Electrification & Planning",
    description: "Parametric energy catchment clustering: sizes Solar PV kWp, Battery kWh storage, and CAPEX estimates.",
    iconName: "Zap",
    params: [
      {
        name: "costPerKwp",
        label: "Solar PV Cost ($/kWp)",
        type: "number",
        defaultValue: 1100,
        description: "Turnkey installed CAPEX cost per kilowatt-peak of solar array.",
      },
      {
        name: "costPerKwhBattery",
        label: "Battery Storage Cost ($/kWh)",
        type: "number",
        defaultValue: 350,
        description: "LiFePO4/Lithium battery storage cost per kilowatt-hour.",
      },
      {
        name: "demandKwhPerHH",
        label: "Daily Household Demand (kWh/day)",
        type: "number",
        defaultValue: 1.4,
        description: "Tier 2 / Tier 3 daily electricity consumption per household.",
      },
      {
        name: "gridThresholdKm",
        label: "Grid Extension Threshold (km)",
        type: "number",
        defaultValue: 1.5,
        description: "Beyond this distance from MV line, off-grid solutions become least-cost.",
      },
    ],
    run: async (pipeline, params) => {
      const t0 = performance.now();
      const offgridParams: OffGridPlannerParams = {
        costPerKwSolar: Number(params.costPerKwp) || 1100,
        costPerKwhBattery: Number(params.costPerKwhBattery) || 350,
        demandPerHhKwh: Number(params.demandKwhPerHH) || 1.4,
        gridThresholdKm: Number(params.gridThresholdKm) || 1.5,
        peakSunHours: 5.0,
        batteryAutonomyDays: 1.5,
        minMiniGridHh: 40,
      };

      const clusters = modelEnergyClusters(pipeline.points, pipeline.vectors, offgridParams);
      const durationMs = Number((performance.now() - t0).toFixed(1));

      const totalCapex = clusters.reduce((s, c) => s + c.capexEstimateUsd, 0);

      return {
        toolId: "offgrid-planner-tool",
        toolName: "Off-Grid Techno-Economic Sizer",
        durationMs,
        message: `Modeled ${clusters.length} electrification clusters with total CAPEX $${totalCapex.toLocaleString()}.`,
        outputLayer: {
          name: "Electrification_Clusters",
          type: "clusters",
          data: clusters,
        },
        metrics: {
          "Total Clusters": clusters.length,
          "Total Estimated CAPEX": `$${totalCapex.toLocaleString()}`,
          "Solar PV Capacity": `${clusters.reduce((s, c) => s + c.recommendedSolarKw, 0).toFixed(1)} kWp`,
        },
      };
    },
  },

  // ── 6. Topology Defect Auditor & Repair ──
  {
    id: "topology-audit-tool",
    name: "Cadastral Topology Auditor & Repair",
    category: "Cadastral & COGO",
    description: "Detects duplicate beacons within snapping tolerance, unclosed loops, and automatically snaps vertices.",
    iconName: "CheckCircle",
    params: [
      {
        name: "snappingToleranceM",
        label: "Snapping Distance Tolerance (m)",
        type: "number",
        defaultValue: 0.05,
        description: "Points closer than this threshold are treated as duplicates and snapped together.",
      },
    ],
    run: async (pipeline, params) => {
      const t0 = performance.now();
      const tol = Number(params.snappingToleranceM) || 0.05;

      const audit = auditTopologyDefects(pipeline.points, tol);
      const repaired = repairTopology(pipeline.points, tol);
      const durationMs = Number((performance.now() - t0).toFixed(1));

      return {
        toolId: "topology-audit-tool",
        toolName: "Cadastral Topology Auditor & Repair",
        durationMs,
        message: `Audited topology: ${audit.defects.length} defects flagged. Repaired dataset to ${repaired.length} vertices.`,
        outputLayer: {
          name: "Repaired_Boundary_Vertices",
          type: "points",
          data: repaired,
        },
        metrics: {
          "Defects Detected": audit.defects.length,
          "Original Vertices": pipeline.points.length,
          "Repaired Vertices": repaired.length,
        },
      };
    },
  },

  // ── 7. Bowditch Traverse Adjustment ──
  {
    id: "bowditch-traverse-tool",
    name: "Bowditch Traverse Adjustment",
    category: "Cadastral & COGO",
    description: "Computes polygon closure misclosure and applies Compass Rule mathematical coordinate adjustment.",
    iconName: "Compass",
    params: [
      {
        name: "toleranceRatio",
        label: "Minimum Cadastral Ratio (1:N)",
        type: "number",
        defaultValue: 10000,
        options: [
          { label: "1:10,000 (Class A Urban Cadastre)", value: 10000 },
          { label: "1:5,000 (Class B Rural Cadastre)", value: 5000 },
          { label: "1:2,500 (Topographic Control)", value: 2500 },
        ],
        description: "Statutory relative precision threshold required for approval.",
      },
    ],
    run: async (pipeline, params) => {
      const t0 = performance.now();
      const tol = Number(params.toleranceRatio) || 10000;
      const bndPoints = pipeline.points.filter((p) => p.category === "boundary");

      if (bndPoints.length < 3) {
        throw new Error("Traverse adjustment requires at least 3 boundary beacons.");
      }

      const report = adjustTraverseBowditch(bndPoints, tol);
      const durationMs = Number((performance.now() - t0).toFixed(1));

      return {
        toolId: "bowditch-traverse-tool",
        toolName: "Bowditch Traverse Adjustment",
        durationMs,
        message: `Traverse evaluated: Misclosure ${report.linearMisclosureM}m, Precision ${report.precisionFraction} (${report.status}).`,
        metrics: {
          "Perimeter": `${report.totalPerimeterM} m`,
          "Linear Misclosure": `${report.linearMisclosureM} m`,
          "Precision Ratio": report.precisionFraction,
          "Statutory Status": report.status,
        },
      };
    },
  },
];
