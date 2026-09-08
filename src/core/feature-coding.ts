/**
 * Automated Field-to-Finish Feature Coding Engine
 * Automatically classifies raw instrument codes into vector polylines, layers, and styled geometries.
 */

import { SurveyPoint, SurveyVector, FeatureCategory } from "../types/spatial";

export interface CodeRule {
  code: string;
  name: string;
  category: FeatureCategory;
  layer: string;
  color: string;
  isClosed: boolean;
  lineType: "solid" | "dashed" | "dotted" | "dashdot";
  lineWidth: number;
}

export const FEATURE_CODE_RULES: Record<string, CodeRule> = {
  // Boundary
  BL: { code: "BL", name: "Boundary Line", category: "boundary", layer: "CADASTRE-BOUNDARY", color: "#3B82F6", isClosed: true, lineType: "solid", lineWidth: 2 },
  PB: { code: "PB", name: "Property Beacon", category: "boundary", layer: "CADASTRE-BEACONS", color: "#60A5FA", isClosed: true, lineType: "solid", lineWidth: 2 },
  IB: { code: "IB", name: "Iron Beacon", category: "boundary", layer: "CADASTRE-BEACONS", color: "#2563EB", isClosed: true, lineType: "solid", lineWidth: 2 },
  MB: { code: "MB", name: "Mutation Boundary", category: "boundary", layer: "CADASTRE-MUTATION", color: "#818CF8", isClosed: true, lineType: "dashed", lineWidth: 2 },

  // Road & Transport
  "RD-CL": { code: "RD-CL", name: "Road Centerline", category: "road", layer: "INFRA-ROAD-CL", color: "#F59E0B", isClosed: false, lineType: "dashdot", lineWidth: 2 },
  "RD-E": { code: "RD-E", name: "Road Edge", category: "road", layer: "INFRA-ROAD-EDGE", color: "#D97706", isClosed: false, lineType: "solid", lineWidth: 1.5 },
  TRK: { code: "TRK", name: "Access Track", category: "road", layer: "INFRA-TRACK", color: "#B45309", isClosed: false, lineType: "dashed", lineWidth: 1 },

  // Buildings & Structures
  BLD: { code: "BLD", name: "Building Footprint", category: "building", layer: "STRUCTURES-BLD", color: "#EF4444", isClosed: true, lineType: "solid", lineWidth: 1.5 },
  FN: { code: "FN", name: "Perimeter Fence", category: "building", layer: "STRUCTURES-FENCE", color: "#F87171", isClosed: false, lineType: "dashed", lineWidth: 1 },
  WALL: { code: "WALL", name: "Masonry Wall", category: "building", layer: "STRUCTURES-WALL", color: "#DC2626", isClosed: false, lineType: "solid", lineWidth: 2 },

  // Hydrology / Water
  RIV: { code: "RIV", name: "River Centerline", category: "water", layer: "HYDRO-RIVER", color: "#06B6D4", isClosed: false, lineType: "solid", lineWidth: 2.5 },
  STR: { code: "STR", name: "Stream / Drainage", category: "water", layer: "HYDRO-STREAM", color: "#22D3EE", isClosed: false, lineType: "dashed", lineWidth: 1.5 },
  CANAL: { code: "CANAL", name: "Irrigation Canal", category: "water", layer: "HYDRO-CANAL", color: "#0891B2", isClosed: false, lineType: "solid", lineWidth: 1.5 },

  // Utilities
  PWR: { code: "PWR", name: "Power Transmission Line", category: "utility", layer: "UTIL-POWER", color: "#EAB308", isClosed: false, lineType: "dashdot", lineWidth: 1.5 },
  POLE: { code: "POLE", name: "Utility Pole", category: "utility", layer: "UTIL-POLES", color: "#CA8A04", isClosed: false, lineType: "solid", lineWidth: 1 },
  PIPE: { code: "PIPE", name: "Water Pipeline", category: "utility", layer: "UTIL-PIPELINE", color: "#0284C7", isClosed: false, lineType: "dashed", lineWidth: 1.5 },

  // Settlements & Social Infrastructure (UN-Habitat / Sun King)
  VILL: { code: "VILL", name: "Settlement Cluster", category: "settlement", layer: "UN-SETTLEMENTS", color: "#10B981", isClosed: false, lineType: "solid", lineWidth: 1 },
  SCH: { code: "SCH", name: "School / Education", category: "settlement", layer: "UN-SOCIAL-INFRA", color: "#059669", isClosed: false, lineType: "solid", lineWidth: 2 },
  CLINIC: { code: "CLINIC", name: "Health Center / Clinic", category: "settlement", layer: "UN-HEALTHCARE", color: "#34D399", isClosed: false, lineType: "solid", lineWidth: 2 },
  WTR_PT: { code: "WTR_PT", name: "Community Water Point", category: "settlement", layer: "UN-WATER-ACCESS", color: "#0E7490", isClosed: false, lineType: "solid", lineWidth: 1.5 },

  // Energy
  SOLAR: { code: "SOLAR", name: "Solar Mini-Grid Site", category: "energy", layer: "ENERGY-SOLAR", color: "#FACC15", isClosed: true, lineType: "solid", lineWidth: 2 },
  GRID: { code: "GRID", name: "National Grid Interconnect", category: "energy", layer: "ENERGY-GRID", color: "#E11D48", isClosed: false, lineType: "solid", lineWidth: 2 },
};

/**
 * Automates vectorization of surveyed points by code and sequential string
 */
export function generateFeatureVectors(points: SurveyPoint[]): SurveyVector[] {
  const vectors: SurveyVector[] = [];
  const grouped: Record<string, SurveyPoint[]> = {};

  for (const pt of points) {
    const key = pt.rawCode.toUpperCase();
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(pt);
  }

  let vectorCounter = 1;

  for (const [code, pts] of Object.entries(grouped)) {
    if (pts.length < 2) continue;

    const rule = FEATURE_CODE_RULES[code] || {
      code,
      name: `${code} Vector`,
      category: pts[0].category,
      layer: `SURVEY-${code}`,
      color: "#94A3B8",
      isClosed: false,
      lineType: "solid",
      lineWidth: 1,
    };

    // If it's a closed feature (like BL or BLD), check if we need to close the loop
    const vectorPoints = [...pts];
    if (rule.isClosed && pts.length >= 3) {
      const first = pts[0];
      const last = pts[pts.length - 1];
      const dist = Math.hypot(first.easting - last.easting, first.northing - last.northing);
      // If end doesn't equal start within 0.05m, append start point to close
      if (dist > 0.05) {
        vectorPoints.push(first);
      }
    }

    vectors.push({
      id: `VEC-${vectorCounter++}-${code}`,
      code: rule.code,
      name: rule.name,
      category: rule.category,
      layer: rule.layer,
      points: vectorPoints,
      isClosed: rule.isClosed,
      color: rule.color,
      lineType: rule.lineType,
      lineWidth: rule.lineWidth,
    });
  }

  return vectors;
}