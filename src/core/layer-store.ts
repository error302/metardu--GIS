/**
 * GIS Layer Management Store & Configuration
 * Provides QGIS/ArcGIS Pro style layer hierarchy, z-ordering, visibility, opacity, and custom symbology.
 */

import { LayerSymbology } from "./symbology";

export interface LayerItem {
  id: string;
  name: string;
  category: "cadastre" | "infrastructure" | "surface" | "analysis" | "environment";
  visible: boolean;
  opacity: number; // 0.0 to 1.0
  zIndex: number;
  symbology: LayerSymbology;
  description?: string;
}

export const DEFAULT_LAYERS: LayerItem[] = [
  {
    id: "boundary",
    name: "Cadastral Boundary",
    category: "cadastre",
    visible: true,
    opacity: 1.0,
    zIndex: 90,
    symbology: {
      type: "single",
      defaultStyle: {
        color: "#EF4444",
        strokeColor: "#EF4444",
        strokeWidth: 2.2,
        fillColor: "#EF4444",
        fillOpacity: 0.08,
      },
    },
    description: "Statutory boundary polygon and title deed perimeter.",
  },
  {
    id: "beacons",
    name: "Survey Beacons & Stations",
    category: "cadastre",
    visible: true,
    opacity: 1.0,
    zIndex: 100,
    symbology: {
      type: "categorized",
      field: "category",
      defaultStyle: {
        color: "#3B82F6",
        pointRadius: 4,
        strokeColor: "#FFFFFF",
        strokeWidth: 1,
      },
      categorizedRules: [
        { value: "boundary", label: "Boundary Beacon", style: { color: "#EF4444", pointRadius: 5, strokeColor: "#FFFFFF", strokeWidth: 1.5 } },
        { value: "control", label: "Control Monument", style: { color: "#8B5CF6", pointRadius: 6, strokeColor: "#FFFFFF", strokeWidth: 1.5 } },
        { value: "road", label: "Road Centerline", style: { color: "#F59E0B", pointRadius: 3, strokeColor: "#FFFFFF", strokeWidth: 1 } },
        { value: "water", label: "River / Riparian", style: { color: "#06B6D4", pointRadius: 3, strokeColor: "#FFFFFF", strokeWidth: 1 } },
        { value: "energy", label: "Solar / Microgrid", style: { color: "#10B981", pointRadius: 5, strokeColor: "#FFFFFF", strokeWidth: 1.5 } },
      ],
    },
    description: "Physical boundary monuments, control points, and spot elevations.",
  },
  {
    id: "bearings",
    name: "Bearing & Distance Annotations",
    category: "cadastre",
    visible: true,
    opacity: 1.0,
    zIndex: 95,
    symbology: {
      type: "single",
      defaultStyle: { color: "#FDE047", strokeColor: "#FDE047", strokeWidth: 1 },
    },
    description: "COGO traverse bearings (DD°MM'SS\") and horizontal ground distances.",
  },
  {
    id: "roads",
    name: "Road Network & Access Ways",
    category: "infrastructure",
    visible: true,
    opacity: 1.0,
    zIndex: 60,
    symbology: {
      type: "single",
      defaultStyle: { color: "#F59E0B", strokeColor: "#F59E0B", strokeWidth: 2, strokeDash: [6, 3] },
    },
    description: "Access corridors, feeder roads, and transport spines.",
  },
  {
    id: "roadBuffer",
    name: "Road Wayleave Setbacks (15m)",
    category: "infrastructure",
    visible: true,
    opacity: 0.6,
    zIndex: 40,
    symbology: {
      type: "single",
      defaultStyle: { color: "#F59E0B", fillColor: "#F59E0B", fillOpacity: 0.15, strokeColor: "#F59E0B", strokeWidth: 1, strokeDash: [4, 4] },
    },
    description: "Statutory highway and road reserve reservations.",
  },
  {
    id: "rivers",
    name: "Hydrology & River Centerlines",
    category: "environment",
    visible: true,
    opacity: 1.0,
    zIndex: 65,
    symbology: {
      type: "single",
      defaultStyle: { color: "#06B6D4", strokeColor: "#06B6D4", strokeWidth: 2 },
    },
    description: "Natural watercourses, drainage channels, and perennial rivers.",
  },
  {
    id: "riparianBuffer",
    name: "Riparian Protection Zone (30m)",
    category: "environment",
    visible: true,
    opacity: 0.6,
    zIndex: 45,
    symbology: {
      type: "single",
      defaultStyle: { color: "#06B6D4", fillColor: "#06B6D4", fillOpacity: 0.2, strokeColor: "#0891B2", strokeWidth: 1, strokeDash: [4, 4] },
    },
    description: "Environmental water body buffer prohibiting permanent structures.",
  },
  {
    id: "contours",
    name: "Topographic Contours",
    category: "surface",
    visible: true,
    opacity: 0.85,
    zIndex: 30,
    symbology: {
      type: "single",
      defaultStyle: { color: "#64748B", strokeColor: "#64748B", strokeWidth: 0.8 },
    },
    description: "Delaunay TIN-derived topographic index and intermediate contour lines.",
  },
  {
    id: "tin",
    name: "Triangulated Irregular Network (TIN)",
    category: "surface",
    visible: false,
    opacity: 0.5,
    zIndex: 20,
    symbology: {
      type: "single",
      defaultStyle: { color: "#475569", strokeColor: "#475569", strokeWidth: 0.5 },
    },
    description: "Continuous Delaunay triangulated 3D mesh surface.",
  },
  {
    id: "suitability",
    name: "Settlement Suitability Heatmap",
    category: "analysis",
    visible: false,
    opacity: 0.7,
    zIndex: 15,
    symbology: {
      type: "categorized",
      field: "category",
      defaultStyle: { color: "#10B981" },
      categorizedRules: [
        { value: "optimal", label: "Optimal (Green)", style: { color: "#059669", fillColor: "#059669", fillOpacity: 0.6 } },
        { value: "suitable", label: "Suitable (Emerald)", style: { color: "#10B981", fillColor: "#10B981", fillOpacity: 0.5 } },
        { value: "moderate", label: "Moderate (Amber)", style: { color: "#F59E0B", fillColor: "#F59E0B", fillOpacity: 0.5 } },
        { value: "restricted", label: "Restricted (Red)", style: { color: "#EF4444", fillColor: "#EF4444", fillOpacity: 0.6 } },
        { value: "hazard", label: "Hazard Sink (Dark Red)", style: { color: "#991B1B", fillColor: "#991B1B", fillOpacity: 0.7 } },
      ],
    },
    description: "Multi-Criteria Decision Analysis (MCDA) rasterized suitability grid.",
  },
  {
    id: "hazards",
    name: "Hazard Exposure Zones",
    category: "analysis",
    visible: true,
    opacity: 0.85,
    zIndex: 50,
    symbology: {
      type: "single",
      defaultStyle: { color: "#EF4444", fillColor: "#EF4444", fillOpacity: 0.25, strokeColor: "#DC2626", strokeWidth: 1.5 },
    },
    description: "Overlapping natural hazard sinks and high-vulnerability footprints.",
  },
  {
    id: "energy",
    name: "Electrification Clusters & Microgrids",
    category: "analysis",
    visible: true,
    opacity: 0.9,
    zIndex: 75,
    symbology: {
      type: "single",
      defaultStyle: { color: "#FACC15", strokeColor: "#FACC15", strokeWidth: 1.5, strokeDash: [4, 4] },
    },
    description: "DBSCAN spatial clusters with mini-grid vs solar home system designations.",
  },
];

/** Helper to reorder layers */
export function moveLayer(layers: LayerItem[], fromIndex: number, toIndex: number): LayerItem[] {
  if (fromIndex < 0 || fromIndex >= layers.length || toIndex < 0 || toIndex >= layers.length) {
    return layers;
  }
  const result = [...layers];
  const [removed] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, removed);
  // Re-assign zIndexes according to new order
  return result.map((l, idx) => ({
    ...l,
    zIndex: (result.length - idx) * 10,
  }));
}
