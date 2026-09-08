/**
 * Methodology Registry — Generic Science Catalog
 * Decouples methodology names from vendor brands.
 * Vendors (Sun King, UN-Habitat, VIIRS) are references/citations, not product identity.
 */

export interface MethodologyRef {
  id: string;
  genericName: string;
  referenceOrg: string; // citation only
  citation: string;
  methodology: string;
  docsUrl?: string;
}

export const METHODOLOGY_REGISTRY: Record<string, MethodologyRef> = {
  "settlement-suitability-mcda": {
    id: "settlement-suitability-mcda",
    genericName: "Settlement Suitability (MCDA)",
    referenceOrg: "UN-Habitat / FAO Land Evaluation",
    citation: "Weighted overlay: slope + road proximity + riparian buffer + infrastructure access. Inspired by UN-Habitat Planning Sustainable Cities & FAO land suitability frameworks.",
    methodology: "MCDA weighted linear combination with hard constraints",
  },
  "offgrid-electrification": {
    id: "offgrid-electrification",
    genericName: "Off-Grid Electrification Planner",
    referenceOrg: "SE4All / World Bank ESMAP",
    citation: "Settlement clustering + distance-to-grid + demand/GHI sizing for Mini-Grid vs SHS vs Grid Extension. Methodology refs: SE4All Global Electrification Platform, WB ESMAP.",
    methodology: "Density clustering (250m) + techno-economic threshold classification",
  },
  "hazard-exposure": {
    id: "hazard-exposure",
    genericName: "Hazard & Flood Exposure Audit",
    referenceOrg: "UNDRR / Open Methodology",
    citation: "Depression sink detection from TIN + asset exposure radius. Generic hydrologic screening, not a forecast.",
    methodology: "Local minima sinks + radial exposure audit",
  },
  "night-lights-overlay": {
    id: "night-lights-overlay",
    genericName: "Night Lights Overlay",
    referenceOrg: "NASA Black Marble (VIIRS)",
    citation: "Nocturnal luminosity as proxy for electrification. For planning context — simulated in offline mode.",
    methodology: "VIIRS-inspired dark-gap visualization",
  },
  "tin-contouring": {
    id: "tin-contouring",
    genericName: "3D Surface Triangulation & Contouring",
    referenceOrg: "Standard Computational Geometry",
    citation: "Bowyer-Watson Delaunay + Marching isolines",
    methodology: "Delaunay TIN, slope/aspect, cut/fill, contouring",
  },
};

export function getMethodology(id: string): MethodologyRef | undefined {
  return METHODOLOGY_REGISTRY[id];
}
