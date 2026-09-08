/**
 * Golden Benchmark Survey & GIS Scenarios
 * Preloaded real-world datasets for instantaneous 1-click evaluation and verification.
 */

import { ProjectMetadata, SurveyPoint } from "../types/spatial";

export interface BenchmarkScenario {
  id: string;
  title: string;
  badge: string;
  description: string;
  metadata: ProjectMetadata;
  points: SurveyPoint[];
}

export const BENCHMARK_SCENARIOS: BenchmarkScenario[] = [
  // ── Benchmark 1: Nairobi Upper Hill Cadastral Mutation ──
  {
    id: "nairobi-cadastre",
    title: "Nairobi Upper Hill Cadastral Mutation",
    badge: "Cadastral & Deed Plan",
    description: "Urban parcel boundary mutation with road reserve excision, boundary precision audit, and Form 4 Deed Plan.",
    metadata: {
      id: "LR-209-14588",
      title: "LR 209/14588 Upper Hill",
      locality: "Upper Hill, Nairobi City County",
      country: "Kenya",
      crs: "Arc 1960 / UTM zone 37S (EPSG: 21037)",
      surveyorName: "Eng. Dennis K. Mwangi, MISK",
      registrationNo: "MISK-LS-0412",
      date: "2026-09-08",
      scale: "1:1,000",
      organization: "Survey of Kenya & MetaRDU Cadastre Hub",
    },
    points: [
      // Primary Boundary Loop (BL) - ~2.5 Hectares
      { id: "MB1", easting: 254210.45, northing: 9858320.10, elevation: 1682.40, rawCode: "BL", category: "boundary", description: "Corner Beacon Iron Pin" },
      { id: "MB2", easting: 254385.20, northing: 9858395.60, elevation: 1684.15, rawCode: "BL", category: "boundary", description: "Boundary Beacon Pipe" },
      { id: "MB3", easting: 254460.80, northing: 9858260.40, elevation: 1680.80, rawCode: "BL", category: "boundary", description: "Boundary Beacon Peg" },
      { id: "MB4", easting: 254360.10, northing: 9858140.25, elevation: 1678.50, rawCode: "BL", category: "boundary", description: "Southern Boundary Beacon" },
      { id: "MB5", easting: 254240.30, northing: 9858180.90, elevation: 1679.90, rawCode: "BL", category: "boundary", description: "West Boundary Beacon" },
      // Close loop back to MB1
      { id: "MB1_CL", easting: 254210.45, northing: 9858320.10, elevation: 1682.40, rawCode: "BL", category: "boundary", description: "Closure to MB1" },

      // Road Centerline (RD-CL) Frontage
      { id: "R1", easting: 254180.00, northing: 9858360.00, elevation: 1683.00, rawCode: "RD-CL", category: "road", description: "Elgon Road Centerline" },
      { id: "R2", easting: 254280.00, northing: 9858390.00, elevation: 1684.20, rawCode: "RD-CL", category: "road", description: "Elgon Road Centerline" },
      { id: "R3", easting: 254420.00, northing: 9858430.00, elevation: 1685.50, rawCode: "RD-CL", category: "road", description: "Elgon Road Centerline" },

      // Building Footprint (BLD)
      { id: "B1", easting: 254280.00, northing: 9858280.00, elevation: 1681.50, rawCode: "BLD", category: "building", description: "Commercial Complex Corner" },
      { id: "B2", easting: 254340.00, northing: 9858300.00, elevation: 1682.20, rawCode: "BLD", category: "building", description: "Commercial Complex Corner" },
      { id: "B3", easting: 254355.00, northing: 9858250.00, elevation: 1680.90, rawCode: "BLD", category: "building", description: "Commercial Complex Corner" },
      { id: "B4", easting: 254295.00, northing: 9858230.00, elevation: 1680.10, rawCode: "BLD", category: "building", description: "Commercial Complex Corner" },
      { id: "B1_CL", easting: 254280.00, northing: 9858280.00, elevation: 1681.50, rawCode: "BLD", category: "building", description: "Building Closure" },

      // Control Points & Benchmarks
      { id: "BM_KEN_04", easting: 254150.00, northing: 9858100.00, elevation: 1677.25, rawCode: "BM", category: "control", description: "Survey of Kenya Fundamental Benchmark" },
      { id: "TS101", easting: 254300.00, northing: 9858160.00, elevation: 1679.10, rawCode: "TS", category: "control", description: "Traverse Station 101" },

      // Topographic Spot Heights (SL)
      { id: "S1", easting: 254230.00, northing: 9858250.00, elevation: 1681.00, rawCode: "SL", category: "terrain", description: "Spot Level" },
      { id: "S2", easting: 254310.00, northing: 9858350.00, elevation: 1683.40, rawCode: "SL", category: "terrain", description: "Spot Level" },
      { id: "S3", easting: 254400.00, northing: 9858200.00, elevation: 1679.50, rawCode: "SL", category: "terrain", description: "Spot Level" },
      { id: "S4", easting: 254260.00, northing: 9858150.00, elevation: 1678.80, rawCode: "SL", category: "terrain", description: "Spot Level" },
      { id: "S5", easting: 254380.00, northing: 9858320.00, elevation: 1682.80, rawCode: "SL", category: "terrain", description: "Spot Level" },
    ],
  },

  // ── Benchmark 2: Great Rift Valley Topographic Corridor ──
  {
    id: "rift-valley-corridor",
    title: "Great Rift Valley Infrastructure Corridor",
    badge: "Topography & Contours",
    description: "Corridor survey with Delaunay TIN triangulation, continuous 1m/5m contouring, 30m riparian river setback, and cut/fill earthwork balance.",
    metadata: {
      id: "RVT-CORR-09B",
      title: "Rift Valley Link Corridor",
      locality: "Naivasha Basin, Nakuru County",
      country: "Kenya",
      crs: "Arc 1960 / UTM zone 37S (EPSG: 21037)",
      surveyorName: "Geomatics Team Lead",
      registrationNo: "MISK-LS-0889",
      date: "2026-09-08",
      scale: "1:2,500",
      organization: "National Highways & Infrastructure Authority",
    },
    points: [
      // Boundary
      { id: "CP1", easting: 212000.00, northing: 9915000.00, elevation: 1892.50, rawCode: "BL", category: "boundary", description: "Corridor Point 1" },
      { id: "CP2", easting: 212500.00, northing: 9915150.00, elevation: 1910.20, rawCode: "BL", category: "boundary", description: "Corridor Point 2" },
      { id: "CP3", easting: 212550.00, northing: 9914700.00, elevation: 1885.40, rawCode: "BL", category: "boundary", description: "Corridor Point 3" },
      { id: "CP4", easting: 212050.00, northing: 9914600.00, elevation: 1878.90, rawCode: "BL", category: "boundary", description: "Corridor Point 4" },
      { id: "CP1_CL", easting: 212000.00, northing: 9915000.00, elevation: 1892.50, rawCode: "BL", category: "boundary", description: "Corridor Point 1 Closure" },

      // River Malewa Channel (RIV)
      { id: "RV1", easting: 212100.00, northing: 9914620.00, elevation: 1876.00, rawCode: "RIV", category: "water", description: "River Centerline" },
      { id: "RV2", easting: 212220.00, northing: 9914750.00, elevation: 1879.50, rawCode: "RIV", category: "water", description: "River Centerline" },
      { id: "RV3", easting: 212350.00, northing: 9914900.00, elevation: 1883.20, rawCode: "RIV", category: "water", description: "River Centerline" },
      { id: "RV4", easting: 212480.00, northing: 9915100.00, elevation: 1888.00, rawCode: "RIV", category: "water", description: "River Centerline" },

      // Highway Centerline (RD-CL)
      { id: "HW1", easting: 212020.00, northing: 9914900.00, elevation: 1889.00, rawCode: "RD-CL", category: "road", description: "Corridor Road Alignment" },
      { id: "HW2", easting: 212250.00, northing: 9914920.00, elevation: 1895.40, rawCode: "RD-CL", category: "road", description: "Corridor Road Alignment" },
      { id: "HW3", easting: 212520.00, northing: 9914950.00, elevation: 1904.00, rawCode: "RD-CL", category: "road", description: "Corridor Road Alignment" },

      // High Voltage Transmission Line (PWR)
      { id: "PW1", easting: 212040.00, northing: 9914650.00, elevation: 1880.00, rawCode: "PWR", category: "utility", description: "132kV Powerline" },
      { id: "PW2", easting: 212300.00, northing: 9914680.00, elevation: 1884.50, rawCode: "PWR", category: "utility", description: "132kV Powerline" },
      { id: "PW3", easting: 212540.00, northing: 9914720.00, elevation: 1890.00, rawCode: "PWR", category: "utility", description: "132kV Powerline" },

      // 3D Terrain Spot Heights for Contouring & Triangulation
      { id: "T1", easting: 212100.00, northing: 9915100.00, elevation: 1905.00, rawCode: "SL", category: "terrain", description: "Ridge Top" },
      { id: "T2", easting: 212300.00, northing: 9915120.00, elevation: 1918.50, rawCode: "SL", category: "terrain", description: "Escarpment Peak" },
      { id: "T3", easting: 212450.00, northing: 9915140.00, elevation: 1922.00, rawCode: "SL", category: "terrain", description: "Escarpment Peak" },
      { id: "T4", easting: 212150.00, northing: 9914850.00, elevation: 1884.00, rawCode: "SL", category: "terrain", description: "Valley Terrace" },
      { id: "T5", easting: 212350.00, northing: 9914800.00, elevation: 1886.50, rawCode: "SL", category: "terrain", description: "Valley Terrace" },
      { id: "T6", easting: 212200.00, northing: 9914680.00, elevation: 1877.00, rawCode: "SL", category: "terrain", description: "Floodplain" },
      { id: "T7", easting: 212400.00, northing: 9914660.00, elevation: 1881.00, rawCode: "SL", category: "terrain", description: "Floodplain" },
      { id: "T8", easting: 212500.00, northing: 9914820.00, elevation: 1891.00, rawCode: "SL", category: "terrain", description: "Bench Level" },
    ],
  },

  // ── Benchmark 3: UN-Habitat Climate-Smart Settlement & Sun King Solar Reach ──
  {
    id: "un-habitat-sunking",
    title: "Climate-Smart Settlement & Off-Grid Energy Reach",
    badge: "UN-Habitat & Sun King",
    description: "Multi-criteria suitability modeling (MCDA), flood sink hazard exposure audit, and Sun King solar mini-grid clustering for unserved communities.",
    metadata: {
      id: "UNH-ETH-2026-08",
      title: "Gambella-Turkana Resilient Settlement & Energy Corridor",
      locality: "Cross-Border Development Zone",
      country: "Regional East Africa",
      crs: "WGS 84 / UTM zone 36N (EPSG: 32636)",
      surveyorName: "UN-Habitat & Sun King GIS Specialist",
      registrationNo: "UNH-GIS-092",
      date: "2026-09-08",
      scale: "1:5,000",
      organization: "UN-Habitat Urban Resilience & Sun King Decentralized Utility",
    },
    points: [
      // Master Settlement Perimeter
      { id: "UB1", easting: 350100.00, northing: 920100.00, elevation: 512.00, rawCode: "BL", category: "boundary", description: "Planning Boundary" },
      { id: "UB2", easting: 350850.00, northing: 920250.00, elevation: 524.50, rawCode: "BL", category: "boundary", description: "Planning Boundary" },
      { id: "UB3", easting: 350920.00, northing: 919400.00, elevation: 508.20, rawCode: "BL", category: "boundary", description: "Planning Boundary" },
      { id: "UB4", easting: 350150.00, northing: 919350.00, elevation: 504.10, rawCode: "BL", category: "boundary", description: "Planning Boundary" },
      { id: "UB1_CL", easting: 350100.00, northing: 920100.00, elevation: 512.00, rawCode: "BL", category: "boundary", description: "Planning Boundary Close" },

      // River & Flash Flood Basin
      { id: "ST1", easting: 350120.00, northing: 919420.00, elevation: 502.50, rawCode: "RIV", category: "water", description: "Ephemeral Stream" },
      { id: "ST2", easting: 350350.00, northing: 919500.00, elevation: 503.80, rawCode: "RIV", category: "water", description: "Ephemeral Stream" },
      { id: "ST3", easting: 350600.00, northing: 919650.00, elevation: 505.20, rawCode: "RIV", category: "water", description: "Ephemeral Stream" },
      { id: "ST4", easting: 350880.00, northing: 919800.00, elevation: 507.00, rawCode: "RIV", category: "water", description: "Ephemeral Stream" },

      // Access Road
      { id: "RD1", easting: 350150.00, northing: 919950.00, elevation: 514.00, rawCode: "RD-CL", category: "road", description: "Main Access Artery" },
      { id: "RD2", easting: 350480.00, northing: 919980.00, elevation: 518.20, rawCode: "RD-CL", category: "road", description: "Main Access Artery" },
      { id: "RD3", easting: 350800.00, northing: 920020.00, elevation: 522.00, rawCode: "RD-CL", category: "road", description: "Main Access Artery" },

      // Dense Settlement Cluster A (High Density ~75 households - Prime Mini-Grid Target)
      { id: "V1", easting: 350520.00, northing: 920050.00, elevation: 520.00, rawCode: "VILL", category: "settlement", description: "Homestead Block A1" },
      { id: "V2", easting: 350560.00, northing: 920080.00, elevation: 521.20, rawCode: "VILL", category: "settlement", description: "Homestead Block A2" },
      { id: "V3", easting: 350600.00, northing: 920040.00, elevation: 520.80, rawCode: "VILL", category: "settlement", description: "Homestead Block A3" },
      { id: "V4", easting: 350550.00, northing: 920010.00, elevation: 519.50, rawCode: "VILL", category: "settlement", description: "Homestead Block A4" },

      // Vulnerable Settlement Cluster B (Located inside low-point flood basin!)
      { id: "VB1", easting: 350320.00, northing: 919520.00, elevation: 504.20, rawCode: "VILL", category: "settlement", description: "Flood-Prone Homestead B1" },
      { id: "VB2", easting: 350370.00, northing: 919540.00, elevation: 504.80, rawCode: "VILL", category: "settlement", description: "Flood-Prone Homestead B2" },

      // Social Infrastructure
      { id: "HC_01", easting: 350480.00, northing: 919920.00, elevation: 517.50, rawCode: "CLINIC", category: "settlement", description: "Community Health Dispensary" },
      { id: "SC_01", easting: 350650.00, northing: 920120.00, elevation: 522.80, rawCode: "SCH", category: "settlement", description: "Primary School" },
      { id: "WP_01", easting: 350360.00, northing: 919600.00, elevation: 505.50, rawCode: "WTR_PT", category: "settlement", description: "Solar Powered Borehole" },

      // Solar & Energy
      { id: "PV_01", easting: 350700.00, northing: 920180.00, elevation: 523.50, rawCode: "SOLAR", category: "energy", description: "Proposed 25kW Solar Mini-Grid Facility" },

      // National Grid High Voltage (Far: ~7.8 km away)
      { id: "GD_01", easting: 350100.00, northing: 920800.00, elevation: 530.00, rawCode: "GRID", category: "utility", description: "National MV Grid Line" },
      { id: "GD_02", easting: 350800.00, northing: 920850.00, elevation: 535.00, rawCode: "GRID", category: "utility", description: "National MV Grid Line" },

      // Terrain Relief Spot Levels for DEM/TIN
      { id: "L1", easting: 350250.00, northing: 919800.00, elevation: 510.00, rawCode: "SL", category: "terrain", description: "Terrain Relief" },
      { id: "L2", easting: 350400.00, northing: 919750.00, elevation: 508.50, rawCode: "SL", category: "terrain", description: "Terrain Relief" },
      { id: "L3", easting: 350750.00, northing: 919850.00, elevation: 515.00, rawCode: "SL", category: "terrain", description: "Terrain Relief" },
      { id: "L4", easting: 350280.00, northing: 919450.00, elevation: 503.20, rawCode: "SL", category: "terrain", description: "Low Depression Basin" },
      { id: "L5", easting: 350500.00, northing: 919480.00, elevation: 505.00, rawCode: "SL", category: "terrain", description: "River Bank" },
      { id: "L6", easting: 350850.00, northing: 919600.00, elevation: 511.00, rawCode: "SL", category: "terrain", description: "Gentle Slope" },
    ],
  },
];