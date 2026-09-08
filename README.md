# MetaRDU GIS Studio

> **Autonomous Spatial Intelligence, Cadastral Automation & Climate Resilience Workstation**

MetaRDU GIS Studio is a high-performance, offline-capable geospatial engineering application designed to eliminate the repetitive manual friction in traditional GIS, land surveying, urban planning, and decentralized electrification workflows.

With a single click or raw file ingestion, MetaRDU GIS Studio executes an autonomous 9-stage spatial analysis pipeline in **under 15 milliseconds**—delivering publication-grade cartography, statutory cadastral deed plans, and decision-grade spatial insights without server roundtrips.

---

## The 9-Stage Autonomous Spatial Pipeline

```
[Raw Ingest: CSV / TSV / Leica GSI / GeoJSON]
                     │
                     ▼
[1. Delimiter & Schema Sniffer]   ──> Auto-maps Point ID, Easting, Northing, Elevation, Feature Code
                     │
                     ▼
[2. Geodetic & Geoid Reduction]   ──> Arc 1960 / WGS84 / UTM 37S / Cassini & EGM2008 (H = h - N)
                     │
                     ▼
[3. Field-to-Finish Coding]       ──> 70 SoK codes auto-vectorized into layered CAD (BL, RD-CL, BLD, RIV)
                     │
                     ▼
[4. Delaunay TIN & Contouring]    ──> Non-overlapping 3D mesh, slope gradients & smoothed 1m/5m isolines
                     │
                     ▼
[5. Cadastral Topology Auditor]   ──> Bowditch misclosure, precision ratio (1:N), area in m², Ha, Acres
                     │
                     ▼
[6. Corridor & Setback Buffers]   ──> 15m road reserves, 30m riparian exclusions, encroachment audit
                     │
                     ▼
[7. UN-Habitat Climate MCDA]      ──> Dynamic slope, setback & accessibility settlement suitability
                     │
                     ▼
[8. Hazard & Sink Vulnerability]  ──> Flood depression sinks & affected infrastructure exposure counter
                     │
                     ▼
[9. Sun King Energy Reach]        ──> Settlement clustering, Mini-Grid vs SHS sizing & VIIRS dark gap
                     │
                     ▼
[1-Click Deliverables Publishing]
├── Official Form 4 Statutory Deed Plan (Vector SVG / Print-ready PDF)
├── UN-Habitat Regional GIS Planning Atlas (Executive Decision Sheet)
├── AutoCAD DXF R2018 (Layered: BOUNDARIES, CONTOURS, BEACONS, BUFFERS)
├── Standards-compliant GeoJSON (RFC 7946 for QGIS, ArcGIS, Mapbox)
├── LandXML 1.2 Digital Cadastre Schema (National Land Portal lodgement)
└── Survey Station & Coordinate Mutation Schedule (CSV / Excel)
```

---

## Core Power Modules

### 1. Dual-Mode 2D Vector & Remote Sensing Canvas
* **Multi-Source Basemaps**:
  * **NASA VIIRS Night-Time Lights (Black Marble)**: Displays nocturnal radiance to identify unserved off-grid village dark gaps.
  * **Satellite Aerial Mode**: Simulated true-color aerial photography.
  * **Dark Topographic Vector**: High-contrast cyber-cartographic engineering theme.
  * **CAD Light Blueprint**: Clean white drafting layout.
* **Precision CAD Overlays**:
  * High-DPI canvas rendering metric coordinate graticule ticks (`+`).
  * Boundary polylines with automated bearing and distance callouts (e.g. `124°30'15" · 84.52m`).
  * Continuous 1m minor and 5m major index contours with elevation labels.
  * Live cursor readout: Easting, Northing, Orthometric MSL Elevation ($m$), and active CRS.

### 2. 3D Surface Triangulation (TIN) & Earthwork Cut/Fill
* Delaunay triangulation computed with adaptive-precision floating-point arithmetic.
* Full 360° orbit, pitch tilt, and vertical exaggeration control ($1.0\times$ to $5.0\times$).
* **Earthwork Balancing**: Interactive formation datum plane slider computing excavation cut ($m^3$) and embankment fill ($m^3$) in real time.

### 3. UN-Habitat Climate-Smart Suitability Studio (MCDA)
* Real-time Multi-Criteria Decision Analysis sliders:
  * **Terrain Slope Weight**: Penalizes steep escarpment and erosion hazards.
  * **Road Accessibility Weight**: Prioritizes transport corridor frontage.
  * **Riparian Conservation Setback**: Enforces statutory 30m/60m exclusion buffers along river channels.
  * **Max Buildable Slope Cutoff**: Automatically classifies slopes $>25\%$ as hazardous.
* Instant composite development heatmap: **Optimal (Dark Green)**, **Suitable (Green)**, **Moderate Caution (Yellow)**, and **Restricted / Hazard (Red)**.

### 4. Hazard Vulnerability & Flood Inundation Auditor
* Identifies natural topographic depression sinks from the 3D elevation surface.
* Audits surveyed homesteads, clinics, schools, and roads, flagging any asset situated within the inundation basin.
* Generates an automated **Statutory Climate Mitigation Action Plan** with culvert upgrades and resettlement recommendations.

### 5. Sun King Off-Grid Energy Reach & Clustering
* Clusters rural homesteads into discrete settlement centers.
* Evaluates distance to national transmission lines:
  * Clusters $>50$ households within 350m: **Solar Hybrid Mini-Grid** (estimates daily kWh demand and recommended solar PV kWp capacity).
  * Isolated homesteads $>5$ km from grid: **Stand-Alone Solar Home Systems (SHS)**.
  * Clusters $<1.2$ km from grid: **Grid Extension**.

### 6. Statutory & Executive Deliverables Publisher
* **Form 4 Statutory Survey Deed Plan (Mutation Sheet)**: Formatted with official national survey border, title block, coordinate graticule grid, true north arrow, metric scale bar, and Beacon Coordinate Schedule Table.
* **UN-Habitat Regional Planning Atlas**: Pre-composed decision dossier with executive KPI cards, suitability choropleth, hazard vulnerability matrix, and municipal approval blocks.
* **1-Click Multi-Format Export**: AutoCAD R2018 DXF, GeoJSON RFC 7946, LandXML 1.2, SVG, and CSV.

---

## Pre-Loaded Benchmark Scenarios

1. **Nairobi Upper Hill Cadastral Mutation**: Urban parcel boundary mutation, road reserve excision, boundary precision audit, and Form 4 Deed Plan.
2. **Great Rift Valley Infrastructure Corridor**: Corridor survey with Delaunay TIN triangulation, continuous 1m/5m contouring, 30m riparian river setback, and cut/fill earthwork balance.
3. **Climate-Smart Settlement & Off-Grid Energy Reach**: UN-Habitat settlement suitability modeling, flood sink hazard exposure audit, and Sun King solar mini-grid clustering for unserved communities.

---

## Getting Started

### Prerequisites
* Node.js (v18+ or v20+)
* npm

### Installation & Run

```bash
# Clone the repository
git clone https://github.com/error302/metardu--GIS.git
cd metardu--GIS

# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

Open your browser at `http://localhost:5173/` to launch the workstation.

---

## Tech Stack

* **Framework**: React 19, TypeScript
* **Build System**: Vite 6, Rolldown
* **Styling & UI**: Tailwind CSS v4, Lucide Icons
* **Computational Geometry**: Delaunay Triangulation, Marching Squares, Bowyer-Watson, Vincenty Geodesy
* **Vector Output**: AutoCAD DXF R2018, GeoJSON RFC 7946, LandXML 1.2, Vector SVG

---

## License

MIT License. Designed for professional land surveyors, GIS specialists, and regional planners across Africa and emerging markets.